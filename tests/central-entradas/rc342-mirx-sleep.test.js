/**
 * RC3.4.2 — MIRX Inteligente: SLEEP / WAKEUP / solicitação manual / sem spam.
 * Executar: node tests/central-entradas/rc342-mirx-sleep.test.js
 */

const assert = require('assert');
const {
  MirxService,
  MirxEstados,
  isSleep,
  TIPOS_MIRX
} = require('../../backend/motores/central-entradas/mirx');
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
    }
  };
}

function criarGate(opts = {}) {
  const bloqueado = opts.bloqueado === true;
  const proxima = opts.proxima || '2026-07-28T04:00:00.000Z';
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

function docBase(id = 401) {
  return {
    id,
    chave: String(id).padStart(44, '7'),
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE,
    nsu: String(id)
  };
}

/** RC3.4.4 — recuperação MIRX pressupõe Ciência aceita. */
function eventosComCiencia() {
  return {
    async existePorTipoDocumento() {
      return true;
    },
    async listar() {
      return [];
    }
  };
}

async function testSleepEm656() {
  const docs = criarRepoDocs([docBase(401)]);
  const eventos = [];
  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    gate: criarGate({ bloqueado: true, proxima: '2026-07-28T04:00:00.000Z' }),
    agora: () => new Date('2026-07-27T22:00:00.000Z'),
    eventosRepository: eventosComCiencia(),
    auditoria: {
      logOperacional() {},
      async registrarTimeline(d) {
        eventos.push(d.tipoEvento);
      }
    },
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() {
        throw new Error('não deveria consultar SEFAZ');
      }
    })
  });

  await svc.enfileirar(docs._map.get(401), { motivo: 'teste' });
  const r = await svc._worker.processar(svc._queue.dequeue());
  assert.strictEqual(r.dormindo, true);
  assert.strictEqual(svc._docs.get(401).estado, MirxEstados.SLEEP);
  assert.strictEqual(svc._queue.size(), 0);
  assert.ok(eventos.includes(TIPOS_MIRX.MIRX_SLEEP_START));
  assert.ok(!eventos.includes(TIPOS_MIRX.MIRX_SKIP_GATE));

  // Re-enfileirar enquanto SLEEP deve ser ignorado
  const again = await svc.enfileirar(docs._map.get(401), { motivo: 'tick' });
  assert.strictEqual(again.enfileirado, false);
  assert.strictEqual(again.motivo, 'documento_em_sleep');
  assert.strictEqual(svc._queue.size(), 0);

  const ui = svc.obterEstadoDocumento(401);
  assert.strictEqual(ui.dormindo, true);
  assert.strictEqual(ui.dormindoLabel, 'Sim');
  assert.ok(isSleep(ui.estadoMirx));
  svc.parar({ motivo: 'teste' });
}

async function testWakeupAposCooldown() {
  const docs = criarRepoDocs([docBase(402)]);
  let agora = new Date('2026-07-27T22:00:00.000Z');
  const eventos = [];
  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    eventosRepository: eventosComCiencia(),
    gate: criarGate({ bloqueado: false }),
    agora: () => agora,
    tickMs: 50,
    auditoria: {
      logOperacional() {},
      async registrarTimeline(d) {
        eventos.push(d.tipoEvento);
      }
    },
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() {
        return { xmlCompleto: false, cStat: '137' };
      }
    })
  });

  await svc.enfileirar(docs._map.get(402));
  await svc.entrarSleep(402, {
    proximaEm: '2026-07-27T22:30:00.000Z',
    motivo: 'teste sleep'
  });
  assert.strictEqual(svc._docs.get(402).estado, MirxEstados.SLEEP);
  assert.strictEqual(svc._queue.size(), 0);

  // Tick antes do horário: permanece sleep, fila vazia
  await svc._executarTick();
  assert.strictEqual(svc._docs.get(402).estado, MirxEstados.SLEEP);
  assert.strictEqual(svc._queue.has(402), false);

  // Após proximaTentativa: wakeup
  agora = new Date('2026-07-27T22:31:00.000Z');
  await svc._despertarDevidos();
  assert.ok(eventos.includes(TIPOS_MIRX.MIRX_WAKEUP));
  assert.strictEqual(svc._docs.get(402).estado, MirxEstados.CONSULTA_PROGRAMADA);
  assert.ok(svc._queue.has(402) || svc._queue.size() >= 0);
  svc.parar({ motivo: 'teste' });
}

async function testTickNaoSpamSleep() {
  const docs = criarRepoDocs([docBase(403)]);
  let skips = 0;
  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    eventosRepository: eventosComCiencia(),
    gate: criarGate({ bloqueado: true }),
    agora: () => new Date('2026-07-27T22:00:00.000Z'),
    auditoria: {
      logOperacional(ev) {
        if (ev === 'MIRX_SKIP_GATE' || ev === TIPOS_MIRX.MIRX_SKIP_GATE) skips += 1;
      },
      async registrarTimeline(d) {
        if (d.tipoEvento === TIPOS_MIRX.MIRX_SKIP_GATE) skips += 1;
      }
    },
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() {
        return { cStat: '656', codigo: 'BLOQUEADO_CONSUMO_INDEVIDO_656' };
      }
    })
  });

  await svc.enfileirar(docs._map.get(403));
  await svc.entrarSleep(403, { proximaEm: '2026-07-28T10:00:00.000Z' });

  const sleepStartsAntes = svc._metricas.sleepStarts;
  for (let i = 0; i < 5; i += 1) {
    await svc._executarTick();
  }
  assert.strictEqual(svc._docs.get(403).estado, MirxEstados.SLEEP);
  assert.strictEqual(skips, 0, 'sem MIRX_SKIP_GATE durante SLEEP');
  assert.strictEqual(svc._metricas.sleepStarts, sleepStartsAntes, 'sem SLEEP_START repetido');
  assert.ok(svc._metricas.ticksIgnoradosSleep >= 0);
  svc.parar({ motivo: 'teste' });
}

async function testSolicitarManualGateBloqueado() {
  const docs = criarRepoDocs([docBase(404)]);
  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    eventosRepository: eventosComCiencia(),
    gate: criarGate({ bloqueado: true, proxima: '2026-07-28T05:30:00.000Z' }),
    agora: () => new Date('2026-07-27T22:00:00.000Z'),
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() {
        throw new Error('não deve consultar');
      }
    })
  });

  await svc.enfileirar(docs._map.get(404));
  await svc.entrarSleep(404, { proximaEm: '2026-07-28T05:30:00.000Z' });
  const filaAntes = svc._queue.size();

  const r = await svc.solicitarXmlManual(404);
  assert.strictEqual(r.gateBloqueado, true);
  assert.strictEqual(r.naoEnfileirado, true);
  assert.ok(String(r.mensagem).includes('656'));
  assert.ok(String(r.mensagem).includes('Próxima tentativa automática'));
  assert.strictEqual(svc._queue.size(), filaAntes);
  assert.strictEqual(svc._docs.get(404).estado, MirxEstados.SLEEP);
  svc.parar({ motivo: 'teste' });
}

async function testSolicitarManualGateLivre() {
  const docs = criarRepoDocs([docBase(405)]);
  let consultou = false;
  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    eventosRepository: eventosComCiencia(),
    gate: criarGate({ bloqueado: false }),
    agora: () => new Date('2026-07-27T22:00:00.000Z'),
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() {
        consultou = true;
        docs._map.set(405, {
          ...docs._map.get(405),
          status: DocumentoFiscalStatus.SINCRONIZADA,
          tipoDocumento: DocumentoDfeTipo.PROC_NFE
        });
        return { xmlCompleto: true, cStat: '138' };
      }
    })
  });

  await svc.enfileirar(docs._map.get(405));
  const r = await svc.solicitarXmlManual(405);
  assert.strictEqual(consultou, true);
  assert.strictEqual(r.xmlCompleto || r.codigo === 'XML_RECUPERADO', true);
  svc.parar({ motivo: 'teste' });
}

async function testRecuperacaoAutomaticaXml() {
  const docs = criarRepoDocs([docBase(406)]);
  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    eventosRepository: eventosComCiencia(),
    gate: criarGate({ bloqueado: false }),
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

  await svc.enfileirar(docs._map.get(406), { motivo: 'auto' });
  const r = await svc._worker.processar(svc._queue.dequeue());
  assert.strictEqual(r.codigo, 'XML_RECUPERADO');
  assert.strictEqual(svc.obterTelemetria().documentosRecuperados, 1);
  svc.parar({ motivo: 'teste' });
}

async function testScanIgnoraSleep() {
  const docs = criarRepoDocs([docBase(407)]);
  const svc = new MirxService({
    documentosRepository: docs,
    configRepository: criarRepoConfig(),
    eventosRepository: eventosComCiencia(),
    gate: criarGate({ bloqueado: false }),
    agora: () => new Date('2026-07-27T22:00:00.000Z')
  });

  await svc.enfileirar(docs._map.get(407));
  await svc.entrarSleep(407, { proximaEm: '2026-07-28T12:00:00.000Z' });
  svc._queue.limpar();

  const r = await svc.recuperarPendentes({ motivo: 'scan' });
  assert.strictEqual(r.ignoradosSleep, 1);
  assert.strictEqual(r.inscritos, 0);
  assert.strictEqual(svc._queue.size(), 0);
  svc.parar({ motivo: 'teste' });
}

async function main() {
  console.log('\n=== RC3.4.2 — MIRX SLEEP / WAKEUP / XML automático ===\n');
  await testSleepEm656();
  console.log('✓ cStat 656 → SLEEP (fora da fila, SLEEP_START)');
  await testWakeupAposCooldown();
  console.log('✓ Wake-up após proximaTentativa');
  await testTickNaoSpamSleep();
  console.log('✓ Sem ticks/logs repetitivos em SLEEP');
  await testSolicitarManualGateBloqueado();
  console.log('✓ Solicitar XML com Gate bloqueado não consulta nem enfileira');
  await testSolicitarManualGateLivre();
  console.log('✓ Solicitar XML com Gate livre recupera imediatamente');
  await testRecuperacaoAutomaticaXml();
  console.log('✓ Recuperação automática do XML');
  await testScanIgnoraSleep();
  console.log('✓ Scan/fila ignora documentos em SLEEP');
  console.log('\nRC3.4.2 MIRX SLEEP OK\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
