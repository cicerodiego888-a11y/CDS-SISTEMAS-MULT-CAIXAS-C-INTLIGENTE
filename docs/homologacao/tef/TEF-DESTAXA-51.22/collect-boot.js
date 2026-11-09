'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../../..');
const OUT_DIR = __dirname;
const EXPECTED = 'F969747342BECA01E93F4694CF71768F2CF99B8A65B4E86BCB5FFA26EB5A427C';
const TEF_REL = 'backend/services/tef/TefManager.js';
const TEF_ABS = path.join(ROOT, TEF_REL);

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();
}

function httpHead(port) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'HEAD', timeout: 3000 }, (res) => {
      resolve({ ok: true, status: res.statusCode });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.end();
  });
}

function listElectrons() {
  const raw = execSync(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq \'electron.exe\' -or ($_.CommandLine -and $_.CommandLine -match \'electron-pdv|electron\\\\.exe\') } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Depth 4"',
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
  );
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function parseLogs() {
  const files = ['pdv-stdout.log', 'pdv-stderr.log'].map((f) => path.join(OUT_DIR, f));
  const text = files.map((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '')).join('\n');
  const markers = {
    ELECTRON_AUDIT: /\[RC3\.16\.4\]\[ELECTRON-AUDIT\]\s+startup/.test(text),
    modoLocal: /Modo local forçado via argumento --cds-forcar-local/.test(text),
    HTTP_LISTENING: /listening|HTTP LISTENING|porta 3001|Port 3001|server.*3001/i.test(text),
    TX_START: /\bTX_START\b/.test(text),
    TX_CONTINUE: /\bTX_CONTINUE\b/.test(text),
    CRT: /\bCRT\b/.test(text) && /autorizarPagamento|iniciaTransacaoDestaxa/.test(text),
    intentCicloInLogs: /intentCicloAutomaticoContinue/.test(text)
  };

  let auditMeta = null;
  const m = text.match(/\[RC3\.16\.4\]\[ELECTRON-AUDIT\]\s+startup\s+(\{[\s\S]*?\n\})/);
  if (m) {
    try { auditMeta = JSON.parse(m[1]); } catch (_) { /* ignore */ }
  }

  // Hashes RC3.16.6 that mention TefManager if present
  const hashHits = [];
  const re = /backend[\\/]+services[\\/]+tef[\\/]+TefManager\.js[^\n]{0,120}/gi;
  let hit;
  while ((hit = re.exec(text))) hashHits.push(hit[0].slice(0, 200));

  return {
    stdoutBytes: fs.existsSync(files[0]) ? fs.statSync(files[0]).size : 0,
    stderrBytes: fs.existsSync(files[1]) ? fs.statSync(files[1]).size : 0,
    markers,
    auditMeta,
    tefManagerLogHits: hashHits.slice(0, 10)
  };
}

(async () => {
  const workspaceHash = sha256File(TEF_ABS);
  const src = fs.readFileSync(TEF_ABS, 'utf8');
  const electrons = listElectrons();
  const mains = electrons.filter((e) => /electron-pdv\.js/.test(String(e.CommandLine || '')) && !/--type=/.test(String(e.CommandLine || '')));
  const http3001 = await httpHead(3001);
  const logs = parseLogs();

  const out = {
    coletadoEm: new Date().toISOString(),
    workspace: ROOT,
    workspaceTefManager: {
      path: TEF_ABS,
      sha256: workspaceHash,
      matchExpected5120: workspaceHash === EXPECTED,
      hasIntentCicloAutomaticoContinue: src.includes('intentCicloAutomaticoContinue'),
      hasFinalizeGateContinuidade: src.includes("continuidadeAtiva && ['TX_CONTINUE', 'TX_FINALIZE'].includes(operation)"),
      intentAutorizar: /allowedOperations:\s*\['TX_START',\s*'TX_CONTINUE',\s*'TX_FINALIZE'\]/.test(src),
      intentContinuar: /allowedOperations:\s*\['TX_CONTINUE',\s*'TX_FINALIZE'\]/.test(src)
    },
    electrons,
    mains,
    http3001,
    logs,
    gateEnv: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null
  };

  fs.writeFileSync(path.join(OUT_DIR, 'boot-snapshot.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({
    mains: mains.map((m) => ({ pid: m.ProcessId, cmd: m.CommandLine })),
    http3001,
    auditMeta: logs.auditMeta,
    workspaceHashMatch: out.workspaceTefManager.matchExpected5120,
    hasMarker: out.workspaceTefManager.hasIntentCicloAutomaticoContinue,
    stdoutBytes: logs.stdoutBytes,
    stderrBytes: logs.stderrBytes
  }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
