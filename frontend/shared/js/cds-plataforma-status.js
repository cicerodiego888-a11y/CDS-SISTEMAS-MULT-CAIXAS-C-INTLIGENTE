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

  async function carregarBarraStatusPlataforma() {
    const host = document.getElementById('cds-plataforma-status');
    if (!host) return;

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
