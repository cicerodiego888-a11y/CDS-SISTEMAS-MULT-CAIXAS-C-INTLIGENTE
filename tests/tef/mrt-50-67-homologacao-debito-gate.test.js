/**
 * MRT-50.67 — Homologação débito exclusiva + gate + continuidade sem nativo/DLL.
 * Executar: node tests/tef/mrt-50-67-homologacao-debito-gate.test.js
 */
'use strict';

const assert = require('assert');
const {
  validarContextoHomologacaoDebito,
  modalidadeHomologacaoDebitoPermitida
} = require('../../backend/services/tef/destaxa/destaxaHomologacaoDebitoPolitica');
const {
  ERROS,
  VALOR_HOMOLOGACAO_CENTAVOS,
  AMBIENTE_TRANSACAO_REAL,
  REAL_TRANSACTION_ENV,
  transacaoRealHabilitada,
  inspecionarGateFinanceiro
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const {
  buildCrtInput
} = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const DestaxaNativeBridge = require('../../backend/services/tef/destaxa/DestaxaNativeBridge');
const DestaxaTransacaoOrquestrador = require('../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador');
const DestaxaTransacaoMockDriver = require('../../backend/services/tef/destaxa/destaxaTransacaoMockDriver');
const {
  classificarIdempotencia
} = require('../../backend/services/tef/tefPersistenciaObrigatoria');
const {
  FINANCIAL_STATES
} = require('../../backend/services/tef/tefFinancialSafetyPolicy');
const tefRetryService = require('../../backend/services/tef/tefRetryService');

let passou = 0;
let falhou = 0;
const chamadasFinanceiras = {
  inicia: 0,
  continua: 0,
  finaliza: 0
};

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

function comGate(valor, fn) {
  const anterior = process.env[REAL_TRANSACTION_ENV];
  if (valor === undefined) delete process.env[REAL_TRANSACTION_ENV];
  else process.env[REAL_TRANSACTION_ENV] = valor;
  try {
    return fn();
  } finally {
    if (anterior === undefined) delete process.env[REAL_TRANSACTION_ENV];
    else process.env[REAL_TRANSACTION_ENV] = anterior;
  }
}

async function main() {
  console.log('\nMRT-50.67 — homologação débito / gate / continuidade (sem nativo)\n');
  process.env[REAL_TRANSACTION_ENV] = '0';

  await test('débito R$1,00 homologação — validação preparatória OK', () => {
    const r = validarContextoHomologacaoDebito({
      ambiente: AMBIENTE_TRANSACAO_REAL,
      tipoPdv: 'cartao_debito',
      valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
      modoAdapter: 'real'
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.tipoNormalizado, 'cartao_debito');
    const crt = buildCrtInput({
      valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
      tipoPdv: 'cartao_debito',
      parcelas: 1
    });
    assert.strictEqual(
      crt.texto,
      'transacao_valor=1.00;transacao_tipo_cartao=Debito;transacao_pagamento=A vista'
    );
  });

  await test('crédito bloqueado no contexto de homologação débito', () => {
    const r = validarContextoHomologacaoDebito({
      ambiente: 'homologacao',
      tipoPdv: 'cartao_credito',
      valorCentavos: 100,
      modoAdapter: 'real'
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, ERROS.DESTAXA_MODALIDADE_NAO_PERMITIDA);
    assert.strictEqual(modalidadeHomologacaoDebitoPermitida('cartao_credito'), false);
  });

  await test('valor ≠ R$1,00 bloqueado', () => {
    const r = validarContextoHomologacaoDebito({
      ambiente: 'homologacao',
      tipoPdv: 'cartao_debito',
      valorCentavos: 200,
      modoAdapter: 'real'
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, ERROS.DESTAXA_VALOR_NAO_PERMITIDO);
  });

  await test('modalidade ausente bloqueada', () => {
    const r = validarContextoHomologacaoDebito({
      ambiente: 'homologacao',
      tipoPdv: null,
      valorCentavos: 100,
      modoAdapter: 'real'
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, ERROS.DESTAXA_MODALIDADE_NAO_PERMITIDA);
  });

  await test('modalidade inválida/ambígua (cartao genérico) bloqueada', () => {
    const r = validarContextoHomologacaoDebito({
      ambiente: 'homologacao',
      tipoPdv: 'cartao',
      valorCentavos: 100,
      modoAdapter: 'real'
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, ERROS.DESTAXA_MODALIDADE_NAO_PERMITIDA);
  });

  await test('ambiente ≠ homologacao bloqueado neste contexto', () => {
    const r = validarContextoHomologacaoDebito({
      ambiente: 'producao',
      tipoPdv: 'cartao_debito',
      valorCentavos: 100,
      modoAdapter: 'real'
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, ERROS.DESTAXA_AMBIENTE_NAO_PERMITIDO);
  });

  await test('gate: somente literal 1 habilita; ambíguo permanece OFF', () => {
    comGate('0', () => {
      assert.strictEqual(transacaoRealHabilitada(), false);
      assert.strictEqual(inspecionarGateFinanceiro().habilitado, false);
    });
    comGate(undefined, () => {
      assert.strictEqual(transacaoRealHabilitada(), false);
    });
    comGate('true', () => {
      const g = inspecionarGateFinanceiro();
      assert.strictEqual(g.habilitado, false);
      assert.strictEqual(g.ambiguo, true);
    });
    comGate('1', () => {
      assert.strictEqual(transacaoRealHabilitada(), true);
    });
    process.env[REAL_TRANSACTION_ENV] = '0';
  });

  await test('bridge habilitarTransacaoReal bloqueia com gate OFF', async () => {
    process.env[REAL_TRANSACTION_ENV] = '0';
    const bridge = new DestaxaNativeBridge({ config: {} });
    const r = bridge.habilitarTransacaoReal();
    assert.strictEqual(r.sucesso, false);
    assert.strictEqual(r.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
  });

  await test('orquestrador nativo: TX_START/CONTINUE/FINALIZE bloqueados com gate OFF', () => {
    process.env[REAL_TRANSACTION_ENV] = '0';
    const driver = {
      nome: 'native',
      iniciaTransacaoDestaxa() {
        chamadasFinanceiras.inicia += 1;
        return { codigo: '00', saida: '' };
      },
      continuaTransacaoDestaxa() {
        chamadasFinanceiras.continua += 1;
        return { codigo: '00', saida: '' };
      },
      finalizaTransacaoDestaxa() {
        chamadasFinanceiras.finaliza += 1;
        return { codigo: '00', saida: '' };
      }
    };
    const orq = new DestaxaTransacaoOrquestrador({ driver });
    orq.definirPermissaoTransacaoReal(true);
    const start = orq.iniciarTransacaoCRT({ transacao_valor: '1.00' });
    assert.strictEqual(start.codigoDestaxa || start.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    assert.strictEqual(chamadasFinanceiras.inicia, 0);

    // Forçar contexto mock-like sem chamar nativo: usa mock driver para criar contexto
    const mock = new DestaxaTransacaoMockDriver([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Espere' }
    ]);
    const orqMock = new DestaxaTransacaoOrquestrador({ driver: mock });
    orqMock.iniciarTransacaoCRT({});
    // Troca para nativo com contexto ativo
    orqMock.definirDriver(driver);
    orqMock.definirPermissaoTransacaoReal(true);
    const cont = orqMock.continuarTransacao({ displayAck: true });
    assert.strictEqual(cont.codigoDestaxa || cont.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    assert.strictEqual(chamadasFinanceiras.continua, 0);
    const fin = orqMock.finalizarTransacao(0);
    assert.strictEqual(fin.codigoDestaxa || fin.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    assert.strictEqual(chamadasFinanceiras.finaliza, 0);
  });

  await test('CONTINUE sem contexto → DESTAXA_TRANSACAO_NAO_ENCONTRADA', async () => {
    const bridge = new DestaxaNativeBridge({ config: {} });
    const adapter = new DestaxaRealAdapter({}, { bridge });
    const r = await adapter.continuarTransacao({});
    assert.strictEqual(r.codigoDestaxa, ERROS.DESTAXA_TRANSACAO_NAO_ENCONTRADA);
    assert.strictEqual(r.sucesso, false);
  });

  await test('CONTINUE preserva transactionId (DISPLAY→00 mock)', async () => {
    const bridge = new DestaxaNativeBridge({ config: {} });
    const mock = bridge.configurarDriverTransacaoMock([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Insira o cartão' },
      { fn: 'continua', codigo: '00', saida: 'transacao_nsu=67' }
    ]);
    const adapter = new DestaxaRealAdapter({}, { bridge });
    const r1 = await adapter.iniciarTransacao({ operacao: 'CRT' });
    const tid = r1.contexto.transactionId;
    const r2 = await adapter.continuarTransacao({ displayAck: true });
    assert.strictEqual(r2.sucesso, true);
    assert.strictEqual(r2.contexto.transactionId, tid);
    assert.strictEqual(mock.contadores.continuaTransacaoDestaxa, 1);
    assert.strictEqual(mock.contadores.iniciaTransacaoDestaxa, 1);
  });

  await test('UNKNOWN / idempotência: BLOQUEAR_REENVIAR sem retry', async () => {
    const decisao = classificarIdempotencia({
      id: 99,
      status: 'pendente',
      provedor: 'destaxa',
      idempotency_key: 'k-67',
      payload_retorno: { financialState: FINANCIAL_STATES.UNKNOWN, inconclusivo: true }
    }, 'fp');
    assert.strictEqual(decisao.acao, 'BLOQUEAR_REENVIAR');
    assert.strictEqual(decisao.preservarUnknown, true);
    assert.strictEqual(decisao.bloquearEnvio, true);

    let chamadas = 0;
    await assert.rejects(
      () => tefRetryService.autorizarComRetry(async () => {
        chamadas += 1;
        const err = new Error('timeout');
        err.code = 'ETIMEDOUT';
        throw err;
      }, { provider: 'destaxa', operation: 'CRT' }),
      (e) => e.retryAllowed === false
    );
    assert.strictEqual(chamadas, 1);
  });

  await test('nenhuma função financeira nativa nestes testes', () => {
    assert.strictEqual(chamadasFinanceiras.inicia, 0);
    assert.strictEqual(chamadasFinanceiras.continua, 0);
    assert.strictEqual(chamadasFinanceiras.finaliza, 0);
    assert.strictEqual(transacaoRealHabilitada(), false);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

main();
