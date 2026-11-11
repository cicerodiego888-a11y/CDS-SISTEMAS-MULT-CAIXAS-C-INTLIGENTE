'use strict';

/**
 * SPRINT 51.63 — Probe isolado FIRST_INSTALL (sem NativeHost/CRT).
 * Env: CDS_5163_APPDATA, CDS_5163_DB_DIR, CDS_5163_PASS (1|2), CDS_5163_OUT
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PASS = String(process.env.CDS_5163_PASS || '1');
const OUT = process.env.CDS_5163_OUT;
const APPDATA_ISO = process.env.CDS_5163_APPDATA;
const DB_DIR = process.env.CDS_5163_DB_DIR;

function emit(payload, code = 0) {
  try {
    if (OUT) fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  } catch (_) { /* ignore */ }
  process.stdout.write(`CDS5163_RESULT=${JSON.stringify(payload)}\n`);
  app.exit(code);
}

function fingerprintKeyBytes(hexKey) {
  return crypto.createHash('sha256').update(Buffer.from(hexKey, 'hex')).digest('hex').slice(0, 16);
}

async function main() {
  const base = {
    ok: false,
    pass: PASS,
    sprint: 'SPRINT-51.63',
    tevContextoOrigemAusente: false
  };

  try {
    if (!OUT || !APPDATA_ISO || !DB_DIR) {
      emit({ ...base, codigo: 'CDS5163_ENV_INVALID' }, 2);
      return;
    }
    if (String(process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '0') === '1') {
      emit({ ...base, codigo: 'GATE_ON' }, 2);
      return;
    }
    process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
    delete process.env.CDS_TEF_LOCAL_STATE_SOURCE;
    delete process.env.TEF_ENCRYPTION_KEY;
    process.env.APPDATA = APPDATA_ISO;
    process.env.DB_DIR = DB_DIR;
    fs.mkdirSync(APPDATA_ISO, { recursive: true });
    fs.mkdirSync(DB_DIR, { recursive: true });

    // Electron no Windows resolve AppData via pasta conhecida; forçar isolamento.
    if (typeof app.setPath === 'function') {
      app.setPath('appData', APPDATA_ISO);
    }

    const {
      configurarPerfilTef,
      finalizarContextoFirstInstall,
      MARKER_FILENAME,
      MODOS_CONTEXTO,
      PROFILE_NAMES
    } = require(path.join(ROOT, 'backend/services/tef/tefCryptoProfileProvisioner'));
    const { provisionarChaveTef } = require(path.join(
      ROOT, 'backend/services/tef/tefSigningKeyProvisioner'
    ));
    const evidence = require(path.join(ROOT, 'backend/services/tef/tefReconciliationEvidence'));

    const userDataEsperado = path.join(APPDATA_ISO, PROFILE_NAMES.erp);
    if (typeof app.setPath === 'function') {
      app.setPath('userData', userDataEsperado);
    }

    let perfil;
    try {
      perfil = configurarPerfilTef({
        app,
        modulo: 'erp',
        sourceLocalStatePath: undefined
      });
    } catch (error) {
      emit({
        ...base,
        codigo: error.code || 'CONFIG_PERFIL_FALHOU',
        mensagem: error.message,
        tevContextoOrigemAusente: error.code === 'TEF_CONTEXTO_ORIGEM_AUSENTE'
      }, 2);
      return;
    }

    const userDataResolvido = path.resolve(perfil.userDataPath).toLowerCase();
    const isolamentoRoot = path.resolve(APPDATA_ISO).toLowerCase();
    if (!userDataResolvido.startsWith(isolamentoRoot)) {
      emit({
        ...base,
        codigo: 'ISOLAMENTO_FALHOU_USERDATA_REAL',
        userDataPath: perfil.userDataPath,
        appDataIsolado: APPDATA_ISO,
        mensagem: 'Abortado: probe não pode usar o userData real do cliente/homologação.'
      }, 2);
      return;
    }

    await app.whenReady();
    if (!safeStorage.isEncryptionAvailable()) {
      emit({ ...base, codigo: 'SAFE_STORAGE_UNAVAILABLE', perfil }, 2);
      return;
    }

    const localStatePath = path.join(perfil.userDataPath, 'Local State');
    // Aguarda Chromium; se não materializar, não inventar Local State — falha evidenciada.
    const deadline = Date.now() + 15000;
    while (!fs.existsSync(localStatePath) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!fs.existsSync(localStatePath)) {
      // SafeStorage já disponível: alguns runtimes gravam Local State só após encrypt.
      // Não fabricamos o arquivo; registramos ausência.
      emit({
        ...base,
        codigo: 'LOCAL_STATE_NAO_MATERIALIZADO',
        userDataPath: perfil.userDataPath,
        roteamento: perfil.roteamento,
        firstInstallPendente: perfil.firstInstallPendente === true,
        tevContextoOrigemAusente: false
      }, 2);
      return;
    }

    let finalizado = perfil;
    if (perfil.firstInstallPendente) {
      finalizado = finalizarContextoFirstInstall({ app, modulo: 'erp' });
    }

    const storePath = path.join(DB_DIR, '.tef-signing-key.v1');
    const storeAntes = fs.existsSync(storePath);
    const mtimeAntes = storeAntes ? fs.statSync(storePath).mtimeMs : null;

    const provisionamento = await provisionarChaveTef({
      safeStorage,
      dbDir: DB_DIR,
      permitirGeracaoChave: PASS === '1'
    });

    const chave = process.env.TEF_ENCRYPTION_KEY;
    if (!chave || !/^[a-f0-9]{64}$/i.test(chave)) {
      emit({ ...base, codigo: 'CHAVE_INVALIDA', origem: provisionamento.origem }, 2);
      return;
    }

    const markerPath = path.join(finalizado.userDataPath, MARKER_FILENAME);
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    const localStateSha = crypto.createHash('sha256')
      .update(fs.readFileSync(localStatePath))
      .digest('hex')
      .toUpperCase();

    const payload = {
      ok: true,
      sprint: 'SPRINT-51.63',
      pass: PASS,
      tevContextoOrigemAusente: false,
      gate: '0',
      appName: app.getName(),
      userDataPath: app.getPath('userData'),
      appDataIsolado: APPDATA_ISO,
      dbDirIsolado: DB_DIR,
      roteamentoInicial: perfil.roteamento,
      modo: finalizado.modo || marker.modo || null,
      markerPath,
      marker: {
        versao: marker.versao,
        appName: marker.appName,
        modulo: marker.modulo,
        modo: marker.modo || null,
        userDataPath: marker.userDataPath,
        localStateOrigemSha256: marker.localStateOrigemSha256,
        provisionadoEm: marker.provisionadoEm
      },
      localStateSha256: localStateSha,
      markerHashMatchesLocalState: marker.localStateOrigemSha256 === localStateSha,
      modoFirstInstall: (finalizado.modo || marker.modo) === MODOS_CONTEXTO.FIRST_INSTALL,
      origemChave: provisionamento.origem,
      fingerprintKeyBytes: fingerprintKeyBytes(chave),
      fingerprintPublicKey: crypto.createHash('sha256')
        .update(evidence.obterChavePublica())
        .digest('hex')
        .slice(0, 16),
      storeExisteAntes: storeAntes,
      storeMtimeAntes: mtimeAntes,
      storeMtimeDepois: fs.statSync(storePath).mtimeMs,
      novaChaveGeradaNestaPassagem: provisionamento.origem === 'gerada',
      chaveSomenteMemoria: !fs.readFileSync(storePath, 'utf8').includes(chave),
      destaxaNativeHostCarregado: Object.keys(require.cache).some((p) =>
        /DestaxaNativeHost(Client)?\.js$/i.test(p)),
      tefManagerCarregado: Object.keys(require.cache).some((p) => /TefManager\.js$/i.test(p))
    };

    delete process.env.TEF_ENCRYPTION_KEY;
    payload.chaveLimpaAntesSaida = !process.env.TEF_ENCRYPTION_KEY;
    emit(payload, 0);
  } catch (error) {
    emit({
      ok: false,
      pass: PASS,
      codigo: error.code || 'PROBE_CRASH',
      mensagem: error.message,
      tevContextoOrigemAusente: error.code === 'TEF_CONTEXTO_ORIGEM_AUSENTE'
    }, 2);
  }
}

main();
