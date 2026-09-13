/**
 * Sprint 15.6 — EquipmentJob
 * Unidade de trabalho da Central de Orquestração.
 */

'use strict';

const crypto = require('crypto');

const JOB_STATUS = Object.freeze({
  PENDENTE: 'PENDENTE',
  EXECUTANDO: 'EXECUTANDO',
  CONCLUIDO: 'CONCLUIDO',
  ERRO: 'ERRO',
  CANCELADO: 'CANCELADO'
});

const JOB_TYPES = Object.freeze({
  SYNC_FULL: 'SYNC_FULL',
  SYNC_INCREMENTAL: 'SYNC_INCREMENTAL',
  SYNC_DELTA: 'SYNC_DELTA',
  HEALTH_CHECK: 'HEALTH_CHECK',
  CONNECT: 'CONNECT',
  DIAGNOSTIC: 'DIAGNOSTIC'
});

function novoId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `job-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function equipamentoKey(alvo = {}) {
  if (alvo.equipamentoId != null) return `id:${alvo.equipamentoId}`;
  if (alvo.equipamento_id != null) return `id:${alvo.equipamento_id}`;
  const host = alvo.host || alvo.ip || '';
  const porta = alvo.porta != null ? alvo.porta : (alvo.porta_tcp != null ? alvo.porta_tcp : 9000);
  return `host:${host}:${porta}`;
}

/**
 * @param {Object} dados
 * @returns {Object}
 */
function criarJob(dados = {}) {
  const agora = dados.criadoEm || new Date().toISOString();
  const alvo = {
    equipamentoId: dados.equipamentoId ?? dados.equipamento_id ?? null,
    nome: dados.nome || dados.equipamentoNome || null,
    host: dados.host || dados.ip || null,
    porta: dados.porta != null ? Number(dados.porta) : (dados.porta_tcp != null ? Number(dados.porta_tcp) : 9000),
    firmware: dados.firmware || null,
    loja: dados.loja || null
  };

  return {
    id: dados.id || novoId(),
    tipo: dados.tipo || JOB_TYPES.SYNC_DELTA,
    status: JOB_STATUS.PENDENTE,
    alvo,
    key: equipamentoKey(alvo),
    payload: dados.payload || {},
    prioridade: Number(dados.prioridade) || 0,
    usuario: dados.usuario || null,
    criadoEm: agora,
    iniciadoEm: null,
    finalizadoEm: null,
    duracaoMs: null,
    tentativas: 0,
    maxTentativas: dados.maxTentativas != null ? Number(dados.maxTentativas) : 1,
    erro: null,
    resultado: null,
    scheduleId: dados.scheduleId || null
  };
}

function marcarExecutando(job, agora = new Date()) {
  job.status = JOB_STATUS.EXECUTANDO;
  job.iniciadoEm = agora.toISOString();
  job.tentativas += 1;
  return job;
}

function marcarConcluido(job, resultado = {}, agora = new Date()) {
  job.status = JOB_STATUS.CONCLUIDO;
  job.finalizadoEm = agora.toISOString();
  job.duracaoMs = job.iniciadoEm
    ? new Date(job.finalizadoEm).getTime() - new Date(job.iniciadoEm).getTime()
    : 0;
  job.resultado = resultado;
  job.erro = null;
  return job;
}

function marcarErro(job, erro, agora = new Date()) {
  job.status = JOB_STATUS.ERRO;
  job.finalizadoEm = agora.toISOString();
  job.duracaoMs = job.iniciadoEm
    ? new Date(job.finalizadoEm).getTime() - new Date(job.iniciadoEm).getTime()
    : 0;
  job.erro = erro?.message || String(erro || 'Erro desconhecido');
  job.resultado = { success: false, error: job.erro, code: erro?.code || null };
  return job;
}

function marcarCancelado(job, motivo = 'cancelado', agora = new Date()) {
  job.status = JOB_STATUS.CANCELADO;
  job.finalizadoEm = agora.toISOString();
  job.erro = motivo;
  return job;
}

module.exports = {
  JOB_STATUS,
  JOB_TYPES,
  criarJob,
  equipamentoKey,
  marcarExecutando,
  marcarConcluido,
  marcarErro,
  marcarCancelado,
  novoId
};
