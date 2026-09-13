/**
 * SemanticProduct — Representação semântica estruturada de um produto.
 *
 * Sprint 7.2 — contrato de domínio da Fase 2.
 * Todos os campos semânticos iniciam nulos; nenhuma extração nesta sprint.
 *
 * @class SemanticProduct
 */

const CanonicalToken = require('./CanonicalToken');
const SemanticAttribute = require('./SemanticAttribute');
const SemanticMetadata = require('./SemanticMetadata');

const VERSAO_PADRAO = '1.0.0';

/** @type {string[]} */
const CAMPOS_SEMANTICOS = [
  'original',
  'canonico',
  'tipo',
  'categoria',
  'subcategoria',
  'marca',
  'modelo',
  'linha',
  'familia',
  'tecnologia',
  'potencia',
  'tensao',
  'corrente',
  'cor',
  'material',
  'acabamento',
  'bitola',
  'diametro',
  'comprimento',
  'largura',
  'altura',
  'espessura',
  'peso',
  'volume',
  'capacidade',
  'unidadeMedida',
  'embalagem',
  'quantidadeEmbalagem',
  'ncm',
  'cest',
  'gtin',
  'tokens',
  'normalizedTokens',
  'synonyms',
  'relatedTokens',
  'semanticAliases',
  'atributosExtras',
  'metadata'
];

class SemanticProduct {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.original = dados.original ?? null;
    this.canonico = dados.canonico ?? null;
    this.tipo = dados.tipo ?? null;
    this.categoria = dados.categoria ?? null;
    this.subcategoria = dados.subcategoria ?? null;
    this.marca = dados.marca ?? null;
    this.modelo = dados.modelo ?? null;
    this.linha = dados.linha ?? null;
    this.familia = dados.familia ?? null;
    this.tecnologia = dados.tecnologia ?? null;
    this.potencia = dados.potencia ?? null;
    this.tensao = dados.tensao ?? null;
    this.corrente = dados.corrente ?? null;
    this.cor = dados.cor ?? null;
    this.material = dados.material ?? null;
    this.acabamento = dados.acabamento ?? null;
    this.bitola = dados.bitola ?? null;
    this.diametro = dados.diametro ?? null;
    this.comprimento = dados.comprimento ?? null;
    this.largura = dados.largura ?? null;
    this.altura = dados.altura ?? null;
    this.espessura = dados.espessura ?? null;
    this.peso = dados.peso ?? null;
    this.volume = dados.volume ?? null;
    this.capacidade = dados.capacidade ?? null;
    this.unidadeMedida = dados.unidadeMedida ?? null;
    this.embalagem = dados.embalagem ?? null;
    this.quantidadeEmbalagem = dados.quantidadeEmbalagem ?? null;
    this.ncm = dados.ncm ?? null;
    this.cest = dados.cest ?? null;
    this.gtin = dados.gtin ?? null;
    this.tokens = dados.tokens ?? null;
    this.normalizedTokens = dados.normalizedTokens ?? null;
    this.synonyms = dados.synonyms ?? null;
    this.relatedTokens = dados.relatedTokens ?? null;
    this.semanticAliases = dados.semanticAliases ?? null;
    this.atributosExtras = dados.atributosExtras ?? null;
    this.metadata = dados.metadata instanceof SemanticMetadata
      ? dados.metadata
      : (dados.metadata ? SemanticMetadata.create(dados.metadata) : null);

    if (Array.isArray(this.tokens)) {
      this.tokens = [...this.tokens];
    }

    if (Array.isArray(this.normalizedTokens)) {
      this.normalizedTokens = this.normalizedTokens.map((token) => (
        token instanceof CanonicalToken ? token : CanonicalToken.create(token)
      ));
    }

    if (Array.isArray(this.synonyms)) {
      this.synonyms = this.synonyms.map((synonym) => (
        synonym && typeof synonym.toJSON === 'function' ? synonym : { ...synonym }
      ));
    }

    if (Array.isArray(this.relatedTokens)) {
      this.relatedTokens = [...this.relatedTokens];
    }

    if (Array.isArray(this.semanticAliases)) {
      this.semanticAliases = [...this.semanticAliases];
    }

    if (Array.isArray(this.atributosExtras)) {
      this.atributosExtras = this.atributosExtras.map((attr) => (
        attr instanceof SemanticAttribute ? attr : SemanticAttribute.create(attr)
      ));
    }
  }

  /**
   * @param {Object} [dados]
   * @returns {SemanticProduct}
   */
  static create(dados = {}) {
    return new SemanticProduct(dados);
  }

  /**
   * Valida presença estrutural dos campos do contrato.
   *
   * @returns {{ valido: boolean, campos: string[], ausentes: string[] }}
   */
  static validarEstrutura(instancia) {
    const ausentes = CAMPOS_SEMANTICOS.filter(
      (campo) => !Object.prototype.hasOwnProperty.call(instancia, campo)
    );

    return {
      valido: ausentes.length === 0,
      campos: [...CAMPOS_SEMANTICOS],
      ausentes
    };
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      original: this.original,
      canonico: this.canonico,
      tipo: this.tipo,
      categoria: this.categoria,
      subcategoria: this.subcategoria,
      marca: this.marca,
      modelo: this.modelo,
      linha: this.linha,
      familia: this.familia,
      tecnologia: this.tecnologia,
      potencia: this.potencia,
      tensao: this.tensao,
      corrente: this.corrente,
      cor: this.cor,
      material: this.material,
      acabamento: this.acabamento,
      bitola: this.bitola,
      diametro: this.diametro,
      comprimento: this.comprimento,
      largura: this.largura,
      altura: this.altura,
      espessura: this.espessura,
      peso: this.peso,
      volume: this.volume,
      capacidade: this.capacidade,
      unidadeMedida: this.unidadeMedida,
      embalagem: this.embalagem,
      quantidadeEmbalagem: this.quantidadeEmbalagem,
      ncm: this.ncm,
      cest: this.cest,
      gtin: this.gtin,
      tokens: this.tokens,
      normalizedTokens: Array.isArray(this.normalizedTokens)
        ? this.normalizedTokens.map((token) => token.toJSON())
        : this.normalizedTokens,
      synonyms: Array.isArray(this.synonyms)
        ? this.synonyms.map((synonym) => (
          synonym && typeof synonym.toJSON === 'function' ? synonym.toJSON() : synonym
        ))
        : this.synonyms,
      relatedTokens: this.relatedTokens,
      semanticAliases: this.semanticAliases,
      atributosExtras: Array.isArray(this.atributosExtras)
        ? this.atributosExtras.map((attr) => attr.toJSON())
        : this.atributosExtras,
      metadata: this.metadata ? this.metadata.toJSON() : null
    };
  }
}

SemanticProduct.VERSAO_PADRAO = VERSAO_PADRAO;
SemanticProduct.CAMPOS = CAMPOS_SEMANTICOS;

module.exports = SemanticProduct;
