/**
 * Serviço de marcas — find-or-create para Smart Select (UX/INFRA 05).
 * Reutiliza a tabela marcas; não altera o contrato POST /marcas existente.
 */

const {
  normalizarNomeCadastroSimples,
  chaveNomeCadastroSimples
} = require('./cadastroSimplesNome');

function listarMarcasAtivas(db) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM marcas WHERE COALESCE(ativo, 1) = 1 ORDER BY nome COLLATE NOCASE`,
      [],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

function buscarMarcaPorId(db, id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM marcas WHERE id = ?`, [id], (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function encontrarMarcaPorNomeNormalizado(lista, nomeNormalizado) {
  const chave = chaveNomeCadastroSimples(nomeNormalizado);
  return (lista || []).find((m) => chaveNomeCadastroSimples(m.nome) === chave) || null;
}

function filtrarMarcasPorTermo(lista, termo) {
  const q = chaveNomeCadastroSimples(termo);
  if (!q) return lista || [];
  return (lista || []).filter((m) => chaveNomeCadastroSimples(m.nome).includes(q));
}

/**
 * @returns {Promise<{ marca: Object, criado: boolean, reativado: boolean }>}
 */
async function findOrCreateMarca(db, nomeBruto, { auditar } = {}) {
  const nome = normalizarNomeCadastroSimples(nomeBruto);
  if (!nome) {
    const err = new Error('Nome é obrigatório');
    err.status = 400;
    throw err;
  }

  const ativas = await listarMarcasAtivas(db);
  const existenteAtiva = encontrarMarcaPorNomeNormalizado(ativas, nome);
  if (existenteAtiva) {
    return { marca: existenteAtiva, criado: false, reativado: false };
  }

  // Inclui inativas para possível reativação
  const todas = await new Promise((resolve, reject) => {
    db.all(`SELECT * FROM marcas`, [], (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
  const existenteQualquer = encontrarMarcaPorNomeNormalizado(todas, nome);
  if (existenteQualquer) {
    if (Number(existenteQualquer.ativo) === 0) {
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE marcas SET ativo = 1, nome = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
          [nome, existenteQualquer.id],
          function (err) {
            if (err) return reject(err);
            resolve();
          }
        );
      });
      const reativada = await buscarMarcaPorId(db, existenteQualquer.id);
      if (typeof auditar === 'function') {
        auditar('reativar_marca', existenteQualquer.id, { nome });
      }
      return { marca: reativada, criado: false, reativado: true };
    }
    return { marca: existenteQualquer, criado: false, reativado: false };
  }

  const insertedId = await new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO marcas (nome, ativo, created_at, updated_at)
       VALUES (?, 1, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
      [nome],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });

  const criada = await buscarMarcaPorId(db, insertedId);
  if (typeof auditar === 'function') {
    auditar('criar_marca', insertedId, { nome, origem: 'smart_select' });
  }
  return { marca: criada, criado: true, reativado: false };
}

module.exports = {
  listarMarcasAtivas,
  filtrarMarcasPorTermo,
  encontrarMarcaPorNomeNormalizado,
  findOrCreateMarca,
  normalizarNomeCadastroSimples,
  chaveNomeCadastroSimples
};
