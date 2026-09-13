'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { aplicarCfopCsosnEmTodosProdutos } = require('../../backend/services/fiscal/aplicarPadraoFiscalProdutos');

function abrirDb(cb) {
  const db = new sqlite3.Database(':memory:');
  db.serialize(() => {
    db.run(`CREATE TABLE produtos (
      id INTEGER PRIMARY KEY,
      cfop TEXT,
      csosn TEXT,
      origem TEXT,
      cest TEXT,
      updated_at TEXT
    )`);
    db.run(`INSERT INTO produtos (id, cfop, csosn, origem, cest) VALUES
      (1, '5101', '101', '0', '0100100'),
      (2, NULL, NULL, '1', '0200200')`, cb);
  });
  return db;
}

describe('aplicar CFOP/CSOSN do padrão fiscal em todos os produtos', () => {
  it('atualiza só CFOP e CSOSN em todos os cadastros', (_, done) => {
    const db = abrirDb((err) => {
      assert.ifError(err);
      aplicarCfopCsosnEmTodosProdutos(db, { cfop: '5102', csosn: '102' }, (updErr, result) => {
        assert.ifError(updErr);
        assert.equal(result.aplicado, true);
        assert.equal(result.produtos_atualizados, 2);
        db.all('SELECT * FROM produtos ORDER BY id', (selErr, rows) => {
          assert.ifError(selErr);
          assert.equal(rows[0].cfop, '5102');
          assert.equal(rows[0].csosn, '102');
          assert.equal(rows[0].origem, '0');
          assert.equal(rows[0].cest, '0100100');
          assert.equal(rows[1].cfop, '5102');
          assert.equal(rows[1].csosn, '102');
          assert.equal(rows[1].origem, '1');
          assert.equal(rows[1].cest, '0200200');
          db.close();
          done();
        });
      });
    });
  });

  it('não altera produtos se CFOP e CSOSN estiverem vazios', (_, done) => {
    const db = abrirDb((err) => {
      assert.ifError(err);
      aplicarCfopCsosnEmTodosProdutos(db, { cfop: '  ', csosn: '' }, (updErr, result) => {
        assert.ifError(updErr);
        assert.equal(result.aplicado, false);
        assert.equal(result.produtos_atualizados, 0);
        db.get('SELECT cfop, csosn FROM produtos WHERE id = 1', (selErr, row) => {
          assert.ifError(selErr);
          assert.equal(row.cfop, '5101');
          assert.equal(row.csosn, '101');
          db.close();
          done();
        });
      });
    });
  });
});
