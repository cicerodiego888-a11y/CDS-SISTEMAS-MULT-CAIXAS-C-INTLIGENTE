function normalizarTexto(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .normalize('NFC')
        .toLowerCase();
}

// Função utilitária para normalizar produto com categoria e subcategoria
function normalizarProduto(produto, categorias = window.categoriasSistema || []) {
    const categoriaId = String(produto.categoria_id || produto.categoriaId || '');
    const subcategoriaId = String(produto.subcategoria_id || produto.subcategoriaId || '');
    const categoriaObj = categorias.find(c => String(c.id) === categoriaId);
    const subcategoriaObj = categoriaObj && categoriaObj.subcategorias ? categoriaObj.subcategorias.find(s => String(s.id) === subcategoriaId) : null;
    const flagFracionado = Number(produto.produto_fracionado ?? produto.vendido_por_peso ?? 0) ? 1 : 0;
    return {
        ...produto,
        produto_fracionado: flagFracionado,
        categoria: produto.categoria || produto.categoria_nome || (categoriaObj ? categoriaObj.nome : ''),
        subcategoria: produto.subcategoria || produto.subcategoria_nome || (subcategoriaObj ? subcategoriaObj.nome : '')
    };
}

function produtoUsaConversaoUnidades(produto) {
    if (!produto) return false;
    return Number(produto.produto_fracionado ?? produto.vendido_por_peso ?? 0) === 1;
}

/** @deprecated Alias legado — use produtoUsaConversaoUnidades */
function produtoEhFracionado(produto) {
    return produtoUsaConversaoUnidades(produto);
}

const UNIDADES_VENDA_CONVERSAO = new Set(['kg', 'g', 'l', 'ml', 'mt', 'm2', 'm3']);

function unidadeVendaSuportaConversao(unidade) {
    return UNIDADES_VENDA_CONVERSAO.has(String(unidade || '').toLowerCase());
}

function produtoCadastroUsaConversaoUnidades() {
    return $('#produto_fracionado').is(':checked');
}

function obterStepEstoqueProduto(unidade, usaConversao = false) {
    const unidadeNorm = String(unidade || '').toLowerCase();
    if (usaConversao || unidadeVendaSuportaConversao(unidadeNorm)) {
        return '0.001';
    }
    return '0.01';
}

function formatarCustoUnitarioCadastro(valor, usaConversao = false) {
    const numero = Number(valor || 0);
    if (!Number.isFinite(numero)) return usaConversao ? '0.0000' : '0';
    return usaConversao ? numero.toFixed(4) : String(numero);
}

function custoUnitarioVendaCadastro(valor) {
    const numero = Number(valor || 0);
    return Number.isFinite(numero) ? Math.round(numero * 10000) / 10000 : 0;
}

function resolverCustoUnitarioProdutoCadastro(produto = {}) {
    if (!produtoUsaConversaoUnidades(produto)) {
        return custoUnitarioVendaCadastro(produto.preco_compra);
    }

    const pesoTotal = Number(produto.peso_total_compra || 0);
    const valorTotal = Number(produto.valor_total_compra || 0);
    const custoLegado = Number(produto.custo_por_kg || 0);
    const precoCompra = Number(produto.preco_compra || 0);

    let unitarioReferencia = 0;
    if (pesoTotal > 0 && valorTotal > 0) {
        unitarioReferencia = custoUnitarioVendaCadastro(valorTotal / pesoTotal);
    } else if (pesoTotal > 1 && precoCompra > 0) {
        unitarioReferencia = custoUnitarioVendaCadastro(precoCompra / pesoTotal);
    }

    if (custoLegado > 0) {
        const pareceEmbalagem = precoCompra <= 0
            || (valorTotal > 0 && Math.abs(precoCompra - valorTotal) < 0.02)
            || (unitarioReferencia > 0 && precoCompra >= unitarioReferencia * 3);
        if (pareceEmbalagem && custoLegado < precoCompra) {
            return custoUnitarioVendaCadastro(custoLegado);
        }
    }

    if (unitarioReferencia > 0) {
        const pareceEmbalagem = precoCompra <= 0
            || (valorTotal > 0 && Math.abs(precoCompra - valorTotal) < 0.02)
            || precoCompra >= unitarioReferencia * 3;
        if (pareceEmbalagem) {
            return unitarioReferencia;
        }
    }

    return custoUnitarioVendaCadastro(precoCompra);
}

function parseNumeroCadastro(valor) {
    if (valor === null || valor === undefined) return 0;
    let texto = String(valor).trim();
    if (!texto) return 0;
    if (texto.includes(',') && texto.includes('.')) {
        texto = texto.replace(/\./g, '').replace(',', '.');
    } else if (texto.includes(',')) {
        texto = texto.replace(',', '.');
    }
    const numero = parseFloat(texto);
    return Number.isFinite(numero) ? numero : 0;
}

/**
 * Ponte UX 06 — referência do Motor de Conversão a partir dos campos oficiais da tela
 * (Quantidade Total do Estoque Inicial + Custo Unitário), sem o card removido.
 * @returns {{ valor: number, qtd: number, precoCompra: number }}
 */
function obterReferenciaConversaoCadastro() {
    const qtd = Number(obterSaldosIniciaisDoFormulario().estoque_total || 0);
    const precoCompra = parseNumeroCadastro($('#preco_compra').val());
    const valor = (qtd > 0 && precoCompra > 0)
        ? Number((qtd * precoCompra).toFixed(4))
        : 0;
    return { valor, qtd, precoCompra };
}

function aplicarModoConversaoUnidadesCadastro() {
    const $modal = $('#produtoModal');
    if (!$modal.length) return;

    const ativo = produtoCadastroUsaConversaoUnidades();
    const unidade = ($('#unidade').val() || '').toLowerCase();
    const stepEstoque = obterStepEstoqueProduto(unidade, ativo);

    $('#label_unidade_produto').text(ativo ? 'Unidade de Venda *' : 'Unidade Base');
    $('#label_preco_compra_produto').text(
        ativo ? 'Custo por Unidade de Venda' : 'Custo Unitário'
    );
    $('#hint_preco_compra_produto').toggleClass('d-none', !ativo);
    $('#avisoUnidadeConversaoCadastro').toggleClass(
        'd-none',
        !ativo || unidadeVendaSuportaConversao(unidade)
    );

    $('#preco_compra')
        .attr('step', ativo ? '0.0001' : '0.01')
        .prop('readonly', false)
        .removeClass('bg-light');
    $('#saldo_fiscal_inicial, #saldo_nao_fiscal_inicial, #estoque_minimo').attr('step', stepEstoque);

    if (typeof atualizarPreviewEstoqueTotalInicial === 'function') {
        atualizarPreviewEstoqueTotalInicial();
    }

    aplicarModoVendaUnidadeCadastro();
}

function aplicarModoVendaUnidadeCadastro() {
    const fracionado = produtoCadastroUsaConversaoUnidades();
    const permiteUnidade = $('#permite_venda_unidade').is(':checked');

    $('#painelVendaUnidadeCadastro').toggleClass('d-none', !fracionado);
    $('#painelCamposVendaUnidadeCadastro').toggleClass('d-none', !fracionado || !permiteUnidade);

    if (!fracionado) {
        $('#permite_venda_unidade').prop('checked', false);
    }
}

function inicializarVendaUnidadeCadastro(produto, isEdit) {
    const $modal = $('#produtoModal');
    if (!$modal.length) return;

    if (isEdit && produto) {
        $('#permite_venda_unidade').prop('checked', Number(produto.permite_venda_unidade ?? 0) === 1);
        $('#peso_medio_unidade').val(Number(produto.peso_medio_unidade ?? 0) || '');
        $('#preco_unidade').val(Number(produto.preco_unidade ?? 0) || '');
    }

    $modal
        .off('change.vendaUnidadeCadastro')
        .on('change.vendaUnidadeCadastro', '#produto_fracionado, #permite_venda_unidade', aplicarModoVendaUnidadeCadastro);

    aplicarModoVendaUnidadeCadastro();
}

/** RC15.3 — produto elegível para envio individual à balança (UI do modal). */
function produtoCadastroElegivelEnvioBalanca(produtoHint = null) {
    const id = Number($('#produtoId').val() || produtoHint?.id || 0);
    if (!Number.isFinite(id) || id <= 0) return false;

    const pesavel = $('#produto_fracionado').length
        ? $('#produto_fracionado').is(':checked')
        : Number(produtoHint?.produto_fracionado ?? produtoHint?.vendido_por_peso ?? 0) === 1;
    if (!pesavel) return false;

    const plu = String($('#plu').val() || produtoHint?.plu || '').replace(/\D/g, '');
    if (!plu || plu.length > 10) return false;

    const $painel = $('#painelEnvioBalancaProduto');
    const ativoFlag = $painel.attr('data-produto-ativo');
    const ativo = ativoFlag != null
        ? ativoFlag !== '0'
        : !(produtoHint && (produtoHint.ativo === 0 || produtoHint.ativo === false || produtoHint.ativo === '0'));
    if (!ativo) return false;

    const tipo = String(produtoHint?.tipo || produtoHint?.tipo_produto || '').toUpperCase();
    if (tipo.includes('SERVICO') || tipo.includes('SERVIÇO') || tipo.includes('COMBO') || tipo.includes('KIT')) {
        return false;
    }
    if (produtoHint?.servico === 1 || produtoHint?.combo === 1 || produtoHint?.is_combo === 1) {
        return false;
    }
    return true;
}

/**
 * RC15.3.1 — elegível para a pergunta pós-salvar (usa dados do produto, sem depender do modal aberto).
 */
function produtoSalvoElegivelPerguntaBalanca(produto) {
    if (!produto || !produto.id) return false;
    if (Number(produto.ativo ?? 1) !== 1) return false;
    if (Number(produto.produto_fracionado ?? produto.vendido_por_peso ?? 0) !== 1) return false;
    const plu = String(produto.plu || '').replace(/\D/g, '');
    if (!plu || plu.length > 10) return false;
    const tipo = String(produto.tipo || produto.tipo_produto || '').toUpperCase();
    if (tipo.includes('SERVICO') || tipo.includes('SERVIÇO') || tipo.includes('COMBO') || tipo.includes('KIT')) {
        return false;
    }
    if (produto.servico === 1 || produto.combo === 1 || produto.is_combo === 1) return false;
    return true;
}

async function resolverEquipamentoBalancaPadrao(preferidoId = null) {
    const pref = Number(preferidoId || 0);
    if (Number.isFinite(pref) && pref > 0) return pref;
    try {
        const token = localStorage.getItem('token') || '';
        const resp = await fetch(`${API_URL}/equipamentos?todos=1`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const body = await resp.json().catch(() => ([]));
        const lista = Array.isArray(body) ? body : (body.equipamentos || body.data || []);
        let eqs = lista.filter((e) => {
            const driver = String(e.driver_codigo || e.driver || '').toUpperCase();
            const fab = String(e.fabricante || '').toLowerCase();
            const modelo = String(e.modelo || '').toLowerCase();
            return driver.includes('TOLEDO') || fab.includes('toledo') || modelo.includes('prix');
        });
        if (!eqs.length) eqs = lista.filter((e) => e.ip || e.host);
        return eqs.length ? Number(eqs[0].id) : 0;
    } catch (_) {
        return 0;
    }
}

/**
 * RC15.3.1 — envio por id (após salvar / modal já fechado).
 * RC14.15.3 — respeita modo_envio (TCP → upload-produto | MGV6 → /mgv6/export-all).
 * MGV6: TXITENS.TXT é dump completo — sempre exporta todos os elegíveis
 * (envio parcial sobrescreve o arquivo e apaga os demais PLUs na carga).
 */
/** RC15.5 — monta mensagem legível a partir do ValidationReport. */
function formatarMotivosValidacaoBalanca(body) {
    const motivos = Array.isArray(body?.motivos) && body.motivos.length
        ? body.motivos
        : (Array.isArray(body?.errors)
            ? body.errors.map((e) => (typeof e === 'string' ? e : e.motivo)).filter(Boolean)
            : []);
    if (motivos.length) {
        return `Produto não enviado\nMotivo:\n${motivos.map((m) => `• ${m}`).join('\n')}`;
    }
    const msg = body?.error || body?.mensagem || 'Falha ao enviar produto.';
    if (String(msg).toUpperCase() === 'VALIDATION_ERROR') {
        return 'Produto não enviado\nMotivo:\n• Validação falhou (detalhes indisponíveis).';
    }
    return msg;
}

async function obterModoEnvioEquipamentoProduto(equipamentoId) {
    const eid = Number(equipamentoId);
    if (!Number.isFinite(eid) || eid <= 0) return 'TCP';
    try {
        const token = localStorage.getItem('token') || '';
        const resp = await fetch(`${API_URL}/equipamentos/mgv6/config/${eid}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const body = await resp.json().catch(() => ({}));
        const modo = String(body.modo_envio || body.config?.modo_envio || 'TCP').toUpperCase();
        return modo === 'MGV6' ? 'MGV6' : 'TCP';
    } catch (_) {
        return 'TCP';
    }
}

async function enviarProdutoParaBalancaPorId(produtoId, equipamentoId) {
    const pid = Number(produtoId);
    const eid = Number(equipamentoId);
    if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(eid) || eid <= 0) {
        throw new Error('Produto ou equipamento inválido para envio.');
    }
    const token = localStorage.getItem('token') || '';
    const modo = await obterModoEnvioEquipamentoProduto(eid);

    if (modo === 'MGV6') {
        // Sempre catálogo completo: TXITENS parcial apaga os demais PLUs na balança.
        const resp = await fetch(`${API_URL}/equipamentos/mgv6/export-all`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ equipamentoId: eid, autoLaunch: false })
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok || body.sucesso === false) {
            const err = new Error(body.mensagem || body.error || 'Falha na exportação MGV6.');
            err.code = body.codigo || body.code;
            throw err;
        }

        let mgv6Iniciado = false;
        if (body.mgv6?.encontrado) {
            const deseja = typeof epbPerguntarIniciarSoftwareBalanca === 'function'
                ? await epbPerguntarIniciarSoftwareBalanca()
                : window.confirm('Deseja iniciar o software da balança?');
            if (deseja) {
                const launchResp = await fetch(`${API_URL}/equipamentos/mgv6/launch`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({ equipamentoId: eid })
                });
                const launchBody = await launchResp.json().catch(() => ({}));
                mgv6Iniciado = Boolean(launchResp.ok && launchBody.iniciado);
            }
        } else if (typeof showNotification === 'function') {
            showNotification('Software MGV6 não encontrado neste computador.', 'warning');
        }

        return {
            success: true,
            sucesso: true,
            modo_envio: 'MGV6',
            arquivo: body.arquivo,
            quantidade: body.quantidade,
            caminho: body.caminho,
            omitidosSemPlu: body.omitidosSemPlu || [],
            quantidadeOmitidosSemPlu: body.quantidadeOmitidosSemPlu || 0,
            aviso: body.aviso || null,
            mgv6Iniciado,
            transmitidoBalanca: false
        };
    }

    const resp = await fetch(`${API_URL}/equipamentos/${eid}/upload-produto`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ produtoId: pid })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || body.success === false) {
        const err = new Error(formatarMotivosValidacaoBalanca(body));
        err.validationReport = body.validationReport || null;
        err.motivos = body.motivos || null;
        throw err;
    }
    return body;
}

function fecharDialogoEnviarBalancaAposSalvar() {
    const el = document.getElementById('modalEnviarBalancaAposSalvar');
    if (!el) return;
    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        const inst = bootstrap.Modal.getInstance(el);
        if (inst) inst.hide();
        else bootstrap.Modal.getOrCreateInstance(el).hide();
    } else {
        $(el).modal('hide');
    }
    setTimeout(() => $(el).remove(), 400);
}

function abrirProximoCadastroProdutoAposSalvar() {
    if (typeof showProdutoModal === 'function') {
        showProdutoModal(null);
    }
}

/**
 * RC15.3.1 — diálogo opcional após salvar produto pesável.
 * @param {function} [aoConcluir] chamado ao fechar o diálogo (ou se o produto não for elegível).
 */
async function perguntarEnvioBalancaAposSalvar(produto, equipamentoIdPreferido = null, aoConcluir = null) {
    const concluirUmaVez = () => {
        if (typeof aoConcluir !== 'function') return;
        const fn = aoConcluir;
        aoConcluir = null;
        fn();
    };

    if (!produtoSalvoElegivelPerguntaBalanca(produto)) {
        concluirUmaVez();
        return;
    }

    const eqPreferido = equipamentoIdPreferido || Number($('#balancaProdutoEquipamento').val() || 0);
    let modoDialogo = 'TCP';
    try {
        const eqIdModo = await resolverEquipamentoBalancaPadrao(eqPreferido);
        if (eqIdModo) modoDialogo = await obterModoEnvioEquipamentoProduto(eqIdModo);
    } catch (_) {
        modoDialogo = 'TCP';
    }

    $('#modalEnviarBalancaAposSalvar').remove();
    const nome = escapeHtml(produto.nome || 'este produto');
    const perguntaMgv6 = modoDialogo === 'MGV6';
    const textoPergunta = perguntaMgv6
        ? 'Deseja atualizar o catálogo completo na balança agora?'
        : 'Deseja enviar este produto para a balança agora?';
    const textoExtra = perguntaMgv6
        ? `<p class="text-muted small mt-2 mb-0">${nome}</p>
           <p class="text-muted small mt-2 mb-0">No MGV6 o arquivo TXITENS inclui todos os produtos elegíveis (envio de um só apaga os demais PLUs).</p>`
        : `<p class="text-muted small mt-2 mb-0">${nome}</p>`;
    const html = `
        <div class="modal fade" id="modalEnviarBalancaAposSalvar" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Produto salvo com sucesso.</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-0">${textoPergunta}</p>
                        ${textoExtra}
                        <div class="small text-muted mt-2 d-none" id="envioBalancaAposSalvarStatus" aria-live="polite"></div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-outline-secondary" id="btnBalancaAposSalvarDepois">Depois</button>
                        <button type="button" class="btn btn-primary" id="btnBalancaAposSalvarAgora">Enviar Agora</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('body').append(html);

    const el = document.getElementById('modalEnviarBalancaAposSalvar');
    const mostrar = () => {
        if (el && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            bootstrap.Modal.getOrCreateInstance(el).show();
        } else {
            $('#modalEnviarBalancaAposSalvar').modal('show');
        }
    };
    // Aguarda o modal de produto fechar para não empilhar backdrop
    setTimeout(mostrar, 350);

    $(el).one('hidden.bs.modal', () => concluirUmaVez());

    $('#btnBalancaAposSalvarDepois').on('click', () => {
        fecharDialogoEnviarBalancaAposSalvar();
    });

    $('#btnBalancaAposSalvarAgora').on('click', async function onEnviarAgora() {
        const $btn = $(this);
        const $st = $('#envioBalancaAposSalvarStatus');
        $btn.prop('disabled', true);
        $('#btnBalancaAposSalvarDepois').prop('disabled', true);
        const statusMsg = perguntaMgv6
            ? '⏳ Preparando catálogo completo (MGV6)...'
            : '⏳ Enviando produto...';
        $st.removeClass('d-none text-danger text-success').addClass('text-muted').text(statusMsg);
        try {
            const eqId = await resolverEquipamentoBalancaPadrao(
                equipamentoIdPreferido || Number($('#balancaProdutoEquipamento').val() || 0)
            );
            if (!eqId) {
                throw new Error('Nenhum equipamento Toledo cadastrado.');
            }
            const modoEq = await obterModoEnvioEquipamentoProduto(eqId);
            const result = await enviarProdutoParaBalancaPorId(produto.id, eqId);
            fecharDialogoEnviarBalancaAposSalvar();
            if (modoEq === 'MGV6' || result?.modo_envio === 'MGV6') {
                const qtd = Number(result?.quantidade);
                const qtdTxt = Number.isFinite(qtd) && qtd > 0 ? ` (${qtd} produtos)` : '';
                const omit = Number(result?.quantidadeOmitidosSemPlu) || 0;
                showNotification(
                    `Catálogo completo preparado para o MGV6${qtdTxt}. ` +
                    'TXITENS.TXT gravado e MGV6 iniciado (se configurado). ' +
                    'Para transmitir à balança: Carga → Solicitar Carga das Balanças → Enviar.',
                    'success'
                );
                if (omit > 0) {
                    showNotification(
                        result.aviso ||
                        `${omit} produto(s) omitido(s) sem PLU. Cadastre o PLU ou desmarque Integrar com Balança.`,
                        'warning'
                    );
                }
            } else {
                showNotification('Produto enviado para a balança.', 'success');
            }
        } catch (err) {
            $st.removeClass('text-muted text-success').addClass('text-danger').text(`❌ ${err.message || 'Falha ao enviar produto.'}`);
            $btn.prop('disabled', false);
            $('#btnBalancaAposSalvarDepois').prop('disabled', false);
            showNotification(err.message || 'Falha ao enviar produto.', 'danger');
        }
    });
}

function formatarDataHoraBalancaProduto(iso) {
    if (!iso) return 'Nunca';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return String(iso);
        return d.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (_) {
        return String(iso);
    }
}

function balancaProdutoLogLinha(msg) {
    const el = document.getElementById('balancaProdutoLog');
    if (!el) return;
    el.classList.remove('d-none');
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    el.textContent = `${el.textContent ? `${el.textContent}\n` : ''}${hora}\n${msg}`.trim();
    el.scrollTop = el.scrollHeight;
}

function atualizarVisibilidadePainelEnvioBalancaProduto(produtoHint = null) {
    const $painel = $('#painelEnvioBalancaProduto');
    if (!$painel.length) return;
    const elegivel = produtoCadastroElegivelEnvioBalanca(produtoHint);
    $painel.toggleClass('d-none', !elegivel);
    const $btn = $('#btnEnviarProdutoBalanca');
    const temEq = Boolean(Number($('#balancaProdutoEquipamento').val() || 0));
    $btn.prop('disabled', !elegivel || !temEq || $btn.data('enviando') === true);
    if (elegivel) {
        $('#balancaProdutoStatusApto').text('🟢 Produto apto para balança');
    }
}

async function carregarEquipamentosPainelBalancaProduto() {
    const sel = document.getElementById('balancaProdutoEquipamento');
    if (!sel) return;
    const token = localStorage.getItem('token') || '';
    const headers = { Authorization: `Bearer ${token}` };
    try {
        const resp = await fetch(`${API_URL}/equipamentos?todos=1`, { headers });
        const body = await resp.json().catch(() => ([]));
        const lista = Array.isArray(body) ? body : (body.equipamentos || body.data || []);
        let eqs = lista.filter((e) => {
            const driver = String(e.driver_codigo || e.driver || '').toUpperCase();
            const fab = String(e.fabricante || '').toLowerCase();
            const modelo = String(e.modelo || '').toLowerCase();
            return driver.includes('TOLEDO') || fab.includes('toledo') || modelo.includes('prix');
        });
        if (!eqs.length) {
            eqs = lista.filter((e) => e.ip || e.host);
        }
        sel.innerHTML = eqs.length
            ? eqs.map((e) => {
                const label = `${e.nome || e.modelo || 'Equipamento'} — ${e.ip || e.host || '?'}:${e.porta_tcp || e.porta || 9000}`;
                return `<option value="${e.id}">${String(label).replace(/</g, '&lt;')}</option>`;
            }).join('')
            : '<option value="">Nenhum equipamento Toledo cadastrado</option>';
    } catch (_) {
        sel.innerHTML = '<option value="">Erro ao carregar equipamentos</option>';
    }
}

async function carregarUltimaSyncBalancaProduto(produtoId) {
    const id = Number(produtoId || $('#produtoId').val() || 0);
    const $sync = $('#balancaProdutoUltimaSync');
    const $res = $('#balancaProdutoResultado');
    if (!$sync.length || !id) {
        if ($sync.length) $sync.text('Nunca');
        if ($res.length) $res.text('—').removeClass('text-success text-danger').addClass('text-muted');
        return;
    }
    try {
        const token = localStorage.getItem('token') || '';
        const resp = await fetch(`${API_URL}/equipamentos/plu/ultima-sync?produto_id=${id}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const body = await resp.json().catch(() => ({}));
        if (body.sincronizado_em) {
            $sync.text(formatarDataHoraBalancaProduto(body.sincronizado_em));
            $res.text('🟢 Sincronizado').removeClass('text-muted text-danger').addClass('text-success');
        } else {
            $sync.text('Nunca');
            $res.text('—').removeClass('text-success text-danger').addClass('text-muted');
        }
    } catch (_) {
        $sync.text('Nunca');
    }
}

async function enviarProdutoParaBalancaCadastro() {
    const $btn = $('#btnEnviarProdutoBalanca');
    const $fb = $('#balancaProdutoFeedback');
    const produtoId = Number($('#produtoId').val() || 0);
    const equipamentoId = Number($('#balancaProdutoEquipamento').val() || 0);
    if (!produtoCadastroElegivelEnvioBalanca() || !equipamentoId || !produtoId) {
        showNotification('Salve o produto pesável com PLU válido antes de enviar.', 'warning');
        return;
    }

    $btn.data('enviando', true).prop('disabled', true);
    const modoPainel = await obterModoEnvioEquipamentoProduto(equipamentoId);
    $fb.removeClass('text-success text-danger').addClass('text-muted').text(
        modoPainel === 'MGV6'
            ? '⏳ Preparando catálogo completo (MGV6)...'
            : '⏳ Enviando produto...'
    );

    const nome = String($('#nome').val() || 'Produto').trim();
    const plu = String($('#plu').val() || '').replace(/\D/g, '');
    const inicio = Date.now();

    try {
        const body = await enviarProdutoParaBalancaPorId(produtoId, equipamentoId);
        const tempo = body.tempo_ms != null ? body.tempo_ms : (Date.now() - inicio);
        const isMgv6 = modoPainel === 'MGV6' || body?.modo_envio === 'MGV6';
        const qtd = Number(body.quantidade);
        const okMsg = isMgv6
            ? (Number.isFinite(qtd) && qtd > 0
                ? `✅ Catálogo MGV6 gerado (${qtd} produtos).`
                : '✅ Catálogo completo preparado para o MGV6.')
            : '✅ Produto enviado com sucesso.';

        $fb.removeClass('text-muted text-danger').addClass('text-success').text(okMsg);
        $('#balancaProdutoUltimaSync').text(formatarDataHoraBalancaProduto(body.sincronizado_em || new Date().toISOString()));
        $('#balancaProdutoResultado').text('🟢 Sincronizado').removeClass('text-muted text-danger').addClass('text-success');
        balancaProdutoLogLinha(
            isMgv6
                ? `Produto (gatilho):\n${nome}\nPLU:\n${plu}\nEquipamento:\n${body.equipamento || equipamentoId}\nResultado:\nTXITENS catálogo completo (${Number.isFinite(qtd) ? qtd : '?'} produtos)\nArquivo:\n${body.arquivo || 'TXITENS.TXT'}\nTempo:\n${tempo} ms`
                : `Produto:\n${nome}\nPLU:\n${plu}\nEquipamento:\n${body.equipamento || equipamentoId}\nResultado:\n${body.resultado || 'ACK recebido'}\nTempo:\n${tempo} ms`
        );
        if (!$('#balancaProdutoHistoricoBox').hasClass('d-none')) {
            carregarHistoricoBalancaProduto(produtoId, false);
        }
        showNotification(
            isMgv6
                ? (Number.isFinite(qtd) && qtd > 0
                    ? `Catálogo completo preparado para o MGV6 (${qtd} produtos).`
                    : 'Catálogo completo preparado para o MGV6.')
                : 'Produto enviado com sucesso.',
            'success'
        );
        if (isMgv6 && (Number(body.quantidadeOmitidosSemPlu) || 0) > 0) {
            showNotification(
                body.aviso ||
                `${body.quantidadeOmitidosSemPlu} produto(s) omitido(s) sem PLU. Cadastre o PLU ou desmarque Integrar com Balança.`,
                'warning'
            );
        }
    } catch (err) {
        $fb.removeClass('text-muted text-success').addClass('text-danger').text('❌ Falha ao enviar produto.');
        balancaProdutoLogLinha(`Produto:\n${nome}\nPLU:\n${plu}\nResultado:\n${err.message || 'Erro'}`);
        if (!$('#balancaProdutoHistoricoBox').hasClass('d-none')) {
            carregarHistoricoBalancaProduto(produtoId, false);
        }
        showNotification(err.message || 'Falha ao enviar produto.', 'danger');
    } finally {
        $btn.data('enviando', false);
        atualizarVisibilidadePainelEnvioBalancaProduto();
    }
}

function formatarItemHistoricoBalancaProduto(item) {
    const dt = formatarDataHoraBalancaProduto(item.created_at);
    const ok = String(item.resultado || '').toUpperCase() === 'SUCESSO';
    const titulo = ok ? 'Sucesso' : 'Erro';
    const eq = item.equipamento_nome || item.equipamento_modelo || (item.equipamento_id ? `#${item.equipamento_id}` : '');
    const tempo = item.tempo_ms != null ? `${item.tempo_ms} ms` : '';
    const msg = !ok && item.mensagem ? String(item.mensagem) : '';
    const linhas = [
        `<div class="fw-semibold">${escapeHtml(dt)}</div>`,
        `<div class="${ok ? 'text-success' : 'text-danger'}">${escapeHtml(titulo)}</div>`
    ];
    if (eq) linhas.push(`<div class="text-muted">Equipamento<br>${escapeHtml(eq)}</div>`);
    if (tempo && ok) linhas.push(`<div>${escapeHtml(tempo)}</div>`);
    if (msg) linhas.push(`<div class="text-danger">${escapeHtml(msg)}</div>`);
    return `<div class="border-bottom py-2 mb-1">${linhas.join('')}</div>`;
}

async function carregarHistoricoBalancaProduto(produtoId, forcarAbrir = false) {
    const id = Number(produtoId || $('#produtoId').val() || 0);
    const $box = $('#balancaProdutoHistoricoBox');
    const $lista = $('#balancaProdutoHistoricoLista');
    if (!$box.length || !$lista.length) return;
    if (forcarAbrir) $box.toggleClass('d-none');
    if ($box.hasClass('d-none')) return;
    if (!id) {
        $lista.html('<div class="text-muted">Salve o produto para ver o histórico.</div>');
        return;
    }
    $lista.html('<div class="text-muted">Carregando…</div>');
    try {
        const token = localStorage.getItem('token') || '';
        const resp = await fetch(`${API_URL}/equipamentos/plu/sync-log?produto_id=${id}&limite=30`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const body = await resp.json().catch(() => ({}));
        const hist = Array.isArray(body.historico) ? body.historico : [];
        if (!hist.length) {
            $lista.html('<div class="text-muted">Nenhuma sincronização registrada.</div>');
            return;
        }
        $lista.html(hist.map(formatarItemHistoricoBalancaProduto).join(''));
    } catch (err) {
        $lista.html(`<div class="text-danger">Erro ao carregar histórico.</div>`);
    }
}

function inicializarPainelEnvioBalancaProduto(produto, isEdit) {
    const $modal = $('#produtoModal');
    if (!$modal.length) return;

    const ativo = !isEdit || Number(produto?.ativo ?? 1) === 1;
    $('#painelEnvioBalancaProduto').attr('data-produto-ativo', ativo ? '1' : '0');
    $('#balancaProdutoFeedback').text('').removeClass('text-success text-danger text-muted');
    $('#balancaProdutoLog').addClass('d-none').text('');
    $('#balancaProdutoHistoricoBox').addClass('d-none');
    $('#balancaProdutoHistoricoLista').empty();
    $('#balancaProdutoResultado').text('—').removeClass('text-success text-danger').addClass('text-muted');
    $('#balancaProdutoUltimaSync').text('Nunca');

    $modal
        .off('change.envioBalancaProduto input.envioBalancaProduto click.envioBalancaProduto')
        .on('change.envioBalancaProduto', '#integrar_balanca', () => {
            $('#integrar_balanca').data('userTouched', true);
        })
        .on('change.envioBalancaProduto input.envioBalancaProduto', '#produto_fracionado, #plu, #integrar_balanca', () => {
            if ($('#produto_fracionado').is(':checked') && !$('#integrar_balanca').data('userTouched')) {
                $('#integrar_balanca').prop('checked', true);
            }
            atualizarVisibilidadePainelEnvioBalancaProduto(produto);
        })
        .on('change.envioBalancaProduto', '#balancaProdutoEquipamento', () => {
            atualizarVisibilidadePainelEnvioBalancaProduto(produto);
        })
        .on('click.envioBalancaProduto', '#btnEnviarProdutoBalanca', (ev) => {
            ev.preventDefault();
            enviarProdutoParaBalancaCadastro();
        })
        .on('click.envioBalancaProduto', '#btnHistoricoBalancaProduto', (ev) => {
            ev.preventDefault();
            carregarHistoricoBalancaProduto(produto?.id, true);
        });

    carregarEquipamentosPainelBalancaProduto().then(() => {
        atualizarVisibilidadePainelEnvioBalancaProduto(produto);
        if (isEdit && produto?.id) {
            carregarUltimaSyncBalancaProduto(produto.id);
        }
    });
}

function inicializarMotorConversaoUnidadesCadastro() {
    const $modal = $('#produtoModal');
    if (!$modal.length) return;

    $modal
        .off('change.motorConversaoUnidades input.motorConversaoUnidades')
        .on(
            'change.motorConversaoUnidades input.motorConversaoUnidades',
            '#produto_fracionado, #unidade, #saldo_fiscal_inicial, #saldo_nao_fiscal_inicial',
            function onMotorConversaoCadastro() {
                if ($(this).is('#saldo_fiscal_inicial, #saldo_nao_fiscal_inicial')) {
                    if (typeof atualizarPreviewEstoqueTotalInicial === 'function') {
                        atualizarPreviewEstoqueTotalInicial();
                    }
                    return;
                }
                aplicarModoConversaoUnidadesCadastro();
            }
        );

    aplicarModoConversaoUnidadesCadastro();
}
// =========================
// MÓDULO DE PRODUTOS
// =========================

/** Cadastro ERP: F12 ativo oculta não fiscal. */
function modoFiscalParamGestaoProdutosLocal() {
    if (typeof modoFiscalQueryParamGestaoProdutos === 'function') {
        return modoFiscalQueryParamGestaoProdutos();
    }
    return '0';
}

function estoqueCadastroSomenteFiscal() {
    if (typeof isModoFiscalSomenteCadastroEstoque === 'function') {
        return isModoFiscalSomenteCadastroEstoque();
    }
    return false;
}

// Sprint 7.1 — estado do catálogo limitado à sessão/tela atual (não atravessa empresa).
function obterSessaoCatalogoProdutos() {
    if (!window.__cdsProdutosCatalogoSessao) {
        window.__cdsProdutosCatalogoSessao = {
            carregado: false,
            modoFiscal: null,
            quantidade: 0,
            versao: 0
        };
    }
    return window.__cdsProdutosCatalogoSessao;
}

function invalidarCatalogoProdutosSessao(motivo) {
    const sessao = obterSessaoCatalogoProdutos();
    sessao.carregado = false;
    sessao.motivo = motivo || 'invalidado';
    window.__cdsProdutosArvoreCache = null;
}

function invalidarCacheArvoreProdutos() {
    window.__cdsProdutosArvoreCache = null;
}

function marcarCatalogoProdutosSessao(modoFiscal, quantidade) {
    const sessao = obterSessaoCatalogoProdutos();
    sessao.carregado = true;
    sessao.modoFiscal = String(modoFiscal);
    sessao.quantidade = Number(quantidade || 0);
    sessao.versao = Number(sessao.versao || 0) + 1;
}

function listaCatalogoProdutosAtual() {
    if (Array.isArray(window.produtosList)) return window.produtosList;
    if (Array.isArray(window.produtosCache)) return window.produtosCache;
    return null;
}

function catalogoProdutosSessaoValido(modoFiscal) {
    const sessao = obterSessaoCatalogoProdutos();
    const lista = listaCatalogoProdutosAtual();
    return sessao.carregado === true
        && String(sessao.modoFiscal) === String(modoFiscal)
        && Array.isArray(lista);
}

function shellListagemProdutosMontado() {
    return $('#buscaProduto').length > 0
        && $('#categorias-container, #produtos-tbody').length > 0;
}

function modalProdutoAbertoAgora() {
    const el = document.getElementById('produtoModal');
    if (!el) return false;
    if (el.classList.contains('show')) return true;
    return typeof $ === 'function' && $('#produtoModal').is(':visible');
}

function registrarMetricaProdutos71(tipo, extra) {
    const Perf = window.PerformanceMonitor;
    if (!Perf || typeof Perf.record !== 'function') return;
    Perf.record(`produtos:sprint71:${tipo}`, extra || {});
}

function aplicarListaCatalogoEmMemoria(lista) {
    const arr = Array.isArray(lista) ? lista : [];
    window.produtosList = arr;
    window.produtosCache = arr;
    window.produtosOriginais = arr;
    return arr;
}

function aplicarAtualizacaoLocalCatalogoProdutos(lista, opcoes = {}) {
    invalidarCacheArvoreProdutos();
    const arr = aplicarListaCatalogoEmMemoria(lista);
    registrarMetricaProdutos71('local-update', {
        records: arr.length,
        motivo: opcoes.motivo || 'local',
        modalAberto: modalProdutoAbertoAgora()
    });
    if (modalProdutoAbertoAgora() && opcoes.mesmoComModal !== true) {
        return false;
    }
    if (typeof atualizarListagemProdutosSemRemontarShell === 'function') {
        atualizarListagemProdutosSemRemontarShell(arr, { semFanout: true });
    }
    return true;
}

function atualizarProdutoNoCatalogoLocal(produto) {
    if (!produto || produto.id == null) return listaCatalogoProdutosAtual() || [];
    const id = String(produto.id);
    const base = listaCatalogoProdutosAtual() || [];
    const idx = base.findIndex((p) => String(p.id) === id);
    if (idx >= 0) base[idx] = produto;
    else base.unshift(produto);
    return base;
}

function removerProdutoDoCatalogoLocal(produtoId) {
    const id = String(produtoId);
    return (listaCatalogoProdutosAtual() || []).filter((p) => String(p.id) !== id);
}

// Carrega página de produtos
// opcoes.suave = true → atualiza dados/lista sem remontar o HTML (preserva busca, foco e modal)
// opcoes.somenteCache = true → só atualiza window.produtos* sem mexer na UI
// opcoes.forcar = true → GET completo (invalidação explícita: F12, importação)
function loadProdutos(opcoes = {}) {
    const modoFiscal = modoFiscalParamGestaoProdutosLocal();
    const shellJaMontado = shellListagemProdutosMontado();
    const suave = opcoes.suave === true
        || (opcoes.suave !== false && shellJaMontado && typeof currentPage !== 'undefined' && currentPage === 'produtos');
    const somenteCache = opcoes.somenteCache === true;
    const forcar = opcoes.forcar === true;
    const pageToken = (typeof UINavigation !== 'undefined' && UINavigation.getToken)
        ? UINavigation.getToken()
        : null;

    if (!forcar && !somenteCache && catalogoProdutosSessaoValido(modoFiscal)) {
        const lista = listaCatalogoProdutosAtual() || [];
        registrarMetricaProdutos71('catalog-reuse', {
            records: lista.length,
            modoFiscal,
            motivo: opcoes.motivo || (shellJaMontado ? 'reclique' : 'retorno'),
            shellMontado: shellJaMontado
        });
        if (somenteCache) return Promise.resolve(lista);
        if (shellJaMontado && suave && opcoes.atualizarUi !== true) {
            return Promise.resolve(lista);
        }
        if (suave && shellJaMontado && typeof atualizarListagemProdutosSemRemontarShell === 'function') {
            atualizarListagemProdutosSemRemontarShell(lista, { semFanout: true });
        } else {
            renderProdutos(lista);
        }
        return Promise.resolve(lista);
    }

    const reqCtx = (!somenteCache && typeof UIRequestContext !== 'undefined' && UIRequestContext.begin)
        ? UIRequestContext.begin({ page: 'produtos', component: 'lista', page_token: pageToken })
        : null;

    registrarMetricaProdutos71('catalog-fetch', {
        modoFiscal,
        forcar,
        somenteCache,
        motivo: opcoes.motivo || (forcar ? 'forcar' : 'primeira-carga')
    });

    return $.ajax({
        url: `${API_URL}/produtos?modo_fiscal=${modoFiscal}`,
        method: 'GET',
        success: function (produtos) {
            if (reqCtx && !UIRequestContext.isFresh(reqCtx.request_id)) return;
            if (!somenteCache && typeof UINavigation !== 'undefined' && pageToken
                && !UINavigation.isActiveToken(pageToken)) return;
            if (!somenteCache && typeof currentPage !== 'undefined' && currentPage !== 'produtos' && !suave) return;
            if (reqCtx) UIRequestContext.markCompleted(reqCtx.request_id);

            window.produtosList = produtos || [];
            invalidarCacheArvoreProdutos();
            marcarCatalogoProdutosSessao(modoFiscal, window.produtosList.length);
            registrarMetricaProdutos71('catalog-fetched', {
                records: window.produtosList.length,
                modoFiscal,
                bytesApprox: window.PerformanceMonitor?.approximateBytes?.(produtos) ?? null
            });
            if (somenteCache) {
                window.produtosCache = window.produtosList;
                window.produtosOriginais = window.produtosList;
                return;
            }
            if (suave && typeof atualizarListagemProdutosSemRemontarShell === 'function') {
                atualizarListagemProdutosSemRemontarShell(window.produtosList);
            } else {
                renderProdutos(window.produtosList);
            }
        },
        error: function () {
            if (reqCtx && !UIRequestContext.isFresh(reqCtx.request_id)) return;
            if (!suave && !somenteCache) {
                if (typeof UINavigation !== 'undefined' && pageToken
                    && !UINavigation.isActiveToken(pageToken)) return;
                $('#page-content').html('<div class="alert alert-danger">Erro ao carregar produtos!</div>');
            }
        }
    });
}
window.loadProdutos = loadProdutos;

/**
 * Atualiza cache + listagem sem destruir #page-content.
 * Evita apagar a busca / perder foco quando o sync de modo fiscal
 * dispara com o PDV aberto em outra janela.
 */
function atualizarListagemProdutosSemRemontarShell(produtos, opcoesRefresh = {}) {
    const lista = Array.isArray(produtos) ? produtos : [];
    const semFanout = opcoesRefresh.semFanout === true;
    const Perf = window.PerformanceMonitor;
    const refreshOp = Perf?.start?.('produtos:soft-list-refresh', {
        records: lista.length,
        focusedInside: document.activeElement?.id === 'buscaProduto',
        semFanout
    });
    window.produtosList = lista;
    window.produtosCache = lista;
    window.produtosOriginais = lista;

    const $busca = $('#buscaProduto');
    if (!$busca.length) {
        renderProdutos(lista);
        if (refreshOp) Perf.end(refreshOp, { fallback: 'full-render' });
        return;
    }

    const termo = String($busca.val() || '').trim();
    const buscaTinhaFoco = document.activeElement === $busca[0];
    const posicao = (buscaTinhaFoco && typeof $busca[0].selectionStart === 'number')
        ? $busca[0].selectionStart
        : null;
    const scrollY = (typeof window !== 'undefined' && window.scrollY) || 0;
    const $arvore = $('#categorias-container');
    const scrollArvore = $arvore.length ? $arvore.scrollTop() : null;

    if (termo) {
        if (semFanout && typeof aplicarFiltrosProdutos === 'function') {
            aplicarFiltrosProdutos(lista, { origem: 'operacional' });
        } else if (typeof executarBuscaProdutosViaMib === 'function') {
            executarBuscaProdutosViaMib(termo);
        } else if (typeof agendarBuscaProdutosMib === 'function') {
            agendarBuscaProdutosMib();
        } else if (typeof restaurarArvoreProdutosOriginal === 'function') {
            restaurarArvoreProdutosOriginal();
        }
    } else if (typeof restaurarArvoreProdutosOriginal === 'function') {
        restaurarArvoreProdutosOriginal();
    }

    if (!semFanout) {
        if (typeof carregarEstoqueBaixoProdutos === 'function') {
            try { carregarEstoqueBaixoProdutos(); } catch (_) { /* ignore */ }
        }
        if (typeof carregarVencimentosProdutos === 'function') {
            try { carregarVencimentosProdutos(); } catch (_) { /* ignore */ }
        }
        if (typeof carregarDashboardPromocoes === 'function') {
            try { carregarDashboardPromocoes(); } catch (_) { /* ignore */ }
        }
    } else if (typeof carregarEstoqueBaixoProdutos === 'function') {
        try { carregarEstoqueBaixoProdutos(); } catch (_) { /* ignore */ }
    }

    if (buscaTinhaFoco && $busca.length) {
        $busca.trigger('focus');
        if (posicao != null && $busca[0].setSelectionRange) {
            try { $busca[0].setSelectionRange(posicao, posicao); } catch (_) { /* ignore */ }
        }
    }
    if (scrollArvore != null && $arvore.length) {
        $arvore.scrollTop(scrollArvore);
    }
    if (typeof window !== 'undefined' && window.scrollTo) {
        window.scrollTo(0, scrollY);
    }
    if (refreshOp) {
        Perf.end(refreshOp, {
            updateType: semFanout ? 'partial-local' : 'partial-with-request-fanout',
            additionalRequests: semFanout ? 0 : 3,
            searchActive: !!termo
        });
    }
}
window.atualizarListagemProdutosSemRemontarShell = atualizarListagemProdutosSemRemontarShell;

function obterQuantidadeEstoqueProduto(p) {
    if (typeof obterEstoqueDisponivelProduto === 'function') {
        return obterEstoqueDisponivelProduto(p);
    }
    return Number(p?.estoque_atual || 0);
}

function tituloColunaEstoqueLista() {
    if (estoqueCadastroSomenteFiscal()) {
        return 'Estoque Fiscal';
    }
    return 'Estoque';
}

function formatarEstoqueCompletoProduto(p) {
    const unidade = p?.unidade || '';
    const opcoesFormato = { produtoFracionado: produtoUsaConversaoUnidades(p) };
    const fiscal = Number(p.saldo_fiscal ?? 0);
    const naoFiscal = Number(p.saldo_nao_fiscal ?? 0);
    const resF = Number(p.reservado_fiscal ?? 0);
    const resNf = Number(p.reservado_nao_fiscal ?? 0);
    const dispF = Math.max(0, fiscal - resF);
    const dispNf = Math.max(0, naoFiscal - resNf);
    const total = Number(p.estoque_atual ?? (fiscal + naoFiscal));
    const resTotal = resF + resNf;
    const dispTotal = dispF + dispNf;
    const fmt = (v) => formatarEstoqueProduto(v, unidade, opcoesFormato);

    return `
      <div class="small estoque-reserva-box" data-produto-id="${p.id}">
        <div>Fiscal: ${fmt(fiscal)} · Res. F: <a href="#" class="link-reservas-produto" data-id="${p.id}">${fmt(resF)}</a> · Disp. F: ${fmt(dispF)}</div>
        <div>Não Fiscal: ${fmt(naoFiscal)} · Res. NF: <a href="#" class="link-reservas-produto" data-id="${p.id}">${fmt(resNf)}</a> · Disp. NF: ${fmt(dispNf)}</div>
        <div class="fw-semibold">Total: ${fmt(total)} · Res. Σ: <a href="#" class="link-reservas-produto" data-id="${p.id}">${fmt(resTotal)}</a> · Disp. Σ: ${fmt(dispTotal)}</div>
      </div>`;
}

async function abrirModalReservasProduto(produtoId) {
    try {
        const resp = await fetch(`${API_URL}/vendas/entregas/reservas-produto/${produtoId}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'Falha ao carregar reservas.');
        const items = data.items || [];
        const linhas = items.length
            ? items.map((r) => `
                <tr>
                  <td>#${r.venda_id}</td>
                  <td>${escapeHtml(r.cliente_nome || '—')}</td>
                  <td>${escapeHtml(r.entregador || '—')}</td>
                  <td>${Number(r.quantidade_fiscal || 0)}</td>
                  <td>${Number(r.quantidade_nao_fiscal || 0)}</td>
                  <td>${escapeHtml(r.status_entrega || '')}</td>
                </tr>`).join('')
            : '<tr><td colspan="6" class="text-center text-muted">Nenhuma reserva ativa.</td></tr>';

        $('#modal-container').html(`
          <div class="modal fade" id="modalReservasProduto" tabindex="-1">
            <div class="modal-dialog modal-lg modal-dialog-centered">
              <div class="modal-content">
                <div class="modal-header"><h5 class="modal-title">Reservas do produto #${produtoId}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
                <div class="modal-body table-responsive">
                  <table class="table table-sm"><thead><tr>
                    <th>Pedido</th><th>Cliente</th><th>Entregador</th><th>Res. Fiscal</th><th>Res. NF</th><th>Status</th>
                  </tr></thead><tbody>${linhas}</tbody></table>
                </div>
              </div>
            </div>
          </div>`);
        bootstrap.Modal.getOrCreateInstance(document.getElementById('modalReservasProduto')).show();
    } catch (err) {
        if (typeof showNotification === 'function') showNotification(err.message || 'Erro', 'danger');
    }
}

$(document).on('click', '.link-reservas-produto', function (e) {
    e.preventDefault();
    abrirModalReservasProduto($(this).data('id'));
});

function formatarEstoqueDetalheProduto(produto) {
    const unidade = produto.unidade || '';
    const opcoesFormato = { produtoFracionado: produtoUsaConversaoUnidades(produto) };

    if (estoqueCadastroSomenteFiscal()) {
        const fiscal = Number(produto.saldo_fiscal ?? 0);
        return `<p><strong>Estoque Fiscal:</strong> ${formatarEstoqueProduto(fiscal, unidade, opcoesFormato)}</p>`;
    }

    // Com módulo entrega: exibe reservado/disponível
    if (Number(produto.reservado_fiscal || 0) > 0 || Number(produto.reservado_nao_fiscal || 0) > 0
        || (typeof obterRecursosImplantacao === 'function' && obterRecursosImplantacao().vendasEntrega)) {
        return formatarEstoqueCompletoProduto(produto);
    }

    const fiscal = Number(produto.saldo_fiscal ?? 0);
    const naoFiscal = Number(produto.saldo_nao_fiscal ?? 0);
    const total = Number(produto.estoque_atual ?? (fiscal + naoFiscal));

    return `
        <p><strong>Estoque Fiscal:</strong> ${formatarEstoqueProduto(fiscal, unidade, opcoesFormato)}</p>
        <p><strong>Estoque Não Fiscal:</strong> ${formatarEstoqueProduto(naoFiscal, unidade, opcoesFormato)}</p>
        <p><strong>Estoque Total:</strong> ${formatarEstoqueProduto(total, unidade, opcoesFormato)}</p>
    `;
}


function resolverItemFiscalParaSalvar(saldosIniciais) {
    // Classificação do produto vem do cadastro — não do F12/PDV.
    if (Number(saldosIniciais.saldo_nao_fiscal_inicial) > 0 && Number(saldosIniciais.saldo_fiscal_inicial) === 0) {
        return 0;
    }
    return 1;
}

function obterSaldosIniciaisDoFormulario() {
    if ($('#saldo_fiscal_inicial').length) {
        const fiscal = parseFloat($('#saldo_fiscal_inicial').val()) || 0;
        const naoFiscal = parseFloat($('#saldo_nao_fiscal_inicial').val()) || 0;
        return {
            saldo_fiscal_inicial: fiscal,
            saldo_nao_fiscal_inicial: naoFiscal,
            estoque_total: fiscal + naoFiscal
        };
    }

    const legado = parseFloat($('#estoque_atual').val()) || 0;
    return {
        saldo_fiscal_inicial: legado,
        saldo_nao_fiscal_inicial: 0,
        estoque_total: legado
    };
}

function montarHtmlCamposEstoqueProduto(produto, isEdit, opcoes = {}) {
    // Bloqueia edição do Estoque Inicial somente após a 1ª venda
    const temVendas = Boolean(opcoes.temVendas ?? produto?.tem_vendas);
    const permiteEditarSaldos = !isEdit || !temVendas;
    // Cadastro: F12 ativo exibe só saldo fiscal
    const modoFiscal = estoqueCadastroSomenteFiscal();
    const saldoFiscal = Number(produto?.saldo_fiscal ?? 0);
    const saldoNaoFiscal = Number(produto?.saldo_nao_fiscal ?? 0);
    const estoqueTotal = Number(produto?.estoque_atual ?? (saldoFiscal + saldoNaoFiscal));
    const unidade = produto?.unidade || '';
    const usaConversao = produtoEhFracionado(produto);
    const stepEstoque = obterStepEstoqueProduto(unidade, usaConversao);

    if (permiteEditarSaldos) {
        if (modoFiscal) {
            return `
                <div class="col-md-6 mb-3">
                    <label for="saldo_fiscal_inicial" class="form-label">Quantidade Fiscal</label>
                    <input
                        type="number"
                        step="${stepEstoque}"
                        min="0"
                        class="form-control"
                        id="saldo_fiscal_inicial"
                        value="${isEdit ? saldoFiscal : 0}"
                    >
                    <input type="hidden" id="saldo_nao_fiscal_inicial" value="${isEdit ? saldoNaoFiscal : 0}">
                </div>
            `;
        }

        return `
            <div class="col-md-4 mb-3">
                <label for="saldo_fiscal_inicial" class="form-label">Quantidade Fiscal</label>
                <input
                    type="number"
                    step="${stepEstoque}"
                    min="0"
                    class="form-control"
                    id="saldo_fiscal_inicial"
                    value="${isEdit ? saldoFiscal : 0}"
                >
            </div>
            <div class="col-md-4 mb-3">
                <label for="saldo_nao_fiscal_inicial" class="form-label">Quantidade Não Fiscal</label>
                <input
                    type="number"
                    step="${stepEstoque}"
                    min="0"
                    class="form-control"
                    id="saldo_nao_fiscal_inicial"
                    value="${isEdit ? saldoNaoFiscal : 0}"
                >
            </div>
            <div class="col-md-4 mb-3">
                <label class="form-label">Quantidade Total</label>
                <input
                    type="text"
                    class="form-control bg-light"
                    id="estoque_total_inicial_preview"
                    readonly
                    value="${formatarEstoqueProduto(estoqueTotal, unidade, { produtoFracionado: usaConversao })}"
                >
            </div>
        `;
    }

    const avisoAjuste = temVendas && podeAjustarEstoque()
        ? '<small class="text-muted d-block mt-1">Produto já vendido. Use o botão <strong>Ajustar Estoque</strong> na lista para alterar saldos.</small>'
        : (temVendas
            ? '<small class="text-muted d-block mt-1">Produto já vendido — saldos iniciais não podem ser alterados.</small>'
            : '');

    if (modoFiscal) {
        return `
            <div class="col-md-6 mb-3">
                <label class="form-label">Quantidade Fiscal</label>
                <input
                    type="text"
                    class="form-control bg-light"
                    readonly
                    value="${formatarEstoqueProduto(saldoFiscal, unidade, { produtoFracionado: usaConversao })}"
                >
                ${avisoAjuste}
            </div>
        `;
    }

    return `
        <div class="col-md-4 mb-3">
            <label class="form-label">Quantidade Fiscal</label>
            <input
                type="text"
                class="form-control bg-light"
                readonly
                value="${formatarEstoqueProduto(saldoFiscal, unidade, { produtoFracionado: usaConversao })}"
            >
        </div>
        <div class="col-md-4 mb-3">
            <label class="form-label">Quantidade Não Fiscal</label>
            <input
                type="text"
                class="form-control bg-light"
                readonly
                value="${formatarEstoqueProduto(saldoNaoFiscal, unidade, { produtoFracionado: usaConversao })}"
            >
        </div>
        <div class="col-md-4 mb-3">
            <label class="form-label">Quantidade Total</label>
            <input
                type="text"
                class="form-control bg-light"
                readonly
                value="${formatarEstoqueProduto(estoqueTotal, unidade, { produtoFracionado: usaConversao })}"
            >
            ${avisoAjuste}
        </div>
    `;
}

function atualizarCamposEstoqueModalProduto() {
    const $modal = $('#produtoModal');
    if (!$modal.length || !$modal.hasClass('show')) {
        return;
    }

    const $area = $('#areaCamposEstoqueProduto');
    if (!$area.length) {
        return;
    }

    const saldosForm = obterSaldosIniciaisDoFormulario();
    const isEdit = Boolean($('#produtoId').val());
    const temVendas = $modal.data('temVendas') === true;
    const saldosArmazenados = $modal.data('produtoSaldos') || {};

    const produto = {
        unidade: $('#unidade').val() || '',
        tem_vendas: temVendas,
        saldo_fiscal: temVendas && isEdit
            ? Number(saldosArmazenados.saldo_fiscal ?? 0)
            : saldosForm.saldo_fiscal_inicial,
        saldo_nao_fiscal: temVendas && isEdit
            ? Number(saldosArmazenados.saldo_nao_fiscal ?? 0)
            : saldosForm.saldo_nao_fiscal_inicial,
        estoque_atual: temVendas && isEdit
            ? Number(saldosArmazenados.estoque_atual ?? 0)
            : saldosForm.estoque_total
    };

    $area.html(montarHtmlCamposEstoqueProduto(produto, isEdit, { temVendas }));

    const permiteEditarSaldos = !isEdit || !temVendas;
    if (permiteEditarSaldos) {
        $('#saldo_fiscal_inicial').val(saldosForm.saldo_fiscal_inicial);
        const $naoFiscal = $('#saldo_nao_fiscal_inicial');
        if ($naoFiscal.length && $naoFiscal.attr('type') !== 'hidden') {
            $naoFiscal.val(saldosForm.saldo_nao_fiscal_inicial);
        }
    }

    inicializarPreviewEstoqueTotalInicial();
}
window.atualizarCamposEstoqueModalProduto = atualizarCamposEstoqueModalProduto;

function obterEstoqueTotalExibicaoCadastro() {
    if ($('#saldo_fiscal_inicial').length || $('#estoque_atual').length) {
        return Number(obterSaldosIniciaisDoFormulario().estoque_total || 0);
    }

    const saldos = $('#produtoModal').data('produtoSaldos') || {};
    const totalInformado = Number(saldos.estoque_total);
    if (!Number.isNaN(totalInformado)) {
        return totalInformado;
    }

    return Number(saldos.saldo_fiscal || 0) + Number(saldos.saldo_nao_fiscal || 0);
}

function atualizarPreviewValorTotalEstoqueCadastro() {
    const $compra = $('#valor_total_compra_preview');
    const $venda = $('#valor_total_venda_preview');
    if (!$compra.length && !$venda.length) {
        return;
    }

    const estoqueTotal = obterEstoqueTotalExibicaoCadastro();
    const numero = (valor) => parseFloat(String(valor ?? '').replace(',', '.')) || 0;
    const precoCompra = numero($('#preco_compra').val());
    const precoVenda = numero($('#preco_venda').val());

    if ($compra.length) {
        $compra.val(formatCurrency(estoqueTotal * precoCompra));
    }
    if ($venda.length) {
        $venda.val(formatCurrency(estoqueTotal * precoVenda));
    }
}

function atualizarPreviewEstoqueTotalInicial() {
    const $preview = $('#estoque_total_inicial_preview');
    if ($preview.length) {
        const saldos = obterSaldosIniciaisDoFormulario();
        const unidade = $('#unidade').val() || 'un';
        const opcoesFormato = { produtoFracionado: produtoCadastroUsaConversaoUnidades() };
        $preview.val(formatarEstoqueProduto(saldos.estoque_total, unidade, opcoesFormato));
    }

    atualizarPreviewValorTotalEstoqueCadastro();
}

function inicializarPreviewEstoqueTotalInicial() {
    const $modal = $('#produtoModal');
    if (!$modal.length) {
        return;
    }

    $modal.off('input.previewEstoqueTotal change.previewEstoqueTotal')
        .on(
            'input.previewEstoqueTotal change.previewEstoqueTotal',
            '#saldo_fiscal_inicial, #saldo_nao_fiscal_inicial, #unidade, #produto_fracionado, #preco_compra, #preco_venda',
            atualizarPreviewEstoqueTotalInicial
        );

    atualizarPreviewEstoqueTotalInicial();
}
window.inicializarPreviewEstoqueTotalInicial = inicializarPreviewEstoqueTotalInicial;

function formatarEstoqueExibicaoTela(produto) {
    const unidade = produto?.unidade || '';
    const valor = typeof obterEstoqueExibicaoSimplesProduto === 'function'
        ? obterEstoqueExibicaoSimplesProduto(produto)
        : Number(produto?.estoque_atual || 0);
    return formatarEstoqueProduto(valor, unidade, { produtoFracionado: produtoUsaConversaoUnidades(produto) });
}

function formatarColunaEstoqueLista(p) {
    const unidade = p.unidade || '';
    const opcoesFormato = { produtoFracionado: produtoUsaConversaoUnidades(p) };

    if (estoqueCadastroSomenteFiscal()) {
        return formatarEstoqueProduto(Number(p.saldo_fiscal ?? 0), unidade, opcoesFormato);
    }

    if (Number(p.reservado_fiscal || 0) > 0 || Number(p.reservado_nao_fiscal || 0) > 0
        || (typeof obterRecursosImplantacao === 'function' && obterRecursosImplantacao().vendasEntrega)) {
        return formatarEstoqueCompletoProduto(p);
    }

    const fiscal = Number(p.saldo_fiscal ?? 0);
    const naoFiscal = Number(p.saldo_nao_fiscal ?? 0);
    const total = Number(p.estoque_atual ?? (fiscal + naoFiscal));

    return `
        <div class="small">Fiscal: ${formatarEstoqueProduto(fiscal, unidade, opcoesFormato)}</div>
        <div class="small">Não Fiscal: ${formatarEstoqueProduto(naoFiscal, unidade, opcoesFormato)}</div>
        <div class="fw-semibold">Total: ${formatarEstoqueProduto(total, unidade, opcoesFormato)}</div>
    `;
}

function quantidadeEstoqueRelatorio(p) {
    return Number(p.saldo_fiscal ?? 0) + Number(p.saldo_nao_fiscal ?? 0);
}

function formatarColunaEstoqueRelatorio(p) {
    const unidade = p.unidade || '';
    const opcoesFormato = { produtoFracionado: produtoUsaConversaoUnidades(p) };
    const fiscal = Number(p.saldo_fiscal ?? 0);
    const naoFiscal = Number(p.saldo_nao_fiscal ?? 0);
    return `F ${formatarEstoqueProduto(fiscal, unidade, opcoesFormato)} / NF ${formatarEstoqueProduto(naoFiscal, unidade, opcoesFormato)}`;
}

function textoStatusRelatorio(p) {
    const partes = [];
    const estoque = classificarEstoqueRelatorio(p);
    if (estoque === 'estoque_baixo') partes.push('Estoque baixo');
    else if (estoque === 'proximo_minimo') partes.push('Próximo do mínimo');

    const validade = classificarValidadeRelatorio(p);
    if (validade === 'vencido') partes.push('Vencido');
    else if (validade === 'proximo_vencimento') {
        partes.push(`Vence em ${Number(p.dias_para_vencer ?? 0)} dia(s)`);
    }

    return partes.length ? partes.join(' · ') : 'OK';
}

const RELATORIO_PRODUTOS_FILTROS = {
    todos: 'Todos os produtos',
    estoque_baixo: 'Estoque baixo',
    proximo_minimo: 'Próximo do mínimo',
    vencidos: 'Vencidos',
    proximo_vencimento: 'Próximos do vencimento'
};

function showRelatorioEstoqueProdutos() {
    carregarRelatorioEstoqueProdutos('todos');
}

function obterTipoFiltroRelatorioAtual() {
    const modal = document.getElementById('relatorio-estoque-modal');
    if (modal) {
        return modal.getAttribute('data-tipo-filtro') || 'todos';
    }
    return $('#relatorio-tipo-filtro').val() || 'todos';
}

function aplicarFiltroRelatorioProdutos() {
    const tipoFiltro = $('#relatorio-tipo-filtro').val() || 'todos';
    const inicio = $('#relatorio-data-inicio').val() || '';
    const fim = $('#relatorio-data-fim').val() || '';
    carregarRelatorioEstoqueProdutos(tipoFiltro, inicio, fim);
}

function classificarEstoqueProduto(p) {
    const atual = obterQuantidadeEstoqueProduto(p);
    const minimo = Number(p.estoque_minimo || 0);
    if (minimo <= 0) return 'ok';
    if (atual <= minimo) return 'estoque_baixo';
    if (atual <= Math.ceil(minimo * 1.2)) return 'proximo_minimo';
    return 'ok';
}

function classificarValidadeProduto(p) {
    if (Number(p.controlar_validade || 0) !== 1 || !p.data_validade) {
        return 'nao_controla';
    }
    if (p.status_validade === 'vencido') return 'vencido';
    if (p.status_validade === 'proximo') return 'proximo_vencimento';
    return 'ok_validade';
}

function obterStatusVisualProduto(p) {
    const estoque = classificarEstoqueProduto(p);
    const validade = classificarValidadeProduto(p);
    const critico = estoque === 'estoque_baixo' || validade === 'vencido';
    const alerta = estoque === 'proximo_minimo' || validade === 'proximo_vencimento';

    if (critico) return { nivel: 'critico', estoque, validade };
    if (alerta) return { nivel: 'alerta', estoque, validade };
    return { nivel: 'ok', estoque, validade };
}

function classesLinhaStatusProduto(status) {
    if (status.nivel === 'critico') {
        return { row: 'table-danger', text: 'text-danger', estoque: 'text-danger fw-bold' };
    }
    if (status.nivel === 'alerta') {
        return { row: 'table-warning', text: 'text-warning-emphasis', estoque: 'text-warning-emphasis fw-bold' };
    }
    return { row: '', text: '', estoque: '' };
}

function montarBadgesStatusProduto(p) {
    const status = obterStatusVisualProduto(p);
    const badges = [];

    if (status.estoque === 'estoque_baixo') {
        badges.push('<span class="badge bg-danger ms-1">Estoque baixo</span>');
    } else if (status.estoque === 'proximo_minimo') {
        badges.push('<span class="badge bg-warning text-dark ms-1">Próximo do mínimo</span>');
    }

    if (status.validade === 'vencido') {
        badges.push('<span class="badge bg-danger ms-1">Vencido</span>');
    } else if (status.validade === 'proximo_vencimento') {
        const dias = Number(p.dias_para_vencer ?? 0);
        badges.push(`<span class="badge bg-warning text-dark ms-1">Vence em ${dias} dia(s)</span>`);
    }

    return badges.join('');
}

const classificarEstoqueRelatorio = classificarEstoqueProduto;
const classificarValidadeRelatorio = classificarValidadeProduto;

function filtrarProdutosRelatorio(produtos, tipoFiltro) {
    const lista = Array.isArray(produtos) ? produtos : [];

    switch (tipoFiltro) {
        case 'estoque_baixo':
            return lista.filter((p) => classificarEstoqueRelatorio(p) === 'estoque_baixo');
        case 'proximo_minimo':
            return lista.filter((p) => classificarEstoqueRelatorio(p) === 'proximo_minimo');
        case 'vencidos':
            return lista.filter((p) => {
                return classificarValidadeRelatorio(p) === 'vencido' && obterQuantidadeEstoqueProduto(p) > 0;
            });
        case 'proximo_vencimento':
            return lista.filter((p) => {
                return classificarValidadeRelatorio(p) === 'proximo_vencimento' && obterQuantidadeEstoqueProduto(p) > 0;
            });
        case 'todos':
        default:
            return lista;
    }
}

function montarBadgesStatusRelatorio(p) {
    const badges = [];
    const estoque = classificarEstoqueRelatorio(p);

    if (estoque === 'estoque_baixo') {
        badges.push('<span class="badge bg-danger">Estoque baixo</span>');
    } else if (estoque === 'proximo_minimo') {
        badges.push('<span class="badge bg-warning text-dark">Próximo do mínimo</span>');
    }

    const validade = classificarValidadeRelatorio(p);
    if (validade === 'vencido') {
        badges.push('<span class="badge bg-danger">Vencido</span>');
    } else if (validade === 'proximo_vencimento') {
        const dias = Number(p.dias_para_vencer ?? 0);
        badges.push(`<span class="badge bg-warning text-dark">Vence em ${dias} dia(s)</span>`);
    }

    if (!badges.length) {
        badges.push('<span class="badge bg-secondary">OK</span>');
    }

    return badges.join(' ');
}

function formatarValidadeRelatorio(valor) {
    if (!valor) return '-';
    const data = new Date(`${valor}T00:00:00`);
    return Number.isNaN(data.getTime()) ? valor : data.toLocaleDateString('pt-BR');
}

function montarOptionsFiltroRelatorio(tipoAtual) {
    return Object.entries(RELATORIO_PRODUTOS_FILTROS)
        .map(([valor, label]) => {
            const selected = valor === tipoAtual ? 'selected' : '';
            return `<option value="${valor}" ${selected}>${label}</option>`;
        })
        .join('');
}

function parseRelatorioData(valor) {
    if (!valor) return null;
    const data = new Date(`${valor}T00:00:00`);
    return Number.isNaN(data.getTime()) ? null : data;
}

function isRelatorioDataDentroDoIntervalo(dataString, inicio, fim) {
    if (!dataString) return false;

    const data = new Date(dataString);
    if (Number.isNaN(data.getTime())) return false;

    if (inicio && data < inicio) return false;

    if (fim) {
        const fimDoDia = new Date(fim.getTime());
        fimDoDia.setHours(23, 59, 59, 999);
        if (data > fimDoDia) return false;
    }

    return true;
}

function formatarUltimaCompraRelatorio(valor) {
    if (!valor) return '-';
    return formatDate(valor);
}

function imprimirHtmlRelatorioProdutos(html) {
    if (window.electronAPI && typeof window.electronAPI.imprimirRelatorioHtml === 'function') {
        window.electronAPI.imprimirRelatorioHtml({
            html,
            titulo: 'Relatório de Estoque'
        }).catch(() => {});
        return;
    }

    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'Impressão do relatório de estoque');
    iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0;background:#fff;';
    document.body.appendChild(iframe);

    const win = iframe.contentWindow;
    const doc = win && win.document;
    if (!doc) {
        iframe.remove();
        return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    let finalizado = false;
    const finalizar = () => {
        if (finalizado) return;
        finalizado = true;
        try { iframe.remove(); } catch (_) { /* ignore */ }
    };

    const imprimir = () => {
        try { win.addEventListener('afterprint', finalizar); } catch (_) { /* ignore */ }
        try {
            win.focus();
            win.print();
        } catch (_) {
            finalizar();
        }
    };

    setTimeout(imprimir, 300);
    setTimeout(finalizar, 180000);
}

function montarLinhasRelatorioEstoque(produtosExibidos) {
    if (!produtosExibidos.length) {
        return '<tr><td colspan="9" class="text-center">Nenhum produto encontrado para o filtro selecionado.</td></tr>';
    }

    return produtosExibidos.map((p) => {
        const estoqueAtual = quantidadeEstoqueRelatorio(p);
        const estoqueMinimo = Number(p.estoque_minimo || 0);
        const totalItem = estoqueAtual * Number(p.preco_compra || 0);
        const classes = classesLinhaStatusProduto(obterStatusVisualProduto(p));
        return `<tr class="${classes.row}"><td class="${classes.text}">${escapeHtml(p.nome || '-')}</td><td>${escapeHtml(p.categoria || '-')}</td><td>${escapeHtml(formatarColunaEstoqueRelatorio(p))}</td><td>${estoqueMinimo}</td><td>${escapeHtml(p.lote || '-')}</td><td>${escapeHtml(formatarValidadeRelatorio(p.data_validade))}</td><td>${escapeHtml(formatarUltimaCompraRelatorio(p.ultima_compra_data))}</td><td>${escapeHtml(formatCurrency(totalItem))}</td><td>${escapeHtml(textoStatusRelatorio(p))}</td></tr>`;
    }).join('');
}

function printRelatorioEstoqueProdutos() {
    const itens = Array.isArray(window.__cdsRelatorioEstoqueItens) ? window.__cdsRelatorioEstoqueItens : [];
    const tituloModo = document.getElementById('relatorio-estoque-titulo-modo')?.textContent || 'Todos os produtos';
    const filtroLegenda = document.getElementById('relatorio-estoque-legenda')?.textContent || '';
    const filtroDatasTexto = document.getElementById('relatorio-estoque-filtro-datas')?.textContent || '';
    const valorTotalTexto = document.getElementById('relatorio-estoque-valor-total')?.textContent || '';
    const title = 'Relatório de Estoque';

    imprimirHtmlRelatorioProdutos(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
body{font-family:Arial,sans-serif;color:#222;padding:16px;font-size:11px}
h1{font-size:18px;margin:0 0 8px}
p{margin:0 0 4px}
table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#f8f9fa}
tr.table-danger td{background:#f8d7da}
tr.table-warning td{background:#fff3cd}
@page{size:A4 landscape;margin:10mm}
</style>
</head>
<body>
<h1>${title}</h1>
<p><strong>${escapeHtml(tituloModo)}</strong></p>
<p>${escapeHtml(filtroLegenda)}</p>
<p>${escapeHtml(filtroDatasTexto)}</p>
<p>${escapeHtml(valorTotalTexto)}</p>
<table>
<thead><tr><th>Produto</th><th>Categoria</th><th>Estoque</th><th>Mínimo</th><th>Lote</th><th>Validade</th><th>Última compra</th><th>Total em estoque</th><th>Status</th></tr></thead>
<tbody>${montarLinhasRelatorioEstoque(itens)}</tbody>
</table>
</body>
</html>`);
}

function garantirModalRelatorioEstoque(tipoFiltro, filtroInicio, filtroFim) {
    let modalEl = document.getElementById('relatorio-estoque-modal');
    if (modalEl) {
        modalEl.setAttribute('data-tipo-filtro', tipoFiltro);
        const tipoSel = document.getElementById('relatorio-tipo-filtro');
        if (tipoSel) tipoSel.innerHTML = montarOptionsFiltroRelatorio(tipoFiltro);
        const inicioEl = document.getElementById('relatorio-data-inicio');
        const fimEl = document.getElementById('relatorio-data-fim');
        if (inicioEl) inicioEl.value = filtroInicio || '';
        if (fimEl) fimEl.value = filtroFim || '';
        return modalEl;
    }

    const modalHtml = `
        <div class="modal fade" id="relatorio-estoque-modal" tabindex="-1" data-tipo-filtro="${tipoFiltro}">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Relatório de Estoque</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row g-3 mb-3 no-print">
                            <div class="col-md-4">
                                <label class="form-label">Tipo de filtro</label>
                                <select id="relatorio-tipo-filtro" class="form-select">
                                    ${montarOptionsFiltroRelatorio(tipoFiltro)}
                                </select>
                            </div>
                            <div class="col-md-3">
                                <label class="form-label">Data início (última compra)</label>
                                <input type="date" id="relatorio-data-inicio" class="form-control" value="${filtroInicio || ''}">
                            </div>
                            <div class="col-md-3">
                                <label class="form-label">Data fim (última compra)</label>
                                <input type="date" id="relatorio-data-fim" class="form-control" value="${filtroFim || ''}">
                            </div>
                            <div class="col-md-2 d-flex align-items-end gap-2 flex-wrap">
                                <button type="button" class="btn btn-primary w-100" onclick="aplicarFiltroRelatorioProdutos()">
                                    Aplicar
                                </button>
                            </div>
                            <div class="col-12 d-flex gap-2 flex-wrap">
                                <button type="button" class="btn btn-outline-secondary btn-sm" onclick="carregarRelatorioEstoqueProdutos($('#relatorio-tipo-filtro').val() || 'todos')">
                                    Limpar datas
                                </button>
                                <button type="button" class="btn btn-success btn-sm" onclick="printRelatorioEstoqueProdutos()">
                                    Imprimir relatório
                                </button>
                            </div>
                        </div>
                        <div class="mb-3">
                            <strong id="relatorio-estoque-titulo-modo">Carregando...</strong>
                            <div class="text-muted" id="relatorio-estoque-legenda"></div>
                            <div class="text-muted" id="relatorio-estoque-filtro-datas"></div>
                            <div class="text-muted" id="relatorio-estoque-valor-total"></div>
                        </div>
                        <div class="table-responsive">
                            <table class="table table-sm table-striped table-hover">
                                <thead>
                                    <tr>
                                        <th>Produto</th>
                                        <th>Categoria</th>
                                        <th id="relatorio-estoque-th-estoque">Estoque</th>
                                        <th>Mínimo</th>
                                        <th>Lote</th>
                                        <th>Validade</th>
                                        <th>Última compra</th>
                                        <th>Total em estoque</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody id="relatorio-estoque-tbody">
                                    <tr><td colspan="9" class="text-center">Carregando relatório...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer no-print">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#modal-container').html(modalHtml);
    modalEl = document.getElementById('relatorio-estoque-modal');
    const modal = new bootstrap.Modal(modalEl);
    modalEl.addEventListener('hidden.bs.modal', function () {
        window.__cdsRelatorioEstoqueItens = [];
        window.__cdsRelatorioEstoqueCache = null;
        modal.dispose();
        $('#relatorio-estoque-modal').remove();
        $('.modal-backdrop').remove();
    });
    modal.show();
    return modalEl;
}

function carregarRelatorioEstoqueProdutos(tipoFiltro = 'todos', filtroInicio = '', filtroFim = '') {
    garantirModalRelatorioEstoque(tipoFiltro, filtroInicio, filtroFim);

    const cache = window.__cdsRelatorioEstoqueCache;
    if (cache && cache.inicio === (filtroInicio || '') && cache.fim === (filtroFim || '') && Array.isArray(cache.produtos)) {
        renderRelatorioEstoqueProdutos(cache.produtos, tipoFiltro, filtroInicio, filtroFim);
        return;
    }

    const tbody = document.getElementById('relatorio-estoque-tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">Carregando relatório...</td></tr>';
    }

    const params = new URLSearchParams();
    params.append('modo_fiscal', modoFiscalParamGestaoProdutosLocal());
    if (filtroInicio) params.append('inicio', filtroInicio);
    if (filtroFim) params.append('fim', filtroFim);

    $.ajax({
        url: `${API_URL}/produtos/relatorio-estoque?${params.toString()}`,
        method: 'GET',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function(produtos) {
            window.__cdsRelatorioEstoqueCache = {
                produtos: produtos || [],
                inicio: filtroInicio || '',
                fim: filtroFim || ''
            };
            renderRelatorioEstoqueProdutos(produtos || [], tipoFiltro, filtroInicio, filtroFim);
        },
        error: function(xhr) {
            const erro = xhr.responseJSON?.error || 'Erro ao carregar relatório de estoque.';
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="9" class="text-center text-danger">${escapeHtml(erro)}</td></tr>`;
            }
            showNotification(erro, 'danger');
        }
    });
}

function renderRelatorioEstoqueProdutos(produtos, tipoFiltro = 'todos', filtroInicio = '', filtroFim = '') {
    produtos = Array.isArray(produtos) ? produtos : [];
    garantirModalRelatorioEstoque(tipoFiltro, filtroInicio, filtroFim);

    const inicio = parseRelatorioData(filtroInicio);
    const fim = parseRelatorioData(filtroFim);
    let produtosFiltrados = produtos;
    if (inicio || fim) {
        produtosFiltrados = produtos.filter((p) => isRelatorioDataDentroDoIntervalo(p.ultima_compra_data, inicio, fim));
    }

    const produtosExibidos = filtrarProdutosRelatorio(produtosFiltrados, tipoFiltro);
    window.__cdsRelatorioEstoqueItens = produtosExibidos;

    const valorTotalFiscal = produtosExibidos.reduce((sum, p) => {
        return sum + (quantidadeEstoqueRelatorio(p) * Number(p.preco_compra || 0));
    }, 0);

    const tituloModo = RELATORIO_PRODUTOS_FILTROS[tipoFiltro] || 'Todos os produtos';
    const filtroLegenda = `Exibindo ${produtosExibidos.length} produto(s) de ${produtosFiltrados.length} no período.`;
    const filtroDatasTexto = (inicio || fim)
        ? `Filtro aplicado pela data da última compra: ${filtroInicio || 'início não informado'} até ${filtroFim || 'fim não informado'}.`
        : 'Nenhum filtro de data aplicado.';

    const tituloEl = document.getElementById('relatorio-estoque-titulo-modo');
    const legendaEl = document.getElementById('relatorio-estoque-legenda');
    const datasEl = document.getElementById('relatorio-estoque-filtro-datas');
    const valorEl = document.getElementById('relatorio-estoque-valor-total');
    const thEstoque = document.getElementById('relatorio-estoque-th-estoque');
    const tbody = document.getElementById('relatorio-estoque-tbody');
    const modalEl = document.getElementById('relatorio-estoque-modal');

    if (tituloEl) tituloEl.textContent = tituloModo;
    if (legendaEl) legendaEl.textContent = filtroLegenda;
    if (datasEl) datasEl.textContent = filtroDatasTexto;
    if (valorEl) valorEl.textContent = `Valor total em estoque (F + NF): ${formatCurrency(valorTotalFiscal)}`;
    if (thEstoque) thEstoque.textContent = 'Estoque';
    if (modalEl) modalEl.setAttribute('data-tipo-filtro', tipoFiltro);
    if (tbody) tbody.innerHTML = montarLinhasRelatorioEstoque(produtosExibidos);
}


function montarOptionsFiltroCategorias(produtos) {
    const mapa = new Map();

    (produtos || []).forEach(p => {
        const id = String(p.categoria_id || '');
        const nome = p.categoria || p.categoria_nome || '';

        if (id && nome) {
            mapa.set(id, nome);
        }
    });

    return Array.from(mapa.entries())
        .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
        .map(([id, nome]) => `<option value="${id}">${escapeHtml(nome)}</option>`)
        .join('');
}

function consultaBuscaSoDigitos(termoBruto) {
    return /^\d+$/.test(String(termoBruto || '').replace(/\s+/g, ''));
}

function tokensBuscaSignificativos(termoNormalizado) {
    const vistos = new Set();
    const out = [];
    String(termoNormalizado || '')
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .forEach((t) => {
            if (vistos.has(t)) return;
            vistos.add(t);
            if (t.length >= 3 || (t.length >= 2 && /\d/.test(t))) out.push(t);
        });
    return out;
}

function idsNumericosBuscaIguais(a, b) {
    const da = String(a ?? '').replace(/\D/g, '');
    const db = String(b ?? '').replace(/\D/g, '');
    if (!da || !db) return false;
    const na = da.replace(/^0+(?=\d)/, '') || '0';
    const nb = db.replace(/^0+(?=\d)/, '') || '0';
    return na === nb;
}

function filtrarListaProdutosUI(produtos) {
    const termoBruto = String($('#buscaProduto').val() || '').trim();
    const termo = normalizarTexto(termoBruto);
    const termoDigits = consultaBuscaSoDigitos(termoBruto) ? termoBruto.replace(/\D/g, '') : '';
    const categoriaId = String($('#filtroCategoriaProduto').val() || '');

    return (produtos || []).filter(p => {
        const bateBusca = !termo || produtoCorrespondeBuscaInteligente(p, termo, termoDigits);

        const bateCategoria =
            !categoriaId || String(p.categoria_id || '') === categoriaId;

        return bateBusca && bateCategoria;
    });
}

/** Fallback legado — somente se SearchService/SDK falhar. */
function filtrarListaProdutosFallbackLocal(produtos) {
    return filtrarListaProdutosUI(produtos);
}

function compactarMedidasBusca(texto) {
    return String(texto || '').replace(/(^|[^0-9])0+(\d)/g, '$1$2');
}

function produtoCorrespondeBuscaInteligente(produto, termoNormalizado, termoDigits) {
    if (!termoNormalizado) return true;

    const termoBruto = String($('#buscaProduto').val() || '').trim();
    if (!termoDigits && window.CdsBuscaProdutoTexto && typeof window.CdsBuscaProdutoTexto.produtoCorrespondeBuscaNome === 'function') {
        if (window.CdsBuscaProdutoTexto.produtoCorrespondeBuscaNome(produto, termoBruto || termoNormalizado)) {
            return true;
        }
    }

    if (termoDigits) {
        const plu = String(produto.plu || '');
        const codigo = String(produto.codigo || '');
        const barras = String(produto.codigo_barras || '');
        if (
            idsNumericosBuscaIguais(plu, termoDigits)
            || idsNumericosBuscaIguais(codigo, termoDigits)
            || idsNumericosBuscaIguais(barras, termoDigits)
            || String(produto.id || '') === termoDigits
            || codigo.toLowerCase() === String(termoNormalizado)
            || plu.toLowerCase() === String(termoNormalizado)
            || barras.toLowerCase() === String(termoNormalizado)
        ) {
            return true;
        }
        return false;
    }

    const camposTexto = [
        produto.nome,
        produto.nome_busca,
        produto.descricao,
        produto.observacoes,
        produto.codigo,
        produto.plu,
        produto.categoria,
        produto.categoria_nome,
        produto.marca,
        produto.marca_nome,
        produto.fornecedor
    ];

    if (camposTexto.some((campo) => campo && normalizarTexto(campo).includes(termoNormalizado))) {
        return true;
    }
    const compactoFrase = camposTexto
        .map((campo) => (campo ? normalizarTexto(campo).replace(/[^a-z0-9]/g, '') : ''))
        .join('');
    const fraseCompacta = String(termoNormalizado).replace(/[^a-z0-9]/g, '');
    if (fraseCompacta && compactarMedidasBusca(compactoFrase).includes(compactarMedidasBusca(fraseCompacta))) {
        return true;
    }

    const fortes = tokensBuscaSignificativos(termoNormalizado);
    if (!fortes.length) return false;

    const compacto = [
        produto.nome,
        produto.nome_busca,
        produto.descricao,
        produto.marca,
        produto.marca_nome,
        produto.categoria,
        produto.categoria_nome
    ]
        .map((campo) => (campo ? normalizarTexto(campo).replace(/[^a-z0-9]/g, '') : ''))
        .join('');
    const palavrasNome = String(produto.nome || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3);
    const tokenNoProduto = (t) => {
        const contem = (hay, tok) => {
            const h = String(hay || '');
            const k = String(tok || '');
            if (!k) return false;
            if (h.includes(k)) return true;
            const semZero = k.replace(/^0+(?=\d)/, '');
            if (semZero && semZero !== k && h.includes(semZero)) return true;
            const hc = compactarMedidasBusca(h);
            if (hc.includes(k) || (semZero && semZero !== k && hc.includes(semZero))) return true;
            const kc = compactarMedidasBusca(k);
            return kc !== k && hc.includes(kc);
        };
        if (/^\d+$/.test(t)) {
            return idsNumericosBuscaIguais(produto.codigo, t)
                || idsNumericosBuscaIguais(produto.codigo_barras, t)
                || idsNumericosBuscaIguais(produto.plu, t)
                || contem(compacto, t);
        }
        if (contem(compacto, t)) return true;
        if (t.length < 3 || !/[a-z]/.test(t)) return false;
        return palavrasNome.some((w) => w === t || w.startsWith(t) || t.startsWith(w));
    };
    return fortes.every(tokenNoProduto);
}

function formatarNomeProdutoComPlu(produto) {
    const nome = escapeHtml(produto?.nome || '');
    const plu = String(produto?.plu || '').trim();
    if (!plu) return nome;
    return `<span class="text-muted small me-1">[${escapeHtml(plu)}]</span>${nome}`;
}

function expandirNosArvoreParaLista(produtos) {
    const estado = obterEstadoArvoreProdutos();
    montarArvoreProdutos(produtos).forEach((categoria) => {
        estado.categorias[categoria.key] = true;
        categoria.subcategorias.forEach((sub) => {
            estado.subcategorias[chaveSubcategoriaEstado(categoria.key, sub.key)] = true;
        });
    });
}

function atualizarStatusBuscaOperacional(opcoes = {}) {
    const $status = $('#busca-operacional-status');
    if (!$status.length) return;
    const termo = String($('#buscaProduto').val() || '').trim();
    if (!termo || opcoes.origem === 'arvore') {
        $status.hide().empty();
        return;
    }
    const sugestoes = opcoes.sugestoes === true;
    const qtd = Array.isArray(opcoes.itens) ? opcoes.itens.length : 0;
    if (sugestoes) {
        $status.html(
            '<p class="cds-prod-busca-status__vazio mb-2">Nenhum produto encontrado.</p>'
            + '<p class="cds-prod-busca-status__sugestoes-titulo mb-0">Sugestões</p>'
        ).show();
        return;
    }
    if (qtd === 0) {
        $status.html('<p class="cds-prod-busca-status__vazio mb-0">Nenhum produto encontrado.</p>').show();
        return;
    }
    $status.hide().empty();
}

function aplicarFiltrosProdutos(produtos, opcoes = {}) {
    const termo = String($('#buscaProduto').val() || '').trim();
    const categoriaId = String($('#filtroCategoriaProduto').val() || '');
    const origemMib = opcoes.origem === 'mib';
    const origemOperacional = opcoes.origem === 'operacional';

    const Resolver = window.CdsResolverBuscaCadastroProdutos;
    let filtrados;
    if (!termo) {
        filtrados = Resolver && typeof Resolver.preservarHitsCadastro === 'function'
            ? Resolver.preservarHitsCadastro(produtos, { buscaAtiva: false, categoriaId })
            : (produtos || []).filter((p) =>
                !categoriaId || String(p.categoria_id || '') === categoriaId
            );
    } else if (origemMib || origemOperacional) {
        // Sprint 03/04: busca explícita tem prioridade sobre a árvore de categorias.
        filtrados = Resolver && typeof Resolver.preservarHitsCadastro === 'function'
            ? Resolver.preservarHitsCadastro(produtos, {
                buscaAtiva: true,
                origemMib,
                origemOperacional,
                categoriaId
            })
            : (produtos || []).slice();
        if (origemMib && consultaBuscaSoDigitos(termo)) {
            const digits = String(termo).replace(/\D/g, '');
            filtrados = filtrados.filter((p) =>
                produtoCorrespondeBuscaInteligente(p, normalizarTexto(termo), digits)
            );
        }
    } else {
        filtrados = filtrarListaProdutosFallbackLocal(produtos);
    }

    const filtroAtivo = !!(termo || categoriaId);
    const listaPlanaBusca = (origemMib || origemOperacional) && !!termo;

    if (listaPlanaBusca) {
        $('#categorias-container').hide();
        $('#tabela-produtos-container').show();
        atualizarStatusBuscaOperacional({
            origem: opcoes.origem,
            sugestoes: opcoes.sugestoes === true,
            itens: filtrados
        });
        substituirHtmlListagemProdutos(document.getElementById('produtos-tbody'), renderProdutosRows(filtrados, { buscaAtiva: true }));
        return;
    }

    atualizarStatusBuscaOperacional({ origem: 'arvore' });

    // Sem busca: árvore categoria → subcategoria → produtos.
    if (filtroAtivo) {
        expandirNosArvoreParaLista(filtrados);
    }

    $('#tabela-produtos-container').hide();
    $('#categorias-container').show();
    renderizarArvoreListagemProdutos(filtrados, { preservarOrdem: origemMib || origemOperacional });
}

/** HOTFIX MIB-4.0.1 — estado da busca tipada via SearchSDK */
const CDS_PRODUTOS_BUSCA_MIB = {
    debounceMs: 300,
    debounceOperacionalMs: 180,
    timer: null,
    abort: null,
    seq: 0,
    ultimaMeta: null
};

function obterSdkBuscaProdutos() {
    return window.CdsSearchSDK || window.SearchSDK || null;
}

function setIndicadorBuscaProdutos(ativo) {
    const $icon = $('.cds-prod-lista-header__busca-icon');
    if (!$icon.length) return;
    if (ativo) {
        $icon.removeClass('fa-search').addClass('fa-spinner fa-spin');
        $icon.attr('title', 'Pesquisando…');
    } else {
        $icon.removeClass('fa-spinner fa-spin').addClass('fa-search');
        $icon.removeAttr('title');
    }
}

function enriquecerHitsBuscaProdutos(itens) {
    const cache = window.produtosCache || window.produtosList || [];
    const byId = new Map(cache.map((p) => [Number(p.id), p]));
    const Resolver = window.CdsResolverBuscaCadastroProdutos;
    return (itens || []).map((hit) => {
        const ranking = Resolver && typeof Resolver.preservarCamposRankingMib === 'function'
            ? Resolver.preservarCamposRankingMib(hit)
            : {
                mib_score: hit.mib_score,
                mib_match_tipo: hit.mib_match_tipo,
                mib_match_rank: hit.mib_match_rank,
                _fonteBusca: hit._fonte || 'mib'
            };
        const full = byId.get(Number(hit.id));
        if (full) {
            return { ...full, ...ranking };
        }
        return {
            ...hit,
            ...ranking,
            categoria: hit.categoria || hit.categoria_nome || '',
            categoria_nome: hit.categoria_nome || hit.categoria || '',
            subcategoria: hit.subcategoria || hit.subcategoria_nome || ''
        };
    });
}

function cancelarBuscaProdutosMib() {
    if (CDS_PRODUTOS_BUSCA_MIB.timer) {
        clearTimeout(CDS_PRODUTOS_BUSCA_MIB.timer);
        CDS_PRODUTOS_BUSCA_MIB.timer = null;
    }
    if (CDS_PRODUTOS_BUSCA_MIB.abort) {
        try { CDS_PRODUTOS_BUSCA_MIB.abort.abort(); } catch (_) { /* ignore */ }
        CDS_PRODUTOS_BUSCA_MIB.abort = null;
    }
}

if (typeof window !== 'undefined' && !window.__cdsProdutosLeaveBound && window.UINavigation && typeof window.UINavigation.onPageLeave === 'function') {
    window.__cdsProdutosLeaveBound = true;
    window.UINavigation.onPageLeave('produtos', function () {
        cancelarBuscaProdutosMib();
    });
}

function restaurarArvoreProdutosOriginal() {
    setIndicadorBuscaProdutos(false);
    CDS_PRODUTOS_BUSCA_MIB.ultimaMeta = null;
    const base = window.produtosCache || window.produtosList || [];
    aplicarFiltrosProdutos(base, { origem: 'arvore' });
}

async function executarBuscaProdutosViaMib(termo) {
    const sdk = obterSdkBuscaProdutos();
    const base = window.produtosCache || window.produtosList || [];
    const seq = ++CDS_PRODUTOS_BUSCA_MIB.seq;
    const Resolver = window.CdsResolverBuscaCadastroProdutos;

    if (CDS_PRODUTOS_BUSCA_MIB.abort) {
        try { CDS_PRODUTOS_BUSCA_MIB.abort.abort(); } catch (_) { /* ignore */ }
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    CDS_PRODUTOS_BUSCA_MIB.abort = controller;
    setIndicadorBuscaProdutos(true);

    const respostaObsoleta = () => Resolver && typeof Resolver.deveIgnorarRespostaBusca === 'function'
        ? Resolver.deveIgnorarRespostaBusca(seq, CDS_PRODUTOS_BUSCA_MIB.seq)
        : seq !== CDS_PRODUTOS_BUSCA_MIB.seq;

    try {
        const modoFiscal = modoFiscalParamGestaoProdutosLocal();
        const apiBase = typeof API_URL !== 'undefined' ? API_URL : '/api';
        const url = `${apiBase}/produtos/busca-operacional?q=${encodeURIComponent(termo)}&modo_fiscal=${modoFiscal}&limite=20&sugestoes=1`;
        const resp = await fetch(url, {
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token') || ''}`
            },
            signal: controller ? controller.signal : undefined
        });
        const dados = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            throw new Error(dados.error || `HTTP ${resp.status}`);
        }
        if (respostaObsoleta()) return;

        const itensOp = enriquecerHitsBuscaProdutos(dados.itens || []);
        CDS_PRODUTOS_BUSCA_MIB.ultimaMeta = dados.meta || null;
        if (itensOp.length > 0) {
            aplicarFiltrosProdutos(itensOp, { origem: 'operacional' });
            return;
        }

        let sugestoes = enriquecerHitsBuscaProdutos(dados.sugestoes || []);
        const possuiSugestao = Resolver && typeof Resolver.mibPossuiResultadosValidos === 'function'
            ? Resolver.mibPossuiResultadosValidos({ itens: sugestoes })
            : sugestoes.length > 0;

        if (!possuiSugestao && sdk && typeof sdk.search === 'function') {
            const resultado = await sdk.search({
                entity: 'produto',
                query: termo,
                limite: 20,
                modo_fiscal: modoFiscal,
                origem: 'erp-cadastro-produtos'
            }, { signal: controller ? controller.signal : undefined });
            if (respostaObsoleta()) return;
            sugestoes = enriquecerHitsBuscaProdutos(resultado.itens || []);
            CDS_PRODUTOS_BUSCA_MIB.ultimaMeta = resultado.meta || null;
        }

        const possuiMib = Resolver && typeof Resolver.mibPossuiResultadosValidos === 'function'
            ? Resolver.mibPossuiResultadosValidos({ itens: sugestoes })
            : sugestoes.length > 0;
        if (possuiMib) {
            aplicarFiltrosProdutos(sugestoes, { origem: 'mib', sugestoes: true });
            return;
        }
        aplicarFiltrosProdutos([], { origem: 'operacional' });
    } catch (err) {
        if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) return;
        console.warn('[MIB-4.0.1] Busca operacional falhou — fallback filtro local:', err && err.message ? err.message : err);
        if (respostaObsoleta()) return;
        aplicarFiltrosProdutos(base, { fallbackLocal: true });
    } finally {
        if (seq === CDS_PRODUTOS_BUSCA_MIB.seq) {
            setIndicadorBuscaProdutos(false);
            CDS_PRODUTOS_BUSCA_MIB.abort = null;
        }
    }
}

function agendarBuscaProdutosMib() {
    const termo = String($('#buscaProduto').val() || '').trim();
    cancelarBuscaProdutosMib();

    if (!termo) {
        restaurarArvoreProdutosOriginal();
        return;
    }

    CDS_PRODUTOS_BUSCA_MIB.timer = setTimeout(() => {
        CDS_PRODUTOS_BUSCA_MIB.timer = null;
        executarBuscaProdutosViaMib(termo);
    }, CDS_PRODUTOS_BUSCA_MIB.debounceOperacionalMs || 180);
}

function onFiltroCategoriaProdutosChange() {
    const termo = String($('#buscaProduto').val() || '').trim();
    if (!termo) {
        restaurarArvoreProdutosOriginal();
        return;
    }
    // Rebusca MIB para aplicar o filtro de categoria sobre hits atualizados
    agendarBuscaProdutosMib();
}

function produtoComEstoqueBaixo(p) {
    return classificarEstoqueProduto(p) === 'estoque_baixo';
}

function produtoProximoMinimo(p) {
    return classificarEstoqueProduto(p) === 'proximo_minimo';
}

function renderProdutoRow(p) {
    const status = obterStatusVisualProduto(p);
    const classes = classesLinhaStatusProduto(status);
    const badges = montarBadgesStatusProduto(p);

    return `
        <tr class="${classes.row}" data-produto-id="${p.id}">
            <td class="${classes.text} fw-semibold">${formatarNomeProdutoComPlu(p)}</td>
            <td>${escapeHtml(p.codigo || '')}</td>
            <td>${escapeHtml(p.categoria || p.categoria_nome || '')}</td>
            <td>${escapeHtml(p.unidade || '')}</td>
            <td>${formatCurrency(p.preco_compra || 0)}</td>
            <td>${formatCurrency(p.preco_venda || 0)}</td>
            <td class="${classes.estoque}">
                ${formatarColunaEstoqueLista(p)}
                ${badges}
            </td>
            <td>
                <button class="btn btn-sm btn-info" onclick="viewProduto(${p.id})">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn btn-sm btn-warning" onclick="editProduto(${p.id})">
                    <i class="fas fa-edit"></i>
                </button>
                ${podeAjustarEstoque() ? `
                <button class="btn btn-sm btn-success" onclick="abrirModalAjustarEstoque(${p.id})" title="Ajustar Estoque">
                    <i class="fas fa-boxes"></i>
                </button>
                ` : ''}
                <button class="btn btn-sm btn-danger" onclick="deleteProduto(${p.id})">
                    <i class="fas fa-trash"></i>
                </button>
                <button class="btn btn-sm btn-secondary" onclick="historicoProduto(${p.id})">
                    <i class="fas fa-history"></i>
                </button>
            </td>
        </tr>
    `;
}

const PRODUTOS_SEM_CATEGORIA = 'Sem Categoria';
const PRODUTOS_SEM_SUBCATEGORIA = 'Sem Subcategoria';
const PRODUTOS_ARVORE_ANIM_MS = 150;

function obterEstadoArvoreProdutos() {
    if (!window._produtosArvoreEstado) {
        window._produtosArvoreEstado = {
            categorias: Object.create(null),
            subcategorias: Object.create(null)
        };
    }
    return window._produtosArvoreEstado;
}

function resetarEstadoArvoreProdutos() {
    window._produtosArvoreEstado = {
        categorias: Object.create(null),
        subcategorias: Object.create(null)
    };
}

function escapeAttrProdutos(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function obterNomeCategoriaListagem(produto) {
    const nome = String(produto.categoria || produto.categoria_nome || '').trim();
    return nome || PRODUTOS_SEM_CATEGORIA;
}

function obterNomeSubcategoriaListagem(produto) {
    const nome = String(produto.subcategoria || produto.subcategoria_nome || '').trim();
    return nome || PRODUTOS_SEM_SUBCATEGORIA;
}

function chaveCategoriaListagem(produto) {
    const id = String(produto.categoria_id || '').trim();
    if (id) return `id:${id}`;
    return `nome:${obterNomeCategoriaListagem(produto)}`;
}

function chaveSubcategoriaListagem(produto) {
    const id = String(produto.subcategoria_id || '').trim();
    if (id) return `id:${id}`;
    return `nome:${obterNomeSubcategoriaListagem(produto)}`;
}

function chaveSubcategoriaEstado(catKey, subKey) {
    return `${catKey}::${subKey}`;
}

function montarBadgesContagemListagem(count, countProximo, countBaixo) {
    return `
        <span class="cds-prod-tree__badges">
            <span class="badge bg-primary cds-prod-tree__badge">${count}</span>
            ${countProximo > 0 ? `<span class="badge bg-warning text-dark cds-prod-tree__badge" title="Próximo do estoque mínimo">${countProximo} próx.</span>` : ''}
            ${countBaixo > 0 ? `<span class="badge bg-danger cds-prod-tree__badge" title="Estoque no mínimo ou abaixo">${countBaixo} baixo</span>` : ''}
        </span>
    `;
}

function montarArvoreProdutos(produtos) {
    const lista = produtos || [];
    const preservarOrdem = window._produtosArvorePreservarOrdem === true;
    const cache = window.__cdsProdutosArvoreCache;
    if (cache && cache.lista === lista && cache.preservarOrdem === preservarOrdem && cache.arvore) {
        registrarMetricaProdutos71('tree-cache-hit', { records: lista.length });
        return cache.arvore;
    }

    const treeOp = window.PerformanceMonitor?.start?.('produtos:tree-build', { records: lista.length });
    const categoriasMap = new Map();

    lista.forEach((produto) => {
        const catKey = chaveCategoriaListagem(produto);
        const catNome = obterNomeCategoriaListagem(produto);
        const subKey = chaveSubcategoriaListagem(produto);
        const subNome = obterNomeSubcategoriaListagem(produto);

        if (!categoriasMap.has(catKey)) {
            categoriasMap.set(catKey, {
                key: catKey,
                nome: catNome,
                itens: [],
                subcategoriasMap: new Map()
            });
        }

        const categoria = categoriasMap.get(catKey);
        categoria.itens.push(produto);

        if (!categoria.subcategoriasMap.has(subKey)) {
            categoria.subcategoriasMap.set(subKey, {
                key: subKey,
                nome: subNome,
                produtos: []
            });
        }

        categoria.subcategoriasMap.get(subKey).produtos.push(produto);
    });

    const arvore = Array.from(categoriasMap.values())
        .map((categoria) => {
            const subcategorias = Array.from(categoria.subcategoriasMap.values())
                .map((sub) => {
                    const produtosOrdenados = window._produtosArvorePreservarOrdem
                        ? sub.produtos.slice()
                        : sub.produtos
                            .slice()
                            .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
                    return {
                        key: sub.key,
                        nome: sub.nome,
                        produtos: produtosOrdenados,
                        count: produtosOrdenados.length,
                        countBaixo: produtosOrdenados.filter((p) => produtoComEstoqueBaixo(p)).length,
                        countProximo: produtosOrdenados.filter((p) => produtoProximoMinimo(p)).length
                    };
                })
                .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

            return {
                key: categoria.key,
                nome: categoria.nome,
                count: categoria.itens.length,
                countBaixo: categoria.itens.filter((p) => produtoComEstoqueBaixo(p)).length,
                countProximo: categoria.itens.filter((p) => produtoProximoMinimo(p)).length,
                subcategorias
            };
        })
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    window.__cdsProdutosArvoreCache = {
        lista,
        preservarOrdem,
        arvore
    };
    if (treeOp) {
        window.PerformanceMonitor.end(treeOp, {
            cached: false,
            categorias: arvore.length
        });
    }
    return arvore;
}

function encontrarCategoriaArvore(produtos, catKey) {
    return montarArvoreProdutos(produtos).find((cat) => cat.key === catKey) || null;
}

function encontrarSubcategoriaArvore(produtos, catKey, subKey) {
    const categoria = encontrarCategoriaArvore(produtos, catKey);
    if (!categoria) return null;
    return categoria.subcategorias.find((sub) => sub.key === subKey) || null;
}

function renderCabecalhoCategoriaArvore(categoria, aberta) {
    const chevron = aberta ? '▼' : '►';
    return `
        <div class="cds-prod-tree__categoria-header categoria-toggle" role="button" tabindex="0" aria-expanded="${aberta ? 'true' : 'false'}">
            <span class="cds-prod-tree__categoria-title">
                <span class="cds-prod-tree__chevron">${chevron}</span>
                <span class="cds-prod-tree__icon cds-prod-tree__icon--cat" aria-hidden="true">📁</span>
                <span class="cds-prod-tree__name">${escapeHtml(categoria.nome)}</span>
            </span>
            ${montarBadgesContagemListagem(categoria.count, categoria.countProximo, categoria.countBaixo)}
        </div>
    `;
}

function renderCabecalhoSubcategoriaArvore(sub, aberta) {
    const chevron = aberta ? '▼' : '►';
    return `
        <div class="cds-prod-tree__subcategoria-header subcategoria-toggle" role="button" tabindex="0" aria-expanded="${aberta ? 'true' : 'false'}">
            <span class="cds-prod-tree__subcategoria-title">
                <span class="cds-prod-tree__chevron">${chevron}</span>
                <span class="cds-prod-tree__icon cds-prod-tree__icon--sub" aria-hidden="true">📂</span>
                <span class="cds-prod-tree__name">${escapeHtml(sub.nome)}</span>
            </span>
            ${montarBadgesContagemListagem(sub.count, sub.countProximo, sub.countBaixo)}
        </div>
    `;
}

function renderTabelaProdutosArvore(produtos) {
    return `
        <div class="cds-prod-tree__table-wrap table-responsive">
            <table class="table table-striped table-hover mb-0">
                <thead>
                    <tr>
                        <th>Nome</th>
                        <th>Código</th>
                        <th>Categoria</th>
                        <th>Unidade</th>
                        <th>Preço Compra</th>
                        <th>Preço Venda</th>
                        <th>${tituloColunaEstoqueLista()}</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${(produtos || []).map((p) => renderProdutoRow(p)).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderHtmlSubcategoriasArvore(categoria) {
    const estado = obterEstadoArvoreProdutos();

    return (categoria.subcategorias || []).map((sub) => {
        const subEstadoKey = chaveSubcategoriaEstado(categoria.key, sub.key);
        const subAberta = !!estado.subcategorias[subEstadoKey];
        const produtosHtml = subAberta ? renderTabelaProdutosArvore(sub.produtos) : '';

        return `
            <div class="cds-prod-tree__subcategoria subcategoria-card" data-cat-key="${escapeAttrProdutos(categoria.key)}" data-sub-key="${escapeAttrProdutos(sub.key)}">
                ${renderCabecalhoSubcategoriaArvore(sub, subAberta)}
                <div class="cds-prod-tree__subcategoria-body subcategoria-body" ${subAberta ? '' : 'style="display: none;"'}>
                    ${produtosHtml}
                </div>
            </div>
        `;
    }).join('');
}

function renderHtmlArvoreListagemProdutos(produtos) {
    const arvore = montarArvoreProdutos(produtos);
    const estado = obterEstadoArvoreProdutos();

    if (!arvore.length) {
        return '<div class="alert alert-warning mb-0">Nenhum produto encontrado.</div>';
    }

    return arvore.map((categoria) => {
        const catAberta = !!estado.categorias[categoria.key];
        const subHtml = catAberta ? renderHtmlSubcategoriasArvore(categoria) : '';

        return `
            <div class="cds-prod-tree__categoria categoria-card" data-cat-key="${escapeAttrProdutos(categoria.key)}">
                ${renderCabecalhoCategoriaArvore(categoria, catAberta)}
                <div class="cds-prod-tree__categoria-body categoria-body" ${catAberta ? '' : 'style="display: none;"'}>
                    ${subHtml}
                </div>
            </div>
        `;
    }).join('');
}

function sincronizarCabecalhoCategoria($card, categoria, aberta) {
    $card.children('.cds-prod-tree__categoria-header, .categoria-toggle').first()
        .replaceWith(renderCabecalhoCategoriaArvore(categoria, aberta));
}

function sincronizarCabecalhoSubcategoria($card, sub, aberta) {
    $card.children('.cds-prod-tree__subcategoria-header, .subcategoria-toggle').first()
        .replaceWith(renderCabecalhoSubcategoriaArvore(sub, aberta));
}

function bindEventosArvoreListagemProdutos() {
    const $container = $('#categorias-container');
    $container.off('click.arvoreProdutos keydown.arvoreProdutos');

    $container.on('click.arvoreProdutos', '.categoria-toggle', function (e) {
        e.preventDefault();
        const $card = $(this).closest('.categoria-card');
        const catKey = String($card.attr('data-cat-key') || '');
        if (!catKey) return;

        const estado = obterEstadoArvoreProdutos();
        const abrindo = !estado.categorias[catKey];
        estado.categorias[catKey] = abrindo;

        const categoria = encontrarCategoriaArvore(window._produtosArvoreListaAtual || [], catKey);
        if (!categoria) return;

        const $body = $card.children('.categoria-body');
        sincronizarCabecalhoCategoria($card, categoria, abrindo);

        if (abrindo) {
            $body.stop(true, true).html(renderHtmlSubcategoriasArvore(categoria)).hide().slideDown(PRODUTOS_ARVORE_ANIM_MS);
        } else {
            $body.stop(true, true).slideUp(PRODUTOS_ARVORE_ANIM_MS, function () {
                $(this).empty();
            });
        }
    });

    $container.on('click.arvoreProdutos', '.subcategoria-toggle', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const $card = $(this).closest('.subcategoria-card');
        const catKey = String($card.attr('data-cat-key') || '');
        const subKey = String($card.attr('data-sub-key') || '');
        if (!catKey || !subKey) return;

        const estado = obterEstadoArvoreProdutos();
        const subEstadoKey = chaveSubcategoriaEstado(catKey, subKey);
        const abrindo = !estado.subcategorias[subEstadoKey];
        estado.subcategorias[subEstadoKey] = abrindo;
        estado.categorias[catKey] = true;

        const sub = encontrarSubcategoriaArvore(window._produtosArvoreListaAtual || [], catKey, subKey);
        if (!sub) return;

        const $body = $card.children('.subcategoria-body');
        sincronizarCabecalhoSubcategoria($card, sub, abrindo);

        if (abrindo) {
            $body.stop(true, true).html(renderTabelaProdutosArvore(sub.produtos)).hide().slideDown(PRODUTOS_ARVORE_ANIM_MS);
        } else {
            $body.stop(true, true).slideUp(PRODUTOS_ARVORE_ANIM_MS, function () {
                $(this).empty();
            });
        }
    });

    $container.on('keydown.arvoreProdutos', '.categoria-toggle, .subcategoria-toggle', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        $(this).trigger('click');
    });
}

function substituirHtmlListagemProdutos(container, html) {
    if (!container) return false;
    if (window.UISoftRefresh && typeof window.UISoftRefresh.replaceHtml === 'function') {
        registrarMetricaProdutos71('dom-soft-replace', {
            target: container.id || container.className || 'node'
        });
        return window.UISoftRefresh.replaceHtml(container, html);
    }
    container.innerHTML = html;
    return true;
}

function renderizarArvoreListagemProdutos(produtos, opcoes = {}) {
    window._produtosArvoreListaAtual = produtos || [];
    if (Object.prototype.hasOwnProperty.call(opcoes, 'preservarOrdem')) {
        window._produtosArvorePreservarOrdem = opcoes.preservarOrdem === true;
    }
    const $container = $('#categorias-container');
    $container.addClass('cds-prod-tree');
    const htmlOp = window.PerformanceMonitor?.start?.('produtos:tree-html', {
        records: window._produtosArvoreListaAtual.length
    });
    const html = renderHtmlArvoreListagemProdutos(window._produtosArvoreListaAtual);
    substituirHtmlListagemProdutos($container[0], html);
    if (htmlOp) {
        window.PerformanceMonitor.end(htmlOp, {
            htmlBytesApprox: window.PerformanceMonitor.approximateBytes?.(html) ?? null
        });
    }
    bindEventosArvoreListagemProdutos();
}

/** @deprecated Mantido para compatibilidade — a listagem usa a árvore recolhível. */
function renderProdutosAgrupados(produtos) {
    expandirNosArvoreParaLista(produtos || []);
    return renderHtmlArvoreListagemProdutos(produtos || []);
}

function gerarRelatorioEstoque() {
    showRelatorioEstoqueProdutos();
}

// Renderiza listagem de produtos
function renderProdutos(produtos) {
    const Perf = window.PerformanceMonitor;
    const totalOp = Perf?.start?.('produtos:render-total', { records: produtos.length });
    window.produtosCache = produtos;
    window.produtosOriginais = produtos;
    window.produtosList = produtos;

    // Soft path: shell já montado — não destruir #buscaProduto / filtros durante edição
    if (shellListagemProdutosMontado()) {
        if (typeof atualizarListagemProdutosSemRemontarShell === 'function') {
            atualizarListagemProdutosSemRemontarShell(produtos, { semFanout: true });
            if (totalOp) Perf.end(totalOp, { soft: true });
            return;
        }
    }

    const Focus = window.UIFocusManager;
    const pageEl = document.getElementById('page-content');
    if (Focus && Focus.isEditing(pageEl) && document.getElementById('buscaProduto')) {
        if (typeof atualizarListagemProdutosSemRemontarShell === 'function') {
            atualizarListagemProdutosSemRemontarShell(produtos, { semFanout: true });
            if (totalOp) Perf.end(totalOp, { soft: true, editing: true });
            return;
        }
    }

    const htmlOp = Perf?.start?.('produtos:html-generation', { records: produtos.length });
    // Não zerar a árvore: recargas (modo fiscal / PDV aberto) fechavam as categorias.
    const shell = (typeof CdsPageShell !== 'undefined' && CdsPageShell.renderHeader)
        ? CdsPageShell.renderHeader({ page: 'produtos' })
        : '';
    const html = `
        ${shell}
        <div class="row mb-3 g-3">
            <div class="col-md-6 col-lg-4">
                <div class="card mb-0 border-danger h-100" id="cardEstoqueBaixoProdutos">
                    <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2 bg-danger bg-opacity-10">
                        <strong class="text-danger"><i class="fas fa-exclamation-triangle me-2"></i>Alertas de estoque</strong>
                        <button type="button" class="btn btn-sm btn-outline-danger" onclick="carregarEstoqueBaixoProdutos()">
                            <i class="fas fa-sync-alt"></i> Atualizar
                        </button>
                    </div>
                    <div class="card-body" id="listaEstoqueBaixoProdutos">
                        <div class="text-muted">Carregando...</div>
                    </div>
                </div>
            </div>
            <div class="col-md-6 col-lg-4">
                <div class="card-dashboard card-vencimentos h-100" id="cardVencimentosProdutos">
                    <div class="card-icon">⏰</div>
                    <div class="card-info">
                        <h3>Vencimentos</h3>
                        <p>
                            <strong id="qtdProdutosVencidos">0</strong> vencidos |
                            <strong id="qtdProdutosProximos">0</strong> próximos
                        </p>
                        <button type="button" class="btn btn-warning btn-sm" onclick="abrirModalVencimentosProdutos()">
                            Ver produtos
                        </button>
                    </div>
                </div>
            </div>
            <div class="col-md-6 col-lg-4">
                <div class="card-dashboard card-promocoes h-100" id="cardPromocoesProdutos">
                    <div class="card-icon">🎯</div>
                    <div class="card-info">
                        <h3>Promoções Inteligentes</h3>
                        <p>
                            <strong id="qtdSugestoesProdutos">0</strong> sugestões |
                            <strong id="qtdPromocoesProdutos">0</strong> ativas
                        </p>
                        <button type="button" class="btn btn-info btn-sm" onclick="abrirModalPromocoesProdutos()">
                            Ver Sugestões
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <div class="card cds-prod-lista" id="cdsProdLista" data-cds-prod-visualizacao="default">
            <div class="card-header cds-prod-lista-header">
                <div class="cds-prod-lista-header__top">
                    <div class="cds-prod-lista-header__title">
                        <i class="fas fa-box"></i> Lista de Produtos
                    </div>
                    <div class="cds-prod-lista-header__actions">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="gerarRelatorioEstoque()">
                            <i class="fas fa-list"></i> Relatório de estoque
                        </button>
                        <button type="button" class="btn btn-primary btn-sm" onclick="showProdutoModal()">
                            <i class="fas fa-plus"></i> Novo Produto
                        </button>
                    </div>
                </div>
                <div class="cds-prod-lista-header__filters">
                    <div class="cds-prod-lista-header__busca">
                        <i class="fas fa-search cds-prod-lista-header__busca-icon" aria-hidden="true"></i>
                        <input
                            type="text"
                            class="form-control form-control-sm"
                            id="buscaProduto"
                            placeholder="Buscar por nome, marca, PLU, código ou código de barras..."
                            aria-label="Buscar produtos"
                            autocomplete="off"
                        >
                    </div>
                    <select
                        class="form-select form-select-sm cds-prod-lista-header__categoria"
                        id="filtroCategoriaProduto"
                        aria-label="Filtrar por categoria"
                    >
                        <option value="">Todas as categorias</option>
                        ${montarOptionsFiltroCategorias(produtos)}
                    </select>
                    <div class="cds-prod-lista-header__zoom" role="group" aria-label="Tamanho da visualização">
                        <button type="button" class="btn btn-outline-secondary btn-sm" id="btnProdutosZoomPadrao" title="Tamanho padrão" aria-label="Tamanho padrão">A Padrão</button>
                        <button type="button" class="btn btn-outline-secondary btn-sm" id="btnProdutosZoomMais" title="Aumentar visualização" aria-label="Aumentar visualização">A+</button>
                        <button type="button" class="btn btn-outline-secondary btn-sm" id="btnProdutosZoomMenos" title="Diminuir visualização" aria-label="Diminuir visualização">A−</button>
                    </div>
                </div>
            </div>

            <div class="card-body">
                <div class="alert alert-info py-2 mb-3">
                    <i class="fas fa-info-circle me-2"></i>
                    Expanda a categoria e a subcategoria para ver os produtos. Use a busca acima para pesquisar em todos os produtos.
                </div>
                <div class="d-flex flex-wrap gap-3 mb-3 small">
                    <span><span class="d-inline-block rounded px-2 py-1 bg-warning">&nbsp;</span> Amarelo: próximo do mínimo ou do vencimento</span>
                    <span><span class="d-inline-block rounded px-2 py-1 bg-danger">&nbsp;</span> Vermelho: estoque no mínimo ou abaixo / vencido</span>
                </div>
                <div id="categorias-container" class="cds-prod-tree"></div>
                <div class="table-responsive" id="tabela-produtos-container" style="display: none;">
                    <div id="busca-operacional-status" class="cds-prod-busca-status" style="display: none;"></div>
                    <table class="table table-striped table-hover">
                        <thead>
                            <tr>
                                <th>Nome</th>
                                <th>Código</th>
                                <th>Categoria</th>
                                <th>Unidade</th>
                                <th>Preço Compra</th>
                                <th>Preço Venda</th>
                                <th>${tituloColunaEstoqueLista()}</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody id="produtos-tbody">
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    if (htmlOp) Perf.end(htmlOp, { htmlBytesApprox: Perf.approximateBytes?.(html) ?? null });
    const domOp = Perf?.start?.('produtos:dom-update', { target: 'page-content' });
    const snap = Focus && Focus.isEditing(pageEl) ? Focus.captureFocusState(pageEl) : null;
    $('#page-content').html(html);
    if (snap) Focus.restoreFocusState(snap, { restoreValue: true });
    if (domOp) {
        Perf.end(domOp, {
            nodesAfter: document.getElementById('page-content')?.querySelectorAll('*').length || 0
        });
    }
    if (totalOp) Perf.end(totalOp);

    $('#buscaProduto').on('input', function () {
        agendarBuscaProdutosMib();
    });
    $('#filtroCategoriaProduto').on('change', function () {
        onFiltroCategoriaProdutosChange();
    });

    inicializarZoomListagemProdutos();

    carregarCategoriasProdutos();
    inicializarCardEstoqueBaixo();
    inicializarModalVencimentosProdutos();
    carregarVencimentosProdutos();
    carregarDashboardPromocoes();
}

/** Sprint UX-01 — densidade visual da listagem (somente CSS + localStorage). */
const CDS_PRODUTOS_VISUALIZACAO_KEY = 'cds_produtos_visualizacao';
const CDS_PRODUTOS_VISUALIZACAO_MODOS = ['default', 'medium', 'large'];

function lerPreferenciaVisualizacaoProdutos() {
    try {
        const raw = String(localStorage.getItem(CDS_PRODUTOS_VISUALIZACAO_KEY) || 'default').toLowerCase();
        return CDS_PRODUTOS_VISUALIZACAO_MODOS.includes(raw) ? raw : 'default';
    } catch (_) {
        return 'default';
    }
}

function salvarPreferenciaVisualizacaoProdutos(modo) {
    try {
        localStorage.setItem(CDS_PRODUTOS_VISUALIZACAO_KEY, modo);
    } catch (_) { /* ignore */ }
}

function aplicarVisualizacaoProdutos(modo) {
    const normalizado = CDS_PRODUTOS_VISUALIZACAO_MODOS.includes(modo) ? modo : 'default';
    const $root = $('#cdsProdLista');
    if (!$root.length) return normalizado;

    $root.attr('data-cds-prod-visualizacao', normalizado);

    const idx = CDS_PRODUTOS_VISUALIZACAO_MODOS.indexOf(normalizado);
    $('#btnProdutosZoomPadrao').toggleClass('is-active', normalizado === 'default');
    $('#btnProdutosZoomMais').prop('disabled', idx >= CDS_PRODUTOS_VISUALIZACAO_MODOS.length - 1);
    $('#btnProdutosZoomMenos').prop('disabled', idx <= 0);

    return normalizado;
}

function inicializarZoomListagemProdutos() {
    const atual = aplicarVisualizacaoProdutos(lerPreferenciaVisualizacaoProdutos());
    salvarPreferenciaVisualizacaoProdutos(atual);

    $('#btnProdutosZoomPadrao').off('click.prodZoom').on('click.prodZoom', function () {
        const modo = aplicarVisualizacaoProdutos('default');
        salvarPreferenciaVisualizacaoProdutos(modo);
    });

    $('#btnProdutosZoomMais').off('click.prodZoom').on('click.prodZoom', function () {
        const atualIdx = CDS_PRODUTOS_VISUALIZACAO_MODOS.indexOf(lerPreferenciaVisualizacaoProdutos());
        const proximo = CDS_PRODUTOS_VISUALIZACAO_MODOS[Math.min(atualIdx + 1, CDS_PRODUTOS_VISUALIZACAO_MODOS.length - 1)];
        const modo = aplicarVisualizacaoProdutos(proximo);
        salvarPreferenciaVisualizacaoProdutos(modo);
    });

    $('#btnProdutosZoomMenos').off('click.prodZoom').on('click.prodZoom', function () {
        const atualIdx = CDS_PRODUTOS_VISUALIZACAO_MODOS.indexOf(lerPreferenciaVisualizacaoProdutos());
        const anterior = CDS_PRODUTOS_VISUALIZACAO_MODOS[Math.max(atualIdx - 1, 0)];
        const modo = aplicarVisualizacaoProdutos(anterior);
        salvarPreferenciaVisualizacaoProdutos(modo);
    });
}

function renderCategoriasProdutos(produtos) {
    return renderHtmlArvoreListagemProdutos(produtos || []);
}

function carregarCategoriasProdutos() {
    const termo = String($('#buscaProduto').val() || '').trim();
    if (termo) agendarBuscaProdutosMib();
    else restaurarArvoreProdutosOriginal();
}

function toggleProdutosCategoriaMenu(categoriaId) {
    const catKey = categoriaId != null && String(categoriaId).trim() !== ''
        ? `id:${categoriaId}`
        : '';
    if (!catKey) return;

    const estado = obterEstadoArvoreProdutos();
    estado.categorias[catKey] = !estado.categorias[catKey];
    renderizarArvoreListagemProdutos(window._produtosArvoreListaAtual || window.produtosCache || []);
}

function renderProdutosRows(produtos, opcoes = {}) {
    if (!produtos || produtos.length === 0) {
        const msg = opcoes.buscaAtiva ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado';
        return `<tr><td colspan="8" class="text-center">${msg}</td></tr>`;
    }

    return produtos.map((p) => renderProdutoRow(p)).join('');
}


// Abre modal de produto
// RC4.31.27 — opcoes.origem === 'COMPRA' NÃO substitui #modal-container (preserva Lançamento de Compra)
function showProdutoModal(produto = null, opcoes = {}) {
    const origemCadastro = opcoes && typeof opcoes === 'object' ? (opcoes.origem || null) : null;
    const preservarOutrosModais = origemCadastro === 'COMPRA' || origemCadastro === 'MIIP'
        || opcoes?.preservarOutrosModais === true;
    const isEdit = produto !== null;
    const title = isEdit ? 'Editar Produto' : 'Novo Produto';
    const lucro = (() => {
        if (!isEdit || !produto) return '';
        const precoCompra = isEdit && produtoEhFracionado(produto)
            ? resolverCustoUnitarioProdutoCadastro(produto)
            : Number(produto.preco_compra || 0);
        const precoVenda = Number(produto.preco_venda || 0);
        const F = window.FormacaoPrecoMargem;
        if (precoCompra > 0 && precoVenda > 0) {
            if (F && typeof F.derivarMarkupPercentual === 'function') {
                const derivado = F.derivarMarkupPercentual(precoCompra, precoVenda);
                if (derivado !== null && derivado !== undefined) return derivado;
            }
            return Number((((precoVenda - precoCompra) / precoCompra) * 100).toFixed(2));
        }
        if (produto.lucro_percentual !== undefined && produto.lucro_percentual !== null && produto.lucro_percentual !== '') {
            return produto.lucro_percentual;
        }
        return '';
    })();
    const usaConversaoInicial = isEdit && produtoEhFracionado(produto);
    const custoUnitarioInicial = isEdit && usaConversaoInicial
        ? resolverCustoUnitarioProdutoCadastro(produto)
        : Number(isEdit ? produto.preco_compra : 0);
    const precoCompraInicial = isEdit
        ? formatarCustoUnitarioCadastro(custoUnitarioInicial, usaConversaoInicial)
        : '0';
    const permiteVendaUnidadeInicial = isEdit && Number(produto?.permite_venda_unidade ?? 0) === 1;
    const pesoMedioUnidadeInicial = isEdit ? Number(produto?.peso_medio_unidade ?? 0) : 0;
    const precoUnidadeInicial = isEdit ? Number(produto?.preco_unidade ?? 0) : 0;
    const estoqueTotalInicial = isEdit
        ? Number(produto.estoque_atual ?? (Number(produto.saldo_fiscal || 0) + Number(produto.saldo_nao_fiscal || 0)))
        : 0;

    // Remove modais antigos para evitar conflitos de aria-hidden e IDs duplicados
    $('#produtoModal').remove();
    $('#viewProdutoModal').remove();
    const modalHtml = `
        <div class="modal fade cds-prod-cadastro" id="produtoModal" tabindex="-1" aria-hidden="true"${origemCadastro ? ` data-origem-cadastro="${origemCadastro}"` : ''}>
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header d-flex align-items-center justify-content-between">
                        <h5 class="modal-title mb-0">${title}</h5>
                        <div class="d-flex gap-2">
                            <button type="button" class="btn btn-outline-secondary btn-sm" onclick="minimizarModal('produtoModal')" title="Minimizar">
                                <i class="fas fa-window-minimize"></i>
                            </button>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                        </div>
                    </div>

                    <div class="modal-body">
                        <form id="produtoForm">
                            <input type="hidden" id="produtoId" value="${isEdit ? (produto.id || '') : ''}">

                            <div class="cds-prod-cadastro__stack">

                                <div class="cds-prod-cadastro__card">
                                    <div class="cds-prod-cadastro__card-header">
                                        <span class="cds-prod-cadastro__card-icon" aria-hidden="true">🏷️</span>
                                        <h6 class="cds-prod-cadastro__card-title">Identificação</h6>
                                    </div>
                                    <div class="cds-prod-cadastro__card-body">
                                        <div class="row g-3">
                                            <div class="col-md-3">
                                                <label for="codigo" class="form-label">Código Interno</label>
                                                <input type="text" class="form-control" id="codigo" value="${isEdit ? escapeHtml(produto.codigo || '') : ''}" placeholder="Gerado ao salvar" autocomplete="off">
                                                <div class="form-text">Se não informar, o sistema gera ao salvar. Informe primeiro o código de barras, se houver.</div>
                                            </div>
                                            <div class="col-md-3">
                                                <label for="plu" class="form-label">PLU / Código do item da balança</label>
                                                <input
                                                    type="text"
                                                    class="form-control cds-prod-cadastro__plu"
                                                    id="plu"
                                                    inputmode="numeric"
                                                    maxlength="10"
                                                    placeholder="Ex.: 39"
                                                    value="${isEdit ? escapeHtml(produto.plu || '') : ''}"
                                                    title="Código do item na balança / MGV6 (não é EAN/GTIN). Usado no TXITENS."
                                                >
                                                <div class="form-text">Código do item na balança (MGV6). Não é EAN.</div>
                                            </div>
                                            <div class="col-md-3">
                                                <label for="codigo_barras" class="form-label">Código de Barras</label>
                                                <input type="text" class="form-control" id="codigo_barras" value="${isEdit ? escapeHtml(produto.codigo_barras || '') : ''}">
                                            </div>
                                            <div class="col-12">
                                                <label for="nome" class="form-label">Nome do Produto *</label>
                                                <input
                                                    type="text"
                                                    class="form-control cds-prod-cadastro__nome"
                                                    id="nome"
                                                    required
                                                    value="${isEdit ? escapeHtml(produto.nome || '') : ''}"
                                                >
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="cds-prod-cadastro__card">
                                    <div class="cds-prod-cadastro__card-header">
                                        <span class="cds-prod-cadastro__card-icon" aria-hidden="true">📁</span>
                                        <h6 class="cds-prod-cadastro__card-title">Classificação</h6>
                                    </div>
                                    <div class="cds-prod-cadastro__card-body">
                                        <div class="row g-3">
                                            <div class="col-md-6">
                                                <label for="categoria_id" class="form-label">Categoria</label>
                                                <div class="input-group">
                                                    <select class="form-control" id="categoria_id">
                                                        <option value="">Carregando...</option>
                                                    </select>
                                                    <button type="button" class="btn btn-outline-success" id="btnCriarCategoriaRapida" title="Criar categoria rapidamente">
                                                        <i class="fas fa-plus"></i>
                                                    </button>
                                                </div>
                                            </div>
                                            <div class="col-md-6">
                                                <label for="subcategoria_id" class="form-label">Subcategoria</label>
                                                <div class="input-group">
                                                    <select class="form-control" id="subcategoria_id">
                                                        <option value="">Selecione uma categoria</option>
                                                    </select>
                                                    <button type="button" class="btn btn-outline-success" id="btnCriarSubcategoriaRapida" title="Criar subcategoria rapidamente" disabled>
                                                        <i class="fas fa-plus"></i>
                                                    </button>
                                                </div>
                                            </div>
                                            <div class="col-md-6">
                                                <label for="marca_smart_input" class="form-label">Marca</label>
                                                <div id="marca_smart_select_host"></div>
                                                <input type="hidden" id="marca_id" value="${isEdit && produto.marca_id ? escapeHtml(String(produto.marca_id)) : ''}">
                                            </div>
                                            <div class="col-md-6">
                                                <label for="fornecedor_smart_input" class="form-label">Fornecedor</label>
                                                <div id="fornecedor_smart_select_host"></div>
                                                <input type="hidden" id="fornecedor" value="${isEdit ? escapeHtml(produto.fornecedor || '') : ''}">
                                                <input type="hidden" id="fornecedor_id" value="">
                                            </div>
                                            <div class="col-md-6">
                                                <label for="unidade" class="form-label" id="label_unidade_produto">Unidade Base</label>
                                                <select class="form-control" id="unidade">
                                                    <option value="un" ${isEdit && produto.unidade === 'un' ? 'selected' : ''}>Unidade</option>
                                                    <option value="kg" ${isEdit && produto.unidade === 'kg' ? 'selected' : ''}>Quilograma</option>
                                                    <option value="g" ${isEdit && produto.unidade === 'g' ? 'selected' : ''}>Grama</option>
                                                    <option value="l" ${isEdit && produto.unidade === 'l' ? 'selected' : ''}>Litro</option>
                                                    <option value="ml" ${isEdit && produto.unidade === 'ml' ? 'selected' : ''}>Mililitro</option>
                                                    <option value="mt" ${isEdit && (produto.unidade === 'mt' || produto.unidade === 'm') ? 'selected' : ''}>Metro</option>
                                                    <option value="m2" ${isEdit && produto.unidade === 'm2' ? 'selected' : ''}>Metro Quadrado</option>
                                                    <option value="m3" ${isEdit && produto.unidade === 'm3' ? 'selected' : ''}>Metro Cúbico</option>
                                                </select>
                                                <small class="text-warning d-none" id="avisoUnidadeConversaoCadastro">
                                                    Selecione uma unidade fracionável (KG, MT, LT, M², M³, etc.).
                                                </small>
                                            </div>
                                            ${typeof ProdutoEmbalagensUI !== 'undefined'
                                                ? ProdutoEmbalagensUI.montarHtmlPainelApresentacoes()
                                                : ''}
                                        </div>
                                    </div>
                                </div>

                                <div class="cds-prod-cadastro__card">
                                    <div class="cds-prod-cadastro__card-header">
                                        <span class="cds-prod-cadastro__card-icon" aria-hidden="true">📦</span>
                                        <h6 class="cds-prod-cadastro__card-title">Estoque Inicial</h6>
                                    </div>
                                    <div class="cds-prod-cadastro__card-body">
                                        <div class="row g-3" id="areaCamposEstoqueProduto">
                                            ${montarHtmlCamposEstoqueProduto(produto, isEdit, {
                                                temVendas: Boolean(produto?.tem_vendas)
                                            })}
                                        </div>
                                        <div class="row g-3 mt-1">
                                            <div class="col-md-4">
                                                <label for="estoque_minimo" class="form-label">Estoque Mínimo</label>
                                                <input
                                                    type="number"
                                                    step="${usaConversaoInicial ? '0.001' : '0.01'}"
                                                    class="form-control"
                                                    id="estoque_minimo"
                                                    value="${isEdit ? Number(produto.estoque_minimo || 0) : 0}"
                                                >
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="cds-prod-cadastro__card">
                                    <div class="cds-prod-cadastro__card-header">
                                        <span class="cds-prod-cadastro__card-icon" aria-hidden="true">💰</span>
                                        <h6 class="cds-prod-cadastro__card-title">Formação do Preço</h6>
                                    </div>
                                    <div class="cds-prod-cadastro__card-body">
                                        <div class="row g-3">
                                            <div class="col-md-3">
                                                <label for="preco_compra" class="form-label" id="label_preco_compra_produto">Custo Unitário</label>
                                                <input
                                                    type="number"
                                                    step="${usaConversaoInicial ? '0.0001' : '0.01'}"
                                                    class="form-control"
                                                    id="preco_compra"
                                                    value="${precoCompraInicial}"
                                                >
                                                <small class="text-muted d-none" id="hint_preco_compra_produto">
                                                    Custo por unidade de venda. Valor Inicial = Quantidade Total × Custo Unitário.
                                                </small>
                                            </div>
                                            <div class="col-md-3">
                                                <label for="valor_total_compra_preview" class="form-label">Valor Inicial do Estoque</label>
                                                <input
                                                    type="text"
                                                    class="form-control bg-light fw-semibold"
                                                    id="valor_total_compra_preview"
                                                    readonly
                                                    value="${formatCurrency((estoqueTotalInicial || 0) * (Number(precoCompraInicial) || 0))}"
                                                >
                                                <small class="text-muted">Quantidade Total × Custo Unitário</small>
                                            </div>
                                            <div class="col-md-3">
                                                <label for="lucro_percentual" class="form-label">
                                                    Markup (%)
                                                    <span class="cds-prod-cadastro__badge-oficial" title="Percentual aplicado sobre o custo.">OFICIAL</span>
                                                </label>
                                                <div class="input-group">
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        class="form-control"
                                                        id="lucro_percentual"
                                                        placeholder="%"
                                                        value="${lucro}"
                                                        title="Percentual aplicado sobre o custo."
                                                    >
                                                    <span class="input-group-text">%</span>
                                                </div>
                                            </div>
                                            <div class="col-md-3">
                                                <label for="preco_venda" class="form-label">Preço Unitário *</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    class="form-control"
                                                    id="preco_venda"
                                                    required
                                                    value="${isEdit ? Number(produto.preco_venda || 0) : 0}"
                                                >
                                            </div>
                                            <div class="col-md-3 d-none" id="wrap_valor_embalagem_venda">
                                                <label for="valor_embalagem_venda" class="form-label">Valor de Venda da Embalagem</label>
                                                <input type="text" class="form-control bg-light fw-semibold" id="valor_embalagem_venda" readonly value="R$ 0,00">
                                                <small class="text-muted">Preço unitário × quantidade por embalagem</small>
                                            </div>
                                            <div class="col-md-4">
                                                <label for="valor_total_venda_preview" class="form-label">Valor Total Venda</label>
                                                <input
                                                    type="text"
                                                    class="form-control bg-light fw-semibold text-success"
                                                    id="valor_total_venda_preview"
                                                    readonly
                                                    value="${formatCurrency((estoqueTotalInicial || 0) * (Number(isEdit ? produto.preco_venda : 0) || 0))}"
                                                >
                                                <small class="text-muted">Quantidade Total × Preço de Venda</small>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="cds-prod-cadastro__card cds-prod-cadastro__card--tempo-real" id="area_info_margem_bruta_real">
                                    <div class="cds-prod-cadastro__card-header cds-prod-cadastro__card-header--tempo-real">
                                        <h6 class="cds-prod-cadastro__card-title cds-prod-cadastro__card-title--tempo-real">
                                            Informações em tempo real (não salvas)
                                            <span
                                                class="cds-prod-cadastro__info-icon"
                                                title="Valores calculados automaticamente. Não são gravados no cadastro do produto."
                                                aria-label="Valores calculados automaticamente. Não são gravados no cadastro do produto."
                                            >ⓘ</span>
                                        </h6>
                                    </div>
                                    <div class="cds-prod-cadastro__card-body cds-prod-cadastro__tempo-real-body">
                                        <div class="cds-prod-cadastro__tempo-real-grid cds-prod-cadastro__tempo-real-grid--3">
                                            <div class="cds-prod-cadastro__tempo-real-item cds-prod-cadastro__tempo-real-item--destaque">
                                                <div class="cds-prod-cadastro__tempo-real-label">
                                                    Margem Bruta
                                                    <span class="cds-prod-cadastro__info-icon" title="Percentual do preço de venda que representa o lucro bruto.">ⓘ</span>
                                                </div>
                                                <div class="cds-prod-cadastro__tempo-real-valor cds-prod-cadastro__tempo-real-valor--margem" id="margem_bruta_real_preview">—</div>
                                                <small class="cds-prod-cadastro__tempo-real-hint">Margem calculada sobre o preço atual</small>
                                            </div>
                                            <div class="cds-prod-cadastro__tempo-real-item">
                                                <div class="cds-prod-cadastro__tempo-real-label">
                                                    Lucro Bruto
                                                    <span class="cds-prod-cadastro__info-icon" title="Preço de venda − custo unitário.">ⓘ</span>
                                                </div>
                                                <div class="cds-prod-cadastro__tempo-real-pill cds-prod-cadastro__tempo-real-pill--lucro" id="lucro_bruto_real_preview">—</div>
                                                <small class="cds-prod-cadastro__tempo-real-hint">Lucro por unidade (Preço − Custo)</small>
                                            </div>
                                            <div class="cds-prod-cadastro__tempo-real-item">
                                                <div class="cds-prod-cadastro__tempo-real-label">
                                                    Valor Total Venda
                                                    <span class="cds-prod-cadastro__info-icon" title="Quantidade total × preço de venda.">ⓘ</span>
                                                </div>
                                                <div class="cds-prod-cadastro__tempo-real-pill cds-prod-cadastro__tempo-real-pill--preco" id="valor_total_venda_info_preview">—</div>
                                                <small class="cds-prod-cadastro__tempo-real-hint">Quantidade × Preço de venda</small>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="cds-prod-cadastro__card">
                                    <div class="cds-prod-cadastro__atacado-header">
                                        <h6 class="cds-prod-cadastro__atacado-title">
                                            <span aria-hidden="true">🛒</span> Venda no Atacado
                                        </h6>
                                        <div class="form-check form-switch mb-0">
                                            <input class="form-check-input" type="checkbox" id="venda_atacado" ${isEdit && Number(produto.venda_atacado || 0) === 1 ? 'checked' : ''}>
                                            <label class="form-check-label" for="venda_atacado">ON/OFF</label>
                                        </div>
                                    </div>
                                    <div class="cds-prod-cadastro__card-body" id="areaVendaAtacado" style="display: none;">
                                        <div class="table-responsive">
                                            <table class="table table-sm table-striped mb-2" id="tabelaAtacado">
                                                <thead>
                                                    <tr>
                                                        <th>Quantidade Mínima</th>
                                                        <th>Desconto (%)</th>
                                                        <th>Preço Unitário</th>
                                                        <th></th>
                                                    </tr>
                                                </thead>
                                                <tbody></tbody>
                                            </table>
                                        </div>
                                        <div class="d-flex gap-2">
                                            <button type="button" class="btn btn-success btn-sm" id="btnAdicionarFaixa">+ Adicionar Faixa</button>
                                        </div>
                                    </div>
                                </div>

                                <div class="cds-prod-cadastro__card">
                                    <div class="cds-prod-cadastro__card-header">
                                        <span class="cds-prod-cadastro__card-icon" aria-hidden="true">🧾</span>
                                        <h6 class="cds-prod-cadastro__card-title">Tributação</h6>
                                    </div>
                                    <div class="cds-prod-cadastro__card-body">
                                        <div class="row g-3">
                                            <div class="col-md-3">
                                                <label for="ncm" class="form-label">NCM</label>
                                                <input type="text" class="form-control" id="ncm" value="${isEdit ? escapeHtml(produto.ncm || '') : ''}">
                                            </div>
                                            <div class="col-md-3">
                                                <label for="cfop" class="form-label">CFOP</label>
                                                <input type="text" class="form-control" id="cfop" value="${isEdit ? escapeHtml(produto.cfop || '') : ''}">
                                            </div>
                                            <div class="col-md-3">
                                                <label for="csosn" class="form-label">CSOSN</label>
                                                <input type="text" class="form-control" id="csosn" value="${isEdit ? escapeHtml(produto.csosn || '') : ''}">
                                            </div>
                                            <div class="col-md-3">
                                                <label for="origem" class="form-label">Origem</label>
                                                <input type="number" class="form-control" id="origem" value="${isEdit ? Number(produto.origem || 0) : 0}">
                                            </div>
                                            <div class="col-md-4">
                                                <label for="cest" class="form-label">CEST</label>
                                                <input type="text" class="form-control" id="cest" value="${isEdit ? escapeHtml(produto.cest || '') : ''}">
                                            </div>
                                            <div class="col-md-4">
                                                <label for="aliquota_icms" class="form-label">Alíquota ICMS</label>
                                                <input type="number" step="0.01" class="form-control" id="aliquota_icms" value="${isEdit ? Number(produto.aliquota_icms || 0) : 0}">
                                            </div>
                                            <div class="col-md-4">
                                                <label for="aliquota_pis" class="form-label">Alíquota PIS</label>
                                                <input type="number" step="0.01" class="form-control" id="aliquota_pis" value="${isEdit ? Number(produto.aliquota_pis || 0) : 0}">
                                            </div>
                                            <div class="col-md-4">
                                                <label for="aliquota_cofins" class="form-label">Alíquota COFINS</label>
                                                <input type="number" step="0.01" class="form-control" id="aliquota_cofins" value="${isEdit ? Number(produto.aliquota_cofins || 0) : 0}">
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="cds-prod-cadastro__card">
                                    <div class="cds-prod-cadastro__card-header">
                                        <span class="cds-prod-cadastro__card-icon" aria-hidden="true">⚙️</span>
                                        <h6 class="cds-prod-cadastro__card-title">Configurações</h6>
                                    </div>
                                    <div class="cds-prod-cadastro__card-body">
                                        <div class="row g-3">
                                            <div class="col-12">
                                                <div class="form-check form-switch">
                                                    <input
                                                        class="form-check-input"
                                                        type="checkbox"
                                                        id="produto_fracionado"
                                                        ${isEdit && produtoEhFracionado(produto) ? 'checked' : ''}
                                                    >
                                                    <label class="form-check-label" for="produto_fracionado">
                                                        Produto Pesável / Vendido por Peso
                                                    </label>
                                                </div>
                                                <div class="form-text">Mesmo flag operacional já usado pelo PDV e balanças (produto_fracionado).</div>
                                                <div class="form-check form-switch mt-2">
                                                    <input
                                                        class="form-check-input"
                                                        type="checkbox"
                                                        id="integrar_balanca"
                                                        ${isEdit
                                                          ? (produto.integrar_balanca == null
                                                              ? (produtoEhFracionado(produto) ? 'checked' : '')
                                                              : (Number(produto.integrar_balanca) === 1 ? 'checked' : ''))
                                                          : ''}
                                                    >
                                                    <label class="form-check-label" for="integrar_balanca">
                                                        Integrar com Balança
                                                    </label>
                                                </div>
                                                <div class="form-text">Equivalente ao legado: se marcado, o produto pode ir ao MGV6 (exige PLU).</div>

                                                <!-- RC15.3 — Envio individual para balança (Motor Universal) -->
                                                <div class="border rounded p-3 mt-3 bg-light d-none" id="painelEnvioBalancaProduto" data-produto-ativo="${isEdit && Number(produto.ativo ?? 1) === 1 ? '1' : (isEdit ? '0' : '1')}">
                                                    <div class="d-flex flex-wrap align-items-start justify-content-between gap-2">
                                                        <div>
                                                            <strong class="d-block mb-1">Balança Toledo</strong>
                                                            <div class="small mb-1">
                                                                Status:
                                                                <span id="balancaProdutoStatusApto">🟢 Produto apto para balança</span>
                                                            </div>
                                                            <div class="small mb-1">
                                                                Última sincronização:
                                                                <span id="balancaProdutoUltimaSync">Nunca</span>
                                                            </div>
                                                            <div class="small mb-2">
                                                                Resultado:
                                                                <span id="balancaProdutoResultado" class="text-muted">—</span>
                                                            </div>
                                                            <label for="balancaProdutoEquipamento" class="form-label small mb-1">Equipamento</label>
                                                            <select id="balancaProdutoEquipamento" class="form-select form-select-sm" style="max-width: 360px;"></select>
                                                        </div>
                                                        <div class="text-end">
                                                            <button type="button" class="btn btn-primary btn-sm" id="btnEnviarProdutoBalanca" disabled>
                                                                Enviar para Balança
                                                            </button>
                                                            <button type="button" class="btn btn-outline-secondary btn-sm ms-1" id="btnHistoricoBalancaProduto">
                                                                Histórico
                                                            </button>
                                                            <div class="small mt-2" id="balancaProdutoFeedback" aria-live="polite"></div>
                                                        </div>
                                                    </div>
                                                    <div class="mt-2 d-none" id="balancaProdutoHistoricoBox">
                                                        <div class="small text-muted mb-1">Histórico de sincronização</div>
                                                        <div id="balancaProdutoHistoricoLista" class="small"></div>
                                                    </div>
                                                    <pre class="small bg-dark text-light rounded p-2 mt-2 mb-0 d-none" id="balancaProdutoLog" style="max-height: 140px; overflow: auto; white-space: pre-wrap;"></pre>
                                                </div>

                                                <div class="ms-1 mt-2 d-none" id="painelVendaUnidadeCadastro">
                                                    <div class="form-check form-switch mb-2">
                                                        <input
                                                            class="form-check-input"
                                                            type="checkbox"
                                                            id="permite_venda_unidade"
                                                            ${permiteVendaUnidadeInicial ? 'checked' : ''}
                                                        >
                                                        <label class="form-check-label" for="permite_venda_unidade">
                                                            Permitir venda por unidade
                                                        </label>
                                                    </div>

                                                    <div class="ms-1 d-none" id="painelCamposVendaUnidadeCadastro">
                                                        <div class="row g-3">
                                                            <div class="col-md-6">
                                                                <label for="peso_medio_unidade" class="form-label">Peso médio da unidade (KG)</label>
                                                                <input
                                                                    type="number"
                                                                    step="0.001"
                                                                    min="0"
                                                                    class="form-control"
                                                                    id="peso_medio_unidade"
                                                                    placeholder="Ex.: 0,450"
                                                                    value="${pesoMedioUnidadeInicial > 0 ? pesoMedioUnidadeInicial : ''}"
                                                                >
                                                            </div>
                                                            <div class="col-md-6">
                                                                <label for="preco_unidade" class="form-label">Preço por unidade (R$)</label>
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    min="0"
                                                                    class="form-control"
                                                                    id="preco_unidade"
                                                                    placeholder="Ex.: 3,50"
                                                                    value="${precoUnidadeInicial > 0 ? precoUnidadeInicial : ''}"
                                                                >
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div class="col-12">
                                                <div class="form-check form-switch">
                                                    <input
                                                        class="form-check-input"
                                                        type="checkbox"
                                                        id="controla_estoque"
                                                        ${!isEdit || Number(produto.controla_estoque ?? 1) !== 0 ? 'checked' : ''}
                                                    >
                                                    <label class="form-check-label" for="controla_estoque">
                                                        Controla Estoque
                                                    </label>
                                                </div>
                                                <div class="form-text">
                                                    Quando desligado, a venda não valida nem movimenta saldo (útil para açougue, hortifrúti e padaria).
                                                </div>
                                            </div>

                                            <div class="col-12">
                                                <div class="form-check form-switch">
                                                    <input
                                                        class="form-check-input"
                                                        type="checkbox"
                                                        id="controlar_validade"
                                                        ${isEdit && Number(produto.controlar_validade || 0) === 1 ? 'checked' : ''}
                                                    >
                                                    <label class="form-check-label" for="controlar_validade">
                                                        Controlar validade deste produto
                                                    </label>
                                                </div>
                                                <div class="form-text text-warning d-none" id="avisoValidadeEmpresaDesligada">
                                                    A empresa não controla validade (Centro de Configurações → Empresa). Este produto não usa lote/FEFO.
                                                </div>
                                            </div>

                                            <div class="col-12" id="areaLoteInicial" style="display: none;">
                                                <div class="row g-3 border rounded p-3 bg-info bg-opacity-10">
                                                    <div class="col-md-12">
                                                        <strong>Informações do Lote Inicial</strong>
                                                        <small class="text-muted d-block">Informe a validade do estoque. Em produtos novos ou sem lote, o sistema cria o lote automaticamente.</small>
                                                    </div>
                                                    <div class="col-md-4">
                                                        <label for="data_validade_inicial" class="form-label">Data Validade *</label>
                                                        <input
                                                            type="date"
                                                            id="data_validade_inicial"
                                                            class="form-control"
                                                            value="${isEdit ? (produto.data_validade_inicial || produto.data_validade || '') : ''}"
                                                        >
                                                    </div>
                                                    <div class="col-md-4">
                                                        <label for="dias_alerta_validade" class="form-label">Alertar (dias)</label>
                                                        <input
                                                            type="number"
                                                            id="dias_alerta_validade"
                                                            class="form-control"
                                                            value="${isEdit ? Number(produto.dias_alerta_validade || 30) : 30}"
                                                            min="1"
                                                        >
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="cds-prod-cadastro__rodape">
                                    <div class="cds-prod-cadastro__card">
                                        <div class="cds-prod-cadastro__card-header">
                                            <span class="cds-prod-cadastro__card-icon" aria-hidden="true">📝</span>
                                            <h6 class="cds-prod-cadastro__card-title">Observações</h6>
                                        </div>
                                        <div class="cds-prod-cadastro__card-body">
                                            <textarea
                                                class="form-control"
                                                id="produto_observacoes"
                                                rows="6"
                                                placeholder="Observações do produto (opcional)"
                                            >${isEdit ? escapeHtml(produto.observacoes || '') : ''}</textarea>
                                        </div>
                                    </div>

                                    <div class="cds-prod-cadastro__card">
                                        <div class="cds-prod-cadastro__card-header">
                                            <span class="cds-prod-cadastro__card-icon" aria-hidden="true">🖼️</span>
                                            <h6 class="cds-prod-cadastro__card-title">Imagem do Produto</h6>
                                        </div>
                                        <div class="cds-prod-cadastro__card-body">
                                            <input type="file" id="produto_imagem_input" accept="image/*" class="d-none">
                                            <div class="cds-prod-cadastro__imagem-drop" id="produto_imagem_drop" tabindex="0" role="button" aria-label="Selecionar imagem do produto">
                                                <div id="produto_imagem_placeholder">
                                                    <div class="mb-1">Arraste uma imagem ou clique para selecionar</div>
                                                    <div class="cds-prod-cadastro__hint">Opcional · PNG, JPG, GIF ou WEBP</div>
                                                </div>
                                                <img id="produto_imagem_preview" class="cds-prod-cadastro__imagem-preview d-none" alt="Pré-visualização da imagem do produto">
                                            </div>
                                            <div class="cds-prod-cadastro__imagem-actions">
                                                <button type="button" class="btn btn-sm btn-outline-primary" id="btnProdutoImagemSelecionar">Selecionar</button>
                                                <button type="button" class="btn btn-sm btn-outline-secondary" id="btnProdutoImagemAlterar" disabled>Alterar</button>
                                                <button type="button" class="btn btn-sm btn-outline-danger" id="btnProdutoImagemRemover" disabled>Remover</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </form>
                    </div>

                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        ${!isEdit && origemCadastro !== 'COMPRA' && origemCadastro !== 'MIIP'
                            ? `<button type="button" class="btn btn-outline-primary" onclick="saveProduto({ continuar: false })">Salvar</button>
                        <button type="button" class="btn btn-primary" onclick="saveProduto({ continuar: true })">Salvar e Add Novo</button>`
                            : `<button type="button" class="btn btn-primary" onclick="saveProduto({ continuar: false })">Salvar</button>`}
                    </div>
                </div>
            </div>
        </div>
    `;

    // RC4.31.27 — a partir de Compras, anexa ao body e preserva #modal-container (compra aberta)
    if (preservarOutrosModais) {
        $('body').append(modalHtml);
    } else {
        $('#modal-container').html(modalHtml);
    }

    const produtoModalEl = document.getElementById('produtoModal');
    if (produtoModalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        bootstrap.Modal.getOrCreateInstance(produtoModalEl).show();
    } else {
        $('#produtoModal').modal('show');
    }
    // inicializar armazenamento temporário de faixas (para produto novo)
    const faixasInit = (produto && Array.isArray(produto.atacado_faixas)) ? produto.atacado_faixas : [];
    $('#produtoModal').data('faixasTemp', faixasInit);
    $('#produtoModal').data('temMovimentacoes', Boolean(produto?.tem_movimentacoes));
    $('#produtoModal').data('temVendas', Boolean(produto?.tem_vendas));
    $('#produtoModal').removeData('produtoRecemSalvo');
    $('#produtoModal').removeData('produtoSalvoComSucesso');
    if (origemCadastro) {
        $('#produtoModal').data('origemCadastroProduto', origemCadastro);
    } else {
        $('#produtoModal').removeData('origemCadastroProduto');
    }
    if (isEdit && produto) {
        $('#produtoModal').data('produtoSaldos', {
            saldo_fiscal: produto.saldo_fiscal,
            saldo_nao_fiscal: produto.saldo_nao_fiscal,
            estoque_atual: produto.estoque_atual
        });
    }
    // Remove botão flutuante se existir ao restaurar
    $('#btn-restaurar-produtoModal').remove();

    inicializarCategoriasESubcategorias(produto, isEdit);
    inicializarBotoesCriacaoRapidaCategoriaSubcategoria();
    inicializarMarcasProdutoCadastro(produto, isEdit);
    inicializarFornecedorProdutoCadastro(produto, isEdit);
    inicializarCalculoPreco(produto, isEdit);
    if (typeof ProdutoEmbalagensUI !== 'undefined') {
        ProdutoEmbalagensUI.inicializarApresentacoes(produto);
    }
    inicializarMotorConversaoUnidadesCadastro();
    inicializarVendaUnidadeCadastro(produto, isEdit);
    inicializarVendaAtacado(produto, isEdit);
    inicializarImagemProdutoCadastro(produto, isEdit);

    if (isEdit && produto) {
        $('#controlar_validade').prop('checked', produto.controlar_validade == 1);
        $('#controla_estoque').prop('checked', Number(produto.controla_estoque ?? 1) !== 0);
    } else {
        $('#controlar_validade').prop('checked', false);
        $('#controla_estoque').prop('checked', true);
    }

    inicializarConfirmacaoControlaEstoque();

    // Inicializar controle de visibilidade do lote inicial
    inicializarControleLoteInicial();
    inicializarPreviewEstoqueTotalInicial();
    inicializarEspelhoCodigoBarras(produto, isEdit);
    inicializarPainelEnvioBalancaProduto(produto, isEdit);

    if (!isEdit) {
        aplicarPadraoFiscalNovoProduto();
        setTimeout(() => {
            const modal = document.getElementById('produtoModal');
            const ativo = document.activeElement;
            if (ativo && modal && modal.contains(ativo) && ativo.id && ativo.id !== 'nome') {
                return;
            }
            $('#nome').trigger('focus');
        }, 400);
    }

    // ...
}

/** Cache do padrão fiscal da empresa (CFOP/CSOSN/origem/CEST de novos produtos). */
let CDS_PADRAO_FISCAL_EMPRESA = null;

function obterCfopPadraoEmpresa() {
    return String(CDS_PADRAO_FISCAL_EMPRESA?.cfop_padrao || '').trim();
}

function aplicarCfopPadraoEmpresaNoFormulario() {
    const cfop = obterCfopPadraoEmpresa();
    if (!cfop || !$('#cfop').length) return cfop;
    if (String($('#cfop').val() || '').trim() !== cfop) {
        $('#cfop').val(cfop);
    }
    return cfop;
}

/** Cadastro originado da NF-e: CFOP da empresa prevalece sobre o da nota. */
function resolverCfopSalvarNovoProduto(cfopFormulario) {
    if ($('#produtoId').val()) return cfopFormulario;
    const veioDaNota = !!$('#produtoModal').data('miipPrefillXml');
    const padrao = obterCfopPadraoEmpresa();
    if (veioDaNota && padrao) {
        aplicarCfopPadraoEmpresaNoFormulario();
        return padrao;
    }
    return cfopFormulario;
}

async function aplicarPadraoFiscalNovoProduto() {
    if ($('#produtoId').val()) {
        return CDS_PADRAO_FISCAL_EMPRESA;
    }

    try {
        const token = localStorage.getItem('token') || '';
        const response = await fetch(`${API_URL}/configuracoes-avancadas/padrao-fiscal`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) {
            return CDS_PADRAO_FISCAL_EMPRESA;
        }

        const padrao = await response.json();
        CDS_PADRAO_FISCAL_EMPRESA = padrao || CDS_PADRAO_FISCAL_EMPRESA;
        if (padrao.cfop_padrao) {
            $('#cfop').val(padrao.cfop_padrao);
        }
        if (padrao.csosn_padrao) {
            $('#csosn').val(padrao.csosn_padrao);
        }
        if (padrao.origem_padrao !== undefined && padrao.origem_padrao !== null && padrao.origem_padrao !== '') {
            const origem = parseInt(padrao.origem_padrao, 10);
            if (!Number.isNaN(origem)) {
                $('#origem').val(origem);
            }
        }
        if (padrao.cest_padrao) {
            $('#cest').val(padrao.cest_padrao);
        }
        return padrao;
    } catch (err) {
        console.warn('Não foi possível carregar padrão fiscal da empresa:', err);
        return CDS_PADRAO_FISCAL_EMPRESA;
    }
}
window.aplicarPadraoFiscalNovoProduto = aplicarPadraoFiscalNovoProduto;
window.obterCfopPadraoEmpresa = obterCfopPadraoEmpresa;
window.aplicarCfopPadraoEmpresaNoFormulario = aplicarCfopPadraoEmpresaNoFormulario;

function inicializarEspelhoCodigoBarras(produto, isEdit) {
    const $modal = $('#produtoModal');
    if (!$modal.length) {
        return;
    }

    const codigoInicial = isEdit ? String(produto?.codigo || '').trim() : '';
    const barrasInicial = isEdit ? String(produto?.codigo_barras || '').trim() : '';

    if (barrasInicial && barrasInicial !== codigoInicial) {
        $modal.data('codigoBarrasEditadoManualmente', true);
        $modal.data('ultimoCodigoEspelhado', '');
    } else {
        $modal.data('codigoBarrasEditadoManualmente', false);
        $modal.data('ultimoCodigoEspelhado', codigoInicial);
    }

    $modal.off('input.espelhoCodigo change.espelhoCodigo')
        .on('input.espelhoCodigo change.espelhoCodigo', '#codigo', function () {
            const codigo = String($(this).val() || '').trim();
            const $barras = $('#codigo_barras');
            const barras = String($barras.val() || '').trim();
            const ultimoEspelhado = String($modal.data('ultimoCodigoEspelhado') || '');
            const manual = $modal.data('codigoBarrasEditadoManualmente') === true;

            if (!manual || barras === '' || barras === ultimoEspelhado) {
                $barras.val(codigo);
                $modal.data('ultimoCodigoEspelhado', codigo);
                $modal.data('codigoBarrasEditadoManualmente', false);
            }
        })
        .on('input.espelhoCodigo change.espelhoCodigo', '#codigo_barras', function () {
            const codigo = String($('#codigo').val() || '').trim();
            const barras = String($(this).val() || '').trim();

            if (barras === codigo) {
                $modal.data('codigoBarrasEditadoManualmente', false);
                $modal.data('ultimoCodigoEspelhado', codigo);
            } else if (barras === '') {
                $modal.data('codigoBarrasEditadoManualmente', false);
                $modal.data('ultimoCodigoEspelhado', '');
            } else {
                $modal.data('codigoBarrasEditadoManualmente', true);
            }
        });
}
window.inicializarEspelhoCodigoBarras = inicializarEspelhoCodigoBarras;

function inicializarMarcasProdutoCadastro(produto, isEdit) {
    const $host = $('#marca_smart_select_host');
    const $hidden = $('#marca_id');
    if (!$host.length || !$hidden.length) return;
    if (typeof CdsSmartSelect === 'undefined' || typeof CdsSmartSelect.mount !== 'function') {
        console.warn('[Marca] CdsSmartSelect indisponível');
        return;
    }

    const token = localStorage.getItem('token') || '';
    const marcaIdInicial = isEdit && produto?.marca_id ? String(produto.marca_id) : '';
    const marcaNomeInicial = isEdit
        ? String(produto?.marca || produto?.marca_nome || '').trim()
        : '';

    const instance = CdsSmartSelect.mount({
        container: $host.get(0),
        hiddenInput: $hidden.get(0),
        inputId: 'marca_smart_input',
        placeholder: 'Buscar ou criar marca...',
        allowClear: true,
        createPrefix: 'Criar marca',
        initialItem: marcaIdInicial
            ? { id: marcaIdInicial, label: marcaNomeInicial || `Marca #${marcaIdInicial}` }
            : null,
        fetchItems: async (query) => {
            const url = query
                ? `${API_URL}/marcas?q=${encodeURIComponent(query)}`
                : `${API_URL}/marcas`;
            const response = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) {
                throw new Error('Falha ao buscar marcas');
            }
            const lista = await response.json();
            return (lista || []).map((m) => ({ id: m.id, label: m.nome }));
        },
        createItem: async (nome) => {
            const response = await fetch(`${API_URL}/marcas/find-or-create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ nome })
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(body.erro || body.error || 'Erro ao criar marca');
            }
            if (body.criado) {
                showNotification('Marca criada com sucesso.', 'success');
            } else if (body.reativado) {
                showNotification('Marca reativada e selecionada.', 'success');
            }
            return { id: body.id, label: body.nome };
        },
        deleteItem: async (item) => {
            const response = await fetch(`${API_URL}/marcas/${item.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(body.erro || body.error || 'Erro ao excluir marca');
            }
        },
        onDeleted: (item) => {
            showNotification(`Marca "${item.label}" excluída.`, 'success');
        },
        onError: (err) => {
            showNotification(err.message || 'Erro no Smart Select de marca.', 'danger');
        }
    });

    $('#produtoModal').data('marcaSmartSelect', instance);

    // Se editando e só temos id, tenta completar o rótulo
    if (marcaIdInicial && !marcaNomeInicial) {
        fetch(`${API_URL}/marcas/${marcaIdInicial}`, {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((marca) => {
                if (marca && instance) {
                    instance.setValue({ id: marca.id, label: marca.nome });
                }
            })
            .catch(() => {});
    }
}
window.inicializarMarcasProdutoCadastro = inicializarMarcasProdutoCadastro;

function obterNomeFornecedorCadastro() {
    const inst = $('#produtoModal').data('fornecedorSmartSelect');
    const selecionado = inst && typeof inst.getSelected === 'function' ? inst.getSelected() : null;
    if (selecionado && selecionado.label) {
        return String(selecionado.label).trim();
    }
    return ($('#fornecedor_smart_input').val() || $('#fornecedor').val() || '').trim();
}

function inicializarFornecedorProdutoCadastro(produto, isEdit) {
    const $host = $('#fornecedor_smart_select_host');
    const $hiddenId = $('#fornecedor_id');
    const $hiddenNome = $('#fornecedor');
    if (!$host.length) return;

    if (typeof CdsSmartSelect === 'undefined' || typeof CdsSmartSelect.mount !== 'function') {
        console.warn('[Fornecedor] CdsSmartSelect indisponível');
        return;
    }

    const token = localStorage.getItem('token') || '';
    const nomeInicial = isEdit
        ? String(produto?.fornecedor || '').trim()
        : String($hiddenNome.val() || '').trim();

    const gravarNome = (item) => {
        $hiddenNome.val(item && item.label ? String(item.label).trim() : '');
    };

    const instance = CdsSmartSelect.mount({
        container: $host.get(0),
        hiddenInput: $hiddenId.length ? $hiddenId.get(0) : null,
        inputId: 'fornecedor_smart_input',
        placeholder: 'Buscar ou criar fornecedor (opcional)...',
        allowClear: true,
        createPrefix: 'Criar fornecedor',
        emptyHint: 'Digite para buscar ou criar. Campo opcional.',
        initialItem: nomeInicial ? { id: nomeInicial, label: nomeInicial } : null,
        fetchItems: async (query) => {
            const url = query
                ? `${API_URL}/fornecedores?q=${encodeURIComponent(query)}`
                : `${API_URL}/fornecedores`;
            const response = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) {
                throw new Error('Falha ao buscar fornecedores');
            }
            const lista = await response.json();
            return (lista || []).map((f) => ({
                id: f.id,
                label: f.nome || f.razao_social || `Fornecedor #${f.id}`
            }));
        },
        createItem: async (nome) => {
            const response = await fetch(`${API_URL}/fornecedores/find-or-create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ nome })
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(body.error || body.erro || 'Erro ao criar fornecedor');
            }
            if (body.criado) {
                showNotification('Fornecedor criado com sucesso.', 'success');
            }
            return { id: body.id, label: body.nome };
        },
        deleteItem: async (item) => {
            const id = String(item?.id || '').trim();
            if (!/^\d+$/.test(id)) {
                throw new Error('Selecione um fornecedor cadastrado para excluir.');
            }
            const response = await fetch(`${API_URL}/fornecedores/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(body.error || body.erro || 'Erro ao excluir fornecedor');
            }
        },
        confirmDeleteMessage: (item) =>
            `Excluir "${item.label}"? Esse fornecedor sai da lista, mas produtos já vinculados permanecem.`,
        onDeleted: (item) => {
            showNotification(`Fornecedor "${item.label}" excluído.`, 'success');
        },
        onChange: gravarNome,
        onError: (err) => {
            showNotification(err.message || 'Erro no campo de fornecedor.', 'danger');
        }
    });

    gravarNome(instance.getSelected && instance.getSelected());
    $('#produtoModal').data('fornecedorSmartSelect', instance);

    $('#produtoModal').off('shown.bs.modal.fornecedorPrefill').on('shown.bs.modal.fornecedorPrefill', () => {
        const nomePrefill = ($('#fornecedor').val() || '').trim();
        const atual = instance.getSelected && instance.getSelected();
        if (nomePrefill && (!atual || String(atual.label) !== nomePrefill)) {
            instance.setValue({ id: nomePrefill, label: nomePrefill });
        }
    });
}
window.inicializarFornecedorProdutoCadastro = inicializarFornecedorProdutoCadastro;
window.obterNomeFornecedorCadastro = obterNomeFornecedorCadastro;

/** Sprint INFRA 01 — upload persistente de imagem (caminho em imagem_principal). */
function inicializarImagemProdutoCadastro(produto = null, isEdit = false) {
    const $modal = $('#produtoModal');
    const $input = $('#produto_imagem_input');
    const $drop = $('#produto_imagem_drop');
    const $preview = $('#produto_imagem_preview');
    const $placeholder = $('#produto_imagem_placeholder');
    const $btnSelecionar = $('#btnProdutoImagemSelecionar');
    const $btnAlterar = $('#btnProdutoImagemAlterar');
    const $btnRemover = $('#btnProdutoImagemRemover');

    if (!$modal.length || !$input.length || !$drop.length) {
        return;
    }

    function urlImagem(path) {
        const valor = String(path || '').trim();
        if (!valor) return '';
        if (valor.startsWith('http') || valor.startsWith('data:')) return valor;
        return valor.startsWith('/') ? valor : `/${valor}`;
    }

    function aplicarPreview(path) {
        const src = urlImagem(path);
        if (!src) {
            $preview.attr('src', '').addClass('d-none');
            $placeholder.removeClass('d-none');
            $btnAlterar.prop('disabled', true);
            $btnRemover.prop('disabled', true);
            $modal.data('produtoImagemPath', null);
            return;
        }
        $preview.attr('src', src).removeClass('d-none');
        $placeholder.addClass('d-none');
        $btnAlterar.prop('disabled', false);
        $btnRemover.prop('disabled', false);
        $modal.data('produtoImagemPath', path);
    }

    async function enviarArquivo(file) {
        if (!file || !String(file.type || '').startsWith('image/')) {
            showNotification('Selecione um arquivo de imagem válido.', 'warning');
            return;
        }

        const formData = new FormData();
        formData.append('imagem', file);

        try {
            const response = await fetch(`${API_URL}/produtos/upload-imagem`, {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
                body: formData
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                showNotification(body.error || 'Erro ao enviar imagem.', 'danger');
                return;
            }
            const path = body.path || body.imagem_principal;
            aplicarPreview(path);
            showNotification('Imagem carregada. Salve o produto para confirmar.', 'success');
        } catch (err) {
            console.error(err);
            showNotification('Erro ao enviar imagem.', 'danger');
        }
    }

    aplicarPreview(isEdit ? (produto?.imagem_principal || '') : '');

    $btnSelecionar.off('click.imagemProduto').on('click.imagemProduto', function () {
        $input.trigger('click');
    });
    $btnAlterar.off('click.imagemProduto').on('click.imagemProduto', function () {
        $input.trigger('click');
    });
    $btnRemover.off('click.imagemProduto').on('click.imagemProduto', async function () {
        const produtoId = ($('#produtoId').val() || '').trim();
        const pathAtual = $modal.data('produtoImagemPath');

        if (produtoId && pathAtual) {
            try {
                const response = await fetch(`${API_URL}/produtos/${produtoId}/imagem`, {
                    method: 'DELETE',
                    headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }
                });
                if (!response.ok) {
                    const body = await response.json().catch(() => ({}));
                    showNotification(body.error || 'Erro ao remover imagem.', 'danger');
                    return;
                }
            } catch (err) {
                console.error(err);
                showNotification('Erro ao remover imagem.', 'danger');
                return;
            }
        }

        $input.val('');
        aplicarPreview('');
        showNotification('Imagem removida.', 'success');
    });

    $drop.off('click.imagemProduto').on('click.imagemProduto', function (e) {
        if ($(e.target).closest('button').length) return;
        $input.trigger('click');
    });

    $drop.off('keydown.imagemProduto').on('keydown.imagemProduto', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            $input.trigger('click');
        }
    });

    $input.off('change.imagemProduto').on('change.imagemProduto', function () {
        const file = this.files && this.files[0] ? this.files[0] : null;
        enviarArquivo(file);
    });

    $drop.off('dragenter.imagemProduto dragover.imagemProduto')
        .on('dragenter.imagemProduto dragover.imagemProduto', function (e) {
            e.preventDefault();
            e.stopPropagation();
            $drop.addClass('is-dragover');
        });

    $drop.off('dragleave.imagemProduto drop.imagemProduto')
        .on('dragleave.imagemProduto', function (e) {
            e.preventDefault();
            e.stopPropagation();
            $drop.removeClass('is-dragover');
        })
        .on('drop.imagemProduto', function (e) {
            e.preventDefault();
            e.stopPropagation();
            $drop.removeClass('is-dragover');
            const dt = e.originalEvent && e.originalEvent.dataTransfer;
            const file = dt && dt.files && dt.files[0] ? dt.files[0] : null;
            enviarArquivo(file);
        });
}
window.inicializarImagemProdutoCadastro = inicializarImagemProdutoCadastro;

function aplicarPoliticaValidadeEmpresaNoCadastro() {
    const $check = $('#controlar_validade');
    const $aviso = $('#avisoValidadeEmpresaDesligada');
    const $area = $('#areaLoteInicial');
    if (!$check.length) return;
    const api = typeof API_URL !== 'undefined' ? API_URL : '/api';
    const token = localStorage.getItem('token') || '';
    fetch(`${api}/configuracoes/empresa_controla_validade`, {
        headers: { Authorization: 'Bearer ' + token }
    }).then((r) => r.ok ? r.json() : { permitido: true }).then((data) => {
        const permitido = data && data.permitido !== false && data.valor !== 'DESATIVADO';
        if (permitido) {
            $check.prop('disabled', false);
            $aviso.addClass('d-none');
            return;
        }
        $check.prop('checked', false).prop('disabled', true);
        $aviso.removeClass('d-none');
        $area.hide();
    }).catch(() => {});
}

// Função para controlar visibilidade dos campos de lote inicial
function inicializarControleLoteInicial() {
    const $controlarValidade = $('#controlar_validade');
    const $areaLoteInicial = $('#areaLoteInicial');

    function atualizarVisibilidadeLoteInicial() {
        const controlarValidade = $controlarValidade.prop('checked') && !$controlarValidade.prop('disabled');

        console.log('Atualizando visibilidade lote inicial:', controlarValidade);

        // Mostrar campos de lote inicial quando controlar_validade estiver marcado
        if (controlarValidade) {
            $areaLoteInicial.show();
        } else {
            $areaLoteInicial.hide();
        }
    }

    $controlarValidade.on('change', atualizarVisibilidadeLoteInicial);

    aplicarPoliticaValidadeEmpresaNoCadastro();

    // Verificar estado inicial com delay
    setTimeout(atualizarVisibilidadeLoteInicial, 100);
}


// Inicializa categorias e subcategorias
function restaurarModalProdutoAposDialogoRapido() {
    const produtoEl = document.getElementById('produtoModal');
    if (!produtoEl || !produtoEl.classList.contains('show')) return;
    document.body.classList.add('modal-open');
    if (!document.querySelector('.modal-backdrop')) {
        const bd = document.createElement('div');
        bd.className = 'modal-backdrop fade show';
        document.body.appendChild(bd);
    }
}

function pedirNomeClassificacaoRapida({ titulo, label, placeholder }) {
    return new Promise((resolve) => {
        $('#modalNomeClassificacaoRapida').remove();
        const html = `
            <div class="modal fade" id="modalNomeClassificacaoRapida" tabindex="-1" aria-hidden="true" data-bs-backdrop="static" style="z-index: 23000;">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${escapeHtml(titulo)}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                        </div>
                        <div class="modal-body">
                            <label for="inputNomeClassificacaoRapida" class="form-label">${escapeHtml(label)}</label>
                            <input type="text" class="form-control" id="inputNomeClassificacaoRapida" placeholder="${escapeHtml(placeholder || '')}" autocomplete="off">
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                            <button type="button" class="btn btn-success" id="btnConfirmarNomeClassificacaoRapida">Criar</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        $('body').append(html);
        const el = document.getElementById('modalNomeClassificacaoRapida');
        const inst = (typeof bootstrap !== 'undefined' && bootstrap.Modal)
            ? bootstrap.Modal.getOrCreateInstance(el)
            : null;
        let resolvido = false;
        const concluir = (valor) => {
            if (resolvido) return;
            resolvido = true;
            if (inst) inst.hide();
            else $(el).modal('hide');
            resolve(valor);
        };

        $('#btnConfirmarNomeClassificacaoRapida').on('click', () => {
            const nome = String($('#inputNomeClassificacaoRapida').val() || '').trim();
            if (!nome) {
                showNotification('Informe o nome.', 'warning');
                $('#inputNomeClassificacaoRapida').trigger('focus');
                return;
            }
            concluir(nome);
        });
        $('#inputNomeClassificacaoRapida').on('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                $('#btnConfirmarNomeClassificacaoRapida').trigger('click');
            }
        });
        $(el).one('shown.bs.modal', () => {
            $('.modal-backdrop').last().css('z-index', '22990');
            $('#inputNomeClassificacaoRapida').trigger('focus');
        });
        $(el).one('hidden.bs.modal', () => {
            if (!resolvido) resolve(null);
            $(el).remove();
            restaurarModalProdutoAposDialogoRapido();
        });

        if (inst) inst.show();
        else $(el).modal('show');
    });
}

function inicializarBotoesCriacaoRapidaCategoriaSubcategoria() {
    const $btnCategoria = $('#btnCriarCategoriaRapida');
    const $btnSubcategoria = $('#btnCriarSubcategoriaRapida');
    if (!$btnCategoria.length && !$btnSubcategoria.length) return;

    const sincronizarBotaoSubcategoria = () => {
        const temCategoria = Boolean(String($('#categoria_id').val() || '').trim());
        $btnSubcategoria.prop('disabled', !temCategoria);
    };

    $btnCategoria.off('click.miipQuickCreate').on('click.miipQuickCreate', async function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!window.categoriasAPI || typeof window.categoriasAPI.criar !== 'function') {
            showNotification('Cadastro de categorias indisponível nesta tela.', 'warning');
            return;
        }
        const nome = await pedirNomeClassificacaoRapida({
            titulo: 'Nova categoria',
            label: 'Nome da categoria',
            placeholder: 'Ex.: Mercearia'
        });
        if (!nome) return;
        try {
            const criada = await window.categoriasAPI.criar({ nome, tipo: 'produto' });
            const categorias = await window.categoriasAPI.listar('produto');
            const categoriasComSubs = (categorias || []).map((cat) => ({
                ...cat,
                subcategorias: (window.categoriasSistema || []).find((item) => String(item.id) === String(cat.id))?.subcategorias || []
            }));
            window.categoriasSistema = categoriasComSubs;
            const catId = String(criada?.id || '');
            const $cat = $('#categoria_id');
            $cat.html(montarOptionsCategoriasProduto(categoriasComSubs));
            $cat.val(catId);
            sincronizarDropdownClassificacao($cat[0]);
            $cat.trigger('change.cadastroCat');
            $cat.trigger('change.miipQuickCreate');
            showNotification('Categoria criada com sucesso.', 'success');
        } catch (err) {
            showNotification(err?.responseJSON?.erro || err?.message || 'Erro ao criar categoria.', 'danger');
        }
    });

    $btnSubcategoria.off('click.miipQuickCreate').on('click.miipQuickCreate', async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const categoriaId = $('#categoria_id').val();
        if (!categoriaId) {
            showNotification('Selecione uma categoria antes de criar uma subcategoria.', 'warning');
            return;
        }
        if (!window.subcategoriasAPI || typeof window.subcategoriasAPI.criar !== 'function') {
            showNotification('Cadastro de subcategorias indisponível nesta tela.', 'warning');
            return;
        }
        const nome = await pedirNomeClassificacaoRapida({
            titulo: 'Nova subcategoria',
            label: 'Nome da subcategoria',
            placeholder: 'Ex.: Grãos'
        });
        if (!nome) return;
        try {
            const criada = await window.subcategoriasAPI.criar({ nome, categoria_id: categoriaId });
            const subs = await window.subcategoriasAPI.listarPorCategoria(categoriaId).catch(() => []);
            const $select = $('#subcategoria_id');
            let options = '<option value="">Nenhuma</option>';
            (subs || []).forEach((sub) => {
                options += `<option value="${sub.id}"${String(sub.id) === String(criada?.id || '') ? ' selected' : ''}>${escapeHtml(sub.nome || '')}</option>`;
            });
            $select.html(options);
            $select.val(String(criada?.id || ''));
            sincronizarDropdownClassificacao($select[0]);
            const catCache = (window.categoriasSistema || []).find((c) => String(c.id) === String(categoriaId));
            if (catCache) catCache.subcategorias = subs || [];
            showNotification('Subcategoria criada com sucesso.', 'success');
        } catch (err) {
            showNotification(err?.responseJSON?.erro || err?.message || 'Erro ao criar subcategoria.', 'danger');
        }
    });

    $('#categoria_id').off('change.miipQuickCreate').on('change.miipQuickCreate', sincronizarBotaoSubcategoria);
    sincronizarBotaoSubcategoria();
}

window.inicializarBotoesCriacaoRapidaCategoriaSubcategoria = inicializarBotoesCriacaoRapidaCategoriaSubcategoria;

function selectClassificacaoEmUso($el) {
    const el = $el && $el[0];
    if (!el) return false;
    if (window.CdsStableDropdown && typeof window.CdsStableDropdown.isOpen === 'function' && CdsStableDropdown.isOpen(el)) {
        return true;
    }
    return document.activeElement === el;
}

function sincronizarDropdownClassificacao(el) {
    if (!el || !window.CdsStableDropdown || typeof CdsStableDropdown.mount !== 'function') return;
    CdsStableDropdown.mount(el);
}

function ensureClassificacaoDropdowns() {
    const cat = document.getElementById('categoria_id');
    const sub = document.getElementById('subcategoria_id');
    sincronizarDropdownClassificacao(cat);
    sincronizarDropdownClassificacao(sub);
}

function montarOptionsCategoriasProduto(categoriasComSubs) {
    let catOptions = '<option value="">Selecione</option>';
    (categoriasComSubs || []).forEach((cat) => {
        catOptions += `<option value="${cat.id}">${escapeHtml(cat.nome || '')}</option>`;
    });
    return catOptions;
}

function inicializarCategoriasESubcategorias(produto, isEdit) {
    if (!(window.categoriasAPI && window.subcategoriasAPI)) {
        $('#categoria_id').html('<option value="">Categorias indisponíveis</option>');
        $('#subcategoria_id').html('<option value="">Subcategorias indisponíveis</option>');
        ensureClassificacaoDropdowns();
        return;
    }

    let renderClassificacaoPendente = null;

    function renderCategorias(categoriasComSubs) {
        const $cat = $('#categoria_id');
        const $sub = $('#subcategoria_id');
        if (!$cat.length) return;
        ensureClassificacaoDropdowns();

        if (selectClassificacaoEmUso($cat) || selectClassificacaoEmUso($sub)) {
            renderClassificacaoPendente = categoriasComSubs;
        }

        window.categoriasSistema = categoriasComSubs;
        const valorCatAtual = String($cat.val() || '');
        const valorSubAtual = String($sub.val() || '');
        const htmlNovo = montarOptionsCategoriasProduto(categoriasComSubs);
        const catParaSelecionar = valorCatAtual
            || (isEdit && produto && produto.categoria_id ? String(produto.categoria_id) : '');

        if ($cat.html() !== htmlNovo) {
            $cat.html(htmlNovo);
        }
        if (catParaSelecionar) {
            $cat.val(catParaSelecionar);
        }
        sincronizarDropdownClassificacao($cat[0]);

        function carregarSubs(catId, selectedSubId) {
            if (!catId) {
                $('#subcategoria_id').html('<option value="">Selecione uma categoria</option>');
                $('#btnCriarSubcategoriaRapida').prop('disabled', true);
                sincronizarDropdownClassificacao(document.getElementById('subcategoria_id'));
                return;
            }
            const cat = categoriasComSubs.find((c) => String(c.id) === String(catId));
            let subOptions = '<option value="">Nenhuma</option>';
            (cat && cat.subcategorias ? cat.subcategorias : []).forEach((sub) => {
                subOptions += `<option value="${sub.id}">${escapeHtml(sub.nome || '')}</option>`;
            });
            const $subSel = $('#subcategoria_id');
            const subAberta = selectClassificacaoEmUso($subSel);
            if ($subSel.html() !== subOptions) {
                $subSel.html(subOptions);
            }
            $('#btnCriarSubcategoriaRapida').prop('disabled', false);
            if (typeof selectedSubId !== 'undefined' && selectedSubId !== null && selectedSubId !== '') {
                $subSel.val(String(selectedSubId));
            }
            sincronizarDropdownClassificacao($subSel[0]);
            void subAberta;
        }

        $cat.off('change.cadastroCat').on('change.cadastroCat', function () {
            carregarSubs($(this).val());
        });

        if (catParaSelecionar) {
            const subId = valorSubAtual
                || (isEdit && produto && produto.subcategoria_id != null && produto.subcategoria_id !== 'null'
                    ? String(produto.subcategoria_id)
                    : '');
            carregarSubs(catParaSelecionar, subId);
        } else {
            $('#subcategoria_id').html('<option value="">Selecione uma categoria</option>');
            $('#btnCriarSubcategoriaRapida').prop('disabled', true);
            sincronizarDropdownClassificacao(document.getElementById('subcategoria_id'));
        }

        if (renderClassificacaoPendente) {
            renderClassificacaoPendente = null;
        }
    }

    // Renderiza rapidamente com cache local (quando houver) e em seguida
    // sempre sincroniza da API para refletir novas subcategorias sem recarregar a página.
    if (window.categoriasSistema && Array.isArray(window.categoriasSistema) && window.categoriasSistema.length > 0) {
        renderCategorias(window.categoriasSistema);
    }

    const possuiCacheCategorias = window.categoriasSistema && Array.isArray(window.categoriasSistema) && window.categoriasSistema.length > 0;

    $.when(categoriasAPI.listar('produto'), subcategoriasAPI.listar()).done(function (categorias, subcategorias) {
        categorias = categorias[0] || [];
        subcategorias = subcategorias[0] || [];

        const categoriasComSubs = (categorias || []).map((cat) => ({
            ...cat,
            subcategorias: (subcategorias || []).filter((sub) => String(sub.categoria_id) === String(cat.id))
        }));

        renderCategorias(categoriasComSubs);
    }).fail(function () {
        if (possuiCacheCategorias) {
            return;
        }
        $('#categoria_id').html('<option value="">Erro ao carregar categorias</option>');
        $('#subcategoria_id').html('<option value="">Erro ao carregar subcategorias</option>');
        ensureClassificacaoDropdowns();
    });
}


// ---------- Venda em Atacado (frontend helpers) ----------
function inicializarVendaAtacado(produto, isEdit) {
    const produtoId = produto && produto.id ? String(produto.id) : null;
    const ativo = isEdit && Number(produto.venda_atacado || 0) === 1;
    const animMs = 150;

    $('#venda_atacado').off('change').on('change', function() {
        const checked = $(this).is(':checked');
        const $area = $('#areaVendaAtacado');
        $area.stop(true, true);
        if (checked) {
            $area.slideDown(animMs);
        } else {
            $area.slideUp(animMs);
        }
        // atualizar flag local no produto (quando existir)
        if (produto && produto.id) produto.venda_atacado = checked ? 1 : 0;
    });

    // Botão adicionar faixa
    $('#btnAdicionarFaixa').off('click').on('click', function() {
        adicionarFaixaPrompt(produtoId);
    });

    if (ativo) {
        $('#areaVendaAtacado').show();
        renderFaixasAtacado(produtoId);
    } else {
        $('#areaVendaAtacado').hide();
    }
}

function renderFaixasAtacado(produtoId) {
    const $tbody = $('#tabelaAtacado tbody');
    $tbody.html('');
    if (!produtoId) {
        // carregar faixas temporárias do modal
        const faixasTemp = $('#produtoModal').data('faixasTemp') || [];
        faixasTemp.forEach((r, idx) => {
            const tr = `
                <tr data-temp-index="${idx}">
                    <td>${r.quantidade_minima}</td>
                    <td>${formatarPercentualPorPrecoAtacado(r.preco_atacado)}</td>
                    <td>${formatCurrency(r.preco_atacado)}</td>
                    <td class="text-end">
                        <button class="btn btn-sm btn-outline-primary me-1" onclick="editarFaixaPromptTemp(${idx})">Editar</button>
                        <button class="btn btn-sm btn-outline-danger" onclick="excluirFaixaTemp(${idx})">Excluir</button>
                    </td>
                </tr>
            `;
            $tbody.append(tr);
        });
        return;
    }

    $.ajax({
        url: `${API_URL}/produtos/${produtoId}/atacado`,
        method: 'GET',
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
        success: function(rows) {
            (rows || []).forEach(r => {
                const tr = `
                    <tr data-id="${r.id}">
                        <td>${r.quantidade_minima}</td>
                        <td>${formatarPercentualPorPrecoAtacado(r.preco_atacado)}</td>
                        <td>${formatCurrency(r.preco_atacado)}</td>
                        <td class="text-end">
                            <button class="btn btn-sm btn-outline-primary me-1" onclick="editarFaixaPrompt(${r.id})">Editar</button>
                            <button class="btn btn-sm btn-outline-danger" onclick="excluirFaixa(${r.id}, ${produtoId})">Excluir</button>
                        </td>
                    </tr>
                `;
                $tbody.append(tr);
            });
        },
        error: function() {
            showNotification('Erro ao carregar faixas de atacado.', 'danger');
        }
    });
}

function adicionarFaixaPrompt(produtoId) {
    // Abre uma linha de inserção embutida na tabela de faixas (não usa prompt())
    const $tbody = $('#tabelaAtacado tbody');
    if ($tbody.find('tr[data-editing="nova"]').length) return; // já aberta

    const tr = $(
        `
        <tr data-editing="nova">
            <td><input type="number" min="1" class="form-control form-control-sm input-quantidade" placeholder="Quantidade mínima"></td>
            <td><input type="number" min="0" step="0.01" class="form-control form-control-sm input-percentual" placeholder="% Atacado"></td>
            <td><input type="text" class="form-control form-control-sm input-preco" placeholder="Preço atacado"></td>
            <td class="text-end">
                <button type="button" class="btn btn-sm btn-success btn-salvar-nova me-1">Salvar faixa</button>
                <button type="button" class="btn btn-sm btn-secondary btn-cancelar-nova">Cancelar</button>
            </td>
        </tr>
    `);

    $tbody.prepend(tr);
    fixarEventosFaixaRow(tr);

    // marcar o tr com o produtoId para que handlers genéricos o encontrem
    if (produtoId) tr.attr('data-produto-id', produtoId);

    // salvar ao pressionar Enter na linha ou ao sair do campo de preço; Esc cancela (remove a linha)
    function salvarNova() {
        const dados = extrairDadosFaixaLinha(tr);
        if (!dados) {
            showNotification('Informe quantidade mínima e percentual/preço válidos.', 'warning');
            return;
        }

        const pid = tr.data('produto-id');
        if (!pid) {
            const faixasTemp = $('#produtoModal').data('faixasTemp') || [];
            faixasTemp.push(dados);
            $('#produtoModal').data('faixasTemp', faixasTemp);
            tr.remove();
            renderFaixasAtacado(null);
            showNotification('Faixa adicionada. Salve o produto para persistir.', 'success');
            return;
        }

        $.ajax({
            url: `${API_URL}/produtos/${pid}/atacado`,
            method: 'POST',
            global: false,
            headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
            contentType: 'application/json',
            data: JSON.stringify(dados),
            success: function() {
                renderFaixasAtacado(pid);
                showNotification('Faixa adicionada com sucesso', 'success');
            },
            error: function(xhr) {
                console.error('Erro ao adicionar faixa:', xhr.status, xhr.responseJSON);
                let err = xhr.responseJSON?.error || 'Erro ao adicionar faixa';
                if (xhr.status === 403) {
                    err = 'Você não tem permissão para gerenciar faixas de atacado';
                } else if (xhr.status === 401) {
                    err = 'Sua sessão expirou. Faça login novamente';
                }
                showNotification(err, 'danger');
            }
        });
    }

    tr.find('input').on('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            salvarNova();
        } else if (e.key === 'Escape') {
            tr.remove();
        }
    });

    tr.find('.btn-salvar-nova').on('click', function() {
        salvarNova();
    });

    tr.find('.btn-cancelar-nova').on('click', function() {
        tr.remove();
    });
}

function editarFaixaPrompt(faixaId) {
    // Editar faixa existente no servidor inline na tabela
    const $tr = $(`#tabelaAtacado tr[data-id='${faixaId}']`);
    if ($tr.length === 0) return showNotification('Faixa não encontrada', 'danger');
    // buscar dados atuais
    $.ajax({ url: `${API_URL}/produtos/atacado/${faixaId}`, method: 'GET', headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }, success: function(faixa) {
        if (!faixa) return showNotification('Faixa não encontrada', 'danger');
        const originalHtml = $tr.html();
        $tr.html(`
            <td><input type="number" min="1" class="form-control form-control-sm input-quantidade" value="${faixa.quantidade_minima}"></td>
            <td><input type="number" min="0" step="0.01" class="form-control form-control-sm input-percentual" value="${calcularPercentualPorPrecoAtacado(faixa.preco_atacado).toFixed(2)}"></td>
            <td><input type="text" class="form-control form-control-sm input-preco" value="${faixa.preco_atacado}"></td>
            <td class="text-end">
                <button class="btn btn-sm btn-success me-1 btn-salvar-edicao">Salvar</button>
                <button class="btn btn-sm btn-secondary btn-cancelar-edicao">Cancelar</button>
            </td>
        `);

        $tr.find('.btn-cancelar-edicao').on('click', function() { $tr.html(originalHtml); });
        fixarEventosFaixaRow($tr);

        $tr.find('.btn-salvar-edicao').on('click', function() {
            const q = parseInt($tr.find('.input-quantidade').val(), 10);
            const percentual = parseNumero($tr.find('.input-percentual').val());
            const precoStr = $tr.find('.input-preco').val() || '';
            const precoManual = parseFloat(precoStr.replace(',', '.'));
            let preco = (!isNaN(precoManual) && precoManual > 0) ? precoManual : 0;
            if ((!preco || preco <= 0) && percentual > 0) {
                preco = obterPrecoPorPercentual(percentual);
            }
            if (!q || q <= 0) { showNotification('Quantidade inválida', 'warning'); return; }
            if (isNaN(preco) || preco <= 0) { showNotification('Preço inválido', 'warning'); return; }

            $.ajax({
                url: `${API_URL}/produtos/atacado/${faixaId}`,
                method: 'PUT',
                global: false,
                headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
                contentType: 'application/json',
                data: JSON.stringify({ quantidade_minima: q, preco_atacado: preco }),
                success: function() {
                    const pid = $('#produtoId').val();
                    renderFaixasAtacado(pid);
                    showNotification('Faixa atualizada', 'success');
                },
                error: function(xhr) {
                    console.error('Erro ao atualizar faixa:', xhr.status, xhr.responseJSON);
                    let err = xhr.responseJSON?.error || 'Erro ao atualizar faixa';
                    if (xhr.status === 403) {
                        err = 'Você não tem permissão para gerenciar faixas de atacado';
                    } else if (xhr.status === 401) {
                        err = 'Sua sessão expirou. Faça login novamente';
                    }
                    showNotification(err, 'danger');
                }
            });
        });
    }, error: function() { showNotification('Erro ao buscar faixa', 'danger'); } });
}

function editarFaixaPromptTemp(index) {
    const $tr = $(`#tabelaAtacado tr[data-temp-index='${index}']`);
    const faixasTemp = $('#produtoModal').data('faixasTemp') || [];
    const faixa = faixasTemp[index];
    if (!$tr.length || !faixa) return showNotification('Faixa não encontrada localmente', 'danger');
    const originalHtml = $tr.html();
    $tr.html(`
        <td><input type="number" min="1" class="form-control form-control-sm input-quantidade" value="${faixa.quantidade_minima}"></td>
        <td><input type="number" min="0" step="0.01" class="form-control form-control-sm input-percentual" value="${calcularPercentualPorPrecoAtacado(faixa.preco_atacado).toFixed(2)}"></td>
        <td><input type="text" class="form-control form-control-sm input-preco" value="${faixa.preco_atacado}"></td>
        <td class="text-end"></td>
    `);

    fixarEventosFaixaRow($tr);

    function salvarEdicaoTemp() {
        const q = parseInt($tr.find('.input-quantidade').val(), 10);
        const percentual = parseNumero($tr.find('.input-percentual').val());
        const precoStr = $tr.find('.input-preco').val() || '';
        const precoManual = parseFloat(precoStr.replace(',', '.'));
        let preco = (!isNaN(precoManual) && precoManual > 0) ? precoManual : 0;
        if ((!preco || preco <= 0) && percentual > 0) {
            preco = obterPrecoPorPercentual(percentual);
        }
        if (!q || q <= 0) { showNotification('Quantidade inválida', 'warning'); return; }
        if (isNaN(preco) || preco <= 0) { showNotification('Preço inválido', 'warning'); return; }

        faixasTemp[index] = { quantidade_minima: q, preco_atacado: preco };
        $('#produtoModal').data('faixasTemp', faixasTemp);
        renderFaixasAtacado(null);
        showNotification('Faixa atualizada localmente. Salve o produto para persistir.', 'success');
    }

    $tr.find('input').on('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            salvarEdicaoTemp();
        } else if (e.key === 'Escape') {
            $tr.html(originalHtml);
        }
    });
}

function excluirFaixaTemp(index) {
    if (!confirm('Deseja realmente excluir esta faixa temporária?')) return;
    const faixasTemp = $('#produtoModal').data('faixasTemp') || [];
    faixasTemp.splice(index, 1);
    $('#produtoModal').data('faixasTemp', faixasTemp);
    renderFaixasAtacado(null);
}

function excluirFaixa(faixaId, produtoId) {
    if (!confirm('Deseja realmente excluir esta faixa de atacado?')) return;
    $.ajax({
        url: `${API_URL}/produtos/atacado/${faixaId}`,
        method: 'DELETE',
        global: false,
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
        success: function() {
            renderFaixasAtacado(produtoId || $('#produtoId').val());
            showNotification('Faixa excluída', 'success');
        },
        error: function() {
            showNotification('Erro ao excluir faixa', 'danger');
        }
    });
}

function parseNumero(valor) {
    return parseFloat(String(valor || '0').replace(',', '.')) || 0;
}

function calcularPercentualPorPrecoAtacado(precoAtacado) {
    const precoVenda = parseNumero($('#preco_venda').val());
    if (precoVenda <= 0) return 0;
    const precoAtacadoConvertido = parseNumero(precoAtacado);
    return ((precoVenda - precoAtacadoConvertido) / precoVenda) * 100;
}

function formatarPercentualPorPrecoAtacado(precoAtacado) {
    const percentual = calcularPercentualPorPrecoAtacado(precoAtacado);
    return `${percentual.toFixed(2)}%`;
}

function arredondarPrecoInternoAtacado(valor) {
    if (typeof MotorPrecoAtacado !== 'undefined') {
        return MotorPrecoAtacado.arredondarInterno(valor);
    }
    const n = Number(valor || 0);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 1e6) / 1e6;
}

function obterPrecoPorPercentual(percentual) {
    const precoVenda = parseNumero($('#preco_venda').val());
    if (precoVenda <= 0) return 0;
    return arredondarPrecoInternoAtacado(precoVenda * (1 - (parseNumero(percentual) / 100)));
}

function extrairDadosFaixaLinha($tr) {
    const q = parseInt($tr.find('.input-quantidade').val(), 10);
    const percentual = parseNumero($tr.find('.input-percentual').val());
    const precoStr = $tr.find('.input-preco').val() || '';
    const precoManual = parseFloat(String(precoStr).replace(',', '.'));
    let preco = (!isNaN(precoManual) && precoManual > 0) ? precoManual : 0;

    if ((!preco || preco <= 0) && percentual > 0) {
        preco = obterPrecoPorPercentual(percentual);
    }

    if (!q || q <= 0 || isNaN(preco) || preco <= 0) {
        return null;
    }

    return {
        quantidade_minima: q,
        preco_atacado: arredondarPrecoInternoAtacado(preco)
    };
}

async function commitFaixaAtacadoPendente(produtoId) {
    const $tr = $('#tabelaAtacado tr[data-editing="nova"]');
    if (!$tr.length) {
        return true;
    }

    const dados = extrairDadosFaixaLinha($tr);
    if (!dados) {
        showNotification('Informe quantidade mínima e percentual/preço da faixa de atacado.', 'warning');
        return false;
    }

    if (!produtoId) {
        const faixasTemp = $('#produtoModal').data('faixasTemp') || [];
        faixasTemp.push(dados);
        $('#produtoModal').data('faixasTemp', faixasTemp);
        $tr.remove();
        return true;
    }

    try {
        const response = await fetch(`${API_URL}/produtos/${produtoId}/atacado`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify(dados)
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            showNotification(err.error || 'Erro ao salvar faixa de atacado.', 'danger');
            return false;
        }

        $tr.remove();
        renderFaixasAtacado(String(produtoId));
        return true;
    } catch (error) {
        console.error('Erro ao salvar faixa de atacado pendente:', error);
        showNotification('Erro ao salvar faixa de atacado.', 'danger');
        return false;
    }
}

function fixarEventosFaixaRow($row) {
    const $percentual = $row.find('.input-percentual');
    const $preco = $row.find('.input-preco');

    $percentual.off('input').on('input', function() {
        const valor = parseNumero($percentual.val());
        const preco = obterPrecoPorPercentual(valor);
        if (preco > 0) {
            $preco.val(preco.toFixed(2));
        }
    });

    $preco.off('input').on('input', function() {
        const valor = parseNumero($preco.val());
        if (valor <= 0) {
            $percentual.val('0.00');
            return;
        }
        const percentual = calcularPercentualPorPrecoAtacado(valor);
        $percentual.val(percentual.toFixed(2));
    });
}


// Inicializa cálculo automático do preço de venda
function produtoCadastroUsaCompraPorEmbalagem() {
    if (typeof ProdutoEmbalagensUI !== 'undefined' && ProdutoEmbalagensUI.obterCompraPorEmbalagemAtiva) {
        return ProdutoEmbalagensUI.obterCompraPorEmbalagemAtiva();
    }
    return false;
}

/**
 * FORMACAO-PRECO-MARGEM-06 — margem/lucro reais do preço atual (não persistidos).
 */
function atualizarFormacaoPrecoMargemInfo() {
    const F = window.FormacaoPrecoMargem;
    const $margem = $('#margem_bruta_real_preview');
    const $lucro = $('#lucro_bruto_real_preview');
    const $totalInfo = $('#valor_total_venda_info_preview');
    if (!$margem.length || !F) return;

    const setTexto = ($el, texto) => {
        if ($el.is('input, textarea, select')) {
            $el.val(texto);
        } else {
            $el.text(texto);
        }
    };

    const numero = (valor) => {
        const n = parseFloat(String(valor ?? '').replace(',', '.'));
        return Number.isFinite(n) ? n : NaN;
    };
    const moeda = (valor) => {
        if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) {
            return F.PLACEHOLDER;
        }
        return typeof formatCurrency === 'function'
            ? formatCurrency(valor)
            : `R$ ${Number(valor).toFixed(2).replace('.', ',')}`;
    };

    const custo = numero($('#preco_compra').val());
    const preco = numero($('#preco_venda').val());
    const custoOk = Number.isFinite(custo) && custo >= 0;
    const precoOk = Number.isFinite(preco) && preco >= 0;

    let margem = null;
    let lucro = null;
    if (custoOk && precoOk) {
        margem = F.calcularMargemBruta(custo, preco);
        lucro = F.calcularLucroBruto(custo, preco);
    }

    setTexto($margem, F.formatarPercentualPreview(margem));
    setTexto($lucro, lucro === null ? F.PLACEHOLDER : moeda(lucro));

    const totalOficial = String($('#valor_total_venda_preview').val() || '').trim();
    setTexto($totalInfo, totalOficial || F.PLACEHOLDER);

    $lucro.toggleClass('is-negativo', Number.isFinite(lucro) && lucro < 0);
    $margem.toggleClass('is-negativo', Number.isFinite(margem) && margem < 0);
}
window.atualizarFormacaoPrecoMargemInfo = atualizarFormacaoPrecoMargemInfo;

function sincronizarFormacaoPrecoProduto(origem = 'init') {
    if (typeof ProdutoEmbalagensUI !== 'undefined'
        && ProdutoEmbalagensUI.sincronizarFormacaoPrecoApresentacaoPrincipal(origem)) {
        atualizarFormacaoPrecoMargemInfo();
        return;
    }

    const $precoCompra = $('#preco_compra');
    const $lucro = $('#lucro_percentual');
    const $precoVenda = $('#preco_venda');
    if (!$precoCompra.length || !$lucro.length || !$precoVenda.length) return;

    const numero = (valor) => parseFloat(String(valor ?? '').replace(',', '.')) || 0;
    const compraPorEmbalagem = produtoCadastroUsaCompraPorEmbalagem();
    const motor = window.MotorUnidadesMedidaCliente;

    if (compraPorEmbalagem && motor) {
        atualizarFormacaoPrecoMargemInfo();
        return;
    }

    $precoCompra.prop('readonly', false).removeClass('bg-light');

    const precoCompra = numero($precoCompra.val());
    const precoVenda = numero($precoVenda.val());
    const lucroInformado = String($lucro.val() ?? '').trim() !== '';
    const F = window.FormacaoPrecoMargem;
    const resolved = (F && typeof F.resolverFormacaoPrecoCadastro === 'function')
        ? F.resolverFormacaoPrecoCadastro({
            origem,
            precoCompra,
            precoVenda,
            lucroInformado,
            lucroValor: numero($lucro.val())
        })
        : null;

    const origemNorm = String(origem || 'init');

    if (resolved) {
        if (origemNorm === 'init' || origemNorm === 'embalagem') {
            if (resolved.lucroPercentual !== null && resolved.lucroPercentual !== undefined) {
                $lucro.val(Number(resolved.lucroPercentual).toFixed(2));
            }
        } else if (origemNorm === 'venda') {
            if (resolved.lucroPercentual !== null && resolved.lucroPercentual !== undefined) {
                $lucro.val(Number(resolved.lucroPercentual).toFixed(2));
            }
        } else if (origemNorm === 'compra' || origemNorm === 'lucro') {
            if (resolved.precoVenda !== null && resolved.precoVenda !== undefined) {
                $precoVenda.val(Number(resolved.precoVenda).toFixed(2));
            }
        }
        atualizarPreviewValorTotalEstoqueCadastro();
        atualizarFormacaoPrecoMargemInfo();
        return;
    }

    if (origemNorm === 'venda') {
        if (precoCompra > 0 && precoVenda > 0) {
            const lucro = ((precoVenda - precoCompra) / precoCompra) * 100;
            $lucro.val(lucro.toFixed(2));
        }
        atualizarPreviewValorTotalEstoqueCadastro();
        atualizarFormacaoPrecoMargemInfo();
        return;
    }

    if (origemNorm === 'init' || origemNorm === 'embalagem') {
        if (precoCompra > 0 && precoVenda > 0) {
            const lucro = ((precoVenda - precoCompra) / precoCompra) * 100;
            $lucro.val(lucro.toFixed(2));
        }
        atualizarPreviewValorTotalEstoqueCadastro();
        atualizarFormacaoPrecoMargemInfo();
        return;
    }

    if (precoCompra > 0) {
        const lucro = lucroInformado ? numero($lucro.val()) : 0;
        const novoPrecoVenda = precoCompra + (precoCompra * lucro / 100);
        $precoVenda.val(novoPrecoVenda.toFixed(2));
    }

    atualizarPreviewValorTotalEstoqueCadastro();
    atualizarFormacaoPrecoMargemInfo();
}

function atualizarVisibilidadeEmbalagemComercialCadastro() {
    const usaApresentacao = produtoCadastroUsaCompraPorEmbalagem();
    $('#wrap_valor_embalagem_venda').toggleClass('d-none', !usaApresentacao);
    if (!usaApresentacao) {
        $('#valor_embalagem_venda').val('R$ 0,00');
        $('#preco_compra').prop('readonly', false).removeClass('bg-light');
    }
    sincronizarFormacaoPrecoProduto(usaApresentacao ? 'embalagem' : 'init');
}
window.atualizarVisibilidadeEmbalagemComercialCadastro = atualizarVisibilidadeEmbalagemComercialCadastro;

function inicializarCalculoPreco(produto, isEdit) {
    const $precoCompra = $('#preco_compra');
    const $lucro = $('#lucro_percentual');
    const $precoVenda = $('#preco_venda');

    $precoCompra
        .off('input.precoMotor change.precoMotor')
        .on('input.precoMotor change.precoMotor', () => sincronizarFormacaoPrecoProduto('compra'));

    $lucro
        .off('input.precoMotor change.precoMotor')
        .on('input.precoMotor change.precoMotor', () => sincronizarFormacaoPrecoProduto('lucro'));

    $precoVenda
        .off('input.precoMotor change.precoMotor')
        .on('input.precoMotor change.precoMotor', () => sincronizarFormacaoPrecoProduto('venda'));

    $('#unidade')
        .off('change.apresentacoesUnidade')
        .on('change.apresentacoesUnidade', () => {
            if (typeof ProdutoEmbalagensUI !== 'undefined') {
                ProdutoEmbalagensUI.sincronizarFormacaoPrecoApresentacaoPrincipal('init');
            }
            atualizarFormacaoPrecoMargemInfo();
        });

    atualizarVisibilidadeEmbalagemComercialCadastro();
    setTimeout(() => sincronizarFormacaoPrecoProduto('init'), 0);
}

function garantirModalConfirmacaoControlaEstoque() {
    if (document.getElementById('modalConfirmacaoControlaEstoque')) {
        return;
    }

    const html = `
        <div class="modal fade" id="modalConfirmacaoControlaEstoque" tabindex="-1" aria-labelledby="modalConfirmacaoControlaEstoqueLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="modalConfirmacaoControlaEstoqueLabel">Desativar Controle de Estoque</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-2">⚠ Este produto não terá movimentação de estoque.</p>
                        <p class="mb-2">As vendas continuarão sendo registradas normalmente.</p>
                        <p class="mb-0 fw-semibold">Deseja continuar?</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" id="btnCancelarControlaEstoque">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="btnConfirmarControlaEstoque">Confirmar</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('body').append(html);
}

function inicializarConfirmacaoControlaEstoque() {
    garantirModalConfirmacaoControlaEstoque();

    const $switch = $('#controla_estoque');
    $switch.off('change.rc80zControlaEstoque').on('change.rc80zControlaEstoque', function onToggleControlaEstoque() {
        if ($switch.is(':checked')) {
            return;
        }

        // Mantém ON até o usuário confirmar
        $switch.prop('checked', true);

        const modalEl = document.getElementById('modalConfirmacaoControlaEstoque');
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        let confirmado = false;

        $('#btnConfirmarControlaEstoque').off('click.rc80z').one('click.rc80z', () => {
            confirmado = true;
            $switch.prop('checked', false);
            modal.hide();
        });

        $(modalEl).off('hidden.bs.modal.rc80z').one('hidden.bs.modal.rc80z', () => {
            if (!confirmado) {
                $switch.prop('checked', true);
            }
        });

        modal.show();
    });
}


// Salva produto
// opcoes.continuar === true → após salvar, abre outro "Novo Produto" (fluxo rápido)
async function saveProduto(opcoes) {
    const forcarContinuar = opcoes && typeof opcoes === 'object' && opcoes.continuar === true;
    const forcarFechar = opcoes && typeof opcoes === 'object' && opcoes.continuar === false;
    const id = $('#produtoId').val();

    if ($('#venda_atacado').is(':checked')) {
        const faixaSalva = await commitFaixaAtacadoPendente(id || null);
        if (!faixaSalva) {
            return;
        }
    }

    const saldosIniciais = obterSaldosIniciaisDoFormulario();

    if (typeof ProdutoEmbalagensUI !== 'undefined') {
        const apresentacoes = ProdutoEmbalagensUI.coletarApresentacoesDoFormulario();
        for (let i = 0; i < apresentacoes.length; i += 1) {
            const ap = apresentacoes[i];
            if (String(ap.tipo || 'UN').toUpperCase() !== 'UN' && Number(ap.quantidade || 0) <= 0) {
                showNotification(`Apresentação ${i + 1}: informe a quantidade de conversão.`, 'warning');
                return;
            }
            if (Number(ap.compra) === 1 && String(ap.tipo || 'UN').toUpperCase() !== 'UN' && Number(ap.valor_compra || 0) <= 0) {
                showNotification(`Apresentação ${i + 1}: informe o valor de compra da embalagem.`, 'warning');
                return;
            }
        }
    }

    if ($('#produto_fracionado').is(':checked') && !unidadeVendaSuportaConversao($('#unidade').val())) {
        showNotification(
            'Produto Pesável exige unidade de venda fracionável (KG, MT, LT, M², M³, etc.).',
            'warning'
        );
        return;
    }

    const pluBruto = ($('#plu').val() || '').trim();
    const pluDigits = pluBruto.replace(/\D/g, '');
    if (pluBruto && !pluDigits) {
        showNotification('PLU inválido: use apenas dígitos.', 'warning');
        $('#plu').focus();
        return;
    }
    if (pluDigits.length > 10) {
        showNotification('PLU inválido: máximo 10 dígitos.', 'warning');
        $('#plu').focus();
        return;
    }

    if ($('#produto_fracionado').is(':checked')) {
        const controlaEstoque = $('#controla_estoque').is(':checked');
        const ref = obterReferenciaConversaoCadastro();
        if (controlaEstoque && (ref.qtd <= 0 || ref.precoCompra <= 0)) {
            showNotification(
                'Para produto pesável, informe a Quantidade Total no Estoque Inicial e o Custo por Unidade de Venda.',
                'warning'
            );
            return;
        }
    }

    const fracionadoAtivo = $('#produto_fracionado').is(':checked');
    const permiteVendaUnidade = fracionadoAtivo && $('#permite_venda_unidade').is(':checked');
    const pesoMedioUnidade = parseFloat($('#peso_medio_unidade').val()) || 0;
    const precoUnidadeVenda = parseFloat($('#preco_unidade').val()) || 0;

    if (permiteVendaUnidade && (pesoMedioUnidade <= 0 || precoUnidadeVenda <= 0)) {
        const camposPendentes = [];
        if (pesoMedioUnidade <= 0) camposPendentes.push('peso médio da unidade');
        if (precoUnidadeVenda <= 0) camposPendentes.push('preço por unidade');
        showNotification(
            `Para permitir venda por unidade, informe ${camposPendentes.join(' e ')} com valor maior que zero.`,
            'warning'
        );
        if (pesoMedioUnidade <= 0) {
            $('#peso_medio_unidade').focus();
        } else {
            $('#preco_unidade').focus();
        }
        return;
    }

    const data = {
        codigo: ($('#codigo').val() || '').trim(),
        nome: ($('#nome').val() || '').trim(),
        categoria_id: $('#categoria_id').val() ? String($('#categoria_id').val()) : null,
        subcategoria_id: $('#subcategoria_id').val() ? String($('#subcategoria_id').val()) : null,
        marca_id: $('#marca_id').val() ? String($('#marca_id').val()) : null,
        observacoes: ($('#produto_observacoes').val() || '').trim() || null,
        imagem_principal: ($('#produtoModal').data('produtoImagemPath') || null),
        unidade: ($('#unidade').val() || '').trim(),
        preco_compra: parseFloat($('#preco_compra').val()) || 0,
        preco_venda: parseFloat($('#preco_venda').val()) || 0,
        lucro_percentual: $('#lucro_percentual').val() !== '' ? parseFloat($('#lucro_percentual').val()) : (
            (parseFloat($('#preco_compra').val()) || 0) > 0 && (parseFloat($('#preco_venda').val()) || 0) > 0
                ? parseFloat(((((parseFloat($('#preco_venda').val()) - parseFloat($('#preco_compra').val())) / parseFloat($('#preco_compra').val())) * 100).toFixed(2)))
                : null
        ),
        estoque_minimo: parseFloat($('#estoque_minimo').val()) || 0,
        fornecedor: obterNomeFornecedorCadastro(),
        data_validade: ($('#data_validade').val() || '').trim() || null,
        lote: ($('#lote').val() || '').trim(),
        dias_alerta_validade: parseInt($('#dias_alerta_validade').val(), 10) || 30,
        controlar_validade: ($('#controlar_validade').is(':checked') && !$('#controlar_validade').prop('disabled')) ? 1 : 0,
        controla_estoque: $('#controla_estoque').is(':checked') ? 1 : 0,
        ncm: ($('#ncm').val() || '').trim(),
        cfop: resolverCfopSalvarNovoProduto(($('#cfop').val() || '').trim()),
        csosn: ($('#csosn').val() || '').trim(),
        origem: $('#origem').val() !== '' ? parseInt($('#origem').val(), 10) : 0,
        cest: ($('#cest').val() || '').trim(),
        codigo_barras: ($('#codigo_barras').val() || '').trim(),
        plu: pluDigits,
        aliquota_icms: parseFloat($('#aliquota_icms').val()) || 0,
        aliquota_pis: parseFloat($('#aliquota_pis').val()) || 0,
        aliquota_cofins: parseFloat($('#aliquota_cofins').val()) || 0,
        produto_fracionado: fracionadoAtivo ? 1 : 0,
        vendido_por_peso: fracionadoAtivo ? 1 : 0,
        produto_pesavel: fracionadoAtivo ? 1 : 0,
        integrar_balanca: $('#integrar_balanca').is(':checked') ? 1 : 0,
        permite_venda_unidade: permiteVendaUnidade ? 1 : 0,
        peso_medio_unidade: permiteVendaUnidade ? pesoMedioUnidade : 0,
        preco_unidade: permiteVendaUnidade ? precoUnidadeVenda : 0,
        venda_atacado: $('#venda_atacado').is(':checked') ? 1 : 0,
        compra_por_embalagem: produtoCadastroUsaCompraPorEmbalagem() ? 1 : 0,
        // Campos para lote inicial (apenas para novos produtos)
        data_validade_inicial: ($('#data_validade_inicial').val() || '').trim() || null
    };

    if ($('#produto_fracionado').is(':checked')) {
        const ref = obterReferenciaConversaoCadastro();
        if (ref.valor > 0 && ref.qtd > 0) {
            data.valor_total_compra = ref.valor;
            data.peso_total_compra = ref.qtd;
            data.custo_por_kg = ref.precoCompra;
            data.preco_compra = custoUnitarioVendaCadastro(ref.precoCompra);
        }
    }

    if ($('#saldo_fiscal_inicial').length) {
        data.saldo_fiscal_inicial = saldosIniciais.saldo_fiscal_inicial;
        data.saldo_nao_fiscal_inicial = saldosIniciais.saldo_nao_fiscal_inicial;
    }

    data.item_fiscal = resolverItemFiscalParaSalvar(saldosIniciais);
    console.log('[AUDIT PRODUTO] Payload salvar:', JSON.stringify(data, null, 2));
    console.log('[AUDIT PRODUTO] item_fiscal enviado:', data.item_fiscal);

    // Validação para produtos com controle de validade e estoque
    const saldosProdutoModal = $('#produtoModal').data('produtoSaldos');
    const estoqueParaValidade = id && saldosProdutoModal
        ? (Number(saldosProdutoModal.saldo_fiscal || 0) + Number(saldosProdutoModal.saldo_nao_fiscal || 0) || Number(saldosProdutoModal.estoque_atual || 0))
        : saldosIniciais.estoque_total;

    if (data.controlar_validade === 1 && estoqueParaValidade > 0 && !data.data_validade_inicial) {
        showNotification('Para produtos com controle de validade e estoque, informe a data de validade.', 'warning');
        $('#data_validade_inicial').focus();
        return;
    }

    if (!data.nome) {
        showNotification('Informe o nome do produto.', 'warning');
        $('#nome').focus();
        return;
    }

    if (data.preco_venda <= 0) {
        showNotification('Informe um preço de venda válido.', 'warning');
        $('#preco_venda').focus();
        return;
    }

    if (data.preco_compra < 0) {
        showNotification('Preço de compra inválido.', 'warning');
        $('#preco_compra').focus();
        return;
    }

    if (saldosIniciais.saldo_fiscal_inicial < 0 || saldosIniciais.saldo_nao_fiscal_inicial < 0) {
        showNotification('Saldos iniciais não podem ser negativos.', 'warning');
        $('#saldo_fiscal_inicial').focus();
        return;
    }

    if ($('#saldo_fiscal_inicial').length && saldosIniciais.estoque_total < 0) {
        showNotification('Estoque inicial inválido.', 'warning');
        $('#saldo_fiscal_inicial').focus();
        return;
    }

    if (data.estoque_minimo < 0) {
        showNotification('Estoque mínimo inválido.', 'warning');
        $('#estoque_minimo').focus();
        return;
    }

    const url = id ? `${API_URL}/produtos/${id}` : `${API_URL}/produtos`;
    const method = id ? 'PUT' : 'POST';
    // incluir faixas temporárias (se houver) para salvar junto com o produto
    const faixasTemp = $('#produtoModal').data('faixasTemp');
    if (!id && Array.isArray(faixasTemp) && faixasTemp.length > 0) {
        data.atacado_faixas = faixasTemp;
    }

    if (typeof ProdutoEmbalagensUI !== 'undefined') {
        const precoVendaUnit = parseFloat($('#preco_venda').val()) || 0;
        data.embalagens = ProdutoEmbalagensUI.coletarApresentacoesDoFormulario().map((ap) => ({
            ...ap,
            preco_venda: Number((precoVendaUnit * Number(ap.quantidade || 1)).toFixed(2))
        }));
        if (data.compra_por_embalagem === 1) {
            const temEmbComercial = data.embalagens.some(
                (ap) => String(ap.tipo || 'UN').toUpperCase() !== 'UN'
                    && Number(ap.ativa ?? 1) === 1
                    && Number(ap.compra ?? 0) === 1
                    && Number(ap.quantidade || 0) > 0
            );
            if (!temEmbComercial) {
                showNotification('Ative "Compra por Embalagem" somente após cadastrar ao menos uma embalagem comercial habilitada para compra.', 'warning');
                return;
            }
        }
    }

    $.ajax({
        url: url,
        method: method,
        contentType: 'application/json',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        data: JSON.stringify(data),
        success: function (produtoSalvo) {
            const $modal = $('#produtoModal');
            $modal.data('produtoRecemSalvo', produtoSalvo || null);
            $modal.data('produtoSalvoComSucesso', true);

            const produtoNormalizado = normalizarProduto(produtoSalvo || {}, window.categoriasSistema || []);
            // Completa flags/PLU do formulário (fonte do que acabou de ser salvo)
            if (!produtoNormalizado.plu) {
                produtoNormalizado.plu = String($('#plu').val() || '').replace(/\D/g, '');
            }
            if (Number(produtoNormalizado.produto_fracionado ?? 0) !== 1 && $('#produto_fracionado').is(':checked')) {
                produtoNormalizado.produto_fracionado = 1;
                produtoNormalizado.vendido_por_peso = 1;
            }
            if (produtoNormalizado.ativo == null) {
                produtoNormalizado.ativo = 1;
            }

            const eqPreferido = Number($('#balancaProdutoEquipamento').val() || 0) || null;
            const perguntarBalanca = typeof produtoSalvoElegivelPerguntaBalanca === 'function'
                && produtoSalvoElegivelPerguntaBalanca(produtoNormalizado);
            const origemCadastro = $modal.data('origemCadastroProduto');
            let continuarCadastrando = !id && origemCadastro !== 'COMPRA' && origemCadastro !== 'MIIP';
            if (forcarContinuar) continuarCadastrando = true;
            if (forcarFechar) continuarCadastrando = false;

            const aposFecharCadastro = () => {
                if (perguntarBalanca) {
                    perguntarEnvioBalancaAposSalvar(produtoNormalizado, eqPreferido, () => {
                        if (continuarCadastrando) abrirProximoCadastroProdutoAposSalvar();
                    });
                    return;
                }
                if (continuarCadastrando) abrirProximoCadastroProdutoAposSalvar();
            };

            // RC15.3.1 — sempre fecha o modal (fluxo padrão do ERP)
            const modalEl = document.getElementById('produtoModal');
            if (modalEl && typeof modalEl.addEventListener === 'function') {
                modalEl.addEventListener('hidden.bs.modal', aposFecharCadastro, { once: true });
            }
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                const inst = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
                inst.hide();
            } else {
                $modal.modal('hide');
                if (!modalEl) aposFecharCadastro();
            }

            // Notificações ficam atrás do modal empilhado sobre a MIIP (z-index 22000).
            const notif = document.getElementById('notification-container');
            if (notif) {
                notif.dataset.zIndexAnterior = notif.style.zIndex || '';
                notif.style.zIndex = '23000';
            }
            showNotification('Produto salvo com sucesso!', 'success');
            setTimeout(() => {
                if (notif) {
                    notif.style.zIndex = notif.dataset.zIndexAnterior || '9999';
                    delete notif.dataset.zIndexAnterior;
                }
            }, 3500);

            if (window.CdsCatalogoProdutoSync && typeof CdsCatalogoProdutoSync.publicarProdutoSalvo === 'function') {
                CdsCatalogoProdutoSync.publicarProdutoSalvo(produtoNormalizado);
            }
            if (Array.isArray(window.produtosCache)) {
                const idxCache = window.produtosCache.findIndex((p) => String(p.id) === String(produtoNormalizado.id));
                if (idxCache >= 0) window.produtosCache[idxCache] = produtoNormalizado;
                else window.produtosCache.unshift(produtoNormalizado);
            }

            // Atualiza lista local se necessário
            if (window.produtosList && Array.isArray(window.produtosList)) {
                const indexExistente = window.produtosList.findIndex(p => String(p.id) === String(produtoNormalizado.id));

                if (indexExistente >= 0) {
                    window.produtosList[indexExistente] = produtoNormalizado;
                } else {
                    window.produtosList.unshift(produtoNormalizado);
                }

                if (typeof aplicarAtualizacaoLocalCatalogoProdutos === 'function') {
                    aplicarAtualizacaoLocalCatalogoProdutos(window.produtosList, {
                        motivo: 'save',
                        mesmoComModal: true
                    });
                } else if (typeof renderProdutos === 'function') {
                    renderProdutos(window.produtosList);
                }
            } else if (typeof loadProdutos === 'function') {
                loadProdutos({ forcar: true, suave: true, motivo: 'save-sem-cache' });
            }

        },
        error: function (xhr) {
            const erro = xhr.responseJSON?.error || 'Erro desconhecido';
            const notif = document.getElementById('notification-container');
            if (notif) {
                notif.style.zIndex = '23000';
            }
            showNotification('Erro ao salvar produto: ' + erro, 'danger');
        }
    });
}
window.saveProduto = saveProduto;


// Histórico de preços
function showHistoricoPrecos(produtoId) {
    $.ajax({
        url: `${API_URL}/produtos/${produtoId}/historico-precos`,
        method: 'GET',
        success: function (rows) {
            const modalHtml = `
                <div class="modal fade" id="historicoPrecosModal" tabindex="-1" aria-hidden="true">
                    <div class="modal-dialog modal-lg">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Histórico de preços</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <div class="table-responsive">
                                    <table class="table table-sm table-striped">
                                        <thead>
                                            <tr>
                                                <th>Data</th>
                                                <th>P. compra (de →)</th>
                                                <th>P. venda (de →)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${(rows && rows.length)
                                                ? rows.map(r => `
                                                    <tr>
                                                        <td>${formatDateTime(r.created_at)}</td>
                                                        <td>${formatCurrency(r.preco_compra_anterior || 0)} → ${formatCurrency(r.preco_compra_novo || 0)}</td>
                                                        <td>${formatCurrency(r.preco_venda_anterior || 0)} → ${formatCurrency(r.preco_venda_novo || 0)}</td>
                                                    </tr>
                                                `).join('')
                                                : '<tr><td colspan="3" class="text-center">Nenhuma alteração de preço registrada ainda.</td></tr>'
                                            }
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
            $('#historicoPrecosModal').modal('show');
        },
        error: function () {
            showNotification('Erro ao carregar histórico de preços.', 'danger');
        }
    });
}
window.showHistoricoPrecos = showHistoricoPrecos;


function historicoProduto(produtoId) {
    const token = localStorage.getItem('token') || '';
    const headers = { Authorization: 'Bearer ' + token };
    const modoFiscal = estoqueCadastroSomenteFiscal();

    Promise.all([
        fetch(`${API_URL}/produtos/${produtoId}/historico-estoque`, { headers }).then((r) => (r.ok ? r.json() : [])),
        fetch(`${API_URL}/produtos/${produtoId}/historico-precos`, { headers }).then((r) => (r.ok ? r.json() : [])),
        fetch(`${API_URL}/produtos/${produtoId}?modo_fiscal=${modoFiscalParamGestaoProdutosLocal()}`, { headers }).then((r) => (r.ok ? r.json() : null))
    ])
        .then(([ajustes, precos, produto]) => {
            const nomeProduto = produto?.nome || `Produto #${produtoId}`;

            const linhasAjustes = (ajustes && ajustes.length)
                ? ajustes.map((r) => `
                    <tr>
                        <td>${formatDateTime(r.criado_em)}</td>
                        <td>${escapeHtml(r.usuario_nome || '-')}</td>
                        <td>${escapeHtml(r.motivo || '-')}</td>
                        <td class="text-end">${Number(r.ajuste_fiscal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</td>
                        ${modoFiscal ? '' : `<td class="text-end">${Number(r.ajuste_nao_fiscal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</td>`}
                        <td class="text-end">${Number(r.estoque_total_antes || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} → ${Number(r.estoque_total_depois || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</td>
                    </tr>
                `).join('')
                : `<tr><td colspan="${modoFiscal ? 5 : 6}" class="text-center text-muted">Nenhum ajuste de estoque registrado.</td></tr>`;

            const linhasPrecos = (precos && precos.length)
                ? precos.map((r) => `
                    <tr>
                        <td>${formatDateTime(r.created_at)}</td>
                        <td>${formatCurrency(r.preco_compra_anterior || 0)} → ${formatCurrency(r.preco_compra_novo || 0)}</td>
                        <td>${formatCurrency(r.preco_venda_anterior || 0)} → ${formatCurrency(r.preco_venda_novo || 0)}</td>
                    </tr>
                `).join('')
                : '<tr><td colspan="3" class="text-center text-muted">Nenhuma alteração de preço registrada.</td></tr>';

            const modalHtml = `
                <div class="modal fade" id="historicoProdutoModal" tabindex="-1" aria-hidden="true">
                    <div class="modal-dialog modal-xl modal-dialog-scrollable">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Histórico — ${escapeHtml(nomeProduto)}</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <ul class="nav nav-tabs mb-3" role="tablist">
                                    <li class="nav-item" role="presentation">
                                        <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#hist-ajustes" type="button">Ajustes de Estoque</button>
                                    </li>
                                    <li class="nav-item" role="presentation">
                                        <button class="nav-link" data-bs-toggle="tab" data-bs-target="#hist-precos" type="button">Preços</button>
                                    </li>
                                </ul>
                                <div class="tab-content">
                                    <div class="tab-pane fade show active" id="hist-ajustes">
                                        <div class="table-responsive">
                                            <table class="table table-sm table-striped">
                                                <thead>
                                                    <tr>
                                                        <th>Data</th>
                                                        <th>Usuário</th>
                                                        <th>Motivo</th>
                                                        <th class="text-end">Ajuste Fiscal</th>
                                                        ${modoFiscal ? '' : '<th class="text-end">Ajuste Não Fiscal</th>'}
                                                        <th class="text-end">Total (antes → depois)</th>
                                                    </tr>
                                                </thead>
                                                <tbody>${linhasAjustes}</tbody>
                                            </table>
                                        </div>
                                    </div>
                                    <div class="tab-pane fade" id="hist-precos">
                                        <div class="table-responsive">
                                            <table class="table table-sm table-striped">
                                                <thead>
                                                    <tr>
                                                        <th>Data</th>
                                                        <th>P. compra (de →)</th>
                                                        <th>P. venda (de →)</th>
                                                    </tr>
                                                </thead>
                                                <tbody>${linhasPrecos}</tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            $('#historicoProdutoModal').remove();
            $('#modal-container').append(modalHtml);
            $('#historicoProdutoModal').modal('show');
        })
        .catch(() => {
            showNotification('Erro ao carregar histórico do produto.', 'danger');
        });
}
window.historicoProduto = historicoProduto;


// Excluir produto
function deleteProduto(id) {
    const superAdmin = typeof isSuperAdminUser === 'function' && isSuperAdminUser();
    const mensagem = superAdmin
        ? 'Como Super Administrador, você pode excluir mesmo se o produto tiver vendas, compras ou estoque. Vendas antigas são preservadas, mas o produto sai do cadastro. Continuar?'
        : 'Tem certeza que deseja excluir este produto?';
    if (!confirm(mensagem)) {
        return;
    }

    $.ajax({
        url: `${API_URL}/produtos/${id}`,
        method: 'DELETE',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function () {
            showNotification('Produto excluído com sucesso!', 'success');
            const restante = removerProdutoDoCatalogoLocal(id);
            aplicarAtualizacaoLocalCatalogoProdutos(restante, { motivo: 'delete' });
        },
        error: function (xhr) {
            const erro = xhr.responseJSON?.error || xhr.responseJSON?.erro || 'Erro desconhecido';
            showNotification('Erro ao excluir produto: ' + erro, xhr.status === 409 ? 'warning' : 'danger');
        }
    });
}
window.deleteProduto = deleteProduto;


// Editar produto
function editProduto(id) {
    const modoFiscal = modoFiscalParamGestaoProdutosLocal();
    $.ajax({
        url: `${API_URL}/produtos/${id}?modo_fiscal=${modoFiscal}`,
        method: 'GET',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function (produto) {
            showProdutoModal(produto);
        },
        error: function () {
            showNotification('Erro ao carregar produto para edição.', 'danger');
        }
    });
}
window.editProduto = editProduto;


function abrirModalAjustarEstoque(produtoId) {
    if (!podeAjustarEstoque()) {
        showNotification('Acesso restrito: apenas ADMIN ou SUPER_ADMIN podem ajustar estoque.', 'warning');
        return;
    }

    const modoFiscal = estoqueCadastroSomenteFiscal();

    $.ajax({
        url: `${API_URL}/produtos/${produtoId}?modo_fiscal=${modoFiscalParamGestaoProdutosLocal()}`,
        method: 'GET',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function (produto) {
            const saldoFiscal = Number(produto.saldo_fiscal ?? 0);
            const saldoNaoFiscal = Number(produto.saldo_nao_fiscal ?? 0);
            const estoqueTotal = Number(produto.estoque_atual ?? (saldoFiscal + saldoNaoFiscal));
            const unidade = produto.unidade || '';
            const opcoesFormato = { produtoFracionado: produtoUsaConversaoUnidades(produto) };
            const stepAjuste = obterStepEstoqueProduto(unidade, opcoesFormato.produtoFracionado);
            const controlaValidade = Number(produto.controlar_validade || 0) === 1;

            const camposFiscal = modoFiscal ? `
                <div class="col-md-6 mb-3">
                    <label class="form-label">Saldo Fiscal Atual</label>
                    <input type="text" class="form-control bg-light" readonly value="${formatarEstoqueProduto(saldoFiscal, unidade, opcoesFormato)}">
                </div>
                <div class="col-md-6 mb-3">
                    <label for="ajuste_fiscal" class="form-label">Ajuste Fiscal (+/-)</label>
                    <input type="number" step="${stepAjuste}" class="form-control" id="ajuste_fiscal" value="0">
                </div>
            ` : `
                <div class="col-md-4 mb-3">
                    <label class="form-label">Saldo Fiscal Atual</label>
                    <input type="text" class="form-control bg-light" readonly value="${formatarEstoqueProduto(saldoFiscal, unidade, opcoesFormato)}">
                </div>
                <div class="col-md-4 mb-3">
                    <label class="form-label">Saldo Não Fiscal Atual</label>
                    <input type="text" class="form-control bg-light" readonly value="${formatarEstoqueProduto(saldoNaoFiscal, unidade, opcoesFormato)}">
                </div>
                <div class="col-md-4 mb-3">
                    <label class="form-label">Estoque Total</label>
                    <input type="text" class="form-control bg-light" readonly value="${formatarEstoqueProduto(estoqueTotal, unidade, opcoesFormato)}">
                </div>
                <div class="col-md-6 mb-3">
                    <label for="ajuste_fiscal" class="form-label">Ajuste Fiscal (+/-)</label>
                    <input type="number" step="${stepAjuste}" class="form-control" id="ajuste_fiscal" value="0">
                </div>
                <div class="col-md-6 mb-3">
                    <label for="ajuste_nao_fiscal" class="form-label">Ajuste Não Fiscal (+/-)</label>
                    <input type="number" step="${stepAjuste}" class="form-control" id="ajuste_nao_fiscal" value="0">
                </div>
            `;

            const camposValidade = controlaValidade ? `
                <div class="col-12"><hr class="my-2"><small class="text-muted">Produto com controle de validade — informe validade em ajustes positivos.</small></div>
                <div class="col-md-4 mb-3">
                    <label for="ajuste_lote" class="form-label">Lote</label>
                    <input type="text" class="form-control" id="ajuste_lote" value="">
                </div>
                <div class="col-md-4 mb-3">
                    <label for="ajuste_data_fabricacao" class="form-label">Data Fabricação</label>
                    <input type="date" class="form-control" id="ajuste_data_fabricacao" value="">
                </div>
                <div class="col-md-4 mb-3">
                    <label for="ajuste_data_validade" class="form-label">Data Validade</label>
                    <input type="date" class="form-control" id="ajuste_data_validade" value="">
                </div>
            ` : '';

            const modalHtml = `
                <div class="modal fade" id="ajustarEstoqueModal" tabindex="-1" aria-hidden="true">
                    <div class="modal-dialog">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Ajustar Estoque — ${escapeHtml(produto.nome || '')}</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <form id="ajustarEstoqueForm">
                                    <input type="hidden" id="ajuste_produto_id" value="${produtoId}">
                                    <input type="hidden" id="ajuste_controla_validade" value="${controlaValidade ? 1 : 0}">
                                    <div class="row">
                                        ${camposFiscal}
                                        ${camposValidade}
                                        <div class="col-12 mb-3">
                                            <label for="ajuste_motivo" class="form-label">Motivo *</label>
                                            <textarea class="form-control" id="ajuste_motivo" rows="2" required placeholder="Descreva o motivo do ajuste"></textarea>
                                        </div>
                                    </div>
                                </form>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                                <button type="button" class="btn btn-primary" onclick="salvarAjusteEstoque()">Confirmar Ajuste</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            $('#ajustarEstoqueModal').remove();
            $('#modal-container').append(modalHtml);
            $('#ajustarEstoqueModal').modal('show');
        },
        error: function () {
            showNotification('Erro ao carregar produto para ajuste de estoque.', 'danger');
        }
    });
}
window.abrirModalAjustarEstoque = abrirModalAjustarEstoque;


function salvarAjusteEstoque() {
    const produtoId = $('#ajuste_produto_id').val();
    const motivo = ($('#ajuste_motivo').val() || '').trim();
    const ajusteFiscal = parseFloat($('#ajuste_fiscal').val()) || 0;
    const ajusteNaoFiscal = parseFloat($('#ajuste_nao_fiscal').val()) || 0;
    const controlaValidade = $('#ajuste_controla_validade').val() === '1';
    const modoFiscal = estoqueCadastroSomenteFiscal();

    if (!motivo) {
        showNotification('Informe o motivo do ajuste.', 'warning');
        $('#ajuste_motivo').focus();
        return;
    }

    if (ajusteFiscal === 0 && ajusteNaoFiscal === 0) {
        showNotification('Informe ao menos um ajuste diferente de zero.', 'warning');
        $('#ajuste_fiscal').focus();
        return;
    }

    const ajustePositivo = Math.max(0, ajusteFiscal) + Math.max(0, (modoFiscal ? 0 : ajusteNaoFiscal));
    if (controlaValidade && ajustePositivo > 0 && !($('#ajuste_data_validade').val() || '').trim()) {
        showNotification('Informe a data de validade para ajuste positivo em produto com controle de validade.', 'warning');
        $('#ajuste_data_validade').focus();
        return;
    }

    const payload = {
        ajuste_fiscal: ajusteFiscal,
        ajuste_nao_fiscal: modoFiscal ? 0 : ajusteNaoFiscal,
        motivo
    };

    if (controlaValidade) {
        payload.lote = ($('#ajuste_lote').val() || '').trim() || undefined;
        payload.data_fabricacao = ($('#ajuste_data_fabricacao').val() || '').trim() || undefined;
        payload.data_validade = ($('#ajuste_data_validade').val() || '').trim() || undefined;
    }

    $.ajax({
        url: `${API_URL}/produtos/${produtoId}/ajustar-estoque`,
        method: 'POST',
        contentType: 'application/json',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        data: JSON.stringify(payload),
        success: function () {
            $('#ajustarEstoqueModal').modal('hide');
            showNotification('Estoque ajustado com sucesso!', 'success');
            const modoFiscal = modoFiscalParamGestaoProdutosLocal();
            $.ajax({
                url: `${API_URL}/produtos/${produtoId}?modo_fiscal=${modoFiscal}`,
                method: 'GET',
                success: function (produto) {
                    const lista = atualizarProdutoNoCatalogoLocal(produto);
                    aplicarAtualizacaoLocalCatalogoProdutos(lista, { motivo: 'ajuste' });
                },
                error: function () {
                    loadProdutos({ forcar: true, suave: true, motivo: 'ajuste-fallback' });
                }
            });
        },
        error: function (xhr) {
            const erro = xhr.responseJSON?.error || 'Erro desconhecido';
            showNotification('Erro ao ajustar estoque: ' + erro, 'danger');
        }
    });
}
window.salvarAjusteEstoque = salvarAjusteEstoque;


// Visualizar produto
function viewProduto(id) {
    const modoFiscal = modoFiscalParamGestaoProdutosLocal();

    $.ajax({
        url: `${API_URL}/produtos/${id}?modo_fiscal=${modoFiscal}`,
        method: 'GET',
        headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
        },
        success: function (produto) {
            const produtoNormalizado = normalizarProduto(produto, window.categoriasSistema || []);
            const modalHtml = `
                <div class="modal fade" id="viewProdutoModal" tabindex="-1" aria-hidden="true">
                    <div class="modal-dialog">
                        <div class="modal-content">
                            <div class="modal-header d-flex align-items-center justify-content-between">
                                <h5 class="modal-title">Detalhes do Produto</h5>
                                <div class="d-flex gap-2">
                                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="minimizarModal('viewProdutoModal')" title="Minimizar">
                                        <i class="fas fa-window-minimize"></i>
                                    </button>
                                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                                </div>
                            </div>
                            <div class="modal-body">
                                <p><strong>Nome:</strong> ${escapeHtml(produtoNormalizado.nome || '-')}</p>
                                <p><strong>Código:</strong> ${escapeHtml(produtoNormalizado.codigo || '-')}</p>
                                <p><strong>Categoria:</strong> ${escapeHtml(produtoNormalizado.categoria || '-')}</p>
                                <p><strong>Subcategoria:</strong> ${escapeHtml(produtoNormalizado.subcategoria || '-')}</p>
                                <p><strong>Unidade:</strong> ${escapeHtml(produtoNormalizado.unidade || '-')}</p>
                                <p><strong>Conversão de Unidades:</strong> ${produtoUsaConversaoUnidades(produtoNormalizado) ? 'Sim (venda fracionada)' : 'Não'}</p>
                                <p><strong>Preço de Compra:</strong> ${
                                    produtoUsaConversaoUnidades(produtoNormalizado)
                                        ? `R$ ${formatarCustoUnitarioCadastro(produtoNormalizado.preco_compra, true)} / ${escapeHtml(String(produtoNormalizado.unidade || 'un').toUpperCase())}`
                                        : formatCurrency(produtoNormalizado.preco_compra || 0)
                                }</p>
                                <p><strong>Preço de Venda:</strong> ${formatCurrency(produtoNormalizado.preco_venda || 0)}</p>
                                ${formatarEstoqueDetalheProduto(produto)}
                                <p><strong>Estoque Mínimo:</strong> ${Number(produtoNormalizado.estoque_minimo || 0)}</p>
                                <p><strong>Fornecedor:</strong> ${escapeHtml(produtoNormalizado.fornecedor || '-')}</p>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            $('#modal-container').html(modalHtml);
            $('#viewProdutoModal').modal('show');
        },
        error: function () {
            showNotification('Erro ao carregar detalhes do produto.', 'danger');
        }
    });
}
window.viewProduto = viewProduto;

// ============================================
// FUNÇÕES DE PROMOÇÕES INTELIGENTES
// ============================================

/**
 * Carrega dados do dashboard de promoções (card)
 */
async function carregarDashboardPromocoes() {
    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/dashboard`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            console.error('Erro ao carregar dashboard de promoções');
            return;
        }

        const dados = await response.json();

        // Atualizar elementos do card
        $('#qtdSugestoesProdutos').text(dados.sugestoes_pendentes || 0);
        $('#qtdPromocoesProdutos').text(dados.promocoes_ativas || 0);
    } catch (error) {
        console.error('Erro ao carregar dashboard de promoções:', error);
    }
}

function formatarMoedaPromocao(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

async function carregarEstatisticasPromocoes() {
    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/dashboard`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            console.error('Erro ao carregar estatísticas de promoções');
            return;
        }

        const dados = await response.json();

        $('#statsPromocoesCriadas').text(dados.promocoes_criadas || 0);
        $('#statsProdutosSalvosVencimento').text(dados.produtos_salvos_vencimento || 0);
        $('#statsReceitaGerada').text(`R$ ${formatarMoedaPromocao(dados.receita_gerada || 0)}`);
        $('#statsPerdasEvitadas').text(`R$ ${formatarMoedaPromocao(dados.perdas_evitadas || 0)}`);
    } catch (error) {
        console.error('Erro ao carregar estatísticas de promoções:', error);
    }
}

/**
 * Abre modal com sugestões de promoções
 */
async function abrirModalPromocoesProdutos() {
    // Limpar modal anterior
    $('#modalPromocoesProdutos').remove();

    const modalHtml = `
        <div class="modal fade" id="modalPromocoesProdutos" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Promoções Inteligentes - Sugestões</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <div class="d-flex flex-wrap align-items-end justify-content-between gap-2">
                            <ul class="nav nav-tabs flex-grow-1" id="abas-promocoes" role="tablist">
                                <li class="nav-item" role="presentation">
                                    <button class="nav-link active" id="aba-sugestoes" data-bs-toggle="tab" data-bs-target="#painel-sugestoes" type="button" role="tab" aria-controls="painel-sugestoes" aria-selected="true">
                                        Sugestões
                                    </button>
                                </li>
                                <li class="nav-item" role="presentation">
                                    <button class="nav-link" id="aba-ativas" data-bs-toggle="tab" data-bs-target="#painel-ativas" type="button" role="tab" aria-controls="painel-ativas" aria-selected="false">
                                        Ativas
                                    </button>
                                </li>
                                <li class="nav-item" role="presentation">
                                    <button class="nav-link" id="aba-encerradas" data-bs-toggle="tab" data-bs-target="#painel-encerradas" type="button" role="tab" aria-controls="painel-encerradas" aria-selected="false">
                                        Encerradas
                                    </button>
                                </li>
                                <li class="nav-item" role="presentation">
                                    <button class="nav-link" id="aba-estatisticas" data-bs-toggle="tab" data-bs-target="#painel-estatisticas" type="button" role="tab" aria-controls="painel-estatisticas" aria-selected="false">
                                        Estatísticas
                                    </button>
                                </li>
                            </ul>
                            <div class="input-group input-group-sm mb-1" id="busca-promocoes-wrap" style="max-width: 280px; min-width: 200px;">
                                <span class="input-group-text"><i class="fas fa-search" aria-hidden="true"></i></span>
                                <input
                                    type="search"
                                    class="form-control"
                                    id="buscaPromocoesInteligentes"
                                    placeholder="Buscar produto..."
                                    aria-label="Buscar produto nas promoções"
                                    autocomplete="off"
                                >
                                <button type="button" class="btn btn-outline-secondary" id="btnLimparBuscaPromocoes" title="Limpar busca" aria-label="Limpar busca">
                                    <i class="fas fa-times" aria-hidden="true"></i>
                                </button>
                            </div>
                        </div>

                        <div class="tab-content mt-3" id="conteudo-abas-promocoes">
                            <!-- ABA SUGESTÕES -->
                            <div class="tab-pane fade show active" id="painel-sugestoes" role="tabpanel" aria-labelledby="aba-sugestoes">
                                <div id="lista-sugestoes" class="spinner-wrapper">
                                    <div class="text-center">
                                        <div class="spinner-border spinner-border-sm text-primary"></div>
                                        <p class="text-muted mt-2">Carregando sugestões...</p>
                                    </div>
                                </div>
                            </div>

                            <!-- ABA ATIVAS -->
                            <div class="tab-pane fade" id="painel-ativas" role="tabpanel" aria-labelledby="aba-ativas">
                                <div id="lista-promocoes-ativas" class="spinner-wrapper">
                                    <div class="text-center">
                                        <div class="spinner-border spinner-border-sm text-primary"></div>
                                        <p class="text-muted mt-2">Carregando promoções ativas...</p>
                                    </div>
                                </div>
                            </div>

                            <!-- ABA ENCERRADAS -->
                            <div class="tab-pane fade" id="painel-encerradas" role="tabpanel" aria-labelledby="aba-encerradas">
                                <div id="lista-promocoes-encerradas" class="spinner-wrapper">
                                    <div class="text-center">
                                        <div class="spinner-border spinner-border-sm text-primary"></div>
                                        <p class="text-muted mt-2">Carregando promoções encerradas...</p>
                                    </div>
                                </div>
                            </div>

                            <!-- ABA ESTATÍSTICAS -->
                            <div class="tab-pane fade" id="painel-estatisticas" role="tabpanel" aria-labelledby="aba-estatisticas">
                                <div class="row g-3">
                                    <div class="col-12 col-md-6 col-xl-3">
                                        <div class="card h-100 border-secondary border-1 shadow-sm">
                                            <div class="card-body py-3 px-3 text-center">
                                                <p class="text-uppercase text-muted small mb-2">Promoções criadas</p>
                                                <p class="h5 fw-bold mb-0" id="statsPromocoesCriadas">0</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-12 col-md-6 col-xl-3">
                                        <div class="card h-100 border-secondary border-1 shadow-sm">
                                            <div class="card-body py-3 px-3 text-center">
                                                <p class="text-uppercase text-muted small mb-2">Produtos salvos do vencimento</p>
                                                <p class="h5 fw-bold mb-0" id="statsProdutosSalvosVencimento">0</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-12 col-md-6 col-xl-3">
                                        <div class="card h-100 border-secondary border-1 shadow-sm">
                                            <div class="card-body py-3 px-3 text-center">
                                                <p class="text-uppercase text-muted small mb-2">Receita gerada por promoções</p>
                                                <p class="h5 fw-bold mb-0" id="statsReceitaGerada">R$ 0,00</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-12 col-md-6 col-xl-3">
                                        <div class="card h-100 border-secondary border-1 shadow-sm">
                                            <div class="card-body py-3 px-3 text-center">
                                                <p class="text-uppercase text-muted small mb-2">Perdas evitadas</p>
                                                <p class="h5 fw-bold mb-0" id="statsPerdasEvitadas">R$ 0,00</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="modal-footer">
                        <button type="button" class="btn btn-warning" onclick="verificarPromocoeExpiradas()">
                            <i class="fas fa-exclamation-triangle"></i> Verificar Expiradas
                        </button>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                        <button type="button" class="btn btn-primary" onclick="abrirModalGerarSugestoesAvancado()">
                            <i class="fas fa-magic"></i> Gerar Sugestões
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Adicionar modal ao DOM
    if (!$('#modal-container').length) {
        $('body').append('<div id="modal-container"></div>');
    }
    $('#modal-container').html(modalHtml);

    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('modalPromocoesProdutos'));
    modal.show();

    configurarBuscaPromocoesInteligentes();

    // Carregar dados das três abas e as estatísticas da promoção inteligente
    carregarEstatisticasPromocoes();
    carregarSugestoesPromocoes(true);
    carregarPromocoes('ativas');
    carregarPromocoes('encerradas');
}

/**
 * Configura busca por produto nas abas Sugestões / Ativas / Encerradas.
 */
function configurarBuscaPromocoesInteligentes() {
    const input = document.getElementById('buscaPromocoesInteligentes');
    const btnLimpar = document.getElementById('btnLimparBuscaPromocoes');
    const wrap = document.getElementById('busca-promocoes-wrap');
    if (!input || !wrap) return;

    const aplicar = () => filtrarListasPromocoesInteligentes(input.value);

    input.addEventListener('input', aplicar);
    if (btnLimpar) {
        btnLimpar.addEventListener('click', () => {
            input.value = '';
            aplicar();
            input.focus();
        });
    }

    const abas = document.getElementById('abas-promocoes');
    if (abas) {
        abas.addEventListener('shown.bs.tab', (ev) => {
            const alvo = ev.target?.getAttribute('data-bs-target') || '';
            const esconder = alvo === '#painel-estatisticas';
            wrap.classList.toggle('d-none', esconder);
            if (!esconder) aplicar();
        });
    }
}

/**
 * Filtra as tabelas de promoções pelo termo digitado (nome do produto / texto da linha).
 */
function filtrarListasPromocoesInteligentes(termo) {
    const query = String(termo || '').trim().toLowerCase();
    const paineis = ['#lista-sugestoes', '#lista-promocoes-ativas', '#lista-promocoes-encerradas'];

    paineis.forEach((seletor) => {
        const container = document.querySelector(seletor);
        if (!container) return;

        const rows = container.querySelectorAll('table tbody tr');
        if (!rows.length) {
            const vazioBusca = container.querySelector('.alerta-busca-promocoes-vazia');
            if (vazioBusca) vazioBusca.remove();
            return;
        }

        let visiveis = 0;
        rows.forEach((tr) => {
            const texto = (tr.textContent || '').toLowerCase();
            const match = !query || texto.includes(query);
            tr.style.display = match ? '' : 'none';
            if (match) visiveis += 1;
        });

        let alerta = container.querySelector('.alerta-busca-promocoes-vazia');
        if (query && visiveis === 0) {
            if (!alerta) {
                alerta = document.createElement('div');
                alerta.className = 'alert alert-secondary mt-2 mb-0 alerta-busca-promocoes-vazia';
                alerta.innerHTML = '<i class="fas fa-search"></i> Nenhum produto encontrado para esta busca.';
                container.appendChild(alerta);
            }
        } else if (alerta) {
            alerta.remove();
        }
    });
}

window.filtrarListasPromocoesInteligentes = filtrarListasPromocoesInteligentes;

window.abrirModalPromocoesProdutos = abrirModalPromocoesProdutos;

/**
 * Abre modal avançado para gerar sugestões com seleção de produtos e desconto customizável
 */
async function abrirModalGerarSugestoesAvancado() {
    // Limpar modal anterior
    $('#modalGerarSugestoesAvancado').remove();

    const modalHtml = `
        <div class="modal fade" id="modalGerarSugestoesAvancado" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <i class="fas fa-cog"></i> Gerar Sugestões de Promoções
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <!-- Seção de Desconto -->
                        <div class="mb-4">
                            <label for="descontoPercentual" class="form-label">
                                <strong>Desconto Percentual (%)</strong>
                            </label>
                            <div class="input-group">
                                <input type="number" class="form-control" id="descontoPercentual" 
                                    value="15" min="1" max="100" step="0.5">
                                <span class="input-group-text">%</span>
                            </div>
                            <small class="form-text text-muted">Deixe em branco para usar o desconto padrão (15%)</small>
                        </div>

                        <!-- Seção de Seleção de Produtos -->
                        <div class="mb-3">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <label class="form-label mb-0">
                                    <strong>Selecionar Produtos</strong>
                                </label>
                                <div>
                                    <button type="button" class="btn btn-sm btn-outline-secondary" onclick="selecionarTodosProdutosAvancado()">
                                        Selecionar Todos
                                    </button>
                                    <button type="button" class="btn btn-sm btn-outline-secondary" onclick="desseleccionarTodosProdutosAvancado()">
                                        Desselecionar Todos
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Lista de Produtos com Checkboxes -->
                        <div id="listaProdutosAvancado" class="border rounded p-3" style="max-height: 300px; overflow-y: auto;">
                            <div class="text-center">
                                <div class="spinner-border spinner-border-sm text-primary"></div>
                                <p class="text-muted mt-2">Carregando produtos...</p>
                            </div>
                        </div>

                        <small class="form-text text-muted d-block mt-2">
                            <strong id="qtdProdutosSelecionados">0</strong> produtos selecionados.
                            Elegíveis por validade (até 7 dias) ou giro baixo (15+ dias sem venda).
                        </small>
                    </div>

                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="gerarSugestoesAvancado()">
                            <i class="fas fa-check-circle"></i> Gerar Sugestões
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Adicionar modal ao DOM
    if (!$('#modal-container-avancado').length) {
        $('body').append('<div id="modal-container-avancado"></div>');
    }
    $('#modal-container-avancado').html(modalHtml);

    // Fechar modal de sugestões anterior, se estiver aberto
    const modalSugestoesEl = document.getElementById('modalPromocoesProdutos');
    if (modalSugestoesEl) {
        const modalSugestoes = bootstrap.Modal.getInstance(modalSugestoesEl) || new bootstrap.Modal(modalSugestoesEl);
        modalSugestoes.hide();
    }

    // Mostrar modal avançado
    const modal = new bootstrap.Modal(document.getElementById('modalGerarSugestoesAvancado'));
    modal.show();

    // Carregar produtos elegíveis para promoção (validade + giro)
    await carregarProdutosElegiveisPromocao();
}

window.abrirModalGerarSugestoesAvancado = abrirModalGerarSugestoesAvancado;

function montarDetalheProdutoElegivel(produto) {
    if (Number(produto.controlar_validade) === 1 && Number.isFinite(Number(produto.dias_para_vencer))) {
        const dias = Number(produto.dias_para_vencer);
        if (dias < 0) {
            return `Validade: venceu há ${Math.abs(dias)} dia(s)`;
        }
        if (dias === 0) {
            return 'Validade: vence hoje';
        }
        return `Validade: ${dias} dia(s) para vencer`;
    }

    if (Number.isFinite(Number(produto.dias_sem_venda))) {
        return `Sem venda há ${produto.dias_sem_venda} dia(s)`;
    }

    if (String(produto.motivo || '').includes('Nunca Vendeu')) {
        return 'Nunca vendido';
    }

    return 'Elegível para promoção';
}

/**
 * Carrega produtos elegíveis para sugestão (validade ou giro baixo)
 */
async function carregarProdutosElegiveisPromocao() {
    const container = $('#listaProdutosAvancado');

    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/produtos-elegiveis`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao carregar produtos elegíveis');
        }

        const produtosElegiveis = await response.json();

        if (!produtosElegiveis || produtosElegiveis.length === 0) {
            container.html(`
                <div class="alert alert-info">
                    <i class="fas fa-info-circle"></i> Nenhum produto elegível no momento.
                    Produtos entram aqui por validade próxima/vencida ou por giro baixo (15+ dias sem venda).
                </div>
            `);
            return;
        }

        let html = '<div class="list-group">';

        produtosElegiveis.forEach(p => {
            const detalhe = montarDetalheProdutoElegivel(p);

            html += `
                <label class="list-group-item">
                    <div class="d-flex align-items-center">
                        <input type="checkbox" class="form-check-input me-3 checkbox-produto-avancado" 
                            value="${p.id}" data-nome="${escapeHtml(p.nome)}" data-preco="${p.preco_venda}">
                        <div class="flex-grow-1">
                            <div class="d-flex justify-content-between align-items-start gap-2">
                                <strong>${escapeHtml(p.nome)}</strong>
                                ${formatarBadgeMotivoSugestao(p.motivo)}
                            </div>
                            <small class="text-muted">
                                ${escapeHtml(detalhe)} |
                                Estoque: ${formatarEstoqueExibicaoTela(p)} |
                                Preço: ${formatCurrency(p.preco_venda || 0)}
                            </small>
                        </div>
                    </div>
                </label>
            `;
        });

        html += '</div>';
        container.html(html);

        $('.checkbox-produto-avancado').on('change', atualizarContadorProdutosSelecionados);
        atualizarContadorProdutosSelecionados();
    } catch (error) {
        console.error('Erro ao carregar produtos elegíveis:', error);
        container.html(`
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-circle"></i> Erro ao carregar produtos elegíveis.
            </div>
        `);
    }
}

window.carregarProdutosElegiveisPromocao = carregarProdutosElegiveisPromocao;

/** @deprecated Use carregarProdutosElegiveisPromocao */
async function carregarProdutosComValidade() {
    return carregarProdutosElegiveisPromocao();
}

window.carregarProdutosComValidade = carregarProdutosComValidade;

/**
 * Atualiza contador de produtos selecionados
 */
function atualizarContadorProdutosSelecionados() {
    const qtd = $('.checkbox-produto-avancado:checked').length;
    $('#qtdProdutosSelecionados').text(qtd);
}

/**
 * Seleciona todos os produtos
 */
function selecionarTodosProdutosAvancado() {
    $('.checkbox-produto-avancado').prop('checked', true);
    atualizarContadorProdutosSelecionados();
}

window.selecionarTodosProdutosAvancado = selecionarTodosProdutosAvancado;

/**
 * Desseleciona todos os produtos
 */
function desseleccionarTodosProdutosAvancado() {
    $('.checkbox-produto-avancado').prop('checked', false);
    atualizarContadorProdutosSelecionados();
}

window.desseleccionarTodosProdutosAvancado = desseleccionarTodosProdutosAvancado;

/**
 * Gera sugestões com opções avançadas (múltiplos produtos e desconto customizável)
 */
async function gerarSugestoesAvancado() {
    // Obter produtos selecionados
    const produtosSelecionados = $('.checkbox-produto-avancado:checked').map(function() {
        return parseInt($(this).val());
    }).get();

    if (produtosSelecionados.length === 0) {
        showNotification('Selecione pelo menos um produto', 'warning');
        return;
    }

    // Obter desconto percentual
    const desconto = parseFloat($('#descontoPercentual').val()) || 15;

    if (desconto <= 0 || desconto > 100) {
        showNotification('Desconto deve estar entre 1% e 100%', 'warning');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/gerar-sugestoes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({
                produto_ids: produtosSelecionados,
                desconto_percentual: desconto
            })
        });

        if (!response.ok) {
            throw new Error('Erro ao gerar sugestões');
        }

        const resultado = await response.json();
        showNotification(
            resultado.message || `${resultado.total} sugestão(ões) gerada(s).`,
            resultado.total > 0 ? 'success' : 'info'
        );
        
        // Fechar modal
        bootstrap.Modal.getInstance(document.getElementById('modalGerarSugestoesAvancado')).hide();

        // Recarregar dados
        carregarSugestoesPromocoes();
        carregarDashboardPromocoes();
    } catch (error) {
        console.error('Erro ao gerar sugestões:', error);
        showNotification('Erro ao gerar sugestões', 'danger');
    }
}

window.gerarSugestoesAvancado = gerarSugestoesAvancado;

function formatarBadgeMotivoSugestao(motivo) {
    const texto = String(motivo || '-');
    let badgeClass = 'bg-secondary';

    if (texto.startsWith('🔴')) badgeClass = 'bg-danger';
    else if (texto.startsWith('🟠')) badgeClass = 'bg-warning text-dark';
    else if (texto.startsWith('🟡')) badgeClass = 'bg-warning text-dark';
    else if (texto.startsWith('⚫')) badgeClass = 'bg-dark';

    return `<span class="badge ${badgeClass}">${escapeHtml(texto)}</span>`;
}

function ehMotivoValidade(motivo) {
    const texto = String(motivo || '');
    return texto.includes('Vence') || texto.includes('Vencido') || texto === 'vencimento_proximo';
}

function formatarInfoValidadeSugestao(sugestao) {
    const dias = Number(sugestao.dias_para_vencer);

    if (!Number.isFinite(dias)) return '';

    if (dias < 0) {
        return `<br><small class="text-muted">Venceu há ${Math.abs(dias)} dia(s)</small>`;
    }

    if (dias === 0) {
        return '<br><small class="text-muted">Vence hoje</small>';
    }

    return `<br><small class="text-muted">${dias} dia(s) para vencer</small>`;
}

function formatarInfoSugestao(sugestao) {
    if (ehMotivoValidade(sugestao.motivo)) {
        return formatarInfoValidadeSugestao(sugestao);
    }

    const diasSemVenda = Number(sugestao.dias_sem_venda);
    if (Number.isFinite(diasSemVenda)) {
        return `<br><small class="text-muted">Sem venda há ${diasSemVenda} dia(s)</small>`;
    }

    if (String(sugestao.motivo || '').includes('Nunca Vendeu')) {
        return '<br><small class="text-muted">Nunca vendido</small>';
    }

    return '';
}

/**
 * Carrega sugestões de promoções
 */
async function carregarSugestoesPromocoes(autoGerar = false) {
    const container = $('#lista-sugestoes');
    container.html('<div class="text-center"><div class="spinner-border spinner-border-sm text-primary"></div></div>');

    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/sugestoes`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao carregar sugestões');
        }

        const sugestoes = await response.json();

        if (!sugestoes || sugestoes.length === 0) {
            if (autoGerar) {
                const resultado = await gerarSugestoesPromocoes({ silent: true });
                if (resultado?.total > 0) {
                    return carregarSugestoesPromocoes(false);
                }
            }

            container.html(`
                <div class="alert alert-info">
                    <i class="fas fa-info-circle"></i> Nenhuma sugestão de promoção disponível no momento.
                </div>
            `);
            return;
        }

        let html = '<div class="table-responsive"><table class="table table-striped table-hover">';
        html += `
            <thead>
                <tr>
                    <th>Produto</th>
                    <th>Motivo</th>
                    <th>${tituloColunaEstoqueLista()}</th>
                    <th>Preço Atual</th>
                    <th>Desconto Sugerido</th>
                    <th>Preço Promocional</th>
                    <th>Ações</th>
                </tr>
            </thead>
            <tbody>
        `;

        sugestoes.forEach(s => {
            const desconto = Number(s.desconto_percentual || 0).toFixed(2);
            const diasInfo = formatarInfoSugestao(s);
            html += `
                <tr>
                    <td>
                        <strong>${escapeHtml(s.nome_produto || '-')}</strong>
                        ${diasInfo}
                    </td>
                    <td>${formatarBadgeMotivoSugestao(s.motivo)}</td>
                    <td>${escapeHtml(formatarEstoqueExibicaoTela(s))}</td>
                    <td>${formatCurrency(s.preco_atual || 0)}</td>
                    <td><span class="badge bg-danger">${desconto}%</span></td>
                    <td>${formatCurrency(s.preco_sugerido || 0)}</td>
                    <td>
                        <button class="btn btn-sm btn-success" onclick="aceitarSugestaoPromocao(${s.id})" title="Editar desconto e criar promoção">
                            <i class="fas fa-check"></i> Aceitar
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="rejeitarSugestaoPromocao(${s.id})" title="Descartar sugestão">
                            <i class="fas fa-times"></i> Rejeitar
                        </button>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        container.html(html);
        const termoBusca = document.getElementById('buscaPromocoesInteligentes')?.value || '';
        if (termoBusca) filtrarListasPromocoesInteligentes(termoBusca);
    } catch (error) {
        console.error('Erro ao carregar sugestões:', error);
        container.html(`
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-circle"></i> Erro ao carregar sugestões.
            </div>
        `);
    }
}

/**
 * Carrega promoções (ativas ou encerradas)
 */
async function carregarPromocoes(tipo) {
    const container = tipo === 'ativas' 
        ? $('#lista-promocoes-ativas') 
        : $('#lista-promocoes-encerradas');

    container.html('<div class="text-center"><div class="spinner-border spinner-border-sm text-primary"></div></div>');

    try {
        const response = await fetch(`${API_URL}/produtos/promocoes?status=${tipo}`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao carregar promoções');
        }

        const promocoes = await response.json();

        if (!promocoes || promocoes.length === 0) {
            const mensagem = tipo === 'ativas' 
                ? 'Nenhuma promoção ativa no momento.'
                : 'Nenhuma promoção encerrada.';
            container.html(`
                <div class="alert alert-info">
                    <i class="fas fa-info-circle"></i> ${mensagem}
                </div>
            `);
            return;
        }

        let html = '<div class="table-responsive"><table class="table table-striped table-hover">';
        html += `
            <thead>
                <tr>
                    <th>Produto</th>
                    <th>Preço Original</th>
                    <th>Preço Promocional</th>
                    <th>Desconto</th>
                    <th>Período</th>
                    <th>Status</th>
                    ${tipo === 'ativas' ? '<th>Ações</th>' : ''}
                </tr>
            </thead>
            <tbody>
        `;

        promocoes.forEach(p => {
            const desconto = Number(p.desconto_percentual || 0).toFixed(2);
            const dataInicio = new Date(p.data_inicio).toLocaleDateString('pt-BR');
            const dataFim = new Date(p.data_fim).toLocaleDateString('pt-BR');
            
            // Calcular status real
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            const fimDate = new Date(p.data_fim);
            fimDate.setHours(0, 0, 0, 0);
            const inicioDate = new Date(p.data_inicio);
            inicioDate.setHours(0, 0, 0, 0);
            
            let statusReal = p.status;
            let badgeClass = 'bg-secondary';
            
            if (p.status === 'ativa') {
                if (fimDate < hoje) {
                    statusReal = '⚠️ EXPIRADA';
                    badgeClass = 'bg-danger';
                } else if (inicioDate > hoje) {
                    statusReal = '🕐 NÃO INICIADA';
                    badgeClass = 'bg-warning text-dark';
                } else {
                    statusReal = '✅ VIGENTE';
                    badgeClass = 'bg-success';
                }
            } else if (p.status === 'encerrada') {
                statusReal = '❌ ENCERRADA';
                badgeClass = 'bg-secondary';
            }

            html += `
                <tr>
                    <td><strong>${escapeHtml(p.nome_produto || '-')}</strong></td>
                    <td>${formatCurrency(p.preco_original || 0)}</td>
                    <td>${formatCurrency(p.preco_promocional || 0)}</td>
                    <td>${desconto}%</td>
                    <td>${dataInicio} até ${dataFim}</td>
                    <td><span class="badge ${badgeClass}">${statusReal}</span></td>
                    ${tipo === 'ativas' ? `
                        <td>
                            <button class="btn btn-sm btn-danger" onclick="encerrarPromocao(${p.id})">
                                <i class="fas fa-stop-circle"></i> Encerrar
                            </button>
                        </td>
                    ` : ''}
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        container.html(html);
        const termoBusca = document.getElementById('buscaPromocoesInteligentes')?.value || '';
        if (termoBusca) filtrarListasPromocoesInteligentes(termoBusca);
    } catch (error) {
        console.error('Erro ao carregar promoções:', error);
        container.html(`
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-circle"></i> Erro ao carregar promoções.
            </div>
        `);
    }
}

/**
 * Aceita sugestão de promoção - abre modal para editar desconto
 */
async function aceitarSugestaoPromocao(sugestaoId) {
    try {
        // Buscar dados da sugestão
        const response = await fetch(`${API_URL}/produtos/promocoes/sugestoes`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao carregar sugestões');
        }

        const sugestoes = await response.json();
        const sugestao = sugestoes.find(s => s.id === sugestaoId);

        if (!sugestao) {
            throw new Error('Sugestão não encontrada');
        }

        // Abrir modal para confirmar e editar desconto
        abrirModalConfirmarSugestao(sugestao);
    } catch (error) {
        console.error('Erro ao aceitar sugestão:', error);
        showNotification('Erro ao aceitar sugestão', 'danger');
    }
}

/**
 * Abre modal para confirmar sugestão e editar desconto
 */
async function abrirModalConfirmarSugestao(sugestao) {
    const hoje = new Date().toISOString().split('T')[0];
    const amanhaDate = new Date();
    amanhaDate.setDate(amanhaDate.getDate() + 1);
    const amanha = amanhaDate.toISOString().split('T')[0];

    const modalHtml = `
        <div class="modal fade" id="modalConfirmarSugestao" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <i class="fas fa-check-circle text-success"></i> Confirmar Promoção
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label class="form-label"><strong>Produto</strong></label>
                                <p class="form-control-static">${escapeHtml(sugestao.nome_produto || '')}</p>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label"><strong>Motivo</strong></label>
                                <p class="form-control-static">
                                    <span class="badge bg-info">${sugestao.motivo.replace(/_/g, ' ')}</span>
                                </p>
                            </div>
                        </div>

                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label class="form-label"><strong>Preço Atual</strong></label>
                                <p class="form-control-static">${formatCurrency(sugestao.preco_atual || 0)}</p>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label"><strong>Estoque Disponível</strong></label>
                                <p class="form-control-static">${escapeHtml(formatarEstoqueExibicaoTela(sugestao))}</p>
                            </div>
                        </div>

                        <hr>

                        <div class="row mb-3">
                            <div class="col-md-4">
                                <label for="descontoConfirmar" class="form-label">
                                    <strong>Desconto (%)</strong>
                                </label>
                                <div class="input-group">
                                    <input type="number" class="form-control" id="descontoConfirmar" 
                                        value="${Number(sugestao.desconto_percentual || 15).toFixed(2)}" 
                                        min="1" max="100" step="0.5">
                                    <span class="input-group-text">%</span>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label"><strong>Preço Promocional</strong></label>
                                <p class="form-control-static" id="precoPromocionalDisplay">
                                    ${formatCurrency(sugestao.preco_sugerido || 0)}
                                </p>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label"><strong>Economia</strong></label>
                                <p class="form-control-static text-success" id="economiaDisplay">
                                    ${formatCurrency((sugestao.preco_atual - sugestao.preco_sugerido) || 0)}
                                </p>
                            </div>
                        </div>

                        <hr>

                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label for="dataInicioConfirmar" class="form-label"><strong>Data Início</strong></label>
                                <input type="date" class="form-control" id="dataInicioConfirmar" value="${hoje}">
                            </div>
                            <div class="col-md-6">
                                <label for="dataFimConfirmar" class="form-label"><strong>Data Fim</strong></label>
                                <input type="date" class="form-control" id="dataFimConfirmar" value="${amanha}">
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-success" onclick="confirmarSugestaoPromocao(${sugestao.id}, ${sugestao.produto_id}, ${sugestao.preco_atual})">
                            <i class="fas fa-check"></i> Criar Promoção
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (!$('#modal-container-sugestao').length) {
        $('body').append('<div id="modal-container-sugestao"></div>');
    }
    $('#modal-container-sugestao').html(modalHtml);

    const modal = new bootstrap.Modal(document.getElementById('modalConfirmarSugestao'));
    modal.show();

    // Atualizar preço promocional ao mudar desconto
    const precoAtualValue = sugestao.preco_atual || 0;
    $('#descontoConfirmar').on('change', function() {
        const desconto = parseFloat($(this).val()) || 0;
        const precoPromocional = (precoAtualValue * (1 - desconto / 100)).toFixed(2);
        const economia = (precoAtualValue - precoPromocional).toFixed(2);
        
        $('#precoPromocionalDisplay').text(formatCurrency(precoPromocional));
        $('#economiaDisplay').text(formatCurrency(economia));
    });
}

/**
 * Confirma e cria a promoção
 */
async function confirmarSugestaoPromocao(sugestaoId, produtoId, precoOriginal) {
    try {
        const desconto = parseFloat($('#descontoConfirmar').val()) || 15;
        const dataInicio = $('#dataInicioConfirmar').val();
        const dataFim = $('#dataFimConfirmar').val();

        if (!dataInicio || !dataFim) {
            showNotification('Preencha as datas de início e fim', 'warning');
            return;
        }

        if (new Date(dataInicio) > new Date(dataFim)) {
            showNotification('Data de fim não pode ser anterior à data de início', 'warning');
            return;
        }

        // Calcular preço promocional
        const precoPromocional = (precoOriginal * (1 - desconto / 100)).toFixed(2);

        // Criar promoção
        const responsePromocao = await fetch(`${API_URL}/produtos/promocoes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({
                produto_id: produtoId,
                preco_original: precoOriginal,
                preco_promocional: precoPromocional,
                data_inicio: dataInicio,
                data_fim: dataFim
            })
        });

        if (!responsePromocao.ok) {
            throw new Error('Erro ao criar promoção');
        }

        const resultadoPromocao = await responsePromocao.json();

        // Marcar sugestão como aceita
        const responseSugestao = await fetch(`${API_URL}/produtos/promocoes/sugestoes/${sugestaoId}/processar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({ acao: 'aceitar' })
        });

        if (!responseSugestao.ok) {
            console.warn('Sugestão não foi marcada como aceita, mas a promoção foi criada');
        }

        showNotification('Promoção criada e ativada com sucesso!', 'success');
        
        // Fechar modal
        bootstrap.Modal.getInstance(document.getElementById('modalConfirmarSugestao')).hide();
        
        // Recarregar dados
        carregarSugestoesPromocoes();
        carregarPromocoes('ativas');
        carregarDashboardPromocoes();
    } catch (error) {
        console.error('Erro ao confirmar sugestão:', error);
        showNotification('Erro ao criar promoção', 'danger');
    }
}

window.aceitarSugestaoPromocao = aceitarSugestaoPromocao;
window.confirmarSugestaoPromocao = confirmarSugestaoPromocao;

/**
 * Rejeita sugestão de promoção
 */
async function rejeitarSugestaoPromocao(sugestaoId) {
    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/sugestoes/${sugestaoId}/processar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({ acao: 'rejeitar' })
        });

        if (!response.ok) {
            throw new Error('Erro ao rejeitar sugestão');
        }

        showNotification('Sugestão rejeitada!', 'info');
        carregarSugestoesPromocoes();
    } catch (error) {
        console.error('Erro ao rejeitar sugestão:', error);
        showNotification('Erro ao rejeitar sugestão', 'danger');
    }
}

window.rejeitarSugestaoPromocao = rejeitarSugestaoPromocao;

/**
 * Encerra promoção ativa
 */
async function encerrarPromocao(promocaoId) {
    if (!confirm('Tem certeza que deseja encerrar esta promoção?')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/${promocaoId}/encerrar`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({ motivo_encerramento: 'Encerrada pelo usuário' })
        });

        if (!response.ok) {
            throw new Error('Erro ao encerrar promoção');
        }

        showNotification('Promoção encerrada com sucesso!', 'success');
        carregarPromocoes('ativas');
        carregarPromocoes('encerradas');
        carregarDashboardPromocoes();
    } catch (error) {
        console.error('Erro ao encerrar promoção:', error);
        showNotification('Erro ao encerrar promoção', 'danger');
    }
}

window.encerrarPromocao = encerrarPromocao;

/**
 * Verifica e encerra promoções expiradas manualmente
 */
async function verificarPromocoeExpiradas() {
    try {
        const response = await fetch(`${API_URL}/produtos/verificar-expiradas-agora`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao verificar promoções expiradas');
        }

        const resultado = await response.json();
        
        showNotification(resultado.message, 'success');
        
        // Recarregar as listas de promoções
        carregarPromocoes('ativas');
        carregarPromocoes('encerradas');
        carregarDashboardPromocoes();
        carregarEstatisticasPromocoes();
        
    } catch (error) {
        console.error('Erro ao verificar promoções expiradas:', error);
        showNotification('Erro ao verificar promoções expiradas', 'danger');
    }
}

window.verificarPromocoeExpiradas = verificarPromocoeExpiradas;
/**
 * Gera sugestões automáticas (versão simples - sem parâmetros)
 * @deprecated Use gerarSugestoesAvancado() em vez disso
 */
async function gerarSugestoesPromocoes(options = { silent: false }) {
    try {
        const response = await fetch(`${API_URL}/produtos/promocoes/gerar-sugestoes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            },
            body: JSON.stringify({
                produto_ids: [],
                desconto_percentual: 15
            })
        });

        if (!response.ok) {
            throw new Error('Erro ao gerar sugestões');
        }

        const resultado = await response.json();
        if (!options.silent) {
            showNotification(resultado.message || `${resultado.total} sugestão(ões) gerada(s).`, resultado.total > 0 ? 'success' : 'info');
        }

        if (!options.silent) {
            carregarSugestoesPromocoes();
        }
        carregarDashboardPromocoes();

        return resultado;
    } catch (error) {
        console.error('Erro ao gerar sugestões:', error);
        if (!options.silent) {
            showNotification('Erro ao gerar sugestões', 'danger');
        }
        return null;
    }
}

window.gerarSugestoesPromocoes = gerarSugestoesPromocoes;

window.viewProduto = viewProduto;


// Escape HTML
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatarNumeroEstoqueProduto(numero, maxCasas = 3) {
    const qtd = Number(numero || 0);
    const factor = Math.pow(10, maxCasas);
    const arredondado = Math.round(qtd * factor) / factor;
    return String(parseFloat(arredondado.toFixed(maxCasas))).replace('.', ',');
}

function formatarEstoqueProduto(valor, unidade = '', opcoes = {}) {
    const numero = Number(valor || 0);
    const unidadeNorm = String(unidade || 'un').toLowerCase();
    const label = String(unidade || 'UN').toUpperCase();
    const fracionado = Boolean(opcoes.produtoFracionado);
    const usaDecimais = fracionado || unidadeVendaSuportaConversao(unidadeNorm);

    if (usaDecimais) {
        return `${formatarNumeroEstoqueProduto(numero, 3)} ${label}`;
    }

    return `${Math.round(numero)} ${label}`;
}

function montarTabelaEstoqueResumo(lista, classeLinha) {
  if (!lista.length) return '';

  return `
    <table class="table table-sm table-hover mb-0">
      <thead>
        <tr>
          <th>Produto</th>
          <th>Código</th>
          <th class="text-end">Estoque</th>
          <th class="text-end">Mínimo</th>
        </tr>
      </thead>
      <tbody>
        ${lista.map((p) => `
          <tr class="${classeLinha}">
            <td class="fw-semibold">${escapeHtml(p.nome || '')}</td>
            <td>${escapeHtml(p.codigo || '-')}</td>
            <td class="text-end fw-bold">${formatarColunaEstoqueLista(p)}</td>
            <td class="text-end">${formatarEstoqueProduto(p.estoque_minimo, p.unidade, { produtoFracionado: produtoUsaConversaoUnidades(p) })}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function montarListaEstoqueBaixoProdutos(criticos, proximos) {
  const listaCriticos = Array.isArray(criticos) ? criticos : [];
  const listaProximos = Array.isArray(proximos) ? proximos : [];

  if (!listaCriticos.length && !listaProximos.length) {
    return '<div class="text-muted">Nenhum alerta de estoque no momento.</div>';
  }

  let html = '<div class="d-flex flex-column gap-2">';

  if (listaCriticos.length) {
    html += `
      <div class="d-flex justify-content-between align-items-center">
        <span class="text-danger fw-semibold">Estoque no mínimo ou abaixo (${listaCriticos.length})</span>
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="carregarRelatorioEstoqueProdutos('estoque_baixo')">Ver todos</button>
      </div>
    `;
  }

  if (listaProximos.length) {
    html += `
      <div class="d-flex justify-content-between align-items-center">
        <span class="text-warning-emphasis fw-semibold">Próximo do mínimo (${listaProximos.length})</span>
        <button type="button" class="btn btn-sm btn-outline-warning" onclick="carregarRelatorioEstoqueProdutos('proximo_minimo')">Ver todos</button>
      </div>
    `;
  }

  html += '</div>';
  return html;
}

function separarProdutosPorEstoque(produtos) {
  const criticos = [];
  const proximos = [];

  (produtos || []).forEach((p) => {
    const tipo = classificarEstoqueProduto(p);
    if (tipo === 'estoque_baixo') criticos.push(p);
    else if (tipo === 'proximo_minimo') proximos.push(p);
  });

  return { criticos, proximos };
}

async function carregarEstoqueBaixoProdutos() {
  const container = document.getElementById('listaEstoqueBaixoProdutos');
  if (!container) return;

  container.innerHTML = '<div class="text-muted">Carregando...</div>';

  const cache = window.produtosCache || window.produtosList || [];
  if (cache.length) {
    const { criticos, proximos } = separarProdutosPorEstoque(cache);
    container.innerHTML = montarListaEstoqueBaixoProdutos(criticos, proximos);
    return;
  }

  try {
    const response = await fetch(`${API_URL}/produtos/estoque/baixo?modo_fiscal=${modoFiscalParamGestaoProdutosLocal()}`, {
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
      }
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erro ao carregar estoque baixo.');
    }

    container.innerHTML = montarListaEstoqueBaixoProdutos(data, []);
  } catch (error) {
    console.error('Erro estoque baixo:', error);
    container.innerHTML = '<div class="text-danger">Erro ao carregar alertas de estoque.</div>';
  }
}

function inicializarCardEstoqueBaixo() {
  carregarEstoqueBaixoProdutos();
}

window.carregarEstoqueBaixoProdutos = carregarEstoqueBaixoProdutos;

function inicializarModalVencimentosProdutos() {
    if ($('#modalVencimentosProdutos').length) return;

    $('body').append(`
        <div class="modal fade" id="modalVencimentosProdutos" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Produtos vencidos ou próximos do vencimento</h5>
                        <button type="button" class="btn-close" onclick="fecharModalVencimentosProdutos()" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <table class="table table-striped table-hover">
                            <thead>
                                <tr>
                                    <th>Produto</th>
                                    <th>${tituloColunaEstoqueLista()}</th>
                                    <th>Lote</th>
                                    <th>Validade</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody id="listaVencimentosProdutos">
                                <tr>
                                    <td colspan="5">Carregando...</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `);
}

async function carregarVencimentosProdutos() {
    try {
        const modoFiscal = modoFiscalParamGestaoProdutosLocal();
        const response = await fetch(`${API_URL}/produtos/vencimentos/alertas?dias=30&modo_fiscal=${modoFiscal}`, {
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao carregar vencimentos');
        }

        $('#qtdProdutosVencidos').text(data.vencidos || 0);
        $('#qtdProdutosProximos').text(data.proximos || 0);

        renderizarListaVencimentosProdutos(data.produtos || []);
    } catch (error) {
        console.error('Erro ao carregar vencimentos:', error);
        $('#qtdProdutosVencidos').text('0');
        $('#qtdProdutosProximos').text('0');
    }
}

function renderizarListaVencimentosProdutos(produtos) {
    const tbody = $('#listaVencimentosProdutos');

    if (!tbody.length) return;

    if (!produtos.length) {
        tbody.html(`
            <tr>
                <td colspan="5" class="text-center text-muted">
                    Nenhum produto vencido ou próximo do vencimento.
                </td>
            </tr>
        `);
        return;
    }

    tbody.html(produtos.map((produto) => {
        const vencido = produto.status_validade === 'vencido';
        const statusTexto = vencido
            ? 'Vencido'
            : `Vence em ${produto.dias_para_vencer} dia(s)`;

        const linhaClasse = vencido ? 'table-danger' : 'table-warning';
        const badgeClasse = vencido ? 'bg-danger' : 'bg-warning text-dark';

        const validadeFormatada = produto.data_validade
            ? new Date(produto.data_validade + 'T00:00:00').toLocaleDateString('pt-BR')
            : '-';

        return `
            <tr class="${linhaClasse}">
                <td class="fw-semibold">${escapeHtml(produto.nome || '-')}</td>
                <td>${formatarEstoqueExibicaoTela(produto)}</td>
                <td>${escapeHtml(produto.lote || '-')}</td>
                <td>${validadeFormatada}</td>
                <td>
                    <span class="badge ${badgeClasse}">
                        ${statusTexto}
                    </span>
                </td>
            </tr>
        `;
    }).join(''));
}

function abrirModalVencimentosProdutos() {
    carregarVencimentosProdutos();
    const el = document.getElementById('modalVencimentosProdutos');
    if (el) {
        bootstrap.Modal.getOrCreateInstance(el).show();
    }
}

function fecharModalVencimentosProdutos() {
    const el = document.getElementById('modalVencimentosProdutos');
    if (el) {
        bootstrap.Modal.getInstance(el)?.hide();
    }
}

window.carregarVencimentosProdutos = carregarVencimentosProdutos;
window.abrirModalVencimentosProdutos = abrirModalVencimentosProdutos;
window.fecharModalVencimentosProdutos = fecharModalVencimentosProdutos;
