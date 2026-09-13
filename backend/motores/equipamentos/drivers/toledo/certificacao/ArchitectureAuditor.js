/**
 * Sprint 14.12 — Auditoria arquitetural dos módulos 14.x
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../');

const MODULOS = Object.freeze([
  {
    id: 'discovery',
    nome: 'Discovery Engine',
    paths: ['discovery/DiscoveryEngineV1.js', 'discovery/DiscoveryController.js']
  },
  {
    id: 'fingerprint',
    nome: 'Fingerprint Engine',
    paths: ['fingerprint/FingerprintService.js', 'fingerprint/FingerprintController.js']
  },
  {
    id: 'connection',
    nome: 'Connection Manager',
    paths: ['connection/ConnectionManager.js', 'connection/TcpConnection.js', 'connection/ConnectionPool.js']
  },
  {
    id: 'driver',
    nome: 'Driver Toledo',
    paths: [
      'drivers/toledo/ToledoPrixIVDriver.js',
      'drivers/toledo/ToledoProtocol.js',
      'drivers/toledo/ToledoFrameBuilder.js',
      'drivers/toledo/ToledoFrameParser.js'
    ]
  },
  {
    id: 'lab',
    nome: 'Laboratório',
    paths: ['laboratorio/EngineeringLab.js', 'laboratorio/CaptureRoutes.js', 'laboratorio/FrameCapture.js']
  },
  {
    id: 'operations',
    nome: 'Operation Engine',
    paths: [
      'drivers/toledo/operations/ToledoOperationEngine.js',
      'drivers/toledo/operations/OperationQueue.js'
    ]
  },
  {
    id: 'plu',
    nome: 'PLU Engine',
    paths: ['drivers/toledo/plu/ToledoPluEngine.js', 'drivers/toledo/plu/UploadPluOperation.js']
  },
  {
    id: 'sync',
    nome: 'Sync Engine',
    paths: [
      'drivers/toledo/sync/ToledoSyncEngine.js',
      'drivers/toledo/sync/ToledoDownloadEngine.js',
      'drivers/toledo/sync/ToledoSyncComparator.js'
    ]
  },
  {
    id: 'weight',
    nome: 'Weight Engine',
    paths: ['drivers/toledo/weight/ToledoWeightEngine.js', 'drivers/toledo/weight/ToledoWeightOperation.js']
  },
  {
    id: 'monitor',
    nome: 'Monitor',
    paths: ['monitor/EquipmentMonitor.js', 'monitor/MonitorScheduler.js', 'monitor/MonitorRoutes.js']
  },
  {
    id: 'configuration',
    nome: 'Configuration Engine',
    paths: [
      'drivers/toledo/configuration/ToledoConfigurationEngine.js',
      'drivers/toledo/configuration/ToledoConfigurationProfile.js'
    ]
  }
]);

function existe(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

/**
 * Verifica se arquivos críticos não importam net/TcpConnection direto
 * (exceto Connection Manager, Discovery e Fingerprint — camadas de varredura).
 */
function auditarAcessoTcp(filePath) {
  if (!fs.existsSync(filePath)) return { ok: true, skipped: true };
  const normalized = filePath.replace(/\\/g, '/');
  const base = path.basename(filePath);

  const permitido = base === 'TcpConnection.js'
    || base === 'ConnectionManager.js'
    || base === 'ConnectionFactory.js'
    || normalized.includes('/connection/')
    || normalized.includes('/discovery/')
    || normalized.includes('/fingerprint/');

  if (permitido) {
    return { ok: true, allowed: true };
  }

  const src = fs.readFileSync(filePath, 'utf8');
  const usaNet = /\brequire\(['"]net['"]\)/.test(src);
  if (usaNet) {
    return { ok: false, reason: 'require(net) fora das camadas Connection/Discovery/Fingerprint' };
  }
  return { ok: true };
}

function auditArchitecture() {
  const resultados = [];
  let ok = 0;
  let fail = 0;

  for (const mod of MODULOS) {
    const missing = mod.paths.filter((p) => !existe(p));
    const tcpChecks = mod.paths
      .filter((p) => existe(p))
      .map((p) => ({ path: p, ...auditarAcessoTcp(path.join(ROOT, p)) }));
    const tcpFail = tcpChecks.filter((c) => c.ok === false);
    const passed = missing.length === 0 && tcpFail.length === 0;
    if (passed) ok += 1;
    else fail += 1;
    resultados.push({
      id: mod.id,
      nome: mod.nome,
      present: missing.length === 0,
      missing,
      tcpOk: tcpFail.length === 0,
      tcpIssues: tcpFail,
      status: passed ? 'OK' : 'FAIL'
    });
  }

  return {
    success: fail === 0,
    total: MODULOS.length,
    ok,
    fail,
    resultados,
    auditedAt: new Date().toISOString()
  };
}

module.exports = {
  MODULOS,
  auditArchitecture,
  auditarAcessoTcp
};
