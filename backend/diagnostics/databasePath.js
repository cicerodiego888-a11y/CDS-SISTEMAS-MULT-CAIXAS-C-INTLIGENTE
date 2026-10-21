'use strict';

const os = require('os');
const path = require('path');

function resolverDirBanco({
  env = process.env,
  execucaoEmTeste = false,
  diretorioTemporario = os.tmpdir()
} = {}) {
  const dirExplicito = env.DB_DIR && env.DB_DIR.trim();
  if (dirExplicito) return dirExplicito;

  if (env.CDS_TEST_ISOLAR_BANCO === '1' || execucaoEmTeste) {
    return path.join(diretorioTemporario, 'cds-sistemas-test-db');
  }

  return path.join(env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados');
}

function resolverCaminhoBanco(options) {
  return path.join(resolverDirBanco(options), 'mercadao.db');
}

module.exports = { resolverDirBanco, resolverCaminhoBanco };
