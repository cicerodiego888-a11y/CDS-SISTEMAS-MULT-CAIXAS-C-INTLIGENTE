'use strict';

const { normalizarNomeBusca } = require('../core/normalizarNomeBusca');

/**
 * Garante coluna nome_busca, índices e backfill inicial.
 * @param {import('sqlite3').Database} db
 * @param {(err?: Error|null) => void} [callback]
 */
function garantirSchemaMib(db, callback) {
  const done = typeof callback === 'function' ? callback : () => {};

  db.run(
    `ALTER TABLE produtos ADD COLUMN nome_busca TEXT`,
    (alterErr) => {
      // duplicate column = ok
      if (alterErr && !/duplicate column/i.test(String(alterErr.message || ''))) {
        console.warn('[MIB] ALTER nome_busca:', alterErr.message);
      }

      const indices = [
        `CREATE INDEX IF NOT EXISTS idx_produtos_codigo ON produtos(codigo)`,
        `CREATE INDEX IF NOT EXISTS idx_produtos_codigo_barras ON produtos(codigo_barras)`,
        `CREATE INDEX IF NOT EXISTS idx_produtos_nome_busca ON produtos(nome_busca)`,
        `CREATE INDEX IF NOT EXISTS idx_produtos_ativo ON produtos(ativo)`,
        `CREATE INDEX IF NOT EXISTS idx_produtos_nome_busca_ativo ON produtos(ativo, nome_busca)`,
        `CREATE INDEX IF NOT EXISTS idx_pi_tipo_codigo_ativo ON produto_identificadores(tipo, codigo, ativo)`
      ];

      let i = 0;
      const nextIndex = () => {
        if (i >= indices.length) {
          return garantirTabelasPersistencia(db, (tabErr) => {
            if (tabErr) console.warn('[MIB] tabelas persistência:', tabErr.message);
            return backfillNomeBusca(db, { limite: 5000, apenasVazios: true }, (bfErr) => {
              if (bfErr) console.warn('[MIB] backfill inicial:', bfErr.message);
              else console.log('[MIB] schema nome_busca + índices OK');
              done(null);
            });
          });
        }
        const sql = indices[i++];
        db.run(sql, (idxErr) => {
          if (idxErr) console.warn('[MIB] índice:', idxErr.message);
          nextIndex();
        });
      };
      nextIndex();
    }
  );
}

/**
 * Tabelas RC1.1 — config, estatísticas e histórico de benchmark.
 */
function garantirTabelasPersistencia(db, callback) {
  const cb = typeof callback === 'function' ? callback : () => {};
  const ddl = [
    `CREATE TABLE IF NOT EXISTS mib_config (
      chave TEXT PRIMARY KEY,
      valor TEXT,
      atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS mib_estatisticas (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT,
      atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS mib_benchmark_historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // RC2.0 — aprendizado cognitivo
    `CREATE TABLE IF NOT EXISTS mib_learning (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operador_id INTEGER,
      filial_id INTEGER,
      caixa_id INTEGER,
      texto TEXT,
      texto_norm TEXT,
      produto_id INTEGER,
      posicao INTEGER,
      tempo_ms REAL,
      encontrado INTEGER DEFAULT 0,
      horario TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mib_learning_termo ON mib_learning(texto_norm)`,
    `CREATE INDEX IF NOT EXISTS idx_mib_learning_operador ON mib_learning(operador_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mib_learning_produto ON mib_learning(produto_id)`,
    `CREATE TABLE IF NOT EXISTS mib_sinonimos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      termo TEXT NOT NULL,
      sinonimo TEXT NOT NULL,
      origem TEXT DEFAULT 'manual',
      ativo INTEGER DEFAULT 1,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(termo, sinonimo)
    )`,
    `CREATE TABLE IF NOT EXISTS mib_preferencias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      termo_norm TEXT NOT NULL,
      produto_id INTEGER NOT NULL,
      operador_id INTEGER DEFAULT 0,
      filial_id INTEGER,
      frequencia INTEGER DEFAULT 1,
      atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(termo_norm, produto_id, operador_id)
    )`
  ];
  let i = 0;
  const next = () => {
    if (i >= ddl.length) return cb(null);
    db.run(ddl[i++], (err) => {
      if (err) return cb(err);
      next();
    });
  };
  next();
}

/**
 * Preenche nome_busca a partir de nome (em lotes).
 * @param {import('sqlite3').Database} db
 * @param {{ limite?: number, apenasVazios?: boolean }} [opcoes]
 * @param {(err: Error|null, resultado?: { atualizados: number }) => void} callback
 */
function backfillNomeBusca(db, opcoes, callback) {
  const opts = opcoes && typeof opcoes === 'object' ? opcoes : {};
  const cb = typeof callback === 'function' ? callback : () => {};
  const limite = Math.min(Math.max(Number(opts.limite) || 2000, 1), 50000);
  const apenasVazios = opts.apenasVazios !== false;

  const where = apenasVazios
    ? `WHERE nome_busca IS NULL OR TRIM(COALESCE(nome_busca, '')) = ''`
    : '';

  db.all(
    `SELECT id, nome FROM produtos ${where} ORDER BY id ASC LIMIT ?`,
    [limite],
    (err, rows) => {
      if (err) return cb(err);
      if (!rows || !rows.length) return cb(null, { atualizados: 0 });

      let pendentes = rows.length;
      let atualizados = 0;
      let falha = null;

      rows.forEach((row) => {
        const nb = normalizarNomeBusca(row.nome);
        db.run(
          `UPDATE produtos SET nome_busca = ? WHERE id = ?`,
          [nb, row.id],
          (upErr) => {
            if (upErr && !falha) falha = upErr;
            else if (!upErr) atualizados += 1;
            pendentes -= 1;
            if (pendentes === 0) cb(falha, { atualizados });
          }
        );
      });
    }
  );
}

module.exports = {
  garantirSchemaMib,
  backfillNomeBusca,
  garantirTabelasPersistencia
};
