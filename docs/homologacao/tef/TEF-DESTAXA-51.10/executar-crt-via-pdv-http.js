'use strict';

/**
 * TEF-DESTAXA-51.10 — uma única CRT R$1,00 débito via HTTP do PDV já aberto (PID 6464).
 * Não emite auth; não liga gate; sem retry.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const outDir = __dirname;
const idempotency = `tef-destaxa-51-10-${crypto.randomBytes(8).toString('hex')}`;
const body = JSON.stringify({
  tipo: 'cartao_debito',
  valor: 1.0,
  parcelas: 1,
  venda_id: null,
  idempotency_key: idempotency
});

function request(pathname, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 300000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) { /* raw */ }
        resolve({ statusCode: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout HTTP 300s'));
    });
    req.write(payload);
    req.end();
  });
}

(async () => {
  const startedAt = new Date().toISOString();
  console.log(JSON.stringify({ event: 'crt-http-start', startedAt, idempotency, body: JSON.parse(body) }));
  const result = await request('/api/tef/pagar', body);
  const endedAt = new Date().toISOString();
  const out = {
    startedAt,
    endedAt,
    idempotency,
    statusCode: result.statusCode,
    resposta: result.json || result.text
  };
  fs.writeFileSync(path.join(outDir, 'crt-http-resultado.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((error) => {
  const fail = {
    ok: false,
    erro: error.message,
    stack: error.stack
  };
  fs.writeFileSync(path.join(outDir, 'crt-http-resultado.json'), `${JSON.stringify(fail, null, 2)}\n`);
  console.error(JSON.stringify(fail, null, 2));
  process.exit(1);
});
