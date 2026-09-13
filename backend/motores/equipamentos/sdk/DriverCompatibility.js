/**
 * Sprint 15.7 — Compatibilidade do perfil com o motor / runtime.
 */

'use strict';

function parseSemver(v) {
  const m = String(v || '0.0.0').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return { major: 0, minor: 0, patch: 0 };
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function compararSemver(a, b) {
  const A = parseSemver(a);
  const B = parseSemver(b);
  if (A.major !== B.major) return A.major - B.major;
  if (A.minor !== B.minor) return A.minor - B.minor;
  return A.patch - B.patch;
}

/**
 * @param {Object} profile - DeviceProfile ou manifesto
 * @param {Object} [ctx]
 * @returns {{ compativel: boolean, avisos: string[], erros: string[], motorAtual: string }}
 */
function avaliarCompatibilidade(profile, ctx = {}) {
  const motorAtual = String(ctx.motorVersao || ctx.versaoMotor || '15.7.0');
  const minimo = String(profile.motorMinimo || profile.versao_minima || '1.0.0');
  const erros = [];
  const avisos = [];

  if (compararSemver(motorAtual, minimo) < 0) {
    erros.push(`Motor ${motorAtual} < mínimo exigido ${minimo}`);
  }

  const transportes = profile.transportes || [];
  if (!transportes.length) {
    avisos.push('Nenhum transporte declarado');
  }

  const caps = profile.capabilitiesLista || Object.keys(profile.capabilities || {}).filter((k) => profile.capabilities[k]);
  if (!caps.length) {
    avisos.push('Nenhuma capability habilitada');
  }

  if (!profile.protocolo && !(profile.protocolos || []).length) {
    avisos.push('Protocolo não informado');
  }

  return {
    compativel: erros.length === 0,
    avisos,
    erros,
    motorAtual,
    motorMinimo: minimo
  };
}

module.exports = {
  parseSemver,
  compararSemver,
  avaliarCompatibilidade
};
