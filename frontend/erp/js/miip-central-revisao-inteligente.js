/**
 * RC3.7.6 — Inteligência comercial READ-ONLY para a Central de Revisão.
 *
 * Não grava preço, produto, estoque, compras nem financeiro.
 * Apenas calcula indicadores / comparações / sugestões para exibição.
 *
 * @module miip-central-revisao-inteligente
 */
(function factoryMiipRevisaoInteligente(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.MiipRevisaoInteligente = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function buildApi() {
  'use strict';

  const EPS = 0.005; // ~0.5 centavo
  const FILTROS = Object.freeze({
    TODOS: 'todos',
    ALTERADOS: 'alterados',
    NOVOS: 'novos',
    SEM_CADASTRO: 'sem_cadastro',
    DIVERGENTES: 'divergentes'
  });

  function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : (fallback != null ? fallback : 0);
  }

  function arred2(v) {
    return Math.round(num(v) * 100) / 100;
  }

  /**
   * Índice de produtos do cadastro por id (uma passada).
   * @param {Array} produtos
   * @returns {Map<number, Object>}
   */
  function indexarProdutos(produtos) {
    const map = new Map();
    (produtos || []).forEach((p) => {
      const id = Number(p?.id);
      if (id) map.set(id, p);
    });
    return map;
  }

  function resolverProdutoId(item, resultadoMiip, produtosById) {
    if (item?.produto_id) return Number(item.produto_id);
    const pe = resultadoMiip?.produtoEncontrado || resultadoMiip?.candidatoSelecionado?.produto;
    if (pe?.id) return Number(pe.id);
    return null;
  }

  function custoNfeDoItem(item) {
    return arred2(item?.preco_unitario ?? item?.valor_unitario ?? 0);
  }

  function custoAtualDoCadastro(produto) {
    if (!produto) return null;
    const c = produto.preco_compra ?? produto.custo ?? produto.preco_custo;
    if (c == null || c === '') return null;
    return arred2(c);
  }

  function margemDoCadastro(produto, item) {
    if (produto) {
      const m = produto.lucro_percentual ?? produto.margem ?? produto.margem_lucro;
      if (m != null && m !== '') return num(m, 35);
    }
    if (item?.margem_lucro != null && item.margem_lucro !== '') {
      return num(item.margem_lucro, 35);
    }
    return 35;
  }

  function precoVendaCadastro(produto) {
    if (!produto) return null;
    const p = produto.preco_venda ?? produto.preco;
    if (p == null || p === '') return null;
    return arred2(p);
  }

  function produtoDescontinuado(produto) {
    if (!produto) return false;
    if (produto.descontinuado === true || produto.descontinuado === 1) return true;
    if (produto.ativo === false || produto.ativo === 0 || produto.ativo === '0') return true;
    const st = String(produto.status || produto.situacao || '').toLowerCase();
    return st === 'descontinuado' || st === 'inativo';
  }

  /**
   * Classifica situação comercial (somente leitura).
   */
  function classificarSituacao({
    semCadastro,
    produtoNovo,
    descontinuado,
    custoAtual,
    custoNfe
  }) {
    if (descontinuado) return 'descontinuado';
    if (semCadastro || produtoNovo) return 'sem_cadastro';
    if (custoAtual == null) return 'sem_cadastro';
    const diff = custoNfe - custoAtual;
    if (Math.abs(diff) <= EPS) return 'sem_alteracao';
    if (diff > 0) return 'aumentou';
    return 'reduziu';
  }

  function diferencaPercentual(custoAtual, custoNfe) {
    if (custoAtual == null || Math.abs(custoAtual) < EPS) {
      if (custoNfe == null) return null;
      return null;
    }
    return arred2(((custoNfe - custoAtual) / custoAtual) * 100);
  }

  function precoSugerido(novoCusto, margemPct) {
    const m = num(margemPct, 30);
    return arred2(num(novoCusto) * (1 + (m / 100)));
  }

  /**
   * Monta snapshot inteligente uma vez na abertura da revisão.
   * @param {Object} params
   * @param {Array} params.itens — itens do parse
   * @param {Array} [params.resultadosMiip]
   * @param {Array} [params.produtos]
   * @returns {Object}
   */
  function montarSnapshot({ itens, resultadosMiip, produtos }) {
    const byId = indexarProdutos(produtos);
    const resultadosByIndice = new Map();
    (resultadosMiip || []).forEach((r) => {
      if (r && r.indice != null) resultadosByIndice.set(Number(r.indice), r);
    });

    const linhas = (itens || []).map((item, indice) => {
      const miip = resultadosByIndice.get(indice) || null;
      const produtoId = resolverProdutoId(item, miip, byId);
      const produto = produtoId ? byId.get(produtoId) : null;
      const semCadastro = Boolean(
        (miip && miip.precisaCadastro && !miip.produtoEncontrado)
        || (!produtoId && !produto)
      );
      const produtoNovo = Boolean(miip?.precisaCadastro);
      const descontinuado = produtoDescontinuado(produto);
      const custoNfe = custoNfeDoItem(item);
      const custoAtual = custoAtualDoCadastro(produto);
      const situacao = classificarSituacao({
        semCadastro,
        produtoNovo: produtoNovo && !produtoId,
        descontinuado,
        custoAtual,
        custoNfe
      });
      const diffPct = diferencaPercentual(custoAtual, custoNfe);
      const margemAtual = margemDoCadastro(produto, item);
      const precoAtual = precoVendaCadastro(produto);
      const sugerido = precoSugerido(custoNfe, margemAtual);
      const quantidade = num(item.quantidade, 0);
      const valorTotal = arred2(quantidade * custoNfe);

      return {
        indice,
        nome: item.produto_nome || item.descricao || miip?.produtoXML?.produto_nome || `Item ${indice + 1}`,
        produtoId,
        custoAtual,
        custoNfe,
        diferencaPct: diffPct,
        situacao,
        semCadastro: situacao === 'sem_cadastro',
        produtoNovo: Boolean(produtoNovo && (semCadastro || !produtoId)),
        descontinuado,
        precoAtual,
        margemAtual,
        novoCusto: custoNfe,
        precoSugerido: sugerido,
        unidade: item.unidade || item.uCom || '',
        quantidade,
        valorTotal,
        // RC3.7.6.3 — impacto absoluto da linha (somente memória)
        impactoAbsoluto: (custoAtual != null && Number.isFinite(custoNfe))
          ? arred2((custoNfe - custoAtual) * quantidade)
          : null
      };
    });

    const indicadores = {
      produtos: linhas.length,
      produtosNovos: linhas.filter((l) => l.produtoNovo || l.situacao === 'sem_cadastro').length,
      custoAumentou: linhas.filter((l) => l.situacao === 'aumentou').length,
      custoReduziu: linhas.filter((l) => l.situacao === 'reduziu').length,
      semAlteracao: linhas.filter((l) => l.situacao === 'sem_alteracao').length,
      semCadastro: linhas.filter((l) => l.situacao === 'sem_cadastro').length,
      descontinuados: linhas.filter((l) => l.situacao === 'descontinuado').length,
      custoAlterado: linhas.filter((l) => l.situacao === 'aumentou' || l.situacao === 'reduziu').length
    };

    return {
      geradoEm: new Date().toISOString(),
      linhas,
      indicadores,
      impacto: montarDashboardImpacto(linhas),
      filtroAtivo: FILTROS.TODOS,
      mensagemResumo: 'Nenhum preço será alterado automaticamente.'
    };
  }

  /**
   * RC3.7.6.3 — Dashboard de impacto comercial (cálculo único).
   * impacto linha = (custoNfe - ultimoCusto) × quantidade
   * @param {Array} linhas
   * @returns {Object}
   */
  function montarDashboardImpacto(linhas) {
    const lista = linhas || [];
    const comparaveis = lista.filter((l) => l.impactoAbsoluto != null && Number.isFinite(Number(l.impactoAbsoluto)));

    if (!comparaveis.length) {
      return {
        disponivel: false,
        mensagem: 'Histórico insuficiente para cálculo financeiro.',
        aumentoTotal: 0,
        reducaoTotal: 0,
        saldo: 0,
        produtos: lista.length,
        produtosAlterados: 0,
        produtosNovos: lista.filter((l) => l.produtoNovo || l.situacao === 'sem_cadastro').length,
        maiorAumento: null,
        maiorReducao: null
      };
    }

    let aumentoTotal = 0;
    let reducaoTotal = 0;
    let maiorAumento = null;
    let maiorReducao = null;

    comparaveis.forEach((l) => {
      const impacto = Number(l.impactoAbsoluto);
      if (impacto > EPS) {
        aumentoTotal += impacto;
        if (!maiorAumento || impacto > Number(maiorAumento.impactoAbsoluto)) {
          maiorAumento = l;
        }
      } else if (impacto < -EPS) {
        reducaoTotal += Math.abs(impacto);
        if (!maiorReducao || impacto < Number(maiorReducao.impactoAbsoluto)) {
          maiorReducao = l;
        }
      }
    });

    aumentoTotal = arred2(aumentoTotal);
    reducaoTotal = arred2(reducaoTotal);
    const saldo = arred2(aumentoTotal - reducaoTotal);

    const resumoLinha = (l) => {
      if (!l) return null;
      return {
        indice: l.indice,
        nome: l.nome,
        impactoAbsoluto: l.impactoAbsoluto,
        custoAtual: l.custoAtual,
        custoNfe: l.custoNfe,
        quantidade: l.quantidade,
        tooltip: [
          `Último custo: ${l.custoAtual != null ? Number(l.custoAtual).toFixed(2) : '—'}`,
          `Novo custo: ${l.custoNfe != null ? Number(l.custoNfe).toFixed(2) : '—'}`,
          `Quantidade: ${l.quantidade != null ? l.quantidade : '—'}`,
          `Impacto financeiro: ${l.impactoAbsoluto != null ? Number(l.impactoAbsoluto).toFixed(2) : '—'}`
        ].join('\n')
      };
    };

    return {
      disponivel: true,
      mensagem: null,
      aumentoTotal,
      reducaoTotal,
      saldo,
      produtos: lista.length,
      produtosAlterados: lista.filter((l) => l.situacao === 'aumentou' || l.situacao === 'reduziu').length,
      produtosNovos: lista.filter((l) => l.produtoNovo || l.situacao === 'sem_cadastro').length,
      maiorAumento: resumoLinha(maiorAumento),
      maiorReducao: resumoLinha(maiorReducao)
    };
  }

  function linhaPassaFiltro(linha, filtro) {
    const f = filtro || FILTROS.TODOS;
    if (f === FILTROS.TODOS) return true;
    if (f === FILTROS.ALTERADOS) {
      return linha.situacao === 'aumentou' || linha.situacao === 'reduziu';
    }
    if (f === FILTROS.NOVOS) return Boolean(linha.produtoNovo || linha.situacao === 'sem_cadastro');
    if (f === FILTROS.SEM_CADASTRO) return linha.situacao === 'sem_cadastro';
    if (f === FILTROS.DIVERGENTES) {
      return linha.situacao === 'aumentou'
        || linha.situacao === 'reduziu'
        || linha.situacao === 'sem_cadastro'
        || linha.situacao === 'descontinuado';
    }
    return true;
  }

  function filtrarLinhas(snapshot, filtro) {
    const f = filtro || snapshot?.filtroAtivo || FILTROS.TODOS;
    return (snapshot?.linhas || []).filter((l) => linhaPassaFiltro(l, f));
  }

  function metaSituacao(situacao) {
    switch (situacao) {
      case 'sem_alteracao':
        return { cor: 'verde', tom: 'ok', icone: 'fa-check-circle', label: 'Sem alteração' };
      case 'aumentou':
      case 'reduziu':
        return { cor: 'amarelo', tom: 'warn', icone: 'fa-exclamation-triangle', label: 'Custo alterado' };
      case 'sem_cadastro':
        return { cor: 'vermelho', tom: 'alert', icone: 'fa-times-circle', label: 'Sem cadastro' };
      case 'descontinuado':
        return { cor: 'azul', tom: 'info', icone: 'fa-ban', label: 'Descontinuado' };
      default:
        return { cor: 'verde', tom: 'ok', icone: 'fa-info-circle', label: situacao || '—' };
    }
  }

  function formatarDiffPct(pct) {
    if (pct == null || !Number.isFinite(Number(pct))) return '—';
    const n = Number(pct);
    const sinal = n > 0 ? '+' : '';
    return `${sinal}${n.toFixed(1)}%`;
  }

  /**
   * RC3.7.6.1 — faixa visual da |diferença %| de custo (somente UI).
   * 0–2% cinza · 2–10% amarelo · 10–20% laranja · >20% vermelho
   * @param {number|null} diferencaPct
   * @returns {{ faixa: string, classe: string, label: string }}
   */
  function corFaixaDiferencaCusto(diferencaPct) {
    if (diferencaPct == null || !Number.isFinite(Number(diferencaPct))) {
      return { faixa: 'indefinido', classe: 'cinza', label: 'Sem comparação' };
    }
    const abs = Math.abs(Number(diferencaPct));
    if (abs <= 2) return { faixa: '0-2', classe: 'cinza', label: 'Variação mínima' };
    if (abs <= 10) return { faixa: '2-10', classe: 'amarelo', label: 'Variação moderada' };
    if (abs <= 20) return { faixa: '10-20', classe: 'laranja', label: 'Variação relevante' };
    return { faixa: '>20', classe: 'vermelho', label: 'Variação alta' };
  }

  /**
   * RC3.7.6.1 — Histórico comercial READ-ONLY a partir do array produtos em memória.
   * @param {Object} params
   * @param {number|null} [params.produtoId]
   * @param {Array} [params.produtos]
   * @param {number|null} [params.custoNfe]
   * @param {Object|null} [params.linhaIntel] — linha já calculada no snapshot (opcional)
   * @returns {Object}
   */
  function montarHistoricoComercial(params = {}) {
    const produtos = params.produtos || [];
    const produtoId = params.produtoId != null ? Number(params.produtoId) : null;
    const linha = params.linhaIntel || null;

    let produto = null;
    if (produtoId) {
      produto = produtos.find((p) => Number(p?.id) === produtoId) || null;
    }

    if (!produto && !linha?.produtoId) {
      return {
        disponivel: false,
        produtoNovo: true,
        mensagem: 'Produto Novo — Histórico Comercial indisponível.',
        ultimoCusto: null,
        custoNfe: params.custoNfe != null ? arred2(params.custoNfe) : null,
        diferencaPct: null,
        precoVendaAtual: null,
        margemAtual: null,
        faixa: corFaixaDiferencaCusto(null),
        tooltip: 'Produto sem cadastro no CDS.'
      };
    }

    if (!produto && linha?.produtoId) {
      produto = produtos.find((p) => Number(p?.id) === Number(linha.produtoId)) || null;
    }

    if (!produto) {
      return {
        disponivel: false,
        produtoNovo: true,
        mensagem: 'Produto Novo — Histórico Comercial indisponível.',
        ultimoCusto: null,
        custoNfe: params.custoNfe != null ? arred2(params.custoNfe) : (linha?.custoNfe ?? null),
        diferencaPct: null,
        precoVendaAtual: null,
        margemAtual: null,
        faixa: corFaixaDiferencaCusto(null),
        tooltip: 'Produto sem cadastro no CDS.'
      };
    }

    const ultimoCusto = linha?.custoAtual != null
      ? linha.custoAtual
      : custoAtualDoCadastro(produto);
    const custoNfe = params.custoNfe != null
      ? arred2(params.custoNfe)
      : (linha?.custoNfe != null ? linha.custoNfe : null);
    const diferencaPct = linha?.diferencaPct != null
      ? linha.diferencaPct
      : diferencaPercentual(ultimoCusto, custoNfe);
    const precoVendaAtual = linha?.precoAtual != null
      ? linha.precoAtual
      : precoVendaCadastro(produto);
    const margemAtual = linha?.margemAtual != null
      ? linha.margemAtual
      : margemDoCadastro(produto, null);
    const faixa = corFaixaDiferencaCusto(diferencaPct);
    const tooltip = [
      `Último custo cadastrado: ${ultimoCusto != null ? ultimoCusto.toFixed(2) : '—'}`,
      `Novo custo da NF-e: ${custoNfe != null ? custoNfe.toFixed(2) : '—'}`,
      `Diferença percentual: ${formatarDiffPct(diferencaPct)}`
    ].join('\n');

    return {
      disponivel: true,
      produtoNovo: false,
      mensagem: null,
      produtoId: Number(produto.id),
      ultimoCusto,
      custoNfe,
      diferencaPct,
      precoVendaAtual,
      margemAtual,
      faixa,
      tooltip
    };
  }

  // —— RC3.7.6.2 Ordenação / prioridade (somente visual) ——
  const ORDENS = Object.freeze({
    NFE: 'nfe',
    AUMENTO: 'aumento',
    REDUCAO: 'reducao',
    NOVOS: 'novos',
    SEM_CADASTRO: 'sem_cadastro',
    VALOR: 'valor',
    NOME: 'nome'
  });

  const ORDENS_LABEL = Object.freeze({
    nfe: 'Ordem da NF-e',
    aumento: 'Maior aumento de custo',
    reducao: 'Maior redução de custo',
    novos: 'Produtos novos',
    sem_cadastro: 'Produtos sem cadastro',
    valor: 'Maior valor total da linha',
    nome: 'Nome do produto (A→Z)'
  });

  const LS_PREFS = 'miip_central_revisao_prefs_v1';

  // —— RC3.7.6.5 Painéis recolhíveis / modo foco ——
  const PAINEIS = Object.freeze({
    DASHBOARD: 'dashboardComercial',
    HISTORICO: 'historicoComercial',
    ULTIMAS: 'ultimasCompras',
    IDENTIFICADORES: 'identificadores'
  });

  function normalizarPaineis(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      dashboardComercial: src.dashboardComercial !== false,
      historicoComercial: src.historicoComercial !== false,
      ultimasCompras: src.ultimasCompras !== false,
      identificadores: src.identificadores !== false
    };
  }

  function painelExpandido(paineis, id) {
    const n = normalizarPaineis(paineis);
    if (!Object.prototype.hasOwnProperty.call(n, id)) return true;
    return n[id] !== false;
  }

  function alternarPainel(paineis, id) {
    const n = normalizarPaineis(paineis);
    if (!Object.prototype.hasOwnProperty.call(n, id)) return n;
    return { ...n, [id]: !n[id] };
  }

  /**
   * Ativa/desativa modo foco preservando snapshot dos painéis para restauração exata.
   * @returns {{ modoFoco: boolean, paineis: Object, _focoSnapshot: Object|null }}
   */
  function aplicarModoFocoLayout(estadoLayout, ativar) {
    const paineis = normalizarPaineis(estadoLayout?.paineis);
    const modoAtual = estadoLayout?.modoFoco === true;
    const snapshot = estadoLayout?._focoSnapshot || null;

    if (ativar && !modoAtual) {
      return {
        modoFoco: true,
        paineis: { ...paineis },
        _focoSnapshot: { paineis: { ...paineis } }
      };
    }
    if (!ativar && modoAtual) {
      return {
        modoFoco: false,
        paineis: normalizarPaineis(snapshot?.paineis || paineis),
        _focoSnapshot: null
      };
    }
    return {
      modoFoco: modoAtual,
      paineis,
      _focoSnapshot: snapshot
    };
  }

  function lerPrefsLocal() {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(LS_PREFS);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;

      let paineis = normalizarPaineis(parsed.paineis);
      // Compat RC3.7.6.4
      if (parsed.ultimasComprasExpandido === false && parsed.paineis?.ultimasCompras === undefined) {
        paineis = { ...paineis, ultimasCompras: false };
      }

      return {
        ordenacao: Object.values(ORDENS).includes(parsed.ordenacao) ? parsed.ordenacao : ORDENS.NFE,
        filtro: parsed.filtro || FILTROS.TODOS,
        fixarPrioritarios: parsed.fixarPrioritarios === true,
        paineis,
        ultimasComprasExpandido: paineis.ultimasCompras,
        modoFoco: parsed.modoFoco === true
      };
    } catch {
      return null;
    }
  }

  function salvarPrefsLocal(prefs) {
    try {
      if (typeof localStorage === 'undefined') return false;
      const paineis = normalizarPaineis(prefs.paineis || {
        ultimasCompras: prefs.ultimasComprasExpandido !== false
      });
      if (prefs.ultimasComprasExpandido === false && prefs.paineis == null) {
        paineis.ultimasCompras = false;
      }
      localStorage.setItem(LS_PREFS, JSON.stringify({
        ordenacao: prefs.ordenacao || ORDENS.NFE,
        filtro: prefs.filtro || FILTROS.TODOS,
        fixarPrioritarios: prefs.fixarPrioritarios === true,
        paineis,
        ultimasComprasExpandido: paineis.ultimasCompras,
        modoFoco: prefs.modoFoco === true
      }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Prioridade informativa:
   * alta — novo/sem cadastro ou |diff| > 20%
   * media — |diff| entre 5% e 20%
   * baixa — |diff| < 5% (ou sem diff e cadastrado)
   */
  function classificarPrioridade(linha) {
    if (!linha) return { nivel: 'baixa', icone: '🟢', label: 'Baixa' };
    if (linha.produtoNovo || linha.situacao === 'sem_cadastro' || linha.semCadastro) {
      return { nivel: 'alta', icone: '🔴', label: 'Alta' };
    }
    const abs = linha.diferencaPct != null && Number.isFinite(Number(linha.diferencaPct))
      ? Math.abs(Number(linha.diferencaPct))
      : 0;
    if (abs > 20) return { nivel: 'alta', icone: '🔴', label: 'Alta' };
    if (abs >= 5) return { nivel: 'media', icone: '🟡', label: 'Média' };
    return { nivel: 'baixa', icone: '🟢', label: 'Baixa' };
  }

  function pesoPrioridade(nivel) {
    if (nivel === 'alta') return 0;
    if (nivel === 'media') return 1;
    return 2;
  }

  function valorLinha(linha) {
    if (!linha) return 0;
    if (linha.valorTotal != null) return Number(linha.valorTotal) || 0;
    return arred2(num(linha.quantidade, 0) * num(linha.custoNfe, 0));
  }

  /**
   * Ordena cópia de entradas { listaIdx, linha } sem mutar o array original.
   * @param {Array<{ listaIdx: number, linha?: Object }>} entradas
   * @param {string} ordem
   * @param {boolean} fixarPrioritarios
   * @returns {Array}
   */
  function ordenarEntradasVisuais(entradas, ordem, fixarPrioritarios) {
    const copia = (entradas || []).map((e) => ({ ...e }));
    const ordemEfetiva = Object.values(ORDENS).includes(ordem) ? ordem : ORDENS.NFE;

    copia.sort((a, b) => {
      const la = a.linha || {};
      const lb = b.linha || {};
      const pa = classificarPrioridade(la);
      const pb = classificarPrioridade(lb);

      if (fixarPrioritarios) {
        const dwa = pesoPrioridade(pa.nivel) - pesoPrioridade(pb.nivel);
        if (dwa !== 0) return dwa;
      }

      let cmp = 0;
      switch (ordemEfetiva) {
        case ORDENS.AUMENTO:
          cmp = num(lb.diferencaPct, -Infinity) - num(la.diferencaPct, -Infinity);
          break;
        case ORDENS.REDUCAO:
          cmp = num(la.diferencaPct, Infinity) - num(lb.diferencaPct, Infinity);
          break;
        case ORDENS.NOVOS:
          cmp = Number(Boolean(lb.produtoNovo || lb.situacao === 'sem_cadastro' || lb.semCadastro))
            - Number(Boolean(la.produtoNovo || la.situacao === 'sem_cadastro' || la.semCadastro));
          break;
        case ORDENS.SEM_CADASTRO:
          cmp = Number(Boolean(lb.situacao === 'sem_cadastro' || lb.semCadastro))
            - Number(Boolean(la.situacao === 'sem_cadastro' || la.semCadastro));
          break;
        case ORDENS.VALOR:
          cmp = valorLinha(lb) - valorLinha(la);
          break;
        case ORDENS.NOME:
          cmp = String(la.nome || '').localeCompare(String(lb.nome || ''), 'pt-BR', { sensitivity: 'base' });
          break;
        case ORDENS.NFE:
        default:
          cmp = num(la.indice, a.listaIdx) - num(lb.indice, b.listaIdx);
          break;
      }
      if (cmp !== 0) return cmp;
      return a.listaIdx - b.listaIdx;
    });

    return copia;
  }

  function contarPrioridades(linhas) {
    const cont = { alta: 0, media: 0, baixa: 0 };
    (linhas || []).forEach((l) => {
      const p = classificarPrioridade(l);
      cont[p.nivel] += 1;
    });
    return cont;
  }

  function labelOrdem(ordem) {
    return ORDENS_LABEL[ordem] || ORDENS_LABEL.nfe;
  }

  // —— RC3.7.6.4 Últimas compras (read-only / helpers puros) ——
  const ULTIMAS_COMPRAS_LIMITE = 5;
  const MSG_SEM_COMPRAS = 'Nenhuma compra anterior encontrada.';

  function parseDataCompra(valor) {
    if (!valor) return 0;
    const s = String(valor).trim();
    if (!s) return 0;
    // YYYY-MM-DD ou ISO
    const t = Date.parse(s.includes('T') ? s : s.replace(' ', 'T'));
    if (Number.isFinite(t)) return t;
    // DD/MM/YYYY
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return Date.parse(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
    return 0;
  }

  function custoRegistroCompra(row) {
    if (!row || typeof row !== 'object') return null;
    const candidatos = [
      row.custo,
      row.custo_unitario_final,
      row.preco_unitario,
      row.preco_compra
    ];
    for (let i = 0; i < candidatos.length; i += 1) {
      const n = num(candidatos[i], NaN);
      if (Number.isFinite(n)) return arred2(n);
    }
    return null;
  }

  /**
   * Normaliza, ordena (mais recente → antiga), limita e destaca
   * menor/maior custo e última compra. Não muta o array de entrada.
   * @param {Array} rows
   * @param {number} [limite=5]
   * @returns {Object}
   */
  function montarUltimasCompras(rows, limite) {
    const max = Math.max(1, Number(limite) || ULTIMAS_COMPRAS_LIMITE);
    const copia = (rows || []).map((r) => ({ ...(r || {}) }));

    copia.sort((a, b) => {
      const da = parseDataCompra(a.data || a.data_compra || a.data_entrada || a.data_emissao);
      const db = parseDataCompra(b.data || b.data_compra || b.data_entrada || b.data_emissao);
      if (db !== da) return db - da;
      return num(b.compra_id || b.id, 0) - num(a.compra_id || a.id, 0);
    });

    const fatia = copia.slice(0, max);
    if (!fatia.length) {
      return {
        disponivel: false,
        mensagem: MSG_SEM_COMPRAS,
        registros: [],
        resumo: {
          menorCusto: null,
          maiorCusto: null,
          ultimoCusto: null,
          quantidadeAnalisadas: 0
        }
      };
    }

    let idxMenor = 0;
    let idxMaior = 0;
    fatia.forEach((r, i) => {
      const c = custoRegistroCompra(r);
      const cMenor = custoRegistroCompra(fatia[idxMenor]);
      const cMaior = custoRegistroCompra(fatia[idxMaior]);
      if (c != null && (cMenor == null || c < cMenor)) idxMenor = i;
      if (c != null && (cMaior == null || c > cMaior)) idxMaior = i;
    });

    const registros = fatia.map((r, i) => {
      const custo = custoRegistroCompra(r);
      return {
        data: r.data || r.data_compra || r.data_entrada || r.data_emissao || null,
        fornecedor: r.fornecedor || r.fornecedor_nome || '—',
        custo,
        quantidade: num(r.quantidade, null),
        nfe: r.nfe || r.numero_nf || r.numero_nfe || '—',
        compraId: r.compra_id != null ? Number(r.compra_id) : (r.id != null ? Number(r.id) : null),
        ehUltimaCompra: i === 0,
        ehMenorCusto: i === idxMenor,
        ehMaiorCusto: i === idxMaior
      };
    });

    const ultimoCusto = registros[0].custo;
    const menorCusto = registros[idxMenor].custo;
    const maiorCusto = registros[idxMaior].custo;

    return {
      disponivel: true,
      mensagem: null,
      registros,
      resumo: {
        menorCusto,
        maiorCusto,
        ultimoCusto,
        quantidadeAnalisadas: registros.length
      }
    };
  }

  function lerCacheUltimasCompras(cache, produtoId) {
    if (!cache || produtoId == null || produtoId === '') return null;
    return cache[String(produtoId)] || null;
  }

  function gravarCacheUltimasCompras(cache, produtoId, entrada) {
    if (!cache || produtoId == null || produtoId === '') return false;
    cache[String(produtoId)] = entrada;
    return true;
  }

  /**
   * true somente se ainda não houve seleção/busca deste produto na revisão.
   * Qualquer entrada (loading|ok) impede nova chamada.
   */
  function precisaBuscarUltimasCompras(cache, produtoId) {
    return lerCacheUltimasCompras(cache, produtoId) == null;
  }

  /** Libera cache em memória ao fechar a revisão (nunca no banco). */
  function liberarCacheUltimasCompras(cache) {
    if (!cache || typeof cache !== 'object') return {};
    Object.keys(cache).forEach((k) => {
      delete cache[k];
    });
    return cache;
  }

  // —— RC9.4 UX comparação visual (somente apresentação) ——

  const COMP_STATUS = Object.freeze({
    IGUAL: 'igual',
    SEMELHANTE: 'semelhante',
    DIFERENTE: 'diferente',
    AUSENTE: 'ausente'
  });

  function normalizarTextoCmp(v) {
    return String(v ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizarCodigoCmp(v) {
    return String(v ?? '').replace(/\D/g, '');
  }

  function normalizarUnidadeCmp(v) {
    const u = normalizarTextoCmp(v);
    if (['UN', 'UND', 'UNID', 'PC', 'PEC', 'PECA', 'PZA'].includes(u)) return 'UN';
    if (['CX', 'CXA', 'BOX'].includes(u)) return 'CX';
    if (['KG', 'QUILO', 'KILO'].includes(u)) return 'KG';
    if (['LT', 'L', 'LITRO', 'LITROS'].includes(u)) return 'LT';
    return u;
  }

  function similaridadeTextoSimples(a, b) {
    const ta = normalizarTextoCmp(a);
    const tb = normalizarTextoCmp(b);
    if (!ta || !tb) return 0;
    if (ta === tb) return 100;
    const tokensA = ta.split(' ').filter((t) => t.length >= 2);
    const tokensB = new Set(tb.split(' ').filter((t) => t.length >= 2));
    if (!tokensA.length) return 0;
    const hits = tokensA.filter((t) => tokensB.has(t) || tb.includes(t)).length;
    return Math.round((hits / tokensA.length) * 100);
  }

  /**
   * @returns {{ status: string, rotulo: string, xml: string, cds: string }}
   */
  function classificarCampoComparacao(campo, valorXml, valorCds, opcoes = {}) {
    const xml = valorXml == null || valorXml === '' ? '' : String(valorXml);
    const cds = valorCds == null || valorCds === '' ? '' : String(valorCds);
    if (!xml && !cds) {
      return { campo, status: COMP_STATUS.AUSENTE, rotulo: 'Sem informação', xml: '—', cds: '—' };
    }
    if (!xml || !cds) {
      return {
        campo,
        status: COMP_STATUS.AUSENTE,
        rotulo: !xml ? 'Ausente no XML' : 'Ausente no CDS',
        xml: xml || '—',
        cds: cds || '—'
      };
    }

    let iguais = false;
    let semelhante = false;
    if (opcoes.tipo === 'codigo') {
      iguais = normalizarCodigoCmp(xml) === normalizarCodigoCmp(cds);
      if (!iguais) {
        const a = normalizarCodigoCmp(xml);
        const b = normalizarCodigoCmp(cds);
        semelhante = a.length >= 8 && b.length >= 8 && (a.endsWith(b.slice(-8)) || b.endsWith(a.slice(-8)));
      }
    } else if (opcoes.tipo === 'unidade') {
      iguais = normalizarUnidadeCmp(xml) === normalizarUnidadeCmp(cds);
    } else if (opcoes.tipo === 'texto') {
      const sim = similaridadeTextoSimples(xml, cds);
      iguais = sim >= 100;
      semelhante = !iguais && sim >= 60;
      if (iguais) {
        return { campo, status: COMP_STATUS.IGUAL, rotulo: 'Igual', xml, cds, similaridade: sim };
      }
      if (semelhante) {
        return { campo, status: COMP_STATUS.SEMELHANTE, rotulo: `Semelhante (${sim}%)`, xml, cds, similaridade: sim };
      }
      return { campo, status: COMP_STATUS.DIFERENTE, rotulo: 'Diferente', xml, cds, similaridade: sim };
    } else {
      iguais = normalizarTextoCmp(xml) === normalizarTextoCmp(cds);
    }

    if (iguais) return { campo, status: COMP_STATUS.IGUAL, rotulo: opcoes.rotuloIgual || 'Igual', xml, cds };
    if (semelhante) return { campo, status: COMP_STATUS.SEMELHANTE, rotulo: 'Semelhante', xml, cds };
    return { campo, status: COMP_STATUS.DIFERENTE, rotulo: 'Diferente', xml, cds };
  }

  /**
   * Comparação linha a linha XML × CDS (UX only).
   */
  function montarComparacaoVisual(xml = {}, produto = {}, ctx = {}) {
    const tipoXml = xml.tipo || xml.tipo_produto || ctx.tipoXml || '';
    const tipoCds = produto.tipo || produto.tipo_produto || ctx.tipoCds || '';
    const linhas = [
      classificarCampoComparacao('Tipo', tipoXml, tipoCds, { tipo: 'texto' }),
      classificarCampoComparacao('Descrição', xml.produto_nome || xml.nome, produto.nome, { tipo: 'texto' }),
      classificarCampoComparacao('GTIN', xml.codigo_barras || xml.gtin, produto.codigoBarras || produto.codigo_barras, { tipo: 'codigo' }),
      classificarCampoComparacao('Marca', xml.marca, produto.marca || produto.marca_nome, { tipo: 'texto' }),
      classificarCampoComparacao('NCM', xml.ncm, produto.ncm, { tipo: 'codigo' }),
      classificarCampoComparacao('CEST', xml.cest, produto.cest, { tipo: 'codigo' }),
      classificarCampoComparacao('Unidade', xml.unidade, produto.unidade, { tipo: 'unidade' }),
      classificarCampoComparacao(
        'Fornecedor',
        ctx.fornecedorXml || ctx.fornecedor || '',
        produto.fornecedor || ctx.fornecedor || '',
        { tipo: 'texto', rotuloIgual: 'Mesmo fornecedor' }
      ),
      classificarCampoComparacao(
        'Embalagem',
        xml.embalagem || xml.mie_rotulo || xml.unidade,
        produto.embalagem || produto.unidade,
        { tipo: 'unidade' }
      )
    ].filter((l) => {
      // Oculta linha Tipo quando ambos vazios (não poluir UX)
      if (l.campo === 'Tipo' && !String(l.xml || '').trim() && !String(l.cds || '').trim()) return false;
      return true;
    });

    const divergencias = linhas.filter((l) => l.status === COMP_STATUS.DIFERENTE || l.status === COMP_STATUS.SEMELHANTE);
    const iguais = linhas.filter((l) => l.status === COMP_STATUS.IGUAL).length;
    return { linhas, divergencias, iguais, total: linhas.length };
  }

  function barraConfianca(score) {
    const s = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
    const cheios = Math.round(s / 10);
    const barra = `${'█'.repeat(cheios)}${'░'.repeat(10 - cheios)}`;
    let tom = 'baixa';
    if (s >= 95) tom = 'alta';
    else if (s >= 80) tom = 'media';
    else if (s >= 50) tom = 'moderada';
    return { score: s, barra, tom };
  }

  function enriquecerProdutoCds(produtoBase, produtosLista) {
    if (!produtoBase) return null;
    const id = Number(produtoBase.id || produtoBase.produtoId);
    const full = (produtosLista || []).find((p) => Number(p.id) === id) || {};
    return {
      ...full,
      ...produtoBase,
      id: id || produtoBase.id,
      nome: produtoBase.nome || full.nome || '',
      codigo: produtoBase.codigo || full.codigo || '',
      codigoBarras: produtoBase.codigoBarras || produtoBase.codigo_barras || full.codigo_barras || '',
      codigo_barras: produtoBase.codigoBarras || produtoBase.codigo_barras || full.codigo_barras || '',
      plu: produtoBase.plu || full.plu || '',
      ncm: produtoBase.ncm || full.ncm || '',
      cest: produtoBase.cest || full.cest || '',
      unidade: produtoBase.unidade || full.unidade || '',
      marca: produtoBase.marca || full.marca || full.marca_nome || '',
      fornecedor: produtoBase.fornecedor || full.fornecedor || '',
      categoria: full.categoria_nome || full.categoria || produtoBase.categoria || full.categoria_id || '',
      subcategoria: full.subcategoria_nome || full.subcategoria || produtoBase.subcategoria || '',
      preco_venda: full.preco_venda ?? full.preco ?? produtoBase.preco_venda ?? null,
      preco_compra: full.preco_compra ?? full.custo ?? produtoBase.preco_compra ?? null,
      estoque: full.estoque ?? full.saldo ?? full.quantidade_estoque ?? null,
      imagem_principal: full.imagem_principal || produtoBase.imagem_principal || null
    };
  }

  function motivosSemCandidatoPadrao(diagnostico) {
    if (Array.isArray(diagnostico?.motivos) && diagnostico.motivos.length) {
      return diagnostico.motivos.slice(0, 8);
    }
    const bloqueados = Number(diagnostico?.quantidadeCandidatosBloqueados
      || diagnostico?.compatibility?.quantidadeCandidatosBloqueados
      || 0);
    if (bloqueados > 0) {
      return [
        'Nenhum produto CDS compatível encontrado.',
        'Cadastre um novo produto ou selecione manualmente no catálogo.',
        `${bloqueados} candidato(s) descartado(s) por incompatibilidade comercial.`
      ];
    }
    return [
      'Nenhum produto CDS compatível encontrado.',
      'Cadastre um novo produto ou selecione manualmente no catálogo.',
      'GTIN inexistente ou sem associação de fornecedor.'
    ];
  }

  function filtrarProdutosBuscaManual(produtos, termo) {
    const lower = String(termo || '').toLowerCase().trim();
    const digitos = lower.replace(/\D/g, '');
    return (produtos || []).filter((p) => {
      if (!lower) return true;
      const nome = String(p.nome || '').toLowerCase();
      const codigo = String(p.codigo || '').toLowerCase();
      const barras = String(p.codigo_barras || '');
      const plu = String(p.plu || '').toLowerCase();
      const cProd = String(p.codigo_fornecedor || p.codigoFornecedor || '').toLowerCase();
      return nome.includes(lower)
        || codigo.includes(lower)
        || plu.includes(lower)
        || cProd.includes(lower)
        || (digitos && barras.includes(digitos))
        || barras.toLowerCase().includes(lower);
    }).slice(0, 40);
  }

  function motoresUtilizados(pendencia) {
    const motores = [];
    const cand = pendencia?.candidatoSelecionado || {};
    const lista = cand.motoresQueVotaram || cand.motores || [];
    if (pendencia?.motor) motores.push(pendencia.motor);
    lista.forEach((m) => {
      if (m && !motores.includes(m)) motores.push(m);
    });
    if (!motores.length && (pendencia?.candidatos || []).length) motores.push('motor_mubc');
    return motores;
  }

  return {
    FILTROS,
    ORDENS,
    ORDENS_LABEL,
    LS_PREFS,
    PAINEIS,
    ULTIMAS_COMPRAS_LIMITE,
    MSG_SEM_COMPRAS,
    EPS,
    COMP_STATUS,
    num,
    arred2,
    indexarProdutos,
    custoNfeDoItem,
    custoAtualDoCadastro,
    margemDoCadastro,
    precoSugerido,
    diferencaPercentual,
    classificarSituacao,
    montarSnapshot,
    filtrarLinhas,
    linhaPassaFiltro,
    metaSituacao,
    formatarDiffPct,
    corFaixaDiferencaCusto,
    montarHistoricoComercial,
    classificarPrioridade,
    ordenarEntradasVisuais,
    contarPrioridades,
    labelOrdem,
    valorLinha,
    lerPrefsLocal,
    salvarPrefsLocal,
    normalizarPaineis,
    painelExpandido,
    alternarPainel,
    aplicarModoFocoLayout,
    montarDashboardImpacto,
    montarUltimasCompras,
    lerCacheUltimasCompras,
    gravarCacheUltimasCompras,
    precisaBuscarUltimasCompras,
    liberarCacheUltimasCompras,
    parseDataCompra,
    custoRegistroCompra,
    normalizarTextoCmp,
    similaridadeTextoSimples,
    classificarCampoComparacao,
    montarComparacaoVisual,
    barraConfianca,
    enriquecerProdutoCds,
    motivosSemCandidatoPadrao,
    filtrarProdutosBuscaManual,
    motoresUtilizados
  };
}));
