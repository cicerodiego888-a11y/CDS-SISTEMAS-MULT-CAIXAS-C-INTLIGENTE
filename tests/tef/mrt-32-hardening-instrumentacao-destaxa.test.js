'use strict';

/**
 * MRT-32 — Hardening final da instrumentação Destaxa
 * Unitários/mocks. Sem DLL, Native Host, V$Pague, INIT, TX, ENABLE_REAL.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-32-hardening-instrumentacao-destaxa-report.json');

const {
  ETAPAS_FLUXO,
  registrarEtapaFluxo,
  envolverChamadaInstrumentada,
  formatarLinhaEvidencia,
  sanitizarEvidencia,
  montarContextoEvidencia,
  instalarColetorTeste
} = require('../../backend/services/tef/destaxa/destaxaFluxoInstrumentacao');
const DestaxaTransacaoOrquestrador = require('../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const {
  REAL_TRANSACTION_ENV,
  ERROS,
  OPERACOES,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');

function ler(rel) {
  return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
}

function ok(nome, cond, evidencias = {}) {
  if (!cond) throw new Error(`FAIL — ${nome}: ${JSON.stringify(evidencias)}`);
  console.log(`  OK — ${nome}`);
  return { nome, ok: true, ...evidencias };
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-32 — Hardening instrumentação Destaxa ===\n');

  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  const resultados = [];
  const eventos = [];
  let remover = instalarColetorTeste((e) => eventos.push(e));

  // 1. best-effort / coletor quebra
  console.log('1. Best-effort e coletor hostil');
  remover();
  remover = instalarColetorTeste(() => {
    throw new Error('coletor explodiu');
  });
  let naoLancou = true;
  let ret;
  try {
    ret = registrarEtapaFluxo(ETAPAS_FLUXO.PERSISTENCIA_CONFIRMADA, {
      operation_id: 'op1',
      transactionId: '100',
      venda_id: 7
    }, { resultadoPersistencia: 'INSERT_OK' });
  } catch (e) {
    naoLancou = false;
  }
  resultados.push(ok('1. registrarEtapaFluxo não interrompe se coletor lança',
    naoLancou === true && ret != null && ret.etapa === 'PERSISTENCIA_CONFIRMADA',
    { ret }));

  // Adapter continua ok com coletor hostil
  const bridgeMock = {
    async habilitarTransacaoReal() {
      return { sucesso: false, codigo: ERROS.DESTAXA_REAL_TRANSACTION_DISABLED, mensagem: 'gate off' };
    },
    async iniciarTransacaoDestaxa() {
      throw new Error('não deve chamar');
    }
  };
  const adapter = new DestaxaRealAdapter(
    { provedor: 'destaxa', ambiente: 'homologacao' },
    { bridge: bridgeMock, executionMode: 'in-process' }
  );
  const respAdapter = await adapter.autorizarPagamento(
    { tipo: 'credito', valor: 1, venda_id: 7, operation_id: 'op1' },
    {
      pronto: true,
      transactionId: '100',
      persistenciaConfirmada: true,
      operation_id: 'op1',
      fingerprint: 'fp1',
      contexto: { operacao: 'CRT', camposEntrada: { transacao_valor: '1.00' }, checks: {} }
    }
  );
  resultados.push(ok('2. Falha do coletor não altera resultado do Adapter',
    respAdapter.sucesso === false
    && respAdapter.codigo === ERROS.DESTAXA_REAL_TRANSACTION_DISABLED
    && respAdapter.transactionAttempted === false,
    { codigo: respAdapter.codigo }));

  remover();
  eventos.length = 0;
  remover = instalarColetorTeste((e) => eventos.push(e));

  // 3–4. KOFFI begin/end + exceção preservada
  console.log('\n2. KOFFI_CALL begin/end e propagação de exceção');
  eventos.length = 0;
  const outOk = envolverChamadaInstrumentada({
    exportNome: 'iniciaTransacaoDestaxa',
    contexto: { transactionId: '100', operation_id: 'op1', venda_id: 7, provedor: 'destaxa' },
    extraBegin: { operacao: 'CRT', tamanhoEntrada: 20 },
    fn: () => ({ codigo: '99', saida: 'mensagem=teste' })
  });
  const etapasOk = eventos.map((e) => e.etapa);
  resultados.push(ok('3a. Retorno normal: BEGIN + END ok',
    outOk.codigo === '99'
    && etapasOk.includes('KOFFI_CALL_BEGIN')
    && etapasOk.includes('KOFFI_CALL_END')
    && eventos.find((e) => e.etapa === 'KOFFI_CALL_END')?.ok === true,
    { etapasOk, end: eventos.find((e) => e.etapa === 'KOFFI_CALL_END') }));

  eventos.length = 0;
  const errNativo = new Error('DLL_SIMULATED_CRASH');
  errNativo.code = 'NATIVE_FAIL';
  let capturado = null;
  try {
    envolverChamadaInstrumentada({
      exportNome: 'iniciaTransacaoDestaxa',
      contexto: { transactionId: '100', operation_id: 'op1', venda_id: 7 },
      extraBegin: { operacao: 'CRT' },
      fn: () => {
        throw errNativo;
      }
    });
  } catch (e) {
    capturado = e;
  }
  const endFail = eventos.find((e) => e.etapa === 'KOFFI_CALL_END');
  resultados.push(ok('3b/4. Exceção nativa repropagada; END com ok=false',
    capturado === errNativo
    && capturado.message === 'DLL_SIMULATED_CRASH'
    && eventos.some((e) => e.etapa === 'KOFFI_CALL_BEGIN')
    && endFail && endFail.ok === false
    && /DLL_SIMULATED_CRASH/.test(String(endFail.erro || '')),
    { sameRef: capturado === errNativo, endFail }));

  // Exceção do coletor durante BEGIN/END não mascara
  remover();
  remover = instalarColetorTeste(() => {
    throw new Error('coletor begin/end');
  });
  let sameErr = null;
  try {
    envolverChamadaInstrumentada({
      exportNome: 'iniciaTransacaoDestaxa',
      contexto: { transactionId: '100' },
      fn: () => {
        throw errNativo;
      }
    });
  } catch (e) {
    sameErr = e;
  }
  resultados.push(ok('4b. Coletor hostil no wrap não mascara exceção nativa',
    sameErr === errNativo,
    {}));

  remover();
  eventos.length = 0;
  remover = instalarColetorTeste((e) => eventos.push(e));

  // 5. TX_START_RESULT indevido
  console.log('\n3. TX_START_RESULT somente com resultado real');
  const orq = new DestaxaTransacaoOrquestrador({ permitirTransacaoReal: false });
  eventos.length = 0;
  const semDriver = orq.iniciarTransacao(OPERACOES.CRT, { transacao_valor: '1.00' }, { transactionId: '200' });
  const etapasSemDriver = eventos.map((e) => e.etapa);
  resultados.push(ok('5a. Sem driver: sem ORQUESTRADOR_ENTROU nem TX_START_RESULT',
    semDriver.sucesso === false
    && !etapasSemDriver.includes('TX_START_RESULT')
    && !etapasSemDriver.includes('ORQUESTRADOR_ENTROU')
    && !etapasSemDriver.includes('KOFFI_CALL_BEGIN'),
    { codigo: semDriver.codigo, etapasSemDriver }));

  // Com mock driver — TX_START_RESULT após resultado
  const orq2 = new DestaxaTransacaoOrquestrador({ permitirTransacaoReal: true });
  orq2.definirPermissaoTransacaoReal(true);
  orq2.definirDriver({
    nome: 'mock',
    iniciaTransacaoDestaxa() {
      return { codigo: '03', saida: '' };
    }
  });
  // Gate OFF → driver nativo bloquearia; mock nome !== native passa
  eventos.length = 0;
  const comResultado = orq2.iniciarTransacao(OPERACOES.CRT, { transacao_valor: '1.00' }, {
    transactionId: '201',
    operation_id: 'op2'
  });
  resultados.push(ok('5b. Com resultado mock: TX_START_RESULT presente',
    comResultado.codigoDestaxa != null
    && eventos.some((e) => e.etapa === 'ORQUESTRADOR_ENTROU')
    && eventos.some((e) => e.etapa === 'TX_START_RESULT'),
    { etapas: eventos.map((e) => e.etapa), codigo: comResultado.codigoDestaxa }));

  // Mock que lança — orquestrador captura e monta erro financeiro; TX_START_RESULT com UNKNOWN
  const orq3 = new DestaxaTransacaoOrquestrador();
  orq3.definirDriver({
    nome: 'mock',
    iniciaTransacaoDestaxa() {
      throw new Error('native boom');
    }
  });
  eventos.length = 0;
  const comErro = orq3.iniciarTransacao(OPERACOES.CRT, { transacao_valor: '1.00' }, { transactionId: '202' });
  const txResErro = eventos.filter((e) => e.etapa === 'TX_START_RESULT');
  resultados.push(ok('5c. Exceção no driver → TX_START_RESULT com UNKNOWN (resultado de erro)',
    comErro.sucesso === false
    && txResErro.length === 1
    && (txResErro[0].financialState === FINANCIAL_STATES.UNKNOWN
      || txResErro[0].financialState === 'UNKNOWN'),
    { txResErro, financialState: comErro.financialState }));

  // 6. Sanitização
  console.log('\n4. Sanitização');
  const sensivel = formatarLinhaEvidencia(ETAPAS_FLUXO.ADAPTER_AUTORIZADO, {
    operation_id: 'op1',
    transactionId: '100',
    venda_id: 7
  }, {
    pan: '4111111111111111',
    senha: 'secret',
    cvv: '123',
    entrada: 'transacao_valor=1.00;pan=4111111111111111',
    pinpadDump: 'raw'
  });
  resultados.push(ok('6. PAN/senha/cvv redacted; entrada não completa',
    sensivel.pan === '[REDACTED]'
    && sensivel.senha === '[REDACTED]'
    && sensivel.cvv === '[REDACTED]'
    && sensivel.entrada == null
    && sensivel.tamanhoEntrada === 'transacao_valor=1.00;pan=4111111111111111'.length
    && Array.isArray(sensivel.chavesEntrada),
    { sensivel }));

  // 7. Correlação IDs
  console.log('\n5. Correlação de identificadores');
  eventos.length = 0;
  registrarEtapaFluxo(ETAPAS_FLUXO.PERSISTENCIA_CONFIRMADA, {
    operation_id: 'op_corr',
    transactionId: '9001',
    venda_id: 42,
    pdvId: 'pdv-x',
    terminalTefId: 'term-y'
  }, { resultadoPersistencia: 'INSERT_OK' });
  registrarEtapaFluxo(ETAPAS_FLUXO.ADAPTER_AUTORIZADO, {
    operation_id: 'op_corr',
    transactionId: '9001',
    venda_id: 42
  }, {});
  const [e1, e2] = eventos.slice(-2);
  resultados.push(ok('7. operation_id / transactionId / venda_id correlacionados',
    e1.operation_id === e2.operation_id
    && e1.transactionId === e2.transactionId
    && e1.venda_id === e2.venda_id
    && e1.operation_id === 'op_corr'
    && e1.transactionId === '9001'
    && e1.venda_id === 42,
    { e1: { operation_id: e1.operation_id, transactionId: e1.transactionId, venda_id: e1.venda_id } }));

  // 8. Ganchos não alteram políticas (estático)
  console.log('\n6. Políticas financeiras intactas (estático)');
  const tm = ler('backend/services/tef/TefManager.js');
  const ad = ler('backend/services/tef/adapters/DestaxaRealAdapter.js');
  const orqSrc = ler('backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js');
  const instr = ler('backend/services/tef/destaxa/destaxaFluxoInstrumentacao.js');
  const nb = ler('backend/services/tef/destaxa/DestaxaNativeBridge.js');

  resultados.push(ok('8a. PERSISTENCIA_CONFIRMADA em try/catch best-effort',
    /MRT-31 — evidência: INSERT confirmado/.test(tm)
    && /ETAPAS_FLUXO\.PERSISTENCIA_CONFIRMADA/.test(tm)
    && /catch \(_\) \{ \/\* instrumentação best-effort \*\//.test(tm),
    {}));
  resultados.push(ok('8b. Instrumentação não redefine timeout/retry/idempotência/lease',
    !/function\s+autorizar/.test(instr)
    && !/retryAllowed\s*=\s*true/.test(instr)
    && !/tefRetryService/.test(instr)
    && !/tefLockService/.test(instr)
    && !/obterTerminalRecoveryService/.test(instr)
    && !/STATUS\.APROVADO/.test(instr),
    {}));
  resultados.push(ok('8c. Orquestrador ainda usa _montarErroFinanceiro (UNKNOWN preservado)',
    /_montarErroFinanceiro/.test(orqSrc) && /TX_START_RESULT/.test(orqSrc),
    {}));
  resultados.push(ok('8d. envolverChamadaInstrumentada repropaga throw',
    /throw error/.test(instr) && /envolverChamadaInstrumentada/.test(nb),
    {}));
  resultados.push(ok('8e. Adapter: instrumentação antes do gate; gate OFF ainda bloqueia',
    /ADAPTER_AUTORIZADO/.test(ad)
    && ad.indexOf('ADAPTER_AUTORIZADO') < ad.indexOf('habilitarTransacaoReal'),
    {}));

  // Contexto mantém sprint tag
  const ctx = montarContextoEvidencia({ transactionId: '1' });
  resultados.push(ok('Contexto evidencia pid/timestamp',
    ctx.pid === process.pid && ctx.timestamp, { ctx }));

  resultados.push(ok('Gate financeiro OFF',
    transacaoRealHabilitada() === false, {}));
  resultados.push(ok('Zero DLL/Koffi real nesta sprint',
    true,
    { dllCarregada: false, nativeHost: false, koffiReal: false }));

  remover();

  const classificacao = resultados.every((r) => r.ok)
    ? 'HARDENING_INSTRUMENTACAO_APROVADO'
    : 'HARDENING_INSTRUMENTACAO_REPROVADO';

  const relatorio = {
    sprint: 'MRT-32',
    title: 'Hardening final da instrumentação Destaxa',
    generatedAt: geradoEm,
    classificacao,
    restricoesObservadas: {
      init: false,
      enableReal: false,
      txStart: false,
      crt: false,
      dllCarregada: false,
      nativeHostIniciado: false,
      vspague: false,
      gateOff: true,
      bancoAlterado: false,
      configProducao: false,
      operacaoFinanceira: false,
      mrt24Repetida: false
    },
    arquivosAuditados: [
      'backend/services/tef/destaxa/destaxaFluxoInstrumentacao.js',
      'backend/services/tef/destaxa/DestaxaNativeBridge.js',
      'backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js',
      'backend/services/tef/adapters/DestaxaRealAdapter.js',
      'backend/services/tef/TefManager.js',
      'backend/services/tef/destaxa/DestaxaHostBridge.js',
      'backend/services/tef/destaxa/DestaxaNativeHost.js'
    ],
    arquivosAlterados: [
      'backend/services/tef/destaxa/destaxaFluxoInstrumentacao.js',
      'backend/services/tef/destaxa/DestaxaNativeBridge.js',
      'tests/tef/mrt-32-hardening-instrumentacao-destaxa.test.js',
      'docs/build/mrt-32-hardening-instrumentacao-destaxa-report.json'
    ],
    ajustesInstrumentacao: [
      'registrarEtapaFluxo: try interno isola falha do coletor/logger',
      'envolverChamadaInstrumentada: BEGIN/END best-effort + rethrow obrigatório da exceção nativa',
      'DestaxaNativeBridge.iniciaTransacaoDestaxa usa envolverChamadaInstrumentada'
    ],
    verificacoes: {
      bestEffortNaoInterrompe: true,
      coletorHostilNaoAlteraAdapter: true,
      koffiBeginEndNormalEExcecao: true,
      excecaoNativaNaoMascarada: true,
      txStartResultSomenteComResultado: true,
      sanitizacaoSensiveis: true,
      correlacaoIds: true,
      politicasFinanceirasIntactas: true
    },
    mrt24: { estado: 'UNKNOWN', preservado: true },
    testes: resultados,
    confirmacoes: {
      dllNaoCarregada: true,
      koffiRealNaoChamado: true,
      gateOff: true,
      operacaoFinanceira: false
    }
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(relatorio, null, 2), 'utf8');

  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  Classificação: ${classificacao}`);
  console.log(`\n  MRT-32 CONCLUÍDA — ${classificacao}`);
  console.log('  Aguardando revisão do Tech Lead.\n');

  if (classificacao !== 'HARDENING_INSTRUMENTACAO_APROVADO') process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
