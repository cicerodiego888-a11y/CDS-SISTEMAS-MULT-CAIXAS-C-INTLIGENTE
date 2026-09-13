/**
 * MUC RC2.1 — Testes de contrato público
 * Executar: node tests/muc/muc-public-contract.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const PUBLIC = require('../../backend/motores/muc/public');
const MUC = require('../../backend/motores/muc');

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

function inputCaixa12() {
  return {
    produtoId: 1,
    item: {
      quantidade_embalagens: 10,
      quantidade_por_embalagem: 12,
      valor_total_embalagem: 400,
      unidade_comercial: 'CAIXA',
      compra_em: 'CX'
    },
    origem: 'MANUAL'
  };
}

const mockDb = {
  run(sql, params, cb) { if (typeof params === 'function') params(null); else if (cb) cb(null); },
  get(sql, params, cb) { if (typeof params === 'function') params(null, null); else if (cb) cb(null, null); },
  all(sql, params, cb) { if (typeof params === 'function') params(null, []); else if (cb) cb(null, []); }
};

console.log('\n=== MUC RC2.1 — Testes de Contrato Público ===\n');

test('Entrypoint public.js exporta somente superfície permitida', () => {
  const chaves = Object.keys(PUBLIC).sort();
  const esperadas = [
    'EVENTOS_PUBLICOS',
    'VERSAO',
    'criarConversaoDTO',
    'criarListaProdutoApresentacaoDTO',
    'criarProdutoApresentacaoDTO',
    'criarProdutoApresentacaoLegadoDTO',
    'criarRegraConversaoDTO',
    'criarResultadoConversaoDTO',
    'obterMuc',
    'resultadoFromJson',
    'resultadoParaJson'
  ].sort();
  assert.deepStrictEqual(chaves, esperadas);
});

test('Versão pública RC2.1 congelada', () => {
  assert.strictEqual(PUBLIC.VERSAO.VERSAO, 'RC2.1');
  assert.strictEqual(PUBLIC.VERSAO.STATUS, 'ARQUITETURA_CONGELADA');
  assert.strictEqual(PUBLIC.VERSAO.TAG, 'MUC_RC2.1_ENTERPRISE');
  assert.strictEqual(PUBLIC.VERSAO.CONTRATO, '1.0.0');
});

test('API pública — assinaturas dos 7 métodos', () => {
  const muc = PUBLIC.obterMuc(mockDb);
  [
    'converter',
    'processarItemCompra',
    'simular',
    'buscarApresentacao',
    'aprender',
    'exportarMetricas',
    'obterVersao'
  ].forEach((m) => assert.strictEqual(typeof muc[m], 'function', `método ausente: ${m}`));
});

test('obterVersao() retorna objeto imutável', () => {
  const muc = PUBLIC.obterMuc(mockDb);
  const v = muc.obterVersao();
  assert.strictEqual(v.VERSAO, 'RC2.1');
  assert.ok(Object.isFrozen(v));
  assert.throws(() => { v.VERSAO = 'X'; });
});

test('converter() → ResultadoConversaoDTO imutável com campos RC2', () => {
  const muc = PUBLIC.obterMuc(mockDb);
  const r = muc.converter(inputCaixa12(), { correlationId: 'contract-001' });
  assert.strictEqual(r.quantidadeEstoque, 120);
  assert.strictEqual(r.correlationId, 'contract-001');
  assert.ok(r.hashConversao);
  assert.ok(Object.isFrozen(r));
  assert.throws(() => { r.fatorConversao = 99; });
});

test('simular() — API pública oficial', () => {
  const muc = PUBLIC.obterMuc(mockDb);
  const r = muc.simular({ quantidadeCompra: 4, quantidadePorApresentacao: 15, valorTotal: 120 });
  assert.strictEqual(r.quantidadeEstoque, 60);
  assert.strictEqual(r.custoUnitario, 2);
});

test('simular() ≡ simularConversao() legado (compat)', () => {
  const muc = PUBLIC.obterMuc(mockDb);
  const inp = { quantidadeCompra: 2, quantidadePorApresentacao: 6, valorTotal: 60 };
  const a = muc.simular(inp);
  const b = muc.simularConversao(inp);
  assert.strictEqual(a.quantidadeEstoque, b.quantidadeEstoque);
});

test('exportarMetricas() — JSON e Markdown', () => {
  const muc = PUBLIC.obterMuc(mockDb);
  muc.converter(inputCaixa12());
  assert.ok(muc.exportarMetricas('json').includes('"total"'));
  assert.ok(muc.exportarMetricas('markdown').includes('MUC'));
});

test('buscarApresentacao() — callback sem erro', () => {
  const muc = PUBLIC.obterMuc(mockDb);
  let errResult = 'pending';
  muc.buscarApresentacao({ produtoId: 1 }, (err) => { errResult = err; });
  assert.strictEqual(errResult, null);
});

test('aprender() — executa sem crash', () => {
  const muc = PUBLIC.obterMuc(mockDb);
  let done = false;
  muc.aprender({
    produtoId: 1,
    fornecedorCnpj: '12345678000199',
    gtin: '789',
    tipoApresentacao: 'CX',
    fatorConversao: 12,
    tipoConversao: 'MULTIPLICADOR'
  }, (err) => { done = !err; });
  assert.strictEqual(done, true);
});

test('DTO ConversaoDTO — factory pública imutável', () => {
  const dto = PUBLIC.criarConversaoDTO(inputCaixa12());
  assert.ok(Object.isFrozen(dto));
  assert.strictEqual(dto.quantidadeCompra, 10);
});

test('DTO ProdutoApresentacaoDTO — factory pública', () => {
  const dto = PUBLIC.criarProdutoApresentacaoDTO({
    id: 1, produto_id: 10, tipo: 'CX', quantidade: 12, unidade: 'un', gtin: '789'
  });
  assert.ok(dto);
  assert.strictEqual(dto.quantidade, 12);
  assert.ok(Object.isFrozen(dto));
});

test('DTO RegraConversaoDTO — factory pública', () => {
  const regra = PUBLIC.criarRegraConversaoDTO('MULTIPLICADOR');
  assert.strictEqual(regra.regraAplicada, 'EMBALAGEM_MULTIPLICADOR');
  assert.strictEqual(regra.versaoContrato, 'RC2.1');
  assert.ok(Object.isFrozen(regra));
});

test('Serialização ResultadoConversaoDTO', () => {
  const muc = PUBLIC.obterMuc(mockDb);
  const r = muc.converter(inputCaixa12());
  const json = PUBLIC.resultadoParaJson(r);
  const restored = PUBLIC.resultadoFromJson(json);
  assert.strictEqual(restored.quantidadeEstoque, r.quantidadeEstoque);
  assert.strictEqual(restored.hashConversao, r.hashConversao);
});

test('Eventos públicos — 6 tipos oficiais v1.0.0', () => {
  const tipos = PUBLIC.EVENTOS_PUBLICOS;
  assert.strictEqual(tipos.length, 6);
  [
    'MUC_CONVERSAO_EXECUTADA',
    'MUC_CONVERSAO_CONFIRMADA',
    'MUC_CONVERSAO_MANUAL',
    'MUC_APRESENTACAO_APRENDIDA',
    'MUC_ERRO',
    'MUC_INFERENCIA_FALHOU'
  ].forEach((t) => assert.ok(tipos.includes(t), `evento ausente: ${t}`));
});

test('Documentação oficial existe', () => {
  [
    'docs/contratos/MUC_PUBLIC_API.md',
    'docs/arquitetura/MUC_ARQUITETURA_CONGELADA.md',
    'docs/governanca/MUC_PR_CHECKLIST.md'
  ].forEach((f) => assert.ok(fs.existsSync(path.join(ROOT, f)), `doc ausente: ${f}`));
});

test('Política de importação — ProdutoEmbalagemService usa API pública', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/services/produto-embalagem/ProdutoEmbalagemService.js'), 'utf8');
  assert.doesNotMatch(src, /motores\/muc\/core\/ParserApresentacoes/);
  assert.match(src, /criarProdutoApresentacaoDTO/);
});

test('Política de importação — compras.js usa obterMuc', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');
  assert.match(src, /obterMuc/);
  assert.doesNotMatch(src, /motores\/muc\/core\//);
  assert.doesNotMatch(src, /motores\/muc\/pipeline\//);
});

test('Compatibilidade RC1 — valores numéricos idênticos via API pública', () => {
  const muc = PUBLIC.obterMuc(mockDb);
  const r = muc.converter(inputCaixa12());
  assert.strictEqual(r.quantidadeEstoque, 120);
  assert.strictEqual(r.fatorConversao, 12);
  assert.strictEqual(r.tipoConversao, 'MULTIPLICADOR');
});

test('index.js reexporta factories públicas', () => {
  assert.strictEqual(typeof MUC.criarProdutoApresentacaoDTO, 'function');
  assert.strictEqual(typeof MUC.criarRegraConversaoDTO, 'function');
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
