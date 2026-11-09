'use strict';

const assert = require('assert');

process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';

const { executarCicloCrt, continuarCicloCrt } = require(
  '../../backend/services/tef/destaxa/destaxaCrtCicloOrquestracao'
);
const DestaxaRealAdapter = require(
  '../../backend/services/tef/adapters/DestaxaRealAdapter'
);
const tefContrato = require('../../backend/services/tef/tefContrato');

const TIMESTAMP = '2026-11-05T12:00:00.000Z';
const IDENTIDADE = Object.freeze({
  transactionId: 'mrt5014-tx',
  operation_id: 'mrt5014-operation',
  idempotency_key: 'mrt5014-idempotency',
  fingerprint: 'b'.repeat(64)
});
const ACAO = Object.freeze({
  tipo: 'COLETA',
  mensagem: 'Valor',
  tipoDado: 'X',
  timeout: '120'
});

const casos = [];

function caso(nome, executar) {
  casos.push({ nome, executar });
}

function criarBridge({ starts = [], continues = [], finalizes = [], timeline = null } = {}) {
  const bridge = {
    chamadas: [],
    async iniciarTransacaoDestaxa(...args) {
      this.chamadas.push({ operacao: 'TX_START', args });
      timeline?.push('TX_START');
      return starts.shift() || { sucesso: true, codigoDestaxa: '00' };
    },
    async continuarTransacaoDestaxa(...args) {
      this.chamadas.push({ operacao: 'TX_CONTINUE', args });
      timeline?.push('TX_CONTINUE');
      return continues.shift() || { sucesso: true, codigoDestaxa: '00' };
    },
    async finalizarTransacaoDestaxa(...args) {
      this.chamadas.push({ operacao: 'TX_FINALIZE', args });
      timeline?.push('TX_FINALIZE');
      return finalizes.shift() || { sucesso: true, codigoDestaxa: '00' };
    }
  };
  return bridge;
}

function resultadoPersistencia(args, overrides = {}) {
  return {
    ok: true,
    duravel: true,
    confirmada: true,
    transactionId: String(args.transactionId),
    solicitadaEm: args.solicitadaEm,
    estadoDespacho: 'INICIADO',
    despachoId: `dispatch-${String(args.solicitadaEm).replace(/[^0-9]/g, '')}`,
    fingerprint: 'a'.repeat(64),
    identidade: { ...IDENTIDADE, transactionId: String(args.transactionId) },
    resposta: JSON.parse(JSON.stringify(args.resposta)),
    ...overrides
  };
}

function persistenciaMock(eventos, overrides = {}) {
  return async (args) => {
    eventos.push({ tipo: 'PERSISTENCIA_CONFIRMADA', args });
    return resultadoPersistencia(args, overrides);
  };
}

function assertBloqueio(resultado, bridge) {
  assert.strictEqual(resultado.sucesso, false);
  assert.strictEqual(resultado.financialState, 'UNKNOWN');
  assert.strictEqual(resultado.retryAllowed, false);
  assert.strictEqual(resultado.reconciliacaoObrigatoria, true);
  assert.strictEqual(bridge.chamadas.some((chamada) =>
    chamada.operacao === 'TX_CONTINUE' || chamada.operacao === 'TX_FINALIZE'), false);
}

caso('Continuidade sem opção nem callback bloqueia antes do bridge', async () => {
  const bridge = criarBridge();
  const resultado = await continuarCicloCrt({
    bridge,
    transactionId: IDENTIDADE.transactionId,
    respostaOperador: { informacao: '1.00' },
    acaoAtual: ACAO,
    solicitadaEm: TIMESTAMP
  });
  assertBloqueio(resultado, bridge);
  assert.strictEqual(resultado.codigo, 'TEF_CONTINUIDADE_PERSISTENCIA_FALHOU');
});

caso('Flag false não desativa persistência obrigatória', async () => {
  const bridge = criarBridge();
  const resultado = await continuarCicloCrt({
    bridge,
    transactionId: IDENTIDADE.transactionId,
    respostaOperador: { informacao: '1.00' },
    acaoAtual: ACAO,
    solicitadaEm: TIMESTAMP,
    exigirPersistenciaContinuidade: false
  });
  assertBloqueio(resultado, bridge);
});

caso('Persistência com ok false bloqueia', async () => {
  const bridge = criarBridge();
  const eventos = [];
  const resultado = await continuarCicloCrt({
    bridge,
    transactionId: IDENTIDADE.transactionId,
    respostaOperador: { informacao: '1.00' },
    acaoAtual: ACAO,
    solicitadaEm: TIMESTAMP,
    persistirRespostaAntesContinue: persistenciaMock(eventos, { ok: false })
  });
  assertBloqueio(resultado, bridge);
  assert.strictEqual(eventos.length, 1);
});

caso('Ausência de confirmação durável bloqueia', async () => {
  const bridge = criarBridge();
  const eventos = [];
  const resultado = await continuarCicloCrt({
    bridge,
    transactionId: IDENTIDADE.transactionId,
    respostaOperador: { informacao: '1.00' },
    acaoAtual: ACAO,
    solicitadaEm: TIMESTAMP,
    persistirRespostaAntesContinue: persistenciaMock(eventos, { duravel: false })
  });
  assertBloqueio(resultado, bridge);
});

caso('Callback sem confirmação explícita bloqueia', async () => {
  const bridge = criarBridge();
  const eventos = [];
  const resultado = await continuarCicloCrt({
    bridge,
    transactionId: IDENTIDADE.transactionId,
    respostaOperador: { informacao: '1.00' },
    acaoAtual: ACAO,
    solicitadaEm: TIMESTAMP,
    persistirRespostaAntesContinue: persistenciaMock(eventos, { confirmada: false })
  });
  assertBloqueio(resultado, bridge);
});

caso('Confirmação sem campos da reserva MRT-50.10 bloqueia', async () => {
  const bridge = criarBridge();
  const eventos = [];
  const resultado = await continuarCicloCrt({
    bridge,
    transactionId: IDENTIDADE.transactionId,
    respostaOperador: { informacao: '1.00' },
    acaoAtual: ACAO,
    solicitadaEm: TIMESTAMP,
    persistirRespostaAntesContinue: persistenciaMock(eventos, {
      despachoId: null,
      estadoDespacho: 'PRONTA'
    })
  });
  assertBloqueio(resultado, bridge);
});

caso('Exceção de persistência bloqueia e exige reconciliação', async () => {
  const bridge = criarBridge();
  const resultado = await continuarCicloCrt({
    bridge,
    transactionId: IDENTIDADE.transactionId,
    respostaOperador: { informacao: '1.00' },
    acaoAtual: ACAO,
    solicitadaEm: TIMESTAMP,
    persistirRespostaAntesContinue: async () => {
      throw new Error('falha simulada de persistência');
    }
  });
  assertBloqueio(resultado, bridge);
});

caso('Contexto sem transactionId ou timestamp bloqueia antes do callback', async () => {
  for (const contexto of [
    { transactionId: null, solicitadaEm: TIMESTAMP },
    { transactionId: IDENTIDADE.transactionId, solicitadaEm: null }
  ]) {
    const bridge = criarBridge();
    let chamadasPersistencia = 0;
    const resultado = await continuarCicloCrt({
      bridge,
      respostaOperador: { informacao: '1.00' },
      acaoAtual: ACAO,
      ...contexto,
      persistirRespostaAntesContinue: async () => {
        chamadasPersistencia += 1;
        return {};
      }
    });
    assertBloqueio(resultado, bridge);
    assert.strictEqual(chamadasPersistencia, 0);
  }
});

caso('TransactionId divergente na confirmação bloqueia', async () => {
  const bridge = criarBridge();
  const eventos = [];
  const resultado = await continuarCicloCrt({
    bridge,
    transactionId: IDENTIDADE.transactionId,
    respostaOperador: { informacao: '1.00' },
    acaoAtual: ACAO,
    solicitadaEm: TIMESTAMP,
    persistirRespostaAntesContinue: persistenciaMock(eventos, {
      transactionId: 'outra-transacao'
    })
  });
  assertBloqueio(resultado, bridge);
});

caso('Timestamp divergente na confirmação bloqueia', async () => {
  const bridge = criarBridge();
  const eventos = [];
  const resultado = await continuarCicloCrt({
    bridge,
    transactionId: IDENTIDADE.transactionId,
    respostaOperador: { informacao: '1.00' },
    acaoAtual: ACAO,
    solicitadaEm: TIMESTAMP,
    persistirRespostaAntesContinue: persistenciaMock(eventos, {
      solicitadaEm: '2026-11-05T12:01:00.000Z'
    })
  });
  assertBloqueio(resultado, bridge);
});

caso('Identidade ou resposta divergente na confirmação bloqueia', async () => {
  for (const overrides of [
    { identidade: { ...IDENTIDADE, operation_id: '' } },
    { identidade: { ...IDENTIDADE, transactionId: 'outra-transacao' } },
    { resposta: { informacao: 'outro-valor' } }
  ]) {
    const bridge = criarBridge();
    const eventos = [];
    const resultado = await continuarCicloCrt({
      bridge,
      transactionId: IDENTIDADE.transactionId,
      respostaOperador: { informacao: '1.00' },
      acaoAtual: ACAO,
      solicitadaEm: TIMESTAMP,
      persistirRespostaAntesContinue: persistenciaMock(eventos, overrides)
    });
    assertBloqueio(resultado, bridge);
  }
});

caso('Resposta inicial e todas as 99 subsequentes persistem antes do dispatch', async () => {
  const timeline = [];
  const bridge = criarBridge({
    timeline,
    continues: [
      { sucesso: false, codigoDestaxa: '99', requerContinuacao: true, acao: ACAO },
      { sucesso: false, codigoDestaxa: '99', requerContinuacao: true, acao: ACAO },
      { sucesso: true, codigoDestaxa: '00' }
    ],
    finalizes: [{ sucesso: true, codigoDestaxa: '00' }]
  });
  const persistir = async (args) => {
    timeline.push('PERSISTENCIA_CONFIRMADA');
    return resultadoPersistencia(args);
  };
  const resultado = await continuarCicloCrt({
    bridge,
    transactionId: IDENTIDADE.transactionId,
    respostaOperador: { informacao: 'primeira' },
    respostasContinuidade: ['segunda', 'terceira'],
    acaoAtual: ACAO,
    solicitadaEm: TIMESTAMP,
    persistirRespostaAntesContinue: persistir
  });
  assert.strictEqual(resultado.sucesso, true);
  assert.strictEqual(bridge.chamadas.filter((chamada) =>
    chamada.operacao === 'TX_CONTINUE').length, 3);
  assert.deepStrictEqual(timeline, [
    'PERSISTENCIA_CONFIRMADA',
    'TX_CONTINUE',
    'PERSISTENCIA_CONFIRMADA',
    'TX_CONTINUE',
    'PERSISTENCIA_CONFIRMADA',
    'TX_CONTINUE',
    'TX_FINALIZE'
  ]);
  assert.strictEqual(bridge.chamadas[bridge.chamadas.length - 1].operacao, 'TX_FINALIZE');
});

caso('Ciclo iniciado em TX_START persiste cada resposta 99 antes de continuar', async () => {
  const timeline = [];
  const bridge = criarBridge({
    timeline,
    starts: [{ sucesso: false, codigoDestaxa: '99', requerContinuacao: true, acao: ACAO }],
    continues: [
      { sucesso: false, codigoDestaxa: '99', requerContinuacao: true, acao: ACAO },
      { sucesso: true, codigoDestaxa: '00' }
    ],
    finalizes: [{ sucesso: true, codigoDestaxa: '00' }]
  });
  const resultado = await executarCicloCrt({
    bridge,
    transactionId: IDENTIDADE.transactionId,
    camposEntrada: {},
    respostasContinuidade: ['uma', 'duas'],
    persistirRespostaAntesContinue: async (args) => {
      timeline.push('PERSISTENCIA_CONFIRMADA');
      return resultadoPersistencia(args);
    }
  });
  assert.strictEqual(resultado.sucesso, true);
  assert.strictEqual(bridge.chamadas.filter((chamada) =>
    chamada.operacao === 'TX_CONTINUE').length, 2);
  assert.deepStrictEqual(timeline, [
    'TX_START',
    'PERSISTENCIA_CONFIRMADA',
    'TX_CONTINUE',
    'PERSISTENCIA_CONFIRMADA',
    'TX_CONTINUE',
    'TX_FINALIZE'
  ]);
  assert.strictEqual(
    bridge.chamadas.findIndex((chamada) => chamada.operacao === 'TX_CONTINUE'),
    1
  );
});

async function assertContinuacaoDiretaBloqueada(contexto) {
  const bridge = criarBridge();
  const adapter = new DestaxaRealAdapter({}, { bridge });
  const resultado = await adapter.continuarTransacao(contexto);
  assert.strictEqual(resultado.codigo, 'DESTAXA_CONTINUIDADE_AUTORIZACAO_NAO_COMPROVADA');
  assert.strictEqual(resultado.status, tefContrato.STATUS.PENDENTE);
  assert.strictEqual(resultado.financialState, 'UNKNOWN');
  assert.strictEqual(resultado.retryAllowed, false);
  assert.strictEqual(resultado.reconciliacaoObrigatoria, true);
  assert.strictEqual(resultado.transactionAttempted, false);
  assert.strictEqual(bridge.chamadas.length, 0);
}

caso('continuarTransacao direta sem autorização verificável bloqueia', async () => {
  await assertContinuacaoDiretaBloqueada({});
});

caso('continuarTransacao direta com contexto incompleto bloqueia', async () => {
  await assertContinuacaoDiretaBloqueada({
    transactionId: IDENTIDADE.transactionId,
    persistenciaConfirmada: true,
    autorizado: true
  });
});

caso('continuarTransacao direta com identidade ou timestamp divergente bloqueia', async () => {
  await assertContinuacaoDiretaBloqueada({
    transactionId: IDENTIDADE.transactionId,
    identidade: { ...IDENTIDADE, fingerprint: 'divergente' },
    solicitadaEm: '2026-11-05T12:01:00.000Z',
    resposta: { informacao: '1.00' },
    despachoId: 'dispatch-replay',
    estadoDespacho: 'INICIADO'
  });
});

caso('continuarTransacao direta com reserva já iniciada bloqueia', async () => {
  await assertContinuacaoDiretaBloqueada({
    transactionId: IDENTIDADE.transactionId,
    identidade: IDENTIDADE,
    solicitadaEm: TIMESTAMP,
    resposta: { informacao: '1.00' },
    despachoId: 'dispatch-previous',
    estadoDespacho: 'INICIADO'
  });
});

caso('continuarTransacao direta após reinício sem vínculo ativo bloqueia', async () => {
  await assertContinuacaoDiretaBloqueada({
    transactionId: IDENTIDADE.transactionId,
    identidade: IDENTIDADE,
    solicitadaEm: TIMESTAMP,
    resposta: { informacao: '1.00' },
    despachoId: 'dispatch-old-session',
    hostSessionId: 'session-encerrada'
  });
});

async function executar() {
  let falhas = 0;
  for (const item of casos) {
    try {
      await item.executar();
      console.log(`PASSOU ${item.nome}`);
    } catch (error) {
      falhas += 1;
      console.error(`FALHOU ${item.nome}: ${error.stack || error.message}`);
    }
  }
  console.log(`MRT-50.14: ${casos.length - falhas}/${casos.length} passaram; ${falhas} falharam`);
  if (falhas > 0) process.exitCode = 1;
}

executar().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
