'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

function procs() {
  const raw = execSync(
    "powershell -NoProfile -Command \"Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'VSPagueClient.exe' -or ($_.Name -eq 'electron.exe' -and $_.CommandLine -match 'electron-erp\\.js') } | Select-Object ProcessId,Name,ParentProcessId | ConvertTo-Json -Compress\"",
    { encoding: 'utf8', windowsHide: true }
  );
  const p = JSON.parse(raw || 'null');
  return p ? (Array.isArray(p) ? p : [p]) : [];
}

function pinpadPnp() {
  try {
    const raw = execSync(
      "powershell -NoProfile -Command \"Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match 'PPC-920/930' } | Select-Object Name,Status | ConvertTo-Json -Compress\"",
      { encoding: 'utf8', windowsHide: true }
    );
    const p = JSON.parse(raw || 'null');
    return p ? (Array.isArray(p) ? p : [p]) : [];
  } catch (_) {
    return [];
  }
}

const list = procs();
const erp = list.filter((p) => p.Name !== 'VSPagueClient.exe');
const vspague = list.filter((p) => p.Name === 'VSPagueClient.exe');
const db = new DatabaseSync('C:/ProgramData/MercantilFiscal/dados/mercadao.db', { readOnly: true });
const max = db.prepare('SELECT MAX(id) AS maxId FROM tef_transacoes').get();
const pin = db.prepare('SELECT porta_com, codigo, habilitado, ativo FROM tef_pinpads WHERE id=1').get();
const pend = db.prepare("SELECT id, status FROM tef_transacoes WHERE status='pendente' OR lower(coalesce(status,''))='unknown'").all();
const txs = db.prepare('SELECT id,status,nsu,autorizacao,venda_id FROM tef_transacoes WHERE id IN (2,3,4) ORDER BY id').all();
db.close();

const falhas = [];
const gate = process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null;
if (String(gate) === '1') falhas.push('GATE_ON');
if (!erp.length) falhas.push('ERP_AUSENTE');
if (vspague.length !== 1) falhas.push(`VSPAGUE_COUNT_${vspague.length}`);
if (!pin || String(pin.porta_com).toUpperCase() !== 'COM4' || String(pin.codigo).toUpperCase() !== 'GERTEC_PPC930') falhas.push('PINPAD');
if (Number(max.maxId) !== 4) falhas.push(`MAX_${max.maxId}`);
if (pend.length) falhas.push('PENDENTES');

const out = {
  ok: falhas.length === 0,
  gate,
  erp,
  vspague,
  pin,
  pinpadPnp: pinpadPnp(),
  max,
  txs,
  pend,
  falhas,
  preservarProcessos: true
};
fs.writeFileSync(path.join(__dirname, 'precheck.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 2);
