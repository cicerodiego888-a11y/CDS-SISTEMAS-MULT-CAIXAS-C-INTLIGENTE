/**
 * Sprint 14.8 / 15.4 — ToledoSyncReport
 */

'use strict';

function buildReport({
  syncId = null,
  comparacao = [],
  plano = null,
  execucao = null,
  iniciadoEm = null,
  finalizadoEm = null,
  produtosLidos = 0,
  modo = null,
  lotes = null,
  avisos = []
} = {}) {
  const resumoPlano = plano && plano.resumo ? plano.resumo : {};
  const resultados = execucao && execucao.resultados ? execucao.resultados : [];
  const enviados = resultados.filter((r) => (r.acao === 'ENVIAR' || r.tipo === 'PLU') && r.success).length;
  const atualizados = resultados.filter((r) => r.acao === 'ATUALIZAR' && r.success).length;
  const ignorados = resumoPlano.iguais != null
    ? resumoPlano.iguais + (resumoPlano.ausentes || 0)
    : comparacao.filter((c) => c.situacao === 'IGUAL' || c.situacao === 'AUSENTE').length;
  const falhas = resultados.filter((r) => !r.success).length;
  const inicio = iniciadoEm ? new Date(iniciadoEm).getTime() : null;
  const fim = finalizadoEm ? new Date(finalizadoEm).getTime() : Date.now();
  const tempoMs = inicio != null ? Math.max(0, fim - inicio) : (execucao && execucao.durationMs) || 0;
  const okCount = resultados.filter((r) => r.success).length;
  const velocidade = tempoMs > 0 ? Number(((okCount / (tempoMs / 1000)) || 0).toFixed(2)) : 0;

  const porTipo = {};
  for (const r of resultados) {
    const t = r.tipo || r.loteTipo || 'PLU';
    if (!porTipo[t]) porTipo[t] = { enviados: 0, falhas: 0 };
    if (r.success) porTipo[t].enviados += 1;
    else porTipo[t].falhas += 1;
  }

  return {
    syncId,
    modo: modo || plano?.modo || null,
    engine: '90AX',
    totalPlUs: produtosLidos || comparacao.length || resumoPlano.total || 0,
    produtosIguais: resumoPlano.iguais || 0,
    produtosEnviados: enviados || (porTipo.PLU?.enviados || 0),
    produtosAtualizados: atualizados,
    produtosIgnorados: ignorados,
    departamentos: porTipo.DEPARTAMENTO?.enviados || 0,
    precos: porTipo.PRECO?.enviados || 0,
    promocoes: porTipo.PROMOCAO?.enviados || 0,
    etiquetas: porTipo.ETIQUETA?.enviados || 0,
    falhas,
    avisos: avisos || [],
    lotes: lotes ? {
      total: lotes.length,
      confirmados: lotes.filter((l) => l.confirmed).length,
      falhos: lotes.filter((l) => l.failed).length
    } : (execucao?.lotes || null),
    velocidade,
    velocidadeLabel: `${velocidade} it/s`,
    tempoTotalMs: tempoMs,
    tempoTotal: formatMs(tempoMs),
    resultadoFinal: falhas === 0 ? 'SUCESSO' : (okCount > 0 ? 'PARCIAL' : 'FALHA'),
    geradoEm: new Date().toISOString()
  };
}

function formatMs(ms) {
  const s = Math.floor(Number(ms) / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

module.exports = {
  buildReport,
  formatMs
};
