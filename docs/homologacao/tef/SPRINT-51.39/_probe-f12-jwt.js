'use strict';

/**
 * SPRINT 51.39 — probe JWT + /api/f12/contexto (sem TEF/DLL/COM4/venda).
 * Gera token de teste com o mesmo segredo do backend (somente homologação local).
 */
const http = require('http');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');
const { getJwtSecret } = require('../../../../backend/config/secrets');

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
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);
    db.get(sql, params, (err, row) => {
      db.close();
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function main() {
  const user = await dbGet(
    `SELECT id, username, role, COALESCE(perfil, 'USUARIO') AS perfil
     FROM usuarios
     WHERE UPPER(COALESCE(perfil, '')) IN ('SUPER_ADMIN', 'ADMIN')
        OR LOWER(COALESCE(role, '')) = 'admin'
     ORDER BY id ASC LIMIT 1`
  );
  if (!user) throw new Error('Nenhum admin encontrado');

  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      perfil: user.perfil
    },
    getJwtSecret(),
    { expiresIn: '15m' }
  );

  const tokenOperadorFake = jwt.sign(
    { id: 999999, username: 'operador-fake', role: 'user', perfil: 'OPERADOR' },
    getJwtSecret(),
    { expiresIn: '15m' }
  );

  const out = {
    user: { id: user.id, username: user.username, perfil: user.perfil },
    contexto2: await request('GET', '/api/f12/contexto/2', { token }),
    contextoInexistente: await request('GET', '/api/f12/contexto/999999', { token }),
    contextoInvalido: await request('GET', '/api/f12/contexto/abc', { token }),
    contextoSemToken: await request('GET', '/api/f12/contexto/2'),
    contextoTokenInvalido: await request('GET', '/api/f12/contexto/2', {
      token: 'a.b.c'
    }),
    // operador autenticado ainda pode LER contexto (rota não exige admin)
    contextoOperador: await request('GET', '/api/f12/contexto/2', { token: tokenOperadorFake })
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
