/**
 * RC3.7.1 — Máquina de estados + filas + metadados DistDFe
 * Executar: node tests/central-entradas/rc371-maquina-estados.test.js
 */

'use strict';

const assert = require('assert');
const zlib = require('zlib');
const {
  DocumentoFiscalStatus,
  normalizarStatus,
  MAPA_MIGRACAO_STATUS,
  isTerminal
} = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const {
  podeTransicionar,
  validarTransicao,
  ehAplicacaoXmlCompleto
} = require('../../backend/motores/central-entradas/core/MaquinaEstadosDocumento');
const {
  FILAS,
  filasSaoDisjuntas,
  montarContadoresFilas,
  contarFila
} = require('../../backend/motores/central-entradas/core/FilasEstadosCentral');
const {
  extrairMetadadosNota,
  extrairNumeroSerieDaChave,
  detectarNfCancelada
} = require('../../backend/services/fiscal/dfeXmlMetadados');
const { extrairDocumentosZip } = require('../../backend/services/fiscal/dfeRetornoParser');
const CentralDocumentoAtualizacaoService = require('../../backend/motores/central-entradas/services/CentralDocumentoAtualizacaoService');

const S = DocumentoFiscalStatus;
let ok = 0;
let falhas = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      ok += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((err) => {
      falhas += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${err.message}`);
    });
}

async function main() {
  console.log('\n=== RC3.7.1 — Máquina de Estados Central ===\n');

  await test('Aliases legados apontam para canônicos', async () => {
    assert.strictEqual(S.SINCRONIZADA, S.XML_COMPLETO);
    assert.strictEqual(S.AGUARDANDO_XML_COMPLETO, S.RESUMO_RECEBIDO);
    assert.strictEqual(S.AGUARDANDO_REVISAO, S.EM_REVISAO);
    assert.strictEqual(S.GRAVADA, S.IMPORTADA);
    assert.strictEqual(S.EM_COMPRA, S.EM_IMPORTACAO);
    assert.strictEqual(normalizarStatus('SINCRONIZADA'), 'XML_COMPLETO');
    assert.strictEqual(MAPA_MIGRACAO_STATUS.GRAVADA, 'IMPORTADA');
  });

  await test('Filas são mutuamente exclusivas', async () => {
    assert.strictEqual(filasSaoDisjuntas(), true);
    const todos = new Set();
    Object.values(FILAS).forEach((f) => f.statusIn.forEach((st) => todos.add(st)));
    assert.ok(todos.has(S.CANCELADA));
    assert.ok(todos.has(S.IMPORTADA));
    assert.ok(!FILAS.pendentes.statusIn.includes(S.EM_IMPORTACAO));
    assert.ok(!FILAS.pendentes.statusIn.includes(S.IMPORTADA));
  });

  await test('KPIs usam a mesma regra das filas', async () => {
    const por = {
      RESUMO_RECEBIDO: 2,
      XML_COMPLETO: 3,
      EM_REVISAO: 5,
      PRONTA_IMPORTACAO: 1,
      IMPORTADA: 4,
      CANCELADA: 2,
      ERRO: 1,
      XML_INDISPONIVEL: 27
    };
    const c = montarContadoresFilas(por);
    assert.strictEqual(c.pendentes, contarFila(por, 'pendentes'));
    assert.strictEqual(c.em_revisao, 5);
    assert.strictEqual(c.prontas, 1);
    assert.strictEqual(c.importadas, 4);
    assert.strictEqual(c.canceladas, 2);
    assert.strictEqual(c.erro, 28);
    assert.strictEqual(c.aguardandoRevisao, c.em_revisao);
    assert.strictEqual(c.prontasParaCompra, c.prontas);
    assert.strictEqual(c.gravadas, c.importadas);
  });

  await test('RESUMO → XML_COMPLETO e XML_INDISPONIVEL → XML_COMPLETO', async () => {
    assert.strictEqual(ehAplicacaoXmlCompleto(S.RESUMO_RECEBIDO, S.XML_COMPLETO), true);
    assert.strictEqual(ehAplicacaoXmlCompleto(S.XML_INDISPONIVEL, S.XML_COMPLETO), true);
    assert.strictEqual(podeTransicionar(S.RESUMO_RECEBIDO, S.XML_COMPLETO), true);
    assert.strictEqual(podeTransicionar(S.XML_INDISPONIVEL, S.XML_COMPLETO), true);
    assert.strictEqual(CentralDocumentoAtualizacaoService.STATUS_ORIGEM_XML_COMPLETO
      .map(normalizarStatus)
      .includes(S.XML_INDISPONIVEL), true);
  });

  await test('Evento 110111 → transição CANCELADA permitida', async () => {
    assert.strictEqual(podeTransicionar(S.EM_REVISAO, S.CANCELADA), true);
    assert.strictEqual(podeTransicionar(S.PRONTA_IMPORTACAO, S.CANCELADA), true);
    assert.strictEqual(podeTransicionar(S.XML_COMPLETO, S.CANCELADA), true);
    assert.strictEqual(validarTransicao(S.CANCELADA, S.EM_REVISAO).valido, false);
    assert.strictEqual(isTerminal(S.CANCELADA), true);
  });

  await test('IMPORTADA não está em pendentes; ciclo importação ok', async () => {
    assert.strictEqual(podeTransicionar(S.PRONTA_IMPORTACAO, S.EM_IMPORTACAO), true);
    assert.strictEqual(podeTransicionar(S.EM_IMPORTACAO, S.IMPORTADA), true);
    assert.ok(!FILAS.pendentes.statusIn.includes(S.IMPORTADA));
    assert.ok(FILAS.importadas.statusIn.includes(S.IMPORTADA));
  });

  await test('nNF derivado da chave quando ausente no XML', async () => {
    const chave = '35200112345678000190550010000001231000000011';
    const { numero, serie } = extrairNumeroSerieDaChave(chave);
    assert.strictEqual(numero, '123');
    assert.strictEqual(serie, '1');
    const meta = extrairMetadadosNota(`<resNFe><chNFe>${chave}</chNFe><vNF>10.00</vNF></resNFe>`);
    assert.strictEqual(meta.numero, '123');
    assert.ok(meta.numero !== '');
  });

  await test('detectarNfCancelada reconhece 110111', async () => {
    const xml = '<procEventoNFe><infEvento><tpEvento>110111</tpEvento><chNFe>35200112345678000190550010000001231000000011</chNFe></infEvento></procEventoNFe>';
    assert.strictEqual(detectarNfCancelada(xml), true);
  });

  await test('STATUS_ORIGEM inclui XML_INDISPONIVEL (não descarta procNFe)', async () => {
    const origens = CentralDocumentoAtualizacaoService.STATUS_ORIGEM_XML_COMPLETO.map(normalizarStatus);
    assert.ok(origens.includes('RESUMO_RECEBIDO'));
    assert.ok(origens.includes('XML_INDISPONIVEL'));
  });

  await test('Evento no zip é reportado com xml para aplicação', async () => {
    const evtXml = '<?xml version="1.0"?><procEventoNFe><infEvento><tpEvento>110111</tpEvento><chNFe>35200112345678000190550010000001231000000011</chNFe></infEvento></procEventoNFe>';
    const compactado = zlib.gzipSync(Buffer.from(evtXml, 'utf8')).toString('base64');
    const soap = `<retDistDFeInt><loteDistDFeInt><docZip NSU="99" schema="procEventoNFe_v1.00.xsd">${compactado}</docZip></loteDistDFeInt></retDistDFeInt>`;
    const descartes = [];
    const docs = extrairDocumentosZip(soap, { onDescarte: (e) => descartes.push(e) });
    assert.strictEqual(docs.length, 0);
    assert.ok(descartes.some((d) => d.resultado === 'EVENTO' && d.xml));
  });

  console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
  if (falhas > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
