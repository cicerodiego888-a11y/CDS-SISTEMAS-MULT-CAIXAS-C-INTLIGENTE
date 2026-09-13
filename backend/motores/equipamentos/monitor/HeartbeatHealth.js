'use strict';

/**
 * Health Score enriquecido — RC3.1 Heartbeat
 * Considera latência, falhas consecutivas, disponibilidade e oscilações.
 */

const { HB_STATUS } = require('./HeartbeatStatus');

/**
 * @param {Object} metricas
 * @returns {{ score: number, rotulo: string, fatores: string[] }}
 */
function calcularHealthScoreHeartbeat(metricas = {}) {
  const status = metricas.status || HB_STATUS.SEM_COMUNICACAO;
  const fatores = [];
  let score = 70;

  switch (status) {
    case HB_STATUS.ONLINE:
      score = 100;
      fatores.push('online');
      break;
    case HB_STATUS.INSTAVEL:
      score = 65;
      fatores.push('instavel');
      break;
    case HB_STATUS.SEM_RESPOSTA:
      score = 45;
      fatores.push('sem_resposta');
      break;
    case HB_STATUS.OFFLINE:
      score = 35;
      fatores.push('offline');
      break;
    case HB_STATUS.SEM_COMUNICACAO:
      score = 10;
      fatores.push('sem_comunicacao');
      break;
    default:
      score = 50;
  }

  const latencia = Number(metricas.latencia_ms);
  if (Number.isFinite(latencia) && latencia > 0) {
    if (latencia > 2000) {
      score = Math.max(0, score - 25);
      fatores.push('latencia_alta');
    } else if (latencia > 800) {
      score = Math.max(0, score - 12);
      fatores.push('latencia_moderada');
    } else if (latencia <= 200 && status === HB_STATUS.ONLINE) {
      score = Math.min(100, score + 3);
      fatores.push('latencia_boa');
    }
  }

  const falhas = Number(metricas.falhas_consecutivas || 0);
  if (falhas >= 5) {
    score = Math.max(0, score - 30);
    fatores.push('falhas_5plus');
  } else if (falhas >= 3) {
    score = Math.max(0, score - 20);
    fatores.push('falhas_3plus');
  } else if (falhas >= 1) {
    score = Math.max(0, score - 8);
    fatores.push('falhas_recentes');
  }

  const totalOk = Number(metricas.total_sucessos || 0);
  const totalFail = Number(metricas.total_falhas || 0);
  const total = totalOk + totalFail;
  if (total >= 5) {
    const disponibilidade = totalOk / total;
    if (disponibilidade < 0.5) {
      score = Math.max(0, score - 20);
      fatores.push('baixa_disponibilidade');
    } else if (disponibilidade >= 0.95 && status === HB_STATUS.ONLINE) {
      score = Math.min(100, score + 5);
      fatores.push('alta_disponibilidade');
    }
  }

  const mudancas = Number(metricas.mudancas_frequentes || 0);
  if (mudancas >= 3) {
    score = Math.max(0, score - 15);
    fatores.push('mudancas_frequentes');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let rotulo = 'Funcionando normalmente.';
  if (score <= 0) rotulo = 'Equipamento indisponível.';
  else if (score <= 40) rotulo = 'Falhas recorrentes.';
  else if (score <= 60) rotulo = 'Problemas de comunicação.';
  else if (score <= 80) rotulo = 'Oscilações.';

  return { score, rotulo, fatores };
}

module.exports = {
  calcularHealthScoreHeartbeat
};
