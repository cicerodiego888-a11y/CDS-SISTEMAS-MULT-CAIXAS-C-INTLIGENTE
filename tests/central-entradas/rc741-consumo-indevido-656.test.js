/**
 * RC7.4.1 — Proteção cStat 656 (consumo indevido).
 */

const assert = require('assert');
const {
  CentralXmlWaitScheduler,
  INTERVALO_BLOQUEIO_656_MS,
  calcularCooldown656Ms
} = require('../../backend/motores/central-entradas/services/CentralXmlWaitScheduler');
const {
  CentralSefazOperationalGate
} = require('../../backend/motores/central-entradas/services/CentralSefazOperationalGate');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../../backend/motores/central-entradas/core/DocumentoDfeTipo');

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

function criarSvc(opts = {}) {
  const config = opts.config || criarRepoConfig();
  const gate = new CentralSefazOperationalGate({
    configRepository: config,
    agora: opts.agora || (() => new Date('2026-07-18T20:00:00.000Z')),
    autoPersist: false
  });
  const svc = new CentralXmlWaitScheduler({
    documentosRepository: opts.docs || criarRepoDocs([]),
    configRepository: config,
    tickMs: 20,
    agora: opts.agora || (() => new Date('2026-07-18T20:00:00.000Z')),
    obterOrchestrator: opts.obterOrchestrator || (() => ({
      async processarCicloDfeDocumento() { return {}; }
    })),
    gate
  });
  gate.vincularPersistencia(() => { svc._persistirEstado().catch(() => {}); });
  return svc;
}

async function caso1Bloqueio656() {
  let consultas = 0;
  const agora = { t: new Date('2026-07-18T20:00:00.000Z') };
  const docs = criarRepoDocs([{
    id: 1,
    chave: '23260725757840006327550010010248001140985160',
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE,
    nsu: '11'
  }]);
  const svc = criarSvc({
    docs,
    agora: () => agora.t,
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() {
        consultas += 1;
        return { xmlCompleto: false, cStat: '656' };
      }
    })
  });

  await svc.recuperarPendentes();
  svc._docs.get(1).proximaEm = new Date(agora.t.getTime() - 1000).toISOString();
  svc._ativo = true;
  await svc._processarDocumento(svc._docs.get(1), 'c1');
  assert.strictEqual(consultas, 1);
  assert.strictEqual(svc.estaBloqueadoDistDfe(), true);
  assert.strictEqual(calcularCooldown656Ms(1), 10 * 60 * 1000);
  assert.ok(INTERVALO_BLOQUEIO_656_MS >= calcularCooldown656Ms(1));

  await svc._processarDocumento(svc._docs.get(1), 'c1b');
  assert.strictEqual(consultas, 1, 'não deve consultar durante bloqueio');
  assert.ok(svc.obterTelemetria().consultasEvitadas656 >= 1
    || svc.obterTelemetria().consultasEvitadas >= 1);

  agora.t = new Date(agora.t.getTime() + calcularCooldown656Ms(1) + 1000);
  assert.strictEqual(svc.estaBloqueadoDistDfe(), false);
  svc._docs.get(1).proximaEm = new Date(agora.t.getTime() - 1000).toISOString();
  svc._obterOrchestrator = () => ({
    async processarCicloDfeDocumento() {
      consultas += 1;
      return { xmlCompleto: false, cStat: '137' };
    }
  });
  await svc._processarDocumento(svc._docs.get(1), 'c1c');
  assert.strictEqual(consultas, 2, 'deve consultar após desbloqueio');
  svc.parar({ motivo: 'teste' });
}

async function caso2UploadLimpaBloqueio() {
  const svc = criarSvc({
    agora: () => new Date('2026-07-18T21:00:00.000Z')
  });
  svc.registrarBloqueio656({ correlationId: 'x', documentoId: 9 });
  assert.strictEqual(svc.estaBloqueadoDistDfe(), true);
  svc.cancelar(9, 'upload');
  assert.strictEqual(svc.estaBloqueadoDistDfe(), false);
  svc.limparBloqueio656('upload');
}

async function caso3ReinicioRecuperaBloqueio() {
  const config = criarRepoConfig();
  const agora = new Date('2026-07-18T22:00:00.000Z');
  const svc1 = criarSvc({
    config,
    docs: criarRepoDocs([{
      id: 5,
      chave: '1'.padStart(44, '1'),
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      nsu: '1'
    }]),
    agora: () => agora,
    obterOrchestrator: () => ({ async processarCicloDfeDocumento() { return { cStat: '656' }; } })
  });
  await svc1.recuperarPendentes();
  svc1.registrarBloqueio656({ documentoId: 5, chave: '1'.padStart(44, '1'), nsu: '1' });
  await svc1._persistirEstado();

  const svc2 = criarSvc({
    config,
    docs: criarRepoDocs([{
      id: 5,
      chave: '1'.padStart(44, '1'),
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      nsu: '1'
    }]),
    agora: () => agora
  });
  await svc2._carregarEstado();
  assert.strictEqual(svc2.estaBloqueadoDistDfe(), true);
  assert.ok(svc2.obterBloqueio656().bloqueadoAte);
}

async function caso4GateSync() {
  const CentralSyncExecucaoService = require('../../backend/motores/central-entradas/services/CentralSyncExecucaoService');
  const svc = criarSvc({
    agora: () => new Date('2026-07-18T23:00:00.000Z')
  });
  svc.registrarBloqueio656({ correlationId: 'gate' });
  assert.strictEqual(svc.estaBloqueadoDistDfe(), true);
  const skip = svc.registrarConsultaEvitada656({ correlationId: 'abrir' });
  assert.strictEqual(skip.codigo, 'BLOQUEADO_CONSUMO_INDEVIDO_656');
  assert.ok(CentralSyncExecucaoService);
}

(async () => {
  await caso1Bloqueio656();
  await caso2UploadLimpaBloqueio();
  await caso3ReinicioRecuperaBloqueio();
  await caso4GateSync();
  console.log('RC7.4.1 consumo indevido 656 OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
