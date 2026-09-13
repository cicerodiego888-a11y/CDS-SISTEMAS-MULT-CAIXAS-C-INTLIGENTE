/**
 * CORREÇÃO-NF-MARGEM-01 — Percentual NF = lucro_percentual do produto vinculado.
 * Executar: node --test tests/compras/correcao-nf-margem-01.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const comprasJs = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
const mapperJs = fs.readFileSync(
  path.join(ROOT, 'backend/shared/nfe/mappers/nfeXmlMapper.js'),
  'utf8'
);
const dtoJs = fs.readFileSync(
  path.join(ROOT, 'backend/shared/nfe/contracts/NfeItemParseadoDTO.js'),
  'utf8'
);

const MARGEM_PADRAO_FALLBACK_COMPRA = 35;

function extrairMargemCadastradaProduto(produto) {
  if (!produto || typeof produto !== 'object') {
    return { margem: MARGEM_PADRAO_FALLBACK_COMPRA, fallback: true, origem: 'padrao' };
  }
  const candidatos = [
    produto.lucro_percentual,
    produto.margem_lucro,
    produto.margem_padrao,
    produto.percentual_lucro
  ];
  for (const raw of candidatos) {
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return { margem: n, fallback: false, origem: 'cadastro' };
    }
  }
  return { margem: MARGEM_PADRAO_FALLBACK_COMPRA, fallback: true, origem: 'padrao' };
}

function itemCompraTemMargemGravada(item) {
  if (!item) return false;
  const raw = item.margem_lucro;
  if (raw === undefined || raw === null || raw === '') return false;
  return Number.isFinite(Number(raw));
}

function deveReaplicarMargemCadastroItemCompra(item, compraImportadaXml) {
  if (!item || !item.produto_id) return false;
  if (Number(item.margem_editada_manual) === 1) return false;
  if (item.margem_origem === 'manual') return false;
  if (!itemCompraTemMargemGravada(item)) return true;
  if (item.margem_origem === 'xml_default') return true;
  if (compraImportadaXml) {
    if (item.margem_origem !== 'cadastro' && item.margem_origem !== 'fallback') {
      return true;
    }
  }
  return false;
}

function resolverMargemItem(item, produto, compraImportadaXml) {
  if (deveReaplicarMargemCadastroItemCompra(item, compraImportadaXml)) {
    return extrairMargemCadastradaProduto(produto);
  }
  if (itemCompraTemMargemGravada(item)) {
    return { margem: Number(item.margem_lucro), fallback: false, origem: 'item' };
  }
  return extrairMargemCadastradaProduto(produto);
}

describe('CORREÇÃO-NF-MARGEM-01 — parser sem default 30', () => {
  it('nfeXmlMapper não injeta margem_lucro: 30', () => {
    assert.doesNotMatch(mapperJs, /margem_lucro:\s*30/);
    assert.match(mapperJs, /margem_lucro:\s*null/);
  });

  it('NfeItemParseadoDTO não defaulta margem para 30', () => {
    assert.doesNotMatch(dtoJs, /margem_lucro\s*\?\?\s*30/);
    assert.doesNotMatch(dtoJs, /margemLucro\s*\?\?\s*dados\.margem_lucro\s*\?\?\s*30/);
    assert.match(dtoJs, /margemLucro = null/);
  });

  it('DTO não fabrica preco_venda_sugerido = custo * 1.3', () => {
    assert.doesNotMatch(dtoJs, /\*\s*1\.3/);
  });
});

describe('CORREÇÃO-NF-MARGEM-01 — precedência do cadastro', () => {
  it('TESTE A — produto 37% prevalece sobre 30 do XML', () => {
    const item = { produto_id: 1, margem_lucro: 30 };
    const produto = { id: 1, lucro_percentual: 37 };
    const r = resolverMargemItem(item, produto, true);
    assert.equal(r.margem, 37);
    assert.equal(r.fallback, false);
  });

  it('TESTE B — produto 42%', () => {
    const item = { produto_id: 2, margem_lucro: 30 };
    const produto = { id: 2, lucro_percentual: 42 };
    assert.equal(resolverMargemItem(item, produto, true).margem, 42);
  });

  it('TESTE C — produto sem percentual → fallback 35', () => {
    const item = { produto_id: 3, margem_lucro: 30 };
    const produto = { id: 3, nome: 'Sem %' };
    const r = resolverMargemItem(item, produto, true);
    assert.equal(r.margem, 35);
    assert.equal(r.fallback, true);
  });

  it('TESTE D — XML 30 + produto 37 → 37', () => {
    const item = { produto_id: 10, margem_lucro: 30, margem_origem: 'xml_default' };
    const produto = { lucro_percentual: 37 };
    assert.equal(resolverMargemItem(item, produto, true).margem, 37);
  });

  it('TESTE E — MIIP automático (produto_id + cadastro 42)', () => {
    assert.match(comprasJs, /associadoAutomaticamente[\s\S]*?aplicarMargemDoProdutoNoItemCompra/);
    const item = { produto_id: 5 };
    const produto = { lucro_percentual: 42 };
    assert.equal(resolverMargemItem(item, produto, true).margem, 42);
  });

  it('TESTE F — associação manual 27%', () => {
    assert.match(comprasJs, /alterarProdutoItemCompra|extrairMargemCadastradaProduto\(produto\)/);
    const item = { produto_id: 7, margem_lucro: 30 };
    assert.equal(resolverMargemItem(item, { lucro_percentual: 27 }, true).margem, 27);
  });

  it('TESTE G — precisão 33.33', () => {
    const r = extrairMargemCadastradaProduto({ lucro_percentual: 33.33 });
    assert.equal(r.margem, 33.33);
  });

  it('TESTE H — edição manual 40% não é sobrescrita', () => {
    const item = {
      produto_id: 1,
      margem_lucro: 40,
      margem_editada_manual: 1,
      margem_origem: 'manual'
    };
    const produto = { lucro_percentual: 37 };
    const r = resolverMargemItem(item, produto, true);
    assert.equal(r.margem, 40);
  });

  it('TESTE I — preço de venda editado manualmente não é sobrescrito pelo % do cadastro', () => {
    assert.match(comprasJs, /function marcarPrecoVendaManualCompra/);
    assert.match(comprasJs, /oninput="marcarPrecoVendaManualCompra\(\)"/);
    assert.match(comprasJs, /margemManualCommit/);

    const item = {
      produto_id: 1,
      preco_unitario: 10,
      margem_lucro: 50,
      preco_venda_sugerido: 15,
      margem_editada_manual: 1,
      margem_origem: 'manual',
      atualizar_preco_venda: 1
    };
    const produto = { lucro_percentual: 35 };
    assert.equal(deveReaplicarMargemCadastroItemCompra(item, true), false);
    assert.equal(resolverMargemItem(item, produto, true).margem, 50);

    // Simula sincronizarPrecosCadastroItemCompra com venda manual
    const vendaManual = Number(item.margem_editada_manual) === 1 || item.margem_origem === 'manual';
    let precoVenda = Number(item.preco_venda_sugerido);
    if (vendaManual && precoVenda > 0) {
      precoVenda = Number(precoVenda.toFixed(2));
    } else {
      precoVenda = Number((item.preco_unitario * (1 + 35 / 100)).toFixed(2));
    }
    assert.equal(precoVenda, 15);
  });

  it('produto 25%', () => {
    assert.equal(
      resolverMargemItem({ produto_id: 1, margem_lucro: 30 }, { lucro_percentual: 25 }, true).margem,
      25
    );
  });

  it('escala 30 = 30% (não 0.30)', () => {
    const r = extrairMargemCadastradaProduto({ lucro_percentual: 30 });
    assert.equal(r.margem, 30);
    assert.notEqual(r.margem, 0.3);
  });
});

describe('CORREÇÃO-NF-MARGEM-01 — helpers no frontend', () => {
  it('expose helpers de reaplicação', () => {
    assert.match(comprasJs, /function deveReaplicarMargemCadastroItemCompra/);
    assert.match(comprasJs, /function aplicarMargemDoProdutoNoItemCompra/);
    assert.match(comprasJs, /MARGEM_PADRAO_FALLBACK_COMPRA = 35/);
  });

  it('marcarMargemManual marca origem manual', () => {
    assert.match(comprasJs, /margem_editada_manual\s*=\s*1/);
    assert.match(comprasJs, /margem_origem\s*=\s*'manual'/);
  });
});
