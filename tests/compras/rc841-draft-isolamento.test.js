/**
 * RC8.4.1 — Arquitetura Draft da Central de Entradas / Compras
 * Executar: node tests/compras/rc841-draft-isolamento.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('\n=== RC8.4.1 — Draft Isolation ===\n');

const src = ler('frontend/erp/js/compras.js');

test('declara itemDraftCompra e linhaIdEditandoCompra', () => {
  assert.match(src, /let itemDraftCompra\s*=\s*null/);
  assert.match(src, /let linhaIdEditandoCompra\s*=\s*null/);
  assert.match(src, /let indiceEditandoCompra\s*=\s*null/);
});

test('API draft: iniciar / limpar / commit / atualizar imutável', () => {
  assert.match(src, /function iniciarDraftCompraEdicao/);
  assert.match(src, /function limparDraftCompra/);
  assert.match(src, /function commitItemCompraNoArray/);
  assert.match(src, /function atualizarItemCompraImutavel/);
  assert.match(src, /function gerarLinhaIdCompra/);
  assert.match(src, /function encontrarIndiceItemCompraPorLinhaId/);
});

test('editarItemCompra inicia draft sem splice', () => {
  assert.match(src, /function editarItemCompra[\s\S]*iniciarDraftCompraEdicao/);
  assert.doesNotMatch(
    src,
    /function editarItemCompra[\s\S]{0,1200}?itensCompraAtual\.splice/
  );
});

test('confirmação usa commitItemCompraNoArray (substitui ou push)', () => {
  assert.match(src, /commitItemCompraNoArray\(itemDraftCompra/);
});

test('formação de preço opera no draft', () => {
  assert.match(src, /function recalcularFormacaoPrecoDraftCompra/);
  assert.match(src, /function sincronizarDraftCompraDoFormulario/);
  assert.match(src, /function calcularValorVendaItem[\s\S]*sincronizarDraftCompraDoFormulario/);
  assert.match(src, /function calcularMargemItem[\s\S]*recalcularFormacaoPrecoDraftCompra/);
});

test('deep clone structuredClone obrigatório', () => {
  assert.match(src, /structuredClone/);
  assert.match(src, /clonarDadosItemCompra/);
});

test('MIIP não muta item da lista diretamente', () => {
  assert.match(src, /function aplicarMiipImportacaoXml[\s\S]*atualizarItemCompraImutavel/);
  assert.match(src, /function confirmarAssociacaoMiip[\s\S]*atualizarItemCompraImutavel/);
  assert.doesNotMatch(src, /item\.miip_resultado\s*=\s*resultado/);
});

test('importação / sessionStorage clona payload', () => {
  assert.match(src, /function abrirCompraDesdeCentralEntradas[\s\S]*clonarDadosItemCompra\(payload\)/);
  assert.match(src, /function consumirPendenciaCompraCentral[\s\S]*clonarDadosItemCompra\(JSON\.parse/);
  assert.match(src, /function preencherFormularioCompra[\s\S]*clonarDadosItemCompra\(dataBruto\)/);
});

test('bridge continua com deep clone', () => {
  const bridge = ler('backend/motores/central-entradas/services/CentralComprasBridgeService.js');
  assert.match(bridge, /structuredClone|JSON\.parse\(JSON\.stringify/);
});

test('simulação: draft A não altera B; 200 itens', () => {
  function clonar(x) {
    return JSON.parse(JSON.stringify(x));
  }
  function normalize(item) {
    const c = clonar(item);
    return {
      linha_id: c.linha_id || `id_${Math.random()}`,
      produto_nome: c.produto_nome,
      preco_unitario: Number(c.preco_unitario),
      margem_lucro: Number(c.margem_lucro),
      preco_venda_sugerido: Number(c.preco_venda_sugerido),
      miip_sugestao: c.miip_sugestao ? clonar(c.miip_sugestao) : null
    };
  }

  let itens = [
    normalize({ linha_id: 'A', produto_nome: 'A', preco_unitario: 100, margem_lucro: 50, preco_venda_sugerido: 150, miip_sugestao: { x: 1 } }),
    normalize({ linha_id: 'B', produto_nome: 'B', preco_unitario: 25, margem_lucro: 60, preco_venda_sugerido: 40, miip_sugestao: { x: 2 } })
  ];

  let itemDraft = clonar(itens[0]);
  itemDraft.preco_unitario = 200;
  itemDraft.margem_lucro = 50;
  itemDraft.preco_venda_sugerido = 300;
  itemDraft.miip_sugestao.x = 99;
  // commit
  const idx = itens.findIndex((i) => i.linha_id === itemDraft.linha_id);
  itens[idx] = normalize(itemDraft);
  itemDraft = null;

  assert.strictEqual(itens[1].preco_unitario, 25);
  assert.strictEqual(itens[1].preco_venda_sugerido, 40);
  assert.strictEqual(itens[1].miip_sugestao.x, 2);
  assert.strictEqual(itens[0].preco_unitario, 200);

  itens = Array.from({ length: 200 }, (_, i) => normalize({
    linha_id: `L${i}`,
    produto_nome: `P${i}`,
    preco_unitario: i,
    margem_lucro: 30,
    preco_venda_sugerido: i * 1.3
  }));
  const snap = itens.map((x) => clonar(x));
  itemDraft = clonar(itens[137]);
  itemDraft.preco_unitario = 777;
  itemDraft.preco_venda_sugerido = 999;
  itens[137] = normalize(itemDraft);
  for (let i = 0; i < 200; i += 1) {
    if (i === 137) {
      assert.strictEqual(itens[i].preco_unitario, 777);
    } else {
      assert.strictEqual(itens[i].preco_unitario, snap[i].preco_unitario);
      assert.strictEqual(itens[i].preco_venda_sugerido, snap[i].preco_venda_sugerido);
    }
  }
});

console.log(`\nResultado: ${ok} ok, ${falhas} falhas\n`);
process.exit(falhas > 0 ? 1 : 0);
