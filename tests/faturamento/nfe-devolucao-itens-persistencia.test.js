/**
 * Persistência de valor unitário / quantidade / seleção na etapa Itens.
 * Executar: node --test tests/faturamento/nfe-devolucao-itens-persistencia.test.js
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  parseNumeroUiNdc,
  aplicarEdicaoItemUiNdc,
  aplicarFiltroSemRecriarEstadoNdc,
  filtrarItensVisiveisNdc
} = require('../../frontend/erp/js/nfe-devolucao-compra.js');

function item(codigo, nome, vu, qtd) {
  return {
    produto_codigo: codigo,
    produto_nome: nome,
    selecionado: true,
    qtdDevolver: qtd,
    valor_unitario: vu,
    valor_unitario_original: vu,
    status_ui: 'nao_devolvido',
    valor_total: Math.round(qtd * vu * 100) / 100
  };
}

function estado46() {
  return [
    item('CH_COMBAR_8', 'CHAVE COMBINADA COM CATRACA ARTICULADA 8MM', 15.88, 4),
    item('CH_CANHAO_8', 'CHAVE CANHAO CRV 8MM', 12.63, 4),
    item('JG COMB 12', 'JOGO DE CHAVE COMBINADA COM 12 PCS', 15.14, 1),
    ...Array.from({ length: 43 }, (_, i) => item(`P${i + 4}`, `PRODUTO EXTRA ${i + 4}`, 10, 1))
  ];
}

function payloadRevisao(itensUi) {
  return itensUi
    .filter((it) => it.selecionado && Number(it.qtdDevolver) > 0)
    .map((it) => ({
      codigo: it.produto_codigo,
      quantidade: Number(it.qtdDevolver),
      valor_unitario: Number(it.valor_unitario)
    }));
}

describe('Persistência valor unitário — Itens e Quantidades', () => {
  it('1. alterar valor unitário', () => {
    const itens = estado46();
    aplicarEdicaoItemUiNdc(itens[0], { valor_unitario: parseNumeroUiNdc('12,63') });
    assert.equal(itens[0].valor_unitario, 12.63);
  });

  it('2. verificar estado.itensUi após edição', () => {
    const itensUi = estado46();
    aplicarEdicaoItemUiNdc(itensUi[0], { valor_unitario: 12.63 });
    assert.equal(itensUi[0].valor_unitario, 12.63);
    assert.equal(itensUi[0].valor_unitario_original, 15.88);
  });

  it('3. filtrar não recria estado', () => {
    const itensUi = estado46();
    aplicarEdicaoItemUiNdc(itensUi[0], { valor_unitario: 12.63 });
    const out = aplicarFiltroSemRecriarEstadoNdc(itensUi, 'CH_CANHAO_8');
    assert.strictEqual(out.estado, itensUi);
    assert.equal(out.visiveis.length, 1);
    assert.equal(out.visiveis[0].item.produto_codigo, 'CH_CANHAO_8');
  });

  it('4. verificar estado após filtro', () => {
    const itensUi = estado46();
    aplicarEdicaoItemUiNdc(itensUi[0], { valor_unitario: 12.63 });
    aplicarFiltroSemRecriarEstadoNdc(itensUi, 'CH_CANHAO_8');
    assert.equal(itensUi[0].valor_unitario, 12.63);
  });

  it('5. limpar filtro', () => {
    const itensUi = estado46();
    aplicarEdicaoItemUiNdc(itensUi[0], { valor_unitario: 12.63 });
    aplicarFiltroSemRecriarEstadoNdc(itensUi, 'CH_CANHAO_8');
    const limpo = aplicarFiltroSemRecriarEstadoNdc(itensUi, '');
    assert.equal(limpo.visiveis.length, 46);
  });

  it('6. verificar estado após limpar filtro', () => {
    const itensUi = estado46();
    aplicarEdicaoItemUiNdc(itensUi[0], { valor_unitario: 12.63 });
    aplicarFiltroSemRecriarEstadoNdc(itensUi, 'CH_CANHAO');
    aplicarFiltroSemRecriarEstadoNdc(itensUi, '');
    assert.equal(itensUi[0].valor_unitario, 12.63);
  });

  it('7. rerenderizar usa valor atual do estado', () => {
    const itensUi = estado46();
    aplicarEdicaoItemUiNdc(itensUi[0], { valor_unitario: 12.63 });
    const vis = filtrarItensVisiveisNdc(itensUi, 'CH COMBAR 8');
    assert.equal(vis[0].item.valor_unitario, 12.63);
    assert.equal(vis[0].idx, 0);
  });

  it('8. verificar estado após rerender simulado', () => {
    const itensUi = estado46();
    aplicarEdicaoItemUiNdc(itensUi[0], { valor_unitario: 12.63 });
    filtrarItensVisiveisNdc(itensUi, 'CH_CANHAO_8');
    filtrarItensVisiveisNdc(itensUi, 'CH COMBAR 8');
    assert.equal(itensUi[0].valor_unitario, 12.63);
  });

  it('9. alterar segundo item', () => {
    const itensUi = estado46();
    aplicarEdicaoItemUiNdc(itensUi[0], { valor_unitario: 12.63 });
    aplicarFiltroSemRecriarEstadoNdc(itensUi, 'CH_CANHAO_8');
    aplicarEdicaoItemUiNdc(itensUi[1], { valor_unitario: 5.69 });
    assert.equal(itensUi[1].valor_unitario, 5.69);
  });

  it('10. primeiro item permanece alterado', () => {
    const itensUi = estado46();
    aplicarEdicaoItemUiNdc(itensUi[0], { valor_unitario: 12.63 });
    aplicarEdicaoItemUiNdc(itensUi[1], { valor_unitario: 5.69 });
    assert.equal(itensUi[0].valor_unitario, 12.63);
  });

  it('11. alterar terceiro item', () => {
    const itensUi = estado46();
    aplicarEdicaoItemUiNdc(itensUi[0], { valor_unitario: 12.63 });
    aplicarEdicaoItemUiNdc(itensUi[1], { valor_unitario: 5.69 });
    aplicarEdicaoItemUiNdc(itensUi[2], { valor_unitario: 44.33 });
    assert.equal(itensUi[2].valor_unitario, 44.33);
  });

  it('12. verificar primeiro e segundo após o terceiro', () => {
    const itensUi = estado46();
    aplicarEdicaoItemUiNdc(itensUi[0], { valor_unitario: 12.63 });
    aplicarEdicaoItemUiNdc(itensUi[1], { valor_unitario: 5.69 });
    aplicarEdicaoItemUiNdc(itensUi[2], { valor_unitario: 44.33 });
    assert.equal(itensUi[0].valor_unitario, 12.63);
    assert.equal(itensUi[1].valor_unitario, 5.69);
  });

  it('13. verificar os três simultaneamente após limpar busca', () => {
    const itensUi = estado46();
    aplicarEdicaoItemUiNdc(itensUi[0], { valor_unitario: 12.63 });
    aplicarFiltroSemRecriarEstadoNdc(itensUi, 'CH_CANHAO_8');
    aplicarEdicaoItemUiNdc(itensUi[1], { valor_unitario: 5.69 });
    aplicarFiltroSemRecriarEstadoNdc(itensUi, 'JG COMB 12');
    aplicarEdicaoItemUiNdc(itensUi[2], { valor_unitario: 44.33 });
    aplicarFiltroSemRecriarEstadoNdc(itensUi, '');
    assert.equal(itensUi[0].valor_unitario, 12.63);
    assert.equal(itensUi[1].valor_unitario, 5.69);
    assert.equal(itensUi[2].valor_unitario, 44.33);
    assert.equal(itensUi.length, 46);
  });

  it('14. quantidade permanece', () => {
    const itensUi = estado46();
    aplicarEdicaoItemUiNdc(itensUi[0], { qtdDevolver: 4 });
    aplicarFiltroSemRecriarEstadoNdc(itensUi, 'CH_CANHAO');
    aplicarFiltroSemRecriarEstadoNdc(itensUi, '');
    assert.equal(itensUi[0].qtdDevolver, 4);
  });

  it('15. seleção permanece', () => {
    const itensUi = estado46();
    aplicarEdicaoItemUiNdc(itensUi[3], { selecionado: false });
    aplicarFiltroSemRecriarEstadoNdc(itensUi, 'CH COMBAR');
    aplicarFiltroSemRecriarEstadoNdc(itensUi, '');
    assert.equal(itensUi[0].selecionado, true);
    assert.equal(itensUi[3].selecionado, false);
  });

  it('16. total do item recalculado', () => {
    const itensUi = estado46();
    aplicarEdicaoItemUiNdc(itensUi[0], { qtdDevolver: 4, valor_unitario: 12.63 });
    assert.equal(itensUi[0].valor_total, 50.52);
    aplicarEdicaoItemUiNdc(itensUi[1], { qtdDevolver: 4, valor_unitario: 5.69 });
    assert.equal(itensUi[1].valor_total, 22.76);
    aplicarEdicaoItemUiNdc(itensUi[2], { qtdDevolver: 1, valor_unitario: 44.33 });
    assert.equal(itensUi[2].valor_total, 44.33);
  });

  it('17. revisão recebe valores atualizados', () => {
    const itensUi = estado46();
    aplicarEdicaoItemUiNdc(itensUi[0], { valor_unitario: 12.63 });
    aplicarEdicaoItemUiNdc(itensUi[1], { valor_unitario: 5.69 });
    aplicarEdicaoItemUiNdc(itensUi[2], { valor_unitario: 44.33 });
    const payload = payloadRevisao(itensUi);
    const a = payload.find((p) => p.codigo === 'CH_COMBAR_8');
    const b = payload.find((p) => p.codigo === 'CH_CANHAO_8');
    const c = payload.find((p) => p.codigo === 'JG COMB 12');
    assert.equal(a.valor_unitario, 12.63);
    assert.equal(b.valor_unitario, 5.69);
    assert.equal(c.valor_unitario, 44.33);
    assert.equal(parseNumeroUiNdc('12,63'), 12.63);
  });

  it('UI persiste no estado e não relê card oculto', () => {
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/nfe-devolucao-compra.js'), 'utf8');
    assert.match(ui, /garantirDelegacaoItens/);
    assert.match(ui, /input\.ndcItens/);
    assert.match(ui, /seletorItensEditaveisVisiveis/);
    assert.match(ui, /aplicarEdicaoItemUiNdc/);
    assert.match(ui, /data-field="valor-unitario"/);
    assert.match(ui, /persistFormItens\(\);/);
    assert.doesNotMatch(ui, /estado\.itensUi\s*=\s*itensFiltrados/);
    assert.doesNotMatch(ui, /estado\.itensUi\s*=\s*filtrarItensVisiveisNdc/);
  });
});
