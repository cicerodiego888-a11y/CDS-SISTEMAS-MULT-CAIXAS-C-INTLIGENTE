(function (root) {
    'use strict';

    const REPORT_PATH = 'compras-relatorio.html';

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function cents(value) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.round(number * 100) : 0;
    }

    function formatMoney(value) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format((cents(value)) / 100);
    }

    function formatQuantity(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return 'Não informado';
        return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 }).format(number);
    }

    function formatDate(value) {
        const raw = String(value || '').slice(0, 10);
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
        return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Não informada';
    }

    function valueOrMissing(value) {
        return value == null || String(value).trim() === ''
            ? 'Não informado'
            : String(value);
    }

    function invoiceIdentity(purchase) {
        const number = String(purchase.numero_nf || '').trim();
        if (!number) return null;
        return [
            number.toLocaleUpperCase('pt-BR'),
            String(purchase.serie_nf || '').trim().toLocaleUpperCase('pt-BR'),
            String(purchase.fornecedor || '').trim().toLocaleUpperCase('pt-BR')
        ].join('|');
    }

    function summarizePurchases(purchases) {
        const summary = {
            purchaseCount: purchases.length,
            officialTotalCents: 0,
            itemLineCount: 0,
            invoiceCount: 0
        };
        const invoices = new Set();
        for (const purchase of purchases) {
            summary.officialTotalCents += cents(purchase.total_oficial);
            const items = Array.isArray(purchase.itens) ? purchase.itens : [];
            summary.itemLineCount += items.length;
            const invoice = invoiceIdentity(purchase);
            if (invoice) invoices.add(invoice);
        }
        summary.invoiceCount = invoices.size;
        return summary;
    }

    function renderItemRows(items) {
        if (!items.length) {
            return '<tr><td colspan="7" class="text-center text-muted">Nenhum item registrado nesta compra.</td></tr>';
        }
        return items.map((item, index) => {
            const codigo = item.codigo_barras || (item.produto_id != null ? `ID ${item.produto_id}` : null);
            return `<tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(valueOrMissing(codigo))}</td>
                <td>${escapeHtml(valueOrMissing(item.descricao_produto))}</td>
                <td>${escapeHtml(valueOrMissing(item.unidade))}</td>
                <td class="number">${escapeHtml(formatQuantity(item.quantidade))}</td>
                <td class="number">${escapeHtml(formatOptionalMoney(item.preco_unitario))}</td>
                <td class="number">${escapeHtml(formatOptionalMoney(item.subtotal))}</td>
            </tr>`;
        }).join('');
    }

    function formatOptionalMoney(value) {
        return value == null ? 'Não informado' : formatMoney(value);
    }

    function renderFinancial(purchase) {
        const items = Array.isArray(purchase.itens) ? purchase.itens : [];
        const itemSubtotalsPresent = items.every((item) => item.subtotal != null);
        const itemSubtotalCents = itemSubtotalsPresent
            ? items.reduce((sum, item) => sum + cents(item.subtotal), 0)
            : null;
        const officialTotalCents = cents(purchase.total_oficial);
        const reconciliationCents = itemSubtotalCents == null ? null : itemSubtotalCents - officialTotalCents;
        const compositionFields = [
            purchase.valor_produtos,
            purchase.valor_desconto,
            purchase.valor_frete,
            purchase.valor_seguro,
            purchase.valor_outras_despesas,
            purchase.valor_ipi
        ];

        const hasComposition = compositionFields.every((value) => value != null && Number.isFinite(Number(value)));
        const compositionCents = hasComposition
            ? cents(purchase.valor_produtos)
                - cents(purchase.valor_desconto)
                + cents(purchase.valor_frete)
                + cents(purchase.valor_seguro)
                + cents(purchase.valor_outras_despesas)
                + cents(purchase.valor_ipi)
            : null;
        const componentDifference = compositionCents == null
            ? ''
            : `<div class="compras-report-reconciliation">
                Composição persistida − total oficial: ${escapeHtml(formatMoney((compositionCents - officialTotalCents) / 100))}.
              </div>`;

        return `<section class="compras-report-financial" aria-label="Conferência financeira da compra">
            <div><span>Subtotal dos itens registrados</span><strong>${escapeHtml(itemSubtotalCents == null ? 'Não informado' : formatMoney(itemSubtotalCents / 100))}</strong></div>
            <div><span>Frete</span><strong>${escapeHtml(formatOptionalMoney(purchase.valor_frete))}</strong></div>
            <div><span>Descontos</span><strong>${escapeHtml(formatOptionalMoney(purchase.valor_desconto))}</strong></div>
            <div><span>Seguro</span><strong>${escapeHtml(formatOptionalMoney(purchase.valor_seguro))}</strong></div>
            <div><span>Outras despesas</span><strong>${escapeHtml(formatOptionalMoney(purchase.valor_outras_despesas))}</strong></div>
            <div><span>IPI</span><strong>${escapeHtml(formatOptionalMoney(purchase.valor_ipi))}</strong></div>
            <div class="official-total"><span>Total oficial da compra</span><strong>${escapeHtml(formatMoney(purchase.total_oficial))}</strong></div>
            <div class="compras-report-reconciliation">
                Itens registrados − total oficial (informativo; pode haver componentes adicionais):
                ${escapeHtml(reconciliationCents == null ? 'Não informado' : formatMoney(reconciliationCents / 100))}.
            </div>
            ${componentDifference}
        </section>`;
    }

    function renderPurchase(purchase) {
        const items = Array.isArray(purchase.itens) ? purchase.itens : [];
        const invoice = purchase.numero_nf
            ? `${valueOrMissing(purchase.numero_nf)}${purchase.serie_nf ? ` / Série ${purchase.serie_nf}` : ''}`
            : 'Sem nota identificada';
        const details = [
            `Data: ${formatDate(purchase.data_compra)}`,
            `Fornecedor: ${valueOrMissing(purchase.fornecedor)}`,
            `Nota: ${invoice}`,
            `Status: ${valueOrMissing(purchase.status)}`,
            `Condição: ${valueOrMissing(purchase.condicao_pagamento)}`,
            `Forma: ${valueOrMissing(purchase.forma_pagamento)}`
        ];
        return `<article class="compras-report-purchase">
            <header class="compras-report-purchase-header">
                <div>
                    <h2>Compra #${escapeHtml(purchase.id)}</h2>
                    <div class="compras-report-purchase-meta">
                        ${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join('')}
                    </div>
                </div>
                <div class="compras-report-purchase-total">
                    <span>Total oficial</span>
                    <strong>${escapeHtml(formatMoney(purchase.total_oficial))}</strong>
                </div>
            </header>
            <div class="compras-report-table-wrap">
                <table class="table table-sm table-striped compras-report-items-table">
                    <thead><tr>
                        <th>Nº</th><th>Código</th><th>Produto</th><th>Unidade</th>
                        <th class="number">Quantidade</th><th class="number">Valor unitário</th>
                        <th class="number">Subtotal registrado</th>
                    </tr></thead>
                    <tbody>${renderItemRows(items)}</tbody>
                </table>
            </div>
            ${renderFinancial(purchase)}
        </article>`;
    }

    function filterSummary(filters) {
        const applied = [];
        if (filters.data_inicio) applied.push(`Data inicial: ${formatDate(filters.data_inicio)}`);
        if (filters.data_fim) applied.push(`Data final: ${formatDate(filters.data_fim)}`);
        if (filters.fornecedor) applied.push(`Fornecedor: ${filters.fornecedor}`);
        if (filters.numero_nf) applied.push(`Número da nota: ${filters.numero_nf}`);
        if (filters.compra_id) applied.push(`ID da compra: ${filters.compra_id}`);
        return applied.length ? applied.join(' · ') : 'Todos os períodos e compras';
    }

    function renderReport(purchases, filters, emittedAt) {
        const summary = summarizePurchases(purchases);
        const lines = purchases.length
            ? purchases.map(renderPurchase).join('')
            : '<div class="alert alert-info">Nenhuma compra encontrada para os filtros informados.</div>';
        const timestamp = emittedAt instanceof Date ? emittedAt : new Date(emittedAt || Date.now());
        const formattedTimestamp = Number.isFinite(timestamp.getTime())
            ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(timestamp)
            : 'Não informado';

        return {
            summary,
            html: `<div class="compras-report-print-meta">
                <strong>Filtros consultados:</strong> ${escapeHtml(filterSummary(filters))}
            </div>
            ${lines}
            <section class="compras-report-period-summary">
                <h2>Resumo do período</h2>
                <p>Compras: <strong>${summary.purchaseCount}</strong></p>
                <p>Linhas de itens: <strong>${summary.itemLineCount}</strong></p>
                <p>Notas identificadas: <strong>${summary.invoiceCount}</strong></p>
                <p>Valor oficial total: <strong>${escapeHtml(formatMoney(summary.officialTotalCents / 100))}</strong></p>
            </section>
            <footer class="compras-report-footer">CDS Sistemas · Relatório emitido em ${escapeHtml(formattedTimestamp)}</footer>`
        };
    }

    function readFilters() {
        return {
            data_inicio: document.getElementById('compras-report-date-start').value.trim(),
            data_fim: document.getElementById('compras-report-date-end').value.trim(),
            fornecedor: document.getElementById('compras-report-supplier').value.trim(),
            numero_nf: document.getElementById('compras-report-invoice').value.trim(),
            compra_id: document.getElementById('compras-report-purchase-id').value.trim()
        };
    }

    function setHidden(element, hidden) {
        element.classList.toggle('d-none', hidden);
    }

    function obterCssRelatorio() {
        const stylesheet = Array.from(document.styleSheets).find((sheet) =>
            String(sheet.href || '').includes('/css/compras-relatorio.css')
        );
        if (!stylesheet) throw new Error('O estilo do Relatório de Compras não foi carregado.');
        return Array.from(stylesheet.cssRules)
            .filter((rule) => rule.conditionText !== 'print' && !/^@page\b/i.test(rule.cssText))
            .map((rule) => rule.cssText)
            .join('\n');
    }

    function updateMetrics(summary) {
        document.getElementById('compras-report-count').textContent = String(summary.purchaseCount);
        document.getElementById('compras-report-total').textContent = formatMoney(summary.officialTotalCents / 100);
        document.getElementById('compras-report-items').textContent = String(summary.itemLineCount);
        document.getElementById('compras-report-invoices').textContent = String(summary.invoiceCount);
    }

    async function consultarComprasRelatorio(filters) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(filters)) {
            if (value) params.set(key, value);
        }
        const base = String(root.API_URL || '').replace(/\/$/, '');
        const token = root.localStorage && root.localStorage.getItem('token');
        const response = await root.fetch(`${base}/compras/relatorio/detalhado?${params.toString()}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Falha ao consultar compras (HTTP ${response.status}).`);
        if (!body || !Array.isArray(body.compras)) throw new Error('A resposta do relatório está incompleta.');
        return body.compras;
    }

    async function imprimirRelatorio(salvarPdf) {
        const preview = document.getElementById('compras-report-preview');
        const previewContent = document.getElementById('compras-report-preview-content');
        if (!preview || preview.hidden || !previewContent) return;

        const status = document.getElementById('compras-report-status');
        const previewStatus = document.getElementById('compras-report-preview-status');
        const htmlConteudo = previewContent.innerHTML || document.getElementById('compras-report-results').innerHTML || '';
        const errorBox = document.getElementById('compras-report-preview-error');
        const setPrintStatus = (message) => {
            status.textContent = message;
            previewStatus.textContent = message;
        };
        if (!htmlConteudo.trim()
            || !/(compras-report-purchase|Nenhuma compra encontrada)/i.test(htmlConteudo)) {
            setPrintStatus('');
            errorBox.textContent = 'O relatório está vazio ou incompleto. Consulte as compras novamente antes de imprimir.';
            setHidden(errorBox, false);
            return;
        }
        const expectedPurchases = (htmlConteudo.match(/<article class="compras-report-purchase">/g) || []).length;
        const expectedItemRows = (htmlConteudo.match(/<tbody\b[^>]*>[\s\S]*?<\/tbody>/g) || [])
            .reduce((count, tbody) => count + (tbody.match(/<tr\b/g) || []).length, 0);

        setHidden(errorBox, true);
        setPrintStatus(salvarPdf ? 'Gerando PDF do relatório…' : 'Abrindo impressão do relatório…');

        let reportStyles;
        try {
            reportStyles = obterCssRelatorio();
        } catch (error) {
            setPrintStatus('');
            errorBox.textContent = error.message || 'Os estilos do relatório não estão disponíveis para impressão.';
            setHidden(errorBox, false);
            return;
        }

        const template = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Relatório de Compras</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    ${reportStyles}
    html, body {
      background: #fff;
      color: #111;
      font-family: Arial, Helvetica, sans-serif;
      margin: 0;
      padding: 0;
      visibility: visible !important;
    }
    body, body * {
      visibility: visible !important;
    }
    .compras-report-print-document,
    .compras-report-print-document * {
      visibility: visible !important;
    }
    .compras-report-preview-toolbar,
    .compras-report-actions,
    .compras-report-filters,
    .compras-report-status,
    .compras-report-error,
    .compras-report-filter-error,
    .compras-report-preview[hidden],
    .compras-report-preview,
    .compras-report-preview-paper > .compras-report-actions,
    .compras-report-preview-paper > .compras-report-status,
    .compras-report-preview-paper > .compras-report-error { display: none !important; }
    .compras-report-print-document {
      display: block;
      width: 100%;
    }
    .compras-report-print-meta,
    .compras-report-period-summary,
    .compras-report-footer,
    .compras-report-financial,
    .compras-report-purchase-header,
    .compras-report-purchase-total,
    .compras-report-metric,
    .compras-report-header,
    .compras-report-summary { page-break-inside: avoid; break-inside: avoid; }
    .compras-report-financial {
      display: grid;
      gap: 0;
      grid-template-columns: minmax(0, 1fr);
    }
    .compras-report-financial > div:not(.official-total) {
      display: none !important;
    }
    .compras-report-financial .official-total {
      display: flex !important;
      justify-content: space-between;
      font-weight: 700;
      margin-top: 0.5rem;
    }
    .compras-report-table-wrap {
      overflow: visible !important;
    }
    .compras-report-items-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 0;
      table-layout: auto;
      break-inside: auto;
      page-break-inside: auto;
    }
    .compras-report-purchase {
      overflow: visible !important;
      break-inside: auto;
      page-break-inside: auto;
    }
    .compras-report-items-table th,
    .compras-report-items-table td {
      border-bottom: 1px solid #d9e0e8;
      padding: 0.25rem;
    }
    .compras-report-items-table thead {
      display: table-header-group;
    }
    .compras-report-items-table tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
  </style>
</head>
<body>
  <div class="compras-report-print-document" data-expected-purchases="${expectedPurchases}" data-expected-item-rows="${expectedItemRows}">
    ${htmlConteudo}
  </div>
</body>
</html>`;

if (root.electronAPI && typeof root.electronAPI.imprimirRelatorioHtml === 'function') {
    try {
        const resultado = await root.electronAPI.imprimirRelatorioHtml({
            html: template,
                    titulo: 'Relatório de Compras'
                });
                if (resultado && resultado.cancelado) {
                    setPrintStatus('Impressão cancelada. O relatório continua disponível.');
                    return;
                }
                if (!resultado || !resultado.ok) {
                    throw new Error(resultado && resultado.erro
                        ? resultado.erro
                        : 'O Electron não confirmou a impressão do relatório.');
                }
                setPrintStatus(salvarPdf ? 'Geração do PDF concluída.' : 'Impressão concluída.');
            } catch (error) {
                setPrintStatus('');
                errorBox.textContent = error.message || 'Não foi possível imprimir o relatório.';
                setHidden(errorBox, false);
            }
            return;
        }

        const printWindow = typeof root.open === 'function'
            ? root.open('', '_blank', 'width=1200,height=900')
            : null;
        if (!printWindow) {
            setPrintStatus('');
            errorBox.textContent = 'Não foi possível abrir uma janela exclusiva para impressão. O relatório continua disponível.';
            setHidden(errorBox, false);
            return;
        }

        const fecharJanelaImpressao = () => {
            if (!printWindow.closed) printWindow.close();
            root.focus();
        };
        try {
            printWindow.opener = null;
            printWindow.document.open();
            printWindow.document.write(template);
            printWindow.document.close();
            if (printWindow.document.fonts && printWindow.document.fonts.ready) {
                await printWindow.document.fonts.ready;
            }
            await new Promise((resolve) => printWindow.requestAnimationFrame(
                () => printWindow.requestAnimationFrame(resolve)
            ));
            const printDocument = printWindow.document.querySelector('.compras-report-print-document');
            if (!printDocument || !printDocument.innerText.trim()) {
                throw new Error('O documento de impressão não foi carregado corretamente.');
            }
            printWindow.addEventListener('afterprint', fecharJanelaImpressao, { once: true });
            printWindow.focus();
            printWindow.print();
        } catch (error) {
            fecharJanelaImpressao();
            setPrintStatus('');
            errorBox.textContent = error.message || 'Não foi possível imprimir o relatório.';
            setHidden(errorBox, false);
        }
    }

    function inicializarRelatorioCompras() {
        const form = document.getElementById('compras-report-form');
        if (!form) return;
        const status = document.getElementById('compras-report-status');
        const errorBox = document.getElementById('compras-report-error');
        const filterError = document.getElementById('compras-report-filter-error');
        const results = document.getElementById('compras-report-results');
        const submit = document.getElementById('compras-report-submit');
        const preview = document.getElementById('compras-report-preview');
        const previewContent = document.getElementById('compras-report-preview-content');
        const previewOpen = document.getElementById('compras-report-preview-open');

        const fecharPrevia = () => {
            preview.hidden = true;
            preview.setAttribute('aria-hidden', 'true');
            previewOpen.focus();
        };

        const consultar = async () => {
            const filters = readFilters();
            setHidden(filterError, true);
            setHidden(errorBox, true);
            const start = filters.data_inicio;
            const end = filters.data_fim;
            if ((start && !/^\d{4}-\d{2}-\d{2}$/.test(start))
                || (end && !/^\d{4}-\d{2}-\d{2}$/.test(end))
                || (start && end && start > end)) {
                filterError.textContent = 'Informe datas válidas e um intervalo em que a data inicial não seja posterior à final.';
                setHidden(filterError, false);
                return;
            }
            if (filters.compra_id && !/^[1-9]\d*$/.test(filters.compra_id)) {
                filterError.textContent = 'O ID da compra deve ser um número inteiro positivo.';
                setHidden(filterError, false);
                return;
            }

            submit.disabled = true;
            previewOpen.disabled = true;
            status.textContent = 'Consultando compras…';
            results.innerHTML = '';
            try {
                const purchases = await consultarComprasRelatorio(filters);
                const rendered = renderReport(purchases, filters, new Date());
                updateMetrics(rendered.summary);
                results.innerHTML = rendered.html;
                previewContent.innerHTML = rendered.html;
                document.getElementById('compras-report-generated').textContent =
                    `Consulta concluída em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}.`;
                status.textContent = `${rendered.summary.purchaseCount} compra(s) consultada(s).`;
                previewOpen.disabled = false;
            } catch (error) {
                status.textContent = '';
                errorBox.textContent = error.message || 'Não foi possível consultar as compras.';
                setHidden(errorBox, false);
            } finally {
                submit.disabled = false;
            }
        };

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            consultar();
        });
        document.getElementById('compras-report-clear').addEventListener('click', () => {
            form.reset();
            consultar();
        });
        previewOpen.addEventListener('click', () => {
            previewContent.innerHTML = results.innerHTML;
            preview.hidden = false;
            preview.setAttribute('aria-hidden', 'false');
            document.getElementById('compras-report-preview-close').focus();
        });
        document.getElementById('compras-report-preview-close').addEventListener('click', fecharPrevia);
        document.getElementById('compras-report-preview-print').addEventListener('click', () => imprimirRelatorio(false));
        document.getElementById('compras-report-preview-pdf').addEventListener('click', () => imprimirRelatorio(true));
        preview.addEventListener('click', (event) => {
            if (event.target === preview) fecharPrevia();
        });
        preview.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') fecharPrevia();
        });
        document.getElementById('compras-report-generated').textContent = '';
        consultar();
    }

    function loadRelatorioCompras() {
        if (typeof root.carregarPaginaHtml !== 'function') {
            const target = document.getElementById('page-content');
            if (target) target.innerHTML = '<div class="alert alert-danger">Não foi possível abrir o relatório.</div>';
            return;
        }
        root.carregarPaginaHtml(REPORT_PATH, inicializarRelatorioCompras);
    }

    const api = {
        escapeHtml,
        formatDate,
        formatMoney,
        formatOptionalMoney,
        formatQuantity,
        summarizePurchases,
        renderReport,
        filterSummary
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.loadRelatorioCompras = loadRelatorioCompras;
})(typeof window !== 'undefined' ? window : globalThis);
