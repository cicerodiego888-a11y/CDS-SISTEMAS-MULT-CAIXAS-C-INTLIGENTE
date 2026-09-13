'use strict';

/**
 * Montagem dos cards — apenas transforma saídas dos motores (sem SQL).
 */

const DEFAULT_LAYOUT = {
  order: [
    'situacao',
    'alertas',
    'oportunidades',
    'ia',
    'previsoes',
    'acoes',
    'operacional',
    'insights'
  ],
  hidden: [],
  pinned: ['situacao', 'alertas'],
  modo: 'padrao'
};

const ACOES_RAPIDAS = [
  { id: 'cadastrar_produto', label: 'Cadastrar Produto', page: 'produtos', permissao: 'produtos', icon: 'box' },
  { id: 'nova_venda', label: 'Nova Venda', page: 'pdv', href: '/pdv', permissao: 'pdv', icon: 'cart' },
  { id: 'emitir_nfe', label: 'Emitir NF-e', page: 'nfe', permissao: 'nfe', icon: 'file' },
  { id: 'abrir_caixa', label: 'Abrir Caixa', page: 'caixa', permissao: 'caixa', icon: 'cash' },
  { id: 'fechar_caixa', label: 'Fechar Caixa', page: 'caixa', permissao: 'caixa', critica: true, icon: 'lock' },
  { id: 'novo_cliente', label: 'Novo Cliente', page: 'clientes', permissao: 'clientes', icon: 'user' }
];

function temPermissao(user, recurso) {
  if (!recurso) return true;
  const role = String(user?.role || user?.perfil || '').toLowerCase();
  if (['admin', 'administrador', 'super_admin', 'superadmin'].includes(role)) return true;
  const perms = user?.permissoes;
  if (!perms) return true;
  if (perms === '*' || (Array.isArray(perms) && perms.includes('*'))) return true;
  if (Array.isArray(perms)) return perms.includes(recurso) || perms.includes(recurso + '.ver');
  if (typeof perms === 'object') return Boolean(perms[recurso]);
  return false;
}

function serieHojeOntem(serie = []) {
  const sorted = [...(serie || [])].sort((a, b) => String(a.dia).localeCompare(String(b.dia)));
  const hoje = sorted[sorted.length - 1] || null;
  const ontem = sorted[sorted.length - 2] || null;
  const semana = sorted.slice(-7);
  const semanaAnt = sorted.slice(-14, -7);
  const sum = (arr) => arr.reduce((a, s) => a + (Number(s.vendas) || 0), 0);
  return {
    hoje: Number(hoje?.vendas) || 0,
    ontem: Number(ontem?.vendas) || 0,
    semana: sum(semana),
    semanaAnterior: sum(semanaAnt),
    diaHoje: hoje?.dia || null
  };
}

function pct(atual, base) {
  if (!base) return base === 0 && atual === 0 ? 0 : null;
  return Number((((atual - base) / base) * 100).toFixed(1));
}

function montarSituacao(full) {
  const serie = full.sinais?.vendas?.serie30d || [];
  const s = serieHojeOntem(serie);
  const media = full.forecast?.vendas?.mediaDiaria || 0;
  const pedidos = s.hoje;
  const ticket = media > 0 && pedidos > 0 ? Number((media).toFixed(2)) : pedidos;
  return {
    id: 'situacao',
    titulo: 'Situação do Dia',
    faturamentoHoje: s.hoje,
    unidade: 'pedidos_cip',
    nota: 'CIP expõe volume de vendas (pedidos/dia), não valor monetário direto.',
    meta: Number((media * 1.1).toFixed(2)),
    pedidos,
    clientesAtendidos: pedidos,
    ticketMedio: ticket,
    vsOntemPct: pct(s.hoje, s.ontem),
    vsSemanaPct: pct(s.semana, s.semanaAnterior),
    tendencia: full.forecast?.vendas?.tendencia || 'estavel'
  };
}

function montarAlertas(full) {
  const estoque = full.sinais?.estoque || {};
  const fin = full.sinais?.financeiro || {};
  const fiscal = full.sinais?.fiscal || {};
  const fluxo = full.forecast?.fluxoCaixa || {};
  const items = [];

  if ((estoque.produtosZerados || 0) > 0 || (estoque.criticos || []).length) {
    items.push({
      tipo: 'ruptura',
      severidade: 'alta',
      mensagem: `Produtos em ruptura/zerados: ${estoque.produtosZerados || 0}; críticos: ${(estoque.criticos || []).length}`
    });
  }
  if ((estoque.criticos || []).length) {
    items.push({
      tipo: 'estoque_critico',
      severidade: 'alta',
      mensagem: `Estoque crítico: ${(estoque.criticos || []).length} produto(s)`,
      amostra: (estoque.criticos || []).slice(0, 5)
    });
  }
  if (fluxo.alerta === 'pressao_caixa' || (fluxo.liquidoEstimado7d != null && fluxo.liquidoEstimado7d < 0)) {
    items.push({
      tipo: 'caixa_negativo',
      severidade: 'alta',
      mensagem: 'Pressão de caixa / saldo líquido estimado negativo (CIP Forecast)'
    });
  }
  if ((fiscal.produtosSemNcm || 0) > 0) {
    items.push({
      tipo: 'nfe_rejeitada',
      severidade: 'media',
      mensagem: `Pendências fiscais de cadastro (ex.: ${fiscal.produtosSemNcm} sem NCM). Detalhe de NF-e rejeitada no módulo Fiscal.`
    });
  }
  if ((fin.contasVencidas || 0) > 0) {
    items.push({
      tipo: 'inadimplentes',
      severidade: 'alta',
      mensagem: `Clientes inadimplentes: ${fin.contasVencidas} (R$ ${Number(fin.valorVencido || 0).toFixed(2)})`
    });
  }
  items.push({
    tipo: 'produtos_vencendo',
    severidade: 'baixa',
    mensagem: 'Produtos vencendo: CIP não consolida validade neste ciclo — consulte Estoque/Lotes.'
  });

  return { id: 'alertas', titulo: 'Alertas', automatico: true, items };
}

function montarOportunidades(full) {
  const recs = full.recommendations || [];
  const criticos = full.sinais?.estoque?.criticos || [];
  const items = [];

  const semGiro = recs.filter((r) => /giro|parado|estoque/i.test(String(r.titulo || r.tipo || r.id || '')));
  items.push({
    tipo: 'produtos_sem_giro',
    titulo: 'Produtos sem giro',
    qtd: Math.max(semGiro.length, criticos.length ? Math.min(3, criticos.length) : 0),
    itens: (semGiro.length ? semGiro : criticos).slice(0, 5)
  });

  items.push({
    tipo: 'clientes_sem_comprar',
    titulo: 'Clientes sem comprar',
    qtd: recs.filter((r) => /cliente|crm/i.test(String(r.titulo || r.tipo || ''))).length,
    itens: recs.filter((r) => /cliente|crm/i.test(String(r.titulo || r.tipo || ''))).slice(0, 5)
  });

  const alta = full.forecast?.vendas?.tendencia === 'alta';
  items.push({
    tipo: 'aumento_venda',
    titulo: 'Produtos com aumento de venda',
    qtd: alta ? 1 : 0,
    itens: alta
      ? [{ mensagem: `Tendência de vendas CIP: alta (média diária ${full.forecast?.vendas?.mediaDiaria || 0})` }]
      : []
  });

  const promo = recs.filter((r) => /promo|oportunidade/i.test(String(r.titulo || r.tipo || '')));
  items.push({
    tipo: 'promocao',
    titulo: 'Produtos para promoção',
    qtd: promo.length,
    itens: promo.slice(0, 5)
  });

  items.push({
    tipo: 'fornecedor_preco',
    titulo: 'Fornecedor com melhor preço',
    qtd: 0,
    itens: [],
    nota: 'Disponível via MIIP/Compras sob demanda — não calculado no CIP base.'
  });

  return { id: 'oportunidades', titulo: 'Oportunidades', items };
}

function montarPrevisoes(full) {
  const vendas = full.forecast?.vendas || {};
  const fluxo = full.forecast?.fluxoCaixa || {};
  const estoque = full.forecast?.estoque || [];
  const hoje = (vendas.previsao && vendas.previsao[0]) || null;
  return {
    id: 'previsoes',
    titulo: 'Previsões',
    fonte: 'ForecastEngine',
    vendaPrevistaHoje: hoje?.vendasEstimadas ?? vendas.mediaDiaria ?? 0,
    compraNecessaria: estoque.filter((e) => e.risco === 'alto' || e.risco === 'medio').length,
    fluxoCaixa: fluxo,
    produtosQueFaltarao: estoque.filter((e) => e.risco === 'alto').slice(0, 10),
    tendencia: vendas.tendencia,
    confianca: vendas.confianca
  };
}

function montarAcoes(user) {
  return {
    id: 'acoes',
    titulo: 'Ações Rápidas',
    items: ACOES_RAPIDAS.map((a) => ({
      ...a,
      permitido: temPermissao(user, a.permissao)
    }))
  };
}

function montarOperacional(full, pluginsDash, ciaStatus, miipStatus) {
  const mib = full.sinais?.mib || {};
  return {
    id: 'operacional',
    titulo: 'Resumo Operacional',
    pdvsOnline: null,
    pdvsNota: 'Sinal operacional de PDV via plataforma — não exposto pelo CIP.',
    usuariosConectados: null,
    notasEmitidas: null,
    erros: (full.insights?.riscos || []).length + (pluginsDash?.logs?.erros || 0),
    pluginsAtivos: (pluginsDash?.plugins || []).filter((p) => p.enabled && p.loaded).length,
    health: {
      cip: Boolean(full.analisadoEm),
      mib: Boolean(mib.ok),
      miip: miipStatus,
      cia: ciaStatus,
      plugins: pluginsDash?.codigo || null
    }
  };
}

function montarInsights(full) {
  const texts = [];
  const tend = full.forecast?.vendas?.tendencia;
  const media = full.forecast?.vendas?.mediaDiaria || 0;
  const serie = serieHojeOntem(full.sinais?.vendas?.serie30d || []);
  const vs = pct(serie.hoje, serie.ontem);

  if (vs != null && vs < -5) {
    texts.push(`O volume de vendas caiu ${Math.abs(vs)}% vs ontem.`);
  } else if (vs != null && vs > 5) {
    texts.push(`O volume de vendas subiu ${vs}% vs ontem.`);
  }
  if (tend === 'alta') texts.push('Tendência CIP: vendas em alta.');
  if (tend === 'baixa') texts.push('Tendência CIP: vendas em baixa — revise promoções e ruptura.');
  if ((full.sinais?.estoque?.produtosZerados || 0) > 0) {
    texts.push(`Você possui ${full.sinais.estoque.produtosZerados} produto(s) zerados/sem estoque.`);
  }
  if ((full.sinais?.financeiro?.contasVencidas || 0) > 0) {
    texts.push(`${full.sinais.financeiro.contasVencidas} conta(s) inadimplente(s) no radar CIP.`);
  }
  for (const r of (full.insights?.oportunidades || []).slice(0, 3)) {
    texts.push(r.titulo || r.mensagem || String(r.id || 'Oportunidade CIP'));
  }
  for (const r of (full.insights?.riscos || []).slice(0, 2)) {
    texts.push(r.titulo || r.mensagem || String(r.id || 'Risco CIP'));
  }
  if (!texts.length) {
    texts.push(`CIP estável — média diária ${media} pedido(s); tendência ${tend || 'estavel'}.`);
  }
  return { id: 'insights', titulo: 'Insights', fonte: 'CIP', items: texts };
}

function montarExecutivo(full) {
  const fin = full.sinais?.financeiro || {};
  const fluxo = full.forecast?.fluxoCaixa || {};
  const vendas = full.forecast?.vendas || {};
  const estoque = full.sinais?.estoque || {};
  return {
    id: 'executivo',
    titulo: 'Modo Executivo',
    financeiro: {
      contasVencidas: fin.contasVencidas || 0,
      valorVencido: fin.valorVencido || 0,
      aVencer7d: fin.valorAVencer7d || 0
    },
    vendas: {
      tendencia: vendas.tendencia,
      mediaDiaria: vendas.mediaDiaria,
      previsao7d: (vendas.previsao || []).slice(0, 7)
    },
    estoque: {
      criticos: (estoque.criticos || []).length,
      zerados: estoque.produtosZerados || 0
    },
    lucro: {
      nota: 'Lucro contábil permanece nos módulos Financeiro/Relatórios — CIP não duplica CMV.',
      proxy: fluxo.liquidoEstimado7d
    },
    fluxo,
    kpis: {
      tendenciaVendas: vendas.tendencia,
      pressaoCaixa: fluxo.alerta === 'pressao_caixa',
      ruptura: (estoque.criticos || []).length,
      inadimplencia: fin.contasVencidas || 0
    }
  };
}

module.exports = {
  DEFAULT_LAYOUT,
  ACOES_RAPIDAS,
  temPermissao,
  montarSituacao,
  montarAlertas,
  montarOportunidades,
  montarPrevisoes,
  montarAcoes,
  montarOperacional,
  montarInsights,
  montarExecutivo
};
