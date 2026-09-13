/**
 * Rascunho de NF-e de Devolução de Compra.
 * Não altera estoque, saldo fiscal nem emite documento — apenas persiste intenção do operador.
 */

'use strict';

const db = require('../../database');

const STATUS_RASCUNHO = 'RASCUNHO';

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function garantirTabelaRascunhoDevolucaoCompra() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS nfe_devolucao_compra_rascunhos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compra_id INTEGER NOT NULL UNIQUE,
      fornecedor TEXT,
      chave_nfe_original TEXT,
      cfop TEXT,
      observacoes TEXT,
      itens_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'RASCUNHO',
      usuario_id INTEGER,
      usuario_nome TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await dbRun(`
    CREATE INDEX IF NOT EXISTS idx_nfe_dev_rascunho_compra
    ON nfe_devolucao_compra_rascunhos(compra_id)
  `);
}

function normalizarItemRascunho(item = {}) {
  const qtd = Number(item.quantidade || 0);
  return {
    compra_item_id: Number(item.compra_item_id || item.id),
    produto_id: item.produto_id != null ? Number(item.produto_id) : null,
    produto_nome: item.produto_nome || null,
    quantidade: Math.round(qtd * 1000) / 1000,
    cfop: item.cfop ? String(item.cfop).replace(/\D/g, '').slice(0, 4) : null,
    valor_unitario: item.valor_unitario != null ? Number(item.valor_unitario) : null
  };
}

function mapearRascunho(row) {
  if (!row) return null;
  let itens = [];
  try {
    itens = JSON.parse(row.itens_json || '[]');
  } catch {
    itens = [];
  }
  return {
    id: row.id,
    compra_id: row.compra_id,
    fornecedor: row.fornecedor || '',
    chave_nfe_original: row.chave_nfe_original || '',
    cfop: row.cfop || '',
    observacoes: row.observacoes || '',
    itens: Array.isArray(itens) ? itens.map(normalizarItemRascunho) : [],
    status: row.status || STATUS_RASCUNHO,
    usuario_id: row.usuario_id || null,
    usuario_nome: row.usuario_nome || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function obterRascunhoDevolucaoCompra(compraId) {
  await garantirTabelaRascunhoDevolucaoCompra();
  const row = await dbGet(
    `SELECT * FROM nfe_devolucao_compra_rascunhos
     WHERE compra_id = ? AND status = ?`,
    [Number(compraId), STATUS_RASCUNHO]
  );
  return mapearRascunho(row);
}

async function salvarRascunhoDevolucaoCompra(compraId, payload = {}, opcoes = {}) {
  await garantirTabelaRascunhoDevolucaoCompra();
  const id = Number(compraId);
  if (!id) {
    throw Object.assign(new Error('Compra inválida.'), { statusCode: 400 });
  }

  const itensBrutos = Array.isArray(payload.itens) ? payload.itens : [];
  const itens = itensBrutos
    .map(normalizarItemRascunho)
    .filter((i) => i.compra_item_id && Number(i.quantidade) > 0);

  if (!itens.length) {
    throw Object.assign(
      new Error('Informe a quantidade a devolver de pelo menos um produto para salvar o rascunho.'),
      { statusCode: 400, code: 'RASCUNHO_SEM_ITENS' }
    );
  }

  const fornecedor = String(payload.fornecedor || '').trim();
  const chave = String(payload.chave_nfe_original || payload.refNFe || payload.chave || '')
    .replace(/\D/g, '');
  const cfop = String(payload.cfop || '').replace(/\D/g, '').slice(0, 4) || null;
  const observacoes = payload.observacoes != null ? String(payload.observacoes).slice(0, 500) : null;
  const itensJson = JSON.stringify(itens);

  const existente = await obterRascunhoDevolucaoCompra(id);
  if (existente) {
    await dbRun(`
      UPDATE nfe_devolucao_compra_rascunhos SET
        fornecedor = ?,
        chave_nfe_original = ?,
        cfop = ?,
        observacoes = ?,
        itens_json = ?,
        status = ?,
        usuario_id = COALESCE(?, usuario_id),
        usuario_nome = COALESCE(?, usuario_nome),
        updated_at = CURRENT_TIMESTAMP
      WHERE compra_id = ?
    `, [
      fornecedor || null,
      chave || null,
      cfop,
      observacoes,
      itensJson,
      STATUS_RASCUNHO,
      opcoes.usuarioId || null,
      opcoes.usuarioNome || null,
      id
    ]);
  } else {
    await dbRun(`
      INSERT INTO nfe_devolucao_compra_rascunhos (
        compra_id, fornecedor, chave_nfe_original, cfop, observacoes,
        itens_json, status, usuario_id, usuario_nome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      fornecedor || null,
      chave || null,
      cfop,
      observacoes,
      itensJson,
      STATUS_RASCUNHO,
      opcoes.usuarioId || null,
      opcoes.usuarioNome || null
    ]);
  }

  return obterRascunhoDevolucaoCompra(id);
}

async function excluirRascunhoDevolucaoCompra(compraId) {
  await garantirTabelaRascunhoDevolucaoCompra();
  const result = await dbRun(
    `DELETE FROM nfe_devolucao_compra_rascunhos WHERE compra_id = ?`,
    [Number(compraId)]
  );
  return { removido: result.changes > 0 };
}

module.exports = {
  STATUS_RASCUNHO,
  garantirTabelaRascunhoDevolucaoCompra,
  obterRascunhoDevolucaoCompra,
  salvarRascunhoDevolucaoCompra,
  excluirRascunhoDevolucaoCompra
};
