'use strict';

/**
 * RC12.1 — Contratos do Observability Bus + sanitização.
 */

const assert = require('assert');
const path = require('path');

const root = path.resolve(__dirname, '..');
const obs = require(path.join(root, 'backend', 'observabilidade'));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('\n=== RC12.1 — Observability Bus ===\n');

  obs._resetForTests();

  // 1) Envelope obs.v1
  const built = obs.buildEnvelope({
    event_name: obs.EVENT_NAMES.BOOT_HTTP_LISTENING,
    categoria: obs.CATEGORIAS.PLATFORM,
    origem: 'test',
    payload: { port: 3015 }
  });
  assert.strictEqual(built.ok, true);
  assert.strictEqual(built.envelope.versao_schema, 'obs.v1');
  for (const campo of obs.CAMPOS_OBRIGATORIOS) {
    assert.ok(built.envelope[campo] !== undefined && built.envelope[campo] !== null, campo);
  }
  assert.strictEqual(obs.validateEnvelope(built.envelope).length, 0);
  console.log('  OK  envelope obs.v1 valida campos obrigatórios');

  // 2) Drop sem obrigatorios
  const bad = obs.buildEnvelope({ event_name: 'X' });
  assert.strictEqual(bad.ok, false);
  console.log('  OK  validação rejeita envelope incompleto');

  // 3) Sanitização
  const sensitive = obs._publishSyncForTests({
    event_name: obs.EVENT_NAMES.SOAP_FINALIZADO,
    categoria: obs.CATEGORIAS.FISCAL,
    origem: 'test.sanitizer',
    payload: {
      csc: 'SEGREDO-CSC',
      fiscal_certificado_senha: '123456',
      token: 'abc.def',
      jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb',
      pan: '4111111111111111',
      xml: '<?xml version="1.0"?><NFe><infNFe>dados</infNFe></NFe>',
      ok_field: 'visível'
    }
  });
  assert.strictEqual(sensitive.accepted, true);
  const p = sensitive.envelope.payload;
  assert.strictEqual(p.csc, '[REDACTED]');
  assert.strictEqual(p.fiscal_certificado_senha, '[REDACTED]');
  assert.strictEqual(p.token, '[REDACTED]');
  assert.ok(String(p.jwt).includes('REDACTED'));
  assert.ok(String(p.pan).includes('REDACTED') || p.pan === '[REDACTED]');
  assert.ok(String(p.xml).startsWith('[REDACTED_XML'));
  assert.strictEqual(p.ok_field, 'visível');
  assert.ok(obs.getStats().sanitized >= 1);
  console.log('  OK  sanitização remove CSC/senha/token/JWT/PAN/XML');

  // 4) publish não bloqueia / async
  obs._resetForTests();
  const queued = obs.publish({
    event_name: obs.EVENT_NAMES.LAZY_SERVICE_CREATED,
    categoria: obs.CATEGORIAS.PLATFORM,
    origem: 'test',
    payload: { service: 'miip' },
    duracao_ms: 12
  });
  assert.strictEqual(queued.queued, true);
  assert.strictEqual(obs.getStats().published, 0);
  await sleep(30);
  assert.ok(obs.getStats().published >= 1);
  console.log('  OK  publish é não-bloqueante (setImmediate)');

  // 5) subscribe / unsubscribe
  obs._resetForTests();
  let hits = 0;
  const unsub = obs.subscribe(obs.EVENT_NAMES.BOOT_STARTED, () => { hits += 1; });
  obs._publishSyncForTests({
    event_name: obs.EVENT_NAMES.BOOT_STARTED,
    categoria: obs.CATEGORIAS.PLATFORM,
    origem: 'test',
    payload: {}
  });
  assert.strictEqual(hits, 1);
  unsub();
  obs._publishSyncForTests({
    event_name: obs.EVENT_NAMES.BOOT_STARTED,
    categoria: obs.CATEGORIAS.PLATFORM,
    origem: 'test',
    payload: {}
  });
  assert.strictEqual(hits, 1);
  console.log('  OK  subscribe/unsubscribe');

  // 6) Adapters boot/lazy helpers
  const { publishBootEvent } = require('../backend/observabilidade/adapters/bootAdapter');
  const { publishLazyEvent } = require('../backend/observabilidade/adapters/lazyAdapter');
  obs._resetForTests();
  publishBootEvent('HTTP LISTENING', { ms: 10, port: 3001 }, obs.eventBus);
  publishLazyEvent('SERVICE CREATED', { service: 'backup', createdMs: 5 }, obs.eventBus);
  await sleep(40);
  const recent = obs.getRecent(10);
  assert.ok(recent.some((e) => e.event_name === obs.EVENT_NAMES.BOOT_HTTP_LISTENING));
  assert.ok(recent.some((e) => e.event_name === obs.EVENT_NAMES.LAZY_SERVICE_CREATED));
  console.log('  OK  adapters BOOT e LAZY publicam eventos');

  // 7) Fiscal SOAP adapter mapping (sem alterar telemetria)
  const { publishSoapEvent } = require('../backend/observabilidade/adapters/fiscalSoapAdapter');
  obs._resetForTests();
  publishSoapEvent('SOAP_TIMEOUT', {
    correlationId: 'corr-1',
    tempoTotalMs: 5000,
    endpoint: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NFeStatusServico4.asmx',
    xml: '<soap>SEGREDO</soap>',
    cStat: '108'
  }, obs.eventBus);
  await sleep(40);
  const soap = obs.getRecent(5).find((e) => e.event_name === obs.EVENT_NAMES.SOAP_TIMEOUT);
  assert.ok(soap);
  assert.strictEqual(soap.resultado, obs.RESULTADOS.TIMEOUT);
  assert.ok(!JSON.stringify(soap.payload).includes('<soap>'));
  assert.strictEqual(soap.payload.endpoint_host, 'nfce-homologacao.svrs.rs.gov.br');
  console.log('  OK  adapter SOAP publica sem XML completo');

  // 8) Equipment adapter
  const { publishEquipmentRegistro } = require('../backend/observabilidade/adapters/equipmentAdapter');
  obs._resetForTests();
  publishEquipmentRegistro({
    evento: 'EquipmentOffline',
    payload: { equipamentoId: 7, status: 'offline' },
    em: new Date().toISOString()
  }, obs.eventBus);
  await sleep(40);
  assert.ok(obs.getRecent(5).some((e) => e.event_name === obs.EVENT_NAMES.EQUIPMENT_OFFLINE));
  console.log('  OK  adapter Equipment publica offline');

  // 9) Miip report adapter
  const { publishFromReport } = require('../backend/observabilidade/adapters/miipAdapter');
  obs._resetForTests();
  publishFromReport({
    requestId: 'miip-1',
    tempoTotal: 42,
    health: 'WARNING',
    enginesExecutados: ['motor_gtin'],
    warnings: ['x'],
    errors: []
  }, obs.eventBus);
  await sleep(40);
  const names = obs.getRecent(10).map((e) => e.event_name);
  assert.ok(names.includes(obs.EVENT_NAMES.MIIP_IDENTIFY_FINISHED));
  assert.ok(names.includes(obs.EVENT_NAMES.MIIP_HEALTH_DEGRADED));
  console.log('  OK  adapter MIIP publica finished + health degraded');

  // 10) publishAsync
  const asyncResult = await obs.publishAsync({
    event_name: obs.EVENT_NAMES.CENTRAL_SYNC_CONCLUIDA,
    categoria: obs.CATEGORIAS.CENTRAL,
    origem: 'test',
    payload: { tipo: 'SYNC_CONCLUIDA' },
    resultado: 'ok'
  });
  assert.strictEqual(asyncResult.accepted, true);
  assert.strictEqual(asyncResult.envelope.versao_schema, 'obs.v1');
  console.log('  OK  publishAsync retorna envelope aceito');

  console.log('\nRC12.1 contracts OK\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
