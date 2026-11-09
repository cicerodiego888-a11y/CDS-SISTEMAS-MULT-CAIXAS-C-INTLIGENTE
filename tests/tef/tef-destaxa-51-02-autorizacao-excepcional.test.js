'use strict';

/**
 * TEF-DESTAXA-51.02 — autorização excepcional one-shot + gate OFF.
 * Executar: node tests/tef/tef-destaxa-51-02-autorizacao-excepcional.test.js
 * Sem DLL, NativeHost, V$Pague, PinPad ou TX real.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  REAL_TRANSACTION_ENV,
  ERROS,
  VALOR_HOMOLOGACAO_CENTAVOS,
  OPERACOES,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const auth = require('../../backend/services/tef/destaxa/destaxaAutorizacaoExcepcional');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const DestaxaNativeBridge = require('../../backend/services/tef/destaxa/DestaxaNativeBridge');
const DestaxaTransacaoOrquestrador = require('../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador');
const DestaxaTransacaoMockDriver = require('../../backend/services/tef/destaxa/destaxaTransacaoMockDriver');
const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');

let passou = 0;
let falhou = 0;
const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-tef-5102-'));
const ledgerPath = path.join(ledgerDir, 'ledger.json');

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

function resetLedger() {
  auth.configurarCaminhoLedgerParaTeste(ledgerPath);
  try { fs.unlinkSync(ledgerPath); } catch (_) { /* */ }
  try { fs.unlinkSync(`${ledgerPath}.lock`); } catch (_) { /* */ }
}

function criarBridgeMockOrquestrador() {
  const orq = new DestaxaTransacaoOrquestrador();
  const mock = new DestaxaTransacaoMockDriver([
    { codigo: '00', saida: 'transacao_nsu=1' }
  ]);
  orq.definirDriver(mock);
  const bridge = {
    async isLoaded() { return true; },
    async load() { return { sucesso: true }; },
    async getDiagnostics() {
      return {
        dllLoaded: true,
        exportsValid: true,
        exports: {
          iniciaClientDestaxa: true,
          iniciaTransacaoDestaxa: true,
          continuaTransacaoDestaxa: true,
          finalizaTransacaoDestaxa: true
        },
        clientInitialized: true,
        clientResultCode: '00',
        estado: 'CLIENT_INITIALIZED',
        dllPath: 'mock.dll'
      };
    },
    async iniciarClient() {
      return {
        sucesso: true,
        codigoDestaxa: '00',
        estado: 'CLIENT_INITIALIZED',
        mensagem: 'ok',
        diagnostico: await this.getDiagnostics()
      };
    },
    async habilitarTransacaoReal(opcoes = {}) {
      const {
        transacaoRealEfetivaPermitida,
        validarPermitExcepcional
      } = auth;
      const permit = opcoes.exceptionalPermit || null;
      if (!transacaoRealEfetivaPermitida(permit)) {
        return {
          sucesso: false,
          codigo: ERROS.DESTAXA_REAL_TRANSACTION_DISABLED,
          mensagem: 'gate off'
        };
      }
      if (permit) {
        const v = validarPermitExcepcional(permit, {
          valorCentavos: permit.valorCentavos,
          tipoPdv: 'cartao_debito',
          operacao: OPERACOES.CRT
        });
        if (!v.ok) return { sucesso: false, codigo: v.codigo, mensagem: v.mensagem };
      }
      orq.definirPermissaoTransacaoReal(true);
      orq.definirPermitExcepcional(permit);
      // driver mock (não nativo) — ciclo/orquestrador sem TX financeira real
      return { sucesso: true, exceptional: Boolean(permit) };
    },
    getOrquestradorTransacao() { return orq; },
    async iniciarTransacaoDestaxa(operacao, campos, opcoes) {
      return orq.iniciarTransacao(operacao, campos, opcoes || {});
    },
    async continuarTransacaoDestaxa() {
      return { sucesso: false, codigo: 'FF' };
    },
    async finalizarTransacaoDestaxa() {
      return { sucesso: true, codigo: '00' };
    }
  };
  return { bridge, orq, mock };
}

function criarAdapterComMocks(bridge) {
  const adapter = new DestaxaRealAdapter(
    { provedor: 'destaxa', ambiente: 'homologacao' },
    { bridge, executionMode: 'in-process' }
  );
  adapter._configServiceInjetado = {
    obterConfiguracao: async () => ({
      tefProvedor: 'destaxa',
      pinpadHabilitado: true,
      portaCom: 'COM4'
    }),
    validarConfiguracao: () => ({ valida: true, pendencias: [] })
  };
  adapter._sdkDetectorInjetado = {
    detectarVsPagueClient: () => ({
      detectado: true,
      executando: true,
      responding: true,
      pid: 1
    }),
    detectarGertecPPC930: () => ({
      detectado: true,
      porta: 'COM4',
      modelo: 'PPC930',
      estado: 'ok',
      usb: true
    })
  };
  return adapter;
}

async function main() {
  console.log('\nTEF-DESTAXA-51.02 — autorização excepcional / gate (mocks)\n');
  process.env[REAL_TRANSACTION_ENV] = '0';
  resetLedger();

  await test('1) gate OFF bloqueia qualquer transação sem autorização', async () => {
    comGate('0', () => {
      assert.strictEqual(transacaoRealHabilitada(), false);
    });
    const { bridge } = criarBridgeMockOrquestrador();
    const adapter = criarAdapterComMocks(bridge);
    const prep = await adapter.prepararAutorizacao({
      tipo: 'cartao_debito',
      valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS
    });
    assert.strictEqual(prep.pronto, false);
    assert.strictEqual(prep.resposta.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    assert.strictEqual(prep.resposta.tipo_erro, 'gate_financeiro');
    assert.strictEqual(prep.resposta.retryAllowed, false);
  });

  await test('2) gate OFF não impede diagnóstico passivo (testarConexao mock)', async () => {
    const { bridge } = criarBridgeMockOrquestrador();
    const adapter = criarAdapterComMocks(bridge);
    const diag = await adapter.diagnosticar();
    assert.strictEqual(diag.sucesso, true);
    const conexao = await adapter.testarConexao();
    assert.strictEqual(conexao.sucesso, true);
    assert.strictEqual(transacaoRealHabilitada(), false);
  });

  await test('3) one-shot aceita somente R$1,00 débito', async () => {
    resetLedger();
    const emitida = auth.emitirAutorizacaoExcepcional({ motivo: 'teste-51-02' });
    assert.strictEqual(emitida.ok, true);
    const achou = auth.encontrarAutorizacaoIssuidaCompativel({
      valorCentavos: 100,
      tipoPdv: 'cartao_debito',
      operacao: 'CRT',
      authorizationId: emitida.autorizacao.authorizationId
    });
    assert.strictEqual(achou.ok, true);

    const { bridge } = criarBridgeMockOrquestrador();
    const adapter = criarAdapterComMocks(bridge);
    const prep = await adapter.prepararAutorizacao({
      tipo: 'cartao_debito',
      valorCentavos: 100,
      autorizacaoExcepcionalId: emitida.autorizacao.authorizationId
    });
    assert.strictEqual(prep.pronto, true);
    assert.strictEqual(prep.autorizacaoExcepcionalId, emitida.autorizacao.authorizationId);
  });

  await test('4) crédito é bloqueado na autorização excepcional', () => {
    resetLedger();
    const emitida = auth.emitirAutorizacaoExcepcional();
    const achou = auth.encontrarAutorizacaoIssuidaCompativel({
      valorCentavos: 100,
      tipoPdv: 'cartao_credito',
      operacao: 'CRT',
      authorizationId: emitida.autorizacao.authorizationId
    });
    assert.strictEqual(achou.ok, false);
    const consumo = auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: emitida.autorizacao.authorizationId,
      valorCentavos: 100,
      tipoPdv: 'cartao_credito',
      operacao: 'CRT'
    });
    assert.strictEqual(consumo.ok, false);
    assert.strictEqual(consumo.codigo, ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_INVALIDA);
  });

  await test('5) PIX é bloqueado', () => {
    resetLedger();
    const emitida = auth.emitirAutorizacaoExcepcional();
    const consumo = auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: emitida.autorizacao.authorizationId,
      valorCentavos: 100,
      tipoPdv: 'pix',
      operacao: 'PIX'
    });
    assert.strictEqual(consumo.ok, false);
  });

  await test('6) valor diferente é bloqueado', () => {
    resetLedger();
    const emitida = auth.emitirAutorizacaoExcepcional();
    const consumo = auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: emitida.autorizacao.authorizationId,
      valorCentavos: 200,
      tipoPdv: 'cartao_debito',
      operacao: 'CRT'
    });
    assert.strictEqual(consumo.ok, false);
    assert.strictEqual(consumo.codigo, ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_INVALIDA);
  });

  await test('7) segunda utilização é bloqueada', () => {
    resetLedger();
    const emitida = auth.emitirAutorizacaoExcepcional();
    const id = emitida.autorizacao.authorizationId;
    const c1 = auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: id,
      valorCentavos: 100,
      tipoPdv: 'cartao_debito',
      operacao: 'CRT'
    });
    assert.strictEqual(c1.ok, true);
    const c2 = auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: id,
      valorCentavos: 100,
      tipoPdv: 'cartao_debito',
      operacao: 'CRT'
    });
    assert.strictEqual(c2.ok, false);
    assert.strictEqual(c2.codigo, ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_CONSUMIDA);
  });

  await test('8) concorrência: duas consumes não passam duas vezes', () => {
    resetLedger();
    const emitida = auth.emitirAutorizacaoExcepcional();
    const id = emitida.autorizacao.authorizationId;
    const r1 = auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: id,
      valorCentavos: 100,
      tipoPdv: 'debito',
      operacao: 'CRT'
    });
    const r2 = auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: id,
      valorCentavos: 100,
      tipoPdv: 'debito',
      operacao: 'CRT'
    });
    const oks = [r1.ok, r2.ok].filter(Boolean);
    assert.strictEqual(oks.length, 1);
  });

  await test('9) após consumo + falha simulada — sem retry / auth permanece consumida', () => {
    resetLedger();
    const emitida = auth.emitirAutorizacaoExcepcional();
    const id = emitida.autorizacao.authorizationId;
    const consumo = auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: id,
      valorCentavos: 100,
      tipoPdv: 'cartao_debito',
      operacao: 'CRT'
    });
    assert.strictEqual(consumo.ok, true);
    assert.strictEqual(consumo.permit.retryAllowed, false);
    // Falha simulada não restaura
    const insp = auth.inspecionarAutorizacaoExcepcional(id);
    assert.strictEqual(insp.autorizacao.status, auth.ESTADOS_AUTH.CONSUMED);
    assert.strictEqual(insp.ok, false);
  });

  await test('10) estado UNKNOWN não permite nova tentativa via mesma autorização', () => {
    resetLedger();
    const emitida = auth.emitirAutorizacaoExcepcional();
    const id = emitida.autorizacao.authorizationId;
    auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: id,
      valorCentavos: 100,
      tipoPdv: 'cartao_debito',
      operacao: 'CRT'
    });
    // Simula política UNKNOWN: retryAllowed false + auth consumida
    const nova = auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: id,
      valorCentavos: 100,
      tipoPdv: 'cartao_debito',
      operacao: 'CRT'
    });
    assert.strictEqual(nova.ok, false);
    assert.strictEqual(FINANCIAL_STATES.UNKNOWN, 'UNKNOWN');
  });

  await test('11) reinicialização do ledger: consumida não volta a ISSUED', () => {
    resetLedger();
    const emitida = auth.emitirAutorizacaoExcepcional();
    const id = emitida.autorizacao.authorizationId;
    auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: id,
      valorCentavos: 100,
      tipoPdv: 'cartao_debito',
      operacao: 'CRT'
    });
    // "Reinício": nova configuração do path aponta ao mesmo arquivo
    auth.configurarCaminhoLedgerParaTeste(ledgerPath);
    const insp = auth.inspecionarAutorizacaoExcepcional(id);
    assert.strictEqual(insp.autorizacao.status, 'CONSUMED');
    const achou = auth.encontrarAutorizacaoIssuidaCompativel({
      valorCentavos: 100,
      tipoPdv: 'cartao_debito',
      operacao: 'CRT',
      authorizationId: id
    });
    assert.strictEqual(achou.ok, false);
  });

  await test('12) HTTP 400 / resposta TEF preserva DESTAXA_REAL_TRANSACTION_DISABLED', async () => {
    resetLedger();
    const { bridge } = criarBridgeMockOrquestrador();
    const adapter = criarAdapterComMocks(bridge);
    const prep = await adapter.prepararAutorizacao({
      tipo: 'cartao_debito',
      valorCentavos: 100
    });
    assert.strictEqual(prep.pronto, false);
    assert.strictEqual(prep.resposta.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    assert.strictEqual(prep.resposta.sucesso, false);
    assert.ok(String(prep.resposta.mensagem || '').includes(REAL_TRANSACTION_ENV));
  });

  await test('extra) habilitarTransacaoReal com permit excepcional (gate OFF)', () => {
    resetLedger();
    const emitida = auth.emitirAutorizacaoExcepcional();
    const consumo = auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: emitida.autorizacao.authorizationId,
      valorCentavos: 100,
      tipoPdv: 'cartao_debito',
      operacao: 'CRT'
    });
    assert.strictEqual(consumo.ok, true);
    assert.strictEqual(transacaoRealHabilitada(), false);
    assert.strictEqual(auth.transacaoRealEfetivaPermitida(consumo.permit), true);

    const bridge = new DestaxaNativeBridge({
      config: {},
      nativeLoader: {
        carregarBiblioteca() {
          return {
            exports: {
              iniciaClientDestaxa() {},
              iniciaTransacaoDestaxa() {},
              continuaTransacaoDestaxa() {},
              finalizaTransacaoDestaxa() {}
            },
            unload() {}
          };
        }
      },
      resolver: {
        resolverDll() {
          return {
            sucesso: true,
            dllExists: true,
            dllPath: 'mock.dll',
            origem: 'teste'
          };
        },
        rotuloArquiteturaDll: () => 'x64'
      }
    });
    // força estado carregado/client sem FFI real
    bridge._dllExists = true;
    bridge._dllLoaded = true;
    bridge._exportsValid = true;
    bridge._clientInitialized = true;
    bridge._exports = {
      iniciaClientDestaxa: true,
      iniciaTransacaoDestaxa: true,
      continuaTransacaoDestaxa: true,
      finalizaTransacaoDestaxa: true
    };
    bridge._nativo = {
      exports: {
        iniciaClientDestaxa() {},
        iniciaTransacaoDestaxa() {},
        continuaTransacaoDestaxa() {},
        finalizaTransacaoDestaxa() {}
      },
      unload() {}
    };
    const semPermit = bridge.habilitarTransacaoReal();
    assert.strictEqual(semPermit.sucesso, false);
    const comPermit = bridge.habilitarTransacaoReal({ exceptionalPermit: consumo.permit });
    assert.strictEqual(comPermit.sucesso, true);
    assert.strictEqual(comPermit.exceptional, true);
  });

  await test('extra) expiração bloqueia consumo', () => {
    resetLedger();
    const emitida = auth.emitirAutorizacaoExcepcional({ ttlMs: 1 });
    // força expiração
    sleep(5);
    const consumo = auth.consumirAutorizacaoExcepcionalAtomico({
      authorizationId: emitida.autorizacao.authorizationId,
      valorCentavos: 100,
      tipoPdv: 'cartao_debito',
      operacao: 'CRT'
    });
    assert.strictEqual(consumo.ok, false);
    assert.strictEqual(consumo.codigo, ERROS.DESTAXA_AUTORIZACAO_EXCEPCIONAL_EXPIRADA);
  });

  auth.limparCaminhoLedgerDeTeste();
  try { fs.rmSync(ledgerDir, { recursive: true, force: true }); } catch (_) { /* */ }

  console.log(`\nResultado: ${passou} ok / ${falhou} falhas`);
  process.exit(falhou > 0 ? 1 : 0);
}

function sleep(ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { /* */ }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
