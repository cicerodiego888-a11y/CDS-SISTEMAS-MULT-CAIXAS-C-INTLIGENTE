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
    if (st === 'AGUARDANDO_ENTREGA') {
      return `
        <div class="d-flex flex-column">
          <span class="badge bg-warning text-dark align-self-start">🟡 NÃO INICIADA</span>
          <small class="text-muted mt-1">Aguardando saída do entregador</small>
        </div>`;
    }
    if (st === 'EM_ENTREGA') {
      return `
        <div class="d-flex flex-column">
          <span class="badge bg-success align-self-start">🟢 EM ENTREGA</span>
          <small class="text-muted mt-1">Entregador em rota</small>
        </div>`;
    }
    const map = {
      AGUARDANDO_PRESTACAO: 'bg-info text-dark',
      CONCLUIDA: 'bg-success',
      FINALIZADA: 'bg-success',
      CANCELADA: 'bg-secondary'
    };
    const cls = map[st] || 'bg-secondary';
    const label = {
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
          <button type="button" class="btn btn-sm btn-outline-primary" data-status="AGUARDANDO_ENTREGA">Não Iniciada</button>
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
    const podeEditar = v.status_entrega === 'AGUARDANDO_ENTREGA';
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
          <button type="button" class="btn btn-sm btn-outline-secondary btn-reimprimir-entrega" data-id="${v.id}" title="Reimprimir comprovante de entrega">
            <i class="fas fa-print"></i> Reimprimir
          </button>
          ${podeEditar
            ? `<button type="button" class="btn btn-sm btn-outline-warning btn-editar-entrega" data-id="${v.id}" title="Editar entrega">
                <i class="fas fa-pen"></i> Editar
              </button>`
            : ''}
          <button type="button" class="btn btn-sm btn-outline-secondary btn-detalhe-entrega" data-id="${v.id}" title="Timeline">
            <i class="fas fa-history"></i>
          </button>
          ${podeIniciar
            ? `<button type="button" class="btn btn-sm btn-outline-primary btn-iniciar-entrega" data-id="${v.id}">
                <i class="fas fa-play"></i> Iniciar Entrega
              </button>`
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

    $('.btn-editar-entrega').off('click').on('click', function () {
      abrirModalEditarEntrega($(this).data('id'));
    });

    $('.btn-detalhe-entrega').off('click').on('click', function (e) {
      e.preventDefault();
      abrirDetalheTimeline($(this).data('id'));
    });

    $('.btn-reimprimir-entrega').off('click').on('click', function () {
      reimprimirCupomEntrega($(this).data('id'));
    });
  }

  function escreverHtmlNoFrame(frame, html) {
    const doc = frame.contentDocument || frame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
  }

  function mostrarCupomEntregaNaTela(html, vendaId) {
    document.querySelectorAll('.modal.show').forEach((el) => {
      const inst = bootstrap.Modal.getInstance(el);
      if (inst) inst.hide();
    });
    $('.modal-backdrop').remove();
    $('body').removeClass('modal-open').css('padding-right', '');

    $('#modal-container').html(`
      <div class="modal fade" id="modalCupomEntrega" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable" style="max-width:420px;">
          <div class="modal-content border-0 shadow">
            <div class="modal-header">
              <h5 class="modal-title">Cupom da entrega #${vendaId}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body p-2" style="background:#f4f4f5;">
              <iframe id="frameCupomEntrega" title="Cupom da entrega" style="width:100%;height:70vh;border:0;background:#fff;"></iframe>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Fechar</button>
              <button type="button" class="btn btn-primary" id="btnImprimirCupomEntregaModal">
                <i class="fas fa-print"></i> Imprimir
              </button>
            </div>
          </div>
        </div>
      </div>
    `);

    const frame = document.getElementById('frameCupomEntrega');
    if (frame) escreverHtmlNoFrame(frame, html);

    $('#btnImprimirCupomEntregaModal').on('click', function () {
      imprimirCupomEntregaJaAberto(html, vendaId);
    });

    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalCupomEntrega')).show();
  }

  async function imprimirCupomEntregaJaAberto(html, vendaId) {
    try {
      if (window.CupomPrintPolicy && typeof window.CupomPrintPolicy.aposCupomNaTela === 'function') {
        await window.CupomPrintPolicy.aposCupomNaTela({
          tipo: 'NAO_FISCAL',
          html,
          vendaId,
          reimpressao: true
        });
        return;
      }
      if (typeof apresentarCupomNaTela === 'function') {
        await apresentarCupomNaTela(html, html, {
          tipo: 'NAO_FISCAL',
          vendaId,
          reimpressao: true
        });
      }
    } catch (err) {
      showNotification(err.message || 'Erro ao imprimir cupom.', 'danger');
    }
  }

  async function reimprimirCupomEntrega(vendaId) {
    try {
      const resp = await fetch(`${API_URL}/vendas/entregas/${vendaId}/comprovante`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Falha ao reimprimir o cupom.');
      if (!data.comprovante_html) throw new Error('Cupom da entrega indisponível.');

      mostrarCupomEntregaNaTela(data.comprovante_html, vendaId);
    } catch (err) {
      showNotification(err.message || 'Erro ao reimprimir cupom.', 'danger');
    }
  }

  function authHeadersJson() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('token')}`
    };
  }

  async function abrirModalEditarEntrega(vendaId) {
    try {
      const resp = await fetch(`${API_URL}/vendas/entregas/${vendaId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Falha ao carregar entrega.');
      const item = data.item || {};
      if (item.status_entrega !== 'AGUARDANDO_ENTREGA') {
        showNotification('Esta entrega já foi iniciada e não pode mais ser editada.', 'warning');
        return;
      }

      const levaMaq = item.leva_maquineta === true || Number(item.leva_maquineta) === 1;
      const levaTroco = Number(item.troco_para || 0) > 0;
      const temCliente = item.cliente_id != null && Number(item.cliente_id) > 0;

      $('#modal-container').html(`
        <div class="modal fade" id="modalEditarEntrega" tabindex="-1">
          <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div class="modal-content border-0 shadow-lg" style="border-radius:20px;">
              <div class="modal-header border-0" style="background:#ea580c;color:#fff;">
                <h5 class="modal-title">✏ Editar Entrega #${item.id}</h5>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body p-4">
                <div class="alert alert-warning py-2">
                  Esta entrega ainda <strong>não foi iniciada</strong>.
                  <div class="small mt-1">Aguardando saída do entregador — alterações atualizam o snapshot da entrega.</div>
                </div>
                <div class="row g-3">
                  <input type="hidden" id="editEntregaId" value="${item.id}">
                  <input type="hidden" id="entregaClienteId" value="${temCliente ? item.cliente_id : ''}">
                  <input type="hidden" id="entregaModoCliente" value="${temCliente ? 'busca' : 'avulso'}">
                  <div class="col-12">
                    <label class="form-label">Cliente / Consumidor</label>
                    <div id="boxBuscaClienteEntrega" style="${temCliente ? '' : 'display:none;'}">
                      <div class="input-group">
                        <span class="input-group-text"><i class="fas fa-search"></i></span>
                        <input type="text" class="form-control" id="entregaClienteBusca"
                          placeholder="Digite nome ou telefone..." autocomplete="off"
                          value="${escapeHtml(temCliente ? (item.cliente_nome || '') : '')}">
                      </div>
                      <div id="entregaClienteResultados" class="list-group mt-1 shadow-sm"
                        style="display:none;max-height:180px;overflow:auto;position:relative;z-index:5;"></div>
                      <div id="entregaClienteSelecionado" class="alert alert-success py-2 mt-2 mb-0" style="${temCliente ? '' : 'display:none;'}">
                        <div class="d-flex justify-content-between align-items-center gap-2">
                          <span><i class="fas fa-user-check me-1"></i> <strong id="entregaClienteSelecionadoNome">${escapeHtml(item.cliente_nome || '')}</strong></span>
                          <button type="button" class="btn btn-sm btn-outline-secondary" id="btnRemoverClienteEntrega">Trocar</button>
                        </div>
                      </div>
                      <div class="mt-2">
                        <button type="button" class="btn btn-sm btn-outline-primary" id="btnConsumidorAvulsoEntrega">+ Consumidor avulso</button>
                      </div>
                    </div>
                    <div id="boxConsumidorAvulsoHint" class="alert alert-secondary py-2 mt-1 mb-0" style="${temCliente ? 'display:none;' : ''}">
                      Consumidor avulso — dados só desta entrega (não cria cadastro).
                      <button type="button" class="btn btn-sm btn-link p-0 ms-1" id="btnVoltarBuscaClienteEntrega">Buscar cliente</button>
                    </div>
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Nome</label>
                    <input type="text" class="form-control" id="entregaNomeCliente" value="${escapeHtml(item.nome_cliente_entrega || item.cliente_nome || '')}">
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">CPF/CNPJ</label>
                    <input type="text" class="form-control" id="entregaCpfCnpj" value="${escapeHtml(item.cpf_cnpj_cliente_entrega || '')}">
                  </div>
                  <div class="col-md-4">
                    <label class="form-label">Telefone</label>
                    <input type="text" class="form-control" id="entregaTelefone" value="${escapeHtml(item.telefone_entrega || '')}">
                  </div>
                  <div class="col-md-8">
                    <label class="form-label">E-mail</label>
                    <input type="email" class="form-control" id="entregaEmail" value="${escapeHtml(item.email_cliente_entrega || '')}">
                  </div>
                  <div class="col-12"><hr class="my-1"><small class="text-muted text-uppercase fw-semibold">Endereço da entrega</small></div>
                  <div class="col-md-3">
                    <label class="form-label">CEP</label>
                    <div class="input-group">
                      <input type="text" class="form-control" id="entregaCep" value="${escapeHtml(item.cep_entrega || '')}" maxlength="9">
                      <button type="button" class="btn btn-outline-secondary" id="btnBuscarCepEntrega"><i class="fas fa-search"></i></button>
                    </div>
                  </div>
                  <div class="col-md-5">
                    <label class="form-label">Endereço</label>
                    <input type="text" class="form-control" id="entregaEndereco" value="${escapeHtml(item.endereco_entrega || '')}">
                  </div>
                  <div class="col-md-2">
                    <label class="form-label">Número</label>
                    <input type="text" class="form-control" id="entregaNumero" value="${escapeHtml(item.numero_entrega || '')}">
                  </div>
                  <div class="col-md-2">
                    <label class="form-label">Compl.</label>
                    <input type="text" class="form-control" id="entregaComplemento" value="${escapeHtml(item.complemento_entrega || '')}">
                  </div>
                  <div class="col-md-3">
                    <label class="form-label">Bairro</label>
                    <input type="text" class="form-control" id="entregaBairro" value="${escapeHtml(item.bairro_entrega || '')}">
                  </div>
                  <div class="col-md-3">
                    <label class="form-label">Cidade</label>
                    <input type="text" class="form-control" id="entregaCidade" value="${escapeHtml(item.cidade_entrega || '')}">
                  </div>
                  <div class="col-md-2">
                    <label class="form-label">UF</label>
                    <input type="text" class="form-control" id="entregaUf" maxlength="2" value="${escapeHtml(item.uf_entrega || '')}">
                  </div>
                  <div class="col-md-4">
                    <label class="form-label">Referência</label>
                    <input type="text" class="form-control" id="entregaReferencia" value="${escapeHtml(item.referencia_entrega || '')}">
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Entregador</label>
                    <input type="text" class="form-control" id="entregaEntregador" value="${escapeHtml(item.entregador || '')}">
                  </div>
                  <div class="col-md-6">
                    <label class="form-label">Pagamento previsto</label>
                    <select class="form-select" id="entregaPagamentoPrevisto">
                      ${['NAO_INFORMADO', 'PIX', 'DINHEIRO', 'DEBITO', 'CREDITO', 'MISTO', 'FIADO'].map((p) =>
                        `<option value="${p}" ${String(item.pagamento_previsto || '').toUpperCase() === p ? 'selected' : ''}>${p === 'NAO_INFORMADO' ? 'Não informado' : p}</option>`
                      ).join('')}
                    </select>
                  </div>
                  <div class="col-md-4">
                    <label class="form-label">Taxa de entrega (R$)</label>
                    <input type="number" min="0" step="0.01" class="form-control" id="entregaTaxa" value="${Number(item.taxa_entrega || 0)}">
                  </div>
                  <div class="col-md-4">
                    <label class="form-label d-block">Levar maquineta</label>
                    <div class="form-check form-check-inline">
                      <input class="form-check-input" type="radio" name="entregaMaquineta" id="maqSim" value="1" ${levaMaq ? 'checked' : ''}>
                      <label class="form-check-label" for="maqSim">Sim</label>
                    </div>
                    <div class="form-check form-check-inline">
                      <input class="form-check-input" type="radio" name="entregaMaquineta" id="maqNao" value="0" ${!levaMaq ? 'checked' : ''}>
                      <label class="form-check-label" for="maqNao">Não</label>
                    </div>
                  </div>
                  <div class="col-md-4">
                    <label class="form-label d-block">Levar troco</label>
                    <div class="form-check form-check-inline">
                      <input class="form-check-input" type="radio" name="entregaTroco" id="trocoSim" value="1" ${levaTroco ? 'checked' : ''}>
                      <label class="form-check-label" for="trocoSim">Sim</label>
                    </div>
                    <div class="form-check form-check-inline">
                      <input class="form-check-input" type="radio" name="entregaTroco" id="trocoNao" value="0" ${!levaTroco ? 'checked' : ''}>
                      <label class="form-check-label" for="trocoNao">Não</label>
                    </div>
                  </div>
                  <div class="col-md-4" id="boxTrocoPara" style="${levaTroco ? '' : 'display:none;'}">
                    <label class="form-label">Troco para (R$)</label>
                    <input type="number" min="0" step="0.01" class="form-control" id="entregaTrocoPara" value="${Number(item.troco_para || 0)}">
                  </div>
                  <div class="col-12">
                    <label class="form-label">Observações</label>
                    <textarea class="form-control" id="entregaObservacoes" rows="2">${escapeHtml(item.observacao_entrega || '')}</textarea>
                  </div>
                </div>
              </div>
              <div class="modal-footer border-0">
                <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
                <button type="button" class="btn btn-primary" id="btnSalvarEdicaoEntrega" style="background:#ea580c;border-color:#ea580c;">
                  Salvar Alterações
                </button>
              </div>
            </div>
          </div>
        </div>
      `);

      const modalEl = document.getElementById('modalEditarEntrega');
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();

      $('input[name="entregaTroco"]').off('change.editEnt').on('change.editEnt', function () {
        $('#boxTrocoPara').toggle($(this).val() === '1');
      });

      vincularBuscaClienteEdicao();
      vincularCepEdicao();

      $('#btnSalvarEdicaoEntrega').off('click').on('click', async () => {
        await salvarEdicaoEntrega(modal);
      });
    } catch (err) {
      showNotification(err.message || 'Erro', 'danger');
    }
  }

  function vincularBuscaClienteEdicao() {
    let timer = null;
    const ativarAvulso = () => {
      $('#entregaModoCliente').val('avulso');
      $('#entregaClienteId').val('');
      $('#boxBuscaClienteEntrega').hide();
      $('#boxConsumidorAvulsoHint').show();
      $('#entregaClienteResultados').empty().hide();
    };
    const ativarBusca = () => {
      $('#entregaModoCliente').val('busca');
      $('#boxConsumidorAvulsoHint').hide();
      $('#boxBuscaClienteEntrega').show();
    };

    $('#btnConsumidorAvulsoEntrega').off('click.editEnt').on('click.editEnt', ativarAvulso);
    $('#btnVoltarBuscaClienteEntrega').off('click.editEnt').on('click.editEnt', ativarBusca);
    $('#btnRemoverClienteEntrega').off('click.editEnt').on('click.editEnt', () => {
      $('#entregaClienteId').val('');
      $('#entregaClienteBusca').val('');
      $('#entregaClienteSelecionado').hide();
      $('#entregaClienteSelecionadoNome').text('');
    });

    $('#entregaClienteBusca').off('input.editEnt').on('input.editEnt', function () {
      const q = String($(this).val() || '').trim();
      clearTimeout(timer);
      if (q.length < 2) {
        $('#entregaClienteResultados').empty().hide();
        return;
      }
      timer = setTimeout(async () => {
        try {
          const resp = await fetch(`${API_URL}/clientes/buscar?q=${encodeURIComponent(q)}&limit=8`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
          });
          const lista = await resp.json().catch(() => []);
          const items = Array.isArray(lista) ? lista : (lista.items || lista.clientes || []);
          const $box = $('#entregaClienteResultados');
          if (!items.length) {
            $box.html('<div class="list-group-item small text-muted">Nenhum cliente</div>').show();
            return;
          }
          $box.html(items.map((c) => `
            <button type="button" class="list-group-item list-group-item-action entrega-cliente-item"
              data-id="${c.id}" data-nome="${escapeHtml(c.nome || '')}">
              <strong>${escapeHtml(c.nome || '')}</strong>
              <span class="small text-muted ms-2">${escapeHtml(c.telefone || '')}</span>
            </button>`).join('')).show();
        } catch (_) {
          $('#entregaClienteResultados').empty().hide();
        }
      }, 280);
    });

    $('#entregaClienteResultados').off('click.editEnt').on('click.editEnt', '.entrega-cliente-item', async function () {
      const id = $(this).data('id');
      try {
        const resp = await fetch(`${API_URL}/clientes/${id}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        const cli = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(cli.error || 'Cliente não encontrado.');
        $('#entregaClienteId').val(cli.id);
        $('#entregaClienteBusca').val(cli.nome || '');
        $('#entregaClienteResultados').empty().hide();
        $('#entregaClienteSelecionado').show();
        $('#entregaClienteSelecionadoNome').text(cli.nome || `Cliente #${cli.id}`);
        $('#entregaNomeCliente').val(cli.nome || '');
        $('#entregaCpfCnpj').val(cli.cpf_cnpj || '');
        $('#entregaTelefone').val(cli.telefone || '');
        $('#entregaEmail').val(cli.email || '');
        if (cli.cep) $('#entregaCep').val(cli.cep);
        if (cli.rua || cli.endereco) $('#entregaEndereco').val(cli.rua || cli.endereco || '');
        if (cli.numero) $('#entregaNumero').val(cli.numero);
        if (cli.bairro) $('#entregaBairro').val(cli.bairro);
        if (cli.cidade) $('#entregaCidade').val(cli.cidade);
        if (cli.uf) $('#entregaUf').val(cli.uf);
      } catch (err) {
        showNotification(err.message || 'Erro ao carregar cliente', 'danger');
      }
    });
  }

  function vincularCepEdicao() {
    const formatar = (v) => {
      const d = String(v || '').replace(/\D/g, '').slice(0, 8);
      return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
    };
    $('#entregaCep').off('input.editCep').on('input.editCep', function () {
      $(this).val(formatar($(this).val()));
    });
    const buscar = async () => {
      const cep = String($('#entregaCep').val() || '').replace(/\D/g, '');
      if (cep.length !== 8) return;
      try {
        const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await resp.json();
        if (data.erro) return;
        if (data.logradouro) $('#entregaEndereco').val(data.logradouro);
        if (data.bairro) $('#entregaBairro').val(data.bairro);
        if (data.localidade) $('#entregaCidade').val(data.localidade);
        if (data.uf) $('#entregaUf').val(data.uf);
      } catch (_) { /* ignore */ }
    };
    $('#btnBuscarCepEntrega').off('click.editCep').on('click.editCep', (e) => {
      e.preventDefault();
      buscar();
    });
    $('#entregaCep').off('blur.editCep').on('blur.editCep', buscar);
  }

  async function salvarEdicaoEntrega(modal) {
    const id = $('#editEntregaId').val();
    const levarTroco = $('input[name="entregaTroco"]:checked').val() === '1';
    const clienteIdRaw = String($('#entregaClienteId').val() || '').trim();
    const payload = {
      cliente_id: clienteIdRaw ? Number(clienteIdRaw) : null,
      nome_cliente_entrega: $('#entregaNomeCliente').val() || '',
      cpf_cnpj_cliente_entrega: $('#entregaCpfCnpj').val() || '',
      email_cliente_entrega: $('#entregaEmail').val() || '',
      telefone_entrega: $('#entregaTelefone').val() || '',
      cep_entrega: $('#entregaCep').val() || '',
      endereco_entrega: $('#entregaEndereco').val() || '',
      numero_entrega: $('#entregaNumero').val() || '',
      complemento_entrega: $('#entregaComplemento').val() || '',
      bairro_entrega: $('#entregaBairro').val() || '',
      cidade_entrega: $('#entregaCidade').val() || '',
      uf_entrega: $('#entregaUf').val() || '',
      referencia_entrega: $('#entregaReferencia').val() || '',
      entregador: $('#entregaEntregador').val() || '',
      pagamento_previsto: $('#entregaPagamentoPrevisto').val() || 'NAO_INFORMADO',
      taxa_entrega: Number($('#entregaTaxa').val() || 0),
      leva_maquineta: $('input[name="entregaMaquineta"]:checked').val() === '1',
      levar_troco: levarTroco,
      troco_para: levarTroco ? Number($('#entregaTrocoPara').val() || 0) : 0,
      observacao_entrega: $('#entregaObservacoes').val() || ''
    };

    try {
      const resp = await fetch(`${API_URL}/vendas/${id}/entrega`, {
        method: 'PATCH',
        headers: authHeadersJson(),
        body: JSON.stringify(payload)
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || 'Falha ao salvar alterações.');
      }
      if (modal) modal.hide();
      showNotification(data.mensagem || 'Alterações salvas.', 'success');
      atualizarTela();
    } catch (err) {
      showNotification(err.message || 'Erro', 'danger');
    }
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
              <div class="modal-footer">
                <button type="button" class="btn btn-outline-secondary btn-reimprimir-entrega" data-id="${item.id}">
                  <i class="fas fa-print"></i> Reimprimir cupom
                </button>
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
              </div>
            </div>
          </div>
        </div>
      `);
      bindAcoesPedidos();
      bootstrap.Modal.getOrCreateInstance(document.getElementById('modalDetalheEntrega')).show();
    } catch (err) {
      showNotification(err.message || 'Erro', 'danger');
    }
  }

  global.loadEntregas = loadEntregas;
})(typeof window !== 'undefined' ? window : globalThis);
