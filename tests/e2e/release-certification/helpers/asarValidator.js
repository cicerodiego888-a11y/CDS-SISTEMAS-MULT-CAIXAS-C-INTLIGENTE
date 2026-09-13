/**
 * RC4.32.0 — Validação do pacote instalado / app.asar
 */
'use strict';

const fs = require('fs');
const path = require('path');

function validarPacoteInstalado(rootDir) {
  const integrity = require(path.join(rootDir, 'electron-integrity'));
  const asarPath = integrity.resolverAsarPathErp(rootDir);
  const exePath = path.join(rootDir, 'dist', 'erp', 'win-unpacked', 'CDS ERP.exe');
  const setupGlob = fs.existsSync(path.join(rootDir, 'dist', 'erp'))
    ? fs.readdirSync(path.join(rootDir, 'dist', 'erp')).filter((f) => /Setup.*\.exe$/i.test(f))
    : [];

  if (!asarPath) {
    return {
      ok: false,
      origem: 'fonte',
      asarPath: null,
      exePath: fs.existsSync(exePath) ? exePath : null,
      setup: setupGlob,
      detalhe: 'app.asar não encontrado — certificação funcional via código-fonte homologado'
    };
  }

  let buildManifest = null;
  try { buildManifest = integrity.lerManifestoBuild(rootDir); } catch (_) { /* ignore */ }

  const cert = integrity.certificarIntegridadeErp(rootDir, { asarPath });
  return {
    ok: cert.ok,
    origem: cert.ok ? 'instalador' : 'instalador-desatualizado',
    asarPath,
    exePath: fs.existsSync(exePath) ? exePath : null,
    setup: setupGlob,
    hashAppAsar: buildManifest?.hashAppAsar || integrity.hashAsarCompleto(asarPath),
    buildManifest,
    cert,
    detalhe: cert.ok ? 'app.asar idêntico ao repositório' : `${cert.cmp.divergencias?.length || 0} divergência(s)`
  };
}

module.exports = { validarPacoteInstalado };
