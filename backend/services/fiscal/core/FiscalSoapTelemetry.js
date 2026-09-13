/**
 * FiscalSoapTelemetry — Telemetria Enterprise da comunicação SOAP (RC6.6).
 *
 * Observe-only: não altera fluxo, XML, Registry, UrlResolver nem regras fiscais.
 * Ring buffer em memória + EventEmitter + logs padronizados.
 *
 * @module services/fiscal/core/FiscalSoapTelemetry
 */

const { EventEmitter } = require('events');
const crypto = require('crypto');
const zlib = require('zlib');
const { FiscalSoapTelemetryEvents } = require('./FiscalSoapTelemetryEvents');

const MAX_HISTORICO = 100;
const MAX_AUDIT_SOAP_CHARS = 12000;

function gerarId(prefix) {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function agoraIso() {
  return new Date().toISOString();
}

/**
 * Remove segredos de um XML/envelope para modo auditoria.
 * @param {string} xml
 * @returns {string}
 */
function sanitizarSoapXml(xml) {
  let texto = String(xml || '');
  texto = texto.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[CERTIFICADO_REMOVIDO]');
  texto = texto.replace(/(senha|password|pwd|privateKey|certificadoSenha)\s*[:=]\s*["']?[^"'<\s]+/gi, '$1=[REDACTED]');
  texto = texto.replace(/<(senha|password|pwd)[^>]*>[\s\S]*?<\/\1>/gi, '<$1>[REDACTED]</$1>');
  if (texto.length > MAX_AUDIT_SOAP_CHARS) {
    texto = `${texto.slice(0, MAX_AUDIT_SOAP_CHARS)}…[TRUNCADO]`;
  }
  return texto;
}

/**
 * Compacta texto para armazenamento opcional de auditoria.
 * @param {string} texto
 * @returns {string|null}
 */
function compactarTexto(texto) {
  if (!texto) return null;
  try {
    return zlib.gzipSync(Buffer.from(String(texto), 'utf8')).toString('base64');
  } catch {
    return null;
  }
}

/**
 * Conta docZip por schema sem alterar o parser de negócio.
 * @param {string} xmlRetorno
 * @returns {object}
 */
function contarDocZipPorTipo(xmlRetorno) {
  const contagem = {
    docZip: 0,
    RES_NFE: 0,
    PROC_NFE: 0,
    RES_EVENTO: 0,
    PROC_EVENTO: 0,
    OUTROS: 0
  };
  const regex = /<docZip([^>]*)>/gi;
  let match;
  while ((match = regex.exec(String(xmlRetorno || ''))) !== null) {
    contagem.docZip += 1;
    const schema = String(match[1].match(/schema="([^"]+)"/i)?.[1] || '').toLowerCase();
    if (schema.includes('resnfe')) contagem.RES_NFE += 1;
    else if (schema.includes('procnfe')) contagem.PROC_NFE += 1;
    else if (schema.includes('resevento')) contagem.RES_EVENTO += 1;
    else if (schema.includes('procevento')) contagem.PROC_EVENTO += 1;
    else contagem.OUTROS += 1;
  }
  return contagem;
}

/**
 * Extrai cStat/xMotivo/NSU sem depender de mutação do parser exportado.
 * @param {string} xmlRetorno
 * @returns {{ cStat: string, xMotivo: string, ultNSU: string, maxNSU: string }}
 */
function extrairMetadadosLeve(xmlRetorno) {
  const texto = String(xmlRetorno || '');
  const extrair = (tag) => {
    const regex = new RegExp(
      `<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>\\s*(\\d+)\\s*<\\/(?:[\\w.-]+:)?${tag}>`,
      'i'
    );
    const m = texto.match(regex);
    if (!m) return null;
    const digitos = String(m[1]).replace(/\D/g, '');
    return digitos ? digitos.padStart(15, '0') : null;
  };
  const cStat = texto.match(/<(?:[\w.-]+:)?cStat(?:\s[^>]*)?>\s*(\d+)\s*<\/(?:[\w.-]+:)?cStat>/i)?.[1] || '';
  const xMotivo = texto.match(/<(?:[\w.-]+:)?xMotivo(?:\s[^>]*)?>\s*(.*?)\s*<\/(?:[\w.-]+:)?xMotivo>/i)?.[1] || '';
  return {
    cStat,
    xMotivo,
    ultNSU: extrair('ultNSU'),
    maxNSU: extrair('maxNSU')
  };
}

function isLogDetalhadoAtivo() {
  try {
    // Flag opcional de processo (testes / override)
    if (process.env.CDS_FISCAL_AUDIT_SOAP === '1') return true;
    // Leitura best-effort da config da Central (não quebra se módulo/DB indisponível)
    // eslint-disable-next-line global-require
    const { getFiscalConfigSyncFlags } = require('./FiscalSoapTelemetryConfig');
    return getFiscalConfigSyncFlags().logDetalhado === true;
  } catch {
    return false;
  }
}

class FiscalSoapTelemetry {
  constructor() {
    this._emitter = new EventEmitter();
    this._emitter.setMaxListeners(50);
    /** @private @type {Map<string, object>} */
    this._abertos = new Map();
    /** @private @type {object[]} */
    this._historico = [];
    /** @private */
    this._stats = {
      total: 0,
      sucesso: 0,
      falha: 0,
      timeout: 0,
      httpErro: 0,
      somaTempoTotalMs: 0,
      maxTempoTotalMs: 0,
      somaTempoSoapMs: 0,
      retries: 0,
      documentos: 0
    };
  }

  on(evento, listener) {
    this._emitter.on(evento, listener);
    return () => this._emitter.off(evento, listener);
  }

  /**
   * Inicia uma comunicação SOAP.
   * @param {object} [dados]
   * @returns {{ correlationId: string, requestId: string }}
   */
  iniciar(dados = {}) {
    const correlationId = dados.correlationId || gerarId('corr');
    const requestId = dados.requestId || gerarId('req');
    const registro = {
      correlationId,
      requestId,
      timestampInicio: agoraIso(),
      timestampFim: null,
      tempoResolverMs: null,
      tempoXmlMs: null,
      tempoTransporteMs: null,
      tempoTotalMs: null,
      endpoint: dados.endpoint || null,
      origem: dados.origem || 'Registry',
      modelo: dados.modelo || null,
      operacao: dados.operacao || null,
      ambiente: dados.ambiente || null,
      uf: dados.uf || null,
      soapAction: dados.soapAction || null,
      httpStatus: null,
      cStat: null,
      xMotivo: null,
      ultNSU: null,
      maxNSU: null,
      docZip: 0,
      persistidos: 0,
      descartados: 0,
      duplicados: 0,
      RES_NFE: 0,
      PROC_NFE: 0,
      RES_EVENTO: 0,
      PROC_EVENTO: 0,
      fallbackUtilizado: false,
      transportSuccess: null,
      retry: 0,
      resultado: 'EM_ANDAMENTO',
      erro: null,
      soapEnviadoCompactado: null,
      soapRecebidoCompactado: null
    };

    this._abertos.set(requestId, registro);
    this._emit(FiscalSoapTelemetryEvents.SOAP_INICIADO, registro);
    return { correlationId, requestId };
  }

  /**
   * Atualiza campos de um request em andamento (observe-only).
   * @param {string} requestId
   * @param {object} patch
   */
  atualizar(requestId, patch = {}) {
    const reg = this._abertos.get(requestId);
    if (!reg) return null;
    Object.assign(reg, patch);
    return reg;
  }

  /**
   * Registra resultado do transporte HTTP/SOAP.
   * @param {string} requestId
   * @param {object} transporte
   */
  registrarTransporte(requestId, transporte = {}) {
    if (!this._abertos.has(requestId)) {
      this.iniciar({
        requestId,
        correlationId: transporte.correlationId,
        endpoint: transporte.endpoint,
        operacao: transporte.operacao,
        modelo: transporte.modelo,
        ambiente: transporte.ambiente,
        uf: transporte.uf,
        soapAction: transporte.soapAction,
        origem: transporte.origem || 'Registry'
      });
    }

    const alvo = this._abertos.get(requestId);
    if (!alvo) return null;

    alvo.httpStatus = transporte.httpStatus != null ? transporte.httpStatus : alvo.httpStatus;
    alvo.tempoTransporteMs = transporte.tempoTransporteMs != null
      ? transporte.tempoTransporteMs
      : alvo.tempoTransporteMs;
    alvo.transportSuccess = transporte.transportSuccess;
    alvo.retry = Number(transporte.retry || 0);
    alvo.endpoint = transporte.endpoint || alvo.endpoint;
    alvo.soapAction = transporte.soapAction || alvo.soapAction;
    alvo.operacao = transporte.operacao || alvo.operacao;
    alvo.modelo = transporte.modelo || alvo.modelo;
    alvo.ambiente = transporte.ambiente || alvo.ambiente;
    alvo.uf = transporte.uf || alvo.uf;
    alvo.erro = transporte.erro || alvo.erro;

    if (isLogDetalhadoAtivo()) {
      if (transporte.soapEnviado) {
        alvo.soapEnviadoCompactado = compactarTexto(sanitizarSoapXml(transporte.soapEnviado));
      }
      if (transporte.soapRecebido) {
        alvo.soapRecebidoCompactado = compactarTexto(sanitizarSoapXml(transporte.soapRecebido));
      }
    }

    if (transporte.timeout) {
      this._emit(FiscalSoapTelemetryEvents.SOAP_TIMEOUT, { ...alvo });
    } else if (transporte.httpStatus && Number(transporte.httpStatus) >= 400) {
      this._emit(FiscalSoapTelemetryEvents.SOAP_HTTP_ERROR, { ...alvo });
    }

    return alvo;
  }

  /**
   * Enriquece com metadados de retorno DistDFe / persistência.
   * @param {string} requestId
   * @param {object} dados
   */
  registrarRetornoNegocio(requestId, dados = {}) {
    const alvo = this._abertos.get(requestId);
    if (!alvo) return null;

    if (dados.xmlRetorno) {
      const meta = extrairMetadadosLeve(dados.xmlRetorno);
      const tipos = contarDocZipPorTipo(dados.xmlRetorno);
      alvo.cStat = meta.cStat || alvo.cStat;
      alvo.xMotivo = meta.xMotivo || alvo.xMotivo;
      alvo.ultNSU = meta.ultNSU || alvo.ultNSU;
      alvo.maxNSU = meta.maxNSU || alvo.maxNSU;
      Object.assign(alvo, tipos);
      if (isLogDetalhadoAtivo() && !alvo.soapRecebidoCompactado) {
        alvo.soapRecebidoCompactado = compactarTexto(sanitizarSoapXml(dados.xmlRetorno));
      }
    }

    if (dados.cStat != null) alvo.cStat = String(dados.cStat);
    if (dados.xMotivo != null) alvo.xMotivo = String(dados.xMotivo);
    if (dados.ultNSU != null) alvo.ultNSU = String(dados.ultNSU);
    if (dados.maxNSU != null) alvo.maxNSU = String(dados.maxNSU);
    if (dados.persistidos != null) alvo.persistidos = Number(dados.persistidos);
    if (dados.duplicados != null) alvo.duplicados = Number(dados.duplicados);
    if (dados.descartados != null) alvo.descartados = Number(dados.descartados);
    if (dados.tempoResolverMs != null) alvo.tempoResolverMs = Number(dados.tempoResolverMs);
    if (dados.tempoXmlMs != null) alvo.tempoXmlMs = Number(dados.tempoXmlMs);
    if (dados.tempoTransporteMs != null) alvo.tempoTransporteMs = Number(dados.tempoTransporteMs);
    if (dados.tempoTotalMs != null) alvo.tempoTotalMs = Number(dados.tempoTotalMs);
    if (dados.fallbackUtilizado != null) alvo.fallbackUtilizado = Boolean(dados.fallbackUtilizado);
    if (dados.endpoint) alvo.endpoint = dados.endpoint;
    if (dados.origem) alvo.origem = dados.origem;

    if (alvo.cStat) {
      this._emit(FiscalSoapTelemetryEvents.SOAP_CSTAT, { ...alvo });
    }
    return alvo;
  }

  /**
   * Finaliza a comunicação e emite log padronizado.
   * @param {string} requestId
   * @param {object} [dados]
   * @returns {object|null}
   */
  finalizar(requestId, dados = {}) {
    const alvo = this._abertos.get(requestId);
    if (!alvo) return null;

    if (dados && Object.keys(dados).length) {
      this.registrarRetornoNegocio(requestId, dados);
    }

    alvo.timestampFim = agoraIso();
    if (alvo.tempoTotalMs == null && alvo.timestampInicio) {
      const ini = Date.parse(alvo.timestampInicio);
      const fim = Date.parse(alvo.timestampFim);
      if (Number.isFinite(ini) && Number.isFinite(fim)) {
        alvo.tempoTotalMs = Math.max(0, fim - ini);
      }
    }

    const falhou = dados.sucesso === false
      || alvo.transportSuccess === false
      || (alvo.httpStatus && Number(alvo.httpStatus) >= 400)
      || Boolean(dados.timeout)
      || Boolean(alvo.erro && dados.sucesso !== true);

    alvo.resultado = dados.resultado
      || (falhou ? 'ERRO' : 'OK');

    this._abertos.delete(requestId);
    this._pushHistorico({ ...alvo });
    this._atualizarStats(alvo, falhou, Boolean(dados.timeout));

    this._logPadronizado(alvo);

    if (falhou) {
      if (dados.timeout || /timeout/i.test(String(alvo.erro || ''))) {
        this._emit(FiscalSoapTelemetryEvents.SOAP_TIMEOUT, { ...alvo });
      } else if (alvo.httpStatus && Number(alvo.httpStatus) >= 400) {
        this._emit(FiscalSoapTelemetryEvents.SOAP_HTTP_ERROR, { ...alvo });
      } else {
        this._emit(FiscalSoapTelemetryEvents.SOAP_FALHA, { ...alvo });
      }
    } else {
      this._emit(FiscalSoapTelemetryEvents.SOAP_FINALIZADO, { ...alvo });
    }

    return { ...alvo };
  }

  /**
   * Atalho: observa um TransportResponse já produzido pelo SoapTransport.
   * @param {object} request TransportRequest-like
   * @param {object} response TransportResponse-like
   * @param {object} [extras]
   */
  observarTransport(request, response, extras = {}) {
    const meta = {
      ...(request?.context?.metadata || {}),
      ...(request?.metadata || {}),
      ...extras
    };
    const requestId = meta.requestId || gerarId('req');
    if (!this._abertos.has(requestId)) {
      this.iniciar({
        requestId,
        correlationId: meta.correlationId,
        endpoint: request?.context?.endpoint || meta.endpoint,
        soapAction: request?.context?.soapAction || meta.soapAction,
        operacao: request?.operacao || meta.operacao,
        modelo: request?.modelo || meta.modelo,
        ambiente: meta.ambiente,
        uf: meta.uf,
        origem: meta.origem || 'Registry'
      });
    }

    const httpStatus = response?.statusCode ?? null;
    const transportSuccess = response?.success === true;
    const timeout = response?.status === 'timeout'
      || /timeout/i.test(String(response?.error || ''));

    this.registrarTransporte(requestId, {
      httpStatus,
      tempoTransporteMs: response?.tempo,
      transportSuccess,
      retry: Math.max(0, (response?.attempts || 1) - 1),
      endpoint: request?.context?.endpoint,
      soapAction: request?.context?.soapAction,
      operacao: request?.operacao || meta.operacao,
      modelo: request?.modelo || meta.modelo,
      ambiente: meta.ambiente,
      uf: meta.uf,
      erro: response?.error || null,
      timeout,
      soapEnviado: request?.envelope || null,
      soapRecebido: typeof response?.body === 'string' ? response.body : null
    });

    // Auto-finaliza comunicações genéricas (não DistDFe orchestration).
    // DistDFe chama finalizar() após enriquecer cStat/persistência.
    if (meta.autoFinalize !== false && meta.deferFinalize !== true) {
      return this.finalizar(requestId, {
        sucesso: transportSuccess,
        timeout,
        tempoTransporteMs: response?.tempo,
        tempoTotalMs: response?.tempo,
        resultado: transportSuccess ? 'OK' : 'ERRO'
      });
    }

    return this._abertos.get(requestId) || null;
  }

  obterHistorico(limit = 50) {
    const n = Math.max(1, Number(limit) || 50);
    return this._historico.slice(0, n).map((r) => ({ ...r }));
  }

  obterUltima() {
    return this._historico[0] ? { ...this._historico[0] } : null;
  }

  /**
   * Snapshot para painel de diagnóstico.
   * @returns {object}
   */
  obterPainelComunicacao() {
    const ultima = this.obterUltima();
    const total = this._stats.total || 0;
    return {
      versao: 'RC6.6',
      geradoEm: agoraIso(),
      ultimaComunicacao: ultima,
      ultimoEndpoint: ultima?.endpoint || null,
      ultimoCStat: ultima?.cStat || null,
      ultimoHttpStatus: ultima?.httpStatus || null,
      tempoMedioMs: total
        ? Number((this._stats.somaTempoTotalMs / total).toFixed(3))
        : 0,
      tempoMaximoMs: this._stats.maxTempoTotalMs || 0,
      tempoMedioSoapMs: total
        ? Number((this._stats.somaTempoSoapMs / total).toFixed(3))
        : 0,
      retries: this._stats.retries,
      quantidadeDocumentos: this._stats.documentos,
      totais: {
        total: this._stats.total,
        sucesso: this._stats.sucesso,
        falha: this._stats.falha,
        timeout: this._stats.timeout,
        httpErro: this._stats.httpErro
      },
      historicoRecente: this.obterHistorico(10)
    };
  }

  reiniciar() {
    this._abertos.clear();
    this._historico = [];
    this._stats = {
      total: 0,
      sucesso: 0,
      falha: 0,
      timeout: 0,
      httpErro: 0,
      somaTempoTotalMs: 0,
      maxTempoTotalMs: 0,
      somaTempoSoapMs: 0,
      retries: 0,
      documentos: 0
    };
  }

  _pushHistorico(registro) {
    this._historico.unshift(registro);
    if (this._historico.length > MAX_HISTORICO) {
      this._historico.length = MAX_HISTORICO;
    }
  }

  _atualizarStats(reg, falhou, timeout) {
    this._stats.total += 1;
    if (timeout) this._stats.timeout += 1;
    else if (falhou) this._stats.falha += 1;
    else this._stats.sucesso += 1;
    if (reg.httpStatus && Number(reg.httpStatus) >= 400) this._stats.httpErro += 1;
    const totalMs = Number(reg.tempoTotalMs || 0);
    const soapMs = Number(reg.tempoTransporteMs || 0);
    this._stats.somaTempoTotalMs += totalMs;
    this._stats.somaTempoSoapMs += soapMs;
    if (totalMs > this._stats.maxTempoTotalMs) this._stats.maxTempoTotalMs = totalMs;
    this._stats.retries += Number(reg.retry || 0);
    this._stats.documentos += Number(reg.persistidos || reg.docZip || 0);
  }

  _emit(tipo, payload) {
    try {
      this._emitter.emit(tipo, payload);
      this._emitter.emit('*', { tipo, payload });
    } catch (e) {
      console.warn('[FISCAL:TELEMETRIA] falha ao emitir evento:', e.message);
    }
  }

  _logPadronizado(reg) {
    const op = String(reg.operacao || 'SOAP').toUpperCase();
    const prefix = `[FISCAL:${op}]`;
    const skipZeroKeys = new Set([
      'docZip', 'Persistidos', 'Duplicados', 'Descartados',
      'RES_NFE', 'PROC_NFE', 'RES_EVENTO', 'PROC_EVENTO', 'Retry'
    ]);
    const linhas = [
      ['CorrelationId', reg.correlationId],
      ['RequestId', reg.requestId],
      ['Endpoint', reg.endpoint],
      ['HTTP', reg.httpStatus],
      ['SOAP', reg.tempoTransporteMs != null ? `${Number(reg.tempoTransporteMs).toFixed(0)} ms` : null],
      ['Resolver', reg.tempoResolverMs != null ? `${Number(reg.tempoResolverMs).toFixed(0)} ms` : null],
      ['XML', reg.tempoXmlMs != null ? `${Number(reg.tempoXmlMs).toFixed(0)} ms` : null],
      ['Total', reg.tempoTotalMs != null ? `${Number(reg.tempoTotalMs).toFixed(0)} ms` : null],
      ['cStat', reg.cStat],
      ['xMotivo', reg.xMotivo],
      ['ultNSU', reg.ultNSU],
      ['maxNSU', reg.maxNSU],
      ['docZip', reg.docZip],
      ['Persistidos', reg.persistidos],
      ['Duplicados', reg.duplicados],
      ['Descartados', reg.descartados],
      ['RES_NFE', reg.RES_NFE],
      ['PROC_NFE', reg.PROC_NFE],
      ['RES_EVENTO', reg.RES_EVENTO],
      ['PROC_EVENTO', reg.PROC_EVENTO],
      ['Fallback', reg.fallbackUtilizado ? 'sim' : 'não'],
      ['Transport Success', reg.transportSuccess == null ? null : (reg.transportSuccess ? 'sim' : 'não')],
      ['Retry', reg.retry],
      ['Resultado', reg.resultado]
    ];

    for (const [k, v] of linhas) {
      if (v === null || v === undefined || v === '') continue;
      if (skipZeroKeys.has(k) && Number(v) === 0) continue;
      console.log(`${prefix} ${k}:\n${v}`);
    }
  }
}

const fiscalSoapTelemetry = new FiscalSoapTelemetry();

module.exports = {
  FiscalSoapTelemetry,
  fiscalSoapTelemetry,
  sanitizarSoapXml,
  compactarTexto,
  contarDocZipPorTipo,
  extrairMetadadosLeve,
  FiscalSoapTelemetryEvents
};
