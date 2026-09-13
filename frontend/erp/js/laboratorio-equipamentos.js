/**
 * Laboratório de Equipamentos — Motor Universal (Sprint 12)
 */

let labEquipamentosCache = [];
let labDriversCache = [];
let labCapturasCache = [];
let labEquipamentoSelecionado = null;
let labCapturaSelecionada = null;
let labPollingPacotes = null;

function escapeHtmlLab(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function headersLab() {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

function apiUrlLab() {
    return (typeof API_URL === 'string' && API_URL.trim() !== '') ? API_URL : `${window.location.origin}/api`;
}

function urlLab(path) {
    return `${apiUrlLab()}/laboratorio-equipamentos${path}`;
}

async function labFetch(path, options = {}) {
    const resp = await fetch(urlLab(path), {
        headers: headersLab(),
        ...options
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        throw new Error(data.error || `Erro HTTP ${resp.status}`);
    }
    return data;
}

async function carregarDadosLaboratorio() {
    const [eq, drivers, capturas] = await Promise.all([
        labFetch('/equipamentos'),
        labFetch('/drivers'),
        labFetch('/capturas')
    ]);
    labEquipamentosCache = eq.equipamentos || [];
    labDriversCache = drivers.drivers || [];
    labCapturasCache = capturas.capturas || [];
    return { equipamentos: labEquipamentosCache, drivers: labDriversCache, capturas: labCapturasCache };
}

function renderOpcoesEquipamentos() {
    if (!labEquipamentosCache.length) {
        return '<option value="">Nenhum equipamento cadastrado</option>';
    }
    return labEquipamentosCache.map((eq) => `
        <option value="${eq.id}" ${String(labEquipamentoSelecionado) === String(eq.id) ? 'selected' : ''}>
            #${eq.id} — ${escapeHtmlLab(eq.nome || eq.modelo || 'Balança')} (${escapeHtmlLab(eq.ip || '—')})
        </option>
    `).join('');
}

function renderOpcoesCapturas() {
    if (!labCapturasCache.length) {
        return '<option value="">Nenhuma captura salva</option>';
    }
    return labCapturasCache.map((c) => `
        <option value="${escapeHtmlLab(c.id)}" ${labCapturaSelecionada === c.id ? 'selected' : ''}>
            ${escapeHtmlLab(c.id)} (${c.total_pacotes ?? '?'} pacotes)
        </option>
    `).join('');
}

function renderTabelaPacotes(pacotes) {
    if (!pacotes || !pacotes.length) {
        return '<tr><td colspan="10" class="text-muted text-center">Nenhum pacote registrado</td></tr>';
    }
    return pacotes.slice(-200).reverse().map((p, idx) => {
        const flags = [];
        if (p.ack) flags.push('<span class="badge bg-success">ACK</span>');
        if (p.nak) flags.push('<span class="badge bg-danger">NAK</span>');
        if (p.timeout) flags.push('<span class="badge bg-warning text-dark">TIMEOUT</span>');
        if (p.erro) flags.push('<span class="badge bg-danger">ERRO</span>');
        const dir = p.tx ? 'TX' : (p.rx ? 'RX' : (p.direcao || '?'));
        const badgeDir = dir === 'TX'
            ? 'bg-primary'
            : (dir === 'RX' ? 'bg-info text-dark' : 'bg-secondary');
        return `
            <tr>
                <td class="small">${escapeHtmlLab(p.timestamp || '')}</td>
                <td><span class="badge ${badgeDir}">${escapeHtmlLab(dir)}</span></td>
                <td class="font-monospace small text-break" style="max-width:200px">${escapeHtmlLab(p.hex || '')}</td>
                <td class="small">${escapeHtmlLab(p.ascii || '')}</td>
                <td>${p.bytes ?? p.tamanho ?? 0}</td>
                <td class="small">${escapeHtmlLab(p.driver || '—')}</td>
                <td class="small">${escapeHtmlLab(p.ip || p.host || '—')}:${escapeHtmlLab(p.porta ?? '—')}</td>
                <td>${p.tempo_resposta_ms != null ? `${p.tempo_resposta_ms}ms` : '—'}</td>
                <td>${flags.join(' ') || '—'}</td>
                <td>
                    <button class="btn btn-sm btn-outline-secondary" onclick="labReplayPacote(${pacotes.length - 1 - idx})" title="Replay">
                        <i class="fas fa-redo"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderLaboratorioHtml() {
    return `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <div>
                <h4 class="mb-0"><i class="fas fa-flask"></i> Laboratório de Equipamentos</h4>
                <small class="text-muted">Diagnóstico, captura, replay e análise de protocolo</small>
            </div>
            <button class="btn btn-outline-secondary btn-sm" onclick="loadPage('equipamentos')">
                <i class="fas fa-weight"></i> Gerenciar Balanças
            </button>
        </div>

        <div class="row g-3">
            <div class="col-lg-4">
                <div class="card h-100">
                    <div class="card-header"><i class="fas fa-plug"></i> Conexão</div>
                    <div class="card-body">
                        <label class="form-label">Equipamento</label>
                        <select id="lab-equipamento" class="form-select mb-2" onchange="labSelecionarEquipamento(this.value)">
                            ${renderOpcoesEquipamentos()}
                        </select>
                        <div class="d-grid gap-2">
                            <button class="btn btn-success" onclick="labConectar()"><i class="fas fa-link"></i> Conectar</button>
                            <button class="btn btn-outline-danger" onclick="labDesconectar()"><i class="fas fa-unlink"></i> Desconectar</button>
                            <button class="btn btn-outline-primary" onclick="labPing()"><i class="fas fa-satellite-dish"></i> Ping</button>
                            <button class="btn btn-outline-info" onclick="labStatus()"><i class="fas fa-heartbeat"></i> Status</button>
                            <button class="btn btn-outline-dark" onclick="labDiagnostico()"><i class="fas fa-stethoscope"></i> Diagnóstico completo</button>
                        </div>
                        <pre id="lab-resultado-conexao" class="mt-3 small bg-light p-2 rounded" style="max-height:180px;overflow:auto">—</pre>
                    </div>
                </div>
            </div>

            <div class="col-lg-8">
                <div class="card mb-3">
                    <div class="card-header"><i class="fas fa-paper-plane"></i> Enviar pacote</div>
                    <div class="card-body">
                        <ul class="nav nav-tabs mb-3" role="tablist">
                            <li class="nav-item">
                                <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#lab-tab-hex">HEX</button>
                            </li>
                            <li class="nav-item">
                                <button class="nav-link" data-bs-toggle="tab" data-bs-target="#lab-tab-ascii">ASCII</button>
                            </li>
                            <li class="nav-item">
                                <button class="nav-link" data-bs-toggle="tab" data-bs-target="#lab-tab-frame">Frame Builder</button>
                            </li>
                        </ul>
                        <div class="tab-content">
                            <div class="tab-pane fade show active" id="lab-tab-hex">
                                <textarea id="lab-input-hex" class="form-control font-monospace mb-2" rows="3" placeholder="02 50 49 03"></textarea>
                                <button class="btn btn-primary" onclick="labEnviarHex()"><i class="fas fa-upload"></i> Enviar HEX</button>
                            </div>
                            <div class="tab-pane fade" id="lab-tab-ascii">
                                <textarea id="lab-input-ascii" class="form-control font-monospace mb-2" rows="3" placeholder="texto ASCII"></textarea>
                                <button class="btn btn-primary" onclick="labEnviarAscii()"><i class="fas fa-upload"></i> Enviar ASCII</button>
                            </div>
                            <div class="tab-pane fade" id="lab-tab-frame">
                                <div class="row g-2 mb-2">
                                    <div class="col-md-6">
                                        <label class="form-label small">Driver</label>
                                        <select id="lab-frame-driver" class="form-select form-select-sm">
                                            ${labDriversCache.filter((d) => d.laboratorio_frame_builder).map((d) =>
        `<option value="${escapeHtmlLab(d.codigo)}">${escapeHtmlLab(d.nome || d.codigo)}</option>`
    ).join('') || '<option value="TOLEDO_PRIX4_UNO">TOLEDO_PRIX4_UNO</option>'}
                                        </select>
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label small">Comando</label>
                                        <select id="lab-frame-comando" class="form-select form-select-sm">
                                            <option value="ping">ping</option>
                                            <option value="status">status</option>
                                            <option value="handshake">handshake</option>
                                            <option value="frame">frame (custom)</option>
                                        </select>
                                    </div>
                                </div>
                                <textarea id="lab-frame-payload" class="form-control font-monospace mb-2" rows="2" placeholder='{"comando":"ST"}'></textarea>
                                <button class="btn btn-secondary btn-sm me-2" onclick="labMontarFrame()"><i class="fas fa-hammer"></i> Montar</button>
                                <button class="btn btn-primary btn-sm" onclick="labEnviarFrameMontado()"><i class="fas fa-upload"></i> Enviar frame</button>
                                <pre id="lab-frame-preview" class="mt-2 small bg-light p-2 rounded font-monospace" style="max-height:120px;overflow:auto">—</pre>
                            </div>
                        </div>
                        <pre id="lab-resultado-envio" class="mt-3 small bg-light p-2 rounded" style="max-height:160px;overflow:auto">—</pre>
                    </div>
                </div>
            </div>
        </div>

        <div class="card mt-3">
            <div class="card-header d-flex justify-content-between align-items-center">
                <span><i class="fas fa-stream"></i> Pacotes (TX/RX)</span>
                <div>
                    <button class="btn btn-sm btn-outline-warning me-1" onclick="labIniciarCaptura()"><i class="fas fa-record-vinyl"></i> Capturar</button>
                    <button class="btn btn-sm btn-outline-secondary me-1" onclick="labPararCaptura()"><i class="fas fa-stop"></i> Parar</button>
                    <button class="btn btn-sm btn-outline-success me-1" onclick="labSalvarCaptura()"><i class="fas fa-save"></i> Salvar</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="labLimparPacotes()"><i class="fas fa-eraser"></i> Limpar</button>
                </div>
            </div>
            <div class="card-body p-0 table-responsive">
                <table class="table table-sm table-hover mb-0">
                    <thead class="table-light">
                        <tr>
                            <th>Timestamp</th>
                            <th>Dir</th>
                            <th>HEX</th>
                            <th>ASCII</th>
                            <th>Bytes</th>
                            <th>Driver</th>
                            <th>IP:Porta</th>
                            <th>Latência</th>
                            <th>Flags</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="lab-tabela-pacotes">
                        <tr><td colspan="10" class="text-muted text-center">Carregando...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div class="row g-3 mt-1">
            <div class="col-lg-6">
                <div class="card">
                    <div class="card-header"><i class="fas fa-folder-open"></i> Capturas</div>
                    <div class="card-body">
                        <select id="lab-captura-select" class="form-select mb-2" onchange="labCapturaSelecionada=this.value">
                            ${renderOpcoesCapturas()}
                        </select>
                        <button class="btn btn-sm btn-outline-primary me-1" onclick="labAbrirCaptura()"><i class="fas fa-eye"></i> Abrir</button>
                        <button class="btn btn-sm btn-outline-success" onclick="labExportarCaptura()"><i class="fas fa-file-export"></i> Exportar</button>
                        <pre id="lab-captura-preview" class="mt-2 small bg-light p-2 rounded" style="max-height:200px;overflow:auto">—</pre>
                    </div>
                </div>
            </div>
            <div class="col-lg-6">
                <div class="card">
                    <div class="card-header"><i class="fas fa-not-equal"></i> Comparar capturas</div>
                    <div class="card-body">
                        <div class="row g-2 mb-2">
                            <div class="col-6">
                                <label class="form-label small">Captura A</label>
                                <select id="lab-compare-a" class="form-select form-select-sm">
                                    ${renderOpcoesCapturas()}
                                </select>
                            </div>
                            <div class="col-6">
                                <label class="form-label small">Captura B</label>
                                <select id="lab-compare-b" class="form-select form-select-sm">
                                    ${renderOpcoesCapturas()}
                                </select>
                            </div>
                        </div>
                        <button class="btn btn-sm btn-primary" onclick="labCompararCapturas()"><i class="fas fa-balance-scale"></i> Comparar</button>
                        <pre id="lab-comparacao-resultado" class="mt-2 small bg-light p-2 rounded" style="max-height:240px;overflow:auto">—</pre>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function labIdSelecionado() {
    const id = labEquipamentoSelecionado || document.getElementById('lab-equipamento')?.value;
    if (!id) throw new Error('Selecione um equipamento');
    return id;
}

function labMostrarResultado(elId, obj) {
    const el = document.getElementById(elId);
    if (el) el.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
}

async function labAtualizarPacotes() {
    if (!labEquipamentoSelecionado) return;
    try {
        const data = await labFetch(`/${labEquipamentoSelecionado}/pacotes`);
        const tbody = document.getElementById('lab-tabela-pacotes');
        if (tbody) tbody.innerHTML = renderTabelaPacotes(data.pacotes || []);
    } catch (_) {
        // silencioso no polling
    }
}

function labIniciarPolling() {
    labPararPolling();
    labPollingPacotes = setInterval(labAtualizarPacotes, 2500);
}

function labPararPolling() {
    if (labPollingPacotes) {
        clearInterval(labPollingPacotes);
        labPollingPacotes = null;
    }
}

async function loadLaboratorioEquipamentos() {
    try {
        await carregarDadosLaboratorio();
        if (!labEquipamentoSelecionado && labEquipamentosCache.length) {
            labEquipamentoSelecionado = labEquipamentosCache[0].id;
        }
        $('#page-content').html(renderLaboratorioHtml());
        labIniciarPolling();
        await labAtualizarPacotes();
    } catch (error) {
        $('#page-content').html(`<div class="alert alert-danger">${escapeHtmlLab(error.message)}</div>`);
    }
}

function labSelecionarEquipamento(id) {
    labEquipamentoSelecionado = id || null;
    labAtualizarPacotes();
}

async function labConectar() {
    try {
        const data = await labFetch(`/${labIdSelecionado()}/conectar`, { method: 'POST' });
        labMostrarResultado('lab-resultado-conexao', data.resultado);
        showNotification('Conectado', 'success');
        await labAtualizarPacotes();
    } catch (error) {
        showNotification(error.message, 'danger');
        labMostrarResultado('lab-resultado-conexao', error.message);
    }
}

async function labDesconectar() {
    try {
        const data = await labFetch(`/${labIdSelecionado()}/desconectar`, { method: 'POST' });
        labMostrarResultado('lab-resultado-conexao', data.resultado);
        showNotification('Desconectado', 'info');
    } catch (error) {
        showNotification(error.message, 'danger');
    }
}

async function labPing() {
    try {
        const data = await labFetch(`/${labIdSelecionado()}/ping`, { method: 'POST' });
        labMostrarResultado('lab-resultado-conexao', data.resultado);
    } catch (error) {
        labMostrarResultado('lab-resultado-conexao', error.message);
    }
}

async function labStatus() {
    try {
        const data = await labFetch(`/${labIdSelecionado()}/status`);
        labMostrarResultado('lab-resultado-conexao', data.resultado);
    } catch (error) {
        labMostrarResultado('lab-resultado-conexao', error.message);
    }
}

async function labDiagnostico() {
    try {
        const data = await labFetch(`/${labIdSelecionado()}/diagnostico`);
        labMostrarResultado('lab-resultado-conexao', data.diagnostico);
    } catch (error) {
        labMostrarResultado('lab-resultado-conexao', error.message);
    }
}

async function labEnviarHex() {
    const hex = document.getElementById('lab-input-hex')?.value || '';
    try {
        const data = await labFetch(`/${labIdSelecionado()}/enviar/hex`, {
            method: 'POST',
            body: JSON.stringify({ hex })
        });
        labMostrarResultado('lab-resultado-envio', data.resultado);
        await labAtualizarPacotes();
    } catch (error) {
        labMostrarResultado('lab-resultado-envio', error.message);
    }
}

async function labEnviarAscii() {
    const ascii = document.getElementById('lab-input-ascii')?.value || '';
    try {
        const data = await labFetch(`/${labIdSelecionado()}/enviar/ascii`, {
            method: 'POST',
            body: JSON.stringify({ ascii })
        });
        labMostrarResultado('lab-resultado-envio', data.resultado);
        await labAtualizarPacotes();
    } catch (error) {
        labMostrarResultado('lab-resultado-envio', error.message);
    }
}

let labFrameMontadoHex = '';

async function labMontarFrame() {
    const driver_codigo = document.getElementById('lab-frame-driver')?.value;
    const comando = document.getElementById('lab-frame-comando')?.value;
    let payload = document.getElementById('lab-frame-payload')?.value || '{}';
    try {
        payload = JSON.parse(payload);
    } catch (_) {
        payload = { texto: payload };
    }
    try {
        const data = await labFetch('/frame', {
            method: 'POST',
            body: JSON.stringify({ driver_codigo, comando, payload })
        });
        labFrameMontadoHex = data.frame?.hex || '';
        labMostrarResultado('lab-frame-preview', data.frame);
    } catch (error) {
        labMostrarResultado('lab-frame-preview', error.message);
    }
}

async function labEnviarFrameMontado() {
    if (!labFrameMontadoHex) {
        await labMontarFrame();
    }
    const input = document.getElementById('lab-input-hex');
    if (input) input.value = labFrameMontadoHex;
    await labEnviarHex();
}

async function labLimparPacotes() {
    try {
        await labFetch(`/${labIdSelecionado()}/pacotes`, { method: 'DELETE' });
        await labAtualizarPacotes();
        showNotification('Pacotes limpos', 'info');
    } catch (error) {
        showNotification(error.message, 'danger');
    }
}

async function labIniciarCaptura() {
    try {
        const data = await labFetch(`/${labIdSelecionado()}/captura/iniciar`, {
            method: 'POST',
            body: JSON.stringify({ equipamento_id: labIdSelecionado() })
        });
        showNotification('Captura iniciada', 'success');
        labMostrarResultado('lab-captura-preview', data);
    } catch (error) {
        showNotification(error.message, 'danger');
    }
}

async function labPararCaptura() {
    try {
        const data = await labFetch('/captura/parar', { method: 'POST' });
        showNotification('Captura parada', 'info');
        labMostrarResultado('lab-captura-preview', data);
    } catch (error) {
        showNotification(error.message, 'danger');
    }
}

async function labSalvarCaptura() {
    const nome = prompt('Nome da captura (opcional):', `captura-${Date.now()}`);
    if (nome === null) return;
    try {
        const parada = await labFetch('/captura/parar', { method: 'POST' });
        const data = await labFetch('/captura/salvar', {
            method: 'POST',
            body: JSON.stringify({ nome, sessao: parada.sessao })
        });
        showNotification('Captura salva', 'success');
        labMostrarResultado('lab-captura-preview', data.exportado);
        await carregarDadosLaboratorio();
        const sel = document.getElementById('lab-captura-select');
        if (sel) sel.innerHTML = renderOpcoesCapturas();
    } catch (error) {
        showNotification(error.message, 'danger');
    }
}

async function labAbrirCaptura() {
    const id = document.getElementById('lab-captura-select')?.value;
    if (!id) return showNotification('Selecione uma captura', 'warning');
    try {
        const data = await labFetch(`/capturas/${encodeURIComponent(id)}`);
        labCapturaSelecionada = id;
        labMostrarResultado('lab-captura-preview', {
            id: data.captura?.id,
            total: (data.captura?.pacotes || []).length,
            pacotes: (data.captura?.pacotes || []).slice(0, 5)
        });
    } catch (error) {
        labMostrarResultado('lab-captura-preview', error.message);
    }
}

async function labExportarCaptura() {
    await labAbrirCaptura();
    showNotification('Metadados da captura exibidos — arquivos em disco no servidor', 'info');
}

async function labReplayPacote(indice) {
    const capturaId = document.getElementById('lab-captura-select')?.value;
    if (!capturaId) {
        return showNotification('Selecione uma captura para replay por índice, ou use pacotes da sessão atual', 'warning');
    }
    try {
        const data = await labFetch(`/${labIdSelecionado()}/replay`, {
            method: 'POST',
            body: JSON.stringify({ captura_id: capturaId, indice: Number(indice) })
        });
        labMostrarResultado('lab-resultado-envio', data.resultado);
        await labAtualizarPacotes();
    } catch (error) {
        showNotification(error.message, 'danger');
    }
}

async function labCompararCapturas() {
    const captura_a = document.getElementById('lab-compare-a')?.value;
    const captura_b = document.getElementById('lab-compare-b')?.value;
    if (!captura_a || !captura_b) {
        return showNotification('Selecione duas capturas', 'warning');
    }
    try {
        const data = await labFetch('/comparar/capturas', {
            method: 'POST',
            body: JSON.stringify({ captura_a, captura_b })
        });
        labMostrarResultado('lab-comparacao-resultado', data.comparacao?.resumo || data.comparacao);
    } catch (error) {
        labMostrarResultado('lab-comparacao-resultado', error.message);
    }
}

window.addEventListener('beforeunload', labPararPolling);
