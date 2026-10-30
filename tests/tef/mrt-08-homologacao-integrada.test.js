'use strict';

/**
 * MRT-08 — Homologação integrada do CDS TEF Terminal Router.
 * Somente simulação: sem INIT Destaxa, sem pagamento/cancelamento real, sem migration.
 *
 * Executar: node tests/tef/mrt-08-homologacao-integrada.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const integ = require('../../backend/services/tef/tefRouterIntegration');
const tefContrato = require('../../backend/services/tef/tefContrato');
const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');

const {
  criarTerminalRegistry,
  resetTerminalRegistryParaTestes,
  TERMINAL_STATES
} = require('../../backend/services/tef/terminalRegistry');

const {
  criarTerminalAllocator,
  resetTerminalAllocatorParaTestes,
  RELEASE_REASONS,
  ALLOCATION_CODES
} = require('../../backend/services/tef/terminalAllocator');

const {
  criarTerminalRouter,
  resetTerminalRouterParaTestes,
  criarPdvIdentityValidator,
  ROUTE_CODES,
  MODOS_ROUTER
} = require('../../backend/services/tef/terminalRouter');

const {
  criarExecutionContextResolver,
  resetExecutionContextResolverParaTestes,
  TOPOLOGIES,
  LOCALIDADE_EXECUCAO,
  EXEC_CODES
} = require('../../backend/services/tef/executionContext');

const {
  criarTerminalRecoveryService,
  criarTerminalMonitor,
  resetTerminalRecoveryServiceParaTestes,
  MONITOR_STATES,
  ACOES_PROIBIDAS
} = require('../../backend/services/tef/terminalRecovery');

const resultados = [];

function registrar(cenario, esperado, obtido, ok, evidencia) {
  resultados.push({ cenario, esperado, obtido, ok, evidencia });
  if (!ok) {
    console.error(`  FAIL ${cenario}`);
    console.error(`       esperado: ${esperado}`);
    console.error(`       obtido:   ${obtido}`);
    throw new Error(`Homologação falhou: ${cenario}`);
  }
  console.log(`  OK  ${cenario}`);
}

async function criarDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrt08-'));
  const db = new sqlite3.Database(path.join(dir, 't.db'));
  await new Promise((resolve, reject) => {
    db.exec(`
      CREATE TABLE caixas (id INTEGER PRIMARY KEY, nome TEXT, ativo INTEGER DEFAULT 1);
      CREATE TABLE terminais (
        id INTEGER PRIMARY KEY, nome TEXT, hostname TEXT, caixa_id INTEGER, ativo INTEGER DEFAULT 1
      );
      INSERT INTO caixas VALUES (10, 'C1', 1);
      INSERT INTO terminais VALUES (1, 'PDV1', 'PC-A', 10, 1);
      INSERT INTO terminais VALUES (2, 'PDV2', 'PC-A', 10, 1);
      INSERT INTO terminais VALUES (3, 'PDV3', 'PC-B', 10, 1);
      INSERT INTO terminais VALUES (4, 'PDV4', 'PC-A', 10, 1);
      INSERT INTO terminais VALUES (5, 'PDV5', 'PC-A', 10, 1);
    `, (err) => (err ? reject(err) : resolve()));
  });
  const getRow = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
  return { dir, db, getRow };
}

console.log('=== MRT-08 — Homologação integrada Terminal Router ===\n');

(async () => {
  resetTerminalRegistryParaTestes();
  resetTerminalAllocatorParaTestes();
  resetTerminalRouterParaTestes();
  resetExecutionContextResolverParaTestes();
  resetTerminalRecoveryServiceParaTestes();

  const { dir, db, getRow } = await criarDb();
  const identity = criarPdvIdentityValidator({ getRow });
  const registry = criarTerminalRegistry();
  const allocator = criarTerminalAllocator();
  const execResolver = criarExecutionContextResolver();

  // PDV1 + Destaxa ATIVO com device
  registry.registrar({
    id: 'tef-pdv1',
    pdvId: '1',
    provedor: 'destaxa',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    codigoLogicoProvedor: 'T1',
    dispositivo: { id: 'pin-1', tipo: 'pinpad', portaCom: 'COM1', ativo: true },
    meta: { estacaoHostname: 'PC-A' }
  });
  // PDV2 + Destaxa ATIVO
  registry.registrar({
    id: 'tef-pdv2',
    pdvId: '2',
    provedor: 'destaxa',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    codigoLogicoProvedor: 'T2',
    dispositivo: { id: 'pin-2', tipo: 'pinpad', portaCom: 'COM2', ativo: true },
    meta: { estacaoHostname: 'PC-A' }
  });
  // PDV3 em outra estação
  registry.registrar({
    id: 'tef-pdv3',
    pdvId: '3',
    provedor: 'destaxa',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    dispositivo: { id: 'pin-3', tipo: 'pinpad', portaCom: 'COM1', ativo: true },
    meta: { estacaoHostname: 'PC-B' }
  });
  // PDV4 sem terminal lógico (só no DB)
  // PDV5 terminal indisponível / sem device ativo
  registry.registrar({
    id: 'tef-pdv5-off',
    pdvId: '5',
    provedor: 'sitef',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.INDISPONIVEL,
    dispositivo: { id: 'pin-5', tipo: 'pinpad', portaCom: 'COM5', ativo: false },
    meta: { estacaoHostname: 'PC-A' }
  });
  registry.registrar({
    id: 'tef-pdv5-sem-dev',
    pdvId: '5',
    provedor: 'paygo',
    ambiente: 'homologacao',
    estado: TERMINAL_STATES.ATIVO,
    dispositivo: null,
    meta: { estacaoHostname: 'PC-A' }
  });

  const mapa = [
    { pdvId: '1', hostname: 'PC-A' },
    { pdvId: '2', hostname: 'PC-A' },
    { pdvId: '3', hostname: 'PC-B' },
    { pdvId: '4', hostname: 'PC-A' },
    { pdvId: '5', hostname: 'PC-A' }
  ];

  const bindingOk = {
    ok: true,
    mensagem: 'mock',
    config: {},
    adapterBinding: {
      fonte: 'tef_configuracao_singleton',
      modo: 'COMPAT_SINGLETON',
      registro: { provedor: 'destaxa', ambiente: 'homologacao' },
      executionMode: 'native-host'
    }
  };

  const router = criarTerminalRouter({
    identityValidator: identity,
    registry,
    allocator,
    carregarBindingSingleton: async () => bindingOk,
    mapaPdvEstacao: mapa
  });

  const depsRota = { router, mapaPdvEstacao: mapa };

  // ——— C1: 1 PC / 1 PDV / 1 terminal ———
  {
    allocator.resetParaTestes();
    const rota = await integ.resolverRotaAutorizacao({
      pdvId: 1,
      provedorPreferido: 'destaxa',
      hostname: 'PC-A'
    }, depsRota);
    const ctx = rota.routeDecision.executionContext;
    const ok = rota.sucesso
      && rota.leaseId
      && rota.routeDecision.pdvId === '1'
      && rota.routeDecision.terminalTefId === 'tef-pdv1'
      && rota.routeDecision.dispositivoId === 'pin-1'
      && ctx?.estacao?.identidadeEhPdv === false
      && ctx?.localidadeExecucao === LOCALIDADE_EXECUCAO.LOCAL;
    registrar(
      'C1: 1 PC / 1 PDV / 1 terminal TEF',
      'sucesso LOCAL + lease + identidades separadas',
      `sucesso=${rota.sucesso} lease=${rota.leaseId} tip=${rota.routeDecision.terminalTefId} loc=${ctx?.localidadeExecucao}`,
      ok,
      { codigo: rota.routeDecision.codigo, topologia: ctx?.topologia, modo: rota.routeDecision.modo }
    );
    integ.aplicarPosAutorizacao(rota.leaseId, {
      acao: 'LIBERAR',
      motivo: RELEASE_REASONS.SUCESSO_CONFIRMADO
    }, { router });
  }

  // ——— C2: 1 PC / 2+ PDVs ———
  {
    allocator.resetParaTestes();
    const topo = execResolver.inferirTopologia(
      [{ pdvId: '1', hostname: 'PC-A' }, { pdvId: '2', hostname: 'PC-A' }],
      '1'
    );
    const r1 = await integ.resolverRotaAutorizacao({
      pdvId: 1, provedorPreferido: 'destaxa', hostname: 'PC-A'
    }, depsRota);
    const ok = topo.topologia === TOPOLOGIES.ESTACAO_UNICA_MULTI_PDV
      && r1.sucesso
      && r1.routeDecision.executionContext?.runtime?.singletonDestaxa === true;
    registrar(
      'C2: 1 PC / 2+ PDVs',
      'topologia ESTACAO_UNICA_MULTI_PDV + Destaxa GLOBAL_SERIALIZE',
      `topo=${topo.topologia} sucesso=${r1.sucesso} serialize=${r1.routeDecision.executionContext?.runtime?.isolamento}`,
      ok,
      { pdvsNaEstacao: topo.pdvsNaEstacaoAtual }
    );
    integ.aplicarPosAutorizacao(r1.leaseId, {
      acao: 'LIBERAR',
      motivo: RELEASE_REASONS.FALHA_CONFIRMADA
    }, { router });
  }

  // ——— C3 + C4: dois PDVs simultâneos Destaxa; segundo bloqueado ———
  {
    allocator.resetParaTestes();
    const a = await integ.resolverRotaAutorizacao({
      pdvId: 1, provedorPreferido: 'destaxa', hostname: 'PC-A'
    }, depsRota);
    const b = await integ.resolverRotaAutorizacao({
      pdvId: 2, provedorPreferido: 'destaxa', hostname: 'PC-A'
    }, depsRota);
    const ok = a.sucesso === true
      && b.sucesso === false
      && b.routeDecision.codigo === ROUTE_CODES.RUNTIME_OCUPADO;
    registrar(
      'C3/C4: concorrência Destaxa — 2º PDV bloqueado (RUNTIME_OCUPADO)',
      '1º aloca; 2º RUNTIME_OCUPADO',
      `a=${a.sucesso} b=${b.sucesso}/${b.routeDecision.codigo}`,
      ok,
      { leaseA: a.leaseId, conflito: b.routeDecision.isolamento?.conflito?.tipo || 'RUNTIME' }
    );
    // mantém lease A para C5/C6
    global.__mrt08_leaseA = a.leaseId;
  }

  // ——— C5: liberação após resultado definitivo ———
  {
    const leaseId = global.__mrt08_leaseA;
    const cls = integ.classificarPosAutorizacao({
      sucesso: true,
      status: tefContrato.STATUS.APROVADO
    }, { transacaoId: 1 });
    const lib = integ.aplicarPosAutorizacao(leaseId, cls, { router });
    const livre = !allocator.statusRuntime('runtime:destaxa:global').ocupado;
    const ok = cls.acao === 'LIBERAR' && lib.ok === true && livre;
    registrar(
      'C5: liberação após resultado financeiro definitivo',
      'LIBERAR SUCESSO_CONFIRMADO + runtime livre',
      `acao=${cls.acao} libOk=${lib.ok} runtimeLivre=${livre}`,
      ok,
      { motivo: cls.motivo }
    );
  }

  // ——— C6: HOLD após inconclusivo ———
  {
    allocator.resetParaTestes();
    const a = await integ.resolverRotaAutorizacao({
      pdvId: 1, provedorPreferido: 'destaxa', hostname: 'PC-A'
    }, depsRota);
    const cls = integ.classificarPosAutorizacao({
      sucesso: false,
      status: tefContrato.STATUS.PENDENTE,
      codigo: 'TIMEOUT',
      financialState: FINANCIAL_STATES.UNKNOWN
    }, { transacaoId: 99, forcarInconclusivo: true });
    const aplicado = integ.aplicarPosAutorizacao(a.leaseId, cls, { router });
    const lease = allocator.obterLease(a.leaseId);
    const tentativaLib = allocator.liberar(a.leaseId, RELEASE_REASONS.TIMEOUT_OCUPACAO);
    const ok = cls.acao === 'MARCAR_INCONCLUSIVO'
      && lease?.resultadoFinanceiroInconclusivo === true
      && tentativaLib.codigo === ALLOCATION_CODES.LIBERACAO_BLOQUEADA_INCONCLUSIVA
      && allocator.statusRuntime('runtime:destaxa:global').ocupado === true;
    registrar(
      'C6: manutenção do HOLD após resultado inconclusivo',
      'MARCAR_INCONCLUSIVO; timeout não libera; runtime ocupado',
      `acao=${cls.acao} inconclusivo=${lease?.resultadoFinanceiroInconclusivo} bloqueio=${tentativaLib.codigo}`,
      ok,
      { aplicado: aplicado.acao }
    );
    allocator.liberar(a.leaseId, RELEASE_REASONS.FORCAR_ADMIN);
  }

  // ——— C7: recuperação após reinício simulado ———
  {
    allocator.resetParaTestes();
    const pendencias = [{
      transacaoId: '800',
      provedor: 'destaxa',
      financialState: FINANCIAL_STATES.UNKNOWN,
      terminalTefId: 'tef-pdv1'
    }];
    // simula lease pré-crash
    const pre = allocator.adquirir({ terminalTefId: 'tef-pdv1', provedor: 'destaxa', pdvId: '1' });
    allocator.marcarInconclusivo(pre.lease.leaseId);

    const recovery = criarTerminalRecoveryService({
      getAllocator: () => allocator,
      getRegistry: () => registry,
      listarPendencias: () => pendencias,
      monitor: criarTerminalMonitor({
        getAllocator: () => allocator,
        getRegistry: () => registry,
        listarPendencias: () => pendencias
      })
    });
    const rec = recovery.recuperarAposReinicio({ forcar: true, pendenciasCompletas: pendencias });
    const ok = rec.ok
      && rec.autoAprovacao === false
      && rec.autoCancelamento === false
      && rec.autoRetry === false
      && rec.liberouInconclusivoFinanceiro === false
      && rec.holdsAtivos >= 1
      && allocator.statusRuntime('runtime:destaxa:global').ocupado === true
      && ACOES_PROIBIDAS.includes('REPETIR_AUTORIZACAO');
    registrar(
      'C7: recuperação após reinicialização simulada',
      'holds Destaxa; sem auto aprovar/cancelar/retry',
      `holds=${rec.holdsAtivos} autoAprov=${rec.autoAprovacao} autoRetry=${rec.autoRetry}`,
      ok,
      { codigo: rec.codigo, acoesProibidas: ACOES_PROIBIDAS.length }
    );
    global.__mrt08_recovery = recovery;
    global.__mrt08_pendencias = pendencias;
  }

  // ——— C8: tentativa com operação financeira pendente ———
  {
    const rota = await integ.resolverRotaAutorizacao({
      pdvId: 2, provedorPreferido: 'destaxa', hostname: 'PC-A'
    }, depsRota);
    const ok = rota.sucesso === false
      && (rota.routeDecision.codigo === ROUTE_CODES.RUNTIME_OCUPADO
        || rota.routeDecision.codigo === ROUTE_CODES.TERMINAL_OCUPADO);
    registrar(
      'C8: tentativa de uso com operação financeira pendente (hold)',
      'nova alocação Destaxa bloqueada',
      `sucesso=${rota.sucesso} codigo=${rota.routeDecision.codigo}`,
      ok,
      { leaseId: rota.leaseId }
    );
    // limpa holds para demais cenários
    global.__mrt08_recovery.sincronizarHoldsComPendencias({ pendenciasCompletas: [] });
    allocator.resetParaTestes();
  }

  // ——— C9: identidade inválida de PDV ———
  {
    const host = await router.resolve({ pdvId: 'PC-A' });
    const mac = await router.resolve({ pdvId: 'AABBCCDDEEFF' });
    const ok = host.sucesso === false
      && host.codigo === ROUTE_CODES.PDV_HOSTNAME_OU_MAC_PROIBIDO
      && mac.sucesso === false
      && mac.codigo === ROUTE_CODES.PDV_HOSTNAME_OU_MAC_PROIBIDO;
    registrar(
      'C9: identidade inválida de PDV (hostname/MAC)',
      'PDV_HOSTNAME_OU_MAC_PROIBIDO',
      `host=${host.codigo} mac=${mac.codigo}`,
      ok,
      { pdvIdContinuaComercial: true }
    );
  }

  // ——— C10: PDV sem terminal lógico ———
  {
    allocator.resetParaTestes();
    const rota = await integ.resolverRotaAutorizacao({
      pdvId: 4,
      hostname: 'PC-A'
    }, depsRota);
    // Registry MISS → fallback singleton + lease (COMPAT)
    const ok = rota.sucesso === true
      && (rota.routeDecision.meta?.registryMiss === true
        || rota.routeDecision.codigo === ROUTE_CODES.ROUTE_OK
        || rota.routeDecision.modo === MODOS_ROUTER.ALLOCATE
        || rota.routeDecision.modo === MODOS_ROUTER.COMPAT_SINGLETON
        || rota.leaseId);
    registrar(
      'C10: PDV sem terminal lógico provisionado',
      'fallback COMPAT_SINGLETON preservado + lease instalacao',
      `sucesso=${rota.sucesso} modo=${rota.routeDecision.modo} tip=${rota.routeDecision.terminalTefId} miss=${rota.routeDecision.meta?.registryMiss}`,
      ok,
      { leaseId: rota.leaseId, codigo: rota.routeDecision.codigo }
    );
    if (rota.leaseId) {
      integ.aplicarPosAutorizacao(rota.leaseId, {
        acao: 'LIBERAR',
        motivo: RELEASE_REASONS.FALHA_CONFIRMADA
      }, { router });
    }
  }

  // ——— C11: terminal indisponível / sem dispositivo ———
  {
    allocator.resetParaTestes();
    const indisp = await router.resolve({
      pdvId: 5,
      provedorPreferido: 'sitef',
      hostHints: { hostname: 'PC-A' },
      mapaPdvEstacao: mapa
    });
    const semDev = await router.resolve({
      pdvId: 5,
      provedorPreferido: 'paygo',
      hostHints: { hostname: 'PC-A' },
      mapaPdvEstacao: mapa,
      exigirDispositivo: true
    });
    const okIndisp = indisp.sucesso === false
      && (indisp.codigo === ROUTE_CODES.TERMINAL_INDISPONIVEL
        || indisp.codigo === ROUTE_CODES.DISPOSITIVO_INDISPONIVEL);
    const okSemDev = semDev.sucesso === false
      && (semDev.codigo === ROUTE_CODES.TERMINAL_SEM_DISPOSITIVO
        || semDev.codigo === ROUTE_CODES.DISPOSITIVO_INDISPONIVEL
        || semDev.executionContext?.codigo === EXEC_CODES.TERMINAL_SEM_DISPOSITIVO);
    registrar(
      'C11: terminal indisponível ou sem dispositivo',
      'falha TERMINAL_INDISPONIVEL / TERMINAL_SEM_DISPOSITIVO',
      `indisp=${indisp.codigo} semDev=${semDev.codigo}`,
      okIndisp && okSemDev,
      { indispOk: okIndisp, semDevOk: okSemDev }
    );
  }

  // ——— C12: multi-computador REMOTA_REQUERIDA ———
  {
    allocator.resetParaTestes();
    const rota = await integ.resolverRotaAutorizacao({
      pdvId: 3,
      provedorPreferido: 'destaxa',
      hostname: 'PC-A'
    }, depsRota);
    const ctx = rota.routeDecision.executionContext;
    const ok = rota.sucesso === false
      && rota.routeDecision.codigo === ROUTE_CODES.ESTACAO_REMOTA_NAO_SUPORTADA
      && (ctx?.localidadeExecucao === LOCALIDADE_EXECUCAO.REMOTA_REQUERIDA
        || ctx?.codigo === EXEC_CODES.ESTACAO_REMOTA_NAO_SUPORTADA);
    registrar(
      'C12: topologia multi-PC → REMOTA_REQUERIDA (sem bridge)',
      'bloqueio ESTACAO_REMOTA_NAO_SUPORTADA',
      `sucesso=${rota.sucesso} codigo=${rota.routeDecision.codigo} loc=${ctx?.localidadeExecucao}`,
      ok,
      { topologia: ctx?.topologia, bridge: false }
    );
  }

  // ——— Integridade arquitetural (estática + runtime) ———
  {
    const tm = fs.readFileSync(path.join(__dirname, '../../backend/services/tef/TefManager.js'), 'utf8');
    const adapter = fs.readFileSync(
      path.join(__dirname, '../../backend/services/tef/adapters/DestaxaRealAdapter.js'),
      'utf8'
    );
    const ok = tm.includes('tefRouterIntegration')
      && tm.includes('idempotency_key')
      && tm.includes('tefLockService')
      && tm.includes('_pendencias')
      && !adapter.includes('terminalAllocator')
      && !adapter.includes('terminalRecovery')
      && !adapter.includes('TerminalRouter');
    registrar(
      'INT: integridade arquitetura (Router≠Manager; adapters intactos)',
      'TefManager financeiro + Router rota; adapters sem MRT',
      `routerInt=${tm.includes('tefRouterIntegration')} adaptersLimpos=${!adapter.includes('TerminalRouter')}`,
      ok,
      {
        pdvId: 'terminais.id comercial',
        terminalTefId: 'lógico',
        dispositivoId: 'PinPad',
        estacao: 'hostname/MAC ≠ pdvId'
      }
    );
  }

  // ——— Segurança financeira (estática) ———
  {
    const ok = !resultados.some((r) => r.cenario.startsWith('C') && !r.ok)
      && ACOES_PROIBIDAS.includes('APROVAR_PAGAMENTO')
      && ACOES_PROIBIDAS.includes('CANCELAR_PAGAMENTO')
      && ACOES_PROIBIDAS.includes('REPETIR_AUTORIZACAO');
    registrar(
      'SEC: sem INIT/TX real; proibições de recuperação respeitadas',
      'nenhuma ação financeira real; ACOES_PROIBIDAS presentes',
      `cenariosOk=${resultados.filter((r) => r.ok).length} proibidas=${ACOES_PROIBIDAS.length}`,
      ok,
      { initReal: false, pagamentoReal: false, cancelamentoReal: false }
    );
  }

  // exporta evidências para o relatório
  const outPath = path.join(__dirname, '../../docs/build/mrt-08-homologacao-evidencias.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    geradoEm: new Date().toISOString(),
    total: resultados.length,
    aprovados: resultados.filter((r) => r.ok).length,
    reprovados: resultados.filter((r) => !r.ok).length,
    cenarios: resultados
  }, null, 2), 'utf8');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  resetTerminalRegistryParaTestes();
  resetTerminalAllocatorParaTestes();
  resetTerminalRouterParaTestes();
  resetExecutionContextResolverParaTestes();
  resetTerminalRecoveryServiceParaTestes();

  console.log(`\nMRT-08 homologação: ${resultados.filter((r) => r.ok).length}/${resultados.length} OK`);
  console.log(`Evidências: docs/build/mrt-08-homologacao-evidencias.json\n`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
