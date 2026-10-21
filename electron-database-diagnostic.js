'use strict';

const { app } = require('electron');
const sqlite3 = require('sqlite3').verbose();
const { resolverCaminhoBanco } = require('./backend/diagnostics/databasePath');
const { recordEffectiveDatabasePath } = require('./backend/diagnostics/effectiveDatabasePath');

const databasePath = resolverCaminhoBanco({ env: process.env });

function encerrar(exitCode) {
  process.exitCode = exitCode;
  app.quit();
}

if (process.env.CDS_DATABASE_PATH_DIAGNOSTIC !== '1') {
  console.error(JSON.stringify({
    status: 'BLOCKED_WITH_FINDINGS',
    reason: 'CDS_DATABASE_PATH_DIAGNOSTIC=1 is required.'
  }));
  app.whenReady().then(() => encerrar(2));
}

function registrarFalha(stage, error) {
  console.error(JSON.stringify({
    status: 'BLOCKED_WITH_FINDINGS',
    stage,
    processId: process.pid,
    executablePath: process.execPath,
    errorCode: error && error.code ? error.code : null
  }));
  encerrar(1);
}

if (process.env.CDS_DATABASE_PATH_DIAGNOSTIC === '1') {
  app.whenReady().then(() => {
  const database = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, (openError) => {
    if (openError) {
      registrarFalha('sqlite_open', openError);
      return;
    }

    let evidence;
    try {
      evidence = recordEffectiveDatabasePath({ databasePath });
    } catch (recordError) {
      database.close(() => registrarFalha('evidence_write', recordError));
      return;
    }

    database.close((closeError) => {
      if (closeError) {
        registrarFalha('sqlite_close', closeError);
        return;
      }

      console.log(JSON.stringify({
        status: 'DATABASE_PATH_PROVEN',
        evidence: evidence.evidence,
        evidenceFile: evidence.outputPath,
        readOnly: true,
        rowsRead: false
      }));
      encerrar(0);
    });
  });
  }).catch((error) => registrarFalha('electron_ready', error));
}
