/**
 * MonitoringRecommendationService — recomendações automáticas (sem executar ações).
 */

const { criarRecomendacao } = require('./MonitoringInsight');

const MAPA = [
  { alertId: 'alert.caixa.negativo', titulo: 'Realizar suprimento no caixa', descricao: 'Saldo fiscal negativo — avaliar suprimento de caixa.', dominio: 'caixa' },
  { alertId: 'alert.caixa.nao_fiscal.negativo', titulo: 'Revisar caixa não fiscal', descricao: 'Conferir movimentações não fiscais do turno.', dominio: 'caixa' },
  { alertId: 'alert.central.manifestacao_pendente', titulo: 'Manifestar notas pendentes', descricao: 'Manifestar documentos pendentes para liberar XML completo.', dominio: 'fiscal' },
  { alertId: 'alert.central.nf_sem_xml', titulo: 'Aguardar/concluir XML completo', descricao: 'Sincronizar DF-e ou manifestar para obter XML/proc.', dominio: 'fiscal' },
  { alertId: 'alert.tef.offline', titulo: 'Verificar TEF', descricao: 'Conferir pinpad, rede e status do provedor TEF.', dominio: 'recebimentos' },
  { alertId: 'alert.financeiro.vencidas30', titulo: 'Cobrar clientes vencidos', descricao: 'Priorizar cobrança de títulos vencidos há mais de 30 dias.', dominio: 'financeiro' },
  { alertId: 'alert.financeiro.vencidas', titulo: 'Regularizar contas vencidas', descricao: 'Revisar contas a receber vencidas.', dominio: 'financeiro' },
  { alertId: 'alert.estoque.critico', titulo: 'Repor estoque', descricao: 'Produtos no ou abaixo do estoque mínimo.', dominio: 'estoque' },
  { alertId: 'alert.estoque.negativo', titulo: 'Corrigir saldos negativos', descricao: 'Auditar produtos com estoque negativo.', dominio: 'estoque' },
  { alertId: 'alert.vendas.fiscal.zero', titulo: 'Verificar operação comercial', descricao: 'Nenhuma venda fiscal hoje — conferir PDV e emissão.', dominio: 'fiscal' }
];

class MonitoringRecommendationService {
  generate(alerts = []) {
    const recs = [];
    const ids = new Set((alerts || []).map((a) => a.id));
    let prio = 1;

    MAPA.forEach((m) => {
      if (ids.has(m.alertId)) {
        recs.push(criarRecomendacao({
          id: `rec.${m.alertId}`,
          titulo: m.titulo,
          descricao: m.descricao,
          dominio: m.dominio,
          origemAlerta: m.alertId,
          prioridade: prio++
        }));
      }
    });

    recs.push(criarRecomendacao({
      id: 'rec.backup.rotina',
      titulo: 'Realizar backup',
      descricao: 'Manter rotina de backup conforme política do CDS.',
      dominio: 'geral',
      prioridade: prio + 1
    }));

    return recs.slice(0, 8);
  }
}

module.exports = { MonitoringRecommendationService };
