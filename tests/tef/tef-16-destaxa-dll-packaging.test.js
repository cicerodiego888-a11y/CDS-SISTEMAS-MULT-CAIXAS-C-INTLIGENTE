'use strict';

/**
 * TEF-16 — Empacotamento / resolução da DLL Destaxa (sem INIT, sem TX).
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const destaxaDllResolver = require('../../backend/services/tef/destaxa/destaxaDllResolver');
const destaxaBinarios = require('../../backend/services/tef/destaxa/destaxaBinarios');
const destaxaPeInspector = require('../../backend/services/tef/destaxa/destaxaPeInspector');
const destaxaKoffiLoader = require('../../backend/services/tef/destaxa/destaxaKoffiLoader');
const {
  ERROS,
  pastaArquitetura,
  DLL_NAME
} = require('../../backend/services/tef/destaxa/destaxaConstantes');

const ROOT = path.resolve(__dirname, '../..');
const INSTALLED_UNPACKED = path.join(
  process.env['ProgramFiles'] || 'C:\\Program Files',
  'CDS ERP',
  'resources',
  'app.asar.unpacked',
  'resources',
  'tef',
  'destaxa'
);

function sha256Arquivo(caminho) {
  return crypto.createHash('sha256').update(fs.readFileSync(caminho)).digest('hex').toUpperCase();
}

function test(nome, fn) {
  try {
    fn();
    console.log(`  OK  ${nome}`);
  } catch (error) {
    console.error(`  FAIL ${nome}`);
    throw error;
  }
}

console.log('=== TEF-16 — DLL Destaxa packaging / resolver ===\n');

test('inventário repo: win-x64 e win-ia32 com SHA/tamanho oficiais 1.83', () => {
  for (const [pasta, meta] of Object.entries(destaxaBinarios.arquivos)) {
    const arquivo = path.join(ROOT, 'resources', 'tef', 'destaxa', pasta, meta.nome);
    assert.ok(fs.existsSync(arquivo), `ausente ${arquivo}`);
    assert.strictEqual(fs.statSync(arquivo).size, meta.tamanho);
    assert.strictEqual(sha256Arquivo(arquivo), meta.sha256);
    const pe = destaxaPeInspector.lerPeMachine(arquivo);
    assert.strictEqual(pe.ok, true);
    assert.strictEqual(pe.peMachine, meta.peMachine);
  }
});

test('package.json / builders: asarUnpack inclui resources/tef/destaxa', () => {
  const pkg = require('../../package.json');
  assert.ok(pkg.build.asarUnpack.includes('**/resources/tef/destaxa/**'));
  for (const nome of ['electron-builder-erp.json', 'electron-builder-pdv.json']) {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, nome), 'utf8'));
    assert.ok(cfg.asarUnpack.includes('**/resources/tef/destaxa/**'), nome);
  }
});

test('resolução em desenvolvimento aponta resources/tef/destaxa/<arch>', () => {
  const prev = process.resourcesPath;
  delete process.resourcesPath;
  try {
    const diag = destaxaDllResolver.diagnosticarResolucao({}, { raizProjeto: ROOT });
    assert.strictEqual(diag.sucesso, true);
    assert.strictEqual(diag.classeDiagnostico, 'DLL_PRESENTE');
    const pasta = pastaArquitetura(process.arch);
    assert.ok(String(diag.dllPath).includes(path.join('resources', 'tef', 'destaxa', pasta)));
    assert.ok(fs.existsSync(diag.dllPath));
  } finally {
    if (prev !== undefined) process.resourcesPath = prev;
  }
});

test('resolução empacotada: resourcesPath + app.asar.unpacked (layout NSIS)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tef16-asar-'));
  const resourcesPath = path.join(tmp, 'resources');
  const pasta = pastaArquitetura(process.arch);
  const dest = path.join(resourcesPath, 'app.asar.unpacked', 'resources', 'tef', 'destaxa', pasta);
  fs.mkdirSync(dest, { recursive: true });
  const src = path.join(ROOT, 'resources', 'tef', 'destaxa', pasta, DLL_NAME);
  const dst = path.join(dest, DLL_NAME);
  fs.copyFileSync(src, dst);

  const prevRes = process.resourcesPath;
  const prevEnv = process.env.DESTAXA_DLL_PATH;
  delete process.env.DESTAXA_DLL_PATH;
  process.resourcesPath = resourcesPath;
  try {
    const legado = path.join(resourcesPath, 'tef', 'destaxa', pasta, DLL_NAME);
    assert.strictEqual(fs.existsSync(legado), false, 'layout legado irmão do asar não deve existir');
    assert.strictEqual(fs.existsSync(dst), true);

    const diag = destaxaDllResolver.diagnosticarResolucao({});
    assert.strictEqual(diag.sucesso, true, diag.mensagem);
    assert.strictEqual(diag.origem, 'asar_unpacked');
    assert.strictEqual(path.normalize(diag.dllPath), path.normalize(dst));

    const lista = destaxaDllResolver.listarCandidatos({});
    const asarCand = lista.candidatos.find((c) => c.origem === 'asar_unpacked');
    assert.ok(asarCand);
    assert.strictEqual(asarCand.existe, true);
  } finally {
    if (prevRes !== undefined) process.resourcesPath = prevRes;
    else delete process.resourcesPath;
    if (prevEnv !== undefined) process.env.DESTAXA_DLL_PATH = prevEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('diagnóstico DLL ausente → DESTAXA_DLL_NOT_FOUND / DLL_AUSENTE', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tef16-miss-'));
  const resourcesPath = path.join(tmp, 'resources');
  fs.mkdirSync(resourcesPath, { recursive: true });
  const prevRes = process.resourcesPath;
  const prevEnv = process.env.DESTAXA_DLL_PATH;
  delete process.env.DESTAXA_DLL_PATH;
  process.resourcesPath = resourcesPath;
  try {
    const diag = destaxaDllResolver.diagnosticarResolucao({}, { raizProjeto: tmp });
    assert.strictEqual(diag.sucesso, false);
    assert.strictEqual(diag.codigo, ERROS.DESTAXA_DLL_NOT_FOUND);
    assert.strictEqual(diag.classeDiagnostico, 'DLL_AUSENTE');
  } finally {
    if (prevRes !== undefined) process.resourcesPath = prevRes;
    else delete process.resourcesPath;
    if (prevEnv !== undefined) process.env.DESTAXA_DLL_PATH = prevEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('diagnóstico arquitetura incompatível (PE x64 forçado em ia32)', () => {
  if (process.arch !== 'x64') {
    console.log('  SKIP (requer host x64 para cruzar com win-x64)');
    return;
  }
  const dllX64 = path.join(ROOT, 'resources', 'tef', 'destaxa', 'win-x64', DLL_NAME);
  const diag = destaxaDllResolver.diagnosticarResolucao(
    { dllPath: dllX64 },
    { arch: 'ia32' }
  );
  assert.strictEqual(diag.sucesso, false);
  assert.strictEqual(diag.codigo, ERROS.DESTAXA_ARCHITECTURE_MISMATCH);
  assert.strictEqual(diag.classeDiagnostico, 'ARQUITETURA_INCOMPATIVEL');
  assert.strictEqual(diag.dllExists, true);
});

test('classificação Win32 126 → DEPENDENCIA_NATIVA_AUSENTE; 193 → ARQUITETURA', () => {
  const w126 = destaxaKoffiLoader.extrairErroWindows(
    { message: 'The specified module could not be found.', errno: 126 },
    'C:\\fake\\libdll-integracao-tef.dll'
  );
  assert.strictEqual(w126.classeDiagnostico, 'DEPENDENCIA_NATIVA_AUSENTE');
  assert.strictEqual(w126.codigoErro, ERROS.DESTAXA_NATIVE_DEPENDENCY_MISSING);

  const w193 = destaxaKoffiLoader.extrairErroWindows(
    { message: '%1 is not a valid Win32 application.', errno: 193 },
    'C:\\fake\\libdll-integracao-tef.dll'
  );
  assert.strictEqual(w193.classeDiagnostico, 'ARQUITETURA_INCOMPATIVEL');
  assert.strictEqual(w193.codigoErro, ERROS.DESTAXA_ARCHITECTURE_MISMATCH);
});

test('carga koffi sem INIT (repo) e unload', () => {
  const resolucao = destaxaDllResolver.resolverDll({}, { raizProjeto: ROOT });
  assert.ok(resolucao.sucesso);
  const lib = destaxaKoffiLoader.carregarBiblioteca(resolucao.dllPath);
  assert.strictEqual(lib.presentes.iniciaClientDestaxa, true);
  assert.strictEqual(lib.presentes.iniciaTransacaoDestaxa, true);
  assert.strictEqual(lib.presentes.continuaTransacaoDestaxa, true);
  assert.strictEqual(lib.presentes.finalizaTransacaoDestaxa, true);
  lib.unload();
});

test('artefato instalado CDS ERP: presença + hash + resolução asar_unpacked (se existir)', () => {
  const pasta = pastaArquitetura(process.arch);
  const instalada = path.join(INSTALLED_UNPACKED, pasta, DLL_NAME);
  if (!fs.existsSync(instalada)) {
    console.log(`  SKIP instalador ausente em ${instalada}`);
    return;
  }
  const meta = destaxaBinarios.arquivos[pasta];
  assert.strictEqual(fs.statSync(instalada).size, meta.tamanho);
  assert.strictEqual(sha256Arquivo(instalada), meta.sha256);

  const resPath = path.join(
    process.env['ProgramFiles'] || 'C:\\Program Files',
    'CDS ERP',
    'resources'
  );
  assert.ok(fs.existsSync(resPath));

  const prevRes = process.resourcesPath;
  const prevEnv = process.env.DESTAXA_DLL_PATH;
  delete process.env.DESTAXA_DLL_PATH;
  process.resourcesPath = resPath;
  try {
    const diag = destaxaDllResolver.diagnosticarResolucao({});
    assert.strictEqual(diag.sucesso, true, diag.mensagem);
    assert.strictEqual(diag.origem, 'asar_unpacked');
    assert.strictEqual(path.normalize(diag.dllPath), path.normalize(instalada));
  } finally {
    if (prevRes !== undefined) process.resourcesPath = prevRes;
    else delete process.resourcesPath;
    if (prevEnv !== undefined) process.env.DESTAXA_DLL_PATH = prevEnv;
  }

  const lib = destaxaKoffiLoader.carregarBiblioteca(instalada);
  assert.strictEqual(lib.presentes.iniciaClientDestaxa, true);
  lib.unload();
});

test('afterPack contém guarda TEF-16 das DLLs Destaxa', () => {
  const afterPack = fs.readFileSync(path.join(ROOT, 'build/electron/afterPack.js'), 'utf8');
  assert.match(afterPack, /TEF-16/);
  assert.match(afterPack, /app\.asar\.unpacked/);
  assert.match(afterPack, /destaxaBinarios/);
});

console.log('\nTEF-16 testes OK — sem INIT / sem TX / sem alteração de banco.\n');
