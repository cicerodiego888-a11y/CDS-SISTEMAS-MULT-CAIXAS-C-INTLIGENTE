/**
 * RC8.5.1 — Condições de pagamento reutilizáveis.
 * @module services/compras/CondicoesPagamentoService
 */

'use strict';

const {
  parsearDiasDoNomeCondicao
} = require('./MotorParcelamentoCompra');

const SEED_CONDICOES = [
  { nome: 'À Vista', tipo: 'avista', dias: [0], tem_entrada: 0 },
  { nome: '7 dias', tipo: 'prazo', dias: [7], tem_entrada: 0 },
  { nome: '14 dias', tipo: 'prazo', dias: [14], tem_entrada: 0 },
  { nome: '21 dias', tipo: 'prazo', dias: [21], tem_entrada: 0 },
  { nome: '28 dias', tipo: 'prazo', dias: [28], tem_entrada: 0 },
  { nome: '30 dias', tipo: 'prazo', dias: [30], tem_entrada: 0 },
  { nome: '30/60', tipo: 'prazo', dias: [30, 60], tem_entrada: 0 },
  { nome: '30/60/90', tipo: 'prazo', dias: [30, 60, 90], tem_entrada: 0 },
  { nome: '30/60/90/120', tipo: 'prazo', dias: [30, 60, 90, 120], tem_entrada: 0 },
  { nome: '15/30/45', tipo: 'prazo', dias: [15, 30, 45], tem_entrada: 0 },
  { nome: '15/45/75', tipo: 'prazo', dias: [15, 45, 75], tem_entrada: 0 },
  { nome: 'Entrada + 30', tipo: 'entrada', dias: [30], tem_entrada: 1 },
  { nome: 'Entrada + 30/60', tipo: 'entrada', dias: [30, 60], tem_entrada: 1 },
  { nome: 'Entrada + 30/60/90', tipo: 'entrada', dias: [30, 60, 90], tem_entrada: 1 },
  { nome: 'Personalizada', tipo: 'prazo', dias: [30], tem_entrada: 0 }
];

function serializarDias(dias) {
  return JSON.stringify(Array.isArray(dias) ? dias.map((d) => Number(d) || 0) : []);
}

function parsearDias(raw) {
  if (Array.isArray(raw)) return raw.map((d) => Number(d) || 0);
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map((d) => Number(d) || 0) : [];
  } catch (_e) {
    return [];
  }
}

function normalizarCondicaoRow(row) {
  if (!row) return null;
  const dias = parsearDias(row.dias_parcelas);
  return {
    id: row.id,
    nome: row.nome,
    tipo: row.tipo || 'prazo',
    dias_parcelas: dias,
    quantidade_parcelas: dias.length || 1,
    tem_entrada: Number(row.tem_entrada || 0) === 1 ? 1 : 0,
    ativo: Number(row.ativo ?? 1) === 1 ? 1 : 0,
    sistema: Number(row.sistema || 0) === 1 ? 1 : 0
  };
}

function garantirTabelaCondicoesPagamento(db, callback) {
  const cb = typeof callback === 'function' ? callback : () => {};
  db.run(`
    CREATE TABLE IF NOT EXISTS condicoes_pagamento (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      tipo TEXT DEFAULT 'prazo',
      dias_parcelas TEXT NOT NULL DEFAULT '[]',
      tem_entrada INTEGER DEFAULT 0,
      ativo INTEGER DEFAULT 1,
      sistema INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) return cb(err);
    seedCondicoesPadrao(db, cb);
  });
}

function seedCondicoesPadrao(db, callback) {
  const cb = typeof callback === 'function' ? callback : () => {};
  db.get('SELECT COUNT(*) AS total FROM condicoes_pagamento', (err, row) => {
    if (err) return cb(err);
    if (Number(row?.total || 0) > 0) return cb(null, { seeded: 0 });

    const stmt = db.prepare(`
      INSERT INTO condicoes_pagamento (nome, tipo, dias_parcelas, tem_entrada, ativo, sistema)
      VALUES (?, ?, ?, ?, 1, 1)
    `);
    let pending = SEED_CONDICOES.length;
    let seeded = 0;
    SEED_CONDICOES.forEach((c) => {
      stmt.run(c.nome, c.tipo, serializarDias(c.dias), c.tem_entrada, (insErr) => {
        if (!insErr) seeded += 1;
        pending -= 1;
        if (pending === 0) {
          stmt.finalize(() => cb(null, { seeded }));
        }
      });
    });
  });
}

function listarCondicoes(db, { apenasAtivas = true } = {}) {
  return new Promise((resolve, reject) => {
    const sql = apenasAtivas
      ? 'SELECT * FROM condicoes_pagamento WHERE ativo = 1 ORDER BY nome'
      : 'SELECT * FROM condicoes_pagamento ORDER BY nome';
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve((rows || []).map(normalizarCondicaoRow));
    });
  });
}

function obterCondicao(db, id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM condicoes_pagamento WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      resolve(normalizarCondicaoRow(row));
    });
  });
}

function salvarCondicao(db, payload = {}) {
  return new Promise((resolve, reject) => {
    const nome = String(payload.nome || '').trim();
    if (!nome) return reject(new Error('Informe o nome da condição.'));

    let dias = Array.isArray(payload.dias_parcelas) ? payload.dias_parcelas : parsearDias(payload.dias_parcelas);
    if (!dias.length) {
      const parsed = parsearDiasDoNomeCondicao(nome);
      dias = parsed.dias;
      if (!payload.tem_entrada && parsed.temEntrada) payload.tem_entrada = 1;
    }
    if (!dias.length) dias = [30];

    const tipo = String(payload.tipo || (Number(payload.tem_entrada) === 1 ? 'entrada' : 'prazo')).toLowerCase();
    const temEntrada = tipo === 'avista' ? 0 : (Number(payload.tem_entrada) === 1 ? 1 : 0);
    const ativo = payload.ativo === 0 || payload.ativo === false ? 0 : 1;
    const id = payload.id ? Number(payload.id) : null;

    if (id) {
      db.run(`
        UPDATE condicoes_pagamento
        SET nome = ?, tipo = ?, dias_parcelas = ?, tem_entrada = ?, ativo = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [nome, tipo, serializarDias(dias), temEntrada, ativo, id], function (err) {
        if (err) return reject(err);
        obterCondicao(db, id).then(resolve).catch(reject);
      });
      return;
    }

    db.run(`
      INSERT INTO condicoes_pagamento (nome, tipo, dias_parcelas, tem_entrada, ativo, sistema)
      VALUES (?, ?, ?, ?, ?, 0)
    `, [nome, tipo, serializarDias(dias), temEntrada, ativo], function (err) {
      if (err) return reject(err);
      obterCondicao(db, this.lastID).then(resolve).catch(reject);
    });
  });
}

function excluirCondicao(db, id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM condicoes_pagamento WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      if (!row) return reject(new Error('Condição não encontrada.'));
      if (Number(row.sistema) === 1) {
        return reject(new Error('Condições padrão do sistema não podem ser excluídas. Desative-as se necessário.'));
      }
      db.run('DELETE FROM condicoes_pagamento WHERE id = ?', [id], (delErr) => {
        if (delErr) return reject(delErr);
        resolve({ ok: true });
      });
    });
  });
}

module.exports = {
  SEED_CONDICOES,
  garantirTabelaCondicoesPagamento,
  seedCondicoesPadrao,
  listarCondicoes,
  obterCondicao,
  salvarCondicao,
  excluirCondicao,
  normalizarCondicaoRow,
  serializarDias,
  parsearDias
};
