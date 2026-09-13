/**
 * MiipPerformanceReport — Relatório de performance das suítes MIIP.
 *
 * Sprint 13 — Calibração final.
 *
 * @module motores/miip/audit/MiipPerformanceReport
 */

const { spawnSync } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '../../../..');

const SUITES_MIIP = Object.freeze([
  { nome: 'test:miip-gtin', script: 'tests/miip/motor-gtin.test.js' },
  { nome: 'test:miip-gtin-pipeline', script: 'tests/miip/miip-gtin-pipeline.test.js' },
  { nome: 'test:miip-associacao-fornecedor', script: 'tests/miip/motor-associacao-fornecedor.test.js' },
  { nome: 'test:miip-fornecedor-pipeline', script: 'tests/miip/miip-fornecedor-pipeline.test.js' },
  { nome: 'test:miip-learning', script: 'tests/miip/miip-learning-service.test.js' },
  { nome: 'test:miip-integracao', script: 'tests/miip/miip-service-integracao.test.js' },
  { nome: 'test:miip-pipeline', script: 'tests/miip/miip-pipeline.test.js' },
  { nome: 'test:miip-importacao-xml', script: 'tests/miip/miip-importacao-xml.test.js' },
  { nome: 'test:miip-central-revisao', script: 'tests/miip/miip-central-revisao.test.js' },
  { nome: 'test:miip-canonical', script: 'tests/miip/motor-canonical.test.js' },
  { nome: 'test:miip-semantico', script: 'tests/miip/modelo-semantico.test.js' },
  { nome: 'test:miip-attribute', script: 'tests/miip/motor-attribute.test.js' },
  { nome: 'test:miip-synonyms', script: 'tests/miip/motor-synonyms.test.js' },
  { nome: 'test:miip-similarity', script: 'tests/miip/motor-similarity.test.js' },
  { nome: 'test:miip-decision', script: 'tests/miip/decision-engine.test.js' },
  { nome: 'test:miip-explain', script: 'tests/miip/miip-explain.test.js' },
  { nome: 'test:miip-readiness', script: 'tests/miip/miip-readiness.test.js' },
  { nome: 'test:miip-telemetry', script: 'tests/miip/miip-telemetry.test.js' },
  { nome: 'test:miip-paridade', script: 'tests/miip/miip-paridade.test.js' }
]);

/**
 * @param {string} output
 * @returns {{ passou: number, falhou: number }}
 */
function extrairContagem(output) {
  const match = output.match(/(\d+)\s+passou,\s*(\d+)\s+falhou/);
  if (match) {
    return { passou: Number(match[1]), falhou: Number(match[2]) };
  }
  const okCount = (output.match(/\s+OK\s+/g) || []).length;
  return { passou: okCount, falhou: output.includes('FALHOU') ? 1 : 0 };
}

class MiipPerformanceReport {
  /**
   * @param {Object} [opcoes]
   * @param {boolean} [opcoes.executarSuites]
   * @param {string[]} [opcoes.excluir]
   */
  constructor(opcoes = {}) {
    this._executarSuites = opcoes.executarSuites !== false;
    this._excluir = new Set(opcoes.excluir ?? ['test:miip-readiness']);
  }

  /**
   * @returns {Object}
   */
  gerar() {
    const inicio = Date.now();
    const suites = [];

    if (!this._executarSuites) {
      return {
        suites,
        totalSuites: SUITES_MIIP.length,
        suitesPassaram: 0,
        suitesFalharam: 0,
        casosPassaram: 0,
        casosFalharam: 0,
        tempoTotal: 0,
        executado: false
      };
    }

    SUITES_MIIP.forEach((suite) => {
      if (this._excluir.has(suite.nome)) return;

      const suiteInicio = Date.now();
      const resultado = spawnSync('node', [suite.script], {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        timeout: 120000,
        shell: false
      });

      const output = `${resultado.stdout ?? ''}${resultado.stderr ?? ''}`;
      const contagem = extrairContagem(output);
      const sucesso = resultado.status === 0;

      suites.push({
        nome: suite.nome,
        script: suite.script,
        sucesso,
        exitCode: resultado.status ?? 1,
        passou: contagem.passou,
        falhou: contagem.falhou,
        tempo: Date.now() - suiteInicio
      });
    });

    const suitesPassaram = suites.filter((s) => s.sucesso).length;
    const suitesFalharam = suites.filter((s) => !s.sucesso).length;
    const casosPassaram = suites.reduce((acc, s) => acc + s.passou, 0);
    const casosFalharam = suites.reduce((acc, s) => acc + s.falhou, 0);

    return {
      suites,
      totalSuites: suites.length,
      suitesPassaram,
      suitesFalharam,
      casosPassaram,
      casosFalharam,
      tempoTotal: Date.now() - inicio,
      executado: true
    };
  }
}

module.exports = MiipPerformanceReport;
module.exports.SUITES_MIIP = SUITES_MIIP;
