/**
 * RC3.18 — Central Contábil (Exportação para Contabilidade).
 * Consome exclusivamente POST /api/fiscal/exportar-contabilidade.
 */

function loadCentralContabil() {
  const hoje = new Date();
  const yyyy = hoje.getFullYear();
  const mm = String(hoje.getMonth() + 1).padStart(2, '0');
  const primeiroDia = `${yyyy}-${mm}-01`;
  const ultimoDia = `${yyyy}-${mm}-${String(new Date(yyyy, hoje.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

  $('#page-content').html(`
    <div class="container-fluid py-3">
      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div>
          <h2 class="h4 mb-1"><i class="fas fa-file-export me-2"></i>Central Contábil</h2>
          <p class="text-muted mb-0">Exportação de documentos fiscais para o escritório contábil.</p>
        </div>
      </div>

      <div class="card border-0 shadow-sm">
        <div class="card-body">
          <form id="formCentralContabil" class="row g-3">
            <div class="col-md-3">
              <label class="form-label" for="contabilDataInicial">Data Inicial</label>
              <input type="date" class="form-control" id="contabilDataInicial" value="${primeiroDia}" required>
            </div>
            <div class="col-md-3">
              <label class="form-label" for="contabilDataFinal">Data Final</label>
              <input type="date" class="form-control" id="contabilDataFinal" value="${ultimoDia}" required>
            </div>
            <div class="col-12">
              <label class="form-label d-block">Documentos e relatórios</label>
              <div class="d-flex flex-wrap gap-3">
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" id="contabilIncluirNfce" checked>
                  <label class="form-check-label" for="contabilIncluirNfce">NFC-e Emitidas</label>
                </div>
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" id="contabilIncluirNfe" checked>
                  <label class="form-check-label" for="contabilIncluirNfe">NF-e Emitidas</label>
                </div>
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" id="contabilIncluirEntradas" checked>
                  <label class="form-check-label" for="contabilIncluirEntradas">XML de Entradas</label>
                </div>
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" id="contabilIncluirRelatorios" checked>
                  <label class="form-check-label" for="contabilIncluirRelatorios">Relatórios CSV</label>
                </div>
                <div class="form-check">
                  <input class="form-check-input" type="checkbox" id="contabilIncluirManifesto" checked>
                  <label class="form-check-label" for="contabilIncluirManifesto">Manifesto de Exportação</label>
                </div>
              </div>
            </div>
            <div class="col-12">
              <button type="submit" class="btn btn-primary" id="btnGerarArquivoContabil">
                <i class="fas fa-file-archive me-1"></i> Gerar Arquivo Contábil
              </button>
            </div>
          </form>
          <div id="contabilStatus" class="mt-3 small text-muted"></div>
        </div>
      </div>

      <div class="alert alert-light border mt-3 mb-0">
        <strong>Estrutura do ZIP:</strong>
        XML_NFCE · XML_NFE · XML_ENTRADAS · RELATORIOS (vendas.csv, compras.csv, resumo.csv, manifesto_exportacao.txt)
      </div>
    </div>
  `);

  $('#formCentralContabil').off('submit.centralContabil').on('submit.centralContabil', function (e) {
    e.preventDefault();
    gerarArquivoContabil();
  });
}

async function gerarArquivoContabil() {
  const dataInicial = String($('#contabilDataInicial').val() || '').trim();
  const dataFinal = String($('#contabilDataFinal').val() || '').trim();
  const incluirNfce = $('#contabilIncluirNfce').is(':checked');
  const incluirNfe = $('#contabilIncluirNfe').is(':checked');
  const incluirEntradas = $('#contabilIncluirEntradas').is(':checked');
  const incluirRelatorios = $('#contabilIncluirRelatorios').is(':checked');
  const incluirManifesto = $('#contabilIncluirManifesto').is(':checked');

  const $status = $('#contabilStatus');
  const $btn = $('#btnGerarArquivoContabil');

  if (!dataInicial || !dataFinal) {
    alertarContabil('Informe data inicial e data final.', 'warning');
    return;
  }
  if (dataInicial > dataFinal) {
    alertarContabil('A data inicial não pode ser maior que a data final.', 'warning');
    return;
  }
  if (!incluirNfce && !incluirNfe && !incluirEntradas && !incluirRelatorios && !incluirManifesto) {
    alertarContabil('Selecione ao menos um item para exportar.', 'warning');
    return;
  }

  $btn.prop('disabled', true);
  $status.text('Gerando arquivo contábil…');

  try {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
    const base = (typeof API_URL === 'string' && API_URL) ? API_URL : `${window.location.origin}/api`;
    const resp = await fetch(`${base}/fiscal/exportar-contabilidade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        dataInicial,
        dataFinal,
        incluirNfce,
        incluirNfe,
        incluirEntradas,
        incluirRelatorios,
        incluirManifesto
      })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || err.message || `Falha na exportação (HTTP ${resp.status}).`);
    }

    const blob = await resp.blob();
    const headerName = resp.headers.get('X-Export-Filename') || resp.headers.get('content-disposition');
    let filename = `CONTABILIDADE_${dataFinal.slice(0, 7).replace('-', '_')}.zip`;
    if (headerName && headerName.includes('.zip')) {
      const m = headerName.match(/filename="?([^";]+)"?/i);
      if (m && m[1]) filename = m[1];
      else if (!headerName.includes('attachment')) filename = headerName.trim();
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    let resumoTxt = 'Arquivo gerado com sucesso.';
    try {
      const resumoRaw = resp.headers.get('X-Export-Resumo');
      if (resumoRaw) {
        const r = JSON.parse(resumoRaw);
        resumoTxt = `ZIP gerado — NFC-e: ${r.quantidadeNfce || 0}, NF-e: ${r.quantidadeNfe || 0}, Entradas: ${r.quantidadeEntradas || 0}.`;
      }
    } catch (_) { /* ignore */ }

    $status.text(resumoTxt);
    alertarContabil(resumoTxt, 'success');
  } catch (err) {
    const msg = err.message || 'Erro ao gerar arquivo contábil.';
    $status.text(msg);
    alertarContabil(msg, 'danger');
  } finally {
    $btn.prop('disabled', false);
  }
}

function alertarContabil(mensagem, tipo) {
  if (typeof showNotification === 'function') {
    showNotification(mensagem, tipo === 'success' ? 'success' : tipo === 'warning' ? 'warning' : 'danger');
  } else {
    window.alert(mensagem);
  }
}

window.loadCentralContabil = loadCentralContabil;
