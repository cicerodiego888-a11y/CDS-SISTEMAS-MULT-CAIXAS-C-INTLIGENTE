/**
 * Painel lateral "Aparência do PDV" — Sprint P0.1.
 * Depende de window.PdvThemeManager.
 */
(function (global) {
  'use strict';

  var PANEL_ID = 'pdvAppearancePanel';
  var BACKDROP_ID = 'pdvAppearanceBackdrop';
  var BTN_ID = 'btnAparenciaPdv';
  var _open = false;
  var _bound = false;

  function tm() {
    return global.PdvThemeManager;
  }

  function ensureMounted() {
    if (document.getElementById(PANEL_ID)) return;

    var backdrop = document.createElement('div');
    backdrop.id = BACKDROP_ID;
    backdrop.className = 'pdv-appearance-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    var panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.className = 'pdv-appearance-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Aparência do PDV');
    panel.innerHTML = [
      '<div class="pdv-appearance-panel__header">',
      '  <h2><i class="fas fa-palette" aria-hidden="true"></i> Aparência do PDV</h2>',
      '  <button type="button" class="pdv-appearance-panel__close" data-action="close" title="Fechar" aria-label="Fechar">',
      '    <i class="fas fa-times"></i>',
      '  </button>',
      '</div>',
      '<div class="pdv-appearance-panel__body">',
      '  <section class="pdv-appearance-section" data-section="theme">',
      '    <h3>Tema</h3>',
      '    <div class="pdv-appearance-options" id="pdvAppearanceThemes"></div>',
      '  </section>',
      '  <section class="pdv-appearance-section" data-section="font">',
      '    <h3>Tamanho da Fonte</h3>',
      '    <div class="pdv-appearance-options" id="pdvAppearanceFonts"></div>',
      '  </section>',
      '  <section class="pdv-appearance-section" data-section="scale">',
      '    <h3>Escala da Interface</h3>',
      '    <div class="pdv-appearance-scale-grid" id="pdvAppearanceScales"></div>',
      '  </section>',
      '  <section class="pdv-appearance-section" data-section="intensity">',
      '    <h3>Intensidade Visual</h3>',
      '    <div class="pdv-appearance-intensity">',
      '      <input type="range" id="pdvAppearanceIntensity" min="0" max="2" step="1" value="1" aria-label="Intensidade visual">',
      '      <div class="pdv-appearance-intensity__labels"><span>Baixa</span><span>Normal</span><span>Alta</span></div>',
      '    </div>',
      '  </section>',
      '  <section class="pdv-appearance-section" data-section="preview">',
      '    <h3>Pré-visualização</h3>',
      '    <div class="pdv-appearance-preview" id="pdvAppearancePreview">',
      '      <div class="pdv-appearance-preview__frame">',
      '        <div class="pdv-appearance-preview__topo">CDS PDV · Frente de Caixa</div>',
      '        <div class="pdv-appearance-preview__grid">',
      '          <div class="pdv-appearance-preview__card">Itens da venda<br><strong>2 produtos</strong></div>',
      '          <div class="pdv-appearance-preview__card">Resumo<br><strong>Subtotal</strong></div>',
      '        </div>',
      '        <div class="pdv-appearance-preview__total">TOTAL R$ 25,90</div>',
      '        <div class="pdv-appearance-preview__btn">FINALIZAR (F10)</div>',
      '      </div>',
      '    </div>',
      '  </section>',
      '</div>',
      '<div class="pdv-appearance-panel__footer">',
      '  <button type="button" class="pdv-appearance-btn-cancel" data-action="cancel">Cancelar</button>',
      '  <button type="button" class="pdv-appearance-btn-apply" data-action="apply">Aplicar</button>',
      '</div>'
    ].join('');

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    renderOptions();
    bindPanelEvents();
  }

  function renderOptions() {
    var manager = tm();
    if (!manager) return;
    var draft = manager.getDraft();

    var themesRoot = document.getElementById('pdvAppearanceThemes');
    if (themesRoot) {
      themesRoot.innerHTML = manager.THEMES.map(function (t) {
        var disabled = t.disabled ? ' is-disabled' : '';
        var active = !t.disabled && draft.theme === t.id ? ' is-active' : '';
        var hint = t.hint ? '<span class="pdv-appearance-option__hint">' + t.hint + '</span>' : '';
        return (
          '<label class="pdv-appearance-option' + active + disabled + '">' +
            '<input type="radio" name="pdvTheme" value="' + t.id + '"' +
              (draft.theme === t.id && !t.disabled ? ' checked' : '') +
              (t.disabled ? ' disabled' : '') + '>' +
            '<span>' + t.label + '</span>' + hint +
          '</label>'
        );
      }).join('');
    }

    var fontsRoot = document.getElementById('pdvAppearanceFonts');
    if (fontsRoot) {
      fontsRoot.innerHTML = manager.FONTS.map(function (f) {
        var active = draft.font === f.id ? ' is-active' : '';
        return (
          '<label class="pdv-appearance-option' + active + '">' +
            '<input type="radio" name="pdvFont" value="' + f.id + '"' +
              (draft.font === f.id ? ' checked' : '') + '>' +
            '<span>' + f.label + '</span>' +
          '</label>'
        );
      }).join('');
    }

    var scalesRoot = document.getElementById('pdvAppearanceScales');
    if (scalesRoot) {
      scalesRoot.innerHTML = manager.SCALES.map(function (s) {
        var active = draft.scale === s.id ? ' is-active' : '';
        return '<button type="button" data-scale="' + s.id + '" class="' + active.trim() + '">' + s.label + '</button>';
      }).join('');
    }

    var intensity = document.getElementById('pdvAppearanceIntensity');
    if (intensity) {
      var map = { baixa: 0, normal: 1, alta: 2 };
      intensity.value = String(map[draft.intensity] != null ? map[draft.intensity] : 1);
    }
  }

  function bindPanelEvents() {
    var panel = document.getElementById(PANEL_ID);
    var backdrop = document.getElementById(BACKDROP_ID);
    if (!panel || !tm()) return;

    panel.addEventListener('click', function (e) {
      var actionBtn = e.target.closest('[data-action]');
      if (!actionBtn) return;
      var action = actionBtn.getAttribute('data-action');
      if (action === 'close' || action === 'cancel') {
        cancelAndClose();
      } else if (action === 'apply') {
        applyAndClose();
      }
    });

    if (backdrop) {
      backdrop.addEventListener('click', cancelAndClose);
    }

    panel.addEventListener('change', function (e) {
      var target = e.target;
      if (!target) return;
      if (target.name === 'pdvTheme' && !target.disabled) {
        tm().preview({ theme: target.value });
        renderOptions();
      }
      if (target.name === 'pdvFont') {
        tm().preview({ font: target.value });
        renderOptions();
      }
      if (target.id === 'pdvAppearanceIntensity') {
        var vals = ['baixa', 'normal', 'alta'];
        tm().preview({ intensity: vals[Number(target.value)] || 'normal' });
      }
    });

    panel.addEventListener('click', function (e) {
      var scaleBtn = e.target.closest('[data-scale]');
      if (!scaleBtn) return;
      tm().preview({ scale: scaleBtn.getAttribute('data-scale') });
      renderOptions();
    });
  }

  function injectTopButton() {
    var status = document.querySelector('.pdv-status');
    var existing = document.getElementById(BTN_ID);

    if (existing) {
      if (!existing.dataset.boundAppearance) {
        existing.dataset.boundAppearance = '1';
        existing.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        });
      }
      return;
    }

    if (!status) return;

    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.className = 'btn-aparencia-pdv';
    btn.title = 'Aparência do PDV (F11)';
    btn.setAttribute('aria-label', 'Aparência do PDV');
    btn.innerHTML = '<i class="fas fa-palette" aria-hidden="true"></i><span class="d-none d-lg-inline">Aparência</span>';
    btn.dataset.boundAppearance = '1';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });

    var calc = document.getElementById('btnCalculadoraPdv');
    if (calc && calc.parentNode === status) {
      status.insertBefore(btn, calc);
    } else {
      status.insertBefore(btn, status.firstChild);
    }
  }

  function injectShortcutChip() {
    var footer = document.querySelector('.pdv-atalhos');
    if (!footer) return;
    if (footer.querySelector('[data-atalho="aparencia"]')) return;
    var chip = document.createElement('span');
    chip.className = 'pdv-atalho-chip';
    chip.setAttribute('data-atalho', 'aparencia');
    chip.textContent = 'F11 Aparência';
    footer.appendChild(chip);
  }

  function open() {
    ensureMounted();
    var manager = tm();
    if (manager) {
      // Draft começa do aplicado atual
      manager.resetDraft();
      renderOptions();
    }
    var panel = document.getElementById(PANEL_ID);
    var backdrop = document.getElementById(BACKDROP_ID);
    if (panel) panel.classList.add('is-open');
    if (backdrop) backdrop.classList.add('is-open');
    _open = true;
  }

  function close() {
    var panel = document.getElementById(PANEL_ID);
    var backdrop = document.getElementById(BACKDROP_ID);
    if (panel) panel.classList.remove('is-open');
    if (backdrop) backdrop.classList.remove('is-open');
    _open = false;
  }

  function toggle() {
    if (_open) cancelAndClose();
    else open();
  }

  function applyAndClose() {
    if (tm()) tm().apply();
    close();
    if (typeof showNotification === 'function') {
      showNotification('Aparência do PDV aplicada.', 'success');
    }
  }

  function cancelAndClose() {
    if (tm()) tm().resetDraft();
    close();
  }

  function bindGlobalShortcuts() {
    if (_bound) return;
    _bound = true;

    document.addEventListener('keydown', function (e) {
      if (e.key === 'F11') {
        e.preventDefault();
        e.stopPropagation();
        toggle();
        return;
      }
      if (e.key === 'Escape' && _open) {
        e.preventDefault();
        e.stopPropagation();
        cancelAndClose();
      }
    }, true);
  }

  function mountOnPdv() {
    if (!document.querySelector('.pdv-profissional')) return;
    ensureMounted();
    injectTopButton();
    injectShortcutChip();
    if (tm()) {
      // Reaplica escala no shell recém-montado
      tm().applyToDom(tm().getDraft());
    }
  }

  function init() {
    bindGlobalShortcuts();
    if (tm()) tm().restore();

    // Quando a página do PDV for injetada no #page-content
    var page = document.getElementById('page-content');
    if (page && typeof MutationObserver !== 'undefined') {
      var obs = new MutationObserver(function () {
        mountOnPdv();
      });
      obs.observe(page, { childList: true, subtree: false });
    }

    mountOnPdv();

    // Após terminal registrar, re-lê preferência por PDV
    global.addEventListener('cds:terminal-registrado', function () {
      if (tm()) tm().restore();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.PdvAppearancePanel = {
    open: open,
    close: close,
    toggle: toggle,
    mountOnPdv: mountOnPdv,
    isOpen: function () { return _open; }
  };
})(window);
