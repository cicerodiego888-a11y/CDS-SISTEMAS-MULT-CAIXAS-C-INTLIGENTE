'use strict';

/**
 * TEF-DESTAXA-51.05 — continuidade TX_START→99→TX_CONTINUE (mocks).
 * Executar: node tests/tef/tef-destaxa-51-05-continuidade-99.test.js
 * Sem DLL, NativeHost, V$Pague ou TX real.
 */

const assert = require('assert');
const {
  executarCicloCrt,
  continuarCicloCrt,
  resolverRespostaContinuidade,
  CICLO_ERROS
} = require('../../backend/services/tef/destaxa/destaxaCrtCicloOrquestracao');
const {
  TIPOS_ACAO,
  ERROS
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const {
  ehColetaDelegadaAoPinPad,
  ESTADOS_CONTINUIDADE,
  TIMEOUT_PDV_CONTINUIDADE_PADRAO_SEG
} = require('../../backend/services/tef/destaxa/destaxaContinuidadeEstados');
const {
  validarRespostaOperador,
  avaliarTimeoutColeta,
  registrarOuRejeitarRespostaDuplicada,
  limparRegistrosContinuidade
} = require('../../backend/services/tef/destaxa/destaxaContinuidadeContrato');
const tefIndex = require('../../backend/services/tef/index');

let passou = 0;
let falhou = 0;

async function test(nome, fn) {
  try {
    await fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.stack || error.message}`);
  }
}

function criarBridgeMock({ passos = [] } = {}) {
  let n = 0;
  const continues = [];
  return {
    continues,
    usaDriverNativo() { return false; },
    async iniciarTransacaoDestaxa() {
      const p = passos[n++] || {
        sucesso: false,
        codigoDestaxa: '99',
        requerContinuacao: true,
        acao: {
          tipo: TIPOS_ACAO.COLETA,
          mensagem: 'Aguarde a passagem/insercao/aproximacao do cartao no PIN-Pad.',
          chave: 'transacao_cartao_numero'
        },
        financialState: 'PENDING'
      };
      return p;
    },
    async continuarTransacaoDestaxa(resposta) {
      continues.push(resposta);
      const p = passos[n++] || {
        sucesso: true,
        codigoDestaxa: '00',
        requerContinuacao: false,
        financialState: 'CONFIRMED_SUCCESS'
      };
      return p;
    },
    async finalizarTransacaoDestaxa() {
      return { sucesso: true, codigoDestaxa: '00' };
    }
  };
}

/** Mock da reserva durável exigida antes de TX_CONTINUE (sem SQLite oficial). */
function mockPersistirAntesContinue(transactionId) {
  return async ({ resposta, solicitadaEm }) => ({
    ok: true,
    duravel: true,
    confirmada: true,
    transactionId: String(transactionId),
    solicitadaEm,
    estadoDespacho: 'INICIADO',
    despachoId: `despacho-mock-${Date.now()}`,
    fingerprint: 'fp-mock-5105-aaaaaaaaaaaaaaaaaaaaaaaa',
    resposta,
    identidade: {
      transactionId: String(transactionId),
      operation_id: 'op-mock-5105',
      idempotency_key: 'idem-mock-5105',
      fingerprint: 'fp-mock-5105-aaaaaaaaaaaaaaaaaaaaaaaa'
    }
  });
}

async function main() {
  console.log('\nTEF-DESTAXA-51.05 — continuidade 99 / Electron (mocks)\n');

  await test('1) TX_START retornando 99 (COLETA PinPad) emite TX_CONTINUE com informacao vazia', async () => {
    const bridge = criarBridgeMock();
    const ciclo = await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      camposEntrada: { valor: '1.00' },
      transactionId: 'tx-5105-1',
      exigirPersistencia: true,
      respostasContinuidade: [],
      persistirRespostaAntesContinue: mockPersistirAntesContinue('tx-5105-1')
    });
    assert.strictEqual(bridge.continues.length, 1, 'deve haver exatamente 1 TX_CONTINUE');
    assert.deepStrictEqual(bridge.continues[0], { informacao: '' });
    assert.ok(ciclo.ciclo.passos.some((p) => p.passo === 'TX_CONTINUE'));
    assert.ok(ciclo.sucesso === true || ciclo.codigoDestaxa === '00' || ciclo.resultadoUltimo?.codigoDestaxa === '00');
  });

  await test('2) Solicitação de coleta de cartão é reconhecida como PinPad', async () => {
    assert.strictEqual(
      ehColetaDelegadaAoPinPad({
        tipo: 'COLETA',
        chave: 'transacao_cartao_numero',
        mensagem: 'Aguarde cartao'
      }),
      true
    );
    assert.strictEqual(
      ehColetaDelegadaAoPinPad({ tipo: 'COLETA', chave: 'cpf_cliente', mensagem: 'Informe CPF' }),
      false
    );
  });

  await test('3) Recebimento de dados da coleta PinPad aceita informacao vazia', async () => {
    const v = validarRespostaOperador(
      { tipo: 'COLETA', chave: 'transacao_cartao_numero', mensagem: 'Aproxime o cartao' },
      { informacao: '' }
    );
    assert.strictEqual(v.ok, true);
    assert.deepStrictEqual(v.resposta, { informacao: '' });
  });

  await test('4) TX_CONTINUE encaminhado corretamente apos 99 DISPLAY+COLETA mista via fila OPCAO', async () => {
    const bridge = criarBridgeMock({
      passos: [
        {
          sucesso: false,
          codigoDestaxa: '99',
          requerContinuacao: true,
          acao: { tipo: TIPOS_ACAO.OPCAO, mensagem: 'Escolha', opcoes: ['Debito', 'Credito'] }
        },
        {
          sucesso: true,
          codigoDestaxa: '00',
          requerContinuacao: false,
          financialState: 'CONFIRMED_SUCCESS'
        }
      ]
    });
    const ciclo = await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      camposEntrada: {},
      transactionId: 'tx-5105-4',
      exigirPersistencia: true,
      respostasContinuidade: [{ informacao: 'Debito' }],
      persistirRespostaAntesContinue: mockPersistirAntesContinue('tx-5105-4')
    });
    assert.strictEqual(bridge.continues.length, 1);
    assert.deepStrictEqual(bridge.continues[0], { informacao: 'Debito' });
    assert.ok(ciclo.ciclo.passos.some((p) => p.passo === 'TX_CONTINUE'));
  });

  await test('5) Continuidade nao bloqueia event loop — setImmediate entre passos (smoke)', async () => {
    let yielded = false;
    const orig = global.setImmediate;
    global.setImmediate = (fn) => {
      yielded = true;
      return orig(fn);
    };
    try {
      const bridge = criarBridgeMock();
      await executarCicloCrt({
        bridge,
        operacao: 'CRT',
        camposEntrada: {},
        transactionId: 'tx-5105-5',
        exigirPersistencia: true,
        respostasContinuidade: [],
        persistirRespostaAntesContinue: mockPersistirAntesContinue('tx-5105-5')
      });
      assert.strictEqual(yielded, true, 'ciclo deve ceder via setImmediate');
    } finally {
      global.setImmediate = orig;
    }
  });

  await test('6) Ausencia de continuidade tipada (COLETA nao-PinPad) sem fila — sem TX_CONTINUE', async () => {
    const bridge = criarBridgeMock({
      passos: [{
        sucesso: false,
        codigoDestaxa: '99',
        requerContinuacao: true,
        acao: { tipo: TIPOS_ACAO.COLETA, chave: 'cpf_cliente', mensagem: 'Informe CPF' }
      }]
    });
    const ciclo = await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      camposEntrada: {},
      transactionId: 'tx-5105-6',
      exigirPersistencia: true,
      respostasContinuidade: []
    });
    assert.strictEqual(bridge.continues.length, 0);
    assert.strictEqual(ciclo.requerContinuacao, true);
    assert.strictEqual(ciclo.codigo, CICLO_ERROS.CONTINUIDADE_SEM_RESPOSTA);
  });

  await test('7) Timeout de continuidade', async () => {
    const solicitadaEm = new Date(Date.now() - 95_000).toISOString();
    const to = avaliarTimeoutColeta({
      timeoutSegundos: 90,
      solicitadaEm,
      agoraMs: Date.now()
    });
    assert.strictEqual(to.ok, false);
    assert.strictEqual(to.codigo, 'DESTAXA_CONTINUIDADE_TIMEOUT');
    assert.strictEqual(to.retryAllowed, false);
    assert.ok(TIMEOUT_PDV_CONTINUIDADE_PADRAO_SEG < 120);
  });

  await test('8) Resposta duplicada rejeitada', async () => {
    limparRegistrosContinuidade();
    const args = {
      transactionId: 'tx-dup',
      acao: { tipo: 'COLETA', chave: 'cpf_cliente' },
      resposta: { informacao: '123' },
      solicitadaEm: new Date().toISOString()
    };
    const a = registrarOuRejeitarRespostaDuplicada(args);
    const b = registrarOuRejeitarRespostaDuplicada(args);
    assert.strictEqual(a.ok, true);
    assert.strictEqual(b.ok, false);
    assert.strictEqual(b.codigo, 'DESTAXA_CONTINUIDADE_RESPOSTA_DUPLICADA');
    limparRegistrosContinuidade();
  });

  await test('9) Resposta tardia (timeout) — UNKNOWN sem retry', async () => {
    const to = avaliarTimeoutColeta({
      timeoutSegundos: 1,
      solicitadaEm: new Date(Date.now() - 5000).toISOString()
    });
    assert.strictEqual(to.ok, false);
    assert.strictEqual(to.financialStateHint, 'UNKNOWN');
    assert.strictEqual(to.retryAllowed, false);
  });

  await test('10) Estado UNKNOWN enumerado e sem retry', async () => {
    assert.strictEqual(ESTADOS_CONTINUIDADE.UNKNOWN, 'UNKNOWN');
    assert.ok(Object.values(ESTADOS_CONTINUIDADE).includes('TIMEOUT'));
    assert.ok(Object.values(ESTADOS_CONTINUIDADE).includes('AGUARDANDO_RESPOSTA_OPERADOR'));
  });

  await test('11) Protecao contra segunda tentativa — continuarCiclo exige identidade', async () => {
    const bridge = criarBridgeMock({
      passos: [{
        sucesso: true,
        codigoDestaxa: '00',
        requerContinuacao: false
      }]
    });
    const r = await continuarCicloCrt({
      bridge,
      transactionId: null,
      respostasContinuidade: [{ informacao: '' }],
      acaoAtual: { tipo: TIPOS_ACAO.COLETA, chave: 'transacao_cartao_numero' }
    });
    assert.strictEqual(r.sucesso, false);
    assert.ok(
      r.codigo === CICLO_ERROS.CONTINUIDADE_SEM_RESPOSTA
      || /transactionId|obrigat/i.test(String(r.mensagem || r.codigo || ''))
      || r.retryAllowed === false
    );
  });

  await test('12) iniciarPagamento preserva solicitadaEm no hand-off 99', async () => {
    const original = require('../../backend/services/tef/TefManager');
    const stub = async () => ({
      sucesso: false,
      status: 'pendente',
      codigo: 'DESTAXA_CICLO_CONTINUIDADE_SEM_RESPOSTA',
      mensagem: 'aguarda',
      transacao_id: 42,
      requerContinuacao: true,
      acao: { tipo: 'COLETA', chave: 'cpf_cliente' },
      solicitadaEm: '2026-11-09T18:00:00.000Z',
      idempotency_key: 'idem-5105',
      retryAllowed: false
    });
    const prev = original.autorizar.bind(original);
    original.autorizar = stub;
    try {
      const out = await tefIndex.iniciarPagamento({ tipo: 'cartao_debito', valor: 1 });
      assert.strictEqual(out.requerContinuacao, true);
      assert.strictEqual(out.solicitadaEm, '2026-11-09T18:00:00.000Z');
      assert.strictEqual(out.idempotency_key, 'idem-5105');
      assert.strictEqual(out.retryAllowed, false);
    } finally {
      original.autorizar = prev;
    }
  });

  await test('13) resolverRespostaContinuidade PinPad vs tipada', async () => {
    const pin = resolverRespostaContinuidade(
      { tipo: TIPOS_ACAO.COLETA, chave: 'transacao_cartao_numero', mensagem: 'Aproxime' },
      []
    );
    assert.strictEqual(pin.ok, true);
    assert.strictEqual(pin.origem, 'pinpad_ack_vazio');

    const tipada = resolverRespostaContinuidade(
      { tipo: TIPOS_ACAO.COLETA, chave: 'cpf_cliente', mensagem: 'CPF' },
      []
    );
    assert.strictEqual(tipada.ok, false);
    assert.strictEqual(tipada.codigo, CICLO_ERROS.CONTINUIDADE_SEM_RESPOSTA);
  });

  console.log(`\nResultado: ${passou} ok / ${falhou} falhas\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
