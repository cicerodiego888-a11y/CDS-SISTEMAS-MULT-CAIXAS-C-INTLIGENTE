/**
 * RC3.4 — Monitor de Ciclo DF-e / Homologação assistida (somente leitura).
 * Depende de central-entradas.js (centralEntradasFetch, escapeHtmlCentralEntradas, etc.).
 */

const centralHomologacaoState = {
  painel: null,
  aba: 'monitor',
  carregando: false,
  inspecao: null
};

function formatMsHomolog(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—';
  const n = Number(ms);
  if (n < 1000) return `${n} ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)} s`;
  return `${Math.round(n / 60000)} min`;
}

function formatDataHomolog(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return String(iso);
  }
}

function healthBadgeHomolog(health) {
  const mapa = {
    SAUDAVEL: { emoji: '🟢', cls: 'central-hom-health--ok' },
    AGUARDANDO_PROC: { emoji: '🟡', cls: 'central-hom-health--wait' },
    COOLDOWN: { emoji: '🟠', cls: 'central-hom-health--cool' },
    ERRO: { emoji: '🔴', cls: 'central-hom-health--err' },
    NEUTRO: { emoji: '⚪', cls: 'central-hom-health--neu' }
  };
  const m = mapa[health?.codigo] || mapa.NEUTRO;
  return `<span class="central-hom-health ${m.cls}" title="${escapeHtmlCentralEntradas(health?.label || '')}">${m.emoji} ${escapeHtmlCentralEntradas(health?.label || '—')}</span>`;
}

async function carregarHomologacaoCentral() {
  const root = document.getElementById('centralHomologacaoBody');
  if (!root) return;
  centralHomologacaoState.carregando = true;
  root.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div><p class="mt-2 text-muted">Carregando telemetria do ciclo DF-e…</p></div>';
  try {
    const painel = await centralEntradasFetch('/homologacao/painel?limite=80');
    centralHomologacaoState.painel = painel;
    renderHomologacaoCentral();
  } catch (err) {
    root.innerHTML = `<div class="alert alert-danger m-3">Falha ao carregar monitor: ${escapeHtmlCentralEntradas(err.message || err)}</div>`;
  } finally {
    centralHomologacaoState.carregando = false;
  }
}

function renderHomologacaoCentral() {
  const root = document.getElementById('centralHomologacaoBody');
  if (!root || !centralHomologacaoState.painel) return;
  const p = centralHomologacaoState.painel;
  const aba = centralHomologacaoState.aba;

  root.innerHTML = `
    <div class="central-hom-toolbar">
      <div class="central-hom-tabs" role="tablist">
        <button type="button" class="central-hom-tab ${aba === 'monitor' ? 'active' : ''}" data-hom-aba="monitor">Monitor</button>
        <button type="button" class="central-hom-tab ${aba === 'sefaz' ? 'active' : ''}" data-hom-aba="sefaz">Diagnóstico SEFAZ</button>
        <button type="button" class="central-hom-tab ${aba === 'metricas' ? 'active' : ''}" data-hom-aba="metricas">Métricas</button>
        <button type="button" class="central-hom-tab ${aba === 'checklist' ? 'active' : ''}" data-hom-aba="checklist">Checklist</button>
      </div>
      <button type="button" class="btn btn-sm btn-outline-primary" id="centralHomBtnRefresh" title="Atualizar painel">
        <i class="fas fa-sync-alt"></i> Atualizar
      </button>
    </div>
    <div class="central-hom-resumo">
      ${renderResumoHomolog(p)}
    </div>
    <div id="centralHomAbaConteudo">
      ${aba === 'monitor' ? renderTabelaMonitorHomolog(p) : ''}
      ${aba === 'sefaz' ? renderDiagSefazHomolog(p) : ''}
      ${aba === 'metricas' ? renderMetricasHomolog(p) : ''}
      ${aba === 'checklist' ? renderChecklistHomolog(p) : ''}
    </div>
  `;

  root.querySelectorAll('[data-hom-aba]').forEach((btn) => {
    btn.addEventListener('click', () => {
      centralHomologacaoState.aba = btn.dataset.homAba;
      renderHomologacaoCentral();
    });
  });
  document.getElementById('centralHomBtnRefresh')?.addEventListener('click', () => carregarHomologacaoCentral());
  root.querySelectorAll('[data-hom-inspecionar]').forEach((btn) => {
    btn.addEventListener('click', () => inspecionarDocumentoHomolog(btn.dataset.homInspecionar));
  });
  root.querySelectorAll('[data-hom-export]').forEach((btn) => {
    btn.addEventListener('click', () => exportarHomolog(btn.dataset.homExport, btn.dataset.homFmt || 'json'));
  });
}

function renderResumoHomolog(p) {
  const hr = p.healthResumo || {};
  const cool = p.cooldown?.ativo
    ? `🟠 Cooldown até ${formatDataHomolog(p.cooldown.proximaConsultaEm)}`
    : '🟢 Sem cooldown';
  return `
    <div class="central-hom-chips">
      <span class="central-hom-chip">ultNSU <strong>${escapeHtmlCentralEntradas(p.nsu?.ultNsu ?? '—')}</strong></span>
      <span class="central-hom-chip">maxNSU <strong>${escapeHtmlCentralEntradas(p.nsu?.maxNsu ?? '—')}</strong></span>
      <span class="central-hom-chip">cStat <strong>${escapeHtmlCentralEntradas(p.nsu?.ultimoCstat ?? '—')}</strong></span>
      <span class="central-hom-chip">${cool}</span>
      <span class="central-hom-chip">🟢 ${hr.SAUDAVEL || 0}</span>
      <span class="central-hom-chip">🟡 ${hr.AGUARDANDO_PROC || 0}</span>
      <span class="central-hom-chip">🟠 ${hr.COOLDOWN || 0}</span>
      <span class="central-hom-chip">🔴 ${hr.ERRO || 0}</span>
    </div>`;
}

function renderTabelaMonitorHomolog(p) {
  const rows = (p.monitor || []).map((doc) => `
    <tr>
      <td>${escapeHtmlCentralEntradas(doc.nsu || '—')}</td>
      <td class="central-hom-chave" title="${escapeHtmlCentralEntradas(doc.chave || '')}">${escapeHtmlCentralEntradas(doc.chave ? `${doc.chave.slice(0, 8)}…${doc.chave.slice(-4)}` : '—')}</td>
      <td>${escapeHtmlCentralEntradas(doc.fornecedor || '—')}</td>
      <td><span class="central-hom-tipo">${escapeHtmlCentralEntradas(doc.tipoDocumento || '—')}</span></td>
      <td>${escapeHtmlCentralEntradas(doc.status || '—')}</td>
      <td>${healthBadgeHomolog(doc.health)}</td>
      <td class="small text-muted">
        cien ${formatMsHomolog(doc.tempos?.cienciaMs)} ·
        cons ${formatMsHomolog(doc.tempos?.consultaMs)} ·
        pars ${formatMsHomolog(doc.tempos?.parserMs)} ·
        miip ${formatMsHomolog(doc.tempos?.miipMs)}
      </td>
      <td class="small">
        ${doc.ultimaComunicacaoSefaz
          ? `${escapeHtmlCentralEntradas(doc.ultimaComunicacaoSefaz.tipo)}<br><span class="text-muted">${formatDataHomolog(doc.ultimaComunicacaoSefaz.dataHora)}</span>`
          : '—'}
      </td>
      <td>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-hom-inspecionar="${doc.id}" title="Inspecionar documento">
          <i class="fas fa-search"></i>
        </button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-hom-export="${doc.id}" data-hom-fmt="json" title="Exportar JSON">
          JSON
        </button>
      </td>
    </tr>
  `).join('');

  return `
    <div class="table-responsive central-hom-table-wrap">
      <table class="table table-sm table-hover mb-0 central-hom-table">
        <thead>
          <tr>
            <th>NSU</th><th>Chave</th><th>Fornecedor</th><th>Tipo</th>
            <th>Estado</th><th>Health</th><th>Tempos</th><th>Última SEFAZ</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="9" class="text-center text-muted py-4">Nenhum documento no ciclo</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

function cardDiag(titulo, valor, sub = '') {
  return `
    <div class="central-hom-diag-card">
      <div class="central-hom-diag-label">${escapeHtmlCentralEntradas(titulo)}</div>
      <div class="central-hom-diag-value">${valor}</div>
      ${sub ? `<div class="central-hom-diag-sub">${sub}</div>` : ''}
    </div>`;
}

function renderDiagSefazHomolog(p) {
  const d = p.diagnosticoSefaz || {};
  const fmtEv = (ev) => {
    if (!ev) return '—';
    return `${formatDataHomolog(ev.dataHora)} · cStat ${escapeHtmlCentralEntradas(ev.cStat ?? '—')}`;
  };
  return `
    <div class="central-hom-diag-grid">
      ${cardDiag('Estado da comunicação', escapeHtmlCentralEntradas(d.comunicacao?.estado || '—'), escapeHtmlCentralEntradas(d.comunicacao?.detalhe || ''))}
      ${cardDiag('Último 137', fmtEv(d.ultimo137))}
      ${cardDiag('Último 656', fmtEv(d.ultimo656))}
      ${cardDiag('Último sucesso', fmtEv(d.ultimoSucesso))}
      ${cardDiag('Último timeout', d.ultimoTimeout ? formatDataHomolog(d.ultimoTimeout.dataHora) : '—')}
      ${cardDiag('Última manifestação', fmtEv(d.ultimaManifestacao))}
      ${cardDiag('Último PROC_NFE', d.ultimoProcNfe ? formatDataHomolog(d.ultimoProcNfe.dataHora) : '—')}
      ${cardDiag('ultNSU / maxNSU', `${escapeHtmlCentralEntradas(d.ultNsu ?? '—')} / ${escapeHtmlCentralEntradas(d.maxNsu ?? '—')}`)}
    </div>`;
}

function renderMetricasHomolog(p) {
  const m = p.metricas?.mediaMs || {};
  const a = p.metricas?.amostras || {};
  const linha = (label, ms, n) => `
    <tr>
      <td>${escapeHtmlCentralEntradas(label)}</td>
      <td><strong>${formatMsHomolog(ms)}</strong></td>
      <td class="text-muted">${n ?? 0} amostras</td>
    </tr>`;
  return `
    <div class="table-responsive">
      <table class="table table-sm mb-0">
        <thead><tr><th>Etapa</th><th>Tempo médio</th><th></th></tr></thead>
        <tbody>
          ${linha('RES_NFE → Ciência', m.resNfeParaCiencia, a.resNfeParaCiencia)}
          ${linha('Ciência → PROC_NFE', m.cienciaParaProcNfe, a.cienciaParaProcNfe)}
          ${linha('PROC_NFE → Parser', m.procNfeParaParser, a.procNfeParaParser)}
          ${linha('Parser → MIIP', m.parserParaMiip, a.parserParaMiip)}
          ${linha('MIIP → Compra', m.miipParaCompra, a.miipParaCompra)}
          ${linha('Manifestação (duração SEFAZ)', m.manifestacao, a.cienciaParaProcNfe)}
          ${linha('Consulta DF-e', m.consultaDfe, a.cienciaParaProcNfe)}
          ${linha('Parser (duração)', m.parser, a.procNfeParaParser)}
          ${linha('MIIP (duração)', m.miip, a.parserParaMiip)}
        </tbody>
      </table>
    </div>`;
}

function renderChecklistHomolog(p) {
  const items = p.checklistHomologacao || [];
  return `
    <div class="central-hom-checklist">
      <p class="text-muted small mb-3">Checklist de homologação real junto à SEFAZ (agregado por documentos do monitor).</p>
      <ul class="list-unstyled mb-0">
        ${items.map((item) => `
          <li class="central-hom-check-item">
            <span class="central-hom-check-box">${item.concluidos > 0 ? '☑' : '☐'}</span>
            <span>${escapeHtmlCentralEntradas(item.label)}</span>
            <span class="text-muted small ms-auto">${item.concluidos}/${item.total} docs</span>
          </li>
        `).join('')}
      </ul>
      <p class="small text-muted mt-3 mb-0">Use <strong>Inspecionar</strong> em um documento para ver o checklist individual.</p>
    </div>`;
}

async function inspecionarDocumentoHomolog(documentoId) {
  try {
    const insp = await centralEntradasFetch(`/homologacao/${documentoId}/inspecionar`);
    centralHomologacaoState.inspecao = insp;
    abrirModalInspecaoHomolog(insp);
  } catch (err) {
    if (typeof mostrarToastCentral === 'function') {
      mostrarToastCentral(err.message || 'Falha na inspeção', 'error');
    } else if (typeof showNotification === 'function') {
      showNotification(err.message || 'Falha na inspeção', 'danger');
    }
  }
}

function abrirModalInspecaoHomolog(insp) {
  let modal = document.getElementById('centralHomInspecaoModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'centralHomInspecaoModal';
    modal.className = 'central-hom-modal';
    document.body.appendChild(modal);
  }

  const doc = insp.documento || {};
  const timelineHtml = (insp.timeline || []).map((et, idx, arr) => `
    <div class="central-hom-tl-item ${et.concluida ? 'is-done' : ''}">
      <div class="central-hom-tl-dot"></div>
      ${idx < arr.length - 1 ? '<div class="central-hom-tl-line"></div>' : ''}
      <div class="central-hom-tl-body">
        <div class="central-hom-tl-title">${escapeHtmlCentralEntradas(et.label)}</div>
        <div class="central-hom-tl-meta">
          ${et.concluida ? formatDataHomolog(et.dataHora) : 'Pendente'}
          · ${formatMsHomolog(et.duracaoMs)}
          · origem ${escapeHtmlCentralEntradas(et.origem || '—')}
          ${et.cStat != null ? ` · cStat ${escapeHtmlCentralEntradas(et.cStat)}` : ''}
        </div>
      </div>
    </div>
  `).join('');

  const checklistHtml = (insp.checklist || []).map((c) => `
    <li>${c.ok ? '☑' : '☐'} ${escapeHtmlCentralEntradas(c.label)}</li>
  `).join('');

  const tel = insp.telemetria || {};
  modal.innerHTML = `
    <div class="central-hom-modal-backdrop" data-hom-fechar></div>
    <div class="central-hom-modal-panel" role="dialog" aria-modal="true" aria-label="Inspeção do documento">
      <div class="central-hom-modal-header">
        <div>
          <h5 class="mb-0"><i class="fas fa-search me-2"></i>Inspecionar Documento</h5>
          <div class="small text-muted">Somente leitura · #${doc.id}</div>
        </div>
        <button type="button" class="btn btn-sm btn-light" data-hom-fechar>&times;</button>
      </div>
      <div class="central-hom-modal-body">
        <div class="central-hom-insp-grid">
          <div>
            <div class="central-hom-insp-block">
              <h6>Identificação</h6>
              <dl class="central-hom-dl">
                <dt>Schema</dt><dd>${escapeHtmlCentralEntradas(doc.schema || '—')}</dd>
                <dt>Status</dt><dd>${escapeHtmlCentralEntradas(doc.status || '—')}</dd>
                <dt>Tipo</dt><dd>${escapeHtmlCentralEntradas(doc.tipoDocumento || '—')}</dd>
                <dt>NSU</dt><dd>${escapeHtmlCentralEntradas(doc.nsu || '—')}</dd>
                <dt>Chave</dt><dd class="central-hom-chave-full">${escapeHtmlCentralEntradas(doc.chave || '—')}</dd>
                <dt>XML</dt><dd>${doc.xmlArmazenado ? 'Armazenado' : 'Ausente'}</dd>
                <dt>Health</dt><dd>${healthBadgeHomolog(insp.health)}</dd>
              </dl>
            </div>
            <div class="central-hom-insp-block">
              <h6>Telemetria</h6>
              <dl class="central-hom-dl">
                <dt>ultNSU</dt><dd>${escapeHtmlCentralEntradas(tel.ultNsu ?? '—')}</dd>
                <dt>maxNSU</dt><dd>${escapeHtmlCentralEntradas(tel.maxNsu ?? '—')}</dd>
                <dt>cStat</dt><dd>${escapeHtmlCentralEntradas(tel.cStat ?? '—')}</dd>
                <dt>Manifestação</dt><dd>${formatMsHomolog(tel.tempoManifestacaoMs)}</dd>
                <dt>Consulta</dt><dd>${formatMsHomolog(tel.tempoConsultaMs)}</dd>
                <dt>Parser</dt><dd>${formatMsHomolog(tel.tempoParserMs)}</dd>
                <dt>MIIP</dt><dd>${formatMsHomolog(tel.tempoMiipMs)}</dd>
                <dt>Cooldown</dt><dd>${tel.cooldownAtivo ? 'Ativo' : 'Não'}</dd>
                <dt>CorrelationId</dt><dd class="small">${escapeHtmlCentralEntradas(tel.correlationId || '—')}</dd>
              </dl>
            </div>
            <div class="central-hom-insp-block">
              <h6>Checklist homologação</h6>
              <ul class="list-unstyled mb-0 small">${checklistHtml}</ul>
            </div>
          </div>
          <div>
            <div class="central-hom-insp-block">
              <h6>Timeline do ciclo</h6>
              <div class="central-hom-timeline">${timelineHtml}</div>
            </div>
            <div class="central-hom-insp-block">
              <h6>XML (preview)</h6>
              <pre class="central-hom-xml">${escapeHtmlCentralEntradas(doc.xmlPreview || '(sem XML)')}</pre>
            </div>
            <div class="central-hom-insp-block">
              <h6>Eventos / Manifestações</h6>
              <div class="central-hom-eventos">
                ${(insp.eventos || []).slice(0, 30).map((ev) => `
                  <div class="central-hom-ev">
                    <strong>${escapeHtmlCentralEntradas(ev.tipo)}</strong>
                    <span class="text-muted">${formatDataHomolog(ev.createdAt)}</span>
                    <div class="small">${escapeHtmlCentralEntradas(ev.descricao || '')}</div>
                  </div>
                `).join('') || '<span class="text-muted">Sem eventos</span>'}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="central-hom-modal-footer">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-hom-export="${doc.id}" data-hom-fmt="txt">Exportar TXT</button>
        <button type="button" class="btn btn-sm btn-outline-primary" data-hom-export="${doc.id}" data-hom-fmt="json">Exportar JSON</button>
        <button type="button" class="btn btn-sm btn-secondary" data-hom-fechar>Fechar</button>
      </div>
    </div>
  `;

  modal.classList.add('is-open');
  modal.querySelectorAll('[data-hom-fechar]').forEach((el) => {
    el.addEventListener('click', () => modal.classList.remove('is-open'));
  });
  modal.querySelectorAll('[data-hom-export]').forEach((btn) => {
    btn.addEventListener('click', () => exportarHomolog(btn.dataset.homExport, btn.dataset.homFmt || 'json'));
  });
}

async function exportarHomolog(documentoId, formato) {
  try {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
    const base = (typeof API_URL === 'string' && API_URL) ? API_URL : `${window.location.origin}/api`;
    const resp = await fetch(`${base}/central-entradas/homologacao/${documentoId}/exportar?formato=${encodeURIComponent(formato)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `homologacao-doc-${documentoId}.${formato === 'txt' ? 'txt' : 'json'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    if (typeof mostrarToastCentral === 'function') {
      mostrarToastCentral(err.message || 'Falha ao exportar', 'error');
    } else if (typeof showNotification === 'function') {
      showNotification(err.message || 'Falha ao exportar', 'danger');
    }
  }
}

window.carregarHomologacaoCentral = carregarHomologacaoCentral;
window.inspecionarDocumentoHomolog = inspecionarDocumentoHomolog;
