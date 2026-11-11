'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const ERP_VENDAS = path.join(ROOT, 'frontend/erp/js/vendas.js');
const PDV_VENDAS = path.join(ROOT, 'frontend/pdv/js/vendas.js');
const PDV_JS = path.join(ROOT, 'frontend/pdv/js/pdv.js');
const TEF_ROTAS = path.join(ROOT, 'backend/rotas/tef.js');
const SERVER = path.join(ROOT, 'backend/server.js');
const AUTH = path.join(ROOT, 'backend/middleware/auth.js');
const DB_OFICIAL = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';

function ler(p) {
  return fs.readFileSync(p, 'utf8');
}

function assertAuthFetch(src, label) {
  assert.match(
    src,
    /Authorization['"`]\s*:\s*[`'"]Bearer \$\{token\}/,
    `${label}: deve enviar Authorization Bearer`
  );
  assert.match(
    src,
    /localStorage\.getItem\('token'\)/,
    `${label}: deve ler token do storage`
  );
  assert.match(
    src,
    /response\.status === 401/,
    `${label}: deve tratar 401 (sessão/autenticação)`
  );
  assert.match(
    src,
    /response\.status === 403/,
    `${label}: deve tratar 403 (token inválido/expirado)`
  );
  assert.doesNotMatch(
    src,
    /fetch\(`\$\{API_URL\}\/tef\/venda\/\$\{vendaId\}\/resumo`\s*\)/,
    `${label}: não pode chamar resumo sem headers`
  );
}

function sqlResumoFonte() {
  return `
    SELECT
      v.id AS venda_id,
      COALESCE(vp.tef_transacao_id, tt.id) AS tef_transacao_id,
      COALESCE(vp.tef_nsu, tt.nsu) AS tef_nsu,
      COALESCE(vp.tef_autorizacao, tt.autorizacao) AS tef_autorizacao
    FROM vendas v
    LEFT JOIN venda_pagamentos vp
      ON vp.venda_id = v.id AND vp.tef_transacao_id IS NOT NULL
    LEFT JOIN tef_transacoes tt
      ON tt.id = COALESCE(v.tef_transacao_id, vp.tef_transacao_id)
    WHERE v.id = ?
    LIMIT 1
  `;
}

function requestJson(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body || '{}'); } catch (_) { json = { raw: body }; }
        resolve({ status: res.statusCode, json, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(4000, () => {
      req.destroy(new Error('timeout'));
    });
    req.end();
  });
}

async function probeApi(pathname, headers = {}) {
  return requestJson({
    hostname: '127.0.0.1',
    port: 5700,
    path: pathname,
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...headers
    }
  });
}

(async () => {
  let passed = 0;
  const fail = (msg) => {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  };
  const ok = (msg) => {
    passed += 1;
    console.log('OK:', msg);
  };

  try {
    assertAuthFetch(ler(ERP_VENDAS), 'erp/vendas.js');
    ok('frontend ERP envia Bearer no resumo');
  } catch (e) { fail(e.message); }

  try {
    assertAuthFetch(ler(PDV_VENDAS), 'pdv/vendas.js');
    ok('frontend PDV vendas.js envia Bearer no resumo');
  } catch (e) { fail(e.message); }

  try {
    assertAuthFetch(ler(PDV_JS), 'pdv/pdv.js');
    ok('frontend PDV pdv.js envia Bearer no resumo');
  } catch (e) { fail(e.message); }

  try {
    const server = ler(SERVER);
    assert.match(server, /app\.use\('\/api\/tef',\s*verificarToken,\s*tefRoutes\)/);
    ok('server.js mantém verificarToken em /api/tef');
  } catch (e) { fail(e.message); }

  try {
    const auth = ler(AUTH);
    assert.match(auth, /status\(401\).*Acesso negado|Acesso negado[\s\S]*status\(401\)/);
    assert.ok(auth.includes("error: 'Acesso negado'"));
    ok('401 sem token permanece "Acesso negado"');
  } catch (e) { fail(e.message); }

  try {
    const rotas = ler(TEF_ROTAS);
    assert.match(rotas, /LEFT JOIN tef_transacoes tt/);
    assert.match(rotas, /COALESCE\(vp\.tef_transacao_id,\s*tt\.id\)/);
    assert.match(rotas, /COALESCE\(v\.tef_transacao_id,\s*vp\.tef_transacao_id\)/);
    ok('rota resumo usa fallback tef_transacoes');
  } catch (e) { fail(e.message); }

  try {
    if (!fs.existsSync(DB_OFICIAL)) {
      throw new Error('banco oficial ausente — skip dados venda 66');
    }
    const db = new DatabaseSync(DB_OFICIAL, { readOnly: true });
    const row = db.prepare(sqlResumoFonte()).get(66);
    db.close();
    assert.ok(row, 'venda 66 deve existir');
    assert.strictEqual(Number(row.tef_transacao_id), 3);
    assert.strictEqual(String(row.tef_nsu), '2338');
    assert.strictEqual(String(row.tef_autorizacao), '211139');
    ok('SQL resumo devolve TEF 3 / NSU 2338 / auth 211139 para venda 66');
  } catch (e) { fail(e.message); }

  try {
    if (!fs.existsSync(DB_OFICIAL)) throw new Error('banco oficial ausente');
    const db = new DatabaseSync(DB_OFICIAL, { readOnly: true });
    const missing = db.prepare(sqlResumoFonte()).get(999999991);
    db.close();
    assert.strictEqual(missing, undefined);
    ok('venda inexistente não retorna linha no SQL do resumo');
  } catch (e) { fail(e.message); }

  // Probes HTTP opcionais (ERP em :5700). Não falham a suite se o servidor estiver down.
  let erpUp = false;
  try {
    const semToken = await probeApi('/api/tef/venda/66/resumo');
    erpUp = true;
    assert.strictEqual(semToken.status, 401);
    assert.strictEqual(semToken.json.error, 'Acesso negado');
    ok('HTTP sem token → 401 Acesso negado');

    const tokenRuim = await probeApi('/api/tef/venda/66/resumo', {
      Authorization: 'Bearer token-invalido-51-43'
    });
    assert.ok([401, 403].includes(tokenRuim.status));
    ok(`HTTP token inválido → ${tokenRuim.status} (bloqueado)`);

    const inexistenteSemAuth = await probeApi('/api/tef/venda/999999991/resumo');
    assert.strictEqual(inexistenteSemAuth.status, 401);
    ok('HTTP venda inexistente sem auth → 401 (não mascara autenticação)');
  } catch (e) {
    if (!erpUp) {
      console.log('SKIP HTTP live probes (ERP :5700 indisponível):', e.message);
    } else {
      fail(`HTTP probe: ${e.message}`);
    }
  }

  console.log(`\nResultado: ${passed} ok`);
  if (process.exitCode) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
