'use strict';
const fs = require('fs');
const path = require('path');

const outDir = __dirname;
const obsPath = path.join(process.env.LOCALAPPDATA || '', 'CDS-SISTEMAS', 'logs', 'destaxa-nativehost-observability.jsonl');
const vspPath = 'C:\\VBI\\V$Pague\\Client\\logs\\vspague-client.log';
const auditoriaCandidates = [
  path.join(process.env.LOCALAPPDATA || '', 'CDS-SISTEMAS', 'logs', 'destaxa-auditoria.jsonl'),
  path.join(process.env.LOCALAPPDATA || '', 'CDS-SISTEMAS', 'tef', 'destaxa-auditoria.jsonl'),
  path.join(process.env.LOCALAPPDATA || '', 'CDS-SISTEMAS', 'logs', 'tef-destaxa.jsonl')
];

const start = Date.parse('2026-11-10T19:28:55.000Z');
const end = Date.parse('2026-11-10T19:31:10.000Z');

function tsOf(obj) {
  return obj.ts || obj.timestamp || obj.registradoEm || obj.em || obj.time || obj.at || null;
}

function pick(obj) {
  return {
    ts: tsOf(obj),
    event: obj.event || obj.evento || obj.type || obj.tipo || obj.op || obj.name || null,
    pid: obj.pid || obj.hostPid || null,
    ppid: obj.ppid || obj.parentPid || null,
    requestId: obj.requestId || obj.request_id || null,
    operationId: obj.operation_id || obj.operationId || null,
    transactionId: obj.transactionId || obj.transacao_id || obj.transaction_id || null,
    code: obj.code || obj.codigo || obj.resultCode || obj.retorno || obj.codigoDestaxa || null,
    message: obj.message || obj.mensagem || obj.msg || null,
    direction: obj.direction || obj.direcao || obj.phase || null,
    dll: obj.dll || obj.dllCall || obj.export || obj.fn || null,
    rawKeys: Object.keys(obj)
  };
}

const lines = fs.readFileSync(obsPath, 'utf8').split(/\r?\n/).filter(Boolean);
const focused = [];
const dllRelated = [];
for (let i = 0; i < lines.length; i += 1) {
  let obj;
  try { obj = JSON.parse(lines[i]); } catch (_) { continue; }
  const ts = tsOf(obj);
  const t = ts ? Date.parse(ts) : NaN;
  const blob = lines[i];
  const inWin = Number.isFinite(t) && t >= start && t <= end;
  const mentions = /19920|9dd272f1|op_be24a55bc6bf|\"transactionId\":2|\"transacao_id\":2|TX_START|TX_CONTINUE|TX_FINALIZE|ENABLE_REAL|iniciaTransacao|continuaTransacao|finalizaTransacao|INIT_CLIENT|LOAD\b/.test(blob);
  if (inWin || (mentions && Number.isFinite(t) && t >= start - 60000 && t <= end + 60000)) {
    focused.push({ lineNo: i + 1, ...pick(obj), snippet: blob.slice(0, 500) });
  }
  if (inWin && /dll|iniciaTransacao|continuaTransacao|finalizaTransacao|TX_|ENABLE_REAL|LOAD|INIT/i.test(blob)) {
    dllRelated.push({ lineNo: i + 1, ...pick(obj), snippet: blob.slice(0, 700) });
  }
}

// Sequência ordenada
focused.sort((a, b) => String(a.ts).localeCompare(String(b.ts)) || (a.lineNo - b.lineNo));

const vspText = fs.readFileSync(vspPath, 'utf8').split(/\r?\n/);
const vspFocus = [];
for (let i = 0; i < vspText.length; i += 1) {
  const line = vspText[i];
  if (/16:29|16:30|19:29|19:30/.test(line) || (/pinpad|cart|timeout|CRT|NSU|autoriz|PPC|COM|d[eé]bito|cancel|09|99|transac/i.test(line) && i > vspText.length - 300)) {
    vspFocus.push({ lineNo: i + 1, text: line });
  }
}

const auditorias = [];
for (const p of auditoriaCandidates) {
  if (!fs.existsSync(p)) continue;
  const alines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
  const hits = [];
  for (let i = 0; i < alines.length; i += 1) {
    if (/9dd272f1|op_be24a55bc6bf|19920|TX_START|TX_CONTINUE|\"transactionId\":.?2|transacao.?2|19:29|19:30/.test(alines[i])) {
      hits.push({ lineNo: i + 1, preview: alines[i].slice(0, 400) });
    }
  }
  auditorias.push({ path: p, hits: hits.slice(-100), total: alines.length });
}

const out = {
  focusedCount: focused.length,
  focused,
  dllRelated,
  vspFocus: vspFocus.slice(-180),
  auditorias,
  // síntese de códigos
  codesSeen: [...new Set(focused.map((e) => e.code).filter(Boolean))],
  eventsSeen: [...new Set(focused.map((e) => e.event).filter(Boolean))]
};

fs.writeFileSync(path.join(outDir, '_ciclo-foco.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({
  focused: focused.length,
  dllRelated: dllRelated.length,
  vspFocus: out.vspFocus.length,
  eventsSeen: out.eventsSeen.slice(0, 40),
  codesSeen: out.codesSeen,
  first: focused[0],
  last: focused[focused.length - 1]
}, null, 2));
