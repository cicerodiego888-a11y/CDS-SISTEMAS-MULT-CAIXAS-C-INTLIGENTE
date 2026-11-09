'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const projectRoot = path.resolve(root, '..', '..', '..', '..');
const electron = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const appDir = path.join(root, 'runner-app');
const isolatedRoot = path.join(root, 'isolated-root');
const resultFile = path.join(root, 'runner-result.json');
const stdoutFile = path.join(root, 'runner-stdout.jsonl');
const stderrFile = path.join(root, 'runner-stderr.txt');
const statusFile = path.join(root, 'runner-status.txt');
const jsonl = path.join(root, 'observability.jsonl');
const dllPath = 'C:\\Program Files\\CDS ERP\\resources\\app.asar.unpacked\\resources\\tef\\destaxa\\win-x64\\libdll-integracao-tef.dll';
const keyFile = 'C:\\ProgramData\\MercantilFiscal\\dados\\.tef-signing-key.v1';
const localState = path.join(process.env.APPDATA, 'cds-sistemas-erp', 'Local State');
const marker = path.join(process.env.APPDATA, 'cds-sistemas-erp', '.cds-tef-crypto-context.json');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

if (fs.existsSync(isolatedRoot)) {
  fs.writeFileSync(statusFile, 'ABORT=ISOLATED_ROOT_EXISTS\n');
  process.exit(2);
}

const pre = {
  localState: sha256(localState),
  marker: sha256(marker),
  key: sha256(keyFile),
  dll: sha256(dllPath),
  gateProcess: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null
};
fs.writeFileSync(path.join(root, 'hashes-pre.json'), `${JSON.stringify(pre, null, 2)}\n`);

const env = { ...process.env };
env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
env.DESTAXA_NATIVE_HOST_TEST_MODE = '0';
env.DESTAXA_NATIVE_HOST_TRIPWIRE = '0';
env.DESTAXA_DLL_PATH = dllPath;
env.DESTAXA_OBSERVABILITY_LOG_PATH = jsonl;
env.MRT5065_RESULT_FILE = resultFile;
env.MRT5065_STDOUT_FILE = stdoutFile;
delete env.TEF_ENCRYPTION_KEY;
delete env.ELECTRON_RUN_AS_NODE;
delete env.DB_DIR;

const args = [
  appDir,
  `--mrt53-root=${isolatedRoot}`,
  `--mrt53-key-dir=C:\\ProgramData\\MercantilFiscal\\dados`,
  '--mrt54-init-client'
];

const child = spawn(electron, args, {
  cwd: appDir,
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

fs.writeFileSync(statusFile, `STARTED pid=${child.pid} at=${new Date().toISOString()}\n`);
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk; });
child.stdout.on('data', (chunk) => {
  fs.appendFileSync(stdoutFile, chunk);
});

const hardLimitMs = 5 * 60 * 1000;
const timer = setTimeout(() => {
  if (fs.existsSync(resultFile)) {
    try {
      const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      if (result.keepAlive === true || result.classificacao === 'TIMEOUT_IN_FLIGHT') {
        fs.appendFileSync(statusFile, 'HARD_LIMIT_REACHED_KEEPALIVE\n');
        return;
      }
    } catch (_) { /* ignore */ }
  }
  fs.appendFileSync(statusFile, 'HARD_LIMIT_KILL_PARENT\n');
  try { child.kill(); } catch (_) { /* ignore */ }
}, hardLimitMs);

child.on('close', (code) => {
  clearTimeout(timer);
  fs.writeFileSync(stderrFile, stderr);
  const post = {
    localState: sha256(localState),
    marker: sha256(marker),
    key: sha256(keyFile),
    dll: sha256(dllPath),
    gateProcess: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null
  };
  fs.writeFileSync(path.join(root, 'hashes-pos.json'), `${JSON.stringify(post, null, 2)}\n`);
  fs.appendFileSync(statusFile, `EXIT=${code} at=${new Date().toISOString()}\n`);
});
