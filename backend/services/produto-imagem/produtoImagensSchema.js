/**
 * Schema DDL — produto_imagens (Sprint INFRA 02)
 * Galeria complementar; imagem_principal permanece a fonte da UI atual.
 */

const DDL_TABELA = `
  CREATE TABLE IF NOT EXISTS produto_imagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id INTEGER NOT NULL,
    arquivo TEXT NOT NULL,
    ordem INTEGER NOT NULL DEFAULT 1,
    principal INTEGER NOT NULL DEFAULT 0,
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
  )
`;

const INDICES = [
  `CREATE INDEX IF NOT EXISTS idx_produto_imagens_produto
    ON produto_imagens(produto_id)`,
  `CREATE INDEX IF NOT EXISTS idx_produto_imagens_produto_ativo
    ON produto_imagens(produto_id, ativo)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_produto_imagens_principal_ativo
    ON produto_imagens(produto_id)
    WHERE principal = 1 AND ativo = 1`
];

/**
 * @param {Object} db - sqlite3 Database
 * @param {Function} [callback]
 */
function garantirSchemaProdutoImagens(db, callback) {
  const done = typeof callback === 'function' ? callback : () => {};

  db.run(DDL_TABELA, (err) => {
    if (err) {
      console.error('Erro ao criar tabela produto_imagens:', err.message);
      return done(err);
    }
    console.log('Tabela produto_imagens criada/verificada');

    let pendentes = INDICES.length;
    if (pendentes === 0) {
      return migrarImagensPrincipaisParaGaleria(db, done);
    }

    let falha = null;
    INDICES.forEach((sql) => {
      db.run(sql, (idxErr) => {
        if (idxErr && !falha) {
          falha = idxErr;
          console.error('Erro ao criar índice produto_imagens:', idxErr.message);
        }
        pendentes -= 1;
        if (pendentes === 0) {
          if (falha) return done(falha);
          migrarImagensPrincipaisParaGaleria(db, done);
        }
      });
    });
  });
}

/**
 * Backfill: produtos com imagem_principal ganham registro em produto_imagens
 * (principal=1, ordem=1, ativo=1) sem alterar imagem_principal.
 * @param {Object} db
 * @param {Function} [callback]
 */
function migrarImagensPrincipaisParaGaleria(db, callback) {
  const done = typeof callback === 'function' ? callback : () => {};

  db.all(
    `SELECT id, imagem_principal
     FROM produtos
     WHERE imagem_principal IS NOT NULL
       AND TRIM(imagem_principal) != ''
       AND imagem_principal NOT LIKE 'data:%'`,
    [],
    (err, rows) => {
      if (err) {
        console.error('[PRODUTO IMAGEM] Falha ao listar imagens principais para migração:', err.message);
        return done(err);
      }

      const lista = rows || [];
      if (lista.length === 0) {
        return done(null, { migrados: 0, jaExistentes: 0 });
      }

      let pendentes = lista.length;
      let migrados = 0;
      let jaExistentes = 0;
      let falha = null;

      lista.forEach((produto) => {
        const arquivo = String(produto.imagem_principal || '').trim();
        const produtoId = produto.id;

        db.get(
          `SELECT id FROM produto_imagens
           WHERE produto_id = ?
             AND ativo = 1
             AND principal = 1
             AND arquivo = ?
           LIMIT 1`,
          [produtoId, arquivo],
          (findErr, existente) => {
            if (findErr && !falha) falha = findErr;

            const finalizarItem = () => {
              pendentes -= 1;
              if (pendentes === 0) {
                if (!falha) {
                  console.log(
                    `[PRODUTO IMAGEM] Migração galeria: ${migrados} criado(s), ${jaExistentes} já existente(s)`
                  );
                }
                done(falha, { migrados, jaExistentes });
              }
            };

            if (findErr || existente) {
              if (existente) jaExistentes += 1;
              return finalizarItem();
            }

            db.run(
              `UPDATE produto_imagens
               SET principal = 0, updated_at = datetime('now', 'localtime')
               WHERE produto_id = ? AND principal = 1 AND ativo = 1`,
              [produtoId],
              (clearErr) => {
                if (clearErr && !falha) falha = clearErr;
                db.run(
                  `INSERT INTO produto_imagens (
                    produto_id, arquivo, ordem, principal, ativo, created_at, updated_at
                  ) VALUES (?, ?, 1, 1, 1, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
                  [produtoId, arquivo],
                  (insErr) => {
                    if (insErr && !falha) falha = insErr;
                    else if (!insErr) migrados += 1;
                    finalizarItem();
                  }
                );
              }
            );
          }
        );
      });
    }
  );
}

module.exports = {
  DDL_TABELA,
  INDICES,
  garantirSchemaProdutoImagens,
  migrarImagensPrincipaisParaGaleria
};
