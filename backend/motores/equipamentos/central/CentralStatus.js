'use strict';

/**
 * Status e Health Score — Central de Equipamentos (RC3.0)
 * Camada de apresentação; não altera Discovery/MIE/Services oficiais.
 */

const STATUS = Object.freeze({
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  DESCONHECIDO: 'DESCONHECIDO',
  NUNCA_VISTO: 'NUNCA_VISTO',
  ALTEROU_IP: 'ALTEROU_IP',
  ALTEROU_FIRMWARE: 'ALTEROU_FIRMWARE',
  SINCRONIZANDO: 'SINCRONIZANDO',
  ERRO: 'ERRO'
});

const STATUS_ROTULO = Object.freeze({
  ONLINE: 'Online',
  OFFLINE: 'Offline',
  DESCONHECIDO: 'Desconhecido',
  NUNCA_VISTO: 'Nunca visto',
  ALTEROU_IP: 'Alterou IP',
  ALTEROU_FIRMWARE: 'Alterou firmware',
  SINCRONIZANDO: 'Sincronizando',
  ERRO: 'Erro'
});

/**
 * @param {Object} item
 * @returns {string}
 */
function resolverStatusCentral(item = {}) {
  const idnStatus = String(item.identidade_status || item.identidade?.status || '').toLowerCase();
  const statusEq = String(item.status || item.status_equipamento || '').toLowerCase();
  const origem = item.origem || item.tipo_origem;

  if (idnStatus === 'ip_alterado') return STATUS.ALTEROU_IP;
  if (idnStatus === 'firmware_alterado') return STATUS.ALTEROU_FIRMWARE;

  if (statusEq === 'sincronizando' || statusEq === 'sync') return STATUS.SINCRONIZANDO;
  if (statusEq === 'erro' || statusEq === 'error') return STATUS.ERRO;
  if (statusEq === 'online') return STATUS.ONLINE;
  if (statusEq === 'offline') return STATUS.OFFLINE;

  if (origem === 'descoberto' && !item.equipamento_id) {
    if (idnStatus === 'novo' || !item.ultimo_visto_em) return STATUS.NUNCA_VISTO;
    return STATUS.DESCONHECIDO;
  }

  if (!item.ultima_comunicacao && !item.ultimo_visto_em) return STATUS.NUNCA_VISTO;
  if (statusEq === 'desconhecido' || !statusEq) return STATUS.DESCONHECIDO;
  return STATUS.DESCONHECIDO;
}

/**
 * Health Score 0–100.
 * @param {Object} item
 * @returns {{ score: number, rotulo: string, fatores: string[] }}
 */
function calcularHealthScore(item = {}) {
  const status = item.status_central || resolverStatusCentral(item);
  const fatores = [];
  let score = 70;

  switch (status) {
    case STATUS.ONLINE:
      score = 100;
      fatores.push('online');
      break;
    case STATUS.SINCRONIZANDO:
      score = 85;
      fatores.push('sincronizando');
      break;
    case STATUS.ALTEROU_IP:
    case STATUS.ALTEROU_FIRMWARE:
      score = 75;
      fatores.push(status.toLowerCase());
      break;
    case STATUS.DESCONHECIDO:
      score = 55;
      fatores.push('status_desconhecido');
      break;
    case STATUS.OFFLINE:
      score = 40;
      fatores.push('offline');
      break;
    case STATUS.NUNCA_VISTO:
      score = 25;
      fatores.push('nunca_visto');
      break;
    case STATUS.ERRO:
      score = 10;
      fatores.push('erro');
      break;
    default:
      score = 50;
  }

  const ultima = item.ultima_comunicacao || item.ultimo_visto_em;
  if (ultima) {
    const ageMs = Date.now() - new Date(ultima).getTime();
    if (Number.isFinite(ageMs)) {
      const dias = ageMs / (24 * 3600 * 1000);
      if (dias > 30) {
        score = Math.max(0, score - 30);
        fatores.push('inativo_30d');
      } else if (dias > 7) {
        score = Math.max(0, score - 15);
        fatores.push('inativo_7d');
      } else if (dias <= 1 && status === STATUS.ONLINE) {
        score = Math.min(100, score + 5);
        fatores.push('visto_hoje');
      }
    }
  } else if (status !== STATUS.NUNCA_VISTO) {
    score = Math.max(0, score - 10);
    fatores.push('sem_comunicacao');
  }

  if (item.ultimo_erro) {
    score = Math.max(0, score - 20);
    fatores.push('ultimo_erro');
  }

  const conf = Number(item.confianca);
  if (Number.isFinite(conf) && conf > 0 && conf < 0.5) {
    score = Math.max(0, score - 10);
    fatores.push('baixa_confianca');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let rotulo = 'Funcionando normalmente.';
  if (score <= 0) rotulo = 'Equipamento indisponível.';
  else if (score <= 40) rotulo = 'Falhas recorrentes.';
  else if (score <= 60) rotulo = 'Problemas de comunicação.';
  else if (score <= 80) rotulo = 'Oscilações.';

  return { score, rotulo, fatores };
}

module.exports = {
  STATUS,
  STATUS_ROTULO,
  resolverStatusCentral,
  calcularHealthScore
};
