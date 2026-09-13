'use strict';

/**
 * RC3.16.4 — Evidências estruturais da causa raiz Electron vs navegador.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const asar = require('@electron/asar');

const root = path.join(__dirname, '..', '..');
const asarPath = path.join(root, 'dist20-07', 'erp', 'win-unpacked', 'resources', 'app.asar');
const commonPath = path.join(root, 'electron-common.js');
const auditPath = path.join(root, 'electron-auditoria-rc3164.js');
const preloadPath = path.join(root, 'preload.js');
const pkgPath = path.join(root, 'package.json');

function read(rel) {
  return fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
}

function extractAsar(posixRel) {
  return asar.extractFile(asarPath, posixRel.replace(/\//g, '\\')).toString('utf8');
}

function hasAsar(posixRel) {
  const list = asar.listPackage(asarPath);
  const key = '\\' + posixRel.replace(/\//g, '\\');
  return list.includes(key);
}

function test(name, fn) {
  try {
    fn();
    console.log('OK', name);
  } catch (err) {
    console.error('FAIL', name);
    throw err;
  }
}

test('não existe electron/main.js — entrada é electron-erp.js / electron-common.js', () => {
  assert.strictEqual(fs.existsSync(path.join(root, 'electron', 'main.js')), false);
  assert.strictEqual(fs.existsSync(commonPath), true);
  assert.strictEqual(fs.existsSync(path.join(root, 'electron-erp.js')), true);
  assert.strictEqual(fs.existsSync(path.join(root, 'electron', 'renderer.js')), false);
  assert.strictEqual(fs.existsSync(preloadPath), true);
});

test('package.json: main electron.js; build ERP usa electron-erp.js', () => {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.strictEqual(pkg.main, 'electron.js');
  assert.strictEqual(pkg.version, '1.0.3');
  assert.strictEqual(pkg.devDependencies.electron, '22.3.27');
  const builder = JSON.parse(fs.readFileSync(path.join(root, 'electron-builder-erp.json'), 'utf8'));
  assert.strictEqual(builder.extraMetadata.main, 'electron-erp.js');
});

test('Electron carrega via loadURL(http://127.0.0.1), não loadFile', () => {
  const common = fs.readFileSync(commonPath, 'utf8');
  assert.match(common, /loadURL\(/);
  assert.match(common, /http:\/\/127\.0\.0\.1:\$\{serverPort\}/);
  assert.doesNotMatch(common, /loadFile\(/);
  assert.match(common, /nodeIntegration:\s*false/);
  assert.match(common, /contextIsolation:\s*true/);
  assert.match(common, /sandbox:\s*false/);
  assert.match(common, /preload:\s*path\.join\(__dirname,\s*'preload\.js'\)/);
});

test('RC3.16.4: auditoria + invalidação de cache HTTP na camada Electron', () => {
  assert.strictEqual(fs.existsSync(auditPath), true);
  const common = fs.readFileSync(commonPath, 'utf8');
  assert.match(common, /electron-auditoria-rc3164/);
  assert.match(common, /disable-http-cache/);
  assert.match(common, /invalidarCachesSessao/);
  assert.match(common, /registrarAuditoriaStartup/);
});

test('CAUSA RAIZ: app.asar instalado diverge do código-fonte (browser)', () => {
  assert.strictEqual(fs.existsSync(asarPath), true, 'dist20-07 app.asar deve existir para evidência');

  const coreAsar = extractAsar('frontend/shared/js/core.js');
  const coreDisk = read('frontend/shared/js/core.js');
  assert.notStrictEqual(coreAsar, coreDisk);
  assert.strictEqual(coreAsar.includes('fail-closed'), false);
  assert.strictEqual(coreDisk.includes('fail-closed'), true);

  const htmlAsar = extractAsar('frontend/erp/index.html');
  const htmlDisk = read('frontend/erp/index.html');
  assert.notStrictEqual(htmlAsar, htmlDisk);
  assert.strictEqual(htmlAsar.includes('nfe-central.js'), false);
  assert.strictEqual(htmlDisk.includes('nfe-central.js'), true);
  assert.strictEqual(htmlAsar.includes('pedidos.js'), false);
  assert.strictEqual(htmlDisk.includes('pedidos.js'), true);
  assert.strictEqual(htmlAsar.includes('faturamento.js'), false);
  assert.strictEqual(htmlDisk.includes('faturamento.js'), true);

  const ausentes = [
    'frontend/erp/js/nfe-central.js',
    'frontend/erp/js/nfe-avulsa.js',
    'frontend/erp/js/nfe-operacional.js',
    'frontend/erp/js/pedidos.js',
    'frontend/erp/js/faturamento.js'
  ];
  for (const rel of ausentes) {
    assert.strictEqual(hasAsar(rel), false, `${rel} não deve existir no asar antigo`);
    assert.strictEqual(fs.existsSync(path.join(root, ...rel.split('/'))), true);
  }
});

test('API_URL no frontend deriva de location.origin (Electron = 127.0.0.1)', () => {
  const core = read('frontend/shared/js/core.js');
  assert.match(core, /window\.location\.origin\}\/api/);
});

console.log('\nRC3.16.4 — testes estruturais OK');
