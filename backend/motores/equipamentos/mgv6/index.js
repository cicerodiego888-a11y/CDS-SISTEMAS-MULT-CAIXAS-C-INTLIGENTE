/**
 * Sprint 14.15.1 — Bridge de Compatibilidade Toledo / MGV6 V1.0
 *
 * Camada PARALELA de exportação legada.
 * NÃO é um segundo Driver Toledo.
 * NÃO altera ToledoPrixIVDriver / ConnectionManager / Protocol / PLU TCP.
 *
 * Status: IMPLEMENTADO — COMPATIBILIDADE INICIAL (não homologado MGV6).
 */

'use strict';

const MGV6Configuration = require('./MGV6Configuration');
const MGV6Validator = require('./MGV6Validator');
const MGV6FileBuilder = require('./MGV6FileBuilder');
const MGV6Exporter = require('./MGV6Exporter');
const MGV6Launcher = require('./MGV6Launcher');
const MGV6Repository = require('./MGV6Repository');
const MGV6SyncService = require('./MGV6SyncService');
const MGV6ModoEnvio = require('./MGV6ModoEnvio');
const MGV6IdentityResolver = require('./MGV6IdentityResolver');
const MGV6Errors = require('./MGV6Errors');
const MGV6Encoding = require('./MGV6Encoding');
const MGV6FileAudit = require('./MGV6FileAudit');
const MGV6Controller = require('./MGV6Controller');
const createRoutes = require('./MGV6Routes');

module.exports = {
  MGV6Configuration,
  MGV6Validator,
  MGV6FileBuilder,
  MGV6Exporter,
  MGV6Launcher,
  MGV6Repository,
  MGV6SyncService,
  MGV6ModoEnvio,
  MGV6IdentityResolver,
  MGV6Errors,
  MGV6Encoding,
  MGV6FileAudit,
  MGV6Controller,
  createRoutes,
  ...MGV6Configuration,
  ...MGV6FileBuilder,
  ...MGV6Exporter,
  ...MGV6ModoEnvio,
  ...MGV6IdentityResolver,
  launch: MGV6Launcher.launch
};
