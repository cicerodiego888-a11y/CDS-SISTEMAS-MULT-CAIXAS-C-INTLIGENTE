/**
 * CIP Insights — painel de inteligência CDS (RC1.0)
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

  function badge(sev) {
    const map = { alta: 'danger', media: 'warning', baixa: 'secondary' };
    return map[sev] || 'secondary';
  }

  async function carregarCipInsights() {
    const root = document.getElementById('page-content');
    if (!root) return;
    root.innerHTML = `
      <div class="container-fluid py-3" id="cipInsights">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <div>
            <h2 class="h4 mb-0"><i class="fas fa-lightbulb me-2"></i>CIP Insights</h2>
            <p class="text-muted small mb-0">CDS Intelligence Platform · RC1.0</p>
          </div>
          <div class="btn-group">
            <button type="button" class="btn btn-outline-primary btn-sm" id="cipRefresh"><i class="fas fa-sync"></i> Atualizar</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" id="cipAnalyze"><i class="fas fa-brain"></i> Analisar</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" id="cipRebuild"><i class="fas fa-redo"></i> Rebuild</button>
          </div>
        </div>
        <div class="row g-3 mb-3">
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">Estoque crítico</div><div class="h5" id="cipEst">—</div></div></div></div>
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">Zerados</div><div class="h5" id="cipZer">—</div></div></div></div>
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">Contas vencidas</div><div class="h5" id="cipVen">—</div></div></div></div>
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">Tendência vendas</div><div class="h5" id="cipTend">—</div></div></div></div>
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">Regras</div><div class="h5" id="cipReg">—</div></div></div></div>
          <div class="col-md-2"><div class="card"><div class="card-body"><div class="text-muted small">MIB nós</div><div class="h5" id="cipMib">—</div></div></div></div>
        </div>
        <div class="row g-3">
          <div class="col-lg-6"><div class="card h-100"><div class="card-header">Riscos</div><div class="card-body" id="cipRiscos"></div></div></div>
          <div class="col-lg-6"><div class="card h-100"><div class="card-header">Oportunidades</div><div class="card-body" id="cipOp"></div></div></div>
          <div class="col-lg-6"><div class="card h-100"><div class="card-header">Previsões</div><div class="card-body" id="cipPrev"></div></div></div>
          <div class="col-lg-6"><div class="card h-100"><div class="card-header">Recomendações</div><div class="card-body" id="cipRec"></div></div></div>
        </div>
      </div>
    `;

    document.getElementById('cipRefresh')?.addEventListener('click', () => render(true));
    document.getElementById('cipAnalyze')?.addEventListener('click', async () => {
      try {
        await api('/intelligence/analyze', {
          method: 'POST',
          body: JSON.stringify({ origem: 'erp', dryRun: false })
        });
        if (typeof global.showNotification === 'function') {
          global.showNotification('Análise CIP concluída', 'success');
        }
        render(true);
      } catch (e) {
        if (typeof global.showNotification === 'function') global.showNotification(e.message, 'danger');
      }
    });
    document.getElementById('cipRebuild')?.addEventListener('click', async () => {
      try {
        await api('/intelligence/rebuild', {
          method: 'POST',
          body: JSON.stringify({ origem: 'erp', dryRun: true })
        });
        render(true);
      } catch (e) {
        if (typeof global.showNotification === 'function') global.showNotification(e.message, 'danger');
      }
    });

    await render(true);
  }

  function lista(items) {
    if (!items?.length) return '<p class="text-muted small mb-0">Nenhum item.</p>';
    return `<ul class="list-group list-group-flush small">${items.map((i) => `
      <li class="list-group-item">
        <span class="badge bg-${badge(i.severidade)} me-1">${esc(i.severidade || '')}</span>
        <strong>${esc(i.titulo)}</strong>
        <div class="text-muted">${esc(i.mensagem)}</div>
        <div class="text-muted" style="font-size:11px">${esc(i.fonte || '')}</div>
      </li>`).join('')}</ul>`;
  }

  async function render(force) {
    try {
      const [insights, recs, forecast] = await Promise.all([
        api(`/intelligence/insights${force ? '?force=1' : ''}`),
        api('/intelligence/recommendations'),
        api('/intelligence/forecast')
      ]);
      const r = insights.resumo || {};
      document.getElementById('cipEst').textContent = r.estoqueCritico ?? '—';
      document.getElementById('cipZer').textContent = r.produtosZerados ?? '—';
      document.getElementById('cipVen').textContent = r.contasVencidas ?? '—';
      document.getElementById('cipTend').textContent = r.tendenciaVendas ?? forecast?.vendas?.tendencia ?? '—';
      document.getElementById('cipReg').textContent = r.regras ?? '—';
      document.getElementById('cipMib').textContent = r.mibNos ?? '—';

      document.getElementById('cipRiscos').innerHTML = lista(insights.riscos);
      document.getElementById('cipOp').innerHTML = lista(insights.oportunidades);
      document.getElementById('cipPrev').innerHTML = lista(insights.previsoes);
      document.getElementById('cipRec').innerHTML = lista((recs.items || []).slice(0, 12));
    } catch (err) {
      if (typeof global.showNotification === 'function') {
        global.showNotification(err.message || 'Falha CIP Insights', 'danger');
      }
    }
  }

  global.carregarCipInsights = carregarCipInsights;
})(window);
