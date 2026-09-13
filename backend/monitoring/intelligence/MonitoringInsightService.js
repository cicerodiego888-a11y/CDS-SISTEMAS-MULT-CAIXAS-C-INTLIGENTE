/**
 * MonitoringInsightService — insights interpretativos (% e narrativas).
 */

const { criarInsight } = require('./MonitoringInsight');
const { SEVERITY } = require('./MonitoringSeverity');
const { num } = require('../monitoringDateHelpers');

class MonitoringInsightService {
  generate(payload = {}, trends = {}, alerts = []) {
    const insights = [];
    const ts = new Date().toISOString();

    const vf = num(payload.fiscal?.vendas?.hoje?.valor);
    const vnf = num(payload.naoFiscal?.vendas?.hoje?.valor);
    const totalV = vf + vnf;
    if (totalV > 0) {
      const pctF = Math.round((vf / totalV) * 100);
      insights.push(criarInsight({
        id: 'insight.vendas.fiscal_pct',
        categoria: 'comercial',
        mensagem: `${pctF}% das vendas de hoje foram fiscais.`,
        severidade: pctF >= 80 ? SEVERITY.SUCESSO : SEVERITY.INFO,
        dominio: 'fiscal',
        icon: 'fa-percent',
        metricas: { percentual: pctF },
        timestamp: ts
      }));
    }

    const vsOntem = trends?.global?.variacao?.vsOntem;
    if (vsOntem && vsOntem.pct !== 0) {
      const sinal = vsOntem.pct > 0 ? 'cresceram' : 'caíram';
      insights.push(criarInsight({
        id: 'insight.vendas.vs_ontem',
        categoria: 'tendencia',
        mensagem: `As vendas fiscais ${sinal} ${Math.abs(vsOntem.pct)}% em relação ao dia anterior.`,
        severidade: vsOntem.pct >= 10 ? SEVERITY.SUCESSO : (vsOntem.pct <= -10 ? SEVERITY.ATENCAO : SEVERITY.INFO),
        dominio: 'fiscal',
        icon: vsOntem.direction === 'up' ? 'fa-arrow-up' : (vsOntem.direction === 'down' ? 'fa-arrow-down' : 'fa-minus'),
        metricas: { variacao: vsOntem.pct },
        timestamp: ts
      }));
    }

    const saldoNf = num(payload.caixa?.naoFiscal?.saldo);
    const saldoF = num(payload.caixa?.fiscal?.saldo);
    if (saldoF > 0 && saldoNf < saldoF * 0.5) {
      insights.push(criarInsight({
        id: 'insight.caixa.nao_fiscal_baixo',
        categoria: 'caixa',
        mensagem: 'Caixa Não Fiscal está abaixo da média em relação ao caixa fiscal.',
        severidade: SEVERITY.ATENCAO,
        dominio: 'caixa',
        scope: 'nao_fiscal',
        icon: 'fa-university',
        timestamp: ts
      }));
    }

    const nfXml = (alerts || []).find((a) => a.id === 'alert.central.nf_sem_xml');
    if (nfXml) {
      const match = nfXml.descricao.match(/(\d+)/);
      const qtd = match ? match[1] : 'várias';
      insights.push(criarInsight({
        id: 'insight.central.nf_xml',
        categoria: 'central',
        mensagem: `Existem ${qtd} NF aguardando XML completo.`,
        severidade: SEVERITY.ATENCAO,
        dominio: 'fiscal',
        icon: 'fa-file-code',
        timestamp: ts
      }));
    }

    const sefazOk = !(alerts || []).some((a) => a.id.includes('sefaz') && a.severidade === SEVERITY.CRITICO);
    if (sefazOk) {
      insights.push(criarInsight({
        id: 'insight.sefaz.ok',
        categoria: 'fiscal',
        mensagem: 'Nenhuma falha crítica de comunicação com a SEFAZ detectada pelo monitor.',
        severidade: SEVERITY.SUCESSO,
        dominio: 'fiscal',
        icon: 'fa-check-circle',
        timestamp: ts
      }));
    }

    return insights;
  }
}

module.exports = { MonitoringInsightService };
