/**
 * UX LOGIN EXPERIENCE 2.0 — apresentação visual da entrada.
 * Não altera autenticação, sessão, APIs ou Electron.
 */
(function (global) {
  'use strict';

  var BOOT_MESSAGES = [
    'Inicializando Plataforma...',
    'Carregando Inteligência Comercial...',
    'Inicializando Plataforma Fiscal...',
    'Conectando Central Inteligente...',
    'Inicializando MIIP...',
    'Preparando Centro de Comando...',
    'Pronto.'
  ];

  var BOOT_TOTAL_MS = 800;
  var INTRO_READY_MS = 40;

  function aplicarBranding() {
    if (!global.BrandService) return;

    BrandService.aplicarFavicon();

    var logo = document.getElementById('loginLogo');
    if (logo) {
      logo.src = BrandService.url('logoOficial');
      logo.alt = BrandService.NOME;
    }

    var bootLogo = document.getElementById('loginBootLogo');
    if (bootLogo) {
      bootLogo.src = BrandService.url('splash');
      bootLogo.alt = BrandService.NOME;
    }

    setText('loginTitle', BrandService.NOME_DISPLAY);
    setText('loginSubtitle', BrandService.SUBTITULO);
    setText('loginSlogan', BrandService.SLOGAN);
    setText('loginWelcomeTitle', 'Bem-vindo.');
    setText('loginWelcomeText', 'Acesse sua plataforma.');
    setText('loginFooterName', BrandService.NOME);
    setText('loginFooterVersion', 'Versão ' + (BrandService.VERSAO || '1.0.0'));
    setText('loginFooterSubtitle', BrandService.SUBTITULO);

    document.title = 'Login — ' + BrandService.NOME;
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function iniciarIntroLogin() {
    requestAnimationFrame(function () {
      document.body.classList.add('lx-ready');
    });
  }

  /**
   * Splash visual após login bem-sucedido.
   * Apenas UX — redireciona para o mesmo destino após ~800ms.
   */
  function mostrarSplashEntrada(destino) {
    var splash = document.getElementById('loginBootSplash');
    var msgEl = document.getElementById('loginBootMsg');
    if (!splash || !msgEl) {
      global.location.replace(destino);
      return;
    }

    splash.hidden = false;
    splash.classList.add('is-active');

    var stepMs = Math.floor(BOOT_TOTAL_MS / Math.max(BOOT_MESSAGES.length, 1));
    var index = 0;

    msgEl.textContent = BOOT_MESSAGES[0];

    var timer = setInterval(function () {
      index += 1;
      if (index >= BOOT_MESSAGES.length) {
        clearInterval(timer);
        return;
      }
      msgEl.classList.add('is-swap');
      setTimeout(function () {
        msgEl.textContent = BOOT_MESSAGES[index];
        msgEl.classList.remove('is-swap');
      }, 90);
    }, Math.max(stepMs, 90));

    setTimeout(function () {
      clearInterval(timer);
      global.location.replace(destino);
    }, BOOT_TOTAL_MS);
  }

  function setBotaoLoading(ativo) {
    var btn = document.getElementById('btn-entrar');
    if (!btn) return;
    btn.disabled = !!ativo;
    btn.classList.toggle('is-loading', !!ativo);
  }

  function mostrarErroLogin(mensagem) {
    var err = document.getElementById('login-error');
    if (!err) return;
    err.textContent = mensagem || '';
    err.classList.toggle('is-visible', !!mensagem);
    err.classList.toggle('d-none', !mensagem);
  }

  function limparErroLogin() {
    mostrarErroLogin('');
  }

  aplicarBranding();

  /* Login só revela após a Intro Experience oficial (≤ 2s) */
  if (global.IntroExperience && typeof IntroExperience.onComplete === 'function') {
    IntroExperience.onComplete(iniciarIntroLogin);
    setTimeout(function () {
      if (!document.body.classList.contains('lx-ready')) {
        iniciarIntroLogin();
      }
    }, 2200);
  } else {
    setTimeout(iniciarIntroLogin, INTRO_READY_MS);
  }

  global.LoginExperience = {
    mostrarSplashEntrada: mostrarSplashEntrada,
    setBotaoLoading: setBotaoLoading,
    mostrarErroLogin: mostrarErroLogin,
    limparErroLogin: limparErroLogin,
    BOOT_TOTAL_MS: BOOT_TOTAL_MS
  };
})(window);
