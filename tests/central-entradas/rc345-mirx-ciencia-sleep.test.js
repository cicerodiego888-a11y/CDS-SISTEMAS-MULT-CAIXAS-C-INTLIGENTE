/**
 * RC3.4.5 — Sincronização MIRX × Ciência × SLEEP
 * Executar: node tests/central-entradas/rc345-mirx-ciencia-sleep.test.js
 */

const assert = require('assert');
const {
  MirxService,
  MirxEstados,
  TIPOS_MIRX
} = require('../../backend/motores/central-entradas/mirx');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../../backend/motores/central-entradas/core/DocumentoDfeTipo');
const { TIPOS_EVENTO } = require('../../backend/motores/central-entradas/config/centralEventosTipos');
const { resolverStatusReal, explicarStatus } = require('../../backend/motores/central-entradas/utils/centralDocumentalInteligente');

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

function criarGate(opts = {}) {
  const bloqueado = opts.bloqueado === true;
  const proxima = opts.proxima || '2026-07-28T01:37:51.835Z';
  return {
    async autorizarConsultaDistDfe() {
      if (bloqueado) {
        return {
          permitido: false,
          codigo: 'BLOQUEADO_CONSUMO_INDEVIDO_656',
          cStat: '656',
          mensagem: 'bloqueado 656',
          proximaConsultaEm: proxima
        };
      }
      return { permitido: true, codigo: 'OK' };
    },
    async processarRespostaSefaz() {
      return { acao: 'continuar' };
    },
    obterBloqueio656() {
      return bloqueado
        ? { ativo: true, cStat: '656', bloqueadoAte: proxima, motivo: '656' }
        : { ativo: false };
    },
    estaBloqueado656() { return bloqueado; },
    estaSuspenso593() { return false; },
    obterEstado593() { return { ativo: false }; },
    obterEstadoOperacional() { return { codigo: bloqueado ? 'BLOCKED' : 'NORMAL' }; },
    obterTelemetria() { return {}; },
    obterPainelOperacional() { return {}; },
    hidratar() {},
    serializar() { return {}; }
  };
}

function docBase(id = 501) {
  return {
    id,
    chave: String(id).padStart(44, '5'),
    nsu: String(id),
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE
  };
}

function eventosComCiencia(janelaNt = null) {
  return {
    async existePorTipoDocumento(tipo) {
      return tipo === TIPOS_EVENTO.MANIFESTACAO_ACEITA;
    },
    async listar(filtros = {}) {
      if (filtros.tipo === TIPOS_EVENTO.MANIFESTACAO_ACEITA) {
        return [{ detalhe: { proximaConsultaEm: janelaNt } }];
      }
      if (filtros.tipo === TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO && janelaNt) {
        return [{ detalhe: { aguardandoXml: true, proximaConsultaEm: janelaNt } }];
      }
      return [];
    }
  };
}

/** SLEEP → Ciência → agendamento preservado + log MIRX_AGENDAMENTO_ATUALIZADO */
async function testAgendamentoPreservadoEmSleep() {
  const docs = criarRepoDocs([docBase(501)]);
  const timeline = [];
  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    gate: criarGate({ bloqueado: true }),
    agora: () => new Date('2026-07-28T01:10:00.000Z'),
    auditoria: {
      logOperacional() {},
      async registrarTimeline(d) {
        timeline.push(d);
      }
    }
  });

  await svc.enfileirar(docs._map.get(501), { motivo: 'scan_pre_ciencia' });
  await svc.entrarSleep(501, { proximaEm: '2026-07-28T01:37:51.835Z' });

  const r = await svc.enfileirar(docs._map.get(501), {
    motivo: 'pos_ciencia_aguardar_janela',
    origem: 'sistema',
    proximaEm: '2026-07-28T02:03:33.516Z'
  });

  assert.strictEqual(r.agendamentoPreservado, true);
  assert.strictEqual(r.proximaTentativa, '2026-07-28T02:03:33.516Z');
  assert.strictEqual(svc._docs.get(501).estado, MirxEstados.SLEEP);
  assert.strictEqual(svc._docs.get(501).proximaEm, '2026-07-28T02:03:33.516Z');

  const ag = timeline.filter((t) => t.tipoEvento === TIPOS_MIRX.MIRX_AGENDAMENTO_ATUALIZADO);
  assert.ok(ag.length >= 1);
  assert.strictEqual(ag[0].proximaEmAnterior, '2026-07-28T01:37:51.835Z');
  assert.strictEqual(ag[0].proximaEmNova, '2026-07-28T02:03:33.516Z');
  svc.parar({ motivo: 'teste' });
}

/** Sem Ciência: sem DistDFe / SLEEP */
async function testSemCienciaAguarda() {
  let gate = false;
  let orch = false;
  const docs = criarRepoDocs([docBase(502)]);
  const g = criarGate({ bloqueado: false });
  g.autorizarConsultaDistDfe = async () => { gate = true; return { permitido: true }; };
  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    gate: g,
    agora: () => new Date('2026-07-28T01:10:00.000Z'),
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() { orch = true; return {}; }
    })
  });
  svc._worker._eventosRepository = {
    async existePorTipoDocumento() { return false; },
    async listar() { return []; }
  };
  await svc.enfileirar(docs._map.get(502));
  const r = await svc._worker.processar(svc._queue.dequeue());
  assert.strictEqual(r.codigo, 'AGUARDANDO_CIENCIA');
  assert.strictEqual(gate, false);
  assert.strictEqual(orch, false);
  svc.parar({ motivo: 'teste' });
}

/** Wakeup → DistDFe → XML + MIRX_WAKEUP_EXECUTADO */
async function testWakeupExecutadoRecuperaXml() {
  const docs = criarRepoDocs([docBase(503)]);
  const timeline = [];
  let agora = new Date('2026-07-28T01:10:00.000Z');
  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    gate: criarGate({ bloqueado: false }),
    agora: () => agora,
    eventosRepository: eventosComCiencia(null),
    auditoria: {
      logOperacional() {},
      async registrarTimeline(d) { timeline.push(d); }
    },
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

  await svc.enfileirar(docs._map.get(503));
  await svc.entrarSleep(503, { proximaEm: '2026-07-28T01:37:00.000Z' });
  await svc.enfileirar(docs._map.get(503), {
    motivo: 'pos_ciencia_aguardar_janela',
    proximaEm: '2026-07-28T01:37:00.000Z'
  });

  agora = new Date('2026-07-28T01:38:00.000Z');
  await svc._despertarDevidos();
  assert.ok(timeline.some((t) => t.tipoEvento === TIPOS_MIRX.MIRX_WAKEUP));

  const job = svc._queue.dequeue();
  assert.ok(job);
  job.motivo = 'wakeup_proxima_tentativa';
  const r = await svc._worker.processar(job);
  assert.strictEqual(r.codigo, 'XML_RECUPERADO');
  assert.ok(timeline.some((t) => t.tipoEvento === TIPOS_MIRX.MIRX_WAKEUP_EXECUTADO));
  const we = timeline.find((t) => t.tipoEvento === TIPOS_MIRX.MIRX_WAKEUP_EXECUTADO);
  assert.ok(we.metodo);
  assert.ok(we.resultado || we.codigo);
  assert.ok(we.tempoMs != null);
  svc.parar({ motivo: 'teste' });
}

/** Status Central nunca mente sobre SEFAZ */
function testStatusAgendado() {
  const label = resolverStatusReal(
    { status: 'AGUARDANDO_XML_COMPLETO' },
    { estadoMirx: 'AGUARDANDO_JANELA_SEFAZ', proximaTentativa: '2026-07-28T02:03:33.516Z' }
  );
  assert.strictEqual(label, 'Recuperação automática do XML agendada');
  const exp = explicarStatus(
    { status: 'AGUARDANDO_XML_COMPLETO' },
    { proximaTentativa: '2026-07-28T02:03:33.516Z' }
  );
  assert.match(exp, /Próxima tentativa:/);
  assert.doesNotMatch(exp, /Aguardando disponibilidade da SEFAZ/);
}

/** Janela NT = AGENDADO, não DistDFe */
async function testJanelaNtAgendada() {
  let orch = false;
  const docs = criarRepoDocs([docBase(504)]);
  const timeline = [];
  const janela = '2026-07-28T02:03:33.516Z';
  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    gate: criarGate({ bloqueado: false }),
    agora: () => new Date('2026-07-28T01:40:00.000Z'),
    eventosRepository: eventosComCiencia(janela),
    auditoria: {
      logOperacional() {},
      async registrarTimeline(d) { timeline.push(d); }
    },
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() { orch = true; return {}; }
    })
  });
  await svc.enfileirar(docs._map.get(504), { forcarAgora: true });
  const r = await svc._worker.processar(svc._queue.dequeue());
  assert.strictEqual(r.codigo, 'AGUARDANDO_JANELA_NT');
  assert.strictEqual(r.agendado, true);
  assert.strictEqual(orch, false);
  assert.strictEqual(svc._docs.get(504).estado, MirxEstados.AGUARDANDO_JANELA_SEFAZ);
  assert.ok(timeline.some((t) => t.tipoEvento === TIPOS_MIRX.MIRX_AGENDAMENTO_ATUALIZADO));
  svc.parar({ motivo: 'teste' });
}

async function main() {
  console.log('\n=== RC3.4.5 — MIRX × Ciência × SLEEP ===\n');
  await testAgendamentoPreservadoEmSleep();
  console.log('✓ SLEEP + Ciência: agendamento preservado + MIRX_AGENDAMENTO_ATUALIZADO');
  await testSemCienciaAguarda();
  console.log('✓ Sem Ciência: sem DistDFe / sem SLEEP');
  await testWakeupExecutadoRecuperaXml();
  console.log('✓ WAKEUP → DistDFe → XML + MIRX_WAKEUP_EXECUTADO');
  testStatusAgendado();
  console.log('✓ Status = Recuperação agendada (com próxima tentativa)');
  await testJanelaNtAgendada();
  console.log('✓ Janela NT = AGENDADO (sem SEFAZ)');
  console.log('\nRC3.4.5 OK\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
