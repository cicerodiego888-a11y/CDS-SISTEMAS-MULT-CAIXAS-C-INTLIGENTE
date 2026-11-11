'use strict';

/**
 * Única CRT autorizada — venda 66 já persistida (valor_fiscal=1).
 * Permit ISSUED cff48150… ainda válido. Sem retry.
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
  venda_id: 66,
  idempotency_key: idempotency
};
const body = JSON.stringify(bodyObj);

function request(payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/tef/pagar',
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
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout HTTP 420s')); });
    req.write(payload);
    req.end();
  });
}

(async () => {
  const ledgerPath = path.join(process.env.LOCALAPPDATA || '', 'CDS-SISTEMAS', 'tef', 'destaxa-autorizacao-excepcional.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const permit = (ledger.autorizacoes || []).find((a) => a.authorizationId === 'cff481501f704f672b3e956f4bcb62b4');
  if (!permit || permit.status !== 'ISSUED') {
    console.error(JSON.stringify({ ok: false, erro: 'Permit não ISSUED', permit }, null, 2));
    process.exit(2);
  }

  const startedAt = new Date().toISOString();
  const startMsg = {
    event: 'segunda-tentativa-tef-pagar-start',
    startedAt,
    idempotency,
    path: '/api/tef/pagar',
    body: bodyObj,
    permitId: permit.authorizationId,
    avisoOperador: 'APROXIME/INSIRA O CARTÃO DE DÉBITO NO PINPAD GERTEC COM4 AGORA — UMA OPERAÇÃO'
  };
  console.log(JSON.stringify(startMsg));
  fs.writeFileSync(path.join(outDir, 'venda-http-inicio.json'), `${JSON.stringify(startMsg, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'PINPAD-AGORA.txt'), 'OPERADOR: cartão DÉBITO no Gertec COM4 AGORA. Uma CRT.\n');

  const result = await request(body);
  const out = {
    startedAt,
    endedAt: new Date().toISOString(),
    vendaId: 66,
    idempotency,
    statusCode: result.statusCode,
    resposta: result.json || result.text
  };
  fs.writeFileSync(path.join(outDir, 'venda-http-resultado.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out, null, 2));
  const codigo = out.resposta && (out.resposta.codigo || out.resposta.financialState);
  if (codigo === 'TIMEOUT' || codigo === 'UNKNOWN' || (out.resposta && out.resposta.financialState === 'UNKNOWN')) {
    console.error(JSON.stringify({ alerta: 'TIMEOUT_OU_UNKNOWN — interromper; sem retry' }));
  }
  process.exit(result.statusCode >= 200 && result.statusCode < 300 ? 0 : 1);
})().catch((error) => {
  const fail = { ok: false, erro: error.message, endedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(outDir, 'venda-http-resultado.json'), `${JSON.stringify(fail, null, 2)}\n`);
  console.error(JSON.stringify(fail, null, 2));
  process.exit(1);
});
