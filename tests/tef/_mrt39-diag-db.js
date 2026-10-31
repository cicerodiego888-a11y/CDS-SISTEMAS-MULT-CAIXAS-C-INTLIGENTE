'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.CDS_TEST_ISOLAR_BANCO = '1';
process.env.DB_DIR = path.join(os.tmpdir(), 'cds-sistemas-test-db');
delete process.env.DESTAXA_REAL_TRANSACTION_ENABLED;

const db = require('../../backend/database');

function whenReady() {
  return new Promise((resolve, reject) => {
    if (typeof db.whenReady === 'function') {
      db.whenReady((err) => (err ? reject(err) : resolve()));
    } else {
      setTimeout(resolve, 2000);
    }
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

(async () => {
  await whenReady();
  const tables = await all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tef%' ORDER BY name"
  );
  const cols = await all('PRAGMA table_info(tef_transacoes)');
  const prod = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados', 'mercadao.db');
  const efetivo = path.join(db.dbDir || process.env.DB_DIR, 'mercadao.db');
  const diag = {
    dbDir: db.dbDir,
    dbPathEfetivo: efetivo,
    existe: fs.existsSync(efetivo),
    ehTempCdsTestDb: String(efetivo).includes('cds-sistemas-test-db'),
    ehProgramDataProducao: String(efetivo).includes('MercantilFiscal'),
    caminhoProducaoDistinto: path.resolve(efetivo) !== path.resolve(prod),
    tables: tables.map((t) => t.name),
    cols: cols.map((c) => c.name),
    gateEnv: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || ''
  };
  console.log(JSON.stringify(diag, null, 2));
  if (!diag.ehTempCdsTestDb || diag.ehProgramDataProducao || !diag.caminhoProducaoDistinto) {
    console.error('BLOQUEADO: banco efetivo não comprovado como teste');
    process.exit(2);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
