/**
 * RC7.3.1 — Smoke do CentralSyncBackgroundService (timer + flag + reagendamento).
 */

const assert = require('assert');
const {
  CentralSyncBackgroundService
} = require('../../backend/motores/central-entradas/services/CentralSyncBackgroundService');

function criarFlags(syncOn) {
  return {
    estaHabilitado: () => true,
    syncAutomaticaHabilitada: () => syncOn
  };
}

async function testSleepQuandoDesligado() {
  const logs = [];
  const svc = new CentralSyncBackgroundService({
    flags: criarFlags(false),
    configuracaoService: {
      hidratarFlags: async () => {},
      obterIntervaloMs: async () => 1000
    },
    orchestrator: {
      definirProximaExecucaoSync() {},
      obterEstadoSyncExecucao: () => ({})
    },
    xmlWaitScheduler: {
      async iniciar() {},
      parar() {},
      obterStatus: () => ({ ativo: true, documentos: 0, telemetria: {} })
    }
  });
  // Intercepta log via monkeypatch do método privado
  svc._log = (evento, fields) => logs.push({ evento, ...fields });

  await svc.iniciar();
  assert.strictEqual(svc.estaAtivo(), false);
  assert.ok(logs.some((l) => l.evento === 'BACKGROUND SLEEP'));
  assert.ok(logs.some((l) => String(l.motivo || '').includes('sync_automatica_desabilitada')));
}

async function testStartEReagendaAposErro() {
  const logs = [];
  let syncCalls = 0;
  const flags = { on: true };
  const svc = new CentralSyncBackgroundService({
    flags: {
      estaHabilitado: () => true,
      syncAutomaticaHabilitada: () => flags.on
    },
    configuracaoService: {
      hidratarFlags: async () => {},
      obterIntervaloMs: async () => 50
    },
    orchestrator: {
      definirProximaExecucaoSync() {},
      obterEstadoSyncExecucao: () => ({}),
      async executarSincronizacao() {
        syncCalls += 1;
        if (syncCalls === 1) throw new Error('falha simulada');
        flags.on = false;
        return { sucesso: true, notasNovas: 0 };
      }
    },
    xmlWaitScheduler: {
      async iniciar() {},
      parar() {},
      obterStatus: () => ({ ativo: true, documentos: 0, telemetria: {} })
    }
  });
  svc._log = (evento, fields) => logs.push({ evento, ...fields });

  await svc.iniciar();
  assert.strictEqual(svc.estaAtivo(), true);
  assert.ok(logs.some((l) => l.evento === 'BACKGROUND START'));

  // Acelera o primeiro ciclo (produção usa 3s).
  svc._agendarCiclo(20, { motivo: 'teste_acelerado' });
  await new Promise((r) => setTimeout(r, 250));
  assert.ok(syncCalls >= 1, 'deveria executar DistDFe ao menos uma vez');
  assert.ok(logs.some((l) => l.evento === 'BACKGROUND WAKE'));
  assert.ok(logs.some((l) => l.evento === 'BACKGROUND DISTDFE'));
  assert.ok(logs.some((l) => l.evento === 'BACKGROUND TIMER'));

  svc.parar({ motivo: 'teste' });
  assert.strictEqual(svc.estaAtivo(), false);
}

(async () => {
  await testSleepQuandoDesligado();
  await testStartEReagendaAposErro();
  console.log('RC7.3.1 background smoke OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
