/**
 * Roteador do módulo CDS ERP (Retaguarda).
 */
window.CDS_MODULE = 'erp';
window.CDS_DEFAULT_PAGE = 'dashboard';

const CDS_ERP_PAGE_SCRIPTS = Object.freeze({
    dashboard: [
        '/vendor/chart.js/chart.min.js',
        '/erp/js/dashboard-command.js',
        '/erp/js/dashboard-margem-bruta.js',
        '/erp/js/dashboard.js'
    ],
    monitoring: ['/erp/js/cds-monitoring-engine.js'],
    produtos: ['/shared/js/SearchSDK.js', '/shared/js/buscaProdutoTexto.js', '/shared/js/resolverBuscaCadastroProdutos.js', '/erp/js/categorias.js', '/erp/js/subcategorias.js', '/erp/js/motor-unidades-medida.js', '/erp/js/produto-apresentacao-resolver.js', '/erp/js/produto-embalagens.js', '/shared/js/motor-preco-atacado.js', '/erp/js/formacao-preco-margem.js', '/shared/js/cds-stable-dropdown.js', '/erp/js/produtos.js'],
    clientes: ['/erp/js/clientes.js'],
    compras: ['/erp/js/categorias.js', '/erp/js/subcategorias.js', '/erp/js/produto-apresentacao-resolver.js', '/erp/js/produto-embalagens.js', '/shared/js/motor-preco-atacado.js', '/erp/js/formacao-preco-margem.js', '/shared/js/buscaProdutoTexto.js', '/shared/js/resolverBuscaCadastroProdutos.js', '/shared/js/cds-stable-dropdown.js', '/erp/js/produtos.js', '/erp/js/motor-unidades-medida.js', '/shared/js/motor-quantidade-compra.js', '/erp/js/compra-muc-client.js', '/erp/js/tratamento-fiscal-item-compra.js', '/erp/js/miip-central-revisao.js', '/erp/js/compras-fornecedor-cnpj-rc831.js', '/shared/js/nfeDanfeViewer.js', '/erp/js/compras.js'],
    'central-entradas': [
        '/erp/js/central-entradas-ux.js',
        '/erp/js/categorias.js',
        '/erp/js/subcategorias.js',
        '/erp/js/motor-unidades-medida.js',
        '/erp/js/produto-apresentacao-resolver.js',
        '/erp/js/produto-embalagens.js',
        '/shared/js/motor-preco-atacado.js',
        '/erp/js/formacao-preco-margem.js',
        '/shared/js/buscaProdutoTexto.js',
        '/shared/js/resolverBuscaCadastroProdutos.js',
        '/shared/js/cds-stable-dropdown.js',
        '/erp/js/produtos.js',
        '/erp/js/tratamento-fiscal-item-compra.js',
        '/erp/js/miip-central-revisao.js',
        '/erp/js/central-recuperacao-xml.js',
        '/erp/js/central-entradas-review-ux.js',
        '/erp/js/central-entradas.js'
    ],
    'central-diagnostico': ['/erp/js/central-diagnostico.js'],
    'dfe-auditoria': ['/erp/js/dfe-auditoria.js'],
    fornecedores: ['/erp/js/fornecedores.js'],
    vendas: [
        '/shared/js/cupomPrintPolicy.js',
        '/shared/js/fiscalImpressao.js',
        '/shared/js/vendasHistoricoUi.js',
        '/erp/js/vendas.js'
    ],
    entregas: [
        '/shared/js/cupomPrintPolicy.js',
        '/shared/js/fiscalImpressao.js',
        '/pdv/js/entregas.js'
    ],
    faturamento: ['/shared/js/nfeDanfeViewer.js', '/erp/js/faturamento.js'],
    'central-faturamento': ['/shared/js/nfeDanfeViewer.js', '/erp/js/central-faturamento.js'],
    pedidos: ['/erp/js/pedidos.js'],
    financeiro: [
        '/erp/js/financeiro-dashboard.js',
        '/erp/js/financeiro-receber.js',
        '/erp/js/financeiro-pagar.js',
        '/erp/js/financeiro-historico.js',
        '/erp/js/financeiro-relatorios.js',
        '/erp/js/financeiro-condicoes.js',
        '/erp/js/financeiro.js'
    ],
    licenca: ['/erp/js/licenca.js'],
    caixa: ['/erp/js/caixa.js'],
    configuracoes: [
        '/shared/js/cupomPrintPolicy.js',
        '/shared/js/fiscalImpressao.js',
        '/shared/js/configuracaoRede.js',
        '/erp/js/configuracoes.js'
    ],
    'f12-admin': ['/erp/js/f12-admin.js'],
    'importacao-inicial-produtos': [
        '/erp/js/importacao-inicial-estado.js',
        '/erp/js/importacao-inicial-produtos.js'
    ],
    usuarios: ['/erp/js/usuarios.js'],
    equipamentos: ['/erp/js/equipamentos.js'],
    'central-equipamentos': ['/erp/js/central-equipamentos.js'],
    'laboratorio-equipamentos': ['/erp/js/laboratorio-equipamentos.js'],
    'enviar-produtos-balanca': ['/erp/js/enviar-produtos-balanca.js'],
    'configuracoes-avancadas': [
        '/shared/js/cupomPrintPolicy.js',
        '/shared/js/fiscalImpressao.js',
        '/shared/js/configuracaoRede.js',
        '/erp/js/fiscal.js',
        '/erp/js/configuracoes.js',
        '/erp/js/cds-centro-configuracoes.js'
    ],
    fiscal: ['/shared/js/cupomPrintPolicy.js', '/shared/js/fiscalImpressao.js', '/shared/js/vendasHistoricoUi.js', '/erp/js/fiscal.js'],
    'nfe-central': ['/shared/js/cupomPrintPolicy.js', '/shared/js/fiscalImpressao.js', '/shared/js/nfeDanfeViewer.js', '/erp/js/nfe-central.js'],
    'nfe-avulsa': ['/shared/js/nfeDanfeViewer.js', '/erp/js/nfe-avulsa.js'],
    'nfe-devolucao-compra': ['/shared/js/nfeDanfeViewer.js', '/erp/js/nfe-devolucao-compra.js'],
    'nfe-monitor': ['/erp/js/nfe-operacional.js'],
    'nfe-fila': ['/erp/js/nfe-operacional.js'],
    'nfe-diagnostico': ['/erp/js/nfe-operacional.js'],
    'central-contabil': ['/erp/js/central-contabil.js'],
    'fechamento-fiscal-dia': ['/erp/js/fechamento-fiscal-dia.js'],
    categorias: ['/erp/js/subcategorias.js', '/erp/js/categorias.js'],
    auditoria: ['/erp/js/auditoria.js'],
    observabilidade: ['/erp/js/observabilidade.js'],
    'mib-analytics': ['/erp/js/mib-analytics.js'],
    'enterprise-search': ['/shared/js/SearchSDK.js', '/erp/js/enterprise-search.js'],
    'knowledge-center': ['/erp/js/knowledge-center.js'],
    'cip-insights': ['/erp/js/cip-insights.js'],
    'cds-copiloto': ['/shared/js/AgentSDK.js', '/erp/js/cds-copiloto.js'],
    caixas: ['/erp/js/caixas.js'],
    'feature:central-homologacao': ['/erp/js/central-homologacao.js'],
    'feature:configuracao-tef': ['/erp/js/configuracao_tef.js']
});

const cdsErpLazyScripts = new Map();
const cdsErpLazyStats = new Map();

function cdsErpAgora() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function carregarScriptErpLazy(src) {
    const existente = cdsErpLazyScripts.get(src);
    if (existente) {
        existente.reuses += 1;
        return existente.promise;
    }

    const inicio = cdsErpAgora();
    const entry = { promise: null, reuses: 0, loadMs: null };
    entry.promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = false;
        script.dataset.cdsLazyLoaded = 'true';
        script.onload = function () {
            entry.loadMs = Number((cdsErpAgora() - inicio).toFixed(2));
            console.info('[ERP LAZY] SCRIPT LOADED', {
                src,
                loadMs: entry.loadMs
            });
            resolve(src);
        };
        script.onerror = function () {
            cdsErpLazyScripts.delete(src);
            script.remove();
            reject(new Error(`Falha ao carregar script ERP: ${src}`));
        };
        document.head.appendChild(script);
    });
    cdsErpLazyScripts.set(src, entry);
    return entry.promise;
}

function cdsErpPublicarRum(eventName, page, totalMs, extras) {
    try {
        if (!window.CdsObsRum || typeof window.CdsObsRum.publish !== 'function') return;
        window.CdsObsRum.publish(eventName, {
            origem: 'frontend.erp.lazy',
            duracao_ms: totalMs,
            resultado: extras && extras.ok === false ? 'erro' : 'ok',
            ok: !(extras && extras.ok === false),
            payload: Object.assign({
                page: String(page || '').slice(0, 80),
                module: String(page || '').slice(0, 80),
                source: 'erp.lazy'
            }, extras || {})
        });
    } catch (_) { /* RUM never blocks navigation */ }
}

async function carregarScriptsPaginaErp(page) {
    const scripts = CDS_ERP_PAGE_SCRIPTS[page] || [];
    const inicio = cdsErpAgora();
    let novos = 0;

    for (const src of scripts) {
        if (!cdsErpLazyScripts.has(src)) novos += 1;
        await carregarScriptErpLazy(src);
    }

    const stats = cdsErpLazyStats.get(page) || { loads: 0, reuses: 0, firstLoadMs: null };
    const totalMs = Number((cdsErpAgora() - inicio).toFixed(2));
    const isFirst = stats.loads === 0;
    if (isFirst) {
        stats.firstLoadMs = totalMs;
    } else {
        stats.reuses += 1;
        stats.lastReuseMs = totalMs;
    }
    stats.loads += 1;
    stats.scripts = scripts.length;
    stats.newScripts = novos;
    cdsErpLazyStats.set(page, stats);

    console.info(novos > 0 ? '[ERP LAZY] MODULE CREATED' : '[ERP LAZY] MODULE REUSED', {
        page,
        scripts: scripts.length,
        newScripts: novos,
        totalMs
    });

    const rumEvent = (novos > 0 || isFirst)
        ? (window.CdsObsRum && window.CdsObsRum.EVENT.MODULE_LAZY_CREATED)
        : (window.CdsObsRum && window.CdsObsRum.EVENT.MODULE_LAZY_REUSED);
    if (rumEvent) {
        cdsErpPublicarRum(rumEvent, page, totalMs, {
            scripts: scripts.length,
            new_scripts: novos,
            first_open: isFirst,
            reuse: !isFirst,
            loads: stats.loads,
            total_ms: totalMs
        });
    }
}

window.CdsErpLazyLoader = Object.freeze({
    loadPageScripts: carregarScriptsPaginaErp,
    loadFeatureScript: carregarScriptErpLazy,
    loadFeature: (feature) => carregarScriptsPaginaErp(`feature:${feature}`),
    isScriptLoaded: (src) => cdsErpLazyScripts.has(src),
    getLoadedScripts: () => Array.from(cdsErpLazyScripts.keys()),
    getPageStats: (page) => {
        const stats = cdsErpLazyStats.get(page);
        return stats ? { ...stats } : null;
    },
    getAllStats: () => Object.fromEntries(
        Array.from(cdsErpLazyStats.entries()).map(([page, stats]) => [page, { ...stats }])
    ),
    manifest: CDS_ERP_PAGE_SCRIPTS
});

window.minimizarModal = function minimizarModal(modalId, rotuloRestaurar) {
    const $modal = $('#' + modalId);
    if (!$modal.length) return;

    $modal.modal('hide');

    const btnId = 'btn-restaurar-' + modalId;
    if ($('#' + btnId).length) return;

    const titulo = String(
        rotuloRestaurar
        || $modal.find('.modal-title').first().text()
        || 'formulário'
    ).trim();
    const tituloSeguro = typeof escapeHtml === 'function' ? escapeHtml(titulo) : titulo;

    const $btn = $(`
      <button type="button" id="${btnId}" class="btn btn-primary position-fixed shadow"
        style="bottom: 48px; right: 24px; z-index: 2000;"
        title="Restaurar ${tituloSeguro}">
        <i class="fas fa-window-maximize me-1"></i> Restaurar: ${tituloSeguro}
      </button>
    `);

    $btn.on('click', function () {
        $modal.modal('show');
        if (modalId === 'produtoModal' || modalId === 'viewProdutoModal') {
            if (typeof inicializarCategoriasESubcategorias === 'function') {
                const produto = {
                    id: $('#produtoId').val(),
                    codigo: $('#codigo').val(),
                    nome: $('#nome').val(),
                    categoria_id: $('#categoria_id').val(),
                    subcategoria_id: $('#subcategoria_id').val(),
                    unidade: $('#unidade').val(),
                    preco_compra: $('#preco_compra').val(),
                    lucro_percentual: $('#lucro_percentual').val(),
                    preco_venda: $('#preco_venda').val(),
                    estoque_atual: $('#estoque_atual').val(),
                    estoque_minimo: $('#estoque_minimo').val(),
                    fornecedor: $('#fornecedor').val()
                };
                inicializarCategoriasESubcategorias(produto, !!produto.id);
            }
        }
        $(this).remove();
    });

    $('body').append($btn);
};

async function loadPage(page) {
    const Perf = window.PerformanceMonitor;
    if (Perf?.isEnabled?.()) Perf.navigationStart(page, { trigger: 'loadPage' });
    if (typeof UINavigation !== 'undefined' && UINavigation.enterPage) {
        UINavigation.enterPage(page);
    }
    currentPage = page;

    if (!paginaPermitidaPorImplantacao(page)) {
        const msg = typeof mensagemModuloNaoContratado === 'function'
            ? mensagemModuloNaoContratado(page)
            : 'Módulo não contratado.';
        showNotification(msg, 'warning');
        if (page !== 'dashboard') loadPage('dashboard');
        return;
    }

    if (page === 'fechamento-fiscal-dia'
        && typeof fechamentoFiscalDiaMenuPermitido === 'function'
        && !fechamentoFiscalDiaMenuPermitido()) {
        showNotification('Fechamento Fiscal do Dia está desativado.', 'warning');
        if (page !== 'dashboard') loadPage('dashboard');
        return;
    }

    if (!usuarioTemPermissao(page)) {
        showNotification('Você não tem permissão para acessar esta página.', 'warning');
        if (page !== 'dashboard') loadPage('dashboard');
        return;
    }

    if (typeof desativarPdvFullscreen === 'function') {
        desativarPdvFullscreen();
    }
    document.body.classList.remove('menu-open', 'pdv-mode');

    const moduleOpenStarted = cdsErpAgora();
    cdsErpPublicarRum(
        window.CdsObsRum && window.CdsObsRum.EVENT.MODULE_OPEN,
        page,
        0,
        { phase: 'module_open', ok: true }
    );

    const scriptsPagina = CDS_ERP_PAGE_SCRIPTS[page] || [];
    const precisaCarregar = scriptsPagina.some((src) => !cdsErpLazyScripts.has(src));
    if (precisaCarregar) {
        $('#page-content').html(`
            <div class="text-center p-5" data-erp-lazy-loading="${page}">
                <div class="spinner-border text-primary" role="status"></div>
                <p class="mt-2">Carregando módulo...</p>
            </div>
        `);
    }

    try {
        if (Perf?.isEnabled?.()) {
            Perf.navigationPhase('request:start', {
                kind: 'lazy-scripts',
                scripts: scriptsPagina.length,
                newScripts: scriptsPagina.filter((src) => !cdsErpLazyScripts.has(src)).length
            });
        }
        await carregarScriptsPaginaErp(page);
        if (Perf?.isEnabled?.()) Perf.navigationPhase('request:end', { kind: 'lazy-scripts' });
    } catch (error) {
        if (Perf?.isEnabled?.()) {
            Perf.navigationPhase('request:end', {
                kind: 'lazy-scripts',
                outcome: 'error',
                error: String(error?.message || error).slice(0, 160)
            });
        }
        console.error('[ERP LAZY] MODULE ERROR', { page, error });
        cdsErpPublicarRum(
            window.CdsObsRum && window.CdsObsRum.EVENT.MODULE_LAZY_ERROR,
            page,
            Number((cdsErpAgora() - moduleOpenStarted).toFixed(2)),
            {
                ok: false,
                error_kind: 'script_load',
                error_code: 'MODULE_LAZY_ERROR'
            }
        );
        $('#page-content').html(
            '<div class="alert alert-danger">Erro ao carregar o módulo. Tente novamente.</div>'
        );
        return;
    }

    if (currentPage !== page) return;
    if (Perf?.isEnabled?.()) {
        Perf.navigationPhase('dispatch', {
            page,
            pageToken: typeof UINavigation !== 'undefined' ? UINavigation.getToken?.() : null
        });
    }

    switch (page) {
        case 'dashboard':
            return carregarPaginaHtml('dashboard.html', function () {
                if (typeof initDashboard === 'function') initDashboard();
            });
        case 'monitoring':
            return typeof loadMonitoringEngine === 'function'
                ? loadMonitoringEngine()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar Central de Monitoramento.</div>');
        case 'produtos':
            return typeof loadProdutos === 'function'
                ? loadProdutos()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar produtos.</div>');
        case 'clientes':
            return typeof loadClientes === 'function'
                ? loadClientes()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar clientes.</div>');
        case 'compras':
            return typeof loadCompras === 'function'
                ? loadCompras()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar compras.</div>');
        case 'central-entradas':
            return typeof loadCentralEntradas === 'function'
                ? loadCentralEntradas()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar Central de Entradas.</div>');
        case 'central-diagnostico':
            return typeof loadCentralDiagnostico === 'function'
                ? loadCentralDiagnostico()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar diagnóstico da Central.</div>');
        case 'dfe-auditoria':
            return typeof loadDfeAuditoria === 'function'
                ? loadDfeAuditoria()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar Auditoria DF-e.</div>');
        case 'fornecedores':
            return typeof loadFornecedores === 'function'
                ? loadFornecedores()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar fornecedores.</div>');
        case 'vendas':
            return typeof loadVendas === 'function'
                ? loadVendas()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar histórico de vendas.</div>');
        case 'entregas':
            return typeof loadEntregas === 'function'
                ? loadEntregas()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar vendas para entrega.</div>');
        case 'faturamento':
            return typeof loadFaturamento === 'function'
                ? loadFaturamento()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar Expedição.</div>');
        case 'central-faturamento':
            return typeof loadCentralFaturamento === 'function'
                ? loadCentralFaturamento()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar Central de Faturamento.</div>');
        case 'pedidos':
            return typeof loadPedidos === 'function'
                ? loadPedidos()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar pedidos.</div>');
        case 'financeiro':
            return carregarPaginaHtml('financeiro.html', function () {
                if (typeof initFinanceiro === 'function') initFinanceiro();
            });
        case 'licenca':
            return typeof loadLicenca === 'function'
                ? loadLicenca()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar assinatura.</div>');
        case 'caixa':
            return typeof loadCaixa === 'function'
                ? loadCaixa()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar caixa.</div>');
        case 'configuracoes':
            return typeof loadConfiguracoes === 'function'
                ? loadConfiguracoes()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar configurações.</div>');
        case 'f12-admin':
            return typeof loadF12Admin === 'function'
                ? loadF12Admin()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar Controle F12.</div>');
        case 'importacao-inicial-produtos':
            return typeof loadImportacaoInicialProdutos === 'function'
                ? loadImportacaoInicialProdutos()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar Importação Inicial de Produtos.</div>');
        case 'usuarios':
            return typeof loadUsuarios === 'function'
                ? loadUsuarios()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar usuários.</div>');
        case 'equipamentos':
            return typeof loadEquipamentos === 'function'
                ? loadEquipamentos()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar equipamentos.</div>');
        case 'central-equipamentos':
            return typeof loadCentralEquipamentos === 'function'
                ? loadCentralEquipamentos()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar Central de Equipamentos.</div>');
        case 'laboratorio-equipamentos':
            return typeof loadLaboratorioEquipamentos === 'function'
                ? loadLaboratorioEquipamentos()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar laboratório.</div>');
        case 'enviar-produtos-balanca':
            return typeof loadEnviarProdutosBalanca === 'function'
                ? loadEnviarProdutosBalanca()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar Enviar Produtos.</div>');
        case 'configuracoes-avancadas':
            return typeof loadConfiguracoesAvancadas === 'function'
                ? loadConfiguracoesAvancadas()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar configurações avançadas.</div>');
        case 'fiscal':
            return typeof loadFiscal === 'function'
                ? loadFiscal()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar o módulo fiscal.</div>');
        case 'nfe-central':
            return typeof loadNfeCentral === 'function'
                ? loadNfeCentral()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar a Central de NF-e.</div>');
        case 'nfe-avulsa':
            return typeof loadNfeAvulsa === 'function'
                ? loadNfeAvulsa()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar Nova NF-e.</div>');
        case 'nfe-devolucao-compra':
            return typeof loadNfeDevolucaoCompra === 'function'
                ? loadNfeDevolucaoCompra()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar Devolução de Compra.</div>');
        case 'nfe-monitor':
            return typeof loadNfeMonitor === 'function'
                ? loadNfeMonitor()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar o Monitor NF-e.</div>');
        case 'nfe-fila':
            return typeof loadNfeFila === 'function'
                ? loadNfeFila()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar a Fila NF-e.</div>');
        case 'nfe-diagnostico':
            return typeof loadNfeDiagnostico === 'function'
                ? loadNfeDiagnostico()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar o Diagnóstico Fiscal.</div>');
        case 'central-contabil':
            return typeof loadCentralContabil === 'function'
                ? loadCentralContabil()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar a Central Contábil.</div>');
        case 'fechamento-fiscal-dia':
            return typeof loadFechamentoFiscalDoDia === 'function'
                ? loadFechamentoFiscalDoDia()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar o Fechamento Fiscal do Dia.</div>');
        case 'categorias':
            return carregarPaginaHtml('categorias.html', function () {
                if (typeof loadCategoriasAndSubcategorias === 'function') {
                    loadCategoriasAndSubcategorias();
                } else if (typeof loadCategorias === 'function') {
                    loadCategorias();
                }
            });
        case 'auditoria':
            return carregarPaginaHtml('auditoria.html', function () {
                if (typeof inicializarPaginaAuditoria === 'function') {
                    inicializarPaginaAuditoria();
                } else if (typeof carregarAuditoria === 'function') {
                    carregarAuditoria(1);
                }
            });
        case 'observabilidade':
            return typeof loadObservabilidade === 'function'
                ? loadObservabilidade()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar Observabilidade.</div>');
        case 'mib-analytics':
            return typeof carregarMibAnalytics === 'function'
                ? carregarMibAnalytics()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar MIB Analytics.</div>');
        case 'enterprise-search':
            return typeof carregarEnterpriseSearch === 'function'
                ? carregarEnterpriseSearch()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar Enterprise Search.</div>');
        case 'knowledge-center':
            return typeof carregarKnowledgeCenter === 'function'
                ? carregarKnowledgeCenter()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar Knowledge Center.</div>');
        case 'cip-insights':
            return typeof carregarCipInsights === 'function'
                ? carregarCipInsights()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar CIP Insights.</div>');
        case 'cds-copiloto':
            return typeof carregarCdsCopiloto === 'function'
                ? carregarCdsCopiloto()
                : $('#page-content').html('<div class="alert alert-danger">Erro ao carregar CDS Copiloto.</div>');
        case 'caixas':
            return carregarPaginaHtml('caixas.html', function () {
                if (typeof loadCaixas === 'function') {
                    buscarCaixas();
                }
            });
        default:
            $('#page-content').html('<div class="alert alert-warning">Página não encontrada.</div>');
    }
}

window.loadPage = loadPage;

$(document).ready(function () {
    inicializarShellModulo({ defaultPage: 'dashboard' });
});
