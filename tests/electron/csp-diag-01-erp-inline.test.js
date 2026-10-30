'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function extractScriptSrcHashes(csp) {
  const match = csp.match(/script-src\s+([^;]+)/i);
  if (!match) return [];
  return [...match[1].matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]);
}

function extractInlineScripts(html) {
  const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    out.push({ attrs: (m[1] || '').trim(), body: m[2] });
  }
  return out;
}

test('CSP-DIAG-01: ERP index não introduz inline fora dos hashes CSP', () => {
  const server = read('backend/server.js');
  const html = read('frontend/erp/index.html');
  const hashes = extractScriptSrcHashes(server);
  assert.ok(hashes.length >= 1, 'CSP deve listar ao menos um hash script-src');

  const inlines = extractInlineScripts(html);
  for (const s of inlines) {
    const digest = crypto.createHash('sha256').update(s.body, 'utf8').digest('base64');
    assert.ok(
      hashes.includes(digest),
      `Inline sem hash CSP: sha256-${digest} preview=${JSON.stringify(s.body.slice(0, 80))}`
    );
  }

  assert.doesNotMatch(html, /CDS_BOOT_ID\s*=\s*String\(Date\.now\(\)\)/);
  assert.match(html, /src="\/erp\/js\/cds-boot\.js"/);
  assert.equal(fs.existsSync(path.join(ROOT, 'frontend/erp/js/cds-boot.js')), true);
});

test('CSP-DIAG-01: política permanece sem unsafe-inline em script-src e sem unsafe-eval', () => {
  const server = read('backend/server.js');
  const cspMatch = server.match(/ERP_CONTENT_SECURITY_POLICY\s*=\s*\[([\s\S]*?)\]\.join/);
  assert.ok(cspMatch, 'ERP_CONTENT_SECURITY_POLICY deve existir');
  const block = cspMatch[1];
  const scriptSrcLine = block.match(/"script-src\s+([^"]+)"/);
  assert.ok(scriptSrcLine, 'diretiva script-src deve existir');
  assert.match(scriptSrcLine[1], /'self'/);
  assert.doesNotMatch(scriptSrcLine[1], /unsafe-inline/);
  assert.doesNotMatch(scriptSrcLine[1], /unsafe-eval/);
  assert.match(block, /script-src-attr 'unsafe-inline'/);
  assert.doesNotMatch(block, /unsafe-eval/);
});
