/**
 * RC12.3 — Dashboard Oficial de Observabilidade (READ-ONLY).
 * Consome exclusivamente GET /api/observabilidade/summary.
 * Acesso: SUPER_ADMIN.
 */
(function (global) {
  'use strict';

  const KPI_DEFS = [
    { key: 'boot', title: 'Boot', unit: 'ms' },
    { key: 'login', title: 'Login', unit: 'ms' },
    { key: 'erp', title: 'ERP', unit: 'ms' },
    { key: 'miip', title: 'MIIP', unit: 'ms' },
    { key: 'nfe', title: 'NF-e', unit: 'ms' },
    { key: 'central', title: 'Central', unit: 'ms' },
    { key: 'recursos', title: 'Recursos', unit: 'mixed' }
  ];

  let timer = null;
  let carregando = false;

  function apiBase() {
    if (typeof global.API_URL === 'string' && global.API_URL.trim()) {
      return global.API_URL.replace(/\/$/, '');
    }
    return `${global.location.origin}/api`;
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtMs(v) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    const n = Number(v);
    if (n < 1000) return `${n.toFixed(n < 10 ? 1 : 0)} ms`;
    return `${(n / 1000).toFixed(2)} s`;
  }

  function fmtNum(v, suffix) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return `${Number(v).toFixed(Number(v) >= 100 ? 0 : 1)}${suffix || ''}`;
  }

  function statusLabel(status, labels) {
    if (labels && labels[status]) return labels[status];
    if (status === 'saudavel') return 'Saudável';
    if (status === 'atencao') return 'Atenção';
    if (status === 'critico') return 'Crítico';
    return status || '—';
  }

  function statusEmoji(status) {
    if (status === 'saudavel') return '🟢';
    if (status === 'atencao') return '🟡';
    if (status === 'critico') return '🔴';
    return '⚪';
  }

  function renderKpiCard(def, kpi, domainStatus) {
    const st = domainStatus || 'saudavel';
    if (def.key === 'recursos') {
      return `
        <div class="col-6 col-md-4 col-xl">
          <div class="cds-obs-kpi" data-status="${esc(st)}">
            <div class="cds-obs-kpi__title">${esc(def.title)} ${statusEmoji(st)}</div>
            <div class="cds-obs-kpi__atual">${fmtNum(kpi && kpi.atual_rss_mb, ' MB')} RSS</div>
            <div class="cds-obs-kpi__grid">
              <span>Heap</span><span>${fmtNum(kpi && kpi.atual_heap_mb, ' MB')}</span>
              <span>CPU</span><span>${fmtNum(kpi && kpi.atual_cpu, '%')}</span>
              <span>EL p95</span><span>${fmtMs(kpi && kpi.event_loop && kpi.event_loop.p95)}</span>
              <span>EL máx</span><span>${fmtMs(kpi && kpi.event_loop && kpi.event_loop.maximo)}</span>
            </div>
          </div>
        </div>`;
    }

    return `
      <div class="col-6 col-md-4 col-xl">
        <div class="cds-obs-kpi" data-status="${esc(st)}">
          <div class="cds-obs-kpi__title">${esc(def.title)} ${statusEmoji(st)}</div>
          <div class="cds-obs-kpi__atual">${fmtMs(kpi && kpi.atual)}</div>
          <div class="cds-obs-kpi__grid">
            <span>Média</span><span>${fmtMs(kpi && kpi.media)}</span>
            <span>p50</span><span>${fmtMs(kpi && kpi.p50)}</span>
            <span>p95</span><span>${fmtMs(kpi && kpi.p95)}</span>
            <span>Máx</span><span>${fmtMs(kpi && kpi.maximo)}</span>
          </div>
        </div>
      </div>`;
  }

  function setText(sel, text) {
    const el = document.querySelector(sel);
    if (el) el.textContent = text;
  }

  function renderDomainBlock(elId, block) {
    const el = document.getElementById(elId);
    if (!el) return;
    const d = block && block.duration_ms ? block.duration_ms : {};
    el.innerHTML = `
      Eventos: <strong>${esc(block && block.events_total != null ? block.events_total : 0)}</strong><br>
      Atual: ${esc(fmtMs(d.last))} · Média: ${esc(fmtMs(d.avg))}<br>
      p50: ${esc(fmtMs(d.p50))} · p95: ${esc(fmtMs(d.p95))} · Máx: ${esc(fmtMs(d.max))}
    `;
  }

  function renderRecent(rows) {
    const tbody = document.getElementById('cdsObsRecentBody');
    if (!tbody) return;
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Sem eventos</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td>${esc((r.timestamp || '').replace('T', ' ').slice(0, 19))}</td>
        <td><span class="cds-obs-pill">${esc(r.grupo)}</span></td>
        <td><code>${esc(r.event_name)}</code></td>
        <td>${esc(r.nivel || '—')}</td>
        <td>${esc(fmtMs(r.duracao_ms))}</td>
        <td class="small text-muted">${esc(r.origem || '—')}</td>
      </tr>
    `).join('');
  }

  function sevBadge(sev) {
    const s = String(sev || 'media').toLowerCase();
    const map = {
      critica: 'bg-dark',
      alta: 'bg-danger',
      media: 'bg-warning text-dark',
      baixa: 'bg-secondary'
    };
    return `<span class="badge ${map[s] || 'bg-secondary'}">${esc(s)}</span>`;
  }

  function renderAlerts(rows) {
    const tbody = document.getElementById('cdsObsAlertsBody');
    if (!tbody) return;
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">Nenhum alerta</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((a) => `
      <tr>
        <td>${esc(String(a.last_seen_at || a.created_at || '').replace('T', ' ').slice(0, 19))}</td>
        <td>${sevBadge(a.severidade)}</td>
        <td><code>${esc(a.rule)}</code></td>
        <td>
          <div>${esc(a.titulo || a.rule)}</div>
          <div class="small text-muted">${esc(a.mensagem || '')}</div>
        </td>
        <td>${esc(a.metric_value != null ? a.metric_value : '—')}</td>
        <td>${esc(a.occurrences != null ? a.occurrences : 1)}</td>
        <td>${esc(a.status || 'ativo')}</td>
      </tr>
    `).join('');
  }

  function applyAlertCounters(summary) {
    const por = (summary && summary.por_severidade) || {};
    setText('#cdsObsAlertAtivos', String((summary && summary.ativos) != null ? summary.ativos : 0));
    setText('#cdsObsAlertCount', String((summary && summary.ativos) != null ? summary.ativos : 0));
    setText('#cdsObsAlertCrit', String(por.critica || 0));
    setText('#cdsObsAlertAlta', String(por.alta || 0));
    setText('#cdsObsAlertMedia', String(por.media || 0));
    setText('#cdsObsAlertBaixa', String(por.baixa || 0));
    setText('#cdsObsAlertHist', String((summary && summary.historico_total) != null ? summary.historico_total : 0));
  }

  async function carregarAlerts() {
    try {
      const sev = (document.getElementById('cdsObsAlertSev') || {}).value || '';
      const status = (document.getElementById('cdsObsAlertStatus') || {}).value || 'ativo';
      const params = new URLSearchParams({ status, limit: '50' });
      if (sev) params.set('severidade', sev);

      const headers = { Authorization: `Bearer ${localStorage.getItem('token') || ''}` };
      const [listRes, sumRes] = await Promise.all([
        fetch(`${apiBase()}/observabilidade/alerts?${params.toString()}`, { headers }),
        fetch(`${apiBase()}/observabilidade/alerts/summary`, { headers })
      ]);
      const listData = await listRes.json().catch(() => ({}));
      const sumData = await sumRes.json().catch(() => ({}));
      if (listRes.ok && listData.ok !== false) {
        renderAlerts(listData.alerts || []);
      }
      if (sumRes.ok && sumData.ok !== false) {
        applyAlertCounters(sumData);
      }
    } catch (_) {
      /* alertas não bloqueiam o dashboard */
    }
  }

  function applySummary(data) {
    const status = data.status || {};
    const kpis = data.kpis || {};
    const por = status.por_dominio || {};

    setText('#cdsObsSchema', data.versao_schema || 'obs.v1');
    setText('#cdsObsGeradoEm', data.gerado_em
      ? `Atualizado: ${String(data.gerado_em).replace('T', ' ').slice(0, 19)}`
      : '—');

    const geral = status.geral || 'saudavel';
    const dot = document.querySelector('#cdsObsStatusGeral .cds-obs-dot');
    if (dot) dot.setAttribute('data-status', geral);
    setText('#cdsObsStatusLabel', `${statusEmoji(geral)} ${statusLabel(geral, status.labels)}`);

    const host = document.getElementById('cdsObsKpis');
    if (host) {
      host.innerHTML = KPI_DEFS.map((def) => {
        const domainKey = def.key === 'erp' ? 'erp' : def.key;
        return renderKpiCard(def, kpis[def.key], por[domainKey]);
      }).join('');
    }

    const perf = document.getElementById('cdsObsPerf');
    if (perf) {
      const map = {
        boot: fmtMs(kpis.boot && kpis.boot.atual),
        login: fmtMs(kpis.login && kpis.login.atual),
        first: fmtMs(data.lazy && data.lazy.first_open_ms && data.lazy.first_open_ms.last != null
          ? data.lazy.first_open_ms.last
          : (kpis.erp && kpis.erp.atual)),
        created: String((data.lazy && data.lazy.created) || 0),
        reused: String((data.lazy && data.lazy.reused) || 0),
        background: fmtMs(data.background && data.background.duration_ms
          && data.background.duration_ms.last)
      };
      perf.querySelectorAll('[data-k]').forEach((dd) => {
        dd.textContent = map[dd.getAttribute('data-k')] || '—';
      });
    }

    const rec = document.getElementById('cdsObsRecursos');
    if (rec) {
      const r = kpis.recursos || {};
      const map = {
        heap: fmtNum(r.atual_heap_mb, ' MB'),
        rss: fmtNum(r.atual_rss_mb, ' MB'),
        cpu: fmtNum(r.atual_cpu, '%'),
        eld: fmtMs(r.atual_event_loop_ms),
        uptime: fmtNum(r.uptime_s, ' s'),
        samples: String((data.recursos && data.recursos.samples) || 0)
      };
      rec.querySelectorAll('[data-k]').forEach((dd) => {
        dd.textContent = map[dd.getAttribute('data-k')] || '—';
      });
    }

    renderDomainBlock('cdsObsMiip', data.miip);
    renderDomainBlock('cdsObsCentral', data.central);
    renderDomainBlock('cdsObsNfe', data.nfe);

    document.querySelectorAll('.cds-obs-pill[data-domain]').forEach((el) => {
      const key = el.getAttribute('data-domain');
      const st = por[key] || 'saudavel';
      el.setAttribute('data-status', st);
      el.textContent = `${statusEmoji(st)} ${statusLabel(st, status.labels)}`;
    });

    renderRecent(data.recent || []);

    if (data.alerts) {
      applyAlertCounters(data.alerts);
      if (data.alerts.ativos_lista && data.alerts.ativos_lista.length) {
        const statusSel = document.getElementById('cdsObsAlertStatus');
        if (!statusSel || statusSel.value === 'ativo') {
          renderAlerts(data.alerts.ativos_lista);
        }
      }
    }
  }

  async function carregarSummary() {
    if (carregando) return;
    if (typeof isSuperAdminUser === 'function' && !isSuperAdminUser()) {
      const neg = document.getElementById('cdsObsAcessoNegado');
      if (neg) neg.classList.remove('d-none');
      return;
    }

    carregando = true;
    try {
      const resp = await fetch(`${apiBase()}/observabilidade/summary`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.status === 403) {
        const neg = document.getElementById('cdsObsAcessoNegado');
        if (neg) neg.classList.remove('d-none');
        return;
      }
      if (!resp.ok || data.ok === false) {
        throw new Error(data.erro || data.error || 'Falha ao carregar summary');
      }
      const neg = document.getElementById('cdsObsAcessoNegado');
      if (neg) neg.classList.add('d-none');
      applySummary(data);
      await carregarAlerts();
      await carregarHistory();
    } catch (err) {
      if (typeof showNotification === 'function') {
        showNotification(err.message || 'Erro ao carregar Observabilidade', 'danger');
      }
    } finally {
      carregando = false;
    }
  }

  function renderSparkline(points) {
    const host = document.getElementById('cdsObsHistChart');
    if (!host) return;
    const vals = (points || []).map((p) => Number(p.v)).filter((v) => Number.isFinite(v));
    if (!vals.length) {
      host.innerHTML = '<div class="text-muted small p-3">Sem dados no período selecionado.</div>';
      return;
    }
    const w = 560;
    const h = 140;
    const pad = 12;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = Math.max(1e-6, max - min);
    const step = vals.length > 1 ? (w - pad * 2) / (vals.length - 1) : 0;
    const coords = vals.map((v, i) => {
      const x = pad + i * step;
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    host.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" role="img">
        <polyline fill="none" stroke="#243b53" stroke-width="2"
          points="${coords.join(' ')}" />
        <text x="${pad}" y="14" font-size="11" fill="#627d98">máx ${esc(String(max))}</text>
        <text x="${pad}" y="${h - 4}" font-size="11" fill="#627d98">mín ${esc(String(min))}</text>
      </svg>`;
  }

  function renderCompare(data, metric) {
    const el = document.getElementById('cdsObsHistCompare');
    if (!el) return;
    const block = data && data.metrics && data.metrics[metric];
    if (!block) {
      el.textContent = 'Sem dados suficientes para comparar.';
      return;
    }
    const a = block.a || {};
    const b = block.b || {};
    el.innerHTML = `
      <div><strong>Atual</strong>: média ${esc(fmtNum(a.avg))} · p95 ${esc(fmtNum(a.p95))} · n=${esc(a.count || 0)}</div>
      <div><strong>Anterior</strong>: média ${esc(fmtNum(b.avg))} · p95 ${esc(fmtNum(b.p95))} · n=${esc(b.count || 0)}</div>
      <div class="text-muted mt-1">Δ média: ${esc(fmtNum((a.avg != null && b.avg != null) ? (a.avg - b.avg) : null))}</div>
    `;
  }

  async function carregarHistory() {
    try {
      const hours = Number((document.getElementById('cdsObsHistHours') || {}).value || 24);
      const metric = (document.getElementById('cdsObsHistMetric') || {}).value || 'boot_ms';
      const headers = { Authorization: `Bearer ${localStorage.getItem('token') || ''}` };
      const histRes = await fetch(`${apiBase()}/observabilidade/history?hours=${hours}&periodo_tipo=hora`, { headers });
      const hist = await histRes.json().catch(() => ({}));
      if (!histRes.ok || hist.ok === false) {
        setText('#cdsObsHistMeta', hist.erro === 'history_not_ready'
          ? 'Histórico ainda inicializando…'
          : (hist.erro || 'Falha ao carregar histórico'));
        return;
      }
      const series = (hist.series && hist.series[metric]) || [];
      renderSparkline(series);
      setText('#cdsObsHistMeta',
        `Snapshots: ${hist.snapshots_count || 0} · Agregados: ${hist.aggregates_count || 0} · Alertas gravados: ${hist.alerts_count || 0}`);

      const now = Date.now();
      const aTo = new Date(now).toISOString();
      const aFrom = new Date(now - 24 * 3600 * 1000).toISOString();
      const bTo = aFrom;
      const bFrom = new Date(now - 48 * 3600 * 1000).toISOString();
      const cmpRes = await fetch(
        `${apiBase()}/observabilidade/history/compare?a_from=${encodeURIComponent(aFrom)}&a_to=${encodeURIComponent(aTo)}&b_from=${encodeURIComponent(bFrom)}&b_to=${encodeURIComponent(bTo)}`,
        { headers }
      );
      const cmp = await cmpRes.json().catch(() => ({}));
      if (cmpRes.ok && cmp.ok !== false) renderCompare(cmp, metric);
    } catch (_) {
      setText('#cdsObsHistMeta', 'Histórico indisponível no momento.');
    }
  }

  function exportHistory(format) {
    const hours = Number((document.getElementById('cdsObsHistHours') || {}).value || 24);
    const token = localStorage.getItem('token') || '';
    const url = `${apiBase()}/observabilidade/history/export?format=${encodeURIComponent(format)}&tipo=snapshots&hours=${hours}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (resp) => {
        if (!resp.ok) throw new Error('Falha na exportação');
        const blob = await resp.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `obs-export.${format === 'csv' ? 'csv' : 'json'}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      })
      .catch((err) => {
        if (typeof showNotification === 'function') {
          showNotification(err.message || 'Erro ao exportar', 'danger');
        }
      });
  }

  function loadObservabilidade() {
    if (typeof isSuperAdminUser === 'function' && !isSuperAdminUser()) {
      $('#page-content').html('<div class="alert alert-warning">Acesso restrito: apenas SUPER_ADMIN.</div>');
      return;
    }

    return carregarPaginaHtml('observabilidade.html', function () {
      const host = document.getElementById('cdsObsHeaderHost');
      if (host && global.CdsPageShell && typeof global.CdsPageShell.renderHeader === 'function') {
        host.innerHTML = global.CdsPageShell.renderHeader({
          page: 'observabilidade',
          titulo: 'Observabilidade',
          subtitulo: 'Dashboard oficial READ-ONLY · CDS Observability Bus'
        });
      }

      const btn = document.getElementById('cdsObsRefresh');
      if (btn) {
        btn.onclick = function () { carregarSummary(); };
      }
      const sev = document.getElementById('cdsObsAlertSev');
      const st = document.getElementById('cdsObsAlertStatus');
      if (sev) sev.onchange = function () { carregarAlerts(); };
      if (st) st.onchange = function () { carregarAlerts(); };

      const apply = document.getElementById('cdsObsHistApply');
      if (apply) apply.onclick = function () { carregarHistory(); };
      const metricSel = document.getElementById('cdsObsHistMetric');
      if (metricSel) metricSel.onchange = function () { carregarHistory(); };
      const jsonBtn = document.getElementById('cdsObsExportJson');
      const csvBtn = document.getElementById('cdsObsExportCsv');
      if (jsonBtn) jsonBtn.onclick = function () { exportHistory('json'); };
      if (csvBtn) csvBtn.onclick = function () { exportHistory('csv'); };

      carregarSummary();
      if (timer) clearInterval(timer);
      timer = setInterval(carregarSummary, 15000);
    });
  }

  global.loadObservabilidade = loadObservabilidade;
  global.CdsObsDashboard = Object.freeze({
    load: loadObservabilidade,
    refresh: carregarSummary,
    refreshAlerts: carregarAlerts,
    refreshHistory: carregarHistory
  });
})(typeof window !== 'undefined' ? window : this);
