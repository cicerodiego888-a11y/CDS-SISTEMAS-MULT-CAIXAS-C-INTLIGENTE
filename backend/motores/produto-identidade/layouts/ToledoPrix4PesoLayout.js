/**
 * Adapter Toledo Prix 4 Peso — delega ao parser configurável.
 */

const EtiquetaLayoutBase = require('./EtiquetaLayoutBase');
const { LAYOUT_IDS } = require('./layoutIds');
const { obterPreset } = require('../../equipamentos/layouts/presetsEtiqueta');
const { parseEtiquetaComLayout } = require('../../equipamentos/layouts/ConfiguravelEtiquetaParser');

class ToledoPrix4PesoLayout extends EtiquetaLayoutBase {
  get id() {
    return LAYOUT_IDS.TOLEDO_PRIX4_PESO;
  }

  get nome() {
    return 'Toledo Prix 4 Peso (6+5 g)';
  }

  parse(codigo13) {
    const parsed = parseEtiquetaComLayout(codigo13, obterPreset('toledo_prix4_uno_peso'));
    if (!parsed) return null;
    return { ...parsed, layoutId: this.id };
  }
}

module.exports = ToledoPrix4PesoLayout;
