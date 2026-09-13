/**
 * RC9.0 — Política operacional de Entrada (Motor de Compras).
 * Define quais motores executam conforme o tipo da entrada.
 * Não altera regras fiscais, XML ou Motor Fiscal.
 */

'use strict';

const TIPO_ENTRADA = Object.freeze({
  REVENDA: 'REVENDA',
  INDUSTRIALIZACAO: 'INDUSTRIALIZACAO',
  USO_CONSUMO: 'USO_CONSUMO',
  BONIFICACAO: 'BONIFICACAO'
});

const TIPO_ENTRADA_PADRAO = TIPO_ENTRADA.REVENDA;

const ROTULOS = Object.freeze({
  [TIPO_ENTRADA.REVENDA]: 'Compra para Revenda',
  [TIPO_ENTRADA.INDUSTRIALIZACAO]: 'Compra para Industrialização',
  [TIPO_ENTRADA.USO_CONSUMO]: 'Compra para Uso e Consumo',
  [TIPO_ENTRADA.BONIFICACAO]: 'Compra por Bonificação'
});

const BADGE_USO_CONSUMO = 'USO E CONSUMO';

function normalizarTipoEntrada(valor) {
  const raw = String(valor || '').trim().toUpperCase();
  if (raw === TIPO_ENTRADA.INDUSTRIALIZACAO || raw === 'INDUSTRIALIZACAO') {
    return TIPO_ENTRADA.INDUSTRIALIZACAO;
  }
  if (raw === TIPO_ENTRADA.USO_CONSUMO || raw === 'USO E CONSUMO' || raw === 'USO_E_CONSUMO') {
    return TIPO_ENTRADA.USO_CONSUMO;
  }
  if (raw === TIPO_ENTRADA.BONIFICACAO || raw === 'BONIFICACAO' || raw === 'BONIFICAÇÃO') {
    return TIPO_ENTRADA.BONIFICACAO;
  }
  return TIPO_ENTRADA.REVENDA;
}

function isUsoConsumo(tipo) {
  return normalizarTipoEntrada(tipo) === TIPO_ENTRADA.USO_CONSUMO;
}

function isBonificacao(tipo) {
  return normalizarTipoEntrada(tipo) === TIPO_ENTRADA.BONIFICACAO;
}

function isEntradaSimplificada(tipo) {
  return isUsoConsumo(tipo);
}

/**
 * Motores executados por tipo de entrada.
 * @param {string} tipo
 */
function resolverPolitica(tipo) {
  const normalizado = normalizarTipoEntrada(tipo);
  const simplificada = isEntradaSimplificada(normalizado);

  return {
    tipoEntrada: normalizado,
    label: ROTULOS[normalizado] || ROTULOS[TIPO_ENTRADA.REVENDA],
    executarCadastroProdutos: !simplificada,
    executarEstoque: !simplificada,
    executarCustoMedio: !simplificada && normalizado !== TIPO_ENTRADA.BONIFICACAO,
    executarMiip: !simplificada,
    executarItensOperacionais: !simplificada,
    executarFinanceiro: true,
    executarFiscal: true,
    executarCentral: true,
    executarEscrituracao: true
  };
}

function listarTiposEntrada() {
  return Object.values(TIPO_ENTRADA).map((id) => ({
    id,
    label: ROTULOS[id]
  }));
}

module.exports = {
  TIPO_ENTRADA,
  TIPO_ENTRADA_PADRAO,
  ROTULOS,
  BADGE_USO_CONSUMO,
  normalizarTipoEntrada,
  isUsoConsumo,
  isBonificacao,
  isEntradaSimplificada,
  resolverPolitica,
  listarTiposEntrada
};
