(function () {
  'use strict';

  const API = (window.API_URL || '/api') + '/business-monitor';

  function headers() {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    };
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function get(path) {
    const r = await fetch(API + path, { headers: headers() });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || data.code || ('HTTP ' + r.status));
    return data;
  }

  async function post(path, body) {
    const r = await fetch(API + path, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body || {})
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || data.code || ('HTTP ' + r.status));
    return data;
  }

  function renderItem(e, withActions) {
    return `<div class="bm-item" data-id="${esc(e.id)}">
      <div><span class="p-${esc(e.prioridade)}">[${esc(e.prioridade)}]</span> ${esc(e.mensagem)}</div>
      <div class="meta">${esc(e.monitor)} · ${esc(e.motor)} · ${esc(e.data)} · ${esc(e.status)}
        ${e.impacto ? ' · ' + esc(e.impacto) : ''}</div>
      ${e.sugestao ? `<div class="meta">Sugestão: ${esc(e.sugestao)}</div>` : ''}
      ${withActions && e.status === 'aberto' ? `<div class="actions">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-act="ignorar">Ignorar</button>
        <button type="button" class="btn btn-sm btn-outline-success" data-act="resolver">Resolver</button>
        <button type="button" class="btn btn-sm btn-outline-primary" data-act="tarefa">Criar tarefa</button>
        <button type="button" class="btn btn-sm btn-outline-dark" data-act="abrir">Abrir módulo</button>
        <button type="button" class="btn btn-sm btn-outline-info" data-act="cia">Análise CIA</button>
      </div>` : ''}
    </div>`;
  }

  function bindActions(root) {
    root.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('.bm-item')?.getAttribute('data-id');
        const acao = btn.getAttribute('data-act');
        try {
          const r = await post('/resolve', { id, acao });
          if (acao === 'abrir' && r.abrir?.modulo) {
            const map = {
              vendas: '/erp?page=vendas',
              estoque: '/erp?page=produtos',
              financeiro: '/erp?page=financeiro',
              fiscal: '/erp?page=fiscal',
              clientes: '/erp?page=clientes',
              compras: '/erp?page=compras',
              pdv: '/pdv',
              produtos: '/erp?page=produtos',
              nfe: '/erp?page=nfe',
              caixa: '/erp?page=caixa'
            };
            window.location.href = map[r.abrir.modulo] || '/erp';
            return;
          }
          if (acao === 'cia' && r.cia?.resposta) {
            alert(r.cia.resposta);
          }
          await load();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  function renderMap(el, groups) {
    if (!groups?.length) {
      el.innerHTML = '<p class="text-muted small mb-0">Nenhum item.</p>';
      return;
    }
    el.innerHTML = groups.map((g) =>
      `<div class="mb-2"><strong>${esc(g.chave)}</strong> <span class="bm-chip">${esc(g.qtd)}</span>
        ${(g.items || []).slice(0, 3).map((i) => `<div class="small">${esc(i.mensagem)}</div>`).join('')}
      </div>`
    ).join('');
  }

  async function load() {
    const banner = document.getElementById('bmBanner');
    try {
      const dash = await get('/dashboard');
      banner.classList.add('d-none');
      const st = dash.stats || {};
      const pp = st.porPrioridade || {};
      document.getElementById('bmKpis').innerHTML = [
        ['Abertos', st.abertos || 0],
        ['Críticos', pp.CRITICO || 0],
        ['Altos', pp.ALTO || 0],
        ['Alertas', (dash.alertas || []).length],
        ['Oportunidades', (dash.oportunidades || []).length],
        ['Total eventos', st.total || 0]
      ].map(([k, v], i) =>
        `<div class="bm-kpi" style="animation-delay:${i * 30}ms"><b>${esc(v)}</b><span>${esc(k)}</span></div>`
      ).join('');

      document.getElementById('bmTimeline').innerHTML =
        (dash.timeline || []).map((e) => renderItem(e, false)).join('') || '<p class="text-muted small">Vazio</p>';

      renderMap(document.getElementById('bmRiscos'), dash.mapaRiscos);
      renderMap(document.getElementById('bmOps'), dash.mapaOportunidades);

      const eventsEl = document.getElementById('bmEvents');
      eventsEl.innerHTML =
        (dash.eventos || []).map((e) => renderItem(e, true)).join('') || '<p class="text-muted small">Sem eventos abertos</p>';
      bindActions(eventsEl);

      document.getElementById('bmHist').innerHTML =
        (dash.historico || []).map((e) => renderItem(e, false)).join('') || '<p class="text-muted small">Sem histórico</p>';
    } catch (e) {
      banner.classList.remove('d-none');
      banner.textContent = e.message + (/PLUGIN_DISABLED|403/.test(e.message)
        ? ' — plugin desligado.'
        : ' — faça login no ERP e reabra.');
    }
  }

  document.getElementById('bmRefresh')?.addEventListener('click', load);
  document.getElementById('bmAnalyze')?.addEventListener('click', async () => {
    try {
      await post('/analyze', { force: true });
      await load();
    } catch (e) {
      alert(e.message);
    }
  });

  load();
})();
