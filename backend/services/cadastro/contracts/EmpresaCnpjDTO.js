'use strict';

/**
 * EmpresaCnpjDTO — Contrato interno de dados cadastrais de empresa (PJ).
 * Independente de qualquer API/provider externo (Sprint 1 — fundação).
 *
 * DTO ≠ schema de banco. Campos aqui podem não existir nas tabelas ainda.
 *
 * @class EmpresaCnpjDTO
 * @module services/cadastro/contracts/EmpresaCnpjDTO
 */

class EmpresaCnpjDTO {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.cnpj = dados.cnpj ?? dados.cpf_cnpj ?? null;
    this.razaoSocial = dados.razaoSocial ?? dados.razao_social ?? null;
    this.nomeFantasia = dados.nomeFantasia ?? dados.nome_fantasia ?? null;
    this.inscricaoEstadual = dados.inscricaoEstadual ?? dados.inscricao_estadual ?? null;
    this.situacaoCadastral = dados.situacaoCadastral ?? dados.situacao_cadastral ?? null;
    this.cep = dados.cep ?? null;
    this.logradouro = dados.logradouro ?? dados.rua ?? null;
    this.numero = dados.numero ?? null;
    this.complemento = dados.complemento ?? null;
    this.bairro = dados.bairro ?? null;
    this.municipio = dados.municipio ?? dados.cidade ?? null;
    this.uf = dados.uf ?? null;
    this.codigoMunicipio = dados.codigoMunicipio ?? dados.codigo_municipio ?? null;
    this.telefone = dados.telefone ?? null;
    this.email = dados.email ?? null;
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {EmpresaCnpjDTO}
   */
  static create(plain) {
    return new EmpresaCnpjDTO(plain || {});
  }

  /**
   * Payload parcial compatível com POST/PUT de fornecedores (campos existentes).
   * Não inventa colunas ausentes no banco.
   *
   * @returns {Object}
   */
  toFornecedorPayload() {
    const payload = {};
    if (this.cnpj != null) payload.cpf_cnpj = this.cnpj;
    if (this.razaoSocial != null) payload.razao_social = this.razaoSocial;
    if (this.nomeFantasia != null) payload.nome = this.nomeFantasia || this.razaoSocial;
    else if (this.razaoSocial != null) payload.nome = this.razaoSocial;
    if (this.inscricaoEstadual != null) payload.inscricao_estadual = this.inscricaoEstadual;
    if (this.cep != null) payload.cep = this.cep;
    if (this.logradouro != null) payload.rua = this.logradouro;
    if (this.numero != null) payload.numero = this.numero;
    if (this.bairro != null) payload.bairro = this.bairro;
    if (this.municipio != null) payload.cidade = this.municipio;
    if (this.uf != null) payload.uf = this.uf;
    if (this.telefone != null) payload.telefone = this.telefone;
    if (this.email != null) payload.email = this.email;
    return payload;
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      cnpj: this.cnpj,
      razaoSocial: this.razaoSocial,
      nomeFantasia: this.nomeFantasia,
      inscricaoEstadual: this.inscricaoEstadual,
      situacaoCadastral: this.situacaoCadastral,
      cep: this.cep,
      logradouro: this.logradouro,
      numero: this.numero,
      complemento: this.complemento,
      bairro: this.bairro,
      municipio: this.municipio,
      uf: this.uf,
      codigoMunicipio: this.codigoMunicipio,
      telefone: this.telefone,
      email: this.email
    };
  }
}

module.exports = EmpresaCnpjDTO;
