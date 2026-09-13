/**
 * Monitor / Fila / Diagnóstico / Logs NF-e — Sprint 3.4
 */

let nfeMonitorTimer = null;

function nfeFmtData(data) {
  if (!data) return '-';
  return new Date(String(data).replace(' ', 'T')).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function nfeMsgErro(xhr) {
  const j = xhr.responseJSON || {};
  const msg = j.mensagem || j.error || 'Operação não concluída.';
  const sug = j.sugestao ? ` ${j.sugestao}` : '';
  return msg + sug;
}

function nfeCardMonitor(titulo, valor, cor) {
  return `
    <div class="col-6 col-md-3 col-xl">
      <div class="border rounded p-3 h-100 text-center bg-light">
        <div class="text-muted small text-uppercase">${titulo}</div>
        <div class="fs-3 fw-bold text-${cor || 'dark'}">${valor}</div>
      </div>
    </div>`;
}

function loadNfeMonitor() {
  const html = `
    ${(typeof CdsPageShell !== 'undefined' && CdsPageShell.renderHeader)
      ? CdsPageShell.renderHeader({ page: 'nfe-monitor', toolbarHtml: '' }) : ''}
    <div class="card shadow-sm mb-3">
      <div class="card-header d-flex justify-content-between align-items-center">
        <div><i class="fas fa-heartbeat"></i> Monitor NF-e</div>
        <div class="small text-muted" id="nfeMonitorAtualizado">—</div>
      </div>
      <div class="card-body">
        <div class="row g-2" id="nfeMonitorCards"></div>
        <div class="mt-3 d-flex gap-2 flex-wrap">
          <button class="btn btn-sm btn-primary" onclick="carregarNfeMonitor()"><i class="fas fa-sync"></i> Atualizar</button>
          <button class="btn btn-sm btn-outline-secondary" onclick="loadPage('nfe-fila')">Fila operacional</button>
          <button class="btn btn-sm btn-outline-secondary" onclick="loadPage('nfe-diagnostico')">Diagnóstico</button>
          <button class="btn btn-sm btn-outline-secondary" onclick="loadPage('nfe-central')">Central NF-e</button>
        </div>
      </div>
    </div>
    <div class="card shadow-sm">
      <div class="card-header">Log operacional recente</div>
      <div class="card-body" id="nfeMonitorLogs"><div class="text-muted">Carregando…</div></div>
    </div>`;
  $('#page-content').html(html);
  carregarNfeMonitor();
  if (nfeMonitorTimer) clearInterval(nfeMonitorTimer);
  nfeMonitorTimer = setInterval(carregarNfeMonitor, 15000);
}

function carregarNfeMonitor() {
  $.ajax({
    url: `${API_URL}/nfe/monitor`,
    method: 'GET',
    success(resp) {
      const c = resp.contadores || {};
      $('#nfeMonitorAtualizado').text(`Atualizado: ${nfeFmtData(resp.atualizadoEm)}`);
      $('#nfeMonitorCards').html([
        nfeCardMonitor('Emitindo', c.emitindo || 0, 'primary'),
        nfeCardMonitor('Aguardando SEFAZ', c.aguardando_retorno || 0, 'warning'),
        nfeCardMonitor('Autorizada', c.autorizada || 0, 'success'),
        nfeCardMonitor('Rejeitada', c.rejeitada || 0, 'danger'),
        nfeCardMonitor('Cancelada', c.cancelada || 0, 'dark'),
        nfeCardMonitor('Erro comunicação', c.erro_comunicacao || 0, 'danger'),
        nfeCardMonitor('Pendente reenvio', c.pendente_reenvio || 0, 'info')
      ].join(''));
    },
    error(xhr) {
      $('#nfeMonitorCards').html(`<div class="col-12 alert alert-warning">${nfeMsgErro(xhr)}</div>`);
    }
  });

  $.ajax({
    url: `${API_URL}/nfe/logs?limite=30`,
    method: 'GET',
    success(resp) {
      const logs = resp.logs || [];
      if (!logs.length) {
        $('#nfeMonitorLogs').html('<div class="alert alert-info mb-0">Nenhum log operacional.</div>');
        return;
      }
      const rows = logs.map((l) => `
        <tr>
          <td class="text-nowrap">${nfeFmtData(l.criado_em)}</td>
          <td>${l.usuario_nome || '-'}</td>
          <td>${l.documento || '-'}</td>
          <td><span class="badge bg-secondary">${l.acao}</span></td>
          <td class="small">${l.retorno_sefaz || '-'}</td>
          <td>${l.tempo_resposta_ms != null ? l.tempo_resposta_ms + ' ms' : '-'}</td>
          <td>${l.tentativas || 0}</td>
        </tr>`).join('');
      $('#nfeMonitorLogs').html(`
        <div class="table-responsive">
          <table class="table table-sm mb-0">
            <thead><tr>
              <th>Data/Hora</th><th>Usuário</th><th>Documento</th><th>Ação</th>
              <th>Retorno SEFAZ</th><th>Tempo</th><th>Tentativas</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`);
    }
  });
}

function loadNfeFila() {
  const html = `
    ${(typeof CdsPageShell !== 'undefined' && CdsPageShell.renderHeader)
      ? CdsPageShell.renderHeader({ page: 'nfe-fila', toolbarHtml: '' }) : ''}
    <div class="card shadow-sm">
      <div class="card-header"><i class="fas fa-stream"></i> Fila operacional NF-e</div>
      <div class="card-body">
        <div class="row g-2 mb-3 align-items-end">
          <div class="col-md-3">
            <label class="form-label small mb-0">Busca</label>
            <input type="text" id="nfeFilaBusca" class="form-control form-control-sm" placeholder="Número, chave, cliente">
          </div>
          <div class="col-md-2">
            <label class="form-label small mb-0">Estado fila</label>
            <select id="nfeFilaEstado" class="form-select form-select-sm">
              <option value="">Todos</option>
              <option value="aguardando">Aguardando</option>
              <option value="transmitindo">Transmitindo</option>
              <option value="autorizado">Autorizado</option>
              <option value="erro">Erro</option>
              <option value="reenvio">Reenvio</option>
              <option value="cancelado">Cancelado</option>
              <option value="consulta">Consulta</option>
            </select>
          </div>
          <div class="col-md-2">
            <label class="form-label small mb-0">Ordenar</label>
            <select id="nfeFilaOrdenar" class="form-select form-select-sm">
              <option value="atualizado">Atualizado</option>
              <option value="data">Data</option>
              <option value="numero">Número</option>
              <option value="status">Status</option>
              <option value="tentativas">Tentativas</option>
            </select>
          </div>
          <div class="col-md-2">
            <label class="form-label small mb-0">Direção</label>
            <select id="nfeFilaDirecao" class="form-select form-select-sm">
              <option value="DESC">Desc</option>
              <option value="ASC">Asc</option>
            </select>
          </div>
          <div class="col-md-2">
            <button class="btn btn-primary btn-sm w-100" onclick="carregarNfeFila()"><i class="fas fa-search"></i> Filtrar</button>
          </div>
        </div>
        <div id="nfeFilaArea"></div>
      </div>
    </div>`;
  $('#page-content').html(html);
  carregarNfeFila();
}

function carregarNfeFila() {
  const qs = new URLSearchParams();
  const busca = $('#nfeFilaBusca').val();
  const estado = $('#nfeFilaEstado').val();
  const ordenar = $('#nfeFilaOrdenar').val();
  const direcao = $('#nfeFilaDirecao').val();
  if (busca) qs.set('busca', busca);
  if (estado) qs.set('estado', estado);
  if (ordenar) qs.set('ordenar', ordenar);
  if (direcao) qs.set('direcao', direcao);

  $('#nfeFilaArea').html('<div class="text-muted">Carregando…</div>');
  $.ajax({
    url: `${API_URL}/nfe/fila?${qs}`,
    method: 'GET',
    success(resp) {
      const itens = resp.itens || [];
      if (!itens.length) {
        $('#nfeFilaArea').html('<div class="alert alert-info mb-0">Fila vazia para os filtros informados.</div>');
        return;
      }
      const rows = itens.map((n) => `
        <tr>
          <td>${n.numero}/${n.serie}</td>
          <td class="small text-break" style="max-width:140px">${n.chave_acesso || '-'}</td>
          <td>${n.cliente_nome || '-'}</td>
          <td><span class="badge bg-secondary">${n.fila_estado || '-'}</span></td>
          <td>${n.status || '-'}</td>
          <td class="small">${n.erro_mensagem || '-'}</td>
          <td>${n.tentativas || 0}</td>
          <td class="text-nowrap">${nfeFmtData(n.ultima_tentativa_em || n.updated_at)}</td>
          <td class="text-nowrap">
            ${n.pode_reenviar ? `<button class="btn btn-sm btn-warning" onclick="reenviarNfeOperacional(${n.id})">REENVIAR</button>` : ''}
            <button class="btn btn-sm btn-outline-info" onclick="consultarSituacaoNfe && consultarSituacaoNfe(${n.id}); if(!window.consultarSituacaoNfe){nfeConsultarFila(${n.id})}">Consultar</button>
          </td>
        </tr>`).join('');
      $('#nfeFilaArea').html(`
        <div class="table-responsive">
          <table class="table table-sm table-hover align-middle">
            <thead><tr>
              <th>Nº/Série</th><th>Chave</th><th>Cliente</th><th>Fila</th><th>Status</th>
              <th>Erro</th><th>Tent.</th><th>Última tentativa</th><th>Ações</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`);
    },
    error(xhr) {
      $('#nfeFilaArea').html(`<div class="alert alert-warning">${nfeMsgErro(xhr)}</div>`);
    }
  });
}

function nfeConsultarFila(id) {
  $.ajax({
    url: `${API_URL}/nfe/notas/${id}/consultar`,
    method: 'POST',
    contentType: 'application/json',
    data: '{}',
    success(resp) {
      showNotification(`Consulta: ${resp.status || ''} (cStat ${resp.cStat || '-'})`, 'success');
      carregarNfeFila();
    },
    error(xhr) { showNotification(nfeMsgErro(xhr), 'danger'); }
  });
}

function reenviarNfeOperacional(id) {
  if (!confirm('Reenviar esta NF-e para a SEFAZ?')) return;
  showNotification('Reenviando…', 'info');
  $.ajax({
    url: `${API_URL}/nfe/notas/${id}/reenviar`,
    method: 'POST',
    contentType: 'application/json',
    data: '{}',
    success(resp) {
      if (resp.success) showNotification(resp.mensagem || 'Reenvio autorizado.', 'success');
      else showNotification(`${resp.mensagem || 'Reenvio não autorizado.'}${resp.sugestao ? ' ' + resp.sugestao : ''}`, 'warning');
      if (typeof carregarNfeFila === 'function' && $('#nfeFilaArea').length) carregarNfeFila();
      if (typeof carregarNfeNotas === 'function' && $('#nfe-notas-area').length) carregarNfeNotas();
      if (typeof carregarNfeMonitor === 'function' && $('#nfeMonitorCards').length) carregarNfeMonitor();
    },
    error(xhr) { showNotification(nfeMsgErro(xhr), 'danger'); }
  });
}

function loadNfeDiagnostico() {
  const html = `
    ${(typeof CdsPageShell !== 'undefined' && CdsPageShell.renderHeader)
      ? CdsPageShell.renderHeader({ page: 'nfe-diagnostico', toolbarHtml: '' }) : ''}
    <div class="card shadow-sm">
      <div class="card-header d-flex justify-content-between">
        <div><i class="fas fa-stethoscope"></i> Diagnóstico Fiscal</div>
        <button class="btn btn-sm btn-primary" onclick="executarNfeDiagnostico()">Executar diagnóstico</button>
      </div>
      <div class="card-body" id="nfeDiagnosticoArea">
        <div class="text-muted">Clique em Executar diagnóstico.</div>
      </div>
    </div>`;
  $('#page-content').html(html);
  executarNfeDiagnostico();
}

function nivelBadge(nivel) {
  if (nivel === 'ok') return 'success';
  if (nivel === 'alerta') return 'warning';
  return 'danger';
}

function executarNfeDiagnostico() {
  $('#nfeDiagnosticoArea').html('<div class="text-muted">Executando verificações…</div>');
  $.ajax({
    url: `${API_URL}/nfe/diagnostico`,
    method: 'GET',
    success(resp) {
      const r = resp.resumo || {};
      const itens = resp.itens || [];
      const rows = itens.map((i) => `
        <tr>
          <td>${i.nome}</td>
          <td><span class="badge bg-${nivelBadge(i.nivel)}">${String(i.nivel).toUpperCase()}</span></td>
          <td>${i.mensagem || '-'}</td>
          <td class="small text-break">${typeof i.detalhe === 'object' ? JSON.stringify(i.detalhe) : (i.detalhe || '-')}</td>
        </tr>`).join('');
      $('#nfeDiagnosticoArea').html(`
        <div class="mb-3">
          <span class="badge bg-success me-1">OK: ${r.ok || 0}</span>
          <span class="badge bg-warning text-dark me-1">Alerta: ${r.alerta || 0}</span>
          <span class="badge bg-danger">Erro: ${r.erro || 0}</span>
          <span class="ms-2 text-muted small">${resp.empresa || ''} ${resp.cnpj || ''} — ${resp.ambiente || ''}</span>
        </div>
        <div class="table-responsive">
          <table class="table table-sm">
            <thead><tr><th>Item</th><th>Resultado</th><th>Mensagem</th><th>Detalhe</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`);
    },
    error(xhr) {
      $('#nfeDiagnosticoArea').html(`<div class="alert alert-warning">${nfeMsgErro(xhr)}</div>`);
    }
  });
}

window.loadNfeMonitor = loadNfeMonitor;
window.carregarNfeMonitor = carregarNfeMonitor;
window.loadNfeFila = loadNfeFila;
window.carregarNfeFila = carregarNfeFila;
window.loadNfeDiagnostico = loadNfeDiagnostico;
window.executarNfeDiagnostico = executarNfeDiagnostico;
window.reenviarNfeOperacional = reenviarNfeOperacional;
window.nfeConsultarFila = nfeConsultarFila;
