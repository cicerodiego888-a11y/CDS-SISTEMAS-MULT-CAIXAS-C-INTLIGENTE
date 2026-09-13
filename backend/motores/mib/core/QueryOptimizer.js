'use strict';

/**
 * Estratégias SQL otimizadas — sem LOWER/REPLACE em coluna, sem OR gigante.
 * Ordem: código → barras → PLU → referência → nome inicia → nome contém → marca.
 */
class QueryOptimizer {
  /**
   * @param {import('sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * @param {string} sql
   * @param {any[]} params
   * @returns {Promise<object[]>}
   */
  _all(sql, params) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  _selectBase() {
    return `
      SELECT
        p.id,
        p.codigo,
        p.codigo_barras,
        p.nome,
        p.nome_busca,
        p.unidade,
        COALESCE(p.unidade_comercial, 'UN') AS unidade_comercial,
        COALESCE(p.quantidade_por_embalagem, 0) AS quantidade_por_embalagem,
        COALESCE(p.compra_por_embalagem, 0) AS compra_por_embalagem,
        COALESCE(p.valor_compra_embalagem, 0) AS valor_compra_embalagem,
        p.preco_compra,
        p.preco_venda,
        (
          SELECT pi.codigo FROM produto_identificadores pi
          WHERE pi.produto_id = p.id
            AND pi.tipo = 'PLU'
            AND COALESCE(pi.ativo, 1) = 1
            AND COALESCE(pi.principal, 0) = 1
          ORDER BY pi.id DESC
          LIMIT 1
        ) AS plu,
        (SELECT preco_atacado FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS preco_atacado,
        (SELECT quantidade_minima FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS quantidade_minima_atacado,
        p.estoque_atual,
        COALESCE(p.saldo_fiscal, 0) AS saldo_fiscal,
        COALESCE(p.saldo_nao_fiscal, 0) AS saldo_nao_fiscal,
        COALESCE(p.item_fiscal, 1) AS item_fiscal,
        COALESCE(p.controla_estoque, 1) AS controla_estoque,
        p.estoque_minimo,
        p.vendido_por_peso,
        COALESCE(p.produto_fracionado, p.vendido_por_peso, 0) AS produto_fracionado,
        COALESCE(p.permite_venda_unidade, 0) AS permite_venda_unidade,
        COALESCE(p.peso_medio_unidade, 0) AS peso_medio_unidade,
        COALESCE(p.preco_unidade, 0) AS preco_unidade,
        COALESCE(m.nome, '') AS marca,
        CASE WHEN promo.id IS NOT NULL THEN 1 ELSE 0 END AS tem_promocao,
        CASE WHEN promo.id IS NOT NULL THEN promo.preco_promocional ELSE NULL END AS preco_promocional,
        CASE WHEN promo.id IS NOT NULL THEN promo.desconto_percentual ELSE NULL END AS desconto_percentual
      FROM produtos p
      LEFT JOIN marcas m ON m.id = p.marca_id
      LEFT JOIN promocoes promo ON promo.produto_id = p.id
        AND promo.status = 'ativa'
        AND date(promo.data_inicio) <= date(?)
        AND date(promo.data_fim) >= date(?)
    `;
  }

  _filtroFiscal(modoFiscal) {
    return modoFiscal ? ' AND COALESCE(p.item_fiscal, 1) = 1' : '';
  }

  _hoje() {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Executa estratégias em ordem até atingir limite ou esgotar.
   * @param {{ termoRaw: string, termoNorm: string, limite: number, modoFiscal: boolean, signal?: { cancelled: boolean } }} opts
   */
  async buscar(opts) {
    const termoRaw = String(opts.termoRaw || '').trim();
    const termoNorm = String(opts.termoNorm || '');
    const limite = Math.min(Math.max(Number(opts.limite) || 20, 1), 100);
    const modoFiscal = opts.modoFiscal === true;
    const signal = opts.signal || { cancelled: false };
    const hoje = this._hoje();
    const fiscal = this._filtroFiscal(modoFiscal);

    // STABLE-1.0 — sem LIKE '%x%', sem LOWER/REPLACE em coluna.
    // Contém/marca ficam no catálogo em memória (SearchEngine), não no SQL.
    const strategies = [
      { nome: 'codigo', run: () => this.porCodigo(termoRaw, limite, fiscal, hoje) },
      { nome: 'codigo_barras', run: () => this.porCodigoBarras(termoRaw, limite, fiscal, hoje) },
      { nome: 'plu', run: () => this.porPlu(termoRaw, limite, fiscal, hoje) },
      { nome: 'referencia', run: () => this.porReferencia(termoRaw, limite, fiscal, hoje) },
      { nome: 'nome_inicia', run: () => this.porNomeInicia(termoNorm, limite, fiscal, hoje) }
    ];

    /** @type {Map<number, object>} */
    const mapa = new Map();
    let estrategiaVencedora = null;

    for (const s of strategies) {
      if (signal.cancelled) break;
      if (!termoRaw && s.nome !== 'nome_inicia' && s.nome !== 'nome_contem' && s.nome !== 'marca') {
        continue;
      }
      if ((s.nome === 'nome_inicia' || s.nome === 'nome_contem' || s.nome === 'marca') && !termoNorm) {
        continue;
      }

      const rows = await s.run();
      if (signal.cancelled) break;

      for (const row of rows) {
        const id = Number(row.id);
        if (!mapa.has(id)) {
          mapa.set(id, { ...row, mib_estrategia: s.nome, match_exato: ['codigo', 'codigo_barras', 'plu'].includes(s.nome) ? 1 : 0 });
        }
      }

      if (mapa.size > 0 && !estrategiaVencedora) estrategiaVencedora = s.nome;
      if (mapa.size >= limite && ['codigo', 'codigo_barras', 'plu'].includes(s.nome)) {
        break;
      }
      if (mapa.size >= limite && s.nome === 'nome_inicia') {
        break;
      }
    }

    return {
      itens: [...mapa.values()].slice(0, limite * 3),
      estrategia: estrategiaVencedora
    };
  }

  async porCodigo(termo, limite, fiscal, hoje) {
    const sql = `
      ${this._selectBase()}
      WHERE COALESCE(p.ativo, 1) = 1
        AND p.codigo = ?
        ${fiscal}
      LIMIT ?
    `;
    return this._all(sql, [hoje, hoje, termo, limite]);
  }

  async porCodigoBarras(termo, limite, fiscal, hoje) {
    const sql = `
      ${this._selectBase()}
      WHERE COALESCE(p.ativo, 1) = 1
        AND (
          p.codigo_barras = ?
          OR EXISTS (
            SELECT 1 FROM produto_identificadores pi
            WHERE pi.produto_id = p.id
              AND pi.tipo IN ('EAN8', 'EAN13', 'GTIN')
              AND COALESCE(pi.ativo, 1) = 1
              AND pi.codigo = ?
          )
        )
        ${fiscal}
      LIMIT ?
    `;
    return this._all(sql, [hoje, hoje, termo, termo, limite]);
  }

  async porPlu(termo, limite, fiscal, hoje) {
    const sql = `
      ${this._selectBase()}
      INNER JOIN produto_identificadores pi ON pi.produto_id = p.id
        AND pi.tipo = 'PLU'
        AND COALESCE(pi.ativo, 1) = 1
        AND pi.codigo = ?
      WHERE COALESCE(p.ativo, 1) = 1
        ${fiscal}
      LIMIT ?
    `;
    return this._all(sql, [hoje, hoje, termo, limite]);
  }

  /** Referência = prefixo de codigo interno (coluna referencia não existe no schema). */
  async porReferencia(termo, limite, fiscal, hoje) {
    if (!termo || termo.length < 2) return [];
    const sql = `
      ${this._selectBase()}
      WHERE COALESCE(p.ativo, 1) = 1
        AND p.codigo LIKE ? || '%'
        ${fiscal}
      ORDER BY p.codigo ASC
      LIMIT ?
    `;
    return this._all(sql, [hoje, hoje, termo, limite]);
  }

  async porNomeInicia(termoNorm, limite, fiscal, hoje) {
    if (!termoNorm) return [];
    const sql = `
      ${this._selectBase()}
      WHERE COALESCE(p.ativo, 1) = 1
        AND p.nome_busca LIKE ? || '%'
        ${fiscal}
      ORDER BY p.nome_busca ASC
      LIMIT ?
    `;
    return this._all(sql, [hoje, hoje, termoNorm, limite]);
  }

  /**
   * @deprecated STABLE-1.0 — contém via catálogo em memória; SQL não usa leading %.
   */
  async porNomeContem() {
    return [];
  }

  /**
   * @deprecated STABLE-1.0 — marca via catálogo em memória; sem LOWER/REPLACE.
   */
  async porMarca() {
    return [];
  }
}

module.exports = QueryOptimizer;
