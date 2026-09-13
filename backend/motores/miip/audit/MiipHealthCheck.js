/**
 * MiipHealthCheck — Verificação de saúde do MIIP V1.
 *
 * Sprint 13 — Calibração final.
 *
 * @module motores/miip/audit/MiipHealthCheck
 */

const fs = require('fs');
const path = require('path');
const MiipArchitectureValidator = require('./MiipArchitectureValidator');
const MiipDecisionValidator = require('./MiipDecisionValidator');

const MIIP_ROOT = path.join(__dirname, '..');

class MiipHealthCheck {
  /**
   * @param {Object} [deps]
   * @param {MiipArchitectureValidator} [deps.architectureValidator]
   * @param {MiipDecisionValidator} [deps.decisionValidator]
   */
  constructor(deps = {}) {
    this._architectureValidator = deps.architectureValidator ?? new MiipArchitectureValidator();
    this._decisionValidator = deps.decisionValidator ?? new MiipDecisionValidator();
  }

  /**
   * @returns {Object}
   */
  executar() {
    const inicio = Date.now();
    const arquitetura = this._architectureValidator.validar();
    const decisao = this._decisionValidator.validar();

    const modulos = {
      decisionEngine: fs.existsSync(path.join(MIIP_ROOT, 'core/DecisionEngine.js')),
      explainService: fs.existsSync(path.join(MIIP_ROOT, 'core/MiipExplainService.js')),
      similarityEngine: fs.existsSync(path.join(MIIP_ROOT, 'engines/similarity/MotorSimilarity.js')),
      canonicalEngine: fs.existsSync(path.join(MIIP_ROOT, 'engines/canonical/MotorCanonical.js')),
      attributeEngine: fs.existsSync(path.join(MIIP_ROOT, 'engines/attributes/MotorAttributeExtractor.js')),
      synonymEngine: fs.existsSync(path.join(MIIP_ROOT, 'engines/synonyms/MotorSynonyms.js')),
      gtinEngine: fs.existsSync(path.join(MIIP_ROOT, 'engines/gtin/MotorGTIN.js')),
      fornecedorEngine: fs.existsSync(path.join(MIIP_ROOT, 'engines/fornecedor/MotorAssociacaoFornecedor.js')),
      mubcEngine: fs.existsSync(path.join(MIIP_ROOT, 'engines/mubc/MotorUniversalBuscaCandidatos.js')),
      pipeline: fs.existsSync(path.join(MIIP_ROOT, 'core/MiipPipeline.js')),
      auditService: fs.existsSync(path.join(MIIP_ROOT, 'audit/MiipAuditService.js'))
    };

    const modulosAtivos = Object.values(modulos).filter(Boolean).length;
    const modulosTotal = Object.keys(modulos).length;

    const saudavel = arquitetura.aprovado && decisao.aprovado;

    return {
      saudavel,
      versao: '1.0.0',
      status: saudavel ? 'PRONTO' : 'ATENCAO',
      arquitetura,
      decisao,
      modulos,
      modulosAtivos,
      modulosTotal,
      tempo: Date.now() - inicio,
      verificadoEm: new Date().toISOString()
    };
  }
}

module.exports = MiipHealthCheck;
