function modoFiscalQueryParam() {
    if (typeof modoFiscalAtivoSistema === 'function') {
        return modoFiscalAtivoSistema() ? '1' : '0';
    }
    return localStorage.getItem('pdv_modo_fiscal_ativo') === '1' ? '1' : '0';
}

function isModoFiscalVisualizacaoAtivo() {
    return modoFiscalQueryParam() === '1';
}

/**
 * F12 ativo: nenhuma tela pode exibir saldo, rótulo ou item não fiscal.
 */
function f12OcultaNaoFiscal() {
    return isModoFiscalVisualizacaoAtivo();
}

/**
 * Gestão de estoque no cadastro de produtos (ERP).
 * Com F12 ativo, só o saldo fiscal fica visível.
 */
function gestaoEstoqueDuploHabilitada() {
    return !f12OcultaNaoFiscal();
}

/** Query para APIs de cadastro/listagem de produtos no ERP. */
function modoFiscalQueryParamGestaoProdutos() {
    return modoFiscalQueryParam();
}

/** true = UI de cadastro/ajuste exibe só saldo fiscal. */
function isModoFiscalSomenteCadastroEstoque() {
    return f12OcultaNaoFiscal();
}

function atualizarBarraModoFiscalSidebar() {
    const barra = document.getElementById('sidebar-modo-fiscal-bar');
    if (!barra) return;

    const fiscalPermitido = typeof implantacaoPermiteFiscal === 'function'
        ? implantacaoPermiteFiscal()
        : true;

    if (!fiscalPermitido) {
        barra.style.display = 'none';
        return;
    }

    barra.style.display = '';

    const ativo = typeof modoFiscalAtivoSistema === 'function'
        ? modoFiscalAtivoSistema()
        : localStorage.getItem('pdv_modo_fiscal_ativo') === '1';

    barra.classList.toggle('sidebar-modo-fiscal-bar--on', ativo);
    barra.classList.toggle('sidebar-modo-fiscal-bar--off', !ativo);
    barra.title = ativo
        ? 'Modo fiscal ativo'
        : 'Modo completo';
}

function enriquecerProdutoComCacheEstoque(produto) {
    if (!produto) return produto;

    const produtoId = produto.produto_id ?? produto.id;
    if (!produtoId) return produto;

    // PDV usa produtosDisponiveis; ERP usa produtosCache/produtosList
    const cache = window.produtosDisponiveis
        || window.produtosCache
        || window.produtosList
        || [];
    const cached = cache.find((p) => String(p.id) === String(produtoId));
    if (!cached) return produto;

    const temSaldoFiscal = produto.saldo_fiscal !== undefined && produto.saldo_fiscal !== null && produto.saldo_fiscal !== '';
    const temSaldoNaoFiscal = produto.saldo_nao_fiscal !== undefined && produto.saldo_nao_fiscal !== null && produto.saldo_nao_fiscal !== '';
    const temEstoqueAtual = produto.estoque_atual !== undefined && produto.estoque_atual !== null && produto.estoque_atual !== '';

    const saldoFiscal = temSaldoFiscal ? Number(produto.saldo_fiscal) : Number(cached.saldo_fiscal ?? 0);
    const saldoNaoFiscal = temSaldoNaoFiscal ? Number(produto.saldo_nao_fiscal) : Number(cached.saldo_nao_fiscal ?? 0);
    const estoqueAtual = temEstoqueAtual
        ? Number(produto.estoque_atual)
        : Number(cached.estoque_atual ?? (saldoFiscal + saldoNaoFiscal));

    return {
        ...produto,
        saldo_fiscal: saldoFiscal,
        saldo_nao_fiscal: saldoNaoFiscal,
        estoque_atual: estoqueAtual > 0 ? estoqueAtual : (saldoFiscal + saldoNaoFiscal),
        reservado_fiscal: Number(produto.reservado_fiscal ?? cached.reservado_fiscal ?? 0),
        reservado_nao_fiscal: Number(produto.reservado_nao_fiscal ?? cached.reservado_nao_fiscal ?? 0),
        unidade: produto.unidade || cached.unidade
    };
}

function calcularDisponibilidadeEstoqueProduto(produto) {
    if (!produto) return { fiscal: 0, naoFiscal: 0, total: 0 };

    const fiscal = Number(produto.saldo_fiscal ?? 0);
    const naoFiscal = Number(produto.saldo_nao_fiscal ?? 0);
    const reservadoFiscal = Number(produto.reservado_fiscal ?? 0);
    const reservadoNaoFiscal = Number(produto.reservado_nao_fiscal ?? 0);
    const disponivelFiscal = Math.max(0, fiscal - reservadoFiscal);
    const disponivelNaoFiscal = Math.max(0, naoFiscal - reservadoNaoFiscal);

    return {
        fiscal: disponivelFiscal,
        naoFiscal: disponivelNaoFiscal,
        total: disponivelFiscal + disponivelNaoFiscal
    };
}

function obterEstoqueExibicaoSimplesProduto(produto) {
    if (!produto) return 0;

    const item = enriquecerProdutoComCacheEstoque(produto);
    const disponivel = calcularDisponibilidadeEstoqueProduto(item);

    if (isModoFiscalVisualizacaoAtivo()) {
        return disponivel.fiscal;
    }

    return disponivel.total;
}

function obterEstoqueDisponivelProduto(produto) {
    if (!produto) return 0;
    const item = enriquecerProdutoComCacheEstoque(produto);
    const disponivel = calcularDisponibilidadeEstoqueProduto(item);

    if (isModoFiscalVisualizacaoAtivo()) {
        return disponivel.fiscal;
    }

    return disponivel.total;
}

function recarregarModulosModoFiscal() {
    const page = typeof currentPage !== 'undefined' ? currentPage : null;
    const $ = typeof window !== 'undefined' ? window.$ : null;
    const $modalProduto = $ ? $('#produtoModal') : null;
    const modalProdutoAberto = !!(
        $modalProduto
        && $modalProduto.length
        && ($modalProduto.hasClass('show') || $modalProduto.is(':visible'))
    );
    const listaProdutosMontada = !!(
        (typeof shellListagemProdutosMontado === 'function' && shellListagemProdutosMontado())
        || (typeof document !== 'undefined' && (
            document.getElementById('produtos-tbody')
            || document.getElementById('categorias-container')
        ))
    );

    if (page === 'vendas' && typeof loadVendas === 'function') {
        loadVendas();
    } else if ((page === 'produtos' || listaProdutosMontada) && typeof loadProdutos === 'function') {
        if (typeof invalidarCatalogoProdutosSessao === 'function') {
            invalidarCatalogoProdutosSessao('modo-fiscal');
        }
        if (typeof atualizarListagemProdutosAposModoFiscal === 'function') {
            atualizarListagemProdutosAposModoFiscal();
        } else {
            loadProdutos({ suave: true, forcar: true, motivo: 'modo-fiscal' });
        }
    } else if (page === 'pdv' && typeof atualizarPdvAposModoFiscal === 'function') {
        atualizarPdvAposModoFiscal();
    } else if (page === 'pdv' && typeof recarregarCatalogoPdv === 'function') {
        recarregarCatalogoPdv();
    } else if (typeof recarregarCatalogoPdv === 'function') {
        recarregarCatalogoPdv();
    } else if (page === 'dashboard' && typeof carregarDashboardComFiltro === 'function') {
        carregarDashboardComFiltro();
    } else if (page === 'monitoring' && typeof atualizarMonitoringModoFiscal === 'function') {
        atualizarMonitoringModoFiscal();
    } else if (page === 'financeiro' && typeof initFinanceiro === 'function') {
        initFinanceiro();
    }

    // Com modal aberto, não reescrever campos de estoque (perde digitação).
    if (!modalProdutoAberto && typeof atualizarCamposEstoqueModalProduto === 'function') {
        atualizarCamposEstoqueModalProduto();
    }
}

window.modoFiscalQueryParam = modoFiscalQueryParam;
window.isModoFiscalVisualizacaoAtivo = isModoFiscalVisualizacaoAtivo;
window.f12OcultaNaoFiscal = f12OcultaNaoFiscal;
window.gestaoEstoqueDuploHabilitada = gestaoEstoqueDuploHabilitada;
window.modoFiscalQueryParamGestaoProdutos = modoFiscalQueryParamGestaoProdutos;
window.isModoFiscalSomenteCadastroEstoque = isModoFiscalSomenteCadastroEstoque;
window.atualizarBarraModoFiscalSidebar = atualizarBarraModoFiscalSidebar;
window.enriquecerProdutoComCacheEstoque = enriquecerProdutoComCacheEstoque;
window.obterEstoqueExibicaoSimplesProduto = obterEstoqueExibicaoSimplesProduto;
window.obterEstoqueDisponivelProduto = obterEstoqueDisponivelProduto;
window.recarregarModulosModoFiscal = recarregarModulosModoFiscal;
