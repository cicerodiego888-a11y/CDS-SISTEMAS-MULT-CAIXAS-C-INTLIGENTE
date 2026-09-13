// Load configuracoes page
function loadConfiguracoes() {
    $.ajax({
        url: `${API_URL}/configuracoes`,
        method: 'GET',
        success: function(configuracoes) {
            renderConfiguracoes(configuracoes);
        },
        error: function() {
            $('#page-content').html('<div class="alert alert-danger">Erro ao carregar configurações!</div>');
        }
    });
}

// Render configuracoes
function normalizeConfiguracoes(configuracoes) {
    const normalizedMap = new Map();

    (configuracoes || []).forEach(config => {
        const key = config.chave === 'caminho_logomarca' ? 'logo' : config.chave;
        if (key === 'logo') {
            normalizedMap.set(key, {
                ...config,
                chave: key
            });
            return;
        }
        if (!normalizedMap.has(key)) {
            normalizedMap.set(key, {
                ...config,
                chave: key
            });
        }
    });

    return Array.from(normalizedMap.values());
}

function renderConfiguracoes(configuracoes) {
    configuracoes = normalizeConfiguracoes(configuracoes);

    const fiscalConfigKeys = new Set([
        'nome_empresa',
        'cnpj',
        'fiscal_ambiente',
        'fiscal_uf_sigla',
        'fiscal_uf',
        'fiscal_codigo_uf',
        'fiscal_serie',
        'fiscal_numero_atual',
        'fiscal_regime_tributario',
        'fiscal_ie',
        'fiscal_im',
        'fiscal_cnae',
        'fiscal_certificado_path',
        'fiscal_certificado_senha',
        'fiscal_id_csc',
        'fiscal_token_csc',
        'fiscal_ws_autorizacao_homologacao',
        'fiscal_ws_retorno_homologacao',
        'fiscal_ws_status_homologacao',
        'fiscal_csc_qrcode_url_homologacao',
        'fiscal_consulta_chave_url_homologacao',
        'fiscal_tp_imp',
        'fiscal_municipio_codigo',
        'fiscal_municipio_nome',
        'fiscal_emitente_cep',
        'fiscal_emitente_logradouro',
        'fiscal_emitente_numero',
        'fiscal_emitente_bairro'
    ]);

    const pixConfigKeys = new Set([
        'pix_automatico_ativo',
        'pix_provedor_ativo',
        'pix_configs_json'
    ]);

    configuracoes = configuracoes.filter(config =>
        !fiscalConfigKeys.has(config.chave) &&
        !pixConfigKeys.has(config.chave) &&
        config.chave !== 'endereco'
    );

    const ordemCamposEmpresa = [
        'nome_empresa',
        'nome_fantasia',
        'razao_social',
        'cnpj',
        'ie',
        'im',
        'telefone',
        'whatsapp',
        'email',
        'cep',
        'logradouro',
        'numero',
        'complemento',
        'bairro',
        'cidade',
        'uf'
    ];

    configuracoes.sort((a, b) => {
        const ia = ordemCamposEmpresa.indexOf(a.chave);
        const ib = ordemCamposEmpresa.indexOf(b.chave);

        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
    });

    const loginBg = configuracoes.find(c => c.chave === 'login_background');
    const camposComerciais = configuracoes.filter(c => c.chave !== 'login_background');

    const html = `
        <div class="card mb-3 border-0 shadow-sm">
            <div class="card-body py-3">
                <h4 class="mb-1"><i class="fas fa-building text-primary"></i> Configurações da Empresa</h4>
                <p class="text-muted small mb-0">Parâmetros operacionais. Fiscal, módulos e licenciamento ficam em <strong>Centro de Configurações</strong> (Super Usuário).</p>
            </div>
        </div>

        <div class="card mb-3">
            <div class="card-header"><i class="fas fa-store"></i> Comercial</div>
            <div class="card-body">
                <form id="configForm">
                    <div class="row">
                        ${camposComerciais.map(config => `
                            <div class="col-md-6 mb-3">
                                <label for="${config.chave}" class="form-label fw-bold">
                                    ${config.descricao || config.chave}
                                </label>
                                ${renderConfigField(config)}
                            </div>
                        `).join('')}
                    </div>
                    <button type="button" class="btn btn-primary" onclick="saveConfiguracoes()">
                        <i class="fas fa-save"></i> Salvar Configurações
                    </button>
                </form>
            </div>
        </div>

        <div class="card mb-3">
            <div class="card-header"><i class="fas fa-print"></i> Impressões</div>
            <div class="card-body">
                <div class="row align-items-center">
                    <div class="col-md-8">
                        <label class="form-label fw-bold">Impressora de Cupom</label>
                        <div id="impressoraAtual" class="text-muted small mb-2">
                            <i class="fas fa-spinner fa-spin"></i> Carregando...
                        </div>
                    </div>
                    <div class="col-md-4">
                        <button class="btn btn-info" onclick="configurarImpressoraCupom()">
                            <i class="fas fa-cog"></i> Configurar
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div class="card mb-3">
            <div class="card-header"><i class="fas fa-bell"></i> Alertas</div>
            <div class="card-body">
                <p class="text-muted small mb-0">
                    Alertas operacionais de entrega e prazos são definidos em
                    <strong>Centro de Configurações → Módulos Licenciados</strong> (quando Entregas estiver ativo).
                </p>
            </div>
        </div>

        <div class="card mb-3">
            <div class="card-header"><i class="fas fa-palette"></i> Aparência</div>
            <div class="card-body">
                <div class="row align-items-center">
                    <div class="col-md-8">
                        <label class="form-label fw-bold">Imagem de fundo da tela de login</label>
                        <input type="file" class="form-control form-control-sm" id="loginBackgroundUpload" accept="image/*">
                        <small class="text-muted">Recomendado: imagem 1920x1080px ou maior</small>
                        <input type="hidden" id="login_background_path" value="${escapeHtml(loginBg?.valor || '')}">
                    </div>
                    <div class="col-md-4">
                        <div id="loginBackgroundPreview">
                            ${(() => {
                                const value = loginBg?.valor || '';
                                const previewUrl = value && value.startsWith('/')
                                    ? `${API_URL.replace('/api', '')}${value}`
                                    : value;
                                return previewUrl
                                    ? `<img src="${escapeHtml(previewUrl)}" alt="Fundo login atual" style="max-height: 60px; max-width: 120px; border: 1px solid #ddd; border-radius: 4px;" />`
                                    : '<span class="text-muted small">Nenhuma imagem definida</span>';
                            })()}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="card mb-3">
            <div class="card-header"><i class="fas fa-sliders-h"></i> Preferências Operacionais</div>
            <div class="card-body">
                <p class="mb-2"><strong>Versão:</strong> 1.0.0</p>
                <p class="mb-2 text-muted small">Cache do navegador e limpeza local (não altera banco).</p>
                <button class="btn btn-outline-warning btn-sm" onclick="limparCache()">
                    <i class="fas fa-trash"></i> Limpar Cache Local
                </button>
            </div>
        </div>
    `;

    $('#page-content').html(html);
    carregarImpressoraCupom();
}

// --- PIX AUTOMÁTICO ---
let catalogoPixAutomatico = {};

function headersPixApi() {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

async function abrirModalPixAutomatico() {
    try {
        const respProvedores = await fetch(`${API_URL}/pix/provedores`, {
            headers: headersPixApi()
        });
        const dadosProvedores = await respProvedores.json();

        const respConfig = await fetch(`${API_URL}/pix/config`, {
            headers: headersPixApi()
        });
        const dadosConfig = await respConfig.json();

        if (!dadosProvedores.success || !dadosConfig.success) {
            throw new Error('Erro ao carregar configuração Pix.');
        }

        catalogoPixAutomatico = dadosProvedores.provedores || {};

        const config = dadosConfig.config || {};
        const provedorAtivo = config.provedor || 'mercadopago';
        const configs = config.configs || {};

        const options = Object.entries(catalogoPixAutomatico).map(([key, item]) => {
            return `<option value="${key}" ${key === provedorAtivo ? 'selected' : ''}>${item.nome}</option>`;
        }).join('');

        $('#modal-container').html(`
            <div class="modal fade" id="modalPixConfig" tabindex="-1">
                <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
                    <div class="modal-content">
                        <div class="modal-header bg-success text-white">
                            <h5 class="modal-title">
                                <i class="fas fa-qrcode"></i> Configurar Pix Automático
                            </h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>

                        <div class="modal-body">
                            <div class="form-check form-switch mb-3">
                                <input class="form-check-input" type="checkbox" id="pixAutoAtivo" ${config.ativo ? 'checked' : ''}>
                                <label class="form-check-label fw-bold" for="pixAutoAtivo">
                                    Ativar Pix automático no PDV
                                </label>
                            </div>

                            <div class="mb-3">
                                <label class="form-label">Banco/Provedor Pix</label>
                                <select id="pixProvedorAtivo" class="form-select" onchange="renderCamposPixAutomatico()">
                                    ${options}
                                </select>
                            </div>

                            <div id="camposPixAutomatico"></div>

                            <div class="alert alert-warning mt-3 mb-0">
                                <strong>Atenção:</strong> Mercado Pago já usa Access Token.
                                Stone e bancos podem exigir contrato/API específica, token, webhook e dados da conta PJ.
                            </div>
                        </div>

                        <div class="modal-footer">
                            <button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
                            <button class="btn btn-outline-primary" onclick="testarPixAutomatico()">Testar/Salvar</button>
                            <button class="btn btn-success" onclick="salvarPixAutomatico()">Salvar</button>
                        </div>
                    </div>
                </div>
            </div>
        `);

        window.pixConfigsAtuais = configs;

        renderCamposPixAutomatico();

        const modal = new bootstrap.Modal(document.getElementById('modalPixConfig'));
        modal.show();

    } catch (err) {
        console.error(err);
        showNotification(err.message || 'Erro ao abrir configuração Pix.', 'danger');
    }
}

function renderCamposPixAutomatico() {
    const provedor = $('#pixProvedorAtivo').val();
    const item = catalogoPixAutomatico[provedor];

    if (!item) return;

    const config = (window.pixConfigsAtuais || {})[provedor] || {};

    if (!item.campos || item.campos.length === 0) {
        $('#camposPixAutomatico').html(`
            <div class="alert alert-info">
                Este provedor já está listado, mas a integração será adicionada depois.
            </div>
        `);
        return;
    }

    const html = item.campos.map(campo => {
        const valor = config[campo.name] ?? campo.default ?? '';
        return `
            <div class="mb-3">
                <label class="form-label">${campo.label}${campo.required ? ' *' : ''}</label>
                <input
                    type="${campo.type || 'text'}"
                    class="form-control campo-pix-auto"
                    data-name="${campo.name}"
                    value="${escapeHtml(String(valor))}"
                    ${campo.required ? 'required' : ''}
                >
            </div>
        `;
    }).join('');

    $('#camposPixAutomatico').html(html);
}

function coletarConfigPixAutomatico() {
    const provedor = $('#pixProvedorAtivo').val();
    const item = catalogoPixAutomatico[provedor] || {};
    const camposPorNome = {};
    (item.campos || []).forEach(c => { camposPorNome[c.name] = c; });

    const configs = { ...(window.pixConfigsAtuais || {}) };
    configs[provedor] = {};

    $('.campo-pix-auto').each(function() {
        const name = $(this).data('name');
        let valor = $(this).val();
        const campo = camposPorNome[name];
        if (campo?.type === 'number') {
            valor = Number(valor) || Number(campo.default) || 0;
        } else {
            valor = String(valor || '').trim();
        }
        configs[provedor][name] = valor;
    });

    window.pixConfigsAtuais = configs;

    return {
        ativo: $('#pixAutoAtivo').is(':checked'),
        provedor,
        configs
    };
}

async function salvarPixAutomatico() {
    try {
        const payload = coletarConfigPixAutomatico();

        const resp = await fetch(`${API_URL}/pix/config`, {
            method: 'POST',
            headers: headersPixApi(),
            body: JSON.stringify(payload)
        });

        const data = await resp.json();

        if (!resp.ok || !data.success) {
            throw new Error(data.error || 'Erro ao salvar Pix.');
        }

        showNotification('Configuração Pix salva com sucesso.', 'success');

        const modal = bootstrap.Modal.getInstance(document.getElementById('modalPixConfig'));
        if (modal) modal.hide();

    } catch (err) {
        console.error(err);
        showNotification(err.message || 'Erro ao salvar Pix.', 'danger');
    }
}

async function testarPixAutomatico() {
    await salvarPixAutomatico();
    showNotification('Configuração salva. Faça uma venda teste em Pix para validar a cobrança.', 'info');
}

function escapeHtml(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

// Render config field based on type
function renderConfigField(config) {
    const value = config.valor || '';

    if (config.chave === 'logo' || config.chave === 'caminho_logomarca') {
        const previewUrl = normalizeConfigImageUrl(value);

        const previewImg = previewUrl
            ? `<img src="${escapeHtml(previewUrl)}" alt="Logo atual" style="max-height: 100px;" />`
            : '';

        return `
            <div>
                <input type="file" class="form-control" id="logoUpload" accept="image/*">
                <input type="hidden" id="logo_path" value="${escapeHtml(value)}">
                <div id="logoPreview" class="mt-2">
                    ${previewImg}
                </div>
            </div>
        `;
    }

    if (config.chave === 'login_background') {
        const previewUrl = value && value.startsWith('/')
            ? `${API_URL.replace('/api', '')}${value}`
            : value;

        const previewImg = previewUrl
            ? `<img src="${escapeHtml(previewUrl)}" alt="Fundo login atual" style="max-height: 150px; max-width: 100%;" />`
            : '<span class="text-muted">Nenhuma imagem definida (usa gradiente padrão)</span>';

        return `
            <div>
                <input type="file" class="form-control" id="loginBackgroundUpload" accept="image/*">
                <small class="text-muted">Recomendado: imagem 1920x1080px ou maior</small>
                <input type="hidden" id="login_background_path" value="${escapeHtml(value)}">
                <div id="loginBackgroundPreview" class="mt-2">
                    ${previewImg}
                </div>
            </div>
        `;
    }

    if (config.chave === 'cep') {
        return `<input type="text" class="form-control" id="${config.chave}" value="${value}" onblur="buscarCep(this.value)" oninput="formatCep(this)">`;
    }

    if (config.chave === 'telefone' || config.chave === 'whatsapp') {
        return `<input type="text" class="form-control" id="${config.chave}" value="${value}" oninput="formatPhone(this)">`;
    }

    if (config.chave === 'cnpj') {
        return `<input type="text" class="form-control" id="${config.chave}" value="${formatarCNPJ(value)}" oninput="formatCNPJInput(this)" maxlength="18">`;
    }

    switch(config.tipo) {
        case 'boolean':
            return `
                <select class="form-control" id="${config.chave}">
                    <option value="true" ${value === 'true' ? 'selected' : ''}>Sim</option>
                    <option value="false" ${value === 'false' ? 'selected' : ''}>Não</option>
                </select>
            `;
        case 'text':
            return `<textarea class="form-control" id="${config.chave}" rows="3">${value}</textarea>`;
        default:
            return `<input type="text" class="form-control" id="${config.chave}" value="${value}">`;
    }
}

function normalizeConfigImageUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    if (raw.startsWith('/')) {
        return `${API_URL.replace('/api', '')}${raw}`;
    }

    if (raw.startsWith('storage/')) {
        return `${API_URL.replace('/api', '')}/${raw}`;
    }

    const normalized = raw.replace(/\\/g, '/');
    const storageIndex = normalized.indexOf('/storage/');
    if (storageIndex !== -1) {
        return `${API_URL.replace('/api', '')}${normalized.slice(storageIndex)}`;
    }

    return raw;
}

async function uploadLogoFile() {
    const logoInput = document.getElementById('logoUpload');
    if (!logoInput || !logoInput.files || logoInput.files.length === 0) {
        return null;
    }

    const formData = new FormData();
    formData.append('logo', logoInput.files[0]);

    const resp = await fetch(`${API_URL}/configuracoes/upload-logo`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
    });

    if (!resp.ok) {
        const errorData = await resp.json().catch(() => null);
        throw new Error(errorData?.error || 'Erro ao enviar a logo.');
    }

    const data = await resp.json();
    if (data.path) {
        $('#logo_path').val(data.path);
        $('#logoPreview').html(`<img src="${escapeHtml(normalizeConfigImageUrl(data.path))}" alt="Logo atual" style="max-height: 100px;" />`);
        // Recarrega a logo na sidebar imediatamente
        setTimeout(() => {
            if (typeof carregarLogoSidebar === 'function') {
                carregarLogoSidebar();
            }
        }, 200);
    }

    return data.path;
}

async function uploadLoginBackgroundFile() {
    const bgInput = document.getElementById('loginBackgroundUpload');
    if (!bgInput || !bgInput.files || bgInput.files.length === 0) {
        return null;
    }

    const formData = new FormData();
    formData.append('imagem', bgInput.files[0]);

    const resp = await fetch(`${API_URL}/configuracoes/upload-login-background`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
    });

    if (!resp.ok) {
        const errorData = await resp.json().catch(() => null);
        throw new Error(errorData?.error || 'Erro ao enviar imagem de fundo.');
    }

    const data = await resp.json();
    if (data.path) {
        $('#login_background_path').val(data.path);
        $('#loginBackgroundPreview').html(`<img src="${escapeHtml(data.path)}" alt="Fundo login atual" style="max-height: 150px; max-width: 100%;" />`);
    }

    return data.path;
}

// Save configuracoes
async function saveConfiguracoes() {
    try {
        await uploadLogoFile();
        await uploadLoginBackgroundFile();
    } catch (error) {
        showNotification(error.message || 'Erro ao enviar imagem.', 'danger');
        return;
    }

    const configs = [];
    
    $('#configForm .form-control').each(function() {
        const chave = $(this).attr('id');
        const valor = $(this).val();
        if (!chave || chave === 'logoUpload' || chave === 'loginBackgroundUpload') return;
        if (chave === 'logo_path') {
            configs.push({
                chave: 'logo',
                valor: valor
            });
            return;
        }
        if (chave === 'login_background_path') {
            configs.push({
                chave: 'login_background',
                valor: valor
            });
            return;
        }

        if (chave === 'caminho_logomarca') {
            configs.push({
                chave: 'logo',
                valor: valor
            });
            return;
        }

        configs.push({
            chave: chave,
            valor: valor
        });
    });
    
    console.log('Configurações para salvar:', configs);
    
    let promises = [];
    
    configs.forEach(config => {
        const promise = $.ajax({
            url: `${API_URL}/configuracoes/${config.chave}`,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify({ valor: config.valor })
        });
        promises.push(promise);
    });
    
    Promise.all(promises)
        .then((responses) => {
            console.log('Respostas do servidor:', responses);
            showNotification('Configurações salvas com sucesso!');
            // Recarrega a logo na sidebar
            if (typeof carregarLogoSidebar === 'function') {
                carregarLogoSidebar();
            }
            loadConfiguracoes();
        })
        .catch((error) => {
            console.error('Erro ao salvar configurações:', error);
            showNotification('Erro ao salvar configurações: ' + (error.responseJSON?.error || error.message || 'Erro desconhecido'), 'danger');
        });
}

// Fazer backup
function fazerBackup() {
    const data = {
        produtos: null,
        clientes: null,
        vendas: null,
        compras: null,
        financeiro: null
    };
    
    // Fetch all data
    const promises = [
        $.ajax({ url: `${API_URL}/produtos`, method: 'GET' }),
        $.ajax({ url: `${API_URL}/clientes`, method: 'GET' }),
        $.ajax({ url: `${API_URL}/vendas`, method: 'GET' }),
        $.ajax({ url: `${API_URL}/compras`, method: 'GET' }),
        $.ajax({ url: `${API_URL}/financeiro`, method: 'GET' })
    ];
    
    Promise.all(promises)
        .then(([produtos, clientes, vendas, compras, financeiro]) => {
            const backup = {
                data: new Date().toISOString(),
                produtos: produtos,
                clientes: clientes,
                vendas: vendas,
                compras: compras,
                financeiro: financeiro
            };
            
            const backupStr = JSON.stringify(backup, null, 2);
            const blob = new Blob([backupStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            
            showNotification('Backup gerado com sucesso!');
        })
        .catch(() => {
            showNotification('Erro ao gerar backup!', 'danger');
        });
}

// Buscar CEP
function buscarCep(cep) {
    if (!cep || cep.length < 8) return;

    // Remover caracteres não numéricos
    cep = cep.replace(/\D/g, '');

    if (cep.length !== 8) return;

    // Mostrar loading
    showNotification('Buscando endereço...', 'info');

    fetch(`https://viacep.com.br/ws/${cep}/json/`)
        .then(response => response.json())
        .then(data => {
            if (data.erro) {
                showNotification('CEP não encontrado.', 'warning');
                return;
            }

            // Preencher os campos
            $('#logradouro').val(data.logradouro || '');
            $('#bairro').val(data.bairro || '');
            $('#cidade').val(data.localidade || '');
            $('#uf').val(data.uf || '');

            showNotification('Endereço preenchido automaticamente.');
        })
        .catch(error => {
            console.error('Erro ao buscar CEP:', error);
            showNotification('Erro ao buscar CEP. Tente novamente.', 'danger');
        });
}

// Formatar telefone
function formatPhone(input) {
    let value = input.value.replace(/\D/g, '');
    if (value.length <= 11) {
        value = value.replace(/(\d{2})(\d{1})(\d{4})(\d{4})/, '($1)$2.$3-$4');
        input.value = value;
    }
}

// Formatar CEP
function formatCep(input) {
    let value = input.value.replace(/\D/g, '');
    if (value.length <= 8) {
        value = value.replace(/(\d{5})(\d{3})/, '$1-$2');
        input.value = value;
    }
}

// Formatar CNPJ em tempo real
function formatCNPJInput(input) {
    let value = input.value.replace(/\D/g, '');
    if (value.length <= 14) {
        value = value.replace(/(\d{2})(\d)/, '$1.$2');
        value = value.replace(/(\d{3})(\d)/, '$1.$2');
        value = value.replace(/(\d{3})(\d)/, '$1/$2');
        value = value.replace(/(\d{4})(\d)/, '$1-$2');
        input.value = value;
    }
}

// Configurar event listener do botão de backup manual
function setupBackupManualListener() {
    document.getElementById("btnBackupManual")?.addEventListener("click", async () => {
        const resultadoBackup = document.getElementById("resultadoBackup");

        try {
            resultadoBackup.innerHTML = "Fazendo backup...";

            const resposta = await fetch(`${API_URL}/backup/manual`, {
                method: "POST",
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });

            const dados = await resposta.json();

            if (!dados.sucesso) {
                const detalhe = [dados.mensagem || dados.erro || "Erro ao fazer backup.", dados.codigo ? `(${dados.codigo})` : '']
                    .filter(Boolean)
                    .join(' ');
                throw new Error(detalhe);
            }

            resultadoBackup.innerHTML = `
                <div style="color: green;">
                    ✅ Backup realizado com sucesso!<br>
                    Arquivo: ${escapeHtml(dados.backup.arquivo)}<br>
                    Local: ${escapeHtml(dados.backup.caminho)}
                </div>
            `;
            showNotification('Backup realizado com sucesso!', 'success');
        } catch (error) {
            resultadoBackup.innerHTML = `
                <div style="color: red;">
                    ❌ Erro ao fazer backup: ${escapeHtml(error.message)}
                </div>
            `;
            showNotification(error.message || 'Erro ao fazer backup', 'danger');
        }
    });
}

// Carregar pasta de backup atual
async function carregarPastaBackup() {
    try {
        const resp = await fetch(`${API_URL}/configuracoes/backup-path`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        const data = await resp.json();
        const pastaDiv = document.getElementById('pastaAtual');
        if (!pastaDiv) return;

        if (data.sucesso && data.caminho) {
            pastaDiv.innerHTML = `<i class="fas fa-folder"></i> Pasta atual: ${escapeHtml(data.caminho)}`;
        } else if (data.sucesso && data.fallback) {
            pastaDiv.innerHTML = `<i class="fas fa-exclamation-triangle text-warning"></i> Nenhuma pasta configurada — fallback: ${escapeHtml(data.fallback)}`;
        } else {
            pastaDiv.innerHTML = `<i class="fas fa-exclamation-triangle text-warning"></i> Nenhuma pasta de backup configurada`;
        }
    } catch (error) {
        console.error('Erro ao carregar pasta de backup:', error);
    }
}

function detectarAmbienteElectron() {
    return Boolean(window.electronAPI) || /Electron/i.test(navigator.userAgent || '');
}

/**
 * Normaliza retorno do seletor (IPC objeto, API HTTP ou prompt string).
 * @returns {{ sucesso: true, caminho: string } | { sucesso: false, cancelado?: boolean, erro?: string }}
 */
function normalizarResultadoSelecaoPasta(resultado) {
    if (resultado == null) {
        return { sucesso: false, cancelado: true };
    }
    if (typeof resultado === 'string') {
        const caminho = resultado.trim();
        if (!caminho) return { sucesso: false, cancelado: true };
        return { sucesso: true, caminho };
    }
    if (typeof resultado === 'object') {
        if (resultado.cancelado) {
            return { sucesso: false, cancelado: true };
        }
        if (resultado.sucesso && typeof resultado.caminho === 'string' && resultado.caminho.trim()) {
            return { sucesso: true, caminho: resultado.caminho.trim() };
        }
        if (resultado.erro) {
            return { sucesso: false, erro: String(resultado.erro) };
        }
    }
    return { sucesso: false, erro: 'Resposta inválida do seletor de pasta.' };
}

async function solicitarPastaBackup() {
    if (typeof window.electronAPI?.selecionarPastaBackup === 'function') {
        try {
            const bruto = await window.electronAPI.selecionarPastaBackup();
            return normalizarResultadoSelecaoPasta(bruto);
        } catch (error) {
            console.warn('[BACKUP] Falha no IPC do Electron, tentando API local:', error);
        }
    }

    if (detectarAmbienteElectron()) {
        try {
            const resp = await fetch(`${API_URL}/backup/selecionar-pasta`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    'Content-Type': 'application/json'
                }
            });
            const data = await resp.json().catch(() => ({}));

            if (data.cancelado) {
                return { sucesso: false, cancelado: true };
            }

            if (resp.ok && data.sucesso && data.caminho) {
                return { sucesso: true, caminho: String(data.caminho).trim() };
            }

            if (resp.status === 501 || data.erro === 'NOT_ELECTRON') {
                return {
                    sucesso: false,
                    erro: 'Seletor de pasta indisponível. Reinicie o aplicativo desktop.'
                };
            }

            return {
                sucesso: false,
                erro: data.mensagem || data.erro || 'Erro ao abrir seletor de pasta'
            };
        } catch (error) {
            console.error('[BACKUP] Erro na API de seleção de pasta:', error);
            return { sucesso: false, erro: 'Erro ao abrir seletor de pasta no aplicativo' };
        }
    }

    const caminho = prompt("Digite o caminho da pasta de backup (ex: C:\\ProgramData\\MercantilFiscal\\dados\\backups):");
    if (caminho == null) {
        return { sucesso: false, cancelado: true };
    }

    const pasta = String(caminho).trim();
    if (!pasta) {
        return { sucesso: false, erro: 'Caminho inválido' };
    }

    return { sucesso: true, caminho: pasta };
}

async function escolherPastaBackup() {
    const selecao = await solicitarPastaBackup();

    if (selecao.cancelado) {
        showNotification('Seleção de pasta cancelada.', 'info');
        return;
    }

    if (!selecao.sucesso || typeof selecao.caminho !== 'string' || !selecao.caminho.trim()) {
        showNotification(
            `Pasta de backup não pôde ser configurada.${selecao.erro ? ` ${selecao.erro}` : ''}`,
            'danger'
        );
        return;
    }

    const pastaSelecionada = selecao.caminho.trim();
    console.log('[BACKUP CONFIG] Pasta selecionada:', pastaSelecionada);

    try {
        const resp = await fetch(`${API_URL}/configuracoes/backup-path`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ caminho: pastaSelecionada })
        });

        const data = await resp.json().catch(() => ({}));

        if (resp.ok && data.sucesso) {
            console.log('[BACKUP CONFIG] Pasta salva:', data.caminho || pastaSelecionada);
            showNotification(data.mensagem || 'Pasta de backup configurada com sucesso.', 'success');
            await carregarPastaBackup();
            return;
        }

        const motivo = data.detalhe || data.erro || data.mensagem || `HTTP ${resp.status}`;
        showNotification(`Pasta de backup não pôde ser configurada. ${motivo}`, 'danger');
    } catch (error) {
        showNotification(
            `Pasta de backup não pôde ser configurada. ${error.message || ''}`.trim(),
            'danger'
        );
    }
}

window.escolherPastaBackup = escolherPastaBackup;
window.normalizarResultadoSelecaoPasta = normalizarResultadoSelecaoPasta;

// Função para carregar impressora configurada
async function carregarImpressoraCupom() {
    try {
        const resp = await fetch(`${API_URL}/configuracoes/impressora_cupom`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        const data = await resp.json();
        const impressoraDiv = document.getElementById('impressoraAtual');
        if (!impressoraDiv) return;

        if (data.sucesso && data.caminho) {
            impressoraDiv.innerHTML = `<i class="fas fa-print"></i> ${escapeHtml(data.caminho)}`;
        } else {
            impressoraDiv.innerHTML = `<i class="fas fa-exclamation-triangle text-warning"></i> Nenhuma impressora configurada (será detectada automaticamente)`;
        }
    } catch (error) {
        console.error('Erro ao carregar impressora:', error);
        const impressoraDiv = document.getElementById('impressoraAtual');
        if (impressoraDiv) {
            impressoraDiv.innerHTML = `<i class="fas fa-exclamation-circle text-danger"></i> Erro ao carregar`;
        }
    }
}

// Função para configurar impressora de cupom
async function configurarImpressoraCupom() {
    try {
        let impressoras = [];
        let usarLista = false;

        console.log('[CONFIG IMPRESSORA] Iniciando configuração');
        console.log('[CONFIG IMPRESSORA] window.electronAPI:', !!window.electronAPI);

        // Tentar listar impressoras via Electron API
        if (window.electronAPI && window.electronAPI.listarImpressoras) {
            try {
                console.log('[CONFIG IMPRESSORA] Chamando listarImpressoras...');
                impressoras = await window.electronAPI.listarImpressoras();
                console.log('[CONFIG IMPRESSORA] Impressoras recebidas:', impressoras);
                if (impressoras && impressoras.length > 0) {
                    usarLista = true;
                }
            } catch (err) {
                console.error('[CONFIG IMPRESSORA] Erro ao listar impressoras:', err);
            }
        }

        // Criar modal customizado
        const modalId = 'modalImpressoraCupom';

        // Remover modal anterior se existir
        const modalExistente = document.getElementById(modalId);
        if (modalExistente) modalExistente.remove();

        let htmlContent = '';

        if (usarLista) {
            // Construir opções do select
            const opcoesHtml = impressoras.map(imp => {
                const destaque = imp.name.toLowerCase().includes('cupom') ? ' ⭐' : '';
                const padrao = imp.isDefault ? ' (padrão)' : '';
                return `<option value="${escapeHtml(imp.name)}">${escapeHtml(imp.name)}${destaque}${padrao}</option>`;
            }).join('');

            htmlContent = `
                <div class="mb-3">
                    <label class="form-label">Selecione a impressora:</label>
                    <select id="selectImpressoraCupom" class="form-select">
                        <option value="">-- Automático (detectar) --</option>
                        ${opcoesHtml}
                    </select>
                    <small class="text-muted">⭐ = impressora de cupom detectada</small>
                </div>
            `;
        } else {
            htmlContent = `
                <div class="mb-3">
                    <label class="form-label">Nome da impressora (deixe em branco para automático):</label>
                    <input type="text" id="inputImpressoraCupom" class="form-control" placeholder="Ex: EPSON TM-T20">
                </div>
            `;
        }

        const html = `
            <div id="${modalId}" style="
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 99999;
            ">
                <div style="
                    background: #fff;
                    padding: 25px;
                    border-radius: 8px;
                    width: 450px;
                    max-width: 90%;
                    box-shadow: 0 10px 30px rgba(0,0,0,.25);
                ">
                    <h5 style="margin-top:0; margin-bottom:20px;">
                        <i class="fas fa-print"></i> Configurar impressora de cupom
                    </h5>
                    ${htmlContent}
                    <div class="d-flex gap-2 justify-content-end">
                        <button type="button" class="btn btn-secondary" id="btnCancelarImpressora">
                            Cancelar
                        </button>
                        <button type="button" class="btn btn-primary" id="btnSalvarImpressora">
                            <i class="fas fa-save"></i> Salvar
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', html);

        // Evento cancelar
        document.getElementById('btnCancelarImpressora').onclick = () => {
            document.getElementById(modalId).remove();
        };

        // Evento salvar
        document.getElementById('btnSalvarImpressora').onclick = async () => {
            let impressora = '';
            if (usarLista) {
                impressora = document.getElementById('selectImpressoraCupom').value;
            } else {
                impressora = document.getElementById('inputImpressoraCupom').value;
            }

            try {
                const resp = await fetch(`${API_URL}/configuracoes/impressora_cupom`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ caminho: impressora })
                });

                const data = await resp.json();

                if (data.sucesso) {
                    showNotification('Impressora configurada com sucesso!', 'success');
                    document.getElementById(modalId).remove();
                    carregarImpressoraCupom();
                } else {
                    showNotification(data.mensagem || 'Erro ao configurar impressora', 'danger');
                }
            } catch (err) {
                showNotification('Erro ao salvar impressora', 'danger');
            }
        };

        // Fechar ao clicar fora
        document.getElementById(modalId).onclick = (e) => {
            if (e.target.id === modalId) {
                document.getElementById(modalId).remove();
            }
        };
    } catch (error) {
        showNotification('Erro ao configurar impressora', 'danger');
        console.error(error);
    }
}

// Função para imprimir cupom
async function imprimirCupom() {
    try {
        const res = await fetch(`${API_URL}/impressao/imprimir`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        const data = await res.json();

        if (!data.sucesso) {
            throw new Error(data.mensagem || "Erro ao imprimir");
        }

        showNotification(`Impressão OK: ${data.impressora}`, 'success');
        console.log("Impressão OK:", data.impressora);
    } catch (err) {
        showNotification('Erro na impressão: ' + err.message, 'danger');
        console.error('Erro na impressão:', err);
    }
}

async function carregarStatusPixAutomatico() {
    try {
        const resp = await fetch(`${API_URL}/pix/config`, {
            headers: headersPixApi()
        });
        const data = await resp.json();

        if (!data.success) return;

        const ativo = data.config?.ativo === true;

        $('#togglePixAutomatico').prop('checked', ativo);
        $('#containerBotaoPixAutomatico').toggle(ativo);
    } catch (err) {
        console.error('Erro ao carregar Pix:', err);
    }
}

async function alterarPixAutomatico() {
    try {
        const ativo = $('#togglePixAutomatico').is(':checked');

        $('#containerBotaoPixAutomatico').toggle(ativo);

        const respAtual = await fetch(`${API_URL}/pix/config`, {
            headers: headersPixApi()
        });
        const atual = await respAtual.json();

        const payload = {
            ativo,
            provedor: atual.config?.provedor || 'mercadopago',
            configs: atual.config?.configs || {}
        };

        const resp = await fetch(`${API_URL}/pix/config`, {
            method: 'POST',
            headers: headersPixApi(),
            body: JSON.stringify(payload)
        });

        const data = await resp.json();

        if (!resp.ok || !data.success) {
            throw new Error(data.error || 'Erro ao salvar configuração Pix.');
        }

        showNotification(
            ativo ? 'Pix automático ativado.' : 'Pix automático desativado.',
            'success'
        );
    } catch (err) {
        console.error(err);
        showNotification('Erro ao alterar Pix automático.', 'danger');
        carregarStatusPixAutomatico();
    }
}

// Advanced configurations — tela exclusiva do SUPER_ADMIN
function loadConfiguracoesAvancadas() {
    if (!isSuperAdminUser()) {
        $('#page-content').html('<div class="alert alert-danger">Acesso negado. Apenas Super Administrador.</div>');
        return;
    }

    $.ajax({
        url: `${API_URL}/configuracoes-avancadas`,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        success: async function(config) {
            renderConfiguracoesAvancadas(config || {});
            await sincronizarRedeEstacaoConfigAvancadas();
        },
        error: function(xhr) {
            const msg = xhr.responseJSON?.error || 'Erro ao carregar configurações avançadas.';
            $('#page-content').html(`<div class="alert alert-danger">${escapeHtml(msg)}</div>`);
        }
    });
}

function renderConfiguracoesAvancadas(config) {
    window.configuracaoAvancadaServidor = config || {};

    if (typeof renderCentroConfiguracoesCDS === 'function') {
        renderCentroConfiguracoesCDS(config || {});
        return;
    }

    // Fallback legado (script cds-centro-configuracoes.js ausente)
    const tipo = String(config.tipoImplantacao || 'ERP_SEM_FISCAL').toUpperCase();
    $('#page-content').html(`
        <div class="alert alert-warning">
            Centro de Configurações indisponível (script não carregado). Recarregue a página.
            <div class="small mt-1">Tipo implantação: ${tipo}</div>
        </div>
    `);
}

function tipoImplantacaoPermiteConfigFiscal(tipo) {
    const t = String(tipo || '').toUpperCase();
    return t === 'ERP_FISCAL' || t === 'ERP_MULTICAIXA';
}

function carregarConfigFiscalAvancadas() {
    const tipo = obterTipoImplantacaoSelecionado();
    const $secao = $('#secaoConfigFiscalAvancadas');
    const $form = $('#fiscal-config-form-area-avancadas');
    const $msg = $('#msgConfigFiscalIndisponivel');

    if (!tipoImplantacaoPermiteConfigFiscal(tipo)) {
        $msg.show();
        $form.hide().empty();
        return;
    }

    $msg.hide();
    $form.show().html(`
        <div class="text-center py-4 text-muted">
            <i class="fas fa-spinner fa-spin me-2"></i> Carregando configuração fiscal...
        </div>
    `);

    if (typeof carregarFiscalConfig === 'function') {
        carregarFiscalConfig('#fiscal-config-form-area-avancadas');
        return;
    }

    const carregarFiscalLazy = async () => {
        try {
            if (window.CdsErpLazyLoader?.loadFeatureScript) {
                await window.CdsErpLazyLoader.loadFeatureScript('/erp/js/fiscal.js');
            }
            if (typeof carregarFiscalConfig === 'function') {
                carregarFiscalConfig('#fiscal-config-form-area-avancadas');
                return;
            }
        } catch (err) {
            console.error('[Config] Falha ao carregar módulo fiscal:', err);
        }
        $form.html(`
            <div class="alert alert-warning mb-0">
                Não foi possível carregar o módulo fiscal. Recarregue a página ou acesse novamente Configurações.
            </div>
        `);
    };

    void carregarFiscalLazy();
}

function configurarFormConfigAvancadas() {
    const $form = $('#formConfigAvancadas');

    $form.off('submit.configAvancadas').on('submit.configAvancadas', function (event) {
        event.preventDefault();
        return false;
    });
}

function manterTelaConfiguracoesAvancadas() {
    if (typeof currentPage !== 'undefined') {
        currentPage = 'configuracoes-avancadas';
    }

    $('.nav-link').removeClass('active');
    $('.nav-link[data-page="configuracoes-avancadas"]').addClass('active');
}

function obterTipoImplantacaoSelecionado() {
    return String($('input[name="tipoImplantacao"]:checked').val() || 'ERP_SEM_FISCAL').toUpperCase();
}

function aplicarEstadoFormConfigAvancadas() {
    const tipo = obterTipoImplantacaoSelecionado();
    const modo = String($('input[name="modoOperacao"]:checked').val() || 'LOCAL').toUpperCase();
    const clienteDisponivel = tipo === 'ERP_MULTICAIXA';

    $('#modoClienteServidor').prop('disabled', !clienteDisponivel);

    if (!clienteDisponivel && modo === 'CLIENTE_SERVIDOR') {
        $('#modoLocal').prop('checked', true);
    }

    const modoAtual = String($('input[name="modoOperacao"]:checked').val() || 'LOCAL').toUpperCase();
    const exigeIp = modoAtual === 'CLIENTE_SERVIDOR';
    $('#containerIpServidor').toggle(exigeIp);
    $('#cfgIpServidor').prop('required', exigeIp);

    aplicarEstadoBotaoVoltarLocal();
    carregarConfigFiscalAvancadas();
}

async function sincronizarRedeEstacaoConfigAvancadas() {
    const temElectron = Boolean(window.electronAPI?.obterModoEstacao);
    if (!temElectron) {
        return;
    }

    const modoCliente = await estacaoConectadaServidorRemoto();
    if (!modoCliente) {
        $('#bannerEstacaoClienteRemoto').empty();
        $('input[name="modoOperacao"]').prop('disabled', false);
        $('#cfgIpServidor, #cfgPorta').prop('readonly', false);
        await aplicarEstadoBotaoVoltarLocal();
        return;
    }

    const estacao = await obterEstadoRedeEstacaoLocal();
    const destino = estacao.ipServidor
        ? `${estacao.ipServidor}:${estacao.porta || 3001}`
        : (typeof window.electronAPI.obterServidorRemoto === 'function'
            ? (window.electronAPI.obterServidorRemoto() || '-')
            : '-');

    $('#bannerEstacaoClienteRemoto').html(`
        <div class="alert alert-info mb-3">
            <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                <div>
                    <strong><i class="fas fa-plug"></i> Esta estação está conectada ao servidor remoto</strong>
                    <div class="small mb-0 mt-1">Destino: <strong>${escapeHtml(destino)}</strong></div>
                    <div class="small text-muted mb-0">O modo abaixo é do servidor remoto. Para desconectar este terminal, use o botão ao lado.</div>
                </div>
                <button type="button" class="btn btn-primary btn-sm" onclick="voltarServidorLocalEstacao()">
                    <i class="fas fa-home"></i> Voltar ao servidor local
                </button>
            </div>
        </div>
    `);

    $('input[name="modoOperacao"]').prop('disabled', true);
    $('#cfgIpServidor, #cfgPorta').prop('readonly', true);
    await aplicarEstadoBotaoVoltarLocal();
}

async function salvarConfiguracoesAvancadas() {
    if (!isSuperAdminUser()) {
        showNotification('Acesso negado.', 'danger');
        return;
    }

    const tipoImplantacao = obterTipoImplantacaoSelecionado();
    const modoOperacao = String($('input[name="modoOperacao"]:checked').val() || 'LOCAL').toUpperCase();
    const modoConfirmacaoFiscal = String($('input[name="modoConfirmacaoFiscal"]:checked').val() || 'TEF').toUpperCase();
    const ipServidor = $('#cfgIpServidor').val().trim();
    const porta = Number($('#cfgPorta').val()) || 3001;
    const estacaoCliente = await estacaoConectadaServidorRemoto();

    if (!estacaoCliente) {
        if (modoOperacao === 'CLIENTE_SERVIDOR' && !ipServidor) {
            showNotification('Informe o IP do servidor para o modo Cliente/Servidor.', 'warning');
            return;
        }

        if (modoOperacao === 'CLIENTE_SERVIDOR' && (!Number.isInteger(porta) || porta <= 0)) {
            showNotification('Informe uma porta válida.', 'warning');
            return;
        }
    }

    try {
        const servidorAtual = window.configuracaoAvancadaServidor || {};
        const body = {
            tipoImplantacao,
            modo_confirmacao_fiscal: modoConfirmacaoFiscal,
            porta,
            habilitar_vendas_entrega: $('#cfgHabilitarVendasEntrega').length
                ? $('#cfgHabilitarVendasEntrega').is(':checked')
                : !!(servidorAtual.habilitar_vendas_entrega || (servidorAtual.recursos && servidorAtual.recursos.vendasEntrega)),
            habilitar_expedicao: $('#cfgHabilitarFaturamento').length
                ? $('#cfgHabilitarFaturamento').is(':checked')
                : !!(servidorAtual.habilitar_expedicao
                    || servidorAtual.habilitar_faturamento
                    || (servidorAtual.recursos && (servidorAtual.recursos.expedicao || servidorAtual.recursos.faturamento))),
            habilitar_faturamento: $('#cfgHabilitarFaturamento').length
                ? $('#cfgHabilitarFaturamento').is(':checked')
                : !!(servidorAtual.habilitar_expedicao
                    || servidorAtual.habilitar_faturamento
                    || (servidorAtual.recursos && (servidorAtual.recursos.expedicao || servidorAtual.recursos.faturamento))),
            modulo_pdv: $('#cfgModuloPdv').length ? $('#cfgModuloPdv').is(':checked') : (servidorAtual.modulo_pdv !== false),
            modulo_historico_vendas: $('#cfgModuloHistoricoVendas').length
                ? $('#cfgModuloHistoricoVendas').is(':checked')
                : (servidorAtual.modulo_historico_vendas != null
                    ? !!servidorAtual.modulo_historico_vendas
                    : (servidorAtual.recursos && servidorAtual.recursos.historicoVendas) !== false),
            modulo_pedidos: $('#cfgModuloPedidos').length ? $('#cfgModuloPedidos').is(':checked') : !!servidorAtual.modulo_pedidos,
            modulo_nfe: $('#cfgModuloNfe').length ? $('#cfgModuloNfe').is(':checked') : (servidorAtual.modulo_nfe !== false),
            modulo_nfce: $('#cfgModuloNfce').length ? $('#cfgModuloNfce').is(':checked') : (servidorAtual.modulo_nfce !== false),
            modulo_compra_facil: $('#cfgModuloCompraFacil').length ? $('#cfgModuloCompraFacil').is(':checked') : !!servidorAtual.modulo_compra_facil,
            modulo_marketplace: $('#cfgModuloMarketplace').length ? $('#cfgModuloMarketplace').is(':checked') : !!servidorAtual.modulo_marketplace,
            modulo_crm: $('#cfgModuloCrm').length ? $('#cfgModuloCrm').is(':checked') : !!servidorAtual.modulo_crm,
            licenca_dias_aviso: Number($('#cfgLicencaDiasAviso').val() || servidorAtual.licenca_dias_aviso || 3),
            licenca_chave_pix: $('#cfgLicencaChavePix').length
                ? String($('#cfgLicencaChavePix').val() || '').trim()
                : String(servidorAtual.licenca_chave_pix || ''),
            licenca_whatsapp_url: $('#cfgLicencaWhatsapp').length
                ? String($('#cfgLicencaWhatsapp').val() || '').trim()
                : String(servidorAtual.licenca_whatsapp_url || ''),
            licenca_mensagem_renovacao: $('#cfgLicencaMensagem').length
                ? String($('#cfgLicencaMensagem').val() || '').trim()
                : String(servidorAtual.licenca_mensagem_renovacao || ''),
            licenca_plano: $('#cfgLicencaPlano').length
                ? String($('#cfgLicencaPlano').val() || '').trim()
                : String(servidorAtual.licenca_plano || ''),
            ativar_midp: $('#cfgAtivarMidp').length
                ? $('#cfgAtivarMidp').is(':checked')
                : !!servidorAtual.ativar_midp,
            imprimir_comprovante_entrega: $('#cfgImpComprovanteEntrega').length
                ? $('#cfgImpComprovanteEntrega').is(':checked')
                : servidorAtual.imprimir_comprovante_entrega !== false,
            imprimir_comprovante_prestacao: $('#cfgImpComprovantePrestacao').length
                ? $('#cfgImpComprovantePrestacao').is(':checked')
                : servidorAtual.imprimir_comprovante_prestacao !== false,
            imprimir_danfe_nfce_entrega: $('#cfgImpDanfeEntrega').length
                ? $('#cfgImpDanfeEntrega').is(':checked')
                : servidorAtual.imprimir_danfe_nfce_entrega !== false,
            imprimir_cupom_nao_fiscal_entrega: $('#cfgImpCupomNaoFiscalEntrega').length
                ? $('#cfgImpCupomNaoFiscalEntrega').is(':checked')
                : !!servidorAtual.imprimir_cupom_nao_fiscal_entrega,
            entrega_alerta_horas_aguardando: Number($('#cfgAlertaAguardando').val() || servidorAtual.entrega_alerta_horas_aguardando || 2),
            entrega_alerta_horas_reserva: Number($('#cfgAlertaReserva').val() || servidorAtual.entrega_alerta_horas_reserva || 4),
            entrega_alerta_horas_parado: Number($('#cfgAlertaParado').val() || servidorAtual.entrega_alerta_horas_parado || 3),
            modoOperacao: estacaoCliente
                ? String(servidorAtual.modoOperacao || 'LOCAL').toUpperCase()
                : modoOperacao,
            ipServidor: estacaoCliente
                ? String(servidorAtual.ipServidor || '')
                : (modoOperacao === 'CLIENTE_SERVIDOR' ? ipServidor : '')
        };

        const response = await fetch(`${API_URL}/configuracoes-avancadas`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(body)
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const detalhes = Array.isArray(data.details) ? data.details.join(' ') : (data.error || 'Erro ao salvar.');
            throw new Error(detalhes);
        }

        showNotification(data.message || 'Configurações salvas com sucesso.', 'success');

        if (typeof carregarConfiguracaoImplantacao === 'function') {
            await carregarConfiguracaoImplantacao();
        }

        renderConfiguracoesAvancadas(data.config || {});
        manterTelaConfiguracoesAvancadas();
        carregarStatusPixAutomatico();
        if (typeof atualizarPainelExecutivoCentroCfg === 'function') {
            atualizarPainelExecutivoCentroCfg();
        }
    } catch (err) {
        console.error(err);
        showNotification(err.message || 'Erro ao salvar configurações.', 'danger');
    }
}

$(document).on('change', 'input[name="tipoImplantacao"], input[name="modoOperacao"]', aplicarEstadoFormConfigAvancadas);

async function salvarPadraoFiscalEmpresa() {
    if (!isSuperAdminUser()) {
        showNotification('Acesso negado.', 'danger');
        return;
    }

    const payload = {
        cfop_padrao: ($('#padraoCfop').val() || '').trim(),
        csosn_padrao: ($('#padraoCsosn').val() || '').trim(),
        origem_padrao: ($('#padraoOrigem').val() || '').trim(),
        cest_padrao: ($('#padraoCest').val() || '').trim(),
        entrada_bonificacao_cfop_padrao: ($('#bonifCfopPadrao').val() || '5910').trim(),
        entrada_bonificacao_csosn_padrao: ($('#bonifCsosnPadrao').val() || '').trim(),
        entrada_bonificacao_natureza: ($('#bonifNatureza').val() || 'Bonificação recebida').trim(),
        entrada_bonificacao_atualizar_custo: $('#bonifAtualizarCusto').is(':checked'),
        entrada_bonificacao_gerar_estoque: $('#bonifGerarEstoque').is(':checked')
    };

    try {
        const response = await fetch(`${API_URL}/configuracoes-avancadas/padrao-fiscal`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao salvar padrão fiscal.');
        }

        showNotification(data.message || 'Padrão Fiscal da Empresa atualizado com sucesso.', 'success');

        const padrao = data.padrao_fiscal || payload;
        $('#padraoCfop').val(padrao.cfop_padrao || '');
        $('#padraoCsosn').val(padrao.csosn_padrao || '');
        $('#padraoOrigem').val(padrao.origem_padrao || '');
        $('#padraoCest').val(padrao.cest_padrao || '');
        if ($('#bonifCfopPadrao').length) {
            $('#bonifCfopPadrao').val(padrao.entrada_bonificacao_cfop_padrao || '5910');
            $('#bonifCsosnPadrao').val(padrao.entrada_bonificacao_csosn_padrao || '');
            $('#bonifNatureza').val(padrao.entrada_bonificacao_natureza || 'Bonificação recebida');
            $('#bonifGerarEstoque').prop('checked', padrao.entrada_bonificacao_gerar_estoque !== false);
            $('#bonifAtualizarCusto').prop('checked', padrao.entrada_bonificacao_atualizar_custo === true);
        }
    } catch (err) {
        console.error(err);
        showNotification(err.message || 'Erro ao salvar padrão fiscal.', 'danger');
    }
}
window.salvarPadraoFiscalEmpresa = salvarPadraoFiscalEmpresa;
window.setupBackupManualListener = setupBackupManualListener;
window.carregarPastaBackup = carregarPastaBackup;

function limparCache() {
    try {
        const token = localStorage.getItem('token');
        const user = localStorage.getItem('user');
        const keysKeep = new Set(['token', 'user']);
        const backup = {};
        for (let i = 0; i < localStorage.length; i += 1) {
            const k = localStorage.key(i);
            if (keysKeep.has(k)) backup[k] = localStorage.getItem(k);
        }
        localStorage.clear();
        Object.keys(backup).forEach((k) => localStorage.setItem(k, backup[k]));
        if (token) localStorage.setItem('token', token);
        if (user) localStorage.setItem('user', user);
        showNotification('Cache local limpo (sessão preservada).', 'success');
    } catch (err) {
        showNotification(err.message || 'Não foi possível limpar o cache.', 'danger');
    }
}
window.limparCache = limparCache;