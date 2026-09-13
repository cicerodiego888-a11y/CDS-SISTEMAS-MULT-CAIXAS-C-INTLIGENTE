/**
 * DocumentoFiscal — Entidade de domínio do inbox fiscal.
 *
 * Sprint 1: modelo de dados sem regra de negócio complexa.
 *
 * @class DocumentoFiscal
 */

const { DocumentoFiscalStatus } = require('./DocumentoFiscalStatus');

class DocumentoFiscal {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.id = dados.id ?? null;
    this.chave = dados.chave ?? '';
    this.numero = dados.numero ?? null;
    this.serie = dados.serie ?? null;
    this.modelo = dados.modelo ?? '55';
    this.fornecedor = dados.fornecedor ?? null;
    this.cnpjFornecedor = dados.cnpjFornecedor ?? dados.cnpj_fornecedor ?? null;
    this.dataEmissao = dados.dataEmissao ?? dados.data_emissao ?? null;
    this.dataEntrada = dados.dataEntrada ?? dados.data_entrada ?? null;
    this.valorTotal = dados.valorTotal ?? dados.valor_total ?? null;
    this.xml = dados.xml ?? null;
    this.nsu = dados.nsu ?? null;
    this.origem = dados.origem ?? null;
    this.status = dados.status ?? DocumentoFiscalStatus.RECEBIDA;
    this.statusDetalhe = dados.statusDetalhe ?? dados.status_detalhe ?? null;
    this.parseJson = dados.parseJson ?? dados.parse_json ?? null;
    this.miipSessaoId = dados.miipSessaoId ?? dados.miip_sessao_id ?? null;
    this.miipResumoJson = dados.miipResumoJson ?? dados.miip_resumo_json ?? null;
    this.compraId = dados.compraId ?? dados.compra_id ?? null;
    this.usuarioId = dados.usuarioId ?? dados.usuario_id ?? null;
    this.processadoEm = dados.processadoEm ?? dados.processado_em ?? null;
    this.createdAt = dados.createdAt ?? dados.created_at ?? null;
    this.updatedAt = dados.updatedAt ?? dados.updated_at ?? null;
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {DocumentoFiscal}
   */
  static create(plain) {
    return new DocumentoFiscal(plain || {});
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      chave: this.chave,
      numero: this.numero,
      serie: this.serie,
      modelo: this.modelo,
      fornecedor: this.fornecedor,
      cnpjFornecedor: this.cnpjFornecedor,
      dataEmissao: this.dataEmissao,
      dataEntrada: this.dataEntrada,
      valorTotal: this.valorTotal,
      nsu: this.nsu,
      origem: this.origem,
      status: this.status,
      statusDetalhe: this.statusDetalhe,
      miipSessaoId: this.miipSessaoId,
      compraId: this.compraId,
      usuarioId: this.usuarioId,
      processadoEm: this.processadoEm,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = DocumentoFiscal;
