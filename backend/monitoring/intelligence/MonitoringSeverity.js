/**
 * Severidades oficiais — Monitoring Intelligence.
 */

const SEVERITY = Object.freeze({
  INFO: 'INFO',
  SUCESSO: 'SUCESSO',
  ATENCAO: 'ATENCAO',
  CRITICO: 'CRITICO'
});

const HEALTH = Object.freeze({
  EXCELENTE: 'EXCELENTE',
  BOM: 'BOM',
  ATENCAO: 'ATENCAO',
  CRITICO: 'CRITICO'
});

const MODULE_STATUS = Object.freeze({
  ONLINE: 'online',
  ATENCAO: 'atencao',
  OFFLINE: 'offline',
  NAO_MONITORADO: 'nao_monitorado'
});

const SEVERITY_ICON = {
  [SEVERITY.INFO]: '🔵',
  [SEVERITY.SUCESSO]: '🟢',
  [SEVERITY.ATENCAO]: '🟡',
  [SEVERITY.CRITICO]: '🔴'
};

const HEALTH_TONE = {
  [HEALTH.EXCELENTE]: 'ok',
  [HEALTH.BOM]: 'info',
  [HEALTH.ATENCAO]: 'warn',
  [HEALTH.CRITICO]: 'error'
};

function prioridadeFromSeveridade(sev) {
  const map = {
    [SEVERITY.CRITICO]: 1,
    [SEVERITY.ATENCAO]: 2,
    [SEVERITY.INFO]: 3,
    [SEVERITY.SUCESSO]: 4
  };
  return map[sev] || 5;
}

function healthFromScore(score) {
  if (score >= 85) return HEALTH.EXCELENTE;
  if (score >= 65) return HEALTH.BOM;
  if (score >= 40) return HEALTH.ATENCAO;
  return HEALTH.CRITICO;
}

module.exports = {
  SEVERITY,
  HEALTH,
  MODULE_STATUS,
  SEVERITY_ICON,
  HEALTH_TONE,
  prioridadeFromSeveridade,
  healthFromScore
};
