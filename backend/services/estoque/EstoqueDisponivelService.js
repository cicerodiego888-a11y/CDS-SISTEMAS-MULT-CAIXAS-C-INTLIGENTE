/**
 * Cálculo de estoque disponível × reservado (Sprint 2)
 * Não altera saldos físicos — apenas deriva disponibilidade.
 */

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {{ saldo_fiscal?: number, saldo_nao_fiscal?: number, reservado_fiscal?: number, reservado_nao_fiscal?: number, estoque_atual?: number }} produto
 */
function calcularEstoqueProduto(produto = {}) {
  const saldoFiscal = toNum(produto.saldo_fiscal);
  const saldoNaoFiscal = toNum(produto.saldo_nao_fiscal);
  const reservadoFiscal = Math.max(0, toNum(produto.reservado_fiscal));
  const reservadoNaoFiscal = Math.max(0, toNum(produto.reservado_nao_fiscal));

  const estoqueFisico = produto.estoque_atual != null
    ? toNum(produto.estoque_atual)
    : saldoFiscal + saldoNaoFiscal;

  const disponivelFiscal = Math.max(0, saldoFiscal - reservadoFiscal);
  const disponivelNaoFiscal = Math.max(0, saldoNaoFiscal - reservadoNaoFiscal);

  return {
    estoque_fisico: estoqueFisico,
    saldo_fiscal: saldoFiscal,
    saldo_nao_fiscal: saldoNaoFiscal,
    reservado_fiscal: reservadoFiscal,
    reservado_nao_fiscal: reservadoNaoFiscal,
    disponivel_fiscal: disponivelFiscal,
    disponivel_nao_fiscal: disponivelNaoFiscal,
    disponivel_total: disponivelFiscal + disponivelNaoFiscal
  };
}

/**
 * Fonte única de disponibilidade operacional F×NF para venda/distribuição:
 * A = max(0, saldo_fiscal − reservado_fiscal), B = max(0, saldo_nao_fiscal − reservado_nao_fiscal).
 * Reserva maior que o saldo resulta em 0 (nunca negativo).
 * O distribuidor recebe estes valores prontos; saldo físico serve só para exibição/baixa.
 * Espelho no PDV: pdvSaldosDisponiveisMotorProduto (frontend/pdv/js/pdv.js).
 */
function saldosDisponiveisMotorFxNf(produto = {}) {
  const estoque = calcularEstoqueProduto(produto);
  return {
    saldoFiscal: estoque.disponivel_fiscal,
    saldoNaoFiscal: estoque.disponivel_nao_fiscal,
    estoque
  };
}

/**
 * E-Comprometido por natureza que a venda não pode consumir.
 * O crédito do próprio pedido (já somado ao disponível fiscal recebido pelo motor) é descontado;
 * a transferência Reserva → Padrão aplicada em memória não conta como crédito.
 */
function comprometidoMotorFxNf(produto = {}, saldoFiscalMotor = 0, transferidoEmMemoria = 0) {
  const estoque = calcularEstoqueProduto(produto);
  const creditoPedido = Math.max(
    0,
    toNum(saldoFiscalMotor) - Math.max(0, toNum(transferidoEmMemoria)) - estoque.disponivel_fiscal
  );
  return {
    fiscal: Math.max(0, estoque.reservado_fiscal - creditoPedido),
    naoFiscal: estoque.reservado_nao_fiscal
  };
}

module.exports = {
  calcularEstoqueProduto,
  saldosDisponiveisMotorFxNf,
  comprometidoMotorFxNf,
  toNum
};
