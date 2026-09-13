/**
 * ERP — Expedição (comercial) + Faturamento fiscal opcional (NF-e).
 * RC8.0.1 — nomenclatura: Expedição ≠ Faturamento.
 * Rotas/APIs permanecem em /faturamento (compatibilidade).
 */

async function loadFaturamento() {
  const token = localStorage.getItem('token') || '';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + token
  };

  const Nom = (typeof CdsNomenclatura !== 'undefined' && CdsNomenclatura) || null;
  const C = (Nom && Nom.COMERCIAL) || {};
  const F = (Nom && Nom.FISCAL) || {};

  const nfeHabilitado = !!(
    (Nom && typeof Nom.nfeHabilitadoUi === 'function' && Nom.nfeHabilitadoUi())
    || (window.CONFIG_IMPLANTACAO && window.CONFIG_IMPLANTACAO.recursos && window.CONFIG_IMPLANTACAO.recursos.nfe)
    || (typeof obterRecursosImplantacao === 'function' && obterRecursosImplantacao().nfe)
  );

  const tituloPagina = (Nom && Nom.tituloModuloExpedicao)
    ? Nom.tituloModuloExpedicao()
    : (C.expedicao || 'Expedição');
  const subtituloPagina = (Nom && Nom.subtituloModuloExpedicao)
    ? Nom.subtituloModuloExpedicao()
    : (C.subtituloPagina || 'Pedido → Separação → Expedição');

  const fmtMoney = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtData = (d) => {
    if (!d) return '—';
    const s = String(d).slice(0, 10);
    const p = s.split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
  };

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  function modoFiscalAtivo() {
    if (typeof isModoFiscalVisualizacaoAtivo === 'function') {
      return isModoFiscalVisualizacaoAtivo();
    }
    if (typeof modoFiscalQueryParam === 'function') {
      return modoFiscalQueryParam() === '1';
    }
    return localStorage.getItem('pdv_modo_fiscal_ativo') === '1';
  }

  function modoFiscalParam() {
    return modoFiscalAtivo() ? '1' : '0';
  }

  const ABA_LABELS = {
    todas: 'Todas',
    com_nfe: F.comNfe || 'Com NF-e',
    sem_nfe: F.semNfe || 'Sem NF-e',
    pendentes: 'Pendentes',
    canceladas: 'Canceladas'
  };

  const COLSPAN = 8;

  $('#page-content').html(`
    <div class="container-fluid py-3">
      <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <div>
          <h4 class="mb-0"><i class="fas fa-dolly me-2"></i>${escapeHtml(tituloPagina)}</h4>
          <div class="text-muted small">${escapeHtml(subtituloPagina)}</div>
        </div>
        <div class="d-flex gap-2">
          <button type="button" class="btn btn-outline-secondary btn-sm" id="btnFatNovoPedido"><i class="fas fa-plus"></i> Novo pedido</button>
          <button type="button" class="btn btn-primary btn-sm" id="btnFatAtualizar"><i class="fas fa-sync"></i> Atualizar</button>
        </div>
      </div>
      <div id="fatAlert"></div>

      <h5 class="mb-2"><i class="fas fa-clock me-1"></i> Pedidos aguardando expedição</h5>
      <div class="table-responsive card shadow-sm mb-4">
        <table class="table table-hover mb-0 align-middle">
          <thead class="table-light">
            <tr>
              <th>Número</th><th>Cliente</th><th>Data</th>
              <th class="text-end">Valor</th><th>Representante</th><th>Status</th>
              <th class="text-end">Ação</th>
            </tr>
          </thead>
          <tbody id="fatFilaBody"><tr><td colspan="7" class="text-center text-muted py-4">Carregando…</td></tr></tbody>
        </table>
      </div>

      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
        <h5 class="mb-0"><i class="fas fa-store me-1"></i> ${escapeHtml(C.vendasExpedidas || 'Vendas expedidas')}</h5>
        ${nfeHabilitado
          ? (modoFiscalAtivo()
            ? '<span id="fatModoBadge" class="d-none" aria-hidden="true"></span>'
            : '<span class="badge bg-secondary" id="fatModoBadge">F12 OFF · Modo Normal</span>')
          : '<span class="badge bg-secondary" id="fatModoBadge">Operação comercial</span>'}
      </div>
      <ul class="nav nav-pills mb-2 flex-wrap gap-1" id="fatAbasCentral"></ul>

      <div class="card shadow-sm mb-2">
        <div class="card-body py-2">
          <div class="row g-2 align-items-end" id="fatFiltrosForm">
            <div class="col-md-2">
              <label class="form-label small mb-0">Cliente</label>
              <input type="text" class="form-control form-control-sm" id="fatFiltroCliente" placeholder="Nome ou ID">
            </div>
            <div class="col-md-1">
              <label class="form-label small mb-0">Venda</label>
              <input type="text" class="form-control form-control-sm" id="fatFiltroVenda" placeholder="Nº">
            </div>
            <div class="col-md-1">
              <label class="form-label small mb-0">Pedido</label>
              <input type="text" class="form-control form-control-sm" id="fatFiltroPedido" placeholder="Nº">
            </div>
            ${nfeHabilitado ? `
            <div class="col-md-2">
              <label class="form-label small mb-0">${escapeHtml(F.documentoFiscal || 'Documento fiscal')}</label>
              <input type="text" class="form-control form-control-sm" id="fatFiltroDocumento" placeholder="Nº / chave / status">
            </div>` : '<div class="col-md-2" style="display:none"><input type="hidden" id="fatFiltroDocumento" value=""></div>'}
            <div class="col-md-1">
              <label class="form-label small mb-0">Origem</label>
              <select class="form-select form-select-sm" id="fatFiltroOrigem">
                <option value="">Todas</option>
                <option value="PEDIDO">Pedido</option>
                <option value="NF_AVULSA">NF-e Avulsa</option>
                <option value="PDV">PDV</option>
                <option value="ENTREGA">Entrega</option>
                <option value="MARKETPLACE">Marketplace</option>
              </select>
            </div>
            <div class="col-md-1">
              <label class="form-label small mb-0">De</label>
              <input type="date" class="form-control form-control-sm" id="fatFiltroDataInicio">
            </div>
            <div class="col-md-1">
              <label class="form-label small mb-0">Até</label>
              <input type="date" class="form-control form-control-sm" id="fatFiltroDataFim">
            </div>
            <div class="col-md-1">
              <label class="form-label small mb-0">Status</label>
              <select class="form-select form-select-sm" id="fatFiltroStatus">
                <option value="">Todos</option>
                <option value="concluida">Concluída</option>
                <option value="finalizada">Finalizada</option>
                <option value="cancelada">Cancelada</option>
              </select>
            </div>
            <div class="col-md-2 d-flex gap-1">
              <button type="button" class="btn btn-sm btn-primary flex-grow-1" id="btnFatFiltrar"><i class="fas fa-search"></i> Filtrar</button>
              <button type="button" class="btn btn-sm btn-outline-secondary" id="btnFatLimparFiltros" title="Limpar">✕</button>
            </div>
          </div>
        </div>
      </div>

      <div class="table-responsive card shadow-sm">
        <table class="table table-hover mb-0 align-middle">
          <thead class="table-light">
            <tr>
              <th>Venda</th>
              <th>Cliente</th>
              <th>Data</th>
              <th>Origem</th>
              <th class="text-end">Total</th>
              <th>${nfeHabilitado ? 'Documento' : 'Referência'}</th>
              <th>Status</th>
              <th class="text-end">Ações</th>
            </tr>
          </thead>
          <tbody id="fatVendasBody"><tr><td colspan="${COLSPAN}" class="text-center text-muted py-4">Carregando…</td></tr></tbody>
        </table>
      </div>
      <div class="d-flex justify-content-between align-items-center mt-2 flex-wrap gap-2" id="fatVendasPager">
        <div class="text-muted small" id="fatVendasMeta"></div>
        <div class="btn-group btn-group-sm">
          <button type="button" class="btn btn-outline-secondary" id="btnFatPagePrev" disabled>Anterior</button>
          <button type="button" class="btn btn-outline-secondary" id="btnFatPageNext" disabled>Próxima</button>
        </div>
      </div>
    </div>

    <div class="modal fade" id="modalFaturarPedido" tabindex="-1">
      <div class="modal-dialog modal-xl modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">${escapeHtml(C.modalExpedir || 'Expedir pedido')}</h5>
            <div class="d-flex align-items-center gap-1">
              <button type="button" class="btn btn-sm btn-light" title="Minimizar"
                onclick="minimizarModal('modalFaturarPedido', '${escapeHtml(C.modalExpedir || 'Expedir pedido')}')">
                <i class="fas fa-window-minimize"></i>
              </button>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
            </div>
          </div>
          <div class="modal-body">
            <div id="fatModalResumo" class="mb-3"></div>
            <div class="table-responsive mb-3">
              <table class="table table-sm"><thead><tr>
                <th>Item</th><th>Qtd</th><th>Preço</th><th>Desc.%</th><th class="text-end">Subtotal</th>
              </tr></thead><tbody id="fatModalItens"></tbody></table>
            </div>
            <div class="row g-2">
              <div class="col-md-3" id="fatFormaPagamentoWrap">
                <label class="form-label">Forma de pagamento</label>
                <select class="form-select" id="fatForma"></select>
              </div>
              <div class="col-md-3"><label class="form-label">Valor total</label>
                <input type="text" class="form-control" id="fatValorTotal" readonly></div>
              <div class="col-12" id="fatPagamentoExtras"></div>
              <div class="col-md-2"><label class="form-label">Desconto</label>
                <input type="number" step="0.01" class="form-control" id="fatDesconto" value="0"></div>
              <div class="col-md-2"><label class="form-label">Acréscimo</label>
                <input type="number" step="0.01" class="form-control" id="fatAcrescimo" value="0"></div>
              <div class="col-md-2"><label class="form-label">Frete</label>
                <input type="number" step="0.01" class="form-control" id="fatFrete" value="0"></div>
              <div class="col-md-12"><label class="form-label">Observações</label>
                <textarea class="form-control" id="fatObs" rows="2"></textarea></div>
            </div>
            <div class="alert alert-info mt-3 mb-0">
              Expedição é exclusivamente logística. Após confirmar, a venda será encaminhada à <strong>Central de Faturamento</strong> para emissão da NF-e.
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button type="button" class="btn btn-success" id="btnConfirmarFaturar"><i class="fas fa-check"></i> ${escapeHtml(C.expedir || 'Expedir')}</button>
          </div>
        </div>
      </div>
    </div>

    <div class="modal fade" id="modalNovoPedidoFat" tabindex="-1">
      <div class="modal-dialog modal-lg"><div class="modal-content">
        <div class="modal-header"><h5 class="modal-title">Novo pedido</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="row g-2 mb-2">
            <div class="col-md-6"><label class="form-label">Cliente (ID)</label>
              <input type="number" class="form-control" id="fatNovoClienteId" min="1"></div>
            <div class="col-md-6"><label class="form-label">Representante</label>
              <input type="text" class="form-control" id="fatNovoRepresentante"></div>
          </div>
          <div class="row g-2">
            <div class="col-md-4"><label class="form-label">Produto ID</label>
              <input type="number" class="form-control" id="fatNovoProdutoId" min="1"></div>
            <div class="col-md-4"><label class="form-label">Quantidade</label>
              <input type="number" class="form-control" id="fatNovoQtd" min="0.001" step="0.001" value="1"></div>
            <div class="col-md-4"><label class="form-label">Preço</label>
              <input type="number" class="form-control" id="fatNovoPreco" min="0" step="0.01"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button type="button" class="btn btn-primary" id="btnSalvarNovoPedidoFat">Salvar</button>
        </div>
      </div></div>
    </div>

    <div class="modal fade" id="modalFatDetalhe" tabindex="-1">
      <div class="modal-dialog modal-xl modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header border-0 pb-0">
            <h5 class="modal-title" id="fatDetalheTitulo">Detalhe</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body pt-2" id="fatDetalheBody"></div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" id="btnFatDetalheImprimir"><i class="fas fa-print"></i> Imprimir</button>
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
          </div>
        </div>
      </div>
    </div>
  `);

  let pedidoSelecionado = null;
  let abaAtual = 'todas';
  let pageAtual = 1;
  const pageSize = 20;
  let totalVendas = 0;
  /** @type {{ tipo: 'venda'|'pedido', id: number, payload?: object }|null} */
  let ultimoDetalheCtx = null;

  function alertar(msg, tipo) {
    $('#fatAlert').html(`<div class="alert alert-${tipo || 'info'}">${msg}</div>`);
  }

  function coletarFiltros() {
    return {
      cliente: $('#fatFiltroCliente').val() || '',
      venda_id: $('#fatFiltroVenda').val() || '',
      pedido_id: $('#fatFiltroPedido').val() || '',
      documento: $('#fatFiltroDocumento').val() || '',
      origem: $('#fatFiltroOrigem').val() || '',
      data_inicio: $('#fatFiltroDataInicio').val() || '',
      data_fim: $('#fatFiltroDataFim').val() || '',
      status: $('#fatFiltroStatus').val() || ''
    };
  }

  function renderAbas(disponiveis) {
    const fiscal = modoFiscalAtivo();
    let lista = Array.isArray(disponiveis) && disponiveis.length
      ? disponiveis
      : null;

    if (!lista) {
      if (!nfeHabilitado) {
        lista = ['todas', 'pendentes', 'canceladas'];
      } else if (fiscal) {
        lista = ['todas', 'com_nfe', 'pendentes', 'canceladas'];
      } else {
        lista = ['todas', 'com_nfe', 'sem_nfe', 'pendentes', 'canceladas'];
      }
    }

    if (fiscal && abaAtual === 'sem_nfe') abaAtual = 'todas';
    if (!nfeHabilitado && (abaAtual === 'com_nfe' || abaAtual === 'sem_nfe')) abaAtual = 'todas';
    if (!lista.includes(abaAtual)) abaAtual = 'todas';

    $('#fatAbasCentral').html(lista.map((aba) => `
      <li class="nav-item">
        <button type="button" class="nav-link ${aba === abaAtual ? 'active' : ''}" data-aba="${aba}">
          ${ABA_LABELS[aba] || aba}
        </button>
      </li>`).join(''));

    $('#fatAbasCentral .nav-link').off('click').on('click', function () {
      abaAtual = String($(this).data('aba') || 'todas');
      pageAtual = 1;
      carregarVendasFaturadas();
    });

    const $badge = $('#fatModoBadge');
    if (!nfeHabilitado) {
      $badge.removeClass('d-none bg-primary').addClass('badge bg-secondary').text('Operação comercial');
    } else if (fiscal) {
      // Modo fiscal: sem rótulo F12 na Expedição (operação já é fiscal).
      $badge.addClass('d-none').removeClass('badge bg-primary bg-secondary').text('');
    } else {
      $badge.removeClass('d-none bg-primary').addClass('badge bg-secondary').text('F12 OFF · Modo Normal');
    }
  }

  function badgeStatusVisual(row) {
    const tipo = String(row.status_visual || '').toLowerCase();
    if (tipo === 'com_nfe') {
      return '<span class="badge bg-success">Com NF-e</span>';
    }
    if (tipo === 'pendente') {
      return '<span class="badge bg-warning text-dark">Pendente</span>';
    }
    if (tipo === 'cancelada') {
      return '<span class="badge bg-danger">Cancelada</span>';
    }
    return '<span class="badge bg-secondary">Sem Documento Fiscal</span>';
  }

  function celulaDocumento(row) {
    const texto = row.documento || 'Sem Documento Fiscal';
    const tipo = String(row.status_visual || '').toLowerCase();
    let cls = 'text-muted';
    if (tipo === 'com_nfe') cls = 'text-success fw-semibold';
    else if (tipo === 'pendente') cls = 'text-warning fw-semibold';
    else if (tipo === 'cancelada') cls = 'text-danger fw-semibold';
    return `<span class="${cls}">${escapeHtml(texto)}</span>`;
  }

  function podeCancelar(row) {
    return String(row.status || '').toLowerCase() !== 'cancelada';
  }

  function temNfeAutorizada(row) {
    return !!(row.nfe_id && String(row.nfe_status || '').toLowerCase() === 'autorizada');
  }

  function podeEmitirNfeDevolucaoVenda(row) {
    const cancelada = String(row.status || '').toLowerCase() === 'cancelada';
    const temCliente = !!(row.cliente_id || row.cliente_nome);
    return temNfeAutorizada(row) && temCliente && !cancelada;
  }

  function acoesVenda(row) {
    const id = Number(row.id);
    const pedidoId = row.pedido_id ? Number(row.pedido_id) : null;
    const nfeId = row.nfe_id ? Number(row.nfe_id) : '';
    // RC3.15 — documentos fiscais só na Central NF-e (sem Emitir/DANFE aqui)
    // RC5 — exceção: Emitir NF-e de Devolução (modo DEVOLUÇÃO)

    return `
      <div class="dropdown">
        <button class="btn btn-sm btn-outline-secondary" type="button"
          data-bs-toggle="dropdown" aria-expanded="false" title="Ações">
          <i class="fas fa-ellipsis-v"></i>
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
          <li><button type="button" class="dropdown-item fat-acao-venda" data-id="${id}">
            <i class="fas fa-eye me-1"></i> Visualizar Venda</button></li>
          ${pedidoId ? `
          <li><button type="button" class="dropdown-item fat-acao-pedido" data-pedido="${pedidoId}">
            <i class="fas fa-clipboard-list me-1"></i> Visualizar Pedido</button></li>
          <li><button type="button" class="dropdown-item fat-acao-reimprimir-pedido" data-pedido="${pedidoId}">
            <i class="fas fa-print me-1"></i> Reimprimir Pedido</button></li>` : ''}
          ${nfeId && nfeHabilitado ? `
          <li><button type="button" class="dropdown-item fat-acao-abrir-central-nfe" data-nfe-id="${nfeId}">
            <i class="fas fa-file-invoice-dollar me-1"></i> Abrir Central NF-e</button></li>` : ''}
          ${podeEmitirNfeDevolucaoVenda(row) && nfeHabilitado ? `
          <li><button type="button" class="dropdown-item fat-acao-nfe-devolucao" data-id="${id}">
            <i class="fas fa-undo me-1"></i> Emitir NF-e de Devolução</button></li>` : ''}
          ${podeCancelar(row) ? `<li><hr class="dropdown-divider">
            <button type="button" class="dropdown-item text-danger fat-acao-cancelar"
              data-id="${id}" data-nfe-id="${nfeId}"
              data-nfe-status="${escapeHtml(String(row.nfe_status || ''))}">
            <i class="fas fa-ban me-1"></i> Cancelar Venda</button></li>` : ''}
        </ul>
      </div>`;
  }

  function bindAcoesLinha() {
    $('.fat-acao-venda').off('click').on('click', function () {
      visualizarVenda(Number($(this).data('id')));
    });
    $('.fat-acao-pedido').off('click').on('click', function () {
      visualizarPedido(Number($(this).data('pedido')));
    });
    $('.fat-acao-reimprimir-pedido').off('click').on('click', function () {
      reimprimirPedido(Number($(this).data('pedido')));
    });
    $('.fat-acao-abrir-central-nfe').off('click').on('click', function () {
      const notaId = Number($(this).data('nfe-id'));
      if (typeof abrirCentralNfeDocumental === 'function') {
        abrirCentralNfeDocumental({ notaId, openFicha: true });
      } else if (typeof loadPage === 'function') {
        window.__CDS_NFE_FOCUS_NOTA_ID = notaId;
        window.__CDS_NFE_OPEN_FICHA = true;
        loadPage('nfe-central');
      }
    });
    $('.fat-acao-nfe-devolucao').off('click').on('click', function () {
      abrirModalNFeDevolucaoVenda(Number($(this).data('id')));
    });
    $('.fat-acao-cancelar').off('click').on('click', function () {
      cancelarVendaCentral({
        id: Number($(this).data('id')),
        nfe_id: $(this).data('nfe-id') ? Number($(this).data('nfe-id')) : null,
        nfe_status: String($(this).data('nfe-status') || '')
      });
    });
  }

  function abrirDetalhe(titulo, html, ctx) {
    ultimoDetalheCtx = ctx || null;
    $('#fatDetalheTitulo').text(titulo);
    $('#fatDetalheBody').html(html);
    new bootstrap.Modal(document.getElementById('modalFatDetalhe')).show();
  }

  function rotuloOrigemUi(origem) {
    const o = String(origem || '').toUpperCase();
    const mapa = {
      FATURAMENTO: 'Pedido', PEDIDO: 'Pedido', PDV: 'PDV',
      ENTREGA: 'Entrega', MARKETPLACE: 'Marketplace', ORCAMENTO: 'Orçamento', API: 'API',
      NF_AVULSA: 'NF-e Avulsa'
    };
    return mapa[o] || (origem || '—');
  }

  function rotuloStatusUi(status) {
    const s = String(status || '').toLowerCase();
    const mapa = {
      concluida: 'Concluída',
      finalizada: 'Finalizada',
      cancelada: 'Cancelada',
      aberta: 'Aberta',
      pendente: 'Pendente'
    };
    return mapa[s] || (status || '—');
  }

  function rotuloFormaUi(forma) {
    const f = String(forma || '').toLowerCase().trim();
    if (typeof CdsFormasPagamento !== 'undefined' && CdsFormasPagamento.rotuloForma) {
      return CdsFormasPagamento.rotuloForma(f);
    }
    const mapa = {
      dinheiro: 'Dinheiro',
      pix: 'PIX',
      cartao_debito: 'Cartão Débito',
      cartao_credito: 'Cartão Crédito',
      credito: 'Cartão Crédito',
      debito: 'Cartão Débito',
      boleto: 'Boleto Bancário',
      transferencia: 'Transferência Bancária',
      deposito: 'Depósito Bancário',
      crediario: 'Crediário',
      parcelado: 'Parcelado',
      prazo: 'A prazo'
    };
    return mapa[f] || (forma || '—');
  }

  function totalModalExpedir() {
    if (!pedidoSelecionado) return 0;
    const frete = Number($('#fatFrete').val() || 0);
    const acrescimo = Number($('#fatAcrescimo').val() || 0);
    const desconto = Number($('#fatDesconto').val() || 0);
    return Number((Number(pedidoSelecionado.total || 0) + frete + acrescimo - desconto).toFixed(2));
  }

  function initFormasPagamentoExpedir() {
    if (typeof CdsFormasPagamento === 'undefined') return;
    const $sel = $('#fatForma');
    if (!$sel.length) return;
    if (!$sel.data('cds-formas-ready')) {
      $sel.html(CdsFormasPagamento.optionsHtml('dinheiro'));
      $('#fatPagamentoExtras').html(CdsFormasPagamento.htmlPaineisExtras('fat'));
      CdsFormasPagamento.bind('fat', totalModalExpedir);
      $sel.data('cds-formas-ready', '1');
      $('#fatFrete, #fatAcrescimo, #fatDesconto').off('input.cdsPag').on('input.cdsPag', () => {
        CdsFormasPagamento.atualizarResumo(null, 'fat', totalModalExpedir());
      });
    } else {
      $sel.val('dinheiro');
      CdsFormasPagamento.atualizarResumo(null, 'fat', totalModalExpedir());
    }
  }

  function badgeStatusVendaUi(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'cancelada') return '<span class="badge bg-danger">Cancelada</span>';
    if (s === 'concluida' || s === 'finalizada') return '<span class="badge bg-success">Concluída</span>';
    return `<span class="badge bg-secondary">${escapeHtml(rotuloStatusUi(status))}</span>`;
  }

  function docFiscalVenda(venda) {
    if (venda.nfe_numero) {
      return {
        texto: `NF-e ${venda.nfe_numero}`,
        detalhe: String(venda.nfe_status || ''),
        tipo: String(venda.nfe_status || '').toLowerCase() === 'autorizada' ? 'ok' : 'pendente'
      };
    }
    if (venda.nfce_numero) {
      return {
        texto: `NFC-e ${venda.nfce_numero}`,
        detalhe: String(venda.nfce_status || ''),
        tipo: String(venda.nfce_status || '').toLowerCase() === 'autorizada' ? 'ok' : 'pendente'
      };
    }
    return { texto: 'Sem Documento Fiscal', detalhe: '', tipo: 'sem' };
  }

  function badgeDocUi(doc) {
    if (doc.tipo === 'ok') return `<span class="badge bg-success">${escapeHtml(doc.texto)}</span>`;
    if (doc.tipo === 'pendente') return `<span class="badge bg-warning text-dark">${escapeHtml(doc.texto)}</span>`;
    return `<span class="badge bg-secondary">${escapeHtml(doc.texto)}</span>`;
  }

  /** Layout A4 alinhado ao padrão Pedidos (toolbar + folha). */
  function montarHtmlImpressaoVenda(venda, historicoEventos) {
    const marca = (typeof BrandService !== 'undefined' && BrandService.meta)
      ? BrandService.meta().nome
      : 'CDS Sistemas';
    const titulo = escapeHtml(venda.codigo || ('#' + venda.id));
    const doc = docFiscalVenda(venda);
    const itens = Array.isArray(venda.itens) ? venda.itens : [];
    const linhas = itens.map((i) => `
      <tr>
        <td>${escapeHtml(i.produto_codigo || i.produto_id || '')}</td>
        <td>${escapeHtml(i.produto_nome || '')}</td>
        <td style="text-align:right;">${Number(i.quantidade || 0)}</td>
        <td style="text-align:right;">${fmtMoney(i.preco_unitario)}</td>
        <td style="text-align:right;">${fmtMoney(i.subtotal)}</td>
      </tr>`).join('');

    const hist = Array.isArray(historicoEventos) ? historicoEventos : [];
    const histLinhas = hist.slice(0, 20).map((e) => `
      <tr>
        <td>${escapeHtml(e.criado_em || '—')}</td>
        <td>${escapeHtml(e.acao || e.evento || '—')}</td>
        <td>${escapeHtml(typeof e.detalhes === 'string' ? e.detalhes : (e.detalhes ? JSON.stringify(e.detalhes) : '—'))}</td>
      </tr>`).join('');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Venda ${titulo}</title>
  <style>
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:#fff}
    body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111}
    .toolbar{
      position:sticky;top:0;z-index:10;
      display:flex;gap:6px;align-items:center;justify-content:flex-end;
      padding:8px 10px;background:#1f2937;color:#fff
    }
    .toolbar .titulo{margin-right:auto;font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .toolbar button{
      border:0;border-radius:4px;padding:6px 12px;font-size:12px;cursor:pointer;font-weight:600
    }
    .btn-imprimir{background:#16a34a;color:#fff}
    .btn-imprimir:hover{background:#15803d}
    .btn-fechar{background:#e5e7eb;color:#111}
    .btn-fechar:hover{background:#d1d5db}
    .folha{width:100%;background:#fff;padding:14px 16px}
    h1{font-size:16px;margin:0 0 2px}
    .subtitulo{color:#6b7280;font-size:11px;margin-bottom:12px}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px;color:#374151;margin-bottom:14px;line-height:1.45}
    .meta .full{grid-column:1 / -1}
    .bloco{margin-top:14px}
    .bloco h2{font-size:13px;margin:0 0 6px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;color:#111}
    table{width:100%;border-collapse:collapse;margin-top:4px}
    th,td{border:1px solid #d1d5db;padding:5px 6px}
    th{background:#f3f4f6;text-align:left}
    .totais{margin-top:10px;width:260px;margin-left:auto}
    .totais td{border:none;padding:2px 0}
    .totais td:last-child{text-align:right;font-weight:600}
    .totais tr:last-child td{font-size:13px;padding-top:6px;border-top:1px solid #d1d5db}
    .pill{
      display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;
      background:#e5e7eb;color:#111
    }
    .pill.ok{background:#dcfce7;color:#166534}
    .pill.sem{background:#f3f4f6;color:#4b5563}
    .pill.pend{background:#fef3c7;color:#92400e}
    .rodape{margin-top:16px;color:#6b7280;font-size:10px}
    @media print{
      .toolbar{display:none!important}
      .folha{padding:8mm}
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="titulo">Venda ${titulo}</div>
    <button type="button" class="btn-imprimir" onclick="window.print()">Imprimir</button>
    <button type="button" class="btn-fechar" onclick="window.close()">Fechar</button>
  </div>
  <div class="folha">
    <h1>${escapeHtml(marca)} — Venda</h1>
    <div class="subtitulo">${escapeHtml(C.centralVendasExpedidas || 'Central de Vendas Expedidas')} · consulta somente leitura</div>
    <div class="meta">
      <div><strong>Número:</strong> #${venda.id}${venda.codigo ? ` · ${escapeHtml(venda.codigo)}` : ''}</div>
      <div><strong>Data:</strong> ${fmtData(venda.data_venda || venda.created_at)}</div>
      <div><strong>Cliente:</strong> ${escapeHtml(venda.cliente_nome || 'Consumidor')}</div>
      <div><strong>Status:</strong> ${escapeHtml(rotuloStatusUi(venda.status))}</div>
      <div><strong>Origem:</strong> ${escapeHtml(rotuloOrigemUi(venda.origem))}</div>
      <div><strong>Pedido:</strong> ${venda.pedido_id ? '#' + venda.pedido_id : '—'}</div>
      <div class="full"><strong>${nfeHabilitado ? (F.documentoFiscal || 'Documento fiscal') : 'Referência'}:</strong>
        <span class="pill ${doc.tipo === 'ok' ? 'ok' : (doc.tipo === 'pendente' ? 'pend' : 'sem')}">${escapeHtml(doc.texto)}${doc.detalhe ? ' · ' + escapeHtml(doc.detalhe) : ''}</span>
      </div>
      <div class="full"><strong>Pagamento:</strong> ${escapeHtml(rotuloFormaUi(venda.forma_pagamento))}
        · ${fmtMoney(venda.total)}
        ${venda.valor_recebido != null ? ` · Recebido ${fmtMoney(venda.valor_recebido)}` : ''}
      </div>
    </div>

    <div class="bloco">
      <h2>Itens</h2>
      <table>
        <thead>
          <tr><th>Código</th><th>Descrição</th><th>Qtd</th><th>Valor</th><th>Total</th></tr>
        </thead>
        <tbody>
          ${linhas || '<tr><td colspan="5">Sem itens</td></tr>'}
        </tbody>
      </table>
      <table class="totais">
        <tr><td>Desconto</td><td>${fmtMoney(venda.desconto)}</td></tr>
        <tr><td>Valor fiscal</td><td>${fmtMoney(venda.valor_fiscal)}</td></tr>
        <tr><td>Valor não fiscal</td><td>${fmtMoney(venda.valor_nao_fiscal)}</td></tr>
        <tr><td>Total</td><td>${fmtMoney(venda.total)}</td></tr>
      </table>
    </div>

    ${histLinhas ? `
    <div class="bloco">
      <h2>Histórico</h2>
      <table>
        <thead><tr><th>Data</th><th>Evento</th><th>Detalhes</th></tr></thead>
        <tbody>${histLinhas}</tbody>
      </table>
    </div>` : ''}

    <div class="rodape">Gerado em ${escapeHtml(new Date().toLocaleString('pt-BR'))}</div>
  </div>
</body>
</html>`;
  }

  function abrirJanelaImpressao(html, titulo) {
    const w = 794;
    const h = 900;
    const left = Math.max(0, Math.round((window.screen.availWidth - w) / 2));
    const top = Math.max(0, Math.round((window.screen.availHeight - h) / 2));
    const win = window.open(
      '',
      '_blank',
      `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    if (!win) {
      alertar('Permita pop-ups para imprimir.', 'warning');
      return false;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.document.title = titulo || 'Impressão';
    win.focus();
    return true;
  }

  function montarHtmlModalVenda(venda, historicoHtml) {
    const doc = docFiscalVenda(venda);
    const itens = (venda.itens || []).map((it) => `
      <tr>
        <td>${escapeHtml(it.produto_codigo || it.produto_id || '—')}</td>
        <td>${escapeHtml(it.produto_nome || ('#' + it.produto_id))}</td>
        <td class="text-end">${Number(it.quantidade || 0)}</td>
        <td class="text-end">${fmtMoney(it.preco_unitario)}</td>
        <td class="text-end fw-semibold">${fmtMoney(it.subtotal)}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="text-center text-muted">Sem itens</td></tr>';

    return `
      <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
          <div class="text-muted small">${escapeHtml(C.centralVendasExpedidas || 'Central de Vendas Expedidas')} · somente leitura</div>
          <div class="fs-5 fw-semibold">Venda #${venda.id}${venda.codigo ? ` <span class="text-muted fw-normal">· ${escapeHtml(venda.codigo)}</span>` : ''}</div>
        </div>
        <div class="d-flex flex-wrap gap-1">
          ${badgeStatusVendaUi(venda.status)}
          ${badgeDocUi(doc)}
          <span class="badge bg-light text-dark border">${escapeHtml(rotuloOrigemUi(venda.origem))}</span>
        </div>
      </div>

      <div class="row g-3 mb-3">
        <div class="col-md-8">
          <div class="card h-100 border-0 shadow-sm">
            <div class="card-body">
              <div class="row g-3">
                <div class="col-sm-6">
                  <div class="text-muted small">Cliente</div>
                  <div class="fw-semibold">${escapeHtml(venda.cliente_nome || 'Consumidor')}</div>
                </div>
                <div class="col-sm-3">
                  <div class="text-muted small">Data</div>
                  <div>${fmtData(venda.data_venda || venda.created_at)}</div>
                </div>
                <div class="col-sm-3">
                  <div class="text-muted small">Pedido</div>
                  <div>${venda.pedido_id ? '#' + venda.pedido_id : '—'}</div>
                </div>
                <div class="col-sm-6">
                  <div class="text-muted small">Pagamento</div>
                  <div>${escapeHtml(rotuloFormaUi(venda.forma_pagamento))}
                    ${venda.valor_recebido != null ? `<span class="text-muted">· Recebido ${fmtMoney(venda.valor_recebido)}</span>` : ''}
                  </div>
                </div>
                <div class="col-sm-6">
                  <div class="text-muted small">${nfeHabilitado ? (F.documentoFiscal || 'Documento fiscal') : 'Referência'}</div>
                  <div>${escapeHtml(doc.texto)}${doc.detalhe ? ` <span class="text-muted">(${escapeHtml(doc.detalhe)})</span>` : ''}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card h-100 border-0 shadow-sm bg-light">
            <div class="card-body">
              <div class="text-muted small mb-1">Total da venda</div>
              <div class="fs-4 fw-bold text-primary mb-3">${fmtMoney(venda.total)}</div>
              <div class="d-flex justify-content-between small mb-1"><span>Fiscal</span><strong>${fmtMoney(venda.valor_fiscal)}</strong></div>
              <div class="d-flex justify-content-between small mb-1"><span>Não fiscal</span><strong>${fmtMoney(venda.valor_nao_fiscal)}</strong></div>
              <div class="d-flex justify-content-between small"><span>Desconto</span><strong>${fmtMoney(venda.desconto)}</strong></div>
            </div>
          </div>
        </div>
      </div>

      <div class="card border-0 shadow-sm mb-3">
        <div class="card-header bg-white fw-semibold">Itens</div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-sm table-hover mb-0 align-middle">
              <thead class="table-light">
                <tr>
                  <th>Código</th><th>Produto</th>
                  <th class="text-end">Qtd</th>
                  <th class="text-end">Preço</th>
                  <th class="text-end">Subtotal</th>
                </tr>
              </thead>
              <tbody>${itens}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card border-0 shadow-sm">
        <div class="card-header bg-white fw-semibold">Histórico</div>
        <div class="card-body">${historicoHtml}</div>
      </div>
    `;
  }

  async function visualizarVenda(vendaId) {
    try {
      const resp = await fetch(`${API_URL}/vendas/${vendaId}`, { headers });
      const venda = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(venda.error || 'Falha ao carregar venda.');

      let historicoEventos = [];
      let historicoHtml = '<p class="text-muted small mb-0">Sem eventos fiscais registrados.</p>';
      if (venda.nfe_id && nfeHabilitado) {
        try {
          const hResp = await fetch(`${API_URL}/nfe/notas/${venda.nfe_id}/historico`, { headers });
          const hData = await hResp.json().catch(() => ({}));
          historicoEventos = hData.eventos || [];
          if (historicoEventos.length) {
            historicoHtml = `<div class="table-responsive"><table class="table table-sm mb-0">
              <thead><tr><th>Data</th><th>Evento</th><th>Detalhes</th></tr></thead>
              <tbody>${historicoEventos.slice(0, 30).map((e) => `
                <tr>
                  <td class="text-nowrap small">${escapeHtml(e.criado_em || '—')}</td>
                  <td><span class="badge bg-secondary">${escapeHtml(e.acao || e.evento || '—')}</span></td>
                  <td class="small">${escapeHtml(typeof e.detalhes === 'string' ? e.detalhes : JSON.stringify(e.detalhes || ''))}</td>
                </tr>`).join('')}</tbody></table></div>`;
          }
        } catch (_) { /* histórico opcional */ }
      }

      abrirDetalhe(
        `Venda #${vendaId}`,
        montarHtmlModalVenda(venda, historicoHtml),
        { tipo: 'venda', id: Number(vendaId), payload: venda, historico: historicoEventos }
      );
    } catch (err) {
      alertar(err.message, 'danger');
    }
  }

  async function visualizarPedido(pedidoId) {
    try {
      const resp = await fetch(`${API_URL}/faturamento/pedidos/${pedidoId}`, { headers });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Falha ao carregar pedido.');
      const p = data.pedido || data;
      const itens = (p.itens || []).map((it) => `
        <tr>
          <td>${escapeHtml(it.produto_codigo || it.produto_id || '—')}</td>
          <td>${escapeHtml(it.produto_nome || ('#' + it.produto_id))}</td>
          <td class="text-end">${it.quantidade}</td>
          <td class="text-end">${fmtMoney(it.preco_unitario)}</td>
          <td class="text-end fw-semibold">${fmtMoney(it.subtotal)}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="text-center text-muted">Sem itens</td></tr>';

      abrirDetalhe(`Pedido ${p.codigo || ('#' + pedidoId)}`, `
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
          <div>
            <div class="text-muted small">Pedido de origem · somente leitura</div>
            <div class="fs-5 fw-semibold">${escapeHtml(p.codigo || ('#' + pedidoId))}</div>
          </div>
          <span class="badge bg-warning text-dark">${escapeHtml(p.status || '—')}</span>
        </div>
        <div class="card border-0 shadow-sm mb-3">
          <div class="card-body">
            <div class="row g-3">
              <div class="col-md-4"><div class="text-muted small">Cliente</div><div class="fw-semibold">${escapeHtml(p.cliente_nome || 'Consumidor')}</div></div>
              <div class="col-md-4"><div class="text-muted small">Total</div><div class="fw-semibold">${fmtMoney(p.total)}</div></div>
              <div class="col-md-4"><div class="text-muted small">Venda</div><div>${p.venda_id ? '#' + p.venda_id : '—'}</div></div>
            </div>
          </div>
        </div>
        <div class="card border-0 shadow-sm">
          <div class="card-header bg-white fw-semibold">Itens</div>
          <div class="card-body p-0">
            <div class="table-responsive">
              <table class="table table-sm mb-0 align-middle">
                <thead class="table-light"><tr>
                  <th>Código</th><th>Produto</th><th class="text-end">Qtd</th>
                  <th class="text-end">Preço</th><th class="text-end">Subtotal</th>
                </tr></thead>
                <tbody>${itens}</tbody>
              </table>
            </div>
          </div>
        </div>
      `, { tipo: 'pedido', id: Number(pedidoId), payload: p });
    } catch (err) {
      alertar(err.message, 'danger');
    }
  }

  async function reimprimirPedido(pedidoId) {
    if (typeof imprimirPedidoPorId !== 'function') {
      alertar('Função de impressão de pedido indisponível.', 'warning');
      return;
    }
    const out = await imprimirPedidoPorId(pedidoId);
    if (!out.ok) alertar(out.error || 'Falha ao reimprimir pedido.', 'danger');
  }

  /** RC3.15.2 — pós-emissão: abrir Visualização da NF-e (paridade NFC-e → cupom) */
  function concluirEmissaoNaCentralDocumental(nfe) {
    if (typeof apresentarDocumentoNfePosEmissao === 'function') {
      apresentarDocumentoNfePosEmissao(nfe);
      return;
    }
    const notaId = Number(nfe?.notaId || nfe?.nota_id || 0) || null;
    const status = String(nfe?.status || '').toLowerCase();
    const autorizada = Boolean(nfe?.success || status === 'autorizada');
    const banner = autorizada
      ? {
        notaId,
        numero: nfe?.numero,
        serie: nfe?.serie,
        protocolo: nfe?.protocolo,
        chaveAcesso: nfe?.chaveAcesso || nfe?.chave
      }
      : null;
    if (typeof abrirCentralNfeDocumental === 'function') {
      abrirCentralNfeDocumental({
        notaId,
        openFicha: true,
        banner,
        posEmissao: true,
        pendente: !autorizada
      });
    } else if (typeof loadPage === 'function') {
      window.__CDS_NFE_FOCUS_NOTA_ID = notaId;
      window.__CDS_NFE_OPEN_FICHA = true;
      window.__CDS_NFE_POS_EMISSAO = true;
      window.__CDS_NFE_PENDENTE = !autorizada;
      if (banner) window.__CDS_NFE_AUTH_BANNER = banner;
      loadPage('nfe-central');
    }
  }

  /**
   * RC2.1 — um único botão "Cancelar Venda".
   * Sistema escolhe: NF-e autorizada → SEFAZ (fluxo existente) + cancelamento comercial;
   * sem NF-e → apenas cancelamento comercial (já trata NFC-e se houver).
   */
  function cancelarVendaCentral(row) {
    const vendaId = Number(row.id);
    if (!vendaId) return;
    const temNfe = !!(row.nfe_id && String(row.nfe_status || '').toLowerCase() === 'autorizada');

    const modalAnterior = document.getElementById('modalCancelarVendaCentral');
    if (modalAnterior) modalAnterior.remove();

    const aviso = temNfe
      ? 'Esta venda possui NF-e autorizada. O sistema cancelará o documento na SEFAZ e em seguida executará o cancelamento comercial (financeiro/estoque/status).'
      : 'Esta ação executará o cancelamento comercial da venda (financeiro, estoque e status). Se houver NFC-e autorizada, o fluxo fiscal existente será aplicado automaticamente.';

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="modal fade" id="modalCancelarVendaCentral" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header bg-danger text-white">
              <h5 class="modal-title">Cancelar Venda #${vendaId}</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <div class="alert alert-warning">${aviso}</div>
              <label class="form-label fw-bold" for="fatMotivoCancelamento">Motivo do cancelamento</label>
              <textarea id="fatMotivoCancelamento" class="form-control" rows="3"
                placeholder="${temNfe ? 'Mínimo 15 caracteres (exigência SEFAZ)' : 'Descreva o motivo'}"></textarea>
              <small class="text-muted">Confirmação obrigatória. Regras de senha administrativa existentes continuam valendo.</small>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Voltar</button>
              <button type="button" class="btn btn-danger" id="btnFatConfirmarCancelamento">
                <i class="fas fa-ban"></i> Confirmar Cancelamento
              </button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const modalEl = document.getElementById('modalCancelarVendaCentral');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
    setTimeout(() => document.getElementById('fatMotivoCancelamento')?.focus(), 100);

    document.getElementById('btnFatConfirmarCancelamento').addEventListener('click', async () => {
      const motivo = String(document.getElementById('fatMotivoCancelamento')?.value || '').trim();
      if (typeof validarMotivoTexto === 'function') {
        const v = validarMotivoTexto(motivo);
        if (!v.valido) {
          alertar(v.erro || 'Motivo inválido.', 'warning');
          return;
        }
      } else if (!motivo || (temNfe && motivo.length < 15)) {
        alertar(temNfe ? 'Motivo deve ter pelo menos 15 caracteres.' : 'Informe o motivo.', 'warning');
        return;
      }

      const btn = document.getElementById('btnFatConfirmarCancelamento');
      btn.disabled = true;
      try {
        if (temNfe && nfeHabilitado) {
          const nfeResp = await fetch(`${API_URL}/nfe/notas/${row.nfe_id}/cancelar`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ justificativa: motivo })
          });
          const nfeData = await nfeResp.json().catch(() => ({}));
          if (!nfeResp.ok || nfeData.success === false) {
            throw new Error(nfeData.error || nfeData.message || 'Falha ao cancelar NF-e na SEFAZ.');
          }
        }

        const payload = typeof montarPayloadCancelamentoVenda === 'function'
          ? montarPayloadCancelamentoVenda(motivo)
          : { motivo };
        const resp = await fetch(`${API_URL}/vendas/cancelar/${vendaId}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
        const dados = await resp.json().catch(() => ({}));
        if (!resp.ok || dados.sucesso === false) {
          const msg = dados.mensagem || dados.error
            || (typeof extrairMensagemErroResposta === 'function'
              ? extrairMensagemErroResposta(dados, resp.status)
              : 'Falha no cancelamento comercial.');
          throw new Error(msg);
        }

        modal.hide();
        alertar(
          temNfe
            ? `Venda #${vendaId} cancelada (NF-e na SEFAZ + processos internos).`
            : `Venda #${vendaId} cancelada.`,
          'success'
        );
        await carregarVendasFaturadas();
      } catch (err) {
        alertar(err.message, 'danger');
      } finally {
        btn.disabled = false;
      }
    });
  }

  async function carregarFila() {
    $('#fatFilaBody').html('<tr><td colspan="7" class="text-center text-muted py-4">Carregando…</td></tr>');
    try {
      const resp = await fetch(`${API_URL}/faturamento/pedidos/aguardando-faturamento`, { headers });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
      const itens = data.itens || [];
      if (!itens.length) {
        $('#fatFilaBody').html(`<tr><td colspan="7" class="text-center text-muted py-4">${escapeHtml(C.filaVazia || 'Nenhum pedido aguardando expedição.')}</td></tr>`);
        return;
      }
      $('#fatFilaBody').html(itens.map((p) => `
        <tr>
          <td><strong>${escapeHtml(p.codigo || ('#' + p.id))}</strong></td>
          <td>${escapeHtml(p.cliente_nome || 'Consumidor')}</td>
          <td>${fmtData(p.data_pedido)}</td>
          <td class="text-end">${fmtMoney(p.total)}</td>
          <td>${escapeHtml(p.representante_nome || '—')}</td>
          <td><span class="badge bg-warning text-dark">${escapeHtml(p.status)}</span></td>
          <td class="text-end">
            <button type="button" class="btn btn-sm btn-success btn-faturar" data-id="${p.id}">
              <i class="fas fa-dolly"></i> ${escapeHtml(C.expedir || 'Expedir')}
            </button>
          </td>
        </tr>`).join(''));
      $('.btn-faturar').off('click').on('click', function () {
        abrirFaturar(Number($(this).data('id')));
      });
    } catch (err) {
      $('#fatFilaBody').html(`<tr><td colspan="7" class="text-danger text-center py-4">${escapeHtml(err.message)}</td></tr>`);
    }
  }

  async function carregarVendasFaturadas() {
    renderAbas();
    $('#fatVendasBody').html(`<tr><td colspan="${COLSPAN}" class="text-center text-muted py-4">Carregando…</td></tr>`);
    try {
      const filtros = coletarFiltros();
      const qs = new URLSearchParams({
        aba: abaAtual,
        modo_fiscal: modoFiscalParam(),
        page: String(pageAtual),
        pageSize: String(pageSize)
      });
      Object.keys(filtros).forEach((k) => {
        if (filtros[k]) qs.set(k, filtros[k]);
      });
      const resp = await fetch(`${API_URL}/faturamento/vendas-faturadas?${qs}`, { headers });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));

      abaAtual = data.aba || abaAtual;
      totalVendas = Number(data.total || 0);
      renderAbas(data.abas_disponiveis);

      const itens = data.itens || [];
      if (!itens.length) {
        $('#fatVendasBody').html(`<tr><td colspan="${COLSPAN}" class="text-center text-muted py-4">Nenhuma venda nesta aba.</td></tr>`);
      } else {
        $('#fatVendasBody').html(itens.map((v) => `
          <tr>
            <td><strong>#${v.id}</strong>${v.codigo ? ` <span class="text-muted">${escapeHtml(v.codigo)}</span>` : ''}${v.pedido_id ? `<div class="small text-muted">Ped. #${v.pedido_id}</div>` : ''}</td>
            <td>${escapeHtml(v.cliente_nome || 'Consumidor')}</td>
            <td>${fmtData(v.data_venda || v.created_at)}</td>
            <td>${escapeHtml(v.origem_label || v.origem || '—')}</td>
            <td class="text-end">${fmtMoney(v.total)}</td>
            <td>${celulaDocumento(v)}</td>
            <td>${badgeStatusVisual(v)}</td>
            <td class="text-end">${acoesVenda(v)}</td>
          </tr>`).join(''));
        bindAcoesLinha();
      }

      const totalPages = Math.max(1, Math.ceil(totalVendas / pageSize));
      $('#fatVendasMeta').text(
        totalVendas
          ? `Página ${pageAtual} de ${totalPages} · ${totalVendas} venda(s)`
          : '0 venda(s)'
      );
      $('#btnFatPagePrev').prop('disabled', pageAtual <= 1);
      $('#btnFatPageNext').prop('disabled', pageAtual >= totalPages || totalVendas === 0);
    } catch (err) {
      $('#fatVendasBody').html(`<tr><td colspan="${COLSPAN}" class="text-danger text-center py-4">${escapeHtml(err.message)}</td></tr>`);
      $('#fatVendasMeta').text('');
      $('#btnFatPagePrev').prop('disabled', true);
      $('#btnFatPageNext').prop('disabled', true);
    }
  }

  async function atualizarTudo() {
    await Promise.all([carregarFila(), carregarVendasFaturadas()]);
  }

  async function abrirFaturar(pedidoId) {
    try {
      const resp = await fetch(`${API_URL}/faturamento/pedidos/${pedidoId}`, { headers });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Falha ao carregar pedido.');
      pedidoSelecionado = data.pedido;
      $('#fatModalResumo').html(
        `<strong>${escapeHtml(pedidoSelecionado.codigo || ('#' + pedidoSelecionado.id))}</strong>` +
        ` · Cliente: ${escapeHtml(pedidoSelecionado.cliente_nome || 'Consumidor')}` +
        ` · ${fmtMoney(pedidoSelecionado.total)}`
      );
      $('#fatModalItens').html((pedidoSelecionado.itens || []).map((it) => `
        <tr>
          <td>${escapeHtml(it.produto_nome || ('#' + it.produto_id))}</td>
          <td>${it.quantidade}</td>
          <td>${fmtMoney(it.preco_unitario)}</td>
          <td>${it.desconto_percentual || 0}</td>
          <td class="text-end">${fmtMoney(it.subtotal)}</td>
        </tr>`).join(''));
      $('#fatValorTotal').val(fmtMoney(pedidoSelecionado.total));
      $('#fatDesconto').val(pedidoSelecionado.desconto || 0);
      $('#fatAcrescimo').val(pedidoSelecionado.acrescimo || 0);
      $('#fatFrete').val(pedidoSelecionado.frete || 0);
      $('#fatObs').val(pedidoSelecionado.observacao || '');
      initFormasPagamentoExpedir();
      $('#btn-restaurar-modalFaturarPedido').remove();
      new bootstrap.Modal(document.getElementById('modalFaturarPedido')).show();
    } catch (err) {
      alertar(err.message, 'danger');
    }
  }

  $('#btnConfirmarFaturar').off('click').on('click', async function () {
    if (!pedidoSelecionado) return;
    const frete = Number($('#fatFrete').val() || 0);
    const acrescimo = Number($('#fatAcrescimo').val() || 0);
    const desconto = Number($('#fatDesconto').val() || 0);
    const total = totalModalExpedir();
    const pagPayload = (typeof CdsFormasPagamento !== 'undefined')
      ? CdsFormasPagamento.montarPayloadPagamento('fat', total)
      : {
        forma_pagamento: $('#fatForma').val() || 'dinheiro',
        pagamentos: [{ forma_pagamento: $('#fatForma').val() || 'dinheiro', valor: total }],
        valor_recebido: total,
        parcelas: 1
      };

    // Parcelado / boleto / crediário exigem cliente no núcleo
    if (typeof CdsFormasPagamento !== 'undefined'
      && CdsFormasPagamento.ehParcelavel(pagPayload.forma_pagamento)
      && !pedidoSelecionado.cliente_id) {
      alertar('Informe o cliente no pedido para Boleto, Crediário ou Parcelado.', 'warning');
      return;
    }

    const btn = $(this);
    btn.prop('disabled', true);
    try {
      const resp = await fetch(`${API_URL}/faturamento/pedidos/${pedidoSelecionado.id}/faturar`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...pagPayload,
          emitir_nfe: false,
          frete, acrescimo, desconto,
          observacoes: $('#fatObs').val()
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || C.falhaExpedir || 'Falha ao expedir.');
      $('#btn-restaurar-modalFaturarPedido').remove();
      bootstrap.Modal.getInstance(document.getElementById('modalFaturarPedido'))?.hide();

      const vendaId = Number(data.venda_id || data.venda?.id || data.venda?.venda_id || 0) || 0;

      // RC4.0.0 — encaminhar automaticamente para Central de Faturamento
      if (vendaId && nfeHabilitado && typeof loadPage === 'function') {
        try {
          window.__cdsCentralFatVendaId = vendaId;
          localStorage.setItem('cds_central_fat_venda_id', String(vendaId));
        } catch (_) { /* ignore */ }
        alertar(`${C.sucessoExpedido || 'Pedido expedido.'} Venda #${vendaId}. Abrindo Central de Faturamento…`, 'success');
        loadPage('central-faturamento');
        return;
      }

      alertar(`${C.sucessoExpedido || 'Pedido expedido.'} Venda #${vendaId || '—'}.`, 'success');
      pageAtual = 1;
      abaAtual = 'sem_nfe';
      if (modoFiscalAtivo() && abaAtual === 'sem_nfe') abaAtual = 'todas';
      await atualizarTudo();
    } catch (err) {
      alertar(err.message, 'danger');
    } finally {
      btn.prop('disabled', false);
    }
  });

  $('#btnFatAtualizar').off('click').on('click', atualizarTudo);
  $('#btnFatFiltrar').off('click').on('click', () => {
    pageAtual = 1;
    carregarVendasFaturadas();
  });
  $('#btnFatLimparFiltros').off('click').on('click', () => {
    $('#fatFiltroCliente, #fatFiltroVenda, #fatFiltroPedido, #fatFiltroDocumento').val('');
    $('#fatFiltroOrigem, #fatFiltroStatus').val('');
    $('#fatFiltroDataInicio, #fatFiltroDataFim').val('');
    pageAtual = 1;
    carregarVendasFaturadas();
  });
  $('#fatFiltrosForm input').off('keydown').on('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      pageAtual = 1;
      carregarVendasFaturadas();
    }
  });
  $('#btnFatPagePrev').off('click').on('click', () => {
    if (pageAtual > 1) {
      pageAtual -= 1;
      carregarVendasFaturadas();
    }
  });
  $('#btnFatPageNext').off('click').on('click', () => {
    const totalPages = Math.max(1, Math.ceil(totalVendas / pageSize));
    if (pageAtual < totalPages) {
      pageAtual += 1;
      carregarVendasFaturadas();
    }
  });
  $('#btnFatDetalheImprimir').off('click').on('click', async () => {
    const ctx = ultimoDetalheCtx;
    if (!ctx) {
      alertar('Nada para imprimir.', 'warning');
      return;
    }
    if (ctx.tipo === 'pedido') {
      if (typeof imprimirPedidoPorId === 'function') {
        const out = await imprimirPedidoPorId(ctx.id);
        if (!out.ok) alertar(out.error || 'Falha ao imprimir pedido.', 'danger');
      } else {
        alertar('Impressão de pedido indisponível.', 'warning');
      }
      return;
    }
    if (ctx.tipo === 'venda' && ctx.payload) {
      const html = montarHtmlImpressaoVenda(ctx.payload, ctx.historico || []);
      abrirJanelaImpressao(html, `Venda #${ctx.id}`);
      return;
    }
    alertar('Nada para imprimir.', 'warning');
  });
  $('#btnFatNovoPedido').off('click').on('click', () => {
    new bootstrap.Modal(document.getElementById('modalNovoPedidoFat')).show();
  });

  $('#btnSalvarNovoPedidoFat').off('click').on('click', async function () {
    const produtoId = Number($('#fatNovoProdutoId').val());
    const qtd = Number($('#fatNovoQtd').val());
    const preco = Number($('#fatNovoPreco').val());
    if (!(produtoId > 0) || !(qtd > 0) || !(preco >= 0)) {
      alertar('Informe produto, quantidade e preço.', 'warning');
      return;
    }
    const subtotal = Number((qtd * preco).toFixed(2));
    try {
      const resp = await fetch(`${API_URL}/faturamento/pedidos`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          cliente_id: $('#fatNovoClienteId').val() ? Number($('#fatNovoClienteId').val()) : null,
          representante_nome: $('#fatNovoRepresentante').val() || null,
          itens: [{ produto_id: produtoId, quantidade: qtd, preco_unitario: preco, subtotal }],
          total: subtotal
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Falha ao criar pedido.');
      bootstrap.Modal.getInstance(document.getElementById('modalNovoPedidoFat'))?.hide();
      alertar(`Pedido ${data.pedido?.codigo || ''} na fila.`, 'success');
      await carregarFila();
    } catch (err) {
      alertar(err.message, 'danger');
    }
  });

  await atualizarTudo();
}

/** RC5 — Modal Central NF-e modo DEVOLUÇÃO (origem VENDA) */
function abrirModalNFeDevolucaoVenda(vendaId) {
  const id = Number(vendaId);
  if (!(id > 0)) return;

  $.ajax({
    url: `${API_URL}/vendas/${id}/nfe-devolucao/preparar`,
    method: 'GET'
  }).done(function (prep) {
    const venda = prep.venda || {};
    const ctrl = prep.controleSaldo || {};
    const itens = prep.itens || [];
    const chave = prep.chaveReferenciada || prep.nfeOriginal?.chave || '';
    const bloqueado = Boolean(prep.bloqueado);
    const escapeHtml = (typeof window.escapeHtml === 'function')
      ? window.escapeHtml
      : (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));

    const badgeSaldo = (ui) => {
      if (!ui) return '';
      const cls = ui.cor === 'verde' ? 'bg-success' : (ui.cor === 'amarelo' ? 'bg-warning text-dark' : (ui.cor === 'azul' ? 'bg-primary' : 'bg-danger'));
      return `<span class="badge ${cls}">${escapeHtml(ui.emoji || '')} ${escapeHtml(ui.label || '')}</span>`;
    };

    const linhas = itens.map((item) => `
      <tr>
        <td>${escapeHtml(item.produto_nome || '-')}</td>
        <td class="text-end small">${Number(item.quantidade_vendida || 0)}</td>
        <td class="text-end small">${Number(item.quantidade_devolvida || 0)}</td>
        <td class="text-end small text-primary">${Number(item.saldo || 0)}</td>
        <td>
          <input type="number" min="0.001" step="0.001" class="form-control form-control-sm nfe-dev-venda-qtd"
            data-venda-item-id="${item.venda_item_id}"
            data-produto-id="${item.produto_id || ''}"
            data-valor-unitario="${Number(item.valor_unitario || 0)}"
            data-max="${Number(item.saldo || 0)}"
            value="${Number(item.quantidade || item.saldo || 0)}"
            ${bloqueado ? 'disabled' : ''}>
        </td>
        <td>
          <input type="text" maxlength="4" class="form-control form-control-sm nfe-dev-venda-cfop"
            value="${escapeHtml(item.cfop || prep.cfopSugerido || '1202')}" ${bloqueado ? 'disabled' : ''}>
        </td>
        <td class="small">${badgeSaldo(item.status_ui)}</td>
      </tr>
    `).join('');

    const historico = (prep.nfeDevolucoes || []).map((n) => {
      const ui = n.statusUi || {};
      const acoes = n.acoes || {};
      return `
        <li class="mb-2">
          <strong>NF-e ${escapeHtml(String(n.numero || n.id))}/${escapeHtml(String(n.serie || '-'))}</strong>
          — ${escapeHtml(ui.emoji || '')} ${escapeHtml(ui.label || n.status || '-')}
          <div class="text-muted small" style="word-break:break-all">Chave: ${escapeHtml(n.chave_acesso || '-')}</div>
          <div class="d-flex flex-wrap gap-2 mt-1">
            ${/autorizad/i.test(String(n.status || '')) ? `
            <button type="button" class="btn btn-sm btn-outline-secondary" onclick="abrirDanfe({tipo:'DEVOLUCAO_VENDA',id:${n.id},chave:'${escapeHtml(n.chave_acesso || '')}'})">👁 DANFE</button>
            <button type="button" class="btn btn-sm btn-outline-primary" onclick="abrirDanfe({tipo:'DEVOLUCAO_VENDA',id:${n.id},imprimir:true})">🖨 Reimprimir</button>
            <button type="button" class="btn btn-sm btn-outline-primary" onclick="baixarDanfePdf({tipo:'DEVOLUCAO_VENDA',id:${n.id}})">📄 PDF</button>
            <button type="button" class="btn btn-sm btn-outline-dark" onclick="baixarXmlNfe55({tipo:'DEVOLUCAO_VENDA',id:${n.id}})">&lt;/&gt; XML</button>
            ` : ''}
            ${acoes.consultar ? `<button type="button" class="btn btn-sm btn-outline-info" onclick="consultarSituacaoNfeDevolucaoVenda(${n.id}, ${id})">Consultar Situação</button>` : ''}
            ${acoes.reenviar ? `<button type="button" class="btn btn-sm btn-outline-warning" onclick="reenviarNfeDevolucaoVenda(${n.id}, ${id})">Reenviar</button>` : ''}
            ${acoes.cancelar ? `<button type="button" class="btn btn-sm btn-outline-danger" onclick="cancelarNfeDevolucaoVendaUi(${n.id}, ${id})">Cancelar (SEFAZ)</button>` : ''}
          </div>
        </li>`;
    }).join('');

    const finOps = (prep.financeiroOpcoes || []).map((o) =>
      `<span class="badge bg-secondary me-1">${escapeHtml(String(o).replace(/_/g, ' '))}</span>`
    ).join('');

    const modalHtml = `
      <div class="modal fade" id="modalNFeDevolucaoVenda" tabindex="-1">
        <div class="modal-dialog modal-xl modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header bg-danger text-white">
              <h5 class="modal-title"><i class="fas fa-file-invoice"></i> Central NF-e — Modo DEVOLUÇÃO (Venda)</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <pre class="border rounded p-3 bg-dark text-warning text-center mb-3" style="font-family: Consolas, monospace; white-space: pre-wrap;">═══════════════════════════════
NF-e DE DEVOLUÇÃO DE VENDA

Venda nº: ${venda.id || id}
Cliente: ${escapeHtml(venda.cliente_nome || '-')}
NF-e Original: ${escapeHtml(chave || '-')}
═══════════════════════════════</pre>
              ${prep.motivoBloqueio ? `<div class="alert alert-warning">${escapeHtml(prep.motivoBloqueio)}</div>` : ''}
              <div class="border rounded p-3 mb-3">
                <h6>Controle de Saldo ${badgeSaldo(ctrl.statusVendaUi || ctrl.statusCompraUi)}</h6>
                <div class="row small mb-2">
                  <div class="col-md-4"><strong>Vendido:</strong> ${Number(ctrl.totais?.vendido || ctrl.totais?.comprado || 0)}</div>
                  <div class="col-md-4"><strong>Devolvido:</strong> ${Number(ctrl.totais?.devolvido || 0)}</div>
                  <div class="col-md-4"><strong>Saldo:</strong> ${Number(ctrl.totais?.saldo || 0)}</div>
                </div>
                <div class="table-responsive">
                  <table class="table table-sm table-bordered">
                    <thead><tr><th>Produto</th><th class="text-end">Vendido</th><th class="text-end">Devolvido</th><th class="text-end">Saldo</th><th>Qtd</th><th>CFOP</th><th>Status</th></tr></thead>
                    <tbody>${linhas || '<tr><td colspan="7" class="text-muted text-center">Sem itens</td></tr>'}</tbody>
                  </table>
                </div>
              </div>
              <div class="mb-3">
                <label class="form-label">Observações</label>
                <input type="text" id="nfeDevVendaObs" class="form-control" maxlength="500" ${bloqueado ? 'disabled' : ''}>
              </div>
              <div class="border rounded p-3 mb-3 bg-light">
                <h6 class="mb-2">Financeiro (disponível — não executa automaticamente)</h6>
                <div>${finOps || '<span class="text-muted small">—</span>'}</div>
              </div>
              <div class="border rounded p-3 bg-light">
                <h6>Histórico — NF-e de Devolução</h6>
                <ol class="mb-0 ps-3">${historico || '<li class="text-muted">Nenhuma emissão ainda.</li>'}</ol>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
              <button class="btn btn-danger" id="btnEmitirNfeDevVenda"
                onclick="confirmarEmissaoNFeDevolucaoVenda(${id})"
                ${bloqueado || !itens.length ? 'disabled' : ''}>
                Emitir NF-e de Devolução
              </button>
            </div>
          </div>
        </div>
      </div>`;

    $('#modalNFeDevolucaoVenda').remove();
    $('body').append(modalHtml);
    $('#modalNFeDevolucaoVenda').modal('show');
    $('#modalNFeDevolucaoVenda').on('hidden.bs.modal', function () {
      $('#modalNFeDevolucaoVenda').remove();
    });
  }).fail(function (xhr) {
    const msg = xhr.responseJSON?.error || 'Erro ao preparar devolução de venda.';
    if (typeof showNotification === 'function') showNotification(msg, 'danger');
    else alert(msg);
  });
}

function confirmarEmissaoNFeDevolucaoVenda(vendaId) {
  const itens = [];
  let excedeu = false;
  $('#modalNFeDevolucaoVenda .nfe-dev-venda-qtd').each(function () {
    const qtd = Number($(this).val() || 0);
    if (!(qtd > 0)) return;
    const max = Number($(this).data('max') || 0);
    if (qtd > max + 1e-9) {
      excedeu = true;
      if (typeof showNotification === 'function') {
        showNotification(`Quantidade ${qtd} excede o saldo (${max}).`, 'warning');
      }
      return false;
    }
    const $tr = $(this).closest('tr');
    itens.push({
      venda_item_id: Number($(this).data('venda-item-id')),
      produto_id: Number($(this).data('produto-id')) || null,
      quantidade: qtd,
      valor_unitario: Number($(this).data('valor-unitario') || 0),
      cfop: String($tr.find('.nfe-dev-venda-cfop').val() || '1202').replace(/\D/g, '').slice(0, 4)
    });
  });
  if (excedeu || !itens.length) {
    if (!itens.length && typeof showNotification === 'function') {
      showNotification('Informe a quantidade de pelo menos um item.', 'warning');
    }
    return;
  }
  if (!confirm('Confirma emissão da NF-e de Devolução de Venda para a SEFAZ?')) return;

  $.ajax({
    url: `${API_URL}/vendas/${vendaId}/emitir-nfe-devolucao`,
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({
      itens,
      observacoes: $('#nfeDevVendaObs').val() || null
    })
  }).done(function (resp) {
    const r = resp.resultado || resp;
    const msg = resp.message || r.message || `Status: ${r.status}`;
    if (typeof showNotification === 'function') {
      showNotification(msg, r.success ? 'success' : 'warning');
    }
    $('#modalNFeDevolucaoVenda').modal('hide');
    if ((r.success || r.status === 'autorizada') && typeof abrirDanfe === 'function' && r.notaId) {
      abrirDanfe({
        tipo: 'DEVOLUCAO_VENDA',
        id: r.notaId,
        chave: r.chaveAcesso || r.chave,
        numero: r.numero,
        serie: r.serie,
        auto: true
      });
      return;
    }
    abrirModalNFeDevolucaoVenda(vendaId);
  }).fail(function (xhr) {
    const body = xhr.responseJSON || {};
    const msg = body.mensagem || body.error || body.resultado?.message || 'Falha na emissão.';
    if (typeof showNotification === 'function') showNotification(msg, 'danger');
  });
}

function consultarSituacaoNfeDevolucaoVenda(notaId, vendaId) {
  $.ajax({
    url: `${API_URL}/vendas/nfe-devolucao/${notaId}/consultar`,
    method: 'POST',
    contentType: 'application/json',
    data: '{}'
  }).done(function (resp) {
    if (typeof showNotification === 'function') {
      showNotification(resp.mensagem || resp.xMotivo || resp.status, 'info');
    }
    if (vendaId) {
      $('#modalNFeDevolucaoVenda').modal('hide');
      abrirModalNFeDevolucaoVenda(vendaId);
    }
  }).fail(function (xhr) {
    if (typeof showNotification === 'function') {
      showNotification(xhr.responseJSON?.error || 'Erro na consulta.', 'danger');
    }
  });
}

function reenviarNfeDevolucaoVenda(notaId, vendaId) {
  if (!confirm('Reenviar XML assinado à SEFAZ?')) return;
  $.ajax({
    url: `${API_URL}/vendas/nfe-devolucao/${notaId}/reenviar`,
    method: 'POST',
    contentType: 'application/json',
    data: '{}'
  }).done(function (resp) {
    if (typeof showNotification === 'function') {
      showNotification(resp.message || resp.status, resp.success ? 'success' : 'warning');
    }
    $('#modalNFeDevolucaoVenda').modal('hide');
    abrirModalNFeDevolucaoVenda(vendaId);
  }).fail(function (xhr) {
    if (typeof showNotification === 'function') {
      showNotification(xhr.responseJSON?.error || 'Reenvio bloqueado.', 'danger');
    }
  });
}

function cancelarNfeDevolucaoVendaUi(notaId, vendaId) {
  const motivo = prompt('Motivo do cancelamento (mín. 15 caracteres):');
  if (motivo == null) return;
  if (String(motivo).trim().length < 15) {
    if (typeof showNotification === 'function') {
      showNotification('Motivo com pelo menos 15 caracteres.', 'warning');
    }
    return;
  }
  if (!confirm('Enviar evento oficial de cancelamento à SEFAZ e reabrir saldo?')) return;
  $.ajax({
    url: `${API_URL}/vendas/nfe-devolucao/${notaId}/cancelar`,
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({ motivo: String(motivo).trim() })
  }).done(function (resp) {
    if (typeof showNotification === 'function') {
      showNotification(resp.message || (resp.success ? 'Cancelada.' : 'Rejeitado'), resp.success ? 'success' : 'danger');
    }
    $('#modalNFeDevolucaoVenda').modal('hide');
    abrirModalNFeDevolucaoVenda(vendaId);
  }).fail(function (xhr) {
    if (typeof showNotification === 'function') {
      showNotification(xhr.responseJSON?.error || xhr.responseJSON?.message || 'Erro ao cancelar.', 'danger');
    }
  });
}

window.abrirModalNFeDevolucaoVenda = abrirModalNFeDevolucaoVenda;
window.confirmarEmissaoNFeDevolucaoVenda = confirmarEmissaoNFeDevolucaoVenda;
window.consultarSituacaoNfeDevolucaoVenda = consultarSituacaoNfeDevolucaoVenda;
window.reenviarNfeDevolucaoVenda = reenviarNfeDevolucaoVenda;
window.cancelarNfeDevolucaoVendaUi = cancelarNfeDevolucaoVendaUi;

window.loadFaturamento = loadFaturamento;
