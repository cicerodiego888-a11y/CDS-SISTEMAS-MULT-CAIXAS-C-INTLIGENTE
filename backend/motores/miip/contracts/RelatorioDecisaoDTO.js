/**
 * RelatorioDecisaoDTO — Saída completa de uma operação de identificação.
 *
 * Contrato retornado por MiipService.identificar() e MiipOrchestrator.executar().
 *
 * @class RelatorioDecisaoDTO
 *
 * @property {string} operacaoId - UUID da operação (para feedback)
 * @property {import('./ProdutoCandidatoDTO')[]} candidatos - Candidatos ranqueados
 * @property {import('./DecisaoIdentificacaoDTO')} decisao - Decisão e confiança
 * @property {import('../core/MiipScore')} score - Score consolidado
 * @property {string[]} enginesExecutados - Engines que participaram do pipeline
 * @property {number} duracaoTotalMs - Tempo total da operação em ms
 */

class RelatorioDecisaoDTO {}

module.exports = RelatorioDecisaoDTO;
