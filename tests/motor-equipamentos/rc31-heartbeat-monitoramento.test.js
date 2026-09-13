/**
 * RC3.1 — Monitoramento Inteligente (Heartbeat)
 * Executar: node tests/motor-equipamentos/rc31-heartbeat-monitoramento.test.js
 */

const assert = require('assert');
const {
  HB_STATUS,
  resolverStatusHeartbeat,
  mapearParaStatusEquipamento
} = require('../../backend/motores/equipamentos/monitor/HeartbeatStatus');
const { calcularHealthScoreHeartbeat } = require('../../backend/motores/equipamentos/monitor/HeartbeatHealth');
const { obterPerfilHeartbeat, TIPO_TESTE } = require('../../backend/motores/equipamentos/monitor/HeartbeatProfile');
const heartbeatEngine = require('../../backend/motores/equipamentos/monitor/HeartbeatEngine');
const hbRepo = require('../../backend/motores/equipamentos/monitor/HeartbeatRepository');
const equipamentosService = require('../../backend/motores/equipamentos/services/EquipamentosService');

let passou = 0;
let falhou = 0;
let equipamentoId = null;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.stack || error.message}`);
    });
}

function probeOk(latencia = 40) {
  return {
    sucesso: true,
    timeout: false,
    latencia_ms: latencia,
    erro: null,
    tipo_teste: TIPO_TESTE.TCP_CONNECT,
    comunicacao_real: true
  };
}

function probeFail(opts = {}) {
  return {
    sucesso: false,
    timeout: !!opts.timeout,
    latencia_ms: opts.latencia_ms ?? 3000,
    erro: opts.erro || (opts.timeout ? 'timeout' : 'connection refused'),
    tipo_teste: TIPO_TESTE.TCP_CONNECT,
    comunicacao_real: true
  };
}

async function main() {
  console.log('\n=== RC3.1 — Heartbeat / Monitoramento ===\n');

  await test('status heartbeat padronizados', () => {
    for (const s of ['ONLINE', 'OFFLINE', 'INSTAVEL', 'SEM_RESPOSTA', 'SEM_COMUNICACAO']) {
      assert.ok(HB_STATUS[s]);
    }
    assert.strictEqual(mapearParaStatusEquipamento(HB_STATUS.ONLINE), 'online');
    assert.strictEqual(mapearParaStatusEquipamento(HB_STATUS.SEM_RESPOSTA), 'offline');
  });

  await test('resolverStatus — timeout e queda', () => {
    assert.strictEqual(
      resolverStatusHeartbeat({ sucesso: false, timeout: true, falhasConsecutivas: 1 }),
      HB_STATUS.SEM_RESPOSTA
    );
    assert.strictEqual(
      resolverStatusHeartbeat({ sucesso: false, timeout: true, falhasConsecutivas: 3 }),
      HB_STATUS.SEM_COMUNICACAO
    );
    assert.strictEqual(
      resolverStatusHeartbeat({ sucesso: false, timeout: false, falhasConsecutivas: 1, historicoRecente: ['fail'] }),
      HB_STATUS.OFFLINE
    );
  });

  await test('resolverStatus — retorno online e instável', () => {
    assert.strictEqual(
      resolverStatusHeartbeat({ sucesso: true, falhasConsecutivas: 0, historicoRecente: ['ok'] }),
      HB_STATUS.ONLINE
    );
    assert.strictEqual(
      resolverStatusHeartbeat({
        sucesso: true,
        falhasConsecutivas: 0,
        historicoRecente: ['ok', 'fail', 'ok']
      }),
      HB_STATUS.INSTAVEL
    );
  });

  await test('Health Score — latência e falhas', () => {
    const bom = calcularHealthScoreHeartbeat({
      status: HB_STATUS.ONLINE,
      latencia_ms: 50,
      falhas_consecutivas: 0,
      total_sucessos: 20,
      total_falhas: 0
    });
    assert.ok(bom.score >= 90, `score bom=${bom.score}`);

    const lento = calcularHealthScoreHeartbeat({
      status: HB_STATUS.ONLINE,
      latencia_ms: 2500,
      falhas_consecutivas: 0,
      total_sucessos: 10,
      total_falhas: 0
    });
    assert.ok(lento.score < bom.score);

    const falhas = calcularHealthScoreHeartbeat({
      status: HB_STATUS.SEM_COMUNICACAO,
      falhas_consecutivas: 5,
      total_sucessos: 1,
      total_falhas: 10
    });
    assert.ok(falhas.score <= 40);
  });

  await test('perfil heartbeat por transporte', () => {
    const eth = obterPerfilHeartbeat({ transporte: 'ethernet' });
    assert.strictEqual(eth.tipo_teste, TIPO_TESTE.TCP_CONNECT);
    const ser = obterPerfilHeartbeat({ transporte: 'serial' });
    assert.strictEqual(ser.tipo_teste, TIPO_TESTE.HANDSHAKE);
  });

  await test('criar equipamento de teste', async () => {
    const eq = await equipamentosService.criar({
      nome: `HB RC31 ${Date.now()}`,
      tipo: 'balanca',
      transporte: 'ethernet',
      ip: '127.0.0.1',
      porta_tcp: 19999,
      timeout_ms: 1000,
      fabricante: 'Teste',
      modelo: 'Heartbeat',
      driver_codigo: 'GENERIC_SERIAL',
      ativo: true
    });
    assert.ok(eq.id);
    equipamentoId = eq.id;
  });

  await test('queda — muda status e gera evento CAIU', async () => {
    heartbeatEngine.setProbeFn(async () => probeOk(30));
    await heartbeatEngine.executarParaEquipamento(equipamentoId);
    let estado = await hbRepo.buscarPorEquipamento(equipamentoId);
    assert.strictEqual(estado.status, HB_STATUS.ONLINE);

    heartbeatEngine.setProbeFn(async () => probeFail({ erro: 'ECONNREFUSED' }));
    const r = await heartbeatEngine.executarParaEquipamento(equipamentoId);
    assert.ok([HB_STATUS.OFFLINE, HB_STATUS.INSTAVEL].includes(r.status_novo));
    const eventos = await hbRepo.listarEventos(equipamentoId, 20);
    assert.ok(eventos.some((e) => e.evento === 'EQUIPAMENTO_CAIU' || e.evento === 'STATUS_ALTERADO'));
  });

  await test('retorno — EQUIPAMENTO_VOLTOU', async () => {
    heartbeatEngine.setProbeFn(async () => probeFail());
    await heartbeatEngine.executarParaEquipamento(equipamentoId);
    await heartbeatEngine.executarParaEquipamento(equipamentoId);

    heartbeatEngine.setProbeFn(async () => probeOk(55));
    const r = await heartbeatEngine.executarParaEquipamento(equipamentoId);
    assert.ok(ehOnline(r.status_novo));
    const eventos = await hbRepo.listarEventos(equipamentoId, 30);
    assert.ok(eventos.some((e) => e.evento === 'EQUIPAMENTO_VOLTOU'));
  });

  await test('latência registrada no estado', async () => {
    await hbRepo.upsertEstado(equipamentoId, {
      status: HB_STATUS.ONLINE,
      falhas_consecutivas: 0,
      historico_recente: ['ok', 'ok', 'ok'],
      total_sucessos: 10,
      total_falhas: 0,
      mudancas_24h: 0
    });
    heartbeatEngine.setProbeFn(async () => probeOk(123));
    const r = await heartbeatEngine.executarParaEquipamento(equipamentoId);
    assert.strictEqual(r.estado.latencia_ms, 123);
    assert.ok(typeof r.health.score === 'number');
    assert.ok(r.health.score >= 70, `health=${r.health.score} fatores=${r.health.fatores}`);
  });

  await test('timeout → SEM_RESPOSTA / SEM_COMUNICACAO', async () => {
    heartbeatEngine.setProbeFn(async () => probeFail({ timeout: true }));
    await hbRepo.upsertEstado(equipamentoId, {
      status: HB_STATUS.ONLINE,
      falhas_consecutivas: 0,
      historico_recente: ['ok'],
      total_sucessos: 5,
      total_falhas: 0
    });
    const r1 = await heartbeatEngine.executarParaEquipamento(equipamentoId);
    assert.strictEqual(r1.status_novo, HB_STATUS.SEM_RESPOSTA);

    const r2 = await heartbeatEngine.executarParaEquipamento(equipamentoId);
    const r3 = await heartbeatEngine.executarParaEquipamento(equipamentoId);
    assert.strictEqual(r3.status_novo, HB_STATUS.SEM_COMUNICACAO);
    const eventos = await hbRepo.listarEventos(equipamentoId, 40);
    assert.ok(eventos.some((e) => e.evento === 'PERDA_COMUNICACAO'));
  });

  await test('mudança de status e health API', async () => {
    const saude = await heartbeatEngine.obterSaude(equipamentoId);
    assert.ok(typeof saude.score === 'number');
    assert.ok(saude.rotulo);
    const dash = await heartbeatEngine.obterDashboard();
    assert.ok(typeof dash.total === 'number');
  });

  await test('fila — processarProximo não explode', async () => {
    heartbeatEngine.setProbeFn(async () => probeOk(20));
    await hbRepo.enfileirar(equipamentoId, new Date(Date.now() - 1000).toISOString());
    const out = await heartbeatEngine.processarProximo();
    assert.ok(out.processado === true || out.processado === false);
  });

  heartbeatEngine.setProbeFn(null);

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

function ehOnline(status) {
  return status === HB_STATUS.ONLINE || status === HB_STATUS.INSTAVEL;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
