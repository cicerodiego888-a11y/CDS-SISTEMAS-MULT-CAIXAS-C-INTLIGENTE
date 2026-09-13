#!/usr/bin/env node
/**
 * RC4.32.0 — Certificação Funcional de Release
 * Executar: node tests/e2e/release-certification/run.js
 *           npm run test:release-certification
 */
'use strict';

const path = require('path');
const { ReleaseCertificationService } = require('../../../backend/certification/ReleaseCertificationService');

const ROOT = path.join(__dirname, '../../..');

async function main() {
  const svc = new ReleaseCertificationService({ rootDir: ROOT });
  const relatorio = await svc.executar();
  process.exit(relatorio.status === 'APROVADA' ? 0 : 1);
}

main().catch((err) => {
  console.error('[RC4.32.0] ERRO FATAL:', err.message);
  process.exit(1);
});
