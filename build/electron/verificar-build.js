'use strict';

/**
 * RC3.16.6 — npm run verify-build
 * Valida Frontend + Backend + Electron + manifesto + (opcional) app.asar.
 */

const fs = require('fs');
const path = require('path');
const {
  gerarManifesto,
  escreverManifesto,
  lerManifesto,
  validarEstruturaManifesto,
  compararRepoComAsar,
  listarArquivosFrontend,
  listarArquivosBackend,
  listarArquivosElectron,
  validarIntegridadePacoteLocal,
  ARQUIVOS_OBRIGATORIOS,
  MANIFEST_REL,
  resumoManifesto
} = require('../../electron-integrity');

const root = path.join(__dirname, '..', '..');
const TAG = '[RC3.16.6]';

function resolverAsarPath() {
  const candidatos = [
    process.env.CDS_ASAR_PATH,
    path.join(root, 'dist', 'erp', 'win-unpacked', 'resources', 'app.asar')
  ].filter(Boolean);
  return candidatos.find((p) => fs.existsSync(p)) || null;
}

function main() {
  const args = process.argv.slice(2);
  const exigirAsar = args.includes('--asar') || args.includes('--require-asar');
  const regenerar = args.includes('--regen') || args.includes('--regenerar');
  const asarArg = args.find((a) => a.startsWith('--asar='));
  const asarPath = asarArg ? asarArg.slice('--asar='.length) : resolverAsarPath();

  console.log(TAG, 'verify-build iniciando...');

  const frontend = listarArquivosFrontend(root);
  const backend = listarArquivosBackend(root);
  const electron = listarArquivosElectron(root);
  console.log(TAG, `frontend: ${frontend.length} | backend: ${backend.length} | electron: ${electron.length}`);

  const ausentes = ARQUIVOS_OBRIGATORIOS.filter((rel) => !fs.existsSync(path.join(root, ...rel.split('/'))));
  if (ausentes.length) {
    console.error(TAG, 'ERRO — arquivos obrigatórios ausentes:');
    ausentes.forEach((f) => console.error(' -', f));
    process.exitCode = 1;
    console.log('ERRO');
    return;
  }

  let manifesto;
  if (regenerar) {
    manifesto = gerarManifesto(root, { modulo: 'erp' });
    escreverManifesto(root, manifesto);
    console.log(TAG, 'manifesto regenerado');
  } else {
    try {
      manifesto = lerManifesto(root);
    } catch (_) {
      manifesto = gerarManifesto(root, { modulo: 'erp' });
      escreverManifesto(root, manifesto);
      console.log(TAG, 'manifesto gerado automaticamente');
    }
  }

  const errosMan = validarEstruturaManifesto(manifesto);
  if (errosMan.length) {
    console.error(TAG, 'ERRO — manifesto inválido:');
    errosMan.forEach((e) => console.error(' -', e));
    process.exitCode = 1;
    console.log('ERRO');
    return;
  }

  const local = validarIntegridadePacoteLocal(root, { estrito: true });
  if (!local.ok) {
    console.error(TAG, 'ERRO — integridade local (repo vs manifesto):');
    local.erros.slice(0, 40).forEach((e) => console.error(' -', e));
    process.exitCode = 1;
    console.log('ERRO');
    return;
  }

  console.log(TAG, 'manifesto OK', resumoManifesto(manifesto));
  console.log(TAG, 'hashes', {
    frontend: manifesto.hashFrontend,
    backend: manifesto.hashBackend,
    electron: manifesto.hashElectron,
    global: manifesto.hash,
    arquivo: MANIFEST_REL
  });

  if (!asarPath) {
    if (exigirAsar) {
      console.error(TAG, 'ERRO — app.asar não encontrado (--require-asar)');
      process.exitCode = 1;
      console.log('ERRO');
      return;
    }
    console.log(TAG, 'asar: (não encontrado — validação de asar ignorada)');
    console.log('OK');
    return;
  }

  console.log(TAG, 'validando asar:', asarPath);
  const cmp = compararRepoComAsar(root, asarPath, { manifesto, modulo: manifesto.modulo || 'erp' });
  cmp.logs.slice(0, 60).forEach((l) => console.log(' ', l));
  if (cmp.logs.length > 60) console.log(`  ... +${cmp.logs.length - 60} logs`);

  if (!cmp.ok) {
    console.error(TAG, 'ERRO — comparação repo × asar:');
    cmp.erros.forEach((e) => console.error(' -', e));
    console.error(TAG, 'porCamada', cmp.porCamada);
    process.exitCode = 1;
    console.log('ERRO');
    return;
  }

  console.log(TAG, 'asar idêntico ao repositório', {
    quantidadeValidada: cmp.quantidadeValidada,
    porCamada: cmp.porCamada
  });
  console.log('OK');
}

main();
