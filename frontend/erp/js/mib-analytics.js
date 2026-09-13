/**
 * MIB Analytics — dashboard cognitivo RC2.0
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

  function tabela(rows, cols) {
    if (!rows?.length) return '<p class="text-muted small mb-0">Sem dados.</p>';
    const head = cols.map((c) => `<th>${esc(c.label)}</th>`).join('');
    const body = rows.map((row) => {
      const tds = cols.map((c) => `<td>${esc(typeof c.get === 'function' ? c.get(row) : row[c.key])}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    return `<div class="table-responsive"><table class="table table-sm table-striped"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  async function carregar() {
    const root = document.getElementById('page-content');
    if (!root) return;
    root.innerHTML = `
      <div class="container-fluid py-3" id="mibAnalytics">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <div>
            <h2 class="h4 mb-0"><i class="fas fa-brain me-2"></i>MIB Analytics</h2>
            <p class="text-muted small mb-0">Motor Cognitivo de Busca · RC2.0</p>
          </div>
          <div class="btn-group">
            <button type="button" class="btn btn-outline-primary btn-sm" id="mibAnRefresh"><i class="fas fa-sync"></i> Atualizar</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" id="mibAnRetrain"><i class="fas fa-graduation-cap"></i> Retrain</button>
            <button type="button" class="btn btn-outline-danger btn-sm" id="mibAnReset"><i class="fas fa-trash"></i> Reset aprendizado</button>
          </div>
        </div>
        <div class="row g-3 mb-3" id="mibAnKpis">
          <div class="col-md-3"><div class="card"><div class="card-body"><div class="text-muted small">Tempo médio</div><div class="h4" id="kpiTempo">—</div></div></div></div>
          <div class="col-md-3"><div class="card"><div class="card-body"><div class="text-muted small">Taxa de acerto</div><div class="h4" id="kpiAcerto">—</div></div></div></div>
          <div class="col-md-3"><div class="card"><div class="card-body"><div class="text-muted small">Cache Hit</div><div class="h4" id="kpiCache">—</div></div></div></div>
          <div class="col-md-3"><div class="card"><div class="card-body"><div class="text-muted small">Aprendizados</div><div class="h4" id="kpiLearn">—</div></div></div></div>
        </div>
        <div class="row g-3">
          <div class="col-lg-6"><div class="card h-100"><div class="card-header">Top Pesquisas</div><div class="card-body" id="tblTop"></div></div></div>
          <div class="col-lg-6"><div class="card h-100"><div class="card-header">Produtos Não Encontrados</div><div class="card-body" id="tblNf"></div></div></div>
          <div class="col-lg-6"><div class="card h-100"><div class="card-header">Ranking Operadores</div><div class="card-body" id="tblOp"></div></div></div>
          <div class="col-lg-6"><div class="card h-100"><div class="card-header">Sinônimos</div><div class="card-body">
            <div class="input-group input-group-sm mb-2">
              <input type="text" class="form-control" id="synTermo" placeholder="termo">
              <input type="text" class="form-control" id="synSinonimo" placeholder="sinônimo">
              <button class="btn btn-primary" type="button" id="btnAddSyn">Adicionar</button>
            </div>
            <div id="tblSyn"></div>
          </div></div></div>
        </div>
      </div>
    `;

    document.getElementById('mibAnRefresh')?.addEventListener('click', renderDados);
    document.getElementById('mibAnRetrain')?.addEventListener('click', async () => {
      try {
        await api('/produtos/mib/retrain', { method: 'POST', body: '{}' });
        if (typeof global.showNotification === 'function') global.showNotification('Retrain concluído', 'success');
        renderDados();
      } catch (e) {
        if (typeof global.showNotification === 'function') global.showNotification(e.message, 'danger');
      }
    });
    document.getElementById('mibAnReset')?.addEventListener('click', async () => {
      if (!confirm('Zerar todo o aprendizado do MIB?')) return;
      try {
        await api('/produtos/mib/reset-learning', { method: 'POST', body: '{}' });
        if (typeof global.showNotification === 'function') global.showNotification('Aprendizado resetado', 'success');
        renderDados();
      } catch (e) {
        if (typeof global.showNotification === 'function') global.showNotification(e.message, 'danger');
      }
    });
    document.getElementById('btnAddSyn')?.addEventListener('click', async () => {
      try {
        await api('/produtos/mib/synonym', {
          method: 'POST',
          body: JSON.stringify({
            termo: document.getElementById('synTermo')?.value,
            sinonimo: document.getElementById('synSinonimo')?.value
          })
        });
        document.getElementById('synTermo').value = '';
        document.getElementById('synSinonimo').value = '';
        renderDados();
      } catch (e) {
        if (typeof global.showNotification === 'function') global.showNotification(e.message, 'danger');
      }
    });

    await renderDados();
  }

  async function renderDados() {
    try {
      const [a, syn] = await Promise.all([
        api('/produtos/mib/analytics'),
        api('/produtos/mib/synonym')
      ]);
      document.getElementById('kpiTempo').textContent = `${a.tempoMedio ?? 0} ms`;
      document.getElementById('kpiAcerto').textContent = `${a.taxaAcerto ?? 0}%`;
      document.getElementById('kpiCache').textContent = String(a.cacheHit ?? 0);
      document.getElementById('kpiLearn').textContent = String(a.aprendizados ?? 0);

      document.getElementById('tblTop').innerHTML = tabela(a.topPesquisas, [
        { label: 'Termo', key: 'termo' },
        { label: 'Qtd', key: 'count' }
      ]);
      document.getElementById('tblNf').innerHTML = tabela(a.produtosNaoEncontrados, [
        { label: 'Termo', key: 'termo' },
        { label: 'Qtd', key: 'count' }
      ]);
      document.getElementById('tblOp').innerHTML = tabela(a.rankingOperadores, [
        { label: 'Operador', key: 'operador_id' },
        { label: 'Pesquisas', key: 'pesquisas' },
        { label: 'Acertos', key: 'acertos' }
      ]);
      document.getElementById('tblSyn').innerHTML = tabela(syn, [
        { label: 'Termo', key: 'termo' },
        { label: 'Sinônimo', key: 'sinonimo' },
        { label: 'Origem', key: 'origem' }
      ]);
    } catch (err) {
      if (typeof global.showNotification === 'function') {
        global.showNotification(err.message || 'Falha ao carregar analytics', 'danger');
      }
    }
  }

  global.carregarMibAnalytics = carregar;
})(window);
