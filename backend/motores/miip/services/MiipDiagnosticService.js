/**
 * MiipDiagnosticService — Diagnóstico completo do MIIP V1.
 *
 * Sprint 14 — Observabilidade e Telemetria.
 *
 * @class MiipDiagnosticService
 * @module motores/miip/services/MiipDiagnosticService
 */

const fs = require('fs');
const path = require('path');
const MiipHealthStatus = require('../core/MiipHealthStatus');
const MotorRegistry = require('../core/MotorRegistry');
const MiipArchitectureValidator = require('../audit/MiipArchitectureValidator');
const MiipDecisionValidator = require('../audit/MiipDecisionValidator');
const MiipMonitoringService = require('./MiipMonitoringService');

const MIIP_ROOT = path.join(__dirname, '..');

const REPOSITORIES_OBRIGATORIOS = [
  'repositories/ProdutoRepository.js',
  'repositories/MiipAssociacoesRepository.js'
];

const ENGINES_OBRIGATORIOS = [
  'engines/gtin/MotorGTIN.js',
  'engines/fornecedor/MotorAssociacaoFornecedor.js',
  'engines/mubc/MotorUniversalBuscaCandidatos.js',
  'engines/canonical/MotorCanonical.js',
  'engines/attributes/MotorAttributeExtractor.js',
  'engines/synonyms/MotorSynonyms.js',
  'engines/similarity/MotorSimilarity.js'
];

class MiipDiagnosticService {
  /**
   * @param {Object} [deps]
   * @param {MiipMonitoringService} [deps.monitoringService]
   * @param {import('../core/MotorRegistry')} [deps.motorRegistry]
   */
  constructor(deps = {}) {
    this._monitoring = deps.monitoringService ?? new MiipMonitoringService();
    this._registry = deps.motorRegistry ?? MotorRegistry;
    this._architectureValidator = new MiipArchitectureValidator();
    this._decisionValidator = new MiipDecisionValidator();
  }

  /**
   * Executa diagnóstico completo.
   *
   * @returns {Object}
   */
  executar() {
    const inicio = Date.now();
    const estrutural = this._validarEstrutural();
    const configuracao = this._validarConfiguracao();
    const engines = this._validarEngines();
    const repositories = this._validarRepositories();
    const monitoramento = this._monitoring.analisar();

    const status = MiipHealthStatus.consolidar(
      estrutural.status,
      configuracao.status,
      engines.status,
      repositories.status,
      monitoramento.status
    );

    return {
      status,
      versao: '1.0.0',
      saudavel: status === MiipHealthStatus.OK,
      estrutural,
      configuracao,
      engines,
      repositories,
      monitoramento,
      tempo: Date.now() - inicio,
      verificadoEm: new Date().toISOString()
    };
  }

  /**
   * @returns {Object}
   */
  healthCheck() {
    const diagnostico = this.executar();
    return {
      status: diagnostico.status,
      saudavel: diagnostico.saudavel,
      versao: diagnostico.versao,
      verificadoEm: diagnostico.verificadoEm,
      resumo: {
        estrutural: diagnostico.estrutural.aprovado,
        configuracao: diagnostico.configuracao.aprovado,
        engines: diagnostico.engines.aprovado,
        repositories: diagnostico.repositories.aprovado
      }
    };
  }

  /**
   * @private
   * @returns {Object}
   */
  _validarEstrutural() {
    const arquitetura = this._architectureValidator.validar();
    const decisao = this._decisionValidator.validar();
    const aprovado = arquitetura.aprovado && decisao.aprovado;

    return {
      aprovado,
      status: aprovado ? MiipHealthStatus.OK : MiipHealthStatus.ERROR,
      arquitetura,
      decisao
    };
  }

  /**
   * @private
   * @returns {Object}
   */
  _validarConfiguracao() {
    const monitoramento = this._monitoring.analisar();
    const falhas = monitoramento.falhasConfiguracao ?? [];

    return {
      aprovado: falhas.length === 0,
      status: falhas.length === 0 ? MiipHealthStatus.OK : MiipHealthStatus.ERROR,
      falhas
    };
  }

  /**
   * @private
   * @returns {Object}
   */
  _validarEngines() {
    const ausentes = ENGINES_OBRIGATORIOS.filter(
      (rel) => !fs.existsSync(path.join(MIIP_ROOT, rel))
    );

    const registrados = this._registry.listar?.() ?? [];
    const desativados = this._registry.listarInativos?.() ?? [];

    let status = MiipHealthStatus.OK;
    if (ausentes.length > 0) {
      status = MiipHealthStatus.ERROR;
    } else if (desativados.length > 0) {
      status = MiipHealthStatus.WARNING;
    }

    return {
      aprovado: ausentes.length === 0,
      status,
      totalRegistrados: registrados.length,
      totalDesativados: desativados.length,
      ausentes,
      desativados: desativados.map((m) => m.codigo)
    };
  }

  /**
   * @private
   * @returns {Object}
   */
  _validarRepositories() {
    const ausentes = REPOSITORIES_OBRIGATORIOS.filter(
      (rel) => !fs.existsSync(path.join(MIIP_ROOT, rel))
    );

    return {
      aprovado: ausentes.length === 0,
      status: ausentes.length === 0 ? MiipHealthStatus.OK : MiipHealthStatus.ERROR,
      ausentes,
      verificados: REPOSITORIES_OBRIGATORIOS.length - ausentes.length
    };
  }
}

module.exports = MiipDiagnosticService;
