/**
 * MonitoringHealthService — saúde por domínio (EXCELENTE/BOM/ATENÇÃO/CRÍTICO).
 */

const { HEALTH, healthFromScore } = require('./MonitoringSeverity');

function scoreDomain(alerts, domain) {
  const list = (alerts || []).filter((a) => a.dominio === domain || a.domain === domain);
  let score = 100;
  list.forEach((a) => {
    if (a.severidade === 'CRITICO') score -= 35;
    else if (a.severidade === 'ATENCAO') score -= 15;
    else if (a.severidade === 'INFO') score -= 5;
  });
  return Math.max(0, score);
}

class MonitoringHealthService {
  evaluate(payload = {}, alerts = []) {
    const domains = ['fiscal', 'financeiro', 'caixa', 'recebimentos', 'estoque', 'comercial', 'geral'];
    const byDomain = {};
    domains.forEach((d) => {
      byDomain[d] = healthFromScore(scoreDomain(alerts, d));
    });

    const scores = Object.values(byDomain);
    const critico = scores.filter((h) => h === HEALTH.CRITICO).length;
    const atencao = scores.filter((h) => h === HEALTH.ATENCAO).length;
    let geralScore = 100 - critico * 25 - atencao * 10;
    if (num(payload.caixa?.fiscal?.saldo) < 0) geralScore -= 20;
    const geral = healthFromScore(geralScore);

    return {
      geral,
      domains: byDomain,
      updatedAt: new Date().toISOString()
    };
  }
}

function num(v) {
  return Number(v) || 0;
}

module.exports = { MonitoringHealthService };
