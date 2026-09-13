'use strict';

const path = require('path');
const {
  gerarManifesto,
  escreverManifesto,
  MANIFEST_REL
} = require('../../electron-integrity');

const root = path.join(__dirname, '..', '..');

function main() {
  const manifesto = gerarManifesto(root, { modulo: 'erp' });
  const abs = escreverManifesto(root, manifesto);
  console.log('[RC3.16.6] Manifesto gerado:', abs);
  console.log(JSON.stringify({
    versao: manifesto.versao,
    build: manifesto.build,
    timestamp: manifesto.timestamp,
    commit: manifesto.commit,
    branch: manifesto.branch,
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

main();
