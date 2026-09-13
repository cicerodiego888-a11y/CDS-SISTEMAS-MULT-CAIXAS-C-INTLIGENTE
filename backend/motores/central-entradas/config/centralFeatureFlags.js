/**
 * RC3.6.H — Feature flags da Central de Entradas.
 *
 * RECUPERACAO_PORTAL_NACIONAL=false (default) oculta a recuperação pelo Portal na UI.
 * Definir RECUPERACAO_PORTAL_NACIONAL=true no ambiente para reativar sem alterar código.
 *
 * @module motores/central-entradas/config/centralFeatureFlags
 */

'use strict';

/**
 * @returns {boolean}
 */
function recuperacaoPortalNacionalHabilitada() {
  const raw = process.env.RECUPERACAO_PORTAL_NACIONAL;
  if (raw == null || String(raw).trim() === '') {
    return false;
  }
  const norm = String(raw).trim().toLowerCase();
  return norm === 'true' || norm === '1' || norm === 'yes' || norm === 'on';
}

/**
 * Flags expostas ao frontend (somente leitura).
 * @returns {Object}
 */
function obterFeatureFlagsPublicas() {
  return {
    recuperacaoPortalNacional: recuperacaoPortalNacionalHabilitada()
  };
}

module.exports = {
  recuperacaoPortalNacionalHabilitada,
  obterFeatureFlagsPublicas
};
