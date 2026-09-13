/**
 * Níveis de saúde documental (RC3.4.6).
 * @module motores/central-entradas/health/HealthNiveis
 */

const HealthNiveis = Object.freeze({
  SAUDAVEL: 'SAUDAVEL',
  ATENCAO: 'ATENCAO',
  CRITICO: 'CRITICO',
  BLOQUEADO: 'BLOQUEADO',
  RESOLVIDO: 'RESOLVIDO'
});

const LABELS = Object.freeze({
  [HealthNiveis.SAUDAVEL]: 'Saudável',
  [HealthNiveis.ATENCAO]: 'Atenção',
  [HealthNiveis.CRITICO]: 'Crítico',
  [HealthNiveis.BLOQUEADO]: 'Bloqueado',
  [HealthNiveis.RESOLVIDO]: 'Resolvido'
});

const INDICADORES = Object.freeze({
  [HealthNiveis.SAUDAVEL]: { emoji: '🟢', cor: '#198754' },
  [HealthNiveis.ATENCAO]: { emoji: '🟡', cor: '#f59e0b' },
  [HealthNiveis.CRITICO]: { emoji: '🔴', cor: '#dc3545' },
  [HealthNiveis.BLOQUEADO]: { emoji: '⚫', cor: '#6c757d' },
  [HealthNiveis.RESOLVIDO]: { emoji: '🟢', cor: '#198754' }
});

const PRIORIDADE = Object.freeze({
  [HealthNiveis.CRITICO]: 4,
  [HealthNiveis.BLOQUEADO]: 3,
  [HealthNiveis.ATENCAO]: 2,
  [HealthNiveis.RESOLVIDO]: 1,
  [HealthNiveis.SAUDAVEL]: 0
});

function obterLabel(nivel) {
  return LABELS[nivel] || nivel || '—';
}

function obterIndicador(nivel) {
  return INDICADORES[nivel] || INDICADORES[HealthNiveis.SAUDAVEL];
}

function nivelMaisGrave(a, b) {
  const pa = PRIORIDADE[a] || 0;
  const pb = PRIORIDADE[b] || 0;
  return pa >= pb ? a : b;
}

module.exports = {
  HealthNiveis,
  LABELS,
  INDICADORES,
  PRIORIDADE,
  obterLabel,
  obterIndicador,
  nivelMaisGrave
};
