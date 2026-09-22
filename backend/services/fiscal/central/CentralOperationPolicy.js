/**
 * CentralOperationPolicy — decide se uma ação pode executar (Sprint 5).
 *
 * NÃO consulta SEFAZ. NÃO altera cursor. NÃO ignora Gate/Rate/Cooldown/CB/Lock.
 * A política responde "pode executar?"; o Gate responde "pode consultar agora?".
 *
 * @module services/fiscal/central/CentralOperationPolicy
 */
'use strict';

const {
  ModoOperacao,
  ClassificacaoAcao,
  StatusDecisao,
  MODO_PADRAO,
  normalizarModo
} = require('./CentralOperationModes');
const { classificarAcao, flagGranular } = require('./CentralActionTypes');

const FLAGS_PADRAO = Object.freeze({
  sincronizacao: true,
  recuperacaoXml: true,
  retry: true,
  reconcilicao: true
});

/**
 * @param {Object} [config]
 * @returns {Object}
 */
function normalizarConfig(config = {}) {
  return {
    modo: normalizarModo(config.modo ?? config.modoOperacao ?? MODO_PADRAO),
    flags: {
      ...FLAGS_PADRAO,
      ...(config.flags || config.acoesAutomaticas || {})
    },
    cnpj: config.cnpj ? String(config.cnpj).replace(/\D/g, '') : null,
    ambiente: config.ambiente != null ? (Number(config.ambiente) === 1 ? 1 : 2) : null
  };
}

class CentralOperationPolicy {
  /**
   * @param {Object} [deps]
   * @param {Object} [deps.config] — { modo, flags, cnpj, ambiente }
   */
  constructor(deps = {}) {
    this._config = normalizarConfig(deps.config || {});
  }

  obterConfig() {
    return { ...this._config, flags: { ...this._config.flags } };
  }

  atualizarConfig(patch = {}) {
    this._config = normalizarConfig({
      ...this._config,
      ...patch,
      flags: { ...this._config.flags, ...(patch.flags || patch.acoesAutomaticas || {}) }
    });
    return this.obterConfig();
  }

  /**
   * Decide se a ação pode seguir.
   * @param {Object} params
   * @param {string} params.acao
   * @param {string} [params.modo] — override pontual
   * @param {boolean} [params.confirmado]
   * @param {Object} [params.protecoes] — { cooldown, circuitOpen, rateLimited, lockAtivo, motivo }
   * @param {Object} [params.flags]
   */
  decidir(params = {}) {
    const acao = String(params.acao || '').toUpperCase();
    const classificacao = classificarAcao(acao);
    const modo = normalizarModo(params.modo ?? this._config.modo);
    const flags = { ...this._config.flags, ...(params.flags || {}) };
    const confirmado = params.confirmado === true;
    const protecoes = params.protecoes || {};

    const base = {
      acao,
      classificacao,
      modo,
      cnpj: this._config.cnpj,
      ambiente: this._config.ambiente
    };

    // Proteções estruturais — nunca ignorar
    if (protecoes.cooldown || protecoes.circuitOpen || protecoes.rateLimited) {
      return {
        ...base,
        permitido: false,
        executarAutomatico: false,
        exigeConfirmacao: false,
        status: StatusDecisao.AGUARDANDO_PROXIMA_JANELA,
        motivo: protecoes.motivo
          || (protecoes.circuitOpen
            ? 'Circuit Breaker OPEN — aguardar recuperação'
            : protecoes.cooldown
              ? 'Cooldown SEFAZ ativo — aguardar próxima janela'
              : 'Rate limit ativo — aguardar pacing')
      };
    }
    if (protecoes.lockAtivo) {
      return {
        ...base,
        permitido: false,
        executarAutomatico: false,
        exigeConfirmacao: false,
        status: StatusDecisao.BLOQUEADO,
        motivo: protecoes.motivo || 'Sincronização já em andamento (lock CNPJ+ambiente)'
      };
    }

    if (classificacao === ClassificacaoAcao.NEVER_AUTOMATIC) {
      return {
        ...base,
        permitido: false,
        executarAutomatico: false,
        exigeConfirmacao: true,
        status: StatusDecisao.BLOQUEADO,
        motivo: 'Ação NEVER_AUTOMATIC — nunca executa automaticamente'
      };
    }

    if (classificacao === ClassificacaoAcao.CONFIRMATION_REQUIRED) {
      if (confirmado) {
        return {
          ...base,
          permitido: true,
          executarAutomatico: false,
          exigeConfirmacao: false,
          status: StatusDecisao.EXECUTAR,
          motivo: 'Confirmação recebida — executar ação'
        };
      }
      return {
        ...base,
        permitido: false,
        executarAutomatico: false,
        exigeConfirmacao: true,
        status: StatusDecisao.ACAO_REQUER_CONFIRMACAO,
        motivo: 'Ação exige confirmação do operador'
      };
    }

    // SAFE
    const flag = flagGranular(acao);
    if (flag && flags[flag] === false) {
      return {
        ...base,
        permitido: false,
        executarAutomatico: false,
        exigeConfirmacao: true,
        status: StatusDecisao.AGUARDAR_CONFIRMACAO,
        motivo: `Flag granular "${flag}" desabilitada — tratar como assistido`
      };
    }

    if (modo === ModoOperacao.AUTOMATICO) {
      return {
        ...base,
        permitido: true,
        executarAutomatico: true,
        exigeConfirmacao: false,
        status: StatusDecisao.EXECUTAR,
        motivo: 'Modo AUTOMÁTICO — ação SAFE autorizada (sujeita ao Gate)'
      };
    }

    // ASSISTIDO (padrão)
    if (confirmado) {
      return {
        ...base,
        permitido: true,
        executarAutomatico: false,
        exigeConfirmacao: false,
        status: StatusDecisao.EXECUTAR,
        motivo: 'Modo ASSISTIDO — confirmação do operador recebida'
      };
    }

    return {
      ...base,
      permitido: false,
      executarAutomatico: false,
      exigeConfirmacao: true,
      status: StatusDecisao.AGUARDAR_CONFIRMACAO,
      motivo: 'Modo ASSISTIDO — aguardar confirmação do operador'
    };
  }
}

CentralOperationPolicy.FLAGS_PADRAO = FLAGS_PADRAO;
CentralOperationPolicy.normalizarConfig = normalizarConfig;
CentralOperationPolicy.MODO_PADRAO = MODO_PADRAO;

module.exports = CentralOperationPolicy;
