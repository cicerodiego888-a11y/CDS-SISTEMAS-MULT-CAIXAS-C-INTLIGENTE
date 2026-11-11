'use strict';

/**
 * TEF-DESTAXA-51.19 / 51.20 — bootstrap TX_CONTINUE e HOST_SECURITY_OPERATION_BLOCKED.
 * 51.19: causa raiz. 51.20: correção mínima + proteções.
 * Somente mocks / lógica pura / NativeHost modoTeste. Sem DLL, COM4, V$Pague,
 * banco operacional ou CRT real.
 *
 * node tests/tef/tef-destaxa-51-19-host-security-continue.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const TEF_MANAGER = path.join(ROOT, 'backend/services/tef/TefManager.js');
const HOST_RUNTIME = path.join(ROOT, 'backend/services/tef/destaxa/DestaxaNativeHost.js');

const { DestaxaNativeHostRuntime } = require('../../backend/services/tef/destaxa/DestaxaNativeHost');
const {
  OPERACOES_HOST,
  ESTADOS_BOOTSTRAP,
  ERROS_HOST
} = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.stack || error.message}`);
  }
}

/** Espelho da regra LEGADA (pré-51.20) — documenta a causa raiz. */
function decidirPermitBootstrapLegado({
  transactionId,
  operation,
  linhaAtiva,
  emExecucao,
  intent,
  continuidadeCrt
}) {
  const continuidadeAtiva = Boolean(
    continuidadeCrt && String(continuidadeCrt.transacaoId) === String(transactionId)
  );
  const execucaoAutorizada = Boolean(
    transactionId
    && linhaAtiva
    && linhaAtiva.reconciliacaoPersistenciaIncompleta !== true
    && emExecucao === true
    && String(intent?.transactionId || '') === String(transactionId)
    && Array.isArray(intent?.allowedOperations)
    && intent.allowedOperations.includes(operation)
    && (operation === 'TX_START'
      || (continuidadeAtiva && ['TX_CONTINUE', 'TX_FINALIZE'].includes(operation)))
  );
  if (!execucaoAutorizada) return null;
  return {
    permitId: `permit-${operation}`,
    operation,
    transactionId: String(transactionId)
  };
}

/**
 * Espelho fiel da regra atual em TefManager._criarBootstrapSeguranca (51.20 + 51.41).
 */
function decidirPermitBootstrap({
  transactionId,
  operation,
  linhaAtiva,
  emExecucao,
  intent,
  continuidadeCrt
}) {
  const continuidadeAtiva = Boolean(
    continuidadeCrt && String(continuidadeCrt.transacaoId) === String(transactionId)
  );
  const intentCicloAutomaticoContinue = operation === 'TX_CONTINUE'
    && Array.isArray(intent?.allowedOperations)
    && intent.allowedOperations.includes('TX_START')
    && intent.allowedOperations.includes('TX_CONTINUE');
  const intentCicloAutomaticoFinalize = operation === 'TX_FINALIZE'
    && Array.isArray(intent?.allowedOperations)
    && intent.allowedOperations.includes('TX_START')
    && intent.allowedOperations.includes('TX_CONTINUE')
    && intent.allowedOperations.includes('TX_FINALIZE');
  const execucaoAutorizada = Boolean(
    transactionId
    && linhaAtiva
    && linhaAtiva.reconciliacaoPersistenciaIncompleta !== true
    && emExecucao === true
    && String(intent?.transactionId || '') === String(transactionId)
    && Array.isArray(intent?.allowedOperations)
    && intent.allowedOperations.includes(operation)
    && (operation === 'TX_START'
      || (continuidadeAtiva && ['TX_CONTINUE', 'TX_FINALIZE'].includes(operation))
      || intentCicloAutomaticoContinue
      || intentCicloAutomaticoFinalize)
  );
  if (!execucaoAutorizada) return null;
  return {
    permitId: `permit-${operation}-${transactionId}`,
    operation,
    transactionId: String(transactionId)
  };
}

function contextoCicloAutomatico(operation, extras = {}) {
  return {
    transactionId: '1',
    operation,
    linhaAtiva: { id: '1', reconciliacaoPersistenciaIncompleta: false },
    emExecucao: true,
    intent: {
      transactionId: '1',
      allowedOperations: ['TX_START', 'TX_CONTINUE', 'TX_FINALIZE']
    },
    continuidadeCrt: null,
    ...extras
  };
}

function novoHostModoTeste() {
  const driverCalls = { inicia: 0, continua: 0, finaliza: 0 };
  const bridge = {
    getTransacaoContexto: () => null,
    getOrquestradorTransacao: () => ({
      reconciliarTransacao: () => ({ sucesso: false })
    }),
    iniciarTransacaoDestaxa: () => {
      driverCalls.inicia += 1;
      return { codigo: '99', saida: '', acao: { tipo: 'DISPLAY', mensagem: 'x' } };
    },
    continuarTransacaoDestaxa: () => {
      driverCalls.continua += 1;
      return { codigo: '00', saida: '' };
    },
    finalizarTransacaoDestaxa: () => {
      driverCalls.finaliza += 1;
      return { codigo: '00', saida: '' };
    },
    isLoaded: () => false,
    getDiagnostics: () => ({ dllLoaded: false }),
    unload: () => {}
  };
  const host = new DestaxaNativeHostRuntime({
    bridge,
    modoTeste: true,
    reconciliationPublicKey: crypto.generateKeyPairSync('ed25519').publicKey
      .export({ format: 'der', type: 'spki' }).toString('base64'),
    hostSessionId: 'sessao-51-20-teste',
    encerrarProcesso: () => {}
  });
  return { host, driverCalls };
}

console.log('\nTEF-DESTAXA-51.19/51.20 — bootstrap TX_CONTINUE\n');

test('S1) Fonte TefManager contém atalho 51.20/51.41 e preserva gate PDV', () => {
  const src = fs.readFileSync(TEF_MANAGER, 'utf8');
  assert.ok(src.includes('intentCicloAutomaticoContinue'));
  assert.ok(src.includes('intentCicloAutomaticoFinalize'));
  assert.ok(src.includes("operation === 'TX_CONTINUE'"));
  assert.ok(src.includes("operation === 'TX_FINALIZE'"));
  assert.ok(src.includes("intent.allowedOperations.includes('TX_START')"));
  assert.ok(src.includes("intent.allowedOperations.includes('TX_CONTINUE')"));
  assert.ok(src.includes("continuidadeAtiva && ['TX_CONTINUE', 'TX_FINALIZE'].includes(operation)"));
  assert.ok(src.includes('TEF-DESTAXA-51.20'));
  assert.ok(src.includes('TEF-DESTAXA-51.41'));
});

test('S2) Adapter ainda não marca _continuidadeCrt (path in-cycle permanece)', () => {
  const src = fs.readFileSync(TEF_MANAGER, 'utf8');
  const marca = src.indexOf('_marcarContinuidadeCrt(transacaoId, dados, retorno)');
  const persistir99 = src.indexOf('async _persistirSolicitacao99');
  assert.ok(persistir99 >= 0 && marca > persistir99);
  const adapterSrc = fs.readFileSync(
    path.join(ROOT, 'backend/services/tef/adapters/DestaxaRealAdapter.js'),
    'utf8'
  );
  assert.ok(adapterSrc.includes('persistencia.registrarSolicitacao99'));
  assert.ok(!adapterSrc.includes('_marcarContinuidadeCrt'));
});

test('1) TX_START continua recebendo permit no intent completo', () => {
  const start = decidirPermitBootstrap(contextoCicloAutomatico('TX_START'));
  assert.ok(start);
  assert.strictEqual(start.operation, 'TX_START');
  assert.strictEqual(start.transactionId, '1');
});

test('2) TX_CONTINUE recebe permit no ciclo automático (intent TX_START+TX_CONTINUE)', () => {
  assert.strictEqual(
    decidirPermitBootstrapLegado(contextoCicloAutomatico('TX_CONTINUE')),
    null,
    'legado 51.19 negava CONTINUE in-cycle'
  );
  const cont = decidirPermitBootstrap(contextoCicloAutomatico('TX_CONTINUE'));
  assert.ok(cont, '51.20 deve emitir permit novo de TX_CONTINUE');
  assert.strictEqual(cont.operation, 'TX_CONTINUE');
  assert.strictEqual(cont.transactionId, '1');
  assert.notStrictEqual(cont.permitId, decidirPermitBootstrap(contextoCicloAutomatico('TX_START')).permitId);
});

test('3) TX_CONTINUE bloqueado sem intent válido', () => {
  assert.strictEqual(decidirPermitBootstrap(contextoCicloAutomatico('TX_CONTINUE', {
    intent: null
  })), null);
  assert.strictEqual(decidirPermitBootstrap(contextoCicloAutomatico('TX_CONTINUE', {
    intent: { transactionId: '1', allowedOperations: null }
  })), null);
});

test('4) TX_CONTINUE bloqueado quando transactionId diverge', () => {
  assert.strictEqual(decidirPermitBootstrap(contextoCicloAutomatico('TX_CONTINUE', {
    intent: {
      transactionId: '999',
      allowedOperations: ['TX_START', 'TX_CONTINUE', 'TX_FINALIZE']
    }
  })), null);
  assert.strictEqual(decidirPermitBootstrap({
    ...contextoCicloAutomatico('TX_CONTINUE'),
    transactionId: '2',
    linhaAtiva: { id: '2' }
  }), null);
});

test('5) TX_CONTINUE bloqueado quando não está em allowedOperations', () => {
  assert.strictEqual(decidirPermitBootstrap(contextoCicloAutomatico('TX_CONTINUE', {
    intent: {
      transactionId: '1',
      allowedOperations: ['TX_START', 'TX_FINALIZE']
    }
  })), null);
});

test('6) Fluxo PDV independente: CONTINUE sem _continuidadeCrt permanece bloqueado', () => {
  const pdv = {
    transactionId: '1',
    operation: 'TX_CONTINUE',
    linhaAtiva: { id: '1' },
    emExecucao: true,
    intent: { transactionId: '1', allowedOperations: ['TX_CONTINUE', 'TX_FINALIZE'] },
    continuidadeCrt: null
  };
  assert.strictEqual(decidirPermitBootstrap(pdv), null);
  pdv.continuidadeCrt = { transacaoId: '1' };
  assert.ok(decidirPermitBootstrap(pdv));
});

test('7) TX_FINALIZE recebe permit no ciclo automático completo (51.41)', () => {
  const finalize = decidirPermitBootstrap(contextoCicloAutomatico('TX_FINALIZE'));
  assert.ok(finalize, '51.41 deve emitir permit one-shot de TX_FINALIZE no ciclo automático');
  assert.strictEqual(finalize.operation, 'TX_FINALIZE');
  assert.strictEqual(finalize.transactionId, '1');
  const comMarca = decidirPermitBootstrap(contextoCicloAutomatico('TX_FINALIZE', {
    continuidadeCrt: { transacaoId: '1' }
  }));
  assert.ok(comMarca);
  assert.strictEqual(comMarca.operation, 'TX_FINALIZE');
});

test('7b) TX_FINALIZE path PDV sem _continuidadeCrt permanece bloqueado', () => {
  const pdvFinalize = {
    transactionId: '1',
    operation: 'TX_FINALIZE',
    linhaAtiva: { id: '1' },
    emExecucao: true,
    intent: { transactionId: '1', allowedOperations: ['TX_CONTINUE', 'TX_FINALIZE'] },
    continuidadeCrt: null
  };
  assert.strictEqual(
    decidirPermitBootstrap(pdvFinalize),
    null,
    'path PDV (sem TX_START no intent) continua exigindo continuidadeAtiva'
  );
  pdvFinalize.continuidadeCrt = { transacaoId: '1' };
  assert.ok(decidirPermitBootstrap(pdvFinalize));
});

test('7c) TX_FINALIZE bloqueado se intent completo não lista TX_FINALIZE', () => {
  assert.strictEqual(decidirPermitBootstrap(contextoCicloAutomatico('TX_FINALIZE', {
    intent: {
      transactionId: '1',
      allowedOperations: ['TX_START', 'TX_CONTINUE']
    }
  })), null);
});

test('8) Permit de TX_START não pode ser reutilizado no Host', () => {
  const { host, driverCalls } = novoHostModoTeste();
  host._securityBootstrapState = ESTADOS_BOOTSTRAP.VALIDATED;
  host._securityPermit = {
    permitId: 'p-start',
    operation: OPERACOES_HOST.TX_START,
    transactionId: '1'
  };
  host._securityPermitUsed = new Set();
  host._autorizarOperacaoTransacional({
    operation: OPERACOES_HOST.TX_START,
    transactionId: '1'
  });
  assert.strictEqual(host._securityPermit, null);
  let erro = null;
  try {
    host._autorizarOperacaoTransacional({
      operation: OPERACOES_HOST.TX_CONTINUE,
      transactionId: '1'
    });
  } catch (e) {
    erro = e;
  }
  assert.ok(erro);
  assert.strictEqual(erro.code, ERROS_HOST.HOST_SECURITY_OPERATION_BLOCKED);
  assert.strictEqual(driverCalls.continua, 0);
});

test('9) Permit de TX_CONTINUE é individual e de uso único', () => {
  const { host, driverCalls } = novoHostModoTeste();
  host._securityBootstrapState = ESTADOS_BOOTSTRAP.VALIDATED;
  host._securityPermit = {
    permitId: 'p-continue-1',
    operation: OPERACOES_HOST.TX_CONTINUE,
    transactionId: '1'
  };
  host._securityPermitUsed = new Set();
  host._autorizarOperacaoTransacional({
    operation: OPERACOES_HOST.TX_CONTINUE,
    transactionId: '1'
  });
  assert.strictEqual(host._securityPermit, null);
  assert.ok(host._securityPermitUsed.has('p-continue-1'));

  host._securityPermit = {
    permitId: 'p-continue-1',
    operation: OPERACOES_HOST.TX_CONTINUE,
    transactionId: '1'
  };
  let erro = null;
  try {
    host._autorizarOperacaoTransacional({
      operation: OPERACOES_HOST.TX_CONTINUE,
      transactionId: '1'
    });
  } catch (e) {
    erro = e;
  }
  assert.ok(erro);
  assert.strictEqual(erro.code, ERROS_HOST.HOST_SECURITY_OPERATION_BLOCKED);
  assert.strictEqual(driverCalls.continua, 0);
});

test('10) Host bloqueia permit ausente, divergente ou consumido', () => {
  const { host } = novoHostModoTeste();
  host._securityBootstrapState = ESTADOS_BOOTSTRAP.VALIDATED;
  host._securityPermitUsed = new Set();

  host._securityPermit = null;
  assert.throws(
    () => host._autorizarOperacaoTransacional({
      operation: OPERACOES_HOST.TX_CONTINUE,
      transactionId: '1'
    }),
    (e) => e.code === ERROS_HOST.HOST_SECURITY_OPERATION_BLOCKED
  );

  host._securityPermit = {
    permitId: 'p-x',
    operation: OPERACOES_HOST.TX_START,
    transactionId: '1'
  };
  assert.throws(
    () => host._autorizarOperacaoTransacional({
      operation: OPERACOES_HOST.TX_CONTINUE,
      transactionId: '1'
    }),
    (e) => e.code === ERROS_HOST.HOST_SECURITY_OPERATION_BLOCKED
  );

  host._securityPermit = {
    permitId: 'p-y',
    operation: OPERACOES_HOST.TX_CONTINUE,
    transactionId: '2'
  };
  assert.throws(
    () => host._autorizarOperacaoTransacional({
      operation: OPERACOES_HOST.TX_CONTINUE,
      transactionId: '1'
    }),
    (e) => e.code === ERROS_HOST.HOST_SECURITY_OPERATION_BLOCKED
  );
});

test('11) Transações distintas não compartilham permits', () => {
  const p1 = decidirPermitBootstrap(contextoCicloAutomatico('TX_CONTINUE'));
  const p2 = decidirPermitBootstrap({
    transactionId: '2',
    operation: 'TX_CONTINUE',
    linhaAtiva: { id: '2' },
    emExecucao: true,
    intent: {
      transactionId: '2',
      allowedOperations: ['TX_START', 'TX_CONTINUE', 'TX_FINALIZE']
    },
    continuidadeCrt: null
  });
  assert.ok(p1 && p2);
  assert.notStrictEqual(p1.transactionId, p2.transactionId);
  assert.notStrictEqual(p1.permitId, p2.permitId);

  const { host } = novoHostModoTeste();
  host._securityBootstrapState = ESTADOS_BOOTSTRAP.VALIDATED;
  host._securityPermitUsed = new Set();
  host._securityPermit = {
    permitId: 'p-tx1',
    operation: OPERACOES_HOST.TX_CONTINUE,
    transactionId: '1'
  };
  assert.throws(
    () => host._autorizarOperacaoTransacional({
      operation: OPERACOES_HOST.TX_CONTINUE,
      transactionId: '2'
    }),
    (e) => e.code === ERROS_HOST.HOST_SECURITY_OPERATION_BLOCKED
  );
});

test('12) Contexto encerrado/inválido não emite permit', () => {
  assert.strictEqual(decidirPermitBootstrap(contextoCicloAutomatico('TX_CONTINUE', {
    emExecucao: false
  })), null);
  assert.strictEqual(decidirPermitBootstrap(contextoCicloAutomatico('TX_CONTINUE', {
    linhaAtiva: null
  })), null);
  assert.strictEqual(decidirPermitBootstrap(contextoCicloAutomatico('TX_CONTINUE', {
    linhaAtiva: { id: '1', reconciliacaoPersistenciaIncompleta: true }
  })), null);
  assert.strictEqual(decidirPermitBootstrap(contextoCicloAutomatico('TX_CONTINUE', {
    transactionId: null
  })), null);
});

test('13) display_ack permanece contrato válido (não é a causa do bloqueio)', () => {
  const {
    resolverRespostaContinuidade
  } = require('../../backend/services/tef/destaxa/destaxaCrtCicloOrquestracao');
  const resolucao = resolverRespostaContinuidade({ tipo: 'DISPLAY', mensagem: 'x' }, []);
  assert.strictEqual(resolucao.ok, true);
  assert.deepStrictEqual(resolucao.resposta, { displayAck: true });
  assert.strictEqual(resolucao.origem, 'display_ack');
});

test('14) Fonte Host confirma mensagem da regra de permit', () => {
  const src = fs.readFileSync(HOST_RUNTIME, 'utf8');
  assert.ok(src.includes('HOST_SECURITY_OPERATION_BLOCKED'));
  assert.ok(src.includes('autorização de operação ausente, divergente ou já consumida'));
  assert.ok(src.includes('permit.operation !== req.operation'));
});

console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
process.exit(falhou ? 1 : 0);
