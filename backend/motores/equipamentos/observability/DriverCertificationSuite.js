/**
 * Sprint 15.8 — DriverCertificationSuite
 * Executa bateria padronizada contra profile SDK (+ evidências opcionais).
 */

'use strict';

const { avaliarItens } = require('./DriverCertification');

async function _evidenciasDoProfile(driverId, evidenciasExtra = {}) {
  const evidencias = { ...evidenciasExtra };

  try {
    const sdk = require('../sdk');
    sdk.ensureLoaded();
    const profile = sdk.registry.buscar(driverId);
    if (profile) {
      evidencias.sdk = { ok: true, note: `profile ${profile.id} v${profile.versao}` };
      evidencias.discovery = profile.temCapability('discovery')
        ? { ok: true, note: `ports=${(profile.discovery?.ports || []).join(',')}` }
        : { ok: false, note: 'capability discovery ausente' };
      evidencias.connection = profile.temCapability('connection')
        ? true
        : { ok: false, note: 'capability connection ausente' };
      evidencias.identification = profile.temCapability('identification') ? true : false;
      evidencias.diagnostics = profile.temCapability('diagnostics') ? true : false;
      evidencias.synchronization = profile.temCapability('synchronization') ? true : false;
      evidencias.scheduler = profile.temCapability('scheduler') ? true : { ok: false, note: 'opcional' };
      evidencias.telemetry = profile.temCapability('telemetry') ? true : { ok: false, note: 'opcional' };
      evidencias.rollback = profile.temCapability('rollback') ? true : { ok: false, note: 'opcional' };
      evidencias.protocol = profile.protocolo
        ? { ok: true, note: profile.protocolo }
        : { ok: false, note: 'protocolo não declarado' };

      if (profile.validacao && profile.validacao.valido === false) {
        evidencias.sdk = { ok: false, note: (profile.validacao.erros || []).join('; ') };
      }
    } else {
      evidencias.sdk = { ok: false, note: `driver ${driverId} não encontrado no SDK` };
    }
  } catch (err) {
    evidencias.sdk = { ok: false, note: err.message };
  }

  // Integrações soft com monitor/orquestrador
  try {
    const orch = require('../orchestrator');
    if (orch.getOrchestrator) {
      const dash = orch.getOrchestrator().dashboard();
      evidencias.scheduler = evidencias.scheduler === true || evidencias.scheduler?.ok
        ? evidencias.scheduler
        : { ok: true, note: 'orchestrator disponível' };
      if (dash) {
        evidencias.telemetry = evidencias.telemetry === true || evidencias.telemetry?.ok
          ? evidencias.telemetry
          : { ok: true, note: 'métricas orquestrador' };
      }
    }
  } catch {
    /* ignore */
  }

  return evidencias;
}

class DriverCertificationSuite {
  /**
   * @param {Object} opcoes
   * @param {string} opcoes.driverId
   * @param {Object} [opcoes.evidencias]
   * @param {string} [opcoes.firmware]
   * @param {string} [opcoes.executadoPor]
   */
  async executar(opcoes = {}) {
    const t0 = Date.now();
    const driverId = String(opcoes.driverId || 'toledo-prix4');
    const evidencias = await _evidenciasDoProfile(driverId, opcoes.evidencias || {});
    const avaliacao = avaliarItens(evidencias);

    let driverVersao = null;
    let fabricante = null;
    let modelo = null;
    try {
      const sdk = require('../sdk');
      sdk.ensureLoaded();
      const p = sdk.registry.buscar(driverId);
      if (p) {
        driverVersao = p.versao;
        fabricante = p.fabricante;
        modelo = p.modelo;
      }
    } catch { /* ignore */ }

    const tempoMs = Date.now() - t0;
    return {
      driverId,
      driverVersao,
      fabricante,
      modelo,
      firmware: opcoes.firmware || null,
      evidencias,
      checklist: avaliacao.itens,
      resumo: avaliacao.resumo,
      nota: avaliacao.resumo.nota,
      resultado: avaliacao.resumo.resultado,
      falhas: avaliacao.itens.filter((i) => i.status === 'FAIL'),
      tempoMs,
      executadoPor: opcoes.executadoPor || 'sistema',
      executadoEm: new Date().toISOString()
    };
  }

  async executarTodos(opcoes = {}) {
    const sdk = require('../sdk');
    sdk.ensureLoaded();
    const drivers = sdk.registry.listar();
    const resultados = [];
    for (const d of drivers) {
      resultados.push(await this.executar({
        ...opcoes,
        driverId: d.id
      }));
    }
    return {
      total: resultados.length,
      resultados,
      geradoEm: new Date().toISOString()
    };
  }
}

const suite = new DriverCertificationSuite();

module.exports = suite;
module.exports.DriverCertificationSuite = DriverCertificationSuite;
