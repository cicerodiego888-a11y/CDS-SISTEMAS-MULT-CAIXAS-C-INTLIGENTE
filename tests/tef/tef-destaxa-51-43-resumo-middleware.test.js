'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const { verificarToken } = require(path.join(ROOT, 'backend/middleware/auth'));
const { getJwtSecret } = require(path.join(ROOT, 'backend/config/secrets'));
const DB_OFICIAL = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';

function sqlResumo() {
  return `
    SELECT
      v.id AS venda_id,
      COALESCE(vp.tef_transacao_id, tt.id) AS tef_transacao_id,
      COALESCE(vp.tef_nsu, tt.nsu) AS tef_nsu,
      COALESCE(vp.tef_autorizacao, tt.autorizacao) AS tef_autorizacao,
      COALESCE(vp.tef_bandeira, tt.bandeira) AS tef_bandeira,
      COALESCE(vp.tef_adquirente, tt.adquirente) AS tef_adquirente
    FROM vendas v
    LEFT JOIN venda_pagamentos vp
      ON vp.venda_id = v.id AND vp.tef_transacao_id IS NOT NULL
    LEFT JOIN tef_transacoes tt
      ON tt.id = COALESCE(v.tef_transacao_id, vp.tef_transacao_id)
    WHERE v.id = ?
    LIMIT 1
  `;
}

function criarApp() {
  const app = express();
  app.get('/api/tef/venda/:vendaId/resumo', verificarToken, (req, res) => {
    const vendaId = Number(req.params.vendaId);
    const db = new DatabaseSync(DB_OFICIAL, { readOnly: true });
    try {
      const row = db.prepare(sqlResumo()).get(vendaId);
      if (!row) {
        return res.status(404).json({ error: 'Venda não encontrada.' });
      }
      return res.json(row);
    } finally {
      db.close();
    }
  });
  return app;
}

function request(server, { path: urlPath, headers = {} }) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
      method: 'GET',
      headers: { Accept: 'application/json', ...headers }
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body || '{}'); } catch (_) { json = { raw: body }; }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const app = criarApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  let passed = 0;
  const ok = (m) => { passed += 1; console.log('OK:', m); };
  const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };

  try {
    const r = await request(server, { path: '/api/tef/venda/66/resumo' });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(r.json.error, 'Acesso negado');
    ok('sem autenticação → 401');
  } catch (e) { fail(e.message); }

  try {
    const r = await request(server, {
      path: '/api/tef/venda/66/resumo',
      headers: { Authorization: 'Bearer token-falso-51-43' }
    });
    assert.strictEqual(r.status, 403);
    assert.ok(
      r.json.error === 'Token inválido ou expirado' || r.json.erro === 'TOKEN_INVALIDO'
    );
    ok('token inválido → 403');
  } catch (e) { fail(e.message); }

  try {
    const token = jwt.sign(
      { id: 1, username: 'teste-51-43', role: 'admin' },
      getJwtSecret(),
      { expiresIn: '5m' }
    );
    const r = await request(server, {
      path: '/api/tef/venda/66/resumo',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(Number(r.json.tef_transacao_id), 3);
    assert.strictEqual(String(r.json.tef_nsu), '2338');
    assert.strictEqual(String(r.json.tef_autorizacao), '211139');
    ok('autenticado → 200 com TEF 3 / NSU 2338 / auth 211139');
  } catch (e) { fail(e.message); }

  try {
    const token = jwt.sign(
      { id: 1, username: 'teste-51-43', role: 'admin' },
      getJwtSecret(),
      { expiresIn: '5m' }
    );
    const r = await request(server, {
      path: '/api/tef/venda/999999991/resumo',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.json.error, 'Venda não encontrada.');
    ok('venda inexistente autenticada → 404 (não 401)');
  } catch (e) { fail(e.message); }

  try {
    const r = await request(server, { path: '/api/tef/venda/999999991/resumo' });
    assert.strictEqual(r.status, 401);
    ok('venda inexistente sem auth → 401 (auth primeiro)');
  } catch (e) { fail(e.message); }

  await new Promise((resolve) => server.close(resolve));
  console.log(`\nResultado: ${passed} ok`);
  if (process.exitCode) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
