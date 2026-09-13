'use strict';

/**
 * Status de Heartbeat — RC3.1 Monitoramento Inteligente
 * Camada de monitoramento; não altera Central/Discovery/MIE.
 */

const HB_STATUS = Object.freeze({
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  INSTAVEL: 'INSTAVEL',
  SEM_RESPOSTA: 'SEM_RESPOSTA',
  SEM_COMUNICACAO: 'SEM_COMUNICACAO'
});

const HB_STATUS_ROTULO = Object.freeze({
  ONLINE: 'Online',
  OFFLINE: 'Offline',
  INSTAVEL: 'Instável',
  SEM_RESPOSTA: 'Sem resposta',
  SEM_COMUNICACAO: 'Sem comunicação'
});

const EVENTOS = Object.freeze({
  VOLTOU: 'EQUIPAMENTO_VOLTOU',
  CAIU: 'EQUIPAMENTO_CAIU',
  MUDOU_IP: 'MUDOU_IP',
  MUDOU_FIRMWARE: 'MUDOU_FIRMWARE',
  MUDOU_PORTA: 'MUDOU_PORTA',
  PERDA_COMUNICACAO: 'PERDA_COMUNICACAO',
  HEARTBEAT_OK: 'HEARTBEAT_OK',
  HEARTBEAT_FALHA: 'HEARTBEAT_FALHA',
  STATUS_ALTERADO: 'STATUS_ALTERADO'
});

/**
 * Mapeia status de heartbeat → status persistido em `equipamentos.status`
 * (campos já consumidos pela Central sem alteração estrutural).
 */
function mapearParaStatusEquipamento(hbStatus) {
  switch (hbStatus) {
    case HB_STATUS.ONLINE:
      return 'online';
    case HB_STATUS.INSTAVEL:
      return 'online';
    case HB_STATUS.OFFLINE:
    case HB_STATUS.SEM_RESPOSTA:
    case HB_STATUS.SEM_COMUNICACAO:
      return 'offline';
    default:
      return 'desconhecido';
  }
}

/**
 * Resolve próximo status a partir do resultado do probe e histórico.
 * @param {Object} ctx
 * @param {boolean} ctx.sucesso
 * @param {boolean} [ctx.timeout]
 * @param {number} [ctx.falhasConsecutivas]
 * @param {string[]} [ctx.historicoRecente] — 'ok'|'fail' (mais recente por último)
 * @param {string} [ctx.statusAnterior]
 */
function resolverStatusHeartbeat(ctx = {}) {
  const falhas = Number(ctx.falhasConsecutivas || 0);
  const hist = Array.isArray(ctx.historicoRecente) ? ctx.historicoRecente.slice(-6) : [];

  if (ctx.sucesso) {
    const oscilou = hist.length >= 3 && hist.includes('fail') && hist.includes('ok');
    if (oscilou && falhas === 0) return HB_STATUS.INSTAVEL;
    return HB_STATUS.ONLINE;
  }

  if (ctx.timeout) {
    if (falhas >= 3) return HB_STATUS.SEM_COMUNICACAO;
    return HB_STATUS.SEM_RESPOSTA;
  }

  if (falhas >= 3) return HB_STATUS.SEM_COMUNICACAO;
  if (falhas >= 1) {
    const recentOk = hist.slice(-4).filter((x) => x === 'ok').length;
    if (recentOk >= 1) return HB_STATUS.INSTAVEL;
    return HB_STATUS.OFFLINE;
  }

  return HB_STATUS.OFFLINE;
}

function ehStatusOnline(status) {
  return status === HB_STATUS.ONLINE || status === HB_STATUS.INSTAVEL;
}

module.exports = {
  HB_STATUS,
  HB_STATUS_ROTULO,
  EVENTOS,
  mapearParaStatusEquipamento,
  resolverStatusHeartbeat,
  ehStatusOnline
};
