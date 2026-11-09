'use strict';

/**
 * MRT-50.74 — launcher da única CRT autorizada.
 * Revalida pré-condições; se qualquer falhar, ABORTA sem TX.
 */

const { spawn, execSync } = require('child_process');
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
const revalidFile = path.join(root, 'revalidacao-execucao.json');
const dllPath = 'C:\\Program Files\\CDS ERP\\resources\\app.asar.unpacked\\resources\\tef\\destaxa\\win-x64\\libdll-integracao-tef.dll';
const keyFile = 'C:\\ProgramData\\MercantilFiscal\\dados\\.tef-signing-key.v1';
const localState = path.join(process.env.APPDATA, 'cds-sistemas-erp', 'Local State');
const marker = path.join(process.env.APPDATA, 'cds-sistemas-erp', '.cds-tef-crypto-context.json');
const EXPECTED_DLL = '65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279';
const EXPECTED_PROTOCOLO = 'FA0EF0D0430EBE190724D98BCD4D40930017E5D8B6C3AE368F8FC9C607AD551F';
const EXPECTED_CONSTANTES = '0E0A992B13349A62847266D048A1938399EB53E49FF611E44034CB241C751EF2';
const EXPECTED_CRT = 'transacao_valor=1.00;transacao_tipo_cartao=Debito;transacao_pagamento=A vista';

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function powershell(script) {
  return execSync(
    `powershell -NoProfile -Command ${JSON.stringify(script)}`,
    { encoding: 'utf8', windowsHide: true }
  ).trim();
}

function revalidar() {
  const com4Raw = powershell(
    "@(Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue | Where-Object { $_.DeviceID -eq 'COM4' }).Count"
  );
  const com4 = Number(com4Raw) === 1;
  // Exclui o próprio powershell da query (CommandLine contém o padrão DestaxaNativeHost).
  const nhRaw = powershell(
    "@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -match 'DestaxaNativeHost\\.js' -and $_.Name -notmatch 'powershell|pwsh|cmd' }).Count"
  );
  const nh = Number(nhRaw) || 0;
  const vsRaw = powershell(
    "@(Get-NetTCPConnection -LocalPort 60603,60906 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique).Count"
  );
  const vsOk = Number(vsRaw) >= 1;
  const dllOk = fs.existsSync(dllPath) && sha256(dllPath) === EXPECTED_DLL;
  const protocoloPath = path.join(projectRoot, 'backend', 'services', 'tef', 'destaxa', 'destaxaProtocolo.js');
  const constantesPath = path.join(projectRoot, 'backend', 'services', 'tef', 'destaxa', 'destaxaConstantes.js');
  const protocoloHash = sha256(protocoloPath);
  const constantesHash = sha256(constantesPath);
  const hash5073Ok = protocoloHash === EXPECTED_PROTOCOLO && constantesHash === EXPECTED_CONSTANTES;
  let crtOk = false;
  let crtTexto = null;
  try {
    const { buildCrtInput } = require(path.join(projectRoot, 'backend', 'services', 'tef', 'destaxa', 'destaxaProtocolo'));
    crtTexto = buildCrtInput({ valorCentavos: 100, tipoPdv: 'cartao_debito', parcelas: 1 }).texto;
    crtOk = crtTexto === EXPECTED_CRT;
  } catch (_) {
    crtOk = false;
  }
  const gateProcess = process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null;
  const gateOff = gateProcess !== '1';
  const isolatedLivre = !fs.existsSync(isolatedRoot);
  const keyOk = fs.existsSync(keyFile);
  const profileOk = fs.existsSync(localState) && fs.existsSync(marker);
  const electronOk = fs.existsSync(electron);

  const ok = com4 && nh === 0 && vsOk && dllOk && hash5073Ok && crtOk
    && gateOff && isolatedLivre && keyOk && profileOk && electronOk;
  const payload = {
    ok,
    com4,
    nh,
    vsOk,
    dllOk,
    hash5073Ok,
    protocoloHash,
    constantesHash,
    crtOk,
    crtTexto,
    gateProcess,
    gateOff,
    isolatedLivre,
    keyOk,
    profileOk,
    electronOk,
    em: new Date().toISOString()
  };
  fs.writeFileSync(revalidFile, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

if (fs.existsSync(isolatedRoot)) {
  fs.writeFileSync(statusFile, 'ABORT=ISOLATED_ROOT_EXISTS\n');
  process.exit(2);
}

const precond = revalidar();
if (!precond.ok) {
  fs.writeFileSync(statusFile, `ABORT=PRECOND_FAIL ${JSON.stringify(precond)}\n`);
  console.error('ABORT_PRECOND', precond);
  process.exit(3);
}

const pre = {
  localState: sha256(localState),
  marker: sha256(marker),
  key: sha256(keyFile),
  dll: sha256(dllPath),
  gateProcess: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null
};
fs.writeFileSync(path.join(root, 'hashes-pre.json'), `${JSON.stringify(pre, null, 2)}\n`);

for (const f of [resultFile, stdoutFile, stderrFile]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const env = { ...process.env };
// Parent inicia com gate OFF; o runner Electron liga só na janela da CRT.
env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
env.DESTAXA_NATIVE_HOST_TEST_MODE = '0';
env.DESTAXA_NATIVE_HOST_TRIPWIRE = '0';
env.DESTAXA_DLL_PATH = dllPath;
env.DESTAXA_OBSERVABILITY_LOG_PATH = jsonl;
env.MRT5074_RESULT_FILE = resultFile;
env.MRT5074_STDOUT_FILE = stdoutFile;
delete env.TEF_ENCRYPTION_KEY;
delete env.ELECTRON_RUN_AS_NODE;
delete env.DB_DIR;

const args = [
  appDir,
  `--mrt53-root=${isolatedRoot}`,
  '--mrt53-key-dir=C:\\ProgramData\\MercantilFiscal\\dados'
];

env.ELECTRON_ENABLE_LOGGING = '1';
env.ELECTRON_LOG_FILE = path.join(root, 'electron-log.txt');

const child = spawn(electron, args, {
  cwd: appDir,
  env,
  windowsHide: false,
  stdio: ['ignore', 'pipe', 'pipe']
});

fs.writeFileSync(
  statusFile,
  `STARTED pid=${child.pid} at=${new Date().toISOString()} confirmacao=EXPLICITA valor=1.00 modalidade=debito literal=Debito mrt=50.74\n`
);
console.log(`MRT-50.74 STARTED pid=${child.pid}`);
console.log('PINPAD: cartão pessoal no Gertec PPC-930 (COM4). Uma CRT. Sem retry. Literal Debito.');

let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk; });
child.stdout.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  fs.appendFileSync(stdoutFile, text);
  process.stdout.write(text);
});

const hardLimitMs = 15 * 60 * 1000;
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
  console.log(`MRT-50.74 EXIT=${code}`);
});
