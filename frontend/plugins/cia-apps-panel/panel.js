(function () {
  'use strict';

  const API = (window.API_URL || '/api') + '/plugins';

  function headers() {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    };
  }

  async function get(path) {
    const r = await fetch(API + path, { headers: headers() });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
    return data;
  }

  async function post(path, body) {
    const r = await fetch(API + path, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body || {})
    });
    return r.json();
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  async function toggle(id, on) {
    await post('/' + id + '/' + (on ? 'enable' : 'disable'), { scope: 'global' });
    await render();
  }

  async function restart(id) {
    await post('/' + id + '/restart', {});
    await render();
  }

  async function render() {
    const dash = await get('/dashboard');
    const kpi = document.getElementById('kpi');
    const ativos = (dash.plugins || []).filter((p) => p.enabled && p.loaded).length;
    kpi.innerHTML = [
      ['Versão', dash.codigo + ' · ' + dash.versao],
      ['Ativos', String(ativos)],
      ['Memória', (dash.memoriaMb || 0) + ' MB'],
      ['Execuções', String(dash.logs?.total || 0)],
      ['Erros', String(dash.logs?.erros || 0)]
    ].map(([k, v]) => `
      <div class="col-6 col-md">
        <div class="card-soft p-3 h-100">
          <div class="text-muted small">${esc(k)}</div>
          <div class="fs-5 fw-semibold">${esc(v)}</div>
        </div>
      </div>`).join('');

    const rows = (dash.plugins || []).map((p) => `
      <tr>
        <td><strong>${esc(p.name)}</strong><div class="mono text-muted">${esc(p.id)} v${esc(p.version)}</div></td>
        <td>${(p.motors || []).map((m) => '<span class="pill me-1">' + esc(m) + '</span>').join('')}</td>
        <td><span class="pill ${p.enabled ? '' : 'off'}">${p.enabled ? 'ON' : 'OFF'}</span>
            ${p.loaded ? '' : '<span class="pill off ms-1">não carregado</span>'}</td>
        <td class="mono">${esc(p.stats?.calls || 0)} calls · ${esc(p.stats?.errors || 0)} err · ${Math.round(p.stats?.totalMs || 0)}ms</td>
        <td class="text-nowrap">
          <button class="btn btn-sm btn-outline-success" data-on="${esc(p.id)}">Ligar</button>
          <button class="btn btn-sm btn-outline-danger" data-off="${esc(p.id)}">Desligar</button>
          <button class="btn btn-sm btn-outline-secondary" data-rst="${esc(p.id)}">Restart</button>
        </td>
      </tr>`).join('');

    document.getElementById('plugins').innerHTML = `
      <table class="table table-sm align-middle mb-0">
        <thead><tr><th>Plugin</th><th>Motores</th><th>Status</th><th>Uso</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5">Nenhum plugin</td></tr>'}</tbody>
      </table>`;

    document.querySelectorAll('[data-on]').forEach((b) => b.addEventListener('click', () => toggle(b.getAttribute('data-on'), true)));
    document.querySelectorAll('[data-off]').forEach((b) => b.addEventListener('click', () => toggle(b.getAttribute('data-off'), false)));
    document.querySelectorAll('[data-rst]').forEach((b) => b.addEventListener('click', () => restart(b.getAttribute('data-rst'))));

    document.getElementById('logs').textContent = JSON.stringify({
      flags: dash.flags,
      recentes: dash.recentes
    }, null, 2);
  }

  document.getElementById('btnRefresh')?.addEventListener('click', () => render().catch((e) => alert(e.message)));
  render().catch((e) => {
    document.getElementById('logs').textContent = e.message + '\nFaça login no ERP e reabra este painel.';
  });
})();
