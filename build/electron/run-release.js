'use strict';

/**
 * RC4.32.0 — Pipeline oficial de Release
 * npm run release
 */

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const TAG = '[RC4.32.0 RELEASE]';

function run(cmd, args, opts = {}) {
  console.log(TAG, cmd, args.join(' '));
  const r = spawnSync(cmd, args, {
    cwd: root,
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', ...(opts.env || {}) }
  });
  if (r.status !== 0) {
    console.error(TAG, 'FALHA — pipeline interrompido');
    process.exit(r.status || 1);
  }
}

console.log(TAG, '=== RELEASE OFICIAL CDS ERP ===\n');

run('node', ['build/electron/limpar-cache-build.js']);
run('npm', ['run', 'test:muc-certificacao']);
run('node', ['tests/e2e/release-certification/run.js']);
run('node', ['build/electron/build-erp-oficial.js']);

console.log('\n' + TAG, '========================================');
console.log(TAG, 'STATUS DA RELEASE: APROVADA');
console.log(TAG, '========================================\n');
