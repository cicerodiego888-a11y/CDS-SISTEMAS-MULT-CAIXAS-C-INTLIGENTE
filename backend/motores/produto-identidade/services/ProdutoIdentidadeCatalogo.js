/**
 * ProdutoIdentidadeCatalogo — leitura de produtos + identificadores para strategies.
 * Sprint 08: cache LRU opcional para lookups repetidos.
 * @module motores/produto-identidade/services/ProdutoIdentidadeCatalogo
 */

const { criarDbHelpers, resolverDb } = require('../../miip/repositories/dbHelpers');
const ProdutoIdentificadoresRepository = require('../repositories/ProdutoIdentificadoresRepository');
const { normalizarCodigoIdentificador } = require('../normalizers/normalizarCodigoIdentificador');
const { TIPOS_IDENTIFICADOR } = require('../constants/tiposIdentificador');
const { variantesPlu } = require('../utils/normalizarPlu');
const MipLookupCache = require('../observability/MipLookupCache');

const COLUNAS_PRODUTO = `
  id, codigo, codigo_barras, nome, unidade, preco_venda, ativo
`;

function mapProduto(row) {
  if (!row) return null;
  return {
    id: row.id,
    codigo: row.codigo,
    codigo_barras: row.codigo_barras,
    nome: row.nome,
    unidade: row.unidade,
    preco_venda: row.preco_venda,
    ativo: row.ativo
  };
}

class ProdutoIdentidadeCatalogo {
  /**
   * @param {Object} [deps]
   * @param {Object|null} [deps.db]
   * @param {ProdutoIdentificadoresRepository} [deps.identificadoresRepository]
   * @param {MipLookupCache|false|null} [deps.cache] — false desliga cache
   */
  constructor(deps = {}) {
    this._db = deps.db != null ? deps.db : resolverDb(null);
    this._helpers = this._db ? criarDbHelpers(this._db) : null;
    this._ids = deps.identificadoresRepository
      ?? new ProdutoIdentificadoresRepository({ db: this._db });
    this._cache = deps.cache === false
      ? null
      : (deps.cache || new MipLookupCache(500));
  }

  get cache() {
    return this._cache;
  }

  limparCache() {
    if (this._cache) this._cache.clear();
  }

  async _ready() {
    if (!this._helpers) throw new Error('Database não disponível para ProdutoIdentidadeCatalogo.');
    await this._helpers.whenReady();
  }

  async buscarProdutoPorId(id) {
    const key = `id:${id}`;
    if (this._cache) {
      const hit = this._cache.get(key);
      if (hit !== undefined) return hit;
    }

    await this._ready();
    const row = await this._helpers.get(
      `SELECT ${COLUNAS_PRODUTO} FROM produtos WHERE id = ? LIMIT 1`,
      [id]
    );
    const produto = mapProduto(row);
    if (this._cache) this._cache.set(key, produto);
    return produto;
  }

  async buscarProdutoPorCodigoInterno(codigo) {
    const key = `codigo:${codigo}`;
    if (this._cache) {
      const hit = this._cache.get(key);
      if (hit !== undefined) return hit;
    }

    await this._ready();
    const row = await this._helpers.get(
      `SELECT ${COLUNAS_PRODUTO} FROM produtos WHERE codigo = ? LIMIT 1`,
      [codigo]
    );
    const produto = mapProduto(row);
    if (this._cache) this._cache.set(key, produto);
    return produto;
  }

  async buscarProdutoPorCodigoBarras(codigoBarras) {
    const key = `barras:${codigoBarras}`;
    if (this._cache) {
      const hit = this._cache.get(key);
      if (hit !== undefined) return hit;
    }

    await this._ready();
    const row = await this._helpers.get(
      `SELECT ${COLUNAS_PRODUTO} FROM produtos WHERE codigo_barras = ? LIMIT 1`,
      [codigoBarras]
    );
    const produto = mapProduto(row);
    if (this._cache) this._cache.set(key, produto);
    return produto;
  }

  /**
   * Resolve via produto_identificadores e carrega produto.
   * Para tipo PLU, tenta variantes com zeros (0 / 00 / 0000 / …).
   * @param {string} tipo
   * @param {string} codigo
   */
  async resolverPorIdentificador(tipo, codigo) {
    const codigoNorm = normalizarCodigoIdentificador(codigo, tipo);
    if (!codigoNorm) return null;

    const tipoU = String(tipo || '').toUpperCase();
    const key = `ident:${tipoU}:${codigoNorm}`;
    if (this._cache) {
      const hit = this._cache.get(key);
      if (hit !== undefined) {
        console.log('[MIP DEBUG] Repository cache hit', { tipo, codigoNorm, hit: !!hit });
        return hit;
      }
    }

    const candidatos = tipoU === TIPOS_IDENTIFICADOR.PLU
      ? variantesPlu(codigoNorm)
      : [codigoNorm];

    let found = null;
    for (const cand of candidatos) {
      console.log('[MIP DEBUG] Repository buscarPorTipoCodigo', { tipo, codigo: cand });
      const ident = await this._ids.buscarPorTipoCodigo(tipo, cand, {
        escopo: null,
        escopoValor: null,
        apenasAtivos: true
      });
      if (!ident) continue;

      console.log('[MIP DEBUG] Repository: identificador encontrado', {
        id: ident.id,
        produtoId: ident.produtoId,
        tipo: ident.tipo,
        codigo: ident.codigo,
        buscadoComo: cand,
        entrada: codigoNorm
      });

      const produto = await this.buscarProdutoPorId(ident.produtoId);
      if (!produto) {
        console.log('[MIP DEBUG] Repository: produto_id sem produto', ident.produtoId);
        continue;
      }

      console.log('[MIP DEBUG] Repository → Produto', { id: produto.id, nome: produto.nome });
      found = { produto, identificador: ident };
      break;
    }

    if (!found) {
      console.log('[MIP DEBUG] Repository: nenhum identificador', {
        tipo,
        codigo: codigoNorm,
        variantes: candidatos.length
      });
    }

    if (this._cache) this._cache.set(key, found);
    return found;
  }
}

module.exports = ProdutoIdentidadeCatalogo;
