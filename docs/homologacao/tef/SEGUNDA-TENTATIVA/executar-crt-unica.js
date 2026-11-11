'use strict';

/**
 * Uma única CRT R$1,00 débito via backend do Electron oficial (:3001 / PID 5700).
 * Sem retry. Sem ligar gate. Usa permit excepcional ISSUED.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const outDir = __dirname;
const token = fs.readFileSync(path.join(outDir, '.pdv-session-token.tmp'), 'utf8').trim();
const idempotency = `tef-segunda-tentativa-${crypto.randomBytes(8).toString('hex')}`;

const bodyObj = {
  tipo: 'cartao_debito',
  valor: 1.0,
  parcelas: 1,
  idempotency_key: idempotency
};
const body = JSON.stringify(bodyObj);

function request(pathname, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: `Bearer ${token}`
      },
      timeout: 420000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) { /* raw */ }
        resolve({ statusCode: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout HTTP 420s'));
    });
    req.write(payload);
    req.end();
  });
}

(async () => {
  const startedAt = new Date().toISOString();
  const startMsg = {
    event: 'segunda-tentativa-tef-pagar-start',
    startedAt,
    idempotency,
    path: '/api/tef/pagar',
    body: bodyObj,
    avisoOperador: 'APROXIME/INSIRA O CARTÃO DE DÉBITO NO PINPAD GERTEC COM4 AGORA — UMA OPERAÇÃO'
  };
  console.log(JSON.stringify(startMsg));
  fs.writeFileSync(path.join(outDir, 'venda-http-inicio.json'), `${JSON.stringify(startMsg, null, 2)}\n`);
  fs.writeFileSync(
    path.join(outDir, 'PINPAD-AGORA.txt'),
    'OPERADOR: colete cartão DÉBITO no Gertec COM4 agora. Uma única operação. Sem retry.\n'
  );

  const result = await request('/api/tef/pagar', body);
  const endedAt = new Date().toISOString();
  const out = {
    startedAt,
    endedAt,
    idempotency,
    statusCode: result.statusCode,
    resposta: result.json || result.text
  };
  fs.writeFileSync(path.join(outDir, 'venda-http-resultado.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out, null, 2));

  const codigo = out.resposta && (out.resposta.codigo || out.resposta.financialState || out.resposta.status);
  const unknown = String(codigo || '').toUpperCase().includes('UNKNOWN')
    || String(codigo || '').toUpperCase().includes('TIMEOUT')
    || (out.resposta && out.resposta.financialState === 'UNKNOWN');
  if (unknown) {
    console.error(JSON.stringify({
      alerta: 'TIMEOUT_OU_UNKNOWN — interromper; sem retry; estado preservado'
    }));
  }
  process.exit(result.statusCode >= 200 && result.statusCode < 300 ? 0 : 1);
})().catch((error) => {
  const fail = {
    ok: false,
    erro: error.message,
    stack: error.stack,
    endedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(outDir, 'venda-http-resultado.json'), `${JSON.stringify(fail, null, 2)}\n`);
  console.error(JSON.stringify(fail, null, 2));
  process.exit(1);
});
