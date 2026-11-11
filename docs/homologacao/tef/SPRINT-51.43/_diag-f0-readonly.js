'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const OUT = path.join(__dirname, 'diag-f0-readonly.json');
const NH = path.join(
  process.env.LOCALAPPDATA || '',
  'CDS-SISTEMAS',
  'logs',
  'destaxa-nativehost-observability.jsonl'
);
const VP = 'C:\\VBI\\V$Pague\\Client\\logs\\vspague-client.log';
const LEDGER = path.join(
  process.env.LOCALAPPDATA || '',
  'CDS-SISTEMAS',
  'tef',
  'destaxa-autorizacao-excepcional.json'
);
const DB = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const CONF_CANDIDATES = [
  'C:\\VBI\\V$Pague\\Client\\V$PagueClient.conf',
  'C:\\VBI\\V$Pague\\Client\\VSPagueClient.conf',
  'C:\\VBI\\V$Pague\\Client\\config\\V$PagueClient.conf',
  'C:\\ProgramData\\MercantilFiscal\\tef\\destaxa.conf'
];

function tailLines(file, maxBytes = 400000) {
  if (!fs.existsSync(file)) return { exists: false, lines: [] };
  const st = fs.statSync(file);
  const start = Math.max(0, st.size - maxBytes);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(st.size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return {
    exists: true,
    size: st.size,
    mtime: st.mtime.toISOString(),
    lines: buf.toString('utf8').split(/\r?\n/)
  };
}

function parseJsonl(lines) {
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch (_) { /* ignore */ }
  }
  return out;
}

function matchF0(text) {
  return /\bF0\b|CLIENT_INITIALIZED|iniciaClientDestaxa|INIT_CLIENT|nao retornou 00/i.test(text);
}

const nhTail = tailLines(NH, 600000);
const nhEvents = parseJsonl(nhTail.lines);
const nhRelevant = nhEvents.filter((e) => {
  const blob = JSON.stringify(e);
  return matchF0(blob)
    || e.functionName === 'iniciaClientDestaxa'
    || e.evento === 'INIT_CLIENT'
    || String(e.codigo || e.code || e.returnCode || '') === 'F0'
    || String(e.clientInitializationCode || '') === 'F0';
});

const recentNh = nhEvents.slice(-40).map((e) => ({
  ts: e.ts || e.em || e.timestamp || e.hora || null,
  evento: e.evento || e.event || e.type || null,
  functionName: e.functionName || null,
  codigo: e.codigo || e.code || e.returnCode || e.clientInitializationCode || null,
  mensagem: e.mensagem || e.message || e.msg || null,
  pid: e.pid || e.processId || null,
  ppid: e.ppid || e.parentPid || null,
  hostSessionId: e.hostSessionId || null,
  transactionId: e.transactionId || e.transacaoId || null
}));

const vpTail = tailLines(VP, 250000);
const vpRelevant = vpTail.lines.filter((l) => matchF0(l) || /60906|COM4|erro|fail|init/i.test(l)).slice(-80);

const confs = [];
for (const p of CONF_CANDIDATES) {
  if (!fs.existsSync(p)) continue;
  const st = fs.statSync(p);
  const raw = fs.readFileSync(p, 'utf8');
  confs.push({
    path: p,
    size: st.size,
    mtime: st.mtime.toISOString(),
    preview: raw.split(/\r?\n/).slice(0, 80).map((line) => {
      if (/senha|password|secret|token|key/i.test(line) && /=/.test(line)) {
        return line.replace(/=.*/, '=***');
      }
      return line;
    })
  });
}

// Discover more confs under VBI without executing
function walkConfs(dir, depth = 0, acc = []) {
  if (depth > 3 || !fs.existsSync(dir)) return acc;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return acc; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkConfs(full, depth + 1, acc);
    else if (/\.conf$/i.test(ent.name) || /destaxa/i.test(ent.name)) {
      try {
        const st = fs.statSync(full);
        acc.push({ path: full, size: st.size, mtime: st.mtime.toISOString() });
      } catch (_) { /* ignore */ }
    }
  }
  return acc;
}
const confInventory = walkConfs('C:\\VBI\\V$Pague');

let ledger = null;
if (fs.existsSync(LEDGER)) {
  try {
    const raw = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
    const auths = (raw.autorizacoes || []).slice(-5).map((a) => ({
      authorizationId: a.authorizationId,
      status: a.status,
      emittedAt: a.emittedAt || a.emitidoEm || null,
      consumedAt: a.consumedAt || a.consumidoEm || null,
      operation: a.operation || a.operacao || null,
      valor: a.valor || null
    }));
    ledger = {
      path: LEDGER,
      mtime: fs.statSync(LEDGER).mtime.toISOString(),
      count: (raw.autorizacoes || []).length,
      recent: auths,
      last: auths[auths.length - 1] || null
    };
  } catch (e) {
    ledger = { path: LEDGER, erro: e.message };
  }
}

const db = new DatabaseSync(DB, { readOnly: true });
const maxTx = db.prepare('SELECT MAX(id) AS id FROM tef_transacoes').get();
const txs = db.prepare(`
  SELECT id, status, valor, tipo, nsu, autorizacao, venda_id, idempotency_key,
         criado_em, atualizado_em, codigo_resposta,
         length(comprovante_cliente) AS len_cli
  FROM tef_transacoes
  ORDER BY id DESC
  LIMIT 8
`).all();
const maxLog = db.prepare('SELECT MAX(id) AS id FROM tef_logs').get();
const logs = db.prepare(`
  SELECT id, transacao_id, tipo, mensagem, substr(payload,1,400) AS p, criado_em
  FROM tef_logs
  ORDER BY id DESC
  LIMIT 20
`).all();
const venda66 = db.prepare('SELECT * FROM vendas WHERE id = 66').get();
const venda66Resumo = venda66
  ? {
      id: venda66.id,
      total: venda66.total,
      status: venda66.status,
      status_pagamento: venda66.status_pagamento,
      tef_transacao_id: venda66.tef_transacao_id,
      forma_pagamento: venda66.forma_pagamento,
      data_venda: venda66.data_venda,
      criado_em: venda66.criado_em,
      updated_at: venda66.updated_at || null
    }
  : null;
const tx2 = db.prepare('SELECT id, status, nsu, autorizacao, venda_id FROM tef_transacoes WHERE id = 2').get();
const tx3 = db.prepare('SELECT id, status, nsu, autorizacao, venda_id FROM tef_transacoes WHERE id = 3').get();
const vendasRecentes = db.prepare(`
  SELECT id, total, status, status_pagamento, tef_transacao_id, forma_pagamento, data_venda
  FROM vendas
  ORDER BY id DESC
  LIMIT 5
`).all();
db.close();

const f0Nh = nhRelevant.slice(-30).map((e) => ({
  ts: e.ts || e.em || e.timestamp || null,
  evento: e.evento || e.event || null,
  functionName: e.functionName || null,
  codigo: e.codigo || e.code || e.returnCode || e.clientInitializationCode || null,
  mensagem: e.mensagem || e.message || null,
  descricao: e.descricao || e.description || null,
  pid: e.pid || null,
  ppid: e.ppid || null,
  rawKeys: Object.keys(e).slice(0, 25)
}));

const out = {
  ts: new Date().toISOString(),
  gateEnv: {
    DESTAXA_REAL_TRANSACTION_ENABLED: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null,
    CDS_TEF_DESTAXA_GATE: process.env.CDS_TEF_DESTAXA_GATE || null
  },
  nativeHostLog: {
    path: NH,
    exists: nhTail.exists,
    size: nhTail.size || null,
    mtime: nhTail.mtime || null,
    eventsParsed: nhEvents.length,
    relevantCount: nhRelevant.length,
    recent: recentNh,
    f0OrInitRelevant: f0Nh
  },
  vspagueLog: {
    path: VP,
    exists: vpTail.exists,
    size: vpTail.size || null,
    mtime: vpTail.mtime || null,
    relevantTail: vpRelevant.slice(-60)
  },
  confs,
  confInventory,
  ledger,
  db: {
    maxTxId: maxTx && maxTx.id,
    maxLogId: maxLog && maxLog.id,
    txs,
    logs: logs.map((l) => ({
      id: l.id,
      transacao_id: l.transacao_id,
      tipo: l.tipo,
      mensagem: l.mensagem,
      criado_em: l.criado_em,
      snippet: l.p
    })),
    venda66: venda66Resumo,
    tx2,
    tx3,
    vendasRecentes
  }
};

fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({
  summary: {
    nhEvents: nhEvents.length,
    nhRelevant: nhRelevant.length,
    vpRelevant: vpRelevant.length,
    maxTxId: out.db.maxTxId,
    maxLogId: out.db.maxLogId,
    gate: out.gateEnv,
    lastTx: txs[0] || null,
    lastLog: out.db.logs[0] || null,
    f0Hits: f0Nh.length,
    lastF0: f0Nh[f0Nh.length - 1] || null
  }
}, null, 2));
