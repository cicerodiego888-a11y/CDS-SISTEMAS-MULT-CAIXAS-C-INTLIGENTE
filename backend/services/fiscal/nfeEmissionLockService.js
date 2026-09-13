/**
 * Lock de emissão NF-e — impede duplo clique e transmissões concorrentes.
 */

'use strict';

const locks = new Map();
/** Filas de serialização (numeração). Diferente do lock de emissão, que rejeita concorrência. */
const filas = new Map();

function chaveLock(escopo) {
  return String(escopo || '').trim();
}

function adquirirLock(escopo, { titular } = {}) {
  const chave = chaveLock(escopo);
  if (!chave) {
    const err = new Error('Escopo de lock de emissão ausente.');
    err.code = 'LOCK_INVALIDO';
    throw err;
  }
  if (locks.has(chave)) {
    const err = new Error(
      'A NF-e desta devolução já está sendo processada. Aguarde a conclusão.'
    );
    err.code = 'EMISSAO_EM_ANDAMENTO';
    err.statusCode = 409;
    throw err;
  }
  const token = {
    chave,
    titular: titular || null,
    desde: Date.now()
  };
  locks.set(chave, token);
  return token;
}

function liberarLock(escopoOuToken) {
  const chave = typeof escopoOuToken === 'string'
    ? chaveLock(escopoOuToken)
    : (escopoOuToken && escopoOuToken.chave);
  if (chave) locks.delete(chave);
}

async function withLock(escopo, fn, opts) {
  const token = adquirirLock(escopo, opts);
  try {
    return await fn(token);
  } finally {
    liberarLock(token);
  }
}

/**
 * Serializa chamadas no mesmo escopo (espera a anterior).
 * Usar para numeração fiscal. Não usar para duplo clique de emissão.
 */
function withLockQueued(escopo, fn) {
  const chave = chaveLock(escopo);
  const anterior = filas.get(chave) || Promise.resolve();
  let liberarFila;
  const proxima = new Promise((resolve) => {
    liberarFila = resolve;
  });
  filas.set(chave, anterior.then(() => proxima).catch(() => proxima));
  return anterior.then(async () => {
    const token = { chave, titular: 'fila', desde: Date.now() };
    locks.set(chave, token);
    try {
      return await fn(token);
    } finally {
      locks.delete(chave);
      liberarFila();
    }
  });
}

function lockAtivo(escopo) {
  return locks.has(chaveLock(escopo));
}

function resetLocksForTests() {
  locks.clear();
  filas.clear();
}

module.exports = {
  adquirirLock,
  liberarLock,
  withLock,
  withLockQueued,
  lockAtivo,
  resetLocksForTests
};
