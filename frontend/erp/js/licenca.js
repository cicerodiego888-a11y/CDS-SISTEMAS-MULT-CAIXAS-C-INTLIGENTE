function loadLicenca() {
    if (typeof carregarPaginaHtml !== 'function') {
        $('#page-content').html('<div class="alert alert-danger">Erro ao carregar a página de assinatura.</div>');
        return;
    }
    return carregarPaginaHtml('licenca.html', function () {
        loadLicencaData();
    });
}

function loadLicencaData() {
    $.ajax({
        url: `${API_URL}/licenca`,
        method: 'GET',
        success: function(data) {
            $('#licencaCodigoInstalacao').val(data.codigo_instalacao || '');
            $('#licencaStatus').val(formatLicenseStatus(data.status));
            $('#licencaDataAtivacao').val(formatLicenseDate(data.data_ativacao));
            $('#licencaDataVencimento').val(formatLicenseDate(data.data_expiracao));
            $('#licencaDiasRestantes').val(data.dias_restantes != null ? data.dias_restantes : 0);
            $('#licencaUltimaVerificacao').val(formatLicenseDateTime(data.ultima_verificacao));
            $('#licencaUltimaExecucao').val(formatLicenseDateTime(data.ultima_execucao));
            $('#modalCodigoInstalacao').val(data.codigo_instalacao || '');
            renderLicenseAlert(data);
        },
        error: function(xhr) {
            const message = xhr.responseJSON?.error || 'Erro ao carregar informações da assinatura.';
            $('#licenca-alert-container').html(`<div class="alert alert-danger">${message}</div>`);
            $('#licencaCodigoInstalacao').val('');
            $('#licencaStatus').val('');
        }
    });
}

function renderLicenseAlert(data) {
    const status = String(data.status || '').toLowerCase();
    let message = 'Assinatura carregada com sucesso.';
    let type = 'info';

    if (status === 'pendente') {
        message = 'Sistema não ativado. Insira o código de ativação para liberar a assinatura.';
        type = 'warning';
    } else if (status === 'vencida') {
        const tolerancia = Number(data.dias_tolerancia_restantes || 0);
        if (data.em_tolerancia_pdv && tolerancia > 0) {
            message = `Assinatura expirada. O PDV permanece liberado por mais ${tolerancia} dia(s). Atualize o código para renovar.`;
        } else {
            message = 'Assinatura expirada. Atualize o código para renovar o acesso.';
        }
        type = 'danger';
    } else if (status === 'data_alterada') {
        message = 'Data do sistema alterada. Contate o suporte.';
        type = 'danger';
    } else if (status === 'aviso' || status === 'atencao') {
        message = `Assinatura próxima do vencimento. Restam ${data.dias_restantes || 0} dias.`;
        type = 'warning';
    }

    $('#licenca-alert-container').html(`
        <div class="alert alert-${type} alert-dismissible fade show" role="alert">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Fechar"></button>
        </div>
    `);
}

function abrirModalAtivarLicenca() {
    $('#modalCodigoLicenca').val('');
    $('#modalLicencaAlert').html('');
    const codigoInstalacao = $('#licencaCodigoInstalacao').val() || '';
    $('#modalCodigoInstalacao').val(codigoInstalacao);
    const modal = new bootstrap.Modal(document.getElementById('modalAtivarLicenca'));
    modal.show();
}

function validarLicenca() {
    const codigoLicenca = String($('#modalCodigoLicenca').val() || '').trim();
    if (!codigoLicenca) {
        $('#modalLicencaAlert').html('<div class="alert alert-warning">Informe o código de ativação.</div>');
        return;
    }

    $('#modalLicencaAlert').html('<div class="alert alert-info">Validando assinatura...</div>');

    $.ajax({
        url: `${API_URL}/licenca/ativar`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ codigoLicenca }),
        success: function(response) {
            $('#modalLicencaAlert').html('<div class="alert alert-success">Assinatura ativada com sucesso.</div>');
            showNotification('Assinatura ativada com sucesso.', 'success');
            const modalEl = document.getElementById('modalAtivarLicenca');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) {
                modal.hide();
            }
            loadLicencaData();
        },
        error: function(xhr) {
            const message = xhr.responseJSON?.error || 'Erro ao ativar a assinatura.';
            $('#modalLicencaAlert').html(`<div class="alert alert-danger">${message}</div>`);
            showNotification(message, 'danger');
        }
    });
}

function copiarCodigoInstalacao() {
    const codigo = $('#licencaCodigoInstalacao').val() || '';
    if (!codigo) {
        showNotification('Nenhum código de instalação disponível.', 'warning');
        return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(codigo).then(() => {
            showNotification('Código de instalação copiado.', 'success');
        }).catch(() => {
            fallbackCopyText(codigo);
        });
        return;
    }

    fallbackCopyText(codigo);
}

function fallbackCopyText(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showNotification('Código de instalação copiado.', 'success');
    } catch (err) {
        showNotification('Não foi possível copiar o código.', 'danger');
    }
    document.body.removeChild(textarea);
}

function formatLicenseStatus(status) {
    const map = {
        pendente: 'Pendente',
        ativa: 'Ativa',
        aviso: 'Atenção',
        atencao: 'Atenção',
        vencida: 'Vencida',
        data_alterada: 'Data alterada'
    };
    return map[String(status || '').toLowerCase()] || String(status || '').toUpperCase();
}

function formatLicenseDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('pt-BR');
}

function formatLicenseDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('pt-BR');
}
