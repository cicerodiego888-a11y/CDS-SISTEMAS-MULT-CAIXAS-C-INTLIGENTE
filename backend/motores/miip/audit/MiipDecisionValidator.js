/**
 * MiipDecisionValidator — Valida fluxo decisório centralizado do MIIP.
 *
 * Sprint 13 — Calibração final.
 *
 * @module motores/miip/audit/MiipDecisionValidator
 */

const fs = require('fs');
const path = require('path');

const MIIP_ROOT = path.join(__dirname, '..');

const ENGINES_PATH = path.join(MIIP_ROOT, 'engines');

/**
 * @returns {string[]}
 */
function listarMotoresImplementacao() {
  const pastas = ['gtin', 'fornecedor', 'canonical', 'attributes', 'synonyms', 'similarity'];
  return pastas
    .map((pasta) => path.join(ENGINES_PATH, pasta))
    .filter((dir) => fs.existsSync(dir))
    .flatMap((dir) => fs.readdirSync(dir)
      .filter((f) => f.startsWith('Motor') && f.endsWith('.js'))
      .map((f) => path.join(dir, f)));
}

class MiipDecisionValidator {
  /**
   * @returns {Object}
   */
  validar() {
    const inicio = Date.now();
    const problemas = [];
    const avisos = [];

    const decisionBuilderPath = path.join(MIIP_ROOT, 'core/MiipDecisionBuilder.js');
    const decisionBuilder = fs.readFileSync(decisionBuilderPath, 'utf8');

    if (!decisionBuilder.includes('DecisionEngine')) {
      problemas.push({
        tipo: 'decision_builder_sem_decision_engine',
        arquivo: 'core/MiipDecisionBuilder.js',
        mensagem: 'MiipDecisionBuilder deve delegar ao DecisionEngine'
      });
    }

    if (/melhor\.scoreTotal\s*>=\s*95/.test(decisionBuilder)) {
      problemas.push({
        tipo: 'regras_duplicadas_decision_builder',
        arquivo: 'core/MiipDecisionBuilder.js',
        mensagem: 'Regras de score legadas ainda presentes no DecisionBuilder'
      });
    }

    const explainPath = path.join(MIIP_ROOT, 'core/MiipExplainService.js');
    if (!fs.existsSync(explainPath)) {
      problemas.push({
        tipo: 'explain_service_ausente',
        arquivo: 'core/MiipExplainService.js',
        mensagem: 'MiipExplainService é obrigatório'
      });
    }

    const importacaoPath = path.join(MIIP_ROOT, 'services/MiipImportacaoXmlService.js');
    const importacao = fs.readFileSync(importacaoPath, 'utf8');
    if (importacao.includes('_classificar')) {
      problemas.push({
        tipo: 'classificacao_duplicada_importacao_xml',
        arquivo: 'services/MiipImportacaoXmlService.js',
        mensagem: 'Lógica de decisão duplicada — deve usar DecisionEngine via Pipeline'
      });
    }

    if (!importacao.includes('mapearDecisaoPipelineParaImportacao')) {
      avisos.push({
        tipo: 'importacao_sem_mapper_decisao',
        arquivo: 'services/MiipImportacaoXmlService.js',
        mensagem: 'Importação XML deve mapear decisão do Pipeline sem reclassificar'
      });
    }

    listarMotoresImplementacao().forEach((arquivo) => {
      const relativo = path.relative(MIIP_ROOT, arquivo).replace(/\\/g, '/');
      const conteudo = fs.readFileSync(arquivo, 'utf8');

      if (/MiipAction\.(AUTO_VINCULAR|CRIAR_NOVO|SUGERIR)/.test(conteudo)) {
        problemas.push({
          tipo: 'engine_toma_decisao',
          arquivo: relativo,
          mensagem: 'Engine não deve retornar ações de decisão'
        });
      }

      if (/DecisionEngine/.test(conteudo) && !relativo.includes('similarity')) {
        problemas.push({
          tipo: 'engine_usa_decision_engine',
          arquivo: relativo,
          mensagem: 'Apenas DecisionEngine central deve decidir'
        });
      }
    });

    const adapterPath = path.join(MIIP_ROOT, 'utils/MiipDecisionAdapter.js');
    if (!fs.existsSync(adapterPath)) {
      avisos.push({
        tipo: 'adapter_ausente',
        arquivo: 'utils/MiipDecisionAdapter.js',
        mensagem: 'Adapter de decisão recomendado para integração legada'
      });
    }

    const aprovado = problemas.length === 0;

    return {
      aprovado,
      problemas,
      avisos,
      decisionEngineCentralizado: decisionBuilder.includes('DecisionEngine'),
      explainServicePresente: fs.existsSync(explainPath),
      tempo: Date.now() - inicio
    };
  }
}

module.exports = MiipDecisionValidator;
