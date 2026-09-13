/**
 * Catálogo de eventos de auditoria — Vendas para Entrega (Sprint 3)
 */

const EntregaAuditoriaEventos = Object.freeze({
  VENDA_MARCADA_PARA_ENTREGA: 'venda_marcada_para_entrega',
  RESERVA_CRIADA: 'reserva_criada',
  COMPROVANTE_IMPRESSO: 'comprovante_impresso',
  ENTREGA_INICIADA: 'entrega_iniciada',
  ENTREGA_CANCELADA: 'entrega_cancelada',
  ENTREGA_AGRUPADA: 'entrega_agrupada',
  ENTREGA_REABERTA: 'entrega_reaberta',
  MUDANCA_STATUS: 'mudanca_status',
  TROCO_INFORMADO: 'troco_informado',
  MAQUINETA_INFORMADA: 'maquineta_informada',
  PRESTACAO_INICIADA: 'prestacao_iniciada',
  PAGAMENTO_ALTERADO: 'pagamento_alterado',
  PAGAMENTO_CONFIRMADO: 'pagamento_confirmado',
  RESERVA_CONVERTIDA: 'reserva_convertida',
  ESTOQUE_BAIXADO: 'estoque_baixado',
  FINANCEIRO_GERADO: 'financeiro_gerado',
  CAIXA_ATUALIZADO: 'caixa_atualizado',
  NFCE_EMITIDA: 'nfce_emitida',
  PRESTACAO_REALIZADA: 'prestacao_realizada',
  VENDA_FINALIZADA: 'venda_finalizada',
  ENTREGA_CONCLUIDA: 'entrega_concluida',
  COMPROVANTE_PRESTACAO_IMPRESSO: 'comprovante_prestacao_impresso'
});

const TIMELINE_ORDEM = Object.freeze([
  EntregaAuditoriaEventos.VENDA_MARCADA_PARA_ENTREGA,
  EntregaAuditoriaEventos.RESERVA_CRIADA,
  EntregaAuditoriaEventos.COMPROVANTE_IMPRESSO,
  EntregaAuditoriaEventos.ENTREGA_INICIADA,
  EntregaAuditoriaEventos.PRESTACAO_INICIADA,
  EntregaAuditoriaEventos.PAGAMENTO_ALTERADO,
  EntregaAuditoriaEventos.PAGAMENTO_CONFIRMADO,
  EntregaAuditoriaEventos.RESERVA_CONVERTIDA,
  EntregaAuditoriaEventos.ESTOQUE_BAIXADO,
  EntregaAuditoriaEventos.FINANCEIRO_GERADO,
  EntregaAuditoriaEventos.NFCE_EMITIDA,
  EntregaAuditoriaEventos.PRESTACAO_REALIZADA,
  EntregaAuditoriaEventos.VENDA_FINALIZADA,
  EntregaAuditoriaEventos.ENTREGA_CONCLUIDA,
  EntregaAuditoriaEventos.COMPROVANTE_PRESTACAO_IMPRESSO
]);

const TIMELINE_LABELS = Object.freeze({
  [EntregaAuditoriaEventos.VENDA_MARCADA_PARA_ENTREGA]: 'Venda criada',
  [EntregaAuditoriaEventos.RESERVA_CRIADA]: 'Reserva criada',
  [EntregaAuditoriaEventos.COMPROVANTE_IMPRESSO]: 'Comprovante impresso',
  [EntregaAuditoriaEventos.ENTREGA_INICIADA]: 'Saiu para entrega',
  [EntregaAuditoriaEventos.PRESTACAO_INICIADA]: 'Prestação iniciada',
  [EntregaAuditoriaEventos.PAGAMENTO_ALTERADO]: 'Pagamento alterado',
  [EntregaAuditoriaEventos.PAGAMENTO_CONFIRMADO]: 'Pagamento confirmado',
  [EntregaAuditoriaEventos.RESERVA_CONVERTIDA]: 'Reserva convertida',
  [EntregaAuditoriaEventos.ESTOQUE_BAIXADO]: 'Estoque baixado',
  [EntregaAuditoriaEventos.FINANCEIRO_GERADO]: 'Financeiro gerado',
  [EntregaAuditoriaEventos.CAIXA_ATUALIZADO]: 'Caixa atualizado',
  [EntregaAuditoriaEventos.NFCE_EMITIDA]: 'NFC-e emitida',
  [EntregaAuditoriaEventos.PRESTACAO_REALIZADA]: 'Prestação realizada',
  [EntregaAuditoriaEventos.VENDA_FINALIZADA]: 'Venda finalizada',
  [EntregaAuditoriaEventos.ENTREGA_CONCLUIDA]: 'Entrega concluída',
  [EntregaAuditoriaEventos.COMPROVANTE_PRESTACAO_IMPRESSO]: 'Comprovante de prestação impresso',
  [EntregaAuditoriaEventos.ENTREGA_CANCELADA]: 'Entrega cancelada',
  [EntregaAuditoriaEventos.MUDANCA_STATUS]: 'Mudança de status',
  [EntregaAuditoriaEventos.TROCO_INFORMADO]: 'Troco informado',
  [EntregaAuditoriaEventos.MAQUINETA_INFORMADA]: 'Maquineta informada'
});

const MODULO_AUDITORIA_ENTREGA = 'vendas_entrega';

function montarPayloadAuditoriaEntrega({
  acao,
  vendaId,
  detalhes = {},
  usuario_id = null,
  usuario_nome = null,
  ip_requisicao = null
} = {}) {
  return {
    usuario_id,
    usuario_nome,
    modulo: MODULO_AUDITORIA_ENTREGA,
    acao,
    referencia_tipo: 'venda',
    referencia_id: vendaId != null ? String(vendaId) : null,
    detalhes,
    ip_requisicao
  };
}

function labelTimeline(acao) {
  return TIMELINE_LABELS[acao] || String(acao || 'Evento');
}

module.exports = {
  EntregaAuditoriaEventos,
  MODULO_AUDITORIA_ENTREGA,
  TIMELINE_ORDEM,
  TIMELINE_LABELS,
  montarPayloadAuditoriaEntrega,
  labelTimeline
};
