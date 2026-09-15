/**
 * Núcleo compartilhado entre CDS ERP e CDS PDV.
 */
const API_URL = (() => {
    if (typeof window.API_URL === 'string' && window.API_URL.trim() !== '') {
        return window.API_URL;
    }
    const resolved = `${window.location.origin}/api`;
    window.API_URL = resolved;
    return resolved;
})();

let currentPage = window.CDS_DEFAULT_PAGE || 'dashboard';
let chart = null;

function limparModaisTravados() {
    const temModalAberto = !!document.querySelector('.modal.show');
    if (temModalAberto) return;

    document.querySelectorAll('.modal-backdrop').forEach((el) => el.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
}

$(document).on('hidden.bs.modal', function () {
    limparModaisTravados();
});

setInterval(() => {
    const backdrop = document.querySelector('.modal-backdrop');
    if (backdrop && !document.querySelector('.modal.show')) {
        limparModaisTravados();
    }
}, 2000);

const MODO_FISCAL_PADRAO = '1'; // sistema sempre inicia com modo fiscal aberto

/** Estado de implantação — fail-closed até /recursos responder. */
let CONFIG_IMPLANTACAO = { recursos: {} };
window.CONFIG_IMPLANTACAO = CONFIG_IMPLANTACAO;

/**
 * Navegação do sidebar — delegação no document.
 * Sobrevive a detach/reattach de [data-recurso] (RC8) e evita menu “morto” no Electron
 * enquanto auth/recursos ainda carregam.
 */
function ligarNavegacaoSidebar() {
    $(document).off('click.cdsNav', '.nav-link[data-page]').on('click.cdsNav', '.nav-link[data-page]', function (e) {
        e.preventDefault();
        const page = $(this).data('page');
        if (!page || typeof loadPage !== 'function') return;
        loadPage(page);
        $('.nav-link').removeClass('active');
        $(this).addClass('active');
    });
    ligarAberturaModuloExterno();
}

/**
 * Abre ERP/PDV em outra janela para não perder venda em andamento.
 * Popup bloqueado → navega na mesma janela (a venda já foi persistida no PDV).
 */
function abrirModuloCdsEmOutraJanela(url, nomeJanela) {
    const destino = String(url || '').trim();
    if (!destino) return false;
    if (typeof persistirVendaAbertaPdv === 'function') {
        persistirVendaAbertaPdv();
    }
    const modulo = (nomeJanela === 'cds-pdv' || /\/pdv(\/|\?|$)/i.test(destino)) ? 'pdv' : 'erp';
    if (window.electronAPI && typeof window.electronAPI.abrirModuloApp === 'function') {
        Promise.resolve(window.electronAPI.abrirModuloApp({ url: destino, modulo: modulo })).catch(() => {
            window.location.href = destino;
        });
        return true;
    }
    let win = null;
    try {
        win = window.open(
            destino,
            nomeJanela || '_blank',
            'noopener=no,width=1280,height=800,left=0,top=0'
        );
    } catch (_) {
        win = null;
    }
    if (!win) {
        window.location.href = destino;
        return false;
    }
    try { win.focus(); } catch (_) { /* ignore */ }
    return true;
}

function ligarAberturaModuloExterno() {
    $(document).off('click.cdsModuloExterno', 'a[data-modulo-externo]').on(
        'click.cdsModuloExterno',
        'a[data-modulo-externo]',
        function (e) {
            e.preventDefault();
            e.stopPropagation();
            const url = this.getAttribute('href');
            const nome = this.getAttribute('data-modulo-externo') || '_blank';
            abrirModuloCdsEmOutraJanela(url, nome);
        }
    );
}

/** RC8.0.0 — páginas exclusivas do módulo fiscal (não renderizar / não navegar sem licença). */
const PAGINAS_MODULO_FISCAL = Object.freeze([
    'fiscal',
    'nfe-central',
    'nfe-avulsa',
    'nfe-monitor',
    'nfe-fila',
    'nfe-diagnostico',
    'central-contabil',
    'fechamento-fiscal-dia',
    'central-entradas',
    'central-diagnostico',
    'dfe-auditoria',
    'monitoring'
]);

/** Catálogo de pesquisa de navegação (telas). Itens fiscais só aparecem com fiscalHabilitado. */
const CATALOGO_PESQUISA_PAGINAS = Object.freeze([
    { page: 'dashboard', titulo: 'Dashboard', keywords: 'painel inicio home' },
    { page: 'monitoring', titulo: 'Central de Monitoramento', keywords: 'monitor fiscal indicadores sefaz', fiscal: true },
    { page: 'vendas', titulo: 'Histórico de Vendas', keywords: 'vendas histórico comercial' },
    { page: 'entregas', titulo: 'Entregas', keywords: 'entrega delivery', recurso: 'vendasEntrega' },
    { page: 'pedidos', titulo: 'Pedidos', keywords: 'pedido orçamento', recurso: 'pedidos' },
    { page: 'faturamento', titulo: 'Expedição', keywords: 'expedição expedir pedido liberação entrega comercial', recurso: 'expedicao' },
    { page: 'central-faturamento', titulo: 'Central de Faturamento', keywords: 'faturamento fiscal nf-e emitir checklist', fiscal: true, recurso: 'nfe' },
    { page: 'caixa', titulo: 'Fechamento de Caixa', keywords: 'caixa fechamento' },
    { page: 'produtos', titulo: 'Produtos', keywords: 'produto estoque' },
    { page: 'categorias', titulo: 'Categorias', keywords: 'categoria' },
    { page: 'compras', titulo: 'Compras', keywords: 'compra entrada' },
    { page: 'central-entradas', titulo: 'Central de Entradas', keywords: 'dfe xml manifestação destinatário', fiscal: true },
    { page: 'financeiro', titulo: 'Financeiro', keywords: 'receber pagar' },
    { page: 'clientes', titulo: 'Clientes', keywords: 'cliente' },
    { page: 'fornecedores', titulo: 'Fornecedores', keywords: 'fornecedor' },
    { page: 'fiscal', titulo: 'NFC-e Emitidas', keywords: 'nfc-e nfce nota consumidor emissão', fiscal: true },
    { page: 'nfe-central', titulo: 'Central NF-e', keywords: 'nf-e nfe nota fiscal emissão central documental', fiscal: true },
    { page: 'nfe-avulsa', titulo: 'Nova NF-e', keywords: 'nf-e nfe avulsa emitir nota fiscal', fiscal: true },
    { page: 'nfe-monitor', titulo: 'Monitor NF-e', keywords: 'monitor nf-e sefaz', fiscal: true },
    { page: 'nfe-fila', titulo: 'Fila NF-e', keywords: 'fila nf-e', fiscal: true },
    { page: 'nfe-diagnostico', titulo: 'Diagnóstico NF-e', keywords: 'diagnóstico nf-e', fiscal: true },
    { page: 'central-contabil', titulo: 'Central Contábil', keywords: 'contabilidade exportação zip xml contador escritório', fiscal: true },
    { page: 'fechamento-fiscal-dia', titulo: 'Fechamento Fiscal do Dia', keywords: 'fechamento fiscal dia maquineta nfc-e composição', fiscal: true, moduloFechamentoFiscalDia: true },
    { page: 'central-equipamentos', titulo: 'Central de Equipamentos', keywords: 'balança discovery identidade equipamentos central saúde', fiscal: false },
    { page: 'central-diagnostico', titulo: 'Saúde da Central', keywords: 'diagnóstico central fiscal', fiscal: true },
    { page: 'dfe-auditoria', titulo: 'Auditoria DF-e', keywords: 'dfe auditoria nsu sync dist sefaz suporte', fiscal: true },
    { page: 'configuracoes', titulo: 'Configurações', keywords: 'empresa configuração' },
    { page: 'usuarios', titulo: 'Usuários', keywords: 'usuário permissão' },
    { page: 'licenca', titulo: 'Assinatura CDS', keywords: 'licença assinatura' },
    { page: 'auditoria', titulo: 'Auditoria', keywords: 'auditoria log' },
    { page: 'configuracoes-avancadas', titulo: 'Centro de Configurações', keywords: 'avançadas certificado csc sefaz' },
    { page: 'mib-analytics', titulo: 'MIB Analytics', keywords: 'mib busca aprendizado fuzzy sinônimos analytics' },
    { page: 'enterprise-search', titulo: 'Enterprise Search', keywords: 'enterprise search mib providers sdk telemetria' },
    { page: 'knowledge-center', titulo: 'Knowledge Center', keywords: 'knowledge graph recomendações similaridade duplicados clusters mib' },
    { page: 'cip-insights', titulo: 'CIP Insights', keywords: 'cip intelligence insights forecast automação recomendações' },
    { page: 'cds-copiloto', titulo: 'CDS Copiloto', keywords: 'cia agent copiloto chat inteligência assistente' }
]);

const FAVORITOS_STORAGE_KEY = 'cds_favoritos_paginas';
const RECURSOS_DETACHED = (typeof window !== 'undefined' && (window.__CDS_RECURSOS_DETACHED = window.__CDS_RECURSOS_DETACHED || {})) || {};

function obterRecursosImplantacao() {
    return (CONFIG_IMPLANTACAO && CONFIG_IMPLANTACAO.recursos) || {};
}

/**
 * RC8.0.3 — critério único de licença para UI (não ler flags de config internas).
 * Expedição (comercial) é canônica; faturamento é alias de API legado do mesmo módulo.
 * Nunca consultar recursos.fiscal / nfe / nfce para decidir Expedição.
 */
function possuiRecurso(nome) {
    const r = obterRecursosImplantacao();
    const chave = String(nome || '');
    if (chave === 'expedicao' || chave === 'faturamento') {
        return r.expedicao === true || r.faturamento === true;
    }
    return r[chave] === true;
}

/** RC8.0.0 — verificação centralizada do módulo fiscal. */
function fiscalHabilitado() {
    return possuiRecurso('fiscal');
}

function implantacaoPermiteFiscal() {
    return fiscalHabilitado();
}

function implantacaoPermiteMultiCaixa() {
    return possuiRecurso('multiCaixa');
}

/** RC8.0.3 — Expedição contratada (menu/rota/pesquisa). Independente do módulo fiscal. */
function expedicaoHabilitada() {
    return possuiRecurso('expedicao');
}

/** Permitir Fechamento Fiscal do Dia (configuração, não licença). Padrão: oculto. */
function fechamentoFiscalDiaMenuPermitido() {
    return window.__cdsFechamentoFiscalDiaOn === true;
}

function aplicarVisibilidadeMenuFechamentoFiscalDia(on, opts = {}) {
    window.__cdsFechamentoFiscalDiaOn = Boolean(on);
    if (typeof filtrarMenuPorPermissoes === 'function') {
        filtrarMenuPorPermissoes();
    } else {
        const el = document.getElementById('nav-fechamento-fiscal-dia');
        if (el) {
            if (window.__cdsFechamentoFiscalDiaOn) {
                el.removeAttribute('hidden');
                el.style.display = '';
            } else {
                el.setAttribute('hidden', '');
                el.style.display = 'none';
            }
        }
    }
    if (
        !window.__cdsFechamentoFiscalDiaOn
        && opts.redirecionar !== false
        && currentPage === 'fechamento-fiscal-dia'
        && typeof loadPage === 'function'
    ) {
        loadPage('dashboard');
    }
}

async function hidratarMenuFechamentoFiscalDia() {
    window.__cdsFechamentoFiscalDiaOn = false;
    try {
        const response = await fetch(`${API_URL}/configuracoes/fechamento_fiscal_do_dia`, {
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token') || ''}`
            }
        });
        if (!response.ok) return;
        const data = await response.json().catch(() => ({}));
        window.__cdsFechamentoFiscalDiaOn = Boolean(data.permitido) || data.valor === 'ATIVADO';
    } catch (_) {
        window.__cdsFechamentoFiscalDiaOn = false;
    }
}

function paginaEhModuloFiscal(page) {
    return PAGINAS_MODULO_FISCAL.includes(String(page || ''));
}

/**
 * RC8.0.0 — remove do DOM (não apenas CSS) quando recurso OFF; restaura quando ON.
 */
function aplicarVisibilidadeRecursoDom(chave, on) {
    const selector = `[data-recurso="${chave}"]`;

    if (on) {
        const stash = RECURSOS_DETACHED[chave] || [];
        stash.forEach(({ parent, next, node }) => {
            if (!node || !parent || !parent.isConnected) return;
            try {
                if (next && next.parentNode === parent) parent.insertBefore(node, next);
                else parent.appendChild(node);
            } catch (e) { /* ignore */ }
        });
        RECURSOS_DETACHED[chave] = [];
        document.querySelectorAll(selector).forEach((el) => {
            el.removeAttribute('hidden');
            el.removeAttribute('aria-hidden');
            if (el.style && el.style.display === 'none') el.style.display = '';
        });
        document.body.classList.toggle(`modulo-${chave}`, true);
        return;
    }

    const nodes = Array.from(document.querySelectorAll(selector));
    if (!nodes.length) {
        document.body.classList.toggle(`modulo-${chave}`, false);
        return;
    }

    const prev = RECURSOS_DETACHED[chave] || [];
    const detached = nodes.map((node) => {
        const parent = node.parentNode;
        const next = node.nextSibling;
        if (parent) parent.removeChild(node);
        return { parent, next, node };
    });
    RECURSOS_DETACHED[chave] = prev.concat(detached);
    document.body.classList.toggle(`modulo-${chave}`, false);
}

async function carregarConfiguracaoImplantacao() {
    try {
        const response = await fetch(`${API_URL}/configuracoes-avancadas/recursos`, {
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!response.ok) {
            // RC8.0.2 — fail-closed: sem licença carregada, ocultar módulos licenciáveis
            CONFIG_IMPLANTACAO = { recursos: {} };
            window.CONFIG_IMPLANTACAO = CONFIG_IMPLANTACAO;
            aplicarRecursosImplantacao();
            return;
        }

        CONFIG_IMPLANTACAO = await response.json();
        window.CONFIG_IMPLANTACAO = CONFIG_IMPLANTACAO;
        aplicarRecursosImplantacao();
    } catch (error) {
        console.error('Erro ao carregar configuração de implantação:', error);
        CONFIG_IMPLANTACAO = { recursos: {} };
        window.CONFIG_IMPLANTACAO = CONFIG_IMPLANTACAO;
        aplicarRecursosImplantacao();
    }
}

function aplicarRecursosImplantacao() {
    const recursos = obterRecursosImplantacao();
    const expedicaoOn = possuiRecurso('expedicao');

    const mapa = [
        'fiscal', 'multiCaixa', 'vendasEntrega', 'nfe', 'nfce',
        'pdv', 'historicoVendas', 'pedidos', 'compraFacil', 'marketplace', 'crm'
    ];
    mapa.forEach((chave) => {
        aplicarVisibilidadeRecursoDom(chave, possuiRecurso(chave));
    });

    // RC8.0.3 — Expedição: só via recurso comercial (nunca fiscal / nfe / nfce)
    aplicarVisibilidadeRecursoDom('expedicao', expedicaoOn);
    aplicarVisibilidadeRecursoDom('faturamento', expedicaoOn);

    // Pedidos: se API ainda não enviar pedidos, herda expedição
    if (recursos.pedidos !== true && recursos.pedidos !== false && expedicaoOn) {
        aplicarVisibilidadeRecursoDom('pedidos', true);
    }

    // Histórico de Vendas: se API ainda não enviar, herda PDV
    if (recursos.historicoVendas !== true && recursos.historicoVendas !== false && possuiRecurso('pdv')) {
        aplicarVisibilidadeRecursoDom('historicoVendas', true);
    }

    if (window.PdvVendaEntrega && typeof window.PdvVendaEntrega.atualizarBotaoEntrega === 'function') {
        window.PdvVendaEntrega.atualizarBotaoEntrega();
    }

    if (!possuiRecurso('fiscal')) {
        localStorage.setItem('pdv_modo_fiscal_ativo', '0');
        limparFavoritosFiscais();
    }

    if (!expedicaoOn) {
        limparFavoritosExpedicao();
    }

    document.body.classList.toggle('implantacao-sem-fiscal', !possuiRecurso('fiscal'));
    document.body.classList.toggle('implantacao-fiscal', possuiRecurso('fiscal'));
    document.body.classList.toggle('implantacao-multicaixa', possuiRecurso('multiCaixa'));
    document.body.classList.toggle('modulo-expedicao', expedicaoOn);

    aplicarModoFiscalGlobal();
    if (typeof filtrarMenuPorPermissoes === 'function') {
        filtrarMenuPorPermissoes();
    }
    if (typeof ligarNavegacaoSidebar === 'function') {
        ligarNavegacaoSidebar();
    }
}

function paginaPermitidaPorImplantacao(page) {
    const p = String(page || '');

    if (p === 'fiscal') return possuiRecurso('nfce');
    if (p === 'nfe-central' || p === 'nfe-avulsa' || p === 'nfe-monitor' || p === 'nfe-fila' || p === 'nfe-diagnostico') {
        return possuiRecurso('nfe');
    }
    if (p === 'central-entradas' || p === 'central-diagnostico' || p === 'dfe-auditoria' || p === 'monitoring' || p === 'central-contabil' || p === 'f12-admin' || p === 'fechamento-fiscal-dia') {
        return fiscalHabilitado();
    }
    if (p === 'caixas' && !implantacaoPermiteMultiCaixa()) return false;
    if (p === 'entregas') return possuiRecurso('vendasEntrega');
    if (p === 'faturamento') return expedicaoHabilitada();
    if (p === 'pedidos') return possuiRecurso('pedidos');
    return true;
}

/**
 * RC8.0.0 — pesquisa de telas (global). Itens fiscais respeitam a licença.
 * @returns {{ page: string, titulo: string }[]}
 */
function pesquisarPaginasSistema(termo) {
    const q = String(termo || '').trim().toLowerCase();
    if (!q) return [];

    const fiscalOn = fiscalHabilitado();

    return CATALOGO_PESQUISA_PAGINAS.filter((item) => {
        if (item.fiscal && !fiscalOn) return false;
        if (item.moduloFechamentoFiscalDia && !fechamentoFiscalDiaMenuPermitido()) return false;
        if (item.recurso && !possuiRecurso(item.recurso)) return false;
        if (!paginaPermitidaPorImplantacao(item.page)) return false;
        const blob = `${item.titulo} ${item.keywords} ${item.page}`.toLowerCase();
        return blob.includes(q);
    }).map(({ page, titulo }) => ({ page, titulo }));
}

function lerFavoritosPaginas() {
    try {
        const raw = localStorage.getItem(FAVORITOS_STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.map(String) : [];
    } catch (e) {
        return [];
    }
}

function salvarFavoritosPaginas(lista) {
    try {
        localStorage.setItem(FAVORITOS_STORAGE_KEY, JSON.stringify(lista));
    } catch (e) { /* ignore */ }
}

/** Remove favoritos fiscais automaticamente quando o módulo não está contratado. */
function limparFavoritosFiscais() {
    const atual = lerFavoritosPaginas();
    const filtrado = atual.filter((page) => !paginaEhModuloFiscal(page));
    if (filtrado.length !== atual.length) {
        salvarFavoritosPaginas(filtrado);
    }
    return filtrado;
}

/** RC8.0.2 — remove favorito da página Expedição se o recurso não estiver licenciado. */
function limparFavoritosExpedicao() {
    const atual = lerFavoritosPaginas();
    const filtrado = atual.filter((page) => String(page) !== 'faturamento');
    if (filtrado.length !== atual.length) {
        salvarFavoritosPaginas(filtrado);
    }
    return filtrado;
}

function obterFavoritosPaginasPermitidos() {
    return lerFavoritosPaginas().filter((page) => {
        if (paginaEhModuloFiscal(page) && !fiscalHabilitado()) return false;
        if (String(page) === 'faturamento' && !expedicaoHabilitada()) return false;
        return paginaPermitidaPorImplantacao(page);
    });
}

function adicionarFavoritoPagina(page) {
    const p = String(page || '');
    if (!p) return false;
    if (paginaEhModuloFiscal(p) && !fiscalHabilitado()) return false;
    if (p === 'faturamento' && !expedicaoHabilitada()) return false;
    if (!paginaPermitidaPorImplantacao(p)) return false;
    const atual = obterFavoritosPaginasPermitidos();
    if (!atual.includes(p)) {
        atual.push(p);
        salvarFavoritosPaginas(atual);
    }
    return true;
}

function mensagemModuloNaoContratado(page) {
    if (String(page || '') === 'faturamento' && !expedicaoHabilitada()) {
        return 'Módulo não contratado.';
    }
    if (paginaEhModuloFiscal(page) || String(page || '').startsWith('nfe')) {
        return 'Módulo não contratado.';
    }
    return 'Este módulo não está habilitado para o tipo de implantação configurado.';
}

function modoFiscalAtivoSistema() {
    if (!implantacaoPermiteFiscal()) return false;
    if (typeof pdvUsaF12PolicyComoFonteOficial === 'function' && pdvUsaF12PolicyComoFonteOficial()) {
        if (typeof window !== 'undefined' && typeof window.__cdsF12EstadoEfetivo === 'boolean') {
            return window.__cdsF12EstadoEfetivo;
        }
    }
    return localStorage.getItem('pdv_modo_fiscal_ativo') === '1';
}

function aplicarModoFiscalGlobal() {
    const ativo = modoFiscalAtivoSistema();
    document.body.classList.toggle('modo-fiscal-ativo', ativo);

    const faixa = document.getElementById('faixaSistemaFiscalPdv');
    if (faixa) {
        const permiteFiscal = typeof implantacaoPermiteFiscal !== 'function' || implantacaoPermiteFiscal();
        faixa.style.display = permiteFiscal ? 'block' : 'none';
        faixa.classList.toggle('faixa-sistema-fiscal--ativo', !!ativo);
        faixa.classList.toggle('faixa-sistema-fiscal--off', !ativo);
        faixa.setAttribute('aria-label', ativo ? 'Sistema fiscal ativo' : 'Sistema fiscal inativo');
    }

    const tituloPdv = document.querySelector('.pdv-header-left span');
    if (tituloPdv) {
        tituloPdv.textContent = ativo
            ? 'PDV - Frente de Caixa Fiscal NFC-e'
            : 'PDV - Frente de Caixa';
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

let modoFiscalSyncInterval = null;
let modoFiscalSalvandoServidor = false;

function normalizarValorModoFiscal(valor) {
    return valor === true || valor === 'true' || valor === 1 || valor === '1' ? '1' : '0';
}

async function obterModoFiscalServidor() {
    if (!implantacaoPermiteFiscal()) {
        return '0';
    }

    try {
        const response = await fetch(`${API_URL}/configuracoes/modo_dashboard_fiscal`, {
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token') || ''}`
            }
        });

        if (!response.ok) {
            return null;
        }

        const data = await response.json();
        if (data && data.valor !== undefined && data.valor !== null) {
            return normalizarValorModoFiscal(data.valor);
        }
    } catch (error) {
        console.warn('Erro ao obter modo fiscal do servidor:', error);
    }

    return null;
}

async function salvarModoFiscalServidor(valor) {
    if (!implantacaoPermiteFiscal()) {
        return;
    }

    const normalizado = normalizarValorModoFiscal(valor);

    try {
        modoFiscalSalvandoServidor = true;
        await fetch(`${API_URL}/configuracoes/modo_dashboard_fiscal`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('token') || ''}`
            },
            body: JSON.stringify({ valor: normalizado })
        });
    } catch (error) {
        console.warn('Erro ao salvar modo fiscal no servidor:', error);
    } finally {
        modoFiscalSalvandoServidor = false;
    }
}

function aplicarModoFiscalLocal(valor, opcoes = {}) {
    const ehPdvF12 = typeof pdvUsaF12PolicyComoFonteOficial === 'function'
        && pdvUsaF12PolicyComoFonteOficial();

    // No PDV Express, só a resolução F12Policy pode alterar o estado efetivo.
    if (ehPdvF12 && implantacaoPermiteFiscal() && opcoes.origemF12 !== true) {
        console.warn('[F12] sincronização antiga ignorada — o estado efetivo do PDV vem do F12PolicyResolver.');
        return false;
    }

    const normalizado = normalizarValorModoFiscal(valor);
    const atual = localStorage.getItem('pdv_modo_fiscal_ativo');

    if (ehPdvF12 && opcoes.origemF12 === true && typeof window !== 'undefined') {
        window.__cdsF12EstadoEfetivo = normalizado === '1';
    }

    if (atual === normalizado && !opcoes.forcar) {
        aplicarModoFiscalGlobal();
        return false;
    }

    localStorage.setItem('pdv_modo_fiscal_ativo', normalizado);
    localStorage.setItem('modo_dashboard_fiscal', normalizado);
    aplicarModoFiscalGlobal();

    if (opcoes.recarregar !== false && typeof recarregarModulosModoFiscal === 'function') {
        recarregarModulosModoFiscal();
    } else if (opcoes.recarregar !== false && currentPage === 'vendas' && typeof loadVendas === 'function') {
        loadVendas();
    }

    return true;
}

function moduloAtualEhPdvExpress() {
    return typeof window !== 'undefined' && window.CDS_MODULE === 'pdv';
}

function moduloAtualEhErp() {
    return typeof window !== 'undefined' && window.CDS_MODULE === 'erp';
}

function moduloAtualUsaAtalhoF12() {
    return moduloAtualEhPdvExpress() || moduloAtualEhErp();
}

async function carregarModoFiscalInicial() {
    if (!implantacaoPermiteFiscal()) {
        aplicarModoFiscalLocal('0', { recarregar: false, forcar: true });
        return;
    }

    // Resolução Terminal → Caixa é exclusiva do PDV Express.
    if (moduloAtualEhPdvExpress() && typeof F12PolicyResolver !== 'undefined') {
        try {
            const resolucao = await obterCaixaAtualParaF12();
            if (!resolucao.ok || !resolucao.caixaId) {
                console.warn('[F12]', resolucao.erro || 'Não foi possível identificar o caixa atual.');
                throw new Error('caixa-nao-identificado');
            }
            const caixaId = resolucao.caixaId;
            const ativo = await F12PolicyResolver.resolveF12Estado(caixaId);
            // If backend could not be reached, resolveF12Estado returns null.
            // In that case, do not silently use localStorage — fallback to legacy flow.
            if (ativo === null || typeof ativo === 'undefined') {
                throw new Error('F12 backend indisponível');
            }
            const novoValor = ativo ? '1' : '0';
            aplicarModoFiscalLocal(novoValor, { recarregar: false, forcar: true, origemF12: true });
            return;
        } catch (err) {
            console.warn('[F12] Erro ao resolver F12 inicial via policy:', err);
            if (typeof pdvUsaF12PolicyComoFonteOficial === 'function' && pdvUsaF12PolicyComoFonteOficial()) {
                console.warn('[F12] mecanismo antigo não será usado como fonte do PDV.');
                return;
            }
            // Continua com fallback legado (ERP / módulos sem F12Policy)
        }
    }

    // Fallback legado: usado fora do PDV Express (dashboard/ERP).
    // F12 pode desligar na sessão; na próxima abertura volta ao padrão (aberto).
    aplicarModoFiscalLocal(MODO_FISCAL_PADRAO, { recarregar: false, forcar: true });
    await salvarModoFiscalServidor(MODO_FISCAL_PADRAO);
}

async function sincronizarEstadoF12Pdv(opcoes = {}) {
    if (!implantacaoPermiteFiscal() || typeof F12PolicyResolver === 'undefined') {
        return;
    }

    const resolucao = await obterCaixaAtualParaF12();
    if (!resolucao.ok || !resolucao.caixaId) {
        console.warn('[F12] sincronização: caixa não identificado — mecanismo antigo ignorado.');
        return;
    }

    const ativo = await F12PolicyResolver.resolveF12Estado(resolucao.caixaId);
    if (ativo === null || typeof ativo === 'undefined') {
        return;
    }

    const novoValor = ativo ? '1' : '0';
    const anteriorEfetivo = typeof window !== 'undefined' ? window.__cdsF12EstadoEfetivo : undefined;
    const estadoF12Mudou = typeof anteriorEfetivo === 'boolean' && anteriorEfetivo !== !!ativo;

    aplicarModoFiscalLocal(novoValor, {
        recarregar: estadoF12Mudou,
        origemF12: true
    });

    if (estadoF12Mudou && opcoes.notificar) {
        showNotification(
            ativo
                ? 'Modo fiscal ativado. Exibindo somente informações fiscais.'
                : 'Modo completo ativado. Exibindo fiscal, não fiscal e total.',
            'info'
        );
    }
}

async function sincronizarModoFiscalServidor(opcoes = {}) {
    if (typeof pdvUsaF12PolicyComoFonteOficial === 'function' && pdvUsaF12PolicyComoFonteOficial()) {
        return sincronizarEstadoF12Pdv(opcoes);
    }

    if (!implantacaoPermiteFiscal() || modoFiscalSalvandoServidor) {
        return;
    }

    const remoto = await obterModoFiscalServidor();
    if (remoto === null) {
        return;
    }

    const local = localStorage.getItem('pdv_modo_fiscal_ativo');
    if (local === remoto) {
        return;
    }

    // ERP + tela de produtos: o PDV (outra janela) compartilha localStorage do F12.
    // Remount/recarga agressiva apagava a busca e atrapalhava a edição.
    const erpNaTelaProdutos = typeof moduloAtualEhErp === 'function'
        && moduloAtualEhErp()
        && typeof currentPage !== 'undefined'
        && currentPage === 'produtos';

    const alterou = aplicarModoFiscalLocal(remoto, {
        recarregar: !erpNaTelaProdutos
    });

    if (erpNaTelaProdutos && alterou && typeof loadProdutos === 'function') {
        const modalAberto = typeof $ === 'function'
            && $('#produtoModal').length
            && ($('#produtoModal').hasClass('show') || $('#produtoModal').is(':visible'));
        const buscaEmFoco = typeof document !== 'undefined'
            && document.activeElement
            && document.activeElement.id === 'buscaProduto';
        loadProdutos({
            suave: true,
            somenteCache: !!(modalAberto || buscaEmFoco)
        });
    }

    if (alterou && opcoes.notificar && !erpNaTelaProdutos) {
        showNotification(
            remoto === '1'
                ? 'Modo fiscal ativado no servidor. PDV sincronizado.'
                : 'Modo completo ativado no servidor. PDV sincronizado.',
            'info'
        );
    }
}

function iniciarSincronizacaoModoFiscalServidor() {
    if (modoFiscalSyncInterval) {
        clearInterval(modoFiscalSyncInterval);
        modoFiscalSyncInterval = null;
    }

    if (!implantacaoPermiteFiscal()) {
        return;
    }

    const intervaloMs = window.CDS_MODULE === 'pdv' ? 3000 : 5000;

    modoFiscalSyncInterval = setInterval(() => {
        sincronizarModoFiscalServidor({ notificar: window.CDS_MODULE === 'pdv' });
    }, intervaloMs);
}

function alternarModoFiscalLegadoSessao() {
    const novoValor = modoFiscalAtivoSistema() ? '0' : '1';
    localStorage.setItem('pdv_modo_fiscal_ativo', novoValor);
    localStorage.setItem('modo_dashboard_fiscal', novoValor);
    aplicarModoFiscalGlobal();
    salvarModoFiscalServidor(novoValor);

    showNotification(
        novoValor === '1'
            ? 'Modo fiscal ativado. Exibindo somente informações fiscais.'
            : 'Modo completo ativado. Exibindo fiscal, não fiscal e total.',
        novoValor === '1' ? 'success' : 'info'
    );
}

function alternarModoFiscalGlobal() {
    if (!implantacaoPermiteFiscal()) {
        showNotification('Emissão fiscal desabilitada para o tipo de implantação configurado.', 'warning');
        return;
    }

    if (moduloAtualEhPdvExpress()) {
        if (typeof F12PolicyResolver !== 'undefined') {
            alternarModoFiscalComPolitica();
        }
        return;
    }

    if (moduloAtualEhErp()) {
        alternarModoFiscalLegadoSessao();
    }
}

async function obterCaixaAtualParaF12() {
    if (typeof F12PolicyResolver !== 'undefined' && typeof F12PolicyResolver.obterCaixaAtual === 'function') {
        return F12PolicyResolver.obterCaixaAtual();
    }
    if (typeof obterCaixaAtual === 'function') {
        return obterCaixaAtual();
    }
    console.warn('[F12] Não foi possível identificar o caixa atual.');
    return {
        ok: false,
        caixaId: null,
        erro: 'Não foi possível identificar o caixa atual.'
    };
}

// Nova função que respeita políticas de F12
async function alternarModoFiscalComPolitica() {
    if (!moduloAtualEhPdvExpress()) {
        return;
    }

    try {
        const resolucao = await obterCaixaAtualParaF12();
        if (!resolucao.ok || !resolucao.caixaId) {
            console.warn('[F12]', resolucao.erro || 'Não foi possível identificar o caixa atual.');
            showNotification(
                resolucao.erro || 'Terminal sem caixa vinculado. Vincule o terminal a um caixa para usar o F12.',
                'error'
            );
            return;
        }
        const caixaId = resolucao.caixaId;

        const contexto = typeof F12PolicyResolver.obterContexto === 'function'
            ? await F12PolicyResolver.obterContexto(caixaId)
            : null;

        // podeAlterar é decidido exclusivamente pelo backend. Sem bypass local por perfil.
        const podeAlterar = contexto && typeof contexto.podeAlterar === 'boolean'
            ? contexto.podeAlterar
            : false;

        if (!podeAlterar) {
            const controle = contexto && contexto.controle
                ? String(contexto.controle).toUpperCase()
                : '';
            let msg = 'O modo Fiscal / Não Fiscal deste caixa é controlado pelo administrador.';
            if (controle === 'OPERADOR') {
                msg = 'Não foi possível alterar o modo Fiscal / Não Fiscal. Verifique se o terminal está vinculado a um caixa.';
            } else if (!contexto) {
                msg = 'Não foi possível consultar a política F12. Verifique a conexão com o servidor.';
            }
            showNotification(msg, 'warning');
            return;
        }

        const result = await F12PolicyResolver.alternarF12(caixaId);
        
        if (result.success) {
            const novoValor = result.novoEstado ? '1' : '0';
            aplicarModoFiscalLocal(novoValor, { recarregar: false, origemF12: true });
            
            showNotification(
                result.novoEstado
                    ? 'Modo fiscal ativado. Exibindo somente informações fiscais.'
                    : 'Modo completo ativado. Exibindo fiscal, não fiscal e total.',
                'success'
            );
        } else {
            showNotification(
                result.error || 'Erro ao alterar F12',
                'error'
            );
        }
    } catch (err) {
        console.error('[F12] Erro ao alterar com política:', err);
        showNotification('Erro ao processar F12', 'error');
    }
}

if (typeof window !== 'undefined' && !window.__cdsF12TerminalListener) {
    window.__cdsF12TerminalListener = true;
    let f12CaixaResolvidoId = null;
    window.addEventListener('cds:terminal-registrado', async function () {
        if (!moduloAtualEhPdvExpress()) return;
        if (typeof F12PolicyResolver === 'undefined') return;
        if (typeof implantacaoPermiteFiscal === 'function' && !implantacaoPermiteFiscal()) return;
        try {
            const resolucao = await obterCaixaAtualParaF12();
            if (!resolucao.ok || !resolucao.caixaId) return;
            if (f12CaixaResolvidoId === resolucao.caixaId) return;
            const ativo = await F12PolicyResolver.resolveF12Estado(resolucao.caixaId);
            if (ativo === null || typeof ativo === 'undefined') return;
            f12CaixaResolvidoId = resolucao.caixaId;
            aplicarModoFiscalLocal(ativo ? '1' : '0', { recarregar: false, forcar: true, origemF12: true });
        } catch (err) {
            console.warn('[F12] Não foi possível aplicar o estado do caixa após identificar o terminal:', err);
        }
    });
}

function handleUnauthorized() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
}

function isErroSessaoExpirada(xhr) {
    if (!xhr) return false;
    if (xhr.status === 401) return true;

    if (xhr.status === 403) {
        const body = xhr.responseJSON || {};
        // Licença / módulo: NÃO tratar como sessão expirada
        if (body.erro === 'MODULO_NAO_LICENCIADO'
            || body.erro === 'LICENCA_VENCIDA'
            || body.erro === 'LICENCA_AUSENTE'
            || body.erro === 'DATA_ALTERADA'
            || body.erro === 'LICENCA_INVALIDA') {
            return false;
        }
        const mensagem = String(body.error || body.mensagem || '').toLowerCase();
        return (
            mensagem.includes('token') ||
            mensagem.includes('sessão') ||
            mensagem.includes('sessao') ||
            mensagem === 'acesso negado'
        );
    }

    return false;
}

function notificarErroLicenciamento(xhr) {
    if (!xhr || xhr.status !== 403) return false;
    const body = xhr.responseJSON || {};
    if (!body.erro) return false;
    const licencaErros = [
        'MODULO_NAO_LICENCIADO',
        'LICENCA_VENCIDA',
        'LICENCA_AUSENTE',
        'DATA_ALTERADA',
        'LICENCA_INVALIDA'
    ];
    if (!licencaErros.includes(body.erro)) return false;
    const msg = body.mensagem || body.error || 'Acesso não autorizado para este módulo.';
    if (typeof showNotification === 'function') {
        showNotification(msg, 'warning');
    }
    return true;
}

$(document).ajaxError(function (event, xhr, settings) {
    if (settings.global === false) return;
    if (isErroSessaoExpirada(xhr)) {
        handleUnauthorized();
        return;
    }
    notificarErroLicenciamento(xhr);
});

function renderSidebarBrandPadrao() {
    const brandContent = document.getElementById('sidebar-brand-content') || document.getElementById('sidebar-brand');
    if (!brandContent) return;

    const modulo = window.CDS_MODULE === 'pdv' ? 'PDV' : 'ERP';
    if (typeof BrandService !== 'undefined' && BrandService.htmlSidebarPadrao) {
        brandContent.innerHTML = BrandService.htmlSidebarPadrao(modulo);
    } else {
        brandContent.innerHTML = `
            <small class="text-muted">Inteligência para gerir, Tecnologia para crescer</small>
        `;
    }

    if (typeof atualizarBarraModoFiscalSidebar === 'function') {
        atualizarBarraModoFiscalSidebar();
    }
}

function normalizeLogoPath(logoPath) {
    const value = String(logoPath || '').trim();
    if (!value) return '';
    if (value.startsWith('/storage/')) return value;
    if (value.startsWith('storage/')) return `/${value}`;

    const normalized = value.replace(/\\/g, '/');
    const storageIndex = normalized.indexOf('/storage/');
    if (storageIndex !== -1) {
        return normalized.slice(storageIndex);
    }

    return value;
}

async function carregarLogoSidebar() {
    const brandContent = document.getElementById('sidebar-brand-content') || document.getElementById('sidebar-brand');
    if (!brandContent) return;

    try {
        const response = await fetch(`${API_URL}/configuracoes`, {
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!response.ok) {
            renderSidebarBrandPadrao();
            return;
        }

        const configuracoes = await response.json();
        const logoConfig = Array.isArray(configuracoes)
            ? configuracoes.find((config) => config.chave === 'logo' || config.chave === 'caminho_logomarca')
            : null;
        const rawLogoPath = logoConfig && logoConfig.valor ? String(logoConfig.valor).trim() : '';
        const logoPath = normalizeLogoPath(rawLogoPath);

        if (!logoPath) {
            renderSidebarBrandPadrao();
            return;
        }

        const logoUrl = logoPath.startsWith('/')
            ? `${API_URL.replace('/api', '')}${logoPath}`
            : logoPath;

        brandContent.innerHTML = `
            <img
                src="${logoUrl}"
                alt="Logo da empresa"
                class="img-fluid brand-sidebar-logo"
            >
        `;
    } catch (error) {
        console.error('Erro ao carregar logo da sidebar:', error);
        renderSidebarBrandPadrao();
    }

    if (typeof atualizarBarraModoFiscalSidebar === 'function') {
        atualizarBarraModoFiscalSidebar();
    }
}

function isScriptAlreadyLoaded(src) {
    return Array.from(document.scripts).some(script => script.src && script.src.endsWith(src));
}

function resolveModulePageUrl(url) {
    if (!url) return url;
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) {
        return url;
    }

    const module = window.CDS_MODULE || 'erp';
    const clean = url.replace(/^pages\//, '');
    return `/${module}/pages/${clean}`;
}

function carregarPaginaHtml(url, callback) {
    limparModaisTravados();
    const resolvedUrl = resolveModulePageUrl(url);

    $.get(resolvedUrl, function (html) {
        const $page = $('#page-content');
        const nodes = $.parseHTML(html, document, true);

        $page.empty();

        if (!nodes) {
            if (typeof callback === 'function') callback();
            return;
        }

        const inlineScripts = [];
        const pendingScripts = [];

        nodes.forEach(node => {
            if (node.nodeType === 1 && node.tagName.toLowerCase() === 'script') {
                if (node.src) {
                    const srcPath = node.getAttribute('src');
                    if (!isScriptAlreadyLoaded(srcPath)) {
                        pendingScripts.push(new Promise((resolve) => {
                            const script = document.createElement('script');
                            script.src = srcPath;
                            script.onload = resolve;
                            script.onerror = resolve;
                            document.body.appendChild(script);
                        }));
                    }
                } else {
                    inlineScripts.push(node.text || node.textContent || node.innerHTML || '');
                }
            } else {
                $page.append(node);
            }
        });

        inlineScripts.forEach(code => {
            if (code.trim()) {
                $.globalEval(code);
            }
        });

        const executarCallback = () => {
            if (typeof aplicarRecursosImplantacao === 'function') {
                aplicarRecursosImplantacao();
            }
            aplicarModoFiscalGlobal();
            if (typeof callback === 'function') callback();
            aplicarModoFiscalGlobal();
        };

        if (pendingScripts.length === 0) {
            executarCallback();
        } else {
            Promise.all(pendingScripts).then(executarCallback);
        }
    }).fail(function () {
        $('#page-content').html('<div class="alert alert-danger">Erro ao carregar a página solicitada.</div>');
    });
}

function filtrarMenuPorPermissoes() {
    $('.nav-link[data-page]').each(function () {
        const page = $(this).data('page');
        const $item = $(this).closest('li.nav-item');
        const recursoItem = $item.attr('data-recurso');

        // Assinatura sempre visível — renovação não pode depender de ACL/menu bloqueado.
        if (page === 'licenca') {
            $item.show();
            return;
        }

        // RC8.0.2 — visibilidade só por licença (possuiRecurso); PDV herda true se indefinido
        if (recursoItem) {
            const licenciado = recursoItem === 'pdv'
                ? (possuiRecurso('pdv') || obterRecursosImplantacao().pdv !== false)
                : possuiRecurso(recursoItem);
            if (!licenciado) {
                $item.hide();
                return;
            }
        }

        if (!paginaPermitidaPorImplantacao(page)) {
            $item.hide();
            return;
        }

        if (page === 'fechamento-fiscal-dia' && !fechamentoFiscalDiaMenuPermitido()) {
            $item.hide();
            $item.attr('hidden', 'hidden');
            return;
        }

        if (!usuarioTemPermissao(page)) {
            $item.hide();
            return;
        }

        $item.show();
        if (page === 'fechamento-fiscal-dia') {
            $item.removeAttr('hidden');
        }
    });

    $('#nav-config-avancadas').toggle(isSuperAdminUser());
    $('#nav-observabilidade').toggle(isSuperAdminUser());
    $('#nav-mib-analytics').toggle(isSuperAdminUser());
    $('#nav-enterprise-search').toggle(isSuperAdminUser());
    $('#nav-knowledge-center').toggle(isSuperAdminUser());
    $('#nav-cip-insights').toggle(isSuperAdminUser());
    $('#nav-cds-copiloto').toggle(isSuperAdminUser());
    const pdvLicenciado = possuiRecurso('pdv') || obterRecursosImplantacao().pdv !== false;
    $('#nav-abrir-pdv').toggle(window.CDS_MODULE === 'erp' && podeAbrirPDV() && pdvLicenciado);
    $('#nav-config-rede-pdv').toggle(window.CDS_MODULE === 'pdv' && isSuperAdminUser());
    $('#nav-nome-terminal-pdv').toggle(window.CDS_MODULE === 'pdv' && isSuperAdminUser());
    $('#nav-abrir-erp').toggle(
        window.CDS_MODULE === 'pdv' &&
        typeof podeAbrirERP === 'function' &&
        podeAbrirERP(obterUsuarioLogado())
    );

    // UX-A: ocultar grupos sem itens visíveis (ACL/implantação inalteradas)
    if (typeof atualizarVisibilidadeGruposMenu === 'function') {
        atualizarVisibilidadeGruposMenu();
    }
}

/**
 * UX-A — Esconde seções do sidebar quando nenhum filho está visível.
 * Placeholder de Relatórios permanece visível.
 */
function atualizarVisibilidadeGruposMenu() {
    $('.nav-group').each(function () {
        const $group = $(this);
        if ($group.attr('hidden') || $group.attr('aria-hidden') === 'true') {
            $group.hide();
            return;
        }
        if ($group.data('placeholder')) {
            $group.hide();
            return;
        }

        const $itens = $group.find('> .nav-group-items > .nav-item');
        let visiveis = 0;
        $itens.each(function () {
            if ($(this).css('display') !== 'none' && $(this).is(':visible')) {
                visiveis += 1;
            }
        });

        // :visible pode falhar se ancestral oculto — usar display do próprio item
        if (visiveis === 0) {
            visiveis = $itens.filter(function () {
                return this.style.display !== 'none' && $(this).css('display') !== 'none';
            }).length;
        }

        $group.toggle(visiveis > 0);
    });
}

/**
 * UX-A — Recolher / expandir sidebar (somente visual).
 */
function inicializarSidebarToggle() {
    const $btn = $('#sidebar-toggle');
    if (!$btn.length) return;

    const KEY = 'cds_erp_sidebar_collapsed';
    try {
        if (localStorage.getItem(KEY) === '1') {
            document.body.classList.add('sidebar-collapsed');
        }
    } catch (e) { /* ignore */ }

    const syncIcon = () => {
        const collapsed = document.body.classList.contains('sidebar-collapsed');
        $btn.find('i').attr('class', collapsed ? 'fas fa-angles-right' : 'fas fa-angles-left');
        $btn.attr('title', collapsed ? 'Expandir menu' : 'Recolher menu');
        $btn.attr('aria-label', collapsed ? 'Expandir menu' : 'Recolher menu');
    };
    syncIcon();

    $btn.off('click.cdsSidebar').on('click.cdsSidebar', function () {
        document.body.classList.toggle('sidebar-collapsed');
        const collapsed = document.body.classList.contains('sidebar-collapsed');
        try {
            localStorage.setItem(KEY, collapsed ? '1' : '0');
        } catch (e) { /* ignore */ }
        syncIcon();
    });
}

function formatCurrency(value) {
    if (value === undefined || value === null || Number.isNaN(Number(value))) value = 0;
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(Number(value));
}

function formatDate(date) {
    if (!date) return '';
    const texto = String(date).trim();
    const matchData = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (matchData) {
        return `${matchData[3]}/${matchData[2]}/${matchData[1]}`;
    }
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? texto : d.toLocaleDateString('pt-BR');
}

function formatDateTime(dateString) {
    if (!dateString) return '-';
    const data = new Date(dateString);
    return Number.isNaN(data.getTime())
        ? dateString
        : data.toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
}

function formatarDataHoraBR(dataHora) {
    if (!dataHora) return '-';
    const [data, hora] = dataHora.split(' ');
    const [ano, mes, dia] = data.split('-');
    return `${dia}/${mes}/${ano} ${hora}`;
}

function formatarCNPJ(cnpj) {
    if (!cnpj) return '';
    const numeros = String(cnpj).replace(/\D/g, '');
    if (numeros.length !== 14) return cnpj;
    return numeros.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function formatarCPF(cpf) {
    if (!cpf) return '';
    const numeros = String(cpf).replace(/\D/g, '');
    if (numeros.length !== 11) return cpf;
    return numeros.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function formatarCpfCnpj(valor) {
    if (!valor) return '';
    const numeros = String(valor).replace(/\D/g, '');
    if (numeros.length === 11) return formatarCPF(numeros);
    if (numeros.length === 14) return formatarCNPJ(numeros);
    return valor;
}

function formatCpfCnpjInput(input) {
    let value = input.value.replace(/\D/g, '');
    if (value.length <= 11) {
        value = value.replace(/(\d{3})(\d)/, '$1.$2');
        value = value.replace(/(\d{3})(\d)/, '$1.$2');
        value = value.replace(/(\d{3})(\d)/, '$1-$2');
    } else {
        value = value.replace(/(\d{2})(\d)/, '$1.$2');
        value = value.replace(/(\d{3})(\d)/, '$1.$2');
        value = value.replace(/(\d{3})(\d)/, '$1/$2');
        value = value.replace(/(\d{4})(\d)/, '$1-$2');
    }
    input.value = value;
}

function showNotification(mensagem, tipo = 'success') {
    const container = document.getElementById('notification-container');
    if (!container) {
        console.warn('[CDS] notification-container ausente:', mensagem);
        return;
    }

    const tom = ({ error: 'danger', erro: 'danger', ok: 'success', info: 'info', warning: 'warning', warn: 'warning', danger: 'danger', success: 'success' })[tipo] || tipo || 'success';
    const id = `notif-${Date.now()}`;
    const alert = document.createElement('div');
    alert.id = id;
    alert.className = `alert alert-${tom} alert-dismissible fade show`;
    alert.style.pointerEvents = 'auto';
    alert.innerHTML = `
        ${mensagem}
        <button type="button" class="btn-close" onclick="fecharNotificacao('${id}')"></button>
    `;

    container.appendChild(alert);
    setTimeout(() => fecharNotificacao(id), 3000);
}

/** Alias oficial RC4.3.1 — feedback unificado (substitui alert/toast ad-hoc). */
function mostrarToastCentral(mensagem, tipo = 'info') {
    showNotification(mensagem, tipo);
}

function fecharNotificacao(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
}

function logout() {
    if (confirm('Tem certeza que deseja sair?')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
    }
}

/** Aplica identidade visual oficial (Branding 1.0) nos elementos data-brand. */
function aplicarIdentidadeVisualCds() {
    if (typeof BrandService === 'undefined') return;

    BrandService.aplicarFavicon();

    document.querySelectorAll('[data-brand="nome"]').forEach((el) => {
        el.textContent = BrandService.NOME;
    });
    document.querySelectorAll('[data-brand="slogan"]').forEach((el) => {
        el.innerHTML = BrandService.SLOGAN.replace(', ', ',<br>');
    });
    document.querySelectorAll('[data-brand="copyright"]').forEach((el) => {
        el.textContent = BrandService.NOME;
    });

    const pdvTitle = document.getElementById('pdvBrandTitle');
    if (pdvTitle) pdvTitle.textContent = BrandService.NOME_DISPLAY;
}

function inicializarShellModulo(options = {}) {
    let defaultPage = options.defaultPage || currentPage;

    try {
        const params = new URLSearchParams(window.location.search);
        const pageQuery = String(params.get('page') || '').trim();
        if (pageQuery === 'licenca') {
            defaultPage = 'licenca';
        }
    } catch (e) { /* ignore */ }

    if (!localStorage.getItem('token')) {
        window.location.href = '/login';
        return;
    }

    if (redirecionarSeModuloNegado(window.CDS_MODULE)) {
        return;
    }

    aplicarIdentidadeVisualCds();
    ligarNavegacaoSidebar();

    const user = obterUsuarioLogado();
    $('#user-nome').text(user.nome || user.username || 'Usuário');
    $('#user-perfil').text(
        isUsuarioCaixa(user) ? 'Caixa' :
        user.role === 'admin' ? 'Administrador' : 'Operador'
    );

    $.ajaxSetup({
        beforeSend: function (xhr, settings) {
            if (settings.url && !settings.url.includes('/api/')) return;
            const token = localStorage.getItem('token');
            if (token) {
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            }
        }
    });

    $.ajax({
        url: `${API_URL}/auth/verificar`,
        method: 'POST',
        success: function () {
            carregarConfiguracaoImplantacao().finally(async function () {
                await carregarModoFiscalInicial();
                await hidratarMenuFechamentoFiscalDia();
                iniciarSincronizacaoModoFiscalServidor();

                if (implantacaoPermiteFiscal() && moduloAtualUsaAtalhoF12()) {
                    $(document).off('keydown.modoFiscalF12').on('keydown.modoFiscalF12', function (e) {
                        if (e.key === 'F12') {
                            e.preventDefault();
                            e.stopImmediatePropagation();
                            alternarModoFiscalGlobal();
                            return false;
                        }
                    });
                }

                carregarLogoSidebar();
                filtrarMenuPorPermissoes();
                ligarNavegacaoSidebar();
                if (typeof inicializarSidebarToggle === 'function') {
                    inicializarSidebarToggle();
                }

                currentPage = defaultPage;
                $('.nav-link').removeClass('active');
                $(`.nav-link[data-page="${defaultPage}"]`).addClass('active');
                loadPage(defaultPage);
            });
        },
        error: function () {
            handleUnauthorized();
        }
    });
}

window.produtoUsaConversaoUnidades = function produtoUsaConversaoUnidades(produto) {
    if (!produto) return false;
    return Number(produto.produto_fracionado ?? produto.vendido_por_peso ?? 0) === 1;
};

window.aplicarIdentidadeVisualCds = aplicarIdentidadeVisualCds;

window.fiscalHabilitado = fiscalHabilitado;
window.possuiRecurso = possuiRecurso;
window.expedicaoHabilitada = expedicaoHabilitada;
window.fechamentoFiscalDiaMenuPermitido = fechamentoFiscalDiaMenuPermitido;
window.aplicarVisibilidadeMenuFechamentoFiscalDia = aplicarVisibilidadeMenuFechamentoFiscalDia;
window.implantacaoPermiteFiscal = implantacaoPermiteFiscal;
window.implantacaoPermiteMultiCaixa = implantacaoPermiteMultiCaixa;
window.obterRecursosImplantacao = obterRecursosImplantacao;
window.paginaPermitidaPorImplantacao = paginaPermitidaPorImplantacao;
window.paginaEhModuloFiscal = paginaEhModuloFiscal;
window.aplicarRecursosImplantacao = aplicarRecursosImplantacao;
window.pesquisarPaginasSistema = pesquisarPaginasSistema;
window.obterFavoritosPaginasPermitidos = obterFavoritosPaginasPermitidos;
window.adicionarFavoritoPagina = adicionarFavoritoPagina;
window.limparFavoritosFiscais = limparFavoritosFiscais;
window.limparFavoritosExpedicao = limparFavoritosExpedicao;
window.mensagemModuloNaoContratado = mensagemModuloNaoContratado;
window.PAGINAS_MODULO_FISCAL = PAGINAS_MODULO_FISCAL;
window.ligarNavegacaoSidebar = ligarNavegacaoSidebar;
window.abrirModuloCdsEmOutraJanela = abrirModuloCdsEmOutraJanela;
window.ligarAberturaModuloExterno = ligarAberturaModuloExterno;
window.inicializarShellModulo = inicializarShellModulo;

/** @deprecated Alias legado — use produtoUsaConversaoUnidades */
window.produtoEhFracionado = window.produtoUsaConversaoUnidades;

$.ajaxSetup({
    beforeSend: function (xhr, settings) {
        if (settings.url && !settings.url.includes('/api/')) return;
        const token = localStorage.getItem('token');
        if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }
    }
});
