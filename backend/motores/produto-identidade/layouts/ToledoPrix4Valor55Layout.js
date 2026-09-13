/**
 * Adapter Toledo Prix 4 Valor — delega ao parser configurável.
 */

const EtiquetaLayoutBase = require('./EtiquetaLayoutBase');
const { LAYOUT_IDS } = require('./layoutIds');
const { obterPreset } = require('../../equipamentos/layouts/presetsEtiqueta');
const { parseEtiquetaComLayout } = require('../../equipamentos/layouts/ConfiguravelEtiquetaParser');

class ToledoPrix4Valor55Layout extends EtiquetaLayoutBase {
  get id() {
    return LAYOUT_IDS.TOLEDO_PRIX4_VALOR_65;
  }

  get nome() {
    return 'Toledo Prix 4 Valor (6+5)';
  }

  parse(codigo13) {
    const parsed = parseEtiquetaComLayout(codigo13, obterPreset('toledo_prix4_uno_valor'));
    if (!parsed) return null;
    return { ...parsed, layoutId: this.id };
  }
}

module.exports = ToledoPrix4Valor55Layout;
