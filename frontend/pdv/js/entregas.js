/**
 * Listagem operacional — Vendas para Entrega (Sprint 2.1)
 * Dashboard + agrupamento por entregador + timeline + reserva/maquineta/troco.
 * Sem prestação de contas.
 */
(function (global) {
  'use strict';

  let statusFiltro = '';
  let modoVisualizacao = 'agrupado'; // agrupado | lista

  function fmtMoney(n) {
    return `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;
  }

  function fmtQtd(n) {
    const v = Number(n || 0);
    return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function badgeStatusEntrega(st) {
    const map = {
      AGUARDANDO_ENTREGA: 'bg-warning text-dark',
      EM_ENTREGA: 'bg-primary',
      AGUARDANDO_PRESTACAO: 'bg-info text-dark',
      CONCLUIDA: 'bg-success',
      FINALIZADA: 'bg-success',
      CANCELADA: 'bg-secondary'
    };
    const cls = map[st] || 'bg-secondary';
    const label = {
      AGUARDANDO_ENTREGA: 'Aguardando Entrega',
      EM_ENTREGA: 'Em Entrega',
      AGUARDANDO_PRESTACAO: 'Aguardando Prestação',
      CONCLUIDA: 'Concluída',
      FINALIZADA: 'Concluída',
      CANCELADA: 'Cancelada'
    }[st] || st || '—';
    return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
  }

  function badgeStatusVenda(st) {
    const map = {
      ABERTA: 'border border-warning text-warning',
      FINALIZADA: 'border border-success text-success',
      CANCELADA: 'border border-secondary text-secondary'
    };
    return `<span class="badge bg-transparent ${map[st] || 'border'}">${escapeHtml(st || 'ABERTA')}</span>`;
  }

  function chipMaquineta(leva) {
    return leva
      ? '<span class="badge bg-success">Maquineta SIM</span>'
      : '<span class="badge bg-light text-muted border">Maquineta NÃO</span>';
  }

  function chipTroco(item) {
    const trocoPara = Number(item.troco_para || 0);
    if (trocoPara <= 0) {
      return '<span class="badge bg-light text-muted border">Sem troco</span>';
    }
    return `<span class="badge bg-warning text-dark">Troco p/ ${fmtMoney(trocoPara)} · Nec. ${fmtMoney(item.troco_necessario)}</span>`;
  }

  async function loadEntregas() {
    if (typeof obterRecursosImplantacao === 'function' && !obterRecursosImplantacao().vendasEntrega) {
      $('#page-content').html('<div class="alert alert-warning m-3">Módulo Vendas para Entrega desabilitado.</div>');
      return;
    }

    $('#page-content').html(`
      <div class="container-fluid py-3" id="telaEntregasOperacional">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <div>
            <h4 class="mb-0"><i class="fas fa-motorcycle me-2"></i>Vendas para Entrega</h4>
            <small class="text-muted">Reserva operacional — efetivação na Prestação de Contas</small>
          </div>
          <div class="btn-group" role="group">
            <button type="button" class="btn btn-sm btn-outline-secondary" id="btnModoAgrupado">Por entregador</button>
            <button type="button" class="btn btn-sm btn-outline-secondary" id="btnModoLista">Lista</button>
            <button type="button" class="btn btn-sm btn-outline-primary" id="btnAtualizarEntregas">
              <i class="fas fa-sync"></i>
            </button>
          </div>
        </div>

        <div class="row g-3 mb-3" id="cardsDashboardEntrega">
          <div class="col-6 col-md"><div class="card border-0 shadow-sm h-100"><div class="card-body py-3 text-center">
            <div class="text-muted small">Entregas Hoje</div>
            <div class="fs-3 fw-bold" data-dash="entregas_hoje">—</div>
          </div></div></div>
          <div class="col-6 col-md"><div class="card border-0 shadow-sm h-100"><div class="card-body py-3 text-center">
            <div class="text-muted small">Aguardando</div>
            <div class="fs-3 fw-bold" data-dash="aguardando_entrega">—</div>
          </div></div></div>
          <div class="col-6 col-md"><div class="card border-0 shadow-sm h-100"><div class="card-body py-3 text-center">
            <div class="text-muted small">Em Entrega</div>
            <div class="fs-3 fw-bold text-primary" data-dash="em_entrega">—</div>
          </div></div></div>
          <div class="col-6 col-md"><div class="card border-0 shadow-sm h-100"><div class="card-body py-3 text-center">
            <div class="text-muted small">Prestação Pendente</div>
            <div class="fs-3 fw-bold text-info" data-dash="prestacao_pendente">—</div>
          </div></div></div>
          <div class="col-6 col-md"><div class="card border-0 shadow-sm h-100"><div class="card-body py-3 text-center">
            <div class="text-muted small">Concluídas Hoje</div>
            <div class="fs-3 fw-bold text-success" data-dash="concluidas_hoje">—</div>
          </div></div></div>
          <div class="col-6 col-md"><div class="card border-0 shadow-sm h-100"><div class="card-body py-3 text-center">
            <div class="text-muted small">Canceladas</div>
            <div class="fs-3 fw-bold text-secondary" data-dash="canceladas">—</div>
          </div></div></div>
          <div class="col-6 col-md"><div class="card border-0 shadow-sm h-100"><div class="card-body py-3 text-center">
            <div class="text-muted small">Valor Total Hoje</div>
            <div class="fs-5 fw-bold" data-dash="valor_total_hoje">—</div>
          </div></div></div>
          <div class="col-6 col-md"><div class="card border-0 shadow-sm h-100"><div class="card-body py-3 text-center">
            <div class="text-muted small">Ticket Médio</div>
            <div class="fs-5 fw-bold" data-dash="ticket_medio">—</div>
          </div></div></div>
          <div class="col-6 col-md"><div class="card border-0 shadow-sm h-100"><div class="card-body py-3 text-center">
            <div class="text-muted small">Tempo Médio (h)</div>
            <div class="fs-5 fw-bold" data-dash="tempo_medio_horas">—</div>
          </div></div></div>
        </div>
        <div id="alertasEntregaBox" class="mb-3"></div>

        <div class="d-flex flex-wrap gap-2 mb-3" id="filtrosStatusEntrega">
          <button type="button" class="btn btn-sm btn-primary active" data-status="">Todos</button>
          <button type="button" class="btn btn-sm btn-outline-primary" data-status="AGUARDANDO_ENTREGA">Aguardando Entrega</button>
          <button type="button" class="btn btn-sm btn-outline-primary" data-status="EM_ENTREGA">Em Entrega</button>
          <button type="button" class="btn btn-sm btn-outline-primary" data-status="AGUARDANDO_PRESTACAO">Aguardando Prestação</button>
          <button type="button" class="btn btn-sm btn-outline-primary" data-status="CONCLUIDA">Concluídas</button>
          <button type="button" class="btn btn-sm btn-outline-primary" data-status="CANCELADA">Canceladas</button>
        </div>

        <div id="resumoFiltroEntrega" class="mb-2 text-muted small"></div>
        <div id="conteudoEntregas"></div>
      </div>
    `);

    $('#filtrosStatusEntrega button').off('click').on('click', function () {
      $('#filtrosStatusEntrega button').removeClass('btn-primary active').addClass('btn-outline-primary');
      $(this).removeClass('btn-outline-primary').addClass('btn-primary active');
      statusFiltro = $(this).data('status') || '';
      atualizarTela();
    });

    $('#btnModoAgrupado').off('click').on('click', () => {
      modoVisualizacao = 'agrupado';
      atualizarTela();
    });
    $('#btnModoLista').off('click').on('click', () => {
      modoVisualizacao = 'lista';
      atualizarTela();
    });
    $('#btnAtualizarEntregas').off('click').on('click', atualizarTela);

    await atualizarTela();
  }

  async function atualizarTela() {
    await Promise.all([carregarDashboard(), carregarConteudo()]);
  }

  async function carregarDashboard() {
    try {
      const resp = await fetch(`${API_URL}/vendas/entregas/dashboard`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return;
      const d = data.dashboard || {};
      const money = (n) => `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;
      $('[data-dash="entregas_hoje"]').text(d.entregas_hoje ?? 0);
      $('[data-dash="aguardando_entrega"]').text(d.aguardando_entrega ?? 0);
      $('[data-dash="em_entrega"]').text(d.em_entrega ?? 0);
      $('[data-dash="prestacao_pendente"]').text(d.prestacao_pendente ?? d.aguardando_prestacao ?? 0);
      $('[data-dash="concluidas_hoje"]').text(d.concluidas_hoje ?? 0);
      $('[data-dash="canceladas"]').text(d.canceladas ?? 0);
      $('[data-dash="valor_total_hoje"]').text(money(d.valor_total_hoje));
      $('[data-dash="ticket_medio"]').text(money(d.ticket_medio));
      $('[data-dash="tempo_medio_horas"]').text(d.tempo_medio_horas != null ? d.tempo_medio_horas : '—');

      const alertas = (data.alertas && data.alertas.items) || [];
      if (alertas.length) {
        $('#alertasEntregaBox').html(`
          <div class="alert alert-warning py-2 mb-0">
            <strong><i class="fas fa-bell me-1"></i>${alertas.length} alerta(s)</strong>
            <ul class="mb-0 small mt-1">${alertas.slice(0, 5).map((a) => `<li>${escapeHtml(a.mensagem)}</li>`).join('')}</ul>
          </div>
        `);
      } else {
        $('#alertasEntregaBox').empty();
      }
    } catch (_) { /* ignore */ }
  }

  async function carregarConteudo() {
    const $box = $('#conteudoEntregas');
    $box.html('<div class="text-center text-muted py-4">Carregando…</div>');
    try {
      if (modoVisualizacao === 'agrupado') {
        await renderAgrupado($box);
      } else {
        await renderLista($box);
      }
    } catch (err) {
      $box.html(`<div class="alert alert-danger">${escapeHtml(err.message)}</div>`);
    }
  }

  async function renderAgrupado($box) {
    const qs = statusFiltro ? `?status=${encodeURIComponent(statusFiltro)}` : '';
    const resp = await fetch(`${API_URL}/vendas/entregas/por-entregador${qs}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Falha ao agrupar.');

    const grupos = data.grupos || [];
    $('#resumoFiltroEntrega').text(
      `${data.total_pedidos || 0} pedido(s) · ${data.total_grupos || 0} entregador(es)`
    );

    if (!grupos.length) {
      $box.html('<div class="text-center text-muted py-4">Nenhuma entrega encontrada.</div>');
      return;
    }

    $box.html(grupos.map((g) => `
      <div class="card border-0 shadow-sm mb-3">
        <div class="card-header bg-white d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div>
            <strong><i class="fas fa-user me-1"></i>${escapeHtml(g.entregador)}</strong>
            <span class="badge bg-primary ms-2">${g.quantidade}</span>
            ${g.pendente_prestacao ? `<span class="badge bg-info text-dark ms-1">${g.pendente_prestacao} prest. pendente</span>` : ''}
          </div>
          <div class="small text-muted">
            ${fmtMoney(g.valor_total)}
            · Reservado: ${fmtQtd(g.total_reservado)}
            (F ${fmtQtd(g.reservado_fiscal)} / NF ${fmtQtd(g.reservado_nao_fiscal)})
          </div>
        </div>
        <div class="card-body p-0">
          ${tabelaPedidos(g.pedidos || [])}
        </div>
      </div>
    `).join(''));

    bindAcoesPedidos();
  }

  async function renderLista($box) {
    const qs = statusFiltro ? `?status=${encodeURIComponent(statusFiltro)}` : '';
    const resp = await fetch(`${API_URL}/vendas/entregas${qs}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Falha ao listar.');

    $('#resumoFiltroEntrega').text(
      `${data.total || 0} pedido(s) · ${fmtMoney(data.valor_total)} · Reservado ${fmtQtd(data.total_reservado)}`
    );

    if (!(data.items || []).length) {
      $box.html('<div class="text-center text-muted py-4">Nenhuma entrega encontrada.</div>');
      return;
    }

    $box.html(`<div class="card border-0 shadow-sm">${tabelaPedidos(data.items)}</div>`);
    bindAcoesPedidos();
  }

  function tabelaPedidos(items) {
    return `
      <div class="table-responsive">
        <table class="table table-hover mb-0 align-middle">
          <thead class="table-light">
            <tr>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Valor</th>
              <th>Reservado</th>
              <th>Entregador</th>
              <th>Status Entrega</th>
              <th>Status Venda</th>
              <th>Pagamento</th>
              <th>Maquineta / Troco</th>
              <th>Data</th>
              <th>Hora</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${(items || []).map(linhaPedido).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function linhaPedido(v) {
    const criado = String(v.created_at || v.data_venda || '');
    const dataPart = criado.slice(0, 10);
    const horaPart = criado.includes('T') ? criado.slice(11, 19) : (criado.slice(11, 19) || '—');
    const podeIniciar = v.status_entrega === 'AGUARDANDO_ENTREGA';
    return `
      <tr>
        <td><a href="#" class="btn-detalhe-entrega" data-id="${v.id}">#${v.id}</a></td>
        <td>${escapeHtml(v.cliente_nome || 'Consumidor')}</td>
        <td>${fmtMoney(v.total)}</td>
        <td class="small">
          F ${fmtQtd(v.reservado_fiscal)} · NF ${fmtQtd(v.reservado_nao_fiscal)}
          <div class="text-muted">Σ ${fmtQtd(v.total_reservado)}</div>
        </td>
        <td>${escapeHtml(v.entregador || 'Sem Entregador')}</td>
        <td>${badgeStatusEntrega(v.status_entrega)}</td>
        <td>${badgeStatusVenda(v.status_venda)}</td>
        <td>${escapeHtml(v.pagamento_previsto || '—')}</td>
        <td class="small">${chipMaquineta(v.leva_maquineta)} ${chipTroco(v)}</td>
        <td>${dataPart}</td>
        <td>${horaPart}</td>
        <td class="text-nowrap">
          <button type="button" class="btn btn-sm btn-outline-secondary btn-detalhe-entrega" data-id="${v.id}" title="Timeline">
            <i class="fas fa-history"></i>
          </button>
          ${podeIniciar
            ? `<button type="button" class="btn btn-sm btn-outline-primary btn-iniciar-entrega" data-id="${v.id}">Iniciar</button>`
            : ''}
        </td>
      </tr>`;
  }

  function bindAcoesPedidos() {
    $('.btn-iniciar-entrega').off('click').on('click', async function () {
      const id = $(this).data('id');
      try {
        const resp = await fetch(`${API_URL}/vendas/entregas/${id}/iniciar`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: '{}'
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'Falha ao iniciar entrega.');
        showNotification('Entrega iniciada.', 'success');
        atualizarTela();
      } catch (err) {
        showNotification(err.message || 'Erro', 'danger');
      }
    });

    $('.btn-detalhe-entrega').off('click').on('click', function (e) {
      e.preventDefault();
      abrirDetalheTimeline($(this).data('id'));
    });
  }

  async function abrirDetalheTimeline(vendaId) {
    try {
      const resp = await fetch(`${API_URL}/vendas/entregas/${vendaId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Falha ao carregar pedido.');

      const item = data.item || {};
      const eventos = (data.timeline && data.timeline.eventos) || [];

      const timelineHtml = eventos.length
        ? `<ul class="list-unstyled mb-0">${eventos.map((ev, idx) => `
            <li class="d-flex gap-3 mb-3">
              <div class="text-center" style="width:28px;">
                <div class="rounded-circle bg-primary text-white d-inline-flex align-items-center justify-content-center" style="width:28px;height:28px;font-size:12px;">${idx + 1}</div>
                ${idx < eventos.length - 1 ? '<div class="border-start mx-auto mt-1" style="height:24px;"></div>' : ''}
              </div>
              <div>
                <div class="fw-semibold">${escapeHtml(ev.label || ev.acao)}</div>
                <div class="small text-muted">${escapeHtml(ev.em || '')}${ev.usuario_nome ? ` · ${escapeHtml(ev.usuario_nome)}` : ''}</div>
              </div>
            </li>`).join('')}</ul>`
        : '<p class="text-muted mb-0">Nenhum evento registrado ainda.</p>';

      $('#modal-container').html(`
        <div class="modal fade" id="modalDetalheEntrega" tabindex="-1">
          <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div class="modal-content border-0 shadow">
              <div class="modal-header">
                <h5 class="modal-title">Pedido #${item.id} — Timeline</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">
                <div class="row g-3 mb-3">
                  <div class="col-md-6">
                    <div class="small text-muted">Cliente</div>
                    <div>${escapeHtml(item.cliente_nome || 'Consumidor')}</div>
                    <div class="small text-muted mt-2">Endereço</div>
                    <div>${escapeHtml(item.endereco_entrega || '—')}</div>
                  </div>
                  <div class="col-md-6">
                    <div>${badgeStatusEntrega(item.status_entrega)} ${badgeStatusVenda(item.status_venda)}</div>
                    <div class="mt-2">${chipMaquineta(item.leva_maquineta)} ${chipTroco(item)}</div>
                    <div class="small mt-2">Reservado F ${fmtQtd(item.reservado_fiscal)} / NF ${fmtQtd(item.reservado_nao_fiscal)} · Σ ${fmtQtd(item.total_reservado)}</div>
                    <div class="fw-bold mt-2">${fmtMoney(item.total)}</div>
                  </div>
                </div>
                <hr>
                <h6 class="mb-3">Histórico da Entrega</h6>
                ${timelineHtml}
              </div>
            </div>
          </div>
        </div>
      `);
      bootstrap.Modal.getOrCreateInstance(document.getElementById('modalDetalheEntrega')).show();
    } catch (err) {
      showNotification(err.message || 'Erro', 'danger');
    }
  }

  global.loadEntregas = loadEntregas;
})(typeof window !== 'undefined' ? window : globalThis);
