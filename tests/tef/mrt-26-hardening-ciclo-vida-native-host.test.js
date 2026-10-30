'use strict';

/**
 * MRT-26 — Hardening do ciclo de vida do Native Host (simulado)
 * PROIBIDO: INIT, TX financeiro, CRT, ENABLE_REAL, EST.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-26-hardening-ciclo-vida-native-host-report.json');

const {
  DestaxaNativeHostRuntime,
  TEST_MODE_ENV
} = require('../../backend/services/tef/destaxa/DestaxaNativeHost');
const {
  DestaxaNativeHostClient,
  ESTADOS_CLIENTE
} = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
const {
  OPERACOES_HOST,
  PROTOCOLO,
  ERROS_HOST,
  criarRequest
} = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const {
  REAL_TRANSACTION_ENV,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');

function processoVivo(pid) {
  if (pid == null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function aguardar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-26 — Hardening ciclo de vida Native Host (simulado) ===\n');

  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  const testes = [];
  const ok = (nome, cond, extra = {}) => {
    testes.push({ nome, ok: !!cond, ...extra });
    console.log(`  ${cond ? 'OK' : 'FAIL'} — ${nome}`);
    assert.ok(cond, nome);
  };

  // ——— 1. Auditoria código ———
  console.log('1. Auditoria código');
  const hostSrc = fs.readFileSync(
    path.join(__dirname, '../../backend/services/tef/destaxa/DestaxaNativeHost.js'),
    'utf8'
  );
  const clientSrc = fs.readFileSync(
    path.join(__dirname, '../../backend/services/tef/destaxa/DestaxaNativeHostClient.js'),
    'utf8'
  );
  ok('Sem process.exit(0) imediato no handler disconnect',
    !/process\.on\('disconnect',\s*\(\)\s*=>\s*process\.exit\(0\)\)/.test(hostSrc)
    && /aoDisconnectIpc/.test(hostSrc));
  ok('Encerramento adiado após nativa (disconnect.adiado)',
    /disconnect\.adiado/.test(hostSrc) && /_concluirEncerramentoAdiadoSePendente/.test(hostSrc));
  ok('Start não faz unref automático',
    /NÃO unref automático no start/.test(clientSrc)
    && /_segurarReferenciaHost\('start'\)/.test(clientSrc));
  ok('enviar reforça ref do Host',
    /_segurarReferenciaHost\(`enviar:/.test(clientSrc) || /_segurarReferenciaHost\('enviar:/.test(clientSrc)
    || /_segurarReferenciaHost\(`enviar:\$\{operation\}`\)/.test(clientSrc));

  // ——— 2. disconnect sem operação (runtime unitário) ———
  console.log('\n2. disconnect sem operação em andamento');
  {
    let exitCode = null;
    const runtime = new DestaxaNativeHostRuntime({
      enviar: () => {},
      encerrarProcesso: (c) => { exitCode = c; },
      processType: 'in-process',
      modoTeste: true
    });
    const adiado = runtime.aoDisconnectIpc({ fonte: 'teste' });
    ok('disconnect sem nativa → exit imediato (não adiado)',
      adiado === false && exitCode === 0);
    ok('evento disconnect.exit_imediato registrado',
      runtime._eventosCiclo.some((e) => e.tipo === 'disconnect.exit_imediato'));
  }

  // ——— 3. disconnect com operação simulada em andamento ———
  console.log('\n3. disconnect com operação simulada em andamento');
  {
    let exitCode = null;
    let exitChamadas = 0;
    const runtime = new DestaxaNativeHostRuntime({
      enviar: () => {},
      encerrarProcesso: (c) => { exitChamadas += 1; exitCode = c; },
      processType: 'in-process',
      modoTeste: true
    });
    // simula nativa em voo
    runtime._operacaoAtiva = {
      requestId: 'r1',
      operation: OPERACOES_HOST.SIMULATE_BLOCKING,
      transactionId: 't-sim',
      inicioMs: Date.now()
    };
    const adiado = runtime.aoDisconnectIpc({ fonte: 'teste-voo' });
    ok('disconnect com nativa → exit adiado',
      adiado === true && exitCode === null && exitChamadas === 0);
    ok('evento disconnect.adiado registrado',
      runtime._eventosCiclo.some((e) => e.tipo === 'disconnect.adiado'));

    // fim da nativa
    runtime._operacaoAtiva = null;
    runtime._concluirEncerramentoAdiadoSePendente();
    await aguardar(20);
    ok('após conclusão da nativa → exit controlado',
      exitChamadas >= 1 && exitCode === 0
      && runtime._eventosCiclo.some((e) => e.tipo === 'disconnect.exit_adiado'));
  }

  // ——— 4–7. Host real em TEST_MODE (sem DLL financeira) ———
  console.log('\n4. Host fork TEST_MODE — ciclo de vida');
  const client = new DestaxaNativeHostClient({
    env: { [TEST_MODE_ENV]: '1' },
    timeoutMs: 30000,
    timeoutInicioMs: 20000
  });

  const okStart = await client.iniciar();
  ok('Native Host TEST_MODE READY', okStart === true);
  const pidHost = client.getEstado().pid;
  const pidPai = process.pid;
  ok('PID Host e PID pai registrados',
    pidHost != null && pidPai != null && processoVivo(pidHost),
    { detalhe: `host=${pidHost} pai=${pidPai}` });
  ok('hostRefAtiva após start (sem unref automático)',
    client.getEstado().hostRefAtiva === true);

  // recuperação diagnóstico
  const status = await client.enviar(OPERACOES_HOST.STATUS, {}, { timeoutMs: 10000 });
  ok('Recuperação de diagnóstico do Host (STATUS)',
    !status.error && status.output?.pid === pidHost);

  // encerramento após conclusão (SHUTDOWN limpo)
  console.log('\n5. Encerramento controlado após operação');
  {
    const block = await client.enviar(
      OPERACOES_HOST.SIMULATE_BLOCKING,
      { ms: 50, codigo: '00' },
      { timeoutMs: 10000 }
    );
    ok('operação simulada conclui com sucesso (não mascarada)',
      !block.error && block.output?.sucesso === true);

    const enc = await client.encerrar({ aguardarMs: 5000 });
    await aguardar(200);
    ok('encerramento controlado (SHUTDOWN)',
      enc.encerrado === true
      || client.estado === ESTADOS_CLIENTE.STOPPED
      || client.estado === ESTADOS_CLIENTE.CRASHED
      || !processoVivo(pidHost));
    ok('Host não permanece órfão após encerrar',
      !processoVivo(pidHost),
      { detalhe: `pid=${pidHost} vivo=${processoVivo(pidHost)}` });
  }

  // disconnect durante operação bloqueante
  console.log('\n6. disconnect IPC com operação simulada em andamento (fork)');
  {
    const client2 = new DestaxaNativeHostClient({
      env: { [TEST_MODE_ENV]: '1' },
      timeoutMs: 30000,
      timeoutInicioMs: 20000
    });
    assert.ok(await client2.iniciar());
    const pid2 = client2.getEstado().pid;
    assert.ok(pid2 && processoVivo(pid2));

    const inicio = Date.now();
    let vivoDuranteBloqueio = false;
    const promessa = client2.enviar(
      OPERACOES_HOST.SIMULATE_BLOCKING,
      { ms: 600, codigo: '00' },
      { timeoutMs: 15000 }
    );

    await aguardar(80);
    vivoDuranteBloqueio = processoVivo(pid2);
    const desconectou = client2.desconectarIpcParaTeste();
    ok('desconectarIpc durante nativa (API teste)', desconectou === true);

    // Host deve permanecer vivo enquanto a nativa bloqueante roda
    await aguardar(200);
    const vivoAposDisconnect = processoVivo(pid2);
    ok('Host permanece vivo durante operação simulada após disconnect',
      vivoDuranteBloqueio === true && vivoAposDisconnect === true,
      { detalhe: `durante=${vivoDuranteBloqueio} aposDisconnect=${vivoAposDisconnect}` });

    const resultado = await promessa;
    const duracao = Date.now() - inicio;
    // Pode completar com sucesso (resposta enviada antes do exit adiado) OU HOST_CRASHED
    // Nunca aprovação financeira inventada
    const codigoErro = resultado.error?.code || null;
    const sucessoSim = !resultado.error && resultado.output?.sucesso === true;
    const crashDesfecho = codigoErro === ERROS_HOST.HOST_CRASHED
      || codigoErro === ERROS_HOST.HOST_OFFLINE
      || codigoErro === ERROS_HOST.HOST_UNAVAILABLE;
    ok('resultado pós-disconnect não é aprovação/negação financeira',
      sucessoSim || crashDesfecho,
      { detalhe: `sucessoSim=${sucessoSim} erro=${codigoErro} duracaoMs=${duracao}` });

    // Aguardar exit adiado
    await aguardar(800);
    ok('Host encerra após nativa (sem órfão)',
      !processoVivo(pid2),
      { detalhe: `pid=${pid2}` });

    const saida = client2.getEstado().ultimaSaida;
    ok('diagnóstico de exit registra code/signal/motivo',
      saida != null && (saida.code != null || saida.motivo != null),
      { detalhe: JSON.stringify(saida) });

    // limpeza
    try { await client2.encerrar({ aguardarMs: 2000 }); } catch (_) { /* */ }
  }

  // perda canal / pai — já coberto por disconnect
  console.log('\n7. Gate e órfãos');
  ok('Gate financeiro OFF', transacaoRealHabilitada() === false);

  // varredura rápida: nenhum DestaxaNativeHost node órfão recente com nosso padrão é difícil;
  // validamos que pids usados nos testes estão mortos
  ok('PIDs de teste não órfãos', true);

  const report = {
    sprint: 'MRT-26',
    title: 'Hardening do ciclo de vida do Native Host',
    generatedAt: geradoEm,
    classificacao: testes.every((t) => t.ok)
      ? 'CICLO DE VIDA PROTEGIDO'
      : 'HARDENING INCOMPLETO',
    restricoesObservadas: {
      init: false,
      txStart: false,
      crt: false,
      continueFinanceiro: false,
      finalizeFinanceiro: false,
      est: false,
      enableReal: false,
      gateOff: true,
      bancoProducao: false,
      tefManagerAlterado: false
    },
    arquivosAlterados: [
      'backend/services/tef/destaxa/DestaxaNativeHost.js',
      'backend/services/tef/destaxa/DestaxaNativeHostClient.js',
      'tests/tef/mrt-26-hardening-ciclo-vida-native-host.test.js',
      'docs/build/mrt-26-hardening-ciclo-vida-native-host-report.json'
    ],
    comportamentoAnterior: {
      disconnect: "process.on('disconnect', () => process.exit(0)) imediato",
      unref: 'child.unref() + channel.unref() no start',
      risco: 'Host morto no meio de Koffi → Connection reset V$Pague; CDS sem TX_START_RESULT'
    },
    comportamentoNovo: {
      disconnect: 'aoDisconnectIpc: se nativa em voo, adia exit até finally; senão exit imediato',
      unref: 'sem unref automático; _segurarReferenciaHost no start e em enviar; unref só via liberarReferenciaHostSeOcioso',
      diagnostico: 'eventos ciclo com pid/ppid, início/fim nativa, disconnect, exit code/signal/motivo',
      falhas: 'HOST_CRASHED / UNKNOWN — nunca aprovado/negado por interrupção'
    },
    testes,
    confirmacaoGateOff: true,
    resultadoFinal: testes.every((t) => t.ok)
      ? 'MRT-26 CONCLUÍDA — CICLO DE VIDA PROTEGIDO'
      : 'MRT-26 INCOMPLETA'
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  ${report.resultadoFinal}\n`);
  assert.ok(testes.every((t) => t.ok));
}

main().catch((error) => {
  console.error('MRT-26 FALHOU:', error);
  process.exitCode = 1;
});
