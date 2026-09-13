/**
 * ERP — Módulo Pedidos (Sprint 3.5 + 3.6 UX + 3.14 Orçamento)
 * Digitação fluida (teclado) sem alterar regras de negócio.
 * RC2.1 — layout de impressão exposto para reimpressão na Central (sem alterar modelo).
 * Sprint 3.14 — Orçamento é o primeiro estado do Pedido (mesma entidade/tela).
 */

function _pedFmtMoney(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function _pedFmtData(d) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const p = s.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
}

function _pedEscapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

/** Layout oficial de impressão do pedido — não alterar visual. */
function montarHtmlImpressaoPedido(p) {
  const escapeHtml = _pedEscapeHtml;
  const fmtMoney = _pedFmtMoney;
  const fmtData = _pedFmtData;
  const itens = Array.isArray(p.itens) ? p.itens : [];
  const linhas = itens.map((i) => `
      <tr>
        <td>${escapeHtml(i.produto_codigo || i.produto_id || '')}</td>
        <td>${escapeHtml(i.produto_nome || '')}</td>
        <td style="text-align:right;">${Number(i.quantidade || 0)}</td>
        <td style="text-align:right;">${fmtMoney(i.preco_unitario)}</td>
        <td style="text-align:right;">${Number(i.desconto_percentual || 0)}%</td>
        <td style="text-align:right;">${fmtMoney(i.subtotal)}</td>
      </tr>`).join('');

  const marca = (typeof BrandService !== 'undefined' && BrandService.meta)
    ? BrandService.meta().nome
    : 'CDS Sistemas';
  const titulo = escapeHtml(p.codigo || ('#' + p.id));
  const tipoDoc = String(p.status || '').toUpperCase() === 'ORCAMENTO' ? 'ORÇAMENTO' : 'PEDIDO';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${tipoDoc} ${titulo}</title>
  <style>
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:#e5e7eb}
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
    .folha-wrap{display:flex;justify-content:center;padding:12px;background:#e5e7eb}
    .folha{
      width:210mm;
      min-height:297mm;
      background:#fff;
      padding:14mm 16mm;
      box-shadow:0 1px 8px rgba(0,0,0,.18);
    }
    h1{font-size:16px;margin:0 0 4px}
    .meta{color:#374151;margin-bottom:12px;line-height:1.45}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    th,td{border:1px solid #d1d5db;padding:5px 6px}
    th{background:#f3f4f6;text-align:left}
    .totais{margin-top:12px;width:220px;margin-left:auto}
    .totais td{border:none;padding:2px 0}
    .totais td:last-child{text-align:right;font-weight:600}
    .totais tr:last-child td{font-size:13px;padding-top:6px;border-top:1px solid #d1d5db}
    .rodape{margin-top:16px;color:#6b7280;font-size:10px}
    @page{size:A4;margin:0}
    @media print{
      html,body{background:#fff!important}
      .toolbar{display:none!important}
      .folha-wrap{padding:0!important;background:#fff!important;display:block!important}
      .folha{
        width:210mm!important;
        min-height:297mm!important;
        margin:0!important;
        padding:8mm!important;
        box-shadow:none!important
      }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="titulo">Visualização do ${tipoDoc.toLowerCase()} ${titulo}</div>
    <button type="button" class="btn-imprimir" onclick="window.print()">Imprimir</button>
    <button type="button" class="btn-fechar" onclick="window.close()">Fechar</button>
  </div>
  <div class="folha-wrap">
  <div class="folha">
    <h1>${escapeHtml(marca)} — ${tipoDoc}</h1>
    <div class="meta">
      <div><strong>Número:</strong> ${titulo}</div>
      <div><strong>Status:</strong> ${escapeHtml(p.status || '—')}</div>
      <div><strong>Data:</strong> ${fmtData(p.data_pedido)}</div>
      <div><strong>Cliente:</strong> ${escapeHtml(p.cliente_nome || 'Consumidor')}</div>
      <div><strong>Representante:</strong> ${escapeHtml(p.representante_nome || '—')}</div>
      <div><strong>Usuário:</strong> ${escapeHtml(p.usuario_nome || '—')}</div>
      ${p.observacao ? `<div><strong>Observação:</strong> ${escapeHtml(p.observacao)}</div>` : ''}
    </div>
    <table>
      <thead>
        <tr>
          <th>Código</th><th>Descrição</th><th>Qtd</th><th>Valor</th><th>Desc.%</th><th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${linhas || '<tr><td colspan="6">Sem itens</td></tr>'}
      </tbody>
    </table>
    <table class="totais">
      <tr><td>Subtotal</td><td>${fmtMoney((itens.reduce((s, i) => s + Number(i.subtotal || 0), 0)))}</td></tr>
      <tr><td>Desconto</td><td>${fmtMoney(p.desconto)}</td></tr>
      <tr><td>Frete</td><td>${fmtMoney(p.frete)}</td></tr>
      <tr><td>Total</td><td>${fmtMoney(p.total)}</td></tr>
    </table>
    <div class="rodape">Gerado em ${escapeHtml(new Date().toLocaleString('pt-BR'))}</div>
  </div>
  </div>
</body>
</html>`;
}

/**
 * Reimpressão do pedido — layout idêntico ao módulo Pedidos.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function imprimirPedidoPorId(pedidoId) {
  const id = Number(pedidoId);
  if (!id) return { ok: false, error: 'Pedido inválido.' };
  const token = localStorage.getItem('token') || '';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + token
  };
  try {
    const resp = await fetch(`${API_URL}/pedidos/${id}`, { headers });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.mensagem || data.error || 'Falha ao carregar pedido');
    const p = data.pedido;
    if (!p) throw new Error('Pedido não encontrado.');

    // A4 @ 96dpi ≈ 794 × 1123; + barra + margem
    const w = 860;
    const h = 1200;
    const left = Math.max(0, Math.round((window.screen.availWidth - w) / 2));
    const top = Math.max(0, Math.round((window.screen.availHeight - h) / 2));
    const win = window.open(
      '',
      '_blank',
      `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    if (!win) return { ok: false, error: 'Permita pop-ups para visualizar o pedido.' };
    win.document.open();
    win.document.write(montarHtmlImpressaoPedido(p));
    win.document.close();
    win.focus();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'Erro ao abrir visualização.' };
  }
}

window.montarHtmlImpressaoPedido = montarHtmlImpressaoPedido;
window.imprimirPedidoPorId = imprimirPedidoPorId;

function loadPedidos() {
  const token = localStorage.getItem('token') || '';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + token
  };

  const fmtMoney = _pedFmtMoney;
  const fmtData = _pedFmtData;
  const escapeHtml = _pedEscapeHtml;

  const STATUS_LABEL = {
    ORCAMENTO: 'Orçamento',
    PEDIDO: 'Pedido',
    ABERTO: 'Pedido',
    EM_SEPARACAO: 'Em separação',
    AGUARDANDO_FATURAMENTO: 'Aguardando Expedição',
    FATURADO: 'Expedido',
    CANCELADO: 'Cancelado'
  };

  const ABAS = [
    { id: 'orcamentos', label: 'Orçamentos', status: 'ORCAMENTO' },
    { id: 'pedidos', label: 'Pedidos', status: 'PEDIDO,ABERTO,EM_SEPARACAO' },
    { id: 'aguardando', label: 'Aguardando Expedição', status: 'AGUARDANDO_FATURAMENTO' },
    { id: 'faturados', label: 'Expedidos', status: 'FATURADO' },
    { id: 'cancelados', label: 'Cancelados', status: 'CANCELADO' }
  ];

  let abaAtual = 'pedidos';

  function badgeStatus(st) {
    const s = String(st || '');
    let cls = 'secondary';
    if (s === 'ORCAMENTO') cls = 'info';
    else if (s === 'PEDIDO' || s === 'ABERTO') cls = 'primary';
    else if (s === 'EM_SEPARACAO') cls = 'info';
    else if (s === 'AGUARDANDO_FATURAMENTO') cls = 'warning';
    else if (s === 'FATURADO') cls = 'success';
    else if (s === 'CANCELADO') cls = 'dark';
    return `<span class="badge bg-${cls}">${STATUS_LABEL[s] || s}</span>`;
  }

  let itensEditor = [];
  let pedidoEditandoId = null;
  let pedidoEditandoStatus = null;
  let tipoNovoDocumento = 'pedido';
  let clienteSelecionado = null;
  let timerCliente = null;
  let timerProduto = null;
  let sugClienteIdx = -1;
  let sugProdutoIdx = -1;
  let linhaGradeFoco = -1;

  $('#page-content').html(`
    ${(typeof CdsPageShell !== 'undefined' && CdsPageShell.renderHeader)
      ? CdsPageShell.renderHeader({ page: 'pedidos', toolbarHtml: '' }) : ''}
    <div class="container-fluid py-3" id="pedidosRoot">
      <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <div>
          <h4 class="mb-0"><i class="fas fa-clipboard-list me-2"></i>Pedidos</h4>
          <div class="text-muted small">
            F2 Novo · Ctrl+S Salvar · Ctrl+F Cliente · Enter adiciona · Esc fecha sugestões
          </div>
        </div>
        <button type="button" class="btn btn-primary" id="btnPedNovo" title="F2">
          <i class="fas fa-plus"></i> Novo
        </button>
      </div>
      <div id="pedAlert"></div>

      <ul class="nav nav-tabs mb-3" id="pedAbas" role="tablist">
        ${ABAS.map((a) => `
          <li class="nav-item" role="presentation">
            <button type="button" class="nav-link ${a.id === abaAtual ? 'active' : ''}" data-aba="${a.id}">
              ${a.label}
            </button>
          </li>`).join('')}
      </ul>

      <div class="card shadow-sm mb-3">
        <div class="card-body">
          <div class="row g-2 align-items-end">
            <div class="col-md-3">
              <label class="form-label small mb-0">Cliente</label>
              <input type="text" class="form-control form-control-sm" id="pedFiltroCliente" placeholder="Nome">
            </div>
            <div class="col-md-3">
              <label class="form-label small mb-0">Representante</label>
              <input type="text" class="form-control form-control-sm" id="pedFiltroRepresentante">
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-0">Data inicial</label>
              <input type="date" class="form-control form-control-sm" id="pedFiltroInicio">
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-0">Data final</label>
              <input type="date" class="form-control form-control-sm" id="pedFiltroFim">
            </div>
            <div class="col-md-2">
              <button type="button" class="btn btn-sm btn-outline-primary w-100" id="btnPedPesquisar">
                <i class="fas fa-search"></i> Pesquisar
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="card shadow-sm">
        <div class="table-responsive">
          <table class="table table-hover mb-0 align-middle">
            <thead class="table-light">
              <tr>
                <th>Número</th>
                <th>Cliente</th>
                <th>Representante</th>
                <th class="text-end">Valor</th>
                <th>Status</th>
                <th>Data</th>
                <th>Usuário</th>
                <th class="text-end">Ações</th>
              </tr>
            </thead>
            <tbody id="pedListaBody">
              <tr><td colspan="8" class="text-center text-muted py-4">Carregando…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="modal fade" id="modalPedidoEditor" tabindex="-1">
      <div class="modal-dialog modal-xl modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="pedEditorTitulo">Novo pedido</h5>
            <div class="d-flex align-items-center gap-1">
              <button type="button" class="btn btn-sm btn-light" title="Minimizar"
                onclick="minimizarModal('modalPedidoEditor', document.getElementById('pedEditorTitulo')?.textContent || 'Pedido')">
                <i class="fas fa-window-minimize"></i>
              </button>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
            </div>
          </div>
          <div class="modal-body">
            <div class="row g-2 mb-3" id="pedTipoDocumentoRow">
              <div class="col-12">
                <label class="form-label mb-1">Tipo</label>
                <div class="d-flex gap-3">
                  <div class="form-check">
                    <input class="form-check-input" type="radio" name="pedTipoDocumento" id="pedTipoOrcamento" value="orcamento">
                    <label class="form-check-label" for="pedTipoOrcamento">Orçamento</label>
                  </div>
                  <div class="form-check">
                    <input class="form-check-input" type="radio" name="pedTipoDocumento" id="pedTipoPedido" value="pedido" checked>
                    <label class="form-check-label" for="pedTipoPedido">Pedido</label>
                  </div>
                </div>
              </div>
            </div>
            <div class="row g-2 mb-3">
              <div class="col-md-6 position-relative">
                <label class="form-label">Cliente <small class="text-muted">(Ctrl+F)</small></label>
                <input type="text" class="form-control" id="pedClienteBusca" placeholder="Pesquisar por nome, CPF ou telefone" autocomplete="off">
                <input type="hidden" id="pedClienteId">
                <div id="pedClienteSugestoes" class="list-group position-absolute w-100 shadow" style="z-index:1050;display:none;max-height:220px;overflow:auto;"></div>
                <div class="form-text" id="pedClienteSelecionadoLabel">Nenhum cliente selecionado</div>
              </div>
              <div class="col-md-3">
                <label class="form-label">Representante</label>
                <input type="text" class="form-control" id="pedRepresentante">
              </div>
              <div class="col-md-3">
                <label class="form-label">Frete previsto</label>
                <input type="number" step="0.01" min="0" class="form-control" id="pedFrete" value="0">
              </div>
              <div class="col-md-3">
                <label class="form-label">Desconto (R$)</label>
                <input type="number" step="0.01" min="0" class="form-control" id="pedDesconto" value="0">
              </div>
              <div class="col-md-9">
                <label class="form-label">Observação</label>
                <input type="text" class="form-control" id="pedObservacao">
              </div>
            </div>

            <div class="border rounded p-2 mb-2 bg-light">
              <div class="row g-2 align-items-end">
                <div class="col-md-5 position-relative">
                  <label class="form-label small mb-0">Pesquisar produto</label>
                  <input type="text" class="form-control form-control-sm" id="pedProdutoBusca" placeholder="Código ou descrição" autocomplete="off">
                  <div id="pedProdutoSugestoes" class="list-group position-absolute w-100 shadow" style="z-index:1050;display:none;max-height:220px;overflow:auto;"></div>
                </div>
                <div class="col-md-2">
                  <label class="form-label small mb-0">Qtd</label>
                  <input type="number" class="form-control form-control-sm" id="pedItemQtd" min="0.001" step="0.001" value="1">
                </div>
                <div class="col-md-2">
                  <label class="form-label small mb-0">Valor</label>
                  <input type="number" class="form-control form-control-sm" id="pedItemPreco" min="0" step="0.01">
                </div>
                <div class="col-md-1">
                  <label class="form-label small mb-0">Desc.%</label>
                  <input type="number" class="form-control form-control-sm" id="pedItemDesc" min="0" max="100" step="0.01" value="0">
                </div>
                <div class="col-md-2">
                  <button type="button" class="btn btn-sm btn-success w-100" id="btnPedAddItem" title="Enter na quantidade">
                    <i class="fas fa-plus"></i> Adicionar
                  </button>
                </div>
              </div>
              <input type="hidden" id="pedProdutoId">
              <input type="hidden" id="pedProdutoNome">
              <input type="hidden" id="pedProdutoCodigo">
            </div>

            <div class="table-responsive">
              <table class="table table-sm align-middle" id="pedItensTable">
                <thead>
                  <tr>
                    <th>Código</th><th>Descrição</th><th>Qtd</th><th>Valor</th>
                    <th>Desc.%</th><th class="text-end">Total</th><th></th>
                  </tr>
                </thead>
                <tbody id="pedItensBody"></tbody>
              </table>
            </div>

            <div class="border-top pt-2 mt-2" id="pedTotaisBar">
              <div class="row text-end small g-2">
                <div class="col-md-2"><span class="text-muted">Itens</span><br><strong id="pedTotItens">0</strong></div>
                <div class="col-md-2"><span class="text-muted">Quantidade</span><br><strong id="pedTotQtd">0</strong></div>
                <div class="col-md-2"><span class="text-muted">Subtotal</span><br><strong id="pedTotSub">R$ 0,00</strong></div>
                <div class="col-md-2"><span class="text-muted">Desconto</span><br><strong id="pedTotDesc">R$ 0,00</strong></div>
                <div class="col-md-2"><span class="text-muted">Frete</span><br><strong id="pedTotFrete">R$ 0,00</strong></div>
                <div class="col-md-2"><span class="text-muted">Total</span><br><strong class="fs-5" id="pedTotalLabel">R$ 0,00</strong></div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-dark" id="btnPedImprimir" title="Imprimir pedido" disabled>
              <i class="fas fa-print"></i> Imprimir
            </button>
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
            <button type="button" class="btn btn-primary" id="btnPedSalvar" title="Ctrl+S">
              <i class="fas fa-save"></i> Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  `);

  function alertar(msg, tipo, htmlExtra) {
    $('#pedAlert').html(`<div class="alert alert-${tipo || 'info'} alert-dismissible fade show">
      ${htmlExtra ? msg : escapeHtml(msg)}
      ${htmlExtra || ''}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>`);
  }

  function calcTotaisDetalhe() {
    const subtotal = itensEditor.reduce((s, i) => s + Number(i.subtotal || 0), 0);
    const qtd = itensEditor.reduce((s, i) => s + Number(i.quantidade || 0), 0);
    const desconto = Number($('#pedDesconto').val() || 0);
    const frete = Number($('#pedFrete').val() || 0);
    const total = Number((subtotal - desconto + frete).toFixed(2));
    return {
      itens: itensEditor.length,
      quantidade: Number(qtd.toFixed(3)),
      subtotal: Number(subtotal.toFixed(2)),
      desconto,
      frete,
      total
    };
  }

  function atualizarTotaisBar() {
    const t = calcTotaisDetalhe();
    $('#pedTotItens').text(t.itens);
    $('#pedTotQtd').text(t.quantidade);
    $('#pedTotSub').text(fmtMoney(t.subtotal));
    $('#pedTotDesc').text(fmtMoney(t.desconto));
    $('#pedTotFrete').text(fmtMoney(t.frete));
    $('#pedTotalLabel').text(fmtMoney(t.total));
  }

  function destacarSugestoes($box, idx) {
    const $btns = $box.find('.list-group-item-action');
    $btns.removeClass('active');
    if (idx >= 0 && idx < $btns.length) {
      $btns.eq(idx).addClass('active');
      const el = $btns.get(idx);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
  }

  function fecharSugestoes(tipo) {
    if (!tipo || tipo === 'cliente') {
      $('#pedClienteSugestoes').hide().empty();
      sugClienteIdx = -1;
    }
    if (!tipo || tipo === 'produto') {
      $('#pedProdutoSugestoes').hide().empty();
      sugProdutoIdx = -1;
    }
  }

  function selecionarClientePorIdx(idx) {
    const $btn = $('#pedClienteSugestoes .list-group-item-action').eq(idx);
    if (!$btn.length) return false;
    $btn.trigger('click');
    return true;
  }

  function selecionarProdutoPorIdx(idx) {
    const $btn = $('#pedProdutoSugestoes .list-group-item-action').eq(idx);
    if (!$btn.length) return false;
    $btn.trigger('click');
    return true;
  }

  function aplicarProdutoSelecionado(id, nome, codigo, preco) {
    $('#pedProdutoId').val(id);
    $('#pedProdutoNome').val(nome);
    $('#pedProdutoCodigo').val(codigo);
    $('#pedItemPreco').val(preco);
    $('#pedProdutoBusca').val((codigo || '') + (codigo ? ' — ' : '') + (nome || ''));
    fecharSugestoes('produto');
    $('#pedItemQtd').val($('#pedItemQtd').val() || '1');
    setTimeout(() => {
      $('#pedItemQtd').trigger('focus').select();
    }, 0);
  }

  function aplicarClienteSelecionado(id, nome) {
    clienteSelecionado = { id, nome };
    $('#pedClienteId').val(id);
    $('#pedClienteBusca').val(nome);
    $('#pedClienteSelecionadoLabel').text(nome);
    fecharSugestoes('cliente');
    setTimeout(() => $('#pedProdutoBusca').trigger('focus'), 0);
  }

  function renderItens() {
    if (!itensEditor.length) {
      $('#pedItensBody').html('<tr><td colspan="7" class="text-muted text-center">Nenhum item. Pesquise e adicione produtos.</td></tr>');
      linhaGradeFoco = -1;
    } else {
      $('#pedItensBody').html(itensEditor.map((it, idx) => `
        <tr class="ped-item-row ${linhaGradeFoco === idx ? 'table-active' : ''}" data-idx="${idx}" tabindex="0">
          <td>${escapeHtml(it.produto_codigo || it.produto_id)}</td>
          <td>${escapeHtml(it.produto_nome || ('#' + it.produto_id))}</td>
          <td style="width:90px"><input type="number" class="form-control form-control-sm ped-edit-qtd" data-idx="${idx}" value="${it.quantidade}" min="0.001" step="0.001"></td>
          <td style="width:100px"><input type="number" class="form-control form-control-sm ped-edit-preco" data-idx="${idx}" value="${it.preco_unitario}" min="0" step="0.01"></td>
          <td style="width:80px"><input type="number" class="form-control form-control-sm ped-edit-desc" data-idx="${idx}" value="${it.desconto_percentual || 0}" min="0" max="100" step="0.01"></td>
          <td class="text-end">${fmtMoney(it.subtotal)}</td>
          <td class="text-end">
            <button type="button" class="btn btn-sm btn-outline-danger ped-del-item" data-idx="${idx}" title="Excluir (Del)">
              <i class="fas fa-trash"></i>
            </button>
          </td>
        </tr>`).join(''));
    }
    atualizarTotaisBar();

    $('.ped-del-item').off('click').on('click', function (e) {
      e.stopPropagation();
      itensEditor.splice(Number($(this).data('idx')), 1);
      linhaGradeFoco = -1;
      renderItens();
      $('#pedProdutoBusca').trigger('focus');
    });

    $('.ped-edit-qtd, .ped-edit-preco, .ped-edit-desc').off('change input').on('change input', function () {
      const idx = Number($(this).data('idx'));
      const row = itensEditor[idx];
      if (!row) return;
      const qtd = Number($('.ped-edit-qtd[data-idx="' + idx + '"]').val());
      const preco = Number($('.ped-edit-preco[data-idx="' + idx + '"]').val());
      const desc = Number($('.ped-edit-desc[data-idx="' + idx + '"]').val());
      row.quantidade = qtd;
      row.preco_unitario = preco;
      row.desconto_percentual = desc;
      row.subtotal = Number((qtd * preco * (1 - desc / 100)).toFixed(2));
      atualizarTotaisBar();
      $(this).closest('tr').find('td').eq(5).text(fmtMoney(row.subtotal));
    });

    $('.ped-item-row').off('dblclick').on('dblclick', function () {
      const idx = Number($(this).data('idx'));
      linhaGradeFoco = idx;
      $(this).find('.ped-edit-qtd').trigger('focus').select();
    });

    $('.ped-item-row').off('click').on('click', function () {
      linhaGradeFoco = Number($(this).data('idx'));
      $('.ped-item-row').removeClass('table-active');
      $(this).addClass('table-active');
    });

    $('.ped-item-row').off('keydown').on('keydown', function (e) {
      const idx = Number($(this).data('idx'));
      if (e.key === 'Delete' && !$(e.target).is('input')) {
        e.preventDefault();
        itensEditor.splice(idx, 1);
        linhaGradeFoco = -1;
        renderItens();
        $('#pedProdutoBusca').trigger('focus');
      }
    });
  }

  async function carregarLista() {
    const qs = new URLSearchParams();
    const cliente = $('#pedFiltroCliente').val();
    const representante = $('#pedFiltroRepresentante').val();
    const inicio = $('#pedFiltroInicio').val();
    const fim = $('#pedFiltroFim').val();
    const aba = ABAS.find((a) => a.id === abaAtual) || ABAS[1];
    if (aba.status) qs.set('status', aba.status);
    if (cliente) qs.set('cliente', cliente);
    if (representante) qs.set('representante', representante);
    if (inicio) qs.set('dataInicio', inicio);
    if (fim) qs.set('dataFim', fim);

    $('#pedListaBody').html('<tr><td colspan="8" class="text-center text-muted py-4">Carregando…</td></tr>');
    try {
      const resp = await fetch(`${API_URL}/pedidos?${qs}`, { headers });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.mensagem || data.error || ('HTTP ' + resp.status));
      const itens = data.itens || [];
      if (!itens.length) {
        $('#pedListaBody').html('<tr><td colspan="8" class="text-center text-muted py-4">Nenhum registro encontrado.</td></tr>');
        return;
      }
      $('#pedListaBody').html(itens.map((p) => {
        const editavel = !['FATURADO', 'CANCELADO'].includes(p.status);
        const enviavel = ['PEDIDO', 'ABERTO', 'EM_SEPARACAO'].includes(p.status)
          && (typeof expedicaoHabilitada !== 'function' || expedicaoHabilitada());
        const ehOrcamento = p.status === 'ORCAMENTO';
        return `
        <tr class="ped-linha" data-id="${p.id}" style="cursor:pointer;" title="Clique para visualizar">
          <td><strong>${escapeHtml(p.codigo || ('#' + p.id))}</strong></td>
          <td>${escapeHtml(p.cliente_nome || 'Consumidor')}</td>
          <td>${escapeHtml(p.representante_nome || '—')}</td>
          <td class="text-end">${fmtMoney(p.total)}</td>
          <td>${badgeStatus(p.status)}</td>
          <td>${fmtData(p.data_pedido)}</td>
          <td>${escapeHtml(p.usuario_nome || '—')}</td>
          <td class="text-end text-nowrap ped-acoes">
            ${editavel ? `<button class="btn btn-sm btn-outline-primary ped-editar" data-id="${p.id}" title="Editar"><i class="fas fa-edit"></i></button>` : ''}
            <button class="btn btn-sm btn-outline-dark ped-imprimir" data-id="${p.id}" title="Imprimir"><i class="fas fa-print"></i></button>
            <button class="btn btn-sm btn-outline-secondary ped-duplicar" data-id="${p.id}" title="Duplicar"><i class="fas fa-copy"></i></button>
            ${ehOrcamento ? `<button class="btn btn-sm btn-primary ped-converter" data-id="${p.id}" title="Converter em Pedido"><i class="fas fa-exchange-alt"></i> Pedido</button>` : ''}
            ${enviavel ? `<button class="btn btn-sm btn-success ped-enviar" data-id="${p.id}" title="Enviar para Expedição"><i class="fas fa-share"></i> Enviar</button>` : ''}
            ${ehOrcamento ? `<button class="btn btn-sm btn-outline-danger ped-excluir" data-id="${p.id}" title="Excluir"><i class="fas fa-trash"></i></button>` : ''}
            ${editavel && !ehOrcamento ? `<button class="btn btn-sm btn-outline-danger ped-cancelar" data-id="${p.id}" title="Cancelar"><i class="fas fa-ban"></i></button>` : ''}
          </td>
        </tr>`;
      }).join(''));

      $('#pedListaBody .ped-linha').off('click').on('click', function (e) {
        if ($(e.target).closest('.ped-acoes, button, a, input').length) return;
        const id = Number($(this).data('id'));
        if (id) abrirEditor(id);
      });
      $('.ped-editar').off('click').on('click', function (e) {
        e.stopPropagation();
        abrirEditor(Number($(this).data('id')));
      });
      $('.ped-imprimir').off('click').on('click', function (e) {
        e.stopPropagation();
        imprimirPedido(Number($(this).data('id')));
      });
      $('.ped-duplicar').off('click').on('click', function (e) {
        e.stopPropagation();
        duplicarPedido(Number($(this).data('id')));
      });
      $('.ped-converter').off('click').on('click', function (e) {
        e.stopPropagation();
        converterPedido(Number($(this).data('id')));
      });
      $('.ped-enviar').off('click').on('click', function (e) {
        e.stopPropagation();
        enviarFaturamento(Number($(this).data('id')));
      });
      $('.ped-excluir').off('click').on('click', function (e) {
        e.stopPropagation();
        excluirOrcamento(Number($(this).data('id')));
      });
      $('.ped-cancelar').off('click').on('click', function (e) {
        e.stopPropagation();
        cancelarPedido(Number($(this).data('id')));
      });
    } catch (err) {
      $('#pedListaBody').html(`<tr><td colspan="8" class="text-danger text-center py-4">${escapeHtml(err.message)}</td></tr>`);
    }
  }

  function limparEditor() {
    pedidoEditandoId = null;
    pedidoEditandoStatus = null;
    tipoNovoDocumento = 'pedido';
    itensEditor = [];
    clienteSelecionado = null;
    linhaGradeFoco = -1;
    fecharSugestoes();
    $('#pedEditorTitulo').text('Novo pedido');
    $('#btnPedImprimir').prop('disabled', true);
    $('#pedTipoDocumentoRow').show();
    $('#pedTipoPedido').prop('checked', true);
    $('#pedTipoOrcamento').prop('checked', false);
    $('#pedClienteId').val('');
    $('#pedClienteBusca').val('');
    $('#pedClienteSelecionadoLabel').text('Nenhum cliente selecionado');
    $('#pedRepresentante').val('');
    $('#pedFrete').val('0');
    $('#pedDesconto').val('0');
    $('#pedObservacao').val('');
    $('#pedProdutoBusca').val('');
    $('#pedProdutoId').val('');
    $('#pedProdutoNome').val('');
    $('#pedProdutoCodigo').val('');
    $('#pedItemQtd').val('1');
    $('#pedItemPreco').val('');
    $('#pedItemDesc').val('0');
    renderItens();
  }

  function focarAoAbrirModal() {
    const el = document.getElementById('modalPedidoEditor');
    const handler = () => {
      setTimeout(() => $('#pedClienteBusca').trigger('focus'), 50);
      el.removeEventListener('shown.bs.modal', handler);
    };
    el.addEventListener('shown.bs.modal', handler);
  }

  async function abrirEditor(id) {
    $('#btn-restaurar-modalPedidoEditor').remove();
    limparEditor();
    focarAoAbrirModal();
    if (!id) {
      if (abaAtual === 'orcamentos') {
        tipoNovoDocumento = 'orcamento';
        $('#pedTipoOrcamento').prop('checked', true);
        $('#pedTipoPedido').prop('checked', false);
        $('#pedEditorTitulo').text('Novo orçamento');
      }
      $('#btnPedImprimir').prop('disabled', true);
      new bootstrap.Modal(document.getElementById('modalPedidoEditor')).show();
      return;
    }
    try {
      const resp = await fetch(`${API_URL}/pedidos/${id}`, { headers });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.mensagem || data.error || 'Falha ao carregar');
      const p = data.pedido;
      pedidoEditandoId = p.id;
      pedidoEditandoStatus = p.status;
      $('#btnPedImprimir').prop('disabled', false);
      const rotulo = p.status === 'ORCAMENTO' ? 'Editar orçamento ' : 'Editar pedido ';
      $('#pedEditorTitulo').text(rotulo + (p.codigo || ('#' + p.id)));
      $('#pedTipoDocumentoRow').hide();
      clienteSelecionado = p.cliente_id ? { id: p.cliente_id, nome: p.cliente_nome } : null;
      $('#pedClienteId').val(p.cliente_id || '');
      $('#pedClienteBusca').val(p.cliente_nome || '');
      $('#pedClienteSelecionadoLabel').text(p.cliente_nome || 'Nenhum cliente selecionado');
      $('#pedRepresentante').val(p.representante_nome || '');
      $('#pedFrete').val(p.frete || 0);
      $('#pedDesconto').val(p.desconto || 0);
      $('#pedObservacao').val(p.observacao || '');
      itensEditor = (p.itens || []).map((i) => ({
        produto_id: i.produto_id,
        produto_nome: i.produto_nome,
        produto_codigo: i.produto_codigo,
        quantidade: Number(i.quantidade),
        preco_unitario: Number(i.preco_unitario),
        desconto_percentual: Number(i.desconto_percentual || 0),
        subtotal: Number(i.subtotal),
        tipo_venda: i.tipo_venda || 'PESO'
      }));
      renderItens();
      new bootstrap.Modal(document.getElementById('modalPedidoEditor')).show();
    } catch (err) {
      alertar(err.message, 'danger');
    }
  }

  /** RC3.16.1 — autorização supervisor para transferência NF→F via Motor Comercial. */
  function solicitarAutorizacaoSupervisor(mensagem) {
    return new Promise((resolve) => {
      const existente = document.getElementById('pedSupervisorAuthModal');
      if (existente) existente.remove();

      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="modal fade" id="pedSupervisorAuthModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Autorização de Supervisor</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
              </div>
              <div class="modal-body">
                <p class="mb-3">${escapeHtml(mensagem || 'É necessária autorização do supervisor.')}</p>
                <div class="mb-2">
                  <label for="pedSupervisorUser" class="form-label">Usuário</label>
                  <input type="text" class="form-control" id="pedSupervisorUser" autocomplete="username">
                </div>
                <div class="mb-2">
                  <label for="pedSupervisorPass" class="form-label">Senha</label>
                  <input type="password" class="form-control" id="pedSupervisorPass" autocomplete="current-password">
                </div>
                <div id="pedSupervisorAuthError" class="text-danger small" style="display:none;"></div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" id="pedSupervisorCancel">Cancelar</button>
                <button type="button" class="btn btn-primary" id="pedSupervisorOk">Autorizar</button>
              </div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(wrap.firstElementChild);
      const modalEl = document.getElementById('pedSupervisorAuthModal');
      const modal = new bootstrap.Modal(modalEl);
      let resolvido = false;

      const finalizar = (token) => {
        if (resolvido) return;
        resolvido = true;
        modal.hide();
        setTimeout(() => modalEl.remove(), 300);
        resolve(token);
      };

      modalEl.addEventListener('hidden.bs.modal', () => {
        if (!resolvido) finalizar(null);
      }, { once: true });

      $('#pedSupervisorOk').off('click').on('click', async () => {
        const username = $('#pedSupervisorUser').val().trim();
        const password = $('#pedSupervisorPass').val();
        const errorEl = $('#pedSupervisorAuthError');
        errorEl.hide();
        if (!username || !password) {
          errorEl.text('Informe usuário e senha.').show();
          return;
        }
        try {
          const resp = await fetch(`${API_URL}/auth/supervisor/authorize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ username, password })
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(data.error || data.mensagem || 'Falha na autorização');
          finalizar(data.token || null);
        } catch (err) {
          errorEl.text(err.message || 'Falha na autorização').show();
        }
      });

      modal.show();
    });
  }

  async function fetchPedidoComSupervisor(url, method, payloadBase) {
    let payload = { ...payloadBase };
    let resp = await fetch(url, { method, headers, body: JSON.stringify(payload) });
    let data = await resp.json().catch(() => ({}));
    if (
      resp.status === 409
      && (data.codigo === 'REQUER_AUTORIZACAO_SUPERVISOR' || data.requer_autorizacao)
    ) {
      const token = await solicitarAutorizacaoSupervisor(data.mensagem || data.error);
      if (!token) {
        const err = new Error('Autorização de supervisor cancelada.');
        err.codigo = 'AUTORIZACAO_REJEITADA';
        throw err;
      }
      payload = { ...payloadBase, supervisor_token: token };
      resp = await fetch(url, { method, headers, body: JSON.stringify(payload) });
      data = await resp.json().catch(() => ({}));
    }
    if (!resp.ok) {
      const err = new Error(data.mensagem || data.error || 'Falha na operação');
      err.codigo = data.codigo;
      throw err;
    }
    return data;
  }

  async function salvarPedido() {
    if (!itensEditor.length) {
      alertar('Adicione ao menos um item.', 'warning');
      return;
    }
    const t = calcTotaisDetalhe();
    const tipoSelecionado = $('input[name="pedTipoDocumento"]:checked').val() || tipoNovoDocumento || 'pedido';
    const payload = {
      cliente_id: $('#pedClienteId').val() ? Number($('#pedClienteId').val()) : null,
      representante_nome: $('#pedRepresentante').val() || null,
      observacao: $('#pedObservacao').val() || null,
      frete: t.frete,
      desconto: t.desconto,
      total: t.total,
      itens: itensEditor.map((i) => ({
        produto_id: i.produto_id,
        quantidade: i.quantidade,
        preco_unitario: i.preco_unitario,
        desconto_percentual: i.desconto_percentual || 0,
        subtotal: i.subtotal,
        tipo_venda: i.tipo_venda || 'PESO'
      }))
    };
    if (!pedidoEditandoId) {
      payload.tipo = tipoSelecionado;
      payload.status = tipoSelecionado === 'orcamento' ? 'ORCAMENTO' : 'PEDIDO';
    }
    try {
      const url = pedidoEditandoId ? `${API_URL}/pedidos/${pedidoEditandoId}` : `${API_URL}/pedidos`;
      const method = pedidoEditandoId ? 'PUT' : 'POST';
      const data = await fetchPedidoComSupervisor(url, method, payload);
      bootstrap.Modal.getInstance(document.getElementById('modalPedidoEditor'))?.hide();
      const rotulo = data.pedido?.status === 'ORCAMENTO' ? 'Orçamento' : 'Pedido';
      alertar(`${rotulo} ${data.pedido?.codigo || ''} salvo.`, 'success');
      pedidoEditandoId = data.pedido?.id || pedidoEditandoId;
      pedidoEditandoStatus = data.pedido?.status || pedidoEditandoStatus;
      $('#btnPedImprimir').prop('disabled', !pedidoEditandoId);
      if (data.pedido?.status === 'ORCAMENTO') abaAtual = 'orcamentos';
      else if (['PEDIDO', 'ABERTO', 'EM_SEPARACAO'].includes(data.pedido?.status)) abaAtual = 'pedidos';
      sincronizarAbas();
      await carregarLista();
    } catch (err) {
      alertar(err.message, 'danger');
    }
  }

  async function cancelarPedido(id) {
    if (!confirm('Cancelar este pedido?')) return;
    try {
      const resp = await fetch(`${API_URL}/pedidos/${id}/cancelar`, { method: 'POST', headers, body: '{}' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.mensagem || data.error || 'Falha ao cancelar');
      alertar('Pedido cancelado.', 'success');
      await carregarLista();
    } catch (err) {
      alertar(err.message, 'danger');
    }
  }

  async function duplicarPedido(id) {
    try {
      const resp = await fetch(`${API_URL}/pedidos/${id}/duplicar`, { method: 'POST', headers, body: '{}' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.mensagem || data.error || 'Falha ao duplicar');
      const rotulo = data.pedido?.status === 'ORCAMENTO' ? 'Orçamento' : 'Pedido';
      alertar(`${rotulo} duplicado: ${data.pedido?.codigo || ''}`, 'success');
      await carregarLista();
    } catch (err) {
      alertar(err.message, 'danger');
    }
  }

  async function converterPedido(id) {
    if (!confirm('Converter este orçamento em Pedido? O número e os dados serão mantidos.')) return;
    try {
      const data = await fetchPedidoComSupervisor(`${API_URL}/pedidos/${id}/converter`, 'POST', {});
      alertar(`Convertido em Pedido: ${data.pedido?.codigo || ''}`, 'success');
      abaAtual = 'pedidos';
      sincronizarAbas();
      await carregarLista();
    } catch (err) {
      alertar(err.message, 'danger');
    }
  }

  async function excluirOrcamento(id) {
    if (!confirm('Excluir este orçamento permanentemente?')) return;
    try {
      const resp = await fetch(`${API_URL}/pedidos/${id}`, { method: 'DELETE', headers });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.mensagem || data.error || 'Falha ao excluir');
      alertar('Orçamento excluído.', 'success');
      await carregarLista();
    } catch (err) {
      alertar(err.message, 'danger');
    }
  }

  async function imprimirPedido(id) {
    const pedidoId = Number(id || pedidoEditandoId);
    if (!pedidoId) {
      alertar('Salve o pedido antes de imprimir.', 'warning');
      return;
    }
    const out = await imprimirPedidoPorId(pedidoId);
    if (!out.ok) alertar(out.error || 'Erro ao abrir visualização.', 'danger');
  }

  async function enviarFaturamento(id) {
    if (typeof expedicaoHabilitada === 'function' && !expedicaoHabilitada()) {
      alertar('Módulo Expedição não contratado.', 'warning');
      return;
    }
    if (!confirm('Enviar este pedido para a fila de Expedição?')) return;
    try {
      const data = await fetchPedidoComSupervisor(
        `${API_URL}/pedidos/${id}/enviar-faturamento`,
        'POST',
        {}
      );
      const codigo = data.pedido?.codigo || '';
      alertar(
        `<strong>Pedido enviado com sucesso.</strong> ${escapeHtml(codigo)} está na fila de Expedição.`,
        'success',
        ` <button type="button" class="btn btn-sm btn-outline-primary ms-2" id="btnIrFaturamento">Ir para Expedição</button>`
      );
      $('#btnIrFaturamento').off('click').on('click', () => {
        if (typeof loadPage === 'function') loadPage('faturamento');
      });
      await carregarLista();
    } catch (err) {
      alertar(err.message, 'danger');
    }
  }

  function buscarClientes(termo) {
    clearTimeout(timerCliente);
    if (!termo || termo.length < 2) {
      fecharSugestoes('cliente');
      return;
    }
    timerCliente = setTimeout(async () => {
      try {
        const resp = await fetch(`${API_URL}/clientes/buscar?termo=${encodeURIComponent(termo)}`, { headers });
        const rows = await resp.json().catch(() => []);
        if (!Array.isArray(rows) || !rows.length) {
          $('#pedClienteSugestoes').html('<div class="list-group-item text-muted">Nenhum cliente</div>').show();
          sugClienteIdx = -1;
          return;
        }
        $('#pedClienteSugestoes').html(rows.slice(0, 15).map((c, i) => `
          <button type="button" class="list-group-item list-group-item-action ped-pick-cliente ${i === 0 ? 'active' : ''}"
            data-id="${c.id}" data-nome="${escapeHtml(c.nome)}">
            <strong>${escapeHtml(c.nome)}</strong>
            <small class="ped-sugestao-meta d-block">${escapeHtml(c.cpf_cnpj || '')} ${escapeHtml(c.telefone || '')}</small>
          </button>`).join('')).show();
        sugClienteIdx = 0;
        $('.ped-pick-cliente').off('click').on('click', function () {
          aplicarClienteSelecionado(Number($(this).data('id')), $(this).data('nome'));
        });
      } catch (_) {
        fecharSugestoes('cliente');
      }
    }, 250);
  }

  function buscarProdutos(termo) {
    clearTimeout(timerProduto);
    if (!termo || termo.length < 1) {
      fecharSugestoes('produto');
      return;
    }
    timerProduto = setTimeout(async () => {
      try {
        const resp = await fetch(`${API_URL}/produtos/consulta-pdv/buscar?q=${encodeURIComponent(termo)}&limite=15`, { headers });
        const rows = await resp.json().catch(() => []);
        if (!Array.isArray(rows) || !rows.length) {
          $('#pedProdutoSugestoes').html('<div class="list-group-item text-muted">Nenhum produto</div>').show();
          sugProdutoIdx = -1;
          return;
        }
        $('#pedProdutoSugestoes').html(rows.map((p, i) => {
          const preco = Number(p.preco_promocional != null ? p.preco_promocional : p.preco_venda || 0);
          return `
          <button type="button" class="list-group-item list-group-item-action ped-pick-produto ${i === 0 ? 'active' : ''}"
            data-id="${p.id}" data-nome="${escapeHtml(p.nome)}" data-codigo="${escapeHtml(p.codigo || '')}"
            data-preco="${preco}">
            <strong>${escapeHtml(p.codigo || p.id)}</strong> — ${escapeHtml(p.nome)}
            <span class="float-end">${fmtMoney(preco)}</span>
          </button>`;
        }).join('')).show();
        sugProdutoIdx = 0;
        $('.ped-pick-produto').off('click').on('click', function () {
          aplicarProdutoSelecionado(
            $(this).data('id'),
            $(this).data('nome'),
            $(this).data('codigo'),
            $(this).data('preco')
          );
        });
      } catch (_) {
        fecharSugestoes('produto');
      }
    }, 250);
  }

  function adicionarItem() {
    const produtoId = Number($('#pedProdutoId').val());
    const qtd = Number($('#pedItemQtd').val());
    const preco = Number($('#pedItemPreco').val());
    const desc = Number($('#pedItemDesc').val() || 0);
    if (!(produtoId > 0) || !(qtd > 0) || !(preco >= 0)) {
      alertar('Selecione um produto e informe quantidade/preço.', 'warning');
      $('#pedProdutoBusca').trigger('focus');
      return;
    }
    const subtotal = Number((qtd * preco * (1 - desc / 100)).toFixed(2));
    const existente = itensEditor.findIndex((i) => i.produto_id === produtoId);
    const row = {
      produto_id: produtoId,
      produto_nome: $('#pedProdutoNome').val(),
      produto_codigo: $('#pedProdutoCodigo').val(),
      quantidade: qtd,
      preco_unitario: preco,
      desconto_percentual: desc,
      subtotal,
      tipo_venda: 'PESO'
    };
    if (existente >= 0) {
      itensEditor[existente] = row;
    } else {
      itensEditor.push(row);
    }
    $('#pedProdutoId, #pedProdutoNome, #pedProdutoCodigo, #pedProdutoBusca').val('');
    $('#pedItemQtd').val('1');
    $('#pedItemPreco').val('');
    $('#pedItemDesc').val('0');
    renderItens();
    setTimeout(() => $('#pedProdutoBusca').trigger('focus'), 0);
  }

  function modalAberto() {
    return $('#modalPedidoEditor').hasClass('show');
  }

  // —— Teclado / atalhos ——
  $('#pedClienteBusca').on('keydown', function (e) {
    const $box = $('#pedClienteSugestoes');
    const visivel = $box.is(':visible') && $box.find('.list-group-item-action').length;
    if (e.key === 'Escape') {
      e.preventDefault();
      fecharSugestoes('cliente');
      return;
    }
    if (e.key === 'ArrowDown' && visivel) {
      e.preventDefault();
      const max = $box.find('.list-group-item-action').length - 1;
      sugClienteIdx = Math.min(max, sugClienteIdx + 1);
      destacarSugestoes($box, sugClienteIdx);
      return;
    }
    if (e.key === 'ArrowUp' && visivel) {
      e.preventDefault();
      sugClienteIdx = Math.max(0, sugClienteIdx - 1);
      destacarSugestoes($box, sugClienteIdx);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (visivel && sugClienteIdx >= 0) {
        selecionarClientePorIdx(sugClienteIdx);
      } else if ($('#pedClienteId').val()) {
        $('#pedProdutoBusca').trigger('focus');
      }
    }
  });

  $('#pedProdutoBusca').on('keydown', function (e) {
    const $box = $('#pedProdutoSugestoes');
    const visivel = $box.is(':visible') && $box.find('.list-group-item-action').length;
    if (e.key === 'Escape') {
      e.preventDefault();
      fecharSugestoes('produto');
      return;
    }
    if (e.key === 'ArrowDown' && visivel) {
      e.preventDefault();
      const max = $box.find('.list-group-item-action').length - 1;
      sugProdutoIdx = Math.min(max, sugProdutoIdx + 1);
      destacarSugestoes($box, sugProdutoIdx);
      return;
    }
    if (e.key === 'ArrowUp' && visivel) {
      e.preventDefault();
      sugProdutoIdx = Math.max(0, sugProdutoIdx - 1);
      destacarSugestoes($box, sugProdutoIdx);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (visivel && sugProdutoIdx >= 0) {
        selecionarProdutoPorIdx(sugProdutoIdx);
      } else if ($('#pedProdutoId').val()) {
        $('#pedItemQtd').trigger('focus').select();
      }
    }
  });

  $('#pedItemQtd, #pedItemPreco, #pedItemDesc').on('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      adicionarItem();
    }
    if (e.key === 'Escape') {
      fecharSugestoes();
      $('#pedProdutoBusca').trigger('focus');
    }
  });

  $(document).off('keydown.pedidosUx').on('keydown.pedidosUx', function (e) {
    if (!$('#pedidosRoot').length) return;

    // F2 — Novo Pedido (sempre na tela)
    if (e.key === 'F2') {
      e.preventDefault();
      abrirEditor(null);
      return;
    }

    // Ctrl+F — cliente (modal aberto) ou filtro
    if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      if (modalAberto()) {
        $('#pedClienteBusca').trigger('focus').select();
      } else {
        $('#pedFiltroCliente').trigger('focus').select();
      }
      return;
    }

    // Ctrl+S — salvar
    if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
      if (modalAberto()) {
        e.preventDefault();
        salvarPedido();
      }
      return;
    }

    // Del na grade (quando foco não é input)
    if (modalAberto() && e.key === 'Delete' && linhaGradeFoco >= 0 && !$(e.target).is('input, textarea, select')) {
      e.preventDefault();
      itensEditor.splice(linhaGradeFoco, 1);
      linhaGradeFoco = -1;
      renderItens();
      $('#pedProdutoBusca').trigger('focus');
    }
  });

  function sincronizarAbas() {
    $('#pedAbas .nav-link').removeClass('active');
    $(`#pedAbas .nav-link[data-aba="${abaAtual}"]`).addClass('active');
  }

  $('#pedAbas').on('click', '.nav-link', function () {
    const aba = String($(this).data('aba') || '');
    if (!aba || aba === abaAtual) return;
    abaAtual = aba;
    sincronizarAbas();
    carregarLista();
  });

  $('input[name="pedTipoDocumento"]').on('change', function () {
    tipoNovoDocumento = String($(this).val() || 'pedido');
    if (!pedidoEditandoId) {
      $('#pedEditorTitulo').text(tipoNovoDocumento === 'orcamento' ? 'Novo orçamento' : 'Novo pedido');
    }
  });

  $('#btnPedNovo').on('click', () => abrirEditor(null));
  $('#btnPedPesquisar').on('click', carregarLista);
  $('#btnPedSalvar').on('click', salvarPedido);
  $('#btnPedImprimir').on('click', () => imprimirPedido(pedidoEditandoId));
  $('#btnPedAddItem').on('click', adicionarItem);
  $('#pedFrete, #pedDesconto').on('change input', atualizarTotaisBar);
  $('#pedClienteBusca').on('input', function () {
    $('#pedClienteId').val('');
    clienteSelecionado = null;
    $('#pedClienteSelecionadoLabel').text('Nenhum cliente selecionado');
    buscarClientes($(this).val());
  });
  $('#pedProdutoBusca').on('input', function () {
    $('#pedProdutoId').val('');
    buscarProdutos($(this).val());
  });
  $(document).off('click.pedSug').on('click.pedSug', (e) => {
    if (!$(e.target).closest('#pedClienteBusca, #pedClienteSugestoes').length) {
      fecharSugestoes('cliente');
    }
    if (!$(e.target).closest('#pedProdutoBusca, #pedProdutoSugestoes').length) {
      fecharSugestoes('produto');
    }
  });

  carregarLista();
}

window.loadPedidos = loadPedidos;
