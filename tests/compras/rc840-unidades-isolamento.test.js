/**
 * RC8.4.0 — Isolamento de itens da compra + Motor de Unidades
 * Executar: node tests/compras/rc840-unidades-isolamento.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const MotorUM = require('../../backend/services/unidades/MotorUnidadesMedida');

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

console.log('\n=== RC8.4.0 — Unidades + Isolamento ===\n');

test('MotorUnidadesMedida calcula pacote 20 × R$100 → custo 5 e venda 7,50 (50%)', () => {
  const r = MotorUM.calcularCompraEmbalagem({
    quantidadeEmbalagens: 1,
    quantidadePorEmbalagem: 20,
    valorTotalEmbalagem: 100,
    margemPercentual: 50
  });
  assert.strictEqual(r.quantidadeEstoque, 20);
  assert.strictEqual(r.custoUnitario, 5);
  assert.strictEqual(r.precoVendaUnitario, 7.5);
  assert.strictEqual(r.valorEmbalagemVenda, 150);
});

test('10 pacotes × 20 = 200 unidades estoque', () => {
  const r = MotorUM.calcularCompraEmbalagem({
    quantidadeEmbalagens: 10,
    quantidadePorEmbalagem: 20,
    valorTotalEmbalagem: 1000,
    margemPercentual: 0
  });
  assert.strictEqual(r.quantidadeEstoque, 200);
  assert.strictEqual(r.custoUnitario, 5);
});

test('formação cadastro recalcula valor embalagem', () => {
  const r = MotorUM.calcularFormacaoPrecoCadastro({
    unidadeComercial: 'PACOTE',
    quantidadePorEmbalagem: 20,
    custoUnitario: 5,
    margemPercentual: 50,
    origem: 'custo'
  });
  assert.strictEqual(r.precoVendaUnitario, 7.5);
  assert.strictEqual(r.valorEmbalagemVenda, 150);
});

test('uCom XML CX → CAIXA sem alterar XML', () => {
  assert.strictEqual(MotorUM.identificarUnidadeDoXml('CX'), 'CAIXA');
  assert.strictEqual(MotorUM.identificarUnidadeDoXml('FD'), 'FARDO');
  assert.strictEqual(MotorUM.identificarUnidadeDoXml('UN'), 'UN');
});

test('compras.js isola edição sem splice prematuro', () => {
  const src = ler('frontend/erp/js/compras.js');
  assert.match(src, /indiceEditandoCompra|itemDraftCompra|linhaIdEditandoCompra/);
  assert.match(src, /clonarDadosItemCompra/);
  assert.match(src, /structuredClone|JSON\.parse\(JSON\.stringify/);
  assert.doesNotMatch(src, /itensCompraAtual\.splice\(index, 1\);\s*renderItensCompraTabela\(\);\s*\$\('#codigo_barras_item'\)\.focus/);
  assert.match(src, /iniciarDraftCompraEdicao|NÃO remove|não remove|itemDraftCompra/i);
});

test('normalizeItemCompra clona miip nested', () => {
  const src = ler('frontend/erp/js/compras.js');
  assert.match(src, /clonarNestedMiipItemCompra/);
  assert.match(src, /linha_id/);
});

test('bridge e MIIP usam deep clone', () => {
  assert.match(ler('backend/motores/central-entradas/services/CentralComprasBridgeService.js'), /structuredClone|JSON\.parse\(JSON\.stringify/);
  assert.match(ler('frontend/erp/js/miip-central-revisao.js'), /structuredClone|JSON\.parse\(JSON\.stringify/);
});

test('schema produtos tem unidade_comercial', () => {
  const src = ler('backend/database.js');
  assert.match(src, /unidade_comercial/);
  assert.match(src, /quantidade_por_embalagem/);
});

test('UI cadastro tem Unidade Comercial e Valor da Embalagem', () => {
  const src = ler('frontend/erp/js/produtos.js');
  assert.match(src, /unidade_comercial/);
  assert.match(src, /quantidade_por_embalagem/);
  assert.match(src, /valor_embalagem_venda/);
});

test('isolamento: alterar A não muda B (simulação)', () => {
  // Simula normalize/clone como no frontend
  function clonar(item) {
    return JSON.parse(JSON.stringify(item));
  }
  function normalize(item) {
    const c = clonar(item);
    return {
      linha_id: c.linha_id || `L${Math.random()}`,
      produto_nome: c.produto_nome,
      preco_unitario: Number(c.preco_unitario),
      preco_venda_sugerido: Number(c.preco_venda_sugerido),
      miip_sugestao: c.miip_sugestao ? { ...c.miip_sugestao } : null
    };
  }

  const compartilhado = { score: 90 };
  let itens = [
    normalize({ produto_nome: 'A', preco_unitario: 100, preco_venda_sugerido: 150, miip_sugestao: compartilhado }),
    normalize({ produto_nome: 'B', preco_unitario: 25, preco_venda_sugerido: 40, miip_sugestao: compartilhado })
  ];

  // Mutar miip do A via clone
  const draftA = clonar(itens[0]);
  draftA.preco_unitario = 200;
  draftA.preco_venda_sugerido = 300;
  draftA.miip_sugestao.score = 10;
  itens[0] = normalize(draftA);

  assert.strictEqual(itens[1].preco_unitario, 25);
  assert.strictEqual(itens[1].preco_venda_sugerido, 40);
  assert.strictEqual(itens[1].miip_sugestao.score, 90);
  assert.strictEqual(itens[0].preco_unitario, 200);

  // 100 itens: alterar um
  itens = Array.from({ length: 100 }, (_, i) => normalize({
    produto_nome: `P${i}`,
    preco_unitario: 10 + i,
    preco_venda_sugerido: 20 + i
  }));
  const snapshot = itens.map((x) => ({ ...x }));
  const d = clonar(itens[42]);
  d.preco_unitario = 999;
  itens[42] = normalize(d);
  for (let i = 0; i < 100; i += 1) {
    if (i === 42) {
      assert.strictEqual(itens[i].preco_unitario, 999);
    } else {
      assert.strictEqual(itens[i].preco_unitario, snapshot[i].preco_unitario);
      assert.strictEqual(itens[i].preco_venda_sugerido, snapshot[i].preco_venda_sugerido);
    }
  }
});

test('estoque conversão comercial no motorConversaoUnidades', () => {
  const src = ler('backend/lib/motorConversaoUnidades.js');
  assert.match(src, /usaEmbalagemComercial|unidade_comercial/);
});

console.log(`\nResultado: ${ok} ok, ${falhas} falhas\n`);
process.exit(falhas > 0 ? 1 : 0);
