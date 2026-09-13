/**
 * Interpreta payload de /produtos/identificar para o fluxo do PDV (Sprint 05 + 09).
 * Contrato compartilhado — espelhado em frontend/pdv/js/pdv.js.
 *
 * Sprint 09: MIP miss / desabilitado legado → acao 'legado' (fallback).
 * @module motores/produto-identidade/adapters/interpretarResultadoPdv
 */

/**
 * @param {Object} resultado — payload de PdvProdutoIdentificacaoService
 * @returns {{ acao: string, produtoId?: number|null, peso?: number|null, valorTotal?: number|null, plu?: string|null, etiquetaBalanca?: boolean, fallbackLegado?: boolean }}
 */
function interpretarResultadoPdv(resultado) {
  // Compat: payloads antigos com habilitado=false → fallback legado
  if (!resultado || resultado.habilitado === false) {
    return { acao: 'legado', fallbackLegado: true };
  }

  if (!resultado.encontrado) {
    // Sprint 09 — MIP não encontrou → PDV deve executar busca legado
    return {
      acao: 'legado',
      fallbackLegado: true,
      plu: resultado.meta && resultado.meta.plu != null ? String(resultado.meta.plu) : null,
      etiquetaBalanca: resultado.etiquetaBalanca === true
        || resultado.strategy === 'ETIQUETA_BALANCA'
    };
  }

  const produtoId = resultado.produtoId != null
    ? Number(resultado.produtoId)
    : (resultado.produto && resultado.produto.id != null ? Number(resultado.produto.id) : null);

  const ehBalanca = resultado.etiquetaBalanca === true
    || resultado.strategy === 'ETIQUETA_BALANCA';

  if (ehBalanca) {
    const meta = resultado.meta || {};
    return {
      acao: 'balanca',
      produtoId,
      peso: meta.peso != null ? Number(meta.peso) : null,
      valorTotal: meta.valorTotal != null ? Number(meta.valorTotal) : null,
      tipoPayload: meta.tipoPayload || null,
      plu: meta.plu != null ? String(meta.plu) : null,
      layoutId: meta.layoutId || null
    };
  }

  return {
    acao: 'normal',
    produtoId,
    metodo: resultado.metodo || null,
    strategy: resultado.strategy || null
  };
}

/**
 * Calcula peso para etiqueta VALOR quando meta.peso ausente.
 * @param {{ peso?: number|null, valorTotal?: number|null }} dados
 * @param {number} precoKg
 */
function calcularPesoEtiquetaPdv(dados, precoKg) {
  const preco = Number(precoKg);
  let peso = dados && dados.peso != null ? Number(dados.peso) : null;
  const valorTotal = dados && dados.valorTotal != null ? Number(dados.valorTotal) : null;

  if ((peso == null || !Number.isFinite(peso) || peso <= 0) && valorTotal != null && valorTotal > 0 && preco > 0) {
    peso = valorTotal / preco;
  }

  if (!Number.isFinite(peso) || peso <= 0) return null;
  return peso;
}

module.exports = {
  interpretarResultadoPdv,
  calcularPesoEtiquetaPdv
};
