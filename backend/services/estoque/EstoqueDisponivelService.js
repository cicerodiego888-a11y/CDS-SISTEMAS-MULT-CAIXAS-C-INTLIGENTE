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

module.exports = {
  calcularEstoqueProduto,
  toNum
};
