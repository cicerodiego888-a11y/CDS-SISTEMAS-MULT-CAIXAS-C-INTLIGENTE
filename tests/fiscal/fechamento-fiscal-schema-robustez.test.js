const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');

const { garantirSchemaFechamentoFiscal } = require('../../backend/services/fechamento-fiscal/schema/fechamentoFiscalSchema');

function openDb() {
  return new sqlite3.Database(':memory:');
}

test('garantirSchemaFechamentoFiscal tolera estado legado com índice único duplicado', async () => {
  const db = openDb();

  try {
    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run(`CREATE TABLE fechamentos_fiscais (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          data_fechamento TEXT NOT NULL,
          cnpj TEXT NOT NULL DEFAULT '',
          empresa_id INTEGER,
          valor_informado REAL NOT NULL DEFAULT 0,
          valor_distribuido REAL NOT NULL DEFAULT 0,
          diferenca REAL NOT NULL DEFAULT 0,
          valor_alvo REAL NOT NULL DEFAULT 250,
          valor_min REAL NOT NULL DEFAULT 80,
          valor_max REAL NOT NULL DEFAULT 400,
          distribuicao_automatica INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'RASCUNHO',
          usuario_id INTEGER,
          quantidade_maquinas INTEGER NOT NULL DEFAULT 0,
          observacao TEXT,
          criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )`);

        db.run(`CREATE TABLE fechamentos_fiscais_documentos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fechamento_fiscal_id INTEGER NOT NULL,
          previa_venda_id INTEGER,
          sequencia INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'RASCUNHO',
          valor_total REAL NOT NULL DEFAULT 0,
          numero_provisorio INTEGER,
          serie TEXT,
          ambiente INTEGER,
          tp_emis TEXT NOT NULL DEFAULT '1',
          data_referencia_comercial TEXT,
          data_hora_preparacao TEXT,
          data_hora_emissao TEXT,
          chave_acesso_provisoria TEXT,
          xml_preparado TEXT,
          xml_hash TEXT,
          checklist_json TEXT,
          erros_json TEXT,
          idempotency_key TEXT,
          criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )`);

        db.run(`INSERT INTO fechamentos_fiscais_documentos (fechamento_fiscal_id, sequencia, idempotency_key, status)
          VALUES (1, 1, 'abc', 'RASCUNHO')`);
        db.run(`INSERT INTO fechamentos_fiscais_documentos (fechamento_fiscal_id, sequencia, idempotency_key, status)
          VALUES (1, 2, 'abc', 'RASCUNHO')`);

        garantirSchemaFechamentoFiscal(db, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });

    const count = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) AS total FROM fechamentos_fiscais_documentos', (err, row) => {
        if (err) return reject(err);
        resolve(row.total);
      });
    });

    assert.equal(count, 2);
  } finally {
    await new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
  }
});
