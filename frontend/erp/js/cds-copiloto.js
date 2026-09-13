/**
 * CDS Copiloto — interface do CIA (ERP)
 */
(function (global) {
  'use strict';

  function agent() {
    return global.CdsAgentSDK || global.AgentSDK;
  }

  function api(path, opts) {
    const token = localStorage.getItem('token');
    return fetch(`${global.API_URL}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-CDS-Origem': 'erp',
        'X-CDS-Session': localStorage.getItem('cia_sessao') || 'erp-default',
        ...(opts && opts.headers)
      }
    }).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      return data;
    });
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  let pendingConfirm = null;

  async function carregarCdsCopiloto() {
    if (!localStorage.getItem('cia_sessao')) {
      localStorage.setItem('cia_sessao', `erp-${Date.now()}`);
    }

    const root = document.getElementById('page-content');
    if (!root) return;
    root.innerHTML = `
      <div class="container-fluid py-3" id="cdsCopiloto" style="max-width:920px">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <div>
            <h2 class="h4 mb-0"><i class="fas fa-robot me-2"></i>CDS Copiloto</h2>
            <p class="text-muted small mb-0">CIA — Intelligence Agent · RC1.0</p>
          </div>
          <div class="btn-group">
            <button type="button" class="btn btn-outline-secondary btn-sm" id="ciaStatus">Status</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" id="ciaTools">Tools</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" id="ciaClear">Limpar</button>
          </div>
        </div>
        <div class="mb-2" id="ciaQuick">
          <button type="button" class="btn btn-sm btn-outline-primary me-1 mb-1" data-q="Produtos sem estoque">Sem estoque</button>
          <button type="button" class="btn btn-sm btn-outline-primary me-1 mb-1" data-q="Previsão de vendas">Previsão</button>
          <button type="button" class="btn btn-sm btn-outline-primary me-1 mb-1" data-q="Quem está inadimplente?">Inadimplentes</button>
          <button type="button" class="btn btn-sm btn-outline-primary me-1 mb-1" data-q="Buscar produto coca">Buscar coca</button>
          <button type="button" class="btn btn-sm btn-outline-primary me-1 mb-1" data-q="ajuda">Ajuda</button>
        </div>
        <div id="ciaChat" class="border rounded p-3 mb-3 bg-light" style="height:420px;overflow:auto"></div>
        <div class="input-group">
          <input type="text" class="form-control" id="ciaInput" placeholder="Pergunte ao copiloto…">
          <button class="btn btn-primary" type="button" id="ciaSend">Enviar</button>
          <button class="btn btn-warning d-none" type="button" id="ciaConfirm">Confirmar ação</button>
        </div>
        <pre class="small text-muted mt-2 mb-0" id="ciaMeta"></pre>
      </div>
    `;

    const chat = document.getElementById('ciaChat');
    const addMsg = (role, text, meta) => {
      const div = document.createElement('div');
      div.className = `mb-2 ${role === 'user' ? 'text-end' : ''}`;
      div.innerHTML = `
        <div class="d-inline-block text-start px-3 py-2 rounded ${role === 'user' ? 'bg-primary text-white' : 'bg-white border'}" style="max-width:85%;white-space:pre-wrap">${esc(text)}</div>
        ${meta ? `<div class="small text-muted mt-1">${esc(meta)}</div>` : ''}
      `;
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    };

    addMsg('bot', 'Olá! Sou o CDS Copiloto. Posso consultar MIB, CIP e MIIP por você — sem substituir os motores.');

    const enviar = async (texto, confirmar) => {
      const msg = String(texto || '').trim();
      if (!msg && !confirmar) return;
      if (msg) addMsg('user', msg);
      try {
        const body = {
          mensagem: msg || 'confirmar',
          origem: 'erp',
          confirmar: Boolean(confirmar),
          confirmacao_id: pendingConfirm
        };
        const data = agent()
          ? await agent().chat(body)
          : await api('/agent/chat', { method: 'POST', body: JSON.stringify(body) });
        addMsg('bot', data.resposta || JSON.stringify(data), [
          data.intent ? `intent=${data.intent}` : '',
          data.motores?.length ? `motores=${data.motores.join(',')}` : '',
          data.tempoMs != null ? `${data.tempoMs}ms` : '',
          data.bloqueado ? 'bloqueado' : '',
          data.requerConfirmacao ? 'aguardando confirmação' : ''
        ].filter(Boolean).join(' · '));

        document.getElementById('ciaMeta').textContent = data.plano
          ? `Plano: ${(data.plano.steps || []).map((s) => s.tool).join(' → ')}`
          : '';

        const btnConf = document.getElementById('ciaConfirm');
        if (data.requerConfirmacao) {
          pendingConfirm = data.confirmacao_id;
          btnConf?.classList.remove('d-none');
        } else {
          pendingConfirm = null;
          btnConf?.classList.add('d-none');
        }

        if (data.sugestoes?.length) {
          // refresh quick chips lightly
        }
      } catch (e) {
        addMsg('bot', e.message || 'Falha no copiloto');
      }
    };

    document.getElementById('ciaSend')?.addEventListener('click', () => {
      const input = document.getElementById('ciaInput');
      const v = input?.value;
      if (input) input.value = '';
      enviar(v);
    });
    document.getElementById('ciaInput')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        document.getElementById('ciaSend')?.click();
      }
    });
    document.getElementById('ciaConfirm')?.addEventListener('click', () => enviar('confirmar', true));
    document.getElementById('ciaClear')?.addEventListener('click', () => {
      chat.innerHTML = '';
      addMsg('bot', 'Histórico visual limpo. Sessão mantida.');
    });
    document.getElementById('ciaStatus')?.addEventListener('click', async () => {
      try {
        const s = agent() ? await agent().status() : await api('/agent/status');
        addMsg('bot', `CIA ${s.codigo} v${s.versao} — ${s.tools} tools`);
      } catch (e) {
        addMsg('bot', e.message);
      }
    });
    document.getElementById('ciaTools')?.addEventListener('click', async () => {
      try {
        const tools = agent() ? await agent().tools() : await api('/agent/tools');
        addMsg('bot', (tools || []).map((t) => `${t.name} (${t.motor})`).join('\n'));
      } catch (e) {
        addMsg('bot', e.message);
      }
    });
    document.querySelectorAll('#ciaQuick [data-q]').forEach((btn) => {
      btn.addEventListener('click', () => enviar(btn.getAttribute('data-q')));
    });
  }

  global.carregarCdsCopiloto = carregarCdsCopiloto;
})(window);
