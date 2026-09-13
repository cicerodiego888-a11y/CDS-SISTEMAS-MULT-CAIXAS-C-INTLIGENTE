/**
 * UX COMMAND CENTER 1.0 — componentes visuais do Dashboard.
 * Não altera APIs, KPIs calculados no backend nem regras de negócio.
 * Deriva apenas apresentação a partir do payload já carregado.
 */
(function (global) {
  'use strict';

  const PRIORIDADE = { danger: 0, warn: 1, info: 2 };

  function esc(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function moeda(valor) {
    if (typeof formatarMoedaDashboard === 'function') {
      return formatarMoedaDashboard(valor);
    }
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function obterNomeUsuario() {
    let user = {};
    try {
      if (typeof obterUsuarioLogado === 'function') {
        user = obterUsuarioLogado() || {};
      } else {
        user = JSON.parse(localStorage.getItem('user') || '{}');
      }
    } catch (e) {
      user = {};
    }
    return user.nome || user.name || user.username || user.usuario || 'Gestor';
  }

  function saudacaoPorHora(date) {
    const h = date.getHours();
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  function dataCompletaPt(date) {
    const texto = date.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  function diasPeriodo(periodo) {
    if (!periodo || !periodo.inicio || !periodo.fim) return 1;
    const a = new Date(String(periodo.inicio) + 'T12:00:00');
    const b = new Date(String(periodo.fim) + 'T12:00:00');
    const diff = Math.round((b - a) / 86400000) + 1;
    return Math.max(diff, 1);
  }

  function fiscalPermitido() {
    if (typeof fiscalHabilitado === 'function') return fiscalHabilitado();
    if (typeof implantacaoPermiteFiscal === 'function') return implantacaoPermiteFiscal();
    return !!(global.CONFIG_IMPLANTACAO && global.CONFIG_IMPLANTACAO.recursos && global.CONFIG_IMPLANTACAO.recursos.fiscal);
  }

  function horaCompletaPt(date) {
    return date.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  let _relogioTimer = null;

  function atualizarRelogioHero(date) {
    const elClock = document.getElementById('ccHeroClock');
    if (!elClock) return;
    elClock.textContent = horaCompletaPt(date || new Date());
  }

  function iniciarRelogioHero() {
    atualizarRelogioHero();
    if (_relogioTimer) return;
    _relogioTimer = setInterval(function () {
      atualizarRelogioHero();
    }, 1000);
  }

  /* —— Componentes —— */

  function DashboardHero(opts) {
    const elGreeting = document.getElementById('ccHeroGreeting');
    const elDate = document.getElementById('ccHeroDate');
    const elStatus = document.getElementById('ccHeroStatus');
    const now = opts.now || new Date();

    if (elGreeting) {
      elGreeting.textContent = `${saudacaoPorHora(now)}, ${opts.nome || obterNomeUsuario()}`;
    }
    if (elDate) {
      elDate.textContent = dataCompletaPt(now);
    }
    atualizarRelogioHero(now);
    iniciarRelogioHero();
    if (elStatus) {
      const tone = opts.tone || 'ok';
      const label = opts.statusLabel || 'Operação estável';
      elStatus.dataset.tone = tone;
      elStatus.innerHTML = `<i class="fas fa-circle" style="font-size:0.45rem"></i> ${esc(label)}`;
    }
  }

  function DashboardSection() {
    /* Marcador estrutural — seções vivem no HTML. */
    return null;
  }

  function DashboardKPI(crescimentoTexto) {
    const el = document.getElementById('dashboardCrescimento');
    if (el) el.textContent = crescimentoTexto;
  }

  function calcularCrescimento(data) {
    const dias = diasPeriodo(data.periodo);
    const fatPeriodo = Number(data.faturamento || 0);
    const fatHoje = Number(data.faturamento_hoje || 0);
    const media = fatPeriodo / dias;
    if (media <= 0 && fatHoje <= 0) return '—';
    if (media <= 0) return '+100%';
    const pct = ((fatHoje - media) / media) * 100;
    const sinal = pct > 0 ? '+' : '';
    return `${sinal}${pct.toFixed(1).replace('.', ',')}%`;
  }

  function montarDetalhesEstoqueBaixo(lista) {
    return `<ul class="cc-alert__detail-list">${lista.map((p) => {
      const atual = typeof obterEstoqueExibicaoSimplesProduto === 'function'
        ? obterEstoqueExibicaoSimplesProduto(p)
        : Number(p.estoque_atual || 0);
      return `
      <li>
        <span class="cc-alert__detail-name">${esc(p.nome || 'Produto')}</span>
        <span class="cc-alert__detail-meta">${esc(atual)} / mín. ${esc(Number(p.estoque_minimo || 0))} ${esc(p.unidade || '')}</span>
      </li>`;
    }).join('')}</ul>`;
  }

  function DashboardAlert(itens) {
    const root = document.getElementById('ccAlertsList');
    if (!root) return;

    if (!itens || itens.length === 0) {
      root.innerHTML = '<div class="cc-alerts-empty"><i class="fas fa-check-circle me-1"></i> Nenhum alerta no momento. Operação sob controle.</div>';
      return;
    }

    const ordenados = itens.slice().sort((a, b) => {
      const pa = PRIORIDADE[a.priority] ?? 9;
      const pb = PRIORIDADE[b.priority] ?? 9;
      return pa - pb;
    });

    root.innerHTML = `<ul class="cc-alerts">${ordenados.map((item) => {
      const hasDetails = Boolean(item.detailsHtml);
      return `
      <li class="cc-alert${hasDetails ? ' cc-alert--expandable' : ''}"
          data-priority="${esc(item.priority || 'info')}"
          ${hasDetails ? 'role="button" tabindex="0" aria-expanded="false" title="Clique para ver os itens"' : ''}>
        <span class="cc-alert__icon"><i class="fas fa-exclamation-triangle"></i></span>
        <div class="cc-alert__body">
          <div class="cc-alert__text">
            ${esc(item.text)}
            ${hasDetails ? '<i class="fas fa-chevron-down cc-alert__chevron" aria-hidden="true"></i>' : ''}
          </div>
          ${hasDetails ? `<div class="cc-alert__details" hidden>${item.detailsHtml}</div>` : ''}
        </div>
        ${item.actionHtml || ''}
      </li>`;
    }).join('')}</ul>`;

    root.querySelectorAll('.cc-alert--expandable').forEach((el) => {
      const toggle = () => {
        const details = el.querySelector('.cc-alert__details');
        const open = !el.classList.contains('is-open');
        el.classList.toggle('is-open', open);
        el.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (details) details.hidden = !open;
      };
      el.addEventListener('click', (e) => {
        if (e.target.closest('.cc-alert__action')) return;
        toggle();
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    });
  }

  function montarAlertas(data, vencExtras) {
    const itens = [];
    const estoque = data.estoque_baixo || [];
    const eq = data.equipamentos || {};
    const sync = data.sincronizacoes || {};
    const alerts = data.alerts || {};
    const pagar = data.contas_pagar || {};
    const vencidos = vencExtras?.vencidos || data.produtos_vencidos || [];
    const proximos = vencExtras?.proximos || data.produtos_proximo_vencimento || [];

    if (estoque.length > 0) {
      itens.push({
        priority: 'danger',
        text: `${estoque.length} produto(s) com estoque baixo`,
        detailsHtml: montarDetalhesEstoqueBaixo(estoque)
      });
    }
    if (Array.isArray(vencidos) && vencidos.length > 0) {
      itens.push({
        priority: 'danger',
        text: `${vencidos.length} produto(s) vencido(s)`
      });
    }
    if (Number(eq.offline || 0) > 0) {
      itens.push({
        priority: 'danger',
        text: `${eq.offline} equipamento(s) offline`
      });
    }
    if (Number(sync.erros || 0) > 0) {
      itens.push({
        priority: 'danger',
        text: `${sync.erros} erro(s) de sincronização`
      });
    }
    if (alerts.backup_atrasado) {
      itens.push({
        priority: 'danger',
        text: 'Backup atrasado (mais de 24 horas)'
      });
    }
    if (Array.isArray(proximos) && proximos.length > 0) {
      itens.push({
        priority: 'warn',
        text: `${proximos.length} produto(s) próximos do vencimento`
      });
    }
    if (Number(pagar.quantidade || 0) > 0) {
      itens.push({
        priority: 'warn',
        text: `${pagar.quantidade} conta(s) a pagar · ${moeda(pagar.total)}`
      });
    }
    if (Number(sync.pendentes || 0) > 0) {
      itens.push({
        priority: 'warn',
        text: `${sync.pendentes} sincronização(ões) pendente(s)`
      });
    }
    if (Number(alerts.delecoes_24h || 0) > 0) {
      itens.push({
        priority: 'warn',
        text: `${alerts.delecoes_24h} deleção(ões) nas últimas 24h`
      });
    }
    if (Array.isArray(alerts.persistentes)) {
      alerts.persistentes.forEach((a) => {
        itens.push({
          priority: 'warn',
          text: `${a.tipo || 'Alerta'}: ${a.descricao || 'Atenção necessária'}`,
          actionHtml: a.id
            ? `<div class="cc-alert__action"><button type="button" class="btn btn-sm btn-outline-success" onclick="resolverAlerta(${Number(a.id)})">Resolver</button></div>`
            : ''
        });
      });
    }
    if (Number(eq.fila || 0) > 0) {
      itens.push({
        priority: 'info',
        text: `${eq.fila} equipamento(s) com fila pendente`
      });
    }

    return itens;
  }

  function DashboardHealth(itens) {
    const root = document.getElementById('ccHealthGrid');
    if (!root) return;

    root.innerHTML = itens.map((item) => `
      <div class="cc-health">
        <div class="cc-health__left">
          <i class="fas ${esc(item.icon)}"></i>
          <span>${esc(item.label)}</span>
        </div>
        <span class="cc-health__badge" data-tone="${esc(item.tone)}">
          <span class="cc-health__dot"></span>
          ${esc(item.status)}
        </span>
      </div>
    `).join('');
  }

  function montarSaude(data) {
    const eq = data.equipamentos || {};
    const alerts = data.alerts || {};
    const sync = data.sincronizacoes || {};
    const fiscalOk = fiscalPermitido();
    const eqOk = Number(eq.offline || 0) === 0;
    const backupOk = !alerts.backup_atrasado;
    const syncOk = Number(sync.erros || 0) === 0;

    return [
      fiscalOk && {
        label: 'MIIP',
        icon: 'fa-brain',
        tone: 'ok',
        status: 'OK'
      },
      fiscalOk && {
        label: 'Central',
        icon: 'fa-inbox',
        tone: 'ok',
        status: 'OK'
      },
      fiscalOk && {
        label: 'Fiscal',
        icon: 'fa-file-invoice',
        tone: 'ok',
        status: 'OK'
      },
      {
        label: 'Equipamentos',
        icon: 'fa-desktop',
        tone: eqOk && syncOk ? 'ok' : 'danger',
        status: eqOk && syncOk ? 'OK' : 'Atenção'
      },
      {
        label: 'Backup',
        icon: 'fa-database',
        tone: backupOk ? 'ok' : 'danger',
        status: backupOk ? 'OK' : 'Atrasado'
      }
    ].filter(Boolean);
  }

  function DashboardTimeline(itens) {
    const root = document.getElementById('ccTimeline');
    if (!root) return;

    if (!itens || itens.length === 0) {
      root.innerHTML = '<div class="cc-timeline-empty">Sem eventos recentes para exibir.</div>';
      return;
    }

    root.innerHTML = `<ul class="cc-timeline">${itens.map((item) => `
      <li class="cc-timeline__item" data-kind="${esc(item.kind || 'info')}">
        <div class="cc-timeline__meta">${esc(item.meta)}</div>
        <p class="cc-timeline__text">${esc(item.text)}</p>
      </li>
    `).join('')}</ul>`;
  }

  function montarTimeline(data) {
    const itens = [];
    const vendasHoje = Number(data.vendas_hoje || 0);
    const fatHoje = data.faturamento_hoje;
    const mais = (data.mais_vendidos || data.produtos_mais_vendidos || []).slice(0, 2);
    const backups = (data.backups?.recentes || []).slice(0, 2);
    const formas = (data.vendas_por_forma_pagamento || []).slice(0, 2);
    const estoque = (data.estoque_baixo || []).slice(0, 2);
    const alerts = data.alerts || {};

    if (vendasHoje > 0) {
      itens.push({
        kind: 'ok',
        meta: 'Venda',
        text: `${vendasHoje} venda(s) hoje · ${moeda(fatHoje)}`
      });
    }

    mais.forEach((p) => {
      itens.push({
        kind: 'info',
        meta: 'Produto',
        text: `Mais vendido: ${p.nome || '—'}`
      });
    });

    formas.forEach((f) => {
      const label = typeof labelFormaPagamentoDashboard === 'function'
        ? labelFormaPagamentoDashboard(f.forma_pagamento)
        : (f.forma_pagamento || 'Pagamento');
      itens.push({
        kind: 'info',
        meta: 'NFC-e / Pagamento',
        text: `${label}: ${moeda(f.total)} (${Number(f.quantidade || 0)} venda(s))`
      });
    });

    estoque.forEach((p) => {
      itens.push({
        kind: 'warn',
        meta: 'Estoque',
        text: `Estoque baixo: ${p.nome || 'produto'}`
      });
    });

    backups.forEach((b) => {
      itens.push({
        kind: 'ok',
        meta: 'Backup',
        text: b.arquivo || 'Backup registrado'
      });
    });

    if (Number(alerts.delecoes_24h || 0) > 0) {
      itens.push({
        kind: 'danger',
        meta: 'Auditoria',
        text: `${alerts.delecoes_24h} deleção(ões) nas últimas 24h`
      });
    }

    if (Number(data.auditoria?.ultimos_7_dias || 0) > 0) {
      itens.push({
        kind: 'info',
        meta: 'Sistema',
        text: `${data.auditoria.ultimos_7_dias} ação(ões) nos últimos 7 dias`
      });
    }

    return itens.slice(0, 10);
  }

  function DashboardOperationCard(id, summary, tone) {
    const sumEl = document.getElementById(id + 'Summary');
    const dotEl = document.getElementById(id + 'Dot');
    if (sumEl) sumEl.textContent = summary;
    if (dotEl) dotEl.dataset.tone = tone || 'ok';
  }

  function atualizarOperacao(data, alertas) {
    const vendasHoje = Number(data.vendas_hoje || 0);
    const receber = data.contas_receber || {};
    const pagar = data.contas_pagar || {};
    const temAlertaCritico = alertas.some((a) => a.priority === 'danger');
    const temAlertaWarn = alertas.some((a) => a.priority === 'warn');
    const fiscalOk = fiscalPermitido();

    DashboardOperationCard(
      'ccOpPdv',
      `${vendasHoje} venda(s) hoje · ${moeda(data.faturamento_hoje)}`,
      vendasHoje > 0 ? 'ok' : 'muted'
    );

    DashboardOperationCard(
      'ccOpFin',
      `Receber ${moeda(receber.total)} · Pagar ${moeda(pagar.total)}`,
      Number(pagar.quantidade || 0) > 0 ? 'warn' : 'ok'
    );

    DashboardOperationCard(
      'ccOpCompras',
      'Entradas e pedidos de compra',
      'ok'
    );

    if (fiscalOk) {
      DashboardOperationCard(
        'ccOpFiscal',
        'Documentos e emissão fiscal',
        'ok'
      );

      DashboardOperationCard(
        'ccOpCentral',
        'Documentos e XML de entrada',
        temAlertaCritico || temAlertaWarn ? 'warn' : 'ok'
      );
    }

    return { temAlertaCritico, temAlertaWarn };
  }

  function statusEmpresa(alertas) {
    const danger = alertas.filter((a) => a.priority === 'danger').length;
    const warn = alertas.filter((a) => a.priority === 'warn').length;
    if (danger > 0) {
      return { tone: 'danger', label: `${danger} item(ns) exigem ação` };
    }
    if (warn > 0) {
      return { tone: 'warn', label: `${warn} ponto(s) de atenção` };
    }
    return { tone: 'ok', label: 'Empresa sob controle' };
  }

  let _ultimoPayload = null;
  let _vencExtras = { proximos: null, vencidos: null };

  function atualizarCommandCenter(data) {
    if (!data) return;
    _ultimoPayload = data;

    const alertas = montarAlertas(data, _vencExtras);
    const status = statusEmpresa(alertas);

    DashboardHero({
      nome: obterNomeUsuario(),
      tone: status.tone,
      statusLabel: status.label
    });

    if (typeof aplicarIdentidadeVisualCds === 'function') {
      aplicarIdentidadeVisualCds();
    } else if (typeof BrandService !== 'undefined') {
      document.querySelectorAll('[data-brand="nome"]').forEach((el) => {
        el.textContent = BrandService.NOME;
      });
      document.querySelectorAll('[data-brand="slogan"]').forEach((el) => {
        el.innerHTML = BrandService.SLOGAN.replace(', ', ',<br>');
      });
    }

    DashboardKPI(calcularCrescimento(data));
    DashboardAlert(alertas);
    DashboardHealth(montarSaude(data));
    DashboardTimeline(montarTimeline(data));
    atualizarOperacao(data, alertas);
  }

  function atualizarCommandCenterVencimentos(proximos, vencidos) {
    _vencExtras = {
      proximos: Array.isArray(proximos) ? proximos : [],
      vencidos: Array.isArray(vencidos) ? vencidos : []
    };
    if (_ultimoPayload) {
      atualizarCommandCenter(_ultimoPayload);
    }
  }

  function abrirModuloDashboard(page) {
    if (page === 'pdv') {
      const recursos = (typeof obterRecursosImplantacao === 'function') ? obterRecursosImplantacao() : {};
      if (recursos.pdv === false) {
        if (typeof showNotification === 'function') {
          showNotification('Módulo PDV não está licenciado.', 'warning');
        }
        return;
      }
      if (typeof abrirModuloCdsEmOutraJanela === 'function') {
        abrirModuloCdsEmOutraJanela('/pdv', 'cds-pdv');
      } else {
        window.open('/pdv', 'cds-pdv');
      }
      return;
    }
    if (typeof paginaPermitidaPorImplantacao === 'function' && !paginaPermitidaPorImplantacao(page)) {
      if (typeof showNotification === 'function') {
        showNotification('Módulo não disponível nesta implantação.', 'warning');
      }
      return;
    }
    if (typeof loadPage === 'function') {
      loadPage(page);
    }
  }

  global.DashboardHero = DashboardHero;
  global.DashboardSection = DashboardSection;
  global.DashboardKPI = DashboardKPI;
  global.DashboardHealth = DashboardHealth;
  global.DashboardAlert = DashboardAlert;
  global.DashboardTimeline = DashboardTimeline;
  global.DashboardOperationCard = DashboardOperationCard;
  global.atualizarCommandCenter = atualizarCommandCenter;
  global.atualizarCommandCenterVencimentos = atualizarCommandCenterVencimentos;
  global.abrirModuloDashboard = abrirModuloDashboard;
})(window);
