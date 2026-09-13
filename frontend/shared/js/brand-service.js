/**
 * BrandService (Web) — Identidade visual oficial CDS Sistemas (Branding 1.0)
 * Espelha assets/branding/BrandService.js para o browser.
 * Sem dependência de Node. Compatível com Electron (renderer) e Web.
 */
(function (global) {
  'use strict';

  const NOME = 'CDS Sistemas';
  const NOME_CURTO = 'CDS';
  const NOME_DISPLAY = 'CDS SISTEMAS';
  const SLOGAN = 'Inteligência para gerir, Tecnologia para crescer';
  const SUBTITULO = 'Plataforma Inteligente de Gestão';
  const VERSAO = '1.0.0';
  const COPYRIGHT = '© ' + new Date().getFullYear() + ' CDS Sistemas';
  const WEB_BASE = '/branding';

  const ARQUIVOS = Object.freeze({
    logoOficial: 'logo-oficial.png',
    logoAuxiliar: 'logo-auxiliar.png',
    favicon: 'favicon.ico',
    icon: 'icon.ico',
    splash: 'splash.png',
    loginBackground: 'login-background.png',
    marcaDagua: 'marca-dagua.png'
  });

  function arquivo(chave) {
    const nome = ARQUIVOS[chave];
    if (!nome) {
      throw new Error('BrandService: asset desconhecido "' + chave + '"');
    }
    return nome;
  }

  function url(chave) {
    return WEB_BASE + '/' + arquivo(chave);
  }

  function meta() {
    return {
      nome: NOME,
      nomeCurto: NOME_CURTO,
      nomeDisplay: NOME_DISPLAY,
      slogan: SLOGAN,
      subtitulo: SUBTITULO,
      versao: VERSAO,
      copyright: COPYRIGHT,
      webBase: WEB_BASE,
      arquivos: Object.assign({}, ARQUIVOS)
    };
  }

  /** Aplica favicon oficial no documento atual. */
  function aplicarFavicon(doc) {
    const d = doc || document;
    if (!d || !d.head) return;
    let link = d.querySelector('link[rel="icon"]');
    if (!link) {
      link = d.createElement('link');
      link.setAttribute('rel', 'icon');
      d.head.appendChild(link);
    }
    link.setAttribute('type', 'image/x-icon');
    link.setAttribute('href', url('favicon'));
  }

  /** HTML padrão da marca na sidebar (quando não há logo da empresa). */
  function htmlSidebarPadrao(modulo) {
    return (
      '<img src="' + url('logoOficial') + '" alt="' + NOME + '" class="img-fluid brand-sidebar-logo">' +
      '<small class="text-muted brand-sidebar-slogan">' +
        SLOGAN +
      '</small>'
    );
  }

  /** Markup do splash oficial (sem animações extras — só estrutura). */
  function htmlSplash(texto) {
    const msg = texto || 'Carregando…';
    return (
      '<div id="splash-screen">' +
        '<div class="splash-content">' +
          '<img class="splash-logo" src="' + url('splash') + '" alt="' + NOME + '">' +
          '<p class="splash-text">' + msg + '</p>' +
          '<p class="splash-slogan" style="color:rgba(255,255,255,0.75);font-size:0.8rem;margin-top:0.5rem;">' +
            SLOGAN +
          '</p>' +
        '</div>' +
      '</div>'
    );
  }

  const BrandService = {
    NOME: NOME,
    NOME_CURTO: NOME_CURTO,
    NOME_DISPLAY: NOME_DISPLAY,
    SLOGAN: SLOGAN,
    SUBTITULO: SUBTITULO,
    VERSAO: VERSAO,
    COPYRIGHT: COPYRIGHT,
    ARQUIVOS: ARQUIVOS,
    WEB_BASE: WEB_BASE,
    arquivo: arquivo,
    url: url,
    meta: meta,
    aplicarFavicon: aplicarFavicon,
    htmlSidebarPadrao: htmlSidebarPadrao,
    htmlSplash: htmlSplash
  };

  global.BrandService = BrandService;
})(typeof window !== 'undefined' ? window : this);
