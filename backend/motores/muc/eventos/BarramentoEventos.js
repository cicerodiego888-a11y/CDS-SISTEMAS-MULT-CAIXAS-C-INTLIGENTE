/**
 * MUC RC2 — Barramento interno de eventos
 * @module motores/muc/eventos/BarramentoEventos
 */
'use strict';

const crypto = require('crypto');

const EVENTOS = Object.freeze([
  'MUC_CONVERSAO_EXECUTADA',
  'MUC_CONVERSAO_CONFIRMADA',
  'MUC_CONVERSAO_MANUAL',
  'MUC_APRESENTACAO_APRENDIDA',
  'MUC_ERRO',
  'MUC_INFERENCIA_FALHOU'
]);

const _historico = [];
const _listeners = new Map();
const MAX_HISTORICO = 500;

function gerarCorrelationId() {
  return crypto.randomBytes(8).toString('hex');
}

function criarEnvelope(tipo, payload = {}, correlationId = null) {
  return Object.freeze({
    tipo: String(tipo),
    timestamp: new Date().toISOString(),
    correlationId: correlationId || gerarCorrelationId(),
    payload: Object.freeze({ ...payload })
  });
}

function registrar(tipo, payload, correlationId) {
  const envelope = criarEnvelope(tipo, payload, correlationId);
  _historico.push(envelope);
  if (_historico.length > MAX_HISTORICO) _historico.shift();

  const listeners = _listeners.get(tipo) || [];
  listeners.forEach((fn) => {
    try { fn(envelope); } catch (err) {
      console.warn('[MUC Eventos]', tipo, err.message);
    }
  });
  return envelope;
}

function on(tipo, fn) {
  if (!_listeners.has(tipo)) _listeners.set(tipo, []);
  _listeners.get(tipo).push(fn);
}

function listar(filtro = {}) {
  let lista = [..._historico];
  if (filtro.tipo) lista = lista.filter((e) => e.tipo === filtro.tipo);
  if (filtro.correlationId) lista = lista.filter((e) => e.correlationId === filtro.correlationId);
  return lista;
}

function limparHistorico() {
  _historico.length = 0;
}

module.exports = {
  EVENTOS,
  gerarCorrelationId,
  criarEnvelope,
  registrar,
  on,
  listar,
  limparHistorico
};
