'use strict';

const { categoriaEhAcougueOuHortifruti } = require('./categoriaPadroes');

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes || 0 });
    });
  });
}

async function obterCategoriasEspeciais(db, categoriaId) {
  const params = [];
  let filtro = '';
  if (categoriaId !== undefined && categoriaId !== null) {
    filtro = ' WHERE id = ?';
    params.push(categoriaId);
  }

  const categorias = await dbAll(db, `SELECT id, nome FROM categorias${filtro}`, params);
  return categorias.filter((categoria) => categoriaEhAcougueOuHortifruti(categoria.nome));
}

async function normalizarProdutosCategoriaEspecial(db, { categoriaId, produtoId } = {}) {
  const categorias = await obterCategoriasEspeciais(db, categoriaId);
  const ids = categorias.map((categoria) => Number(categoria.id)).filter(Number.isFinite);
  if (!ids.length) {
    return { categorias: [], produtosAlterados: 0 };
  }

  const placeholders = ids.map(() => '?').join(', ');
  const params = [...ids];
  let filtroProduto = '';
  if (produtoId !== undefined && produtoId !== null) {
    filtroProduto = ' AND id = ?';
    params.push(produtoId);
  }

  const result = await dbRun(
    db,
    `UPDATE produtos
     SET item_fiscal = 0, controla_estoque = 0
     WHERE categoria_id IN (${placeholders})${filtroProduto}
       AND (COALESCE(item_fiscal, 1) != 0 OR COALESCE(controla_estoque, 1) != 0)`,
    params
  );

  return { categorias: categorias.map(({ id, nome }) => ({ id, nome })), produtosAlterados: result.changes };
}

async function normalizarProdutoCategoriaEspecial(db, produtoId, categoriaId) {
  let categoriaEfetiva = categoriaId;
  if (categoriaEfetiva === undefined) {
    const rows = await dbAll(db, 'SELECT categoria_id FROM produtos WHERE id = ? LIMIT 1', [produtoId]);
    categoriaEfetiva = rows[0]?.categoria_id ?? null;
  }
  return normalizarProdutosCategoriaEspecial(db, { categoriaId: categoriaEfetiva, produtoId });
}

async function normalizarCategoriasEspeciaisLegadas(db) {
  return normalizarProdutosCategoriaEspecial(db);
}

module.exports = {
  normalizarProdutosCategoriaEspecial,
  normalizarProdutoCategoriaEspecial,
  normalizarCategoriasEspeciaisLegadas
};
