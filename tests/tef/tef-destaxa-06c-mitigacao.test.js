/**
 * TEF-DESTAXA-06C-MITIGACAO — isolamento do host nativo TEF.
 *
 * Chamadas bloqueantes, 99/00/03/08/A0/A1, timeout e queda usam o host em modo
 * de teste (driver mock no orquestrador real, dentro do processo isolado).
 * Validação nativa real: somente LOAD/INIT_CLIENT, com tripwire no host.
 * Proibido: iniciaTransacaoDestaxa / continuaTransacaoDestaxa / finalizaTransacaoDestaxa reais.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REAL_TRANSACTION_ENV = 'DESTAXA_REAL_TRANSACTION_ENABLED';
if (String(process.env[REAL_TRANSACTION_ENV] || '').trim() === '1') {
  console.error(`BLOQUEADO: ${REAL_TRANSACTION_ENV} deve permanecer desabilitada na 06C-MITIGACAO`);
  process.exit(2);
}

const RAIZ = path.resolve(__dirname, '../..');
const RELATORIO = path.join(RAIZ, 'docs', 'build', 'tef-destaxa-06c-mitigacao-report.json');

const destaxaKoffiLoader = require('../../backend/services/tef/destaxa/destaxaKoffiLoader');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const DestaxaHostBridge = require('../../backend/services/tef/destaxa/DestaxaHostBridge');
const { DestaxaNativeHostClient, ESTADOS_CLIENTE } = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
const { DestaxaNativeHostRuntime, TEST_MODE_ENV } = require('../../backend/services/tef/destaxa/DestaxaNativeHost');
const {
  OPERACOES_HOST,
  ERROS_HOST,
  PROTOCOLO,
  criarRequest,
  validarRequest
} = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const verificador = require('../../backend/services/tef/destaxa/destaxaNativeHostVerifier');
const tefRetryService = require('../../backend/services/tef/tefRetryService');
const { FINANCIAL_STATES, classificarResultadoFinanceiro } = require('../../backend/services/tef/tefFinancialSafetyPolicy');
const { ERROS, OPERACOES, TIPOS_ACAO, FINALIZACAO_CONFIRMAR, transacaoRealHabilitada } = require('../../backend/services/tef/destaxa/destaxaConstantes');
const tefContrato = require('../../backend/services/tef/tefContrato');

let passou = 0;
let falhou = 0;
const falhas = [];
const executados = [];

async function test(nome, fn) {
  executados.push(nome);
  try {
    await fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    falhas.push(nome);
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.stack || error.message}`);
  }
}

function aguardar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function esperarEvento(emissor, evento, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    emissor.once(evento, (dados) => { clearTimeout(timer); resolve(dados || {}); });
  });
}

function consultarDb(sql) {
  const db = require('../../backend/database');
  return new Promise((resolve, reject) => {
    db.whenReady((erro) => {
      if (erro) return reject(erro);
      db.get(sql, [], (e, row) => (e ? reject(e) : resolve(row)));
    });
  });
}

async function contarTransacoes24h() {
  const row = await consultarDb("SELECT COUNT(*) AS n FROM tef_transacoes WHERE criado_em >= datetime('now','-1 day')");
  return row.n;
}

function novoClienteTeste(opcoes = {}) {
  return new DestaxaNativeHostClient({ env: { [TEST_MODE_ENV]: '1' }, timeoutMs: 15000, ...opcoes });
}

function adapterParaMapeamento() {
  return new DestaxaRealAdapter({ provedor: 'destaxa', ambiente: 'homologacao' }, { bridge: {} });
}

/** Stub síncrono no próprio processo — controle da medição. */
function bloquearNoMain(ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { /* thread ocupada */ }
}

async function medirIntervaloMaximo(executar) {
  let ultimo = Date.now();
  let maior = 0;
  const hb = setInterval(() => {
    const agora = Date.now();
    maior = Math.max(maior, agora - ultimo);
    ultimo = agora;
  }, 10);
  await aguardar(30);
  await executar();
  await aguardar(30);
  clearInterval(hb);
  return maior;
}

async function main() {
  console.log('\nTEF-DESTAXA-06C-MITIGACAO — ISOLAMENTO DO HOST NATIVO TEF (sem transação)\n');

  let cargasDllMain = 0;
  const carregarOriginal = destaxaKoffiLoader.carregarBiblioteca;
  destaxaKoffiLoader.carregarBiblioteca = function contar(...args) {
    cargasDllMain += 1;
    return carregarOriginal.apply(this, args);
  };

  const coleta = { node: {}, electron: null, regressoes: [] };
  const transacoesAntes = await contarTransacoes24h();

  await test('segurança: gate financeiro desabilitado', () => {
    assert.strictEqual(transacaoRealHabilitada(), false);
  });

  // ------------------------------------------------------------ protocolo
  await test('protocolo: request tipado/validado', () => {
    const req = criarRequest(OPERACOES_HOST.TX_START, { operacao: 'CRT' }, 77);
    assert.strictEqual(req.protocol, PROTOCOLO);
    assert.strictEqual(req.transactionId, '77');
    assert.strictEqual(validarRequest(req), null);
    assert.match(validarRequest({ ...req, operation: 'RODAR_QUALQUER_COISA' }), /operação desconhecida/);
    assert.match(validarRequest({ ...req, payload: [] }), /payload/);
    assert.match(validarRequest({ ...req, protocol: 'x' }), /protocolo/);
    assert.match(validarRequest({ ...req, nativeSeq: undefined }), /nativeSeq/);
  });

  await test('protocolo: HOST_BUSY causal por nativeSeq (independente de relógio entre processos)', () => {
    const runtime = new DestaxaNativeHostRuntime({ enviar: () => {}, modoTeste: true });
    const r1 = runtime.processar(criarRequest(OPERACOES_HOST.SIMULATE_BLOCKING, { ms: 1 }, null, 0));
    assert.strictEqual(r1.error, null);
    assert.strictEqual(r1.nativeSeq, 1);
    const atrasada = runtime.processar(criarRequest(OPERACOES_HOST.SIMULATE_BLOCKING, { ms: 1 }, null, 0));
    assert.strictEqual(atrasada.error.code, ERROS_HOST.HOST_BUSY);
    assert.strictEqual(atrasada.nativeSeq, 1);
    const seguinte = criarRequest(OPERACOES_HOST.SIMULATE_BLOCKING, { ms: 1 }, null, r1.nativeSeq);
    seguinte.sentAt = 0;
    assert.strictEqual(runtime.processar(seguinte).error, null);
  });

  await test('protocolo: host recusa request inválido e operação de teste fora do modo teste', () => {
    const runtime = new DestaxaNativeHostRuntime({ enviar: () => {}, modoTeste: false });
    const invalido = runtime.processar({ protocol: PROTOCOLO, requestId: 'r1', operation: 'X', payload: {}, sentAt: Date.now() });
    assert.strictEqual(invalido.error.code, ERROS_HOST.HOST_INVALID_REQUEST);
    const teste = runtime.processar(criarRequest(OPERACOES_HOST.SIMULATE_BLOCKING, { ms: 1 }));
    assert.strictEqual(teste.error.code, ERROS_HOST.HOST_OPERATION_NOT_ALLOWED);
    assert.strictEqual(cargasDllMain, 0);
  });

  // ---------------------------------------------------- 1–5 responsividade
  let resp = null;
  await test('controle: chamada bloqueante no próprio Main congela o event loop', async () => {
    const gap = await medirIntervaloMaximo(() => bloquearNoMain(600));
    assert.ok(gap >= 550, `gap=${gap}`);
  });

  await test('4: host executa chamada bloqueante simulada (1500ms) em processo separado', async () => {
    resp = await verificador.verificarResponsividade({ blockMs: 1500 });
    coleta.node.responsividade = resp;
    assert.strictEqual(resp.ok, true);
    assert.notStrictEqual(resp.hostPid, resp.mainPid);
    assert.strictEqual(resp.processType, 'child_process');
    assert.ok(resp.hostDurationMs >= 1500);
    assert.strictEqual(resp.hostResultCode, '99');
  });

  await test('1/5: Main continua responsivo e não congela durante a chamada nativa', () => {
    assert.ok(resp.maxLoopGapMs < 250, `maior intervalo do event loop=${resp.maxLoopGapMs}ms`);
  });

  await test('2: timer do Main continua executando', () => {
    assert.ok(resp.ticks >= 30, `ticks=${resp.ticks}`);
  });

  await test('3: IPC continua funcionando durante a chamada nativa', () => {
    assert.ok(resp.ipcRoundTrips >= 30, `ida/volta IPC=${resp.ipcRoundTrips}`);
    assert.strictEqual(resp.stateDuringCall, ESTADOS_CLIENTE.BUSY);
  });

  // --------------------------------------------------- 6–7 serialização
  await test('6: apenas uma operação nativa simultânea (cliente)', () => {
    assert.strictEqual(resp.inFlightDuringCall, 'SIMULATE_BLOCKING');
    assert.strictEqual(resp.secondOperation, ERROS_HOST.HOST_BUSY);
    assert.strictEqual(resp.secondOperationSentToHost, false);
  });

  await test('7: segunda operação enviada direto ao host durante a chamada é recusada (HOST_BUSY)', () => {
    assert.strictEqual(resp.hostSideBusy, true);
  });

  // ------------------------------------------- 8–11 transactionId e ações 99
  await test('8–11: DISPLAY → COLETA → OPÇÃO → 00 → finaliza no host com o mesmo transactionId', async () => {
    const cliente = novoClienteTeste();
    const bridge = new DestaxaHostBridge({ client: cliente });
    try {
      await bridge.configurarDriverTransacaoMock([
        { fn: 'inicia', codigo: '99', saida: 'mensagem=Insira o cartão' },
        { fn: 'continua', codigo: '99', saida: 'mensagem=Digite;tipo=N;mascara=.##' },
        { fn: 'continua', codigo: '99', saida: 'mensagem=Forma;opcao=Debito|Credito;tipo=X' },
        { fn: 'continua', codigo: '00', saida: 'transacao_nsu=10' },
        { fn: 'finaliza', codigo: '00', saida: '' }
      ]);
      const r1 = await bridge.iniciarTransacaoDestaxa(OPERACOES.CRT, { transacao_valor: '1.00' }, { transactionId: '42' });
      assert.strictEqual(r1.acao.tipo, TIPOS_ACAO.DISPLAY);
      const r2 = await bridge.continuarTransacaoDestaxa({ displayAck: true });
      assert.strictEqual(r2.acao.tipo, TIPOS_ACAO.COLETA);
      const r3 = await bridge.continuarTransacaoDestaxa({ informacao: '1.00' });
      assert.ok(r3.acao, JSON.stringify(r3));
      assert.strictEqual(r3.acao.tipo, TIPOS_ACAO.OPCAO);
      assert.deepStrictEqual(r3.acao.opcoes, ['Debito', 'Credito']);

      const divergente = await cliente.enviar(OPERACOES_HOST.TX_CONTINUE, { resposta: { informacao: 'Credito' } }, { transactionId: 'outro' });
      assert.strictEqual(divergente.error.code, ERROS_HOST.HOST_TRANSACTION_MISMATCH);

      const r4 = await bridge.continuarTransacaoDestaxa({ informacao: 'Credito' });
      assert.strictEqual(r4.sucesso, true);
      const f = await bridge.finalizarTransacaoDestaxa(FINALIZACAO_CONFIRMAR);
      assert.strictEqual(f.confirmacaoDescricao, 'confirma');
      for (const r of [r1, r2, r3, r4, f]) assert.strictEqual(r.contexto.transactionId, '42');
      const status = await cliente.enviar(OPERACOES_HOST.STATUS);
      assert.strictEqual(status.output.mockContadores.iniciaTransacaoDestaxa, 1);
      assert.strictEqual(status.output.contexto.entradaInicial, 'transacao_valor=1.00');
    } finally {
      await cliente.encerrar();
    }
  });

  // ------------------------------------------------ 12–16 códigos Destaxa
  const mapeamentos = [
    ['00', tefContrato.STATUS.APROVADO, FINANCIAL_STATES.CONFIRMED_SUCCESS, '12: 00 = SUCCESS'],
    ['03', tefContrato.STATUS.NEGADO, FINANCIAL_STATES.CONFIRMED_DENIED, '13: 03 = CONFIRMED_DENIED'],
    ['08', tefContrato.STATUS.PENDENTE, FINANCIAL_STATES.UNKNOWN, '14: 08 = UNKNOWN/TIMEOUT'],
    ['A0', tefContrato.STATUS.PENDENTE, FINANCIAL_STATES.UNCONFIRMED, '15: A0 = UNCONFIRMED'],
    ['A1', tefContrato.STATUS.PENDENTE, FINANCIAL_STATES.BLOCKED, '16: A1 = BLOCKED']
  ];
  {
    const cliente = novoClienteTeste();
    const bridge = new DestaxaHostBridge({ client: cliente });
    const adapter = adapterParaMapeamento();
    for (const [codigo, status, financialState, nome] of mapeamentos) {
      await test(`${nome} (via host), retryAllowed=false`, async () => {
        await bridge.configurarDriverTransacaoMock([{ fn: 'inicia', codigo, saida: '' }]);
        const out = await bridge.iniciarTransacaoDestaxa(OPERACOES.CRT, { transacao_valor: '1.00' }, { transactionId: `tx-${codigo}` });
        assert.strictEqual(out.codigoDestaxa, codigo);
        assert.strictEqual(out.financialState, financialState);
        assert.strictEqual(out.retryAllowed, false);
        const r = adapter._mapearResultadoCrt(out, { clientInitializationCode: '00' });
        assert.strictEqual(r.status, status);
        assert.strictEqual(r.transacaoId, `tx-${codigo}`);
        assert.strictEqual(r.retryAllowed, false);
      });
    }
    await cliente.encerrar();
  }

  // --------------------------------------------- 17–19 timeout sem retry
  await test('17–19: timeout de IPC → UNKNOWN, 1 tentativa, mesmo transactionId, nenhuma nova cobrança', async () => {
    const cliente = novoClienteTeste();
    const bridge = new DestaxaHostBridge({ client: cliente });
    try {
      await bridge.configurarDriverTransacaoMock([
        { fn: 'inicia', codigo: '99', saida: 'mensagem=Aguarde', bloqueioMs: 1200 }
      ]);
      let tentativas = 0;
      const r = await tefRetryService.autorizarComRetry(async () => {
        tentativas += 1;
        return bridge.iniciarTransacaoDestaxa(OPERACOES.CRT, { transacao_valor: '1.00' }, { transactionId: 'tx-timeout', timeoutMs: 200 });
      }, { transactionId: 'tx-timeout', provider: 'destaxa' });
      assert.strictEqual(tentativas, 1);
      assert.strictEqual(r.codigo, ERROS_HOST.HOST_TIMEOUT);
      assert.strictEqual(r.financialState, FINANCIAL_STATES.UNKNOWN);
      assert.strictEqual(r.retryAllowed, false);
      assert.strictEqual(r.contexto.transactionId, 'tx-timeout');
      assert.strictEqual(classificarResultadoFinanceiro(r).financialState, FINANCIAL_STATES.UNKNOWN);

      const emVoo = cliente.getEstado().emVoo;
      assert.strictEqual(emVoo.expirado, true);
      assert.strictEqual(emVoo.transactionId, 'tx-timeout');

      const nova = await bridge.iniciarTransacaoDestaxa(OPERACOES.CRT, { transacao_valor: '1.00' }, { transactionId: 'tx-nova' });
      assert.strictEqual(nova.codigo, ERROS_HOST.HOST_BUSY);
      assert.strictEqual(nova.naoExecutada, true);

      const tardia = await esperarEvento(cliente, 'resposta-tardia', 5000);
      assert.ok(tardia, 'resposta tardia do host esperada');
      assert.strictEqual(tardia.transactionId, 'tx-timeout');
      assert.strictEqual(tardia.resultCode, '99');

      const depois = await bridge.iniciarTransacaoDestaxa(OPERACOES.CRT, { transacao_valor: '1.00' }, { transactionId: 'tx-nova-2' });
      assert.strictEqual(depois.codigoDestaxa, ERROS.DESTAXA_TRANSACAO_EM_ANDAMENTO);
      assert.strictEqual(depois.contexto.transactionId, 'tx-timeout');

      const status = await cliente.enviar(OPERACOES_HOST.STATUS);
      assert.strictEqual(status.output.mockContadores.iniciaTransacaoDestaxa, 1);
    } finally {
      await cliente.encerrar();
    }
  });

  await test('17–19: adapter com host ocupado bloqueia antes da DLL, sem transactionId', async () => {
    const cliente = novoClienteTeste();
    try {
      await cliente.iniciar();
      const adapter = new DestaxaRealAdapter({ provedor: 'destaxa', ambiente: 'homologacao' }, {
        hostClient: cliente,
        configService: {
          async obterConfiguracao() { return { tefProvedor: 'destaxa', pinpadHabilitado: 'true', portaCom: 'COM3' }; },
          validarConfiguracao() { return { valida: true, pendencias: [] }; }
        },
        sdkDetector: {
          detectarVsPagueClient: () => ({ detectado: true, executando: true, responding: true, pid: 1 }),
          detectarGertecPPC930: () => ({ detectado: true, porta: 'COM3', modelo: 'Gertec PPC930' })
        }
      });
      assert.strictEqual(adapter.execucaoNativa, 'native-host');
      const bloqueio = cliente.enviar(OPERACOES_HOST.SIMULATE_BLOCKING, { ms: 800 });
      await aguardar(50);
      const prep = await adapter.prepararAutorizacao({ tipo: 'credito', valor: 1 });
      assert.strictEqual(prep.pronto, false);
      assert.strictEqual(prep.resposta.codigo, ERROS_HOST.HOST_BUSY);
      assert.strictEqual(prep.resposta.transacaoId, null);
      assert.strictEqual(prep.resposta.transactionAttempted, false);
      await bloqueio;
    } finally {
      await cliente.encerrar();
    }
  });

  // ------------------------------------------------ shutdown seguro
  await test('shutdown com chamada em voo é adiado; operação não é cancelada; nenhuma nova operação', async () => {
    const cliente = novoClienteTeste();
    await cliente.iniciar();
    const chamada = cliente.enviar(OPERACOES_HOST.SIMULATE_BLOCKING, { ms: 700, codigo: '00' });
    await aguardar(50);
    const enc = await cliente.encerrar();
    assert.strictEqual(enc.encerrado, false);
    assert.strictEqual(enc.adiado, true);
    assert.strictEqual(enc.motivo, ERROS_HOST.HOST_BUSY);
    assert.strictEqual(enc.operacaoEmVoo.operation, 'SIMULATE_BLOCKING');
    const nova = await cliente.enviar(OPERACOES_HOST.PING);
    assert.strictEqual(nova.error.code, ERROS_HOST.HOST_SHUTTING_DOWN);
    const r = await chamada;
    assert.strictEqual(r.error, null);
    assert.strictEqual(r.resultCode, '00');
    const inicio = Date.now();
    while (cliente.estado !== ESTADOS_CLIENTE.STOPPED && Date.now() - inicio < 5000) await aguardar(20);
    assert.strictEqual(cliente.estado, ESTADOS_CLIENTE.STOPPED);
  });

  // ------------------------------------------- 20–22 erro / queda do host
  let crash = null;
  await test('21: queda do host não derruba o Main', async () => {
    crash = await verificador.verificarCrash();
    coleta.node.crash = crash;
    assert.strictEqual(crash.mainPid, process.pid);
    assert.strictEqual(crash.mainAlive, true);
  });

  await test('22: Main detecta HOST_CRASHED (ocioso e durante TX_START)', () => {
    assert.strictEqual(crash.idle.crashDetected, true);
    assert.strictEqual(crash.idle.state, ESTADOS_CLIENTE.CRASHED);
    assert.strictEqual(crash.idle.nextRequest, ERROS_HOST.HOST_CRASHED);
    assert.strictEqual(crash.duringTransaction.errorCode, ERROS_HOST.HOST_CRASHED);
    assert.strictEqual(crash.duringTransaction.state, ESTADOS_CLIENTE.CRASHED);
  });

  await test('20: erro/queda do host nunca vira aprovação nem negação; UNKNOWN/PENDING, sem retry', () => {
    const out = crash.duringTransaction.output;
    assert.strictEqual(out.sucesso, false);
    assert.strictEqual(out.financialState, FINANCIAL_STATES.UNKNOWN);
    assert.strictEqual(out.retryAllowed, false);
    assert.strictEqual(out.contexto.transactionId, 'tx-crash');
    const r = adapterParaMapeamento()._mapearResultadoCrt(out, { clientInitializationCode: '00' });
    assert.strictEqual(r.status, tefContrato.STATUS.PENDENTE);
    assert.notStrictEqual(r.status, tefContrato.STATUS.APROVADO);
    assert.notStrictEqual(r.status, tefContrato.STATUS.NEGADO);
    assert.strictEqual(classificarResultadoFinanceiro(out).financialState, FINANCIAL_STATES.UNKNOWN);

    const naoExecutada = adapterParaMapeamento()._mapearResultadoCrt(
      { sucesso: false, codigo: ERROS_HOST.HOST_BUSY, codigoDestaxa: ERROS_HOST.HOST_BUSY, naoExecutada: true, contexto: null },
      { clientInitializationCode: '00' }
    );
    assert.notStrictEqual(naoExecutada.status, tefContrato.STATUS.APROVADO);
    assert.notStrictEqual(naoExecutada.status, tefContrato.STATUS.NEGADO);
  });

  await test('queda durante TX: reconciliação pendente bloqueia nova transação e reinício implícito', () => {
    const d = crash.duringTransaction;
    assert.strictEqual(d.reconciliation.transactionId, 'tx-crash');
    assert.strictEqual(d.newTransaction, ERROS_HOST.HOST_CRASHED);
    assert.strictEqual(d.restartWithoutReconciliation.sucesso, false);
    assert.strictEqual(d.restartWithoutReconciliation.codigo, ERROS_HOST.HOST_RECONCILIATION_PENDING);
    assert.strictEqual(d.restartReconciled, true);
    assert.strictEqual(d.pingAfterRestart, true);
  });

  // ---------------------------------------- validação nativa real (tripwire)
  let nativo = null;
  await test('nativo real: host carrega DLL x64, 4 exports, iniciaClientDestaxa=00; Main não carrega DLL', async () => {
    nativo = await verificador.verificarNativoReal();
    coleta.node.nativo = nativo;
    assert.strictEqual(nativo.hostStarted, true);
    assert.notStrictEqual(nativo.hostPid, nativo.mainPid);
    assert.strictEqual(nativo.tripwire, true);
    assert.strictEqual(nativo.testModeInHost, false);
    assert.strictEqual(nativo.dll.loaded, true);
    assert.strictEqual(nativo.dll.exports, 4);
    assert.match(String(nativo.dll.path).replace(/\\/g, '/'), /win-x64\/libdll-integracao-tef\.dll$/);
    assert.strictEqual(nativo.client.initialized, true);
    assert.strictEqual(nativo.client.code, '00');
    assert.strictEqual(nativo.mainProcessDllLoads, 0);
    assert.strictEqual(nativo.enableReal, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    assert.strictEqual(nativo.testOperationInProduction, ERROS_HOST.HOST_OPERATION_NOT_ALLOWED);
  });

  // ----------------------------------------------------- Electron 22.3.27
  await test('Electron 22.3.27: utilityProcess — Main responsivo, crash isolado, DLL/Client 00 no host', () => {
    const r = spawnSync(require('electron'), ['.'], {
      cwd: RAIZ,
      env: { ...process.env, DESTAXA_NATIVE_HOST_CHECK: '1', DESTAXA_NATIVE_HOST_CHECK_ELECTRON: '1', [REAL_TRANSACTION_ENV]: '0' },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 20 * 1024 * 1024
    });
    const linha = String(r.stdout || '').split(/\r?\n/).find((l) => l.includes('[TEF-DESTAXA-06C-MITIGACAO-ELECTRON] {'));
    if (r.status !== 0 || !linha) {
      process.stdout.write(r.stdout || '');
      process.stderr.write(r.stderr || '');
    }
    assert.strictEqual(r.status, 0);
    assert.ok(linha, 'marcador Electron ausente');
    const e = JSON.parse(linha.slice(linha.indexOf('{')));
    coleta.electron = e;
    assert.strictEqual(e.runtime.electron, '22.3.27');
    assert.strictEqual(e.runtime.node, '16.17.1');
    assert.strictEqual(e.runtime.abi, '110');
    assert.strictEqual(e.runtime.processType, 'browser');
    assert.strictEqual(e.responsividade.processType, 'utilityProcess');
    assert.ok(e.responsividade.maxLoopGapMs < 250, `gap Electron=${e.responsividade.maxLoopGapMs}`);
    assert.ok(e.responsividade.ticks >= 30);
    assert.ok(e.responsividade.ipcRoundTrips >= 30);
    assert.strictEqual(e.responsividade.secondOperation, ERROS_HOST.HOST_BUSY);
    assert.strictEqual(e.responsividade.hostSideBusy, true);
    assert.strictEqual(e.crash.idle.crashDetected, true);
    assert.strictEqual(e.crash.duringTransaction.errorCode, ERROS_HOST.HOST_CRASHED);
    assert.strictEqual(e.crash.duringTransaction.output.financialState, FINANCIAL_STATES.UNKNOWN);
    assert.strictEqual(e.nativo.processType, 'utilityProcess');
    assert.strictEqual(e.nativo.hostVersions.electron, '22.3.27');
    assert.strictEqual(e.nativo.dll.exports, 4);
    assert.strictEqual(e.nativo.client.code, '00');
    assert.strictEqual(e.nativo.mainProcessDllLoads, 0);
  });

  // ----------------------------------------------- 23–25 segurança final
  const contadores = [nativo?.counters, coleta.electron?.nativo?.counters].filter(Boolean);
  const chamadasReais = contadores.reduce((acc, c) => ({
    inicia: acc.inicia + (c.inicia || 0),
    continua: acc.continua + (c.continua || 0),
    finaliza: acc.finaliza + (c.finaliza || 0)
  }), { inicia: 0, continua: 0, finaliza: 0 });

  await test('23: nenhuma chamada financeira real (gate fechado no Main e no host)', () => {
    assert.strictEqual(transacaoRealHabilitada(), false);
    assert.strictEqual(nativo.gateReal, false);
    assert.strictEqual(coleta.electron.nativo.gateReal, false);
    assert.strictEqual(nativo.txStart, ERROS.DESTAXA_TRANSACAO_REAL_BLOQUEADA);
  });

  await test('25: DLL real transacional = 0 chamadas (tripwire do host, Node + Electron)', () => {
    assert.strictEqual(contadores.length, 2);
    assert.deepStrictEqual(chamadasReais, { inicia: 0, continua: 0, finaliza: 0 });
    assert.strictEqual(cargasDllMain, 0);
  });

  const transacoesDepois = await contarTransacoes24h();
  await test('24: nenhuma linha nova em tef_transacoes', () => {
    assert.strictEqual(transacoesAntes, 0);
    assert.strictEqual(transacoesDepois, 0);
  });

  let ambientePersistido = null;
  await test('configuração TEF persistida permanece em homologacao', async () => {
    const row = await consultarDb('SELECT ambiente FROM tef_configuracao ORDER BY id DESC LIMIT 1');
    ambientePersistido = row && row.ambiente;
    assert.strictEqual(ambientePersistido, 'homologacao');
  });

  let arquivosAlterados = [];
  await test('escopo: nenhum arquivo de Motores Fiscal/Não Fiscal, PDV, Financeiro, NF-e/NFC-e, Central, MUC, MIIP ou Monitor TEF alterado', () => {
    const r = spawnSync('git', ['status', '--porcelain'], { cwd: RAIZ, encoding: 'utf8' });
    arquivosAlterados = String(r.stdout || '').split(/\r?\n/).filter(Boolean).map((l) => l.slice(3).replace(/\\/g, '/'));
    const proibidos = [/^backend\/motores\//, /fiscal/i, /nfc-?e|nf-?e/i, /monitor/i, /financeiro/i, /composite/i, /miip/i, /muc/i, /central/i, /pdv/i, /comercial/i];
    const violacoes = arquivosAlterados.filter((a) => proibidos.some((p) => p.test(a)));
    assert.deepStrictEqual(violacoes, []);
  });

  destaxaKoffiLoader.carregarBiblioteca = carregarOriginal;

  // ----------------------------------------------------------- regressões
  if (String(process.env.TEF_06C_MITIGACAO_SKIP_REGRESSOES || '').trim() !== '1') {
    const scripts = [
      'test:tef-01', 'test:tef-02', 'test:tef-fluxo',
      'test:tef-destaxa-01', 'test:tef-destaxa-02', 'test:tef-destaxa-03',
      'test:tef-destaxa-prep-04b', 'test:tef-destaxa-05', 'test:tef-destaxa-06a',
      'test:tef-destaxa-06b', 'test:tef-destaxa-06c-prep'
    ];
    for (const script of scripts) {
      const env = { ...process.env, [REAL_TRANSACTION_ENV]: '0' };
      if (script === 'test:tef-destaxa-06a') env.DESTAXA_REAL_HARNESS = '1';
      const inicio = Date.now();
      const r = spawnSync('npm', ['run', script], { cwd: RAIZ, env, shell: true, encoding: 'utf8', windowsHide: true, maxBuffer: 50 * 1024 * 1024, timeout: 600000 });
      const saida = `${r.stdout || ''}\n${r.stderr || ''}`;
      const resumo = saida.split(/\r?\n/).filter((l) => /RESULTADO|Resultado:|CLIENT_INITIALIZED \(00\)/.test(l)).map((l) => l.trim());
      coleta.regressoes.push({ script, exitCode: r.status, durationMs: Date.now() - inicio, summary: resumo });
      await test(`regressão ${script}`, () => {
        assert.strictEqual(r.status, 0, saida.split(/\r?\n/).filter((l) => /FALHOU|Error/.test(l)).slice(0, 10).join('\n'));
      });
    }
  }

  // ------------------------------------------------------------ relatório
  const aprovado = falhou === 0;
  const relatorio = {
    sprint: 'TEF-DESTAXA-06C-MITIGACAO',
    timestamp: new Date().toISOString(),
    transactionExecuted: false,
    realTransactionGate: { env: REAL_TRANSACTION_ENV, enabled: transacaoRealHabilitada() },
    architecture: {
      adopted: 'TEF Native Host em processo isolado (Electron utilityProcess; child_process.fork fora do Electron)',
      chain: 'TefManager → TefFactory → DestaxaRealAdapter → DestaxaHostBridge → IPC → DestaxaNativeHost → DestaxaNativeBridge → DestaxaTransacaoOrquestrador → Koffi → libdll-integracao-tef.dll → VSPague → PPC930',
      tefManagerUnchangedRole: 'orquestrador funcional único; host é somente fronteira de execução nativa',
      stateMachine: 'DestaxaTransacaoOrquestrador (única), executado dentro do host',
      files: [
        'backend/services/tef/destaxa/DestaxaNativeHost.js',
        'backend/services/tef/destaxa/DestaxaNativeHostClient.js',
        'backend/services/tef/destaxa/DestaxaHostBridge.js',
        'backend/services/tef/destaxa/destaxaNativeHostProtocolo.js',
        'backend/services/tef/destaxa/destaxaNativeHostVerifier.js'
      ]
    },
    mainProcess: {
      node: { pid: process.pid, dllLoads: cargasDllMain, maxLoopGapMs: resp?.maxLoopGapMs ?? null, ticks: resp?.ticks ?? null },
      electron: coleta.electron
        ? {
          version: coleta.electron.runtime.electron,
          node: coleta.electron.runtime.node,
          abi: coleta.electron.runtime.abi,
          dllLoads: coleta.electron.nativo.mainProcessDllLoads,
          maxLoopGapMs: coleta.electron.responsividade.maxLoopGapMs,
          ticks: coleta.electron.responsividade.ticks
        }
        : null,
      controlInProcessBlockingGapMs: '>= 550 (chamada bloqueante de 600ms no próprio Main)'
    },
    hostProcess: {
      node: nativo ? { processType: nativo.processType, pid: nativo.hostPid, versions: nativo.hostVersions } : null,
      electron: coleta.electron ? { processType: coleta.electron.nativo.processType, pid: coleta.electron.nativo.hostPid, versions: coleta.electron.nativo.hostVersions } : null,
      nativeValidation: {
        dllLoaded: nativo?.dll.loaded === true && coleta.electron?.nativo?.dll?.loaded === true,
        exports: nativo?.dll.exports ?? null,
        clientCode: { node: nativo?.client.code ?? null, electron: coleta.electron?.nativo?.client?.code ?? null },
        tripwire: true
      }
    },
    ipc: {
      protocol: PROTOCOLO,
      request: '{ protocol, requestId, operation, transactionId, payload, nativeSeq, sentAt }',
      response: '{ protocol, requestId, transactionId, resultCode, output, error, nativeSeq }',
      validation: 'validarRequest/validarResponse; operações de teste recusadas fora do modo teste; payload sanitizado (sem funções/buffers)',
      responsiveDuringNativeCall: { node: resp?.ipcRoundTrips ?? null, electron: coleta.electron?.responsividade?.ipcRoundTrips ?? null }
    },
    serialization: {
      maxConcurrentNativeOperations: 1,
      clientSide: 'segunda operação → HOST_BUSY sem envio',
      hostSide: 'requisição enviada durante chamada nativa (nativeSeq defasado) → HOST_BUSY, nunca enfileirada',
      verified: resp?.secondOperation === ERROS_HOST.HOST_BUSY && resp?.hostSideBusy === true
    },
    crashHandling: {
      detected: ['HOST_OFFLINE', 'HOST_CRASHED', 'HOST_UNAVAILABLE'],
      mainSurvives: crash?.mainAlive === true,
      duringTransaction: 'HOST_CRASHED → UNKNOWN/PENDING, retryAllowed=false, reconciliação pendente com transactionId; nova transação e reinício implícito bloqueados',
      neverApprovedOrDenied: true
    },
    timeoutHandling: {
      policy: 'HOST_TIMEOUT → UNKNOWN → sem retry; lock do cliente mantido até resposta do host ou queda; resposta tardia registrada para reconciliação',
      retryAttempts: 1,
      newTransactionIdOnTimeout: false,
      newChargeOnTimeout: false
    },
    shutdown: 'encerramento com chamada em voo é adiado (HOST_BUSY), operação não é cancelada, novas operações recusadas (HOST_SHUTTING_DOWN); SHUTDOWN enviado ao host após o retorno',
    transactionId: 'estável por operação; TX_CONTINUE/TX_FINALIZE com transactionId divergente → HOST_TRANSACTION_MISMATCH',
    realTransactionalCalls: chamadasReais,
    database: { newTransactions: transacoesDepois, window: '24h', tefConfiguracaoAmbiente: ambientePersistido },
    scope: { changedFiles: arquivosAlterados, forbiddenAreasTouched: false },
    tests: { executed: executados.length, passed: passou, failed: falhou, failures: falhas },
    regressions: coleta.regressoes,
    result: aprovado ? 'READY_FOR_06C' : 'BLOCKED_FOR_06C'
  };
  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, `${JSON.stringify(relatorio, null, 2)}\n`, 'utf8');
  console.log(`\nRelatório: ${path.relative(RAIZ, RELATORIO)} → ${relatorio.result}`);
  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
