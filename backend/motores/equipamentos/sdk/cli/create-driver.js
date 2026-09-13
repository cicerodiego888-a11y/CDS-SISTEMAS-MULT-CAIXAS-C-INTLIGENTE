#!/usr/bin/env node
/**
 * CLI — npm run driver:create
 * Uso:
 *   npm run driver:create -- --fabricante Toledo --modelo "Prix V" --categoria balanca --protocolo 90AX
 */

'use strict';

const { gerarDriver } = require('./DriverTemplateGenerator');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.fabricante || !args.modelo) {
    console.error('Uso: npm run driver:create -- --fabricante <Nome> --modelo <Modelo> [--categoria balanca] [--protocolo X] [--id slug]');
    process.exit(1);
  }

  const ports = args.ports
    ? String(args.ports).split(',').map((p) => Number(p.trim())).filter(Boolean)
    : undefined;
  const transportes = args.transportes
    ? String(args.transportes).split(',').map((t) => t.trim()).filter(Boolean)
    : undefined;

  try {
    const result = gerarDriver({
      fabricante: args.fabricante,
      modelo: args.modelo,
      categoria: args.categoria,
      protocolo: args.protocolo,
      id: args.id,
      ports,
      transportes,
      forcar: args.forcar === true || args.force === true
    });
    console.log('✓ Driver gerado:', result.id);
    console.log('  Pasta:', result.pasta);
    console.log('  Classe:', result.className);
    console.log('  Arquivos:');
    result.arquivos.forEach((f) => console.log('   -', f));
    console.log('\nPróximos passos:');
    console.log('  1. Implementar protocolo em', result.className);
    console.log('  2. npm run test:device-sdk');
    console.log('  3. POST /api/equipamentos/drivers/reload');
  } catch (err) {
    console.error('✗', err.message);
    process.exit(1);
  }
}

main();
