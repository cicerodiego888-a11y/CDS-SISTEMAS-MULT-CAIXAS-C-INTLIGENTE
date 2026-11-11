'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const LEDGER = path.join(
  process.env.LOCALAPPDATA || '',
  'CDS-SISTEMAS',
  'tef',
  'destaxa-autorizacao-excepcional.json'
);
const AUTH_ID = 'c3fb636267106ce343ca300d64cf7041';

const db = new DatabaseSync(DB, { readOnly: true });

function safeParse(s) {
  if (s == null || s === '') return null;
  try { return JSON.parse(s); } catch (_) { return { _parseError: true, preview: String(s).slice(0, 200) }; }
}

const vendaCols = db.prepare('PRAGMA table_info(vendas)').all().map((c) => c.name);

const vendaFull = db.prepare('SELECT * FROM vendas WHERE id = 67').get();
const vendaSlim = {};
for (const k of Object.keys(vendaFull || {})) {
  const v = vendaFull[k];
  if (typeof v === 'string' && v.length > 400) {
    vendaSlim[k] = {
      length: v.length,
      head: v.slice(0, 120),
      has211139: v.includes('211139'),
      hasCard: /<card[\s>]/i.test(v)
    };
  } else {
    vendaSlim[k] = v;
  }
}

const tefByVenda = db.prepare(`
  SELECT id, status, nsu, autorizacao, venda_id, valor, tipo, provedor,
         idempotency_key, bandeira, adquirente, codigo_transacao,
         length(comprovante_cliente) AS len_cli,
         length(comprovante_estabelecimento) AS len_est,
         criado_em, atualizado_em, payload_retorno
  FROM tef_transacoes WHERE venda_id = 67 ORDER BY id
`).all();

const tefMax = db.prepare(`
  SELECT id, status, nsu, autorizacao, venda_id, valor, tipo, provedor,
         idempotency_key, bandeira, adquirente, codigo_transacao,
         length(comprovante_cliente) AS len_cli,
         length(comprovante_estabelecimento) AS len_est,
         criado_em, atualizado_em, payload_retorno
  FROM tef_transacoes ORDER BY id DESC LIMIT 5
`).all();

const tx3 = db.prepare(`
  SELECT id, status, nsu, autorizacao, venda_id, valor, idempotency_key,
         length(comprovante_cliente) AS len_cli,
         length(comprovante_estabelecimento) AS len_est
  FROM tef_transacoes WHERE id = 3
`).get();

const tx67ids = tefByVenda.map((t) => t.id);
const tefs = tefByVenda.length ? tefByVenda : tefMax.filter((t) => Number(t.venda_id) === 67);

function summarizeTef(row) {
  if (!row) return null;
  const payload = safeParse(row.payload_retorno);
  let financialState = null;
  try {
    financialState = payload?.financialState
      || payload?.resultadoTardio?.financialState
      || payload?.cicloCrt?.financialState
      || null;
  } catch (_) { /* */ }
  return {
    id: row.id,
    status: row.status,
    nsu: row.nsu,
    autorizacao: row.autorizacao,
    venda_id: row.venda_id,
    valor: row.valor,
    tipo: row.tipo,
    provedor: row.provedor,
    idempotency_key: row.idempotency_key,
    bandeira: row.bandeira,
    adquirente: row.adquirente,
    codigo_transacao: row.codigo_transacao,
    len_cli: row.len_cli,
    len_est: row.len_est,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em,
    financialState,
    payloadKeys: payload && !payload._parseError ? Object.keys(payload) : null,
    payloadPreview: payload
  };
}

const nfce = db.prepare(`
  SELECT id, venda_id, numero, serie, chave_acesso, cstat, xmotivo, protocolo,
         status, criado_em, atualizado_em,
         length(xml_enviado) AS len_env,
         length(xml_autorizado) AS len_aut,
         length(xml_assinado) AS len_ass,
         length(xml_retorno) AS len_ret,
         xml_enviado, xml_autorizado, xml_assinado, xml_retorno
  FROM nfce_notas WHERE venda_id = 67 ORDER BY id DESC LIMIT 3
`).all().map((n) => {
  const xmls = {
    xml_enviado: n.xml_enviado,
    xml_autorizado: n.xml_autorizado,
    xml_assinado: n.xml_assinado,
    xml_retorno: n.xml_retorno
  };
  const cardExtract = {};
  for (const [k, xml] of Object.entries(xmls)) {
    if (!xml) { cardExtract[k] = null; continue; }
    const cardMatch = xml.match(/<card[\s\S]*?<\/card>/i);
    const cAut = (xml.match(/<cAut>([^<]*)<\/cAut>/i) || [])[1] || null;
    const cStat = (xml.match(/<cStat>([^<]*)<\/cStat>/i) || [])[1] || null;
    cardExtract[k] = {
      length: xml.length,
      has211139: xml.includes('211139'),
      cAut,
      cStatInXml: cStat,
      card: cardMatch ? cardMatch[0] : null
    };
  }
  return {
    id: n.id,
    venda_id: n.venda_id,
    numero: n.numero,
    serie: n.serie,
    chave_acesso: n.chave_acesso,
    cstat: n.cstat,
    xmotivo: n.xmotivo,
    protocolo: n.protocolo,
    status: n.status,
    criado_em: n.criado_em,
    atualizado_em: n.atualizado_em,
    lens: { env: n.len_env, aut: n.len_aut, ass: n.len_ass, ret: n.len_ret },
    cardExtract
  };
});

let recebimentos = [];
try {
  recebimentos = db.prepare(`
    SELECT * FROM venda_recebimentos WHERE venda_id = 67
  `).all().map((r) => {
    const o = { ...r };
    for (const k of Object.keys(o)) {
      if (typeof o[k] === 'string' && o[k].length > 300) o[k] = `[len=${o[k].length}]`;
    }
    return o;
  });
} catch (e) {
  recebimentos = { erro: e.message };
}

let pagamentos = [];
try {
  pagamentos = db.prepare(`SELECT * FROM venda_pagamentos WHERE venda_id = 67`).all();
} catch (e) {
  pagamentos = { erro: e.message };
}

const tefLogs = [];
for (const id of (tefs.length ? tefs : tefMax).map((t) => t.id).slice(0, 5)) {
  try {
    const logs = db.prepare(`
      SELECT id, transacao_id, tipo, mensagem, criado_em,
             substr(cast(detalhes as text), 1, 500) AS detalhes_head
      FROM tef_logs WHERE transacao_id = ? ORDER BY id DESC LIMIT 20
    `).all(id);
    tefLogs.push({ transacao_id: id, logs });
  } catch (_) { /* */ }
}

db.close();

let ledgerAuth = null;
let ledgerIssued = [];
if (fs.existsSync(LEDGER)) {
  const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  ledgerAuth = (ledger.autorizacoes || []).find((a) => a.authorizationId === AUTH_ID) || null;
  ledgerIssued = (ledger.autorizacoes || [])
    .filter((a) => a.status === 'ISSUED')
    .map((a) => ({ id: a.authorizationId, expiresAt: a.expiresAt, motivo: a.motivo }));
}

const out = {
  vendaColsSample: vendaCols.filter((c) => /tef|nfce|status|total|forma|xml|cstat|autoriz/i.test(c)),
  vendaSlim,
  tefByVenda: tefByVenda.map(summarizeTef),
  tefMaxRecent: tefMax.map(summarizeTef),
  tx3,
  nfce,
  recebimentos,
  pagamentos,
  tefLogs,
  ledgerAuth,
  ledgerIssued,
  authIdAlvo: AUTH_ID
};

const outPath = path.join(__dirname, 'diag-raw.json');
fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  wrote: outPath,
  venda_tef_id: vendaSlim.tef_transacao_id,
  tefByVendaIds: tefByVenda.map((t) => t.id),
  maxRecent: tefMax.map((t) => ({ id: t.id, venda_id: t.venda_id, status: t.status, auth: t.autorizacao, nsu: t.nsu })),
  ledgerStatus: ledgerAuth?.status || null,
  consumidoEm: ledgerAuth?.consumidoEm || null,
  nfceCstat: nfce.map((n) => ({ id: n.id, cstat: n.cstat, xmotivo: n.xmotivo, cAut: n.cardExtract?.xml_enviado?.cAut || n.cardExtract?.xml_assinado?.cAut }))
}, null, 2));
