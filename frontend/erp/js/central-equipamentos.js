/**
 * RC3.0 — Central de Equipamentos
 * Consome exclusivamente /api/central-equipamentos/*
 */

let centralEqCache = [];
let centralEqDashboard = null;
let centralEqFiltros = {
  transporte: 'todos',
  status: '',
  busca: '',
  fabricante: '',
  driver: '',
  conhecidos: '',
  novos: '',
  online: '',
  offline: ''
};

function centralEqApi() {
  return (typeof API_URL === 'string' && API_URL.trim() !== '') ? API_URL : `${window.location.origin}/api`;
}

function centralEqHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function escapeHtmlCentralEq(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatarDataCentralEq(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('pt-BR'); } catch (_) { return iso; }
}

function badgeStatusCentral(status, rotulo) {
  const mapa = {
    ONLINE: 'success',
    OFFLINE: 'secondary',
    DESCONHECIDO: 'warning text-dark',
    NUNCA_VISTO: 'info text-dark',
    ALTEROU_IP: 'warning text-dark',
    ALTEROU_FIRMWARE: 'info text-dark',
    SINCRONIZANDO: 'primary',
    ERRO: 'danger'
  };
  const cls = mapa[status] || 'secondary';
  return `<span class="badge bg-${cls}">${escapeHtmlCentralEq(rotulo || status || '—')}</span>`;
}

function badgeHealthCentral(score) {
  const n = Number(score || 0);
  const cls = n >= 80 ? 'success' : (n >= 60 ? 'warning text-dark' : 'danger');
  return `<span class="badge bg-${cls}">${n}</span>`;
}

async function centralEqFetch(path, options = {}) {
  const resp = await fetch(`${centralEqApi()}/central-equipamentos${path}`, {
    ...options,
    headers: { ...centralEqHeaders(), ...(options.headers || {}) }
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
  return body;
}

function loadCentralEquipamentos() {
  $('#page-content').html('<div class="text-center p-5"><div class="spinner-border text-primary"></div><p class="mt-2">Carregando Central de Equipamentos...</p></div>');
  Promise.all([
    centralEqFetch('/dashboard'),
    centralEqFetch(`/lista?${montarQueryCentralEq()}`)
  ])
    .then(([dash, lista]) => {
      centralEqDashboard = dash.dashboard || {};
      centralEqCache = lista.itens || [];
      renderCentralEquipamentos();
    })
    .catch((err) => {
      $('#page-content').html(`<div class="alert alert-danger m-3">${escapeHtmlCentralEq(err.message)}</div>`);
    });
}

function montarQueryCentralEq() {
  const p = new URLSearchParams();
  if (centralEqFiltros.transporte && centralEqFiltros.transporte !== 'todos') {
    p.set('transporte', centralEqFiltros.transporte);
  }
  if (centralEqFiltros.status) p.set('status', centralEqFiltros.status);
  if (centralEqFiltros.busca) p.set('busca', centralEqFiltros.busca);
  if (centralEqFiltros.fabricante) p.set('fabricante', centralEqFiltros.fabricante);
  if (centralEqFiltros.driver) p.set('driver', centralEqFiltros.driver);
  if (centralEqFiltros.conhecidos) p.set('conhecidos', '1');
  if (centralEqFiltros.novos) p.set('novos', '1');
  if (centralEqFiltros.online) p.set('online', '1');
  if (centralEqFiltros.offline) p.set('offline', '1');
  return p.toString();
}

function cardDash(label, valor, extraClass = '') {
  return `
    <div class="col-6 col-md-3 col-xl-2 mb-2">
      <div class="card ${extraClass}">
        <div class="card-body py-2">
          <small class="text-muted">${label}</small>
          <div class="h4 mb-0">${Number(valor || 0)}</div>
        </div>
      </div>
    </div>`;
}

function renderCentralEquipamentos() {
  const d = centralEqDashboard || {};
  const html = `
    <div class="container-fluid py-3">
      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div>
          <nav aria-label="breadcrumb"><ol class="breadcrumb mb-1">
            <li class="breadcrumb-item"><a href="#" onclick="loadPage('configuracoes');return false;">Configurações</a></li>
            <li class="breadcrumb-item active">Central de Equipamentos</li>
          </ol></nav>
          <h2 class="h4 mb-1"><i class="fas fa-network-wired me-2"></i>Central de Equipamentos</h2>
          <p class="text-muted mb-0">Painel oficial de equipamentos cadastrados e descobertos.</p>
        </div>
        <div class="d-flex flex-wrap gap-2">
          <button class="btn btn-success" id="btnCentralEqProcurar" onclick="centralEqProcurarEquipamentos()">
            🔍 Procurar Equipamentos
          </button>
          <button class="btn btn-outline-success" onclick="centralEqDescobrir()"><i class="fas fa-search-location"></i> Discovery completo</button>
          <button class="btn btn-outline-dark" onclick="centralEqMostrarProtocolo()"><i class="fas fa-code"></i> Protocolo</button>
          <button class="btn btn-outline-info" onclick="centralEqMostrarLab()"><i class="fas fa-flask"></i> Laboratório</button>
          <button class="btn btn-outline-primary" onclick="centralEqMostrarOps()"><i class="fas fa-bolt"></i> Operações</button>
          <button class="btn btn-outline-success" onclick="centralEqMostrarOrquestrador()"><i class="fas fa-sitemap"></i> Central de Balanças</button>
          <button class="btn btn-outline-dark" onclick="centralEqMostrarDriversSdk()"><i class="fas fa-puzzle-piece"></i> Drivers Instalados</button>
          <button class="btn btn-outline-warning" onclick="centralEqMostrarPlu()"><i class="fas fa-sync"></i> Sincronização PLUs</button>
          <button class="btn btn-outline-dark" onclick="centralEqMostrarSync()"><i class="fas fa-exchange-alt"></i> Sincronização</button>
          <button class="btn btn-outline-info" onclick="centralEqMostrarPeso()"><i class="fas fa-balance-scale"></i> Pesagem</button>
          <button class="btn btn-outline-success" onclick="centralEqMostrarMonitor()"><i class="fas fa-heartbeat"></i> Monitor</button>
          <button class="btn btn-outline-primary" onclick="centralEqMostrarObservabilidade()"><i class="fas fa-chart-line"></i> Observabilidade</button>
          <button class="btn btn-outline-secondary" onclick="centralEqMostrarConfig()"><i class="fas fa-sliders-h"></i> Configuração</button>
          <button class="btn btn-outline-dark" onclick="centralEqMostrarDiag()"><i class="fas fa-stethoscope"></i> Diagnóstico</button>
          <button class="btn btn-outline-secondary" onclick="loadPage('equipamentos')"><i class="fas fa-cog"></i> Cadastro</button>
          <button class="btn btn-primary" onclick="loadCentralEquipamentos()"><i class="fas fa-sync"></i> Atualizar</button>
        </div>
      </div>

      <div class="card mb-3 border-success" id="centralEqDiscoveryPainel" style="display:none;">
        <div class="card-header bg-success text-white d-flex justify-content-between align-items-center">
          <strong>Discovery Engine — USB · Serial · Ethernet</strong>
          <button type="button" class="btn btn-sm btn-outline-light" onclick="document.getElementById('centralEqDiscoveryPainel').style.display='none'">Fechar</button>
        </div>
        <div class="card-body">
          <div class="mb-2">
            <div class="form-check form-check-inline">
              <input class="form-check-input" type="checkbox" id="centralEqDiscUsb" checked>
              <label class="form-check-label" for="centralEqDiscUsb">USB</label>
            </div>
            <div class="form-check form-check-inline">
              <input class="form-check-input" type="checkbox" id="centralEqDiscSerial" checked>
              <label class="form-check-label" for="centralEqDiscSerial">Serial</label>
            </div>
            <div class="form-check form-check-inline">
              <input class="form-check-input" type="checkbox" id="centralEqDiscEthernet" checked>
              <label class="form-check-label" for="centralEqDiscEthernet">Ethernet</label>
            </div>
          </div>
          <div id="centralEqDiscoveryStatus" class="mb-2 fw-semibold">Escaneando rede...</div>
          <div class="progress mb-2" style="height:18px;">
            <div id="centralEqDiscoveryBar" class="progress-bar progress-bar-striped progress-bar-animated bg-success"
              role="progressbar" style="width:0%">0%</div>
          </div>
          <div id="centralEqDiscoveryStats" class="small text-muted mb-2"></div>
          <div class="table-responsive mb-3" id="centralEqDiscoveryTabelaWrap" style="display:none;">
            <table class="table table-sm table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Transporte</th>
                  <th>Endpoint</th>
                  <th>IP</th>
                  <th>Porta</th>
                  <th>Driver</th>
                  <th>Confiança</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="centralEqDiscoveryTabela"></tbody>
            </table>
          </div>
          <div id="centralEqDiscoveryResultados" class="row g-3"></div>
        </div>
      </div>

      <div class="card mb-3 border-warning" id="centralEqPluPainel" style="display:none;">
        <div class="card-header bg-warning d-flex justify-content-between align-items-center">
          <strong><i class="fas fa-sync me-1"></i> Sincronização PLUs V1.0</strong>
          <button type="button" class="btn btn-sm btn-outline-dark" onclick="document.getElementById('centralEqPluPainel').style.display='none'">Fechar</button>
        </div>
        <div class="card-body">
          <div class="row g-2 mb-3">
            <div class="col-md-3">
              <label class="form-label small mb-1">Host</label>
              <input type="text" class="form-control form-control-sm" id="pluHost" placeholder="10.0.0.170">
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-1">Porta</label>
              <input type="number" class="form-control form-control-sm" id="pluPorta" value="9000">
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-1">PLU</label>
              <input type="text" class="form-control form-control-sm" id="pluCodigo" placeholder="1001">
            </div>
            <div class="col-md-3">
              <label class="form-label small mb-1">Descrição</label>
              <input type="text" class="form-control form-control-sm" id="pluDesc" placeholder="Produto">
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-1">Preço</label>
              <input type="number" step="0.01" class="form-control form-control-sm" id="pluPreco" placeholder="0.00">
            </div>
          </div>
          <div class="d-flex flex-wrap gap-2 mb-3">
            <button class="btn btn-sm btn-success" onclick="centralEqPluEnviar()">Enviar</button>
            <button class="btn btn-sm btn-primary" onclick="centralEqPluEnviarTodos()">Enviar Todos</button>
            <button class="btn btn-sm btn-outline-danger" onclick="centralEqPluCancelar()">Cancelar</button>
            <button class="btn btn-sm btn-outline-secondary" onclick="centralEqPluHistorico()">Atualizar</button>
          </div>
          <div class="mb-3" id="pluProgressWrap" style="display:none;">
            <div class="d-flex justify-content-between small mb-1">
              <span id="pluProgressLabel">Enviando...</span>
              <span id="pluProgressCount">0 / 0</span>
            </div>
            <div class="progress" style="height:18px;">
              <div id="pluProgressBar" class="progress-bar progress-bar-striped progress-bar-animated bg-warning text-dark"
                style="width:0%">0%</div>
            </div>
          </div>
          <div class="table-responsive" style="max-height:300px;overflow:auto;">
            <table class="table table-sm table-hover mb-0">
              <thead class="table-light sticky-top">
                <tr>
                  <th>Produto</th><th>PLU</th><th>Status</th><th>Enviado</th><th>Confirmado</th><th>Erro</th>
                </tr>
              </thead>
              <tbody id="centralEqPluHistBody">
                <tr><td colspan="6" class="text-muted">Sem sincronizações.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card mb-3 border-success" id="centralEqOrqPainel" style="display:none;">
        <div class="card-header bg-success text-white d-flex justify-content-between align-items-center">
          <strong><i class="fas fa-sitemap me-1"></i> CENTRAL DE BALANÇAS</strong>
          <button type="button" class="btn btn-sm btn-outline-light" onclick="document.getElementById('centralEqOrqPainel').style.display='none';centralEqOrqStopPoll()">Fechar</button>
        </div>
        <div class="card-body">
          <div class="row g-2 mb-3 small" id="centralEqOrqCards">
            <div class="col"><div class="border rounded p-2 text-center"><div class="text-muted">Balanças</div><div class="fw-bold fs-5" id="orqQtd">—</div></div></div>
            <div class="col"><div class="border rounded p-2 text-center"><div class="text-muted">Online</div><div class="fw-bold fs-5 text-success" id="orqOnline">—</div></div></div>
            <div class="col"><div class="border rounded p-2 text-center"><div class="text-muted">Offline</div><div class="fw-bold fs-5 text-danger" id="orqOffline">—</div></div></div>
            <div class="col"><div class="border rounded p-2 text-center"><div class="text-muted">Sincronizando</div><div class="fw-bold fs-5 text-primary" id="orqSync">—</div></div></div>
            <div class="col"><div class="border rounded p-2 text-center"><div class="text-muted">Erro</div><div class="fw-bold fs-5 text-warning" id="orqErro">—</div></div></div>
            <div class="col"><div class="border rounded p-2 text-center"><div class="text-muted">Fila</div><div class="fw-bold fs-5" id="orqFila">—</div></div></div>
            <div class="col"><div class="border rounded p-2 text-center"><div class="text-muted">Tempo médio</div><div class="fw-bold fs-5" id="orqTempo">—</div></div></div>
          </div>
          <div class="d-flex flex-wrap gap-2 mb-3">
            <button class="btn btn-sm btn-outline-success" onclick="centralEqOrqRefresh()"><i class="fas fa-sync"></i> Atualizar</button>
            <button class="btn btn-sm btn-primary" onclick="centralEqOrqSyncTodas('SYNC_DELTA')"><i class="fas fa-bolt"></i> Delta em todas</button>
            <button class="btn btn-sm btn-outline-primary" onclick="centralEqOrqSyncTodas('SYNC_INCREMENTAL')"><i class="fas fa-exchange-alt"></i> Incremental todas</button>
            <button class="btn btn-sm btn-outline-dark" onclick="centralEqOrqHealth()"><i class="fas fa-heartbeat"></i> Health Check</button>
            <button class="btn btn-sm btn-outline-secondary" onclick="centralEqOrqAgendar()"><i class="fas fa-clock"></i> Agendar diário 03:00</button>
          </div>
          <div class="row g-3">
            <div class="col-lg-9">
              <div class="table-responsive" style="max-height:420px;overflow:auto;">
                <table class="table table-sm table-hover mb-0">
                  <thead class="table-light sticky-top">
                    <tr>
                      <th>Nome</th>
                      <th>IP</th>
                      <th>Status</th>
                      <th>Firmware</th>
                      <th>Carga</th>
                      <th>Última Sync</th>
                      <th>Tempo</th>
                      <th>Fila</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody id="centralEqOrqBody">
                    <tr><td colspan="9" class="text-muted">Carregue o dashboard.</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="col-lg-3">
              <div class="border rounded p-2 small">
                <div class="fw-semibold mb-2">Notificações</div>
                <div id="centralEqOrqNotifs" class="text-muted">—</div>
              </div>
              <div class="border rounded p-2 small mt-2">
                <div class="fw-semibold mb-1">Última sincronização</div>
                <div id="orqUltimaSync">—</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card mb-3 border-dark" id="centralEqDriversSdkPainel" style="display:none;">
        <div class="card-header bg-dark text-white d-flex justify-content-between align-items-center">
          <strong><i class="fas fa-puzzle-piece me-1"></i> DRIVERS INSTALADOS — Device Profile SDK</strong>
          <button type="button" class="btn btn-sm btn-outline-light" onclick="document.getElementById('centralEqDriversSdkPainel').style.display='none'">Fechar</button>
        </div>
        <div class="card-body">
          <div class="d-flex flex-wrap gap-2 mb-3">
            <button class="btn btn-sm btn-outline-primary" onclick="centralEqDriversSdkRefresh()"><i class="fas fa-sync"></i> Atualizar</button>
            <button class="btn btn-sm btn-outline-warning" onclick="centralEqDriversSdkReload()"><i class="fas fa-redo"></i> Reload manifests</button>
            <button class="btn btn-sm btn-outline-info" onclick="centralEqDriversSdkLab()"><i class="fas fa-flask"></i> Lab SDK</button>
          </div>
          <div id="centralEqDriversSdkMeta" class="small text-muted mb-2">—</div>
          <div class="table-responsive">
            <table class="table table-sm table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Fabricante</th>
                  <th>Modelo</th>
                  <th>Versão</th>
                  <th>Categoria</th>
                  <th>Capabilities</th>
                  <th>Estado</th>
                  <th>Equipamentos</th>
                </tr>
              </thead>
              <tbody id="centralEqDriversSdkBody">
                <tr><td colspan="7" class="text-muted">Carregando…</td></tr>
              </tbody>
            </table>
          </div>
          <pre id="centralEqDriversSdkLabOut" class="small bg-light border rounded p-2 mt-3 mb-0" style="display:none;max-height:220px;overflow:auto;"></pre>
        </div>
      </div>

      <div class="card mb-3 border-dark" id="centralEqSyncPainel" style="display:none;">
        <div class="card-header bg-dark text-white d-flex justify-content-between align-items-center">
          <strong><i class="fas fa-exchange-alt me-1"></i> SINCRONIZAÇÃO Toledo 90AX</strong>
          <button type="button" class="btn btn-sm btn-outline-light" onclick="document.getElementById('centralEqSyncPainel').style.display='none'">Fechar</button>
        </div>
        <div class="card-body">
          <div class="row g-2 mb-3">
            <div class="col-md-3">
              <label class="form-label small mb-1">Host</label>
              <input type="text" class="form-control form-control-sm" id="syncHost" placeholder="10.0.0.170">
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-1">Porta</label>
              <input type="number" class="form-control form-control-sm" id="syncPorta" value="9000">
            </div>
            <div class="col-md-7 d-flex align-items-end gap-2 flex-wrap">
              <button class="btn btn-sm btn-success" onclick="centralEqSyncTudo()"><i class="fas fa-cloud-upload-alt"></i> Sincronizar Tudo</button>
              <button class="btn btn-sm btn-primary" onclick="centralEqSyncAlteracoes()"><i class="fas fa-sync"></i> Sincronizar Alterações</button>
              <button class="btn btn-sm btn-warning" onclick="centralEqSyncDelta()"><i class="fas fa-bolt"></i> Delta Sync</button>
              <button class="btn btn-sm btn-outline-info" onclick="centralEqSyncVerAlteracoes()">Alterações</button>
              <button class="btn btn-sm btn-outline-dark" onclick="centralEqSyncVerVersoes()">Versões</button>
              <button class="btn btn-sm btn-outline-danger" onclick="centralEqSyncCancelar()">Cancelar</button>
              <button class="btn btn-sm btn-outline-secondary" onclick="centralEqSyncExportar()">Exportar</button>
            </div>
          </div>
          <div class="row g-2 mb-3 small">
            <div class="col-md-2"><div class="border rounded p-2"><div class="text-muted">Status</div><div id="syncStatStatus" class="fw-semibold">—</div></div></div>
            <div class="col-md-2"><div class="border rounded p-2"><div class="text-muted">Modo</div><div id="syncStatModo" class="fw-semibold">—</div></div></div>
            <div class="col-md-2"><div class="border rounded p-2"><div class="text-muted">Versão</div><div id="syncStatVersao" class="fw-semibold">—</div></div></div>
            <div class="col-md-3"><div class="border rounded p-2"><div class="text-muted">Hash</div><div id="syncStatHash" class="fw-semibold text-truncate">—</div></div></div>
            <div class="col-md-3"><div class="border rounded p-2"><div class="text-muted">Pendentes / Delta</div><div id="syncStatPendentes" class="fw-semibold">—</div></div></div>
          </div>
          <ul class="nav nav-tabs mb-2" id="syncTabs">
            <li class="nav-item"><button class="nav-link active" type="button" onclick="centralEqSyncAba('carga')">Carga</button></li>
            <li class="nav-item"><button class="nav-link" type="button" onclick="centralEqSyncAba('alteracoes')">ALTERAÇÕES</button></li>
            <li class="nav-item"><button class="nav-link" type="button" onclick="centralEqSyncAba('versoes')">VERSÕES</button></li>
          </ul>
          <div id="syncAbaCarga">
          <div class="mb-2 small">
            <span class="me-3">🟢 Igual</span>
            <span class="me-3">🟡 Alterado</span>
            <span class="me-3">🔵 Novo</span>
            <span class="me-3">🔴 Removido</span>
            <button class="btn btn-sm btn-link p-0 ms-2" onclick="centralEqSyncBaixar()">Baixar balança</button>
            <button class="btn btn-sm btn-link p-0 ms-2" onclick="centralEqSyncComparar()">Comparar</button>
            <button class="btn btn-sm btn-link p-0 ms-2" onclick="centralEqSyncRollback()">Restaurar</button>
          </div>
          <div class="mb-3" id="syncProgressWrap" style="display:none;">
            <div class="d-flex justify-content-between small mb-1">
              <span id="syncProgressLabel">Sincronizando...</span>
              <span id="syncProgressCount">0%</span>
            </div>
            <div class="progress" style="height:18px;">
              <div id="syncProgressBar" class="progress-bar progress-bar-striped progress-bar-animated bg-dark"
                style="width:0%">0%</div>
            </div>
            <div class="d-flex justify-content-between small text-muted mt-1">
              <span id="syncProgressLote">Lote —</span>
              <span id="syncProgressEta">ETA —</span>
              <span id="syncProgressVel">— it/s</span>
            </div>
          </div>
          <div id="syncRelatorioBox" class="alert alert-secondary py-2 small mb-3" style="display:none;"></div>
          <div class="table-responsive" style="max-height:340px;overflow:auto;">
            <table class="table table-sm table-hover mb-0">
              <thead class="table-light sticky-top">
                <tr>
                  <th>PLU</th>
                  <th>Descrição CDS</th>
                  <th>Descrição Balança</th>
                  <th>Situação</th>
                  <th>Ação</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody id="centralEqSyncBody">
                <tr><td colspan="6" class="text-muted">Use Sincronizar Tudo / Alterações / Delta ou baixe e compare.</td></tr>
              </tbody>
            </table>
          </div>
          </div>
          <div id="syncAbaAlteracoes" style="display:none;">
            <div id="syncDeltaResumo" class="alert alert-light border small mb-2">Calcule o delta para ver alterações.</div>
            <div class="table-responsive" style="max-height:300px;overflow:auto;">
              <table class="table table-sm mb-0">
                <thead class="table-light"><tr><th>PLU</th><th>Tipo</th><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead>
                <tbody id="centralEqSyncDeltaBody"><tr><td colspan="5" class="text-muted">Sem delta.</td></tr></tbody>
              </table>
            </div>
          </div>
          <div id="syncAbaVersoes" style="display:none;">
            <div class="d-flex gap-2 mb-2 flex-wrap">
              <button class="btn btn-sm btn-outline-primary" onclick="centralEqSyncVerVersoes()">Atualizar</button>
              <button class="btn btn-sm btn-outline-secondary" onclick="centralEqSyncCompararVersoes()">Comparar</button>
              <button class="btn btn-sm btn-outline-warning" onclick="centralEqSyncRollback()">Restaurar última OK</button>
              <input type="number" class="form-control form-control-sm" style="width:90px" id="syncVerA" placeholder="Ver A">
              <input type="number" class="form-control form-control-sm" style="width:90px" id="syncVerB" placeholder="Ver B">
            </div>
            <div class="table-responsive" style="max-height:300px;overflow:auto;">
              <table class="table table-sm mb-0">
                <thead class="table-light"><tr><th>Versão</th><th>Data</th><th>Usuário</th><th>Itens</th><th>Tempo</th><th>Status</th><th>Hash</th><th></th></tr></thead>
                <tbody id="centralEqSyncVersoesBody"><tr><td colspan="8" class="text-muted">Sem versões.</td></tr></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="card mb-3 border-info" id="centralEqPesoPainel" style="display:none;">
        <div class="card-header bg-info text-white d-flex justify-content-between align-items-center">
          <strong><i class="fas fa-balance-scale me-1"></i> Pesagem V1.0</strong>
          <button type="button" class="btn btn-sm btn-outline-light" onclick="document.getElementById('centralEqPesoPainel').style.display='none'">Fechar</button>
        </div>
        <div class="card-body">
          <div class="row g-2 mb-3">
            <div class="col-md-4">
              <label class="form-label small mb-1">Host</label>
              <input type="text" class="form-control form-control-sm" id="pesoHost" placeholder="10.0.0.170">
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-1">Porta</label>
              <input type="number" class="form-control form-control-sm" id="pesoPorta" value="9000">
            </div>
            <div class="col-md-6 d-flex align-items-end gap-2">
              <button class="btn btn-sm btn-primary" onclick="centralEqPesoLer()">Ler Peso</button>
              <button class="btn btn-sm btn-outline-secondary" onclick="centralEqPesoHistorico()">Histórico</button>
            </div>
          </div>
          <div class="row g-3 mb-3">
            <div class="col-md-4">
              <div class="border rounded p-3 text-center">
                <div class="text-muted small">Peso Atual</div>
                <div id="pesoValor" class="display-6 fw-bold">—</div>
                <div id="pesoUnidade" class="text-muted">kg</div>
              </div>
            </div>
            <div class="col-md-4">
              <div class="border rounded p-3 text-center">
                <div class="text-muted small">Status</div>
                <div id="pesoEstavel" class="fs-4 fw-semibold">—</div>
              </div>
            </div>
            <div class="col-md-4">
              <div class="border rounded p-3 text-center">
                <div class="text-muted small">Última leitura</div>
                <div id="pesoHora" class="fs-5 fw-semibold">—</div>
              </div>
            </div>
          </div>
          <div class="table-responsive" style="max-height:240px;overflow:auto;">
            <table class="table table-sm table-hover mb-0">
              <thead class="table-light sticky-top">
                <tr><th>Peso</th><th>Unidade</th><th>Estável</th><th>Lido em</th><th>ms</th><th>Erro</th></tr>
              </thead>
              <tbody id="centralEqPesoHistBody">
                <tr><td colspan="6" class="text-muted">Sem pesagens.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card mb-3 border-success" id="centralEqMonitorPainel" style="display:none;">
        <div class="card-header bg-success text-white d-flex justify-content-between align-items-center">
          <strong><i class="fas fa-heartbeat me-1"></i> Monitor de Equipamentos V1.0</strong>
          <button type="button" class="btn btn-sm btn-outline-light" onclick="centralEqMonitorFechar()">Fechar</button>
        </div>
        <div class="card-body">
          <div class="row g-2 mb-3">
            <div class="col-md-3">
              <label class="form-label small mb-1">Host</label>
              <input type="text" class="form-control form-control-sm" id="monHost" placeholder="10.0.0.170">
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-1">Porta</label>
              <input type="number" class="form-control form-control-sm" id="monPorta" value="9000">
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-1">Intervalo (ms)</label>
              <input type="number" class="form-control form-control-sm" id="monInterval" value="5000">
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-1">Timeout (ms)</label>
              <input type="number" class="form-control form-control-sm" id="monTimeout" value="2000">
            </div>
            <div class="col-md-3 d-flex align-items-end gap-2 flex-wrap">
              <button class="btn btn-sm btn-success" onclick="centralEqMonitorIniciar()">Iniciar</button>
              <button class="btn btn-sm btn-warning" onclick="centralEqMonitorPausar()">Pausar</button>
              <button class="btn btn-sm btn-danger" onclick="centralEqMonitorParar()">Parar</button>
            </div>
          </div>
          <div class="row g-3 mb-3">
            <div class="col-md-2"><div class="border rounded p-2 text-center"><div class="text-muted small">Status</div><div id="monStatus" class="fw-semibold">—</div></div></div>
            <div class="col-md-2"><div class="border rounded p-2 text-center"><div class="text-muted small">Latência</div><div id="monLatencia" class="fw-semibold">—</div></div></div>
            <div class="col-md-2"><div class="border rounded p-2 text-center"><div class="text-muted small">Heartbeat</div><div id="monHeartbeat" class="fw-semibold">—</div></div></div>
            <div class="col-md-3"><div class="border rounded p-2 text-center"><div class="text-muted small">Última verificação</div><div id="monUltima" class="fw-semibold">—</div></div></div>
            <div class="col-md-3"><div class="border rounded p-2 text-center"><div class="text-muted small">Monitor</div><div id="monAtivo" class="fw-semibold">—</div></div></div>
          </div>
          <div class="table-responsive" style="max-height:240px;overflow:auto;">
            <table class="table table-sm table-hover mb-0">
              <thead class="table-light sticky-top">
                <tr><th>Hora</th><th>Status</th><th>Heartbeat</th><th>Latência</th><th>Evento</th></tr>
              </thead>
              <tbody id="centralEqMonHistBody">
                <tr><td colspan="5" class="text-muted">Sem eventos.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card mb-3 border-primary" id="centralEqObsPainel" style="display:none;">
        <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center flex-wrap gap-2">
          <strong><i class="fas fa-chart-line me-1"></i> OBSERVABILIDADE — Telemetria · Alertas · Certificação</strong>
          <button type="button" class="btn btn-sm btn-outline-light" onclick="document.getElementById('centralEqObsPainel').style.display='none'">Fechar</button>
        </div>
        <div class="card-body">
          <ul class="nav nav-tabs mb-3" role="tablist">
            <li class="nav-item"><button type="button" class="nav-link active" id="obsTabDashBtn" onclick="centralEqObsAba('dash')">Dashboard</button></li>
            <li class="nav-item"><button type="button" class="nav-link" id="obsTabCertBtn" onclick="centralEqObsAba('cert')">Certificação</button></li>
            <li class="nav-item"><button type="button" class="nav-link" id="obsTabLabBtn" onclick="centralEqObsAba('lab')">Lab / Eventos</button></li>
          </ul>

          <div id="centralEqObsDash">
            <div class="d-flex flex-wrap gap-2 mb-3">
              <button class="btn btn-sm btn-outline-primary" onclick="centralEqObsRefresh()"><i class="fas fa-sync"></i> Atualizar</button>
            </div>
            <div class="row g-2 mb-3 small" id="centralEqObsCards">
              <div class="col"><div class="border rounded p-2 text-center"><div class="text-muted">Online</div><div class="fw-bold fs-5 text-success" id="obsOnline">—</div></div></div>
              <div class="col"><div class="border rounded p-2 text-center"><div class="text-muted">Offline</div><div class="fw-bold fs-5 text-danger" id="obsOffline">—</div></div></div>
              <div class="col"><div class="border rounded p-2 text-center"><div class="text-muted">Alertas</div><div class="fw-bold fs-5 text-warning" id="obsAlertas">—</div></div></div>
              <div class="col"><div class="border rounded p-2 text-center"><div class="text-muted">Jobs</div><div class="fw-bold fs-5" id="obsJobs">—</div></div></div>
              <div class="col"><div class="border rounded p-2 text-center"><div class="text-muted">Tempo Médio</div><div class="fw-bold fs-5" id="obsTempoMedio">—</div></div></div>
              <div class="col"><div class="border rounded p-2 text-center"><div class="text-muted">Latência</div><div class="fw-bold fs-5" id="obsLatencia">—</div></div></div>
              <div class="col"><div class="border rounded p-2 text-center"><div class="text-muted">Reconexões</div><div class="fw-bold fs-5" id="obsRecon">—</div></div></div>
            </div>
            <div class="row g-3">
              <div class="col-md-6">
                <div class="fw-semibold mb-2">Alertas ativos</div>
                <div id="centralEqObsAlertas" class="small border rounded p-2" style="max-height:200px;overflow:auto;">—</div>
              </div>
              <div class="col-md-6">
                <div class="fw-semibold mb-2">Performance</div>
                <pre id="centralEqObsPerf" class="small bg-light border rounded p-2 mb-0" style="max-height:200px;overflow:auto;">—</pre>
              </div>
            </div>
          </div>

          <div id="centralEqObsCert" style="display:none;">
            <div class="d-flex flex-wrap gap-2 mb-3">
              <input type="text" class="form-control form-control-sm" style="max-width:220px" id="obsCertDriver" value="toledo-prix4" placeholder="driver id">
              <button class="btn btn-sm btn-success" onclick="centralEqObsCertRun()"><i class="fas fa-certificate"></i> Executar Certificação</button>
              <button class="btn btn-sm btn-outline-secondary" onclick="centralEqObsCertReport()"><i class="fas fa-file-alt"></i> Relatório</button>
              <button class="btn btn-sm btn-outline-primary" onclick="centralEqObsCertRunAll()">Certificar todos</button>
            </div>
            <div id="centralEqObsCertResumo" class="mb-2 small">—</div>
            <div class="table-responsive mb-2">
              <table class="table table-sm table-hover mb-0">
                <thead><tr><th>Item</th><th>Status</th><th>Nota/Obs</th></tr></thead>
                <tbody id="centralEqObsCertBody"><tr><td colspan="3" class="text-muted">Execute a certificação.</td></tr></tbody>
              </table>
            </div>
            <pre id="centralEqObsCertMd" class="small bg-light border rounded p-2 mb-0" style="max-height:220px;overflow:auto;display:none;"></pre>
          </div>

          <div id="centralEqObsLab" style="display:none;">
            <div class="d-flex flex-wrap gap-2 mb-2">
              <button class="btn btn-sm btn-outline-info" onclick="centralEqObsLabRefresh()"><i class="fas fa-stream"></i> Timeline / Telemetria</button>
            </div>
            <pre id="centralEqObsLabOut" class="small bg-light border rounded p-2 mb-0" style="max-height:320px;overflow:auto;">—</pre>
          </div>
        </div>
      </div>

      <div class="card mb-3 border-secondary" id="centralEqConfigPainel" style="display:none;">
        <div class="card-header bg-secondary text-white d-flex justify-content-between align-items-center">
          <strong><i class="fas fa-sliders-h me-1"></i> Configuração Toledo V1.0</strong>
          <button type="button" class="btn btn-sm btn-outline-light" onclick="document.getElementById('centralEqConfigPainel').style.display='none'">Fechar</button>
        </div>
        <div class="card-body">
          <div class="row g-2 mb-3">
            <div class="col-md-3">
              <label class="form-label small mb-1">Host</label>
              <input type="text" class="form-control form-control-sm" id="cfgHost" placeholder="10.0.0.170">
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-1">Porta</label>
              <input type="number" class="form-control form-control-sm" id="cfgPorta" value="9000">
            </div>
            <div class="col-md-7 d-flex align-items-end gap-2 flex-wrap">
              <button class="btn btn-sm btn-primary" onclick="centralEqConfigLer()">Ler</button>
              <button class="btn btn-sm btn-info text-white" onclick="centralEqConfigComparar()">Comparar</button>
              <button class="btn btn-sm btn-success" onclick="centralEqConfigAplicar()">Aplicar</button>
              <button class="btn btn-sm btn-warning" onclick="centralEqConfigRestaurar()">Restaurar</button>
              <button class="btn btn-sm btn-outline-secondary" onclick="centralEqConfigExportar()">Exportar Perfil</button>
              <button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById('cfgImportFile').click()">Importar Perfil</button>
              <input type="file" id="cfgImportFile" accept="application/json,.json" style="display:none" onchange="centralEqConfigImportar(event)">
            </div>
          </div>
          <div class="mb-2">
            <label class="form-label small mb-1">Perfil para restaurar (ID)</label>
            <input type="number" class="form-control form-control-sm" id="cfgProfileId" placeholder="ID do perfil">
          </div>
          <div class="table-responsive" style="max-height:360px;overflow:auto;">
            <table class="table table-sm table-hover mb-0">
              <thead class="table-light sticky-top">
                <tr>
                  <th>Parâmetro</th>
                  <th>Valor Atual</th>
                  <th>Valor Novo</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody id="centralEqConfigBody">
                <tr><td colspan="4" class="text-muted">Leia a configuração da balança.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card mb-3 border-dark central-eq-diag-enterprise" id="centralEqDiagPainel" style="display:none;">
        <div class="card-header bg-dark text-white d-flex flex-wrap justify-content-between align-items-center gap-2">
          <strong><i class="fas fa-stethoscope me-1"></i> Painel de Diagnóstico Enterprise V1.0</strong>
          <button type="button" class="btn btn-sm btn-outline-light" onclick="document.getElementById('centralEqDiagPainel').style.display='none'">Fechar</button>
        </div>
        <div class="card-body">
          <div class="row g-2 mb-3 align-items-end">
            <div class="col-md-3 col-sm-6">
              <label class="form-label small mb-1">Host</label>
              <input type="text" class="form-control form-control-sm" id="diagHost" placeholder="10.0.0.170">
            </div>
            <div class="col-md-2 col-sm-6">
              <label class="form-label small mb-1">Porta</label>
              <input type="number" class="form-control form-control-sm" id="diagPorta" value="9000">
            </div>
            <div class="col-md-7 col-12 d-flex flex-wrap gap-2">
              <button type="button" class="btn btn-sm btn-primary" onclick="centralEqDiagAtualizar()"><i class="fas fa-sync-alt me-1"></i>Atualizar Diagnóstico</button>
              <div class="btn-group btn-group-sm">
                <button type="button" class="btn btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false">
                  <i class="fas fa-file-export me-1"></i>Exportar Diagnóstico
                </button>
                <ul class="dropdown-menu">
                  <li><a class="dropdown-item" href="#" onclick="centralEqDiagExportar('json'); return false;">JSON</a></li>
                  <li><a class="dropdown-item" href="#" onclick="centralEqDiagExportar('txt'); return false;">TXT</a></li>
                  <li><a class="dropdown-item disabled" href="#" title="Em breve">PDF (futuro)</a></li>
                </ul>
              </div>
            </div>
          </div>

          <div id="centralEqDiagOffline" class="alert alert-warning py-2 d-none" role="alert"></div>

          <div class="central-eq-diag-grid" id="centralEqDiagCards">
            <section class="central-eq-diag-card" data-diag-card="identificacao">
              <h3 class="central-eq-diag-card__title">Identificação do Equipamento</h3>
              <dl class="central-eq-diag-dl">
                <div><dt>Fabricante</dt><dd id="diagFabricante">Não informado</dd></div>
                <div><dt>Modelo</dt><dd id="diagModelo">Não informado</dd></div>
                <div><dt>Firmware</dt><dd id="diagFirmware">Não informado</dd></div>
                <div><dt>Versão do Driver</dt><dd id="diagVersao">Não informado</dd></div>
                <div><dt>Número de Série</dt><dd id="diagSerie">Não informado</dd></div>
                <div><dt>Protocolo</dt><dd id="diagProtocolo">Não informado</dd></div>
                <div><dt>Interface</dt><dd id="diagInterface">Não informado</dd></div>
                <div class="d-none"><dt>Transporte</dt><dd id="diagTransporte">Não informado</dd></div>
                <div><dt>Modo</dt><dd id="diagModo">Não informado</dd></div>
                <div><dt>Status</dt><dd id="diagStatusId">Não informado</dd></div>
                <div class="d-none"><dt>Driver</dt><dd id="diagDriver">Não informado</dd></div>
              </dl>
            </section>

            <section class="central-eq-diag-card" data-diag-card="conexao">
              <h3 class="central-eq-diag-card__title">Conexão</h3>
              <div id="diagStatusVisual" class="central-eq-diag-status central-eq-diag-status--unknown mb-2">⚪ Não informado</div>
              <ul class="central-eq-diag-etapas" id="diagEtapasConexao">
                <li class="text-muted">Não informado</li>
              </ul>
              <dl class="central-eq-diag-dl">
                <div><dt>Ping / Health</dt><dd id="diagHealth">Não informado</dd></div>
                <div><dt>Protocolo</dt><dd id="diagProtocoloRede">Não informado</dd></div>
                <div><dt>Interface</dt><dd id="diagInterfaceRede">Não informado</dd></div>
                <div><dt>IP</dt><dd id="diagIp">Não informado</dd></div>
                <div><dt>Porta</dt><dd id="diagPortaInfo">Não informado</dd></div>
                <div><dt>Driver</dt><dd id="diagDriverConn">Não informado</dd></div>
                <div><dt>Status</dt><dd id="diagStatus">Não informado</dd></div>
                <div><dt>Online</dt><dd id="diagOnline">Não informado</dd></div>
                <div><dt>Tempo conectado</dt><dd id="diagTempoConectado">Não informado</dd></div>
                <div><dt>Última comunicação</dt><dd id="diagUltimaCom">Não informado</dd></div>
                <div><dt>Heartbeat</dt><dd id="diagHeartbeat">Não informado</dd></div>
                <div><dt>Latência</dt><dd id="diagLatencia">Não informado</dd></div>
                <div class="d-none"><dt>Uptime</dt><dd id="diagUptime">Não informado</dd></div>
                <div class="d-none"><dt>Erro</dt><dd id="diagErro">Não informado</dd></div>
                <div class="d-none"><dt>Ops</dt><dd id="diagOps">Não informado</dd></div>
                <div class="d-none"><dt>Sync</dt><dd id="diagSync">Não informado</dd></div>
                <div class="d-none"><dt>Peso</dt><dd id="diagPeso">Não informado</dd></div>
                <div class="d-none"><dt>Mon</dt><dd id="diagMon">Não informado</dd></div>
                <div class="d-none"><dt>Ts</dt><dd id="diagTimestamp">Não informado</dd></div>
              </dl>
            </section>

            <section class="central-eq-diag-card" data-diag-card="capacidades">
              <h3 class="central-eq-diag-card__title">Capacidades do Driver</h3>
              <ul class="central-eq-diag-check" id="centralEqDiagCaps">
                <li class="text-muted">Não informado</li>
              </ul>
            </section>

            <section class="central-eq-diag-card" data-diag-card="homologacao">
              <h3 class="central-eq-diag-card__title">Homologação</h3>
              <div id="centralEqDiagHomoResumo" class="central-eq-diag-homo mb-2">Não informado</div>
              <ul class="central-eq-diag-check" id="centralEqDiagCheckBody"></ul>
            </section>

            <section class="central-eq-diag-card central-eq-diag-card--wide" data-diag-card="historico">
              <h3 class="central-eq-diag-card__title">Histórico Recente</h3>
              <div class="table-responsive" style="max-height:220px;overflow:auto;">
                <table class="table table-sm mb-0">
                  <thead class="table-light sticky-top"><tr><th>Hora</th><th>Operação</th><th>Resultado</th><th>Tempo</th><th>Origem</th></tr></thead>
                  <tbody id="centralEqDiagHistBody">
                    <tr><td colspan="5" class="text-muted">Não informado</td></tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section class="central-eq-diag-card central-eq-diag-card--wide" data-diag-card="logs">
              <h3 class="central-eq-diag-card__title">Eventos Recentes</h3>
              <ul class="central-eq-diag-logs" id="centralEqDiagLogsBody">
                <li class="text-muted">Não informado</li>
              </ul>
            </section>

            <section class="central-eq-diag-card central-eq-diag-card--wide" data-diag-card="resumo">
              <h3 class="central-eq-diag-card__title">Diagnóstico Geral</h3>
              <div id="centralEqDiagResumo" class="central-eq-diag-resumo">Não informado</div>
            </section>
          </div>
        </div>
      </div>

      <div class="card mb-3 border-primary" id="centralEqOpsPainel" style="display:none;">
        <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center">
          <strong><i class="fas fa-bolt me-1"></i> Operações Toledo V1.0</strong>
          <button type="button" class="btn btn-sm btn-outline-light" onclick="document.getElementById('centralEqOpsPainel').style.display='none'">Fechar</button>
        </div>
        <div class="card-body">
          <div class="row g-2 mb-3">
            <div class="col-md-4">
              <label class="form-label small mb-1">Host</label>
              <input type="text" class="form-control form-control-sm" id="opsHost" placeholder="10.0.0.170">
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-1">Porta</label>
              <input type="number" class="form-control form-control-sm" id="opsPorta" value="9000">
            </div>
            <div class="col-md-6 d-flex align-items-end gap-2 flex-wrap">
              <button class="btn btn-sm btn-success" onclick="centralEqOpsExecutar('PING')">PING</button>
              <button class="btn btn-sm btn-info text-white" onclick="centralEqOpsExecutar('HANDSHAKE')">Handshake</button>
              <button class="btn btn-sm btn-primary" onclick="centralEqOpsExecutar('IDENTIFY')">Identify</button>
              <button class="btn btn-sm btn-outline-secondary" onclick="centralEqOpsHistorico()">Atualizar histórico</button>
            </div>
          </div>
          <div class="row g-3 mb-3" id="centralEqOpsResultados">
            <div class="col-md-3"><div class="border rounded p-2"><div class="text-muted small">PING</div><div id="opsPingStatus" class="fw-semibold">—</div></div></div>
            <div class="col-md-3"><div class="border rounded p-2"><div class="text-muted small">Handshake</div><div id="opsHsStatus" class="fw-semibold">—</div></div></div>
            <div class="col-md-3"><div class="border rounded p-2"><div class="text-muted small">Identify</div><div id="opsIdStatus" class="fw-semibold">—</div></div></div>
            <div class="col-md-3"><div class="border rounded p-2"><div class="text-muted small">Tempo</div><div id="opsTempo" class="fw-semibold">—</div></div></div>
          </div>
          <h6 class="mb-2">Histórico</h6>
          <div class="table-responsive" style="max-height:280px;overflow:auto;">
            <table class="table table-sm table-hover mb-0">
              <thead class="table-light sticky-top">
                <tr><th>Hora</th><th>Operação</th><th>Status</th><th>Duração</th></tr>
              </thead>
              <tbody id="centralEqOpsHistBody">
                <tr><td colspan="4" class="text-muted">Sem histórico.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card mb-3 border-dark" id="centralEqProtocoloPainel" style="display:none;">
        <div class="card-header bg-dark text-white d-flex justify-content-between align-items-center">
          <strong><i class="fas fa-code me-1"></i> PROTOCOLO Toledo 90AX</strong>
          <button type="button" class="btn btn-sm btn-outline-light" onclick="document.getElementById('centralEqProtocoloPainel').style.display='none'">Fechar</button>
        </div>
        <div class="card-body">
          <div class="row g-2 mb-3">
            <div class="col-md-3">
              <label class="form-label small mb-1">Host</label>
              <input type="text" class="form-control form-control-sm" id="protoHost" placeholder="10.0.0.170">
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-1">Porta</label>
              <input type="number" class="form-control form-control-sm" id="protoPorta" value="9000">
            </div>
            <div class="col-md-7 d-flex flex-wrap gap-2 align-items-end">
              <button class="btn btn-sm btn-primary" onclick="centralEqProtoExec('identify')">Identify</button>
              <button class="btn btn-sm btn-outline-primary" onclick="centralEqProtoExec('status')">Status</button>
              <button class="btn btn-sm btn-outline-primary" onclick="centralEqProtoExec('ping')">Ping</button>
              <button class="btn btn-sm btn-outline-secondary" onclick="centralEqProtoHistorico()">Histórico</button>
            </div>
          </div>
          <div class="row g-2 small mb-3" id="centralEqProtoStatus">
            <div class="col-6 col-md-3"><span class="text-muted">Estado</span><div id="protoEstado">—</div></div>
            <div class="col-6 col-md-3"><span class="text-muted">Último comando</span><div id="protoComando">—</div></div>
            <div class="col-6 col-md-3"><span class="text-muted">Tempo</span><div id="protoTempo">—</div></div>
            <div class="col-6 col-md-3"><span class="text-muted">Checksum</span><div id="protoChecksum">—</div></div>
            <div class="col-12 col-md-6"><span class="text-muted">Última resposta</span><div id="protoResposta">—</div></div>
            <div class="col-12 col-md-6"><span class="text-muted">Payload</span><div id="protoPayload" style="word-break:break-all;">—</div></div>
            <div class="col-12"><span class="text-muted">Frame TX</span><pre class="mb-1 small bg-light p-2" id="protoTx">—</pre></div>
            <div class="col-12"><span class="text-muted">Frame RX</span><pre class="mb-0 small bg-light p-2" id="protoRx">—</pre></div>
          </div>
          <div class="table-responsive" style="max-height:240px;overflow:auto;">
            <table class="table table-sm table-hover mb-0">
              <thead class="table-light"><tr>
                <th>Hora</th><th>Comando</th><th>OK</th><th>Checksum</th><th>ms</th><th>TX</th><th>RX</th>
              </tr></thead>
              <tbody id="centralEqProtoHistBody">
                <tr><td colspan="7" class="text-muted">Sem histórico.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card mb-3 border-info" id="centralEqLabPainel" style="display:none;">
        <div class="card-header bg-info text-white d-flex justify-content-between align-items-center">
          <strong><i class="fas fa-flask me-1"></i> Laboratório de Engenharia Reversa V2.0</strong>
          <button type="button" class="btn btn-sm btn-outline-light" onclick="document.getElementById('centralEqLabPainel').style.display='none'">Fechar</button>
        </div>
        <div class="card-body">
          <div class="d-flex flex-wrap gap-2 mb-3 align-items-center">
            <span id="centralEqLabBadge" class="badge bg-secondary">● Parado</span>
            <button class="btn btn-sm btn-danger" onclick="centralEqLabStart()"><i class="fas fa-circle"></i> Gravando / Start</button>
            <button class="btn btn-sm btn-outline-secondary" onclick="centralEqLabStop()">Stop</button>
            <button class="btn btn-sm btn-outline-warning" onclick="centralEqLabPause()">Pause</button>
            <button class="btn btn-sm btn-outline-success" onclick="centralEqLabResume()">Resume</button>
            <button class="btn btn-sm btn-outline-primary" onclick="centralEqLabExport('JSON')">Export JSON</button>
            <button class="btn btn-sm btn-outline-primary" onclick="centralEqLabExport('TXT')">Export TXT</button>
            <button class="btn btn-sm btn-outline-secondary" onclick="centralEqLabRefresh()">Atualizar</button>
          </div>
          <div class="row g-2 mb-3 small" id="centralEqLabMeta">
            <div class="col-6 col-md-2"><strong>Sessão</strong><div id="labSessionId">—</div></div>
            <div class="col-6 col-md-2"><strong>Frames</strong><div id="labFrames">0</div></div>
            <div class="col-6 col-md-2"><strong>TX</strong><div id="labTx">0</div></div>
            <div class="col-6 col-md-2"><strong>RX</strong><div id="labRx">0</div></div>
            <div class="col-6 col-md-2"><strong>Tempo</strong><div id="labTempo">00:00:00</div></div>
          </div>
          <div class="border rounded p-3 mb-3 bg-light" id="centralEqLabConnPanel">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <strong><i class="fas fa-plug me-1"></i> Conexão (Manager V2)</strong>
              <button type="button" class="btn btn-sm btn-outline-secondary" onclick="centralEqLabConnRefresh()">Atualizar</button>
            </div>
            <div class="row g-2 small" id="centralEqLabConnStats">
              <div class="col-6 col-md-3"><span class="text-muted">Estado</span><div id="labConnEstado">—</div></div>
              <div class="col-6 col-md-3"><span class="text-muted">Socket</span><div id="labConnSocket">—</div></div>
              <div class="col-6 col-md-3"><span class="text-muted">Heartbeat</span><div id="labConnHeartbeat">—</div></div>
              <div class="col-6 col-md-3"><span class="text-muted">Reconexões</span><div id="labConnReconexoes">—</div></div>
              <div class="col-6 col-md-3"><span class="text-muted">Tempo Online</span><div id="labConnUptime">—</div></div>
              <div class="col-6 col-md-3"><span class="text-muted">Bytes RX</span><div id="labConnRx">—</div></div>
              <div class="col-6 col-md-3"><span class="text-muted">Bytes TX</span><div id="labConnTx">—</div></div>
              <div class="col-6 col-md-3"><span class="text-muted">Latência</span><div id="labConnLatencia">—</div></div>
            </div>
          </div>
          <div class="border rounded p-3 mb-3 bg-light" id="centralEqLabSyncPanel">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <strong><i class="fas fa-exchange-alt me-1"></i> SINCRONIZAÇÃO (90AX)</strong>
              <button type="button" class="btn btn-sm btn-outline-secondary" onclick="centralEqSyncRefreshStatus()">Atualizar</button>
            </div>
            <div class="row g-2 small">
              <div class="col-6 col-md-3"><span class="text-muted">Lote Atual</span><div id="labSyncLote">—</div></div>
              <div class="col-6 col-md-3"><span class="text-muted">Produto</span><div id="labSyncProduto">—</div></div>
              <div class="col-6 col-md-3"><span class="text-muted">Retry</span><div id="labSyncRetry">—</div></div>
              <div class="col-6 col-md-3"><span class="text-muted">Resultado</span><div id="labSyncResultado">—</div></div>
              <div class="col-6 col-md-3"><span class="text-muted">Tempo</span><div id="labSyncTempo">—</div></div>
              <div class="col-6 col-md-3"><span class="text-muted">%</span><div id="labSyncPct">—</div></div>
              <div class="col-6 col-md-3"><span class="text-muted">Versão</span><div id="labSyncVersao">—</div></div>
              <div class="col-6 col-md-3"><span class="text-muted">Hash</span><div id="labSyncHash" class="text-truncate">—</div></div>
              <div class="col-6 col-md-3"><span class="text-muted">Delta</span><div id="labSyncDelta">—</div></div>
              <div class="col-6 col-md-3"><span class="text-muted">Rollback</span><div id="labSyncRollback">—</div></div>
            </div>
          </div>
          <div class="table-responsive" style="max-height:360px;overflow:auto;">
            <table class="table table-sm table-hover align-middle mb-0">
              <thead class="table-light sticky-top">
                <tr>
                  <th>Hora</th>
                  <th>Direção</th>
                  <th>Tamanho</th>
                  <th>Checksum</th>
                  <th>HEX</th>
                  <th>ASCII</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="centralEqLabFramesBody">
                <tr><td colspan="7" class="text-muted">Nenhum frame capturado. Inicie a gravação e conecte o Driver.</td></tr>
              </tbody>
            </table>
          </div>
          <div class="mt-3 border rounded p-3 bg-light" id="centralEqLabDetalhe" style="display:none;">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <strong>Detalhe do frame</strong>
              <button class="btn btn-sm btn-outline-secondary" onclick="centralEqLabCopiarDetalhe()">Copiar</button>
            </div>
            <pre class="mb-0 small" id="centralEqLabDetalhePre" style="white-space:pre-wrap;word-break:break-all;"></pre>
          </div>
        </div>
      </div>

      <div class="row mb-3">
        ${cardDash('Total', d.total)}
        ${cardDash('Online', d.online, 'border-success')}
        ${cardDash('Offline', d.offline, 'border-secondary')}
        ${cardDash('Novos', d.novos, 'border-info')}
        ${cardDash('Conhecidos', d.conhecidos, 'border-primary')}
        ${cardDash('Problemas', d.problemas, 'border-danger')}
        ${cardDash('Sincronizando', d.sincronizando, 'border-warning')}
        ${cardDash('Health médio', d.health_medio, 'border-dark')}
      </div>

      <div class="card mb-3">
        <div class="card-body">
          <div class="row g-2 align-items-end">
            <div class="col-md-2">
              <label class="form-label small mb-0">Busca</label>
              <input type="text" class="form-control" id="centralEqBusca" value="${escapeHtmlCentralEq(centralEqFiltros.busca)}" placeholder="Nome, IP...">
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-0">Transporte</label>
              <select class="form-select" id="centralEqTransporte">
                <option value="todos">Todos</option>
                <option value="ethernet" ${centralEqFiltros.transporte === 'ethernet' ? 'selected' : ''}>Ethernet</option>
                <option value="serial" ${centralEqFiltros.transporte === 'serial' ? 'selected' : ''}>Serial</option>
                <option value="usb" ${centralEqFiltros.transporte === 'usb' ? 'selected' : ''}>USB</option>
              </select>
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-0">Status</label>
              <select class="form-select" id="centralEqStatus">
                <option value="">Todos</option>
                ${['ONLINE','OFFLINE','DESCONHECIDO','NUNCA_VISTO','ALTEROU_IP','ALTEROU_FIRMWARE','SINCRONIZANDO','ERRO']
                  .map((s) => `<option value="${s}" ${centralEqFiltros.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-0">Fabricante</label>
              <input type="text" class="form-control" id="centralEqFabricante" value="${escapeHtmlCentralEq(centralEqFiltros.fabricante)}" placeholder="Ex: Toledo">
            </div>
            <div class="col-md-2">
              <label class="form-label small mb-0">Driver</label>
              <input type="text" class="form-control" id="centralEqDriver" value="${escapeHtmlCentralEq(centralEqFiltros.driver)}" placeholder="Ex: TOLEDO">
            </div>
            <div class="col-md-2">
              <button class="btn btn-primary w-100" onclick="aplicarFiltrosCentralEq()"><i class="fas fa-filter"></i> Filtrar</button>
            </div>
            <div class="col-12">
              <div class="form-check form-check-inline">
                <input class="form-check-input" type="checkbox" id="centralEqOnline" ${centralEqFiltros.online ? 'checked' : ''}>
                <label class="form-check-label" for="centralEqOnline">Online</label>
              </div>
              <div class="form-check form-check-inline">
                <input class="form-check-input" type="checkbox" id="centralEqOffline" ${centralEqFiltros.offline ? 'checked' : ''}>
                <label class="form-check-label" for="centralEqOffline">Offline</label>
              </div>
              <div class="form-check form-check-inline">
                <input class="form-check-input" type="checkbox" id="centralEqConhecidos" ${centralEqFiltros.conhecidos ? 'checked' : ''}>
                <label class="form-check-label" for="centralEqConhecidos">Conhecidos</label>
              </div>
              <div class="form-check form-check-inline">
                <input class="form-check-input" type="checkbox" id="centralEqNovos" ${centralEqFiltros.novos ? 'checked' : ''}>
                <label class="form-check-label" for="centralEqNovos">Novos</label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header d-flex justify-content-between">
          <span><i class="fas fa-list"></i> Equipamentos (${centralEqCache.length})</span>
        </div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-sm table-hover mb-0 align-middle">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Fabricante/Modelo</th>
                  <th>Driver</th>
                  <th>Transporte</th>
                  <th>Status</th>
                  <th>Identidade</th>
                  <th>Health</th>
                  <th>Último IP</th>
                  <th>Firmware</th>
                  <th>Última comunicação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>${renderLinhasCentralEq(centralEqCache)}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card mt-3" id="centralEqHistoricoPainel" style="display:none;">
        <div class="card-header d-flex justify-content-between">
          <span><i class="fas fa-history"></i> Histórico / linha do tempo</span>
          <button class="btn btn-sm btn-light" onclick="document.getElementById('centralEqHistoricoPainel').style.display='none'">Fechar</button>
        </div>
        <div class="card-body" id="centralEqHistoricoBody"></div>
      </div>
    </div>
  `;
  $('#page-content').html(html);
}

function renderLinhasCentralEq(itens) {
  if (!itens.length) {
    return '<tr><td colspan="11" class="text-center text-muted py-4">Nenhum equipamento encontrado.</td></tr>';
  }
  return itens.map((it, idx) => `
    <tr>
      <td><strong>${escapeHtmlCentralEq(it.nome)}</strong>
        <br><small class="text-muted">${escapeHtmlCentralEq(it.tipo_origem || '')}</small></td>
      <td>${escapeHtmlCentralEq(it.fabricante || '—')}<br><small class="text-muted">${escapeHtmlCentralEq(it.modelo || '—')}</small></td>
      <td><small>${escapeHtmlCentralEq(it.driver_codigo || '—')}</small></td>
      <td>${escapeHtmlCentralEq(it.transporte || '—')}</td>
      <td>${badgeStatusCentral(it.status_central, it.status_rotulo)}</td>
      <td><small>${escapeHtmlCentralEq(it.identidade_status || '—')}</small>
        ${it.ip_anterior ? `<br><small class="text-warning">${escapeHtmlCentralEq(it.ip_anterior)} → ${escapeHtmlCentralEq(it.ultimo_ip || '')}</small>` : ''}
      </td>
      <td title="${escapeHtmlCentralEq(it.health_rotulo || '')}">${badgeHealthCentral(it.health_score)}</td>
      <td><code>${escapeHtmlCentralEq(it.ultimo_ip || '—')}</code></td>
      <td><small>${escapeHtmlCentralEq(it.ultimo_firmware || '—')}</small></td>
      <td><small>${formatarDataCentralEq(it.ultima_comunicacao || it.ultima_descoberta)}</small></td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-outline-secondary me-1" title="Histórico" onclick="centralEqAbrirHistorico(${idx})"><i class="fas fa-history"></i></button>
        ${it.equipamento_id ? `
          <button class="btn btn-sm btn-outline-info me-1" title="Testar" onclick="centralEqTestar(${it.equipamento_id})"><i class="fas fa-plug"></i></button>
          <button class="btn btn-sm btn-outline-warning me-1" title="Diagnóstico" onclick="centralEqDiagnostico(${it.equipamento_id})"><i class="fas fa-stethoscope"></i></button>
          <button class="btn btn-sm btn-outline-primary me-1" title="Configurações" onclick="loadPage('equipamentos')"><i class="fas fa-cog"></i></button>
        ` : `
          <button class="btn btn-sm btn-outline-success" title="Cadastrar" onclick="centralEqCadastrarIndice(${idx})"><i class="fas fa-plus"></i></button>
        `}
      </td>
    </tr>
  `).join('');
}

function aplicarFiltrosCentralEq() {
  centralEqFiltros.busca = document.getElementById('centralEqBusca')?.value?.trim() || '';
  centralEqFiltros.transporte = document.getElementById('centralEqTransporte')?.value || 'todos';
  centralEqFiltros.status = document.getElementById('centralEqStatus')?.value || '';
  centralEqFiltros.fabricante = document.getElementById('centralEqFabricante')?.value?.trim() || '';
  centralEqFiltros.driver = document.getElementById('centralEqDriver')?.value?.trim() || '';
  centralEqFiltros.online = document.getElementById('centralEqOnline')?.checked ? '1' : '';
  centralEqFiltros.offline = document.getElementById('centralEqOffline')?.checked ? '1' : '';
  centralEqFiltros.conhecidos = document.getElementById('centralEqConhecidos')?.checked ? '1' : '';
  centralEqFiltros.novos = document.getElementById('centralEqNovos')?.checked ? '1' : '';
  loadCentralEquipamentos();
}

async function centralEqDescobrir() {
  try {
    const transportes = centralEqTransportesSelecionados();
    if (!transportes.length) {
      if (typeof showNotification === 'function') {
        showNotification('Selecione ao menos um transporte (USB, Serial ou Ethernet).', 'warning');
      }
      return;
    }
    if (typeof showNotification === 'function') showNotification('Iniciando discovery…', 'info');
    const api = centralEqApi();
    const resp = await fetch(`${api}/equipamentos/discovery/all`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({
        transportes,
        timeoutMs: 800,
        timeoutTcpMs: 200,
        concorrencia: 50,
        persistir_sessao: true
      })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);

    const n = (body.candidatos || []).length;
    centralEqExibirResultadosDiscovery(body.candidatos || [], body.meta || {});
    if (typeof showNotification === 'function') {
      showNotification(`Discovery concluído: ${n} candidato(s)`, 'success');
    }
    loadCentralEquipamentos();
  } catch (err) {
    // Fallback legado
    try {
      const body = await centralEqFetch('/descobrir', {
        method: 'POST',
        body: JSON.stringify({
          transportes: centralEqTransportesSelecionados(),
          timeoutMs: 800,
          persistir_sessao: true
        })
      });
      const n = (body.candidatos || []).length;
      if (typeof showNotification === 'function') {
        showNotification(`Discovery concluído: ${n} candidato(s)`, 'success');
      }
      loadCentralEquipamentos();
    } catch (err2) {
      if (typeof showNotification === 'function') showNotification(err2.message || err.message, 'danger');
    }
  }
}

function centralEqTransportesSelecionados() {
  const painel = document.getElementById('centralEqDiscoveryPainel');
  // Se painel ainda não renderizou checkboxes, assume os três
  const usb = document.getElementById('centralEqDiscUsb');
  const serial = document.getElementById('centralEqDiscSerial');
  const eth = document.getElementById('centralEqDiscEthernet');
  if (!usb && !serial && !eth) return ['usb', 'serial', 'ethernet'];
  const out = [];
  if (usb?.checked) out.push('usb');
  if (serial?.checked) out.push('serial');
  if (eth?.checked) out.push('ethernet');
  return out;
}

function centralEqExibirResultadosDiscovery(candidatos, meta = {}) {
  const painel = document.getElementById('centralEqDiscoveryPainel');
  const wrap = document.getElementById('centralEqDiscoveryTabelaWrap');
  const tbody = document.getElementById('centralEqDiscoveryTabela');
  const stats = document.getElementById('centralEqDiscoveryStats');
  const resultados = document.getElementById('centralEqDiscoveryResultados');
  if (painel) painel.style.display = '';

  window.__centralEqDescobertosV1 = (candidatos || []).map((c) => ({
    host: c.ip || c.host || (c.endpoint ? String(c.endpoint).split(':')[0] : ''),
    porta: c.porta || (c.endpoint ? Number(String(c.endpoint).split(':')[1]) : null),
    transporte: c.transporte || 'ethernet',
    driver: c.driver || c.driver_codigo || null,
    fabricante: c.fabricante || null,
    modelo: c.modelo || null,
    confidence: c.confiança != null ? c.confiança : c.confianca,
    endpoint: c.endpoint || null,
    latencia: c.latencia,
    _fpStatus: c.fabricante || c.driver ? 'ok' : 'pendente'
  }));

  if (stats) {
    const eth = meta.por_transporte?.ethernet?.meta?.estatisticas || meta.estatisticas || {};
    const partes = [];
    if (eth.hostsAnalisados != null) partes.push(`Hosts: ${eth.hostsAnalisados}`);
    if (eth.hostsConectados != null) partes.push(`Conectados: ${eth.hostsConectados}`);
    if (eth.equipamentosEncontrados != null) partes.push(`Encontrados: ${eth.equipamentosEncontrados}`);
    if (eth.portasAbertas != null) partes.push(`Portas abertas: ${eth.portasAbertas}`);
    if (eth.tempoTotal != null) partes.push(`Tempo: ${eth.tempoTotal} ms`);
    if (meta.encontrados != null) partes.push(`Total candidatos: ${meta.encontrados}`);
    stats.textContent = partes.join(' · ');
  }

  if (tbody && wrap) {
    const lista = window.__centralEqDescobertosV1 || [];
    if (!lista.length) {
      wrap.style.display = 'none';
      tbody.innerHTML = '';
    } else {
      wrap.style.display = '';
      tbody.innerHTML = lista.map((eq, idx) => {
        const conf = eq.confidence != null ? `${Number(eq.confidence)}%` : '—';
        const driverLabel = eq.driver || '—';
        const endpoint = eq.endpoint || (eq.host && eq.porta ? `${eq.host}:${eq.porta}` : (eq.host || '—'));
        return `
          <tr>
            <td><span class="badge bg-primary">${escapeHtmlCentralEq(eq.transporte || 'ethernet')}</span></td>
            <td><code>${escapeHtmlCentralEq(endpoint)}</code></td>
            <td>${escapeHtmlCentralEq(eq.host || '—')}</td>
            <td>${eq.porta != null ? escapeHtmlCentralEq(String(eq.porta)) : '—'}</td>
            <td>${escapeHtmlCentralEq(driverLabel)}</td>
            <td>${escapeHtmlCentralEq(conf)}</td>
            <td>
              <button type="button" class="btn btn-sm btn-success" onclick="centralEqCadastrarDescoberto(${idx})">
                Cadastrar
              </button>
            </td>
          </tr>`;
      }).join('');
    }
  }

  if (resultados) {
    const lista = window.__centralEqDescobertosV1 || [];
    resultados.innerHTML = lista.length
      ? lista.map((eq, idx) => centralEqRenderCardFingerprint(eq, idx)).join('')
      : '<div class="col-12 text-muted">Nenhum equipamento encontrado.</div>';
  }
}

/**
 * Sprint 14.1–15.1 — Discovery + Fingerprint + Connection V2.
 */
function centralEqConnBadge(connStatus) {
  const s = String(connStatus || 'DISCONNECTED').toUpperCase();
  // RC14.14.6 — estados oficiais da EquipmentSession (+ aliases FSM)
  if (s === 'CONNECTED' || s === 'ONLINE' || s === 'IDLE' || s === 'BUSY' || s === 'OK') {
    return `<span class="badge bg-success"><span style="color:#fff">●</span> Conectado</span>`;
  }
  if (s === 'RECONNECTING' || s === 'CONNECTING') {
    return `<span class="badge bg-warning text-dark"><span style="color:#000">●</span> Reconectando</span>`;
  }
  if (s === 'ERROR') {
    return `<span class="badge bg-danger"><span style="color:#fff">●</span> Erro</span>`;
  }
  return `<span class="badge bg-secondary"><span style="color:#fff">●</span> Offline</span>`;
}

function centralEqRenderCardFingerprint(eq, idx) {
  const idCard = `centralEqFpCard-${idx}`;
  const fab = eq.fabricante || null;
  const modelo = eq.modelo || null;
  const conf = eq.confidence != null ? Number(eq.confidence) : 0;
  const identificando = eq._fpStatus === 'identificando';
  const identificado = Boolean(fab || modelo || eq.driver);
  const connStatus = eq._connStatus || 'DISCONNECTED';
  const conectado = ['CONNECTED', 'ONLINE', 'IDLE', 'BUSY', 'OK'].includes(String(connStatus).toUpperCase());
  const latConn = eq._connLatencia != null ? eq._connLatencia : eq.latencia;
  const uptime = eq._connUptime || '00:00:00';

  let corpoIdent = '';
  if (identificando) {
    corpoIdent = `
      <div class="text-muted small mt-2" id="${idCard}-fp">
        <span class="spinner-border spinner-border-sm me-1" role="status"></span>
        Identificando...
      </div>`;
  } else if (identificado) {
    corpoIdent = `
      <dl class="row mb-0 small mt-2" id="${idCard}-fp">
        <dt class="col-4">Fabricante</dt><dd class="col-8">${escapeHtmlCentralEq(fab || '—')}</dd>
        <dt class="col-4">Modelo</dt><dd class="col-8">${escapeHtmlCentralEq(modelo || '—')}</dd>
        <dt class="col-4">Confiança</dt><dd class="col-8">${conf}%</dd>
      </dl>`;
  } else {
    corpoIdent = `
      <div class="text-muted small mt-2" id="${idCard}-fp">
        Equipamento encontrado — fabricante ainda não identificado
      </div>`;
  }

  const corpoConn = `
    <div class="mt-3 pt-2 border-top" id="${idCard}-conn">
      <div class="mb-2">${centralEqConnBadge(connStatus)}</div>
      ${conectado && eq._driver ? `
      <dl class="row mb-2 small">
        <dt class="col-4">Driver</dt><dd class="col-8"><strong>${escapeHtmlCentralEq(eq._driverLabel || 'TOLEDO PRIX IV')}</strong></dd>
        <dt class="col-4">Status</dt><dd class="col-8">${centralEqConnBadge(connStatus)}</dd>
        <dt class="col-4">Handshake</dt><dd class="col-8">${eq._handshake ? 'OK' : '—'}</dd>
        <dt class="col-4">Latência</dt><dd class="col-8">${latConn != null ? `${Number(latConn)} ms` : '—'}</dd>
      </dl>
      <div class="small mb-2">
        <div class="fw-semibold mb-1">Capacidades</div>
        <div>${eq._caps?.ping ? '✓' : '○'} Ping</div>
        <div>${eq._caps?.handshake ? '✓' : '○'} Handshake</div>
        <div>${eq._caps?.uploadPLU ? '✓' : '○'} Upload PLU</div>
        <div>${eq._caps?.readWeight ? '✓' : '○'} Leitura Peso</div>
      </div>
      ` : `
      <dl class="row mb-2 small">
        <dt class="col-4">IP</dt><dd class="col-8">${escapeHtmlCentralEq(eq.host)}</dd>
        <dt class="col-4">Porta</dt><dd class="col-8">${escapeHtmlCentralEq(String(eq.porta))}</dd>
        <dt class="col-4">Latência</dt><dd class="col-8">${latConn != null ? `${Number(latConn)} ms` : '—'}</dd>
        ${conectado ? `<dt class="col-4">Tempo conectado</dt><dd class="col-8">${escapeHtmlCentralEq(uptime)}</dd>` : ''}
      </dl>
      `}
      ${conectado
    ? `<div class="d-grid gap-1">
        <button type="button" class="btn btn-sm btn-outline-primary" onclick="centralEqPing(${idx})">Ping</button>
        <button type="button" class="btn btn-sm btn-outline-warning" onclick="centralEqReconectar(${idx})">Reconectar</button>
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="centralEqDesconectar(${idx})">Desconectar</button>
      </div>`
    : `<button type="button" class="btn btn-sm btn-success w-100" onclick="centralEqConectar(${idx})" ${identificando ? 'disabled' : ''}>Conectar</button>`}
    </div>`;

  return `
    <div class="col-md-6 col-xl-4" id="${idCard}">
      <div class="card h-100 ${conectado ? 'border-success' : 'border-secondary'}">
        <div class="card-body">
          <h6 class="card-title mb-3">Equipamento encontrado</h6>
          <dl class="row mb-0 small">
            <dt class="col-4">IP</dt><dd class="col-8">${escapeHtmlCentralEq(eq.host)}</dd>
            <dt class="col-4">Porta</dt><dd class="col-8">${escapeHtmlCentralEq(String(eq.porta))}</dd>
            <dt class="col-4">Status</dt><dd class="col-8">${badgeStatusCentral(eq.status || 'ONLINE')}</dd>
            <dt class="col-4">Latência</dt><dd class="col-8">${eq.latencia != null ? `${Number(eq.latencia)} ms` : '—'}</dd>
          </dl>
          ${corpoIdent}
          ${corpoConn}
          <button type="button" class="btn btn-sm btn-primary mt-3 w-100"
            onclick="centralEqCadastrarDescoberto(${idx})"
            ${identificando ? 'disabled' : ''}>
            Cadastrar
          </button>
        </div>
      </div>
    </div>`;
}

async function centralEqAtualizarCard(idx) {
  const lista = window.__centralEqDescobertosV1 || [];
  const eq = lista[idx];
  if (!eq) return;
  const wrap = document.getElementById(`centralEqFpCard-${idx}`);
  if (wrap) wrap.outerHTML = centralEqRenderCardFingerprint(eq, idx);
}

async function centralEqConectar(idx) {
  const lista = window.__centralEqDescobertosV1 || [];
  const eq = lista[idx];
  if (!eq) return;
  const api = centralEqApi();
  try {
    // Sprint 14.4 — Driver Toledo via ConnectionManager (handshake oficial)
    const resp = await fetch(`${api}/equipamentos/driver/toledo/connect`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({ host: eq.host, porta: eq.porta })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);

    let caps = {
      handshake: true,
      ping: true,
      uploadPLU: true,
      downloadPLU: true,
      syncPLU: true,
      readWeight: true,
      monitor: true,
      downloadConfig: true,
      writeConfig: true,
      writeLabel: false,
      firmwareUpdate: false,
      autoReconnect: false
    };
    try {
      const capsResp = await fetch(`${api}/equipamentos/driver/toledo/capabilities`, {
        headers: centralEqHeaders()
      });
      const capsBody = await capsResp.json().catch(() => ({}));
      if (capsResp.ok && capsBody.capabilities) caps = capsBody.capabilities;
    } catch (_) { /* ignore */ }

    lista[idx] = {
      ...eq,
      _connStatus: body.session?.state || body.status || 'CONNECTED',
      _connLatencia: body.session?.latency != null ? body.session.latency : body.latencia,
      _connUptime: '00:00:00',
      _connectionMode: body.session?.connectionMode || body.connectionMode || null,
      _driver: body.driver || 'TOLEDO_PRIX4',
      _driverLabel: 'TOLEDO PRIX IV',
      _handshake: body.handshake === true,
      _caps: caps
    };
    await centralEqAtualizarCard(idx);
    centralEqIniciarPollStatus(idx);
    if (typeof showNotification === 'function') {
      showNotification(`Driver Toledo ONLINE — ${eq.host}:${eq.porta}`, 'success');
    }
  } catch (err) {
    lista[idx] = { ...eq, _connStatus: 'OFFLINE', _handshake: false, _driver: null };
    await centralEqAtualizarCard(idx);
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqDesconectar(idx) {
  const lista = window.__centralEqDescobertosV1 || [];
  const eq = lista[idx];
  if (!eq) return;
  const api = centralEqApi();
  try {
    const resp = await fetch(`${api}/equipamentos/driver/toledo/disconnect`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({ host: eq.host, porta: eq.porta })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      // Fallback ConnectionManager
      await fetch(`${api}/equipamentos/disconnect`, {
        method: 'POST',
        headers: centralEqHeaders(),
        body: JSON.stringify({ host: eq.host, porta: eq.porta })
      });
    }
    centralEqPararPollStatus(idx);
    lista[idx] = {
      ...eq,
      _connStatus: 'OFFLINE',
      _connUptime: '00:00:00',
      _driver: null,
      _handshake: false,
      _caps: null
    };
    await centralEqAtualizarCard(idx);
    if (typeof showNotification === 'function') {
      showNotification(body.status ? 'Driver desconectado.' : 'Desconectado.', 'info');
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqReconectar(idx) {
  const lista = window.__centralEqDescobertosV1 || [];
  const eq = lista[idx];
  if (!eq) return;
  const api = centralEqApi();
  try {
    const resp = await fetch(`${api}/equipamentos/reconnect`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({ host: eq.host, porta: eq.porta })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    lista[idx] = {
      ...eq,
      _connStatus: body.status || body.estado || 'CONNECTED',
      _connLatencia: body.latencia
    };
    await centralEqAtualizarCard(idx);
    centralEqIniciarPollStatus(idx);
    if (typeof showNotification === 'function') {
      showNotification(`Reconectado (${body.reconexoes || 1}x)`, 'success');
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqPing(idx) {
  const lista = window.__centralEqDescobertosV1 || [];
  const eq = lista[idx];
  if (!eq) return;
  const api = centralEqApi();
  try {
    const resp = await fetch(`${api}/equipamentos/ping`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({ host: eq.host, porta: eq.porta })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    if (typeof showNotification === 'function') {
      showNotification(
        body.ok ? `Ping OK — ${body.latencia ?? '—'} ms` : 'Ping falhou',
        body.ok ? 'success' : 'warning'
      );
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqLabConnRefresh() {
  const api = centralEqApi();
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  try {
    const resp = await fetch(`${api}/equipamentos/connections`, { headers: centralEqHeaders() });
    const body = await resp.json().catch(() => ({}));
    const lista = body.connections || [];
    const eqLista = window.__centralEqDescobertosV1 || [];
    const prefer = eqLista.find((e) => e._connStatus === 'CONNECTED' || e._connStatus === 'IDLE') || eqLista[0];
    const conn = (prefer
      ? lista.find((c) => String(c.host) === String(prefer.host) && Number(c.porta) === Number(prefer.porta))
      : null) || lista[0];

    if (!conn) {
      set('labConnEstado', 'Sem conexões');
      set('labConnSocket', '—');
      set('labConnHeartbeat', '—');
      set('labConnReconexoes', '—');
      set('labConnUptime', '—');
      set('labConnRx', '—');
      set('labConnTx', '—');
      set('labConnLatencia', '—');
      return;
    }
    const m = conn.metricas || {};
    set('labConnEstado', conn.estado || conn.status || '—');
    set('labConnSocket', conn.socket ? 'Aberto' : 'Fechado');
    set('labConnHeartbeat', conn.heartbeat ? (m.ultimoHeartbeat || 'Ativo') : 'Parado');
    set('labConnReconexoes', String(m.reconexoes ?? 0));
    set('labConnUptime', m.tempoOnline || '—');
    set('labConnRx', String(m.bytesRecebidos ?? 0));
    set('labConnTx', String(m.bytesEnviados ?? 0));
    set('labConnLatencia', m.latenciaMedia != null ? `${m.latenciaMedia} ms` : (conn.latencia != null ? `${conn.latencia} ms` : '—'));
  } catch (_) {
    set('labConnEstado', 'Erro ao consultar');
  }
}

function centralEqPararPollStatus(idx) {
  window.__centralEqConnPoll = window.__centralEqConnPoll || {};
  if (window.__centralEqConnPoll[idx]) {
    clearInterval(window.__centralEqConnPoll[idx]);
    delete window.__centralEqConnPoll[idx];
  }
}

function centralEqIniciarPollStatus(idx) {
  centralEqPararPollStatus(idx);
  window.__centralEqConnPoll = window.__centralEqConnPoll || {};
  window.__centralEqConnPoll[idx] = setInterval(async () => {
    const lista = window.__centralEqDescobertosV1 || [];
    const eq = lista[idx];
    if (!eq) return centralEqPararPollStatus(idx);
    try {
      const api = centralEqApi();
      const q = new URLSearchParams({ host: eq.host, porta: String(eq.porta) });
      const resp = await fetch(`${api}/equipamentos/status?${q}`, { headers: centralEqHeaders() });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) return;
      lista[idx] = {
        ...eq,
        _connStatus: body.session?.state || body.status || 'DISCONNECTED',
        _connLatencia: body.session?.latency != null ? body.session.latency : body.latencia,
        _connUptime: body.uptime || '00:00:00',
        _connectionMode: body.session?.connectionMode || body.connectionMode || null
      };
      const st = String(lista[idx]._connStatus || '').toUpperCase();
      if (!['CONNECTED', 'ONLINE', 'IDLE', 'BUSY', 'OK'].includes(st)) {
        centralEqPararPollStatus(idx);
      }
      await centralEqAtualizarCard(idx);
    } catch (_) { /* ignore poll errors */ }
  }, 2000);
}

async function centralEqFingerprintUm(eq, idx) {
  const api = centralEqApi();
  try {
    const resp = await fetch(`${api}/equipamentos/fingerprint`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({ host: eq.host, porta: eq.porta })
    });
    const fp = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(fp.error || `HTTP ${resp.status}`);
    }
    const merged = {
      ...eq,
      fabricante: fp.fabricante ?? null,
      modelo: fp.modelo ?? null,
      driver: fp.driver ?? null,
      confidence: fp.confidence != null ? Number(fp.confidence) : 0,
      _fpStatus: 'ok'
    };
    if (window.__centralEqDescobertosV1) {
      window.__centralEqDescobertosV1[idx] = merged;
    }
    const wrap = document.getElementById(`centralEqFpCard-${idx}`);
    if (wrap) {
      wrap.outerHTML = centralEqRenderCardFingerprint(merged, idx);
    }
    return merged;
  } catch (_) {
    const merged = { ...eq, _fpStatus: 'erro', confidence: 0 };
    if (window.__centralEqDescobertosV1) {
      window.__centralEqDescobertosV1[idx] = merged;
    }
    const wrap = document.getElementById(`centralEqFpCard-${idx}`);
    if (wrap) {
      wrap.outerHTML = centralEqRenderCardFingerprint(merged, idx);
    }
    return merged;
  }
}

async function centralEqProcurarEquipamentos() {
  const painel = document.getElementById('centralEqDiscoveryPainel');
  const statusEl = document.getElementById('centralEqDiscoveryStatus');
  const bar = document.getElementById('centralEqDiscoveryBar');
  const resultados = document.getElementById('centralEqDiscoveryResultados');
  const btn = document.getElementById('btnCentralEqProcurar');
  const stats = document.getElementById('centralEqDiscoveryStats');

  if (!painel) return;
  painel.style.display = '';
  if (resultados) resultados.innerHTML = '';
  if (stats) stats.textContent = '';
  if (btn) btn.disabled = true;
  if (bar) {
    bar.classList.add('progress-bar-animated');
    bar.style.width = '0%';
    bar.textContent = '0%';
  }

  const transportes = centralEqTransportesSelecionados();
  if (!transportes.length) {
    if (statusEl) statusEl.textContent = 'Selecione USB, Serial e/ou Ethernet.';
    if (btn) btn.disabled = false;
    return;
  }

  let pct = 0;
  const tick = setInterval(() => {
    pct = Math.min(70, pct + Math.floor(Math.random() * 8) + 3);
    if (bar) {
      bar.style.width = `${pct}%`;
      bar.textContent = `${pct}%`;
    }
    if (statusEl) {
      if (pct < 20) statusEl.textContent = 'Discovery iniciado...';
      else if (pct < 45) statusEl.textContent = 'Detectando interfaces / escanando rede...';
      else statusEl.textContent = transportes.includes('ethernet')
        ? 'Probe Ethernet TCP (drivers)...'
        : 'Consultando USB / Serial...';
    }
  }, 400);

  try {
    const api = centralEqApi();
    let body = null;

    // Preferência Sprint 15: Discovery Manager (paralelo)
    const respAll = await fetch(`${api}/equipamentos/discovery/all`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({
        transportes,
        timeoutTcpMs: 200,
        concorrencia: 50,
        meta: true,
        lab: true
      })
    });
    body = await respAll.json().catch(() => ({}));

    if (!respAll.ok) {
      // Fallback: só Ethernet Sprint 15
      if (transportes.includes('ethernet') && transportes.length === 1) {
        const respEth = await fetch(`${api}/equipamentos/discovery/ethernet?meta=1`, {
          method: 'GET',
          headers: centralEqHeaders()
        });
        body = await respEth.json().catch(() => ([]));
        if (!respEth.ok) throw new Error(body.error || `HTTP ${respEth.status}`);
        const listaEth = Array.isArray(body) ? body : (body.equipamentos || body.candidatos || []);
        body = {
          candidatos: listaEth.map((c) => ({
            transporte: 'ethernet',
            endpoint: c.endpoint,
            driver: c.driver,
            confiança: c.confiança != null ? c.confiança : c.confianca,
            ip: c.ip || (c.endpoint ? String(c.endpoint).split(':')[0] : null),
            porta: c.porta || (c.endpoint ? Number(String(c.endpoint).split(':')[1]) : null),
            fabricante: c.fabricante,
            modelo: c.modelo
          })),
          meta: body.meta || {}
        };
      } else {
        throw new Error(body.error || `HTTP ${respAll.status}`);
      }
    }

    clearInterval(tick);

    const lista = body.candidatos || body.equipamentos || [];
    const meta = body.meta || {};

    if (statusEl) {
      statusEl.textContent = lista.length
        ? `${lista.length} equipamento(s) encontrado(s)`
        : `Nenhum equipamento encontrado (${(meta.transportes_executados || transportes).join(', ')}).`;
    }
    if (bar) {
      bar.style.width = '100%';
      bar.textContent = '100%';
      bar.classList.remove('progress-bar-animated');
    }

    centralEqExibirResultadosDiscovery(lista, meta);

    if (typeof showNotification === 'function') {
      showNotification(
        lista.length ? `${lista.length} equipamento(s) encontrado(s)` : 'Nenhum equipamento encontrado',
        lista.length ? 'success' : 'info'
      );
    }
  } catch (err) {
    clearInterval(tick);
    if (statusEl) statusEl.textContent = `Erro: ${err.message}`;
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function centralEqCadastrarDescoberto(idx) {
  const lista = window.__centralEqDescobertosV1 || [];
  const eq = lista[idx];
  if (!eq) return;
  const titulo = eq.fabricante
    ? `${eq.fabricante}${eq.modelo ? ' ' + eq.modelo : ''} (${eq.host}:${eq.porta})`
    : `${eq.host}:${eq.porta}`;
  if (!confirm(`Cadastrar equipamento ${titulo}?\n\nDriver, IP e porta serão preenchidos automaticamente.`)) {
    return;
  }
  const nome = eq.fabricante
    ? `${eq.fabricante}${eq.modelo ? ' ' + eq.modelo : ''} — ${eq.host}`
    : `Equipamento ${eq.host}`;
  try {
    await centralEqFetch('/cadastrar', {
      method: 'POST',
      body: JSON.stringify({
        nome,
        transporte: eq.transporte || 'ethernet',
        ip: eq.host,
        porta_tcp: eq.porta,
        timeout_ms: 500,
        fabricante: eq.fabricante || null,
        modelo: eq.modelo || null,
        driver: eq.driver || null,
        ativo: 1,
        observacao: [
          'Discovery Ethernet Sprint 15.0',
          eq.latencia != null ? `latência ${eq.latencia}ms` : null,
          eq.confidence ? `confiança ${eq.confidence}%` : null
        ].filter(Boolean).join(' | ')
      })
    });
    if (typeof showNotification === 'function') {
      showNotification('Equipamento cadastrado com sucesso.', 'success');
    }
    loadCentralEquipamentos();
  } catch (err) {
    if (typeof showNotification === 'function') {
      showNotification(err.message || 'Abra o cadastro manual para concluir.', 'warning');
    }
    try {
      sessionStorage.setItem('cds_eq_prefill', JSON.stringify({
        ip: eq.host,
        porta_tcp: eq.porta,
        transporte: eq.transporte || 'ethernet',
        timeout_ms: 500,
        fabricante: eq.fabricante || '',
        modelo: eq.modelo || '',
        driver: eq.driver || ''
      }));
    } catch (_) { /* ignore */ }
    if (typeof loadPage === 'function') loadPage('equipamentos');
  }
}

/**
 * Sprint 14.7 — Sincronização PLUs
 */
window.__centralEqPluLote = window.__centralEqPluLote || [];

function centralEqMostrarPlu() {
  const painel = document.getElementById('centralEqPluPainel');
  if (painel) painel.style.display = '';
  const lista = window.__centralEqDescobertosV1 || [];
  const eq = lista.find((e) => e._driver || e._connStatus === 'CONNECTED') || lista[0];
  if (eq) {
    const h = document.getElementById('pluHost');
    const p = document.getElementById('pluPorta');
    if (h && !h.value) h.value = eq.host || '';
    if (p && eq.porta) p.value = eq.porta;
  }
  centralEqPluHistorico();
}

function centralEqPluAlvo() {
  return {
    host: document.getElementById('pluHost')?.value?.trim(),
    porta: Number(document.getElementById('pluPorta')?.value || 0)
  };
}

function centralEqPluProgresso(done, total) {
  const wrap = document.getElementById('pluProgressWrap');
  const bar = document.getElementById('pluProgressBar');
  const label = document.getElementById('pluProgressLabel');
  const count = document.getElementById('pluProgressCount');
  if (!wrap) return;
  wrap.style.display = '';
  const pct = total ? Math.round((done / total) * 100) : 0;
  if (bar) {
    bar.style.width = `${pct}%`;
    bar.textContent = `${pct}%`;
  }
  if (label) label.textContent = done >= total ? 'Concluído' : 'Enviando...';
  if (count) count.textContent = `${done} / ${total}`;
}

async function centralEqPluEnviar() {
  const alvo = centralEqPluAlvo();
  const produto = {
    plu: document.getElementById('pluCodigo')?.value?.trim(),
    descricao: document.getElementById('pluDesc')?.value?.trim(),
    preco: Number(document.getElementById('pluPreco')?.value)
  };
  if (!alvo.host || !alvo.porta) {
    if (typeof showNotification === 'function') showNotification('Informe host e porta.', 'warning');
    return;
  }
  centralEqPluProgresso(0, 1);
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/plu/upload`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({ ...alvo, ...produto })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    centralEqPluProgresso(1, 1);
    window.__centralEqPluLote.push(produto);
    await centralEqPluHistorico();
    if (typeof showNotification === 'function') showNotification(`PLU ${body.plu} sincronizado`, 'success');
  } catch (err) {
    centralEqPluProgresso(1, 1);
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqPluEnviarTodos() {
  const alvo = centralEqPluAlvo();
  const atual = {
    plu: document.getElementById('pluCodigo')?.value?.trim(),
    descricao: document.getElementById('pluDesc')?.value?.trim(),
    preco: Number(document.getElementById('pluPreco')?.value)
  };
  const lista = [...(window.__centralEqPluLote || [])];
  if (atual.plu) lista.push(atual);
  if (!lista.length) {
    if (typeof showNotification === 'function') showNotification('Nenhum produto na fila. Envie um PLU primeiro ou preencha o formulário.', 'warning');
    return;
  }
  if (!alvo.host || !alvo.porta) {
    if (typeof showNotification === 'function') showNotification('Informe host e porta.', 'warning');
    return;
  }
  centralEqPluProgresso(0, lista.length);
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/plu/upload-many`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({ ...alvo, produtos: lista })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    centralEqPluProgresso(body.ok + body.erro, body.total);
    await centralEqPluHistorico();
    if (typeof showNotification === 'function') {
      showNotification(`Lote: ${body.ok} ok, ${body.erro} erro(s)`, body.erro ? 'warning' : 'success');
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqPluCancelar() {
  try {
    await fetch(`${centralEqApi()}/equipamentos/plu/cancel`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: '{}'
    });
    if (typeof showNotification === 'function') showNotification('Cancelamento solicitado', 'info');
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqPluHistorico() {
  try {
    const alvo = centralEqPluAlvo();
    const q = new URLSearchParams({ limite: '40' });
    if (alvo.host) q.set('host', alvo.host);
    if (alvo.porta) q.set('porta', String(alvo.porta));
    const resp = await fetch(`${centralEqApi()}/equipamentos/plu/history?${q}`, {
      headers: centralEqHeaders()
    });
    const body = await resp.json().catch(() => ({}));
    const tbody = document.getElementById('centralEqPluHistBody');
    if (!tbody) return;
    const rows = body.historico || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Sem sincronizações.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td>${escapeHtmlCentralEq(r.produto_id != null ? `#${r.produto_id}` : '—')}</td>
        <td>${escapeHtmlCentralEq(r.plu || '')}</td>
        <td>${escapeHtmlCentralEq(r.status || '')}</td>
        <td class="small">${escapeHtmlCentralEq(r.enviado_em ? new Date(r.enviado_em).toLocaleString('pt-BR') : '—')}</td>
        <td class="small">${escapeHtmlCentralEq(r.confirmado_em ? new Date(r.confirmado_em).toLocaleString('pt-BR') : '—')}</td>
        <td class="small text-danger">${escapeHtmlCentralEq(r.erro || '')}</td>
      </tr>
    `).join('');
  } catch (_) { /* ignore */ }
}

/**
 * Sprint 14.8 / 15.4 — Sincronização CDS × Balança (90AX)
 */
window.__centralEqSyncState = window.__centralEqSyncState || {
  plus: [],
  plano: null,
  relatorio: null,
  produtosCds: [],
  poll: null
};

function centralEqMostrarSync() {
  const painel = document.getElementById('centralEqSyncPainel');
  if (painel) painel.style.display = '';
  const lista = window.__centralEqDescobertosV1 || [];
  const eq = lista.find((e) => e._driver || e._connStatus === 'CONNECTED') || lista[0];
  if (eq) {
    const h = document.getElementById('syncHost');
    const p = document.getElementById('syncPorta');
    if (h && !h.value) h.value = eq.host || '';
    if (p && eq.porta) p.value = eq.porta;
  }
  centralEqSyncRefreshStatus();
}

function centralEqSyncAlvo() {
  return {
    host: document.getElementById('syncHost')?.value?.trim(),
    porta: Number(document.getElementById('syncPorta')?.value || 0)
  };
}

function centralEqSyncProdutosCds() {
  const st = window.__centralEqSyncState;
  let produtos = st.produtosCds || [];
  if (!produtos.length) {
    const plu = document.getElementById('pluCodigo')?.value?.trim();
    const desc = document.getElementById('pluDesc')?.value?.trim();
    const preco = Number(document.getElementById('pluPreco')?.value);
    if (plu) produtos = [{ plu, descricao: desc || plu, preco: preco || 0, departamento: 1 }];
  }
  return produtos;
}

function centralEqSyncProgresso(label, done, total, extra = {}) {
  const wrap = document.getElementById('syncProgressWrap');
  const bar = document.getElementById('syncProgressBar');
  const lab = document.getElementById('syncProgressLabel');
  const count = document.getElementById('syncProgressCount');
  if (!wrap) return;
  wrap.style.display = '';
  const pct = extra.percent != null ? extra.percent : (total ? Math.round((done / total) * 100) : 0);
  if (bar) {
    bar.style.width = `${pct}%`;
    bar.textContent = `${pct}%`;
  }
  if (lab) lab.textContent = label || 'Processando...';
  if (count) count.textContent = extra.percent != null ? `${pct}%` : `${done} / ${total}`;
  const loteEl = document.getElementById('syncProgressLote');
  const etaEl = document.getElementById('syncProgressEta');
  const velEl = document.getElementById('syncProgressVel');
  if (loteEl) loteEl.textContent = extra.lote || 'Lote —';
  if (etaEl) etaEl.textContent = extra.eta ? `ETA ${extra.eta}` : 'ETA —';
  if (velEl) velEl.textContent = extra.velocidadeLabel || '— it/s';
}

function centralEqSyncAplicarProgresso(p) {
  if (!p) return;
  const stEl = document.getElementById('syncStatStatus');
  const modoEl = document.getElementById('syncStatModo');
  const pendEl = document.getElementById('syncStatPendentes');
  if (stEl) stEl.textContent = p.fase || (p.running ? 'running' : 'idle');
  if (modoEl) modoEl.textContent = p.modo || '—';
  if (pendEl) pendEl.textContent = p.itensRestantes != null ? String(p.itensRestantes) : '—';
  centralEqSyncProgresso(
    p.produtoAtual?.plu ? `PLU ${p.produtoAtual.plu}` : (p.fase || 'Sincronizando...'),
    p.itensEnviados || 0,
    p.totalItens || 0,
    {
      percent: p.percent,
      lote: p.loteAtual ? `Lote ${p.loteIndex}/${p.lotesTotal} (${p.loteAtual.tipo})` : 'Lote —',
      eta: p.eta,
      velocidadeLabel: p.velocidadeLabel
    }
  );
  const labLote = document.getElementById('labSyncLote');
  const labProd = document.getElementById('labSyncProduto');
  const labRes = document.getElementById('labSyncResultado');
  const labTempo = document.getElementById('labSyncTempo');
  const labPct = document.getElementById('labSyncPct');
  if (labLote) labLote.textContent = p.loteAtual?.id || '—';
  if (labProd) labProd.textContent = p.produtoAtual?.plu || '—';
  if (labRes) labRes.textContent = p.fase || '—';
  if (labTempo) labTempo.textContent = p.tempo || '—';
  if (labPct) labPct.textContent = `${p.percent != null ? p.percent : 0}%`;
}

async function centralEqSyncRefreshStatus() {
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/sync/status`, { headers: centralEqHeaders() });
    const body = await resp.json().catch(() => ({}));
    if (resp.ok) centralEqSyncAplicarProgresso(body);
  } catch (_) { /* ignore */ }
}

function centralEqSyncPararPoll() {
  const st = window.__centralEqSyncState;
  if (st.poll) {
    clearInterval(st.poll);
    st.poll = null;
  }
}

function centralEqSyncIniciarPoll() {
  centralEqSyncPararPoll();
  window.__centralEqSyncState.poll = setInterval(() => { centralEqSyncRefreshStatus(); }, 800);
}

function centralEqSyncIcone(situacao) {
  if (situacao === 'IGUAL') return '🟢';
  if (situacao === 'ALTERADO') return '🟡';
  if (situacao === 'NOVO') return '🔵';
  if (situacao === 'AUSENTE') return '🔴';
  return '⚪';
}

function centralEqSyncRender(itens) {
  const tbody = document.getElementById('centralEqSyncBody');
  if (!tbody) return;
  if (!itens || !itens.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Nenhum item.</td></tr>';
    return;
  }
  tbody.innerHTML = itens.map((i) => `
    <tr>
      <td>${escapeHtmlCentralEq(i.plu || '')}</td>
      <td>${escapeHtmlCentralEq((i.cds && i.cds.descricao) || i.descricao || '')}</td>
      <td>${escapeHtmlCentralEq((i.balanca && i.balanca.descricao) || '')}</td>
      <td>${centralEqSyncIcone(i.situacao)} ${escapeHtmlCentralEq(i.situacao || '')}</td>
      <td>${escapeHtmlCentralEq(i.acao || '')}</td>
      <td>${escapeHtmlCentralEq(i.status || (i.selecionado ? 'Pendente' : '—'))}</td>
    </tr>
  `).join('');
}

function centralEqSyncMostrarRelatorio(rel) {
  const box = document.getElementById('syncRelatorioBox');
  if (!box || !rel) return;
  box.style.display = '';
  box.innerHTML = `
    <strong>Relatório ${escapeHtmlCentralEq(rel.resultadoFinal || '')}</strong> —
    Modo: ${escapeHtmlCentralEq(rel.modo || '—')} |
    Enviados: ${rel.produtosEnviados || 0} |
    Depts: ${rel.departamentos || 0} |
    Preços: ${rel.precos || 0} |
    Etiquetas: ${rel.etiquetas || 0} |
    Falhas: ${rel.falhas || 0} |
    Vel: ${escapeHtmlCentralEq(rel.velocidadeLabel || '—')} |
    Tempo: ${escapeHtmlCentralEq(rel.tempoTotal || '—')}
  `;
  const ultima = document.getElementById('syncStatUltima');
  if (ultima) ultima.textContent = rel.geradoEm ? new Date(rel.geradoEm).toLocaleString() : '—';
}

async function centralEqSyncRodar(modo) {
  const alvo = centralEqSyncAlvo();
  const produtos = centralEqSyncProdutosCds();
  if (!alvo.host || !alvo.porta) {
    if (typeof showNotification === 'function') showNotification('Informe host e porta.', 'warning');
    return;
  }
  if (!produtos.length) {
    if (typeof showNotification === 'function') {
      showNotification('Informe produtos CDS (formulário PLU) para sincronizar.', 'warning');
    }
    return;
  }
  const label = modo === 'full' ? 'Sincronizar Tudo' : 'Sincronizar Alterações';
  if (!window.confirm(`${label}: ${produtos.length} produto(s)? Confirmação obrigatória.`)) return;

  const st = window.__centralEqSyncState;
  centralEqSyncIniciarPoll();
  centralEqSyncProgresso(label + '...', 0, produtos.length, { percent: 0 });
  try {
    const path = modo === 'full' ? '/equipamentos/sync/full' : '/equipamentos/sync/incremental';
    const resp = await fetch(`${centralEqApi()}${path}`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({
        ...alvo,
        confirm: true,
        produtos,
        ultimaSync: st.plus || [],
        engine: '90AX'
      })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    st.relatorio = body.relatorio;
    st.plano = body.plano;
    centralEqSyncPararPoll();
    if (body.progress) centralEqSyncAplicarProgresso(body.progress);
    centralEqSyncMostrarRelatorio(body.relatorio);
    const statusMap = {};
    (body.execucao?.resultados || []).forEach((r) => {
      statusMap[r.plu] = r.success ? 'OK' : (r.error || 'ERRO');
    });
    centralEqSyncRender(produtos.map((p) => ({
      plu: p.plu,
      cds: p,
      situacao: '—',
      acao: modo === 'full' ? 'ENVIAR' : 'INCREMENTAL',
      status: statusMap[p.plu] || '—'
    })));
    if (typeof showNotification === 'function') {
      showNotification(`Sync ${modo}: ${body.relatorio?.resultadoFinal || 'OK'}`, body.success ? 'success' : 'warning');
    }
  } catch (err) {
    centralEqSyncPararPoll();
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

function centralEqSyncTudo() {
  return centralEqSyncRodar('full');
}

function centralEqSyncAlteracoes() {
  return centralEqSyncRodar('incremental');
}

async function centralEqSyncCancelar() {
  try {
    await fetch(`${centralEqApi()}/equipamentos/sync/cancel`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: '{}'
    });
    centralEqSyncPararPoll();
    if (typeof showNotification === 'function') showNotification('Sincronização cancelada', 'warning');
    centralEqSyncRefreshStatus();
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqSyncHistorico() {
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/sync/history?limite=20`, {
      headers: centralEqHeaders()
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    const hist = body.historico || [];
    centralEqSyncRender(hist.map((h) => ({
      plu: `#${h.id}`,
      cds: { descricao: `${h.modo || h.tipo || ''} — ${h.status || ''}` },
      balanca: { descricao: h.inicio || '' },
      situacao: h.sucesso ? 'IGUAL' : 'ALTERADO',
      acao: h.modo || '—',
      status: `${h.itens || 0} ok / ${h.falhas || 0} falhas`
    })));
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqSyncBaixar() {
  const alvo = centralEqSyncAlvo();
  if (!alvo.host || !alvo.porta) {
    if (typeof showNotification === 'function') showNotification('Informe host e porta.', 'warning');
    return;
  }
  centralEqSyncProgresso('Lendo PLUs...', 0, 1);
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/plu/download`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify(alvo)
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    window.__centralEqSyncState.plus = body.plus || [];
    window.__centralEqSyncState.plano = null;
    centralEqSyncProgresso('Download concluído', body.total || 0, body.total || 0);
    centralEqSyncRender((body.plus || []).map((p) => ({
      plu: p.plu,
      cds: null,
      balanca: p,
      situacao: '—',
      acao: '—',
      status: 'Lido'
    })));
    if (typeof showNotification === 'function') {
      showNotification(`${body.total || 0} PLU(s) lidos da balança`, 'success');
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqSyncComparar() {
  const st = window.__centralEqSyncState;
  const produtos = centralEqSyncProdutosCds();
  if (!produtos.length && (!st.plus || !st.plus.length)) {
    if (typeof showNotification === 'function') {
      showNotification('Baixe PLUs da balança e informe produtos CDS (formulário PLU ou lista).', 'warning');
    }
    return;
  }
  centralEqSyncProgresso('Comparando...', 0, 1);
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/plu/compare`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({
        produtos,
        balanca: st.plus
      })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    st.plano = body.plano;
    const pend = document.getElementById('syncStatPendentes');
    if (pend) pend.textContent = String(body.resumo?.aExecutar || 0);
    centralEqSyncProgresso('Comparação concluída', body.resumo?.total || 0, body.resumo?.total || 0);
    centralEqSyncRender(body.plano?.itens || []);
    if (typeof showNotification === 'function') {
      showNotification(
        `Plano: ${body.resumo?.aExecutar || 0} alteração(ões) | ${body.resumo?.iguais || 0} iguais`,
        'info'
      );
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqSyncExecutar() {
  return centralEqSyncAlteracoes();
}

function centralEqSyncExportar() {
  const st = window.__centralEqSyncState;
  const rel = st.relatorio || {
    totalPlUs: st.plus?.length || 0,
    plano: st.plano?.resumo || null,
    delta: st.delta || null,
    geradoEm: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(rel, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sync-90ax-relatorio-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  centralEqSyncMostrarRelatorio(rel);
}

function centralEqSyncAba(nome) {
  const carga = document.getElementById('syncAbaCarga');
  const alt = document.getElementById('syncAbaAlteracoes');
  const ver = document.getElementById('syncAbaVersoes');
  if (carga) carga.style.display = nome === 'carga' ? '' : 'none';
  if (alt) alt.style.display = nome === 'alteracoes' ? '' : 'none';
  if (ver) ver.style.display = nome === 'versoes' ? '' : 'none';
  document.querySelectorAll('#syncTabs .nav-link').forEach((el, i) => {
    el.classList.toggle('active', (nome === 'carga' && i === 0) || (nome === 'alteracoes' && i === 1) || (nome === 'versoes' && i === 2));
  });
}

function centralEqSyncRenderDelta(delta) {
  const tbody = document.getElementById('centralEqSyncDeltaBody');
  const resumo = document.getElementById('syncDeltaResumo');
  if (resumo && delta?.resumo) {
    resumo.innerHTML = `Novos: <b>${delta.resumo.novos}</b> | Alterados: <b>${delta.resumo.alterados}</b> | Removidos: <b>${delta.resumo.removidos}</b> | Preços: ${delta.resumo.precos} | Depts: ${delta.resumo.departamentos} | Etiquetas: ${delta.resumo.etiquetas}`;
  }
  if (!tbody) return;
  const rows = delta?.campos || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Sem alterações.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((c) => `
    <tr>
      <td>${escapeHtmlCentralEq(c.plu || '')}</td>
      <td>${escapeHtmlCentralEq(c.tipo || '')}</td>
      <td>${escapeHtmlCentralEq(c.campo || '')}</td>
      <td class="small">${escapeHtmlCentralEq(typeof c.valor_anterior === 'object' ? JSON.stringify(c.valor_anterior) : String(c.valor_anterior ?? ''))}</td>
      <td class="small">${escapeHtmlCentralEq(typeof c.valor_novo === 'object' ? JSON.stringify(c.valor_novo) : String(c.valor_novo ?? ''))}</td>
    </tr>
  `).join('');
}

async function centralEqSyncVerAlteracoes() {
  centralEqSyncAba('alteracoes');
  const alvo = centralEqSyncAlvo();
  const produtos = centralEqSyncProdutosCds();
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/sync/delta`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({
        ...alvo,
        produtos,
        ultimaSync: window.__centralEqSyncState.plus || [],
        preview: true
      })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    window.__centralEqSyncState.delta = body.delta;
    centralEqSyncRenderDelta(body.delta);
    const pend = document.getElementById('syncStatPendentes');
    if (pend) pend.textContent = String(body.delta?.resumo?.totalMudancas || 0);
    const hashEl = document.getElementById('syncStatHash');
    if (hashEl) hashEl.textContent = (body.snapshotAtual?.hash || '').slice(0, 12) || '—';
    const labDelta = document.getElementById('labSyncDelta');
    if (labDelta) labDelta.textContent = `${body.delta?.resumo?.totalMudancas || 0} mud.`;
    if (typeof showNotification === 'function') {
      showNotification(`Delta: ${body.delta?.resumo?.totalMudancas || 0} mudança(s)`, 'info');
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqSyncDelta() {
  const alvo = centralEqSyncAlvo();
  const produtos = centralEqSyncProdutosCds();
  if (!alvo.host || !alvo.porta) {
    if (typeof showNotification === 'function') showNotification('Informe host e porta.', 'warning');
    return;
  }
  if (!produtos.length) {
    if (typeof showNotification === 'function') showNotification('Informe produtos CDS.', 'warning');
    return;
  }
  // Preview primeiro
  await centralEqSyncVerAlteracoes();
  const mud = window.__centralEqSyncState.delta?.resumo?.totalMudancas || 0;
  if (!window.confirm(`Delta Sync: enviar ${mud} alteração(ões)?`)) return;
  centralEqSyncIniciarPoll();
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/sync/delta`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({
        ...alvo,
        confirm: true,
        produtos,
        ultimaSync: window.__centralEqSyncState.plus || []
      })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    centralEqSyncPararPoll();
    window.__centralEqSyncState.relatorio = body.relatorio;
    window.__centralEqSyncState.delta = body.delta;
    const verEl = document.getElementById('syncStatVersao');
    if (verEl) verEl.textContent = body.versao != null ? String(body.versao) : '—';
    const hashEl = document.getElementById('syncStatHash');
    if (hashEl) hashEl.textContent = (body.hash || '').slice(0, 12) || '—';
    const labVer = document.getElementById('labSyncVersao');
    if (labVer) labVer.textContent = body.versao != null ? String(body.versao) : '—';
    const labHash = document.getElementById('labSyncHash');
    if (labHash) labHash.textContent = (body.hash || '').slice(0, 16) || '—';
    if (body.progress) centralEqSyncAplicarProgresso(body.progress);
    centralEqSyncMostrarRelatorio(body.relatorio);
    if (body.semAlteracoes) {
      if (typeof showNotification === 'function') showNotification('Nenhuma alteração (hash igual).', 'info');
    } else if (typeof showNotification === 'function') {
      showNotification(`Delta sync v${body.versao || '?'} — ${body.relatorio?.resultadoFinal || 'OK'}`, body.success ? 'success' : 'warning');
    }
  } catch (err) {
    centralEqSyncPararPoll();
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqSyncVerVersoes() {
  centralEqSyncAba('versoes');
  const alvo = centralEqSyncAlvo();
  try {
    const qs = new URLSearchParams();
    if (alvo.host) qs.set('host', alvo.host);
    if (alvo.porta) qs.set('porta', String(alvo.porta));
    qs.set('limite', '30');
    const resp = await fetch(`${centralEqApi()}/equipamentos/sync/versions?${qs}`, {
      headers: centralEqHeaders()
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    const tbody = document.getElementById('centralEqSyncVersoesBody');
    const list = body.versoes || [];
    if (!tbody) return;
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-muted">Sem versões.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map((v) => `
      <tr>
        <td>${v.versao}</td>
        <td class="small">${escapeHtmlCentralEq(v.inicio || v.fim || '')}</td>
        <td>${escapeHtmlCentralEq(v.usuario || String(v.usuario_id || '—'))}</td>
        <td>${v.itens || 0}</td>
        <td>${v.tempo_ms != null ? v.tempo_ms + 'ms' : '—'}</td>
        <td>${escapeHtmlCentralEq(v.status || '')}</td>
        <td class="small text-truncate" style="max-width:100px">${escapeHtmlCentralEq((v.hash || '').slice(0, 12))}</td>
        <td><button class="btn btn-sm btn-outline-secondary" onclick="centralEqSyncVerVersao(${v.versao})">Ver</button></td>
      </tr>
    `).join('');
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqSyncVerVersao(versao) {
  const alvo = centralEqSyncAlvo();
  try {
    const qs = new URLSearchParams();
    if (alvo.host) qs.set('host', alvo.host);
    if (alvo.porta) qs.set('porta', String(alvo.porta));
    const resp = await fetch(`${centralEqApi()}/equipamentos/sync/version/${encodeURIComponent(versao)}?${qs}`, {
      headers: centralEqHeaders()
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    const blob = new Blob([JSON.stringify(body.versao, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sync-versao-${versao}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqSyncCompararVersoes() {
  const alvo = centralEqSyncAlvo();
  const a = document.getElementById('syncVerA')?.value;
  const b = document.getElementById('syncVerB')?.value;
  if (a == null || b == null || a === '' || b === '') {
    if (typeof showNotification === 'function') showNotification('Informe versões A e B.', 'warning');
    return;
  }
  try {
    const qs = new URLSearchParams({ a, b });
    if (alvo.host) qs.set('host', alvo.host);
    if (alvo.porta) qs.set('porta', String(alvo.porta));
    const resp = await fetch(`${centralEqApi()}/equipamentos/sync/compare?${qs}`, {
      headers: centralEqHeaders()
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    centralEqSyncAba('alteracoes');
    centralEqSyncRenderDelta(body.delta);
    if (typeof showNotification === 'function') {
      showNotification(`Comparação v${a} × v${b}: ${body.delta?.resumo?.totalMudancas || 0} mud.`, 'info');
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqSyncRollback() {
  const alvo = centralEqSyncAlvo();
  if (!alvo.host || !alvo.porta) {
    if (typeof showNotification === 'function') showNotification('Informe host e porta.', 'warning');
    return;
  }
  if (!window.confirm('Restaurar última carga bem-sucedida? O histórico será preservado.')) return;
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/sync/rollback`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({ ...alvo, reenviar: false })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    const labRb = document.getElementById('labSyncRollback');
    if (labRb) labRb.textContent = `← v${body.restoredFrom?.versao || '?'}`;
    if (typeof showNotification === 'function') {
      showNotification(`Rollback para v${body.restoredFrom?.versao} (nova v${body.rollbackVersao})`, 'success');
    }
    centralEqSyncVerVersoes();
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

/**
 * Sprint 14.9 — Pesagem
 */
function centralEqMostrarPeso() {
  const painel = document.getElementById('centralEqPesoPainel');
  if (painel) painel.style.display = '';
  const lista = window.__centralEqDescobertosV1 || [];
  const eq = lista.find((e) => e._driver || e._connStatus === 'CONNECTED') || lista[0];
  if (eq) {
    const h = document.getElementById('pesoHost');
    const p = document.getElementById('pesoPorta');
    if (h && !h.value) h.value = eq.host || '';
    if (p && eq.porta) p.value = eq.porta;
  }
  centralEqPesoHistorico();
}

function centralEqPesoAlvo() {
  return {
    host: document.getElementById('pesoHost')?.value?.trim(),
    porta: Number(document.getElementById('pesoPorta')?.value || 0)
  };
}

function centralEqPesoExibir(result) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const peso = Number(result.peso);
  set('pesoValor', Number.isFinite(peso)
    ? peso.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    : '—');
  set('pesoUnidade', result.unidade || 'kg');
  set('pesoEstavel', result.estavel || result.estabilidade ? 'Estável' : 'Instável');
  const hora = result.lido_em ? new Date(result.lido_em) : new Date();
  set('pesoHora', hora.toLocaleTimeString('pt-BR'));
}

async function centralEqPesoLer() {
  const alvo = centralEqPesoAlvo();
  if (!alvo.host || !alvo.porta) {
    if (typeof showNotification === 'function') showNotification('Informe host e porta.', 'warning');
    return;
  }
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/weight/read`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify(alvo)
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    centralEqPesoExibir(body);
    await centralEqPesoHistorico();
    if (typeof showNotification === 'function') {
      showNotification(`Peso: ${body.peso} ${body.unidade || 'kg'}`, 'success');
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqPesoHistorico() {
  try {
    const alvo = centralEqPesoAlvo();
    const q = new URLSearchParams({ limite: '30' });
    if (alvo.host) q.set('host', alvo.host);
    if (alvo.porta) q.set('porta', String(alvo.porta));
    const resp = await fetch(`${centralEqApi()}/equipamentos/weight/history?${q}`, {
      headers: centralEqHeaders()
    });
    const body = await resp.json().catch(() => ({}));
    const tbody = document.getElementById('centralEqPesoHistBody');
    if (!tbody) return;
    const rows = body.historico || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Sem pesagens.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td>${escapeHtmlCentralEq(r.peso != null ? Number(r.peso).toFixed(3) : '—')}</td>
        <td>${escapeHtmlCentralEq(r.unidade || 'kg')}</td>
        <td>${r.estavel ? 'Sim' : 'Não'}</td>
        <td class="small">${escapeHtmlCentralEq(r.lido_em ? new Date(r.lido_em).toLocaleString('pt-BR') : '—')}</td>
        <td>${escapeHtmlCentralEq(r.duracao_ms != null ? String(r.duracao_ms) : '—')}</td>
        <td class="small text-danger">${escapeHtmlCentralEq(r.erro || '')}</td>
      </tr>
    `).join('');
  } catch (_) { /* ignore */ }
}

/**
 * Sprint 15.7 — Drivers Instalados (Device Profile SDK)
 */
function centralEqMostrarDriversSdk() {
  const painel = document.getElementById('centralEqDriversSdkPainel');
  if (painel) painel.style.display = '';
  centralEqDriversSdkRefresh();
}

function centralEqDriversSdkCapsHtml(caps) {
  const lista = Array.isArray(caps)
    ? caps
    : Object.keys(caps || {}).filter((k) => caps[k]);
  if (!lista.length) return '<span class="text-muted">—</span>';
  return lista.slice(0, 8).map((c) =>
    `<span class="badge bg-secondary me-1 mb-1">${escapeHtmlCentralEq(c)}</span>`
  ).join('') + (lista.length > 8 ? `<span class="text-muted">+${lista.length - 8}</span>` : '');
}

function centralEqDriversSdkEstadoBadge(estado) {
  const e = String(estado || '—');
  const map = { pronto: 'success', manifesto: 'warning', registrado: 'info', erro: 'danger' };
  const cls = map[e] || 'secondary';
  return `<span class="badge bg-${cls}">${escapeHtmlCentralEq(e)}</span>`;
}

async function centralEqDriversSdkRefresh() {
  const body = document.getElementById('centralEqDriversSdkBody');
  const meta = document.getElementById('centralEqDriversSdkMeta');
  if (body) body.innerHTML = '<tr><td colspan="7" class="text-muted">Carregando…</td></tr>';
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${centralEqApi()}/equipamentos/drivers`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.error || 'Falha ao listar drivers');
    const drivers = data.drivers || [];
    const rel = data.relatorio || {};
    if (meta) {
      meta.textContent = `${drivers.length} driver(s) · carga ${rel.tempoTotalMs != null ? rel.tempoTotalMs + ' ms' : '—'} · ${rel.timestamp ? new Date(rel.timestamp).toLocaleString('pt-BR') : ''}`;
    }
    if (!drivers.length) {
      if (body) body.innerHTML = '<tr><td colspan="7" class="text-muted">Nenhum driver no registry SDK.</td></tr>';
      return;
    }
    if (body) {
      body.innerHTML = drivers.map((d) => `
        <tr>
          <td>${escapeHtmlCentralEq(d.fabricante || '—')}</td>
          <td>
            <strong>${escapeHtmlCentralEq(d.modelo || d.nomeExibicao || '—')}</strong>
            <div class="small text-muted">${escapeHtmlCentralEq(d.id || '')}</div>
          </td>
          <td>${escapeHtmlCentralEq(d.versao || '—')}</td>
          <td><span class="badge bg-light text-dark border">${escapeHtmlCentralEq(d.categoria || '—')}</span></td>
          <td style="max-width:240px">${centralEqDriversSdkCapsHtml(d.capabilitiesLista || d.capabilities)}</td>
          <td>${centralEqDriversSdkEstadoBadge(d.estado)}</td>
          <td class="text-center">${escapeHtmlCentralEq(String(d.equipamentosCount ?? 0))}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    if (body) body.innerHTML = `<tr><td colspan="7" class="text-danger">${escapeHtmlCentralEq(err.message)}</td></tr>`;
    if (meta) meta.textContent = 'Erro ao carregar SDK';
  }
}

async function centralEqDriversSdkReload() {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${centralEqApi()}/equipamentos/drivers/reload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.error || 'Falha no reload');
    if (typeof showNotification === 'function') {
      showNotification(`Drivers recarregados: ${data.relatorio?.totalRegistrados ?? 'ok'}`, 'success');
    }
    await centralEqDriversSdkRefresh();
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqDriversSdkLab() {
  const out = document.getElementById('centralEqDriversSdkLabOut');
  if (out) out.style.display = '';
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${centralEqApi()}/equipamentos/drivers/laboratorio`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.error || 'Falha lab SDK');
    if (out) out.textContent = JSON.stringify(data.laboratorio || data, null, 2);
  } catch (err) {
    if (out) out.textContent = err.message;
  }
}

/**
 * Sprint 15.6 — Central de Orquestração de Balanças
 */
window.__centralEqOrqTimer = window.__centralEqOrqTimer || null;
window.__centralEqOrqState = window.__centralEqOrqState || { dashboard: null };

function centralEqMostrarOrquestrador() {
  const painel = document.getElementById('centralEqOrqPainel');
  if (painel) painel.style.display = '';
  centralEqOrqRefresh();
  if (!window.__centralEqOrqTimer) {
    window.__centralEqOrqTimer = setInterval(() => {
      const p = document.getElementById('centralEqOrqPainel');
      if (p && p.style.display !== 'none') centralEqOrqRefresh(false);
    }, 4000);
  }
}

function centralEqOrqStopPoll() {
  if (window.__centralEqOrqTimer) {
    clearInterval(window.__centralEqOrqTimer);
    window.__centralEqOrqTimer = null;
  }
}

function centralEqOrqBadgeStatus(st) {
  const s = String(st || 'DESCONHECIDO').toUpperCase();
  const map = {
    ONLINE: 'success',
    OFFLINE: 'danger',
    SINCRONIZANDO: 'primary',
    ERRO: 'warning',
    DESCONHECIDO: 'secondary'
  };
  return `<span class="badge bg-${map[s] || 'secondary'}">${s}</span>`;
}

async function centralEqOrqRefresh(notify) {
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/dashboard?refresh=1`, {
      headers: centralEqHeaders()
    });
    const body = await resp.json();
    if (!resp.ok || body.success === false) throw new Error(body.error || 'Falha no dashboard');
    const d = body.dashboard || {};
    window.__centralEqOrqState.dashboard = d;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('orqQtd', d.quantidade ?? 0);
    set('orqOnline', d.online ?? 0);
    set('orqOffline', d.offline ?? 0);
    set('orqSync', d.sincronizando ?? 0);
    set('orqErro', d.erro ?? 0);
    set('orqFila', `${d.fila?.pendentes ?? 0}/${d.fila?.executando ?? 0}`);
    set('orqTempo', d.tempoMedioMs != null ? `${d.tempoMedioMs} ms` : '—');
    set('orqUltimaSync', d.ultimaSincronizacao
      ? new Date(d.ultimaSincronizacao).toLocaleString('pt-BR')
      : '—');

    const tbody = document.getElementById('centralEqOrqBody');
    const eqs = d.equipamentos || [];
    if (tbody) {
      tbody.innerHTML = eqs.length ? eqs.map((e, idx) => `
        <tr>
          <td>${escapeHtmlCentralEq(e.nome || '—')}</td>
          <td>${escapeHtmlCentralEq(e.host || '—')}:${e.porta || 9000}</td>
          <td>${centralEqOrqBadgeStatus(e.status)}</td>
          <td>${escapeHtmlCentralEq(e.firmware || '—')}</td>
          <td>${e.carga != null ? e.carga : '—'}</td>
          <td>${e.ultimaSync ? new Date(e.ultimaSync).toLocaleString('pt-BR') : '—'}</td>
          <td>${e.tempoRespostaMs != null ? e.tempoRespostaMs + ' ms' : '—'}</td>
          <td>${e.fila ?? 0}</td>
          <td class="text-nowrap">
            <button class="btn btn-link btn-sm p-0 me-1" onclick="centralEqOrqAcao(${idx},'CONNECT')" title="Conectar">Conectar</button>
            <button class="btn btn-link btn-sm p-0 me-1" onclick="centralEqOrqAcao(${idx},'SYNC_DELTA')" title="Sincronizar">Sync</button>
            <button class="btn btn-link btn-sm p-0 me-1" onclick="centralEqOrqAcao(${idx},'DIAGNOSTIC')" title="Diagnóstico">Diag</button>
            <button class="btn btn-link btn-sm p-0" onclick="centralEqOrqHistorico(${idx})" title="Histórico">Hist</button>
          </td>
        </tr>
      `).join('') : '<tr><td colspan="9" class="text-muted">Nenhuma balança no parque. Cadastre equipamentos ou rode Health Check.</td></tr>';
    }

    const notifsEl = document.getElementById('centralEqOrqNotifs');
    const notifs = d.notificacoes || [];
    if (notifsEl) {
      notifsEl.innerHTML = notifs.length
        ? notifs.map((n) => `<div class="mb-2"><span class="badge bg-${n.severidade === 'error' ? 'danger' : (n.severidade === 'warning' ? 'warning' : 'secondary')}">${escapeHtmlCentralEq(n.tipo)}</span><br><small>${escapeHtmlCentralEq(n.mensagem || n.titulo || '')}</small></div>`).join('')
        : '<span class="text-muted">Sem alertas.</span>';
    }
    if (notify) showNotification('Dashboard atualizado', 'success');
  } catch (err) {
    showNotification(err.message || 'Erro no dashboard', 'error');
  }
}

async function centralEqOrqSyncTodas(tipo) {
  const d = window.__centralEqOrqState.dashboard;
  let eqs = d?.equipamentos || [];
  if (!eqs.length) {
    try {
      const lista = await fetch(`${centralEqApi()}/equipamentos`, { headers: centralEqHeaders() }).then((r) => r.json());
      eqs = (lista.equipamentos || lista.data || []).map((e) => ({
        equipamentoId: e.id,
        nome: e.nome,
        host: e.host || e.ip || e.endereco_ip,
        porta: e.porta || e.porta_tcp || 9000,
        firmware: e.firmware
      }));
    } catch (_) { /* ignore */ }
  }
  if (!eqs.length) {
    showNotification('Nenhuma balança para sincronizar', 'warning');
    return;
  }
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/jobs`, {
      method: 'POST',
      headers: { ...centralEqHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo: tipo || 'SYNC_DELTA',
        equipamentos: eqs.map((e) => ({
          equipamentoId: e.equipamentoId || e.id,
          nome: e.nome,
          host: e.host,
          porta: e.porta || 9000,
          firmware: e.firmware
        })),
        payload: { confirm: true, produtos: [] }
      })
    });
    const body = await resp.json();
    if (!resp.ok || body.success === false) throw new Error(body.error || 'Falha ao criar jobs');
    showNotification(`${body.total} job(s) enfileirado(s)`, 'success');
    setTimeout(() => centralEqOrqRefresh(false), 800);
  } catch (err) {
    showNotification(err.message || 'Erro ao sincronizar', 'error');
  }
}

async function centralEqOrqAcao(idx, tipo) {
  const e = window.__centralEqOrqState.dashboard?.equipamentos?.[idx];
  if (!e) return;
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/jobs`, {
      method: 'POST',
      headers: { ...centralEqHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo,
        equipamentos: [{
          equipamentoId: e.equipamentoId,
          nome: e.nome,
          host: e.host,
          porta: e.porta,
          firmware: e.firmware
        }],
        payload: { confirm: true, produtos: [] }
      })
    });
    const body = await resp.json();
    if (!resp.ok || body.success === false) throw new Error(body.error || 'Falha');
    showNotification(`Job ${tipo} criado`, 'success');
    setTimeout(() => centralEqOrqRefresh(false), 600);
  } catch (err) {
    showNotification(err.message || 'Erro na ação', 'error');
  }
}

async function centralEqOrqHealth() {
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/health?check=1`, {
      method: 'POST',
      headers: { ...centralEqHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ check: true })
    });
    const body = await resp.json();
    if (!resp.ok || body.success === false) throw new Error(body.error || 'Health falhou');
    showNotification(`Health: ${body.resumo?.online || 0} online / ${body.resumo?.offline || 0} offline`, 'info');
    await centralEqOrqRefresh(false);
  } catch (err) {
    showNotification(err.message || 'Erro no health', 'error');
  }
}

async function centralEqOrqAgendar() {
  const d = window.__centralEqOrqState.dashboard;
  const eqs = (d?.equipamentos || []).map((e) => ({
    equipamentoId: e.equipamentoId,
    nome: e.nome,
    host: e.host,
    porta: e.porta
  }));
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/scheduler`, {
      method: 'POST',
      headers: { ...centralEqHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Sync diário 03:00',
        tipo: 'diario',
        hora: '03:00',
        modoSync: 'SYNC_DELTA',
        equipamentos: eqs
      })
    });
    const body = await resp.json();
    if (!resp.ok || body.success === false) throw new Error(body.error || 'Falha ao agendar');
    showNotification(`Agenda criada: ${body.agenda?.nome || 'ok'}`, 'success');
  } catch (err) {
    showNotification(err.message || 'Erro ao agendar', 'error');
  }
}

async function centralEqOrqHistorico(idx) {
  const e = window.__centralEqOrqState.dashboard?.equipamentos?.[idx];
  if (!e) return;
  try {
    const qs = new URLSearchParams({ limite: '30' });
    if (e.equipamentoId != null) qs.set('equipamentoId', e.equipamentoId);
    const resp = await fetch(`${centralEqApi()}/equipamentos/jobs?${qs}`, { headers: centralEqHeaders() });
    const body = await resp.json();
    const jobs = body.jobs || [];
    const msg = jobs.length
      ? jobs.slice(0, 8).map((j) => `${j.status} ${j.tipo} ${j.finalizadoEm || j.criadoEm || ''}`).join('\n')
      : 'Sem jobs no histórico.';
    showNotification(msg, 'info');
  } catch (err) {
    showNotification(err.message || 'Erro no histórico', 'error');
  }
}

/**
 * Sprint 14.10 — Monitor de Equipamentos
 */
window.__centralEqMonTimer = window.__centralEqMonTimer || null;

/**
 * Sprint 15.8 — Observabilidade / Certificação
 */
function centralEqMostrarObservabilidade() {
  const painel = document.getElementById('centralEqObsPainel');
  if (painel) painel.style.display = '';
  centralEqObsAba('dash');
  centralEqObsRefresh();
}

function centralEqObsAba(aba) {
  const dash = document.getElementById('centralEqObsDash');
  const cert = document.getElementById('centralEqObsCert');
  const lab = document.getElementById('centralEqObsLab');
  if (dash) dash.style.display = aba === 'dash' ? '' : 'none';
  if (cert) cert.style.display = aba === 'cert' ? '' : 'none';
  if (lab) lab.style.display = aba === 'lab' ? '' : 'none';
  ['obsTabDashBtn', 'obsTabCertBtn', 'obsTabLabBtn'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('active', (id === 'obsTabDashBtn' && aba === 'dash')
      || (id === 'obsTabCertBtn' && aba === 'cert')
      || (id === 'obsTabLabBtn' && aba === 'lab'));
  });
}

async function centralEqObsFetch(path, options = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${centralEqApi()}/equipamentos${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || data.message || `HTTP ${res.status}`);
  }
  return data;
}

function centralEqObsSet(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val == null || val === '' ? '—' : String(val);
}

async function centralEqObsRefresh() {
  try {
    const [perf, alerts, tele] = await Promise.all([
      centralEqObsFetch('/performance'),
      centralEqObsFetch('/alerts'),
      centralEqObsFetch('/telemetry')
    ]);
    const h = perf.health?.indicadores || {};
    const p = perf.performance || {};
    const c = tele.telemetry?.contadores || {};
    centralEqObsSet('obsOnline', h.online);
    centralEqObsSet('obsOffline', h.offline);
    centralEqObsSet('obsAlertas', (alerts.alerts || []).length);
    centralEqObsSet('obsJobs', h.jobs);
    centralEqObsSet('obsTempoMedio', p.tempoResposta?.media != null ? `${Math.round(p.tempoResposta.media)} ms` : '—');
    centralEqObsSet('obsLatencia', p.latencia?.media != null ? `${Math.round(p.latencia.media)} ms` : '—');
    centralEqObsSet('obsRecon', c.reconexoes ?? h.reconexoes ?? 0);

    const box = document.getElementById('centralEqObsAlertas');
    const lista = alerts.alerts || [];
    if (box) {
      box.innerHTML = lista.length
        ? lista.map((a) => `<div class="mb-1"><span class="badge bg-${a.severidade === 'critical' ? 'danger' : 'warning'}">${escapeHtmlCentralEq(a.severidade)}</span> <strong>${escapeHtmlCentralEq(a.titulo || a.codigo)}</strong> — ${escapeHtmlCentralEq(a.mensagem || '')}</div>`).join('')
        : '<span class="text-muted">Nenhum alerta ativo.</span>';
    }
    const pre = document.getElementById('centralEqObsPerf');
    if (pre) pre.textContent = JSON.stringify({
      disponibilidade: p.disponibilidade,
      taxaErro: p.taxaErro,
      eficienciaSync: p.eficienciaSync,
      latencia: p.latencia,
      statusSaude: perf.health?.status
    }, null, 2);
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqObsCertRun() {
  const driverId = document.getElementById('obsCertDriver')?.value || 'toledo-prix4';
  try {
    const data = await centralEqObsFetch('/certification/run', {
      method: 'POST',
      body: JSON.stringify({ driverId })
    });
    centralEqObsRenderCert(data);
    if (typeof showNotification === 'function') {
      showNotification(`Certificação: ${data.resultado?.resultado} (nota ${data.resultado?.nota})`, 'success');
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqObsCertRunAll() {
  try {
    const data = await centralEqObsFetch('/certification/run', {
      method: 'POST',
      body: JSON.stringify({ todos: true })
    });
    const first = (data.salvos || [])[0];
    if (first) {
      document.getElementById('obsCertDriver').value = first.driverId;
      await centralEqObsCertReport();
    }
    if (typeof showNotification === 'function') {
      showNotification(`Certificados: ${(data.salvos || []).length} driver(s)`, 'success');
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqObsCertReport() {
  const driverId = document.getElementById('obsCertDriver')?.value || '';
  try {
    const q = driverId ? `?driverId=${encodeURIComponent(driverId)}` : '';
    const data = await centralEqObsFetch(`/certification/report${q}`);
    centralEqObsRenderCert({
      resultado: {
        resultado: data.report.resultado,
        nota: data.report.nota,
        driverId: data.report.driverId,
        driverVersao: data.report.driverVersao,
        checklist: data.report.checklist,
        falhas: data.report.falhas,
        tempoMs: data.report.tempoMs
      },
      relatorio: { markdown: data.report.relatorioMd }
    });
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'warning');
  }
}

function centralEqObsRenderCert(data) {
  const r = data.resultado || {};
  const resumo = document.getElementById('centralEqObsCertResumo');
  if (resumo) {
    resumo.innerHTML = `<strong>${escapeHtmlCentralEq(r.resultado || '—')}</strong> · Nota <strong>${escapeHtmlCentralEq(r.nota)}</strong> · Driver <code>${escapeHtmlCentralEq(r.driverId || '')}</code> · v${escapeHtmlCentralEq(r.driverVersao || '—')} · ${escapeHtmlCentralEq(r.tempoMs != null ? r.tempoMs + ' ms' : '')}`;
  }
  const body = document.getElementById('centralEqObsCertBody');
  const checklist = r.checklist || [];
  if (body) {
    body.innerHTML = checklist.length
      ? checklist.map((i) => {
        const badge = i.status === 'OK' ? 'success' : (i.status === 'FAIL' ? 'danger' : 'secondary');
        return `<tr><td>${escapeHtmlCentralEq(i.label)}</td><td><span class="badge bg-${badge}">${escapeHtmlCentralEq(i.status)}</span></td><td class="small">${escapeHtmlCentralEq(i.note || '')}</td></tr>`;
      }).join('')
      : '<tr><td colspan="3" class="text-muted">Sem checklist.</td></tr>';
  }
  const md = document.getElementById('centralEqObsCertMd');
  if (md && data.relatorio?.markdown) {
    md.style.display = '';
    md.textContent = data.relatorio.markdown;
  }
}

async function centralEqObsLabRefresh() {
  const out = document.getElementById('centralEqObsLabOut');
  try {
    const [events, tele, alerts] = await Promise.all([
      centralEqObsFetch('/events?limite=40'),
      centralEqObsFetch('/telemetry'),
      centralEqObsFetch('/alerts')
    ]);
    if (out) {
      out.textContent = JSON.stringify({
        eventos: events.events,
        telemetria: tele.telemetry,
        alertas: alerts.alerts
      }, null, 2);
    }
  } catch (err) {
    if (out) out.textContent = err.message;
  }
}

function centralEqMostrarMonitor() {
  const painel = document.getElementById('centralEqMonitorPainel');
  if (painel) painel.style.display = '';
  const lista = window.__centralEqDescobertosV1 || [];
  const eq = lista.find((e) => e._driver || e._connStatus === 'CONNECTED') || lista[0];
  if (eq) {
    const h = document.getElementById('monHost');
    const p = document.getElementById('monPorta');
    if (h && !h.value) h.value = eq.host || '';
    if (p && eq.porta) p.value = eq.porta;
  }
  centralEqMonitorRefresh();
  if (!window.__centralEqMonTimer) {
    window.__centralEqMonTimer = setInterval(() => {
      const painelAberto = document.getElementById('centralEqMonitorPainel');
      if (painelAberto && painelAberto.style.display !== 'none') {
        centralEqMonitorRefresh();
      }
    }, 2000);
  }
}

function centralEqMonitorFechar() {
  const painel = document.getElementById('centralEqMonitorPainel');
  if (painel) painel.style.display = 'none';
}

function centralEqMonitorAlvo() {
  return {
    host: document.getElementById('monHost')?.value?.trim(),
    porta: Number(document.getElementById('monPorta')?.value || 0),
    intervalMs: Number(document.getElementById('monInterval')?.value || 5000),
    timeoutMs: Number(document.getElementById('monTimeout')?.value || 2000)
  };
}

function centralEqMonitorExibir(st) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const last = st.last || {};
  const session = st.session || {};
  const online = last.online === true || session.online === true;
  set('monStatus', online ? '🟢 Online' : (st.active ? '🔴 Offline' : '—'));
  set('monLatencia', last.latencia != null ? `${last.latencia} ms` : (session.latencia != null ? `${session.latencia} ms` : '—'));
  set('monHeartbeat', last.heartbeat || session.heartbeat || '—');
  const uv = last.ultimaVerificacao || session.ultimaVerificacao;
  set('monUltima', uv ? new Date(uv).toLocaleTimeString('pt-BR') : '—');
  set('monAtivo', st.paused ? 'Pausado' : (st.active ? 'Ativo' : 'Parado'));
}

async function centralEqMonitorIniciar() {
  const alvo = centralEqMonitorAlvo();
  if (!alvo.host || !alvo.porta) {
    if (typeof showNotification === 'function') showNotification('Informe host e porta.', 'warning');
    return;
  }
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/monitor/start`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({
        host: alvo.host,
        porta: alvo.porta,
        intervalMs: alvo.intervalMs,
        timeoutMs: alvo.timeoutMs,
        monitorEnabled: true
      })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    await centralEqMonitorRefresh();
    if (typeof showNotification === 'function') showNotification('Monitor iniciado', 'success');
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqMonitorPausar() {
  try {
    const st = await (await fetch(`${centralEqApi()}/equipamentos/monitor/status`, {
      headers: centralEqHeaders()
    })).json();
    if (st.paused) {
      await fetch(`${centralEqApi()}/equipamentos/monitor/resume`, {
        method: 'POST',
        headers: centralEqHeaders(),
        body: '{}'
      });
    } else {
      await fetch(`${centralEqApi()}/equipamentos/monitor/pause`, {
        method: 'POST',
        headers: centralEqHeaders(),
        body: '{}'
      });
    }
    await centralEqMonitorRefresh();
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqMonitorParar() {
  try {
    await fetch(`${centralEqApi()}/equipamentos/monitor/stop`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: '{}'
    });
    await centralEqMonitorRefresh();
    if (typeof showNotification === 'function') showNotification('Monitor parado', 'info');
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqMonitorRefresh() {
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/monitor/status`, {
      headers: centralEqHeaders()
    });
    const st = await resp.json().catch(() => ({}));
    centralEqMonitorExibir(st);
    const alvo = centralEqMonitorAlvo();
    const q = new URLSearchParams({ limite: '30' });
    if (alvo.host) q.set('host', alvo.host);
    if (alvo.porta) q.set('porta', String(alvo.porta));
    const histResp = await fetch(`${centralEqApi()}/equipamentos/monitor/history?${q}`, {
      headers: centralEqHeaders()
    });
    const hist = await histResp.json().catch(() => ({}));
    const tbody = document.getElementById('centralEqMonHistBody');
    if (!tbody) return;
    const rows = hist.historico || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Sem eventos.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td class="small">${escapeHtmlCentralEq(r.registrado_em ? new Date(r.registrado_em).toLocaleTimeString('pt-BR') : '—')}</td>
        <td>${escapeHtmlCentralEq(r.status || '')}</td>
        <td>${escapeHtmlCentralEq(r.heartbeat || '')}</td>
        <td>${escapeHtmlCentralEq(r.latencia != null ? `${r.latencia} ms` : '—')}</td>
        <td class="small">${escapeHtmlCentralEq(r.evento || '')}</td>
      </tr>
    `).join('');
  } catch (_) { /* ignore */ }
}

/**
 * Sprint 14.11 — Configuração Toledo
 */
window.__centralEqConfigState = window.__centralEqConfigState || {
  atual: null,
  itens: [],
  profileId: null
};

function centralEqMostrarConfig() {
  const painel = document.getElementById('centralEqConfigPainel');
  if (painel) painel.style.display = '';
  const lista = window.__centralEqDescobertosV1 || [];
  const eq = lista.find((e) => e._driver || e._connStatus === 'CONNECTED') || lista[0];
  if (eq) {
    const h = document.getElementById('cfgHost');
    const p = document.getElementById('cfgPorta');
    if (h && !h.value) h.value = eq.host || '';
    if (p && eq.porta) p.value = eq.porta;
  }
}

function centralEqConfigAlvo() {
  return {
    host: document.getElementById('cfgHost')?.value?.trim(),
    porta: Number(document.getElementById('cfgPorta')?.value || 0)
  };
}

function centralEqConfigRender(itens) {
  const tbody = document.getElementById('centralEqConfigBody');
  if (!tbody) return;
  if (!itens || !itens.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Sem parâmetros.</td></tr>';
    return;
  }
  tbody.innerHTML = itens.map((i, idx) => {
    const editavel = i.editavel !== false;
    const valorNovo = i.valorNovo != null ? i.valorNovo : (i.valorAtual != null ? i.valorAtual : '');
    return `
      <tr data-param="${escapeHtmlCentralEq(i.parametro)}">
        <td>${escapeHtmlCentralEq(i.parametro || '')}</td>
        <td>${escapeHtmlCentralEq(i.valorAtual != null ? String(i.valorAtual) : '—')}</td>
        <td>
          ${editavel
    ? `<input class="form-control form-control-sm cfg-valor-novo" data-idx="${idx}" value="${escapeHtmlCentralEq(String(valorNovo))}">`
    : `<span class="text-muted">${escapeHtmlCentralEq(String(i.valorAtual != null ? i.valorAtual : '—'))}</span>`}
        </td>
        <td>${escapeHtmlCentralEq(i.status || '—')}</td>
      </tr>
    `;
  }).join('');
}

function centralEqConfigColetarNovos() {
  const st = window.__centralEqConfigState;
  const parametros = {};
  document.querySelectorAll('.cfg-valor-novo').forEach((input) => {
    const idx = Number(input.getAttribute('data-idx'));
    const item = st.itens[idx];
    if (!item || item.editavel === false) return;
    let v = input.value;
    if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else if (v !== '' && !Number.isNaN(Number(v)) && String(Number(v)) === v) v = Number(v);
    parametros[item.parametro] = v;
  });
  return parametros;
}

async function centralEqConfigLer() {
  const alvo = centralEqConfigAlvo();
  if (!alvo.host || !alvo.porta) {
    if (typeof showNotification === 'function') showNotification('Informe host e porta.', 'warning');
    return;
  }
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/config/read`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify(alvo)
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    window.__centralEqConfigState.atual = body;
    window.__centralEqConfigState.profileId = body.profileId || null;
    if (body.profileId) {
      const el = document.getElementById('cfgProfileId');
      if (el) el.value = body.profileId;
    }
    const itens = Object.keys(body.parametros || {}).map((k) => {
      const meta = (body.meta || []).find((m) => m.nome === k);
      return {
        parametro: k,
        valorAtual: body.parametros[k],
        valorNovo: body.parametros[k],
        status: 'LIDO',
        editavel: meta ? meta.editavel !== false : k !== 'serial_number' && k !== 'firmware'
      };
    });
    window.__centralEqConfigState.itens = itens;
    centralEqConfigRender(itens);
    if (typeof showNotification === 'function') showNotification('Configuração lida', 'success');
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqConfigComparar() {
  const st = window.__centralEqConfigState;
  if (!st.atual) {
    if (typeof showNotification === 'function') showNotification('Leia a configuração antes.', 'warning');
    return;
  }
  const proposto = { parametros: centralEqConfigColetarNovos() };
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/config/compare`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({
        balanca: st.atual,
        cds: proposto
      })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    st.itens = body.comparacao?.itens || [];
    centralEqConfigRender(st.itens);
    if (typeof showNotification === 'function') {
      showNotification(`${body.comparacao?.alterados?.length || 0} diferença(s)`, 'info');
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqConfigAplicar() {
  const alvo = centralEqConfigAlvo();
  const parametros = centralEqConfigColetarNovos();
  if (!window.confirm('Aplicar alterações na balança?')) return;
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/config/write`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({ ...alvo, parametros })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    if (body.profileId) {
      window.__centralEqConfigState.profileId = body.profileId;
      const el = document.getElementById('cfgProfileId');
      if (el) el.value = body.profileId;
    }
    await centralEqConfigLer();
    if (typeof showNotification === 'function') showNotification('Configuração aplicada', 'success');
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqConfigRestaurar() {
  const alvo = centralEqConfigAlvo();
  const profileId = Number(document.getElementById('cfgProfileId')?.value || 0);
  if (!profileId) {
    if (typeof showNotification === 'function') showNotification('Informe o ID do perfil.', 'warning');
    return;
  }
  if (!window.confirm(`Restaurar perfil #${profileId}?`)) return;
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/config/restore`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({ ...alvo, profileId })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    await centralEqConfigLer();
    if (typeof showNotification === 'function') showNotification('Perfil restaurado', 'success');
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqConfigExportar() {
  const st = window.__centralEqConfigState;
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/config/export`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({
        profileId: st.profileId || Number(document.getElementById('cfgProfileId')?.value || 0) || undefined,
        config: st.atual
      })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    const blob = new Blob([JSON.stringify(body.perfil, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `toledo-config-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqConfigImportar(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const resp = await fetch(`${centralEqApi()}/equipamentos/config/import`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({ perfil: json, ...centralEqConfigAlvo() })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    if (body.profileId) {
      const el = document.getElementById('cfgProfileId');
      if (el) el.value = body.profileId;
      window.__centralEqConfigState.profileId = body.profileId;
    }
    const params = body.perfil?.parametros || {};
    window.__centralEqConfigState.itens = Object.keys(params).map((k) => ({
      parametro: k,
      valorAtual: window.__centralEqConfigState.atual?.parametros?.[k],
      valorNovo: params[k],
      status: 'IMPORTADO',
      editavel: k !== 'serial_number' && k !== 'firmware'
    }));
    centralEqConfigRender(window.__centralEqConfigState.itens);
    if (typeof showNotification === 'function') showNotification('Perfil importado', 'success');
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  } finally {
    if (event?.target) event.target.value = '';
  }
}

/**
 * Sprint 14.12 / RC14.12.1 / RC14.12.2 — Diagnóstico Enterprise (UX)
 */
const CENTRAL_EQ_DIAG_NAO_INFORMADO = 'Não informado';
window.__centralEqDiagLast = null;
window.__centralEqDiagEquipamentoId = null;

const CENTRAL_EQ_DIAG_CAP_LABELS = [
  { key: 'discovery', label: 'Discovery', fromArch: 'discovery' },
  { key: 'fingerprint', label: 'Fingerprint', fromArch: 'fingerprint' },
  { key: 'handshake', label: 'Handshake', cap: 'handshake' },
  { key: 'ping', label: 'Ping', cap: 'ping' },
  { key: 'uploadPLU', label: 'Upload PLU', cap: 'uploadPLU' },
  { key: 'downloadPLU', label: 'Download PLU', cap: 'downloadPLU' },
  { key: 'syncPLU', label: 'Sincronização', cap: 'syncPLU' },
  { key: 'readWeight', label: 'Peso', cap: 'readWeight' },
  { key: 'config', label: 'Configuração', cap: 'downloadConfig' },
  { key: 'monitor', label: 'Monitor', cap: 'monitor' },
  { key: 'diagnostico', label: 'Diagnóstico', always: true }
];

function centralEqDiagValor(v) {
  if (v === null || v === undefined || v === '') return CENTRAL_EQ_DIAG_NAO_INFORMADO;
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  return String(v);
}

function centralEqDiagAbrirPainel() {
  const painel = document.getElementById('centralEqDiagPainel');
  if (painel) {
    painel.style.display = '';
    try { painel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) { /* ignore */ }
  }
  console.log('[DIAG RC14.12.2] Painel aberto');
}

function centralEqMostrarDiag() {
  console.log('[DIAG RC14.14.5] Diagnóstico solicitado (toolbar)');
  centralEqDiagAbrirPainel();
  const cadastrados = centralEqCache || [];
  const lista = window.__centralEqDescobertosV1 || [];
  const eqCad = cadastrados.find((e) => e.ultimo_ip || e.ip) || cadastrados[0];
  const eqDisc = lista.find((e) => e._driver || e._connStatus === 'CONNECTED') || lista[0];
  const eq = eqCad || eqDisc;
  if (eq) {
    const alvo = centralEqDiagResolverAlvo(eq);
    const h = document.getElementById('diagHost');
    const p = document.getElementById('diagPorta');
    if (h && !h.value) h.value = alvo.host || eq.host || '';
    if (p) p.value = String(alvo.porta || eq.porta || 9000);
    if (eq.equipamento_id) {
      window.__centralEqDiagEquipamentoId = Number(eq.equipamento_id);
    }
  }
  centralEqDiagAtualizar();
}

function centralEqDiagFmtMs(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return CENTRAL_EQ_DIAG_NAO_INFORMADO;
  const s = Math.floor(Number(ms) / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  if (Number(ms) < 1000) return `${Math.round(Number(ms))} ms`;
  return `${s}s`;
}

function centralEqDiagLocalizarEquipamento(id) {
  const nid = Number(id);
  const naLista = (centralEqCache || []).find((e) => Number(e.equipamento_id) === nid);
  if (naLista) return naLista;
  const descobertos = window.__centralEqDescobertosV1 || [];
  return descobertos.find((e) => Number(e.equipamento_id) === nid) || null;
}

function centralEqDiagResolverAlvo(equipamento) {
  if (!equipamento) return { host: '', porta: 9000, driver: null };
  return {
    host: equipamento.ultimo_ip || equipamento.ip || equipamento.host || '',
    porta: Number(equipamento.porta_tcp || equipamento.porta || 9000) || 9000,
    driver: equipamento.driver_codigo || equipamento.fabricante || null
  };
}

function centralEqDiagSet(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = centralEqDiagValor(v);
}

function centralEqDiagStatusVisual(health) {
  const el = document.getElementById('diagStatusVisual');
  if (!el) return;
  el.classList.remove(
    'central-eq-diag-status--online',
    'central-eq-diag-status--offline',
    'central-eq-diag-status--connecting',
    'central-eq-diag-status--unknown'
  );
  // RC14.14.6 — preferir EquipmentSession quando presente
  const last = window.__centralEqDiagLast || {};
  const sess = last.session || last.monitor || {};
  const st = String(sess.state || sess.status || health?.status || '').toUpperCase();
  const online = sess.connected === true
    || sess.conectado === true
    || health?.online === true
    || st === 'CONNECTED'
    || st === 'OK'
    || st === 'IDLE'
    || st === 'BUSY';
  if (online) {
    el.classList.add('central-eq-diag-status--online');
    el.textContent = '🟢 Online';
  } else if (st === 'CONNECTING' || st === 'RECONNECTING') {
    el.classList.add('central-eq-diag-status--connecting');
    el.textContent = '🟡 Conectando';
  } else if (
    sess.connected === false
    || health?.online === false
    || st === 'OFFLINE'
    || st === 'DISCONNECTED'
    || st === 'DEGRADED'
    || st === 'ERROR'
  ) {
    el.classList.add('central-eq-diag-status--offline');
    el.textContent = '🔴 Offline';
  } else {
    el.classList.add('central-eq-diag-status--unknown');
    el.textContent = '⚪ Não informado';
  }
}

function centralEqDiagRenderCaps(body) {
  const capsEl = document.getElementById('centralEqDiagCaps');
  if (!capsEl) return;
  const caps = body.capabilities || {};
  const arch = body.arquitetura?.resultados || [];
  const archOk = (id) => arch.find((r) => r.id === id)?.status === 'OK';

  const items = CENTRAL_EQ_DIAG_CAP_LABELS.map((def) => {
    let ok = false;
    if (def.always) ok = true;
    else if (def.cap) ok = caps[def.cap] === true;
    else if (def.fromArch) ok = archOk(def.fromArch);
    return { label: def.label, ok };
  });

  capsEl.innerHTML = items.map((i) => (
    i.ok
      ? `<li class="ok">✔ ${escapeHtmlCentralEq(i.label)}</li>`
      : `<li class="off">○ Não suportado — ${escapeHtmlCentralEq(i.label)}</li>`
  )).join('');
}

function centralEqDiagRenderHomologacao(body) {
  const list = document.getElementById('centralEqDiagCheckBody');
  const resumo = document.getElementById('centralEqDiagHomoResumo');
  const itens = body.checklist?.itens || [];
  const total = Number(body.checklist?.resumo?.total || itens.length || 0);
  const ok = Number(body.checklist?.resumo?.ok || itens.filter((i) => i.status === 'OK').length || 0);
  const pct = total > 0 ? Math.round((ok / total) * 100) : 0;
  const homologado = body.checklist?.homologado === true || body.homologacao?.prontoProducao === true;

  if (resumo) {
    resumo.innerHTML = total
      ? `<div class="central-eq-diag-homo__pct">${pct}%</div>
         <div class="central-eq-diag-homo__label">${homologado ? 'Homologado' : 'Em homologação'}</div>`
      : CENTRAL_EQ_DIAG_NAO_INFORMADO;
  }

  if (list) {
    list.innerHTML = itens.length
      ? itens.map((i) => {
        const okItem = i.status === 'OK';
        return okItem
          ? `<li class="ok">✔ ${escapeHtmlCentralEq(i.item || i.id || '')}</li>`
          : `<li class="off">○ ${escapeHtmlCentralEq(i.item || i.id || '')} — ${escapeHtmlCentralEq(i.status || CENTRAL_EQ_DIAG_NAO_INFORMADO)}</li>`;
      }).join('')
      : `<li class="text-muted">${CENTRAL_EQ_DIAG_NAO_INFORMADO}</li>`;
  }
}

function centralEqDiagRenderEtapas(body) {
  const box = document.getElementById('diagEtapasConexao');
  if (!box) return;
  const etapas = body.etapas_conexao?.etapas || [];
  if (!etapas.length) {
    box.innerHTML = `<li class="text-muted">${CENTRAL_EQ_DIAG_NAO_INFORMADO}</li>`;
    return;
  }
  box.innerHTML = etapas.map((e) => {
    const estado = e.estado || (e.ok === true ? 'OK' : (e.ok === false ? 'FALHA' : 'NAO_INICIADO'));
    let mark = '○';
    let cls = 'pending';
    if (estado === 'OK') { mark = '✔'; cls = 'ok'; }
    else if (estado === 'FALHA') { mark = '✖'; cls = 'off'; }
    else if (estado === 'NAO_EXECUTADO') { mark = '–'; cls = 'pending'; }
    const detalhe = e.erro && estado !== 'OK'
      ? ` — ${escapeHtmlCentralEq(e.erro)}`
      : (e.latenciaMs != null && estado === 'OK' ? ` — ${e.latenciaMs} ms` : '');
    const rotulo = e.rotulo && estado === 'FALHA' ? ` (${escapeHtmlCentralEq(e.rotulo)})` : '';
    return `<li class="${cls}">${mark} <strong>${escapeHtmlCentralEq(e.titulo || e.chave)}</strong>${rotulo}${detalhe}</li>`;
  }).join('');
}

function centralEqDiagRenderResumo(body) {
  const box = document.getElementById('centralEqDiagResumo');
  if (!box) return;
  const health = body.health || {};
  const etapas = body.etapas_conexao || {};
  const tcpOk = health.tcp?.ok === true
    || (etapas.etapas || []).find((e) => e.chave === 'TCP_CONNECT')?.ok === true;
  const hsFail = health.handshake?.ok === false
    || (etapas.etapas || []).find((e) => e.chave === 'HANDSHAKE')?.ok === false;
  const offline = health.online === false || String(health.status || '').toUpperCase() === 'OFFLINE';
  const homologado = body.checklist?.homologado === true || body.homologacao?.prontoProducao === true;
  const total = Number(body.checklist?.resumo?.total || 0);
  const ok = Number(body.checklist?.resumo?.ok || 0);
  const healthPct = total > 0 ? Math.round((ok / total) * 100) : (offline && !tcpOk ? 0 : 100);

  if (etapas.etapaFalha || (offline && !tcpOk) || hsFail) {
    const etapa = etapas.etapaFalhaTitulo || etapas.etapaFalha || (hsFail ? 'Handshake' : 'Conexão');
    const motivo = etapas.etapaFalhaErro
      || health.motivo
      || health.ultimoErro?.message
      || 'Falha na comunicação';
    const causa = etapas.etapaFalha === 'TCP_CONNECT'
      ? 'Socket.connect() falhou (timeout, refused ou host inacessível)'
      : (etapas.etapaFalha === 'HANDSHAKE'
        ? 'TCP estabeleceu, mas Handshake/ACK falhou (protocolo)'
        : 'Verificar etapa indicada no painel de conexão');
    box.innerHTML = `
      <div class="central-eq-diag-problema">
        <div><strong>Problema identificado</strong></div>
        <div>Etapa: ${escapeHtmlCentralEq(etapa)}</div>
        <div class="mt-2"><strong>Descrição</strong></div>
        <div>${escapeHtmlCentralEq(motivo)}</div>
        <div class="mt-2"><strong>Possível causa</strong></div>
        <div>${escapeHtmlCentralEq(causa)}</div>
        <div class="mt-2"><strong>Recomendação</strong></div>
        <div>${etapas.etapaFalha === 'TCP_CONNECT'
    ? 'Verificar IP/porta, firewall e cabo/rede'
    : 'Verificar firmware/protocolo 90AX e logs CONNECTION TRACE'}</div>
      </div>`;
    return;
  }

  box.innerHTML = `
    <dl class="central-eq-diag-dl central-eq-diag-dl--resumo">
      <div><dt>Equipamento</dt><dd>${offline && !tcpOk ? 'OFFLINE' : 'ONLINE'}</dd></div>
      <div><dt>Driver</dt><dd>OPERACIONAL</dd></div>
      <div><dt>TCP</dt><dd>${tcpOk ? 'OK' : '—'}</dd></div>
      <div><dt>Comunicação</dt><dd>${hsFail ? 'FALHA HANDSHAKE' : (offline && !tcpOk ? 'FALHA' : 'NORMAL')}</dd></div>
      <div><dt>Health</dt><dd>${healthPct}%</dd></div>
      <div><dt>Recomendação</dt><dd>${homologado ? 'Pronto para produção' : 'Concluir checklist de homologação'}</dd></div>
    </dl>`;
}

async function centralEqDiagCarregarHistoricoELogs(host, porta) {
  const histBody = document.getElementById('centralEqDiagHistBody');
  const logsBody = document.getElementById('centralEqDiagLogsBody');
  const q = new URLSearchParams({ limite: '20' });
  if (host) q.set('host', host);
  if (porta) q.set('porta', String(porta));

  let rows = [];
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos/operations/history?${q}`, {
      headers: centralEqHeaders()
    });
    const body = await resp.json().catch(() => ({}));
    rows = Array.isArray(body.historico) ? body.historico.slice(0, 20) : [];
  } catch (_) {
    rows = [];
  }

  if (histBody) {
    histBody.innerHTML = rows.length
      ? rows.map((r) => {
        const hora = r.finished_at || r.started_at
          ? new Date(r.finished_at || r.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          : CENTRAL_EQ_DIAG_NAO_INFORMADO;
        const resultado = r.status === 'SUCCESS' ? 'OK' : (r.status || CENTRAL_EQ_DIAG_NAO_INFORMADO);
        const tempo = r.duration != null ? `${r.duration} ms` : CENTRAL_EQ_DIAG_NAO_INFORMADO;
        const origem = r.origin || r.origem || r.source || 'Operações';
        return `<tr>
          <td>${escapeHtmlCentralEq(hora)}</td>
          <td>${escapeHtmlCentralEq(r.operation || CENTRAL_EQ_DIAG_NAO_INFORMADO)}</td>
          <td>${escapeHtmlCentralEq(resultado)}</td>
          <td>${escapeHtmlCentralEq(tempo)}</td>
          <td>${escapeHtmlCentralEq(origem)}</td>
        </tr>`;
      }).join('')
      : `<tr><td colspan="5" class="text-muted">${CENTRAL_EQ_DIAG_NAO_INFORMADO}</td></tr>`;
  }

  if (logsBody) {
    const eventos = [];
    const last = window.__centralEqDiagLast || {};
    if (last.generatedAt) {
      eventos.push({ tipo: 'INFO', msg: 'Diagnóstico gerado', data: last.generatedAt });
    }
    if (last.health?.online === true) eventos.push({ tipo: 'INFO', msg: 'Heartbeat OK / Online', data: last.health.checkedAt });
    if (last.health?.online === false) {
      eventos.push({
        tipo: 'WARN',
        msg: last.health.motivo || 'Sem comunicação',
        data: last.health.checkedAt
      });
    }
    rows.slice(0, 12).forEach((r) => {
      eventos.push({
        tipo: r.status === 'SUCCESS' ? 'INFO' : 'ERROR',
        msg: `${r.operation || 'Operação'} — ${r.status || ''}`,
        data: r.finished_at || r.started_at
      });
    });

    logsBody.innerHTML = eventos.length
      ? eventos.map((e) => {
        const data = e.data
          ? new Date(e.data).toLocaleString('pt-BR')
          : CENTRAL_EQ_DIAG_NAO_INFORMADO;
        return `<li><span class="tipo">${escapeHtmlCentralEq(e.tipo)}</span>
          <span class="msg">${escapeHtmlCentralEq(e.msg)}</span>
          <span class="data">${escapeHtmlCentralEq(data)}</span></li>`;
      }).join('')
      : `<li class="text-muted">${CENTRAL_EQ_DIAG_NAO_INFORMADO}</li>`;
  }
}

/**
 * Renderiza o painel Enterprise — nunca deixa campo vazio.
 */
function centralEqDiagRenderizar(body) {
  window.__centralEqDiagLast = body || {};
  const eq = body.equipamento || {};
  const health = body.health || {};
  const version = body.version || {};
  const perf = body.performance || {};
  const stats = body.estatisticas || {};

  centralEqDiagSet('diagFabricante', eq.fabricante || version.fabricante);
  centralEqDiagSet('diagModelo', eq.modelo || version.modelo);
  centralEqDiagSet('diagFirmware', eq.firmware || version.firmwareAlvo);
  centralEqDiagSet('diagVersao', version.driverVersion || version.homologacao);
  centralEqDiagSet('diagSerie', eq.numero_serie);
  // RC15.0.2 — Protocolo TCP/IP × Interface física (nunca inferir cabo por ter IP)
  const net = body.network || {};
  const ifaceLabel = net.interface_label
    || (net.interface === 'WLAN' ? 'WLAN'
      : (net.interface === 'ETHERNET' ? 'Ethernet'
        : (net.interface === 'UNKNOWN' ? 'Não informado pelo equipamento' : null)));
  centralEqDiagSet('diagProtocolo', net.protocol || (eq.ip || eq.porta ? 'TCP/IP' : null));
  centralEqDiagSet('diagInterface', ifaceLabel);
  centralEqDiagSet('diagTransporte', ifaceLabel);
  centralEqDiagSet('diagProtocoloRede', net.protocol || (eq.ip || eq.porta ? 'TCP/IP' : null));
  centralEqDiagSet('diagInterfaceRede', ifaceLabel);
  centralEqDiagSet(
    'diagDriverConn',
    version.driver || eq.driver || 'Toledo Prix IV Uno'
  );
  centralEqDiagSet(
    'diagModo',
    version.framing || version.protocolVersion || version.homologacao
      ? `Framing ${version.framing || version.protocolVersion || version.homologacao}`
      : null
  );
  centralEqDiagSet('diagStatusId', health.status);
  centralEqDiagSet('diagDriver', version.driver || eq.driver);

  centralEqDiagSet('diagIp', net.ip || eq.ip);
  centralEqDiagSet('diagPortaInfo', net.port != null ? net.port : (eq.porta != null ? eq.porta : eq.porta_com));
  centralEqDiagSet('diagStatus', health.status);
  centralEqDiagSet(
    'diagOnline',
    health.online === true ? 'Sim' : (health.online === false ? 'Não' : null)
  );
  centralEqDiagSet(
    'diagHeartbeat',
    health.heartbeat === true ? 'Ativo' : (health.heartbeat === false ? 'Inativo' : null)
  );
  centralEqDiagSet('diagLatencia', perf.pingMs != null ? `${perf.pingMs} ms` : null);
  centralEqDiagSet('diagUptime', health.uptimeMs != null ? centralEqDiagFmtMs(health.uptimeMs) : null);
  centralEqDiagSet(
    'diagTempoConectado',
    health.tempoConectadoMs != null
      ? centralEqDiagFmtMs(health.tempoConectadoMs)
      : (health.uptimeMs != null ? centralEqDiagFmtMs(health.uptimeMs) : null)
  );
  centralEqDiagSet(
    'diagUltimaCom',
    eq.ultima_comunicacao
      ? (typeof formatarDataCentralEq === 'function'
        ? formatarDataCentralEq(eq.ultima_comunicacao)
        : eq.ultima_comunicacao)
      : null
  );
  centralEqDiagSet('diagErro', health.ultimoErro?.message || health.motivo);
  centralEqDiagSet('diagOps', stats.operacoes);
  centralEqDiagSet('diagSync', stats.sincronizacoes);
  centralEqDiagSet('diagPeso', stats.pesagens);
  centralEqDiagSet('diagMon', stats.monitorTicks);
  centralEqDiagSet('diagTimestamp', body.generatedAt);
  centralEqDiagSet('diagHealth', health.status || (health.online === true ? 'OK' : null));

  centralEqDiagStatusVisual(health);

  const offlineBox = document.getElementById('centralEqDiagOffline');
  if (offlineBox) {
    const etapas = body.etapas_conexao || {};
    const tcpOk = (etapas.etapas || []).find((e) => e.chave === 'TCP_CONNECT')?.ok === true;
    const offline = (health.online === false || String(health.status || '').toUpperCase() === 'OFFLINE') && !tcpOk;
    if (offline || etapas.etapaFalha) {
      const motivo = etapas.etapaFalhaErro
        || health.motivo
        || health.ultimoErro?.message
        || 'Falha na comunicação';
      const titulo = etapas.etapaFalhaTitulo
        ? `Falha em ${etapas.etapaFalhaTitulo}`
        : (offline ? 'Status OFFLINE' : 'Diagnóstico');
      offlineBox.classList.remove('d-none');
      offlineBox.innerHTML = `<strong>${escapeHtmlCentralEq(titulo)}</strong> — ${escapeHtmlCentralEq(motivo)}`;
    } else {
      offlineBox.classList.add('d-none');
      offlineBox.textContent = '';
    }
  }

  centralEqDiagRenderEtapas(body);
  centralEqDiagRenderCaps(body);
  centralEqDiagRenderHomologacao(body);
  centralEqDiagRenderResumo(body);

  const host = document.getElementById('diagHost')?.value?.trim() || eq.ip;
  const porta = document.getElementById('diagPorta')?.value || eq.porta;
  centralEqDiagCarregarHistoricoELogs(host, porta);

  console.log('[DIAG RC14.12.2] Dados renderizados');
  return body;
}

function centralEqDiagExportar(formato) {
  const data = window.__centralEqDiagLast;
  if (!data || !Object.keys(data).length) {
    if (typeof showNotification === 'function') {
      showNotification('Atualize o diagnóstico antes de exportar.', 'warning');
    }
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  let blob;
  let nome;

  if (formato === 'txt') {
    const linhas = [
      'CDS — Diagnóstico Enterprise V1.0',
      `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
      '',
      JSON.stringify(data, null, 2)
    ];
    blob = new Blob([linhas.join('\n')], { type: 'text/plain;charset=utf-8' });
    nome = `diagnostico-equipamento-${ts}.txt`;
  } else {
    blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    nome = `diagnostico-equipamento-${ts}.json`;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  console.log('[DIAG RC14.12.2] Exportação realizada', formato);
  if (typeof showNotification === 'function') {
    showNotification(`Diagnóstico exportado (${String(formato).toUpperCase()})`, 'success');
  }
}

async function centralEqDiagAtualizar() {
  // RC14.14.5 — sempre executar comunicação real (probe ativo)
  const last = window.__centralEqDiagLast || {};
  const eqLast = last.equipamento || {};
  const netLast = last.network || {};
  const hEl = document.getElementById('diagHost');
  const pEl = document.getElementById('diagPorta');
  let host = hEl?.value?.trim()
    || netLast.ip
    || eqLast.ip
    || '';
  let porta = pEl?.value
    || (netLast.port != null ? String(netLast.port) : '')
    || (eqLast.porta != null ? String(eqLast.porta) : '')
    || '9000';

  const equipamentoId = window.__centralEqDiagEquipamentoId
    || last.equipamento_id
    || null;

  // Preferir POST por equipamento (resolve IP via cadastro + identidade)
  if (equipamentoId) {
    try {
      console.log('[DIAG RC14.14.5] Diagnóstico solicitado (POST equipamento)', {
        equipamentoId,
        host,
        porta
      });
      if (hEl && host) hEl.value = host;
      if (pEl && porta) pEl.value = String(porta);
      const body = await centralEqFetch(`/${equipamentoId}/diagnostico`, {
        method: 'POST',
        body: '{}'
      });
      const payload = body.diagnostico && body.diagnostico.health
        ? body.diagnostico
        : body;
      const ipOk = payload.network?.ip || payload.equipamento?.ip;
      const portaOk = payload.network?.port != null
        ? payload.network.port
        : payload.equipamento?.porta;
      if (hEl && ipOk) hEl.value = ipOk;
      if (pEl && portaOk != null) pEl.value = String(portaOk);
      centralEqDiagRenderizar(payload);
      if (typeof showNotification === 'function') {
        const offline = payload.health?.online === false;
        showNotification(
          offline
            ? `Diagnóstico: OFFLINE — ${payload.health?.motivo || 'Sem comunicação'}`
            : 'Diagnóstico atualizado (comunicação real)',
          offline ? 'warning' : 'success'
        );
      }
      return;
    } catch (errPost) {
      console.warn('[DIAG RC14.14.5] POST falhou, fallback GET', errPost.message);
    }
  }

  if (!host) {
    if (typeof showNotification === 'function') {
      showNotification('Informe o IP da balança para executar o diagnóstico', 'warning');
    }
    return;
  }

  const q = new URLSearchParams();
  q.set('host', host);
  q.set('porta', String(porta || 9000));
  q.set('probe', '1');
  try {
    console.log('[DIAG RC14.14.5] Diagnóstico solicitado (GET Toledo + probe)', { host, porta });
    const resp = await fetch(`${centralEqApi()}/equipamentos/driver/toledo/diagnostics?${q}`, {
      headers: centralEqHeaders()
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    if (hEl && body.network?.ip) hEl.value = body.network.ip;
    if (pEl && body.network?.port != null) pEl.value = String(body.network.port);
    centralEqDiagRenderizar(body);
    if (typeof showNotification === 'function') {
      const offline = body.health?.online === false;
      showNotification(
        offline
          ? `Diagnóstico: OFFLINE — ${body.health?.motivo || 'Sem comunicação'}`
          : 'Diagnóstico atualizado (comunicação real)',
        offline ? 'warning' : 'success'
      );
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqDiagnostico(id) {
  try {
    console.log('[DIAG RC14.14.5] Diagnóstico solicitado (linha)', { id });
    const equipamento = centralEqDiagLocalizarEquipamento(id);
    if (!equipamento) {
      throw new Error('Equipamento não encontrado na Central');
    }
    const alvo = centralEqDiagResolverAlvo(equipamento);
    window.__centralEqDiagEquipamentoId = Number(id) || null;
    const h = document.getElementById('diagHost');
    const p = document.getElementById('diagPorta');
    if (h) h.value = alvo.host || '';
    if (p) p.value = String(alvo.porta || 9000);

    centralEqDiagAbrirPainel();

    const body = await centralEqFetch(`/${id}/diagnostico`, { method: 'POST', body: '{}' });
    const payload = body.diagnostico && body.diagnostico.health
      ? body.diagnostico
      : body;
    const ipOk = payload.network?.ip || payload.equipamento?.ip || alvo.host;
    const portaOk = payload.network?.port != null
      ? payload.network.port
      : (payload.equipamento?.porta != null ? payload.equipamento.porta : alvo.porta);
    if (h && ipOk) h.value = ipOk;
    if (p && portaOk != null) p.value = String(portaOk);
    centralEqDiagRenderizar(payload);

    if (typeof showNotification === 'function') {
      const offline = payload.health?.online === false
        || String(payload.health?.status || '').toUpperCase() === 'OFFLINE';
      showNotification(
        offline
          ? `Diagnóstico: OFFLINE — ${payload.health?.motivo || 'Sem comunicação'}`
          : 'Diagnóstico concluído — veja o painel',
        offline ? 'warning' : 'success'
      );
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

/**
 * Sprint 14.6 — Operações Toledo
 */
function centralEqMostrarOps() {
  const painel = document.getElementById('centralEqOpsPainel');
  if (painel) painel.style.display = '';
  const lista = window.__centralEqDescobertosV1 || [];
  const eq = lista.find((e) => e._driver || e._connStatus === 'CONNECTED') || lista[0];
  if (eq) {
    const h = document.getElementById('opsHost');
    const p = document.getElementById('opsPorta');
    if (h && !h.value) h.value = eq.host || '';
    if (p && eq.porta) p.value = eq.porta;
  }
  centralEqOpsHistorico();
}

async function centralEqOpsExecutar(tipo) {
  const host = document.getElementById('opsHost')?.value?.trim();
  const porta = Number(document.getElementById('opsPorta')?.value || 0);
  if (!host || !porta) {
    if (typeof showNotification === 'function') showNotification('Informe host e porta.', 'warning');
    return;
  }
  const path = tipo === 'PING'
    ? '/operations/ping'
    : (tipo === 'HANDSHAKE' ? '/operations/handshake' : '/operations/identify');
  try {
    const resp = await fetch(`${centralEqApi()}/equipamentos${path}`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({ host, porta })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);

    const ok = body.success === true;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    if (tipo === 'PING') set('opsPingStatus', ok ? 'OK' : (body.error || 'ERRO'));
    if (tipo === 'HANDSHAKE') set('opsHsStatus', ok ? 'OK' : (body.error || 'ERRO'));
    if (tipo === 'IDENTIFY') {
      const nome = body.data?.identify || body.data?.modelo || (ok ? 'TOLEDO PRIX IV UNO' : 'ERRO');
      set('opsIdStatus', ok ? nome : (body.error || 'ERRO'));
    }
    set('opsTempo', body.duration != null ? `${body.duration} ms` : '—');
    await centralEqOpsHistorico();
    if (typeof showNotification === 'function') {
      showNotification(ok ? `${tipo} OK (${body.duration || 0} ms)` : `${tipo} falhou`, ok ? 'success' : 'danger');
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqOpsHistorico() {
  try {
    const host = document.getElementById('opsHost')?.value?.trim();
    const porta = document.getElementById('opsPorta')?.value;
    const q = new URLSearchParams({ limite: '40' });
    if (host) q.set('host', host);
    if (porta) q.set('porta', porta);
    const resp = await fetch(`${centralEqApi()}/equipamentos/operations/history?${q}`, {
      headers: centralEqHeaders()
    });
    const body = await resp.json().catch(() => ({}));
    const tbody = document.getElementById('centralEqOpsHistBody');
    if (!tbody) return;
    const rows = body.historico || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Sem histórico.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => {
      const hora = r.finished_at || r.started_at
        ? new Date(r.finished_at || r.started_at).toLocaleString('pt-BR')
        : '—';
      const st = r.status || '—';
      const cls = st === 'SUCCESS' ? 'text-success' : (st === 'ERROR' ? 'text-danger' : '');
      return `<tr>
        <td class="small">${escapeHtmlCentralEq(hora)}</td>
        <td>${escapeHtmlCentralEq(r.operation || '')}</td>
        <td class="${cls}">${escapeHtmlCentralEq(st)}</td>
        <td>${r.duration != null ? `${r.duration} ms` : '—'}</td>
      </tr>`;
    }).join('');
  } catch (_) { /* ignore */ }
}

/**
 * Sprint 14.5 — Laboratório de Engenharia Reversa V2.0
 */
let __centralEqLabPoll = null;
let __centralEqLabSessionId = null;
let __centralEqLabFrames = [];

function centralEqMostrarLab() {
  const painel = document.getElementById('centralEqLabPainel');
  if (painel) painel.style.display = '';
  centralEqLabRefresh();
  if (typeof centralEqLabConnRefresh === 'function') {
    centralEqLabConnRefresh();
  }
}

function centralEqMostrarProtocolo() {
  const painel = document.getElementById('centralEqProtocoloPainel');
  if (painel) painel.style.display = '';
  const lista = window.__centralEqDescobertosV1 || [];
  const eq = lista.find((e) => e.host) || lista[0];
  if (eq) {
    const h = document.getElementById('protoHost');
    const p = document.getElementById('protoPorta');
    if (h && !h.value) h.value = eq.host || '';
    if (p && eq.porta) p.value = eq.porta;
  }
  centralEqProtoHistorico();
}

function centralEqProtoSet(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v == null ? '—' : String(v);
}

function centralEqProtoMostrarResultado(body) {
  // RC14.14.10 — nunca acessar propriedades de resposta nula
  const b = body && typeof body === 'object' ? body : {};
  const semRx = b.timeout === true
    || b.code === 'RX_TIMEOUT'
    || (!b.rxHex && !b.sucesso && /nenhuma resposta|timeout/i.test(String(b.mensagem || b.error || '')));
  centralEqProtoSet('protoEstado', semRx ? 'TIMEOUT' : (b.sucesso ? 'SUCCESS' : (b.session?.estado || 'ERROR')));
  centralEqProtoSet('protoComando', b.command || b.wireCommand || '—');
  centralEqProtoSet('protoTempo', b.latenciaMs != null ? `${b.latenciaMs} ms` : '—');
  centralEqProtoSet('protoChecksum', b.checksum || '—');
  centralEqProtoSet(
    'protoResposta',
    semRx
      ? 'Nenhuma resposta recebida da balança.'
      : (b.responseCommand || b.parsed?.command || '—')
  );
  const payload = b.payload != null ? b.payload : b.parsed?.payload;
  centralEqProtoSet('protoPayload', semRx ? '—' : (payload != null ? JSON.stringify(payload) : '—'));
  centralEqProtoSet('protoTx', b.txHex || '—');
  centralEqProtoSet('protoRx', semRx ? '(sem RX)' : (b.rxHex || '—'));
}

async function centralEqProtoExec(comando) {
  const host = document.getElementById('protoHost')?.value?.trim();
  const porta = Number(document.getElementById('protoPorta')?.value || 0);
  if (!host || !porta) {
    if (typeof showNotification === 'function') showNotification('Informe host e porta.', 'warning');
    return;
  }
  const api = centralEqApi();
  try {
    // Garante conexão TCP
    await fetch(`${api}/equipamentos/connect`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({ host, porta })
    });
    const resp = await fetch(`${api}/equipamentos/protocol/${comando}`, {
      method: 'POST',
      headers: centralEqHeaders(),
      body: JSON.stringify({ host, porta })
    });
    const body = await resp.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      centralEqProtoMostrarResultado({
        sucesso: false,
        timeout: true,
        mensagem: 'Nenhuma resposta recebida da balança.'
      });
      if (typeof showNotification === 'function') {
        showNotification('Nenhuma resposta recebida da balança.', 'warning');
      }
      return;
    }
    if (!resp.ok) {
      const msg = body.error || body.mensagem || `HTTP ${resp.status}`;
      const semRx = /nenhuma resposta|timeout|RX_TIMEOUT|null.*dados|dados/i.test(String(msg));
      if (semRx) {
        centralEqProtoMostrarResultado({
          ...body,
          sucesso: false,
          timeout: true,
          mensagem: 'Nenhuma resposta recebida da balança.',
          txHex: body.txHex || body.hex_enviado || null
        });
        if (typeof showNotification === 'function') {
          showNotification('Nenhuma resposta recebida da balança.', 'warning');
        }
        return;
      }
      throw new Error(msg);
    }
    if (body.timeout === true || body.sucesso === false && !body.rxHex) {
      centralEqProtoMostrarResultado({
        ...body,
        timeout: true,
        mensagem: body.mensagem || 'Nenhuma resposta recebida da balança.'
      });
      if (typeof showNotification === 'function') {
        showNotification('Nenhuma resposta recebida da balança.', 'warning');
      }
      return;
    }
    centralEqProtoMostrarResultado(body);
    centralEqProtoHistorico();
    if (typeof showNotification === 'function') {
      showNotification(`${comando} OK — ${body.checksum || ''} (${body.latenciaMs ?? '—'} ms)`, 'success');
    }
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err || '');
    const semRx = /nenhuma resposta|timeout|RX_TIMEOUT|Cannot read properties of null|reading 'dados'/i.test(msg);
    centralEqProtoSet('protoEstado', semRx ? 'TIMEOUT' : 'ERROR');
    if (semRx) {
      centralEqProtoSet('protoResposta', 'Nenhuma resposta recebida da balança.');
      centralEqProtoSet('protoRx', '(sem RX)');
    }
    if (typeof showNotification === 'function') {
      showNotification(
        semRx ? 'Nenhuma resposta recebida da balança.' : msg,
        semRx ? 'warning' : 'danger'
      );
    }
  }
}

async function centralEqProtoHistorico() {
  const api = centralEqApi();
  const tbody = document.getElementById('centralEqProtoHistBody');
  try {
    const resp = await fetch(`${api}/equipamentos/protocol/history?limite=30`, { headers: centralEqHeaders() });
    const body = await resp.json().catch(() => ({}));
    const lista = body.history || [];
    if (!tbody) return;
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-muted">Sem histórico.</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map((h) => `
      <tr>
        <td>${escapeHtmlCentralEq((h.em || '').replace('T', ' ').slice(0, 19))}</td>
        <td>${escapeHtmlCentralEq(h.command || '—')}</td>
        <td>${h.sucesso ? '✓' : '✗'}</td>
        <td><code>${escapeHtmlCentralEq(h.checksum || '—')}</code></td>
        <td>${h.latenciaMs != null ? h.latenciaMs : '—'}</td>
        <td><code class="small">${escapeHtmlCentralEq((h.txHex || '').slice(0, 24))}</code></td>
        <td><code class="small">${escapeHtmlCentralEq((h.rxHex || '').slice(0, 24))}</code></td>
      </tr>`).join('');
  } catch (_) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-danger">Erro ao carregar histórico.</td></tr>';
  }
}

async function centralEqLabApi(path, options = {}) {
  const resp = await fetch(`${centralEqApi()}/equipamentos${path}`, {
    ...options,
    headers: { ...centralEqHeaders(), ...(options.headers || {}) }
  });
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json') || path.includes('/lab/status') || path.includes('/lab/session') || path.includes('/lab/start') || path.includes('/lab/stop') || path.includes('/lab/pause') || path.includes('/lab/resume')) {
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    return body;
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

function centralEqLabRenderMeta(session) {
  const badge = document.getElementById('centralEqLabBadge');
  if (badge) {
    if (session && session.status === 'RECORDING') {
      badge.className = 'badge bg-danger';
      badge.textContent = '● Gravando';
    } else if (session && session.status === 'PAUSED') {
      badge.className = 'badge bg-warning text-dark';
      badge.textContent = '● Pausado';
    } else {
      badge.className = 'badge bg-secondary';
      badge.textContent = '● Parado';
    }
  }
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('labSessionId', session ? `#${session.id}` : '—');
  set('labFrames', session ? String(session.totalFrames || 0) : '0');
  set('labTx', session ? String(session.totalTX || 0) : '0');
  set('labRx', session ? String(session.totalRX || 0) : '0');
  set('labTempo', session ? (session.uptime || '00:00:00') : '00:00:00');
}

function centralEqLabRenderFrames(frames) {
  __centralEqLabFrames = frames || [];
  const tbody = document.getElementById('centralEqLabFramesBody');
  if (!tbody) return;
  if (!__centralEqLabFrames.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted">Nenhum frame capturado. Inicie a gravação e conecte o Driver.</td></tr>';
    return;
  }
  tbody.innerHTML = __centralEqLabFrames.map((f, idx) => {
    const hora = f.timestamp ? new Date(f.timestamp).toLocaleTimeString('pt-BR') : '—';
    const dirCls = f.direction === 'TX' ? 'text-primary' : 'text-success';
    const hexShort = (f.frame_hex || '').slice(0, 32) + ((f.frame_hex || '').length > 32 ? '…' : '');
    const ascShort = (f.frame_ascii || '').slice(0, 24);
    return `<tr>
      <td class="small">${escapeHtmlCentralEq(hora)}</td>
      <td class="fw-semibold ${dirCls}">${escapeHtmlCentralEq(f.direction)}</td>
      <td>${Number(f.size || 0)}</td>
      <td><code>${escapeHtmlCentralEq(f.checksum || '')}</code></td>
      <td><code class="small">${escapeHtmlCentralEq(hexShort)}</code></td>
      <td><code class="small">${escapeHtmlCentralEq(ascShort)}</code></td>
      <td><button type="button" class="btn btn-sm btn-outline-secondary" onclick="centralEqLabVerFrame(${idx})">Ver</button></td>
    </tr>`;
  }).join('');
}

function centralEqLabVerFrame(idx) {
  const f = __centralEqLabFrames[idx];
  if (!f) return;
  const detalhe = document.getElementById('centralEqLabDetalhe');
  const pre = document.getElementById('centralEqLabDetalhePre');
  if (!detalhe || !pre) return;
  const a = f.analysis || {};
  pre.textContent = [
    `Direção: ${f.direction}`,
    `Hora: ${f.timestamp || ''}`,
    `Tamanho: ${f.size}`,
    `Checksum: ${f.checksum}`,
    '',
    'HEX',
    f.frame_hex || '',
    '',
    'ASCII',
    f.frame_ascii || '',
    '',
    'Bytes (tamanho)',
    String(a.tamanho != null ? a.tamanho : f.size),
    '',
    'Análise estrutural',
    `valido=${a.valido} checksum=${a.checksum || f.checksum}`
  ].join('\n');
  detalhe.style.display = '';
}

async function centralEqLabCopiarDetalhe() {
  const pre = document.getElementById('centralEqLabDetalhePre');
  if (!pre) return;
  try {
    await navigator.clipboard.writeText(pre.textContent || '');
    if (typeof showNotification === 'function') showNotification('Copiado.', 'success');
  } catch (_) {
    if (typeof showNotification === 'function') showNotification('Falha ao copiar.', 'warning');
  }
}

function centralEqLabPararPoll() {
  if (__centralEqLabPoll) {
    clearInterval(__centralEqLabPoll);
    __centralEqLabPoll = null;
  }
}

function centralEqLabIniciarPoll() {
  centralEqLabPararPoll();
  __centralEqLabPoll = setInterval(() => { centralEqLabRefresh(); }, 1500);
}

async function centralEqLabStart() {
  try {
    const lista = window.__centralEqDescobertosV1 || [];
    const eq = lista.find((e) => e._connStatus === 'CONNECTED' || e._driver) || lista[0] || {};
    const body = await centralEqLabApi('/lab/start', {
      method: 'POST',
      body: JSON.stringify({
        host: eq.host || null,
        porta: eq.porta || null,
        driver: eq._driver || eq.driver || 'TOLEDO_PRIX4',
        equipamento: eq.host ? `${eq.host}:${eq.porta}` : null
      })
    });
    __centralEqLabSessionId = body.session?.id || null;
    centralEqLabRenderMeta(body.session);
    centralEqLabIniciarPoll();
    if (typeof showNotification === 'function') showNotification(`Sessão #${__centralEqLabSessionId} iniciada`, 'success');
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqLabStop() {
  try {
    const body = await centralEqLabApi('/lab/stop', { method: 'POST', body: '{}' });
    centralEqLabPararPoll();
    centralEqLabRenderMeta(body.session);
    await centralEqLabRefresh();
    if (typeof showNotification === 'function') showNotification('Sessão finalizada', 'info');
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqLabPause() {
  try {
    const body = await centralEqLabApi('/lab/pause', { method: 'POST', body: '{}' });
    centralEqLabRenderMeta(body.session);
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqLabResume() {
  try {
    const body = await centralEqLabApi('/lab/resume', { method: 'POST', body: '{}' });
    centralEqLabRenderMeta(body.session);
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqLabRefresh() {
  try {
    const st = await centralEqLabApi('/lab/status');
    if (st.session) {
      __centralEqLabSessionId = st.session.id;
      centralEqLabRenderMeta(st.session);
      const data = await centralEqLabApi(`/lab/session/${encodeURIComponent(st.session.id)}`);
      centralEqLabRenderFrames(data.frames || []);
    } else if (__centralEqLabSessionId) {
      const data = await centralEqLabApi(`/lab/session/${encodeURIComponent(__centralEqLabSessionId)}`);
      if (data.session) centralEqLabRenderMeta(data.session);
      centralEqLabRenderFrames(data.frames || []);
    }
  } catch (_) { /* ignore poll */ }
}

async function centralEqLabExport(formato) {
  if (!__centralEqLabSessionId) {
    if (typeof showNotification === 'function') showNotification('Nenhuma sessão para exportar.', 'warning');
    return;
  }
  try {
    const resp = await fetch(
      `${centralEqApi()}/equipamentos/lab/export/${encodeURIComponent(__centralEqLabSessionId)}?format=${encodeURIComponent(formato)}`,
      { headers: centralEqHeaders() }
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `captura-${__centralEqLabSessionId}.${String(formato).toLowerCase()}`;
    a.click();
    URL.revokeObjectURL(url);
    if (typeof showNotification === 'function') showNotification(`Exportação ${formato} realizada`, 'success');
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

window.centralEqProcurarEquipamentos = centralEqProcurarEquipamentos;
window.centralEqCadastrarDescoberto = centralEqCadastrarDescoberto;
window.centralEqDescobrir = centralEqDescobrir;
window.centralEqTransportesSelecionados = centralEqTransportesSelecionados;
window.centralEqExibirResultadosDiscovery = centralEqExibirResultadosDiscovery;
window.centralEqFingerprintUm = centralEqFingerprintUm;
window.centralEqConectar = centralEqConectar;
window.centralEqDesconectar = centralEqDesconectar;
window.centralEqReconectar = centralEqReconectar;
window.centralEqPing = centralEqPing;
window.centralEqLabConnRefresh = centralEqLabConnRefresh;
window.centralEqMostrarLab = centralEqMostrarLab;
window.centralEqMostrarProtocolo = centralEqMostrarProtocolo;
window.centralEqProtoExec = centralEqProtoExec;
window.centralEqProtoHistorico = centralEqProtoHistorico;
window.centralEqLabStart = centralEqLabStart;
window.centralEqLabStop = centralEqLabStop;
window.centralEqLabPause = centralEqLabPause;
window.centralEqLabResume = centralEqLabResume;
window.centralEqLabRefresh = centralEqLabRefresh;
window.centralEqLabExport = centralEqLabExport;
window.centralEqLabVerFrame = centralEqLabVerFrame;
window.centralEqLabCopiarDetalhe = centralEqLabCopiarDetalhe;
window.centralEqMostrarOps = centralEqMostrarOps;
window.centralEqMostrarOrquestrador = centralEqMostrarOrquestrador;
window.centralEqMostrarDriversSdk = centralEqMostrarDriversSdk;
window.centralEqDriversSdkRefresh = centralEqDriversSdkRefresh;
window.centralEqDriversSdkReload = centralEqDriversSdkReload;
window.centralEqDriversSdkLab = centralEqDriversSdkLab;
window.centralEqOrqRefresh = centralEqOrqRefresh;
window.centralEqOrqStopPoll = centralEqOrqStopPoll;
window.centralEqOrqSyncTodas = centralEqOrqSyncTodas;
window.centralEqOrqAcao = centralEqOrqAcao;
window.centralEqOrqHealth = centralEqOrqHealth;
window.centralEqOrqAgendar = centralEqOrqAgendar;
window.centralEqOrqHistorico = centralEqOrqHistorico;
window.centralEqOpsExecutar = centralEqOpsExecutar;
window.centralEqOpsHistorico = centralEqOpsHistorico;
window.centralEqMostrarPlu = centralEqMostrarPlu;
window.centralEqPluEnviar = centralEqPluEnviar;
window.centralEqPluEnviarTodos = centralEqPluEnviarTodos;
window.centralEqPluCancelar = centralEqPluCancelar;
window.centralEqPluHistorico = centralEqPluHistorico;
window.centralEqMostrarSync = centralEqMostrarSync;
window.centralEqSyncBaixar = centralEqSyncBaixar;
window.centralEqSyncComparar = centralEqSyncComparar;
window.centralEqSyncExecutar = centralEqSyncExecutar;
window.centralEqSyncExportar = centralEqSyncExportar;
window.centralEqSyncTudo = centralEqSyncTudo;
window.centralEqSyncAlteracoes = centralEqSyncAlteracoes;
window.centralEqSyncCancelar = centralEqSyncCancelar;
window.centralEqSyncHistorico = centralEqSyncHistorico;
window.centralEqSyncRefreshStatus = centralEqSyncRefreshStatus;
window.centralEqSyncDelta = centralEqSyncDelta;
window.centralEqSyncVerAlteracoes = centralEqSyncVerAlteracoes;
window.centralEqSyncVerVersoes = centralEqSyncVerVersoes;
window.centralEqSyncVerVersao = centralEqSyncVerVersao;
window.centralEqSyncCompararVersoes = centralEqSyncCompararVersoes;
window.centralEqSyncRollback = centralEqSyncRollback;
window.centralEqSyncAba = centralEqSyncAba;
window.centralEqMostrarPeso = centralEqMostrarPeso;
window.centralEqPesoLer = centralEqPesoLer;
window.centralEqPesoHistorico = centralEqPesoHistorico;
window.centralEqMostrarMonitor = centralEqMostrarMonitor;
window.centralEqMostrarObservabilidade = centralEqMostrarObservabilidade;
window.centralEqObsAba = centralEqObsAba;
window.centralEqObsRefresh = centralEqObsRefresh;
window.centralEqObsCertRun = centralEqObsCertRun;
window.centralEqObsCertRunAll = centralEqObsCertRunAll;
window.centralEqObsCertReport = centralEqObsCertReport;
window.centralEqObsLabRefresh = centralEqObsLabRefresh;
window.centralEqMonitorFechar = centralEqMonitorFechar;
window.centralEqMonitorIniciar = centralEqMonitorIniciar;
window.centralEqMonitorPausar = centralEqMonitorPausar;
window.centralEqMonitorParar = centralEqMonitorParar;
window.centralEqMonitorRefresh = centralEqMonitorRefresh;
window.centralEqMostrarConfig = centralEqMostrarConfig;
window.centralEqConfigLer = centralEqConfigLer;
window.centralEqConfigComparar = centralEqConfigComparar;
window.centralEqConfigAplicar = centralEqConfigAplicar;
window.centralEqConfigRestaurar = centralEqConfigRestaurar;
window.centralEqConfigExportar = centralEqConfigExportar;
window.centralEqConfigImportar = centralEqConfigImportar;
window.centralEqMostrarDiag = centralEqMostrarDiag;
window.centralEqDiagAtualizar = centralEqDiagAtualizar;
window.centralEqDiagnostico = centralEqDiagnostico;
window.centralEqDiagRenderizar = centralEqDiagRenderizar;
window.centralEqDiagExportar = centralEqDiagExportar;

async function centralEqAbrirHistorico(idx) {
  const it = centralEqCache[idx];
  if (!it) return;
  const painel = document.getElementById('centralEqHistoricoPainel');
  const body = document.getElementById('centralEqHistoricoBody');
  if (!painel || !body) return;
  painel.style.display = '';
  body.innerHTML = '<div class="text-muted">Carregando…</div>';
  try {
    const q = new URLSearchParams();
    if (it.equipamento_id) q.set('equipamento_id', it.equipamento_id);
    if (it.identidade_id) q.set('identidade_id', it.identidade_id);
    const saude = await centralEqFetch(`/saude?${q.toString()}`);
    const hist = await centralEqFetch(`/historico?${q.toString()}&limite=40`);
    const eventos = hist.eventos || [];
    body.innerHTML = `
      <div class="mb-3">
        <strong>Health Score:</strong> ${badgeHealthCentral(saude.saude?.score)}
        <span class="ms-2">${escapeHtmlCentralEq(saude.saude?.rotulo || '')}</span>
        <span class="ms-2">${badgeStatusCentral(saude.saude?.status_central, saude.saude?.status_rotulo)}</span>
      </div>
      <ul class="list-group list-group-flush">
        ${eventos.length ? eventos.map((e) => `
          <li class="list-group-item px-0">
            <div class="d-flex justify-content-between">
              <div>
                <strong>${escapeHtmlCentralEq(e.rotulo || e.evento)}</strong>
                <br><small class="text-muted">${escapeHtmlCentralEq(e.tipo)} · ${escapeHtmlCentralEq(e.evento)}</small>
              </div>
              <small class="text-muted">${formatarDataCentralEq(e.em)}</small>
            </div>
          </li>
        `).join('') : '<li class="list-group-item text-muted">Sem eventos.</li>'}
      </ul>
    `;
  } catch (err) {
    body.innerHTML = `<div class="text-danger">${escapeHtmlCentralEq(err.message)}</div>`;
  }
}

async function centralEqTestar(id) {
  try {
    const body = await centralEqFetch(`/${id}/testar`, { method: 'POST', body: '{}' });
    if (typeof showNotification === 'function') {
      showNotification(body.resultado?.mensagem || 'Teste concluído', 'info');
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function centralEqCadastrarIndice(idx) {
  const it = centralEqCache[idx];
  if (!it) return;
  const nome = window.prompt('Nome do equipamento:', it.nome || '');
  if (!nome) return;
  try {
    await centralEqFetch('/cadastrar', {
      method: 'POST',
      body: JSON.stringify({
        nome: String(nome).trim(),
        tipo: 'balanca',
        driver_codigo: it.driver_codigo,
        fabricante: it.fabricante,
        modelo: it.modelo,
        transporte: it.transporte || 'ethernet',
        ip: it.ultimo_ip,
        porta_tcp: it.porta_tcp || 9000,
        porta_com: it.porta_com,
        ativo: true,
        observacao: it.identidade_id ? `Central RC3 · identidade=${it.identidade_id}` : 'Central RC3'
      })
    });
    if (typeof showNotification === 'function') showNotification('Equipamento cadastrado', 'success');
    loadCentralEquipamentos();
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}
