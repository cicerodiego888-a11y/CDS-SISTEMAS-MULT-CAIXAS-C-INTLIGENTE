/**
 * CDS Design System V2 — Adaptive Label Registry (UX-001.1)
 * Catálogo oficial obrigatório de nomenclaturas.
 * Sem regras de negócio; apenas labels + i18nKey.
 */
(function (global) {
  'use strict';

  function entry(op) {
    const o = op || {};
    return Object.freeze({
      base: o.base || '',
      fiscal: o.fiscal != null ? o.fiscal : o.base,
      naoFiscal: o.naoFiscal != null ? o.naoFiscal : o.base,
      shortBase: o.shortBase != null ? o.shortBase : o.base,
      shortFiscal: o.shortFiscal != null ? o.shortFiscal : (o.fiscal != null ? o.fiscal : o.base),
      shortNaoFiscal: o.shortNaoFiscal != null ? o.shortNaoFiscal : (o.naoFiscal != null ? o.naoFiscal : o.base),
      pluralBase: o.pluralBase != null ? o.pluralBase : o.base,
      pluralFiscal: o.pluralFiscal != null ? o.pluralFiscal : (o.fiscal != null ? o.fiscal : o.base),
      pluralNaoFiscal: o.pluralNaoFiscal != null ? o.pluralNaoFiscal : (o.naoFiscal != null ? o.naoFiscal : o.base),
      descriptionBase: o.descriptionBase || o.description || '',
      descriptionFiscal: o.descriptionFiscal != null ? o.descriptionFiscal : (o.description || ''),
      descriptionNaoFiscal: o.descriptionNaoFiscal != null ? o.descriptionNaoFiscal : (o.description || ''),
      i18nKey: o.i18nKey || ''
    });
  }

  const LABELS = Object.freeze({
    vendas: entry({
      base: 'Vendas', fiscal: 'Vendas Fiscal', naoFiscal: 'Vendas Não Fiscal',
      pluralBase: 'Vendas', pluralFiscal: 'Vendas Fiscais', pluralNaoFiscal: 'Vendas Não Fiscais',
      descriptionBase: 'Indicadores de vendas',
      descriptionFiscal: 'Indicadores de vendas fiscais',
      descriptionNaoFiscal: 'Indicadores de vendas não fiscais',
      i18nKey: 'labels.vendas'
    }),
    entradas: entry({
      base: 'Entradas NF', fiscal: 'Entradas NF Fiscal', naoFiscal: 'Entradas NF Não Fiscal',
      pluralBase: 'Entradas NF', pluralFiscal: 'Entradas NF Fiscais', pluralNaoFiscal: 'Entradas NF Não Fiscais',
      descriptionBase: 'Entradas de notas',
      i18nKey: 'labels.entradas'
    }),
    caixa: entry({
      base: 'Caixa', fiscal: 'Caixa Fiscal', naoFiscal: 'Caixa Não Fiscal',
      descriptionBase: 'Sessão e movimentações de caixa',
      i18nKey: 'labels.caixa'
    }),
    estoque: entry({
      base: 'Estoque', fiscal: 'Estoque Fiscal', naoFiscal: 'Estoque Não Fiscal',
      descriptionBase: 'Saldos e rupturas de estoque',
      i18nKey: 'labels.estoque'
    }),
    pix: entry({
      base: 'PIX', fiscal: 'PIX Fiscal', naoFiscal: 'PIX Não Fiscal',
      i18nKey: 'labels.pix'
    }),
    cartao: entry({
      base: 'Cartão', fiscal: 'Cartão Fiscal', naoFiscal: 'Cartão Não Fiscal',
      i18nKey: 'labels.cartao'
    }),
    dinheiro: entry({
      base: 'Dinheiro', fiscal: 'Dinheiro Fiscal', naoFiscal: 'Dinheiro Não Fiscal',
      i18nKey: 'labels.dinheiro'
    }),
    tef: entry({
      base: 'TEF', fiscal: 'TEF Fiscal', naoFiscal: 'TEF Não Fiscal',
      descriptionBase: 'Transações TEF',
      i18nKey: 'labels.tef'
    }),
    receber: entry({
      base: 'Contas a Receber', fiscal: 'Contas a Receber Fiscal', naoFiscal: 'Contas a Receber Não Fiscal',
      shortBase: 'Receber', shortFiscal: 'Receber Fiscal', shortNaoFiscal: 'Receber Não Fiscal',
      descriptionBase: 'Títulos a receber',
      i18nKey: 'labels.receber'
    }),
    pagar: entry({
      base: 'Contas a Pagar', fiscal: 'Contas a Pagar Fiscal', naoFiscal: 'Contas a Pagar Não Fiscal',
      shortBase: 'Pagar', shortFiscal: 'Pagar Fiscal', shortNaoFiscal: 'Pagar Não Fiscal',
      descriptionBase: 'Títulos a pagar',
      i18nKey: 'labels.pagar'
    }),
    financeiro: entry({
      base: 'Financeiro', fiscal: 'Financeiro', naoFiscal: 'Financeiro Não Fiscal',
      i18nKey: 'labels.financeiro'
    }),
    comercial: entry({
      base: 'Comercial', fiscal: 'Comercial', naoFiscal: 'Comercial Não Fiscal',
      i18nKey: 'labels.comercial'
    }),
    alertas: entry({
      base: 'Alertas', fiscal: 'Alertas', naoFiscal: 'Alertas',
      i18nKey: 'labels.alertas'
    }),
    indicadores: entry({
      base: 'Indicadores', fiscal: 'Indicadores', naoFiscal: 'Indicadores',
      i18nKey: 'labels.indicadores'
    }),
    monitoramento: entry({
      base: 'Central de Monitoramento', fiscal: 'Central de Monitoramento', naoFiscal: 'Central de Monitoramento',
      shortBase: 'Monitoramento',
      descriptionBase: 'Centro de Operações CDS',
      i18nKey: 'labels.monitoramento'
    }),
    workflow: entry({
      base: 'Workflow', fiscal: 'Workflow', naoFiscal: 'Workflow',
      descriptionBase: 'Fluxos operacionais (preparado)',
      i18nKey: 'labels.workflow'
    }),
    cop: entry({
      base: 'Centro de Operações CDS', fiscal: 'Centro de Operações CDS', naoFiscal: 'Centro de Operações CDS',
      shortBase: 'COP',
      i18nKey: 'labels.cop'
    }),
    geral: entry({
      base: 'Geral', fiscal: 'Geral', naoFiscal: 'Geral',
      i18nKey: 'labels.geral'
    }),
    recebimentos: entry({
      base: 'Recebimentos', fiscal: 'Recebimentos', naoFiscal: 'Recebimentos Não Fiscal',
      i18nKey: 'labels.recebimentos'
    }),
    'aba.fiscal': entry({
      base: 'Operação', fiscal: 'Fiscal', naoFiscal: 'Fiscal',
      i18nKey: 'labels.aba.fiscal'
    }),
    badge_fiscal: entry({
      base: '', fiscal: 'Fiscal', naoFiscal: 'Não Fiscal',
      i18nKey: 'labels.badge.fiscal'
    }),
    badge_nao_fiscal: entry({
      base: '', fiscal: 'Não Fiscal', naoFiscal: 'Não Fiscal',
      i18nKey: 'labels.badge.nao_fiscal'
    }),
    acoes_recomendadas: entry({
      base: 'Ações Recomendadas', i18nKey: 'labels.ui.acoes_recomendadas'
    }),
    fila_trabalho: entry({
      base: 'Fila de Trabalho', i18nKey: 'labels.ui.fila_trabalho'
    }),
    timeline_global: entry({
      base: 'Timeline Global', i18nKey: 'labels.ui.timeline_global'
    }),
    historico_acoes: entry({
      base: 'Histórico de ações', i18nKey: 'labels.ui.historico_acoes'
    }),
    executive_insights: entry({
      base: 'EXECUTIVE INSIGHTS', i18nKey: 'labels.ui.executive_insights'
    }),
    recomendacao: entry({
      base: 'Recomendação', i18nKey: 'labels.ui.recomendacao'
    }),
    saude_operacional: entry({
      base: 'Saúde operacional', i18nKey: 'labels.ui.saude_operacional'
    }),
    abrir: entry({
      base: 'Abrir', i18nKey: 'labels.ui.abrir'
    }),
    acao: entry({
      base: 'ação', i18nKey: 'labels.ui.acao'
    }),
    insights: entry({
      base: 'Insights', i18nKey: 'labels.ui.insights'
    }),
    recomendacoes: entry({
      base: 'Recomendações', i18nKey: 'labels.ui.recomendacoes'
    })
  });

  const WIDGET_KEYS = Object.freeze({
    'fiscal.vendas': { domain: 'vendas', scope: 'fiscal' },
    'fiscal.vendas_nao_fiscal': { domain: 'vendas', scope: 'nao_fiscal' },
    'fiscal.entradas': { domain: 'entradas', scope: 'fiscal' },
    'fiscal.entradas_nao_fiscal': { domain: 'entradas', scope: 'nao_fiscal' },
    'financeiro.receber_fiscal': { domain: 'receber', scope: 'fiscal' },
    'financeiro.receber_nao_fiscal': { domain: 'receber', scope: 'nao_fiscal' },
    'financeiro.pagar_fiscal': { domain: 'pagar', scope: 'fiscal' },
    'financeiro.pagar_nao_fiscal': { domain: 'pagar', scope: 'nao_fiscal' },
    'caixa.fiscal': { domain: 'caixa', scope: 'fiscal' },
    'caixa.nao_fiscal': { domain: 'caixa', scope: 'nao_fiscal' },
    'recebimentos.pix_fiscal': { domain: 'pix', scope: 'fiscal' },
    'recebimentos.pix_nao_fiscal': { domain: 'pix', scope: 'nao_fiscal' },
    'recebimentos.dinheiro_fiscal': { domain: 'dinheiro', scope: 'fiscal' },
    'recebimentos.dinheiro_nao_fiscal': { domain: 'dinheiro', scope: 'nao_fiscal' },
    'recebimentos.cartao_fiscal': { domain: 'cartao', scope: 'fiscal' },
    'recebimentos.cartao_nao_fiscal': { domain: 'cartao', scope: 'nao_fiscal' },
    'tef.resumo': { domain: 'tef', scope: 'fiscal' },
    'tef.nao_fiscal': { domain: 'tef', scope: 'nao_fiscal' }
  });

  const extras = {};

  function normalizeDefinition(definition) {
    return entry({
      ...(definition || {}),
      i18nKey: (definition && definition.i18nKey) || undefined
    });
  }

  function register(domain, definition) {
    if (!domain || !definition) return false;
    const def = normalizeDefinition(definition);
    extras[domain] = Object.freeze({
      ...def,
      i18nKey: definition.i18nKey || `labels.${domain}`
    });
    return true;
  }

  function get(domain) {
    return extras[domain] || LABELS[domain] || null;
  }

  function listDomains() {
    return Object.keys(LABELS).concat(Object.keys(extras));
  }

  function getWidgetKey(widgetId) {
    return WIDGET_KEYS[widgetId] || null;
  }

  const AdaptiveLabelRegistry = {
    LABELS,
    WIDGET_KEYS,
    register,
    get,
    listDomains,
    getWidgetKey,
    entry
  };

  global.AdaptiveLabelRegistry = AdaptiveLabelRegistry;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdaptiveLabelRegistry;
  }
})(typeof window !== 'undefined' ? window : global);
