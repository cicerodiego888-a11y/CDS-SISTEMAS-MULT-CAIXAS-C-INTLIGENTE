/**
 * Schema DDL — produto_identificadores (MIP Sprint 01).
 * Pode ser aplicado via database.js ou testes isolados.
 * @module motores/produto-identidade/schema/produtoIdentificadoresSchema
 */

const DDL_TABELA = `
  CREATE TABLE IF NOT EXISTS produto_identificadores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    codigo TEXT NOT NULL,
    codigo_exibicao TEXT,
    escopo TEXT,
    escopo_valor TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    principal INTEGER NOT NULL DEFAULT 0,
    origem TEXT,
    metadados TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
  )
`;

const INDICES = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_pi_unique_ativo
    ON produto_identificadores(tipo, codigo, ifnull(escopo, ''), ifnull(escopo_valor, ''))
    WHERE ativo = 1`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_pi_principal_por_tipo
    ON produto_identificadores(produto_id, tipo)
    WHERE principal = 1 AND ativo = 1`,
  `CREATE INDEX IF NOT EXISTS idx_pi_produto ON produto_identificadores(produto_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pi_tipo_codigo
    ON produto_identificadores(tipo, codigo) WHERE ativo = 1`,
  `CREATE INDEX IF NOT EXISTS idx_pi_codigo
    ON produto_identificadores(codigo) WHERE ativo = 1`,
  `CREATE INDEX IF NOT EXISTS idx_pi_escopo
    ON produto_identificadores(tipo, escopo, escopo_valor, codigo)`
];

/**
 * @param {Object} db - sqlite3 Database
 * @param {Function} [callback]
 */
function garantirSchemaProdutoIdentificadores(db, callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  let mipLogger;
  try {
    mipLogger = require('../observability/mipLogger');
  } catch {
    mipLogger = { info: (...a) => console.log('[MIP]', ...a), error: (...a) => console.error('[MIP]', ...a) };
  }

  db.run(DDL_TABELA, (err) => {
    if (err) {
      mipLogger.error('Erro ao criar tabela produto_identificadores', { erro: err.message });
      return done(err);
    }
    mipLogger.info('Tabela produto_identificadores criada/verificada');

    let pendentes = INDICES.length;
    if (pendentes === 0) return done(null);

    let falha = null;
    INDICES.forEach((sql) => {
      db.run(sql, (idxErr) => {
        if (idxErr && !falha) {
          falha = idxErr;
          console.error('Erro ao criar índice produto_identificadores:', idxErr.message);
        }
        pendentes -= 1;
        if (pendentes === 0) done(falha);
      });
    });
  });
}

module.exports = {
  DDL_TABELA,
  INDICES,
  garantirSchemaProdutoIdentificadores
};
