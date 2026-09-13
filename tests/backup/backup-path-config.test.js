/**
 * Sprint backup path — seletor Sync, validação, persistência e falha segura.
 * Executar: node --test tests/backup/backup-path-config.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const {
  interpretarRetornoShowOpenDialogSync
} = require('../../backend/services/electronDialogoService');
const {
  fazerBackupManual,
  garantirPastaBackupGravavel,
  obterPastaBackupPadrao
} = require('../../backend/services/backupManual');
const { executarImportacao } = require('../../backend/services/importacao-inicial-produtos/importer');
const { STATUS } = require('../../backend/services/importacao-inicial-produtos/helpers');

function openDb(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('Backup path / seletor / persistência', () => {
  it('TESTE 1 — seleção válida (interpretação Sync) retorna sucesso + caminho', () => {
    const pasta = 'C:\\ProgramData\\MercantilFiscal\\dados\\backups';
    const r = interpretarRetornoShowOpenDialogSync([pasta]);
    assert.equal(r.sucesso, true);
    assert.equal(r.caminho, pasta);
    assert.equal(r.cancelado, undefined);
  });

  it('TESTE 2 — cancelamento (array vazio / undefined) retorna cancelado', () => {
    assert.deepEqual(interpretarRetornoShowOpenDialogSync(undefined), {
      sucesso: false,
      cancelado: true
    });
    assert.deepEqual(interpretarRetornoShowOpenDialogSync([]), {
      sucesso: false,
      cancelado: true
    });
    // Regressão: objeto async NÃO deve passar como seleção Sync
    const r = interpretarRetornoShowOpenDialogSync({
      canceled: false,
      filePaths: ['C:\\x']
    });
    assert.equal(r.sucesso, false);
    assert.equal(r.cancelado, true);
  });

  it('TESTE 3 — persiste backup_path e relê o valor exato', async () => {
    const dir = mkTmpDir('cds-backup-cfg-');
    const dbFile = path.join(dir, 't.db');
    const pastaAlvo = path.join(dir, 'backups-alvo');
    fs.mkdirSync(pastaAlvo, { recursive: true });

    const db = await openDb(dbFile);
    await run(db, `
      CREATE TABLE configuracoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chave VARCHAR(100) UNIQUE NOT NULL,
        valor TEXT,
        tipo VARCHAR(50),
        descricao TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const validacao = garantirPastaBackupGravavel(pastaAlvo);
    assert.equal(validacao.sucesso, true);

    await run(
      db,
      `INSERT INTO configuracoes (chave, valor, tipo, descricao)
       VALUES ('backup_path', ?, 'text', 'teste')
       ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
      [validacao.caminho]
    );

    const row = await get(db, `SELECT valor FROM configuracoes WHERE chave = 'backup_path'`);
    assert.equal(path.resolve(row.valor), path.resolve(pastaAlvo));
    await new Promise((resolve) => db.close(resolve));
  });

  it('TESTE 4 — backup usa pasta configurada (não path teste 2)', () => {
    const dir = mkTmpDir('cds-backup-run-');
    const dbFile = path.join(dir, 'mercadao.db');
    const pastaOk = path.join(dir, 'backups-ok');
    fs.writeFileSync(dbFile, 'SQLITE-FAKE');
    fs.mkdirSync(pastaOk, { recursive: true });

    const r = fazerBackupManual(dbFile, pastaOk);
    assert.equal(r.sucesso, true);
    assert.ok(fs.existsSync(r.caminho));
    assert.ok(r.caminho.startsWith(pastaOk));
    assert.ok(!String(r.caminho).includes('teste 2'));
  });

  it('TESTE 5+6 — falha de backup cancela importação antes de gravar', async () => {
    const dir = mkTmpDir('cds-backup-imp-');
    const dbFile = path.join(dir, 'imp.db');
    const pastaRuim = path.join(dir, 'arquivo-nao-pasta');
    fs.writeFileSync(pastaRuim, 'x');

    const db = await openDb(dbFile);
    await run(db, `CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT, nome TEXT, ativo INTEGER DEFAULT 1
    )`);
    await run(db, `CREATE TABLE configuracoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chave VARCHAR(100) UNIQUE NOT NULL,
      valor TEXT
    )`);

    const before = await get(db, 'SELECT COUNT(*) AS n FROM produtos');

    const validacao = {
      arquivo: 't.xlsx',
      linhas: [{
        status: STATUS.PRONTO,
        produto: {
          codigo: 'T1',
          nome: 'Teste',
          controla_estoque: false
        }
      }]
    };

    await assert.rejects(
      () => executarImportacao(db, validacao, {
        importId: 'bk-fail',
        dbPath: dbFile,
        pastaBackup: pastaRuim
      }),
      (err) => {
        assert.match(String(err.message), /Não foi possível criar o backup/);
        assert.match(String(err.message), /Motivo:/);
        assert.ok(err.detalhes);
        return true;
      }
    );

    const after = await get(db, 'SELECT COUNT(*) AS n FROM produtos');
    assert.equal(after.n, before.n);
    await new Promise((resolve) => db.close(resolve));
  });

  it('TESTE 7 — caminho inexistente mas criável é aceito', () => {
    const dir = mkTmpDir('cds-backup-mkdir-');
    const pastaNova = path.join(dir, 'sub', 'backups-novos');
    assert.ok(!fs.existsSync(pastaNova));
    const r = garantirPastaBackupGravavel(pastaNova);
    assert.equal(r.sucesso, true);
    assert.ok(fs.existsSync(r.caminho));
    assert.ok(fs.statSync(r.caminho).isDirectory());
  });

  it('TESTE 8 — caminho sem permissão / inacessível não é aceito', () => {
    const pasta = path.join('C:\\Users\\__cds_usuario_inexistente__\\Desktop\\Backups-cds');
    const r = garantirPastaBackupGravavel(pasta);
    assert.equal(r.sucesso, false);
    assert.ok(r.erro);
    assert.ok(r.codigo);
  });

  it('fallback oficial é <dir do banco>/backups', () => {
    const dbFake = 'C:\\ProgramData\\MercantilFiscal\\dados\\mercadao.db';
    const expected = path.join('C:\\ProgramData\\MercantilFiscal\\dados', 'backups');
    assert.equal(obterPastaBackupPadrao(dbFake), expected);
  });
});
