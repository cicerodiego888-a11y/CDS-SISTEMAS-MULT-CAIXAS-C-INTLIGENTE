/**
 * RC4.32.0 — Bootstrap do servidor ERP para certificação funcional
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { aguardarPing } = require('./apiClient');

async function iniciarServidor(rootDir, opcoes = {}) {
  const porta = opcoes.porta || (38000 + Math.floor(Math.random() * 1000));
  const dbDir = opcoes.dbDir || fs.mkdtempSync(path.join(os.tmpdir(), 'cds-release-cert-'));
  const serverPath = path.join(rootDir, 'backend', 'server.js');

  const proc = spawn(process.execPath, [serverPath], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(porta),
      DB_DIR: dbDir,
      NODE_ENV: 'test',
      JWT_SECRET: process.env.JWT_SECRET || 'cds-release-cert-test-secret'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const logs = [];
  proc.stdout.on('data', (d) => logs.push(d.toString()));
  proc.stderr.on('data', (d) => logs.push(d.toString()));

  const baseUrl = `http://127.0.0.1:${porta}/api`;
  try {
    await aguardarPing(`http://127.0.0.1:${porta}`, opcoes.timeoutMs || 90000);
  } catch (err) {
    proc.kill('SIGTERM');
    throw new Error(`${err.message}\nLogs: ${logs.slice(-5).join('')}`);
  }

  return {
    proc,
    porta,
    dbDir,
    baseUrl,
    parar: () => {
      try { proc.kill('SIGTERM'); } catch (_) { /* ignore */ }
    }
  };
}

module.exports = { iniciarServidor };
