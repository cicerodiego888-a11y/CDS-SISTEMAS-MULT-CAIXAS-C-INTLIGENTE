/**
 * Knowledge Center — MIB-RC4.0
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

  async function carregarKnowledgeCenter() {
    const root = document.getElementById('page-content');
    if (!root) return;
    root.innerHTML = `
      <div class="container-fluid py-3" id="knowledgeCenter">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <div>
            <h2 class="h4 mb-0"><i class="fas fa-project-diagram me-2"></i>Knowledge Center</h2>
            <p class="text-muted small mb-0">Motor de Conhecimento · MIB-RC4.0</p>
          </div>
          <div class="btn-group">
            <button type="button" class="btn btn-outline-primary btn-sm" id="kcRefresh"><i class="fas fa-sync"></i> Atualizar</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" id="kcRebuild"><i class="fas fa-sitemap"></i> Rebuild grafo</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" onclick="typeof loadPage==='function'&&loadPage('enterprise-search')">Enterprise Search</button>
          </div>
        </div>
        <div class="row g-3 mb-3">
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">Nós</div><div class="h5" id="kcNos">—</div></div></div></div>
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">Arestas</div><div class="h5" id="kcArestas">—</div></div></div></div>
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">Clusters</div><div class="h5" id="kcClusters">—</div></div></div></div>
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">Órfãos</div><div class="h5" id="kcOrfaos">—</div></div></div></div>
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">Sem categoria</div><div class="h5" id="kcSemCat">—</div></div></div></div>
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">Duplicados</div><div class="h5" id="kcDups">—</div></div></div></div>
        </div>
        <div class="card mb-3">
          <div class="card-header">Recomendações por produto</div>
          <div class="card-body">
            <div class="input-group input-group-sm mb-2" style="max-width:420px">
              <input type="number" class="form-control" id="kcProdId" placeholder="produto_id">
              <button class="btn btn-primary" type="button" id="kcRec">Recomendar</button>
            </div>
            <pre class="small bg-light border rounded p-2 mb-0" id="kcRecOut" style="max-height:180px;overflow:auto">—</pre>
          </div>
        </div>
        <div class="row g-3">
          <div class="col-lg-6"><div class="card h-100"><div class="card-header">Top relações</div><div class="card-body" id="kcTop"></div></div></div>
          <div class="col-lg-6"><div class="card h-100"><div class="card-header">Clusters</div><div class="card-body" id="kcClu"></div></div></div>
          <div class="col-lg-6"><div class="card h-100"><div class="card-header">Duplicados (amostra)</div><div class="card-body" id="kcDupList"></div></div></div>
          <div class="col-lg-6"><div class="card h-100"><div class="card-header">Mapa do conhecimento</div><div class="card-body" id="kcMap"></div></div></div>
        </div>
      </div>
    `;

    document.getElementById('kcRefresh')?.addEventListener('click', render);
    document.getElementById('kcRebuild')?.addEventListener('click', async () => {
      try {
        document.getElementById('kcMap').textContent = 'Reconstruindo grafo…';
        const r = await api('/search/graph/rebuild', { method: 'POST', body: JSON.stringify({ leve: false }) });
        if (typeof global.showNotification === 'function') {
          global.showNotification(`Grafo OK · ${r.nos} nós · ${r.arestas} arestas`, 'success');
        }
        render();
      } catch (e) {
        if (typeof global.showNotification === 'function') global.showNotification(e.message, 'danger');
      }
    });
    document.getElementById('kcRec')?.addEventListener('click', async () => {
      try {
        const id = document.getElementById('kcProdId')?.value;
        const data = await api(`/search/recommendations?produto_id=${encodeURIComponent(id)}`);
        document.getElementById('kcRecOut').textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        document.getElementById('kcRecOut').textContent = e.message;
      }
    });

    await render();
  }

  async function render() {
    try {
      const d = await api('/search/knowledge');
      document.getElementById('kcNos').textContent = d.graph?.nos ?? '—';
      document.getElementById('kcArestas').textContent = d.graph?.arestas ?? '—';
      document.getElementById('kcClusters').textContent = d.graph?.clusters ?? '—';
      document.getElementById('kcOrfaos').textContent = d.orfaos ?? '—';
      document.getElementById('kcSemCat').textContent = d.semCategoria ?? '—';
      document.getElementById('kcDups').textContent = d.duplicados?.produtos ?? '—';

      const top = d.topRelacoes || [];
      document.getElementById('kcTop').innerHTML = top.length
        ? `<ul class="list-group list-group-flush small">${top.map((e) =>
          `<li class="list-group-item">${esc(e.from_label)} <span class="text-muted">${esc(e.relacao)}</span> ${esc(e.to_label)} <span class="badge bg-secondary">${esc(e.peso)}</span></li>`
        ).join('')}</ul>`
        : '<p class="text-muted small mb-0">Sem relações. Execute Rebuild.</p>';

      const clu = d.clusters || [];
      document.getElementById('kcClu').innerHTML = clu.length
        ? `<ul class="small mb-0">${clu.map((c) => `<li><strong>${esc(c.nome)}</strong> — ${esc(c.tamanho)} produtos</li>`).join('')}</ul>`
        : '<p class="text-muted small mb-0">Sem clusters.</p>';

      const amostra = d.duplicados?.amostra || [];
      document.getElementById('kcDupList').innerHTML = amostra.length
        ? `<ul class="small mb-0">${amostra.map((x) =>
          `<li>${esc(x.tipo)} · ${esc((x.itens || []).map((i) => i.nome).join(' ↔ '))}</li>`
        ).join('')}</ul>`
        : '<p class="text-muted small mb-0">Nenhum duplicado detectado.</p>';

      const tipos = d.graph?.tipos || {};
      document.getElementById('kcMap').innerHTML = `
        <p class="small mb-1">Produtos: ${esc(d.totalProdutos)} · Sem marca: ${esc(d.semMarca)} · Sem fornecedor: ${esc(d.semFornecedor)}</p>
        <ul class="small mb-0">${Object.entries(tipos).map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join('')}</ul>
      `;
    } catch (err) {
      if (typeof global.showNotification === 'function') {
        global.showNotification(err.message || 'Falha Knowledge Center', 'danger');
      }
    }
  }

  global.carregarKnowledgeCenter = carregarKnowledgeCenter;
})(window);
