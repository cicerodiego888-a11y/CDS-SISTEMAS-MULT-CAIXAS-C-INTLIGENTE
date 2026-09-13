'use strict';

/**
 * Cadastro simples de fornecedor (Smart Select no produto).
 * Nome obrigatório; demais dados podem ser completados depois na tela de Fornecedores.
 */

const {
  normalizarNomeCadastroSimples,
  chaveNomeCadastroSimples
} = require('./cadastroSimplesNome');

function listarFornecedores(db) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM fornecedores ORDER BY nome COLLATE NOCASE`,
      [],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

function buscarFornecedorPorId(db, id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM fornecedores WHERE id = ?`,
      [id],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });
}

function chaveBuscaFornecedor(texto) {
  return chaveNomeCadastroSimples(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function filtrarFornecedoresPorTermo(lista, termo) {
  const q = chaveBuscaFornecedor(termo);
  const digits = String(termo || '').replace(/\D/g, '');
  if (!q && !digits) return lista || [];
  return (lista || []).filter((f) => {
    const nome = chaveBuscaFornecedor(f.nome);
    const razao = chaveBuscaFornecedor(f.razao_social);
    const doc = chaveBuscaFornecedor(f.cpf_cnpj);
    const docDigits = String(f.cpf_cnpj || '').replace(/\D/g, '');
    if (q && (nome.includes(q) || razao.includes(q) || doc.includes(q))) return true;
    if (digits && docDigits.includes(digits)) return true;
    return false;
  });
}

function encontrarFornecedorPorNomeNormalizado(lista, nomeNormalizado) {
  const chave = chaveNomeCadastroSimples(nomeNormalizado);
  return (lista || []).find((f) => chaveNomeCadastroSimples(f.nome) === chave) || null;
}

/**
 * @returns {Promise<{ fornecedor: Object, criado: boolean }>}
 */
async function findOrCreateFornecedor(db, nomeBruto, { auditar } = {}) {
  const nome = normalizarNomeCadastroSimples(nomeBruto);
  if (!nome) {
    const err = new Error('Nome é obrigatório');
    err.status = 400;
    throw err;
  }

  const lista = await listarFornecedores(db);
  const existente = encontrarFornecedorPorNomeNormalizado(lista, nome);
  if (existente) {
    return { fornecedor: existente, criado: false };
  }

  const insertedId = await new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO fornecedores (nome) VALUES (?)`,
      [nome],
      function onInsert(err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });

  const criado = await buscarFornecedorPorId(db, insertedId);
  if (typeof auditar === 'function') {
    auditar('criar_fornecedor', insertedId, { nome, origem: 'smart_select' });
  }
  return { fornecedor: criado, criado: true };
}

module.exports = {
  listarFornecedores,
  filtrarFornecedoresPorTermo,
  findOrCreateFornecedor,
  normalizarNomeCadastroSimples
};
