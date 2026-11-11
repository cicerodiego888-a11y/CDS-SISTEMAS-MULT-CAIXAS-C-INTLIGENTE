'use strict';

const fs = require('fs');
const path = require('path');

const NH = path.join(
  process.env.LOCALAPPDATA || '',
  'CDS-SISTEMAS',
  'logs',
  'destaxa-nativehost-observability.jsonl'
);
const OUT = path.join(__dirname, 'diag-f0-sequencia.json');

const lines = fs.readFileSync(NH, 'utf8').split(/\r?\n/);
const events = [];
for (const line of lines) {
  const t = line.trim();
  if (!t) continue;
  try { events.push(JSON.parse(t)); } catch (_) { /* ignore */ }
}

function ts(e) {
  return e.ts || e.em || e.timestamp || e.registradoEm || null;
}

function interesting(e) {
  const blob = JSON.stringify(e);
  return /iniciaClientDestaxa|INIT_CLIENT|client\.init|LOAD|TX_START|iniciaTransacao|FINALIZE|clientInitialized|F0|A1|resultCode/i.test(blob);
}

const fromRestart = events.filter((e) => {
  const t = ts(e);
  return t && t >= '2026-11-10T21:40:00.000Z';
}).filter(interesting);

const inits = events.filter((e) => {
  const fn = e.functionName || '';
  const ev = e.evento || e.tipo || '';
  return fn === 'iniciaClientDestaxa'
    || ev === 'client.init.result'
    || ev === 'client.init.start'
    || (e.operation === 'INIT_CLIENT')
    || (ev === 'native.call.return' && fn === 'iniciaClientDestaxa');
}).map((e) => ({
  ts: ts(e),
  evento: e.evento || e.tipo || null,
  functionName: e.functionName || null,
  operation: e.operation || null,
  resultCode: e.resultCode || e.codigo || e.codigoDestaxa || null,
  sucesso: e.sucesso,
  estado: e.estado || null,
  pid: e.pid || e.pidHost || null,
  pidPai: e.pidPai || null,
  requestId: e.requestId || null,
  clientInitialized: e.clientInitialized
    ?? e.diagnostics?.clientInitialized
    ?? e.diagnostico?.clientInitialized
    ?? null
}));

const lastOkInit = [...inits].reverse().find((e) => e.resultCode === '00' || e.sucesso === true);
const f0Inits = inits.filter((e) => e.resultCode === 'F0');
const todayInits = inits.filter((e) => String(e.ts || '').startsWith('2026-11-10'));

// Counts of INIT attempts in window
const windowInits = todayInits.filter((e) => e.ts >= '2026-11-10T21:40:00.000Z');

const loadEvents = events.filter((e) => {
  const ev = e.evento || e.tipo || e.operation || '';
  return /LOAD|dll\.load|nativehost\.load/i.test(String(ev))
    || e.operation === 'LOAD';
}).slice(-20).map((e) => ({
  ts: ts(e),
  evento: e.evento || e.tipo || null,
  operation: e.operation || null,
  resultCode: e.resultCode || e.codigo || null,
  pid: e.pid || e.pidHost || null,
  requestId: e.requestId || null
}));

const txStartInWindow = events.filter((e) => {
  const t = ts(e);
  if (!t || t < '2026-11-10T21:40:00.000Z') return false;
  const blob = JSON.stringify(e);
  return /TX_START|iniciaTransacaoDestaxa|CRT/.test(blob);
}).map((e) => ({
  ts: ts(e),
  evento: e.evento || e.tipo || null,
  functionName: e.functionName || null,
  operation: e.operation || null,
  resultCode: e.resultCode || e.codigo || null,
  requestId: e.requestId || null
}));

const out = {
  lastOkInit: lastOkInit || null,
  f0CountTotal: f0Inits.length,
  f0Today: f0Inits.filter((e) => String(e.ts || '').startsWith('2026-11-10T21:')),
  windowInitTimeline: windowInits,
  loadRecent: loadEvents,
  txStartInWindow,
  fromRestartSample: fromRestart.slice(0, 40).map((e) => ({
    ts: ts(e),
    evento: e.evento || e.tipo || null,
    functionName: e.functionName || null,
    operation: e.operation || null,
    resultCode: e.resultCode || e.codigo || e.codigoDestaxa || null,
    estado: e.estado || null,
    requestId: e.requestId || null,
    pid: e.pid || e.pidHost || null
  }))
};

fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({
  lastOkInit,
  f0Tonight: out.f0Today.length,
  windowInits: windowInits.length,
  txStartInWindow: txStartInWindow.length,
  loadRecent: loadEvents.slice(-5),
  timeline: windowInits
}, null, 2));
