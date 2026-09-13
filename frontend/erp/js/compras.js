let produtosCompraList = [];
let fornecedoresList = [];
let itensCompraAtual = [];
/**
 * RC8.4.1 — Arquitetura Draft:
 * É PROIBIDO mutar objetos dentro de itensCompraAtual.
 * Toda edição ocorre em itemDraftCompra; só no commit o array é substituído.
 */
let itemDraftCompra = null;
/** índice visual (cache); fonte da verdade = linhaIdEditandoCompra */
let indiceEditandoCompra = null;
let linhaIdEditandoCompra = null;
let compraImportadaXml = null;
let cnpjEmitenteXmlOriginal = null;
let centralDocumentoIdAtual = null;
/** RC4.31.16 — origem do lançamento (MANUAL | CENTRAL_NFE) */
let origemCompraAtual = 'MANUAL';
let modoEntradaF7Compra = false;
let tipoEntradaCompraAtual = 'REVENDA';
let pendenciaPoliticaEntradaPayload = null;
let classificacaoEntradaAtual = null;
/** RC8.5.0 / RC8.5.2 — grade de parcelas da compra (editável) */
let parcelasCompraGrade = [];
let parcelasCompraEditadasManual = false;
/** RC4.31.14 — parcelas importadas da NF-e; proíbe regeneração automática de vencimentos */
let parcelasImportadasXml = false;
/** BUG3 — adia re-render enquanto o usuário digita em type="date" */
let compraRenderItensAgendado = null;
let compraParcelasRegenerarAgendado = null;

/**
 * RC8.4.1 — deep clone obrigatório (structuredClone).
 * Nunca shallow { ...obj } quando há nested (miip_*, embalagem, impostos…).
 */
function clonarDadosItemCompra(item) {
    if (item == null) return item;
    try {
        if (typeof structuredClone === 'function') {
            return structuredClone(item);
        }
    } catch {
        /* fallback JSON */
    }
    return JSON.parse(JSON.stringify(item));
}

function clonarNestedMiipItemCompra(valor) {
    if (valor == null || typeof valor !== 'object') return valor || null;
    return clonarDadosItemCompra(valor);
}

const MIIP_MOTOR_LABELS_COMPRA = Object.freeze({
    motor_gtin: 'GTIN / Código de Barras',
    motor_associacao_fornecedor: 'Associação Fornecedor',
    motor_mubc: 'Busca Universal (MUBC)',
    motor_similarity: 'Similaridade'
});

/** RC4.31.2 — espelha MiipImportacaoXmlService.paraSugestaoUi no frontend. */
function montarSugestaoMiipCompraFromResultado(resultado) {
    if (!resultado?.precisaConfirmacao || !resultado.produtoEncontrado?.id) return null;
    const motor = resultado.motor;
    return {
        indice: resultado.indice,
        encontrado: true,
        produtoId: Number(resultado.produtoEncontrado.id),
        produtoNome: resultado.produtoEncontrado.nome || '',
        produtoCodigo: resultado.produtoEncontrado.codigo || '',
        codigoBarras: resultado.produtoEncontrado.codigoBarras
            || resultado.produtoEncontrado.codigo_barras
            || null,
        confianca: resultado.nivelCerteza || resultado.confianca || 'NENHUMA',
        motor,
        motorLabel: MIIP_MOTOR_LABELS_COMPRA[motor] || motor || 'MIIP',
        score: resultado.score,
        acao: resultado.acao,
        operacaoId: resultado.operacaoId,
        status: 'pendente'
    };
}

function extrairProdutoIdSugestaoMiip(sugestao, item = null) {
    const id = Number(
        sugestao?.produtoId
        ?? sugestao?.produto_id
        ?? sugestao?.produtoEncontrado?.id
        ?? item?.miip_resultado?.produtoEncontrado?.id
    );
    return Number.isFinite(id) && id > 0 ? id : null;
}

function obterSugestaoMiipItemCompra(item) {
    if (!item) return null;
    if (item.miip_sugestao && extrairProdutoIdSugestaoMiip(item.miip_sugestao, item)) {
        return item.miip_sugestao;
    }
    return montarSugestaoMiipCompraFromResultado(item.miip_resultado);
}

function gerarLinhaIdCompra() {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
        /* ignore */
    }
    return `linha_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function obterLinhaIdItemCompra(item) {
    return item?.linha_id || item?.linhaId || null;
}

function encontrarIndiceItemCompraPorLinhaId(linhaId) {
    if (!linhaId) return -1;
    return itensCompraAtual.findIndex((it) => obterLinhaIdItemCompra(it) === linhaId);
}

/**
 * Substitui item no array por linhaId (ou índice fallback).
 * Sempre grava clone normalizado — nunca a mesma referência do draft.
 */
function commitItemCompraNoArray(itemNormalizado, { linhaId = null, indice = null } = {}) {
    const pronto = normalizeItemCompra(clonarDadosItemCompra(itemNormalizado));
    const idAlvo = linhaId || obterLinhaIdItemCompra(pronto);
    let idx = idAlvo ? encontrarIndiceItemCompraPorLinhaId(idAlvo) : -1;
    if (idx < 0 && indice != null && indice >= 0 && indice < itensCompraAtual.length) {
        idx = indice;
    }
    if (idx >= 0) {
        itensCompraAtual[idx] = pronto;
        return idx;
    }
    itensCompraAtual.push(pronto);
    return itensCompraAtual.length - 1;
}

/**
 * Atualização imutável de uma linha existente (MIIP / checkbox / etc.).
 * mutator recebe um DRAFT e deve mutar só ele.
 */
function atualizarItemCompraImutavel(linhaIdOuIndice, mutator) {
    let idx = typeof linhaIdOuIndice === 'number'
        ? linhaIdOuIndice
        : encontrarIndiceItemCompraPorLinhaId(linhaIdOuIndice);
    if (idx < 0 || !itensCompraAtual[idx]) return null;
    const draft = clonarDadosItemCompra(itensCompraAtual[idx]);
    mutator(draft);
    itensCompraAtual[idx] = normalizeItemCompra(draft);
    return itensCompraAtual[idx];
}

function limparDraftCompra() {
    itemDraftCompra = null;
    indiceEditandoCompra = null;
    linhaIdEditandoCompra = null;
    modoEntradaF7Compra = false;
}

function iniciarDraftCompraNovo() {
    itemDraftCompra = normalizeItemCompra({
        linha_id: gerarLinhaIdCompra(),
        quantidade: 1,
        atualizar_preco_venda: 1
    });
    indiceEditandoCompra = null;
    linhaIdEditandoCompra = null;
    return itemDraftCompra;
}

function iniciarDraftCompraEdicao(indexOuLinhaId) {
    let idx = typeof indexOuLinhaId === 'number'
        ? indexOuLinhaId
        : encontrarIndiceItemCompraPorLinhaId(indexOuLinhaId);
    const original = itensCompraAtual[idx];
    if (!original) return null;
    itemDraftCompra = normalizeItemCompra(clonarDadosItemCompra(original));
    if (!obterLinhaIdItemCompra(itemDraftCompra)) {
        itemDraftCompra.linha_id = gerarLinhaIdCompra();
    }
    indiceEditandoCompra = idx;
    linhaIdEditandoCompra = obterLinhaIdItemCompra(itemDraftCompra);
    return itemDraftCompra;
}

/** Sincroniza campos do formulário compartilhado → itemDraft (formação de preço). */
function sincronizarDraftCompraDoFormulario(extras = {}) {
    if (!itemDraftCompra) {
        iniciarDraftCompraNovo();
    }
    const draft = itemDraftCompra;
    draft.produto_id = $('#produto_id_item').val() || draft.produto_id || '';
    draft.produto_nome = ($('#codigo_barras_item').val() || '').trim() || draft.produto_nome || '';
    draft.quantidade = Number($('#quantidade_item').val() || draft.quantidade || 0);
    draft.quantidade_fiscal = Number($('#quantidade_fiscal_item').val() || draft.quantidade_fiscal || 0);
    draft.quantidade_nao_fiscal = Number($('#quantidade_nao_fiscal_item').val() || draft.quantidade_nao_fiscal || 0);
    draft.margem_lucro = Number($('#margem_padrao_item').val() || draft.margem_lucro || 0);
    draft.preco_venda_sugerido = Number($('#preco_venda_item').val() || draft.preco_venda_sugerido || 0);
    draft.data_validade = $('#data_validade_item').val() || null;
    draft.compra_em = $('#compra_em_item').val() || draft.compra_em || '';
    draft.quantidade_embalagens = Number($('#quantidade_embalagens_item').val() || draft.quantidade_embalagens || 0);
    draft.quantidade_por_embalagem = Number($('#quantidade_por_embalagem_item').val() || draft.quantidade_por_embalagem || 0);

    // RC4.31.29 — no MUC, #preco_item é unitário comercial; não sobrescrever preco_unitario (custo/MT)
    if (obterModoPainelEmbalagemCompra(obterProdutoSelecionadoCompra())) {
        const comercialForm = obterPrecoUnitarioComercialFormularioMuc();
        if (comercialForm > 0) {
            draft.preco_unitario_comercial = comercialForm;
        }
        draft.valor_total_embalagem = Number(
            obterValorTotalCompraMuc() || draft.valor_total_embalagem || 0
        );
        const custoMuc = numeroPositivoCompra(ultimaSimulacaoMucCompra?.custoUnitario);
        if (custoMuc != null) {
            draft.preco_unitario = custoMuc;
        } else if (!(numeroPositivoCompra(draft.preco_unitario) != null)) {
            const rawPreco = $('#preco_item').val();
            const nPreco = rawPreco === '' || rawPreco == null ? null : Number(rawPreco);
            if (Number.isFinite(nPreco) && nPreco > 0) {
                draft.preco_unitario = nPreco;
            }
        }
    } else {
        const rawPreco = $('#preco_item').val();
        if (rawPreco !== '' && rawPreco != null) {
            const nPreco = Number(rawPreco);
            if (Number.isFinite(nPreco) && nPreco > 0) {
                draft.preco_unitario = nPreco;
            }
        }
    }
    Object.assign(draft, extras);
    return draft;
}

/** Formação de preço exclusivamente sobre o draft. */
function recalcularFormacaoPrecoDraftCompra(origem = 'custo') {
    if (!itemDraftCompra) return;
    const draft = itemDraftCompra;
    draft.preco_unitario = Number(draft.preco_unitario || 0);
    draft.margem_lucro = Number(draft.margem_lucro || 0);
    draft.preco_venda_sugerido = Number(draft.preco_venda_sugerido || 0);

    if (origem === 'margem' || origem === 'custo' || origem === 'embalagem') {
        draft.preco_venda_sugerido = Number(
            (draft.preco_unitario * (1 + draft.margem_lucro / 100)).toFixed(2)
        );
    } else if (origem === 'venda') {
        draft.margem_lucro = draft.preco_unitario > 0
            ? Number((((draft.preco_venda_sugerido - draft.preco_unitario) / draft.preco_unitario) * 100).toFixed(2))
            : 0;
    }

    if (Number(draft.quantidade_por_embalagem || 0) > 0 && Number(draft.preco_venda_sugerido || 0) > 0) {
        draft.valor_embalagem_venda = Number(
            (draft.preco_venda_sugerido * Number(draft.quantidade_por_embalagem)).toFixed(2)
        );
    }
}

const TIPOS_ENTRADA_COMPRA = Object.freeze({
    REVENDA: 'REVENDA',
    INDUSTRIALIZACAO: 'INDUSTRIALIZACAO',
    USO_CONSUMO: 'USO_CONSUMO',
    BONIFICACAO: 'BONIFICACAO'
});

const ORIGEM_COMPRA = Object.freeze({
    MANUAL: 'MANUAL',
    CENTRAL_NFE: 'CENTRAL_NFE'
});

/** RC4.31.26 — fallback do lançamento quando não há margem cadastrada (não usar 30%) */
const MARGEM_PADRAO_FALLBACK_COMPRA = 35;

const ORIGEM_BASE_COMERCIAL_COMPRA = Object.freeze({
    ULTIMA_COMPRA: 'ultima_compra',
    CADASTRO: 'cadastro',
    PADRAO: 'padrao',
    ITEM: 'item'
});

/** RC4.31.27 — origem do cadastro de produto aberto a partir de Compras */
const ORIGEM_CADASTRO_PRODUTO = Object.freeze({
    COMPRA: 'COMPRA'
});

/** Cache em memória: produtoId → última compra (ou null) */
const cacheUltimaCompraProduto = Object.create(null);
let seqAplicacaoComercialCompra = 0;
/** RC4.31.26 — operador alterou Margem % manualmente no formulário */
let margemInformadaManualCompra = false;
/** RC4.31.26 — índice da linha destacada como próximo lançamento */
let indiceProximoDestaqueCompra = null;
/** RC4.31.27 — 'COMPRA' enquanto o cadastro de produto está aberto a partir do lançamento */
let origemCadastroProduto = null;
/** RC4.31.27 — contexto do lançamento (não clona/reseta a compra) */
let contextoCadastroProdutoCompra = null;

/**
 * RC4.31.22 — lê margem oficial do cadastro (nunca força 30 se existir valor definido, inclusive 0).
 * @returns {{ margem: number, fallback: boolean, origem: string }}
 */
function extrairMargemCadastradaProduto(produto) {
    if (!produto || typeof produto !== 'object') {
        return { margem: MARGEM_PADRAO_FALLBACK_COMPRA, fallback: true, origem: ORIGEM_BASE_COMERCIAL_COMPRA.PADRAO };
    }
    const candidatos = [
        produto.lucro_percentual,
        produto.margem_lucro,
        produto.margem_padrao,
        produto.percentual_lucro
    ];
    for (const raw of candidatos) {
        if (raw === undefined || raw === null || raw === '') continue;
        const n = Number(raw);
        if (Number.isFinite(n)) {
            return { margem: n, fallback: false, origem: ORIGEM_BASE_COMERCIAL_COMPRA.CADASTRO };
        }
    }
    return { margem: MARGEM_PADRAO_FALLBACK_COMPRA, fallback: true, origem: ORIGEM_BASE_COMERCIAL_COMPRA.PADRAO };
}

function itemCompraTemMargemGravada(item) {
    if (!item) return false;
    const raw = item.margem_lucro;
    if (raw === undefined || raw === null || raw === '') return false;
    return Number.isFinite(Number(raw));
}

/**
 * CORREÇÃO-NF-MARGEM-01 — decide se deve sobrescrever margem do item pelo cadastro.
 * Não sobrescreve edição manual do operador; sobrescreve default XML / ausência.
 */
function deveReaplicarMargemCadastroItemCompra(item) {
    if (!item || !item.produto_id) return false;
    if (Number(item.margem_editada_manual) === 1) return false;
    if (item.margem_origem === 'manual') return false;
    if (!itemCompraTemMargemGravada(item)) return true;
    if (item.margem_origem === 'xml_default') return true;
    // Importação XML: 30 artificial legado ou margem sem origem oficial → cadastro prevalece
    if (typeof compraImportadaXml !== 'undefined' && compraImportadaXml) {
        if (item.margem_origem !== 'cadastro' && item.margem_origem !== 'fallback') {
            return true;
        }
    }
    return false;
}

/**
 * CORREÇÃO-NF-MARGEM-01 — aplica produtos.lucro_percentual (ou fallback 35%) no item.
 */
function aplicarMargemDoProdutoNoItemCompra(draft, produto, opcoes = {}) {
    if (!draft) return draft;
    if (Number(draft.margem_editada_manual) === 1 && !opcoes.forcar) {
        return draft;
    }
    const info = extrairMargemCadastradaProduto(produto);
    draft.margem_lucro = Number(Number(info.margem).toFixed(2));
    draft.margem_fallback_padrao = info.fallback ? 1 : 0;
    draft.margem_origem = info.fallback ? 'fallback' : 'cadastro';
    draft.origem_base_comercial = info.origem;
    if (opcoes.forcar) {
        draft.margem_editada_manual = 0;
    }
    if (Number(draft.atualizar_preco_venda ?? 1) === 1 && Number(draft.preco_unitario) > 0) {
        draft.preco_venda_sugerido = Number(
            (Number(draft.preco_unitario) * (1 + draft.margem_lucro / 100)).toFixed(2)
        );
    }
    return draft;
}

function resolverProdutoRefItemCompra(item) {
    if (!item?.produto_id) return null;
    if (typeof produtosCompraList !== 'undefined' && Array.isArray(produtosCompraList)) {
        const found = produtosCompraList.find((p) => String(p.id) === String(item.produto_id));
        if (found) return found;
    }
    return null;
}

function rotuloOrigemBaseComercialCompra(origem) {
    switch (origem) {
        case ORIGEM_BASE_COMERCIAL_COMPRA.ULTIMA_COMPRA:
            return 'Base: ✓ Última compra';
        case ORIGEM_BASE_COMERCIAL_COMPRA.CADASTRO:
            return 'Base: ✓ Cadastro do produto';
        case ORIGEM_BASE_COMERCIAL_COMPRA.PADRAO:
            return 'Base: ✓ Padrão (35%)';
        case ORIGEM_BASE_COMERCIAL_COMPRA.ITEM:
            return 'Base: ✓ Valores do item';
        default:
            return '';
    }
}

function marcarMargemManualCompra() {
    margemInformadaManualCompra = true;
    if (itemDraftCompra) {
        itemDraftCompra.margem_editada_manual = 1;
        itemDraftCompra.margem_origem = 'manual';
    }
    calcularValorVendaItem();
}

/**
 * Operador alterou o preço de venda: trata como edição manual
 * (mesma proteção da margem) para o cadastro/% padrão não sobrescrever no save.
 */
function marcarPrecoVendaManualCompra() {
    margemInformadaManualCompra = true;
    if (itemDraftCompra) {
        itemDraftCompra.margem_editada_manual = 1;
        itemDraftCompra.margem_origem = 'manual';
    }
    calcularMargemItem();
}

function atualizarIndicadorBaseComercialCompra(origem) {
    const $hint = $('#hintMargemPadraoCompra');
    if (!$hint.length) return;
    const texto = rotuloOrigemBaseComercialCompra(origem);
    if (texto) {
        $hint.removeClass('d-none').text(texto);
    } else {
        $hint.addClass('d-none').text('');
    }
}

/** @deprecated RC4.31.25 — use atualizarIndicadorBaseComercialCompra */
function atualizarIndicadorMargemPadraoCompra(usarFallback) {
    atualizarIndicadorBaseComercialCompra(
        usarFallback ? ORIGEM_BASE_COMERCIAL_COMPRA.PADRAO : ''
    );
}

/**
 * RC4.31.26 — margem do lançamento: cadastro → padrão 35%.
 * Preço unitário ainda pode vir da última compra (RC4.31.25); a margem não.
 */
function resolverDadosComerciaisProdutoCompra(produto, ultimaCompra = null) {
    const cadastro = extrairMargemCadastradaProduto(produto);
    const margem = cadastro.margem;
    const origemMargem = cadastro.fallback
        ? ORIGEM_BASE_COMERCIAL_COMPRA.PADRAO
        : ORIGEM_BASE_COMERCIAL_COMPRA.CADASTRO;
    const precoCadastro = Number(produto?.preco_compra || 0);
    const vendaCadastro = Number(produto?.preco_venda || 0);

    let preco = precoCadastro;
    let atualizarPreco = 1;
    let usouPrecoHistorico = false;

    if (ultimaCompra && typeof ultimaCompra === 'object') {
        const precoHist = Number(
            ultimaCompra.custo
            ?? ultimaCompra.custo_unitario_final
            ?? ultimaCompra.preco_unitario
            ?? 0
        );
        if (precoHist > 0) {
            preco = precoHist;
            usouPrecoHistorico = true;
        }
        atualizarPreco = Number(ultimaCompra.atualizar_preco_venda ?? 1) === 0 ? 0 : 1;
    }

    const venda = preco > 0
        ? Number((preco * (1 + margem / 100)).toFixed(2))
        : (vendaCadastro > 0 ? vendaCadastro : 0);

    return {
        preco_unitario: preco,
        margem_lucro: margem,
        preco_venda_sugerido: venda,
        atualizar_preco_venda: atualizarPreco,
        origem: origemMargem,
        origem_preco: usouPrecoHistorico
            ? ORIGEM_BASE_COMERCIAL_COMPRA.ULTIMA_COMPRA
            : origemMargem,
        fallback: cadastro.fallback
    };
}

async function buscarUltimaCompraProduto(produtoId) {
    const id = Number(produtoId);
    if (!Number.isFinite(id) || id <= 0) return null;
    if (Object.prototype.hasOwnProperty.call(cacheUltimaCompraProduto, String(id))) {
        return cacheUltimaCompraProduto[String(id)];
    }
    try {
        const resp = await fetch(`${API_URL}/produtos/${id}/ultimas-compras?limite=1`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
        });
        if (!resp.ok) {
            cacheUltimaCompraProduto[String(id)] = null;
            return null;
        }
        const rows = await resp.json();
        const ultima = Array.isArray(rows) && rows.length ? rows[0] : null;
        cacheUltimaCompraProduto[String(id)] = ultima;
        return ultima;
    } catch (err) {
        console.warn('[Compras] última compra:', err);
        cacheUltimaCompraProduto[String(id)] = null;
        return null;
    }
}

function invalidarCacheUltimaCompraProduto(produtoId) {
    if (produtoId == null) {
        Object.keys(cacheUltimaCompraProduto).forEach((k) => { delete cacheUltimaCompraProduto[k]; });
        return;
    }
    delete cacheUltimaCompraProduto[String(produtoId)];
}

/**
 * RC4.31.25 — aplica última compra → cadastro → padrão no formulário.
 * Em edição, preserva valores do item (ETAPA 3).
 */
async function aplicarDadosComerciaisProdutoFormularioCompra(produto, opcoes = {}) {
    const { preservarSeEdicao = false, recalcular = true } = opcoes;
    if (!produto?.id) return null;

    if (preservarSeEdicao && (linhaIdEditandoCompra != null || indiceEditandoCompra != null)) {
        atualizarIndicadorBaseComercialCompra(ORIGEM_BASE_COMERCIAL_COMPRA.ITEM);
        return null;
    }

    const seq = ++seqAplicacaoComercialCompra;
    const ultima = await buscarUltimaCompraProduto(produto.id);
    if (seq !== seqAplicacaoComercialCompra) return null;

    const dados = resolverDadosComerciaisProdutoCompra(produto, ultima);
    const modoEmb = obterModoPainelEmbalagemCompra(produto);
    const preservarMargemManual = margemInformadaManualCompra
        && String($('#margem_padrao_item').val() ?? '').trim() !== '';

    if (!modoEmb && dados.preco_unitario > 0) {
        $('#preco_item').val(formatNumberInput(
            dados.preco_unitario,
            produtoUsaConversaoUnidadesCompra(produto) ? 4 : 2
        ));
    }

    if (!preservarMargemManual) {
        $('#margem_padrao_item').val(formatNumberInput(dados.margem_lucro));
        atualizarIndicadorBaseComercialCompra(dados.origem);
        if (dados.preco_venda_sugerido > 0) {
            $('#preco_venda_item').val(formatNumberInput(dados.preco_venda_sugerido));
        }
    } else {
        atualizarIndicadorBaseComercialCompra(ORIGEM_BASE_COMERCIAL_COMPRA.ITEM);
    }

    if (itemDraftCompra) {
        if (!preservarMargemManual) {
            itemDraftCompra.margem_lucro = dados.margem_lucro;
            itemDraftCompra.margem_fallback_padrao = dados.fallback ? 1 : 0;
            itemDraftCompra.origem_base_comercial = dados.origem;
            itemDraftCompra.preco_venda_sugerido = dados.preco_venda_sugerido;
        }
        itemDraftCompra.atualizar_preco_venda = dados.atualizar_preco_venda;
        itemDraftCompra.ultimo_preco_compra = dados.preco_unitario;
        if (!modoEmb && dados.preco_unitario > 0) {
            itemDraftCompra.preco_unitario = dados.preco_unitario;
        }
    }

    if (recalcular && !modoEmb && typeof calcularValorVendaItem === 'function') {
        calcularValorVendaItem();
    }
    return dados;
}

/** @deprecated RC4.31.25 — use aplicarDadosComerciaisProdutoFormularioCompra */
function aplicarMargemProdutoFormularioCompra(produto, opcoes = {}) {
    return aplicarDadosComerciaisProdutoFormularioCompra(produto, opcoes);
}

let configBonificacaoCompra = {
    cfop_padrao: '5910',
    csosn_padrao: '',
    natureza_operacao: 'Bonificação recebida',
    atualizar_custo: false,
    gerar_estoque: true
};

async function carregarConfigBonificacaoCompra() {
    try {
        const resp = await fetch(`${API_URL}/configuracoes-avancadas/padrao-fiscal`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
        });
        if (!resp.ok) return;
        const json = await resp.json();
        configBonificacaoCompra = {
            cfop_padrao: json.entrada_bonificacao_cfop_padrao || '5910',
            csosn_padrao: json.entrada_bonificacao_csosn_padrao || '',
            natureza_operacao: json.entrada_bonificacao_natureza || 'Bonificação recebida',
            atualizar_custo: json.entrada_bonificacao_atualizar_custo === true,
            gerar_estoque: json.entrada_bonificacao_gerar_estoque !== false
        };
    } catch (_) { /* defaults */ }
}

/** RC4.31.12 — estado embalagem comercial / MUC */
let embalagensProdutoCompraAtual = [];
let modoPainelEmbalagemCompra = null;
let ultimaSimulacaoMucCompra = null;
let timerSimulacaoMucCompra = null;
/** RC4.31.12.1 — evita sobrescrever valores ao restaurar edição */
let restaurandoEmbalagemCompraEdicao = null;
/** RC4.31.12.8 — UCs criadas só para o lançamento atual */
let unidadesComerciaisTemporariasCompra = [];
/** RC4.31.12.8 — última seleção válida do select Comprar em */
let embalagemCompraSelecionadaAnterior = null;
const CHAVE_ULTIMA_EMBALAGEM_COMPRA = 'cds_compra_ultima_embalagem_';

const ROTULOS_TIPO_EMBALAGEM = Object.freeze({
    UN: 'Unidade', CX: 'Caixa', FD: 'Fardo', PCT: 'Pacote', DISPLAY: 'Display',
    KIT: 'Kit', SACO: 'Saco', ROLO: 'Rolo', BOBINA: 'Bobina', BALDE: 'Balde',
    GALAO: 'Galão', CAIXA: 'Caixa', FARDO: 'Fardo', PACOTE: 'Pacote',
    BANDEJA: 'Bandeja', 'CAIXA MASTER': 'Caixa Master',
    VARA: 'Vara', TUBO: 'Tubo', PERFIL: 'Perfil', CHAPA: 'Chapa', BARRA: 'Barra'
});

function rotuloTipoEmbalagemCompra(tipo) {
    if (typeof ProdutoApresentacaoResolver !== 'undefined'
        && ProdutoApresentacaoResolver.labelUnidadeComercial) {
        return ProdutoApresentacaoResolver.labelUnidadeComercial(tipo);
    }
    const raw = String(tipo || 'UN').trim().toUpperCase();
    return ROTULOS_TIPO_EMBALAGEM[raw] || raw;
}

function formatarRotuloOpcaoCompraComercial(opcao) {
    if (typeof ProdutoApresentacaoResolver !== 'undefined'
        && ProdutoApresentacaoResolver.formatarRotuloOpcaoCompra) {
        return ProdutoApresentacaoResolver.formatarRotuloOpcaoCompra(opcao);
    }
    const tipo = rotuloTipoEmbalagemCompra(opcao?.tipo || opcao?.descricao);
    const qtd = Number(opcao?.quantidade || opcao?.quantidade_por_embalagem || 1);
    const un = String(opcao?.unidade || 'UN').toUpperCase();
    return `${tipo} (${formatQuantidadeExibicao(qtd, 3)} ${un})`;
}

function obterModoPainelEmbalagemCompra(produto) {
    if (produtoUsaConversaoUnidadesCompra(produto)) return 'FRACIONADO';
    if (produtoUsaEmbalagemComercialCompra(produto)) return 'COMERCIAL';
    return null;
}

function chaveUltimaEmbalagemCompra(produtoId) {
    return `${CHAVE_ULTIMA_EMBALAGEM_COMPRA}${produtoId}`;
}

function obterUltimaEmbalagemCompraProduto(produtoId) {
    try {
        return localStorage.getItem(chaveUltimaEmbalagemCompra(produtoId)) || null;
    } catch {
        return null;
    }
}

function salvarUltimaEmbalagemCompraProduto(produtoId, embalagemId) {
    if (!produtoId || !embalagemId) return;
    try {
        localStorage.setItem(chaveUltimaEmbalagemCompra(produtoId), String(embalagemId));
    } catch { /* ignore */ }
}

async function carregarEmbalagensProdutoCompra(produto) {
    embalagensProdutoCompraAtual = [];
    if (!produto?.id) return [];

    let produtoCompleto = produto;
    if (!Array.isArray(produto.embalagens)) {
        try {
            const resp = await fetch(`${API_URL}/produtos/${produto.id}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
            });
            if (resp.ok) {
                produtoCompleto = await resp.json();
                const idx = produtosCompraList.findIndex((p) => String(p.id) === String(produto.id));
                if (idx >= 0) produtosCompraList[idx] = { ...produtosCompraList[idx], ...produtoCompleto };
            }
        } catch { /* fallback legado */ }
    }

    if (typeof ProdutoApresentacaoResolver !== 'undefined') {
        const cadastradas = ProdutoApresentacaoResolver.listarOpcoesCompraProduto(produtoCompleto);
        const temporarias = unidadesComerciaisTemporariasCompra.filter(
            (t) => String(t.produto_id) === String(produtoCompleto.id) && Number(t.compra ?? 1) === 1
        );
        embalagensProdutoCompraAtual = ProdutoApresentacaoResolver.montarOpcoesComprarEm(
            produtoCompleto,
            [...cadastradas, ...temporarias]
        );
    }
    return embalagensProdutoCompraAtual;
}

function obterOpcoesEmbalagemCompraConteudo() {
    return embalagensProdutoCompraAtual.filter((emb) => {
        if (typeof ProdutoApresentacaoResolver !== 'undefined'
            && ProdutoApresentacaoResolver.ehOpcaoNovaUnidadeComercial(emb)) {
            return false;
        }
        return !emb._acao;
    });
}

function renderSelectEmbalagemCompra(selecionarId) {
    const $sel = $('#embalagem_compra_item');
    if (!$sel.length) return;

    const opts = embalagensProdutoCompraAtual.map((emb) => {
        const id = emb.id || `legado-${emb.tipo || emb.unidade_comercial || 'UN'}`;
        const rotulo = emb._acao === 'nova_uc'
            ? (emb.descricao || '+ Nova Unidade Comercial...')
            : formatarRotuloOpcaoCompraComercial(emb);
        const qtd = Number(emb.quantidade || emb.quantidade_por_embalagem || 1);
        const origem = emb.tipo_origem_compra || 'EMBALAGEM_COMERCIAL';
        const classe = emb._acao === 'nova_uc' ? ' class="text-primary fw-semibold"' : '';
        return `<option value="${escapeHtml(String(id))}" data-qtd="${qtd}" data-origem="${escapeHtml(origem)}" data-tipo="${escapeHtml(String(emb.tipo || emb.unidade_comercial || 'UN'))}"${classe}>${escapeHtml(rotulo)}</option>`;
    }).join('');

    $sel.html(opts || '<option value="">Sem opções</option>');

    const alvo = selecionarId
        || embalagemCompraSelecionadaAnterior
        || embalagensProdutoCompraAtual.find((e) => typeof ProdutoApresentacaoResolver !== 'undefined'
            && ProdutoApresentacaoResolver.ehOpcaoUnidadeBase(e))?.id
        || embalagensProdutoCompraAtual[0]?.id;

    if (alvo && $(`#embalagem_compra_item option[value="${alvo}"]`).length) {
        $sel.val(String(alvo));
        embalagemCompraSelecionadaAnterior = String(alvo);
    }
}

function renderPainelConteudoEmbalagensCompra() {
    const $painel = $('#painelConteudoEmbalagens');
    if (!$painel.length) return;

    const opcoes = obterOpcoesEmbalagemCompraConteudo().filter((emb) => {
        if (typeof ProdutoApresentacaoResolver !== 'undefined'
            && ProdutoApresentacaoResolver.ehOpcaoUnidadeBase(emb)) {
            return false;
        }
        return true;
    });

    if (!opcoes.length) {
        $painel.html('<small class="text-muted">Nenhuma unidade comercial cadastrada. Use <strong>+ Nova Unidade Comercial...</strong>.</small>');
        return;
    }

    const linhas = opcoes.map((emb) => {
        const rotulo = formatarRotuloOpcaoCompraComercial(emb);
        return `<div class="col-md-4"><strong>${escapeHtml(rotulo.split(' (')[0])}</strong><br><span class="text-muted">${escapeHtml(rotulo.includes('(') ? rotulo.slice(rotulo.indexOf('(')) : rotulo)}</span></div>`;
    }).join('');

    $painel.html(`
        <div class="small text-muted mb-1">Conteúdo</div>
        <div class="row g-2">${linhas}</div>
    `);
}

function embalagemCompraEhUnidade(emb) {
    if (!emb) return true;
    if (emb.tipo_origem_compra === 'UNIDADE_COMERCIAL') {
        return Number(emb.quantidade || emb.quantidade_por_embalagem || 1) <= 1
            && normalizarTipoApresentacaoCompra(emb.tipo || emb.unidade_comercial) === 'UN';
    }
    const tipo = normalizarTipoApresentacaoCompra(emb.tipo || emb.unidade_comercial || 'UN');
    if (tipo !== 'UN') return false;
    return Number(emb.quantidade || emb.quantidade_por_embalagem || 1) <= 1;
}

function normalizarTipoApresentacaoCompra(valor) {
    return String(valor || 'UN').trim().toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '');
}

/**
 * RC4.31.28/29 — no MUC, #preco_item = preço unitário comercial (Vara/Caixa/Embalagem).
 * Total da compra = preço unitário comercial × quantidade comercial.
 */
function obterPrecoUnitarioComercialFormularioMuc() {
    if (!obterModoPainelEmbalagemCompra(obterProdutoSelecionadoCompra())) return 0;
    const raw = $('#preco_item').val();
    if (raw === undefined || raw === null || raw === '') return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function obterQuantidadeComercialFormularioMuc() {
    const raw = $('#quantidade_embalagens_item').val();
    if (raw === undefined || raw === null || raw === '') return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function obterValorTotalCompraMuc() {
    if (!obterModoPainelEmbalagemCompra(obterProdutoSelecionadoCompra())) return 0;
    const unit = obterPrecoUnitarioComercialFormularioMuc();
    const qtd = obterQuantidadeComercialFormularioMuc();
    if (unit > 0 && qtd > 0) {
        return Number((unit * qtd).toFixed(2));
    }
    return 0;
}

/** Número estritamente positivo; não mascara ausência com 0. */
function numeroPositivoCompra(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

function obterQuantidadeComercialResolvidaItemCompra(item = {}) {
    let qtd = numeroPositivoCompra(item.quantidade_embalagens)
        || numeroPositivoCompra(item.quantidade_comercial);
    if (qtd != null) return qtd;

    const fator = numeroPositivoCompra(item.quantidade_por_embalagem)
        || numeroPositivoCompra(item.fator_conversao);
    const convertida = numeroPositivoCompra(item.quantidade_convertida)
        || numeroPositivoCompra(item.quantidade);
    if (fator != null && convertida != null) {
        return convertida / fator;
    }
    return null;
}

/**
 * RC4.31.29 — resolução canônica do preço de #preco_item (formulário/edição).
 *
 * Produto comum: preco_unitario.
 * MUC/UC: preco_unitario_comercial → total/qtd comercial → subtotal/qtd → preco_unitario.
 * Nunca devolve total/subtotal crus; nunca zera um preço válido por falha de uma fonte.
 */
function obterPrecoUnitarioCompraFormulario(item = {}, produto = null) {
    if (!item || typeof item !== 'object') {
        return { valor: 0, origem: 'nenhuma', modoEmbalagem: false };
    }

    const modoEmb = itemUsaModoPrecoEmbalagemCompra(item, produto);
    const qtdComercial = obterQuantidadeComercialResolvidaItemCompra(item);

    const comercial = numeroPositivoCompra(item.preco_unitario_comercial);
    if (comercial != null) {
        return {
            valor: Number(comercial.toFixed(4)),
            origem: 'preco_unitario_comercial',
            modoEmbalagem: modoEmb
        };
    }

    if (!modoEmb) {
        const unit = numeroPositivoCompra(item.preco_unitario);
        if (unit != null) {
            return { valor: Number(unit.toFixed(4)), origem: 'preco_unitario', modoEmbalagem: false };
        }
        const qtd = numeroPositivoCompra(item.quantidade) || qtdComercial;
        const sub = numeroPositivoCompra(item.subtotal);
        if (sub != null && qtd != null) {
            return {
                valor: Number((sub / qtd).toFixed(4)),
                origem: 'subtotal_por_quantidade',
                modoEmbalagem: false
            };
        }
        return { valor: 0, origem: 'nenhuma', modoEmbalagem: false };
    }

    // MUC / UC — unitário comercial a partir do total (não usar total cru)
    const totalEmb = numeroPositivoCompra(item.valor_total_embalagem);
    if (totalEmb != null && qtdComercial != null) {
        return {
            valor: Number((totalEmb / qtdComercial).toFixed(4)),
            origem: 'total_por_comercial',
            modoEmbalagem: true
        };
    }

    const sub = numeroPositivoCompra(item.subtotal);
    if (sub != null && qtdComercial != null) {
        return {
            valor: Number((sub / qtdComercial).toFixed(4)),
            origem: 'subtotal_por_comercial',
            modoEmbalagem: true
        };
    }

    // Fallback: nunca exibir 0 se ainda houver preço de compra válido no item
    const unit = numeroPositivoCompra(item.preco_unitario);
    if (unit != null) {
        return { valor: Number(unit.toFixed(4)), origem: 'preco_unitario', modoEmbalagem: true };
    }

    return { valor: 0, origem: 'nenhuma', modoEmbalagem: true };
}

/** @deprecated RC4.31.29 — use obterPrecoUnitarioCompraFormulario */
function obterPrecoUnitarioComercialItemCompra(item = {}) {
    return obterPrecoUnitarioCompraFormulario(item).valor;
}

function persistirPrecoUnitarioComercialItemCompra(item = {}, produto = null) {
    const existente = numeroPositivoCompra(item.preco_unitario_comercial);
    if (existente != null) return Number(existente.toFixed(4));

    if (!itemUsaModoPrecoEmbalagemCompra(item, produto)) return 0;

    const resolvido = obterPrecoUnitarioCompraFormulario(item, produto);
    if (
        resolvido.valor > 0
        && (resolvido.origem === 'total_por_comercial'
            || resolvido.origem === 'subtotal_por_comercial'
            || resolvido.origem === 'preco_unitario_comercial')
    ) {
        return resolvido.valor;
    }
    return 0;
}

function onPrecoCompraItemInput() {
    if (obterModoPainelEmbalagemCompra(obterProdutoSelecionadoCompra())) {
        agendarSimulacaoMucCompra();
        return;
    }
    calcularValorVendaItem();
}

/** RC4.31.24 — rótulo alinhado ao modo real (unidade vs embalagem/MUC). */
function atualizarRotuloPrecoCompraItem(itemRef = null) {
    const produto = obterProdutoSelecionadoCompra();
    const item = itemRef || itemDraftCompra || {};
    const fracionado = produtoUsaConversaoUnidadesCompra(produto) || itemCompraEhFracionado(item);
    const usaEmb = itemUsaEmbalagemComercial(item, produto);
    if (fracionado || usaEmb) {
        const rotulo = item.compra_em || item.unidade_comercial
            || $('#compra_em_item').val()
            || (fracionado ? 'Embalagem' : 'Embalagem');
        const tipo = rotuloTipoEmbalagemCompra(rotulo);
        $('#label_preco_compra_item').text(`Preço da ${tipo}`);
        return;
    }
    $('#label_preco_compra_item').text('Preço compra (unidade)');
}

function aplicarEmbalagemCompraSelecionada(embalagemId, opcoes = {}) {
    const emb = embalagensProdutoCompraAtual.find((e) => String(e.id) === String(embalagemId))
        || embalagensProdutoCompraAtual.find((e) => !e._acao);
    if (!emb || emb._acao === 'nova_uc') return;

    const tipo = String(emb.tipo || emb.unidade_comercial || 'PCT').toUpperCase();
    const qtd = Number(emb.quantidade || emb.quantidade_por_embalagem || 1);
    const un = String(emb.unidade || obterProdutoSelecionadoCompra()?.unidade || 'UN').toUpperCase();
    const ehUnidade = embalagemCompraEhUnidade(emb);

    if ($('#compra_em_item option[value="' + tipo + '"]').length) {
        $('#compra_em_item').val(tipo);
    } else if (TIPOS_COMPRA_EMBALAGEM.includes(tipo)) {
        $('#compra_em_item').val(tipo);
    } else {
        $('#compra_em_item').html(
            opcoesCompraEmbalagemHtml('PCT') +
            `<option value="${escapeHtml(tipo)}" selected>${escapeHtml(rotuloTipoEmbalagemCompra(tipo))}</option>`
        );
    }

    if (!opcoes.preservarFator) {
        $('#quantidade_por_embalagem_item').val(formatQuantidadeExibicao(qtd, 3));
    }
    $('#unidade_fracionada_item').val(un);
    if (!opcoes.preservarPreco && Number(emb.valor_compra || 0) > 0) {
        $('#preco_item').val(formatNumberInput(Number(emb.valor_compra), 2));
    }
    if (!opcoes.preservarQuantidade && !$('#quantidade_embalagens_item').val()) {
        $('#quantidade_embalagens_item').val('1');
    }
    $('#embalagem_compra_item').val(String(emb.id || embalagemId || ''));
    $('#colCompraEmLegado').addClass('d-none');
    $('#colQtdPorEmbalagemCompra').toggleClass('d-none', isModoEmbalagemComercialCompraAtivo() && !ehUnidade);
    agendarSimulacaoMucCompra();
}

function onEmbalagemCompraSelecionada() {
    const id = $('#embalagem_compra_item').val();

    if (typeof ProdutoApresentacaoResolver !== 'undefined'
        && ProdutoApresentacaoResolver.ehOpcaoNovaUnidadeComercial(id)) {
        const produto = obterProdutoSelecionadoCompra();
        const revert = embalagemCompraSelecionadaAnterior
            || (produto && typeof ProdutoApresentacaoResolver !== 'undefined'
                ? `unidade-base-${produto.id}`
                : '');
        if (revert && $(`#embalagem_compra_item option[value="${revert}"]`).length) {
            $('#embalagem_compra_item').val(revert);
        }
        abrirModalNovaUnidadeComercialCompra();
        return;
    }

    const emb = embalagensProdutoCompraAtual.find((e) => String(e.id) === String(id));
    if (emb && Number(emb.compra ?? 1) === 0) {
        showNotification('Esta embalagem não está habilitada para utilização em compras.', 'warning');
        return;
    }
    embalagemCompraSelecionadaAnterior = String(id || '');
    aplicarEmbalagemCompraSelecionada(id);
}

function abrirModalNovaUnidadeComercialCompra() {
    const produto = obterProdutoSelecionadoCompra();
    if (!produto?.id) {
        showNotification('Selecione um produto antes de cadastrar a unidade comercial.', 'warning');
        return;
    }

    const modalId = 'modalNovaUnidadeComercialCompra';
    $(`#${modalId}`).remove();
    const unidadeEstoque = String(produto.unidade || 'UN').toUpperCase();

    $('body').append(`
        <div class="modal fade" id="${modalId}" tabindex="-1" data-bs-backdrop="static">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Nova Unidade Comercial</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label class="form-label fw-semibold">Descrição</label>
                            <input type="text" class="form-control" id="nova_uc_descricao" placeholder="Ex.: Vara">
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-semibold">Quantidade de conversão</label>
                            <input type="number" step="0.001" min="0.001" class="form-control" id="nova_uc_quantidade" placeholder="Ex.: 6">
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-semibold">Unidade de estoque</label>
                            <input type="text" class="form-control" id="nova_uc_unidade" value="${escapeHtml(unidadeEstoque)}" readonly>
                        </div>
                        <hr class="my-2">
                        <div class="mb-3">
                            <label class="form-label fw-semibold d-block">Utilizar em</label>
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" id="nova_uc_utilizar_compra" checked>
                                <label class="form-check-label" for="nova_uc_utilizar_compra">Compras</label>
                            </div>
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" id="nova_uc_utilizar_venda">
                                <label class="form-check-label" for="nova_uc_utilizar_venda">Vendas</label>
                            </div>
                        </div>
                        <hr class="my-2">
                        <div class="mb-2">
                            <label class="form-label fw-semibold d-block">Salvar no cadastro do produto</label>
                            <div class="form-check">
                                <input class="form-check-input" type="radio" name="nova_uc_persistencia" id="nova_uc_salvar_cadastro" value="cadastro" checked>
                                <label class="form-check-label" for="nova_uc_salvar_cadastro">Sim</label>
                            </div>
                            <div class="form-check">
                                <input class="form-check-input" type="radio" name="nova_uc_persistencia" id="nova_uc_somente_compra" value="somente">
                                <label class="form-check-label" for="nova_uc_somente_compra">Apenas nesta compra</label>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" id="btnConfirmarNovaUcCompra">Confirmar</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    const el = document.getElementById(modalId);
    const modal = new bootstrap.Modal(el);
    $('#btnConfirmarNovaUcCompra').on('click', () => {
        confirmarNovaUnidadeComercialCompra(modal, modalId);
    });
    el.addEventListener('hidden.bs.modal', () => {
        $(`#${modalId}`).remove();
    }, { once: true });
    modal.show();
    setTimeout(() => $('#nova_uc_descricao').trigger('focus'), 200);
}

async function persistirUnidadeComercialNoCadastroProduto(produto, payloadEmbalagem) {
    const token = localStorage.getItem('token') || '';
    const resp = await fetch(`${API_URL}/produtos/${produto.id}/embalagens/aprendizagem-compra`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payloadEmbalagem)
    });

    if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.error || 'Falha ao salvar unidade comercial no produto.');
    }

    const json = await resp.json();
    const produtoAtualizado = json.produto || json;
    sincronizarCacheProdutoAposAprendizagem(produtoAtualizado, json.embalagem);
    return produtoAtualizado;
}

function sincronizarCacheProdutoAposAprendizagem(produto, embalagemNova) {
    if (!produto?.id) return;

    const mesclar = (lista) => {
        if (!Array.isArray(lista)) return;
        const idx = lista.findIndex((p) => String(p.id) === String(produto.id));
        if (idx >= 0) {
            lista[idx] = { ...lista[idx], ...produto };
        }
    };

    mesclar(produtosCompraList);
    if (typeof window !== 'undefined') {
        mesclar(window.produtosCache);
        mesclar(window.produtosList);
        mesclar(window.produtosOriginais);
    }

    if (typeof ProdutoEmbalagensUI !== 'undefined' && ProdutoEmbalagensUI.inicializarApresentacoes) {
        const produtoModalId = $('#produto_id').val() || window._produtoEmEdicaoId;
        if (produtoModalId && String(produtoModalId) === String(produto.id)) {
            ProdutoEmbalagensUI.inicializarApresentacoes(produto);
        }
    }

    if (embalagemNova && typeof ProdutoApresentacaoResolver !== 'undefined') {
        console.log('[Compras] UC aprendida disponível — compra:', embalagemNova.compra, 'venda:', embalagemNova.venda);
    }
}

function localizarOpcaoEmbalagemAprendida(descricao, quantidade) {
    return embalagensProdutoCompraAtual.find(
        (e) => !e._acao
            && String(e.descricao || '').trim().toLowerCase() === descricao.toLowerCase()
            && Math.abs(Number(e.quantidade || e.quantidade_por_embalagem || 0) - quantidade) < 0.0001
    ) || embalagensProdutoCompraAtual.find(
        (e) => e.tipo_origem_compra === 'UNIDADE_COMERCIAL'
            && typeof ProdutoApresentacaoResolver !== 'undefined'
            && !ProdutoApresentacaoResolver.ehOpcaoUnidadeBase(e)
            && String(e.descricao || '').trim().toLowerCase() === descricao.toLowerCase()
    );
}

async function confirmarNovaUnidadeComercialCompra(modal, modalId) {
    const produto = obterProdutoSelecionadoCompra();
    if (!produto?.id) return;

    const descricao = ($('#nova_uc_descricao').val() || '').trim();
    const quantidade = Number($('#nova_uc_quantidade').val() || 0);
    const unidade = String($('#nova_uc_unidade').val() || produto.unidade || 'UN');
    const persistirCadastro = $('input[name="nova_uc_persistencia"]:checked').val() === 'cadastro';
    const utilizarCompra = $('#nova_uc_utilizar_compra').is(':checked');
    const utilizarVenda = $('#nova_uc_utilizar_venda').is(':checked');

    if (!descricao) {
        showNotification('Informe a descrição da unidade comercial.', 'warning');
        $('#nova_uc_descricao').focus();
        return;
    }
    if (!(quantidade > 0)) {
        showNotification('Informe a quantidade de conversão.', 'warning');
        $('#nova_uc_quantidade').focus();
        return;
    }

    const dados = {
        descricao,
        quantidade,
        unidade,
        tipo: 'ROLO',
        compra: utilizarCompra ? 1 : 0,
        venda: utilizarVenda ? 1 : 0
    };

    if (typeof ProdutoApresentacaoResolver !== 'undefined') {
        const validacao = ProdutoApresentacaoResolver.validarUtilizacaoAprendizagemCompra(dados);
        if (!validacao.ok) {
            showNotification(validacao.mensagem, 'warning');
            return;
        }
    }

    if (!persistirCadastro && !utilizarCompra) {
        showNotification('Para usar nesta compra, marque Compras em Utilizar em.', 'warning');
        return;
    }

    let novaOpcao = null;

    try {
        if (persistirCadastro) {
            if (typeof ProdutoApresentacaoResolver === 'undefined') {
                throw new Error('Resolver de apresentação indisponível.');
            }
            const payload = ProdutoApresentacaoResolver.montarEmbalagemAprendidaCompra(dados, produto);
            const produtoAtualizado = await persistirUnidadeComercialNoCadastroProduto(produto, payload);
            await carregarEmbalagensProdutoCompra(produtoAtualizado);
            novaOpcao = localizarOpcaoEmbalagemAprendida(descricao, quantidade);
            if (!novaOpcao && utilizarCompra) {
                showNotification('Unidade comercial salva, porém não está habilitada para compras.', 'warning');
            } else {
                const uso = [
                    utilizarCompra ? 'compras' : null,
                    utilizarVenda ? 'vendas' : null
                ].filter(Boolean).join(' e ');
                showNotification(`Unidade comercial salva no cadastro (${uso}).`, 'success');
            }
        } else {
            if (typeof ProdutoApresentacaoResolver === 'undefined') {
                throw new Error('Resolver de apresentação indisponível.');
            }
            novaOpcao = ProdutoApresentacaoResolver.montarUnidadeComercialTemporariaCompra(dados, produto);
            novaOpcao.produto_id = produto.id;
            unidadesComerciaisTemporariasCompra.push(novaOpcao);
            await carregarEmbalagensProdutoCompra(produto);
            showNotification('Unidade comercial aplicada somente nesta compra.', 'info');
        }
    } catch (err) {
        console.error('[Compras] Nova UC:', err);
        showNotification(err.message || 'Erro ao registrar unidade comercial.', 'danger');
        return;
    }

    modal.hide();
    renderSelectEmbalagemCompra(novaOpcao?.id);
    renderPainelConteudoEmbalagensCompra();
    if (novaOpcao?.id) {
        embalagemCompraSelecionadaAnterior = String(novaOpcao.id);
        aplicarEmbalagemCompraSelecionada(novaOpcao.id);
    } else if (utilizarCompra) {
        agendarSimulacaoMucCompra();
    }
}

function atualizarPainelResumoConversaoMuc(resultado, modo) {
    const $painel = $('#painelResumoConversaoMuc');
    if (!$painel.length) return;

    if (!resultado || Number(resultado.quantidadeEstoque || 0) <= 0) {
        $painel.addClass('d-none').html('');
        return;
    }

    const produto = obterProdutoSelecionadoCompra();
    const un = String(produto?.unidade || resultado.unidadeEstoque || 'UN').toUpperCase();
    const embSel = embalagensProdutoCompraAtual.find((e) => String(e.id) === String($('#embalagem_compra_item').val()));
    const rotuloCompra = embSel
        ? formatarRotuloOpcaoCompraComercial(embSel).split(' (')[0]
        : rotuloTipoEmbalagemCompra($('#compra_em_item').val() || resultado.unidadeCompra);
    const qtdEmb = Number($('#quantidade_embalagens_item').val() || resultado.quantidadeCompra || 0);
    const qtdPorEmb = Number($('#quantidade_por_embalagem_item').val() || resultado.fatorConversao || 0);
    const custoUnit = Number(resultado.custoUnitario || 0);

    $painel.removeClass('d-none').html(`
        <div class="card border-success mt-2">
            <div class="card-header bg-light py-2"><strong>Resumo</strong></div>
            <div class="card-body py-2 small">
                <div class="row g-2">
                    <div class="col-md-6"><strong>Compra:</strong> ${formatQuantidadeExibicao(qtdEmb, 3)} ${escapeHtml(rotuloCompra)}${qtdEmb > 1 ? 's' : ''}</div>
                    <div class="col-md-6"><strong>Conteúdo:</strong> ${formatQuantidadeExibicao(qtdPorEmb, 3)} ${escapeHtml(un)} por ${escapeHtml(rotuloCompra.toLowerCase())}</div>
                    <div class="col-md-6"><strong>Entrada no estoque:</strong> ${formatQuantidadeExibicao(resultado.quantidadeEstoque, 3)} ${escapeHtml(un)}</div>
                    <div class="col-md-6"><strong>Custo unitário:</strong> R$ ${formatarCustoUnitarioVenda(custoUnit)}</div>
                    ${modo === 'COMERCIAL' ? '<div class="col-12 text-muted">Conversão via Motor Universal de Comercialização (MUC)</div>' : ''}
                </div>
            </div>
        </div>
    `);
}

function agendarSimulacaoMucCompra() {
    if (timerSimulacaoMucCompra) clearTimeout(timerSimulacaoMucCompra);
    timerSimulacaoMucCompra = setTimeout(() => {
        simularConversaoMucCompra().catch(() => { /* UI silenciosa */ });
    }, 120);
}

async function simularConversaoMucCompra(forcar = false) {
    const produto = obterProdutoSelecionadoCompra();
    const modo = obterModoPainelEmbalagemCompra(produto);
    if (!modo) {
        ultimaSimulacaoMucCompra = null;
        return null;
    }

    const qtdEmb = Number($('#quantidade_embalagens_item').val() || 0);
    const qtdPorEmb = Number($('#quantidade_por_embalagem_item').val() || 0);
    const valorTotal = obterValorTotalCompraMuc();
    const unidade = String($('#unidade_fracionada_item').val() || produto?.unidade || 'UN').toUpperCase();

    if (qtdEmb <= 0 || qtdPorEmb <= 0) {
        $('#resultado_formula_conversao').text('');
        $('#resultado_qtd_total_fracionado').text(`0 ${unidade}`);
        $('#resultado_custo_unitario_fracionado').text('R$ 0,0000');
        atualizarPainelResumoConversaoMuc(null, modo);
        ultimaSimulacaoMucCompra = null;
        return null;
    }

    if (typeof CompraMucClient === 'undefined') {
        if (!forcar) return null;
        throw new Error('Cliente MUC indisponível');
    }

    const resultado = await CompraMucClient.simularConversao({
        quantidade_embalagens: qtdEmb,
        quantidade_por_embalagem: qtdPorEmb,
        valor_total_embalagem: valorTotal
    });

    ultimaSimulacaoMucCompra = resultado;
    const qtdTotal = Number(resultado.quantidadeEstoque || 0);
    const custoUnitario = Number(resultado.custoUnitario || 0);
    const compraEm = obterRotuloCompraEmAtual();

    $('#resultado_qtd_total_fracionado').text(`${formatQuantidadeExibicao(qtdTotal, 3)} ${unidade}`);
    $('#resultado_custo_unitario_fracionado').text(`R$ ${formatarCustoUnitarioVenda(custoUnitario)}`);

    if (qtdEmb > 0 && qtdPorEmb > 0) {
        const tipoPlural = pluralizarTipoEmbalagem(compraEm, qtdEmb);
        $('#resultado_formula_conversao').text(
            `${formatQuantidadeExibicao(qtdEmb, 3)} ${tipoPlural} × ${formatQuantidadeExibicao(qtdPorEmb, 3)} ${unidade} = ${formatQuantidadeExibicao(qtdTotal, 3)} ${unidade}`
        );
    }

    if (modo === 'FRACIONADO') {
        if (isOrigemCompraCentralNfe() && !itemDraftCompra?.distribuicao_fiscal_editada_manual) {
            const fiscalAtual = Number($('#quantidade_fiscal_item').val() || 0);
            const naoFiscalAtual = Number($('#quantidade_nao_fiscal_item').val() || 0);
            const somaAtual = fiscalAtual + naoFiscalAtual;
            if (somaAtual <= 0 || Math.abs(somaAtual - qtdTotal) > 0.001) {
                const dist = calcularDistribuicaoFiscalMotorItem({
                    peso_total_compra: qtdTotal,
                    quantidade_convertida: qtdTotal,
                    quantidade_comercial: Number($('#quantidade_embalagens_item').val() || 0),
                    quantidade_embalagens: Number($('#quantidade_embalagens_item').val() || 0),
                    quantidade_por_embalagem: Number($('#quantidade_por_embalagem_item').val() || 0),
                    unidade
                }, obterTipoEntradaSelecionado());
                $('#quantidade_fiscal_item').val(formatQuantidadeExibicao(dist.quantidade_fiscal, 3));
                $('#quantidade_nao_fiscal_item').val(formatQuantidadeExibicao(dist.quantidade_nao_fiscal, 3));
            }
        }
        atualizarIndicadorDistribuicaoFiscal(qtdTotal, unidade);
    }

    $('#custo_unitario_fracionado_item').val(
        custoUnitario > 0 ? formatarCustoUnitarioVenda(custoUnitario) : ''
    );
    calcularValorVendaItem();

    atualizarPainelResumoConversaoMuc(resultado, modo);

    return {
        qtdTotal,
        custoUnitario,
        valorTotal,
        unidade,
        compraEm,
        muc: resultado
    };
}

function renderResumoConversaoItemCompraHtml(item) {
    const comercial = obterQuantidadeComercialItemCompra(item);
    const convertida = obterQuantidadeConvertidaItemCompra(item);
    if (!(comercial > 0) || Math.abs(comercial - convertida) < 0.001) return '';

    const tipo = rotuloTipoEmbalagemCompra(item.compra_em || item.unidade_comercial || 'UN');
    const un = String(item.unidade || 'UN').toUpperCase();
    const valorEmb = Number(item.valor_total_embalagem || item.subtotal || 0);
    const custoUnit = Number(item.preco_unitario || item.custo_unitario_final || 0);

    return `
        <div class="small text-muted mt-1 compra-resumo-embalagem">
            <div><strong>Comprado:</strong> ${formatQuantidadeExibicao(comercial, 3)} ${escapeHtml(tipo)}${comercial > 1 ? 's' : ''}</div>
            <div><strong>Conversão:</strong> ${formatQuantidadeExibicao(convertida, 3)} ${escapeHtml(un)}</div>
            <div><strong>Preço embalagem:</strong> ${formatCurrency(valorEmb)} | <strong>Unitário:</strong> R$ ${formatarCustoUnitarioVenda(custoUnit)}</div>
        </div>`;
}

function enriquecerItemFiscalCompraUi(item) {
    if (typeof TratamentoFiscalItemCompra === 'undefined') return item;
    return TratamentoFiscalItemCompra.enriquecerItemFiscalCompra(item, {
        tipoEntradaCompra: obterTipoEntradaSelecionado(),
        configBonificacao: configBonificacaoCompra
    });
}

function obterTipoEntradaSelecionado() {
    const sel = $('input[name="tipo_entrada_compra"]:checked').val();
    return sel || tipoEntradaCompraAtual || TIPOS_ENTRADA_COMPRA.REVENDA;
}

function isUsoConsumoCompraAtual() {
    return obterTipoEntradaSelecionado() === TIPOS_ENTRADA_COMPRA.USO_CONSUMO;
}

function rotuloTipoEntradaCompra(tipo) {
    const map = {
        REVENDA: 'Compra para Revenda',
        INDUSTRIALIZACAO: 'Compra para Industrialização',
        USO_CONSUMO: 'Compra para Uso e Consumo',
        BONIFICACAO: 'Compra por Bonificação'
    };
    return map[tipo] || map.REVENDA;
}

function isBonificacaoCompraAtual() {
    return obterTipoEntradaSelecionado() === TIPOS_ENTRADA_COMPRA.BONIFICACAO;
}

function definirTipoEntradaCompra(tipo, { silencioso } = {}) {
    tipoEntradaCompraAtual = tipo || TIPOS_ENTRADA_COMPRA.REVENDA;
    $(`input[name="tipo_entrada_compra"][value="${tipoEntradaCompraAtual}"]`).prop('checked', true);
    if (!silencioso) aplicarPoliticaEntradaCompra();
}

function reenriquecerItensFiscalCompra() {
    if (!itensCompraAtual.length) return;
    const tipoEntrada = obterTipoEntradaSelecionado();
    itensCompraAtual = itensCompraAtual.map((item) => {
        const clone = clonarDadosItemCompra(item);
        if (!clone.tipo_fiscal_manual) {
            clone.tipo_fiscal_item = null;
        }
        const enriquecido = enriquecerItemFiscalCompraUi(clone);
        if (isOrigemCompraCentralNfe()) {
            return aplicarDistribuicaoFiscalItemCentral(enriquecido, tipoEntrada);
        }
        return enriquecido;
    });
    if ($('#itensCompraBody').length) renderItensCompraTabelaCore();
}

function aplicarPoliticaEntradaCompra() {
    tipoEntradaCompraAtual = obterTipoEntradaSelecionado();
    const usoConsumo = isUsoConsumoCompraAtual();
    const avulsa = $('#nota_fiscal_avulsa').is(':checked');

    if (usoConsumo) {
        $('#nota_fiscal_avulsa').prop('checked', false).prop('disabled', true);
        $('#itensCompraSection').hide();
        $('#adicionarItemRow').hide();
        $('#itensCompraTable').hide();
        $('#totaisNotaSection').show();
        $('#pagamentoSection').show();
        $('#valor_total_nota').prop('readonly', false);
        $('#valor_produtos').prop('readonly', false);
        $('#valor_total_nota_hint').text('Valor fiscal da NF-e (sem movimentação de estoque).');
        if (!$('#valor_total_nota').val() && compraImportadaXml?.valor_total_nota) {
            $('#valor_total_nota').val(formatNumberInput(compraImportadaXml.valor_total_nota));
            $('#valor_produtos').val(formatNumberInput(compraImportadaXml.valor_produtos || compraImportadaXml.valor_total_nota));
        }
    } else {
        $('#nota_fiscal_avulsa').prop('disabled', false);
        if (!avulsa) {
            $('#itensCompraSection').show();
            $('#adicionarItemRow').show();
            $('#itensCompraTable').show();
            $('#valor_total_nota').prop('readonly', true);
            $('#valor_produtos').prop('readonly', true);
            $('#valor_total_nota_hint').text('Calculado automaticamente a partir dos itens.');
            recalcularTotaisCompraNota();
        } else {
            toggleNotaFiscalAvulsa();
        }
    }
    reenriquecerItensFiscalCompra();
}

/** Evita duplicar XML grande no JSON enviado às APIs fiscais de compra. */
function dadosCompraSemXmlParaApi(dados = {}) {
    if (!dados || typeof dados !== 'object') return {};
    const { xml, ...rest } = dados;
    return rest;
}

async function classificarEntradaCompraApi(dadosCompra) {
    try {
        const resp = await fetch(`${API_URL}/compras/classificar-entrada`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('token') || ''}`
            },
            body: JSON.stringify({
                dadosCompra: dadosCompraSemXmlParaApi(dadosCompra),
                fornecedor_cnpj: dadosCompra?.fornecedor_cnpj,
                xml: dadosCompra?.xml || null
            })
        });
        const json = await resp.json();
        if (!resp.ok) throw new Error(json.error || 'Falha ao classificar entrada');
        return json;
    } catch (err) {
        console.warn('[RC9.1] Classificação:', err.message);
        return {
            tipoEntrada: TIPOS_ENTRADA_COMPRA.REVENDA,
            confianca: 55,
            motivo: 'Classificação indisponível — sugestão padrão Revenda.',
            label: 'Compra para Revenda'
        };
    }
}

function mostrarDialogoPoliticaEntrada(callback, classificacao) {
    const modalId = 'politicaEntradaModal';
    $(`#${modalId}`).remove();
    const sugestao = classificacao?.tipoEntrada || TIPOS_ENTRADA_COMPRA.USO_CONSUMO;
    const confianca = Number(classificacao?.confianca || 0);
    const motivo = classificacao?.motivo || '';
    const check = (tipo) => (tipo === sugestao ? ' checked' : '');
    const html = `
        <div class="modal fade" id="${modalId}" tabindex="-1" data-bs-backdrop="static">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Como deseja registrar esta NF-e?</h5>
                    </div>
                    <div class="modal-body">
                        ${classificacao ? `
                        <div class="alert alert-info py-2">
                            <div><strong>Tipo sugerido:</strong> ${escapeHtml(rotuloTipoEntradaCompra(sugestao))}</div>
                            <div><strong>Confiança:</strong> ${confianca}%</div>
                            <div class="small mt-1">${escapeHtml(motivo)}</div>
                        </div>` : ''}
                        <div class="form-check mb-2">
                            <input class="form-check-input" type="radio" name="politica_entrada_import" id="politica_revenda" value="REVENDA"${check(TIPOS_ENTRADA_COMPRA.REVENDA)}>
                            <label class="form-check-label" for="politica_revenda">Compra para Revenda</label>
                        </div>
                        <div class="form-check mb-2">
                            <input class="form-check-input" type="radio" name="politica_entrada_import" id="politica_industrializacao" value="INDUSTRIALIZACAO"${check(TIPOS_ENTRADA_COMPRA.INDUSTRIALIZACAO)}>
                            <label class="form-check-label" for="politica_industrializacao">Compra para Industrialização</label>
                        </div>
                        <div class="form-check mb-2">
                            <input class="form-check-input" type="radio" name="politica_entrada_import" id="politica_bonificacao" value="BONIFICACAO"${check(TIPOS_ENTRADA_COMPRA.BONIFICACAO)}>
                            <label class="form-check-label" for="politica_bonificacao">Compra por Bonificação</label>
                            <small class="text-muted d-block">Aplica regras fiscais de bonificação; itens mantêm CFOP individual do XML.</small>
                        </div>
                        <div class="form-check mb-2">
                            <input class="form-check-input" type="radio" name="politica_entrada_import" id="politica_uso_consumo" value="USO_CONSUMO"${check(TIPOS_ENTRADA_COMPRA.USO_CONSUMO)}>
                            <label class="form-check-label" for="politica_uso_consumo"><strong>Compra para Uso e Consumo</strong></label>
                            <small class="text-muted d-block">Registra NF-e, fiscal e financeiro — sem produtos ou estoque.</small>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" id="politicaEntradaConfirmar">Continuar</button>
                    </div>
                </div>
            </div>
        </div>`;
    $('body').append(html);
    const el = document.getElementById(modalId);
    const modal = new bootstrap.Modal(el);
    $('#politicaEntradaConfirmar').on('click', () => {
        const tipo = $('input[name="politica_entrada_import"]:checked').val()
            || sugestao
            || TIPOS_ENTRADA_COMPRA.REVENDA;
        modal.hide();
        el.addEventListener('hidden.bs.modal', () => {
            $(`#${modalId}`).remove();
            if (typeof callback === 'function') callback(tipo, classificacao || null);
        }, { once: true });
    });
    modal.show();
}

function abrirRelatorioUsoConsumo() {
    $.ajax({ url: `${API_URL}/compras/relatorio/uso-consumo`, method: 'GET' })
        .done(function(resp) {
            const itens = resp.itens || [];
            const linhas = itens.map((r) => `
                <tr>
                    <td>${formatDate(r.data)}</td>
                    <td>${escapeHtml(r.fornecedor || '—')}</td>
                    <td>${escapeHtml(r.numero_nf || '—')}${r.serie_nf ? '/' + escapeHtml(r.serie_nf) : ''}</td>
                    <td>${formatCurrency(r.valor)}</td>
                    <td>${escapeHtml(r.situacao || '—')}</td>
                    <td>${r.chave_acesso ? '<span class="badge bg-success">XML</span>' : '—'}</td>
                    <td>${Number(r.financeiro?.total || 0) > 0 ? `${r.financeiro.total} lanç.` : '—'}</td>
                    <td>${escapeHtml(r.usuario || '—')}</td>
                </tr>`).join('');
            const html = `
                <div class="modal fade" id="relatorioUsoConsumoModal" tabindex="-1">
                    <div class="modal-dialog modal-xl modal-dialog-scrollable">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Compras de Uso e Consumo</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <p class="text-muted">Entradas simplificadas — sem movimentação de estoque.</p>
                                <div class="table-responsive">
                                    <table class="table table-sm table-striped">
                                        <thead><tr>
                                            <th>Data</th><th>Fornecedor</th><th>NF</th><th>Valor</th>
                                            <th>Situação</th><th>XML</th><th>Financeiro</th><th>Usuário</th>
                                        </tr></thead>
                                        <tbody>${linhas || '<tr><td colspan="8">Nenhum registro.</td></tr>'}</tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>`;
            $('#relatorioUsoConsumoModal').remove();
            $('body').append(html);
            new bootstrap.Modal(document.getElementById('relatorioUsoConsumoModal')).show();
        })
        .fail(function(xhr) {
            showNotification(xhr.responseJSON?.error || 'Erro ao carregar relatório.', 'danger');
        });
}

function obterHelpersCnpjCompra() {
    return (typeof ComprasFornecedorCnpjRc831 !== 'undefined' && ComprasFornecedorCnpjRc831)
        ? ComprasFornecedorCnpjRc831
        : null;
}

function garantirCompraImportadaXml() {
    if (!compraImportadaXml) compraImportadaXml = {};
}

function obterCnpjCompraDigitos() {
    const helpers = obterHelpersCnpjCompra();
    const raw = $('#fornecedor_cnpj').val() || '';
    return helpers ? helpers.digitsOnly(raw) : String(raw).replace(/\D/g, '');
}

function atualizarAlertaCnpjXmlDivergente() {
    const container = $('#alertaCnpjXmlDivergente');
    if (!container.length) return;

    const helpers = obterHelpersCnpjCompra();
    const diverge = helpers
        && cnpjEmitenteXmlOriginal
        && helpers.divergeCnpjXml(obterCnpjCompraDigitos(), cnpjEmitenteXmlOriginal);

    if (diverge) {
        container.show();
    } else {
        container.hide();
    }
}

function aplicarDadosFornecedorEncontrado(fornecedor) {
    if (!fornecedor) return;

    const helpers = obterHelpersCnpjCompra();
    garantirCompraImportadaXml();

    $('#fornecedor').val(fornecedor.nome || fornecedor.razao_social || '');
    if (fornecedor.cpf_cnpj) {
        $('#fornecedor_cnpj').val(typeof formatarCpfCnpj === 'function'
            ? formatarCpfCnpj(fornecedor.cpf_cnpj)
            : fornecedor.cpf_cnpj);
    }

    if (helpers) {
        Object.assign(compraImportadaXml, helpers.mapFornecedorParaCompraImportada(fornecedor));
    } else {
        compraImportadaXml.fornecedor = fornecedor.nome || fornecedor.razao_social || '';
        compraImportadaXml.fornecedor_cnpj = String(fornecedor.cpf_cnpj || '').replace(/\D/g, '');
    }
}

function buscarFornecedorPorCnpj(cnpjDigitos) {
    if (!cnpjDigitos) return $.Deferred().resolve().promise();

    return $.ajax({
        url: `${API_URL}/fornecedores?busca=${encodeURIComponent(cnpjDigitos)}`,
        method: 'GET'
    }).then(function(lista) {
        const candidatos = Array.isArray(lista) ? lista : [];
        const exato = candidatos.find((f) => {
            const doc = String(f.cpf_cnpj || '').replace(/\D/g, '');
            return doc === cnpjDigitos;
        });
        if (exato) {
            aplicarDadosFornecedorEncontrado(exato);
        }
    }).catch(function() {
        /* fornecedor inexistente — fluxo de auto-cadastro no save */
    });
}

function onFornecedorCnpjInput(input) {
    if (input && typeof formatCpfCnpjInput === 'function') {
        formatCpfCnpjInput(input);
    }
    atualizarAlertaCnpjXmlDivergente();
}

function onFornecedorCnpjBlur() {
    const helpers = obterHelpersCnpjCompra();
    const cnpjInformado = obterCnpjCompraDigitos();
    const cnpjAnterior = compraImportadaXml?.fornecedor_cnpj
        ? String(compraImportadaXml.fornecedor_cnpj).replace(/\D/g, '')
        : '';

    if (cnpjInformado && helpers && !helpers.validarCnpjCompra(cnpjInformado)) {
        showNotification('CNPJ inválido. Informe um CNPJ com 14 dígitos válidos.', 'warning');
        atualizarAlertaCnpjXmlDivergente();
        return;
    }

    garantirCompraImportadaXml();
    compraImportadaXml.fornecedor_cnpj = cnpjInformado;

    atualizarAlertaCnpjXmlDivergente();

    if (cnpjInformado.length === 14) {
        buscarFornecedorPorCnpj(cnpjInformado).always(function() {
            if (cnpjInformado !== cnpjAnterior && itensCompraAtual.length > 0) {
                carregarSugestoesMiipXml();
            }
        });
        return;
    }

    if (cnpjInformado !== cnpjAnterior && itensCompraAtual.length > 0) {
        carregarSugestoesMiipXml();
    }
}

function loadCompras() {
    carregarConfigBonificacaoCompra();
    $.when(
        $.ajax({ url: `${API_URL}/produtos`, method: 'GET' }),
        $.ajax({ url: `${API_URL}/compras`, method: 'GET' }),
        $.ajax({ url: `${API_URL}/fornecedores`, method: 'GET' })
    ).done(function(produtosResp, comprasResp, fornecedoresResp) {
        produtosCompraList = produtosResp[0] || [];
        fornecedoresList = fornecedoresResp[0] || [];
        renderCompras(comprasResp[0] || []);
        consumirPendenciaCompraCentral();
    }).fail(function() {
        $('#page-content').html('<div class="alert alert-danger">Erro ao carregar compras.</div>');
    });
}

function renderCompras(compras) {
    const shell = (typeof CdsPageShell !== 'undefined' && CdsPageShell.renderHeader)
        ? CdsPageShell.renderHeader({ page: 'compras' })
        : '';
    const html = `
        ${shell}
        <div class="card">
            <div class="card-header d-flex justify-content-between align-items-center">
                <div><i class="fas fa-cart-plus"></i> Compras</div>
                <div>
                    <button class="btn btn-outline-secondary btn-sm me-1" onclick="abrirRelatorioUsoConsumo()" title="Relatório de entradas simplificadas">
                        <i class="fas fa-clipboard-list"></i> Uso e Consumo
                    </button>
                    <button class="btn btn-outline-primary btn-sm me-1" onclick="abrirCentralInteligenteEntradas()" title="Documentos fiscais entram pela Central Inteligente">
                        📥 Importar pela Central Inteligente
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="showCompraModal()"><i class="fas fa-plus"></i> Nova compra</button>
                </div>
            </div>
            <div class="card-body">
                <div class="alert alert-info">
                    Ao salvar a compra, o sistema dá entrada no estoque, atualiza custo/preço de venda e lança a despesa automaticamente no financeiro.
                </div>
                <div class="table-responsive">
                    <table class="table table-striped table-hover">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Data</th>
                                <th>Fornecedor</th>
                                <th>Total</th>
                                <th>Condição</th>
                                <th>Forma</th>
                                <th>Status</th>
                                <th>Pendências</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${compras.map(c => `
                                <tr>
                                    <td>${c.id || '-'}</td>
                                    <td>${formatDate(c.data_compra)}</td>
                                    <td>${c.fornecedor || '-'}${c.tipo_entrada === 'USO_CONSUMO' ? ' <span class="badge bg-dark">USO E CONSUMO</span>' : ''}</td>
                                    <td>${formatCurrency(c.total)}</td>
                                    <td>${rotuloCondicaoPagamento(c.condicao_pagamento || 'avista')}</td>
                                    <td>${rotuloFormaPagamento(c.forma_pagamento)}</td>
                                    <td>${formatBadgeStatusCompra(c.status)}</td>
                                    <td>${c.parcelas_pendentes || 0}</td>
                                    <td>
                                        <button class="btn btn-sm btn-info" onclick="viewCompra(${c.id})" title="Visualizar">
                                            <i class="fas fa-eye"></i>
                                        </button>

                                        <button class="btn btn-sm btn-secondary" onclick="abrirDevolucaoCompra(${c.id})" title="Devolução interna">
                                            <i class="fas fa-undo"></i>
                                        </button>

                                        ${(() => {
                                            const chaveOk = String(c.chave_acesso || '').replace(/\D/g, '').length === 44;
                                            if (!chaveOk) return '';
                                            const comprada = Number(c.qtd_comprada_total || 0);
                                            const devolvida = Number(c.qtd_devolvida_fiscal || 0);
                                            const totalDev = comprada > 0 && devolvida >= comprada - 1e-9;
                                            const parcial = devolvida > 0 && !totalDev;
                                            const titulo = totalDev
                                              ? 'Compra totalmente devolvida'
                                              : (parcial ? 'Emitir nova NF-e de Devolução (parcial)' : 'Emitir NF-e de Devolução');
                                            const label = totalDev
                                              ? 'Devolução total'
                                              : (parcial ? 'Devolver saldo' : 'Emitir NF-e de Devolução');
                                            return `
                                        <button class="btn btn-sm btn-danger"
                                            onclick="abrirModalNFeDevolucaoCompra(${c.id})"
                                            title="${titulo}"
                                            ${totalDev ? 'disabled' : ''}>
                                            <i class="fas fa-file-invoice"></i> ${label}
                                        </button>`;
                                        })()}

                                        <button class="btn btn-sm btn-warning" onclick="cancelarCompra(${c.id})" title="Cancelar compra">
                                            <i class="fas fa-ban"></i>
                                        </button>
                                    </td>
                                </tr>
                            `).join('') || '<tr><td colspan="9" class="text-center">Nenhuma compra registrada.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    $('#page-content').html(html);
}

function formatBadgeStatusCompra(status) {
    const badges = {
        'normal': '<span class="badge bg-success">Normal</span>',
        'devolvida_parcial': '<span class="badge bg-warning text-dark"><i class="fas fa-undo"></i> Devolvido Parcial</span>',
        'devolvida': '<span class="badge bg-danger"><i class="fas fa-undo"></i> Devolvido Total</span>',
        'cancelada': '<span class="badge bg-secondary"><i class="fas fa-ban"></i> Cancelada</span>'
    };
    return badges[status] || '<span class="badge bg-success">Normal</span>';
}

function rotuloCondicaoPagamento(value) {
    const mapa = {
        avista: 'À vista',
        prazo: 'À prazo',
        parcelado: 'À prazo',
        entrada_parcelado: 'À prazo'
    };
    return mapa[value] || value || '-';
}

function rotuloFormaPagamento(value) {
    const mapa = {
        dinheiro: 'Dinheiro',
        pix: 'PIX',
        cartao_credito: 'Cartão crédito',
        cartao_debito: 'Cartão débito',
        boleto: 'Boleto',
        transferencia: 'Transferência',
        cheque: 'Cheque',
        credito_loja: 'Crédito Loja',
        vale_alimentacao: 'Vale Alimentação',
        vale_refeicao: 'Vale Refeição',
        vale_presente: 'Vale Presente',
        vale_combustivel: 'Vale Combustível',
        deposito: 'Depósito Bancário',
        programa_fidelidade: 'Programa Fidelidade',
        sem_pagamento: 'Sem Pagamento',
        outro: 'Outros'
    };
    return mapa[value] || '-';
}

function formasPagamentoCompra(selected = '') {
    const opcoes = [
        ['dinheiro', 'Dinheiro'],
        ['pix', 'PIX'],
        ['cartao_credito', 'Cartão crédito'],
        ['cartao_debito', 'Cartão débito'],
        ['boleto', 'Boleto'],
        ['transferencia', 'Transferência'],
        ['cheque', 'Cheque'],
        ['credito_loja', 'Crédito Loja'],
        ['deposito', 'Depósito Bancário'],
        ['vale_alimentacao', 'Vale Alimentação'],
        ['vale_refeicao', 'Vale Refeição'],
        ['vale_presente', 'Vale Presente'],
        ['vale_combustivel', 'Vale Combustível'],
        ['programa_fidelidade', 'Programa Fidelidade'],
        ['sem_pagamento', 'Sem Pagamento'],
        ['outro', 'Outros']
    ];
    return opcoes.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function obterTotalNotaCompraParaParcelas() {
    return Number($('#valor_total_nota').val())
        || itensCompraAtual.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
        || 0;
}

function moedaParcelaCompra(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
}

function adicionarDiasDataCompra(dataIso, dias) {
    const base = String(dataIso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return base;
    const [y, m, d] = base.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + Number(dias || 0));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** BUG3 — evita perda de foco: detecta type="date" ativo dentro do modal de compra. */
function obterInputDataCompraEmFoco() {
    const el = document.activeElement;
    if (!el || el.tagName !== 'INPUT' || el.type !== 'date') return null;
    const modal = document.getElementById('compraModal');
    return modal && modal.contains(el) ? el : null;
}

function compraModalDatasEmEdicao() {
    return obterInputDataCompraEmFoco() != null;
}

function agendarRenderItensCompraTabela() {
    if (compraRenderItensAgendado != null) return;
    compraRenderItensAgendado = window.setTimeout(() => {
        compraRenderItensAgendado = null;
        if (compraModalDatasEmEdicao()) {
            agendarRenderItensCompraTabela();
            return;
        }
        renderItensCompraTabelaCore();
    }, 120);
}

function agendarRegenerarGradeParcelasCompra(forcar = true) {
    if (compraParcelasRegenerarAgendado != null) return;
    compraParcelasRegenerarAgendado = window.setTimeout(() => {
        compraParcelasRegenerarAgendado = null;
        if (compraModalDatasEmEdicao()) {
            agendarRegenerarGradeParcelasCompra(forcar);
            return;
        }
        regenerarGradeParcelasCompra(forcar);
    }, 120);
}

function vincularEventosDatasCompraModal() {
    $('#data_compra, #data_emissao, #data_entrada, #data_vencimento, #data_validade_item')
        .off('blur.compraDatas')
        .on('blur.compraDatas', function () {
            if (this.id === 'data_vencimento') {
                onParametroParcelamentoCompraAlterado();
            }
        });
}

/** RC8.5.2 — grade sempre gerada (à vista = 1 parcela; à prazo = N). */
function condicaoCompraUsaParcelasFlexiveis(condicao) {
    return condicao === 'avista' || condicao === 'prazo'
        || condicao === 'parcelado' || condicao === 'entrada_parcelado';
}

function gerarGradeParcelasCompraAutomatica() {
    if (parcelasImportadasXml) {
        return parcelasCompraGrade.length ? parcelasCompraGrade.map((p) => ({ ...p })) : [];
    }
    const total = moedaParcelaCompra(obterTotalNotaCompraParaParcelas());
    const dataBase = $('#data_vencimento').val() || $('#data_compra').val();
    const condicao = $('#condicao_pagamento').val();
    const qtd = condicao === 'avista'
        ? 1
        : Math.max(1, parseInt($('#parcelas').val(), 10) || 1);
    const dias = condicao === 'avista'
        ? 0
        : Math.max(0, parseInt($('#dias_entre_parcelas').val(), 10) || 0);
    const primeiro = dataBase;

    const base = Math.floor((total / qtd) * 100) / 100;
    const resto = moedaParcelaCompra(total - base * qtd);
    const parcelas = [];
    for (let i = 0; i < qtd; i += 1) {
        parcelas.push({
            numero: i + 1,
            vencimento: adicionarDiasDataCompra(primeiro, dias * i),
            valor: moedaParcelaCompra(base + (i === qtd - 1 ? resto : 0)),
            tipo: 'parcela'
        });
    }
    return parcelas;
}

function validarSomaParcelasCompraGrade(grade, totalNota) {
    const total = moedaParcelaCompra(totalNota);
    const soma = moedaParcelaCompra((grade || []).reduce((s, p) => s + Number(p.valor || 0), 0));
    const diferenca = moedaParcelaCompra(soma - total);
    if (Math.abs(diferenca) < 0.005) {
        return { ok: true, soma, diferenca: 0, mensagem: null };
    }
    if (diferenca < 0) {
        return {
            ok: false,
            soma,
            diferenca,
            mensagem: `Faltam: ${typeof formatCurrency === 'function' ? formatCurrency(Math.abs(diferenca)) : `R$ ${Math.abs(diferenca).toFixed(2)}`}`
        };
    }
    return {
        ok: false,
        soma,
        diferenca,
        mensagem: `Excesso: ${typeof formatCurrency === 'function' ? formatCurrency(diferenca) : `R$ ${diferenca.toFixed(2)}`}`
    };
}

function atualizarResumoValidacaoParcelasCompra() {
    const $box = $('#parcelas_detalhes');
    if (!$box.length || !parcelasCompraGrade.length) return;

    const total = obterTotalNotaCompraParaParcelas();
    const validacao = validarSomaParcelasCompraGrade(parcelasCompraGrade, total);
    const alerta = validacao.ok
        ? `<span class="text-success"><i class="fas fa-check-circle"></i> Total das parcelas confere com a nota.</span>`
        : `<span class="text-danger fw-semibold"><i class="fas fa-exclamation-triangle"></i> ${validacao.mensagem}</span>`;
    const somaTxt = typeof formatCurrency === 'function'
        ? formatCurrency(validacao.soma)
        : validacao.soma.toFixed(2);

    $box.find('.parcelas-compra-alerta').html(alerta);
    $box.find('.parcelas-compra-soma').text(somaTxt);
}

function renderizarGradeParcelasCompra() {
    const condicao = $('#condicao_pagamento').val();
    const $box = $('#parcelas_detalhes');
    if (!$box.length) return;

    if (!condicaoCompraUsaParcelasFlexiveis(condicao) || !parcelasCompraGrade.length) {
        $box.html('');
        return;
    }

    const total = obterTotalNotaCompraParaParcelas();
    const validacao = validarSomaParcelasCompraGrade(parcelasCompraGrade, total);
    const alerta = validacao.ok
        ? `<span class="text-success"><i class="fas fa-check-circle"></i> Total das parcelas confere com a nota.</span>`
        : `<span class="text-danger fw-semibold"><i class="fas fa-exclamation-triangle"></i> ${validacao.mensagem}</span>`;

    const linhas = parcelasCompraGrade.map((p, idx) => `
        <tr data-parcela-idx="${idx}">
            <td class="text-center align-middle">${p.numero}${p.tipo === 'entrada' ? ' <small class="text-muted">(entrada)</small>' : ''}</td>
            <td class="align-middle small text-muted">${p.documento ? escapeHtml(String(p.documento)) : '—'}</td>
            <td>
                <input type="date" class="form-control form-control-sm parcela-vencimento-compra"
                    value="${p.vencimento || ''}" data-idx="${idx}">
            </td>
            <td>
                <input type="number" step="0.01" min="0" class="form-control form-control-sm parcela-valor-compra"
                    value="${Number(p.valor || 0).toFixed(2)}" data-idx="${idx}">
            </td>
        </tr>
    `).join('');

    $box.html(`
        <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="mb-0">Parcelas / Duplicatas</h6>
            <div class="small parcelas-compra-alerta">${alerta}</div>
        </div>
        <div class="table-responsive">
            <table class="table table-sm table-bordered mb-1" id="tabela_parcelas_compra">
                <thead class="table-light">
                    <tr><th style="width:70px">Nº</th><th style="width:90px">Dup.</th><th>Vencimento</th><th style="width:160px">Valor</th></tr>
                </thead>
                <tbody>${linhas}</tbody>
                <tfoot>
                    <tr>
                        <td colspan="3" class="text-end fw-semibold">Soma</td>
                        <td class="fw-semibold parcelas-compra-soma">${typeof formatCurrency === 'function' ? formatCurrency(validacao.soma) : validacao.soma.toFixed(2)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
        <small class="text-muted">Duplicatas importadas do XML (grupo cobr/dup). Altere vencimentos ou valores se necessário.</small>
    `);

    $box.find('.parcela-vencimento-compra').off('blur.rc850').on('blur.rc850', function () {
        const idx = Number($(this).data('idx'));
        if (!parcelasCompraGrade[idx]) return;
        parcelasCompraGrade[idx].vencimento = $(this).val();
        parcelasCompraEditadasManual = true;
        atualizarResumoValidacaoParcelasCompra();
    });
    $box.find('.parcela-valor-compra').off('blur.rc850').on('blur.rc850', function () {
        const idx = Number($(this).data('idx'));
        if (!parcelasCompraGrade[idx]) return;
        parcelasCompraGrade[idx].valor = moedaParcelaCompra($(this).val());
        parcelasCompraEditadasManual = true;
        atualizarResumoValidacaoParcelasCompra();
    });
}

function regenerarGradeParcelasCompra(forcar = false) {
    const condicao = $('#condicao_pagamento').val();
    if (!condicaoCompraUsaParcelasFlexiveis(condicao)) {
        if (!parcelasImportadasXml) {
            parcelasCompraGrade = [];
            parcelasCompraEditadasManual = false;
            $('#parcelas_detalhes').html('');
        }
        return;
    }

    // RC4.31.14 — grade XML nunca é substituída por regeneração automática
    if (parcelasImportadasXml && parcelasCompraGrade.length > 0) {
        renderizarGradeParcelasCompra();
        atualizarResumoValidacaoParcelasCompra();
        return;
    }

    const aplicar = () => {
        if (parcelasImportadasXml) return;
        parcelasCompraGrade = gerarGradeParcelasCompraAutomatica();
        parcelasCompraEditadasManual = false;
        renderizarGradeParcelasCompra();
    };

    if (!forcar && (parcelasCompraEditadasManual || parcelasImportadasXml)) {
        const ok = window.confirm(
            'As parcelas foram alteradas manualmente ou importadas do XML.\n\nDeseja recalcular os vencimentos?'
        );
        if (!ok) return;
        parcelasImportadasXml = false;
    }
    aplicar();
}

function onParametroParcelamentoCompraAlterado() {
    regenerarGradeParcelasCompra(false);
}

function atualizarVisibilidadePagamentoCompra() {
    const condicao = $('#condicao_pagamento').val() || 'avista';
    const avista = condicao === 'avista';

    $('#grupo_vencimento_compra').show();
    $('#grupo_parcelas_compra').show();
    $('#grupo_dias_parcelas_compra').show();
    $('#grupo_entrada_compra').hide();
    $('#valor_entrada').val(0);
    $('#label_parcelas_compra').text('Quantidade de Parcelas');

    if (avista) {
        $('#parcelas').val(1).prop('disabled', true);
        $('#dias_entre_parcelas').val(0).prop('disabled', true);
        if (!$('#data_vencimento').val()) {
            $('#data_vencimento').val($('#data_compra').val() || '');
        }
    } else {
        $('#parcelas').prop('disabled', false);
        $('#dias_entre_parcelas').prop('disabled', false);
        if (parseInt($('#parcelas').val(), 10) < 1) $('#parcelas').val(1);
        if ($('#dias_entre_parcelas').val() === '' || parseInt($('#dias_entre_parcelas').val(), 10) < 0) {
            $('#dias_entre_parcelas').val(30);
        }
    }

    // RC4.31.3 / RC4.31.14 — preserva duplicatas importadas do XML (cobr/dup)
    if ((parcelasImportadasXml || parcelasCompraEditadasManual) && parcelasCompraGrade.length > 0) {
        renderizarGradeParcelasCompra();
    } else {
        regenerarGradeParcelasCompra(true);
    }
}

/** @deprecated nome legado — RC8.5.0 usa regenerarGradeParcelasCompra */
function calcularParcelasCompra() {
    regenerarGradeParcelasCompra(!parcelasCompraEditadasManual);
}

function formatNumberInput(value, decimals = 2) {
    const num = Number(value || 0);
    return Number.isFinite(num) ? num.toFixed(decimals) : Number(0).toFixed(decimals);
}

/** Exibição enxuta: 6 em vez de 6,000 — mantém decimais só quando necessário. */
function formatQuantidadeExibicao(value, maxDecimals = 3) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '0';
    const fixed = num.toFixed(maxDecimals);
    if (!fixed.includes('.')) return fixed;
    return fixed.replace(/0+$/, '').replace(/\.$/, '');
}

if (typeof window !== 'undefined') {
    window.formatQuantidadeExibicao = formatQuantidadeExibicao;
}

/** RC4.31.19 — delega ao motor canônico (motor-quantidade-compra.js) */
function obterQuantidadeComercialItemCompra(item = {}) {
    if (typeof obterQuantidadeComercial === 'function') return obterQuantidadeComercial(item);
    return Number(item.quantidade_comercial || item.quantidade_embalagens || item.quantidade || 0);
}

function obterQuantidadeConvertidaItemCompra(item = {}) {
    if (typeof obterQuantidadeConvertida === 'function') return obterQuantidadeConvertida(item);
    const emb = Number(item.quantidade_embalagens || 0) * Number(item.quantidade_por_embalagem || 0);
    return Number(item.quantidade_convertida || item.peso_total_compra || 0) || emb || Number(item.quantidade || 0);
}

/** @deprecated RC4.31.19 — use obterQuantidadeConvertidaItemCompra */
function obterTotalConvertidoItemCompraSalvo(item = {}) {
    return obterQuantidadeConvertidaItemCompra(item);
}

/** Motor de Conversão de Unidades — embalagem de compra → unidade de estoque/venda */
function produtoUsaConversaoUnidadesCompra(produto) {
    if (typeof produtoUsaConversaoUnidades === 'function') return produtoUsaConversaoUnidades(produto);
    if (typeof window.produtoUsaConversaoUnidades === 'function') return window.produtoUsaConversaoUnidades(produto);
    if (typeof window.produtoEhFracionado === 'function') return window.produtoEhFracionado(produto);
    return Number(produto?.produto_fracionado ?? produto?.vendido_por_peso ?? 0) === 1;
}

const produtoFracionadoCompra = produtoUsaConversaoUnidadesCompra;

function itemCompraUsaConversaoUnidades(item = {}) {
    return Number(item.produto_fracionado ?? item.vendido_por_peso ?? 0) === 1;
}

const itemCompraEhFracionado = itemCompraUsaConversaoUnidades;

const TIPOS_COMPRA_EMBALAGEM = ['Rolo', 'Bobina', 'Caixa', 'Fardo', 'Galão', 'Tambor', 'Pacote'];

function pluralizarTipoEmbalagem(tipo, quantidade) {
    const qtd = Number(quantidade || 0);
    if (qtd === 1) return tipo;
    const irregulares = { 'Galão': 'Galões', 'Tambor': 'Tambores' };
    return irregulares[tipo] || `${tipo}s`;
}

function opcoesCompraEmbalagemHtml(selecionado = 'Rolo') {
    return TIPOS_COMPRA_EMBALAGEM.map((tipo) => {
        const selected = String(selecionado) === tipo ? ' selected' : '';
        return `<option value="${tipo}"${selected}>${tipo}</option>`;
    }).join('');
}

function formatarCustoUnitarioVenda(value) {
    return formatNumberInput(value, 4);
}

function obterRotuloCompraEmAtual() {
    const embSel = embalagensProdutoCompraAtual.find(
        (e) => String(e.id) === String($('#embalagem_compra_item').val())
    );
    if (embSel && !embSel._acao) {
        return formatarRotuloOpcaoCompraComercial(embSel).split(' (')[0];
    }
    return String($('#compra_em_item').val() || 'UN');
}

async function aprenderUnidadeComercialAutomaticaNoProduto(produto, embSel) {
    if (!produto?.id || !embSel || embSel._acao) return produto;
    if (typeof ProdutoApresentacaoResolver !== 'undefined') {
        if (ProdutoApresentacaoResolver.ehOpcaoUnidadeBase(embSel)) return produto;
        if (ProdutoApresentacaoResolver.ehOpcaoNovaUnidadeComercial(embSel)) return produto;
    }
    if (embSel.somente_compra || String(embSel.id || '').startsWith('temp-')) return produto;
    if (embSel.embalagem_ref_id || (embSel.id && !String(embSel.id).startsWith('uc-') && !String(embSel.id).startsWith('legado-'))) {
        return produto;
    }

    const quantidade = Number($('#quantidade_por_embalagem_item').val() || embSel.quantidade || embSel.quantidade_por_embalagem || 0);
    const descricao = String(embSel.descricao || obterRotuloCompraEmAtual() || '').trim();
    if (!descricao || !(quantidade > 0)) return produto;

    const jaCadastrada = (produto.embalagens || []).some((e) => {
        const d = String(e.descricao || '').trim().toLowerCase();
        const q = Number(e.quantidade ?? e.quantidade_por_embalagem ?? 0);
        return d === descricao.toLowerCase() && Math.abs(q - quantidade) < 0.0001;
    });
    if (jaCadastrada) return produto;

    const payload = ProdutoApresentacaoResolver.montarEmbalagemAprendidaCompra({
        descricao,
        quantidade,
        unidade: embSel.unidade || produto.unidade,
        tipo: embSel.tipo || 'ROLO',
        compra: 1,
        venda: Number(embSel.venda ?? 1) === 1 ? 1 : 0
    }, produto);

    const atualizado = await persistirUnidadeComercialNoCadastroProduto(produto, payload);
    showNotification(`Unidade "${descricao}" salva automaticamente no cadastro do produto.`, 'success');
    return atualizado;
}

function obterProdutoSelecionadoCompra() {
    const produtoId = $('#produto_id_item').val();
    if (!produtoId) return null;
    return produtosCompraList.find(p => String(p.id) === String(produtoId)) || null;
}

function isModoPainelEmbalagemCompraAtivo() {
    return obterModoPainelEmbalagemCompra(obterProdutoSelecionadoCompra()) !== null;
}

function isModoEmbalagemComercialCompraAtivo() {
    return obterModoPainelEmbalagemCompra(obterProdutoSelecionadoCompra()) === 'COMERCIAL';
}

function isModoConversaoUnidadesCompraAtivo() {
    return produtoUsaConversaoUnidadesCompra(obterProdutoSelecionadoCompra());
}

const isModoFracionadoCompraAtivo = isModoConversaoUnidadesCompraAtivo;

function calcularConversaoEmbalagemCompra() {
    agendarSimulacaoMucCompra();
    return ultimaSimulacaoMucCompra ? {
        qtdTotal: Number(ultimaSimulacaoMucCompra.quantidadeEstoque || 0),
        custoUnitario: Number(ultimaSimulacaoMucCompra.custoUnitario || 0),
        valorTotal: obterValorTotalCompraMuc() || Number(ultimaSimulacaoMucCompra.custoTotal || 0),
        unidade: String($('#unidade_fracionada_item').val() || 'UN').toUpperCase(),
        compraEm: String($('#compra_em_item').val() || 'UN'),
        muc: ultimaSimulacaoMucCompra
    } : null;
}

function aplicarLayoutPainelEmbalagemCompra() {
    const ativo = Boolean(modoPainelEmbalagemCompra);
    const comercial = modoPainelEmbalagemCompra === 'COMERCIAL';

    $('#painelConversaoEmbalagem').toggleClass('d-none', !ativo);
    $('#embalagemCompraRow').toggleClass('d-none', !ativo);
    $('#painelConteudoEmbalagensWrap').toggleClass('d-none', !ativo);
    $('#campoQuantidadeSimplesCompra').toggleClass('d-none', ativo);
    $('#colCompraEmLegado').addClass('d-none');
    $('#label_qtd_embalagens_compra').text(comercial ? 'Quantidade' : 'Quantidade Comprada');

    if (ativo && comercial) {
        $('#painelConversaoEmbalagem .card-header strong').text('Compra por Embalagem');
        $('#painelConversaoEmbalagem .card-header small').text('Conversão automática via MUC');
    } else if (ativo) {
        $('#painelConversaoEmbalagem .card-header strong').text('Motor de Conversão de Unidades');
        $('#painelConversaoEmbalagem .card-header small').text('Ex.: 10 Rolos × 50 MT = 500 MT');
    } else {
        embalagensProdutoCompraAtual = [];
        ultimaSimulacaoMucCompra = null;
        restaurandoEmbalagemCompraEdicao = null;
        $('#custo_unitario_fracionado_item').val('');
        $('#painelResumoConversaoMuc').addClass('d-none').html('');
    }
    atualizarRotuloPrecoCompraItem();
}

function finalizarPainelEmbalagemComercialCompra(produto) {
    renderSelectEmbalagemCompra();
    renderPainelConteudoEmbalagensCompra();

    if (restaurandoEmbalagemCompraEdicao) {
        const r = restaurandoEmbalagemCompraEdicao;
        let embId = r.embalagem_id;
        if (embId && !$(`#embalagem_compra_item option[value="${embId}"]`).length) {
            embId = null;
        }
        if (!embId && r.compra_em) {
            const porTipo = embalagensProdutoCompraAtual.find(
                (e) => String(e.tipo || e.unidade_comercial || '').toUpperCase() === String(r.compra_em).toUpperCase()
            );
            embId = porTipo?.id || null;
        }
        if (embId) {
            $('#embalagem_compra_item').val(String(embId));
        }
        aplicarEmbalagemCompraSelecionada($('#embalagem_compra_item').val() || embalagensProdutoCompraAtual[0]?.id, {
            preservarQuantidade: true,
            preservarPreco: true,
            preservarFator: true
        });
        $('#quantidade_embalagens_item').val(formatQuantidadeExibicao(r.quantidade_embalagens || 1, 3));
        $('#quantidade_por_embalagem_item').val(formatQuantidadeExibicao(r.quantidade_por_embalagem || 0, 3));
        // RC4.31.29 — #preco_item via resolver; nunca gravar 0 se houver preço válido
        const resolvidoPreco = obterPrecoUnitarioCompraFormulario(r);
        if (resolvidoPreco.valor > 0) {
            $('#preco_item').val(formatNumberInput(resolvidoPreco.valor, 2));
        }
        if (r.compra_em) {
            $('#compra_em_item').val(r.compra_em);
        }
        restaurandoEmbalagemCompraEdicao = null;
        agendarSimulacaoMucCompra();
        return;
    }

    const ultima = obterUltimaEmbalagemCompraProduto(produto.id);
    const unidadeBase = embalagensProdutoCompraAtual.find(
        (e) => typeof ProdutoApresentacaoResolver !== 'undefined' && ProdutoApresentacaoResolver.ehOpcaoUnidadeBase(e)
    );
    const embPadrao = embalagensProdutoCompraAtual.find((e) => String(e.id) === String(ultima))
        || embalagensProdutoCompraAtual.find((e) => Number(e.principal) === 1 && !e._acao)
        || embalagensProdutoCompraAtual.find((e) => e.tipo_origem_compra === 'UNIDADE_COMERCIAL' && !e._acao)
        || unidadeBase
        || embalagensProdutoCompraAtual.find((e) => !e._acao);
    if (embPadrao && !embPadrao._acao) {
        aplicarEmbalagemCompraSelecionada(embPadrao.id || '');
        embalagemCompraSelecionadaAnterior = String(embPadrao.id || '');
    } else {
        agendarSimulacaoMucCompra();
    }
}

function atualizarPainelConversaoUnidadesCompra() {
    const produto = obterProdutoSelecionadoCompra();

    if (!produto?.id) {
        modoPainelEmbalagemCompra = null;
        aplicarLayoutPainelEmbalagemCompra();
        atualizarCamposQuantidadeCompra();
        return;
    }

    const fracionado = produtoUsaConversaoUnidadesCompra(produto);
    const produtoId = produto.id;

    if (fracionado) {
        modoPainelEmbalagemCompra = 'FRACIONADO';
        $('#unidade_fracionada_item').val(String(produto.unidade || 'UN').toUpperCase());
        if (!$('#quantidade_embalagens_item').val()) {
            $('#quantidade_embalagens_item').val('1');
        }
    } else {
        modoPainelEmbalagemCompra = Number(produto.compra_por_embalagem || 0) === 1 ? 'COMERCIAL' : null;
    }

    if (!modoPainelEmbalagemCompra) {
        aplicarLayoutPainelEmbalagemCompra();
        atualizarCamposQuantidadeCompra();
        return;
    }

    carregarEmbalagensProdutoCompra(produto).then(() => {
        const atual = obterProdutoSelecionadoCompra();
        if (!atual || String(atual.id) !== String(produtoId)) return;

        if (!fracionado) {
            modoPainelEmbalagemCompra = Number(atual.compra_por_embalagem || 0) === 1 ? 'COMERCIAL' : null;
        }

        if (modoPainelEmbalagemCompra) {
            $('#unidade_fracionada_item').val(String(atual.unidade || 'UN').toUpperCase());
            if (!$('#quantidade_embalagens_item').val()) {
                $('#quantidade_embalagens_item').val('1');
            }
        }

        aplicarLayoutPainelEmbalagemCompra();

        if (modoPainelEmbalagemCompra) {
            finalizarPainelEmbalagemComercialCompra(atual);
        }

        atualizarCamposQuantidadeCompra();
    });
}

const atualizarPainelFracionadoCompra = atualizarPainelConversaoUnidadesCompra;

function isModoEntradaF7CompraAtivo() {
    if (isModoConversaoUnidadesCompraAtivo()) return true;
    return !!modoEntradaF7Compra;
}

function toggleModoEntradaF7Compra() {
    if (isModoConversaoUnidadesCompraAtivo()) {
        showNotification('Motor de Conversão de Unidades exige distribuição absoluta: Fiscal + Não Fiscal = total convertido.', 'info');
        return;
    }
    modoEntradaF7Compra = !modoEntradaF7Compra;
    atualizarCamposQuantidadeCompra();
    const status = modoEntradaF7Compra ? 'ativado' : 'desativado';
    showNotification(`Modo F7 (entrada fiscal/não fiscal) ${status}.`, 'info');
}

function obterTotalConvertidoItemCompra() {
    if (!isModoConversaoUnidadesCompraAtivo()) return null;

    const unidade = String($('#unidade_fracionada_item').val() || 'UN').toUpperCase();
    const qtdTotal = obterQuantidadeConvertidaItemCompra({
        quantidade_comercial: Number($('#quantidade_embalagens_item').val() || 0),
        quantidade_embalagens: Number($('#quantidade_embalagens_item').val() || 0),
        quantidade_por_embalagem: Number($('#quantidade_por_embalagem_item').val() || 0)
    });

    if (qtdTotal <= 0) return null;
    return { qtdTotal, unidade };
}

function validarDistribuicaoFiscalCompra(qtdFiscal, qtdNaoFiscal, totalConvertido, unidade = '') {
    const fiscal = Number(qtdFiscal || 0);
    const naoFiscal = Number(qtdNaoFiscal || 0);
    const total = Number(totalConvertido || 0);
    const soma = fiscal + naoFiscal;
    const unidadeLabel = unidade ? ` ${unidade}` : '';

    if (total <= 0) {
        return { ok: false, mensagem: 'Total convertido inválido.' };
    }
    if (soma <= 0) {
        return {
            ok: false,
            mensagem: `Informe quantidades absolutas${unidadeLabel}: Fiscal + Não Fiscal = ${formatQuantidadeExibicao(total, 3)}${unidadeLabel}.`
        };
    }
    if (Math.abs(soma - total) > 0.001) {
        return {
            ok: false,
            mensagem: `Fiscal + Não Fiscal deve somar ${formatQuantidadeExibicao(total, 3)}${unidadeLabel}. Informado: ${formatQuantidadeExibicao(fiscal, 3)} + ${formatQuantidadeExibicao(naoFiscal, 3)} = ${formatQuantidadeExibicao(soma, 3)}.`
        };
    }

    return { ok: true, fiscal, naoFiscal, total, soma };
}

function isOrigemCompraCentralNfe() {
    return origemCompraAtual === ORIGEM_COMPRA.CENTRAL_NFE;
}

function itemCompraEhTratamentoNaoFiscal(item = {}, tipoEntrada) {
    if (Number(item.item_fiscal) === 0) return true;
    const enriquecido = enriquecerItemFiscalCompraUi(clonarDadosItemCompra(item));
    if (enriquecido.tipo_fiscal_item === TIPOS_ENTRADA_COMPRA.USO_CONSUMO) return true;
    if (typeof TratamentoFiscalItemCompra !== 'undefined') {
        const trat = TratamentoFiscalItemCompra.classificarTratamentoFiscalItem(
            enriquecido,
            tipoEntrada || obterTipoEntradaSelecionado()
        );
        return trat.tipoFiscal === TIPOS_ENTRADA_COMPRA.USO_CONSUMO;
    }
    return (tipoEntrada || obterTipoEntradaSelecionado()) === TIPOS_ENTRADA_COMPRA.USO_CONSUMO;
}

/** RC4.31.16/19 — espelha Motor Fiscal/Não Fiscal sobre quantidade_convertida */
function calcularDistribuicaoFiscalMotorItem(item = {}, tipoEntrada) {
    const total = obterQuantidadeConvertidaItemCompra(item);
    if (total <= 0) {
        return { quantidade_fiscal: 0, quantidade_nao_fiscal: 0, total: 0, item_fiscal: 1 };
    }
    if (itemCompraEhTratamentoNaoFiscal(item, tipoEntrada)) {
        return { quantidade_fiscal: 0, quantidade_nao_fiscal: total, total, item_fiscal: 0 };
    }
    return { quantidade_fiscal: total, quantidade_nao_fiscal: 0, total, item_fiscal: 1 };
}

function aplicarDistribuicaoFiscalItemCentral(item, tipoEntrada) {
    if (!itemCompraEhFracionado(item)) return item;
    if (item.distribuicao_fiscal_editada_manual) return item;
    const dist = calcularDistribuicaoFiscalMotorItem(item, tipoEntrada);
    if (dist.total <= 0) return item;
    return sincronizarQuantidadesEstoqueItemCompra({
        ...clonarDadosItemCompra(item),
        quantidade_fiscal: dist.quantidade_fiscal,
        quantidade_nao_fiscal: dist.quantidade_nao_fiscal,
        item_fiscal: dist.item_fiscal,
        quantidade_convertida: dist.total,
        peso_total_compra: dist.total,
        quantidade: dist.total,
        distribuicao_fiscal_preenchida: true,
        origem_compra: ORIGEM_COMPRA.CENTRAL_NFE
    });
}

function aplicarDistribuicaoFiscalItensCentral(itens, tipoEntrada) {
    return (itens || []).map((item) => aplicarDistribuicaoFiscalItemCentral(item, tipoEntrada));
}

function itemCompraDistribuicaoFiscalValida(item) {
    if (!itemCompraEhFracionado(item)) return true;
    const total = obterQuantidadeConvertidaItemCompra(item);
    return validarDistribuicaoFiscalCompra(
        item.quantidade_fiscal,
        item.quantidade_nao_fiscal,
        total,
        String(item.unidade || '').toUpperCase()
    ).ok;
}

function deveExigirValidacaoDistribuicaoFiscalItem(item) {
    if (!itemCompraEhFracionado(item)) return false;
    if (isOrigemCompraCentralNfe()
        && item.distribuicao_fiscal_preenchida
        && itemCompraDistribuicaoFiscalValida(item)) {
        return false;
    }
    return true;
}

function atualizarIndicadorDistribuicaoFiscal(totalInformado, unidadeInformada) {
    const $painel = $('#painelIndicadorDistribuicaoFiscal');
    const $indicador = $('#indicadorDistribuicaoFiscal');
    if (!$indicador.length) return;

    if (!isModoConversaoUnidadesCompraAtivo()) {
        $painel.addClass('d-none');
        $indicador.addClass('d-none').removeClass('alert-success alert-warning alert-danger alert-info').text('');
        return;
    }

    $painel.removeClass('d-none');

    const totalInfo = obterTotalConvertidoItemCompra();
    const qtdTotal = Number(totalInformado ?? totalInfo?.qtdTotal ?? 0);
    const unidade = String(unidadeInformada || totalInfo?.unidade || 'UN').toUpperCase();

    if (qtdTotal <= 0) {
        $indicador.removeClass('d-none alert-success alert-warning alert-danger').addClass('alert alert-info py-2 mb-0');
        $indicador.text('Informe a conversão de embalagem para distribuir o estoque em valores absolutos.');
        return;
    }

    const qtdFiscal = Number($('#quantidade_fiscal_item').val() || 0);
    const qtdNaoFiscal = Number($('#quantidade_nao_fiscal_item').val() || 0);
    const soma = qtdFiscal + qtdNaoFiscal;
    const diff = Number((qtdTotal - soma).toFixed(3));
    const ok = Math.abs(diff) <= 0.001;

    $indicador.removeClass('d-none alert-success alert-warning alert-danger alert-info');

    if (soma === 0) {
        $indicador.addClass('alert alert-info py-2 mb-0');
        $indicador.html(`Informe <strong>valores absolutos</strong> em ${unidade}: Fiscal + Não Fiscal = <strong>${formatQuantidadeExibicao(qtdTotal, 3)} ${unidade}</strong>.`);
        return;
    }

    if (ok) {
        $indicador.addClass('alert alert-success py-2 mb-0');
        $indicador.html(`✓ ${formatQuantidadeExibicao(qtdFiscal, 3)} + ${formatQuantidadeExibicao(qtdNaoFiscal, 3)} = ${formatQuantidadeExibicao(qtdTotal, 3)} ${unidade}`);
        return;
    }

    if (soma < qtdTotal) {
        $indicador.addClass('alert alert-warning py-2 mb-0');
        $indicador.html(`${formatQuantidadeExibicao(qtdFiscal, 3)} + ${formatQuantidadeExibicao(qtdNaoFiscal, 3)} = ${formatQuantidadeExibicao(soma, 3)} ${unidade}. Faltam <strong>${formatQuantidadeExibicao(diff, 3)} ${unidade}</strong> para completar ${formatQuantidadeExibicao(qtdTotal, 3)}.`);
        return;
    }

    $indicador.addClass('alert alert-danger py-2 mb-0');
    $indicador.html(`${formatQuantidadeExibicao(qtdFiscal, 3)} + ${formatQuantidadeExibicao(qtdNaoFiscal, 3)} = ${formatQuantidadeExibicao(soma, 3)} ${unidade}. Excede o total convertido em <strong>${formatQuantidadeExibicao(Math.abs(diff), 3)} ${unidade}</strong>.`);
}

function atualizarCamposQuantidadeCompra() {
    const fracionado = isModoConversaoUnidadesCompraAtivo();
    const painelEmb = isModoPainelEmbalagemCompraAtivo();
    const ativo = fracionado || isModoEntradaF7CompraAtivo();
    const unidade = fracionado
        ? String($('#unidade_fracionada_item').val() || obterProdutoSelecionadoCompra()?.unidade || 'UN').toUpperCase()
        : '';

    $('#campoQuantidadeSimplesCompra').toggleClass('d-none', ativo || painelEmb);
    $('#campoQuantidadeFiscalCompra').toggleClass('d-none', !ativo);
    $('#campoQuantidadeNaoFiscalCompra').toggleClass('d-none', !ativo);

    if (fracionado) {
        $('#labelQtdFiscalCompra').text(`Fiscal (${unidade})`);
        $('#labelQtdNaoFiscalCompra').text(`Não Fiscal (${unidade})`);
    } else {
        $('#labelQtdFiscalCompra').text('Qtd Fiscal');
        $('#labelQtdNaoFiscalCompra').text('Qtd Não Fiscal');
    }

    let indicador = '';
    if (fracionado) {
        indicador = `Distribua em ${unidade} com valores absolutos (nunca %): Fiscal + Não Fiscal = total convertido.`;
    } else if (ativo) {
        indicador = 'F7 ativo: informe Qtd Fiscal e/ou Qtd Não Fiscal';
    }

    $('#indicadorModoF7Compra')
        .toggleClass('d-none', !indicador)
        .text(indicador);
    $('#hintTeclaF7Compra').toggleClass('d-none', fracionado);
    $('#colunaQuantidadeCompraHeader').text(ativo ? 'Qtd' : 'Qtd Fiscal');
    atualizarIndicadorDistribuicaoFiscal();
    if ($('#itensCompraBody').length) {
        renderItensCompraTabela();
    }
}

function onCompraModalKeyDown(event) {
    if (event.key !== 'F7') return;
    if (!$('#compraModal').hasClass('show')) return;
    event.preventDefault();
    toggleModoEntradaF7Compra();
}

function resolverQuantidadesItemCompra(quantidadeSimples, quantidadeFiscal, quantidadeNaoFiscal) {
    if (isModoConversaoUnidadesCompraAtivo() || isModoEntradaF7CompraAtivo()) {
        const qtdFiscal = Number(quantidadeFiscal || 0);
        const qtdNaoFiscal = Number(quantidadeNaoFiscal || 0);
        return {
            quantidade_fiscal: qtdFiscal,
            quantidade_nao_fiscal: qtdNaoFiscal,
            quantidade: qtdFiscal + qtdNaoFiscal
        };
    }

    const qtd = Number(quantidadeSimples || 0);
    return {
        quantidade_fiscal: qtd,
        quantidade_nao_fiscal: 0,
        quantidade: qtd
    };
}

function formatarQuantidadeItemCompra(item = {}) {
    const comercial = obterQuantidadeComercialItemCompra(item);
    const convertida = obterQuantidadeConvertidaItemCompra(item);
    const rotuloCom = rotuloTipoEmbalagemCompra(item.compra_em || item.unidade_comercial || 'UN');
    const un = String(item.unidade || 'UN').toUpperCase();
    const temConversao = Number(item.quantidade_por_embalagem || 0) > 0
        && Math.abs(comercial - convertida) > 0.001;

    if (temConversao && comercial > 0) {
        const linhaComercial = `${formatQuantidadeExibicao(comercial, 3)} ${rotuloCom}${comercial > 1 ? 's' : ''}`;
        const linhaConvertida = `(${formatQuantidadeExibicao(convertida, 3)} ${un})`;
        const qtdNaoFiscal = Number(item.quantidade_nao_fiscal || 0);
        if (itemCompraEhFracionado(item) && qtdNaoFiscal > 0) {
            return `${linhaComercial}<br><small class="text-muted">${linhaConvertida}</small><br><small>${formatQuantidadeExibicao(Number(item.quantidade_fiscal || 0), 3)} + ${formatQuantidadeExibicao(qtdNaoFiscal, 3)}</small>`;
        }
        return `${linhaComercial}<br><small class="text-muted">${linhaConvertida}</small>`;
    }

    const qtdFiscal = Number(item.quantidade_fiscal ?? convertida ?? 0);
    const qtdNaoFiscal = Number(item.quantidade_nao_fiscal || 0);

    if (itemCompraEhFracionado(item) && qtdNaoFiscal > 0) {
        return `${formatQuantidadeExibicao(qtdFiscal, 3)} + ${formatQuantidadeExibicao(qtdNaoFiscal, 3)} ${un}`;
    }

    if (itemCompraEhFracionado(item)) {
        return `${formatQuantidadeExibicao(convertida, 3)} ${un}`;
    }

    return `${formatQuantidadeExibicao(qtdFiscal, 3)} ${un !== 'UN' ? un : ''}`.trim();
}

function calcularSubtotalFinanceiroItemCompra(item = {}) {
    const quantidade = obterQuantidadeConvertidaItemCompra(item);
    const preco = Number(item.preco_unitario || 0);
    return Number((quantidade * preco).toFixed(2));
}

function prepararItemQuantidadesImportacaoCentral(itemBruto = {}) {
    const item = clonarDadosItemCompra(itemBruto) || {};
    const qCom = Number(item.quantidade_comercial ?? item.quantidade ?? 0);
    if (qCom > 0) {
        item.quantidade_comercial = qCom;
        if (!Number(item.quantidade_embalagens)) {
            item.quantidade_embalagens = qCom;
        }
    }
    if (Number(item.quantidade_por_embalagem || 0) > 0 && qCom > 0) {
        item.quantidade_convertida = qCom * Number(item.quantidade_por_embalagem);
    }
    return item;
}

function normalizeItemCompra(itemBruto = {}) {
    const item = isOrigemCompraCentralNfe()
        ? prepararItemQuantidadesImportacaoCentral(itemBruto)
        : (clonarDadosItemCompra(itemBruto) || {});

    const quantidadeComercial = obterQuantidadeComercialItemCompra(item);
    if (quantidadeComercial > 0) {
        item.quantidade_comercial = quantidadeComercial;
        if (!Number(item.quantidade_embalagens)) {
            item.quantidade_embalagens = quantidadeComercial;
        }
    }

    const quantidadeConvertida = obterQuantidadeConvertidaItemCompra(item);
    item.quantidade_convertida = quantidadeConvertida;
    item.peso_total_compra = quantidadeConvertida;

    let qtdFiscal = Number(item.quantidade_fiscal ?? NaN);
    let qtdNaoFiscal = Number(item.quantidade_nao_fiscal || 0);
    const somaExistente = (Number.isFinite(qtdFiscal) ? qtdFiscal : 0) + qtdNaoFiscal;

    if (item.quantidade_fiscal !== undefined || item.quantidade_nao_fiscal !== undefined) {
        qtdFiscal = Number(item.quantidade_fiscal || 0);
        qtdNaoFiscal = Number(item.quantidade_nao_fiscal || 0);
        if (quantidadeConvertida > 0
            && Math.abs(qtdFiscal + qtdNaoFiscal - quantidadeComercial) < 0.001
            && Math.abs(quantidadeComercial - quantidadeConvertida) > 0.001
            && qtdNaoFiscal <= 0) {
            qtdFiscal = quantidadeConvertida;
        }
    } else if (quantidadeConvertida > 0) {
        qtdFiscal = quantidadeConvertida;
        qtdNaoFiscal = 0;
    } else {
        qtdFiscal = quantidadeComercial || 1;
        qtdNaoFiscal = 0;
    }

    const quantidade = quantidadeConvertida > 0
        ? (somaExistente > 0 && Math.abs(somaExistente - quantidadeConvertida) <= 0.001
            ? somaExistente
            : quantidadeConvertida)
        : (qtdFiscal + qtdNaoFiscal || quantidadeComercial || 1);
    const fracionado = itemCompraEhFracionado(item);
    const casasCusto = fracionado ? 4 : 2;
    const custo = fracionado
        ? resolverCustoUnitarioItemCompra(item, quantidade)
        : Number(item.preco_unitario || item.preco_compra || 0);
    const produtoRef = item.produto_id && typeof produtosCompraList !== 'undefined'
        ? produtosCompraList.find((p) => String(p.id) === String(item.produto_id))
        : null;
    const reaplicarMargemCadastro = deveReaplicarMargemCadastroItemCompra(item);
    let margemInfo;
    if (reaplicarMargemCadastro) {
        margemInfo = extrairMargemCadastradaProduto({
            ...(produtoRef || {}),
            lucro_percentual: produtoRef?.lucro_percentual ?? item.lucro_percentual,
            margem_lucro: produtoRef?.margem_lucro,
            margem_padrao: produtoRef?.margem_padrao ?? item.margem_padrao,
            percentual_lucro: produtoRef?.percentual_lucro ?? item.percentual_lucro
        });
    } else if (itemCompraTemMargemGravada(item)) {
        margemInfo = { margem: Number(item.margem_lucro), fallback: Number(item.margem_fallback_padrao || 0) === 1 };
    } else {
        margemInfo = extrairMargemCadastradaProduto({
            ...(produtoRef || {}),
            lucro_percentual: item.lucro_percentual ?? produtoRef?.lucro_percentual,
            margem_lucro: item.margem_lucro,
            margem_padrao: item.margem_padrao ?? produtoRef?.margem_padrao,
            percentual_lucro: item.percentual_lucro ?? produtoRef?.percentual_lucro
        });
    }
    const margem = margemInfo.margem;
    const ultimoPrecoCompra = Number(item.ultimo_preco_compra || custo);
    const precoVendaBase = Number(item.preco_venda_sugerido || item.preco_venda || 0);
    let precoVenda = precoVendaBase > 0
        ? precoVendaBase
        : Number((custo * (1 + margem / 100)) || 0);
    // Ao reaplicar % do cadastro, recalcula venda sugerida com a fórmula já existente (markup).
    if (reaplicarMargemCadastro
        && Number(item.atualizar_preco_venda ?? 1) === 1
        && custo > 0) {
        precoVenda = Number((custo * (1 + margem / 100)).toFixed(2));
    }
    const margemOrigemNormalizada = Number(item.margem_editada_manual || 0) === 1
        ? 'manual'
        : (reaplicarMargemCadastro
            ? (margemInfo.fallback ? 'fallback' : 'cadastro')
            : (item.margem_origem
                || (itemCompraTemMargemGravada(item) ? 'item' : (margemInfo.fallback ? 'fallback' : 'cadastro'))));
    const linhaId = item.linha_id || item.linhaId || gerarLinhaIdCompra();
    const normalizado = {
        linha_id: linhaId,
        produto_id: item.produto_id ? Number(item.produto_id) : '',
        produto_nome: item.produto_nome || item.nome || item.descricao_produto || '',
        codigo_barras: item.codigo_barras || item.codigo || '',
        unidade: item.unidade || 'UN',
        unidade_comercial: item.unidade_comercial || item.unidadeComercial || 'UN',
        ncm: item.ncm || '',
        quantidade,
        quantidade_comercial: quantidadeComercial,
        quantidade_convertida: quantidadeConvertida,
        quantidade_fiscal: qtdFiscal,
        quantidade_nao_fiscal: qtdNaoFiscal,
        preco_unitario: Number(custo.toFixed(casasCusto)),
        ultimo_preco_compra: Number(ultimoPrecoCompra.toFixed(casasCusto)),
        margem_lucro: Number(Number(margem).toFixed(2)),
        margem_fallback_padrao: margemInfo.fallback ? 1 : 0,
        margem_origem: margemOrigemNormalizada,
        margem_editada_manual: Number(item.margem_editada_manual || 0) === 1 ? 1 : 0,
        preco_venda_sugerido: Number(precoVenda.toFixed(2)),
        produto_fracionado: itemCompraEhFracionado(item) ? 1 : 0,
        vendido_por_peso: itemCompraEhFracionado(item) ? 1 : 0,
        peso_total_compra: quantidadeConvertida,
        custo_por_kg: Number((item.custo_por_kg || custo || 0).toFixed(casasCusto)),
        atualizar_preco_venda: Number(item.atualizar_preco_venda ?? 1),
        frete_rateado: Number(item.frete_rateado || 0),
        desconto_rateado: Number(item.desconto_rateado || 0),
        outras_despesas_rateado: Number(item.outras_despesas_rateado || 0),
        custo_unitario_final: Number((item.custo_unitario_final || custo || 0).toFixed(casasCusto)),
        subtotal: calcularSubtotalFinanceiroItemCompra({
            quantidade,
            preco_unitario: Number(custo.toFixed(casasCusto))
        }),
        data_validade: item.data_validade || null,
        compra_em: item.compra_em || '',
        codigo_fornecedor: item.codigo_fornecedor || item.codigoFornecedor || '',
        miip_sugestao: clonarNestedMiipItemCompra(item.miip_sugestao),
        miip_resultado: clonarNestedMiipItemCompra(item.miip_resultado),
        quantidade_embalagens: Number(item.quantidade_embalagens || 0),
        quantidade_por_embalagem: Number(item.quantidade_por_embalagem || 0),
        valor_total_embalagem: Number(item.valor_total_embalagem || 0),
        preco_unitario_comercial: persistirPrecoUnitarioComercialItemCompra(item),
        valor_embalagem_venda: Number(item.valor_embalagem_venda || 0),
        embalagem_id: item.embalagem_id != null ? item.embalagem_id : null,
        produto_apresentacao_id: item.produto_apresentacao_id != null ? item.produto_apresentacao_id : null,
        origem_conversao: item.origem_conversao || null,
        fator_conversao: item.fator_conversao != null ? Number(item.fator_conversao) : null,
        tipo_conversao: item.tipo_conversao || null,
        confianca_conversao: item.confianca_conversao != null ? Number(item.confianca_conversao) : null,
        tipo_origem_compra: item.tipo_origem_compra || null,
        cfop: String(item.cfop || '').replace(/\D/g, '').slice(0, 4),
        tipo_fiscal_item: item.tipo_fiscal_item || null,
        tipo_fiscal_manual: Boolean(item.tipo_fiscal_manual),
        bonificacao: Number(item.bonificacao || 0)
    };

    const enriquecido = enriquecerItemFiscalCompraUi(normalizado);
    return sincronizarQuantidadesEstoqueItemCompra(
        sincronizarPrecosCadastroItemCompra(enriquecido)
    );
}

function recalcularLinhaCompra(index, origem = 'custo') {
    // RC8.4.1 — recalcula via draft temporário; não muta o objeto da lista.
    atualizarItemCompraImutavel(index, (draft) => {
        draft.quantidade = Number(draft.quantidade || 0);
        if (itemCompraEhFracionado(draft)) {
            draft.preco_unitario = resolverCustoUnitarioItemCompra(draft, draft.quantidade);
            draft.custo_unitario_final = draft.preco_unitario;
            draft.custo_por_kg = draft.preco_unitario;
        } else {
            draft.preco_unitario = Number(draft.preco_unitario || 0);
        }
        draft.margem_lucro = Number(draft.margem_lucro || 0);
        draft.preco_venda_sugerido = Number(draft.preco_venda_sugerido || 0);
        if (origem === 'margem' || origem === 'custo') {
            draft.preco_venda_sugerido = Number(
                (draft.preco_unitario * (1 + (draft.margem_lucro / 100))).toFixed(2)
            );
        } else if (origem === 'venda') {
            draft.margem_lucro = draft.preco_unitario > 0
                ? Number((((draft.preco_venda_sugerido - draft.preco_unitario) / draft.preco_unitario) * 100).toFixed(2))
                : 0;
        }
        draft.subtotal = calcularSubtotalFinanceiroItemCompra(draft);
        sincronizarPrecosCadastroItemCompra(draft);
    });
}


function recalcularTotaisCompraNota() {
    const valorProdutos = itensCompraAtual.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const desconto = Number($('#valor_desconto').val()) || 0;
    const frete = Number($('#valor_frete').val()) || 0;
    const seguro = Number($('#valor_seguro').val()) || 0;
    const outras = Number($('#valor_outras_despesas').val()) || 0;
    const ipi = Number($('#valor_ipi').val()) || 0;
    const totalComponentes = Number((valorProdutos - desconto + frete + seguro + outras + ipi).toFixed(2));

    // RC 5.4.1 — se veio do XML, o total oficial é o vNF (nunca recalcular diferente)
    const totalXmlImportado = Number(compraImportadaXml?.valor_total_nota);
    const totalNota = Number.isFinite(totalXmlImportado) && totalXmlImportado > 0
        ? Number(totalXmlImportado.toFixed(2))
        : totalComponentes;

    $('#valor_produtos').val(formatNumberInput(valorProdutos));
    $('#valor_total_itens').val(formatNumberInput(valorProdutos));
    $('#valor_total_nota').val(formatNumberInput(totalNota));
    $('#totalCompra').text(formatCurrency(totalNota));

    const diferenca = Number((totalNota - totalComponentes).toFixed(2));
    const datasEmEdicao = compraModalDatasEmEdicao();

    if (!datasEmEdicao) {
        $('#conferencia_total_compra').remove();

        let classe = Math.abs(diferenca) <= 0.05 ? 'alert-success' : 'alert-warning';
        let texto = Math.abs(diferenca) <= 0.05
            ? 'Conferência OK: total dos componentes bate com o total da NF-e.'
            : `Atenção: diferença entre XML e componentes: ${formatCurrency(diferenca)}. Verifique frete, desconto, IPI ou despesas.`;

        $('#valor_total_nota').closest('.row').after(`
          <div class="col-12 mt-2" id="conferencia_total_compra">
            <div class="alert ${classe} py-2 mb-0">${texto}</div>
          </div>
        `);
    }

    // RC8.5.0 / RC4.31.14 — total da nota: não regenerar parcelas XML importadas
    if (condicaoCompraUsaParcelasFlexiveis($('#condicao_pagamento').val())) {
        if (datasEmEdicao) {
            if (!parcelasImportadasXml) {
                agendarRegenerarGradeParcelasCompra(true);
            }
        } else if (parcelasImportadasXml || parcelasCompraEditadasManual) {
            atualizarResumoValidacaoParcelasCompra();
        } else {
            regenerarGradeParcelasCompra(true);
        }
    }
}

function removerItemCompra(index) {
    if (index < 0 || index >= itensCompraAtual.length) return;
    const removido = itensCompraAtual[index];
    const linhaRemovida = obterLinhaIdItemCompra(removido);
    if (linhaIdEditandoCompra && linhaRemovida === linhaIdEditandoCompra) {
        limparDraftCompra();
        limparFormularioItemCompra();
    } else if (indiceEditandoCompra != null && indiceEditandoCompra > index) {
        indiceEditandoCompra -= 1;
    }
    // splice apenas na remoção explícita — nunca durante edição
    itensCompraAtual.splice(index, 1);
    renderItensCompraTabela();
}

function alterarAtualizarPrecoItemCompra(index, checked) {
    atualizarItemCompraImutavel(index, (draft) => {
        draft.atualizar_preco_venda = checked ? 1 : 0;
    });
}

/**
 * Edição inline do valor de venda na grade (sem abrir o formulário).
 * Marca como manual para o % do cadastro não sobrescrever no save.
 */
function alterarPrecoVendaItemCompra(index, valorRaw, opcoes = {}) {
    const valor = Number(String(valorRaw ?? '').replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0) return;
    atualizarItemCompraImutavel(index, (draft) => {
        draft.preco_venda_sugerido = Number(valor.toFixed(2));
        draft.margem_editada_manual = 1;
        draft.margem_origem = 'manual';
        const custo = Number(draft.preco_unitario || 0);
        if (custo > 0) {
            draft.margem_lucro = Number(
                (((draft.preco_venda_sugerido - custo) / custo) * 100).toFixed(2)
            );
        }
        const qtdPorEmb = Number(draft.quantidade_por_embalagem || 0);
        if (qtdPorEmb > 0) {
            draft.valor_embalagem_venda = Number(
                (draft.preco_venda_sugerido * qtdPorEmb).toFixed(2)
            );
        }
    });
    renderItensCompraTabelaCore();
    focarCampoPrecoVendaItemCompra(opcoes.focarIndice);
}

function focarCampoPrecoVendaItemCompra(indice) {
    if (!Number.isInteger(indice) || indice < 0 || indice >= itensCompraAtual.length) return;
    const el = document.querySelector(`#itensCompraBody input[data-preco-venda-item="${indice}"]`);
    if (!el) return;
    el.focus();
    if (typeof el.select === 'function') el.select();
}

/** Tab / Shift+Tab navega entre os campos de venda da grade; Enter confirma. */
function onKeydownPrecoVendaItemCompra(event, index) {
    if (event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
        return;
    }
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const destino = event.shiftKey ? index - 1 : index + 1;
    alterarPrecoVendaItemCompra(index, event.target.value, {
        focarIndice: (destino >= 0 && destino < itensCompraAtual.length) ? destino : null
    });
}

function formatarPrecoCompraItem(item = {}) {
    const fracionado = itemCompraEhFracionado(item);
    const valor = Number(item.preco_unitario || 0);
    if (fracionado) {
        return `R$ ${formatarCustoUnitarioVenda(valor)}`;
    }
    return formatCurrency(valor);
}

function resolverCustoUnitarioItemCompra(item = {}, quantidadeInformada) {
    if (!itemCompraEhFracionado(item)) {
        return Number(item.preco_unitario || item.preco_compra || 0);
    }

    const quantidade = Number(quantidadeInformada ?? item.quantidade ?? 0);
    const valorTotal = Number(item.valor_total_embalagem || 0);
    let custo = Number(item.custo_unitario_final || item.custo_por_kg || item.preco_unitario || 0);

    if (valorTotal > 0 && quantidade > 0) {
        const custoCalculado = valorTotal / quantidade;
        if (!custo || Math.abs(custo - valorTotal) < 0.01) {
            custo = custoCalculado;
        }
    }

    return Number(custo.toFixed(4));
}

function sincronizarPrecosCadastroItemCompra(item = {}) {
    const fracionado = itemCompraEhFracionado(item);
    const quantidade = Number(item.quantidade || 0);
    const casasCusto = fracionado ? 4 : 2;
    const custo = fracionado
        ? resolverCustoUnitarioItemCompra(item, quantidade)
        : Number(item.preco_unitario || 0);

    item.preco_unitario = Number(custo.toFixed(casasCusto));
    item.custo_unitario_final = item.preco_unitario;
    item.custo_por_kg = item.preco_unitario;
    const vendaOuMargemManual = Number(item.margem_editada_manual) === 1
        || item.margem_origem === 'manual';

    if (deveReaplicarMargemCadastroItemCompra(item)) {
        const produtoRef = resolverProdutoRefItemCompra(item);
        const info = extrairMargemCadastradaProduto(produtoRef || item);
        item.margem_lucro = info.margem;
        item.margem_fallback_padrao = info.fallback ? 1 : 0;
        item.margem_origem = info.fallback ? 'fallback' : 'cadastro';
    } else if (!itemCompraTemMargemGravada(item)) {
        const produtoRef = resolverProdutoRefItemCompra(item);
        const info = extrairMargemCadastradaProduto(produtoRef || item);
        item.margem_lucro = info.margem;
        item.margem_fallback_padrao = info.fallback ? 1 : 0;
        item.margem_origem = info.fallback ? 'fallback' : 'cadastro';
    } else {
        item.margem_lucro = Number(item.margem_lucro);
    }

    if (Number(item.atualizar_preco_venda ?? 1) === 1 && item.preco_unitario > 0) {
        const vendaInformada = Number(item.preco_venda_sugerido || 0);
        // Edição manual do operador: preserva venda digitada e deriva a margem.
        if (vendaOuMargemManual && vendaInformada > 0) {
            item.preco_venda_sugerido = Number(vendaInformada.toFixed(2));
            item.margem_lucro = Number(
                (((item.preco_venda_sugerido - item.preco_unitario) / item.preco_unitario) * 100).toFixed(2)
            );
            item.margem_editada_manual = 1;
            item.margem_origem = 'manual';
        } else {
            item.preco_venda_sugerido = Number((item.preco_unitario * (1 + item.margem_lucro / 100)).toFixed(2));
        }
    }

    return item;
}

function sincronizarQuantidadesEstoqueItemCompra(item = {}) {
    const quantidadeComercial = obterQuantidadeComercialItemCompra(item);
    const quantidadeConvertida = obterQuantidadeConvertidaItemCompra(item);
    item.quantidade_comercial = quantidadeComercial;
    item.quantidade_convertida = quantidadeConvertida;
    item.peso_total_compra = quantidadeConvertida;

    if (!itemCompraEhFracionado(item) && Number(item.quantidade_por_embalagem || 0) <= 0) {
        item.quantidade = quantidadeConvertida;
        return item;
    }

    const qtdFiscal = Number(item.quantidade_fiscal || 0);
    const qtdNaoFiscal = Number(item.quantidade_nao_fiscal || 0);
    const somaInformada = qtdFiscal + qtdNaoFiscal;

    let quantidadeEstoque = somaInformada > 0 ? somaInformada : quantidadeConvertida;
    if (somaInformada > 0
        && Math.abs(somaInformada - quantidadeComercial) < 0.001
        && quantidadeConvertida > quantidadeComercial) {
        quantidadeEstoque = quantidadeConvertida;
        if (qtdNaoFiscal <= 0) item.quantidade_fiscal = quantidadeConvertida;
    }

    item.quantidade_fiscal = Number(item.quantidade_fiscal || 0);
    item.quantidade_nao_fiscal = Number(item.quantidade_nao_fiscal || 0);
    item.quantidade = quantidadeEstoque;
    if (!Number(item.quantidade_embalagens) && quantidadeComercial > 0) {
        item.quantidade_embalagens = quantidadeComercial;
    }
    return item;
}

function renderItensCompraTabela() {
    if (compraModalDatasEmEdicao()) {
        agendarRenderItensCompraTabela();
        return;
    }
    renderItensCompraTabelaCore();
}

function renderCfopColunaItemCompra(item, index) {
    const trat = (typeof TratamentoFiscalItemCompra !== 'undefined')
        ? TratamentoFiscalItemCompra.classificarTratamentoFiscalItem(item, obterTipoEntradaSelecionado())
        : { bonificacao: Number(item.bonificacao) === 1, tooltip: '' };
    const tooltip = escapeHtml(item._tooltip_fiscal || trat.tooltip || 'Tratamento fiscal do item');
    const ehBonif = trat.bonificacao || Number(item.bonificacao) === 1;
    const badge = ehBonif
        ? `<span class="badge bg-warning text-dark mt-1" title="${tooltip}">BONIFICAÇÃO</span>`
        : '';
    const tipos = (typeof TratamentoFiscalItemCompra !== 'undefined')
        ? Object.values(TratamentoFiscalItemCompra.TIPOS)
        : Object.values(TIPOS_ENTRADA_COMPRA);
    const rotulo = (t) => (typeof TratamentoFiscalItemCompra !== 'undefined'
        ? TratamentoFiscalItemCompra.rotuloTipoFiscalItem(t)
        : rotuloTipoEntradaCompra(t));
    const tipoOpts = tipos.map((t) =>
        `<option value="${t}"${item.tipo_fiscal_item === t ? ' selected' : ''}>${escapeHtml(rotulo(t))}</option>`
    ).join('');
    return `
        <input type="text" maxlength="4" class="form-control form-control-sm mb-1"
            value="${escapeHtml(item.cfop || '')}" placeholder="CFOP"
            title="CFOP conforme XML da NF-e"
            onchange="alterarCfopItemCompra(${index}, this.value)">
        ${badge}
        <select class="form-select form-select-sm" title="${tooltip}"
            onchange="alterarTipoFiscalItemCompra(${index}, this.value)">
            ${tipoOpts}
        </select>`;
}

function alterarCfopItemCompra(index, cfop) {
    atualizarItemCompraImutavel(index, (draft) => {
        draft.cfop = String(cfop || '').replace(/\D/g, '').slice(0, 4);
        draft.tipo_fiscal_manual = false;
        draft.tipo_fiscal_item = null;
    });
    itensCompraAtual[index] = enriquecerItemFiscalCompraUi(clonarDadosItemCompra(itensCompraAtual[index]));
    renderItensCompraTabelaCore();
}

function alterarTipoFiscalItemCompra(index, tipo) {
    atualizarItemCompraImutavel(index, (draft) => {
        draft.tipo_fiscal_item = tipo;
        draft.tipo_fiscal_manual = true;
    });
    itensCompraAtual[index] = enriquecerItemFiscalCompraUi(clonarDadosItemCompra(itensCompraAtual[index]));
    renderItensCompraTabelaCore();
}

function renderItensCompraTabelaCore() {
    const tbody = $('#itensCompraBody');
    const optionsProdutos = '<option value="">Selecione</option>' + produtosCompraList.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');
    tbody.html(itensCompraAtual.map((item, index) => {
        const classesLinha = [];
        if (Number(item.bonificacao) === 1) classesLinha.push('table-warning');
        if (indiceProximoDestaqueCompra === index) classesLinha.push('compra-item-proximo');
        const attrsLinha = [
            classesLinha.length ? `class="${classesLinha.join(' ')}"` : '',
            `data-compra-item-index="${index}"`
        ].filter(Boolean).join(' ');
        const badgeProximo = indiceProximoDestaqueCompra === index
            ? '<span class="badge compra-item-proximo-badge ms-1">PRÓXIMO</span>'
            : '';
        return `
        <tr ${attrsLinha}>
            <td style="min-width:220px;">
                <select class="form-control form-control-sm mb-1" onchange="alterarProdutoItemCompra(${index}, this.value)">
                    ${optionsProdutos.replace(`value="${item.produto_id}"`, `value="${item.produto_id}" selected`)}
                </select>
                ${renderMiipSugestaoCard(item, index)}
                <div class="text-muted small">${escapeHtml(item.produto_nome || '')}${badgeProximo}</div>
            </td>
            <td style="min-width:120px;">${escapeHtml(item.codigo_barras || '')}</td>
            <td style="min-width:110px;">${item.data_validade ? escapeHtml(item.data_validade) : '<span class="text-muted">-</span>'}</td>
            <td style="min-width:100px;">${renderCfopColunaItemCompra(item, index)}</td>
            <td style="min-width:90px;">
              ${formatarQuantidadeItemCompra(item)}
              ${renderResumoConversaoItemCompraHtml(item)}
            </td>
            <td style="min-width:110px;">
              ${formatarPrecoCompraItem(item)}
              ${item.custo_unitario_final && Number(item.custo_unitario_final) !== Number(item.preco_unitario)
                ? `<br><small class="text-muted">Custo final: ${itemCompraEhFracionado(item) ? `R$ ${formatarCustoUnitarioVenda(item.custo_unitario_final)}` : formatCurrency(item.custo_unitario_final)}</small>` 
                : ''}
            </td>
            <td style="min-width:95px;">${formatNumberInput(item.margem_lucro)}%</td>
            <td style="min-width:120px;">
              <input type="number" step="0.01" min="0" class="form-control form-control-sm"
                data-preco-venda-item="${index}"
                value="${Number(item.preco_venda_sugerido || 0).toFixed(2)}"
                title="Altere o valor de venda. Tab = próximo produto"
                onchange="alterarPrecoVendaItemCompra(${index}, this.value)"
                onkeydown="onKeydownPrecoVendaItemCompra(event, ${index})">
              <small>
                <label>
                  <input type="checkbox" tabindex="-1" ${Number(item.atualizar_preco_venda ?? 1) === 1 ? 'checked' : ''}
                    onchange="alterarAtualizarPrecoItemCompra(${index}, this.checked)">
                  Atualizar preço
                </label>
              </small>
            </td>
            <td>${formatCurrency(item.subtotal)}</td>
            <td>
                <button type="button" tabindex="-1" class="btn btn-sm btn-warning me-1" onclick="editarItemCompra(${index})"><i class="fas fa-edit"></i></button>
                <button type="button" tabindex="-1" class="btn btn-sm btn-danger" onclick="removerItemCompra(${index})"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="10" class="text-center">Nenhum item adicionado.</td></tr>');
    recalcularTotaisCompraNota();
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function obterUsuarioLogadoCompra() {
    try {
        return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
        return {};
    }
}

function miipClasseConfianca(confianca) {
    const valor = String(confianca || 'NENHUMA').toUpperCase();
    if (valor === 'ALTA') return 'miip-badge-confianca--alta';
    if (valor === 'MEDIA' || valor === 'MÉDIA') return 'miip-badge-confianca--media';
    if (valor === 'BAIXA') return 'miip-badge-confianca--baixa';
    return 'miip-badge-confianca--nenhuma';
}

function miipConfiancaLabel(confianca) {
    const valor = String(confianca || 'NENHUMA').toUpperCase();
    if (valor === 'MEDIA') return 'MÉDIA';
    return valor;
}

function miipMotorIcon(motor) {
    if (motor === 'motor_gtin') return 'fa-barcode';
    if (motor === 'motor_associacao_fornecedor') return 'fa-truck-loading';
    return 'fa-brain';
}

function miipItemExibeSugestao(item) {
    const sugestao = obterSugestaoMiipItemCompra(item);
    return Boolean(
        compraImportadaXml
        && sugestao
        && (sugestao.encontrado !== false)
        && sugestao.status === 'pendente'
        && extrairProdutoIdSugestaoMiip(sugestao, item)
    );
}

function renderMiipSugestaoCard(item, index) {
    const sugestao = obterSugestaoMiipItemCompra(item) || item.miip_sugestao;
    if (!sugestao) return '';

    if (sugestao.status === 'confirmado') {
        return `<div class="miip-status-resolvido"><i class="fas fa-check-circle text-success"></i> Associação confirmada</div>`;
    }
    if (sugestao.status === 'ignorado') {
        return `<div class="miip-status-resolvido"><i class="fas fa-eye-slash"></i> Sugestão ignorada</div>`;
    }
    if (sugestao.status === 'novo_produto') {
        return `<div class="miip-status-resolvido"><i class="fas fa-plus-circle"></i> Cadastro de novo produto solicitado</div>`;
    }
    if (!miipItemExibeSugestao(item)) return '';

    const confianca = sugestao.confianca || 'NENHUMA';
    const motorLabel = escapeHtml(sugestao.motorLabel || sugestao.motor || 'MIIP');
    const produtoNome = escapeHtml(sugestao.produtoNome || 'Produto sugerido');
    const motorIcon = miipMotorIcon(sugestao.motor);

    return `
        <div class="miip-sugestao-card">
            <div class="miip-sugestao-header">
                <span class="miip-sugestao-titulo"><i class="fas fa-magic"></i> Sugestão MIIP</span>
                <span class="miip-badge-confianca ${miipClasseConfianca(confianca)}">${escapeHtml(miipConfiancaLabel(confianca))}</span>
            </div>
            <div class="miip-produto-nome">${produtoNome}</div>
            <div class="miip-motor-tag"><i class="fas ${motorIcon}"></i> ${motorLabel}</div>
            <div class="miip-acoes">
                <button type="button" class="btn btn-sm btn-confirmar" onclick="confirmarAssociacaoMiip(${index})">
                    <i class="fas fa-link"></i> Confirmar Associação
                </button>
                <button type="button" class="btn btn-sm btn-outline-primary" onclick="associarProdutoExistenteMiip(${index})">
                    <i class="fas fa-search"></i> Associar produto existente
                </button>
                <button type="button" class="btn btn-sm btn-outline-primary" onclick="miipNovoProdutoItemCompra(${index})">
                    <i class="fas fa-plus"></i> Novo Produto
                </button>
                <button type="button" class="btn btn-sm btn-outline-secondary" onclick="ignorarSugestaoMiip(${index})">
                    <i class="fas fa-ban"></i> Ignorar
                </button>
            </div>
        </div>
    `;
}

function renderMiipImportacaoStatus(totalSugestoes, usarMiip, resumo) {
    const container = $('#miipImportacaoStatus');
    if (!container.length) return;

    if (!compraImportadaXml) {
        container.hide().html('');
        return;
    }

    if (!usarMiip) {
        container.show().html(`
            <div class="miip-importacao-status miip-importacao-status--off">
                <i class="fas fa-power-off"></i> MIIP desativado — associação manual
            </div>
        `);
        return;
    }

    if (resumo && resumo.totalItens > 0) {
        container.show().html(`
            <div class="miip-importacao-status">
                <i class="fas fa-robot"></i>
                MIIP: ${resumo.identificadosAutomaticamente} automático(s),
                ${resumo.precisamConfirmacao} confirmação(ões),
                ${resumo.precisamCadastro} cadastro(s)
                <small class="text-muted">(${resumo.tempoProcessamento}ms)</small>
            </div>
        `);
        return;
    }

    container.show().html(`
        <div class="miip-importacao-status">
            <i class="fas fa-robot"></i>
            ${totalSugestoes > 0
                ? `${totalSugestoes} sugestão(ões) inteligente(s) encontrada(s)`
                : 'Nenhuma sugestão automática — revise os itens manualmente'}
        </div>
    `);
}

function aplicarMiipImportacaoXml(data) {
    const miip = data?.miip_importacao;
    if (!miip || !miip.usarMiipImportacaoXML) {
        carregarSugestoesMiipXml();
        return;
    }

    const resultados = Array.isArray(miip.resultados) ? miip.resultados : [];
    resultados.forEach((resultado) => {
        atualizarItemCompraImutavel(resultado.indice, (draft) => {
            draft.miip_resultado = clonarDadosItemCompra(resultado);
            if (resultado.associadoAutomaticamente && resultado.produtoEncontrado?.id) {
                draft.produto_id = resultado.produtoEncontrado.id;
                // CORREÇÃO-NF-MARGEM-01 — MIIP automático reaplica lucro_percentual do cadastro
                aplicarMargemDoProdutoNoItemCompra(draft, resultado.produtoEncontrado, { forcar: true });
            }
            if (resultado.precisaConfirmacao) {
                const sugestaoUi = montarSugestaoMiipCompraFromResultado(resultado)
                    || (draft.miip_sugestao
                        ? { ...clonarNestedMiipItemCompra(draft.miip_sugestao), status: 'pendente' }
                        : null);
                if (sugestaoUi) {
                    draft.miip_sugestao = sugestaoUi;
                }
            }
        });
    });

    renderMiipImportacaoStatus(
        resultados.filter((r) => r.precisaConfirmacao).length,
        true,
        miip.resumo || null
    );
    renderItensCompraTabela();
}

function aplicarSugestoesMiipXml(resposta) {
    const sugestoes = Array.isArray(resposta?.itens) ? resposta.itens : [];

    sugestoes.forEach((sugestao) => {
        if (!sugestao.encontrado) return;
        atualizarItemCompraImutavel(sugestao.indice, (draft) => {
            draft.miip_sugestao = {
                ...clonarDadosItemCompra(sugestao),
                status: 'pendente'
            };
        });
    });

    renderMiipImportacaoStatus(
        sugestoes.filter((s) => s.encontrado).length,
        resposta?.usarMiip !== false
    );
    renderItensCompraTabela();
}

function carregarSugestoesMiipXml() {
    if (!compraImportadaXml || !Array.isArray(itensCompraAtual) || itensCompraAtual.length === 0) {
        renderMiipImportacaoStatus(0, false);
        return;
    }

    const payload = {
        origem: 'compra',
        fornecedor: $('#fornecedor').val() || compraImportadaXml?.fornecedor || '',
        fornecedor_cnpj: obterCnpjCompraDigitos() || compraImportadaXml?.fornecedor_cnpj || '',
        itens: itensCompraAtual.map((item) => ({
            produto_nome: item.produto_nome,
            codigo_barras: item.codigo_barras,
            codigo_fornecedor: item.codigo_fornecedor,
            ncm: item.ncm,
            unidade: item.unidade,
            fornecedor_cnpj: obterCnpjCompraDigitos() || compraImportadaXml?.fornecedor_cnpj || '',
            fornecedor_nome: $('#fornecedor').val() || compraImportadaXml?.fornecedor || ''
        }))
    };

    $.ajax({
        url: `${API_URL}/miip/identificar-lote`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(payload)
    }).done(function(resposta) {
        aplicarSugestoesMiipXml(resposta || {});
    }).fail(function() {
        renderMiipImportacaoStatus(0, false);
        showNotification('Não foi possível carregar sugestões MIIP. Continue com associação manual.', 'warning');
    });
}

/**
 * RC4.31.26 — associa item ao produto informado reutilizando o fluxo MIIP existente.
 */
function confirmarAssociacaoMiipComProduto(index, produtoIdInformado, opcoes = {}) {
    const itemSnap = clonarDadosItemCompra(itensCompraAtual[index]);
    if (!itemSnap) {
        showNotification('Item não encontrado para confirmar associação.', 'warning');
        return false;
    }

    const produtoId = Number(produtoIdInformado);
    if (!Number.isFinite(produtoId) || produtoId <= 0) {
        showNotification('Selecione um produto válido para associar.', 'warning');
        return false;
    }

    const produto = produtosCompraList.find((p) => String(p.id) === String(produtoId));
    if (!produto) {
        showNotification('Produto não encontrado no cadastro carregado.', 'warning');
        return false;
    }

    const sugestao = obterSugestaoMiipItemCompra(itemSnap) || itemSnap.miip_sugestao || {};
    const motivo = opcoes.motivo || 'confirmacao_importacao_xml';

    alterarProdutoItemCompra(index, produtoId);

    const usuario = obterUsuarioLogadoCompra();
    const fornecedorCnpj = obterCnpjCompraDigitos() || compraImportadaXml?.fornecedor_cnpj || '';

    if (fornecedorCnpj && itemSnap.codigo_fornecedor) {
        $.ajax({
            url: `${API_URL}/miip/feedback`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                confirmado: true,
                produtoId,
                fornecedorCnpj,
                codigoFornecedor: itemSnap.codigo_fornecedor,
                fornecedorNome: compraImportadaXml?.fornecedor || $('#fornecedor').val() || '',
                nomeItem: itemSnap.produto_nome,
                codigoBarras: itemSnap.codigo_barras,
                ncm: itemSnap.ncm,
                unidade: itemSnap.unidade,
                usuarioId: usuario.id || null,
                operacaoId: sugestao.operacaoId || null,
                motivo,
                item: itemSnap
            })
        }).fail(function () {
            showNotification('Associação aplicada, mas o aprendizado MIIP não foi registrado.', 'warning');
        });
    }

    atualizarItemCompraImutavel(index, (draft) => {
        draft.miip_sugestao = {
            ...clonarNestedMiipItemCompra(sugestao),
            status: 'confirmado',
            produtoId,
            produtoNome: produto.nome || sugestao.produtoNome || '',
            produtoCodigo: produto.codigo || sugestao.produtoCodigo || '',
            encontrado: true
        };
        draft.produto_id = produtoId;
        draft.produto_nome = produto.nome || draft.produto_nome;
        // CORREÇÃO-NF-MARGEM-01 — associação MIIP aplica percentual cadastrado
        aplicarMargemDoProdutoNoItemCompra(draft, produto, { forcar: true });
    });
    renderItensCompraTabela();
    showNotification(opcoes.mensagemSucesso || 'Associação confirmada.', 'success');
    return true;
}

function confirmarAssociacaoMiip(index) {
    const itemSnap = clonarDadosItemCompra(itensCompraAtual[index]);
    if (!itemSnap) {
        showNotification('Item não encontrado para confirmar associação.', 'warning');
        return;
    }

    const sugestao = obterSugestaoMiipItemCompra(itemSnap);
    const produtoId = extrairProdutoIdSugestaoMiip(sugestao, itemSnap);
    if (!sugestao || !produtoId) {
        showNotification('Não há sugestão de produto válida para confirmar.', 'warning');
        return;
    }

    confirmarAssociacaoMiipComProduto(index, produtoId, {
        motivo: 'confirmacao_importacao_xml',
        mensagemSucesso: 'Associação confirmada.'
    });
}

/** RC4.31.26 — pesquisa e associa produto já cadastrado à sugestão MIIP. */
function associarProdutoExistenteMiip(index) {
    const itemSnap = clonarDadosItemCompra(itensCompraAtual[index]);
    if (!itemSnap) {
        showNotification('Item não encontrado.', 'warning');
        return;
    }

    let modalEl = document.getElementById('miipAssociarProdutoExistenteModal');
    if (!modalEl) {
        $('body').append(`
            <div class="modal fade" id="miipAssociarProdutoExistenteModal" tabindex="-1" aria-hidden="true">
              <div class="modal-dialog modal-dialog-scrollable">
                <div class="modal-content">
                  <div class="modal-header">
                    <h5 class="modal-title"><i class="fas fa-link"></i> Associar produto existente</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
                  </div>
                  <div class="modal-body">
                    <p class="small text-muted mb-2" id="miipAssociarProdutoItemRef"></p>
                    <input type="search" class="form-control mb-2" id="miipAssociarProdutoBusca"
                      placeholder="Pesquisar por nome, código ou código de barras" autocomplete="off">
                    <div id="miipAssociarProdutoLista" class="list-group" style="max-height:320px;overflow:auto;"></div>
                  </div>
                  <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                  </div>
                </div>
              </div>
            </div>
        `);
        modalEl = document.getElementById('miipAssociarProdutoExistenteModal');
    }

    const $modal = $('#miipAssociarProdutoExistenteModal');
    $modal.data('miip-item-index', index);
    $('#miipAssociarProdutoItemRef').text(
        `Item da nota: ${itemSnap.produto_nome || itemSnap.codigo_barras || `#${index + 1}`}`
    );
    $('#miipAssociarProdutoBusca').val('').off('input.miipAssoc').on('input.miipAssoc', function () {
        renderListaAssociarProdutoExistenteMiip($(this).val());
    });
    renderListaAssociarProdutoExistenteMiip('');

    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } else {
        $modal.modal('show');
    }
    setTimeout(() => $('#miipAssociarProdutoBusca').trigger('focus'), 200);
}

function renderListaAssociarProdutoExistenteMiip(termo) {
    const t = String(termo || '').trim().toLowerCase();
    const lista = (produtosCompraList || [])
        .filter((p) => {
            if (!t) return true;
            const nome = String(p.nome || '').toLowerCase();
            const cod = String(p.codigo || '').toLowerCase();
            const barras = String(p.codigo_barras || '').toLowerCase();
            return nome.includes(t) || cod.includes(t) || barras.includes(t);
        })
        .slice(0, 60);

    const $lista = $('#miipAssociarProdutoLista');
    if (!lista.length) {
        $lista.html('<div class="list-group-item text-muted">Nenhum produto encontrado.</div>');
        return;
    }

    $lista.html(lista.map((p) => `
        <button type="button" class="list-group-item list-group-item-action"
          onclick="confirmarAssociacaoProdutoExistenteMiipSelecionado(${Number(p.id)})">
          <strong>${escapeHtml(p.nome || '-')}</strong>
          <br><small class="text-muted">
            Cód: ${escapeHtml(p.codigo || '-')}
            | Barras: ${escapeHtml(p.codigo_barras || '-')}
          </small>
        </button>
    `).join(''));
}

function confirmarAssociacaoProdutoExistenteMiipSelecionado(produtoId) {
    const index = Number($('#miipAssociarProdutoExistenteModal').data('miip-item-index'));
    if (!Number.isFinite(index) || index < 0) return;

    const ok = confirmarAssociacaoMiipComProduto(index, produtoId, {
        motivo: 'associacao_produto_existente',
        mensagemSucesso: 'Produto existente associado com sucesso.'
    });
    if (!ok) return;

    const modalEl = document.getElementById('miipAssociarProdutoExistenteModal');
    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        const inst = bootstrap.Modal.getInstance(modalEl);
        if (inst) inst.hide();
    } else {
        $('#miipAssociarProdutoExistenteModal').modal('hide');
    }
}

function limparDestaqueProximoItemCompra() {
    if (indiceProximoDestaqueCompra == null) return;
    indiceProximoDestaqueCompra = null;
}

function encontrarProximoIndiceLancamentoCompra(indiceAtual) {
    if (!Array.isArray(itensCompraAtual) || !itensCompraAtual.length) return null;
    if (indiceAtual == null || !Number.isFinite(Number(indiceAtual))) return null;
    const next = Number(indiceAtual) + 1;
    return next < itensCompraAtual.length ? next : null;
}

function destacarEFocarProximoItemCompra(index) {
    if (index == null || index < 0 || index >= itensCompraAtual.length) {
        limparDestaqueProximoItemCompra();
        return;
    }
    indiceProximoDestaqueCompra = index;
    renderItensCompraTabela();
    const el = document.querySelector(`tr[data-compra-item-index="${index}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const formEl = document.getElementById('codigo_barras_item')
        || document.getElementById('btnAdicionarItemCompra');
    if (formEl && typeof formEl.scrollIntoView === 'function') {
        // Mantém formulário acessível sem cobrir a linha destacada
        requestAnimationFrame(() => {
            const formWrap = document.getElementById('adicionarItemRow') || formEl;
            if (formWrap && typeof formWrap.scrollIntoView === 'function') {
                formWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    }
}

function aposAdicionarItemNavegarProximoCompra(indiceCommitado) {
    const proximo = encontrarProximoIndiceLancamentoCompra(indiceCommitado);
    if (proximo == null) {
        limparDestaqueProximoItemCompra();
        renderItensCompraTabela();
        const foco = document.getElementById('codigo_barras_item');
        if (foco) {
            foco.focus();
            if (typeof foco.scrollIntoView === 'function') {
                foco.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
        return;
    }
    destacarEFocarProximoItemCompra(proximo);
}

function ignorarSugestaoMiip(index) {
    atualizarItemCompraImutavel(index, (draft) => {
        if (!draft.miip_sugestao) return;
        draft.miip_sugestao = {
            ...clonarNestedMiipItemCompra(draft.miip_sugestao),
            status: 'ignorado'
        };
    });
    renderItensCompraTabela();
}

/**
 * RC4.31.27 — abre cadastro de produto a partir do lançamento de compra,
 * preservando o modal/estado da compra (não recria compra).
 */
function abrirCadastroProdutoDesdeCompra(opcoes = {}) {
    if (typeof showProdutoModal !== 'function') {
        showNotification('Módulo de Produtos indisponível. Atualize a página e tente novamente.', 'warning');
        return;
    }

    const compraEl = document.getElementById('compraModal');
    if (!compraEl || !$(compraEl).hasClass('show')) {
        showNotification('Abra o Lançamento de Compra antes de cadastrar um produto.', 'warning');
        return;
    }

    origemCadastroProduto = ORIGEM_CADASTRO_PRODUTO.COMPRA;
    contextoCadastroProdutoCompra = {
        tipo: opcoes.tipo || 'form',
        indexItem: opcoes.indexItem != null ? Number(opcoes.indexItem) : null,
        prefill: opcoes.prefill || null,
        itensCount: Array.isArray(itensCompraAtual) ? itensCompraAtual.length : 0
    };

    showProdutoModal(null, { origem: ORIGEM_CADASTRO_PRODUTO.COMPRA });

    const el = document.getElementById('produtoModal');
    if (!el) {
        origemCadastroProduto = null;
        contextoCadastroProdutoCompra = null;
        showNotification('Não foi possível abrir o cadastro de produto.', 'danger');
        return;
    }

    el.style.zIndex = '21000';
    const elevarBackdrop = () => {
        const backdrops = document.querySelectorAll('.modal-backdrop');
        const last = backdrops[backdrops.length - 1];
        if (last) {
            last.style.zIndex = '20990';
            last.classList.add('produto-modal-sobre-compra-backdrop');
        }
    };

    const prefill = contextoCadastroProdutoCompra.prefill;
    const onShown = () => {
        elevarBackdrop();
        if (!prefill) return;
        if (prefill.produto_nome) $('#nome').val(prefill.produto_nome);
        if (prefill.codigo_barras && $('#codigo_barras').length) {
            $('#codigo_barras').val(prefill.codigo_barras).trigger('input.espelhoCodigo');
        }
        if (prefill.ncm && $('#ncm').length) $('#ncm').val(prefill.ncm);
        if (prefill.unidade && $('#unidade').length) $('#unidade').val(prefill.unidade).trigger('change');
        const custo = Number(prefill.preco_unitario ?? prefill.valor_unitario ?? 0);
        const margemInfo = itemCompraTemMargemGravada(prefill)
            ? { margem: Number(prefill.margem_lucro) }
            : extrairMargemCadastradaProduto(prefill);
        const margem = margemInfo.margem;
        const venda = Number(prefill.preco_venda_sugerido ?? (custo > 0 ? custo * (1 + margem / 100) : 0));
        if ($('#preco_compra').length && custo > 0) $('#preco_compra').val(formatNumberInput(custo, 4));
        if ($('#lucro_percentual').length && Number.isFinite(margem)) {
            $('#lucro_percentual').val(formatNumberInput(margem));
        }
        if ($('#preco_venda').length && venda > 0) $('#preco_venda').val(formatNumberInput(venda));
        if (typeof sincronizarFormacaoPrecoProduto === 'function') {
            sincronizarFormacaoPrecoProduto('venda');
        }
        if (prefill.codigo_fornecedor && $('#codigo').length && !String($('#codigo').val() || '').trim()) {
            $('#codigo').val(String(prefill.codigo_fornecedor).trim());
        }
        if (prefill.fornecedor && $('#fornecedor').length) {
            $('#fornecedor').val(String(prefill.fornecedor).trim());
        }
    };

    el.addEventListener('shown.bs.modal', onShown, { once: true });
    el.addEventListener('hidden.bs.modal', function onHiddenCadastroProdutoCompra() {
        retornarAoLancamentoCompraAposCadastroProduto();
    }, { once: true });

    if (el.classList.contains('show')) onShown();
    else setTimeout(elevarBackdrop, 50);
}

function restaurarModalCompraAposCadastroProduto() {
    const compraEl = document.getElementById('compraModal');
    if (!compraEl) return;

    document.querySelectorAll('.produto-modal-sobre-compra-backdrop').forEach((b) => {
        b.classList.remove('produto-modal-sobre-compra-backdrop');
    });

    // Não recria a compra — apenas garante que o modal existente continue utilizável
    if (!compraEl.classList.contains('show')) {
        if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            bootstrap.Modal.getOrCreateInstance(compraEl).show();
        } else {
            $('#compraModal').modal('show');
        }
    } else {
        document.body.classList.add('modal-open');
        document.body.style.overflow = 'hidden';
        if (!document.querySelector('.modal-backdrop')) {
            const bd = document.createElement('div');
            bd.className = 'modal-backdrop fade show';
            document.body.appendChild(bd);
        }
    }

    $('#btn-restaurar-produtoModal').remove();
    const prodEl = document.getElementById('produtoModal');
    if (prodEl && !prodEl.classList.contains('show')) {
        prodEl.remove();
    }
}

function atualizarOpcoesSeletorProdutoCompra() {
    const $sel = $('#produto_id_item');
    if ($sel.length) {
        const atual = $sel.val();
        const opts = '<option value="">Selecione</option>' + produtosCompraList.map((p) =>
            `<option value="${p.id}" data-controlar-validade="${p.controlar_validade || 0}">${escapeHtml(p.nome)}</option>`
        ).join('');
        $sel.html(opts);
        if (atual) $sel.val(atual);
    }

    const $dl = $('#produtos-datalist');
    if ($dl.length) {
        $dl.html(produtosCompraList.map((p) =>
            `<option value="${escapeHtml((p.codigo_barras || p.codigo || '') + ' - ' + p.nome)}"></option>`
        ).join(''));
    }
}

function upsertProdutoNasListasCompra(produto) {
    if (!produto?.id) return null;
    const normalizado = (typeof normalizarProduto === 'function')
        ? normalizarProduto(produto, window.categoriasSistema || [])
        : { ...produto };

    const mesclar = (lista, unshiftNovo = false) => {
        if (!Array.isArray(lista)) return;
        const idx = lista.findIndex((p) => String(p.id) === String(normalizado.id));
        if (idx >= 0) {
            lista[idx] = { ...lista[idx], ...normalizado };
        } else if (unshiftNovo) {
            lista.unshift(normalizado);
        } else {
            lista.push(normalizado);
        }
    };

    mesclar(produtosCompraList, true);
    if (typeof window !== 'undefined') {
        if (!Array.isArray(window.produtosCache)) window.produtosCache = [];
        mesclar(window.produtosCache, true);
        if (Array.isArray(window.produtosList)) mesclar(window.produtosList, true);
        if (Array.isArray(window.produtosOriginais)) mesclar(window.produtosOriginais, true);
    }
    return normalizado;
}

function selecionarProdutoRecemCadastradoNoLancamento(produto, ctx) {
    if (!produto?.id) return;

    if (ctx?.tipo === 'miip_item' && ctx.indexItem != null && itensCompraAtual[ctx.indexItem]) {
        confirmarAssociacaoMiipComProduto(ctx.indexItem, produto.id, {
            motivo: 'cadastro_novo_produto_compra',
            mensagemSucesso: 'Produto cadastrado e associado ao item.'
        });
        return;
    }

    margemInformadaManualCompra = false;
    $('#produto_id_item').val(String(produto.id));
    const rotuloBusca = [produto.codigo_barras || produto.codigo || '', produto.nome || '']
        .filter(Boolean)
        .join(' - ');
    $('#codigo_barras_item').val(rotuloBusca || produto.nome || '');
    onProdutoSelecionado();
    const foco = document.getElementById('quantidade_item') || document.getElementById('preco_item');
    if (foco) {
        setTimeout(() => foco.focus(), 50);
    }
}

function retornarAoLancamentoCompraAposCadastroProduto() {
    if (origemCadastroProduto !== ORIGEM_CADASTRO_PRODUTO.COMPRA) {
        return;
    }

    const $modal = $('#produtoModal');
    const salvo = $modal.data('produtoRecemSalvo') || null;
    const salvouOk = $modal.data('produtoSalvoComSucesso') === true;
    const ctx = contextoCadastroProdutoCompra;

    origemCadastroProduto = null;
    contextoCadastroProdutoCompra = null;
    $modal.removeData('origemCadastroProduto');
    $modal.removeData('produtoRecemSalvo');
    $modal.removeData('produtoSalvoComSucesso');

    restaurarModalCompraAposCadastroProduto();

    // Cancelar: só restaura a mesma compra — não adiciona produto nem limpa itens
    if (!salvouOk || !salvo?.id) {
        return;
    }

    const produto = upsertProdutoNasListasCompra(salvo);
    atualizarOpcoesSeletorProdutoCompra();
    renderItensCompraTabela();
    selecionarProdutoRecemCadastradoNoLancamento(produto || salvo, ctx);
}

function miipNovoProdutoItemCompra(index) {
    const item = clonarDadosItemCompra(itensCompraAtual[index]);
    if (!item) return;

    atualizarItemCompraImutavel(index, (draft) => {
        if (draft.miip_sugestao) {
            draft.miip_sugestao = {
                ...clonarNestedMiipItemCompra(draft.miip_sugestao),
                status: 'novo_produto'
            };
        }
    });

    renderItensCompraTabela();

    if (typeof showProdutoModal === 'function') {
        abrirCadastroProdutoDesdeCompra({
            tipo: 'miip_item',
            indexItem: index,
            prefill: {
                produto_nome: item.produto_nome,
                codigo_barras: item.codigo_barras,
                ncm: item.ncm,
                unidade: item.unidade,
                preco_unitario: item.preco_unitario ?? item.valor_unitario,
                margem_lucro: item.margem_lucro,
                preco_venda_sugerido: item.preco_venda_sugerido,
                codigo_fornecedor: item.codigo_fornecedor,
                fornecedor: $('#fornecedor').val() || compraImportadaXml?.fornecedor || ''
            }
        });
        showNotification('Cadastre o produto e, ao salvar, o lançamento será retomado automaticamente.', 'info');
        return;
    }

    editarItemCompra(index);
    showNotification('Cadastre o novo produto e selecione-o no item.', 'info');
}

function alterarCampoItemCompra(index, campo, valor) {
    atualizarItemCompraImutavel(index, (draft) => {
        draft[campo] = valor;
        if (campo === 'produto_nome' && String(valor).trim() === '') {
            draft.produto_id = '';
        }
    });
}

function alterarNumeroItemCompra(index, campo, valor, origem) {
    atualizarItemCompraImutavel(index, (draft) => {
        draft[campo] = Number(valor || 0);
    });
    recalcularLinhaCompra(index, origem);
    renderItensCompraTabela();
}

function alterarProdutoItemCompra(index, produtoId) {
    if (indiceProximoDestaqueCompra === index) {
        limparDestaqueProximoItemCompra();
    }
    const produto = produtosCompraList.find(p => String(p.id) === String(produtoId));
    atualizarItemCompraImutavel(index, (draft) => {
        draft.produto_id = produtoId ? Number(produtoId) : '';
        if (!produto) return;
        draft.produto_nome = produto.nome;
        draft.codigo_barras = produto.codigo_barras || produto.codigo || '';
        draft.unidade = produto.unidade || 'UN';
        if (produtoUsaConversaoUnidadesCompra(produto)) {
            draft.produto_fracionado = 1;
            draft.vendido_por_peso = 1;
        }
        const apCompra = typeof ProdutoEmbalagensUI !== 'undefined'
            ? ProdutoEmbalagensUI.obterApresentacaoCompraProduto(produto)
            : null;
        if (apCompra) {
            draft.unidade_comercial = apCompra.unidade_comercial
                || apCompra.tipo
                || produto.unidade_comercial
                || 'UN';
            draft.quantidade_por_embalagem = Number(
                apCompra.quantidade || apCompra.quantidade_por_embalagem || 0
            );
            if (apCompra.gtin) draft.codigo_barras = apCompra.gtin;
            draft.embalagem_id = apCompra.id || null;
        } else {
            draft.unidade_comercial = produto.unidade_comercial || 'UN';
            if (Number(produto.quantidade_por_embalagem || 0) > 0) {
                draft.quantidade_por_embalagem = Number(produto.quantidade_por_embalagem);
            }
        }
        draft.ncm = produto.ncm || '';
        if (!Number(draft.preco_unitario)) {
            draft.preco_unitario = Number(produto.preco_compra || 0);
        }
        draft.ultimo_preco_compra = Number(produto.preco_compra || 0);
        if (!Number(draft.preco_venda_sugerido)) {
            draft.preco_venda_sugerido = Number(produto.preco_venda || 0);
        }
        // RC4.31.25 — cadastro imediato; histórico assíncrono abaixo
        const margemInfo = extrairMargemCadastradaProduto(produto);
        draft.margem_lucro = margemInfo.margem;
        draft.margem_fallback_padrao = margemInfo.fallback ? 1 : 0;
        draft.margem_origem = margemInfo.fallback ? 'fallback' : 'cadastro';
        draft.margem_editada_manual = 0;
        draft.origem_base_comercial = margemInfo.origem;
        if (!Number(draft.preco_venda_sugerido) && Number(draft.preco_unitario) > 0) {
            draft.preco_venda_sugerido = Number(
                (draft.preco_unitario * (1 + draft.margem_lucro / 100)).toFixed(2)
            );
        }
        if (isOrigemCompraCentralNfe() && !draft.distribuicao_fiscal_editada_manual) {
            if (!Number(draft.quantidade_comercial) && Number(draft.quantidade_embalagens)) {
                draft.quantidade_comercial = Number(draft.quantidade_embalagens);
            }
            const aplicado = aplicarDistribuicaoFiscalItemCentral(draft, obterTipoEntradaSelecionado());
            draft.quantidade_comercial = aplicado.quantidade_comercial;
            draft.quantidade_convertida = aplicado.quantidade_convertida;
            draft.quantidade_fiscal = aplicado.quantidade_fiscal;
            draft.quantidade_nao_fiscal = aplicado.quantidade_nao_fiscal;
            draft.quantidade = aplicado.quantidade;
            draft.peso_total_compra = aplicado.peso_total_compra;
            draft.item_fiscal = aplicado.item_fiscal;
            draft.distribuicao_fiscal_preenchida = aplicado.distribuicao_fiscal_preenchida;
            draft.origem_compra = aplicado.origem_compra;
        }
    });
    if (produto) {
        recalcularLinhaCompra(index, 'custo');
        renderItensCompraTabela();
        // RC4.31.25 — enriquece linha com última compra (assíncrono)
        buscarUltimaCompraProduto(produto.id).then((ultima) => {
            const dados = resolverDadosComerciaisProdutoCompra(produto, ultima);
            atualizarItemCompraImutavel(index, (draft) => {
                if (dados.preco_unitario > 0 && !Number(draft.preco_unitario)) {
                    draft.preco_unitario = dados.preco_unitario;
                }
                draft.ultimo_preco_compra = dados.preco_unitario;
                draft.margem_lucro = dados.margem_lucro;
                draft.margem_fallback_padrao = dados.fallback ? 1 : 0;
                draft.origem_base_comercial = dados.origem;
                draft.atualizar_preco_venda = dados.atualizar_preco_venda;
                if (dados.preco_venda_sugerido > 0) {
                    draft.preco_venda_sugerido = dados.preco_venda_sugerido;
                }
            });
            recalcularLinhaCompra(index, 'custo');
            renderItensCompraTabela();
        }).catch((err) => console.warn('[Compras] última compra na grade:', err));
    }
}

function adicionarItemCompra() {
    return adicionarItemCompraAsync().catch((err) => {
        console.error('[Compras] adicionarItemCompra:', err);
        showNotification(err.message || 'Erro ao adicionar item.', 'danger');
    });
}

async function adicionarItemCompraAsync() {
    const produtoId = $('#produto_id_item').val();
    const descricaoLivre = ($('#codigo_barras_item').val() || '').trim();
    const produto = produtosCompraList.find(p => String(p.id) === String(produtoId));
    const fracionado = produtoUsaConversaoUnidadesCompra(produto);
    const usaEmbalagemComercial = itemUsaEmbalagemComercial({
        produto_fracionado: fracionado ? 1 : 0,
        vendido_por_peso: fracionado ? 1 : 0,
        produto_id: produto?.id,
        embalagem_id: $('#embalagem_compra_item').val() || null,
        tipo_origem_compra: null
    }, produto);
    const painelEmb = fracionado || usaEmbalagemComercial;

    let qtds = resolverQuantidadesItemCompra(
        $('#quantidade_item').val(),
        $('#quantidade_fiscal_item').val(),
        $('#quantidade_nao_fiscal_item').val()
    );
    let preco = Number($('#preco_item').val());
    // RC4.31.28 — no painel MUC, #preco_item é o preço unitário comercial (preservar antes do custo/MT)
    const precoUnitarioComercialForm = painelEmb
        ? obterPrecoUnitarioComercialFormularioMuc()
        : 0;
    const margemRaw = $('#margem_padrao_item').val();
    const margemInput = Number(margemRaw);
    const precoVendaInput = Number($('#preco_venda_item').val());
    // RC4.31.26 — form (manual/cadastro/35%) → resolver → fallback 35%
    let margem;
    if (margemRaw !== '' && Number.isFinite(margemInput)) {
        margem = margemInput;
    } else if (produto?.id) {
        const ultima = await buscarUltimaCompraProduto(produto.id);
        margem = resolverDadosComerciaisProdutoCompra(produto, ultima).margem_lucro;
    } else {
        margem = MARGEM_PADRAO_FALLBACK_COMPRA;
    }
    let valorTotalEmbalagem = 0;
    let dadosEmbalagem = {};
    let embalagemIdSelecionada = null;

    if (painelEmb) {
        const conv = await simularConversaoMucCompra(true);
        if (!conv || conv.qtdTotal <= 0) {
            showNotification('Informe quantidade comprada e quantidade por embalagem.', 'warning');
            return;
        }
        if (conv.valorTotal <= 0) {
            showNotification('Informe o preço de compra.', 'warning');
            $('#preco_item').focus();
            return;
        }

        if (fracionado) {
            if (isOrigemCompraCentralNfe()
                && (Number(qtds.quantidade_fiscal || 0) + Number(qtds.quantidade_nao_fiscal || 0)) <= 0) {
                const dist = calcularDistribuicaoFiscalMotorItem(
                    {
                        quantidade: conv.qtdTotal,
                        peso_total_compra: conv.qtdTotal,
                        quantidade_embalagens: Number($('#quantidade_embalagens_item').val() || 0),
                        quantidade_por_embalagem: Number($('#quantidade_por_embalagem_item').val() || 0),
                        unidade: conv.unidade
                    },
                    obterTipoEntradaSelecionado()
                );
                if (dist.total > 0) {
                    qtds = {
                        quantidade_fiscal: dist.quantidade_fiscal,
                        quantidade_nao_fiscal: dist.quantidade_nao_fiscal,
                        quantidade: dist.total
                    };
                }
            }
            const validacaoDistribuicao = validarDistribuicaoFiscalCompra(
                qtds.quantidade_fiscal,
                qtds.quantidade_nao_fiscal,
                conv.qtdTotal,
                conv.unidade
            );
            if (!validacaoDistribuicao.ok) {
                showNotification(validacaoDistribuicao.mensagem, 'warning');
                if (qtds.quantidade_fiscal <= 0) {
                    $('#quantidade_fiscal_item').focus();
                } else {
                    $('#quantidade_nao_fiscal_item').focus();
                }
                return;
            }
        } else {
            qtds = {
                quantidade_fiscal: conv.qtdTotal,
                quantidade_nao_fiscal: 0,
                quantidade: conv.qtdTotal
            };
        }

        preco = conv.custoUnitario;
        valorTotalEmbalagem = conv.valorTotal;
        // Garante total = unitário comercial × qtd comercial (origem canônica RC4.31.28)
        const qtdComercialConv = Number($('#quantidade_embalagens_item').val() || 0);
        if (precoUnitarioComercialForm > 0 && qtdComercialConv > 0) {
            valorTotalEmbalagem = Number((precoUnitarioComercialForm * qtdComercialConv).toFixed(2));
        }

        const embSel = embalagensProdutoCompraAtual.find((e) => String(e.id) === String($('#embalagem_compra_item').val()))
            || embalagensProdutoCompraAtual.find((e) => !e._acao);
        if (usaEmbalagemComercial && embSel && Number(embSel.compra ?? 1) === 0) {
            showNotification('Esta embalagem não está habilitada para utilização em compras.', 'warning');
            return;
        }

        if (embSel && !embSel.somente_compra && !String(embSel.id || '').startsWith('temp-')) {
            try {
                const produtoAtualizado = await aprenderUnidadeComercialAutomaticaNoProduto(produto, embSel);
                if (produtoAtualizado && produtoAtualizado !== produto) {
                    await carregarEmbalagensProdutoCompra(produtoAtualizado);
                    const descricao = String(embSel.descricao || obterRotuloCompraEmAtual() || '').trim();
                    const qtdConv = Number($('#quantidade_por_embalagem_item').val() || embSel.quantidade || 0);
                    const opcaoPersistida = localizarOpcaoEmbalagemAprendida(descricao, qtdConv);
                    if (opcaoPersistida?.id) {
                        $('#embalagem_compra_item').val(String(opcaoPersistida.id));
                        embalagemCompraSelecionadaAnterior = String(opcaoPersistida.id);
                    }
                }
            } catch (aprendErr) {
                console.warn('[Compras] aprendizagem automática:', aprendErr);
            }
        }

        const embSelFinal = embalagensProdutoCompraAtual.find((e) => String(e.id) === String($('#embalagem_compra_item').val()))
            || embSel;
        embalagemIdSelecionada = embSelFinal?.embalagem_ref_id || embSelFinal?.id || null;
        if (String(embalagemIdSelecionada || '').startsWith('unidade-')
            || String(embalagemIdSelecionada || '').startsWith('uc-')
            || String(embalagemIdSelecionada || '').startsWith('legado-')
            || String(embalagemIdSelecionada || '').startsWith('unidade-base-')
            || String(embalagemIdSelecionada || '').startsWith('temp-')) {
            embalagemIdSelecionada = embSel?.embalagem_ref_id || null;
        }
        if (produto?.id && embalagemIdSelecionada) {
            salvarUltimaEmbalagemCompraProduto(produto.id, embalagemIdSelecionada);
        }

        const muc = conv.muc || {};
        const tipoOrigemCompra = embSelFinal?.tipo_origem_compra
            || (String(embSelFinal?.id || '').startsWith('uc-') ? 'UNIDADE_COMERCIAL' : 'EMBALAGEM_COMERCIAL');
        dadosEmbalagem = {
            compra_em: embSelFinal?.descricao || obterRotuloCompraEmAtual() || embSelFinal?.tipo || produto?.unidade_comercial || 'PCT',
            unidade_comercial: embSelFinal?.unidade_comercial || embSelFinal?.tipo || produto?.unidade_comercial || obterRotuloCompraEmAtual() || 'PCT',
            quantidade_comercial: Number($('#quantidade_embalagens_item').val() || 0),
            quantidade_embalagens: Number($('#quantidade_embalagens_item').val() || 0),
            quantidade_por_embalagem: Number($('#quantidade_por_embalagem_item').val() || 0),
            quantidade_convertida: conv.qtdTotal,
            valor_total_embalagem: valorTotalEmbalagem,
            preco_unitario_comercial: precoUnitarioComercialForm > 0
                ? Number(precoUnitarioComercialForm.toFixed(4))
                : (qtdComercialConv > 0
                    ? Number((valorTotalEmbalagem / qtdComercialConv).toFixed(4))
                    : 0),
            embalagem_id: embalagemIdSelecionada,
            produto_apresentacao_id: embalagemIdSelecionada,
            tipo_origem_compra: tipoOrigemCompra,
            origem_conversao: 'MANUAL',
            fator_conversao: Number(muc.fatorConversao || dadosEmbalagem.quantidade_por_embalagem || 0),
            tipo_conversao: muc.tipoConversao || 'MULTIPLICADOR',
            confianca_conversao: Number(muc.confianca || 100),
            produto_fracionado: fracionado ? 1 : 0,
            vendido_por_peso: fracionado ? 1 : 0,
            peso_total_compra: conv.qtdTotal,
            custo_por_kg: fracionado ? conv.custoUnitario : undefined
        };

        if (usaEmbalagemComercial) {
            const valorEmbVenda = Number((precoVendaInput > 0
                ? precoVendaInput * Number(dadosEmbalagem.quantidade_por_embalagem || 1)
                : preco * (1 + margem / 100) * Number(dadosEmbalagem.quantidade_por_embalagem || 1)).toFixed(2));
            dadosEmbalagem.valor_embalagem_venda = valorEmbVenda;
        }
    } else if ((!produtoId && !descricaoLivre) || !qtds.quantidade || !preco) {
        const msgQtd = isModoEntradaF7CompraAtivo()
            ? 'Informe produto, preço e ao menos uma quantidade (fiscal ou não fiscal).'
            : 'Informe produto ou descrição, quantidade e preço.';
        showNotification(msgQtd, 'warning');
        return;
    }

    let margemFinal = margem;
    let precoVenda = preco * (1 + margem / 100);

    if (Number.isFinite(precoVendaInput) && precoVendaInput > 0 && !usaEmbalagemComercial) {
        precoVenda = precoVendaInput;
        margemFinal = preco > 0 ? ((precoVenda - preco) / preco) * 100 : 0;
    } else if (usaEmbalagemComercial && dadosEmbalagem.valor_embalagem_venda) {
        precoVenda = Number((dadosEmbalagem.valor_embalagem_venda / Number(dadosEmbalagem.quantidade_por_embalagem || 1)).toFixed(2));
        if (Number.isFinite(precoVendaInput) && precoVendaInput > 0) {
            precoVenda = precoVendaInput;
            margemFinal = preco > 0 ? ((precoVenda - preco) / preco) * 100 : 0;
        }
    }

    if (produto && Number(produto.controlar_validade || 0) === 1) {
        const dataValidade = $('#data_validade_item').val();
        if (!dataValidade) {
            showNotification('Para produtos com controle de validade, informe a data de validade.', 'warning');
            return;
        }
    }

    const itemExistente = linhaIdEditandoCompra
        ? itensCompraAtual[encontrarIndiceItemCompraPorLinhaId(linhaIdEditandoCompra)]
        : (indiceEditandoCompra != null ? itensCompraAtual[indiceEditandoCompra] : null);

    const margemManualCommit = margemInformadaManualCompra
        || Number(itemDraftCompra?.margem_editada_manual) === 1
        || itemDraftCompra?.margem_origem === 'manual'
        || Number(itemExistente?.margem_editada_manual) === 1
        || itemExistente?.margem_origem === 'manual';

    // RC8.4.1 — monta exclusivamente no draft; commit só no final
    itemDraftCompra = normalizeItemCompra({
        linha_id: itemExistente
            ? obterLinhaIdItemCompra(itemExistente)
            : (itemDraftCompra?.linha_id || gerarLinhaIdCompra()),
        produto_id: produto ? produto.id : '',
        produto_nome: produto ? produto.nome : descricaoLivre,
        codigo_barras: produto ? (produto.codigo_barras || produto.codigo || '') : '',
        quantidade: qtds.quantidade,
        quantidade_fiscal: qtds.quantidade_fiscal,
        quantidade_nao_fiscal: qtds.quantidade_nao_fiscal,
        preco_unitario: preco,
        ultimo_preco_compra: Number(itemDraftCompra?.ultimo_preco_compra || produto?.preco_compra || preco || 0),
        margem_lucro: margemFinal,
        preco_venda_sugerido: precoVenda,
        margem_editada_manual: margemManualCommit ? 1 : Number(itemDraftCompra?.margem_editada_manual || itemExistente?.margem_editada_manual || 0),
        margem_origem: margemManualCommit
            ? 'manual'
            : (itemDraftCompra?.margem_origem || itemExistente?.margem_origem || undefined),
        atualizar_preco_venda: Number(
            itemDraftCompra?.atualizar_preco_venda
            ?? itemExistente?.atualizar_preco_venda
            ?? 1
        ),
        origem_base_comercial: itemDraftCompra?.origem_base_comercial
            || itemExistente?.origem_base_comercial
            || null,
        unidade: produto ? (produto.unidade || 'UN') : 'UN',
        unidade_comercial: produto?.unidade_comercial || dadosEmbalagem.unidade_comercial || 'UN',
        ncm: produto ? (produto.ncm || '') : '',
        data_validade: $('#data_validade_item').val() || null,
        produto_fracionado: fracionado ? 1 : 0,
        vendido_por_peso: fracionado ? 1 : 0,
        subtotal: (fracionado || usaEmbalagemComercial) ? valorTotalEmbalagem : undefined,
        miip_sugestao: clonarNestedMiipItemCompra(itemExistente?.miip_sugestao || itemDraftCompra?.miip_sugestao),
        miip_resultado: clonarNestedMiipItemCompra(itemExistente?.miip_resultado || itemDraftCompra?.miip_resultado),
        distribuicao_fiscal_preenchida: isOrigemCompraCentralNfe()
            && !itemDraftCompra?.distribuicao_fiscal_editada_manual
            && !itemExistente?.distribuicao_fiscal_editada_manual
            ? true
            : Boolean(itemExistente?.distribuicao_fiscal_preenchida),
        distribuicao_fiscal_editada_manual: Boolean(itemDraftCompra?.distribuicao_fiscal_editada_manual
            || itemExistente?.distribuicao_fiscal_editada_manual),
        origem_compra: isOrigemCompraCentralNfe() ? ORIGEM_COMPRA.CENTRAL_NFE : ORIGEM_COMPRA.MANUAL,
        ...dadosEmbalagem
    });

    const indiceAntesCommit = indiceEditandoCompra;
    const idxCommit = commitItemCompraNoArray(itemDraftCompra, {
        linhaId: linhaIdEditandoCompra || obterLinhaIdItemCompra(itemDraftCompra),
        indice: indiceEditandoCompra
    });
    limparDraftCompra();
    limparFormularioItemCompra();
    // RC4.31.26 — após Adicionar/Salvar, destaca o próximo item da grade (se houver)
    aposAdicionarItemNavegarProximoCompra(
        indiceAntesCommit != null ? idxCommit : (itensCompraAtual.length > 1 ? idxCommit : null)
    );
}

/** Fallback local quando o motor cliente ainda não carregou. */
function calcularEmbalagemComercialLocal(qtdEmb, qtdPorEmb, valorTotal, margem) {
    const quantidadeEstoque = Number(qtdEmb || 0) * Number(qtdPorEmb || 0);
    const valor = Number(valorTotal || 0);
    const custoUnitario = quantidadeEstoque > 0 ? Number((valor / quantidadeEstoque).toFixed(4)) : 0;
    const precoVendaUnitario = Number((custoUnitario * (1 + Number(margem || 0) / 100)).toFixed(2));
    return {
        quantidadeEstoque,
        custoUnitario,
        precoVendaUnitario,
        valorTotalEmbalagem: valor,
        valorEmbalagemVenda: Number((precoVendaUnitario * Number(qtdPorEmb || 0)).toFixed(2))
    };
}

function produtoUsaEmbalagemComercialCompra(produto) {
    return Boolean(produto && Number(produto.compra_por_embalagem || 0) === 1);
}

/** RC4.31.24 — embalagem_id persistido (não sintético de UI). */
function embalagemIdCompraEhValido(embalagemId) {
    if (embalagemId == null || embalagemId === '') return false;
    const id = String(embalagemId);
    if (id.startsWith('temp-')
        || id.startsWith('unidade-')
        || id.startsWith('uc-')
        || id.startsWith('legado-')
        || id.startsWith('unidade-base-')) {
        return false;
    }
    return true;
}

/**
 * RC4.31.24 — função canônica: item usa Embalagem/UC comercial.
 * NUNCA usa quantidade_embalagens como critério (qCom da Central não é embalagem).
 */
function itemUsaEmbalagemComercial(item = {}, produto = null) {
    if (!item || typeof item !== 'object') return false;
    if (itemCompraEhFracionado(item)) return false;

    const prod = produto || (item.produto_id && typeof produtosCompraList !== 'undefined'
        ? produtosCompraList.find((p) => String(p.id) === String(item.produto_id))
        : null);

    if (produtoUsaEmbalagemComercialCompra(prod)) return true;
    if (Number(item.compra_por_embalagem || 0) === 1) return true;

    if (embalagemIdCompraEhValido(item.embalagem_id)
        || embalagemIdCompraEhValido(item.produto_apresentacao_id)) {
        return true;
    }

    const origem = String(item.tipo_origem_compra || '').toUpperCase();
    if (origem === 'EMBALAGEM_COMERCIAL' || origem === 'UNIDADE_COMERCIAL') return true;

    return false;
}

/** Fracionado (MT/KG) ou embalagem/UC comercial — painel MUC de preço total. */
function itemUsaModoPrecoEmbalagemCompra(item = {}, produto = null) {
    return itemCompraEhFracionado(item) || itemUsaEmbalagemComercial(item, produto);
}

/**
 * RC4.31.29 — valor a carregar em #preco_item na edição (via resolver canônico).
 * Nunca devolve total/subtotal crus; nunca zera preço válido.
 */
function obterPrecoCampoFormularioEdicaoItem(draft = {}, produto = null) {
    const resolvido = obterPrecoUnitarioCompraFormulario(draft, produto);
    const casas = itemCompraEhFracionado(draft) && !resolvido.modoEmbalagem ? 4 : 2;
    return {
        valor: resolvido.valor,
        modoEmbalagem: resolvido.modoEmbalagem,
        origem: resolvido.origem,
        casas
    };
}

function atualizarRotuloBotaoItemCompra() {
    const $btn = $('#btnAdicionarItemCompra');
    if (!$btn.length) return;
    if (linhaIdEditandoCompra != null || indiceEditandoCompra != null) {
        $btn.html('<i class="fas fa-save"></i> Salvar alterações');
    } else {
        $btn.html('<i class="fas fa-plus"></i> Adicionar');
    }
}

function limparFormularioItemCompra() {
    limparDraftCompra();
    modoEntradaF7Compra = false;
    margemInformadaManualCompra = false;
    atualizarRotuloBotaoItemCompra();
    $('#codigo_barras_item').val('');
    $('#produto_id_item').val('');
    $('#quantidade_item').val('1');
    $('#quantidade_fiscal_item').val('');
    $('#quantidade_nao_fiscal_item').val('');
    $('#preco_item').val('');
    $('#margem_padrao_item').val('');
    atualizarIndicadorBaseComercialCompra('');
    $('#preco_venda_item').val('');
    $('#compra_em_item').html(opcoesCompraEmbalagemHtml('Rolo'));
    $('#quantidade_embalagens_item').val('1');
    $('#quantidade_por_embalagem_item').val('');
    $('#custo_unitario_fracionado_item').val('');
    $('#resultado_formula_conversao').text('');
    $('#resultado_qtd_total_fracionado').text('0 UN');
    $('#resultado_custo_unitario_fracionado').text('R$ 0,0000');
    $('#painelResumoConversaoMuc').addClass('d-none').html('');
    embalagensProdutoCompraAtual = [];
    ultimaSimulacaoMucCompra = null;
    restaurandoEmbalagemCompraEdicao = null;
    embalagemCompraSelecionadaAnterior = null;
    $('#embalagem_compra_item').val('');
    $('#data_validade_item').val('');
    atualizarCamposValidadeCompra();
    atualizarPainelConversaoUnidadesCompra();
    $('#codigo_barras_item').focus();
}

function calcularValorVendaItem() {
    // RC8.4.1 — formação de preço só no draft
    sincronizarDraftCompraDoFormulario();
    if (obterModoPainelEmbalagemCompra(obterProdutoSelecionadoCompra())) {
        const custoPreview = Number(ultimaSimulacaoMucCompra?.custoUnitario || 0);
        if (custoPreview > 0) {
            itemDraftCompra.preco_unitario = custoPreview;
        }
    }
    recalcularFormacaoPrecoDraftCompra('custo');
    $('#preco_venda_item').val(formatNumberInput(itemDraftCompra.preco_venda_sugerido));
}

function calcularMargemItem() {
    sincronizarDraftCompraDoFormulario();
    recalcularFormacaoPrecoDraftCompra('venda');
    $('#margem_padrao_item').val(formatNumberInput(itemDraftCompra.margem_lucro));
}

function editarItemCompra(index) {
    // RC8.4.1 — NUNCA splice / NUNCA mutar a linha original. Só draft.
    const draft = iniciarDraftCompraEdicao(index);
    if (!draft) return;

    margemInformadaManualCompra = Number(draft.margem_editada_manual) === 1
        || draft.margem_origem === 'manual';

    // RC4.31.26 — ao iniciar edição do próximo destacado, remove o destaque
    if (indiceProximoDestaqueCompra === index) {
        limparDestaqueProximoItemCompra();
        renderItensCompraTabela();
    }

    atualizarRotuloBotaoItemCompra();

    const temSplit = Number(draft.quantidade_nao_fiscal || 0) > 0;
    modoEntradaF7Compra = temSplit;
    const fracionado = itemCompraEhFracionado(draft);
    const produto = draft.produto_id
        ? produtosCompraList.find((p) => String(p.id) === String(draft.produto_id))
        : null;
    // RC4.31.24 — detecção canônica (nunca quantidade_embalagens / compra_em sozinhos)
    const usaEmbalagemComercial = itemUsaEmbalagemComercial(draft, produto);
    const painelEmb = itemUsaModoPrecoEmbalagemCompra(draft, produto);
    const precoCampo = obterPrecoCampoFormularioEdicaoItem(draft, produto);

    $('#codigo_barras_item').val(draft.produto_nome || draft.codigo_barras || '');
    $('#produto_id_item').val(draft.produto_id || '');
    $('#quantidade_item').val(formatQuantidadeExibicao(draft.quantidade, 3));
    $('#quantidade_fiscal_item').val(formatQuantidadeExibicao(draft.quantidade_fiscal ?? draft.quantidade, 3));
    $('#quantidade_nao_fiscal_item').val(formatQuantidadeExibicao(draft.quantidade_nao_fiscal || 0, 3));
    // RC4.31.29 — só preenche se houver preço válido (nunca forçar 0,00)
    if (precoCampo.valor > 0) {
        $('#preco_item').val(formatNumberInput(precoCampo.valor, precoCampo.casas));
    }
    $('#margem_padrao_item').val(formatNumberInput(draft.margem_lucro));
    atualizarIndicadorBaseComercialCompra(
        draft.origem_base_comercial || ORIGEM_BASE_COMERCIAL_COMPRA.ITEM
    );
    $('#preco_venda_item').val(formatNumberInput(draft.preco_venda_sugerido));
    atualizarRotuloPrecoCompraItem(draft);

    if (painelEmb) {
        if (fracionado) modoEntradaF7Compra = true;
        const compraEmSalva = draft.compra_em || draft.unidade_comercial || 'Rolo';
        if (TIPOS_COMPRA_EMBALAGEM.includes(compraEmSalva)) {
            $('#compra_em_item').val(compraEmSalva);
        } else {
            $('#compra_em_item').html(
                opcoesCompraEmbalagemHtml('Rolo') +
                `<option value="${escapeHtml(compraEmSalva)}" selected>${escapeHtml(compraEmSalva)}</option>`
            );
        }
        const qtdComercialSalva = Number(
            draft.quantidade_embalagens
            || draft.quantidade_comercial
            || 1
        );
        $('#quantidade_embalagens_item').val(formatQuantidadeExibicao(qtdComercialSalva, 3));
        $('#quantidade_por_embalagem_item').val(formatQuantidadeExibicao(draft.quantidade_por_embalagem || 0, 3));

        if (usaEmbalagemComercial || fracionado) {
            const comercialPersistido = persistirPrecoUnitarioComercialItemCompra(draft, produto);
            restaurandoEmbalagemCompraEdicao = {
                embalagem_id: draft.embalagem_id,
                compra_em: draft.compra_em || draft.unidade_comercial,
                quantidade_embalagens: qtdComercialSalva,
                quantidade_comercial: Number(draft.quantidade_comercial || qtdComercialSalva),
                quantidade_por_embalagem: draft.quantidade_por_embalagem || 0,
                quantidade_convertida: Number(draft.quantidade_convertida || draft.quantidade || 0),
                valor_total_embalagem: Number(draft.valor_total_embalagem || 0),
                preco_unitario: Number(draft.preco_unitario || 0),
                subtotal: Number(draft.subtotal || 0),
                preco_unitario_comercial: comercialPersistido
            };
            if (comercialPersistido > 0) {
                draft.preco_unitario_comercial = comercialPersistido;
            }
        }
    }

    onProdutoSelecionado();
    atualizarRotuloPrecoCompraItem(draft);
    // Reaplica preço após onProdutoSelecionado — só se válido (RC4.31.29)
    const precoApos = obterPrecoCampoFormularioEdicaoItem(
        itemDraftCompra || draft,
        produto
    );
    if (precoApos.valor > 0) {
        $('#preco_item').val(formatNumberInput(precoApos.valor, precoApos.casas));
    } else if (precoCampo.valor > 0) {
        $('#preco_item').val(formatNumberInput(precoCampo.valor, precoCampo.casas));
    }
    $('#data_validade_item').val(draft.data_validade || '');
    atualizarCamposQuantidadeCompra();
    $('#codigo_barras_item').focus();
}

function onFornecedorInput() {
    const inputValue = $('#fornecedor').val();
    if (!inputValue) return;
    const fornecedor = fornecedoresList.find(f => String(f.nome || '').toLowerCase() === inputValue.trim().toLowerCase());
    if (fornecedor) {
        $('#fornecedor').val(fornecedor.nome);
        if (fornecedor.cpf_cnpj) {
            $('#fornecedor_cnpj').val(typeof formatarCpfCnpj === 'function'
                ? formatarCpfCnpj(fornecedor.cpf_cnpj)
                : fornecedor.cpf_cnpj);
            garantirCompraImportadaXml();
            compraImportadaXml.fornecedor = fornecedor.nome;
            compraImportadaXml.fornecedor_cnpj = String(fornecedor.cpf_cnpj || '').replace(/\D/g, '');
        }
        atualizarAlertaCnpjXmlDivergente();
    }
}

function atualizarCamposValidadeCompra() {
    const produtoId = $('#produto_id_item').val();
    const produto = produtosCompraList.find(p => String(p.id) === String(produtoId));
    const exigeValidade = !!(produto && Number(produto.controlar_validade || 0) === 1);

    $('#labelDataValidadeItem')
        .html(exigeValidade ? 'Data Validade *' : 'Data Validade');
    $('#hintDataValidadeItem').text(
        exigeValidade
            ? 'Obrigatório para produtos com controle de validade. O lote será gerado automaticamente.'
            : 'Opcional. Informe quando o produto tiver controle de validade.'
    );
    $('#data_validade_item').prop('required', exigeValidade);
}

function onProdutoSelecionado() {
    atualizarCamposValidadeCompra();
    atualizarPainelConversaoUnidadesCompra();
    const produto = obterProdutoSelecionadoCompra();
    if (!produto) {
        atualizarIndicadorBaseComercialCompra('');
        return;
    }
    // RC4.31.26 — nova seleção (não edição) reaplica margem do cadastro/35%
    if (linhaIdEditandoCompra == null && indiceEditandoCompra == null) {
        margemInformadaManualCompra = false;
    }
    // RC4.31.26 — margem: cadastro → 35%; preço pode vir da última compra; edição preserva
    aplicarDadosComerciaisProdutoFormularioCompra(produto, {
        preservarSeEdicao: true,
        recalcular: !(linhaIdEditandoCompra != null || indiceEditandoCompra != null)
    }).catch((err) => console.warn('[Compras] base comercial:', err));
    if (produtoUsaConversaoUnidadesCompra(produto)
        && !linhaIdEditandoCompra
        && indiceEditandoCompra == null) {
        $('#quantidade_fiscal_item').val('');
        $('#quantidade_nao_fiscal_item').val('');
    }
}

function onFornecedorKeyDown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const inputValue = $('#fornecedor').val().trim();
    if (!inputValue) return;
    const fornecedor = fornecedoresList.find(f => String(f.nome || '').toLowerCase() === inputValue.toLowerCase());
    if (fornecedor) {
        $('#fornecedor').val(fornecedor.nome);
    }
}

function onProdutoInput() {
    const inputValue = $('#codigo_barras_item').val().trim();
    if (!inputValue) {
        $('#produto_id_item').val('');
        atualizarCamposValidadeCompra();
        atualizarPainelConversaoUnidadesCompra();
        return;
    }

    const aplicar = (produto) => {
        if (produto) {
            $('#produto_id_item').val(produto.id);
            if (produtoUsaConversaoUnidadesCompra(produto)) {
                $('#preco_item').val('');
                $('#preco_venda_item').val('');
            }
            // RC4.31.25 — preço/margem/venda vêm de aplicarDadosComerciais (última compra)
            onProdutoSelecionado();
        } else {
            $('#produto_id_item').val('');
            atualizarCamposValidadeCompra();
            atualizarPainelConversaoUnidadesCompra();
            atualizarIndicadorBaseComercialCompra('');
        }
    };

    aplicar(findProdutoByInput(inputValue));
    findProdutoByInputAsync(inputValue).then(aplicar);
}

function onProdutoKeyDown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const inputValue = $('#codigo_barras_item').val().trim();
    if (!inputValue) return;

    findProdutoByInputAsync(inputValue).then(async (produto) => {
        if (!produto) {
            showNotification('Produto não encontrado', 'warning');
            return;
        }

        $('#produto_id_item').val(produto.id);
        if (produtoUsaConversaoUnidadesCompra(produto)) {
            $('#preco_item').val('');
            $('#preco_venda_item').val('');
        }
        $('#codigo_barras_item').val(`${produto.codigo_barras || produto.codigo || ''} - ${produto.nome}`);

        atualizarCamposValidadeCompra();
        atualizarPainelConversaoUnidadesCompra();
        // Aguarda última compra antes de adicionar (RC4.31.25)
        await aplicarDadosComerciaisProdutoFormularioCompra(produto, {
            preservarSeEdicao: true,
            recalcular: !(linhaIdEditandoCompra != null || indiceEditandoCompra != null)
        });

        if (produtoUsaConversaoUnidadesCompra(produto)) {
            $('#quantidade_embalagens_item').focus();
            showNotification('Preencha a conversão de embalagem e a distribuição fiscal/não fiscal.', 'info');
            return;
        }

        if (Number(produto.controlar_validade || 0) === 1) {
            $('#data_validade_item').focus();
            showNotification('Preencha a data de validade e pressione ENTER novamente para adicionar.', 'info');
            return;
        }

        adicionarItemCompra();
    });
}

function findFornecedorByTerm(term) {
    const lower = term.toLowerCase();
    return fornecedoresList.find(f => {
        const nome = String(f.nome || '').toLowerCase();
        const contato = String(f.contato || '').toLowerCase();
        return nome === lower || nome.startsWith(lower) || contato.includes(lower);
    });
}

function findProdutoByInput(input) {
    const cleaned = input.replace(/\s+-\s+.*$/, '').trim();
    const lower = input.toLowerCase().trim();
    return produtosCompraList.find(p => {
        const codigo = String(p.codigo || '').trim();
        const codigoBarras = String(p.codigo_barras || '').trim();
        const plu = String(p.plu || '').trim();
        const nome = String(p.nome || '').toLowerCase().trim();
        return codigo === cleaned
            || codigoBarras === cleaned
            || (plu && plu === cleaned)
            || nome === lower;
    });
}

/**
 * Sprint 07 — identificação via MIP quando flag ON; senão findProdutoByInput legado.
 * @param {string} input
 * @returns {Promise<Object|null>}
 */
async function findProdutoByInputAsync(input) {
    const cleaned = String(input || '').replace(/\s+-\s+.*$/, '').trim();
    if (!cleaned) return null;

    let mipOn = false;
    try {
        const token = localStorage.getItem('token') || '';
        const resp = await fetch(`${API_URL}/configuracoes/produto_identidade_enabled`, {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (resp.ok) {
            const row = await resp.json();
            const v = String(row && row.valor != null ? row.valor : '').toLowerCase();
            mipOn = v === '1' || v === 'true' || v === 'sim';
        }
    } catch {
        mipOn = false;
    }

    if (!mipOn) {
        return findProdutoByInput(cleaned);
    }

    try {
        const token = localStorage.getItem('token') || '';
        const resp = await fetch(`${API_URL}/produtos/identificar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + token
            },
            body: JSON.stringify({
                codigo: cleaned,
                contexto: { origem: 'compras' }
            })
        });
        if (resp.ok) {
            const r = await resp.json();
            if (r.habilitado === false) {
                return findProdutoByInput(cleaned);
            }
            if (r.encontrado && r.produtoId) {
                const cached = produtosCompraList.find(p => Number(p.id) === Number(r.produtoId));
                if (cached) return cached;
                if (r.produto) return r.produto;
            }
        }
    } catch (err) {
        console.warn('[Compras←MIP] findProdutoByInputAsync falhou:', err);
    }

    return findProdutoByInput(cleaned);
}

function showCompraModal() {
    console.log('showCompraModal chamada - gerando modal');
    carregarConfigBonificacaoCompra();
    itensCompraAtual = [];
    limparDraftCompra();
    resetFinanceiroCompraModal();
    compraImportadaXml = null;
    cnpjEmitenteXmlOriginal = null;
    origemCompraAtual = ORIGEM_COMPRA.MANUAL;
    tipoEntradaCompraAtual = TIPOS_ENTRADA_COMPRA.REVENDA;
    modoEntradaF7Compra = false;
    const hoje = new Date().toISOString().split('T')[0];
    const modalHtml = `
        <div class="modal fade" id="compraModal" tabindex="-1">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Lançamento de Nova compra</h5>
                        <div>
                            <button type="button" class="btn btn-sm btn-outline-primary me-1" title="Documentos fiscais pela Central Inteligente" onclick="abrirCentralInteligenteEntradas()">
                                📥 Importar pela Central Inteligente
                            </button>
                            <button type="button" class="btn btn-sm btn-light me-1" title="Minimizar" onclick="minimizarModal('compraModal')">
                                <i class="fas fa-window-minimize"></i>
                            </button>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-info mb-3">
                            Documentos fiscais (NF-e / DF-e) devem ser recebidos pela
                            <strong>Central Inteligente de Entradas</strong> antes do lançamento em Compras.
                            <button type="button" class="btn btn-sm btn-primary ms-2" onclick="abrirCentralInteligenteEntradas()">
                                📥 Abrir Central Inteligente
                            </button>
                        </div>
                        <div class="col-12" id="miipImportacaoStatus" style="display:none;"></div>

<div class="row g-3">
    <div class="col-12">
        <h6 class="border-bottom pb-2 mb-2">Dados da nota de compra</h6>
    </div>

    <div class="col-md-2">
        <label class="form-label">Data da compra *</label>
        <input type="date" class="form-control" id="data_compra" value="${hoje}">
    </div>

    <div class="col-md-2">
        <label class="form-label">Data emissão</label>
        <input type="date" class="form-control" id="data_emissao" value="${hoje}">
    </div>

    <div class="col-md-2">
        <label class="form-label">Data entrada</label>
        <input type="date" class="form-control" id="data_entrada" value="${hoje}">
    </div>

    <div class="col-md-4">
        <label class="form-label">Fornecedor (Nome)</label>
        <input type="text" class="form-control" id="fornecedor" list="lista_fornecedores" oninput="onFornecedorInput()" onkeydown="onFornecedorKeyDown(event)">
        <datalist id="lista_fornecedores">
            ${fornecedoresList.map(f => `<option value="${escapeHtml(f.nome || '')}"></option>`).join('')}
        </datalist>
    </div>

    <div class="col-md-2">
        <label class="form-label">CNPJ</label>
        <input
            type="text"
            class="form-control"
            id="fornecedor_cnpj"
            maxlength="18"
            placeholder="00.000.000/0000-00"
            oninput="onFornecedorCnpjInput(this)"
            onblur="onFornecedorCnpjBlur()"
        >
    </div>

    <div class="col-12" id="alertaCnpjXmlDivergente" style="display:none;">
        <div class="alert alert-warning py-2 mb-0">
            <i class="fas fa-exclamation-triangle"></i>
            Atenção: o CNPJ informado é diferente do emitente da NF-e importada.
        </div>
    </div>

    <div class="col-md-2">
        <label class="form-label">Número NF</label>
        <input type="text" class="form-control" id="numero_nf" maxlength="20">
    </div>

    <div class="col-md-2">
        <label class="form-label">Série</label>
        <input type="text" class="form-control" id="serie_nf" maxlength="10">
    </div>

    <div class="col-md-2">
        <label class="form-label">Modelo</label>
        <input type="text" class="form-control" id="modelo_nf" value="55" maxlength="5">
    </div>

    <div class="col-md-6">
        <label class="form-label">Chave de acesso</label>
        <input
            type="text"
            class="form-control"
            id="chave_acesso"
            maxlength="44"
            placeholder="Preenchida automaticamente pela Central Inteligente"
            oninput="this.value=this.value.replace(/\D/g,'')"
        >
    </div>

    <div class="col-12">
        <label class="form-label">Observação</label>
        <textarea class="form-control" id="observacao_compra" rows="2"></textarea>
    </div>
</div>

<hr>

<div class="row g-3" id="politicaEntradaSection">
    <div class="col-12">
        <h6 class="border-bottom pb-2 mb-2">Tipo da Entrada</h6>
        <div class="form-check">
            <input class="form-check-input" type="radio" name="tipo_entrada_compra" id="tipo_entrada_revenda" value="REVENDA" checked onchange="aplicarPoliticaEntradaCompra()">
            <label class="form-check-label" for="tipo_entrada_revenda">Compra para Revenda</label>
        </div>
        <div class="form-check">
            <input class="form-check-input" type="radio" name="tipo_entrada_compra" id="tipo_entrada_industrializacao" value="INDUSTRIALIZACAO" onchange="aplicarPoliticaEntradaCompra()">
            <label class="form-check-label" for="tipo_entrada_industrializacao">Compra para Industrialização</label>
        </div>
        <div class="form-check">
            <input class="form-check-input" type="radio" name="tipo_entrada_compra" id="tipo_entrada_bonificacao" value="BONIFICACAO" onchange="aplicarPoliticaEntradaCompra()">
            <label class="form-check-label" for="tipo_entrada_bonificacao">Compra por Bonificação</label>
            <small class="text-muted d-block">Padrão inicial para itens sem CFOP; cada item mantém seu CFOP do XML.</small>
        </div>
        <div class="form-check">
            <input class="form-check-input" type="radio" name="tipo_entrada_compra" id="tipo_entrada_uso_consumo" value="USO_CONSUMO" onchange="aplicarPoliticaEntradaCompra()">
            <label class="form-check-label" for="tipo_entrada_uso_consumo">Compra para Uso e Consumo</label>
            <small class="text-muted d-block">Registra fiscal e financeiro sem cadastrar produtos ou movimentar estoque.</small>
        </div>
    </div>
</div>

<hr>

<div class="row g-3">
    <div class="col-12">
        <div class="form-check">
            <input class="form-check-input" type="checkbox" id="nota_fiscal_avulsa" onchange="toggleNotaFiscalAvulsa()">
            <label class="form-check-label fw-bold" for="nota_fiscal_avulsa">
                Lançar Nota Fiscal Avulsa
            </label>
            <small class="text-muted d-block">Marque para registrar apenas dados fiscais e financeiros, sem itens e sem movimentação de estoque.</small>
        </div>
    </div>
</div>

<hr>

<div class="row g-3" id="itensCompraSection">
    <div class="col-12">
        <h6 class="border-bottom pb-2 mb-2">Itens da compra</h6>
    </div>
</div>
                        <!-- Linha 1: Campo de busca destacado -->
                        <div class="row g-2 mb-3">
                            <div class="col-md-12">
                                <label class="form-label fw-bold">Código de barras / descrição rápida (Enter para adicionar)</label>
                                <input type="text" class="form-control" id="codigo_barras_item" placeholder="Leitor, código ou nome" list="produtos-datalist" autocomplete="off" oninput="onProdutoInput()" onkeydown="onProdutoKeyDown(event)" style="font-size: 1.1em; font-weight: 500;">
                                <datalist id="produtos-datalist">
                                    ${produtosCompraList.map(p => `<option value="${escapeHtml((p.codigo_barras || p.codigo || '') + ' - ' + p.nome)}"></option>`).join('')}
                                </datalist>
                            </div>
                        </div>

                        <div id="adicionarItemRow">
                            <div class="row g-2 align-items-end mb-2">
                                <div class="col-md-8">
                                    <label class="form-label">Produto</label>
                                    <select class="form-control" id="produto_id_item" onchange="onProdutoSelecionado()">
                                        <option value="">Selecione</option>
                                        ${produtosCompraList.map(p => `<option value="${p.id}" data-controlar-validade="${p.controlar_validade || 0}">${escapeHtml(p.nome)}</option>`).join('')}
                                    </select>
                                </div>
                                <div class="col-md-4">
                                    <label class="form-label d-none d-md-block">&nbsp;</label>
                                    <button type="button" class="btn btn-outline-primary w-100" id="btnNovoProdutoDesdeCompra" onclick="abrirCadastroProdutoDesdeCompra({ tipo: 'form' })">
                                        <i class="fas fa-plus"></i> Novo Produto
                                    </button>
                                </div>
                            </div>

                            <div id="painelConteudoEmbalagensWrap" class="d-none mb-2">
                                <div class="card border-light">
                                    <div class="card-body py-2" id="painelConteudoEmbalagens"></div>
                                </div>
                            </div>

                            <div id="painelConversaoEmbalagem" class="d-none mb-2">
                                <div class="card border-info">
                                    <div class="card-header bg-light py-2">
                                        <strong>Motor de Conversão de Unidades</strong>
                                        <small class="text-muted ms-2">Ex.: 10 Rolos × 50 MT = 500 MT</small>
                                    </div>
                                    <div class="card-body py-2">
                                        <div class="row g-2 align-items-end">
                                            <div class="col-md-2">
                                                <label class="form-label" id="label_qtd_embalagens_compra">Quantidade Comprada</label>
                                                <input type="number" step="0.001" min="0" class="form-control" id="quantidade_embalagens_item" value="1" placeholder="Ex.: 3">
                                            </div>
                                            <div class="col-md-3" id="embalagemCompraRow">
                                                <label class="form-label fw-semibold">Comprar em</label>
                                                <select class="form-control" id="embalagem_compra_item" onchange="onEmbalagemCompraSelecionada()"></select>
                                            </div>
                                            <div class="col-md-2 d-none" id="colCompraEmLegado">
                                                <label class="form-label">Compra em</label>
                                                <select class="form-control" id="compra_em_item" tabindex="-1" aria-hidden="true">
                                                    ${opcoesCompraEmbalagemHtml('Rolo')}
                                                </select>
                                            </div>
                                            <div class="col-md-2" id="colQtdPorEmbalagemCompra">
                                                <label class="form-label">Quantidade por Unidade/Embalagem</label>
                                                <input type="number" step="0.001" min="0" class="form-control" id="quantidade_por_embalagem_item" value="" placeholder="Ex.: 10">
                                            </div>
                                            <div class="col-md-2">
                                                <label class="form-label">Unidade de Estoque</label>
                                                <input type="text" class="form-control" id="unidade_fracionada_item" readonly>
                                            </div>
                                        </div>
                                        <hr class="my-2">
                                        <div class="row g-2">
                                            <div class="col-md-12 mb-1">
                                                <span id="resultado_formula_conversao" class="text-primary small"></span>
                                            </div>
                                            <div class="col-md-6">
                                                <strong>Quantidade Total:</strong>
                                                <span id="resultado_qtd_total_fracionado" class="ms-1">0,000 UN</span>
                                            </div>
                                            <div class="col-md-6">
                                                <strong>Custo Unitário:</strong>
                                                <span id="resultado_custo_unitario_fracionado" class="ms-1">R$ 0,0000</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div id="painelResumoConversaoMuc" class="d-none"></div>

                            <div id="painelIndicadorDistribuicaoFiscal" class="d-none mb-2">
                                <div id="indicadorDistribuicaoFiscal" class="d-none"></div>
                            </div>

                            <div class="row g-2 align-items-end mb-2" id="linhaQuantidadeCompra">
                                <div class="col-md-2" id="campoQuantidadeSimplesCompra">
                                    <label class="form-label">Qtd</label>
                                    <input type="number" step="0.01" class="form-control" id="quantidade_item" value="1">
                                </div>
                                <div class="col-md-2 d-none" id="campoQuantidadeFiscalCompra">
                                    <label class="form-label" id="labelQtdFiscalCompra">Fiscal</label>
                                    <input type="number" step="0.001" min="0" class="form-control" id="quantidade_fiscal_item" value="" placeholder="Ex.: 300">
                                </div>
                                <div class="col-md-2 d-none" id="campoQuantidadeNaoFiscalCompra">
                                    <label class="form-label" id="labelQtdNaoFiscalCompra">Não Fiscal</label>
                                    <input type="number" step="0.001" min="0" class="form-control" id="quantidade_nao_fiscal_item" value="" placeholder="Ex.: 200">
                                </div>
                            </div>

                            <div class="row g-2 align-items-end mb-2" id="linhaPrecoCompraNormal">
                                <div class="col-md-2 campo-preco-compra-item">
                                    <label class="form-label" id="label_preco_compra_item">Preço compra (unidade)</label>
                                    <input type="number" step="0.0001" class="form-control" id="preco_item" oninput="onPrecoCompraItemInput()">
                                </div>
                                <input type="hidden" id="custo_unitario_fracionado_item" value="">
                                <div class="col-md-2">
                                    <label class="form-label">Margem %</label>
                                    <input type="number" step="0.01" class="form-control" id="margem_padrao_item" value="" placeholder="cadastro / 35%" oninput="marcarMargemManualCompra()">
                                    <small id="hintMargemPadraoCompra" class="text-muted d-none"></small>
                                </div>
                                <div class="col-md-2">
                                    <label class="form-label">Valor venda</label>
                                    <input type="number" step="0.01" class="form-control" id="preco_venda_item" oninput="marcarPrecoVendaManualCompra()">
                                </div>
                                <div class="col-md-2">
                                    <button type="button" class="btn btn-success w-100" id="btnAdicionarItemCompra" onclick="adicionarItemCompra()"><i class="fas fa-plus"></i> Adicionar</button>
                                </div>
                            </div>

                            <div class="row g-2 mb-2">
                                <div class="col-12">
                                    <small id="indicadorModoF7Compra" class="text-primary fw-semibold d-none"></small>
                                    <small id="hintTeclaF7Compra" class="text-muted">Pressione <strong>F7</strong> para alternar entre Qtd única e Qtd Fiscal / Não Fiscal.</small>
                                </div>
                            </div>
                        </div>

                        <!-- Campos de lote / validade -->
                        <div class="row g-2 mt-2" id="camposLoteCompra">
                            <div class="col-md-4">
                                <label class="form-label" id="labelDataValidadeItem">Data Validade</label>
                                <input type="date" class="form-control" id="data_validade_item">
                            </div>
                            <div class="col-md-8 d-flex align-items-end">
                                <small class="text-muted" id="hintDataValidadeItem">Informe quando o produto tiver controle de validade.</small>
                            </div>
                        </div>
                        <div class="table-responsive mt-3" id="itensCompraTable">
                            <table class="table table-bordered align-middle">
                                <thead>
                                    <tr>
                                        <th>Produto / descrição</th>
                                        <th>Cód. barras</th>
                                        <th>Validade</th>
                                        <th>CFOP / Fiscal</th>
                                        <th id="colunaQuantidadeCompraHeader">Qtd Fiscal</th>
                                        <th>Preço compra</th>
                                        <th>Margem %</th>
                                        <th>Venda sugerida</th>
                                        <th>Subtotal</th>
                                        <th></th>
                                    </tr>
                                </thead>

                                <tbody id="itensCompraBody"></tbody>
                                <tfoot><tr><th colspan="8" class="text-end">Total</th><th id="totalCompra">${formatCurrency(0)}</th><th></th></tr></tfoot>
                            </table>
                        </div>

                        <hr>
                        <div class="row g-2 mt-2" id="totaisNotaSection">
    <div class="col-12">
        <h6 class="border-bottom pb-2 mb-2">Totais da nota</h6>
    </div>

    <div class="col-md-2" id="col_valor_produtos">
        <label class="form-label">Valor produtos</label>
        <input type="number" step="0.01" class="form-control" id="valor_produtos" value="0.00" readonly>
    </div>

    <div class="col-md-2" id="col_valor_desconto">
        <label class="form-label">Desconto</label>
        <input type="number" step="0.01" class="form-control" id="valor_desconto" value="0.00" oninput="recalcularTotaisCompraNota(); calcularParcelasCompra();">
    </div>

    <div class="col-md-2" id="col_valor_frete">
        <label class="form-label">Frete</label>
        <input type="number" step="0.01" class="form-control" id="valor_frete" value="0.00" oninput="recalcularTotaisCompraNota(); recalcularTotalNotaAvulsa(); calcularParcelasCompra();">
    </div>

    <div class="col-md-2" id="col_valor_outras_despesas">
        <label class="form-label">Outras despesas</label>
        <input type="number" step="0.01" class="form-control" id="valor_outras_despesas" value="0.00" oninput="recalcularTotaisCompraNota(); recalcularTotalNotaAvulsa(); calcularParcelasCompra();">
    </div>

    <div class="col-md-2" id="col_valor_seguro">
        <label class="form-label">Seguro</label>
        <input type="number" step="0.01" class="form-control" id="valor_seguro" value="0.00" oninput="recalcularTotaisCompraNota(); recalcularTotalNotaAvulsa(); calcularParcelasCompra();">
    </div>

    <div class="col-md-2" id="col_valor_ipi">
        <label class="form-label">IPI</label>
        <input type="number" step="0.01" class="form-control" id="valor_ipi" value="0.00" oninput="recalcularTotaisCompraNota(); recalcularTotalNotaAvulsa(); calcularParcelasCompra();">
    </div>

    <div class="col-md-2" id="col_valor_total_itens">
        <label class="form-label">Valor total itens</label>
        <input type="number" step="0.01" class="form-control" id="valor_total_itens" value="0.00" readonly oninput="recalcularTotalNotaAvulsa()">
    </div>

    <div class="col-md-2" id="col_valor_total_nota">
        <label class="form-label">Valor total da nota *</label>
        <input type="number" step="0.01" class="form-control fw-bold" id="valor_total_nota" value="0.00" readonly>
        <small class="text-muted" id="valor_total_nota_hint">Igual ao total do XML (vNF).</small>
    </div>
</div>

<hr>
                        <div class="row g-2" id="pagamentoSection">
                            <div class="col-md-3 mb-3">
                                <label class="form-label">Tipo *</label>
                                <select class="form-control" id="condicao_pagamento" onchange="atualizarVisibilidadePagamentoCompra()">
                                    <option value="avista">À vista</option>
                                    <option value="prazo">À prazo</option>
                                </select>
                            </div>
                            <div class="col-md-3 mb-3">
                                <label class="form-label">Forma de Pagamento</label>
                                <select class="form-control" id="forma_pagamento"><option value="">Selecione</option>${formasPagamentoCompra()}</select>
                            </div>
                            <div class="col-md-2 mb-3" id="grupo_parcelas_compra">
                                <label class="form-label" id="label_parcelas_compra">Quantidade de Parcelas</label>
                                <input type="number" min="1" class="form-control" id="parcelas" value="1" onchange="onParametroParcelamentoCompraAlterado()">
                            </div>
                            <div class="col-md-2 mb-3" id="grupo_dias_parcelas_compra">
                                <label class="form-label">Prazo entre Parcelas (dias)</label>
                                <input type="number" min="0" class="form-control" id="dias_entre_parcelas" value="30" onchange="onParametroParcelamentoCompraAlterado()">
                            </div>
                            <div class="col-md-2 mb-3" id="grupo_vencimento_compra">
                                <label class="form-label">Primeiro Vencimento</label>
                                <input type="date" class="form-control" id="data_vencimento" value="${hoje}">
                            </div>
                            <input type="hidden" id="valor_entrada" value="0">
                        </div>
                        <div id="parcelas_detalhes" class="mb-3"></div>
                    </div>
                    
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-primary" onclick="saveCompra()">Salvar compra</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    console.log('Modal HTML gerado, tamanho:', modalHtml.length);
    $('#modal-container').html(modalHtml);
    $('#compraModal').modal('show');
    console.log('Modal exibido');
    $(document).off('keydown.compraF7', onCompraModalKeyDown).on('keydown.compraF7', onCompraModalKeyDown);
    $('#compraModal').off('hidden.bs.modal.compraF7').on('hidden.bs.modal.compraF7', function() {
        $(document).off('keydown.compraF7', onCompraModalKeyDown);
        modoEntradaF7Compra = false;
    });
    atualizarCamposQuantidadeCompra();
    atualizarCamposValidadeCompra();
    atualizarPainelConversaoUnidadesCompra();
    $('#quantidade_embalagens_item, #quantidade_por_embalagem_item')
        .off('input.fracionado')
        .on('input.fracionado', () => agendarSimulacaoMucCompra());
    $('#compra_em_item, #embalagem_compra_item')
        .off('change.fracionado')
        .on('change.fracionado', () => agendarSimulacaoMucCompra());
    $('#quantidade_fiscal_item, #quantidade_nao_fiscal_item')
        .off('input.distribuicao')
        .on('input.distribuicao', () => {
            if (itemDraftCompra) itemDraftCompra.distribuicao_fiscal_editada_manual = true;
            atualizarIndicadorDistribuicaoFiscal();
        });
    renderItensCompraTabela();
    atualizarVisibilidadePagamentoCompra();
    recalcularTotaisCompraNota();
    definirTipoEntradaCompra(TIPOS_ENTRADA_COMPRA.REVENDA, { silencioso: true });
    vincularEventosDatasCompraModal();
    atualizarRotuloBotaoItemCompra();
}

function saveCompra() {
    const isNotaAvulsa = $('#nota_fiscal_avulsa').is(':checked');
    const isUsoConsumo = isUsoConsumoCompraAtual();
    const entradaSimplificada = isNotaAvulsa || isUsoConsumo;

    if (!entradaSimplificada && !itensCompraAtual.length) {
        showNotification('Adicione ao menos um item.', 'warning');
        return;
    }

    if (!entradaSimplificada) {
        if (isOrigemCompraCentralNfe()) {
            itensCompraAtual = itensCompraAtual.map((item) => {
                if (!itemCompraEhFracionado(item) || item.distribuicao_fiscal_editada_manual) return item;
                return aplicarDistribuicaoFiscalItemCentral(item, obterTipoEntradaSelecionado());
            });
        }
        for (const item of itensCompraAtual) {
            if (!deveExigirValidacaoDistribuicaoFiscalItem(item)) continue;
            const totalConvertido = obterQuantidadeConvertidaItemCompra(item);
            const validacao = validarDistribuicaoFiscalCompra(
                item.quantidade_fiscal,
                item.quantidade_nao_fiscal,
                totalConvertido,
                String(item.unidade || '').toUpperCase()
            );
            if (!validacao.ok) {
                showNotification(validacao.mensagem, 'warning');
                return;
            }
        }
    }

    const total = Number($('#valor_total_nota').val())
        || (entradaSimplificada ? Number(compraImportadaXml?.valor_total_nota || 0) : 0)
        || (isNotaAvulsa ? 0 : itensCompraAtual.reduce((sum, item) => sum + Number(item.subtotal || 0), 0));
    const valorTotalItens = Number($('#valor_total_itens').val()) || 0;

    if (entradaSimplificada && !isNotaAvulsa && total <= 0) {
        showNotification('Informe o valor total da nota fiscal.', 'warning');
        return;
    }

    if (isNotaAvulsa && total <= 0) {
        showNotification('Informe o valor total da nota fiscal.', 'warning');
        return;
    }

    if (isNotaAvulsa && valorTotalItens <= 0) {
        showNotification('Informe o valor total dos itens.', 'warning');
        return;
    }

    const condicaoPagamento = $('#condicao_pagamento').val() || 'avista';
    const valorEntrada = 0;
    const parcelas = condicaoPagamento === 'avista'
        ? 1
        : (parseInt($('#parcelas').val(), 10) || 1);
    const diasEntreParcelas = condicaoPagamento === 'avista'
        ? 0
        : parseInt($('#dias_entre_parcelas').val(), 10);
    const diasEntre = Number.isFinite(diasEntreParcelas) ? Math.max(0, diasEntreParcelas) : 30;

    if (condicaoCompraUsaParcelasFlexiveis(condicaoPagamento)) {
        if (!parcelasCompraGrade.length && !parcelasImportadasXml) {
            regenerarGradeParcelasCompra(true);
        }
        if (!$('#data_vencimento').val()) {
            showNotification('Informe o primeiro vencimento das parcelas.', 'warning');
            $('#data_vencimento').focus();
            return;
        }
        const validacaoParcelas = validarSomaParcelasCompraGrade(parcelasCompraGrade, total);
        if (!validacaoParcelas.ok) {
            showNotification(validacaoParcelas.mensagem || 'Total das parcelas diverge do valor da nota.', 'warning');
            renderizarGradeParcelasCompra();
            return;
        }
        const semVencimento = parcelasCompraGrade.some((p) => !String(p.vencimento || '').trim());
        if (semVencimento) {
            showNotification('Todas as parcelas devem ter data de vencimento.', 'warning');
            return;
        }
        const valorZero = parcelasCompraGrade.some((p) => moedaParcelaCompra(p.valor) <= 0);
        if (valorZero) {
            showNotification('Nenhuma parcela pode ter valor zero.', 'warning');
            return;
        }
    }

    const helpersCnpj = obterHelpersCnpjCompra();
    const cnpjCompra = obterCnpjCompraDigitos();
    if (cnpjCompra && helpersCnpj && !helpersCnpj.validarCnpjCompra(cnpjCompra)) {
        showNotification('CNPJ do fornecedor inválido.', 'warning');
        return;
    }

    garantirCompraImportadaXml();
    if (cnpjCompra) {
        compraImportadaXml.fornecedor_cnpj = cnpjCompra;
    }
    compraImportadaXml.fornecedor = $('#fornecedor').val();

    const camposFornecedor = helpersCnpj
        ? helpersCnpj.montarCamposFornecedorSave(compraImportadaXml, cnpjCompra, $('#fornecedor').val())
        : {
            fornecedor: $('#fornecedor').val(),
            fornecedor_cnpj: cnpjCompra || compraImportadaXml?.fornecedor_cnpj || '',
            fornecedor_rua: compraImportadaXml?.fornecedor_rua || '',
            fornecedor_numero: compraImportadaXml?.fornecedor_numero || '',
            fornecedor_bairro: compraImportadaXml?.fornecedor_bairro || '',
            fornecedor_cidade: compraImportadaXml?.fornecedor_cidade || '',
            fornecedor_uf: compraImportadaXml?.fornecedor_uf || '',
            fornecedor_cep: compraImportadaXml?.fornecedor_cep || ''
        };

    const data = {
        data_compra: $('#data_compra').val(),
        data_emissao: $('#data_emissao').val(),
        data_entrada: $('#data_entrada').val(),
        fornecedor: camposFornecedor.fornecedor,
        fornecedor_cnpj: camposFornecedor.fornecedor_cnpj,
        fornecedor_rua: camposFornecedor.fornecedor_rua,
        fornecedor_numero: camposFornecedor.fornecedor_numero,
        fornecedor_bairro: camposFornecedor.fornecedor_bairro,
        fornecedor_cidade: camposFornecedor.fornecedor_cidade,
        fornecedor_uf: camposFornecedor.fornecedor_uf,
        fornecedor_cep: camposFornecedor.fornecedor_cep,
        numero_nf: $('#numero_nf').val().trim(),
        serie_nf: $('#serie_nf').val().trim(),
        modelo_nf: $('#modelo_nf').val().trim() || '55',
        chave_acesso: ($('#chave_acesso').val() || '').replace(/\D/g, ''),
        valor_produtos: entradaSimplificada
            ? (isNotaAvulsa ? valorTotalItens : (Number($('#valor_produtos').val()) || Number(compraImportadaXml?.valor_produtos || total)))
            : (Number($('#valor_produtos').val()) || 0),
        valor_desconto: Number($('#valor_desconto').val()) || 0,
        valor_frete: Number($('#valor_frete').val()) || 0,
        valor_seguro: Number($('#valor_seguro').val()) || 0,
        valor_outras_despesas: Number($('#valor_outras_despesas').val()) || 0,
        valor_ipi: Number($('#valor_ipi').val()) || 0,
        valor_total_nota: Number($('#valor_total_nota').val()) || 0,
        total,
        itens: entradaSimplificada ? [] : itensCompraAtual.map((item) => {
            const sincronizado = sincronizarQuantidadesEstoqueItemCompra(
                sincronizarPrecosCadastroItemCompra(clonarDadosItemCompra(item))
            );
            return {
            produto_id: sincronizado.produto_id || null,
            produto_nome: sincronizado.produto_nome,
            codigo_barras: sincronizado.codigo_barras,
            unidade: sincronizado.unidade,
            unidade_comercial: sincronizado.unidade_comercial || 'UN',
            ncm: sincronizado.ncm,
            quantidade: Number(sincronizado.quantidade_convertida || sincronizado.quantidade || 0),
            quantidade_comercial: Number(sincronizado.quantidade_comercial || sincronizado.quantidade_embalagens || 0),
            quantidade_convertida: Number(sincronizado.quantidade_convertida || sincronizado.quantidade || 0),
            quantidade_fiscal: Number(sincronizado.quantidade_fiscal ?? sincronizado.quantidade_convertida ?? sincronizado.quantidade ?? 0),
            quantidade_nao_fiscal: Number(sincronizado.quantidade_nao_fiscal || 0),
            preco_unitario: Number(sincronizado.preco_unitario || 0),
            margem_lucro: Number(sincronizado.margem_lucro || 0),
            preco_venda_sugerido: Number(sincronizado.preco_venda_sugerido || 0),
            subtotal: Number(sincronizado.subtotal || 0),
            data_validade: sincronizado.data_validade || null,
            produto_fracionado: itemCompraEhFracionado(sincronizado) ? 1 : 0,
            vendido_por_peso: itemCompraEhFracionado(sincronizado) ? 1 : 0,
            peso_total_compra: Number(sincronizado.quantidade_convertida || sincronizado.peso_total_compra || sincronizado.quantidade || 0),
            custo_por_kg: Number(sincronizado.custo_por_kg || sincronizado.preco_unitario || 0),
            custo_unitario_final: Number(sincronizado.custo_unitario_final || sincronizado.preco_unitario || 0),
            compra_em: sincronizado.compra_em || '',
            quantidade_embalagens: Number(sincronizado.quantidade_embalagens || 0),
            quantidade_por_embalagem: Number(sincronizado.quantidade_por_embalagem || 0),
            // RC4.31.24 — itens comuns: nunca contaminar valor_total_embalagem com subtotal
            valor_total_embalagem: itemUsaModoPrecoEmbalagemCompra(sincronizado)
                ? Number(sincronizado.valor_total_embalagem || 0)
                : 0,
            // RC4.31.29 — preço da Vara/Caixa (não recalcula se já válido)
            preco_unitario_comercial: persistirPrecoUnitarioComercialItemCompra(sincronizado),
            valor_embalagem_venda: itemUsaEmbalagemComercial(sincronizado)
                ? Number(sincronizado.valor_embalagem_venda || 0)
                : 0,
            atualizar_preco_venda: Number(sincronizado.atualizar_preco_venda ?? 1),
            cfop: sincronizado.cfop || null,
            tipo_fiscal_item: sincronizado.tipo_fiscal_manual ? (sincronizado.tipo_fiscal_item || null) : null,
            bonificacao: Number(sincronizado.bonificacao || 0),
            embalagem_id: sincronizado.embalagem_id || null,
            produto_apresentacao_id: sincronizado.produto_apresentacao_id || sincronizado.embalagem_id || null,
            origem_conversao: sincronizado.origem_conversao
                || (itemUsaModoPrecoEmbalagemCompra(sincronizado) ? 'MANUAL' : null),
            fator_conversao: Number(sincronizado.fator_conversao || sincronizado.quantidade_por_embalagem || 0) || null,
            tipo_conversao: sincronizado.tipo_conversao || null,
            confianca_conversao: sincronizado.confianca_conversao != null ? Number(sincronizado.confianca_conversao) : null,
            tipo_origem_compra: sincronizado.tipo_origem_compra || null
        };
        }),
        condicao_pagamento: condicaoPagamento,
        forma_pagamento: $('#forma_pagamento').val(),
        data_vencimento: $('#data_vencimento').val(),
        parcelas: condicaoCompraUsaParcelasFlexiveis(condicaoPagamento)
            ? (parcelasCompraGrade.length || parcelas)
            : 1,
        dias_entre_parcelas: diasEntre,
        parcelas_detalhe: parcelasCompraGrade.length > 0
            ? parcelasCompraGrade.map((p) => ({
                numero: p.numero,
                documento: p.documento || null,
                vencimento: p.vencimento,
                valor: moedaParcelaCompra(p.valor),
                tipo: p.tipo || 'parcela'
            }))
            : [],
        parcelas_importadas_xml: parcelasImportadasXml ? 1 : 0,
        valor_entrada: valorEntrada,
        observacao: $('#observacao_compra').val(),
        nota_fiscal_avulsa: isNotaAvulsa ? 1 : 0,
        tipo_entrada: obterTipoEntradaSelecionado(),
        tipo_entrada_sugerido: classificacaoEntradaAtual?.tipoEntrada || null,
        tipo_entrada_confianca: classificacaoEntradaAtual?.confianca ?? null,
        tipo_entrada_motivo: classificacaoEntradaAtual?.motivo || null,
        origem_compra: isOrigemCompraCentralNfe() ? ORIGEM_COMPRA.CENTRAL_NFE : ORIGEM_COMPRA.MANUAL,
        xml: compraImportadaXml?.xml || null
    };

    if (centralDocumentoIdAtual) {
        data.central_documento_id = centralDocumentoIdAtual;
    }

    if (data.chave_acesso && data.chave_acesso.length !== 44) {
        showNotification('A chave de acesso deve ter 44 dígitos.', 'warning');
        return;
    }

    if (!data.fornecedor || !data.fornecedor.trim()) {
        showNotification('Informe o fornecedor da nota.', 'warning');
        return;
    }

    mostrarResumoFiscalObrigatorio(data, isUsoConsumo, isNotaAvulsa);
}

function campoFiscalDivergenteHtml(label, xmlVal, usadoVal, motivo) {
    const xml = xmlVal || '—';
    const usado = usadoVal || '';
    const diverge = xmlVal && usadoVal && String(xmlVal) !== String(usadoVal);
    if (!diverge) {
        return `<tr>
            <td>${escapeHtml(label)}</td>
            <td class="text-muted small">${escapeHtml(xml)}</td>
            <td><input type="text" class="form-control form-control-sm fiscal-campo-utilizado" data-campo="${escapeHtml(label)}" value="${escapeHtml(usado)}"></td>
        </tr>`;
    }
    return `<tr class="table-warning">
        <td>${escapeHtml(label)} <span class="badge bg-warning text-dark">divergente</span></td>
        <td>
            <div class="small text-muted">${escapeHtml(label)} XML</div>
            <strong>${escapeHtml(xml)}</strong>
        </td>
        <td>
            <div class="small text-muted">${escapeHtml(label)} Utilizado</div>
            <input type="text" class="form-control form-control-sm fiscal-campo-utilizado border-warning" data-campo="${escapeHtml(label)}" value="${escapeHtml(usado)}">
            ${motivo ? `<div class="small text-muted mt-1">Motivo: ${escapeHtml(motivo)}</div>` : ''}
        </td>
    </tr>`;
}

function mapCampoFiscalKey(label) {
    const map = {
        CFOP: 'cfop',
        'CSOSN/CST': 'csosn_cst',
        'CST PIS': 'cst_pis',
        'CST COFINS': 'cst_cofins',
        'CST IPI': 'cst_ipi',
        'Natureza da Operação': 'natureza_operacao'
    };
    return map[label] || null;
}

async function mostrarResumoFiscalObrigatorio(data, isUsoConsumo, isNotaAvulsa) {
    let resumo;
    try {
        const resp = await fetch(`${API_URL}/compras/resumo-fiscal-entrada`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('token') || ''}`
            },
            body: JSON.stringify({
                xml: data.xml,
                tipo_entrada: data.tipo_entrada,
                dadosCompra: dadosCompraSemXmlParaApi(data),
                fornecedor: data.fornecedor,
                valor_total_nota: data.valor_total_nota || data.total
            })
        });
        resumo = await resp.json();
        if (!resp.ok) throw new Error(resumo.error || 'Falha no resumo fiscal');
    } catch (err) {
        showNotification(err.message || 'Não foi possível montar o resumo fiscal.', 'danger');
        return;
    }

    const motivoSug = resumo.motivo || '';
    const linhas = (resumo.campos || []).map((c) =>
        campoFiscalDivergenteHtml(c.label, c.xml, c.utilizado, c.divergente ? motivoSug : '')
    ).join('');

    const modalId = 'resumoFiscalEntradaModal';
    $(`#${modalId}`).remove();
    const html = `
        <div class="modal fade" id="${modalId}" tabindex="-1" data-bs-backdrop="static">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header bg-light">
                        <h5 class="modal-title"><i class="fas fa-file-invoice-dollar me-2"></i>Validação Fiscal Obrigatória</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-warning small mb-3">
                            <strong>XML SEFAZ é imutável.</strong> Alterações abaixo afetam somente a escrituração fiscal interna da empresa.
                        </div>
                        <div class="row g-2 mb-3 small">
                            <div class="col-md-6"><strong>Fornecedor</strong><div>${escapeHtml(resumo.fornecedor || data.fornecedor || '—')}</div></div>
                            <div class="col-md-6"><strong>Tipo da Entrada</strong><div>${escapeHtml(resumo.tipoEntradaLabel || rotuloTipoEntradaCompra(data.tipo_entrada))}</div></div>
                            <div class="col-md-6"><strong>Valor Total da NF-e</strong><div>${formatCurrency(resumo.valorTotal || data.valor_total_nota || data.total || 0)}</div></div>
                        </div>
                        <div class="table-responsive">
                            <table class="table table-sm align-middle">
                                <thead>
                                    <tr><th>Campo</th><th>XML / Original</th><th>Escrituração</th></tr>
                                </thead>
                                <tbody>
                                    ${linhas || '<tr><td colspan="3">Sem dados fiscais no XML — preencha a escrituração.</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                        <div class="mb-2">
                            <label class="form-label small">Motivo da alteração (quando divergente)</label>
                            <input type="text" class="form-control form-control-sm" id="escrituracaoMotivoInput" value="${escapeHtml(motivoSug || '')}" placeholder="Ex.: Classificação Uso e Consumo">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Voltar</button>
                        <button type="button" class="btn btn-primary" id="btnConfirmarEscrituracaoFiscal">
                            <i class="fas fa-check me-1"></i> Confirmar e gravar entrada
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
    $('body').append(html);
    const el = document.getElementById(modalId);
    const modal = new bootstrap.Modal(el);
    $('#btnConfirmarEscrituracaoFiscal').on('click', () => {
        const payload = { ...data };
        payload.cfop_xml = resumo.original?.cfop || null;
        payload.csosn_cst_xml = resumo.original?.csosn_cst || null;
        payload.cst_pis_xml = resumo.original?.cst_pis || null;
        payload.cst_cofins_xml = resumo.original?.cst_cofins || null;
        payload.cst_ipi_xml = resumo.original?.cst_ipi || null;
        payload.natureza_operacao_xml = resumo.original?.natureza_operacao || null;

        document.querySelectorAll(`#${modalId} .fiscal-campo-utilizado`).forEach((input) => {
            const key = mapCampoFiscalKey(input.getAttribute('data-campo'));
            if (key) payload[key] = String(input.value || '').trim();
        });
        payload.escrituracao_motivo = String($('#escrituracaoMotivoInput').val() || '').trim() || null;

        modal.hide();
        el.addEventListener('hidden.bs.modal', () => {
            $(`#${modalId}`).remove();
            executarGravacaoCompra(payload, isUsoConsumo, isNotaAvulsa);
        }, { once: true });
    });
    modal.show();
}

function executarGravacaoCompra(data, isUsoConsumo, isNotaAvulsa) {
    $.ajax({
        url: `${API_URL}/compras`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(data)
    }).done(function(resp) {
        const docCentral = centralDocumentoIdAtual;
        centralDocumentoIdAtual = null;
        origemCompraAtual = ORIGEM_COMPRA.MANUAL;
        classificacaoEntradaAtual = null;
        // RC4.31.25 — histórico gravado em compras_itens; limpa cache para próxima seleção
        (Array.isArray(data?.itens) ? data.itens : []).forEach((it) => {
            if (it?.produto_id) invalidarCacheUltimaCompraProduto(it.produto_id);
        });
        $('#compraModal').modal('hide');
        if (resp?.aviso || resp?.vinculoCentral?.ok === false) {
            showNotification(
                resp.aviso || 'Compra gravada, mas o vínculo com a Central ficou pendente de reconciliação.',
                'warning'
            );
        } else {
            showNotification(
                isUsoConsumo ? 'Compra de Uso e Consumo registrada com sucesso!'
                    : (isNotaAvulsa ? 'Nota Fiscal Avulsa registrada com sucesso!' : 'Compra registrada com sucesso!'),
                'success'
            );
        }
        loadCompras();
        if (docCentral && typeof loadPage === 'function') {
            sessionStorage.setItem('central_pos_gravacao', String(docCentral));
        }
    }).fail(function(xhr) {
        showNotification(xhr.responseJSON?.error || 'Erro ao registrar compra.', 'danger');
    });
}

function toggleNotaFiscalAvulsa() {
    const isNotaAvulsa = $('#nota_fiscal_avulsa').is(':checked');

    if (isNotaAvulsa) {
        $('#itensCompraSection').hide();
        $('#adicionarItemRow').hide();
        $('#itensCompraTable').hide();
        $('#col_valor_produtos').hide();
        $('#col_valor_desconto').hide();
        $('#col_valor_total_itens').show();
        $('#valor_total_itens').prop('readonly', false);
        $('#valor_total_itens').val('0.00');
        $('#valor_total_nota').prop('readonly', false);
        $('#valor_total_nota').val('0.00');
        $('#valor_total_nota_hint').text('Informe o valor total da nota fiscal.');
        $('#totaisNotaSection').show();
        $('#pagamentoSection').show();
        recalcularTotalNotaAvulsa();
    } else {
        $('#itensCompraSection').show();
        $('#adicionarItemRow').show();
        $('#itensCompraTable').show();
        $('#col_valor_produtos').show();
        $('#col_valor_desconto').show();
        $('#col_valor_total_itens').show();
        $('#valor_total_itens').prop('readonly', true);
        $('#valor_produtos').prop('readonly', true);
        $('#valor_total_nota').prop('readonly', true);
        $('#valor_total_nota_hint').text('Calculado automaticamente a partir dos itens.');
        $('#totaisNotaSection').show();
        $('#pagamentoSection').show();
        recalcularTotaisCompraNota();
    }
}

function recalcularTotalNotaAvulsa() {
    const valorTotalItens = Number($('#valor_total_itens').val()) || 0;
    const frete = Number($('#valor_frete').val()) || 0;
    const seguro = Number($('#valor_seguro').val()) || 0;
    const outras = Number($('#valor_outras_despesas').val()) || 0;
    const ipi = Number($('#valor_ipi').val()) || 0;
    const totalNota = Number((valorTotalItens + frete + seguro + outras + ipi).toFixed(2));

    $('#valor_produtos').val(formatNumberInput(valorTotalItens));
    $('#valor_total_nota').val(formatNumberInput(totalNota));
}

function viewCompra(id) {
    $.ajax({ url: `${API_URL}/compras/${id}`, method: 'GET' }).done(function(compra) {
        const isNotaAvulsa = Number(compra.nota_fiscal_avulsa) === 1;
        const podeEditarVenda = typeof podeAjustarEstoque === 'function'
            ? podeAjustarEstoque()
            : (() => {
                const u = obterUsuarioLogadoCompra();
                const perfil = String(u.perfil || u.nivel || '').trim().toUpperCase();
                return u.role === 'admin' || perfil === 'SUPER_ADMIN' || perfil === 'ADMIN';
            })();

        const financeiroHtml = (compra.financeiro || []).map(f => `
            <tr>
                <td>${f.numero_parcela ? `${f.numero_parcela}/${f.total_parcelas}` : '-'}</td>
                <td>${formatDate(f.vencimento || f.data_movimento)}</td>
                <td>${f.status}</td>
                <td>${formatCurrency(f.valor)}</td>
            </tr>
        `).join('') || '<tr><td colspan="4" class="text-center">Sem lançamentos financeiros.</td></tr>';

        const itensLista = compra.itens || [];
        const itensHtml = isNotaAvulsa
            ? '<tr><td colspan="8" class="text-center text-muted">Nota Fiscal Avulsa - sem itens</td></tr>'
            : itensLista.map((item, index) => {
                const margem = item.margem_lucro != null ? item.margem_lucro : MARGEM_PADRAO_FALLBACK_COMPRA;
                const vendaCell = podeEditarVenda
                    ? `<input type="number" step="0.01" min="0" class="form-control form-control-sm"
                        data-view-preco-venda-item="${index}"
                        data-item-id="${Number(item.id)}"
                        data-custo="${Number(item.preco_unitario || 0)}"
                        value="${Number(item.preco_venda_sugerido || 0).toFixed(2)}"
                        title="Admin: altere a venda sugerida. Tab = próximo produto"
                        onchange="salvarPrecoVendaViewCompra(${compra.id}, ${Number(item.id)}, this, ${index})"
                        onkeydown="onKeydownPrecoVendaViewCompra(event, ${compra.id}, ${index})">`
                    : formatCurrency(item.preco_venda_sugerido || 0);
                return `
            <tr data-view-compra-item-index="${index}">
                <td>${escapeHtml(item.produto_nome || item.descricao_produto || '-')}${renderResumoConversaoItemCompraHtml(item)}</td>
                <td>${formatarQuantidadeItemCompra(item)}</td>
                <td>${formatCurrency(item.preco_unitario)}</td>
                <td class="view-compra-margem-cell">${formatNumberInput(margem)}%</td>
                <td>${vendaCell}</td>
                <td>${formatCurrency(item.subtotal)}</td>
            </tr>`;
            }).join('');

        const hintAdmin = podeEditarVenda && !isNotaAvulsa
            ? '<p class="small text-muted mb-2"><i class="fas fa-user-shield"></i> Administrador: você pode alterar a venda sugerida nesta tela (atualiza o cadastro do produto).</p>'
            : '';

        const modalHtml = `
            <div class="modal fade" id="viewCompraModal" tabindex="-1">
                <div class="modal-dialog modal-lg modal-dialog-scrollable">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Compra ${compra.id}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p><strong>Fornecedor:</strong> ${escapeHtml(compra.fornecedor || '-')}</p>
                            <p>
                                <strong>Data compra:</strong> ${formatDate(compra.data_compra)}
                                ${compra.data_emissao ? ` | <strong>Emissão:</strong> ${formatDate(compra.data_emissao)}` : ''}
                                ${compra.data_entrada ? ` | <strong>Entrada:</strong> ${formatDate(compra.data_entrada)}` : ''}
                            </p>
                            <p>
                                <strong>Número NF:</strong> ${escapeHtml(compra.numero_nf || '-')}
                                | <strong>Série:</strong> ${escapeHtml(compra.serie_nf || '-')}
                                | <strong>Modelo:</strong> ${escapeHtml(compra.modelo_nf || '-')}
                            </p>
                            <p style="word-break: break-all;">
                                <strong>Chave de acesso:</strong> ${escapeHtml(compra.chave_acesso || '-')}
                            </p>
                            <p>
                                <strong>Valor produtos:</strong> ${formatCurrency(compra.valor_produtos || 0)}
                                | <strong>Desconto:</strong> ${formatCurrency(compra.valor_desconto || 0)}
                                | <strong>Frete:</strong> ${formatCurrency(compra.valor_frete || 0)}
                                | <strong>Seguro:</strong> ${formatCurrency(compra.valor_seguro || 0)}
                                | <strong>Outras despesas:</strong> ${formatCurrency(compra.valor_outras_despesas || 0)}
                                | <strong>IPI:</strong> ${formatCurrency(compra.valor_ipi || 0)}
                            </p>
                            <p>
                                <strong>Total nota:</strong> ${formatCurrency(compra.valor_total_nota || compra.total || 0)}
                                | <strong>Condição:</strong> ${rotuloCondicaoPagamento(compra.condicao_pagamento || 'avista')}
                                | <strong>Forma:</strong> ${rotuloFormaPagamento(compra.forma_pagamento)}
                            </p>
                            <p><strong>Observação:</strong> ${escapeHtml(compra.observacao || '-')}</p>
                            ${String(compra.chave_acesso || '').replace(/\D/g, '').length === 44 ? `
                            <div class="mb-3">
                                <button class="btn btn-danger btn-sm" onclick="$('#viewCompraModal').modal('hide'); setTimeout(function(){ abrirModalNFeDevolucaoCompra(${compra.id}); }, 300);">
                                    <i class="fas fa-file-invoice"></i> Emitir NF-e de Devolução
                                </button>
                            </div>` : ''}
                            <h6>Itens</h6>
                            ${hintAdmin}
                            <table class="table table-bordered"><thead><tr><th>Produto</th><th>Qtd</th><th>Preço compra</th><th>Margem</th><th>Venda sugerida</th><th>Subtotal</th></tr></thead><tbody>${itensHtml}</tbody></table>
                            <h6>Lançamentos financeiros gerados</h6>
                            <table class="table table-bordered"><thead><tr><th>Parcela</th><th>Vencimento</th><th>Status</th><th>Valor</th></tr></thead><tbody>${financeiroHtml}</tbody></table>
                        </div>
                    </div>
                </div>
            </div>
        `;
        $('#modal-container').html(modalHtml);
        $('#viewCompraModal').modal('show');
    }).fail(function(xhr) {
        showNotification(xhr.responseJSON?.error || 'Erro ao carregar compra.', 'danger');
    });
}

function focarPrecoVendaViewCompra(indice) {
    const el = document.querySelector(`#viewCompraModal input[data-view-preco-venda-item="${indice}"]`);
    if (!el) return;
    el.focus();
    if (typeof el.select === 'function') el.select();
}

function onKeydownPrecoVendaViewCompra(event, compraId, index) {
    if (event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
        return;
    }
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const destino = event.shiftKey ? index - 1 : index + 1;
    salvarPrecoVendaViewCompra(compraId, Number(event.target.getAttribute('data-item-id')), event.target, index, {
        focarIndice: destino
    });
}

function salvarPrecoVendaViewCompra(compraId, itemId, inputEl, index, opcoes = {}) {
    const valor = Number(String(inputEl?.value ?? '').replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0) {
        showNotification('Informe um preço de venda válido.', 'warning');
        return;
    }
    const custo = Number(inputEl?.getAttribute('data-custo') || 0);
    const margemPreview = custo > 0 ? Number((((valor - custo) / custo) * 100).toFixed(2)) : 0;
    const $row = $(inputEl).closest('tr');
    $row.find('.view-compra-margem-cell').text(`${formatNumberInput(margemPreview)}%`);

    $.ajax({
        url: `${API_URL}/compras/${compraId}/itens/${itemId}/preco-venda`,
        method: 'PATCH',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
        data: JSON.stringify({
            preco_venda_sugerido: Number(valor.toFixed(2)),
            atualizar_cadastro: true
        })
    }).done(function (resp) {
        if (resp?.margem_lucro != null) {
            $row.find('.view-compra-margem-cell').text(`${formatNumberInput(resp.margem_lucro)}%`);
        }
        if (inputEl) {
            inputEl.value = Number(resp?.preco_venda_sugerido ?? valor).toFixed(2);
        }
        const focar = opcoes.focarIndice;
        if (Number.isInteger(focar) && focar >= 0) {
            const total = document.querySelectorAll('#viewCompraModal input[data-view-preco-venda-item]').length;
            if (focar < total) focarPrecoVendaViewCompra(focar);
        }
    }).fail(function (xhr) {
        showNotification(xhr.responseJSON?.error || 'Erro ao atualizar preço de venda.', 'danger');
    });
}

function cancelarCompra(id) {
    const modalHtml = `
        <div class="modal fade" id="modalCancelarCompra" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header bg-warning text-dark">
                        <h5 class="modal-title"><i class="fas fa-ban"></i> Cancelar Compra #${id}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-danger">
                            <i class="fas fa-exclamation-triangle"></i>
                            O sistema vai baixar o estoque e cancelar o financeiro desta compra.
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-bold">Motivo do cancelamento</label>
                            <textarea id="motivoCancelarCompra" class="form-control" rows="3"
                                placeholder="Informe o motivo do cancelamento...">Cancelamento manual</textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Voltar</button>
                        <button type="button" class="btn btn-danger" id="btnConfirmarCancelarCompra">
                            <i class="fas fa-ban"></i> Confirmar Cancelamento
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#modalCancelarCompra').remove();
    $('body').append(modalHtml);

    const modal = new bootstrap.Modal(document.getElementById('modalCancelarCompra'));
    modal.show();

    document.getElementById('btnConfirmarCancelarCompra').addEventListener('click', function() {
        const motivo = $('#motivoCancelarCompra').val().trim();
        if (!motivo) {
            showNotification('Informe o motivo do cancelamento.', 'warning');
            return;
        }

        modal.hide();

        $.ajax({
            url: `${API_URL}/compras/${id}/cancelar`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ motivo })
        }).done(function() {
            showNotification('Compra cancelada com sucesso!', 'success');
            loadCompras();
        }).fail(function(xhr) {
            showNotification(xhr.responseJSON?.error || 'Erro ao cancelar compra.', 'danger');
        });
    });

    document.getElementById('modalCancelarCompra').addEventListener('hidden.bs.modal', function() {
        $('#modalCancelarCompra').remove();
    });
}

function abrirCadastroProdutoCentralMiip(item, callback) {
    if (typeof showProdutoModal !== 'function') {
        if (typeof callback === 'function') callback(null);
        return;
    }

    showProdutoModal(null);

    const el = document.getElementById('produtoModal');
    if (!el) {
        if (typeof callback === 'function') callback(null);
        return;
    }

    try {
        bootstrap.Modal.getOrCreateInstance(el).show();
    } catch (_) { /* ignore */ }

    const elevar = () => {
        el.style.zIndex = '21000';
        const backdrops = document.querySelectorAll('.modal-backdrop');
        const last = backdrops[backdrops.length - 1];
        if (last) last.style.zIndex = '20990';
    };
    elevar();

    el.addEventListener('shown.bs.modal', function preencherNovoProdutoCentralMiip() {
        elevar();
        $('#nome').val(item.produto_nome || '');
        if ($('#codigo_barras').length) $('#codigo_barras').val(item.codigo_barras || '').trigger('input.espelhoCodigo');
        if ($('#ncm').length) $('#ncm').val(item.ncm || '');
        if ($('#unidade').length) $('#unidade').val(item.unidade || 'UN').trigger('change');
        const custo = Number(item.preco_unitario ?? item.valor_unitario ?? 0);
        const margemInfo = itemCompraTemMargemGravada(item)
            ? { margem: Number(item.margem_lucro) }
            : extrairMargemCadastradaProduto(item);
        const margem = margemInfo.margem;
        const venda = Number(item.preco_venda_sugerido ?? (custo > 0 ? custo * (1 + margem / 100) : 0));
        if ($('#preco_compra').length) $('#preco_compra').val(formatNumberInput(custo, 4));
        if ($('#lucro_percentual').length) $('#lucro_percentual').val(formatNumberInput(margem));
        if ($('#preco_venda').length) $('#preco_venda').val(formatNumberInput(venda));
        if (typeof sincronizarFormacaoPrecoProduto === 'function') {
            sincronizarFormacaoPrecoProduto('venda');
        } else {
            $('#preco_compra').trigger('input').trigger('change');
        }
        if (item.codigo_fornecedor && $('#codigo').length && !String($('#codigo').val() || '').trim()) {
            $('#codigo').val(String(item.codigo_fornecedor).trim());
        }
        if (item.fornecedor && $('#fornecedor').length) {
            $('#fornecedor').val(String(item.fornecedor).trim());
        }
    }, { once: true });

    el.addEventListener('hidden.bs.modal', function aposCadastroCentralMiip() {
        const ultimo = produtosCompraList[produtosCompraList.length - 1];
        if (typeof callback === 'function') callback(ultimo || null);
    }, { once: true });
}

function finalizarImportacaoXmlCompra(data) {
    (async () => {
        const classificacao = await classificarEntradaCompraApi(data);
        classificacaoEntradaAtual = classificacao;
        mostrarDialogoPoliticaEntrada((tipo, classif) => {
            compraImportadaXml = data;
            tipoEntradaCompraAtual = tipo;
            classificacaoEntradaAtual = classif || classificacao;
            preencherFormularioCompra(data);
            if (tipo === TIPOS_ENTRADA_COMPRA.USO_CONSUMO) {
                definirTipoEntradaCompra(tipo, { silencioso: true });
                aplicarPoliticaEntradaCompra();
                showNotification('NF-e carregada para Uso e Consumo — sem produtos ou estoque.', 'success');
            } else {
                definirTipoEntradaCompra(tipo, { silencioso: true });
                aplicarPoliticaEntradaCompra();
                aplicarMiipImportacaoXml(data);
                showNotification('Dados da nota carregados pela Central Inteligente.', 'success');
            }
        }, classificacao);
    })();
}

function abrirCompraDesdeCentralEntradas(payload) {
    if (!payload?.dadosCompra) return;

    // RC8.4.1 — deep clone do payload (sessionStorage / bridge) antes de usar
    const payloadIsolado = clonarDadosItemCompra(payload);
    centralDocumentoIdAtual = payloadIsolado.documentoId || null;
    showCompraModal();
    origemCompraAtual = ORIGEM_COMPRA.CENTRAL_NFE;
    finalizarImportacaoXmlCompra(payloadIsolado.dadosCompra);
}

function voltarParaCentralAposGravacaoCompra() {
    const docCentral = sessionStorage.getItem('central_pos_gravacao');
    if (!docCentral) return false;
    sessionStorage.removeItem('central_pos_gravacao');

    if (typeof loadPage === 'function') {
        loadPage('central-entradas');
        return;
    }

    showNotification('Abra o menu Central Inteligente de Entradas.', 'info');
}

function consumirPendenciaCompraCentral() {
    try {
        const raw = sessionStorage.getItem('central_abrir_compra');
        if (!raw) return;

        sessionStorage.removeItem('central_abrir_compra');
        // JSON.parse já gera objetos novos; clonar de novo isola nested se houver reuso
        const payload = clonarDadosItemCompra(JSON.parse(raw));
        abrirCompraDesdeCentralEntradas(payload);
    } catch (error) {
        console.error('Erro ao abrir compra da Central:', error);
    }
}

function normalizarGradeParcelasXmlCompra(lista) {
    if (!Array.isArray(lista)) return [];
    return lista.map((p, idx) => ({
        numero: Number(p.numero) || (idx + 1),
        vencimento: String(p.vencimento || p.dVenc || '').slice(0, 10),
        valor: moedaParcelaCompra(p.valor ?? p.vDup),
        tipo: p.tipo || 'parcela',
        documento: p.documento != null ? String(p.documento) : (p.nDup != null ? String(p.nDup) : null)
    })).filter((p) => p.vencimento && p.valor >= 0);
}

/** RC4.31.14 — carrega financeiro do payload XML antes de renderizar itens */
function aplicarFinanceiroImportadoCompra(data = {}) {
    const condicao = data.condicao_pagamento === 'prazo' ? 'prazo' : 'avista';
    $('#condicao_pagamento').val(condicao);

    const forma = data.forma_pagamento || '';
    if (forma) {
        const $fp = $('#forma_pagamento');
        if ($fp.find(`option[value="${forma}"]`).length === 0) {
            $fp.append(`<option value="${forma}">${rotuloFormaPagamento(forma)}</option>`);
        }
        $fp.val(forma);
    }

    parcelasCompraEditadasManual = false;
    parcelasImportadasXml = false;

    let gradeXml = normalizarGradeParcelasXmlCompra(data.parcelas_detalhe);
    if (!gradeXml.length && Array.isArray(data.duplicatas) && data.duplicatas.length) {
        gradeXml = normalizarGradeParcelasXmlCompra(data.duplicatas);
    }

    if (condicao === 'prazo' && gradeXml.length > 0) {
        $('#parcelas').val(gradeXml.length).prop('disabled', false);
        $('#dias_entre_parcelas').prop('disabled', false);
        if (data.data_vencimento) {
            $('#data_vencimento').val(String(data.data_vencimento).slice(0, 10));
        } else if (gradeXml[0]?.vencimento) {
            $('#data_vencimento').val(String(gradeXml[0].vencimento).slice(0, 10));
        }
        parcelasCompraGrade = gradeXml;
        parcelasCompraEditadasManual = true;
        parcelasImportadasXml = true;
    } else {
        $('#parcelas').val(1).prop('disabled', true);
        $('#dias_entre_parcelas').val(0).prop('disabled', true);
        parcelasCompraGrade = [];
        parcelasCompraEditadasManual = false;
        parcelasImportadasXml = false;
    }

    atualizarVisibilidadePagamentoCompra();
    if (parcelasCompraGrade.length) {
        renderizarGradeParcelasCompra();
    }
}

function resetFinanceiroCompraModal() {
    parcelasCompraGrade = [];
    parcelasCompraEditadasManual = false;
    parcelasImportadasXml = false;
    $('#parcelas_detalhes').html('');
}

function preencherFormularioCompra(dataBruto) {
    const data = clonarDadosItemCompra(dataBruto) || {};
    $('#data_emissao').val(data.data_emissao || $('#data_compra').val());
    $('#data_entrada').val(data.data_entrada || $('#data_compra').val());
    $('#fornecedor').val(data.fornecedor || '');
    cnpjEmitenteXmlOriginal = String(data.fornecedor_cnpj || '').replace(/\D/g, '') || null;
    $('#fornecedor_cnpj').val(typeof formatarCpfCnpj === 'function'
        ? formatarCpfCnpj(data.fornecedor_cnpj || '')
        : (data.fornecedor_cnpj || ''));
    atualizarAlertaCnpjXmlDivergente();
    $('#numero_nf').val(data.numero_nf || '');
    $('#serie_nf').val(data.serie_nf || '');
    $('#modelo_nf').val(data.modelo_nf || '55');
    $('#chave_acesso').val(data.chave_acesso || '');
    $('#observacao_compra').val(data.observacao || '');
    $('#valor_produtos').val(formatNumberInput(data.valor_produtos || 0));
    $('#valor_desconto').val(formatNumberInput(data.valor_desconto || 0));
    $('#valor_frete').val(formatNumberInput(data.valor_frete || 0));
    $('#valor_seguro').val(formatNumberInput(data.valor_seguro || 0));
    $('#valor_outras_despesas').val(formatNumberInput(data.valor_outras_despesas || 0));
    $('#valor_ipi').val(formatNumberInput(data.valor_ipi || 0));
    $('#valor_total_nota').val(formatNumberInput(data.valor_total_nota || 0));

    // RC4.31.14 — financeiro antes dos itens (evita sobrescrita no render)
    aplicarFinanceiroImportadoCompra(data);

    limparDraftCompra();
    const tipoEntrada = tipoEntradaCompraAtual || obterTipoEntradaSelecionado();
    itensCompraAtual = aplicarDistribuicaoFiscalItensCentral(
        (data.itens || []).map((item) => normalizeItemCompra(
            enriquecerItemFiscalCompraUi(clonarDadosItemCompra(item))
        )),
        tipoEntrada
    );
    renderItensCompraTabela();
    recalcularTotaisCompraNota();
}

function abrirCentralInteligenteEntradas() {
    const modalEl = document.getElementById('compraModal');
    if (modalEl) {
        const instancia = bootstrap.Modal.getInstance(modalEl);
        if (instancia) instancia.hide();
    }

    if (typeof loadPage === 'function') {
        loadPage('central-entradas');
        return;
    }

    showNotification('Abra o menu Central Inteligente de Entradas.', 'info');
}

function abrirDevolucaoCompra(id) {
    $.ajax({
        url: `${API_URL}/compras/${id}`,
        method: 'GET'
    }).done(function(compra) {
        const itens = compra.itens || [];

        const linhas = itens.map(item => {
            const qtdComprada = Number(item.quantidade || 0);
            const qtdDevolvida = Number(item.quantidade_devolvida || 0);
            const qtdDisponivel = Math.max(0, qtdComprada - qtdDevolvida);

            return `
                <tr>
                    <td>
                        <strong>${escapeHtml(item.produto_nome || '-')}</strong><br>
                        <small>Cód: ${escapeHtml(item.produto_codigo || item.codigo_barras || '-')}</small>
                    </td>
                    <td>${qtdComprada}</td>
                    <td>${qtdDevolvida}</td>
                    <td><strong>${qtdDisponivel}</strong></td>
                    <td>${formatCurrency(item.custo_unitario_final || item.preco_unitario || 0)}</td>
                    <td>
                        <input
                            type="number"
                            class="form-control form-control-sm qtd-devolver-compra"
                            data-item-id="${item.id}"
                            min="0"
                            max="${qtdDisponivel}"
                            step="0.001"
                            value="0"
                            ${qtdDisponivel <= 0 ? 'disabled' : ''}
                        >
                    </td>
                </tr>
            `;
        }).join('');

        const modalHtml = `
            <div class="modal fade" id="modalDevolucaoCompra" tabindex="-1">
                <div class="modal-dialog modal-lg modal-dialog-scrollable">
                    <div class="modal-content">
                        <div class="modal-header bg-secondary text-white">
                            <h5 class="modal-title">
                                <i class="fas fa-undo"></i> Devolução da Compra #${compra.id}
                            </h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>

                        <div class="modal-body">
                            <div class="alert alert-warning">
                                Esta devolução é interna: baixa estoque e gera crédito no financeiro.
                                A emissão fiscal SEFAZ modelo 55 será a próxima etapa.
                            </div>

                            <p><strong>Fornecedor:</strong> ${escapeHtml(compra.fornecedor || '-')}</p>
                            <p><strong>Total da compra:</strong> ${formatCurrency(compra.total)}</p>

                            <div class="mb-3">
                                <label class="form-label">Motivo da devolução</label>
                                <textarea id="motivoDevolucaoCompra" class="form-control" rows="3"
                                    placeholder="Ex: Produto veio errado, danificado ou diferente do solicitado."></textarea>
                            </div>

                            <div class="table-responsive">
                                <table class="table table-sm table-bordered align-middle">
                                    <thead>
                                        <tr>
                                            <th>Produto</th>
                                            <th>Comprada</th>
                                            <th>Já devolvida</th>
                                            <th>Disponível</th>
                                            <th>Custo</th>
                                            <th>Qtd devolver</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${linhas || '<tr><td colspan="6" class="text-center">Nenhum item encontrado.</td></tr>'}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div class="modal-footer">
                            <button class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                            <button class="btn btn-danger" onclick="confirmarDevolucaoCompra(${compra.id})">
                                Confirmar devolução
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        $('#modalDevolucaoCompra').remove();
        $('body').append(modalHtml);
        $('#modalDevolucaoCompra').modal('show');

        $('#modalDevolucaoCompra').on('hidden.bs.modal', function () {
            $('#modalDevolucaoCompra').remove();
        });
    }).fail(function(xhr) {
        showNotification(xhr.responseJSON?.error || 'Erro ao carregar compra.', 'danger');
    });
}

function confirmarDevolucaoCompra(id) {
    const motivo = $('#motivoDevolucaoCompra').val().trim();

    if (!motivo || motivo.length < 10) {
        showNotification('Informe um motivo com no mínimo 10 caracteres.', 'warning');
        return;
    }

    const itens = [];

    $('.qtd-devolver-compra').each(function() {
        const quantidade = Number($(this).val() || 0);
        const compraItemId = Number($(this).data('item-id'));
        const max = Number($(this).attr('max') || 0);

        if (quantidade > max) {
            showNotification('Quantidade devolvida maior que a disponível.', 'warning');
            itens.length = 0;
            return false;
        }

        if (quantidade > 0) {
            itens.push({
                compra_item_id: compraItemId,
                quantidade
            });
        }
    });

    if (!itens.length) {
        showNotification('Informe a quantidade de pelo menos um item para devolver.', 'warning');
        return;
    }

    if (!confirm('Confirma a devolução parcial/total dos itens selecionados?')) {
        return;
    }

    $.ajax({
        url: `${API_URL}/compras/${id}/devolver`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ motivo, itens })
    }).done(function(resp) {
        showNotification(resp.message || 'Devolução registrada com sucesso.', 'success');
        $('#modalDevolucaoCompra').modal('hide');
        loadCompras();
    }).fail(function(xhr) {
        showNotification(xhr.responseJSON?.error || 'Erro ao registrar devolução.', 'danger');
    });
}

/** Descrições oficiais dos CFOPs usados em devolução (somente UX / exibição). */
const CFOP_DESCRICOES_DEVOLUCAO = Object.freeze({
    '1202': 'Devolução de venda de mercadoria adquirida ou recebida de terceiros',
    '1411': 'Devolução de mercadoria adquirida ou recebida de terceiros em operação com ST',
    '2202': 'Devolução de venda de mercadoria adquirida ou recebida de terceiros',
    '2411': 'Devolução de mercadoria adquirida ou recebida de terceiros em operação com ST',
    '5201': 'Devolução de compra para industrialização',
    '5202': 'Devolução de compra para comercialização',
    '5411': 'Devolução de compra para comercialização em operação com ST',
    '6201': 'Devolução de compra para industrialização',
    '6202': 'Devolução de compra para comercialização',
    '6411': 'Devolução de compra para comercialização em operação com ST'
});

function formatarCodigoCfopExibicao(cfop) {
    const d = String(cfop || '').replace(/\D/g, '').slice(0, 4);
    if (d.length !== 4) return d || '—';
    return `${d[0]}.${d.slice(1)}`;
}

function obterDescricaoCfopDevolucao(cfop) {
    const d = String(cfop || '').replace(/\D/g, '').slice(0, 4);
    if (!d) return '';
    const desc = CFOP_DESCRICOES_DEVOLUCAO[d];
    if (desc) return `${formatarCodigoCfopExibicao(d)} — ${desc}`;
    return `${formatarCodigoCfopExibicao(d)} — CFOP informado`;
}

function atualizarDescricaoCfopNfeDevolucao() {
    const cfop = String($('#nfeDevCfopPadrao').val() || '').replace(/\D/g, '').slice(0, 4);
    const $el = $('#nfeDevCfopDescricao');
    if (!$el.length) return;
    $el.text(cfop ? obterDescricaoCfopDevolucao(cfop) : 'Informe o CFOP para ver a descrição.');
}

function filtrarProdutosNfeDevolucaoCompra() {
    const termo = String($('#nfeDevBuscaProduto').val() || '').trim().toLowerCase();
    const $rows = $('#nfeDevProdutosTabela tbody tr.nfe-dev-produto-row');
    let visiveis = 0;

    $rows.each(function() {
        if (!termo) {
            $(this).show();
            visiveis += 1;
            return;
        }
        const nome = String($(this).attr('data-produto-nome') || '').toLowerCase();
        const codigo = String($(this).attr('data-produto-codigo') || '').toLowerCase();
        const match = nome.includes(termo) || codigo.includes(termo);
        $(this).toggle(match);
        if (match) visiveis += 1;
    });

    const $vazio = $('#nfeDevBuscaVazio');
    if ($vazio.length) {
        $vazio.toggle(termo.length > 0 && visiveis === 0);
    }
}

function coletarItensFormularioNfeDevolucaoCompra(opcoes = {}) {
    const itens = [];
    let excedeu = false;
    $('#modalNFeDevolucaoCompra .nfe-dev-qtd').each(function() {
        const qtd = Number($(this).val() || 0);
        if (!(qtd > 0)) return;
        const max = Number($(this).data('max') || 0);
        if (qtd > max + 1e-9) {
            if (opcoes.notificarExcesso !== false) {
                showNotification(
                    `Quantidade ${qtd} excede o Disponível para Devolver (${max}).`,
                    'warning'
                );
            }
            excedeu = true;
            return false;
        }
        itens.push({
            compra_item_id: Number($(this).data('compra-item-id')),
            produto_id: Number($(this).data('produto-id')) || null,
            produto_nome: String($(this).closest('tr').attr('data-produto-nome') || '').trim() || null,
            quantidade: qtd,
            valor_unitario: Number($(this).data('valor-unitario') || 0),
            cfop: String($('#nfeDevCfopPadrao').val() || '').replace(/\D/g, '').slice(0, 4)
        });
    });
    return { itens, excedeu };
}

function coletarPayloadRascunhoDevolucaoCompra(compraId) {
    const chave = String($('#chaveNFeFornecedorDevolucao').val() || '').replace(/\D/g, '');
    const fornecedor = String($('#nfeDevFornecedorNome').val() || '').trim();
    const { itens, excedeu } = coletarItensFormularioNfeDevolucaoCompra();
    return {
        excedeu,
        payload: {
            compra_id: Number(compraId),
            fornecedor,
            chave_nfe_original: chave,
            refNFe: chave,
            cfop: String($('#nfeDevCfopPadrao').val() || '').replace(/\D/g, '').slice(0, 4) || undefined,
            observacoes: String($('#nfeDevObservacoes').val() || '').trim() || undefined,
            itens
        }
    };
}

function aplicarRascunhoNfeDevolucaoCompra(rascunho) {
    if (!rascunho) return;
    if (rascunho.cfop) $('#nfeDevCfopPadrao').val(String(rascunho.cfop));
    if (rascunho.observacoes != null) $('#nfeDevObservacoes').val(String(rascunho.observacoes));
    const mapa = new Map(
        (rascunho.itens || []).map((i) => [Number(i.compra_item_id), i])
    );
    $('#modalNFeDevolucaoCompra .nfe-dev-qtd').each(function() {
        const itemId = Number($(this).data('compra-item-id'));
        const salvo = mapa.get(itemId);
        $(this).val(salvo ? Number(salvo.quantidade || 0) : 0);
    });
    atualizarDescricaoCfopNfeDevolucao();
}

function oferecerRetomarRascunhoDevolucaoCompra(compraId, rascunho) {
    if (!rascunho || rascunho.status !== 'RASCUNHO') return;
    const quando = rascunho.updated_at || rascunho.created_at || '';
    const qtdItens = (rascunho.itens || []).length;
    const msg = `Existe um rascunho salvo${quando ? ` em ${quando}` : ''} com ${qtdItens} produto(s).\n\nDeseja continuar de onde parou?`;
    if (confirm(msg)) {
        aplicarRascunhoNfeDevolucaoCompra(rascunho);
        showNotification('Rascunho carregado. Revise as quantidades antes de emitir.', 'info');
        return;
    }
    if (confirm('Descartar o rascunho salvo e começar do zero?')) {
        $.ajax({
            url: `${API_URL}/compras/${compraId}/nfe-devolucao/rascunho`,
            method: 'DELETE'
        }).done(function() {
            showNotification('Rascunho descartado.', 'info');
        });
    }
}

function salvarRascunhoDevolucaoCompra(compraId) {
    const { excedeu, payload } = coletarPayloadRascunhoDevolucaoCompra(compraId);
    if (excedeu) return;
    if (!payload.itens.length) {
        showNotification('Informe a quantidade a devolver de pelo menos um produto para salvar o rascunho.', 'warning');
        return;
    }

    const $btn = $('#btnSalvarRascunhoNfeDev');
    $btn.prop('disabled', true).text('Salvando…');

    $.ajax({
        url: `${API_URL}/compras/${compraId}/nfe-devolucao/rascunho`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(payload)
    }).done(function(resp) {
        showNotification(resp.message || 'Rascunho salvo. Você pode continuar depois.', 'success');
        $('#modalNFeDevolucaoCompra').modal('hide');
    }).fail(function(xhr) {
        showNotification(xhr.responseJSON?.error || 'Erro ao salvar rascunho.', 'danger');
    }).always(function() {
        $btn.prop('disabled', false).text('Salvar e Continuar Depois');
    });
}

function abrirModalNFeDevolucaoCompra(id) {
    $.ajax({
        url: `${API_URL}/compras/${id}/nfe-devolucao/preparar`,
        method: 'GET'
    }).done(function(prep) {
        if (!prep || prep.success === false) {
            showNotification(prep?.error || 'Não foi possível preparar a NF-e de devolução.', 'warning');
            return;
        }

        const compra = prep.compra || {};
        const itens = prep.itens || [];
        const itensPainel = prep.itensPainel || [];
        const chave = String(prep.refNFe || compra.chave_acesso || '').replace(/\D/g, '');
        const bloqueado = !prep.podeEmitir;
        const ctrl = prep.controleSaldo || {};
        const statusCompraUi = ctrl.statusCompraUi || {};

        const badgeSaldo = (st) => {
            const ui = st || {};
            if (ui.cor === 'verde') return `<span class="badge bg-success">${ui.emoji || ''} ${escapeHtml(ui.label || 'Não devolvido')}</span>`;
            if (ui.cor === 'amarelo') return `<span class="badge bg-warning text-dark">${ui.emoji || ''} ${escapeHtml(ui.label || 'Parcial')}</span>`;
            if (ui.cor === 'azul') return `<span class="badge bg-primary">${ui.emoji || ''} ${escapeHtml(ui.label || 'Total')}</span>`;
            if (ui.cor === 'vermelho') return `<span class="badge bg-danger">${ui.emoji || ''} ${escapeHtml(ui.label || 'Saldo insuficiente')}</span>`;
            return `<span class="badge bg-secondary">${escapeHtml(ui.label || '-')}</span>`;
        };

        // Tabela única: itens emitíveis + itens sem saldo (somente leitura), sem duplicar.
        const mapaEmitiveis = new Map(
            (itens || []).map((it) => [Number(it.compra_item_id), it])
        );
        const basePainel = (itensPainel && itensPainel.length) ? itensPainel : (itens || []);
        const idsPainel = new Set(basePainel.map((it) => Number(it.compra_item_id)));
        const produtosTabela = [
            ...basePainel.map((p) => {
                const emitivel = mapaEmitiveis.get(Number(p.compra_item_id));
                return emitivel ? { ...p, ...emitivel } : p;
            }),
            ...itens.filter((it) => !idsPainel.has(Number(it.compra_item_id)))
        ];

        const linhas = produtosTabela.map((item, idx) => {
            const disponivel = Number(
                item.saldo != null
                    ? item.saldo
                    : (item.quantidade_maxima != null ? item.quantidade_maxima : 0)
            );
            const semSaldo = !(disponivel > 0);
            const inputDesabilitado = bloqueado || semSaldo;
            const nomeProduto = item.produto_nome || '-';
            const codigoProduto = item.produto_codigo || '';
            return `
            <tr class="nfe-dev-produto-row" data-idx="${idx}"
                data-produto-nome="${escapeHtml(nomeProduto)}"
                data-produto-codigo="${escapeHtml(codigoProduto)}">
                <td>
                    <strong>${escapeHtml(nomeProduto)}</strong>
                    ${codigoProduto ? `<br><small class="text-muted">Cód: ${escapeHtml(codigoProduto)}</small>` : ''}
                </td>
                <td class="text-end">${Number(item.quantidade_comprada != null ? item.quantidade_comprada : 0)}</td>
                <td class="text-end">${Number(item.quantidade_devolvida || 0)}</td>
                <td class="text-end fw-semibold text-primary">${disponivel}</td>
                <td>
                    <input type="number" min="0" step="0.001"
                        class="form-control form-control-sm nfe-dev-qtd"
                        data-compra-item-id="${item.compra_item_id}"
                        data-produto-id="${item.produto_id || ''}"
                        data-valor-unitario="${Number(item.valor_unitario || 0)}"
                        data-max="${disponivel}"
                        value="0"
                        ${inputDesabilitado ? 'disabled' : ''}
                    >
                </td>
            </tr>`;
        }).join('');

        const tribOrig = prep.tributacaoOriginal || {};
        const painelTribHtml = Object.keys(tribOrig).length
            ? Object.entries(tribOrig).map(([nome, info]) => `
                <div class="d-flex justify-content-between border-bottom py-1 small">
                    <span>${info.presente ? '✔' : '○'} <strong>${escapeHtml(nome)}</strong></span>
                    <span class="${info.presente ? 'text-success' : 'text-muted'}">${escapeHtml(info.texto || '')}</span>
                </div>
              `).join('')
            : '<div class="text-muted small">Tributação original indisponível (XML não carregado).</div>';

        const badgeCmp = (linha) => {
            if (linha.cor === 'verde') return '<span class="badge bg-success">Igual</span>';
            if (linha.cor === 'amarelo') return '<span class="badge bg-warning text-dark">Adaptado</span>';
            return '<span class="badge bg-danger">Divergente</span>';
        };
        const comparacaoHtml = (prep.comparacaoFiscal || []).length
            ? (prep.comparacaoFiscal || []).map((cmp) => `
                <div class="mb-3">
                    <div class="fw-semibold mb-1">${escapeHtml(cmp.produto || `Item ${cmp.nItemOrigem || ''}`)}
                        <small class="text-muted">(fator ${cmp.fator != null ? cmp.fator : 1})</small>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-sm table-bordered mb-0">
                            <thead><tr><th>Campo</th><th>NF Original</th><th>NF Devolução</th><th>Status</th></tr></thead>
                            <tbody>
                                ${(cmp.linhas || []).map((l) => `
                                    <tr>
                                        <td>${escapeHtml(l.campo)}</td>
                                        <td>${escapeHtml(l.original != null && l.original !== '' ? String(l.original) : '—')}</td>
                                        <td>${escapeHtml(l.devolucao != null && l.devolucao !== '' ? String(l.devolucao) : '—')}</td>
                                        <td>${badgeCmp(l)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
              `).join('')
            : '<div class="alert alert-secondary mb-0">Comparação fiscal será exibida após carregar o XML da NF-e original.</div>';

        const historicoDev = (prep.nfeDevolucoes || []).length
            ? `
            <div class="border rounded p-3 mt-3 bg-light">
                <h6 class="mb-2">Histórico — NF-e de Devolução (vínculo com a compra)</h6>
                <div class="small mb-2"><strong>NF-e Original:</strong> ${escapeHtml(chave || '-')}</div>
                <ol class="mb-0 ps-3">
                    ${(prep.nfeDevolucoes || []).map((n) => {
                        const ui = n.statusUi || {};
                        const emoji = ui.emoji || '⚪';
                        const label = ui.label || n.status || '-';
                        const acoes = n.acoes || {};
                        return `
                        <li class="mb-3">
                            <div>
                                <strong>NF-e ${escapeHtml(String(n.numero || n.id))}/${escapeHtml(String(n.serie || '-'))}</strong>
                                — ${emoji} ${escapeHtml(label)}
                                ${n.quantidade_total != null ? ` · qtd ${Number(n.quantidade_total)}` : ''}
                            </div>
                            <pre class="border rounded p-2 bg-dark text-light small mt-2 mb-2" style="font-family: Consolas, monospace; white-space: pre-wrap;">═══════════════════════════════
STATUS DA NF-e

${emoji} ${escapeHtml(label)}

Número: ${escapeHtml(String(n.numero || '-'))}
Série: ${escapeHtml(String(n.serie || '-'))}
Recibo: ${escapeHtml(n.recibo || '-')}
Protocolo: ${escapeHtml(n.protocolo || '-')}
Última consulta: ${escapeHtml(n.consultado_em || n.sincronizado_em || '-')}
═══════════════════════════════</pre>
                            ${n.rejeicao ? `<div class="alert alert-danger py-2 small mb-2" style="white-space:pre-wrap">${escapeHtml(n.rejeicao)}</div>` : ''}
                            ${acoes.gerarNovaIdentidade && acoes.mensagemNovaIdentidade ? `<div class="alert alert-warning py-2 small mb-2" style="white-space:pre-wrap">${escapeHtml(acoes.mensagemNovaIdentidade)}</div>` : ''}
                            <div class="text-muted small" style="word-break:break-all">Chave: ${escapeHtml(n.chave_acesso || '-')}</div>
                            <div class="d-flex flex-wrap gap-2 mt-2">
                                ${/autorizad/i.test(String(n.status || '')) ? `
                                <button type="button" class="btn btn-sm btn-outline-secondary" onclick="abrirDanfe({tipo:'DEVOLUCAO_COMPRA',id:${n.id},chave:'${escapeHtml(n.chave_acesso || '')}',numero:'${escapeHtml(String(n.numero || ''))}',serie:'${escapeHtml(String(n.serie || ''))}'})">👁 DANFE</button>
                                <button type="button" class="btn btn-sm btn-outline-primary" onclick="abrirDanfe({tipo:'DEVOLUCAO_COMPRA',id:${n.id},imprimir:true})">🖨 Reimprimir</button>
                                <button type="button" class="btn btn-sm btn-outline-primary" onclick="baixarDanfePdf({tipo:'DEVOLUCAO_COMPRA',id:${n.id},chave:'${escapeHtml(n.chave_acesso || '')}'})">📄 PDF</button>
                                <button type="button" class="btn btn-sm btn-outline-dark" onclick="baixarXmlNfe55({tipo:'DEVOLUCAO_COMPRA',id:${n.id},chave:'${escapeHtml(n.chave_acesso || '')}'})">&lt;/&gt; XML</button>
                                ` : ''}
                                ${!/autorizad/i.test(String(n.status || '')) && (acoes.downloadXml || n.tem_xml) ? `<a class="btn btn-sm btn-outline-secondary" target="_blank" href="${API_URL}/compras/nfe-devolucao/${n.id}/xml?tipo=assinado">XML assinado</a>` : ''}
                                ${n.tem_danfe_cancelado ? `<a class="btn btn-sm btn-outline-secondary" target="_blank" href="${API_URL}/compras/nfe-devolucao/${n.id}/danfe?tipo=cancelado">DANFE cancelado</a>` : ''}
                                ${acoes.consultar !== false && n.chave_acesso ? `<button type="button" class="btn btn-sm btn-outline-info" onclick="consultarSituacaoNfeDevolucao(${n.id}, ${compra.id || id})">Consultar Situação</button>` : ''}
                                ${acoes.reenviar ? `<button type="button" class="btn btn-sm btn-outline-warning" onclick="reenviarNfeDevolucaoCompra(${n.id}, ${compra.id || id})">Reenviar</button>` : ''}
                                ${acoes.gerarNovaIdentidade ? `<button type="button" class="btn btn-sm btn-danger" onclick="gerarNovaNfeDevolucaoCompra(${compra.id || id}, ${n.id})">Gerar nova NF-e</button>` : ''}
                                ${acoes.cancelar ? `<button type="button" class="btn btn-sm btn-outline-danger" onclick="cancelarNfeDevolucaoCompra(${n.id}, ${compra.id || id})">Cancelar (SEFAZ)</button>` : ''}
                                <button type="button" class="btn btn-sm btn-outline-dark" onclick="abrirTimelineNfeDevolucao(${n.id})">Histórico / Timeline</button>
                            </div>
                            <div id="nfeDevTimeline-${n.id}" class="mt-2 small" style="display:none"></div>
                        </li>`;
                    }).join('')}
                </ol>
            </div>`
            : '<div class="text-muted small mt-3" id="nfeDevHistoricoVazio">Nenhuma NF-e de devolução emitida ainda.</div>';

        const modalHtml = `
            <div class="modal fade" id="modalNFeDevolucaoCompra" tabindex="-1" data-modo="EDICAO">
                <div class="modal-dialog modal-xl modal-dialog-scrollable">
                    <div class="modal-content">
                        <style>
                            #modalNFeDevolucaoCompra[data-modo="EDICAO"] #nfeDevPainelPrevia,
                            #modalNFeDevolucaoCompra[data-modo="EDICAO"] [data-etapa="PREVIA"] {
                                display: none !important;
                            }
                            #modalNFeDevolucaoCompra[data-modo="PREVIA"] #nfeDevPainelFormulario,
                            #modalNFeDevolucaoCompra[data-modo="PREVIA"] [data-etapa="EDICAO"] {
                                display: none !important;
                            }
                        </style>
                        <div class="modal-header bg-danger text-white">
                            <h5 class="modal-title" id="nfeDevModalTitulo">
                                <i class="fas fa-file-invoice"></i> Central NF-e — Modo DEVOLUÇÃO
                            </h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div id="nfeDevPainelFormulario">
                            <pre class="border rounded p-3 bg-dark text-warning text-center mb-3" style="font-family: Consolas, monospace; white-space: pre-wrap;">═══════════════════════════════
        NF-e DE DEVOLUÇÃO

Compra nº: ${compra.id || id}
Fornecedor: ${escapeHtml(compra.fornecedor || '-')}
Referenciando NF-e: ${escapeHtml(chave || '-')}
═══════════════════════════════</pre>

                            ${prep.motivoBloqueio ? `<div class="alert alert-warning">${escapeHtml(prep.motivoBloqueio)}</div>` : ''}
                            ${prep.rascunho ? `<div class="alert alert-info py-2 small mb-3" id="nfeDevRascunhoAlert">
                                <i class="fas fa-save me-1"></i>
                                Rascunho salvo${prep.rascunho.updated_at ? ` em ${escapeHtml(String(prep.rascunho.updated_at))}` : ''}.
                                Ao abrir, você pode continuar de onde parou.
                            </div>` : ''}
                            ${prep.fonteXmlOrigem ? `<div class="alert alert-success py-2 small">XML original carregado (${escapeHtml(prep.fonteXmlOrigem)}). Tributação espelhada item a item.</div>` : ''}

                            <ul class="nav nav-tabs mb-3" role="tablist">
                                <li class="nav-item"><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#nfeDevTabEmissao" type="button">Emissão</button></li>
                                <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#nfeDevTabComparacao" type="button">Comparação Fiscal</button></li>
                                <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#nfeDevTabCiclo" type="button">Ciclo de Vida</button></li>
                            </ul>

                            <div class="tab-content">
                              <div class="tab-pane fade show active" id="nfeDevTabEmissao">
                                <div class="row mb-3">
                                    <div class="col-md-4">
                                        <label class="form-label">Emitente</label>
                                        <input class="form-control" value="Empresa (bloqueado)" disabled>
                                    </div>
                                    <div class="col-md-4">
                                        <label class="form-label">Destinatário (fornecedor)</label>
                                        <input type="hidden" id="nfeDevFornecedorNome" value="${escapeHtml(compra.fornecedor || '')}">
                                        <input class="form-control" value="${escapeHtml(compra.fornecedor || '')}" disabled>
                                    </div>
                                    <div class="col-md-4">
                                        <label class="form-label">Chave referenciada (NF original)</label>
                                        <input type="text" id="chaveNFeFornecedorDevolucao" class="form-control"
                                            maxlength="44" value="${escapeHtml(chave)}" disabled>
                                    </div>
                                </div>

                                <div class="border rounded p-3 mb-3">
                                    <h6 class="mb-2">Tributação Original</h6>
                                    ${painelTribHtml}
                                </div>

                                <div class="row mb-3">
                                    <div class="col-md-3">
                                        <label class="form-label">CFOP padrão</label>
                                        <input type="text" id="nfeDevCfopPadrao" class="form-control"
                                            maxlength="4" value="${escapeHtml(prep.cfopSugerido || '5202')}"
                                            ${bloqueado ? 'disabled' : ''}>
                                        <div id="nfeDevCfopDescricao" class="form-text text-muted mt-1">
                                            ${escapeHtml(obterDescricaoCfopDevolucao(prep.cfopSugerido || '5202'))}
                                        </div>
                                    </div>
                                    <div class="col-md-9">
                                        <label class="form-label">Observações</label>
                                        <input type="text" id="nfeDevObservacoes" class="form-control"
                                            maxlength="500"
                                            placeholder="Opcional — complementar à referência da NF original"
                                            ${bloqueado ? 'disabled' : ''}>
                                    </div>
                                </div>

                                <div class="d-flex flex-wrap justify-content-between align-items-center mb-2 gap-2">
                                    <h6 class="mb-0">Produtos para Devolução</h6>
                                    ${badgeSaldo(statusCompraUi)}
                                </div>
                                <p class="small text-muted mb-2">
                                    Informe a quantidade que deseja devolver de cada produto. Deixe 0 nos produtos que não serão devolvidos.
                                </p>
                                <div class="mb-2">
                                    <div class="input-group">
                                        <span class="input-group-text"><i class="fas fa-search"></i></span>
                                        <input type="search" id="nfeDevBuscaProduto" class="form-control"
                                            placeholder="Buscar produto por nome ou código"
                                            autocomplete="off">
                                    </div>
                                </div>
                                <div class="table-responsive">
                                    <table id="nfeDevProdutosTabela" class="table table-sm table-bordered align-middle">
                                        <thead>
                                            <tr>
                                                <th>Produto</th>
                                                <th class="text-end">Qtd. Comprada</th>
                                                <th class="text-end">Já Devolvido</th>
                                                <th class="text-end">Disponível para Devolver</th>
                                                <th>Quantidade a Devolver</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${linhas || '<tr><td colspan="5" class="text-center text-danger">Nenhum produto disponível para devolução.</td></tr>'}
                                        </tbody>
                                    </table>
                                    <div id="nfeDevBuscaVazio" class="text-center text-muted small py-2" style="display:none;">
                                        Nenhum produto encontrado para a busca.
                                    </div>
                                </div>

                                ${historicoDev}
                              </div>
                              <div class="tab-pane fade" id="nfeDevTabComparacao">
                                <p class="small text-muted">NF Original → NF Devolução (CST, CSOSN, CFOP, ICMS, IPI, PIS, COFINS, ST, FCP, DIFAL)</p>
                                ${comparacaoHtml}
                              </div>
                              <div class="tab-pane fade" id="nfeDevTabCiclo">
                                <p class="small text-muted mb-2">Linha do tempo: XML → Assinatura → Validação → Envio → Autorização → Cancelamento</p>
                                ${historicoDev}
                              </div>
                            </div>
                            </div>
                            <div id="nfeDevPainelPrevia" class="d-none"></div>
                        </div>
                        <div class="modal-footer" id="nfeDevFooter">
                            <button type="button" class="btn btn-outline-secondary" data-etapa="EDICAO" data-bs-dismiss="modal">Cancelar</button>
                            <button type="button" class="btn btn-primary" data-etapa="EDICAO"
                                id="btnSalvarRascunhoNfeDev"
                                onclick="salvarRascunhoDevolucaoCompra(${compra.id || id})"
                                ${bloqueado ? 'disabled' : ''}>
                                Salvar e Continuar Depois
                            </button>
                            <button type="button" class="btn btn-danger" data-etapa="EDICAO"
                                id="btnEmitirNfeDevolucao"
                                onclick="abrirPreviaNfeDevolucaoCompra(${compra.id || id})"
                                ${bloqueado || !itens.length ? 'disabled' : ''}>
                                Emitir NF-e de Devolução
                            </button>
                            <button type="button" class="btn btn-outline-secondary d-none" data-etapa="PREVIA" id="btnVoltarEditarNfeDev"
                                onclick="voltarEditarPreviaNfeDevolucaoCompra()">
                                ← Voltar e Editar
                            </button>
                            <button type="button" class="btn btn-danger d-none" data-etapa="PREVIA" id="btnConfirmarEmitirNfeDev"
                                onclick="confirmarEmissaoNFeDevolucaoCompra(${compra.id || id})">
                                Confirmar e Emitir NF-e
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        $('#modalNFeDevolucaoCompra').remove();
        $('body').append(modalHtml);
        $('#modalNFeDevolucaoCompra').modal('show');
        aplicarModoNfeDevolucao('EDICAO');
        $('#modalNFeDevolucaoCompra').on('hidden.bs.modal', function () {
            $('#modalNFeDevolucaoCompra').remove();
        });

        $('#nfeDevCfopPadrao')
            .off('input.nfeDevCfop change.nfeDevCfop')
            .on('input.nfeDevCfop change.nfeDevCfop', atualizarDescricaoCfopNfeDevolucao);
        atualizarDescricaoCfopNfeDevolucao();

        $('#nfeDevBuscaProduto')
            .off('input.nfeDevBusca')
            .on('input.nfeDevBusca', filtrarProdutosNfeDevolucaoCompra);

        if (prep.rascunho && prep.rascunho.status === 'RASCUNHO') {
            window.__nfeDevRascunhoAtual = prep.rascunho;
            oferecerRetomarRascunhoDevolucaoCompra(compra.id || id, prep.rascunho);
        }

        if (bloqueado) {
            $('#btnEmitirNfeDevolucao').prop('disabled', true);
        }
    }).fail(function(xhr) {
        const msg = xhr.responseJSON?.error || 'Erro ao carregar pré-preenchimento da devolução.';
        showNotification(msg, 'danger');
    });
}

function cancelarNfeDevolucaoCompra(notaId, compraId) {
    const motivo = prompt('Motivo do cancelamento da NF-e de devolução (mín. 15 caracteres):');
    if (motivo == null) return;
    if (String(motivo).trim().length < 15) {
        showNotification('Informe um motivo com pelo menos 15 caracteres.', 'warning');
        return;
    }
    if (!confirm('Enviar evento oficial de cancelamento à SEFAZ e reabrir o saldo?')) return;

    $.ajax({
        url: `${API_URL}/compras/nfe-devolucao/${notaId}/cancelar`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ motivo: String(motivo).trim() })
    }).done(function(resp) {
        if (resp.success === false) {
            showNotification(resp.message || resp.error || 'Cancelamento rejeitado pela SEFAZ.', 'danger');
        } else {
            showNotification(resp.message || 'NF-e cancelada na SEFAZ. Saldo reaberto.', 'success');
        }
        $('#modalNFeDevolucaoCompra').modal('hide');
        abrirModalNFeDevolucaoCompra(compraId);
        if (typeof loadCompras === 'function') loadCompras();
    }).fail(function(xhr) {
        const body = xhr.responseJSON || {};
        showNotification(body.message || body.error || 'Erro ao cancelar devolução.', 'danger');
    });
}

function consultarSituacaoNfeDevolucao(notaId, compraId) {
    $.ajax({
        url: `${API_URL}/compras/nfe-devolucao/${notaId}/consultar`,
        method: 'POST',
        contentType: 'application/json',
        data: '{}'
    }).done(function(resp) {
        const msg = resp.mensagem || resp.xMotivo || `Status: ${resp.status}`;
        showNotification(msg, resp.status === 'autorizada' ? 'success' : 'info');
        if (compraId) {
            $('#modalNFeDevolucaoCompra').modal('hide');
            abrirModalNFeDevolucaoCompra(compraId);
        }
    }).fail(function(xhr) {
        showNotification(xhr.responseJSON?.error || 'Erro na consulta SEFAZ.', 'danger');
    });
}

function gerarNovaNfeDevolucaoCompra(compraId) {
    const rascunho = window.__nfeDevRascunhoAtual;
    if (rascunho) aplicarRascunhoNfeDevolucaoCompra(rascunho);
    showNotification('Dados da devolução preservados. A nova NF-e usará nova numeração fiscal.', 'info');
    abrirPreviaNfeDevolucaoCompra(compraId);
}

function reenviarNfeDevolucaoCompra(notaId, compraId) {
    if (!confirm('Reenviar o XML assinado à SEFAZ? (somente se rejeitada / erro de comunicação)')) return;
    $.ajax({
        url: `${API_URL}/compras/nfe-devolucao/${notaId}/reenviar`,
        method: 'POST',
        contentType: 'application/json',
        data: '{}'
    }).done(function(resp) {
        showNotification(resp.message || `Status: ${resp.status}`, resp.success ? 'success' : 'warning');
        $('#modalNFeDevolucaoCompra').modal('hide');
        abrirModalNFeDevolucaoCompra(compraId);
    }).fail(function(xhr) {
        showNotification(xhr.responseJSON?.error || 'Reenvio bloqueado ou falhou.', 'danger');
    });
}

function abrirTimelineNfeDevolucao(notaId) {
    const $box = $(`#nfeDevTimeline-${notaId}`);
    if (!$box.length) return;
    if ($box.is(':visible') && $box.data('loaded')) {
        $box.hide();
        return;
    }
    $.ajax({
        url: `${API_URL}/compras/nfe-devolucao/${notaId}/eventos`,
        method: 'GET'
    }).done(function(resp) {
        const eventos = resp.eventos || [];
        if (!eventos.length) {
            $box.html('<div class="text-muted">Nenhum evento registrado ainda.</div>').show().data('loaded', true);
            return;
        }
        const html = `<div class="border rounded p-2 bg-white"><strong>Linha do tempo</strong><ul class="mb-0 mt-2 ps-3">${
            eventos.map((e) => `
                <li class="mb-1">
                    <span class="text-muted">${escapeHtml(e.hora || String(e.createdAt || '').slice(11, 16) || '-')}</span>
                    — <strong>${escapeHtml(e.mensagem || e.evento || '-')}</strong>
                    ${e.cStat ? ` <span class="badge bg-secondary">${escapeHtml(String(e.cStat))}</span>` : ''}
                </li>
            `).join('')
        }</ul></div>`;
        $box.html(html).show().data('loaded', true);
    }).fail(function() {
        showNotification('Erro ao carregar histórico de eventos.', 'danger');
    });
}

function salvarChaveNFeFornecedor(id) {
    const chave = String($('#chaveNFeFornecedorDevolucao').val() || '').replace(/\D/g, '');

    if (chave.length !== 44) {
        showNotification('A chave da NF-e precisa ter 44 dígitos.', 'warning');
        return;
    }

    $.ajax({
        url: `${API_URL}/compras/${id}/chave-nfe-fornecedor`,
        method: 'PUT',
        contentType: 'application/json',
        data: JSON.stringify({ chave })
    }).done(function(resp) {
        showNotification(resp.message || 'Chave salva com sucesso.', 'success');
    }).fail(function(xhr) {
        showNotification(xhr.responseJSON?.error || 'Erro ao salvar chave.', 'danger');
    });
}

function renderizarBannerAuditoriaPreviaNfe(auditoria) {
    if (!auditoria) return '';
    const resumo = auditoria.resumo || {};
    const itens = resumo.itensAuditados != null ? resumo.itensAuditados : resumo.totalItens;
    if (auditoria.aprovado) {
        return `<div class="alert alert-success py-2 mb-3">
            <strong>AUDITORIA FISCAL APROVADA</strong>
            <div class="small mb-0">Itens auditados: ${itens || 0} · Erros: 0 · Avisos: ${resumo.avisos || 0}</div>
        </div>`;
    }
    const erros = (auditoria.erros || []).map((e) =>
        `<li><code>${escapeHtml(e.codigo || '')}</code> ${escapeHtml(e.mensagem || '')}</li>`
    ).join('');
    return `<div class="alert alert-danger py-2 mb-3">
        <strong>AUDITORIA FISCAL REPROVADA</strong>
        <div class="small">A NF-e não será assinada nem transmitida até corrigir:</div>
        <ul class="small mb-0 mt-1">${erros}</ul>
    </div>`;
}

function formatarMoedaNfeDev(valor) {
    const n = Number(valor || 0);
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarQtdNfeDev(valor) {
    const n = Number(valor || 0);
    if (Number.isInteger(n)) return String(n);
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function linhaTotalPreviaNfeDev(label, valor, opcoes = {}) {
    const n = Number(valor || 0);
    if (opcoes.ocultarSeZero && !(n > 0)) return '';
    return `<div class="d-flex justify-content-between py-1 ${opcoes.classe || ''}">
        <span>${escapeHtml(label)}</span>
        <span>${formatarMoedaNfeDev(n)}</span>
    </div>`;
}

function renderizarHtmlPreviaNfeDevolucao(previa) {
    const tot = previa.totais || {};
    const trib = previa.tributos || {};
    const itens = previa.itens || [];
    const linhasItens = itens.map((it) => `
        <tr>
            <td>${escapeHtml(String(it.codigo || '—'))}</td>
            <td>${escapeHtml(String(it.produto || '—'))}</td>
            <td>${escapeHtml(String(it.unidade || 'UN'))}</td>
            <td class="text-end">${formatarQtdNfeDev(it.quantidade)}</td>
            <td class="text-end">${formatarMoedaNfeDev(it.valor_unitario)}</td>
            <td class="text-end">${formatarMoedaNfeDev(it.desconto)}</td>
            <td class="text-end fw-semibold">${formatarMoedaNfeDev(it.total)}</td>
        </tr>
    `).join('');

    const tribLinhas = [
        Number(trib.vICMS) > 0 ? linhaTotalPreviaNfeDev('ICMS', trib.vICMS) : '',
        Number(trib.vST) > 0 ? linhaTotalPreviaNfeDev('ICMS ST', trib.vST) : '',
        Number(trib.vIPI) > 0 ? linhaTotalPreviaNfeDev('IPI', trib.vIPI) : '',
        Number(trib.vIPIDevol) > 0 ? linhaTotalPreviaNfeDev('IPI Devolvido', trib.vIPIDevol) : '',
        Number(trib.vPIS) > 0 ? linhaTotalPreviaNfeDev('PIS (informativo)', trib.vPIS) : '',
        Number(trib.vCOFINS) > 0 ? linhaTotalPreviaNfeDev('COFINS (informativo)', trib.vCOFINS) : ''
    ].filter(Boolean).join('');

    return `
        <h5 class="mb-3"><i class="fas fa-eye me-1"></i> Prévia da NF-e de Devolução</h5>
        <p class="small text-muted">Revise os dados abaixo. Nada será enviado à SEFAZ até você confirmar a emissão.</p>
        ${renderizarBannerAuditoriaPreviaNfe(previa.auditoria)}

        <div class="border rounded p-3 mb-3">
            <h6 class="mb-2">Dados da nova NF-e</h6>
            <div class="row small g-2">
                <div class="col-md-4"><strong>Modelo:</strong> ${escapeHtml(String(previa.modelo || '55'))}</div>
                <div class="col-md-4"><strong>Série:</strong> ${escapeHtml(String(previa.serie != null ? previa.serie : '—'))}</div>
                <div class="col-md-4"><strong>Número:</strong> ${escapeHtml(String(previa.numero != null ? previa.numero : '—'))}</div>
                <div class="col-12"><span class="badge bg-success">${escapeHtml(previa.statusPrevia || 'Pronta para emissão')}</span></div>
            </div>
        </div>

        <div class="border rounded p-3 mb-3">
            <h6 class="mb-2">Dados da Nota</h6>
            <div class="row small g-2">
                <div class="col-md-6"><strong>Natureza da operação:</strong> ${escapeHtml(previa.natureza || 'DEVOLUCAO DE COMPRA')}</div>
                <div class="col-md-6"><strong>CFOP:</strong> ${escapeHtml(previa.cfopDescricao || previa.cfop || '—')}</div>
                <div class="col-12"><strong>Chave da NF-e original:</strong> <span style="word-break:break-all">${escapeHtml(previa.chaveOriginal || '—')}</span></div>
                <div class="col-md-6"><strong>Fornecedor/Destinatário:</strong> ${escapeHtml((previa.destinatario && previa.destinatario.nome) || previa.fornecedor || '—')}</div>
                <div class="col-md-6"><strong>CNPJ:</strong> ${escapeHtml((previa.destinatario && previa.destinatario.cnpj) || previa.cnpj || '—')}</div>
                <div class="col-md-6"><strong>IE:</strong> ${escapeHtml((previa.destinatario && previa.destinatario.ie) || '—')}</div>
                <div class="col-md-6"><strong>Município / UF:</strong> ${escapeHtml((previa.destinatario && previa.destinatario.municipio) || '—')} / ${escapeHtml((previa.destinatario && previa.destinatario.uf) || '—')}</div>
                <div class="col-md-6"><strong>Código IBGE:</strong> ${escapeHtml((previa.destinatario && previa.destinatario.cMun) || '—')}</div>
                <div class="col-12"><strong>Endereço:</strong> ${escapeHtml([previa.destinatario && previa.destinatario.logradouro, previa.destinatario && previa.destinatario.numero, previa.destinatario && previa.destinatario.bairro].filter(Boolean).join(', ') || '—')}</div>
                <div class="col-12"><strong>Observações:</strong> ${escapeHtml(previa.observacoes || '—')}</div>
            </div>
        </div>

        <div class="border rounded p-3 mb-3">
            <h6 class="mb-2">Itens da Devolução</h6>
            <div class="table-responsive">
                <table class="table table-sm table-bordered align-middle mb-0">
                    <thead>
                        <tr>
                            <th>Código</th>
                            <th>Produto</th>
                            <th>Unidade</th>
                            <th class="text-end">Quantidade</th>
                            <th class="text-end">Valor Unitário</th>
                            <th class="text-end">Desconto</th>
                            <th class="text-end">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${linhasItens || '<tr><td colspan="7" class="text-center text-muted">Nenhum item com quantidade &gt; 0.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="row">
            <div class="col-md-6 mb-3">
                <div class="border rounded p-3 h-100">
                    <h6 class="mb-2">Totais</h6>
                    ${linhaTotalPreviaNfeDev('Valor dos Produtos', tot.vProd)}
                    ${linhaTotalPreviaNfeDev('Desconto', tot.vDesc)}
                    ${linhaTotalPreviaNfeDev('Frete', tot.vFrete)}
                    ${linhaTotalPreviaNfeDev('Seguro', tot.vSeg)}
                    ${linhaTotalPreviaNfeDev('Outras Despesas', tot.vOutro)}
                    ${linhaTotalPreviaNfeDev('IPI', tot.vIPI)}
                    ${linhaTotalPreviaNfeDev('IPI Devolvido', tot.vIPIDevol)}
                    ${linhaTotalPreviaNfeDev('ICMS ST', tot.vST, { ocultarSeZero: true })}
                    ${linhaTotalPreviaNfeDev('FCP ST', tot.vFCPST, { ocultarSeZero: true })}
                    <div class="d-flex justify-content-between pt-3 mt-2 border-top align-items-end">
                        <span class="fw-bold">VALOR TOTAL DA NF-e</span>
                        <span class="fs-4 fw-bold text-danger">${formatarMoedaNfeDev(tot.vNF)}</span>
                    </div>
                    <div class="small text-muted mt-2">PIS e COFINS não entram no valor total (vNF).</div>
                </div>
            </div>
            <div class="col-md-6 mb-3">
                <div class="border rounded p-3 h-100">
                    <h6 class="mb-2">Tributos</h6>
                    ${tribLinhas || '<div class="text-muted small">Nenhum tributo destacado nesta devolução.</div>'}
                </div>
            </div>
        </div>
    `;
}

function aplicarModoNfeDevolucao(modo) {
    const m = modo === 'PREVIA' ? 'PREVIA' : 'EDICAO';
    const $modal = $('#modalNFeDevolucaoCompra');
    $modal.attr('data-modo', m);
    $('#nfeDevPainelFormulario').toggleClass('d-none', m === 'PREVIA');
    $('#nfeDevPainelPrevia').toggleClass('d-none', m !== 'PREVIA');
    $modal.find('[data-etapa="EDICAO"]').toggleClass('d-none', m === 'PREVIA');
    $modal.find('[data-etapa="PREVIA"]').toggleClass('d-none', m !== 'PREVIA');
    const $titulo = $('#nfeDevModalTitulo');
    if ($titulo.length) {
        $titulo.html(
            m === 'PREVIA'
                ? '<i class="fas fa-eye"></i> Prévia da NF-e — Devolução de Compra'
                : '<i class="fas fa-file-invoice"></i> Central NF-e — Modo DEVOLUÇÃO'
        );
    }
}

function mostrarPainelPreviaNfeDevolucao(visivel) {
    aplicarModoNfeDevolucao(visivel ? 'PREVIA' : 'EDICAO');
}

function voltarEditarPreviaNfeDevolucaoCompra() {
    mostrarPainelPreviaNfeDevolucao(false);
}

function abrirPreviaNfeDevolucaoCompra(id) {
    const chave = String($('#chaveNFeFornecedorDevolucao').val() || '').replace(/\D/g, '');
    if (chave.length !== 44) {
        showNotification('Compra sem chave da NF-e (44 dígitos).', 'warning');
        return;
    }

    const { itens, excedeu } = coletarItensFormularioNfeDevolucaoCompra();
    if (excedeu) return;
    if (!itens.length) {
        showNotification('Informe a quantidade a devolver de pelo menos um produto.', 'warning');
        return;
    }

    const payload = {
        tipoDocumento: 'DEVOLUCAO',
        finNFe: 4,
        origem: 'COMPRA',
        compraId: id,
        refNFe: chave,
        observacoes: String($('#nfeDevObservacoes').val() || '').trim() || undefined,
        cfop: String($('#nfeDevCfopPadrao').val() || '').replace(/\D/g, '').slice(0, 4) || undefined,
        itens
    };

    const $btn = $('#btnEmitirNfeDevolucao');
    $btn.prop('disabled', true).text('Gerando prévia…');

    $.ajax({
        url: `${API_URL}/compras/${id}/nfe-devolucao/previa`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(payload)
    }).done(function(previa) {
        if (!previa || previa.success === false) {
            showNotification(previa?.error || 'Não foi possível gerar a prévia.', 'warning');
            return;
        }
        if (previa.emitido || previa.transmitido) {
            showNotification('A prévia não deve emitir NF-e. Operação bloqueada.', 'danger');
            return;
        }
        $('#nfeDevPainelPrevia').html(renderizarHtmlPreviaNfeDevolucao(previa));
        mostrarPainelPreviaNfeDevolucao(true);
        const $body = $('#modalNFeDevolucaoCompra .modal-body');
        if ($body.length) $body.scrollTop(0);
    }).fail(function(xhr) {
        showNotification(xhr.responseJSON?.error || 'Erro ao gerar a prévia da NF-e.', 'danger');
    }).always(function() {
        $btn.prop('disabled', false).text('Emitir NF-e de Devolução');
    });
}

function confirmarEmissaoNFeDevolucaoCompra(id) {
    const chave = String($('#chaveNFeFornecedorDevolucao').val() || '').replace(/\D/g, '');

    if (chave.length !== 44) {
        showNotification('Compra sem chave da NF-e (44 dígitos).', 'warning');
        return;
    }

    const { itens, excedeu } = coletarItensFormularioNfeDevolucaoCompra();
    if (excedeu) return;

    if (!itens.length) {
        showNotification('Informe a quantidade a devolver de pelo menos um produto.', 'warning');
        return;
    }

    const payload = {
        tipoDocumento: 'DEVOLUCAO',
        finNFe: 4,
        origem: 'COMPRA',
        compraId: id,
        refNFe: chave,
        observacoes: String($('#nfeDevObservacoes').val() || '').trim() || undefined,
        cfop: String($('#nfeDevCfopPadrao').val() || '').replace(/\D/g, '').slice(0, 4) || undefined,
        itens
    };

    const $btn = $('#btnConfirmarEmitirNfeDev');
    $btn.prop('disabled', true).text('Transmitindo…');

    $.ajax({
        url: `${API_URL}/compras/${id}/emitir-nfe-devolucao`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(payload)
    }).done(function(resp) {
        const r = resp.resultado || resp;
        if (r.success === false && (r.code === 'AUDITORIA_FISCAL_REPROVADA' || r.auditoria)) {
            const aud = r.auditoria || {};
            const erros = (aud.erros || []).map((e) => `[${e.codigo}] ${e.mensagem}`).join('\n\n');
            alert(r.message || erros || 'Auditoria fiscal reprovada.');
            $btn.prop('disabled', false).text('Confirmar e Emitir NF-e');
            return;
        }
        if (String(r.cStat || r.cstat || '') === '539' || /EXIGE_NOVA_IDENTIDADE|539/.test(String(r.code || r.message || ''))) {
            alert(
                'Esta NF-e possui uma identidade fiscal que conflita com um documento já existente na SEFAZ.\n\n'
                + 'Os dados da devolução foram preservados.\n\n'
                + 'Para continuar, gere uma nova NF-e com nova numeração fiscal.'
            );
        }
        showNotification(resp.message || r.message || 'NF-e de devolução processada.', r.success === false ? 'warning' : 'success');

        if (r.success || r.status === 'autorizada') {
            $btn.prop('disabled', false).text('Confirmar e Emitir NF-e');
            $('#modalNFeDevolucaoCompra').modal('hide');
            loadCompras();
            if (typeof abrirDanfe === 'function' && (resp.notaId || r.notaId)) {
                abrirDanfe({
                    tipo: 'DEVOLUCAO_COMPRA',
                    id: resp.notaId || r.notaId,
                    chave: r.chaveAcesso || r.chave,
                    numero: r.numero,
                    serie: r.serie,
                    auto: true
                });
            }
            return;
        }

        abrirModalNFeDevolucaoCompra(id);
    }).fail(function(xhr) {
        const resposta = xhr.responseJSON || {};
        const motivo =
            resposta?.xMotivo ||
            resposta?.mensagem ||
            resposta?.error ||
            resposta?.resultado?.xMotivo ||
            resposta?.resultado?.message ||
            'Motivo não informado.';
        const cStat = resposta?.cStat || resposta?.resultado?.cStat || '';
        const status = resposta?.resultado?.status || '';

        let titulo = 'Falha na emissão da NF-e de devolução';
        if (status === 'erro_assinatura') titulo = 'Erro de assinatura digital';
        else if (status === 'erro_comunicacao') titulo = 'Erro de comunicação com a SEFAZ';
        else if (status === 'erro_validacao') titulo = 'XML inválido';
        else if (status === 'rejeitada' || cStat) titulo = 'Rejeição da SEFAZ';

        if (String(cStat) === '539') {
            alert(
                'Esta NF-e possui uma identidade fiscal que conflita com um documento já existente na SEFAZ.\n\n'
                + 'Os dados da devolução foram preservados.\n\n'
                + 'Para continuar, gere uma nova NF-e com nova numeração fiscal.\n\n'
                + `cStat: ${cStat}\nMotivo: ${motivo}`
            );
        } else {
            alert(`${titulo}.\n\ncStat: ${cStat || 'não informado'}\nMotivo: ${motivo}`);
        }
        $btn.prop('disabled', false).text('Confirmar e Emitir NF-e');
    });
}

