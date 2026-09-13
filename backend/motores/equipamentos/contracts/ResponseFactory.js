/**
 * ResponseFactory — Padronização de todas as respostas do Motor Equipamentos.
 *
 * Espelha o padrão de tefContrato.js para o domínio de equipamentos.
 *
 * @module ResponseFactory
 */

const STATUS = {
  SUCESSO: 'sucesso',
  ERRO: 'erro',
  AVISO: 'aviso',
  ENFILEIRADO: 'enfileirado',
  CANCELADO: 'cancelado',
  PROCESSANDO: 'processando',
  SIMULADO: 'simulado'
};

/**
 * @param {string} valor
 * @returns {string}
 */
function normalizarStatus(valor) {
  const s = String(valor || '').toLowerCase();
  if (['sucesso', 'success', 'ok'].includes(s)) return STATUS.SUCESSO;
  if (['erro', 'error', 'falha', 'failed'].includes(s)) return STATUS.ERRO;
  if (['aviso', 'warning', 'warn'].includes(s)) return STATUS.AVISO;
  if (['enfileirado', 'queued'].includes(s)) return STATUS.ENFILEIRADO;
  if (['cancelado', 'cancelled', 'canceled'].includes(s)) return STATUS.CANCELADO;
  if (['processando', 'processing', 'pending'].includes(s)) return STATUS.PROCESSANDO;
  if (['simulado', 'simulated', 'stub'].includes(s)) return STATUS.SIMULADO;
  return s || STATUS.ERRO;
}

/**
 * @param {Object} [params]
 * @returns {Object}
 */
function sucesso({
  mensagem = '',
  dados = null,
  status = STATUS.SUCESSO,
  metodo = null,
  tipo = null,
  timestamp = new Date().toISOString(),
  extras = {}
} = {}) {
  return {
    sucesso: true,
    status: normalizarStatus(status),
    mensagem,
    dados,
    metodo,
    tipo,
    timestamp,
    ...extras
  };
}

/**
 * @param {Object} [params]
 * @returns {Object}
 */
function erro({
  mensagem = '',
  codigo = null,
  erros = [],
  status = STATUS.ERRO,
  tipo = null,
  timestamp = new Date().toISOString(),
  extras = {}
} = {}) {
  return {
    sucesso: false,
    status: normalizarStatus(status),
    mensagem,
    codigo,
    erros: Array.isArray(erros) ? erros : [erros].filter(Boolean),
    tipo,
    timestamp,
    ...extras
  };
}

/**
 * @param {Object} [params]
 * @returns {Object}
 */
function aviso({
  mensagem = '',
  dados = null,
  status = STATUS.AVISO,
  tipo = null,
  timestamp = new Date().toISOString(),
  extras = {}
} = {}) {
  return {
    sucesso: true,
    status: normalizarStatus(status),
    mensagem,
    dados,
    aviso: true,
    tipo,
    timestamp,
    ...extras
  };
}

/**
 * @param {Object} [params]
 * @returns {Object}
 */
function diagnostico({
  sucesso: ok = true,
  simulado = false,
  comunicacaoReal = false,
  componentes = {},
  mensagens = [],
  erros = [],
  dados = null,
  timestamp = new Date().toISOString(),
  extras = {}
} = {}) {
  return {
    sucesso: Boolean(ok),
    status: STATUS.SIMULADO,
    simulado: Boolean(simulado),
    comunicacao_real: Boolean(comunicacaoReal),
    componentes,
    mensagens: Array.isArray(mensagens) ? mensagens : [],
    erros: Array.isArray(erros) ? erros : [],
    dados,
    timestamp,
    ...extras
  };
}

/**
 * @param {Object} [params]
 * @returns {Object}
 */
function status({
  online = false,
  conectado = false,
  fabricante = null,
  modelo = null,
  firmware = null,
  mensagem = '',
  dados = null,
  timestamp = new Date().toISOString(),
  extras = {}
} = {}) {
  return {
    sucesso: true,
    status: STATUS.SUCESSO,
    online: Boolean(online),
    conectado: Boolean(conectado),
    fabricante,
    modelo,
    firmware,
    mensagem,
    dados,
    timestamp,
    ...extras
  };
}

/**
 * Converte resposta interna do motor para formato da API HTTP.
 * @param {Object} retorno
 * @returns {Object}
 */
function paraRespostaApi(retorno = {}) {
  const sucesso = retorno.sucesso === true
    || retorno.success === true
    || normalizarStatus(retorno.status) === STATUS.SUCESSO;

  const resposta = {
    success: sucesso,
    status: normalizarStatus(retorno.status || (sucesso ? STATUS.SUCESSO : STATUS.ERRO)),
    message: retorno.mensagem || retorno.message || '',
    data: retorno.dados ?? retorno.data ?? null,
    errors: retorno.erros || retorno.errors || [],
    timestamp: retorno.timestamp || new Date().toISOString()
  };

  if (retorno.tipo) resposta.type = retorno.tipo;
  if (retorno.codigo || retorno.code) resposta.code = retorno.codigo || retorno.code;
  if (retorno.simulado != null) resposta.simulated = retorno.simulado;
  if (retorno.comunicacao_real != null) resposta.realCommunication = retorno.comunicacao_real;

  return resposta;
}

module.exports = {
  STATUS,
  normalizarStatus,
  sucesso,
  erro,
  aviso,
  diagnostico,
  status,
  paraRespostaApi
};
