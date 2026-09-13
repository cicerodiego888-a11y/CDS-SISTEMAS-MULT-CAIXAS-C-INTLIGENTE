/**
 * Normalização de nomes para cadastros simples (Smart Select).
 * Compatível com SQLite / PostgreSQL (lógica em JS).
 */

function normalizarNomeCadastroSimples(nome) {
  return String(nome || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function chaveNomeCadastroSimples(nome) {
  return normalizarNomeCadastroSimples(nome).toLocaleLowerCase('pt-BR');
}

function nomesCadastroEquivalentes(a, b) {
  return chaveNomeCadastroSimples(a) === chaveNomeCadastroSimples(b);
}

module.exports = {
  normalizarNomeCadastroSimples,
  chaveNomeCadastroSimples,
  nomesCadastroEquivalentes
};
