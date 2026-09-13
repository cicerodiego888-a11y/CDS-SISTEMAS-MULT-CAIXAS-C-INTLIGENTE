/**
 * CDS Copiloto — widget flutuante (PDV / Mobile / embeds)
 * Depende de AgentSDK (CdsAgentSDK).
 */
(function (global) {
  'use strict';

  const QUICK = [
    { q: 'Produtos sem estoque', label: 'Sem estoque' },
    { q: 'Buscar produto', label: 'Buscar' },
    { q: 'Fechar meu caixa', label: 'Fechar caixa' },
    { q: 'ajuda', label: 'Ajuda' }
  ];

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function sdk() {
    return global.CdsAgentSDK || global.AgentSDK;
  }

  /**
   * @param {{ origem?: string, container?: HTMLElement }} opts
   */
  function montarCdsCopilotoWidget(opts) {
    const origem = (opts && opts.origem) || global.CDS_MODULE || 'pdv';
    if (!localStorage.getItem('cia_sessao')) {
      localStorage.setItem('cia_sessao', `${origem}-${Date.now()}`);
    }

    if (document.getElementById('cdsCopilotoFab')) return;

    const style = document.createElement('style');
    style.textContent = `
      #cdsCopilotoFab{position:fixed;right:16px;bottom:48px;z-index:1050;border-radius:999px;width:52px;height:52px;border:0;background:#0f766e;color:#fff;box-shadow:0 8px 24px rgba(15,118,110,.35);cursor:pointer}
      #cdsCopilotoPanel{position:fixed;right:16px;bottom:112px;width:min(380px,calc(100vw - 24px));max-height:min(70vh,560px);z-index:1050;display:none;flex-direction:column;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.18);overflow:hidden}
      #cdsCopilotoPanel.open{display:flex}
      #cdsCopilotoPanel .cia-head{padding:10px 12px;background:#0f766e;color:#fff;display:flex;justify-content:space-between;align-items:center}
      #cdsCopilotoPanel .cia-body{flex:1;overflow:auto;padding:10px;background:#f8fafc;min-height:220px}
      #cdsCopilotoPanel .cia-quick{padding:6px 10px;border-bottom:1px solid #e5e7eb;display:flex;flex-wrap:wrap;gap:4px}
      #cdsCopilotoPanel .cia-foot{display:flex;gap:6px;padding:8px;border-top:1px solid #e5e7eb}
      #cdsCopilotoPanel .cia-foot input{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:8px}
      #cdsCopilotoPanel .msg{margin:0 0 8px;max-width:92%}
      #cdsCopilotoPanel .msg.user{margin-left:auto;text-align:right}
      #cdsCopilotoPanel .bubble{display:inline-block;padding:8px 10px;border-radius:10px;white-space:pre-wrap;font-size:13px;text-align:left}
      #cdsCopilotoPanel .msg.bot .bubble{background:#fff;border:1px solid #e5e7eb}
      #cdsCopilotoPanel .msg.user .bubble{background:#0f766e;color:#fff}
      #cdsCopilotoPanel .meta{font-size:11px;color:#64748b;margin-top:2px}
    `;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'cdsCopilotoFab';
    fab.type = 'button';
    fab.title = 'CDS Copiloto';
    fab.innerHTML = '<i class="fas fa-robot"></i>';

    const panel = document.createElement('div');
    panel.id = 'cdsCopilotoPanel';
    panel.innerHTML = `
      <div class="cia-head">
        <strong><i class="fas fa-robot me-1"></i>CDS Copiloto</strong>
        <button type="button" class="btn btn-sm btn-light py-0" id="ciaWidgetClose" aria-label="Fechar">×</button>
      </div>
      <div class="cia-quick" id="ciaWidgetQuick"></div>
      <div class="cia-body" id="ciaWidgetChat"></div>
      <div class="cia-foot">
        <input type="text" id="ciaWidgetInput" placeholder="Pergunte ao copiloto…" autocomplete="off">
        <button type="button" class="btn btn-sm btn-success" id="ciaWidgetSend">Enviar</button>
        <button type="button" class="btn btn-sm btn-warning d-none" id="ciaWidgetConfirm">OK</button>
      </div>
    `;

    const host = (opts && opts.container) || document.body;
    host.appendChild(fab);
    host.appendChild(panel);

    const quick = panel.querySelector('#ciaWidgetQuick');
    QUICK.forEach((item) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm btn-outline-secondary';
      b.textContent = item.label;
      b.addEventListener('click', () => enviar(item.q));
      quick.appendChild(b);
    });

    let pendingConfirm = null;
    const chat = panel.querySelector('#ciaWidgetChat');

    const addMsg = (role, text, meta) => {
      const div = document.createElement('div');
      div.className = `msg ${role}`;
      div.innerHTML = `<div class="bubble">${esc(text)}</div>${meta ? `<div class="meta">${esc(meta)}</div>` : ''}`;
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    };

    addMsg('bot', 'Copiloto PDV pronto. Consultas via MIB/CIP — ações críticas pedem confirmação.');

    async function enviar(texto, confirmar) {
      const api = sdk();
      if (!api) {
        addMsg('bot', 'AgentSDK não carregado.');
        return;
      }
      const msg = String(texto || '').trim();
      if (!msg && !confirmar) return;
      if (msg && !confirmar) addMsg('user', msg);
      try {
        const data = await api.chat({
          mensagem: msg || 'confirmar',
          origem,
          confirmar: Boolean(confirmar),
          confirmacao_id: pendingConfirm
        });
        addMsg(
          'bot',
          data.resposta || JSON.stringify(data),
          [
            data.intent ? `intent=${data.intent}` : '',
            data.motores?.length ? data.motores.join(',') : '',
            data.requerConfirmacao ? 'confirmação' : ''
          ]
            .filter(Boolean)
            .join(' · ')
        );
        const btn = panel.querySelector('#ciaWidgetConfirm');
        if (data.requerConfirmacao) {
          pendingConfirm = data.confirmacao_id;
          btn?.classList.remove('d-none');
        } else {
          pendingConfirm = null;
          btn?.classList.add('d-none');
        }
      } catch (e) {
        addMsg('bot', e.message || 'Falha no copiloto');
      }
    }

    fab.addEventListener('click', () => panel.classList.toggle('open'));
    panel.querySelector('#ciaWidgetClose')?.addEventListener('click', () => panel.classList.remove('open'));
    panel.querySelector('#ciaWidgetSend')?.addEventListener('click', () => {
      const input = panel.querySelector('#ciaWidgetInput');
      const v = input?.value;
      if (input) input.value = '';
      enviar(v);
    });
    panel.querySelector('#ciaWidgetInput')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        panel.querySelector('#ciaWidgetSend')?.click();
      }
    });
    panel.querySelector('#ciaWidgetConfirm')?.addEventListener('click', () => enviar('confirmar', true));
  }

  function initCdsCopilotoWidget() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => montarCdsCopilotoWidget());
    } else {
      montarCdsCopilotoWidget();
    }
  }

  global.montarCdsCopilotoWidget = montarCdsCopilotoWidget;
  global.initCdsCopilotoWidget = initCdsCopilotoWidget;
})(typeof window !== 'undefined' ? window : globalThis);
