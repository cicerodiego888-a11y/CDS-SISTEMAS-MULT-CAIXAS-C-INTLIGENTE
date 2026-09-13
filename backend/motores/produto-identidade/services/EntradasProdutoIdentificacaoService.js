/**
 * Identificação de produtos para Compras / XML / Central de Entradas (Sprint 07).
 * Unifica resolução por GTIN/EAN/código/PLU via MIP — elimina SQL duplicado.
 *
 * Flag OFF → { habilitado: false } (consumidor mantém legado/MIIP).
 * Flag ON  → resolve exclusivo pelo Motor de Identificação.
 *
 * @module motores/produto-identidade/services/EntradasProdutoIdentificacaoService
 */

const ProdutoIdentidadeService = require('./ProdutoIdentidadeService');
const IdentidadeResultadoDTO = require('../contracts/IdentidadeResultadoDTO');
const {
  isProdutoIdentidadeEnabled,
  FLAG_CHAVE
} = require('../config/produtoIdentidadeFlags');

function limparCodigo(valor) {
  const s = String(valor ?? '').trim();
  if (!s) return '';
  if (/^sem\s*gtin$/i.test(s)) return '';
  const digitos = s.replace(/\D/g, '');
  // NF-e frequentemente usa cEAN = "SEM GTIN" ou só zeros
  if (digitos.length >= 8 && /^0+$/.test(digitos)) return '';
  return s;
}

/**
 * Extrai candidatos de código de um item de compra/XML (ordem de prioridade).
 * @param {Object} item
 * @returns {string[]}
 */
function extrairCandidatosCodigo(item = {}) {
  const lista = [
    item.codigo_barras,
    item.codigoBarras,
    item.gtin,
    item.cEAN,
    item.codigo,
    item.codigo_produto,
    item.plu,
    item.codigo_fornecedor,
    item.codigoFornecedor
  ];

  const out = [];
  const vistos = new Set();
  for (const raw of lista) {
    const c = limparCodigo(raw);
    if (!c || vistos.has(c)) continue;
    // Ignora SEM GTIN e similares
    if (/^sem\s*gtin$/i.test(c)) continue;
    vistos.add(c);
    out.push(c);
  }
  return out;
}

class EntradasProdutoIdentificacaoService {
  /**
   * @param {Object} [deps]
   * @param {Object|null} [deps.db]
   * @param {ProdutoIdentidadeService} [deps.identidadeService]
   * @param {Function} [deps.isEnabled]
   */
  constructor(deps = {}) {
    this._db = deps.db ?? null;
    this._isEnabled = deps.isEnabled ?? isProdutoIdentidadeEnabled;
    this._identidade = deps.identidadeService
      ?? new ProdutoIdentidadeService({
        db: this._db,
        isEnabled: this._isEnabled
      });
  }

  /**
   * @param {string} codigo
   * @param {Object} [contexto]
   * @returns {Promise<Object>}
   */
  async identificar(codigo, contexto = {}) {
    const bruto = limparCodigo(codigo);
    const origem = contexto.origem || 'entradas';
    const ctx = { origem, ...contexto };

    if (!this._isEnabled()) {
      const dto = IdentidadeResultadoDTO.desabilitado(bruto || null);
      return this._toPayload(dto, { modo: 'legado' });
    }

    if (!bruto) {
      return this._toPayload(
        IdentidadeResultadoDTO.naoEncontrado({ codigoOriginal: '' }),
        { modo: 'mip' }
      );
    }

    const resultado = await this._identidade.resolve(
      { codigo: bruto, contexto: ctx },
      ctx
    );

    return this._toPayload(resultado, { modo: 'mip' });
  }

  /**
   * Resolve produto a partir de um item de compra/XML.
   * Tenta candidatos em ordem até encontrar.
   *
   * @param {Object} item
   * @param {Object} [contexto]
   * @returns {Promise<Object>}
   */
  async identificarItem(item = {}, contexto = {}) {
    const origem = contexto.origem || 'compras';
    const candidatos = extrairCandidatosCodigo(item);

    if (!this._isEnabled()) {
      return this._toPayload(
        IdentidadeResultadoDTO.desabilitado(candidatos[0] || null),
        { modo: 'legado', candidatos }
      );
    }

    if (!candidatos.length) {
      return this._toPayload(
        IdentidadeResultadoDTO.naoEncontrado({ codigoOriginal: '' }),
        { modo: 'mip', candidatos: [] }
      );
    }

    let ultimo = null;
    for (const codigo of candidatos) {
      const r = await this.identificar(codigo, { ...contexto, origem });
      ultimo = r;
      if (r.encontrado && r.produtoId) {
        return { ...r, codigoUsado: codigo, candidatos };
      }
    }

    return {
      ...(ultimo || this._toPayload(IdentidadeResultadoDTO.naoEncontrado({}), { modo: 'mip' })),
      candidatos,
      codigoUsado: null
    };
  }

  /**
   * @private
   */
  _toPayload(resultado, extras = {}) {
    const json = resultado && typeof resultado.toJSON === 'function'
      ? resultado.toJSON()
      : { ...(resultado || {}) };

    return {
      ...json,
      flag: FLAG_CHAVE,
      modo: extras.modo || (json.habilitado === false ? 'legado' : 'mip'),
      candidatos: extras.candidatos,
      codigoUsado: extras.codigoUsado
    };
  }
}

module.exports = EntradasProdutoIdentificacaoService;
module.exports.extrairCandidatosCodigo = extrairCandidatosCodigo;
module.exports.limparCodigo = limparCodigo;
