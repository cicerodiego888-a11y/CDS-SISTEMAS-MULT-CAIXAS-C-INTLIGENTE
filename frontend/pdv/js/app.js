/**
 * Roteador do módulo CDS PDV (Frente de Caixa).
 */
window.CDS_MODULE = 'pdv';
window.CDS_DEFAULT_PAGE = 'pdv';

function loadPage(page) {
    currentPage = page;

    if (!paginaPermitidaPorImplantacao(page)) {
        const msg = typeof mensagemModuloNaoContratado === 'function'
            ? mensagemModuloNaoContratado(page)
            : 'Módulo não contratado.';
        showNotification(msg, 'warning');
        if (page !== 'pdv') loadPage('pdv');
        return;
    }

    if (!usuarioTemPermissao(page)) {
        showNotification('Você não tem permissão para acessar esta página.', 'warning');
        if (page !== 'pdv') loadPage('pdv');
        return;
    }

    if (typeof ativarPdvFullscreen === 'function' && typeof desativarPdvFullscreen === 'function') {
        if (page === 'pdv') {
            ativarPdvFullscreen();
        } else {
            desativarPdvFullscreen();
            document.body.classList.remove('menu-open', 'pdv-mode');
        }
    }

    switch (page) {
        case 'pdv':
            return carregarPaginaHtml('pdv.html', function () {
                if (typeof loadPDV === 'function') loadPDV();
            });
        case 'consulta':
            return carregarPaginaHtml('pdv.html', function () {
                if (typeof loadPDV === 'function') {
                    loadPDV();
                    setTimeout(() => {
                        if (typeof abrirConsultaProdutosPDV === 'function') {
                            abrirConsultaProdutosPDV();
                        }
                    }, 300);
                }
            });
        case 'clientes':
            return typeof loadClientes === 'function'
                ? loadClientes()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar clientes.</div>');
        case 'caixa':
            return typeof loadCaixa === 'function'
                ? loadCaixa()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar caixa.</div>');
        case 'reimpressao':
        case 'vendas':
            return typeof loadVendas === 'function'
                ? loadVendas()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar reimpressão.</div>');
        case 'entregas':
            return typeof loadEntregas === 'function'
                ? loadEntregas()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar entregas.</div>');
        case 'configuracao-rede':
            if (typeof abrirModalConfiguracaoRede === 'function') {
                abrirModalConfiguracaoRede({ somenteSuperAdmin: true });
            }
            currentPage = 'pdv';
            $('.nav-link').removeClass('active');
            $('.nav-link[data-page="pdv"]').first().addClass('active');
            return;
        case 'nome-terminal-pdv':
            if (typeof abrirModalNomeTerminalPdv === 'function') {
                abrirModalNomeTerminalPdv({ somenteSuperAdmin: true });
            }
            currentPage = 'pdv';
            $('.nav-link').removeClass('active');
            $('.nav-link[data-page="pdv"]').first().addClass('active');
            return;
        case 'configuracao-impressora-pdv':
            if (typeof abrirModalConfiguracaoImpressoraPdv === 'function') {
                abrirModalConfiguracaoImpressoraPdv();
            } else {
                showNotification('A configuração de impressora do PDV não está disponível neste momento.', 'warning');
            }
            currentPage = 'pdv';
            $('.nav-link').removeClass('active');
            $('.nav-link[data-page="pdv"]').first().addClass('active');
            return;
        case 'tef':
            // Atalho legado removido do menu — redireciona para reimpressão
            return loadPage('reimpressao');
        default:
            $('#page-content').html('<div class="alert alert-warning">Página não encontrada.</div>');
    }
}

async function salvarImpressoraDoCaixaPdv(caixaId, impressora) {
    const token = localStorage.getItem('token') || '';
    const response = await fetch(`${API_URL}/caixas/${caixaId}/impressora-cupom`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ impressora_cupom: impressora || null })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.mensagem || data?.error || 'Não foi possível salvar a impressora do caixa.');
    }
    return data;
}

async function abrirModalConfiguracaoImpressoraPdv() {
    try {
        const caixaApi = window.ObterCaixaAtual || window;
        const resultadoCaixa = caixaApi && typeof caixaApi.obterCaixaAtual === 'function'
            ? await caixaApi.obterCaixaAtual()
            : null;
        const caixaId = resultadoCaixa && resultadoCaixa.ok ? resultadoCaixa.caixaId : null;

        if (!caixaId) {
            showNotification('Nenhum caixa ativo foi identificado para este terminal.', 'warning');
            return;
        }

        const impressoras = (window.electronAPI && typeof window.electronAPI.listarImpressoras === 'function')
            ? await window.electronAPI.listarImpressoras().catch(() => [])
            : [];
        const token = localStorage.getItem('token') || '';
        const respostaConfiguracao = await fetch(`${API_URL}/caixas/${caixaId}/impressora-cupom`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const dadosConfiguracao = await respostaConfiguracao.json().catch(() => ({}));
        if (!respostaConfiguracao.ok) {
            throw new Error(dadosConfiguracao?.error || 'Não foi possível carregar a impressora deste caixa.');
        }
        const impressoraAtual = dadosConfiguracao.impressora_cupom || '';

        const listaImpressoras = impressoras.length
            ? impressoras
                .map((impressora) => {
                    const nomeStr = String(impressora && impressora.name || '');
                    const nomeEscapado = nomeStr
                        .replace(/&/g, '&amp;')
                        .replace(/"/g, '&quot;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
                    const selected = nomeStr === String(impressoraAtual || '') ? 'selected' : '';
                    return `<option value="${nomeEscapado}" ${selected}>${nomeEscapado}</option>`;
                })
                .join('')
            : '<option value="">Nenhuma impressora detectada</option>';

        const modalId = 'modalImpressoraCupomPdv';
        $('#modal-container').html(`
            <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header bg-dark text-white">
                            <h5 class="modal-title"><i class="fas fa-print me-2"></i>Impressora de cupom do caixa</h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Fechar"></button>
                        </div>
                        <div class="modal-body">
                            <p class="mb-2">Caixa atual: <strong>#${caixaId}</strong></p>
                            <label for="selectImpressoraCupomPdv" class="form-label">Impressora disponível</label>
                            <select id="selectImpressoraCupomPdv" class="form-select mb-3">
                                <option value="">Não usar impressora específica</option>
                                ${listaImpressoras}
                            </select>
                            <label for="inputImpressoraCupomPdv" class="form-label">Ou informe manualmente</label>
                            <input
                                id="inputImpressoraCupomPdv"
                                type="text"
                                class="form-control"
                                value="${String(impressoraAtual || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"
                                placeholder="Ex: Epson TM-T20"
                            >
                            <small class="text-muted d-block mt-2">
                                A configuração é aplicada ao caixa ativo do terminal atual.
                            </small>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                            <button type="button" id="btnSalvarImpressoraCupomPdv" class="btn btn-primary">Salvar</button>
                        </div>
                    </div>
                </div>
            </div>
        `);

        const modalEl = document.getElementById(modalId);
        const modal = new bootstrap.Modal(modalEl);
        document.getElementById('selectImpressoraCupomPdv')?.addEventListener('change', function () {
            const input = document.getElementById('inputImpressoraCupomPdv');
            if (input) input.value = '';
        });

        document.getElementById('btnSalvarImpressoraCupomPdv')?.addEventListener('click', async function () {
            const select = document.getElementById('selectImpressoraCupomPdv');
            const input = document.getElementById('inputImpressoraCupomPdv');
            const valor = (input && input.value.trim()) || (select ? select.value : '');
            const impressora = valor || null;

            try {
                await salvarImpressoraDoCaixaPdv(caixaId, impressora);
                showNotification('Impressora do cupom salva com sucesso.', 'success');
                modal.hide();
            } catch (error) {
                console.error('[PDV IMPRESSORA]', error);
                showNotification(error.message || 'Erro ao salvar impressora do cupom.', 'danger');
            }
        }, { once: true });

        modal.show();
    } catch (error) {
        console.error('[PDV IMPRESSORA]', error);
        showNotification(error.message || 'Erro ao abrir a configuração da impressora.', 'danger');
    }
}

$(document).ready(function () {
    inicializarShellModulo({ defaultPage: 'pdv' });
});
