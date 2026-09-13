/**
 * PluStrategy — resolve PLU tipado em produto_identificadores (Sprint 06).
 */

const IdentidadeStrategyBase = require('./IdentidadeStrategyBase');
const IdentidadeResultadoDTO = require('../contracts/IdentidadeResultadoDTO');
const { TIPOS_IDENTIFICADOR } = require('../constants/tiposIdentificador');
const { normalizarCodigoIdentificador } = require('../normalizers/normalizarCodigoIdentificador');

class PluStrategy extends IdentidadeStrategyBase {
  constructor(deps = {}) {
    super();
    this._catalogo = deps.catalogo;
  }

  get nome() {
    return 'PLU';
  }

  get metodo() {
    return TIPOS_IDENTIFICADOR.PLU;
  }

  canHandle(codigo, contexto, deteccao) {
    const candidatos = deteccao?.candidatos || [];
    if (candidatos.includes(TIPOS_IDENTIFICADOR.PLU)) return true;
    if (contexto?.tipoForcado === TIPOS_IDENTIFICADOR.PLU) return true;
    const digitos = deteccao?.digitos || String(codigo || '').replace(/\D/g, '');
    // PLU curto (1–6); não compete com etiqueta 13 dígitos
    return digitos.length >= 1 && digitos.length <= 6 && !/^2\d{12}$/.test(digitos);
  }

  async resolve(codigo, contexto, deteccao) {
    if (!this._catalogo) {
      console.log('[MIP DEBUG] PluStrategy: catalogo ausente');
      return null;
    }
    const bruto = deteccao?.bruto ?? String(codigo ?? '');
    const digitos = normalizarCodigoIdentificador(
      deteccao?.digitos || bruto,
      TIPOS_IDENTIFICADOR.PLU
    );
    console.log('[MIP DEBUG] PluStrategy.resolve', { bruto, digitos });
    if (!digitos) return null;

    const viaId = await this._catalogo.resolverPorIdentificador(
      TIPOS_IDENTIFICADOR.PLU,
      digitos
    );
    if (viaId?.produto) {
      console.log('[MIP DEBUG] PluStrategy → Repository OK', {
        produtoId: viaId.produto.id,
        nome: viaId.produto.nome,
        plu: digitos
      });
      return IdentidadeResultadoDTO.encontrado({
        produtoId: viaId.produto.id,
        produto: viaId.produto,
        metodo: TIPOS_IDENTIFICADOR.PLU,
        strategy: this.nome,
        codigoOriginal: bruto,
        confianca: 'ALTA',
        meta: { plu: digitos }
      });
    }

    console.log('[MIP DEBUG] PluStrategy → Repository sem registro PLU=', digitos);
    return null;
  }
}

module.exports = PluStrategy;
