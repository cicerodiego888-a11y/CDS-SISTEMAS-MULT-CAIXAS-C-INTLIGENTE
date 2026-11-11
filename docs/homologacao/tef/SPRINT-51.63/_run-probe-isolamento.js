'use strict';

/**
 * Orquestra 1ª e 2ª abertura FIRST_INSTALL em AppData/DB isolados.
 * Não altera o perfil real cds-sistemas-erp.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const electronExe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const probe = path.join(__dirname, 'tef-51-63-first-install-probe.js');

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();
}

function runPass(pass, appData, dbDir, outFile) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      APPDATA: appData,
      CDS_5163_APPDATA: appData,
      CDS_5163_DB_DIR: dbDir,
      CDS_5163_PASS: String(pass),
      CDS_5163_OUT: outFile,
      DESTAXA_REAL_TRANSACTION_ENABLED: '0',
      DB_DIR: dbDir
    };
    delete env.CDS_TEF_LOCAL_STATE_SOURCE;
    delete env.TEF_ENCRYPTION_KEY;
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.CDS_TEF_ERP_INIT_CLIENT_ONCE;

    const child = spawn(electronExe, [probe], {
      cwd: ROOT,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`pass ${pass} timeout`));
    }, 90000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      const line = stdout.split(/\r?\n/).find((l) => l.startsWith('CDS5163_RESULT='));
      if (!line) {
        reject(new Error(`pass ${pass} sem resultado (exit ${code}): ${stderr.slice(-800)}`));
        return;
      }
      const result = JSON.parse(line.slice('CDS5163_RESULT='.length));
      result._exitCode = code;
      result._stderrTail = stderr.slice(-400);
      resolve(result);
    });
  });
}

async function main() {
  if (!fs.existsSync(electronExe)) {
    throw new Error('electron.exe ausente');
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-5163-fi-'));
  const appData = path.join(root, 'AppData');
  const dbDir = path.join(root, 'dados');
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(dbDir, { recursive: true });

  const out1 = path.join(__dirname, 'pass1-first-open.json');
  const out2 = path.join(__dirname, 'pass2-reopen.json');

  const pass1 = await runPass(1, appData, dbDir, out1);
  const pass2 = await runPass(2, appData, dbDir, out2);

  const keyFile = path.join(dbDir, '.tef-signing-key.v1');
  const marker = path.join(
    appData,
    'cds-sistemas-erp',
    '.cds-tef-crypto-context.json'
  );

  const summary = {
    sprint: 'SPRINT-51.63',
    isolamento: {
      root,
      appData,
      dbDir,
      tocouPerfilReal: false,
      perfilRealMarker: path.join(
        process.env.APPDATA || '',
        'cds-sistemas-erp',
        '.cds-tef-crypto-context.json'
      )
    },
    pass1,
    pass2,
    comparacao: {
      mesmoUserData: pass1.userDataPath === pass2.userDataPath,
      mesmoModo: pass1.modo === pass2.modo && pass2.modo === 'FIRST_INSTALL',
      mesmoLocalStateSha: pass1.localStateSha256 === pass2.localStateSha256,
      mesmoFingerprintKeyBytes: pass1.fingerprintKeyBytes === pass2.fingerprintKeyBytes,
      mesmoFingerprintPublicKey: pass1.fingerprintPublicKey === pass2.fingerprintPublicKey,
      pass1GerouChave: pass1.novaChaveGeradaNestaPassagem === true,
      pass2NaoGerouChave: pass2.novaChaveGeradaNestaPassagem === false
        && pass2.origemChave === 'armazenamento-protegido',
      origemAusenteNaoOcorreu: pass1.tevContextoOrigemAusente === false
        && pass2.tevContextoOrigemAusente === false,
      markerExiste: fs.existsSync(marker),
      keyStoreExiste: fs.existsSync(keyFile),
      keyStoreSha256: fs.existsSync(keyFile) ? sha256File(keyFile) : null
    }
  };

  summary.ok = summary.comparacao.mesmoUserData
    && summary.comparacao.mesmoModo
    && summary.comparacao.mesmoLocalStateSha
    && summary.comparacao.mesmoFingerprintKeyBytes
    && summary.comparacao.pass1GerouChave
    && summary.comparacao.pass2NaoGerouChave
    && summary.comparacao.origemAusenteNaoOcorreu
    && pass1.ok === true
    && pass2.ok === true
    && pass1.destaxaNativeHostCarregado !== true
    && pass1.tefManagerCarregado !== true;

  summary.classificacao = summary.ok
    ? 'FIRST_INSTALL_CRYPTO_CONTEXT_PERSISTENCE_CONFIRMED'
    : 'BLOCKED_WITH_EVIDENCE';

  fs.writeFileSync(
    path.join(__dirname, 'resultado-isolamento.json'),
    `${JSON.stringify(summary, null, 2)}\n`
  );
  console.log(JSON.stringify({
    classificacao: summary.classificacao,
    ok: summary.ok,
    comparacao: summary.comparacao,
    fingerprint: pass2.fingerprintKeyBytes,
    userData: pass2.userDataPath
  }, null, 2));
  process.exit(summary.ok ? 0 : 2);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, erro: error.message }));
  process.exit(2);
});
