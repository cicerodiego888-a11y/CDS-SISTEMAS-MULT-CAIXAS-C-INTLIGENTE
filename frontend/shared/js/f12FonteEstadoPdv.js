/**
 * Fonte única do estado Fiscal/Não Fiscal efetivo do PDV.
 *
 * Fonte oficial: F12PolicyResolver → backend / F12PolicyService
 * localStorage (pdv_modo_fiscal_ativo) = espelho da resolução
 * mecanismo legado (modo_dashboard_fiscal) NÃO pode sobrescrever o PDV
 */
(function (root) {
  const ORIGEM_F12 = 'f12-policy';
  const ORIGEM_LEGADO = 'legado';

  function obterGlobals(contexto) {
    if (contexto && contexto.globals) return contexto.globals;
    return root;
  }

  function pdvUsaF12PolicyComoFonteOficial(contexto) {
    const ctx = contexto || {};
    const g = obterGlobals(ctx);
    const modulo = ctx.CDS_MODULE != null ? ctx.CDS_MODULE : g.CDS_MODULE;
    const resolver = Object.prototype.hasOwnProperty.call(ctx, 'F12PolicyResolver')
      ? ctx.F12PolicyResolver
      : (typeof g.F12PolicyResolver !== 'undefined' ? g.F12PolicyResolver : null);
    return modulo === 'pdv' && !!resolver;
  }

  function normalizarEstado(valor) {
    if (valor === true || valor === '1' || valor === 1 || valor === 'true') return true;
    if (valor === false || valor === '0' || valor === 0 || valor === 'false') return false;
    return null;
  }

  /**
   * Decide o estado efetivo do PDV quando o F12 e o mecanismo antigo discordam.
   * No PDV com F12Policy, o legado é sempre ignorado.
   */
  function resolverEstadoEfetivoPdv(opcoes) {
    const opts = opcoes || {};
    const f12 = normalizarEstado(opts.estadoF12);
    const legado = normalizarEstado(opts.estadoLegado);
    const contexto = opts.contexto || opts;

    if (pdvUsaF12PolicyComoFonteOficial(contexto)) {
      return {
        estadoEfetivo: f12,
        origem: ORIGEM_F12,
        legadoIgnorado: true,
        aplicadoLegado: false
      };
    }

    return {
      estadoEfetivo: legado,
      origem: ORIGEM_LEGADO,
      legadoIgnorado: false,
      aplicadoLegado: true
    };
  }

  function aplicarTentativaSincronizacaoLegada(estadoAtualF12, estadoRemotoLegado, contexto) {
    return resolverEstadoEfetivoPdv({
      estadoF12: estadoAtualF12,
      estadoLegado: estadoRemotoLegado,
      contexto
    }).estadoEfetivo;
  }

  function podeMecanismoAntigoAlterarEstadoPdv(contexto) {
    return !pdvUsaF12PolicyComoFonteOficial(contexto);
  }

  const api = {
    ORIGEM_F12,
    ORIGEM_LEGADO,
    pdvUsaF12PolicyComoFonteOficial,
    normalizarEstado,
    resolverEstadoEfetivoPdv,
    aplicarTentativaSincronizacaoLegada,
    podeMecanismoAntigoAlterarEstadoPdv
  };

  root.F12FonteEstadoPdv = api;
  root.pdvUsaF12PolicyComoFonteOficial = pdvUsaF12PolicyComoFonteOficial;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
