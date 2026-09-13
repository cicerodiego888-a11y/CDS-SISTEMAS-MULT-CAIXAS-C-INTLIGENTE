/**
 * RC14.15.17 / RC14.15.19 — Launcher MGV6 (ShellExecute; spawn não é primário)
 * npm run test:mgv6-execucao-v1
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const launcher = require('../../backend/motores/equipamentos/mgv6/MGV6Launcher');
const syncService = require('../../backend/motores/equipamentos/mgv6/MGV6SyncService');
const { CODES } = require('../../backend/motores/equipamentos/mgv6/MGV6Errors');

const ROOT = path.join(__dirname, '../..');
let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mgv6-141517-'));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
});

function fakeExe() {
  const p = path.join(tmpRoot, 'MGV6.exe');
  fs.writeFileSync(p, Buffer.from('MZ'));
  return p;
}

describe('RC14.15.17/19 — ShellExecute (não spawn)', () => {
  it('abre via openPath sem exigir PID', async () => {
    const exe = fakeExe();
    let opened = null;
    const r = await launcher.launch({
      autoLaunch: true,
      mgv6Executable: exe
    }, {
      openPath: async (p) => {
        opened = p;
        return '';
      }
    });
    assert.equal(r.iniciado, true);
    assert.equal(r.metodo, 'shell-execute');
    assert.equal(r.pid, null);
    assert.equal(path.resolve(opened), path.resolve(exe));
  });

  it('fonte: shell.openPath; sem spawn primário', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/mgv6/MGV6Launcher.js'),
      'utf8'
    );
    assert.match(src, /shell\.openPath|openPathFn/);
    assert.match(src, /shell-execute/);
    assert.doesNotMatch(src, /require\(['"]child_process['"]\)/);
    assert.doesNotMatch(src, /windowsHide:\s*true/);
    assert.doesNotMatch(src, /PID: \?/);
  });

  it('EXE inexistente → EXECUTABLE_NOT_FOUND ou LAUNCH_INVALID', async () => {
    await assert.rejects(
      () => launcher.launch({
        autoLaunch: true,
        mgv6Executable: path.join(tmpRoot, 'nao-existe.exe')
      }, { openPath: async () => '' }),
      (e) => e.code === CODES.EXECUTABLE_NOT_FOUND || e.code === CODES.LAUNCH_INVALID
    );
  });

  it('erro do shell → LAUNCH_FAILED', async () => {
    const exe = fakeExe();
    await assert.rejects(
      () => launcher.launch({
        autoLaunch: true,
        mgv6Executable: exe
      }, {
        openPath: async () => 'Failed to open path'
      }),
      (e) => e.code === CODES.LAUNCH_FAILED
    );
  });

  it('iniciarMgv6 sucesso sem PID', async () => {
    const exe = fakeExe();
    const r = await syncService.iniciarMgv6(141517, {
      obterConfig: async () => ({
        mgv6Executable: exe,
        exportFolder: path.join(tmpRoot, 'TXT'),
        autoLaunch: true
      }),
      launch: async () => ({
        iniciado: true,
        sucesso: true,
        metodo: 'shell-execute',
        pid: null,
        path: exe
      })
    });
    assert.equal(r.sucesso, true);
    assert.equal(r.iniciado, true);
    assert.equal(r.pid, null);
    assert.equal(r.metodo, 'shell-execute');
  });
});

describe('RC14.15.17/19 — UI', () => {
  it('UI: aberto pelo Windows; sem pidOk', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'frontend/erp/js/enviar-produtos-balanca.js'),
      'utf8'
    );
    assert.match(src, /MGV6 aberto pelo Windows/);
    assert.doesNotMatch(src, /pidOk/);
    assert.match(src, /Não foi possível abrir o MGV6/);
  });
});
