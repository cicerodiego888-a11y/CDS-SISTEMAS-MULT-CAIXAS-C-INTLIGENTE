/**
 * Resultado padronizado de validação do Motor Equipamentos.
 * @typedef {{ valido: boolean, erros: string[] }} ResultadoValidacao
 */

/**
 * Cria resultado de validação.
 * @param {string[]} erros
 * @returns {ResultadoValidacao}
 */
function criarResultado(erros = []) {
  const lista = Array.isArray(erros) ? erros.filter(Boolean) : [];
  return { valido: lista.length === 0, erros: lista };
}

module.exports = {
  criarResultado
};
