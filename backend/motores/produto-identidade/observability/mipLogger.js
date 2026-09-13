/**
 * Logger padronizado do MIP (Sprint 08).
 * Prefixo único [MIP]; níveis: info | warn | error | debug.
 * DEBUG só emite se process.env.MIP_DEBUG=1|true.
 * @module motores/produto-identidade/observability/mipLogger
 */

const PREFIX = '[MIP]';

function _enabledDebug() {
  const v = String(process.env.MIP_DEBUG || '').toLowerCase();
  return v === '1' || v === 'true';
}

function _fmt(parts) {
  return parts
    .map((p) => {
      if (p == null) return '';
      if (typeof p === 'string') return p;
      if (p instanceof Error) return p.message;
      try {
        return JSON.stringify(p);
      } catch {
        return String(p);
      }
    })
    .filter(Boolean)
    .join(' ');
}

const mipLogger = {
  info(...args) {
    console.log(PREFIX, _fmt(args));
  },
  warn(...args) {
    console.warn(PREFIX, _fmt(args));
  },
  error(...args) {
    console.error(PREFIX, _fmt(args));
  },
  debug(...args) {
    if (_enabledDebug()) {
      console.log(PREFIX, '[debug]', _fmt(args));
    }
  }
};

module.exports = mipLogger;
module.exports.PREFIX = PREFIX;
