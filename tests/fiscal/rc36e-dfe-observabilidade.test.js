/**
 * RC3.6.E — Observabilidade do Motor DF-e
 * Executar: node tests/fiscal/rc36e-dfe-observabilidade.test.js
 */

'use strict';

const assert = require('assert');
const zlib = require('zlib');
const path = require('path');

const {
  DfeAuditoriaResultado,
  DfeAuditoriaEtapa,
  criarCorrelationIdDfeSync
} = require('../../backend/services/fiscal/dfeAuditoriaConstantes');
const { DfeAuditoriaService } = require('../../backend/services/fiscal/DfeAuditoriaService');
const { extrairDocumentosZip } = require('../../backend/services/fiscal/dfeRetornoParser');

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

function montarDocZip({ nsu, schema, xml }) {
  const compactado = zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
  return `<docZip NSU="${nsu}" schema="${schema}">${compactado}</docZip>`;
}

async function main() {
  console.log('\n=== RC3.6.E — Observabilidade Motor DF-e ===\n');

  await test('Correlation ID segue SYNC-YYYYMMDD-HHMMSS-XXX', async () => {
    const id = criarCorrelationIdDfeSync();
    assert.match(id, /^SYNC-\d{8}-\d{6}-\d{3}$/);
  });

  await test('Resultados canônicos da sprint estão definidos', async () => {
    const esperados = [
      'PROCESSADO', 'RESUMO', 'XML_COMPLETO', 'EVENTO', 'DUPLICADO', 'IGNORADO',
      'ERRO_ZIP', 'ERRO_PARSER', 'ERRO_SCHEMA', 'ERRO_BANCO', 'SEM_XML', 'SEM_RESUMO', 'DESCONHECIDO'
    ];
    esperados.forEach((r) => {
      assert.strictEqual(DfeAuditoriaResultado[r], r);
    });
    assert.ok(DfeAuditoriaEtapa.CONSULTA);
    assert.ok(DfeAuditoriaEtapa.ZIP);
    assert.ok(DfeAuditoriaEtapa.PARSER);
    assert.ok(DfeAuditoriaEtapa.PERSISTENCIA);
    assert.ok(DfeAuditoriaEtapa.NSU);
  });

  await test('ZIP/evento/schema descartados geram onDescarte (sem sumir em silêncio)', async () => {
    const chave = '35200112345678000190550010000000011000000011';
    const xmlNfe = `<?xml version="1.0"?><nfeProc><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${chave}"></infNFe></NFe></nfeProc>`;
    const xmlEvt = `<?xml version="1.0"?><procEventoNFe><evento><infEvento><chNFe>${chave}</chNFe></infEvento></evento></procEventoNFe>`;
    const xmlLixo = 'nao-e-xml-fiscal';

    const soap = `
<retDistDFeInt>
  <loteDistDFeInt>
    ${montarDocZip({ nsu: '10', schema: 'procNFe_v4.00.xsd', xml: xmlNfe })}
    ${montarDocZip({ nsu: '11', schema: 'procEventoNFe_v1.00.xsd', xml: xmlEvt })}
    <docZip NSU="12" schema="desconhecido_v1.xsd">QUJD</docZip>
    <docZip NSU="13" schema="x.xsd"></docZip>
  </loteDistDFeInt>
</retDistDFeInt>`;

    const descartes = [];
    const docs = extrairDocumentosZip(soap, {
      onDescarte: (evt) => descartes.push(evt)
    });

    assert.strictEqual(docs.length, 1, 'apenas NF deve persistir');
    assert.strictEqual(docs[0].nsu, '000000000000010');
    assert.ok(descartes.length >= 3, 'eventos/erros devem ser registrados');
    assert.ok(descartes.some((d) => d.resultado === 'EVENTO'));
    assert.ok(descartes.some((d) => d.resultado === 'ERRO_ZIP'));
    assert.ok(descartes.every((d) => d.motivo), 'todo descarte precisa de motivo');
  });

  await test('DfeAuditoriaService.exportar gera CSV e JSON', async () => {
    const memoria = [];
    const svc = new DfeAuditoriaService();
    // stub listar sem depender do DB de produção
    svc.listar = async () => ({
      itens: [{
        id: 1,
        correlation_id: 'SYNC-20260728-153015-001',
        empresa_id: null,
        cnpj: '47123456000199',
        ambiente: 1,
        nsu: '263',
        tipo: 'PERSISTENCIA',
        schema: 'resNFe_v1.01',
        chave: '35200112345678000190550010000000011000000011',
        resultado: 'PROCESSADO',
        motivo: 'INSERT',
        tempo_ms: 12,
        created_at: '2026-07-28 15:30:16'
      }],
      total: 1
    });

    const csv = await svc.exportar({}, 'csv');
    assert.ok(csv.contentType.includes('csv'));
    assert.ok(csv.body.includes('correlation_id'));
    assert.ok(csv.body.includes('PROCESSADO'));

    const json = await svc.exportar({}, 'json');
    assert.ok(json.contentType.includes('json'));
    const parsed = JSON.parse(json.body);
    assert.strictEqual(parsed.total, 1);
    assert.strictEqual(parsed.itens[0].nsu, '263');
    memoria.push(csv, json);
    assert.strictEqual(memoria.length, 2);
  });

  await test('Rotas e UI de auditoria DF-e existem', async () => {
    const fs = require('fs');
    const root = path.join(__dirname, '../..');
    assert.ok(fs.existsSync(path.join(root, 'backend/rotas/dfe-auditoria.js')));
    assert.ok(fs.existsSync(path.join(root, 'frontend/erp/pages/dfe-auditoria.html')));
    assert.ok(fs.existsSync(path.join(root, 'frontend/erp/js/dfe-auditoria.js')));
    const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
    assert.ok(server.includes('/api/dfe-auditoria'));
    const database = fs.readFileSync(path.join(root, 'backend/database.js'), 'utf8');
    assert.ok(database.includes('CREATE TABLE IF NOT EXISTS dfe_auditoria'));
  });

  await test('distribuicaoDFe instrumenta Correlation ID e auditoria', async () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fiscal/distribuicaoDFe.js'),
      'utf8'
    );
    assert.ok(src.includes('criarCorrelationIdDfeSync'));
    assert.ok(src.includes('registrarConsulta'));
    assert.ok(src.includes('registrarNsuAvanco'));
    assert.ok(src.includes('registrarResumoSync'));
    assert.ok(src.includes('onDescarte'));
    assert.ok(src.includes('[DFE][SYNC]'));
  });

  console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
  if (falhas > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
