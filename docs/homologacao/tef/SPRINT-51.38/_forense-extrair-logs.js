'use strict';
/** SPRINT-51.38 — extrai janela temporal read-only dos logs NativeHost e V$Pague. */
const fs = require('fs');
const path = require('path');

const outDir = __dirname;
const obsPath = path.join(process.env.LOCALAPPDATA || '', 'CDS-SISTEMAS', 'logs', 'destaxa-nativehost-observability.jsonl');
const vspPath = 'C:\\VBI\\V$Pague\\Client\\logs\\vspague-client.log';

// Janela BRT da tentativa: ~16:29:01–16:30:40 (UTC 19:29:01–19:30:40)
const windowStartMs = Date.parse('2026-11-10T19:28:50.000Z');
const windowEndMs = Date.parse('2026-11-10T19:31:00.000Z');

function inWindowIso(iso) {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= windowStartMs && t <= windowEndMs;
}

function extractObs() {
  const lines = fs.readFileSync(obsPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const parsed = [];
  const errors = [];
  for (let i = 0; i < lines.length; i += 1) {
    try {
      parsed.push({ lineNo: i + 1, obj: JSON.parse(lines[i]) });
    } catch (e) {
      errors.push({ lineNo: i + 1, error: e.message, preview: lines[i].slice(0, 120) });
    }
  }

  const inWin = parsed.filter(({ obj }) => {
    const ts = obj.ts || obj.timestamp || obj.registradoEm || obj.em || obj.time || null;
    if (ts && inWindowIso(ts)) return true;
    // também casar por pid 19920 / 10292 se presente
    const blob = JSON.stringify(obj);
    if (blob.includes('19920') || blob.includes('9dd272f1d91f84df') || blob.includes('"transacao_id":2') || blob.includes('"transactionId":2')) {
      if (ts && inWindowIso(ts)) return true;
      // se mencionar ids da operação, incluir mesmo fora — mas marcar
    }
    return false;
  });

  const byPid = parsed.filter(({ obj }) => {
    const blob = JSON.stringify(obj);
    return blob.includes('19920') || blob.includes('"pid":19920') || /ppid["']?\s*:\s*10292/.test(blob);
  });

  // keywords de ciclo
  const keywords = /TX_START|TX_CONTINUE|TX_FINALIZE|INIT_CLIENT|LOAD|ENABLE_REAL|START|CONTINUE|FINALIZE|TIMEOUT|UNKNOWN|99|OPCAO|COLETA|CRT|DLL|iniciaTransacao|continuaTransacao|finalizaTransacao/i;
  const relevantNearby = parsed.filter(({ obj }) => {
    const ts = obj.ts || obj.timestamp || obj.registradoEm || obj.em || null;
    if (!ts || !inWindowIso(ts)) return false;
    return keywords.test(JSON.stringify(obj));
  });

  // últimos 30 eventos com 19920 em qualquer horário recente do dia
  const dayStart = Date.parse('2026-11-10T19:00:00.000Z');
  const dayEnd = Date.parse('2026-11-10T20:00:00.000Z');
  const day19920 = parsed.filter(({ obj }) => {
    const ts = obj.ts || obj.timestamp || obj.registradoEm || obj.em || null;
    const t = ts ? Date.parse(ts) : NaN;
    if (!(t >= dayStart && t <= dayEnd)) return false;
    return JSON.stringify(obj).includes('19920') || JSON.stringify(obj).includes('10292');
  });

  return {
    obsPath,
    totalLines: lines.length,
    parseErrors: errors.length,
    inWindowCount: inWin.length,
    inWindow: inWin.map(({ lineNo, obj }) => ({ lineNo, ...summarize(obj) })),
    relevantNearby: relevantNearby.map(({ lineNo, obj }) => ({ lineNo, ...summarize(obj) })),
    byPidCount: byPid.length,
    day19920Sample: day19920.slice(-80).map(({ lineNo, obj }) => ({ lineNo, ...summarize(obj) })),
    // dump bruto das linhas na janela (para citação)
    rawInWindow: inWin.map(({ lineNo, obj }) => ({ lineNo, raw: obj }))
  };
}

function summarize(obj) {
  return {
    ts: obj.ts || obj.timestamp || obj.registradoEm || obj.em || null,
    event: obj.event || obj.evento || obj.type || obj.tipo || obj.op || obj.operation || null,
    pid: obj.pid || obj.hostPid || obj.nativeHostPid || null,
    ppid: obj.ppid || obj.parentPid || null,
    requestId: obj.requestId || obj.request_id || null,
    operationId: obj.operation_id || obj.operationId || null,
    code: obj.code || obj.codigo || obj.resultCode || obj.retorno || null,
    message: obj.message || obj.mensagem || null,
    keys: Object.keys(obj).slice(0, 24)
  };
}

function extractVspague() {
  const text = fs.readFileSync(vspPath, 'utf8');
  const lines = text.split(/\r?\n/);
  // V$Pague logs costumam ser locais BRT sem Z. Filtrar por 16:28–16:31 e 19:28–19:31
  const reTime = /(16:2[89]|16:3[01]|19:2[89]|19:3[01]):\d{2}/;
  const hit = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!reTime.test(line) && !/pinpad|cart[aã]o|timeout|CRT|d[eé]bito|NSU|autoriz|COM4|PPC|continua|inicia|finaliza|destaxa|transacao|pagamento/i.test(line)) {
      continue;
    }
    if (reTime.test(line) || (i > 0 && reTime.test(lines[i - 1]))) {
      hit.push({ lineNo: i + 1, text: line });
    }
  }
  // também pegar bloco contínuo perto do fim do arquivo (última tentativa)
  const tailStart = Math.max(0, lines.length - 250);
  const tail = [];
  for (let i = tailStart; i < lines.length; i += 1) {
    if (lines[i].trim()) tail.push({ lineNo: i + 1, text: lines[i] });
  }
  return {
    vspPath,
    totalLines: lines.length,
    windowHits: hit.slice(-200),
    tail: tail
  };
}

const obs = extractObs();
const vsp = extractVspague();
fs.writeFileSync(path.join(outDir, '_obs-janela.json'), `${JSON.stringify(obs, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, '_vspague-janela.json'), `${JSON.stringify(vsp, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  obsPath: obs.obsPath,
  obsTotal: obs.totalLines,
  obsInWindow: obs.inWindowCount,
  obsRelevant: obs.relevantNearby.length,
  day19920: obs.day19920Sample.length,
  vspTotal: vsp.totalLines,
  vspHits: vsp.windowHits.length,
  vspTail: vsp.tail.length
}, null, 2));
