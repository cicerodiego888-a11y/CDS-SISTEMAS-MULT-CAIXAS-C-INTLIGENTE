/**
 * TEF-DESTAXA-05 — blindagem de retry e estados financeiros.
 * Somente mocks; nenhuma função transacional real é carregada/chamada.
 */
'use strict';

const assert = require('assert');
const tefRetryService = require('../../backend/services/tef/tefRetryService');
const DestaxaTransacaoOrquestrador = require('../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador');
const DestaxaTransacaoMockDriver = require('../../backend/services/tef/destaxa/destaxaTransacaoMockDriver');
const {
  classificarCodigoFinanceiro,
  montarLogDecisao,
  FINANCIAL_STATES,
  NO_RETRY_REASONS
} = require('../../backend/services/tef/tefFinancialSafetyPolicy');
const {
  classificarCodigoTransacao
} = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const {
  ESTADOS_TRANSACAO,
  TIPOS_ACAO,
  ERROS
} = require('../../backend/services/tef/destaxa/destaxaConstantes');

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

function orquestrador(passos) {
  const mock = new DestaxaTransacaoMockDriver(passos);
  return {
    mock,
    fluxo: new DestaxaTransacaoOrquestrador({ driver: mock })
  };
}

async function verificarErroSemRetry(code) {
  let chamadas = 0;
  const erro = new Error(`${code} durante autorização`);
  erro.code = code;

  await assert.rejects(
    () => tefRetryService.autorizarComRetry(async () => {
      chamadas += 1;
      throw erro;
    }, {
      provider: 'destaxa',
      operation: 'CRT'
    }),
    (recebido) => {
      assert.strictEqual(recebido.retryAllowed, false);
      return true;
    }
  );
  assert.strictEqual(chamadas, 1);
}

async function main() {
  console.log('\nTEF-DESTAXA-05 — segurança financeira / sem retry\n');

  await test('00 → CONFIRMED_SUCCESS / sem retry', () => {
    const r = classificarCodigoTransacao('00');
    assert.strictEqual(r.financialState, FINANCIAL_STATES.CONFIRMED_SUCCESS);
    assert.strictEqual(r.estadoTransacao, ESTADOS_TRANSACAO.SUCCESS);
    assert.strictEqual(r.retryAllowed, false);
  });

  await test('03 → CONFIRMED_DENIED / sem retry', () => {
    const r = classificarCodigoTransacao('03');
    assert.strictEqual(r.financialState, FINANCIAL_STATES.CONFIRMED_DENIED);
    assert.strictEqual(r.estadoTransacao, ESTADOS_TRANSACAO.DENIED);
    assert.strictEqual(r.retryAllowed, false);
  });

  await test('08 → TIMEOUT + UNKNOWN / sem retry', () => {
    const r = classificarCodigoTransacao('08');
    assert.strictEqual(r.estadoTransacao, ESTADOS_TRANSACAO.TIMEOUT);
    assert.strictEqual(r.financialState, FINANCIAL_STATES.UNKNOWN);
    assert.strictEqual(r.retryReason, NO_RETRY_REASONS.TIMEOUT);
  });

  await test('A0 → UNCONFIRMED / sem retry', () => {
    const r = classificarCodigoTransacao('A0');
    assert.strictEqual(r.estadoTransacao, ESTADOS_TRANSACAO.UNCONFIRMED);
    assert.strictEqual(r.financialState, FINANCIAL_STATES.UNCONFIRMED);
    assert.strictEqual(r.retryReason, NO_RETRY_REASONS.A0);
  });

  await test('A1 → BLOCKED / sem retry', () => {
    const r = classificarCodigoTransacao('A1');
    assert.strictEqual(r.estadoTransacao, ESTADOS_TRANSACAO.BLOCKED);
    assert.strictEqual(r.financialState, FINANCIAL_STATES.BLOCKED);
    assert.strictEqual(r.retryReason, NO_RETRY_REASONS.A1);
  });

  await test('ETIMEDOUT executa autorização uma única vez', () => verificarErroSemRetry('ETIMEDOUT'));
  await test('ECONNRESET executa autorização uma única vez', () => verificarErroSemRetry('ECONNRESET'));
  await test('ECONNREFUSED executa autorização uma única vez', () => verificarErroSemRetry('ECONNREFUSED'));

  await test('99 DISPLAY → DISPLAY/PENDING / sem retry financeiro', () => {
    const { fluxo } = orquestrador([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Aguarde' }
    ]);
    const r = fluxo.iniciarTransacaoCRT({});
    assert.strictEqual(r.estado, ESTADOS_TRANSACAO.DISPLAY);
    assert.strictEqual(r.acao.tipo, TIPOS_ACAO.DISPLAY);
    assert.strictEqual(r.financialState, FINANCIAL_STATES.PENDING);
    assert.strictEqual(r.retryAllowed, false);
  });

  await test('99 COLETA → COLLECT/PENDING / sem retry financeiro', () => {
    const { fluxo } = orquestrador([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Valor;tipo=N;mascara=.##' }
    ]);
    const r = fluxo.iniciarTransacaoCRT({});
    assert.strictEqual(r.estado, ESTADOS_TRANSACAO.COLLECT);
    assert.strictEqual(r.acao.tipo, TIPOS_ACAO.COLETA);
    assert.strictEqual(r.financialState, FINANCIAL_STATES.PENDING);
  });

  await test('99 OPÇÃO → OPTION/PENDING / sem retry financeiro', () => {
    const { fluxo } = orquestrador([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Tipo;opcao=Debito|Credito;tipo=X' }
    ]);
    const r = fluxo.iniciarTransacaoCRT({});
    assert.strictEqual(r.estado, ESTADOS_TRANSACAO.OPTION);
    assert.strictEqual(r.acao.tipo, TIPOS_ACAO.OPCAO);
    assert.strictEqual(r.financialState, FINANCIAL_STATES.PENDING);
  });

  await test('A1 bloqueia nova operação e preserva transactionId/código', () => {
    const { fluxo, mock } = orquestrador([
      { fn: 'inicia', codigo: 'A1', saida: '' }
    ]);
    const primeira = fluxo.iniciarTransacaoCRT({});
    const segunda = fluxo.iniciarTransacaoCRT({});

    assert.strictEqual(primeira.estado, ESTADOS_TRANSACAO.BLOCKED);
    assert.strictEqual(segunda.codigoDestaxa, ERROS.DESTAXA_TRANSACAO_EM_ANDAMENTO);
    assert.strictEqual(segunda.contexto.transactionId, primeira.contexto.transactionId);
    assert.strictEqual(segunda.contexto.codigoUltimo, 'A1');
    assert.strictEqual(mock.contadores.iniciaTransacaoDestaxa, 1);
  });

  await test('UNKNOWN de transporte não cria novo transactionId', () => {
    let chamadas = 0;
    const driver = {
      iniciaTransacaoDestaxa() {
        chamadas += 1;
        const error = new Error('connection lost');
        error.code = 'ECONNRESET';
        throw error;
      }
    };
    const fluxo = new DestaxaTransacaoOrquestrador({ driver });
    const primeira = fluxo.iniciarTransacaoCRT({});
    const segunda = fluxo.iniciarTransacaoCRT({});

    assert.strictEqual(primeira.estado, ESTADOS_TRANSACAO.UNKNOWN);
    assert.strictEqual(primeira.financialState, FINANCIAL_STATES.UNKNOWN);
    assert.strictEqual(segunda.contexto.transactionId, primeira.contexto.transactionId);
    assert.strictEqual(chamadas, 1);
  });

  await test('PENDING não gera nova cobrança', () => {
    const { fluxo, mock } = orquestrador([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Aguarde' }
    ]);
    const primeira = fluxo.iniciarTransacaoCRT({});
    const segunda = fluxo.iniciarTransacaoCRT({});

    assert.strictEqual(primeira.financialState, FINANCIAL_STATES.PENDING);
    assert.strictEqual(segunda.codigoDestaxa, ERROS.DESTAXA_TRANSACAO_EM_ANDAMENTO);
    assert.strictEqual(mock.contadores.iniciaTransacaoDestaxa, 1);
  });

  await test('log de decisão contém somente metadados financeiros seguros', () => {
    const log = montarLogDecisao({
      transactionId: 'tx-1',
      provider: 'destaxa',
      operation: 'CRT',
      decision: classificarCodigoFinanceiro('08', 'TIMEOUT')
    });
    assert.deepStrictEqual(Object.keys(log).sort(), [
      'financialState',
      'operation',
      'provider',
      'resultCode',
      'retryAllowed',
      'retryReason',
      'state',
      'timestamp',
      'transactionId'
    ].sort());
    assert.strictEqual(JSON.stringify(log).includes('PAN'), false);
    assert.strictEqual(log.retryAllowed, false);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
