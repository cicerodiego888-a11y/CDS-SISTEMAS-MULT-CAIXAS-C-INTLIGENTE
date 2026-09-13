/**
 * DecisaoIdentificacaoDTO — Decisão recomendada após avaliação de confiança.
 *
 * @class DecisaoIdentificacaoDTO
 *
 * @property {import('../core/MiipAction')} acao - Ação recomendada
 * @property {import('../core/MiipConfidence')} confianca - Nível de confiança
 * @property {import('./ProdutoCandidatoDTO')|null} melhorCandidato - Top 1 candidato
 * @property {boolean} conflito - Indica conflito entre engines de alta precisão
 */

class DecisaoIdentificacaoDTO {}

module.exports = DecisaoIdentificacaoDTO;
