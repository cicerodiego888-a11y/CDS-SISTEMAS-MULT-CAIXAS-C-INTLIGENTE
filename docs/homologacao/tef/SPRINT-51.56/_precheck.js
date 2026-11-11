'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { execSync } = require('child_process');

const AUTH_51_49 = path.join(
  __dirname,
  '..',
  'SPRINT-51.49',
  'evidencias-init.json'
);

function listProcs() {
  try {
    const raw = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq \'VSPagueClient.exe\' -or ($_.CommandLine -match \'electron-erp\\\\.js\') } | Select-Object ProcessId,Name,ParentProcessId,@{N=\'Cmd\';E={ if ($_.CommandLine) { $_.CommandLine.Substring(0,[Math]::Min(140,$_.CommandLine.Length)) } else {\'\'} }} | ConvertTo-Json -Compress"',
      { encoding: 'utf8', windowsHide: true }
    );
    const parsed = JSON.parse(raw || 'null');
    return parsed ? (Array.isArray(parsed) ? parsed : [parsed]) : [];
  } catch (_) {
    return [];
  }
}

function pinpadPnp() {
  try {
    const raw = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match \'PPC-920/930|Gertec|COM4\' } | Select-Object Name,Status | ConvertTo-Json -Compress"',
      { encoding: 'utf8', windowsHide: true }
    );
    const parsed = JSON.parse(raw || 'null');
    return parsed ? (Array.isArray(parsed) ? parsed : [parsed]) : [];
  } catch (_) {
    return [];
  }
}

const db = new DatabaseSync('C:/ProgramData/MercantilFiscal/dados/mercadao.db', { readOnly: true });
const max = db.prepare('SELECT MAX(id) AS maxId, COUNT(*) AS total FROM tef_transacoes').get();
const txs = db.prepare(`
  SELECT id, status, nsu, autorizacao, venda_id, bandeira, adquirente
  FROM tef_transacoes WHERE id IN (2,3,4) ORDER BY id
`).all();
const v67 = db.prepare(`
  SELECT id, status, status_pagamento, tef_transacao_id, total, forma_pagamento
  FROM vendas WHERE id = 67
`).get();
const pend = db.prepare(`
  SELECT id, status FROM tef_transacoes
  WHERE status = 'pendente' OR lower(coalesce(status,'')) = 'unknown'
`).all();
const pin = db.prepare(`
  SELECT id, porta_com, codigo, fabricante, modelo, habilitado, ativo
  FROM tef_pinpads WHERE id = 1
`).get();
db.close();

const procs = listProcs();
const vspague = procs.filter((p) => p.Name === 'VSPagueClient.exe');
const erp = procs.filter((p) => String(p.Cmd || '').includes('electron-erp'));

let init49 = null;
if (fs.existsSync(AUTH_51_49)) {
  init49 = JSON.parse(fs.readFileSync(AUTH_51_49, 'utf8'));
}

const ledgerPath = path.join(
  process.env.LOCALAPPDATA || '',
  'CDS-SISTEMAS',
  'tef',
  'destaxa-autorizacao-excepcional.json'
);
let issued = [];
if (fs.existsSync(ledgerPath)) {
  const j = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  issued = (j.autorizacoes || []).filter((a) => a.status === 'ISSUED');
}

const falhas = [];
if (String(process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '') === '1') {
  falhas.push('GATE_GLOBAL_ON');
}
if (vspague.length !== 1) falhas.push(`VSPAGUE_COUNT=${vspague.length}`);
if (erp.length < 1) falhas.push('ERP_AUSENTE');
if (Number(max.maxId) !== 4) falhas.push(`MAX_TEF_ESPERADO_4_ATUAL_${max.maxId}`);
if (pend.length) falhas.push(`PENDENTES=${pend.map((p) => p.id).join(',')}`);
if (!pin || String(pin.porta_com).toUpperCase() !== 'COM4' || String(pin.codigo).toUpperCase() !== 'GERTEC_PPC930') {
  falhas.push('PINPAD_CONFIG');
}
if (Number(pin?.habilitado) !== 1 || Number(pin?.ativo) !== 1) falhas.push('PINPAD_INATIVO');
if (!v67 || Number(v67.tef_transacao_id) !== 4 || v67.status !== 'concluida') falhas.push('VENDA67');
if (issued.length) falhas.push(`ISSUED_EXISTENTE=${issued[0].authorizationId}`);

const hostPid49 = init49?.nativeHost?.pid || null;
const mesmaSessaoInit = false; // ERP foi reiniciado após 51.49; NativeHost 14256 não é a sessão atual
const precisaInitNovo = true;

const out = {
  ok: falhas.length === 0 && !precisaInitNovo ? true : falhas.length === 0,
  classificacao: precisaInitNovo
    ? 'BLOQUEADO_INIT_NOVA_SESSAO'
    : (falhas.length ? 'BLOQUEADO_PRECHECK' : 'READY_EMITIR_ONESHOT'),
  falhas,
  gate: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null,
  procs: { vspague, erp },
  pinpadDb: pin,
  pinpadPnp: pinpadPnp(),
  max,
  txs,
  v67,
  pend,
  issued,
  init49: init49 ? {
    requestHint: init49.initClient?.requestCorrelacao || null,
    hostPid: hostPid49,
    hostSessionId: init49.nativeHost?.hostSessionId || null,
    fim: init49.fim || null,
    codigo: init49.initClient?.clientResultCode || null
  } : null,
  mesmaSessaoInit,
  precisaInitNovo,
  motivoInit: 'ERP/NativeHost da evidência 51.49 (Host PID 14256) não correspondem à sessão atual pós-reinício 51.51; novo INIT_CLIENT exigiria autorização específica do PO.'
};

fs.writeFileSync(path.join(__dirname, 'precheck.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
process.exit(precisaInitNovo || falhas.length ? 2 : 0);
