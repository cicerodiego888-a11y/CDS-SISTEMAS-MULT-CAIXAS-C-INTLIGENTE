/**
 * CentralSefazOperationalGate — RC7.4.2 / RC7.4.3
 *
 * Gate operacional único + Circuit Breaker Enterprise para DistDFe.
 * Cooldown progressivo 656, CONFIG_ERROR 593, histórico circular, telemetria.
 *
 * Não altera DistDFe, Manifestação, Parser, MIIP, SOAP ou schema.
 *
 * @module motores/central-entradas/services/CentralSefazOperationalGate
 */

const CentralConfigRepository = require('../repositories/CentralConfigRepository');
const { logCentral, logCentralErro } = require('../utils/centralLog');
const { criarCorrelationId } = require('../utils/centralOperacaoLog');

const CHAVE_ESTADO = 'xml_wait_scheduler_state';
const HISTORICO_MAX = 100;

/** Cooldown progressivo cStat 656 (minutos). */
const COOLDOWN_656_MINUTOS = Object.freeze([10, 20, 40, 60, 120]);
/** Teto do cooldown (compat export / 5ª+ ocorrência). */
const INTERVALO_BLOQUEIO_656_MS = COOLDOWN_656_MINUTOS[COOLDOWN_656_MINUTOS.length - 1] * 60 * 1000;

/** Circuit Breaker — estados oficiais RC7.4.3 */
const ESTADO_OPERACIONAL = Object.freeze({
  NORMAL: 'NORMAL',
  WARNING: 'WARNING',
  BLOCKED: 'BLOCKED',
  RECOVERING: 'RECOVERING',
  CONFIG_ERROR: 'CONFIG_ERROR',
  // Aliases RC7.4.2 (compat UI/API)
  AGUARDANDO_XML: 'WARNING',
  BLOQUEIO_656: 'BLOCKED',
  ERRO_593: 'CONFIG_ERROR'
});

const CSTAT_OPERACIONAIS = Object.freeze(['137', '138', '593', '656', '108', '109']);
const ERROS_INTERNOS = Object.freeze([
  'TIMEOUT',
  'SOAP_EXCEPTION',
  'ERRO_XML',
  'ERRO_RUNTIME',
  'ERRO_BANCO',
  'ERRO_UPLOAD',
  'ERRO_PARSER',
  'ERRO_MIIP'
]);

function formatarDuracao(ms) {
  const seg = Math.max(0, Math.floor(Number(ms) / 1000));
  if (seg < 60) return `${seg}s`;
  if (seg < 3600) return `${Math.floor(seg / 60)} min`;
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  return `${h}h ${m}min`;
}

function media(arr) {
  if (!arr || !arr.length) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function calcularCooldown656Ms(contador) {
  const n = Math.max(1, Number(contador) || 1);
  const idx = Math.min(COOLDOWN_656_MINUTOS.length - 1, n - 1);
  return COOLDOWN_656_MINUTOS[idx] * 60 * 1000;
}

function metaEstado(codigo) {
  const map = {
    NORMAL: { label: 'Normal', indicador: '🟢', severidade: 'ok' },
    WARNING: { label: 'Atenção', indicador: '🟡', severidade: 'info' },
    BLOCKED: { label: 'Bloqueado', indicador: '🟠', severidade: 'alerta' },
    RECOVERING: { label: 'Recuperando', indicador: '🔵', severidade: 'info' },
    CONFIG_ERROR: { label: 'Configuração', indicador: '🔴', severidade: 'critico' }
  };
  return map[codigo] || map.NORMAL;
}

async function fingerprintFiscalDetalhado() {
  try {
    const { getFiscalConfig } = require('../../../services/fiscal/configService');
    const fiscal = await getFiscalConfig({ validarUrls: false });
    const cnpj = String(fiscal?.cnpj || '').replace(/\D/g, '');
    const pathCert = String(fiscal?.certificadoPath || '');
    let serial = '';
    let thumbprint = '';
    let validade = null;

    if (pathCert && fiscal?.certificadoSenha) {
      try {
        const forge = require('node-forge');
        const fs = require('fs');
        const p12Der = fs.readFileSync(pathCert, 'binary');
        const p12Asn1 = forge.asn1.fromDer(p12Der);
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, fiscal.certificadoSenha);
        const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
        const bag = bags[forge.pki.oids.certBag]?.[0];
        const cert = bag?.cert;
        if (cert) {
          serial = String(cert.serialNumber || '');
          const md = forge.md.sha1.create();
          md.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
          thumbprint = md.digest().toHex().toUpperCase();
          validade = cert.validity?.notAfter
            ? new Date(cert.validity.notAfter).toISOString()
            : null;
        }
      } catch { /* fingerprint parcial */ }
    }

    const fingerprint = `${cnpj}|${pathCert}|${serial}|${thumbprint}`;
    return {
      fingerprint,
      cnpjCertificado: cnpj || null,
      path: pathCert || null,
      serial: serial || null,
      thumbprint: thumbprint || null,
      validade
    };
  } catch {
    return {
      fingerprint: null,
      cnpjCertificado: null,
      path: null,
      serial: null,
      thumbprint: null,
      validade: null
    };
  }
}

async function fingerprintFiscalPadrao() {
  const det = await fingerprintFiscalDetalhado();
  return det.fingerprint;
}

class CentralSefazOperationalGate {
  constructor(deps = {}) {
    this._configRepository = deps.configRepository || new CentralConfigRepository();
    this._agora = deps.agora || (() => new Date());
    this._obterFingerprint = deps.obterFingerprintConfig || fingerprintFiscalPadrao;
    this._obterFingerprintDetalhado = deps.obterFingerprintDetalhado || fingerprintFiscalDetalhado;
    this._onChange = typeof deps.onStateChange === 'function' ? deps.onStateChange : null;
    this._autoPersist = deps.autoPersist !== false;

    /** @private */
    this._circuitState = ESTADO_OPERACIONAL.NORMAL;
    /** @private */
    this._bloqueio656 = null;
    /** @private */
    this._contador656 = 0;
    /** @private */
    this._backoffAtualMs = 0;
    /** @private */
    this._estado593 = null;
    /** @private */
    this._historico = [];
    /** @private */
    this._carregado = false;
    /** @private */
    this._persistindo = false;
    /** @private */
    this._documentosAguardandoHint = 0;
    /** @private */
    this._metricas = {
      consultasSOAP: 0,
      consultasEvitadas: 0,
      bloqueios656: 0,
      erros593: 0,
      temposBloqueioMs: [],
      temposConsultaMs: [],
      temposRespostaMs: [],
      temposEntreConsultasMs: [],
      ultimoDesbloqueio: null,
      contagemCStat: { 137: 0, 138: 0, 656: 0, 593: 0, 108: 0, 109: 0 },
      errosInternos: {
        TIMEOUT: 0,
        SOAP_EXCEPTION: 0,
        ERRO_XML: 0,
        ERRO_RUNTIME: 0,
        ERRO_BANCO: 0,
        ERRO_UPLOAD: 0,
        ERRO_PARSER: 0,
        ERRO_MIIP: 0
      },
      ultimaRespostaSEFAZ: null,
      historicoDesbloqueios: [],
      historicoErros593: [],
      ultimaConsultaEm: null
    };
  }

  static get INTERVALO_BLOQUEIO_656_MS() {
    return INTERVALO_BLOQUEIO_656_MS;
  }

  static get COOLDOWN_656_MINUTOS() {
    return COOLDOWN_656_MINUTOS;
  }

  static get ESTADO_OPERACIONAL() {
    return ESTADO_OPERACIONAL;
  }

  static get CHAVE_ESTADO() {
    return CHAVE_ESTADO;
  }

  static get CSTAT_OPERACIONAIS() {
    return CSTAT_OPERACIONAIS;
  }

  static get ERROS_INTERNOS() {
    return ERROS_INTERNOS;
  }

  static calcularCooldown656Ms(contador) {
    return calcularCooldown656Ms(contador);
  }

  /** @param {number} n */
  definirDocumentosAguardando(n) {
    this._documentosAguardandoHint = Math.max(0, Number(n) || 0);
  }

  obterContador656() {
    return this._contador656;
  }

  obterBackoffAtualMs() {
    if (this.estaBloqueado656()) {
      return this._bloqueio656?.intervaloMs || this._backoffAtualMs || 0;
    }
    return this._backoffAtualMs || 0;
  }

  /**
   * Hidrata estado a partir do JSON do Scheduler (sem I/O).
   * @param {Object} parsed
   */
  hidratar(parsed = {}) {
    this._contador656 = Number(parsed.contador656) || 0;
    this._backoffAtualMs = Number(parsed.backoffAtual) || 0;

    if (parsed.estadoOperacional
      && Object.values(ESTADO_OPERACIONAL).includes(parsed.estadoOperacional)) {
      this._circuitState = parsed.estadoOperacional;
    }

    if (Array.isArray(parsed.historico)) {
      this._historico = parsed.historico.slice(-HISTORICO_MAX);
    }

    if (parsed.bloqueio656?.bloqueadoAte) {
      this._bloqueio656 = {
        bloqueadoAte: parsed.bloqueio656.bloqueadoAte,
        motivo: parsed.bloqueio656.motivo || 'Consumo Indevido (656)',
        cStat: '656',
        correlationId: parsed.bloqueio656.correlationId || criarCorrelationId(),
        ultimaConsulta: parsed.bloqueio656.ultimaConsulta || null,
        documentoId: parsed.bloqueio656.documentoId != null
          ? Number(parsed.bloqueio656.documentoId)
          : null,
        chave: parsed.bloqueio656.chave || null,
        nsu: parsed.bloqueio656.nsu || null,
        iniciadoEm: parsed.bloqueio656.iniciadoEm || parsed.bloqueio656.ultimaConsulta || null,
        requestId: parsed.bloqueio656.requestId || null,
        intervaloMs: parsed.bloqueio656.intervaloMs
          || calcularCooldown656Ms(this._contador656 || 1),
        ocorrencia: parsed.bloqueio656.ocorrencia || this._contador656 || 1
      };
      this._circuitState = ESTADO_OPERACIONAL.BLOCKED;
      this._avaliarDesbloqueio656();
    } else {
      this._bloqueio656 = null;
    }

    if (parsed.estado593?.ativo) {
      this._estado593 = {
        ativo: true,
        status: 'ERRO_CONFIGURACAO_CERTIFICADO',
        cStat: '593',
        motivo: parsed.estado593.motivo || 'CNPJ-base diferente do Certificado (593)',
        cnpjXml: parsed.estado593.cnpjXml || null,
        cnpjCertificado: parsed.estado593.cnpjCertificado || null,
        fingerprint: parsed.estado593.fingerprint || parsed.fingerprint || null,
        path: parsed.estado593.path || null,
        serial: parsed.estado593.serial || null,
        thumbprint: parsed.estado593.thumbprint || null,
        validade: parsed.estado593.validade || null,
        correlationId: parsed.estado593.correlationId || criarCorrelationId(),
        requestId: parsed.estado593.requestId || null,
        documentoId: parsed.estado593.documentoId != null
          ? Number(parsed.estado593.documentoId)
          : null,
        chave: parsed.estado593.chave || null,
        nsu: parsed.estado593.nsu || null,
        registradoEm: parsed.estado593.registradoEm || null,
        ultimaConsulta: parsed.estado593.ultimaConsulta || null
      };
      this._circuitState = ESTADO_OPERACIONAL.CONFIG_ERROR;
    } else {
      this._estado593 = null;
    }

    const gm = parsed.gateMetricas || parsed.metricasGate || parsed.telemetria || null;
    if (gm && typeof gm === 'object') {
      this._metricas = {
        ...this._metricas,
        ...gm,
        contagemCStat: { ...this._metricas.contagemCStat, ...(gm.contagemCStat || {}) },
        errosInternos: { ...this._metricas.errosInternos, ...(gm.errosInternos || {}) },
        temposBloqueioMs: Array.isArray(gm.temposBloqueioMs) ? gm.temposBloqueioMs : [],
        temposConsultaMs: Array.isArray(gm.temposConsultaMs) ? gm.temposConsultaMs : [],
        temposRespostaMs: Array.isArray(gm.temposRespostaMs) ? gm.temposRespostaMs : [],
        temposEntreConsultasMs: Array.isArray(gm.temposEntreConsultasMs)
          ? gm.temposEntreConsultasMs
          : [],
        historicoDesbloqueios: Array.isArray(gm.historicoDesbloqueios)
          ? gm.historicoDesbloqueios
          : [],
        historicoErros593: Array.isArray(gm.historicoErros593) ? gm.historicoErros593 : []
      };
    }

    this._carregado = true;
  }

  /**
   * Serializa campos do Gate para persistência conjunta no JSON do Scheduler.
   * @returns {Object}
   */
  serializar() {
    return {
      estadoOperacional: this._circuitState,
      contador656: this._contador656,
      backoffAtual: this.obterBackoffAtualMs(),
      bloqueio656: this._bloqueio656,
      estado593: this._estado593,
      fingerprint: this._estado593?.fingerprint || null,
      historico: this._historico.slice(-HISTORICO_MAX),
      telemetria: this._serializarMetricas(),
      gateMetricas: this._serializarMetricas()
    };
  }

  _serializarMetricas() {
    return {
      consultasSOAP: this._metricas.consultasSOAP,
      consultasEvitadas: this._metricas.consultasEvitadas,
      bloqueios656: this._metricas.bloqueios656,
      erros593: this._metricas.erros593,
      temposBloqueioMs: (this._metricas.temposBloqueioMs || []).slice(-50),
      temposConsultaMs: (this._metricas.temposConsultaMs || []).slice(-50),
      temposRespostaMs: (this._metricas.temposRespostaMs || []).slice(-50),
      temposEntreConsultasMs: (this._metricas.temposEntreConsultasMs || []).slice(-50),
      ultimoDesbloqueio: this._metricas.ultimoDesbloqueio,
      contagemCStat: { ...this._metricas.contagemCStat },
      errosInternos: { ...this._metricas.errosInternos },
      ultimaRespostaSEFAZ: this._metricas.ultimaRespostaSEFAZ,
      historicoDesbloqueios: (this._metricas.historicoDesbloqueios || []).slice(-20),
      historicoErros593: (this._metricas.historicoErros593 || []).slice(-20),
      ultimaConsultaEm: this._metricas.ultimaConsultaEm
    };
  }

  vincularPersistencia(fn) {
    this._onChange = typeof fn === 'function' ? fn : null;
    this._autoPersist = false;
  }

  async _ensureLoaded() {
    if (this._carregado) return;
    try {
      const row = await this._configRepository.buscarPorChave(CHAVE_ESTADO);
      if (row) {
        const parsed = this._configRepository.parseValor({ ...row, tipo: 'json' });
        if (parsed && typeof parsed === 'object') {
          this.hidratar(parsed);
          return;
        }
      }
    } catch (error) {
      logCentralErro('XML_WAIT', error, { Motivo: 'gate_falha_carregar' });
    }
    this._carregado = true;
  }

  async _persistir() {
    if (!this._autoPersist || this._persistindo) return;
    if (this._onChange) {
      this._onChange();
      return;
    }
    this._persistindo = true;
    try {
      let base = {};
      try {
        const row = await this._configRepository.buscarPorChave(CHAVE_ESTADO);
        if (row) {
          const parsed = this._configRepository.parseValor({ ...row, tipo: 'json' });
          if (parsed && typeof parsed === 'object') base = parsed;
        }
      } catch { /* keep base */ }

      await this._configRepository.salvar(CHAVE_ESTADO, {
        ...base,
        atualizadoEm: this._agora().toISOString(),
        ...this.serializar()
      }, 'json');
    } catch (error) {
      logCentralErro('XML_WAIT', error, { Motivo: 'gate_falha_persistir' });
    } finally {
      this._persistindo = false;
    }
  }

  _notificar() {
    if (this._onChange) this._onChange();
    else this._persistir().catch(() => {});
  }

  _setCircuit(novo, fields = {}) {
    const anterior = this._circuitState;
    if (anterior === novo) return;
    this._circuitState = novo;
    if (novo === ESTADO_OPERACIONAL.RECOVERING
      || (anterior === ESTADO_OPERACIONAL.RECOVERING && novo === ESTADO_OPERACIONAL.NORMAL)
      || (anterior === ESTADO_OPERACIONAL.CONFIG_ERROR && novo === ESTADO_OPERACIONAL.NORMAL)
      || (anterior === ESTADO_OPERACIONAL.BLOCKED && novo === ESTADO_OPERACIONAL.RECOVERING)) {
      this._logGate('SEFAZ_GATE_RECOVER', {
        ...fields,
        motivo: fields.motivo || `${anterior}->${novo}`,
        resultado: novo,
        estado: novo
      });
    }
  }

  _pushHistorico(evento) {
    this._historico.push({
      timestamp: evento.timestamp || this._agora().toISOString(),
      endpoint: evento.endpoint || null,
      cStat: evento.cStat || null,
      tempo: evento.tempo != null ? evento.tempo : (evento.tempoMs != null ? evento.tempoMs : null),
      tempoSoap: evento.tempoSoap != null ? evento.tempoSoap : null,
      resultado: evento.resultado || null,
      correlationId: evento.correlationId || null,
      requestId: evento.requestId || null,
      documento: evento.documento != null ? evento.documento : evento.documentoId,
      nsu: evento.nsu || null,
      chave: evento.chave || null,
      estado: evento.estado || this._circuitState,
      categoria: evento.categoria || null
    });
    while (this._historico.length > HISTORICO_MAX) {
      this._historico.shift();
    }
  }

  _logGate(evento, fields = {}) {
    const estado = fields.estado || this._circuitState;
    logCentral('SEFAZ_GATE', {
      Evento: evento,
      CorrelationId: fields.correlationId || null,
      RequestId: fields.requestId || null,
      DocumentoId: fields.documentoId != null ? fields.documentoId : null,
      NSU: fields.nsu || null,
      Chave: fields.chave || null,
      Endpoint: fields.endpoint || null,
      Tempo: fields.tempoMs != null ? fields.tempoMs : null,
      'Tempo restante': fields.tempoRestanteLabel || null,
      'Próxima tentativa': fields.proximaExecucao || null,
      Motivo: fields.motivo || null,
      Resultado: fields.resultado || null,
      cStat: fields.cStat || null,
      Estado: estado,
      CNPJ_XML: fields.cnpjXml || null,
      CNPJ_Certificado: fields.cnpjCertificado || null
    });
  }

  /** Compat RC7.4.x — canal XML_WAIT (sem reenviar SEFAZ_GATE). */
  _log(evento, fields = {}) {
    logCentral('XML_WAIT', {
      Evento: evento,
      CorrelationId: fields.correlationId || null,
      RequestId: fields.requestId || null,
      DocumentoId: fields.documentoId != null ? fields.documentoId : null,
      NSU: fields.nsu || null,
      Chave: fields.chave || null,
      Tempo: fields.tempoMs != null ? fields.tempoMs : null,
      'Tempo restante': fields.tempoRestanteLabel || null,
      'Próxima tentativa': fields.proximaExecucao || null,
      Motivo: fields.motivo || null,
      Resultado: fields.resultado || null,
      cStat: fields.cStat || null,
      Estado: fields.estado || this._circuitState,
      CNPJ_XML: fields.cnpjXml || null,
      CNPJ_Certificado: fields.cnpjCertificado || null
    });
  }

  _adminBypass(ctx = {}) {
    return ctx.forcarAdminConfirmado === true && ctx.confirmacaoAdmin === true;
  }

  obterBloqueio656() {
    this._avaliarDesbloqueio656();
    const b = this._bloqueio656;
    if (!b?.bloqueadoAte) {
      return {
        ativo: false,
        bloqueadoAte: null,
        tempoRestanteMs: 0,
        tempoRestanteLabel: '—',
        motivo: null,
        cStat: null,
        correlationId: null,
        ultimaConsulta: null,
        ocorrencia: this._contador656,
        intervaloMs: 0,
        backoffAtualMs: this._backoffAtualMs
      };
    }
    const restante = Math.max(0, new Date(b.bloqueadoAte).getTime() - this._agora().getTime());
    return {
      ativo: restante > 0,
      bloqueadoAte: b.bloqueadoAte,
      tempoRestanteMs: restante,
      tempoRestanteLabel: formatarDuracao(restante),
      motivo: b.motivo || 'Consumo Indevido (656)',
      cStat: b.cStat || '656',
      correlationId: b.correlationId || null,
      ultimaConsulta: b.ultimaConsulta || null,
      documentoId: b.documentoId || null,
      chave: b.chave || null,
      nsu: b.nsu || null,
      ocorrencia: b.ocorrencia || this._contador656,
      intervaloMs: b.intervaloMs || 0,
      backoffAtualMs: b.intervaloMs || this._backoffAtualMs
    };
  }

  estaBloqueado656() {
    return this.obterBloqueio656().ativo === true;
  }

  obterEstado593() {
    const e = this._estado593;
    if (!e?.ativo) {
      return { ativo: false, status: null, cStat: null, motivo: null };
    }
    return { ...e, ativo: true };
  }

  estaSuspenso593() {
    return this._estado593?.ativo === true;
  }

  obterHistorico(limite = HISTORICO_MAX) {
    const n = Math.min(HISTORICO_MAX, Math.max(1, Number(limite) || HISTORICO_MAX));
    return this._historico.slice(-n);
  }

  /**
   * Gate único — autoriza ou barra consulta DistDFe.
   * forcarConsulta NÃO bypassa; somente admin com confirmação explícita.
   */
  async autorizarConsultaDistDfe(ctx = {}) {
    await this._ensureLoaded();
    this._avaliarDesbloqueio656();
    await this._avaliarCorrecao593(ctx);

    const admin = this._adminBypass(ctx);
    const correlationId = ctx.correlationId || criarCorrelationId();
    const requestId = ctx.requestId || null;

    this._logGate('SEFAZ_GATE_START', {
      correlationId,
      requestId,
      documentoId: ctx.documentoId,
      chave: ctx.chave,
      nsu: ctx.nsu,
      endpoint: ctx.endpoint,
      motivo: ctx.motivo || 'autorizar_consulta',
      estado: this._circuitState
    });

    if (this.estaSuspenso593() && !admin) {
      this._metricas.consultasEvitadas += 1;
      const e = this.obterEstado593();
      this._logGate('SEFAZ_GATE_BLOCK', {
        correlationId,
        requestId,
        documentoId: ctx.documentoId != null ? ctx.documentoId : e.documentoId,
        chave: ctx.chave || e.chave,
        nsu: ctx.nsu || e.nsu,
        motivo: 'CONFIGURACAO_INVALIDA',
        resultado: 'SKIPPED_593',
        cStat: '593',
        cnpjXml: e.cnpjXml,
        cnpjCertificado: e.cnpjCertificado,
        estado: ESTADO_OPERACIONAL.CONFIG_ERROR
      });
      this._log('XML_WAIT_SKIPPED', {
        correlationId,
        requestId,
        documentoId: ctx.documentoId != null ? ctx.documentoId : e.documentoId,
        chave: ctx.chave || e.chave,
        nsu: ctx.nsu || e.nsu,
        motivo: 'CONFIGURACAO_INVALIDA',
        resultado: 'SKIPPED_593',
        cStat: '593',
        cnpjXml: e.cnpjXml,
        cnpjCertificado: e.cnpjCertificado
      });
      this._pushHistorico({
        correlationId,
        requestId,
        documento: ctx.documentoId,
        chave: ctx.chave || e.chave,
        nsu: ctx.nsu || e.nsu,
        cStat: '593',
        resultado: 'SKIPPED',
        categoria: 'OPERACIONAL_SEFAZ',
        estado: ESTADO_OPERACIONAL.CONFIG_ERROR
      });
      this._notificar();
      return {
        permitido: false,
        ignorado: true,
        sucesso: true,
        codigo: 'ERRO_CONFIGURACAO_CERTIFICADO',
        cStat: '593',
        mensagem: 'Consultas suspensas: CNPJ-base diferente do certificado (cStat 593). Corrija o certificado ou o CNPJ.',
        estado593: e,
        estadoOperacional: this.obterEstadoOperacional(),
        correlationId,
        requestId
      };
    }

    const bloqueio = this.obterBloqueio656();
    if (bloqueio.ativo && !admin) {
      this._metricas.consultasEvitadas += 1;
      this._logGate('SEFAZ_GATE_BLOCK', {
        correlationId,
        requestId,
        documentoId: ctx.documentoId != null ? ctx.documentoId : bloqueio.documentoId,
        chave: ctx.chave || bloqueio.chave,
        nsu: ctx.nsu || bloqueio.nsu,
        proximaExecucao: bloqueio.bloqueadoAte,
        tempoMs: bloqueio.tempoRestanteMs,
        tempoRestanteLabel: bloqueio.tempoRestanteLabel,
        motivo: ctx.motivo || 'Aguardando liberação da SEFAZ',
        resultado: 'SKIPPED_656',
        cStat: '656',
        estado: ESTADO_OPERACIONAL.BLOCKED
      });
      this._log('XML_WAIT_SKIPPED', {
        correlationId,
        requestId,
        documentoId: ctx.documentoId != null ? ctx.documentoId : bloqueio.documentoId,
        chave: ctx.chave || bloqueio.chave,
        nsu: ctx.nsu || bloqueio.nsu,
        proximaExecucao: bloqueio.bloqueadoAte,
        tempoMs: bloqueio.tempoRestanteMs,
        tempoRestanteLabel: bloqueio.tempoRestanteLabel,
        motivo: ctx.motivo || 'Aguardando liberação da SEFAZ',
        resultado: 'SKIPPED_656',
        cStat: '656'
      });
      this._pushHistorico({
        correlationId,
        requestId,
        documento: ctx.documentoId,
        chave: ctx.chave || bloqueio.chave,
        nsu: ctx.nsu || bloqueio.nsu,
        cStat: '656',
        resultado: 'SKIPPED',
        tempo: bloqueio.tempoRestanteMs,
        categoria: 'OPERACIONAL_SEFAZ',
        estado: ESTADO_OPERACIONAL.BLOCKED
      });
      this._notificar();
      return {
        permitido: false,
        ignorado: true,
        sucesso: true,
        codigo: 'BLOQUEADO_CONSUMO_INDEVIDO_656',
        cStat: '656',
        mensagem: 'Consulta temporariamente bloqueada pela SEFAZ (Consumo Indevido 656).',
        proximaConsultaEm: bloqueio.bloqueadoAte,
        tempoRestanteMs: bloqueio.tempoRestanteMs,
        tempoRestanteLabel: bloqueio.tempoRestanteLabel,
        bloqueio656: bloqueio,
        backoffAtualMs: bloqueio.intervaloMs,
        estadoOperacional: this.obterEstadoOperacional(),
        correlationId,
        requestId
      };
    }

    if (admin && (bloqueio.ativo || this.estaSuspenso593())) {
      this._logGate('SEFAZ_GATE_ALLOW', {
        correlationId,
        requestId,
        documentoId: ctx.documentoId,
        chave: ctx.chave,
        nsu: ctx.nsu,
        motivo: 'forcar_admin_confirmado',
        resultado: 'ADMIN_BYPASS',
        estado: this._circuitState
      });
    } else {
      this._logGate('SEFAZ_GATE_ALLOW', {
        correlationId,
        requestId,
        documentoId: ctx.documentoId,
        chave: ctx.chave,
        nsu: ctx.nsu,
        endpoint: ctx.endpoint,
        resultado: 'OK',
        estado: this._circuitState
      });
    }

    return {
      permitido: true,
      codigo: 'OK',
      correlationId,
      requestId,
      adminBypass: admin,
      estadoOperacional: this.obterEstadoOperacional()
    };
  }

  /**
   * Processa resposta SEFAZ (Circuit Breaker + cStat).
   */
  async processarRespostaSefaz(resultado = {}, ctx = {}) {
    await this._ensureLoaded();
    const agora = this._agora();
    const cStat = String(resultado?.cStat || '').replace(/\D/g, '') || null;
    const correlationId = ctx.correlationId || criarCorrelationId();
    const requestId = ctx.requestId || resultado?.requestId || null;
    const tempoSoap = ctx.tempoSoapMs != null
      ? Number(ctx.tempoSoapMs)
      : (resultado?.tempoMs != null ? Number(resultado.tempoMs) : null);

    if (this._metricas.ultimaConsultaEm) {
      const delta = agora.getTime() - new Date(this._metricas.ultimaConsultaEm).getTime();
      if (delta > 0 && delta < 24 * 60 * 60 * 1000) {
        this._metricas.temposEntreConsultasMs.push(delta);
        if (this._metricas.temposEntreConsultasMs.length > 100) {
          this._metricas.temposEntreConsultasMs.shift();
        }
      }
    }
    this._metricas.ultimaConsultaEm = agora.toISOString();
    this._metricas.consultasSOAP += 1;
    if (tempoSoap != null && !Number.isNaN(tempoSoap)) {
      this._metricas.temposConsultaMs.push(tempoSoap);
      this._metricas.temposRespostaMs.push(tempoSoap);
      if (this._metricas.temposConsultaMs.length > 100) this._metricas.temposConsultaMs.shift();
      if (this._metricas.temposRespostaMs.length > 100) this._metricas.temposRespostaMs.shift();
    }

    this._metricas.ultimaRespostaSEFAZ = {
      cStat,
      em: agora.toISOString(),
      correlationId,
      requestId,
      documentoId: ctx.documentoId != null ? Number(ctx.documentoId) : null,
      chave: ctx.chave || null,
      nsu: ctx.nsu || resultado?.ultNsu || null,
      mensagem: resultado?.mensagem || resultado?.xMotivo || null,
      endpoint: ctx.endpoint || resultado?.endpoint || null
    };

    if (cStat && this._metricas.contagemCStat[cStat] != null) {
      this._metricas.contagemCStat[cStat] += 1;
    } else if (cStat && CSTAT_OPERACIONAIS.includes(cStat)) {
      this._metricas.contagemCStat[cStat] = 1;
    }

    this._logGate('SEFAZ_GATE_RESPONSE', {
      correlationId,
      requestId,
      documentoId: ctx.documentoId,
      chave: ctx.chave,
      nsu: ctx.nsu || resultado?.ultNsu,
      endpoint: ctx.endpoint || resultado?.endpoint,
      tempoMs: tempoSoap,
      cStat,
      resultado: cStat || 'OK',
      estado: this._circuitState
    });

    this._pushHistorico({
      correlationId,
      requestId,
      documento: ctx.documentoId,
      chave: ctx.chave,
      nsu: ctx.nsu || resultado?.ultNsu,
      endpoint: ctx.endpoint || resultado?.endpoint,
      cStat,
      tempo: tempoSoap,
      tempoSoap,
      resultado: cStat || 'OK',
      categoria: CSTAT_OPERACIONAIS.includes(cStat) ? 'OPERACIONAL_SEFAZ' : 'OPERACIONAL_SEFAZ'
    });

    if (cStat === '656') {
      const bloq = this.registrarBloqueio656({
        ...ctx,
        correlationId,
        requestId,
        nsu: ctx.nsu || resultado?.ultNsu,
        endpoint: ctx.endpoint
      });
      return { acao: 'bloquear', cStat: '656', bloqueio656: bloq, estadoOperacional: this.obterEstadoOperacional() };
    }

    if (cStat === '593') {
      const err = await this.registrarErro593({
        ...ctx,
        correlationId,
        requestId,
        cnpjXml: ctx.cnpjXml || resultado?.cnpjXml || null,
        cnpjCertificado: ctx.cnpjCertificado || resultado?.cnpjCertificado || null,
        mensagem: resultado?.mensagem || resultado?.xMotivo
      });
      return { acao: 'suspender', cStat: '593', estado593: err, estadoOperacional: this.obterEstadoOperacional() };
    }

    if (cStat === '137' || cStat === '108' || cStat === '109') {
      this._resetContador656PorSucesso();
      if (this._circuitState === ESTADO_OPERACIONAL.RECOVERING) {
        this._setCircuit(ESTADO_OPERACIONAL.NORMAL, { correlationId, motivo: 'recover_ok_apos_consulta' });
      } else if (this._circuitState === ESTADO_OPERACIONAL.NORMAL) {
        this._setCircuit(ESTADO_OPERACIONAL.WARNING, {
          correlationId,
          motivo: cStat === '137' ? 'cstat_137_sem_documentos' : `cstat_${cStat}`
        });
      }
      this._logGate('SEFAZ_GATE_RETRY', {
        correlationId,
        requestId,
        documentoId: ctx.documentoId,
        chave: ctx.chave,
        nsu: ctx.nsu,
        cStat,
        motivo: 'backoff_sem_bloqueio',
        estado: this._circuitState
      });
      this._notificar();
      return { acao: 'backoff', cStat, estadoOperacional: this.obterEstadoOperacional() };
    }

    if (cStat === '138') {
      this._resetContador656PorSucesso();
      this._setCircuit(ESTADO_OPERACIONAL.NORMAL, { correlationId, motivo: 'cstat_138_sucesso' });
      this._notificar();
      return { acao: 'continuar', cStat: '138', estadoOperacional: this.obterEstadoOperacional() };
    }

    // Resposta bem-sucedida genérica (sem erro operacional)
    if (!cStat || !['656', '593'].includes(cStat)) {
      this._resetContador656PorSucesso();
      if (this._circuitState === ESTADO_OPERACIONAL.RECOVERING
        || this._circuitState === ESTADO_OPERACIONAL.WARNING) {
        this._setCircuit(ESTADO_OPERACIONAL.NORMAL, { correlationId, motivo: 'resposta_ok' });
      }
    }

    this._notificar();
    return { acao: 'continuar', cStat, estadoOperacional: this.obterEstadoOperacional() };
  }

  /**
   * Registra erro interno CDS (não SEFAZ).
   */
  processarErroInterno(tipo, ctx = {}) {
    const codigo = ERROS_INTERNOS.includes(tipo) ? tipo : 'ERRO_RUNTIME';
    this._metricas.errosInternos[codigo] = (this._metricas.errosInternos[codigo] || 0) + 1;
    if (codigo === 'TIMEOUT') {
      this._logGate('SEFAZ_GATE_TIMEOUT', {
        correlationId: ctx.correlationId,
        requestId: ctx.requestId,
        documentoId: ctx.documentoId,
        chave: ctx.chave,
        nsu: ctx.nsu,
        endpoint: ctx.endpoint,
        tempoMs: ctx.tempoMs,
        motivo: ctx.motivo || 'timeout',
        resultado: 'TIMEOUT',
        estado: this._circuitState
      });
    }
    if (this._circuitState === ESTADO_OPERACIONAL.NORMAL) {
      this._setCircuit(ESTADO_OPERACIONAL.WARNING, {
        correlationId: ctx.correlationId,
        motivo: `erro_interno_${codigo}`
      });
    }
    this._pushHistorico({
      correlationId: ctx.correlationId,
      requestId: ctx.requestId,
      documento: ctx.documentoId,
      chave: ctx.chave,
      nsu: ctx.nsu,
      endpoint: ctx.endpoint,
      tempo: ctx.tempoMs,
      resultado: codigo,
      categoria: 'INTERNO_CDS',
      estado: this._circuitState
    });
    this._notificar();
    return { categoria: 'INTERNO_CDS', codigo };
  }

  _resetContador656PorSucesso() {
    if (this._contador656 > 0) {
      this._contador656 = 0;
      this._backoffAtualMs = 0;
    }
  }

  registrarBloqueio656(dados = {}) {
    const agora = this._agora();
    this._contador656 = Math.max(1, this._contador656 + 1);
    const intervaloMs = Number(dados.intervaloMs) || calcularCooldown656Ms(this._contador656);
    this._backoffAtualMs = intervaloMs;
    const bloqueadoAte = new Date(agora.getTime() + intervaloMs).toISOString();

    this._bloqueio656 = {
      bloqueadoAte,
      motivo: dados.motivo || 'Consumo Indevido (656)',
      cStat: '656',
      correlationId: dados.correlationId || criarCorrelationId(),
      ultimaConsulta: agora.toISOString(),
      documentoId: dados.documentoId != null ? Number(dados.documentoId) : null,
      chave: dados.chave || null,
      nsu: dados.nsu || null,
      iniciadoEm: agora.toISOString(),
      requestId: dados.requestId || null,
      intervaloMs,
      ocorrencia: this._contador656
    };
    this._metricas.bloqueios656 += 1;
    this._circuitState = ESTADO_OPERACIONAL.BLOCKED;

    this._logGate('SEFAZ_GATE_BLOCK', {
      correlationId: this._bloqueio656.correlationId,
      requestId: this._bloqueio656.requestId,
      documentoId: this._bloqueio656.documentoId,
      chave: this._bloqueio656.chave,
      nsu: this._bloqueio656.nsu,
      endpoint: dados.endpoint,
      proximaExecucao: bloqueadoAte,
      tempoMs: intervaloMs,
      tempoRestanteLabel: formatarDuracao(intervaloMs),
      motivo: `${this._bloqueio656.motivo} (#${this._contador656})`,
      resultado: '656',
      cStat: '656',
      estado: ESTADO_OPERACIONAL.BLOCKED
    });
    this._log('XML_WAIT_BLOCKED_656', {
      correlationId: this._bloqueio656.correlationId,
      requestId: this._bloqueio656.requestId,
      documentoId: this._bloqueio656.documentoId,
      chave: this._bloqueio656.chave,
      nsu: this._bloqueio656.nsu,
      proximaExecucao: bloqueadoAte,
      tempoMs: intervaloMs,
      tempoRestanteLabel: formatarDuracao(intervaloMs),
      motivo: this._bloqueio656.motivo,
      resultado: '656',
      cStat: '656'
    });
    this._logGate('SEFAZ_GATE_RETRY', {
      correlationId: this._bloqueio656.correlationId,
      requestId: this._bloqueio656.requestId,
      documentoId: this._bloqueio656.documentoId,
      chave: this._bloqueio656.chave,
      nsu: this._bloqueio656.nsu,
      proximaExecucao: bloqueadoAte,
      motivo: 'proxima_janela_agendada',
      resultado: 'NEXT_ALLOWED',
      estado: ESTADO_OPERACIONAL.BLOCKED
    });
    this._log('XML_WAIT_NEXT_ALLOWED', {
      correlationId: this._bloqueio656.correlationId,
      requestId: this._bloqueio656.requestId,
      documentoId: this._bloqueio656.documentoId,
      chave: this._bloqueio656.chave,
      nsu: this._bloqueio656.nsu,
      proximaExecucao: bloqueadoAte,
      motivo: 'liberacao_apos_bloqueio_656'
    });

    this._notificar();
    return this.obterBloqueio656();
  }

  limparBloqueio656(motivo = 'limpeza') {
    const anterior = this._bloqueio656;
    if (!anterior) return false;
    const inicio = anterior.iniciadoEm ? new Date(anterior.iniciadoEm).getTime() : null;
    if (inicio && !Number.isNaN(inicio)) {
      this._metricas.temposBloqueioMs.push(Math.max(0, this._agora().getTime() - inicio));
      if (this._metricas.temposBloqueioMs.length > 100) this._metricas.temposBloqueioMs.shift();
    }
    const desbloqueio = {
      em: this._agora().toISOString(),
      motivo,
      correlationId: anterior.correlationId || null,
      documentoId: anterior.documentoId || null
    };
    this._metricas.ultimoDesbloqueio = desbloqueio.em;
    this._metricas.historicoDesbloqueios.push(desbloqueio);
    if (this._metricas.historicoDesbloqueios.length > 50) {
      this._metricas.historicoDesbloqueios.shift();
    }
    this._bloqueio656 = null;
    if (motivo === 'upload' || motivo === 'limpeza') {
      this._resetContador656PorSucesso();
      this._setCircuit(ESTADO_OPERACIONAL.NORMAL, {
        correlationId: anterior.correlationId,
        motivo
      });
    } else {
      this._setCircuit(ESTADO_OPERACIONAL.RECOVERING, {
        correlationId: anterior.correlationId,
        motivo
      });
    }
    this._logGate('SEFAZ_GATE_UNLOCK', {
      correlationId: anterior.correlationId || criarCorrelationId(),
      requestId: anterior.requestId,
      documentoId: anterior.documentoId,
      chave: anterior.chave,
      nsu: anterior.nsu,
      motivo,
      estado: this._circuitState
    });
    this._log('XML_WAIT_UNLOCK', {
      correlationId: anterior.correlationId || criarCorrelationId(),
      requestId: anterior.requestId,
      documentoId: anterior.documentoId,
      chave: anterior.chave,
      nsu: anterior.nsu,
      motivo
    });
    this._notificar();
    return true;
  }

  async registrarErro593(dados = {}) {
    const agora = this._agora();
    let detalhe = {
      fingerprint: dados.fingerprint || null,
      cnpjCertificado: dados.cnpjCertificado || null,
      path: dados.path || null,
      serial: dados.serial || null,
      thumbprint: dados.thumbprint || null,
      validade: dados.validade || null
    };
    if (!detalhe.fingerprint) {
      try {
        const d = await this._obterFingerprintDetalhado();
        detalhe = { ...detalhe, ...d };
        if (dados.cnpjCertificado) detalhe.cnpjCertificado = dados.cnpjCertificado;
      } catch {
        try {
          detalhe.fingerprint = await this._obterFingerprint();
        } catch { /* ignore */ }
      }
    }

    this._estado593 = {
      ativo: true,
      status: 'ERRO_CONFIGURACAO_CERTIFICADO',
      cStat: '593',
      motivo: dados.mensagem || dados.motivo || 'CNPJ-base diferente do Certificado (593)',
      cnpjXml: dados.cnpjXml || null,
      cnpjCertificado: detalhe.cnpjCertificado || dados.cnpjCertificado || null,
      fingerprint: detalhe.fingerprint,
      path: detalhe.path || null,
      serial: detalhe.serial || null,
      thumbprint: detalhe.thumbprint || null,
      validade: detalhe.validade || null,
      correlationId: dados.correlationId || criarCorrelationId(),
      requestId: dados.requestId || null,
      documentoId: dados.documentoId != null ? Number(dados.documentoId) : null,
      chave: dados.chave || null,
      nsu: dados.nsu || null,
      registradoEm: agora.toISOString(),
      ultimaConsulta: agora.toISOString()
    };
    this._metricas.erros593 += 1;
    this._circuitState = ESTADO_OPERACIONAL.CONFIG_ERROR;
    this._metricas.historicoErros593.push({
      em: agora.toISOString(),
      correlationId: this._estado593.correlationId,
      cnpjXml: this._estado593.cnpjXml,
      cnpjCertificado: this._estado593.cnpjCertificado,
      fingerprint: this._estado593.fingerprint,
      documentoId: this._estado593.documentoId,
      chave: this._estado593.chave
    });
    if (this._metricas.historicoErros593.length > 50) {
      this._metricas.historicoErros593.shift();
    }

    this._logGate('SEFAZ_GATE_CONFIG_ERROR', {
      correlationId: this._estado593.correlationId,
      requestId: this._estado593.requestId,
      documentoId: this._estado593.documentoId,
      chave: this._estado593.chave,
      nsu: this._estado593.nsu,
      motivo: this._estado593.motivo,
      resultado: '593',
      cStat: '593',
      cnpjXml: this._estado593.cnpjXml,
      cnpjCertificado: this._estado593.cnpjCertificado,
      estado: ESTADO_OPERACIONAL.CONFIG_ERROR
    });
    this._log('XML_WAIT_CONFIGURATION_ERROR', {
      correlationId: this._estado593.correlationId,
      requestId: this._estado593.requestId,
      documentoId: this._estado593.documentoId,
      chave: this._estado593.chave,
      nsu: this._estado593.nsu,
      motivo: this._estado593.motivo,
      resultado: '593',
      cStat: '593',
      cnpjXml: this._estado593.cnpjXml,
      cnpjCertificado: this._estado593.cnpjCertificado
    });

    this._notificar();
    return this.obterEstado593();
  }

  limparErro593(motivo = 'correcao_configuracao') {
    const anterior = this._estado593;
    if (!anterior?.ativo) return false;
    this._estado593 = null;
    this._setCircuit(ESTADO_OPERACIONAL.NORMAL, {
      correlationId: anterior.correlationId,
      motivo
    });
    this._logGate('SEFAZ_GATE_CONFIG_FIXED', {
      correlationId: anterior.correlationId || criarCorrelationId(),
      requestId: anterior.requestId,
      documentoId: anterior.documentoId,
      chave: anterior.chave,
      nsu: anterior.nsu,
      motivo,
      cnpjXml: anterior.cnpjXml,
      cnpjCertificado: anterior.cnpjCertificado,
      estado: ESTADO_OPERACIONAL.NORMAL
    });
    this._log('XML_WAIT_CONFIGURATION_FIXED', {
      correlationId: anterior.correlationId || criarCorrelationId(),
      requestId: anterior.requestId,
      documentoId: anterior.documentoId,
      chave: anterior.chave,
      nsu: anterior.nsu,
      motivo,
      cnpjXml: anterior.cnpjXml,
      cnpjCertificado: anterior.cnpjCertificado
    });
    this._notificar();
    return true;
  }

  limparBloqueiosPorUpload() {
    this.limparBloqueio656('upload');
    this.limparErro593('upload');
  }

  async _avaliarCorrecao593(ctx = {}) {
    if (!this._estado593?.ativo) return false;
    let atual = ctx.fingerprintAtual || null;
    if (!atual) {
      try {
        atual = await this._obterFingerprint();
      } catch {
        return false;
      }
    }
    if (!atual || !this._estado593.fingerprint) return false;
    if (atual === this._estado593.fingerprint) return false;
    this.limparErro593('certificado_ou_cnpj_alterado');
    return true;
  }

  _avaliarDesbloqueio656() {
    const b = this._bloqueio656;
    if (!b?.bloqueadoAte) return;
    const ate = new Date(b.bloqueadoAte).getTime();
    if (Number.isNaN(ate) || this._agora().getTime() < ate) return;

    const inicio = b.iniciadoEm
      ? new Date(b.iniciadoEm).getTime()
      : ate - (b.intervaloMs || INTERVALO_BLOQUEIO_656_MS);
    this._metricas.temposBloqueioMs.push(Math.max(0, ate - inicio));
    if (this._metricas.temposBloqueioMs.length > 100) this._metricas.temposBloqueioMs.shift();

    const desbloqueio = {
      em: this._agora().toISOString(),
      motivo: 'janela_656_expirada',
      correlationId: b.correlationId || null,
      documentoId: b.documentoId || null
    };
    this._metricas.ultimoDesbloqueio = desbloqueio.em;
    this._metricas.historicoDesbloqueios.push(desbloqueio);
    if (this._metricas.historicoDesbloqueios.length > 50) {
      this._metricas.historicoDesbloqueios.shift();
    }

    this._bloqueio656 = null;
    this._circuitState = ESTADO_OPERACIONAL.RECOVERING;

    this._logGate('SEFAZ_GATE_UNLOCK', {
      correlationId: b.correlationId || criarCorrelationId(),
      requestId: b.requestId,
      documentoId: b.documentoId,
      chave: b.chave,
      nsu: b.nsu,
      motivo: 'janela_656_expirada',
      estado: ESTADO_OPERACIONAL.RECOVERING
    });
    this._log('XML_WAIT_UNLOCK', {
      correlationId: b.correlationId || criarCorrelationId(),
      requestId: b.requestId,
      documentoId: b.documentoId,
      chave: b.chave,
      nsu: b.nsu,
      motivo: 'janela_656_expirada'
    });
    this._logGate('SEFAZ_GATE_RECOVER', {
      correlationId: b.correlationId || criarCorrelationId(),
      requestId: b.requestId,
      documentoId: b.documentoId,
      chave: b.chave,
      nsu: b.nsu,
      proximaExecucao: this._agora().toISOString(),
      motivo: 'entrada_recovering',
      resultado: 'RECOVERING',
      estado: ESTADO_OPERACIONAL.RECOVERING
    });
    this._log('XML_WAIT_NEXT_ALLOWED', {
      correlationId: b.correlationId || criarCorrelationId(),
      requestId: b.requestId,
      documentoId: b.documentoId,
      chave: b.chave,
      nsu: b.nsu,
      proximaExecucao: this._agora().toISOString(),
      motivo: 'dist_dfe_liberado'
    });
    this._notificar();
  }

  registrarConsultaEvitada656(ctx = {}) {
    const bloqueio = this.obterBloqueio656();
    if (!bloqueio.ativo) return { ignorado: false, bloqueio };
    this._metricas.consultasEvitadas += 1;
    this._log('XML_WAIT_SKIPPED', {
      correlationId: ctx.correlationId || bloqueio.correlationId || criarCorrelationId(),
      requestId: ctx.requestId || null,
      documentoId: ctx.documentoId != null ? ctx.documentoId : bloqueio.documentoId,
      chave: ctx.chave || bloqueio.chave,
      nsu: ctx.nsu || bloqueio.nsu,
      proximaExecucao: bloqueio.bloqueadoAte,
      tempoMs: bloqueio.tempoRestanteMs,
      tempoRestanteLabel: bloqueio.tempoRestanteLabel,
      motivo: ctx.motivo || 'Aguardando liberação da SEFAZ',
      resultado: 'SKIPPED_656',
      cStat: '656'
    });
    this._notificar();
    return {
      ignorado: true,
      sucesso: true,
      codigo: 'BLOQUEADO_CONSUMO_INDEVIDO_656',
      cStat: '656',
      mensagem: 'Consulta temporariamente bloqueada pela SEFAZ (Consumo Indevido 656).',
      proximaConsultaEm: bloqueio.bloqueadoAte,
      tempoRestanteMs: bloqueio.tempoRestanteMs,
      tempoRestanteLabel: bloqueio.tempoRestanteLabel,
      bloqueio656: bloqueio
    };
  }

  obterEstadoOperacional(extra = {}) {
    this._avaliarDesbloqueio656();

    if (this.estaSuspenso593()) {
      this._circuitState = ESTADO_OPERACIONAL.CONFIG_ERROR;
    } else if (this.estaBloqueado656()) {
      this._circuitState = ESTADO_OPERACIONAL.BLOCKED;
    } else if (
      this._circuitState === ESTADO_OPERACIONAL.NORMAL
      && (Number(extra.documentosAguardando != null
        ? extra.documentosAguardando
        : this._documentosAguardandoHint) || 0) > 0
    ) {
      // hint visual WARNING quando há waits — sem sobrescrever RECOVERING
      const meta = metaEstado(ESTADO_OPERACIONAL.WARNING);
      return {
        codigo: ESTADO_OPERACIONAL.WARNING,
        label: 'Aguardando XML',
        indicador: meta.indicador,
        severidade: meta.severidade,
        circuit: this._circuitState
      };
    }

    const codigo = this._circuitState || ESTADO_OPERACIONAL.NORMAL;
    const meta = metaEstado(codigo);
    return {
      codigo,
      label: meta.label,
      indicador: meta.indicador,
      severidade: meta.severidade,
      circuit: codigo
    };
  }

  obterTelemetria(extra = {}) {
    this._avaliarDesbloqueio656();
    const bloqueio = this.obterBloqueio656();
    const e593 = this.obterEstado593();
    const estado = this.obterEstadoOperacional(extra);
    const economia = this._metricas.consultasEvitadas;
    const cs = this._metricas.contagemCStat;

    return {
      consultasSOAP: this._metricas.consultasSOAP,
      consultasEvitadas: economia,
      economiaSOAP: economia,
      bloqueios656: this._metricas.bloqueios656,
      erros593: this._metricas.erros593,
      contagem137: cs['137'] || 0,
      contagem138: cs['138'] || 0,
      contagem656: cs['656'] || 0,
      contagem593: cs['593'] || 0,
      contagemCStat: { ...cs },
      tempoMedioConsulta: media(this._metricas.temposConsultaMs),
      tempoMedioBloqueio: media(this._metricas.temposBloqueioMs),
      tempoMedioResposta: media(this._metricas.temposRespostaMs),
      tempoMedioBloqueadoMs: media(this._metricas.temposBloqueioMs),
      tempoMedioEntreConsultasMs: media(this._metricas.temposEntreConsultasMs),
      estadoOperacional: estado,
      ultimoDesbloqueio: this._metricas.ultimoDesbloqueio,
      ultimoDesbloqueioEm: this._metricas.ultimoDesbloqueio,
      proximaConsulta: bloqueio.ativo
        ? bloqueio.bloqueadoAte
        : (extra.proximaConsultaPrevista || null),
      proximaConsultaPrevista: bloqueio.ativo
        ? bloqueio.bloqueadoAte
        : (extra.proximaConsultaPrevista || null),
      contador656: this._contador656,
      backoffAtualMs: this.obterBackoffAtualMs(),
      backoffAtualLabel: formatarDuracao(this.obterBackoffAtualMs()),
      ultimaRespostaSEFAZ: this._metricas.ultimaRespostaSEFAZ,
      bloqueio656: bloqueio.ativo ? bloqueio : null,
      estado593: e593.ativo ? e593 : null,
      historico: this.obterHistorico(20),
      historicoDesbloqueios: (this._metricas.historicoDesbloqueios || []).slice(-10),
      historicoErros593: (this._metricas.historicoErros593 || []).slice(-10),
      errosOperacionaisSefaz: {
        '137': cs['137'] || 0,
        '138': cs['138'] || 0,
        '593': cs['593'] || 0,
        '656': cs['656'] || 0,
        '108': cs['108'] || 0,
        '109': cs['109'] || 0
      },
      errosInternosCds: { ...this._metricas.errosInternos },
      // aliases RC7.4.1
      bloqueioAtivo: bloqueio.ativo,
      bloqueadoAte: bloqueio.bloqueadoAte,
      consultasEvitadas656: economia,
      economiaChamadasSoap: economia
    };
  }

  obterPainelOperacional(extra = {}) {
    const telemetria = this.obterTelemetria(extra);
    const bloqueio = this.obterBloqueio656();
    const e593 = this.obterEstado593();
    return {
      ...telemetria,
      titulo: 'SEFAZ OPERACIONAL',
      ultimoCStat: telemetria.ultimaRespostaSEFAZ?.cStat || null,
      ultimaConsulta: telemetria.ultimaRespostaSEFAZ?.em || this._metricas.ultimaConsultaEm,
      proximaConsulta: telemetria.proximaConsulta,
      tempoRestante: bloqueio.ativo ? bloqueio.tempoRestanteLabel : (e593.ativo ? '—' : null),
      tempoRestanteMs: bloqueio.ativo ? bloqueio.tempoRestanteMs : 0,
      quantidadeTentativas: extra.quantidadeTentativas != null
        ? extra.quantidadeTentativas
        : null,
      documentoBloqueado: bloqueio.documentoId || e593.documentoId || null,
      chaveBloqueada: bloqueio.chave || e593.chave || null,
      backoffAtual: telemetria.backoffAtualLabel,
      consultasRealizadas: telemetria.consultasSOAP,
      tempoMedio: telemetria.tempoMedioConsulta != null
        ? formatarDuracao(telemetria.tempoMedioConsulta)
        : '—',
      tempoBloqueado: telemetria.tempoMedioBloqueio != null
        ? formatarDuracao(telemetria.tempoMedioBloqueio)
        : '—'
    };
  }
}

const instancia = new CentralSefazOperationalGate();
module.exports = instancia;
module.exports.CentralSefazOperationalGate = CentralSefazOperationalGate;
module.exports.INTERVALO_BLOQUEIO_656_MS = INTERVALO_BLOQUEIO_656_MS;
module.exports.COOLDOWN_656_MINUTOS = COOLDOWN_656_MINUTOS;
module.exports.calcularCooldown656Ms = calcularCooldown656Ms;
module.exports.ESTADO_OPERACIONAL = ESTADO_OPERACIONAL;
module.exports.CHAVE_ESTADO = CHAVE_ESTADO;
module.exports.CSTAT_OPERACIONAIS = CSTAT_OPERACIONAIS;
module.exports.ERROS_INTERNOS = ERROS_INTERNOS;
module.exports.HISTORICO_MAX = HISTORICO_MAX;
