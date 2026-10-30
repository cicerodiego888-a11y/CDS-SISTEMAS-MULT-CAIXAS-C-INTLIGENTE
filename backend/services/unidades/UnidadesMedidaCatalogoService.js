/**
 * CE-MUC-03 — Catálogo extensível de unidades de medida.
 * Não confirma conversões; o MUC permanece o motor único.
 *
 * @module services/unidades/UnidadesMedidaCatalogoService
 */

'use strict';

const MotorUnidadesMedida = require('./MotorUnidadesMedida');

const DDL = `
CREATE TABLE IF NOT EXISTS unidades_medida (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE COLLATE NOCASE,
  descricao TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'ambos',
  sistema INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function normalizarCodigo(codigo) {
  return String(codigo || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
}

function normalizarDescricao(descricao) {
  return String(descricao || '').trim().replace(/\s+/g, ' ');
}

function normalizarTipo(tipo) {
  const t = String(tipo || 'ambos').trim().toLowerCase();
  if (t === 'estoque' || t === 'comercial' || t === 'ambos') return t;
  return 'ambos';
}

async function ensureSchema(db) {
  await run(db, DDL);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_unidades_medida_ativo ON unidades_medida(ativo)`);
  return seedPadrao(db);
}

async function seedPadrao(db) {
  const seeds = MotorUnidadesMedida.listarUnidadesComerciais();
  for (const u of seeds) {
    const codigo = normalizarCodigo(u.codigo);
    if (!codigo) continue;
    const existente = await get(db, 'SELECT id FROM unidades_medida WHERE codigo = ? COLLATE NOCASE', [codigo]);
    if (existente) continue;
    await run(
      db,
      `INSERT INTO unidades_medida (codigo, descricao, tipo, sistema, ativo)
       VALUES (?, ?, 'ambos', 1, 1)`,
      [codigo, normalizarDescricao(u.label || codigo)]
    );
  }
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    codigo: row.codigo,
    descricao: row.descricao,
    tipo: row.tipo,
    sistema: Number(row.sistema) === 1,
    ativo: Number(row.ativo) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function listar(db, { incluirInativas = false, termo = '' } = {}) {
  await ensureSchema(db);
  const rows = await all(
    db,
    `SELECT * FROM unidades_medida
     ${incluirInativas ? '' : 'WHERE ativo = 1'}
     ORDER BY codigo COLLATE NOCASE`
  );
  const q = String(termo || '').trim().toUpperCase();
  return rows
    .map(mapRow)
    .filter((u) => {
      if (!q) return true;
      return u.codigo.includes(q) || String(u.descricao || '').toUpperCase().includes(q);
    });
}

async function obterPorId(db, id) {
  await ensureSchema(db);
  return mapRow(await get(db, 'SELECT * FROM unidades_medida WHERE id = ?', [Number(id)]));
}

async function obterPorCodigo(db, codigo) {
  await ensureSchema(db);
  return mapRow(await get(
    db,
    'SELECT * FROM unidades_medida WHERE codigo = ? COLLATE NOCASE',
    [normalizarCodigo(codigo)]
  ));
}

async function criar(db, dados = {}) {
  await ensureSchema(db);
  const codigo = normalizarCodigo(dados.codigo);
  const descricao = normalizarDescricao(dados.descricao);
  const tipo = normalizarTipo(dados.tipo);
  if (!codigo || !/^[A-Z0-9]{1,12}$/.test(codigo)) {
    const err = new Error('Informe um código de unidade válido (1–12 caracteres alfanuméricos).');
    err.statusCode = 400;
    throw err;
  }
  if (!descricao) {
    const err = new Error('Informe a descrição da unidade.');
    err.statusCode = 400;
    throw err;
  }
  const duplicado = await obterPorCodigo(db, codigo);
  if (duplicado) {
    const err = new Error(`Já existe a unidade "${duplicado.codigo}".`);
    err.statusCode = 409;
    err.code = 'UNIDADE_DUPLICADA';
    throw err;
  }
  const result = await run(
    db,
    `INSERT INTO unidades_medida (codigo, descricao, tipo, sistema, ativo)
     VALUES (?, ?, ?, 0, 1)`,
    [codigo, descricao, tipo]
  );
  return obterPorId(db, result.lastID);
}

async function atualizar(db, id, dados = {}) {
  await ensureSchema(db);
  const atual = await obterPorId(db, id);
  if (!atual) {
    const err = new Error('Unidade não encontrada.');
    err.statusCode = 404;
    throw err;
  }
  const codigo = dados.codigo != null ? normalizarCodigo(dados.codigo) : atual.codigo;
  const descricao = dados.descricao != null ? normalizarDescricao(dados.descricao) : atual.descricao;
  const tipo = dados.tipo != null ? normalizarTipo(dados.tipo) : atual.tipo;
  const ativo = dados.ativo != null ? (dados.ativo ? 1 : 0) : (atual.ativo ? 1 : 0);

  if (!codigo || !/^[A-Z0-9]{1,12}$/.test(codigo)) {
    const err = new Error('Informe um código de unidade válido (1–12 caracteres alfanuméricos).');
    err.statusCode = 400;
    throw err;
  }
  if (!descricao) {
    const err = new Error('Informe a descrição da unidade.');
    err.statusCode = 400;
    throw err;
  }
  if (atual.sistema && codigo !== atual.codigo) {
    const err = new Error('Não é permitido alterar o código de uma unidade de sistema.');
    err.statusCode = 422;
    throw err;
  }
  const outro = await obterPorCodigo(db, codigo);
  if (outro && Number(outro.id) !== Number(atual.id)) {
    const err = new Error(`Já existe a unidade "${outro.codigo}".`);
    err.statusCode = 409;
    err.code = 'UNIDADE_DUPLICADA';
    throw err;
  }
  await run(
    db,
    `UPDATE unidades_medida
     SET codigo = ?, descricao = ?, tipo = ?, ativo = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [codigo, descricao, tipo, ativo, Number(id)]
  );
  return obterPorId(db, id);
}

/**
 * Conta referências em produtos / embalagens. Conversões em JSON de documentos
 * não são varridas aqui (custo alto); exclusão hard só com zero refs estruturais.
 */
async function contarReferencias(db, codigo) {
  const cod = normalizarCodigo(codigo);
  const refs = {
    produtos_unidade: 0,
    produtos_unidade_comercial: 0,
    produto_embalagens: 0
  };
  try {
    const a = await get(db, 'SELECT COUNT(*) AS c FROM produtos WHERE UPPER(TRIM(unidade)) = ?', [cod]);
    refs.produtos_unidade = Number(a?.c || 0);
  } catch { /* tabela/coluna ausente em DB de teste mínimo */ }
  try {
    const b = await get(
      db,
      'SELECT COUNT(*) AS c FROM produtos WHERE UPPER(TRIM(unidade_comercial)) = ?',
      [cod]
    );
    refs.produtos_unidade_comercial = Number(b?.c || 0);
  } catch { /* ignore */ }
  try {
    const c = await get(
      db,
      `SELECT COUNT(*) AS c FROM produto_embalagens
       WHERE UPPER(TRIM(COALESCE(tipo, ''))) = ?
          OR UPPER(TRIM(COALESCE(unidade, ''))) = ?
          OR UPPER(TRIM(COALESCE(unidade_comercial, ''))) = ?`,
      [cod, cod, cod]
    );
    refs.produto_embalagens = Number(c?.c || 0);
  } catch { /* ignore */ }
  refs.total = refs.produtos_unidade + refs.produtos_unidade_comercial + refs.produto_embalagens;
  return refs;
}

async function excluir(db, id) {
  await ensureSchema(db);
  const atual = await obterPorId(db, id);
  if (!atual) {
    const err = new Error('Unidade não encontrada.');
    err.statusCode = 404;
    throw err;
  }
  if (atual.sistema) {
    const err = new Error('Unidades de sistema não podem ser excluídas. Desative-as se necessário.');
    err.statusCode = 422;
    err.code = 'UNIDADE_SISTEMA';
    throw err;
  }
  const refs = await contarReferencias(db, atual.codigo);
  if (refs.total > 0) {
    const err = new Error(
      `A unidade ${atual.codigo} está em uso (${refs.total} referência(s)) e não pode ser excluída.`
    );
    err.statusCode = 422;
    err.code = 'UNIDADE_EM_USO';
    err.referencias = refs;
    throw err;
  }
  await run(db, 'DELETE FROM unidades_medida WHERE id = ?', [Number(id)]);
  return { sucesso: true, id: Number(id), codigo: atual.codigo };
}

/** Opções para selects (estoque/comercial), mesclando catálogo + seed estático. */
async function listarParaSelect(db, { tipo = null } = {}) {
  const rows = await listar(db, { incluirInativas: false });
  const mapa = new Map();
  for (const u of MotorUnidadesMedida.listarUnidadesComerciais()) {
    mapa.set(u.codigo, { codigo: u.codigo, descricao: u.label, origem: 'muc_static' });
  }
  for (const u of rows) {
    if (tipo && u.tipo !== 'ambos' && u.tipo !== tipo) continue;
    mapa.set(u.codigo, { codigo: u.codigo, descricao: u.descricao, origem: 'catalogo', id: u.id });
  }
  return [...mapa.values()].sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'));
}

module.exports = {
  ensureSchema,
  seedPadrao,
  listar,
  obterPorId,
  obterPorCodigo,
  criar,
  atualizar,
  excluir,
  contarReferencias,
  listarParaSelect,
  normalizarCodigo,
  DDL
};
