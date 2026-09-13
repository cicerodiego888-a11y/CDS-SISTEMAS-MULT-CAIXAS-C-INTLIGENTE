let auditPage = 1;
let auditPageSize = 25;

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function carregarAuditoria(page = 1) {
    const tbody = document.getElementById('auditTabelaCorpo');
    if (!tbody) {
        return;
    }

    auditPage = page;
    const apiUrl = (typeof API_URL === 'string' && API_URL.trim() !== '') ? API_URL : `${window.location.origin}/api`;

    const modulo = document.getElementById('auditFiltroModulo')?.value || '';
    const acao = document.getElementById('auditFiltroAcao')?.value || '';
    const usuario = document.getElementById('auditFiltroUsuario')?.value || '';
    const inicio = document.getElementById('auditDataInicio')?.value || '';
    const fim = document.getElementById('auditDataFim')?.value || '';

    const params = new URLSearchParams({ page: String(page), pageSize: String(auditPageSize) });
    if (modulo) params.set('modulo', modulo);
    if (acao) params.set('acao', acao);
    if (usuario) params.set('usuario_nome', usuario);
    if (inicio) params.set('inicio', inicio);
    if (fim) params.set('fim', fim);

    try {
        const resp = await fetch(`${apiUrl}/auditoria/list?${params.toString()}`, {
            headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
        });

        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.error || 'Erro ao buscar auditoria');
        }

        tbody.innerHTML = '';

        (data.rows || []).forEach(row => {
            const detalhes = (() => {
                try { return typeof row.detalhes === 'string' ? row.detalhes : JSON.stringify(row.detalhes || {}); } catch (e) { return String(row.detalhes || ''); }
            })();

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${(row.criado_em || '').replace('T', ' ').slice(0, 19)}</td>
                <td>${escapeHtml(row.usuario_nome)}</td>
                <td>${escapeHtml(row.modulo)}</td>
                <td>${escapeHtml(row.acao)}</td>
                <td>${escapeHtml((row.referencia_tipo || '') + (row.referencia_id ? ' #' + row.referencia_id : ''))}</td>
                <td><small>${escapeHtml(detalhes)}</small></td>
            `;
            tbody.appendChild(tr);
        });

        const resumo = document.getElementById('auditResumo');
        if (resumo) {
            resumo.textContent = `Página ${data.page} — itens nesta página: ${data.rows.length} — total: ${data.total}`;
        }

        const prev = document.getElementById('auditPrev');
        const next = document.getElementById('auditNext');
        if (prev) prev.disabled = data.page <= 1;
        if (next) next.disabled = (data.page * data.pageSize) >= data.total;

    } catch (err) {
        console.error('Erro auditoria:', err);
        if (typeof showNotification === 'function') {
            showNotification(err.message || 'Erro ao carregar auditoria', 'danger');
        }
    }
}

function exportarAuditoriaCsv() {
    const rows = [];
    document.querySelectorAll('#auditTabelaCorpo tr').forEach((tr) => {
        const cols = Array.from(tr.querySelectorAll('td')).map((td) => `"${String(td.textContent || '').replace(/"/g, '""')}"`);
        if (cols.length) rows.push(cols.join(';'));
    });
    if (!rows.length) {
        if (typeof showNotification === 'function') showNotification('Nada para exportar.', 'warning');
        return;
    }
    const header = '"Data";"Usuário";"Módulo";"Ação";"Referência";"Detalhes"';
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
}

function inicializarPaginaAuditoria() {
    if (!document.getElementById('auditTabelaCorpo')) {
        return;
    }

    const btnBuscar = document.getElementById('auditBuscar');
    const btnPrev = document.getElementById('auditPrev');
    const btnNext = document.getElementById('auditNext');
    const btnExport = document.getElementById('auditExportar');

    if (btnBuscar) btnBuscar.onclick = () => carregarAuditoria(1);
    if (btnPrev) btnPrev.onclick = () => carregarAuditoria(Math.max(1, auditPage - 1));
    if (btnNext) btnNext.onclick = () => carregarAuditoria(auditPage + 1);
    if (btnExport) btnExport.onclick = exportarAuditoriaCsv;

    // Deep-link ?modulo=vendas_entrega
    try {
        const params = new URLSearchParams(window.location.search);
        const modulo = params.get('modulo');
        if (modulo && document.getElementById('auditFiltroModulo')) {
            document.getElementById('auditFiltroModulo').value = modulo;
        }
    } catch (_) { /* ignore */ }

    carregarAuditoria(1);
}

window.carregarAuditoria = carregarAuditoria;
window.inicializarPaginaAuditoria = inicializarPaginaAuditoria;
window.exportarAuditoriaCsv = exportarAuditoriaCsv;
