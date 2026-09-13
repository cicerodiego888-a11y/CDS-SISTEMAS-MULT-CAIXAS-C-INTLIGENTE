/**
 * RC4.32.0 — Helpers HTTP para certificação funcional
 */
'use strict';

const http = require('http');

function request(method, url, body, token) {
  const parsed = new URL(url);
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch (_) { json = { raw: data }; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function aguardarPing(baseUrl, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await request('GET', `${baseUrl}/ping`);
      if (r.status === 200 && r.body?.status === 'ok') return true;
    } catch (_) { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Servidor não respondeu em ${timeoutMs}ms: ${baseUrl}`);
}

async function login(baseUrl, username = 'admin', password = '1234') {
  const r = await request('POST', `${baseUrl}/auth/login`, { username, password });
  if (r.status !== 200 || !r.body?.token) {
    throw new Error(`Login falhou: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  }
  return r.body;
}

module.exports = { request, aguardarPing, login };
