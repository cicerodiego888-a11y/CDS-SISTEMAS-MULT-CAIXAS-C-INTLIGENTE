/**
 * InternoStrategy — resolve código interno (Sprint 02).
 */

const IdentidadeStrategyBase = require('./IdentidadeStrategyBase');
const IdentidadeResultadoDTO = require('../contracts/IdentidadeResultadoDTO');
const { TIPOS_IDENTIFICADOR } = require('../constants/tiposIdentificador');
const { normalizarCodigoIdentificador } = require('../normalizers/normalizarCodigoIdentificador');

class InternoStrategy extends IdentidadeStrategyBase {
  constructor(deps = {}) {
    super();
    this._catalogo = deps.catalogo;
  }

  get nome() {
    return 'INTERNO';
  }

  canHandle(codigo, contexto, deteccao) {
    const bruto = String(codigo ?? '').trim();
    if (!bruto) return false;
    const candidatos = deteccao?.candidatos || [];
    return candidatos.includes(TIPOS_IDENTIFICADOR.INTERNO) || candidatos.length === 0;
  }

  async resolve(codigo, contexto, deteccao) {
    const bruto = deteccao?.bruto ?? String(codigo ?? '').trim();
    const codigoNorm = normalizarCodigoIdentificador(bruto, TIPOS_IDENTIFICADOR.INTERNO);
    if (!codigoNorm || !this._catalogo) return null;

    const viaId = await this._catalogo.resolverPorIdentificador(
      TIPOS_IDENTIFICADOR.INTERNO,
      codigoNorm
    );
    if (viaId?.produto) {
      return IdentidadeResultadoDTO.encontrado({
        produtoId: viaId.produto.id,
        produto: viaId.produto,
        metodo: TIPOS_IDENTIFICADOR.INTERNO,
        strategy: this.nome,
        codigoOriginal: bruto,
        confianca: 'ALTA'
      });
    }

    const legado = await this._catalogo.buscarProdutoPorCodigoInterno(codigoNorm);
    if (legado) {
      return IdentidadeResultadoDTO.encontrado({
        produtoId: legado.id,
        produto: legado,
        metodo: TIPOS_IDENTIFICADOR.INTERNO,
        strategy: this.nome,
        codigoOriginal: bruto,
        confianca: 'ALTA',
        meta: { fonte: 'legado' }
      });
    }

    return null;
  }
}

module.exports = InternoStrategy;
