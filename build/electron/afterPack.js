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

  // Integridade byte-a-byte só no pipeline oficial ERP (manifesto + build:erp).
  // PDV usa o mesmo afterPack principalmente para carimbar o ícone no .exe.
  if (modulo === 'erp') {
    const manifesto = lerManifesto(root);
    const cmp = compararRepoComAsar(root, asarPath, { manifesto, modulo: 'erp' });

    if (!cmp.ok) {
      const detalhe = [
        '[RC3.16.6] BUILD ABORTADO — app.asar inconsistente com o repositório (Frontend/Backend/Electron).',
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
  } else {
    console.log('[RC3.16.6][afterPack] PDV — pulando validação de manifesto ERP');
  }

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
