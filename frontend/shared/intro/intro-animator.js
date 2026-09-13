/**
 * UX INTRO EXPERIENCE 1.0 — animadores (somente visual)
 * Efeitos: opacity, transform, blur, scale, translate.
 */
(function (global) {
  'use strict';

  var TOTAL_MS = 2000;

  function prefersReducedMotion() {
    return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* —— IntroScene —— */
  function IntroScene(root) {
    this.root = root;
    this.phase = 0;
  }

  IntroScene.prototype.setPhase = function (n) {
    this.phase = n;
    if (!this.root) return;
    this.root.setAttribute('data-phase', String(n));
    for (var i = 1; i <= 7; i++) {
      this.root.classList.toggle('intro-phase-' + i, i <= n);
    }
  };

  IntroScene.prototype.fadeOut = function (done) {
    var root = this.root;
    if (!root) {
      if (done) done();
      return;
    }
    root.classList.add('intro-exit');
    setTimeout(function () {
      root.classList.add('intro-hidden');
      root.setAttribute('aria-hidden', 'true');
      if (done) done();
    }, 280);
  };

  /* —— NetworkAnimator —— */
  function NetworkAnimator(container) {
    this.container = container;
  }

  NetworkAnimator.prototype.mount = function () {
    if (!this.container || this.container.dataset.ready === '1') return;
    var html = '';
    var count = 18;
    for (var i = 0; i < count; i++) {
      var left = 8 + ((i * 37) % 84);
      var top = 12 + ((i * 53) % 76);
      var delay = (i * 0.045).toFixed(2);
      var dur = (1.8 + (i % 5) * 0.25).toFixed(2);
      html +=
        '<span class="intro-node" style="left:' + left + '%;top:' + top +
        '%;animation-delay:' + delay + 's;animation-duration:' + dur + 's"></span>';
    }
    this.container.innerHTML = html;
    this.container.dataset.ready = '1';
  };

  NetworkAnimator.prototype.play = function () {
    if (this.container) this.container.classList.add('is-active');
  };

  /* —— LogoAnimator (SVG stroke draw) —— */
  function LogoAnimator(svgEl) {
    this.svg = svgEl;
  }

  LogoAnimator.prototype.prepare = function () {
    if (!this.svg) return;
    var paths = this.svg.querySelectorAll('.intro-draw');
    paths.forEach(function (path) {
      var len = 0;
      try {
        len = path.getTotalLength();
      } catch (e) {
        len = 400;
      }
      path.style.strokeDasharray = String(len);
      path.style.strokeDashoffset = String(len);
    });
  };

  LogoAnimator.prototype.play = function () {
    if (!this.svg) return;
    this.svg.classList.add('is-drawing');
  };

  /* —— BrandAnimator —— */
  function BrandAnimator(els) {
    this.els = els || {};
  }

  BrandAnimator.prototype.applyBrand = function () {
    var B = global.BrandService;
    if (!B) return;

    if (this.els.logoImg) {
      this.els.logoImg.src = B.url('logoOficial');
      this.els.logoImg.alt = B.NOME;
    }
    if (this.els.title) this.els.title.textContent = B.NOME_DISPLAY;
    if (this.els.subtitle) this.els.subtitle.textContent = B.SUBTITULO;
    if (this.els.slogan) this.els.slogan.textContent = B.SLOGAN;
    if (this.els.version) this.els.version.textContent = 'v' + (B.VERSAO || '1.0.0');
  };

  BrandAnimator.prototype.showLogo = function () {
    if (this.els.logoWrap) this.els.logoWrap.classList.add('is-visible');
  };

  BrandAnimator.prototype.showText = function () {
    if (this.els.brandText) this.els.brandText.classList.add('is-visible');
  };

  /* —— LoadingSequence —— */
  function LoadingSequence(listEl, messages) {
    this.listEl = listEl;
    this.messages = messages || [];
    this.index = 0;
    this._timer = null;
  }

  LoadingSequence.prototype.mount = function () {
    if (!this.listEl) return;
    this.listEl.innerHTML = this.messages
      .map(function (msg, i) {
        return (
          '<li class="intro-load-item" data-i="' + i + '">' +
          '<span class="intro-load-check" aria-hidden="true">✓</span>' +
          '<span class="intro-load-text">' + msg + '</span>' +
          '</li>'
        );
      })
      .join('');
  };

  LoadingSequence.prototype.play = function (windowMs) {
    var self = this;
    if (!this.listEl) return;
    this.listEl.classList.add('is-active');
    var items = this.listEl.querySelectorAll('.intro-load-item');
    var n = items.length || 1;
    var step = Math.floor((windowMs || 450) / n);
    this.index = 0;

    function tick() {
      if (self.index < items.length) {
        items[self.index].classList.add('is-on');
        self.index += 1;
      }
    }

    tick();
    this._timer = setInterval(tick, Math.max(step, 60));
  };

  LoadingSequence.prototype.stop = function () {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  };

  global.IntroAnimators = {
    TOTAL_MS: TOTAL_MS,
    prefersReducedMotion: prefersReducedMotion,
    IntroScene: IntroScene,
    NetworkAnimator: NetworkAnimator,
    LogoAnimator: LogoAnimator,
    BrandAnimator: BrandAnimator,
    LoadingSequence: LoadingSequence
  };
})(window);
