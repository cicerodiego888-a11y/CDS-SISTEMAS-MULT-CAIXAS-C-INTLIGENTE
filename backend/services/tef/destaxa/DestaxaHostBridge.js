'use strict';

/**
 * Proxy assíncrono do DestaxaNativeBridge executado no TEF Native Host.
 * Mesma superfície usada pelo DestaxaRealAdapter; nenhuma DLL é carregada
 * no processo principal.
 */

const { PROVIDER, ESTADOS } = require('./destaxaConstantes');
const { OPERACOES_HOST, sanitizar } = require('./destaxaNativeHostProtocolo');
const { obterClienteCompartilhado } = require('./DestaxaNativeHostClient');

function diagnosticoIndisponivel(error) {
  return {
    provider: PROVIDER,
    mode: 'real',
    dllPath: null,
    dllExists: false,
    dllLoaded: false,
    exportsValid: false,
    exports: {},
    clientInitialized: false,
    clientResultCode: null,
    estado: error.code || ESTADOS.DLL_NOT_FOUND,
    tefDisponivel: false,
    ultimoErro: { codigo: error.code, mensagem: error.message }
  };
}

class DestaxaHostBridge {
  constructor({ client = null, config = {} } = {}) {
    this._client = client || obterClienteCompartilhado();
    this.config = config;
    this._transactionId = null;
  }

  get client() {
    return this._client;
  }

  _chamar(operacao, payload = {}, transactionId = null, opcoes = {}) {
    return this._client.enviar(operacao, payload, { transactionId, timeoutMs: opcoes.timeoutMs });
  }

  _falha(resposta) {
    return { sucesso: false, codigo: resposta.error.code, mensagem: resposta.error.message };
  }

  async _status() {
    return this._chamar(OPERACOES_HOST.STATUS);
  }

  async isLoaded() {
    const r = await this._status();
    return !r.error && r.output?.diagnostics?.dllLoaded === true;
  }

  async load() {
    const r = await this._chamar(OPERACOES_HOST.LOAD, { config: sanitizar(this.config) });
    return r.error ? this._falha(r) : r.output;
  }

  async getDiagnostics() {
    const r = await this._status();
    return r.error ? diagnosticoIndisponivel(r.error) : r.output.diagnostics;
  }

  async getHostStatus() {
    const r = await this._status();
    return r.error ? { disponivel: false, erro: r.error } : { disponivel: true, ...r.output };
  }

  async iniciarClient(config = this.config) {
    const r = await this._chamar(OPERACOES_HOST.INIT_CLIENT, { config: sanitizar(config) });
    return r.error ? { ...this._falha(r), estado: r.error.code } : r.output;
  }

  async habilitarTransacaoReal() {
    const r = await this._chamar(OPERACOES_HOST.ENABLE_REAL);
    return r.error ? this._falha(r) : r.output;
  }

  /**
   * Resultado transacional: resposta do host, UNKNOWN (timeout/queda: output do
   * cliente) ou "não executada" (ocupado/offline) — nunca aprovado/negado inferido.
   */
  _resultadoTransacional(r, transactionId) {
    if (!r.error) {
      if (r.output?.contexto?.transactionId) this._transactionId = r.output.contexto.transactionId;
      return r.output;
    }
    if (r.output) return r.output;
    return {
      sucesso: false,
      codigo: r.error.code,
      codigoDestaxa: r.error.code,
      mensagem: r.error.message,
      estado: null,
      naoExecutada: true,
      retryAllowed: false,
      retryReason: r.error.code,
      requerContinuacao: false,
      contexto: transactionId ? { transactionId: String(transactionId) } : null
    };
  }

  async iniciarTransacaoDestaxa(operacao, camposEntrada = {}, opcoes = {}) {
    const transactionId = opcoes.transactionId != null ? String(opcoes.transactionId) : null;
    const r = await this._chamar(
      OPERACOES_HOST.TX_START,
      { operacao, campos: sanitizar(camposEntrada) },
      transactionId,
      opcoes
    );
    return this._resultadoTransacional(r, transactionId);
  }

  async continuarTransacaoDestaxa(respostaEntrada = {}, opcoes = {}) {
    const r = await this._chamar(
      OPERACOES_HOST.TX_CONTINUE,
      { resposta: sanitizar(respostaEntrada) },
      this._transactionId,
      opcoes
    );
    return this._resultadoTransacional(r, this._transactionId);
  }

  async finalizarTransacaoDestaxa(confirmacao, opcoes = {}) {
    const r = await this._chamar(OPERACOES_HOST.TX_FINALIZE, { confirmacao }, this._transactionId, opcoes);
    return this._resultadoTransacional(r, this._transactionId);
  }

  async getTransacaoContexto() {
    const r = await this._status();
    return r.error ? null : r.output.contexto;
  }

  async configurarDriverTransacaoMock(passos = []) {
    const r = await this._chamar(OPERACOES_HOST.CONFIGURE_MOCK, { passos: sanitizar(passos) });
    return r.error ? this._falha(r) : r.output;
  }

  async unload() {
    const r = await this._chamar(OPERACOES_HOST.UNLOAD);
    return r.error ? this._falha(r) : r.output;
  }
}

module.exports = DestaxaHostBridge;
