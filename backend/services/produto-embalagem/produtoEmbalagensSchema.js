/**
 * Schema DDL — produto_embalagens (Apresentações comerciais 1:N)
 * @module services/produto-embalagem/produtoEmbalagensSchema
 */

'use strict';

const { unidadeComercialParaTipo } = require('./tiposApresentacao');

const DDL_TABELA = `
  CREATE TABLE IF NOT EXISTS produto_embalagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id INTEGER NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'UN',
    descricao TEXT,
    quantidade REAL NOT NULL DEFAULT 1,
    unidade TEXT,
    gtin TEXT,
    codigo_fornecedor TEXT,
    fornecedor_cnpj TEXT,
    fornecedor_nome TEXT,
    valor_compra REAL DEFAULT 0,
    preco_venda REAL DEFAULT 0,
    principal INTEGER NOT NULL DEFAULT 0,
    compra INTEGER NOT NULL DEFAULT 1,
    venda INTEGER NOT NULL DEFAULT 1,
    estoque INTEGER NOT NULL DEFAULT 1,
    ativa INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
  )
`;

const DDL_HISTORICO = `
  CREATE TABLE IF NOT EXISTS produto_embalagem_historico (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    embalagem_id INTEGER NOT NULL,
    campo TEXT NOT NULL,
    valor_anterior TEXT,
    valor_novo TEXT,
    usuario_id INTEGER,
    usuario_nome TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (embalagem_id) REFERENCES produto_embalagens(id) ON DELETE CASCADE
  )
`;

const INDICES = [
  `CREATE INDEX IF NOT EXISTS idx_produto_embalagens_produto
    ON produto_embalagens(produto_id)`,
  `CREATE INDEX IF NOT EXISTS idx_produto_embalagens_gtin
    ON produto_embalagens(gtin)`,
  `CREATE INDEX IF NOT EXISTS idx_produto_embalagens_codigo_fornecedor
    ON produto_embalagens(codigo_fornecedor)`,
  `CREATE INDEX IF NOT EXISTS idx_produto_embalagens_ativa
    ON produto_embalagens(produto_id, ativa)`,
  `CREATE INDEX IF NOT EXISTS idx_produto_embalagem_historico_emb
    ON produto_embalagem_historico(embalagem_id)`
];

const ALTER_COMPRAS_ITENS = [
  `ALTER TABLE compras_itens ADD COLUMN embalagem_id INTEGER`
];

/**
 * @param {Object} db
 * @param {Function} [callback]
 */
function garantirSchemaProdutoEmbalagens(db, callback) {
  const done = typeof callback === 'function' ? callback : () => {};

  db.run(DDL_TABELA, (err) => {
    if (err) {
      console.error('Erro ao criar tabela produto_embalagens:', err.message);
      return done(err);
    }
    console.log('Tabela produto_embalagens criada/verificada');

    db.run(DDL_HISTORICO, (histErr) => {
      if (histErr) {
        console.error('Erro ao criar tabela produto_embalagem_historico:', histErr.message);
        return done(histErr);
      }
      console.log('Tabela produto_embalagem_historico criada/verificada');

      let pendentes = INDICES.length + ALTER_COMPRAS_ITENS.length;
      if (pendentes === 0) {
        return migrarEmbalagensLegadoProdutos(db, done);
      }

      let falha = null;
      const finalizarAlter = () => {
        pendentes -= 1;
        if (pendentes === 0) {
          if (falha) return done(falha);
          migrarEmbalagensLegadoProdutos(db, done);
        }
      };

      INDICES.forEach((sql) => {
        db.run(sql, (idxErr) => {
          if (idxErr && !falha) {
            falha = idxErr;
            console.error('Erro ao criar índice produto_embalagens:', idxErr.message);
          }
          finalizarAlter();
        });
      });

      ALTER_COMPRAS_ITENS.forEach((sql) => {
        db.run(sql, (altErr) => {
          if (altErr && !String(altErr.message).includes('duplicate column name') && !falha) {
            falha = altErr;
            console.warn('[produto_embalagens] ALTER compras_itens:', altErr.message);
          }
          finalizarAlter();
        });
      });
    });
  });
}

/**
 * Backfill: produtos com embalagem comercial legada ganham registro em produto_embalagens.
 * @param {Object} db
 * @param {Function} [callback]
 */
function migrarEmbalagensLegadoProdutos(db, callback) {
  const done = typeof callback === 'function' ? callback : () => {};

  db.all(
    `SELECT id, unidade, unidade_comercial, quantidade_por_embalagem,
            compra_por_embalagem, valor_compra_embalagem, preco_venda,
            codigo_barras, fornecedor
     FROM produtos
     WHERE COALESCE(quantidade_por_embalagem, 0) > 0
        OR COALESCE(compra_por_embalagem, 0) = 1
        OR UPPER(COALESCE(unidade_comercial, 'UN')) != 'UN'`,
    [],
    (err, rows) => {
      if (err) {
        console.error('[PRODUTO EMBALAGEM] Falha ao listar produtos legado:', err.message);
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
        db.get(
          `SELECT id FROM produto_embalagens WHERE produto_id = ? LIMIT 1`,
          [produto.id],
          (findErr, existente) => {
            if (findErr && !falha) falha = findErr;

            const finalizarItem = () => {
              pendentes -= 1;
              if (pendentes === 0) {
                if (!falha && migrados > 0) {
                  console.log(
                    `[PRODUTO EMBALAGEM] Migração legado: ${migrados} criado(s), ${jaExistentes} já existente(s)`
                  );
                }
                done(falha, { migrados, jaExistentes });
              }
            };

            if (findErr || existente) {
              if (existente) jaExistentes += 1;
              return finalizarItem();
            }

            const tipo = unidadeComercialParaTipo(produto.unidade_comercial);
            const qtd = Number(produto.quantidade_por_embalagem || 0) || 1;
            const compra = Number(produto.compra_por_embalagem || 0) === 1 ? 1 : 0;

            db.run(
              `INSERT INTO produto_embalagens (
                produto_id, tipo, descricao, quantidade, unidade, gtin,
                fornecedor_nome, valor_compra, preco_venda,
                principal, compra, venda, estoque, ativa,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, 1, 1,
                datetime('now', 'localtime'), datetime('now', 'localtime'))`,
              [
                produto.id,
                tipo,
                null,
                qtd,
                produto.unidade || 'un',
                produto.codigo_barras || null,
                produto.fornecedor || null,
                Number(produto.valor_compra_embalagem || 0),
                Number(produto.preco_venda || 0) * qtd,
                compra
              ],
              (insErr) => {
                if (insErr && !falha) falha = insErr;
                else if (!insErr) migrados += 1;
                finalizarItem();
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
  DDL_HISTORICO,
  INDICES,
  garantirSchemaProdutoEmbalagens,
  migrarEmbalagensLegadoProdutos
};
