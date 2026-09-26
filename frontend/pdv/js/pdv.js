let carrinho = [];
let produtosDisponiveis = [];
/** Feature flag MIP no PDV (Sprint 05). OFF = identificação local legada. */
let pdvMipHabilitado = true; // Sprint 09 — MIP é o motor oficial do PDV (sem flag)
let formaPagamentoSelecionada = null;
let clienteSelecionado = null;
let clientesResultados = [];
let vendaPrazoInfo = null;
let vendaEmProcessamento = false;
let pdvClockInterval = null;
let caixaAberto = false;
let pagamentoFiscalAtual = null;
let pagamentosMistos = [];
let formaPagamentoSelecionadaPDV = null;
/** Valor recebido em dinheiro (modal de troco) — fonte oficial para persistência/cupom */
let valorRecebidoDinheiroPDV = null;
let supervisorAuthToken = null;
let terminalId = null;
let terminalHostname = null;
/** Escolha explícita do operador: emitir NFC-e nesta venda (null = ainda não definido). */
let pdvEmitirFiscalNaVenda = null;

/** Expõe o carrinho para módulos PDV (entrega, widgets) — `let` não cria window.carrinho. */
function sincronizarCarrinhoGlobalPdv() {
    window.carrinho = carrinho;
}
window.obterCarrinhoPdv = function obterCarrinhoPdv() {
    return carrinho;
};
sincronizarCarrinhoGlobalPdv();

const PDV_VENDA_ABERTA_PREFIXO = 'cds_pdv_venda_aberta';
const PDV_VENDA_ABERTA_TTL_MS = 36 * 60 * 60 * 1000;

function chaveVendaAbertaPdv() {
    let uid = 'anon';
    try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        uid = user.id || user.username || 'anon';
    } catch (_) { /* ignore */ }
    return `${PDV_VENDA_ABERTA_PREFIXO}:${uid}`;
}

function snapshotVendaAbertaPdv() {
    const descontoEl = document.getElementById('descontoPdv');
    const acrescimoEl = document.getElementById('acrescimoPdv');
    const formaEl = document.getElementById('formaPagamentoPdv');
    return {
        v: 1,
        ts: Date.now(),
        carrinho: Array.isArray(carrinho) ? carrinho : [],
        clienteSelecionado: clienteSelecionado || null,
        formaPagamentoSelecionada: formaPagamentoSelecionada || null,
        vendaPrazoInfo: vendaPrazoInfo || null,
        pdvEmitirFiscalNaVenda: pdvEmitirFiscalNaVenda,
        pagamentosMistos: Array.isArray(pagamentosMistos) ? pagamentosMistos : [],
        desconto: descontoEl ? Number(descontoEl.value) || 0 : 0,
        acrescimo: acrescimoEl ? Number(acrescimoEl.value) || 0 : 0,
        formaPagamentoPdv: formaEl ? formaEl.value : '',
        pdvTipoVenda: window.pdvTipoVenda || 'BALCAO',
        pdvEntregaConfigurada: window.pdvEntregaConfigurada === true
    };
}

function persistirVendaAbertaPdv() {
    try {
        if (typeof localStorage === 'undefined') return;
        const snap = snapshotVendaAbertaPdv();
        if (!Array.isArray(snap.carrinho) || snap.carrinho.length === 0) {
            localStorage.removeItem(chaveVendaAbertaPdv());
            return;
        }
        localStorage.setItem(chaveVendaAbertaPdv(), JSON.stringify(snap));
    } catch (_) { /* quota / modo privado */ }
}

function limparVendaAbertaPersistidaPdv() {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(chaveVendaAbertaPdv());
        }
    } catch (_) { /* ignore */ }
}

function restaurarVendaAbertaPdv() {
    if (Array.isArray(carrinho) && carrinho.length > 0) return false;
    try {
        const raw = localStorage.getItem(chaveVendaAbertaPdv());
        if (!raw) return false;
        const snap = JSON.parse(raw);
        if (!snap || !Array.isArray(snap.carrinho) || snap.carrinho.length === 0) {
            limparVendaAbertaPersistidaPdv();
            return false;
        }
        if (snap.ts && (Date.now() - Number(snap.ts)) > PDV_VENDA_ABERTA_TTL_MS) {
            limparVendaAbertaPersistidaPdv();
            return false;
        }
        carrinho = snap.carrinho;
        if (Array.isArray(carrinho)) {
            carrinho.forEach((item) => {
                if (!item || typeof item !== 'object') return;
                if (typeof PDVItemCompositionService !== 'undefined'
                    && typeof PDVItemCompositionService.garantirLinhaId === 'function') {
                    PDVItemCompositionService.garantirLinhaId(item);
                } else if (!item.linha_id) {
                    item.linha_id = 'L' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
                }
            });
        }
        clienteSelecionado = snap.clienteSelecionado || null;
        formaPagamentoSelecionada = snap.formaPagamentoSelecionada || null;
        vendaPrazoInfo = snap.vendaPrazoInfo || null;
        pdvEmitirFiscalNaVenda = snap.pdvEmitirFiscalNaVenda != null ? snap.pdvEmitirFiscalNaVenda : null;
        pagamentosMistos = Array.isArray(snap.pagamentosMistos) ? snap.pagamentosMistos : [];
        window.__cdsPdvSnapshotRestaurado = snap;
        sincronizarCarrinhoGlobalPdv();
        return true;
    } catch (_) {
        return false;
    }
}

function aplicarUiVendaRestauradaPdv() {
    const snap = window.__cdsPdvSnapshotRestaurado;
    if (!snap) return;
    window.__cdsPdvSnapshotRestaurado = null;
    if (snap.desconto != null && $('#descontoPdv').length) {
        $('#descontoPdv').val(snap.desconto);
    }
    if (snap.acrescimo != null && $('#acrescimoPdv').length) {
        $('#acrescimoPdv').val(snap.acrescimo);
    }
    if (snap.formaPagamentoPdv && $('#formaPagamentoPdv').length) {
        $('#formaPagamentoPdv').val(snap.formaPagamentoPdv);
    }
    if (snap.clienteSelecionado) {
        clienteSelecionado = snap.clienteSelecionado;
        if (typeof selecionarCliente === 'function') {
            selecionarCliente(snap.clienteSelecionado);
        }
    }
    if (snap.pdvTipoVenda) {
        window.pdvTipoVenda = snap.pdvTipoVenda;
    }
    if (snap.pdvEntregaConfigurada && window.PdvVendaEntrega) {
        window.pdvEntregaConfigurada = true;
        if (typeof PdvVendaEntrega.atualizarBotaoEntrega === 'function') {
            PdvVendaEntrega.atualizarBotaoEntrega();
        }
    }
    calcularTotal();
    showNotification('Venda em andamento restaurada.', 'info');
}

window.persistirVendaAbertaPdv = persistirVendaAbertaPdv;

function motorPrecoAtacadoDisponivel() {
    return typeof MotorPrecoAtacado !== 'undefined';
}

function obterPrecoBaseItemPdv(item, produto) {
    const vendaUnidade = item && itemVendaPorUnidade(item);
    if (vendaUnidade) {
        return Number(item?.preco_base || produto?.preco_unidade || item?.preco_unitario || 0);
    }
    return Number(item?.preco_base || produto?.preco_venda || item?.preco_unitario || 0);
}

function aplicarCalculoMotorItemPdv(item, opcoes = {}) {
    if (!motorPrecoAtacadoDisponivel()) {
        throw new Error('MotorPrecoAtacado indisponível');
    }
    const produto = produtosDisponiveis.find((p) => Number(p.id) === Number(item.id));
    const precoBase = Number(opcoes.precoOriginal ?? obterPrecoBaseItemPdv(item, produto));
    const qtd = Number(opcoes.quantidade ?? item.quantidade ?? 0);
    let calc;

    if (opcoes.precoUnitarioInformado != null && Number.isFinite(Number(opcoes.precoUnitarioInformado))) {
        calc = MotorPrecoAtacado.calcularLinhaPrecoUnitarioInformado({
            precoOriginal: precoBase,
            quantidade: qtd,
            precoUnitarioInformado: Number(opcoes.precoUnitarioInformado)
        });
    } else {
        calc = MotorPrecoAtacado.calcularLinhaDescontoPercentual({
            precoOriginal: precoBase,
            quantidade: qtd,
            percentualDesconto: Number(opcoes.percentualDesconto ?? item.desconto_percentual ?? 0)
        });
    }

    item.preco_base = precoBase;
    item.preco_unitario = calc.precoUnitarioInterno;
    item.desconto_percentual = calc.percentualDesconto;
    item.desconto_valor = Number(MotorPrecoAtacado.arredondarMoeda(calc.valorDesconto || 0));
    item.subtotal = calc.totalInterno;
    item.subtotal_exibicao = calc.total;
    return calc;
}

function operadorPodeAplicarDescontoSemSenha() {
    if (typeof usuarioEhSupervisor === 'function') {
        return usuarioEhSupervisor();
    }
    try {
        const u = JSON.parse(localStorage.getItem('user') || '{}');
        const perfil = String(u.perfil || u.nivel || '').trim().toUpperCase();
        return u.role === 'admin' || ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR'].includes(perfil);
    } catch (_) {
        return false;
    }
}

function vendaTemDescontoManualPdv() {
    const descontoVenda = Math.max(0, Number($('#descontoPdv').val()) || 0);
    if (descontoVenda > 0) return true;
    return (carrinho || []).some((item) => Number(item.desconto_manual || 0) === 1
        && Number(item.desconto_valor || item.desconto_percentual || 0) > 0);
}

/**
 * Descontos manuais: ADMIN/SUPERVISOR/SUPER_ADMIN aplicam direto;
 * demais operadores precisam de senha de administrador/supervisor.
 */
function garantirAutorizacaoDesconto(onAuthorized, onCancel) {
    if (operadorPodeAplicarDescontoSemSenha() || supervisorAuthToken) {
        if (typeof onAuthorized === 'function') onAuthorized();
        return;
    }
    mostrarModalAutorizacaoSupervisor(onAuthorized, onCancel);
}

function obterDescontoValorItemPdv(item, produto) {
    if (item == null) return 0;
    if (item.desconto_valor != null && Number.isFinite(Number(item.desconto_valor))) {
        return Math.max(0, Math.round(Number(item.desconto_valor) * 100) / 100);
    }
    const precoBase = obterPrecoBaseItemPdv(item, produto);
    const qtd = Number(item.quantidade || 0);
    const pct = Number(item.desconto_percentual || 0);
    const bruto = precoBase * qtd;
    const valor = bruto > 0 ? (bruto * pct) / 100 : 0;
    return Math.max(0, Math.round(valor * 100) / 100);
}

function precoUnitarioExibicaoItemPdv(item) {
    if (motorPrecoAtacadoDisponivel()) {
        return MotorPrecoAtacado.formatarPrecoExibicao(item.preco_unitario).toFixed(2);
    }
    return Number(item.preco_unitario || 0).toFixed(2);
}

function sincronizarTerminalGlobalsPdv() {
    window.terminalId = terminalId;
    window.terminalHostname = terminalHostname;
    window.terminalNome = terminalNome;
}
function obterTerminalIdPdv() {
    if (Number.isInteger(terminalId) && terminalId > 0) {
        return terminalId;
    }
    if (Number.isInteger(window.terminalId) && window.terminalId > 0) {
        return window.terminalId;
    }
    return null;
}

function parseValorMonetarioPdv(valor) {
    if (typeof window.CdsPoliticaMonetaria?.parseMoedaBr === 'function') {
        return window.CdsPoliticaMonetaria.parseMoedaBr(valor);
    }
    if (valor == null || valor === '') return 0;
    if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
    const texto = String(valor).trim().replace(/\s/g, '');
    const temVirgula = texto.includes(',');
    const temPonto = texto.includes('.');
    let normalizado = texto;
    if (temVirgula && temPonto) {
        normalizado = texto.lastIndexOf(',') > texto.lastIndexOf('.')
            ? texto.replace(/\./g, '').replace(',', '.')
            : texto.replace(/,/g, '');
    } else if (temVirgula) {
        normalizado = texto.replace(',', '.');
    }
    const n = Number(normalizado);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Valor entregue em dinheiro: prioriza o confirmado no modal de troco,
 * depois o campo da sidebar e campos legados.
 */
function obterValorRecebidoDinheiroPdv() {
    if (valorRecebidoDinheiroPDV != null && Number(valorRecebidoDinheiroPDV) > 0) {
        return Number(valorRecebidoDinheiroPDV);
    }
    const candidatos = [
        $('#valorRecebidoPDV').val(),
        $('#valorRecebido').val(),
        $('#valor-recebido').val(),
        $('#nao-fiscal-valor-recebido').val()
    ];
    for (const c of candidatos) {
        const n = parseValorMonetarioPdv(c);
        if (n > 0) return n;
    }
    return 0;
}

function registrarValorRecebidoDinheiroPdv(valor, totalVenda) {
    const recebido = parseValorMonetarioPdv(valor);
    const total = parseValorMonetarioPdv(totalVenda);
    valorRecebidoDinheiroPDV = recebido;
    if ($('#valorRecebidoPDV').length) {
        $('#valorRecebidoPDV').val(recebido > 0 ? recebido.toFixed(2) : '');
    }
    if (typeof calcularTrocoPDV === 'function') {
        try { calcularTrocoPDV(); } catch (_) { /* ignore */ }
    }
    const troco = recebido > total ? Math.round((recebido - total) * 100) / 100 : 0;
    return { valor_recebido: recebido, troco };
}

function getTerminalRequestData(body = {}) {
    const id = obterTerminalIdPdv();
    if (id) {
        body.terminal_id = id;
    }
    return body;
}

function getTerminalRequestQuery(params = {}) {
    const id = obterTerminalIdPdv();
    if (id) {
        params.terminal_id = id;
    }
    return params;
}

function buildTerminalQueryString(params = {}) {
    const query = getTerminalRequestQuery(params);
    const search = new URLSearchParams(query).toString();
    return search ? `?${search}` : '';
}

function normalizarTexto(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .normalize('NFC')
        .toLowerCase();
}

// Buscar promoção ativa de um produto
async function buscarPromocaoAtivaProduto(produtoId) {
    try {
        const response = await fetch(`${API_URL}/produtos/${produtoId}/promocao-ativa`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + (localStorage.getItem('token') || '')
            }
        });

        if (!response.ok) return null;
        const promocao = await response.json();
        return promocao;
    } catch (e) {
        console.warn(`Erro ao buscar promoção para produto ${produtoId}:`, e);
        return null;
    }
}

function normalizarProdutoPdvLista(produtos) {
    return Array.isArray(produtos) ? produtos.map(p => ({
        ...p,
        saldo_fiscal: Number(p.saldo_fiscal ?? 0),
        saldo_nao_fiscal: Number(p.saldo_nao_fiscal ?? 0),
        estoque_atual: (Number(p.saldo_fiscal ?? 0) + Number(p.saldo_nao_fiscal ?? 0))
            || Number(p.estoque_atual || 0),
        preco_venda: Number(p.preco_venda || 0),
        ncm: String(p.ncm != null ? p.ncm : '').trim(),
        permite_venda_unidade: Number(p.permite_venda_unidade ?? 0) === 1 ? 1 : 0,
        peso_medio_unidade: Number(p.peso_medio_unidade ?? 0),
        preco_unidade: Number(p.preco_unidade ?? 0)
    })) : [];
}

function produtoPermiteEscolhaVendaUnidade(produto) {
    return produtoUsaConversaoUnidadesPdv(produto)
        && Number(produto?.permite_venda_unidade ?? 0) === 1;
}

const TIPO_VENDA_PESO = 'PESO';
const TIPO_VENDA_UNIDADE = 'UNIDADE';

/** UX-01 — destaque visual do carrinho (somente UI) */
let pdvLinhaDestaqueIndex = null;
let pdvLinhaDestaqueTimer = null;
let pdvTotalAnimIndex = null;
let pdvTotalAnimTimer = null;

function destacarLinhaCarrinho(index) {
    if (index == null || index < 0) return;
    pdvLinhaDestaqueIndex = Number(index);
    if (pdvLinhaDestaqueTimer) clearTimeout(pdvLinhaDestaqueTimer);
    pdvLinhaDestaqueTimer = setTimeout(() => {
        pdvLinhaDestaqueIndex = null;
        $('#tabelaItensVendaPdv tr.pdv-item-recem').removeClass('pdv-item-recem');
    }, 2000);
}

function animarTotalLinhaCarrinho(index) {
    if (index == null || index < 0) return;
    pdvTotalAnimIndex = Number(index);
    if (pdvTotalAnimTimer) clearTimeout(pdvTotalAnimTimer);
    pdvTotalAnimTimer = setTimeout(() => {
        pdvTotalAnimIndex = null;
        $('#tabelaItensVendaPdv .pdv-total-flash').removeClass('pdv-total-flash');
    }, 700);
}

function normalizarTipoVendaItem(item) {
    const tipo = String(item?.tipo_venda || '').toUpperCase();
    if (tipo === TIPO_VENDA_UNIDADE) return TIPO_VENDA_UNIDADE;
    if (tipo === TIPO_VENDA_PESO) return TIPO_VENDA_PESO;
    if (item?.modo_venda === 'unidade') return TIPO_VENDA_UNIDADE;
    return TIPO_VENDA_PESO;
}

function tipoVendaEhUnidade(tipoVenda) {
    const tipo = String(tipoVenda || '').toUpperCase();
    return tipo === TIPO_VENDA_UNIDADE || tipoVenda === 'unidade';
}

function itemVendaPorUnidade(item) {
    return normalizarTipoVendaItem(item) === TIPO_VENDA_UNIDADE;
}

function obterQuantidadeEstoqueParaVenda(produto, quantidadeVenda, tipoVenda = TIPO_VENDA_PESO) {
    if (tipoVendaEhUnidade(tipoVenda)) {
        const pesoMedio = Number(produto?.peso_medio_unidade ?? 0);
        return Number(quantidadeVenda || 0) * pesoMedio;
    }
    return Number(quantidadeVenda || 0);
}

function formatarVendaUnidadeConsulta(produto) {
    if (!produtoUsaConversaoUnidadesPdv(produto)) {
        return 'NÃO';
    }
    return Number(produto?.permite_venda_unidade ?? 0) === 1 ? 'SIM' : 'NÃO';
}

function obterPrecoVendaConsultaPdv(produto) {
    const preco = Number(produto?.preco_venda || 0);
    const temPromocao = produto?.tem_promocao === 1 || produto?.tem_promocao === true;
    const precoPromocional = Number(produto?.preco_promocional || 0);
    return temPromocao && precoPromocional > 0 ? precoPromocional : preco;
}

function formatarPrecoUnidadeConsulta(produto) {
    const precoUnidade = Number(produto?.preco_unidade ?? 0);
    if (Number(produto?.permite_venda_unidade ?? 0) === 1 && precoUnidade > 0) {
        return formatCurrency(precoUnidade);
    }
    const precoVenda = obterPrecoVendaConsultaPdv(produto);
    return precoVenda > 0 ? formatCurrency(precoVenda) : formatCurrency(0);
}

function formatarPesoKgPdv(valor) {
    const n = Math.round(Number(valor || 0) * 1000) / 1000;
    return n.toFixed(3).replace('.', ',');
}

function montarPreviewCalculoVendaUnidade(produto, quantidadeUnidades) {
    const qtd = Math.max(0, Math.round(Number(quantidadeUnidades || 0)));
    const pesoMedio = Number(produto?.peso_medio_unidade ?? 0);
    const precoUnidade = Number(produto?.preco_unidade ?? 0);
    return {
        qtd,
        pesoMedio,
        pesoTotalKg: qtd * pesoMedio,
        precoUnidade,
        valorTotal: qtd * precoUnidade
    };
}

function renderTextoPreviewEstoqueKg(produto, quantidadeUnidades) {
    const calc = montarPreviewCalculoVendaUnidade(produto, quantidadeUnidades);
    if (calc.qtd <= 0 || calc.pesoMedio <= 0) {
        return '—';
    }
    return `${calc.qtd} × ${formatarPesoKgPdv(calc.pesoMedio)} = ${formatarPesoKgPdv(calc.pesoTotalKg)} kg`;
}

function renderTextoPreviewValorUnidade(produto, quantidadeUnidades) {
    const calc = montarPreviewCalculoVendaUnidade(produto, quantidadeUnidades);
    if (calc.qtd <= 0 || calc.precoUnidade <= 0) {
        return '—';
    }
    return `${calc.qtd} × ${formatCurrency(calc.precoUnidade)} = ${formatCurrency(calc.valorTotal)}`;
}

function atualizarPreviewVendaUnidadeModal(produto) {
    const input = document.getElementById('inputQuantidadeProduto');
    if (!input) return;

    const qtd = Math.max(0, Math.round(Number(parseQuantidadePdv(input.value) || 0)));
    const elKg = document.getElementById('previewVendaUnidadeKg');
    const elValor = document.getElementById('previewVendaUnidadeValor');

    if (elKg) {
        elKg.textContent = renderTextoPreviewEstoqueKg(produto, qtd);
    }
    if (elValor) {
        elValor.textContent = renderTextoPreviewValorUnidade(produto, qtd);
    }
}

function urlProdutosPdv() {
    // Catálogo e motores sempre com F+NF. F12 só oculta o rótulo NF na UI.
    return `${API_URL}/produtos?modo_fiscal=0`;
}

function sincronizarProdutosDisponiveisGlobal() {
    window.produtosDisponiveis = produtosDisponiveis;
}

let catalogoVersaoPdvAtual = null;

function definirCatalogoPdv(produtos) {
    produtosDisponiveis = normalizarProdutoPdvLista(produtos);
    sincronizarProdutosDisponiveisGlobal();
    const maxId = (produtosDisponiveis || []).reduce((m, p) => Math.max(m, Number(p.id) || 0), 0);
    catalogoVersaoPdvAtual = String(maxId);
}

function produtoCatalogoPdvOperacional(produto) {
    if (!produto || produto.id == null) return false;
    return Object.prototype.hasOwnProperty.call(produto, 'estoque_atual')
        || Object.prototype.hasOwnProperty.call(produto, 'saldo_fiscal')
        || Object.prototype.hasOwnProperty.call(produto, 'controla_estoque');
}

/** Total operacional F+NF (busca/F1 não pode tratar como 0 se houver qualquer saldo). */
function pdvTotalSaldosProduto(produto) {
    const fiscal = Number(produto?.saldo_fiscal ?? 0);
    const naoFiscal = Number(produto?.saldo_nao_fiscal ?? 0);
    const soma = fiscal + naoFiscal;
    if (soma > 1e-9) return soma;
    return Number(produto?.estoque_atual ?? 0);
}

/**
 * Busca F1/MIB às vezes devolve saldos zerados. Não pode sobrescrever
 * catálogo que já tem F ou NF positivo.
 */
function mesclarProdutoCatalogoPdv(existente, incoming) {
    if (!existente) return incoming;
    if (!incoming) return existente;
    const base = { ...existente, ...incoming };
    const totalIn = pdvTotalSaldosProduto(incoming);
    const totalEx = pdvTotalSaldosProduto(existente);
    if (totalIn <= 1e-9 && totalEx > 1e-9) {
        base.saldo_fiscal = Number(existente.saldo_fiscal ?? 0);
        base.saldo_nao_fiscal = Number(existente.saldo_nao_fiscal ?? 0);
        base.estoque_atual = Number(existente.estoque_atual ?? totalEx);
    } else if (totalIn > 1e-9) {
        base.saldo_fiscal = Number(incoming.saldo_fiscal ?? 0);
        base.saldo_nao_fiscal = Number(incoming.saldo_nao_fiscal ?? 0);
        base.estoque_atual = totalIn;
    }
    return base;
}

function upsertProdutoNoCatalogoPdv(produto) {
    if (!produto || produto.id == null) return null;
    const [normalizado] = normalizarProdutoPdvLista([produto]);
    const lista = Array.isArray(produtosDisponiveis) ? produtosDisponiveis.slice() : [];
    const idx = lista.findIndex((p) => Number(p.id) === Number(normalizado.id));
    if (idx >= 0) {
        const [mesclado] = normalizarProdutoPdvLista([
            mesclarProdutoCatalogoPdv(lista[idx], normalizado)
        ]);
        lista[idx] = mesclado;
    } else {
        lista.unshift(normalizado);
    }
    produtosDisponiveis = lista;
    sincronizarProdutosDisponiveisGlobal();
    const maxId = lista.reduce((m, p) => Math.max(m, Number(p.id) || 0), 0);
    if (maxId > Number(catalogoVersaoPdvAtual || 0)) {
        catalogoVersaoPdvAtual = String(maxId);
    }
    return lista[idx >= 0 ? idx : 0];
}

let recarregarCatalogoPdvInflight = null;
let recarregarCatalogoPdvTimer = null;

function recarregarCatalogoPdv() {
    if (recarregarCatalogoPdvInflight) return recarregarCatalogoPdvInflight;
    recarregarCatalogoPdvInflight = $.ajax({
        url: urlProdutosPdv(),
        method: 'GET',
        cache: false
    }).done(function (produtos) {
        definirCatalogoPdv(produtos);
    }).always(function () {
        recarregarCatalogoPdvInflight = null;
    });
    return recarregarCatalogoPdvInflight;
}

function agendarRecarregarCatalogoPdv() {
    clearTimeout(recarregarCatalogoPdvTimer);
    recarregarCatalogoPdvTimer = setTimeout(function () {
        recarregarCatalogoPdv();
    }, 250);
}

async function garantirProdutoNoCatalogoPdv(produtoOuId, opcoes = {}) {
    const id = produtoOuId && typeof produtoOuId === 'object'
        ? produtoOuId.id
        : produtoOuId;
    if (id == null || id === '') {
        return produtoOuId && typeof produtoOuId === 'object' ? produtoOuId : null;
    }

    const forcar = opcoes.forcarAtualizacao === true;
    const cached = encontrarProdutoPorIdPdv(id);
    const cacheComEstoque = cached
        && produtoCatalogoPdvOperacional(cached)
        && pdvTotalSaldosProduto(cached) > 1e-9;

    // Cache com saldos zerados (poluído pela busca F1) não serve — hidratar de novo.
    if (!forcar && cacheComEstoque) {
        return cached;
    }

    try {
        const token = localStorage.getItem('token') || '';
        const response = await fetch(`${API_URL}/produtos/${id}?modo_fiscal=0`, {
            method: 'GET',
            cache: 'no-store',
            headers: { Authorization: 'Bearer ' + token }
        });
        if (response.ok) {
            const completo = await response.json();
            if (completo && completo.id) {
                upsertProdutoNoCatalogoPdv(completo);
                return encontrarProdutoPorIdPdv(completo.id) || completo;
            }
        }
    } catch (err) {
        console.warn('[PDV] Falha ao hidratar produto recém-cadastrado:', err && err.message);
    }

    if (produtoOuId && typeof produtoOuId === 'object' && produtoOuId.id) {
        upsertProdutoNoCatalogoPdv(produtoOuId);
        return encontrarProdutoPorIdPdv(produtoOuId.id) || produtoOuId;
    }
    return cached || null;
}

function inicializarSincronizacaoCatalogoPdv() {
    if (window.__cdsCatalogoPdvSyncInit) return;
    window.__cdsCatalogoPdvSyncInit = true;

    const aplicarProdutoSalvo = function (msg) {
        if (!msg || msg.tipo !== 'produto-salvo') return;
        if (msg.produto) {
            upsertProdutoNoCatalogoPdv(msg.produto);
            garantirProdutoNoCatalogoPdv(msg.produto);
        }
        agendarRecarregarCatalogoPdv();
    };

    if (window.CdsCatalogoProdutoSync && typeof CdsCatalogoProdutoSync.ouvir === 'function') {
        CdsCatalogoProdutoSync.ouvir(aplicarProdutoSalvo);
    }

    window.addEventListener('focus', function () {
        hidratarUltimoProdutoCatalogoPdv();
        agendarRecarregarCatalogoPdv();
    });
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
            hidratarUltimoProdutoCatalogoPdv();
            agendarRecarregarCatalogoPdv();
        }
    });

    if (!window.__cdsCatalogoPdvPollTimer) {
        window.__cdsCatalogoPdvPollTimer = setInterval(verificarVersaoCatalogoPdv, 2500);
    }
}

function hidratarUltimoProdutoCatalogoPdv() {
    if (!window.CdsCatalogoProdutoSync || typeof CdsCatalogoProdutoSync.consumirUltimoProdutoSalvo !== 'function') {
        return;
    }
    const ultimo = CdsCatalogoProdutoSync.consumirUltimoProdutoSalvo();
    if (ultimo && ultimo.produto) {
        upsertProdutoNoCatalogoPdv(ultimo.produto);
        garantirProdutoNoCatalogoPdv(ultimo.produto);
    }
}

function verificarVersaoCatalogoPdv() {
    const token = localStorage.getItem('token') || '';
    if (!token || typeof API_URL === 'undefined') return;
    fetch(`${API_URL}/produtos/catalogo-versao?modo_fiscal=0`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: 'Bearer ' + token }
    }).then(function (response) {
        if (!response.ok) return null;
        return response.json();
    }).then(function (data) {
        if (!data) return;
        const maxIdServidor = Number(data.max_id || 0);
        const maxIdLocal = Number(catalogoVersaoPdvAtual || 0);
        if (maxIdServidor > maxIdLocal) {
            catalogoVersaoPdvAtual = String(maxIdServidor);
            hidratarUltimoProdutoCatalogoPdv();
            recarregarCatalogoPdv();
        }
    }).catch(function () { /* offline */ });
}

window.upsertProdutoNoCatalogoPdv = upsertProdutoNoCatalogoPdv;
window.recarregarCatalogoPdv = recarregarCatalogoPdv;
window.garantirProdutoNoCatalogoPdv = garantirProdutoNoCatalogoPdv;
window.pdvPermitirTransferenciaNaoFiscalFiscal = pdvPermitirTransferenciaNaoFiscalFiscal;
window.pdvPermitirEditarPrecoUnitario = pdvPermitirEditarPrecoUnitario;

function loadPDV() {
    console.log('Carregando PDV...');

    // Auto-registrar terminal no backend
    autoRegistrarTerminal();
    inicializarSincronizacaoCatalogoPdv();
    carregarFlagTransferenciaNaoFiscalFiscalPdv();
    carregarFlagEditarPrecoUnitarioPdv();
    carregarFlagVendaSemEstoquePdv();
    carregarFlagExigirNcmCadastroPdv();
    carregarFlagImprimirCupomPdv();
    carregarFlagComposicaoItensPdv();

    $.ajax({
        url: urlProdutosPdv(),
        method: 'GET',
        cache: false,
        success: function(produtos) {
            definirCatalogoPdv(produtos);
            console.log('[PDV] Identificação: MIP oficial → fallback legado');
            inicializarPDV();
        },
        error: function(xhr) {
            console.error('Erro ao carregar produtos:', xhr);
            definirCatalogoPdv([]);
            inicializarPDV();
            showNotification('Erro ao carregar produtos do PDV.', 'danger');
        }
    });
}

/**
 * Sprint 09 — flag global não controla mais o PDV (MIP é oficial).
 * Mantida como no-op compatível para chamadas legadas.
 * @returns {Promise<boolean>}
 */
function carregarFlagMipPdv() {
    pdvMipHabilitado = true;
    console.log('[PDV] MIP oficial (produto_identidade_enabled ignorada no PDV)');
    return Promise.resolve(true);
}

/**
 * Identifica produto via MIP (backend) — porta oficial do PDV.
 * Sprint EQUIPAMENTOS 03/RC1: etiqueta nunca vai completa ao MIP — só o PLU do Motor.
 * @param {string} codigo
 * @param {Object} [opcoes]
 * @param {boolean} [opcoes.aposMotorEquipamentos]
 * @returns {Promise<Object>}
 */
async function identificarProdutoViaMip(codigo, opcoes = {}) {
    const token = localStorage.getItem('token') || '';
    const contexto = { origem: 'pdv' };

    if (!opcoes.aposMotorEquipamentos) {
        if (window.PDV_ETIQUETA_LAYOUT) {
            contexto.layoutStrategy = String(window.PDV_ETIQUETA_LAYOUT);
        }
        if (window.PDV_BALANCA_EQUIPAMENTO_ID) {
            contexto.equipamentoId = Number(window.PDV_BALANCA_EQUIPAMENTO_ID);
        }
    } else {
        contexto.origem = 'pdv_apos_motor_equipamentos';
        contexto.tipoEsperado = 'PLU';
    }

    const url = `${API_URL}/produtos/identificar`;
    const payloadEnviado = { codigo: String(codigo || '').trim(), contexto };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token
        },
        body: JSON.stringify(payloadEnviado)
    });

    const statusHttp = response.status;
    const body = await response.json().catch(function() { return {}; });

    if (!response.ok) {
        throw new Error(body.error || ('HTTP ' + statusHttp));
    }

    return body;
}

/** RC1 — auditoria estruturada somente Homologação / Debug (nunca produção). */
function pdvAuditoriaEquipamentosHabilitada() {
    try {
        if (window.PDV_HOMOLOGACAO === true || window.PDV_DEBUG === true) return true;
        if (localStorage.getItem('pdv_homologacao') === '1') return true;
        if (localStorage.getItem('pdv_debug') === '1') return true;
        if (sessionStorage.getItem('pdv_homologacao') === '1') return true;
        if (sessionStorage.getItem('pdv_debug') === '1') return true;
    } catch (_) { /* ignore */ }
    return false;
}

function pdvAuditoriaEquipamentos(evento, dados) {
    if (!pdvAuditoriaEquipamentosHabilitada()) return;
    const registro = {
        canal: 'EQUIPAMENTOS_RC1',
        evento: String(evento || 'fluxo'),
        timestamp: new Date().toISOString(),
        ...dados
    };
    try {
        if (!Array.isArray(window.__PDV_AUDIT_EQUIPAMENTOS)) {
            window.__PDV_AUDIT_EQUIPAMENTOS = [];
        }
        window.__PDV_AUDIT_EQUIPAMENTOS.push(registro);
        if (window.__PDV_AUDIT_EQUIPAMENTOS.length > 100) {
            window.__PDV_AUDIT_EQUIPAMENTOS.shift();
        }
    } catch (_) { /* ignore */ }
    // eslint-disable-next-line no-console
    console.info('[PDV AUDIT EQUIPAMENTOS]', registro);
}

/**
 * Interpretação oficial da etiqueta no Motor de Equipamentos (RC1).
 * Sem layout ativo → mensagem amigável, sem interpretar.
 * @param {string} codigoEan13
 * @returns {Promise<Object>}
 */
async function interpretarEtiquetaViaMotorEquipamentos(codigoEan13) {
    const token = localStorage.getItem('token') || '';
    const payload = {
        codigo: String(codigoEan13 || '').replace(/\D/g, '')
    };
    if (window.PDV_BALANCA_EQUIPAMENTO_ID) {
        payload.equipamento_id = Number(window.PDV_BALANCA_EQUIPAMENTO_ID);
    }

    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    const response = await fetch(`${API_URL}/equipamentos/etiquetas/interpretar`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token
        },
        body: JSON.stringify(payload)
    });

    const body = await response.json().catch(function() { return {}; });
    const tempoTotalHttpMs = ((typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now()) - t0;

    if (!response.ok) {
        throw new Error(body.error || ('HTTP ' + response.status));
    }

    body._tempoHttpMotorMs = Number(tempoTotalHttpMs.toFixed(3));
    return body;
}

function encontrarProdutoPorIdPdv(produtoId) {
    return (produtosDisponiveis || []).find(function(p) {
        return Number(p.id) === Number(produtoId);
    }) || null;
}

// Auto-registrar terminal no backend (somente app PDV dedicado)
const HEARTBEAT_TERMINAL_MS = 2 * 60 * 1000;
let intervaloHeartbeatTerminal = null;
let tentativasRegistroTerminal = 0;
let terminalNome = '';

function deveRegistrarTerminalPdv() {
    if (window.CDS_MODULE === 'pdv') return true;
    const path = String(window.location.pathname || '');
    return path === '/pdv' || path.startsWith('/pdv/');
}

function registrarTerminalOfflineSync() {
    if (!terminalHostname || !deveRegistrarTerminalPdv()) return;
    const url = `${API_URL}/terminais/auto/offline?hostname=${encodeURIComponent(terminalHostname)}&origem=pdv`;
    if (typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(url);
        return;
    }
    fetch(url, { method: 'GET', keepalive: true }).catch(() => {});
}

if (!window.__cdsTerminalOfflineRegistrado) {
    window.__cdsTerminalOfflineRegistrado = true;
    window.addEventListener('pagehide', function () {
        persistirVendaAbertaPdv();
        registrarTerminalOfflineSync();
    });
    window.addEventListener('beforeunload', function () {
        persistirVendaAbertaPdv();
        registrarTerminalOfflineSync();
    });
}

function obterUsuarioLogadoPdv() {
    try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        return {
            usuario_id: user.id || null,
            usuario_nome: String(user.nome || user.username || '').trim()
        };
    } catch (e) {
        return { usuario_id: null, usuario_nome: '' };
    }
}

async function autoRegistrarTerminal() {
    if (!deveRegistrarTerminalPdv()) {
        return;
    }

    try {
        if (window.electronAPI && typeof window.electronAPI.getTerminalInfo === 'function') {
            const info = window.electronAPI.getTerminalInfo();
            if (info && info.hostname) {
                terminalHostname = info.hostname;
                sessionStorage.setItem('cds_estacao_hostname', terminalHostname);
                sincronizarTerminalGlobalsPdv();
            }
        }

        if (!terminalHostname && typeof resolverHostnameEstacao === 'function') {
            terminalHostname = await resolverHostnameEstacao();
            sincronizarTerminalGlobalsPdv();
        }

        if (!terminalHostname) {
            const emElectron = typeof estaEmElectron === 'function' ? estaEmElectron() : Boolean(window.electronAPI);
            if (emElectron && tentativasRegistroTerminal < 16) {
                tentativasRegistroTerminal += 1;
                setTimeout(autoRegistrarTerminal, 500);
                return;
            }
            console.warn('PDV aberto, mas hostname da estação não foi detectado.');
            return;
        }

        tentativasRegistroTerminal = 0;
        console.log('Terminal PDV detectado:', terminalHostname);

        const headers = {};
        const token = localStorage.getItem('token');
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const usuario = obterUsuarioLogadoPdv();

        $.ajax({
            url: `${API_URL}/terminais/auto`,
            method: 'GET',
            data: {
                hostname: terminalHostname,
                origem: 'pdv',
                usuario_id: usuario.usuario_id || undefined,
                usuario_nome: usuario.usuario_nome || undefined
            },
            headers: headers,
            success: function(terminal) {
                terminalId = terminal.id;
                terminalNome = String(terminal.nome || terminal.hostname || '').trim();
                try {
                    if (terminalHostname && !String(terminalHostname).startsWith('pdv-')) {
                        localStorage.setItem('cds_pdv_hostname_preferido', terminalHostname);
                    }
                    if (terminal.caixa_id) {
                        localStorage.setItem('cds_pdv_caixa_id', String(terminal.caixa_id));
                    }
                } catch (e) { /* ignore */ }
                if (typeof atualizarContextoTerminalAtual === 'function') {
                    atualizarContextoTerminalAtual(terminal);
                }
                sincronizarTerminalGlobalsPdv();
                console.log('Terminal PDV registrado:', terminal);
                try {
                    window.dispatchEvent(new CustomEvent('cds:terminal-registrado', {
                        detail: {
                            terminalId: terminal.id,
                            caixaId: terminal.caixa_id || null
                        }
                    }));
                } catch (e) { /* ignore */ }
                if (typeof atualizarRotuloTerminalPdvSidebar === 'function') {
                    atualizarRotuloTerminalPdvSidebar();
                }
                if (typeof verificarStatusCaixa === 'function') {
                    verificarStatusCaixa();
                }
            },
            error: function(xhr) {
                console.warn('Erro ao registrar terminal PDV:', xhr.status, xhr.responseText);
                terminalId = null;
                if (typeof atualizarContextoTerminalAtual === 'function') {
                    atualizarContextoTerminalAtual(null);
                }
            }
        });

        if (!intervaloHeartbeatTerminal) {
            intervaloHeartbeatTerminal = setInterval(autoRegistrarTerminal, HEARTBEAT_TERMINAL_MS);
        }
    } catch (err) {
        console.error('Erro ao detectar terminal PDV:', err);
        terminalId = null;
        if (typeof atualizarContextoTerminalAtual === 'function') {
            atualizarContextoTerminalAtual(null);
        }
    }
}

function terminalPdvRegistrado() {
    return Number.isInteger(terminalId) && terminalId > 0;
}

function aguardarTerminalPdv(callback, tentativas = 0) {
    if (terminalPdvRegistrado()) {
        callback(true);
        return;
    }
    if (tentativas >= 40) {
        callback(false);
        return;
    }
    setTimeout(() => aguardarTerminalPdv(callback, tentativas + 1), 500);
}

window.terminalPdvRegistrado = terminalPdvRegistrado;
window.aguardarTerminalPdv = aguardarTerminalPdv;
window.sincronizarTerminalGlobalsPdv = sincronizarTerminalGlobalsPdv;
sincronizarTerminalGlobalsPdv();

function nomePerfilUsuario(usuario) {
    const perfil = String(usuario?.perfil || usuario?.nivel || usuario?.permissao || '')
        .trim()
        .toUpperCase();

    if (perfil === 'SUPER_ADMIN') return 'SUPER ADMIN';
    if (perfil === 'ADMIN') return 'ADMIN';
    if (perfil === 'OPERADOR' || perfil === 'USUARIO') return 'OPERADOR';

    return perfil || 'USUÁRIO';
}

function mostrarModalAutorizacaoSupervisor(onAuthorized, onCancel) {
    $('#modal-container').html(`
        <div class="modal fade" id="supervisorAuthModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content border-0 shadow">
                    <div class="modal-header bg-primary">
                        <h5 class="modal-title text-white mb-0">Autorização de Desconto</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-3">Somente administrador ou supervisor pode aplicar desconto. Informe a senha de autorização.</p>
                        <div class="mb-3">
                            <label for="supervisorUsername" class="form-label">Usuário</label>
                            <input type="text" class="form-control" id="supervisorUsername" autocomplete="username">
                        </div>
                        <div class="mb-3">
                            <label for="supervisorPassword" class="form-label">Senha</label>
                            <input type="password" class="form-control" id="supervisorPassword" autocomplete="current-password">
                        </div>
                        <div id="supervisorAuthError" class="text-danger small mb-2" style="display:none;"></div>
                        <div class="d-grid gap-2">
                            <button type="button" class="btn btn-primary" id="supervisorAuthSubmit">Autorizar</button>
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" id="supervisorAuthCancel">Cancelar</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('supervisorAuthModal');
    const modal = new bootstrap.Modal(modalEl, { backdrop: 'static' });
    let autorizado = false;
    modal.show();

    modalEl.addEventListener('hidden.bs.modal', function onHidden() {
        modalEl.removeEventListener('hidden.bs.modal', onHidden);
        if (!autorizado && typeof onCancel === 'function') {
            onCancel();
        }
    });

    $('#supervisorAuthSubmit').off('click').on('click', async function() {
        const username = $('#supervisorUsername').val().trim();
        const password = $('#supervisorPassword').val().trim();
        const errorEl = $('#supervisorAuthError');

        errorEl.hide();

        if (!username || !password) {
            errorEl.text('Informe usuário e senha.').show();
            return;
        }

        try {
            const response = await fetch(`${API_URL}/auth/supervisor/authorize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!response.ok) {
                errorEl.text(data?.error || 'Erro ao autorizar supervisão.').show();
                return;
            }

            supervisorAuthToken = data.token;
            autorizado = true;
            modal.hide();

            if (typeof onAuthorized === 'function') {
                onAuthorized();
            }
        } catch (error) {
            errorEl.text('Falha na autorização. Tente novamente.').show();
            console.error('Erro de autorização de supervisor:', error);
        }
    });
}

async function processarPagamentoTEF(tipo, valor, parcelas = 1, opcoes = {}) {
    try {
        if (window.__tefPagamentoEmAndamento) {
            showNotification('Já existe um pagamento TEF em andamento.', 'warning');
            return null;
        }

        window.__tefPagamentoEmAndamento = true;

        const tipoTef = TefFluxoPagamento.normalizarTipoTef(tipo);
        const ehPixTef = TefFluxoPagamento.ehPagamentoPixTef(tipoTef);

        showNotification(
            ehPixTef ? 'Gerando PIX TEF...' : 'Processando pagamento TEF...',
            'info'
        );

        const idempotencyKey = opcoes.idempotency_key
            || `pdv-${tipoTef}-${Number(valor).toFixed(2)}-${Date.now()}`;

        console.log('CHAMANDO TEF:', { tipo, tipoTef, valor, parcelas, idempotencyKey });

        const response = await fetch(`${API_URL}/tef/pagar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('token') || ''}`
            },
            body: JSON.stringify({
                tipo: tipoTef,
                valor: Number(valor),
                parcelas: Number(parcelas || 1),
                venda_id: opcoes.venda_id || null,
                idempotency_key: idempotencyKey
            })
        });

        const data = await response.json();

        console.log('RETORNO TEF:', data);

        if (response.status === 409 && data.codigo === 'TRANSACAO_DUPLICADA') {
            if (data.transacao_id && (data.aprovado || data.status === 'aprovado')) {
                showNotification('Pagamento TEF já autorizado.', 'info');
                return data;
            }
            throw new Error(data.mensagem || 'Transação TEF duplicada.');
        }

        if (!response.ok) {
            throw new Error(data.error || data.mensagem || 'Erro ao processar TEF.');
        }

        const aprovado = data.aprovado === true
            || data.sucesso === true
            || data.status === 'aprovado';

        if (!aprovado) {
            throw new Error(data.mensagem || 'Pagamento TEF negado.');
        }

        if (ehPixTef) {
            await mostrarModalPixTefPDV(data, valor);
        }

        showNotification(ehPixTef ? 'PIX TEF aprovado.' : 'Pagamento TEF aprovado.', 'success');

        try {
            await fetch(`${API_URL}/impressao/tef`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    comprovante_cliente: data.comprovante_cliente || data.comprovanteCliente,
                    comprovante_estabelecimento: data.comprovante_estabelecimento || data.comprovanteLoja
                })
            });

            console.log('Comprovante TEF enviado para impressão.');
        } catch (printError) {
            console.error('Erro impressão TEF:', printError);
        }

        return data;

    } catch (error) {
        console.error('Erro TEF:', error);
        showNotification(error.message || 'Erro ao processar TEF.', 'danger');
        return null;
    } finally {
        window.__tefPagamentoEmAndamento = false;
    }
}

function rotuloFormaRecebimentoNaoFiscal(forma) {
    const f = String(forma || '').toLowerCase().trim();
    if (f === 'pix') return 'PIX';
    if (f === 'dinheiro' || f === 'cash' || f === 'especie' || f === 'espécie') return 'Dinheiro';
    if (f.includes('credito') || f === 'credito') return 'Cartão de Crédito';
    if (f.includes('debito') || f === 'debito') return 'Cartão de Débito';
    if (f === 'cartao' || f.includes('cartao')) return 'Cartão';
    if (f === 'prazo') return 'A Prazo';
    return forma ? String(forma) : '—';
}

function isFormaDinheiroNaoFiscal(forma) {
    const f = String(forma || '').toLowerCase().trim();
    return f === 'dinheiro' || f === 'cash' || f === 'especie' || f === 'espécie';
}

/**
 * Resolve a única forma já escolhida para a parcela não fiscal.
 * Retorna null apenas se não for possível inferir (mantém seletor legado).
 */
function resolverFormaPagamentoNaoFiscalConhecida(opcoes = {}) {
    const mistos = Array.isArray(opcoes.pagamentosMistos) ? opcoes.pagamentosMistos : [];
    if (mistos.length > 0) {
        const formas = mistos
            .map((p) => String(p.forma_pagamento || p.forma || '').toLowerCase().trim())
            .filter(Boolean);
        const unicas = [...new Set(formas)];
        if (unicas.length === 1) return unicas[0];
        const dinheiro = mistos.find((p) => isFormaDinheiroNaoFiscal(p.forma_pagamento || p.forma));
        if (dinheiro) return String(dinheiro.forma_pagamento || dinheiro.forma).toLowerCase().trim();
    }

    const candidata = String(
        opcoes.formaPagamento
        || opcoes.forma_pagamento
        || formaPagamentoSelecionadaPDV
        || ''
    ).toLowerCase().trim();

    if (candidata && candidata !== 'misto') return candidata;
    return null;
}

/**
 * Sprint 3.11UX — confirmação inteligente do pagamento não fiscal.
 * Se a forma já foi escolhida, apenas confirma (não pergunta de novo).
 */
function abrirModalPagamentoNaoFiscal(valor, onConfirm, onCancel, formaPredefinida) {
    const valorNum = Number(valor || 0);
    const formaConhecida = formaPredefinida
        ? String(formaPredefinida).toLowerCase().trim()
        : resolverFormaPagamentoNaoFiscalConhecida({
            pagamentosMistos,
            formaPagamento: formaPagamentoSelecionadaPDV
        });
    const modoConfirmacao = Boolean(formaConhecida);

    if (valorNum <= 0) {
        if (typeof onConfirm === 'function') {
            onConfirm({
                forma_pagamento: formaConhecida || 'dinheiro',
                valor: 0
            });
        }
        return;
    }

    const rotuloForma = rotuloFormaRecebimentoNaoFiscal(formaConhecida || 'pix');
    const corpoConfirmacao = modoConfirmacao
        ? `
            <p class="text-muted mb-2">Confirme o Recebimento B.</p>
            <h4 class="text-center mb-3">Valor: ${formatCurrency(valorNum)}</h4>
            <div class="p-3 bg-light rounded text-center mb-2">
                <small class="text-muted d-block mb-1">Forma de recebimento</small>
                <strong class="fs-5">${rotuloForma}</strong>
            </div>
            ${isFormaDinheiroNaoFiscal(formaConhecida) ? `
            <div id="nao-fiscal-dinheiro-area" class="mt-3 p-3 bg-light rounded">
                <label for="nao-fiscal-valor-recebido" class="form-label fw-bold">Valor Recebido:</label>
                <input type="number" step="0.01" class="form-control form-control-lg text-end" id="nao-fiscal-valor-recebido" placeholder="0,00">
                <div class="mt-2">
                    <span class="fw-bold text-success">Troco: </span>
                    <span id="nao-fiscal-troco">${formatCurrency(0)}</span>
                </div>
            </div>` : ''}
        `
        : `
            <p class="text-muted mb-2">Confirme o Recebimento B.</p>
            <h4 class="text-center mb-3">Valor: ${formatCurrency(valorNum)}</h4>
            <div class="payment-methods mb-3 d-flex flex-wrap gap-2">
                <button type="button" class="nao-fiscal-method-btn btn btn-outline-primary active" data-pagamento="pix">PIX</button>
                <button type="button" class="nao-fiscal-method-btn btn btn-outline-primary" data-pagamento="dinheiro">Dinheiro</button>
                <button type="button" class="nao-fiscal-method-btn btn btn-outline-primary" data-pagamento="cartao">Cartão</button>
            </div>
            <div id="nao-fiscal-dinheiro-area" style="display:none;" class="mt-3 p-3 bg-light rounded">
                <label for="nao-fiscal-valor-recebido" class="form-label fw-bold">Valor Recebido:</label>
                <input type="number" step="0.01" class="form-control form-control-lg text-end" id="nao-fiscal-valor-recebido" placeholder="0,00">
                <div class="mt-2">
                    <span class="fw-bold text-success">Troco: </span>
                    <span id="nao-fiscal-troco">${formatCurrency(0)}</span>
                </div>
            </div>
        `;

    const modalHtml = `
        <div class="modal fade" id="pagamentoNaoFiscalModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${modoConfirmacao ? 'Recebimento B' : 'Recebimento B'}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        ${corpoConfirmacao}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="confirmar-pagamento-nao-fiscal">Confirmar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#modal-container').html(modalHtml);

    const modalEl = document.getElementById('pagamentoNaoFiscalModal');
    const modal = new bootstrap.Modal(modalEl);
    let formaSelecionada = formaConhecida || 'pix';
    let confirmado = false;

    function atualizarTrocoNaoFiscal() {
        const recebido = parseFloat($('#nao-fiscal-valor-recebido').val()) || 0;
        const troco = Math.max(0, recebido - valorNum);
        $('#nao-fiscal-troco').text(formatCurrency(troco));
    }

    function selecionarFormaNaoFiscal(tipo) {
        formaSelecionada = tipo;
        $('.nao-fiscal-method-btn').removeClass('active btn-primary').addClass('btn-outline-primary');
        $(`.nao-fiscal-method-btn[data-pagamento="${tipo}"]`).removeClass('btn-outline-primary').addClass('active btn-primary');

        if (isFormaDinheiroNaoFiscal(tipo)) {
            $('#nao-fiscal-dinheiro-area').show();
            $('#nao-fiscal-valor-recebido').val(valorNum.toFixed(2));
            atualizarTrocoNaoFiscal();
        } else {
            $('#nao-fiscal-dinheiro-area').hide();
        }
    }

    modalEl.addEventListener('hidden.bs.modal', function handler() {
        modalEl.removeEventListener('hidden.bs.modal', handler);
        $(document).off('keydown.recebimentoBModal');
        $('#nao-fiscal-valor-recebido').off('keydown.recebimentoB');
        if (!confirmado && typeof onCancel === 'function') {
            onCancel();
        }
    }, { once: true });

    if (!modoConfirmacao) {
        $('.nao-fiscal-method-btn').off('click').on('click', function () {
            selecionarFormaNaoFiscal($(this).data('pagamento'));
        });
    }

    $('#nao-fiscal-valor-recebido').off('input').on('input', atualizarTrocoNaoFiscal);

    function confirmarPagamentoNaoFiscal() {
        if (confirmado) return;
        if (isFormaDinheiroNaoFiscal(formaSelecionada)) {
            const $recebido = $('#nao-fiscal-valor-recebido');
            if ($recebido.length) {
                const recebido = parseFloat($recebido.val()) || 0;
                if (recebido + 0.009 < valorNum) {
                    showNotification('Valor recebido insuficiente.', 'warning');
                    return;
                }
            }
        }

        confirmado = true;
        $(document).off('keydown.recebimentoBModal');
        $('#nao-fiscal-valor-recebido').off('keydown.recebimentoB');
        modal.hide();
        if (typeof onConfirm === 'function') {
            onConfirm({
                forma_pagamento: formaSelecionada,
                valor: valorNum,
                valor_recebido: isFormaDinheiroNaoFiscal(formaSelecionada)
                    ? (parseFloat($('#nao-fiscal-valor-recebido').val()) || valorNum)
                    : undefined
            });
        }
    }

    $('#confirmar-pagamento-nao-fiscal').off('click').on('click', confirmarPagamentoNaoFiscal);
    $('#nao-fiscal-valor-recebido').off('keydown.recebimentoB').on('keydown.recebimentoB', function (e) {
        if (e.key === 'Enter' || e.which === 13) {
            e.preventDefault();
            confirmarPagamentoNaoFiscal();
        }
    });
    $(document).off('keydown.recebimentoBModal').on('keydown.recebimentoBModal', function (e) {
        if ((e.key !== 'Enter' && e.which !== 13) || !$('#pagamentoNaoFiscalModal').hasClass('show')) {
            return;
        }
        if ($(e.target).is('textarea')) return;
        e.preventDefault();
        confirmarPagamentoNaoFiscal();
    });

    modal.show();
    if (modoConfirmacao) {
        if (isFormaDinheiroNaoFiscal(formaSelecionada) && $('#nao-fiscal-valor-recebido').length) {
            $('#nao-fiscal-valor-recebido').val(valorNum.toFixed(2));
            atualizarTrocoNaoFiscal();
            setTimeout(() => $('#nao-fiscal-valor-recebido').trigger('focus'), 50);
        } else {
            setTimeout(() => $('#confirmar-pagamento-nao-fiscal').trigger('focus'), 50);
        }
    } else {
        selecionarFormaNaoFiscal('pix');
    }
}

function abrirModalConfirmacaoFiscalManual(valor, onConfirm, onCancel) {
    const valorNum = Number(valor || 0);

    if (valorNum <= 0) {
        if (typeof onConfirm === 'function') {
            onConfirm();
        }
        return;
    }

    const modalHtml = `
        <div class="modal fade" id="confirmacaoFiscalManualModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Confirmação de Recebimento A</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-2">Recebimento A</p>
                        <h4 class="text-center mb-0">Valor: ${formatCurrency(valorNum)}</h4>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="confirmar-recebimento-fiscal-manual">Confirmar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#modal-container').html(modalHtml);

    const modalEl = document.getElementById('confirmacaoFiscalManualModal');
    const modal = new bootstrap.Modal(modalEl);
    let confirmado = false;

    modalEl.addEventListener('hidden.bs.modal', function handler() {
        modalEl.removeEventListener('hidden.bs.modal', handler);
        if (!confirmado && typeof onCancel === 'function') {
            onCancel();
        }
    }, { once: true });

    function confirmarRecebimentoFiscalManual() {
        if (confirmado) return;
        confirmado = true;
        $(document).off('keydown.recebimentoA');
        modal.hide();
        if (typeof onConfirm === 'function') {
            onConfirm();
        }
    }

    $('#confirmar-recebimento-fiscal-manual').off('click').on('click', confirmarRecebimentoFiscalManual);
    $(document).off('keydown.recebimentoA').on('keydown.recebimentoA', function (e) {
        if ((e.key !== 'Enter' && e.which !== 13) || !$('#confirmacaoFiscalManualModal').hasClass('show')) {
            return;
        }
        if ($(e.target).is('textarea')) return;
        e.preventDefault();
        confirmarRecebimentoFiscalManual();
    });

    modalEl.addEventListener('hidden.bs.modal', function limparAtalho() {
        modalEl.removeEventListener('hidden.bs.modal', limparAtalho);
        $(document).off('keydown.recebimentoA');
    }, { once: true });

    modal.show();
}

async function obterModoConfirmacaoFiscal() {
    try {
        const response = await fetch(`${API_URL}/configuracoes-avancadas/confirmacao-fiscal`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token') || ''}`
            }
        });

        if (!response.ok) {
            return 'TEF';
        }

        const data = await response.json();
        const modo = String(data.modo_confirmacao_fiscal || 'TEF').toUpperCase().trim();
        return modo === 'MANUAL' ? 'MANUAL' : 'TEF';
    } catch (error) {
        console.error('Erro ao obter modo de confirmação fiscal:', error);
        return 'TEF';
    }
}

async function obterTefHabilitadoConfig() {
    try {
        const response = await fetch(`${API_URL}/tef/fluxo-pdv`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`
            }
        });
        if (!response.ok) return false;
        const fluxo = await response.json();
        return fluxo.tefHabilitado === true;
    } catch (error) {
        console.error('Erro ao verificar configuração TEF:', error);
        return false;
    }
}

function pagamentoMistoExigeTef(pagamentos) {
    return (pagamentos || []).some((pagamento) =>
        formaPagamentoUsaTEF(normalizarFormaPagamentoTEF(pagamento.forma_pagamento))
    );
}

async function confirmarRecebimentoFiscalManual(valorFiscal) {
    await new Promise((resolve, reject) => {
        abrirModalConfirmacaoFiscalManual(
            valorFiscal,
            resolve,
            () => reject(new Error('Recebimento A cancelado.'))
        );
    });
}

function decidirFluxoRecebimentosAB(valorA, valorB, opcoes) {
    opcoes = opcoes || {};
    const totalComercial = Math.round(Number(
        opcoes.totalComercial != null ? opcoes.totalComercial : (Number(valorA || 0) + Number(valorB || 0))
    ) * 100) / 100;
    const fluxoFiscal = opcoes.fluxoVendaFiscal === true;

    if (!fluxoFiscal) {
        const b = totalComercial > 0
            ? totalComercial
            : Math.round(Number(valorB || 0) * 100) / 100;
        return {
            fluxoVenda: 'nao_fiscal',
            valorA: 0,
            valorB: b,
            abrirA: false,
            abrirB: b > 0,
            somenteA: false,
            somenteB: b > 0,
            mista: false,
            ordem: b > 0 ? ['B'] : []
        };
    }

    const a = Math.round(Number(valorA || 0) * 100) / 100;
    const b = Math.round(Number(valorB || 0) * 100) / 100;
    const abrirA = a > 0;
    const abrirB = b > 0;
    const ordem = [];
    if (abrirA) ordem.push('A');
    if (abrirB) ordem.push('B');
    return {
        fluxoVenda: 'fiscal',
        valorA: a,
        valorB: b,
        abrirA,
        abrirB,
        somenteA: abrirA && !abrirB,
        somenteB: !abrirA && abrirB,
        mista: abrirA && abrirB,
        ordem
    };
}

async function confirmarRecebimentoB(valorB) {
    const valor = Math.round(Number(valorB || 0) * 100) / 100;
    if (!(valor > 0)) return;
    const formaNaoFiscal = resolverFormaPagamentoNaoFiscalConhecida({
        pagamentosMistos,
        formaPagamento: formaPagamentoSelecionadaPDV
    });
    await new Promise((resolve, reject) => {
        abrirModalPagamentoNaoFiscal(
            valor,
            resolve,
            () => reject(new Error('Recebimento B cancelado.')),
            formaNaoFiscal
        );
    });
}

if (typeof window !== 'undefined') {
    window.decidirFluxoRecebimentosAB = decidirFluxoRecebimentosAB;
}

function distribuirQuantidadeVendaLocal(quantidadeVendida, saldoFiscal, saldoNaoFiscal, vendaFiscal = false) {
    quantidadeVendida = Number(quantidadeVendida || 0);
    saldoFiscal = Number(saldoFiscal || 0);
    saldoNaoFiscal = Number(saldoNaoFiscal || 0);
    const priorizarFiscal = vendaFiscal === true;

    const estoqueTotal = saldoFiscal + saldoNaoFiscal;
    let quantidadeFiscal;
    let quantidadeNaoFiscal;

    if (quantidadeVendida > estoqueTotal) {
        if (!pdvPermitirVendaSemEstoque()) {
            return {
                sucesso: false,
                estoqueTotal
            };
        }
        const nfDisponivel = Math.max(0, saldoNaoFiscal);
        const fDisponivel = Math.max(0, saldoFiscal);
        if (priorizarFiscal) {
            quantidadeFiscal = Math.max(fDisponivel, quantidadeVendida - nfDisponivel);
            quantidadeNaoFiscal = quantidadeVendida - quantidadeFiscal;
        } else {
            quantidadeNaoFiscal = Math.max(nfDisponivel, quantidadeVendida - fDisponivel);
            quantidadeFiscal = quantidadeVendida - quantidadeNaoFiscal;
        }
        return {
            sucesso: true,
            quantidadeFiscal,
            quantidadeNaoFiscal,
            estoqueTotal
        };
    }

    if (priorizarFiscal) {
        quantidadeFiscal = Math.min(quantidadeVendida, saldoFiscal);
        quantidadeNaoFiscal = quantidadeVendida - quantidadeFiscal;
    } else {
        quantidadeNaoFiscal = Math.min(quantidadeVendida, saldoNaoFiscal);
        quantidadeFiscal = quantidadeVendida - quantidadeNaoFiscal;
    }

    return {
        sucesso: true,
        quantidadeFiscal,
        quantidadeNaoFiscal
    };
}

function calcularDistribuicaoFiscalLocal(itens, vendaFiscal = false) {
    let totalFiscal = 0;
    let totalNaoFiscal = 0;
    const itensDistribuidos = [];

    for (const item of itens) {
        const produto = produtosDisponiveis.find(
            (p) => Number(p.id) === Number(item.produto_id || item.id)
        );
        const saldos = pdvResolverSaldosProduto(produto || {});
        const qtdVenda = Number(item.quantidade || 0);
        const qtdEstoque = item.quantidade_estoque != null && item.quantidade_estoque !== ''
            ? Number(item.quantidade_estoque)
            : qtdVenda;
        const controlaEstoque = produtoControlaEstoquePdv(produto);
        let saldoFiscalMotor = controlaEstoque ? saldos.saldo_fiscal : qtdEstoque;
        let saldoNaoFiscalMotor = controlaEstoque ? saldos.saldo_nao_fiscal : qtdEstoque;
        const intentTransf = Number(item.transferencia_nao_fiscal_para_fiscal || 0);
        if (controlaEstoque && intentTransf > 0) {
            const prep = calcularTransferenciaNaoFiscalParaFiscalPdv({
                quantidade: qtdEstoque,
                saldoFiscal: saldoFiscalMotor,
                saldoNaoFiscal: saldoNaoFiscalMotor
            });
            if (prep.podeTransferir) {
                saldoFiscalMotor = prep.saldoFiscal + prep.quantidadeTransferir;
                saldoNaoFiscalMotor = prep.saldoNaoFiscal - prep.quantidadeTransferir;
            }
        }
        const resultado = distribuirQuantidadeVendaLocal(
            qtdEstoque,
            saldoFiscalMotor,
            saldoNaoFiscalMotor,
            vendaFiscal
        );

        if (!resultado.sucesso) {
            return {
                sucesso: false,
                error: `Saldo insuficiente para ${produto?.nome || 'produto'}. Disponível: ${resultado.estoqueTotal}`
            };
        }

        const precoUnitario = Number(item.preco_unitario || 0);
        const subtotalVenda = Number((qtdVenda * precoUnitario).toFixed(2));
        let valorFiscal;
        let valorNaoFiscal;

        if (qtdEstoque > 0 && qtdEstoque !== qtdVenda) {
            const ratioFiscal = resultado.quantidadeFiscal / qtdEstoque;
            valorFiscal = Number((subtotalVenda * ratioFiscal).toFixed(2));
            valorNaoFiscal = Number((subtotalVenda - valorFiscal).toFixed(2));
        } else {
            valorFiscal = Number((resultado.quantidadeFiscal * precoUnitario).toFixed(2));
            valorNaoFiscal = Number((resultado.quantidadeNaoFiscal * precoUnitario).toFixed(2));
        }

        totalFiscal += valorFiscal;
        totalNaoFiscal += valorNaoFiscal;

        itensDistribuidos.push({
            produto_id: item.produto_id || item.id,
            quantidade_fiscal: resultado.quantidadeFiscal,
            quantidade_nao_fiscal: resultado.quantidadeNaoFiscal,
            valor_fiscal: valorFiscal,
            valor_nao_fiscal: valorNaoFiscal
        });
    }

    return {
        sucesso: true,
        valor_fiscal: Number(totalFiscal.toFixed(2)),
        valor_nao_fiscal: Number(totalNaoFiscal.toFixed(2)),
        itens: itensDistribuidos
    };
}

/**
 * Pré-cálculo fiscal (Hotfix 3.11A + RC7.10.1): envia pagamentos e
 * desconto/acréscimo para o backend aplicar Valor Fiscal Líquido oficial.
 * Não converte / não resume o vetor — payload original do operador.
 */
async function precalcularDistribuicaoFiscalVenda(
    itens,
    vendaFiscal = false,
    pagamentos = [],
    desconto = 0,
    acrescimo = 0
) {
    const pagamentosPayload = Array.isArray(pagamentos) ? pagamentos : [];
    try {
        const response = await fetch(`${API_URL}/vendas/pre-calcular-distribuicao`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('token') || ''}`
            },
            body: JSON.stringify(getTerminalRequestData({
                itens,
                emitir_fiscal: vendaFiscal,
                pagamentos: pagamentosPayload,
                desconto: Number(desconto || 0),
                acrescimo: Number(acrescimo || 0)
            }))
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok && data.sucesso) {
            return { ...data, liquido_aplicado_backend: true };
        }

        if (!response.ok && data.error) {
            return { sucesso: false, error: data.error };
        }
    } catch (error) {
        console.warn('Falha na API pre-calcular-distribuicao, usando cálculo local:', error);
    }

    return calcularDistribuicaoFiscalLocal(itens, vendaFiscal);
}

/**
 * Fallback local — espelho do cálculo oficial backend/services/vendas/valorFiscalLiquido.js
 * (RC7.10.1). Usado só se o pré-cálculo remoto falhar.
 */
function aplicarDescontoProporcionalDistribuicao(distribuicao, subtotal, desconto, acrescimo = 0) {
    const brutoFiscal = Number(distribuicao?.valor_fiscal || 0);
    const brutoNaoFiscal = Number(distribuicao?.valor_nao_fiscal || 0);
    const subtotalNum = Number(subtotal || 0) > 0
        ? Number(subtotal || 0)
        : Math.round((brutoFiscal + brutoNaoFiscal) * 100) / 100;
    const descontoNum = Math.max(0, Number(desconto || 0));
    const acrescimoNum = Math.max(0, Number(acrescimo || 0));
    const totalLiquido = Math.max(0, Math.round((subtotalNum - descontoNum + acrescimoNum) * 100) / 100);

    if (subtotalNum <= 0 || (descontoNum <= 0 && acrescimoNum <= 0) || totalLiquido === subtotalNum) {
        return {
            valor_fiscal: brutoFiscal,
            valor_nao_fiscal: brutoNaoFiscal
        };
    }

    const fator = totalLiquido / subtotalNum;
    let valorFiscal = Math.round(brutoFiscal * fator * 100) / 100;
    let valorNaoFiscal = Math.round(brutoNaoFiscal * fator * 100) / 100;
    const diff = Math.round((totalLiquido - valorFiscal - valorNaoFiscal) * 100) / 100;

    if (diff !== 0) {
        if (valorFiscal >= valorNaoFiscal) {
            valorFiscal = Math.round((valorFiscal + diff) * 100) / 100;
        } else {
            valorNaoFiscal = Math.round((valorNaoFiscal + diff) * 100) / 100;
        }
    }

    return {
        valor_fiscal: valorFiscal,
        valor_nao_fiscal: valorNaoFiscal
    };
}

async function processarVendaFiscalManual(dadosVenda, valorFiscal) {
    try {
        await confirmarRecebimentoFiscalManual(valorFiscal);
        pagamentoFiscalAtual = { manual: true, valor: valorFiscal };
        return { sucesso: true };
    } catch (error) {
        console.error('Erro na confirmação fiscal manual:', error);
        pagamentoFiscalAtual = null;
        return { sucesso: false, erro: error.message };
    }
}

async function processarVendaFiscalNaoFiscal(dadosVenda, totalFiscal) {
    try {
        const formaFiscal = obterFormaPagamentoFiscal();
        const retorno = await processarPagamentoTEF(formaFiscal, totalFiscal, 1);

        if (!retorno || !(retorno.aprovado || retorno.sucesso || retorno.status === 'aprovado')) {
            throw new Error('Recebimento A não aprovado.');
        }

        pagamentoFiscalAtual = retorno;

        dadosVenda.pagamentoFiscal = {
            valor: totalFiscal,
            nsu: retorno.nsu,
            autorizacao: retorno.autorizacao,
            transacao_id: retorno.transacao_id
        };

        return { sucesso: true, tefFiscal: retorno };
    } catch (error) {
        console.error('Erro ao processar Recebimento A:', error);
        pagamentoFiscalAtual = null;
        return { sucesso: false, erro: error.message };
    }
}

function normalizarFormaPagamentoTEF(forma) {
    return TefFluxoPagamento.normalizarFormaPagamentoTEF(forma);
}

function formaPagamentoUsaTEF(forma) {
    return TefFluxoPagamento.formaPagamentoUsaTEF(forma);
}

function formaPagamentoGravacaoFiscalPDV(forma) {
    return TefFluxoPagamento.formaPagamentoGravacaoFiscal(forma);
}

function deveEnviarPagamentosProcessadosPdv(totalFiscal, totalNaoFiscal) {
    return Number(totalFiscal || 0) > 0 && Number(totalNaoFiscal || 0) <= 0;
}

function pdvVendaMistaFiscalNaoFiscal(totalFiscal, totalNaoFiscal) {
    return Number(totalFiscal || 0) > 0 && Number(totalNaoFiscal || 0) > 0;
}

function anexarTefAoPrimeiroPagamento(pagamentos, tef) {
    if (!tef || !Array.isArray(pagamentos) || pagamentos.length === 0) {
        return pagamentos;
    }
    return pagamentos.map((pagamento, indice) => {
        if (indice !== 0) return pagamento;
        return {
            ...pagamento,
            tef_transacao_id: tef.transacao_id || pagamento.tef_transacao_id,
            nsu: tef.nsu || pagamento.nsu,
            autorizacao: tef.autorizacao || pagamento.autorizacao,
            bandeira: tef.bandeira || pagamento.bandeira,
            adquirente: tef.adquirente || pagamento.adquirente
        };
    });
}

function normalizarPagamentosSemTef(pagamentos) {
    return (pagamentos || [])
        .filter((pagamento) => Number(pagamento.valor) > 0)
        .map((pagamento) => ({
            ...pagamento,
            forma_pagamento: normalizarFormaPagamentoTEF(pagamento.forma_pagamento),
            valor: Number(pagamento.valor)
        }));
}

async function concluirPagamentoNaoFiscalVenda(vendaId, pagamento, emitirFiscal = false) {
    if (!obterTerminalIdPdv()) {
        throw new Error('Terminal não registrado. Aguarde o registro do PDV ou reinicie a aplicação.');
    }

    const response = await fetch(`${API_URL}/vendas/${vendaId}/pagamento-nao-fiscal`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(getTerminalRequestData({
            pagamentos: [pagamento],
            emitir_fiscal: emitirFiscal
        }))
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || 'Erro ao registrar pagamento não fiscal.');
    }

    return data;
}

async function obterSaldoPagamentoNaoFiscalVenda(vendaId) {
    const response = await fetch(
        `${API_URL}/vendas/${vendaId}/pagamento-nao-fiscal${buildTerminalQueryString()}`,
        {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
    }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || 'Erro ao consultar pagamento não fiscal da venda.');
    }

    return data;
}

function fiscalAutorizadaParaImpressao(fiscal) {
    if (!fiscal || typeof fiscal !== 'object') {
        return false;
    }

    if (fiscal.status === 'sem_itens_fiscais') {
        return false;
    }

    if (fiscal.success === false) {
        return false;
    }

    return fiscal.status === 'autorizada' || fiscal.reused === true;
}

function processarFiscalPosPagamentoPosVenda(vendaId, resultado) {
    pagamentoFiscalAtual = null;
    const fiscal = resultado?.fiscal;

    if (fiscal?.status === 'sem_itens_fiscais') {
        showNotification(
            fiscal.message || 'Venda sem itens fiscais. NFC-e não necessária.',
            'info'
        );
        return;
    }

    if (fiscal?.success === false) {
        showNotification(fiscal.message || 'Erro ao emitir NFC-e.', 'danger');
        mostrarModalErroNFCe(vendaId, fiscal.message || 'NFC-e não autorizada.');
        return;
    }

    if (fiscalAutorizadaParaImpressao(fiscal)) {
        showNotification('NFC-e autorizada pela SEFAZ!', 'success');
        imprimirDANFEFiscal(vendaId, { automatico: true });
        return;
    }

    showNotification('Venda finalizada. Emitindo NFC-e...', 'info');
    mostrarModalProcessandoNFCe(vendaId);
    setTimeout(() => emitirNFCeVenda(vendaId), 300);
}

function pdvVendaRespostaQuitada(response) {
    return String(response && response.status_pagamento ? response.status_pagamento : '')
        .toLowerCase()
        .trim() === 'quitada';
}

function iniciarFluxoPosVendaComNaoFiscal(vendaId, opcoes = {}) {
    const processarFiscalPosPagamento =
        opcoes.processarFiscalPosPagamento || processarFiscalPosPagamentoPosVenda;

    obterSaldoPagamentoNaoFiscalVenda(vendaId)
        .then(function(info) {
            if (pdvVendaRespostaQuitada(info) || Number(info.saldo_pendente) <= 0) {
                finalizarPosVenda();
                vendaEmProcessamento = false;
                showNotification('Venda finalizada com sucesso.', 'success');
                return;
            }

            showNotification('Recebimento A confirmado. Confirme o Recebimento B.', 'info');

            const valorPendente = Number(
                info.saldo_pendente ??
                info.valor_nao_fiscal ??
                0
            );
            const emitirFiscal = opcoes.emitirFiscal === true
                || (opcoes.emitirFiscal !== false && pdvEmitirFiscalNaVenda === true);

            abrirModalPagamentoNaoFiscal(
                valorPendente,
                async function(pagamento) {
                    try {
                        const resultado = await concluirPagamentoNaoFiscalVenda(
                            vendaId,
                            pagamento,
                            emitirFiscal
                        );

                        processarFiscalPosPagamento(vendaId, resultado);

                        finalizarPosVenda();
                        vendaEmProcessamento = false;
                        showNotification('Venda finalizada com sucesso.', 'success');
                    } catch (error) {
                        vendaEmProcessamento = false;
                        showNotification(error.message || 'Erro ao registrar pagamento não fiscal.', 'danger');
                    }
                },
                function() {
                    vendaEmProcessamento = false;
                    finalizarPosVenda();
                    showNotification(
                        `Venda #${vendaId} aguardando pagamento não fiscal.`,
                        'warning'
                    );
                },
                resolverFormaPagamentoNaoFiscalConhecida({
                    pagamentosMistos,
                    formaPagamento: formaPagamentoSelecionadaPDV
                })
            );
        })
        .catch(function(error) {
            vendaEmProcessamento = false;
            showNotification(error.message || 'Erro ao consultar pagamento não fiscal.', 'danger');
        });
}


async function mostrarModalPixTefPDV(data, valor) {
    const copiaCola = data.pix_copia_cola
        || data.payloadRetorno?.pix_copia_cola
        || data.payload_retorno?.pix_copia_cola
        || '';

    return new Promise((resolve) => {
        const qrPlaceholder = `
            <div class="border rounded p-3 mb-2" style="min-height:180px;display:flex;align-items:center;justify-content:center;background:#f8fafc;">
                <div class="text-center">
                    <div style="font-size:3rem;line-height:1;">&#9641;</div>
                    <small class="text-muted d-block mt-2">QR Code PIX TEF (tela do PC)</small>
                    <small class="text-muted">Na homologação: QR gerado pelo CliSiTef/PayGo</small>
                </div>
            </div>`;

        $('#modal-container').html(`
            <div class="modal fade" id="modalPixTefPDV" tabindex="-1" data-bs-backdrop="static">
                <div class="modal-dialog modal-dialog-centered" style="max-width:420px;">
                    <div class="modal-content border-0 shadow" style="border-radius:12px;overflow:hidden;">
                        <div class="modal-header text-white py-2 px-3" style="background:#0f766e;">
                            <div>
                                <h6 class="modal-title mb-0 fw-bold">PIX TEF</h6>
                                <small class="opacity-75" style="font-size:0.75rem;">Pagamento aprovado via middleware</small>
                            </div>
                        </div>
                        <div class="modal-body p-3 text-center">
                            <div class="mb-2" style="color:#0f766e;font-weight:700;font-size:1.4rem;">
                                R$ ${Number(valor).toFixed(2).replace('.', ',')}
                            </div>
                            ${qrPlaceholder}
                            <label class="form-label small text-start w-100 mb-1">Pix Copia e Cola</label>
                            <textarea id="pixTefCopiaColaPDV" class="form-control form-control-sm" rows="3" readonly style="font-size:0.7rem;">${copiaCola || 'Aguardando retorno do middleware na homologação.'}</textarea>
                            <button type="button" class="btn btn-sm btn-outline-secondary mt-2" id="btnCopiarPixTefPDV">Copiar código PIX</button>
                        </div>
                        <div class="modal-footer py-2">
                            <button type="button" class="btn btn-success w-100" id="btnFecharPixTefPDV">Continuar venda</button>
                        </div>
                    </div>
                </div>
            </div>
        `);

        const modalEl = document.getElementById('modalPixTefPDV');
        const modal = new bootstrap.Modal(modalEl);

        $('#btnCopiarPixTefPDV').on('click', function() {
            const texto = $('#pixTefCopiaColaPDV').val();
            if (navigator.clipboard && texto) {
                navigator.clipboard.writeText(texto);
                showNotification('Código PIX copiado.', 'success');
            }
        });

        $('#btnFecharPixTefPDV').on('click', function() {
            modal.hide();
            resolve();
        });

        modalEl.addEventListener('hidden.bs.modal', () => resolve(), { once: true });
        modal.show();
    });
}

function obterFormaPagamentoFiscal() {
    const forma = formaPagamentoSelecionadaPDV || $('#formaPagamentoPdv').val() || 'cartao';
    return normalizarFormaPagamentoTEF(forma);
}

function montarObjetoTEF(retornoTef) {
    return {
        transacao_id: retornoTef.transacao_id,
        provedor: retornoTef.provedor,
        adquirente: retornoTef.adquirente,
        bandeira: retornoTef.bandeira,
        nsu: retornoTef.nsu,
        autorizacao: retornoTef.autorizacao,
        codigo_transacao: retornoTef.codigo_transacao,
        comprovante_cliente: retornoTef.comprovante_cliente,
        comprovante_estabelecimento: retornoTef.comprovante_estabelecimento,
        cnpj_credenciadora: retornoTef.cnpj_credenciadora || '01425787000104'
    };
}

async function processarPagamentosMistosTEF(pagamentos) {
    const pagamentosProcessados = [];
    const tefHabilitado = await obterTefHabilitadoConfig();

    for (const pagamento of pagamentos) {
        const formaNormalizada = normalizarFormaPagamentoTEF(pagamento.forma_pagamento);
        const valorPagamento = Number(pagamento.valor || 0);

        if (valorPagamento <= 0) {
            continue;
        }

        if (!formaPagamentoUsaTEF(formaNormalizada) || !tefHabilitado) {
            pagamentosProcessados.push(pagamento);
            continue;
        }

        const parcelasTef = formaNormalizada.includes('credito') ? 1 : 1;

        const retornoTef = await processarPagamentoTEF(
            TefFluxoPagamento.normalizarTipoTef(formaNormalizada),
            valorPagamento,
            parcelasTef
        );

        if (!retornoTef || !(retornoTef.aprovado || retornoTef.sucesso || retornoTef.status === 'aprovado')) {
            throw new Error(`Pagamento TEF não aprovado para ${pagamento.forma_pagamento}.`);
        }

        const tef = montarObjetoTEF(retornoTef);

        pagamentosProcessados.push({
            ...pagamento,
            forma_pagamento: formaPagamentoGravacaoFiscalPDV(formaNormalizada),
            valor: valorPagamento,
            tef_transacao_id: retornoTef.transacao_id,
            tef,
            nsu: retornoTef.nsu,
            autorizacao: retornoTef.autorizacao,
            bandeira: retornoTef.bandeira,
            adquirente: retornoTef.adquirente
        });
    }

    return pagamentosProcessados;
}

function inicializarPDV() {
    const usuarioLogado = JSON.parse(localStorage.getItem('user') || '{}');
    const nomeOperador = usuarioLogado.nome || usuarioLogado.username || 'Usuário';
    const perfilOperador = nomePerfilUsuario(usuarioLogado);

    $('#operadorPdv').text(`Operador: ${nomeOperador} - ${perfilOperador}`);

    if (typeof aplicarModoFiscalPdv === 'function') {
        aplicarModoFiscalPdv();
    }

    const vendaRestaurada = restaurarVendaAbertaPdv();

    verificarStatusCaixa();
    atualizarCarrinho();
    iniciarRelogioPDV();
    bindEventosPDV();
    if (vendaRestaurada) {
        aplicarUiVendaRestauradaPdv();
        atualizarCarrinho();
    }
    hidratarUltimoProdutoCatalogoPdv();
    focarCampoCodigo();

    if (window.PdvAppearancePanel && typeof PdvAppearancePanel.mountOnPdv === 'function') {
        PdvAppearancePanel.mountOnPdv();
    }

    // Sprint 1 — infraestrutura de widgets do rodapé
    if (window.PdvFooterWidgets && typeof PdvFooterWidgets.init === 'function') {
        PdvFooterWidgets.init();
    }
    // Sprint 3 — ativa widget Entregas / Prestação (somente se módulo ligado)
    if (window.PdvPrestacaoEntrega && typeof PdvPrestacaoEntrega.init === 'function') {
        PdvPrestacaoEntrega.init();
    }

    // UX-01 — botão Entrega (visível só com módulo + itens)
    if (window.PdvVendaEntrega && typeof PdvVendaEntrega.initUi === 'function') {
        PdvVendaEntrega.initUi();
    }

    // Verificar status do caixa a cada 30 segundos
    setInterval(verificarStatusCaixa, 30000);
}

// Verificar status do caixa
function verificarStatusCaixa() {
    const consultar = () => {
        $.ajax({
            url: `${API_URL}/caixa/aberto`,
            method: 'GET',
            cache: false,
            data: getTerminalRequestQuery(),
            success: function(caixa) {
                caixaAberto = !!caixa;
                atualizarStatusCaixaUI();
            },
            error: function(xhr) {
                if (xhr.status === 400 && !terminalPdvRegistrado()) {
                    return;
                }
                caixaAberto = false;
                atualizarStatusCaixaUI();
            }
        });
    };

    if (typeof aguardarTerminalPdv === 'function' && typeof terminalPdvRegistrado === 'function') {
        aguardarTerminalPdv((registrado) => {
            if (registrado) consultar();
        });
        return;
    }

    consultar();
}

// Atualizar UI do status do caixa
function atualizarStatusCaixaUI() {
    const statusEl = $('#statusCaixaPdv');
    const btnFinalizar = $('#btnFinalizarVendaPdv');

    if (!statusEl.length) {
        return;
    }
    const statusAnterior = statusEl.hasClass('caixa-aberto');

    if (caixaAberto) {
        statusEl.text('🟢 Caixa Aberto');
        statusEl.removeClass('caixa-fechado').addClass('caixa-aberto');
        btnFinalizar.prop('disabled', carrinho.length === 0);
        // Mostrar notificação apenas quando mudar de fechado para aberto
        if (!statusAnterior && statusEl.data('inicializado')) {
            showNotification('Caixa aberto! Pronto para vender.', 'success');
        }
    } else {
        statusEl.text('🔴 Caixa Fechado');
        statusEl.removeClass('caixa-aberto').addClass('caixa-fechado');
        btnFinalizar.prop('disabled', true);
        // Mostrar notificação apenas quando mudar de aberto para fechado
        if (statusAnterior) {
            showNotification('Caixa fechado. Abra o caixa antes de vender.', 'warning');
        }
    }
    statusEl.data('inicializado', true);
}


// ============================================
// MODO FISCAL PDV - USADO PELO F12
// ============================================
function pdvModoFiscalAtivo() {
    if (typeof modoFiscalAtivoSistema === 'function') {
        return modoFiscalAtivoSistema();
    }
    return localStorage.getItem('pdv_modo_fiscal_ativo') === '1';
}

let pdvFlagTransferenciaNaoFiscalFiscal = false;
let pdvFlagEditarPrecoUnitario = false;
let pdvFlagVendaSemEstoque = false;
let pdvFlagExigirNcmCadastro = false;
let pdvFlagImprimirCupom = true;
/** @type {'UNIFICAR'|'SEPARAR'|'AUTOMATICO'} */
let pdvModoComposicaoItens = 'UNIFICAR';

function pdvPermitirTransferenciaNaoFiscalFiscal() {
    return pdvFlagTransferenciaNaoFiscalFiscal === true;
}

function pdvPermitirEditarPrecoUnitario() {
    return pdvFlagEditarPrecoUnitario === true;
}

function pdvPermitirVendaSemEstoque() {
    return pdvFlagVendaSemEstoque === true;
}

function pdvExigirNcmCadastroAtivo() {
    return pdvFlagExigirNcmCadastro === true;
}

function pdvImprimirCupomAtivo() {
    return pdvFlagImprimirCupom !== false;
}
window.pdvImprimirCupomAtivo = pdvImprimirCupomAtivo;

function pdvObterModoComposicaoItens() {
    if (typeof PDVItemCompositionService !== 'undefined'
        && typeof PDVItemCompositionService.normalizarModo === 'function') {
        return PDVItemCompositionService.normalizarModo(pdvModoComposicaoItens);
    }
    const v = String(pdvModoComposicaoItens || 'UNIFICAR').toUpperCase();
    if (v === 'SEPARAR' || v === 'AUTOMATICO') return v;
    return 'UNIFICAR';
}
window.pdvObterModoComposicaoItens = pdvObterModoComposicaoItens;

function atualizarBotaoCupomPdv() {
    const btn = document.getElementById('btnImprimirCupomPdv');
    if (!btn) return;
    const ativo = pdvImprimirCupomAtivo();
    btn.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    btn.title = ativo
        ? 'Impressão de cupom ATIVADA (clique para desativar)'
        : 'Impressão de cupom DESATIVADA (clique para ativar)';
    btn.innerHTML = ativo
        ? '<i class="fas fa-print"></i> <span class="d-none d-lg-inline">Cupom ON</span>'
        : '<i class="fas fa-print"></i> <span class="d-none d-lg-inline">Cupom OFF</span>';
    btn.classList.toggle('btn-cupom-pdv-off', !ativo);
}

function carregarFlagTransferenciaNaoFiscalFiscalPdv() {
    const token = localStorage.getItem('token') || '';
    if (!token || typeof API_URL === 'undefined') {
        pdvFlagTransferenciaNaoFiscalFiscal = false;
        return;
    }
    fetch(`${API_URL}/configuracoes/pdv_permitir_transferencia_nao_fiscal_fiscal`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: 'Bearer ' + token }
    }).then(function (response) {
        if (!response.ok) return { permitido: false };
        return response.json();
    }).then(function (data) {
        pdvFlagTransferenciaNaoFiscalFiscal = data && data.permitido === true;
    }).catch(function () {
        pdvFlagTransferenciaNaoFiscalFiscal = false;
    });
}

function carregarFlagEditarPrecoUnitarioPdv() {
    const token = localStorage.getItem('token') || '';
    if (!token || typeof API_URL === 'undefined') {
        pdvFlagEditarPrecoUnitario = false;
        return;
    }
    fetch(`${API_URL}/configuracoes/pdv_permitir_editar_preco_unitario`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: 'Bearer ' + token }
    }).then(function (response) {
        if (!response.ok) return { permitido: false };
        return response.json();
    }).then(function (data) {
        const anterior = pdvFlagEditarPrecoUnitario;
        pdvFlagEditarPrecoUnitario = data && data.permitido === true;
        if (anterior !== pdvFlagEditarPrecoUnitario && typeof atualizarCarrinho === 'function') {
            atualizarCarrinho();
        }
    }).catch(function () {
        pdvFlagEditarPrecoUnitario = false;
    });
}

function carregarFlagVendaSemEstoquePdv() {
    const token = localStorage.getItem('token') || '';
    if (!token || typeof API_URL === 'undefined') {
        pdvFlagVendaSemEstoque = false;
        return;
    }
    fetch(`${API_URL}/configuracoes/empresa_permite_venda_sem_estoque`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: 'Bearer ' + token }
    }).then(function (response) {
        if (!response.ok) return { permitido: false };
        return response.json();
    }).then(function (data) {
        pdvFlagVendaSemEstoque = data && data.permitido === true;
    }).catch(function () {
        pdvFlagVendaSemEstoque = false;
    });
}

function carregarFlagExigirNcmCadastroPdv() {
    const token = localStorage.getItem('token') || '';
    if (!token || typeof API_URL === 'undefined') {
        pdvFlagExigirNcmCadastro = false;
        return;
    }
    fetch(`${API_URL}/configuracoes/pdv_exigir_ncm_cadastro`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: 'Bearer ' + token }
    }).then(function (response) {
        if (!response.ok) return { permitido: false };
        return response.json();
    }).then(function (data) {
        pdvFlagExigirNcmCadastro = data && data.permitido === true;
    }).catch(function () {
        pdvFlagExigirNcmCadastro = false;
    });
}

function carregarFlagImprimirCupomPdv() {
    const token = localStorage.getItem('token') || '';
    if (!token || typeof API_URL === 'undefined') {
        pdvFlagImprimirCupom = true;
        atualizarBotaoCupomPdv();
        return;
    }
    fetch(`${API_URL}/configuracoes/pdv_imprimir_cupom`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: 'Bearer ' + token }
    }).then(function (response) {
        if (!response.ok) return { permitido: true };
        return response.json();
    }).then(function (data) {
        pdvFlagImprimirCupom = !(data && data.valor === 'DESATIVADO') && data.permitido !== false;
        atualizarBotaoCupomPdv();
    }).catch(function () {
        pdvFlagImprimirCupom = true;
        atualizarBotaoCupomPdv();
    });
}

function carregarFlagComposicaoItensPdv() {
    const token = localStorage.getItem('token') || '';
    if (!token || typeof API_URL === 'undefined') {
        pdvModoComposicaoItens = 'UNIFICAR';
        return;
    }
    fetch(`${API_URL}/configuracoes/pdv_composicao_itens`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: 'Bearer ' + token }
    }).then(function (response) {
        if (!response.ok) return { valor: 'UNIFICAR' };
        return response.json();
    }).then(function (data) {
        const valor = data && data.valor != null ? data.valor : 'UNIFICAR';
        pdvModoComposicaoItens = pdvObterModoComposicaoItensCall(valor);
    }).catch(function () {
        pdvModoComposicaoItens = 'UNIFICAR';
    });
}

function pdvObterModoComposicaoItensCall(valor) {
    if (typeof PDVItemCompositionService !== 'undefined'
        && typeof PDVItemCompositionService.normalizarModo === 'function') {
        return PDVItemCompositionService.normalizarModo(valor);
    }
    const v = String(valor || 'UNIFICAR').toUpperCase();
    if (v === 'SEPARAR' || v === 'AUTOMATICO') return v;
    return 'UNIFICAR';
}

function alternarImpressaoCupomPdv() {
    const token = localStorage.getItem('token') || '';
    if (!token || typeof API_URL === 'undefined') return;
    const valor = pdvImprimirCupomAtivo() ? 'DESATIVADO' : 'ATIVADO';
    fetch(`${API_URL}/configuracoes/pdv_imprimir_cupom`, {
        method: 'PUT',
        cache: 'no-store',
        headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ valor })
    }).then(function (response) {
        return response.json().then(function (data) {
            return { ok: response.ok, data: data || {} };
        });
    }).then(function (res) {
        if (!res.ok) {
            throw new Error(res.data.error || res.data.erro || 'Não foi possível alterar a impressão.');
        }
        pdvFlagImprimirCupom = res.data.permitido === true;
        atualizarBotaoCupomPdv();
        showNotification(
            pdvFlagImprimirCupom
                ? 'Impressão de cupom ATIVADA.'
                : 'Impressão de cupom DESATIVADA.',
            'success'
        );
    }).catch(function (err) {
        showNotification(err.message || 'Erro ao alterar impressão de cupom.', 'danger');
    });
}

function pdvNcmDigitos(ncm) {
    return String(ncm == null ? '' : ncm).replace(/\D/g, '');
}

function pdvNcmValido(ncm) {
    const d = pdvNcmDigitos(ncm);
    return d.length === 8 && d !== '00000000';
}

function pdvDeveInformarNcm(produto) {
    if (!pdvExigirNcmCadastroAtivo()) return false;
    if (typeof implantacaoPermiteFiscal === 'function' && !implantacaoPermiteFiscal()) {
        return false;
    }
    return !pdvNcmValido(produto && produto.ncm);
}

function copiarTextoSimplesPdv(texto, mensagemOk) {
    const valor = String(texto || '').trim();
    if (!valor) {
        showNotification('Não há nome para copiar.', 'warning');
        return;
    }
    const ok = () => showNotification(mensagemOk || 'Copiado.', 'success');
    const fallback = () => {
        const area = document.createElement('textarea');
        area.value = valor;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        try {
            document.execCommand('copy');
            ok();
        } catch (_) {
            showNotification('Não foi possível copiar o nome.', 'danger');
        }
        area.remove();
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(valor).then(ok).catch(fallback);
        return;
    }
    fallback();
}

function abrirModalNcmProdutoPdv(produto, callback) {
    $('#modalNcmProdutoPdv').remove();
    const nomeProduto = String(produto && produto.nome ? produto.nome : '').trim()
        || 'Este produto';
    const nomeExibicao = (window.PdvBuscaProduto
        && typeof PdvBuscaProduto.nomeExibicaoProdutoPdv === 'function')
        ? String(PdvBuscaProduto.nomeExibicaoProdutoPdv(produto) || nomeProduto).trim()
        : nomeProduto;
    const ncmInicial = pdvNcmDigitos(produto && produto.ncm).slice(0, 8);
    const html = `
        <div class="modal fade" id="modalNcmProdutoPdv" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
            <div class="modal-dialog modal-dialog-centered" style="max-width: 420px;">
                <div class="modal-content">
                    <div class="modal-body py-4">
                        <div class="d-flex align-items-start gap-2 mb-2">
                            <p class="mb-0 fw-bold flex-grow-1">${escapeHtml(nomeExibicao)} não tem NCM.</p>
                            <button type="button" class="btn btn-outline-secondary btn-sm py-0 px-2"
                                id="btnCopiarNomeNcmPdv" title="Copiar nome para buscar o NCM" tabindex="-1">
                                <i class="fas fa-copy"></i>
                            </button>
                        </div>
                        <p class="mb-3 text-muted small">Informe o NCM (8 dígitos) para incluir na venda. O cadastro será atualizado.</p>
                        <label class="form-label" for="inputNcmProdutoPdv">NCM</label>
                        <input type="text" class="form-control text-center" id="inputNcmProdutoPdv"
                            inputmode="numeric" autocomplete="off" spellcheck="false" enterkeyhint="done"
                            placeholder="00000000" value="${escapeHtml(ncmInicial)}"
                            style="font-size: 1.35rem; letter-spacing: 0.18em; font-variant-numeric: tabular-nums;">
                        <div class="text-muted small text-end mt-1" id="hintNcmProdutoPdv">${ncmInicial.length}/8</div>
                    </div>
                    <div class="modal-footer justify-content-center py-2">
                        <button type="button" class="btn btn-secondary" id="btnNcmProdutoPdvNao">Não</button>
                        <button type="button" class="btn btn-primary" id="btnNcmProdutoPdvSim">Sim</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('body').append(html);
    const modalEl = document.getElementById('modalNcmProdutoPdv');
    const modal = new bootstrap.Modal(modalEl);
    let decidido = false;
    const obterInputNcm = () => document.getElementById('inputNcmProdutoPdv');
    const aplicarDigitosNcm = (valor) => {
        const input = obterInputNcm();
        if (!input) return '';
        const digitos = pdvNcmDigitos(valor).slice(0, 8);
        input.value = digitos;
        const hint = document.getElementById('hintNcmProdutoPdv');
        if (hint) hint.textContent = `${digitos.length}/8`;
        return digitos;
    };
    const focarInputNcm = () => {
        const input = obterInputNcm();
        if (!input) return;
        input.focus({ preventScroll: true });
    };
    const lerNcm = () => pdvNcmDigitos(obterInputNcm() ? obterInputNcm().value : '');
    const onKeydownCaptura = (e) => {
        if (!document.getElementById('modalNcmProdutoPdv') || decidido) return;
        const input = obterInputNcm();
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            confirmar();
            return;
        }
        if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            finalizar(null);
            return;
        }
        if (!input) return;
        if (e.key === 'Backspace' || e.key === 'Delete') {
            if (document.activeElement !== input) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                const atual = lerNcm();
                aplicarDigitosNcm(e.key === 'Backspace' ? atual.slice(0, -1) : '');
                focarInputNcm();
            }
            return;
        }
        if (/^[0-9]$/.test(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            aplicarDigitosNcm(lerNcm() + e.key);
            focarInputNcm();
        }
    };
    const finalizar = (ncm) => {
        if (decidido) return;
        decidido = true;
        document.removeEventListener('keydown', onKeydownCaptura, true);
        modal.hide();
        if (typeof callback === 'function') callback(ncm);
    };
    const confirmar = () => {
        const ncm = lerNcm();
        if (!pdvNcmValido(ncm)) {
            showNotification('Informe um NCM com 8 dígitos.', 'warning');
            focarInputNcm();
            return;
        }
        finalizar(ncm);
    };
    $('#btnNcmProdutoPdvSim').off('click').on('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        confirmar();
    });
    $('#btnNcmProdutoPdvNao').off('click').on('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        finalizar(null);
    });
    $('#btnCopiarNomeNcmPdv').off('mousedown click').on('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
    }).on('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        copiarTextoSimplesPdv(nomeExibicao, 'Nome copiado. Cole na busca do NCM.');
        setTimeout(focarInputNcm, 0);
    });
    $('#inputNcmProdutoPdv').off('input.ncmPdv paste.ncmPdv blur.ncmPdv').on('input.ncmPdv paste.ncmPdv', function () {
        aplicarDigitosNcm(this.value);
    }).on('blur.ncmPdv', function () {
        if (decidido || !document.getElementById('modalNcmProdutoPdv')) return;
        setTimeout(focarInputNcm, 0);
    });
    document.addEventListener('keydown', onKeydownCaptura, true);
    $(modalEl).off('shown.bs.modal.ncmPdv').on('shown.bs.modal.ncmPdv', function () {
        aplicarDigitosNcm(obterInputNcm() ? obterInputNcm().value : ncmInicial);
        focarInputNcm();
        setTimeout(focarInputNcm, 50);
        setTimeout(focarInputNcm, 160);
    });
    $(modalEl).off('hidden.bs.modal.ncmPdv').on('hidden.bs.modal.ncmPdv', function () {
        document.removeEventListener('keydown', onKeydownCaptura, true);
        $('#modalNcmProdutoPdv').remove();
        if (!decidido && typeof callback === 'function') {
            decidido = true;
            callback(null);
        }
    });
    modal.show();
}

function sincronizarNcmCadastroProdutoPdv(produto, ncm, callback) {
    const produtoId = Number(produto && produto.id || 0);
    const ncmDigitos = pdvNcmDigitos(ncm);
    const done = typeof callback === 'function' ? callback : function () {};
    if (!produtoId || !pdvNcmValido(ncmDigitos) || typeof API_URL === 'undefined') {
        done(false);
        return;
    }
    const token = localStorage.getItem('token') || '';
    $.ajax({
        url: `${API_URL}/produtos/${produtoId}`,
        method: 'PUT',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + token },
        data: JSON.stringify({ ncm: ncmDigitos })
    }).done(function (atualizado) {
        let noCatalogo = null;
        if (atualizado && atualizado.id != null) {
            noCatalogo = upsertProdutoNoCatalogoPdv(atualizado);
        } else {
            noCatalogo = upsertProdutoNoCatalogoPdv(Object.assign({}, produto, { ncm: ncmDigitos }));
        }
        showNotification('NCM atualizado no cadastro do produto.', 'success');
        done(true, noCatalogo || Object.assign({}, produto, { ncm: ncmDigitos }));
    }).fail(function (xhr) {
        showNotification(
            (xhr.responseJSON && xhr.responseJSON.error) || 'Não foi possível atualizar o NCM no cadastro.',
            'danger'
        );
        done(false);
    });
}

function pdvResolverSaldosProduto(produto) {
    let item = produto || {};
    if (typeof enriquecerProdutoComCacheEstoque === 'function') {
        item = enriquecerProdutoComCacheEstoque(item);
    }

    const saldoFiscal = Number(item.saldo_fiscal ?? 0);
    let saldoNaoFiscal = Number(item.saldo_nao_fiscal ?? 0);

    if (item.saldo_nao_fiscal === undefined || item.saldo_nao_fiscal === null) {
        const cached = (produtosDisponiveis || []).find(
            (p) => String(p.id) === String(item.id ?? item.produto_id)
        );
        if (cached) {
            saldoNaoFiscal = Number(cached.saldo_nao_fiscal ?? 0);
        }
    }

    return {
        saldo_fiscal: saldoFiscal,
        saldo_nao_fiscal: saldoNaoFiscal,
        estoque_atual: saldoFiscal + saldoNaoFiscal
    };
}

function round3TransferenciaPdv(n) {
    return Math.round(Number(n || 0) * 1000) / 1000;
}

function calcularTransferenciaNaoFiscalParaFiscalPdv({ quantidade, saldoFiscal, saldoNaoFiscal } = {}) {
    const q = round3TransferenciaPdv(quantidade);
    const sf = round3TransferenciaPdv(saldoFiscal);
    const snf = round3TransferenciaPdv(saldoNaoFiscal);
    const estoqueAtual = round3TransferenciaPdv(sf + snf);
    const deficitFiscal = round3TransferenciaPdv(Math.max(0, q - sf));
    const estoqueInsuficiente = q > estoqueAtual + 1e-9;
    const podeTransferir = !estoqueInsuficiente
        && deficitFiscal > 1e-9
        && snf + 1e-9 >= deficitFiscal;
    return {
        quantidade: q,
        saldoFiscal: sf,
        saldoNaoFiscal: snf,
        estoqueAtual,
        deficitFiscal,
        estoqueInsuficiente,
        devePerguntar: podeTransferir,
        podeTransferir,
        quantidadeTransferir: podeTransferir ? deficitFiscal : 0
    };
}

function pdvSaldosComTransferenciasPendentes(produto, excluirIndex) {
    const base = pdvResolverSaldosProduto(produto);
    let sf = Number(base.saldo_fiscal || 0);
    let snf = Number(base.saldo_nao_fiscal || 0);
    const produtoId = Number(produto?.id ?? produto?.produto_id);
    (typeof carrinho !== 'undefined' && Array.isArray(carrinho) ? carrinho : []).forEach((item, idx) => {
        if (excluirIndex != null && idx === excluirIndex) return;
        if (Number(item.id) !== produtoId) return;
        const t = Number(item.transferencia_nao_fiscal_para_fiscal || 0);
        if (t > 0) {
            sf += t;
            snf -= t;
        }
    });
    return {
        saldo_fiscal: round3TransferenciaPdv(sf),
        saldo_nao_fiscal: round3TransferenciaPdv(snf),
        estoque_atual: round3TransferenciaPdv(sf + snf)
    };
}

function pdvAnalisarTransferenciaEstoque(produto, quantidadeEstoque, opcoes = {}) {
    if (!pdvPermitirTransferenciaNaoFiscalFiscal()) {
        return {
            quantidade: Number(quantidadeEstoque || 0),
            devePerguntar: false,
            podeTransferir: false,
            quantidadeTransferir: 0,
            deficitFiscal: 0
        };
    }
    if (!produtoControlaEstoquePdv(produto)) {
        return {
            quantidade: Number(quantidadeEstoque || 0),
            devePerguntar: false,
            podeTransferir: false,
            quantidadeTransferir: 0,
            deficitFiscal: 0
        };
    }
    const saldos = pdvSaldosComTransferenciasPendentes(produto, opcoes.excluirIndex);
    return calcularTransferenciaNaoFiscalParaFiscalPdv({
        quantidade: quantidadeEstoque,
        saldoFiscal: saldos.saldo_fiscal,
        saldoNaoFiscal: saldos.saldo_nao_fiscal
    });
}

function abrirModalTransferirEstoquePdv(callback) {
    $('#modalTransferirEstoquePdv').remove();
    const html = `
        <div class="modal fade" id="modalTransferirEstoquePdv" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-body text-center py-4">
                        <p class="mb-0 fw-bold fs-5">Transferir estoque?</p>
                    </div>
                    <div class="modal-footer justify-content-center py-2">
                        <button type="button" class="btn btn-secondary" id="btnTransferirEstoqueNao">NÃO</button>
                        <button type="button" class="btn btn-primary" id="btnTransferirEstoqueSim">SIM</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('body').append(html);
    const modalEl = document.getElementById('modalTransferirEstoquePdv');
    const modal = new bootstrap.Modal(modalEl);
    let decidido = false;
    const onKeydownCaptura = (e) => {
        if (!document.getElementById('modalTransferirEstoquePdv')) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault();
            e.stopPropagation();
            finalizar(false);
        }
    };
    const finalizar = (sim) => {
        if (decidido) return;
        decidido = true;
        document.removeEventListener('keydown', onKeydownCaptura, true);
        modal.hide();
        if (typeof callback === 'function') callback(sim === true);
    };
    $('#btnTransferirEstoqueSim').off('click').on('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        finalizar(true);
    });
    $('#btnTransferirEstoqueNao').off('click').on('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        finalizar(false);
    });
    document.addEventListener('keydown', onKeydownCaptura, true);
    $(modalEl).off('shown.bs.modal.transferir').on('shown.bs.modal.transferir', function () {
        const btnNao = document.getElementById('btnTransferirEstoqueNao');
        if (btnNao) btnNao.focus({ preventScroll: true });
    });
    $(modalEl).off('hidden.bs.modal.transferir').on('hidden.bs.modal.transferir', function () {
        document.removeEventListener('keydown', onKeydownCaptura, true);
        $('#modalTransferirEstoquePdv').remove();
        if (!decidido && typeof callback === 'function') {
            decidido = true;
            callback(false);
        }
        focarCampoCodigo({ limpar: true });
    });
    modal.show();
}

function produtoControlaEstoquePdv(produto) {
    if (produto == null) return true;
    if (
        produto.controla_estoque === undefined
        || produto.controla_estoque === null
        || produto.controla_estoque === ''
    ) {
        return true;
    }
    return Number(produto.controla_estoque) !== 0;
}

function pdvProdutoSemSaldoControlado(produto) {
    if (!produtoControlaEstoquePdv(produto)) return false;
    const saldos = pdvResolverSaldosProduto(produto);
    return Number(saldos.saldo_fiscal || 0) <= 1e-9
        && Number(saldos.saldo_nao_fiscal || 0) <= 1e-9;
}

function pdvMensagemProdutoSemSaldo(produto) {
    const nome = produto && produto.nome ? String(produto.nome) : 'Este produto';
    return `${nome} não tem saldo (fiscal e não fiscal zerados). Não é possível inserir na venda.`;
}

function formatarSaldoPdvMensagem(valor) {
    const n = Number(valor || 0);
    if (typeof formatarQuantidadePdv === 'function') {
        try {
            return formatarQuantidadePdv(n);
        } catch (_) { /* fallback */ }
    }
    return String(n);
}

function abrirModalVendaSemEstoquePdv(produto, detalhe, callback) {
    $('#modalVendaSemEstoquePdv').remove();
    const nome = escapeHtml(produto && produto.nome ? produto.nome : 'Este produto');
    const disponivel = formatarSaldoPdvMensagem(detalhe && detalhe.disponivel);
    const html = `
        <div class="modal fade" id="modalVendaSemEstoquePdv" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-body text-center py-4">
                        <p class="mb-2 fw-bold fs-5">${nome} não tem estoque.</p>
                        <p class="mb-3 text-muted small">Disponível: ${escapeHtml(disponivel)}</p>
                        <p class="mb-0">Deseja continuar?</p>
                    </div>
                    <div class="modal-footer justify-content-center py-2">
                        <button type="button" class="btn btn-secondary" id="btnVendaSemEstoqueNao">Não</button>
                        <button type="button" class="btn btn-primary" id="btnVendaSemEstoqueSim">Sim</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('body').append(html);
    const modalEl = document.getElementById('modalVendaSemEstoquePdv');
    const modal = new bootstrap.Modal(modalEl);
    let decidido = false;
    const onKeydownCaptura = (e) => {
        if (!document.getElementById('modalVendaSemEstoquePdv')) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            finalizar(true);
            return;
        }
        if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault();
            e.stopPropagation();
            finalizar(false);
        }
    };
    const finalizar = (sim) => {
        if (decidido) return;
        decidido = true;
        document.removeEventListener('keydown', onKeydownCaptura, true);
        modal.hide();
        if (typeof callback === 'function') callback(sim === true);
    };
    $('#btnVendaSemEstoqueSim').off('click').on('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        finalizar(true);
    });
    $('#btnVendaSemEstoqueNao').off('click').on('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        finalizar(false);
    });
    document.addEventListener('keydown', onKeydownCaptura, true);
    $(modalEl).off('shown.bs.modal.vendaSemEstoque').on('shown.bs.modal.vendaSemEstoque', function () {
        const btnSim = document.getElementById('btnVendaSemEstoqueSim');
        if (btnSim) btnSim.focus({ preventScroll: true });
    });
    $(modalEl).off('hidden.bs.modal.vendaSemEstoque').on('hidden.bs.modal.vendaSemEstoque', function () {
        document.removeEventListener('keydown', onKeydownCaptura, true);
        $('#modalVendaSemEstoquePdv').remove();
        if (!decidido && typeof callback === 'function') {
            decidido = true;
            callback(false);
        }
    });
    modal.show();
}

function validarEstoqueVenda(produto, quantidade, modoFiscal) {
    if (!produtoControlaEstoquePdv(produto)) {
        return { sucesso: true };
    }

    const saldos = pdvResolverSaldosProduto(produto);
    const saldoFiscal = Number(saldos.saldo_fiscal || 0);
    const saldoNaoFiscal = Number(saldos.saldo_nao_fiscal || 0);
    const saldoTotal = Number(saldos.estoque_atual || 0);

    // F=0 e NF=0 + controla estoque: bloqueio duro na inclusão, sem modal de continuar.
    if (saldoFiscal <= 1e-9 && saldoNaoFiscal <= 1e-9) {
        return {
            sucesso: false,
            semSaldoTotal: true,
            disponivel: 0,
            mensagem: pdvMensagemProdutoSemSaldo(produto)
        };
    }

    // Inclusão usa o motor F+NF. F12 não bloqueia produto só com saldo NF.
    if (quantidade > saldoTotal + 1e-9) {
        const resultado = {
            sucesso: false,
            disponivel: saldoTotal,
            mensagem:
`Saldo insuficiente.

Disponível: ${saldoTotal}`
        };
        if (pdvPermitirVendaSemEstoque()) {
            resultado.confirmarSemEstoque = true;
        }
        return resultado;
    }

    return { sucesso: true };
}

function pdvValidarEstoqueVenda(produto, quantidade) {
    return validarEstoqueVenda(produto, quantidade, pdvModoFiscalAtivo());
}

function pdvPodeIniciarInclusaoProduto(produto) {
    if (!produtoControlaEstoquePdv(produto)) {
        return { sucesso: true };
    }
    if (pdvProdutoSemSaldoControlado(produto)) {
        return {
            sucesso: false,
            semSaldoTotal: true,
            disponivel: 0,
            mensagem: pdvMensagemProdutoSemSaldo(produto)
        };
    }
    const saldos = pdvResolverSaldosProduto(produto);
    if (Number(saldos.estoque_atual || 0) > 1e-9) {
        return { sucesso: true };
    }
    const resultado = pdvValidarEstoqueVenda(produto, 1);
    if (resultado && resultado.confirmarSemEstoque) {
        return { sucesso: true, confirmarSemEstoque: true };
    }
    return resultado;
}

function pdvNotificarBloqueioInclusaoProduto(produto) {
    const resultado = pdvPodeIniciarInclusaoProduto(produto);
    if (!resultado.sucesso) {
        const mensagem = resultado.semSaldoTotal
            ? (resultado.mensagem || pdvMensagemProdutoSemSaldo(produto))
            : (produto?.nome && resultado.mensagem
                ? resultado.mensagem.replace('Saldo insuficiente.', `Saldo insuficiente para ${produto.nome}.`)
                : (resultado.mensagem || 'Saldo insuficiente.'));
        showNotification(mensagem, 'danger');
        return false;
    }
    return true;
}

function pdvNotificarEstoqueInsuficiente(produto, quantidade) {
    const resultado = pdvValidarEstoqueVenda(produto, quantidade);
    if (resultado.sucesso || resultado.confirmarSemEstoque) {
        return true;
    }
    const mensagem = resultado.semSaldoTotal
        ? (resultado.mensagem || pdvMensagemProdutoSemSaldo(produto))
        : (produto?.nome
            ? resultado.mensagem.replace('Saldo insuficiente.', `Saldo insuficiente para ${produto.nome}.`)
            : resultado.mensagem);
    showNotification(mensagem, 'danger');
    return false;
}

function pdvEstoqueDisponivel(produto) {
    const saldos = pdvResolverSaldosProduto(produto);
    return Number(saldos.estoque_atual || 0);
}

function pdvRotuloEstoque(produto) {
    const saldos = pdvResolverSaldosProduto(produto);
    const fiscal = Number(saldos.saldo_fiscal || 0);
    if (pdvModoFiscalAtivo()) {
        return String(fiscal);
    }
    const naoFiscal = Number(saldos.saldo_nao_fiscal || 0);
    const total = Number(saldos.estoque_atual || (fiscal + naoFiscal));
    return `F: ${fiscal} | NF: ${naoFiscal} | Total: ${total}`;
}

function aplicarModoFiscalPdv() {
    if (typeof aplicarModoFiscalGlobal === 'function') {
        aplicarModoFiscalGlobal();
        return;
    }

    const ativo = pdvModoFiscalAtivo();
    document.body.classList.toggle('modo-fiscal-ativo', ativo);

    const faixa = document.getElementById('faixaSistemaFiscalPdv');
    if (faixa) {
        const permiteFiscal = typeof implantacaoPermiteFiscal !== 'function' || implantacaoPermiteFiscal();
        faixa.style.display = permiteFiscal ? 'block' : 'none';
        faixa.classList.toggle('faixa-sistema-fiscal--ativo', !!ativo);
        faixa.classList.toggle('faixa-sistema-fiscal--off', !ativo);
        faixa.setAttribute('aria-label', ativo ? 'Sistema fiscal ativo' : 'Sistema fiscal inativo');
    }

    const btnFinalizar = document.getElementById('btnFinalizarVendaPdv');
    if (btnFinalizar) {
        const titulo = btnFinalizar.querySelector('.btn-finalizar-titulo');
        if (!titulo) {
            btnFinalizar.textContent = ativo ? 'Emitir NFC-e' : 'Finalizar Venda';
        }
    }

    if (typeof atualizarBarraModoFiscalSidebar === 'function') {
        atualizarBarraModoFiscalSidebar();
    }
}

function alternarModoFiscalPdv() {
    if (typeof implantacaoPermiteFiscal === 'function' && !implantacaoPermiteFiscal()) {
        if (typeof showNotification === 'function') {
            showNotification('Emissão fiscal desabilitada para o tipo de implantação configurado.', 'warning');
        }
        return;
    }

    if (typeof alternarModoFiscalGlobal === 'function') {
        alternarModoFiscalGlobal();
        return;
    }

    const novoValor = pdvModoFiscalAtivo() ? '0' : '1';
    localStorage.setItem('pdv_modo_fiscal_ativo', novoValor);
    aplicarModoFiscalPdv();
}

function focarCampoCodigo(opcoes) {
    const opts = opcoes && typeof opcoes === 'object' ? opcoes : {};
    const limpar = opts.limpar !== false;
    const forcar = opts.forcar === true;

    setTimeout(() => {
        if (document.querySelector('.modal.show')) return;
        if (document.getElementById('modalTransferirEstoquePdv')) return;
        if (document.getElementById('modalNcmProdutoPdv')) return;
        if (document.getElementById('inputNcmProdutoPdv')) return;

        const Focus = window.UIFocusManager;
        const ativo = document.activeElement;
        if (!forcar && Focus && typeof Focus.isEditingElement === 'function' && Focus.isEditingElement(ativo)) {
            const id = ativo && ativo.id;
            if (id && id !== 'buscaProdutoPdv') return;
            if (ativo && ativo.closest && ativo.closest('#tabelaItensVendaPdv')) return;
            if (ativo && ativo.classList && (
              ativo.classList.contains('quantidade-item')
              || ativo.classList.contains('percentual-item')
              || ativo.classList.contains('desconto-valor-item')
              || ativo.classList.contains('valor-item')
            )) return;
        }

        const input = $('#buscaProdutoPdv');
        if (!input.length) return;

        if (limpar) {
            input.val('');
            try {
                if (window.PdvBuscaProduto && typeof PdvBuscaProduto.fechar === 'function') {
                    PdvBuscaProduto.fechar();
                } else {
                    $('#listaProdutosPdv').empty();
                }
            } catch (_) { /* ignore */ }
        }

        input.trigger('focus');
        const el = input.get(0);
        if (el && typeof el.select === 'function') {
            try { el.select(); } catch (_) { /* ignore */ }
        }
    }, 80);
}



function obterNomeOperador() {
    try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        return user.nome || user.username || 'Usuário';
    } catch (e) {
        return 'Usuário';
    }
}

function iniciarRelogioPDV() {
    atualizarDataHoraPdv();

    if (pdvClockInterval) {
        clearInterval(pdvClockInterval);
    }

    pdvClockInterval = setInterval(atualizarDataHoraPdv, 1000);
}

function atualizarDataHora() {
    atualizarDataHoraPdv();
}

function bindEventosPDV() {
    $(document).off('keydown.pdvAtalhos').on('keydown.pdvAtalhos', function(e) {
        if (e.key === 'F1') {
            e.preventDefault();
            e.stopPropagation();
            abrirConsultaProdutosPdvDoCampoBusca();
        }
        if (e.key === 'F4') {
            e.preventDefault();
            e.stopPropagation();
            if (carrinho.length > 0) {
                const ultimoIndex = carrinho.length - 1;
                const input = $(`.quantidade-item[data-index="${ultimoIndex}"]`);
                if (input.length) {
                    input.trigger('focus');
                    input[0].select();
                }
            } else {
                showNotification('Nenhum item para alterar quantidade.', 'warning');
            }
        }
        if (e.key === 'F7') {
            e.preventDefault();
            e.stopPropagation();
            abrirFechamentoCaixa();
        }
        if (e.key === 'F8') {
            e.preventDefault();
            e.stopPropagation();
            garantirAutorizacaoDesconto(
                () => $('#descontoPdv').trigger('focus'),
                () => showNotification('Desconto exige autorização de administrador ou supervisor.', 'warning')
            );
        }
        if (e.key === 'F9') {
            e.preventDefault();
            e.stopPropagation();
            const entregaAtiva = window.PdvVendaEntrega
                && typeof PdvVendaEntrega.moduloEntregaAtivo === 'function'
                && PdvVendaEntrega.moduloEntregaAtivo();
            const btnEntrega = document.getElementById('btnVendaEntregaPdv');
            if (entregaAtiva && btnEntrega && !btnEntrega.disabled) {
                btnEntrega.click();
            }
        }
        if (e.key === 'F10') {
            e.preventDefault();
            e.stopPropagation();
            // Mesmo fluxo do botão Finalizar (balcão)
            document.getElementById('btnFinalizarVendaPdv')?.click();
        }
        if (e.key === 'Escape') {
            if (window.PdvBuscaProduto && PdvBuscaProduto.estaAberto()) {
                e.preventDefault();
                e.stopPropagation();
                PdvBuscaProduto.fechar();
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            cancelarVendaAtual();
        }
    });

    if (window.PdvBuscaProduto && typeof PdvBuscaProduto.inicializar === 'function') {
        PdvBuscaProduto.inicializar();
    } else {
        $('#buscaProdutoPdv').off('keypress').on('keypress', function(e) {
            if (e.which === 13) {
                const codigo = $(this).val().trim();
                if (codigo) {
                    adicionarProdutoPorCodigo(codigo);
                    $(this).val('');
                }
            }
        });

        $('#btnBuscarProdutoPdv').off('click').on('click', function() {
            abrirConsultaProdutosPdvDoCampoBusca();
        });
    }

    $('#btnLimparVendaPdv').off('click').on('click', limparCarrinho);
    $('#btnCancelarVendaPdv').off('click').on('click', cancelarVendaAtual);
    // UX-01: F10 / Finalizar = sempre balcão (fluxo original)
    $('#btnFinalizarVendaPdv').off('click').on('click', function () {
        abrirTelaPagamento();
    });
    $('#btnVendaEntregaPdv').off('click').on('click', function () {
        if (window.PdvVendaEntrega && typeof PdvVendaEntrega.aoClicarBotaoEntrega === 'function') {
            PdvVendaEntrega.aoClicarBotaoEntrega();
            return;
        }
        if (window.PdvVendaEntrega && typeof PdvVendaEntrega.abrirModalVendaEntrega === 'function') {
            PdvVendaEntrega.abrirModalVendaEntrega();
        }
    });
    $('#btnFechamentoCaixaPdv').off('click').on('click', abrirFechamentoCaixa);

    $('#btnImprimirCupomPdv').off('click').on('click', function () {
        alternarImpressaoCupomPdv();
    });
    atualizarBotaoCupomPdv();

    $('#btnCalculadoraPdv').off('click').on('click', function() {
        $('#pdvCalculadoraFlutuante').toggleClass('d-none');
    });
    $('#btnFecharCalculadoraPdv').off('click').on('click', function() {
        $('#pdvCalculadoraFlutuante').addClass('d-none');
    });

    $('#formaPagamentoPdv').off('change').on('change', function () {
        if ($(this).val() === 'misto') {
            abrirPagamentoMisto();
        } else {
            pagamentosMistos = [];
        }
        aoAlterarFormaPagamento();
    });
    $('#formaPagamentoPdv').val('');

    // Busca de cliente para venda a prazo (sidebar)
    $('#clienteBuscaPrazo').off('input').on('input', function() {
        const termo = normalizarTexto($(this).val()).trim();
        if (termo.length < 2) {
            $('#clientePrazoSugestoes').empty().hide();
            $('#clientePrazoId').val('');
            return;
        }

        $.ajax({
            url: `${API_URL}/clientes`,
            method: 'GET',
            success: function(clientes) {
                const filtrados = (clientes || []).filter(c =>
                    normalizarTexto(c.nome).includes(termo) ||
                    String(c.cpf_cnpj || '').replace(/\D/g, '').includes(termo.replace(/\D/g, ''))
                );

                if (filtrados.length === 0) {
                    $('#clientePrazoSugestoes').html('<div class="list-group-item" style="font-size:0.8rem;">Nenhum cliente encontrado</div>').show();
                    return;
                }

                $('#clientePrazoSugestoes').html(
                    filtrados.map(c => `
                        <button type="button" class="list-group-item list-group-item-action" data-id="${c.id}" data-nome="${escapeHtml(c.nome || '')}" style="font-size:0.8rem; padding:4px 8px;">
                            ${escapeHtml(c.nome || '')}${c.cpf_cnpj ? ' - ' + formatarCpfCnpj(c.cpf_cnpj) : ''}
                        </button>
                    `).join('')
                ).show();
            },
            error: function() {
                $('#clientePrazoSugestoes').empty().hide();
            }
        });
    });

    $(document).off('click.prazoSugestao').on('click.prazoSugestao', '#clientePrazoSugestoes button', function() {
        const id = $(this).data('id');
        const nome = $(this).data('nome');
        $('#clientePrazoId').val(id);
        $('#clienteBuscaPrazo').val(nome);
        $('#clientePrazoSugestoes').empty().hide();
        $('#clientePrazoSelecionado').show();
        $('#clientePrazoNome').text(nome);
        clienteSelecionado = { id: Number(id), nome: String(nome) };
    });

    $('#btnRemoverClientePrazo').off('click').on('click', function() {
        $('#clientePrazoId').val('');
        $('#clienteBuscaPrazo').val('');
        $('#clientePrazoSelecionado').hide();
        $('#clientePrazoNome').text('');
        clienteSelecionado = null;
        setTimeout(() => $('#clienteBuscaPrazo').trigger('focus'), 50);
    });

    $('#clienteBusca').off('input').on('input', async function () {
        const termo = $(this).val().trim();
        if (termo.length < 2) {
            $('#clienteResultados').empty();
            return;
        }

        try {
            const token = localStorage.getItem('token');
            const resposta = await fetch(`${API_URL}/clientes/buscar?termo=${encodeURIComponent(termo)}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (!resposta.ok) {
                throw new Error(`Erro ao buscar clientes: ${resposta.status}`);
            }
            const clientes = await resposta.json();
            renderizarResultadosClientes(clientes);
        } catch (error) {
            console.error('Erro ao buscar clientes:', error);
        }
    });
    $('#clienteResultados').off('click').on('click', '.cliente-item', function() {
        const clienteId = Number($(this).data('id'));
        const cliente = clientesResultados.find(c => Number(c.id) === clienteId);
        if (cliente) {
            selecionarCliente(cliente);
        }
    });

    // Calculadora PDV
    let calcExpression = '';
    const calcDisplay = $('#calcDisplay');

    $('.calc-btn').off('click').on('click', function() {
        const valor = String($(this).data('value'));

        if (valor === 'C') {
            calcExpression = '';
            calcDisplay.text('0');
        } else if (valor === '=') {
            if (calcExpression) {
                try {
                    // Avaliar expressão matemática de forma segura
                    const resultado = Function('"use strict"; return (' + calcExpression + ')')();
                    calcDisplay.text(resultado.toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
                    calcExpression = String(resultado);
                } catch (e) {
                    calcDisplay.text('Erro');
                    calcExpression = '';
                }
            }
        } else {
            // Números e operadores
            if (calcExpression === '' && ['/', '*', '+', '-'].includes(valor)) {
                // Não começar com operador
                return;
            }
            calcExpression += valor;
            calcDisplay.text(calcExpression);
        }

        // Após clicar em =, focar no campo de busca
        if (valor === '=') {
            setTimeout(() => {
                $('#buscaProdutoPdv').trigger('focus');
            }, 100);
        }
    });

    $('#acrescimoPdv').off('input').on('input', function() {
        calcularTotal();
        calcularTrocoPDV();
    });

    $('#descontoPdv')
        .off('input.descontoPdv change.descontoPdv focus.descontoPdv')
        .on('focus.descontoPdv', function() {
            $(this).data('valor-antes', $(this).val());
        })
        .on('change.descontoPdv', function() {
            const $input = $(this);
            const valorAntes = parseFloat($input.data('valor-antes')) || 0;
            let valor = parseFloat($input.val()) || 0;
            if (valor < 0) valor = 0;
            if (valor <= 0) {
                $input.val(0);
                calcularTotal();
                calcularTrocoPDV();
                return;
            }
            garantirAutorizacaoDesconto(
                () => {
                    $input.val(valor);
                    calcularTotal();
                    calcularTrocoPDV();
                },
                () => {
                    $input.val(valorAntes);
                    calcularTotal();
                    calcularTrocoPDV();
                    showNotification('Desconto não autorizado.', 'warning');
                }
            );
        })
        .on('input.descontoPdv', function() {
            // Recalcula só visualmente; a autorização ocorre no change.
            calcularTotal();
            calcularTrocoPDV();
        });

    $('#valorRecebidoPDV').off('input').on('input', calcularTrocoPDV);

    aoAlterarFormaPagamento();
}

function aoAlterarFormaPagamento() {
    const formaPagamento = $('#formaPagamentoPdv').val();
    const boxCliente = $('#pdvClienteBox');
    const boxDinheiro = $('#pdvDinheiroBox');

    // Esconde tudo primeiro
    boxCliente.hide();
    boxDinheiro.hide();

    if (formaPagamento === 'dinheiro') {
        boxDinheiro.show();
        calcularTrocoPDV();

        setTimeout(() => {
            const input = $('#valorRecebidoPDV');
            if (input.length) input.trigger('focus');
        }, 100);
    }

    if (formaPagamento === 'prazo') {
        boxCliente.show();

        // Padrão: 30 dias a partir de hoje
        const hoje = new Date();
        const vencimentoPadrao = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 30);

        if (!$('#dataVencimentoPrazo').val()) {
            $('#dataVencimentoPrazo').val(vencimentoPadrao.toISOString().split('T')[0]);
        }

        if (!$('#parcelasPrazo').val() || $('#parcelasPrazo').val() === '0') {
            $('#parcelasPrazo').val(1);
        }

        setTimeout(() => {
            $('#clienteBuscaPrazo').trigger('focus');
        }, 100);
    } else {
        limparCamposPrazo();
    }
}

function limparCamposPrazo() {
    $('#clientePrazoId').val('');
    $('#clienteBuscaPrazo').val('');
    $('#clientePrazoSugestoes').empty().hide();
    $('#clientePrazoSelecionado').hide();
    $('#clientePrazoNome').text('');
    $('#dataVencimentoPrazo').val('');
    $('#parcelasPrazo').val(1);
    clienteSelecionado = null;
}

function calcularTrocoPDV() {
    const total = calcularTotalValor();
    const recebido = parseFloat($('#valorRecebidoPDV').val()) || 0;
    const troco = Math.max(0, recebido - total);

    $('#trocoPDV').text(formatCurrency(troco));
}

function renderizarResultadosClientes(clientes) {
    clientesResultados = Array.isArray(clientes) ? clientes : [];
    const container = $('#clienteResultados');

    if (!clientesResultados.length) {
        container.html('<div class="cliente-item">Nenhum cliente encontrado</div>');
        return;
    }

    container.html(clientesResultados.map(cliente => `
        <div class="cliente-item" data-id="${cliente.id}">
            <strong>${escapeHtml(cliente.nome)}</strong><br>
            <small>${formatarCpfCnpj(cliente.cpf_cnpj) || ''}${cliente.telefone ? ' - ' + escapeHtml(cliente.telefone) : ''}</small>
        </div>
    `).join(''));
}

function selecionarCliente(cliente) {
    clienteSelecionado = cliente;
    $('#clienteSelecionado').show();
    $('#clienteSelecionadoNome').text(`${cliente.nome}${cliente.cpf_cnpj ? ' - ' + formatarCpfCnpj(cliente.cpf_cnpj) : ''}`);
    $('#clienteBusca').val(cliente.nome);
    $('#clienteResultados').empty();
}

function removerClienteSelecionado() {
    clienteSelecionado = null;
    $('#clienteSelecionado').hide();
    $('#clienteSelecionadoNome').text('');
    $('#clienteBusca').val('');
    $('#clienteResultados').empty();
}

function abrirCadastroCliente() {
    if (typeof showClienteModal === 'function') {
        showClienteModal();
    } else {
        showNotification('Cadastro de cliente não disponível no momento.', 'warning');
    }
}

/** URL segura da foto do produto (somente visual; sem data: / javascript:). */
function urlImagemProdutoPdv(path) {
    const valor = String(path || '').trim();
    if (!valor) return '';
    if (/^(javascript|vbscript|data):/i.test(valor)) return '';
    if (/^https?:\/\//i.test(valor)) return valor;
    return valor.startsWith('/') ? valor : `/${valor}`;
}

function htmlMiniaturaProdutoPdv(produto, nomeProduto) {
    const src = urlImagemProdutoPdv(produto?.imagem_principal);
    if (!src) return '';
    const alt = escapeHtml(nomeProduto || produto?.nome || 'Produto');
    const srcSafe = escapeHtml(src);
    return `<img
        class="pdv-produto-miniatura"
        src="${srcSafe}"
        alt="${alt}"
        title="Ampliar foto"
        loading="lazy"
        decoding="async"
        data-imagem-src="${srcSafe}"
      >`;
}

function garantirOverlayFotoProdutoPdv() {
    let overlay = document.getElementById('pdvFotoProdutoOverlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'pdvFotoProdutoOverlay';
    overlay.className = 'pdv-foto-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Foto do produto');
    overlay.innerHTML = `
      <button type="button" class="pdv-foto-fechar" aria-label="Fechar">
        <i class="fas fa-times" aria-hidden="true"></i>
      </button>
      <div class="pdv-foto-dialog">
        <img class="pdv-foto-grande" alt="Foto do produto" draggable="false">
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay || ev.target.closest('.pdv-foto-fechar')) {
            fecharFotoProdutoPdv();
        }
    });

    const imgGrande = overlay.querySelector('.pdv-foto-grande');
    if (imgGrande) {
        imgGrande.addEventListener('click', (ev) => ev.stopPropagation());
    }

    return overlay;
}

function fecharFotoProdutoPdv() {
    const overlay = document.getElementById('pdvFotoProdutoOverlay');
    if (!overlay) return;
    overlay.hidden = true;
    overlay.classList.remove('is-open');
    const img = overlay.querySelector('.pdv-foto-grande');
    if (img) {
        img.removeAttribute('src');
        img.alt = 'Foto do produto';
    }
    document.removeEventListener('keydown', pdvFotoProdutoEscHandler, true);
}

function pdvFotoProdutoEscHandler(ev) {
    if (ev.key === 'Escape' || ev.key === 'Esc') {
        ev.preventDefault();
        ev.stopPropagation();
        fecharFotoProdutoPdv();
    }
}

function abrirFotoProdutoPdv(src, altTexto) {
    const url = urlImagemProdutoPdv(src);
    if (!url) return;

    const overlay = garantirOverlayFotoProdutoPdv();
    const img = overlay.querySelector('.pdv-foto-grande');
    if (img) {
        img.src = url;
        img.alt = String(altTexto || 'Foto do produto');
    }
    overlay.hidden = false;
    overlay.classList.add('is-open');
    document.addEventListener('keydown', pdvFotoProdutoEscHandler, true);
    const btnFechar = overlay.querySelector('.pdv-foto-fechar');
    if (btnFechar) btnFechar.focus({ preventScroll: true });
}

function renderCarrinhoItens() {
    if (!Array.isArray(carrinho) || carrinho.length === 0) {
        return '<tr><td colspan="8" class="text-center vazio">Nenhum item no carrinho</td></tr>';
    }

    return carrinho.map((item, index) => {
        const produto = produtosDisponiveis.find(p => Number(p.id) === Number(item.id));
        const vendaUnidade = itemVendaPorUnidade(item);
        const refQuantidade = produto || { unidade: item.unidade };
        const decimal = vendaUnidade ? false : quantidadeUsaDecimaisPdv(refQuantidade);
        const unidade = vendaUnidade ? 'UN' : String(produto?.unidade || item.unidade || 'UN').toUpperCase();
        const descontoValorItem = obterDescontoValorItemPdv(item, produto);
        const descontoPctItem = Number(item.desconto_percentual || 0);
        const temDesconto = descontoValorItem > 0 || descontoPctItem > 0;
        const classesLinha = [];
        if (temDesconto) classesLinha.push('table-warning');
        if (typeof pdvLinhaDestaqueIndex === 'number' && index === pdvLinhaDestaqueIndex) {
            classesLinha.push('pdv-item-recem');
        }
        const classe = classesLinha.join(' ');
        const descontoAtacadoValor = Number(item.desconto_atacado || 0);
        const badgeDescontoAtacado = descontoAtacadoValor > 0
            ? `<div class="pdv-produto-meta text-success">Atacado: -${formatCurrency(descontoAtacadoValor)}</div>`
            : '';
        const modoAtacadoBadge = item.tipo_preco === 'atacado' ? `<span class="badge bg-secondary">ATACADO</span>` : '';
        const infoVendaUnidade = vendaUnidade && produto
            ? `<div class="pdv-produto-meta text-muted">
                    ${renderTextoPreviewEstoqueKg(produto, item.quantidade)}<br>
                    ${renderTextoPreviewValorUnidade(produto, item.quantidade)}
               </div>`
            : '';
        const classeTotal = (typeof pdvTotalAnimIndex === 'number' && index === pdvTotalAnimIndex)
            ? 'col-total pdv-total-linha pdv-total-flash'
            : 'col-total pdv-total-linha';

        const extrasHtml = [badgeDescontoAtacado, modoAtacadoBadge, infoVendaUnidade]
            .filter(Boolean)
            .join('');
        const miniaturaHtml = htmlMiniaturaProdutoPdv(produto, item.nome);

        return `
            <tr ${classe ? `class="${classe}"` : ''} data-item-index="${index}">
                <td class="col-qtd">
                    <input type="${decimal ? 'text' : 'number'}"
                           class="form-control form-control-sm quantidade-item"
                           value="${vendaUnidade ? String(Math.round(Number(item.quantidade || 0))) : formatarQuantidadePdv(item.quantidade, refQuantidade)}"
                           min="${decimal ? '0.001' : '1'}"
                           step="${decimal ? '0.001' : '1'}"
                           inputmode="${decimal ? 'decimal' : 'numeric'}"
                           data-index="${index}">
                </td>
                <td class="col-un"><span class="pdv-unidade-badge">${escapeHtml(unidade)}</span></td>
                <td class="col-produto">
                    <div class="pdv-produto-cell">
                      ${miniaturaHtml}
                      <div class="pdv-produto-texto">
                        <span class="pdv-produto-nome">${escapeHtml(item.nome)}</span>
                        ${extrasHtml ? `<div class="pdv-produto-extras">${extrasHtml}</div>` : ''}
                      </div>
                    </div>
                </td>
                <td class="col-unit">
                    ${pdvPermitirEditarPrecoUnitario()
                        ? `<input type="number"
                               class="form-control form-control-sm valor-item"
                               value="${Number(precoUnitarioExibicaoItemPdv(item) || 0).toFixed(2)}"
                               min="0.01"
                               step="0.01"
                               inputmode="decimal"
                               title="Editar unitário e atualizar cadastro do produto"
                               data-index="${index}">`
                        : `<span class="pdv-unitario-valor">${String(precoUnitarioExibicaoItemPdv(item)).replace('.', ',')}</span>`}
                </td>
                <td class="col-desc-pct">
                    <input type="number"
                           class="form-control form-control-sm percentual-item"
                           value="${descontoPctItem.toFixed(2)}"
                           min="0"
                           max="100"
                           step="0.01"
                           inputmode="decimal"
                           title="Desconto em %"
                           data-index="${index}">
                </td>
                <td class="col-desc-rs">
                    <input type="number"
                           class="form-control form-control-sm desconto-valor-item"
                           value="${Number(descontoValorItem || 0).toFixed(2)}"
                           min="0"
                           step="0.01"
                           inputmode="decimal"
                           title="Desconto em R$"
                           data-index="${index}">
                </td>
                <td class="${classeTotal}"><span class="pdv-total-valor">${formatCurrency(item.subtotal_exibicao ?? item.subtotal)}</span></td>
                <td class="col-acao">
                    <button type="button" class="btn btn-sm btn-outline-danger item-remover" data-index="${index}" title="Remover">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function codigoEhBalanca(codigo) {
    return /^2\d{12}$/.test(String(codigo || '').trim());
}

function parseMGV6ScaleEan13Pdv(codigo) {
    if (typeof parseMGV6ScaleEan13 === 'function') {
        return parseMGV6ScaleEan13(codigo);
    }
    if (typeof ParseMGV6ScaleEan13 !== 'undefined'
        && ParseMGV6ScaleEan13
        && typeof ParseMGV6ScaleEan13.parseMGV6ScaleEan13 === 'function') {
        return ParseMGV6ScaleEan13.parseMGV6ScaleEan13(codigo);
    }
    return null;
}

function montarParseMotorMGV6(parsed) {
    return {
        sucesso: true,
        semLayoutAtivo: false,
        resultado: {
            plu: String(parsed.plu),
            pluRaw: parsed.itemCode,
            valorTotal: Number(parsed.total) / 100,
            peso: null,
            tipoPayload: 'VALOR',
            layoutId: 'MGV6_SCALE_EAN13'
        },
        layout: { preset_id: 'MGV6_SCALE_EAN13' }
    };
}

function unidadeEhKg(produto) {
    return String(produto?.unidade || '').toLowerCase() === 'kg';
}

function produtoUsaConversaoUnidadesPdv(produto) {
    if (typeof window.produtoUsaConversaoUnidades === 'function') {
        return window.produtoUsaConversaoUnidades(produto);
    }
    if (typeof window.produtoEhFracionado === 'function') {
        return window.produtoEhFracionado(produto);
    }
    return Number(produto?.produto_fracionado ?? produto?.vendido_por_peso ?? 0) === 1;
}

/** @deprecated Alias legado — use produtoUsaConversaoUnidadesPdv */
function produtoFracionado(produto) {
    return produtoUsaConversaoUnidadesPdv(produto);
}

function permiteQuantidadeDecimal(produto) {
    return quantidadeUsaDecimaisPdv(produto);
}

function quantidadeUsaDecimaisPdv(produto) {
    return produtoUsaConversaoUnidadesPdv(produto) || unidadeEhKg(produto);
}

/** @deprecated Use quantidadeUsaDecimaisPdv */
function quantidadeUsaTresCasas(produto) {
    return quantidadeUsaDecimaisPdv(produto);
}

function parseQuantidadePdv(valor) {
    const texto = String(valor ?? '').trim();
    if (!texto) return NaN;
    let normalizado = texto;
    if (texto.includes(',')) {
        normalizado = texto.replace(/\./g, '').replace(',', '.');
    }
    const numero = parseFloat(normalizado);
    return Number.isFinite(numero) ? numero : NaN;
}

function normalizarQuantidadePdv(quantidade, produto) {
    const qtd = Number(quantidade || 0);
    if (!Number.isFinite(qtd) || qtd <= 0) return 0;
    if (quantidadeUsaDecimaisPdv(produto)) {
        return Number(qtd.toFixed(3));
    }
    return Math.round(qtd);
}

/** Quantidade KG de etiqueta — 3 casas para preservar total (valor ÷ preço). */
function normalizarQuantidadeEtiquetaPdv(quantidade) {
    const qtd = Number(quantidade || 0);
    if (!Number.isFinite(qtd) || qtd <= 0) return 0;
    return Number(qtd.toFixed(3));
}

function formatarQuantidadePdv(quantidade, produto) {
    const qtd = Number(quantidade || 0);
    if (!Number.isFinite(qtd)) return '0';
    if (produto && quantidadeUsaDecimaisPdv(produto)) {
        return qtd.toFixed(3).replace('.', ',');
    }
    return String(Math.round(qtd));
}

function formatarPesoEtiquetaPdv(peso) {
    const qtd = Number(peso || 0);
    if (!Number.isFinite(qtd)) return '0';
    return qtd.toFixed(3).replace('.', ',').replace(/,?0+$/, '').replace(/,$/, '') || '0';
}

/**
 * Monta quantidade/total a partir do retorno do Motor (VALOR ou PESO).
 * Não altera o preço cadastrado do produto.
 */
function calcularItemEtiquetaBalancaPdv(produto, metaMotor) {
    const precoUnitario = Number(produto?.preco_venda || 0);
    const tipoPayload = String(metaMotor?.tipoPayload || '').toUpperCase();
    const valorEtiqueta = metaMotor?.valorTotal != null ? Number(metaMotor.valorTotal) : null;
    const pesoEtiqueta = metaMotor?.peso != null ? Number(metaMotor.peso) : null;

    if (!(precoUnitario > 0)) {
        return { ok: false, mensagem: `Preço por KG inválido para ${produto?.nome || 'produto'}.` };
    }

    // Layout PESO: quantidade = peso da etiqueta; total = qtd × preço cadastrado
    if (tipoPayload === 'PESO') {
        const quantidade = normalizarQuantidadeEtiquetaPdv(pesoEtiqueta);
        if (!(quantidade > 0)) {
            return { ok: false, mensagem: `Peso inválido na etiqueta para ${produto?.nome || 'produto'}.` };
        }
        const subtotal = Number((quantidade * precoUnitario).toFixed(2));
        return {
            ok: true,
            tipoPayload: 'PESO',
            quantidade,
            precoUnitario,
            subtotal,
            valorEtiqueta: null,
            mensagemExtra: ` - Peso: ${formatarPesoEtiquetaPdv(quantidade)} KG`
        };
    }

    // Layout VALOR: quantidade = valor ÷ preço; total = valor impresso na etiqueta
    if (!(valorEtiqueta != null && Number.isFinite(valorEtiqueta) && valorEtiqueta > 0)) {
        // Fallback: se o Motor só trouxe peso
        if (pesoEtiqueta != null && Number.isFinite(pesoEtiqueta) && pesoEtiqueta > 0) {
            const quantidade = normalizarQuantidadeEtiquetaPdv(pesoEtiqueta);
            const subtotal = Number((quantidade * precoUnitario).toFixed(2));
            return {
                ok: true,
                tipoPayload: 'PESO',
                quantidade,
                precoUnitario,
                subtotal,
                valorEtiqueta: null,
                mensagemExtra: ` - Peso: ${formatarPesoEtiquetaPdv(quantidade)} KG`
            };
        }
        return {
            ok: false,
            mensagem: `Não foi possível obter valor/peso da etiqueta para ${produto?.nome || 'produto'}.`
        };
    }

    const quantidade = normalizarQuantidadeEtiquetaPdv(valorEtiqueta / precoUnitario);
    if (!(quantidade > 0)) {
        return { ok: false, mensagem: `Não foi possível calcular o peso da etiqueta para ${produto?.nome || 'produto'}.` };
    }

    return {
        ok: true,
        tipoPayload: 'VALOR',
        quantidade,
        precoUnitario,
        subtotal: Number(valorEtiqueta.toFixed(2)),
        valorEtiqueta: Number(valorEtiqueta.toFixed(2)),
        mensagemExtra: ` - Peso: ${formatarPesoEtiquetaPdv(quantidade)} KG - Total: ${formatCurrency(valorEtiqueta)}`
    };
}

/**
 * @deprecated RC1 — NÃO USAR. Etiquetas passam apenas pelo Motor de Equipamentos.
 * Mantida apenas para evitar quebra de referências externas; o hot-path do PDV não a chama.
 */
function interpretarCodigoBalanca(codigo) {
    const limpo = String(codigo || '').replace(/\D/g, '');

    if (!codigoEhBalanca(limpo)) return null;

    return {
        codigoProduto: limpo.substring(1, 6),
        valorTotal: Number(limpo.substring(6, 12)) / 100,
        codigoOriginal: limpo
    };
}

function normalizarCodigoProduto(codigo) {
    return String(codigo || '').replace(/\D/g, '').replace(/^0+/, '') || String(codigo || '').trim();
}

/**
 * Variantes de PLU para lookup local no PDV (00 / 000039 / 39…).
 * Espelha a lógica do backend (variantesPlu) sem depender do MIP.
 */
function variantesCodigoPluPdv(pluRaw) {
    const digits = String(pluRaw ?? '').replace(/\D/g, '');
    if (!digits) return [];
    const stripped = digits.replace(/^0+/, '') || '0';
    const out = new Set([digits, stripped]);
    for (let len = 1; len <= 10; len += 1) {
        out.add(stripped.padStart(len, '0'));
    }
    return [...out];
}

/**
 * Localiza produto pesável no cache do PDV pelo PLU da etiqueta (inclui zeros à esquerda).
 * Ex.: etiqueta 2000039005708 → pluRaw 000039 → produto codigo/PLU 000039.
 */
function encontrarProdutoPorPluBalanca(plu, pluRaw) {
    if (!Array.isArray(produtosDisponiveis) || !produtosDisponiveis.length) return null;

    const candidatos = new Set();
    if (pluRaw != null && String(pluRaw).trim() !== '') {
        variantesCodigoPluPdv(pluRaw).forEach((v) => candidatos.add(v));
    }
    if (plu != null && String(plu).trim() !== '') {
        variantesCodigoPluPdv(plu).forEach((v) => candidatos.add(v));
    }
    if (!candidatos.size) return null;

    const canonico = (valor) => {
        const digits = String(valor ?? '').replace(/\D/g, '');
        if (!digits) return '';
        return digits.replace(/^0+/, '') || '0';
    };

    return produtosDisponiveis.find((p) => {
        const campos = [p.plu, p.codigo, p.codigo_barras];
        for (const campo of campos) {
            if (campo == null || String(campo).trim() === '') continue;
            const raw = String(campo).trim();
            const digits = raw.replace(/\D/g, '');
            const strip = canonico(raw);
            if (candidatos.has(raw) || (digits && candidatos.has(digits)) || (strip && candidatos.has(strip))) {
                return true;
            }
            for (const cand of candidatos) {
                if (strip && strip === canonico(cand)) return true;
            }
        }
        return false;
    }) || null;
}

function encontrarProdutoPorCodigoExato(termo) {
    const busca = normalizarTexto(termo);
    const buscaNumerica = normalizarCodigoProduto(termo);

    return produtosDisponiveis.find(p => {
        const codigo = normalizarTexto(p.codigo);
        const codigoBarras = normalizarTexto(p.codigo_barras);
        const codigoNumerico = normalizarCodigoProduto(p.codigo);
        const barrasNumerico = normalizarCodigoProduto(p.codigo_barras);

        return (
            (codigo && codigo === busca) ||
            (codigoBarras && codigoBarras === busca) ||
            (codigoNumerico && codigoNumerico === buscaNumerica) ||
            (barrasNumerico && barrasNumerico === buscaNumerica) ||
            String(p.id) === buscaNumerica
        );
    });
}

function encontrarProdutoPorCodigoOuNome(termo) {
    const busca = normalizarTexto(termo);
    const buscaNumerica = normalizarCodigoProduto(termo);

    return produtosDisponiveis.find(p => {
        const codigo = normalizarTexto(p.codigo);
        const codigoBarras = normalizarTexto(p.codigo_barras);
        const nome = normalizarTexto(p.nome);

        const codigoNumerico = normalizarCodigoProduto(p.codigo);
        const barrasNumerico = normalizarCodigoProduto(p.codigo_barras);

        return (
            (codigo && codigo === busca) ||
            (codigoBarras && codigoBarras === busca) ||
            (codigoNumerico && codigoNumerico === buscaNumerica) ||
            (barrasNumerico && barrasNumerico === buscaNumerica) ||
            (nome && nome.includes(busca))
        );
    });
}

function adicionarItemNoCarrinho(produto, quantidade, precoUnitario, mensagemExtra = '', promocao = null, opcoes = {}) {
    const tipoVenda = normalizarTipoVendaItem(opcoes);
    const etiquetaBalanca = opcoes && opcoes.etiquetaBalanca && typeof opcoes.etiquetaBalanca === 'object'
        ? opcoes.etiquetaBalanca
        : null;
    const subtotalEtiquetaFixo = etiquetaBalanca && etiquetaBalanca.subtotalFixo != null
        ? Number(etiquetaBalanca.subtotalFixo)
        : null;

    if (tipoVendaEhUnidade(tipoVenda)) {
        quantidade = Math.max(0, Math.round(Number(quantidade || 0)));
        precoUnitario = Number(produto.preco_unidade ?? precoUnitario ?? 0);
    } else if (etiquetaBalanca) {
        // Etiqueta: 3 casas + preço cadastrado (sem promoção/atacado)
        quantidade = normalizarQuantidadeEtiquetaPdv(quantidade);
        precoUnitario = Number(precoUnitario || produto.preco_venda || 0);
        promocao = null;
    } else {
        quantidade = normalizarQuantidadePdv(quantidade, produto);
        precoUnitario = Number(precoUnitario || 0);
    }

    if (quantidade <= 0 || precoUnitario <= 0) {
        showNotification('Quantidade ou preço inválido.', 'warning');
        return;
    }

    const quantidadeEstoque = obterQuantidadeEstoqueParaVenda(produto, quantidade, tipoVenda);
    if (tipoVendaEhUnidade(tipoVenda) && quantidadeEstoque <= 0) {
        showNotification('Peso médio da unidade não configurado para este produto.', 'warning');
        return;
    }

    const precoCandidatoComposicao = promocao && !tipoVendaEhUnidade(tipoVenda) && !etiquetaBalanca
        ? Number(promocao.preco_promocional || precoUnitario)
        : precoUnitario;
    const candidatoComposicao = {
        id: produto.id,
        produto_id: produto.id,
        tipo_venda: tipoVenda,
        preco_unitario: precoCandidatoComposicao,
        tipo_preco: 'varejo',
        desconto_percentual: promocao && !tipoVendaEhUnidade(tipoVenda) && !etiquetaBalanca
            ? Number(promocao.desconto_percentual || 0)
            : 0,
        desconto_valor: 0,
        desconto_manual: 0,
        promocao_id: promocao?.id || null,
        desconto_atacado: 0,
        preco_manual: 0,
        etiqueta_balanca: etiquetaBalanca,
        subtotal_fixo: subtotalEtiquetaFixo
    };
    const modoComposicao = pdvObterModoComposicaoItens();
    let decisaoComposicao;
    if (typeof PDVItemCompositionService !== 'undefined'
        && typeof PDVItemCompositionService.decidirComposicao === 'function') {
        decisaoComposicao = PDVItemCompositionService.decidirComposicao(
            carrinho,
            candidatoComposicao,
            modoComposicao
        );
    } else {
        const existenteFallback = modoComposicao === 'SEPARAR'
            ? null
            : carrinho.find((item) =>
                Number(item.id) === Number(produto.id) && normalizarTipoVendaItem(item) === tipoVenda
            );
        decisaoComposicao = existenteFallback
            ? {
                acao: 'UNIFICAR',
                linhaExistente: existenteFallback,
                index: carrinho.indexOf(existenteFallback),
                linha_id: existenteFallback.linha_id || ('L' + Date.now())
            }
            : {
                acao: 'CRIAR',
                linhaExistente: null,
                index: -1,
                linha_id: 'L' + Date.now()
            };
    }
    const itemExistentePre = decisaoComposicao.acao === 'UNIFICAR' ? decisaoComposicao.linhaExistente : null;

    const qtdJaNoCarrinho = (typeof PDVItemCompositionService !== 'undefined'
        && typeof PDVItemCompositionService.somarQuantidadeProduto === 'function')
        ? PDVItemCompositionService.somarQuantidadeProduto(carrinho, produto.id, tipoVenda)
        : carrinho
            .filter((item) => Number(item.id) === Number(produto.id) && normalizarTipoVendaItem(item) === tipoVenda)
            .reduce((acc, item) => acc + Number(item.quantidade || 0), 0);
    const quantidadeTotalPrevistaBruta = Number(qtdJaNoCarrinho) + Number(quantidade);
    const quantidadeTotalPrevista = tipoVendaEhUnidade(tipoVenda)
        ? quantidadeTotalPrevistaBruta
        : (etiquetaBalanca
            ? normalizarQuantidadeEtiquetaPdv(quantidadeTotalPrevistaBruta)
            : Number(quantidadeTotalPrevistaBruta.toFixed(2)));
    const quantidadeEstoqueValidacao = obterQuantidadeEstoqueParaVenda(produto, quantidadeTotalPrevista, tipoVenda);

    const analiseTransferencia = pdvAnalisarTransferenciaEstoque(produto, quantidadeEstoqueValidacao);
    if (analiseTransferencia.devePerguntar && opcoes.transferenciaResposta == null) {
        abrirModalTransferirEstoquePdv(function (sim) {
            adicionarItemNoCarrinho(produto, quantidade, precoUnitario, mensagemExtra, promocao, {
                ...opcoes,
                transferenciaResposta: sim === true,
                quantidadeTransferir: analiseTransferencia.quantidadeTransferir
            });
        });
        return;
    }

    if (pdvDeveInformarNcm(produto) && opcoes.ncmInformadoNoPdv !== true) {
        abrirModalNcmProdutoPdv(produto, function (ncmDigitado) {
            if (!ncmDigitado) {
                focarCampoCodigo({ limpar: true });
                return;
            }
            sincronizarNcmCadastroProdutoPdv(produto, ncmDigitado, function (ok, produtoAtualizado) {
                if (!ok) {
                    focarCampoCodigo({ limpar: true });
                    return;
                }
                adicionarItemNoCarrinho(
                    produtoAtualizado || Object.assign({}, produto, { ncm: ncmDigitado }),
                    quantidade,
                    precoUnitario,
                    mensagemExtra,
                    promocao,
                    { ...opcoes, ncmInformadoNoPdv: true }
                );
            });
        });
        return;
    }

    const recusouTransferencia = opcoes.transferenciaResposta === false;
    const pendingAtual = Number(itemExistentePre?.transferencia_nao_fiscal_para_fiscal || 0);
    const adicionalTransferencia = !recusouTransferencia
        && opcoes.transferenciaResposta === true
        && analiseTransferencia.podeTransferir
        ? Number(analiseTransferencia.quantidadeTransferir || 0)
        : 0;
    const quantidadeTransferirLinha = round3TransferenciaPdv(pendingAtual + adicionalTransferencia);

    const idxLinha = itemExistentePre ? carrinho.indexOf(itemExistentePre) : -1;
    const saldosBase = pdvSaldosComTransferenciasPendentes(
        produto,
        idxLinha >= 0 ? idxLinha : undefined
    );
    const produtoParaValidar = quantidadeTransferirLinha > 0
        ? {
            ...produto,
            saldo_fiscal: Number(saldosBase.saldo_fiscal || 0) + quantidadeTransferirLinha,
            saldo_nao_fiscal: Number(saldosBase.saldo_nao_fiscal || 0) - quantidadeTransferirLinha
        }
        : produto;

    const qtdEstoqueChecagem = quantidadeEstoqueValidacao;
    const validacaoEstoque = pdvValidarEstoqueVenda(produtoParaValidar, qtdEstoqueChecagem);
    if (validacaoEstoque.semSaldoTotal) {
        pdvNotificarEstoqueInsuficiente(produtoParaValidar, qtdEstoqueChecagem);
        return;
    }
    if (validacaoEstoque.confirmarSemEstoque && !validacaoEstoque.semSaldoTotal && opcoes.vendaSemEstoqueConfirmada !== true) {
        abrirModalVendaSemEstoquePdv(produto, validacaoEstoque, function (sim) {
            if (!sim) {
                focarCampoCodigo({ limpar: true });
                return;
            }
            adicionarItemNoCarrinho(produto, quantidade, precoUnitario, mensagemExtra, promocao, {
                ...opcoes,
                vendaSemEstoqueConfirmada: true
            });
        });
        return;
    }
    if (!pdvNotificarEstoqueInsuficiente(produtoParaValidar, qtdEstoqueChecagem)) {
        return;
    }

    const precoPromocional = promocao && !tipoVendaEhUnidade(tipoVenda) && !etiquetaBalanca
        ? Number(promocao.preco_promocional || precoUnitario)
        : precoUnitario;
    const percentualPromocao = promocao && !tipoVendaEhUnidade(tipoVenda) && !etiquetaBalanca
        ? Number(promocao.desconto_percentual || 0)
        : 0;

    // Aplica preço atacado se ativo: obtém faixas e escolhe maior faixa atendida
    function obterPrecoAtacado(produtoId, quantidadeTotal, precoBase) {
        try {
            let faixas = [];
            $.ajax({ url: `${API_URL}/produtos/${produtoId}/atacado`, method: 'GET', async: false, headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }, success: function(res) { faixas = res || []; } });

            if (!Array.isArray(faixas) || faixas.length === 0) {
                return { preco: precoBase, descontoAtacado: 0, isAtacado: false };
            }

            let escolhida = null;
            faixas.forEach(f => {
                const qmin = Number(f.quantidade_minima || 0);
                if (quantidadeTotal >= qmin) {
                    if (!escolhida || qmin > Number(escolhida.quantidade_minima || 0)) escolhida = f;
                }
            });

            if (!escolhida) return { preco: precoBase, descontoAtacado: 0, isAtacado: false };

            const precoAtacado = Number(escolhida.preco_atacado || 0);
            if (precoAtacado <= 0) return { preco: precoBase, descontoAtacado: 0, isAtacado: false };

            if (!motorPrecoAtacadoDisponivel()) {
                return { preco: precoBase, descontoAtacado: 0, isAtacado: false };
            }

            const calc = MotorPrecoAtacado.calcularLinhaAtacadoFaixa({
                precoVenda: Number(produto.preco_venda || precoBase),
                precoAtacado,
                quantidade: quantidadeTotal
            });
            const precoAplicado = Math.min(Number(precoBase), calc.precoUnitarioInterno);
            const linha = MotorPrecoAtacado.calcularLinhaPrecoUnitarioInformado({
                precoOriginal: Number(produto.preco_venda || precoBase),
                quantidade: quantidadeTotal,
                precoUnitarioInformado: precoAplicado
            });

            return {
                preco: precoAplicado,
                descontoAtacado: calc.descontoAtacado,
                isAtacado: precoAplicado < Number(precoBase),
                subtotal: linha.total
            };
        } catch (err) {
            return { preco: precoBase, descontoAtacado: 0, isAtacado: false };
        }
    }

    // calcula preco final considerando promoção primeiro, depois atacado (se mais vantajoso)
    let precoFinal = precoPromocional;
    let descontoAtacadoItem = 0;

    const itemExistente = decisaoComposicao.acao === 'UNIFICAR' ? decisaoComposicao.linhaExistente : null;

    if (itemExistente) {
        if (typeof PDVItemCompositionService !== 'undefined'
            && typeof PDVItemCompositionService.garantirLinhaId === 'function') {
            PDVItemCompositionService.garantirLinhaId(itemExistente);
        } else if (!itemExistente.linha_id) {
            itemExistente.linha_id = decisaoComposicao.linha_id || ('L' + Date.now());
        }

        const novaQuantidadeBruta = Number(itemExistente.quantidade) + quantidade;
        const novaQuantidade = tipoVendaEhUnidade(tipoVenda)
            ? novaQuantidadeBruta
            : (etiquetaBalanca
                ? normalizarQuantidadeEtiquetaPdv(novaQuantidadeBruta)
                : Number(novaQuantidadeBruta.toFixed(2)));
        const novaQuantidadeEstoque = obterQuantidadeEstoqueParaVenda(
            produto,
            quantidadeTotalPrevista,
            tipoVenda
        );

        if (opcoes.vendaSemEstoqueConfirmada !== true) {
            const validacaoTotal = pdvValidarEstoqueVenda(produtoParaValidar, novaQuantidadeEstoque);
            if (validacaoTotal.confirmarSemEstoque) {
                abrirModalVendaSemEstoquePdv(produto, validacaoTotal, function (sim) {
                    if (!sim) {
                        focarCampoCodigo({ limpar: true });
                        return;
                    }
                    adicionarItemNoCarrinho(produto, quantidade, precoUnitario, mensagemExtra, promocao, {
                        ...opcoes,
                        vendaSemEstoqueConfirmada: true
                    });
                });
                return;
            }
        }
        if (!pdvNotificarEstoqueInsuficiente(produtoParaValidar, novaQuantidadeEstoque)) {
            return;
        }

        // reavaliar preço atacado com a nova quantidade total (nunca em etiqueta de balança)
            if (!etiquetaBalanca && !tipoVendaEhUnidade(tipoVenda) && Number(produto.venda_atacado || 0) === 1) {
                const atac = obterPrecoAtacado(produto.id, novaQuantidade, precoFinal);
                precoFinal = atac.preco;
                descontoAtacadoItem = atac.descontoAtacado;
                itemExistente.tipo_preco = atac.isAtacado ? 'atacado' : 'varejo';
            }

        const precoBase = tipoVendaEhUnidade(tipoVenda)
            ? Number(produto.preco_unidade || precoFinal)
            : Number(produto.preco_venda || precoFinal);
        if (motorPrecoAtacadoDisponivel()) {
            aplicarCalculoMotorItemPdv(itemExistente, {
                precoOriginal: precoBase,
                quantidade: novaQuantidade,
                precoUnitarioInformado: precoFinal
            });
        } else {
            itemExistente.preco_unitario = precoFinal;
            itemExistente.desconto_percentual = precoBase > 0 ? Number(((1 - precoFinal / precoBase) * 100).toFixed(2)) : 0;
            itemExistente.subtotal = Number((novaQuantidade * precoFinal).toFixed(2));
        }

        itemExistente.quantidade = novaQuantidade;
        itemExistente.promocao_id = promocao?.id || null;
        itemExistente.desconto_atacado = descontoAtacadoItem;
        itemExistente.tipo_venda = tipoVenda;
        itemExistente.transferencia_nao_fiscal_para_fiscal = quantidadeTransferirLinha;
        if (etiquetaBalanca) {
            itemExistente.etiqueta_balanca = etiquetaBalanca;
        }
        if (subtotalEtiquetaFixo != null && Number.isFinite(subtotalEtiquetaFixo)) {
            itemExistente.subtotal = Number((Number(itemExistente.subtotal || 0) + subtotalEtiquetaFixo).toFixed(2));
        }
    } else {
        // avaliar atacado para quantidade inicial (nunca em etiqueta de balança)
            if (!etiquetaBalanca && !tipoVendaEhUnidade(tipoVenda) && Number(produto.venda_atacado || 0) === 1) {
                const atac = obterPrecoAtacado(produto.id, quantidade, precoFinal);
                precoFinal = atac.preco;
                descontoAtacadoItem = atac.descontoAtacado;
            }

            const precoBase = tipoVendaEhUnidade(tipoVenda)
                ? Number(produto.preco_unidade || precoFinal)
                : Number(produto.preco_venda || precoFinal);

            const qtdCarrinho = tipoVendaEhUnidade(tipoVenda)
                ? quantidade
                : (etiquetaBalanca ? normalizarQuantidadeEtiquetaPdv(quantidade) : Number(quantidade.toFixed(2)));

            const novoItem = {
                linha_id: decisaoComposicao.linha_id
                    || (typeof PDVItemCompositionService !== 'undefined'
                        && typeof PDVItemCompositionService.gerarLinhaId === 'function'
                        ? PDVItemCompositionService.gerarLinhaId()
                        : ('L' + Date.now())),
                id: produto.id,
                nome: produto.nome,
                quantidade: qtdCarrinho,
                preco_unitario: precoFinal,
                preco_base: precoBase,
                desconto_percentual: 0,
                desconto_valor: 0,
                desconto_manual: 0,
                promocao_id: promocao?.id || null,
                desconto_atacado: descontoAtacadoItem,
                tipo_preco: (Number(produto.venda_atacado || 0) === 1 && descontoAtacadoItem > 0) ? 'atacado' : 'varejo',
                subtotal: 0,
                item_fiscal: Number(produto.item_fiscal || 0),
                tipo_venda: tipoVenda,
                transferencia_nao_fiscal_para_fiscal: quantidadeTransferirLinha
            };
            if (etiquetaBalanca) {
                novoItem.etiqueta_balanca = etiquetaBalanca;
            }
            if (subtotalEtiquetaFixo != null && Number.isFinite(subtotalEtiquetaFixo)) {
                novoItem.subtotal_fixo = subtotalEtiquetaFixo;
            }

            if (subtotalEtiquetaFixo != null && Number.isFinite(subtotalEtiquetaFixo)) {
                novoItem.subtotal = Number(subtotalEtiquetaFixo.toFixed(2));
            } else if (motorPrecoAtacadoDisponivel()) {
                aplicarCalculoMotorItemPdv(novoItem, {
                    precoOriginal: precoBase,
                    quantidade: qtdCarrinho,
                    precoUnitarioInformado: precoFinal
                });
            } else {
                novoItem.subtotal = Number((qtdCarrinho * precoFinal).toFixed(2));
            }

            carrinho.push(novoItem);
    }

    const idxDestaque = itemExistente
        ? carrinho.indexOf(itemExistente)
        : carrinho.length - 1;
    // Nova venda após entrega configurada → volta o texto padrão do botão
    if (window.PdvVendaEntrega && typeof PdvVendaEntrega.estaConfigurada === 'function'
        && PdvVendaEntrega.estaConfigurada()) {
        window.pdvEntregaConfigurada = false;
        if (typeof PdvVendaEntrega.definirTipoVendaUi === 'function') {
            PdvVendaEntrega.definirTipoVendaUi('BALCAO');
        }
    }
    destacarLinhaCarrinho(idxDestaque);
    atualizarCarrinho();
    const msgDesconto = percentualPromocao > 0 ? ` (Promoção -${percentualPromocao}%)` : '';
    showNotification(`${produto.nome} adicionado ao carrinho${msgDesconto}${mensagemExtra}.`, 'success');
    focarCampoCodigo({ limpar: true });
}

function abrirModalModoVendaProduto(produto, callback) {
    $('#modalModoVendaProduto').remove();

    const modalHtml = `
        <div class="modal fade" id="modalModoVendaProduto" tabindex="-1">
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header py-2">
                        <h6 class="modal-title">Como deseja vender?</h6>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-3 fw-bold">${escapeHtml(produto.nome || 'Produto')}</p>
                        <div class="form-check mb-2">
                            <input class="form-check-input" type="radio" name="modoVendaProduto" id="modoVendaPeso" value="PESO" checked>
                            <label class="form-check-label" for="modoVendaPeso">Peso</label>
                        </div>
                        <div class="form-check">
                            <input class="form-check-input" type="radio" name="modoVendaProduto" id="modoVendaUnidade" value="UNIDADE">
                            <label class="form-check-label" for="modoVendaUnidade">Unidade</label>
                        </div>
                    </div>
                    <div class="modal-footer py-2">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="btnConfirmarModoVendaProduto">Continuar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);

    const modalEl = document.getElementById('modalModoVendaProduto');
    const modal = new bootstrap.Modal(modalEl);
    let continuando = false;
    modal.show();

    const confirmar = () => {
        const modo = $('input[name="modoVendaProduto"]:checked').val() || TIPO_VENDA_PESO;
        continuando = true;
        modal.hide();
        callback(modo);
    };

    $('#btnConfirmarModoVendaProduto').off('click').on('click', confirmar);
    modalEl.addEventListener('hidden.bs.modal', function onHidden() {
        modalEl.removeEventListener('hidden.bs.modal', onHidden);
        $('#modalModoVendaProduto').remove();
        // Ao continuar, o próximo modal (quantidade) assume o foco
        if (!continuando) {
            focarCampoCodigo({ limpar: true });
        }
    }, { once: true });
}

function pdvSepararItensAtivo() {
    return pdvObterModoComposicaoItens() === 'SEPARAR';
}

function continuarAdicionarProdutoPdv(produto, promocao, tipoVenda = TIPO_VENDA_PESO) {
    if (tipoVendaEhUnidade(tipoVenda)) {
        const qtdTeste = obterQuantidadeEstoqueParaVenda(produto, 1, TIPO_VENDA_UNIDADE);
        const qtdMin = qtdTeste > 0 ? qtdTeste : 0.001;
        if (produtoControlaEstoquePdv(produto) && !pdvNotificarEstoqueInsuficiente(produto, qtdMin)) {
            return;
        }

        if (pdvSepararItensAtivo()) {
            adicionarItemNoCarrinho(
                produto,
                1,
                Number(produto.preco_unidade || 0),
                ' - 1 un.',
                null,
                { tipo_venda: TIPO_VENDA_UNIDADE }
            );
            return;
        }

        abrirModalQuantidadeProduto(produto, function (quantidade) {
            adicionarItemNoCarrinho(
                produto,
                quantidade,
                Number(produto.preco_unidade || 0),
                ` - ${quantidade} un.`,
                null,
                { tipo_venda: TIPO_VENDA_UNIDADE }
            );
        }, { tipo_venda: TIPO_VENDA_UNIDADE });
        return;
    }

    if (permiteQuantidadeDecimal(produto)) {
        const unidade = String(produto.unidade || 'UN').toUpperCase();
        abrirModalQuantidadeProduto(produto, function (qtd) {
            const extra = unidadeEhKg(produto)
                ? ` - Peso: ${formatarQuantidadePdv(qtd, produto)} KG`
                : ` - Qtd: ${formatarQuantidadePdv(qtd, produto)} ${unidade}`;
            adicionarItemNoCarrinho(
                produto,
                qtd,
                Number(produto.preco_venda || 0),
                extra,
                promocao,
                { tipo_venda: TIPO_VENDA_PESO }
            );
        });
        return;
    }

    if (pdvSepararItensAtivo()) {
        adicionarItemNoCarrinho(
            produto,
            1,
            Number(produto.preco_venda || 0),
            '',
            promocao,
            { tipo_venda: TIPO_VENDA_PESO }
        );
        return;
    }

    abrirModalQuantidadeProduto(produto, function (quantidade) {
        adicionarItemNoCarrinho(
            produto,
            quantidade,
            Number(produto.preco_venda || 0),
            '',
            promocao,
            { tipo_venda: TIPO_VENDA_PESO }
        );
    });
}

function iniciarFluxoAdicionarProdutoPdv(produto, promocao) {
    if (produtoPermiteEscolhaVendaUnidade(produto)) {
        abrirModalModoVendaProduto(produto, function (tipoVenda) {
            continuarAdicionarProdutoPdv(produto, promocao, tipoVenda);
        });
        return;
    }

    continuarAdicionarProdutoPdv(produto, promocao, TIPO_VENDA_PESO);
}

function adicionarProdutoPorCodigo(codigo) {
    if (!codigo || !codigo.trim()) return;

    // DEBUG 01 — rastreamento PLU (temporário)
    console.log('[PDV] Código recebido:', String(codigo).trim());

    if (!Array.isArray(produtosDisponiveis) || produtosDisponiveis.length === 0) {
        console.log('[PDV DEBUG] INTERRUPÇÃO: produtosDisponiveis vazio — não chama MIP nem legado');
        showNotification('Nenhum produto disponível para venda.', 'warning');
        return;
    }

    const codigoDigitado = String(codigo).trim();

    // Sprint 09 — MIP primeiro; legado só como fallback
    console.log('[PDV] Chamando ProdutoIdentidadeService (via /produtos/identificar)');
    adicionarProdutoPorCodigoViaMip(codigoDigitado);
}

/**
 * Caminho legado — cache local (fallback Sprint 09).
 * RC1: etiquetas de balança NUNCA passam pelo parser legado.
 */
function adicionarProdutoPorCodigoLegado(codigoDigitado) {
    // RC1 — etiquetas só pelo Motor de Equipamentos
    if (codigoEhBalanca(codigoDigitado)) {
        showNotification('Nenhuma balança configurada para o PDV.', 'warning');
        return;
    }

    const produtoEncontrado = encontrarProdutoPorCodigoExato(codigoDigitado);

    if (!produtoEncontrado) {
        showNotification(`Produto não encontrado: ${codigoDigitado}`, 'danger');
        return;
    }

    Promise.resolve(garantirProdutoNoCatalogoPdv(produtoEncontrado)).then(function (hidratado) {
        const produto = hidratado || produtoEncontrado;
        const validacaoMinima = pdvPodeIniciarInclusaoProduto(produto);
        if (!validacaoMinima.sucesso) {
            showNotification(validacaoMinima.mensagem, 'danger');
            return;
        }

        buscarPromocaoAtivaProduto(produto.id).then(promocao => {
            iniciarFluxoAdicionarProdutoPdv(produto, promocao);
        });
    });
}

/**
 * Porta oficial MIP + Motor Equipamentos (RC1).
 * Etiqueta: Motor → layout ativo? → Parser → MIP(PLU) → carrinho
 * Sem layout ativo: mensagem amigável e encerra (sem parser legado).
 */
async function adicionarProdutoPorCodigoViaMip(codigoDigitado) {
    let resultado = null;
    let parseMotor = null;
    let codigoParaMip = String(codigoDigitado || '').trim();
    const ehEtiqueta = codigoEhBalanca(codigoParaMip);
    const t0Total = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    let consultas = 0;
    let tempoMotorMs = 0;
    let tempoParserMs = 0;
    let tempoMipMs = 0;

    const nowMs = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());

    try {
        const mgv6 = parseMGV6ScaleEan13Pdv(codigoParaMip);
        if (mgv6 && mgv6.ok === false) {
            showNotification('Etiqueta MGV6 inválida (dígito verificador).', 'warning');
            return;
        }
        if (mgv6 && mgv6.ok === true) {
            parseMotor = montarParseMotorMGV6(mgv6);
            codigoParaMip = String(mgv6.plu);
            consultas += 1;
            const t0Mip = nowMs();
            resultado = await identificarProdutoViaMip(codigoParaMip, { aposMotorEquipamentos: true });
            tempoMipMs = Number((nowMs() - t0Mip).toFixed(3));
        } else if (ehEtiqueta) {
            consultas += 1;
            const t0Motor = nowMs();
            parseMotor = await interpretarEtiquetaViaMotorEquipamentos(codigoParaMip);
            const metricas = parseMotor.metricas || {};
            tempoMotorMs = Number(metricas.tempoMotorMs != null ? metricas.tempoMotorMs : (nowMs() - t0Motor));
            tempoParserMs = Number(metricas.tempoParserMs || 0);

            if (parseMotor.semLayoutAtivo) {
                pdvAuditoriaEquipamentos('sem_layout_ativo', {
                    codigo: codigoParaMip,
                    resultado: 'BLOQUEADO',
                    mensagem: parseMotor.mensagem,
                    tempoMotorMs,
                    tempoParserMs: 0,
                    tempoMipMs: 0,
                    tempoTotalMs: Number((nowMs() - t0Total).toFixed(3)),
                    quantidadeConsultas: consultas,
                    layoutUtilizado: null,
                    pluExtraido: null
                });
                showNotification('Nenhuma balança configurada para o PDV.', 'warning');
                return;
            }

            // PLU "0" / "00" / "0000" são válidos — não usar truthiness frouxa
            const pluMotor = parseMotor.resultado && parseMotor.resultado.plu;
            const pluRawMotor = parseMotor.resultado && parseMotor.resultado.pluRaw;
            const pluOk = pluMotor === 0
                || (pluMotor != null && String(pluMotor).replace(/\D/g, '').length > 0)
                || (pluRawMotor != null && String(pluRawMotor).replace(/\D/g, '').length > 0);
            if (!parseMotor.sucesso || !parseMotor.resultado || !pluOk) {
                pdvAuditoriaEquipamentos('parser_falhou', {
                    codigo: codigoParaMip,
                    resultado: 'FALHA_PARSER',
                    mensagem: parseMotor.mensagem || null,
                    tempoMotorMs,
                    tempoParserMs,
                    tempoMipMs: 0,
                    tempoTotalMs: Number((nowMs() - t0Total).toFixed(3)),
                    quantidadeConsultas: consultas,
                    layoutUtilizado: parseMotor.layout && parseMotor.layout.preset_id
                        ? parseMotor.layout.preset_id
                        : null,
                    pluExtraido: null
                });
                showNotification(
                    parseMotor.mensagem || 'Não foi possível interpretar a etiqueta no Motor de Equipamentos.',
                    'warning'
                );
                return;
            }

            // Preferir pluRaw (com zeros) para achar cadastro 00 / 0000
            codigoParaMip = String(
                (pluRawMotor != null && String(pluRawMotor).trim() !== '')
                    ? pluRawMotor
                    : pluMotor
            );
            consultas += 1;
            const t0Mip = nowMs();
            resultado = await identificarProdutoViaMip(codigoParaMip, { aposMotorEquipamentos: true });
            tempoMipMs = Number((nowMs() - t0Mip).toFixed(3));
        } else {
            consultas += 1;
            const t0Mip = nowMs();
            resultado = await identificarProdutoViaMip(codigoParaMip);
            tempoMipMs = Number((nowMs() - t0Mip).toFixed(3));
        }
    } catch (err) {
        pdvAuditoriaEquipamentos('erro_fluxo', {
            codigo: String(codigoDigitado || ''),
            resultado: 'ERRO',
            mensagem: err && err.message ? err.message : String(err),
            tempoMotorMs,
            tempoParserMs,
            tempoMipMs,
            tempoTotalMs: Number((nowMs() - t0Total).toFixed(3)),
            quantidadeConsultas: consultas,
            layoutUtilizado: parseMotor && parseMotor.layout ? parseMotor.layout.preset_id : null,
            pluExtraido: parseMotor && parseMotor.resultado ? parseMotor.resultado.plu : null
        });
        if (ehEtiqueta) {
            showNotification(
                (err && err.message) || 'Falha ao processar etiqueta no Motor de Equipamentos.',
                'danger'
            );
            return;
        }
        adicionarProdutoPorCodigoLegado(codigoDigitado);
        return;
    }

    const layoutId = (parseMotor && parseMotor.layout && parseMotor.layout.preset_id)
        || (parseMotor && parseMotor.resultado && parseMotor.resultado.layoutId)
        || null;
    const pluExtraido = parseMotor && parseMotor.resultado ? parseMotor.resultado.plu : null;
    const pluRawExtraido = parseMotor && parseMotor.resultado ? parseMotor.resultado.pluRaw : null;

    /** Fallback local quando MIP off/não acha — etiqueta já interpretada pelo Motor */
    const resolverEtiquetaNoCacheLocal = () => {
        if (!ehEtiqueta || !parseMotor || !parseMotor.resultado) return null;
        return encontrarProdutoPorPluBalanca(parseMotor.resultado.plu, parseMotor.resultado.pluRaw);
    };

    if (resultado && resultado.habilitado === false) {
        if (ehEtiqueta) {
            const local = resolverEtiquetaNoCacheLocal();
            if (local && local.id) {
                resultado = {
                    encontrado: true,
                    habilitado: false,
                    produtoId: local.id,
                    produto: local,
                    fallbackLegado: true,
                    strategy: 'CACHE_PLU_PDV'
                };
                pdvAuditoriaEquipamentos('fallback_plu_local_mip_off', {
                    codigo: String(codigoDigitado || ''),
                    resultado: 'OK_CACHE',
                    produtoId: local.id,
                    pluExtraido,
                    pluRaw: pluRawExtraido,
                    tempoMotorMs,
                    tempoParserMs,
                    tempoMipMs,
                    tempoTotalMs: Number((nowMs() - t0Total).toFixed(3)),
                    quantidadeConsultas: consultas,
                    layoutUtilizado: layoutId
                });
            } else {
                showNotification(`Produto não encontrado: PLU ${codigoParaMip}`, 'danger');
                pdvAuditoriaEquipamentos('mip_desabilitado', {
                    codigo: String(codigoDigitado || ''),
                    resultado: 'MIP_OFF',
                    tempoMotorMs, tempoParserMs, tempoMipMs,
                    tempoTotalMs: Number((nowMs() - t0Total).toFixed(3)),
                    quantidadeConsultas: consultas,
                    layoutUtilizado: layoutId,
                    pluExtraido
                });
                return;
            }
        } else {
            adicionarProdutoPorCodigoLegado(codigoDigitado);
            return;
        }
    }

    if (!resultado || !resultado.encontrado) {
        pdvAuditoriaEquipamentos('produto_nao_encontrado', {
            codigo: String(codigoDigitado || ''),
            resultado: 'NAO_ENCONTRADO',
            tempoMotorMs, tempoParserMs, tempoMipMs,
            tempoTotalMs: Number((nowMs() - t0Total).toFixed(3)),
            quantidadeConsultas: consultas,
            layoutUtilizado: layoutId,
            pluExtraido
        });
        if (ehEtiqueta) {
            const local = resolverEtiquetaNoCacheLocal();
            if (local && local.id) {
                resultado = {
                    encontrado: true,
                    produtoId: local.id,
                    produto: local,
                    fallbackLegado: true,
                    strategy: 'CACHE_PLU_PDV'
                };
                pdvAuditoriaEquipamentos('fallback_plu_local', {
                    codigo: String(codigoDigitado || ''),
                    resultado: 'OK_CACHE',
                    produtoId: local.id,
                    pluExtraido,
                    pluRaw: pluRawExtraido
                });
            } else {
                showNotification(`Produto não encontrado: PLU ${codigoParaMip}`, 'danger');
                return;
            }
        } else {
            adicionarProdutoPorCodigoLegado(codigoDigitado);
            return;
        }
    }

    const noCache = encontrarProdutoPorIdPdv(resultado.produtoId);
    const produto = noCache
        || (resultado.produto && resultado.produto.id
            ? encontrarProdutoPorIdPdv(resultado.produto.id)
            : null)
        || resultado.produto;

    if (!produto || !produto.id) {
        if (ehEtiqueta) {
            const local = resolverEtiquetaNoCacheLocal();
            if (local && local.id) {
                // usa local abaixo
                Object.assign(resultado, { produtoId: local.id, produto: local });
            } else {
                showNotification(`Produto não encontrado: PLU ${codigoParaMip}`, 'danger');
                return;
            }
        } else {
            adicionarProdutoPorCodigoLegado(codigoDigitado);
            return;
        }
    }

    const produtoFinal = (produto && produto.id)
        ? produto
        : (resultado.produto && resultado.produto.id ? resultado.produto : null);

    if (!produtoFinal || !produtoFinal.id) {
        if (ehEtiqueta) {
            showNotification(`Produto não encontrado: PLU ${codigoParaMip}`, 'danger');
            return;
        }
        adicionarProdutoPorCodigoLegado(codigoDigitado);
        return;
    }

    const produtoCarrinho = (await garantirProdutoNoCatalogoPdv(produtoFinal)) || produtoFinal;

    const veioDoMotor = Boolean(parseMotor && parseMotor.resultado);

    if (veioDoMotor) {
        if (!unidadeEhKg(produtoCarrinho)) {
            showNotification(`O produto ${produtoCarrinho.nome} não está cadastrado como KG.`, 'warning');
            return;
        }

        const calc = calcularItemEtiquetaBalancaPdv(produtoCarrinho, parseMotor.resultado || {});
        if (!calc.ok) {
            showNotification(calc.mensagem, 'danger');
            return;
        }

        pdvAuditoriaEquipamentos('carrinho_etiqueta', {
            codigo: String(codigoDigitado || ''),
            resultado: 'OK',
            produtoId: produtoCarrinho.id,
            produtoNome: produtoCarrinho.nome,
            tipoPayload: calc.tipoPayload,
            quantidade: calc.quantidade,
            valorTotal: calc.subtotal,
            precoUnitario: calc.precoUnitario,
            tempoMotorMs,
            tempoParserMs,
            tempoMipMs,
            tempoTotalMs: Number((nowMs() - t0Total).toFixed(3)),
            quantidadeConsultas: consultas,
            layoutUtilizado: layoutId,
            pluExtraido
        });

        // Sem promoção/atacado: total da etiqueta (VALOR) ou peso × preço (PESO)
        const validacaoEtiqueta = pdvPodeIniciarInclusaoProduto(produtoCarrinho);
        if (!validacaoEtiqueta.sucesso) {
            showNotification(validacaoEtiqueta.mensagem, 'danger');
            return;
        }

        adicionarItemNoCarrinho(
            produtoCarrinho,
            calc.quantidade,
            calc.precoUnitario,
            calc.mensagemExtra,
            null,
            {
                etiquetaBalanca: {
                    tipoPayload: calc.tipoPayload,
                    subtotalFixo: calc.tipoPayload === 'VALOR' ? calc.subtotal : null
                }
            }
        );
        return;
    }

    const validacaoMinima = pdvPodeIniciarInclusaoProduto(produtoCarrinho);
    if (!validacaoMinima.sucesso) {
        showNotification(validacaoMinima.mensagem, 'danger');
        return;
    }

    pdvAuditoriaEquipamentos('carrinho_normal', {
        codigo: String(codigoDigitado || ''),
        resultado: 'OK',
        produtoId: produtoCarrinho.id,
        tempoMipMs,
        tempoTotalMs: Number((nowMs() - t0Total).toFixed(3)),
        quantidadeConsultas: consultas,
        layoutUtilizado: null,
        pluExtraido: null
    });

    buscarPromocaoAtivaProduto(produtoCarrinho.id).then(function(promocao) {
        iniciarFluxoAdicionarProdutoPdv(produtoCarrinho, promocao);
    });
}

function atualizarQuantidade(index, quantidade, opcoes = {}) {
    const item = carrinho[index];

    if (!item) return;

    const produto = produtosDisponiveis.find(p => Number(p.id) === Number(item.id));
    if (!produto) {
        showNotification('Produto do carrinho não encontrado no cadastro.', 'danger');
        return;
    }

    const vendaUnidade = itemVendaPorUnidade(item);
    const novaQuantidade = vendaUnidade
        ? Math.max(0, Math.round(Number(parseQuantidadePdv(quantidade) || 0)))
        : normalizarQuantidadePdv(parseQuantidadePdv(quantidade), produto);

    if (Number.isNaN(novaQuantidade) || novaQuantidade <= 0) {
        removerItemCarrinho(index);
        return;
    }

    const quantidadeEstoque = vendaUnidade
        ? obterQuantidadeEstoqueParaVenda(produto, novaQuantidade, 'unidade')
        : novaQuantidade;

    if (vendaUnidade && quantidadeEstoque <= 0) {
        showNotification('Peso médio da unidade não configurado para este produto.', 'warning');
        atualizarCarrinho();
        return;
    }

    const validacaoEstoque = pdvValidarEstoqueVenda(produto, quantidadeEstoque);
    if (validacaoEstoque.semSaldoTotal) {
        pdvNotificarEstoqueInsuficiente(produto, quantidadeEstoque);
        atualizarCarrinho();
        return;
    }
    if (validacaoEstoque.confirmarSemEstoque && !validacaoEstoque.semSaldoTotal && opcoes.vendaSemEstoqueConfirmada !== true) {
        abrirModalVendaSemEstoquePdv(produto, validacaoEstoque, function (sim) {
            if (!sim) {
                atualizarCarrinho();
                focarCampoCodigo({ limpar: true });
                return;
            }
            atualizarQuantidade(index, quantidade, { vendaSemEstoqueConfirmada: true });
        });
        return;
    }

    if (!pdvNotificarEstoqueInsuficiente(produto, quantidadeEstoque)) {
        atualizarCarrinho();
        return;
    }

    // reavaliar preço atacado quando a quantidade mudar
    let precoAplicado = Number(item.preco_unitario || 0);
    let descontoAtacadoItem = Number(item.desconto_atacado || 0);
    if (!vendaUnidade && Number(produto.venda_atacado || 0) === 1) {
        const atac = obterPrecoAtacado(produto.id, novaQuantidade, precoAplicado);
        precoAplicado = atac.preco;
        descontoAtacadoItem = atac.descontoAtacado;
    }

    item.quantidade = novaQuantidade;
    item.desconto_atacado = Number((descontoAtacadoItem || 0).toFixed(2));
    const precoBase = obterPrecoBaseItemPdv(item, produto);

    if (motorPrecoAtacadoDisponivel()) {
        aplicarCalculoMotorItemPdv(item, {
            precoOriginal: precoBase,
            quantidade: novaQuantidade,
            precoUnitarioInformado: precoAplicado
        });
    } else {
        item.preco_unitario = precoAplicado;
        item.desconto_percentual = precoBase > 0 ? Number(((1 - precoAplicado / precoBase) * 100).toFixed(2)) : 0;
        item.desconto_valor = Number(((precoBase * novaQuantidade * Number(item.desconto_percentual || 0)) / 100).toFixed(2));
        item.subtotal = Number((item.preco_unitario * novaQuantidade).toFixed(2));
    }
    animarTotalLinhaCarrinho(index);
    atualizarCarrinho();
    focarCampoCodigo({ limpar: true });
}

function atualizarPercentual(index, percentual) {
    const item = carrinho[index];
    if (!item) return;

    const produto = produtosDisponiveis.find(p => Number(p.id) === Number(item.id));
    const precoBase = obterPrecoBaseItemPdv(item, produto);
    if (precoBase <= 0) return;

    if (motorPrecoAtacadoDisponivel()) {
        aplicarCalculoMotorItemPdv(item, {
            precoOriginal: precoBase,
            quantidade: item.quantidade,
            percentualDesconto: Number(percentual || 0)
        });
    } else {
        const pct = Number(percentual || 0);
        const qtd = Number(item.quantidade || 0);
        const bruto = Number((precoBase * qtd).toFixed(2));
        const valorDesc = Number(((bruto * pct) / 100).toFixed(2));
        const precoAplicado = Number((precoBase * (1 - pct / 100)).toFixed(2));
        item.desconto_percentual = Number(pct.toFixed(2));
        item.desconto_valor = valorDesc;
        item.preco_unitario = precoAplicado > 0 ? precoAplicado : 0.01;
        item.preco_base = precoBase;
        item.subtotal = Number((item.preco_unitario * qtd).toFixed(2));
    }

    animarTotalLinhaCarrinho(index);
    atualizarCarrinho();
    focarCampoCodigo({ limpar: true });
}

function atualizarDescontoValor(index, valorDesconto) {
    const item = carrinho[index];
    if (!item) return;

    const produto = produtosDisponiveis.find(p => Number(p.id) === Number(item.id));
    const precoBase = obterPrecoBaseItemPdv(item, produto);
    if (precoBase <= 0) return;

    const qtd = Number(item.quantidade || 0);
    const bruto = precoBase * qtd;
    const desc = Math.min(Math.max(0, Number(valorDesconto || 0)), bruto);

    if (motorPrecoAtacadoDisponivel() && typeof MotorPrecoAtacado.calcularLinhaDescontoValor === 'function') {
        const calc = MotorPrecoAtacado.calcularLinhaDescontoValor({
            precoOriginal: precoBase,
            quantidade: qtd,
            valorDesconto: desc
        });
        item.preco_base = precoBase;
        item.preco_unitario = calc.precoUnitarioInterno;
        item.desconto_percentual = calc.percentualDesconto;
        item.desconto_valor = Number(MotorPrecoAtacado.arredondarMoeda(calc.valorDesconto || 0));
        item.subtotal = calc.totalInterno;
        item.subtotal_exibicao = calc.total;
    } else {
        const pct = bruto > 0 ? Number(((desc / bruto) * 100).toFixed(4)) : 0;
        const totalLiq = Number((bruto - desc).toFixed(2));
        item.preco_base = precoBase;
        item.desconto_percentual = pct;
        item.desconto_valor = Number(desc.toFixed(2));
        item.preco_unitario = qtd > 0 ? Number((totalLiq / qtd).toFixed(6)) : precoBase;
        item.subtotal = totalLiq;
    }

    item.desconto_manual = desc > 0 ? 1 : 0;
    animarTotalLinhaCarrinho(index);
    atualizarCarrinho();
    focarCampoCodigo({ limpar: true });
}

function aplicarDescontoPercentualComAuth(index, percentual, $input, valorAnterior) {
    const pct = Math.max(0, Math.min(100, Number(percentual || 0)));
    if (pct <= 0) {
        const item = carrinho[index];
        if (item) item.desconto_manual = 0;
        atualizarPercentual(index, 0);
        return;
    }
    garantirAutorizacaoDesconto(
        () => {
            const item = carrinho[index];
            if (item) item.desconto_manual = 1;
            atualizarPercentual(index, pct);
        },
        () => {
            if ($input && $input.length) $input.val(Number(valorAnterior || 0).toFixed(2));
            showNotification('Desconto não autorizado.', 'warning');
        }
    );
}

function atualizarPrecoUnitario(index, valor) {
    const item = carrinho[index];
    if (!item) return;

    const produto = produtosDisponiveis.find(p => Number(p.id) === Number(item.id));
    const precoUnitario = typeof parseValorMonetarioPdv === 'function'
        ? parseValorMonetarioPdv(valor)
        : Number(valor || 0);
    if (precoUnitario <= 0) return;

    // Flag SUPER_ADMIN: unitário vira novo preço de tabela (não desconto).
    if (pdvPermitirEditarPrecoUnitario()) {
        item.preco_unitario = Number(precoUnitario.toFixed(2));
        item.preco_base = item.preco_unitario;
        item.desconto_percentual = 0;
        item.desconto_valor = 0;
        item.desconto_manual = 0;
        item.subtotal = Number((item.preco_unitario * Number(item.quantidade || 0)).toFixed(2));
        if (item.subtotal_exibicao != null) {
            item.subtotal_exibicao = item.subtotal;
        }
        animarTotalLinhaCarrinho(index);
        atualizarCarrinho();
        sincronizarPrecoCadastroProdutoPdv(item, produto, item.preco_unitario);
        focarCampoCodigo({ limpar: true });
        return;
    }

    const precoBase = obterPrecoBaseItemPdv(item, produto);
    if (precoBase <= 0) return;

    if (motorPrecoAtacadoDisponivel()) {
        aplicarCalculoMotorItemPdv(item, {
            precoOriginal: precoBase,
            quantidade: item.quantidade,
            precoUnitarioInformado: precoUnitario
        });
    } else {
        const percentual = Number(((1 - precoUnitario / precoBase) * 100).toFixed(2));
        item.desconto_percentual = percentual;
        item.preco_unitario = precoUnitario;
        item.preco_base = precoBase;
        item.subtotal = Number((precoUnitario * Number(item.quantidade || 0)).toFixed(2));
    }

    animarTotalLinhaCarrinho(index);
    atualizarCarrinho();
    focarCampoCodigo({ limpar: true });
}

/**
 * Quando a edição de unitário está liberada, grava o novo preço no cadastro do produto.
 */
function sincronizarPrecoCadastroProdutoPdv(item, produto, precoNovo) {
    const produtoId = Number(item?.id || produto?.id || 0);
    const preco = Number(precoNovo || 0);
    if (!produtoId || !(preco > 0) || typeof API_URL === 'undefined') return;

    const vendaUnidade = itemVendaPorUnidade(item);
    const payload = vendaUnidade
        ? { preco_unidade: Number(preco.toFixed(2)) }
        : { preco_venda: Number(preco.toFixed(2)) };

    const custo = Number(produto?.preco_compra || 0);
    if (!vendaUnidade && custo > 0) {
        payload.lucro_percentual = Number((((preco - custo) / custo) * 100).toFixed(2));
    }

    const token = localStorage.getItem('token') || '';
    $.ajax({
        url: `${API_URL}/produtos/${produtoId}`,
        method: 'PUT',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + token },
        data: JSON.stringify(payload)
    }).done(function (atualizado) {
        if (atualizado && atualizado.id != null) {
            upsertProdutoNoCatalogoPdv(atualizado);
        } else if (produto) {
            upsertProdutoNoCatalogoPdv({
                ...produto,
                ...payload
            });
        }
        showNotification('Preço unitário atualizado no cadastro do produto.', 'success');
    }).fail(function (xhr) {
        showNotification(
            xhr.responseJSON?.error || 'Não foi possível atualizar o preço no cadastro.',
            'danger'
        );
    });
}

function removerItemCarrinho(index) {
    const item = carrinho[index];
    if (!item) return;

    const finish = () => {
        carrinho.splice(index, 1);
        atualizarCarrinho();
        showNotification(`${item.nome} removido do carrinho.`, 'info');
        focarCampoCodigo({ limpar: true });
    };

    const $tr = $(`#tabelaItensVendaPdv tr[data-item-index="${index}"]`);
    if ($tr.length && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        $tr.addClass('pdv-item-removido');
        setTimeout(finish, 200);
        return;
    }
    finish();
}

function limparCarrinho() {
    if (carrinho.length === 0) {
        if (window.PdvVendaEntrega && typeof PdvVendaEntrega.limparEstadoEntregaUi === 'function') {
            PdvVendaEntrega.limparEstadoEntregaUi();
        }
        focarCampoCodigo({ limpar: true });
        return;
    }
    if (!window.confirm('Tem certeza que deseja limpar todo o carrinho?')) return;

    carrinho = [];
    formaPagamentoSelecionada = null;
    vendaPrazoInfo = null;
    clienteSelecionado = null;
    $('#descontoPdv').val(0);
    $('#formaPagamentoPdv').val('');
    $('#pdvClienteBox').hide();
    $('#pdvDinheiroBox').hide();
    limparCamposPrazo();
    if (window.PdvVendaEntrega && typeof PdvVendaEntrega.limparEstadoEntregaUi === 'function') {
        PdvVendaEntrega.limparEstadoEntregaUi();
    }
    atualizarCarrinho();
    focarCampoCodigo({ limpar: true });
    persistirVendaAbertaPdv();
    showNotification('Carrinho limpo com sucesso.', 'info');
}

function atualizarCarrinho() {
    sincronizarCarrinhoGlobalPdv();
    const tbody = $('#tabelaItensVendaPdv');
    if (tbody.length) {
        const el = tbody[0];
        const Focus = window.UIFocusManager;
        const html = renderCarrinhoItens();
        const aplicar = () => { tbody.html(html); };

        // Remonta o carrinho, mas se o usuário estiver no meio da edição,
        // restaura o foco no campo equivalente (sem reaplicar valor antigo).
        if (Focus && typeof Focus.withPreservedFocus === 'function') {
            Focus.withPreservedFocus(el, aplicar, { restoreValue: false });
        } else {
            aplicar();
        }

        tbody.off('click', '.item-remover').on('click', '.item-remover', function() {
            const index = $(this).data('index');
            removerItemCarrinho(index);
        });

        tbody.off('click', '.pdv-produto-miniatura').on('click', '.pdv-produto-miniatura', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            if (typeof ev.stopImmediatePropagation === 'function') {
                ev.stopImmediatePropagation();
            }
            const src = this.getAttribute('data-imagem-src') || this.getAttribute('src');
            const alt = this.getAttribute('alt') || 'Foto do produto';
            abrirFotoProdutoPdv(src, alt);
            return false;
        });

        tbody.off('change').on('change', '.quantidade-item', function() {
            const index = $(this).data('index');
            const item = carrinho[index];
            const produto = item ? produtosDisponiveis.find(p => Number(p.id) === Number(item.id)) : null;
            let novaQtd = parseQuantidadePdv($(this).val());
            if (isNaN(novaQtd) || novaQtd <= 0) {
                removerItemCarrinho(index);
            } else {
                atualizarQuantidade(index, novaQtd);
            }
        });

        tbody.on('change', '.percentual-item', function() {
            const index = $(this).data('index');
            const $input = $(this);
            const valorAnterior = Number(carrinho[index]?.desconto_percentual || 0);
            let percentual = parseFloat($input.val());
            if (isNaN(percentual) || percentual < 0) {
                atualizarCarrinho();
                return;
            }
            aplicarDescontoPercentualComAuth(index, percentual, $input, valorAnterior);
        });

        tbody.on('change', '.desconto-valor-item', function() {
            const index = $(this).data('index');
            const $input = $(this);
            const valorAnterior = obterDescontoValorItemPdv(carrinho[index]);
            let valor = parseFloat($input.val());
            if (isNaN(valor) || valor < 0) {
                atualizarCarrinho();
                return;
            }
            valor = Math.round(valor * 100) / 100;
            if (valor <= 0) {
                atualizarDescontoValor(index, 0);
                return;
            }
            garantirAutorizacaoDesconto(
                () => atualizarDescontoValor(index, valor),
                () => {
                    $input.val(Number(valorAnterior || 0).toFixed(2));
                    showNotification('Desconto não autorizado.', 'warning');
                }
            );
        });

        tbody.on('change', '.valor-item', function() {
            const index = $(this).data('index');
            const valor = parseFloat($(this).val());
            if (isNaN(valor) || valor <= 0) {
                atualizarCarrinho();
                return;
            }
            atualizarPrecoUnitario(index, valor);
        });
    }

    calcularTotal();

    const total = calcularTotalValor();
    // Só habilita finalizar se caixa aberto E houver itens no carrinho
    $('#btnFinalizarVendaPdv').prop('disabled', !caixaAberto || carrinho.length === 0 || total <= 0);
    $('#btnCancelarVendaPdv').prop('disabled', carrinho.length === 0);
    if (window.PdvVendaEntrega && typeof PdvVendaEntrega.atualizarBotaoEntrega === 'function') {
        PdvVendaEntrega.atualizarBotaoEntrega();
    }
    persistirVendaAbertaPdv();
}

function calcularSubtotal() {
    const soma = carrinho.reduce((acc, item) => acc + Number(item.subtotal || 0), 0);
    return motorPrecoAtacadoDisponivel() ? MotorPrecoAtacado.arredondarMoeda(soma) : soma;
}

function calcularTotalValor() {
    const subtotal = calcularSubtotal();
    const desconto = parseFloat($('#descontoPdv').val()) || 0;
    const acrescimo = parseFloat($('#acrescimoPdv').val()) || 0;
    return Math.max(0, subtotal - desconto + acrescimo);
}

function obterTotalVendaPDV() {
    return Math.round(calcularTotalValor() * 100) / 100;
}

function calcularTotal() {
    const subtotal = calcularSubtotal();
    const total = calcularTotalValor();
    $('#subtotalPdv').text(formatCurrency(subtotal));
    // exibe desconto atacado (informativo)
    const descontoAtacadoTotal = carrinho.reduce((acc, it) => acc + (Number(it.desconto_atacado || 0)), 0);
    $('#descontoAtacadoPdv').text(formatCurrency(descontoAtacadoTotal));
    // exibe quantidade de itens
    const quantidadeItens = carrinho.reduce((acc, it) => acc + Number(it.quantidade || 0), 0);
    $('#itensPdv').text(quantidadeItens);
    $('#totalPdv').text(formatCurrency(total));

    calcularTrocoPDV();
}

function abrirModalPagamento(onConfirm) {
    if (carrinho.length === 0) {
        showNotification('Adicione itens ao carrinho antes de finalizar a venda.', 'warning');
        return;
    }

    const total = calcularTotalValor();
    if (total <= 0) {
        showNotification('O total da venda deve ser maior que zero.', 'warning');
        return;
    }

    const modalHtml = `
        <div class="modal fade" id="pagamentoModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Forma de Pagamento</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <h4 class="text-center mb-3">Total: ${formatCurrency(total)}</h4>

                        <div class="payment-methods mb-3 d-flex flex-wrap gap-2">
                            <button type="button" class="payment-method-btn btn btn-outline-primary" data-pagamento="dinheiro">Dinheiro</button>
                            <button type="button" class="payment-method-btn btn btn-outline-primary" data-pagamento="cartao_credito">Cartão Crédito</button>
                            <button type="button" class="payment-method-btn btn btn-outline-primary" data-pagamento="cartao_debito">Cartão Débito</button>
                            <button type="button" class="payment-method-btn btn btn-outline-primary" data-pagamento="pix">PIX</button>
                            <button type="button" class="payment-method-btn btn btn-outline-primary" data-pagamento="prazo">A Prazo</button>
                        </div>

                        <div id="troco-area" style="display:none;" class="mt-4 p-3 bg-light rounded">
                            <div class="mb-3">
                                <label for="valor-recebido" class="form-label fw-bold">Valor Recebido:</label>
                                <input type="number" step="0.01" class="form-control form-control-lg text-end" id="valor-recebido" placeholder="0,00" autofocus>
                            </div>
                            <div class="mt-3 p-2 bg-white rounded border-2 border-success">
                                <div class="d-flex justify-content-between align-items-center">
                                    <span class="fw-bold">Total:</span>
                                    <span style="font-size:1.2rem;">${formatCurrency(total)}</span>
                                </div>
                                <div class="d-flex justify-content-between align-items-center mt-2">
                                    <span class="fw-bold text-success">Troco:</span>
                                    <span id="troco" style="font-size:1.5rem; color:#198754; font-weight:bold;">R$ 0,00</span>
                                </div>
                            </div>
                            <small class="text-muted d-block mt-2">💡 Dica: Digite o valor e pressione <kbd>Enter</kbd> para confirmar</small>
                        </div>

                        <div id="prazo-area" style="display:none;" class="mt-3 position-relative">
                            <div class="mb-2">
                                <label for="cliente-prazo-busca">Cliente *</label>
                                <input type="text" class="form-control" id="cliente-prazo-busca" placeholder="Digite o nome do cliente">
                                <input type="hidden" id="cliente-prazo-id">
                                <div id="cliente-prazo-sugestoes" class="list-group position-absolute w-100" style="z-index: 9999; display:none;"></div>
                            </div>
                            <div class="mb-2">
                                <label for="parcelas-prazo">Quantidade de Parcelas *</label>
                                <input type="number" min="1" max="24" class="form-control" id="parcelas-prazo" value="1">
                            </div>
                            <div class="mb-2">
                                <label for="primeiro-vencimento-prazo">Primeiro Vencimento *</label>
                                <input type="date" class="form-control" id="primeiro-vencimento-prazo">
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="confirmar-pagamento">Confirmar Pagamento</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#modal-container').html(modalHtml);

    const modalEl = document.getElementById('pagamentoModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    formaPagamentoSelecionada = null;
    vendaPrazoInfo = null;

    $('.payment-method-btn').off('click').on('click', function() {
        selecionarPagamento($(this).data('pagamento'));
    });

    $('#confirmar-pagamento').off('click').on('click', function() {
        confirmarPagamento(modalEl, onConfirm);
    });

    $('#valor-recebido').off('input').on('input', calcularTroco);

    const formaPagamentoAtual = $('#formaPagamentoPdv').val();
    if (formaPagamentoAtual === 'dinheiro') {
        setTimeout(() => selecionarPagamento('dinheiro'), 0);
    }
}

function selecionarPagamento(tipo) {
    formaPagamentoSelecionada = tipo;

    $('.payment-method-btn').removeClass('active btn-primary').addClass('btn-outline-primary');
    $(`.payment-method-btn[data-pagamento="${tipo}"]`).removeClass('btn-outline-primary').addClass('active btn-primary');

    if (tipo === 'dinheiro') {
        $('#troco-area').show();
        $('#prazo-area').hide();
        $('#valor-recebido').val('');
        calcularTroco();
        // Foco automático no campo de valor recebido após pequeno delay
        setTimeout(() => {
            const valorInput = $('#valor-recebido');
            if (valorInput.length) {
                valorInput.trigger('focus');
                valorInput.off('keypress').on('keypress', function(e) {
                    if (e.which === 13) { // Enter
                        e.preventDefault();
                        document.getElementById('confirmar-pagamento').click();
                    }
                });
            }
        }, 100);
    } else if (tipo === 'prazo') {
        $('#troco-area').hide();
        $('#prazo-area').show();

        const hoje = new Date();
        const primeiroVencimento = new Date(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());
        $('#primeiro-vencimento-prazo').val(primeiroVencimento.toISOString().split('T')[0]);

        $('#cliente-prazo-busca').off('input').on('input', function() {
            const termo = normalizarTexto($(this).val()).trim();
            if (termo.length < 2) {
                $('#cliente-prazo-sugestoes').empty().hide();
                $('#cliente-prazo-id').val('');
                return;
            }

            $.ajax({
                url: `${API_URL}/clientes`,
                method: 'GET',
                success: function(clientes) {
                    const filtrados = (clientes || []).filter(c =>
                        normalizarTexto(c.nome).includes(termo) ||
                        String(c.cpf_cnpj || '').replace(/\D/g, '').includes(termo.replace(/\D/g, ''))
                    );

                    if (filtrados.length === 0) {
                        $('#cliente-prazo-sugestoes').html('<div class="list-group-item">Nenhum cliente encontrado</div>').show();
                        return;
                    }

                    $('#cliente-prazo-sugestoes').html(
                        filtrados.map(c => `
                            <button type="button" class="list-group-item list-group-item-action" data-id="${c.id}" data-nome="${escapeHtml(c.nome || '')}">
                                ${escapeHtml(c.nome || '')}${c.cpf_cnpj ? ' - ' + formatarCpfCnpj(c.cpf_cnpj) : ''}
                            </button>
                        `).join('')
                    ).show();
                },
                error: function() {
                    $('#cliente-prazo-sugestoes').empty().hide();
                }
            });
        });

        $(document).off('click.sugestaoCliente').on('click.sugestaoCliente', '#cliente-prazo-sugestoes button', function() {
            $('#cliente-prazo-id').val($(this).data('id'));
            $('#cliente-prazo-busca').val($(this).data('nome'));
            $('#cliente-prazo-sugestoes').empty().hide();
        });
    } else {
        $('#troco-area').hide();
        $('#prazo-area').hide();
    }
}

function calcularTroco() {
    const total = calcularTotalValor();
    const recebido = parseFloat($('#valor-recebido').val()) || 0;
    const troco = Math.max(0, recebido - total);
    $('#troco').text(formatCurrency(troco));
}

function confirmarPagamento(modalEl, onConfirm) {
    if (!formaPagamentoSelecionada) {
        showNotification('Selecione uma forma de pagamento.', 'warning');
        return;
    }

    if (formaPagamentoSelecionada === 'dinheiro') {
        const recebido = parseFloat($('#valor-recebido').val()) || 0;
        const total = calcularTotalValor();
        if (recebido < total) {
            showNotification('Valor recebido insuficiente.', 'danger');
            return;
        }
    }

    if (formaPagamentoSelecionada === 'prazo') {
        const clienteId = parseInt($('#cliente-prazo-id').val(), 10);
        const parcelas = parseInt($('#parcelas-prazo').val(), 10) || 1;
        const primeiroVencimento = $('#primeiro-vencimento-prazo').val();

        if (!clienteId) {
            showNotification('Selecione o cliente da venda a prazo.', 'danger');
            return;
        }
        if (parcelas < 1) {
            showNotification('Quantidade de parcelas inválida.', 'danger');
            return;
        }
        if (!primeiroVencimento) {
            showNotification('Informe o primeiro vencimento.', 'danger');
            return;
        }

        vendaPrazoInfo = {
            cliente_id: clienteId,
            parcelas,
            primeiro_vencimento: primeiroVencimento,
            cliente_nome: $('#cliente-prazo-busca').val().trim()
        };
    } else {
        vendaPrazoInfo = null;
    }

    const instancia = bootstrap.Modal.getInstance(modalEl);
    if (document.activeElement) {
        document.activeElement.blur();
    }
    if (instancia) instancia.hide();

    if (typeof onConfirm === 'function') {
        onConfirm();
    } else {
        executarFinalizacaoVenda();
    }
}

function abrirModalDecisaoFiscal(skipPagamento = false) {
    if (vendaEmProcessamento) {
        showNotification('A venda já está sendo processada.', 'warning');
        return;
    }

    // Verificar se caixa está aberto
    if (!caixaAberto) {
        showNotification('🔴 Caixa fechado. Abra o caixa antes de vender.', 'danger');
        return;
    }

    if (!Array.isArray(carrinho) || carrinho.length === 0) {
        showNotification('Adicione itens ao carrinho antes de finalizar.', 'warning');
        return;
    }

    const formaPagamento = $('#formaPagamentoPdv').val();

    if (!formaPagamento) {
        showNotification('Selecione uma forma de pagamento.', 'warning');
        return;
    }

    const desconto = parseFloat($('#descontoPdv').val()) || 0;
    const subtotal = calcularSubtotal();
    const total = Math.round((Math.max(0, subtotal - desconto)) * 100) / 100;

    if (total <= 0) {
        showNotification('O total final da venda é inválido.', 'warning');
        return;
    }

    if (formaPagamento === 'dinheiro') {
        const recebido = parseFloat($('#valorRecebidoPDV').val()) || 0;

        if (recebido <= 0) {
            showNotification('Informe o valor recebido em dinheiro.', 'warning');
            $('#valorRecebidoPDV').trigger('focus');
            return;
        }

        if (recebido < total) {
            showNotification('O valor recebido é menor que o total da venda.', 'danger');
            $('#valorRecebidoPDV').trigger('focus');
            return;
        }
    }

    if (formaPagamento === 'prazo') {
        const clienteIdPrazo = clienteSelecionado?.id || Number($('#clientePrazoId').val()) || null;
        if (!clienteIdPrazo) {
            showNotification('Para venda a prazo, selecione um cliente.', 'warning');
            $('#clienteBuscaPrazo').trigger('focus');
            return;
        }
        const parcelas = Number($('#parcelasPrazo').val()) || 1;
        if (parcelas < 1) {
            showNotification('A quantidade de parcelas deve ser no mínimo 1.', 'warning');
            $('#parcelasPrazo').trigger('focus');
            return;
        }
        const dataVenc = $('#dataVencimentoPrazo').val();
        if (!dataVenc) {
            showNotification('Informe a data do primeiro vencimento.', 'warning');
            $('#dataVencimentoPrazo').trigger('focus');
            return;
        }
    }

    const clienteId = clienteSelecionado?.id || vendaPrazoInfo?.cliente_id || Number($('#clientePrazoId').val()) || null;

    formaPagamentoSelecionadaPDV = formaPagamentoSelecionadaPDV || formaPagamento;
    prosseguirFinalizacaoConformeModoFiscal(formaPagamento);
}

/**
 * F12 ativo → venda fiscal (CPF/NFC-e). F12 desativado → venda não fiscal direta.
 * Sem modal de escolha manual.
 */
function prosseguirFinalizacaoConformeModoFiscal(formaPagamentoOverride) {
    const forma = formaPagamentoOverride || formaPagamentoSelecionadaPDV;

    if (typeof implantacaoPermiteFiscal === 'function' && !implantacaoPermiteFiscal()) {
        pdvEmitirFiscalNaVenda = false;
        executarFinalizacaoVenda(false, null, forma);
        return;
    }

    if (pdvModoFiscalAtivo()) {
        pdvEmitirFiscalNaVenda = true;
        mostrarModalCpfCnpjNota();
        return;
    }

    pdvEmitirFiscalNaVenda = false;
    executarFinalizacaoVenda(false, null, forma);
}

function mostrarModalDecisaoFiscal() {
    prosseguirFinalizacaoConformeModoFiscal();
}

window.prosseguirFinalizacaoConformeModoFiscal = prosseguirFinalizacaoConformeModoFiscal;
window.mostrarModalDecisaoFiscal = mostrarModalDecisaoFiscal;

function limparCpfCnpj(valor) {
    return String(valor || '').replace(/\D/g, '');
}

function validarCpfCnpjNota(valor) {
    const doc = limparCpfCnpj(valor);

    if (!doc) return true;

    return doc.length === 11 || doc.length === 14;
}

function abrirPagamentoMisto() {
    const totalVenda = obterTotalVendaPDV();

    function moeda(v) {
        return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
    }

    const opcoes = {
        dinheiro_pix: [
            { id: 'pgDinheiro', label: 'Dinheiro', forma: 'dinheiro' },
            { id: 'pgPix', label: 'Pix', forma: 'pix' }
        ],
        dinheiro_debito: [
            { id: 'pgDinheiro', label: 'Dinheiro', forma: 'dinheiro' },
            { id: 'pgDebito', label: 'Cartão de Débito', forma: 'cartao_debito' }
        ],
        dinheiro_credito: [
            { id: 'pgDinheiro', label: 'Dinheiro', forma: 'dinheiro' },
            { id: 'pgCredito', label: 'Cartão de Crédito', forma: 'cartao_credito' }
        ]
    };

    $('#modal-container').html(`
        <div class="modal fade" id="pagamentoMistoModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered modal-lg">
                <div class="modal-content border-0 shadow-lg" style="border-radius: 16px; overflow: hidden;">
                    <div class="modal-header text-white" style="background:#0d6efd;">
                        <div>
                            <h4 class="modal-title mb-0">Pagamento Misto</h4>
                            <small>Escolha a combinação e informe os valores</small>
                        </div>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body p-4" style="background:#f5f7fb;">
                        <div class="row g-3 mb-4">
                            <div class="col-md-4">
                                <div class="p-3 bg-white rounded shadow-sm">
                                    <small class="text-muted">TOTAL DA VENDA</small>
                                    <h3 class="mb-0 text-primary">${moeda(totalVenda)}</h3>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="p-3 bg-white rounded shadow-sm">
                                    <small class="text-muted">VALOR INFORMADO</small>
                                    <h3 class="mb-0 text-success" id="totalInformado">${moeda(0)}</h3>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="p-3 bg-white rounded shadow-sm">
                                    <small class="text-muted">VALOR RESTANTE</small>
                                    <h3 class="mb-0 text-danger" id="totalFalta">${moeda(totalVenda)}</h3>
                                </div>
                            </div>
                        </div>

                        <div class="bg-white rounded shadow-sm p-3 mb-3">
                            <label class="fw-bold mb-2">Tipo de pagamento misto</label>
                            <select id="tipoPagamentoMisto" class="form-select form-select-lg">
                                <option value="">-- Selecione a combinação --</option>
                                <option value="dinheiro_pix">Dinheiro + Pix</option>
                                <option value="dinheiro_debito">Dinheiro + Cartão de Débito</option>
                                <option value="dinheiro_credito">Dinheiro + Cartão de Crédito</option>
                            </select>
                        </div>

                        <div id="camposPagamentoMisto"></div>

                        <div id="alertaPagamentoMisto" class="alert alert-warning d-none mt-3 mb-0">
                            A soma dos pagamentos precisa ser igual ao total da venda.
                        </div>
                    </div>

                    <div class="modal-footer bg-white p-3">
                        <button type="button" class="btn btn-outline-secondary btn-lg" data-bs-dismiss="modal">
                            Cancelar
                        </button>

                        <button class="btn btn-success btn-lg px-5" id="btnConfirmarPagamentoMisto" disabled>
                            Confirmar Pagamento
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modal = new bootstrap.Modal(document.getElementById('pagamentoMistoModal'));
    modal.show();

    function renderizarCampos(tipo) {
        const campos = opcoes[tipo];

        $('#camposPagamentoMisto').html(campos.map(campo => `
            <div class="bg-white rounded shadow-sm p-3 mb-3">
                <label class="fw-bold mb-2">${campo.label}</label>
                <div class="input-group input-group-lg">
                    <span class="input-group-text">R$</span>
                    <input
                        type="number"
                        step="0.01"
                        min="0"
                        id="${campo.id}"
                        data-forma="${campo.forma}"
                        class="form-control pagamento-misto-input"
                        placeholder="0"
                    >
                </div>
            </div>
        `).join(''));

        $('.pagamento-misto-input').on('input', atualizarTotais);

        const $inputs = $('.pagamento-misto-input');
        // Completa o 2º campo só no blur e só se estiver vazio —
        // nunca sobrescreve enquanto o operador digita (Hotfix pagamento misto).
        if ($inputs.length >= 2) {
            $inputs.first().on('blur', function () {
                const valPrimeiro = Number($(this).val() || 0);
                const $segundo = $inputs.eq(1);
                const valSegundo = Number($segundo.val() || 0);

                if (valPrimeiro > 0 && valSegundo === 0) {
                    const restante = Math.round((totalVenda - valPrimeiro) * 100) / 100;
                    if (restante > 0) {
                        $segundo.val(restante.toFixed(2));
                        atualizarTotais();
                    }
                }
            });
        }

        $('.pagamento-misto-input').first().trigger('focus');
        atualizarTotais();
    }

    function atualizarTotais() {
        let informado = 0;

        $('.pagamento-misto-input').each(function () {
            informado += Number($(this).val() || 0);
        });

        const falta = totalVenda - informado;
        const correto = Math.abs(falta) <= 0.01;

        $('#totalInformado').text(moeda(informado));
        $('#totalFalta').text(moeda(falta));

        $('#btnConfirmarPagamentoMisto').prop('disabled', !correto);

        if (correto) {
            $('#alertaPagamentoMisto').addClass('d-none');
            $('#totalFalta').removeClass('text-danger').addClass('text-success');
        } else {
            $('#alertaPagamentoMisto').removeClass('d-none');
            $('#totalFalta').removeClass('text-success').addClass('text-danger');
        }
    }

    $('#tipoPagamentoMisto').on('change', function () {
        const tipo = $(this).val();
        pagamentosMistos = [];

        if (tipo && opcoes[tipo]) {
            renderizarCampos(tipo);
        } else {
            $('#camposPagamentoMisto').empty();
            $('#btnConfirmarPagamentoMisto').prop('disabled', true);
        }
    });

    $('#btnConfirmarPagamentoMisto').on('click', function () {
        const tipoMisto = $('#tipoPagamentoMisto').val();

        if (tipoMisto === 'dinheiro_pix') {
            const $dinheiro = $('#pgDinheiro');
            const $pix = $('#pgPix');
            const valDinheiro = Number($dinheiro.val() || 0);
            const valPixAtual = Number($pix.val() || 0);
            const restante = Math.round((totalVenda - valDinheiro) * 100) / 100;

            if (valDinheiro > 0 && valPixAtual === 0 && restante > 0) {
                $pix.val(restante.toFixed(2));
            }
        }

        pagamentosMistos = [];

        $('.pagamento-misto-input').each(function () {
            const valor = Number($(this).val() || 0);
            const forma = $(this).data('forma');

            if (valor > 0) {
                pagamentosMistos.push({
                    forma_pagamento: forma,
                    valor
                });
            }
        });

        formaPagamentoSelecionadaPDV = 'misto';

        const pagamentoPix = pagamentosMistos.find(p => p.forma_pagamento === 'pix');
        const valorPix = pagamentoPix ? Number(pagamentoPix.valor) : 0;

        if (document.activeElement) {
            document.activeElement.blur();
        }

        modal.hide();

        if (tipoMisto === 'dinheiro_pix' && valorPix > 0) {
            setTimeout(async () => {
                const tefOn = await obterTefHabilitadoConfig();
                if (tefOn) {
                    mostrarModalDecisaoFiscal();
                    return;
                }

                const ativo = await pixAutomaticoHabilitado();
                if (ativo) {
                    iniciarPixAutomaticoPDV(valorPix, {
                        modoMisto: true,
                        onPago: () => {
                            setTimeout(() => mostrarModalDecisaoFiscal(), 300);
                        }
                    });
                } else {
                    mostrarModalDecisaoFiscal();
                }
            }, 300);
            return;
        }

        setTimeout(() => {
            mostrarModalDecisaoFiscal();
        }, 300);
    });
}

function mostrarModalCpfCnpjNota() {
    if (!pdvModoFiscalAtivo()) {
        prosseguirFinalizacaoConformeModoFiscal();
        return;
    }

    pdvEmitirFiscalNaVenda = true;

    $('#modal-container').html(`
        <div class="modal fade" id="cpfCnpjNotaModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content border-0 shadow">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title mb-0">CPF/CNPJ na Nota</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body">
                        <label class="form-label">Informe CPF ou CNPJ do cliente</label>
                        <input
                            type="text"
                            id="cpfCnpjNotaFiscal"
                            class="form-control"
                            placeholder="Opcional"
                            maxlength="18"
                            autocomplete="off"
                        >

                        <small class="text-muted d-block mt-2">
                            Deixe em branco para emitir como consumidor não identificado.
                        </small>

                        <div class="d-grid gap-2 mt-3">
                            <button type="button" class="btn btn-success" id="btnConfirmarCpfNota">
                                Finalizar Venda
                            </button>

                            <button type="button" class="btn btn-secondary" id="btnEmitirSemCpf">
                                Finalizar sem CPF/CNPJ
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('cpfCnpjNotaModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    $('#cpfCnpjNotaFiscal').trigger('focus');

    $('#cpfCnpjNotaFiscal').on('input', function () {
        let v = limparCpfCnpj(this.value);

        if (v.length <= 11) {
            v = v.replace(/(\d{3})(\d)/, '$1.$2');
            v = v.replace(/(\d{3})(\d)/, '$1.$2');
            v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
        } else {
            v = v.replace(/^(\d{2})(\d)/, '$1.$2');
            v = v.replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3');
            v = v.replace(/\.(\d{3})(\d)/, '.$1/$2');
            v = v.replace(/(\d{4})(\d)/, '$1-$2');
        }

        this.value = v;
    });

    $('#btnConfirmarCpfNota').off('click').on('click', function () {
        const cpfCnpj = $('#cpfCnpjNotaFiscal').val();

        if (cpfCnpj && !validarCpfCnpjNota(cpfCnpj)) {
            showNotification('CPF/CNPJ inválido. Informe 11 ou 14 números.', 'warning');
            $('#cpfCnpjNotaFiscal').trigger('focus');
            return;
        }

        if (document.activeElement) {
            document.activeElement.blur();
        }

        modal.hide();

        setTimeout(() => {
            const emitirFiscal = pdvEmitirFiscalNaVenda === true;
            executarFinalizacaoVenda(emitirFiscal, limparCpfCnpj(cpfCnpj), formaPagamentoSelecionadaPDV);
        }, 300);
    });

    $('#btnEmitirSemCpf').off('click').on('click', function () {
        if (document.activeElement) {
            document.activeElement.blur();
        }

        modal.hide();

        setTimeout(() => {
            const emitirFiscal = pdvEmitirFiscalNaVenda === true;
            executarFinalizacaoVenda(emitirFiscal, null, formaPagamentoSelecionadaPDV);
        }, 300);
    });
}

function mostrarModalAvisoDebitoCliente(aviso, totalEmAberto, parcelasVencidas, onConfirm, onCancel) {
    const detalhes = [];
    if (totalEmAberto > 0) {
        detalhes.push(`Valor em aberto: <strong>${formatCurrency(totalEmAberto)}</strong>`);
    }
    if (parcelasVencidas > 0) {
        detalhes.push(`Parcelas vencidas: <strong>${parcelasVencidas}</strong>`);
    }

    $('#modal-container').html(`
        <div class="modal fade" id="debitoAvisoModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content border-0 shadow">
                    <div class="modal-header bg-warning">
                        <h5 class="modal-title text-dark mb-0">Aviso de Débito</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                    </div>
                    <div class="modal-body text-center">
                        <p class="mb-3">${escapeHtml(aviso)}</p>
                        <p class="mb-3">${detalhes.join('<br>')}</p>
                        <div class="d-grid gap-2">
                            <button type="button" class="btn btn-danger" id="confirmar-continuar-debito">Continuar mesmo assim</button>
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('debitoAvisoModal');
    const modal = new bootstrap.Modal(modalEl);
    let confirmado = false;
    modal.show();

    $('#confirmar-continuar-debito').off('click').on('click', function() {
        if (document.activeElement) {
            document.activeElement.blur();
        }

        confirmado = true;
        modal.hide();
        if (typeof onConfirm === 'function') {
            onConfirm();
        }
    });

    $(modalEl).off('hidden.bs.modal.avisoDebito').on('hidden.bs.modal.avisoDebito', function() {
        if (!confirmado && typeof onCancel === 'function') {
            onCancel();
        }
    });
}

async function executarFinalizacaoVenda(emitirFiscal = false, cpfCnpjNota = null, formaPagamentoDireta = null) {
    if (vendaEmProcessamento) {
        showNotification('A venda já está sendo processada.', 'warning');
        return;
    }

    if (vendaTemDescontoManualPdv()
        && !operadorPodeAplicarDescontoSemSenha()
        && !supervisorAuthToken) {
        return new Promise((resolve) => {
            garantirAutorizacaoDesconto(
                () => {
                    executarFinalizacaoVenda(emitirFiscal, cpfCnpjNota, formaPagamentoDireta)
                        .then(resolve)
                        .catch(resolve);
                },
                () => {
                    showNotification('Desconto exige autorização de administrador ou supervisor.', 'warning');
                    resolve();
                }
            );
        });
    }

    if (!Array.isArray(carrinho) || carrinho.length === 0) {
        showNotification('Adicione itens ao carrinho antes de finalizar.', 'warning');
        return;
    }

    const formaPagamento = formaPagamentoDireta || formaPagamentoSelecionadaPDV || $('#formaPagamentoPdv').val();

    console.log('FORMA PAGAMENTO DETECTADA:', formaPagamento);
    console.log('PAGAMENTOS MISTOS:', pagamentosMistos);

    if (!formaPagamento) {
        showNotification('Informe a forma de pagamento.', 'warning');
        return;
    }

    const clienteId = clienteSelecionado?.id || vendaPrazoInfo?.cliente_id || Number($('#clientePrazoId').val()) || null;
    if (formaPagamento === 'prazo' && !clienteId) {
        showNotification('Para venda a prazo, selecione um cliente.', 'warning');
        $('#clienteBuscaPrazo').trigger('focus');
        return;
    }

    if (formaPagamento === 'prazo') {
        const parcelas = Number($('#parcelasPrazo').val()) || vendaPrazoInfo?.parcelas || 1;
        const dataVenc = $('#dataVencimentoPrazo').val() || vendaPrazoInfo?.primeiro_vencimento;
        if (!dataVenc) {
            showNotification('Informe a data do primeiro vencimento.', 'warning');
            $('#dataVencimentoPrazo').trigger('focus');
            return;
        }
        if (parcelas < 1) {
            showNotification('A quantidade de parcelas deve ser no mínimo 1.', 'warning');
            $('#parcelasPrazo').trigger('focus');
            return;
        }
    }

    const desconto = parseFloat($('#descontoPdv').val()) || 0;
    const acrescimo = parseFloat($('#acrescimoPdv').val()) || 0;
    const subtotal = calcularSubtotal();
    const total = Math.round((Math.max(0, subtotal - desconto + acrescimo)) * 100) / 100;

    if (total <= 0) {
        showNotification('O total final da venda é inválido.', 'warning');
        return;
    }

    const dados = {
        cliente_id: clienteId,
        cliente_nome: clienteSelecionado?.nome || vendaPrazoInfo?.cliente_nome || null,
        forma_pagamento: pagamentosMistos.length > 1 ? "misto" : formaPagamento,
        desconto,
        acrescimo,
        total,
        emitir_fiscal: false,
        cpf_cnpj_nota: null,
        // Pagamento único (PIX/dinheiro/cartão) cobre F+NF — MIDP separa
        // MIDP separa F/NF a partir do pagamento comercial integral
        pagamentos: pagamentosMistos.length > 0 ? pagamentosMistos : [
            {
                forma_pagamento: formaPagamento,
                valor: total
            }
        ],
        itens: carrinho.map(item => {
            const produto = produtosDisponiveis.find(p => Number(p.id) === Number(item.id));
            const tipoVenda = normalizarTipoVendaItem(item);
            const quantidade = tipoVendaEhUnidade(tipoVenda)
                ? Math.max(0, Math.round(Number(item.quantidade || 0)))
                : normalizarQuantidadePdv(item.quantidade, produto);
            const subtotalFiscal = motorPrecoAtacadoDisponivel()
                ? Number(item.subtotal_exibicao ?? MotorPrecoAtacado.arredondarMoeda(Number(item.subtotal || 0)))
                : Math.round(Number(item.preco_unitario) * Number(quantidade) * 100) / 100;
            const itemPayload = {
            produto_id: Number(item.id),
            quantidade,
            preco_unitario: motorPrecoAtacadoDisponivel()
                ? MotorPrecoAtacado.formatarPrecoExibicao(Number(item.preco_unitario))
                : Number(item.preco_unitario),
            preco_unitario_interno: motorPrecoAtacadoDisponivel()
                ? Number(item.preco_unitario)
                : null,
            desconto_percentual: Number(item.desconto_percentual || 0),
            desconto_valor: Number(item.desconto_valor != null
                ? item.desconto_valor
                : obterDescontoValorItemPdv(item, produto)),
            desconto_manual: Number(item.desconto_manual || 0) === 1 ? 1 : 0,
            promocao_id: item.promocao_id || null,
            desconto_atacado: Number(item.desconto_atacado || 0),
            tipo_preco: item.tipo_preco || 'varejo',
            subtotal: subtotalFiscal,
            item_fiscal: Number(item.item_fiscal || 0),
            tipo_venda: tipoVenda,
            transferencia_nao_fiscal_para_fiscal: Number(item.transferencia_nao_fiscal_para_fiscal || 0)
        };
            if (tipoVendaEhUnidade(tipoVenda) && produto) {
                itemPayload.quantidade_estoque = obterQuantidadeEstoqueParaVenda(produto, quantidade, TIPO_VENDA_UNIDADE);
            }
            return itemPayload;
        }),
        supervisor_token: supervisorAuthToken || null
    };

    if (formaPagamento === 'dinheiro' || (Array.isArray(pagamentosMistos)
        && pagamentosMistos.some((p) => String(p.forma_pagamento || '').toLowerCase() === 'dinheiro'))) {
        const { valor_recebido, troco } = registrarValorRecebidoDinheiroPdv(
            obterValorRecebidoDinheiroPdv(),
            total
        );
        if (valor_recebido > 0) {
            dados.valor_recebido = valor_recebido;
            dados.troco = troco;
        }
    }

    if (formaPagamento === 'prazo') {
        const dataRecebimento = $('#dataVencimentoPrazo').val() || vendaPrazoInfo?.primeiro_vencimento;
        const qtdParcelas = Number($('#parcelasPrazo').val()) || vendaPrazoInfo?.parcelas || 1;
        dados.parcelas = qtdParcelas;
        dados.primeiro_vencimento = dataRecebimento;
    }

    const distribuicao = await precalcularDistribuicaoFiscalVenda(
        dados.itens,
        emitirFiscal,
        dados.pagamentos,
        desconto,
        acrescimo
    );

    if (!distribuicao.sucesso) {
        showNotification(distribuicao.error || 'Erro ao calcular distribuição fiscal.', 'danger');
        return;
    }

    // RC7.10.1: backend já devolve valor fiscal líquido; rateio local só no fallback.
    let totalFiscal;
    let totalNaoFiscal;
    if (distribuicao.liquido_aplicado_backend) {
        totalFiscal = Number(distribuicao.valor_fiscal || 0);
        totalNaoFiscal = Number(distribuicao.valor_nao_fiscal || 0);
    } else {
        const valoresDistribuidos = aplicarDescontoProporcionalDistribuicao(
            distribuicao,
            subtotal,
            desconto,
            acrescimo
        );
        totalFiscal = Number(valoresDistribuidos.valor_fiscal || 0);
        totalNaoFiscal = Number(valoresDistribuidos.valor_nao_fiscal || 0);
    }

    vendaEmProcessamento = true;

    dados.valor_fiscal = totalFiscal;
    dados.valor_nao_fiscal = totalNaoFiscal;
    dados.fluxo_venda = emitirFiscal === true ? 'fiscal' : 'nao_fiscal';

    const deveEmitirFiscal = emitirFiscal && totalFiscal > 0;
    dados.emitir_fiscal = deveEmitirFiscal;
    dados.cpf_cnpj_nota = deveEmitirFiscal ? cpfCnpjNota : null;

    if (emitirFiscal && totalFiscal === 0 && totalNaoFiscal > 0) {
        showNotification('Venda sem itens fiscais. NFC-e não será emitida.', 'info');
    }

    const ehPagamentoMisto =
        Array.isArray(pagamentosMistos) &&
        pagamentosMistos.length > 0;

    const formaPagamentoNormalizada = normalizarFormaPagamentoTEF(formaPagamento);

    console.log('DISTRIBUICAO FISCAL PDV:', {
        totalFiscal,
        totalNaoFiscal,
        total,
        itens: distribuicao.itens
    });

    console.log('VERIFICANDO TEF:', {
        formaPagamento,
        formaPagamentoNormalizada,
        ehPagamentoMisto,
        pagamentosMistos
    });

    try {
        const modoConfirmacaoFiscal = await obterModoConfirmacaoFiscal();
        const tefHabilitado = await obterTefHabilitadoConfig();

        const fluxoAB = decidirFluxoRecebimentosAB(totalFiscal, totalNaoFiscal, {
            fluxoVendaFiscal: emitirFiscal === true,
            totalComercial: total
        });

        const fluxoResolvido = TefFluxoPagamento.resolverFluxoPagamentoFiscal({
            modoConfirmacaoFiscal,
            tefHabilitado,
            formaPagamento: formaPagamentoNormalizada,
            ehPagamentoMisto,
            pagamentosMistos,
            totalFiscal: fluxoAB.abrirA ? fluxoAB.valorA : 0
        });

        const {
            deveUsarTefAutomatico,
            usarConfirmacaoManual,
            pagamentoExigeTef
        } = fluxoResolvido;

        console.log('FLUXO PAGAMENTO FISCAL:', {
            modoConfirmacaoFiscal,
            tefHabilitado,
            pagamentoExigeTef,
            deveUsarTefAutomatico,
            usarConfirmacaoManual,
            fluxoAB
        });

        if (deveUsarTefAutomatico && ehPagamentoMisto) {
            dados.pagamentos = await processarPagamentosMistosTEF(pagamentosMistos);
            dados.forma_pagamento = 'misto';
        }

        if (fluxoAB.abrirA) {
            if (deveUsarTefAutomatico && !ehPagamentoMisto) {
                const resultadoProcessamento = await processarVendaFiscalNaoFiscal(dados, fluxoAB.valorA);

                if (!resultadoProcessamento.sucesso) {
                    vendaEmProcessamento = false;
                    showNotification(resultadoProcessamento.erro || 'Erro no Recebimento A.', 'danger');
                    return;
                }

                const formaFiscal = obterFormaPagamentoFiscal();
                const tefFiscal = resultadoProcessamento.tefFiscal;
                dados.tef = montarObjetoTEF(tefFiscal);

                if (fluxoAB.abrirB) {
                    dados.pagamentos = anexarTefAoPrimeiroPagamento(dados.pagamentos, tefFiscal);
                } else {
                    dados.pagamentos = [
                        {
                            forma_pagamento: formaPagamentoGravacaoFiscalPDV(formaFiscal),
                            valor: fluxoAB.valorA,
                            tipo_recebimento: 'fiscal',
                            tef_transacao_id: tefFiscal.transacao_id,
                            nsu: tefFiscal.nsu,
                            autorizacao: tefFiscal.autorizacao
                        }
                    ];
                    if (deveEnviarPagamentosProcessadosPdv(totalFiscal, totalNaoFiscal)) {
                        dados.pagamentos_processados_pdv = true;
                    }
                }
            } else {
                const resultadoManual = await processarVendaFiscalManual(dados, fluxoAB.valorA);

                if (!resultadoManual.sucesso) {
                    vendaEmProcessamento = false;
                    showNotification(resultadoManual.erro || 'Recebimento A cancelado.', 'danger');
                    return;
                }

                dados.confirmacao_fiscal_manual = true;
                if (ehPagamentoMisto) {
                    dados.pagamentos = normalizarPagamentosSemTef(pagamentosMistos);
                    dados.forma_pagamento = 'misto';
                } else if (fluxoAB.abrirB) {
                    dados.pagamentos = normalizarPagamentosSemTef(dados.pagamentos);
                } else {
                    dados.pagamentos = [
                        {
                            forma_pagamento: formaPagamentoNormalizada,
                            valor: fluxoAB.valorA,
                            tipo_recebimento: 'fiscal'
                        }
                    ];
                    if (deveEnviarPagamentosProcessadosPdv(totalFiscal, totalNaoFiscal)) {
                        dados.pagamentos_processados_pdv = true;
                    }
                }
            }
        }

        if (fluxoAB.abrirB) {
            await confirmarRecebimentoB(fluxoAB.valorB);
            if (!fluxoAB.abrirA) {
                dados.pagamentos = normalizarPagamentosSemTef(
                    ehPagamentoMisto ? pagamentosMistos : dados.pagamentos
                );
            }
        }
    } catch (error) {
        vendaEmProcessamento = false;
        console.error('Erro no TEF misto:', error);
        showNotification(error.message || 'Venda cancelada: falha no TEF.', 'danger');
        return;
    }

    const itensParaCupom = dados.itens.map(item => {
        const produto = produtosDisponiveis.find(p => Number(p.id) === Number(item.produto_id));
        return {
            ...item,
            produto_nome: produto ? produto.nome : 'Produto',
            tipo_venda: normalizarTipoVendaItem(item)
        };
    });

    function enviarVenda(payload) {
        payload = getTerminalRequestData(payload);
        let handoffNaoFiscal = false;
        let posVendaEncerrada = false;

        function encerrarPosVendaUmaVez() {
            if (posVendaEncerrada) return;
            posVendaEncerrada = true;
            finalizarPosVenda();
        }

        $.ajax({
            url: `${API_URL}/vendas`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(payload),
            timeout: 120000,
            success: function(response) {
                try {
                    if (!response || typeof response !== 'object') {
                        vendaEmProcessamento = false;
                        showNotification('Resposta inválida ao finalizar a venda.', 'danger');
                        return;
                    }

                    const vendaId = response.venda_id || response.id || response.vendaId || response.venda?.id;
                    const statusPagamento = response.status_pagamento;
                    const vendaQuitada = pdvVendaRespostaQuitada(response);

                    if (!vendaId) {
                        vendaEmProcessamento = false;
                        console.error('Resposta da venda sem ID:', response);
                        showNotification('Venda finalizada, mas não foi possível localizar o ID da venda.', 'danger');
                        return;
                    }

                    if (statusPagamento === 'aguardando_nao_fiscal' && !vendaQuitada) {
                        // 2ª etapa legítima: fiscal confirmado, não fiscal ainda pendente
                        if (Number(dados.valor_fiscal || 0) > 0) {
                            handoffNaoFiscal = true;
                            iniciarFluxoPosVendaComNaoFiscal(vendaId, {
                                emitirFiscal: Boolean(dados.emitir_fiscal)
                            });
                            return;
                        }

                        vendaEmProcessamento = false;
                        pagamentoFiscalAtual = null;
                        imprimirCupomNaoFiscal(vendaId, {
                            ...payload,
                            itens: itensParaCupom
                        }, total, desconto, { automatico: true });
                        encerrarPosVendaUmaVez();
                        showNotification('Venda não fiscal finalizada com sucesso.', 'success');
                        return;
                    }

                    // status quitada (ou outro): NÃO abre modal de não fiscal
                    // Parte não fiscal (valor_nao_fiscal > 0) NÃO mantém o PDV aberto se já quitou.
                    vendaEmProcessamento = false;
                    pagamentoFiscalAtual = null;

                    const vendaQuitadaCompletamente = !vendaPrazoInfo && vendaQuitada;

                    if (vendaQuitadaCompletamente && dados.emitir_fiscal) {
                        processarFiscalPosPagamentoPosVenda(vendaId, response);
                    } else if (vendaQuitadaCompletamente || vendaPrazoInfo) {
                        imprimirCupomNaoFiscal(vendaId, {
                            ...payload,
                            itens: itensParaCupom
                        }, total, desconto, { automatico: true });
                    }

                    encerrarPosVendaUmaVez();
                    showNotification('Venda finalizada com sucesso.', 'success');
                } catch (erroSucesso) {
                    console.error('Erro ao processar resposta da venda:', erroSucesso);
                    if (!handoffNaoFiscal) {
                        vendaEmProcessamento = false;
                    }
                    showNotification(erroSucesso.message || 'Erro ao processar finalização da venda.', 'danger');
                }
            },
            error: function(xhr, textStatus) {
                if (xhr && xhr.status === 409 && xhr.responseJSON?.pode_continuar) {
                    const aviso = xhr.responseJSON.aviso || 'Cliente possui débitos em aberto.';
                    const totalEmAberto = Number(xhr.responseJSON.total_em_aberto || 0);
                    const parcelasVencidas = Number(xhr.responseJSON.parcelas_vencidas || 0);

                    mostrarModalAvisoDebitoCliente(aviso, totalEmAberto, parcelasVencidas, function() {
                        payload.forcar = true;
                        enviarVenda(payload);
                    }, function() {
                        vendaEmProcessamento = false;
                    });
                    return;
                }

                vendaEmProcessamento = false;

                if (textStatus === 'timeout') {
                    showNotification(
                        'Tempo esgotado ao finalizar a venda. Verifique no histórico se a venda foi registrada antes de tentar novamente.',
                        'danger'
                    );
                    return;
                }

                if (textStatus === 'abort') {
                    showNotification('Requisição de finalização cancelada.', 'warning');
                    return;
                }

                if (!xhr || xhr.status === 0) {
                    showNotification('Falha de rede ao finalizar a venda. Tente novamente.', 'danger');
                    return;
                }

                showNotification(xhr.responseJSON?.error || 'Erro ao finalizar a venda.', 'danger');
            }
        });
    }

    enviarVenda(dados);
}

function finalizarPosVenda() {
    carrinho = [];
    formaPagamentoSelecionada = null;
    clienteSelecionado = null;
    vendaPrazoInfo = null;
    pagamentosMistos = [];
    supervisorAuthToken = null;
    pdvEmitirFiscalNaVenda = null;
    valorRecebidoDinheiroPDV = null;
    window.pdvTipoVenda = 'BALCAO';
    $('#descontoPdv').val(0);
    $('#formaPagamentoPdv').val('');
    $('#valorRecebidoPDV').val('');
    $('#trocoPDV').text('R$ 0,00');
    aoAlterarFormaPagamento();
    removerClienteSelecionado();
    atualizarCarrinho();
    focarCampoCodigo({ limpar: true });

    $.ajax({
        url: urlProdutosPdv(),
        method: 'GET',
        cache: false,
        success: function(produtos) {
            definirCatalogoPdv(produtos);
        }
    });

    if (typeof loadVendas === 'function' && typeof currentPage !== 'undefined' && currentPage === 'vendas') {
        loadVendas();
    }
}

async function cancelarVendaAtual() {
    if (carrinho.length === 0) {
        if (window.PdvVendaEntrega && typeof PdvVendaEntrega.estaConfigurada === 'function'
            && PdvVendaEntrega.estaConfigurada()
            && typeof PdvVendaEntrega.limparEstadoEntregaUi === 'function') {
            PdvVendaEntrega.limparEstadoEntregaUi();
            showNotification('Estado de entrega limpo.', 'info');
            focarCampoCodigo({ limpar: true });
            return;
        }
        showNotification('Não há venda em andamento para cancelar.', 'info');
        focarCampoCodigo({ limpar: true });
        return;
    }

    if (!window.confirm('Tem certeza que deseja cancelar esta venda?')) return;

    // Cancelar pagamento fiscal se existir
    if (pagamentoFiscalAtual && pagamentoFiscalAtual.transacao_id) {
        try {
            await fetch(`${API_URL}/tef/cancelar`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${localStorage.getItem('token') || ''}`
                },
                body: JSON.stringify({
                    transacao_id: pagamentoFiscalAtual.transacao_id,
                    motivo: 'Cancelamento operador'
                })
            });
            console.log('Pagamento fiscal cancelado pelo operador');
        } catch (cancelError) {
            console.error('Erro ao cancelar Recebimento A:', cancelError);
        }
        pagamentoFiscalAtual = null;
    }

    carrinho = [];
    formaPagamentoSelecionada = null;
    clienteSelecionado = null;
    vendaPrazoInfo = null;
    $('#descontoPdv').val(0);
    $('#formaPagamentoPdv').val('');
    $('#valorRecebidoPDV').val('');
    $('#trocoPDV').text('R$ 0,00');
    valorRecebidoDinheiroPDV = null;
    aoAlterarFormaPagamento();
    removerClienteSelecionado();
    if (window.PdvVendaEntrega && typeof PdvVendaEntrega.limparEstadoEntregaUi === 'function') {
        PdvVendaEntrega.limparEstadoEntregaUi();
    }
    atualizarCarrinho();
    focarCampoCodigo({ limpar: true });
    showNotification('Venda cancelada.', 'info');
}

function emitirNFCeVenda(vendaId) {
    if (!vendaId) {
        console.error('emitirNFCeVenda chamado sem vendaId');
        limparModaisTravados();
        showNotification('Erro: ID da venda não encontrado para emitir NFC-e.', 'danger');
        return;
    }

    $.ajax({
        url: `${API_URL}/fiscal/emitir/venda/${vendaId}`,
        method: 'POST',
        timeout: 180000,

        success: function(response) {
            console.log('Retorno NFC-e:', response);

            const modalProcessando = document.getElementById('processandoNFCeModal');
            if (modalProcessando) {
                const instancia = bootstrap.Modal.getInstance(modalProcessando);
                if (document.activeElement) {
                    document.activeElement.blur();
                }
                if (instancia) instancia.hide();
                modalProcessando.remove();
            }

            limparModaisTravados();

            if (response?.status === 'sem_itens_fiscais') {
                showNotification(
                    response.message || 'Venda sem itens fiscais. NFC-e não necessária.',
                    'info'
                );
                return;
            }

            if (!fiscalAutorizadaParaImpressao(response)) {
                const mensagem = response?.message || 'NFC-e não autorizada pela SEFAZ.';
                showNotification(mensagem, 'danger');
                mostrarModalErroNFCe(vendaId, mensagem);
                return;
            }

            showNotification('NFC-e autorizada pela SEFAZ!', 'success');
            imprimirDANFEFiscal(vendaId, { automatico: true });
        },

        error: function(xhr) {
            console.error('Erro ao emitir NFC-e:', xhr);

            const modalProcessando = document.getElementById('processandoNFCeModal');
            if (modalProcessando) {
                const instancia = bootstrap.Modal.getInstance(modalProcessando);
                if (document.activeElement) {
                    document.activeElement.blur();
                }
                if (instancia) instancia.hide();
                modalProcessando.remove();
            }

            limparModaisTravados();

            const mensagem =
                xhr.responseJSON?.erro ||
                xhr.responseJSON?.error ||
                xhr.responseJSON?.message ||
                xhr.responseText ||
                'NFC-e não autorizada pela SEFAZ.';

            showNotification(mensagem, 'danger');
            mostrarModalErroNFCe(vendaId, mensagem);
        }
    });
}

function mostrarModalErroNFCe(vendaId, mensagem) {
    $('#modal-container').html(`
        <div class="modal fade" id="erroNFCeModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title">
                            <i class="fas fa-triangle-exclamation me-2"></i>
                            NFC-e não autorizada
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body text-center">
                        <p>
                            A venda <strong>#${vendaId}</strong> foi finalizada, mas a NFC-e não foi autorizada.
                        </p>

                        <div class="alert alert-danger text-start">
                            ${escapeHtml(mensagem)}
                        </div>

                        <div class="d-grid gap-2">
                            <button class="btn btn-warning" onclick="emitirNFCeVenda(${vendaId})">
                                <i class="fas fa-rotate-right me-2"></i>
                                Tentar emitir novamente
                            </button>

                            <button class="btn btn-outline-secondary" onclick="fecharModalErroNFCe()">
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('erroNFCeModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
}

function mostrarModalImpressaoFiscal(vendaId, fiscalResponse = {}) {
    const chaveAcesso =
        fiscalResponse.chave_acesso ||
        fiscalResponse.chaveAcesso ||
        fiscalResponse.chave ||
        '';

    const protocolo =
        fiscalResponse.protocolo ||
        fiscalResponse.nProt ||
        fiscalResponse.numero_protocolo ||
        '';

    $('#modal-container').html(`
        <div class="modal fade" id="impressaoFiscalModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow">
                    <div class="modal-header bg-success text-white">
                        <h5 class="modal-title">
                            <i class="fas fa-check-circle me-2"></i>
                            NFC-e Emitida
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body text-center">
                        <p class="mb-2">
                            A NFC-e da venda <strong>#${vendaId}</strong> foi enviada para a SEFAZ.
                        </p>

                        ${chaveAcesso ? `
                            <p class="small mb-1">
                                <strong>Chave:</strong><br>
                                ${escapeHtml(chaveAcesso)}
                            </p>
                        ` : ''}

                        ${protocolo ? `
                            <p class="small mb-3">
                                <strong>Protocolo:</strong><br>
                                ${escapeHtml(protocolo)}
                            </p>
                        ` : ''}

                        <div class="d-grid gap-2">
                            <button class="btn btn-success btn-lg" onclick="imprimirDANFEFiscal(${vendaId})">
                                <i class="fas fa-print me-2"></i>
                                Imprimir Cupom Fiscal
                            </button>

                            <button class="btn btn-sm btn-secondary" onclick="verResumoVendaFiscalTEF(${vendaId})">
                                Resumo
                            </button>

                            <button class="btn btn-outline-secondary" data-bs-dismiss="modal">
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('impressaoFiscalModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
}

async function mostrarModalProcessandoNFCe(vendaId) {
    // Limpar modais anteriores
    $('#modal-container').empty();
    
    // Remover qualquer backdrop existente
    $('.modal-backdrop').remove();
    $('body').removeClass('modal-open').css('overflow', '').css('padding-right', '');

    $('#modal-container').html(`
        <div class="modal fade" id="processandoNFCeModal" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title">
                            <i class="fas fa-file-invoice me-2"></i>
                            Emitindo NFC-e
                        </h5>
                    </div>

                    <div class="modal-body text-center">
                        <div class="spinner-border text-primary mb-3" role="status" style="width: 3rem; height: 3rem;"></div>

                        <h5 class="mb-2">Venda #${vendaId}</h5>
                        
                        <p class="text-muted mb-2">
                            <strong>Enviando NFC-e para a SEFAZ...</strong>
                        </p>
                        
                        <div class="alert alert-info mt-3 mb-0">
                            <small>
                                <i class="fas fa-info-circle me-1"></i>
                                Este processo pode levar alguns segundos.<br>
                                Por favor, aguarde e não feche esta janela.
                            </small>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('processandoNFCeModal');
    const modal = new bootstrap.Modal(modalEl);
    
    // Forçar exibição do modal
    setTimeout(() => {
        modal.show();
    }, 100);
}

// Impressão fiscal/não fiscal: ver frontend/shared/js/fiscalImpressao.js

function limparModaisTravados() {
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
}

function fecharModalErroNFCe() {
    const modalEl = document.getElementById('erroNFCeModal');

    if (modalEl) {
        const instancia = bootstrap.Modal.getInstance(modalEl);
        if (document.activeElement) {
                    document.activeElement.blur();
                }
                if (instancia) instancia.hide();
    }

    setTimeout(() => {
        limparModaisTravados();
    }, 300);
}

function abrirModalQuantidadeProduto(produto, callback, opcoes = {}) {
    $('#modalQuantidadeProduto').remove();

    const vendaPorUnidade = tipoVendaEhUnidade(opcoes.tipo_venda ?? opcoes.modo_venda);
    const unidade = String(produto.unidade || 'UN').toUpperCase();
    const fracionado = vendaPorUnidade ? false : permiteQuantidadeDecimal(produto);

    const modalHtml = `
        <div class="modal fade" id="modalQuantidadeProduto" tabindex="-1">
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header py-2">
                        <h6 class="modal-title">Quantidade</h6>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body">
                        <p class="mb-2 fw-bold">${produto.nome}</p>

                        <label class="form-label">
                            ${vendaPorUnidade ? 'Quantidade' : (fracionado ? `Quantidade em ${unidade}` : 'Quantidade')}
                        </label>

                        <input 
                            type="${fracionado ? 'text' : 'number'}"
                            class="form-control form-control-lg"
                            id="inputQuantidadeProduto"
                            min="${fracionado ? '0.01' : '1'}"
                            step="${fracionado ? '0.001' : '1'}"
                            inputmode="${fracionado ? 'decimal' : 'numeric'}"
                            value="${fracionado ? '1,000' : '1'}"
                            placeholder="${vendaPorUnidade ? 'Ex: 5' : (fracionado ? 'Ex: 2,536' : 'Ex: 1')}"
                            autofocus
                        >

                        <small class="text-muted">
                            ${vendaPorUnidade
                                ? 'Exemplo: 5 unidades'
                                : (fracionado
                                    ? (unidadeEhKg(produto)
                                        ? 'Digite o peso exato. Ex.: 2,536 kg'
                                        : `Digite a quantidade exata em ${unidade}`)
                                    : 'Digite a quantidade vendida')}
                        </small>

                        ${vendaPorUnidade ? `
                        <div id="previewVendaUnidade" class="mt-3 p-2 bg-light rounded">
                            <div class="small text-muted mb-1">Estoque (KG):</div>
                            <div class="fw-semibold" id="previewVendaUnidadeKg">—</div>
                            <div class="small text-muted mt-2 mb-1">Valor da venda:</div>
                            <div class="fw-semibold text-success" id="previewVendaUnidadeValor">—</div>
                        </div>
                        ` : ''}
                    </div>

                    <div class="modal-footer py-2">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                            Cancelar
                        </button>
                        <button type="button" class="btn btn-primary" id="btnConfirmarQuantidadeProduto">
                            Confirmar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);

    const modalEl = document.getElementById('modalQuantidadeProduto');
    const modal = new bootstrap.Modal(modalEl);

    modal.show();

    const focarInputQuantidade = () => {
        const input = document.getElementById('inputQuantidadeProduto');
        if (!input) return;
        input.focus({ preventScroll: true });
        try { input.select(); } catch (_) { /* ignore */ }
    };

    modalEl.addEventListener('shown.bs.modal', function onShown() {
        modalEl.removeEventListener('shown.bs.modal', onShown);
        // Após o focus trap do Bootstrap (que prioriza o btn-close)
        focarInputQuantidade();
        setTimeout(focarInputQuantidade, 50);
        setTimeout(focarInputQuantidade, 120);
        if (vendaPorUnidade) {
            atualizarPreviewVendaUnidadeModal(produto);
        }
    });

    if (vendaPorUnidade) {
        $('#inputQuantidadeProduto').off('input').on('input', function () {
            atualizarPreviewVendaUnidadeModal(produto);
        });
    }

    $('#btnConfirmarQuantidadeProduto').off('click').on('click', function () {
        confirmarQuantidadeProduto(produto, callback, modal, opcoes);
    });

    $('#inputQuantidadeProduto').off('keydown').on('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            confirmarQuantidadeProduto(produto, callback, modal, opcoes);
        }
    });

    modalEl.addEventListener('hidden.bs.modal', function () {
        const confirmou = modalEl.dataset.qtdConfirmada === '1';
        $('#modalQuantidadeProduto').remove();
        if (!confirmou) {
            focarCampoCodigo({ limpar: true });
        }
    });
}

function confirmarQuantidadeProduto(produto, callback, modal, opcoes = {}) {
    let valor = $('#inputQuantidadeProduto').val();
    const tipoVenda = normalizarTipoVendaItem(opcoes);
    // BUGFIX 02 — nunca confirmar com quantidade vazia (padrão 1 / 1,000)
    if (!String(valor ?? '').trim()) {
        valor = tipoVendaEhUnidade(tipoVenda)
            ? '1'
            : (permiteQuantidadeDecimal(produto) ? '1,000' : '1');
        $('#inputQuantidadeProduto').val(valor);
    }
    const quantidade = tipoVendaEhUnidade(tipoVenda)
        ? Math.max(0, Math.round(Number(parseQuantidadePdv(valor) || 0)))
        : normalizarQuantidadePdv(parseQuantidadePdv(valor), produto);

    if (!quantidade || quantidade <= 0) {
        showNotification('Informe uma quantidade válida.', 'warning');
        $('#inputQuantidadeProduto').focus();
        return;
    }

    const quantidadeEstoque = obterQuantidadeEstoqueParaVenda(produto, quantidade, tipoVenda);
    if (tipoVendaEhUnidade(tipoVenda) && quantidadeEstoque <= 0) {
        showNotification('Peso médio da unidade não configurado para este produto.', 'warning');
        $('#inputQuantidadeProduto').focus();
        return;
    }

    if (produtoControlaEstoquePdv(produto) && !pdvNotificarEstoqueInsuficiente(produto, quantidadeEstoque)) {
        $('#inputQuantidadeProduto').focus();
        return;
    }

    if (document.activeElement) {
        document.activeElement.blur();
    }

    const modalEl = document.getElementById('modalQuantidadeProduto');
    if (modalEl) {
        modalEl.dataset.qtdConfirmada = '1';
    }

    $(modalEl).one('hidden.bs.modal.qtdok', function () {
        setTimeout(function () {
            if (typeof callback === 'function') callback(quantidade);
        }, 80);
    });

    modal.hide();
}

function abrirTelaPagamento() {
    // Alias preservado: fluxo balcão original (Sprint 2 não altera este caminho)
    return abrirTelaPagamentoBalcao();
}

function abrirTelaPagamentoBalcao() {
    const totalVenda = obterTotalVendaPDV();

    $('#modal-container').html(`
        <div class="modal fade" id="modalPagamentoPDV" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered modal-xl">
                <div class="modal-content border-0 shadow-lg"
                    style="
                        border-radius: 24px;
                        overflow: hidden;
                        background: #f5f7fb;
                    ">
                    <div class="modal-body p-0">
                        <div class="row g-0">
                            <div class="col-md-4 bg-primary text-white d-flex flex-column justify-content-center align-items-center p-5">
                                <small class="opacity-75 mb-2">
                                    TOTAL DA VENDA
                                </small>
                                <h1 style="
                                    font-size: 4rem;
                                    font-weight: 700;
                                ">
                                    R$ ${totalVenda.toFixed(2).replace('.', ',')}
                                </h1>
                                <div class="mt-4 opacity-75 text-center">
                                    Escolha a forma de pagamento
                                </div>
                            </div>
                            <div class="col-md-8 p-5">
                                <div class="row g-4">
                                    <div class="col-md-6">
                                        <button class="btnPagamentoPDV btn btn-light w-100"
                                            onclick="selecionarPagamentoPDV('dinheiro')">
                                            <div class="atalho">
                                                1
                                            </div>
                                            <div class="titulo">
                                                Dinheiro
                                            </div>
                                        </button>
                                    </div>
                                    <div class="col-md-6">
                                        <button class="btnPagamentoPDV btn btn-light w-100"
                                            onclick="selecionarPagamentoPDV('pix')">
                                            <div class="atalho">
                                                2
                                            </div>
                                            <div class="titulo">
                                                Pix
                                            </div>
                                        </button>
                                    </div>
                                    <div class="col-md-6">
                                        <button class="btnPagamentoPDV btn btn-light w-100"
                                            onclick="selecionarPagamentoPDV('cartao_debito')">
                                            <div class="atalho">
                                                3
                                            </div>
                                            <div class="titulo">
                                                Débito
                                            </div>
                                        </button>
                                    </div>
                                    <div class="col-md-6">
                                        <button class="btnPagamentoPDV btn btn-light w-100"
                                            onclick="selecionarPagamentoPDV('cartao_credito')">
                                            <div class="atalho">
                                                4
                                            </div>
                                            <div class="titulo">
                                                Crédito
                                            </div>
                                        </button>
                                    </div>
                                    <div class="col-md-6">
                                        <button class="btnPagamentoPDV btn btn-warning w-100"
                                            onclick="abrirPagamentoMisto()">
                                            <div class="atalho">
                                                5
                                            </div>
                                            <div class="titulo">
                                                Pagamento Misto
                                            </div>
                                        </button>
                                    </div>
                                    <div class="col-md-6">
                                        <button class="btnPagamentoPDV btn btn-light w-100"
                                            onclick="selecionarPagamentoPDV('prazo')">
                                            <div class="atalho">
                                                6
                                            </div>
                                            <div class="titulo">
                                                A Prazo
                                            </div>
                                        </button>
                                    </div>
                                    <div class="col-md-6">
                                        <button class="btnPagamentoPDV btn btn-outline-danger w-100"
                                            data-bs-dismiss="modal">
                                            <div class="atalho">
                                                ESC
                                            </div>
                                            <div class="titulo">
                                                Cancelar
                                            </div>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modal = new bootstrap.Modal(
        document.getElementById('modalPagamentoPDV')
    );

    modal.show();

    $(document).off('keydown.pagamentoPDV');

    $(document).on('keydown.pagamentoPDV', function(e) {
        const modalAberto = $('#modalPagamentoPDV').hasClass('show');

        if (!modalAberto) {
            return;
        }

        if (
            $('input:focus, textarea:focus, select:focus').length > 0
        ) {
            return;
        }

        switch (e.key) {
            case '1':
                e.preventDefault();
                selecionarPagamentoPDV('dinheiro');
                break;

            case '2':
                e.preventDefault();
                selecionarPagamentoPDV('pix');
                break;

            case '3':
                e.preventDefault();
                selecionarPagamentoPDV('cartao_debito');
                break;

            case '4':
                e.preventDefault();
                selecionarPagamentoPDV('cartao_credito');
                break;

            case '5':
                e.preventDefault();
                abrirPagamentoMisto();
                break;

            case '6':
                e.preventDefault();
                selecionarPagamentoPDV('prazo');
                break;

            case 'Escape':
                e.preventDefault();
                if (document.activeElement) {
                    document.activeElement.blur();
                }
                $('#modalPagamentoPDV').modal('hide');
                break;
        }
    });
}

function selecionarPagamentoPDV(forma) {
    $(document).off('keydown.pagamentoPDV');

    pagamentosMistos = [];
    formaPagamentoSelecionadaPDV = forma;

    const modalEl = document.getElementById('modalPagamentoPDV');
    const modal = bootstrap.Modal.getInstance(modalEl);

    if (document.activeElement) {
        document.activeElement.blur();
    }

    if (modal) {
        modal.hide();
    }

    if (forma === 'dinheiro') {
        mostrarModalTroco();
    } else if (forma === 'pix') {
        setTimeout(async () => {
            const tefOn = await obterTefHabilitadoConfig();
            if (tefOn) {
                mostrarModalDecisaoFiscal();
                return;
            }

            const ativo = await pixAutomaticoHabilitado();
            if (ativo) {
                iniciarPixAutomaticoPDV();
            } else {
                mostrarModalDecisaoFiscal();
            }
        }, 300);
    } else if (forma === 'prazo') {
        mostrarModalClientePrazo();
    } else {
        setTimeout(() => {
            mostrarModalDecisaoFiscal();
        }, 300);
    }
}

let intervaloConsultaPixPDV = null;
let pixAutomaticoAtivoCache = null;

async function pixAutomaticoHabilitado() {
    if (pixAutomaticoAtivoCache !== null) {
        return pixAutomaticoAtivoCache;
    }

    try {
        const resp = await fetch(`${API_URL}/pix/config`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        const data = await resp.json();
        pixAutomaticoAtivoCache = !!(data.success && data.config?.ativo);
        return pixAutomaticoAtivoCache;
    } catch (err) {
        console.error('Erro ao verificar Pix automático:', err);
        pixAutomaticoAtivoCache = false;
        return false;
    }
}

async function iniciarPixAutomaticoPDV(valorPix, opcoes = {}) {
    const ativo = await pixAutomaticoHabilitado();

    if (!ativo) {
        if (typeof opcoes.onPago === 'function') {
            opcoes.onPago();
        } else {
            setTimeout(() => mostrarModalDecisaoFiscal(), 300);
        }
        return;
    }

    const totalVenda = valorPix != null && Number(valorPix) > 0
        ? Math.round(Number(valorPix) * 100) / 100
        : obterTotalVendaPDV();

    if (totalVenda <= 0) {
        showNotification('O valor do Pix deve ser maior que zero.', 'warning');
        return;
    }

    try {
        showNotification('Gerando cobrança Pix...', 'info');

        const resp = await fetch(`${API_URL}/pix/criar-cobranca`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                valor: totalVenda,
                descricao: opcoes.modoMisto ? 'Venda PDV - Pagamento misto' : 'Venda PDV'
            })
        });

        const data = await resp.json();

        if (!resp.ok || !data.success) {
            throw new Error(data.error || 'Erro ao gerar Pix.');
        }

        mostrarModalAguardandoPixPDV(data.cobranca, totalVenda, opcoes);
        consultarPixAteConfirmarPDV(data.cobranca.txid, opcoes);

    } catch (err) {
        console.error('Erro Pix automático:', err);
        showNotification(err.message || 'Erro ao gerar Pix.', 'danger');
    }
}

function mostrarModalAguardandoPixPDV(cobranca, totalVenda, opcoes = {}) {
    const qrImg = cobranca.qrCodeBase64
        ? `<img src="data:image/png;base64,${cobranca.qrCodeBase64}" alt="QR Code Pix" style="width:320px;height:320px;max-width:100%;display:block;">`
        : `<div class="alert alert-warning py-2 mb-0 small">QR Code não retornado. Use o Pix Copia e Cola.</div>`;

    $('#modal-container').html(`
        <div class="modal fade" id="modalPixAutomaticoPDV" tabindex="-1" data-bs-backdrop="static">
            <div class="modal-dialog modal-dialog-centered" style="max-width:380px;">
                <div class="modal-content border-0 shadow" style="border-radius:12px;overflow:hidden;">
                    <div class="modal-header text-white py-2 px-3" style="background:#0f766e;">
                        <div>
                            <h6 class="modal-title mb-0 fw-bold">Pagamento Pix Automático</h6>
                            <small class="opacity-75" style="font-size:0.75rem;">Aguardando confirmação bancária</small>
                        </div>
                    </div>

                    <div class="modal-body p-3 text-center">
                        <small class="text-muted">${opcoes.modoMisto ? 'Valor restante em Pix' : 'Total da venda'}</small>
                        <div class="mb-2" style="color:#0f766e;font-weight:700;font-size:1.5rem;">
                            R$ ${Number(totalVenda).toFixed(2).replace('.', ',')}
                        </div>
                        ${opcoes.modoMisto ? '<p class="text-muted small mb-2">Dinheiro já informado. Pague o restante via Pix.</p>' : ''}

                        <div class="bg-white border rounded p-1 d-inline-block mb-2">
                            ${qrImg}
                        </div>

                        <div class="alert alert-info py-1 px-2 mb-2 small">
                            <strong>Status:</strong>
                            <span id="statusPixPDV">Aguardando pagamento...</span>
                        </div>

                        <label class="form-label fw-bold small mb-1">Pix Copia e Cola</label>
                        <textarea id="pixCopiaColaPDV" class="form-control form-control-sm" rows="2" readonly style="font-size:0.7rem;">${cobranca.copiaCola || ''}</textarea>

                        <div class="d-grid gap-1 mt-2">
                            <button class="btn btn-outline-primary btn-sm" onclick="copiarPixCopiaColaPDV()">
                                Copiar Pix Copia e Cola
                            </button>
                            <button class="btn btn-outline-danger btn-sm" onclick="cancelarAguardandoPixPDV()">
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modal = new bootstrap.Modal(document.getElementById('modalPixAutomaticoPDV'));
    modal.show();
}

function consultarPixAteConfirmarPDV(txid, opcoes = {}) {
    if (intervaloConsultaPixPDV) {
        clearInterval(intervaloConsultaPixPDV);
    }

    intervaloConsultaPixPDV = setInterval(async () => {
        try {
            const resp = await fetch(`${API_URL}/pix/status/${encodeURIComponent(txid)}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            const data = await resp.json();

            if (!resp.ok || !data.success) {
                throw new Error(data.error || 'Erro ao consultar Pix.');
            }

            const status = data.status.status;

            $('#statusPixPDV').text(status);

            if (status === 'PAGO') {
                clearInterval(intervaloConsultaPixPDV);
                intervaloConsultaPixPDV = null;

                $('#statusPixPDV').text('Pix confirmado!');

                setTimeout(() => {
                    const modalEl = document.getElementById('modalPixAutomaticoPDV');
                    const modal = bootstrap.Modal.getInstance(modalEl);

                    if (modal) modal.hide();

                    if (typeof opcoes.onPago === 'function') {
                        opcoes.onPago();
                    } else {
                        formaPagamentoSelecionadaPDV = 'pix';
                        setTimeout(() => {
                            mostrarModalDecisaoFiscal();
                        }, 300);
                    }
                }, 800);
            }

            if (['EXPIRADO', 'CANCELADO', 'ERRO'].includes(status)) {
                clearInterval(intervaloConsultaPixPDV);
                intervaloConsultaPixPDV = null;
                showNotification(`Pix ${status}. Gere uma nova cobrança.`, 'danger');
            }

        } catch (err) {
            console.error('Erro ao consultar Pix:', err);
        }
    }, 3000);
}

function copiarPixCopiaColaPDV() {
    const texto = $('#pixCopiaColaPDV').val();

    navigator.clipboard.writeText(texto)
        .then(() => showNotification('Pix Copia e Cola copiado.', 'success'))
        .catch(() => {
            $('#pixCopiaColaPDV').select();
            document.execCommand('copy');
            showNotification('Pix Copia e Cola copiado.', 'success');
        });
}

function cancelarAguardandoPixPDV() {
    if (intervaloConsultaPixPDV) {
        clearInterval(intervaloConsultaPixPDV);
        intervaloConsultaPixPDV = null;
    }

    const modalEl = document.getElementById('modalPixAutomaticoPDV');
    const modal = bootstrap.Modal.getInstance(modalEl);

    if (modal) {
        modal.hide();
    }

    showNotification('Pagamento Pix cancelado no PDV.', 'warning');
}

function mostrarModalClientePrazo() {
    const totalVenda = obterTotalVendaPDV();

    const hoje = new Date();
    const primeiroVencimento = new Date(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());

    $('#modal-container').html(`
        <div class="modal fade" id="clientePrazoModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg" style="border-radius: 18px; overflow: hidden;">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title">Pagamento a Prazo</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body p-4">
                        <div class="text-center mb-4">
                            <h4 class="mb-2">Total da Venda</h4>
                            <h2 style="color: #0d6efd; font-weight: 700;">
                                R$ ${totalVenda.toFixed(2).replace('.', ',')}
                            </h2>
                        </div>

                        <div class="mb-3">
                            <label for="cliente-prazo-busca" class="form-label fw-bold">Cliente *</label>
                            <input type="text" class="form-control form-control-lg" id="cliente-prazo-busca" placeholder="Digite o nome do cliente">
                            <input type="hidden" id="cliente-prazo-id">
                            <div id="cliente-prazo-sugestoes" class="list-group position-absolute w-100" style="z-index: 9999; display:none; max-height: 200px; overflow-y: auto;"></div>
                        </div>

                        <div class="mb-3">
                            <label for="parcelas-prazo" class="form-label fw-bold">Quantidade de Parcelas *</label>
                            <input type="number" min="1" max="24" class="form-control form-control-lg" id="parcelas-prazo" value="1">
                        </div>

                        <div class="mb-3">
                            <label for="primeiro-vencimento-prazo" class="form-label fw-bold">Primeiro Vencimento *</label>
                            <input type="date" class="form-control form-control-lg" id="primeiro-vencimento-prazo" value="${primeiroVencimento.toISOString().split('T')[0]}">
                        </div>

                        <div class="d-grid gap-2 mt-4">
                            <button class="btn btn-primary btn-lg" onclick="confirmarPagamentoPrazo()">
                                Confirmar
                            </button>
                            <button class="btn btn-secondary" data-bs-dismiss="modal">
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modal = new bootstrap.Modal(document.getElementById('clientePrazoModal'));
    modal.show();

    // Focar no input de cliente
    setTimeout(() => {
        $('#cliente-prazo-busca').focus();
    }, 500);

    // Busca de cliente
    $('#cliente-prazo-busca').off('input').on('input', function() {
        const termo = normalizarTexto($(this).val()).trim();
        if (termo.length < 2) {
            $('#cliente-prazo-sugestoes').empty().hide();
            $('#cliente-prazo-id').val('');
            return;
        }

        $.ajax({
            url: `${API_URL}/clientes`,
            method: 'GET',
            success: function(clientes) {
                const filtrados = (clientes || []).filter(c =>
                    normalizarTexto(c.nome).includes(termo) ||
                    String(c.cpf_cnpj || '').replace(/\D/g, '').includes(termo.replace(/\D/g, ''))
                );

                if (filtrados.length === 0) {
                    $('#cliente-prazo-sugestoes').html('<div class="list-group-item">Nenhum cliente encontrado</div>').show();
                    return;
                }

                $('#cliente-prazo-sugestoes').html(
                    filtrados.map(c => `
                        <button type="button" class="list-group-item list-group-item-action" data-id="${c.id}" data-nome="${escapeHtml(c.nome || '')}">
                            ${escapeHtml(c.nome || '')}${c.cpf_cnpj ? ' - ' + formatarCpfCnpj(c.cpf_cnpj) : ''}
                        </button>
                    `).join('')
                ).show();
            },
            error: function() {
                $('#cliente-prazo-sugestoes').empty().hide();
            }
        });
    });

    // Selecionar cliente da sugestão
    $(document).off('click.sugestaoCliente').on('click.sugestaoCliente', '#cliente-prazo-sugestoes button', function() {
        $('#cliente-prazo-id').val($(this).data('id'));
        $('#cliente-prazo-busca').val($(this).data('nome'));
        $('#cliente-prazo-sugestoes').empty().hide();
    });
}

function confirmarPagamentoPrazo() {
    const clienteId = parseInt($('#cliente-prazo-id').val(), 10);
    const parcelas = parseInt($('#parcelas-prazo').val(), 10) || 1;
    const primeiroVencimento = $('#primeiro-vencimento-prazo').val();

    if (!clienteId) {
        showNotification('Selecione o cliente da venda a prazo.', 'danger');
        return;
    }
    if (parcelas < 1) {
        showNotification('Quantidade de parcelas inválida.', 'danger');
        return;
    }
    if (!primeiroVencimento) {
        showNotification('Informe o primeiro vencimento.', 'danger');
        return;
    }

    vendaPrazoInfo = {
        cliente_id: clienteId,
        parcelas,
        primeiro_vencimento: primeiroVencimento,
        cliente_nome: $('#cliente-prazo-busca').val().trim()
    };

    // Fechar modal
    const modalEl = document.getElementById('clientePrazoModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) {
        modal.hide();
    }

    // Continuar fluxo fiscal / não fiscal
    setTimeout(() => {
        mostrarModalDecisaoFiscal();
    }, 300);
}

function mostrarModalTroco() {
    const totalVenda = obterTotalVendaPDV();

    $('#modal-container').html(`
        <div class="modal fade" id="trocoModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg" style="border-radius: 18px; overflow: hidden;">
                    <div class="modal-header bg-success text-white">
                        <h5 class="modal-title">Pagamento em Dinheiro</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body p-4">
                        <div class="text-center mb-4">
                            <h4 class="mb-2">Total da Venda</h4>
                            <h2 style="color: #16a34a; font-weight: 700;">
                                R$ ${totalVenda.toFixed(2).replace('.', ',')}
                            </h2>
                        </div>

                        <div class="mb-3">
                            <label for="valorRecebido" class="form-label fw-bold">Valor Recebido</label>
                            <input type="number" step="0.01" class="form-control form-control-lg" id="valorRecebido" placeholder="Digite o valor recebido">
                        </div>

                        <div class="p-3 bg-light rounded border">
                            <div class="d-flex justify-content-between align-items-center">
                                <span class="fw-bold">Troco:</span>
                                <span id="trocoCalculado" style="font-size: 1.5rem; color: #16a34a; font-weight: 700;">R$ 0,00</span>
                            </div>
                        </div>

                        <div class="d-grid gap-2 mt-4">
                            <button class="btn btn-success btn-lg" onclick="confirmarTroco()">
                                Confirmar
                            </button>
                            <button class="btn btn-secondary" data-bs-dismiss="modal">
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modal = new bootstrap.Modal(document.getElementById('trocoModal'));
    modal.show();

    // Focar no input
    setTimeout(() => {
        $('#valorRecebido').focus();
    }, 500);

    // Calcular troco ao digitar
    $('#valorRecebido').off('input').on('input', function() {
        const valorRecebido = Number(String($(this).val()).replace(',', '.')) || 0;
        const troco = valorRecebido - totalVenda;
        $('#trocoCalculado').text(`R$ ${Math.max(0, troco).toFixed(2).replace('.', ',')}`);
    });

    // Confirmar com Enter
    $('#valorRecebido').off('keydown').on('keydown', function(e) {
        if (e.key === 'Enter') {
            confirmarTroco();
        }
    });
}

function confirmarTroco() {
    const totalVenda = obterTotalVendaPDV();

    const valorRecebido = parseValorMonetarioPdv($('#valorRecebido').val());

    if (valorRecebido < totalVenda) {
        showNotification('Valor recebido deve ser maior ou igual ao total da venda.', 'warning');
        $('#valorRecebido').focus();
        return;
    }

    registrarValorRecebidoDinheiroPdv(valorRecebido, totalVenda);

    const modalEl = document.getElementById('trocoModal');
    const modal = bootstrap.Modal.getInstance(modalEl);

    if (document.activeElement) {
        document.activeElement.blur();
    }

    if (modal) {
        modal.hide();
    }

    setTimeout(() => {
        mostrarModalDecisaoFiscal();
    }, 300);
}

// =======================================================
// CONSULTA DE PRODUTOS NO PDV - F1
// =======================================================

const CHAVE_MODO_CONSULTA_PDV = 'pdv_consulta_f1_modo';

function obterModoVisualizacaoConsultaPDV() {
    try {
        return localStorage.getItem(CHAVE_MODO_CONSULTA_PDV) === 'nomes' ? 'nomes' : 'categoria';
    } catch (e) {
        return 'categoria';
    }
}

function salvarModoVisualizacaoConsultaPDV(modo) {
    const valor = modo === 'nomes' ? 'nomes' : 'categoria';
    try {
        localStorage.setItem(CHAVE_MODO_CONSULTA_PDV, valor);
    } catch (e) { /* ignore quota / private mode */ }
    return valor;
}

function atualizarBotoesModoConsultaPDV() {
    const modo = obterModoVisualizacaoConsultaPDV();
    $('#btnConsultaPdvPorCategoria')
        .toggleClass('btn-primary', modo === 'categoria')
        .toggleClass('btn-outline-primary', modo !== 'categoria');
    $('#btnConsultaPdvPorNome')
        .toggleClass('btn-primary', modo === 'nomes')
        .toggleClass('btn-outline-primary', modo !== 'nomes');
}

function definirModoVisualizacaoConsultaPDV(modo) {
    salvarModoVisualizacaoConsultaPDV(modo);
    atualizarBotoesModoConsultaPDV();
    const termo = $('#inputConsultaProdutoPDV').val().trim();
    if (termo) {
        buscarProdutosConsultaPDV();
        return;
    }
    carregarVisualizacaoVaziaConsultaPDV();
}

function carregarVisualizacaoVaziaConsultaPDV() {
    if (obterModoVisualizacaoConsultaPDV() === 'nomes') {
        carregarNomesConsultaPDV();
        return;
    }
    carregarCategoriasConsultaPDV();
}

function abrirConsultaProdutosPdvDoCampoBusca() {
    if (window.PdvBuscaProduto && typeof PdvBuscaProduto.fechar === 'function') {
        PdvBuscaProduto.fechar();
    }
    const termo = ($('#buscaProdutoPdv').val() || '').trim();
    abrirConsultaProdutosPDV(termo);
}

function abrirConsultaProdutosPDV(termoInicial) {
    recarregarCatalogoPdv();
    $('#modalConsultaProdutosPDV').remove();

    const termo = String(termoInicial || '').trim();

    const modalHtml = `
        <div class="modal fade" id="modalConsultaProdutosPDV" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title">
                            <i class="fas fa-search"></i> Consulta de Produtos - F1
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>

                    <div class="modal-body">
                        <div class="alert alert-info py-2 mb-3">
                            Use esta tela apenas para consultar preço/estoque. Clique em <strong>Adicionar</strong> somente se quiser mandar o produto para o carrinho.
                        </div>

                        <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
                            <span class="text-muted small mb-0">Mostrar:</span>
                            <div class="btn-group" role="group" aria-label="Modo de visualização da consulta">
                                <button type="button" class="btn btn-sm btn-outline-primary" id="btnConsultaPdvPorCategoria">
                                    <i class="fas fa-folder me-1"></i> Por categoria
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-primary" id="btnConsultaPdvPorNome">
                                    <i class="fas fa-list me-1"></i> Apenas nomes
                                </button>
                            </div>
                        </div>

                        <div class="input-group mb-3">
                            <span class="input-group-text">
                                <i class="fas fa-barcode"></i>
                            </span>
                            <input
                                type="text"
                                id="inputConsultaProdutoPDV"
                                class="form-control form-control-lg"
                                placeholder="Buscar por nome, código, código de barras ou ID..."
                                autocomplete="off"
                            >
                            <button class="btn btn-primary" type="button" onclick="buscarProdutosConsultaPDV()">
                                Buscar
                            </button>
                        </div>

                        <div id="resultadoConsultaProdutosPDV">
                            <div class="text-muted text-center py-4">
                                Digite o nome, código ou ID do produto para consultar.
                            </div>
                        </div>
                    </div>

                    <div class="modal-footer">
                        <small class="text-muted me-auto">
                            ESC fecha a consulta. Enter busca o produto.
                        </small>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                            Voltar ao PDV
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);

    const modalEl = document.getElementById('modalConsultaProdutosPDV');
    const modal = new bootstrap.Modal(modalEl);

    modal.show();

    $('#btnConsultaPdvPorCategoria').off('click').on('click', function () {
        definirModoVisualizacaoConsultaPDV('categoria');
    });
    $('#btnConsultaPdvPorNome').off('click').on('click', function () {
        definirModoVisualizacaoConsultaPDV('nomes');
    });
    atualizarBotoesModoConsultaPDV();

    modalEl.addEventListener('shown.bs.modal', function () {
        if (termo) {
            $('#inputConsultaProdutoPDV').val(termo);
            buscarProdutosConsultaPDV();
        } else {
            carregarVisualizacaoVaziaConsultaPDV();
        }
        $('#inputConsultaProdutoPDV').trigger('focus');
    });

    $('#inputConsultaProdutoPDV').off('keydown').on('keydown', function (e) {
        if (e.key === 'Enter') {
            buscarProdutosConsultaPDV();
        }
    });

    modalEl.addEventListener('hidden.bs.modal', function () {
        $('#modalConsultaProdutosPDV').remove();
        focarCampoCodigo({ limpar: true });
    });
}

function carregarCategoriasConsultaPDV() {
    $('#resultadoConsultaProdutosPDV').html(`
        <div class="text-center py-4">
            <div class="spinner-border text-primary"></div>
            <div class="mt-2">Carregando categorias...</div>
        </div>
    `);

    $.ajax({
        url: `${API_URL}/categorias?tipo=produto`,
        method: 'GET',
        success: function(categorias) {
            if (!categorias || categorias.length === 0) {
                $('#resultadoConsultaProdutosPDV').html(`
                    <div class="alert alert-warning">
                        Nenhuma categoria encontrada.
                    </div>
                `);
                return;
            }

            const html = categorias.map(cat => `
                <div class="card mb-2 categoria-card" data-categoria-id="${cat.id}">
                    <div class="card-header bg-light d-flex justify-content-between align-items-center" style="cursor: pointer;" onclick="toggleProdutosCategoria(${cat.id})">
                        <strong><i class="fas fa-folder me-2"></i>${escapeHtml(cat.nome)}</strong>
                        <i class="fas fa-chevron-down" id="chevron-${cat.id}"></i>
                    </div>
                    <div class="card-body p-0" id="produtos-categoria-${cat.id}" style="display: none;">
                        <div class="text-center py-3">
                            <div class="spinner-border spinner-border-sm text-primary"></div>
                        </div>
                    </div>
                </div>
            `).join('');

            $('#resultadoConsultaProdutosPDV').html(`
                <div class="alert alert-info py-2 mb-3">
                    <i class="fas fa-info-circle me-2"></i>
                    Clique em uma categoria para ver os produtos. Use a busca acima para pesquisar em todos os produtos.
                </div>
                ${html}
            `);
        },
        error: function() {
            $('#resultadoConsultaProdutosPDV').html(`
                <div class="alert alert-danger">
                    Erro ao carregar categorias.
                </div>
            `);
        }
    });
}

function toggleProdutosCategoria(categoriaId) {
    const container = $(`#produtos-categoria-${categoriaId}`);
    const chevron = $(`#chevron-${categoriaId}`);

    if (container.is(':visible')) {
        container.slideUp();
        chevron.removeClass('fa-chevron-up').addClass('fa-chevron-down');
    } else {
        // Se ainda não carregou os produtos, carregar
        if (container.find('.spinner-border').length > 0) {
            $.ajax({
                url: `${API_URL}/produtos`,
                method: 'GET',
                data: { categoria_id: categoriaId, modo_fiscal: '0' },
                success: function(produtos) {
                    // Defesa: nunca exibir produto de outra categoria no accordion F1
                    const filtrados = (produtos || []).filter((p) =>
                        String(p.categoria_id || '') === String(categoriaId)
                    );
                    if (!filtrados.length) {
                        container.html(`
                            <div class="p-3 text-muted">
                                Nenhum produto nesta categoria.
                            </div>
                        `);
                    } else {
                        const produtosHtml = filtrados.map(p => `
                            <div class="p-2 border-bottom produto-item" data-produto-id="${p.id}">
                                <div class="d-flex justify-content-between align-items-center">
                                    <div>
                                        <strong>${escapeHtml(nomeExibicaoProdutoConsultaPdv(p))}</strong>
                                        <small class="text-muted d-block">${escapeHtml(p.codigo_barras || p.codigo || '')}</small>
                                        ${p.subcategoria_nome || p.subcategoria
                                            ? `<small class="text-muted d-block">${escapeHtml(p.subcategoria_nome || p.subcategoria)}</small>`
                                            : ''}
                                    </div>
                                    <div class="text-end">
                                        <div class="fw-bold text-primary">${formatCurrency(p.preco_venda)}</div>
                                        <small class="text-muted">${pdvRotuloEstoque(p)}</small>
                                    </div>
                                </div>
                                <button class="btn btn-sm btn-primary mt-2 w-100" onclick="adicionarProdutoConsultaPDV(${p.id})">
                                    <i class="fas fa-plus"></i> Adicionar
                                </button>
                            </div>
                        `).join('');

                        container.html(produtosHtml);
                    }
                },
                error: function() {
                    container.html(`
                        <div class="p-3 text-danger">
                            Erro ao carregar produtos.
                        </div>
                    `);
                }
            });
        }

        container.slideDown();
        chevron.removeClass('fa-chevron-down').addClass('fa-chevron-up');
    }
}

function carregarNomesConsultaPDV() {
    const lista = Array.isArray(produtosDisponiveis) ? produtosDisponiveis.slice() : [];
    if (!lista.length) {
        $('#resultadoConsultaProdutosPDV').html(`
            <div class="alert alert-warning">
                Nenhum produto carregado no PDV.
            </div>
        `);
        return;
    }

    lista.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' }));
    renderizarProdutosConsultaPDV(lista);
}

function adicionarProdutoConsultaPDV(produtoId) {
    // Sempre hidrata do servidor: busca F1/autocomplete pode ter saldos zerados.
    Promise.resolve(garantirProdutoNoCatalogoPdv(produtoId, { forcarAtualizacao: true })).then(function (produto) {
    if (!produto) {
        showNotification('Produto não encontrado na lista do PDV. Atualize o PDV e tente novamente.', 'danger');
        return;
    }

    const validacaoMinima = pdvPodeIniciarInclusaoProduto(produto);
    if (!validacaoMinima.sucesso) {
        showNotification(validacaoMinima.mensagem, validacaoMinima.semSaldoTotal ? 'danger' : 'warning');
        return;
    }

    buscarPromocaoAtivaProduto(produto.id).then(promocao => {
        iniciarFluxoAdicionarProdutoPdv(produto, promocao);
    });
    });
}

function buscarProdutosConsultaPDV() {
    const termo = $('#inputConsultaProdutoPDV').val().trim();

    if (!termo) {
        carregarVisualizacaoVaziaConsultaPDV();
        return;
    }

    $('#resultadoConsultaProdutosPDV').html(`
        <div class="text-center py-4">
            <div class="spinner-border text-primary"></div>
            <div class="mt-2">Buscando produtos...</div>
        </div>
    `);

    $.ajax({
        url: `${API_URL}/produtos/consulta-pdv/buscar?q=${encodeURIComponent(termo)}&modo_fiscal=0`,
        method: 'GET',
        cache: false,
        success: function (produtos) {
            const lista = (produtos || []).map(function (p) {
                // Upsert com merge: não zera estoque bom do catálogo
                return (typeof upsertProdutoNoCatalogoPdv === 'function'
                    ? upsertProdutoNoCatalogoPdv(p)
                    : p) || p;
            });
            if (obterModoVisualizacaoConsultaPDV() === 'categoria') {
                renderizarProdutosConsultaPDVPorCategoria(lista);
                return;
            }
            renderizarProdutosConsultaPDV(lista);
        },
        error: function (xhr) {
            console.error('Erro na consulta de produtos:', xhr.responseJSON || xhr.responseText || xhr);

            const msg = xhr.responseJSON?.error || 'Erro ao consultar produtos.';

            $('#resultadoConsultaProdutosPDV').html(`
                <div class="alert alert-danger">
                    ${msg}
                </div>
            `);
        }
    });
}

function nomeCategoriaProdutoConsulta(produto) {
    const bruto = produto && (produto.categoria_nome || produto.categoria);
    if (bruto && typeof bruto === 'object' && bruto.nome) {
        return String(bruto.nome).trim() || 'Sem categoria';
    }
    const nome = String(bruto || '').trim();
    return nome || 'Sem categoria';
}

function nomeExibicaoProdutoConsultaPdv(p) {
    if (typeof window.PdvBuscaProduto?.nomeExibicaoProdutoPdv === 'function') {
        return window.PdvBuscaProduto.nomeExibicaoProdutoPdv(p);
    }
    const nome = String(p?.nome || '').trim() || '-';
    const marca = String(p?.marca || p?.marca_nome || '').trim();
    if (!marca) return nome;
    const nomeNorm = nome.toLowerCase();
    const marcaNorm = marca.toLowerCase();
    if (nomeNorm === marcaNorm || nomeNorm.startsWith(`${marcaNorm} `)) return nome;
    return `${marca} ${nome}`;
}

function montarLinhaProdutoConsultaPDV(p) {
    const estoque = Number(pdvEstoqueDisponivel(p) || 0);
    const preco = Number(p.preco_venda || 0);
    const precoCompra = Number(p.preco_compra || 0);
    const estoqueBaixo = estoque <= Number(p.estoque_minimo || 0);
    const semEstoque = !pdvPodeIniciarInclusaoProduto(p).sucesso;
    const temPromocao = p.tem_promocao === 1 || p.tem_promocao === true;
    const precoPromocional = Number(p.preco_promocional || 0);
    const descontoPercentual = Number(p.desconto_percentual || 0);

    const precoExibido = temPromocao && precoPromocional > 0 ? precoPromocional : preco;
    const marcaPromocao = temPromocao ? `<span class="badge bg-danger ms-2"><i class="fas fa-tag"></i> -${descontoPercentual}%</span>` : '';
    const linhaDescontoPreco = temPromocao && precoPromocional > 0
        ? `<del class="text-muted small">${formatCurrency(preco)}</del> ${formatCurrency(precoPromocional)}`
        : formatCurrency(precoExibido);

    const rotuloEstoque = pdvRotuloEstoque(p);

    return `
            <tr ${temPromocao ? 'class="table-warning"' : ''}>
                <td>${p.id}</td>
                <td>
                    <strong>${escapeHtml(nomeExibicaoProdutoConsultaPdv(p))}</strong>${marcaPromocao}<br>
                    <small class="text-muted">
                        Código: ${escapeHtml(p.codigo || '-')} |
                        Barras: ${escapeHtml(p.codigo_barras || '-')}
                    </small>
                </td>
                <td>${escapeHtml(p.unidade || 'UN')}</td>
                <td>${formatCurrency(precoCompra)}</td>
                <td class="fw-bold ${temPromocao ? 'text-danger' : 'text-success'}">${linhaDescontoPreco}</td>
                <td>${formatarVendaUnidadeConsulta(p)}</td>
                <td>${formatarPrecoUnidadeConsulta(p)}</td>
                <td>
                    <span class="badge ${semEstoque ? 'bg-danger' : estoqueBaixo ? 'bg-warning text-dark' : 'bg-success'}" title="${escapeHtml(rotuloEstoque)}">
                        ${escapeHtml(rotuloEstoque)}
                    </span>
                </td>
                <td class="text-end">
                    <button
                        type="button"
                        class="btn btn-sm btn-success"
                        onclick="adicionarProdutoConsultaPDV(${p.id})"
                        title="${semEstoque ? 'Estoque da busca pode estar desatualizado — ao clicar será conferido no servidor' : 'Adicionar ao carrinho'}"
                    >
                        <i class="fas fa-cart-plus"></i> Adicionar
                    </button>
                </td>
            </tr>
        `;
}

function htmlTabelaProdutosConsultaPDV(produtos) {
    const linhas = produtos.map(montarLinhaProdutoConsultaPDV).join('');
    return `
        <div class="table-responsive">
            <table class="table table-sm table-hover align-middle">
                <thead class="table-light">
                    <tr>
                        <th>ID</th>
                        <th>Produto</th>
                        <th>Un.</th>
                        <th>Preço Compra</th>
                        <th>Preço Venda</th>
                        <th>Venda Unidade</th>
                        <th>Preço Unidade</th>
                        <th>Estoque</th>
                        <th class="text-end">Ação</th>
                    </tr>
                </thead>
                <tbody>
                    ${linhas}
                </tbody>
            </table>
        </div>
    `;
}

function renderizarProdutosConsultaPDVPorCategoria(produtos) {
    if (!produtos.length) {
        $('#resultadoConsultaProdutosPDV').html(`
            <div class="alert alert-warning">
                Nenhum produto encontrado.
            </div>
        `);
        return;
    }

    const grupos = new Map();
    produtos.forEach((p) => {
        const cat = nomeCategoriaProdutoConsulta(p);
        if (!grupos.has(cat)) grupos.set(cat, []);
        grupos.get(cat).push(p);
    });

    const nomes = Array.from(grupos.keys()).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    const html = nomes.map((cat, idx) => {
        const id = `consulta-grupo-${idx}`;
        return `
            <div class="card mb-2">
                <div class="card-header bg-light d-flex justify-content-between align-items-center">
                    <strong><i class="fas fa-folder me-2"></i>${escapeHtml(cat)}</strong>
                    <span class="badge bg-primary">${grupos.get(cat).length}</span>
                </div>
                <div class="card-body p-0" id="${id}">
                    ${htmlTabelaProdutosConsultaPDV(grupos.get(cat))}
                </div>
            </div>
        `;
    }).join('');

    $('#resultadoConsultaProdutosPDV').html(html);
}

function renderizarProdutosConsultaPDV(produtos) {
    if (!produtos.length) {
        $('#resultadoConsultaProdutosPDV').html(`
            <div class="alert alert-warning">
                Nenhum produto encontrado.
            </div>
        `);
        return;
    }

    $('#resultadoConsultaProdutosPDV').html(htmlTabelaProdutosConsultaPDV(produtos));
}

function atualizarDataHoraPdv() {
  const el = document.getElementById("dataHoraPdv");
  if (!el) return;

  const agora = new Date();
  el.textContent = agora.toLocaleString("pt-BR");
}

// Função para abrir fechamento de caixa
function abrirFechamentoCaixa() {
    if (typeof loadPage === 'function') {
        // Fecha o menu lateral se estiver aberto
        if (typeof fecharMenuPdv === 'function') {
            fecharMenuPdv();
        } else {
            document.body.classList.remove('menu-open');
        }
        // Sai do modo fullscreen do PDV antes de navegar
        if (typeof desativarPdvFullscreen === 'function') {
            desativarPdvFullscreen();
        }
        // Remove a classe do body
        document.body.classList.remove('pdv-mode');
        // Carrega a página de caixa
        loadPage('caixa');
        // Atualiza o menu ativo
        $('.nav-link').removeClass('active');
        $('.nav-link[data-page="caixa"]').addClass('active');
    } else {
        showNotification('Erro ao navegar para fechamento de caixa.', 'danger');
    }
}

document.addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById('statusCaixaPdv')) {
        return;
    }

    const busca = document.getElementById("buscaProdutoPdv");
    if (busca) {
        busca.focus();
    }

    if (typeof aplicarModoFiscalPdv === 'function') {
        aplicarModoFiscalPdv();
    }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "F2") {
    e.preventDefault();
    document.getElementById("buscaProdutoPdv")?.focus();
  }

  if (e.key === "F7") {
    e.preventDefault();
    abrirFechamentoCaixa();
  }

  // F10: tratado no keydown do PDV (btnFinalizarVendaPdv) para evitar disparo duplo

  if (e.key === "Escape") {
    e.preventDefault();
    // Se menu estiver aberto, fecha o menu
    if (document.body.classList.contains('menu-open')) {
      fecharMenuPdv();
    } else {
      document.getElementById("btnCancelarVendaPdv")?.click();
    }
  }
});

// PDV Fullscreen Mode
function ativarPdvFullscreen() {
  document.body.classList.add('pdv-mode');
}

function desativarPdvFullscreen() {
  document.body.classList.remove('pdv-mode');
}

function abrirMenuPdv() {
  document.body.classList.add('menu-open');
}

function fecharMenuPdv() {
  document.body.classList.remove('menu-open');
}

// Event listener para botão de menu
$(document).off('click.menuPdv').on('click.menuPdv', '#btnMenuPdv', function(e) {
  e.preventDefault();
  e.stopPropagation();
  abrirMenuPdv();
});

// Fechar menu ao clicar no overlay ou em um item do menu
$(document).off('click.fecharMenu').on('click.fecharMenu', function(e) {
  if (document.body.classList.contains('menu-open')) {
    // Se clicou no overlay (fora do menu) ou em um link do menu
    const clickedSidebar = $(e.target).closest('#sidebar').length > 0;
    const clickedMenuButton = $(e.target).closest('#btnMenuPdv').length > 0;

    if (!clickedSidebar && !clickedMenuButton) {
      fecharMenuPdv();
    }

    // Se clicou em um link do menu, fecha o menu e desativa fullscreen
    if ($(e.target).closest('.nav-link').length > 0) {
      fecharMenuPdv();
      const linkModulo = $(e.target).closest('a[data-modulo-externo]');
      if (!linkModulo.length) {
        desativarPdvFullscreen();
      }
    }
  }
});

// Ativar fullscreen quando carregar PDV
$(document).ready(function() {
  if (currentPage === 'pdv') {
    ativarPdvFullscreen();
  }
});

// Correção global para evitar aviso:
// "Blocked aria-hidden on an element because its descendant retained focus"
$(document).on('hide.bs.modal', '.modal', function () {
    if (document.activeElement && this.contains(document.activeElement)) {
        document.activeElement.blur();
    }
});

// Limpeza extra quando o modal terminar de fechar
$(document).on('hidden.bs.modal', '.modal', function () {
    $('.modal-backdrop').remove();

    if ($('.modal.show').length === 0) {
        $('body').removeClass('modal-open');
        $('body').css('padding-right', '');

        if (document.getElementById('modalNcmProdutoPdv')) return;
        if (typeof currentPage === 'undefined' || currentPage !== 'pdv' || !$('#buscaProdutoPdv').length) return;

        const Focus = window.UIFocusManager;
        const ativo = document.activeElement;
        if (Focus && typeof Focus.isEditingElement === 'function' && Focus.isEditingElement(ativo)) {
            if (ativo.id !== 'buscaProdutoPdv') return;
        }
        focarCampoCodigo({ limpar: false });
    }
});

async function verResumoVendaFiscalTEF(vendaId) {
    try {
        const response = await fetch(`${API_URL}/tef/venda/${vendaId}/resumo`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao buscar resumo da venda.');
        }

        const texto = `
VENDA INTERNA: #${data.venda_id}
NFC-e SEFAZ: ${data.nfce_numero ? '#' + data.nfce_numero : 'Não emitida'}
SITUAÇÃO FISCAL: ${data.nfce_situacao_fiscal || 'DESCONHECIDA'}
STATUS DA TENTATIVA: ${data.nfce_status || 'Não informado'}
CHAVE: ${data.nfce_chave || 'Não informada'}

TEF:
Adquirente: ${data.tef_adquirente || 'Não possui TEF'}
Bandeira: ${data.tef_bandeira || '-'}
NSU: ${data.tef_nsu || '-'}
Autorização: ${data.tef_autorizacao || '-'}
        `;

        alert(texto);

    } catch (error) {
        console.error('Erro resumo venda:', error);
        showNotification(error.message || 'Erro ao buscar resumo.', 'danger');
    }
}
