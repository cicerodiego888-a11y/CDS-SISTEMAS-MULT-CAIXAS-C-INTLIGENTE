/**
 * Card Margem Bruta Real — leitura + polling único de 10s.
 */
(function (global) {
  'use strict';

  const POLL_MS = 10000;
  const TIMER_KEY = '__CDS_MARGEM_BRUTA_TIMER__';
  const INFLIGHT_KEY = '__CDS_MARGEM_BRUTA_INFLIGHT__';
  const SEQ_KEY = '__CDS_MARGEM_BRUTA_SEQ__';

  function apiUrl() {
    if (typeof API_URL === 'string' && API_URL.trim() !== '') return API_URL;
    return `${window.location.origin}/api`;
  }

  function moeda(valor) {
    if (typeof formatarMoedaDashboard === 'function') {
      return formatarMoedaDashboard(valor);
    }
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function pct(valor) {
    return `${Number(valor || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}% de margem`;
  }

  function setTexto(id, valor) {
    const el = document.getElementById(id);
    if (el) el.textContent = valor;
  }

  function periodoDashboardAtual() {
    const inicioEl = document.getElementById('dashboardDataInicio');
    const fimEl = document.getElementById('dashboardDataFim');
    const inicio = (inicioEl && inicioEl.value)
      || (typeof dataDiasAtrasDashboard === 'function' ? dataDiasAtrasDashboard(7) : '');
    const fim = (fimEl && fimEl.value)
      || (typeof dataHojeDashboard === 'function' ? dataHojeDashboard() : '');
    return { inicio, fim };
  }

  function aplicarResumoMargemBruta(resumo) {
    if (!document.getElementById('ccMargemBrutaDashboardKpi')) {
      return;
    }
    const fat = resumo && resumo.faturamento_bruto;
    const cmv = resumo && resumo.custo_mercadoria;
    const lucro = resumo && resumo.lucro_bruto;
    const margem = resumo && resumo.margem_bruta;

    setTexto('dashboardMargemBrutaLucro', moeda(lucro));
    setTexto('dashboardMargemBrutaPct', pct(margem));
    setTexto('dashboardMargemBrutaFat', moeda(fat));
    setTexto('dashboardMargemBrutaCmv', moeda(cmv));

    global.__CDS_MARGEM_BRUTA_ATUALIZADO_EM__ = Date.now();
    atualizarLabelAtualizacaoMargemBruta();
  }

  function atualizarLabelAtualizacaoMargemBruta() {
    const el = document.getElementById('ccMargemBrutaAgo');
    if (!el) return;
    const ts = Number(global.__CDS_MARGEM_BRUTA_ATUALIZADO_EM__ || 0);
    if (!ts) {
      el.textContent = 'Atualizado: —';
      return;
    }
    const segundos = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    el.textContent = `Atualizado: há ${segundos}s`;
  }

  async function carregarResumoMargemBruta() {
    if (!document.getElementById('ccMargemBrutaDashboardKpi')) {
      pararPollMargemBruta();
      return null;
    }
    if (global[INFLIGHT_KEY]) return global[INFLIGHT_KEY];

    const seq = (Number(global[SEQ_KEY] || 0) + 1);
    global[SEQ_KEY] = seq;
    const { inicio, fim } = periodoDashboardAtual();
    const qs = `inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}`;

    const req = (async function () {
      try {
        const response = await fetch(`${apiUrl()}/dashboard/margem-bruta/resumo?${qs}`, {
          headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
          }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || 'Erro ao carregar margem bruta.');
        }
        if (seq !== global[SEQ_KEY]) return data;
        aplicarResumoMargemBruta(data);
        return data;
      } catch (err) {
        console.error('Erro margem bruta:', err);
        return null;
      } finally {
        if (global[INFLIGHT_KEY] === req) {
          global[INFLIGHT_KEY] = null;
        }
      }
    })();

    global[INFLIGHT_KEY] = req;
    return req;
  }

  function pararPollMargemBruta() {
    if (global[TIMER_KEY]) {
      clearInterval(global[TIMER_KEY]);
      global[TIMER_KEY] = null;
    }
  }

  function iniciarPollMargemBruta() {
    if (global[TIMER_KEY]) return;
    global[TIMER_KEY] = setInterval(function () {
      carregarResumoMargemBruta();
    }, POLL_MS);
  }

  function initMargemBrutaHeader() {
    if (!document.getElementById('ccMargemBrutaDashboardKpi')) {
      pararPollMargemBruta();
      return;
    }
    carregarResumoMargemBruta();
    iniciarPollMargemBruta();
  }

  global.CDS_MARGEM_BRUTA_POLL_MS = POLL_MS;
  global.aplicarResumoMargemBruta = aplicarResumoMargemBruta;
  global.carregarResumoMargemBruta = carregarResumoMargemBruta;
  global.initMargemBrutaHeader = initMargemBrutaHeader;
  global.iniciarPollMargemBruta = iniciarPollMargemBruta;
  global.pararPollMargemBruta = pararPollMargemBruta;
  global.atualizarLabelAtualizacaoMargemBruta = atualizarLabelAtualizacaoMargemBruta;
})(window);
