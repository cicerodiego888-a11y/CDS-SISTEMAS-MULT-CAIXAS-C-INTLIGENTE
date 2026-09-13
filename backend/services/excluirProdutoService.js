'use strict';

/**
 * Exclusão de produto no cadastro.
 * Com movimentação (venda, compra, ajuste, lote), só SUPER_ADMIN pode forçar.
 */

const { produtoTemMovimentacoes } = require('./ajusteEstoqueService');

const MSG_BLOQUEIO_MOVIMENTACAO =
  'Não é possível excluir este produto porque ele possui movimentação. Apenas o Super Administrador pode excluir.';

function usuarioEhSuperAdmin(usuario) {
  return String(usuario && usuario.perfil ? usuario.perfil : '')
    .trim()
    .toUpperCase() === 'SUPER_ADMIN';
}

function erroHttp(statusCode, message, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        if (/no such table/i.test(String(err.message || ''))) {
          return resolve(this);
        }
        return reject(err);
      }
      resolve(this);
    });
  });
}

function getProduto(db, produtoId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT id, nome, codigo FROM produtos WHERE id = ?',
      [produtoId],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });
}

function consultarMovimentacoes(db, produtoId) {
  return new Promise((resolve, reject) => {
    produtoTemMovimentacoes(db, produtoId, (err, tem) => {
      if (err) {
        if (/no such table/i.test(String(err.message || ''))) {
          return resolve(false);
        }
        return reject(err);
      }
      resolve(!!tem);
    });
  });
}

async function limparVinculosCatalogo(db, produtoId) {
  const id = Number(produtoId);
  const stmts = [
    'DELETE FROM venda_lotes WHERE produto_lote_id IN (SELECT id FROM produtos_lotes WHERE produto_id = ?)',
    'DELETE FROM venda_estoque_reservas WHERE produto_id = ?',
    'DELETE FROM pedido_estoque_reservas WHERE produto_id = ?',
    'DELETE FROM produto_atacado WHERE produto_id = ?',
    'DELETE FROM produto_identificadores WHERE produto_id = ?',
    'DELETE FROM produto_imagens WHERE produto_id = ?',
    'DELETE FROM produto_embalagens WHERE produto_id = ?',
    'DELETE FROM promocoes WHERE produto_id = ?',
    'DELETE FROM promocoes_sugestoes WHERE produto_id = ?',
    'DELETE FROM produtos_preco_historico WHERE produto_id = ?',
    'DELETE FROM produtos_lotes WHERE produto_id = ?'
  ];
  for (const sql of stmts) {
    await runSql(db, sql, [id]);
  }
}

function excluirLinhaProdutoForcandoFk(db, produtoId) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('PRAGMA foreign_keys = OFF', (offErr) => {
        if (offErr) return reject(offErr);
        db.run('DELETE FROM produtos WHERE id = ?', [produtoId], function onDelete(delErr) {
          db.run('PRAGMA foreign_keys = ON', () => {
            if (delErr) reject(delErr);
            else resolve(this);
          });
        });
      });
    });
  });
}

/**
 * @param {import('sqlite3').Database} db
 * @param {{ produtoId: number|string, usuario?: object }} opts
 */
async function excluirProdutoCadastro(db, opts = {}) {
  const produtoId = Number(opts.produtoId);
  if (!Number.isFinite(produtoId) || produtoId <= 0) {
    throw erroHttp(400, 'Produto inválido.');
  }

  const produto = await getProduto(db, produtoId);
  if (!produto) {
    throw erroHttp(404, 'Produto não encontrado.');
  }

  const temMovimentacao = await consultarMovimentacoes(db, produtoId);
  const superAdmin = usuarioEhSuperAdmin(opts.usuario);

  if (temMovimentacao && !superAdmin) {
    throw erroHttp(409, MSG_BLOQUEIO_MOVIMENTACAO, 'PRODUTO_COM_MOVIMENTACAO');
  }

  let forcado = false;
  if (temMovimentacao && superAdmin) {
    forcado = true;
    await limparVinculosCatalogo(db, produtoId);
    await excluirLinhaProdutoForcandoFk(db, produtoId);
  } else {
    try {
      const result = await runSql(db, 'DELETE FROM produtos WHERE id = ?', [produtoId]);
      if (!result || Number(result.changes) === 0) {
        throw erroHttp(404, 'Produto não encontrado.');
      }
    } catch (err) {
      if (err.statusCode) throw err;
      if (/FOREIGN KEY/i.test(String(err.message || ''))) {
        throw erroHttp(409, MSG_BLOQUEIO_MOVIMENTACAO, 'PRODUTO_COM_MOVIMENTACAO');
      }
      throw err;
    }
  }

  return {
    id: produtoId,
    nome: produto.nome,
    forcado,
    tem_movimentacao: temMovimentacao
  };
}

module.exports = {
  excluirProdutoCadastro,
  usuarioEhSuperAdmin,
  MSG_BLOQUEIO_MOVIMENTACAO
};
