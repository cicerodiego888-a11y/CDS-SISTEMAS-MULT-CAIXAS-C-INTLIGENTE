'use strict';

/**
 * Erros tipados da consulta de CNPJ (cadastro).
 * @module services/cadastro/cnpjConsultaErros
 */

const CODIGOS = Object.freeze({
  CNPJ_INVALIDO: 'CNPJ_INVALIDO',
  NAO_ENCONTRADO: 'NAO_ENCONTRADO',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMIT: 'RATE_LIMIT',
  INDISPONIVEL: 'INDISPONIVEL',
  ERRO_PROVIDER: 'ERRO_PROVIDER'
});

const HTTP_POR_CODIGO = Object.freeze({
  CNPJ_INVALIDO: 400,
  NAO_ENCONTRADO: 404,
  TIMEOUT: 504,
  RATE_LIMIT: 429,
  INDISPONIVEL: 503,
  ERRO_PROVIDER: 502
});

const MENSAGEM_PADRAO = Object.freeze({
  CNPJ_INVALIDO: 'CNPJ inválido.',
  NAO_ENCONTRADO: 'Empresa não encontrada para este CNPJ.',
  TIMEOUT: 'Não foi possível consultar o CNPJ agora. Verifique sua conexão ou tente novamente.',
  RATE_LIMIT: 'A consulta de CNPJ atingiu o limite temporário. Tente novamente em alguns instantes.',
  INDISPONIVEL: 'Não foi possível consultar o CNPJ agora. Verifique sua conexão ou tente novamente.',
  ERRO_PROVIDER: 'Não foi possível consultar o CNPJ agora. Verifique sua conexão ou tente novamente.'
});

/**
 * @param {string} codigo
 * @param {string} [mensagem]
 * @param {object} [extras]
 * @returns {Error}
 */
function criarErroConsultaCnpj(codigo, mensagem, extras = {}) {
  const code = CODIGOS[codigo] || CODIGOS.ERRO_PROVIDER;
  const err = new Error(mensagem || MENSAGEM_PADRAO[code] || MENSAGEM_PADRAO.ERRO_PROVIDER);
  err.code = code;
  err.codigo = code;
  err.statusCode = HTTP_POR_CODIGO[code] || 502;
  Object.assign(err, extras);
  return err;
}

function isErroConsultaCnpj(err) {
  return Boolean(err && err.code && CODIGOS[err.code]);
}

module.exports = {
  CODIGOS,
  HTTP_POR_CODIGO,
  MENSAGEM_PADRAO,
  criarErroConsultaCnpj,
  isErroConsultaCnpj
};
