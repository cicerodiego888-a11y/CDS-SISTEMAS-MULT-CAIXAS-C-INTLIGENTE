/**
 * RC4.31.19 — Unificação Quantidade Comercial × Convertida
 * Executar: npm run test:compras-rc43119
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const motor = require('../../backend/lib/motorConversaoUnidades');
const comprasJs = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
const motorFront = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/motor-quantidade-compra.js'), 'utf8');
const conversaoDto = fs.readFileSync(
  path.join(ROOT, 'backend/motores/muc/dto/ConversaoDTO.js'),
  'utf8'
);

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

console.log('\n=== RC4.31.19 — Unificação Quantidade Comercial × Convertida ===\n');

test('ETAPA 2 — motor expõe obterQuantidadeComercial e obterQuantidadeConvertida', () => {
  assert.strictEqual(typeof motor.obterQuantidadeComercial, 'function');
  assert.strictEqual(typeof motor.obterQuantidadeConvertida, 'function');
  assert.strictEqual(typeof motor.validarConsistenciaQuantidadesItemCompra, 'function');
});

test('ETAPA 2 — frontend carrega motor-quantidade-compra.js', () => {
  assert.match(motorFront, /function obterQuantidadeConvertida/);
  assert.match(comprasJs, /motor-quantidade-compra\.js/);
  assert.match(comprasJs, /obterQuantidadeConvertidaItemCompra/);
});

test('ETAPA 3 — ConversaoDTO não usa item.quantidade como comercial', () => {
  assert.match(conversaoDto, /quantidade_comercial/);
  assert.doesNotMatch(conversaoDto, /item\.quantidade_embalagens \?\? item\.quantidade/);
});

test('Cenário UC — 10 Varas × 6 MT = 60 MT', () => {
  const item = {
    produto_fracionado: 1,
    quantidade_comercial: 10,
    quantidade_embalagens: 10,
    quantidade_por_embalagem: 6,
    unidade: 'MT'
  };
  assert.strictEqual(motor.obterQuantidadeComercial(item), 10);
  assert.strictEqual(motor.obterQuantidadeConvertida(item), 60);
  const qtds = motor.resolverQuantidadesEstoqueCompraItem({
    ...item,
    quantidade_fiscal: 60,
    quantidade_nao_fiscal: 0
  });
  assert.strictEqual(qtds.quantidade_convertida, 60);
  assert.strictEqual(qtds.quantidade_fiscal, 60);
});

test('Cenário Caixa — 2 CX × 24 UN = 48 UN', () => {
  const item = {
    quantidade_comercial: 2,
    quantidade_embalagens: 2,
    quantidade_por_embalagem: 24,
    unidade: 'UN'
  };
  assert.strictEqual(motor.obterQuantidadeConvertida(item), 48);
});

test('Cenário Pacote — 3 PCT × 10 UN = 30 UN', () => {
  const item = {
    quantidade_comercial: 3,
    quantidade_embalagens: 3,
    quantidade_por_embalagem: 10
  };
  assert.strictEqual(motor.obterQuantidadeConvertida(item), 30);
});

test('Cenário sem embalagem — 15 UN = 15 UN', () => {
  const item = { quantidade_comercial: 15, quantidade: 15 };
  assert.strictEqual(motor.obterQuantidadeComercial(item), 15);
  assert.strictEqual(motor.obterQuantidadeConvertida(item), 15);
});

test('ETAPA 6 — validação fiscal rejeita fiscal comercial em vez de convertida', () => {
  const item = {
    produto_fracionado: 1,
    quantidade_comercial: 10,
    quantidade_embalagens: 10,
    quantidade_por_embalagem: 6,
    quantidade_fiscal: 10,
    quantidade_nao_fiscal: 0
  };
  const erro = motor.validarConsistenciaQuantidadesItemCompra(item);
  assert.ok(erro, 'deve rejeitar fiscal=10 quando convertida=60');
  assert.match(erro, /60/);
});

test('ETAPA 6 — validação fiscal aceita fiscal=60', () => {
  const item = {
    produto_fracionado: 1,
    quantidade_comercial: 10,
    quantidade_embalagens: 10,
    quantidade_por_embalagem: 6,
    quantidade_fiscal: 60,
    quantidade_nao_fiscal: 0
  };
  assert.strictEqual(motor.validarConsistenciaQuantidadesItemCompra(item), null);
});

test('ETAPA 4 — normalizeItemCompra usa prepararItemQuantidadesImportacaoCentral', () => {
  assert.match(comprasJs, /function prepararItemQuantidadesImportacaoCentral/);
  assert.match(comprasJs, /quantidade_comercial/);
  assert.match(comprasJs, /quantidade_convertida/);
});

test('ETAPA 5 — grade exibe comercial e convertida', () => {
  assert.match(comprasJs, /function formatarQuantidadeItemCompra/);
  assert.match(comprasJs, /obterQuantidadeComercialItemCompra/);
  assert.match(comprasJs, /text-muted.*convertida/s);
});

test('ETAPA 7 — saveCompra envia quantidade_comercial e quantidade_convertida', () => {
  const fn = comprasJs.match(/function saveCompra\(\) \{[\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /quantidade_comercial:/);
  assert.match(fn[0], /quantidade_convertida:/);
});

test('Importação Central — qCom não vira estoque direto (peso_total = convertida)', () => {
  const prep = comprasJs.match(/function prepararItemQuantidadesImportacaoCentral[\s\S]*?\n\}/);
  assert.ok(prep);
  assert.match(prep[0], /quantidade_comercial/);
  assert.match(prep[0], /quantidade_embalagens/);
  assert.doesNotMatch(prep[0], /item\.quantidade =/);
});

test('obterTotalConvertidoItemCompra delega a obterQuantidadeConvertida', () => {
  const item = { quantidade_convertida: 60, quantidade_comercial: 10, quantidade: 10 };
  assert.strictEqual(motor.obterTotalConvertidoItemCompra(item), 60);
});

console.log(`\n--- Resultado: ${ok} OK, ${falhas} falha(s) ---\n`);
process.exit(falhas > 0 ? 1 : 0);
