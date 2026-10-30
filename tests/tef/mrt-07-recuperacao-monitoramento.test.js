'use strict';

/**
 * MRT-07 — Recuperação e monitoramento (sem INIT/TX real/migration oficial).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  criarTerminalRecoveryService,
  resetTerminalRecoveryServiceParaTestes,
  criarTerminalMonitor,
  MONITOR_STATES,
  RECOVERY_CODES,
  ACOES_PROIBIDAS,
  HOLD_TERMINAL_PREFIX
} = require('../../backend/services/tef/terminalRecovery');

const {
  criarTerminalAllocator,
  resetTerminalAllocatorParaTestes,
  RELEASE_REASONS,
  ALLOCATION_CODES
} = require('../../backend/services/tef/terminalAllocator');

const {
  criarTerminalRegistry,
  resetTerminalRegistryParaTestes,
  TERMINAL_STATES
} = require('../../backend/services/tef/terminalRegistry');

const {
  criarTerminalRouter,
  resetTerminalRouterParaTestes
} = require('../../backend/services/tef/terminalRouter');

const integ = require('../../backend/services/tef/tefRouterIntegration');
const tefContrato = require('../../backend/services/tef/tefContrato');
const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');

function test(nome, fn) {
  const ret = fn();
  if (ret && typeof ret.then === 'function') {
    return ret.then(() => console.log(`  OK  ${nome}`)).catch((err) => {
      console.error(`  FAIL ${nome}`);
      throw err;
    });
  }
  console.log(`  OK  ${nome}`);
  return Promise.resolve();
}

console.log('=== MRT-07 — Recuperação e monitoramento ===\n');

(async () => {
  resetTerminalRecoveryServiceParaTestes();
  resetTerminalAllocatorParaTestes();
  resetTerminalRegistryParaTestes();
  resetTerminalRouterParaTestes();

  const allocator = criarTerminalAllocator({ ocupacaoTimeoutMs: 2000 });
  const registry = criarTerminalRegistry();
  registry.registrar({
    id: 'tef-1',
    pdvId: '1',
    provedor: 'destaxa',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    dispositivo: { id: 'dev-1', tipo: 'pinpad', portaCom: 'COM1', ativo: true }
  });
  registry.registrar({
    id: 'tef-off',
    pdvId: '2',
    provedor: 'sitef',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.INDISPONIVEL,
    dispositivo: { id: 'dev-off', tipo: 'pinpad', portaCom: 'COM9', ativo: false }
  });

  let pendenciasMem = [];
  const recovery = criarTerminalRecoveryService({
    getAllocator: () => allocator,
    getRegistry: () => registry,
    listarPendencias: () => pendenciasMem,
    monitor: criarTerminalMonitor({
      getAllocator: () => allocator,
      getRegistry: () => registry,
      listarPendencias: () => pendenciasMem
    })
  });

  await test('reinicialização com terminal livre', () => {
    pendenciasMem = [];
    allocator.resetParaTestes();
    const r = recovery.recuperarAposReinicio({ forcar: true, pendenciasCompletas: [] });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.codigo, RECOVERY_CODES.SEM_PENDENCIAS);
    assert.strictEqual(r.autoAprovacao, false);
    assert.strictEqual(r.autoRetry, false);
    const mon = recovery.monitorar({ pendenciasCompletas: [] });
    const t1 = mon.terminais.find((t) => t.terminalTefId === 'tef-1');
    assert.strictEqual(t1.estadoMonitor, MONITOR_STATES.LIVRE);
  });

  await test('reinicialização com operação aprovada (sem pendência)', () => {
    allocator.resetParaTestes();
    const a = allocator.adquirir({ terminalTefId: 'tef-1', provedor: 'destaxa', pdvId: '1' });
    allocator.liberar(a.lease.leaseId, RELEASE_REASONS.SUCESSO_CONFIRMADO);
    pendenciasMem = [];
    const r = recovery.recuperarAposReinicio({ forcar: true, pendenciasCompletas: [] });
    assert.strictEqual(r.holdsAtivos, 0);
    assert.ok(ACOES_PROIBIDAS.includes('APROVAR_PAGAMENTO'));
    assert.strictEqual(allocator.statusTerminal('tef-1').ocupado, false);
  });

  await test('reinicialização com operação inconclusiva → hold Destaxa', () => {
    allocator.resetParaTestes();
    const a = allocator.adquirir({ terminalTefId: 'tef-1', provedor: 'destaxa', pdvId: '1' });
    allocator.marcarInconclusivo(a.lease.leaseId);
    pendenciasMem = [{
      transacaoId: '100',
      provedor: 'destaxa',
      financialState: FINANCIAL_STATES.UNKNOWN,
      status: tefContrato.STATUS.PENDENTE,
      terminalTefId: 'tef-1'
    }];
    const r = recovery.recuperarAposReinicio({
      forcar: true,
      pendenciasCompletas: pendenciasMem
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.holdsAtivos >= 1);
    assert.strictEqual(r.liberouInconclusivoFinanceiro, false);
    assert.strictEqual(r.autoCancelamento, false);
    assert.strictEqual(r.autoRetry, false);
    // Runtime Destaxa ocupado por hold
    assert.strictEqual(
      allocator.statusRuntime('runtime:destaxa:global').ocupado,
      true
    );
    const mon = recovery.monitorar({ pendenciasCompletas: pendenciasMem });
    assert.ok(mon.terminais.some((t) =>
      t.estadoMonitor === MONITOR_STATES.EM_RECUPERACAO
      || t.estadoMonitor === MONITOR_STATES.INCONCLUSIVO
    ));
  });

  await test('lease expirado com operação financeira pendente NÃO libera', () => {
    let agora = 1_000_000;
    const alloc = criarTerminalAllocator({
      ocupacaoTimeoutMs: 1000,
      now: () => agora
    });
    const a = alloc.adquirir({ terminalTefId: 'tef-x', provedor: 'sitef' });
    alloc.marcarInconclusivo(a.lease.leaseId);
    agora += 60_000;
    assert.strictEqual(alloc.statusTerminal('tef-x').ocupado, true);
    const lib = alloc.liberar(a.lease.leaseId, RELEASE_REASONS.TIMEOUT_OCUPACAO);
    assert.strictEqual(lib.codigo, ALLOCATION_CODES.LIBERACAO_BLOQUEADA_INCONCLUSIVA);
  });

  await test('recuperação de runtime Destaxa bloqueia nova alocação', async () => {
    allocator.resetParaTestes();
    pendenciasMem = [{
      transacaoId: '200',
      provedor: 'destaxa',
      financialState: FINANCIAL_STATES.UNKNOWN,
      terminalTefId: 'tef-1'
    }];
    recovery.recuperarAposReinicio({ forcar: true, pendenciasCompletas: pendenciasMem });
    const aq = allocator.adquirir({
      terminalTefId: 'tef-1',
      provedor: 'destaxa',
      pdvId: '1'
    });
    assert.strictEqual(aq.ok, false);
    assert.ok(
      aq.codigo === ALLOCATION_CODES.RUNTIME_OCUPADO
      || aq.codigo === ALLOCATION_CODES.TERMINAL_OCUPADO
    );
  });

  await test('operação sem venda vinculada detectada no monitor', () => {
    allocator.resetParaTestes();
    pendenciasMem = [{
      transacaoId: '300',
      provedor: 'destaxa',
      vendaId: null,
      financialState: FINANCIAL_STATES.UNKNOWN
    }];
    recovery.recuperarAposReinicio({ forcar: true, pendenciasCompletas: pendenciasMem });
    const mon = recovery.monitorar({ pendenciasCompletas: pendenciasMem });
    assert.ok(mon.terminais.some((t) => t.semVendaVinculada === true));
  });

  await test('operação com resultado tardio marcada no monitor', () => {
    pendenciasMem = [{
      transacaoId: '400',
      provedor: 'destaxa',
      estado: 'AGUARDANDO_RESULTADO_TARDIO',
      resultadoTardio: { codigo: 'TIMEOUT' },
      financialState: FINANCIAL_STATES.UNKNOWN
    }];
    allocator.resetParaTestes();
    recovery.recuperarAposReinicio({ forcar: true, pendenciasCompletas: pendenciasMem });
    const mon = recovery.monitorar({ pendenciasCompletas: pendenciasMem });
    assert.ok(mon.terminais.some((t) => t.resultadoTardio === true && t.semResultadoDefinitivo));
  });

  await test('tentativa de nova autorização após reinício (integração allocate)', async () => {
    allocator.resetParaTestes();
    pendenciasMem = [{
      transacaoId: '500',
      provedor: 'destaxa',
      financialState: FINANCIAL_STATES.UNKNOWN
    }];
    recovery.recuperarAposReinicio({ forcar: true, pendenciasCompletas: pendenciasMem });

    const router = criarTerminalRouter({
      registry,
      allocator,
      identityValidator: {
        validarPdvId: async () => ({
          ok: true,
          ausente: true,
          pdv: null
        })
      },
      carregarBindingSingleton: async () => ({
        ok: true,
        config: {},
        adapterBinding: {
          registro: { provedor: 'destaxa', ambiente: 'homologacao' },
          executionMode: 'native-host'
        }
      })
    });

    const rota = await integ.resolverRotaAutorizacao({}, {
      router,
      mapaPdvEstacao: []
    });
    assert.strictEqual(rota.sucesso, false);
    assert.ok(
      rota.routeDecision.codigo === 'RUNTIME_OCUPADO'
      || rota.routeDecision.codigo === 'TERMINAL_OCUPADO'
      || rota.routeDecision.codigo === 'ALOCACAO_FALHOU'
    );
  });

  await test('recuperação duplicada é idempotente', () => {
    allocator.resetParaTestes();
    pendenciasMem = [{
      transacaoId: '600',
      provedor: 'destaxa',
      financialState: FINANCIAL_STATES.UNKNOWN
    }];
    const r1 = recovery.recuperarAposReinicio({ forcar: true, pendenciasCompletas: pendenciasMem });
    const r2 = recovery.recuperarAposReinicio({ pendenciasCompletas: pendenciasMem });
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r2.codigo, RECOVERY_CODES.RECUPERACAO_DUPLICADA);
    assert.strictEqual(r2.autoRetry, false);
  });

  await test('sincronizar holds remove apenas quando pendência sumiu', () => {
    allocator.resetParaTestes();
    pendenciasMem = [{
      transacaoId: '700',
      provedor: 'destaxa',
      financialState: FINANCIAL_STATES.UNKNOWN
    }];
    recovery.recuperarAposReinicio({ forcar: true, pendenciasCompletas: pendenciasMem });
    assert.strictEqual(allocator.statusRuntime('runtime:destaxa:global').ocupado, true);

    // ainda pendente → mantém
    const s1 = recovery.sincronizarHoldsComPendencias({ pendenciasCompletas: pendenciasMem });
    assert.ok(s1.mantidos.length >= 1);
    assert.strictEqual(s1.autoAprovacao, false);

    // pendência resolvida (TEF-14 externo) → remove hold
    const s2 = recovery.sincronizarHoldsComPendencias({ pendenciasCompletas: [] });
    assert.ok(s2.removidos.length >= 1);
    assert.strictEqual(allocator.statusRuntime('runtime:destaxa:global').ocupado, false);
  });

  await test('monitor diferencia livre / ocupado / indisponível / recuperação', () => {
    allocator.resetParaTestes();
    pendenciasMem = [];
    const a = allocator.adquirir({ terminalTefId: 'tef-1', provedor: 'destaxa', pdvId: '1' });
    const mon = recovery.monitorar({ pendenciasCompletas: [] });
    const livreOuOcup = mon.terminais.find((t) => t.terminalTefId === 'tef-1');
    assert.strictEqual(livreOuOcup.estadoMonitor, MONITOR_STATES.OCUPADO);
    const indisp = mon.terminais.find((t) => t.terminalTefId === 'tef-off');
    assert.strictEqual(indisp.estadoMonitor, MONITOR_STATES.INDISPONIVEL);
    allocator.liberar(a.lease.leaseId, RELEASE_REASONS.FALHA_CONFIRMADA);
  });

  await test('classificarPosAutorizacao + inconclusivo alinhado TEF-14', () => {
    const cls = integ.classificarPosAutorizacao({
      sucesso: false,
      status: tefContrato.STATUS.PENDENTE,
      codigo: 'TIMEOUT',
      financialState: FINANCIAL_STATES.UNKNOWN
    }, { transacaoId: 1, forcarInconclusivo: true });
    assert.strictEqual(cls.acao, 'MARCAR_INCONCLUSIVO');
  });

  await test('migration proposta existe e NÃO é auto-aplicada', () => {
    const sqlPath = path.join(__dirname, '../../docs/build/mrt-07-migration-proposta.sql');
    assert.ok(fs.existsSync(sqlPath));
    const sql = fs.readFileSync(sqlPath, 'utf8');
    assert.match(sql, /tef_terminal_leases/);
    assert.match(sql, /NÃO aplicar|NÃO executar/i);
    const dbJs = fs.readFileSync(
      path.join(__dirname, '../../backend/database.js'),
      'utf8'
    );
    assert.ok(!dbJs.includes('tef_terminal_leases'));
    assert.ok(!dbJs.includes('mrt-07-migration'));
  });

  await test('TefManager integra recuperação/monitor (estático)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/tef/TefManager.js'),
      'utf8'
    );
    assert.match(src, /obterTerminalRecoveryService/);
    assert.match(src, /recuperarAposReinicio/);
    assert.match(src, /monitorarTerminaisTef/);
    assert.match(src, /roteamento/);
    assert.match(src, /sincronizarHoldsComPendencias/);
    // não altera regras TEF-13 chave
    assert.match(src, /idempotency_key/);
  });

  await test('adapters / TEF-14 política não reescritos', () => {
    assert.ok(!fs.readFileSync(
      path.join(__dirname, '../../backend/services/tef/adapters/DestaxaRealAdapter.js'),
      'utf8'
    ).includes('terminalRecovery'));
    assert.ok(HOLD_TERMINAL_PREFIX.startsWith('recuperacao:'));
  });

  resetTerminalRecoveryServiceParaTestes();
  resetTerminalAllocatorParaTestes();
  resetTerminalRegistryParaTestes();
  resetTerminalRouterParaTestes();

  console.log('\nMRT-07 testes OK — sem INIT / TX real / migration oficial.\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
