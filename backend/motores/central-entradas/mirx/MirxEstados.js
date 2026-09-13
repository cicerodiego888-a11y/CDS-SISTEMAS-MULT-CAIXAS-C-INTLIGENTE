/**
 * MIRX — Estados internos de recuperação de XML (RC3.4.1 / RC3.4.2).
 *
 * O status persistido do documento permanece AGUARDANDO_XML_COMPLETO
 * (compatibilidade MaquinaEstadosDocumento). Estes estados descrevem
 * a submáquina de recuperação inteligente.
 *
 * RC3.4.2 — SLEEP: documento em cooldown 656; fora da fila; sem ticks/Gate/logs repetitivos.
 *
 * @module motores/central-entradas/mirx/MirxEstados
 */

const MirxEstados = Object.freeze({
  RES_NFE: 'RES_NFE',
  AGUARDANDO_JANELA_SEFAZ: 'AGUARDANDO_JANELA_SEFAZ',
  CONSULTA_PROGRAMADA: 'CONSULTA_PROGRAMADA',
  CONSULTANDO_XML: 'CONSULTANDO_XML',
  XML_RECUPERADO: 'XML_RECUPERADO',
  PROCESSADO: 'PROCESSADO',
  BLOQUEADO_656: 'BLOQUEADO_656',
  /** RC3.4.2 — dormindo até proximaTentativa (sem fila / sem tick / sem Gate). */
  SLEEP: 'SLEEP',
  ERRO_TEMPORARIO: 'ERRO_TEMPORARIO'
});

const LABELS = Object.freeze({
  [MirxEstados.RES_NFE]: 'Resumo DF-e (resNFe)',
  [MirxEstados.AGUARDANDO_JANELA_SEFAZ]: 'Aguardando janela SEFAZ',
  [MirxEstados.CONSULTA_PROGRAMADA]: 'Consulta programada',
  [MirxEstados.CONSULTANDO_XML]: 'Consultando XML',
  [MirxEstados.XML_RECUPERADO]: 'XML recuperado automaticamente',
  [MirxEstados.PROCESSADO]: 'Processado',
  [MirxEstados.BLOQUEADO_656]: 'Consulta temporariamente bloqueada (656)',
  [MirxEstados.SLEEP]: 'Dormindo — aguardando cooldown SEFAZ',
  [MirxEstados.ERRO_TEMPORARIO]: 'Erro temporário'
});

const TERMINAIS = Object.freeze([
  MirxEstados.XML_RECUPERADO,
  MirxEstados.PROCESSADO
]);

function obterLabel(estado) {
  return LABELS[estado] || estado || '—';
}

function isTerminal(estado) {
  return TERMINAIS.includes(estado);
}

function isSleep(estado) {
  return estado === MirxEstados.SLEEP
    || estado === MirxEstados.BLOQUEADO_656;
}

/**
 * Indicador visual RC3.4.2 para painel / chip.
 * @param {Object} ctx
 * @returns {{ indicador: string, label: string, cor: string }}
 */
function resolverIndicadorVisual(ctx = {}) {
  if (ctx.xmlRecuperado) {
    return {
      indicador: '🟢',
      label: 'XML recuperado automaticamente',
      cor: '#198754'
    };
  }
  if (ctx.estado === MirxEstados.CONSULTANDO_XML) {
    return {
      indicador: '🔵',
      label: 'Recuperando XML automaticamente',
      cor: '#0d6efd'
    };
  }
  // RC3.4.5 — SLEEP/656: agendado (não “SEFAZ sem XML”).
  if (isSleep(ctx.estado) || ctx.consultaBloqueada || ctx.cStat === '656') {
    return {
      indicador: '🟡',
      label: 'Recuperação automática do XML agendada',
      cor: '#f59e0b'
    };
  }
  return {
    indicador: '🟡',
    label: 'Recuperação automática do XML agendada',
    cor: '#f59e0b'
  };
}

module.exports = {
  MirxEstados,
  LABELS,
  TERMINAIS,
  obterLabel,
  isTerminal,
  isSleep,
  resolverIndicadorVisual
};
