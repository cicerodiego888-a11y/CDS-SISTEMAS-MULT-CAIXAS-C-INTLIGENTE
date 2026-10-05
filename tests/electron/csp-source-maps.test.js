'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('ERP CSP is restricted and does not enable unsafe-eval', () => {
  const server = read('backend/server.js');
  assert.match(server, /Content-Security-Policy/);
  assert.match(server, /script-src-attr 'unsafe-inline'/);
  assert.match(server, /style-src-attr 'unsafe-inline'/);
  assert.doesNotMatch(server, /unsafe-eval|default-src\s+\*/);
  assert.match(server, /connect-src 'self' https:\/\/viacep\.com\.br/);
});

test('vendored production assets do not reference missing source maps', () => {
  const assets = [
    ['frontend/vendor/bootstrap/css/bootstrap.min.css', 'bootstrap.min.css.map'],
    ['frontend/vendor/bootstrap/js/bootstrap.bundle.min.js', 'bootstrap.bundle.min.js.map'],
    ['frontend/vendor/chart.js/chart.min.js', 'chart.umd.min.js.map']
  ];

  for (const [relativePath, mapName] of assets) {
    assert.doesNotMatch(read(relativePath), new RegExp(`sourceMappingURL=${mapName.replaceAll('.', '\\.')}`));
    assert.equal(fs.existsSync(path.join(ROOT, 'frontend/vendor', mapName)), false);
  }
});