/**
 * RC4.31.2 — Confirmar Associação + adicionar após editar item
 * Executar: node tests/compras/rc4312-central-fluxos.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const MiipImportacaoXmlService = require('../../backend/motores/miip/services/MiipImportacaoXmlService');

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

console.log('\n=== RC4.31.2 — Fluxos Central / Compras ===\n');

test('BUG1: aplicarMiipImportacaoXml cria miip_sugestao mesmo sem draft prévio', () => {
  const src = ler('frontend/erp/js/compras.js');
  assert.match(src, /montarSugestaoMiipCompraFromResultado/);
  assert.match(src, /if \(resultado\.precisaConfirmacao\)/);
  assert.doesNotMatch(
    src,
    /if \(resultado\.precisaConfirmacao && draft\.miip_sugestao\)/
  );
});

test('BUG1: confirmarAssociacaoMiip não retorna silenciosamente', () => {
  const src = ler('frontend/erp/js/compras.js');
  assert.match(src, /function confirmarAssociacaoMiip[\s\S]*showNotification\('Associação confirmada\./);
  assert.match(src, /function confirmarAssociacaoMiip[\s\S]*Não há sugestão de produto válida/);
  assert.match(src, /extrairProdutoIdSugestaoMiip/);
});

test('BUG1: paraSugestaoUi backend alinha com montarSugestaoMiipCompraFromResultado', () => {
  const resultado = {
    indice: 0,
    precisaConfirmacao: true,
    produtoEncontrado: { id: 42, nome: 'Produto Teste', codigo: 'P42' },
    motor: 'motor_gtin',
    nivelCerteza: 'ALTA',
    score: 95,
    acao: 'confirmar',
    operacaoId: 'op-1'
  };
  const ui = MiipImportacaoXmlService.paraSugestaoUi(resultado);
  assert.strictEqual(ui.produtoId, 42);
  assert.strictEqual(ui.encontrado, true);
  assert.strictEqual(ui.status, 'pendente');
});

test('BUG2: limparDraftCompra reseta modoEntradaF7Compra', () => {
  const src = ler('frontend/erp/js/compras.js');
  assert.match(src, /function limparDraftCompra[\s\S]*modoEntradaF7Compra = false/);
  assert.match(src, /function limparFormularioItemCompra[\s\S]*modoEntradaF7Compra = false/);
  assert.match(src, /atualizarRotuloBotaoItemCompra/);
  assert.match(src, /id="btnAdicionarItemCompra"/);
});

console.log(`\n${ok} ok, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
