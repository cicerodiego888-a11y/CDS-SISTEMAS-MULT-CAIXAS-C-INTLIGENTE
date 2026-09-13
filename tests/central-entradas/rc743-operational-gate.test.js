/**
 * RC7.4.3 — Gate Operacional Enterprise + Circuit Breaker + cooldown progressivo.
 */

const assert = require('assert');
const {
  CentralSefazOperationalGate,
  COOLDOWN_656_MINUTOS,
  calcularCooldown656Ms,
  ESTADO_OPERACIONAL,
  HISTORICO_MAX
} = require('../../backend/motores/central-entradas/services/CentralSefazOperationalGate');
const {
  CentralXmlWaitScheduler
} = require('../../backend/motores/central-entradas/services/CentralXmlWaitScheduler');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../../backend/motores/central-entradas/core/DocumentoDfeTipo');
const CentralDashboardDTO = require('../../backend/motores/central-entradas/contracts/CentralDashboardDTO');

function criarRepoConfig() {
  const store = new Map();
  return {
    async buscarPorChave(chave) {
      if (!store.has(chave)) return null;
      return { chave, valor: store.get(chave), tipo: 'json' };
    },
    parseValor(registro) {
      if (!registro) return null;
      return typeof registro.valor === 'string' ? JSON.parse(registro.valor) : registro.valor;
    },
    async salvar(chave, valor) {
      store.set(chave, valor);
      return { chave, valor };
    },
    _store: store
  };
}

function criarRepoDocs(docs) {
  const map = new Map(docs.map((d) => [d.id, { ...d }]));
  return {
    async listarPorStatus(status) {
      return [...map.values()].filter((d) => d.status === status);
    },
    async buscarPorId(id) {
      return map.get(Number(id)) || null;
    },
    _map: map
  };
}

function criarGate(opts = {}) {
  const config = opts.config || criarRepoConfig();
  const fingerprint = { atual: opts.fingerprint || 'cnpjA|certA|ser|tp' };
  const agora = opts.agora || { t: new Date('2026-07-19T12:00:00.000Z') };
  const gate = new CentralSefazOperationalGate({
    configRepository: config,
    agora: () => (agora.t instanceof Date ? agora.t : agora),
    autoPersist: false,
    obterFingerprintConfig: async () => fingerprint.atual,
    obterFingerprintDetalhado: async () => ({
      fingerprint: fingerprint.atual,
      cnpjCertificado: '22222222000122',
      path: '/certs/a.pfx',
      serial: 'ABC',
      thumbprint: 'TP',
      validade: '2027-01-01T00:00:00.000Z'
    })
  });
  return { gate, config, fingerprint, agora };
}

async function caso138() {
  const { gate } = criarGate();
  const r = await gate.processarRespostaSefaz({ cStat: '138' }, { correlationId: 'c138' });
  assert.strictEqual(r.acao, 'continuar');
  assert.strictEqual(gate.obterEstadoOperacional().codigo, ESTADO_OPERACIONAL.NORMAL);
  assert.strictEqual(gate.obterTelemetria().contagem138, 1);
}

async function caso137() {
  const { gate } = criarGate();
  const r = await gate.processarRespostaSefaz({ cStat: '137' }, { correlationId: 'c137' });
  assert.strictEqual(r.acao, 'backoff');
  assert.strictEqual(gate.obterEstadoOperacional().codigo, ESTADO_OPERACIONAL.WARNING);
  assert.strictEqual(gate.estaBloqueado656(), false);
}

async function casoCooldownProgressivo656() {
  const { gate, agora } = criarGate();
  assert.deepStrictEqual([...COOLDOWN_656_MINUTOS], [10, 20, 40, 60, 120]);

  for (let i = 1; i <= 5; i += 1) {
    if (gate.estaBloqueado656()) {
      agora.t = new Date(agora.t.getTime() + gate.obterBloqueio656().intervaloMs + 1000);
      assert.strictEqual(gate.estaBloqueado656(), false);
    }
    await gate.processarRespostaSefaz({ cStat: '656' }, { correlationId: `c656-${i}` });
    assert.strictEqual(gate.estaBloqueado656(), true);
    assert.strictEqual(gate.obterContador656(), i);
    assert.strictEqual(gate.obterBloqueio656().intervaloMs, calcularCooldown656Ms(i));
    assert.strictEqual(gate.obterEstadoOperacional().codigo, ESTADO_OPERACIONAL.BLOCKED);
  }
}

async function casoResetContadorAposSucesso() {
  const { gate, agora } = criarGate();
  await gate.processarRespostaSefaz({ cStat: '656' }, { correlationId: 'r1' });
  assert.strictEqual(gate.obterContador656(), 1);
  agora.t = new Date(agora.t.getTime() + calcularCooldown656Ms(1) + 1000);
  assert.strictEqual(gate.obterEstadoOperacional().codigo, ESTADO_OPERACIONAL.RECOVERING);
  await gate.processarRespostaSefaz({ cStat: '138' }, { correlationId: 'ok' });
  assert.strictEqual(gate.obterContador656(), 0);
  assert.strictEqual(gate.obterEstadoOperacional().codigo, ESTADO_OPERACIONAL.NORMAL);

  // próximo 656 volta ao 1º patamar (10 min)
  await gate.processarRespostaSefaz({ cStat: '656' }, { correlationId: 'r2' });
  assert.strictEqual(gate.obterContador656(), 1);
  assert.strictEqual(gate.obterBloqueio656().intervaloMs, calcularCooldown656Ms(1));
}

async function caso593ConfigError() {
  const { gate, fingerprint } = criarGate();
  await gate.processarRespostaSefaz({
    cStat: '593',
    cnpjXml: '11111111000111'
  }, { correlationId: 'c593' });
  assert.strictEqual(gate.obterEstadoOperacional().codigo, ESTADO_OPERACIONAL.CONFIG_ERROR);
  const e = gate.obterEstado593();
  assert.ok(e.fingerprint);
  assert.ok(e.path || e.thumbprint || e.serial);

  const auth = await gate.autorizarConsultaDistDfe({ forcar: true });
  assert.strictEqual(auth.permitido, false);

  fingerprint.atual = 'cnpjB|certB|ser2|tp2';
  const auth2 = await gate.autorizarConsultaDistDfe({ correlationId: 'fix' });
  assert.strictEqual(auth2.permitido, true);
  assert.strictEqual(gate.obterEstadoOperacional().codigo, ESTADO_OPERACIONAL.NORMAL);
}

async function casoHistoricoCircular() {
  const { gate } = criarGate();
  for (let i = 0; i < HISTORICO_MAX + 25; i += 1) {
    await gate.processarRespostaSefaz({ cStat: '137' }, { correlationId: `h-${i}`, documentoId: i });
  }
  const hist = gate.obterHistorico();
  assert.strictEqual(hist.length, HISTORICO_MAX);
  assert.ok(hist[0].correlationId);
  assert.ok(hist[0].timestamp);
}

async function casoReinicio() {
  const config = criarRepoConfig();
  const { gate: g1, agora } = criarGate({ config });
  await g1.processarRespostaSefaz({ cStat: '656' }, { correlationId: 'boot' });
  const payload = g1.serializar();
  await config.salvar('xml_wait_scheduler_state', {
    atualizadoEm: agora.t.toISOString(),
    ...payload
  }, 'json');

  const g3 = new CentralSefazOperationalGate({
    configRepository: config,
    agora: () => agora.t,
    autoPersist: false,
    obterFingerprintConfig: async () => 'cnpjA|certA|ser|tp'
  });
  await g3.autorizarConsultaDistDfe({ correlationId: 'check' });
  assert.strictEqual(g3.estaBloqueado656(), true);
  assert.ok(g3.obterContador656() >= 1);
  assert.ok(g3.serializar().historico.length >= 1);
}

async function casoDashboardTelemetria() {
  const { gate } = criarGate();
  await gate.processarRespostaSefaz({ cStat: '138', tempoMs: 120 }, { tempoSoapMs: 120 });
  gate.processarErroInterno('TIMEOUT', { correlationId: 't1' });
  const painel = gate.obterPainelOperacional();
  assert.strictEqual(painel.titulo, 'SEFAZ OPERACIONAL');
  assert.ok(painel.estadoOperacional);
  assert.ok(painel.consultasSOAP >= 1);
  assert.ok(painel.errosInternosCds.TIMEOUT >= 1);
  assert.ok(painel.errosOperacionaisSefaz['138'] >= 1);

  const dto = CentralDashboardDTO.create({
    contadores: {},
    sefazOperacional: painel,
    xmlWait: { painelOperacional: painel }
  }).toJSON();
  assert.ok(dto.sefazOperacional);
  assert.strictEqual(dto.sefazOperacional.titulo, 'SEFAZ OPERACIONAL');
}

async function casoXmlWaitIntegrado() {
  const docs = criarRepoDocs([{
    id: 1,
    chave: '1'.padStart(44, '1'),
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE,
    nsu: '1'
  }]);
  const { gate, agora, config } = criarGate();
  const svc = new CentralXmlWaitScheduler({
    documentosRepository: docs,
    configRepository: config,
    agora: () => agora.t,
    gate,
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() {
        return { xmlCompleto: false, cStat: '656' };
      }
    })
  });
  gate.vincularPersistencia(() => { svc._persistirEstado().catch(() => {}); });
  await svc.recuperarPendentes();
  svc._docs.get(1).proximaEm = new Date(agora.t.getTime() - 1000).toISOString();
  await svc._processarDocumento(svc._docs.get(1), 'x');
  assert.strictEqual(gate.estaBloqueado656(), true);
  assert.strictEqual(calcularCooldown656Ms(1), 10 * 60 * 1000);
  svc.parar({ motivo: 'teste' });
}

(async () => {
  await caso138();
  await caso137();
  await casoCooldownProgressivo656();
  await casoResetContadorAposSucesso();
  await caso593ConfigError();
  await casoHistoricoCircular();
  await casoReinicio();
  await casoDashboardTelemetria();
  await casoXmlWaitIntegrado();
  console.log('RC7.4.3 operational gate OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
