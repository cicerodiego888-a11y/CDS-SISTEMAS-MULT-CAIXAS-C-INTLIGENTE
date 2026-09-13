/**
 * Plataforma Fiscal — núcleo (RC1 / F1–F10 + consolidação RC1.1).
 *
 * Exporta fundação + registry + UrlResolver + SoapTransport + helpers de runtime.
 *
 * @module services/fiscal/core
 */

const { FiscalWebServices } = require('./FiscalWebServices');
const { WebServiceRegistry } = require('./WebServiceRegistry');
const { WebServiceDefinition, createWebServiceDefinition, buildDefinitionId } = require('./WebServiceDefinition');
const {
  RegistryBuilder,
  listOfficialDefinitions,
  OFFICIAL_SERVICE_COUNT,
  ENDPOINTS,
  NS,
  ACTION,
  UF_SVRS,
  UF_AN
} = require('./RegistryBuilder');
const { UrlResolver } = require('./UrlResolver');
const { ResolutionResult, createResolutionResult } = require('./ResolutionResult');
const { ResolutionSource, isResolutionSource, listResolutionSources } = require('./ResolutionSource');
const { ResolverContext, createResolverContext } = require('./ResolverContext');
const {
  validateResolverContext,
  assertValidResolverContext,
  SUPPORTED_VERSIONS
} = require('./ResolverValidator');
const { ResolverException, ResolverErrorCode } = require('./ResolverException');
const {
  ResolverWarnings,
  createWarning,
  isResolverWarning,
  listResolverWarnings
} = require('./ResolverWarnings');
const { ResolverMetrics } = require('./ResolverMetrics');
const { SoapTransport, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_RETRIES, PLATFORM_USER_AGENT } = require('./SoapTransport');
const { TransportContext, createTransportContext } = require('./TransportContext');
const { TransportRequest, createTransportRequest } = require('./TransportRequest');
const { TransportResponse, createTransportResponse } = require('./TransportResponse');
const { TransportException, TransportErrorCode } = require('./TransportException');
const { TransportMetrics } = require('./TransportMetrics');
const { TransportFactory } = require('./TransportFactory');
const { RetryPolicy } = require('./RetryPolicy');
const { TimeoutPolicy, OPERATION_TIMEOUTS } = require('./TimeoutPolicy');
const { TlsPolicy } = require('./TlsPolicy');
const {
  ENABLED_OPERATIONS,
  RESERVED_OPERATIONS,
  isTransportEnabledFor,
  isReservedOperation
} = require('./TransportEnablement');
const { FiscalRuntimeMetrics } = require('./FiscalRuntimeMetrics');
const { logFiscalRuntime } = require('./FiscalRuntimeLog');
const { buildRuntimeResult } = require('./FiscalRuntimeResult');
const {
  OperationType,
  ManifestacaoEventoCode,
  isOperationType,
  listOperationTypes,
  getManifestacaoEventoCode,
  isManifestacaoOperation
} = require('./OperationType');
const { ModelType, ModelCode, isModelType, listModelTypes, getModelCode } = require('./ModelType');
const {
  EnvironmentType,
  EnvironmentCode,
  isEnvironmentType,
  listEnvironmentTypes,
  fromAmbienteCode,
  toAmbienteCode
} = require('./EnvironmentType');
const {
  FiscalSoapTelemetry,
  fiscalSoapTelemetry,
  sanitizarSoapXml,
  contarDocZipPorTipo,
  extrairMetadadosLeve
} = require('./FiscalSoapTelemetry');
const { FiscalSoapTelemetryEvents } = require('./FiscalSoapTelemetryEvents');

module.exports = {
  FiscalWebServices,
  WebServiceRegistry,
  WebServiceDefinition,
  createWebServiceDefinition,
  buildDefinitionId,
  RegistryBuilder,
  listOfficialDefinitions,
  OFFICIAL_SERVICE_COUNT,
  ENDPOINTS,
  NS,
  ACTION,
  UF_SVRS,
  UF_AN,
  UrlResolver,
  ResolutionResult,
  createResolutionResult,
  ResolutionSource,
  isResolutionSource,
  listResolutionSources,
  ResolverContext,
  createResolverContext,
  validateResolverContext,
  assertValidResolverContext,
  SUPPORTED_VERSIONS,
  ResolverException,
  ResolverErrorCode,
  ResolverWarnings,
  createWarning,
  isResolverWarning,
  listResolverWarnings,
  ResolverMetrics,
  SoapTransport,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  PLATFORM_USER_AGENT,
  TransportContext,
  createTransportContext,
  TransportRequest,
  createTransportRequest,
  TransportResponse,
  createTransportResponse,
  TransportException,
  TransportErrorCode,
  TransportMetrics,
  TransportFactory,
  RetryPolicy,
  TimeoutPolicy,
  OPERATION_TIMEOUTS,
  TlsPolicy,
  ENABLED_OPERATIONS,
  RESERVED_OPERATIONS,
  isTransportEnabledFor,
  isReservedOperation,
  FiscalRuntimeMetrics,
  logFiscalRuntime,
  buildRuntimeResult,
  OperationType,
  ManifestacaoEventoCode,
  isOperationType,
  listOperationTypes,
  getManifestacaoEventoCode,
  isManifestacaoOperation,
  ModelType,
  ModelCode,
  isModelType,
  listModelTypes,
  getModelCode,
  EnvironmentType,
  EnvironmentCode,
  isEnvironmentType,
  listEnvironmentTypes,
  fromAmbienteCode,
  toAmbienteCode,
  FiscalSoapTelemetry,
  fiscalSoapTelemetry,
  FiscalSoapTelemetryEvents,
  sanitizarSoapXml,
  contarDocZipPorTipo,
  extrairMetadadosLeve
};
