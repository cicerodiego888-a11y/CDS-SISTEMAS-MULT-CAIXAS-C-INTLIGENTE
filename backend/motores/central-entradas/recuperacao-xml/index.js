/**
 * Recuperação automática de XML (RC3.7.5 + Sprint 2)
 */

'use strict';

const FilaRecuperacaoXml = require('./FilaRecuperacaoXml');
const MotorRecuperacaoXmlConfig = require('./MotorRecuperacaoXmlConfig');
const MotorRecuperacaoXmlService = require('./MotorRecuperacaoXmlService');
const StatusRecuperacaoXml = require('./StatusRecuperacaoXml');
const RecuperacaoXmlPolitica = require('./RecuperacaoXmlPolitica');
const RecuperacaoXmlClassificador = require('./RecuperacaoXmlClassificador');

module.exports = {
  ...FilaRecuperacaoXml,
  ...MotorRecuperacaoXmlConfig,
  ...StatusRecuperacaoXml,
  ...RecuperacaoXmlPolitica,
  ...RecuperacaoXmlClassificador,
  MotorRecuperacaoXmlService,
  obterMotorRecuperacaoXml: MotorRecuperacaoXmlService.obterMotorRecuperacaoXml
};
