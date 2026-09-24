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
function expandirUnidades(lotes) {
  const unidades = [];
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
      for (let i = 0; i < n; i += 1) {
        const valorFiscalCents = baseCents + (i < restoCents ? 1 : 0);
        if (!(valorFiscalCents > 0)) continue;
        unidades.push({
          key: `${lote.venda_item_id}:${i}`,
          produto_id: lote.produto_id,
          nome: lote.nome,
          unidade: lote.unidade || 'UN',
          venda_id: lote.venda_id,
          venda_item_id: lote.venda_item_id,
          quantidade: 1,
          unit_cents: valorFiscalCents,
          valor_cents: valorFiscalCents,
          fracionado: false
        });
      }
    } else {
      // Fracionado: fatias de 0,001 da quantidade original (máx 5000 fatias por lote)
      const mil = Math.round(qtd * 1000);
      const fatias = Math.min(Math.max(mil, 0), 5000);
      if (fatias <= 0) continue;
      const valorTotalCents = toCentavos(lote.valor_disponivel != null
        ? lote.valor_disponivel
        : (qtd * (unitCents / 100)));
      // Distribui centavos pelas fatias sem perder resto
      let restanteCents = valorTotalCents;
      for (let i = 0; i < fatias; i += 1) {
        const left = fatias - i;
        const sliceCents = Math.floor(restanteCents / left);
        restanteCents -= sliceCents;
        if (sliceCents <= 0) continue;
        unidades.push({
          key: `${lote.venda_item_id}:f${i}`,
          produto_id: lote.produto_id,
          nome: lote.nome,
          unidade: lote.unidade || 'KG',
          venda_id: lote.venda_id,
          venda_item_id: lote.venda_item_id,
          quantidade: arredondarMoeda(qtd / fatias),
          unit_cents: unitCents,
          valor_cents: sliceCents,
          fracionado: true
        });
      }
    }
  }

  return unidades;
}

/**
 * Seleciona unidades cujo valor soma exatamente targetCents (ou o máximo possível ≤ target).
 * Determinístico: ordena por valor, produto, venda_item, key.
 */
function selecionarUnidades(unidades, targetCents) {
  const ordenadas = [...unidades].sort((a, b) => {
    if (a.valor_cents !== b.valor_cents) return a.valor_cents - b.valor_cents;
    if (a.produto_id !== b.produto_id) return a.produto_id - b.produto_id;
    if (a.venda_item_id !== b.venda_item_id) return a.venda_item_id - b.venda_item_id;
    return String(a.key).localeCompare(String(b.key));
  });

  const capacidade = ordenadas.reduce((s, u) => s + u.valor_cents, 0);
  const alvo = Math.min(targetCents, capacidade);

  // 1) greedy: pega as menores primeiro (facilita fechamento exato e equilíbrio)
  const escolhidas = [];
  let soma = 0;
  for (const u of ordenadas) {
    if (u.valor_cents > alvo) continue; // unidade > alvo total: nunca quebrar
    if (soma + u.valor_cents <= alvo) {
      escolhidas.push(u);
      soma += u.valor_cents;
    }
  }

  if (soma === alvo) {
    return { selecionadas: escolhidas, somaCents: soma, capacidadeCents: capacidade };
  }

  // 2) tenta completar com unidades restantes (maior que caiba)
  const usados = new Set(escolhidas.map((u) => u.key));
  const restantes = ordenadas.filter((u) => !usados.has(u.key) && u.valor_cents <= alvo);
  restantes.sort((a, b) => b.valor_cents - a.valor_cents || a.produto_id - b.produto_id);

  for (const u of restantes) {
    if (soma + u.valor_cents <= alvo) {
      escolhidas.push(u);
      soma += u.valor_cents;
      if (soma === alvo) break;
    }
  }

  // 3) se ainda faltar, tenta trocar a última unidade por outra que feche
  if (soma < alvo && escolhidas.length) {
    const falta = alvo - soma;
    const cand = restantes.find((u) => !escolhidas.some((e) => e.key === u.key) && u.valor_cents === falta);
    if (cand) {
      escolhidas.push(cand);
      soma += cand.valor_cents;
    } else {
      // remove uma unidade e tenta repor com combinação que feche melhor
      for (let i = escolhidas.length - 1; i >= 0 && soma !== alvo; i -= 1) {
        const removida = escolhidas[i];
        const novaSomaBase = soma - removida.valor_cents;
        const precisa = alvo - novaSomaBase;
        const substituta = restantes.find(
          (u) => u.key !== removida.key
            && !escolhidas.some((e) => e.key === u.key)
            && u.valor_cents === precisa
        );
        if (substituta) {
          escolhidas.splice(i, 1, substituta);
          soma = novaSomaBase + substituta.valor_cents;
          break;
        }
      }
    }
  }

  escolhidas.sort((a, b) => {
    if (a.produto_id !== b.produto_id) return a.produto_id - b.produto_id;
    if (a.venda_item_id !== b.venda_item_id) return a.venda_item_id - b.venda_item_id;
    return String(a.key).localeCompare(String(b.key));
  });

  return { selecionadas: escolhidas, somaCents: soma, capacidadeCents: capacidade };
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

    vendas.push({
      sequencia: seq,
      rotulo: `Venda Fiscal ${String(seq).padStart(3, '0')}`,
      valor: arredondarMoeda(montado / 100),
      quantidade_itens: itens.length,
      itens
    });
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

  const unidades = expandirUnidades(lotes);
  const capacidadeCents = unidades.reduce((s, u) => s + u.valor_cents, 0);
  const valorElegivel = arredondarMoeda(capacidadeCents / 100);

  if (!(capacidadeCents > 0)) {
    return empty({
      valor_elegivel: 0,
      mensagem: 'Não há produtos fiscais elegíveis vendidos no dia para composição.',
      codigo: 'SEM_ELEGIVEIS'
    });
  }

  if (alvoCents > capacidadeCents) {
    const { selecionadas, somaCents } = selecionarUnidades(unidades, capacidadeCents);
    const vendas = empacotarVendas(selecionadas, {
      valorAlvo,
      valorMin,
      valorMax,
      seedRealista: opts.seedRealista,
      distribuicaoRealista: opts.distribuicaoRealista
    });
    const porProduto = consolidarPorProduto(vendas, lotes);
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
      diferenca: arredondarMoeda((alvoCents - somaCents) / 100),
      valor_elegivel: valorElegivel,
      quantidade_vendas: vendas.length,
      perfeita: false,
      incompleta: true,
      mensagem:
        `Não foi possível distribuir integralmente o valor informado.\n` +
        `Valor informado: R$ ${(alvoCents / 100).toFixed(2)}\n` +
        `Valor máximo elegível: R$ ${valorElegivel.toFixed(2)}\n` +
        `Diferença: R$ ${((alvoCents - somaCents) / 100).toFixed(2)}`,
      codigo: 'CAPACIDADE_INSUFICIENTE',
      metricas: {
        produtos_elegiveis: new Set(lotes.map((l) => l.produto_id)).size,
        linhas_elegiveis: lotes.length,
        unidades_consideradas: unidades.length,
        tempo_ms: Date.now() - t0
      }
    };
  }

  const { selecionadas, somaCents } = selecionarUnidades(unidades, alvoCents);

  if (somaCents === 0) {
    const todasMaiores = unidades.length > 0 && unidades.every((u) => u.valor_cents > alvoCents);
    return empty({
      valor_informado: arredondarMoeda(alvoCents / 100),
      valor_elegivel: valorElegivel,
      diferenca: arredondarMoeda(alvoCents / 100),
      incompleta: true,
      mensagem: todasMaiores
        ? `Não foi possível distribuir o valor informado sem fracionar unidades.\n` +
          `Valor informado: R$ ${(alvoCents / 100).toFixed(2)}\n` +
          `Menor unidade disponível: R$ ${(Math.min(...unidades.map((u) => u.valor_cents)) / 100).toFixed(2)}`
        : 'Não foi possível montar a prévia com os produtos elegíveis do dia.',
      codigo: todasMaiores ? 'UNIDADE_SUPERIOR' : 'DISTRIBUICAO_FALHOU',
      metricas: {
        produtos_elegiveis: new Set(lotes.map((l) => l.produto_id)).size,
        linhas_elegiveis: lotes.length,
        tempo_ms: Date.now() - t0
      }
    });
  }

  const vendas = empacotarVendas(selecionadas, {
    valorAlvo,
    valorMin,
    valorMax,
    seedRealista: opts.seedRealista,
    distribuicaoRealista: opts.distribuicaoRealista
  });

  // Correção final: soma das vendas deve bater com somaCents/alvo
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

  const porProduto = consolidarPorProduto(vendas, lotes);
  const perfeita = somaCents === alvoCents;

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
    diferenca: arredondarMoeda((alvoCents - somaCents) / 100),
    valor_elegivel: valorElegivel,
    quantidade_vendas: vendas.length,
    perfeita,
    incompleta: !perfeita,
    mensagem: perfeita
      ? 'Valor informado e valor distribuído estão iguais.'
      : `Distribuição incompleta. Diferença: R$ ${arredondarMoeda((alvoCents - somaCents) / 100).toFixed(2)}`,
    codigo: perfeita ? 'OK' : 'DIFERENCA',
    metricas: {
      produtos_elegiveis: new Set(lotes.map((l) => l.produto_id)).size,
      linhas_elegiveis: lotes.length,
      unidades_selecionadas: selecionadas.length,
      tempo_ms: Date.now() - t0,
      valor_alvo_sugerido: valorAlvo,
      valor_min_sugerido: valorMin,
      valor_max_sugerido: valorMax
    }
  };
}

module.exports = {
  gerarPreviaDistribuicao,
  expandirUnidades,
  selecionarUnidades,
  empacotarVendas,
  consolidarPorProduto
};
