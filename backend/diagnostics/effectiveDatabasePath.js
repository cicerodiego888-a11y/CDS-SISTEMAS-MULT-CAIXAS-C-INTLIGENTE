'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function recordEffectiveDatabasePath({
  databasePath,
  processId = process.pid,
  executablePath = process.execPath,
  outputDirectory = os.tmpdir(),
  now = () => new Date()
} = {}) {
  if (!databasePath) {
    throw new Error('databasePath é obrigatório para registrar evidência do SQLite.');
  }

  const outputPath = path.join(outputDirectory, `cds-effective-database-${processId}.json`);
  const evidence = {
    evidenceType: 'sqlite_open_callback_success',
    recordedAt: now().toISOString(),
    processId,
    executablePath,
    effectiveDatabasePath: path.resolve(databasePath)
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx'
  });

  return { outputPath, evidence };
}

module.exports = { recordEffectiveDatabasePath };
