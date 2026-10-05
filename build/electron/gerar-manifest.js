'use strict';

const path = require('path');
const {
  gerarManifesto,
  escreverManifesto,
  MANIFEST_REL
} = require('../../electron-integrity');

const root = path.join(__dirname, '..', '..');

function resolverModulo(args = []) {
  const flag = args.find((arg) => String(arg).startsWith('--modulo='));
  if (!flag) throw new Error('Informe --modulo=erp ou --modulo=pdv');
  const modulo = String(flag).slice('--modulo='.length).trim().toLowerCase();
  if (modulo !== 'erp' && modulo !== 'pdv') {
    throw new Error(`Módulo inválido para manifesto: ${modulo}`);
  }
  return modulo;
}

function main(args = process.argv.slice(2)) {
  const modulo = resolverModulo(args);
  const manifesto = gerarManifesto(root, { modulo });
  const abs = escreverManifesto(root, manifesto);
  console.log(`[RC3.16.6] Manifesto ${modulo.toUpperCase()} gerado:`, abs);
  console.log(JSON.stringify({
    versao: manifesto.versao,
    build: manifesto.build,
    timestamp: manifesto.timestamp,
    commit: manifesto.commit,
    branch: manifesto.branch,
    modulo: manifesto.modulo,
    node: manifesto.node,
    electron: manifesto.electron,
    quantidadeArquivos: manifesto.quantidadeArquivos,
    quantidadeFrontend: manifesto.quantidadeFrontend,
    quantidadeBackend: manifesto.quantidadeBackend,
    quantidadeElectron: manifesto.quantidadeElectron,
    hashFrontend: manifesto.hashFrontend,
    hashBackend: manifesto.hashBackend,
    hashElectron: manifesto.hashElectron,
    hash: manifesto.hash
  }, null, 2));
}

if (require.main === module) main();

module.exports = { resolverModulo, main };
