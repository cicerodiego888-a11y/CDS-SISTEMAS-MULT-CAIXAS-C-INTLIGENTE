/**
 * RC3.5.0 — Portal Nacional da NF-e (Electron).
 *
 * BrowserWindow filha + session isolada + will-download
 * para C:\ProgramData\MercantilFiscal\PortalNFe\Downloads\
 *
 * Não abre navegador externo. Não lê certificado/PIN.
 *
 * @module electron-portal-nfe
 */

'use strict';

const { BrowserWindow, session, clipboard, app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PARTITION = 'persist:cds-portal-nfe';

/** Portal Nacional — consulta completa (usuário faz login/certificado no Portal). */
const PORTAL_NFE_URL =
  process.env.CDS_PORTAL_NFE_URL
  || 'https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=completa&tipoConteudo=XbSeqxE8pl8=';

function obterDirDownloads() {
  const base = process.env.PROGRAMDATA || 'C:\\ProgramData';
  return path.join(base, 'MercantilFiscal', 'PortalNFe', 'Downloads');
}

/** RC3.6.H — feature flag de exposição da recuperação pelo Portal. */
function recuperacaoPortalNacionalHabilitada() {
  const raw = process.env.RECUPERACAO_PORTAL_NACIONAL;
  if (raw == null || String(raw).trim() === '') {
    return false;
  }
  const norm = String(raw).trim().toLowerCase();
  return norm === 'true' || norm === '1' || norm === 'yes' || norm === 'on';
}

function garantirPastaDownloads() {
  const dir = obterDirDownloads();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** @type {BrowserWindow|null} */
let portalWindow = null;

/** @type {{ documentoId: number|null, chave: string|null, parentWebContents: Electron.WebContents|null, metodoChave: string|null }} */
let sessaoAtiva = {
  documentoId: null,
  chave: null,
  parentWebContents: null,
  metodoChave: null
};

function logPortal(evento, extra = {}) {
  console.log('[PortalNFe]', evento, extra);
}

/** Domínios permitidos na janela do Portal (nunca abrir navegador externo). */
const DOMINIOS_PORTAL_PERMITIDOS = [
  'nfe.fazenda.gov.br',
  'www.nfe.fazenda.gov.br',
  'fazenda.gov.br',
  'www.gov.br'
];

function urlPermitidaPortalNfe(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return DOMINIOS_PORTAL_PERMITIDOS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

/**
 * Script injetado na página do Portal para preencher a chave de acesso.
 * @param {string} chave
 * @returns {string}
 */
function montarScriptPreencherChave(chave) {
  const chaveJson = JSON.stringify(chave);
  return `(function(){
    var chave = ${chaveJson};
    if (!chave || chave.length !== 44) return { preenchida: false, motivo: 'chave_invalida' };
    var seletores = [
      'input#txtChaveAcesso',
      'input[name*="Chave" i]',
      'input[id*="Chave" i]',
      'input[name*="chave" i]',
      'input[id*="chave" i]',
      'input[maxlength="44"]',
      'input[maxlength="54"]'
    ];
    for (var s = 0; s < seletores.length; s++) {
      try {
        var lista = document.querySelectorAll(seletores[s]);
        for (var i = 0; i < lista.length; i++) {
          var el = lista[i];
          if (!el || el.type === 'hidden' || el.disabled) continue;
          var max = el.maxLength;
          if (max > 0 && max < 44) continue;
          el.focus();
          el.value = chave;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { preenchida: true, seletor: seletores[s] };
        }
      } catch (e) { /* ignore selector inválido em browsers antigos */ }
    }
    var textos = document.querySelectorAll('input[type="text"], input:not([type])');
    for (var j = 0; j < textos.length; j++) {
      var inp = textos[j];
      if (!inp || inp.type === 'hidden' || inp.disabled) continue;
      var ml = inp.maxLength;
      if (ml > 0 && ml < 44) continue;
      var label = (inp.id || inp.name || inp.placeholder || '').toLowerCase();
      if (label.indexOf('chave') >= 0 || ml === 44 || ml === 54 || ml === 0) {
        inp.focus();
        inp.value = chave;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return { preenchida: true, seletor: 'heuristica' };
      }
    }
    return { preenchida: false, motivo: 'campo_nao_encontrado' };
  })();`;
}

/**
 * Tenta preencher a chave no formulário do Portal Nacional.
 * @param {Electron.WebContents} webContents
 * @param {string} chave
 * @returns {Promise<{ preenchida: boolean, metodoChave: string, motivo?: string }>}
 */
async function preencherChaveNoPortal(webContents, chave) {
  if (!webContents || webContents.isDestroyed()) {
    return { preenchida: false, metodoChave: 'clipboard', motivo: 'webcontents_invalido' };
  }
  if (!chave || chave.length !== 44) {
    return { preenchida: false, metodoChave: 'clipboard', motivo: 'chave_invalida' };
  }
  try {
    const resultado = await webContents.executeJavaScript(
      montarScriptPreencherChave(chave),
      true
    );
    if (resultado?.preenchida) {
      return { preenchida: true, metodoChave: 'preenchida', seletor: resultado.seletor };
    }
    try {
      clipboard.writeText(chave);
    } catch { /* ignore */ }
    return {
      preenchida: false,
      metodoChave: 'clipboard',
      motivo: resultado?.motivo || 'campo_nao_encontrado'
    };
  } catch (error) {
    try {
      clipboard.writeText(chave);
    } catch { /* ignore */ }
    return { preenchida: false, metodoChave: 'clipboard', motivo: error.message };
  }
}

function configurarNavegacaoPortal(win) {
  if (!win || win.isDestroyed()) return;

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (urlPermitidaPortalNfe(url)) {
      win.webContents.loadURL(url);
    } else {
      logPortal('LINK_EXTERNO_BLOQUEADO', { url });
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!urlPermitidaPortalNfe(url)) {
      event.preventDefault();
      logPortal('NAVEGACAO_EXTERNA_BLOQUEADA', { url });
    }
  });
}

/**
 * Status da sessão ativa do Portal Nacional.
 * @returns {Object}
 */
function obterStatusPortal() {
  const aberto = Boolean(portalWindow && !portalWindow.isDestroyed());
  return {
    aberto,
    documentoId: sessaoAtiva.documentoId,
    chave: sessaoAtiva.chave,
    metodoChave: sessaoAtiva.metodoChave,
    downloadDir: obterDirDownloads(),
    url: PORTAL_NFE_URL,
    partition: PARTITION
  };
}

function emitirParaRenderer(canal, payload) {
  try {
    const wc = sessaoAtiva.parentWebContents;
    if (wc && !wc.isDestroyed()) {
      wc.send(canal, payload);
    }
  } catch (error) {
    logPortal('emit_erro', { erro: error.message });
  }
}

function fecharPortalWindow() {
  if (portalWindow && !portalWindow.isDestroyed()) {
    try {
      portalWindow.close();
    } catch { /* ignore */ }
  }
  portalWindow = null;
}

/**
 * Valida se o ambiente Electron permite janela filha (pré-check).
 * CSP/X-Frame do Portal só são verificáveis em runtime ao carregar.
 * @returns {{ ok: boolean, modo: string, url: string, downloadDir: string, mensagens: string[] }}
 */
function validarCompatibilidade() {
  const mensagens = [];
  const downloadDir = garantirPastaDownloads();
  mensagens.push('Pasta de download garantida: ' + downloadDir);
  mensagens.push('Partition isolada: ' + PARTITION);
  mensagens.push('will-download será registrado na session da partition');
  mensagens.push('CSP/X-Frame/certificado: validados ao abrir o Portal (runtime)');
  return {
    ok: true,
    modo: 'BrowserWindow',
    url: PORTAL_NFE_URL,
    downloadDir,
    partition: PARTITION,
    mensagens
  };
}

/**
 * Configura will-download na session isolada.
 * @param {Electron.Session} ses
 */
function configurarWillDownload(ses) {
  // remove listeners anteriores da session (idempotente por reattach)
  ses.removeAllListeners('will-download');

  ses.on('will-download', (event, item) => {
    const dir = garantirPastaDownloads();
    const nomeOriginal = item.getFilename() || `nfe-${Date.now()}.xml`;
    const seguro = String(nomeOriginal).replace(/[^\w.\-()+\s]/g, '_');
    const destino = path.join(dir, `${Date.now()}_${seguro}`);

    emitirParaRenderer('portal-nfe-evento', {
      tipo: 'DOWNLOAD_INICIADO',
      nomeArquivo: nomeOriginal,
      documentoId: sessaoAtiva.documentoId,
      chave: sessaoAtiva.chave
    });
    logPortal('DOWNLOAD_INICIADO', { destino, nomeOriginal });

    item.setSavePath(destino);

    item.on('updated', (_e, state) => {
      if (state === 'interrupted') {
        emitirParaRenderer('portal-nfe-evento', {
          tipo: 'DOWNLOAD_ERRO',
          mensagem: 'Download interrompido',
          documentoId: sessaoAtiva.documentoId
        });
      }
    });

    item.once('done', (_e, state) => {
      if (state === 'cancelled') {
        emitirParaRenderer('portal-nfe-evento', {
          tipo: 'DOWNLOAD_CANCELADO',
          documentoId: sessaoAtiva.documentoId
        });
        logPortal('DOWNLOAD_CANCELADO');
        return;
      }
      if (state !== 'completed') {
        emitirParaRenderer('portal-nfe-evento', {
          tipo: 'DOWNLOAD_ERRO',
          mensagem: `Estado final: ${state}`,
          documentoId: sessaoAtiva.documentoId
        });
        logPortal('DOWNLOAD_ERRO', { state });
        return;
      }

      try {
        const st = fs.statSync(destino);
        if (!st.size || st.size < 64) {
          emitirParaRenderer('portal-nfe-evento', {
            tipo: 'DOWNLOAD_ERRO',
            mensagem: 'Arquivo vazio ou inválido',
            documentoId: sessaoAtiva.documentoId
          });
          return;
        }

        const xml = fs.readFileSync(destino, 'utf8');
        const hash = crypto.createHash('sha256').update(xml, 'utf8').digest('hex');

        emitirParaRenderer('portal-nfe-evento', {
          tipo: 'DOWNLOAD_CONCLUIDO',
          documentoId: sessaoAtiva.documentoId,
          chave: sessaoAtiva.chave,
          nomeArquivo: path.basename(destino),
          caminho: destino,
          tamanho: st.size,
          hash,
          xml
        });
        logPortal('DOWNLOAD_CONCLUIDO', { destino, tamanho: st.size, hash: hash.slice(0, 12) });
      } catch (error) {
        emitirParaRenderer('portal-nfe-evento', {
          tipo: 'DOWNLOAD_ERRO',
          mensagem: error.message || 'Falha ao ler XML baixado',
          documentoId: sessaoAtiva.documentoId
        });
        logPortal('DOWNLOAD_ERRO', { erro: error.message });
      }
    });
  });
}

/**
 * Abre Portal Nacional em BrowserWindow filha (modal relativo à main).
 * @param {Object} opcoes
 * @param {Electron.BrowserWindow|null} opcoes.parent
 * @param {Electron.WebContents} opcoes.parentWebContents
 * @param {number|null} opcoes.documentoId
 * @param {string|null} opcoes.chave
 * @returns {Promise<Object>}
 */
async function abrirPortal(opcoes = {}) {
  const parent = opcoes.parent || null;
  const chave = opcoes.chave ? String(opcoes.chave).replace(/\D/g, '') : null;
  const documentoId = opcoes.documentoId != null ? Number(opcoes.documentoId) : null;

  sessaoAtiva = {
    documentoId,
    chave,
    parentWebContents: opcoes.parentWebContents || (parent ? parent.webContents : null),
    metodoChave: null
  };

  garantirPastaDownloads();

  if (portalWindow && !portalWindow.isDestroyed()) {
    portalWindow.focus();
    let metodoChave = null;
    if (chave && chave.length === 44) {
      const preenchimento = await preencherChaveNoPortal(portalWindow.webContents, chave);
      metodoChave = preenchimento.metodoChave;
      sessaoAtiva.metodoChave = metodoChave;
      emitirParaRenderer('portal-nfe-evento', {
        tipo: metodoChave === 'preenchida' ? 'CHAVE_ENVIADA' : 'CHAVE_COPIADA_AUTOMATICAMENTE',
        documentoId,
        chave,
        metodoChave
      });
    }
    emitirParaRenderer('portal-nfe-evento', {
      tipo: 'PORTAL_ABERTO',
      documentoId,
      chave,
      reutilizado: true,
      metodoChave
    });
    return {
      sucesso: true,
      reutilizado: true,
      downloadDir: obterDirDownloads(),
      url: PORTAL_NFE_URL,
      chavePreenchida: metodoChave === 'preenchida',
      chaveCopiada: metodoChave === 'clipboard',
      metodoChave
    };
  }

  const ses = session.fromPartition(PARTITION, { cache: true });
  configurarWillDownload(ses);

  portalWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 560,
    parent: parent || undefined,
    modal: Boolean(parent),
    show: false,
    title: 'Portal Nacional da NF-e — Recuperação Oficial de XML',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Sem preload do ERP — isolamento total do Portal
      partition: PARTITION
    }
  });

  // Garante will-download na session efetiva da janela
  configurarWillDownload(portalWindow.webContents.session);

  portalWindow.setMenuBarVisibility(false);
  configurarNavegacaoPortal(portalWindow);

  portalWindow.once('ready-to-show', () => {
    if (portalWindow && !portalWindow.isDestroyed()) {
      portalWindow.show();
    }
  });

  portalWindow.on('closed', () => {
    portalWindow = null;
    emitirParaRenderer('portal-nfe-evento', {
      tipo: 'PORTAL_FECHADO',
      documentoId: sessaoAtiva.documentoId
    });
  });

  try {
    await portalWindow.loadURL(PORTAL_NFE_URL);
  } catch (error) {
    logPortal('LOAD_ERRO', { erro: error.message });
    emitirParaRenderer('portal-nfe-evento', {
      tipo: 'PORTAL_ERRO',
      mensagem: error.message || 'Falha ao carregar Portal Nacional',
      documentoId
    });
    // Mantém janela aberta para diagnóstico; usuário pode navegar
  }

  let metodoChave = null;
  let chavePreenchida = false;
  let chaveCopiada = false;

  if (chave && chave.length === 44 && portalWindow && !portalWindow.isDestroyed()) {
    const preenchimento = await preencherChaveNoPortal(portalWindow.webContents, chave);
    metodoChave = preenchimento.metodoChave;
    sessaoAtiva.metodoChave = metodoChave;
    chavePreenchida = metodoChave === 'preenchida';
    chaveCopiada = metodoChave === 'clipboard';
    emitirParaRenderer('portal-nfe-evento', {
      tipo: chavePreenchida ? 'CHAVE_ENVIADA' : 'CHAVE_COPIADA_AUTOMATICAMENTE',
      documentoId,
      chave,
      metodoChave
    });
  }

  emitirParaRenderer('portal-nfe-evento', {
    tipo: 'PORTAL_ABERTO',
    documentoId,
    chave,
    url: PORTAL_NFE_URL,
    downloadDir: obterDirDownloads(),
    chavePreenchida,
    chaveCopiada,
    metodoChave
  });

  return {
    sucesso: true,
    reutilizado: false,
    downloadDir: obterDirDownloads(),
    url: PORTAL_NFE_URL,
    chavePreenchida,
    chaveCopiada,
    metodoChave,
    partition: PARTITION
  };
}

/**
 * Fecha a janela do Portal (após sucesso ou cancelamento).
 * @param {Object} [opcoes]
 * @param {boolean} [opcoes.aguardarMs]
 */
async function fecharPortal(opcoes = {}) {
  const aguardarMs = Number(opcoes.aguardarMs) || 0;
  if (aguardarMs > 0) {
    await new Promise((r) => setTimeout(r, aguardarMs));
  }
  fecharPortalWindow();
  return { sucesso: true };
}

/**
 * Mostra overlay de sucesso na janela (best-effort) e fecha.
 * @param {Object} [opcoes]
 */
async function concluirComSucesso(opcoes = {}) {
  const mensagem = opcoes.mensagem || 'Documento recuperado com sucesso.';
  const aguardarMs = opcoes.aguardarMs != null ? Number(opcoes.aguardarMs) : 2000;
  const manterAberta = opcoes.manterAberta === true;

  if (portalWindow && !portalWindow.isDestroyed()) {
    try {
      await portalWindow.webContents.executeJavaScript(`
        (function(){
          var el = document.createElement('div');
          el.setAttribute('style',
            'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;'
            + 'background:rgba(15,23,42,.72);color:#fff;font:600 18px/1.4 system-ui,sans-serif;text-align:center;padding:24px;');
          el.textContent = ${JSON.stringify(mensagem)};
          document.documentElement.appendChild(el);
        })();
      `, true);
    } catch { /* página pode bloquear executeJavaScript */ }
  }

  emitirParaRenderer('portal-nfe-evento', {
    tipo: 'DOCUMENTO_RECUPERADO_PORTAL',
    documentoId: sessaoAtiva.documentoId,
    mensagem
  });

  if (!manterAberta) {
    await fecharPortal({ aguardarMs });
  }
  return { sucesso: true, fechou: !manterAberta };
}

function registrarHandlersIpc(ipcMain, obterMainWindow) {
  ipcMain.removeHandler('portal-nfe-validar');
  ipcMain.handle('portal-nfe-validar', async () => {
    try {
      return validarCompatibilidade();
    } catch (error) {
      logPortal('IPC_VALIDAR_ERRO', { erro: error.message });
      return { ok: false, erro: error.message };
    }
  });

  ipcMain.removeHandler('portal-nfe-abrir');
  ipcMain.handle('portal-nfe-abrir', async (event, payload = {}) => {
    if (!recuperacaoPortalNacionalHabilitada()) {
      return {
        sucesso: false,
        erro: 'Funcionalidade temporariamente indisponível.',
        mensagem: 'Funcionalidade temporariamente indisponível.'
      };
    }
    try {
      const parent = typeof obterMainWindow === 'function'
        ? obterMainWindow()
        : BrowserWindow.fromWebContents(event.sender);
      return await abrirPortal({
        parent: parent || null,
        parentWebContents: event.sender,
        documentoId: payload.documentoId ?? payload.documento_id ?? null,
        chave: payload.chave || null
      });
    } catch (error) {
      logPortal('IPC_ABRIR_ERRO', { erro: error.message });
      return {
        sucesso: false,
        erro: error.message,
        mensagem: 'Não foi possível abrir o Portal Nacional. Reinicie o CDS e tente novamente.'
      };
    }
  });

  ipcMain.removeHandler('portal-nfe-fechar');
  ipcMain.handle('portal-nfe-fechar', async (_event, payload = {}) => {
    try {
      return await fecharPortal(payload);
    } catch (error) {
      logPortal('IPC_FECHAR_ERRO', { erro: error.message });
      return { sucesso: false, erro: error.message };
    }
  });

  ipcMain.removeHandler('portal-nfe-status');
  ipcMain.handle('portal-nfe-status', async () => {
    try {
      return { sucesso: true, ...obterStatusPortal() };
    } catch (error) {
      logPortal('IPC_STATUS_ERRO', { erro: error.message });
      return { sucesso: false, erro: error.message };
    }
  });

  ipcMain.removeHandler('portal-nfe-download');
  ipcMain.handle('portal-nfe-download', async () => {
    try {
      const dir = garantirPastaDownloads();
      return {
        sucesso: true,
        caminho: dir,
        downloadDir: dir,
        ...obterStatusPortal()
      };
    } catch (error) {
      logPortal('IPC_DOWNLOAD_ERRO', { erro: error.message });
      return { sucesso: false, erro: error.message };
    }
  });

  ipcMain.removeHandler('portal-nfe-sucesso');
  ipcMain.handle('portal-nfe-sucesso', async (_event, payload = {}) => {
    try {
      return await concluirComSucesso(payload);
    } catch (error) {
      logPortal('IPC_SUCESSO_ERRO', { erro: error.message });
      return { sucesso: false, erro: error.message };
    }
  });

  ipcMain.removeHandler('portal-nfe-abrir-pasta');
  ipcMain.handle('portal-nfe-abrir-pasta', async (_event, payload = {}) => {
    try {
      const caminhoArquivo = payload.caminho ? String(payload.caminho) : null;
      const pasta = caminhoArquivo ? path.dirname(caminhoArquivo) : obterDirDownloads();
      const resultado = await shell.openPath(pasta);
      return { sucesso: !resultado, caminho: pasta, erro: resultado || null };
    } catch (error) {
      logPortal('IPC_ABRIR_PASTA_ERRO', { erro: error.message });
      return { sucesso: false, erro: error.message };
    }
  });

  ipcMain.removeHandler('portal-nfe-dir-downloads');
  ipcMain.handle('portal-nfe-dir-downloads', async () => ({
    caminho: garantirPastaDownloads()
  }));
}

module.exports = {
  PORTAL_NFE_URL,
  PARTITION,
  obterDirDownloads,
  garantirPastaDownloads,
  validarCompatibilidade,
  abrirPortal,
  fecharPortal,
  concluirComSucesso,
  preencherChaveNoPortal,
  obterStatusPortal,
  montarScriptPreencherChave,
  registrarHandlersIpc
};
