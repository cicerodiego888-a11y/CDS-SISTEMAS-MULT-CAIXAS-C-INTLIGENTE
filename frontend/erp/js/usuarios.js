/**
 * Módulo Usuários — gestão via /api/auth/usuarios
 */

function getUsernameLogadoUsuarios() {
    try {
        return (typeof obterUsuarioLogado === 'function' ? obterUsuarioLogado() : {}).username || '';
    } catch (e) {
        return '';
    }
}

function getPerfilLogadoUsuarios() {
    try {
        const u = typeof obterUsuarioLogado === 'function' ? obterUsuarioLogado() : {};
        return String(u.perfil || '').trim().toUpperCase();
    } catch (e) {
        return '';
    }
}

function logadoEhSuperAdminUsuarios() {
    return getPerfilLogadoUsuarios() === 'SUPER_ADMIN';
}

function escapeHtmlUsuarios(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

function renderLinhaUsuario(u, inativo = false) {
    const perfil = String(u.perfil || 'USUARIO').toUpperCase();

    // Defesa de UI: ADMIN nunca lista/age sobre SUPER_ADMIN (backend já filtra).
    if (perfil === 'SUPER_ADMIN' && !logadoEhSuperAdminUsuarios()) {
        return '';
    }

    let badgePerfil = 'bg-secondary';
    let labelPerfil = 'Usuário';
    if (perfil === 'SUPER_ADMIN') {
        badgePerfil = 'bg-dark';
        labelPerfil = 'SUPER ADMIN';
    } else if (perfil === 'ADMIN') {
        badgePerfil = 'bg-danger';
        labelPerfil = 'ADMIN';
    }

    let acoes = '';
    if (podeGerenciarUsuariosSistema()) {
        acoes = u.username === getUsernameLogadoUsuarios()
            ? '<span class="text-muted small">você</span>'
            : (inativo
                ? `
                <button type="button" class="btn btn-sm btn-outline-success me-1" onclick="reativarUsuario(${u.id})" title="Reativar">
                    <i class="fas fa-user-check"></i>
                </button>
                <button type="button" class="btn btn-sm btn-outline-info me-1" onclick="abrirRelatorioUsuario(${u.id})" title="Relatório">
                    <i class="fas fa-chart-bar"></i>
                </button>
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="removerUsuario(${u.id})" title="Excluir permanentemente">
                    <i class="fas fa-trash"></i>
                </button>
            `
                : `
                <button type="button" class="btn btn-sm btn-outline-primary me-1" onclick='showModalNovoUsuario(${JSON.stringify(u)})' title="Editar">
                    <i class="fas fa-edit"></i>
                </button>
                <button type="button" class="btn btn-sm btn-outline-info me-1" onclick="abrirRelatorioUsuario(${u.id})" title="Relatório">
                    <i class="fas fa-chart-bar"></i>
                </button>
                <button type="button" class="btn btn-sm btn-outline-warning me-1" onclick="desativarUsuario(${u.id})" title="Desativar">
                    <i class="fas fa-user-slash"></i>
                </button>
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="removerUsuario(${u.id})" title="Excluir permanentemente">
                    <i class="fas fa-trash"></i>
                </button>
            `);
    }

    return `
        <tr>
            <td>${escapeHtmlUsuarios(u.username)}</td>
            <td><span class="badge ${badgePerfil}">${labelPerfil}</span></td>
            <td>${obterBadgePermissao(u.perfil)}</td>
            <td>${u.created_at ? formatDateTime(u.created_at) : '-'}</td>
            <td class="text-nowrap">${acoes}</td>
        </tr>
    `;
}

function loadUsuarios() {
    if (!podeGerenciarUsuariosSistema()) {
        $('#page-content').html('<div class="alert alert-warning">Você não tem permissão para gerenciar usuários.</div>');
        return;
    }

    $.when(
        $.get(`${API_URL}/auth/usuarios`),
        $.get(`${API_URL}/auth/usuarios?status=inativos`)
    ).done(function (ativosResp, inativosResp) {
        const usuarios = ativosResp[0] || [];
        const usuariosInativos = inativosResp[0] || [];
        renderUsuarios(usuarios, usuariosInativos);
    }).fail(function () {
        $('#page-content').html('<div class="alert alert-danger">Erro ao carregar usuários!</div>');
    });
}

function renderUsuarios(usuarios, usuariosInativos) {
    const qtdAtivos = usuarios.length;
    const qtdInativos = usuariosInativos.length;
    const dicaFechada = localStorage.getItem('usuarios-dica-seguranca-fechada') === '1';

    const botaoNovo = podeGerenciarUsuariosSistema()
        ? `<button type="button" class="btn btn-primary" onclick="showModalNovoUsuario()">
                <i class="fas fa-user-plus"></i> Novo usuário
           </button>`
        : '';

    const html = `
        <div class="usuarios-page">
            <div class="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-4">
                <div>
                    <h4 class="mb-1"><i class="fas fa-user-shield text-primary"></i> Usuários do Sistema</h4>
                    <p class="text-muted mb-0">Gerencie logins, perfis e permissões de acesso ao ERP e PDV.</p>
                </div>
                ${botaoNovo}
            </div>

            <div class="row g-3 mb-4">
                <div class="col-md-4">
                    <div class="card shadow-sm h-100">
                        <div class="card-body">
                            <div class="text-muted small">Usuários ativos</div>
                            <div class="display-6 fw-bold text-primary">${qtdAtivos}</div>
                        </div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card shadow-sm h-100">
                        <div class="card-body">
                            <div class="text-muted small">Usuários desativados</div>
                            <div class="display-6 fw-bold">${qtdInativos}</div>
                        </div>
                    </div>
                </div>
                <div class="col-md-4">
                    ${dicaFechada ? '' : `
                    <div class="card shadow-sm h-100 border-info" id="card-dica-seguranca-usuarios">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-start gap-2">
                                <div>
                                    <div class="fw-semibold small mb-1">Dica de segurança</div>
                                    <p class="small text-muted mb-0">
                                        Operadores sem permissão específica precisam de senha de administrador para abrir caixa, sangria e suprimento.
                                    </p>
                                </div>
                                <button type="button" class="btn btn-sm btn-outline-secondary" onclick="fecharDicaSegurancaUsuarios()">Fechar</button>
                            </div>
                        </div>
                    </div>
                    `}
                </div>
            </div>

            <div class="card shadow-sm mb-4">
                <div class="card-header bg-white fw-semibold">
                    <i class="fas fa-users"></i> Usuários ativos
                </div>
                <div class="card-body">
                    <p class="text-muted small">
                        Desativar bloqueia o login, mas mantém o histórico — o usuário pode ser reativado depois.
                        Excluir remove o cadastro permanentemente do sistema.
                    </p>
                    <div class="table-responsive">
                        <table id="usuariosTable" class="table table-hover align-middle mb-0">
                            <thead class="table-light">
                                <tr>
                                    <th>Usuário</th>
                                    <th>Perfil</th>
                                    <th>Permissões</th>
                                    <th>Cadastro</th>
                                    <th>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${usuarios.length ? usuarios.map(u => renderLinhaUsuario(u, false)).join('') : '<tr><td colspan="5" class="text-muted text-center py-4">Nenhum usuário ativo.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            ${usuariosInativos && usuariosInativos.length ? `
            <div class="card shadow-sm">
                <div class="card-header bg-white fw-semibold text-muted">
                    <i class="fas fa-user-slash"></i> Usuários desativados
                </div>
                <div class="card-body">
                    <div class="table-responsive">
                        <table id="usuariosInativosTable" class="table table-hover align-middle mb-0">
                            <thead class="table-light">
                                <tr>
                                    <th>Usuário</th>
                                    <th>Perfil</th>
                                    <th>Permissões</th>
                                    <th>Cadastro</th>
                                    <th>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${usuariosInativos.map(u => renderLinhaUsuario(u, true)).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            ` : ''}
        </div>
    `;

    $('#page-content').html(html);
}

function fecharDicaSegurancaUsuarios() {
    localStorage.setItem('usuarios-dica-seguranca-fechada', '1');
    $('#card-dica-seguranca-usuarios').fadeOut(200);
}

async function showModalNovoUsuario(usuario = null) {
    if (!podeGerenciarUsuariosSistema()) {
        showNotification('Você não tem permissão para gerenciar usuários.', 'warning');
        return;
    }

    const editando = !!usuario;
    const permissoesUsuario = usuario?.permissoes || [];

    let permissoesLista = null;
    try {
        const resp = await fetch(`${API_URL}/auth/permissoes-disponiveis`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (resp.ok) {
            const data = await resp.json();
            permissoesLista = Array.isArray(data) ? data : null;
        }
    } catch (e) {
        console.warn('Não foi possível obter permissões do servidor, usando fallback.');
    }

    const labelMap = {
        pdv: 'PDV', vendas: 'Vendas', produtos: 'Produtos', clientes: 'Clientes', compras: 'Compras',
        fornecedores: 'Fornecedores', financeiro: 'Financeiro', caixa: 'Caixa',
        abrir_caixa: 'Abrir caixa', sangria_caixa: 'Sangria', suprimento_caixa: 'Adicionar dinheiro (suprimento)', fechar_caixa: 'Fechar caixa',
        fiscal: 'Fiscal', configuracoes: 'Configurações', usuarios: 'Usuários', relatorios: 'Relatórios',
        categorias: 'Categorias', auditoria: 'Auditoria', gerenciar_faixa_atacado: 'Gerenciar Faixa Atacado',
        entrega_visualizar: 'Entrega — Visualizar',
        entrega_criar: 'Entrega — Criar',
        entrega_prestacao: 'Entrega — Prestação de Contas',
        entrega_cancelar: 'Entrega — Cancelar',
        entrega_reabrir: 'Entrega — Reabrir',
        entrega_alterar_pagamento: 'Entrega — Alterar Pagamento'
    };

    const fallback = Object.entries(labelMap).map(([k, v]) => [k, v]);

    const permissoesDisponiveis = (permissoesLista || []).length
        ? permissoesLista.map(p => [p, labelMap[p] || (p.charAt(0).toUpperCase() + p.slice(1))])
        : fallback;

    const modalHtml = `
        <div class="modal fade" id="novoUsuarioModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${editando ? 'Editar usuário' : 'Novo usuário'}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body">
                        <input type="hidden" id="usuario_id_edicao" value="${editando ? usuario.id : ''}">

                        <div class="mb-3">
                            <label class="form-label">Nome de usuário</label>
                            <input 
                                type="text" 
                                class="form-control" 
                                id="novo_usuario_login" 
                                value="${editando ? escapeHtmlUsuarios(usuario.username) : ''}"
                                ${editando ? 'disabled' : ''}
                            >
                        </div>

                        <div class="mb-3">
                            <label class="form-label">
                                Senha ${editando ? '<small class="text-muted">(deixe vazio para não alterar)</small>' : ''}
                            </label>
                            <input type="password" class="form-control" id="novo_usuario_senha" autocomplete="new-password">
                        </div>

                        <div class="mb-3">
                            <label class="form-label">Tipo de Acesso (role)</label>
                            <select class="form-control" id="novo_usuario_role" onchange="togglePermissoesUsuario()">
                                <option value="operador" ${usuario?.role === 'operador' ? 'selected' : ''}>Operador</option>
                                <option value="admin" ${usuario?.role === 'admin' ? 'selected' : ''}>Administrador</option>
                            </select>
                        </div>

                        <div class="mb-3">
                            <label class="form-label">Perfil de Permissão</label>
                            <select class="form-control" id="novo_usuario_perfil">
                                <option value="USUARIO" ${(usuario?.perfil || 'USUARIO') === 'USUARIO' ? 'selected' : ''}>Usuário Comum</option>
                                <option value="ADMIN" ${usuario?.perfil === 'ADMIN' ? 'selected' : ''}>Administrador (ADMIN)</option>
                                ${logadoEhSuperAdminUsuarios() ? `
                                <option value="SUPER_ADMIN" ${usuario?.perfil === 'SUPER_ADMIN' ? 'selected' : ''}>Super Administrador</option>
                                ` : ''}
                            </select>
                            <small class="text-muted">
                                ${logadoEhSuperAdminUsuarios()
        ? 'SUPER_ADMIN: pode tudo | ADMIN: pode gerenciar usuários comuns | USUARIO: acesso limitado'
        : 'ADMIN: pode gerenciar usuários comuns | USUARIO: acesso limitado'}
                            </small>
                        </div>

                        <div class="mb-3" id="boxPodeAlterarSenhas">
                            <label class="form-check">
                                <input 
                                    type="checkbox" 
                                    class="form-check-input" 
                                    id="novo_usuario_pode_alterar_senhas"
                                    ${usuario?.pode_alterar_senhas ? 'checked' : ''}
                                >
                                <span class="form-check-label">
                                    Pode alterar senhas de outros usuários
                                </span>
                            </label>
                            <small class="text-muted d-block">
                                Apenas ADMINs com esta permissão podem alterar senhas de USUARIOs comuns
                            </small>
                        </div>

                        <div id="boxPermissoesUsuario">
                            <label class="form-label fw-bold">Permissões do operador</label>

                            <div class="row">
                                ${permissoesDisponiveis.map(([valor, label]) => `
                                    <div class="col-md-4 mb-2">
                                        <label class="form-check">
                                            <input 
                                                type="checkbox" 
                                                class="form-check-input permissao-usuario" 
                                                value="${valor}"
                                                ${permissoesUsuario.includes(valor) ? 'checked' : ''}
                                            >
                                            <span class="form-check-label">${label}</span>
                                        </label>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <div id="novo-usuario-erro" class="alert alert-danger py-2 d-none"></div>
                    </div>

                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="salvarNovoUsuario()">
                            ${editando ? 'Salvar alterações' : 'Cadastrar'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (typeof limparModaisTravados === 'function') {
        limparModaisTravados();
    }

    $('#modal-container').html(modalHtml);
    $('#novoUsuarioModal').modal('show');
    togglePermissoesUsuario();
}

function salvarNovoUsuario() {
    if (!podeGerenciarUsuariosSistema()) {
        showNotification('Você não tem permissão para gerenciar usuários.', 'warning');
        return;
    }

    const id = $('#usuario_id_edicao').val();
    const username = $('#novo_usuario_login').val().trim();
    const password = $('#novo_usuario_senha').val();
    const role = $('#novo_usuario_role').val();
    let perfil = $('#novo_usuario_perfil').val() || 'USUARIO';
    const podeAlterarSenhas = $('#novo_usuario_pode_alterar_senhas').is(':checked') ? 1 : 0;

    // ADMIN não pode criar/definir SUPER_ADMIN pela UI
    if (String(perfil).toUpperCase() === 'SUPER_ADMIN' && !logadoEhSuperAdminUsuarios()) {
        perfil = 'ADMIN';
    }

    const permissoes = $('.permissao-usuario:checked')
        .map(function () {
            return $(this).val();
        })
        .get();

    const $err = $('#novo-usuario-erro');
    $err.addClass('d-none').text('');

    if (!id && (!username || !password)) {
        $err.removeClass('d-none').text('Preencha usuário e senha.');
        return;
    }

    const payload = {
        username,
        password,
        role,
        perfil,
        pode_alterar_senhas: podeAlterarSenhas,
        permissoes
    };

    $.ajax({
        url: id ? `${API_URL}/auth/usuarios/${id}` : `${API_URL}/auth/usuarios`,
        method: id ? 'PUT' : 'POST',
        contentType: 'application/json',
        data: JSON.stringify(payload),
        success: function () {
            $('#novoUsuarioModal').modal('hide');
            showNotification(id ? 'Usuário atualizado com sucesso!' : 'Usuário cadastrado com sucesso!');
            loadUsuarios();
        },
        error: function (xhr) {
            $err.removeClass('d-none').text(
                xhr.responseJSON && xhr.responseJSON.error
                    ? xhr.responseJSON.error
                    : 'Erro ao salvar usuário.'
            );
        }
    });
}

function togglePermissoesUsuario() {
    const role = $('#novo_usuario_role').val();

    if (role === 'admin') {
        $('#boxPermissoesUsuario').hide();
    } else {
        $('#boxPermissoesUsuario').show();
    }
}

function obterBadgePermissao(perfil) {
    const p = String(perfil || '').trim().toUpperCase();

    if (p === 'SUPER_ADMIN') {
        return `<span class="badge bg-dark">SUPER ADMIN</span>`;
    }

    if (p === 'ADMIN') {
        return `<span class="badge bg-danger">ADMIN</span>`;
    }

    return `<span class="badge bg-secondary">OPERADOR</span>`;
}

async function carregarUsuarios() {
    if (!podeGerenciarUsuariosSistema()) return;

    try {
        const resposta = await fetch(`${API_URL}/auth/usuarios`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!resposta.ok) {
            throw new Error('Erro ao carregar usuários.');
        }

        const usuarios = await resposta.json();
        renderizarUsuarios(usuarios);
    } catch (erro) {
        console.error('Erro ao carregar usuários:', erro);
    }
}

function renderizarUsuarios(usuarios) {
    const tbody = document.querySelector('#usuariosTable tbody');
    if (!tbody) return;
    tbody.innerHTML = usuarios.map(u => renderLinhaUsuario(u, false)).join('');
}

async function desativarUsuario(id) {
    if (!podeGerenciarUsuariosSistema()) {
        showNotification('Você não tem permissão para gerenciar usuários.', 'warning');
        return;
    }
    if (!confirm('Deseja desativar este usuário? Ele não poderá mais fazer login, mas poderá ser reativado depois.')) return;

    try {
        const resposta = await fetch(`${API_URL}/auth/usuarios/${id}/desativar`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        const dados = await resposta.json();

        if (!resposta.ok) {
            alert(dados.erro || dados.error || 'Erro ao desativar usuário.');
            return;
        }

        showNotification(dados.mensagem || 'Usuário desativado com sucesso.', 'success');
        loadUsuarios();
    } catch (erro) {
        console.error('Erro ao desativar usuário:', erro);
        alert('Erro ao desativar usuário.');
    }
}

async function reativarUsuario(id) {
    if (!podeGerenciarUsuariosSistema()) {
        showNotification('Você não tem permissão para gerenciar usuários.', 'warning');
        return;
    }
    if (!confirm('Deseja reativar este usuário?')) return;

    try {
        const resposta = await fetch(`${API_URL}/auth/usuarios/${id}/ativar`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        const dados = await resposta.json();

        if (!resposta.ok) {
            alert(dados.erro || dados.error || 'Erro ao reativar usuário.');
            return;
        }

        showNotification(dados.mensagem || 'Usuário reativado com sucesso.', 'success');
        loadUsuarios();
    } catch (erro) {
        console.error('Erro ao reativar usuário:', erro);
        alert('Erro ao reativar usuário.');
    }
}

async function removerUsuario(id) {
    if (!podeGerenciarUsuariosSistema()) {
        showNotification('Você não tem permissão para gerenciar usuários.', 'warning');
        return;
    }
    if (!confirm('ATENÇÃO: esta ação exclui o usuário permanentemente do sistema. Deseja continuar?')) return;

    try {
        const resposta = await fetch(`${API_URL}/auth/usuarios/${id}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        const dados = await resposta.json();

        if (!resposta.ok) {
            alert(dados.erro || dados.error || 'Erro ao excluir usuário.');
            return;
        }

        showNotification(dados.mensagem || 'Usuário excluído com sucesso.', 'success');
        loadUsuarios();
    } catch (erro) {
        console.error('Erro ao excluir usuário:', erro);
        alert('Erro ao excluir usuário.');
    }
}

function renderCardRelatorioUsuario(label, valor, sub = '') {
    return `
        <div class="col-md-3 col-sm-6">
            <div class="border rounded p-3 h-100 bg-light">
                <div class="text-muted small">${label}</div>
                <div class="fs-5 fw-semibold">${valor}</div>
                ${sub ? `<div class="small text-muted">${sub}</div>` : ''}
            </div>
        </div>
    `;
}

function renderTabelaRelatorioUsuario(colunas, linhas, vazio = 'Sem registros.') {
    if (!linhas || !linhas.length) {
        return `<p class="text-muted small mb-0">${vazio}</p>`;
    }
    return `
        <div class="table-responsive">
            <table class="table table-sm table-striped mb-0">
                <thead><tr>${colunas.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
                <tbody>${linhas.join('')}</tbody>
            </table>
        </div>
    `;
}

async function abrirRelatorioUsuario(usuarioId) {
    if (!podeGerenciarUsuariosSistema()) {
        showNotification('Você não tem permissão para ver relatórios de usuários.', 'warning');
        return;
    }

    const modalHtml = `
        <div class="modal fade" id="relatorioUsuarioModal" tabindex="-1">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title"><i class="fas fa-chart-bar text-info"></i> Relatório do usuário</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" id="relatorio-usuario-conteudo">
                        <div class="text-center py-5 text-muted">
                            <i class="fas fa-spinner fa-spin fa-2x mb-2"></i>
                            <p>Carregando relatório...</p>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (typeof limparModaisTravados === 'function') limparModaisTravados();
    $('#modal-container').html(modalHtml);
    $('#relatorioUsuarioModal').modal('show');

    try {
        const resp = await fetch(`${API_URL}/auth/usuarios/${usuarioId}/relatorio`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        const dados = await resp.json();
        if (!resp.ok) throw new Error(dados.error || 'Erro ao carregar relatório.');

        const v = dados.vendas || {};
        const c = dados.cancelamentos || {};
        const a = dados.autorizacoes || {};
        const cx = dados.caixa || {};
        const ac = dados.acesso || {};

        const linhasVendas = (v.recentes || []).map((item) => `
            <tr>
                <td>#${item.id}${item.codigo ? ` (${escapeHtmlUsuarios(item.codigo)})` : ''}</td>
                <td>${formatCurrency(item.total)}</td>
                <td>${escapeHtmlUsuarios(item.forma_pagamento || '-')}</td>
                <td>${item.data ? formatDateTime(item.data) : '-'}</td>
                <td>${item.cancelada ? '<span class="badge bg-danger">Cancelada</span>' : '<span class="badge bg-success">OK</span>'}</td>
            </tr>
        `);

        const linhasCancelamentos = (c.recentes || []).map((item) => `
            <tr>
                <td>${item.acao === 'devolver_venda' ? 'Devolução' : 'Cancelamento'}</td>
                <td>${item.referencia_id ? `#${item.referencia_id}` : '-'}</td>
                <td>${item.criado_em ? formatDateTime(item.criado_em) : '-'}</td>
                <td class="small">${escapeHtmlUsuarios(item.detalhes?.motivo || item.detalhes?.justificativa || '-')}</td>
            </tr>
        `);

        const linhasAutorizacoes = (a.recentes || []).map((item) => `
            <tr>
                <td>#${item.venda_id}</td>
                <td>${formatCurrency(item.total)}</td>
                <td>${formatCurrency(item.desconto)}</td>
                <td>${item.criado_em ? formatDateTime(item.criado_em) : '-'}</td>
            </tr>
        `);

        const linhasMes = (v.por_mes || []).map((item) => `
            <tr>
                <td>${item.mes}</td>
                <td>${item.quantidade}</td>
                <td>${formatCurrency(item.valor_total)}</td>
            </tr>
        `);

        const linhasAuditoria = (dados.auditoria_resumo || []).map((item) => `
            <tr>
                <td>${escapeHtmlUsuarios(item.acao)}</td>
                <td>${item.total}</td>
            </tr>
        `);

        $('#relatorio-usuario-conteudo').html(`
            <div class="mb-3">
                <h5 class="mb-1">${escapeHtmlUsuarios(dados.usuario?.username || '')}</h5>
                <span class="badge bg-secondary me-1">${escapeHtmlUsuarios(dados.usuario?.perfil || '')}</span>
                <span class="text-muted small">Cadastro: ${dados.usuario?.created_at ? formatDateTime(dados.usuario.created_at) : '-'}</span>
                ${ac.ultimo_login ? `<span class="text-muted small ms-2">Último login: ${formatDateTime(ac.ultimo_login)}</span>` : ''}
            </div>

            <h6 class="fw-semibold mb-3">Vendas</h6>
            <div class="row g-3 mb-4">
                ${renderCardRelatorioUsuario('Hoje', formatCurrency(v.dia?.valor_total || 0), `${v.dia?.quantidade || 0} venda(s)`)}
                ${renderCardRelatorioUsuario('Este mês', formatCurrency(v.mes?.valor_total || 0), `${v.mes?.quantidade || 0} venda(s)`)}
                ${renderCardRelatorioUsuario('Este ano', formatCurrency(v.ano?.valor_total || 0), `${v.ano?.quantidade || 0} venda(s)`)}
                ${renderCardRelatorioUsuario('Descontos no mês', formatCurrency(v.mes?.desconto_total || 0))}
            </div>

            <h6 class="fw-semibold mb-3">Cancelamentos, devoluções e autorizações</h6>
            <div class="row g-3 mb-4">
                ${renderCardRelatorioUsuario('Cancelamentos', c.via_auditoria || 0, `${formatCurrency(c.valor_cancelado || 0)} cancelados`)}
                ${renderCardRelatorioUsuario('Devoluções', dados.devolucoes?.total || 0)}
                ${renderCardRelatorioUsuario('Descontos autorizados', a.descontos_concedidos || 0, formatCurrency(a.valor_descontos || 0))}
                ${renderCardRelatorioUsuario('Logins registrados', ac.logins || 0)}
            </div>

            <h6 class="fw-semibold mb-3">Caixa</h6>
            <div class="row g-3 mb-4">
                ${renderCardRelatorioUsuario('Sangrias', cx.sangrias?.quantidade || 0, formatCurrency(cx.sangrias?.valor || 0))}
                ${renderCardRelatorioUsuario('Suprimentos', cx.suprimentos?.quantidade || 0, formatCurrency(cx.suprimentos?.valor || 0))}
                ${renderCardRelatorioUsuario('Sessões de caixa', cx.sessoes || 0)}
                ${renderCardRelatorioUsuario('Fechamentos', cx.fechamentos || 0)}
            </div>

            <div class="row g-4">
                <div class="col-lg-6">
                    <h6 class="fw-semibold">Vendas por mês (12 meses)</h6>
                    ${renderTabelaRelatorioUsuario(['Mês', 'Qtd', 'Total'], linhasMes)}
                </div>
                <div class="col-lg-6">
                    <h6 class="fw-semibold">Resumo de ações (auditoria)</h6>
                    ${renderTabelaRelatorioUsuario(['Ação', 'Total'], linhasAuditoria)}
                </div>
                <div class="col-lg-6">
                    <h6 class="fw-semibold">Últimas vendas</h6>
                    ${renderTabelaRelatorioUsuario(['Venda', 'Total', 'Pagamento', 'Data', 'Status'], linhasVendas)}
                </div>
                <div class="col-lg-6">
                    <h6 class="fw-semibold">Cancelamentos e devoluções recentes</h6>
                    ${renderTabelaRelatorioUsuario(['Tipo', 'Ref.', 'Data', 'Motivo'], linhasCancelamentos)}
                </div>
                <div class="col-12">
                    <h6 class="fw-semibold">Autorizações de desconto recentes</h6>
                    ${renderTabelaRelatorioUsuario(['Venda', 'Total', 'Desconto', 'Data'], linhasAutorizacoes, 'Nenhuma autorização de desconto registrada.')}
                </div>
            </div>
        `);
    } catch (erro) {
        $('#relatorio-usuario-conteudo').html(`<div class="alert alert-danger">${escapeHtmlUsuarios(erro.message || 'Erro ao carregar relatório.')}</div>`);
    }
}

window.fecharDicaSegurancaUsuarios = fecharDicaSegurancaUsuarios;
window.abrirRelatorioUsuario = abrirRelatorioUsuario;
