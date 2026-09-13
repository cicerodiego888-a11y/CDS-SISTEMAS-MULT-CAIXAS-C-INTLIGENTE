/**
 * Adapter legado — delega ao parser configurável (preset Legado CDS 5+6).
 */

const EtiquetaLayoutBase = require('./EtiquetaLayoutBase');
const { LAYOUT_IDS } = require('./layoutIds');
const { obterPreset } = require('../../equipamentos/layouts/presetsEtiqueta');
const { parseEtiquetaComLayout } = require('../../equipamentos/layouts/ConfiguravelEtiquetaParser');

class LegadoCdsValor56Layout extends EtiquetaLayoutBase {
  get id() {
    return LAYOUT_IDS.LEGADO_CDS_VALOR_56;
  }

  get nome() {
    return 'Legado CDS Valor (5+6)';
  }

  parse(codigo13) {
    const parsed = parseEtiquetaComLayout(codigo13, obterPreset('legado_cds_valor_56'));
    if (!parsed) return null;
    return { ...parsed, layoutId: this.id };
  }
}

module.exports = LegadoCdsValor56Layout;
