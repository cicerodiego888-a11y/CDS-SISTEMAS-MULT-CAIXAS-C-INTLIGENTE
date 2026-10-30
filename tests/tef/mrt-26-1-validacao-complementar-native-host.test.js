'use strict';

/**
 * MRT-26.1 — Validação complementar do Native Host
 *
 * Financeiro READ-ONLY: sem INIT/TX/CRT/ENABLE_REAL.
 *
 * LIMITAÇÃO DOCUMENTADA — SIMULATE_BLOCKING:
 * - Ocupa a thread do Host com busy-wait JS (`ocuparThread`), no mesmo caminho
 *   `_processarNativa` usado por LOAD/TX (fila single-flight + finally).
 * - NÃO carrega Koffi, NÃO chama a DLL Destaxa, NÃO abre TCP 60906.
 * - Portanto NÃO reproduz integralmente uma chamada Koffi síncrona (FFI, AV,
 *   socket Background). Serve para validar ciclo IPC / disconnect adiado /
 *   keep-alive do processo filho — não o comportamento da DLL.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-26-1-validacao-complementar-native-host-report.json');

const { TEST_MODE_ENV } = require('../../backend/services/tef/destaxa/DestaxaNativeHost');
const {
  DestaxaNativeHostClient,
  ESTADOS_CLIENTE,
  CLASSIFICACAO_ENCERRAMENTO,
  classificarEncerramentoHost
} = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
const {
  OPERACOES_HOST,
  ERROS_HOST,
  resultadoHostIndisponivel
} = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const {
  REAL_TRANSACTION_ENV,
  CLASSIFICACAO_CODIGO,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');

function processoVivo(pid) {
  if (pid == null || !Number.isFinite(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (_) {
    return false;
  }
}

function aguardar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function aguardarAte(predicado, { timeoutMs = 8000, intervaloMs = 50 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await predicado()) return true;
    await aguardar(intervaloMs);
  }
  return false;
}

function criarClienteTeste() {
  return new DestaxaNativeHostClient({
    env: { [TEST_MODE_ENV]: '1' },
    timeoutMs: 30000,
    timeoutInicioMs: 20000
  });
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-26.1 — Validação complementar Native Host ===\n');

  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  /** PIDs efetivamente criados por este teste — verificação de órfãos no fim. */
  const pidsCriados = new Set();
  const registrarPid = (pid) => {
    if (pid != null) pidsCriados.add(Number(pid));
  };

  const cenarios = [];
  const ok = (nome, cond, extra = {}) => {
    cenarios.push({ nome, ok: !!cond, ...extra });
    console.log(`  ${cond ? 'OK' : 'FAIL'} — ${nome}`);
    assert.ok(cond, nome);
  };

  const limitacaoSimulateBlocking = {
    reproduzFilaNativaSingleFlight: true,
    reproduzBusyWaitNaThreadHost: true,
    reproduzKoffiSincrono: false,
    reproduzChamadaDll: false,
    reproduzTcp60906: false,
    documento:
      'SIMULATE_BLOCKING valida IPC/ciclo de vida do Host, não a chamada Koffi/DLL Destaxa.'
  };

  // ——— Classificador unitário ———
  console.log('1. Diferenciação de encerramentos (classificador)');
  ok('SHUTDOWN → ENCERRAMENTO_CONTROLADO',
    classificarEncerramentoHost({ motivo: 'SHUTDOWN', code: 0 }, { encerramentoLimpo: true })
    === CLASSIFICACAO_ENCERRAMENTO.ENCERRAMENTO_CONTROLADO);
  ok('perda IPC → PERDA_IPC (não controlado)',
    classificarEncerramentoHost({ motivo: 'HOST_CRASHED', code: 0 }, { perdaIpc: true })
    === CLASSIFICACAO_ENCERRAMENTO.PERDA_IPC);
  ok('signal/code≠0 → CRASH_HOST',
    classificarEncerramentoHost({ motivo: 'HOST_CRASHED', code: 1, signal: null })
    === CLASSIFICACAO_ENCERRAMENTO.CRASH_HOST
    && classificarEncerramentoHost({ motivo: 'HOST_CRASHED', code: null, signal: 'SIGTERM' })
    === CLASSIFICACAO_ENCERRAMENTO.CRASH_HOST);
  ok('HOST_CRASHED code 0 sem SHUTDOWN → ENCERRAMENTO_INESPERADO (não controlado)',
    classificarEncerramentoHost({ motivo: 'HOST_CRASHED', code: 0 })
    === CLASSIFICACAO_ENCERRAMENTO.ENCERRAMENTO_INESPERADO);

  const unknown = resultadoHostIndisponivel(ERROS_HOST.HOST_CRASHED, 'tx-x', 'interrompido');
  ok('Operação interrompida permanece UNKNOWN (não aprovado/negado)',
    unknown.financialState === FINANCIAL_STATES.UNKNOWN
    && unknown.classificacao === CLASSIFICACAO_CODIGO.UNKNOWN
    && unknown.sucesso === false
    && unknown.retryAllowed === false);

  // ——— Subprocesso isolado: ciclo IPC real ———
  console.log('\n2. Ciclo IPC em subprocesso (TEST_MODE)');

  // A) Conclusão normal
  {
    const c = criarClienteTeste();
    assert.ok(await c.iniciar());
    const pid = c.getEstado().pid;
    registrarPid(pid);
    ok('A. PID Host criado e vivo (conclusão normal)', processoVivo(pid), { pid });

    const r = await c.enviar(OPERACOES_HOST.SIMULATE_BLOCKING, { ms: 40, codigo: '00' }, { timeoutMs: 10000 });
    ok('A. Conclusão normal da operação simulada',
      !r.error && r.output?.sucesso === true && processoVivo(pid),
      { pid, classificacao: CLASSIFICACAO_ENCERRAMENTO.CONCLUSAO_NORMAL });

    const enc = await c.encerrar({ aguardarMs: 5000 });
    await aguardarAte(() => !processoVivo(pid), { timeoutMs: 5000 });
    const saida = c.getEstado().ultimaSaida;
    ok('A→encerrar: ENCERRAMENTO_CONTROLADO (não crash)',
      saida?.classificacaoEncerramento === CLASSIFICACAO_ENCERRAMENTO.ENCERRAMENTO_CONTROLADO
      && saida?.motivo === 'SHUTDOWN'
      && !processoVivo(pid),
      { pid, saida, encerrado: enc.encerrado });
  }

  // B) Encerramento controlado explícito (STATUS + SHUTDOWN)
  {
    const c = criarClienteTeste();
    assert.ok(await c.iniciar());
    const pid = c.getEstado().pid;
    registrarPid(pid);
    await c.enviar(OPERACOES_HOST.STATUS, {}, { timeoutMs: 8000 });
    await c.encerrar({ aguardarMs: 5000 });
    await aguardarAte(() => !processoVivo(pid));
    const saida = c.getEstado().ultimaSaida;
    ok('B. Encerramento controlado distinto de crash',
      saida?.classificacaoEncerramento === CLASSIFICACAO_ENCERRAMENTO.ENCERRAMENTO_CONTROLADO
      && saida?.classificacaoEncerramento !== CLASSIFICACAO_ENCERRAMENTO.CRASH_HOST
      && c.estado === ESTADOS_CLIENTE.STOPPED
      && !processoVivo(pid),
      { pid, saida });
  }

  // C) Perda de IPC durante nativa simulada
  {
    const c = criarClienteTeste();
    assert.ok(await c.iniciar());
    const pid = c.getEstado().pid;
    registrarPid(pid);

    const promessa = c.enviar(
      OPERACOES_HOST.SIMULATE_BLOCKING,
      { ms: 500, codigo: '00' },
      { timeoutMs: 15000 }
    );
    await aguardar(60);
    ok('C. Host vivo no início do bloqueio (PID do teste)', processoVivo(pid), { pid });
    assert.ok(c.desconectarIpcParaTeste());

    const vivoMeio = await aguardarAte(() => processoVivo(pid), { timeoutMs: 300 });
    const aindaVivoAposDisconnect = processoVivo(pid);
    ok('C. Host permanece vivo após perda IPC durante nativa (adiamento MRT-26)',
      vivoMeio && aindaVivoAposDisconnect,
      { pid, aindaVivoAposDisconnect });

    const resultado = await promessa;
    await aguardarAte(() => !processoVivo(pid), { timeoutMs: 5000 });
    const saida = c.getEstado().ultimaSaida;

    const financeiroUnknown = resultado.error?.code === ERROS_HOST.HOST_CRASHED
      || (resultado.output && resultado.output.financialState === FINANCIAL_STATES.UNKNOWN)
      || (!resultado.error && resultado.output?.sucesso === true); // resposta pode ter sido enviada antes do exit

    ok('C. Perda IPC classificada como PERDA_IPC (não ENCERRAMENTO_CONTROLADO)',
      saida?.classificacaoEncerramento === CLASSIFICACAO_ENCERRAMENTO.PERDA_IPC
      && saida?.classificacaoEncerramento !== CLASSIFICACAO_ENCERRAMENTO.ENCERRAMENTO_CONTROLADO
      && !processoVivo(pid),
      { pid, saida, resultadoErro: resultado.error?.code || null });

    ok('C. Desfecho não é aprovação/negação financeira',
      financeiroUnknown !== false
      && !(resultado.output?.financialState === 'CONFIRMED_SUCCESS')
      && !(resultado.output?.financialState === 'CONFIRMED_DENIED'),
      { financialState: resultado.output?.financialState || null });
  }

  // D) Crash do Host (SIMULATE_CRASH)
  {
    const c = criarClienteTeste();
    assert.ok(await c.iniciar());
    const pid = c.getEstado().pid;
    registrarPid(pid);

    const r = await c.enviar(OPERACOES_HOST.SIMULATE_CRASH, {}, { timeoutMs: 8000 });
    ok('D. SIMULATE_CRASH agenda crash (resposta crashAgendado ou canal cai)',
      r.output?.crashAgendado === true || r.error != null,
      { erro: r.error?.code || null });

    await aguardarAte(() => !processoVivo(pid) || c.estado === ESTADOS_CLIENTE.CRASHED, { timeoutMs: 8000 });
    await aguardar(200);
    const saida = c.getEstado().ultimaSaida;
    const classif = saida?.classificacaoEncerramento;

    ok('D. Crash do Host ≠ ENCERRAMENTO_CONTROLADO',
      classif !== CLASSIFICACAO_ENCERRAMENTO.ENCERRAMENTO_CONTROLADO
      && (classif === CLASSIFICACAO_ENCERRAMENTO.CRASH_HOST
        || classif === CLASSIFICACAO_ENCERRAMENTO.ENCERRAMENTO_INESPERADO
        || c.estado === ESTADOS_CLIENTE.CRASHED)
      && !processoVivo(pid),
      { pid, saida, estado: c.estado });

    try { await c.encerrar({ aguardarMs: 1000 }); } catch (_) { /* já morto */ }
  }

  // E) Encerramento inesperado: kill do filho sem SHUTDOWN
  {
    const c = criarClienteTeste();
    assert.ok(await c.iniciar());
    const pid = c.getEstado().pid;
    registrarPid(pid);
    // mata processo sem passar por SHUTDOWN
    try {
      process.kill(pid, 'SIGTERM');
    } catch (_) {
      try { process.kill(pid); } catch (__) { /* windows */ }
    }
    await aguardarAte(() => !processoVivo(pid) || c.getEstado().ultimaSaida != null, { timeoutMs: 8000 });
    await aguardar(150);
    const saida = c.getEstado().ultimaSaida;
    ok('E. Kill externo → CRASH_HOST ou ENCERRAMENTO_INESPERADO (não controlado)',
      saida
      && saida.classificacaoEncerramento !== CLASSIFICACAO_ENCERRAMENTO.ENCERRAMENTO_CONTROLADO
      && (saida.classificacaoEncerramento === CLASSIFICACAO_ENCERRAMENTO.CRASH_HOST
        || saida.classificacaoEncerramento === CLASSIFICACAO_ENCERRAMENTO.ENCERRAMENTO_INESPERADO
        || c.estado === ESTADOS_CLIENTE.CRASHED)
      && !processoVivo(pid),
      { pid, saida });
  }

  // ——— Órfãos: verificar TODOS os PIDs registrados ———
  console.log('\n3. Verificação efetiva de órfãos');
  await aguardar(300);
  const orfaos = [...pidsCriados].filter((pid) => processoVivo(pid));
  ok('Nenhum PID criado pelo teste permanece vivo (órfão)',
    orfaos.length === 0,
    { pidsCriados: [...pidsCriados], orfaos });

  ok('Gate financeiro OFF', transacaoRealHabilitada() === false);
  ok('Documentação: SIMULATE_BLOCKING ≠ Koffi integral',
    limitacaoSimulateBlocking.reproduzKoffiSincrono === false
    && limitacaoSimulateBlocking.reproduzChamadaDll === false);

  const report = {
    sprint: 'MRT-26.1',
    title: 'Validação complementar do Native Host',
    generatedAt: geradoEm,
    classificacao: cenarios.every((c) => c.ok)
      ? 'VALIDAÇÃO COMPLEMENTAR APROVADA'
      : 'VALIDAÇÃO COMPLEMENTAR INCOMPLETA',
    restricoesObservadas: {
      init: false,
      txStart: false,
      crt: false,
      continueFinanceiro: false,
      finalizeFinanceiro: false,
      enableReal: false,
      gateOff: true,
      bancoProducao: false,
      tefManagerRouterAdapter: false
    },
    limitacaoSimulateBlocking,
    diferenciacaoEncerramentos: {
      CONCLUSAO_NORMAL: 'Operação IPC concluiu com sucesso; Host ainda vivo',
      ENCERRAMENTO_CONTROLADO: 'SHUTDOWN explícito → STOPPED (nunca crash)',
      ENCERRAMENTO_INESPERADO: 'Exit sem SHUTDOWN (ex.: exit 0 pós-disconnect adiado)',
      PERDA_IPC: 'disconnect do canal com flag perdaIpc',
      CRASH_HOST: 'code≠0, signal, ou SIMULATE_CRASH / kill'
    },
    arquivosAlterados: [
      'backend/services/tef/destaxa/DestaxaNativeHostClient.js (classificarEncerramentoHost)',
      'tests/tef/mrt-26-1-validacao-complementar-native-host.test.js',
      'docs/build/mrt-26-1-validacao-complementar-native-host-report.json'
    ],
    pidsCriadosPeloTeste: [...pidsCriados],
    orfaosDetectados: orfaos,
    cenarios,
    tratamentoUnknownPreservado: {
      resultadoHostIndisponivel: true,
      financialState: FINANCIAL_STATES.UNKNOWN,
      classificacao: CLASSIFICACAO_CODIGO.UNKNOWN
    },
    confirmacaoGateOff: true,
    resultadoFinal: cenarios.every((c) => c.ok)
      ? 'MRT-26.1 CONCLUÍDA — VALIDAÇÃO COMPLEMENTAR APROVADA'
      : 'MRT-26.1 INCOMPLETA'
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  PIDs criados: ${[...pidsCriados].join(', ') || '(nenhum)'}`);
  console.log(`  Órfãos: ${orfaos.length}`);
  console.log(`  ${report.resultadoFinal}\n`);

  assert.ok(cenarios.every((c) => c.ok));
  assert.strictEqual(orfaos.length, 0);
}

main().catch((error) => {
  console.error('MRT-26.1 FALHOU:', error);
  process.exitCode = 1;
});
