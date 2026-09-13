/**
 * RC4.31.3 — Duplicatas NF-e (cobr/dup) → parcelas com vencimento
 * Executar: node tests/compras/rc4313-duplicatas-vencimento-nfe.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  extrairCobranca,
  montarImportacaoFinanceiraNfe
} = require(path.join(ROOT, 'backend/services/compras/ImportacaoFinanceiraNfe'));
const { normalizarParcelasDetalhe } = require(path.join(ROOT, 'backend/services/compras/MotorParcelamentoCompra'));

let ok = 0;
let falhas = 0;

function test(nome, fn) {
  try {
    fn();
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FAIL  ${nome}`);
    console.error(`       ${err.message}`);
  }
}

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('\n=== RC4.31.3 — Duplicatas / vencimentos NF-e ===\n');

test('extrairCobranca lê nDup, dVenc e vDup', () => {
  const { duplicatas } = extrairCobranca({
    fat: { nFat: '123', vOrig: '3750.00', vLiq: '3750.00' },
    dup: [
      { nDup: '001', dVenc: '2026-08-15', vDup: '1250.00' },
      { nDup: '002', dVenc: '2026-09-15', vDup: '1250.00' },
      { nDup: '003', dVenc: '2026-10-15', vDup: '1250.00' }
    ]
  });
  assert.strictEqual(duplicatas.length, 3);
  assert.strictEqual(duplicatas[0].numero, '001');
  assert.strictEqual(duplicatas[0].vencimento, '2026-08-15');
  assert.strictEqual(duplicatas[2].valor, 1250);
});

test('montarImportacaoFinanceiraNfe gera parcelas_detalhe à prazo', () => {
  const fin = montarImportacaoFinanceiraNfe({
    pag: { detPag: { tPag: '15', vPag: '3750.00', indPag: '1' } },
    cobr: {
      dup: [
        { nDup: '001', dVenc: '2026-01-10', vDup: '100.00' },
        { nDup: '002', dVenc: '2026-02-10', vDup: '100.00' }
      ]
    },
    icmsTot: { vNF: '200.00', vProd: '200.00' }
  });
  assert.strictEqual(fin.condicao_pagamento, 'prazo');
  assert.strictEqual(fin.parcelas_detalhe.length, 2);
  assert.strictEqual(fin.parcelas_detalhe[0].documento, '001');
  assert.strictEqual(fin.parcelas_detalhe[1].vencimento, '2026-02-10');
  assert.strictEqual(fin.data_vencimento, '2026-01-10');
});

test('6 e 12 parcelas preservam vencimentos distintos', () => {
  const dup = Array.from({ length: 12 }, (_, i) => ({
    nDup: String(i + 1).padStart(3, '0'),
    dVenc: `2026-${String(i + 1).padStart(2, '0')}-10`,
    vDup: '100.00'
  }));
  const fin = montarImportacaoFinanceiraNfe({ cobr: { dup }, icmsTot: { vNF: '1200.00' } });
  assert.strictEqual(fin.parcelas_detalhe.length, 12);
  assert.strictEqual(fin.parcelas_detalhe[11].vencimento, '2026-12-10');
});

test('XML sem cobr → à vista sem parcelas', () => {
  const fin = montarImportacaoFinanceiraNfe({
    pag: { detPag: { tPag: '01', vPag: '500.00' } },
    cobr: null,
    icmsTot: { vNF: '500.00' }
  });
  assert.strictEqual(fin.condicao_pagamento, 'avista');
  assert.strictEqual(fin.parcelas_detalhe.length, 0);
});

test('normalizarParcelasDetalhe preserva documento e dVenc', () => {
  const grade = normalizarParcelasDetalhe([
    { numero: 1, documento: '001', vencimento: '2026-07-28', valor: 250 },
    { nDup: '002', dVenc: '2026-08-27', vDup: '250.00' }
  ]);
  assert.strictEqual(grade.length, 2);
  assert.strictEqual(grade[0].documento, '001');
  assert.strictEqual(grade[1].vencimento, '2026-08-27');
});

test('UI compras preserva grade XML importada (não recalcula)', () => {
  const src = ler('frontend/erp/js/compras.js');
  assert.match(src, /parcelasImportadasXml/);
  assert.match(src, /parcelasImportadasXml \|\| parcelasCompraEditadasManual/);
});

test('Central bridge re-enriquece quando faltam vencimentos', () => {
  const src = ler('backend/motores/central-entradas/services/CentralComprasBridgeService.js');
  assert.match(src, /financeiroPayloadCompleto/);
  assert.doesNotMatch(src, /gradeComVencimento\) return payload/);
});

test('financeiro usa documento da duplicata', () => {
  const src = ler('backend/rotas/compras.js');
  assert.match(src, /payload\.documento \|\| documentoNf/);
});

console.log(`\n${ok} ok, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
