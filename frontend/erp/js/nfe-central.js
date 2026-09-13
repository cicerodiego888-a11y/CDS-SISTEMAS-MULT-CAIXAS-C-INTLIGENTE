/**
 * Central de NF-e Emitidas — RC3.15 Central Documental única.
 * Sprint 3.3 base + ficha / timeline / deep-link pós-emissão.
 * RC3.15.2 — pós-autorização abre Visualização (paridade NFC-e → cupom).
 */

let nfeNotasCache = [];
let nfeNotaSelecionadaId = null;
let nfeXmlCachePorNota = {};

function formatarDataHoraNfe(data) {
  if (!data) return '-';
  return new Date(String(data).replace(' ', 'T')).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatarMoedaNfe(v) {
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function escapeHtmlNfe(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badgeStatusNfe(status) {
  const s = String(status || '').toLowerCase();
  let cls = 'secondary';
  let label = status || '-';
  if (s === 'autorizada') { cls = 'success'; label = 'Autorizada'; }
  else if (s === 'cancelada') { cls = 'dark'; label = 'Cancelada'; }
  else if (s === 'inutilizada') { cls = 'dark'; label = 'Inutilizada'; }
  else if (s.includes('rejeit') || s.includes('erro') || s.includes('deneg')) { cls = 'danger'; label = status || 'Rejeitada'; }
  else if (s.includes('pendente') || s.includes('aguardando') || s.includes('emitindo')) { cls = 'warning'; label = status || 'Pendente'; }
  return `<span class="badge bg-${cls}">${escapeHtmlNfe(label)}</span>`;
}

function consumirFocoNfePendente() {
  const id = Number(window.__CDS_NFE_FOCUS_NOTA_ID || 0) || null;
  const openFicha = Boolean(window.__CDS_NFE_OPEN_FICHA);
  const banner = window.__CDS_NFE_AUTH_BANNER || null;
  const posEmissao = Boolean(window.__CDS_NFE_POS_EMISSAO);
  const pendente = Boolean(window.__CDS_NFE_PENDENTE);
  window.__CDS_NFE_FOCUS_NOTA_ID = null;
  window.__CDS_NFE_OPEN_FICHA = false;
  window.__CDS_NFE_AUTH_BANNER = null;
  window.__CDS_NFE_POS_EMISSAO = false;
  window.__CDS_NFE_PENDENTE = false;
  return { id, openFicha, banner, posEmissao, pendente };
}

function loadNfeCentral() {
  renderNfeCentral();
  const foco = consumirFocoNfePendente();
  if (foco.banner) renderBannerNfeAutorizada(foco.banner);
  else if (foco.pendente && foco.id) renderBannerNfePendente(foco.id);
  carregarNfeNotas().then(() => {
    if (foco.id) {
      nfeNotaSelecionadaId = foco.id;
      renderTabelaNfeNotas();
      carregarHistoricoNfe(foco.id);
      if (foco.openFicha !== false) {
        visualizarFichaNfe(foco.id, { posEmissao: foco.posEmissao, pendente: foco.pendente });
      }
    }
  });
}

function renderBannerNfeAutorizada(info) {
  const el = document.getElementById('nfe-auth-banner');
  if (!el || !info) return;
  el.innerHTML = `
    <div class="alert alert-success alert-dismissible fade show d-flex flex-wrap justify-content-between align-items-start gap-2" role="alert">
      <div>
        <strong>✓ NF-e autorizada.</strong>
        <div class="small mt-1">
          Número <strong>${escapeHtmlNfe(info.numero || '—')}</strong>
          · Série <strong>${escapeHtmlNfe(info.serie || '—')}</strong>
          · Protocolo <strong>${escapeHtmlNfe(info.protocolo || '—')}</strong>
        </div>
        <div class="small text-break">Chave: ${escapeHtmlNfe(info.chaveAcesso || info.chave || '—')}</div>
      </div>
      <div class="d-flex gap-1">
        ${info.notaId ? `<button type="button" class="btn btn-sm btn-success" onclick="visualizarFichaNfe(${Number(info.notaId)})">
          <i class="fas fa-file-alt"></i> Visualizar NF-e</button>` : ''}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Fechar"></button>
      </div>
    </div>`;
}

function renderBannerNfePendente(notaId) {
  const el = document.getElementById('nfe-auth-banner');
  if (!el) return;
  el.innerHTML = `
    <div class="alert alert-warning alert-dismissible fade show" role="alert">
      <strong>NF-e pendente / rejeitada.</strong>
      Confira a ficha, corrija se necessário e use <em>Reenviar</em> ou <em>Consultar SEFAZ</em>.
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Fechar"></button>
    </div>`;
}

function renderNfeCentral() {
  const html = `
    ${(typeof CdsPageShell !== 'undefined' && CdsPageShell.renderHeader)
      ? CdsPageShell.renderHeader({ page: 'nfe-central', toolbarHtml: '' })
      : ''}
    <div id="nfe-auth-banner"></div>
    <div class="card shadow-sm">
      <div class="card-header d-flex justify-content-between align-items-center">
        <div>
          <i class="fas fa-file-invoice-dollar"></i> Central NF-e
          <span class="badge bg-primary ms-2">Central Documental</span>
          <div class="small text-muted fw-normal mt-1">NF-e de venda e NF-e de devolução (compra e venda)</div>
        </div>
      </div>
      <div class="card-body">
        <ul class="nav nav-tabs mb-3" role="tablist">
          <li class="nav-item">
            <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#nfe-lista-tab" type="button">Notas</button>
          </li>
          <li class="nav-item">
            <button class="nav-link" data-bs-toggle="tab" data-bs-target="#nfe-historico-tab" type="button" id="nfe-tab-historico">Histórico</button>
          </li>
        </ul>
        <div class="tab-content">
          <div class="tab-pane fade show active" id="nfe-lista-tab">
            <div class="row g-2 mb-3 align-items-end">
              <div class="col-md-2">
                <label class="form-label small mb-0 text-muted">Número</label>
                <input type="number" id="nfeFiltroNumero" class="form-control form-control-sm" placeholder="Nº">
              </div>
              <div class="col-md-1">
                <label class="form-label small mb-0 text-muted">Série</label>
                <input type="number" id="nfeFiltroSerie" class="form-control form-control-sm" placeholder="Série">
              </div>
              <div class="col-md-2">
                <label class="form-label small mb-0 text-muted">Tipo</label>
                <select id="nfeFiltroTipo" class="form-select form-select-sm">
                  <option value="">Todas</option>
                  <option value="VENDA">NF-e venda</option>
                  <option value="DEVOLUCAO_COMPRA">Devolução de compra</option>
                  <option value="DEVOLUCAO_VENDA">Devolução de venda</option>
                </select>
              </div>
              <div class="col-md-2">
                <label class="form-label small mb-0 text-muted">Cliente / Fornecedor</label>
                <input type="text" id="nfeFiltroCliente" class="form-control form-control-sm" placeholder="Nome / CPF">
              </div>
              <div class="col-md-2">
                <label class="form-label small mb-0 text-muted">Situação</label>
                <select id="nfeFiltroSituacao" class="form-select form-select-sm">
                  <option value="">Todas</option>
                  <option value="autorizada">Autorizada</option>
                  <option value="cancelada">Cancelada</option>
                  <option value="rejeitada">Rejeitada</option>
                  <option value="erro_transmissao">Erro transmissão</option>
                  <option value="erro_assinatura">Erro assinatura</option>
                  <option value="cancelamento_rejeitado">Cancel. rejeitado</option>
                  <option value="pendente">Pendente</option>
                  <option value="inutilizada">Inutilizada</option>
                </select>
              </div>
              <div class="col-md-2">
                <label class="form-label small mb-0 text-muted">Data inicial</label>
                <input type="date" id="nfeFiltroDataInicio" class="form-control form-control-sm">
              </div>
              <div class="col-md-2">
                <label class="form-label small mb-0 text-muted">Data final</label>
                <input type="date" id="nfeFiltroDataFim" class="form-control form-control-sm">
              </div>
              <div class="col-md-1">
                <button class="btn btn-primary btn-sm w-100" onclick="carregarNfeNotas()">
                  <i class="fas fa-search"></i>
                </button>
              </div>
            </div>
            <div id="nfe-notas-area"></div>
          </div>
          <div class="tab-pane fade" id="nfe-historico-tab">
            <div class="mb-2 text-muted small" id="nfe-historico-titulo">Selecione uma NF-e para ver o histórico.</div>
            <div id="nfe-historico-area"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="modal fade" id="nfeXmlModal" tabindex="-1">
      <div class="modal-dialog modal-xl modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">XML (modo leitura)</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <pre id="nfeXmlConteudo" class="small bg-light p-2" style="white-space:pre-wrap;max-height:70vh;overflow:auto;"></pre>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" id="nfeXmlCopiarBtn">
              <i class="fas fa-copy"></i> Copiar XML
            </button>
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
            <button type="button" class="btn btn-primary" id="nfeXmlDownloadBtn">Download XML</button>
          </div>
        </div>
      </div>
    </div>

    <div class="modal fade" id="nfeFichaModal" tabindex="-1">
      <div class="modal-dialog modal-xl modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="nfeFichaTitulo">Visualizar NF-e</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body" id="nfeFichaBody">
            <div class="text-muted">Carregando ficha documental…</div>
          </div>
          <div class="modal-footer flex-wrap gap-1" id="nfeFichaFooter"></div>
        </div>
      </div>
    </div>
  `;
  $('#page-content').html(html);
}

function carregarNfeNotas() {
  const qs = new URLSearchParams();
  const numero = $('#nfeFiltroNumero').val();
  const serie = $('#nfeFiltroSerie').val();
  const cliente = $('#nfeFiltroCliente').val();
  const situacao = $('#nfeFiltroSituacao').val();
  const tipo = $('#nfeFiltroTipo').val();
  const dataInicio = $('#nfeFiltroDataInicio').val();
  const dataFim = $('#nfeFiltroDataFim').val();
  if (numero) qs.set('numero', numero);
  if (serie) qs.set('serie', serie);
  if (cliente) qs.set('cliente', cliente);
  if (situacao) qs.set('situacao', situacao);
  if (tipo) qs.set('tipo', tipo);
  if (dataInicio) qs.set('dataInicio', dataInicio);
  if (dataFim) qs.set('dataFim', dataFim);

  $('#nfe-notas-area').html('<div class="text-muted p-3">Carregando…</div>');

  return new Promise((resolve) => {
    $.ajax({
      url: `${API_URL}/nfe/notas?${qs.toString()}`,
      method: 'GET',
      success(resp) {
        nfeNotasCache = resp.notas || [];
        renderTabelaNfeNotas();
        resolve(nfeNotasCache);
      },
      error(xhr) {
        const msg = xhr.responseJSON?.error || 'Erro ao listar NF-e.';
        if (xhr.status === 403) {
          $('#nfe-notas-area').html(`<div class="alert alert-warning">${msg}</div>`);
        } else {
          $('#nfe-notas-area').html(`<div class="alert alert-danger">${msg}</div>`);
        }
        resolve([]);
      }
    });
  });
}

function tipoNfeNota(n) {
  return String(n?.tipo || 'VENDA').toUpperCase();
}

function nfeEstaAutorizada(n) {
  const s = String(n?.status || '').toLowerCase();
  return s === 'autorizada' || s === 'autorizado';
}

function rotuloTipoNfe(tipo) {
  if (tipo === 'DEVOLUCAO_COMPRA') return 'Dev. compra';
  if (tipo === 'DEVOLUCAO_VENDA') return 'Dev. venda';
  return 'Venda';
}

function localizarNotaNfe(id, tipo) {
  const t = String(tipo || 'VENDA').toUpperCase();
  return nfeNotasCache.find((n) => Number(n.id) === Number(id) && tipoNfeNota(n) === t)
    || nfeNotasCache.find((n) => Number(n.id) === Number(id))
    || {};
}

function renderTabelaNfeNotas() {
  if (!nfeNotasCache.length) {
    $('#nfe-notas-area').html('<div class="alert alert-info mb-0">Nenhuma NF-e encontrada.</div>');
    return;
  }

  const rows = nfeNotasCache.map((n) => {
    const tipo = tipoNfeNota(n);
    const autorizada = nfeEstaAutorizada(n);
    const venda = tipo === 'VENDA';
    const tipoJs = escapeHtmlNfe(tipo);
    const sel = nfeNotaSelecionadaId === `${tipo}:${n.id}` || (venda && nfeNotaSelecionadaId === n.id);
    return `
    <tr class="${sel ? 'table-active' : ''}">
      <td><span class="badge bg-secondary">${escapeHtmlNfe(rotuloTipoNfe(tipo))}</span></td>
      <td>${n.numero || '-'}</td>
      <td>${n.serie || '-'}</td>
      <td class="small text-break" style="max-width:180px;">${n.chave_acesso || '-'}</td>
      <td>${n.cliente_nome || '-'}</td>
      <td class="text-nowrap">${formatarDataHoraNfe(n.created_at)}</td>
      <td class="text-end">${formatarMoedaNfe(n.valor)}</td>
      <td>${badgeStatusNfe(n.status)}</td>
      <td class="small">${n.cstat_consulta ? escapeHtmlNfe(String(n.cstat_consulta)) : '-'}</td>
      <td class="small">${n.protocolo || '-'}</td>
      <td class="small">${n.usuario_responsavel || '-'}</td>
      <td class="text-nowrap">
        ${venda ? `<button class="btn btn-sm btn-primary" title="Visualizar NF-e" onclick="visualizarFichaNfe(${n.id})">
          <i class="fas fa-file-alt"></i>
        </button>
        <button class="btn btn-sm btn-outline-secondary" title="Selecionar / Histórico" onclick="selecionarNfeNota(${n.id})">
          <i class="fas fa-history"></i>
        </button>` : ''}
        <button class="btn btn-sm btn-outline-primary" title="Visualizar DANFE" onclick="visualizarDanfeNfe(${n.id}, '${tipoJs}')" ${autorizada ? '' : 'disabled'}>
          <i class="fas fa-eye"></i> DANFE</button>
        <button class="btn btn-sm btn-primary" title="Reimprimir DANFE" onclick="reimprimirDanfeNfe(${n.id}, '${tipoJs}')" ${autorizada ? '' : 'disabled'}>
          <i class="fas fa-print"></i> Reimprimir</button>
        <button class="btn btn-sm btn-outline-secondary" title="Baixar PDF" onclick="downloadDanfeNfe(${n.id}, '${tipoJs}')" ${autorizada ? '' : 'disabled'}>
          <i class="fas fa-file-pdf"></i> PDF</button>
        <button class="btn btn-sm btn-outline-success" title="Download XML" onclick="downloadXmlNfe(${n.id}, '${tipoJs}')" ${autorizada ? '' : 'disabled'}>
          <i class="fas fa-download"></i> XML</button>
        ${venda ? `
        <button class="btn btn-sm btn-outline-dark" title="Ver XML" onclick="visualizarXmlNfe(${n.id})" ${n.tem_xml ? '' : 'disabled'}>
          <i class="fas fa-code"></i>
        </button>
        <button class="btn btn-sm btn-outline-info" title="Atualizar Situação (SEFAZ)" onclick="consultarSituacaoNfe(${n.id})">
          <i class="fas fa-sync"></i>
        </button>
        ${n.pode_reenviar ? `<button class="btn btn-sm btn-warning" title="Reenviar" onclick="reenviarNfeOperacional(${n.id})">REENVIAR</button>` : ''}
        <button class="btn btn-sm btn-outline-danger" title="Cancelar NF-e"
          onclick="cancelarNfeNota(${n.id})"
          ${String(n.status).toLowerCase() === 'autorizada' || String(n.status).toLowerCase() === 'cancelamento_rejeitado' ? '' : 'disabled'}>
          <i class="fas fa-ban"></i>
        </button>` : ''}
      </td>
    </tr>`;
  }).join('');

  $('#nfe-notas-area').html(`
    <div class="table-responsive">
      <table class="table table-sm table-hover align-middle mb-0">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Número</th>
            <th>Série</th>
            <th>Chave</th>
            <th>Destinatário</th>
            <th>Data/Hora</th>
            <th class="text-end">Valor</th>
            <th>Situação</th>
            <th>cStat</th>
            <th>Protocolo</th>
            <th>Usuário</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `);
}

function renderTimelineNfe(timeline) {
  const steps = Array.isArray(timeline) ? timeline : [];
  if (!steps.length) return '';
  const visible = steps.filter((s) => s.done || !s.optional);
  const rotulo = (label) => {
    const l = String(label || '');
    if (/^enviada$/i.test(l)) return 'Transmitida';
    return l;
  };
  return `
    <div class="border-top pt-3 mt-3">
      <div class="small text-muted text-uppercase mb-2">Timeline</div>
      <div class="d-flex flex-column gap-2 p-2 bg-light rounded border">
        ${visible.map((s) => `
          <div class="d-flex align-items-start gap-2">
            <span class="badge ${s.done ? (String(s.id) === 'rejeitada' ? 'bg-danger' : 'bg-success') : 'bg-secondary'}">${escapeHtmlNfe(rotulo(s.label))}</span>
            <div class="small">
              ${s.at ? `<div class="text-muted">${formatarDataHoraNfe(s.at)}</div>` : ''}
              ${s.detail ? `<div class="text-break">${escapeHtmlNfe(s.detail)}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function renderCabecalhoNfeAutorizada(n) {
  const dataAuth = n.updated_at || n.created_at;
  return `
    <div class="border rounded-3 p-3 mb-3 bg-success bg-opacity-10 border-success">
      <div class="d-flex align-items-center gap-2 mb-3">
        <span class="fs-4 text-success">✔</span>
        <h5 class="mb-0 text-success text-uppercase fw-bold">NF-e autorizada</h5>
      </div>
      <div class="row g-2 small">
        <div class="col-md-3">
          <div class="text-muted">Número</div>
          <div class="fs-5 fw-semibold">${escapeHtmlNfe(n.numero || '—')}</div>
        </div>
        <div class="col-md-2">
          <div class="text-muted">Série</div>
          <div class="fs-5 fw-semibold">${escapeHtmlNfe(n.serie || '—')}</div>
        </div>
        <div class="col-md-3">
          <div class="text-muted">Protocolo</div>
          <div class="fw-semibold">${escapeHtmlNfe(n.protocolo || '—')}</div>
        </div>
        <div class="col-md-4">
          <div class="text-muted">Data/Hora da autorização</div>
          <div class="fw-semibold">${formatarDataHoraNfe(dataAuth)}</div>
        </div>
        <div class="col-12">
          <div class="text-muted">Chave de Acesso</div>
          <div class="font-monospace text-break fw-semibold">${escapeHtmlNfe(n.chave_acesso || '—')}</div>
        </div>
      </div>
    </div>`;
}

function renderAcoesPrincipaisNfeAutorizada(notaId, n) {
  const chaveAttr = escapeHtmlNfe(n.chave_acesso || '');
  return `
    <div class="d-flex flex-wrap gap-2 mb-4" id="nfeAcoesPrincipais">
      <button type="button" class="btn btn-primary" onclick="reimprimirDanfeNfe(${notaId})" ${n.tem_danfe ? '' : 'disabled'}>
        <i class="fas fa-print"></i> Imprimir DANFE</button>
      <button type="button" class="btn btn-outline-primary" onclick="visualizarDanfeNfe(${notaId})" ${n.tem_danfe ? '' : 'disabled'}>
        <i class="fas fa-eye"></i> Visualizar DANFE</button>
      <button type="button" class="btn btn-outline-primary" onclick="downloadDanfeNfe(${notaId})" ${n.tem_danfe ? '' : 'disabled'}>
        <i class="fas fa-file-pdf"></i> Baixar PDF</button>
      <button type="button" class="btn btn-outline-dark" onclick="visualizarXmlNfe(${notaId})" ${n.tem_xml ? '' : 'disabled'}>
        <i class="fas fa-file-code"></i> Visualizar XML</button>
      <button type="button" class="btn btn-outline-success" onclick="downloadXmlNfe(${notaId})" ${n.tem_xml ? '' : 'disabled'}>
        <i class="fas fa-download"></i> Baixar XML</button>
      <button type="button" class="btn btn-outline-secondary" onclick="copiarChaveNfe('${chaveAttr}')" ${n.chave_acesso ? '' : 'disabled'}>
        <i class="fas fa-copy"></i> Copiar Chave</button>
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
        <i class="fas fa-times"></i> Fechar</button>
    </div>`;
}

function renderPendenciaDocumentalNfe(notaId, n) {
  const cStat = n.c_stat || n.cstat_consulta || '';
  const motivo = n.mensagem_sefaz || n.x_motivo || n.xmotivo_consulta || n.erro_mensagem || 'Sem motivo retornado pela SEFAZ.';
  const protocolo = n.protocolo || '—';
  const dataSefaz = n.dh_recbto || n.consultado_em || n.updated_at || '';
  const btnReenviar = n.pode_reenviar
    ? `<button type="button" class="btn btn-warning" onclick="reenviarNfeOperacional(${notaId})">
        <i class="fas fa-redo"></i> Reenviar</button>`
    : '';
  return `
    <div class="border rounded-3 p-3 mb-3 bg-warning bg-opacity-10 border-warning">
      <h5 class="text-warning-emphasis mb-2"><i class="fas fa-exclamation-triangle"></i> Pendência documental</h5>
      <div class="row g-2 mb-3 small">
        <div class="col-md-6"><span class="text-muted">Situação:</span> ${badgeStatusNfe(n.status)}</div>
        <div class="col-md-6"><span class="text-muted">Código SEFAZ:</span> <strong>${escapeHtmlNfe(cStat || '—')}</strong></div>
        <div class="col-md-6"><span class="text-muted">Protocolo:</span> ${escapeHtmlNfe(protocolo)}</div>
        <div class="col-md-6"><span class="text-muted">Data:</span> ${escapeHtmlNfe(formatarDataHoraNfe(dataSefaz))}</div>
        <div class="col-12">
          <div class="text-muted">Descrição / Motivo da rejeição</div>
          <div class="fw-semibold text-break">${escapeHtmlNfe(motivo)}</div>
        </div>
      </div>
      <div class="d-flex flex-wrap gap-2">
        <button type="button" class="btn btn-outline-info" onclick="consultarSituacaoNfe(${notaId})">
          <i class="fas fa-sync"></i> Consultar novamente</button>
        <button type="button" class="btn btn-outline-secondary" onclick="corrigirPendenciaNfe(${notaId})">
          <i class="fas fa-edit"></i> Corrigir</button>
        ${btnReenviar}
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
      </div>
    </div>`;
}

function renderCorpoFichaNfe(f, n, emit, dest, itens, pags) {
  return `
    <div class="row g-3 mb-3">
      <div class="col-md-6">
        <div class="card h-100 border-0 shadow-sm">
          <div class="card-header bg-white fw-semibold">Emitente</div>
          <div class="card-body small">
            <div class="fw-semibold">${escapeHtmlNfe(emit.nome || '—')}</div>
            <div>CNPJ: ${escapeHtmlNfe(emit.cnpj || '—')}</div>
            <div>IE: ${escapeHtmlNfe(emit.ie || '—')}</div>
            <div class="text-muted">${escapeHtmlNfe(emit.endereco || '')}</div>
          </div>
        </div>
      </div>
      <div class="col-md-6">
        <div class="card h-100 border-0 shadow-sm">
          <div class="card-header bg-white fw-semibold">Destinatário</div>
          <div class="card-body small">
            <div class="fw-semibold">${escapeHtmlNfe(dest.nome || '—')}</div>
            <div>Documento: ${escapeHtmlNfe(dest.documento || '—')}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">Produtos</div>
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-sm mb-0 align-middle">
            <thead class="table-light">
              <tr>
                <th>Código</th><th>Produto</th><th>NCM</th><th>CFOP</th>
                <th class="text-end">Qtd</th><th class="text-end">Preço</th><th class="text-end">Valor</th>
              </tr>
            </thead>
            <tbody>
              ${itens.map((it) => `
                <tr>
                  <td>${escapeHtmlNfe(it.codigo)}</td>
                  <td>${escapeHtmlNfe(it.nome)}</td>
                  <td>${escapeHtmlNfe(it.ncm)}</td>
                  <td>${escapeHtmlNfe(it.cfop)}</td>
                  <td class="text-end">${escapeHtmlNfe(it.quantidade)} ${escapeHtmlNfe(it.unidade || '')}</td>
                  <td class="text-end">${formatarMoedaNfe(it.preco_unitario)}</td>
                  <td class="text-end">${formatarMoedaNfe(it.valor)}</td>
                </tr>`).join('') || '<tr><td colspan="7" class="text-muted text-center">Sem itens</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="row g-3 mb-3">
      <div class="col-md-4">
        <div class="card h-100 border-0 shadow-sm">
          <div class="card-header bg-white fw-semibold">Totais</div>
          <div class="card-body">
            <div class="fs-4 fw-bold text-primary">${formatarMoedaNfe(f.totais && f.totais.valor)}</div>
            <div class="small text-muted">Venda #${n.venda_id || '—'}${n.pedido_id ? ` · Pedido #${n.pedido_id}` : ''}</div>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card h-100 border-0 shadow-sm">
          <div class="card-header bg-white fw-semibold">Tributos</div>
          <div class="card-body small text-muted">
            Resumo tributário disponível no XML/DANFE.
            ${n.cfop ? `<div class="mt-1">CFOP: <strong class="text-dark">${escapeHtmlNfe(n.cfop)}</strong></div>` : ''}
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card h-100 border-0 shadow-sm">
          <div class="card-header bg-white fw-semibold">Transporte</div>
          <div class="card-body small">
            <div><span class="text-muted">Natureza:</span> ${escapeHtmlNfe(n.natureza_operacao || '—')}</div>
            <div class="text-muted mt-1">Detalhes de frete/volumes no XML/DANFE.</div>
          </div>
        </div>
      </div>
    </div>
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">Pagamentos</div>
      <div class="card-body p-0">
        <ul class="list-group list-group-flush small">
          ${pags.map((p) => `
            <li class="list-group-item d-flex justify-content-between">
              <span>${escapeHtmlNfe(p.forma_pagamento || '—')}${p.rotulo_recebimento ? ` · ${escapeHtmlNfe(p.rotulo_recebimento)}` : ''}</span>
              <strong>${formatarMoedaNfe(p.valor)}</strong>
            </li>`).join('') || '<li class="list-group-item text-muted">Sem pagamentos</li>'}
        </ul>
      </div>
    </div>
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">Informações adicionais</div>
      <div class="card-body small">
        <div><span class="text-muted">Usuário:</span> ${escapeHtmlNfe(n.usuario_responsavel || '—')}</div>
        ${n.mensagem_sefaz ? `<div class="mt-1"><span class="text-muted">SEFAZ:</span> ${escapeHtmlNfe(n.mensagem_sefaz)}</div>` : ''}
      </div>
    </div>
    <div class="card border-0 shadow-sm mb-2">
      <div class="card-header bg-white fw-semibold">Eventos / Histórico</div>
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-sm mb-0">
            <thead><tr><th>Data</th><th>Usuário</th><th>Evento</th><th>Detalhes</th></tr></thead>
            <tbody>
              ${(f.historico || []).map((e) => `
                <tr>
                  <td class="text-nowrap">${formatarDataHoraNfe(e.em)}</td>
                  <td>${escapeHtmlNfe(e.usuario || '—')}</td>
                  <td><span class="badge bg-secondary">${escapeHtmlNfe(e.evento || '—')}</span></td>
                  <td class="small text-break">${escapeHtmlNfe(typeof e.detalhes === 'string' ? e.detalhes : JSON.stringify(e.detalhes || ''))}</td>
                </tr>`).join('') || '<tr><td colspan="4" class="text-muted text-center">Sem eventos</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    ${renderTimelineNfe(f.timeline)}`;
}

function visualizarFichaNfe(id, opcoes = {}) {
  const notaId = Number(id);
  if (!notaId) return;
  nfeNotaSelecionadaId = notaId;
  renderTabelaNfeNotas();

  $('#nfeFichaBody').html('<div class="text-muted">Carregando ficha documental…</div>');
  $('#nfeFichaFooter').html('');
  const el = document.getElementById('nfeFichaModal');
  if (el && window.bootstrap) bootstrap.Modal.getOrCreateInstance(el).show();
  else $('#nfeFichaModal').modal('show');

  // RC3.15.2/3 — ao fechar, permanece na Central com a nota selecionada
  if (el && !el.dataset.boundPosEmissao) {
    el.dataset.boundPosEmissao = '1';
    el.addEventListener('hidden.bs.modal', () => {
      if (nfeNotaSelecionadaId) {
        renderTabelaNfeNotas();
        carregarHistoricoNfe(nfeNotaSelecionadaId);
      }
    });
  }

  $.ajax({
    url: `${API_URL}/nfe/notas/${notaId}/ficha`,
    method: 'GET',
    success(resp) {
      const f = resp.ficha || {};
      const n = f.nota || {};
      const emit = f.emitente || {};
      const dest = f.destinatario || {};
      const itens = f.itens || [];
      const pags = (f.pagamentos || []).slice().sort(function (a, b) {
        const ordem = function (p) {
          const x = String(p.grupo_recebimento || p.tipo_recebimento || p.rotulo_recebimento || '').toLowerCase();
          if (x === 'a' || x === 'fiscal' || x.indexOf('recebimento a') >= 0) return 0;
          if (x === 'b' || x === 'nao_fiscal' || x.indexOf('recebimento b') >= 0) return 1;
          return 2;
        };
        return ordem(a) - ordem(b);
      });
      const st = String(n.status || '').toLowerCase();
      const autorizada = st === 'autorizada';
      const cancelada = st === 'cancelada';
      const pendenteDoc = Boolean(opcoes.pendente) || (!autorizada && !cancelada);

      // RC3.15.3 — rejeição: Pendência Documental (não o cabeçalho de autorizada)
      if (pendenteDoc) {
        $('#nfeFichaTitulo').text(`Pendência documental — NF-e ${n.numero || notaId}`);
        $('#nfeFichaBody').html(`
          ${renderPendenciaDocumentalNfe(notaId, n)}
          ${renderCorpoFichaNfe(f, n, emit, dest, itens, pags)}
        `);
        $('#nfeFichaFooter').html('');
        return;
      }

      $('#nfeFichaTitulo').text(`Visualizar NF-e ${n.numero || '—'} / Série ${n.serie || '—'}`);
      $('#nfeFichaBody').html(`
        ${autorizada ? renderCabecalhoNfeAutorizada(n) : ''}
        ${autorizada ? renderAcoesPrincipaisNfeAutorizada(notaId, n) : ''}
        ${!autorizada ? `<div class="mb-3">${badgeStatusNfe(n.status)}</div>` : ''}
        ${renderCorpoFichaNfe(f, n, emit, dest, itens, pags)}
      `);

      // Ações secundárias no rodapé (cancelar etc.) — principais ficam no cabeçalho
      const podeCancelar = autorizada || st === 'cancelamento_rejeitado';
      $('#nfeFichaFooter').html(autorizada ? `
        <button type="button" class="btn btn-outline-info btn-sm" onclick="consultarSituacaoNfe(${notaId})">
          <i class="fas fa-sync"></i> Consultar SEFAZ</button>
        <button type="button" class="btn btn-outline-danger btn-sm" onclick="cancelarNfeNota(${notaId})" ${podeCancelar ? '' : 'disabled'}>
          <i class="fas fa-ban"></i> Cancelar NF-e</button>
        <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Fechar</button>
      ` : `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
      `);
    },
    error(xhr) {
      $('#nfeFichaBody').html(`<div class="alert alert-danger">${escapeHtmlNfe(xhr.responseJSON?.error || 'Falha ao carregar ficha.')}</div>`);
    }
  });
}

function selecionarNfeNota(id) {
  nfeNotaSelecionadaId = Number(id);
  renderTabelaNfeNotas();
  carregarHistoricoNfe(id);
  const tab = document.getElementById('nfe-tab-historico');
  if (tab && window.bootstrap) {
    bootstrap.Tab.getOrCreateInstance(tab).show();
  } else {
    $(tab).tab('show');
  }
}

function abrirDanfeNfe(id, { download = false, imprimir = false, tipo = 'VENDA' } = {}) {
  const nota = localizarNotaNfe(id, tipo);
  const ref = {
    tipo: tipoNfeNota(nota) || tipo || 'VENDA',
    id: Number(id),
    chave: nota.chave_acesso,
    numero: nota.numero,
    serie: nota.serie,
    imprimir
  };
  if (download && typeof baixarDanfePdf === 'function') {
    baixarDanfePdf(ref);
    return;
  }
  if (typeof abrirDanfe === 'function') {
    abrirDanfe(ref);
    return;
  }
  const url = `${API_URL}/nfe/notas/${id}/danfe${download ? '?download=1' : ''}`;
  if (download) {
    window.open(url, '_blank');
    return;
  }
  $.ajax({
    url,
    method: 'GET',
    dataType: 'html',
    success(html) {
      // RC3.15.3 — Imprimir envia à impressão; Visualizar só pré-visualiza
      if (imprimir && typeof imprimirHtmlFiscal === 'function') {
        imprimirHtmlFiscal(html);
        return;
      }
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
      } else if (typeof showNotification === 'function') {
        showNotification('Permita pop-ups para visualizar o DANFE.', 'warning');
      }
    },
    error(xhr) {
      showNotification(xhr.responseJSON?.error || 'DANFE indisponível.', 'danger');
    }
  });
}

function visualizarDanfeNfe(id, tipo) {
  abrirDanfeNfe(id, { imprimir: false, tipo: tipo || 'VENDA' });
}

function reimprimirDanfeNfe(id, tipo) {
  abrirDanfeNfe(id, { imprimir: true, tipo: tipo || 'VENDA' });
}

function downloadDanfeNfe(id, tipo) {
  abrirDanfeNfe(id, { download: true, tipo: tipo || 'VENDA' });
}

function visualizarXmlNfe(id) {
  $.ajax({
    url: `${API_URL}/nfe/notas/${id}/xml`,
    method: 'GET',
    success(resp) {
      const xml = resp.xml || '';
      nfeXmlCachePorNota[id] = xml;
      $('#nfeXmlConteudo').text(xml);
      $('#nfeXmlDownloadBtn').off('click').on('click', () => downloadXmlNfe(id));
      $('#nfeXmlCopiarBtn').off('click').on('click', () => copiarXmlNfe(id));
      const el = document.getElementById('nfeXmlModal');
      if (el && window.bootstrap) bootstrap.Modal.getOrCreateInstance(el).show();
      else $('#nfeXmlModal').modal('show');
    },
    error(xhr) {
      showNotification(xhr.responseJSON?.error || 'XML indisponível.', 'danger');
    }
  });
}

async function copiarXmlNfe(id) {
  let xml = nfeXmlCachePorNota[id] || $('#nfeXmlConteudo').text() || '';
  if (!xml) {
    showNotification('XML vazio.', 'warning');
    return;
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(xml);
    } else {
      const ta = document.createElement('textarea');
      ta.value = xml;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    showNotification('XML copiado.', 'success');
  } catch (_) {
    showNotification('Não foi possível copiar o XML.', 'danger');
  }
}

/** RC3.15.3 — copiar somente a chave de acesso */
async function copiarChaveNfe(chave) {
  const texto = String(chave || '').replace(/\s/g, '');
  if (!texto) {
    showNotification('Chave de acesso indisponível.', 'warning');
    return;
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(texto);
    } else {
      const ta = document.createElement('textarea');
      ta.value = texto;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    showNotification('✓ Chave copiada.', 'success');
  } catch (_) {
    showNotification('Não foi possível copiar a chave.', 'danger');
  }
}

function corrigirPendenciaNfe(id) {
  const notaId = Number(id);
  showNotification(
    'Revise o motivo da rejeição, ajuste cadastro/fiscal se necessário e use Reenviar.',
    'info'
  );
  if (notaId) consultarSituacaoNfe(notaId);
}

function downloadXmlNfe(id, tipo) {
  const nota = localizarNotaNfe(id, tipo);
  if (typeof baixarXmlNfe55 === 'function') {
    baixarXmlNfe55({ tipo: tipoNfeNota(nota) || tipo || 'VENDA', id: Number(id), chave: nota.chave_acesso });
    return;
  }
  window.open(`${API_URL}/nfe/notas/${id}/xml?download=1`, '_blank');
}

function consultarSituacaoNfe(id) {
  showNotification('Consultando SEFAZ…', 'info');
  $.ajax({
    url: `${API_URL}/nfe/notas/${id}/consultar`,
    method: 'POST',
    contentType: 'application/json',
    data: '{}',
    success(resp) {
      showNotification(
        `Consulta OK — cStat ${resp.cStat || '-'} / ${resp.status || ''}`,
        'success'
      );
      carregarNfeNotas();
      if (nfeNotaSelecionadaId === Number(id)) carregarHistoricoNfe(id);
    },
    error(xhr) {
      showNotification(xhr.responseJSON?.error || 'Falha na consulta.', 'danger');
    }
  });
}

function cancelarNfeNota(id) {
  const motivo = prompt('Informe o motivo do cancelamento (mín. 15 caracteres):');
  if (motivo == null) return;
  if (String(motivo).trim().length < 15) {
    showNotification('Motivo deve ter pelo menos 15 caracteres.', 'warning');
    return;
  }
  if (!confirm('Confirma o cancelamento desta NF-e na SEFAZ? A venda/pedido não serão estornados.')) {
    return;
  }

  $.ajax({
    url: `${API_URL}/nfe/notas/${id}/cancelar`,
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({ justificativa: motivo.trim() }),
    success(resp) {
      if (resp.success) {
        showNotification('NF-e cancelada com sucesso.', 'success');
      } else {
        showNotification(`Cancelamento rejeitado. Status: ${resp.status}`, 'warning');
      }
      carregarNfeNotas();
      if (nfeNotaSelecionadaId === Number(id)) carregarHistoricoNfe(id);
      const fichaEl = document.getElementById('nfeFichaModal');
      if (fichaEl && fichaEl.classList.contains('show')) {
        visualizarFichaNfe(id);
      }
    },
    error(xhr) {
      showNotification(xhr.responseJSON?.error || 'Erro ao cancelar NF-e.', 'danger');
    }
  });
}

function carregarHistoricoNfe(id) {
  $('#nfe-historico-titulo').text(`Histórico da NF-e #${id}`);
  $('#nfe-historico-area').html('<div class="text-muted">Carregando…</div>');
  $.ajax({
    url: `${API_URL}/nfe/notas/${id}/historico`,
    method: 'GET',
    success(resp) {
      const eventos = resp.eventos || [];
      if (!eventos.length) {
        $('#nfe-historico-area').html('<div class="alert alert-info mb-0">Nenhum evento registrado ainda.</div>');
        return;
      }
      const rows = eventos.map((e) => {
        let detalhes = e.detalhes || '';
        try {
          if (typeof detalhes === 'string' && detalhes.trim().startsWith('{')) {
            detalhes = JSON.stringify(JSON.parse(detalhes), null, 0);
          }
        } catch (_) { /* keep */ }
        return `
          <tr>
            <td class="text-nowrap">${formatarDataHoraNfe(e.criado_em)}</td>
            <td>${e.usuario_nome || '-'}</td>
            <td><span class="badge bg-secondary">${e.acao || '-'}</span></td>
            <td class="small text-break">${detalhes || '-'}</td>
          </tr>`;
      }).join('');
      $('#nfe-historico-area').html(`
        <div class="table-responsive">
          <table class="table table-sm">
            <thead><tr><th>Data/Hora</th><th>Usuário</th><th>Evento</th><th>Detalhes</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`);
    },
    error(xhr) {
      $('#nfe-historico-area').html(`<div class="alert alert-danger">${xhr.responseJSON?.error || 'Erro'}</div>`);
    }
  });
}

function reenviarNfeOperacional(id) {
  if (!confirm('Reenviar esta NF-e à SEFAZ?')) return;
  showNotification('Reenviando…', 'info');
  $.ajax({
    url: `${API_URL}/nfe/notas/${id}/reenviar`,
    method: 'POST',
    contentType: 'application/json',
    data: '{}',
    success(resp) {
      const ok = resp.success || resp.status === 'autorizada';
      showNotification(resp.message || (ok ? 'Reenvio concluído.' : 'Reenvio processado.'), ok ? 'success' : 'warning');
      carregarNfeNotas().then(() => {
        if (ok) {
          visualizarFichaNfe(resp.notaId || id);
        }
      });
    },
    error(xhr) {
      showNotification(xhr.responseJSON?.error || xhr.responseJSON?.mensagem || 'Falha no reenvio.', 'danger');
    }
  });
}

/** RC3.15 — abrir Central Documental a partir de outros módulos */
function abrirCentralNfeDocumental(opcoes = {}) {
  const notaId = Number(opcoes.notaId || opcoes.nota_id || 0) || null;
  window.__CDS_NFE_FOCUS_NOTA_ID = notaId;
  window.__CDS_NFE_OPEN_FICHA = opcoes.openFicha !== false;
  window.__CDS_NFE_POS_EMISSAO = Boolean(opcoes.posEmissao);
  window.__CDS_NFE_PENDENTE = Boolean(opcoes.pendente);
  if (opcoes.banner) window.__CDS_NFE_AUTH_BANNER = opcoes.banner;
  if (typeof loadPage === 'function') {
    loadPage('nfe-central');
    $('.nav-link').removeClass('active');
    $(`.nav-link[data-page="nfe-central"]`).addClass('active');
  }
}

/**
 * RC3.15.2 — pós-emissão: abrir Visualização da NF-e automaticamente
 * (paridade com NFC-e → Cupom Fiscal).
 * Autorizada → ficha + DANFE; rejeição → ficha de pendência.
 */
function apresentarDocumentoNfePosEmissao(nfe) {
  const notaId = Number(nfe?.notaId || nfe?.nota_id || 0) || null;
  if (!notaId) return false;
  const status = String(nfe?.status || '').toLowerCase();
  const autorizada = Boolean(nfe?.success || status === 'autorizada');
  const tipoDanfe = String(nfe?.tipoDanfe || nfe?.tipo || '').toUpperCase();
  const origem = String(nfe?.origem || '').toUpperCase();
  let tipo = 'VENDA';
  if (tipoDanfe === 'DEVOLUCAO_COMPRA' || origem === 'COMPRA') tipo = 'DEVOLUCAO_COMPRA';
  else if (tipoDanfe === 'DEVOLUCAO_VENDA' || (origem === 'VENDA' && /DEVOLU/.test(String(nfe?.tipoDocumento || '')))) {
    tipo = 'DEVOLUCAO_VENDA';
  }
  if (autorizada && typeof abrirDanfe === 'function') {
    abrirDanfe({
      tipo,
      id: notaId,
      chave: nfe?.chaveAcesso || nfe?.chave,
      numero: nfe?.numero,
      serie: nfe?.serie,
      auto: true
    });
  }
  if (tipo !== 'VENDA') return true;
  const banner = autorizada
    ? {
      notaId,
      numero: nfe?.numero,
      serie: nfe?.serie,
      protocolo: nfe?.protocolo,
      chaveAcesso: nfe?.chaveAcesso || nfe?.chave
    }
    : null;
  abrirCentralNfeDocumental({
    notaId,
    openFicha: true,
    banner,
    posEmissao: true,
    pendente: !autorizada
  });
  return true;
}

window.loadNfeCentral = loadNfeCentral;
window.carregarNfeNotas = carregarNfeNotas;
window.selecionarNfeNota = selecionarNfeNota;
window.visualizarFichaNfe = visualizarFichaNfe;
window.visualizarDanfeNfe = visualizarDanfeNfe;
window.reimprimirDanfeNfe = reimprimirDanfeNfe;
window.downloadDanfeNfe = downloadDanfeNfe;
window.visualizarXmlNfe = visualizarXmlNfe;
window.copiarXmlNfe = copiarXmlNfe;
window.copiarChaveNfe = copiarChaveNfe;
window.corrigirPendenciaNfe = corrigirPendenciaNfe;
window.downloadXmlNfe = downloadXmlNfe;
window.consultarSituacaoNfe = consultarSituacaoNfe;
window.cancelarNfeNota = cancelarNfeNota;
window.reenviarNfeOperacional = reenviarNfeOperacional;
window.abrirCentralNfeDocumental = abrirCentralNfeDocumental;
window.apresentarDocumentoNfePosEmissao = apresentarDocumentoNfePosEmissao;
