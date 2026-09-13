/**
 * NfeItemParseadoDTO — Item de NF-e parseado (contrato estável do ERP).
 * RC8.5.1 — campos fiscais/embalagem ampliados para cadastro inteligente MIIP.
 *
 * @class NfeItemParseadoDTO
 */

class NfeItemParseadoDTO {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.produtoNome = dados.produtoNome ?? dados.produto_nome ?? '';
    this.codigoFornecedor = dados.codigoFornecedor ?? dados.codigo_fornecedor ?? '';
    this.codigoBarras = dados.codigoBarras ?? dados.codigo_barras ?? '';
    this.gtin = dados.gtin ?? dados.codigoBarras ?? dados.codigo_barras ?? '';
    this.ncm = dados.ncm ?? '';
    this.cest = dados.cest ?? '';
    this.cfop = dados.cfop ?? '';
    this.unidade = dados.unidade ?? 'UN';
    this.unidadeTributavel = dados.unidadeTributavel ?? dados.unidade_tributavel ?? dados.uTrib ?? '';
    this.quantidade = Number(dados.quantidade ?? 0);
    this.quantidadeTributavel = Number(dados.quantidadeTributavel ?? dados.quantidade_tributavel ?? dados.qTrib ?? 0);
    this.precoUnitario = Number(dados.precoUnitario ?? dados.preco_unitario ?? 0);
    this.precoUnitarioTrib = Number(dados.precoUnitarioTrib ?? dados.preco_unitario_trib ?? dados.vUnTrib ?? 0);
    this.subtotal = Number(dados.subtotal ?? 0);
    // CORREÇÃO-NF-MARGEM-01 — não fabricar margem 30% nem venda ×1.3.
    // Ausência = null até o produto vinculado fornecer lucro_percentual.
    const margemRaw = dados.margemLucro ?? dados.margem_lucro;
    if (margemRaw === undefined || margemRaw === null || margemRaw === '') {
      this.margemLucro = null;
    } else {
      const margemNum = Number(margemRaw);
      this.margemLucro = Number.isFinite(margemNum) ? margemNum : null;
    }
    const vendaRaw = dados.precoVendaSugerido ?? dados.preco_venda_sugerido;
    if (vendaRaw === undefined || vendaRaw === null || vendaRaw === '') {
      this.precoVendaSugerido = null;
    } else {
      const vendaNum = Number(vendaRaw);
      this.precoVendaSugerido = Number.isFinite(vendaNum) ? vendaNum : null;
    }
    this.csosn = dados.csosn ?? '';
    this.cst = dados.cst ?? '';
    this.cstPis = dados.cstPis ?? dados.cst_pis ?? '';
    this.cstCofins = dados.cstCofins ?? dados.cst_cofins ?? '';
    this.cstIpi = dados.cstIpi ?? dados.cst_ipi ?? '';
    this.origem = dados.origem != null && dados.origem !== '' ? Number(dados.origem) : null;
    this.infAdProd = dados.infAdProd ?? dados.inf_ad_prod ?? dados.descricao_complementar ?? '';
    this.pesoLiquido = Number(dados.pesoLiquido ?? dados.peso_liquido ?? dados.pesoB ?? 0);
    this.pesoBruto = Number(dados.pesoBruto ?? dados.peso_bruto ?? dados.pesoA ?? 0);
    this.produtoId = dados.produtoId ?? dados.produto_id ?? undefined;
    this.miipResultado = dados.miipResultado ?? dados.miip_resultado ?? undefined;
    this.miipSugestao = dados.miipSugestao ?? dados.miip_sugestao ?? undefined;
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {NfeItemParseadoDTO}
   */
  static create(plain) {
    return new NfeItemParseadoDTO(plain || {});
  }

  /**
   * Formato JSON compatível com POST /api/compras/parse-xml e MIIP.
   *
   * @returns {Object}
   */
  toJSON() {
    const json = {
      produto_nome: this.produtoNome,
      codigo_fornecedor: this.codigoFornecedor,
      codigo_barras: this.codigoBarras,
      gtin: this.gtin || this.codigoBarras,
      ncm: this.ncm,
      cest: this.cest,
      cfop: this.cfop,
      unidade: this.unidade,
      unidade_tributavel: this.unidadeTributavel,
      uCom: this.unidade,
      uTrib: this.unidadeTributavel,
      quantidade: this.quantidade,
      quantidade_tributavel: this.quantidadeTributavel,
      qTrib: this.quantidadeTributavel,
      preco_unitario: this.precoUnitario,
      valor_unitario: this.precoUnitario,
      preco_unitario_trib: this.precoUnitarioTrib,
      subtotal: this.subtotal,
      valor_total: this.subtotal,
      margem_lucro: this.margemLucro,
      preco_venda_sugerido: this.precoVendaSugerido,
      csosn: this.csosn || this.cst,
      cst: this.cst,
      cst_pis: this.cstPis,
      cst_cofins: this.cstCofins,
      cst_ipi: this.cstIpi,
      origem: this.origem,
      descricao_complementar: this.infAdProd,
      inf_ad_prod: this.infAdProd,
      peso_liquido: this.pesoLiquido,
      peso_bruto: this.pesoBruto
    };

    if (this.produtoId != null) json.produto_id = this.produtoId;
    if (this.miipResultado != null) json.miip_resultado = this.miipResultado;
    if (this.miipSugestao != null) json.miip_sugestao = this.miipSugestao;

    return json;
  }
}

module.exports = NfeItemParseadoDTO;
