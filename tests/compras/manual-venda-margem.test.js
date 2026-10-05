'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { obterMuc } = require('../../backend/motores/muc');

const comprasJs = fs.readFileSync(
  path.join(__dirname, '../../frontend/erp/js/compras.js'),
  'utf8'
);

function carregarFuncao(nome, contexto = {}) {
  const match = comprasJs.match(new RegExp(`function ${nome}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Não encontrou a função ${nome}`);
  const sandbox = vm.createContext(contexto);
  vm.runInContext(`${match[0]}\nthis.__funcao = ${nome};`, sandbox);
  return { fn: sandbox.__funcao, sandbox };
}

const calcularMargem = carregarFuncao('calcularMargemEntradaManualCompra').fn;
const resolverDados = carregarFuncao('resolverDadosComerciaisProdutoCompra', {
  ORIGEM_BASE_COMERCIAL_COMPRA: {
    PADRAO: 'padrao',
    CADASTRO: 'cadastro',
    ULTIMA_COMPRA: 'ultima_compra'
  },
  isOrigemCompraCentralNfe: () => false,
  extrairMargemCadastradaProduto: () => ({
    margem: 35,
    fallback: true,
    origem: 'padrao'
  }),
  calcularMargemEntradaManualCompra: calcularMargem
}).fn;

function criarRecalculador(draft) {
  return carregarFuncao('recalcularFormacaoPrecoDraftCompra', {
    itemDraftCompra: draft,
    isOrigemCompraCentralNfe: () => false,
    calcularMargemEntradaManualCompra: calcularMargem
  }).fn;
}

const calcularEmbalagem = carregarFuncao('calcularEmbalagemComercialLocal').fn;

let ok = 0;
let falhas = 0;

function test(nome, executar) {
  try {
    executar();
    ok += 1;
    console.log(`  PASS ${nome}`);
  } catch (erro) {
    falhas += 1;
    console.error(`  FAIL ${nome}: ${erro.message}`);
  }
}

console.log('\n=== Entrada manual: preço de venda e margem informativa ===\n');

test('Preço 2,70 e custo 2,00 resultam em margem 25,93%', () => {
  const dados = resolverDados(
    { preco_compra: 2, preco_venda: 2.7 },
    null
  );
  assert.strictEqual(dados.preco_venda_sugerido, 2.7);
  assert.strictEqual(dados.margem_lucro, 25.93);
});

test('Alterar o preço para 3,00 recalcula a margem para 33,33%', () => {
  const draft = { preco_unitario: 2, preco_venda_sugerido: 3, margem_lucro: 25.93 };
  criarRecalculador(draft)('venda');
  assert.strictEqual(draft.preco_venda_sugerido, 3);
  assert.strictEqual(draft.margem_lucro, 33.33);
});

test('Alterar margem não muda o preço de venda', () => {
  const draft = { preco_unitario: 2, preco_venda_sugerido: 2.7, margem_lucro: 35 };
  criarRecalculador(draft)('margem');
  assert.strictEqual(draft.preco_venda_sugerido, 2.7);
  assert.strictEqual(draft.margem_lucro, 25.93);
});

test('ROLO: 1 × 100 MT, custo total 200, custo unitário 2,00', () => {
  const conversao = obterMuc(null).simular({
    quantidadeCompra: 1,
    quantidadePorApresentacao: 100,
    valorTotal: 200
  });
  assert.strictEqual(conversao.quantidadeEstoque, 100);
  assert.strictEqual(conversao.custoUnitario, 2);
  const venda = 2.7;
  assert.strictEqual(calcularMargem(conversao.custoUnitario, venda), 25.93);
  const embalagem = calcularEmbalagem(1, 100, 200, venda);
  assert.strictEqual(embalagem.precoVendaUnitario, venda);
  assert.strictEqual(embalagem.valorEmbalagemVenda, 270);
});

test('Sem preço cadastrado não inventa preço pela margem', () => {
  const dados = resolverDados({ preco_compra: 2, lucro_percentual: 35 }, null);
  assert.strictEqual(dados.preco_venda_sugerido, 0);
  assert.strictEqual(dados.margem_lucro, 0);
});

test('Seleção e commit manual preservam venda explícita, sem formar por margem', () => {
  assert.match(comprasJs, /draft\.preco_venda_sugerido = Number\(produto\.preco_venda \|\| 0\)/);
  assert.match(comprasJs, /const vendaExibida = origemCentralNfe \? vendaCadastro : dados\.preco_venda_sugerido;[\s\S]*?\$\('#preco_venda_item'\)\.val\(vendaExibida > 0/);
  assert.match(comprasJs, /precoVenda = Number\.isFinite\(precoVendaInput\) \? precoVendaInput : 0/);
  assert.match(comprasJs, /margemFinal = calcularMargemEntradaManualCompra\(preco, precoVenda\)/);
  assert.doesNotMatch(comprasJs, /preco\s*\*\s*\(1\s*\+\s*margem\s*\/\s*100\)/);
  assert.doesNotMatch(comprasJs, /preco_unitario\s*\*\s*\(1\s*\+\s*\(?draft\.margem_lucro/);
});

test('Entrada manual não exibe nem solicita atualização do preço cadastral', () => {
  assert.doesNotMatch(comprasJs, /Atualizar preço/);
  assert.match(comprasJs, /draft\.atualizar_preco_venda = 0/);
  assert.match(comprasJs, /preco_venda_editado_manual: Number\(itemDraftCompra\?\.preco_venda_editado_manual \|\| 0\),\s*atualizar_preco_venda: 0/);
  assert.match(comprasJs, /atualizar_preco_venda: 0,\s*atualizar_preco_venda_editado_manual: 0/);
});

console.log(`\nResultado: ${ok} PASS, ${falhas} FAIL\n`);
process.exit(falhas > 0 ? 1 : 0);
