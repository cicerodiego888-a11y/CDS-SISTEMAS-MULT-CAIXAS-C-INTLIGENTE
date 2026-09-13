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
 * Gestão de estoque no cadastro de produtos (ERP).
 *
 * O F12 / modo fiscal do PDV é visualização operacional e NÃO deve esconder
 * saldo não fiscal no ajuste/cadastro, nem filtrar a lista de produtos.
 * O cadastro opera sempre com os dois saldos (fiscal + não fiscal).
 */
function gestaoEstoqueDuploHabilitada() {
    return true;
}

/** Query para APIs de cadastro/listagem de produtos no ERP (sempre modo completo). */
function modoFiscalQueryParamGestaoProdutos() {
    return '0';
}

/** true = UI de cadastro/ajuste exibe só saldo fiscal. No ERP isso fica desligado. */
function isModoFiscalSomenteCadastroEstoque() {
    return false;
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
        unidade: produto.unidade || cached.unidade
    };
}

function obterEstoqueExibicaoSimplesProduto(produto) {
    if (!produto) return 0;

    const item = enriquecerProdutoComCacheEstoque(produto);

    if (isModoFiscalVisualizacaoAtivo()) {
        if (item.saldo_fiscal !== undefined && item.saldo_fiscal !== null) {
            return Number(item.saldo_fiscal || 0);
        }
        return Number(item.estoque_atual || 0);
    }

    return Number(item.estoque_atual ?? 0);
}

function obterEstoqueDisponivelProduto(produto) {
    if (!produto) return 0;

    if (isModoFiscalVisualizacaoAtivo()) {
        return Number(produto.saldo_fiscal ?? 0);
    }

    if (produto.estoque_atual !== undefined && produto.estoque_atual !== null && !isModoFiscalVisualizacaoAtivo()) {
        const fiscal = Number(produto.saldo_fiscal ?? 0);
        const naoFiscal = Number(produto.saldo_nao_fiscal ?? 0);
        if (fiscal + naoFiscal > 0) {
            return fiscal + naoFiscal;
        }
        return Number(produto.estoque_atual || 0);
    }

    return Number(produto.saldo_fiscal || 0) + Number(produto.saldo_nao_fiscal || 0);
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
    const $buscaProduto = $ ? $('#buscaProduto') : null;
    const buscaProdutoEmFoco = !!(
        $buscaProduto
        && $buscaProduto.length
        && typeof document !== 'undefined'
        && document.activeElement === $buscaProduto[0]
    );

    if (page === 'vendas' && typeof loadVendas === 'function') {
        loadVendas();
    } else if (page === 'produtos' && typeof loadProdutos === 'function') {
        // Com PDV aberto, o sync de modo fiscal dispara com frequência.
        // Nunca remontar o shell; se o usuário está digitando/editando, só atualiza o cache.
        if (modalProdutoAberto || buscaProdutoEmFoco) {
            loadProdutos({ suave: true, somenteCache: true });
        } else {
            loadProdutos({ suave: true });
        }
    } else if (page === 'pdv' && typeof loadPDV === 'function') {
        loadPDV();
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
window.gestaoEstoqueDuploHabilitada = gestaoEstoqueDuploHabilitada;
window.modoFiscalQueryParamGestaoProdutos = modoFiscalQueryParamGestaoProdutos;
window.isModoFiscalSomenteCadastroEstoque = isModoFiscalSomenteCadastroEstoque;
window.atualizarBarraModoFiscalSidebar = atualizarBarraModoFiscalSidebar;
window.enriquecerProdutoComCacheEstoque = enriquecerProdutoComCacheEstoque;
window.obterEstoqueExibicaoSimplesProduto = obterEstoqueExibicaoSimplesProduto;
window.obterEstoqueDisponivelProduto = obterEstoqueDisponivelProduto;
window.recarregarModulosModoFiscal = recarregarModulosModoFiscal;
