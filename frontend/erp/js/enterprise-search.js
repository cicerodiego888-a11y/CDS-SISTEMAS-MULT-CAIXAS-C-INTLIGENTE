/**
 * Enterprise Search — dashboard MIB-RC3.0
 */
(function (global) {
  'use strict';

  function api(path, opts) {
    const token = localStorage.getItem('token');
    return fetch(`${global.API_URL}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

  async function carregarEnterpriseSearch() {
    const root = document.getElementById('page-content');
    if (!root) return;
    root.innerHTML = `
      <div class="container-fluid py-3" id="enterpriseSearch">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <div>
            <h2 class="h4 mb-0"><i class="fas fa-globe me-2"></i>Enterprise Search</h2>
            <p class="text-muted small mb-0">Plataforma corporativa de pesquisa · MIB-RC3.0</p>
          </div>
          <div class="btn-group">
            <button type="button" class="btn btn-outline-primary btn-sm" id="esRefresh"><i class="fas fa-sync"></i> Atualizar</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" id="esBench"><i class="fas fa-tachometer-alt"></i> Benchmark</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" id="esRebuild"><i class="fas fa-database"></i> Rebuild índices</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" onclick="typeof loadPage==='function'&&loadPage('mib-analytics')">MIB Analytics</button>
          </div>
        </div>
        <div class="row g-3 mb-3">
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">Pesquisas/min</div><div class="h5" id="esPpm">—</div></div></div></div>
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">Tempo médio</div><div class="h5" id="esTempo">—</div></div></div></div>
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">Cache Hit</div><div class="h5" id="esCache">—</div></div></div></div>
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">Providers</div><div class="h5" id="esProv">—</div></div></div></div>
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">RAM heap</div><div class="h5" id="esRam">—</div></div></div></div>
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">Índices</div><div class="h5" id="esIdx">—</div></div></div></div>
        </div>
        <div class="card mb-3">
          <div class="card-header">Testar pesquisa</div>
          <div class="card-body">
            <div class="row g-2 align-items-end">
              <div class="col-md-3">
                <label class="form-label small">Entidade</label>
                <select class="form-select form-select-sm" id="esEntity">
                  <option value="produto">produto</option>
                  <option value="cliente">cliente</option>
                  <option value="fornecedor">fornecedor</option>
                  <option value="usuario">usuario</option>
                  <option value="categoria">categoria</option>
                  <option value="marca">marca</option>
                  <option value="ncm">ncm</option>
                  <option value="cfop">cfop</option>
                  <option value="financeiro">financeiro</option>
                </select>
              </div>
              <div class="col-md-6">
                <label class="form-label small">Query</label>
                <input type="text" class="form-control form-control-sm" id="esQuery" placeholder="termo de busca">
              </div>
              <div class="col-md-3">
                <button type="button" class="btn btn-primary btn-sm w-100" id="esGo">Pesquisar</button>
              </div>
            </div>
            <pre class="small bg-light border rounded p-2 mt-2 mb-0" id="esOut" style="max-height:220px;overflow:auto">Resultado…</pre>
          </div>
        </div>
        <div class="row g-3">
          <div class="col-lg-6"><div class="card h-100"><div class="card-header">Top pesquisas</div><div class="card-body" id="esTop"></div></div></div>
          <div class="col-lg-6"><div class="card h-100"><div class="card-header">Entidades / Providers</div><div class="card-body" id="esEnt"></div></div></div>
          <div class="col-lg-6"><div class="card h-100"><div class="card-header">Benchmark recente</div><div class="card-body" id="esBenchOut"></div></div></div>
          <div class="col-lg-6"><div class="card h-100"><div class="card-header">Aprendizado / Sinônimos</div><div class="card-body" id="esLearn"></div></div></div>
        </div>
      </div>
    `;

    document.getElementById('esRefresh')?.addEventListener('click', render);
    document.getElementById('esBench')?.addEventListener('click', async () => {
      try {
        await api('/search/benchmark', { method: 'POST', body: '{}' });
        if (typeof global.showNotification === 'function') global.showNotification('Benchmark concluído', 'success');
        render();
      } catch (e) {
        if (typeof global.showNotification === 'function') global.showNotification(e.message, 'danger');
      }
    });
    document.getElementById('esRebuild')?.addEventListener('click', async () => {
      try {
        await api('/search/rebuild', { method: 'POST', body: '{}' });
        if (typeof global.showNotification === 'function') global.showNotification('Rebuild OK', 'success');
        render();
      } catch (e) {
        if (typeof global.showNotification === 'function') global.showNotification(e.message, 'danger');
      }
    });
    document.getElementById('esGo')?.addEventListener('click', async () => {
      try {
        const data = await api('/search', {
          method: 'POST',
          body: JSON.stringify({
            entity: document.getElementById('esEntity')?.value,
            query: document.getElementById('esQuery')?.value
          })
        });
        document.getElementById('esOut').textContent = JSON.stringify(data, null, 2);
        render();
      } catch (e) {
        document.getElementById('esOut').textContent = e.message;
      }
    });

    await render();
  }

  async function render() {
    try {
      const d = await api('/search/enterprise');
      document.getElementById('esPpm').textContent = d.pesquisasPorMinuto ?? '—';
      document.getElementById('esTempo').textContent = `${d.tempoMedio ?? 0} ms`;
      document.getElementById('esCache').textContent = String(d.cacheHits ?? d.cache?.hits ?? 0);
      document.getElementById('esProv').textContent = String(d.providersAtivos ?? 0);
      document.getElementById('esRam').textContent = `${d.ram?.heapUsed ?? '—'} MB`;
      document.getElementById('esIdx').textContent = String(d.indices?.indices ?? '—');

      const top = d.topPesquisas || [];
      document.getElementById('esTop').innerHTML = top.length
        ? `<ul class="list-group list-group-flush">${top.map((t) => `<li class="list-group-item d-flex justify-content-between"><span>${esc(t.entity)} · ${esc(t.query)}</span><span class="badge bg-secondary">${t.count}</span></li>`).join('')}</ul>`
        : '<p class="text-muted small mb-0">Sem dados.</p>';

      const ents = Object.entries(d.porEntidade || {});
      const prov = d.providers || [];
      document.getElementById('esEnt').innerHTML = `
        <p class="small text-muted">Uso: ${ents.map(([k, v]) => `${esc(k)}=${v}`).join(', ') || '—'}</p>
        <ul class="small mb-0">${prov.map((p) => `<li><strong>${esc(p.entity)}</strong> — ${esc((p.aliases || []).slice(0, 4).join(', '))}</li>`).join('')}</ul>
      `;

      const bench = d.benchmark || [];
      document.getElementById('esBenchOut').innerHTML = bench.length
        ? `<table class="table table-sm"><thead><tr><th>Entidade</th><th>Média</th><th>P95</th></tr></thead><tbody>${
          bench.slice(0, 10).map((b) => `<tr><td>${esc(b.entity)}</td><td>${esc(b.tempo_medio_ms)} ms</td><td>${esc(b.tempo_p95_ms)} ms</td></tr>`).join('')
        }</tbody></table>`
        : '<p class="text-muted small mb-0">Execute o benchmark.</p>';

      document.getElementById('esLearn').innerHTML = `
        <p class="mb-1">Aprendizados: <strong>${esc(d.aprendizado?.aprendizados ?? 0)}</strong></p>
        <p class="mb-1">Preferências: <strong>${esc(d.aprendizado?.preferencias ?? 0)}</strong></p>
        <p class="mb-0">Sinônimos: <strong>${esc(d.sinonimos?.pares ?? 0)}</strong></p>
      `;
    } catch (err) {
      if (typeof global.showNotification === 'function') {
        global.showNotification(err.message || 'Falha Enterprise Search', 'danger');
      }
    }
  }

  global.carregarEnterpriseSearch = carregarEnterpriseSearch;
})(window);
