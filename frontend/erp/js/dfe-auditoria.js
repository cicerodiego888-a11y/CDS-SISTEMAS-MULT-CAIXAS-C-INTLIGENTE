/**
 * RC3.6.E — Tela administrativa Motor DF-e → Auditoria (somente suporte).
 */

'use strict';

const dfeAudState = {
  offset: 0,
  limite: 50,
  total: 0,
  carregando: false
};

function dfeAudApiBase() {
  return (typeof API_URL === 'string' && API_URL.trim() !== '')
    ? API_URL
    : `${window.location.origin}/api`;
}

function dfeAudHeaders() {
  return {
    Authorization: `Bearer ${localStorage.getItem('token') || ''}`
  };
}

function dfeAudEscape(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dfeAudBadgeResultado(resultado) {
  const r = String(resultado || '');
  let cls = 'bg-secondary';
  if (['PROCESSADO', 'XML_COMPLETO', 'RESUMO', 'NSU_AVANCO', 'SYNC_RESUMO', 'CONSULTA'].includes(r)) {
    cls = 'bg-success';
  } else if (['DUPLICADO', 'IGNORADO', 'EVENTO', 'NSU_PRESERVADO'].includes(r)) {
    cls = 'bg-warning text-dark';
  } else if (r.startsWith('ERRO') || ['SEM_XML', 'SEM_RESUMO', 'DESCONHECIDO'].includes(r)) {
    cls = 'bg-danger';
  }
  return `<span class="badge ${cls}">${dfeAudEscape(r || '—')}</span>`;
}

function dfeAudColetarFiltros() {
  return {
    data_inicio: document.getElementById('dfeAudDataInicio')?.value || '',
    data_fim: document.getElementById('dfeAudDataFim')?.value || '',
    nsu: document.getElementById('dfeAudNsu')?.value || '',
    chave: document.getElementById('dfeAudChave')?.value || '',
    resultado: document.getElementById('dfeAudResultado')?.value || '',
    schema: document.getElementById('dfeAudSchema')?.value || '',
    cnpj: document.getElementById('dfeAudCnpj')?.value || '',
    correlation_id: document.getElementById('dfeAudCorrelation')?.value || '',
    limite: dfeAudState.limite,
    offset: dfeAudState.offset
  };
}

function dfeAudQueryString(extra = {}) {
  const f = { ...dfeAudColetarFiltros(), ...extra };
  const params = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (v != null && String(v).trim() !== '') params.set(k, String(v).trim());
  });
  return params.toString();
}

async function dfeAudCarregarResultadosSelect() {
  const select = document.getElementById('dfeAudResultado');
  if (!select || select.options.length > 1) return;
  try {
    const resp = await fetch(`${dfeAudApiBase()}/dfe-auditoria/resultados`, { headers: dfeAudHeaders() });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return;
    (data.resultados || []).forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      select.appendChild(opt);
    });
  } catch (_err) {
    /* ignore */
  }
}

async function dfeAudPesquisar(resetOffset = false) {
  if (dfeAudState.carregando) return;
  if (resetOffset) dfeAudState.offset = 0;
  dfeAudState.carregando = true;

  const tbody = document.getElementById('dfeAudTabela');
  const resumo = document.getElementById('dfeAudResumo');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-3">Carregando...</td></tr>';
  }

  try {
    const resp = await fetch(`${dfeAudApiBase()}/dfe-auditoria?${dfeAudQueryString()}`, {
      headers: dfeAudHeaders()
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Falha ao listar auditoria DF-e');

    dfeAudState.total = Number(data.total || 0);
    const itens = data.itens || [];

    if (!itens.length) {
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-4">Nenhum evento encontrado para os filtros.</td></tr>';
      }
    } else if (tbody) {
      tbody.innerHTML = itens.map((row) => {
        const created = String(row.created_at || '').replace('T', ' ').slice(0, 19);
        const chaveCurta = row.chave
          ? `${String(row.chave).slice(0, 10)}…${String(row.chave).slice(-6)}`
          : '—';
        const motivo = row.motivo
          ? (String(row.motivo).length > 80 ? `${String(row.motivo).slice(0, 80)}…` : row.motivo)
          : '—';
        return `
          <tr>
            <td class="text-nowrap">${dfeAudEscape(created)}</td>
            <td><code class="small">${dfeAudEscape(row.correlation_id || '—')}</code></td>
            <td>${dfeAudEscape(row.nsu || '—')}</td>
            <td>${dfeAudEscape(row.tipo || '—')}</td>
            <td class="small">${dfeAudEscape(row.schema || '—')}</td>
            <td title="${dfeAudEscape(row.chave || '')}">${dfeAudEscape(chaveCurta)}</td>
            <td>${dfeAudBadgeResultado(row.resultado)}</td>
            <td class="small" title="${dfeAudEscape(row.motivo || '')}">${dfeAudEscape(motivo)}</td>
            <td>${row.tempo_ms != null ? dfeAudEscape(row.tempo_ms) : '—'}</td>
            <td>
              <button type="button" class="btn btn-sm btn-outline-primary dfe-aud-detalhe" data-id="${row.id}">
                Detalhe
              </button>
            </td>
          </tr>`;
      }).join('');
    }

    if (resumo) {
      const pagina = Math.floor(dfeAudState.offset / dfeAudState.limite) + 1;
      resumo.textContent = `Total: ${dfeAudState.total} · página ${pagina} · exibindo ${itens.length}`;
    }

    const prev = document.getElementById('dfeAudPrev');
    const next = document.getElementById('dfeAudNext');
    if (prev) prev.disabled = dfeAudState.offset <= 0;
    if (next) next.disabled = (dfeAudState.offset + dfeAudState.limite) >= dfeAudState.total;
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-danger text-center py-3">${dfeAudEscape(err.message)}</td></tr>`;
    }
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  } finally {
    dfeAudState.carregando = false;
  }
}

async function dfeAudAbrirDetalhe(id) {
  try {
    const resp = await fetch(`${dfeAudApiBase()}/dfe-auditoria/${id}`, { headers: dfeAudHeaders() });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Registro não encontrado');

    let detalhe = data.detalhe_json;
    try {
      detalhe = typeof detalhe === 'string' ? JSON.parse(detalhe) : detalhe;
    } catch (_e) { /* keep raw */ }

    const payload = { ...data, detalhe_json: detalhe };
    const pre = document.getElementById('dfeAudDetalheJson');
    if (pre) pre.textContent = JSON.stringify(payload, null, 2);

    const el = document.getElementById('dfeAudModalDetalhe');
    if (el && window.bootstrap?.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(el).show();
    } else if (typeof $ !== 'undefined' && $.fn.modal) {
      $('#dfeAudModalDetalhe').modal('show');
    }
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

async function dfeAudExportar(formato) {
  try {
    const qs = dfeAudQueryString({ format: formato, limite: 5000, offset: 0 });
    const resp = await fetch(`${dfeAudApiBase()}/dfe-auditoria/export/arquivo?${qs}`, {
      headers: dfeAudHeaders()
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || 'Falha na exportação');
    }
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dfe-auditoria-${new Date().toISOString().slice(0, 10)}.${formato === 'csv' ? 'csv' : 'json'}`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    if (typeof showNotification === 'function') showNotification(err.message, 'danger');
  }
}

function dfeAudLimparFiltros() {
  ['dfeAudDataInicio', 'dfeAudDataFim', 'dfeAudNsu', 'dfeAudChave', 'dfeAudSchema', 'dfeAudCnpj', 'dfeAudCorrelation']
    .forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  const sel = document.getElementById('dfeAudResultado');
  if (sel) sel.value = '';
  dfeAudState.offset = 0;
  dfeAudPesquisar(true);
}

function dfeAudBindEventos() {
  $('#dfeAudPesquisar').off('click').on('click', () => dfeAudPesquisar(true));
  $('#dfeAudLimpar').off('click').on('click', () => dfeAudLimparFiltros());
  $('#dfeAudExportCsv').off('click').on('click', () => dfeAudExportar('csv'));
  $('#dfeAudExportJson').off('click').on('click', () => dfeAudExportar('json'));
  $('#dfeAudPrev').off('click').on('click', () => {
    dfeAudState.offset = Math.max(0, dfeAudState.offset - dfeAudState.limite);
    dfeAudPesquisar(false);
  });
  $('#dfeAudNext').off('click').on('click', () => {
    dfeAudState.offset += dfeAudState.limite;
    dfeAudPesquisar(false);
  });
  $('#dfeAudTabela').off('click', '.dfe-aud-detalhe').on('click', '.dfe-aud-detalhe', function onDetalhe() {
    dfeAudAbrirDetalhe(Number(this.getAttribute('data-id')));
  });
}

function loadDfeAuditoria() {
  if (typeof usuarioPodeAcessarDiagnosticoCentral === 'function' && !usuarioPodeAcessarDiagnosticoCentral()) {
    $('#page-content').html('<div class="alert alert-warning">Acesso restrito: apenas ADMIN, SUPER_ADMIN ou SUPORTE.</div>');
    return;
  }

  if (typeof carregarPaginaHtml === 'function') {
    carregarPaginaHtml('dfe-auditoria.html', async () => {
      await dfeAudCarregarResultadosSelect();
      dfeAudBindEventos();
      await dfeAudPesquisar(true);
    });
    return;
  }

  $('#page-content').html('<div class="alert alert-danger">Falha ao carregar página de auditoria DF-e.</div>');
}

window.loadDfeAuditoria = loadDfeAuditoria;
window.dfeAudPesquisar = dfeAudPesquisar;
