/**
 * CentralFiltroDTO — Contrato de filtros da listagem do inbox.
 *
 * @class CentralFiltroDTO
 */

const { normalizarFiltros } = require('../utils/paginacaoCentral');

class CentralFiltroDTO {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    const paginacao = normalizarFiltros(dados);

    this.status = dados.status || null;
    this.busca = dados.busca || null;
    this.cnpjFornecedor = dados.cnpjFornecedor || dados.cnpj_fornecedor || null;
    this.dataEmissaoInicio = dados.dataEmissaoInicio || dados.data_emissao_inicio || null;
    this.dataEmissaoFim = dados.dataEmissaoFim || dados.data_emissao_fim || null;
    this.origem = dados.origem || null;
    this.filtroRapido = dados.filtroRapido || dados.filtro_rapido || null;
    this.createdAtInicio = dados.createdAtInicio || dados.created_at_inicio || null;
    this.createdAtFim = dados.createdAtFim || dados.created_at_fim || null;
    this.limite = paginacao.limite;
    this.offset = paginacao.offset;
    this.pagina = paginacao.pagina;
    this.ordenarPor = paginacao.ordenarPor;
    this.ordenarDirecao = paginacao.ordenarDirecao;
  }

  /**
   * @param {Object|null|undefined} plain
   * @returns {CentralFiltroDTO}
   */
  static create(plain) {
    return new CentralFiltroDTO(plain || {});
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return {
      status: this.status,
      busca: this.busca,
      cnpjFornecedor: this.cnpjFornecedor,
      dataEmissaoInicio: this.dataEmissaoInicio,
      dataEmissaoFim: this.dataEmissaoFim,
      origem: this.origem,
      filtroRapido: this.filtroRapido,
      createdAtInicio: this.createdAtInicio,
      createdAtFim: this.createdAtFim,
      limite: this.limite,
      offset: this.offset,
      pagina: this.pagina,
      ordenarPor: this.ordenarPor,
      ordenarDirecao: this.ordenarDirecao
    };
  }
}

module.exports = CentralFiltroDTO;
