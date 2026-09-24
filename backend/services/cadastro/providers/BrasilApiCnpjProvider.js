'use strict';

/**
 * BrasilApiCnpjProvider — consulta cadastral via BrasilAPI (MVP).
 * Único ponto que conhece o JSON da BrasilAPI.
 *
 * @module services/cadastro/providers/BrasilApiCnpjProvider
 */

const axios = require('axios');
const ICnpjProvider = require('./ICnpjProvider');
const EmpresaCnpjDTO = require('../contracts/EmpresaCnpjDTO');
const { criarErroConsultaCnpj, CODIGOS } = require('../cnpjConsultaErros');
const { normalizarCnpj } = require('../documentoCpfCnpj');
const { resolverMunicipioDestinatario } = require('../../fiscal/municipioIbge');

const BASE_URL = 'https://brasilapi.com.br/api/cnpj/v1';
const TIMEOUT_MS = 10000;
const USER_AGENT = 'CDS-Sistemas/1.0 (consulta-cnpj)';

function textoOuNull(valor) {
  if (valor == null) return null;
  const s = String(valor).trim();
  return s === '' ? null : s;
}

function montarTelefone(raw) {
  const t1 = textoOuNull(raw.ddd_telefone_1);
  if (!t1) return null;
  const digits = t1.replace(/\D/g, '');
  return digits || t1;
}

function montarCep(raw) {
  if (raw.cep == null || raw.cep === '') return null;
  const digits = String(raw.cep).replace(/\D/g, '');
  if (!digits) return null;
  return digits.padStart(8, '0').slice(-8);
}

function montarLogradouro(raw) {
  const tipo = textoOuNull(raw.descricao_tipo_de_logradouro);
  const log = textoOuNull(raw.logradouro);
  if (tipo && log) return `${tipo} ${log}`.trim();
  return log || tipo;
}

function situacaoTexto(raw) {
  const desc = textoOuNull(raw.descricao_situacao_cadastral);
  if (desc) return desc;
  if (raw.situacao_cadastral != null && raw.situacao_cadastral !== '') {
    return String(raw.situacao_cadastral);
  }
  return null;
}

/**
 * Mapeia payload BrasilAPI → EmpresaCnpjDTO.
 * Não inventa IE/e-mail; IBGE via municipioIbge (cidade+UF).
 *
 * @param {object} raw
 * @returns {EmpresaCnpjDTO}
 */
function mapBrasilApiParaDto(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const cnpj = normalizarCnpj(data.cnpj);
  const municipio = textoOuNull(data.municipio);
  const uf = textoOuNull(data.uf);
  const codigoInformado = data.codigo_municipio != null
    ? String(data.codigo_municipio).replace(/\D/g, '')
    : '';

  let codigoMunicipio = null;
  try {
    codigoMunicipio = resolverMunicipioDestinatario({
      cidade: municipio,
      uf,
      codigoMunicipio: codigoInformado.length === 7 ? codigoInformado : null
    });
  } catch (_) {
    codigoMunicipio = null;
  }

  return EmpresaCnpjDTO.create({
    cnpj,
    razaoSocial: textoOuNull(data.razao_social),
    nomeFantasia: textoOuNull(data.nome_fantasia),
    inscricaoEstadual: null,
    situacaoCadastral: situacaoTexto(data),
    cep: montarCep(data),
    logradouro: montarLogradouro(data),
    numero: textoOuNull(data.numero),
    complemento: textoOuNull(data.complemento),
    bairro: textoOuNull(data.bairro),
    municipio,
    uf: uf ? uf.toUpperCase() : null,
    codigoMunicipio,
    telefone: montarTelefone(data),
    email: textoOuNull(data.email)
  });
}

function classificarErroHttp(err) {
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
    return criarErroConsultaCnpj(CODIGOS.TIMEOUT);
  }
  if (!err.response) {
    return criarErroConsultaCnpj(CODIGOS.INDISPONIVEL);
  }
  const status = Number(err.response.status);
  if (status === 404) return criarErroConsultaCnpj(CODIGOS.NAO_ENCONTRADO);
  if (status === 429) return criarErroConsultaCnpj(CODIGOS.RATE_LIMIT);
  if (status === 400) return criarErroConsultaCnpj(CODIGOS.CNPJ_INVALIDO);
  if (status >= 500) return criarErroConsultaCnpj(CODIGOS.INDISPONIVEL);
  return criarErroConsultaCnpj(CODIGOS.ERRO_PROVIDER);
}

class BrasilApiCnpjProvider extends ICnpjProvider {
  /**
   * @param {object} [deps]
   * @param {typeof axios} [deps.http]
   * @param {string} [deps.baseUrl]
   * @param {number} [deps.timeoutMs]
   */
  constructor(deps = {}) {
    super();
    this._http = deps.http || axios;
    this._baseUrl = String(deps.baseUrl || BASE_URL).replace(/\/$/, '');
    this._timeoutMs = Number(deps.timeoutMs) > 0 ? Number(deps.timeoutMs) : TIMEOUT_MS;
    this._userAgent = deps.userAgent || USER_AGENT;
  }

  /**
   * @param {string} cnpjNormalizado
   * @returns {Promise<EmpresaCnpjDTO>}
   */
  async consultar(cnpjNormalizado) {
    const cnpj = normalizarCnpj(cnpjNormalizado);
    if (!cnpj) {
      throw criarErroConsultaCnpj(CODIGOS.CNPJ_INVALIDO);
    }

    try {
      const resp = await this._http.get(`${this._baseUrl}/${cnpj}`, {
        timeout: this._timeoutMs,
        headers: {
          Accept: 'application/json',
          'User-Agent': this._userAgent
        },
        validateStatus: (s) => s >= 200 && s < 300
      });

      if (!resp.data || typeof resp.data !== 'object') {
        throw criarErroConsultaCnpj(CODIGOS.ERRO_PROVIDER, 'Resposta inválida da fonte de consulta.');
      }

      const dto = mapBrasilApiParaDto(resp.data);
      if (!dto.cnpj) {
        dto.cnpj = cnpj;
      }
      return dto;
    } catch (err) {
      if (err && err.code && Object.values(CODIGOS).includes(err.code)) {
        throw err;
      }
      throw classificarErroHttp(err);
    }
  }
}

module.exports = BrasilApiCnpjProvider;
module.exports.mapBrasilApiParaDto = mapBrasilApiParaDto;
module.exports.TIMEOUT_MS = TIMEOUT_MS;
module.exports.USER_AGENT = USER_AGENT;
module.exports.BASE_URL = BASE_URL;
