/**
 * RC3.7.5 — Motor de Recuperação Automática de XML
 * @module motores/central-entradas/recuperacao-xml
 */

'use strict';

const FilaRecuperacaoXml = require('./FilaRecuperacaoXml');
const MotorRecuperacaoXmlConfig = require('./MotorRecuperacaoXmlConfig');
const MotorRecuperacaoXmlService = require('./MotorRecuperacaoXmlService');

module.exports = {
  ...FilaRecuperacaoXml,
  ...MotorRecuperacaoXmlConfig,
  MotorRecuperacaoXmlService,
  obterMotorRecuperacaoXml: MotorRecuperacaoXmlService.obterMotorRecuperacaoXml
};
