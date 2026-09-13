/**
 * ProdutoSnapshot — Representação imutável de produto carregado para os Engines.
 *
 * Sprint 3.1: evita novas consultas ao banco durante a identificação.
 * Produzido exclusivamente pelo `ProdutoRepository`.
 *
 * @class ProdutoSnapshot
 */

class ProdutoSnapshot {
  /**
   * @param {Object} [dados]
   * @param {number} [dados.id]
   * @param {string} [dados.codigo]
   * @param {string} [dados.codigo_barras]
   * @param {string} [dados.nome]
   * @param {string} [dados.unidade]
   * @param {string} [dados.ncm]
   * @param {string} [dados.cest]
   * @param {number|null} [dados.categoria_id]
   * @param {number|null} [dados.subcategoria_id]
   * @param {string} [dados.fornecedor]
   * @param {number|boolean} [dados.ativo]
   * @param {Object} [dados.atributos]
   * @param {Object} [dados.metadata]
   */
  constructor(dados = {}) {
    this.id = Number(dados.id ?? 0);
    this.codigo = dados.codigo ?? '';
    this.codigo_barras = dados.codigo_barras ?? dados.codigoBarras ?? '';
    this.nome = dados.nome ?? '';
    this.unidade = dados.unidade ?? '';
    this.ncm = dados.ncm ?? '';
    this.cest = dados.cest ?? '';
    this.categoria_id = dados.categoria_id ?? dados.categoriaId ?? null;
    this.subcategoria_id = dados.subcategoria_id ?? dados.subcategoriaId ?? null;
    this.fornecedor = dados.fornecedor ?? '';
    this.ativo = dados.ativo ?? 1;
    this.marcaNome = dados.marcaNome ?? dados.marca_nome ?? '';
    this.atributos = dados.atributos ?? {};
    this.metadata = dados.metadata ?? {};
  }

  /**
   * @param {Object|null|undefined} row
   * @returns {ProdutoSnapshot|null}
   */
  static fromRow(row) {
    if (!row) return null;

    return new ProdutoSnapshot({
      id: row.id,
      codigo: row.codigo,
      codigo_barras: row.codigo_barras,
      nome: row.nome,
      unidade: row.unidade,
      ncm: row.ncm,
      cest: row.cest,
      categoria_id: row.categoria_id,
      subcategoria_id: row.subcategoria_id,
      fornecedor: row.fornecedor,
      ativo: row.ativo,
      marcaNome: row.marca_nome ?? row.marcaNome ?? '',
      atributos: {},
      metadata: { origem: 'produtos', carregadoEm: new Date().toISOString() }
    });
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {ProdutoSnapshot|null}
   */
  static fromJSON(plain) {
    if (!plain) return null;
    return new ProdutoSnapshot(plain);
  }

  /**
   * Resumo compatível com campo legado `produto` em MiipCandidate.
   *
   * @returns {Object}
   */
  toResumo() {
    return {
      id: this.id,
      codigo: this.codigo,
      nome: this.nome,
      codigoBarras: this.codigo_barras,
      unidade: this.unidade,
      ncm: this.ncm,
      cest: this.cest,
      ativo: this.ativo,
      marca: this.marcaNome || null,
      fornecedor: this.fornecedor || null
    };
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      codigo: this.codigo,
      codigo_barras: this.codigo_barras,
      nome: this.nome,
      unidade: this.unidade,
      ncm: this.ncm,
      cest: this.cest,
      categoria_id: this.categoria_id,
      subcategoria_id: this.subcategoria_id,
      fornecedor: this.fornecedor,
      ativo: this.ativo,
      marcaNome: this.marcaNome,
      atributos: this.atributos,
      metadata: this.metadata
    };
  }
}

module.exports = ProdutoSnapshot;
