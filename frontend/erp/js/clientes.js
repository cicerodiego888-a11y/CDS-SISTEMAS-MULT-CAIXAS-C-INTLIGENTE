function normalizarTexto(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .normalize('NFC')
        .toLowerCase();
}

// Load clientes page — protegido por navigation token (Sprint 6)
function loadClientes() {
    const pageToken = (typeof UINavigation !== 'undefined' && UINavigation.getToken)
        ? UINavigation.getToken()
        : null;
    const ctx = (typeof UIRequestContext !== 'undefined' && UIRequestContext.begin)
        ? UIRequestContext.begin({ page: 'clientes', component: 'lista', page_token: pageToken })
        : { request_id: null, page_token: pageToken };

    $.ajax({
        url: `${API_URL}/clientes`,
        method: 'GET',
        success: function(clientes) {
            if (typeof UIRequestContext !== 'undefined' && ctx.request_id) {
                if (!UIRequestContext.isFresh(ctx.request_id)) {
                    if (typeof CDS_UI_DEBUG !== 'undefined' && CDS_UI_DEBUG) {
                        console.debug('[UI-STALE]', { page: 'clientes', request: ctx.request_id });
                    }
                    return;
                }
                UIRequestContext.markCompleted(ctx.request_id);
            } else if (typeof UINavigation !== 'undefined' && pageToken
                && !UINavigation.isActiveToken(pageToken)) {
                return;
            }
            if (typeof currentPage !== 'undefined' && currentPage !== 'clientes') return;
            renderClientes(clientes);
        },
        error: function() {
            if (typeof UIRequestContext !== 'undefined' && ctx.request_id
                && !UIRequestContext.isFresh(ctx.request_id)) {
                return;
            }
            if (typeof UINavigation !== 'undefined' && pageToken
                && !UINavigation.isActiveToken(pageToken)) {
                return;
            }
            if (typeof currentPage !== 'undefined' && currentPage !== 'clientes') return;
            $('#page-content').html('<div class="alert alert-danger">Erro ao carregar clientes!</div>');
        }
    });
}

// Render clientes
function renderClientes(clientes) {
    const Perf = window.PerformanceMonitor;
    const totalOp = Perf?.start?.('clientes:render-total', { records: clientes.length });
    const Focus = window.UIFocusManager;
    const buscaExistente = document.getElementById('buscaCliente');
    const tbodyExistente = document.getElementById('clientes-tbody');
    window.__cdsClientesCache = clientes;

    const montarLinhas = (lista) => lista.map(c => `
        <tr>
            <td>${c.nome}</td>
            <td>${formatarCpfCnpj(c.cpf_cnpj) || '-'}</td>
            <td>${c.telefone || '-'}</td>
            <td>${c.email || '-'}</td>
            <td>${formatCurrency(c.limite_credito)}</td>
            <td class="${c.credito_atual > 0 ? 'text-danger' : 'text-success'}">
                ${formatCurrency(c.credito_atual)}
            </td>
            <td>
                <button class="btn btn-sm btn-info" onclick="viewCliente(${c.id})" title="Detalhes">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn btn-sm btn-secondary" onclick="historicoComprasCliente(${c.id})" title="Histórico de compras">
                    <i class="fas fa-receipt"></i>
                </button>
                <button class="btn btn-sm btn-warning" onclick="editCliente(${c.id})" title="Editar">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-danger" onclick="deleteCliente(${c.id})">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="7" class="text-center">Nenhum cliente cadastrado</td></tr>';

    const bindBusca = () => {
        $('#buscaCliente').off('input.clientesFocus').on('input.clientesFocus', function() {
            const termo = normalizarTexto($(this).val());
            const filtrados = (window.__cdsClientesCache || []).filter(c =>
                (c.nome && normalizarTexto(c.nome).includes(termo)) ||
                (c.cpf_cnpj && String(c.cpf_cnpj).toLowerCase().includes(termo))
            );
            $('#clientes-tbody').html(montarLinhas(filtrados));
        });
    };

    // Soft path: shell já montado — atualiza só o tbody e preserva #buscaCliente
    if (buscaExistente && tbodyExistente) {
        const termoAtual = String(buscaExistente.value || '');
        const filtrados = termoAtual
            ? clientes.filter(c =>
                (c.nome && normalizarTexto(c.nome).includes(normalizarTexto(termoAtual))) ||
                (c.cpf_cnpj && String(c.cpf_cnpj).toLowerCase().includes(normalizarTexto(termoAtual)))
              )
            : clientes;
        tbodyExistente.innerHTML = montarLinhas(filtrados);
        bindBusca();
        if (totalOp) Perf.end(totalOp, { soft: true });
        return;
    }

    const htmlOp = Perf?.start?.('clientes:html-generation', { records: clientes.length });
    const shell = (typeof CdsPageShell !== 'undefined' && CdsPageShell.renderHeader)
        ? CdsPageShell.renderHeader({ page: 'clientes' })
        : '';
    const html = `
        ${shell}
        <div class="card">
            <div class="card-header">
                <div class="row">
                    <div class="col-md-6">
                        <i class="fas fa-user-friends"></i> Lista de Clientes
                    </div>
                    <div class="col-md-6 text-end">
                        <input type="text" class="form-control form-control-sm d-inline-block w-auto me-2" id="buscaCliente" placeholder="Buscar cliente...">
                        <button class="btn btn-primary btn-sm" onclick="showClienteModal()">
                            <i class="fas fa-plus"></i> Novo Cliente
                        </button>
                    </div>
                </div>
            </div>
            <div class="card-body">
                <div class="table-responsive">
                    <table class="table table-striped table-hover">
                        <thead>
                            <tr>
                                <th>Nome</th>
                                <th>CPF/CNPJ</th>
                                <th>Telefone</th>
                                <th>Email</th>
                                <th>Limite Crédito</th>
                                <th>Crédito Atual</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody id="clientes-tbody">
                            ${montarLinhas(clientes)}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    if (htmlOp) Perf.end(htmlOp, { htmlBytesApprox: Perf.approximateBytes?.(html) ?? null });
    const domOp = Perf?.start?.('clientes:dom-update', { records: clientes.length, target: 'page-content' });
    const pageEl = document.getElementById('page-content');
    const snap = Focus && Focus.isEditing(pageEl) ? Focus.captureFocusState(pageEl) : null;
    $('#page-content').html(html);
    if (snap) Focus.restoreFocusState(snap, { restoreValue: true });
    if (domOp) {
        Perf.end(domOp, {
            nodesAfter: document.getElementById('page-content')?.querySelectorAll('*').length || 0
        });
    }
    if (totalOp) Perf.end(totalOp);
    bindBusca();
}

// Show cliente modal
function showClienteModal(cliente = null) {
    const isEdit = cliente !== null;
    const title = isEdit ? 'Editar Cliente' : 'Novo Cliente';
    const utilizaLimite = isEdit && Number(cliente.utiliza_limite_credito) === 1;
    const limiteValor = isEdit ? (cliente.limite_credito != null ? cliente.limite_credito : 0) : 0;
    const creditoAtualInfo = isEdit
        ? (typeof formatCurrency === 'function'
            ? formatCurrency(Number(cliente.credito_atual) || 0)
            : String(cliente.credito_atual != null ? cliente.credito_atual : 0))
        : null;

    const modalHtml = `
        <div class="modal fade" id="clienteModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${title}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <form id="clienteForm">
                            <input type="hidden" id="clienteId" value="${isEdit ? cliente.id : ''}">
                            <input type="hidden" id="codigo_municipio" value="${isEdit ? escapeHtml(cliente.codigo_municipio || '') : ''}">
                            <div class="row">
                                <div class="col-md-6 mb-3">
                                    <label for="nome" class="form-label">Nome / Nome Fantasia *</label>
                                    <input type="text" class="form-control" id="nome" required value="${isEdit ? escapeHtml(cliente.nome || '') : ''}">
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label for="razao_social" class="form-label">Razão Social</label>
                                    <input type="text" class="form-control" id="razao_social" value="${isEdit ? escapeHtml(cliente.razao_social || '') : ''}">
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label for="cpf_cnpj" class="form-label">CPF/CNPJ</label>
                                    <div class="d-flex align-items-start">
                                        <input type="text" class="form-control" id="cpf_cnpj" value="${isEdit ? (formatarCpfCnpj(cliente.cpf_cnpj) || '') : ''}" oninput="formatCpfCnpjInput(this)" maxlength="18">
                                        <button type="button" class="btn btn-outline-primary text-nowrap ms-2" id="btnConsultarCnpjCliente" onclick="consultarCnpjCliente()">
                                            Consultar CNPJ
                                        </button>
                                    </div>
                                    <small id="consultaCnpjClienteStatus" class="text-muted d-block mt-1"></small>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label for="inscricao_estadual" class="form-label">Inscrição Estadual</label>
                                    <input type="text" class="form-control" id="inscricao_estadual" value="${isEdit ? escapeHtml(cliente.inscricao_estadual || '') : ''}" placeholder="Opcional">
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label for="telefone" class="form-label">Telefone</label>
                                    <input type="text" class="form-control" id="telefone" value="${isEdit ? escapeHtml(cliente.telefone || '') : ''}">
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label for="email" class="form-label">E-mail</label>
                                    <input type="email" class="form-control" id="email" value="${isEdit ? escapeHtml(cliente.email || '') : ''}">
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label for="contato" class="form-label">Contato</label>
                                    <input type="text" class="form-control" id="contato" value="${isEdit ? escapeHtml(cliente.contato || '') : ''}" placeholder="Pessoa de contato">
                                </div>
                                <div class="col-md-4 mb-3">
                                    <label for="cep" class="form-label">CEP</label>
                                    <input type="text" class="form-control" id="cep" maxlength="9" value="${isEdit && cliente.cep ? escapeHtml(cliente.cep) : ''}" placeholder="00000-000">
                                </div>
                                <div class="col-md-8 mb-3 d-flex align-items-end">
                                    <button type="button" class="btn btn-outline-secondary" id="buscarCepBtn">Buscar Endereço</button>
                                    <span id="cep-loading" class="ms-2" style="display:none;"><i class="fas fa-spinner fa-spin"></i> Buscando...</span>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label for="rua" class="form-label">Rua</label>
                                    <input type="text" class="form-control" id="rua" value="${isEdit ? escapeHtml(cliente.rua || '') : ''}">
                                </div>
                                <div class="col-md-2 mb-3">
                                    <label for="numero" class="form-label">Número</label>
                                    <input type="text" class="form-control" id="numero" value="${isEdit ? escapeHtml(cliente.numero || '') : ''}">
                                </div>
                                <div class="col-md-4 mb-3">
                                    <label for="bairro" class="form-label">Bairro</label>
                                    <input type="text" class="form-control" id="bairro" value="${isEdit ? escapeHtml(cliente.bairro || '') : ''}">
                                </div>
                                <div class="col-md-4 mb-3">
                                    <label for="cidade" class="form-label">Cidade</label>
                                    <input type="text" class="form-control" id="cidade" value="${isEdit ? escapeHtml(cliente.cidade || '') : ''}">
                                </div>
                                <div class="col-md-2 mb-3">
                                    <label for="uf" class="form-label">UF</label>
                                    <input type="text" class="form-control" id="uf" maxlength="2" value="${isEdit ? escapeHtml(cliente.uf || '') : ''}">
                                </div>
                                <div class="col-md-12 mb-2">
                                    <div class="form-check">
                                        <input class="form-check-input" type="checkbox" id="utiliza_limite_credito" ${utilizaLimite ? 'checked' : ''}>
                                        <label class="form-check-label" for="utiliza_limite_credito">
                                            Utiliza limite de crédito
                                        </label>
                                    </div>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label for="limite_credito" class="form-label" id="label_limite_credito">Limite de Crédito (fiado)</label>
                                    <input type="number" step="0.01" min="0" class="form-control" id="limite_credito" value="${limiteValor}">
                                    <small class="text-muted" id="hint_limite_credito">Opcional enquanto o uso de limite estiver desmarcado.</small>
                                </div>
                                ${isEdit ? `
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Crédito Atual</label>
                                    <input type="text" class="form-control" value="${escapeHtml(creditoAtualInfo)}" readonly disabled>
                                    <small class="text-muted">Somente leitura — atualizado pelo sistema.</small>
                                </div>` : ''}
                                <div class="col-md-12 mb-3">
                                    <label for="observacoes" class="form-label">Observações</label>
                                    <textarea class="form-control" id="observacoes" rows="3" placeholder="Observações">${isEdit ? escapeHtml(cliente.observacoes || '') : ''}</textarea>
                                </div>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="saveCliente()">Salvar</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('#modal-container').html(modalHtml);
    $('#clienteModal').modal('show');

    atualizarUiLimiteCreditoCliente();
    $('#utiliza_limite_credito').off('change').on('change', atualizarUiLimiteCreditoCliente);

    $('#cep').off('blur').on('blur', buscarEnderecoPorCepCliente);
    $('#buscarCepBtn').off('click').on('click', buscarEnderecoPorCepCliente);
}

function buscarEnderecoPorCepCliente() {
    const cep = String($('#cep').val() || '').replace(/\D/g, '');
    if (cep.length !== 8) {
        showNotification('CEP inválido!', 'warning');
        return;
    }
    $('#cep-loading').show();
    // Mesma rotina ViaCEP já usada no cadastro de fornecedor / clientes
    $.getJSON(`https://viacep.com.br/ws/${cep}/json/`, function(data) {
        $('#cep-loading').hide();
        if (data.erro) {
            showNotification('CEP não encontrado!', 'warning');
            return;
        }
        if (data.logradouro) $('#rua').val(data.logradouro);
        if (data.bairro) $('#bairro').val(data.bairro);
        if (data.localidade) $('#cidade').val(data.localidade);
        if (data.uf) $('#uf').val(data.uf);
        // Cidade/UF mudaram — IBGE será resolvido no backend ao salvar
        if (data.localidade || data.uf) {
            $('#codigo_municipio').val('');
        }
    }).fail(function() {
        $('#cep-loading').hide();
        showNotification('Erro ao buscar o CEP!', 'danger');
    });
}

function atualizarUiLimiteCreditoCliente() {
    const marcado = $('#utiliza_limite_credito').is(':checked');
    const label = $('#label_limite_credito');
    const input = $('#limite_credito');
    const hint = $('#hint_limite_credito');
    if (marcado) {
        label.html('Limite de Crédito (fiado) *');
        input.prop('disabled', false);
        hint.text('Obrigatório. Informe um valor maior ou igual a zero.');
    } else {
        label.html('Limite de Crédito (fiado)');
        input.prop('disabled', false);
        hint.text('Opcional enquanto o uso de limite estiver desmarcado.');
    }
}

let _consultaCnpjClienteEmAndamento = false;

function setStatusConsultaCnpjCliente(texto, classe) {
    const el = $('#consultaCnpjClienteStatus');
    if (!el.length) return;
    el.removeClass('text-muted text-success text-danger text-warning');
    el.addClass(classe || 'text-muted');
    el.text(texto || '');
}

function aplicarDadosConsultaCnpjCliente(data) {
    const d = data || {};
    const temValor = (v) => v != null && String(v).trim() !== '';

    // Só preenche quando a API retorna valor — não apaga campos existentes
    if (temValor(d.cnpj)) {
        $('#cpf_cnpj').val(typeof formatarCpfCnpj === 'function' ? formatarCpfCnpj(d.cnpj) : d.cnpj);
    }
    if (temValor(d.nomeFantasia)) {
        $('#nome').val(d.nomeFantasia);
    }
    if (temValor(d.razaoSocial)) {
        $('#razao_social').val(d.razaoSocial);
        // Se ainda não houver nome/fantasia, usa razão social como fallback
        if (!temValor($('#nome').val())) {
            $('#nome').val(d.razaoSocial);
        }
    }
    if (temValor(d.inscricaoEstadual)) $('#inscricao_estadual').val(d.inscricaoEstadual);
    if (temValor(d.telefone)) $('#telefone').val(d.telefone);
    if (temValor(d.email)) $('#email').val(d.email);
    if (temValor(d.cep)) $('#cep').val(d.cep);
    if (temValor(d.logradouro)) $('#rua').val(d.logradouro);
    if (temValor(d.numero)) $('#numero').val(d.numero);
    if (temValor(d.bairro)) $('#bairro').val(d.bairro);
    if (temValor(d.municipio)) $('#cidade').val(d.municipio);
    if (temValor(d.uf)) $('#uf').val(String(d.uf).toUpperCase());
    if (temValor(d.codigoMunicipio)) $('#codigo_municipio').val(d.codigoMunicipio);
}

async function consultarCnpjCliente() {
    if (_consultaCnpjClienteEmAndamento) return;

    const digitos = String($('#cpf_cnpj').val() || '').replace(/\D/g, '');
    if (digitos.length !== 14) {
        showNotification('Informe um CNPJ com 14 dígitos para consultar.', 'warning');
        $('#cpf_cnpj').focus();
        return;
    }

    const btn = $('#btnConsultarCnpjCliente');
    _consultaCnpjClienteEmAndamento = true;
    btn.prop('disabled', true);
    setStatusConsultaCnpjCliente('Consultando...', 'text-muted');

    try {
        const response = await fetch(`/api/consulta-cnpj/${encodeURIComponent(digitos)}`, {
            headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            let msg = payload.error || 'Não foi possível consultar o CNPJ agora.';
            if (payload.code === 'NAO_ENCONTRADO' || response.status === 404) {
                msg = 'Empresa não encontrada para este CNPJ.';
            } else if (payload.code === 'RATE_LIMIT' || response.status === 429) {
                msg = 'A consulta de CNPJ atingiu o limite temporário. Tente novamente em alguns instantes.';
            } else if (payload.code === 'CNPJ_INVALIDO' || response.status === 400) {
                msg = 'CNPJ inválido.';
            }
            setStatusConsultaCnpjCliente(msg, 'text-danger');
            showNotification(msg, response.status === 404 ? 'warning' : 'danger');
            return;
        }

        aplicarDadosConsultaCnpjCliente(payload.data);
        setStatusConsultaCnpjCliente(
            payload.fromCache
                ? 'Dados consultados anteriormente. Confira os campos antes de salvar.'
                : 'Dados preenchidos. Confira os campos antes de salvar.',
            'text-success'
        );
        showNotification('Dados do CNPJ carregados. Confira e salve o cliente.', 'success');

        const cnpjConsultado = String((payload.data && payload.data.cnpj) || digitos).replace(/\D/g, '');
        const existente = (window.__cdsClientesCache || []).find((c) =>
            String(c.cpf_cnpj || '').replace(/\D/g, '') === cnpjConsultado
        );
        const idAtual = $('#clienteId').val();
        if (existente && String(existente.id) !== String(idAtual || '')) {
            const nomeExistente = existente.nome || '';
            showNotification(
                nomeExistente
                    ? `Este CNPJ já está cadastrado: ${nomeExistente}`
                    : 'Este CNPJ já está cadastrado.',
                'warning'
            );
            setStatusConsultaCnpjCliente(
                nomeExistente
                    ? `Este CNPJ já está cadastrado (${nomeExistente}).`
                    : 'Este CNPJ já está cadastrado.',
                'text-warning'
            );
        }
    } catch (error) {
        console.error('Erro ao consultar CNPJ do cliente:', error);
        const msg = 'Não foi possível consultar o CNPJ agora. Verifique sua conexão ou tente novamente.';
        setStatusConsultaCnpjCliente(msg, 'text-danger');
        showNotification(msg, 'danger');
    } finally {
        _consultaCnpjClienteEmAndamento = false;
        btn.prop('disabled', false);
    }
}

// Save cliente
function saveCliente() {
    const id = $('#clienteId').val();
    const utilizaLimite = $('#utiliza_limite_credito').is(':checked');
    const limiteRaw = $('#limite_credito').val();

    if (utilizaLimite && (limiteRaw === '' || limiteRaw == null)) {
        showNotification('Limite de crédito é obrigatório quando "Utiliza limite de crédito" está marcado.', 'warning');
        $('#limite_credito').focus();
        return;
    }
    if (utilizaLimite) {
        const num = parseFloat(limiteRaw);
        if (isNaN(num) || num < 0) {
            showNotification('Informe um limite de crédito válido (maior ou igual a zero).', 'warning');
            $('#limite_credito').focus();
            return;
        }
    }

    const data = {
        nome: $('#nome').val(),
        razao_social: $('#razao_social').val(),
        cpf_cnpj: $('#cpf_cnpj').val(),
        telefone: $('#telefone').val(),
        email: $('#email').val(),
        contato: $('#contato').val(),
        cep: $('#cep').val(),
        rua: $('#rua').val(),
        numero: $('#numero').val(),
        bairro: $('#bairro').val(),
        cidade: $('#cidade').val(),
        uf: $('#uf').val(),
        inscricao_estadual: $('#inscricao_estadual').val(),
        codigo_municipio: $('#codigo_municipio').val(),
        observacoes: $('#observacoes').val(),
        utiliza_limite_credito: utilizaLimite ? 1 : 0,
        limite_credito: utilizaLimite
            ? parseFloat(limiteRaw)
            : (limiteRaw === '' || limiteRaw == null ? null : parseFloat(limiteRaw))
    };

    if (!data.nome || !String(data.nome).trim()) {
        showNotification('O campo nome é obrigatório.', 'warning');
        $('#nome').focus();
        return;
    }

    const url = id ? `${API_URL}/clientes/${id}` : `${API_URL}/clientes`;
    const method = id ? 'PUT' : 'POST';

    $.ajax({
        url: url,
        method: method,
        contentType: 'application/json',
        data: JSON.stringify(data),
        success: function() {
            $('#clienteModal').modal('hide');
            showNotification('Cliente salvo com sucesso!');
            loadClientes();
        },
        error: function(xhr) {
            const msg = xhr.responseJSON?.error
                || xhr.responseJSON?.message
                || 'Erro desconhecido';
            showNotification('Erro ao salvar cliente: ' + msg, 'danger');
        }
    });
}

// Edit cliente
function editCliente(id) {
    $.ajax({
        url: `${API_URL}/clientes/${id}`,
        method: 'GET',
        success: function(cliente) {
            showClienteModal(cliente);
        }
    });
}

// Histórico de compras (vendas) do cliente
function historicoComprasCliente(id) {
    $.ajax({
        url: `${API_URL}/clientes/${id}/vendas`,
        method: 'GET',
        success: function(vendas) {
            const modalHtml = `
                <div class="modal fade" id="historicoComprasModal" tabindex="-1">
                    <div class="modal-dialog modal-lg">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Histórico de compras</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <div class="table-responsive">
                                    <table class="table table-sm table-striped">
                                        <thead>
                                            <tr>
                                                <th>Código</th>
                                                <th>Data</th>
                                                <th>Total</th>
                                                <th>Pagamento</th>
                                                <th>Itens</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${vendas.length ? vendas.map(v => `
                                                <tr>
                                                    <td>${v.codigo}</td>
                                                    <td>${formatDate(v.data_venda)}</td>
                                                    <td>${formatCurrency(v.total)}</td>
                                                    <td>${v.forma_pagamento || '-'}</td>
                                                    <td>${v.total_itens || 0}</td>
                                                </tr>
                                            `).join('') : '<tr><td colspan="5" class="text-center">Nenhuma compra concluída registrada.</td></tr>'}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            $('#modal-container').html(modalHtml);
            $('#historicoComprasModal').modal('show');
        },
        error: function() {
            showNotification('Erro ao carregar histórico de compras.', 'danger');
        }
    });
}

// View cliente
function viewCliente(id) {
    $.ajax({
        url: `${API_URL}/clientes/${id}`,
        method: 'GET',
        success: function(cliente) {
            // Monta o endereço completo
            const enderecoCompleto = [
                cliente.rua,
                cliente.numero ? 'Nº ' + cliente.numero : '',
                cliente.bairro,
                cliente.cidade,
                cliente.uf
            ].filter(Boolean).join(', ');

            const limiteCredito = cliente.limite_credito != null ? formatCurrency(Number(cliente.limite_credito)) : '-';
            const creditoAtual = cliente.credito_atual != null ? formatCurrency(Number(cliente.credito_atual)) : '-';

            const modalHtml = `
                <div class="modal fade" id="viewClienteModal" tabindex="-1">
                    <div class="modal-dialog">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Detalhes do Cliente</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <p><strong>Nome / Fantasia:</strong> ${escapeHtml(cliente.nome || '-')}</p>
                                <p><strong>Razão Social:</strong> ${escapeHtml(cliente.razao_social || '-')}</p>
                                <p><strong>CPF/CNPJ:</strong> ${formatarCpfCnpj(cliente.cpf_cnpj) || '-'}</p>
                                <p><strong>Inscrição Estadual:</strong> ${escapeHtml(cliente.inscricao_estadual || '-')}</p>
                                <p><strong>Telefone:</strong> ${escapeHtml(cliente.telefone || '-')}</p>
                                <p><strong>E-mail:</strong> ${escapeHtml(cliente.email || '-')}</p>
                                <p><strong>Contato:</strong> ${escapeHtml(cliente.contato || '-')}</p>
                                <p><strong>CEP:</strong> ${escapeHtml(cliente.cep || '-')}</p>
                                <p><strong>Rua:</strong> ${escapeHtml(cliente.rua || '-')}</p>
                                <p><strong>Número:</strong> ${escapeHtml(cliente.numero || '-')}</p>
                                <p><strong>Bairro:</strong> ${escapeHtml(cliente.bairro || '-')}</p>
                                <p><strong>Cidade:</strong> ${escapeHtml(cliente.cidade || '-')}</p>
                                <p><strong>UF:</strong> ${escapeHtml(cliente.uf || '-')}</p>
                                <p><strong>Observações:</strong> ${escapeHtml(cliente.observacoes || '-')}</p>
                                <p><strong>Limite de Crédito:</strong> ${limiteCredito}</p>
                                <p><strong>Crédito Atual:</strong> ${creditoAtual}</p>
                                <p><strong>Cadastrado em:</strong> ${formatDateTime(cliente.created_at)}</p>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            $('#modal-container').html(modalHtml);
            $('#viewClienteModal').modal('show');
        }
    });
}

// Delete cliente
function deleteCliente(id) {
    if (confirm('Tem certeza que deseja excluir este cliente?')) {
        $.ajax({
            url: `${API_URL}/clientes/${id}`,
            method: 'DELETE',
            success: function() {
                showNotification('Cliente excluído com sucesso!');
                loadClientes();
            },
            error: function(xhr) {
                if (xhr.responseJSON && xhr.responseJSON.error && xhr.status === 400) {
                    showNotification(xhr.responseJSON.error, 'danger');
                } else {
                    showNotification('Erro ao excluir cliente: ' + (xhr.responseJSON?.error || 'Erro desconhecido'), 'danger');
                }
            }
        });
    }
}

function escapeHtml(texto) {
    return String(texto == null ? '' : texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
