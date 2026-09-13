/**
 * Testes — RC6.3 Atualização com XML completo (sem duplicidade)
 *
 * Executar: npm run test:central-entradas-rc6.3
 */

const assert = require('assert');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../../backend/motores/central-entradas/core/DocumentoDfeTipo');
const CentralDfePersistenciaService = require('../../backend/motores/central-entradas/services/CentralDfePersistenciaService');
const CentralDocumentoAtualizacaoService = require('../../backend/motores/central-entradas/services/CentralDocumentoAtualizacaoService');
const DocumentoTransitionService = require('../../backend/motores/central-entradas/services/DocumentoTransitionService');

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

const CHAVE = '23260707196033002141550090012840571375100827';

const XML_RES_NFE = `<?xml version="1.0"?>
<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
  <chNFe>${CHAVE}</chNFe>
  <CNPJ>07196033002141</CNPJ>
  <xNome>FORNECEDOR TESTE</xNome>
  <dhEmi>2026-07-10T10:00:00-03:00</dhEmi>
  <vNF>100.00</vNF>
</resNFe>`;

const XML_PROC_NFE = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe${CHAVE}">
      <ide><nNF>1284057</nNF><serie>9</serie><mod>55</mod><dhEmi>2026-07-10T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>07196033002141</CNPJ><xNome>FORNECEDOR COMPLETO</xNome></emit>
      <total><ICMSTot><vNF>250.50</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>`;

const XML_PROC_NOVO = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe23260707196033002141550090012840571375100999">
      <ide><nNF>999</nNF><serie>1</serie><mod>55</mod><dhEmi>2026-07-10T11:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>07196033002141</CNPJ><xNome>OUTRO</xNome></emit>
      <total><ICMSTot><vNF>10.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>`;

function criarMemoria() {
  const docs = new Map();
  let seq = 1;
  const historico = [];

  const documentosRepository = {
    buscarPorChave: async (chave) => {
      for (const d of docs.values()) {
        if (d.chave === chave) return { ...d };
      }
      return null;
    },
    buscarPorId: async (id) => {
      const d = docs.get(Number(id));
      return d ? { ...d } : null;
    },
    inserir: async (dados) => {
      const doc = {
        id: seq++,
        createdAt: '2026-07-11T01:00:00.000Z',
        updatedAt: '2026-07-11T01:00:00.000Z',
        parseJson: null,
        miipSessaoId: null,
        miipResumoJson: null,
        processadoEm: null,
        compraId: null,
        ...dados
      };
      docs.set(doc.id, doc);
      return { ...doc };
    },
    atualizar: async (id, patch) => {
      const doc = docs.get(Number(id));
      if (!doc) return null;
      Object.assign(doc, patch, { updatedAt: new Date().toISOString() });
      return { ...doc };
    },
    listarPendentesProcessamento: async () => [...docs.values()]
      .filter((d) => d.status === DocumentoFiscalStatus.SINCRONIZADA && !d.parseJson)
      .map((d) => ({ ...d })),
    _docs: docs
  };

  const historicoRepository = {
    inserir: async (row) => {
      const item = { id: historico.length + 1, ...row };
      historico.push(item);
      return item;
    },
    _rows: historico
  };

  const historicoService = {
    registrar: async (dados) => historicoRepository.inserir(dados)
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

  const persistencia = new CentralDfePersistenciaService({
    documentosRepository,
    historicoRepository,
    atualizacaoService,
    transitionService
  });
  persistencia.existeCompraComChave = async () => false;

  return { persistencia, documentosRepository, historicoRepository, docs };
}

async function main() {
  console.log('\n=== Testes RC6.3 — XML completo sem duplicidade ===\n');

  await test('RES_NFE continua AGUARDANDO_XML_COMPLETO', async () => {
    const { persistencia } = criarMemoria();
    const r = await persistencia.persistirDocumentoDfe({ xml: XML_RES_NFE, origem: 'dfe' });
    assert.strictEqual(r.documento.status, DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO);
    assert.strictEqual(r.atualizado, false);
  });

  await test('PROC_NFE sobre RES_NFE atualiza o mesmo id (sem duplicidade)', async () => {
    const { persistencia, docs, historicoRepository } = criarMemoria();

    const resumo = await persistencia.persistirDocumentoDfe({
      xml: XML_RES_NFE,
      nsu: '10',
      origem: 'dfe'
    });
    const idOriginal = resumo.documento.id;
    assert.strictEqual(docs.size, 1);

    const completo = await persistencia.persistirDocumentoDfe({
      xml: XML_PROC_NFE,
      nsu: '11',
      origem: 'dfe'
    });

    assert.strictEqual(completo.atualizado, true);
    assert.strictEqual(completo.duplicado, false);
    assert.strictEqual(completo.novo, false);
    assert.strictEqual(completo.documento.id, idOriginal);
    assert.strictEqual(docs.size, 1);
    assert.strictEqual(completo.documento.status, DocumentoFiscalStatus.SINCRONIZADA);
    assert.strictEqual(completo.documento.tipoDocumento, DocumentoDfeTipo.PROC_NFE);
    assert.ok(String(completo.documento.xml).includes('nfeProc'));
    assert.strictEqual(completo.documento.nsu, '11');
    assert.ok(String(completo.documento.fornecedor || '').includes('COMPLETO'));

    const detalhes = historicoRepository._rows.map((h) => h.detalhe);
    assert.ok(detalhes.includes(CentralDfePersistenciaService.DETALHE_RES_NFE));
    assert.ok(detalhes.includes(CentralDocumentoAtualizacaoService.DETALHE_XML_COMPLETO));
    assert.ok(detalhes.includes(CentralDocumentoAtualizacaoService.DETALHE_DOCUMENTO_ATUALIZADO));
  });

  await test('histórico anterior é preservado após atualização', async () => {
    const { persistencia, historicoRepository } = criarMemoria();
    await persistencia.persistirDocumentoDfe({ xml: XML_RES_NFE, origem: 'dfe' });
    const antes = historicoRepository._rows.length;
    await persistencia.persistirDocumentoDfe({ xml: XML_PROC_NFE, origem: 'dfe' });
    assert.ok(historicoRepository._rows.length > antes);
    assert.strictEqual(
      historicoRepository._rows[0].detalhe,
      CentralDfePersistenciaService.DETALHE_RES_NFE
    );
  });

  await test('após atualização documento entra na fila do pipeline (SINCRONIZADA)', async () => {
    const { persistencia, documentosRepository } = criarMemoria();
    await persistencia.persistirDocumentoDfe({ xml: XML_RES_NFE, origem: 'dfe' });
    assert.strictEqual((await documentosRepository.listarPendentesProcessamento()).length, 0);

    await persistencia.persistirDocumentoDfe({ xml: XML_PROC_NFE, origem: 'dfe' });
    const pendentes = await documentosRepository.listarPendentesProcessamento();
    assert.strictEqual(pendentes.length, 1);
    assert.strictEqual(pendentes[0].status, DocumentoFiscalStatus.SINCRONIZADA);
  });

  await test('PROC_NFE novo (sem RES_NFE) continua insert SINCRONIZADA', async () => {
    const { persistencia, docs } = criarMemoria();
    const r = await persistencia.persistirDocumentoDfe({ xml: XML_PROC_NOVO, origem: 'dfe' });
    assert.strictEqual(r.novo, true);
    assert.strictEqual(r.atualizado, false);
    assert.strictEqual(r.documento.status, DocumentoFiscalStatus.SINCRONIZADA);
    assert.strictEqual(docs.size, 1);
  });

  await test('segundo PROC_NFE da mesma chave não cria outro documento', async () => {
    const { persistencia, docs } = criarMemoria();
    await persistencia.persistirDocumentoDfe({ xml: XML_RES_NFE, origem: 'dfe' });
    await persistencia.persistirDocumentoDfe({ xml: XML_PROC_NFE, origem: 'dfe' });
    const segundo = await persistencia.persistirDocumentoDfe({ xml: XML_PROC_NFE, origem: 'dfe' });
    assert.strictEqual(segundo.duplicado, true);
    assert.strictEqual(docs.size, 1);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
