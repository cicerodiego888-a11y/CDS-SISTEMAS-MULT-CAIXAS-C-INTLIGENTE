/**
 * GtinStrategy — resolve GTIN-14 (Sprint 02).
 */

const IdentidadeStrategyBase = require('./IdentidadeStrategyBase');
const IdentidadeResultadoDTO = require('../contracts/IdentidadeResultadoDTO');
const { TIPOS_IDENTIFICADOR } = require('../constants/tiposIdentificador');
const { normalizarCodigoIdentificador } = require('../normalizers/normalizarCodigoIdentificador');

class GtinStrategy extends IdentidadeStrategyBase {
  constructor(deps = {}) {
    super();
    this._catalogo = deps.catalogo;
  }

  get nome() {
    return 'GTIN';
  }

  canHandle(codigo, contexto, deteccao) {
    const candidatos = deteccao?.candidatos || [];
    if (candidatos.includes(TIPOS_IDENTIFICADOR.GTIN)) return true;
    const digitos = deteccao?.digitos || String(codigo || '').replace(/\D/g, '');
    return digitos.length === 14;
  }

  async resolve(codigo, contexto, deteccao) {
    if (!this._catalogo) return null;
    const bruto = deteccao?.bruto ?? String(codigo ?? '');
    const digitos = normalizarCodigoIdentificador(
      deteccao?.digitos || bruto,
      TIPOS_IDENTIFICADOR.GTIN
    );
    if (digitos.length !== 14) return null;

    const viaId = await this._catalogo.resolverPorIdentificador(
      TIPOS_IDENTIFICADOR.GTIN,
      digitos
    );
    if (viaId?.produto) {
      return IdentidadeResultadoDTO.encontrado({
        produtoId: viaId.produto.id,
        produto: viaId.produto,
        metodo: TIPOS_IDENTIFICADOR.GTIN,
        strategy: this.nome,
        codigoOriginal: bruto,
        confianca: 'ALTA'
      });
    }

    // Fallback: às vezes GTIN está salvo como codigo_barras com 14 dígitos
    const legado = await this._catalogo.buscarProdutoPorCodigoBarras(digitos);
    if (legado) {
      return IdentidadeResultadoDTO.encontrado({
        produtoId: legado.id,
        produto: legado,
        metodo: TIPOS_IDENTIFICADOR.GTIN,
        strategy: this.nome,
        codigoOriginal: bruto,
        confianca: 'ALTA',
        meta: { fonte: 'legado' }
      });
    }

    return null;
  }
}

module.exports = GtinStrategy;
