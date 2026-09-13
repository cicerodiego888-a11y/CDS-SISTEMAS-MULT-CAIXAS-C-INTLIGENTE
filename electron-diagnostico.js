'use strict';

/**
 * RC3.16.6 — Diagnóstico Electron integral + gate de manifesto.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const {
  MANIFEST_REL,
  validarIntegridadePacoteLocal,
  lerManifesto,
  validarEstruturaManifesto,
  resumoManifesto
} = require('./electron-integrity');

const TAG = '[RC3.16.6][INTEGRIDADE]';

function raizApp() {
  return path.join(__dirname);
}

function rodandoDeAsar() {
  const resourcesPath = process.resourcesPath || '';
  return /\.asar/i.test(__dirname) || /\.asar/i.test(resourcesPath);
}

function coletarDiagnostico(extra = {}) {
  const root = raizApp();
  let manifesto = null;
  let manifestoErros = [];
  try {
    manifesto = lerManifesto(root);
    manifestoErros = validarEstruturaManifesto(manifesto);
  } catch (err) {
    manifestoErros = [err.message || String(err)];
  }

  const integridade = validarIntegridadePacoteLocal(root, { estrito: true });
  const agora = new Date();

  return {
    versaoErp: manifesto && manifesto.versao
      ? manifesto.versao
      : (() => {
        try {
          return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
        } catch (_) {
          return 'desconhecida';
        }
      })(),
    versaoElectron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    build: manifesto ? manifesto.build : null,
    timestamp: manifesto ? (manifesto.timestamp || manifesto.build) : null,
    commit: manifesto ? manifesto.commit : null,
    branch: manifesto ? manifesto.branch : null,
    hash: manifesto ? manifesto.hash : null,
    hashFrontend: manifesto ? manifesto.hashFrontend : null,
    hashBackend: manifesto ? manifesto.hashBackend : null,
    hashElectron: manifesto ? manifesto.hashElectron : null,
    hashRecursos: manifesto ? manifesto.hashRecursos : null,
    quantidadeFrontend: manifesto ? manifesto.quantidadeFrontend : null,
    quantidadeBackend: manifesto ? manifesto.quantidadeBackend : null,
    quantidadeElectron: manifesto ? manifesto.quantidadeElectron : null,
    manifesto: resumoManifesto(manifesto),
    manifestoArquivo: MANIFEST_REL,
    manifestoErros,
    status: integridade.ok && !manifestoErros.length ? 'OK' : 'ERRO',
    quantidadeArquivos: integridade.quantidadeArquivos,
    integridade: !!(integridade.ok && !manifestoErros.length),
    origemCarregada: root,
    rodandoDeAsar: rodandoDeAsar(),
    resourcesPath: process.resourcesPath || null,
    url: extra.url || null,
    errosIntegridade: integridade.erros || [],
    sistemaOperacional: `${os.type()} ${os.release()}`,
    arquitetura: os.arch(),
    hostname: os.hostname(),
    data: agora.toISOString().slice(0, 10),
    hora: agora.toISOString().slice(11, 19) + 'Z'
  };
}

function formatarDiagnosticoTexto(diag) {
  const linhas = [
    'CDS ERP — Diagnóstico Electron (RC3.16.6)',
    `Data: ${diag.data}`,
    `Hora: ${diag.hora}`,
    `SO: ${diag.sistemaOperacional}`,
    `Arquitetura: ${diag.arquitetura}`,
    `Hostname: ${diag.hostname}`,
    '',
    `Versão ERP: ${diag.versaoErp}`,
    `Versão Electron: ${diag.versaoElectron}`,
    `Chromium: ${diag.chromium}`,
    `Node: ${diag.node}`,
    `Build: ${diag.build}`,
    `Timestamp: ${diag.timestamp}`,
    `Commit: ${diag.commit}`,
    `Branch: ${diag.branch}`,
    `Manifesto: ${diag.manifestoArquivo}`,
    `Status: ${diag.status}`,
    `Integridade: ${diag.integridade ? 'OK' : 'FALHA'}`,
    `Arquivos: ${diag.quantidadeArquivos}`,
    `Frontend qtd: ${diag.quantidadeFrontend}`,
    `Backend qtd: ${diag.quantidadeBackend}`,
    `Electron qtd: ${diag.quantidadeElectron}`,
    `Hash Frontend: ${diag.hashFrontend}`,
    `Hash Backend: ${diag.hashBackend}`,
    `Hash Electron: ${diag.hashElectron}`,
    `Hash Global: ${diag.hash}`,
    `Origem: ${diag.origemCarregada}`,
    `URL: ${diag.url || '-'}`,
    `Asar: ${diag.rodandoDeAsar ? 'sim' : 'não'}`
  ];
  const erros = [...(diag.manifestoErros || []), ...(diag.errosIntegridade || [])];
  if (erros.length) {
    linhas.push('', 'Erros:');
    erros.slice(0, 30).forEach((e) => linhas.push(` - ${e}`));
  }
  return linhas.join('\n');
}

function garantirIntegridadeOuAbortar() {
  const diag = coletarDiagnostico();
  console.log(TAG, 'diagnostico', JSON.stringify({
    status: diag.status,
    versaoErp: diag.versaoErp,
    build: diag.build,
    commit: diag.commit,
    branch: diag.branch,
    hash: diag.hash,
    hashFrontend: diag.hashFrontend,
    hashBackend: diag.hashBackend,
    hashElectron: diag.hashElectron,
    quantidadeArquivos: diag.quantidadeArquivos,
    rodandoDeAsar: diag.rodandoDeAsar,
    erros: [...diag.manifestoErros, ...diag.errosIntegridade].slice(0, 20)
  }, null, 2));

  if (diag.integridade) {
    return { ok: true, diagnostico: diag };
  }

  const mensagem = [
    'O pacote Electron está inconsistente.',
    'Reinstale a versão oficial.',
    '',
    `Status: ${diag.status}`,
    `Versão: ${diag.versaoErp || '-'}`,
    `Build: ${diag.build || '-'}`,
    `Commit: ${diag.commit || '-'}`,
    `Hash Global: ${diag.hash || '-'}`,
    `Hash Frontend: ${diag.hashFrontend || '-'}`,
    `Hash Backend: ${diag.hashBackend || '-'}`,
    `Hash Electron: ${diag.hashElectron || '-'}`,
    '',
    ...[...diag.manifestoErros, ...diag.errosIntegridade].slice(0, 12)
  ].join('\n');

  if (rodandoDeAsar()) {
    dialog.showErrorBox('Pacote Electron inconsistente', mensagem);
    return { ok: false, diagnostico: diag, mensagem };
  }

  console.warn(TAG, 'desenvolvimento: manifesto inconsistente (não aborta)', mensagem);
  return { ok: true, diagnostico: diag, aviso: mensagem };
}

function htmlDiagnostico(diag) {
  const texto = formatarDiagnosticoTexto(diag).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  const rows = [
    ['Versão ERP', diag.versaoErp],
    ['Versão Electron', diag.versaoElectron],
    ['Chromium', diag.chromium],
    ['Node', diag.node],
    ['Build', diag.build],
    ['Timestamp', diag.timestamp],
    ['Commit', diag.commit],
    ['Branch', diag.branch],
    ['Manifesto', diag.manifestoArquivo],
    ['Status', diag.status],
    ['Integridade', diag.integridade ? 'OK' : 'FALHA'],
    ['Qtd. arquivos', diag.quantidadeArquivos],
    ['Qtd. Frontend', diag.quantidadeFrontend],
    ['Qtd. Backend', diag.quantidadeBackend],
    ['Qtd. Electron', diag.quantidadeElectron],
    ['Hash Frontend', diag.hashFrontend],
    ['Hash Backend', diag.hashBackend],
    ['Hash Electron', diag.hashElectron],
    ['Hash Global', diag.hash],
    ['SO', diag.sistemaOperacional],
    ['Arquitetura', diag.arquitetura],
    ['Origem carregada', diag.origemCarregada],
    ['URL', diag.url || '-'],
    ['Rodando de asar', diag.rodandoDeAsar ? 'sim' : 'não']
  ];

  const tr = rows.map(([k, v]) => (
    `<tr><th>${k}</th><td><code>${String(v == null ? '-' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</code></td></tr>`
  )).join('');

  const erros = [...(diag.manifestoErros || []), ...(diag.errosIntegridade || [])];
  const errosHtml = erros.length
    ? `<h3>Erros</h3><ul>${erros.slice(0, 40).map((e) => `<li>${String(e)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</li>`).join('')}</ul>`
    : '<p>Nenhum erro de integridade.</p>';

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Diagnóstico Electron — CDS ERP</title>
<style>
  body{font-family:Segoe UI,sans-serif;margin:24px;background:#0f172a;color:#e2e8f0}
  h1{font-size:20px;margin:0 0 16px}
  table{border-collapse:collapse;width:100%;margin-bottom:16px}
  th,td{border-bottom:1px solid #334155;padding:8px 10px;text-align:left;vertical-align:top}
  th{width:220px;color:#94a3b8;font-weight:600}
  code{font-size:12px;word-break:break-all}
  .ok{color:#4ade80}.erro{color:#f87171}
  .acoes{display:flex;gap:10px;margin-top:12px}
  button{background:#2563eb;color:#fff;border:0;padding:10px 16px;border-radius:8px;cursor:pointer}
  button.sec{background:#334155}
  #msg{margin-left:8px;color:#4ade80;font-size:13px}
</style></head><body>
<h1>Diagnóstico Electron <span class="${diag.integridade ? 'ok' : 'erro'}">(${diag.status})</span></h1>
<table>${tr}</table>
${errosHtml}
<div class="acoes">
  <button id="btn-copiar" type="button">Copiar Diagnóstico</button>
  <button class="sec" type="button" onclick="window.close()">Fechar</button>
  <span id="msg"></span>
</div>
<script>
  const TEXTO = \`${texto}\`;
  document.getElementById('btn-copiar').addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(TEXTO);
      } else {
        const ta = document.createElement('textarea');
        ta.value = TEXTO;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      document.getElementById('msg').textContent = 'Copiado.';
    } catch (e) {
      document.getElementById('msg').textContent = 'Falha ao copiar.';
    }
  });
</script>
</body></html>`;
}

function abrirJanelaDiagnostico(extra = {}) {
  const diag = coletarDiagnostico(extra);
  const win = new BrowserWindow({
    width: 900,
    height: 780,
    title: 'Diagnóstico Electron — CDS ERP',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlDiagnostico(diag))}`);
  return diag;
}

function registrarHandlersDiagnostico() {
  ipcMain.removeHandler('electron-diagnostico');
  ipcMain.handle('electron-diagnostico', async (_event, extra = {}) => coletarDiagnostico(extra || {}));

  ipcMain.removeHandler('electron-diagnostico-abrir');
  ipcMain.handle('electron-diagnostico-abrir', async (_event, extra = {}) => {
    const diag = abrirJanelaDiagnostico(extra || {});
    return { ok: true, status: diag.status };
  });

  ipcMain.removeHandler('electron-diagnostico-copiar');
  ipcMain.handle('electron-diagnostico-copiar', async (_event, extra = {}) => {
    const diag = coletarDiagnostico(extra || {});
    const texto = formatarDiagnosticoTexto(diag);
    clipboard.writeText(texto);
    return { ok: true, bytes: Buffer.byteLength(texto, 'utf8') };
  });
}

module.exports = {
  coletarDiagnostico,
  formatarDiagnosticoTexto,
  garantirIntegridadeOuAbortar,
  abrirJanelaDiagnostico,
  registrarHandlersDiagnostico,
  rodandoDeAsar
};
