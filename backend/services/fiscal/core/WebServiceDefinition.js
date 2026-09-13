/**
 * Definição tipada de um Web Service fiscal oficial.
 *
 * Sprint F2 — contrato de dados do catálogo.
 * Não realiza chamadas de rede.
 *
 * @module services/fiscal/core/WebServiceDefinition
 */

const { isOperationType } = require('./OperationType');
const { isModelType } = require('./ModelType');
const { isEnvironmentType } = require('./EnvironmentType');

const DEFAULT_TIMEOUT_MS = 90000;
const DEFAULT_RETRY = 2;
const DEFAULT_TLS = Object.freeze({
  minVersion: 'TLSv1.2',
  rejectUnauthorized: false
});

/**
 * Gera id canônico: MODELO-OPERACAO-AMBIENTE-UF
 * @param {{ modelo: string, operacao: string, ambiente: string, uf: string }} parts
 * @returns {string}
 */
function buildDefinitionId({ modelo, operacao, ambiente, uf }) {
  return [modelo, operacao, ambiente, String(uf || '').toUpperCase()].join('-');
}

/**
 * Normaliza e valida um payload de Web Service.
 * @param {object} input
 * @returns {Readonly<object>}
 */
function createWebServiceDefinition(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('WebServiceDefinition: payload inválido.');
  }

  const modelo = input.modelo;
  const operacao = input.operacao;
  const ambiente = input.ambiente;
  const uf = String(input.uf || '').toUpperCase();
  const endpoint = String(input.endpoint || '').trim();

  if (!isModelType(modelo)) {
    throw new Error(`WebServiceDefinition: modelo inválido (${modelo}).`);
  }
  if (!isOperationType(operacao)) {
    throw new Error(`WebServiceDefinition: operacao inválida (${operacao}).`);
  }
  if (!isEnvironmentType(ambiente)) {
    throw new Error(`WebServiceDefinition: ambiente inválido (${ambiente}).`);
  }
  if (!uf) {
    throw new Error('WebServiceDefinition: uf é obrigatória.');
  }
  if (!endpoint) {
    throw new Error('WebServiceDefinition: endpoint é obrigatório.');
  }

  const tls = Object.freeze({
    ...DEFAULT_TLS,
    ...(input.tls && typeof input.tls === 'object' ? input.tls : {})
  });

  const headers = Object.freeze({
    ...(input.headers && typeof input.headers === 'object' ? input.headers : {})
  });

  const id = input.id || buildDefinitionId({ modelo, operacao, ambiente, uf });

  return Object.freeze({
    id,
    modelo,
    operacao,
    ambiente,
    uf,
    endpoint,
    soapAction: String(input.soapAction || ''),
    namespace: String(input.namespace || ''),
    versao: String(input.versao || ''),
    timeout: Number(input.timeout) > 0 ? Number(input.timeout) : DEFAULT_TIMEOUT_MS,
    tls,
    retry: Number(input.retry) >= 0 ? Number(input.retry) : DEFAULT_RETRY,
    headers,
    descricao: String(input.descricao || ''),
    ativo: input.ativo === false ? false : true,
    observacoes: String(input.observacoes || '')
  });
}

class WebServiceDefinition {
  /**
   * @param {object} input
   */
  constructor(input) {
    const def = createWebServiceDefinition(input);
    Object.assign(this, def);
    Object.freeze(this);
  }

  /**
   * Factory estática.
   * @param {object} input
   * @returns {WebServiceDefinition}
   */
  static create(input) {
    return new WebServiceDefinition(input);
  }

  /**
   * Converte para objeto plano congelado (armazenamento no registry).
   * @returns {Readonly<object>}
   */
  toJSON() {
    return createWebServiceDefinition(this);
  }
}

module.exports = {
  WebServiceDefinition,
  createWebServiceDefinition,
  buildDefinitionId,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_RETRY,
  DEFAULT_TLS
};
