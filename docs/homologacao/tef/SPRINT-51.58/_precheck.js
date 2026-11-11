'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const EXPECT = {
  erpPid: 20032,
  vspaguePid: 22380,
  hostPid5157: 14896,
  hostSessionId: '8d85143db0322f5c238e120fe9670884',
  initRequestId: '64d60ea12682ae38'
};

function procs() {
  const raw = execSync(
    "powershell -NoProfile -Command \"Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'VSPagueClient.exe' -or ($_.Name -eq 'electron.exe' -and $_.CommandLine -match 'electron-erp\\.js') -or ($_.CommandLine -match 'DestaxaNativeHost|native-host|destaxa.*host') } | Select-Object ProcessId,Name,ParentProcessId,@{N='Cmd';E={ if ($_.CommandLine) { $_.CommandLine.Substring(0,[Math]::Min(160,$_.CommandLine.Length)) } else {''} }} | ConvertTo-Json -Compress\"",
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

function processAlive(pid) {
  if (!pid) return false;
  try {
    execSync(`powershell -NoProfile -Command \"Get-Process -Id ${Number(pid)} -ErrorAction Stop | Out-Null\"`, {
      encoding: 'utf8',
      windowsHide: true
    });
    return true;
  } catch (_) {
    return false;
  }
}

const list = procs();
const erp = list.filter((p) => p.Name === 'electron.exe' && /electron-erp\.js/i.test(p.Cmd || ''));
const vspague = list.filter((p) => p.Name === 'VSPagueClient.exe');
const hostCandidates = list.filter((p) => Number(p.ProcessId) === EXPECT.hostPid5157
  || /DestaxaNativeHost|native-host|destaxa/i.test(String(p.Cmd || '') + String(p.Name || '')));

const db = new DatabaseSync('C:/ProgramData/MercantilFiscal/dados/mercadao.db', { readOnly: true });
const max = db.prepare('SELECT MAX(id) AS maxId, COUNT(*) AS total FROM tef_transacoes').get();
const txs = db.prepare(`
  SELECT id, status, nsu, autorizacao, venda_id, bandeira, adquirente
  FROM tef_transacoes WHERE id IN (2,3,4) ORDER BY id
`).all();
const v67 = db.prepare(`
  SELECT id, status, status_pagamento, tef_transacao_id FROM vendas WHERE id = 67
`).get();
const pend = db.prepare(`
  SELECT id, status FROM tef_transacoes
  WHERE status = 'pendente' OR lower(coalesce(status,'')) = 'unknown'
`).all();
const pin = db.prepare(`
  SELECT porta_com, codigo, habilitado, ativo FROM tef_pinpads WHERE id = 1
`).get();
db.close();

const ledgerPath = path.join(
  process.env.LOCALAPPDATA || '',
  'CDS-SISTEMAS',
  'tef',
  'destaxa-autorizacao-excepcional.json'
);
let issued = [];
if (fs.existsSync(ledgerPath)) {
  const j = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  issued = (j.autorizacoes || []).filter((a) => a.status === 'ISSUED')
    .map((a) => ({ id: a.authorizationId, expiresAt: a.expiresAt, motivo: a.motivo }));
}

const init5157Path = path.join(__dirname, '..', 'SPRINT-51.57', 'evidencias-init.json');
let init5157 = null;
if (fs.existsSync(init5157Path)) {
  init5157 = JSON.parse(fs.readFileSync(init5157Path, 'utf8'));
}

const falhas = [];
const gate = process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null;
if (String(gate) === '1') falhas.push('GATE_ON');
if (!erp.some((e) => Number(e.ProcessId) === EXPECT.erpPid)) {
  falhas.push(`ERP_PID_ESPERADO_${EXPECT.erpPid}_ATUAL_${erp.map((e) => e.ProcessId).join(',') || 'ausente'}`);
}
if (vspague.length !== 1) falhas.push(`VSPAGUE_COUNT_${vspague.length}`);
else if (Number(vspague[0].ProcessId) !== EXPECT.vspaguePid) {
  falhas.push(`VSPAGUE_PID_ESPERADO_${EXPECT.vspaguePid}_ATUAL_${vspague[0].ProcessId}`);
}
if (!pin || String(pin.porta_com).toUpperCase() !== 'COM4' || String(pin.codigo).toUpperCase() !== 'GERTEC_PPC930') {
  falhas.push('PINPAD_CONFIG');
}
if (Number(pin?.habilitado) !== 1 || Number(pin?.ativo) !== 1) falhas.push('PINPAD_INATIVO');
if (Number(max.maxId) !== 4) falhas.push(`MAX_TEF_${max.maxId}`);
if (pend.length) falhas.push(`PENDENTES_${pend.map((p) => p.id).join(',')}`);
if (!v67 || Number(v67.tef_transacao_id) !== 4 || v67.status !== 'concluida') falhas.push('VENDA67');

const host14896Alive = processAlive(EXPECT.hostPid5157);
const sessaoReutilizavel = host14896Alive === true
  && String(init5157?.nativeHost?.hostSessionId || '') === EXPECT.hostSessionId
  && init5157?.ok === true
  && String(init5157?.initClient?.codigoDestaxa || '') === '00';

let classificacao;
if (!sessaoReutilizavel) {
  classificacao = 'BLOCKED_SESSION_NOT_ACTIVE';
} else if (falhas.length) {
  classificacao = 'BLOCKED_WITH_EVIDENCE';
} else {
  classificacao = 'READY_EMITIR_ONESHOT';
}

const out = {
  ok: classificacao === 'READY_EMITIR_ONESHOT',
  classificacao,
  falhas,
  gate,
  erp,
  vspague,
  hostCandidates,
  host14896Alive,
  sessaoReutilizavel,
  init5157: init5157 ? {
    classificacao: init5157.classificacao,
    codigo: init5157.initClient?.codigoDestaxa,
    requestId: init5157.requestId,
    hostPid: init5157.nativeHost?.pid,
    hostSessionId: init5157.nativeHost?.hostSessionId,
    fim: init5157.fim,
    hostEncerradoAposEvidencia: true
  } : null,
  expect: EXPECT,
  pin,
  pinpadPnp: pinpadPnp(),
  max,
  txs,
  v67,
  pend,
  issued,
  motivoSessao: host14896Alive
    ? null
    : 'NativeHost PID 14896 da Sprint 51.57 não está ativo (encerramento controlado pós-INIT). Sessão não reutilizável; novo INIT_CLIENT exige autorização específica do PO. One-shot NÃO emitida.'
};

fs.writeFileSync(path.join(__dirname, 'precheck.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 2);
