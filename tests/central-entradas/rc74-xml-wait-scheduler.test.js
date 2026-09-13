/**
 * RC7.4 — Testes do CentralXmlWaitScheduler (backoff, lock, cancel, sucesso).
 */

const assert = require('assert');
const {
  CentralXmlWaitScheduler,
  BACKOFF_MINUTOS,
  calcularBackoffMs
} = require('../../backend/motores/central-entradas/services/CentralXmlWaitScheduler');
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

async function testBackoff() {
  // RC3.4.1 — backoff MIRX: 5 → 15 → 30 → 60 → 120 → 240 → 480 → 1440
  assert.strictEqual(calcularBackoffMs(0), 5 * 60 * 1000);
  assert.strictEqual(calcularBackoffMs(1), 15 * 60 * 1000);
  assert.strictEqual(calcularBackoffMs(2), 30 * 60 * 1000);
  assert.strictEqual(calcularBackoffMs(7), 1440 * 60 * 1000);
  assert.strictEqual(calcularBackoffMs(99), 1440 * 60 * 1000);
  assert.deepStrictEqual([...BACKOFF_MINUTOS], [5, 15, 30, 60, 120, 240, 480, 1440]);
}

async function testSemProcContinuaComBackoff() {
  const docs = criarRepoDocs([{
    id: 10,
    chave: '23260725757840006327550010010248001140985160',
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE,
    nsu: '000000000000011'
  }]);
  const config = criarRepoConfig();
  let agora = new Date('2026-07-18T20:00:00.000Z');
  let ciclos = 0;

  const svc = new CentralXmlWaitScheduler({
    documentosRepository: docs,
    configRepository: config,
    tickMs: 20,
    agora: () => agora,
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() {
        ciclos += 1;
        return { xmlCompleto: false, cStat: '137', mensagem: 'Nenhum documento' };
      }
    })
  });

  await svc.iniciar();
  // Acelera: marca como devido
  const estado = svc.obterEstadoDocumento(10);
  assert.ok(estado);
  svc._docs.get(10).proximaEm = new Date(agora.getTime() - 1000).toISOString();

  await svc._executarTick();
  assert.strictEqual(ciclos, 1);
  const depois = svc.obterEstadoDocumento(10);
  assert.strictEqual(depois.tentativas, 1);
  assert.ok(new Date(depois.proximaTentativa).getTime() > agora.getTime());

  // Lock: segunda chamada simultânea não duplica
  svc._locks.add(10);
  await svc._processarDocumento(svc._docs.get(10), 'corr');
  assert.strictEqual(ciclos, 1, 'lock deve impedir consulta duplicada');
  svc._locks.delete(10);

  svc.parar({ motivo: 'teste' });
}

async function testProcSucesso() {
  const docs = criarRepoDocs([{
    id: 20,
    chave: '23260725757840006327550010010248001140985161',
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE,
    nsu: '000000000000012'
  }]);
  const config = criarRepoConfig();
  const agora = new Date('2026-07-18T21:00:00.000Z');

  const svc = new CentralXmlWaitScheduler({
    documentosRepository: docs,
    configRepository: config,
    tickMs: 20,
    agora: () => agora,
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento(id) {
        docs._map.set(id, {
          ...docs._map.get(id),
          status: DocumentoFiscalStatus.SINCRONIZADA,
          tipoDocumento: DocumentoDfeTipo.PROC_NFE
        });
        return { xmlCompleto: true, cStat: '138' };
      }
    })
  });

  await svc.recuperarPendentes({ motivo: 'teste' });
  svc._docs.get(20).proximaEm = new Date(agora.getTime() - 1000).toISOString();
  svc._ativo = true;
  await svc._processarDocumento(svc._docs.get(20), 'corr-ok');

  assert.strictEqual(svc.obterEstadoDocumento(20), null, 'deve sair do scheduler após PROC');
  const tel = svc.obterTelemetria();
  assert.strictEqual(tel.documentosRecuperados, 1);
  assert.ok(tel.tempoMedioRecuperacaoMs != null);
  svc.parar({ motivo: 'teste' });
}

async function testCancelUpload() {
  const docs = criarRepoDocs([{
    id: 30,
    chave: '23260725757840006327550010010248001140985162',
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE,
    nsu: '13'
  }]);
  const svc = new CentralXmlWaitScheduler({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    tickMs: 20,
    agora: () => new Date('2026-07-18T22:00:00.000Z'),
    obterOrchestrator: () => ({ async processarCicloDfeDocumento() { return {}; } })
  });
  await svc.recuperarPendentes();
  assert.ok(svc.obterEstadoDocumento(30));
  assert.strictEqual(svc.cancelar(30, 'upload'), true);
  assert.strictEqual(svc.obterEstadoDocumento(30), null);
  assert.strictEqual(svc.obterTelemetria().canceladosUpload, 1);
}

async function testRecuperacaoBoot() {
  const docs = criarRepoDocs([
    {
      id: 40,
      chave: '1'.padStart(44, '2'),
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      nsu: '1'
    },
    {
      id: 41,
      chave: '1'.padStart(44, '3'),
      status: DocumentoFiscalStatus.SINCRONIZADA,
      tipoDocumento: DocumentoDfeTipo.PROC_NFE,
      nsu: '2'
    }
  ]);
  const svc = new CentralXmlWaitScheduler({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    tickMs: 20,
    agora: () => new Date(),
    obterOrchestrator: () => ({ async processarCicloDfeDocumento() { return {}; } })
  });
  const r = await svc.recuperarPendentes({ motivo: 'boot' });
  assert.strictEqual(r.inscritos, 1);
  assert.ok(svc.obterEstadoDocumento(40));
  assert.strictEqual(svc.obterEstadoDocumento(41), null);
}

(async () => {
  await testBackoff();
  await testSemProcContinuaComBackoff();
  await testProcSucesso();
  await testCancelUpload();
  await testRecuperacaoBoot();
  console.log('RC7.4 xml-wait scheduler OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
