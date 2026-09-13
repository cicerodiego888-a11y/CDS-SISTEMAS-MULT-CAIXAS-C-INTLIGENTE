/**
 * CDS Monitoring Engine — Centro de Operações CDS (UI M4 + UX-001.1 + DS-001)
 * Consome GET /api/monitoring/summary — widgets + intelligence + actionCenter.
 * Nomenclatura: AdaptiveLabelService · Apresentação: CDS UI Foundation.
 * Sem SQL / sem regras de negócio. Actions = somente navegação sugerida.
 */
(function (global) {
  'use strict';

  const HISTORY_KEY = 'cds_mon_action_history_v1';

  const ABAS_BASE = Object.freeze([
    { id: 'geral', icon: 'fa-home', labelKey: 'geral' },
    { id: 'fiscal', icon: 'fa-file-invoice-dollar', labelKey: 'aba.fiscal' },
    { id: 'financeiro', icon: 'fa-money-bill-wave', labelKey: 'financeiro' },
    { id: 'caixa', icon: 'fa-university', labelKey: 'caixa' },
    { id: 'estoque', icon: 'fa-boxes', labelKey: 'estoque' },
    { id: 'recebimentos', icon: 'fa-credit-card', labelKey: 'recebimentos' },
    { id: 'comercial', icon: 'fa-chart-line', labelKey: 'comercial' },
    { id: 'alertas', icon: 'fa-exclamation-triangle', labelKey: 'alertas' },
    { id: 'indicadores', icon: 'fa-chart-bar', labelKey: 'indicadores' }
  ]);

  let estado = {
    summary: null,
    abaAtiva: 'geral',
    carregando: false,
    erro: null,
    competenciaAno: null,
    competenciaMes: null
  };

  function competenciaAtualPadrao() {
    const agora = new Date();
    const br = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
    return { ano: br.getFullYear(), mes: br.getMonth() + 1 };
  }

  function obterCompetenciaUi() {
    const padrao = competenciaAtualPadrao();
    return {
      ano: estado.competenciaAno || padrao.ano,
      mes: estado.competenciaMes || padrao.mes
    };
  }

  function labelCompetencia(ano, mes) {
    return `${String(mes).padStart(2, '0')}/${ano}`;
  }

  function montarQueryCompetencia() {
    const { ano, mes } = obterCompetenciaUi();
    return `ano=${encodeURIComponent(ano)}&mes=${encodeURIComponent(mes)}`;
  }

  function escapeHtml(value) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(String(value ?? ''));
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** API oficial — nunca if(F12) local para nomenclatura */
  function ALS() {
    return global.AdaptiveLabelService;
  }

  function getLabel(domain, opts) {
    const svc = ALS();
    if (svc && typeof svc.getLabel === 'function') return svc.getLabel(domain, opts);
    return String(domain || '');
  }

  function sanitizeText(texto) {
    const svc = ALS();
    if (svc && typeof svc.sanitize === 'function') return svc.sanitize(texto);
    return String(texto == null ? '' : texto);
  }

  function labelForWidget(widget) {
    const svc = ALS();
    if (svc && typeof svc.labelForWidget === 'function') return svc.labelForWidget(widget);
    return sanitizeText(widget?.title || '');
  }

  function badgeLabel(scope) {
    const svc = ALS();
    if (svc && typeof svc.getBadge === 'function') return svc.getBadge(scope) || '';
    return '';
  }

  function shouldShowNaoFiscal() {
    const svc = ALS();
    if (svc && typeof svc.shouldShowNaoFiscal === 'function') return svc.shouldShowNaoFiscal();
    return true;
  }

  function moduloFiscalContratado() {
    if (typeof global.fiscalHabilitado === 'function') return global.fiscalHabilitado();
    if (typeof global.implantacaoPermiteFiscal === 'function') return global.implantacaoPermiteFiscal();
    return true;
  }

  function getShortLabel(domain, opts) {
    const svc = ALS();
    if (svc && typeof svc.getShortLabel === 'function') return svc.getShortLabel(domain, opts);
    return getLabel(domain, opts);
  }

  function getDescription(domain, opts) {
    const svc = ALS();
    if (svc && typeof svc.getDescription === 'function') return svc.getDescription(domain, opts);
    return '';
  }

  function obterAbas() {
    const fiscalOn = moduloFiscalContratado();
    return ABAS_BASE
      .filter((a) => fiscalOn || a.id !== 'fiscal')
      .map((a) => ({
        id: a.id,
        icon: a.icon,
        label: sanitizeText(getLabel(a.labelKey))
      }));
  }

  function formatMoney(v) {
    const n = Number(v);
    return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  }

  function formatQty(v) {
    return String(Number(v) || 0);
  }

  function UI() {
    return global.CDS?.UI?.components || global.CDSUIComponents || {};
  }

  function badge(texto, tone) {
    const t = sanitizeText(texto);
    if (!t) return '';
    const Comp = UI().CDSBadge;
    if (Comp?.render) return Comp.render({ text: t, tone: tone || 'neutral' });
    return `<span class="cds-ui-badge cds-cfg-badge cds-cfg-badge--${tone || 'neutral'}">${escapeHtml(t)}</span>`;
  }

  function notify(msg, type) {
    if (global.CDSNotification?.show) return global.CDSNotification.show(msg, type);
    if (typeof global.showNotification === 'function') return global.showNotification(msg, type);
  }

  function trendIcon(trend) {
    if (trend === 'up') return '<i class="fas fa-arrow-up" style="color:#16a34a"></i>';
    if (trend === 'down') return '<i class="fas fa-arrow-down" style="color:#dc2626"></i>';
    return '<i class="fas fa-minus" style="color:#6b7280"></i>';
  }

  function filtrarWidgets(widgets, domain) {
    const list = Array.isArray(widgets) ? widgets : [];
    const fiscalOn = moduloFiscalContratado();
    return list.filter((w) => {
      if (!w || w.domain !== domain) return false;
      if (!fiscalOn && (w.scope === 'fiscal' || domain === 'fiscal')) return false;
      if (w.scope === 'nao_fiscal' && !shouldShowNaoFiscal()) return false;
      return true;
    });
  }

  function moduleStatusDot(status) {
    const map = { online: '🟢', atencao: '🟡', offline: '🔴', nao_monitorado: '⚪' };
    return map[status] || '⚪';
  }

  function lerHistoricoLocal() {
    try {
      return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function registrarHistoricoLocal(label) {
    const agora = new Date();
    const hh = String(agora.getHours()).padStart(2, '0');
    const mm = String(agora.getMinutes()).padStart(2, '0');
    const entry = { horario: `${hh}:${mm}`, mensagem: label };
    const list = [entry].concat(lerHistoricoLocal()).slice(0, 30);
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch { /* noop */ }
  }

  function executarAction(action) {
    if (!action) return;
    const label = sanitizeText(action.label || action.page || action.route || 'ação');
    registrarHistoricoLocal(`Operador: ${label}`);
    if (action.params && typeof action.params === 'object') {
      if (action.params.tab) global.__CDS_CFG_FORCE_TAB = action.params.tab;
      if (action.params.anchor) global.__CDS_CFG_FORCE_ANCHOR = action.params.anchor;
      if (action.params.filtro) global.__CDS_MON_FORCE_FILTER = action.params.filtro;
      if (action.params.aba) global.__CDS_FIN_FORCE_TAB = action.params.aba;
    }
    if (action.route) {
      window.location.href = action.route;
      return;
    }
    if (action.page && typeof global.loadPage === 'function') {
      global.loadPage(action.page);
      return;
    }
    notify(`Ação sugerida: ${label}`, 'info');
  }

  function actionAttr(action) {
    return encodeURIComponent(JSON.stringify(action || {}));
  }

  function parseActionAttr(el) {
    try {
      return JSON.parse(decodeURIComponent(el.getAttribute('data-action-json') || '%7B%7D'));
    } catch {
      return null;
    }
  }

  function renderActionButtons(actions) {
    const list = Array.isArray(actions) ? actions : [];
    if (!list.length) return '';
    return `
      <div class="cds-cfg-actions" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:0.55rem;">
        ${list.map((a) => `
          <button type="button" class="btn btn-sm btn-outline-primary cds-mon-action"
            data-action-json="${actionAttr(a)}">
            <i class="fas ${escapeHtml(a.icon || 'fa-arrow-right')}"></i>
            ${escapeHtml(sanitizeText(a.label || getLabel('abrir')))}
          </button>`).join('')}
      </div>`;
  }

  function priorityTone(p) {
    if (p === 1 || p === 'Crítico') return 'error';
    if (p === 2 || p === 'Alta') return 'warn';
    if (p === 3 || p === 'Média') return 'info';
    return 'neutral';
  }

  function renderRecommendedActions(summary) {
    const actions = summary?.recommendedActions || summary?.cop?.recommendedActions || summary?.actionCenter?.actions || [];
    return `
      <div class="cds-cfg-card" id="cdsMonRecommendedActions" style="margin-bottom:0.75rem;border-left:4px solid #16a34a;">
        <div class="cds-cfg-card__title"><i class="fas fa-bolt"></i> ${escapeHtml(getLabel('acoes_recomendadas'))}</div>
        <p class="cds-cfg-hint">Sugestões de navegação — nenhuma ação é executada automaticamente.</p>
        ${actions.length ? `
          <div style="display:grid;gap:0.45rem;">
            ${actions.slice(0, 10).map((a) => `
              <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                ${badge(a.priorityLabel || 'Média', priorityTone(a.priority))}
                <button type="button" class="btn btn-sm btn-primary cds-mon-action"
                  data-action-json="${actionAttr(a)}">
                  <i class="fas ${escapeHtml(a.icon || 'fa-arrow-right')}"></i>
                  ${escapeHtml(sanitizeText(a.label || ''))}
                </button>
                <span class="text-muted" style="font-size:0.75rem;">${escapeHtml(a.dominio || a.category || '')}</span>
              </div>`).join('')}
          </div>` : '<p class="cds-cfg-note">Nenhuma ação recomendada no momento.</p>'}
      </div>`;
  }

  function renderWorkQueue(summary) {
    const queue = summary?.workQueue || summary?.cop?.workQueue || [];
    return `
      <div class="cds-cfg-card" style="margin-bottom:0.75rem;">
        <div class="cds-cfg-card__title"><i class="fas fa-tasks"></i> ${escapeHtml(getLabel('fila_trabalho'))}</div>
        ${queue.length ? `
          <ul class="cds-cfg-note" style="list-style:none;padding:0;margin:0;display:grid;gap:0.4rem;">
            ${queue.map((item) => `
              <li style="display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center;">
                ${badge(item.severidade || 'INFO', item.severidade === 'CRITICO' ? 'error' : 'warn')}
                <strong>${escapeHtml(sanitizeText(item.titulo || ''))}</strong>
                <span class="text-muted">${escapeHtml(sanitizeText(item.dominio || ''))}</span>
                ${renderActionButtons((item.actions || []).slice(0, 2))}
              </li>`).join('')}
          </ul>` : '<p class="cds-cfg-hint">Fila vazia.</p>'}
      </div>`;
  }

  function renderTimeline(summary) {
    const events = summary?.timeline || summary?.cop?.timeline || [];
    return `
      <div class="cds-cfg-card" style="margin-bottom:0.75rem;">
        <div class="cds-cfg-card__title"><i class="fas fa-stream"></i> ${escapeHtml(getLabel('timeline_global'))}</div>
        ${events.length ? `
          <ul class="cds-cfg-note" style="list-style:none;padding:0;margin:0;display:grid;gap:0.35rem;">
            ${events.map((e) => `
              <li style="display:grid;grid-template-columns:70px 1fr;gap:0.5rem;">
                <span class="text-muted" style="font-size:0.75rem;">${escapeHtml(String(e.horario || '').slice(11, 16) || String(e.horario || '').slice(0, 5) || '—')}</span>
                <span>
                  <strong>${escapeHtml(sanitizeText(e.titulo || ''))}</strong>
                  <span class="text-muted" style="font-size:0.75rem;"> · ${escapeHtml(sanitizeText(e.origem || ''))} · ${escapeHtml(sanitizeText(e.status || ''))}</span>
                </span>
              </li>`).join('')}
          </ul>` : '<p class="cds-cfg-hint">Sem eventos na timeline.</p>'}
      </div>`;
  }

  function renderActionHistory() {
    const hist = lerHistoricoLocal();
    return `
      <div class="cds-cfg-card" style="margin-bottom:0.75rem;">
        <div class="cds-cfg-card__title"><i class="fas fa-history"></i> ${escapeHtml(getLabel('historico_acoes'))}</div>
        <p class="cds-cfg-hint">Somente nesta sessão (navegação local — sem gravação no servidor).</p>
        ${hist.length ? `
          <ul class="cds-cfg-note" style="list-style:none;padding:0;margin:0;display:grid;gap:0.3rem;">
            ${hist.slice(0, 12).map((h) => `
              <li><span class="text-muted">${escapeHtml(h.horario)}</span> — ${escapeHtml(h.mensagem)}</li>`).join('')}
          </ul>` : '<p class="cds-cfg-note">Nenhuma ação de navegação nesta sessão.</p>'}
      </div>`;
  }

  function renderExecutiveInsights(summary) {
    const ex = summary?.executiveInsights || {};
    const items = ex.items || [];
    if (!items.length) {
      return `
        <div class="cds-cfg-card" id="cdsMonExecutiveInsights" style="margin-bottom:0.75rem;border-left:4px solid #0d6efd;">
          <div class="cds-cfg-card__title"><i class="fas fa-brain"></i> ${escapeHtml(getLabel('executive_insights'))}</div>
          <p class="cds-cfg-hint">Aguardando interpretação da camada Intelligence…</p>
        </div>`;
    }
    const rec = ex.recomendacaoDestaque;
    return `
      <div class="cds-cfg-card" id="cdsMonExecutiveInsights" style="margin-bottom:0.75rem;border-left:4px solid #0d6efd;">
        <div class="cds-cfg-card__title" style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
          <i class="fas fa-brain"></i> ${escapeHtml(getLabel('executive_insights'))}
          ${ex.saudeGeral ? badge(`Saúde ${ex.saudeGeral}`, ex.saudeGeral === 'CRITICO' ? 'error' : (ex.saudeGeral === 'ATENCAO' ? 'warn' : 'ok')) : ''}
          ${ex.tendenciaLabel ? badge(ex.tendenciaLabel, 'info') : ''}
        </div>
        <ul class="cds-cfg-note" style="list-style:none;padding:0;margin:0;display:grid;gap:0.45rem;">
          ${items.map((it) => {
            const nf = it.scope === 'nao_fiscal' ? ' data-mon-nao-fiscal="1"' : '';
            if (it.scope === 'nao_fiscal' && !shouldShowNaoFiscal()) return '';
            return `<li${nf} style="display:flex;gap:0.5rem;align-items:flex-start;">
              <span aria-hidden="true">${escapeHtml(it.emoji || '🔵')}</span>
              <span>${escapeHtml(sanitizeText(it.mensagem || ''))}</span>
            </li>`;
          }).join('')}
        </ul>
        ${rec ? `
          <div class="cds-cfg-note" style="margin-top:0.75rem;padding:0.65rem;background:#f0f9ff;border-radius:8px;">
            <strong>💡 ${escapeHtml(getLabel('recomendacao'))}</strong><br>${escapeHtml(sanitizeText(rec.titulo || ''))} — ${escapeHtml(sanitizeText(rec.descricao || ''))}
          </div>` : ''}
      </div>`;
  }

  function renderCop(summary) {
    const cop = summary?.cop || {};
    const modulos = cop.modulos || [];
    return `
      <div class="cds-cfg-card" id="cdsMonCop" style="margin-bottom:0.75rem;">
        <div class="cds-cfg-card__title"><i class="fas fa-sitemap"></i> ${escapeHtml(sanitizeText(cop.titulo || getLabel('cop')))}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.5rem;margin-bottom:0.75rem;">
          <div><div class="text-muted" style="font-size:0.72rem;">Saúde Geral</div><div style="font-weight:700;">${escapeHtml(cop.saudeGeral || '—')}</div></div>
          <div><div class="text-muted" style="font-size:0.72rem;">${escapeHtml(getLabel('alertas'))} Críticos</div><div style="font-weight:700;">${formatQty((cop.alertasCriticos || []).length)}</div></div>
          <div><div class="text-muted" style="font-size:0.72rem;">Ações sugeridas</div><div style="font-weight:700;">${formatQty((summary?.recommendedActions || []).length)}</div></div>
          <div><div class="text-muted" style="font-size:0.72rem;">Última atualização</div><div style="font-weight:600;font-size:0.82rem;">${escapeHtml(String(cop.ultimaAtualizacao || summary?.timestamp || '—').slice(0, 19).replace('T', ' '))}</div></div>
        </div>
        <div class="text-muted" style="font-size:0.75rem;margin-bottom:0.35rem;">Status dos módulos</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.35rem;">
          ${modulos.map((m) => `
            <div style="font-size:0.82rem;display:flex;gap:0.35rem;align-items:center;">
              <span>${moduleStatusDot(m.status)}</span>
              <span>${escapeHtml(m.nome || m.id)}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function renderWidgetCard(widget) {
    const w = widget || {};
    const m = w.metrics || {};
    const isNaoFiscal = w.scope === 'nao_fiscal';
    if (isNaoFiscal && !shouldShowNaoFiscal()) return '';
    const wrapAttr = isNaoFiscal ? ' data-mon-nao-fiscal="1"' : '';
    const tituloAdaptado = labelForWidget(w);
    const badgeTxt = badgeLabel(w.scope);
    const hoje = m.hoje || {};
    const mes = m.mes || {};
    const ano = m.ano || {};
    const ultimo = m.ultimoLancamento;
    let ultimoHtml = '';
    if (ultimo) {
      const label = ultimo.descricao || ultimo.numero || (ultimo.chave ? String(ultimo.chave).slice(0, 16) + '…' : 'Lançamento');
      ultimoHtml = `<div class="cds-cfg-note" style="margin-top:0.5rem;"><span class="text-muted">Último:</span> <strong>${escapeHtml(sanitizeText(label))}</strong>${ultimo.data ? ` · ${escapeHtml(String(ultimo.data).slice(0, 19))}` : ''}</div>`;
    } else if (m.fornecedor) {
      ultimoHtml = `<div class="cds-cfg-note" style="margin-top:0.5rem;"><span class="text-muted">Fornecedor:</span> <strong>${escapeHtml(m.fornecedor)}</strong></div>`;
    }

    const isCaixa = w.domain === 'caixa';
    const body = isCaixa
      ? `
        <div class="cds-cfg-note" style="display:grid;gap:0.4rem;">
          <div><div class="text-muted" style="font-size:0.75rem;">Saldo</div><div style="font-size:1.35rem;font-weight:700;">${formatMoney(m.saldo != null ? m.saldo : w.value)}</div></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;">
            <div><div class="text-muted" style="font-size:0.7rem;">Entradas</div><div style="font-weight:600;">${formatMoney(m.entradas)}</div></div>
            <div><div class="text-muted" style="font-size:0.7rem;">Saídas</div><div style="font-weight:600;">${formatMoney(m.saidas)}</div></div>
            <div><div class="text-muted" style="font-size:0.7rem;">Suprimentos</div><div style="font-weight:600;">${formatMoney(m.suprimentos)}</div></div>
            <div><div class="text-muted" style="font-size:0.7rem;">Sangrias</div><div style="font-weight:600;">${formatMoney(m.sangrias)}</div></div>
            <div><div class="text-muted" style="font-size:0.7rem;">Abertura</div><div style="font-weight:600;">${formatMoney(m.abertura)}</div></div>
            <div><div class="text-muted" style="font-size:0.7rem;">Fechamento</div><div style="font-weight:600;">${m.fechamento != null ? formatMoney(m.fechamento) : '—'}</div></div>
          </div>
          <div class="text-muted" style="font-size:0.72rem;">Status: ${escapeHtml(m.status || '—')}</div>
        </div>`
      : `
        <div class="cds-cfg-note" style="display:grid;gap:0.55rem;">
          <div>
            <div class="text-muted" style="font-size:0.75rem;">Valor</div>
            <div style="font-size:1.35rem;font-weight:700;">${formatMoney(w.value)}</div>
          </div>
          ${m.quantidade != null ? `<div><div class="text-muted" style="font-size:0.75rem;">Quantidade</div><div style="font-size:1.1rem;font-weight:600;">${formatQty(m.quantidade)}</div></div>` : ''}
          ${m.percentual != null ? `<div><div class="text-muted" style="font-size:0.75rem;">Percentual (hoje/mês)</div><div style="font-weight:600;">${escapeHtml(String(m.percentual))}%</div></div>` : ''}
          ${(hoje.valor != null || mes.valor != null) ? `
          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0.5rem;">
            <div><div class="text-muted" style="font-size:0.7rem;">Hoje</div><div style="font-weight:600;">${formatMoney(hoje.valor)}</div><div class="text-muted" style="font-size:0.72rem;">${formatQty(hoje.quantidade)} ops</div></div>
            <div><div class="text-muted" style="font-size:0.7rem;">Mês</div><div style="font-weight:600;">${formatMoney(mes.valor)}</div><div class="text-muted" style="font-size:0.72rem;">${formatQty(mes.quantidade)} ops</div></div>
            <div><div class="text-muted" style="font-size:0.7rem;">Ano</div><div style="font-weight:600;">${formatMoney(ano.valor)}</div><div class="text-muted" style="font-size:0.72rem;">${formatQty(ano.quantidade)} ops</div></div>
          </div>` : ''}
          ${ultimoHtml}
          ${m.mock ? `<p class="cds-cfg-hint">${escapeHtml(sanitizeText(m.mensagem || 'Mock — sem SDK'))}</p>` : ''}
        </div>`;

    return `
      <div${wrapAttr}>
        <div class="cds-cfg-card" data-widget-id="${escapeHtml(w.id || '')}">
          <div class="cds-cfg-card__title" style="display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap;">
            <i class="fas ${escapeHtml(w.icon || 'fa-chart-bar')}"></i>
            <span>${escapeHtml(tituloAdaptado)}</span>
            ${badgeTxt ? badge(badgeTxt, isNaoFiscal ? 'warn' : 'info') : ''}
            ${w.health ? badge(w.health, w.health === 'CRITICO' ? 'error' : (w.health === 'ATENCAO' ? 'warn' : 'ok')) : ''}
            <span style="margin-left:auto;">${trendIcon(w.trend)}</span>
          </div>
          ${body}
          <p class="cds-cfg-hint" style="margin-top:0.55rem;font-size:0.72rem;">
            ${escapeHtml(sanitizeText(w.subtitle || ''))}
            ${w.updatedAt ? ` · ${escapeHtml(String(w.updatedAt).slice(0, 19).replace('T', ' '))}` : ''}
          </p>
        </div>
      </div>`;
  }

  function renderWidgetsGrid(widgets) {
    if (!widgets.length) {
      const Empty = UI().CDSEmptyState;
      if (Empty?.render) {
        return Empty.render({ kind: 'empty', title: 'Sem widgets', description: 'Nenhum widget disponível para esta aba.' });
      }
      return `<p class="cds-ui-hint cds-cfg-hint">Nenhum widget disponível para esta aba.</p>`;
    }
    const Grid = UI().CDSGrid;
    const html = widgets.map(renderWidgetCard).join('');
    if (Grid?.render) return Grid.render({ variant: 'widgets', html });
    return `
      <div class="cds-ui-grid cds-ui-grid--widgets" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:0.75rem;">
        ${html}
      </div>`;
  }

  function renderNav(ativa) {
    return obterAbas().map((a) => `
      <button type="button" class="cds-cfg-nav__item${a.id === ativa ? ' is-active' : ''}"
        data-mon-nav="${a.id}">
        <i class="fas ${a.icon}"></i><span>${escapeHtml(a.label)}</span>
      </button>`).join('');
  }

  function paneStub(titulo, descricao) {
    const Empty = UI().CDSEmptyState;
    if (Empty?.render) {
      return Empty.render({
        kind: 'empty',
        title: titulo,
        description: descricao + ' Estrutura visual pronta — provider/widget em sprint futura.'
      });
    }
    return `
      <div class="cds-ui-card cds-cfg-card">
        <div class="cds-ui-card__title cds-cfg-card__title">${escapeHtml(titulo)}</div>
        <p class="cds-ui-hint cds-cfg-hint">${escapeHtml(descricao)}</p>
        <p class="cds-cfg-note">Estrutura visual pronta — provider/widget em sprint futura.</p>
        ${badge('Em breve', 'prep')}
      </div>`;
  }

  function renderSeletorCompetencia(summary) {
    const { ano, mes } = obterCompetenciaUi();
    const ind = summary?.indicadoresFiscais || {};
    const label = ind.competenciaLabel || labelCompetencia(ano, mes);
    const monthValue = `${ano}-${String(mes).padStart(2, '0')}`;
    return `
      <div class="cds-cfg-card" id="cdsMonCompetencia" style="margin-bottom:0.75rem;">
        <div class="cds-cfg-card__title" style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
          <i class="fas fa-calendar-alt"></i>
          <span>Competência fiscal</span>
          ${badge(label, 'info')}
          ${ind.ambienteLabel ? badge(ind.ambienteLabel, ind.ambiente === 1 ? 'ok' : 'warn') : ''}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:flex-end;">
          <label class="cds-cfg-hint" style="margin:0;">
            Mês/Ano
            <input type="month" id="cdsMonCompMesAno" class="form-control form-control-sm"
              value="${escapeHtml(monthValue)}" style="min-width:160px;margin-top:0.2rem;">
          </label>
          <button type="button" class="btn btn-sm btn-primary" id="cdsMonCompAplicar">
            <i class="fas fa-filter"></i> Aplicar competência
          </button>
        </div>
      </div>`;
  }

  function renderIndicadoresFiscaisCards(summary) {
    const ind = summary?.indicadoresFiscais || {};
    const label = ind.competenciaLabel || labelCompetencia(obterCompetenciaUi().ano, obterCompetenciaUi().mes);
    const cards = [
      { titulo: 'Competência', valor: label, detalhe: ind.competencia || '—', icone: 'fa-calendar-check' },
      { titulo: 'Valor Vendido', valor: formatMoney(ind.valorTotalVendido), detalhe: 'Vendas fiscais · data_venda', icone: 'fa-credit-card' },
      { titulo: 'Valor Comprado', valor: formatMoney(ind.valorTotalComprado), detalhe: 'Entradas DF-e · data_emissao', icone: 'fa-download' },
      { titulo: 'NF-e Emitidas', valor: formatQty(ind.quantidadeNfeEmitidas), detalhe: `Autorizadas · ${ind.ambienteLabel || '—'}`, icone: 'fa-file-invoice' }
    ];
    return `
      <div class="cds-ui-grid cds-ui-grid--kpi" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0.75rem;margin-bottom:0.75rem;">
        ${cards.map((c) => `
          <div class="cds-cfg-card">
            <div class="cds-cfg-card__title"><i class="fas ${c.icone}"></i> ${escapeHtml(c.titulo)}</div>
            <div style="font-size:1.35rem;font-weight:700;">${escapeHtml(c.valor)}</div>
            <p class="cds-cfg-hint" style="margin:0.35rem 0 0;">${escapeHtml(c.detalhe)}</p>
          </div>`).join('')}
      </div>`;
  }

  function renderPainelExecutivo(summary) {
    const ind = summary?.indicadoresFiscais || {};
    const widgets = summary?.widgets || [];
    const vendas = widgets.find((w) => w.id === 'fiscal.vendas') || {};
    const receber = widgets.find((w) => w.id === 'financeiro.receber_fiscal') || {};
    const caixa = widgets.find((w) => w.id === 'caixa.fiscal') || {};
    const saude = summary?.cop?.saudeGeral || summary?.intelligence?.health?.geral || '—';
    const saudeTone = saude === 'CRITICO' ? 'error' : (saude === 'ATENCAO' ? 'warn' : 'ok');
    const vendasValor = ind.valorTotalVendido != null ? ind.valorTotalVendido : vendas.value;
    const vendasDetalhe = ind.competenciaLabel
      ? `Competência ${ind.competenciaLabel} · vendas fiscais`
      : sanitizeText(vendas.subtitle || getDescription('vendas') || '—');
    const KPI = UI().CDSKPI;
    const kpiHtml = KPI?.render
      ? [
          KPI.render({ labelDomain: 'vendas', label: getLabel('vendas'), value: formatMoney(vendasValor), detail: vendasDetalhe, tone: 'ok' }),
          KPI.render({ labelDomain: 'receber', label: getLabel('receber'), value: formatMoney(receber.value), detail: sanitizeText(receber.subtitle || '—'), tone: 'info' }),
          KPI.render({ labelDomain: 'caixa', label: getLabel('caixa'), value: formatMoney(caixa.value), detail: sanitizeText(caixa.subtitle || '—'), tone: 'ok' }),
          KPI.render({ label: getLabel('saude_operacional'), valueHtml: badge(String(saude), saudeTone), detail: getLabel('cop'), tone: saudeTone })
        ].join('')
      : '';
    if (KPI?.render && kpiHtml) {
      // Um único grid — não aninhar cds-cfg-exec > CDSGrid (quebra em 1 coluna).
      return `<div class="cds-ui-grid cds-ui-grid--kpi cds-cfg-exec" aria-label="KPIs do Monitoring Engine">${kpiHtml}</div>`;
    }
    return `
      <div class="cds-cfg-exec" aria-label="KPIs do Monitoring Engine">
        <div class="cds-cfg-kpi">
          <div class="cds-cfg-kpi__head"><p class="cds-cfg-kpi__label">${escapeHtml(getLabel('vendas'))}</p><span class="cds-cfg-dot" data-tone="ok"></span></div>
          <p class="cds-cfg-kpi__value">${formatMoney(vendasValor)}</p>
          <p class="cds-cfg-kpi__detail">${escapeHtml(vendasDetalhe)}</p>
        </div>
        <div class="cds-cfg-kpi">
          <div class="cds-cfg-kpi__head"><p class="cds-cfg-kpi__label">${escapeHtml(getLabel('receber'))}</p><span class="cds-cfg-dot" data-tone="info"></span></div>
          <p class="cds-cfg-kpi__value">${formatMoney(receber.value)}</p>
          <p class="cds-cfg-kpi__detail">${escapeHtml(sanitizeText(receber.subtitle || '—'))}</p>
        </div>
        <div class="cds-cfg-kpi">
          <div class="cds-cfg-kpi__head"><p class="cds-cfg-kpi__label">${escapeHtml(getLabel('caixa'))}</p><span class="cds-cfg-dot" data-tone="ok"></span></div>
          <p class="cds-cfg-kpi__value">${formatMoney(caixa.value)}</p>
          <p class="cds-cfg-kpi__detail">${escapeHtml(sanitizeText(caixa.subtitle || '—'))}</p>
        </div>
        <div class="cds-cfg-kpi">
          <div class="cds-cfg-kpi__head"><p class="cds-cfg-kpi__label">${escapeHtml(getLabel('saude_operacional'))}</p><span class="cds-cfg-dot" data-tone="${saudeTone}"></span></div>
          <p class="cds-cfg-kpi__value">${badge(String(saude), saudeTone)}</p>
          <p class="cds-cfg-kpi__detail">${escapeHtml(getLabel('cop'))}</p>
        </div>
      </div>`;
  }

  function renderPanes(summary) {
    const ativa = (id) => (estado.abaAtiva === id ? ' is-active' : '');
    const widgets = summary?.widgets || [];
    return `
      <div class="cds-cfg-pane${ativa('geral')}" data-mon-pane="geral">
        ${renderRecommendedActions(summary)}
        ${renderCop(summary)}
        ${renderWorkQueue(summary)}
        ${renderTimeline(summary)}
        ${renderActionHistory()}
        <div class="cds-cfg-card">
          <div class="cds-cfg-card__title">${escapeHtml(getLabel('insights'))}</div>
          <ul class="cds-cfg-note" style="list-style:none;padding:0;margin:0;display:grid;gap:0.35rem;">
            ${((summary?.intelligence?.insights) || []).slice(0, 6).map((i) => `
              <li>
                <i class="fas ${escapeHtml(i.icon || 'fa-lightbulb')}"></i> ${escapeHtml(sanitizeText(i.mensagem || ''))}
                ${renderActionButtons((i.actions || []).slice(0, 2))}
              </li>`).join('') || '<li>Nenhum insight disponível.</li>'}
          </ul>
        </div>
      </div>
      <div class="cds-cfg-pane${ativa('fiscal')}" data-mon-pane="fiscal">
        ${renderWidgetsGrid(filtrarWidgets(widgets, 'fiscal'))}
        <p class="cds-cfg-hint" style="margin-top:0.85rem;">Fonte: Monitoring Engine · Widget Builder.</p>
      </div>
      <div class="cds-cfg-pane${ativa('financeiro')}" data-mon-pane="financeiro">
        ${renderWidgetsGrid(filtrarWidgets(widgets, 'financeiro'))}
        <p class="cds-cfg-hint" style="margin-top:0.85rem;">Indicadores financeiros via FinanceiroProvider.</p>
      </div>
      <div class="cds-cfg-pane${ativa('caixa')}" data-mon-pane="caixa">
        ${renderWidgetsGrid(filtrarWidgets(widgets, 'caixa'))}
        <p class="cds-cfg-hint" style="margin-top:0.85rem;">Indicadores de caixa via CaixaProvider.</p>
      </div>
      <div class="cds-cfg-pane${ativa('estoque')}" data-mon-pane="estoque">
        ${paneStub(getLabel('estoque'), getDescription('estoque') || 'Saldos, rupturas e validade.')}
      </div>
      <div class="cds-cfg-pane${ativa('recebimentos')}" data-mon-pane="recebimentos">
        ${renderWidgetsGrid(filtrarWidgets(widgets, 'recebimentos'))}
        <p class="cds-cfg-hint" style="margin-top:0.85rem;">${escapeHtml(getLabel('pix'))} · ${escapeHtml(getLabel('dinheiro'))} · ${escapeHtml(getLabel('cartao'))} · ${escapeHtml(getLabel('tef'))}.</p>
      </div>
      <div class="cds-cfg-pane${ativa('comercial')}" data-mon-pane="comercial">
        ${paneStub(getLabel('comercial'), getDescription('comercial') || 'Ticket médio, ranking e performance de vendas.')}
      </div>
      <div class="cds-cfg-pane${ativa('alertas')}" data-mon-pane="alertas">
        <div style="display:grid;gap:0.65rem;">
          ${((summary?.intelligence?.alerts) || []).map((a) => `
            <div class="cds-cfg-card">
              <div class="cds-cfg-card__title">${badge(a.severidade || 'INFO', a.severidade === 'CRITICO' ? 'error' : 'warn')} ${escapeHtml(sanitizeText(a.titulo || ''))}</div>
              <p class="cds-cfg-hint">${escapeHtml(sanitizeText(a.descricao || ''))}</p>
              <p class="cds-cfg-note">${escapeHtml(sanitizeText(a.dominio || ''))} · ${escapeHtml(String(a.timestamp || '').slice(0, 19))}</p>
              ${renderActionButtons(a.actions || [])}
            </div>`).join('') || paneStub(getLabel('alertas'), 'Nenhum alerta ativo.')}
        </div>
        <div style="margin-top:0.75rem;">
          <div class="cds-cfg-card__title">${escapeHtml(getLabel('recomendacoes'))}</div>
          ${((summary?.intelligence?.recommendations) || []).map((r) => `
            <div class="cds-cfg-note" style="margin-bottom:0.5rem;">
              <strong>${escapeHtml(sanitizeText(r.titulo || ''))}</strong> — ${escapeHtml(sanitizeText(r.descricao || ''))}
              ${renderActionButtons(r.actions || [])}
            </div>`).join('') || '<p class="cds-cfg-hint">Sem recomendações.</p>'}
        </div>
      </div>
      <div class="cds-cfg-pane${ativa('indicadores')}" data-mon-pane="indicadores">
        ${renderIndicadoresFiscaisCards(summary)}
        <p class="cds-cfg-hint">Indicadores consolidados via IndicadoresFiscaisService · competência mensal.</p>
      </div>`;
  }

  function ativarAba(id) {
    const abas = obterAbas();
    const aba = abas.find((a) => a.id === id) || abas[0];
    estado.abaAtiva = aba.id;
    document.querySelectorAll('[data-mon-nav]').forEach((el) => {
      el.classList.toggle('is-active', el.getAttribute('data-mon-nav') === aba.id);
    });
    document.querySelectorAll('[data-mon-pane]').forEach((el) => {
      el.classList.toggle('is-active', el.getAttribute('data-mon-pane') === aba.id);
    });
  }

  function aplicarVisibilidadeF12() {
    const ocultar = !shouldShowNaoFiscal();
    document.querySelectorAll('[data-mon-nao-fiscal]').forEach((el) => {
      el.style.display = ocultar ? 'none' : '';
    });
    const exec = document.getElementById('cdsMonExecWrap');
    if (exec && estado.summary) {
      exec.innerHTML = renderPainelExecutivo(estado.summary);
    }
    // Re-render nav labels when mode toggles without full reload
    const nav = document.querySelector('#cdsMonitoringEngine .cds-cfg-nav');
    if (nav) {
      nav.innerHTML = renderNav(estado.abaAtiva);
    }
  }

  function bindUi() {
    const host = document.getElementById('page-content');
    if (host && host.dataset.cdsMonDelegate !== '1') {
      host.dataset.cdsMonDelegate = '1';
      host.addEventListener('click', (ev) => {
        if (!host.querySelector('#cdsMonitoringEngine')) return;

        const navBtn = ev.target.closest('[data-mon-nav]');
        if (navBtn && host.contains(navBtn)) {
          ev.preventDefault();
          ativarAba(navBtn.getAttribute('data-mon-nav'));
          return;
        }

        const refreshBtn = ev.target.closest('#cdsMonRefresh');
        if (refreshBtn && host.contains(refreshBtn)) {
          ev.preventDefault();
          carregarSummary(true);
          return;
        }

        const compBtn = ev.target.closest('#cdsMonCompAplicar');
        if (compBtn && host.contains(compBtn)) {
          ev.preventDefault();
          const mesAnoEl = document.getElementById('cdsMonCompMesAno');
          const raw = String(mesAnoEl?.value || '');
          const match = raw.match(/^(\d{4})-(\d{2})$/);
          if (match) {
            estado.competenciaAno = Number(match[1]);
            estado.competenciaMes = Number(match[2]);
          } else {
            const padrao = competenciaAtualPadrao();
            estado.competenciaAno = padrao.ano;
            estado.competenciaMes = padrao.mes;
          }
          carregarSummary(true);
          return;
        }

        const actionBtn = ev.target.closest('.cds-mon-action');
        if (actionBtn && host.contains(actionBtn)) {
          ev.preventDefault();
          const action = parseActionAttr(actionBtn);
          if (action) executarAction(action);
          else notify('Não foi possível executar a navegação sugerida.', 'warning');
        }
      });
    }
  }

  function renderShell(summary) {
    const Hero = UI().CDSHero;
    const meta = `
      ${badge('M4 Action Center', 'info')}
      ${badge('COP Interativo', 'prep')}
      <button type="button" class="btn btn-sm btn-light" id="cdsMonRefresh" style="margin-left:auto;">
        <i class="fas fa-sync-alt"></i> Atualizar
      </button>`;
    const heroHtml = Hero?.render
      ? Hero.render({
          icon: 'fa-chart-pie',
          title: getLabel('monitoramento'),
          subtitle: `${getDescription('monitoramento') || getLabel('cop')} — Action Center · Intelligence · Executive Insights.`,
          metaHtml: meta
        })
      : `
        <div class="cds-ui-hero cds-cfg-hero">
          <h1 class="cds-ui-hero__title cds-cfg-hero__title">
            <i class="fas fa-chart-pie" aria-hidden="true"></i>
            ${escapeHtml(getLabel('monitoramento'))}
          </h1>
          <p class="cds-ui-hero__sub cds-cfg-hero__sub">
            ${escapeHtml(getDescription('monitoramento') || getLabel('cop'))} — Action Center · Intelligence · Executive Insights.
          </p>
          <div class="cds-ui-hero__meta cds-cfg-hero__meta">${meta}</div>
        </div>`;

    const html = `
      <div class="cds-ui cds-cfg" id="cdsMonitoringEngine">
        ${heroHtml}
        ${renderSeletorCompetencia(summary)}
        ${renderExecutiveInsights(summary)}
        <div id="cdsMonExecWrap">${renderPainelExecutivo(summary)}</div>
        <div class="cds-ui-shell cds-cfg-shell">
          <nav class="cds-ui-tabs cds-cfg-nav" aria-label="Categorias de monitoramento">${renderNav(estado.abaAtiva)}</nav>
          <div class="cds-cfg-main" id="cdsMonMain">${renderPanes(summary)}</div>
        </div>
      </div>`;
    $('#page-content').html(html);
    bindUi();
    ativarAba(estado.abaAtiva);
    aplicarVisibilidadeF12();
  }

  async function carregarSummary(force) {
    if (estado.carregando && !force) return;
    estado.carregando = true;
    estado.erro = null;
    try {
      const token = localStorage.getItem('token');
      const resp = await fetch(`${global.API_URL}/monitoring/summary?${montarQueryCompetencia()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await resp.json();
      if (!resp.ok && resp.status !== 207) {
        throw new Error(json.message || json.error || 'Falha ao carregar monitoramento');
      }
      if (json.competencia?.ano) estado.competenciaAno = json.competencia.ano;
      if (json.competencia?.mes) estado.competenciaMes = json.competencia.mes;
      estado.summary = json;
      renderShell(json);
    } catch (err) {
      estado.erro = err.message || String(err);
      $('#page-content').html(`
        <div class="cds-cfg">
          <div class="cds-cfg-hero">
            <h1 class="cds-cfg-hero__title">${escapeHtml(getLabel('monitoramento'))}</h1>
            <p class="cds-cfg-hero__sub">Não foi possível obter o summary do Monitoring Engine.</p>
          </div>
          <div class="alert alert-danger">${escapeHtml(estado.erro)}</div>
          <button type="button" class="btn btn-primary" id="cdsMonRetry">Tentar novamente</button>
        </div>`);
      document.getElementById('cdsMonRetry')?.addEventListener('click', () => carregarSummary(true));
    } finally {
      estado.carregando = false;
    }
  }

  function loadMonitoringEngine() {
    const padrao = competenciaAtualPadrao();
    estado.abaAtiva = 'geral';
    estado.competenciaAno = padrao.ano;
    estado.competenciaMes = padrao.mes;
    $('#page-content').html(`
      <div class="cds-cfg">
        <div class="cds-cfg-hero">
          <h1 class="cds-cfg-hero__title"><i class="fas fa-chart-pie"></i> ${escapeHtml(getLabel('monitoramento'))}</h1>
          <p class="cds-cfg-hero__sub">Carregando ${escapeHtml(getShortLabel('cop'))} Action Center…</p>
        </div>
      </div>`);
    carregarSummary(true);
  }

  function atualizarMonitoringModoFiscal() {
    if (typeof currentPage !== 'undefined' && currentPage === 'monitoring') {
      if (estado.summary) {
        renderShell(estado.summary);
      } else {
        aplicarVisibilidadeF12();
      }
    }
  }

  global.loadMonitoringEngine = loadMonitoringEngine;
  global.atualizarMonitoringModoFiscal = atualizarMonitoringModoFiscal;
  global.carregarMonitoringSummary = carregarSummary;
})(window);
