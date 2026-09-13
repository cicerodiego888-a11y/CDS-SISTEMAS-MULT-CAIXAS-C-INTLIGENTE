/**
 * Resolução oficial do caixa atual para o F12.
 *
 * Fonte única: terminal atual → terminais.caixa_id → caixas.id
 *
 * TERMINAL != CAIXA. Nunca usar terminal.id como caixaId.
 * Nunca assumir Caixa 1 quando o caixa não estiver identificado.
 */
(function (root) {
  const MSG_CAIXA_NAO_IDENTIFICADO = 'Não foi possível identificar o caixa atual.';

  function normalizarId(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = Number(valor);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function obterGlobals(contexto) {
    if (contexto && contexto.globals) return contexto.globals;
    return root;
  }

  /**
   * Identifica o terminal atual pelo contexto oficial (objeto do heartbeat)
   * ou, em último caso, pelo id já registrado na sessão.
   * Não inventa um terminal.
   */
  function identificarTerminalAtual(contexto) {
    const ctx = contexto || {};
    if (ctx.terminal && typeof ctx.terminal === 'object') {
      return ctx.terminal;
    }

    const g = obterGlobals(ctx);
    if (g.__cdsTerminalAtual && typeof g.__cdsTerminalAtual === 'object') {
      return g.__cdsTerminalAtual;
    }

    const terminalId = normalizarId(g.terminalId);
    if (!terminalId) return null;

    return {
      id: terminalId,
      caixa_id: normalizarId(g.terminalCaixaId)
    };
  }

  /**
   * Extrai SOMENTE o caixa_id vinculado ao terminal.
   * Nunca usa terminal.id.
   */
  function extrairCaixaIdVinculado(terminal) {
    if (!terminal || typeof terminal !== 'object') return null;
    return normalizarId(terminal.caixa_id);
  }

  function validarCaixaExiste(caixaId, caixas) {
    const id = normalizarId(caixaId);
    if (!id) return false;
    if (Array.isArray(caixas)) {
      return caixas.some((caixa) => normalizarId(caixa && caixa.id) === id);
    }
    return true;
  }

  function resultadoErro(terminalId) {
    return {
      ok: false,
      caixaId: null,
      terminalId: normalizarId(terminalId),
      erro: MSG_CAIXA_NAO_IDENTIFICADO
    };
  }

  /**
   * Resolução síncrona a partir do contexto já conhecido.
   * Usada pelos testes e pelo F12 quando o heartbeat já registrou o terminal.
   */
  function resolverCaixaAtual(contexto) {
    const ctx = contexto || {};
    const terminal = identificarTerminalAtual(ctx);
    const terminalId = terminal ? normalizarId(terminal.id) : null;

    if (!terminalId) {
      return resultadoErro(null);
    }

    const caixaId = extrairCaixaIdVinculado(terminal);
    if (!caixaId) {
      return resultadoErro(terminalId);
    }

    if (!validarCaixaExiste(caixaId, ctx.caixas)) {
      return resultadoErro(terminalId);
    }

    return {
      ok: true,
      caixaId,
      terminalId,
      erro: null
    };
  }

  async function buscarTerminalNoServidor(terminalId, contexto) {
    const ctx = contexto || {};
    const g = obterGlobals(ctx);
    const api = ctx.apiUrl || g.API_URL || '';
    const fetchFn = ctx.fetch || (typeof fetch === 'function' ? fetch : null);

    if (!api || !fetchFn) return null;

    try {
      const token = (typeof ctx.getToken === 'function' && ctx.getToken())
        || (typeof localStorage !== 'undefined' && localStorage.getItem('token'))
        || '';
      const response = await fetchFn(`${api}/terminais`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response || !response.ok) return null;
      const lista = await response.json();
      const rows = Array.isArray(lista) ? lista : (lista && lista.data) || [];
      return rows.find((item) => normalizarId(item && item.id) === terminalId) || null;
    } catch (err) {
      console.warn('[F12]', MSG_CAIXA_NAO_IDENTIFICADO, err);
      return null;
    }
  }

  async function buscarCaixaSessaoAberta(terminalId, contexto) {
    const ctx = contexto || {};
    const g = obterGlobals(ctx);
    const api = ctx.apiUrl || g.API_URL || '';
    const fetchFn = ctx.fetch || (typeof fetch === 'function' ? fetch : null);
    const tid = normalizarId(terminalId);
    if (!api || !fetchFn || !tid) return null;

    try {
      const token = (typeof ctx.getToken === 'function' && ctx.getToken())
        || (typeof localStorage !== 'undefined' && localStorage.getItem('token'))
        || '';
      const response = await fetchFn(`${api}/caixa/aberto?terminal_id=${tid}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response || !response.ok) return null;
      const data = await response.json();
      if (!data) return null;
      // Só o caixa de cadastro (caixas.id). Nunca usar id do turno (tabela caixa).
      return normalizarId(
        data.caixa_config_id
        || (data.sessao && (data.sessao.caixa_id || data.sessao.caixaId))
        || null
      );
    } catch (err) {
      console.warn('[F12] Fallback sessão de caixa indisponível:', err);
      return null;
    }
  }

  /**
   * Fonte única do caixa atual para o F12.
   * 1) terminal.caixa_id
   * 2) consulta cadastro do terminal
   * 3) sessão de caixa aberta neste terminal
   */
  async function obterCaixaAtual(contexto) {
    const ctx = contexto || {};
    const inicial = resolverCaixaAtual(ctx);
    if (inicial.ok) return inicial;

    const terminal = identificarTerminalAtual(ctx);
    const terminalId = terminal ? normalizarId(terminal.id) : null;
    if (!terminalId) return inicial;

    if (extrairCaixaIdVinculado(terminal) && Array.isArray(ctx.caixas)) {
      return inicial;
    }

    const fetched = await buscarTerminalNoServidor(terminalId, ctx);
    if (fetched) {
      const g = obterGlobals(ctx);
      atualizarContextoTerminalAtual(fetched, g);
      const viaTerminal = resolverCaixaAtual({
        ...ctx,
        terminal: fetched
      });
      if (viaTerminal.ok) return viaTerminal;
    }

    const caixaSessao = await buscarCaixaSessaoAberta(terminalId, ctx);
    if (caixaSessao) {
      const g = obterGlobals(ctx);
      if (g.__cdsTerminalAtual && typeof g.__cdsTerminalAtual === 'object') {
        g.__cdsTerminalAtual.caixa_id = caixaSessao;
      }
      g.terminalCaixaId = caixaSessao;
      return {
        ok: true,
        caixaId: caixaSessao,
        terminalId,
        erro: null,
        origem: 'sessao_aberta'
      };
    }

    return {
      ok: false,
      caixaId: null,
      terminalId,
      erro: 'Terminal sem caixa vinculado. Vincule este terminal a um caixa em Configurações → Caixas/Terminais.'
    };
  }

  function atualizarContextoTerminalAtual(terminal, globals) {
    const g = globals || root;
    const terminalId = terminal ? normalizarId(terminal.id) : null;
    if (!terminalId) {
      g.__cdsTerminalAtual = null;
      g.terminalCaixaId = null;
      return null;
    }

    const caixaId = extrairCaixaIdVinculado(terminal);
    g.__cdsTerminalAtual = {
      id: terminalId,
      caixa_id: caixaId,
      hostname: terminal.hostname || null,
      nome: terminal.nome || null
    };
    g.terminalCaixaId = caixaId;
    return g.__cdsTerminalAtual;
  }

  const api = {
    MSG_CAIXA_NAO_IDENTIFICADO,
    normalizarId,
    identificarTerminalAtual,
    extrairCaixaIdVinculado,
    validarCaixaExiste,
    resolverCaixaAtual,
    obterCaixaAtual,
    atualizarContextoTerminalAtual
  };

  root.ObterCaixaAtual = api;
  root.obterCaixaAtual = obterCaixaAtual;
  root.resolverCaixaAtual = resolverCaixaAtual;
  root.atualizarContextoTerminalAtual = atualizarContextoTerminalAtual;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
