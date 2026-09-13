/**
 * Constantes de layouts de etiqueta de balança — MIP Sprint 04.
 * @module motores/produto-identidade/layouts/layoutIds
 */

const LAYOUT_IDS = Object.freeze({
  LEGADO_CDS_VALOR_56: 'legado_cds_valor_56',
  /** Prix 4 Uno real: 2 + 6 (PLU) + 5 (valor centavos) + DV */
  TOLEDO_PRIX4_VALOR_65: 'toledo_prix4_valor_65',
  /** Alias histórico (docs citavam 5+5; campo PLU na etiqueta tem 6 dígitos). */
  TOLEDO_PRIX4_VALOR_55: 'toledo_prix4_valor_65',
  /** Prix 4 peso: 2 + 6 (PLU) + 5 (gramas) + DV */
  TOLEDO_PRIX4_PESO: 'toledo_prix4_peso'
});

/** Chave em equipamentos_configuracoes */
const CONFIG_CHAVE_STRATEGY = 'etiqueta.strategy';

/** Default oficial = comportamento atual do PDV (não quebra clientes). */
const LAYOUT_DEFAULT = LAYOUT_IDS.LEGADO_CDS_VALOR_56;

module.exports = {
  LAYOUT_IDS,
  CONFIG_CHAVE_STRATEGY,
  LAYOUT_DEFAULT
};
