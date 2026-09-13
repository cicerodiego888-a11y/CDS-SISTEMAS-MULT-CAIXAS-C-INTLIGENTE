/**
 * Sprint 15.0 — CandidateBuilder
 * Transforma resultado de probe Ethernet em candidato padronizado.
 */

'use strict';

const { tentarCriarCandidate, normalizarCapacidades } = require('./CandidateDTO');

const CAPACIDADES_ETHERNET = normalizarCapacidades({
  discovery: true,
  configuracao: true,
  diagnostico: true,
  sincronizacao: true,
  monitoramento: true
});

class CandidateBuilder {
  /**
   * @param {object} probeResult — retorno de ProbeExecutor.executar
   * @param {object} [extras]
   * @returns {object|null} candidato API Sprint 15 + CandidateDTO compatível
   */
  construir(probeResult = {}, extras = {}) {
    if (!probeResult || probeResult.sucesso !== true) return null;

    const host = String(probeResult.endpoint?.host || extras.host || '');
    const porta = Number(probeResult.endpoint?.porta || extras.porta || 0);
    const identidade = probeResult.identidade || {};
    const driver = String(
      identidade.driver
      || probeResult.driver
      || extras.driver
      || 'DESCONHECIDO'
    );
    const fabricante = identidade.fabricante || extras.fabricante || null;
    const modelo = identidade.modelo || extras.modelo || null;
    let confianca = Number(
      identidade.confianca != null
        ? identidade.confianca
        : (probeResult.confianca != null ? probeResult.confianca : 0.5)
    );
    // Aceita 0–1 ou 0–100
    if (confianca > 1) confianca = confianca / 100;
    confianca = Math.max(0, Math.min(1, confianca));
    const confiancaPct = Math.round(confianca * 100);

    const dto = tentarCriarCandidate({
      transporte: 'ethernet',
      ip: host,
      porta,
      driver_codigo: driver,
      confianca,
      origem: `ethernet-discovery:${driver}`,
      fabricante,
      modelo,
      protocolo: identidade.protocolo || extras.protocolo || null,
      firmware: identidade.versao || identidade.firmware || null,
      evidencias: {
        probe: true,
        handshake: Boolean(probeResult.registro?.resultado === 'OK'),
        latencia: probeResult.latencia,
        ...(identidade.evidencias || {})
      },
      observacoes: `Ethernet ${host}:${porta}`,
      capacidades: CAPACIDADES_ETHERNET
    });

    const sprint = {
      transporte: 'ethernet',
      endpoint: `${host}:${porta}`,
      driver,
      fabricante,
      modelo,
      confiança: confiancaPct,
      confianca: confiancaPct,
      ip: host,
      porta,
      latencia: probeResult.latencia != null ? probeResult.latencia : null,
      identidade: {
        versao: identidade.versao || identidade.firmware || null,
        ip: host,
        ...(identidade.extra || {})
      },
      timeout: extras.timeout || identidade.timeout || null,
      candidate_dto: dto || null
    };

    return sprint;
  }

  /**
   * Candidato fraco quando TCP abre mas probe não identifica driver.
   */
  construirTcpAberto(endpoint = {}, extras = {}) {
    const host = String(endpoint.host || '');
    const porta = Number(endpoint.porta) || 0;
    if (!host || !porta) return null;

    return {
      transporte: 'ethernet',
      endpoint: `${host}:${porta}`,
      driver: extras.driver || null,
      fabricante: null,
      modelo: null,
      confiança: 30,
      confianca: 30,
      ip: host,
      porta,
      latencia: endpoint.latencia != null ? endpoint.latencia : null,
      identidade: { versao: null, ip: host },
      timeout: extras.timeout || null,
      candidate_dto: tentarCriarCandidate({
        transporte: 'ethernet',
        ip: host,
        porta,
        driver_codigo: extras.driver || 'GENERIC_ETHERNET',
        confianca: 0.3,
        origem: 'ethernet-discovery:tcp-open',
        observacoes: 'Porta TCP aberta — driver não confirmado',
        capacidades: CAPACIDADES_ETHERNET
      })
    };
  }
}

module.exports = CandidateBuilder;
module.exports.CandidateBuilder = CandidateBuilder;
module.exports.CAPACIDADES_ETHERNET = CAPACIDADES_ETHERNET;
