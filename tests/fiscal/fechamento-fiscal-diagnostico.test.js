'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, it } = require('node:test');
const {
  criarPayloadErroXml,
  criarDiagnosticoPreparacao,
  sanitizarDiagnosticosDocumentos
} = require('../../backend/services/fechamento-fiscal/DiagnosticoPreparacaoFiscal');
const { gerarXmlDocumento } = require('../../backend/services/fechamento-fiscal/FechamentoFiscalPreparacaoService');

const FRONT_PATH = path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js');
const FRONT = fs.readFileSync(FRONT_PATH, 'utf8');
const BUILDER_PATH = path.join(__dirname, '../../backend/services/fiscal/xmlBuilder.js');
const BUILDER = fs.readFileSync(BUILDER_PATH, 'utf8');

function carregarFuncoesDeErroFrontend() {
  const inicio = FRONT.indexOf('function ffdTextoDiagnostico(');
  const fim = FRONT.indexOf('/**\n * Sprint 07.8', inicio);
  assert.ok(inicio >= 0 && fim > inicio, 'helpers de erro frontend devem estar delimitados');
  const logs = [];
  const contexto = {
    console: { error: (...args) => logs.push(args) }
  };
  vm.runInNewContext(
    `${FRONT.slice(inicio, fim)}; globalThis.ffdErroApi = ffdErroApi;`,
    contexto
  );

  const motivoInicio = FRONT.indexOf('function ffdMotivoRealErro(');
  const motivoFim = FRONT.indexOf('async function ffdExecutarValidacaoCore(', motivoInicio);
  assert.ok(motivoInicio >= 0 && motivoFim > motivoInicio, 'ffdMotivoRealErro deve estar delimitada');
  vm.runInNewContext(
    `${FRONT.slice(motivoInicio, motivoFim)}; globalThis.ffdMotivoRealErro = ffdMotivoRealErro;`,
    contexto
  );
  return { ...contexto, logs };
}

describe('Diagnóstico seguro da preparação fiscal', () => {
  it('preserva código e mensagem sanitizada, sem credenciais, XML ou stack trace', () => {
    const diagnostico = criarDiagnosticoPreparacao({
      etapa: 'montagem_xml',
      codigo: 'XML_BUILDER_FAIL',
      mensagem: 'Builder falhou; senha=abc123 token=secreto CNPJ 12.345.678/0001-99 <NFe>xml</NFe>\n at builder.js:10',
      correlationId: 'corr-123',
      ocorridoEm: '2026-10-15T12:00:00.000Z',
      componente: 'xmlBuilder'
    });

    assert.equal(diagnostico.codigo, 'XML_BUILDER_FAIL');
    assert.match(diagnostico.mensagem, /Builder falhou/);
    assert.doesNotMatch(diagnostico.mensagem, /abc123|secreto|12\.345\.678|<NFe>|builder\.js/);
    assert.equal(diagnostico.etapa, 'montagem_xml');
    assert.equal(diagnostico.componente, 'xmlBuilder');
  });

  it('converte apenas documentos com diagnóstico para uma allowlist segura', () => {
    const documentos = sanitizarDiagnosticosDocumentos([
      {
        id: 7,
        sequencia: 2,
        status: 'ERRO',
        xml_preparado: '<NFe>não expor</NFe>',
        itens: [{ produto_nome: 'dado privado' }],
        erros: [{
          codigo: 'XML_VALIDACAO',
          mensagem: 'Falha <NFe>conteúdo omitido</NFe>',
          etapa: 'validacao_xml',
          stack: 'stack secreta'
        }]
      },
      { id: 8, sequencia: 3, status: 'PRONTO_EMISSAO', erros: [] }
    ]);

    assert.deepEqual(documentos, [{
      id: 7,
      sequencia: 2,
      etapa: 'validacao_xml',
      codigo: 'XML_VALIDACAO',
      mensagem: 'Falha [conteúdo XML omitido]'
    }]);
    assert.doesNotMatch(JSON.stringify(documentos), /não expor|dado privado|stack secreta/);
  });

  it('serializa XML_ERRO por allowlist e mantém HTTP sem dados arbitrários', () => {
    const payload = criarPayloadErroXml({
      code: 'XML_ERRO',
      message: 'Não deve substituir a mensagem pública estável.',
      correlationId: 'corr-123',
      stack: 'stack secreta',
      validacao: { erro: 'informação interna' },
      documentos: [{
        id: 9,
        sequencia: 3,
        status: 'ERRO',
        xml_preparado: '<NFe>não devolver</NFe>',
        erros: [{
          codigo: 'XML_VALIDACAO',
          mensagem: 'Falha no documento.',
          etapa: 'validacao_xml'
        }]
      }]
    });

    assert.deepEqual(payload, {
      error: 'Falha ao gerar XML de um ou mais documentos.',
      code: 'XML_ERRO',
      correlationId: 'corr-123',
      documentos: [{
        id: 9,
        sequencia: 3,
        etapa: 'validacao_xml',
        codigo: 'XML_VALIDACAO',
        mensagem: 'Falha no documento.'
      }]
    });
    assert.doesNotMatch(JSON.stringify(payload), /stack secreta|informação interna|não devolver/);
  });

  it('identifica a etapa e mantém a exceção original da validação XML', async () => {
    let erroCapturado;
    try {
      await gerarXmlDocumento({
        config: { ambiente: 2, serie: 1 },
        snapshotItens: [],
        pagamentos: [],
        valorTotal: 0,
        numero: 1,
        buildFn: () => ({ xmlSemAssinatura: '' })
      });
    } catch (erro) {
      erroCapturado = erro;
    }

    assert.ok(erroCapturado);
    assert.equal(erroCapturado.code, 'XML_AUSENTE');
    assert.equal(erroCapturado.etapa, 'validacao_xml');
  });

  it('reproduz o CSOSN 060 do snapshot do documento no builder sem corrigir regra fiscal', async () => {
    let erroCapturado;
    try {
      await gerarXmlDocumento({
        config: {
          ambiente: 2,
          serie: 1,
          uf: 'CE',
          codigoUf: '23',
          crt: '1',
          cnpj: '68645756000121',
          ie: '073590150',
          nomeEmpresa: 'TESTE',
          municipioCodigo: '2307304',
          municipioNome: 'Juazeiro do Norte',
          logradouro: 'Rua A',
          numeroEndereco: '1',
          bairro: 'Centro',
          cep: '63000000',
          idCSC: '00001',
          tokenCSC: 'AAAA',
          certificadoPath: null,
          certificadoSenha: null,
          urls: { consultaQr: 'https://example.local/qr', consultaChave: 'https://example.local/chave' }
        },
        snapshotItens: [{
          produto_id: 366,
          descricao: 'produto da fixture',
          ncm: '19053200',
          cfop: '5102',
          csosn: '60',
          origem: 0,
          unidade: 'UN',
          quantidade: 1,
          valor_unitario: 50,
          valor_total: 50
        }],
        pagamentos: [{ forma_pagamento: 'dinheiro', valor: 50 }],
        valorTotal: 50,
        numero: 1000
      });
    } catch (erro) {
      erroCapturado = erro;
    }

    assert.ok(erroCapturado);
    assert.equal(erroCapturado.etapa, 'montagem_xml');
    assert.equal(
      erroCapturado.message,
      'CSOSN 060 inválido para NFC-e. Use 101, 102, 103, 300, 400, 500 ou 900 no cadastro do produto.'
    );
    const persistido = criarDiagnosticoPreparacao({
      etapa: erroCapturado.etapa,
      codigo: erroCapturado.code || 'XML_ERRO',
      mensagem: erroCapturado.message,
      correlationId: 'fixture-correlation'
    });
    assert.equal(persistido.codigo, 'XML_ERRO');
    assert.match(persistido.mensagem, /^CSOSN 060 inválido para NFC-e/);
  });

  it('mantém a lista informativa sincronizada com os ramos CSOSN implementados', () => {
    const inicio = BUILDER.indexOf('function montarBlocoIcmsSimplesNacional(');
    const fim = BUILDER.indexOf('\nfunction splitEnderecoLivre', inicio);
    assert.ok(inicio >= 0 && fim > inicio, 'montarBlocoIcmsSimplesNacional deve estar delimitada');
    const funcao = BUILDER.slice(inicio, fim);
    const implementados = new Set();

    for (const [, valores] of funcao.matchAll(/\[([^\]]+)\]\.includes\(csosn\)/g)) {
      for (const [, codigo] of valores.matchAll(/'(\d{3})'/g)) implementados.add(codigo);
    }
    for (const [, codigo] of funcao.matchAll(/csosn === '(\d{3})'/g)) implementados.add(codigo);

    const listaMensagem = funcao.match(/Use (.+?) no cadastro do produto\./);
    assert.ok(listaMensagem, 'mensagem de CSOSN inválido deve listar códigos');
    const informados = listaMensagem[1].match(/\d{3}/g) || [];
    assert.deepEqual([...informados].sort(), [...implementados].sort());
  });

  it('frontend mostra documento, fase e mensagem e não expõe stack ou XML', () => {
    const frontend = carregarFuncoesDeErroFrontend();
    const mensagem = frontend.ffdErroApi({
      error: 'Falha ao gerar XML de um ou mais documentos.',
      code: 'XML_ERRO',
      correlationId: 'corr-123',
      documentos: [{
        id: 7,
        sequencia: 2,
        etapa: 'validacao_xml',
        code: 'XML_VALIDACAO',
        message: 'Falha na validação token=secreto <NFe>xml</NFe>\n at validador.js:20'
      }]
    });

    assert.match(mensagem, /Documento 2/);
    assert.match(mensagem, /validacao_xml/);
    assert.match(mensagem, /XML_VALIDACAO/);
    assert.doesNotMatch(mensagem, /secreto|<NFe>|validador\.js/);
    assert.equal(frontend.logs[0][1].correlationId, 'corr-123');
    assert.equal(frontend.logs[0][1].documentos.length, 1);
  });

  it('frontend trata documentos ausentes, vazios e payloads inesperados', () => {
    const frontend = carregarFuncoesDeErroFrontend();
    for (const payload of [
      { error: 'Falha geral.', code: 'XML_ERRO' },
      { error: 'Falha geral.', code: 'XML_ERRO', documentos: [] },
      null,
      []
    ]) {
      assert.doesNotThrow(() => frontend.ffdErroApi(payload, 'fallback'));
    }

    const semDiagnostico = frontend.ffdMotivoRealErro(
      { error: 'Falha ao gerar XML.', code: 'XML_ERRO', documentos: [] },
      'fallback'
    );
    assert.match(semDiagnostico, /Diagnóstico individual não disponível/);
    assert.doesNotMatch(semDiagnostico, /undefined/);
  });

  it('integra endpoint HTTP, serialização da rota e mensagem exibida sem banco oficial', async () => {
    const tempDbDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ffd-route-test-'));
    const previousDbDir = process.env.DB_DIR;
    const previousIsolation = process.env.CDS_TEST_ISOLAR_BANCO;
    process.env.DB_DIR = tempDbDir;
    process.env.CDS_TEST_ISOLAR_BANCO = '1';

    let server;
    let db;
    let service;
    let originalPreparation;
    let moduloConfig;
    let originalModuloCheck;
    try {
      const express = require('express');
      const router = require('../../backend/rotas/fechamento-fiscal');
      service = require('../../backend/services/fechamento-fiscal');
      moduloConfig = require('../../backend/services/fechamento-fiscal/fechamentoFiscalModuloConfig');
      originalPreparation = service.prepararEmissaoFiscal;
      originalModuloCheck = moduloConfig.estaAtivadaAsync;
      moduloConfig.estaAtivadaAsync = async () => true;
      const error = new Error('Falha geral.');
      error.statusCode = 400;
      error.code = 'XML_ERRO';
      error.correlationId = 'corr-http-1';
      error.documentos = [{
        id: 13,
        sequencia: 4,
        xml_preparado: '<NFe>não expor</NFe>',
        pagamentos: [{ cnpj: '12345678000199' }],
        erros: [{
          etapa: 'montagem_xml',
          codigo: 'XML_BUILDER_FAIL',
          mensagem: 'Builder falhou token=segredo <NFe>privado</NFe>'
        }]
      }];
      service.prepararEmissaoFiscal = async () => { throw error; };

      const app = express();
      app.use(express.json());
      app.use('/api/fiscal/fechamentos', router);
      server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      });
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/fiscal/fechamentos/6/preparar-emissao`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
      );
      const payload = await response.json();
      assert.equal(response.status, 400);
      assert.deepEqual(payload, {
        error: 'Falha ao gerar XML de um ou mais documentos.',
        code: 'XML_ERRO',
        correlationId: 'corr-http-1',
        documentos: [{
          id: 13,
          sequencia: 4,
          etapa: 'montagem_xml',
          codigo: 'XML_BUILDER_FAIL',
          mensagem: 'Builder falhou token=[omitido] [conteúdo XML omitido]'
        }]
      });
      assert.doesNotMatch(JSON.stringify(payload), /não expor|12345678000199|segredo|privado/);
      assert.match(carregarFuncoesDeErroFrontend().ffdErroApi(payload), /Documento 4/);
    } finally {
      if (service && originalPreparation) service.prepararEmissaoFiscal = originalPreparation;
      if (moduloConfig && originalModuloCheck) moduloConfig.estaAtivadaAsync = originalModuloCheck;
      if (server) await new Promise((resolve) => server.close(resolve));
      if (process.env.DB_DIR === tempDbDir) delete process.env.DB_DIR;
      if (previousDbDir != null) process.env.DB_DIR = previousDbDir;
      if (previousIsolation == null) delete process.env.CDS_TEST_ISOLAR_BANCO;
      else process.env.CDS_TEST_ISOLAR_BANCO = previousIsolation;

      try {
        db = require('../../backend/database');
      } catch (_) {
        db = null;
      }
      if (db && db.dbDir === tempDbDir) {
        await new Promise((resolve) => db.whenReady(() => resolve()));
        await new Promise((resolve, reject) => db.close((erro) => (erro ? reject(erro) : resolve())));
      }
      fs.rmSync(tempDbDir, { recursive: true, force: true });
    }
  });
});
