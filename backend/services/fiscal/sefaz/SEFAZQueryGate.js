/**
 * SEFAZ Query Gate — única porta oficial para consultas DistDFe.
 *
 * Decide PERMITIR / ADIAR / BLOQUEAR.
 * Não reescreve SOAP, parser ou motores fiscais.
 */
'use strict';

const {
  TIPOS_CONSULTA,
  ORIGENS,
  ESTADOS_SOLICITACAO,
  ERROS,
  CIRCUIT_STATE,
  RATE_LIMIT_MIN_INTERVAL_MS,
  normalizarCnpj,
  normalizarAmbiente,
  chaveIdentidade,
  inferirTipoDoXml,
  extrairUltNsuDoXml
} = require('./sefazGateConstants');
const { criarRequestId } = require('./SEFAZRequestId');
const { SEFAZRateLimiter } = require('./SEFAZRateLimiter');
const { SEFAZCooldown } = require('./SEFAZCooldown');
const { SEFAZCircuitBreaker } = require('./SEFAZCircuitBreaker');
const { SEFAZQueryQueue } = require('./SEFAZQueryQueue');
const { SEFAZQueryExecutor } = require('./SEFAZQueryExecutor');
const { SEFAZQueryAudit } = require('./SEFAZQueryAudit');

function nsuNumerico(valor) {
  const digits = String(valor == null ? '0' : valor).replace(/\D/g, '') || '0';
  return BigInt(digits.replace(/^0+(?=\d)/, '') || '0');
}

function GateError(codigo, mensagem, extra = {}) {
  const err = new Error(mensagem || codigo);
  err.codigo = codigo;
  err.sefazGate = true;
  Object.assign(err, extra);
  return err;
}

class SEFAZQueryGate {
  constructor(deps = {}) {
    this._rate = deps.rateLimiter || new SEFAZRateLimiter(deps.rateOpts);
    this._cooldown = deps.cooldown || new SEFAZCooldown(deps.cooldownOpts);
    this._circuit = deps.circuitBreaker || new SEFAZCircuitBreaker(deps.circuitOpts);
    this._queue = deps.queue || new SEFAZQueryQueue();
    this._executor = deps.executor || new SEFAZQueryExecutor();
    this._audit = deps.audit || new SEFAZQueryAudit(deps.auditOpts);
    this._nsuService = deps.nsuService || null;
    this._agora = deps.agora || (() => Date.now());
    // Cooldown/CB: recusa imediata (módulos já tratam retry). Fila só serializa concorrência.
    this._waitCooldown = deps.waitCooldown === true;
    this._maxWaitMs = deps.maxWaitMs != null ? Number(deps.maxWaitMs) : 5000;
  }

  setNsuService(svc) {
    this._nsuService = svc;
  }

  /**
   * Avalia autorização sem executar (pré-check).
   */
  async autorizar(params = {}) {
    const cnpj = normalizarCnpj(params.cnpj);
    const ambiente = normalizarAmbiente(params.ambiente);
    const tipo = params.tipo || TIPOS_CONSULTA.DIST_NSU;
    const origem = params.origem || ORIGENS.DESCONHECIDO;
    const request_id = params.request_id || criarRequestId();

    const base = {
      request_id,
      tipo,
      cnpj,
      ambiente,
      origem,
      permitido: false,
      status: ESTADOS_SOLICITACAO.BLOCKED,
      motivo: null,
      retry_at: null,
      cstat: null,
      xmotivo: null
    };

    if (!cnpj) {
      return { ...base, motivo: 'CNPJ_OBRIGATORIO', erro: ERROS.ERRO_CERTIFICADO };
    }

    // NSU regression (DIST_NSU / CONS_NSU)
    if (
      (tipo === TIPOS_CONSULTA.DIST_NSU || tipo === TIPOS_CONSULTA.CONS_NSU)
      && params.nsu_solicitado != null
      && this._nsuService
    ) {
      try {
        const controle = await this._nsuService.buscarPorCnpjAmbiente(cnpj, ambiente)
          || await this._nsuService.obterOuCriar?.(cnpj, ambiente);
        const nsuAtual = controle?.ultNsu != null ? controle.ultNsu : controle?.ult_nsu;
        if (nsuAtual != null && nsuNumerico(params.nsu_solicitado) < nsuNumerico(nsuAtual)) {
          this._audit.registrar({
            request_id,
            cnpj,
            ambiente,
            tipo,
            origem,
            status: ESTADOS_SOLICITACAO.BLOCKED,
            nsu_anterior: String(nsuAtual),
            nsu_solicitado: String(params.nsu_solicitado),
            motivo: 'NSU_REGRESSAO',
            erro_tecnico: ERROS.ERRO_NSU_REGRESSAO,
            logTag: '[SEFAZ-NSU]'
          });
          return {
            ...base,
            motivo: 'NSU_REGRESSAO',
            erro: ERROS.ERRO_NSU_REGRESSAO,
            nsu_atual: String(nsuAtual),
            nsu_solicitado: String(params.nsu_solicitado)
          };
        }
      } catch (e) {
        // Se NSU service falhar, não bloqueia por regressão (mantém disponibilidade)
      }
    }

    const cd = this._cooldown.obter(cnpj, ambiente);
    if (cd) {
      return {
        ...base,
        status: ESTADOS_SOLICITACAO.WAITING,
        motivo: cd.motivo || 'COOLDOWN',
        retry_at: cd.cooldown_ate,
        erro: ERROS.ERRO_COOLDOWN,
        cstat: cd.cStat
      };
    }

    const cb = this._circuit.podeConsultar(cnpj, ambiente);
    if (!cb.permitido) {
      return {
        ...base,
        motivo: cb.motivo || 'CIRCUIT_BREAKER',
        retry_at: cb.retry_at || null,
        erro: ERROS.ERRO_CIRCUIT_BREAKER,
        circuit_state: cb.state
      };
    }

    const rl = this._rate.quandoConsultar(cnpj, ambiente, tipo);
    if (!rl.permitido) {
      return {
        ...base,
        status: ESTADOS_SOLICITACAO.WAITING,
        motivo: 'RATE_LIMIT',
        retry_at: rl.retry_at,
        erro: ERROS.ERRO_RATE_LIMIT
      };
    }

    return {
      ...base,
      permitido: true,
      status: ESTADOS_SOLICITACAO.AUTHORIZED,
      motivo: null,
      circuit_state: cb.state,
      halfOpen: Boolean(cb.halfOpen)
    };
  }

  /**
   * Porta principal: autoriza, enfileira, executa callback SOAP.
   *
   * @param {Object} params
   * @param {Function} params.execute - async () => soapResult
   */
  async request(params = {}) {
    const cnpj = normalizarCnpj(params.cnpj);
    const ambiente = normalizarAmbiente(params.ambiente);
    const tipo = params.tipo
      || (params.xmlConsulta ? inferirTipoDoXml(params.xmlConsulta) : TIPOS_CONSULTA.DIST_NSU);
    const origem = params.origem || ORIGENS.DESCONHECIDO;
    const request_id = params.request_id || criarRequestId();
    const nsu_solicitado = params.nsu_solicitado != null
      ? params.nsu_solicitado
      : (params.xmlConsulta ? extrairUltNsuDoXml(params.xmlConsulta) : null);

    const solicitacao = {
      request_id,
      cnpj,
      ambiente,
      tipo,
      origem,
      status: ESTADOS_SOLICITACAO.QUEUED,
      nsu_solicitado
    };

    this._audit.registrar({
      request_id,
      cnpj,
      ambiente,
      tipo,
      origem,
      status: ESTADOS_SOLICITACAO.QUEUED,
      nsu_solicitado,
      logTag: '[SEFAZ-QUEUE]'
    });

    // Pré-checagem (pode WAITING/BLOCKED antes da fila)
    let auth = await this.autorizar({
      ...params,
      request_id,
      tipo,
      origem,
      cnpj,
      ambiente,
      nsu_solicitado
    });

    if (!auth.permitido && auth.erro === ERROS.ERRO_NSU_REGRESSAO) {
      solicitacao.status = ESTADOS_SOLICITACAO.BLOCKED;
      throw GateError(ERROS.ERRO_NSU_REGRESSAO, 'NSU solicitado menor que o cursor persistido.', {
        ...auth,
        permitido: false
      });
    }

    if (!auth.permitido && auth.erro === ERROS.ERRO_CIRCUIT_BREAKER && auth.circuit_state === CIRCUIT_STATE.OPEN) {
      solicitacao.status = ESTADOS_SOLICITACAO.BLOCKED;
      this._audit.registrar({
        request_id, cnpj, ambiente, tipo, origem,
        status: ESTADOS_SOLICITACAO.BLOCKED,
        motivo: auth.motivo,
        erro_tecnico: ERROS.ERRO_CIRCUIT_BREAKER,
        logTag: '[SEFAZ-CB]'
      });
      throw GateError(ERROS.ERRO_CIRCUIT_BREAKER, 'Circuit breaker OPEN para este CNPJ/ambiente.', {
        ...auth,
        permitido: false
      });
    }

    // Rate limit: espera curta (pacing). Cooldown: recusa imediata salvo waitCooldown.
    if (!auth.permitido && (auth.erro === ERROS.ERRO_COOLDOWN || auth.erro === ERROS.ERRO_RATE_LIMIT)) {
      solicitacao.status = ESTADOS_SOLICITACAO.WAITING;
      this._audit.registrar({
        request_id, cnpj, ambiente, tipo, origem,
        status: ESTADOS_SOLICITACAO.WAITING,
        motivo: auth.motivo,
        erro_tecnico: auth.erro,
        logTag: auth.erro === ERROS.ERRO_RATE_LIMIT ? '[SEFAZ-RATE]' : '[SEFAZ-GATE]'
      });

      const deveEsperar = auth.erro === ERROS.ERRO_RATE_LIMIT || this._waitCooldown === true;
      if (!deveEsperar) {
        throw GateError(auth.erro, `Consulta em espera: ${auth.motivo}`, {
          ...auth,
          permitido: false
        });
      }

      const ate = auth.retry_at ? Date.parse(auth.retry_at) : (this._agora() + 1000);
      const tetoEspera = auth.erro === ERROS.ERRO_RATE_LIMIT
        ? Math.max(this._maxWaitMs, RATE_LIMIT_MIN_INTERVAL_MS + 500)
        : this._maxWaitMs;
      const waitMs = Math.min(Math.max(0, ate - this._agora()), tetoEspera);
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
      }
      auth = await this.autorizar({
        request_id, tipo, origem, cnpj, ambiente, nsu_solicitado
      });
      if (!auth.permitido) {
        throw GateError(auth.erro || ERROS.ERRO_COOLDOWN, `Consulta bloqueada: ${auth.motivo}`, {
          ...auth,
          permitido: false
        });
      }
    }

    const token = await this._queue.adquirir(solicitacao);
    try {
      // Revalida sob exclusividade
      auth = await this.autorizar({
        request_id, tipo, origem, cnpj, ambiente, nsu_solicitado
      });
      if (!auth.permitido) {
        solicitacao.status = ESTADOS_SOLICITACAO.BLOCKED;
        throw GateError(auth.erro || ERROS.ERRO_COOLDOWN, `Consulta bloqueada: ${auth.motivo}`, {
          ...auth,
          permitido: false
        });
      }

      if (auth.halfOpen) {
        this._circuit.marcarHalfOpenEmUso(cnpj, ambiente);
      }

      solicitacao.status = ESTADOS_SOLICITACAO.RUNNING;
      this._audit.registrar({
        request_id, cnpj, ambiente, tipo, origem,
        status: ESTADOS_SOLICITACAO.RUNNING,
        nsu_solicitado,
        logTag: '[SEFAZ-EXEC]'
      });

      if (typeof params.execute !== 'function') {
        throw GateError(ERROS.ERRO_SEFAZ, 'Callback execute é obrigatório.');
      }

      this._rate.registrarConsulta(cnpj, ambiente, tipo);
      const exec = await this._executor.executar(params.execute);

      if (!exec.sucesso) {
        solicitacao.status = ESTADOS_SOLICITACAO.FAILED;
        const msg = exec.erro?.message || 'Falha na consulta SEFAZ';
        const codigoErro = this._classificarErroTecnico(exec.erro);
        this._audit.registrar({
          request_id, cnpj, ambiente, tipo, origem,
          status: ESTADOS_SOLICITACAO.FAILED,
          tempo_execucao: exec.tempo_ms,
          erro_tecnico: codigoErro,
          xMotivo: msg,
          logTag: '[SEFAZ-EXEC]'
        });
        throw GateError(codigoErro, msg, {
          request_id, permitido: false, status: ESTADOS_SOLICITACAO.FAILED, cause: exec.erro
        });
      }

      const resultado = exec.resultado;
      const cStat = this._extrairCStat(resultado, params);
      const xMotivo = this._extrairXMotivo(resultado, params);

      if (cStat === '656') {
        this._cooldown.registrar({
          cnpj, ambiente, cStat: '656', tipo, request_id, motivo: 'CSTAT_656'
        });
        this._circuit.forcarOpen(cnpj, ambiente, 'CSTAT_656');
        this._audit.registrar({
          request_id, cnpj, ambiente, tipo, origem,
          status: ESTADOS_SOLICITACAO.BLOCKED,
          cStat: '656',
          xMotivo,
          tempo_execucao: exec.tempo_ms,
          motivo: 'CSTAT_656',
          logTag: '[SEFAZ-GATE]'
        });
      } else if (cStat === '137') {
        this._cooldown.registrar({
          cnpj, ambiente, cStat: '137', tipo, request_id, motivo: 'CSTAT_137'
        });
        this._circuit.registrarSucesso(cnpj, ambiente);
        this._audit.registrar({
          request_id, cnpj, ambiente, tipo, origem,
          status: ESTADOS_SOLICITACAO.SUCCESS,
          cStat: '137',
          xMotivo,
          tempo_execucao: exec.tempo_ms,
          motivo: 'CSTAT_137',
          logTag: '[SEFAZ-GATE]'
        });
      } else {
        this._circuit.registrarSucesso(cnpj, ambiente);
        this._audit.registrar({
          request_id, cnpj, ambiente, tipo, origem,
          status: ESTADOS_SOLICITACAO.SUCCESS,
          cStat,
          xMotivo,
          tempo_execucao: exec.tempo_ms,
          logTag: '[SEFAZ-EXEC]'
        });
      }

      solicitacao.status = ESTADOS_SOLICITACAO.SUCCESS;
      return {
        request_id,
        status: ESTADOS_SOLICITACAO.SUCCESS,
        permitido: true,
        tipo,
        cnpj,
        ambiente,
        origem,
        motivo: null,
        retry_at: null,
        cstat: cStat,
        xmotivo: xMotivo,
        resultado,
        tempo_execucao: exec.tempo_ms
      };
    } finally {
      token.liberar();
    }
  }

  _extrairCStat(resultado, params) {
    if (params.extrairCStat && typeof params.extrairCStat === 'function') {
      try { return String(params.extrairCStat(resultado) || '') || null; } catch { /* ignore */ }
    }
    if (resultado && resultado.cStat != null) return String(resultado.cStat);
    if (resultado && resultado.metadados && resultado.metadados.cStat != null) {
      return String(resultado.metadados.cStat);
    }
    if (resultado && typeof resultado.body === 'string') {
      const m = resultado.body.match(/<cStat>\s*([^<]+)\s*<\/cStat>/i);
      if (m) return String(m[1]).trim();
    }
    return null;
  }

  _extrairXMotivo(resultado, params) {
    if (params.extrairXMotivo && typeof params.extrairXMotivo === 'function') {
      try { return params.extrairXMotivo(resultado) || null; } catch { /* ignore */ }
    }
    if (resultado && resultado.xMotivo) return String(resultado.xMotivo);
    if (resultado && typeof resultado.body === 'string') {
      const m = resultado.body.match(/<xMotivo>\s*([^<]+)\s*<\/xMotivo>/i);
      if (m) return String(m[1]).trim();
    }
    return null;
  }

  _classificarErroTecnico(erro) {
    const msg = String(erro?.message || erro || '').toLowerCase();
    if (msg.includes('timeout') || msg.includes('etimedout')) return ERROS.ERRO_TIMEOUT;
    if (msg.includes('certificado') || msg.includes('pfx') || msg.includes('senha')) {
      return ERROS.ERRO_CERTIFICADO;
    }
    if (msg.includes('xml') || msg.includes('parse')) return ERROS.ERRO_XML;
    if (msg.includes('econn') || msg.includes('network') || msg.includes('socket')) {
      return ERROS.ERRO_REDE;
    }
    if (erro?.codigo && Object.values(ERROS).includes(erro.codigo)) return erro.codigo;
    return ERROS.ERRO_SEFAZ;
  }

  obterDiagnostico(cnpj, ambiente) {
    const c = normalizarCnpj(cnpj);
    const a = normalizarAmbiente(ambiente);
    return {
      cnpj: c,
      ambiente: a,
      identidade: chaveIdentidade(c, a),
      fila: this._queue.snapshot(c, a),
      cooldown: this._cooldown.obter(c, a),
      circuit_breaker: this._circuit.obterEstado(c, a),
      ultima_consulta: this._audit.ultima(),
      consultas_recentes: this._audit.listarRecentes(10)
    };
  }

  _resetForTests() {
    this._rate._resetForTests?.();
    this._cooldown._resetForTests?.();
    this._circuit._resetForTests?.();
    this._queue._resetForTests?.();
    this._audit._resetForTests?.();
  }
}

const instancia = new SEFAZQueryGate();

module.exports = instancia;
module.exports.SEFAZQueryGate = SEFAZQueryGate;
module.exports.GateError = GateError;
module.exports.TIPOS_CONSULTA = TIPOS_CONSULTA;
module.exports.ORIGENS = ORIGENS;
module.exports.ESTADOS_SOLICITACAO = ESTADOS_SOLICITACAO;
module.exports.ERROS = ERROS;
module.exports.CIRCUIT_STATE = CIRCUIT_STATE;
