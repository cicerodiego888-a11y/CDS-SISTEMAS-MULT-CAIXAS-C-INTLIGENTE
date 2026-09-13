'use strict';

/**
 * Integração corporativa do Motor de Equipamentos — RC5.0
 * @module services/equipamentos-integracao
 */

const integration = require('./EquipamentosIntegrationService');
const eventBus = require('./EquipmentEventBus');
const permissoes = require('./EquipamentosPermissoes');
const auditoria = require('./EquipamentosAuditoria');
const modulos = require('./modulos');

function iniciar() {
  integration.iniciar();
  modulos.centralInteligente.iniciar();
  return { ativo: true, versao: 'RC5.0' };
}

function parar() {
  modulos.centralInteligente.parar();
  integration.parar();
}

module.exports = {
  iniciar,
  parar,
  service: integration,
  eventBus,
  EVENTOS: eventBus.EVENTOS || require('./EquipmentEventBus').EVENTOS,
  permissoes,
  auditoria,
  modulos,
  MODULOS: permissoes.MODULOS,
  ACOES: permissoes.ACOES
};
