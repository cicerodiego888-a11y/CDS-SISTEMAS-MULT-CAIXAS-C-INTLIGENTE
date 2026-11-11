'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const roots = [
  path.join(process.env.APPDATA || '', 'cds-sistemas-pdv', 'Local Storage', 'leveldb'),
  path.join(process.env.APPDATA || '', 'cds-sistemas-pdv', 'Session Storage')
].filter((d) => fs.existsSync(d));

function collectCandidates(root) {
  const found = [];
  for (const f of fs.readdirSync(root)) {
    if (!/\.(log|ldb)$/i.test(f)) continue;
    const buf = fs.readFileSync(path.join(root, f));
    // Remove NULs that Chromium LevelDB inserts between chars in some encodings
    const cleaned = buf.toString('latin1').replace(/\u0000/g, '');
    const re = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
    let m;
    while ((m = re.exec(cleaned))) {
      const jwt = m[0];
      if (jwt.split('.').length !== 3) continue;
      found.push({
        jwt,
        source: `${path.basename(root)}/${f}`,
        len: jwt.length
      });
    }
  }
  return found;
}

function probe(token, pathname) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: pathname,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 220) }));
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.end();
  });
}

function decodePayload(jwt) {
  try {
    const payload = jwt.split('.')[1];
    const pad = '='.repeat((4 - (payload.length % 4)) % 4);
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

(async () => {
  const all = [];
  for (const root of roots) all.push(...collectCandidates(root));
  const unique = [];
  const seen = new Set();
  for (const item of all) {
    if (seen.has(item.jwt)) continue;
    seen.add(item.jwt);
    const payload = decodePayload(item.jwt);
    unique.push({
      ...item,
      exp: payload?.exp || null,
      iat: payload?.iat || null,
      expired: payload?.exp ? (payload.exp * 1000) < Date.now() : null,
      user: payload?.username || payload?.user || payload?.nome || null,
      perfil: payload?.perfil || payload?.role || null
    });
  }

  unique.sort((a, b) => (b.exp || 0) - (a.exp || 0));

  const trials = [];
  let chosen = null;
  for (const item of unique.slice(0, 12)) {
    const a = await probe(item.jwt, '/api/tef/fluxo-pdv');
    trials.push({
      source: item.source,
      len: item.len,
      exp: item.exp,
      expired: item.expired,
      user: item.user,
      perfil: item.perfil,
      fluxo: a.status,
      fluxoBody: a.body
    });
    if (a.status === 200) {
      chosen = item;
      break;
    }
  }

  if (!chosen) {
    console.log(JSON.stringify({ ok: false, uniqueCount: unique.length, trials }, null, 2));
    process.exit(2);
  }

  const outPath = path.join(__dirname, '.pdv-session-token.tmp');
  fs.writeFileSync(outPath, chosen.jwt, { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({
    ok: true,
    source: chosen.source,
    jwtLen: chosen.len,
    exp: chosen.exp,
    expired: chosen.expired,
    user: chosen.user,
    perfil: chosen.perfil,
    outPath,
    trials
  }, null, 2));
})().catch((e) => {
  console.error(JSON.stringify({ ok: false, erro: e.message }));
  process.exit(1);
});
