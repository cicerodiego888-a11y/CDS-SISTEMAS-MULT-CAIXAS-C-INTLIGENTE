'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const EXPECTED_ERP = 16744;
const EXPECTED_HOST = 13940;
const EXPECTED_SESSION = '91ce63acec0f09b2efba16571dad4c74';
const EXPECTED_VSP = 22380;

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

const erp = all.find((p) => Number(p.ProcessId) === EXPECTED_ERP
  && String(p.CommandLine || '').includes('electron-erp.js'));
const host = all.find((p) => Number(p.ProcessId) === EXPECTED_HOST);
const vsp = all.filter((p) => /VSPagueClient/i.test(p.Name || ''));

const alivePath = path.join(__dirname, '..', 'SPRINT-51.61', 'session-alive.json');
const alive = fs.existsSync(alivePath)
  ? JSON.parse(fs.readFileSync(alivePath, 'utf8'))
  : null;

const db = new DatabaseSync('C:/ProgramData/MercantilFiscal/dados/mercadao.db', { readOnly: true });
const max = db.prepare('SELECT MAX(id) AS maxId FROM tef_transacoes').get();
const pin = db.prepare('SELECT porta_com, codigo, habilitado, ativo FROM tef_pinpads WHERE id=1').get();
const pend = db.prepare(
  "SELECT id, status FROM tef_transacoes WHERE status='pendente' OR lower(coalesce(status,''))='unknown'"
).all();
const txs = db.prepare(
  'SELECT id,status,nsu,autorizacao,venda_id FROM tef_transacoes WHERE id IN (2,3,4) ORDER BY id'
).all();
const venda67 = db.prepare('SELECT id, status, tef_transacao_id FROM vendas WHERE id=67').get();
db.close();

const checks = {
  erp16744: Boolean(erp),
  host13940Alive: Boolean(host) && Number(host.ParentProcessId) === EXPECTED_ERP,
  hostIsNodeService: Boolean(host)
    && /utility-sub-type=node\.mojom\.NodeService/i.test(String(host.CommandLine || '')),
  vspague22380Unico: vsp.length === 1 && Number(vsp[0].ProcessId) === EXPECTED_VSP,
  sessionAlive: !!alive
    && alive.hostSessionId === EXPECTED_SESSION
    && alive.sessaoAtiva === true
    && Number(alive.erpPid) === EXPECTED_ERP
    && Number(alive.hostPid) === EXPECTED_HOST
    && alive.vinculoPdvOk === true,
  clientInitialized: !!alive?.status
    && alive.status.clientInitialized === true
    && String(alive.status.clientResultCode) === '00'
    && alive.status.operacaoAtiva == null,
  com4: pinPnp.some((x) => /COM4/i.test(x.Name || '') && x.Status === 'OK')
    && pin
    && String(pin.porta_com).toUpperCase() === 'COM4'
    && String(pin.codigo).toUpperCase() === 'GERTEC_PPC930',
  gateOff: String(process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '0') !== '1',
  maxTef4: Number(max.maxId) === 4,
  semPendenteUnknown: pend.length === 0,
  venda67Ok: !!venda67 && Number(venda67.tef_transacao_id) === 4
};

const ok = Object.values(checks).every(Boolean);
const out = {
  sprint: 'SPRINT-51.62',
  em: new Date().toISOString(),
  ok,
  checks,
  erp: erp ? { ProcessId: erp.ProcessId, ParentProcessId: erp.ParentProcessId } : null,
  host: host
    ? {
      ProcessId: host.ProcessId,
      ParentProcessId: host.ParentProcessId,
      isNodeService: checks.hostIsNodeService
    }
    : null,
  vspague: vsp.map((p) => ({ ProcessId: p.ProcessId })),
  alive,
  pin,
  pinPnp,
  max,
  txs,
  venda67,
  pend,
  gate: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '0',
  avisoFiscal:
    'Fluxo PDV oficial após TEF aprovado tipicamente segue para emissão/transmissão NFC-e. Esta sprint NÃO isola SEFAZ; transmissão fiscal exige autorização separada do PO. Operador deve estar ciente antes de concluir a venda.'
};

fs.writeFileSync(path.join(__dirname, 'precheck.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ ok, checks, avisoFiscal: out.avisoFiscal }, null, 2));
process.exit(ok ? 0 : 2);
