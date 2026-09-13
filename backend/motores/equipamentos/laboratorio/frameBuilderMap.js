/**
 * Mapeamento declarativo Driver → FrameBuilder.
 * Laboratório não importa drivers diretamente — apenas resolve por código.
 *
 * RC14.14.3 — códigos Toledo (oficial + aliases) → FrameBuilder oficial 90AX.
 */

const path = require('path');

/** @type {Record<string, string>} */
const FRAME_BUILDER_MAP = {
  // Oficial + aliases → framing 90AX com CHK (RC14.14.2)
  TOLEDO_PRIX4_UNO: '../drivers/toledo/protocol/ToledoFrameBuilder',
  TOLEDO_PRIX4: '../drivers/toledo/protocol/ToledoFrameBuilder',
  'toledo-prix4': '../drivers/toledo/protocol/ToledoFrameBuilder',
  // Lab legado 11A sem CHK — apenas migração / captura antiga
  TOLEDO_PRIX4_UNO_LEGACY_11A: '../drivers/toledo/prix4/ToledoPrix4FrameBuilder'
};

/**
 * @param {string} codigoDriver
 * @returns {Object|null}
 */
function resolverFrameBuilder(codigoDriver) {
  let rel = FRAME_BUILDER_MAP[String(codigoDriver || '')];
  if (!rel) {
    try {
      const identity = require('../sdk/DriverIdentityResolver');
      if (identity.ehToledo(codigoDriver)) {
        rel = FRAME_BUILDER_MAP.TOLEDO_PRIX4_UNO;
      }
    } catch (_) { /* ignore */ }
  }
  if (!rel) return null;
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require(path.join(__dirname, rel));
  } catch (_) {
    return null;
  }
}

/**
 * @returns {string[]}
 */
function listarDriversComFrameBuilder() {
  return Object.keys(FRAME_BUILDER_MAP);
}

module.exports = {
  FRAME_BUILDER_MAP,
  resolverFrameBuilder,
  listarDriversComFrameBuilder
};
