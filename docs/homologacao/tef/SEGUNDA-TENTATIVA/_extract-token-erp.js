'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const roots = [
  path.join(process.env.APPDATA || '', 'cds-sistemas-erp', 'Local Storage', 'leveldb'),
  path.join(process.env.APPDATA || '', 'cds-sistemas-pdv', 'Local Storage', 'leveldb')
].filter((d) => fs.existsSync(d));

function collect(root) {
  const found = [];
  for (const f of fs.readdirSync(root)) {
    if (!/\.(log|ldb)$/i.test(f)) continue;
    const cleaned = fs.readFileSync(path.join(root, f)).toString('latin1').replace(/\u0000/g, '');
    const re = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
    let m;
    while ((m = re.exec(cleaned))) found.push({ jwt: m[0], source: `${path.basename(path.dirname(root))}/${f}` });
  }
  return found;
}

function decode(jwt) {
  try {
    const payload = jwt.split('.')[1];
    const pad = '='.repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function probe(token) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1', port: 3001, path: '/api/f12/info', method: 'GET',
      headers: { Authorization: `Bearer ${token}` }, timeout: 8000
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 180) }));
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.end();
  });
}

(async () => {
  const all = [];
  for (const r of roots) all.push(...collect(r));
  const seen = new Set();
  const unique = [];
  for (const item of all) {
    if (seen.has(item.jwt)) continue;
    seen.add(item.jwt);
    const p = decode(item.jwt);
    unique.push({
      ...item,
      username: p && (p.username || p.user || p.nome),
      perfil: p && (p.perfil || p.role),
      exp: p && p.exp,
      expired: p && p.exp ? p.exp * 1000 < Date.now() : null
    });
  }
  unique.sort((a, b) => (b.exp || 0) - (a.exp || 0));

  let chosen = null;
  for (const cand of unique.slice(0, 12)) {
    if (cand.expired) continue;
    const pr = await probe(cand.jwt);
    cand.probe = pr.status;
    if (pr.status === 200) {
      chosen = cand;
      break;
    }
  }

  const outDir = __dirname;
  if (!chosen) {
    console.log(JSON.stringify({ ok: false, candidates: unique.slice(0, 8) }, null, 2));
    process.exit(3);
  }
  fs.writeFileSync(path.join(outDir, '.pdv-session-token.tmp'), chosen.jwt);
  console.log(JSON.stringify({
    ok: true,
    username: chosen.username,
    perfil: chosen.perfil,
    exp: chosen.exp,
    source: chosen.source,
    probe: chosen.probe,
    tokenLen: chosen.jwt.length
  }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
