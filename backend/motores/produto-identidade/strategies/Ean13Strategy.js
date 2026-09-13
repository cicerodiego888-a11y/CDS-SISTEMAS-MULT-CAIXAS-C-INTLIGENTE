/**
 * Ean13Strategy — resolve EAN-13 (Sprint 02).
 */

const IdentidadeStrategyBase = require('./IdentidadeStrategyBase');
const IdentidadeResultadoDTO = require('../contracts/IdentidadeResultadoDTO');
const { TIPOS_IDENTIFICADOR } = require('../constants/tiposIdentificador');
const { normalizarCodigoIdentificador } = require('../normalizers/normalizarCodigoIdentificador');

class Ean13Strategy extends IdentidadeStrategyBase {
  constructor(deps = {}) {
    super();
    this._catalogo = deps.catalogo;
  }

  get nome() {
    return 'EAN13';
  }

  canHandle(codigo, contexto, deteccao) {
    const digitos = deteccao?.digitos || String(codigo || '').replace(/\D/g, '');
    // Prefixo 2 = etiqueta de balança (EtiquetaBalancaStrategy)
    if (/^2\d{12}$/.test(digitos)) return false;
    const candidatos = deteccao?.candidatos || [];
    if (candidatos.includes(TIPOS_IDENTIFICADOR.EAN13)) return true;
    return digitos.length === 13;
  }

  async resolve(codigo, contexto, deteccao) {
    if (!this._catalogo) return null;
    const bruto = deteccao?.bruto ?? String(codigo ?? '');
    const digitos = normalizarCodigoIdentificador(
      deteccao?.digitos || bruto,
      TIPOS_IDENTIFICADOR.EAN13
    );
    if (digitos.length !== 13) return null;

    const viaId = await this._catalogo.resolverPorIdentificador(
      TIPOS_IDENTIFICADOR.EAN13,
      digitos
    );
    if (viaId?.produto) {
      return IdentidadeResultadoDTO.encontrado({
        produtoId: viaId.produto.id,
        produto: viaId.produto,
        metodo: TIPOS_IDENTIFICADOR.EAN13,
        strategy: this.nome,
        codigoOriginal: bruto,
        confianca: 'ALTA'
      });
    }

    const legado = await this._catalogo.buscarProdutoPorCodigoBarras(digitos);
    if (legado) {
      return IdentidadeResultadoDTO.encontrado({
        produtoId: legado.id,
        produto: legado,
        metodo: TIPOS_IDENTIFICADOR.EAN13,
        strategy: this.nome,
        codigoOriginal: bruto,
        confianca: 'ALTA',
        meta: { fonte: 'legado' }
      });
    }

    return null;
  }
}

module.exports = Ean13Strategy;
