'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { recordEffectiveDatabasePath } = require('../../backend/diagnostics/effectiveDatabasePath');
const { resolverCaminhoBanco } = require('../../backend/diagnostics/databasePath');

test('registra apenas evidência de abertura SQLite, sem ler conteúdo do banco', (t) => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-db-path-evidence-'));
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));

  const databasePath = path.join(outputDirectory, 'db', 'actual.db');
  const recordedAt = new Date('2026-10-19T16:00:00.000-03:00');
  const resultado = recordEffectiveDatabasePath({
    databasePath,
    processId: 456,
    executablePath: 'C:\\Program Files\\CDS ERP\\CDS ERP.exe',
    outputDirectory,
    now: () => recordedAt
  });
  const evidence = JSON.parse(fs.readFileSync(resultado.outputPath, 'utf8'));

  assert.equal(evidence.evidenceType, 'sqlite_open_callback_success');
  assert.equal(evidence.recordedAt, recordedAt.toISOString());
  assert.equal(evidence.processId, 456);
  assert.equal(evidence.executablePath, 'C:\\Program Files\\CDS ERP\\CDS ERP.exe');
  assert.equal(evidence.effectiveDatabasePath, path.resolve(databasePath));
  assert.deepEqual(Object.keys(evidence).sort(), [
    'effectiveDatabasePath',
    'evidenceType',
    'executablePath',
    'processId',
    'recordedAt'
  ]);
});

test('recusa evidência sem caminho do banco', () => {
  assert.throws(
    () => recordEffectiveDatabasePath({ databasePath: '' }),
    /databasePath é obrigatório/
  );
});

test('preserva evidência pré-existente do mesmo PID', (t) => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-db-path-existing-'));
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));

  const outputPath = path.join(outputDirectory, 'cds-effective-database-456.json');
  fs.writeFileSync(outputPath, '{"existing":true}\n');

  assert.throws(
    () => recordEffectiveDatabasePath({
      databasePath: 'C:\\ProgramData\\MercantilFiscal\\dados\\mercadao.db',
      processId: 456,
      outputDirectory
    }),
    { code: 'EEXIST' }
  );
  assert.equal(fs.readFileSync(outputPath, 'utf8'), '{"existing":true}\n');
});

test('usa DB_DIR explícito antes do diretório padrão', () => {
  assert.equal(
    resolverCaminhoBanco({
      env: { DB_DIR: 'C:\\ProgramData\\MercantilFiscal\\dados', PROGRAMDATA: 'D:\\dados' }
    }),
    path.join('C:\\ProgramData\\MercantilFiscal\\dados', 'mercadao.db')
  );
});

test('usa diretório padrão apenas quando DB_DIR não foi definido', () => {
  assert.equal(
    resolverCaminhoBanco({ env: { PROGRAMDATA: 'D:\\ProgramData' } }),
    path.join('D:\\ProgramData', 'MercantilFiscal', 'dados', 'mercadao.db')
  );
});
