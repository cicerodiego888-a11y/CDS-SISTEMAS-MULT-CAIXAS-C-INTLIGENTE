/**
 * IdentidadeResultadoDTO — contrato de saída do MIP (Sprint 02).
 * @module motores/produto-identidade/contracts/IdentidadeResultadoDTO
 */

class IdentidadeResultadoDTO {
  /**
   * @param {Object} [dados]
   */
  constructor(dados = {}) {
    this.encontrado = dados.encontrado === true;
    this.habilitado = dados.habilitado !== false;
    this.produtoId = dados.produtoId != null ? Number(dados.produtoId) : null;
    this.produto = dados.produto || null;
    this.metodo = dados.metodo || null;
    this.strategy = dados.strategy || null;
    this.meta = dados.meta && typeof dados.meta === 'object' ? { ...dados.meta } : null;
    this.confianca = dados.confianca || null;
    this.codigoOriginal = dados.codigoOriginal != null ? String(dados.codigoOriginal) : null;
  }

  static naoEncontrado(extras = {}) {
    return new IdentidadeResultadoDTO({
      encontrado: false,
      habilitado: extras.habilitado !== false,
      codigoOriginal: extras.codigoOriginal || null,
      strategy: extras.strategy || null,
      metodo: extras.metodo || null,
      meta: extras.meta || null
    });
  }

  static desabilitado(codigoOriginal = null) {
    return new IdentidadeResultadoDTO({
      encontrado: false,
      habilitado: false,
      codigoOriginal,
      metodo: null,
      strategy: null,
      confianca: null
    });
  }

  static encontrado(params = {}) {
    return new IdentidadeResultadoDTO({
      encontrado: true,
      habilitado: true,
      produtoId: params.produtoId,
      produto: params.produto || null,
      metodo: params.metodo,
      strategy: params.strategy,
      meta: params.meta || null,
      confianca: params.confianca || 'ALTA',
      codigoOriginal: params.codigoOriginal || null
    });
  }

  toJSON() {
    return {
      encontrado: this.encontrado,
      habilitado: this.habilitado,
      produtoId: this.produtoId,
      produto: this.produto,
      metodo: this.metodo,
      strategy: this.strategy,
      meta: this.meta,
      confianca: this.confianca,
      codigoOriginal: this.codigoOriginal
    };
  }
}

module.exports = IdentidadeResultadoDTO;
