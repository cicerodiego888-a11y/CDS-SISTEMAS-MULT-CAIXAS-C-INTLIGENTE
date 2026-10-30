/**
 * TEF-13 — Identidade estável de operação TEF no PDV.
 * Mesma operação (retry/timeout) reutiliza a chave; nova venda/operação legítima gera outra.
 * Sem efeitos de rede; testável em Node e browser.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.TefIdempotencia = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ESTADOS = Object.freeze({
    CRIADO: 'criado',
    ENVIADO: 'enviado',
    APROVADO: 'aprovado',
    NEGADO: 'negado',
    INCONCLUSIVO: 'inconclusivo',
    ABORTADO_ANTES_ENVIO: 'abortado_antes_envio'
  });

  function gerarIdOperacao(agora) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    const t = (agora || Date.now()).toString(36);
    const r = Math.random().toString(36).slice(2, 10);
    return `op-${t}-${r}`;
  }

  function normalizarValor(valor) {
    const n = Number(valor);
    return Number.isFinite(n) ? n.toFixed(2) : '0.00';
  }

  function normalizarParcelas(parcelas) {
    const n = Math.trunc(Number(parcelas) || 1);
    return n > 0 ? n : 1;
  }

  function montarFingerprint(op = {}) {
    const venda = op.venda_id == null || op.venda_id === '' ? 'sem-venda' : String(op.venda_id);
    const tipo = String(op.tipo || '').toLowerCase().trim();
    return [venda, tipo, normalizarValor(op.valor), String(normalizarParcelas(op.parcelas))].join('|');
  }

  function montarChave(operationId) {
    return `pdv-op-${operationId}`;
  }

  function classificarResposta(data = {}, meta = {}) {
    if (meta.falhaAntesEnvio === true) {
      return { estado: ESTADOS.ABORTADO_ANTES_ENVIO, inconclusivo: false, aprovado: false, negado: false };
    }
    const status = String(data.status || '').toLowerCase();
    const codigo = String(data.codigo || data.codigo_resposta || '').toUpperCase();
    const aprovado = data.aprovado === true
      || data.sucesso === true
      || status === 'aprovado';
    if (aprovado) {
      return { estado: ESTADOS.APROVADO, inconclusivo: false, aprovado: true, negado: false };
    }
    const inconclusivo = data.retryAllowed === false
      || status === 'pendente'
      || codigo === 'TIMEOUT'
      || codigo === 'TEF_UNKNOWN'
      || meta.httpStatus === 0
      || meta.networkError === true;
    if (inconclusivo) {
      return { estado: ESTADOS.INCONCLUSIVO, inconclusivo: true, aprovado: false, negado: false };
    }
    return { estado: ESTADOS.NEGADO, inconclusivo: false, aprovado: false, negado: true };
  }

  function criarGerenciador(opcoes = {}) {
    let sessao = null;
    const agoraFn = typeof opcoes.agora === 'function' ? opcoes.agora : () => Date.now();
    const idFn = typeof opcoes.gerarId === 'function'
      ? opcoes.gerarId
      : () => gerarIdOperacao(agoraFn());

    function snapshot() {
      return sessao ? { ...sessao } : null;
    }

    function limpar() {
      sessao = null;
    }

    /** Nova venda / carrinho limpo: encerra identidade anterior. */
    function marcarNovaVenda() {
      limpar();
    }

    function deveReutilizar(fp) {
      if (!sessao || sessao.fingerprint !== fp) return false;
      return sessao.estado === ESTADOS.CRIADO
        || sessao.estado === ESTADOS.ENVIADO
        || sessao.estado === ESTADOS.INCONCLUSIVO
        || sessao.estado === ESTADOS.ABORTADO_ANTES_ENVIO
        || sessao.estado === ESTADOS.APROVADO;
    }

    /**
     * Obtém chave estável para a operação.
     * Reusa em retry/timeout/aprovado (evita 2ª cobrança por nova chave).
     * Nova chave após negado definitivo ou fingerprint diferente / novaOperacao.
     */
    function obterOuCriarChave(op = {}) {
      if (op.idempotency_key) {
        const chave = String(op.idempotency_key);
        const fp = montarFingerprint(op);
        if (!sessao || sessao.chave !== chave) {
          sessao = {
            operationId: chave.replace(/^pdv-op-/, '') || idFn(),
            chave,
            fingerprint: fp,
            estado: ESTADOS.CRIADO,
            tipo: op.tipo,
            valor: Number(op.valor),
            parcelas: normalizarParcelas(op.parcelas),
            venda_id: op.venda_id == null ? null : op.venda_id,
            criadoEm: agoraFn()
          };
        }
        return { chave: sessao.chave, reutilizada: true, sessao: snapshot(), fingerprint: sessao.fingerprint };
      }

      const fp = montarFingerprint(op);
      if (op.novaOperacao === true) {
        limpar();
      }

      if (deveReutilizar(fp)) {
        return {
          chave: sessao.chave,
          reutilizada: true,
          sessao: snapshot(),
          fingerprint: sessao.fingerprint
        };
      }

      const operationId = idFn();
      sessao = {
        operationId,
        chave: montarChave(operationId),
        fingerprint: fp,
        estado: ESTADOS.CRIADO,
        tipo: op.tipo,
        valor: Number(op.valor),
        parcelas: normalizarParcelas(op.parcelas),
        venda_id: op.venda_id == null ? null : op.venda_id,
        criadoEm: agoraFn()
      };
      return {
        chave: sessao.chave,
        reutilizada: false,
        sessao: snapshot(),
        fingerprint: sessao.fingerprint
      };
    }

    function marcarEnviado(chave) {
      if (!sessao || sessao.chave !== chave) return snapshot();
      if (sessao.estado === ESTADOS.CRIADO || sessao.estado === ESTADOS.ABORTADO_ANTES_ENVIO) {
        sessao.estado = ESTADOS.ENVIADO;
        sessao.enviadoEm = agoraFn();
      }
      return snapshot();
    }

    function registrarResultado(chave, data, meta = {}) {
      if (!sessao || (chave && sessao.chave !== chave)) {
        return { sessao: snapshot(), classificacao: null };
      }
      const classificacao = classificarResposta(data, meta);
      sessao.estado = classificacao.estado;
      sessao.ultimoCodigo = data && (data.codigo || data.codigo_resposta) || null;
      sessao.ultimoStatus = data && data.status || null;
      sessao.atualizadoEm = agoraFn();
      return { sessao: snapshot(), classificacao };
    }

    return {
      ESTADOS,
      montarFingerprint,
      montarChave,
      classificarResposta,
      obterOuCriarChave,
      marcarEnviado,
      registrarResultado,
      marcarNovaVenda,
      limpar,
      snapshot
    };
  }

  let gerenciadorPadrao = criarGerenciador();

  return {
    ESTADOS,
    montarFingerprint,
    montarChave,
    classificarResposta,
    gerarIdOperacao,
    criarGerenciador,
    obterOuCriarChave: (...args) => gerenciadorPadrao.obterOuCriarChave(...args),
    marcarEnviado: (...args) => gerenciadorPadrao.marcarEnviado(...args),
    registrarResultado: (...args) => gerenciadorPadrao.registrarResultado(...args),
    marcarNovaVenda: (...args) => gerenciadorPadrao.marcarNovaVenda(...args),
    limpar: (...args) => gerenciadorPadrao.limpar(...args),
    snapshot: (...args) => gerenciadorPadrao.snapshot(...args),
    /** Reinicia o singleton (testes). */
    _resetPadraoParaTestes(opcoes) {
      gerenciadorPadrao = criarGerenciador(opcoes || {});
      return gerenciadorPadrao;
    }
  };
});
