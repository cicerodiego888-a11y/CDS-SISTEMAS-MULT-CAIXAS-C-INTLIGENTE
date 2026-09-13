const MotorGTIN = require('./MotorGTIN');
const MotorAssociacaoFornecedor = require('./MotorAssociacaoFornecedor');
const MotorCanonical = require('./canonical/MotorCanonical');
const MotorAttributeExtractor = require('./attributes/MotorAttributeExtractor');
const MotorSynonyms = require('./synonyms/MotorSynonyms');
const MotorSimilarity = require('./similarity/MotorSimilarity');
const MotorUniversalBuscaCandidatos = require('./mubc/MotorUniversalBuscaCandidatos');

module.exports = {
  MotorGTIN,
  MotorAssociacaoFornecedor,
  MotorCanonical,
  MotorAttributeExtractor,
  MotorSynonyms,
  MotorSimilarity,
  MotorUniversalBuscaCandidatos
};
