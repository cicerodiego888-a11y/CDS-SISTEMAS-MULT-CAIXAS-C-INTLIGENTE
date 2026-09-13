/**
 * RC9.0 — Entrada Simplificada (Uso e Consumo)
 * Executar: node tests/compras/rc90-uso-consumo.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  TIPO_ENTRADA,
  TIPO_ENTRADA_PADRAO,
  normalizarTipoEntrada,
  resolverPolitica,
  isUsoConsumo
} = require('../../backend/services/compras/PoliticaEntradaCompra');
const {
  classificarFluxoCompra,
  validarCriacaoCompra
} = require('../../backend/services/compras/MotorPoliticaEntradaCompra');

const ROOT = path.join(__dirname, '../..');
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

console.log('\n=== RC9.0 — Uso e Consumo ===\n');

test('PoliticaEntradaCompra existe', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/compras/PoliticaEntradaCompra.js')));
  assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/compras/MotorPoliticaEntradaCompra.js')));
});

test('tipo_entrada padrão REVENDA', () => {
  assert.strictEqual(normalizarTipoEntrada(null), TIPO_ENTRADA.REVENDA);
  assert.strictEqual(normalizarTipoEntrada(''), TIPO_ENTRADA_PADRAO);
});

test('normaliza USO_CONSUMO', () => {
  assert.strictEqual(normalizarTipoEntrada('USO_CONSUMO'), TIPO_ENTRADA.USO_CONSUMO);
  assert.strictEqual(normalizarTipoEntrada('uso e consumo'), TIPO_ENTRADA.USO_CONSUMO);
});

test('política USO_CONSUMO desliga estoque e produtos', () => {
  const p = resolverPolitica(TIPO_ENTRADA.USO_CONSUMO);
  assert.strictEqual(p.executarEstoque, false);
  assert.strictEqual(p.executarCadastroProdutos, false);
  assert.strictEqual(p.executarMiip, false);
  assert.strictEqual(p.executarItensOperacionais, false);
  assert.strictEqual(p.executarFinanceiro, true);
  assert.strictEqual(p.executarFiscal, true);
});

test('política REVENDA mantém estoque', () => {
  const p = resolverPolitica(TIPO_ENTRADA.REVENDA);
  assert.strictEqual(p.executarEstoque, true);
  assert.strictEqual(p.executarItensOperacionais, true);
});

test('classificarFluxoCompra — uso consumo simplificado', () => {
  const f = classificarFluxoCompra({ tipo_entrada: 'USO_CONSUMO', total: 100, itens: [] });
  assert.strictEqual(f.tipoEntrada, TIPO_ENTRADA.USO_CONSUMO);
  assert.strictEqual(f.entradaSimplificada, true);
  assert.strictEqual(f.deveProcessarItens, false);
});

test('validarCriacaoCompra aceita uso consumo sem itens', () => {
  const v = validarCriacaoCompra({ tipo_entrada: 'USO_CONSUMO', total: 500, itens: [] });
  assert.strictEqual(v.ok, true);
});

test('validarCriacaoCompra exige itens para revenda', () => {
  const v = validarCriacaoCompra({ tipo_entrada: 'REVENDA', total: 500, itens: [] });
  assert.strictEqual(v.ok, false);
});

test('database.js migra tipo_entrada', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
  assert.match(src, /tipo_entrada TEXT DEFAULT 'REVENDA'/);
});

test('compras.js persiste tipo_entrada e rota relatório', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');
  assert.match(src, /tipo_entrada/);
  assert.match(src, /relatorio\/uso-consumo/);
  assert.match(src, /USO_CONSUMO/);
});

test('cancelamento pula estoque para USO_CONSUMO', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');
  assert.match(src, /pularEstoque/);
  assert.match(src, /tipoEntrada === 'USO_CONSUMO'/);
});

test('UI compras — seletor política após XML', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
  assert.match(src, /mostrarDialogoPoliticaEntrada/);
  assert.match(src, /Compra para Uso e Consumo/);
  assert.match(src, /tipo_entrada/);
  assert.match(src, /abrirRelatorioUsoConsumo/);
});

test('Central — badge USO E CONSUMO', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/central-entradas.js'), 'utf8');
  assert.match(src, /renderBadgeUsoConsumoCentral/);
  assert.match(src, /USO E CONSUMO/);
});

test('isUsoConsumo helper', () => {
  assert.strictEqual(isUsoConsumo('USO_CONSUMO'), true);
  assert.strictEqual(isUsoConsumo('REVENDA'), false);
});

console.log(`\n--- Resultado: ${ok} OK, ${falhas} falha(s) ---\n`);
if (falhas > 0) process.exit(1);
