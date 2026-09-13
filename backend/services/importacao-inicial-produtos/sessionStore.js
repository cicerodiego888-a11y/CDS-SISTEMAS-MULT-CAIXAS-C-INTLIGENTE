/**
 * Sessões em memória da Importação Inicial de Produtos (V1).
 */
'use strict';

const crypto = require('crypto');

const sessoes = new Map();
const TTL_MS = 60 * 60 * 1000;

function limparExpiradas() {
  const agora = Date.now();
  for (const [id, sessao] of sessoes.entries()) {
    if (agora - sessao.criado_em > TTL_MS) sessoes.delete(id);
  }
}

function criarSessao(payload) {
  limparExpiradas();
  const id = crypto.randomBytes(16).toString('hex');
  sessoes.set(id, {
    id,
    criado_em: Date.now(),
    status: 'validado',
    ...payload
  });
  return id;
}

function obterSessao(id) {
  limparExpiradas();
  return sessoes.get(id) || null;
}

function atualizarSessao(id, patch) {
  const atual = sessoes.get(id);
  if (!atual) return null;
  const novo = { ...atual, ...patch };
  sessoes.set(id, novo);
  return novo;
}

function removerSessao(id) {
  sessoes.delete(id);
}

module.exports = {
  criarSessao,
  obterSessao,
  atualizarSessao,
  removerSessao
};
