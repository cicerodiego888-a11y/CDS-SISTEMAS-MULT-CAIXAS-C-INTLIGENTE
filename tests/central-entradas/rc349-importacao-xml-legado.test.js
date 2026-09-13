/**
 * RC3.4.9 — Módulo oficial de Importação de XML Legado.
 *
 * Executar: npm run test:central-entradas-rc3.4.9
 */

const assert = require('assert');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../../backend/motores/central-entradas/core/DocumentoDfeTipo');
const {
  validarTransicao,
  ehImportacaoXmlManual,
  podeTransicionar
} = require('../../backend/motores/central-entradas/core/MaquinaEstadosDocumento');
const CentralImportacaoXmlLegadoService = require('../../backend/motores/central-entradas/services/CentralImportacaoXmlLegadoService');
const DocumentoTransitionService = require('../../backend/motores/central-entradas/services/DocumentoTransitionService');
const CentralDocumentoAtualizacaoService = require('../../backend/motores/central-entradas/services/CentralDocumentoAtualizacaoService');
const { TIPOS_EVENTO, ORIGENS } = require('../../backend/motores/central-entradas/config/centralEventosTipos');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

const CNPJ_EMPRESA = '12345678000199';
const CNPJ_FORN = '98765432000111';

function montarNfeProc(opcoes = {}) {
  const chave = opcoes.chave || '35260112345678000199550010000000771000000077';
  const cStat = opcoes.cStat || '100';
  const cnpjDest = opcoes.cnpjDest || CNPJ_EMPRESA;
  const cnpjEmit = opcoes.cnpjEmit || CNPJ_FORN;
  const protocolo = opcoes.protocolo || '135260000000001';
  const semAssinatura = opcoes.semAssinatura === true;
  const assinatura = semAssinatura ? '' : `
  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
    <SignedInfo>
      <CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
      <SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>
      <Reference URI="#NFe${chave}">
        <Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></Transforms>
        <DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>
        <DigestValue>abcdefghijklmnopqrstuvwxyz0123456789ABCD=</DigestValue>
      </Reference>
    </SignedInfo>
    <SignatureValue>abcdefghijklmnopqrstuvwxyz0123456789ABCDEFghijklmnopq=</SignatureValue>
  </Signature>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe${chave}" versao="4.00">
      <ide><cUF>35</cUF><nNF>77</nNF><serie>1</serie><mod>55</mod><dhEmi>2026-01-15T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>${cnpjEmit}</CNPJ><xNome>Fornecedor Teste LTDA</xNome></emit>
      <dest><CNPJ>${cnpjDest}</CNPJ><xNome>Empresa Destinataria LTDA</xNome></dest>
      <total><ICMSTot><vNF>100.00</vNF></ICMSTot></total>
    </infNFe>
    ${assinatura}
  </NFe>
  <protNFe>
    <infProt>
      <tpAmb>2</tpAmb>
      <chNFe>${chave}</chNFe>
      <dhRecbto>2026-01-15T10:05:00-03:00</dhRecbto>
      <nProt>${protocolo}</nProt>
      <cStat>${cStat}</cStat>
      <xMotivo>Autorizado o uso da NF-e</xMotivo>
    </infProt>
  </protNFe>
</nfeProc>`;
}

function criarHarness(opcoes = {}) {
  const docs = new Map();
  const historico = [];
  const eventos = [];
  const mirxCancelados = [];
  const processados = [];
  let nextId = 1;

  function seed(doc) {
    const id = Number(doc.id || nextId++);
    const row = {
      id,
      chave: doc.chave,
      status: doc.status,
      tipoDocumento: doc.tipoDocumento || DocumentoDfeTipo.RES_NFE,
      xml: doc.xml || '<resNFe/>',
      nsu: doc.nsu || '1',
      origem: doc.origem || 'dfe',
      parseJson: doc.parseJson || null,
      miipSessaoId: doc.miipSessaoId || null,
      compraId: doc.compraId || null,
      createdAt: doc.createdAt || '2026-01-01T00:00:00.000Z'
    };
    docs.set(id, row);
    return row;
  }

  const documentosRepository = {
    async buscarPorId(id) {
      return docs.get(Number(id)) || null;
    },
    async buscarPorChave(chave) {
      return [...docs.values()].find((d) => d.chave === chave) || null;
    },
    async atualizar(id, dados) {
      const d = docs.get(Number(id));
      if (!d) return null;
      Object.assign(d, dados);
      if (dados.statusDetalhe != null) d.statusDetalhe = dados.statusDetalhe;
      if (dados.tipoDocumento != null) d.tipoDocumento = dados.tipoDocumento;
      return d;
    }
  };

  const historicoRepository = {
    async inserir(ev) {
      historico.push(ev);
      return { id: historico.length };
    }
  };

  const historicoService = {
    async registrar(ev) {
      historico.push(ev);
    }
  };

  const transitionService = new DocumentoTransitionService({
    documentosRepository,
    historicoService
  });

  const atualizacaoService = new CentralDocumentoAtualizacaoService({
    documentosRepository,
    historicoRepository,
    transitionService
  });

  const processamentoService = {
    async processar(documentoId) {
      processados.push(Number(documentoId));
      const d = docs.get(Number(documentoId));
      if (opcoes.pipelineErro) {
        return { sucesso: false, mensagem: 'falha pipeline', documento: d };
      }
      d.status = opcoes.statusAposPipeline || DocumentoFiscalStatus.PRONTA_PARA_COMPRA;
      d.parseJson = { ok: true };
      d.miipSessaoId = 'miip-legado';
      if (opcoes.comCompra) d.compraId = 99;
      return {
        sucesso: true,
        mensagem: 'ok',
        documento: { ...d },
        possuiPendencias: false
      };
    }
  };

  const xmlWait = {
    cancelar(id, motivo) {
      mirxCancelados.push({ id: Number(id), motivo });
    },
    cancelarPorChave(chave, motivo) {
      mirxCancelados.push({ chave, motivo });
    }
  };

  const service = new CentralImportacaoXmlLegadoService({
    documentosRepository,
    historicoRepository,
    transitionService,
    atualizacaoService,
    processamentoService,
    xmlWait,
    obterCnpjEmpresa: async () => CNPJ_EMPRESA,
    emitirEvento: async (ev) => {
      eventos.push(ev);
      return ev;
    }
  });
  service._atualizarSaude = async () => {};

  return {
    service,
    seed,
    docs,
    historico,
    eventos,
    mirxCancelados,
    processados
  };
}

async function run() {
  console.log('\n=== RC3.4.9 — Importação de XML Legado ===\n');

  await test('máquina: XML_INDISPONIVEL → XML_IMPORTADO_MANUALMENTE', () => {
    assert.strictEqual(
      ehImportacaoXmlManual(
        DocumentoFiscalStatus.XML_INDISPONIVEL,
        DocumentoFiscalStatus.XML_IMPORTADO_MANUALMENTE
      ),
      true
    );
    assert.strictEqual(
      validarTransicao(
        DocumentoFiscalStatus.XML_INDISPONIVEL,
        DocumentoFiscalStatus.XML_IMPORTADO_MANUALMENTE
      ).valido,
      true
    );
    assert.strictEqual(
      podeTransicionar(
        DocumentoFiscalStatus.XML_IMPORTADO_MANUALMENTE,
        DocumentoFiscalStatus.SINCRONIZADA
      ),
      true
    );
  });

  await test('origem e eventos RC3.4.9 registrados no catálogo', () => {
    assert.strictEqual(ORIGENS.IMPORTACAO_MANUAL, 'importacao_manual');
    assert.ok(TIPOS_EVENTO.XML_IMPORTADO_MANUALMENTE);
    assert.ok(TIPOS_EVENTO.XML_VALIDADO);
    assert.ok(TIPOS_EVENTO.XML_REJEITADO);
    assert.ok(TIPOS_EVENTO.PARSER_INICIADO);
    assert.ok(TIPOS_EVENTO.PARSER_FINALIZADO);
  });

  await test('1 XML — importa e executa pipeline oficial', async () => {
    const h = criarHarness();
    const chave = '35260112345678000199550010000000771000000077';
    h.seed({
      id: 1,
      chave,
      status: DocumentoFiscalStatus.XML_INDISPONIVEL,
      tipoDocumento: DocumentoDfeTipo.RES_NFE
    });

    const xml = montarNfeProc({ chave });
    const rel = await h.service.executar(
      [{ originalname: 'nota1.xml', buffer: Buffer.from(xml) }],
      { usuarioId: 7, usuarioNome: 'Operador' }
    );

    assert.strictEqual(rel.xmlsEnviados, 1);
    assert.strictEqual(rel.xmlsValidos, 1);
    assert.strictEqual(rel.documentosEncontrados, 1);
    assert.strictEqual(rel.documentosAlterados, 1);
    assert.strictEqual(rel.parserExecutado, 1);
    assert.strictEqual(rel.miipExecutado, 1);
    assert.strictEqual(h.processados.length, 1);
    assert.ok(h.mirxCancelados.some((c) => c.id === 1));
    assert.strictEqual(h.docs.get(1).tipoDocumento, DocumentoDfeTipo.PROC_NFE);
    assert.strictEqual(
      h.docs.get(1).status,
      DocumentoFiscalStatus.PRONTA_PARA_COMPRA
    );
    assert.ok(h.eventos.some((e) => e.tipo === TIPOS_EVENTO.XML_IMPORTADO_MANUALMENTE));
    assert.ok(h.eventos.some((e) => e.tipo === TIPOS_EVENTO.PARSER_INICIADO));
    assert.ok(h.historico.some((x) => /importado manualmente/i.test(x.detalhe || '')));
  });

  await test('10 XMLs — lote misto com documentos correspondentes', async () => {
    const h = criarHarness();
    const arquivos = [];
    for (let i = 0; i < 10; i += 1) {
      const chave = `35260112345678000199550010000000${String(100 + i).padStart(3, '0')}10000000${String(10 + i).padStart(2, '0')}`;
      // chave precisa 44 dígitos
      const chave44 = `${'3526011234567800019955001'}${String(100000000 + i).padStart(9, '0')}${'1'.repeat(10)}`.slice(0, 44);
      h.seed({
        id: i + 1,
        chave: chave44,
        status: i % 2 === 0
          ? DocumentoFiscalStatus.XML_INDISPONIVEL
          : DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
      });
      arquivos.push({
        originalname: `lote-${i}.xml`,
        buffer: Buffer.from(montarNfeProc({ chave: chave44 }))
      });
    }

    const rel = await h.service.executar(arquivos, { usuarioId: 1 });
    assert.strictEqual(rel.xmlsEnviados, 10);
    assert.strictEqual(rel.documentosAlterados, 10);
    assert.strictEqual(rel.parserExecutado, 10);
    assert.strictEqual(h.processados.length, 10);
  });

  await test('27 XMLs legados — todos processados pelo pipeline', async () => {
    const h = criarHarness({ statusAposPipeline: DocumentoFiscalStatus.PRONTA_PARA_COMPRA, comCompra: true });
    const arquivos = [];
    for (let i = 0; i < 27; i += 1) {
      const chave44 = `35260112345678000199${String(55001000000000 + i).padStart(20, '0')}`.replace(/\D/g, '').slice(0, 44).padEnd(44, '0');
      h.seed({
        id: i + 1,
        chave: chave44,
        status: DocumentoFiscalStatus.XML_INDISPONIVEL
      });
      arquivos.push({
        originalname: `legado-${i + 1}.xml`,
        buffer: Buffer.from(montarNfeProc({ chave: chave44 }))
      });
    }

    const rel = await h.service.executar(arquivos);
    assert.strictEqual(rel.xmlsEnviados, 27);
    assert.strictEqual(rel.documentosAlterados, 27);
    assert.strictEqual(rel.parserExecutado, 27);
    assert.ok(rel.comprasCriadas >= 1);
    assert.ok(rel.tempoTotalMs >= 0);
  });

  await test('XML duplicado no lote — segunda ocorrência rejeitada', async () => {
    const h = criarHarness();
    const chave = '35260112345678000199550010000000771000000077';
    h.seed({ id: 1, chave, status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO });
    const xml = montarNfeProc({ chave });
    const rel = await h.service.executar([
      { originalname: 'a.xml', buffer: Buffer.from(xml) },
      { originalname: 'b.xml', buffer: Buffer.from(xml) }
    ]);
    assert.strictEqual(rel.documentosAlterados, 1);
    assert.strictEqual(rel.xmlsDuplicadosLote, 1);
    assert.ok(rel.detalhes.some((d) => d.codigo === 'XML_DUPLICADO_LOTE'));
  });

  await test('XML inválido / resNFe / sem assinatura — rejeitados', async () => {
    const h = criarHarness();
    const chave = '35260112345678000199550010000000771000000077';
    h.seed({ id: 1, chave, status: DocumentoFiscalStatus.XML_INDISPONIVEL });

    const rel = await h.service.executar([
      { originalname: 'vazio.xml', buffer: Buffer.from('nao-e-xml') },
      { originalname: 'resumo.xml', buffer: Buffer.from('<resNFe xmlns="http://www.portalfiscal.inf.br/nfe"><chNFe>' + chave + '</chNFe></resNFe>') },
      { originalname: 'evento.xml', buffer: Buffer.from('<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe"></procEventoNFe>') },
      { originalname: 'danfe.html', buffer: Buffer.from('<!DOCTYPE html><html></html>') },
      { originalname: 'sem-ass.xml', buffer: Buffer.from(montarNfeProc({ chave, semAssinatura: true })) }
    ]);

    assert.strictEqual(rel.xmlsRejeitados, 5);
    assert.strictEqual(rel.documentosAlterados, 0);
    assert.strictEqual(h.processados.length, 0);
    assert.ok(rel.detalhes.every((d) => d.codigo !== 'IMPORTADO'));
  });

  await test('XML sem documento correspondente — não cria novo', async () => {
    const h = criarHarness();
    const chave = '35260112345678000199550010000000771000000077';
    const rel = await h.service.executar([
      { originalname: 'orfao.xml', buffer: Buffer.from(montarNfeProc({ chave })) }
    ]);
    assert.strictEqual(rel.documentosNaoEncontrados, 1);
    assert.strictEqual(rel.documentosAlterados, 0);
    assert.strictEqual(h.docs.size, 0);
  });

  await test('XML já existente / documento saudável — não substitui', async () => {
    const h = criarHarness();
    const chave = '35260112345678000199550010000000771000000077';
    h.seed({
      id: 1,
      chave,
      status: DocumentoFiscalStatus.GRAVADA,
      tipoDocumento: DocumentoDfeTipo.PROC_NFE,
      xml: montarNfeProc({ chave })
    });
    const rel = await h.service.executar([
      { originalname: 'dup.xml', buffer: Buffer.from(montarNfeProc({ chave })) }
    ]);
    assert.strictEqual(rel.documentosAlterados, 0);
    assert.ok(rel.detalhes[0].codigo === 'DOCUMENTO_SAUDAVEL' || rel.detalhes[0].codigo === 'XML_JA_EXISTENTE');
    assert.strictEqual(h.processados.length, 0);
  });

  await test('dry-run — localiza sem persistir nem chamar Parser', async () => {
    const h = criarHarness();
    const chave = '35260112345678000199550010000000771000000077';
    h.seed({ id: 1, chave, status: DocumentoFiscalStatus.XML_INDISPONIVEL });
    const rel = await h.service.analisar([
      { originalname: 'dry.xml', buffer: Buffer.from(montarNfeProc({ chave })) }
    ]);
    assert.strictEqual(rel.dryRun, true);
    assert.strictEqual(rel.documentosEncontrados, 1);
    assert.strictEqual(rel.documentosAlterados, 0);
    assert.strictEqual(h.docs.get(1).status, DocumentoFiscalStatus.XML_INDISPONIVEL);
    assert.strictEqual(h.processados.length, 0);
    assert.ok(rel.detalhes[0].codigo === 'PRONTO_PARA_IMPORTAR');
  });

  await test('CNPJ destinatário divergente — rejeita', async () => {
    const h = criarHarness();
    const chave = '35260112345678000199550010000000771000000077';
    h.seed({ id: 1, chave, status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO });
    const rel = await h.service.executar([
      {
        originalname: 'cnpj.xml',
        buffer: Buffer.from(montarNfeProc({ chave, cnpjDest: '11111111000111' }))
      }
    ]);
    assert.strictEqual(rel.documentosAlterados, 0);
    assert.strictEqual(rel.detalhes[0].codigo, 'CNPJ_DESTINATARIO_DIVERGENTE');
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
