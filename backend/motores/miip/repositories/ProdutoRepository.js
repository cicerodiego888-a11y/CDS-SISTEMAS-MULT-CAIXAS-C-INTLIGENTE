/**
 * ProdutoRepository — Única fonte oficial de leitura de produtos para o MIIP.
 *
 * Sprint 3.1: Engines consultam produtos exclusivamente por este repository.
 * MIP Sprint 03: `buscarPorGtin` consome o Motor de Identificação (quando flag ON),
 * com fallback legado em `produtos.codigo_barras`. Flag OFF = 100% legado.
 *
 * @class ProdutoRepository
 */

const ProdutoSnapshot = require('../core/ProdutoSnapshot');
const { resolverDb, criarDbHelpers } = require('./dbHelpers');
const produtoCache = require('../cache/ProdutoCache');

const COLUNAS_LEITURA = `
  id,
  codigo,
  codigo_barras,
  nome,
  unidade,
  ncm,
  cest,
  categoria_id,
  subcategoria_id,
  fornecedor,
  ativo
`;

/** Colunas com join de marca (MUBC / leitura enriquecida). */
const COLUNAS_LEITURA_JOIN = `
  p.id,
  p.codigo,
  p.codigo_barras,
  p.nome,
  p.unidade,
  p.ncm,
  p.cest,
  p.categoria_id,
  p.subcategoria_id,
  p.fornecedor,
  p.ativo,
  m.nome AS marca_nome
`;

class ProdutoRepository {
  /**
   * @param {Object} [deps]
   * @param {Object|null} [deps.db]
   * @param {Object} [deps.identidadeService] - ProdutoIdentidadeService (opcional / testes)
   * @param {Function} [deps.isMipEnabled] - override da feature flag
   */
  constructor(deps = {}) {
    this._db = deps.db ?? resolverDb(deps);
    this._helpers = this._db ? criarDbHelpers(this._db) : null;
    this._identidadeService = deps.identidadeService ?? null;
    this._isMipEnabled = deps.isMipEnabled ?? null;
  }

  /**
   * @private
   * @param {Object} row
   * @returns {ProdutoSnapshot|null}
   */
  _mapearSnapshot(row) {
    return ProdutoSnapshot.fromRow(row);
  }

  /**
   * @private
   * @returns {boolean}
   */
  _mipHabilitado() {
    if (typeof this._isMipEnabled === 'function') {
      return this._isMipEnabled() === true;
    }
    try {
      const { isProdutoIdentidadeEnabled } = require('../../produto-identidade/config/produtoIdentidadeFlags');
      return isProdutoIdentidadeEnabled() === true;
    } catch {
      return false;
    }
  }

  /**
   * @private
   * Resolve produtoId via MIP (GTIN/EAN13). Não lança — falha → null.
   * @param {string} gtin
   * @returns {Promise<number|null>}
   */
  async _resolverProdutoIdViaMip(gtin) {
    try {
      let service = this._identidadeService;
      if (!service) {
        const ProdutoIdentidadeService = require('../../produto-identidade/services/ProdutoIdentidadeService');
        service = new ProdutoIdentidadeService({
          db: this._db,
          isEnabled: () => true
        });
      }

      const resultado = await service.resolve({
        codigo: gtin,
        contexto: { origem: 'miip', tipoForcado: null }
      });

      if (resultado && resultado.encontrado && resultado.produtoId) {
        return Number(resultado.produtoId);
      }
    } catch (err) {
      console.warn('[MIIP←MIP] buscarPorGtin via MIP falhou, usando legado:', err.message);
    }
    return null;
  }

  /**
   * Busca produto por ID.
   * Usado pelo Motor Fornecedor (após miip_associacoes) e demais engines.
   *
   * @param {number} id
   * @returns {Promise<ProdutoSnapshot|null>}
   */
  async buscarPorId(id) {
    const produtoId = Number(id);
    if (!Number.isFinite(produtoId) || produtoId <= 0 || !this._helpers) return null;

    const emCache = produtoCache.buscarPorId(produtoId);
    if (emCache) return emCache;

    await this._helpers.whenReady();

    const row = await this._helpers.get(
      `SELECT ${COLUNAS_LEITURA} FROM produtos WHERE id = ? LIMIT 1`,
      [produtoId]
    );

    const snapshot = this._mapearSnapshot(row);
    if (snapshot) produtoCache.armazenar(snapshot);
    return snapshot;
  }

  /**
   * Busca produto por GTIN/EAN.
   *
   * Ordem (MIP Sprint 03):
   * 1. Cache
   * 2. Se flag ON → Motor de Identificação (identificadores + strategies)
   * 3. Fallback legado: `produtos.codigo_barras = ?`
   *
   * Flag OFF → apenas passo 3 (zero regressão).
   *
   * @param {string} gtin - GTIN já normalizado
   * @returns {Promise<ProdutoSnapshot|null>}
   */
  async buscarPorGtin(gtin) {
    if (!gtin || !this._helpers) return null;

    const emCache = produtoCache.buscarPorGtin(gtin);
    if (emCache) return emCache;

    await this._helpers.whenReady();

    if (this._mipHabilitado()) {
      const produtoId = await this._resolverProdutoIdViaMip(String(gtin));
      if (produtoId) {
        const viaMip = await this.buscarPorId(produtoId);
        if (viaMip) {
          // Garante chave GTIN no cache mesmo se codigo_barras do produto divergir
          produtoCache.armazenar(viaMip);
          return viaMip;
        }
      }
    }

    const row = await this._helpers.get(
      `SELECT ${COLUNAS_LEITURA} FROM produtos WHERE codigo_barras = ? LIMIT 1`,
      [gtin]
    );

    const snapshot = this._mapearSnapshot(row);
    if (snapshot) produtoCache.armazenar(snapshot);
    return snapshot;
  }

  /**
   * @private
   * Acumula hits por produtoId com motivos de match.
   * @param {Map<number, { snapshot: ProdutoSnapshot, motivos: Set<string> }>} mapa
   * @param {Object[]} rows
   * @param {string} motivo
   */
  _acumularHits(mapa, rows, motivo) {
    (rows || []).forEach((row) => {
      const snapshot = this._mapearSnapshot(row);
      if (!snapshot?.id) return;
      const atual = mapa.get(snapshot.id);
      if (atual) {
        atual.motivos.add(motivo);
        if (row.marca_nome && !atual.snapshot.marcaNome) {
          atual.snapshot.marcaNome = row.marca_nome;
        }
      } else {
        if (row.marca_nome) snapshot.marcaNome = row.marca_nome;
        mapa.set(snapshot.id, { snapshot, motivos: new Set([motivo]) });
      }
    });
  }

  /**
   * Busca universal de candidatos (RC9.3 / MUBC).
   * Engines não executam SQL — apenas este repository.
   *
   * @param {Object} filtros
   * @returns {Promise<Array<{ snapshot: ProdutoSnapshot, motivos: string[] }>>}
   */
  async buscarCandidatosUniversais(filtros = {}) {
    if (!this._helpers) return [];

    await this._helpers.whenReady();

    const mapa = new Map();
    const limite = Math.min(Math.max(Number(filtros.limite) || 60, 1), 120);
    const fromJoin = `FROM produtos p LEFT JOIN marcas m ON m.id = p.marca_id`;

    const gtin = filtros.gtin ? String(filtros.gtin).replace(/\D/g, '') : '';
    if (gtin) {
      const exato = await this._helpers.all(
        `SELECT ${COLUNAS_LEITURA_JOIN} ${fromJoin} WHERE p.codigo_barras = ? LIMIT 5`,
        [gtin]
      );
      this._acumularHits(mapa, exato, 'gtin_exato');

      if (gtin.length >= 8) {
        const parcial = gtin.slice(-8);
        const rowsParcial = await this._helpers.all(
          `SELECT ${COLUNAS_LEITURA_JOIN} ${fromJoin}
           WHERE p.codigo_barras IS NOT NULL
             AND REPLACE(p.codigo_barras, ' ', '') LIKE ?
             AND p.codigo_barras <> ?
           LIMIT 15`,
          [`%${parcial}%`, gtin]
        );
        this._acumularHits(mapa, rowsParcial, 'gtin_parcial');
      }
    }

    const codigoFornecedor = filtros.codigoFornecedor
      ? String(filtros.codigoFornecedor).trim()
      : '';
    if (codigoFornecedor) {
      const rowsCod = await this._helpers.all(
        `SELECT ${COLUNAS_LEITURA_JOIN} ${fromJoin}
         WHERE p.codigo = ? OR p.codigo = ?
         LIMIT 10`,
        [codigoFornecedor, String(codigoFornecedor).replace(/^0+/, '') || codigoFornecedor]
      );
      this._acumularHits(mapa, rowsCod, 'codigo_fornecedor');
    }

    const codigoInterno = filtros.codigoInterno ? String(filtros.codigoInterno).trim() : '';
    if (codigoInterno) {
      const rowsInt = await this._helpers.all(
        `SELECT ${COLUNAS_LEITURA_JOIN} ${fromJoin} WHERE p.codigo = ? LIMIT 5`,
        [codigoInterno]
      );
      this._acumularHits(mapa, rowsInt, 'codigo_interno');
    }

    const plu = filtros.plu ? String(filtros.plu).trim() : '';
    if (plu) {
      try {
        const rowsPlu = await this._helpers.all(
          `SELECT ${COLUNAS_LEITURA_JOIN} ${fromJoin}
           INNER JOIN produto_identificadores pi ON pi.produto_id = p.id
           WHERE UPPER(pi.tipo) = 'PLU' AND pi.codigo = ?
           LIMIT 5`,
          [plu]
        );
        this._acumularHits(mapa, rowsPlu, 'plu');
      } catch {
        /* tabela MIP opcional */
      }
    }

    const tokens = Array.isArray(filtros.tokens) ? filtros.tokens.filter(Boolean).slice(0, 6) : [];
    if (tokens.length >= 2) {
      const likes = tokens.slice(0, 3).map(() => 'UPPER(p.nome) LIKE ?');
      const params = tokens.slice(0, 3).map((t) => `%${String(t).toUpperCase()}%`);
      const rowsNome = await this._helpers.all(
        `SELECT ${COLUNAS_LEITURA_JOIN} ${fromJoin}
         WHERE ${likes.join(' AND ')}
         LIMIT 25`,
        params
      );
      this._acumularHits(mapa, rowsNome, 'descricao');
    } else if (tokens.length === 1) {
      const rowsNome = await this._helpers.all(
        `SELECT ${COLUNAS_LEITURA_JOIN} ${fromJoin}
         WHERE UPPER(p.nome) LIKE ?
         LIMIT 20`,
        [`%${String(tokens[0]).toUpperCase()}%`]
      );
      this._acumularHits(mapa, rowsNome, 'descricao');
    }

    const sinonimos = Array.isArray(filtros.sinonimos) ? filtros.sinonimos.slice(0, 4) : [];
    for (const sin of sinonimos) {
      if (!sin || String(sin).length < 3) continue;
      const rowsSin = await this._helpers.all(
        `SELECT ${COLUNAS_LEITURA_JOIN} ${fromJoin}
         WHERE UPPER(p.nome) LIKE ?
         LIMIT 10`,
        [`%${String(sin).toUpperCase()}%`]
      );
      this._acumularHits(mapa, rowsSin, 'sinonimo');
    }

    const marca = filtros.marca ? String(filtros.marca).trim() : '';
    if (marca && marca.length >= 2) {
      const rowsMarca = await this._helpers.all(
        `SELECT ${COLUNAS_LEITURA_JOIN} ${fromJoin}
         WHERE UPPER(m.nome) LIKE ? OR UPPER(p.nome) LIKE ?
         LIMIT 20`,
        [`%${marca.toUpperCase()}%`, `%${marca.toUpperCase()}%`]
      );
      this._acumularHits(mapa, rowsMarca, 'marca');
    }

    const ncm = filtros.ncm ? String(filtros.ncm).replace(/\D/g, '') : '';
    if (ncm) {
      const rowsNcm = await this._helpers.all(
        `SELECT ${COLUNAS_LEITURA_JOIN} ${fromJoin} WHERE p.ncm = ? LIMIT 30`,
        [ncm]
      );
      this._acumularHits(mapa, rowsNcm, 'ncm');
    }

    const cest = filtros.cest ? String(filtros.cest).replace(/\D/g, '') : '';
    if (cest) {
      const rowsCest = await this._helpers.all(
        `SELECT ${COLUNAS_LEITURA_JOIN} ${fromJoin} WHERE p.cest = ? LIMIT 20`,
        [cest]
      );
      this._acumularHits(mapa, rowsCest, 'cest');
    }

    return [...mapa.values()]
      .map((h) => ({ snapshot: h.snapshot, motivos: [...h.motivos] }))
      .slice(0, limite);
  }
}

module.exports = new ProdutoRepository();
module.exports.ProdutoRepository = ProdutoRepository;
