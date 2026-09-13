(function (global) {
  'use strict';

  function escapeHtmlDevolucao(text) {
    if (text === undefined || text === null) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function rotuloModoItemDevolucao(item) {
    if (typeof global.rotuloModoVendaItem === 'function') {
      return global.rotuloModoVendaItem(item);
    }
    const fiscal = Number(item?.quantidade_fiscal ?? 0) > 0;
    const naoFiscal = Number(item?.quantidade_nao_fiscal ?? 0) > 0;
    if (fiscal && naoFiscal) return 'Misto';
    if (fiscal) return 'Fiscal';
    if (naoFiscal) return 'Não fiscal';
    return '-';
  }

  function formatarQtdDevolucao(item) {
    if (typeof global.formatarQuantidadeVendaItem === 'function') {
      return global.formatarQuantidadeVendaItem(item);
    }
    const qtd = Number(item?.quantidade ?? 0);
    return qtd.toFixed(3).replace('.', ',');
  }

  function formatarQtdKg(valor) {
    return Number(valor || 0).toFixed(3).replace('.', ',');
  }

  function obterApiUrl() {
    if (typeof API_URL !== 'undefined' && API_URL) return API_URL;
    return '/api';
  }

  function obterToken() {
    return localStorage.getItem('token') || '';
  }

  function montarPayloadDevolucao(motivo, itens, senhaAdmin) {
    const payload = {
      motivo,
      itens,
      senha_admin: senhaAdmin
    };

    if (typeof getTerminalRequestData === 'function') {
      return getTerminalRequestData(payload);
    }

    if (Number.isInteger(global.terminalId) && global.terminalId > 0) {
      payload.terminal_id = global.terminalId;
    }

    return payload;
  }

  function notificar(mensagem, tipo) {
    if (typeof showNotification === 'function') {
      showNotification(mensagem, tipo);
      return;
    }
    alert(mensagem);
  }

  function carregarVenda(vendaId) {
    const apiUrl = obterApiUrl();

    if (typeof $ !== 'undefined' && $.ajax) {
      return $.ajax({ url: `${apiUrl}/vendas/${vendaId}`, method: 'GET' });
    }

    return fetch(`${apiUrl}/vendas/${vendaId}`, {
      headers: { Authorization: `Bearer ${obterToken()}` }
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Erro ao carregar venda.');
      }
      return data;
    });
  }

  function renderizarItensDevolucao(itens) {
    return (itens || []).map((item) => `
      <tr>
        <td>${escapeHtmlDevolucao(item.produto_nome || '-')}</td>
        <td class="text-center">${rotuloModoItemDevolucao(item)}</td>
        <td class="text-center">${formatarQtdDevolucao(item)}</td>
        <td class="text-center">${formatarQtdKg(item.quantidade_fiscal)}</td>
        <td class="text-center">${formatarQtdKg(item.quantidade_nao_fiscal)}</td>
        <td class="text-center">${formatarQtdKg(item.estoque_atual)}</td>
        <td>
          <input
            type="number"
            min="0"
            step="0.001"
            class="form-control form-control-sm devolucao-qtd"
            data-item-id="${item.id}"
            placeholder="0"
          >
        </td>
      </tr>
    `).join('') || '<tr><td colspan="7" class="text-center">Sem itens</td></tr>';
  }

  async function confirmarDevolucao(vendaId, modal, opcoes) {
    const motivo = document.getElementById('motivoDevolucaoVenda')?.value.trim() || '';
    const senhaAdmin = document.getElementById('senhaAdminDevolucaoVenda')?.value || '';

    if (typeof validarMotivoTexto === 'function') {
      const validacaoMotivo = validarMotivoTexto(motivo);
      if (!validacaoMotivo.valido) {
        notificar(validacaoMotivo.erro, 'warning');
        return;
      }
    } else if (motivo.length < 15) {
      notificar('Informe um motivo válido com pelo menos 15 caracteres.', 'warning');
      return;
    }

    if (!senhaAdmin) {
      notificar('Informe a senha do administrador.', 'warning');
      return;
    }

    const itensDevolver = [];
    document.querySelectorAll('.devolucao-qtd').forEach((input) => {
      const qtd = Number(input.value || 0);
      const vendaItemId = Number(input.dataset.itemId);
      if (qtd > 0 && vendaItemId > 0) {
        itensDevolver.push({ venda_item_id: vendaItemId, quantidade: qtd });
      }
    });

    if (!itensDevolver.length) {
      notificar('Informe a quantidade de ao menos um item.', 'warning');
      return;
    }

    const apiUrl = obterApiUrl();
    const payload = montarPayloadDevolucao(motivo, itensDevolver, senhaAdmin);

    try {
      const response = await fetch(`${apiUrl}/vendas/${vendaId}/devolver`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${obterToken()}`
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.mensagem || 'Erro ao registrar devolução.');
      }

      modal.hide();
      notificar(data.message || 'Devolução registrada.', 'success');

      if (typeof opcoes.onSuccess === 'function') {
        opcoes.onSuccess(data);
      } else if (typeof loadVendas === 'function') {
        loadVendas();
      }
    } catch (error) {
      notificar(error.message, 'danger');
      if (typeof opcoes.onError === 'function') {
        opcoes.onError(error);
      }
    }
  }

  function abrirDevolucaoVenda(vendaId, opcoes = {}) {
    const destinoModal = opcoes.container || '#modal-container';

    Promise.resolve(carregarVenda(vendaId))
      .then((venda) => {
        const codigo = escapeHtmlDevolucao(venda.codigo || vendaId);
        const modalHtml = `
          <div class="modal fade" id="modalDevolucaoVenda" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
              <div class="modal-content">
                <div class="modal-header bg-warning">
                  <h5 class="modal-title">Devolução parcial — Venda ${codigo}</h5>
                  <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                </div>
                <div class="modal-body">
                  <div class="alert alert-info py-2 small mb-3">
                    Restaura estoque e recalcula o financeiro da venda. Exige caixa aberto e autorização do administrador.
                  </div>
                  <div class="mb-3">
                    <label class="form-label fw-bold" for="motivoDevolucaoVenda">Motivo (mín. 15 caracteres, 2 palavras)</label>
                    <textarea id="motivoDevolucaoVenda" class="form-control" rows="2" placeholder="Descreva o motivo da devolução"></textarea>
                  </div>
                  <div class="mb-3">
                    <label class="form-label fw-bold" for="senhaAdminDevolucaoVenda">Senha do administrador</label>
                    <input type="password" id="senhaAdminDevolucaoVenda" class="form-control" autocomplete="off" placeholder="Senha">
                  </div>
                  <p class="text-muted small">Informe a quantidade em KG a devolver. Restaura estoque fiscal primeiro, depois não fiscal.</p>
                  <div class="table-responsive">
                    <table class="table table-sm table-bordered mb-0">
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th>Modo</th>
                          <th>Qtd Venda</th>
                          <th>Fiscal (KG)</th>
                          <th>Não Fiscal (KG)</th>
                          <th>Estoque (KG)</th>
                          <th>Qtd devolver (KG)</th>
                        </tr>
                      </thead>
                      <tbody>${renderizarItensDevolucao(venda.itens)}</tbody>
                    </table>
                  </div>
                </div>
                <div class="modal-footer">
                  <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                  <button type="button" class="btn btn-warning" id="btnConfirmarDevolucaoVenda">
                    <i class="fas fa-undo"></i> Confirmar devolução
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;

        const anterior = document.getElementById('modalDevolucaoVenda');
        if (anterior) anterior.remove();

        if (typeof $ !== 'undefined' && destinoModal.startsWith('#')) {
          $(destinoModal).html(modalHtml);
        } else {
          const container = document.createElement('div');
          container.innerHTML = modalHtml;
          document.body.appendChild(container);
        }

        const modalEl = document.getElementById('modalDevolucaoVenda');
        const modal = new bootstrap.Modal(modalEl);
        modal.show();

        document.getElementById('btnConfirmarDevolucaoVenda').addEventListener('click', () => {
          confirmarDevolucao(vendaId, modal, opcoes);
        });

        setTimeout(() => {
          document.getElementById('motivoDevolucaoVenda')?.focus();
        }, 150);
      })
      .catch((error) => {
        notificar(error.message || 'Erro ao carregar venda para devolução.', 'danger');
      });
  }

  global.abrirDevolucaoVenda = abrirDevolucaoVenda;
})(typeof window !== 'undefined' ? window : global);
