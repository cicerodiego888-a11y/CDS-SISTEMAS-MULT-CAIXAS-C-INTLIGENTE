/**
 * RC15.4 — Histórico de sincronização com a balança (auditoria).
 * Apenas registra eventos — não altera Motor Universal nem Driver.
 */

'use strict';

const db = require('../../../../../database');

const OPERACOES = Object.freeze({
  ENVIAR_PRODUTO: 'ENVIAR_PRODUTO',
  ENVIAR_LOTE: 'ENVIAR_LOTE',
  ENVIAR_TODOS: 'ENVIAR_TODOS'
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

let tabelaPronta = false;

async function garantirTabela() {
  if (tabelaPronta) return;
  await run(`
    CREATE TABLE IF NOT EXISTS produto_balanca_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER,
      equipamento_id INTEGER,
      plu TEXT,
      operacao TEXT,
      resultado TEXT,
      mensagem TEXT,
      tempo_ms INTEGER,
      usuario_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_pbs_log_produto ON produto_balanca_sync_log(produto_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_pbs_log_equipamento ON produto_balanca_sync_log(equipamento_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_pbs_log_created ON produto_balanca_sync_log(created_at)`);
  tabelaPronta = true;
}

/**
 * @param {object} entrada
 * @returns {Promise<number|null>} id do log
 */
async function registrar(entrada = {}) {
  try {
    await garantirTabela();
    const resultado = String(entrada.resultado || '').toUpperCase() === 'SUCESSO'
      ? 'SUCESSO'
      : (String(entrada.resultado || '').toUpperCase() === 'ERRO' ? 'ERRO' : String(entrada.resultado || 'ERRO'));
    const r = await run(`
      INSERT INTO produto_balanca_sync_log (
        produto_id, equipamento_id, plu, operacao, resultado, mensagem, tempo_ms, usuario_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      entrada.produto_id != null ? Number(entrada.produto_id) : null,
      entrada.equipamento_id != null ? Number(entrada.equipamento_id) : null,
      entrada.plu != null ? String(entrada.plu) : null,
      entrada.operacao != null ? String(entrada.operacao) : OPERACOES.ENVIAR_PRODUTO,
      resultado,
      entrada.mensagem != null ? String(entrada.mensagem) : null,
      entrada.tempo_ms != null ? Number(entrada.tempo_ms) : null,
      entrada.usuario_id != null ? Number(entrada.usuario_id) : null
    ]);
    return r.lastID || null;
  } catch (err) {
    console.warn('[RC15.4] Falha ao registrar produto_balanca_sync_log:', err.message);
    return null;
  }
}

/**
 * @param {object} filtros
 * @returns {Promise<object[]>}
 */
async function listar({ produto_id, equipamento_id, limite = 50 } = {}) {
  await garantirTabela();
  const params = [];
  const where = [];
  if (produto_id != null && Number.isFinite(Number(produto_id))) {
    where.push('l.produto_id = ?');
    params.push(Number(produto_id));
  }
  if (equipamento_id != null && Number.isFinite(Number(equipamento_id))) {
    where.push('l.equipamento_id = ?');
    params.push(Number(equipamento_id));
  }
  const lim = Math.max(1, Math.min(500, Number(limite) || 50));
  params.push(lim);
  return all(`
    SELECT
      l.*,
      p.nome AS produto_nome,
      e.nome AS equipamento_nome,
      e.modelo AS equipamento_modelo
    FROM produto_balanca_sync_log l
    LEFT JOIN produtos p ON p.id = l.produto_id
    LEFT JOIN equipamentos e ON e.id = l.equipamento_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY l.id DESC
    LIMIT ?
  `, params);
}

function resolverUsuarioId(req) {
  const u = req && req.user;
  if (!u) return null;
  const id = Number(u.id || u.usuario_id || u.userId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function resolverOperacaoLote(body = {}) {
  const op = String(body.operacao || body.operation || '').toUpperCase();
  if (op === OPERACOES.ENVIAR_TODOS || body.todos === true || body.enviar_todos === true) {
    return OPERACOES.ENVIAR_TODOS;
  }
  return OPERACOES.ENVIAR_LOTE;
}

module.exports = {
  OPERACOES,
  garantirTabela,
  registrar,
  listar,
  resolverUsuarioId,
  resolverOperacaoLote
};
