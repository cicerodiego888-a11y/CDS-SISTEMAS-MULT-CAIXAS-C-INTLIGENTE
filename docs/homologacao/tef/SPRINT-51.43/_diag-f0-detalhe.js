'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const OUT = path.join(__dirname, 'diag-f0-detalhe.json');
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
const WINDOW_START = '2026-11-10T21:40:00.000Z';
const WINDOW_END = '2026-11-10T21:55:00.000Z';

function inWindow(ts) {
  if (!ts) return false;
  const t = String(ts);
  return t >= WINDOW_START && t <= WINDOW_END;
}

function extractTs(e) {
  return e.ts || e.em || e.timestamp || e.registradoEm || e.hora || null;
}

const nhRaw = fs.readFileSync(NH, 'utf8').split(/\r?\n/);
const nh = [];
for (const line of nhRaw) {
  const t = line.trim();
  if (!t) continue;
  try { nh.push(JSON.parse(t)); } catch (_) { /* ignore */ }
}

const nhWindow = nh.filter((e) => inWindow(extractTs(e)));
const nhF0 = nh.filter((e) => {
  const blob = JSON.stringify(e);
  return /\bF0\b/.test(blob) || e.resultCode === 'F0' || e.codigo === 'F0' || e.codigoDestaxa === 'F0';
}).slice(-20);

const nhInit = nh.filter((e) => {
  const fn = e.functionName || '';
  const ev = e.evento || e.event || e.tipo || '';
  return fn === 'iniciaClientDestaxa'
    || /client\.init|INIT_CLIENT|iniciarClient/i.test(String(ev))
    || /iniciaClientDestaxa/.test(JSON.stringify(e));
}).slice(-25);

const vpLines = fs.existsSync(VP) ? fs.readFileSync(VP, 'utf8').split(/\r?\n/) : [];
const vpWindow = vpLines.filter((l) => {
  // local times often like 2026-11-10 18:46 or ISO
  return /2026-11-10[ T](18:4[0-9]|18:5[0-5]|21:4[0-9]|21:5[0-5])/.test(l)
    || /\bF0\b|init|60906|erro|fail|Client/i.test(l);
}).slice(-100);

const db = new DatabaseSync(DB, { readOnly: true });
const logs40 = db.prepare(`
  SELECT id, transacao_id, tipo, mensagem, payload, criado_em
  FROM tef_logs WHERE id >= 39 ORDER BY id
`).all();
const countTx = db.prepare('SELECT COUNT(*) AS n FROM tef_transacoes').get();
const maxTx = db.prepare('SELECT MAX(id) AS id FROM tef_transacoes').get();
const tx3 = db.prepare(`
  SELECT id, status, nsu, autorizacao, venda_id, valor, atualizado_em
  FROM tef_transacoes WHERE id = 3
`).get();
const tx2 = db.prepare(`
  SELECT id, status, nsu, autorizacao, venda_id FROM tef_transacoes WHERE id = 2
`).get();
const venda66 = db.prepare(`
  SELECT id, total, status, status_pagamento, tef_transacao_id, forma_pagamento
  FROM vendas WHERE id = 66
`).get();
const receb66 = db.prepare(`
  SELECT id, valor, status, tef_transacao_id FROM venda_recebimentos WHERE venda_id = 66
`).all();
const pag66 = db.prepare(`
  SELECT id, valor, tef_transacao_id, tef_nsu, tef_autorizacao FROM venda_pagamentos WHERE venda_id = 66
`).all();
db.close();

let ledger = null;
if (fs.existsSync(LEDGER)) {
  const raw = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  ledger = {
    mtime: fs.statSync(LEDGER).mtime.toISOString(),
    autorizacoes: (raw.autorizacoes || []).map((a) => ({
      authorizationId: a.authorizationId,
      status: a.status,
      emittedAt: a.emittedAt || a.emitidoEm || a.criadoEm || null,
      consumedAt: a.consumedAt || a.consumidoEm || null,
      valor: a.valor,
      modalidade: a.modalidade || a.tipo || null,
      vendaId: a.vendaId || a.venda_id || null
    }))
  };
}

function compact(e) {
  return {
    ts: extractTs(e),
    evento: e.evento || e.event || e.tipo || null,
    functionName: e.functionName || null,
    operation: e.operation || null,
    resultCode: e.resultCode || e.codigo || e.codigoDestaxa || e.code || null,
    errorCode: e.errorCode || null,
    mensagem: e.mensagem || e.message || null,
    descricao: e.descricao || e.descricaoCodigo || null,
    sucesso: e.sucesso,
    estado: e.estado || null,
    pid: e.pid || e.pidHost || null,
    pidPai: e.pidPai || e.ppid || null,
    requestId: e.requestId || null,
    transactionId: e.transactionId || e.transacaoId || null,
    hostSessionId: e.hostSessionId || null
  };
}

const out = {
  ts: new Date().toISOString(),
  window: { start: WINDOW_START, end: WINDOW_END },
  conclusaoTentativa: {
    maxTxId: maxTx.id,
    countTx: countTx.n,
    novaTransacaoCriada: Number(maxTx.id) > 3 ? true : false,
    tx2Intacta: tx2,
    tx3Intacta: tx3,
    venda66Intacta: venda66,
    recebimentos66: receb66,
    pagamentos66: pag66
  },
  tefLogsNovos: logs40.map((l) => {
    let payload = null;
    try { payload = JSON.parse(l.payload || '{}'); } catch (_) { payload = l.payload; }
    return {
      id: l.id,
      transacao_id: l.transacao_id,
      tipo: l.tipo,
      mensagem: l.mensagem,
      criado_em: l.criado_em,
      payload
    };
  }),
  nhWindow: nhWindow.map(compact),
  nhInitRecent: nhInit.map(compact),
  nhF0Recent: nhF0.map(compact),
  vpWindowTail: vpWindow.slice(-80),
  ledger,
  f0Contrato: {
    codigo: 'F0',
    fonte: 'backend/services/tef/destaxa/destaxaConstantes.js (docs/09-tabela-codigos-de-retorno.md Destaxa 1.83)',
    descricao: 'A chamada a API é invalida. Este erro pode aconter quando chamar alguma API na sequencia errada.',
    classificacaoCds: 'ERROR (não SUCCESS, não DENIED, não INEXISTENT, não UNKNOWN financeiro de TX)'
  }
};

fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({
  maxTxId: maxTx.id,
  logsNovos: logs40.map((l) => ({ id: l.id, tipo: l.tipo, msg: l.mensagem, tx: l.transacao_id, em: l.criado_em })),
  nhWindowCount: nhWindow.length,
  nhF0Count: nhF0.length,
  lastF0: nhF0.slice(-3).map(compact),
  lastInit: nhInit.slice(-5).map(compact),
  leaseLog: logs40.find((l) => l.id === 42) ? {
    id: 42,
    mensagem: logs40.find((l) => l.id === 42).mensagem
  } : null
}, null, 2));
