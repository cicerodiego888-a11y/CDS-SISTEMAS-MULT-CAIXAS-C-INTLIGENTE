/**
 * Persistência da Inscrição Estadual do fornecedor.
 */
'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const db = require('../../backend/database');

function whenReady() {
  return new Promise((resolve, reject) => {
    db.whenReady((err) => (err ? reject(err) : resolve()));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

describe('Inscrição Estadual — auditoria de fluxo', () => {
  it('frontend envia inscricao_estadual e preenche o campo na edição', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fornecedores.js'), 'utf8');
    assert.match(src, /id="inscricaoEstadualFornecedor"/);
    assert.match(src, /inscricao_estadual:\s*\$\('#inscricaoEstadualFornecedor'\)\.val\(\)\.trim\(\)/);
    assert.match(src, /value="\$\{f\.inscricao_estadual \|\| ''\}"/);
    assert.match(src, /fetch\(`\/api\/fornecedores\/\$\{id\}`/);
  });

  it('GET por id usa SELECT * (carrega a coluna se gravada)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/rotas/fornecedores.js'), 'utf8');
    assert.match(src, /SELECT \* FROM fornecedores WHERE id = \?/);
  });

  it('POST INSERT e PUT UPDATE persistem inscricao_estadual', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/rotas/fornecedores.js'), 'utf8');
    assert.match(src, /inscricao_estadual,/);
    assert.match(src, /inscricao_estadual = \?/);
    assert.match(src, /inscricaoEstadualLimpa/);
  });
});

describe('Inscrição Estadual — banco SQLite', () => {
  let idTeste = null;

  it('coluna real é inscricao_estadual', async () => {
    await whenReady();
    const cols = await new Promise((resolve, reject) => {
      db.all('PRAGMA table_info(fornecedores)', [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
    const nomes = cols.map((c) => c.name);
    assert.ok(nomes.includes('inscricao_estadual'), `colunas: ${nomes.join(', ')}`);
  });

  it('CRIAR → SALVAR → REABRIR e EDITAR IE → SALVAR → REABRIR', async () => {
    await whenReady();
    const marker = `CDS_TEST_IE_${Date.now()}`;
    const inserted = await run(
      `INSERT INTO fornecedores (nome, razao_social, cpf_cnpj, inscricao_estadual)
       VALUES (?, ?, ?, ?)`,
      [marker, marker, null, '123456789']
    );
    idTeste = inserted.lastID;
    assert.ok(idTeste > 0);

    const criado = await get(
      'SELECT id, nome, cpf_cnpj, inscricao_estadual FROM fornecedores WHERE id = ?',
      [idTeste]
    );
    assert.equal(criado.inscricao_estadual, '123456789');

    await run(
      'UPDATE fornecedores SET inscricao_estadual = ? WHERE id = ?',
      ['987654321', idTeste]
    );
    const editado = await get(
      'SELECT id, nome, cpf_cnpj, inscricao_estadual FROM fornecedores WHERE id = ?',
      [idTeste]
    );
    assert.equal(editado.inscricao_estadual, '987654321');
  });

  after(async () => {
    if (idTeste) {
      await run('DELETE FROM fornecedores WHERE id = ?', [idTeste]);
    }
  });
});
