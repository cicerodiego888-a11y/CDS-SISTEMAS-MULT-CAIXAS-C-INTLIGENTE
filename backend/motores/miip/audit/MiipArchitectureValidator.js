/**
 * MiipArchitectureValidator — Valida arquitetura e responsabilidades do MIIP.
 *
 * Sprint 13 — Calibração final.
 *
 * @module motores/miip/audit/MiipArchitectureValidator
 */

const fs = require('fs');
const path = require('path');

const MIIP_ROOT = path.join(__dirname, '..');

const ENGINES_INTELIGENCIA = Object.freeze([
  'engines/canonical/MotorCanonical.js',
  'engines/attributes/MotorAttributeExtractor.js',
  'engines/synonyms/MotorSynonyms.js',
  'engines/similarity/MotorSimilarity.js'
]);

const ENGINES_IDENTIFICACAO = Object.freeze([
  'engines/gtin/MotorGTIN.js',
  'engines/fornecedor/MotorAssociacaoFornecedor.js',
  'engines/mubc/MotorUniversalBuscaCandidatos.js'
]);

const PADROES_SQL_PROIBIDOS = [
  /SELECT\s+[\w*]/i,
  /INSERT\s+INTO/i,
  /UPDATE\s+\w+/i,
  /DELETE\s+FROM/i,
  /require\(['"]\.\.\/\.\.\/\.\.\/database['"]\)/,
  /require\(['"]\.\.\/\.\.\/database['"]\)/
];

const PADROES_DECISAO_PROIBIDOS = [
  /MiipAction\.AUTO_VINCULAR/,
  /DecisionAction\.AUTO_ASSOCIAR/,
  /acao:\s*MiipAction/,
  /acao:\s*DecisionAction/
];

const PADROES_ERP_PROIBIDOS = [
  /UPDATE\s+produtos/i,
  /INSERT\s+INTO\s+produtos/i,
  /\.salvarProduto\(/i,
  /ProdutoService\.(criar|atualizar|salvar)/i
];

const ARQUIVOS_CONFIG_OBRIGATORIOS = [
  'config/decision-rules.json',
  'config/similarity-weights.json',
  'config/miip.defaults.json'
];

/**
 * @param {string} relativo
 * @returns {string}
 */
function resolverArquivo(relativo) {
  return path.join(MIIP_ROOT, relativo);
}

/**
 * @param {string} relativo
 * @returns {string}
 */
function lerArquivo(relativo) {
  return fs.readFileSync(resolverArquivo(relativo), 'utf8');
}

/**
 * @param {string[]} arquivos
 * @param {RegExp[]} padroes
 * @param {string} tipo
 * @returns {Object[]}
 */
function verificarPadroes(arquivos, padroes, tipo) {
  const violacoes = [];

  arquivos.forEach((relativo) => {
    const conteudo = lerArquivo(relativo);
    padroes.forEach((padrao) => {
      if (padrao.test(conteudo)) {
        violacoes.push({
          tipo,
          arquivo: relativo,
          padrao: String(padrao)
        });
      }
    });
  });

  return violacoes;
}

class MiipArchitectureValidator {
  /**
   * @returns {Object}
   */
  validar() {
    const inicio = Date.now();
    const violacoes = [];

    violacoes.push(...verificarPadroes(
      ENGINES_INTELIGENCIA,
      PADROES_SQL_PROIBIDOS,
      'sql_em_engine_inteligencia'
    ));

    violacoes.push(...verificarPadroes(
      ENGINES_INTELIGENCIA,
      PADROES_DECISAO_PROIBIDOS,
      'decisao_em_engine_inteligencia'
    ));

    violacoes.push(...verificarPadroes(
      [...ENGINES_INTELIGENCIA, ...ENGINES_IDENTIFICACAO],
      PADROES_ERP_PROIBIDOS,
      'erp_em_engine'
    ));

    violacoes.push(...verificarPadroes(
      ENGINES_IDENTIFICACAO,
      PADROES_DECISAO_PROIBIDOS,
      'decisao_em_engine_identificacao'
    ));

    const sqlDiretoIdentificacao = verificarPadroes(
      ENGINES_IDENTIFICACAO,
      [/SELECT\s+[\w*]/i, /INSERT\s+INTO/i],
      'sql_direto_engine_identificacao'
    );
    violacoes.push(...sqlDiretoIdentificacao);

    const configsAusentes = ARQUIVOS_CONFIG_OBRIGATORIOS.filter(
      (rel) => !fs.existsSync(resolverArquivo(rel))
    );

    const componentesObrigatorios = [
      'core/DecisionEngine.js',
      'core/MiipExplainService.js',
      'core/MiipExplanation.js',
      'audit/MiipAuditService.js'
    ];

    const componentesAusentes = componentesObrigatorios.filter(
      (rel) => !fs.existsSync(resolverArquivo(rel))
    );

    const aprovado = violacoes.length === 0
      && configsAusentes.length === 0
      && componentesAusentes.length === 0;

    return {
      aprovado,
      violacoes,
      configsAusentes,
      componentesAusentes,
      enginesInteligencia: ENGINES_INTELIGENCIA.length,
      enginesIdentificacao: ENGINES_IDENTIFICACAO.length,
      tempo: Date.now() - inicio
    };
  }
}

module.exports = MiipArchitectureValidator;
module.exports.ENGINES_INTELIGENCIA = ENGINES_INTELIGENCIA;
module.exports.ENGINES_IDENTIFICACAO = ENGINES_IDENTIFICACAO;
