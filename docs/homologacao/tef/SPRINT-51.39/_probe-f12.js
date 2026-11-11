'use strict';

/**
 * SPRINT 51.39 — probe read-only de /api/f12/contexto (sem TEF/DLL/COM4/venda).
 */
const http = require('http');
const path = require('path');
const sqlite3 = require('sqlite3');

const BASE = 'http://127.0.0.1:3001';
const DB = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';

function request(method, urlPath, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, BASE);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {})
        },
        timeout: 10000
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) { /* ignore */ }
          resolve({ status: res.statusCode, body: json, raw: data.slice(0, 500) });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);
    db.all(sql, params, (err, rows) => {
      db.close();
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function main() {
  const out = { ts: new Date().toISOString(), steps: {} };

  try {
    out.steps.ping = await request('GET', '/api/ping');
  } catch (e) {
    out.steps.ping = { error: String(e.message || e) };
    console.log(JSON.stringify(out, null, 2));
    process.exit(2);
  }

  out.steps.caixa2 = await dbAll(
    'SELECT id, nome, ativo, f12_ativo FROM caixas WHERE id = ?',
    [2]
  );
  out.steps.licencaLogs = await dbAll(
    'SELECT * FROM licenca_logs ORDER BY id DESC LIMIT 20'
  );

  // Login Diego (credencial de homologacao ja usada na sprint; sem TEF)
  const login = await request('POST', '/api/auth/login', {
    body: { username: 'Diego', password: '1234' }
  });
  out.steps.login = { status: login.status, keys: login.body && Object.keys(login.body) };
  const token = login.body && (login.body.token || login.body.access_token);
  if (!token) {
    out.steps.login.body = login.body;
    console.log(JSON.stringify(out, null, 2));
    process.exit(3);
  }

  out.steps.contexto2 = await request('GET', '/api/f12/contexto/2', { token });
  out.steps.contextoInexistente = await request('GET', '/api/f12/contexto/999999', { token });
  out.steps.contextoInvalido = await request('GET', '/api/f12/contexto/abc', { token });
  out.steps.contextoSemToken = await request('GET', '/api/f12/contexto/2');
  out.steps.contextoTokenLixo = await request('GET', '/api/f12/contexto/2', {
    token: 'token.invalido.lixo'
  });

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
