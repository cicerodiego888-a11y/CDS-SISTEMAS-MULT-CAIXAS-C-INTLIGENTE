/**
 * Origem da resolução de um Web Service fiscal.
 *
 * Sprint F3 — CACHE e FALLBACK reservados para sprints futuras.
 *
 * @module services/fiscal/core/ResolutionSource
 */

const ResolutionSource = Object.freeze({
  REGISTRY: 'REGISTRY',
  OVERRIDE: 'OVERRIDE',
  CACHE: 'CACHE',
  FALLBACK: 'FALLBACK'
});

/**
 * @param {string} value
 * @returns {boolean}
 */
function isResolutionSource(value) {
  return Object.prototype.hasOwnProperty.call(ResolutionSource, value);
}

/**
 * @returns {string[]}
 */
function listResolutionSources() {
  return Object.values(ResolutionSource);
}

module.exports = {
  ResolutionSource,
  isResolutionSource,
  listResolutionSources
};
