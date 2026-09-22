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
  classificarErroFinanceiro,
  montarLogDecisao
} = require('../tefFinancialSafetyPolicy');

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
  }

  definirDriver(driver) {
    this._driver = driver;
  }

  getContexto() {
    return this._contexto ? { ...this._contexto } : null;
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

  iniciarTransacao(operacao, camposEntrada = {}) {
    if (this._contexto && ESTADOS_BLOQUEIAM_NOVA.has(this._contexto.estado)) {
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

    if (!this._permitirTransacaoReal && this._driver.nome === 'native') {
      return this._falha(
        ERROS.DESTAXA_TRANSACAO_REAL_BLOQUEADA,
        'iniciaTransacaoDestaxa real não permitido nesta sprint',
        ESTADOS_TRANSACAO.ERROR
      );
    }

    const op = String(operacao || '').trim().toUpperCase();
    const entrada = buildTransactionInput(camposEntrada);
    const inicio = process.hrtime.bigint();

    this._contexto = {
      transactionId: novoTransactionId(),
      operacao: op,
      estado: ESTADOS_TRANSACAO.STARTING,
      inicio: new Date().toISOString(),
      ultimaAcao: null,
      codigoUltimo: null,
      dadosUltimaResposta: null,
      entradaInicial: entrada.texto
    };

    this._log('transacao.start', {
      action: op,
      inputKeys: entrada.chaves
    });

    try {
      const resultadoDll = this._driver.iniciaTransacaoDestaxa(op, entrada.texto);
      return this._montarRespostaDll(resultadoDll, inicio);
    } catch (error) {
      return this._montarErroFinanceiro(error, inicio);
    }
  }

  iniciarTransacaoCRT(camposEntrada = {}) {
    return this.iniciarTransacao(OPERACOES.CRT, camposEntrada);
  }

  continuarTransacao(respostaEntrada = {}) {
    if (!this._contexto) {
      return this._falha(
        ERROS.DESTAXA_TRANSACAO_NAO_ENCONTRADA,
        'Nenhuma transação Destaxa ativa para continuar',
        ESTADOS_TRANSACAO.ERROR
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

  finalizarTransacao(confirmacao) {
    if (!this._contexto) {
      return this._falha(
        ERROS.DESTAXA_TRANSACAO_NAO_ENCONTRADA,
        'Nenhuma transação Destaxa ativa para finalizar',
        ESTADOS_TRANSACAO.ERROR
      );
    }

    if (!this._driver) {
      return this._falha(ERROS.DESTAXA_TRANSACAO_REAL_BLOQUEADA, 'Driver ausente', ESTADOS_TRANSACAO.ERROR);
    }

    const conf = Number(confirmacao);
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

  reset() {
    this._contexto = null;
  }
}

module.exports = DestaxaTransacaoOrquestrador;
