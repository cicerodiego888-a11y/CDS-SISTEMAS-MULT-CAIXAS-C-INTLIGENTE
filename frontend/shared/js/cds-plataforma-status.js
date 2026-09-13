/**
 * Hotfix RC1.3 — Barra de Status da Plataforma (rodapé ERP).
 */
(function (global) {
  'use strict';

  const SLOTS_FUTUROS = Object.freeze([
    'servidor', 'backup', 'sincronizacao', 'portal', 'licenca'
  ]);

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderBarra(status) {
    const a = status.assinatura || {};
    const tom = a.tom || 'neutral';
    return `
      <div class="cds-status-bar" data-tom="${escapeHtml(tom)}" role="contentinfo" aria-label="Status da plataforma CDS">
        <div class="cds-status-bar__inner">
          <span class="cds-status-bar__brand">${escapeHtml(status.marca || 'CDS Sistemas')}</span>
          <span class="cds-status-bar__sep" aria-hidden="true">•</span>
          <span class="cds-status-bar__item">Plano: <strong>${escapeHtml(status.plano || '—')}</strong></span>
          <span class="cds-status-bar__sep" aria-hidden="true">•</span>
          <span class="cds-status-bar__assinatura" data-cor="${escapeHtml(a.cor || 'cinza')}">${escapeHtml(a.mensagem || 'Assinatura')}</span>
          <span class="cds-status-bar__sep" aria-hidden="true">•</span>
          <span class="cds-status-bar__item">Versão: <strong>${escapeHtml(status.versao || '—')}</strong></span>
        </div>
        <div class="cds-status-bar__slots" hidden aria-hidden="true" data-slots-futuros="${SLOTS_FUTUROS.join(',')}"></div>
      </div>`;
  }

  function garantirEstilos() {
    if (document.getElementById('cdsStatusBarCss')) return;
    const style = document.createElement('style');
    style.id = 'cdsStatusBarCss';
    style.textContent = `
      .cds-status-bar{position:fixed;left:0;right:0;bottom:0;z-index:1000;font-size:12px;line-height:1.3;border-top:1px solid rgba(255,255,255,.08)}
      .cds-status-bar__inner{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.35rem .55rem;padding:7px 12px;background:#111827;color:#d1d5db}
      .cds-status-bar__brand{font-weight:700;color:#f9fafb;letter-spacing:.02em}
      .cds-status-bar__sep{opacity:.45}
      .cds-status-bar__item strong{color:#f3f4f6;font-weight:600}
      .cds-status-bar__assinatura{font-weight:600}
      .cds-status-bar[data-tom="ok"] .cds-status-bar__assinatura{color:#34d399}
      .cds-status-bar[data-tom="warn"] .cds-status-bar__assinatura{color:#fbbf24}
      .cds-status-bar[data-tom="warn-strong"] .cds-status-bar__assinatura{color:#fb923c}
      .cds-status-bar[data-tom="critical"] .cds-status-bar__assinatura{color:#f87171}
      .cds-status-bar[data-tom="neutral"] .cds-status-bar__assinatura{color:#9ca3af}
      body.cds-has-status-bar{padding-bottom:34px}
      @media (max-width:720px){
        .cds-status-bar__inner{justify-content:flex-start;padding:8px 10px}
        .cds-status-bar__sep{display:none}
        .cds-status-bar__item,.cds-status-bar__assinatura,.cds-status-bar__brand{width:100%}
      }
    `;
    document.head.appendChild(style);
  }

  async function carregarBarraStatusPlataforma() {
    const host = document.getElementById('cds-plataforma-status');
    if (!host) return;

    garantirEstilos();
    document.body.classList.add('cds-has-status-bar');

    const api = (typeof global.API_URL === 'string' && global.API_URL) || `${window.location.origin}/api`;
    const token = localStorage.getItem('token');
    if (!token) {
      host.innerHTML = renderBarra({
        marca: 'CDS Sistemas',
        plano: '—',
        versao: '—',
        assinatura: { tom: 'neutral', cor: 'cinza', mensagem: 'Assinatura' }
      });
      return;
    }

    try {
      const resp = await fetch(`${api}/plataforma/status`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const status = await resp.json();
      host.innerHTML = renderBarra(status);
    } catch (err) {
      console.warn('[CdsPlataformaStatus]', err.message || err);
      host.innerHTML = renderBarra({
        marca: 'CDS Sistemas',
        plano: '—',
        versao: '—',
        assinatura: { tom: 'neutral', cor: 'cinza', mensagem: 'Status indisponível' }
      });
    }
  }

  global.CdsPlataformaStatus = {
    carregarBarraStatusPlataforma,
    renderBarra,
    SLOTS_FUTUROS
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void carregarBarraStatusPlataforma();
    });
  } else {
    void carregarBarraStatusPlataforma();
  }
})(typeof window !== 'undefined' ? window : global);
