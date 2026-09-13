/**
 * SimilarityComparator — Compara dois SemanticProduct por atributos estruturados.
 *
 * Sprint 10 — nunca compara texto bruto; usa votação ponderada.
 *
 * @module motores/miip/utils/SimilarityComparator
 */

const SemanticProduct = require('../core/SemanticProduct');
const SimilarityVote = require('../core/SimilarityVote');
const SimilarityExplanation = require('../core/SimilarityExplanation');
const SimilarityStatistics = require('../core/SimilarityStatistics');
const SimilarityResult = require('../core/SimilarityResult');
const SimilarityWeights = require('./SimilarityWeights');

const ROTULOS_AMIGAVEIS = Object.freeze({
  marca: 'Marca',
  tipo: 'Tipo',
  tecnologia: 'Tecnologia',
  potencia: 'Potência',
  modelo: 'Modelo',
  unidadeMedida: 'Unidade',
  embalagem: 'Embalagem',
  quantidadeEmbalagem: 'Quantidade',
  material: 'Material',
  cor: 'Cor'
});

/**
 * @param {string|number|null} valor
 * @returns {string}
 */
function normalizarValor(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {SemanticProduct} produto
 * @param {string} valor
 * @returns {Set<string>}
 */
function coletarEquivalentes(produto, valor) {
  const base = normalizarValor(valor);
  const equivalentes = new Set([base]);

  if (!base) return equivalentes;

  (produto.relatedTokens ?? []).forEach((token) => {
    equivalentes.add(normalizarValor(token));
  });

  (produto.semanticAliases ?? []).forEach((alias) => {
    const partes = String(alias).split('=');
    if (partes.length !== 2) return;
    const esquerda = normalizarValor(partes[0]);
    const direita = normalizarValor(partes[1]);
    if (esquerda === base) equivalentes.add(direita);
    if (direita === base) equivalentes.add(esquerda);
  });

  (produto.synonyms ?? []).forEach((synonym) => {
    const original = normalizarValor(synonym.original ?? synonym.textoOriginal);
    const sinonimo = normalizarValor(synonym.sinonimo ?? synonym.textoCanonico);
    if (original === base) equivalentes.add(sinonimo);
    if (sinonimo === base) equivalentes.add(original);
  });

  return equivalentes;
}

/**
 * @param {string} valorA
 * @param {SemanticProduct} produtoA
 * @param {string} valorB
 * @param {SemanticProduct} produtoB
 * @returns {{ compativel: boolean, viaSinonimo: boolean }}
 */
function valoresCompativeis(valorA, produtoA, valorB, produtoB) {
  const a = normalizarValor(valorA);
  const b = normalizarValor(valorB);

  if (!a && !b) return { compativel: true, viaSinonimo: false };
  if (a === b) return { compativel: true, viaSinonimo: false };

  const equivA = coletarEquivalentes(produtoA, a);
  const equivB = coletarEquivalentes(produtoB, b);

  if (equivA.has(b) || equivB.has(a)) {
    return { compativel: true, viaSinonimo: true };
  }

  return { compativel: false, viaSinonimo: false };
}

/**
 * @param {number} score
 * @param {Object} limites
 * @returns {string}
 */
function calcularConfianca(score, limites) {
  if (score >= limites.alta) return 'ALTA';
  if (score >= limites.media) return 'MEDIA';
  if (score >= limites.baixa) return 'BAIXA';
  return 'NENHUMA';
}

/**
 * @param {string} atributo
 * @param {string|number} valorA
 * @param {string|number} valorB
 * @param {number} score
 * @param {boolean} viaSinonimo
 * @returns {string}
 */
function montarMotivo(atributo, valorA, valorB, score, viaSinonimo) {
  const rotulo = ROTULOS_AMIGAVEIS[atributo] ?? atributo;
  const a = normalizarValor(valorA);
  const b = normalizarValor(valorB);

  if (score === 100) {
    if (viaSinonimo) {
      return `${rotulo}: ${a} equivalente a ${b} (100%)`;
    }
    return `${rotulo}: ${a} = ${b} (100%)`;
  }

  if (!a && b) return `${rotulo}: ausente em A, presente em B (${b}) (0%)`;
  if (a && !b) return `${rotulo}: presente em A (${a}), ausente em B (0%)`;
  return `${rotulo}: ${a} diferente de ${b} (0%)`;
}

/**
 * Compara dois SemanticProduct e retorna SimilarityResult.
 *
 * @param {SemanticProduct|Object} produtoA
 * @param {SemanticProduct|Object} produtoB
 * @param {Object} [opcoes]
 * @param {Object} [opcoes.pesos]
 * @param {Object} [opcoes.confianca]
 * @returns {SimilarityResult}
 */
function comparar(produtoA, produtoB, opcoes = {}) {
  const inicio = Date.now();
  const a = produtoA instanceof SemanticProduct ? produtoA : SemanticProduct.create(produtoA);
  const b = produtoB instanceof SemanticProduct ? produtoB : SemanticProduct.create(produtoB);
  const config = SimilarityWeights.carregar();
  const pesos = opcoes.pesos ?? config.pesos;
  const limites = opcoes.confianca ?? config.confianca;

  const votes = [];
  const matchedAttributes = [];
  const differentAttributes = [];
  let pesoTotal = 0;
  let pontuacaoPonderada = 0;
  let quantidadeIguais = 0;
  let quantidadeDiferentes = 0;

  Object.entries(pesos).forEach(([atributo, peso]) => {
    const valorA = a[atributo];
    const valorB = b[atributo];
    const presenteA = valorA !== null && valorA !== undefined && valorA !== '';
    const presenteB = valorB !== null && valorB !== undefined && valorB !== '';

    if (!presenteA && !presenteB) return;

    let score = 0;
    let viaSinonimo = false;

    if (presenteA && presenteB) {
      const resultado = valoresCompativeis(valorA, a, valorB, b);
      score = resultado.compativel ? 100 : 0;
      viaSinonimo = resultado.viaSinonimo;
    }

    const vote = SimilarityVote.create({
      atributo,
      peso,
      score,
      motivo: montarMotivo(atributo, valorA, valorB, score, viaSinonimo)
    });

    votes.push(vote);
    pesoTotal += peso;
    pontuacaoPonderada += (peso * score) / 100;

    if (score === 100) {
      matchedAttributes.push(atributo);
      quantidadeIguais += 1;
    } else {
      differentAttributes.push(atributo);
      quantidadeDiferentes += 1;
    }
  });

  const scoreFinal = pesoTotal > 0
    ? Math.round((pontuacaoPonderada / pesoTotal) * 100)
    : 0;

  const linhasCompatíveis = matchedAttributes.map((atributo) => {
    const rotulo = ROTULOS_AMIGAVEIS[atributo] ?? atributo;
    return `${rotulo} compatível.`;
  });

  const linhasDiferentes = differentAttributes.map((atributo) => {
    const rotulo = ROTULOS_AMIGAVEIS[atributo] ?? atributo;
    return `${rotulo} diferente.`;
  });

  const linhas = [...linhasCompatíveis, ...linhasDiferentes];
  if (linhas.length === 0) {
    linhas.push('Nenhum atributo estruturado disponível para comparação.');
  }

  return SimilarityResult.create({
    score: scoreFinal,
    confidence: calcularConfianca(scoreFinal, limites),
    matchedAttributes,
    differentAttributes,
    votes,
    explicacao: SimilarityExplanation.fromLinhas(linhas),
    estatisticas: SimilarityStatistics.create({
      quantidadeAtributosComparados: votes.length,
      quantidadeIguais,
      quantidadeDiferentes,
      tempo: Date.now() - inicio
    })
  });
}

module.exports = {
  comparar,
  normalizarValor,
  coletarEquivalentes,
  valoresCompativeis,
  ROTULOS_AMIGAVEIS
};
