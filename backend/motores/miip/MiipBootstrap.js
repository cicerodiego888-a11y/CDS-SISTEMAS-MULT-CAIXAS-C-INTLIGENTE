/**
 * MiipBootstrap — Inicialização dos motores plugáveis do MIIP.
 *
 * Sprint RC1: registra todos os engines do pipeline oficial.
 *
 * @module motores/miip/MiipBootstrap
 */

const MotorRegistry = require('./core/MotorRegistry');
const MotorCanonical = require('./engines/canonical/MotorCanonical');
const MotorAttributeExtractor = require('./engines/attributes/MotorAttributeExtractor');
const MotorSynonyms = require('./engines/synonyms/MotorSynonyms');
const MotorGTIN = require('./engines/gtin/MotorGTIN');
const MotorAssociacaoFornecedor = require('./engines/fornecedor/MotorAssociacaoFornecedor');
const MotorUniversalBuscaCandidatos = require('./engines/mubc/MotorUniversalBuscaCandidatos');
const MotorSimilarity = require('./engines/similarity/MotorSimilarity');

let inicializado = false;

const MOTORES_PADRAO = Object.freeze([
  { codigo: 'motor_canonical', Classe: MotorCanonical, prioridade: 10 },
  { codigo: 'motor_attribute_extractor', Classe: MotorAttributeExtractor, prioridade: 20 },
  { codigo: 'motor_synonyms', Classe: MotorSynonyms, prioridade: 30 },
  { codigo: 'motor_gtin', Classe: MotorGTIN, prioridade: 40 },
  { codigo: 'motor_associacao_fornecedor', Classe: MotorAssociacaoFornecedor, prioridade: 50 },
  { codigo: 'motor_mubc', Classe: MotorUniversalBuscaCandidatos, prioridade: 55 },
  { codigo: 'motor_similarity', Classe: MotorSimilarity, prioridade: 60 }
]);

/**
 * Registra motores padrão do MIIP se ainda não registrados.
 *
 * @param {Object} [opcoes]
 * @param {Object} [opcoes.db] - Instância SQLite
 * @returns {void}
 */
function inicializarMiip(opcoes = {}) {
  if (inicializado && MotorRegistry.total() > 0) return;

  const db = opcoes.db ?? require('../../database');
  const config = { db };

  MOTORES_PADRAO.forEach((motor) => {
    if (!MotorRegistry.buscar(motor.codigo)) {
      MotorRegistry.registrar({
        codigo: motor.codigo,
        Classe: motor.Classe,
        ativo: true,
        prioridade: motor.prioridade,
        meta: { config }
      });
    }
  });

  inicializado = true;
}

/**
 * @returns {boolean}
 */
function estaInicializado() {
  return inicializado && MotorRegistry.total() > 0;
}

/**
 * Reinicia flag de bootstrap (apenas testes).
 *
 * @returns {void}
 */
function reiniciarParaTestes() {
  inicializado = false;
}

module.exports = {
  inicializarMiip,
  estaInicializado,
  reiniciarParaTestes,
  MOTORES_PADRAO
};
