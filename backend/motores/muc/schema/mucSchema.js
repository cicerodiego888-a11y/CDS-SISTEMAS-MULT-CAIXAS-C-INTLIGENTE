/**
 * MUC RC1 — Schema DDL (evolução produto_embalagens + compras_itens + auditoria)
 * @module motores/muc/schema/mucSchema
 */
'use strict';

const ALTER_PRODUTO_EMBALAGENS = [
  `ALTER TABLE produto_embalagens ADD COLUMN tipo_conversao TEXT DEFAULT 'UNIDADE'`,
  `ALTER TABLE produto_embalagens ADD COLUMN codigo_interno_fornecedor TEXT`,
  `ALTER TABLE produto_embalagens ADD COLUMN fornecedor_descricao TEXT`,
  `ALTER TABLE produto_embalagens ADD COLUMN vigencia_inicio DATE`,
  `ALTER TABLE produto_embalagens ADD COLUMN vigencia_fim DATE`,
  `ALTER TABLE produto_embalagens ADD COLUMN origem TEXT DEFAULT 'CADASTRO'`,
  `ALTER TABLE produto_embalagens ADD COLUMN usuario_criacao INTEGER`,
  `ALTER TABLE produto_embalagens ADD COLUMN usuario_alteracao INTEGER`,
  `ALTER TABLE produto_embalagens ADD COLUMN observacao TEXT`,
  `ALTER TABLE produto_embalagens ADD COLUMN motivo_alteracao TEXT`
];

const ALTER_COMPRAS_ITENS = [
  `ALTER TABLE compras_itens ADD COLUMN embalagem_id INTEGER`,
  `ALTER TABLE compras_itens ADD COLUMN produto_apresentacao_id INTEGER`,
  `ALTER TABLE compras_itens ADD COLUMN resultado_conversao_json TEXT`,
  `ALTER TABLE compras_itens ADD COLUMN fator_conversao REAL DEFAULT 0`,
  `ALTER TABLE compras_itens ADD COLUMN tipo_conversao TEXT`,
  `ALTER TABLE compras_itens ADD COLUMN origem_conversao TEXT`,
  `ALTER TABLE compras_itens ADD COLUMN confianca_conversao REAL DEFAULT 0`,
  `ALTER TABLE compras_itens ADD COLUMN tipo_origem_compra TEXT`
];

const DDL_AUDITORIA = `
  CREATE TABLE IF NOT EXISTS muc_auditoria_conversao (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id INTEGER,
    apresentacao_id INTEGER,
    compra_item_id INTEGER,
    origem TEXT NOT NULL,
    metodo TEXT,
    confianca REAL DEFAULT 0,
    tipo_conversao TEXT,
    fator_conversao REAL,
    quantidade_compra REAL,
    quantidade_estoque REAL,
    custo_unitario REAL,
    custo_total REAL,
    gtin TEXT,
    fornecedor_cnpj TEXT,
    codigo_fornecedor TEXT,
    descricao TEXT,
    usuario_id INTEGER,
    usuario_nome TEXT,
    motivo TEXT,
    hash TEXT,
    payload_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`;

const DDL_APRENDIZADO = `
  CREATE TABLE IF NOT EXISTS muc_aprendizado (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id INTEGER NOT NULL,
    apresentacao_id INTEGER,
    fornecedor_cnpj TEXT NOT NULL,
    gtin TEXT,
    codigo_fornecedor TEXT,
    tipo_apresentacao TEXT,
    fator_conversao REAL DEFAULT 1,
    tipo_conversao TEXT DEFAULT 'MULTIPLICADOR',
    confianca REAL DEFAULT 100,
    ocorrencias INTEGER DEFAULT 1,
    ultima_descricao TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(fornecedor_cnpj, gtin, codigo_fornecedor, produto_id)
  )
`;

const ALTER_AUDITORIA_RC2 = [
  `ALTER TABLE muc_auditoria_conversao ADD COLUMN correlation_id TEXT`,
  `ALTER TABLE muc_auditoria_conversao ADD COLUMN tempo_processamento_ms REAL`,
  `ALTER TABLE muc_auditoria_conversao ADD COLUMN regra_aplicada TEXT`,
  `ALTER TABLE muc_auditoria_conversao ADD COLUMN versao_regra TEXT`,
  `ALTER TABLE muc_auditoria_conversao ADD COLUMN versao_motor TEXT`,
  `ALTER TABLE muc_auditoria_conversao ADD COLUMN xml_origem TEXT`
];

const INDICES = [
  `CREATE INDEX IF NOT EXISTS idx_muc_auditoria_produto ON muc_auditoria_conversao(produto_id)`,
  `CREATE INDEX IF NOT EXISTS idx_muc_auditoria_apresentacao ON muc_auditoria_conversao(apresentacao_id)`,
  `CREATE INDEX IF NOT EXISTS idx_muc_aprendizado_gtin ON muc_aprendizado(gtin)`,
  `CREATE INDEX IF NOT EXISTS idx_muc_aprendizado_fornecedor ON muc_aprendizado(fornecedor_cnpj, codigo_fornecedor)`
];

function aplicarAlterSeguro(db, sql, callback) {
  db.run(sql, (err) => {
    if (err && !String(err.message).includes('duplicate column name')) {
      return callback(err);
    }
    callback(null);
  });
}

/**
 * @param {Object} db
 * @param {Function} [callback]
 */
function garantirSchemaMuc(db, callback) {
  const done = typeof callback === 'function' ? callback : () => {};

  db.run(DDL_AUDITORIA, (audErr) => {
    if (audErr) {
      console.error('[MUC] Erro ao criar muc_auditoria_conversao:', audErr.message);
      return done(audErr);
    }

    db.run(DDL_APRENDIZADO, (apErr) => {
      if (apErr) {
        console.error('[MUC] Erro ao criar muc_aprendizado:', apErr.message);
        return done(apErr);
      }

      const alters = [...ALTER_PRODUTO_EMBALAGENS, ...ALTER_COMPRAS_ITENS, ...ALTER_AUDITORIA_RC2];
      let pendentes = alters.length + INDICES.length;
      let falha = null;

      const tick = () => {
        pendentes -= 1;
        if (pendentes === 0) {
          if (falha) return done(falha);
          console.log('[MUC RC2] Schema garantido (apresentações + compras + auditoria + aprendizado)');
          done(null);
        }
      };

      alters.forEach((sql) => {
        aplicarAlterSeguro(db, sql, (err) => {
          if (err && !falha) falha = err;
          tick();
        });
      });

      INDICES.forEach((sql) => {
        db.run(sql, (idxErr) => {
          if (idxErr && !falha) falha = idxErr;
          tick();
        });
      });
    });
  });
}

module.exports = {
  garantirSchemaMuc,
  DDL_AUDITORIA,
  DDL_APRENDIZADO,
  ALTER_PRODUTO_EMBALAGENS,
  ALTER_COMPRAS_ITENS
};
