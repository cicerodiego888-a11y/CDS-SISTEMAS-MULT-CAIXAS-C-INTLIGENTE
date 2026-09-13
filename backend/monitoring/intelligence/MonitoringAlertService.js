/**
 * MonitoringAlertService — motor de alertas operacionais (somente leitura).
 */

const db = require('../../database');
const { sqlExcluirContaVendaCancelada } = require('../../services/vendas/VendaFinanceiroService');
const { criarAlerta } = require('./MonitoringInsight');
const { SEVERITY } = require('./MonitoringSeverity');
const { dataHojeBrasil, num, dbGetFactory } = require('../monitoringDateHelpers');

const dbGet = dbGetFactory(db);

function offsetData(isoDate, dias) {
  const d = new Date(isoDate + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

class MonitoringAlertService {
  async generate(payload = {}, trends = {}) {
    const alerts = [];
    const ts = new Date().toISOString();
    const hoje = dataHojeBrasil();

    const saldoFiscal = num(payload.caixa?.fiscal?.saldo);
    if (saldoFiscal < 0) {
      alerts.push(criarAlerta({
        id: 'alert.caixa.negativo',
        titulo: 'Caixa negativo',
        descricao: `Saldo fiscal do caixa: R$ ${saldoFiscal.toFixed(2)}.`,
        categoria: 'caixa',
        dominio: 'caixa',
        severidade: SEVERITY.CRITICO,
        timestamp: ts
      }));
    }

    const saldoNf = num(payload.caixa?.naoFiscal?.saldo);
    if (saldoNf < 0) {
      alerts.push(criarAlerta({
        id: 'alert.caixa.nao_fiscal.negativo',
        titulo: 'Caixa Não Fiscal negativo',
        descricao: 'Movimentação não fiscal abaixo de zero.',
        categoria: 'caixa',
        dominio: 'caixa',
        severidade: SEVERITY.ATENCAO,
        timestamp: ts
      }));
    }

    const vendasHoje = num(payload.fiscal?.vendas?.hoje?.valor ?? payload.fiscal?.vendas?.valor);
    if (vendasHoje <= 0) {
      alerts.push(criarAlerta({
        id: 'alert.vendas.fiscal.zero',
        titulo: 'Sem vendas fiscais hoje',
        descricao: 'Nenhuma venda fiscal registrada no dia.',
        categoria: 'comercial',
        dominio: 'fiscal',
        severidade: SEVERITY.ATENCAO,
        timestamp: ts
      }));
    }

    const receber = num(payload.financeiro?.receberFiscal?.valor);
    if (receber > 5000) {
      alerts.push(criarAlerta({
        id: 'alert.financeiro.receber.alto',
        titulo: 'Contas a receber elevadas',
        descricao: `Total em aberto (fiscal): R$ ${receber.toFixed(2)}.`,
        categoria: 'financeiro',
        dominio: 'financeiro',
        severidade: SEVERITY.ATENCAO,
        timestamp: ts
      }));
    }

    if (payload.tef?.mock) {
      alerts.push(criarAlerta({
        id: 'alert.tef.offline',
        titulo: 'TEF offline / mock',
        descricao: 'Integração TEF não monitorada ativamente (mock M2).',
        categoria: 'tef',
        dominio: 'recebimentos',
        severidade: SEVERITY.ATENCAO,
        timestamp: ts
      }));
    }

    try {
      const vencidas30 = await dbGet(
        `SELECT COUNT(*) AS qtd
         FROM contas_receber cr
         WHERE cr.status IN ('aberto', 'parcial')
           AND date(cr.data_vencimento) < date(?, '-30 days')
           AND ${sqlExcluirContaVendaCancelada('cr')}`,
        [hoje]
      );
      if (num(vencidas30.qtd) > 0) {
        alerts.push(criarAlerta({
          id: 'alert.financeiro.vencidas30',
          titulo: 'Contas vencidas há mais de 30 dias',
          descricao: `${num(vencidas30.qtd)} título(s) em atraso prolongado.`,
          categoria: 'financeiro',
          dominio: 'financeiro',
          severidade: SEVERITY.CRITICO,
          timestamp: ts
        }));
      }

      const vencidasGeral = await dbGet(
        `SELECT COUNT(*) AS qtd FROM contas_receber cr
         WHERE cr.status IN ('aberto', 'parcial') AND date(cr.data_vencimento) < date(?)
           AND ${sqlExcluirContaVendaCancelada('cr')}`,
        [hoje]
      );
      if (num(vencidasGeral.qtd) > 0 && num(vencidas30.qtd) === 0) {
        alerts.push(criarAlerta({
          id: 'alert.financeiro.vencidas',
          titulo: 'Contas vencidas',
          descricao: `${num(vencidasGeral.qtd)} título(s) vencidos.`,
          categoria: 'financeiro',
          dominio: 'financeiro',
          severidade: SEVERITY.ATENCAO,
          timestamp: ts
        }));
      }
    } catch {
      /* intelligence layer — falha silenciosa */
    }

    try {
      const prodNeg = await dbGet(
        `SELECT COUNT(*) AS qtd FROM produtos
         WHERE COALESCE(saldo_fiscal, 0) + COALESCE(saldo_nao_fiscal, 0) < 0
            OR COALESCE(estoque_atual, 0) < 0`
      );
      if (num(prodNeg.qtd) > 0) {
        alerts.push(criarAlerta({
          id: 'alert.estoque.negativo',
          titulo: 'Produtos com estoque negativo',
          descricao: `${num(prodNeg.qtd)} produto(s) com saldo negativo.`,
          categoria: 'estoque',
          dominio: 'estoque',
          severidade: SEVERITY.CRITICO,
          timestamp: ts
        }));
      }

      const critico = await dbGet(
        `SELECT COUNT(*) AS qtd FROM produtos
         WHERE COALESCE(estoque_atual, 0) <= COALESCE(estoque_minimo, 0)
           AND COALESCE(estoque_minimo, 0) > 0`
      );
      if (num(critico.qtd) > 0) {
        alerts.push(criarAlerta({
          id: 'alert.estoque.critico',
          titulo: 'Estoque crítico',
          descricao: `${num(critico.qtd)} produto(s) no ou abaixo do mínimo.`,
          categoria: 'estoque',
          dominio: 'estoque',
          severidade: SEVERITY.ATENCAO,
          timestamp: ts
        }));
      }
    } catch { /* noop */ }

    try {
      const nfXml = await dbGet(
        `SELECT COUNT(*) AS qtd FROM central_entradas_documentos
         WHERE status IN ('RECEBIDA', 'CIENCIA', 'SINCRONIZADA', 'RES_NFE')
           AND (xml IS NULL OR TRIM(xml) = '')`
      );
      if (num(nfXml.qtd) > 0) {
        alerts.push(criarAlerta({
          id: 'alert.central.nf_sem_xml',
          titulo: 'NF aguardando XML completo',
          descricao: `${num(nfXml.qtd)} documento(s) aguardando XML/proc completo.`,
          categoria: 'central',
          dominio: 'fiscal',
          severidade: SEVERITY.ATENCAO,
          timestamp: ts
        }));
      }

      const manif = await dbGet(
        `SELECT COUNT(*) AS qtd FROM central_entradas_documentos
         WHERE status IN ('RECEBIDA', 'RES_NFE')`
      );
      if (num(manif.qtd) > 0) {
        alerts.push(criarAlerta({
          id: 'alert.central.manifestacao_pendente',
          titulo: 'Manifestação pendente',
          descricao: `${num(manif.qtd)} documento(s) podem exigir manifestação/ciência.`,
          categoria: 'central',
          dominio: 'fiscal',
          severidade: SEVERITY.ATENCAO,
          timestamp: ts
        }));
      }
    } catch { /* noop */ }

    const pixHoje = num(payload.recebimentos?.pixFiscal?.hoje?.valor);
    const pixMes = num(payload.recebimentos?.pixFiscal?.mes?.valor);
    const mediaPix = pixMes / Math.max(1, new Date().getDate());
    if (pixHoje > mediaPix * 1.5 && pixHoje > 0) {
      alerts.push(criarAlerta({
        id: 'alert.recebimentos.pix.alto',
        titulo: 'PIX acima da média',
        descricao: 'Recebimentos PIX fiscais superiores à média diária do mês.',
        categoria: 'recebimentos',
        dominio: 'recebimentos',
        severidade: SEVERITY.INFO,
        timestamp: ts
      }));
    }

    const vsOntem = trends?.global?.variacao?.vsOntem;
    if (vsOntem?.direction === 'up' && vsOntem.pct >= 10) {
      alerts.push(criarAlerta({
        id: 'alert.fiscal.vendas.crescimento',
        titulo: 'Vendas fiscais em crescimento',
        descricao: `Crescimento de ${vsOntem.pct}% vs ontem.`,
        categoria: 'comercial',
        dominio: 'fiscal',
        severidade: SEVERITY.SUCESSO,
        timestamp: ts
      }));
    }

    return alerts;
  }
}

module.exports = { MonitoringAlertService };
