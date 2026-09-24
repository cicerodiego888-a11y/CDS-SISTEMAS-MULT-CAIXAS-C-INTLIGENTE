'use strict';

/**
 * ConsultaCnpjService — orquestra normalização, cache, retry e provider.
 * Não conhece o JSON da BrasilAPI.
 *
 * @module services/cadastro/ConsultaCnpjService
 */

const EmpresaCnpjDTO = require('./contracts/EmpresaCnpjDTO');
const BrasilApiCnpjProvider = require('./providers/BrasilApiCnpjProvider');
const { normalizarCnpj, validarCnpj } = require('./documentoCpfCnpj');
const { criarErroConsultaCnpj, CODIGOS } = require('./cnpjConsultaErros');

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_CODIGOS = new Set([CODIGOS.TIMEOUT, CODIGOS.INDISPONIVEL]);

/** @type {Map<string, { expiresAt: number, dtoJson: object }>} */
const cacheMemoria = new Map();

function limparCacheExpirado(agora = Date.now()) {
  for (const [chave, entry] of cacheMemoria.entries()) {
    if (!entry || entry.expiresAt <= agora) {
      cacheMemoria.delete(chave);
    }
  }
}

function lerCache(cnpj) {
  limparCacheExpirado();
  const entry = cacheMemoria.get(cnpj);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cacheMemoria.delete(cnpj);
    return null;
  }
  return EmpresaCnpjDTO.create(entry.dtoJson);
}

function gravarCache(cnpj, dto) {
  const json = dto && typeof dto.toJSON === 'function' ? dto.toJSON() : { ...dto };
  cacheMemoria.set(cnpj, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    dtoJson: json
  });
}

function limparCacheConsultaCnpj() {
  cacheMemoria.clear();
}

class ConsultaCnpjService {
  /**
   * @param {object} [deps]
   * @param {{ consultar: Function }} [deps.provider]
   * @param {boolean} [deps.usarCache]
   */
  constructor(deps = {}) {
    this._provider = deps.provider || new BrasilApiCnpjProvider();
    this._usarCache = deps.usarCache !== false;
  }

  /**
   * @param {string|number} cnpjBruto
   * @returns {Promise<{ data: object, fromCache: boolean }>}
   */
  async consultar(cnpjBruto) {
    const cnpj = normalizarCnpj(cnpjBruto);
    if (!cnpj || !validarCnpj(cnpj)) {
      throw criarErroConsultaCnpj(CODIGOS.CNPJ_INVALIDO);
    }

    if (this._usarCache) {
      const cached = lerCache(cnpj);
      if (cached) {
        return { data: cached.toJSON(), fromCache: true };
      }
    }

    let ultimoErro = null;
    for (let tentativa = 0; tentativa < 2; tentativa += 1) {
      try {
        const dto = await this._provider.consultar(cnpj);
        const instancia = dto instanceof EmpresaCnpjDTO ? dto : EmpresaCnpjDTO.create(dto);
        if (this._usarCache) {
          gravarCache(cnpj, instancia);
        }
        return { data: instancia.toJSON(), fromCache: false };
      } catch (err) {
        ultimoErro = err;
        const codigo = err && (err.code || err.codigo);
        const podeRetry = tentativa === 0 && RETRY_CODIGOS.has(codigo);
        if (!podeRetry) {
          throw err;
        }
      }
    }

    throw ultimoErro || criarErroConsultaCnpj(CODIGOS.ERRO_PROVIDER);
  }
}

module.exports = ConsultaCnpjService;
module.exports.CACHE_TTL_MS = CACHE_TTL_MS;
module.exports.limparCacheConsultaCnpj = limparCacheConsultaCnpj;
module.exports._cacheMemoria = cacheMemoria;
