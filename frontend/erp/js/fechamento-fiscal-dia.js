/**
 * Sprint 01–06 — Fechamento Fiscal do Dia.
 * Monitoramento diário + prévia + preparação — sem baixa estoque / financeiro.
 */

'use strict';

let __ffdEstado = {
  fechamentoId: null,
  data: null,
  resumo: null,
  previa: null,
  indicadores: null,
  recebimentos: [],
  vista: 'venda', // venda | produto
  validacao: null,
  documentos: [],
  statusFiscal: null,
  moduloOn: false,
  ambiente: null,
  transmitindo: false,
  pollTimer: null,
  ultimaAtualizacao: null,
  montado: false
};

const FFD_POLL_MS = 10000;

function ffdApi() {
  return (typeof API_URL === 'string' && API_URL.trim() !== '')
    ? API_URL
    : `${window.location.origin}/api`;
}

function ffdHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function ffdHojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ffdFmtMoney(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function ffdEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ffdNotify(msg, tipo = 'info') {
  if (typeof showNotification === 'function') showNotification(msg, tipo);
  else console.warn('[FFD]', msg);
}

/** Modal Bootstrap — Electron não suporta window.prompt / confirm / alert. */
function ffdRemoverModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  try {
    const inst = bootstrap.Modal.getInstance(el);
    if (inst) inst.dispose();
  } catch (_) { /* ignore */ }
  el.remove();
}

function ffdConfirm(mensagem, titulo = 'Confirmação') {
  return new Promise((resolve) => {
    ffdRemoverModal('ffdConfirmModal');
    const html = `
      <div class="modal fade" id="ffdConfirmModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">${ffdEsc(titulo)}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
            </div>
            <div class="modal-body"><p class="mb-0" style="white-space:pre-wrap">${ffdEsc(mensagem)}</p></div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" id="ffdConfirmNao">Cancelar</button>
              <button type="button" class="btn btn-primary" id="ffdConfirmSim">Confirmar</button>
            </div>
          </div>
        </div>
      </div>`;
    const host = document.getElementById('modal-container') || document.body;
    host.insertAdjacentHTML('beforeend', html);
    const el = document.getElementById('ffdConfirmModal');
    const modal = new bootstrap.Modal(el, { backdrop: 'static' });
    let decidido = false;
    const finalizar = (ok) => {
      if (decidido) return;
      decidido = true;
      modal.hide();
      resolve(ok === true);
    };
    el.querySelector('#ffdConfirmSim').addEventListener('click', () => finalizar(true));
    el.addEventListener('hidden.bs.modal', () => {
      ffdRemoverModal('ffdConfirmModal');
      if (!decidido) resolve(false);
    }, { once: true });
    modal.show();
  });
}

function ffdAlert(mensagem, titulo = 'Detalhe') {
  return new Promise((resolve) => {
    ffdRemoverModal('ffdAlertModal');
    const html = `
      <div class="modal fade" id="ffdAlertModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">${ffdEsc(titulo)}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
            </div>
            <div class="modal-body"><pre class="mb-0 small" style="white-space:pre-wrap">${ffdEsc(mensagem)}</pre></div>
            <div class="modal-footer">
              <button type="button" class="btn btn-primary" data-bs-dismiss="modal">OK</button>
            </div>
          </div>
        </div>
      </div>`;
    const host = document.getElementById('modal-container') || document.body;
    host.insertAdjacentHTML('beforeend', html);
    const el = document.getElementById('ffdAlertModal');
    const modal = new bootstrap.Modal(el);
    el.addEventListener('hidden.bs.modal', () => {
      ffdRemoverModal('ffdAlertModal');
      resolve();
    }, { once: true });
    modal.show();
  });
}

function ffdAbrirModalMaquina() {
  return new Promise((resolve) => {
    ffdRemoverModal('ffdMaquinaModal');
    const html = `
      <div class="modal fade" id="ffdMaquinaModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Adicionar máquina / operadora</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
            </div>
            <div class="modal-body">
              <div class="mb-3">
                <label for="ffdMaqOperadora" class="form-label">Máquina / Operadora *</label>
                <input type="text" class="form-control" id="ffdMaqOperadora"
                  placeholder="Ex.: Sicredi, Stone, Mercado Pago" autocomplete="off">
              </div>
              <div class="mb-3">
                <label for="ffdMaqValor" class="form-label">Valor recebido *</label>
                <input type="text" class="form-control" id="ffdMaqValor"
                  placeholder="Ex.: 400,00" inputmode="decimal" autocomplete="off">
              </div>
              <div class="mb-0">
                <label for="ffdMaqCnpj" class="form-label">CNPJ da máquina (opcional)</label>
                <input type="text" class="form-control" id="ffdMaqCnpj"
                  placeholder="Somente números" autocomplete="off">
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
              <button type="button" class="btn btn-success" id="ffdMaqSalvar">Adicionar</button>
            </div>
          </div>
        </div>
      </div>`;
    const host = document.getElementById('modal-container') || document.body;
    host.insertAdjacentHTML('beforeend', html);
    const el = document.getElementById('ffdMaquinaModal');
    const modal = new bootstrap.Modal(el, { backdrop: 'static' });
    let decidido = false;

    const parseValor = (valorStr) => {
      let parsed = Number(String(valorStr || '').trim().replace(/\s/g, '').replace(',', '.'));
      if (!(parsed > 0) && String(valorStr || '').includes(',')) {
        parsed = Number(String(valorStr).trim().replace(/\./g, '').replace(',', '.'));
      }
      return parsed;
    };

    const finalizar = (dados) => {
      if (decidido) return;
      decidido = true;
      modal.hide();
      resolve(dados || null);
    };

    el.querySelector('#ffdMaqSalvar').addEventListener('click', () => {
      const operadora = String(el.querySelector('#ffdMaqOperadora').value || '').trim();
      const valorStr = el.querySelector('#ffdMaqValor').value;
      const cnpj = String(el.querySelector('#ffdMaqCnpj').value || '').replace(/\D/g, '');
      if (!operadora) {
        ffdNotify('Informe a máquina / operadora.', 'warning');
        el.querySelector('#ffdMaqOperadora').focus();
        return;
      }
      const parsed = parseValor(valorStr);
      if (!(parsed > 0)) {
        ffdNotify('Valor inválido.', 'warning');
        el.querySelector('#ffdMaqValor').focus();
        return;
      }
      finalizar({
        operadora,
        cnpj,
        valor: Math.round(parsed * 100) / 100
      });
    });

    el.addEventListener('hidden.bs.modal', () => {
      ffdRemoverModal('ffdMaquinaModal');
      if (!decidido) resolve(null);
    }, { once: true });

    modal.show();
    setTimeout(() => {
      const input = document.getElementById('ffdMaqOperadora');
      if (input) input.focus();
    }, 200);
  });
}

function ffdTotalRecebimentos() {
  return (__ffdEstado.recebimentos || []).reduce((s, r) => s + Number(r.valor || 0), 0);
}

function ffdFmtDataBr(iso) {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function ffdFmtHora(date = new Date()) {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function ffdPararPolling() {
  if (__ffdEstado.pollTimer) {
    clearInterval(__ffdEstado.pollTimer);
    __ffdEstado.pollTimer = null;
  }
  __ffdEstado.montado = false;
}

function ffdIniciarPolling() {
  ffdPararPolling();
  __ffdEstado.montado = true;
  __ffdEstado.pollTimer = setInterval(() => {
    if (!__ffdEstado.montado) return;
    if (!document.getElementById('ffdRoot')) {
      ffdPararPolling();
      return;
    }
    ffdCarregarDia({ silencioso: true });
  }, FFD_POLL_MS);
}

function ffdRotuloStatusMonitoramento(status) {
  const st = String(status || '').toUpperCase();
  if (!st || st === 'CANCELADO') return 'MONITORANDO';
  if (st === 'RASCUNHO') return 'FECHAMENTO EM PREPARAÇÃO';
  if (st === 'PREVIA' || st === 'VALIDANDO') return 'FECHAMENTO EM PREPARAÇÃO';
  if (st === 'PRONTO_EMISSAO') return 'PRONTO PARA EMISSÃO';
  if (st === 'EMITINDO' || st === 'PROCESSANDO') return 'EM PROCESSAMENTO';
  if (st === 'AUTORIZADO' || st === 'CONCLUIDO' || st === 'CONFIRMADO') return 'AUTORIZADO';
  if (st === 'REJEITADO') return 'REJEITADO';
  if (st === 'ERRO') return 'ERRO TÉCNICO';
  return st;
}

function ffdRenderCabecalhoMonitor() {
  const on = Boolean(__ffdEstado.moduloOn);
  const el = document.getElementById('ffdMonitorBadge');
  if (el) {
    el.innerHTML = on
      ? '<span class="text-success">● Monitoramento ativo</span>'
      : '<span class="text-muted">○ Monitoramento desativado</span>';
  }
  const stEl = document.getElementById('ffdStatusFluxo');
  if (stEl) {
    stEl.textContent = ffdRotuloStatusMonitoramento(__ffdEstado.statusFiscal);
  }
  const dataIso = __ffdEstado.data || ffdHojeISO();
  const hoje = ffdHojeISO();
  const rotulo = dataIso === hoje ? `Hoje — ${ffdFmtDataBr(dataIso)}` : ffdFmtDataBr(dataIso);
  const dEl = document.getElementById('ffdDataRotulo');
  if (dEl) dEl.textContent = rotulo;
  const uEl = document.getElementById('ffdUltimaAtualizacao');
  if (uEl && __ffdEstado.ultimaAtualizacao) {
    uEl.textContent = `Última atualização: ${__ffdEstado.ultimaAtualizacao}`;
  }
}

function ffdRenderKpis(resumo) {
  const r = resumo || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('ffdKpiVendasDia', String(r.vendas_do_dia ?? r.quantidade_vendas ?? 0));
  set('ffdKpiVendasNf', String(r.vendas_nao_fiscais ?? 0));
  set('ffdKpiValorNf', ffdFmtMoney(r.valor_nao_fiscal_vendido ?? 0));
  set('ffdKpiProdMonitor', String(r.produtos_fiscais_com_consumo_nao_fiscal ?? r.itens_fiscais_elegiveis ?? 0));
  set('ffdKpiUnidades', String(r.unidades_fiscais_elegiveis ?? 0));
  set('ffdKpiValorElegivel', ffdFmtMoney(r.valor_fiscal_elegivel ?? r.valor_elegivel ?? 0));
}

function ffdRenderAlertaInteligente(resumo) {
  const box = document.getElementById('ffdAlertaInteligente');
  if (!box) return;
  const r = resumo || {};
  const unidades = Number(r.unidades_fiscais_elegiveis || 0);
  const produtos = Number(r.produtos_fiscais_com_consumo_nao_fiscal || 0);
  const valor = Number(r.valor_fiscal_elegivel || r.valor_elegivel || 0);
  if (unidades > 0) {
    box.innerHTML = `
      <div class="alert alert-primary border-0 shadow-sm mb-0">
        <div class="fw-semibold mb-2">🔔 Foram identificadas vendas não fiscais de produtos fiscais.</div>
        <div class="mb-2">
          <strong>${produtos}</strong> produtos ·
          <strong>${unidades}</strong> unidades ·
          <strong>${ffdFmtMoney(valor)}</strong>
        </div>
        <div class="small mb-3">Esses valores estão disponíveis para composição do Fechamento Fiscal do Dia.</div>
        <button type="button" class="btn btn-primary btn-sm" id="ffdBtnAnalisar">ANALISAR FECHAMENTO</button>
      </div>`;
    const btn = document.getElementById('ffdBtnAnalisar');
    if (btn) {
      btn.addEventListener('click', () => {
        const alvo = document.getElementById('ffdSecaoRecebimentos');
        if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  } else {
    box.innerHTML = `
      <div class="alert alert-light border mb-0">
        <div class="fw-semibold mb-2">Nenhuma unidade fiscal foi consumida em vendas não fiscais hoje.</div>
        <div class="small text-muted">
          Produtos fiscais vendidos: <strong>${r.produtos_fiscais_vendidos ?? 0}</strong><br>
          Unidades fiscais consumidas em operações não fiscais: <strong>0</strong>
        </div>
        <div class="small mt-2">Por isso, não há valores disponíveis para composição do fechamento.</div>
      </div>`;
  }
}

function ffdRenderGridMonitoramento(resumo) {
  const body = document.getElementById('ffdGridBody');
  if (!body) return;
  const rows = (resumo && resumo.monitoramento) || [];
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="text-muted text-center py-4">Nenhum produto fiscal em operação não fiscal neste dia.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((p) => `
    <tr class="ffd-prod-row" style="cursor:pointer" data-ffd-pid="${p.produto_id}">
      <td>${ffdEsc(p.nome)}</td>
      <td class="text-end">${p.quantidade_vendida}</td>
      <td class="text-end">${p.quantidade_fiscal}</td>
      <td class="text-end">${p.quantidade_nao_fiscal}</td>
      <td class="text-end fw-semibold">${p.quantidade_elegivel}</td>
      <td class="text-end">${ffdFmtMoney(p.valor_elegivel)}</td>
      <td>${p.quantidade_elegivel > 0
        ? '<span class="badge text-bg-success">Elegível</span>'
        : '<span class="badge text-bg-secondary">Não elegível</span>'}</td>
    </tr>`).join('');
  body.querySelectorAll('[data-ffd-pid]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const pid = Number(tr.getAttribute('data-ffd-pid'));
      const prod = rows.find((x) => Number(x.produto_id) === pid);
      if (prod) ffdAbrirDetalheProduto(prod);
    });
  });
}

function ffdAbrirDetalheProduto(prod) {
  const linhas = (prod.vendas || []).map((v) =>
    `Venda #${v.venda_id}\n${v.quantidade_original} un\n${v.quantidade_fiscal} fiscal\n${v.quantidade_nao_fiscal} não fiscal\nElegível: ${v.quantidade_elegivel}`
  ).join('\n\n');
  const txt =
    `${prod.nome}\n\n` +
    `Total vendido: ${prod.quantidade_vendida}\n` +
    `Consumo fiscal: ${prod.quantidade_fiscal}\n` +
    `Consumo não fiscal: ${prod.quantidade_nao_fiscal}\n` +
    `Elegível: ${prod.quantidade_elegivel}\n\n` +
    (linhas || 'Sem vendas detalhadas.');
  ffdAlert(txt, prod.nome || 'Detalhe do produto');
}

function ffdRenderConciliacaoRecebimentos() {
  const el = document.getElementById('ffdConciliacao');
  if (!el) return;
  const rec = ffdTotalRecebimentos();
  const elegivel = Number(
    __ffdEstado.previa?.valor_distribuido
    ?? __ffdEstado.resumo?.valor_fiscal_elegivel
    ?? __ffdEstado.resumo?.valor_elegivel
    ?? 0
  );
  const informado = rec;
  const alvo = Number(__ffdEstado.previa?.valor_informado ?? rec);
  const diff = Math.round((alvo - Number(__ffdEstado.previa?.valor_distribuido || 0)) * 100) / 100;
  const valorElegivelPainel = Number(__ffdEstado.resumo?.valor_fiscal_elegivel ?? __ffdEstado.resumo?.valor_elegivel ?? 0);
  const difRec = Math.round((valorElegivelPainel - informado) * 100) / 100;
  const conciliado = Math.abs(difRec) < 0.005 || (informado > 0 && Math.abs(diff) < 0.005 && __ffdEstado.previa?.perfeita);
  el.innerHTML = `
    <div class="row g-2 small">
      <div class="col-md-4">Valor elegível: <strong>${ffdFmtMoney(valorElegivelPainel)}</strong></div>
      <div class="col-md-4">Recebimentos: <strong>${ffdFmtMoney(informado)}</strong></div>
      <div class="col-md-4">Diferença: <strong>${ffdFmtMoney(difRec)}</strong></div>
    </div>
    <div class="mt-2">${conciliado
      ? '<span class="text-success">● Conciliado</span>'
      : '<span class="text-warning">○ Pendente de conciliação</span>'}</div>`;
}

function loadFechamentoFiscalDoDia() {
  ffdPararPolling();
  const hoje = ffdHojeISO();
  __ffdEstado = {
    fechamentoId: null,
    data: hoje,
    resumo: null,
    previa: null,
    indicadores: null,
    recebimentos: [],
    vista: 'venda',
    validacao: null,
    documentos: [],
    statusFiscal: null,
    moduloOn: false,
    ambiente: null,
    transmitindo: false,
    pollTimer: null,
    ultimaAtualizacao: null,
    montado: true
  };

  $('#page-content').html(`
    <div class="container-fluid py-3" id="ffdRoot">
      <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
          <h2 class="h3 mb-1">Fechamento Fiscal do Dia</h2>
          <p class="text-muted mb-1">Monitoramento das vendas não fiscais de produtos fiscais</p>
          <div id="ffdMonitorBadge" class="small mb-1"></div>
          <div class="small"><span class="text-muted">Status:</span> <strong id="ffdStatusFluxo">MONITORANDO</strong></div>
        </div>
        <div class="text-end">
          <div class="fw-semibold" id="ffdDataRotulo">Hoje — ${ffdFmtDataBr(hoje)}</div>
          <div class="small text-muted" id="ffdUltimaAtualizacao">Última atualização: —</div>
          <div class="mt-2 d-flex gap-2 justify-content-end">
            <input type="date" class="form-control form-control-sm" id="ffdData" value="${hoje}" style="max-width:11rem">
            <button type="button" class="btn btn-sm btn-outline-primary" id="ffdBtnCarregarDia">Atualizar</button>
          </div>
        </div>
      </div>

      <div id="ffdModuloAlerta"></div>

      <div class="row g-3 mb-3">
        <div class="col-6 col-lg-3">
          <div class="border rounded-3 p-3 h-100 bg-white shadow-sm">
            <div class="text-muted text-uppercase small">Vendas do dia</div>
            <div class="display-6 fs-2" id="ffdKpiVendasDia">—</div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="border rounded-3 p-3 h-100 bg-white shadow-sm">
            <div class="text-muted text-uppercase small">Não fiscal</div>
            <div class="display-6 fs-2" id="ffdKpiValorNf">—</div>
            <div class="small text-muted"><span id="ffdKpiVendasNf">0</span> operações</div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="border rounded-3 p-3 h-100 bg-white shadow-sm">
            <div class="text-muted text-uppercase small">Unidades elegíveis</div>
            <div class="display-6 fs-2" id="ffdKpiUnidades">—</div>
            <div class="small text-muted"><span id="ffdKpiProdMonitor">0</span> produtos monitorados</div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="border rounded-3 p-3 h-100 bg-white shadow-sm">
            <div class="text-muted text-uppercase small">Valor elegível</div>
            <div class="display-6 fs-2" id="ffdKpiValorElegivel">—</div>
          </div>
        </div>
      </div>

      <div id="ffdAlertaInteligente" class="mb-3"></div>

      <div class="card border-0 shadow-sm mb-3">
        <div class="card-header bg-white"><strong>Produtos monitorados</strong></div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-hover mb-0 align-middle">
              <thead class="table-light">
                <tr>
                  <th>Produto</th>
                  <th class="text-end">Vendido</th>
                  <th class="text-end">Fiscal</th>
                  <th class="text-end">Não fiscal</th>
                  <th class="text-end">Elegível</th>
                  <th class="text-end">Valor elegível</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody id="ffdGridBody">
                <tr><td colspan="7" class="text-muted text-center py-3">Carregando…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card border-0 shadow-sm mb-3" id="ffdSecaoRecebimentos">
        <div class="card-header bg-white d-flex justify-content-between align-items-center">
          <strong>Recebimentos informados</strong>
          <button type="button" class="btn btn-sm btn-outline-success" id="ffdBtnAddMaquina">+ Adicionar máquina</button>
        </div>
        <div class="card-body">
          <div class="table-responsive">
            <table class="table table-sm align-middle">
              <thead><tr><th>Máquina / Operadora</th><th>CNPJ</th><th class="text-end">Valor</th><th></th></tr></thead>
              <tbody id="ffdMaquinasBody"><tr><td colspan="4" class="text-muted">Nenhuma máquina informada.</td></tr></tbody>
            </table>
          </div>
          <div class="text-end fw-semibold mb-3">TOTAL INFORMADO <span id="ffdTotalInformado">${ffdFmtMoney(0)}</span></div>
          <div id="ffdConciliacao"></div>
        </div>
      </div>

      <div class="card border-0 shadow-sm mb-3">
        <div class="card-header bg-white"><strong>Composição fiscal sugerida</strong></div>
        <div class="card-body">
          <div class="row g-3 mb-3">
            <div class="col-md-3">
              <label class="form-label" for="ffdValorAlvo">Valor alvo por venda</label>
              <input type="number" step="0.01" min="0" class="form-control" id="ffdValorAlvo" value="250.00">
              <div class="form-text">Sugestão. O sistema pode variar para fechar o total.</div>
            </div>
            <div class="col-md-3">
              <label class="form-label" for="ffdValorMin">Valor mínimo sugerido</label>
              <input type="number" step="0.01" min="0" class="form-control" id="ffdValorMin" value="80.00">
            </div>
            <div class="col-md-3">
              <label class="form-label" for="ffdValorMax">Valor máximo sugerido</label>
              <input type="number" step="0.01" min="0" class="form-control" id="ffdValorMax" value="400.00">
            </div>
            <div class="col-md-3 d-flex align-items-end">
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="ffdAuto" checked>
                <label class="form-check-label" for="ffdAuto">Distribuição automática</label>
              </div>
            </div>
          </div>
          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
            <div class="btn-group btn-group-sm" role="group">
              <button type="button" class="btn btn-outline-secondary active" id="ffdVistaVenda">Por venda</button>
              <button type="button" class="btn btn-outline-secondary" id="ffdVistaProduto">Por produto</button>
            </div>
            <button type="button" class="btn btn-outline-primary btn-sm" id="ffdBtnAtualizarPrevia">Atualizar Prévia</button>
          </div>
          <div id="ffdAlertaPrevia" class="mb-3"></div>
          <div class="row g-3 mb-3" id="ffdIndicadores">
            <div class="col"><div class="text-muted small">Produtos elegíveis</div><div id="ffdIndElegiveis">—</div></div>
            <div class="col"><div class="text-muted small">Valor elegível</div><div id="ffdIndElegivel">—</div></div>
            <div class="col"><div class="text-muted small">Valor informado</div><div id="ffdPrevInformado">—</div></div>
            <div class="col"><div class="text-muted small">Valor distribuído</div><div id="ffdPrevDistribuido">—</div></div>
            <div class="col"><div class="text-muted small">Diferença</div><div id="ffdPrevDiferenca">—</div></div>
            <div class="col"><div class="text-muted small">Qtd. vendas</div><div id="ffdPrevQtdVendas">—</div></div>
          </div>
          <div id="ffdPreviaConteudo" class="text-muted">Atualize a prévia para visualizar a composição.</div>
        </div>
      </div>

      <div class="card border-0 shadow-sm mb-3">
        <div class="card-header bg-white"><strong>Validação e emissão</strong></div>
        <div class="card-body">
          <div class="row g-3 mb-3">
            <div class="col-md-3"><div class="text-muted small">Valor total</div><div class="fs-5" id="ffdValTotal">—</div></div>
            <div class="col-md-3"><div class="text-muted small">Documentos</div><div class="fs-5" id="ffdValDocs">—</div></div>
            <div class="col-md-3"><div class="text-muted small">Status</div><div class="fs-5" id="ffdValStatus">—</div></div>
            <div class="col-md-3"><div class="text-muted small">Ambiente</div><div class="fs-5" id="ffdValAmbiente">—</div></div>
          </div>
          <div id="ffdChecklist" class="mb-3 text-muted small">Após a prévia perfeita, execute a validação fiscal.</div>
          <div id="ffdErrosValidacao"></div>
          <div id="ffdXmlPreview" class="d-none">
            <label class="form-label small">XML preparado (validação)</label>
            <textarea class="form-control form-control-sm font-monospace" id="ffdXmlText" rows="8" readonly></textarea>
          </div>
          <div id="ffdTxProgresso" class="mt-3"></div>
          <div id="ffdTxResultado" class="mt-3"></div>
        </div>
      </div>

      <div class="d-flex flex-wrap gap-2 justify-content-end">
        <button type="button" class="btn btn-outline-secondary" id="ffdBtnCancelar">Voltar / Cancelar</button>
        <button type="button" class="btn btn-outline-warning" id="ffdBtnCorrigir" disabled>Corrigir pendências</button>
        <button type="button" class="btn btn-primary" id="ffdBtnSalvarRascunho">Salvar Rascunho</button>
        <button type="button" class="btn btn-outline-dark" id="ffdBtnValidar" disabled>Validar fiscal</button>
        <button type="button" class="btn btn-outline-secondary" id="ffdBtnGerarXml" disabled>Gerar XML</button>
        <button type="button" class="btn btn-outline-secondary" id="ffdBtnVerXml" disabled>Visualizar XML</button>
        <button type="button" class="btn btn-success" id="ffdBtnPreparar" disabled>Preparar para emissão</button>
        <button type="button" class="btn btn-outline-info" id="ffdBtnRecuperar" disabled>Recuperar SEFAZ</button>
        <button type="button" class="btn btn-dark" id="ffdBtnTransmitir" disabled title="Somente homologação após PRONTO_EMISSAO">Transmitir para SEFAZ</button>
      </div>
      <div class="text-muted small text-end mt-2">Produção bloqueada nesta versão. Transmissão apenas em homologação.</div>
    </div>
  `);

  $('#ffdBtnCarregarDia').on('click', () => ffdCarregarDia());
  $('#ffdData').on('change', () => ffdCarregarDia());
  $('#ffdBtnAddMaquina').on('click', () => ffdAdicionarMaquinaUi());
  $('#ffdBtnAtualizarPrevia').on('click', () => ffdAtualizarPrevia());
  $('#ffdBtnSalvarRascunho').on('click', () => ffdSalvarRascunho());
  $('#ffdBtnCancelar').on('click', () => ffdCancelar());
  $('#ffdBtnValidar').on('click', () => ffdValidarFiscal());
  $('#ffdBtnGerarXml').on('click', () => ffdPrepararEmissao(true));
  $('#ffdBtnPreparar').on('click', () => ffdPrepararEmissao(true));
  $('#ffdBtnVerXml').on('click', () => ffdToggleXml());
  $('#ffdBtnCorrigir').on('click', () => ffdCorrigirPendencias());
  $('#ffdBtnTransmitir').on('click', () => ffdTransmitirSefaz());
  $('#ffdBtnRecuperar').on('click', () => ffdRecuperarSefaz());
  $('#ffdVistaVenda').on('click', () => { __ffdEstado.vista = 'venda'; ffdAtualizarVistaBtns(); ffdRenderPrevia(__ffdEstado.previa); });
  $('#ffdVistaProduto').on('click', () => { __ffdEstado.vista = 'produto'; ffdAtualizarVistaBtns(); ffdRenderPrevia(__ffdEstado.previa); });

  $(document).off('cds:page-change.ffd').on('cds:page-change.ffd', () => ffdPararPolling());

  ffdVerificarModulo().then(() => {
    ffdCarregarDia();
    ffdIniciarPolling();
  });
}

function ffdAtualizarVistaBtns() {
  $('#ffdVistaVenda').toggleClass('active', __ffdEstado.vista === 'venda');
  $('#ffdVistaProduto').toggleClass('active', __ffdEstado.vista === 'produto');
}

function ffdRenderMaquinas() {
  const body = document.getElementById('ffdMaquinasBody');
  if (!body) return;
  const rows = __ffdEstado.recebimentos || [];
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="4" class="text-muted">Nenhuma máquina informada.</td></tr>';
  } else {
    body.innerHTML = rows.map((r, idx) => `
      <tr>
        <td>${ffdEsc(r.operadora)}</td>
        <td>${ffdEsc(r.cnpj || '—')}</td>
        <td class="text-end">${ffdFmtMoney(r.valor)}</td>
        <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger" data-ffd-rm="${idx}">Remover</button></td>
      </tr>`).join('');
    body.querySelectorAll('[data-ffd-rm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        __ffdEstado.recebimentos.splice(Number(btn.getAttribute('data-ffd-rm')), 1);
        ffdRenderMaquinas();
        ffdRenderConciliacaoRecebimentos();
      });
    });
  }
  $('#ffdTotalInformado').text(ffdFmtMoney(ffdTotalRecebimentos()));
  ffdRenderConciliacaoRecebimentos();
}

async function ffdAdicionarMaquinaUi() {
  const dados = await ffdAbrirModalMaquina();
  if (!dados) return;
  __ffdEstado.recebimentos.push({
    operadora: dados.operadora,
    cnpj: dados.cnpj || '',
    valor: dados.valor
  });
  ffdRenderMaquinas();
}

async function ffdCarregarDia(opts = {}) {
  const silencioso = Boolean(opts.silencioso);
  const data = String($('#ffdData').val() || ffdHojeISO());
  __ffdEstado.data = data;
  try {
    if (!__ffdEstado.moduloOn) {
      ffdRenderCabecalhoMonitor();
      ffdRenderKpis({});
      ffdRenderAlertaInteligente({});
      const body = document.getElementById('ffdGridBody');
      if (body) {
        body.innerHTML = '<tr><td colspan="7" class="text-muted text-center py-4">Monitoramento indisponível — módulo desativado.</td></tr>';
      }
      return;
    }

    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/resumo?data=${encodeURIComponent(data)}`, { headers: ffdHeaders() });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    __ffdEstado.resumo = body;
    __ffdEstado.ultimaAtualizacao = ffdFmtHora();
    ffdRenderKpis(body);
    ffdRenderAlertaInteligente(body);
    ffdRenderGridMonitoramento(body);

    const listaResp = await fetch(`${ffdApi()}/fiscal/fechamentos?data=${encodeURIComponent(data)}`, { headers: ffdHeaders() });
    const listaBody = await listaResp.json().catch(() => ({}));
    const ativos = (listaBody.fechamentos || []).filter((f) => f.status !== 'CANCELADO');
    if (ativos.length) {
      const ff = ativos[0];
      __ffdEstado.fechamentoId = ff.id;
      __ffdEstado.statusFiscal = ff.status || null;
      __ffdEstado.documentos = ff.documentos || [];
      if (!silencioso || !(__ffdEstado.recebimentos || []).length) {
        __ffdEstado.recebimentos = (ff.recebimentos || []).map((r) => ({
          id: r.id, operadora: r.operadora, cnpj: r.cnpj, valor: Number(r.valor)
        }));
      }
      ffdRenderMaquinas();
      if (!silencioso) {
        $('#ffdValorAlvo').val(Number(ff.valor_alvo || 250).toFixed(2));
        $('#ffdValorMin').val(Number(ff.valor_min || 80).toFixed(2));
        $('#ffdValorMax').val(Number(ff.valor_max || 400).toFixed(2));
      }
      if (ff.previa_vendas && ff.previa_vendas.length) {
        ffdRenderPrevia({
          vendas: ff.previa_vendas.map((v) => ({
            sequencia: v.sequencia,
            rotulo: `Venda Fiscal ${String(v.sequencia).padStart(3, '0')}`,
            valor: Number(v.valor),
            quantidade_itens: (v.itens || []).length,
            itens: (v.itens || []).map((it) => ({
              nome: it.nome || `Produto ${it.produto_id}`,
              quantidade: it.quantidade,
              valor_total: it.valor_total,
              produto_id: it.produto_id
            }))
          })),
          porProduto: (ff.itens || []).map((i) => ({
            nome: i.nome || `Produto ${i.produto_id}`,
            produto_id: i.produto_id,
            quantidade_vendida: i.quantidade_disponivel,
            quantidade_utilizada: i.quantidade_utilizada
          })),
          valor_informado: Number(ff.valor_informado),
          valor_distribuido: Number(ff.valor_distribuido),
          diferenca: Number(ff.diferenca),
          quantidade_vendas: ff.previa_vendas.length,
          perfeita: Number(ff.diferenca) === 0,
          incompleta: Number(ff.diferenca) !== 0,
          mensagem: Number(ff.diferenca) === 0
            ? 'Valor informado e valor distribuído estão iguais.'
            : null,
          valor_elegivel: body.capacidade_elegivel
        });
      }
      ffdAtualizarBotoesEtapa5(__ffdEstado.previa);
    } else {
      __ffdEstado.fechamentoId = null;
      __ffdEstado.statusFiscal = null;
      if (!silencioso) ffdRenderMaquinas();
    }
    ffdRenderCabecalhoMonitor();
  } catch (err) {
    if (!silencioso) ffdNotify(err.message || 'Falha ao carregar o dia.', 'danger');
  }
}

function ffdRenderPrevia(previa) {
  __ffdEstado.previa = previa;
  const el = document.getElementById('ffdPreviaConteudo');
  const alerta = document.getElementById('ffdAlertaPrevia');
  if (!el) return;

  $('#ffdPrevInformado').text(ffdFmtMoney(previa?.valor_informado));
  $('#ffdPrevDistribuido').text(ffdFmtMoney(previa?.valor_distribuido));
  $('#ffdPrevDiferenca').text(ffdFmtMoney(previa?.diferenca));
  $('#ffdPrevQtdVendas').text(String(previa?.quantidade_vendas ?? (previa?.vendas || []).length ?? '—'));
  $('#ffdIndElegiveis').text(String(__ffdEstado.resumo?.produtos_fiscais_com_consumo_nao_fiscal ?? __ffdEstado.resumo?.itens_fiscais_elegiveis ?? previa?.metricas?.produtos_elegiveis ?? '—'));
  $('#ffdIndElegivel').text(ffdFmtMoney(previa?.valor_elegivel ?? __ffdEstado.resumo?.valor_fiscal_elegivel ?? __ffdEstado.resumo?.capacidade_elegivel));
  ffdRenderConciliacaoRecebimentos();
  ffdRenderCabecalhoMonitor();

  if (alerta) {
    if (!previa) {
      alerta.innerHTML = '';
    } else if (previa.codigo === 'VALOR_ZERO') {
      alerta.innerHTML = `<div class="alert alert-info mb-0">${ffdEsc(previa.mensagem)}</div>`;
    } else if (previa.perfeita) {
      alerta.innerHTML = `<div class="alert alert-success mb-0"><strong>✓ Distribuição concluída</strong><div class="small">${ffdEsc(previa.mensagem || 'Valor informado e valor distribuído estão iguais.')}</div></div>`;
    } else if (previa.incompleta) {
      alerta.innerHTML = `<div class="alert alert-warning mb-0"><strong>⚠ Distribuição incompleta</strong><pre class="mb-0 mt-2 small" style="white-space:pre-wrap">${ffdEsc(previa.mensagem || '')}</pre></div>`;
    } else {
      alerta.innerHTML = '';
    }
  }

  if (!previa || (!(previa.vendas || []).length && __ffdEstado.vista === 'venda')) {
    el.innerHTML = '<span class="text-muted">Nenhuma composição gerada.</span>';
    return;
  }

  if (__ffdEstado.vista === 'produto') {
    const rows = previa.porProduto || previa.itensUtilizados || [];
    if (!rows.length) {
      el.innerHTML = '<span class="text-muted">Sem utilização por produto.</span>';
      return;
    }
    el.innerHTML = `
      <div class="table-responsive">
        <table class="table table-sm">
          <thead><tr><th>Produto</th><th class="text-end">Vendido</th><th class="text-end">Utilizado</th><th class="text-end">Valor utilizado</th></tr></thead>
          <tbody>
            ${rows.map((p) => `
              <tr>
                <td>${ffdEsc(p.nome || `Produto ${p.produto_id}`)}</td>
                <td class="text-end">${p.quantidade_vendida != null ? p.quantidade_vendida : '—'}</td>
                <td class="text-end">${p.quantidade_utilizada != null ? p.quantidade_utilizada : '—'}</td>
                <td class="text-end">${ffdFmtMoney(p.valor_utilizado)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    return;
  }

  el.innerHTML = (previa.vendas || []).map((v, idx) => {
    const itens = v.itens || [];
    return `
      <div class="border rounded p-3 mb-3 bg-light">
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <div class="fw-semibold">${ffdEsc(v.rotulo || `Venda Fiscal ${String(v.sequencia || idx + 1).padStart(3, '0')}`)}</div>
            <div class="fs-5">${ffdFmtMoney(v.valor)}</div>
            <div class="text-muted small">${itens.length} itens</div>
          </div>
          <div class="dropdown">
            <button class="btn btn-sm btn-outline-secondary" type="button" data-bs-toggle="dropdown" aria-expanded="false">⋮</button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><button class="dropdown-item" type="button" data-ffd-detalhe="${idx}">Ver detalhes</button></li>
              <li><button class="dropdown-item disabled" type="button" title="Próxima etapa">Ajustar manualmente</button></li>
              <li><button class="dropdown-item text-danger" type="button" data-ffd-remover="${idx}">Remover da composição</button></li>
            </ul>
          </div>
        </div>
        ${itens.length ? `
          <div class="table-responsive mt-2">
            <table class="table table-sm mb-0">
              <tbody>
                ${itens.map((it) => `
                  <tr>
                    <td>${ffdEsc(it.nome || `Produto ${it.produto_id}`)}</td>
                    <td class="text-end">${it.quantidade}</td>
                    <td class="text-end">${ffdFmtMoney(it.valor_total != null ? it.valor_total : it.valor)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : ''}
      </div>`;
  }).join('');

  el.querySelectorAll('[data-ffd-detalhe]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = (previa.vendas || [])[Number(btn.getAttribute('data-ffd-detalhe'))];
      if (!v) return;
      const txt = (v.itens || []).map((it) =>
        `${it.nome}: ${it.quantidade} × ${ffdFmtMoney(it.valor_unitario || 0)} = ${ffdFmtMoney(it.valor_total || it.valor)}`
      ).join('\n');
      ffdAlert(
        `${v.rotulo}\nTotal: ${ffdFmtMoney(v.valor)}\n\n${txt || 'Sem itens'}`,
        v.rotulo || 'Detalhe da composição'
      );
    });
  });
  el.querySelectorAll('[data-ffd-remover]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await ffdConfirm('Remover esta venda da composição e recalcular a prévia?');
      if (!ok) return;
      // Sprint 02: remoção = regenerar (sem edição manual persistente nesta etapa)
      ffdNotify('Recalculando distribuição…', 'info');
      await ffdAtualizarPrevia();
    });
  });

  ffdAtualizarBotoesEtapa5(previa);
}

function ffdAtualizarBotoesEtapa5(previa) {
  const okPrevia = Boolean(previa?.perfeita && (previa.vendas || []).length);
  const pronto = __ffdEstado.statusFiscal === 'PRONTO_EMISSAO';
  const emitindo = __ffdEstado.statusFiscal === 'EMITINDO';
  const autorizado = __ffdEstado.statusFiscal === 'AUTORIZADO';
  const temXml = (__ffdEstado.documentos || []).some((d) => d.xml_preparado || d.xml_hash);
  const moduloOk = Boolean(__ffdEstado.moduloOn);
  const homolog = Number(__ffdEstado.ambiente) === 2;
  $('#ffdBtnValidar').prop('disabled', !moduloOk || (!okPrevia && !pronto));
  $('#ffdBtnGerarXml').prop('disabled', !moduloOk || (!okPrevia && !pronto));
  $('#ffdBtnPreparar').prop('disabled', !moduloOk || (!okPrevia && !pronto));
  $('#ffdBtnVerXml').prop('disabled', !temXml);
  $('#ffdBtnCorrigir').prop('disabled', !(__ffdEstado.validacao && __ffdEstado.validacao.ok === false));
  $('#ffdBtnTransmitir').prop(
    'disabled',
    !moduloOk || !homolog || __ffdEstado.transmitindo || !(pronto || emitindo) || autorizado
  );
  $('#ffdBtnRecuperar').prop(
    'disabled',
    !moduloOk || !homolog || __ffdEstado.transmitindo || !(
      emitindo
      || (__ffdEstado.documentos || []).some((d) =>
        d.status === 'EMITINDO' || d.status === 'ERRO_COM_POSSIVEL_PROCESSAMENTO'
      )
    )
  );
  $('#ffdValTotal').text(ffdFmtMoney(previa?.valor_distribuido ?? previa?.valor_informado));
  $('#ffdValDocs').text(String((__ffdEstado.documentos || []).length || previa?.quantidade_vendas || '—'));
  $('#ffdValStatus').text(__ffdEstado.statusFiscal || (okPrevia ? 'PREVIA' : '—'));
  $('#ffdValAmbiente').text(homolog ? 'Homologação' : (Number(__ffdEstado.ambiente) === 1 ? 'Produção (bloqueada)' : '—'));
}

async function ffdVerificarModulo() {
  try {
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/modulo`, { headers: ffdHeaders() });
    const body = await resp.json().catch(() => ({}));
    __ffdEstado.moduloOn = Boolean(body.permitido);
    __ffdEstado.ambiente = body.ambiente != null ? Number(body.ambiente) : null;
    const alerta = document.getElementById('ffdModuloAlerta');
    if (alerta) {
      if (!__ffdEstado.moduloOn) {
        alerta.innerHTML = `<div class="alert alert-danger">Módulo <strong>Fechamento Fiscal do Dia</strong> desativado.
          Ative em Configurações → Plataforma Fiscal → Fechamento Fiscal do Dia.</div>`;
      } else if (Number(__ffdEstado.ambiente) === 1) {
        alerta.innerHTML = `<div class="alert alert-warning">Ambiente fiscal em <strong>PRODUÇÃO</strong> — transmissão do fechamento permanece bloqueada nesta versão. Use homologação.</div>`;
      } else {
        alerta.innerHTML = '';
      }
    }
    ffdRenderCabecalhoMonitor();
  } catch (_) {
    __ffdEstado.moduloOn = false;
    ffdRenderCabecalhoMonitor();
  }
}

async function ffdTransmitirSefaz() {
  if (__ffdEstado.transmitindo) return;
  if (!__ffdEstado.moduloOn) {
    ffdNotify('Módulo desativado.', 'warning');
    return;
  }
  if (Number(__ffdEstado.ambiente) !== 2) {
    ffdNotify('Transmissão somente em homologação.', 'warning');
    return;
  }
  const docs = __ffdEstado.documentos || [];
  const qtd = docs.length || (__ffdEstado.previa?.quantidade_vendas || 0);
  const total = ffdFmtMoney(__ffdEstado.previa?.valor_distribuido || __ffdEstado.previa?.valor_informado);
  const ok = await ffdConfirm(
    `TRANSMITIR DOCUMENTOS\n\nAmbiente: HOMOLOGAÇÃO\n\nDocumentos: ${qtd}\nValor total: ${total}\n\nEsta operação enviará os documentos para a SEFAZ em ambiente de homologação.`,
    'Transmitir documentos'
  );
  if (!ok) return;

  __ffdEstado.transmitindo = true;
  ffdAtualizarBotoesEtapa5(__ffdEstado.previa);
  const prog = document.getElementById('ffdTxProgresso');
  if (prog) {
    prog.innerHTML = `<div class="alert alert-info mb-0"><strong>Transmitindo documentos...</strong>
      <div class="small mt-2">${Array.from({ length: qtd }, (_, i) =>
        `Documento ${i + 1}/${qtd}: ${i === 0 ? '⟳ Processando' : 'Aguardando'}`
      ).join('<br>')}</div></div>`;
  }

  try {
    const id = __ffdEstado.fechamentoId;
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${id}/transmitir`, {
      method: 'POST', headers: ffdHeaders(), body: JSON.stringify({})
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);

    __ffdEstado.documentos = body.documentos || [];
    __ffdEstado.statusFiscal = body.status;
    ffdRenderResultadoTx(body);
    ffdAtualizarBotoesEtapa5(__ffdEstado.previa);
    ffdNotify(body.mensagem || 'Transmissão concluída.', body.ok ? 'success' : 'warning');
  } catch (err) {
    ffdNotify(err.message || 'Falha na transmissão.', 'danger');
    const res = document.getElementById('ffdTxResultado');
    if (res) res.innerHTML = `<div class="alert alert-danger">${ffdEsc(err.message || 'Erro')}</div>`;
  } finally {
    __ffdEstado.transmitindo = false;
    ffdAtualizarBotoesEtapa5(__ffdEstado.previa);
  }
}

async function ffdRecuperarSefaz() {
  try {
    const id = __ffdEstado.fechamentoId;
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${id}/recuperar`, {
      method: 'POST', headers: ffdHeaders(), body: JSON.stringify({})
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    __ffdEstado.documentos = body.documentos || [];
    __ffdEstado.statusFiscal = body.status;
    ffdRenderResultadoTx(body);
    ffdAtualizarBotoesEtapa5(__ffdEstado.previa);
    ffdNotify('Recuperação concluída.', 'success');
  } catch (err) {
    ffdNotify(err.message || 'Falha na recuperação.', 'danger');
  }
}

function ffdRenderResultadoTx(body) {
  const prog = document.getElementById('ffdTxProgresso');
  const res = document.getElementById('ffdTxResultado');
  const docs = body.documentos || [];
  if (prog) {
    prog.innerHTML = `<div class="alert alert-secondary"><strong>Progresso</strong><div class="small mt-2">${
      docs.map((d, i) => {
        const st = d.status;
        const icon = st === 'AUTORIZADO' ? '✓' : (st === 'REJEITADO' ? '⚠' : (st === 'EMITINDO' ? '⟳' : '•'));
        return `Documento ${i + 1}/${docs.length}: ${icon} ${ffdEsc(st)}`;
      }).join('<br>')
    }</div></div>`;
  }
  if (!res) return;
  const r = body.resumo || {};
  if (body.status === 'AUTORIZADO') {
    res.innerHTML = `<div class="alert alert-success"><strong>✓ FECHAMENTO FISCAL AUTORIZADO</strong>
      <div class="small mt-2">${r.autorizados || docs.length} documentos autorizados · Total ${ffdFmtMoney(r.valor_total)}</div>
      <ul class="small mb-0 mt-2">${docs.map((d) =>
        `<li>#${d.sequencia} · série ${ffdEsc(d.serie)} nº ${ffdEsc(d.numero || d.numero_provisorio)} · chave ${ffdEsc(d.chave_acesso || '—')} · prot ${ffdEsc(d.protocolo || '—')}</li>`
      ).join('')}</ul></div>`;
  } else if ((r.rejeitados || 0) > 0) {
    res.innerHTML = `<div class="alert alert-warning"><strong>⚠ DOCUMENTO REJEITADO / PARCIAL</strong>
      <div class="small">${r.autorizados || 0} autorizados · ${r.rejeitados || 0} rejeitados</div>
      <ul class="small mb-0 mt-2">${docs.filter((d) => d.status === 'REJEITADO').map((d) =>
        `<li>Documento ${String(d.sequencia).padStart(3, '0')}<br>Código: ${ffdEsc(d.cstat || '—')}<br>Motivo: ${ffdEsc(d.xmotivo || '—')}</li>`
      ).join('')}</ul></div>`;
  } else {
    res.innerHTML = `<div class="alert alert-info">${ffdEsc(body.mensagem || 'Transmissão com pendências.')}
      <div class="small">${r.autorizados || 0} autorizados · ${r.erros || 0} erros</div></div>`;
  }
}

function ffdRenderChecklist(checklist, erros) {
  const el = document.getElementById('ffdChecklist');
  const errEl = document.getElementById('ffdErrosValidacao');
  if (!el) return;
  if (!checklist || !checklist.length) {
    el.innerHTML = '<span class="text-muted">Após a prévia perfeita, execute a validação fiscal.</span>';
  } else {
    el.innerHTML = `<ul class="list-unstyled mb-0">${checklist.map((c) =>
      `<li>${c.ok ? '✓' : '⚠'} ${ffdEsc(c.label)}</li>`
    ).join('')}</ul>`;
  }
  if (errEl) {
    if (erros && erros.length) {
      errEl.innerHTML = `<div class="alert alert-warning"><pre class="mb-0 small" style="white-space:pre-wrap">${ffdEsc(
        erros.map((e, i) => e.produto_nome
          ? `${i + 1}. Produto "${e.produto_nome}"\n   ${e.mensagem}`
          : `${i + 1}. ${e.mensagem}`
        ).join('\n\n')
      )}</pre></div>`;
    } else if (__ffdEstado.statusFiscal === 'PRONTO_EMISSAO') {
      errEl.innerHTML = `<div class="alert alert-success mb-0"><strong>✓ Documento pronto para emissão</strong>
        <div class="small">${(__ffdEstado.documentos || []).length} documentos fiscais preparados · Total ${ffdFmtMoney(__ffdEstado.previa?.valor_distribuido)}</div></div>`;
    } else {
      errEl.innerHTML = '';
    }
  }
}

async function ffdValidarFiscal() {
  try {
    const id = await ffdGarantirRascunho();
    $('#ffdValStatus').text('VALIDANDO...');
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${id}/validar`, {
      method: 'POST', headers: ffdHeaders(), body: JSON.stringify({})
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok && !body.validacao) throw new Error(body.error || `HTTP ${resp.status}`);
    __ffdEstado.validacao = body.validacao || body;
    ffdRenderChecklist(body.validacao?.checklist || body.checklist, body.validacao?.erros || body.erros);
    if (body.ok || body.validacao?.ok) {
      ffdNotify('Validação fiscal OK.', 'success');
      $('#ffdValStatus').text('VALIDADO');
    } else {
      ffdNotify('Pendências fiscais encontradas.', 'warning');
      $('#ffdValStatus').text('ERRO');
      $('#ffdBtnCorrigir').prop('disabled', false);
    }
  } catch (err) {
    ffdNotify(err.message || 'Falha na validação fiscal.', 'danger');
    $('#ffdValStatus').text('ERRO');
  }
}

async function ffdPrepararEmissao() {
  try {
    const id = await ffdGarantirRascunho();
    $('#ffdValStatus').text('VALIDANDO...');
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${id}/preparar-emissao`, {
      method: 'POST',
      headers: ffdHeaders(),
      body: JSON.stringify({ gerarXml: true })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      __ffdEstado.validacao = body.validacao || null;
      ffdRenderChecklist(body.checklist || body.validacao?.checklist, body.erros || body.validacao?.erros);
      throw new Error(body.error || `HTTP ${resp.status}`);
    }
    __ffdEstado.documentos = body.documentos || [];
    __ffdEstado.validacao = body.validacao || null;
    __ffdEstado.statusFiscal = body.status || 'PRONTO_EMISSAO';
    ffdRenderChecklist(body.validacao?.checklist, body.validacao?.erros);
    ffdAtualizarBotoesEtapa5(__ffdEstado.previa);
    $('#ffdValAmbiente').text(Number(body.ambiente) === 1 ? 'Produção' : 'Homologação');
    $('#ffdValDocs').text(String((__ffdEstado.documentos || []).length));
    $('#ffdValStatus').text(__ffdEstado.statusFiscal);
    ffdNotify(body.mensagem || 'Documento pronto para emissão.', 'success');
  } catch (err) {
    ffdNotify(err.message || 'Falha ao preparar emissão.', 'danger');
    $('#ffdValStatus').text('ERRO');
  }
}

function ffdToggleXml() {
  const box = document.getElementById('ffdXmlPreview');
  const ta = document.getElementById('ffdXmlText');
  if (!box || !ta) return;
  const doc = (__ffdEstado.documentos || []).find((d) => d.xml_preparado);
  if (!doc) {
    ffdNotify('Nenhum XML preparado ainda.', 'warning');
    return;
  }
  ta.value = doc.xml_preparado;
  box.classList.toggle('d-none');
}

function ffdCorrigirPendencias() {
  ffdNotify('Corrija NCM/CFOP/CSOSN no cadastro do produto e execute novamente a validação. O fechamento não altera o cadastro automaticamente.', 'info');
}

async function ffdGarantirRascunho() {
  if (__ffdEstado.fechamentoId) return __ffdEstado.fechamentoId;
  const data = String($('#ffdData').val() || ffdHojeISO());
  const resp = await fetch(`${ffdApi()}/fiscal/fechamentos`, {
    method: 'POST',
    headers: ffdHeaders(),
    body: JSON.stringify({
      data_fechamento: data,
      valor_alvo: Number($('#ffdValorAlvo').val() || 250),
      valor_min: Number($('#ffdValorMin').val() || 80),
      valor_max: Number($('#ffdValorMax').val() || 400),
      distribuicao_automatica: $('#ffdAuto').is(':checked')
    })
  });
  const body = await resp.json().catch(() => ({}));
  if (resp.status === 409 && body.fechamento) {
    __ffdEstado.fechamentoId = body.fechamento.id;
    ffdNotify(body.error || 'Já existe um fechamento fiscal para esta data.', 'warning');
    return __ffdEstado.fechamentoId;
  }
  if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
  __ffdEstado.fechamentoId = body.id;
  return body.id;
}

async function ffdSincronizarRecebimentos(fechamentoId) {
  const detResp = await fetch(`${ffdApi()}/fiscal/fechamentos/${fechamentoId}`, { headers: ffdHeaders() });
  const det = await detResp.json().catch(() => ({}));
  for (const r of det.recebimentos || []) {
    await fetch(`${ffdApi()}/fiscal/fechamentos/${fechamentoId}/recebimentos/${r.id}`, {
      method: 'DELETE', headers: ffdHeaders()
    });
  }
  for (const r of __ffdEstado.recebimentos) {
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${fechamentoId}/recebimentos`, {
      method: 'POST', headers: ffdHeaders(), body: JSON.stringify(r)
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || 'Falha ao salvar recebimento');
  }
}

async function ffdSalvarRascunho() {
  try {
    const id = await ffdGarantirRascunho();
    await ffdSincronizarRecebimentos(id);
    ffdNotify('Rascunho salvo.', 'success');
    await ffdCarregarDia();
  } catch (err) {
    ffdNotify(err.message || 'Falha ao salvar rascunho.', 'danger');
  }
}

async function ffdAtualizarPrevia() {
  try {
    const total = Math.round(ffdTotalRecebimentos() * 100) / 100;
    if (!(total > 0)) {
      ffdRenderPrevia({
        vendas: [],
        valor_informado: 0,
        valor_distribuido: 0,
        diferenca: 0,
        quantidade_vendas: 0,
        perfeita: false,
        incompleta: false,
        codigo: 'VALOR_ZERO',
        mensagem: 'Informe um valor recebido nas máquinas para gerar a prévia.'
      });
      return;
    }
    const id = await ffdGarantirRascunho();
    await ffdSincronizarRecebimentos(id);
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${id}/previa`, {
      method: 'POST',
      headers: ffdHeaders(),
      body: JSON.stringify({
        valor_informado: total,
        valor_alvo: Number($('#ffdValorAlvo').val() || 250),
        valor_min: Number($('#ffdValorMin').val() || 80),
        valor_max: Number($('#ffdValorMax').val() || 400)
      })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    __ffdEstado.indicadores = body.indicadores;
    ffdRenderPrevia(body.previa);
    if (body.previa?.perfeita) {
      ffdNotify('Prévia atualizada — distribuição concluída.', 'success');
      $('#ffdBtnValidar, #ffdBtnGerarXml, #ffdBtnPreparar').prop('disabled', false);
    } else ffdNotify(body.previa?.mensagem || 'Prévia atualizada.', 'warning');
  } catch (err) {
    ffdNotify(err.message || 'Falha ao atualizar prévia.', 'danger');
  }
}

async function ffdCancelar() {
  if (!__ffdEstado.fechamentoId) {
    ffdNotify('Nenhum fechamento para cancelar.', 'info');
    return;
  }
  const ok = await ffdConfirm('Cancelar o fechamento fiscal desta data?');
  if (!ok) return;
  try {
    const resp = await fetch(`${ffdApi()}/fiscal/fechamentos/${__ffdEstado.fechamentoId}/cancelar`, {
      method: 'POST', headers: ffdHeaders()
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    __ffdEstado.fechamentoId = null;
    __ffdEstado.recebimentos = [];
    __ffdEstado.previa = null;
    ffdRenderMaquinas();
    ffdRenderPrevia(null);
    document.getElementById('ffdPreviaConteudo').innerHTML = '<span class="text-muted">Atualize a prévia para visualizar a composição.</span>';
    ffdNotify('Fechamento cancelado.', 'success');
  } catch (err) {
    ffdNotify(err.message || 'Falha ao cancelar.', 'danger');
  }
}

window.loadFechamentoFiscalDoDia = loadFechamentoFiscalDoDia;
window.ffdPararPolling = ffdPararPolling;
