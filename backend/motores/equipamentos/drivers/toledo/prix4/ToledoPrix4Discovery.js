'use strict';

/**
 * ToledoPrix4Discovery — Discovery Ethernet (RC1 / RC1.1 hardening).
 * Probe curto via EthernetTransport + handshake leve (HS).
 * Nunca propaga exceção para interromper a varredura.
 */

const EthernetTransport = require('../../../transport/EthernetTransport');
const frameBuilder = require('./ToledoPrix4FrameBuilder');
const ToledoPrix4Parser = require('./ToledoPrix4Parser');
const {
  FABRICANTE,
  MODELO,
  CODIGO_DRIVER,
  PORTAS_PADRAO,
  TIMEOUTS,
  PROTOCOLOS
} = require('./ToledoPrix4Constants');
const {
  tentarCriarCandidate,
  normalizarCapacidades
} = require('../../../discovery/CandidateDTO');
const {
  mapPool,
  expandirHostsCidr,
  clamparConcorrencia
} = require('../../../discovery/networkUtils');

const parser = new ToledoPrix4Parser();

/** Capacidades oficiais Toledo Prix 4 (padronizadas RC1.1) */
const CAPACIDADES_TOLEDO = normalizarCapacidades({
  discovery: true,
  configuracao: true,
  diagnostico: true,
  sincronizacao: true,
  monitoramento: true
});

class ToledoPrix4Discovery {
  constructor() {
    this.ultimaVarredura = null;
  }

  prepararVarreduraEthernet(opcoes = {}) {
    return {
      tipo: 'ethernet',
      portas: opcoes.portas || [PORTAS_PADRAO.ethernet, PORTAS_PADRAO.alternativa],
      timeout: opcoes.timeout || TIMEOUTS.discovery,
      implementado: true,
      mensagem: 'Varredura Ethernet RC1'
    };
  }

  prepararVarreduraRede(opcoes = {}) {
    return {
      tipo: 'rede',
      subnet: opcoes.subnet || null,
      portas: opcoes.portas || [PORTAS_PADRAO.ethernet, PORTAS_PADRAO.alternativa],
      timeout: opcoes.timeout || TIMEOUTS.discovery,
      implementado: true,
      mensagem: 'Varredura de rede RC1'
    };
  }

  /**
   * @param {Object} [opcoes]
   * @returns {Promise<{ candidatos: Object[], erros: Object[], meta: Object }>}
   */
  async descobrir(opcoes = {}) {
    const timeoutMs = Number(opcoes.timeoutMs || Math.min(TIMEOUTS.handshake, 1500));
    const concorrencia = clamparConcorrencia(opcoes.concorrencia || 32);
    const portas = Array.isArray(opcoes.portas) && opcoes.portas.length
      ? opcoes.portas.map(Number).filter((p) => p > 0 && p <= 65535)
      : [PORTAS_PADRAO.ethernet, PORTAS_PADRAO.alternativa];

    const hosts = Array.isArray(opcoes.hosts) && opcoes.hosts.length
      ? opcoes.hosts.map(String)
      : (opcoes.subnet ? expandirHostsCidr(opcoes.subnet) : []);

    const alvos = [];
    for (const ip of hosts) {
      for (const porta of portas) {
        alvos.push({ ip, porta });
      }
    }

    const erros = [];
    let probesOk = 0;
    let picoInFlight = 0;

    const resultados = await mapPool(
      alvos,
      concorrencia,
      async (alvo) => {
        if (opcoes.cancelado && opcoes.cancelado()) return null;
        try {
          return await this._probeAlvo(alvo.ip, alvo.porta, timeoutMs);
        } catch (err) {
          return {
            erro: {
              codigo: 'PROBE_EXCECAO',
              mensagem: err.message,
              ip: alvo.ip,
              porta: alvo.porta
            }
          };
        }
      },
      {
        cancelado: opcoes.cancelado,
        onInFlight: (n) => {
          if (n > picoInFlight) picoInFlight = n;
        }
      }
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

    this.ultimaVarredura = {
      timestamp: new Date().toISOString(),
      candidatos,
      simulado: false,
      probes_total: alvos.length,
      probes_ok: probesOk
    };

    return {
      candidatos,
      erros,
      meta: {
        probes_total: alvos.length,
        probes_ok: probesOk,
        concorrencia,
        timeout_ms: timeoutMs,
        in_flight_pico: picoInFlight || mapPool._ultimoPicoInFlight || 0
      }
    };
  }

  /**
   * @param {string} ip
   * @param {number} porta
   * @param {number} timeoutMs
   * @returns {Promise<{ candidate?: Object, erro?: Object }>}
   * @private
   */
  async _probeAlvo(ip, porta, timeoutMs) {
    const transport = new EthernetTransport({
      host: ip,
      porta,
      timeout: timeoutMs,
      maxReconexoes: 0
    });

    let confianca = 0.3;
    let firmware = null;
    let evidencias = { latencia_connect: true, handshake: false };
    let observacoes = 'Porta TCP aberta';
    let conectou = false;

    try {
      try {
        await transport.conectar();
        conectou = true;
      } catch (_) {
        return {};
      }

      try {
        const frame = frameBuilder.buildHandshake();
        await transport.enviar(frame);
        const resposta = await transport.receber({ timeout: timeoutMs });
        const bruto = this._extrairBuffer(resposta);

        if (bruto.length > 0) {
          let parsed = null;
          try {
            parsed = parser.parseFrame(bruto);
          } catch (_) {
            parsed = null;
            evidencias = {
              handshake: false,
              resposta_corrompida: true,
              bytes: bruto.length
            };
            confianca = 0.5;
            observacoes = 'Resposta TCP corrompida/inválida após HS';
          }

          if (parsed) {
            confianca = 0.9;
            evidencias = {
              handshake: true,
              comando_resposta: parsed.comando || null,
              bytes: bruto.length
            };
            observacoes = `Handshake Toledo OK (${parsed.comando})`;

            if (parsed.comando === 'RS' || parsed.comando === 'AK' || parsed.comando === 'ST') {
              try {
                const status = typeof parser.parseStatus === 'function'
                  ? parser.parseStatus(bruto)
                  : null;
                if (status?.firmware) firmware = status.firmware;
              } catch (_) { /* ignore */ }
            }
          } else if (!evidencias.resposta_corrompida) {
            confianca = 0.7;
            evidencias = {
              handshake: true,
              comando_resposta: null,
              bytes: bruto.length,
              handshake_parcial: true
            };
            observacoes = 'Resposta TCP recebida após HS (parcial/não parseada)';
          }
        }
      } catch (_) {
        observacoes = 'TCP aberto; handshake sem resposta / timeout';
        evidencias = { latencia_connect: true, handshake: false, timeout_leitura: true };
      }

      const candidate = tentarCriarCandidate({
        transporte: 'ethernet',
        ip,
        porta,
        driver_codigo: CODIGO_DRIVER,
        confianca,
        origem: `driver:${CODIGO_DRIVER}`,
        fabricante: FABRICANTE,
        modelo: MODELO,
        protocolo: PROTOCOLOS[0] || 'toledo-prix4',
        firmware,
        evidencias,
        observacoes,
        capacidades: CAPACIDADES_TOLEDO
      });

      if (!candidate) {
        return {
          erro: {
            codigo: 'CANDIDATE_INVALIDO',
            mensagem: 'Probe OK mas Candidate incompleto',
            ip,
            porta
          }
        };
      }

      return { candidate };
    } finally {
      // Garante fechamento — nunca reconnect, nunca socket órfão
      if (conectou || transport.isConnected?.() || transport._socket) {
        try {
          await transport.desconectar();
        } catch (_) {
          try {
            if (transport._socket && !transport._socket.destroyed) {
              transport._socket.destroy();
            }
          } catch (__) { /* ignore */ }
        }
      }
    }
  }

  /**
   * @param {*} resposta
   * @returns {Buffer}
   * @private
   */
  _extrairBuffer(resposta) {
    try {
      if (!resposta) return Buffer.alloc(0);
      if (Buffer.isBuffer(resposta.dados)) return resposta.dados;
      if (Buffer.isBuffer(resposta)) return resposta;
      if (resposta.dados != null) return Buffer.from(resposta.dados);
      return Buffer.alloc(0);
    } catch (_) {
      return Buffer.alloc(0);
    }
  }

  obterUltimaVarredura() {
    return this.ultimaVarredura;
  }
}

module.exports = ToledoPrix4Discovery;
module.exports.CAPACIDADES_TOLEDO = CAPACIDADES_TOLEDO;
