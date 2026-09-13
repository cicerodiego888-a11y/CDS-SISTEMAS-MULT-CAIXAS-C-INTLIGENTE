/**
 * Visualizador central de DANFE NF-e 55.
 * Usado por vendas, faturamento, compras (devolução) e Central NF-e.
 */
(function nfeDanfeViewer(global) {
  const TIPOS = {
    VENDA: 'VENDA',
    DEVOLUCAO_COMPRA: 'DEVOLUCAO_COMPRA',
    DEVOLUCAO_VENDA: 'DEVOLUCAO_VENDA'
  };

  function apiBase() {
    return (typeof API_URL !== 'undefined' && API_URL) ? API_URL : '/api';
  }

  function tokenHeaders() {
    const token = localStorage.getItem('token') || '';
    return { Authorization: `Bearer ${token}` };
  }

  function normalizarTipo(ref) {
    const t = String(ref?.tipo || ref?.origem || ref?.tipoDocumento || 'VENDA')
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
    if (t === 'COMPRA' || t === 'DEVOLUCAO_COMPRA' || t === 'DEV_COMPRA') return TIPOS.DEVOLUCAO_COMPRA;
    if (t === 'DEVOLUCAO_VENDA' || t === 'VENDA_DEVOLUCAO' || t === 'DEV_VENDA') return TIPOS.DEVOLUCAO_VENDA;
    if (t === 'DEVOLUCAO' && String(ref?.origem || '').toUpperCase() === 'COMPRA') return TIPOS.DEVOLUCAO_COMPRA;
    if (t === 'DEVOLUCAO' && String(ref?.origem || '').toUpperCase() === 'VENDA') return TIPOS.DEVOLUCAO_VENDA;
    return TIPOS.VENDA;
  }

  function idDocumento(ref) {
    return Number(ref?.id || ref?.notaId || ref?.nota_id || 0) || null;
  }

  function urlDocumento(ref, recurso) {
    const tipo = normalizarTipo(ref);
    const id = idDocumento(ref);
    const qs = [];
    if (ref?.chave) qs.push(`chave=${encodeURIComponent(String(ref.chave).replace(/\D/g, ''))}`);
    if (ref?.numero != null) qs.push(`numero=${encodeURIComponent(ref.numero)}`);
    if (ref?.serie != null) qs.push(`serie=${encodeURIComponent(ref.serie)}`);
    const q = qs.length ? `?${qs.join('&')}` : '';
    return `${apiBase()}/nfe/documentos/${encodeURIComponent(tipo)}/${id}/${recurso}${q}`;
  }

  function garantirModal() {
    if (document.getElementById('nfeDanfeViewerModal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="modal fade" id="nfeDanfeViewerModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-xl modal-dialog-scrollable nfe-danfe-print-root">
          <div class="modal-content">
            <div class="modal-header nfe-danfe-toolbar">
              <div>
                <h5 class="modal-title mb-0">DANFE</h5>
                <div class="small text-muted" id="nfeDanfeViewerSub">Documento Auxiliar da Nota Fiscal Eletrônica</div>
              </div>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
            </div>
            <div class="modal-body p-0" style="min-height:70vh">
              <iframe id="nfeDanfeIframe" title="DANFE" style="width:100%;height:70vh;border:0;background:#fff"></iframe>
            </div>
            <div class="modal-footer nfe-danfe-toolbar flex-wrap">
              <button type="button" class="btn btn-primary" id="nfeDanfeBtnImprimir">🖨 Imprimir</button>
              <button type="button" class="btn btn-outline-primary" id="nfeDanfeBtnPdf">📄 Baixar PDF</button>
              <button type="button" class="btn btn-outline-dark" id="nfeDanfeBtnXml">&lt;/&gt; Baixar XML</button>
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
            </div>
          </div>
        </div>
      </div>
      <style id="nfeDanfePrintCss">
        @media print {
          body * { visibility: hidden !important; }
          #nfeDanfeViewerModal, #nfeDanfeViewerModal .modal-dialog,
          #nfeDanfeViewerModal .modal-content, #nfeDanfeViewerModal iframe,
          #nfeDanfeIframe { visibility: visible !important; }
          .nfe-danfe-toolbar, .modal-backdrop, .btn-close { display: none !important; }
          #nfeDanfeViewerModal { position: static !important; inset: auto !important; }
          #nfeDanfeViewerModal .modal-dialog { max-width: 100% !important; margin: 0 !important; }
          #nfeDanfeIframe { height: auto !important; min-height: 100vh !important; }
        }
      </style>`;
    document.body.appendChild(wrap.firstElementChild);
    document.body.appendChild(wrap.lastElementChild);
  }

  function mostrarErro(msg) {
    if (typeof showNotification === 'function') showNotification(msg, 'danger');
    else alert(msg);
  }

  async function baixarArquivo(url, filename) {
    const resp = await fetch(url, { headers: tokenHeaders() });
    if (!resp.ok) {
      let detalhe = 'Falha no download.';
      try {
        const j = await resp.json();
        detalhe = j.error || j.message || detalhe;
      } catch (_) { /* ignore */ }
      throw new Error(detalhe);
    }
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  let refAtual = null;

  function imprimirDanfeAtual() {
    const iframe = document.getElementById('nfeDanfeIframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      return;
    }
    window.print();
  }

  async function abrirDanfe(ref = {}) {
    const id = idDocumento(ref);
    if (!id) {
      mostrarErro('Documento fiscal sem identificador.');
      return false;
    }
    refAtual = { ...ref, tipo: normalizarTipo(ref), id };
    garantirModal();
    const sub = document.getElementById('nfeDanfeViewerSub');
    if (sub) sub.textContent = 'Carregando DANFE autorizado…';

    const iframe = document.getElementById('nfeDanfeIframe');
    try {
      const resp = await fetch(urlDocumento(refAtual, 'danfe'), { headers: tokenHeaders() });
      const html = await resp.text();
      if (!resp.ok) {
        let msg = 'DANFE indisponível.';
        try { msg = JSON.parse(html).error || JSON.parse(html).message || msg; } catch (_) { /* html */ }
        throw new Error(msg);
      }
      if (iframe) iframe.srcdoc = html;
      if (sub) {
        sub.textContent = `NF-e nº ${refAtual.numero || '—'} · Série ${refAtual.serie || '—'} · ✓ AUTORIZADA`;
      }
      const el = document.getElementById('nfeDanfeViewerModal');
      if (el && window.bootstrap) bootstrap.Modal.getOrCreateInstance(el).show();
      else if (window.$) $('#nfeDanfeViewerModal').modal('show');

      const btnP = document.getElementById('nfeDanfeBtnImprimir');
      const btnPdf = document.getElementById('nfeDanfeBtnPdf');
      const btnXml = document.getElementById('nfeDanfeBtnXml');
      if (btnP) btnP.onclick = () => imprimirDanfeAtual();
      if (btnPdf) btnPdf.onclick = () => baixarDanfePdf(refAtual);
      if (btnXml) btnXml.onclick = () => baixarXmlNfe55(refAtual);

      if (ref.imprimir) {
        setTimeout(() => imprimirDanfeAtual(), 400);
      }
      return true;
    } catch (err) {
      mostrarErro(err.message || 'Não foi possível abrir o DANFE.');
      return false;
    }
  }

  async function baixarDanfePdf(ref) {
    const r = ref || refAtual;
    try {
      await baixarArquivo(urlDocumento(r, 'pdf'), `DANFE-${r.chave || r.id}.pdf`);
    } catch (err) {
      mostrarErro(err.message);
    }
  }

  async function baixarXmlNfe55(ref) {
    const r = ref || refAtual;
    try {
      await baixarArquivo(urlDocumento(r, 'xml'), `NFE-${r.chave || r.id}.xml`);
    } catch (err) {
      mostrarErro(err.message);
    }
  }

  global.abrirDanfe = abrirDanfe;
  global.baixarDanfePdf = baixarDanfePdf;
  global.baixarXmlNfe55 = baixarXmlNfe55;
  global.FiscalDanfeViewer = { abrir: abrirDanfe, baixarPdf: baixarDanfePdf, baixarXml: baixarXmlNfe55 };
})(window);
