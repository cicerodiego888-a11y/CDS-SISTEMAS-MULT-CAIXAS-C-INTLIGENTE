/**
 * Infraestrutura de widgets do rodapé do PDV
 * Cards: título + meta + hint + tooltip (UX-02).
 */
(function (global) {
  'use strict';

  const SLOT_ATTR = 'data-pdv-footer-widgets';
  const registry = new Map();
  let iniciado = false;

  const ENTREGAS_WIDGET_SPEC = Object.freeze({
    id: 'entregas-pendentes',
    label: 'Entregas',
    icon: 'truck',
    enabled: false,
    visible: false,
    sections: Object.freeze([
      Object.freeze({ id: 'prestacao', label: 'Prestação', role: 'action' }),
      Object.freeze({ id: 'contadores', label: 'Contadores', role: 'metrics' }),
      Object.freeze({ id: 'notificacoes', label: 'Notificações', role: 'alerts' })
    ]),
    counters: Object.freeze({
      aguardando_entrega: 0,
      em_entrega: 0,
      aguardando_prestacao: 0,
      total_pendentes: 0
    }),
    notifications: Object.freeze([])
  });

  function garantirSlot() {
    const footer = document.querySelector('footer.pdv-atalhos');
    if (!footer) return null;

    // Remove barra separada legada (UX-03.1) se existir
    document.querySelectorAll('.pdv-footer-operacional').forEach((el) => {
      if (!footer.contains(el)) el.remove();
    });

    let slot = footer.querySelector(`[${SLOT_ATTR}]`);
    if (!slot) {
      slot = document.createElement('span');
      slot.setAttribute(SLOT_ATTR, '1');
      slot.className = 'pdv-footer-widgets';
      slot.setAttribute('aria-hidden', 'true');
      slot.style.display = 'none';
      footer.appendChild(slot);
    }
    return slot;
  }

  function limparLabelBase(label) {
    return String(label || '')
      .replace(/\s*\(\d+\)\s*$/, '')
      .replace(/\.{2,}\s*\d+\s*$/, '')
      .trim();
  }

  function escapeAttr(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function renderWidgetHtml(w) {
    const id = String(w.id || '').replace(/"/g, '');
    const label = limparLabelBase(w.label || w.id || '');
    const count = w.count != null ? Number(w.count) || 0 : null;
    const meta = w.meta || (count != null ? `${count}` : '');
    const hint = w.hint || 'Clique para abrir';
    const tooltip = w.tooltip || `${label} — ${hint}`;
    const extra = w.className ? ` ${String(w.className)}` : '';
    const destaque = count != null && count > 0 ? ' pdv-footer-widget--has-count' : '';

    return `<button type="button" class="pdv-footer-widget pdv-footer-widget--card${destaque}${extra}" data-pdv-footer-widget="${id}" title="${escapeAttr(tooltip)}">
      <span class="pdv-footer-widget__title">${label}</span>
      <span class="pdv-footer-widget__meta"><strong>${count != null ? count : '—'}</strong> ${escapeAttr(meta)}</span>
      <span class="pdv-footer-widget__hint">${escapeAttr(hint)}</span>
    </button>`;
  }

  function render() {
    const slot = garantirSlot();
    if (!slot) return;

    const ativos = [];
    registry.forEach((widget) => {
      if (!widget || widget.enabled === false || widget.visible === false) return;
      if (typeof widget.shouldShow === 'function' && !widget.shouldShow()) return;
      ativos.push(widget);
    });

    if (!ativos.length) {
      slot.innerHTML = '';
      slot.style.display = 'none';
      slot.setAttribute('aria-hidden', 'true');
      return;
    }

    slot.style.display = '';
    slot.setAttribute('aria-hidden', 'false');
    slot.innerHTML = ativos.map(renderWidgetHtml).join('');

    slot.querySelectorAll('[data-pdv-footer-widget]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-pdv-footer-widget');
        const widget = registry.get(id);
        if (widget && typeof widget.onClick === 'function') {
          widget.onClick();
        }
      });
    });
  }

  function register(widget) {
    if (!widget || !widget.id) {
      throw new Error('PdvFooterWidgets.register exige widget.id');
    }
    registry.set(String(widget.id), widget);
    if (iniciado) render();
  }

  function unregister(id) {
    registry.delete(String(id));
    if (iniciado) render();
  }

  function update(id, patch) {
    const atual = registry.get(String(id));
    if (!atual) return;
    registry.set(String(id), Object.assign({}, atual, patch || {}));
    if (iniciado) render();
  }

  function init() {
    iniciado = true;
    garantirSlot();
    render();
  }

  function list() {
    return Array.from(registry.keys());
  }

  function obterSpecEntregas() {
    return ENTREGAS_WIDGET_SPEC;
  }

  function prepararWidgetEntregas(overrides = {}) {
    return Object.assign({}, ENTREGAS_WIDGET_SPEC, overrides);
  }

  global.PdvFooterWidgets = {
    init,
    register,
    unregister,
    update,
    render,
    list,
    obterSpecEntregas,
    prepararWidgetEntregas,
    ENTREGAS_WIDGET_SPEC,
    WIDGET_IDS: Object.freeze({
      ENTREGAS_PENDENTES: 'entregas-pendentes',
      ENTREGAS_PRESTACAO: 'entregas-prestacao'
    })
  };
})(typeof window !== 'undefined' ? window : globalThis);
