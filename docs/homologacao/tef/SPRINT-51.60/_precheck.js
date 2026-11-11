'use strict';

/**
 * SPRINT 51.60 — Precheck + prova de vínculo PDV oficial ↔ sessão NativeHost.
 * Não emite one-shot. Não chama CRT / TX_* / /tef/pagar.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { execSync } = require('child_process');

const OUT_DIR = __dirname;
const EXPECTED_HOST_PID = 8688;
const EXPECTED_ERP_PID = 20032;
const EXPECTED_VSPAGUE_PID = 22380;
const EXPECTED_PROBE_PID = 10756;
const EXPECTED_SESSION = '168158a6e0817b7fa210a5aabd22c689';

function psJson(command) {
  const raw = execSync(
    `powershell -NoProfile -Command "${command}"`,
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  ).trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function snippet(cmd, n = 180) {
  const s = String(cmd || '');
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

const all = psJson(
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'electron|VSPague' } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"
);
const pinPnp = psJson(
  "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match 'COM4|Gertec|PPC-920' } | Select-Object Name,Status | ConvertTo-Json -Compress"
);

const erp = all.filter((p) => String(p.CommandLine || '').includes('electron-erp.js'));
const probe = all.filter((p) => String(p.CommandLine || '').includes('tef-51-59-init-persistente.js'));
const vsp = all.filter((p) => /VSPagueClient/i.test(p.Name || ''));
const host8688 = all.find((p) => Number(p.ProcessId) === EXPECTED_HOST_PID) || null;
const erpChildren = all.filter((p) => Number(p.ParentProcessId) === EXPECTED_ERP_PID);
const erpNativeHost = erpChildren.filter((p) =>
  /utility-sub-type=node\.mojom\.NodeService/i.test(String(p.CommandLine || ''))
);

const db = new DatabaseSync('C:/ProgramData/MercantilFiscal/dados/mercadao.db', { readOnly: true });
const max = db.prepare('SELECT MAX(id) AS maxId FROM tef_transacoes').get();
const pend = db
  .prepare(
    "SELECT id, status FROM tef_transacoes WHERE lower(COALESCE(status,'')) IN ('pendente','unknown')"
  )
  .all();
const pin = db
  .prepare(
    "SELECT porta_com, codigo, habilitado, ativo FROM tef_pinpads WHERE id=1"
  )
  .get();
const txs = db
  .prepare(
    'SELECT id, status, nsu, autorizacao, venda_id FROM tef_transacoes WHERE id IN (2,3,4) ORDER BY id'
  )
  .all();
db.close();

const alivePath = path.join(OUT_DIR, '..', 'SPRINT-51.59', 'session-alive.json');
const evidPath = path.join(OUT_DIR, '..', 'SPRINT-51.59', 'evidencias-init.json');
const alive = fs.existsSync(alivePath)
  ? JSON.parse(fs.readFileSync(alivePath, 'utf8'))
  : null;
const evid = fs.existsSync(evidPath)
  ? JSON.parse(fs.readFileSync(evidPath, 'utf8'))
  : null;

const ledgerPath = path.join(
  process.env.LOCALAPPDATA || '',
  'CDS-SISTEMAS',
  'tef',
  'destaxa-autorizacao-excepcional.json'
);
let ledger = null;
if (fs.existsSync(ledgerPath)) {
  const j = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const issued = (j.autorizacoes || []).filter((a) => a.status === 'ISSUED');
  ledger = {
    path: ledgerPath,
    issuedCount: issued.length,
    issuedIds: issued.map((a) => a.authorizationId || a.id)
  };
}

const checks = {
  erp20032: erp.some((p) => Number(p.ProcessId) === EXPECTED_ERP_PID),
  vspague22380Unico:
    vsp.length === 1 && Number(vsp[0].ProcessId) === EXPECTED_VSPAGUE_PID,
  host8688Alive:
    !!host8688 && Number(host8688.ParentProcessId) === EXPECTED_PROBE_PID,
  sessionAliveFile:
    !!alive
    && alive.hostSessionId === EXPECTED_SESSION
    && alive.sessaoAtiva === true
    && Number(alive.hostPid) === EXPECTED_HOST_PID,
  clientInitialized:
    !!alive?.status
    && alive.status.clientInitialized === true
    && String(alive.status.clientResultCode) === '00',
  com4:
    pinPnp.some((x) => /COM4/i.test(x.Name || '') && x.Status === 'OK')
    && pin
    && String(pin.porta_com).toUpperCase() === 'COM4'
    && Number(pin.habilitado) === 1
    && Number(pin.ativo) === 1,
  gateOff: String(process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '0') !== '1',
  maxTef4: Number(max.maxId) === 4,
  semPendenteUnknown: pend.length === 0,
  pdvUsaSessaoPreparada: false
};

const vinculoPdvSessao = {
  conclusao: 'PDV_NAO_USA_SESSAO_PREPARADA',
  motivo:
    'NativeHost PID 8688 (hostSessionId 168158a6…) é utilityProcess filho do probe 10756 (tef-51-59-init-persistente.js), não do ERP 20032. O ERP não possui utilityProcess node.mojom.NodeService. DestaxaNativeHostClient é singleton in-process (obterClienteCompartilhado); o PDV oficial criaria outra instância NativeHost no caminho CRT.',
  erpPid: EXPECTED_ERP_PID,
  erpNativeHostNodeServiceCount: erpNativeHost.length,
  erpChildren: erpChildren.map((p) => ({
    pid: p.ProcessId,
    cmdSnippet: snippet(p.CommandLine)
  })),
  probePid: EXPECTED_PROBE_PID,
  nativeHost: {
    pid: EXPECTED_HOST_PID,
    ppid: host8688 ? Number(host8688.ParentProcessId) : null,
    hostSessionId: EXPECTED_SESSION
  },
  arquitetura: 'um NativeHost por processo Electron via obterClienteCompartilhado()'
};

const okBasico =
  checks.erp20032
  && checks.vspague22380Unico
  && checks.host8688Alive
  && checks.sessionAliveFile
  && checks.clientInitialized
  && checks.com4
  && checks.gateOff
  && checks.maxTef4
  && checks.semPendenteUnknown;

const aprovadoIntegral = okBasico && checks.pdvUsaSessaoPreparada === true;

const out = {
  sprint: 'SPRINT-51.60',
  em: new Date().toISOString(),
  gate: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '0',
  checks,
  okBasico,
  aprovadoIntegral,
  classificacaoPrecheck: aprovadoIntegral
    ? 'PRECHECK_OK'
    : 'BLOCKED_SESSION_NOT_BOUND_TO_PDV',
  vinculoPdvSessao,
  erp: erp.map((p) => ({
    ProcessId: p.ProcessId,
    ParentProcessId: p.ParentProcessId,
    CommandLine: snippet(p.CommandLine, 240)
  })),
  probe: probe.map((p) => ({
    ProcessId: p.ProcessId,
    ParentProcessId: p.ParentProcessId,
    CommandLine: snippet(p.CommandLine, 240)
  })),
  vspague: vsp.map((p) => ({
    ProcessId: p.ProcessId,
    ParentProcessId: p.ParentProcessId
  })),
  host8688: host8688
    ? {
      ProcessId: host8688.ProcessId,
      ParentProcessId: host8688.ParentProcessId,
      CommandLine: snippet(host8688.CommandLine, 240)
    }
    : null,
  pin,
  pinPnp,
  max,
  pend,
  txs,
  alive,
  evidInit: evid
    ? {
      hostPid: evid.nativeHost?.pid,
      hostSessionId: evid.nativeHost?.hostSessionId,
      requestId: evid.requestId,
      classificacao: evid.classificacao
    }
    : null,
  ledger,
  oneShotEmitida: false,
  cobrancaExecutada: false,
  novoInitExecutado: false
};

fs.writeFileSync(path.join(OUT_DIR, 'precheck.json'), `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  classificacao: out.classificacaoPrecheck,
  aprovadoIntegral,
  okBasico,
  checks,
  vinculo: {
    conclusao: vinculoPdvSessao.conclusao,
    erpNativeHostNodeServiceCount: erpNativeHost.length,
    hostPpid: host8688 && host8688.ParentProcessId,
    probe: EXPECTED_PROBE_PID
  }
}, null, 2)}\n`);

process.exit(aprovadoIntegral ? 0 : 2);
