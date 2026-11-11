'use strict';

/**
 * Persiste venda fiscal R$1 e executa UMA CRT no backend Electron 5700.
 * Usa permit ISSUED já emitido. Sem retry. Sem gate global.
 * A chamada anterior (sem venda_id) NÃO foi CRT — foi rejeição pré-Destaxa.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');

const outDir = __dirname;
const token = fs.readFileSync(path.join(outDir, '.pdv-session-token.tmp'), 'utf8').trim();
const DB = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';

function request(method, pathname, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: pathname,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        } : {})
      },
      timeout: method === 'POST' && pathname.includes('/tef/') ? 420000 : 30000
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
      reject(new Error(`timeout ${pathname}`));
    });
    if (body) req.write(body);
    req.end();
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);
    db.get(sql, params, (err, row) => {
      db.close();
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

(async () => {
  const startedAt = new Date().toISOString();

  // Permit ainda ISSUED?
  const ledgerPath = path.join(
    process.env.LOCALAPPDATA || '',
    'CDS-SISTEMAS',
    'tef',
    'destaxa-autorizacao-excepcional.json'
  );
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const permit = (ledger.autorizacoes || []).find((a) => a.authorizationId === 'cff481501f704f672b3e956f4bcb62b4');
  if (!permit || permit.status !== 'ISSUED') {
    console.error(JSON.stringify({ ok: false, erro: 'Permit não está ISSUED', permit }, null, 2));
    process.exit(2);
  }

  const sessao = await get(
    `SELECT id, caixa_id, terminal_id, status FROM caixa_sessoes
     WHERE status = 'aberto' AND caixa_id = 2 ORDER BY id DESC LIMIT 1`
  );
  const terminal = await get(
    `SELECT id, caixa_id FROM terminais WHERE caixa_id = 2 ORDER BY id DESC LIMIT 1`
  );

  const vendaBody = {
    origem: 'PDV',
    tipo_venda: 'BALCAO',
    total: 1,
    desconto: 0,
    forma_pagamento: 'cartao_debito',
    emitir_fiscal: false,
    caixa_sessao_id: sessao ? sessao.id : 6,
    terminal_id: terminal ? terminal.id : (sessao && sessao.terminal_id) || 5,
    itens: [{
      produto_id: 304,
      quantidade: 1,
      preco_unitario: 1,
      subtotal: 1,
      item_fiscal: 1,
      tipo_venda: 'UNIDADE'
    }],
    pagamentos: [{
      forma_pagamento: 'cartao_debito',
      valor: 1,
      tipo_recebimento: 'fiscal'
    }]
  };

  console.log(JSON.stringify({
    event: 'criar-venda-pre-crt',
    startedAt,
    sessao,
    terminal,
    permitStatus: permit.status
  }));

  const vendaRes = await request('POST', '/api/vendas', vendaBody);
  fs.writeFileSync(
    path.join(outDir, 'venda-criada.json'),
    `${JSON.stringify({ statusCode: vendaRes.statusCode, body: vendaRes.json || vendaRes.text }, null, 2)}\n`
  );

  const vendaId = vendaRes.json
    && (vendaRes.json.id || vendaRes.json.venda_id || (vendaRes.json.venda && vendaRes.json.venda.id));
  if (!(vendaRes.statusCode >= 200 && vendaRes.statusCode < 300) || !vendaId) {
    console.error(JSON.stringify({
      ok: false,
      etapa: 'criar-venda',
      statusCode: vendaRes.statusCode,
      body: vendaRes.json || vendaRes.text
    }, null, 2));
    process.exit(3);
  }

  // Confirmar valor_fiscal
  const vendaDb = await get(
    `SELECT id, valor_total, valor_fiscal, status_venda, status_pagamento FROM vendas WHERE id = ?`,
    [vendaId]
  );
  console.log(JSON.stringify({ event: 'venda-persistida', vendaId, vendaDb }, null, 2));

  const idempotency = `tef-segunda-tentativa-${crypto.randomBytes(8).toString('hex')}`;
  const pagarBody = {
    tipo: 'cartao_debito',
    valor: 1.0,
    parcelas: 1,
    venda_id: Number(vendaId),
    idempotency_key: idempotency
  };

  const startMsg = {
    event: 'segunda-tentativa-tef-pagar-start',
    startedAt: new Date().toISOString(),
    idempotency,
    path: '/api/tef/pagar',
    body: pagarBody,
    avisoOperador: 'APROXIME/INSIRA O CARTÃO DE DÉBITO NO PINPAD GERTEC COM4 AGORA — UMA OPERAÇÃO'
  };
  console.log(JSON.stringify(startMsg));
  fs.writeFileSync(path.join(outDir, 'venda-http-inicio.json'), `${JSON.stringify(startMsg, null, 2)}\n`);
  fs.writeFileSync(
    path.join(outDir, 'PINPAD-AGORA.txt'),
    'OPERADOR: colete cartão DÉBITO no Gertec COM4 agora. Uma única CRT. Sem retry.\n'
  );

  const result = await request('POST', '/api/tef/pagar', pagarBody);
  const endedAt = new Date().toISOString();
  const out = {
    startedAt,
    endedAt,
    vendaId: Number(vendaId),
    idempotency,
    statusCode: result.statusCode,
    resposta: result.json || result.text
  };
  fs.writeFileSync(path.join(outDir, 'venda-http-resultado.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out, null, 2));

  const fsState = out.resposta && out.resposta.financialState;
  const codigo = out.resposta && out.resposta.codigo;
  if (fsState === 'UNKNOWN' || codigo === 'TIMEOUT' || String(codigo || '').includes('UNKNOWN')) {
    console.error(JSON.stringify({ alerta: 'TIMEOUT_OU_UNKNOWN — interromper; sem retry' }));
  }
  process.exit(result.statusCode >= 200 && result.statusCode < 300 ? 0 : 1);
})().catch((error) => {
  const fail = { ok: false, erro: error.message, stack: error.stack, endedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(outDir, 'venda-http-resultado.json'), `${JSON.stringify(fail, null, 2)}\n`);
  console.error(JSON.stringify(fail, null, 2));
  process.exit(1);
});
