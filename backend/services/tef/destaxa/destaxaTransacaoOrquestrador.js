'use strict';

const crypto = require('crypto');
const destaxaLogger = require('./destaxaLogger');
const {
  ERROS,
  OPERACOES,
  ESTADOS_TRANSACAO,
  CLASSIFICACAO_CODIGO,
  CODIGO_ACAO_SOLICITADA,
  FINALIZACAO_CONFIRMAR,
  FINALIZACAO_CANCELAR,
  OPERACOES_REAIS_PERMITIDAS,
  REAL_TRANSACTION_ENV,
  transacaoRealHabilitada,
  criarErro
} = require('./destaxaConstantes');
const {
  buildTransactionInput,
  buildContinuaInput,
  classificarCodigoTransacao,
  parseAcaoSolicitada,
  estadoPorAcao
} = require('./destaxaProtocolo');
const {
  FINANCIAL_STATES,
  classificarErroFinanceiro,
  montarLogDecisao
} = require('../tefFinancialSafetyPolicy');
const { consumirCapabilityAutorizacaoReconciliacao } = require('./destaxaNativeHostProtocolo');

const ESTADOS_BLOQUEIAM_NOVA = new Set([
  ESTADOS_TRANSACAO.STARTING,
  ESTADOS_TRANSACAO.WAITING_ACTION,
  ESTADOS_TRANSACAO.DISPLAY,
  ESTADOS_TRANSACAO.COLLECT,
  ESTADOS_TRANSACAO.OPTION,
  ESTADOS_TRANSACAO.FINALIZING,
  ESTADOS_TRANSACAO.TIMEOUT,
  ESTADOS_TRANSACAO.UNKNOWN,
  ESTADOS_TRANSACAO.PENDING,
  ESTADOS_TRANSACAO.UNCONFIRMED,
  ESTADOS_TRANSACAO.BLOCKED
]);

function novoTransactionId() {
  return crypto.randomBytes(8).toString('hex');
}

class DestaxaTransacaoOrquestrador {
  constructor(opcoes = {}) {
    this._driver = opcoes.driver || null;
    this._contexto = null;
    this._permitirTransacaoReal = opcoes.permitirTransacaoReal === true;
    this._exceptionalPermit = opcoes.exceptionalPermit || null;
  }

  definirDriver(driver) {
    this._driver = driver;
  }

  definirPermissaoTransacaoReal(permitir) {
    this._permitirTransacaoReal = permitir === true;
  }

  definirPermitExcepcional(permit) {
    this._exceptionalPermit = permit && permit.exceptional === true ? permit : null;
  }

  obterPermitExcepcional() {
    return this._exceptionalPermit || null;
  }

  _driverNativo() {
    return this._driver?.nome === 'native';
  }

  _gateRealOuExcepcionalOk() {
    const {
      transacaoRealEfetivaPermitida
    } = require('./destaxaAutorizacaoExcepcional');
    return transacaoRealEfetivaPermitida(this._exceptionalPermit);
  }

  _bloqueioGateReal() {
    return this._falha(
      ERROS.DESTAXA_REAL_TRANSACTION_DISABLED,
      `Transação Destaxa real desabilitada: ${REAL_TRANSACTION_ENV} != 1`,
      this._contexto?.estado || ESTADOS_TRANSACAO.IDLE,
      { preservarContexto: true, retryReason: 'DESTAXA_REAL_TRANSACTION_DISABLED' }
    );
  }

  getContexto() {
    return this._contexto ? { ...this._contexto } : null;
  }

  _financialStateUnknown() {
    return Boolean(this._contexto
      && (this._contexto.financialState ?? this._contexto.dadosUltimaResposta?.financialState) === FINANCIAL_STATES.UNKNOWN);
  }

  _log(evento, extra = {}) {
    destaxaLogger.registrar(evento, {
      operation: this._contexto?.operacao || null,
      transactionId: this._contexto?.transactionId || null,
      state: this._contexto?.estado || ESTADOS_TRANSACAO.IDLE,
      ...extra
    });
  }

  _falha(codigo, mensagem, estado = ESTADOS_TRANSACAO.ERROR, opcoes = {}) {
    if (this._contexto && opcoes.preservarContexto !== true) {
      this._contexto.estado = estado;
      this._contexto.codigoUltimo = codigo;
    }
    return {
      sucesso: false,
      codigo,
      codigoDestaxa: codigo,
      mensagem,
      estado: this._contexto?.estado || estado,
      retryAllowed: false,
      retryReason: opcoes.retryReason || null,
      contexto: this.getContexto()
    };
  }

  _montarErroFinanceiro(error, inicio) {
    const decisao = classificarErroFinanceiro(error);
    const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1e6;

    this._contexto.financialState = decisao.financialState;
    this._contexto.estado = decisao.state === 'TIMEOUT'
      ? ESTADOS_TRANSACAO.TIMEOUT
      : ESTADOS_TRANSACAO.UNKNOWN;
    this._contexto.codigoUltimo = decisao.resultCode || 'UNKNOWN';
    this._contexto.dadosUltimaResposta = {
      classificacao: decisao.financialState,
      erro: String(error?.message || error || '')
    };

    const log = montarLogDecisao({
      transactionId: this._contexto.transactionId,
      provider: 'destaxa',
      operation: this._contexto.operacao,
      decision: {
        ...decisao,
        state: this._contexto.estado
      }
    });
    this._log('transacao.retry.decision', {
      code: log.resultCode,
      financialState: log.financialState,
      retryAllowed: false,
      retryReason: log.retryReason,
      durationMs: duracaoMs
    });

    return {
      sucesso: false,
      codigoDestaxa: decisao.resultCode || 'UNKNOWN',
      classificacao: decisao.financialState,
      financialState: decisao.financialState,
      estado: this._contexto.estado,
      retryAllowed: false,
      retryReason: decisao.retryReason,
      mensagem: String(error?.message || error || ''),
      duracaoMs,
      contexto: this.getContexto(),
      requerContinuacao: false
    };
  }

  _montarRespostaDll(resultadoDll, inicio) {
    const classificacao = classificarCodigoTransacao(resultadoDll.codigo);
    const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1e6;

    this._contexto.financialState = classificacao.financialState;
    this._contexto.codigoUltimo = classificacao.codigo;
    this._contexto.dadosUltimaResposta = {
      saida: resultadoDll.saida || '',
      classificacao: classificacao.classificacao,
      financialState: classificacao.financialState,
      retryAllowed: false,
      retryReason: classificacao.retryReason,
      descricao: classificacao.descricao
    };

    let acao = null;
    if (classificacao.codigo === CODIGO_ACAO_SOLICITADA) {
      acao = parseAcaoSolicitada(resultadoDll.saida);
      this._contexto.ultimaAcao = acao;
      this._contexto.estado = estadoPorAcao(acao);
    } else {
      this._contexto.ultimaAcao = null;
      this._contexto.estado = classificacao.estadoTransacao;
    }

    this._log('transacao.step.result', {
      code: classificacao.codigo,
      action: acao?.tipo || null,
      durationMs: duracaoMs,
      classification: classificacao.classificacao,
      financialState: classificacao.financialState,
      retryAllowed: false,
      retryReason: classificacao.retryReason
    });

    const sucesso = classificacao.classificacao === CLASSIFICACAO_CODIGO.SUCCESS;

    return {
      sucesso,
      codigoDestaxa: classificacao.codigo,
      classificacao: classificacao.classificacao,
      financialState: classificacao.financialState,
      descricao: classificacao.descricao,
      estado: this._contexto.estado,
      acao,
      saida: resultadoDll.saida || '',
      duracaoMs,
      retryAllowed: false,
      retryReason: classificacao.retryReason,
      contexto: this.getContexto(),
      requerContinuacao: classificacao.classificacao === CLASSIFICACAO_CODIGO.ACTION_REQUIRED
    };
  }

  iniciarTransacao(operacao, camposEntrada = {}, opcoes = {}) {
    if (this._contexto && (
      this._financialStateUnknown()
      || ESTADOS_BLOQUEIAM_NOVA.has(this._contexto.estado)
    )) {
      return this._falha(
        ERROS.DESTAXA_TRANSACAO_EM_ANDAMENTO,
        'Transação Destaxa já em andamento',
        this._contexto.estado,
        {
          preservarContexto: true,
          retryReason: this._contexto.dadosUltimaResposta?.retryReason || 'TEF_PENDING_NO_NEW_TRANSACTION'
        }
      );
    }

    if (!this._driver) {
      return this._falha(
        ERROS.DESTAXA_TRANSACAO_REAL_BLOQUEADA,
        'Transação Destaxa real bloqueada nesta sprint — use driver mock',
        ESTADOS_TRANSACAO.ERROR
      );
    }

    const op = String(operacao || '').trim().toUpperCase();

    if (this._driverNativo()) {
      if (!this._gateRealOuExcepcionalOk()) {
        return this._bloqueioGateReal();
      }
      if (!this._permitirTransacaoReal) {
        return this._falha(
          ERROS.DESTAXA_TRANSACAO_REAL_BLOQUEADA,
          'iniciaTransacaoDestaxa real não permitido: bridge não liberou o driver nativo',
          ESTADOS_TRANSACAO.ERROR,
          { preservarContexto: true }
        );
      }
      if (!OPERACOES_REAIS_PERMITIDAS.includes(op)) {
        return this._falha(
          ERROS.DESTAXA_OPERACAO_NAO_PERMITIDA,
          `Operação real ${op || '(vazia)'} não permitida; somente ${OPERACOES_REAIS_PERMITIDAS.join(', ')}`,
          ESTADOS_TRANSACAO.ERROR,
          { preservarContexto: true }
        );
      }
    }

    const entrada = buildTransactionInput(camposEntrada);
    const inicio = process.hrtime.bigint();

    this._contexto = {
      transactionId: opcoes.transactionId != null && String(opcoes.transactionId).trim()
        ? String(opcoes.transactionId).trim()
        : novoTransactionId(),
      operacao: op,
      estado: ESTADOS_TRANSACAO.STARTING,
      inicio: new Date().toISOString(),
      ultimaAcao: null,
      codigoUltimo: null,
      financialState: null,
      dadosUltimaResposta: null,
      entradaInicial: entrada.texto
    };

    this._log('transacao.start', {
      action: op,
      inputKeys: entrada.chaves
    });

    // MRT-31 — evidência de entrada no orquestrador (antes da chamada nativa)
    try {
      const { registrarEtapaFluxo, ETAPAS_FLUXO } = require('./destaxaFluxoInstrumentacao');
      registrarEtapaFluxo(ETAPAS_FLUXO.ORQUESTRADOR_ENTROU, {
        transactionId: this._contexto.transactionId,
        provedor: 'destaxa'
      }, {
        operacao: op,
        chavesEntrada: entrada.chaves,
        driver: this._driver?.nome || null
      });
    } catch (_) { /* instrumentação best-effort */ }

    try {
      const resultadoDll = this._driver.iniciaTransacaoDestaxa(op, entrada.texto);
      const resposta = this._montarRespostaDll(resultadoDll, inicio);
      try {
        const { registrarEtapaFluxo, ETAPAS_FLUXO } = require('./destaxaFluxoInstrumentacao');
        registrarEtapaFluxo(ETAPAS_FLUXO.TX_START_RESULT, {
          transactionId: this._contexto.transactionId,
          provedor: 'destaxa'
        }, {
          codigoDestaxa: resposta.codigoDestaxa || null,
          financialState: resposta.financialState || null,
          duracaoMs: resposta.duracaoMs ?? null,
          requerContinuacao: resposta.requerContinuacao === true
        });
      } catch (_) { /* instrumentação best-effort */ }
      return resposta;
    } catch (error) {
      try {
        const { registrarEtapaFluxo, ETAPAS_FLUXO } = require('./destaxaFluxoInstrumentacao');
        registrarEtapaFluxo(ETAPAS_FLUXO.TX_START_RESULT, {
          transactionId: this._contexto?.transactionId,
          provedor: 'destaxa'
        }, {
          erro: String(error?.message || error || ''),
          financialState: 'UNKNOWN'
        });
      } catch (_) { /* instrumentação best-effort */ }
      return this._montarErroFinanceiro(error, inicio);
    }
  }

  iniciarTransacaoCRT(camposEntrada = {}, opcoes = {}) {
    return this.iniciarTransacao(OPERACOES.CRT, camposEntrada, opcoes);
  }

  continuarTransacao(respostaEntrada = {}) {
    if (!this._contexto) {
      return this._falha(
        ERROS.DESTAXA_TRANSACAO_NAO_ENCONTRADA,
        'Nenhuma transação Destaxa ativa para continuar',
        ESTADOS_TRANSACAO.ERROR
      );
    }

    if (this._financialStateUnknown()) {
      return this._falha(
        ERROS.DESTAXA_TRANSACAO_EM_ANDAMENTO,
        'Transação financeiramente UNKNOWN exige reconciliação explícita',
        this._contexto.estado,
        { preservarContexto: true, retryReason: 'TEF_UNKNOWN_NO_RETRY' }
      );
    }

    if (!ESTADOS_BLOQUEIAM_NOVA.has(this._contexto.estado)
      && this._contexto.estado !== ESTADOS_TRANSACAO.WAITING_ACTION) {
      return this._falha(
        ERROS.DESTAXA_TRANSACAO_SEM_CONTEXTO,
        `Estado ${this._contexto.estado} não permite continuaTransacaoDestaxa`,
        this._contexto.estado
      );
    }

    if (!this._driver) {
      return this._falha(ERROS.DESTAXA_TRANSACAO_REAL_BLOQUEADA, 'Driver ausente', ESTADOS_TRANSACAO.ERROR);
    }

    if (this._driverNativo() && !this._gateRealOuExcepcionalOk()) {
      return this._bloqueioGateReal();
    }

    const entrada = buildContinuaInput(respostaEntrada);
    const inicio = process.hrtime.bigint();

    this._log('transacao.continue', { inputKeys: entrada.chaves });

    try {
      const resultadoDll = this._driver.continuaTransacaoDestaxa(entrada.texto);
      return this._montarRespostaDll(resultadoDll, inicio);
    } catch (error) {
      return this._montarErroFinanceiro(error, inicio);
    }
  }

  /**
   * SPRINT 51.45 — FINALIZE sem _contexto CRT somente com autorização
   * RECUPERACAO_PROTOCOLAR_TX3 (confirmacao=0, transactionId=3).
   */
  _autorizacaoRecuperacaoProtocolarTx3(opcoes = {}) {
    const auth = opcoes.autorizacaoRecuperacao || opcoes.recuperacaoProtocolarTx3 || null;
    if (!auth || auth.path !== 'RECUPERACAO_PROTOCOLAR_TX3') return null;
    if (auth.permiteFinalizarSemContextoCrt !== true) return null;
    if (String(auth.transactionId || '') !== '3') return null;
    if (Number(auth.confirmacao) !== FINALIZACAO_CONFIRMAR) return null;
    if (auth.retryAutomatico === true) return null;
    if (!auth.exclusividade || auth.exclusividade.ok !== true) return null;
    if (auth.exclusividade.abortarAntesFinalize === true) return null;
    return auth;
  }

  finalizarTransacao(confirmacao, opcoes = {}) {
    const recuperacaoTx3 = this._autorizacaoRecuperacaoProtocolarTx3(opcoes);
    const conf = Number(confirmacao);

    if (!this._contexto) {
      if (!recuperacaoTx3) {
        return this._falha(
          ERROS.DESTAXA_TRANSACAO_NAO_ENCONTRADA,
          'Nenhuma transação Destaxa ativa para finalizar',
          ESTADOS_TRANSACAO.ERROR
        );
      }
      if (conf === FINALIZACAO_CANCELAR || conf === 9) {
        return this._falha(
          ERROS.DESTAXA_INVALID_CONFIGURATION,
          'RECUPERACAO_PROTOCOLAR_TX3 bloqueia FINALIZE(9)',
          ESTADOS_TRANSACAO.ERROR
        );
      }
      if (conf !== FINALIZACAO_CONFIRMAR) {
        return this._falha(
          ERROS.DESTAXA_INVALID_CONFIGURATION,
          'RECUPERACAO_PROTOCOLAR_TX3 exige confirmacao=0',
          ESTADOS_TRANSACAO.ERROR
        );
      }
      if (!this._driver) {
        return this._falha(ERROS.DESTAXA_TRANSACAO_REAL_BLOQUEADA, 'Driver ausente', ESTADOS_TRANSACAO.ERROR);
      }
      if (recuperacaoTx3.exceptionalPermit) {
        this.definirPermitExcepcional(recuperacaoTx3.exceptionalPermit);
      }
      if (this._driverNativo() && !this._gateRealOuExcepcionalOk()) {
        return this._bloqueioGateReal();
      }

      const inicio = process.hrtime.bigint();
      this._log('transacao.finalize.recuperacao_tx3', {
        confirmacao: conf,
        path: 'RECUPERACAO_PROTOCOLAR_TX3',
        transactionId: '3',
        semContextoCrt: true
      });

      try {
        const resultadoDll = this._driver.finalizaTransacaoDestaxa(conf);
        const classificacao = classificarCodigoTransacao(resultadoDll.codigo);
        const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1e6;
        const sucesso = classificacao.classificacao === CLASSIFICACAO_CODIGO.SUCCESS;
        return {
          sucesso,
          codigo: sucesso ? classificacao.codigo : (classificacao.codigo || ERROS.DESTAXA_TRANSACAO_EM_ANDAMENTO),
          codigoDestaxa: classificacao.codigo,
          mensagem: classificacao.descricao || null,
          financialState: classificacao.financialState,
          duracaoMs,
          confirmacao: conf,
          confirmacaoDescricao: 'confirma',
          recuperacaoProtocolarTx3: true,
          semContextoCrt: true,
          transactionId: '3',
          retryAllowed: false
        };
      } catch (error) {
        const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1e6;
        return {
          sucesso: false,
          codigo: ERROS.DESTAXA_TRANSACAO_EM_ANDAMENTO,
          codigoDestaxa: 'UNKNOWN',
          mensagem: String(error?.message || error || ''),
          confirmacao: conf,
          recuperacaoProtocolarTx3: true,
          semContextoCrt: true,
          transactionId: '3',
          retryAllowed: false,
          duracaoMs
        };
      }
    }

    if (this._financialStateUnknown()) {
      return this._falha(
        ERROS.DESTAXA_TRANSACAO_EM_ANDAMENTO,
        'Transação financeiramente UNKNOWN exige reconciliação explícita',
        this._contexto.estado,
        { preservarContexto: true, retryReason: 'TEF_UNKNOWN_NO_RETRY' }
      );
    }

    if (!this._driver) {
      return this._falha(ERROS.DESTAXA_TRANSACAO_REAL_BLOQUEADA, 'Driver ausente', ESTADOS_TRANSACAO.ERROR);
    }

    if (this._driverNativo() && !this._gateRealOuExcepcionalOk()) {
      return this._bloqueioGateReal();
    }

    if (conf !== FINALIZACAO_CONFIRMAR && conf !== FINALIZACAO_CANCELAR) {
      return this._falha(
        ERROS.DESTAXA_INVALID_CONFIGURATION,
        'confirmacao deve ser 0 (confirma) ou 9 (cancela/desfaz)',
        this._contexto.estado
      );
    }

    const estadoAnterior = this._contexto.estado;
    this._contexto.estado = ESTADOS_TRANSACAO.FINALIZING;
    const inicio = process.hrtime.bigint();

    this._log('transacao.finalize', { confirmacao: conf, estadoAnterior });

    let resposta;
    try {
      const resultadoDll = this._driver.finalizaTransacaoDestaxa(conf);
      resposta = this._montarRespostaDll(resultadoDll, inicio);
    } catch (error) {
      resposta = this._montarErroFinanceiro(error, inicio);
    }

    if (resposta.sucesso) {
      this._contexto.estado = ESTADOS_TRANSACAO.SUCCESS;
    }

    return {
      ...resposta,
      confirmacao: conf,
      confirmacaoDescricao: conf === FINALIZACAO_CONFIRMAR ? 'confirma' : 'cancela_desfaz'
    };
  }

  reconciliarTransacao(dados = {}, capability = null) {
    const claims = consumirCapabilityAutorizacaoReconciliacao(capability);
    if (!claims
      || claims.phase !== 'release'
      || claims.recordStatus !== 'pendente'
      || String(claims.transactionId || '') !== String(dados.transactionId || '')
      || claims.financialState !== dados.financialState
      || claims.usuario !== dados.usuario
      || claims.observacao !== dados.observacao) {
      return {
        sucesso: false,
        codigo: 'HOST_RECONCILIATION_AUTHORIZATION_INVALID',
        contexto: this.getContexto()
      };
    }

    const contexto = this._contexto;
    if (contexto && String(contexto.transactionId || '') !== String(claims.transactionId)) {
      return {
        sucesso: false,
        codigo: 'HOST_TRANSACTION_MISMATCH',
        contexto: this.getContexto()
      };
    }

    const reconciliacaoAnterior = contexto?.reconciliacao;
    if (reconciliacaoAnterior
      && (reconciliacaoAnterior.financialState !== claims.financialState
        || reconciliacaoAnterior.usuario !== claims.usuario
        || reconciliacaoAnterior.observacao !== claims.observacao
        || (reconciliacaoAnterior.operation_id != null
          && reconciliacaoAnterior.operation_id !== claims.operation_id)
        || (reconciliacaoAnterior.idempotency_key != null
          && reconciliacaoAnterior.idempotency_key !== claims.idempotency_key)
        || (reconciliacaoAnterior.fingerprint != null
          && reconciliacaoAnterior.fingerprint !== claims.fingerprint))) {
      return {
        sucesso: false,
        codigo: 'HOST_RECONCILIATION_CONFLICT',
        contexto: this.getContexto()
      };
    }

    const contextoFinal = contexto || {
      transactionId: String(claims.transactionId),
      operacao: null,
      dadosUltimaResposta: null
    };
    contextoFinal.financialState = claims.financialState;
    contextoFinal.estado = claims.financialState === FINANCIAL_STATES.CONFIRMED_SUCCESS
      ? ESTADOS_TRANSACAO.SUCCESS
      : ESTADOS_TRANSACAO.DENIED;
    contextoFinal.reconciliacao = {
      authorizationId: claims.authorizationId,
      operation_id: claims.operation_id,
      idempotency_key: claims.idempotency_key,
      fingerprint: claims.fingerprint,
      financialState: claims.financialState,
      usuario: claims.usuario,
      observacao: claims.observacao
    };
    this._contexto = contextoFinal;
    this._log('transacao.reconciliada', {
      financialState: dados.financialState,
      retryAllowed: false
    });
    return {
      sucesso: true,
      transactionId: String(contextoFinal.transactionId),
      financialState: contextoFinal.financialState,
      contexto: this.getContexto()
    };
  }

  reset() {
    if (this._financialStateUnknown()) {
      return false;
    }
    this._contexto = null;
    return true;
  }
}

module.exports = DestaxaTransacaoOrquestrador;
module.exports.ESTADOS_BLOQUEIAM_NOVA = ESTADOS_BLOQUEIAM_NOVA;
