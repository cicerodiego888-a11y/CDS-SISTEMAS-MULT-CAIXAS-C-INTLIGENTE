/**
 * ProdutoApresentacaoResolver — serviço neutro de apresentação comercial na compra.
 * RC4.31.10 — única fonte de verdade; sem dependência de Compras ou ProdutoEmbalagensUI.
 * RC4.31.12.5 — Unidade Comercial como primeira opção em "Comprar em".
 * RC4.31.12.8 — Aprendizagem automática da UC na compra.
 * RC4.31.12.9 — Utilização Compras/Vendas na aprendizagem.
 */
(function (global) {
    'use strict';

    const TAG = '[ProdutoApresentacaoResolver]';
    const pilhaAtiva = new Set();
    const MAX_PROFUNDIDADE = 8;

    const TIPOS_EMBALAGEM_AGRUPADORA = Object.freeze([
        'CX', 'CAIXA', 'FD', 'FARDO', 'PCT', 'PACOTE', 'DISPLAY', 'KIT'
    ]);

    const OPCAO_NOVA_UC_ID = '__nova_uc__';

    const LABELS_UNIDADE_COMERCIAL = Object.freeze({
        UN: 'Unidade', PACOTE: 'Pacote', CAIXA: 'Caixa', FARDO: 'Fardo', SACO: 'Saco',
        ROLO: 'Rolo', BOBINA: 'Bobina', BALDE: 'Balde', GALAO: 'Galão', BARRA: 'Barra',
        VARA: 'Vara', TUBO: 'Tubo', PERFIL: 'Perfil', CHAPA: 'Chapa', M: 'Metro', MT: 'Metro'
    });

    function normalizarTipoApresentacao(valor) {
        return String(valor || 'UN').trim().toUpperCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, '');
    }

    function labelUnidadeComercial(tipo, descricao) {
        const d = String(descricao || '').trim();
        if (d) return d;
        const raw = normalizarTipoApresentacao(tipo);
        return LABELS_UNIDADE_COMERCIAL[raw] || raw;
    }

    function produtoCompraPorEmbalagemAtiva(produto) {
        return Number(produto?.compra_por_embalagem || 0) === 1;
    }

    function isTipoEmbalagemAgrupadora(tipo) {
        const t = normalizarTipoApresentacao(tipo);
        return TIPOS_EMBALAGEM_AGRUPADORA.includes(t);
    }

    function clonarOpcaoCompra(base, extras = {}) {
        return Object.assign({}, base, extras);
    }

    function embalagemAtivaCompra(e) {
        return Number(e?.ativa ?? 1) === 1 && Number(e?.compra ?? 1) === 1;
    }

    function legadoUsaEmbalagemComercial(produto) {
        if (!produto || !produtoCompraPorEmbalagemAtiva(produto)) return false;
        const qtd = Number(produto.quantidade_por_embalagem || 0);
        if (!(qtd > 0)) return false;
        const uc = String(produto.unidade_comercial || 'UN').toUpperCase();
        return uc !== 'UN';
    }

    function apresentacaoDeEmbalagens(produto) {
        if (!Array.isArray(produto?.embalagens) || !produto.embalagens.length) return null;
        const ativas = produto.embalagens.filter((e) => Number(e.ativa ?? 1) === 1);
        return ativas.find((e) => Number(e.compra) === 1)
            || ativas.find((e) => Number(e.principal) === 1)
            || ativas[0]
            || null;
    }

    function apresentacaoLegado(produto) {
        if (!legadoUsaEmbalagemComercial(produto)) return null;
        return {
            quantidade: Number(produto.quantidade_por_embalagem || 0),
            quantidade_por_embalagem: Number(produto.quantidade_por_embalagem || 0),
            unidade_comercial: produto.unidade_comercial || 'UN',
            tipo: produto.unidade_comercial || 'UN',
            unidade: produto.unidade || 'UN',
            valor_compra: Number(produto.valor_compra_embalagem || 0),
            gtin: produto.codigo_barras || null,
            compra: Number(produto.compra_por_embalagem ?? 1)
        };
    }

    /**
     * RC4.31.12.5 — Unidade Comercial base do produto (Vara, Barra, Tubo…).
     */
    function resolverUnidadeComercialProduto(produto) {
        if (!produto) return null;

        const embalagens = Array.isArray(produto.embalagens)
            ? produto.embalagens.filter(embalagemAtivaCompra)
            : [];

        let fonte = null;

        const qtdLegado = Number(produto.quantidade_por_embalagem || 0);
        const ucLegado = String(produto.unidade_comercial || 'UN').toUpperCase();

        const principal = embalagens.find((e) => Number(e.principal) === 1)
            || embalagens.find((e) => !isTipoEmbalagemAgrupadora(e.tipo || e.unidade_comercial))
            || null;

        if (principal && !isTipoEmbalagemAgrupadora(principal.tipo || principal.unidade_comercial)) {
            fonte = principal;
        } else if (qtdLegado > 0 && ucLegado !== 'UN') {
            fonte = {
                id: null,
                tipo: ucLegado,
                unidade_comercial: ucLegado,
                descricao: labelUnidadeComercial(ucLegado, null),
                quantidade: qtdLegado,
                quantidade_por_embalagem: qtdLegado,
                unidade: produto.unidade || 'UN',
                valor_compra: Number(produto.valor_compra_embalagem || 0),
                compra: 1
            };
        }

        if (!fonte) return null;

        return clonarOpcaoCompra(fonte, {
            id: `uc-${produto.id}`,
            embalagem_ref_id: fonte.id || null,
            tipo_origem_compra: 'UNIDADE_COMERCIAL',
            unidade_comercial: fonte.unidade_comercial || fonte.tipo || ucLegado,
            descricao: fonte.descricao || labelUnidadeComercial(fonte.tipo || fonte.unidade_comercial, fonte.descricao),
            quantidade: Number(fonte.quantidade || fonte.quantidade_por_embalagem || qtdLegado || 1),
            quantidade_por_embalagem: Number(fonte.quantidade || fonte.quantidade_por_embalagem || qtdLegado || 1),
            unidade: fonte.unidade || produto.unidade || 'UN'
        });
    }

    function chaveProduto(produto) {
        if (produto?.id != null) return `id:${produto.id}`;
        if (produto?.codigo_barras) return `gtin:${produto.codigo_barras}`;
        return `tmp:${String(produto?.nome || '').slice(0, 24)}`;
    }

    function entrarGuard(produto, operacao) {
        const chave = `${operacao}:${chaveProduto(produto)}`;
        if (pilhaAtiva.has(chave)) {
            const msg = `${TAG} Recursão detectada em ${operacao} (${chave})`;
            if (typeof console !== 'undefined') {
                console.error(msg, { pilha: [...pilhaAtiva], produtoId: produto?.id });
            }
            throw new RangeError(msg);
        }
        if (pilhaAtiva.size >= MAX_PROFUNDIDADE) {
            throw new RangeError(`${TAG} Profundidade máxima excedida em ${operacao}`);
        }
        pilhaAtiva.add(chave);
        return chave;
    }

    function sairGuard(chave) {
        if (chave) pilhaAtiva.delete(chave);
    }

    function apresentacaoIndicaEmbalagemComercial(ap) {
        if (!ap) return false;
        const tipo = String(ap.tipo || ap.unidade_comercial || 'UN').toUpperCase();
        if (tipo === 'UN' && Number(ap.quantidade || ap.quantidade_por_embalagem || 0) <= 1) return false;
        const qtd = Number(ap.quantidade || ap.quantidade_por_embalagem || 0);
        if (!(qtd > 0)) return false;
        return Number(ap.compra ?? 1) === 1;
    }

    function resolverApresentacaoCompra(produto) {
        if (!produto) return null;
        const guard = entrarGuard(produto, 'resolverApresentacaoCompra');
        try {
            const uc = resolverUnidadeComercialProduto(produto);
            if (uc) return uc;
            const deLista = apresentacaoDeEmbalagens(produto);
            if (deLista) return deLista;
            return apresentacaoLegado(produto);
        } finally {
            sairGuard(guard);
        }
    }

    function produtoUsaEmbalagemComercial(produto) {
        if (!produto || !produtoCompraPorEmbalagemAtiva(produto)) return false;
        const guard = entrarGuard(produto, 'produtoUsaEmbalagemComercial');
        try {
            if (resolverUnidadeComercialProduto(produto)) return true;
            const lista = listarEmbalagensCompra(produto);
            if (lista.length > 0) return true;
            return legadoUsaEmbalagemComercial(produto);
        } finally {
            sairGuard(guard);
        }
    }

    function mesmaFonteUnidadeComercial(uc, emb) {
        if (!uc || !emb) return false;
        if (uc.embalagem_ref_id && emb.id && String(uc.embalagem_ref_id) === String(emb.id)) return true;
        const tipoUc = normalizarTipoApresentacao(uc.tipo || uc.unidade_comercial);
        const tipoEmb = normalizarTipoApresentacao(emb.tipo || emb.unidade_comercial);
        const qtdUc = Number(uc.quantidade || uc.quantidade_por_embalagem || 0);
        const qtdEmb = Number(emb.quantidade || emb.quantidade_por_embalagem || 0);
        return tipoUc === tipoEmb && Math.abs(qtdUc - qtdEmb) < 0.0001
            && !isTipoEmbalagemAgrupadora(emb.tipo || emb.unidade_comercial);
    }

    function listarEmbalagensCompra(produto) {
        if (!produto || !produtoCompraPorEmbalagemAtiva(produto)) return [];
        const guard = entrarGuard(produto, 'listarEmbalagensCompra');
        try {
            return montarListaEmbalagensCompraInterna(produto);
        } finally {
            sairGuard(guard);
        }
    }

    /** RC4.31.12.9 — opções de compra mesmo sem compra_por_embalagem (produtos fracionados). */
    function listarOpcoesCompraProduto(produto) {
        if (!produto) return [];
        const guard = entrarGuard(produto, 'listarOpcoesCompraProduto');
        try {
            if (produtoCompraPorEmbalagemAtiva(produto)) {
                return montarListaEmbalagensCompraInterna(produto);
            }
            const lista = [];
            const uc = resolverUnidadeComercialProduto(produto);
            if (uc) lista.push(uc);

            const embalagens = Array.isArray(produto.embalagens)
                ? produto.embalagens.filter(embalagemAtivaCompra)
                : [];

            embalagens.forEach((emb) => {
                if (uc && mesmaFonteUnidadeComercial(uc, emb)) return;
                lista.push(clonarOpcaoCompra(emb, {
                    tipo_origem_compra: isTipoEmbalagemAgrupadora(emb.tipo || emb.unidade_comercial)
                        ? 'EMBALAGEM_COMERCIAL'
                        : 'UNIDADE_COMERCIAL'
                }));
            });

            return lista;
        } finally {
            sairGuard(guard);
        }
    }

    function montarListaEmbalagensCompraInterna(produto) {
        const lista = [];
        const uc = resolverUnidadeComercialProduto(produto);
        if (uc) lista.push(uc);

        const embalagens = [];
        if (Array.isArray(produto.embalagens) && produto.embalagens.length) {
            produto.embalagens
                .filter(embalagemAtivaCompra)
                .forEach((e) => embalagens.push(e));
        }

        if (!embalagens.length) {
            const legado = apresentacaoLegado(produto);
            if (legado && apresentacaoIndicaEmbalagemComercial(legado) && !uc) {
                lista.push(clonarOpcaoCompra(legado, {
                    id: `legado-${produto.id}`,
                    tipo_origem_compra: 'UNIDADE_COMERCIAL'
                }));
            }
            return lista;
        }

        embalagens.forEach((emb) => {
            if (uc && mesmaFonteUnidadeComercial(uc, emb)) return;
            lista.push(clonarOpcaoCompra(emb, {
                tipo_origem_compra: 'EMBALAGEM_COMERCIAL'
            }));
        });

        return lista;
    }

    function listarEmbalagensVenda(produto) {
        if (!produto) return [];
        const guard = entrarGuard(produto, 'listarEmbalagensVenda');
        try {
            const lista = [];
            if (Array.isArray(produto.embalagens) && produto.embalagens.length) {
                produto.embalagens
                    .filter((e) => Number(e.ativa ?? 1) === 1 && Number(e.venda ?? 1) === 1)
                    .forEach((e) => lista.push(e));
            }
            return lista;
        } finally {
            sairGuard(guard);
        }
    }

    function formatarRotuloOpcaoCompra(opcao) {
        if (!opcao) return '';
        if (opcao._acao === 'nova_uc') {
            return opcao.descricao || '+ Nova Unidade Comercial...';
        }
        if (opcao.opcao_unidade_base || String(opcao.id || '').startsWith('unidade-base-')) {
            return 'Unidade';
        }
        const nome = labelUnidadeComercial(
            opcao.tipo || opcao.unidade_comercial,
            opcao.descricao
        );
        const qtd = Number(opcao.quantidade || opcao.quantidade_por_embalagem || 1);
        const un = String(opcao.unidade || 'UN').toUpperCase();
        if (qtd > 0 && (opcao.tipo_origem_compra === 'UNIDADE_COMERCIAL' || qtd !== 1 || un !== 'UN')) {
            const qtdFmt = typeof global.formatQuantidadeExibicao === 'function'
                ? global.formatQuantidadeExibicao(qtd, 3)
                : (typeof global.formatNumberInput === 'function'
                    ? global.formatNumberInput(qtd, 3)
                    : Number(qtd).toFixed(3));
            return `${nome} (${qtdFmt} ${un})`;
        }
        return nome;
    }

    /** RC4.31.12.8 — opção fixa "Unidade" (1 unidade de estoque). */
    function criarOpcaoUnidadeBase(produto) {
        const un = String(produto?.unidade || 'UN').toUpperCase();
        return clonarOpcaoCompra({
            id: `unidade-base-${produto?.id ?? 'tmp'}`,
            tipo: 'UN',
            descricao: 'Unidade',
            quantidade: 1,
            quantidade_por_embalagem: 1,
            unidade: un,
            tipo_origem_compra: 'UNIDADE_COMERCIAL',
            compra: 1,
            opcao_unidade_base: true
        });
    }

    function criarOpcaoNovaUnidadeComercial() {
        return {
            id: OPCAO_NOVA_UC_ID,
            descricao: '+ Nova Unidade Comercial...',
            tipo_origem_compra: 'ACAO_UI',
            _acao: 'nova_uc'
        };
    }

    function ehOpcaoNovaUnidadeComercial(opcaoOuId) {
        const id = typeof opcaoOuId === 'object' ? opcaoOuId?.id : opcaoOuId;
        return String(id || '') === OPCAO_NOVA_UC_ID;
    }

    function ehOpcaoUnidadeBase(opcao) {
        if (!opcao) return false;
        return Boolean(opcao.opcao_unidade_base) || String(opcao.id || '').startsWith('unidade-base-');
    }

    function mesmaOpcaoUnidadeBase(item, base) {
        if (!item || !base) return false;
        if (ehOpcaoUnidadeBase(item)) return true;
        const tipo = normalizarTipoApresentacao(item.tipo || item.unidade_comercial);
        const qtd = Number(item.quantidade || item.quantidade_por_embalagem || 0);
        return tipo === 'UN' && qtd <= 1 && !item.descricao;
    }

    /**
     * RC4.31.12.8 — lista completa do select "Comprar em":
     * Unidade + cadastradas/temporárias + ação Nova UC.
     */
    function montarOpcoesComprarEm(produto, listaCadastrada = []) {
        const base = criarOpcaoUnidadeBase(produto);
        const opcoes = [base];
        (Array.isArray(listaCadastrada) ? listaCadastrada : []).forEach((item) => {
            if (ehOpcaoNovaUnidadeComercial(item)) return;
            if (mesmaOpcaoUnidadeBase(item, base)) return;
            opcoes.push(item);
        });
        opcoes.push(criarOpcaoNovaUnidadeComercial());
        return opcoes;
    }

    /** Payload para cadastro permanente de UC aprendida na compra. */
    function montarEmbalagemAprendidaCompra(dados, produto) {
        const descricao = String(dados.descricao || '').trim();
        const quantidade = Number(dados.quantidade || dados.quantidade_por_embalagem || 0);
        const unidade = String(dados.unidade || produto?.unidade || 'UN').trim().toLowerCase();
        const jaTemPrincipal = Array.isArray(produto?.embalagens)
            && produto.embalagens.some((e) => Number(e.principal) === 1);
        const compra = dados.compra === undefined || dados.compra === null
            ? 1
            : (Number(dados.compra) === 1 ? 1 : 0);
        const venda = Number(dados.venda) === 1 ? 1 : 0;
        return {
            tipo: normalizarTipoApresentacao(dados.tipo || 'ROLO'),
            descricao,
            quantidade: quantidade > 0 ? quantidade : 1,
            unidade,
            principal: jaTemPrincipal ? 0 : 1,
            compra,
            venda,
            estoque: 1,
            ativa: 1,
            origem: 'COMPRA_APRENDIZAGEM'
        };
    }

    function validarUtilizacaoAprendizagemCompra(dados = {}) {
        const compra = dados.compra === undefined || dados.compra === null
            ? 1
            : (Number(dados.compra) === 1 ? 1 : 0);
        const venda = Number(dados.venda) === 1 ? 1 : 0;
        if (compra !== 1 && venda !== 1) {
            return { ok: false, mensagem: 'Selecione ao menos Compras ou Vendas em Utilizar em.' };
        }
        return { ok: true, compra, venda };
    }

    /** UC temporária — somente para o lançamento atual. */
    function montarUnidadeComercialTemporariaCompra(dados, produto) {
        const validacao = validarUtilizacaoAprendizagemCompra(dados);
        if (!validacao.ok) {
            throw new Error(validacao.mensagem);
        }
        const base = montarEmbalagemAprendidaCompra({ ...dados, ...validacao }, produto);
        const id = `temp-uc-${produto?.id ?? 'tmp'}-${Date.now()}`;
        return clonarOpcaoCompra(base, {
            id,
            embalagem_ref_id: null,
            tipo_origem_compra: 'UNIDADE_COMERCIAL',
            quantidade_por_embalagem: base.quantidade,
            somente_compra: true,
            origem: 'COMPRA_TEMPORARIA'
        });
    }

    global.ProdutoApresentacaoResolver = Object.freeze({
        resolverApresentacaoCompra,
        resolverUnidadeComercialProduto,
        produtoUsaEmbalagemComercial,
        produtoCompraPorEmbalagemAtiva,
        listarEmbalagensCompra,
        listarOpcoesCompraProduto,
        listarEmbalagensVenda,
        formatarRotuloOpcaoCompra,
        labelUnidadeComercial,
        isTipoEmbalagemAgrupadora,
        legadoUsaEmbalagemComercial,
        apresentacaoIndicaEmbalagemComercial,
        criarOpcaoUnidadeBase,
        criarOpcaoNovaUnidadeComercial,
        montarOpcoesComprarEm,
        montarEmbalagemAprendidaCompra,
        montarUnidadeComercialTemporariaCompra,
        validarUtilizacaoAprendizagemCompra,
        ehOpcaoNovaUnidadeComercial,
        ehOpcaoUnidadeBase,
        OPCAO_NOVA_UC_ID,
        _TAG: TAG
    });
}(typeof window !== 'undefined' ? window : global));
