/**
 * Sprint 02 — Motor de Distribuição Fiscal Inteligente (determinístico).
 * Trabalha em centavos. NÃO cria venda / NFC-e / estoque / financeiro.
 */

'use strict';

const { arredondarMoeda, toCentavos } = require('../fiscal/modeloTotais');
const { DEFAULTS_DISTRIBUICAO } = require('./constants');

/**
 * Expande lotes em unidades consumíveis ordenadas de forma estável.
 * Contáveis (UN): 1 unidade = 1 peça com unit_cents.
 * Fracionados: consome em fatias de 0,001 (milésimo) do preço proporcional,
 * limitado para não explodir memória.
 */
function compararUnidade(a, b) {
  if (a.valor_cents !== b.valor_cents) return a.valor_cents - b.valor_cents;
  if (a.produto_id !== b.produto_id) return a.produto_id - b.produto_id;
  if (a.venda_item_id !== b.venda_item_id) return a.venda_item_id - b.venda_item_id;
  return String(a.key).localeCompare(String(b.key));
}

function criarGrupoUnidades(lote, key, valueCents, unitCents, quantity, count, fractional) {
  if (!(count > 0) || !(valueCents > 0)) return null;
  return {
    key,
    produto_id: lote.produto_id,
    nome: lote.nome,
    unidade: lote.unidade || (fractional ? 'KG' : 'UN'),
    venda_id: lote.venda_id,
    venda_item_id: lote.venda_item_id,
    quantidade_por_unidade: quantity,
    quantidade_unidades: count,
    unit_cents: unitCents,
    valor_cents: valueCents,
       fracionado: Boolean(fractional),
       saldo_fiscal: Math.max(0, Number(lote.saldo_fiscal || 0))
  };
}

function agruparUnidades(lotes) {
  const grupos = [];
  const lista = [...(Array.isArray(lotes) ? lotes : [])].sort((a, b) => {
    if (a.produto_id !== b.produto_id) return a.produto_id - b.produto_id;
    if (a.unit_cents !== b.unit_cents) return a.unit_cents - b.unit_cents;
    if (a.venda_id !== b.venda_id) return a.venda_id - b.venda_id;
    return a.venda_item_id - b.venda_item_id;
  });

  for (const lote of lista) {
    const unitCents = Number(lote.unit_cents || toCentavos(lote.preco_unitario));
    if (!(unitCents > 0)) continue;
    const qtd = Number(lote.quantidade_disponivel || 0);
    if (!(qtd > 0)) continue;

    if (!lote.fracionado && Number.isInteger(qtd)) {
      const n = Math.min(Math.floor(qtd), 8000);
      const totalLoteCents = toCentavos(
        lote.valor_disponivel != null
          ? lote.valor_disponivel
          : qtd * (unitCents / 100)
      );
      const baseCents = n > 0 ? Math.floor(totalLoteCents / n) : 0;
      const restoCents = n > 0 ? totalLoteCents - (baseCents * n) : 0;
      const maior = criarGrupoUnidades(
        lote, `${lote.venda_item_id}:0`, baseCents + 1, baseCents + 1, 1, restoCents, false
      );
      const menor = criarGrupoUnidades(
        lote, `${lote.venda_item_id}:${restoCents}`, baseCents, baseCents, 1, n - restoCents, false
      );
      if (maior) grupos.push(maior);
      if (menor) grupos.push(menor);
    } else {
      // Fracionado: fatias de 0,001 da quantidade original (máx 5000 fatias por lote)
      const mil = Math.round(qtd * 1000);
      const fatias = Math.min(Math.max(mil, 0), 5000);
      if (fatias <= 0) continue;
      const valorTotalCents = toCentavos(lote.valor_disponivel != null
        ? lote.valor_disponivel
        : (qtd * (unitCents / 100)));
      const baseCents = Math.floor(valorTotalCents / fatias);
      const restoCents = valorTotalCents - (baseCents * fatias);
      const quantidadeFatia = arredondarMoeda(qtd / fatias);
      const maior = criarGrupoUnidades(
        lote, `${lote.venda_item_id}:f0`, baseCents + 1, unitCents,
        quantidadeFatia, restoCents, true
      );
      const menor = criarGrupoUnidades(
        lote, `${lote.venda_item_id}:f${restoCents}`, baseCents, unitCents,
        quantidadeFatia, fatias - restoCents, true
      );
      if (maior) grupos.push(maior);
      if (menor) grupos.push(menor);
    }
  }

  return grupos.sort(compararUnidade);
}

function agruparUnidadesExpandidas(unidades) {
  const gruposMap = new Map();
  const ordenadas = [...(Array.isArray(unidades) ? unidades : [])].sort(compararUnidade);
  for (const unidade of ordenadas) {
    const chave = JSON.stringify([
      unidade.produto_id,
      unidade.venda_item_id,
      unidade.venda_id,
      unidade.unidade,
      unidade.unit_cents,
      unidade.valor_cents,
      unidade.quantidade,
      unidade.fracionado
    ]);
    const grupo = gruposMap.get(chave);
    if (grupo) {
      grupo.quantidade_unidades += 1;
    } else {
      gruposMap.set(chave, {
        ...unidade,
        quantidade_por_unidade: Number(unidade.quantidade || 0),
        quantidade_unidades: 1
      });
    }
  }
  return [...gruposMap.values()].sort(compararUnidade);
}

function calcularConcentracao(estado, usoPorProduto) {
  let concentracao = 0;
  for (const [produtoId, quantidade] of estado.quantidadePorProduto) {
    const acumulada = Number(usoPorProduto.get(produtoId) || 0) + quantidade;
    concentracao += acumulada * acumulada;
  }
  return concentracao;
}

function compararEstadoCompacto(a, b, grupos, usoPorProduto = new Map()) {
  if (a.produtos.size !== b.produtos.size) return b.produtos.size - a.produtos.size;
  if (a.unidades !== b.unidades) return a.unidades - b.unidades;
  const concentracaoA = calcularConcentracao(a, usoPorProduto);
  const concentracaoB = calcularConcentracao(b, usoPorProduto);
  if (concentracaoA !== concentracaoB) return concentracaoA - concentracaoB;

  let indiceA = 0;
  let indiceB = 0;
  let restanteA = 0;
  let restanteB = 0;
  while (true) {
    while (restanteA === 0 && indiceA < grupos.length) restanteA = a.quantidades[indiceA++];
    while (restanteB === 0 && indiceB < grupos.length) restanteB = b.quantidades[indiceB++];
    if (restanteA === 0 || restanteB === 0) return 0;
    const grupoA = grupos[indiceA - 1];
    const grupoB = grupos[indiceB - 1];
    const chaveA = `${grupoA.produto_id}:${grupoA.venda_item_id}:${grupoA.key}`;
    const chaveB = `${grupoB.produto_id}:${grupoB.venda_item_id}:${grupoB.key}`;
    const comparacao = chaveA.localeCompare(chaveB);
    if (comparacao !== 0) return comparacao;
    const consumidas = Math.min(restanteA, restanteB);
    restanteA -= consumidas;
    restanteB -= consumidas;
  }
}

function selecionarUnidadesCompactas(gruposEntrada, targetCents, opts = {}) {
  const grupos = [...(Array.isArray(gruposEntrada) ? gruposEntrada : [])]
    .filter((grupo) => Number(grupo.quantidade_unidades || 0) > 0 && Number(grupo.valor_cents || 0) > 0)
    .sort(compararUnidade);
  const capacidadeCents = grupos.reduce(
    (soma, grupo) => soma + Number(grupo.quantidade_unidades) * Number(grupo.valor_cents),
    0
  );
  const alvo = Math.max(0, Number(targetCents || 0));
  const usoPorProduto = opts.usoPorProduto instanceof Map ? opts.usoPorProduto : new Map();
  const metricasExecucao = opts.metricasExecucao || null;
  if (alvo > capacidadeCents) {
    return { selecionadasAgrupadas: [], somaCents: 0, capacidadeCents };
  }

  const maiorUnidade = grupos.reduce((maior, grupo) => Math.max(maior, Number(grupo.valor_cents)), 0);
  const limiteBusca = Math.min(capacidadeCents, alvo + Math.max(0, maiorUnidade - 1));
  const dp = new Map([[0, {
    soma: 0,
    quantidades: Array(grupos.length).fill(0),
    produtos: new Set(),
    quantidadePorProduto: new Map(),
    unidades: 0
  }]]);
  const blocos = [];

  for (let indice = 0; indice < grupos.length; indice += 1) {
    let restante = Number(grupos[indice].quantidade_unidades);
    let bloco = 1;
    while (restante > 0) {
      const quantidade = Math.min(bloco, restante);
      blocos.push({ indice, quantidade, valor: quantidade * Number(grupos[indice].valor_cents) });
      restante -= quantidade;
      bloco *= 2;
    }
  }

  for (const bloco of blocos) {
    const estados = [...dp.entries()];
    if (metricasExecucao) {
      metricasExecucao.estadosAvaliados = (metricasExecucao.estadosAvaliados || 0) + estados.length;
    }
    for (const [somaAtual, estado] of estados) {
      if (metricasExecucao) {
        metricasExecucao.transicoesAvaliadas = (metricasExecucao.transicoesAvaliadas || 0) + 1;
      }
      const soma = somaAtual + bloco.valor;
      if (soma > limiteBusca) continue;
      const quantidades = [...estado.quantidades];
      const grupo = grupos[bloco.indice];
      const produtoId = Number(grupo.produto_id);
      const primeiraDoProduto = !estado.produtos.has(produtoId);
      quantidades[bloco.indice] += bloco.quantidade;
      const produtos = new Set(estado.produtos);
      if (primeiraDoProduto) produtos.add(produtoId);
      const quantidadePorProduto = new Map(estado.quantidadePorProduto);
      quantidadePorProduto.set(
        produtoId,
        (quantidadePorProduto.get(produtoId) || 0)
          + Number(grupo.quantidade_por_unidade || 0) * bloco.quantidade
      );
      const proximo = {
        soma,
        quantidades,
        produtos,
        quantidadePorProduto,
        unidades: estado.unidades + bloco.quantidade
      };
      const existente = dp.get(soma);
      if (!existente || compararEstadoCompacto(proximo, existente, grupos, usoPorProduto) < 0) {
        dp.set(soma, proximo);
      }
    }
    if (metricasExecucao) {
      metricasExecucao.maxEstados = Math.max(metricasExecucao.maxEstados || 0, dp.size);
    }
  }

  let melhor = null;
  for (const [soma, estado] of dp) {
    if (soma < alvo) continue;
    if (!melhor) {
      melhor = estado;
      continue;
    }
    const excesso = soma - alvo;
    const melhorExcesso = melhor.soma - alvo;
    if (excesso < melhorExcesso || (
      excesso === melhorExcesso
      && compararEstadoCompacto(estado, melhor, grupos, usoPorProduto) < 0
    )) {
      melhor = estado;
    }
  }

  if (!melhor) return { selecionadasAgrupadas: [], somaCents: 0, capacidadeCents };
  const selecionadasAgrupadas = grupos
    .map((grupo, indice) => ({ ...grupo, quantidade_selecionada: melhor.quantidades[indice] }))
    .filter((grupo) => grupo.quantidade_selecionada > 0);
  return { selecionadasAgrupadas, somaCents: melhor.soma, capacidadeCents };
}

function expandirGruposSelecionados(grupos) {
  const unidades = [];
  for (const grupo of Array.isArray(grupos) ? grupos : []) {
    const quantidade = Number(grupo.quantidade_selecionada || grupo.quantidade_unidades || 0);
    for (let indice = 0; indice < quantidade; indice += 1) {
      unidades.push({
        produto_id: grupo.produto_id,
        nome: grupo.nome,
        unidade: grupo.unidade,
        venda_id: grupo.venda_id,
        venda_item_id: grupo.venda_item_id,
        key: `${grupo.key}:${indice}`,
        quantidade: Number(grupo.quantidade_por_unidade),
        unit_cents: Number(grupo.unit_cents),
        valor_cents: Number(grupo.valor_cents),
        fracionado: Boolean(grupo.fracionado)
      });
    }
  }
  return unidades;
}

function expandirUnidades(lotes) {
  return expandirGruposSelecionados(agruparUnidades(lotes));
}

function selecionarUnidades(unidades, targetCents, opts = {}) {
  const resultado = selecionarUnidadesCompactas(
    agruparUnidadesExpandidas(unidades),
    targetCents,
    opts
  );
  return {
    selecionadas: expandirGruposSelecionados(resultado.selecionadasAgrupadas),
    somaCents: resultado.somaCents,
    capacidadeCents: resultado.capacidadeCents
  };
}

/**
 * Empacota unidades selecionadas em vendas próximas ao valor-alvo (sugestão).
 */
function empacotarVendas(selecionadas, opts = {}) {
  const valorAlvo = Math.max(1, toCentavos(opts.valorAlvo != null ? opts.valorAlvo : DEFAULTS_DISTRIBUICAO.valorAlvo));
  const valorMin = Math.max(1, toCentavos(opts.valorMin != null ? opts.valorMin : DEFAULTS_DISTRIBUICAO.valorMin));
  const valorMax = Math.max(valorMin, toCentavos(opts.valorMax != null ? opts.valorMax : DEFAULTS_DISTRIBUICAO.valorMax));
  const modoRealista = opts.distribuicaoRealista !== false;

  let sugerirAlvoCentavos = null;
  if (modoRealista) {
    try {
      sugerirAlvoCentavos = require('../homologacao/GeradorVendasRealistas').sugerirAlvoCentavos;
    } catch (_) {
      sugerirAlvoCentavos = null;
    }
  }

  const fila = [...selecionadas];
  const vendas = [];
  let seq = 0;

  while (fila.length) {
    seq += 1;
    const restanteTotal = fila.reduce((s, u) => s + u.valor_cents, 0);
    let desejado;
    if (restanteTotal <= valorMax) {
      desejado = restanteTotal;
    } else if (typeof sugerirAlvoCentavos === 'function') {
      desejado = sugerirAlvoCentavos({
        sequencia: seq,
        seed: opts.seedRealista != null ? opts.seedRealista : 0,
        valorMin: valorMin / 100,
        valorMax: valorMax / 100,
        valorAlvo: valorAlvo / 100
      });
      desejado = Math.min(desejado, valorMax, restanteTotal);
      if (desejado < valorMin && restanteTotal >= valorMin) {
        desejado = Math.min(Math.max(desejado, valorMin), restanteTotal);
      }
    } else {
      desejado = Math.min(valorAlvo, valorMax, restanteTotal);
      if (desejado < valorMin && restanteTotal >= valorMin) desejado = Math.min(valorMin, restanteTotal);
    }

    const itensMap = new Map();
    let montado = 0;
    const usadosIdx = [];

    for (let i = 0; i < fila.length; i += 1) {
      const u = fila[i];
      if (montado >= desejado) break;
      if (montado + u.valor_cents > desejado && montado > 0) {
        // pula se estourar e já temos algo — tenta menores depois
        continue;
      }
      if (montado + u.valor_cents > desejado && montado === 0 && u.valor_cents > desejado) {
        // unidade maior que desejado: só aceita se for o restante total desta venda forçada
        if (restanteTotal === u.valor_cents || u.valor_cents <= valorMax) {
          // ok pegar
        } else {
          continue;
        }
      }
      if (montado + u.valor_cents > desejado && montado === 0) {
        // força pegar para não travar
      } else if (montado + u.valor_cents > desejado) {
        continue;
      }

      montado += u.valor_cents;
      usadosIdx.push(i);
      const k = `${u.produto_id}|${u.venda_item_id}|${u.unit_cents}`;
      const prev = itensMap.get(k) || {
        produto_id: u.produto_id,
        nome: u.nome,
        unidade: u.unidade,
        venda_origem_id: u.venda_id,
        venda_item_origem_id: u.venda_item_id,
        quantidade: 0,
        valor_unitario: arredondarMoeda(u.unit_cents / 100),
        valor_cents: 0
      };
      prev.quantidade = arredondarMoeda(prev.quantidade + Number(u.quantidade || 0));
      prev.valor_cents += u.valor_cents;
      itensMap.set(k, prev);
    }

    // se nada coube no filtro estrito, pega a primeira unidade
    if (!usadosIdx.length && fila.length) {
      const u = fila[0];
      montado = u.valor_cents;
      usadosIdx.push(0);
      itensMap.set(`${u.produto_id}|${u.venda_item_id}|${u.unit_cents}`, {
        produto_id: u.produto_id,
        nome: u.nome,
        unidade: u.unidade,
        venda_origem_id: u.venda_id,
        venda_item_origem_id: u.venda_item_id,
        quantidade: Number(u.quantidade || 0),
        valor_unitario: arredondarMoeda(u.unit_cents / 100),
        valor_cents: u.valor_cents
      });
    }

    // remove de trás pra frente
    for (let j = usadosIdx.length - 1; j >= 0; j -= 1) {
      fila.splice(usadosIdx[j], 1);
    }

    const itens = [...itensMap.values()].map((it, ordem) => ({
      produto_id: it.produto_id,
      nome: it.nome,
      unidade: it.unidade,
      venda_origem_id: it.venda_origem_id,
      venda_item_origem_id: it.venda_item_origem_id,
      quantidade: it.quantidade,
      valor_unitario: it.valor_unitario,
      valor_total: arredondarMoeda(it.valor_cents / 100),
      valor: arredondarMoeda(it.valor_cents / 100),
      ordem
    }));

    const brutoCents = montado;
    const valorAlvoDaVenda = Math.min(Math.max(1, toCentavos(opts.valorAlvo != null ? opts.valorAlvo : DEFAULTS_DISTRIBUICAO.valorAlvo)), valorMax);
    const descontoCents = Math.max(0, brutoCents - valorAlvoDaVenda);
    const valorFinalCents = Math.max(0, brutoCents - descontoCents);

    vendas.push({
      sequencia: seq,
      rotulo: `Venda Fiscal ${String(seq).padStart(3, '0')}`,
      valor: arredondarMoeda(montado / 100),
      valor_final: arredondarMoeda(valorFinalCents / 100),
      desconto: arredondarMoeda(descontoCents / 100),
      quantidade_itens: itens.length,
      itens
    });
  }

  return vendas;
}

function criarVendaDeGrupos(selecionadas, opts = {}) {
  const itensMap = new Map();
  let brutoCents = 0;
  for (const grupo of selecionadas) {
    const quantidade = Number(grupo.quantidade_selecionada || 0);
    if (!(quantidade > 0)) continue;
    const valorCents = Number(grupo.valor_cents || 0) * quantidade;
    brutoCents += valorCents;
    const chave = `${grupo.produto_id}|${grupo.venda_item_id}|${grupo.unit_cents}`;
    const item = itensMap.get(chave) || {
      produto_id: grupo.produto_id,
      nome: grupo.nome,
      unidade: grupo.unidade,
      venda_origem_id: grupo.venda_id,
      venda_item_origem_id: grupo.venda_item_id,
      quantidade: 0,
      valor_unitario: arredondarMoeda(grupo.unit_cents / 100),
      valor_cents: 0
    };
    item.quantidade = arredondarMoeda(
      item.quantidade + Number(grupo.quantidade_por_unidade || 0) * quantidade
    );
    item.valor_cents += valorCents;
    itensMap.set(chave, item);
  }

  const itens = [...itensMap.values()].map((item, ordem) => ({
    produto_id: item.produto_id,
    nome: item.nome,
    unidade: item.unidade,
    venda_origem_id: item.venda_origem_id,
    venda_item_origem_id: item.venda_item_origem_id,
    quantidade: item.quantidade,
    valor_unitario: item.valor_unitario,
    valor_total: arredondarMoeda(item.valor_cents / 100),
    valor: arredondarMoeda(item.valor_cents / 100),
    ordem
  }));
  const alvoCents = Math.max(0, toCentavos(opts.valorAlvo || 0));
  const descontoCents = Math.max(0, brutoCents - alvoCents);
  return {
    sequencia: Number(opts.sequencia || 1),
    rotulo: `Venda Fiscal ${String(Number(opts.sequencia || 1)).padStart(3, '0')}`,
    valor: arredondarMoeda(brutoCents / 100),
    valor_final: arredondarMoeda((brutoCents - descontoCents) / 100),
    desconto: arredondarMoeda(descontoCents / 100),
    quantidade_itens: itens.length,
    itens
  };
}

function empacotarVendaUnicaAgrupada(selecionadasAgrupadas, opts = {}) {
  const venda = criarVendaDeGrupos(selecionadasAgrupadas, opts);
  return venda && venda.itens.length ? [venda] : [];
}

function empacotarVendaUnica(selecionadas, opts = {}) {
  const grupos = agruparUnidadesExpandidas(selecionadas).map((grupo) => ({
    ...grupo,
    quantidade_selecionada: grupo.quantidade_unidades
  }));
  return empacotarVendaUnicaAgrupada(grupos, opts);
}

function empacotarVendasAgrupadas(selecionadasAgrupadas, opts = {}) {
  const valorAlvo = Math.max(1, toCentavos(opts.valorAlvo != null ? opts.valorAlvo : DEFAULTS_DISTRIBUICAO.valorAlvo));
  const valorMin = Math.max(1, toCentavos(opts.valorMin != null ? opts.valorMin : DEFAULTS_DISTRIBUICAO.valorMin));
  const valorMax = Math.max(valorMin, toCentavos(opts.valorMax != null ? opts.valorMax : DEFAULTS_DISTRIBUICAO.valorMax));
  const modoRealista = opts.distribuicaoRealista !== false;
  let sugerirAlvoCentavos = null;
  if (modoRealista) {
    try {
      sugerirAlvoCentavos = require('../homologacao/GeradorVendasRealistas').sugerirAlvoCentavos;
    } catch (_) {
      sugerirAlvoCentavos = null;
    }
  }

  let fila = [...(selecionadasAgrupadas || [])]
    .map((grupo) => ({ ...grupo, restante: Number(grupo.quantidade_selecionada || 0) }))
    .filter((grupo) => grupo.restante > 0)
    .sort((a, b) => {
      if (a.produto_id !== b.produto_id) return a.produto_id - b.produto_id;
      if (a.venda_item_id !== b.venda_item_id) return a.venda_item_id - b.venda_item_id;
      return String(a.key).localeCompare(String(b.key));
    });
  const vendas = [];
  let sequencia = 0;

  while (fila.length) {
    sequencia += 1;
    const restanteTotal = fila.reduce((soma, grupo) =>
      soma + grupo.restante * Number(grupo.valor_cents), 0);
    let desejado;
    if (restanteTotal <= valorMax) {
      desejado = restanteTotal;
    } else if (typeof sugerirAlvoCentavos === 'function') {
      desejado = sugerirAlvoCentavos({
        sequencia,
        seed: opts.seedRealista != null ? opts.seedRealista : 0,
        valorMin: valorMin / 100,
        valorMax: valorMax / 100,
        valorAlvo: valorAlvo / 100
      });
      desejado = Math.min(desejado, valorMax, restanteTotal);
      if (desejado < valorMin && restanteTotal >= valorMin) {
        desejado = Math.min(Math.max(desejado, valorMin), restanteTotal);
      }
    } else {
      desejado = Math.min(valorAlvo, valorMax, restanteTotal);
      if (desejado < valorMin && restanteTotal >= valorMin) desejado = Math.min(valorMin, restanteTotal);
    }

    let montado = 0;
    const quantidadesPorIndice = new Map();
    for (let indice = 0; indice < fila.length; indice += 1) {
      const grupo = fila[indice];
      if (montado >= desejado) break;
      const valorUnidade = Number(grupo.valor_cents);
      let quantidade = Math.min(
        grupo.restante,
        Math.floor((desejado - montado) / valorUnidade)
      );
      if (quantidade <= 0 && montado === 0 && valorUnidade > desejado) {
        if (restanteTotal === valorUnidade || valorUnidade <= valorMax) quantidade = 1;
      }
      if (!(quantidade > 0)) continue;
      quantidadesPorIndice.set(indice, quantidade);
      montado += quantidade * valorUnidade;
    }

    if (quantidadesPorIndice.size === 0 && fila.length) {
      quantidadesPorIndice.set(0, 1);
      montado = Number(fila[0].valor_cents);
    }

    const gruposVenda = [...quantidadesPorIndice.entries()].map(([indice, quantidade]) => ({
      ...fila[indice],
      quantidade_selecionada: quantidade
    }));
    vendas.push(criarVendaDeGrupos(gruposVenda, { sequencia, valorAlvo }));
    for (const [indice, quantidade] of quantidadesPorIndice) fila[indice].restante -= quantidade;
    fila = fila.filter((grupo) => grupo.restante > 0);
  }

  return vendas;
}

function consolidarPorProduto(vendas, lotesOuProdutos) {
  const base = new Map();
  for (const p of Array.isArray(lotesOuProdutos) ? lotesOuProdutos : []) {
    const pid = Number(p.produto_id);
    if (!base.has(pid)) {
      base.set(pid, {
        produto_id: pid,
        nome: p.nome,
        quantidade_vendida: Number(p.quantidade_disponivel || p.quantidade_vendida_no_dia || 0),
        valor_vendido: Number(p.valor_vendido_no_dia || p.valor_disponivel || 0),
        quantidade_utilizada: 0,
        valor_utilizado: 0
      });
    } else if (p.valor_disponivel != null) {
      // lotes agregados
      const b = base.get(pid);
      b.quantidade_vendida = arredondarMoeda(b.quantidade_vendida + Number(p.quantidade_disponivel || 0));
      b.valor_vendido = arredondarMoeda(b.valor_vendido + Number(p.valor_disponivel || 0));
    }
  }

  for (const v of vendas) {
    for (const it of v.itens || []) {
      const b = base.get(Number(it.produto_id)) || {
        produto_id: Number(it.produto_id),
        nome: it.nome,
        quantidade_vendida: 0,
        valor_vendido: 0,
        quantidade_utilizada: 0,
        valor_utilizado: 0
      };
      b.quantidade_utilizada = arredondarMoeda(b.quantidade_utilizada + Number(it.quantidade || 0));
      b.valor_utilizado = arredondarMoeda(b.valor_utilizado + Number(it.valor_total || it.valor || 0));
      base.set(Number(it.produto_id), b);
    }
  }

  return [...base.values()].sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
}

/**
 * @param {object[]} lotesOuProdutos — preferir lotes Sprint 02; aceita produtos agregados (compat S01)
 * @param {number} valorInformado
 * @param {object} [opts]
 */
function gerarPreviaDistribuicao(lotesOuProdutos, valorInformado, opts = {}) {
  const t0 = Date.now();
  const metricasExecucao = opts.metricasExecucao || {};
  const valorAlvo = Number(opts.valorAlvo != null ? opts.valorAlvo : DEFAULTS_DISTRIBUICAO.valorAlvo);
  const valorMin = Number(opts.valorMin != null ? opts.valorMin : DEFAULTS_DISTRIBUICAO.valorMin);
  const valorMax = Number(opts.valorMax != null ? opts.valorMax : DEFAULTS_DISTRIBUICAO.valorMax);

  const alvoCents = toCentavos(valorInformado);
  const empty = (extra = {}) => ({
    vendas: [],
    itensUtilizados: [],
    porProduto: [],
    valor_informado: arredondarMoeda(alvoCents / 100),
    valor_distribuido: 0,
    valor_final: 0,
    desconto: 0,
    diferenca: arredondarMoeda(alvoCents / 100),
    valor_elegivel: 0,
    quantidade_vendas: 0,
    perfeita: false,
    incompleta: alvoCents > 0,
    mensagem: extra.mensagem || null,
    codigo: extra.codigo || null,
    metricas: {
      produtos_elegiveis: 0,
      linhas_elegiveis: 0,
      grupos: metricasExecucao.grupos || 0,
      estados_avaliados: metricasExecucao.estadosAvaliados || 0,
      transicoes_avaliadas: metricasExecucao.transicoesAvaliadas || 0,
      max_estados: metricasExecucao.maxEstados || 0,
      tempo_ms: Date.now() - t0
    },
    ...extra
  });

  if (!(alvoCents > 0)) {
    return empty({
      valor_informado: 0,
      diferenca: 0,
      incompleta: false,
      mensagem: 'Informe um valor recebido nas máquinas para gerar a prévia.',
      codigo: 'VALOR_ZERO'
    });
  }

  // Normaliza entrada: lotes ou produtos com .lotes
  let lotes = [];
  const entrada = Array.isArray(lotesOuProdutos) ? lotesOuProdutos : [];
  if (entrada.length && entrada[0].venda_item_id != null) {
    lotes = entrada;
  } else {
    for (const p of entrada) {
      if (Array.isArray(p.lotes) && p.lotes.length) {
        lotes.push(...p.lotes);
      } else {
        const qtd = Number(p.quantidade_disponivel || 0);
        const valor = Number(p.valor_vendido_no_dia || 0);
        if (!(qtd > 0) || !(valor > 0)) continue;
        const unit = Number(p.preco_unitario) > 0
          ? Number(p.preco_unitario)
          : arredondarMoeda(valor / qtd);
        lotes.push({
          venda_item_id: Number(p.produto_id) || 0,
          venda_id: 0,
          produto_id: Number(p.produto_id || p.id),
          nome: p.nome,
          unidade: 'UN',
          fracionado: !Number.isInteger(qtd),
          quantidade_disponivel: qtd,
          valor_disponivel: valor,
          preco_unitario: unit,
          unit_cents: toCentavos(unit)
        });
      }
    }
  }

  const grupos = agruparUnidades(lotes);
  metricasExecucao.grupos = grupos.length;
  const capacidadeCents = grupos.reduce(
    (soma, grupo) => soma + grupo.quantidade_unidades * grupo.valor_cents,
    0
  );
  const valorElegivel = arredondarMoeda(capacidadeCents / 100);

  if (!(capacidadeCents > 0)) {
    return empty({
      valor_elegivel: 0,
      mensagem: 'Não há produtos fiscais elegíveis vendidos no dia para composição.',
      codigo: 'SEM_ELEGIVEIS'
    });
  }

  if (alvoCents > capacidadeCents) {
    return empty({
      valor_informado: arredondarMoeda(alvoCents / 100),
      valor_elegivel: valorElegivel,
      diferenca: arredondarMoeda(alvoCents / 100),
      incompleta: true,
      mensagem:
        `Não foi possível distribuir o valor informado com a capacidade fiscal disponível.\n` +
        `Valor informado: R$ ${(alvoCents / 100).toFixed(2)}\n` +
        `Valor máximo elegível: R$ ${valorElegivel.toFixed(2)}`,
      codigo: 'ABAIXO_DO_ALVO',
      metricas: {
        produtos_elegiveis: new Set(lotes.map((l) => l.produto_id)).size,
        linhas_elegiveis: lotes.length,
        unidades_consideradas: grupos.reduce((soma, grupo) => soma + grupo.quantidade_unidades, 0),
        tempo_ms: Date.now() - t0
      }
    });
  }

  const { selecionadasAgrupadas, somaCents } = selecionarUnidadesCompactas(grupos, alvoCents, {
    metricasExecucao
  });

  if (somaCents === 0 || somaCents < alvoCents) {
    const todasMaiores = grupos.length > 0 && grupos.every((grupo) => grupo.valor_cents > alvoCents);
    return empty({
      valor_informado: arredondarMoeda(alvoCents / 100),
      valor_elegivel: valorElegivel,
      diferenca: arredondarMoeda(alvoCents / 100),
      incompleta: true,
      mensagem: todasMaiores
        ? `Não foi possível distribuir o valor informado sem fracionar unidades.\n` +
          `Valor informado: R$ ${(alvoCents / 100).toFixed(2)}\n` +
          `Menor unidade disponível: R$ ${(Math.min(...grupos.map((grupo) => grupo.valor_cents)) / 100).toFixed(2)}`
        : 'Não foi possível montar a prévia com os produtos elegíveis do dia.',
      codigo: todasMaiores ? 'UNIDADE_SUPERIOR' : 'DISTRIBUICAO_FALHOU',
      metricas: {
        produtos_elegiveis: new Set(lotes.map((l) => l.produto_id)).size,
        linhas_elegiveis: lotes.length,
        tempo_ms: Date.now() - t0
      }
    });
  }

  const vendas = empacotarVendasAgrupadas(selecionadasAgrupadas, {
    valorAlvo,
    valorMin,
    valorMax,
    seedRealista: opts.seedRealista,
    distribuicaoRealista: opts.distribuicaoRealista
  });

  let somaVendas = vendas.reduce((s, v) => s + toCentavos(v.valor), 0);
  if (somaVendas !== somaCents && vendas.length) {
    const delta = somaCents - somaVendas;
    const last = vendas[vendas.length - 1];
    last.valor = arredondarMoeda(last.valor + delta / 100);
    if (last.itens && last.itens.length) {
      const li = last.itens[last.itens.length - 1];
      li.valor_total = arredondarMoeda(li.valor_total + delta / 100);
      li.valor = li.valor_total;
    }
    somaVendas = somaCents;
  }

  const descontoCents = Math.max(0, somaCents - alvoCents);
  let descontoRestanteCents = descontoCents;
  for (const venda of vendas) {
    const brutoVendaCents = toCentavos(venda.valor);
    const descontoVendaCents = Math.min(brutoVendaCents, descontoRestanteCents);
    venda.desconto = arredondarMoeda(descontoVendaCents / 100);
    venda.valor_final = arredondarMoeda((brutoVendaCents - descontoVendaCents) / 100);
    descontoRestanteCents -= descontoVendaCents;
  }

  const porProduto = consolidarPorProduto(vendas, lotes);
  const valorFinalCents = vendas.reduce((soma, venda) => soma + toCentavos(venda.valor_final), 0);
  const perfeita = valorFinalCents === alvoCents;

  return {
    vendas,
    itensUtilizados: porProduto.map((p) => ({
      produto_id: p.produto_id,
      nome: p.nome,
      quantidade_utilizada: p.quantidade_utilizada,
      valor_utilizado: p.valor_utilizado
    })),
    porProduto,
    valor_informado: arredondarMoeda(alvoCents / 100),
    valor_distribuido: arredondarMoeda(somaCents / 100),
    valor_final: arredondarMoeda(valorFinalCents / 100),
    desconto: arredondarMoeda(descontoCents / 100),
    diferenca: arredondarMoeda((alvoCents - valorFinalCents) / 100),
    valor_elegivel: valorElegivel,
    quantidade_vendas: vendas.length,
    perfeita,
    incompleta: !perfeita,
    mensagem: perfeita
      ? (descontoCents > 0
        ? `Distribuição concluída com desconto de R$ ${arredondarMoeda(descontoCents / 100).toFixed(2)}.`
        : 'Valor informado e valor distribuído estão iguais.')
      : `Distribuição incompleta. Diferença: R$ ${arredondarMoeda((alvoCents - valorFinalCents) / 100).toFixed(2)}`,
    codigo: perfeita ? 'OK' : 'DIFERENCA',
    metricas: {
      produtos_elegiveis: new Set(lotes.map((l) => l.produto_id)).size,
      linhas_elegiveis: lotes.length,
      unidades_selecionadas: selecionadasAgrupadas.reduce(
        (soma, grupo) => soma + grupo.quantidade_selecionada,
        0
      ),
      grupos: grupos.length,
      estados_avaliados: metricasExecucao.estadosAvaliados || 0,
      transicoes_avaliadas: metricasExecucao.transicoesAvaliadas || 0,
      max_estados: metricasExecucao.maxEstados || 0,
      tempo_ms: Date.now() - t0,
      valor_alvo_sugerido: valorAlvo,
      valor_min_sugerido: valorMin,
      valor_max_sugerido: valorMax
    }
  };
}

module.exports = {
  gerarPreviaDistribuicao,
  agruparUnidades,
  expandirUnidades,
  selecionarUnidadesCompactas,
  selecionarUnidades,
  empacotarVendasAgrupadas,
  empacotarVendas,
  empacotarVendaUnicaAgrupada,
  empacotarVendaUnica,
  consolidarPorProduto
};
