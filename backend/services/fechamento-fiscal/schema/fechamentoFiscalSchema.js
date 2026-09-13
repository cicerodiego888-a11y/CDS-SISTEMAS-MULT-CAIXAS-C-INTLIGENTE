/**
 * Sprint 01/02 — Schema Fechamento Fiscal do Dia.
 * Tabelas próprias — NÃO usa vendas / financeiro / estoque.
 */

'use strict';

const DDL = [
  `CREATE TABLE IF NOT EXISTS fechamentos_fiscais (
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
  )`,
  `CREATE TABLE IF NOT EXISTS fechamentos_fiscais_recebimentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fechamento_fiscal_id INTEGER NOT NULL,
    operadora TEXT NOT NULL,
    descricao TEXT,
    cnpj TEXT,
    valor REAL NOT NULL DEFAULT 0,
    observacao TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (fechamento_fiscal_id) REFERENCES fechamentos_fiscais(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS fechamentos_fiscais_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fechamento_fiscal_id INTEGER NOT NULL,
    produto_id INTEGER NOT NULL,
    quantidade_disponivel REAL NOT NULL DEFAULT 0,
    valor_vendido_no_dia REAL NOT NULL DEFAULT 0,
    quantidade_utilizada REAL NOT NULL DEFAULT 0,
    valor_utilizado REAL NOT NULL DEFAULT 0,
    ordem INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (fechamento_fiscal_id) REFERENCES fechamentos_fiscais(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS fechamentos_fiscais_previa_vendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fechamento_fiscal_id INTEGER NOT NULL,
    sequencia INTEGER NOT NULL DEFAULT 1,
    valor REAL NOT NULL DEFAULT 0,
    quantidade_itens INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (fechamento_fiscal_id) REFERENCES fechamentos_fiscais(id) ON DELETE CASCADE
  )`,
  // Sprint 02 — itens de cada venda da prévia + rastreabilidade
  `CREATE TABLE IF NOT EXISTS fechamentos_fiscais_previa_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    previa_venda_id INTEGER NOT NULL,
    fechamento_fiscal_id INTEGER NOT NULL,
    produto_id INTEGER NOT NULL,
    venda_origem_id INTEGER,
    venda_item_origem_id INTEGER,
    quantidade REAL NOT NULL DEFAULT 0,
    valor_unitario REAL NOT NULL DEFAULT 0,
    valor_total REAL NOT NULL DEFAULT 0,
    unidade TEXT,
    ordem INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (previa_venda_id) REFERENCES fechamentos_fiscais_previa_vendas(id) ON DELETE CASCADE,
    FOREIGN KEY (fechamento_fiscal_id) REFERENCES fechamentos_fiscais(id) ON DELETE CASCADE
  )`,
  // Sprint 03 — documentos fiscais preparados (sem transmissão automática)
  `CREATE TABLE IF NOT EXISTS fechamentos_fiscais_documentos (
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
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (fechamento_fiscal_id) REFERENCES fechamentos_fiscais(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS fechamentos_fiscais_documentos_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    documento_id INTEGER NOT NULL,
    fechamento_fiscal_id INTEGER NOT NULL,
    produto_id INTEGER NOT NULL,
    descricao TEXT,
    ncm TEXT,
    cest TEXT,
    cfop TEXT,
    csosn TEXT,
    origem INTEGER DEFAULT 0,
    unidade TEXT,
    quantidade REAL NOT NULL DEFAULT 0,
    valor_unitario REAL NOT NULL DEFAULT 0,
    valor_total REAL NOT NULL DEFAULT 0,
    desconto REAL NOT NULL DEFAULT 0,
    acrescimo REAL NOT NULL DEFAULT 0,
    snapshot_json TEXT,
    ordem INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (documento_id) REFERENCES fechamentos_fiscais_documentos(id) ON DELETE CASCADE,
    FOREIGN KEY (fechamento_fiscal_id) REFERENCES fechamentos_fiscais(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS fechamentos_fiscais_documentos_pagamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    documento_id INTEGER NOT NULL,
    fechamento_fiscal_id INTEGER NOT NULL,
    recebimento_id INTEGER,
    operadora TEXT,
    cnpj TEXT,
    forma_pagamento TEXT NOT NULL DEFAULT 'cartao',
    valor REAL NOT NULL DEFAULT 0,
    observacao TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (documento_id) REFERENCES fechamentos_fiscais_documentos(id) ON DELETE CASCADE,
    FOREIGN KEY (fechamento_fiscal_id) REFERENCES fechamentos_fiscais(id) ON DELETE CASCADE
  )`,
  // Sprint 04 — auditoria de tentativas de transmissão (não apaga histórico)
  `CREATE TABLE IF NOT EXISTS fechamentos_fiscais_transmissoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fechamento_fiscal_id INTEGER NOT NULL,
    documento_id INTEGER,
    usuario_id INTEGER,
    tentativa INTEGER NOT NULL DEFAULT 1,
    ambiente INTEGER,
    status TEXT,
    cstat TEXT,
    xmotivo TEXT,
    chave_acesso TEXT,
    protocolo TEXT,
    duracao_ms INTEGER,
    xml_enviado_hash TEXT,
    retorno_resumo TEXT,
    erro_tecnico TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (fechamento_fiscal_id) REFERENCES fechamentos_fiscais(id) ON DELETE CASCADE
  )`
];

const INDICES = [
  `CREATE INDEX IF NOT EXISTS idx_ff_data ON fechamentos_fiscais(data_fechamento)`,
  `CREATE INDEX IF NOT EXISTS idx_ff_cnpj_data ON fechamentos_fiscais(cnpj, data_fechamento)`,
  `CREATE INDEX IF NOT EXISTS idx_ff_status ON fechamentos_fiscais(status)`,
  `CREATE INDEX IF NOT EXISTS idx_ffr_fechamento ON fechamentos_fiscais_recebimentos(fechamento_fiscal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ffi_fechamento ON fechamentos_fiscais_itens(fechamento_fiscal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ffpv_fechamento ON fechamentos_fiscais_previa_vendas(fechamento_fiscal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ffpi_fechamento ON fechamentos_fiscais_previa_itens(fechamento_fiscal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ffpi_previa ON fechamentos_fiscais_previa_itens(previa_venda_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ffdoc_fechamento ON fechamentos_fiscais_documentos(fechamento_fiscal_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ffdoc_idempotency ON fechamentos_fiscais_documentos(fechamento_fiscal_id, idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS idx_ffdi_documento ON fechamentos_fiscais_documentos_itens(documento_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ffdp_documento ON fechamentos_fiscais_documentos_pagamentos(documento_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fftx_fechamento ON fechamentos_fiscais_transmissoes(fechamento_fiscal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fftx_documento ON fechamentos_fiscais_transmissoes(documento_id)`
];

const ALTERS = [
  `ALTER TABLE fechamentos_fiscais_previa_vendas ADD COLUMN quantidade_itens INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE fechamentos_fiscais ADD COLUMN data_referencia_comercial TEXT`,
  `ALTER TABLE fechamentos_fiscais ADD COLUMN data_hora_preparacao TEXT`,
  `ALTER TABLE fechamentos_fiscais ADD COLUMN data_hora_emissao TEXT`,
  `ALTER TABLE fechamentos_fiscais ADD COLUMN data_hora_autorizacao TEXT`,
  `ALTER TABLE fechamentos_fiscais ADD COLUMN tp_emis TEXT DEFAULT '1'`,
  `ALTER TABLE fechamentos_fiscais ADD COLUMN preparacao_idempotency_key TEXT`,
  // Sprint 04 — campos de transmissão/autorização por documento
  `ALTER TABLE fechamentos_fiscais_documentos ADD COLUMN numero INTEGER`,
  `ALTER TABLE fechamentos_fiscais_documentos ADD COLUMN chave_acesso TEXT`,
  `ALTER TABLE fechamentos_fiscais_documentos ADD COLUMN protocolo TEXT`,
  `ALTER TABLE fechamentos_fiscais_documentos ADD COLUMN recibo TEXT`,
  `ALTER TABLE fechamentos_fiscais_documentos ADD COLUMN cstat TEXT`,
  `ALTER TABLE fechamentos_fiscais_documentos ADD COLUMN xmotivo TEXT`,
  `ALTER TABLE fechamentos_fiscais_documentos ADD COLUMN xml_assinado TEXT`,
  `ALTER TABLE fechamentos_fiscais_documentos ADD COLUMN xml_enviado TEXT`,
  `ALTER TABLE fechamentos_fiscais_documentos ADD COLUMN xml_autorizado TEXT`,
  `ALTER TABLE fechamentos_fiscais_documentos ADD COLUMN xml_retorno TEXT`,
  `ALTER TABLE fechamentos_fiscais_documentos ADD COLUMN data_hora_autorizacao TEXT`,
  `ALTER TABLE fechamentos_fiscais_documentos ADD COLUMN tentativa INTEGER NOT NULL DEFAULT 0`
];

/**
 * @param {object} db
 * @param {function} [callback]
 */
function garantirSchemaFechamentoFiscal(db, callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  if (!db || typeof db.run !== 'function') {
    return done(new Error('db inválido'));
  }

  let i = 0;
  const todos = DDL.concat(INDICES);

  function next(err) {
    if (err) {
      console.error('[FechamentoFiscal] schema:', err.message);
      return done(err);
    }
    if (i >= todos.length) {
      return aplicarAlters(0);
    }
    const sql = todos[i++];
    db.run(sql, next);
  }

  function aplicarAlters(j) {
    if (j >= ALTERS.length) {
      console.log('Tabelas fechamentos_fiscais* criadas/verificadas');
      return done(null);
    }
    db.run(ALTERS[j], (err) => {
      // coluna já existe → ignore
      if (err && !/duplicate column/i.test(String(err.message || ''))) {
        console.warn('[FechamentoFiscal] alter:', err.message);
      }
      aplicarAlters(j + 1);
    });
  }

  next();
}

module.exports = {
  garantirSchemaFechamentoFiscal,
  DDL,
  INDICES
};
