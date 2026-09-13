/**
 * MUC RC1 — Suíte de certificação
 * Executar: node tests/muc/muc-rc1-certificacao.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const MUC = require('../../backend/motores/muc');
const { inferirTipoConversao } = require('../../backend/motores/muc/constants/tiposConversao');
const { parseApresentacaoRow } = require('../../backend/motores/muc/core/ParserApresentacoes');

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

console.log('\n=== MUC RC1 — Certificação ===\n');

test('MUC RC1 baseline funcional preservado no RC2.1', () => {
  assert.strictEqual(MUC.VERSAO.VERSAO, 'RC2.1');
  assert.strictEqual(MUC.VERSAO.VERSAO_RC1, 'RC1');
});

test('Estrutura oficial backend/motores/muc/', () => {
  [
    'backend/motores/muc/index.js',
    'backend/motores/muc/core/MotorConversao.js',
    'backend/motores/muc/core/ParserApresentacoes.js',
    'backend/motores/muc/core/MotorInferencia.js',
    'backend/motores/muc/dto/ResultadoConversaoDTO.js',
    'backend/motores/muc/repositorios/RepositorioApresentacoes.js',
    'backend/motores/muc/auditoria/AuditoriaConversao.js',
    'backend/motores/muc/aprendizado/MotorAprendizado.js',
    'backend/motores/muc/schema/mucSchema.js'
  ].forEach((f) => assert.ok(fs.existsSync(path.join(ROOT, f)), `falta ${f}`));
});

test('Caixa 12 → MULTIPLICADOR, 120 UN estoque', () => {
  const r = MUC.MotorConversao.converter({
    produtoId: 1,
    item: {
      quantidade_embalagens: 10,
      quantidade_por_embalagem: 12,
      valor_total_embalagem: 400,
      unidade_comercial: 'CAIXA',
      compra_em: 'CX'
    },
    origem: 'MANUAL'
  });
  assert.strictEqual(r.quantidadeEstoque, 120);
  assert.strictEqual(r.fatorConversao, 12);
  assert.strictEqual(r.tipoConversao, 'MULTIPLICADOR');
  assert.ok(r.hash);
  assert.ok(Object.isFrozen(r));
});

test('Fardo 24 → MULTIPLICADOR', () => {
  const r = MUC.MotorConversao.converter({
    item: { quantidade_embalagens: 5, quantidade_por_embalagem: 24, valor_total_embalagem: 500, unidade_comercial: 'FARDO' }
  });
  assert.strictEqual(r.quantidadeEstoque, 120);
});

test('Pacote/Display → MULTIPLICADOR', () => {
  const r = MUC.MotorConversao.converter({
    item: { quantidade_embalagens: 2, quantidade_por_embalagem: 6, valor_total_embalagem: 60, unidade_comercial: 'PACOTE' }
  });
  assert.strictEqual(r.quantidadeEstoque, 12);
});

test('Kit → tipo KIT', () => {
  assert.strictEqual(inferirTipoConversao('KIT', 'un'), 'KIT');
});

test('Bobina 100m → LINEAR', () => {
  assert.strictEqual(inferirTipoConversao('BOBINA', 'mt'), 'LINEAR');
  const r = MUC.MotorConversao.converter({
    produto: { produto_fracionado: 1, unidade: 'mt' },
    item: {
      produto_fracionado: 1,
      quantidade_embalagens: 2,
      quantidade_por_embalagem: 100,
      valor_total_embalagem: 200,
      compra_em: 'Bobina',
      quantidade_fiscal: 200,
      quantidade_nao_fiscal: 0
    }
  });
  assert.strictEqual(r.quantidadeEstoque, 200);
});

test('Saco 25Kg → PESO', () => {
  assert.strictEqual(inferirTipoConversao('SACO', 'kg'), 'PESO');
});

test('Litro → VOLUME', () => {
  assert.strictEqual(inferirTipoConversao('UN', 'l'), 'VOLUME');
});

test('Quilograma base → PESO', () => {
  assert.strictEqual(inferirTipoConversao('UN', 'kg'), 'PESO');
});

test('Múltiplos GTINs via apresentações distintas', () => {
  const a = parseApresentacaoRow({ id: 1, produto_id: 10, tipo: 'UN', quantidade: 1, gtin: '789111', unidade: 'un' });
  const b = parseApresentacaoRow({ id: 2, produto_id: 10, tipo: 'FD', quantidade: 6, gtin: '789222', unidade: 'un' });
  const c = parseApresentacaoRow({ id: 3, produto_id: 10, tipo: 'CX', quantidade: 12, gtin: '789333', unidade: 'un' });
  assert.notStrictEqual(a.gtin, b.gtin);
  assert.notStrictEqual(b.gtin, c.gtin);
});

test('ResultadoConversaoDTO é imutável e serializável', () => {
  const r = MUC.MotorConversao.converter({
    item: { quantidade_embalagens: 1, quantidade_por_embalagem: 1, valor_total_embalagem: 10, unidade_comercial: 'UN' }
  });
  const json = MUC.resultadoParaJson(r);
  const restored = MUC.resultadoFromJson(json);
  assert.strictEqual(restored.quantidadeEstoque, r.quantidadeEstoque);
  assert.strictEqual(restored.hash, r.hash);
});

test('Compatibilidade retroativa — motorConversaoUnidades delegável', () => {
  const legado = require('../../backend/lib/motorConversaoUnidades');
  const qtds = legado.resolverQuantidadesEstoqueCompraItem({
    quantidade_embalagens: 3,
    quantidade_por_embalagem: 12,
    unidade_comercial: 'PACOTE',
    quantidade_fiscal: 36,
    quantidade_nao_fiscal: 0
  });
  assert.strictEqual(qtds.quantidade_convertida, 36);
});

test('compras.js integrado ao MUC', () => {
  const src = ler('backend/rotas/compras.js');
  assert.match(src, /obterMuc/);
  assert.match(src, /resultado_conversao_json/);
  assert.match(src, /produto_apresentacao_id/);
});

test('Schema MUC auditoria + aprendizado', () => {
  const src = ler('backend/motores/muc/schema/mucSchema.js');
  assert.match(src, /muc_auditoria_conversao/);
  assert.match(src, /muc_aprendizado/);
  assert.match(src, /tipo_conversao/);
});

test('ProdutoApresentacao alias no serviço', () => {
  const svc = require('../../backend/services/produto-embalagem/ProdutoEmbalagemService');
  assert.strictEqual(typeof svc.obterProdutoApresentacaoService, 'function');
});

test('Simulação conversão manual', () => {
  const r = MUC.MotorConversao.simularConversao({
    quantidadeCompra: 4,
    quantidadePorApresentacao: 15,
    valorTotal: 120
  });
  assert.strictEqual(r.quantidadeEstoque, 60);
  assert.strictEqual(r.custoUnitario, 2);
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
