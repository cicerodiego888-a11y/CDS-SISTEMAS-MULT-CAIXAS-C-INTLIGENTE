'use strict';

/**
 * SerialPortDiscovery — Discovery Serial (RC2).
 * Probe rápido: enumeração + open/close opcional via SerialTransport.
 * Nunca mantém porta aberta.
 */

const SerialTransport = require('../transport/SerialTransport');
const { tentarCriarCandidate, normalizarCapacidades } = require('./CandidateDTO');
const { mapPool, clamparConcorrencia } = require('./networkUtils');
const { listarPortasSerial } = require('./deviceEnumeration');

class SerialPortDiscovery {
  constructor(spec = {}) {
    this.spec = spec;
  }

  async descobrir(opcoes = {}) {
    const timeoutMs = Number(opcoes.timeoutMs || 500);
    const concorrencia = clamparConcorrencia(opcoes.concorrencia != null ? opcoes.concorrencia : 4);
    const keywords = (this.spec.keywords || []).map((k) => String(k).toLowerCase());

    const portas = Array.isArray(opcoes.portas_com) && opcoes.portas_com.length
      ? opcoes.portas_com.map((p) => (typeof p === 'string' ? { porta: p, nome: p, descricao: '' } : p))
      : listarPortasSerial();

    if (opcoes.cancelado && opcoes.cancelado()) {
      return {
        candidatos: [],
        erros: [{ codigo: 'CANCELADO', mensagem: 'Serial cancelado' }],
        meta: { probes_total: 0, probes_ok: 0 }
      };
    }

    const erros = [];
    let probesOk = 0;

    const resultados = await mapPool(
      portas,
      concorrencia,
      async (info) => {
        if (opcoes.cancelado && opcoes.cancelado()) return null;
        try {
          return await this._probePorta(info, timeoutMs, keywords);
        } catch (err) {
          return { erro: { codigo: 'SERIAL_PROBE_ERRO', mensagem: err.message, porta: info.porta } };
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
        probes_total: portas.length,
        probes_ok: probesOk,
        timeout_ms: timeoutMs,
        concorrencia
      }
    };
  }

  async _probePorta(info, timeoutMs, keywords) {
    const porta = String(info.porta || '');
    if (!porta) return {};

    const texto = `${info.nome || ''} ${info.descricao || ''} ${porta}`.toLowerCase();
    const matchKeyword = keywords.length > 0 && keywords.some((k) => texto.includes(k));

    // Drivers de fabricante: só candidatam se keyword casar
    if (keywords.length > 0 && !matchKeyword) {
      return {};
    }

    // Genérico: keywords vazias + aceitarGenerico
    if (keywords.length === 0 && !this.spec.aceitarGenerico) {
      return {};
    }

    let probeOk = false;
    let modoProbe = 'enumeracao';
    const transport = new SerialTransport({
      porta,
      timeout: timeoutMs,
      maxReconexoes: 0
    });

    try {
      const resultado = await transport.probeRapido({ timeout: timeoutMs });
      probeOk = resultado?.ok === true;
      modoProbe = resultado?.modo || modoProbe;
    } catch (_) {
      probeOk = false;
    } finally {
      try {
        await transport.desconectar();
      } catch (_) { /* */ }
    }

    const confianca = matchKeyword
      ? (probeOk && modoProbe === 'serialport_open' ? 0.85 : 0.55)
      : (probeOk ? 0.35 : 0.25);

    const candidate = tentarCriarCandidate({
      transporte: 'serial',
      porta_com: porta,
      driver_codigo: this.spec.driver_codigo,
      confianca,
      origem: `driver:${this.spec.driver_codigo}`,
      fabricante: this.spec.fabricante,
      modelo: this.spec.modelo,
      protocolo: this.spec.protocolo || null,
      evidencias: {
        enumeracao: true,
        match_keyword: matchKeyword,
        probe: probeOk,
        modo_probe: modoProbe,
        nome: info.nome || null,
        descricao: info.descricao || null
      },
      observacoes: matchKeyword
        ? `Porta serial compatível com ${this.spec.fabricante}`
        : 'Porta serial enumerada',
      capacidades: normalizarCapacidades(this.spec.capacidades || {
        discovery: true,
        configuracao: true,
        diagnostico: true,
        sincronizacao: true,
        monitoramento: false
      })
    });

    if (!candidate) {
      return { erro: { codigo: 'CANDIDATE_INVALIDO', mensagem: 'Serial candidate inválido', porta } };
    }
    return { candidate };
  }
}

module.exports = SerialPortDiscovery;
