/**
 * Controle do modo Fiscal / Não Fiscal
 * Modelo: quem controla (Operador | Administrador) + escopo admin (Todos | Individual)
 */

function loadF12Admin() {
    if (typeof F12PolicyResolver === 'undefined') {
        $('#page-content').html(`
            <div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle"></i>
                F12PolicyResolver não carregado. Recarregue a página.
            </div>
        `);
        return;
    }

    renderF12AdminPage();
}

async function renderF12AdminPage() {
    try {
        const info = await F12PolicyResolver.obterInfo();
        const caixas = await F12PolicyResolver.listarCaixas();
        const controle = info.controle || 'OPERADOR';
        const escopo = info.escopo || null;

        const html = `
            <div class="card mb-3 border-0 shadow-sm">
                <div class="card-body py-3">
                    <h4 class="mb-1">
                        <i class="fas fa-toggle-on text-primary"></i> Controle do modo Fiscal
                    </h4>
                    <p class="text-muted small mb-0">
                        Defina quem pode alterar o modo Fiscal / Não Fiscal e como o administrador aplica essa configuração.
                    </p>
                </div>
            </div>

            <div class="card mb-3">
                <div class="card-header">
                    Quem pode alterar o modo Fiscal / Não Fiscal?
                </div>
                <div class="card-body">
                    <label class="d-block mb-3">
                        <input type="radio" name="f12_controle" value="OPERADOR"
                            ${controle === 'OPERADOR' ? 'checked' : ''}
                            onchange="mudarControleF12('OPERADOR')">
                        <strong>Operador do Caixa</strong>
                        <small class="d-block text-muted ms-4 mt-1">
                            Cada caixa pode alterar seu próprio modo utilizando F12.
                        </small>
                    </label>
                    <label class="d-block">
                        <input type="radio" name="f12_controle" value="ADMINISTRADOR"
                            ${controle === 'ADMINISTRADOR' ? 'checked' : ''}
                            onchange="mudarControleF12('ADMINISTRADOR')">
                        <strong>Somente Administrador</strong>
                        <small class="d-block text-muted ms-4 mt-1">
                            Apenas administradores podem alterar a configuração.
                        </small>
                    </label>
                </div>
            </div>

            ${controle === 'ADMINISTRADOR' ? renderEscopoAdminF12(escopo, info, caixas) : renderOperadorF12Hint()}
        `;

        $('#page-content').html(html);
    } catch (err) {
        console.error('Erro ao carregar F12 Admin:', err);
        $('#page-content').html(`
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-circle"></i>
                Erro ao carregar configuração: ${err.message}
            </div>
        `);
    }
}

function renderOperadorF12Hint() {
    return `
        <div class="card mb-3" style="background-color: #f0f7ff; border-color: #4a90e2;">
            <div class="card-body">
                <p class="text-muted mb-0">
                    <i class="fas fa-info-circle text-info"></i>
                    Cada operador altera somente o caixa em que está operando, pela tecla F12.
                </p>
            </div>
        </div>
    `;
}

function renderEscopoAdminF12(escopo, info, caixas) {
    const escopoAtual = escopo === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'TODOS';
    return `
        <div class="card mb-3">
            <div class="card-header">
                Como deseja aplicar?
            </div>
            <div class="card-body">
                <label class="d-block mb-3">
                    <input type="radio" name="f12_escopo" value="TODOS"
                        ${escopoAtual === 'TODOS' ? 'checked' : ''}
                        onchange="mudarEscopoAdminF12('TODOS')">
                    <strong>Mesmo estado para todos os caixas</strong>
                    <small class="d-block text-muted ms-4 mt-1">
                        O administrador define ON ou OFF para todos.
                    </small>
                </label>
                <label class="d-block">
                    <input type="radio" name="f12_escopo" value="INDIVIDUAL"
                        ${escopoAtual === 'INDIVIDUAL' ? 'checked' : ''}
                        onchange="mudarEscopoAdminF12('INDIVIDUAL')">
                    <strong>Configurar cada caixa individualmente</strong>
                    <small class="d-block text-muted ms-4 mt-1">
                        O administrador define ON/OFF de cada caixa.
                    </small>
                </label>
            </div>
        </div>
        ${escopoAtual === 'TODOS' ? renderEstadoTodosF12(info) : renderListaCaixasF12(caixas)}
    `;
}

function renderEstadoTodosF12(info) {
    const ativo = info.estadoGlobal === true;
    return `
        <div class="card mb-3">
            <div class="card-header">Estado atual</div>
            <div class="card-body">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="global_ativo"
                        ${ativo ? 'checked' : ''}
                        onchange="salvarEstadoGlobalF12(this.checked)">
                    <label class="form-check-label" for="global_ativo" id="global_label">
                        ${ativo ? 'ON' : 'OFF'}
                    </label>
                </div>
            </div>
        </div>
    `;
}

function renderListaCaixasF12(caixas) {
    const linhas = (caixas || []).map((caixa) => `
        <tr>
            <td>${escapeHtml(caixa.nome)}</td>
            <td>
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="caixa_${caixa.id}"
                        ${caixa.f12_ativo ? 'checked' : ''}
                        onchange="salvarEstadoCaixaF12(${caixa.id}, this.checked)">
                    <label class="form-check-label" for="caixa_${caixa.id}">
                        ${caixa.f12_ativo ? 'ON' : 'OFF'}
                    </label>
                </div>
            </td>
        </tr>
    `).join('');

    return `
        <div class="card mb-3">
            <div class="card-header">Caixas</div>
            <div class="card-body">
                <table class="table table-sm table-striped">
                    <thead class="table-light">
                        <tr>
                            <th>Caixa</th>
                            <th>Estado</th>
                        </tr>
                    </thead>
                    <tbody>${linhas}</tbody>
                </table>
            </div>
        </div>
    `;
}

async function mudarControleF12(controle) {
    const escopo = controle === 'ADMINISTRADOR' ? 'TODOS' : null;
    await persistirModeloF12(controle, escopo);
}

async function mudarEscopoAdminF12(escopo) {
    await persistirModeloF12('ADMINISTRADOR', escopo);
}

async function persistirModeloF12(controle, escopo) {
    try {
        const result = typeof F12PolicyResolver.definirModelo === 'function'
            ? await F12PolicyResolver.definirModelo(controle, escopo)
            : { success: false, error: 'Resolver indisponível' };

        if (!result.success) {
            alert(`Erro: ${result.error || 'Falha ao salvar'}`);
            loadF12Admin();
            return;
        }

        showNotification(result.mensagem || 'Controle atualizado', 'success');
        setTimeout(() => loadF12Admin(), 400);
    } catch (err) {
        console.error('Erro ao salvar controle F12:', err);
        alert('Erro ao salvar controle F12');
        loadF12Admin();
    }
}

async function salvarEstadoGlobalF12(ativo) {
    try {
        const result = await F12PolicyResolver.definirEstadoGlobal(ativo);
        if (result.success) {
            const label = document.getElementById('global_label');
            if (label) label.textContent = ativo ? 'ON' : 'OFF';
            showNotification('Estado atualizado para todos os caixas', 'success');
        } else {
            alert(`Erro: ${result.error}`);
            loadF12Admin();
        }
    } catch (err) {
        console.error('Erro ao salvar estado geral:', err);
        alert('Erro ao salvar estado');
        loadF12Admin();
    }
}

async function salvarEstadoCaixaF12(caixaId, ativo) {
    try {
        const result = await F12PolicyResolver.definirEstadoCaixa(caixaId, ativo);
        if (result.success) {
            showNotification('Estado do caixa atualizado', 'success');
            const label = document.querySelector(`label[for="caixa_${caixaId}"]`);
            if (label) label.textContent = ativo ? 'ON' : 'OFF';
        } else {
            alert(`Erro: ${result.error}`);
            loadF12Admin();
        }
    } catch (err) {
        console.error('Erro ao salvar estado do caixa:', err);
        alert('Erro ao salvar estado do caixa');
        loadF12Admin();
    }
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text || '').replace(/[&<>"']/g, (m) => map[m]);
}
