/**
 * Sprint 14.8 / 15.4 / 15.5 — Motor de Sincronização Toledo
 */

'use strict';

const toledoSyncEngine = require('./ToledoSyncEngine');
const toledoSyncService = require('./ToledoSyncService');
const ToledoDownloadEngine = require('./ToledoDownloadEngine');
const ToledoSyncComparator = require('./ToledoSyncComparator');
const ToledoSyncPlanner = require('./ToledoSyncPlanner');
const ToledoSyncExecutor = require('./ToledoSyncExecutor');
const ToledoSyncRepository = require('./ToledoSyncRepository');
const ToledoSyncReport = require('./ToledoSyncReport');
const ToledoSyncErrors = require('./ToledoSyncErrors');
const ToledoDownloadParser = require('./ToledoDownloadParser');
const DownloadPluOperation = require('./DownloadPluOperation');
const SyncController = require('./SyncController');
const ToledoBatchBuilder = require('./ToledoBatchBuilder');
const ToledoRetryPolicy = require('./ToledoRetryPolicy');
const ToledoSyncProgress = require('./ToledoSyncProgress');
const ToledoSyncValidator = require('./ToledoSyncValidator');
const ToledoSyncHistory = require('./ToledoSyncHistory');
const ToledoDeltaRepository = require('./ToledoDeltaRepository');
const ToledoSnapshotService = require('./ToledoSnapshotService');
const ToledoDeltaEngine = require('./ToledoDeltaEngine');
const ToledoVersionManager = require('./ToledoVersionManager');
const ToledoLoadManager = require('./ToledoLoadManager');
const ToledoConflictResolver = require('./ToledoConflictResolver');
const ToledoSyncAudit = require('./ToledoSyncAudit');
const ToledoRollbackService = require('./ToledoRollbackService');
const ToledoChangeDetector = require('./ToledoChangeDetector');

module.exports = {
  toledoSyncEngine,
  ToledoSyncEngine: toledoSyncEngine.ToledoSyncEngine,
  toledoSyncService,
  ToledoSyncService: toledoSyncService.ToledoSyncService,
  createSyncService: toledoSyncService.createSyncService,
  ToledoDownloadEngine,
  ToledoSyncComparator,
  ToledoSyncPlanner,
  ToledoSyncExecutor,
  ToledoSyncRepository,
  ToledoSyncReport,
  ToledoSyncErrors,
  ToledoDownloadParser,
  DownloadPluOperation,
  SyncController,
  ToledoBatchBuilder,
  ToledoRetryPolicy,
  ToledoSyncProgress,
  ToledoSyncValidator,
  ToledoSyncHistory,
  ToledoDeltaRepository,
  ToledoSnapshotService,
  ToledoDeltaEngine,
  ToledoVersionManager,
  ToledoLoadManager,
  ToledoConflictResolver,
  ToledoSyncAudit,
  ToledoRollbackService,
  ToledoChangeDetector
};
