#!/usr/bin/env node
/**
 * RC4.31.8 — Homologação Operacional Final da Central Inteligente
 * Executar: node tests/e2e/central-homologacao/run.js
 *           npm run test:central-homologacao-rc4318
 */
'use strict';

const path = require('path');
const { CentralInteligenteHomologacaoService } = require('../../../backend/certification/CentralInteligenteHomologacaoService');

const ROOT = path.join(__dirname, '../../..');

async function main() {
  const svc = new CentralInteligenteHomologacaoService({ rootDir: ROOT });
  const relatorio = await svc.executar();
  const aprovado = relatorio.parecer === 'APROVADA' || relatorio.parecer === 'APROVADA COM RESSALVAS';
  process.exit(aprovado ? 0 : 1);
}

main().catch((err) => {
  console.error('[RC4.31.8] ERRO FATAL:', err.message);
  process.exit(1);
});
