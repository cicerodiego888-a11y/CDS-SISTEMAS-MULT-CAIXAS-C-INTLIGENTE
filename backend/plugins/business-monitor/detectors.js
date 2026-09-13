'use strict';

/**
 * Detectores — transformam sinais CIP/MIB em eventos (sem SQL).
 */

function pct(atual, base) {
  if (base == null || base === 0) return null;
  return Number((((atual - base) / base) * 100).toFixed(1));
}

function serieResumo(serie = []) {
  const sorted = [...(serie || [])].sort((a, b) => String(a.dia).localeCompare(String(b.dia)));
  const hoje = Number(sorted[sorted.length - 1]?.vendas) || 0;
  const ontem = Number(sorted[sorted.length - 2]?.vendas) || 0;
  const media7 = sorted.slice(-7).reduce((a, s) => a + (Number(s.vendas) || 0), 0) / Math.max(1, Math.min(7, sorted.length));
  // pico = dia com mais vendas na série
  let pico = null;
  for (const s of sorted) {
    if (!pico || Number(s.vendas) > Number(pico.vendas)) pico = s;
  }
  return { hoje, ontem, media7, pico, sorted };
}

function detectarVendas(full) {
  const events = [];
  const serie = full.sinais?.vendas?.serie30d || [];
  const s = serieResumo(serie);
  const tend = full.forecast?.vendas?.tendencia;
  const media = full.forecast?.vendas?.mediaDiaria || s.media7;
  const vsOntem = pct(s.hoje, s.ontem);
  const vsMedia = pct(s.hoje, media);

  if (vsOntem != null && vsOntem <= -15) {
    events.push({
      monitor: 'vendas',
      tipo: 'queda',
      prioridade: vsOntem <= -30 ? 'CRITICO' : 'ALTO',
      motor: 'CIP',
      mensagem: `Seu faturamento (volume) caiu ${Math.abs(vsOntem)}%.`,
      impacto: `Queda de ${Math.abs(vsOntem)}% vs ontem`,
      sugestao: 'Revise ruptura, promoções e equipe de vendas.',
      modulo: 'vendas',
      fingerprint: 'vendas:queda'
    });
  }
  if (vsOntem != null && vsOntem >= 25) {
    events.push({
      monitor: 'vendas',
      tipo: 'aumento',
      prioridade: 'MEDIO',
      motor: 'CIP',
      mensagem: `Aumento inesperado de ${vsOntem}% nas vendas vs ontem.`,
      impacto: 'Pico de demanda — valide estoque',
      sugestao: 'Confira estoque dos produtos mais vendidos.',
      modulo: 'estoque',
      fingerprint: 'vendas:aumento'
    });
  }
  if (tend === 'baixa' || (vsMedia != null && vsMedia <= -20)) {
    events.push({
      monitor: 'vendas',
      tipo: 'ticket_medio',
      prioridade: 'MEDIO',
      motor: 'CIP',
      mensagem: 'Ticket/volume abaixo da média — tendência de queda.',
      impacto: `Tendência CIP: ${tend || 'baixa'}`,
      sugestao: 'Analise mix de produtos e campanhas.',
      modulo: 'vendas',
      fingerprint: 'vendas:ticket'
    });
  }
  if (s.hoje === 0 && s.media7 > 0) {
    events.push({
      monitor: 'vendas',
      tipo: 'vendedor_parado',
      prioridade: 'ALTO',
      motor: 'CIP',
      mensagem: 'Sem vendas no dia com histórico recente — possível operação parada.',
      impacto: 'Risco de meta e caixa',
      sugestao: 'Verifique PDVs online e equipe.',
      modulo: 'pdv',
      fingerprint: 'vendas:parado'
    });
  }
  if (s.pico) {
    events.push({
      monitor: 'vendas',
      tipo: 'horario_pico',
      prioridade: 'BAIXO',
      motor: 'CIP',
      mensagem: `Pico de volume observado em ${s.pico.dia} (${s.pico.vendas} pedido(s)).`,
      impacto: 'Planejamento de equipe',
      sugestao: 'Reforce equipe e estoque nos horários/dias de pico.',
      modulo: 'vendas',
      fingerprint: `vendas:pico:${s.pico.dia}`
    });
  }
  return events;
}

function detectarEstoque(full) {
  const events = [];
  const estoque = full.sinais?.estoque || {};
  const forecastEst = full.forecast?.estoque || [];
  const criticos = estoque.criticos || [];

  if ((estoque.produtosZerados || 0) > 0 || criticos.length) {
    const nome = criticos[0]?.nome || 'produto';
    events.push({
      monitor: 'estoque',
      tipo: 'ruptura',
      prioridade: 'CRITICO',
      motor: 'CIP',
      mensagem: criticos[0]
        ? `Produto ${nome} em ruptura/crítico.`
        : `${estoque.produtosZerados} produto(s) sem estoque.`,
      impacto: `${criticos.length} críticos · ${estoque.produtosZerados || 0} zerados`,
      sugestao: 'Abra Compras ou ajuste transferência entre filiais.',
      modulo: 'estoque',
      fingerprint: 'estoque:ruptura',
      meta: { amostra: criticos.slice(0, 5) }
    });
  }

  const urgentes = forecastEst.filter((e) => e.risco === 'alto');
  for (const p of urgentes.slice(0, 3)) {
    events.push({
      monitor: 'estoque',
      tipo: 'compra_urgente',
      prioridade: 'ALTO',
      motor: 'CIP',
      mensagem: `Produto ${p.nome || p.produto_id} poderá faltar em breve (risco alto).`,
      impacto: `Dias até ruptura: ${p.diasAteRuptura ?? 'n/d'}`,
      sugestao: 'Gere sugestão de compra.',
      modulo: 'compras',
      fingerprint: `estoque:urgente:${p.produto_id || p.nome}`
    });
  }

  const parados = (full.recommendations || []).filter((r) =>
    /giro|parado|estoque/i.test(String(r.titulo || r.tipo || r.id || ''))
  );
  if (parados.length) {
    events.push({
      monitor: 'estoque',
      tipo: 'parado',
      prioridade: 'MEDIO',
      motor: 'CIP',
      mensagem: `${parados.length} sinal(is) de estoque parado / sem giro.`,
      impacto: 'Capital imobilizado',
      sugestao: 'Considere promoção ou remanejamento.',
      modulo: 'produtos',
      fingerprint: 'estoque:parado'
    });
  }

  events.push({
    monitor: 'estoque',
    tipo: 'vencendo',
    prioridade: 'BAIXO',
    motor: 'CIP',
    mensagem: 'Monitor de validade: CIP não consolida lotes — consulte Estoque/Lotes.',
    impacto: 'Informativo',
    sugestao: 'Abra o módulo de lotes para produtos vencendo.',
    modulo: 'estoque',
    fingerprint: 'estoque:vencendo:info'
  });

  if (criticos.length === 0 && (estoque.produtosZerados || 0) === 0 && forecastEst.some((e) => e.risco === 'baixo' && (e.diasAteRuptura || 99) > 60)) {
    events.push({
      monitor: 'estoque',
      tipo: 'excessivo',
      prioridade: 'BAIXO',
      motor: 'CIP',
      mensagem: 'Possível estoque excessivo em itens com baixo risco de ruptura.',
      impacto: 'Oportunidade de redução de compra',
      sugestao: 'Revise política de reposição.',
      modulo: 'compras',
      fingerprint: 'estoque:excessivo'
    });
  }

  return events;
}

function detectarFinanceiro(full) {
  const events = [];
  const fin = full.sinais?.financeiro || {};
  const fluxo = full.forecast?.fluxoCaixa || {};

  if ((fin.contasVencidas || 0) > 0) {
    events.push({
      monitor: 'financeiro',
      tipo: 'inadimplencia',
      prioridade: (fin.contasVencidas || 0) >= 5 || (fin.valorVencido || 0) > 1000 ? 'CRITICO' : 'ALTO',
      motor: 'CIP',
      mensagem: `Inadimplência: ${fin.contasVencidas} conta(s) · R$ ${Number(fin.valorVencido || 0).toFixed(2)}.`,
      impacto: 'Caixa e risco de crédito',
      sugestao: 'Acione cobrança ou análise CIA.',
      modulo: 'financeiro',
      fingerprint: 'financeiro:inadimplencia'
    });
  }

  if (fluxo.alerta === 'pressao_caixa' || (fluxo.liquidoEstimado7d != null && fluxo.liquidoEstimado7d < 0)) {
    events.push({
      monitor: 'financeiro',
      tipo: 'fluxo_negativo',
      prioridade: 'CRITICO',
      motor: 'CIP',
      mensagem: 'Fluxo de caixa sob pressão / líquido estimado negativo.',
      impacto: `Líquido 7d: ${fluxo.liquidoEstimado7d}`,
      sugestao: 'Priorize recebimentos e revise despesas.',
      modulo: 'financeiro',
      fingerprint: 'financeiro:fluxo'
    });
  }

  if ((fin.valorAVencer7d || 0) === 0 && (fin.valorVencido || 0) > 0) {
    events.push({
      monitor: 'financeiro',
      tipo: 'queda_recebimentos',
      prioridade: 'ALTO',
      motor: 'CIP',
      mensagem: 'Queda de recebimentos previstos nos próximos 7 dias.',
      impacto: 'Entradas 7d zeradas com vencidos em aberto',
      sugestao: 'Renegocie ou antecipe recebíveis.',
      modulo: 'financeiro',
      fingerprint: 'financeiro:recebimentos'
    });
  }

  if (fluxo.riscoVencido > (fluxo.entradas7d || 0) * 1.5 && fluxo.riscoVencido > 0) {
    events.push({
      monitor: 'financeiro',
      tipo: 'despesas_fora',
      prioridade: 'MEDIO',
      motor: 'CIP',
      mensagem: 'Risco financeiro fora do padrão (vencido >> entradas previstas).',
      impacto: 'Desequilíbrio CIP Forecast',
      sugestao: 'Audite despesas e contas a pagar no Financeiro.',
      modulo: 'financeiro',
      fingerprint: 'financeiro:despesas'
    });
  }

  return events;
}

function detectarFiscal(full) {
  const events = [];
  const fiscal = full.sinais?.fiscal || {};
  if ((fiscal.produtosSemNcm || 0) > 0) {
    events.push({
      monitor: 'fiscal',
      tipo: 'pendencias',
      prioridade: 'ALTO',
      motor: 'CIP',
      mensagem: `${fiscal.produtosSemNcm} produto(s) com pendência fiscal (ex.: sem NCM).`,
      impacto: 'Risco de rejeição NF-e/NFC-e',
      sugestao: 'Complete cadastro fiscal ou use Copiloto Fiscal.',
      modulo: 'fiscal',
      fingerprint: 'fiscal:pendencias'
    });
  }
  events.push({
    monitor: 'fiscal',
    tipo: 'nfe_rejeitada',
    prioridade: 'MEDIO',
    motor: 'CIP',
    mensagem: 'NF-e rejeitadas: detalhe operacional no módulo Fiscal (monitor não emite).',
    impacto: 'Informativo / ponte para módulo',
    sugestao: 'Abra Central Fiscal para rejeições e sequência.',
    modulo: 'fiscal',
    fingerprint: 'fiscal:nfe:info'
  });
  events.push({
    monitor: 'fiscal',
    tipo: 'certificado',
    prioridade: 'BAIXO',
    motor: 'CIP',
    mensagem: 'Certificado digital: validade não exposta pelo CIP — verifique Configurações Fiscais.',
    impacto: 'Continuidade de emissão',
    sugestao: 'Confira vencimento do certificado A1/A3.',
    modulo: 'fiscal',
    fingerprint: 'fiscal:certificado:info'
  });
  events.push({
    monitor: 'fiscal',
    tipo: 'sequencia',
    prioridade: 'BAIXO',
    motor: 'CIP',
    mensagem: 'Sequência numérica: monitore no módulo Fiscal se houver quebra.',
    impacto: 'Conformidade',
    sugestao: 'Valide numeração NF-e/NFC-e.',
    modulo: 'fiscal',
    fingerprint: 'fiscal:sequencia:info'
  });
  return events;
}

function detectarClientes(full) {
  const events = [];
  const recs = full.recommendations || [];
  const clientes = recs.filter((r) => /cliente|crm|inadimpl/i.test(String(r.titulo || r.tipo || r.id || '')));
  const fin = full.sinais?.financeiro || {};

  if (clientes.length) {
    events.push({
      monitor: 'clientes',
      tipo: 'sem_comprar',
      prioridade: 'MEDIO',
      motor: 'CIP',
      mensagem: `${clientes.length} sinal(is) CIP relacionados a clientes / CRM.`,
      impacto: 'Retenção',
      sugestao: 'Acione cobrança ou campanha de reativação.',
      modulo: 'clientes',
      fingerprint: 'clientes:sinais'
    });
  }
  if ((fin.contasVencidas || 0) > 0) {
    events.push({
      monitor: 'clientes',
      tipo: 'risco',
      prioridade: 'ALTO',
      motor: 'CIP',
      mensagem: 'Clientes em risco de crédito (inadimplência CIP).',
      impacto: `${fin.contasVencidas} conta(s) vencida(s)`,
      sugestao: 'Liste inadimplentes no Copiloto Financeiro / CRM.',
      modulo: 'financeiro',
      fingerprint: 'clientes:risco'
    });
  }
  if (full.forecast?.vendas?.tendencia === 'alta') {
    events.push({
      monitor: 'clientes',
      tipo: 'crescendo',
      prioridade: 'BAIXO',
      motor: 'CIP',
      tipoOportunidade: true,
      mensagem: 'Base de vendas em alta — oportunidade de clientes VIP / upsell.',
      impacto: 'Oportunidade',
      sugestao: 'Identifique top clientes no CRM.',
      modulo: 'clientes',
      fingerprint: 'clientes:crescendo'
    });
  }
  events.push({
    monitor: 'clientes',
    tipo: 'vip',
    prioridade: 'BAIXO',
    motor: 'CIP',
    tipoOportunidade: true,
    mensagem: 'Clientes VIP: ranking detalhado permanece no CRM/Relatórios.',
    impacto: 'Oportunidade de relacionamento',
    sugestao: 'Consulte relatório de clientes.',
    modulo: 'clientes',
    fingerprint: 'clientes:vip:info'
  });
  return events;
}

function detectarFornecedores(full) {
  const events = [];
  const urgentes = (full.forecast?.estoque || []).filter((e) => e.risco === 'alto');
  if (urgentes.length) {
    events.push({
      monitor: 'fornecedores',
      tipo: 'risco_ruptura',
      prioridade: 'ALTO',
      motor: 'CIP',
      mensagem: `Risco de ruptura pode exigir fornecedor — ${urgentes.length} item(ns).`,
      impacto: 'Supply chain',
      sugestao: 'Compare prazos e preços no módulo Compras/MIIP.',
      modulo: 'compras',
      fingerprint: 'fornecedores:ruptura'
    });
  }
  events.push({
    monitor: 'fornecedores',
    tipo: 'precos',
    prioridade: 'BAIXO',
    motor: 'MIIP',
    tipoOportunidade: true,
    mensagem: 'Preços melhores / mudança de custo: use MIIP + Compras sob demanda.',
    impacto: 'Oportunidade de margem',
    sugestao: 'Solicite análise CIA: "melhor preço fornecedor".',
    modulo: 'compras',
    fingerprint: 'fornecedores:preco:info'
  });
  events.push({
    monitor: 'fornecedores',
    tipo: 'atrasos',
    prioridade: 'BAIXO',
    motor: 'CIP',
    mensagem: 'Atrasos de fornecedor não são consolidados pelo CIP base — consulte Compras.',
    impacto: 'Informativo',
    sugestao: 'Abra pedidos em aberto no módulo Compras.',
    modulo: 'compras',
    fingerprint: 'fornecedores:atraso:info'
  });
  return events;
}

/**
 * @param {object} full resultado CIP.analyze
 * @returns {object[]}
 */
function detectarTudo(full) {
  return [
    ...detectarVendas(full),
    ...detectarEstoque(full),
    ...detectarFinanceiro(full),
    ...detectarFiscal(full),
    ...detectarClientes(full),
    ...detectarFornecedores(full)
  ].map((e) => {
    if (e.tipoOportunidade || e.tipo === 'aumento' || e.tipo === 'crescendo' || e.tipo === 'vip' || e.tipo === 'precos') {
      return { ...e, tipo: e.tipo === 'aumento' ? 'oportunidade' : (e.tipoOportunidade ? 'oportunidade' : e.tipo) };
    }
    return e;
  });
}

module.exports = {
  detectarTudo,
  detectarVendas,
  detectarEstoque,
  detectarFinanceiro,
  detectarFiscal,
  detectarClientes,
  detectarFornecedores,
  serieResumo,
  pct
};
