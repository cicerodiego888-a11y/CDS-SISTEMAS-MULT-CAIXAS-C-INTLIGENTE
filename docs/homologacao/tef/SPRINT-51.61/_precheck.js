'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

function psJson(cmd) {
  const raw = execSync(`powershell -NoProfile -Command "${cmd}"`, {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true
  }).trim();
  if (!raw) return [];
  const p = JSON.parse(raw);
  return Array.isArray(p) ? p : [p];
}

const all = psJson(
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'electron|VSPague' } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"
);
const pinPnp = psJson(
  "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match 'PPC-920/930' } | Select-Object Name,Status | ConvertTo-Json -Compress"
);

const erp = all.filter((p) => String(p.CommandLine || '').includes('electron-erp.js'));
const probe = all.filter((p) => String(p.CommandLine || '').includes('tef-51-59-init-persistente.js'));
const vsp = all.filter((p) => /VSPagueClient/i.test(p.Name || ''));

const db = new DatabaseSync('C:/ProgramData/MercantilFiscal/dados/mercadao.db', { readOnly: true });
const max = db.prepare('SELECT MAX(id) AS maxId FROM tef_transacoes').get();
const pin = db.prepare('SELECT porta_com, codigo, habilitado, ativo FROM tef_pinpads WHERE id=1').get();
const pend = db.prepare(
  "SELECT id, status FROM tef_transacoes WHERE status='pendente' OR lower(coalesce(status,''))='unknown'"
).all();
const txs = db.prepare(
  'SELECT id,status,nsu,autorizacao,venda_id FROM tef_transacoes WHERE id IN (2,3,4) ORDER BY id'
).all();
const venda67 = db.prepare(
  'SELECT id, status, tef_transacao_id FROM vendas WHERE id=67'
).get();
db.close();

const gate = process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '0';
const falhas = [];
if (String(gate) === '1') falhas.push('GATE_ON');
if (vsp.length !== 1) falhas.push(`VSPAGUE_COUNT_${vsp.length}`);
if (!pin || String(pin.porta_com).toUpperCase() !== 'COM4' || String(pin.codigo).toUpperCase() !== 'GERTEC_PPC930') {
  falhas.push('PINPAD');
}
if (Number(max.maxId) !== 4) falhas.push(`MAX_${max.maxId}`);
if (pend.length) falhas.push('PENDENTES');
if (!venda67 || Number(venda67.tef_transacao_id) !== 4) falhas.push('VENDA67');

const out = {
  ok: falhas.length === 0,
  gate,
  erp: erp.map((p) => ({
    ProcessId: p.ProcessId,
    ParentProcessId: p.ParentProcessId,
    CommandLine: String(p.CommandLine || '').slice(0, 200)
  })),
  probe59: probe.map((p) => ({
    ProcessId: p.ProcessId,
    ParentProcessId: p.ParentProcessId
  })),
  vspague: vsp.map((p) => ({
    ProcessId: p.ProcessId,
    ParentProcessId: p.ParentProcessId
  })),
  pin,
  pinpadPnp: pinPnp,
  max,
  txs,
  venda67,
  pend,
  falhas,
  naoReutilizarProbe10756: true
};

fs.writeFileSync(path.join(__dirname, 'precheck.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 2);
