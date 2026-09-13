/**
 * Enums oficiais — Módulo Vendas para Entrega
 * Sprint 2.1: status da venda e da entrega são independentes.
 */

const TipoVenda = Object.freeze({
  BALCAO: 'BALCAO',
  ENTREGA: 'ENTREGA'
});

/**
 * Status da Venda (canal ENTREGA).
 * ABERTA = reserva operacional (ainda não efetivada).
 * FINALIZADA = após prestação de contas (Sprint 3).
 */
const StatusVenda = Object.freeze({
  ABERTA: 'ABERTA',
  FINALIZADA: 'FINALIZADA',
  CANCELADA: 'CANCELADA'
});

/**
 * Status da Entrega (ciclo logístico / operacional).
 * CONCLUIDA substitui o antigo FINALIZADA (alias mantido na normalização).
 */
const StatusEntrega = Object.freeze({
  AGUARDANDO_ENTREGA: 'AGUARDANDO_ENTREGA',
  EM_ENTREGA: 'EM_ENTREGA',
  AGUARDANDO_PRESTACAO: 'AGUARDANDO_PRESTACAO',
  CONCLUIDA: 'CONCLUIDA',
  CANCELADA: 'CANCELADA'
});

const PagamentoPrevisto = Object.freeze({
  PIX: 'PIX',
  DINHEIRO: 'DINHEIRO',
  DEBITO: 'DEBITO',
  CREDITO: 'CREDITO',
  MISTO: 'MISTO',
  FIADO: 'FIADO',
  NAO_INFORMADO: 'NAO_INFORMADO'
});

const TIPOS_VENDA = Object.freeze(Object.values(TipoVenda));
const STATUS_VENDA = Object.freeze(Object.values(StatusVenda));
const STATUS_ENTREGA = Object.freeze(Object.values(StatusEntrega));
const PAGAMENTOS_PREVISTOS = Object.freeze(Object.values(PagamentoPrevisto));

/** Alias legado Sprint 1/2 → CONCLUIDA */
function normalizarStatusEntrega(valor) {
  const s = String(valor || '').toUpperCase().trim();
  if (s === 'FINALIZADA') return StatusEntrega.CONCLUIDA;
  if (STATUS_ENTREGA.includes(s)) return s;
  return null;
}

function normalizarStatusVenda(valor) {
  const s = String(valor || '').toUpperCase().trim();
  if (STATUS_VENDA.includes(s)) return s;
  // legado: reserva_entrega / pendente → ABERTA
  if (s === 'RESERVA_ENTREGA' || s === 'PENDENTE' || s === 'ABERTA') {
    return StatusVenda.ABERTA;
  }
  if (s === 'CONCLUIDA' || s === 'FINALIZADA') return StatusVenda.FINALIZADA;
  if (s === 'CANCELADA') return StatusVenda.CANCELADA;
  return null;
}

module.exports = {
  TipoVenda,
  StatusVenda,
  StatusEntrega,
  PagamentoPrevisto,
  TIPOS_VENDA,
  STATUS_VENDA,
  STATUS_ENTREGA,
  PAGAMENTOS_PREVISTOS,
  normalizarStatusEntrega,
  normalizarStatusVenda
};
