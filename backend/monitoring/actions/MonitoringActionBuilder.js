/**
 * MonitoringActionBuilder — registra catálogo de ações por domínio.
 * Transforma sinais (alert/insight/rec ids) em Action DTOs.
 * Sem SQL. Sem HTML. Sem escrita.
 */

const { MonitoringActionRegistry } = require('./MonitoringActionRegistry');
const { criarAction, PRIORITY } = require('./MonitoringActionResult');

function registrarFiscalActions(registry) {
  registry.register('alert.central.nf_sem_xml', [
    { id: 'act.central.abrir', label: 'Abrir Central Inteligente', icon: 'fa-inbox', page: 'central-entradas', permission: 'compras', priority: PRIORITY.CRITICO, category: 'fiscal', dominio: 'fiscal', params: { filtro: 'pendentes' } },
    { id: 'act.central.sincronizar', label: 'Sincronizar DF-e', icon: 'fa-sync', page: 'central-entradas', permission: 'compras', priority: PRIORITY.ALTA, category: 'fiscal', dominio: 'fiscal', params: { acaoUi: 'sync' } },
    { id: 'act.central.diagnostico', label: 'Diagnóstico Central', icon: 'fa-stethoscope', page: 'central-diagnostico', permission: 'compras', priority: PRIORITY.MEDIA, category: 'fiscal', dominio: 'fiscal' }
  ]);
  registry.register('alert.central.manifestacao_pendente', [
    { id: 'act.central.manif', label: 'Abrir Central — Manifestação', icon: 'fa-file-signature', page: 'central-entradas', permission: 'compras', priority: PRIORITY.ALTA, category: 'fiscal', dominio: 'fiscal', params: { filtro: 'manifestacao' } },
    { id: 'act.cfg.manifestacao', label: 'Política de Manifestação', icon: 'fa-cogs', page: 'configuracoes-avancadas', permission: 'configuracoes', priority: PRIORITY.MEDIA, category: 'fiscal', dominio: 'fiscal', params: { tab: 'fiscal', anchor: 'manifestacao' } }
  ]);
  registry.register('alert.vendas.fiscal.zero', [
    { id: 'act.fiscal.monitor', label: 'Abrir NFC-e Emitidas', icon: 'fa-file-invoice', page: 'fiscal', permission: 'fiscal', priority: PRIORITY.ALTA, category: 'fiscal', dominio: 'fiscal' },
    { id: 'act.vendas.hist', label: 'Histórico de Vendas', icon: 'fa-history', page: 'vendas', permission: 'vendas', priority: PRIORITY.MEDIA, category: 'comercial', dominio: 'fiscal' },
    { id: 'act.pdv', label: 'Abrir PDV', icon: 'fa-store', page: null, route: '/pdv', permission: 'pdv', priority: PRIORITY.MEDIA, category: 'comercial', dominio: 'fiscal', action: 'open_route' }
  ]);
  registry.register('insight.central.nf_xml', [
    { id: 'act.insight.central', label: 'Ver documentos pendentes', icon: 'fa-inbox', page: 'central-entradas', permission: 'compras', priority: PRIORITY.ALTA, category: 'fiscal', dominio: 'fiscal', params: { filtro: 'pendentes' } }
  ]);
  registry.register('rec.alert.central.manifestacao_pendente', [
    { id: 'act.rec.manif', label: 'Manifestar notas pendentes', icon: 'fa-file-signature', page: 'central-entradas', permission: 'compras', priority: PRIORITY.ALTA, category: 'fiscal', dominio: 'fiscal' }
  ]);
  registry.register('rec.alert.central.nf_sem_xml', [
    { id: 'act.rec.xml', label: 'Concluir XML / Sync', icon: 'fa-sync', page: 'central-entradas', permission: 'compras', priority: PRIORITY.ALTA, category: 'fiscal', dominio: 'fiscal', params: { acaoUi: 'sync' } }
  ]);
}

function registrarFinanceiroActions(registry) {
  registry.register('alert.financeiro.vencidas30', [
    { id: 'act.fin.receber', label: 'Abrir Contas a Receber', icon: 'fa-hand-holding-usd', page: 'financeiro', permission: 'financeiro', priority: PRIORITY.CRITICO, category: 'financeiro', dominio: 'financeiro', params: { aba: 'receber', filtro: 'vencidas' } },
    { id: 'act.fin.clientes', label: 'Clientes', icon: 'fa-users', page: 'clientes', permission: 'clientes', priority: PRIORITY.MEDIA, category: 'financeiro', dominio: 'financeiro' }
  ]);
  registry.register('alert.financeiro.vencidas', [
    { id: 'act.fin.receber2', label: 'Filtrar contas vencidas', icon: 'fa-filter', page: 'financeiro', permission: 'financeiro', priority: PRIORITY.ALTA, category: 'financeiro', dominio: 'financeiro', params: { aba: 'receber', filtro: 'vencidas' } }
  ]);
  registry.register('alert.financeiro.receber.alto', [
    { id: 'act.fin.receber3', label: 'Revisar Contas a Receber', icon: 'fa-hand-holding-usd', page: 'financeiro', permission: 'financeiro', priority: PRIORITY.MEDIA, category: 'financeiro', dominio: 'financeiro', params: { aba: 'receber' } }
  ]);
  registry.register('rec.alert.financeiro.vencidas30', [
    { id: 'act.rec.cobrar', label: 'Cobrar clientes vencidos', icon: 'fa-phone', page: 'financeiro', permission: 'financeiro', priority: PRIORITY.CRITICO, category: 'financeiro', dominio: 'financeiro', params: { aba: 'receber', filtro: 'vencidas' } }
  ]);
}

function registrarCaixaActions(registry) {
  registry.register('alert.caixa.negativo', [
    { id: 'act.caixa.abrir', label: 'Abrir Fechamento de Caixa', icon: 'fa-cash-register', page: 'caixa', permission: 'caixa', priority: PRIORITY.CRITICO, category: 'caixa', dominio: 'caixa' },
    { id: 'act.caixa.hist', label: 'Histórico de Caixa', icon: 'fa-list', page: 'caixa', permission: 'caixa', priority: PRIORITY.ALTA, category: 'caixa', dominio: 'caixa', params: { view: 'historico' } },
    { id: 'act.caixas', label: 'Gerenciar Caixas', icon: 'fa-desktop', page: 'caixas', permission: 'caixa', priority: PRIORITY.MEDIA, category: 'caixa', dominio: 'caixa' }
  ]);
  registry.register('alert.caixa.nao_fiscal.negativo', [
    { id: 'act.caixa.revisar', label: 'Revisar lançamentos de caixa', icon: 'fa-university', page: 'caixa', permission: 'caixa', priority: PRIORITY.ALTA, category: 'caixa', dominio: 'caixa' }
  ]);
  registry.register('rec.alert.caixa.negativo', [
    { id: 'act.rec.suprimento', label: 'Avaliar suprimento', icon: 'fa-plus-circle', page: 'caixa', permission: 'caixa', priority: PRIORITY.CRITICO, category: 'caixa', dominio: 'caixa', params: { view: 'lancamentos' } }
  ]);
}

function registrarRecebimentosActions(registry) {
  registry.register('alert.recebimentos.pix.alto', [
    { id: 'act.rec.vendas', label: 'Ver vendas / recebimentos', icon: 'fa-credit-card', page: 'vendas', permission: 'vendas', priority: PRIORITY.BAIXA, category: 'recebimentos', dominio: 'recebimentos' }
  ]);
}

function registrarEstoqueActions(registry) {
  registry.register('alert.estoque.critico', [
    { id: 'act.est.produtos', label: 'Abrir Produtos críticos', icon: 'fa-boxes', page: 'produtos', permission: 'produtos', priority: PRIORITY.ALTA, category: 'estoque', dominio: 'estoque', params: { filtro: 'estoque_baixo' } },
    { id: 'act.est.compras', label: 'Abrir Compras', icon: 'fa-shopping-cart', page: 'compras', permission: 'compras', priority: PRIORITY.MEDIA, category: 'estoque', dominio: 'estoque' }
  ]);
  registry.register('alert.estoque.negativo', [
    { id: 'act.est.neg', label: 'Auditar estoque negativo', icon: 'fa-exclamation-triangle', page: 'produtos', permission: 'produtos', priority: PRIORITY.CRITICO, category: 'estoque', dominio: 'estoque', params: { filtro: 'negativo' } }
  ]);
  registry.register('rec.alert.estoque.critico', [
    { id: 'act.rec.repor', label: 'Repor estoque', icon: 'fa-box-open', page: 'produtos', permission: 'produtos', priority: PRIORITY.ALTA, category: 'estoque', dominio: 'estoque', params: { filtro: 'estoque_baixo' } }
  ]);
}

function registrarTefActions(registry) {
  registry.register('alert.tef.offline', [
    { id: 'act.tef.cfg', label: 'Abrir Configuração TEF', icon: 'fa-cogs', page: 'configuracoes', permission: 'configuracoes', priority: PRIORITY.ALTA, category: 'tef', dominio: 'recebimentos', params: { secao: 'tef' } },
    { id: 'act.tef.equip', label: 'Equipamentos / Pinpad', icon: 'fa-cash-register', page: 'equipamentos', permission: 'configuracoes', priority: PRIORITY.MEDIA, category: 'tef', dominio: 'recebimentos' },
    { id: 'act.tef.lab', label: 'Diagnóstico / Laboratório', icon: 'fa-flask', page: 'laboratorio-equipamentos', permission: 'configuracoes', priority: PRIORITY.MEDIA, category: 'tef', dominio: 'recebimentos' }
  ]);
  registry.register('rec.alert.tef.offline', [
    { id: 'act.rec.tef', label: 'Verificar TEF', icon: 'fa-plug', page: 'configuracoes', permission: 'configuracoes', priority: PRIORITY.ALTA, category: 'tef', dominio: 'recebimentos', params: { secao: 'tef' } }
  ]);
}

function registrarComercialActions(registry) {
  registry.register('insight.vendas.vs_ontem', [
    { id: 'act.com.vendas', label: 'Abrir Histórico de Vendas', icon: 'fa-chart-line', page: 'vendas', permission: 'vendas', priority: PRIORITY.BAIXA, category: 'comercial', dominio: 'fiscal' }
  ]);
  registry.register('insight.vendas.fiscal_pct', [
    { id: 'act.com.fiscal', label: 'Relatórios fiscais', icon: 'fa-file-invoice-dollar', page: 'fiscal', permission: 'fiscal', priority: PRIORITY.BAIXA, category: 'comercial', dominio: 'fiscal' }
  ]);
}

function registrarSistemaActions(registry) {
  registry.register('rec.backup.rotina', [
    { id: 'act.sys.backup', label: 'Abrir Backup / Centro', icon: 'fa-database', page: 'configuracoes-avancadas', permission: 'configuracoes', priority: PRIORITY.MEDIA, category: 'sistema', dominio: 'geral', params: { tab: 'backup' } },
    { id: 'act.sys.auditoria', label: 'Auditoria', icon: 'fa-clipboard-list', page: 'auditoria', permission: 'auditoria', priority: PRIORITY.BAIXA, category: 'sistema', dominio: 'geral' }
  ]);
}

function registrarCatalogoPadrao(registry) {
  registrarFiscalActions(registry);
  registrarFinanceiroActions(registry);
  registrarCaixaActions(registry);
  registrarRecebimentosActions(registry);
  registrarEstoqueActions(registry);
  registrarTefActions(registry);
  registrarComercialActions(registry);
  registrarSistemaActions(registry);
  return registry;
}

class MonitoringActionBuilder {
  constructor(registry) {
    this.registry = registry || registrarCatalogoPadrao(new MonitoringActionRegistry());
  }

  /**
   * Constrói actions a partir de um sinal (alert/insight/rec).
   */
  buildForSignal(signal, sourceType) {
    const id = signal?.id;
    if (!id) return [];
    const templates = this.registry.getBySignal(id);
    return templates.map((t) => criarAction({
      ...t,
      sourceId: id,
      sourceType: sourceType || 'signal',
      description: t.description || signal.titulo || signal.mensagem || signal.descricao || ''
    }));
  }

  buildFromIntelligence(intelligence = {}) {
    const actions = [];
    const seen = new Set();

    const pushUnique = (list) => {
      list.forEach((a) => {
        const key = `${a.id}|${a.page}|${JSON.stringify(a.params || {})}`;
        if (seen.has(key)) return;
        seen.add(key);
        actions.push(a);
      });
    };

    (intelligence.alerts || []).forEach((a) => pushUnique(this.buildForSignal(a, 'alerta')));
    (intelligence.insights || []).forEach((i) => pushUnique(this.buildForSignal(i, 'insight')));
    (intelligence.recommendations || []).forEach((r) => pushUnique(this.buildForSignal(r, 'recomendacao')));

    actions.sort((a, b) => (a.priority || 9) - (b.priority || 9));
    return actions;
  }
}

module.exports = {
  MonitoringActionBuilder,
  registrarCatalogoPadrao,
  registrarFiscalActions,
  registrarFinanceiroActions,
  registrarCaixaActions,
  registrarRecebimentosActions,
  registrarEstoqueActions,
  registrarTefActions,
  registrarComercialActions,
  registrarSistemaActions
};
