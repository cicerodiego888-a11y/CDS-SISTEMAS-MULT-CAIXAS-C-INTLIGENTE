/**
 * Busca local da etapa Itens e Quantidades (devolução de compra).
 * Executar: node --test tests/faturamento/nfe-devolucao-itens-busca.test.js
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  normalizarTextoBuscaNdc,
  itemCorrespondeBuscaNdc,
  filtrarItensVisiveisNdc
} = require('../../frontend/erp/js/nfe-devolucao-compra.js');

function item(codigo, nome, extra = {}) {
  return {
    produto_codigo: codigo,
    produto_nome: nome,
    selecionado: extra.selecionado === true,
    qtdDevolver: extra.qtdDevolver != null ? extra.qtdDevolver : 0,
    valor_unitario: extra.valor_unitario != null ? extra.valor_unitario : 0,
    status_ui: extra.status_ui || 'nao_devolvido'
  };
}

const ITENS_46 = [
  item('CH_COMBAR_8', 'CHAVE COMBINADA COM CATRACA ARTICULADA 8MM', {
    selecionado: true, qtdDevolver: 4, valor_unitario: 15.88, status_ui: 'nao_devolvido'
  }),
  item('CH_CANHAO_8', 'CHAVE CANHAO CRV 8MM', {
    selecionado: true, qtdDevolver: 4, valor_unitario: 12.63, status_ui: 'parcial'
  }),
  item('JG COMB 12', 'JOGO DE CHAVE COMBINADA COM 12 PCS', {
    selecionado: true, qtdDevolver: 1, valor_unitario: 15.14, status_ui: 'total'
  }),
  ...Array.from({ length: 43 }, (_, i) => item(`P${i + 4}`, `PRODUTO EXTRA ${i + 4}`, {
    selecionado: i < 2, qtdDevolver: i < 2 ? 1 : 0, valor_unitario: 10 + i
  }))
];

function snapshot(itens) {
  return itens.map((it) => ({
    codigo: it.produto_codigo,
    selecionado: it.selecionado,
    qtdDevolver: it.qtdDevolver,
    valor_unitario: it.valor_unitario,
    status_ui: it.status_ui
  }));
}

describe('Busca Itens e Quantidades — devolução', () => {
  it('1. busca por código exato', () => {
    const vis = filtrarItensVisiveisNdc(ITENS_46, 'CH_COMBAR_8');
    assert.equal(vis.length, 1);
    assert.equal(vis[0].item.produto_codigo, 'CH_COMBAR_8');
  });

  it('2. busca por código parcial', () => {
    const vis = filtrarItensVisiveisNdc(ITENS_46, 'COMBAR 8');
    assert.equal(vis.length, 1);
    assert.match(vis[0].item.produto_codigo, /COMBAR/i);
  });

  it('3. busca por descrição', () => {
    const vis = filtrarItensVisiveisNdc(ITENS_46, 'CHAVE CANHAO CRV 8MM');
    assert.equal(vis.length, 1);
    assert.equal(vis[0].item.produto_codigo, 'CH_CANHAO_8');
  });

  it('4. busca parcial por descrição', () => {
    const vis = filtrarItensVisiveisNdc(ITENS_46, 'chave combinada');
    assert.ok(vis.length >= 2);
    const codigos = vis.map((v) => v.item.produto_codigo);
    assert.ok(codigos.includes('CH_COMBAR_8'));
    assert.ok(codigos.includes('JG COMB 12'));
  });

  it('5. busca sem diferenciação de maiúsculas/minúsculas', () => {
    const a = filtrarItensVisiveisNdc(ITENS_46, 'ch_combar_8');
    const b = filtrarItensVisiveisNdc(ITENS_46, 'CH_COMBAR_8');
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.equal(a[0].idx, b[0].idx);
  });

  it('6. busca sem acentos', () => {
    const itens = [item('X', 'CHAVE CANHÃO')];
    assert.equal(filtrarItensVisiveisNdc(itens, 'chave canhao').length, 1);
    assert.equal(filtrarItensVisiveisNdc(itens, 'CHAVE CANHÃO').length, 1);
    assert.equal(normalizarTextoBuscaNdc('CHAVE CANHÃO'), 'chave canhao');
  });

  it('7. nenhum resultado', () => {
    const vis = filtrarItensVisiveisNdc(ITENS_46, 'PRODUTO INEXISTENTE XYZ');
    assert.equal(vis.length, 0);
    assert.equal(ITENS_46.length, 46);
  });

  it('8. limpar busca', () => {
    const filtrado = filtrarItensVisiveisNdc(ITENS_46, 'CH_COMBAR_8');
    assert.equal(filtrado.length, 1);
    const limpo = filtrarItensVisiveisNdc(ITENS_46, '');
    assert.equal(limpo.length, 46);
  });

  it('9. preservar seleção', () => {
    const antes = snapshot(ITENS_46);
    filtrarItensVisiveisNdc(ITENS_46, 'CH_CANHAO');
    assert.deepEqual(snapshot(ITENS_46), antes);
    assert.equal(ITENS_46[0].selecionado, true);
    assert.equal(ITENS_46[2].selecionado, true);
  });

  it('10. preservar quantidade', () => {
    ITENS_46[0].qtdDevolver = 4;
    filtrarItensVisiveisNdc(ITENS_46, 'JG COMB');
    assert.equal(ITENS_46[0].qtdDevolver, 4);
  });

  it('11. preservar valor unitário', () => {
    ITENS_46[0].valor_unitario = 12.63;
    ITENS_46[1].valor_unitario = 5.69;
    ITENS_46[2].valor_unitario = 44.33;
    filtrarItensVisiveisNdc(ITENS_46, 'CH_CANHAO_8');
    filtrarItensVisiveisNdc(ITENS_46, '');
    assert.equal(ITENS_46[0].valor_unitario, 12.63);
    assert.equal(ITENS_46[1].valor_unitario, 5.69);
    assert.equal(ITENS_46[2].valor_unitario, 44.33);
  });

  it('12. preservar estado de devolução', () => {
    assert.equal(ITENS_46[0].status_ui, 'nao_devolvido');
    assert.equal(ITENS_46[1].status_ui, 'parcial');
    assert.equal(ITENS_46[2].status_ui, 'total');
    filtrarItensVisiveisNdc(ITENS_46, 'COMBAR');
    assert.equal(ITENS_46[1].status_ui, 'parcial');
    assert.equal(ITENS_46[2].status_ui, 'total');
  });

  it('13. selecionar todos com filtro atua no estado completo', () => {
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/nfe-devolucao-compra.js'), 'utf8');
    assert.match(ui, /Atua sobre TODOS os itens da NF/);
    assert.match(ui, /estado\.itensUi\.forEach/);
    const vis = filtrarItensVisiveisNdc(ITENS_46, 'CHAVE');
    assert.ok(vis.length < 46);
    ITENS_46.forEach((it) => { it.selecionado = true; });
    assert.equal(ITENS_46.filter((it) => it.selecionado).length, 46);
  });

  it('14. limpar filtro após alteração', () => {
    ITENS_46[0].valor_unitario = 12.63;
    const vis = filtrarItensVisiveisNdc(ITENS_46, 'CH COMBAR 8');
    assert.equal(vis.length, 1);
    vis[0].item.valor_unitario = 12.63;
    const limpo = filtrarItensVisiveisNdc(ITENS_46, '   ');
    assert.equal(limpo.length, 46);
    assert.equal(ITENS_46[0].valor_unitario, 12.63);
  });

  it('15. 46 itens continuam no estado interno', () => {
    filtrarItensVisiveisNdc(ITENS_46, 'CH_COMBAR_8');
    filtrarItensVisiveisNdc(ITENS_46, 'CH_CANHAO_8');
    filtrarItensVisiveisNdc(ITENS_46, 'JG COMB 12');
    assert.equal(ITENS_46.length, 46);
  });

  it('UI restaura busca local sem request', () => {
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/nfe-devolucao-compra.js'), 'utf8');
    assert.match(ui, /id="ndcBuscaItens"/);
    assert.match(ui, /Buscar por código ou descrição/);
    assert.match(ui, /btnNdcLimparBusca/);
    assert.match(ui, /filtrarItensVisiveisNdc/);
    assert.doesNotMatch(ui, /ndcBuscaItens[\s\S]{0,200}fetch\(/);
  });
});
