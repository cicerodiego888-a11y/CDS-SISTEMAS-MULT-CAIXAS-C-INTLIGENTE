/**
 * RC7.4.2 — Inteligência Operacional SEFAZ (Gate + 656 + 593).
 */

const assert = require('assert');
const {
  CentralXmlWaitScheduler
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

function criarScheduler(opts = {}) {
  const config = opts.config || criarRepoConfig();
  const fingerprint = { atual: opts.fingerprint || 'cnpjA|certA' };
  const gate = new CentralSefazOperationalGate({
    configRepository: config,
    agora: opts.agora || (() => new Date('2026-07-18T20:00:00.000Z')),
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
  const svc = new CentralXmlWaitScheduler({
    documentosRepository: opts.docs || criarRepoDocs([]),
    configRepository: config,
    tickMs: 20,
    agora: opts.agora || (() => new Date('2026-07-18T20:00:00.000Z')),
    obterOrchestrator: opts.obterOrchestrator || (() => ({
      async processarCicloDfeDocumento() { return { xmlCompleto: false, cStat: '137' }; }
    })),
    gate,
    obterFingerprintConfig: async () => fingerprint.atual
  });
  gate.vincularPersistencia(() => { svc._persistirEstado().catch(() => {}); });
  return { svc, gate, config, fingerprint };
}

async function caso1_138FluxoNormal() {
  const docs = criarRepoDocs([{
    id: 1,
    chave: '23260725757840006327550010010248001140985160',
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE,
    nsu: '11'
  }]);
  let consultas = 0;
  const { svc } = criarScheduler({
    docs,
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() {
        consultas += 1;
        docs._map.get(1).status = DocumentoFiscalStatus.SINCRONIZADA;
        docs._map.get(1).tipoDocumento = DocumentoDfeTipo.PROC_NFE;
        return { xmlCompleto: true, cStat: '138', gateProcessado: false };
      }
    })
  });
  await svc.recuperarPendentes();
  svc._docs.get(1).proximaEm = new Date('2026-07-18T19:00:00.000Z').toISOString();
  await svc._processarDocumento(svc._docs.get(1), 'c1');
  assert.strictEqual(consultas, 1);
  assert.strictEqual(svc._docs.has(1), false, 'deve remover wait após PROC');
  assert.ok(svc.obterTelemetria().contagemCStat['138'] >= 1);
  svc.parar({ motivo: 'teste' });
}

async function caso2_137Backoff() {
  const docs = criarRepoDocs([{
    id: 2,
    chave: '2'.padStart(44, '2'),
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE,
    nsu: '2'
  }]);
  const agora = { t: new Date('2026-07-18T20:00:00.000Z') };
  const { svc } = criarScheduler({
    docs,
    agora: () => agora.t,
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() {
        return { xmlCompleto: false, cStat: '137' };
      }
    })
  });
  await svc.recuperarPendentes();
  const antes = svc._docs.get(2).proximaEm;
  svc._docs.get(2).proximaEm = new Date(agora.t.getTime() - 1000).toISOString();
  await svc._processarDocumento(svc._docs.get(2), 'c2');
  assert.ok(svc._docs.has(2));
  assert.notStrictEqual(svc._docs.get(2).proximaEm, antes);
  assert.ok(new Date(svc._docs.get(2).proximaEm).getTime() > agora.t.getTime());
  assert.strictEqual(svc.estaBloqueadoDistDfe(), false);
  svc.parar({ motivo: 'teste' });
}

async function caso3_656Bloqueio1h() {
  let consultas = 0;
  const agora = { t: new Date('2026-07-18T20:00:00.000Z') };
  const docs = criarRepoDocs([{
    id: 3,
    chave: '3'.padStart(44, '3'),
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE,
    nsu: '3'
  }]);
  const { svc, gate } = criarScheduler({
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
  svc._docs.get(3).proximaEm = new Date(agora.t.getTime() - 1000).toISOString();
  await svc._processarDocumento(svc._docs.get(3), 'c3');
  assert.strictEqual(consultas, 1);
  assert.strictEqual(gate.estaBloqueado656(), true);
  const cooldown = require('../../backend/motores/central-entradas/services/CentralSefazOperationalGate')
    .calcularCooldown656Ms(1);

  for (let i = 0; i < 100; i += 1) {
    const auth = await gate.autorizarConsultaDistDfe({ correlationId: `open-${i}` });
    assert.strictEqual(auth.permitido, false);
    assert.strictEqual(auth.codigo, 'BLOQUEADO_CONSUMO_INDEVIDO_656');
  }
  await svc._processarDocumento(svc._docs.get(3), 'c3b');
  assert.strictEqual(consultas, 1);

  agora.t = new Date(agora.t.getTime() + cooldown + 1000);
  assert.strictEqual(gate.estaBloqueado656(), false);
  svc._docs.get(3).proximaEm = new Date(agora.t.getTime() - 1000).toISOString();
  await svc._processarDocumento(svc._docs.get(3), 'c3c');
  assert.strictEqual(consultas, 2);
  svc.parar({ motivo: 'teste' });
}

async function caso4_593SuspendeAteCorrecao() {
  let consultas = 0;
  const docs = criarRepoDocs([{
    id: 4,
    chave: '4'.padStart(44, '4'),
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE,
    nsu: '4'
  }]);
  const { svc, gate, fingerprint } = criarScheduler({
    docs,
    fingerprint: 'cnpjA|certA',
    obterOrchestrator: () => ({
      async processarCicloDfeDocumento() {
        consultas += 1;
        return {
          xmlCompleto: false,
          cStat: '593',
          cnpjXml: '11111111000111',
          cnpjCertificado: '22222222000122'
        };
      }
    })
  });

  await svc.recuperarPendentes();
  svc._docs.get(4).proximaEm = new Date('2026-07-18T19:00:00.000Z').toISOString();
  await svc._processarDocumento(svc._docs.get(4), 'c4');
  assert.strictEqual(consultas, 1);
  assert.strictEqual(gate.estaSuspenso593(), true);
  assert.strictEqual(
    gate.obterEstadoOperacional().codigo,
    CentralSefazOperationalGate.ESTADO_OPERACIONAL.ERRO_593
  );

  for (let i = 0; i < 20; i += 1) {
    const auth = await gate.autorizarConsultaDistDfe({ correlationId: `593-${i}` });
    assert.strictEqual(auth.permitido, false);
    assert.strictEqual(auth.codigo, 'ERRO_CONFIGURACAO_CERTIFICADO');
  }
  assert.strictEqual(consultas, 1);

  // forcar normal NÃO bypassa
  const forcar = await gate.autorizarConsultaDistDfe({
    forcar: true,
    forcarConsulta: true,
    correlationId: 'forcar'
  });
  assert.strictEqual(forcar.permitido, false);

  // admin com confirmação bypassa uma vez
  const admin = await gate.autorizarConsultaDistDfe({
    forcarAdminConfirmado: true,
    confirmacaoAdmin: true,
    correlationId: 'admin'
  });
  assert.strictEqual(admin.permitido, true);

  // corrige fingerprint → libera
  fingerprint.atual = 'cnpjB|certB';
  const apos = await gate.autorizarConsultaDistDfe({ correlationId: 'fix' });
  assert.strictEqual(apos.permitido, true);
  assert.strictEqual(gate.estaSuspenso593(), false);
  svc.parar({ motivo: 'teste' });
}

async function caso5_UploadLimpaTudo() {
  const { svc, gate } = criarScheduler();
  gate.registrarBloqueio656({ correlationId: 'u', documentoId: 9 });
  await gate.registrarErro593({
    correlationId: 'u',
    documentoId: 9,
    fingerprint: 'cnpjA|certA'
  });
  assert.strictEqual(gate.estaBloqueado656(), true);
  assert.strictEqual(gate.estaSuspenso593(), true);
  svc.cancelar(9, 'upload');
  assert.strictEqual(gate.estaBloqueado656(), false);
  assert.strictEqual(gate.estaSuspenso593(), false);
}

async function caso6_ReinicioRecuperaEstado() {
  const config = criarRepoConfig();
  const agora = () => new Date('2026-07-18T22:00:00.000Z');
  const { svc: svc1, gate: g1 } = criarScheduler({ config, agora });
  g1.registrarBloqueio656({ documentoId: 5, nsu: '5' });
  await g1.registrarErro593({
    documentoId: 6,
    fingerprint: 'cnpjA|certA',
    cnpjXml: '1',
    cnpjCertificado: '2'
  });
  await svc1._persistirEstado();

  const { svc: svc2, gate: g2 } = criarScheduler({ config, agora });
  await svc2._carregarEstado();
  assert.strictEqual(g2.estaBloqueado656(), true);
  assert.strictEqual(g2.estaSuspenso593(), true);
  assert.ok(g2.obterBloqueio656().bloqueadoAte);
}

async function caso7_GateUnificadoSync() {
  const { gate } = criarScheduler();
  gate.registrarBloqueio656({ correlationId: 'sync' });
  const auth = await gate.autorizarConsultaDistDfe({
    correlationId: 'abrir-central',
    forcar: true
  });
  assert.strictEqual(auth.permitido, false);
  assert.strictEqual(auth.codigo, 'BLOQUEADO_CONSUMO_INDEVIDO_656');
  assert.ok(gate.obterTelemetria().consultasEvitadas >= 1);
  assert.ok(gate.obterTelemetria().economiaSOAP >= 1);
}

(async () => {
  await caso1_138FluxoNormal();
  await caso2_137Backoff();
  await caso3_656Bloqueio1h();
  await caso4_593SuspendeAteCorrecao();
  await caso5_UploadLimpaTudo();
  await caso6_ReinicioRecuperaEstado();
  await caso7_GateUnificadoSync();
  console.log('RC7.4.2 inteligência operacional SEFAZ OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
