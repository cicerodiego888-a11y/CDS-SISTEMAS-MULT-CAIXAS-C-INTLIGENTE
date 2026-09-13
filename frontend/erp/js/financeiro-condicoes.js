/**
 * RC8.5.1 — Cadastro de Condições de Pagamento (aba Financeiro)
 */
(function (global) {
  'use strict';

  let listaCondicoesCache = [];

  function apiUrl() {
    return (typeof API_URL !== 'undefined' ? API_URL : '/api') + '/condicoes-pagamento';
  }

  function formatarDias(dias) {
    if (!Array.isArray(dias) || !dias.length) return '-';
    return dias.join('/');
  }

  function renderCondicoesPagamento() {
    const conteudo = document.getElementById('financeiroConteudo');
    if (!conteudo) return;

    conteudo.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h5 class="mb-1">Condições de Pagamento</h5>
          <small class="text-muted">Modelos reutilizáveis no lançamento de compras (ex.: 30/60/90).</small>
        </div>
        <button type="button" class="btn btn-primary" id="btnNovaCondicaoPagamento">
          <i class="fas fa-plus"></i> Nova condição
        </button>
      </div>
      <div class="table-responsive">
        <table class="table table-striped table-hover align-middle" id="tabelaCondicoesPagamento">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Parcelas (dias)</th>
              <th>Entrada</th>
              <th>Status</th>
              <th style="width:140px">Ações</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colspan="6" class="text-center text-muted">Carregando…</td></tr>
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('btnNovaCondicaoPagamento')?.addEventListener('click', () => abrirModalCondicao());
    carregarListaCondicoes();
  }

  async function carregarListaCondicoes() {
    try {
      const resp = await fetch(apiUrl() + '?todas=1', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Erro ao listar condições');
      listaCondicoesCache = Array.isArray(data) ? data : [];
      const tbody = document.querySelector('#tabelaCondicoesPagamento tbody');
      if (!tbody) return;
      if (!listaCondicoesCache.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Nenhuma condição cadastrada.</td></tr>';
        return;
      }
      tbody.innerHTML = listaCondicoesCache.map((c) => `
        <tr>
          <td>${escapeHtml(c.nome)}${c.sistema ? ' <span class="badge bg-secondary">sistema</span>' : ''}</td>
          <td>${escapeHtml(c.tipo || '-')}</td>
          <td>${escapeHtml(formatarDias(c.dias_parcelas))}</td>
          <td>${c.tem_entrada ? 'Sim' : 'Não'}</td>
          <td>${c.ativo ? '<span class="badge bg-success">Ativa</span>' : '<span class="badge bg-secondary">Inativa</span>'}</td>
          <td>
            <button type="button" class="btn btn-sm btn-outline-primary me-1" data-edit="${c.id}"><i class="fas fa-edit"></i></button>
            ${c.sistema ? '' : `<button type="button" class="btn btn-sm btn-outline-danger" data-del="${c.id}"><i class="fas fa-trash"></i></button>`}
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = Number(btn.getAttribute('data-edit'));
          const row = listaCondicoesCache.find((x) => Number(x.id) === id);
          abrirModalCondicao(row);
        });
      });
      tbody.querySelectorAll('[data-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.getAttribute('data-del'));
          if (!window.confirm('Excluir esta condição?')) return;
          const r = await fetch(`${apiUrl()}/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
          });
          const body = await r.json().catch(() => ({}));
          if (!r.ok) {
            if (typeof showNotification === 'function') showNotification(body.error || 'Erro ao excluir', 'danger');
            return;
          }
          carregarListaCondicoes();
        });
      });
    } catch (err) {
      const tbody = document.querySelector('#tabelaCondicoesPagamento tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-danger">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function escapeHtml(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function abrirModalCondicao(row) {
    $('#modalCondicaoPagamentoCds').remove();
    const isEdit = !!(row && row.id);
    const diasStr = Array.isArray(row?.dias_parcelas) ? row.dias_parcelas.join('/') : '';
    const html = `
      <div class="modal fade" id="modalCondicaoPagamentoCds" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">${isEdit ? 'Editar' : 'Nova'} condição de pagamento</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <input type="hidden" id="condPagId" value="${isEdit ? row.id : ''}">
              <div class="mb-3">
                <label class="form-label">Nome *</label>
                <input type="text" class="form-control" id="condPagNome" value="${escapeHtml(row?.nome || '')}" placeholder="Ex.: 30/60/90">
              </div>
              <div class="mb-3">
                <label class="form-label">Tipo</label>
                <select class="form-select" id="condPagTipo">
                  <option value="avista" ${row?.tipo === 'avista' ? 'selected' : ''}>À vista</option>
                  <option value="prazo" ${!row || row?.tipo === 'prazo' ? 'selected' : ''}>À prazo</option>
                  <option value="entrada" ${row?.tipo === 'entrada' ? 'selected' : ''}>Entrada + parcelas</option>
                </select>
              </div>
              <div class="mb-3">
                <label class="form-label">Dias de cada parcela</label>
                <input type="text" class="form-control" id="condPagDias" value="${escapeHtml(diasStr)}" placeholder="Ex.: 30/60/90">
                <small class="text-muted">Separe por barra. Contados a partir da data-base da compra.</small>
              </div>
              <div class="form-check mb-2">
                <input class="form-check-input" type="checkbox" id="condPagEntrada" ${row?.tem_entrada ? 'checked' : ''}>
                <label class="form-check-label" for="condPagEntrada">Possui entrada</label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="condPagAtivo" ${row?.ativo !== 0 ? 'checked' : ''}>
                <label class="form-check-label" for="condPagAtivo">Ativa</label>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
              <button type="button" class="btn btn-primary" id="btnSalvarCondPag">Salvar</button>
            </div>
          </div>
        </div>
      </div>`;
    $('body').append(html);
    const el = document.getElementById('modalCondicaoPagamentoCds');
    const modal = bootstrap.Modal.getOrCreateInstance(el);
    $('#btnSalvarCondPag').on('click', async () => {
      const diasRaw = String($('#condPagDias').val() || '').trim();
      const dias = diasRaw
        ? diasRaw.split(/[\/|,;\s]+/).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n))
        : [];
      const payload = {
        id: $('#condPagId').val() || undefined,
        nome: $('#condPagNome').val(),
        tipo: $('#condPagTipo').val(),
        dias_parcelas: dias,
        tem_entrada: $('#condPagEntrada').is(':checked') ? 1 : 0,
        ativo: $('#condPagAtivo').is(':checked') ? 1 : 0
      };
      const method = payload.id ? 'PUT' : 'POST';
      const url = payload.id ? `${apiUrl()}/${payload.id}` : apiUrl();
      const r = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token') || ''}`
        },
        body: JSON.stringify(payload)
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (typeof showNotification === 'function') showNotification(body.error || 'Erro ao salvar', 'danger');
        return;
      }
      modal.hide();
      carregarListaCondicoes();
      if (typeof showNotification === 'function') showNotification('Condição salva.', 'success');
    });
    $(el).on('hidden.bs.modal', () => $(el).remove());
    modal.show();
  }

  /** Lista ativa para select de compras */
  async function listarCondicoesAtivasParaCompra() {
    const resp = await fetch(apiUrl(), {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Erro ao carregar condições');
    return Array.isArray(data) ? data : [];
  }

  global.renderCondicoesPagamento = renderCondicoesPagamento;
  global.listarCondicoesAtivasParaCompra = listarCondicoesAtivasParaCompra;
})(typeof window !== 'undefined' ? window : global);
