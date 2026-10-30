'use strict';

/**
 * electron-builder afterPack — aborta se app.asar ≠ repositório/manifesto (ERP)
 * e aplica icon.ico no .exe (ERP + PDV) quando signAndEditExecutable=false.
 */

const fs = require('fs');
const path = require('path');
const { compararRepoComAsar, lerManifesto } = require('../../electron-integrity');
const { aplicarIconeExeWindows } = require('./aplicar-icone-windows');

function detectarModulo(context) {
  const main = context.packager?.config?.extraMetadata?.main
    || context.packager?.appInfo?.metadata?.main
    || '';
  const appId = context.packager?.config?.appId || '';
  if (String(main).toLowerCase().includes('pdv') || String(appId).toLowerCase().includes('.pdv')) {
    return 'pdv';
  }
  return 'erp';
}

exports.default = async function afterPack(context) {
  const root = path.join(__dirname, '..', '..');
  const asarPath = path.join(context.appOutDir, 'resources', 'app.asar');
  const modulo = detectarModulo(context);

  console.log('[RC3.16.6][afterPack] modulo=', modulo, 'validando', asarPath);

  if (!fs.existsSync(asarPath)) {
    throw new Error(`[RC3.16.6] afterPack: app.asar não gerado em ${asarPath}`);
  }

  const manifesto = lerManifesto(root);
  if (manifesto.modulo !== modulo) {
    throw new Error(`[RC3.16.6] afterPack: manifesto ${manifesto.modulo} não corresponde ao módulo ${modulo}`);
  }

  const cmp = compararRepoComAsar(root, asarPath, { manifesto, modulo });
  if (!cmp.ok) {
    const detalhe = [
      `[RC3.16.6] BUILD ABORTADO — app.asar ${modulo} inconsistente com o repositório.`,
      ...cmp.erros.map((e) => ` - ${e}`),
      cmp.porCamada ? `Camadas: ${JSON.stringify(cmp.porCamada)}` : '',
      cmp.ausentesNoAsar.length ? `Ausentes: ${cmp.ausentesNoAsar.slice(0, 15).join(', ')}` : '',
      cmp.divergencias.length
        ? `Hashes: ${cmp.divergencias.slice(0, 10).map((d) => `${d.camada}:${d.arquivo}`).join(', ')}`
        : ''
    ].filter(Boolean).join('\n');

    try {
      fs.rmSync(asarPath, { force: true });
    } catch (_) {
      /* ignore */
    }

    throw new Error(detalhe);
  }

  console.log('[RC3.16.6][afterPack] OK —', cmp.quantidadeValidada, 'arquivo(s)', cmp.porCamada);

  // TEF-16: garante DLLs Destaxa no app.asar.unpacked (koffi exige path real fora do asar).
  const destaxaUnpacked = path.join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'resources',
    'tef',
    'destaxa'
  );
  const destaxaBinarios = require('../../backend/services/tef/destaxa/destaxaBinarios');
  const crypto = require('crypto');
  for (const [pastaArch, meta] of Object.entries(destaxaBinarios.arquivos)) {
    const dllPath = path.join(destaxaUnpacked, pastaArch, meta.nome);
    if (!fs.existsSync(dllPath)) {
      throw new Error(
        `[TEF-16] afterPack: DLL Destaxa ausente no unpacked (${modulo}): ${dllPath}`
      );
    }
    const buf = fs.readFileSync(dllPath);
    if (buf.length !== meta.tamanho) {
      throw new Error(
        `[TEF-16] afterPack: tamanho divergente ${pastaArch}: ${buf.length} ≠ ${meta.tamanho}`
      );
    }
    const sha = crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
    if (sha !== meta.sha256) {
      throw new Error(
        `[TEF-16] afterPack: SHA-256 divergente ${pastaArch}: ${sha}`
      );
    }
  }
  console.log('[TEF-16][afterPack] DLLs Destaxa OK em', destaxaUnpacked);

  if (context.electronPlatformName === 'win32') {
    const productFilename = context.packager?.appInfo?.productFilename
      || context.packager?.config?.productName
      || (modulo === 'pdv' ? 'CDS PDV' : 'CDS ERP');
    try {
      await aplicarIconeExeWindows(context.appOutDir, productFilename, root);
    } catch (iconeErr) {
      console.warn('[RC3.16.6][afterPack] aviso ícone exe:', iconeErr.message);
    }
  }
};
