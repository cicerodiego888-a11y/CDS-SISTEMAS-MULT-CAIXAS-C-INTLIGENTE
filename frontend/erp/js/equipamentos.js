/**
 * Configurações → Motor de Equipamentos → Balanças (Sprint EQUIPAMENTOS 02)
 */

let equipamentosCache = [];
let driversCache = [];
let presetsLayoutCache = [];
let layoutAtivoCache = null;
let filtrosEquipamentos = { tipo: 'balanca', busca: '', status: '', ativo: '' };
/** @type {Object[]} Cache dos candidatos do Discovery Ethernet (RC1) */
let discoveryCandidatosCache = [];
/** @type {number|null} */
let discoveryProgressTimer = null;
let discoveryEmAndamento = false;
/** @type {string} todos|ethernet|serial|usb */
let discoveryFiltroTransporte = 'todos';

function escapeHtmlEquipamentos(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function labelStatusEquipamento(status) {
    const s = String(status || 'desconhecido').toLowerCase();
    const mapa = {
        online: '<span class="badge bg-success">Online</span>',
        offline: '<span class="badge bg-secondary">Offline</span>',
        erro: '<span class="badge bg-danger">Erro</span>',
        desconhecido: '<span class="badge bg-warning text-dark">Desconhecido</span>',
        sincronizando: '<span class="badge bg-info">Sincronizando</span>'
    };
    return mapa[s] || `<span class="badge bg-secondary">${escapeHtmlEquipamentos(s)}</span>`;
}

function headersEquipamentos() {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

function apiUrlEquipamentos() {
    return (typeof API_URL === 'string' && API_URL.trim() !== '') ? API_URL : `${window.location.origin}/api`;
}

function montarQueryFiltros() {
    const p = new URLSearchParams();
    p.set('todos', '1');
    if (filtrosEquipamentos.tipo) p.set('tipo', filtrosEquipamentos.tipo);
    if (filtrosEquipamentos.busca) p.set('busca', filtrosEquipamentos.busca);
    if (filtrosEquipamentos.status) p.set('status', filtrosEquipamentos.status);
    if (filtrosEquipamentos.ativo !== '') p.set('ativo', filtrosEquipamentos.ativo);
    return p.toString();
}

async function carregarEquipamentosDados() {
    const apiUrl = apiUrlEquipamentos();
    const query = montarQueryFiltros();

    const [respLista, respDrivers, respResumo, respPresets, respLayoutAtivo] = await Promise.all([
        fetch(`${apiUrl}/equipamentos?${query}`, { headers: headersEquipamentos() }),
        fetch(`${apiUrl}/equipamentos/drivers`, { headers: headersEquipamentos() }),
        fetch(`${apiUrl}/equipamentos/resumo`, { headers: headersEquipamentos() }),
        fetch(`${apiUrl}/equipamentos/layouts/presets`, { headers: headersEquipamentos() }),
        fetch(`${apiUrl}/equipamentos/layouts/ativo`, { headers: headersEquipamentos() })
    ]);

    const lista = await respLista.json();
    const drivers = await respDrivers.json();
    const resumo = await respResumo.json();
    const presets = await respPresets.json().catch(() => ({ presets: [] }));
    const layoutAtivo = await respLayoutAtivo.json().catch(() => ({ layout: null }));

    if (!respLista.ok) throw new Error(lista.error || 'Erro ao carregar equipamentos');
    if (!respDrivers.ok) throw new Error(drivers.error || 'Erro ao carregar drivers');

    equipamentosCache = lista.equipamentos || [];
    driversCache = drivers.drivers || [];
    presetsLayoutCache = presets.presets || [];
    layoutAtivoCache = layoutAtivo.layout || null;

    return {
        equipamentos: equipamentosCache,
        drivers: driversCache,
        presets: presetsLayoutCache,
        layoutAtivo: layoutAtivoCache,
        resumo: resumo.resumo || { quantidade: 0, online: 0, offline: 0, fila: 0, pendentes: 0 }
    };
}

function formatarDataHoraEquip(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('pt-BR');
    } catch (_) {
        return iso;
    }
}

function renderTabelaEquipamentos(equipamentos) {
    if (!equipamentos.length) {
        return '<tr><td colspan="10" class="text-center text-muted py-4">Nenhuma balança encontrada.</td></tr>';
    }

    return equipamentos.map((eq) => `
        <tr>
            <td>${eq.id}</td>
            <td><strong>${escapeHtmlEquipamentos(eq.nome)}</strong></td>
            <td>${escapeHtmlEquipamentos(eq.fabricante || '-')}<br><small class="text-muted">${escapeHtmlEquipamentos(eq.modelo || '-')}</small></td>
            <td><small>${escapeHtmlEquipamentos(eq.driver_nome || eq.driver_codigo || '-')}</small></td>
            <td>${escapeHtmlEquipamentos(eq.transporte || '-')}<br><small class="text-muted">${escapeHtmlEquipamentos(eq.ip || '')}${eq.porta_tcp ? ':' + eq.porta_tcp : ''}</small></td>
            <td>${labelStatusEquipamento(eq.status)}</td>
            <td><small>${formatarDataHoraEquip(eq.ultima_comunicacao)}</small></td>
            <td><small class="text-danger">${escapeHtmlEquipamentos(eq.ultimo_erro || '—')}</small></td>
            <td>${eq.ativo ? '<span class="badge bg-success">Sim</span>' : '<span class="badge bg-secondary">Não</span>'}</td>
            <td class="text-nowrap">
                <button class="btn btn-sm btn-outline-primary me-1" onclick="editarEquipamento(${eq.id})" title="Editar"><i class="fas fa-edit"></i></button>
                <button class="btn btn-sm btn-outline-secondary me-1" onclick="duplicarEquipamento(${eq.id})" title="Duplicar"><i class="fas fa-copy"></i></button>
                <button class="btn btn-sm btn-outline-info me-1" onclick="testarEquipamento(${eq.id})" title="Testar conexão"><i class="fas fa-plug"></i></button>
                <button class="btn btn-sm btn-outline-warning me-1" onclick="diagnosticarEquipamento(${eq.id})" title="Diagnóstico"><i class="fas fa-stethoscope"></i></button>
                ${eq.ativo
                    ? `<button class="btn btn-sm btn-outline-dark me-1" onclick="desativarEquipamento(${eq.id})" title="Desativar"><i class="fas fa-ban"></i></button>`
                    : `<button class="btn btn-sm btn-outline-success me-1" onclick="ativarEquipamento(${eq.id})" title="Ativar"><i class="fas fa-check"></i></button>`}
                <button class="btn btn-sm btn-outline-danger" onclick="excluirEquipamento(${eq.id})" title="Excluir"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

function renderPaginaEquipamentos(dados) {
    const { equipamentos, resumo, layoutAtivo } = dados;
    const layoutResumo = layoutAtivo
        ? `${escapeHtmlEquipamentos(layoutAtivo.preset_id || 'custom')} · PLU ${layoutAtivo.digitos_plu} · ${layoutAtivo.tipo_variavel} ${layoutAtivo.digitos_variavel}`
        : 'Não configurado (padrão legado)';

    const html = `
        <nav aria-label="breadcrumb" class="mb-2">
            <ol class="breadcrumb mb-0">
                <li class="breadcrumb-item"><a href="#" onclick="loadPage('configuracoes'); return false;">Configurações</a></li>
                <li class="breadcrumb-item">Motor de Equipamentos</li>
                <li class="breadcrumb-item active">Balanças</li>
            </ol>
        </nav>

        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
            <div>
                <h3 class="mb-0"><i class="fas fa-weight"></i> Balanças</h3>
                <small class="text-muted">Cadastro, layout de etiqueta e conexão TCP — fonte oficial do PDV/MIP</small>
            </div>
            <div>
                <button class="btn btn-outline-success me-2" onclick="descobrirEquipamentosEthernet()"><i class="fas fa-search-location"></i> Descobrir Equipamentos</button>
                <button class="btn btn-outline-secondary me-2" onclick="diagnosticarEquipamento()"><i class="fas fa-stethoscope"></i> Diagnóstico geral</button>
                <button class="btn btn-primary" onclick="abrirModalEquipamento()"><i class="fas fa-plus"></i> Nova balança</button>
            </div>
        </div>

        <div class="card mb-3 border-success" id="painel-discovery-eq" style="display:none;">
            <div class="card-header bg-success text-white d-flex justify-content-between align-items-center flex-wrap gap-2">
                <span><i class="fas fa-network-wired"></i> Discovery — candidatos</span>
                <div class="d-flex gap-2 align-items-center flex-wrap">
                    <select class="form-select form-select-sm" id="discovery-filtro-transporte" style="width:auto;min-width:120px;" onchange="discoveryFiltroTransporte=this.value">
                        <option value="todos" ${discoveryFiltroTransporte === 'todos' ? 'selected' : ''}>Todos</option>
                        <option value="ethernet" ${discoveryFiltroTransporte === 'ethernet' ? 'selected' : ''}>Ethernet</option>
                        <option value="serial" ${discoveryFiltroTransporte === 'serial' ? 'selected' : ''}>Serial</option>
                        <option value="usb" ${discoveryFiltroTransporte === 'usb' ? 'selected' : ''}>USB</option>
                    </select>
                    <button type="button" class="btn btn-sm btn-warning" id="btn-cancelar-discovery" style="display:none;" onclick="cancelarDiscoveryEthernet()">
                        <i class="fas fa-stop"></i> Cancelar
                    </button>
                    <button type="button" class="btn btn-sm btn-light" onclick="fecharPainelDiscovery()">Fechar</button>
                </div>
            </div>
            <div class="card-body p-0">
                <div id="discovery-eq-status" class="px-3 py-2 small text-muted border-bottom"></div>
                <div class="progress rounded-0" style="height:4px;display:none;" id="discovery-eq-progress-wrap">
                    <div class="progress-bar progress-bar-striped progress-bar-animated bg-success" id="discovery-eq-progress" style="width:100%"></div>
                </div>
                <div class="table-responsive">
                    <table class="table table-sm table-hover mb-0">
                        <thead>
                            <tr>
                                <th>Transporte</th>
                                <th>Endpoint</th>
                                <th>Driver</th>
                                <th>Fabricante/Modelo</th>
                                <th>Confiança</th>
                                <th>Identidade</th>
                                <th>Assinatura</th>
                                <th>Status</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody id="discovery-eq-tbody"></tbody>
                    </table>
                </div>
            </div>
        </div>

        <div class="alert alert-light border mb-3">
            <div class="d-flex flex-wrap justify-content-between gap-2 align-items-center">
                <div>
                    <strong>Layout ativo (PDV)</strong>
                    <div class="small text-muted">${layoutResumo}</div>
                </div>
                <button type="button" class="btn btn-sm btn-outline-primary" onclick="abrirModalLayoutAtivo()">
                    <i class="fas fa-barcode"></i> Configurar layout ativo
                </button>
            </div>
        </div>

        <div class="row mb-3" id="painel-conexao-tcp" style="display:none;">
            <div class="col-12">
                <div class="card border-info">
                    <div class="card-header bg-info text-white"><i class="fas fa-network-wired"></i> Resultado do teste de conexão</div>
                    <div class="card-body">
                        <div class="row">
                            <div class="col-md-3"><small class="text-muted">Status</small><div id="tcp-status" class="fw-bold">—</div></div>
                            <div class="col-md-3"><small class="text-muted">Conectado</small><div id="tcp-conectado" class="fw-bold">—</div></div>
                            <div class="col-md-3"><small class="text-muted">Última comunicação</small><div id="tcp-tempo" class="fw-bold">—</div></div>
                            <div class="col-md-3"><small class="text-muted">Último erro</small><div id="tcp-erro" class="fw-bold text-danger">—</div></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="row mb-3">
            <div class="col-6 col-md-3 mb-2"><div class="card"><div class="card-body py-2"><small class="text-muted">Cadastrados</small><div class="h4 mb-0">${resumo.quantidade || 0}</div></div></div></div>
            <div class="col-6 col-md-3 mb-2"><div class="card border-success"><div class="card-body py-2"><small class="text-muted">Online</small><div class="h4 mb-0 text-success">${resumo.online || 0}</div></div></div></div>
            <div class="col-6 col-md-3 mb-2"><div class="card border-danger"><div class="card-body py-2"><small class="text-muted">Offline</small><div class="h4 mb-0 text-danger">${resumo.offline || 0}</div></div></div></div>
            <div class="col-6 col-md-3 mb-2"><div class="card border-warning"><div class="card-body py-2"><small class="text-muted">Pendentes (fila)</small><div class="h4 mb-0">${resumo.pendentes || resumo.fila || 0}</div></div></div></div>
        </div>

        <div class="card mb-3">
            <div class="card-body">
                <div class="row g-2 align-items-end">
                    <div class="col-md-4">
                        <label class="form-label small mb-0">Pesquisar</label>
                        <input type="text" class="form-control" id="filtroBuscaEq" placeholder="Nome, IP, fabricante..." value="${escapeHtmlEquipamentos(filtrosEquipamentos.busca)}">
                    </div>
                    <div class="col-md-2">
                        <label class="form-label small mb-0">Status</label>
                        <select class="form-select" id="filtroStatusEq">
                            <option value="">Todos</option>
                            <option value="online" ${filtrosEquipamentos.status === 'online' ? 'selected' : ''}>Online</option>
                            <option value="offline" ${filtrosEquipamentos.status === 'offline' ? 'selected' : ''}>Offline</option>
                            <option value="desconhecido" ${filtrosEquipamentos.status === 'desconhecido' ? 'selected' : ''}>Desconhecido</option>
                            <option value="erro" ${filtrosEquipamentos.status === 'erro' ? 'selected' : ''}>Erro</option>
                        </select>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label small mb-0">Ativo</label>
                        <select class="form-select" id="filtroAtivoEq">
                            <option value="">Todos</option>
                            <option value="1" ${filtrosEquipamentos.ativo === '1' ? 'selected' : ''}>Sim</option>
                            <option value="0" ${filtrosEquipamentos.ativo === '0' ? 'selected' : ''}>Não</option>
                        </select>
                    </div>
                    <div class="col-md-2">
                        <button class="btn btn-primary w-100" onclick="aplicarFiltrosEquipamentos()"><i class="fas fa-search"></i> Filtrar</button>
                    </div>
                    <div class="col-md-2">
                        <button class="btn btn-outline-secondary w-100" onclick="limparFiltrosEquipamentos()">Limpar</button>
                    </div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header"><i class="fas fa-list"></i> Lista de balanças</div>
            <div class="card-body p-0">
                <div class="table-responsive">
                    <table class="table table-striped table-hover mb-0">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Nome</th>
                                <th>Fabricante/Modelo</th>
                                <th>Driver</th>
                                <th>Conexão</th>
                                <th>Status</th>
                                <th>Última comunicação</th>
                                <th>Último erro</th>
                                <th>Ativo</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>${renderTabelaEquipamentos(equipamentos)}</tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    $('#page-content').html(html);
}

function aplicarFiltrosEquipamentos() {
    filtrosEquipamentos.busca = document.getElementById('filtroBuscaEq')?.value?.trim() || '';
    filtrosEquipamentos.status = document.getElementById('filtroStatusEq')?.value || '';
    filtrosEquipamentos.ativo = document.getElementById('filtroAtivoEq')?.value ?? '';
    loadEquipamentos();
}

function limparFiltrosEquipamentos() {
    filtrosEquipamentos = { tipo: 'balanca', busca: '', status: '', ativo: '' };
    loadEquipamentos();
}

function fecharPainelDiscovery() {
    if (discoveryEmAndamento) {
        cancelarDiscoveryEthernet();
    }
    const painel = document.getElementById('painel-discovery-eq');
    if (painel) painel.style.display = 'none';
}

function _pararProgressoDiscovery() {
    discoveryEmAndamento = false;
    if (discoveryProgressTimer) {
        clearInterval(discoveryProgressTimer);
        discoveryProgressTimer = null;
    }
    const btnCancel = document.getElementById('btn-cancelar-discovery');
    const wrap = document.getElementById('discovery-eq-progress-wrap');
    if (btnCancel) btnCancel.style.display = 'none';
    if (wrap) wrap.style.display = 'none';
}

function _iniciarProgressoDiscovery() {
    discoveryEmAndamento = true;
    const inicio = Date.now();
    const btnCancel = document.getElementById('btn-cancelar-discovery');
    const wrap = document.getElementById('discovery-eq-progress-wrap');
    const statusEl = document.getElementById('discovery-eq-status');
    if (btnCancel) btnCancel.style.display = '';
    if (wrap) wrap.style.display = '';
    if (discoveryProgressTimer) clearInterval(discoveryProgressTimer);
    discoveryProgressTimer = setInterval(() => {
        const seg = ((Date.now() - inicio) / 1000).toFixed(1);
        if (statusEl) {
            statusEl.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Varrendo rede Ethernet… <strong>${seg}s</strong>`;
        }
    }, 250);
}

async function cancelarDiscoveryEthernet() {
    try {
        await fetch(`${apiUrlEquipamentos()}/equipamentos/discovery/cancel`, {
            method: 'POST',
            headers: headersEquipamentos(),
            body: '{}'
        });
        showNotification('Cancelamento solicitado', 'warning');
    } catch (err) {
        showNotification(err.message || 'Falha ao cancelar', 'danger');
    }
}

function confiancaBadge(confianca) {
    const n = Number(confianca || 0);
    const pct = Math.round(n * 100);
    const cls = n >= 0.8 ? 'success' : (n >= 0.5 ? 'warning' : 'secondary');
    return `<span class="badge bg-${cls}">${pct}%</span>`;
}

function renderTabelaDiscovery(candidatos) {
    const tbody = document.getElementById('discovery-eq-tbody');
    if (!tbody) return;
    if (!candidatos.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-3">Nenhum equipamento encontrado nesta varredura.</td></tr>';
        return;
    }
    tbody.innerHTML = candidatos.map((c, idx) => {
        let endpoint = '—';
        if (c.transporte === 'ethernet') {
            endpoint = `${escapeHtmlEquipamentos(c.ip || '-')}:${escapeHtmlEquipamentos(c.porta || '-')}`;
        } else if (c.transporte === 'serial') {
            endpoint = escapeHtmlEquipamentos(c.porta_com || '-');
        } else if (c.transporte === 'usb') {
            endpoint = c.vid && c.pid
                ? `VID ${escapeHtmlEquipamentos(c.vid)} / PID ${escapeHtmlEquipamentos(c.pid)}`
                : escapeHtmlEquipamentos(c.caminho_dispositivo || '-');
        }
        const status = c.ja_cadastrado
            ? '<span class="badge bg-secondary">Já cadastrado</span>'
            : '<span class="badge bg-info text-dark">Novo cadastro</span>';
        const idn = c.identidade || {};
        const idBadge = badgeIdentidadeDiscovery(idn);
        const btn = c.ja_cadastrado
            ? '<button class="btn btn-sm btn-outline-secondary" disabled>Cadastrado</button>'
            : `<button class="btn btn-sm btn-primary" onclick="cadastrarCandidatoDiscovery(${idx})"><i class="fas fa-plus"></i> Cadastrar</button>`;
        return `<tr>
            <td><span class="badge bg-dark">${escapeHtmlEquipamentos(c.transporte || '-')}</span></td>
            <td><code>${endpoint}</code></td>
            <td><small>${escapeHtmlEquipamentos(c.driver_codigo || '-')}</small></td>
            <td>${escapeHtmlEquipamentos(c.fabricante || '-')}<br><small class="text-muted">${escapeHtmlEquipamentos(c.modelo || '-')}</small></td>
            <td>${confiancaBadge(c.confianca)}</td>
            <td>${idBadge}</td>
            <td><small class="text-muted">${escapeHtmlEquipamentos(c.assinatura || '—')}</small></td>
            <td>${status}</td>
            <td>${btn}</td>
        </tr>`;
    }).join('');
}

function badgeIdentidadeDiscovery(idn) {
    if (!idn || !idn.status) {
        return '<span class="badge bg-light text-muted">—</span>';
    }
    const mapa = {
        novo: { cls: 'success', icon: 'fa-star' },
        conhecido: { cls: 'primary', icon: 'fa-check' },
        ip_alterado: { cls: 'warning text-dark', icon: 'fa-exchange-alt' },
        firmware_alterado: { cls: 'info text-dark', icon: 'fa-microchip' },
        porta_alterada: { cls: 'warning text-dark', icon: 'fa-plug' },
        semelhante: { cls: 'secondary', icon: 'fa-question' }
    };
    const m = mapa[idn.status] || { cls: 'secondary', icon: 'fa-fingerprint' };
    const pct = idn.score_pct != null ? `${idn.score_pct}%` : '';
    const extra = idn.status === 'ip_alterado' && idn.ip_anterior
        ? `<br><small class="text-muted">${escapeHtmlEquipamentos(idn.ip_anterior)} → ${escapeHtmlEquipamentos(idn.ip_atual || '')}</small>`
        : '';
    return `<span class="badge bg-${m.cls}"><i class="fas ${m.icon}"></i> ${escapeHtmlEquipamentos(idn.rotulo || idn.status)}${pct ? ' · ' + pct : ''}</span>${extra}`;
}

async function descobrirEquipamentosEthernet() {
    if (discoveryEmAndamento) {
        showNotification('Já existe uma varredura em andamento', 'info');
        return;
    }

    const sel = document.getElementById('discovery-filtro-transporte');
    if (sel) discoveryFiltroTransporte = sel.value || 'todos';

    const transportes = discoveryFiltroTransporte === 'todos'
        ? ['ethernet', 'serial', 'usb']
        : [discoveryFiltroTransporte];

    const painel = document.getElementById('painel-discovery-eq');
    const statusEl = document.getElementById('discovery-eq-status');
    if (painel) painel.style.display = '';
    const tbody = document.getElementById('discovery-eq-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-3">Aguarde…</td></tr>';
    _iniciarProgressoDiscovery();

    try {
        const resp = await fetch(`${apiUrlEquipamentos()}/equipamentos/discovery`, {
            method: 'POST',
            headers: headersEquipamentos(),
            body: JSON.stringify({
                transportes,
                timeoutMs: 800,
                concorrencia: 32,
                timeoutMsSerial: 500,
                concorrenciaSerial: 4,
                timeoutMsUsb: 500,
                concorrenciaUsb: 8,
                persistir_sessao: true
            })
        });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error || 'Falha no discovery');

        discoveryCandidatosCache = body.candidatos || [];
        renderTabelaDiscovery(discoveryCandidatosCache);

        const meta = body.meta || {};
        const erros = Array.isArray(body.erros) ? body.erros.length : 0;
        if (statusEl) {
            statusEl.innerHTML = [
                `Transportes: <strong>${escapeHtmlEquipamentos((meta.transportes_executados || transportes).join(', '))}</strong>`,
                meta.subnet ? `Subnet: <strong>${escapeHtmlEquipamentos(meta.subnet)}</strong>` : '',
                `Duração: <strong>${Number(meta.duracao_ms || 0)} ms</strong>`,
                `Probes: <strong>${Number(meta.probes_ok || 0)}/${Number(meta.probes_total || 0)}</strong>`,
                `Candidatos: <strong>${discoveryCandidatosCache.length}</strong>`,
                meta.sessao_id ? `Sessão: <strong>#${meta.sessao_id}</strong>` : '',
                meta.cancelado ? '<span class="text-warning">Cancelado</span>' : '',
                erros ? `Avisos: <strong>${erros}</strong>` : ''
            ].filter(Boolean).join(' · ');
        }

        if (!discoveryCandidatosCache.length) {
            showNotification(meta.cancelado ? 'Varredura cancelada' : 'Nenhum equipamento encontrado', 'info');
        } else {
            showNotification(`${discoveryCandidatosCache.length} candidato(s) encontrado(s)`, 'success');
        }
    } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-danger text-center py-3">${escapeHtmlEquipamentos(err.message)}</td></tr>`;
        showNotification(err.message, 'danger');
    } finally {
        _pararProgressoDiscovery();
    }
}

async function cadastrarCandidatoDiscovery(indice) {
    const c = discoveryCandidatosCache[indice];
    if (!c) return showNotification('Candidato inválido', 'warning');
    if (c.ja_cadastrado) return showNotification('Equipamento já cadastrado', 'info');

    const nomeSug = [
        c.fabricante || 'Equipamento',
        c.modelo || '',
        c.ip || c.porta_com || (c.vid ? `${c.vid}:${c.pid}` : '')
    ].filter(Boolean).join(' ').trim();

    const nome = window.prompt('Nome para cadastrar o equipamento:', nomeSug);
    if (!nome) return;

    const payload = {
        nome: String(nome).trim(),
        tipo: 'balanca',
        driver_codigo: c.driver_codigo || null,
        fabricante: c.fabricante || null,
        modelo: c.modelo || null,
        transporte: c.transporte || 'ethernet',
        ip: c.ip || null,
        porta_tcp: c.porta != null ? Number(c.porta) : (c.transporte === 'ethernet' ? 9000 : null),
        porta_com: c.porta_com || null,
        timeout_ms: 5000,
        reconnect_auto: false,
        ativo: true,
        observacao: [
            `Discovery RC2`,
            c.observacoes || '',
            c.assinatura ? `assinatura=${c.assinatura}` : '',
            c.caminho_dispositivo ? `path=${c.caminho_dispositivo}` : '',
            c.vid && c.pid ? `usb=${c.vid}:${c.pid}` : ''
        ].filter(Boolean).join(' · ')
    };

    try {
        const resp = await fetch(`${apiUrlEquipamentos()}/equipamentos`, {
            method: 'POST',
            headers: headersEquipamentos(),
            body: JSON.stringify(payload)
        });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error || 'Erro ao cadastrar');

        showNotification(body.message || 'Equipamento cadastrado', 'success');
        discoveryCandidatosCache[indice] = { ...c, ja_cadastrado: true };
        const dados = await carregarEquipamentosDados();
        renderPaginaEquipamentos(dados);
        const painel = document.getElementById('painel-discovery-eq');
        if (painel) painel.style.display = '';
        const statusEl = document.getElementById('discovery-eq-status');
        if (statusEl) {
            statusEl.innerHTML = `Cadastrado: <strong>${escapeHtmlEquipamentos(payload.nome)}</strong> · candidatos restantes atualizados`;
        }
        const sel = document.getElementById('discovery-filtro-transporte');
        if (sel) sel.value = discoveryFiltroTransporte;
        renderTabelaDiscovery(discoveryCandidatosCache);
    } catch (err) {
        showNotification(err.message, 'danger');
    }
}

function loadEquipamentos() {
    $('#page-content').html('<div class="text-center p-5"><div class="spinner-border text-primary"></div><p class="mt-2">Carregando balanças...</p></div>');
    carregarEquipamentosDados()
        .then(renderPaginaEquipamentos)
        .catch((err) => {
            console.error(err);
            $('#page-content').html(`<div class="alert alert-danger">${escapeHtmlEquipamentos(err.message)}</div>`);
        });
}

function layoutPadraoFormulario() {
    const preset = presetsLayoutCache.find((p) => p.id === 'toledo_prix4_uno_valor')
        || presetsLayoutCache[0];
    return preset?.layout || {
        preset_id: 'toledo_prix4_uno_valor',
        prefixo: '2',
        digitos_plu: 6,
        tipo_variavel: 'VALOR',
        posicao_inicial: 8,
        posicao_final: 12,
        digitos_variavel: 5,
        tamanho_total: 13,
        digito_verificador: true
    };
}

function htmlCamposLayoutEtiqueta(layout, prefixoId = 'eq') {
    const L = layout || layoutPadraoFormulario();
    const tipo = String(L.tipo_variavel || 'VALOR').toUpperCase();
    const optionsPresets = presetsLayoutCache.map((p) =>
        `<option value="${escapeHtmlEquipamentos(p.id)}" ${L.preset_id === p.id ? 'selected' : ''}>${escapeHtmlEquipamentos(p.nome)}</option>`
    ).join('');

    return `
        <hr class="my-3">
        <h6 class="mb-2"><i class="fas fa-barcode"></i> Configuração do Layout da Etiqueta</h6>
        <div class="row">
            <div class="col-md-6 mb-3">
                <label class="form-label fw-bold">Modelo de layout</label>
                <select class="form-select" id="${prefixoId}LayoutPreset" onchange="aplicarPresetLayoutFormulario('${prefixoId}')">
                    ${optionsPresets || '<option value="outro">Outro</option>'}
                </select>
                <small class="text-muted">Exemplos: Toledo Prix IV Uno, Prix V, Filizola, Urano, Elgin, Outro</small>
            </div>
            <div class="col-md-3 mb-3">
                <label class="form-label fw-bold">Prefixo</label>
                <input type="text" class="form-control" id="${prefixoId}LayoutPrefixo" value="${escapeHtmlEquipamentos(L.prefixo || '2')}" placeholder="2">
            </div>
            <div class="col-md-3 mb-3">
                <label class="form-label fw-bold">Dígitos do PLU</label>
                <input type="number" min="1" max="10" class="form-control" id="${prefixoId}LayoutDigitosPlu" value="${Number(L.digitos_plu || 6)}">
            </div>
            <div class="col-md-6 mb-3">
                <label class="form-label fw-bold d-block">Tipo da informação variável</label>
                <div class="form-check form-check-inline">
                    <input class="form-check-input" type="radio" name="${prefixoId}LayoutTipo" id="${prefixoId}LayoutTipoPeso" value="PESO" ${tipo === 'PESO' ? 'checked' : ''}>
                    <label class="form-check-label" for="${prefixoId}LayoutTipoPeso">Peso</label>
                </div>
                <div class="form-check form-check-inline">
                    <input class="form-check-input" type="radio" name="${prefixoId}LayoutTipo" id="${prefixoId}LayoutTipoValor" value="VALOR" ${tipo !== 'PESO' ? 'checked' : ''}>
                    <label class="form-check-label" for="${prefixoId}LayoutTipoValor">Valor</label>
                </div>
            </div>
            <div class="col-md-3 mb-3">
                <label class="form-label fw-bold">Posição inicial</label>
                <input type="number" min="1" class="form-control" id="${prefixoId}LayoutPosIni" value="${Number(L.posicao_inicial || 8)}">
            </div>
            <div class="col-md-3 mb-3">
                <label class="form-label fw-bold">Posição final</label>
                <input type="number" min="1" class="form-control" id="${prefixoId}LayoutPosFim" value="${Number(L.posicao_final || 12)}">
            </div>
            <div class="col-md-4 mb-3">
                <label class="form-label fw-bold">Dígitos da informação variável</label>
                <input type="number" min="1" max="10" class="form-control" id="${prefixoId}LayoutDigitosVar" value="${Number(L.digitos_variavel || 5)}">
            </div>
            <div class="col-md-4 mb-3">
                <label class="form-label fw-bold">Tamanho total do código</label>
                <input type="number" min="8" max="18" class="form-control" id="${prefixoId}LayoutTamanho" value="${Number(L.tamanho_total || 13)}">
            </div>
            <div class="col-md-4 mb-3">
                <label class="form-label fw-bold">Dígito verificador</label>
                <select class="form-select" id="${prefixoId}LayoutDv">
                    <option value="1" ${L.digito_verificador !== false ? 'selected' : ''}>Sim</option>
                    <option value="0" ${L.digito_verificador === false ? 'selected' : ''}>Não</option>
                </select>
            </div>
            <div class="col-md-8 mb-3">
                <label class="form-label">Testar etiqueta</label>
                <div class="input-group">
                    <input type="text" class="form-control" id="${prefixoId}LayoutTesteCodigo" placeholder="Ex.: 2000067010019" value="2000067010019">
                    <button type="button" class="btn btn-outline-secondary" onclick="testarParseLayoutFormulario('${prefixoId}')">Testar</button>
                </div>
                <small class="text-muted" id="${prefixoId}LayoutTesteResultado">Aceite: 2000067010019 → PLU 67 (Toledo 6+5)</small>
            </div>
            <div class="col-md-4 mb-3 d-flex align-items-end">
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="${prefixoId}LayoutAtivoPdv" ${prefixoId === 'ativo' ? 'checked' : ''}>
                    <label class="form-check-label" for="${prefixoId}LayoutAtivoPdv">Usar como layout ativo no PDV</label>
                </div>
            </div>
        </div>
    `;
}

function coletarLayoutDoFormulario(prefixoId = 'eq') {
    const tipoEl = document.querySelector(`input[name="${prefixoId}LayoutTipo"]:checked`);
    return {
        preset_id: document.getElementById(`${prefixoId}LayoutPreset`)?.value || 'outro',
        prefixo: document.getElementById(`${prefixoId}LayoutPrefixo`)?.value?.trim() || '2',
        digitos_plu: Number(document.getElementById(`${prefixoId}LayoutDigitosPlu`)?.value || 0),
        tipo_variavel: tipoEl?.value || 'VALOR',
        posicao_inicial: Number(document.getElementById(`${prefixoId}LayoutPosIni`)?.value || 0),
        posicao_final: Number(document.getElementById(`${prefixoId}LayoutPosFim`)?.value || 0),
        digitos_variavel: Number(document.getElementById(`${prefixoId}LayoutDigitosVar`)?.value || 0),
        tamanho_total: Number(document.getElementById(`${prefixoId}LayoutTamanho`)?.value || 13),
        digito_verificador: document.getElementById(`${prefixoId}LayoutDv`)?.value !== '0'
    };
}

function aplicarPresetLayoutFormulario(prefixoId = 'eq') {
    const presetId = document.getElementById(`${prefixoId}LayoutPreset`)?.value;
    const preset = presetsLayoutCache.find((p) => p.id === presetId);
    if (!preset?.layout) return;
    const L = preset.layout;
    document.getElementById(`${prefixoId}LayoutPrefixo`).value = L.prefixo || '2';
    document.getElementById(`${prefixoId}LayoutDigitosPlu`).value = L.digitos_plu || 6;
    document.getElementById(`${prefixoId}LayoutPosIni`).value = L.posicao_inicial || 8;
    document.getElementById(`${prefixoId}LayoutPosFim`).value = L.posicao_final || 12;
    document.getElementById(`${prefixoId}LayoutDigitosVar`).value = L.digitos_variavel || 5;
    document.getElementById(`${prefixoId}LayoutTamanho`).value = L.tamanho_total || 13;
    document.getElementById(`${prefixoId}LayoutDv`).value = L.digito_verificador === false ? '0' : '1';
    const tipo = String(L.tipo_variavel || 'VALOR').toUpperCase();
    const peso = document.getElementById(`${prefixoId}LayoutTipoPeso`);
    const valor = document.getElementById(`${prefixoId}LayoutTipoValor`);
    if (peso && valor) {
        peso.checked = tipo === 'PESO';
        valor.checked = tipo !== 'PESO';
    }
    if (preset.fabricante && document.getElementById('eqFabricante') && !document.getElementById('eqFabricante').value) {
        document.getElementById('eqFabricante').value = preset.fabricante;
    }
    if (preset.modelo && document.getElementById('eqModelo') && !document.getElementById('eqModelo').value) {
        document.getElementById('eqModelo').value = preset.modelo;
    }
}

async function testarParseLayoutFormulario(prefixoId = 'eq') {
    const codigo = document.getElementById(`${prefixoId}LayoutTesteCodigo`)?.value?.trim();
    const layout = coletarLayoutDoFormulario(prefixoId);
    const el = document.getElementById(`${prefixoId}LayoutTesteResultado`);
    try {
        const resp = await fetch(`${apiUrlEquipamentos()}/equipamentos/layouts/testar`, {
            method: 'POST',
            headers: headersEquipamentos(),
            body: JSON.stringify({ codigo, layout })
        });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error || 'Falha no teste');
        if (!body.sucesso || !body.resultado) {
            if (el) el.textContent = 'Não foi possível interpretar o código com este layout.';
            return;
        }
        const r = body.resultado;
        const extra = r.tipoPayload === 'VALOR'
            ? ` · R$ ${Number(r.valorTotal || 0).toFixed(2)}`
            : ` · ${Number(r.peso || 0).toFixed(3)} kg`;
        if (el) el.textContent = `PLU = ${r.plu}${extra}`;
    } catch (err) {
        if (el) el.textContent = err.message;
        showNotification(err.message, 'danger');
    }
}

async function abrirModalEquipamento(equipamento = null) {
    const isEdicao = Boolean(equipamento);
    let eq = equipamento || {};

    if (isEdicao && eq.id) {
        try {
            const resp = await fetch(`${apiUrlEquipamentos()}/equipamentos/${eq.id}`, { headers: headersEquipamentos() });
            const body = await resp.json();
            if (resp.ok && body.equipamento) eq = body.equipamento;
        } catch (_) { /* usa cache */ }
    }

    const layout = eq.layout_etiqueta || layoutPadraoFormulario();

    const optionsDrivers = driversCache.map((d) =>
        `<option value="${escapeHtmlEquipamentos(d.codigo)}" data-id="${d.id}" data-fab="${escapeHtmlEquipamentos(d.fabricante)}" data-mod="${escapeHtmlEquipamentos(d.modelo)}" ${eq.driver_codigo === d.codigo ? 'selected' : ''}>${escapeHtmlEquipamentos(d.nome_exibicao)}</option>`
    ).join('');

    $('#modal-container').html(`
        <div class="modal fade" id="modalEquipamento" tabindex="-1">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${isEdicao ? 'Editar' : 'Nova'} balança</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <input type="hidden" id="eqId" value="${eq.id || ''}">
                        <div class="row">
                            <div class="col-md-8 mb-3">
                                <label class="form-label fw-bold">Nome *</label>
                                <input type="text" class="form-control" id="eqNome" value="${escapeHtmlEquipamentos(eq.nome || '')}" required>
                            </div>
                            <div class="col-md-4 mb-3">
                                <label class="form-label fw-bold">Driver</label>
                                <select class="form-select" id="eqDriverCodigo" onchange="preencherFabricanteModeloDriver()">
                                    <option value="">— Selecione —</option>
                                    ${optionsDrivers}
                                </select>
                            </div>
                            <div class="col-md-4 mb-3">
                                <label class="form-label">Fabricante</label>
                                <input type="text" class="form-control" id="eqFabricante" value="${escapeHtmlEquipamentos(eq.fabricante || '')}">
                            </div>
                            <div class="col-md-4 mb-3">
                                <label class="form-label">Modelo</label>
                                <input type="text" class="form-control" id="eqModelo" value="${escapeHtmlEquipamentos(eq.modelo || '')}">
                            </div>
                            <div class="col-md-4 mb-3 d-flex align-items-end">
                                <div class="form-check">
                                    <input class="form-check-input" type="checkbox" id="eqAtivo" ${eq.ativo !== false ? 'checked' : ''}>
                                    <label class="form-check-label" for="eqAtivo">Ativa</label>
                                </div>
                            </div>
                            <div class="col-md-4 mb-3">
                                <label class="form-label fw-bold">Transporte</label>
                                <select class="form-select" id="eqTransporte">
                                    <option value="ethernet" ${eq.transporte === 'ethernet' || !eq.transporte ? 'selected' : ''}>Ethernet (TCP)</option>
                                    <option value="serial" ${eq.transporte === 'serial' ? 'selected' : ''}>Serial (COM)</option>
                                    <option value="usb" ${eq.transporte === 'usb' ? 'selected' : ''}>USB</option>
                                    <option value="bluetooth" ${eq.transporte === 'bluetooth' ? 'selected' : ''}>Bluetooth</option>
                                </select>
                            </div>
                            <div class="col-md-4 mb-3">
                                <label class="form-label">IP</label>
                                <input type="text" class="form-control" id="eqIp" value="${escapeHtmlEquipamentos(eq.ip || '')}" placeholder="192.168.0.100">
                            </div>
                            <div class="col-md-4 mb-3">
                                <label class="form-label">Porta TCP</label>
                                <input type="number" class="form-control" id="eqPortaTcp" value="${eq.porta_tcp || 9000}" placeholder="9000">
                            </div>
                            <div class="col-md-4 mb-3">
                                <label class="form-label">Timeout (ms)</label>
                                <input type="number" class="form-control" id="eqTimeout" value="${eq.timeout_ms || 5000}">
                            </div>
                            <div class="col-md-4 mb-3">
                                <label class="form-label">Porta COM</label>
                                <input type="text" class="form-control" id="eqPortaCom" value="${escapeHtmlEquipamentos(eq.porta_com || '')}" placeholder="COM3">
                            </div>
                            <div class="col-md-4 mb-3 d-flex align-items-end">
                                <div class="form-check">
                                    <input class="form-check-input" type="checkbox" id="eqReconnectAuto" ${eq.reconnect_auto !== false ? 'checked' : ''}>
                                    <label class="form-check-label" for="eqReconnectAuto">Reconectar automaticamente</label>
                                </div>
                            </div>
                            <div class="col-12 mb-3">
                                <label class="form-label">Observações</label>
                                <textarea class="form-control" id="eqObservacao" rows="2">${escapeHtmlEquipamentos(eq.observacao || '')}</textarea>
                            </div>
                        </div>
                        ${htmlCamposLayoutEtiqueta(layout, 'eq')}
                        ${htmlSecaoMgv6(eq)}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="salvarEquipamento()">Salvar</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    new bootstrap.Modal(document.getElementById('modalEquipamento')).show();
    if (isEdicao && eq.id) {
        carregarConfigMgv6NoFormulario(eq.id);
    }
}

function abrirModalLayoutAtivo() {
    const layout = layoutAtivoCache || layoutPadraoFormulario();
    $('#modal-container').html(`
        <div class="modal fade" id="modalLayoutAtivo" tabindex="-1">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title"><i class="fas fa-barcode"></i> Layout ativo — PDV / MIP</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        ${htmlCamposLayoutEtiqueta(layout, 'ativo')}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="salvarLayoutAtivoGlobal()">Salvar layout ativo</button>
                    </div>
                </div>
            </div>
        </div>
    `);
    const chk = document.getElementById('ativoLayoutAtivoPdv');
    if (chk) {
        chk.checked = true;
        chk.disabled = true;
    }
    new bootstrap.Modal(document.getElementById('modalLayoutAtivo')).show();
}

async function salvarLayoutAtivoGlobal() {
    try {
        const layout = coletarLayoutDoFormulario('ativo');
        const resp = await fetch(`${apiUrlEquipamentos()}/equipamentos/layouts/ativo`, {
            method: 'PUT',
            headers: headersEquipamentos(),
            body: JSON.stringify({ layout })
        });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error || 'Erro ao salvar');
        bootstrap.Modal.getInstance(document.getElementById('modalLayoutAtivo'))?.hide();
        showNotification(body.message || 'Layout ativo salvo', 'success');
        loadEquipamentos();
    } catch (err) {
        showNotification(err.message, 'danger');
    }
}

function preencherFabricanteModeloDriver() {
    const sel = document.getElementById('eqDriverCodigo');
    const opt = sel?.selectedOptions?.[0];
    if (!opt || !opt.dataset.fab) return;
    document.getElementById('eqFabricante').value = opt.dataset.fab || '';
    document.getElementById('eqModelo').value = opt.dataset.mod || '';
}

function coletarDadosFormEquipamento() {
    const driverSelect = document.getElementById('eqDriverCodigo');
    const driverOption = driverSelect?.selectedOptions?.[0];
    return {
        nome: document.getElementById('eqNome').value.trim(),
        tipo: 'balanca',
        driver_codigo: driverSelect?.value || null,
        driver_id: driverOption?.dataset?.id ? Number(driverOption.dataset.id) : null,
        fabricante: document.getElementById('eqFabricante').value.trim() || null,
        modelo: document.getElementById('eqModelo').value.trim() || null,
        transporte: document.getElementById('eqTransporte').value,
        porta_com: document.getElementById('eqPortaCom').value.trim() || null,
        ip: document.getElementById('eqIp').value.trim() || null,
        porta_tcp: document.getElementById('eqPortaTcp').value ? Number(document.getElementById('eqPortaTcp').value) : 9000,
        timeout_ms: document.getElementById('eqTimeout').value ? Number(document.getElementById('eqTimeout').value) : 5000,
        reconnect_auto: document.getElementById('eqReconnectAuto').checked,
        ativo: document.getElementById('eqAtivo').checked,
        observacao: document.getElementById('eqObservacao').value.trim() || null,
        layout_etiqueta: coletarLayoutDoFormulario('eq'),
        layout_ativo: document.getElementById('eqLayoutAtivoPdv')?.checked === true
    };
}

async function salvarEquipamento() {
    const apiUrl = apiUrlEquipamentos();
    const id = document.getElementById('eqId').value;
    const payload = coletarDadosFormEquipamento();
    if (!payload.nome) {
        showNotification('Informe o nome da balança', 'warning');
        return;
    }
    try {
        const url = id ? `${apiUrl}/equipamentos/${id}` : `${apiUrl}/equipamentos`;
        const resp = await fetch(url, {
            method: id ? 'PUT' : 'POST',
            headers: headersEquipamentos(),
            body: JSON.stringify(payload)
        });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error || 'Erro ao salvar');
        bootstrap.Modal.getInstance(document.getElementById('modalEquipamento'))?.hide();
        showNotification(body.message || 'Salvo com sucesso', 'success');
        loadEquipamentos();
    } catch (err) {
        showNotification(err.message, 'danger');
    }
}

function editarEquipamento(id) {
    const eq = equipamentosCache.find((i) => Number(i.id) === Number(id));
    if (!eq) return showNotification('Equipamento não encontrado', 'warning');
    abrirModalEquipamento(eq);
}

async function excluirEquipamento(id) {
    if (!confirm('Excluir esta balança?')) return;
    try {
        const resp = await fetch(`${apiUrlEquipamentos()}/equipamentos/${id}`, { method: 'DELETE', headers: headersEquipamentos() });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error);
        showNotification(body.message || 'Removido', 'success');
        loadEquipamentos();
    } catch (err) {
        showNotification(err.message, 'danger');
    }
}

async function duplicarEquipamento(id) {
    try {
        const resp = await fetch(`${apiUrlEquipamentos()}/equipamentos/${id}/duplicar`, { method: 'POST', headers: headersEquipamentos() });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error);
        showNotification(body.message || 'Duplicado', 'success');
        loadEquipamentos();
    } catch (err) {
        showNotification(err.message, 'danger');
    }
}

async function ativarEquipamento(id) {
    try {
        const resp = await fetch(`${apiUrlEquipamentos()}/equipamentos/${id}/ativar`, { method: 'POST', headers: headersEquipamentos() });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error);
        showNotification(body.message || 'Ativado', 'success');
        loadEquipamentos();
    } catch (err) {
        showNotification(err.message, 'danger');
    }
}

async function desativarEquipamento(id) {
    try {
        const resp = await fetch(`${apiUrlEquipamentos()}/equipamentos/${id}/desativar`, { method: 'POST', headers: headersEquipamentos() });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error);
        showNotification(body.message || 'Desativado', 'success');
        loadEquipamentos();
    } catch (err) {
        showNotification(err.message, 'danger');
    }
}

function atualizarPainelConexaoTcp(dados) {
    const painel = document.getElementById('painel-conexao-tcp');
    if (!painel || !dados) return;
    painel.style.display = 'block';
    const eq = dados.equipamento || {};
    const conectado = dados.sucesso === true;
    const el = (id, html) => { const e = document.getElementById(id); if (e) e.innerHTML = html; };
    el('tcp-status', conectado ? '<span class="text-success">Sucesso</span>' : '<span class="text-danger">Falha</span>');
    el('tcp-conectado', conectado ? 'Teste OK (abrir/fechar)' : 'Não');
    const tempo = document.getElementById('tcp-tempo');
    if (tempo) tempo.textContent = formatarDataHoraEquip(eq.ultima_comunicacao || dados.timestamp);
    const erro = document.getElementById('tcp-erro');
    if (erro) erro.textContent = dados.ultimo_erro || eq.ultimo_erro || '—';
}

async function testarEquipamento(id) {
    try {
        const resp = await fetch(`${apiUrlEquipamentos()}/equipamentos/${id}/testar`, {
            method: 'POST',
            headers: headersEquipamentos()
        });
        const body = await resp.json();
        if (!resp.ok && !body.mensagem) throw new Error(body.error || 'Erro no teste');
        if (body.comunicacao_real) atualizarPainelConexaoTcp(body);
        showNotification(body.mensagem || 'Teste concluído', body.sucesso ? 'success' : 'warning');
        loadEquipamentos();
    } catch (err) {
        showNotification(err.message, 'danger');
    }
}

function abrirModalDiagnostico(diag) {
    const d = diag.diagnostico || {};
    $('#modal-container').html(`
        <div class="modal fade" id="modalDiagnosticoEq" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header bg-warning">
                        <h5 class="modal-title"><i class="fas fa-stethoscope"></i> Diagnóstico — ${escapeHtmlEquipamentos(diag.equipamento?.nome || '')}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <table class="table table-sm">
                            <tr><th>Ping</th><td>${escapeHtmlEquipamentos(d.ping || '—')}</td></tr>
                            <tr><th>Tempo resposta</th><td>${d.tempo_resposta_ms != null ? d.tempo_resposta_ms + ' ms' : '—'}</td></tr>
                            <tr><th>IP / Porta</th><td>${escapeHtmlEquipamentos(d.ip || '—')}:${d.porta || '—'}</td></tr>
                            <tr><th>Driver</th><td>${escapeHtmlEquipamentos(d.driver || '—')}</td></tr>
                            <tr><th>Transporte</th><td>${escapeHtmlEquipamentos(d.transporte || '—')}</td></tr>
                            <tr><th>Versão driver</th><td>${escapeHtmlEquipamentos(d.versao_driver || '—')}</td></tr>
                            <tr><th>Último erro</th><td class="text-danger">${escapeHtmlEquipamentos(d.ultimo_erro || '—')}</td></tr>
                            <tr><th>Última comunicação</th><td>${formatarDataHoraEquip(d.ultima_comunicacao)}</td></tr>
                        </table>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                    </div>
                </div>
            </div>
        </div>
    `);
    new bootstrap.Modal(document.getElementById('modalDiagnosticoEq')).show();
}

async function diagnosticarEquipamento(id) {
    try {
        const url = id
            ? `${apiUrlEquipamentos()}/equipamentos/${id}/diagnostico`
            : `${apiUrlEquipamentos()}/equipamentos/diagnostico`;
        const resp = await fetch(url, {
            method: id ? 'GET' : 'POST',
            headers: headersEquipamentos(),
            body: id ? undefined : JSON.stringify({ completo: true })
        });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error);
        if (id && body.diagnostico) {
            abrirModalDiagnostico(body);
        } else {
            showNotification(body.mensagem || 'Diagnóstico geral concluído', 'info');
        }
    } catch (err) {
        showNotification(err.message, 'danger');
    }
}

/* ─── Sprint 14.15.1 / RC14.15.3 — Método de Envio + Bridge MGV6 ─── */

function htmlSecaoMgv6(eq) {
    const idEq = eq && eq.id ? Number(eq.id) : '';
    return `
                        <hr class="my-4">
                        <div class="border rounded p-3 bg-light" id="secaoMgv6">
                            <h6 class="fw-bold mb-1"><i class="fas fa-exchange-alt me-1"></i> Método de Envio</h6>
                            <p class="small text-muted mb-3">
                                Escolha <strong>um</strong> método por equipamento. Os pipelines são mutuamente exclusivos.
                                O Driver cadastrado (ex.: Toledo Prix IV Uno) permanece o mesmo; muda apenas o transporte do envio de produtos.
                            </p>
                            <div class="mb-3" id="modoEnvioRadios">
                                <div class="form-check mb-2">
                                    <input class="form-check-input" type="radio" name="modoEnvio" id="modoEnvioTcp" value="TCP" checked onchange="atualizarVisibilidadeMgv6()">
                                    <label class="form-check-label" for="modoEnvioTcp">
                                        <strong>TCP Oficial</strong>
                                        <span class="d-block small text-muted">Comunicação direta com a balança via Driver Toledo.</span>
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input" type="radio" name="modoEnvio" id="modoEnvioMgv6" value="MGV6" onchange="atualizarVisibilidadeMgv6()">
                                    <label class="form-check-label" for="modoEnvioMgv6">
                                        <strong>MGV6 / Compatibilidade Toledo</strong>
                                        <span class="d-block small text-muted">Exportação para MGV6.exe através de arquivo TXT.</span>
                                    </label>
                                </div>
                            </div>
                            <div id="painelConfigMgv6" class="d-none">
                                <div class="mb-2">
                                    <span class="badge bg-secondary me-1">Transporte: Arquivo / MGV6</span>
                                    <span class="badge bg-light text-dark border">Não requer TCP conectado para enviar</span>
                                </div>
                                <div class="row">
                                    <div class="col-md-8 mb-3">
                                        <label class="form-label">Pasta de exportação</label>
                                        <input type="text" class="form-control" id="mgv6ExportFolder"
                                            placeholder="C:\\Program Files (x86)\\Toledo do Brasil\\MGV6\\TXT\\">
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Nome do arquivo</label>
                                        <input type="text" class="form-control" id="mgv6FileName" value="TXITENS.TXT">
                                    </div>
                                    <div class="col-md-8 mb-3">
                                        <label class="form-label">Caminho do MGV6.exe</label>
                                        <input type="text" class="form-control" id="mgv6Executable"
                                            placeholder="C:\\Program Files (x86)\\Toledo do Brasil\\MGV6\\MGV6.exe">
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Encoding</label>
                                        <select class="form-select" id="mgv6Encoding">
                                            <option value="WINDOWS-1252" selected>Windows-1252</option>
                                            <option value="UTF-8">UTF-8</option>
                                        </select>
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Terminador</label>
                                        <select class="form-select" id="mgv6LineEnding">
                                            <option value="CRLF" selected>CRLF</option>
                                            <option value="LF">LF</option>
                                            <option value="CR">CR</option>
                                        </select>
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Modo da informação variável</label>
                                        <select class="form-select" id="mgv6ModoVariavel">
                                            <option value="VALOR" selected>Valor</option>
                                            <option value="PESO">Peso</option>
                                        </select>
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Dígitos PLU</label>
                                        <input type="number" min="1" max="10" class="form-control" id="mgv6DigitosPlu" value="6">
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label class="form-label">Prefixo</label>
                                        <input type="text" class="form-control" id="mgv6Prefixo" value="2">
                                    </div>
                                    <div class="col-md-6 mb-2">
                                        <div class="form-check">
                                            <input class="form-check-input" type="checkbox" id="mgv6DiffPesoUnidade">
                                            <label class="form-check-label" for="mgv6DiffPesoUnidade">Diferenciar Peso/Unidade</label>
                                        </div>
                                    </div>
                                    <div class="col-md-6 mb-2">
                                        <div class="form-check">
                                            <input class="form-check-input" type="checkbox" id="mgv6AutoLaunch">
                                            <label class="form-check-label" for="mgv6AutoLaunch">Auto Launch (abrir MGV6.exe)</label>
                                        </div>
                                    </div>
                                </div>
                                <div class="d-flex flex-wrap gap-2 mt-2">
                                    <button type="button" class="btn btn-outline-primary btn-sm" onclick="salvarConfigMgv6DoFormulario()" ${idEq ? '' : 'disabled title="Salve a balança antes"'}>
                                        Salvar configuração MGV6
                                    </button>
                                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="testarPastaMgv6()" ${idEq ? '' : 'disabled'}>
                                        Testar pasta
                                    </button>
                                    <button type="button" class="btn btn-outline-success btn-sm" onclick="exportarProdutosMgv6()" ${idEq ? '' : 'disabled'}>
                                        Exportar produtos
                                    </button>
                                    <button type="button" class="btn btn-outline-dark btn-sm" onclick="verHistoricoMgv6()" ${idEq ? '' : 'disabled'}>
                                        Ver histórico
                                    </button>
                                </div>
                                <small class="text-muted d-block mt-2">autoLaunch permanece desligado por padrão. MGV6 não é Driver — não altera DriverRegistry / TCP.</small>
                            </div>
                            <input type="hidden" id="mgv6EquipamentoId" value="${idEq}">
                        </div>`;
}

function atualizarVisibilidadeMgv6() {
    const modo = document.querySelector('input[name="modoEnvio"]:checked')?.value || 'TCP';
    const painel = document.getElementById('painelConfigMgv6');
    if (painel) painel.classList.toggle('d-none', modo !== 'MGV6');
}

function coletarConfigMgv6DoFormulario() {
    const modo = document.querySelector('input[name="modoEnvio"]:checked')?.value || 'TCP';
    return {
        modo_envio: modo,
        enabled: modo === 'MGV6',
        exportFolder: document.getElementById('mgv6ExportFolder')?.value?.trim() || '',
        mgv6Executable: document.getElementById('mgv6Executable')?.value?.trim() || '',
        fileName: document.getElementById('mgv6FileName')?.value?.trim() || 'TXITENS.TXT',
        encoding: document.getElementById('mgv6Encoding')?.value || 'WINDOWS-1252',
        lineEnding: document.getElementById('mgv6LineEnding')?.value || 'CRLF',
        autoLaunch: document.getElementById('mgv6AutoLaunch')?.checked === true,
        modoVariavel: document.getElementById('mgv6ModoVariavel')?.value || 'VALOR',
        digitosPlu: Number(document.getElementById('mgv6DigitosPlu')?.value || 6),
        prefixoEtiqueta: document.getElementById('mgv6Prefixo')?.value?.trim() || '2',
        diferenciarPesoUnidade: document.getElementById('mgv6DiffPesoUnidade')?.checked === true
    };
}

function aplicarConfigMgv6NoFormulario(cfg) {
    if (!cfg) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const chk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = Boolean(v); };
    const modo = String(cfg.modo_envio || (cfg.enabled ? 'MGV6' : 'TCP')).toUpperCase() === 'MGV6'
        ? 'MGV6'
        : 'TCP';
    const tcp = document.getElementById('modoEnvioTcp');
    const mgv = document.getElementById('modoEnvioMgv6');
    if (tcp) tcp.checked = modo === 'TCP';
    if (mgv) mgv.checked = modo === 'MGV6';
    set('mgv6ExportFolder', cfg.exportFolder || '');
    set('mgv6Executable', cfg.mgv6Executable || '');
    set('mgv6FileName', cfg.fileName || 'TXITENS.TXT');
    set('mgv6Encoding', cfg.encoding || 'WINDOWS-1252');
    set('mgv6LineEnding', cfg.lineEnding || 'CRLF');
    set('mgv6ModoVariavel', cfg.modoVariavel || 'VALOR');
    set('mgv6DigitosPlu', cfg.digitosPlu != null ? cfg.digitosPlu : 6);
    set('mgv6Prefixo', cfg.prefixoEtiqueta || '2');
    chk('mgv6DiffPesoUnidade', cfg.diferenciarPesoUnidade);
    chk('mgv6AutoLaunch', cfg.autoLaunch);
    atualizarVisibilidadeMgv6();
}

async function carregarConfigMgv6NoFormulario(equipamentoId) {
    try {
        const resp = await fetch(`${apiUrlEquipamentos()}/equipamentos/mgv6/config/${equipamentoId}`, {
            headers: headersEquipamentos()
        });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error || 'Falha ao carregar MGV6');
        aplicarConfigMgv6NoFormulario({
            ...(body.config || {}),
            modo_envio: body.modo_envio || body.config?.modo_envio || 'TCP'
        });
    } catch (err) {
        console.warn('[MGV6]', err.message);
        atualizarVisibilidadeMgv6();
    }
}

async function salvarConfigMgv6DoFormulario() {
    const id = Number(document.getElementById('mgv6EquipamentoId')?.value || document.getElementById('eqId')?.value);
    if (!id) {
        showNotification('Salve a balança antes de gravar a configuração MGV6', 'warning');
        return;
    }
    try {
        const resp = await fetch(`${apiUrlEquipamentos()}/equipamentos/mgv6/config/${id}`, {
            method: 'PUT',
            headers: headersEquipamentos(),
            body: JSON.stringify(coletarConfigMgv6DoFormulario())
        });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error || body.mensagem || 'Erro ao salvar');
        showNotification(body.message || `Método de envio: ${body.modo_envio || 'TCP'}`, 'success');
    } catch (err) {
        showNotification(err.message, 'danger');
    }
}

async function testarPastaMgv6() {
    const id = Number(document.getElementById('mgv6EquipamentoId')?.value || document.getElementById('eqId')?.value);
    const cfg = coletarConfigMgv6DoFormulario();
    try {
        const resp = await fetch(`${apiUrlEquipamentos()}/equipamentos/mgv6/test-folder`, {
            method: 'POST',
            headers: headersEquipamentos(),
            body: JSON.stringify({
                equipamentoId: id,
                exportFolder: cfg.exportFolder,
                fileName: cfg.fileName
            })
        });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error || 'Pasta inválida');
        showNotification(`Pasta OK: ${body.pasta}`, 'success');
    } catch (err) {
        showNotification(err.message, 'danger');
    }
}

async function exportarProdutosMgv6() {
    const id = Number(document.getElementById('mgv6EquipamentoId')?.value || document.getElementById('eqId')?.value);
    if (!id) return showNotification('Equipamento inválido', 'warning');
    if (!confirm('Exportar todos os produtos elegíveis para o arquivo MGV6 desta balança?')) return;
    try {
        await salvarConfigMgv6DoFormulario();
        const resp = await fetch(`${apiUrlEquipamentos()}/equipamentos/mgv6/export-all`, {
            method: 'POST',
            headers: headersEquipamentos(),
            body: JSON.stringify({ equipamentoId: id })
        });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error || 'Falha na exportação');
        showNotification(`Exportado: ${body.arquivo} (${body.quantidade} produtos)`, 'success');
    } catch (err) {
        showNotification(err.message, 'danger');
    }
}

async function verHistoricoMgv6() {
    const id = Number(document.getElementById('mgv6EquipamentoId')?.value || document.getElementById('eqId')?.value);
    try {
        const resp = await fetch(`${apiUrlEquipamentos()}/equipamentos/mgv6/history?equipamentoId=${id}&limite=30`, {
            headers: headersEquipamentos()
        });
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error || 'Falha ao carregar histórico');
        const rows = (body.historico || []).map((h) => `
            <tr>
                <td>${h.id}</td>
                <td>${escapeHtmlEquipamentos(h.arquivo || '')}</td>
                <td>${h.quantidade_produtos ?? ''}</td>
                <td>${escapeHtmlEquipamentos(h.status || '')}</td>
                <td>${escapeHtmlEquipamentos(h.criado_em || '')}</td>
                <td>${h.mgv6_iniciado ? 'sim' : 'não'}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="text-muted">Sem exportações</td></tr>';
        $('#modal-container').append(`
            <div class="modal fade" id="modalHistMgv6" tabindex="-1">
                <div class="modal-dialog modal-lg modal-dialog-scrollable">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Histórico MGV6</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <table class="table table-sm">
                                <thead><tr><th>ID</th><th>Arquivo</th><th>Qtd</th><th>Status</th><th>Quando</th><th>MGV6</th></tr></thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                        </div>
                    </div>
                </div>
            </div>`);
        new bootstrap.Modal(document.getElementById('modalHistMgv6')).show();
    } catch (err) {
        showNotification(err.message, 'danger');
    }
}

window.salvarConfigMgv6DoFormulario = salvarConfigMgv6DoFormulario;
window.testarPastaMgv6 = testarPastaMgv6;
window.exportarProdutosMgv6 = exportarProdutosMgv6;
window.verHistoricoMgv6 = verHistoricoMgv6;
window.atualizarVisibilidadeMgv6 = atualizarVisibilidadeMgv6;
