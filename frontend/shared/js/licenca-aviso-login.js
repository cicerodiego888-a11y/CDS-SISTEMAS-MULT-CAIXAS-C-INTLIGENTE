/**
 * Sprint 3.9 — Aviso de renovação no LOGIN (somente informa; não bloqueia).
 */
(function (global) {
  'use strict';

  const STORAGE_LEMBRAR = 'cds_licenca_lembrar_depois';

  function lembrarDepoisAtivo() {
    try {
      const raw = sessionStorage.getItem(STORAGE_LEMBRAR);
      if (!raw) return false;
      const until = Number(raw);
      return Number.isFinite(until) && Date.now() < until;
    } catch {
      return false;
    }
  }

  function marcarLembrarDepois() {
    try {
      sessionStorage.setItem(STORAGE_LEMBRAR, String(Date.now() + 4 * 60 * 60 * 1000));
    } catch { /* ignore */ }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function copiarTexto(texto) {
    const t = String(texto || '');
    if (!t) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(t);
        return true;
      }
    } catch { /* fallback */ }
    try {
      const el = document.createElement('textarea');
      el.value = t;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      return true;
    } catch {
      return false;
    }
  }

  function fecharModal() {
    const el = document.getElementById('cdsLicencaAvisoModal');
    if (el) el.remove();
  }

  function montarHtml(aviso) {
    const nivel = aviso.nivel || 'info';
    const tom = nivel === 'critical' ? 'critical' : (nivel === 'renew' ? 'renew' : 'info');
    const titulo = nivel === 'critical'
      ? 'Assinatura no vencimento'
      : (nivel === 'renew' ? 'Renovação da assinatura' : 'Aviso de assinatura');

    const canais = (nivel === 'renew' || nivel === 'critical') ? `
      <div class="cds-lic-aviso__canais">
        <div class="cds-lic-aviso__canal" data-lic-pix>
          <h4>PIX</h4>
          ${aviso.pix_configurado && aviso.qr_pix ? `
            <p class="cds-lic-aviso__chave">${escapeHtml(aviso.chave_pix || '')}</p>
            <img class="cds-lic-aviso__qr" src="${aviso.qr_pix}" alt="QR Code PIX">
            <button type="button" class="lx-btn cds-lic-aviso__btn-sec" data-lic-acao="copiar_pix">Copiar PIX</button>
          ` : `
            <p class="cds-lic-aviso__pix-vazio">${escapeHtml(aviso.pix_mensagem || 'PIX ainda não configurado.')}</p>
          `}
        </div>
        ${aviso.whatsapp_url ? `
          <div class="cds-lic-aviso__canal">
            <h4>WhatsApp</h4>
            <p class="cds-lic-aviso__chave"><a href="${escapeHtml(aviso.whatsapp_url)}" target="_blank" rel="noopener">${escapeHtml(aviso.whatsapp_url)}</a></p>
            ${aviso.qr_whatsapp ? `<img class="cds-lic-aviso__qr" src="${aviso.qr_whatsapp}" alt="QR Code WhatsApp">` : ''}
            <a class="lx-btn cds-lic-aviso__btn-sec" href="${escapeHtml(aviso.whatsapp_url)}" target="_blank" rel="noopener" data-lic-acao="enviar_comprovante">Enviar comprovante</a>
          </div>` : ''}
      </div>` : '';

    const botoesInfo = nivel === 'info' ? `
      <div class="cds-lic-aviso__acoes">
        <button type="button" class="lx-btn cds-lic-aviso__btn-sec" data-lic-acao="lembrar_depois">Lembrar depois</button>
        <button type="button" class="lx-btn" data-lic-acao="renovar_agora">Renovar agora</button>
      </div>` : `
      <div class="cds-lic-aviso__acoes">
        <button type="button" class="lx-btn cds-lic-aviso__btn-sec" data-lic-acao="lembrar_depois">Lembrar depois</button>
      </div>`;

    return `
      <div id="cdsLicencaAvisoModal" class="cds-lic-aviso cds-lic-aviso--${tom}" role="dialog" aria-modal="true" aria-labelledby="cdsLicencaAvisoTitulo">
        <div class="cds-lic-aviso__card">
          <h2 id="cdsLicencaAvisoTitulo">${escapeHtml(titulo)}</h2>
          <p class="cds-lic-aviso__msg ${nivel === 'critical' || nivel === 'renew' && aviso.dias_restantes <= 1 ? 'is-destaque' : ''}">
            ${escapeHtml(aviso.mensagem || '')}
          </p>
          ${canais}
          ${botoesInfo}
        </div>
      </div>`;
  }

  function injetarEstilos() {
    if (document.getElementById('cdsLicencaAvisoCss')) return;
    const style = document.createElement('style');
    style.id = 'cdsLicencaAvisoCss';
    style.textContent = `
      .cds-lic-aviso{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(8,12,20,.55);backdrop-filter:blur(4px)}
      .cds-lic-aviso__card{width:min(560px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:16px;padding:1.5rem;box-shadow:0 20px 50px rgba(0,0,0,.25);font-family:inherit}
      .cds-lic-aviso__card h2{margin:0 0 .75rem;font-size:1.25rem}
      .cds-lic-aviso__msg{margin:0 0 1rem;line-height:1.45;color:#333}
      .cds-lic-aviso__msg.is-destaque{font-weight:700;font-size:1.05rem;color:#8a1c1c}
      .cds-lic-aviso--critical .cds-lic-aviso__card{border:2px solid #c0392b}
      .cds-lic-aviso--renew .cds-lic-aviso__card{border:2px solid #d68910}
      .cds-lic-aviso__canais{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem}
      @media(max-width:560px){.cds-lic-aviso__canais{grid-template-columns:1fr}}
      .cds-lic-aviso__canal{border:1px solid #e5e7eb;border-radius:12px;padding:.75rem;text-align:center}
      .cds-lic-aviso__canal h4{margin:0 0 .35rem;font-size:.95rem}
      .cds-lic-aviso__chave{font-size:.8rem;word-break:break-all;margin:0 0 .5rem}
      .cds-lic-aviso__qr{width:160px;height:160px;margin:0 auto .5rem;display:block}
      .cds-lic-aviso__pix-vazio{margin:.75rem 0;color:#6b7280;font-size:.9rem}
      .cds-lic-aviso__acoes{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:flex-end}
      .cds-lic-aviso__btn-sec{background:#eef2f7!important;color:#1f2937!important}
      a.cds-lic-aviso__btn-sec{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
    `;
    document.head.appendChild(style);
  }

  function wireAcoes(aviso) {
    const root = document.getElementById('cdsLicencaAvisoModal');
    if (!root) return;
    root.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-lic-acao]');
      if (!btn) return;
      const acao = btn.getAttribute('data-lic-acao');
      if (acao === 'lembrar_depois') {
        marcarLembrarDepois();
        fecharModal();
        return;
      }
      if (acao === 'renovar_agora') {
        if (aviso.whatsapp_url) {
          window.open(aviso.whatsapp_url, '_blank', 'noopener');
        } else if (aviso.chave_pix) {
          await copiarTexto(aviso.chave_pix);
        }
        return;
      }
      if (acao === 'copiar_pix') {
        if (!aviso.pix_configurado || !aviso.chave_pix) {
          btn.textContent = 'PIX ainda não configurado';
          return;
        }
        const ok = await copiarTexto(aviso.chave_pix);
        btn.textContent = ok ? 'PIX copiado' : 'Falha ao copiar';
        return;
      }
    });
  }

  async function verificarEExibirAvisoLogin() {
    if (lembrarDepoisAtivo()) return;
    const api = (typeof global.API_URL === 'string' && global.API_URL) || `${window.location.origin}/api`;
    try {
      const resp = await fetch(`${api}/licenca/aviso-renovacao`, { method: 'GET' });
      if (!resp.ok) return;
      const aviso = await resp.json();
      if (!aviso || aviso.mostrar !== true) return;
      injetarEstilos();
      document.body.insertAdjacentHTML('beforeend', montarHtml(aviso));
      wireAcoes(aviso);
    } catch (err) {
      console.warn('[LicencaAvisoLogin]', err.message || err);
    }
  }

  global.LicencaAvisoLogin = {
    verificarEExibirAvisoLogin,
    fecharModal
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void verificarEExibirAvisoLogin();
    });
  } else {
    void verificarEExibirAvisoLogin();
  }
})(typeof window !== 'undefined' ? window : global);
