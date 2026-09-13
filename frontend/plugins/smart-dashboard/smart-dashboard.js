(function () {
  'use strict';

  const API = (window.API_URL || '/api') + '/plugins/smart-dashboard';
  let state = { layout: null, cards: null, draftOrder: null };

  function headers() {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      'X-CDS-Origem': window.CDS_MODULE || 'erp'
    };
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function invoke(method, body) {
    const r = await fetch(API + '/invoke', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ method, ...(body || {}) })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || data.code || ('HTTP ' + r.status));
    return data.result != null ? data : data;
  }

  function resultOf(resp) {
    return resp && resp.result != null ? resp.result : resp;
  }

  function renderSituacao(c) {
    return `
      <div class="sd-kpis">
        <div class="sd-kpi"><b>${esc(c.faturamentoHoje)}</b><span>Volume hoje (CIP)</span></div>
        <div class="sd-kpi"><b>${esc(c.meta)}</b><span>Meta (média×1.1)</span></div>
        <div class="sd-kpi"><b>${esc(c.pedidos)}</b><span>Pedidos</span></div>
        <div class="sd-kpi"><b>${esc(c.clientesAtendidos)}</b><span>Clientes atendidos*</span></div>
        <div class="sd-kpi"><b>${esc(c.ticketMedio)}</b><span>Ticket médio*</span></div>
        <div class="sd-kpi"><b>${c.vsOntemPct == null ? '—' : esc(c.vsOntemPct) + '%'}</b><span>vs ontem</span></div>
        <div class="sd-kpi"><b>${c.vsSemanaPct == null ? '—' : esc(c.vsSemanaPct) + '%'}</b><span>vs semana</span></div>
      </div>
      <p class="small text-muted mt-2 mb-0">${esc(c.nota || '')}</p>`;
  }

  function renderAlertas(c) {
    return `<ul class="sd-list">${(c.items || []).map((i) =>
      `<li class="sev-${esc(i.severidade || 'baixa')}"><strong>${esc(i.tipo)}</strong> — ${esc(i.mensagem)}</li>`
    ).join('')}</ul>`;
  }

  function renderOportunidades(c) {
    return `<ul class="sd-list">${(c.items || []).map((i) =>
      `<li><strong>${esc(i.titulo)}</strong> · ${esc(i.qtd)} ${i.nota ? '<span class="text-muted">(' + esc(i.nota) + ')</span>' : ''}</li>`
    ).join('')}</ul>`;
  }

  function renderIa(c) {
    return `
      <div class="sd-ask">
        <input type="text" id="sdAskInput" placeholder="${esc(c.placeholder || 'Pergunte ao CDS')}" />
        <button type="button" class="btn btn-success" id="sdAskBtn">Perguntar</button>
      </div>
      <div class="small text-muted mt-2">${(c.exemplos || []).map((e) =>
        `<button type="button" class="btn btn-link btn-sm p-0 me-2 sd-ex" data-q="${esc(e)}">${esc(e)}</button>`
      ).join('')}</div>
      <div class="sd-answer" id="sdAskAnswer">CIA responde aqui.</div>`;
  }

  function renderPrevisoes(c) {
    return `
      <div class="sd-kpis">
        <div class="sd-kpi"><b>${esc(c.vendaPrevistaHoje)}</b><span>Venda prevista hoje</span></div>
        <div class="sd-kpi"><b>${esc(c.compraNecessaria)}</b><span>Compra necessária</span></div>
        <div class="sd-kpi"><b>${esc(c.fluxoCaixa?.liquidoEstimado7d ?? '—')}</b><span>Fluxo líquido 7d</span></div>
        <div class="sd-kpi"><b>${esc((c.produtosQueFaltarao || []).length)}</b><span>Podem faltar</span></div>
      </div>
      <ul class="sd-list mt-2">${(c.produtosQueFaltarao || []).slice(0, 5).map((p) =>
        `<li>${esc(p.nome || p.produto_id)} · risco ${esc(p.risco)}</li>`
      ).join('')}</ul>`;
  }

  function renderAcoes(c) {
    return `<div class="sd-actions">${(c.items || []).map((a) => {
      const href = a.href || (a.page ? '/erp?page=' + encodeURIComponent(a.page) : '#');
      if (!a.permitido) {
        return `<button type="button" class="btn btn-outline-secondary btn-sm" disabled title="Sem permissão">${esc(a.label)}</button>`;
      }
      return `<a class="btn btn-outline-primary btn-sm" href="${esc(href)}">${esc(a.label)}</a>`;
    }).join('')}</div>`;
  }

  function renderOperacional(c) {
    const h = c.health || {};
    return `
      <div class="sd-kpis">
        <div class="sd-kpi"><b>${c.pdvsOnline == null ? '—' : esc(c.pdvsOnline)}</b><span>PDVs online</span></div>
        <div class="sd-kpi"><b>${c.usuariosConectados == null ? '—' : esc(c.usuariosConectados)}</b><span>Usuários</span></div>
        <div class="sd-kpi"><b>${c.notasEmitidas == null ? '—' : esc(c.notasEmitidas)}</b><span>Notas emitidas</span></div>
        <div class="sd-kpi"><b>${esc(c.erros || 0)}</b><span>Erros / riscos</span></div>
        <div class="sd-kpi"><b>${esc(c.pluginsAtivos || 0)}</b><span>Plugins ativos</span></div>
      </div>
      <p class="small mt-2 mb-0">Health: CIP ${h.cip ? 'OK' : '—'} · MIB ${h.mib ? 'OK' : '—'} · MIIP ${h.miip?.ok ? 'OK' : '—'} · CIA ${h.cia?.codigo || '—'}</p>`;
  }

  function renderInsights(c) {
    return `<ul class="sd-list">${(c.items || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
  }

  const RENDER = {
    situacao: renderSituacao,
    alertas: renderAlertas,
    oportunidades: renderOportunidades,
    ia: renderIa,
    previsoes: renderPrevisoes,
    acoes: renderAcoes,
    operacional: renderOperacional,
    insights: renderInsights
  };

  function renderGrid(dash) {
    const grid = document.getElementById('sdGrid');
    const pinned = new Set(dash.layout?.pinned || []);
    grid.innerHTML = (dash.ordered || []).map((card, idx) => {
      const fn = RENDER[card.id];
      if (!fn) return '';
      return `<article class="sd-card ${pinned.has(card.id) ? 'pinned' : ''}" data-id="${esc(card.id)}" style="animation-delay:${idx * 40}ms">
        <h2><span>${esc(card.titulo)}</span>${pinned.has(card.id) ? '<span class="badge text-bg-success">fixo</span>' : ''}</h2>
        ${fn(card)}
      </article>`;
    }).join('');

    document.getElementById('sdAskBtn')?.addEventListener('click', perguntar);
    document.getElementById('sdAskInput')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') perguntar();
    });
    document.querySelectorAll('.sd-ex').forEach((b) => {
      b.addEventListener('click', () => {
        const input = document.getElementById('sdAskInput');
        if (input) input.value = b.getAttribute('data-q') || '';
        perguntar();
      });
    });
  }

  async function perguntar() {
    const input = document.getElementById('sdAskInput');
    const out = document.getElementById('sdAskAnswer');
    const msg = (input?.value || '').trim();
    if (!msg || !out) return;
    out.textContent = 'Consultando CIA…';
    try {
      const resp = await invoke('ask', { mensagem: msg, origem: 'smart-dashboard' });
      const r = resultOf(resp);
      out.textContent = r.resposta || JSON.stringify(r);
    } catch (e) {
      out.textContent = e.message;
    }
  }

  function renderLayoutEditor(layout) {
    const box = document.getElementById('sdLayoutList');
    state.draftOrder = [...(layout.order || [])];
    const hidden = new Set(layout.hidden || []);
    const pinned = new Set(layout.pinned || []);
    box.innerHTML = state.draftOrder.map((id, i) => `
      <div class="sd-layout-item" data-id="${esc(id)}">
        <strong>${esc(id)}</strong>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-up="${i}">↑</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-down="${i}">↓</button>
        <label class="small"><input type="checkbox" data-hide="${esc(id)}" ${hidden.has(id) ? 'checked' : ''}> ocultar</label>
        <label class="small"><input type="checkbox" data-pin="${esc(id)}" ${pinned.has(id) ? 'checked' : ''}> fixar</label>
      </div>`).join('');

    box.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.getAttribute('data-up'));
      if (i <= 0) return;
      const t = state.draftOrder[i - 1];
      state.draftOrder[i - 1] = state.draftOrder[i];
      state.draftOrder[i] = t;
      renderLayoutEditor({
        order: state.draftOrder,
        hidden: [...box.querySelectorAll('[data-hide]:checked')].map((x) => x.getAttribute('data-hide')),
        pinned: [...box.querySelectorAll('[data-pin]:checked')].map((x) => x.getAttribute('data-pin'))
      });
    }));
    box.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.getAttribute('data-down'));
      if (i >= state.draftOrder.length - 1) return;
      const t = state.draftOrder[i + 1];
      state.draftOrder[i + 1] = state.draftOrder[i];
      state.draftOrder[i] = t;
      renderLayoutEditor({
        order: state.draftOrder,
        hidden: [...box.querySelectorAll('[data-hide]:checked')].map((x) => x.getAttribute('data-hide')),
        pinned: [...box.querySelectorAll('[data-pin]:checked')].map((x) => x.getAttribute('data-pin'))
      });
    }));
  }

  async function load() {
    const banner = document.getElementById('sdBanner');
    try {
      const resp = await invoke('dashboard', {});
      const dash = resultOf(resp);
      state.layout = dash.layout;
      state.cards = dash.cards;
      banner.classList.add('d-none');
      renderGrid(dash);
      if (dash.layout?.modo === 'executivo') await showExec();
    } catch (e) {
      banner.classList.remove('d-none');
      banner.textContent = e.message + ( /PLUGIN_DISABLED|403/.test(e.message)
        ? ' — plugin desligado (feature flag).'
        : ' — faça login no ERP e reabra.');
    }
  }

  async function showExec() {
    const panel = document.getElementById('sdExecPanel');
    try {
      const resp = await invoke('executive', {});
      const ex = resultOf(resp);
      panel.classList.remove('d-none');
      panel.innerHTML = `
        <h2 class="h5">Modo Executivo</h2>
        <div class="sd-kpis">
          <div class="sd-kpi"><b>${esc(ex.financeiro?.valorVencido ?? 0)}</b><span>Inadimplência R$</span></div>
          <div class="sd-kpi"><b>${esc(ex.vendas?.tendencia || '—')}</b><span>Tendência vendas</span></div>
          <div class="sd-kpi"><b>${esc(ex.estoque?.criticos ?? 0)}</b><span>Estoque crítico</span></div>
          <div class="sd-kpi"><b>${esc(ex.lucro?.proxy ?? '—')}</b><span>Fluxo líquido 7d</span></div>
          <div class="sd-kpi"><b>${esc(ex.kpis?.ruptura ?? 0)}</b><span>KPI ruptura</span></div>
          <div class="sd-kpi"><b>${esc(ex.fluxo?.alerta || 'ok')}</b><span>Fluxo</span></div>
        </div>
        <p class="small text-muted mb-0 mt-2">${esc(ex.lucro?.nota || '')}</p>`;
    } catch (e) {
      panel.classList.remove('d-none');
      panel.textContent = e.message;
    }
  }

  document.getElementById('sdRefresh')?.addEventListener('click', load);
  document.getElementById('sdExec')?.addEventListener('click', showExec);
  document.getElementById('sdEdit')?.addEventListener('click', () => {
    const p = document.getElementById('sdLayoutPanel');
    p.classList.toggle('d-none');
    if (!p.classList.contains('d-none') && state.layout) renderLayoutEditor(state.layout);
  });
  document.getElementById('sdSaveLayout')?.addEventListener('click', async () => {
    const box = document.getElementById('sdLayoutList');
    const layout = {
      order: state.draftOrder || state.layout.order,
      hidden: [...box.querySelectorAll('[data-hide]:checked')].map((x) => x.getAttribute('data-hide')),
      pinned: [...box.querySelectorAll('[data-pin]:checked')].map((x) => x.getAttribute('data-pin')),
      modo: 'padrao'
    };
    await invoke('layout', { layout });
    document.getElementById('sdLayoutPanel').classList.add('d-none');
    await load();
  });
  document.getElementById('sdResetLayout')?.addEventListener('click', async () => {
    await invoke('layout', { reset: true });
    document.getElementById('sdLayoutPanel').classList.add('d-none');
    await load();
  });

  load();
})();
