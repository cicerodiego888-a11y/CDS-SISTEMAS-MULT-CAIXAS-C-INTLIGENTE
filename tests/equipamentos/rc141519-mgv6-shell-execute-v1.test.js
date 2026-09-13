/**
 * RC14.15.19 — MGV6 launcher via Electron ShellExecute (shell.openPath)
 * npm run test:mgv6-shell-execute-v1
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const launcher = require('../../backend/motores/equipamentos/mgv6/MGV6Launcher');
const { CODES } = require('../../backend/motores/equipamentos/mgv6/MGV6Errors');

const ROOT = path.join(__dirname, '../..');
let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mgv6-141519-'));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
});

describe('RC14.15.19 — shell.openPath', () => {
  it('1. EXE válido → chama openPath', async () => {
    const exe = path.join(tmpRoot, 'MGV6.exe');
    fs.writeFileSync(exe, Buffer.from('MZ'));
    const calls = [];
    const r = await launcher.launch({
      autoLaunch: true,
      mgv6Executable: exe
    }, {
      openPath: async (p) => {
        calls.push(p);
        return '';
      }
    });
    assert.equal(calls.length, 1);
    assert.equal(path.resolve(calls[0]), path.resolve(exe));
    assert.equal(r.sucesso, true);
    assert.equal(r.iniciado, true);
    assert.equal(r.metodo, 'shell-execute');
  });

  it('2. EXE inexistente → rejeita', async () => {
    await assert.rejects(
      () => launcher.launch({
        autoLaunch: true,
        mgv6Executable: path.join(tmpRoot, 'missing.exe')
      }, { openPath: async () => '' }),
      (e) => e.code === CODES.EXECUTABLE_NOT_FOUND || e.code === CODES.LAUNCH_INVALID
    );
  });

  it('3. erro do shell → MGV6_LAUNCH_FAILED', async () => {
    const exe = path.join(tmpRoot, 'MGV6b.exe');
    fs.writeFileSync(exe, Buffer.from('MZ'));
    await assert.rejects(
      () => launcher.launch({
        autoLaunch: true,
        mgv6Executable: exe
      }, { openPath: async () => 'Access denied by OS' }),
      (e) => e.code === CODES.LAUNCH_FAILED && /Access denied/i.test(e.message)
    );
  });

  it('4. não utiliza spawn como launcher primário', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/mgv6/MGV6Launcher.js'),
      'utf8'
    );
    assert.doesNotMatch(src, /require\(['"]child_process['"]\)/);
    assert.doesNotMatch(src, /\bspawn\s*\(/);
    assert.match(src, /openPath/);
  });

  it('5. não exige PID', async () => {
    const exe = path.join(tmpRoot, 'MGV6c.exe');
    fs.writeFileSync(exe, Buffer.from('MZ'));
    const r = await launcher.launch({
      autoLaunch: true,
      mgv6Executable: exe
    }, { openPath: async () => '' });
    assert.equal(r.pid, null);
    assert.equal(r.iniciado, true);
  });

  it('6–8. TXITENS / TCP / SQL não alterados no launcher', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/mgv6/MGV6Launcher.js'),
      'utf8'
    );
    assert.doesNotMatch(src, /buildRecord|tbItemBalanca|ConnectionManager|ToledoPrixIVDriver/);
    const builder = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/mgv6/MGV6FileBuilder.js'),
      'utf8'
    );
    assert.match(builder, /320|REGISTRO/);
    assert.doesNotMatch(builder, /RC14\.15\.19/);
  });
});
