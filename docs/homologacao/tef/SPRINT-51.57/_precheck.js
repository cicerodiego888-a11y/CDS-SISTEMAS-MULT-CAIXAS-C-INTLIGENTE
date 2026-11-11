'use strict';
const { execSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

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

process.env.DESTAXA_REAL_TRANSACTION_ENABLED = process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '0';
const list = procs();
const vspague = list.filter((x) => x.Name === 'VSPagueClient.exe');
const erp = list.filter((x) => x.Name !== 'VSPagueClient.exe');
const db = new DatabaseSync('C:/ProgramData/MercantilFiscal/dados/mercadao.db', { readOnly: true });
const pin = db.prepare('SELECT porta_com, codigo, habilitado, ativo FROM tef_pinpads WHERE id=1').get();
const max = db.prepare('SELECT MAX(id) AS maxId FROM tef_transacoes').get();
db.close();

const falhas = [];
if (erp.length) falhas.push(`ERP_JA_ATIVO=${erp.map((e) => e.ProcessId).join(',')}`);
if (vspague.length !== 1) falhas.push(`VSPAGUE_COUNT=${vspague.length}`);
else if (Number(vspague[0].ProcessId) !== 22380) falhas.push(`VSPAGUE_PID_ESPERADO_22380_ATUAL_${vspague[0].ProcessId}`);
if (!pin || String(pin.porta_com).toUpperCase() !== 'COM4' || String(pin.codigo).toUpperCase() !== 'GERTEC_PPC930') {
  falhas.push('PINPAD_CONFIG');
}
if (String(process.env.DESTAXA_REAL_TRANSACTION_ENABLED) === '1') falhas.push('GATE_ON');

const out = {
  ok: falhas.length === 0,
  gate: process.env.DESTAXA_REAL_TRANSACTION_ENABLED,
  vspague,
  erp,
  pin,
  pinpadPnp: pinpadPnp(),
  max,
  falhas
};
fs.writeFileSync(path.join(__dirname, 'precheck.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 2);
