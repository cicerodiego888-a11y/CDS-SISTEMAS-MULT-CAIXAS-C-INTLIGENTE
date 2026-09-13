const express = require('express');
const router = express.Router();
const equipamentosController = require('../controllers/equipamentosController');
const DiscoveryController = require('../motores/equipamentos/discovery/DiscoveryController');
const FingerprintController = require('../motores/equipamentos/fingerprint/FingerprintController');
const ConnectionRoutes = require('../motores/equipamentos/connection/ConnectionRoutes');

router.get('/resumo', equipamentosController.resumo);
// Sprint 15.7 — Device Profile SDK (lista + categories / :id / reload)
router.get('/drivers', require('../motores/equipamentos/sdk/DriverSdkController').listar);
router.use(require('../motores/equipamentos/sdk/DriverSdkRoutes')());
router.post('/discovery', equipamentosController.discovery);
router.post('/discovery/cancel', equipamentosController.discoveryCancelar);
router.get('/discovery/sessoes', equipamentosController.discoverySessoes);
router.get('/discovery/descobertos', DiscoveryController.listarDescobertos);
router.post('/discovery/scan', DiscoveryController.discovery);
// Sprint 15.0 — Discovery Ethernet (auto-detecção TCP/IP)
router.get('/discovery/ethernet', DiscoveryController.discoveryEthernet);
router.post('/discovery/ethernet', DiscoveryController.discoveryEthernet);
router.get('/discovery/interfaces', DiscoveryController.listarInterfaces);
router.post('/discovery/all', DiscoveryController.discoveryAll);
// Sprint 14.2 — Fingerprint Engine V1.0 (antes de /:id)
router.post('/fingerprint', FingerprintController.fingerprint);
router.get('/fingerprint/identificados', FingerprintController.listarIdentificados);
// Sprint 14.3 — Connection Manager V1.0
router.use(ConnectionRoutes());
// Sprint 14.4 — Driver Toledo Prix IV Uno V1.0
const ToledoDriverController = require('../motores/equipamentos/drivers/toledo/ToledoDriverController');
router.post('/driver/toledo/connect', ToledoDriverController.connect);
router.get('/driver/toledo/capabilities', ToledoDriverController.capabilities);
router.post('/driver/toledo/disconnect', ToledoDriverController.disconnect);
router.post('/driver/toledo/reconnect', ToledoDriverController.reconnect);
// Sprint 14.12 — Certificação / Diagnóstico V2.0
const DiagnosticsController = require('../motores/equipamentos/drivers/toledo/certificacao/DiagnosticsController');
router.get('/driver/toledo/health', DiagnosticsController.health);
router.get('/driver/toledo/diagnostics', DiagnosticsController.diagnostics);
router.get('/driver/toledo/version', DiagnosticsController.version);
router.get('/driver/toledo/certification', DiagnosticsController.certification);
router.get('/driver/toledo/architecture', DiagnosticsController.architecture);
// Sprint 14.5 — Engineering Lab V2.0
router.use(require('../motores/equipamentos/laboratorio/CaptureRoutes')());
// Sprint 14.6 — Motor de Operações Toledo V1.0
const OperationController = require('../motores/equipamentos/drivers/toledo/operations/OperationController');
router.post('/operations/ping', OperationController.ping);
router.post('/operations/identify', OperationController.identify);
router.post('/operations/handshake', OperationController.handshake);
router.get('/operations/history', OperationController.history);
router.get('/operations/status', OperationController.status);
router.post('/operations/cancel', OperationController.cancel);
// Sprint 15.2 — Motor Protocolo Toledo 90AX
const ProtocolController = require('../motores/equipamentos/drivers/toledo/protocol/ProtocolController');
router.post('/:id/protocol/identify', ProtocolController.identify);
router.post('/:id/protocol/status', ProtocolController.status);
router.post('/:id/protocol/ping', ProtocolController.ping);
router.post('/:id/protocol/raw', ProtocolController.raw);
router.get('/:id/protocol/history', ProtocolController.history);
router.post('/protocol/identify', ProtocolController.identify);
router.post('/protocol/status', ProtocolController.status);
router.post('/protocol/ping', ProtocolController.ping);
router.post('/protocol/raw', ProtocolController.raw);
router.get('/protocol/history', ProtocolController.history);
router.get('/protocol/engine', ProtocolController.engineStatus);
// Sprint 14.7 — Motor de PLUs Toledo V1.0
const PluController = require('../motores/equipamentos/drivers/toledo/plu/PluController');
router.post('/plu/upload', PluController.upload);
router.post('/plu/upload-many', PluController.uploadMany);
router.get('/plu/history', PluController.history);
router.get('/plu/ultima-sync', PluController.ultimaSync);
router.get('/plu/sync-log', PluController.syncLogHistorico);
router.get('/plu/status', PluController.status);
router.post('/plu/cancel', PluController.cancel);
router.post('/plu/retry', PluController.retry);
// Sprint 14.8 — Motor de Sincronização de PLUs V1.0
const SyncController = require('../motores/equipamentos/drivers/toledo/sync/SyncController');
router.post('/plu/download', SyncController.download);
router.post('/plu/compare', SyncController.compare);
router.post('/plu/sync', SyncController.sync);
router.get('/plu/sync/history', SyncController.history);
router.get('/plu/sync/status', SyncController.status);
router.post('/plu/sync/cancel', SyncController.cancel);
router.get('/plu/sync/:id', SyncController.getById);

// RC15.1 — Envio simples de produtos (PLUs) para balança
router.post('/:id/upload-plus', PluController.uploadPlus);
// RC15.3 — Envio individual de um produto do cadastro
router.post('/:id/upload-produto', PluController.uploadProduto);

// Sprint 15.4 — Sync oficial 90AX
router.post('/:id/sync', SyncController.syncV15);
router.post('/:id/sync/full', SyncController.syncFull);
router.post('/:id/sync/incremental', SyncController.syncIncremental);
router.post('/:id/sync/cancel', SyncController.syncCancel);
router.get('/:id/sync/status', SyncController.syncStatus);
router.get('/:id/sync/history', SyncController.syncHistory);
router.get('/:id/sync/report', SyncController.syncReport);
router.get('/:id/sync/versions', SyncController.syncVersions);
router.get('/:id/sync/version/:version', SyncController.syncVersion);
router.get('/:id/sync/delta', SyncController.syncDelta);
router.post('/:id/sync/delta', SyncController.syncDeltaExec);
router.post('/:id/sync/rollback', SyncController.syncRollback);
router.get('/:id/sync/audit', SyncController.syncAudit);
router.get('/:id/sync/compare', SyncController.syncCompareVersions);
router.post('/sync', SyncController.syncV15);
router.post('/sync/full', SyncController.syncFull);
router.post('/sync/incremental', SyncController.syncIncremental);
router.post('/sync/cancel', SyncController.syncCancel);
router.get('/sync/status', SyncController.syncStatus);
router.get('/sync/history', SyncController.syncHistory);
router.get('/sync/report', SyncController.syncReport);
router.get('/sync/versions', SyncController.syncVersions);
router.get('/sync/version/:version', SyncController.syncVersion);
router.get('/sync/delta', SyncController.syncDelta);
router.post('/sync/delta', SyncController.syncDeltaExec);
router.post('/sync/rollback', SyncController.syncRollback);
router.get('/sync/audit', SyncController.syncAudit);
router.get('/sync/compare', SyncController.syncCompareVersions);
// Sprint 14.9 — Motor de Pesagem Toledo V1.0
const WeightController = require('../motores/equipamentos/drivers/toledo/weight/WeightController');
router.post('/weight/read', WeightController.read);
router.get('/weight/status', WeightController.status);
router.get('/weight/history', WeightController.history);
router.post('/weight/cancel', WeightController.cancel);
// Sprint 14.10 — Monitor de Equipamentos V1.0
router.use(require('../motores/equipamentos/monitor/MonitorRoutes')());
// Sprint 15.8 — Observabilidade / Telemetria / Certificação
router.use(require('../motores/equipamentos/observability/ObservabilityRoutes')());
// Sprint 15.6 — Central de Orquestração de Balanças
router.use(require('../motores/equipamentos/orchestrator/OrchestratorRoutes')());
// Sprint 14.11 — Configuration Engine Toledo V1.0
const ConfigurationController = require('../motores/equipamentos/drivers/toledo/configuration/ConfigurationController');
router.post('/config/read', ConfigurationController.read);
router.post('/config/write', ConfigurationController.write);
router.post('/config/compare', ConfigurationController.compare);
router.post('/config/restore', ConfigurationController.restore);
router.get('/config/history', ConfigurationController.history);
router.get('/config/status', ConfigurationController.status);
router.get('/config/profiles', ConfigurationController.profiles);
router.post('/config/export', ConfigurationController.exportProfile);
router.post('/config/import', ConfigurationController.importProfile);
router.get('/identidades', equipamentosController.listarIdentidades);
router.get('/identidades/:id', equipamentosController.buscarIdentidade);
router.post('/testar', equipamentosController.testar);
router.post('/diagnostico', equipamentosController.diagnostico);

router.get('/layouts/presets', equipamentosController.listarPresetsLayout);
router.get('/layouts/ativo', equipamentosController.obterLayoutAtivo);
router.put('/layouts/ativo', equipamentosController.definirLayoutAtivo);
router.post('/layouts/testar', equipamentosController.testarParseLayout);
router.post('/etiquetas/interpretar', equipamentosController.interpretarEtiqueta);

// Sprint 14.15.1 — Bridge compatibilidade MGV6 (exportação legada; paralelo ao TCP 90AX)
router.use('/mgv6', require('../motores/equipamentos/mgv6/MGV6Routes')());

router.get('/', equipamentosController.listar);
router.post('/', equipamentosController.criar);

router.get('/:id/layout', equipamentosController.obterLayoutEquipamento);
router.put('/:id/layout', equipamentosController.salvarLayoutEquipamento);
router.get('/:id/conexao', equipamentosController.conexao);
router.get('/:id/logs', equipamentosController.logs);
router.get('/:id/diagnostico', equipamentosController.diagnostico);
router.post('/:id/testar', equipamentosController.testar);
router.post('/:id/duplicar', equipamentosController.duplicar);
router.post('/:id/ativar', equipamentosController.ativar);
router.post('/:id/desativar', equipamentosController.desativar);

router.get('/:id', equipamentosController.buscarPorId);
router.put('/:id', equipamentosController.editar);
router.delete('/:id', equipamentosController.remover);

module.exports = router;
