/**
 * RC8.5.2 — Aprendizado MIE por fornecedor.
 * @module services/embalagens/MieAprendizadoRepository
 */

'use strict';

const { normalizarUCom } = require('./MiePadroes');

function digitsCnpj(v) {
  return String(v || '').replace(/\D/g, '');
}

function garantirTabela(db, callback) {
  const cb = typeof callback === 'function' ? callback : () => {};
  db.run(`
    CREATE TABLE IF NOT EXISTS mie_aprendizado_fornecedor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fornecedor_cnpj TEXT NOT NULL,
      padrao_chave TEXT NOT NULL,
      unidade_comercial TEXT NOT NULL,
      quantidade_por_embalagem REAL DEFAULT 0,
      ocorrencias INTEGER DEFAULT 1,
      ultimo_xprod TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(fornecedor_cnpj, padrao_chave)
    )
  `, (err) => {
    if (err) return cb(err);
    cb(null);
  });
}

function montarPadraoChave(input = {}) {
  const uCom = normalizarUCom(input.uCom || input.unidade || '');
  const token = String(input.tokenUnidade || input.token || uCom || 'GEN')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 20);
  return `${token || 'GEN'}`;
}

function buscarAprendizado(db, fornecedorCnpj, padraoChave) {
  return new Promise((resolve, reject) => {
    const cnpj = digitsCnpj(fornecedorCnpj);
    if (!cnpj || !padraoChave) return resolve(null);
    garantirTabela(db, (err) => {
      if (err) return reject(err);
      db.get(
        `SELECT * FROM mie_aprendizado_fornecedor
         WHERE fornecedor_cnpj = ? AND padrao_chave = ?`,
        [cnpj, String(padraoChave).toUpperCase()],
        (getErr, row) => {
          if (getErr) return reject(getErr);
          resolve(row || null);
        }
      );
    });
  });
}

/**
 * Busca melhor aprendizado do fornecedor (maior ocorrencias) opcionalmente filtrando unidade.
 */
function buscarMelhorAprendizado(db, fornecedorCnpj, unidadePreferida) {
  return new Promise((resolve, reject) => {
    const cnpj = digitsCnpj(fornecedorCnpj);
    if (!cnpj) return resolve(null);
    garantirTabela(db, (err) => {
      if (err) return reject(err);
      const und = unidadePreferida ? normalizarUCom(unidadePreferida) : null;
      const sql = und
        ? `SELECT * FROM mie_aprendizado_fornecedor
           WHERE fornecedor_cnpj = ? AND unidade_comercial = ?
           ORDER BY ocorrencias DESC, updated_at DESC LIMIT 1`
        : `SELECT * FROM mie_aprendizado_fornecedor
           WHERE fornecedor_cnpj = ?
           ORDER BY ocorrencias DESC, updated_at DESC LIMIT 1`;
      const params = und ? [cnpj, und] : [cnpj];
      db.get(sql, params, (getErr, row) => {
        if (getErr) return reject(getErr);
        resolve(row || null);
      });
    });
  });
}

function registrarAprendizado(db, payload = {}) {
  return new Promise((resolve, reject) => {
    const cnpj = digitsCnpj(payload.fornecedor_cnpj || payload.fornecedorCnpj);
    const unidade = normalizarUCom(payload.unidade_comercial || payload.unidade);
    const qtd = Number(payload.quantidade_por_embalagem || 0) || 0;
    const padrao = String(payload.padrao_chave || montarPadraoChave({
      uCom: unidade,
      tokenUnidade: unidade
    })).toUpperCase();
    const xProd = String(payload.xProd || payload.produto_nome || '').slice(0, 200);

    if (!cnpj || !unidade) {
      return reject(new Error('CNPJ e unidade são obrigatórios para aprendizado MIE.'));
    }

    garantirTabela(db, (err) => {
      if (err) return reject(err);
      db.run(`
        INSERT INTO mie_aprendizado_fornecedor
          (fornecedor_cnpj, padrao_chave, unidade_comercial, quantidade_por_embalagem, ocorrencias, ultimo_xprod)
        VALUES (?, ?, ?, ?, 1, ?)
        ON CONFLICT(fornecedor_cnpj, padrao_chave) DO UPDATE SET
          unidade_comercial = excluded.unidade_comercial,
          quantidade_por_embalagem = CASE
            WHEN excluded.quantidade_por_embalagem > 0 THEN excluded.quantidade_por_embalagem
            ELSE mie_aprendizado_fornecedor.quantidade_por_embalagem
          END,
          ocorrencias = mie_aprendizado_fornecedor.ocorrencias + 1,
          ultimo_xprod = excluded.ultimo_xprod,
          updated_at = CURRENT_TIMESTAMP
      `, [cnpj, padrao, unidade, qtd, xProd || null], function (runErr) {
        if (runErr) return reject(runErr);
        resolve({ ok: true, id: this.lastID, padrao_chave: padrao });
      });
    });
  });
}

module.exports = {
  garantirTabela,
  montarPadraoChave,
  buscarAprendizado,
  buscarMelhorAprendizado,
  registrarAprendizado,
  digitsCnpj
};
