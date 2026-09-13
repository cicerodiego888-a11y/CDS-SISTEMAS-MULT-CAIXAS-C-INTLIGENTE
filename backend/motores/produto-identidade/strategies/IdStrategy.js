/**
 * IdStrategy — resolve por produtos.id (Sprint 02).
 */

const IdentidadeStrategyBase = require('./IdentidadeStrategyBase');
const IdentidadeResultadoDTO = require('../contracts/IdentidadeResultadoDTO');
const { TIPOS_IDENTIFICADOR } = require('../constants/tiposIdentificador');

class IdStrategy extends IdentidadeStrategyBase {
  constructor(deps = {}) {
    super();
    this._catalogo = deps.catalogo;
  }

  get nome() {
    return 'ID';
  }

  canHandle(codigo, contexto, deteccao) {
    const candidatos = deteccao?.candidatos || [];
    if (!candidatos.includes(TIPOS_IDENTIFICADOR.ID)) return false;
    const digitos = deteccao?.digitos || String(codigo || '').replace(/\D/g, '');
    const n = Number(digitos);
    return Number.isInteger(n) && n > 0;
  }

  async resolve(codigo, contexto, deteccao) {
    if (!this._catalogo) return null;
    const digitos = deteccao?.digitos || String(codigo || '').replace(/\D/g, '');
    const id = Number(digitos);
    if (!Number.isInteger(id) || id <= 0) return null;

    const produto = await this._catalogo.buscarProdutoPorId(id);
    if (!produto) return null;

    return IdentidadeResultadoDTO.encontrado({
      produtoId: produto.id,
      produto,
      metodo: TIPOS_IDENTIFICADOR.ID,
      strategy: this.nome,
      codigoOriginal: deteccao?.bruto ?? String(codigo),
      confianca: 'ALTA'
    });
  }
}

module.exports = IdStrategy;
