/**
 * RC3.16 — Nova NF-e Avulsa (porta fiscal).
 * Cria Venda origem=NF_AVULSA via núcleo + emitirNfePorVendaId (mesmo motor).
 */

(function () {
  'use strict';

  let itensAvulsa = [];
  let timerCliente = null;
  let timerProduto = null;
  let emitindo = false;

  function headersJson() {
    const h = { 'Content-Type': 'application/json' };
    try {
      const t = localStorage.getItem('token') || sessionStorage.getItem('token');
      if (t) h.Authorization = `Bearer ${t}`;
    } catch (_) { /* ignore */ }
    return h;
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtMoney(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function modoFiscalAtivo() {
    if (typeof modoFiscalAtivoSistema === 'function') return !!modoFiscalAtivoSistema();
    return localStorage.getItem('pdv_modo_fiscal_ativo') === '1';
  }

  function alertar(msg, tipo) {
    if (typeof showNotification === 'function') showNotification(msg, tipo || 'info');
    else window.alert(String(msg).replace(/<[^>]+>/g, ''));
  }

  function calcularTotais() {
    const sub = itensAvulsa.reduce((s, i) => s + Number(i.subtotal || 0), 0);
    const frete = Number($('#nfaFrete').val() || 0);
    const desconto = Number($('#nfaDesconto').val() || 0);
    const total = Math.max(0, Number((sub + frete - desconto).toFixed(2)));
    $('#nfaTotSub').text(fmtMoney(sub));
    $('#nfaTotFrete').text(fmtMoney(frete));
    $('#nfaTotDesc').text(fmtMoney(desconto));
    $('#nfaTotGeral').text(fmtMoney(total));
    return { sub, frete, desconto, total };
  }

  function renderItens() {
    if (!itensAvulsa.length) {
      $('#nfaItensBody').html('<tr><td colspan="7" class="text-muted text-center">Nenhum produto</td></tr>');
      calcularTotais();
      return;
    }
    $('#nfaItensBody').html(itensAvulsa.map((it, idx) => `
      <tr>
        <td>${escapeHtml(it.produto_codigo || it.produto_id)}</td>
        <td>${escapeHtml(it.produto_nome || '')}</td>
        <td class="text-end">${Number(it.quantidade)}</td>
        <td class="text-end">${fmtMoney(it.preco_unitario)}</td>
        <td class="text-end">${Number(it.desconto_percentual || 0)}%</td>
        <td class="text-end">${fmtMoney(it.subtotal)}</td>
        <td class="text-end">
          <button type="button" class="btn btn-sm btn-outline-danger nfa-rm-item" data-idx="${idx}">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>`).join(''));
    $('.nfa-rm-item').off('click').on('click', function () {
      itensAvulsa.splice(Number($(this).data('idx')), 1);
      renderItens();
    });
    calcularTotais();
  }

  function aplicarCliente(id, nome) {
    $('#nfaClienteId').val(id || '');
    $('#nfaClienteBusca').val(nome || '');
    $('#nfaClienteLabel').text(id ? `Cliente #${id} — ${nome}` : 'Nenhum cliente selecionado');
    $('#nfaClienteSugestoes').hide().empty();
  }

  function buscarClientes(termo) {
    clearTimeout(timerCliente);
    if (!termo || termo.length < 2) {
      $('#nfaClienteSugestoes').hide().empty();
      return;
    }
    timerCliente = setTimeout(async () => {
      try {
        const resp = await fetch(`${API_URL}/clientes/buscar?termo=${encodeURIComponent(termo)}`, { headers: headersJson() });
        const rows = await resp.json().catch(() => []);
        if (!Array.isArray(rows) || !rows.length) {
          $('#nfaClienteSugestoes').html('<div class="list-group-item text-muted">Nenhum cliente</div>').show();
          return;
        }
        $('#nfaClienteSugestoes').html(rows.slice(0, 15).map((c) => `
          <button type="button" class="list-group-item list-group-item-action nfa-pick-cliente"
            data-id="${c.id}" data-nome="${escapeHtml(c.nome)}">
            <strong>${escapeHtml(c.nome)}</strong>
            <small class="d-block text-muted">${escapeHtml(c.cpf_cnpj || '')}</small>
          </button>`).join('')).show();
        $('.nfa-pick-cliente').off('click').on('click', function () {
          aplicarCliente(Number($(this).data('id')), $(this).data('nome'));
        });
      } catch (_) {
        $('#nfaClienteSugestoes').hide();
      }
    }, 250);
  }

  function buscarProdutos(termo) {
    clearTimeout(timerProduto);
    if (!termo || !String(termo).length) {
      $('#nfaProdutoSugestoes').hide().empty();
      return;
    }
    timerProduto = setTimeout(async () => {
      try {
        const resp = await fetch(
          `${API_URL}/produtos/consulta-pdv/buscar?q=${encodeURIComponent(termo)}&limite=15`,
          { headers: headersJson() }
        );
        const rows = await resp.json().catch(() => []);
        if (!Array.isArray(rows) || !rows.length) {
          $('#nfaProdutoSugestoes').html('<div class="list-group-item text-muted">Nenhum produto</div>').show();
          return;
        }
        $('#nfaProdutoSugestoes').html(rows.map((p) => {
          const preco = Number(p.preco_promocional != null ? p.preco_promocional : p.preco_venda || 0);
          return `
            <button type="button" class="list-group-item list-group-item-action nfa-pick-produto"
              data-id="${p.id}" data-nome="${escapeHtml(p.nome)}" data-codigo="${escapeHtml(p.codigo || '')}"
              data-preco="${preco}">
              <strong>${escapeHtml(p.codigo || p.id)}</strong> — ${escapeHtml(p.nome)}
              <span class="float-end">${fmtMoney(preco)}</span>
            </button>`;
        }).join('')).show();
        $('.nfa-pick-produto').off('click').on('click', function () {
          $('#nfaProdutoId').val($(this).data('id'));
          $('#nfaProdutoNome').val($(this).data('nome'));
          $('#nfaProdutoCodigo').val($(this).data('codigo'));
          $('#nfaProdutoBusca').val(`${$(this).data('codigo') || ''} — ${$(this).data('nome')}`);
          $('#nfaItemPreco').val($(this).data('preco'));
          $('#nfaProdutoSugestoes').hide().empty();
          $('#nfaItemQtd').trigger('focus');
        });
      } catch (_) {
        $('#nfaProdutoSugestoes').hide();
      }
    }, 250);
  }

  function adicionarItem() {
    const produtoId = Number($('#nfaProdutoId').val());
    const qtd = Number($('#nfaItemQtd').val());
    const preco = Number($('#nfaItemPreco').val());
    const desc = Number($('#nfaItemDesc').val() || 0);
    if (!(produtoId > 0) || !(qtd > 0) || !(preco >= 0)) {
      alertar('Selecione um produto e informe quantidade/preço.', 'warning');
      return;
    }
    const subtotal = Number((qtd * preco * (1 - desc / 100)).toFixed(2));
    const row = {
      produto_id: produtoId,
      produto_nome: $('#nfaProdutoNome').val(),
      produto_codigo: $('#nfaProdutoCodigo').val(),
      quantidade: qtd,
      preco_unitario: preco,
      desconto_percentual: desc,
      subtotal,
      tipo_venda: 'PESO'
    };
    const ix = itensAvulsa.findIndex((i) => i.produto_id === produtoId);
    if (ix >= 0) itensAvulsa[ix] = row;
    else itensAvulsa.push(row);
    $('#nfaProdutoId, #nfaProdutoNome, #nfaProdutoCodigo, #nfaProdutoBusca, #nfaItemPreco').val('');
    $('#nfaItemQtd').val('1');
    $('#nfaItemDesc').val('0');
    renderItens();
    $('#nfaProdutoBusca').trigger('focus');
  }

  function atualizarBannerF12() {
    const on = modoFiscalAtivo();
    const el = $('#nfaBannerF12');
    if (on) {
      el.removeClass('alert-warning').addClass('alert-success')
        .html('<i class="fas fa-check-circle"></i> Modo operacional fiscal ativo (F12). A emissão seguirá para a SEFAZ.');
      $('#btnNfaEmitir').prop('disabled', false);
    } else {
      el.removeClass('alert-success').addClass('alert-warning')
        .html('<i class="fas fa-exclamation-triangle"></i> O modo operacional atual não permite emissão de documentos fiscais.');
      $('#btnNfaEmitir').prop('disabled', true);
    }
  }

  function irCentralAposAutorizacao(nfe) {
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

  async function emitir() {
    if (emitindo) return;
    if (!modoFiscalAtivo()) {
      alertar('O modo operacional atual não permite emissão de documentos fiscais.', 'warning');
      return;
    }
    if (!itensAvulsa.length) {
      alertar('Adicione ao menos um produto.', 'warning');
      return;
    }
    const totais = calcularTotais();
    if (!(totais.total > 0)) {
      alertar('Total da NF-e deve ser maior que zero.', 'warning');
      return;
    }

    const pag = (typeof CdsFormasPagamento !== 'undefined')
      ? CdsFormasPagamento.montarPayloadPagamento('nfa', totais.total)
      : {
        forma_pagamento: $('#nfaForma').val() || 'dinheiro',
        pagamentos: [{ forma_pagamento: $('#nfaForma').val() || 'dinheiro', valor: totais.total }],
        valor_recebido: totais.total,
        parcelas: 1
      };

    if (typeof CdsFormasPagamento !== 'undefined'
      && CdsFormasPagamento.ehParcelavel(pag.forma_pagamento)
      && !$('#nfaClienteId').val()) {
      alertar('Selecione um cliente para Boleto, Crediário ou Parcelado.', 'warning');
      return;
    }

    const payload = {
      cliente_id: $('#nfaClienteId').val() ? Number($('#nfaClienteId').val()) : null,
      itens: itensAvulsa.map((i) => ({
        produto_id: i.produto_id,
        quantidade: i.quantidade,
        preco_unitario: i.preco_unitario,
        desconto_percentual: i.desconto_percentual,
        subtotal: i.subtotal,
        tipo_venda: i.tipo_venda
      })),
      desconto: totais.desconto,
      frete: totais.frete,
      ...pag,
      natureza_operacao: $('#nfaNatureza').val() || 'VENDA DE MERCADORIA',
      cfop: $('#nfaCfop').val() || '5102',
      transportadora: $('#nfaTransportadora').val() || null,
      observacoes: $('#nfaObservacoes').val() || null,
      mod_frete: $('#nfaModFrete').val()
    };

    emitindo = true;
    $('#btnNfaEmitir').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Emitindo…');
    try {
      const resp = await fetch(`${API_URL}/nfe/avulsa`, {
        method: 'POST',
        headers: headersJson(),
        body: JSON.stringify(payload)
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.mensagem || data.error || 'Falha ao emitir NF-e avulsa.');
      }
      const nfe = data.nfe || {};
      const ok = Boolean(nfe.success || String(nfe.status || '').toLowerCase() === 'autorizada');
      if (ok) {
        alertar(data.message || 'NF-e autorizada.', 'success');
        irCentralAposAutorizacao(nfe);
      } else {
        alertar(data.message || nfe.message || 'Venda gerada; NF-e pendente/rejeitada.', 'warning');
        if (nfe.notaId || nfe.nota_id) irCentralAposAutorizacao(nfe);
      }
    } catch (err) {
      alertar(err.message || 'Erro ao emitir.', 'danger');
    } finally {
      emitindo = false;
      atualizarBannerF12();
      $('#btnNfaEmitir').html('<i class="fas fa-file-invoice"></i> Emitir NF-e');
    }
  }

  function loadNfeAvulsa() {
    itensAvulsa = [];
    const html = `
      ${(typeof CdsPageShell !== 'undefined' && CdsPageShell.renderHeader)
        ? CdsPageShell.renderHeader({ page: 'nfe-avulsa', toolbarHtml: '' })
        : ''}
      <div class="alert mb-3" id="nfaBannerF12"></div>
      <div class="card shadow-sm">
        <div class="card-header d-flex justify-content-between align-items-center">
          <div>
            <i class="fas fa-file-invoice"></i> Nova NF-e
            <span class="badge bg-secondary ms-2">Origem NF_AVULSA</span>
          </div>
          <button type="button" class="btn btn-sm btn-outline-secondary" onclick="loadPage('nfe-central')">
            Central NF-e
          </button>
        </div>
        <div class="card-body">
          <div class="row g-2 mb-3">
            <div class="col-md-6 position-relative">
              <label class="form-label">Cliente</label>
              <input type="text" class="form-control" id="nfaClienteBusca" placeholder="Nome, CPF ou telefone" autocomplete="off">
              <input type="hidden" id="nfaClienteId">
              <div id="nfaClienteSugestoes" class="list-group position-absolute w-100 shadow"
                style="z-index:1050;display:none;max-height:220px;overflow:auto;"></div>
              <div class="form-text" id="nfaClienteLabel">Nenhum cliente selecionado</div>
            </div>
            <div class="col-md-3">
              <label class="form-label">Natureza da Operação</label>
              <input type="text" class="form-control" id="nfaNatureza" value="VENDA DE MERCADORIA">
            </div>
            <div class="col-md-3">
              <label class="form-label">CFOP</label>
              <input type="text" class="form-control" id="nfaCfop" value="5102">
            </div>
          </div>

          <div class="border rounded p-2 mb-2 bg-light">
            <div class="row g-2 align-items-end">
              <div class="col-md-5 position-relative">
                <label class="form-label small mb-0">Produto</label>
                <input type="text" class="form-control form-control-sm" id="nfaProdutoBusca" placeholder="Código ou descrição" autocomplete="off">
                <div id="nfaProdutoSugestoes" class="list-group position-absolute w-100 shadow"
                  style="z-index:1050;display:none;max-height:220px;overflow:auto;"></div>
              </div>
              <div class="col-md-2">
                <label class="form-label small mb-0">Qtd</label>
                <input type="number" class="form-control form-control-sm" id="nfaItemQtd" min="0.001" step="0.001" value="1">
              </div>
              <div class="col-md-2">
                <label class="form-label small mb-0">Preço</label>
                <input type="number" class="form-control form-control-sm" id="nfaItemPreco" min="0" step="0.01">
              </div>
              <div class="col-md-1">
                <label class="form-label small mb-0">Desc.%</label>
                <input type="number" class="form-control form-control-sm" id="nfaItemDesc" min="0" max="100" step="0.01" value="0">
              </div>
              <div class="col-md-2">
                <button type="button" class="btn btn-sm btn-success w-100" id="btnNfaAddItem">
                  <i class="fas fa-plus"></i> Adicionar
                </button>
              </div>
            </div>
            <input type="hidden" id="nfaProdutoId">
            <input type="hidden" id="nfaProdutoNome">
            <input type="hidden" id="nfaProdutoCodigo">
          </div>

          <div class="table-responsive mb-3">
            <table class="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Código</th><th>Produto</th><th class="text-end">Qtd</th>
                  <th class="text-end">Preço</th><th class="text-end">Desc.%</th>
                  <th class="text-end">Total</th><th></th>
                </tr>
              </thead>
              <tbody id="nfaItensBody"></tbody>
            </table>
          </div>

          <div class="row g-2 mb-3">
            <div class="col-md-3">
              <label class="form-label">Transportadora</label>
              <input type="text" class="form-control" id="nfaTransportadora" placeholder="Opcional">
            </div>
            <div class="col-md-2">
              <label class="form-label">Frete (R$)</label>
              <input type="number" step="0.01" min="0" class="form-control" id="nfaFrete" value="0">
            </div>
            <div class="col-md-2">
              <label class="form-label">Mod. frete</label>
              <select class="form-select" id="nfaModFrete">
                <option value="9">Sem frete</option>
                <option value="0">Emitente</option>
                <option value="1">Destinatário</option>
              </select>
            </div>
            <div class="col-md-2">
              <label class="form-label">Desconto (R$)</label>
              <input type="number" step="0.01" min="0" class="form-control" id="nfaDesconto" value="0">
            </div>
            <div class="col-md-3">
              <label class="form-label">Observações</label>
              <input type="text" class="form-control" id="nfaObservacoes">
            </div>
          </div>

          <div class="row g-2 mb-3 align-items-end">
            <div class="col-md-5" id="nfaFormaWrap">
              <label class="form-label">Forma de pagamento</label>
              <select class="form-select" id="nfaForma"></select>
            </div>
            <div class="col-md-7">
              <div class="d-flex justify-content-end gap-4 small pt-3">
                <div>Subtotal <strong id="nfaTotSub">R$ 0,00</strong></div>
                <div>Frete <strong id="nfaTotFrete">R$ 0,00</strong></div>
                <div>Desconto <strong id="nfaTotDesc">R$ 0,00</strong></div>
                <div>Total <strong class="text-primary fs-5" id="nfaTotGeral">R$ 0,00</strong></div>
              </div>
            </div>
            <div class="col-12" id="nfaPagamentoExtras"></div>
          </div>

          <div class="d-flex justify-content-end gap-2">
            <button type="button" class="btn btn-outline-secondary" onclick="loadPage('nfe-central')">Cancelar</button>
            <button type="button" class="btn btn-primary" id="btnNfaEmitir">
              <i class="fas fa-file-invoice"></i> Emitir NF-e
            </button>
          </div>
        </div>
      </div>`;
    $('#page-content').html(html);
    renderItens();
    atualizarBannerF12();

    if (typeof CdsFormasPagamento !== 'undefined') {
      $('#nfaForma').html(CdsFormasPagamento.optionsHtml('dinheiro'));
      $('#nfaPagamentoExtras').html(CdsFormasPagamento.htmlPaineisExtras('nfa'));
      CdsFormasPagamento.bind('nfa', () => calcularTotais().total);
    }

    $('#nfaClienteBusca').on('input', function () { buscarClientes($(this).val()); });
    $('#nfaProdutoBusca').on('input', function () { buscarProdutos($(this).val()); });
    $('#btnNfaAddItem').on('click', adicionarItem);
    $('#nfaItemQtd, #nfaItemPreco').on('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); adicionarItem(); }
    });
    $('#nfaFrete, #nfaDesconto').on('input', () => {
      const t = calcularTotais();
      if (typeof CdsFormasPagamento !== 'undefined') {
        CdsFormasPagamento.atualizarResumo(null, 'nfa', t.total);
      }
    });
    $('#btnNfaEmitir').on('click', emitir);
    $(document).off('cds:modo-fiscal-alterado.nfa').on('cds:modo-fiscal-alterado.nfa', atualizarBannerF12);
  }

  window.loadNfeAvulsa = loadNfeAvulsa;
})();
