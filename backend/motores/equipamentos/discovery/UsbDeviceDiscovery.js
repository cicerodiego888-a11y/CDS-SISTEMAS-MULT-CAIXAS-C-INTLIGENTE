'use strict';

/**
 * UsbDeviceDiscovery — Discovery USB (RC2).
 * Baseado em VID/PID/Manufacturer/Product/Serial (enumeração PnP / sysfs).
 */

const UsbTransport = require('../transport/UsbTransport');
const { tentarCriarCandidate, normalizarCapacidades } = require('./CandidateDTO');
const { mapPool, clamparConcorrencia } = require('./networkUtils');
const { listarDispositivosUsb } = require('./deviceEnumeration');

function normalizarHex(v) {
  if (v == null || v === '') return null;
  return String(v).replace(/^0x/i, '').toUpperCase().padStart(4, '0');
}

class UsbDeviceDiscovery {
  /**
   * @param {Object} spec
   * @param {string} spec.driver_codigo
   * @param {string} spec.fabricante
   * @param {string} spec.modelo
   * @param {string[]} [spec.keywords]
   * @param {Array<{ vid: string, pid: string }>} [spec.vidPids]
   * @param {boolean} [spec.aceitarGenerico]
   */
  constructor(spec = {}) {
    this.spec = spec;
  }

  /**
   * @param {Object} [opcoes]
   * @returns {Promise<{ candidatos: Object[], erros: Object[], meta: Object }>}
   */
  async descobrir(opcoes = {}) {
    const timeoutMs = Number(opcoes.timeoutMs || 500);
    const concorrencia = clamparConcorrencia(opcoes.concorrencia != null ? opcoes.concorrencia : 8);
    const keywords = (this.spec.keywords || []).map((k) => String(k).toLowerCase());
    const vidPids = (this.spec.vidPids || []).map((x) => ({
      vid: normalizarHex(x.vid),
      pid: normalizarHex(x.pid)
    }));

    let dispositivos = Array.isArray(opcoes.dispositivos_usb) && opcoes.dispositivos_usb.length
      ? opcoes.dispositivos_usb
      : listarDispositivosUsb();

    if (opcoes.cancelado && opcoes.cancelado()) {
      return { candidatos: [], erros: [{ codigo: 'CANCELADO', mensagem: 'USB cancelado' }], meta: { probes_total: 0, probes_ok: 0 } };
    }

    const erros = [];
    let probesOk = 0;

    const resultados = await mapPool(
      dispositivos,
      concorrencia,
      async (dev) => {
        if (opcoes.cancelado && opcoes.cancelado()) return null;
        try {
          return await this._probeDispositivo(dev, timeoutMs, keywords, vidPids);
        } catch (err) {
          return { erro: { codigo: 'USB_PROBE_ERRO', mensagem: err.message } };
        }
      },
      { cancelado: opcoes.cancelado }
    );

    const candidatos = [];
    for (const r of resultados) {
      if (!r) continue;
      if (r.erro && !r.candidate) {
        erros.push(r.erro);
        continue;
      }
      if (r.candidate) {
        probesOk += 1;
        candidatos.push(r.candidate);
      }
    }

    return {
      candidatos,
      erros,
      meta: {
        probes_total: dispositivos.length,
        probes_ok: probesOk,
        timeout_ms: timeoutMs,
        concorrencia
      }
    };
  }

  /**
   * @private
   */
  async _probeDispositivo(dev, timeoutMs, keywords, vidPids) {
    const vid = normalizarHex(dev.vid);
    const pid = normalizarHex(dev.pid);
    const caminho = dev.caminho_dispositivo || null;
    const texto = `${dev.nome || ''} ${dev.manufacturer || ''} ${dev.product || ''}`.toLowerCase();

    const matchVidPid = vidPids.length > 0 && vid && pid
      ? vidPids.some((x) => x.vid === vid && (!x.pid || x.pid === pid))
      : false;
    const matchKeyword = keywords.length
      ? keywords.some((k) => texto.includes(k))
      : false;

    if (!matchVidPid && !matchKeyword && !this.spec.aceitarGenerico) {
      return {};
    }
    if (!vid && !pid && !caminho) {
      return {};
    }

    let probeOk = false;
    const transport = new UsbTransport({
      vendorId: vid,
      productId: pid,
      timeout: timeoutMs,
      maxReconexoes: 0
    });

    try {
      const r = await transport.probeRapido({ timeout: timeoutMs });
      probeOk = r?.ok === true;
    } catch (_) {
      probeOk = false;
    } finally {
      try {
        await transport.desconectar();
      } catch (_) { /* */ }
    }

    let confianca = 0.3;
    if (matchVidPid) confianca = 0.9;
    else if (matchKeyword) confianca = 0.65;
    else if (probeOk) confianca = 0.4;

    const candidate = tentarCriarCandidate({
      transporte: 'usb',
      caminho_dispositivo: caminho,
      vid,
      pid,
      driver_codigo: this.spec.driver_codigo,
      confianca,
      origem: `driver:${this.spec.driver_codigo}`,
      fabricante: this.spec.fabricante,
      modelo: this.spec.modelo,
      protocolo: this.spec.protocolo || null,
      evidencias: {
        match_vid_pid: matchVidPid,
        match_keyword: matchKeyword,
        manufacturer: dev.manufacturer || null,
        product: dev.product || null,
        serial_number: dev.serial_number || null,
        probe: probeOk
      },
      observacoes: matchVidPid
        ? `USB VID/PID ${vid}:${pid} compatível`
        : (matchKeyword ? `USB compatível com ${this.spec.fabricante}` : 'Dispositivo USB enumerado'),
      capacidades: normalizarCapacidades(this.spec.capacidades || {
        discovery: true,
        configuracao: true,
        diagnostico: true,
        sincronizacao: true,
        monitoramento: false
      })
    });

    if (!candidate) {
      return { erro: { codigo: 'CANDIDATE_INVALIDO', mensagem: 'USB candidate inválido' } };
    }
    return { candidate };
  }
}

module.exports = UsbDeviceDiscovery;
module.exports.normalizarHex = normalizarHex;
