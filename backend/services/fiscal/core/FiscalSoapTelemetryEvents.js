/**
 * Eventos de telemetria SOAP — Plataforma Fiscal RC6.6.
 * Observe-only; não altera regras de negócio.
 *
 * @module services/fiscal/core/FiscalSoapTelemetryEvents
 */

const FiscalSoapTelemetryEvents = Object.freeze({
  SOAP_INICIADO: 'SOAP_INICIADO',
  SOAP_FINALIZADO: 'SOAP_FINALIZADO',
  SOAP_FALHA: 'SOAP_FALHA',
  SOAP_TIMEOUT: 'SOAP_TIMEOUT',
  SOAP_HTTP_ERROR: 'SOAP_HTTP_ERROR',
  SOAP_CSTAT: 'SOAP_CSTAT'
});

module.exports = {
  FiscalSoapTelemetryEvents
};
