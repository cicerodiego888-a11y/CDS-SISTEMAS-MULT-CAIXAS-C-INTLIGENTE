/**
 * UX INTRO EXPERIENCE 1.0 — orquestração da abertura oficial.
 * Somente visual. Não altera autenticação, APIs ou Electron.
 *
 * Sequência total ≤ 2000 ms → fade para o login.
 */
(function (global) {
  'use strict';

  var MESSAGES = [
    'Inicializando Plataforma',
    'Carregando Inteligência Comercial',
    'Inicializando Plataforma Fiscal',
    'Conectando Central Inteligente',
    'Inicializando MIIP',
    'Preparando Centro de Comando'
  ];

  var TIMELINE = {
    phase2: 180,
    phase3: 420,
    phase4: 900,
    phase5: 1180,
    phase6: 1450,
    phase7: 1850,
    total: 2000
  };

  var _started = false;
  var _doneCallbacks = [];

  function onComplete(cb) {
    if (typeof cb !== 'function') return;
    if (document.body.classList.contains('intro-done')) {
      cb();
      return;
    }
    _doneCallbacks.push(cb);
  }

  function fireDone() {
    document.body.classList.remove('intro-active');
    document.body.classList.add('intro-done');
    var list = _doneCallbacks.slice();
    _doneCallbacks = [];
    list.forEach(function (cb) {
      try { cb(); } catch (e) { /* ignore */ }
    });
    if (typeof global.CustomEvent === 'function') {
      document.dispatchEvent(new CustomEvent('cds:intro-complete'));
    }
  }

  function mountMarkup(html) {
    var wrap = document.createElement('div');
    wrap.innerHTML = String(html || '').trim();
    var root = wrap.firstElementChild;
    if (root) document.body.appendChild(root);
    return document.getElementById('cdsIntroRoot');
  }

  function fetchAndMount(done) {
    var existing = document.getElementById('cdsIntroRoot');
    if (existing) {
      done(existing);
      return;
    }

    fetch('/shared/intro/intro.html', { cache: 'no-cache' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        done(mountMarkup(html));
      })
      .catch(function () {
        done(mountMarkup(fallbackMarkup()));
      });
  }

  function fallbackMarkup() {
    return (
      '<div id="cdsIntroRoot" class="intro-root" data-phase="1">' +
      '<div class="intro-stage"><div class="intro-gradient"></div>' +
      '<div class="intro-network" id="introNetwork"></div></div>' +
      '<div class="intro-center">' +
      '<div class="intro-logo-wrap" id="introLogoWrap">' +
      '<img class="intro-logo" id="introLogoImg" src="/branding/logo-oficial.png" alt="">' +
      '</div>' +
      '<div class="intro-brand-text" id="introBrandText">' +
      '<h1 class="intro-title" id="introTitle"></h1>' +
      '<p class="intro-subtitle" id="introSubtitle"></p>' +
      '<p class="intro-slogan" id="introSlogan"></p>' +
      '<p class="intro-version" id="introVersion"></p>' +
      '</div>' +
      '<ul class="intro-load" id="introLoadList"></ul>' +
      '</div></div>'
    );
  }

  function run(root) {
    var A = global.IntroAnimators;
    if (!A || !root) {
      fireDone();
      return;
    }

    document.body.classList.add('intro-active');

    var scene = new A.IntroScene(root);
    var network = new A.NetworkAnimator(document.getElementById('introNetwork'));
    var logoSvg = new A.LogoAnimator(document.getElementById('introSymbol'));
    var brand = new A.BrandAnimator({
      logoImg: document.getElementById('introLogoImg'),
      logoWrap: document.getElementById('introLogoWrap'),
      brandText: document.getElementById('introBrandText'),
      title: document.getElementById('introTitle'),
      subtitle: document.getElementById('introSubtitle'),
      slogan: document.getElementById('introSlogan'),
      version: document.getElementById('introVersion')
    });
    var loading = new A.LoadingSequence(document.getElementById('introLoadList'), MESSAGES);

    brand.applyBrand();
    network.mount();
    logoSvg.prepare();
    loading.mount();
    scene.setPhase(1);

    if (A.prefersReducedMotion()) {
      scene.setPhase(6);
      network.play();
      logoSvg.play();
      brand.showLogo();
      brand.showText();
      loading.play(200);
      setTimeout(function () {
        loading.stop();
        scene.fadeOut(fireDone);
      }, 350);
      return;
    }

    var timers = [];

    function at(ms, fn) {
      timers.push(setTimeout(fn, ms));
    }

    at(TIMELINE.phase2, function () {
      scene.setPhase(2);
      network.play();
    });

    at(TIMELINE.phase3, function () {
      scene.setPhase(3);
      logoSvg.play();
    });

    at(TIMELINE.phase4, function () {
      scene.setPhase(4);
      brand.showLogo();
    });

    at(TIMELINE.phase5, function () {
      scene.setPhase(5);
      brand.showText();
    });

    at(TIMELINE.phase6, function () {
      scene.setPhase(6);
      loading.play(TIMELINE.phase7 - TIMELINE.phase6);
    });

    at(TIMELINE.phase7, function () {
      scene.setPhase(7);
      loading.stop();
      scene.fadeOut(fireDone);
    });

    /* Safety: nunca ultrapassar o teto */
    at(TIMELINE.total + 50, function () {
      if (!document.body.classList.contains('intro-done')) {
        timers.forEach(clearTimeout);
        loading.stop();
        scene.fadeOut(fireDone);
      }
    });
  }

  function start() {
    if (_started) return;
    _started = true;

    /* Sessão já autenticada: não atrasa o redirect do login.js */
    try {
      if (global.localStorage && localStorage.getItem('token')) {
        fireDone();
        return;
      }
    } catch (e) { /* ignore */ }

    fetchAndMount(function (root) {
      run(root);
    });
  }

  global.IntroExperience = {
    start: start,
    onComplete: onComplete,
    TOTAL_MS: TIMELINE.total,
    TIMELINE: TIMELINE
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);
