/**
 * Sprint UX V2 — painel operacional de Vendas para Entrega.
 * Trava somente a apresentação: mesmos handlers, mesmos status, sem tabela larga.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '../../frontend/pdv/js/entregas.js'),
  'utf8'
);

describe('painel visual V2', () => {
  it('mantém funções, modos, filtros e endpoints', () => {
    for (const nome of [
      'function loadEntregas',
      'function atualizarTela',
      'function tabelaPedidos',
      'function linhaPedido',
      'function bindAcoesPedidos',
      'modoVisualizacao',
      'statusFiltro',
      'btnModoAgrupado',
      'btnModoLista',
      'data-status="AGUARDANDO_ENTREGA"',
      'data-status="EM_ENTREGA"',
      'data-status="AGUARDANDO_PRESTACAO"',
      'data-status="CONCLUIDA"',
      'data-status="CANCELADA"',
      '/vendas/entregas/por-entregador',
      '/vendas/entregas/${id}/iniciar',
      "body: '{}'",
      'Entrega iniciada.'
    ]) {
      assert.ok(SRC.includes(nome), nome);
    }
  });

  it('apresenta o pedido em card, sem a tabela de 12 colunas', () => {
    assert.ok(SRC.includes('class="ent-pedido"'));
    assert.ok(SRC.includes('#telaEntregasOperacional'));
    assert.equal(SRC.includes('table-responsive'), false);
    assert.equal(SRC.includes('text-nowrap'), false);
    assert.equal(SRC.includes('overflow-x: hidden'), false);
    assert.equal(SRC.includes('overflow-x:hidden'), false);
  });

  it('mantém Iniciar, Editar, Reimprimir e Histórico nos handlers existentes', () => {
    assert.match(SRC, /podeIniciar = v\.status_entrega === 'AGUARDANDO_ENTREGA'/);
    assert.match(SRC, /podeEditar = v\.status_entrega === 'AGUARDANDO_ENTREGA'/);
    assert.ok(SRC.includes('btn-iniciar-entrega'));
    assert.ok(SRC.includes('btn-editar-entrega'));
    assert.ok(SRC.includes('btn-reimprimir-entrega'));
    assert.ok(SRC.includes('btn-detalhe-entrega'));
    assert.ok(SRC.includes('Iniciar Entrega'));
    assert.ok(SRC.includes('abrirModalEditarEntrega'));
    assert.ok(SRC.includes('reimprimirCupomEntrega'));
    assert.ok(SRC.includes('abrirDetalheTimeline'));
  });
});
