'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

const REAL_DB_DIR = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados');
const DB_MODULE_PATH = require.resolve('../../backend/database.js');

function resetDatabaseModule() {
  delete require.cache[DB_MODULE_PATH];
}

describe('segurança do banco em testes', () => {
  it('não usa o banco real quando o processo está em modo de teste sem DB_DIR explícito', () => {
    const previousDbDir = process.env.DB_DIR;
    const previousFlag = process.env.CDS_TEST_ISOLAR_BANCO;
    const previousArgv = process.argv.slice();

    try {
      delete process.env.DB_DIR;
      delete process.env.CDS_TEST_ISOLAR_BANCO;
      process.argv = [...previousArgv.slice(0, 2), '--test', 'tests/seguranca/banco-real-isolado.test.js'];

      resetDatabaseModule();
      const db = require('../../backend/database.js');

      assert.notEqual(path.resolve(db.dbDir), path.resolve(REAL_DB_DIR));
      assert.ok(path.resolve(db.dbDir).startsWith(path.resolve(os.tmpdir())));
    } finally {
      process.argv = previousArgv;
      if (previousDbDir === undefined) delete process.env.DB_DIR; else process.env.DB_DIR = previousDbDir;
      if (previousFlag === undefined) delete process.env.CDS_TEST_ISOLAR_BANCO; else process.env.CDS_TEST_ISOLAR_BANCO = previousFlag;
      resetDatabaseModule();
    }
  });
});
