/**
 * RC3.4.1 — Testes do Motor MIRX (fila, backoff, worker, forcarConsulta=false).
 */

const assert = require('assert');
const {
  MirxService,
  MirxQueue,
  MirxEstados,
  BACKOFF_MINUTOS,
  calcularBackoffMs,
  descreverBackoff
} = require('../../backend/motores/central-entradas/mirx');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../../backend/motores/central-entradas/core/DocumentoDfeTipo');

/** RC3.4.4 — recuperação MIRX pressupõe Ciência aceita. */
function eventosComCiencia() {
  return {
    async existePorTipoDocumento() { return true; },
    async listar() { return []; }
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
    }
  };
}

function criarGatePermitindo() {
  return {
    async autorizarConsultaDistDfe() {
      return { permitido: true, codigo: 'OK' };
    },
    async processarRespostaSefaz() {
      return { acao: 'continuar' };
    },
    obterBloqueio656() {
      return { ativo: false };
    },
    estaBloqueado656() {
      return false;
    },
    estaSuspenso593() {
      return false;
    },
    obterEstado593() {
      return { ativo: false };
    },
    obterEstadoOperacional() {
      return { codigo: 'NORMAL' };
    },
    obterTelemetria() {
      return {};
    },
    obterPainelOperacional() {
      return {};
    },
    hidratar() {},
    serializar() {
      return {};
    }
  };
}

async function testBackoffMirx() {
  assert.deepStrictEqual([...BACKOFF_MINUTOS], [5, 15, 30, 60, 120, 240, 480, 1440]);
  assert.strictEqual(calcularBackoffMs(0), 5 * 60 * 1000);
  assert.strictEqual(calcularBackoffMs(3), 60 * 60 * 1000);
  assert.strictEqual(descreverBackoff(7).minutos, 1440);
}

async function testFilaUnica() {
  const q = new MirxQueue();
  q.enqueue({ documentoId: 1, prioridade: 100 });
  q.enqueue({ documentoId: 2, prioridade: 10 });
  q.enqueue({ documentoId: 1, prioridade: 50, motivo: 'update' });
  assert.strictEqual(q.size(), 2);
  const primeiro = q.dequeue();
  assert.strictEqual(primeiro.documentoId, 2);
  assert.strictEqual(primeiro.prioridade, 10);
}

async function testWorkerSemForcarConsulta() {
  const docs = criarRepoDocs([{
    id: 101,
    chave: '23260725757840006327550010010248001140985160',
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE,
    nsu: '11'
  }]);
  let forcarVisto = null;
  let modoRec = null;

  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    eventosRepository: eventosComCiencia(),
    gate: criarGatePermitindo(),
    tickMs: 50,
    agora: () => new Date('2026-07-27T22:00:00.000Z'),
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento(_id, opcoes) {
        forcarVisto = opcoes.forcarConsulta;
        modoRec = opcoes.modoRecuperacaoXml;
        return { xmlCompleto: false, cStat: '137', mensagem: 'sem docs' };
      }
    })
  });

  await svc.enfileirar(docs._map.get(101), { motivo: 'teste' });
  const estado = svc.obterEstadoDocumento(101);
  assert.ok(estado);
  assert.ok(estado.estadoMirx);
  svc._docs.get(101).proximaEm = new Date('2026-07-27T21:00:00.000Z').toISOString();

  const job = svc._queue.dequeue();
  const r = await svc._worker.processar(job);
  assert.strictEqual(forcarVisto, false, 'MIRX nunca usa forcarConsulta permanente');
  assert.strictEqual(modoRec, true);
  assert.ok(r.reagendado || r.codigo === 'REAGENDADO');
  const depois = svc.obterEstadoDocumento(101);
  assert.ok(depois.tentativas >= 1);
  assert.ok(depois.proximaTentativa);
  svc.parar({ motivo: 'teste' });
}

async function testRecuperaProc() {
  const docs = criarRepoDocs([{
    id: 202,
    chave: '1'.padStart(44, '9'),
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE,
    nsu: '22'
  }]);

  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    eventosRepository: eventosComCiencia(),
    gate: criarGatePermitindo(),
    agora: () => new Date('2026-07-27T23:00:00.000Z'),
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

  await svc.enfileirar({ id: 202, ...docs._map.get(202) });
  const r = await svc._worker.processar(svc._queue.dequeue());
  assert.strictEqual(r.codigo, 'XML_RECUPERADO');
  assert.strictEqual(svc.obterEstadoDocumento(202), null);
  assert.strictEqual(svc.obterTelemetria().documentosRecuperados, 1);
  svc.parar({ motivo: 'teste' });
}

async function testGateBloqueia() {
  const docs = criarRepoDocs([{
    id: 303,
    chave: '1'.padStart(44, '8'),
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE,
    nsu: '33'
  }]);

  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    eventosRepository: eventosComCiencia(),
    gate: {
      ...criarGatePermitindo(),
      async autorizarConsultaDistDfe() {
        return {
          permitido: false,
          codigo: 'BLOQUEADO_CONSUMO_INDEVIDO_656',
          cStat: '656',
          mensagem: 'bloqueado',
          proximaConsultaEm: '2026-07-28T01:00:00.000Z'
        };
      },
      obterBloqueio656() {
        return { ativo: true, bloqueadoAte: '2026-07-28T01:00:00.000Z', cStat: '656' };
      },
      estaBloqueado656() {
        return true;
      }
    },
    agora: () => new Date('2026-07-27T23:30:00.000Z'),
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() {
        throw new Error('não deveria consultar SEFAZ');
      }
    })
  });

  await svc.enfileirar(docs._map.get(303));
  const r = await svc._worker.processar(svc._queue.dequeue());
  assert.strictEqual(r.codigo, 'BLOQUEADO_CONSUMO_INDEVIDO_656');
  assert.strictEqual(r.ignorado, true);
  assert.strictEqual(r.dormindo, true);
  const est = svc.obterEstadoDocumento(303);
  // RC3.4.2 — 656 entra em SLEEP (BLOQUEADO_656 legado migrado)
  assert.strictEqual(est.estadoMirx, MirxEstados.SLEEP);
  assert.strictEqual(est.dormindo, true);
  svc.parar({ motivo: 'teste' });
}

(async () => {
  await testBackoffMirx();
  await testFilaUnica();
  await testWorkerSemForcarConsulta();
  await testRecuperaProc();
  await testGateBloqueia();
  console.log('RC3.4.1 MIRX OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
