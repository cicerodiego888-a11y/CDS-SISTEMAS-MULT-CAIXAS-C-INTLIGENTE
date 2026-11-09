'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const electronExe = path.resolve(root, '..', '..', '..', '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const appDir = path.join(root, 'probe-app');
const resultFile = path.join(root, 'electron-result.json');
const traceFile = path.join(root, 'electron-trace.txt');

const env = { ...process.env };
env.MRT5058_ISOLATED_USERDATA = path.join(root, 'isolated-userdata', 'cds-sistemas-erp');
env.MRT5058_ORIGINAL_USERDATA = path.join(process.env.APPDATA, 'cds-sistemas-erp');
env.MRT5058_KEY_FILE = 'C:\\ProgramData\\MercantilFiscal\\dados\\.tef-signing-key.v1';
env.MRT5058_RESULT_FILE = resultFile;
env.MRT5058_TRACE_FILE = traceFile;
env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
env.DESTAXA_NATIVE_HOST_TEST_MODE = '0';
env.DESTAXA_NATIVE_HOST_TRIPWIRE = '0';
delete env.TEF_ENCRYPTION_KEY;
delete env.DB_DIR;
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronExe, [appDir], {
  cwd: appDir,
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
const timer = setTimeout(() => {
  child.kill();
  fs.writeFileSync(path.join(root, 'probe-status.txt'), 'TIMEOUT\n');
}, 40000);

child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });
child.once('close', (code) => {
  clearTimeout(timer);
  fs.writeFileSync(path.join(root, 'electron-stdout.txt'), stdout);
  fs.writeFileSync(path.join(root, 'electron-stderr.txt'), stderr);
  fs.writeFileSync(path.join(root, 'probe-status.txt'), `EXIT=${code}\n`);
});
