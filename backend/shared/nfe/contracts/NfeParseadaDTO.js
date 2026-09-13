/**
 * NfeParseadaDTO — Saída oficial do pipeline de parse NF-e do CDS Sistemas.
 *
 * Contrato estável consumido por Compras, Central de Entradas (futuro) e demais entradas XML.
 *
 * @class NfeParseadaDTO
 */

const NfeItemParseadoDTO = require('./NfeItemParseadoDTO');

class NfeParseadaDTO {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.chaveAcesso = dados.chaveAcesso ?? dados.chave_acesso ?? '';
    this.numeroNf = dados.numeroNf ?? dados.numero_nf ?? '';
    this.serieNf = dados.serieNf ?? dados.serie_nf ?? '';
    this.modeloNf = dados.modeloNf ?? dados.modelo_nf ?? '55';
    this.dataEmissao = dados.dataEmissao ?? dados.data_emissao ?? '';
    this.dataEntrada = dados.dataEntrada ?? dados.data_entrada ?? '';
    this.fornecedor = dados.fornecedor ?? '';
    this.fornecedorCnpj = dados.fornecedorCnpj ?? dados.fornecedor_cnpj ?? '';
    this.fornecedorRua = dados.fornecedorRua ?? dados.fornecedor_rua ?? '';
    this.fornecedorNumero = dados.fornecedorNumero ?? dados.fornecedor_numero ?? '';
    this.fornecedorBairro = dados.fornecedorBairro ?? dados.fornecedor_bairro ?? '';
    this.fornecedorCidade = dados.fornecedorCidade ?? dados.fornecedor_cidade ?? '';
    this.fornecedorUf = dados.fornecedorUf ?? dados.fornecedor_uf ?? '';
    this.fornecedorCep = dados.fornecedorCep ?? dados.fornecedor_cep ?? '';
    this.fornecedorEndereco = dados.fornecedorEndereco ?? dados.fornecedor_endereco ?? '';
    this.valorProdutos = Number(dados.valorProdutos ?? dados.valor_produtos ?? 0);
    this.valorDesconto = Number(dados.valorDesconto ?? dados.valor_desconto ?? 0);
    this.valorFrete = Number(dados.valorFrete ?? dados.valor_frete ?? 0);
    this.valorSeguro = Number(dados.valorSeguro ?? dados.valor_seguro ?? 0);
    this.valorOutrasDespesas = Number(dados.valorOutrasDespesas ?? dados.valor_outras_despesas ?? 0);
    this.valorIpi = Number(dados.valorIpi ?? dados.valor_ipi ?? 0);
    this.valorTotalNota = Number(dados.valorTotalNota ?? dados.valor_total_nota ?? 0);
    this.observacao = dados.observacao ?? '';
    // RC COMPRAS 5.4.1 — financeiro importado do XML
    this.formaPagamento = dados.formaPagamento ?? dados.forma_pagamento ?? null;
    this.condicaoPagamento = dados.condicaoPagamento ?? dados.condicao_pagamento ?? null;
    this.pagamentos = Array.isArray(dados.pagamentos) ? dados.pagamentos : [];
    this.duplicatas = Array.isArray(dados.duplicatas) ? dados.duplicatas : [];
    this.fatura = dados.fatura ?? null;
    this.parcelas = Number(dados.parcelas ?? 1) || 1;
    this.parcelasDetalhe = Array.isArray(dados.parcelasDetalhe)
      ? dados.parcelasDetalhe
      : (Array.isArray(dados.parcelas_detalhe) ? dados.parcelas_detalhe : []);
    this.dataVencimento = dados.dataVencimento ?? dados.data_vencimento ?? null;
    this.itens = (dados.itens || []).map((item) => (
      item instanceof NfeItemParseadoDTO ? item : NfeItemParseadoDTO.create(item)
    ));
    this.miipImportacao = dados.miipImportacao ?? dados.miip_importacao ?? undefined;
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {NfeParseadaDTO}
   */
  static create(plain) {
    return new NfeParseadaDTO(plain || {});
  }

  /**
   * Formato JSON compatível com POST /api/compras/parse-xml / abrir-compra.
   *
   * @returns {Object}
   */
  toJSON() {
    const json = {
      chave_acesso: this.chaveAcesso,
      numero_nf: this.numeroNf,
      serie_nf: this.serieNf,
      modelo_nf: this.modeloNf,
      data_emissao: this.dataEmissao,
      data_entrada: this.dataEntrada,
      fornecedor: this.fornecedor,
      fornecedor_cnpj: this.fornecedorCnpj,
      fornecedor_rua: this.fornecedorRua,
      fornecedor_numero: this.fornecedorNumero,
      fornecedor_bairro: this.fornecedorBairro,
      fornecedor_cidade: this.fornecedorCidade,
      fornecedor_uf: this.fornecedorUf,
      fornecedor_cep: this.fornecedorCep,
      fornecedor_endereco: this.fornecedorEndereco,
      valor_produtos: this.valorProdutos,
      valor_desconto: this.valorDesconto,
      valor_frete: this.valorFrete,
      valor_seguro: this.valorSeguro,
      valor_outras_despesas: this.valorOutrasDespesas,
      valor_ipi: this.valorIpi,
      valor_total_nota: this.valorTotalNota,
      observacao: this.observacao,
      forma_pagamento: this.formaPagamento,
      condicao_pagamento: this.condicaoPagamento,
      pagamentos: this.pagamentos,
      duplicatas: this.duplicatas,
      fatura: this.fatura,
      parcelas: this.parcelas,
      parcelas_detalhe: this.parcelasDetalhe,
      data_vencimento: this.dataVencimento,
      itens: this.itens.map((item) => item.toJSON())
    };

    if (this.miipImportacao != null) {
      json.miip_importacao = this.miipImportacao;
    }

    return json;
  }
}

module.exports = NfeParseadaDTO;
