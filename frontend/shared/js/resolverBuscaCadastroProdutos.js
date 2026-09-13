'use strict';

/**
 * Política do cadastro de produtos: MIB válido substitui o fallback local.
 * Não mistura as duas listas na listagem principal.
 */
(function (global) {
  'use strict';

  function itensMibValidos(resultado) {
    if (!resultado || typeof resultado !== 'object') return [];
    if (!Array.isArray(resultado.itens)) return [];
    return resultado.itens.filter((item) => item != null);
  }

  function mibPossuiResultadosValidos(resultado) {
    return itensMibValidos(resultado).length > 0;
  }

  /**
   * @param {{
   *   resultado?: { itens?: object[] }|null,
   *   erro?: Error|string|null,
   *   sdkDisponivel?: boolean,
   *   fallbackItens?: object[],
   *   consultaVazia?: boolean,
   *   listaCompleta?: object[]
   * }} ctx
   */
  function resolverResultadoBuscaCadastro(ctx) {
    const c = ctx || {};
    if (c.consultaVazia) {
      return {
        itens: Array.isArray(c.listaCompleta) ? c.listaCompleta.slice() : [],
        fonte: 'arvore',
        preservarOrdem: false
      };
    }

    const fallback = Array.isArray(c.fallbackItens) ? c.fallbackItens.slice() : [];

    if (c.sdkDisponivel === false) {
      return { itens: fallback, fonte: 'fallback', preservarOrdem: false };
    }

    if (c.erro) {
      return { itens: fallback, fonte: 'fallback', preservarOrdem: false, erro: c.erro };
    }

    if (mibPossuiResultadosValidos(c.resultado)) {
      return {
        itens: itensMibValidos(c.resultado).slice(),
        fonte: 'mib',
        preservarOrdem: true
      };
    }

    return { itens: fallback, fonte: 'fallback', preservarOrdem: false };
  }

  function preservarCamposRankingMib(hit, extra) {
    const base = extra && typeof extra === 'object' ? extra : {};
    const src = hit && typeof hit === 'object' ? hit : {};
    return {
      ...base,
      mib_score: src.mib_score,
      mib_match_tipo: src.mib_match_tipo,
      mib_match_rank: src.mib_match_rank,
      _fonteBusca: src._fonte || base._fonteBusca || 'mib'
    };
  }

  /**
   * Busca explícita (operacional ou MIB) tem prioridade sobre a árvore.
   * Sem busca, categoria continua filtrando normalmente.
   */
  function preservarHitsCadastro(itens, opcoes) {
    const lista = Array.isArray(itens) ? itens.slice() : [];
    const opts = opcoes || {};
    const buscaAtiva = !!opts.buscaAtiva;
    const origemMib = opts.origemMib === true;
    const origemOperacional = opts.origemOperacional === true;
    const categoriaId = String(opts.categoriaId || '');
    if (buscaAtiva && (origemMib || origemOperacional)) return lista;
    if (!categoriaId) return lista;
    return lista.filter((p) => String(p.categoria_id || '') === categoriaId);
  }

  /**
   * PDV: busca operacional é a fonte principal.
   * Sem itensOperacionais no contexto, mantém o contrato Sprint 03 (MIB).
   * Estoque 0 não remove o hit.
   */
  function resolverListaPdv(ctx) {
    const c = ctx || {};
    const operacional = Array.isArray(c.itensOperacionais)
      ? c.itensOperacionais.filter((item) => item != null)
      : null;
    const mib = Array.isArray(c.itensMib) ? c.itensMib.filter((item) => item != null) : [];
    const fallback = Array.isArray(c.fallbackItens) ? c.fallbackItens.slice() : [];
    const sugestoesMib = Array.isArray(c.sugestoesMib)
      ? c.sugestoesMib.filter((item) => item != null)
      : mib;

    if (operacional) {
      if (operacional.length > 0) {
        return { itens: operacional.slice(), fonte: 'operacional', sugestoes: [] };
      }
      return {
        itens: [],
        fonte: 'operacional',
        sugestoes: sugestoesMib.slice()
      };
    }

    if (mib.length > 0) {
      return { itens: mib.slice(), fonte: 'mib', sugestoes: [] };
    }
    return { itens: fallback, fonte: 'fallback', sugestoes: [] };
  }

  function deveIgnorarRespostaBusca(seqResposta, seqAtual) {
    return Number(seqResposta) !== Number(seqAtual);
  }

  function indiceDestaqueInicialPdv(itens) {
    return Array.isArray(itens) && itens.length > 0 ? 0 : -1;
  }

  const api = {
    itensMibValidos,
    mibPossuiResultadosValidos,
    resolverResultadoBuscaCadastro,
    preservarCamposRankingMib,
    preservarHitsCadastro,
    resolverListaPdv,
    indiceDestaqueInicialPdv,
    deveIgnorarRespostaBusca
  };

  global.CdsResolverBuscaCadastroProdutos = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
