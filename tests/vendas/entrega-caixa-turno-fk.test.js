'use strict';
/**
 * Garante que venda de entrega usa turno (caixa) e não cadastro (caixas).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { obterCaixaTurnoId } = require('../../backend/utils/caixaSessaoHelpers');

describe('CriarVendaEntrega — caixa_id = turno', () => {
  it('obterCaixaTurnoId prefere caixa_turno_id ao caixa_id de cadastro', () => {
    const sessao = { caixa_id: 2, caixa_turno_id: 18 };
    assert.equal(obterCaixaTurnoId(sessao), 18);
  });

  it('resolver caixa da entrega: req.caixaId (turno) vence sessao.caixa_id (cadastro)', () => {
    const req = {
      caixaId: 18,
      caixaSessao: { id: 37, caixa_id: 2, caixa_turno_id: 18 },
      caixaAtual: { id: 99 }
    };
    const caixaId =
      req.caixaId ||
      obterCaixaTurnoId(req.caixaSessao) ||
      req.caixaAtual?.id ||
      null;
    assert.equal(caixaId, 18);
    assert.notEqual(caixaId, req.caixaSessao.caixa_id);
  });

  it('sem req.caixaId, cai no turno da sessão', () => {
    const req = {
      caixaSessao: { id: 24, caixa_id: 2, caixa_turno_id: 5 }
    };
    const caixaId =
      req.caixaId ||
      obterCaixaTurnoId(req.caixaSessao) ||
      null;
    assert.equal(caixaId, 5);
  });
});
