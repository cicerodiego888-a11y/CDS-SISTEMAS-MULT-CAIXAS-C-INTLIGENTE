/**
 * Drawer Prestação de Contas — Sprint 3
 * Abre pelo widget do rodapé sem trocar de tela do PDV.
 * Reutiliza as mesmas formas de pagamento do PDV (payload compatível com Orquestrador).
 */
(function (global) {
  'use strict';

  const DRAWER_ID = 'pdvPrestacaoDrawer';
  const BACKDROP_ID = 'pdvPrestacaoBackdrop';
  let aberto = false;
  let view = 'entregadores'; // entregadores | pedidos | detalhe
  let gruposCache = [];
  let grupoAtual = null;
  let pedidoAtual = null;
  let pagamentosLinhas = [];
  let pollTimer = null;

  function moduloAtivo() {
    try {
      return typeof obterRecursosImplantacao === 'function'
        && obterRecursosImplantacao().vendasEntrega === true;
    } catch (_) {
      return false;
    }
  }

  function fiscalPadraoSistema() {
    try {
      if (typeof modoFiscalAtivoSistema === 'function') return !!modoFiscalAtivoSistema();
      if (typeof obterRecursosImplantacao === 'function') {
        return obterRecursosImplantacao().fiscal === true;
      }
    } catch (_) { /* ignore */ }
    return false;
  }

  function fmtMoney(n) {
    return `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;
  }

  function escapeHtml(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureMounted() {
    if (document.getElementById(DRAWER_ID)) return;

    const backdrop = document.createElement('div');
    backdrop.id = BACKDROP_ID;
    backdrop.className = 'pdv-prestacao-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const drawer = document.createElement('aside');
    drawer.id = DRAWER_ID;
    drawer.className = 'pdv-prestacao-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', 'Prestação de Contas');
    drawer.innerHTML = `
      <div class="pdv-prestacao-drawer__header">
        <div>
          <h2><i class="fas fa-motorcycle me-2"></i>Prestação de Contas</h2>
          <small>Finalize entregas sem sair do PDV</small>
        </div>
        <button type="button" class="pdv-prestacao-drawer__close" data-action="close" aria-label="Fechar">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="pdv-prestacao-drawer__nav" id="prestacaoBreadcrumb"></div>
      <div class="pdv-prestacao-drawer__body" id="prestacaoBody">
        <div class="text-muted p-3">Carregando…</div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);

    backdrop.addEventListener('click', fechar);
    drawer.querySelector('[data-action="close"]').addEventListener('click', fechar);
  }

  /** Recoloca o drawer no final do body para não ficar atrás de modal/backdrop do PDV. */
  function trazerParaFrente() {
    const bd = document.getElementById(BACKDROP_ID);
    const dr = document.getElementById(DRAWER_ID);
    if (bd) document.body.appendChild(bd);
    if (dr) document.body.appendChild(dr);
    document.body.classList.add('pdv-prestacao-aberta');
  }

  function removerConferenciaOverlay() {
    document.getElementById('pdvPrestacaoConferencia')?.remove();
  }

  function abrir() {
    if (!moduloAtivo()) {
      if (typeof showNotification === 'function') {
        showNotification('Módulo Vendas para Entrega desabilitado.', 'warning');
      }
      return;
    }
    ensureMounted();
    trazerParaFrente();
    aberto = true;
    view = 'entregadores';
    grupoAtual = null;
    pedidoAtual = null;
    document.getElementById(BACKDROP_ID).classList.add('is-open');
    document.getElementById(DRAWER_ID).classList.add('is-open');
    document.getElementById(BACKDROP_ID).setAttribute('aria-hidden', 'false');
    carregarEntregadores();
  }

  function fechar() {
    aberto = false;
    removerConferenciaOverlay();
    document.body.classList.remove('pdv-prestacao-aberta');
    const bd = document.getElementById(BACKDROP_ID);
    const dr = document.getElementById(DRAWER_ID);
    if (bd) {
      bd.classList.remove('is-open');
      bd.setAttribute('aria-hidden', 'true');
    }
    if (dr) dr.classList.remove('is-open');
  }

  function setBreadcrumb() {
    const $b = $('#prestacaoBreadcrumb');
    if (!$b.length) return;
    const parts = ['<a href="#" data-nav="entregadores">Entregadores</a>'];
    if (view === 'pedidos' || view === 'detalhe') {
      parts.push(`<span>/</span><a href="#" data-nav="pedidos">${escapeHtml(grupoAtual?.entregador || 'Pedidos')}</a>`);
    }
    if (view === 'detalhe') {
      parts.push(`<span>/</span><strong>#${pedidoAtual?.id || ''}</strong>`);
    }
    $b.html(parts.join(' '));
    $b.find('[data-nav="entregadores"]').on('click', (e) => {
      e.preventDefault();
      view = 'entregadores';
      carregarEntregadores();
    });
    $b.find('[data-nav="pedidos"]').on('click', (e) => {
      e.preventDefault();
      if (grupoAtual) renderPedidos(grupoAtual);
    });
  }

  async function api(path, opts = {}) {
    const resp = await fetch(`${API_URL}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
        ...(opts.headers || {})
      }
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Falha na requisição.');
    return data;
  }

  async function carregarEntregadores() {
    view = 'entregadores';
    setBreadcrumb();
    $('#prestacaoBody').html('<div class="p-3 text-muted">Carregando entregadores…</div>');
    try {
      // Pendentes operacionais: aguardando + em entrega + aguardando prestação
      const [g1, g2, g3] = await Promise.all([
        api('/vendas/entregas/por-entregador?status=AGUARDANDO_ENTREGA'),
        api('/vendas/entregas/por-entregador?status=EM_ENTREGA'),
        api('/vendas/entregas/por-entregador?status=AGUARDANDO_PRESTACAO')
      ]);
      const mapa = new Map();
      [...(g1.grupos || []), ...(g2.grupos || []), ...(g3.grupos || [])].forEach((g) => {
        const key = g.chave || String(g.entregador || '').toLowerCase();
        if (!mapa.has(key)) {
          mapa.set(key, {
            ...g,
            pedidos: [...(g.pedidos || [])]
          });
        } else {
          const cur = mapa.get(key);
          const ids = new Set(cur.pedidos.map((p) => p.id));
          (g.pedidos || []).forEach((p) => {
            if (!ids.has(p.id)) cur.pedidos.push(p);
          });
          cur.quantidade = cur.pedidos.length;
          cur.valor_total = cur.pedidos.reduce((s, p) => s + Number(p.total || 0), 0);
          cur.pendente_prestacao = Math.max(cur.pendente_prestacao || 0, g.pendente_prestacao || 0);
        }
      });
      gruposCache = Array.from(mapa.values()).sort((a, b) => {
        if ((b.pendente_prestacao || 0) !== (a.pendente_prestacao || 0)) {
          return (b.pendente_prestacao || 0) - (a.pendente_prestacao || 0);
        }
        return (b.quantidade || 0) - (a.quantidade || 0);
      });

      if (!gruposCache.length) {
        $('#prestacaoBody').html('<div class="p-4 text-center text-muted">Nenhuma entrega pendente de prestação.</div>');
        return;
      }

      $('#prestacaoBody').html(`
        <div class="list-group list-group-flush">
          ${gruposCache.map((g, idx) => `
            <button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center prestacao-grupo" data-idx="${idx}">
              <span>
                <i class="fas fa-user me-2 text-primary"></i>
                <strong>${escapeHtml(g.entregador)}</strong>
                ${g.pendente_prestacao ? '<span class="badge bg-info text-dark ms-2">prestação</span>' : ''}
              </span>
              <span class="badge bg-primary rounded-pill">${g.quantidade}</span>
            </button>
          `).join('')}
        </div>
      `);

      $('.prestacao-grupo').on('click', function () {
        const idx = Number($(this).data('idx'));
        renderPedidos(gruposCache[idx]);
      });
    } catch (err) {
      $('#prestacaoBody').html(`<div class="alert alert-danger m-3">${escapeHtml(err.message)}</div>`);
    }
  }

  function renderPedidos(grupo) {
    grupoAtual = grupo;
    view = 'pedidos';
    setBreadcrumb();
    const pedidos = grupo.pedidos || [];
    $('#prestacaoBody').html(`
      <div class="p-2 border-bottom bg-light small">
        ${escapeHtml(grupo.entregador)} · ${pedidos.length} pedido(s) · ${fmtMoney(grupo.valor_total)}
      </div>
      <div class="list-group list-group-flush">
        ${pedidos.map((p) => `
          <button type="button" class="list-group-item list-group-item-action prestacao-pedido" data-id="${p.id}">
            <div class="d-flex justify-content-between">
              <strong>#${p.id}</strong>
              <span>${fmtMoney(p.total)}</span>
            </div>
            <div class="small text-muted">${escapeHtml(p.cliente_nome || 'Consumidor')} · ${escapeHtml(p.status_entrega || '')}</div>
            <div class="small">${escapeHtml(p.pagamento_previsto || '—')} · ${escapeHtml(p.endereco_entrega || '')}</div>
          </button>
        `).join('')}
      </div>
    `);
    $('.prestacao-pedido').on('click', function () {
      abrirDetalhe($(this).data('id'));
    });
  }

  async function abrirDetalhe(vendaId) {
    view = 'detalhe';
    $('#prestacaoBody').html('<div class="p-3 text-muted">Carregando pedido…</div>');
    try {
      const data = await api(`/vendas/entregas/${vendaId}`);
      pedidoAtual = data.item;
      setBreadcrumb();
      pagamentosLinhas = [];
      renderDetalhe(data);
    } catch (err) {
      $('#prestacaoBody').html(`<div class="alert alert-danger m-3">${escapeHtml(err.message)}</div>`);
    }
  }

  function renderDetalhe(data) {
    const item = data.item || {};
    const eventos = (data.timeline && data.timeline.eventos) || [];
    const sugestaoFiscal = fiscalPadraoSistema();
    const total = Number(item.total || 0);

    const timelineHtml = eventos.length
      ? `<ul class="prestacao-timeline">${eventos.map((ev) => `
          <li><strong>${escapeHtml(ev.label || ev.acao)}</strong>
          <div class="small text-muted">${escapeHtml(ev.em || '')}</div></li>
        `).join('')}</ul>`
      : '<p class="small text-muted">Sem eventos.</p>';

    $('#prestacaoBody').html(`
      <div class="p-3">
        <div class="mb-3">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <h5 class="mb-1">Pedido #${item.id}</h5>
              <div>${escapeHtml(item.cliente_nome || 'Consumidor')}</div>
              <div class="small text-muted">${escapeHtml(item.telefone_entrega || '')}</div>
            </div>
            <div class="text-end">
              <div class="fs-4 fw-bold">${fmtMoney(total)}</div>
              <span class="badge bg-secondary">${escapeHtml(item.status_entrega || '')}</span>
            </div>
          </div>
          <div class="small mt-2"><strong>Endereço:</strong> ${escapeHtml(item.endereco_entrega || '—')}</div>
          <div class="small"><strong>Obs:</strong> ${escapeHtml(item.observacao_entrega || '—')}</div>
          <div class="small mt-1">
            Previsto: <strong>${escapeHtml(item.pagamento_previsto || '—')}</strong>
            · Maquineta: <strong>${item.leva_maquineta ? 'SIM' : 'NÃO'}</strong>
            · Troco p/: <strong>${fmtMoney(item.troco_para)}</strong>
            ${item.troco_necessario ? ` (nec. ${fmtMoney(item.troco_necessario)})` : ''}
          </div>
        </div>

        <div class="mb-3">
          <label class="form-label fw-semibold">Documento</label>
          <div class="d-flex gap-3">
            <div class="form-check">
              <input class="form-check-input" type="radio" name="prestDoc" id="docNfce" value="NFCE" ${sugestaoFiscal ? 'checked' : ''}>
              <label class="form-check-label" for="docNfce">NFC-e</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="radio" name="prestDoc" id="docNaoFiscal" value="NAO_FISCAL" ${!sugestaoFiscal ? 'checked' : ''}>
              <label class="form-check-label" for="docNaoFiscal">Venda Não Fiscal</label>
            </div>
          </div>
        </div>

        <div class="mb-3">
          <label class="form-label fw-semibold">Pagamento recebido</label>
          <div class="d-flex flex-wrap gap-2 mb-2" id="prestFormasRapidas">
            ${['pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'voucher', 'prazo'].map((f) => `
              <button type="button" class="btn btn-sm btn-outline-primary prest-forma" data-forma="${f}">${labelForma(f)}</button>
            `).join('')}
            <button type="button" class="btn btn-sm btn-outline-warning" id="btnPrestMisto">Misto</button>
          </div>
          <div id="prestPagamentosBox" class="small text-muted">Selecione a forma (valor total ${fmtMoney(total)}).</div>
          <div id="prestPagamentosLista" class="mt-2"></div>
        </div>

        <div class="row g-2 mb-3">
          <div class="col-6">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="prestMaquinetaOk" ${item.leva_maquineta ? '' : ''}>
              <label class="form-check-label" for="prestMaquinetaOk">Confirmar maquineta</label>
            </div>
          </div>
          <div class="col-6">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="prestTrocoOk">
              <label class="form-check-label" for="prestTrocoOk">Confirmar troco</label>
            </div>
          </div>
          <div class="col-6">
            <label class="form-label small">Troco devolvido (R$)</label>
            <input type="number" min="0" step="0.01" class="form-control form-control-sm" id="prestTrocoDevolvido" value="0">
          </div>
        </div>

        <div class="mb-3">
          <div class="fw-semibold mb-2">Timeline</div>
          ${timelineHtml}
        </div>

        <div class="d-grid gap-2">
          <button type="button" class="btn btn-success btn-lg" id="btnFinalizarPrestacao">
            <i class="fas fa-check me-1"></i> Finalizar Prestação
          </button>
          <button type="button" class="btn btn-outline-danger" id="btnCancelarEntregaPrestacao">
            Cancelar Entrega
          </button>
        </div>
      </div>
    `);

    $('.prest-forma').on('click', function () {
      const forma = $(this).data('forma');
      pagamentosLinhas = [{ forma_pagamento: forma, valor: total }];
      renderPagamentosLista(total);
    });

    $('#btnPrestMisto').on('click', () => abrirEditorMisto(total));

    $('#btnFinalizarPrestacao').on('click', () => finalizarPrestacao(item, total));
    $('#btnCancelarEntregaPrestacao').on('click', () => cancelarEntrega(item.id));
  }

  function labelForma(f) {
    return ({
      pix: 'PIX',
      dinheiro: 'Dinheiro',
      cartao_debito: 'Débito',
      cartao_credito: 'Crédito',
      voucher: 'Voucher',
      prazo: 'Fiado'
    })[f] || f;
  }

  function renderPagamentosLista(total) {
    const soma = pagamentosLinhas.reduce((s, p) => s + Number(p.valor || 0), 0);
    const ok = Math.abs(soma - total) < 0.009;
    $('#prestPagamentosBox').html(
      ok
        ? `<span class="text-success">Total ok: ${fmtMoney(soma)}</span>`
        : `<span class="text-danger">Soma ${fmtMoney(soma)} ≠ ${fmtMoney(total)}</span>`
    );
    $('#prestPagamentosLista').html(
      pagamentosLinhas.map((p, i) => `
        <div class="d-flex justify-content-between border-bottom py-1">
          <span>${labelForma(p.forma_pagamento)}</span>
          <span>${fmtMoney(p.valor)}
            <button type="button" class="btn btn-link btn-sm text-danger p-0 ms-2 prest-rm-pag" data-i="${i}">×</button>
          </span>
        </div>
      `).join('')
    );
    $('.prest-rm-pag').on('click', function () {
      pagamentosLinhas.splice(Number($(this).data('i')), 1);
      renderPagamentosLista(total);
    });
  }

  function abrirEditorMisto(total) {
    const restante = total - pagamentosLinhas.reduce((s, p) => s + Number(p.valor || 0), 0);
    const forma = prompt('Forma (pix, dinheiro, cartao_debito, cartao_credito, voucher, prazo):', 'pix');
    if (!forma) return;
    const valorStr = prompt('Valor:', String(Math.max(0, restante).toFixed(2)));
    if (valorStr == null) return;
    const valor = Number(String(valorStr).replace(',', '.'));
    if (!Number.isFinite(valor) || valor <= 0) {
      showNotification('Valor inválido.', 'warning');
      return;
    }
    pagamentosLinhas.push({ forma_pagamento: String(forma).toLowerCase().trim(), valor });
    renderPagamentosLista(total);
  }

  async function finalizarPrestacao(item, total) {
    if (!pagamentosLinhas.length) {
      showNotification('Informe o pagamento recebido.', 'warning');
      return;
    }
    const soma = pagamentosLinhas.reduce((s, p) => s + Number(p.valor || 0), 0);
    if (Math.abs(soma - total) >= 0.009) {
      showNotification('A soma dos pagamentos deve ser igual ao total da venda.', 'danger');
      return;
    }

    const documento = $('input[name="prestDoc"]:checked').val() || 'NAO_FISCAL';
    const forma = pagamentosLinhas.length > 1
      ? 'misto'
      : pagamentosLinhas[0].forma_pagamento;
    const pagamentoRecebido = pagamentosLinhas.length > 1
      ? pagamentosLinhas.map((p) => `${labelForma(p.forma_pagamento)} ${fmtMoney(p.valor)}`).join(' + ')
      : `${labelForma(forma)} ${fmtMoney(total)}`;

    const operador = (() => {
      try {
        const u = JSON.parse(localStorage.getItem('user') || '{}');
        return u.nome || u.username || 'Operador';
      } catch (_) {
        return 'Operador';
      }
    })();

    // ETAPA 1 — Tela de conferência final (antes do Motor)
    const confirmado = await abrirConferenciaFinal({
      item,
      total,
      documento,
      pagamentoRecebido,
      forma,
      operador
    });
    if (!confirmado) return;

    const $btn = $('#btnFinalizarPrestacao').prop('disabled', true);
    try {
      const data = await api(`/vendas/${item.id}/prestacao`, {
        method: 'POST',
        body: JSON.stringify({
          forma_pagamento: forma,
          pagamentos: pagamentosLinhas,
          emitir_fiscal: documento === 'NFCE',
          documento,
          maquineta_confirmada: $('#prestMaquinetaOk').is(':checked'),
          troco_confirmado: $('#prestTrocoOk').is(':checked'),
          troco_devolvido: Number($('#prestTrocoDevolvido').val() || 0) || 0
        })
      });

      showNotification(data.message || 'Prestação finalizada.', 'success');
      await imprimirPosPrestacao(data);
      atualizarWidgetContadores();
      carregarEntregadores();
    } catch (err) {
      showNotification(err.message || 'Erro na prestação.', 'danger');
    } finally {
      $btn.prop('disabled', false);
    }
  }

  function abrirConferenciaFinal({ item, total, documento, pagamentoRecebido, forma, operador }) {
    return new Promise((resolve) => {
      const drawer = document.getElementById(DRAWER_ID);
      if (!drawer) {
        resolve(false);
        return;
      }
      trazerParaFrente();
      removerConferenciaOverlay();

      const overlay = document.createElement('div');
      overlay.id = 'pdvPrestacaoConferencia';
      overlay.className = 'pdv-prestacao-conferencia';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Conferência Final');
      overlay.innerHTML = `
        <div class="pdv-prestacao-conferencia__card">
          <div class="pdv-prestacao-conferencia__header">
            <h5>Conferência Final</h5>
            <button type="button" class="btn-close btn-close-white" data-conf="cancelar" aria-label="Fechar"></button>
          </div>
          <div class="pdv-prestacao-conferencia__body">
            <table class="table table-sm mb-0">
              <tr><td>Cliente</td><td class="text-end fw-semibold">${escapeHtml(item.cliente_nome || 'Consumidor')}</td></tr>
              <tr><td>Pedido</td><td class="text-end">#${item.id}</td></tr>
              <tr><td>Valor</td><td class="text-end">${fmtMoney(total)}</td></tr>
              <tr><td>Pagamento Previsto</td><td class="text-end">${escapeHtml(item.pagamento_previsto || '—')}</td></tr>
              <tr><td>Pagamento Recebido</td><td class="text-end">${escapeHtml(pagamentoRecebido)}</td></tr>
              <tr><td>Documento</td><td class="text-end">${documento === 'NFCE' ? 'NFC-e' : 'Não Fiscal'}</td></tr>
              <tr><td>Entregador</td><td class="text-end">${escapeHtml(item.entregador || '—')}</td></tr>
              <tr><td>Operador</td><td class="text-end">${escapeHtml(operador)}</td></tr>
              <tr><td>Reserva</td><td class="text-end text-success">Será convertida / removida</td></tr>
              <tr><td>Estoque</td><td class="text-end text-success">Baixa definitiva</td></tr>
              <tr><td>Financeiro</td><td class="text-end text-success">Recebimento gerado</td></tr>
              <tr><td>Caixa</td><td class="text-end text-success">Entra no fechamento</td></tr>
            </table>
          </div>
          <div class="pdv-prestacao-conferencia__footer">
            <button type="button" class="btn btn-outline-secondary" data-conf="cancelar">Cancelar</button>
            <button type="button" class="btn btn-success" data-conf="finalizar" id="btnConfFinalizar">Finalizar Venda</button>
          </div>
        </div>`;
      drawer.appendChild(overlay);

      let decidido = false;
      const concluir = (ok) => {
        if (decidido) return;
        decidido = true;
        removerConferenciaOverlay();
        resolve(ok);
      };
      overlay.querySelectorAll('[data-conf="cancelar"]').forEach((btn) => {
        btn.addEventListener('click', () => concluir(false));
      });
      overlay.querySelector('[data-conf="finalizar"]')?.addEventListener('click', () => concluir(true));
      overlay.querySelector('[data-conf="finalizar"]')?.focus();
    });
  }

  function obterConfigImpressao() {
    try {
      const cfg = window.configuracaoAvancadaServidor
        || (typeof obterConfiguracaoAvancada === 'function' ? obterConfiguracaoAvancada() : null)
        || {};
      return {
        comprovante_prestacao: cfg.imprimir_comprovante_prestacao !== false,
        danfe: cfg.imprimir_danfe_nfce_entrega !== false,
        cupom_nao_fiscal: cfg.imprimir_cupom_nao_fiscal_entrega === true
      };
    } catch (_) {
      return { comprovante_prestacao: true, danfe: true, cupom_nao_fiscal: false };
    }
  }

  async function imprimirPosPrestacao(data) {
    const cfg = obterConfigImpressao();
    const vendaId = Number(data?.id || data?.venda_id || 0) || null;
    const fiscal = data?.fiscal || null;

    if (cfg.comprovante_prestacao && data.comprovante_html) {
      imprimirHtml(data.comprovante_html);
    }

    if (cfg.danfe && fiscal) {
      if (fiscal.status === 'sem_itens_fiscais') {
        showNotification(
          fiscal.message || 'Venda sem itens fiscais. NFC-e não necessária.',
          'info'
        );
        return;
      }

      if (fiscal.success === false) {
        showNotification(fiscal.message || 'Erro ao emitir NFC-e.', 'danger');
        return;
      }

      // NFC-e já emitida na prestação — imprimir DANFE (não reemitir).
      // Bug anterior: processarFiscalPosPagamentoPosVenda(data) passava o
      // objeto inteiro como vendaId → /fiscal/emitir/venda/[object Object].
      if (fiscal.danfeHtml) {
        imprimirHtml(fiscal.danfeHtml);
        return;
      }

      if (vendaId && typeof imprimirDANFEFiscal === 'function') {
        try {
          await imprimirDANFEFiscal(vendaId);
        } catch (_) {
          if (typeof processarFiscalPosPagamentoPosVenda === 'function') {
            processarFiscalPosPagamentoPosVenda(vendaId, data);
          }
        }
        return;
      }
    } else if (cfg.cupom_nao_fiscal && !fiscal && vendaId && typeof imprimirCupomNaoFiscal === 'function') {
      try { imprimirCupomNaoFiscal(vendaId, data); } catch (_) { /* ignore */ }
    }
  }

  async function cancelarEntrega(vendaId) {
    if (!confirm('Cancelar esta entrega? A reserva será liberada e não haverá financeiro/NFC-e.')) {
      return;
    }
    try {
      const data = await api(`/vendas/${vendaId}/entrega`, {
        method: 'DELETE',
        body: JSON.stringify({ motivo: 'Cancelado na prestação de contas' })
      });
      showNotification(data.message || 'Entrega cancelada.', 'success');
      atualizarWidgetContadores();
      carregarEntregadores();
    } catch (err) {
      showNotification(err.message || 'Erro ao cancelar.', 'danger');
    }
  }

  function imprimirHtml(html) {
    try {
      if (window.electronAPI && typeof window.electronAPI.abrirComprovante === 'function') {
        window.electronAPI.abrirComprovante(html, { silent: false, autoFecharMs: 5000 });
        return;
      }
    } catch (_) { /* fallback */ }
    const w = window.open('', '_blank', 'width=320,height=600');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.print(); } catch (_) { /* ignore */ } }, 300);
  }

  function bumpWidget(id, label, count, opts = {}) {
    const prev = (PdvFooterWidgets._lastCounts = PdvFooterWidgets._lastCounts || {});
    const changed = prev[id] !== count;
    prev[id] = count;
    PdvFooterWidgets.update(id, {
      label,
      count,
      meta: opts.meta || '',
      hint: opts.hint || '',
      tooltip: opts.tooltip || '',
      enabled: true,
      visible: true,
      className: changed ? 'pdv-footer-widget--pulse' : ''
    });
    if (changed) {
      setTimeout(() => {
        PdvFooterWidgets.update(id, { className: '' });
      }, 900);
    }
  }

  function abrirListagemEntregas() {
    if (typeof loadPage === 'function') {
      loadPage('entregas');
      $('.nav-link').removeClass('active');
      $('.nav-link[data-page="entregas"]').addClass('active');
      return;
    }
    if (typeof loadEntregas === 'function') {
      loadEntregas();
    }
  }

  async function atualizarWidgetContadores() {
    if (!moduloAtivo() || !window.PdvFooterWidgets) return;
    try {
      const data = await api('/vendas/entregas/dashboard');
      const d = data.dashboard || {};
      const entregas = Number(d.aguardando_entrega || 0);
      const prestacao = Number(d.prestacao_pendente != null
        ? d.prestacao_pendente
        : (Number(d.em_entrega || 0) + Number(d.aguardando_prestacao || 0)));

      bumpWidget('entregas-pendentes', '🚚 Entregas', entregas, {
        meta: 'aguardando',
        hint: 'Clique para visualizar',
        tooltip: 'Entregas — clique para visualizar a listagem'
      });
      bumpWidget('entregas-prestacao', '💰 Prestação', prestacao, {
        meta: 'pendentes',
        hint: 'Clique para finalizar',
        tooltip: 'Prestação — clique para abrir o drawer e finalizar'
      });

      if ((data.alertas && data.alertas.total) > 0) {
        const slot = document.querySelector('[data-pdv-footer-widgets]');
        if (slot) slot.classList.add('pdv-footer-widgets--alert');
      }
    } catch (_) { /* ignore */ }
  }

  function ativarWidget() {
    if (!moduloAtivo() || !window.PdvFooterWidgets) return;
    ensureMounted();

    if (!PdvFooterWidgets.list().includes('entregas-pendentes')) {
      PdvFooterWidgets.register({
        id: 'entregas-pendentes',
        label: '🚚 Entregas',
        count: 0,
        meta: 'aguardando',
        hint: 'Clique para visualizar',
        tooltip: 'Entregas — clique para visualizar a listagem',
        enabled: true,
        visible: true,
        onClick: () => abrirListagemEntregas()
      });
    } else {
      PdvFooterWidgets.update('entregas-pendentes', {
        enabled: true,
        visible: true,
        label: '🚚 Entregas',
        onClick: () => abrirListagemEntregas()
      });
    }

    if (!PdvFooterWidgets.list().includes('entregas-prestacao')) {
      PdvFooterWidgets.register({
        id: 'entregas-prestacao',
        label: '💰 Prestação',
        count: 0,
        meta: 'pendentes',
        hint: 'Clique para finalizar',
        tooltip: 'Prestação — clique para abrir o drawer e finalizar',
        enabled: true,
        visible: true,
        onClick: () => abrir()
      });
    } else {
      PdvFooterWidgets.update('entregas-prestacao', {
        enabled: true,
        visible: true,
        label: '💰 Prestação',
        onClick: () => abrir()
      });
    }

    atualizarWidgetContadores();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(atualizarWidgetContadores, 30000);
  }

  function init() {
    if (!moduloAtivo()) return;
    if (window.PdvFooterWidgets && typeof PdvFooterWidgets.init === 'function') {
      // garante slot
    }
    ativarWidget();
  }

  global.PdvPrestacaoEntrega = {
    init,
    abrir,
    fechar,
    atualizarWidgetContadores,
    estaAberto: () => aberto
  };
})(typeof window !== 'undefined' ? window : globalThis);
