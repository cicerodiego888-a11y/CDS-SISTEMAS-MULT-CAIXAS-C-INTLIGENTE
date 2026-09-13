/**
 * RC3.4.4 — Auditoria cirúrgica: causa raiz (SLEEP descarta pós-ciência + pré-ciência).
 * Executar: node tests/central-entradas/rc344-auditoria-xml.test.js
 */

const assert = require('assert');
const {
  MirxService,
  MirxEstados
} = require('../../backend/motores/central-entradas/mirx');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../../backend/motores/central-entradas/core/DocumentoDfeTipo');
const { TIPOS_EVENTO } = require('../../backend/motores/central-entradas/config/centralEventosTipos');
const { resolverStatusReal } = require('../../backend/motores/central-entradas/utils/centralDocumentalInteligente');

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
    estaBloqueado656() {
      return bloqueado;
    },
    estaSuspenso593() {
      return false;
    },
    obterEstado593() {
      return { ativo: false };
    },
    obterEstadoOperacional() {
      return { codigo: bloqueado ? 'BLOCKED' : 'NORMAL' };
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

function docBase(id = 31) {
  return {
    id,
    chave: '23260743648971005114550010003489061727587419',
    nsu: '000000000000269',
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE
  };
}

function criarEventosRepo(opts = {}) {
  const temCiencia = opts.temCiencia !== false;
  const janelaNt = opts.janelaNt || null;
  return {
    async existePorTipoDocumento(tipo) {
      return tipo === TIPOS_EVENTO.MANIFESTACAO_ACEITA ? temCiencia : false;
    },
    async listar(filtros = {}) {
      if (filtros.tipo === TIPOS_EVENTO.MANIFESTACAO_ACEITA && temCiencia) {
        return [{
          tipo: TIPOS_EVENTO.MANIFESTACAO_ACEITA,
          detalhe: { proximaConsultaEm: janelaNt }
        }];
      }
      if (filtros.tipo === TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO && janelaNt) {
        return [{
          tipo: TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO,
          detalhe: { aguardandoXml: true, proximaConsultaEm: janelaNt }
        }];
      }
      return [];
    }
  };
}

/** Caso Wurth: ciência enfileira NT enquanto doc já dorme por Gate de outro doc. */
async function testEnfileirarEmSleepAlinhaJanelaNt() {
  const docs = criarRepoDocs([docBase(31)]);
  const agora = new Date('2026-07-28T01:10:00.000Z');
  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    gate: criarGate({ bloqueado: true, proxima: '2026-07-28T01:37:51.835Z' }),
    agora: () => agora
  });

  await svc.enfileirar(docs._map.get(31), { motivo: 'scan_boot' });
  await svc.entrarSleep(31, {
    proximaEm: '2026-07-28T01:37:51.835Z',
    motivo: 'Gate 656 de outro documento'
  });

  const r = await svc.enfileirar(docs._map.get(31), {
    motivo: 'pos_ciencia_aguardar_janela',
    proximaEm: '2026-07-28T02:03:33.516Z'
  });

  assert.strictEqual(r.enfileirado, false);
  assert.strictEqual(r.motivo, 'documento_em_sleep');
  assert.strictEqual(r.janelaAlinhada, true);
  assert.strictEqual(r.proximaTentativa, '2026-07-28T02:03:33.516Z');

  const est = svc._docs.get(31);
  assert.strictEqual(est.estado, MirxEstados.SLEEP);
  assert.strictEqual(est.proximaEm, '2026-07-28T02:03:33.516Z');
  svc.parar({ motivo: 'teste' });
}

/** Sem Ciência: worker não chama Gate / DistDFe / SLEEP. */
async function testSemCienciaNaoConsultaSefaz() {
  let gateChamado = false;
  let orchChamado = false;
  const docs = criarRepoDocs([docBase(32)]);
  const gate = criarGate({ bloqueado: false });
  gate.autorizarConsultaDistDfe = async () => {
    gateChamado = true;
    return { permitido: true, codigo: 'OK' };
  };

  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    gate,
    agora: () => new Date('2026-07-28T01:10:00.000Z'),
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() {
        orchChamado = true;
        return { xmlCompleto: false };
      }
    })
  });

  svc._worker._eventosRepository = criarEventosRepo({ temCiencia: false });
  await svc.enfileirar(docs._map.get(32));
  const job = svc._queue.dequeue();
  const r = await svc._worker.processar(job);

  assert.strictEqual(r.codigo, 'AGUARDANDO_CIENCIA');
  assert.strictEqual(gateChamado, false);
  assert.strictEqual(orchChamado, false);
  assert.strictEqual(svc._docs.has(32), false);
  svc.parar({ motivo: 'teste' });
}

/** Com Ciência + janela NT futura: reagenda sem DistDFe. */
async function testJanelaNtSemDistDfe() {
  let orchChamado = false;
  const docs = criarRepoDocs([docBase(33)]);
  const janela = '2026-07-28T02:03:33.516Z';
  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    gate: criarGate({ bloqueado: false }),
    agora: () => new Date('2026-07-28T01:40:00.000Z'),
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() {
        orchChamado = true;
        return { xmlCompleto: true, cStat: '138' };
      }
    })
  });

  svc._worker._eventosRepository = criarEventosRepo({ temCiencia: true, janelaNt: janela });
  await svc.enfileirar(docs._map.get(33), { forcarAgora: true });
  const job = svc._queue.dequeue();
  const r = await svc._worker.processar(job);

  assert.strictEqual(r.codigo, 'AGUARDANDO_JANELA_NT');
  assert.strictEqual(orchChamado, false);
  assert.strictEqual(svc._docs.get(33).proximaEm, janela);
  svc.parar({ motivo: 'teste' });
}

/** Após janela NT: DistDFe/consChNFe executa e recupera XML. */
async function testAposJanelaRecuperaXml() {
  let orchChamado = false;
  const docs = criarRepoDocs([docBase(34)]);
  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    gate: criarGate({ bloqueado: false }),
    agora: () => new Date('2026-07-28T02:10:00.000Z'),
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento(id) {
        orchChamado = true;
        docs._map.set(id, {
          ...docs._map.get(id),
          status: DocumentoFiscalStatus.SINCRONIZADA,
          tipoDocumento: DocumentoDfeTipo.PROC_NFE
        });
        return { xmlCompleto: true, cStat: '138' };
      }
    })
  });

  svc._worker._eventosRepository = criarEventosRepo({
    temCiencia: true,
    janelaNt: '2026-07-28T02:03:33.516Z'
  });
  await svc.enfileirar(docs._map.get(34), { forcarAgora: true });
  const r = await svc._worker.processar(svc._queue.dequeue());

  assert.strictEqual(orchChamado, true);
  assert.strictEqual(r.codigo, 'XML_RECUPERADO');
  assert.strictEqual(r.xmlCompleto, true);
  svc.parar({ motivo: 'teste' });
}

/** Label: SLEEP não deve aparecer como “SEFAZ sem XML”. */
function testLabelSleepNaoMenteSobreSefaz() {
  const doc = { status: 'AGUARDANDO_XML_COMPLETO', tipoDocumento: 'RES_NFE' };
  const label = resolverStatusReal(doc, {
    dormindo: true,
    estadoMirx: 'SLEEP',
    bloqueio656: { ativo: true }
  });
  assert.strictEqual(label, 'Recuperação automática do XML agendada');
  assert.notStrictEqual(label, 'Aguardando disponibilidade da SEFAZ');
  assert.notStrictEqual(label, 'Aguardando disponibilidade do XML');
}

/** Wakeup após SLEEP alinhado à NT. */
async function testWakeupAposSleepAlinhado() {
  const docs = criarRepoDocs([docBase(35)]);
  let agora = new Date('2026-07-28T01:10:00.000Z');
  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    gate: criarGate({ bloqueado: false }),
    agora: () => agora,
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() {
        return { xmlCompleto: false, cStat: '137', proximaConsultaEm: '2026-07-28T02:30:00.000Z' };
      }
    })
  });
  svc._worker._eventosRepository = criarEventosRepo({
    temCiencia: true,
    janelaNt: '2026-07-28T02:03:33.516Z'
  });

  await svc.enfileirar(docs._map.get(35));
  await svc.entrarSleep(35, { proximaEm: '2026-07-28T01:37:51.835Z' });
  await svc.enfileirar(docs._map.get(35), {
    motivo: 'pos_ciencia_aguardar_janela',
    proximaEm: '2026-07-28T02:03:33.516Z'
  });

  agora = new Date('2026-07-28T02:04:00.000Z');
  await svc._despertarDevidos();
  assert.notStrictEqual(svc._docs.get(35).estado, MirxEstados.SLEEP);
  svc.parar({ motivo: 'teste' });
}

async function main() {
  console.log('\n=== RC3.4.4 — Auditoria recuperação XML (caso Wurth) ===\n');
  await testEnfileirarEmSleepAlinhaJanelaNt();
  console.log('✓ Pós-ciência em SLEEP alinha proximaEm (NT), sem acordar / sem SEFAZ');
  await testSemCienciaNaoConsultaSefaz();
  console.log('✓ Sem Ciência: sem Gate, sem DistDFe, sem SLEEP');
  await testJanelaNtSemDistDfe();
  console.log('✓ Dentro da janela NT: reagenda sem DistDFe/consChNFe');
  await testAposJanelaRecuperaXml();
  console.log('✓ Após janela NT: XML recuperado automaticamente');
  testLabelSleepNaoMenteSobreSefaz();
  console.log('✓ Label SLEEP = “Recuperação automática do XML agendada”');
  await testWakeupAposSleepAlinhado();
  console.log('✓ WAKEUP após SLEEP alinhado à janela NT');
  console.log('\nRC3.4.4 OK\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
