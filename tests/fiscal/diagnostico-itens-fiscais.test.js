'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, it } = require('node:test');
const { buildNfceXml } = require('../../backend/services/fiscal/xmlBuilder');
const { gerarXmlDocumento } = require('../../backend/services/fechamento-fiscal/FechamentoFiscalPreparacaoService');
const {
  criarDiagnosticoPreparacao,
  criarPayloadErroXml
} = require('../../backend/services/fechamento-fiscal/DiagnosticoPreparacaoFiscal');

const FRONT = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');

const CONFIG = {
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
};

function item(id, nome, extra = {}) {
  return {
    produto_id: id,
    descricao: nome,
    ncm: '19053200',
    cfop: '5102',
    csosn: '102',
    origem: 0,
    unidade: 'UN',
    quantidade: 1,
    valor_unitario: 10,
    valor_total: 10,
    codigo: `PROD-${id}`,
    codigo_barras: `789000000${id}`,
    ...extra
  };
}

async function gerar(snapshotItens, valorTotal) {
  return gerarXmlDocumento({
    config: CONFIG,
    snapshotItens,
    pagamentos: [{ forma_pagamento: 'dinheiro', valor: valorTotal }],
    valorTotal,
    numero: 1000
  });
}

async function capturar(fn) {
  try {
    await fn();
  } catch (erro) {
    return erro;
  }
  return null;
}

function carregarFrontend() {
  const inicio = FRONT.indexOf('function ffdTextoDiagnostico(');
  const fim = FRONT.indexOf('/**\n * Sprint 07.8', inicio);
  const contexto = { console: { error() {} } };
  vm.runInNewContext(`${FRONT.slice(inicio, fim)}; globalThis.ffdErroApi = ffdErroApi;`, contexto);
  return contexto;
}

describe('Diagnóstico fiscal por produto na geração do XML', () => {
  it('CSOSN 060 identifica o produto responsável (nome, ID, código, barras, item, campo e valor)', async () => {
    const erro = await capturar(() => gerar([
      item(11, 'Biscoito OK'),
      item(366, 'Pastel de Carne', { csosn: '060' })
    ], 20));

    assert.ok(erro);
    assert.equal(erro.etapa, 'montagem_xml');
    assert.equal(erro.message, 'CSOSN 060 inválido para NFC-e. Use 101, 102, 103, 300, 400, 500 ou 900 no cadastro do produto.');
    assert.equal(erro.itensErros.length, 1);
    assert.deepEqual(erro.itensErros[0], {
      produto_id: 366,
      codigo: 'PROD-366',
      nome: 'Pastel de Carne',
      codigo_barras: '789000000366',
      numero_item: 2,
      campo: 'CSOSN',
      valor_encontrado: '060',
      valor_esperado: '101, 102, 103, 300, 400, 500 ou 900',
      mensagem: erro.message
    });
  });

  it('lista todos os itens inválidos sem atribuir erro ao produto errado', async () => {
    const erro = await capturar(() => gerar([
      item(1, 'Item A', { csosn: '060' }),
      item(2, 'Item B OK'),
      item(3, 'Item C', { ncm: '123' }),
      item(4, 'Item D', { csosn: '201' })
    ], 40));

    assert.ok(erro);
    const porProduto = Object.fromEntries(erro.itensErros.map((e) => [e.produto_id, e]));
    assert.deepEqual(Object.keys(porProduto).sort(), ['1', '3', '4']);
    assert.equal(porProduto[2], undefined);
    assert.equal(porProduto[1].campo, 'CSOSN');
    assert.equal(porProduto[1].valor_encontrado, '060');
    assert.equal(porProduto[1].numero_item, 1);
    assert.equal(porProduto[3].campo, 'NCM');
    assert.equal(porProduto[3].valor_encontrado, '123');
    assert.equal(porProduto[3].numero_item, 3);
    assert.equal(porProduto[3].nome, 'Item C');
    assert.equal(porProduto[4].campo, 'CSOSN');
    assert.equal(porProduto[4].valor_encontrado, '201');
    assert.equal(porProduto[4].codigo, 'PROD-4');
    assert.match(erro.message, /3 itens/);
  });

  it('erro sem vínculo com item não gera produto fictício', async () => {
    const erro = await capturar(() => gerarXmlDocumento({
      config: { ambiente: 2, serie: 1 },
      snapshotItens: [],
      pagamentos: [],
      valorTotal: 0,
      numero: 1,
      buildFn: () => ({ xmlSemAssinatura: '' })
    }));
    assert.ok(erro);
    assert.equal(erro.itensErros, undefined);

    const diag = criarDiagnosticoPreparacao({
      etapa: erro.etapa,
      codigo: erro.code,
      mensagem: erro.message,
      errosItens: erro.itensErros
    });
    assert.equal('erros_itens' in diag, false);
    const payload = criarPayloadErroXml({
      correlationId: 'c-1',
      documentos: [{ id: 1, sequencia: 1, erros: [diag] }]
    });
    assert.equal('erros_itens' in payload, false);
    assert.equal('erros_itens' in payload.documentos[0], false);
  });

  it('item sem identificação adicional informa somente o que existe', async () => {
    const erro = await capturar(() => gerar([
      item(5, 'Sem códigos', { csosn: '060', codigo: null, codigo_barras: null })
    ], 10));
    const e = erro.itensErros[0];
    assert.equal(e.codigo, null);
    assert.equal(e.codigo_barras, null);
    assert.equal(e.produto_id, 5);
  });

  it('buildNfceXml direto (fluxo de emissão) também anexa o contexto do item', () => {
    let erro;
    try {
      buildNfceXml({
        config: CONFIG,
        venda: { total: 10, valor_fiscal: 10, pagamentos: [{ forma_pagamento: 'dinheiro', valor: 10 }] },
        itens: [{
          produto_id: 9,
          produto_nome: 'Suco',
          codigo_barras: '7891234567895',
          ncm: '22021000',
          cfop: '5102',
          csosn: '060',
          quantidade: 1,
          preco_unitario: 10,
          valor_fiscal: 10
        }],
        numero: 5
      });
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
    assert.equal(erro.itensErros[0].produto_id, 9);
    assert.equal(erro.itensErros[0].codigo_barras, '7891234567895');
    assert.equal(erro.itensErros[0].numero_item, 1);
  });

  it('a validação original continua ativa e itens válidos continuam gerando XML', async () => {
    const gerado = await gerar([item(1, 'Item A'), item(2, 'Item B', { csosn: '500' })], 20);
    assert.ok(gerado.xml.includes('<CSOSN>102</CSOSN>'));
    assert.ok(gerado.xml.includes('<CSOSN>500</CSOSN>'));
    assert.ok(!gerado.xml.includes('SEM GTIN') || gerado.xml.includes('<cEAN>'));
  });

  it('payload da API preserva campos antigos, agrega por documento e não expõe dados sensíveis', () => {
    const diag = criarDiagnosticoPreparacao({
      etapa: 'montagem_xml',
      codigo: 'XML_ERRO',
      mensagem: 'Item 1 token=segredo',
      correlationId: 'corr-9',
      errosItens: [{
        produto_id: 7,
        codigo: 'P-7',
        nome: 'Produto <b>X</b>',
        numero_item: 1,
        campo: 'CSOSN',
        valor_encontrado: '060',
        mensagem: 'CSOSN 060 inválido para NFC-e. senha=abc',
        stack: 'stack secreta',
        sql: 'SELECT * FROM produtos'
      }]
    });
    const payload = criarPayloadErroXml({
      correlationId: 'corr-9',
      stack: 'stack secreta',
      documentos: [
        { id: 3, sequencia: 1, xml_preparado: '<NFe>x</NFe>', erros: [diag] },
        { id: 4, sequencia: 2, erros: [] }
      ]
    });

    assert.equal(payload.error, 'Falha ao gerar XML de um ou mais documentos.');
    assert.equal(payload.code, 'XML_ERRO');
    assert.equal(payload.correlationId, 'corr-9');
    assert.equal(payload.documentos.length, 1);
    assert.equal(payload.documentos[0].id, 3);
    assert.equal(payload.erros_itens.length, 1);
    assert.equal(payload.erros_itens[0].documento_id, 3);
    assert.equal(payload.erros_itens[0].sequencia, 1);
    assert.equal(payload.erros_itens[0].nome, 'Produto X');
    const json = JSON.stringify(payload);
    assert.doesNotMatch(json, /stack secreta|SELECT|abc|segredo|<NFe>|<b>/);
  });

  it('frontend mostra produto, código, campo, valor, orientação e correlação, agrupado por documento', () => {
    const { ffdErroApi } = carregarFrontend();
    const mensagem = ffdErroApi({
      error: 'Falha ao gerar XML de um ou mais documentos.',
      code: 'XML_ERRO',
      correlationId: 'corr-77',
      documentos: [
        {
          id: 1, sequencia: 1, etapa: 'montagem_xml', codigo: 'XML_ERRO', mensagem: 'x',
          erros_itens: [{
            produto_id: 366, codigo: 'PROD-366', nome: 'Pastel de Carne', codigo_barras: '7890000000366',
            numero_item: 2, campo: 'CSOSN', valor_encontrado: '060',
            valor_esperado: '101, 102, 103, 300, 400, 500 ou 900',
            mensagem: 'CSOSN 060 inválido para NFC-e.'
          }]
        },
        {
          id: 2, sequencia: 2, etapa: 'montagem_xml', codigo: 'XML_ERRO', mensagem: 'y',
          erros_itens: [{
            produto_id: 8, codigo: 'P8', nome: 'Suco', numero_item: 1, campo: 'NCM',
            valor_encontrado: '123', mensagem: 'sem NCM válido'
          }]
        }
      ]
    });

    assert.match(mensagem, /Documento 1/);
    assert.match(mensagem, /Documento 2/);
    assert.match(mensagem, /Item 2 — "Pastel de Carne" \(ID 366, código PROD-366/);
    assert.match(mensagem, /campo CSOSN = "060"/);
    assert.match(mensagem, /campo NCM = "123"/);
    assert.match(mensagem, /Orientação: corrija/);
    assert.match(mensagem, /Correlação para suporte: corr-77/);
    assert.doesNotMatch(mensagem, /\[object Object\]|undefined/);
    assert.ok(mensagem.indexOf('Documento 1') < mensagem.indexOf('Pastel de Carne'));
    assert.ok(mensagem.indexOf('Pastel de Carne') < mensagem.indexOf('Documento 2'));
  });

  it('frontend sem erros de item mostra a causa real sem inventar produto', () => {
    const { ffdErroApi } = carregarFrontend();
    const mensagem = ffdErroApi({
      error: 'Falha ao gerar XML de um ou mais documentos.',
      code: 'XML_ERRO',
      documentos: [{ id: 1, sequencia: 1, etapa: 'validacao_xml', codigo: 'XML_AUSENTE', mensagem: 'XML ausente.' }]
    });
    assert.match(mensagem, /XML ausente\./);
    assert.doesNotMatch(mensagem, /Orientação|produto/i);
  });
});
