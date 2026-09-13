/**
 * RC5 — Contextos de origem para lifecycle/persistência da NF-e de Devolução.
 * COMPRA (RC1–RC4) e VENDA (RC5) compartilham o mesmo motor.
 */

'use strict';

const ORIGENS = Object.freeze({
  COMPRA: 'compra',
  VENDA: 'venda'
});

const CONTEXTOS = Object.freeze({
  compra: Object.freeze({
    origem: ORIGENS.COMPRA,
    tabelaNotas: 'nfe_devolucoes_compra',
    tabelaEventos: 'nfe_devolucao_compra_eventos',
    tabelaAuditoria: 'nfe_devolucao_compra_auditoria',
    fkOrigem: 'compra_id',
    label: 'COMPRA'
  }),
  venda: Object.freeze({
    origem: ORIGENS.VENDA,
    tabelaNotas: 'nfe_devolucoes_venda',
    tabelaEventos: 'nfe_devolucao_venda_eventos',
    tabelaAuditoria: 'nfe_devolucao_venda_auditoria',
    fkOrigem: 'venda_id',
    label: 'VENDA'
  })
});

function resolverContexto(origem = ORIGENS.COMPRA) {
  const key = String(origem || ORIGENS.COMPRA).toLowerCase();
  return CONTEXTOS[key] || CONTEXTOS.compra;
}

module.exports = {
  ORIGENS,
  CONTEXTOS,
  resolverContexto
};
