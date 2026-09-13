/**
 * Motor Fiscal × Não Fiscal — distribuição de estoque/valores na venda.
 *
 * Sprint 3.8B/C: suporte a Valor Fiscal Efetivo (política PRESERVAR DINHEIRO).
 * Valor Fiscal Máximo = algoritmo histórico (priorização por emitir_fiscal).
 * Valor Fiscal Efetivo ∈ [mínimo válido, máximo] quando MIDP ativo.
 *
 * Sprint 3.12: após o efetivo, valida integridade de quantidades fiscais
 * (unidades não fracionáveis nunca ficam fracionadas na composição).
 *
 * O Motor NUNCA altera total da venda, preços, descontos ou produtos.
 * RC7.10.1 / HOTFIX FISCAL-4.0.2: desconto/acréscimo comercial (Valor Fiscal Líquido)
 * são aplicados na faixa F×NF máxima ANTES do efetivo/MIDP, para a validação de
 * pagamento operar sempre sobre o líquido (nunca sobre o subtotal bruto).
 */

const {
  calcularValorFiscalLiquido,
  aplicarValorFiscalLiquidoNosItens,
  calcularValorFiscalMaximoLiquido
} = require('./vendas/valorFiscalLiquido');

function parseVendaFiscalFlag(valor) {
  return valor === true
    || valor === 'true'
    || valor === 1
    || valor === '1';
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function isFormaDinheiroFisico(forma) {
  const f = String(forma || '').toLowerCase().trim();
  return f === 'dinheiro' || f === 'cash' || f === 'especie' || f === 'espécie';
}

/** Unidades comerciais que aceitam quantidade fracionada na composição fiscal. */
const UNIDADES_FRACIONAVEIS = new Set([
  'KG', 'G', 'MG',
  'L', 'LT', 'ML',
  'M', 'MT', 'CM', 'MM',
  'M2', 'M²', 'M3', 'M³'
]);

function normalizarUnidadeMotor(unidade) {
  const raw = String(unidade || 'UN').trim();
  const lower = raw.toLowerCase();
  const map = {
    kg: 'KG', g: 'G', mg: 'MG',
    l: 'L', lt: 'LT', litro: 'L', litros: 'L', ml: 'ML',
    m: 'M', mt: 'MT', metro: 'M', metros: 'M', cm: 'CM', mm: 'MM',
    m2: 'M2', 'm²': 'M2', m3: 'M3', 'm³': 'M3'
  };
  if (map[lower]) return map[lower];
  return raw.toUpperCase().replace(/²/g, '2').replace(/³/g, '3');
}

/**
 * Produto fracionável: flag de cadastro OU unidade fracionável.
 * Ausência de flag/unidade → trata como inteiro (UN).
 */
function itemPermiteQuantidadeFracionada(item = {}) {
  if (Number(item.produto_fracionado ?? item.vendido_por_peso ?? item.produto_pesavel ?? 0) === 1) {
    return true;
  }
  const u = normalizarUnidadeMotor(item.unidade || item.produto_unidade || 'UN');
  return UNIDADES_FRACIONAVEIS.has(u);
}

function quantidadeEhInteira(q, eps = 1e-6) {
  const n = Number(q || 0);
  return Math.abs(n - Math.round(n)) <= eps;
}

function itemTemQuantidadeFiscalInvalida(item) {
  if (itemPermiteQuantidadeFracionada(item)) return false;
  const qF = Number(item.quantidade_fiscal || 0);
  if (qF <= 1e-9) return false;
  return !quantidadeEhInteira(qF);
}

function obterQtdEstoqueItem(item) {
  if (item.quantidade_estoque != null && item.quantidade_estoque !== '') {
    return Number(item.quantidade_estoque);
  }
  return Number(item.quantidade_fiscal || 0) + Number(item.quantidade_nao_fiscal || 0);
}

function obterFaixaQtdFiscalItem(item) {
  const qEstoque = obterQtdEstoqueItem(item);
  const qMin = Number(
    item.quantidade_fiscal_min != null ? item.quantidade_fiscal_min : 0
  );
  const qMax = Number(
    item.quantidade_fiscal_max != null
      ? item.quantidade_fiscal_max
      : qEstoque
  );
  return {
    qEstoque,
    qMin: Math.max(0, Math.min(qEstoque, qMin)),
    qMax: Math.max(0, Math.min(qEstoque, qMax))
  };
}

function aplicarQuantidadeFiscalNoItem(item, qFiscalNova) {
  const { qEstoque, qMin, qMax } = obterFaixaQtdFiscalItem(item);
  let qF = Number(qFiscalNova);
  if (!itemPermiteQuantidadeFracionada(item)) {
    qF = Math.round(qF);
  }
  qF = Math.max(qMin, Math.min(qMax, qF));
  qF = Math.max(0, Math.min(qEstoque, qF));
  if (!itemPermiteQuantidadeFracionada(item)) {
    qF = Math.round(qF);
    qF = Math.max(qMin, Math.min(qMax, qF));
  }

  const qNf = Number((qEstoque - qF).toFixed(6));
  const preco = Number(item.preco_unitario || 0);
  const subtotal = item.subtotal != null && item.subtotal !== ''
    ? Number(item.subtotal)
    : round2(qEstoque * preco);

  let vF;
  let vNf;
  if (qEstoque > 0 && Math.abs(qEstoque - Number(item.quantidade || qEstoque)) > 1e-9) {
    // quantidade_estoque ≠ quantidade venda: rateia subtotal
    vF = round2(subtotal * (qF / qEstoque));
    vNf = round2(subtotal - vF);
  } else {
    vF = round2(qF * preco);
    vNf = round2(subtotal - vF);
  }

  item.quantidade_fiscal = itemPermiteQuantidadeFracionada(item)
    ? Number(qF.toFixed(6))
    : qF;
  item.quantidade_nao_fiscal = qNf;
  item.valor_fiscal = vF;
  item.valor_nao_fiscal = vNf;
  return item;
}

/**
 * Maior composição inteira com totalFiscal <= metaAlvo (PASSO 1 — reduzir).
 * Itens fracionáveis permanecem intactos.
 */
function montarComposicaoFiscalInteiraAbaixo(itens, metaAlvo) {
  const saida = itens.map((i) => ({ ...i }));
  const meta = round2(metaAlvo);

  const fiscalFracionavel = round2(
    saida
      .filter((i) => itemPermiteQuantidadeFracionada(i))
      .reduce((s, i) => s + Number(i.valor_fiscal || 0), 0)
  );

  const slots = saida
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => !itemPermiteQuantidadeFracionada(item))
    .map(({ item, idx }) => {
      const { qMin, qMax } = obterFaixaQtdFiscalItem(item);
      return {
        idx,
        qMin: Math.ceil(qMin - 1e-9),
        qMax: Math.floor(qMax + 1e-9),
        preco: Number(item.preco_unitario || 0)
      };
    });

  if (!slots.length) {
    const totalFiscal = round2(saida.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0));
    return { itens: saida, totalFiscal };
  }

  for (const s of slots) {
    aplicarQuantidadeFiscalNoItem(saida[s.idx], Math.max(0, s.qMax));
  }

  let totalInt = round2(
    slots.reduce((s, x) => s + Number(saida[x.idx].valor_fiscal || 0), 0)
  );
  const metaInteiros = round2(Math.max(0, meta - fiscalFracionavel));
  const ordemRem = [...slots].sort((a, b) => a.preco - b.preco);

  let guard = 0;
  while (totalInt - 0.009 > metaInteiros && guard < 10000) {
    guard += 1;
    let removeu = false;
    for (const s of ordemRem) {
      const qAtual = Number(saida[s.idx].quantidade_fiscal || 0);
      if (qAtual - 1 >= s.qMin - 1e-9) {
        aplicarQuantidadeFiscalNoItem(saida[s.idx], qAtual - 1);
        totalInt = round2(
          slots.reduce((acc, x) => acc + Number(saida[x.idx].valor_fiscal || 0), 0)
        );
        removeu = true;
        break;
      }
    }
    if (!removeu) break;
  }

  const totalFiscal = round2(saida.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0));
  return { itens: saida, totalFiscal };
}

/**
 * Menor composição inteira com totalFiscal >= metaAlvo (PASSO 2 — completar).
 * Itens fracionáveis permanecem intactos.
 */
function montarComposicaoFiscalParaCima(itens, metaAlvo, valorFiscalMaximo) {
  const saida = itens.map((i) => ({ ...i }));
  const meta = round2(metaAlvo);
  const maximo = round2(
    valorFiscalMaximo != null
      ? valorFiscalMaximo
      : saida.reduce((s, i) => s + Number(i.valor_fiscal || 0) + Number(i.valor_nao_fiscal || 0), 0)
  );

  const fiscalFracionavel = round2(
    saida
      .filter((i) => itemPermiteQuantidadeFracionada(i))
      .reduce((s, i) => s + Number(i.valor_fiscal || 0), 0)
  );

  const slots = saida
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => !itemPermiteQuantidadeFracionada(item))
    .map(({ item, idx }) => {
      const { qMin, qMax } = obterFaixaQtdFiscalItem(item);
      return {
        idx,
        qMin: Math.ceil(qMin - 1e-9),
        qMax: Math.floor(qMax + 1e-9),
        preco: Number(item.preco_unitario || 0)
      };
    });

  for (const s of slots) {
    aplicarQuantidadeFiscalNoItem(saida[s.idx], Math.max(0, s.qMin));
  }

  let totalInt = round2(
    slots.reduce((s, x) => s + Number(saida[x.idx].valor_fiscal || 0), 0)
  );
  const metaInteiros = round2(Math.max(0, meta - fiscalFracionavel));
  const tetoInteiros = round2(Math.max(0, maximo - fiscalFracionavel));
  const ordemAdd = [...slots].sort((a, b) => b.preco - a.preco);

  let guard = 0;
  while (totalInt + 0.009 < metaInteiros && guard < 10000) {
    guard += 1;
    let adicionou = false;
    for (const s of ordemAdd) {
      const qAtual = Number(saida[s.idx].quantidade_fiscal || 0);
      if (qAtual + 1 <= s.qMax + 1e-9) {
        const proximo = round2(totalInt + s.preco);
        if (proximo - 0.009 > tetoInteiros + 0.009) continue;
        aplicarQuantidadeFiscalNoItem(saida[s.idx], qAtual + 1);
        totalInt = round2(
          slots.reduce((acc, x) => acc + Number(saida[x.idx].valor_fiscal || 0), 0)
        );
        adicionou = true;
        break;
      }
    }
    if (!adicionou) break;
  }

  const totalFiscal = round2(saida.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0));
  return { itens: saida, totalFiscal };
}

function composicaoTemQuantidadeInvalida(itens) {
  return (itens || []).some(itemTemQuantidadeFiscalInvalida);
}

/**
 * Sprint 3.12 — Regra nº 3: integridade de quantidades fiscais.
 * Ordem: (1) reduzir fiscal → (2) completar fiscal se redução não resolver.
 */
function corrigirIntegridadeQuantidadesFiscais(itens = [], opcoes = {}) {
  const base = itens.map((i) => ({ ...i }));
  const meta = round2(
    opcoes.valorFiscalEfetivoMeta != null
      ? opcoes.valorFiscalEfetivoMeta
      : base.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0)
  );

  if (!composicaoTemQuantidadeInvalida(base)) {
    return {
      itens: base,
      ajusteIntegridadeAplicado: false,
      passoIntegridade: null,
      valorFiscalEfetivoOriginal: meta
    };
  }

  const valorFiscalMinimo = round2(opcoes.valorFiscalMinimo || 0);
  const valorFiscalMaximo = round2(
    opcoes.valorFiscalMaximo != null
      ? opcoes.valorFiscalMaximo
      : base.reduce(
        (s, i) => s + Number(
          i.valor_fiscal_maximo != null
            ? i.valor_fiscal_maximo
            : (Number(i.valor_fiscal || 0) + Number(i.valor_nao_fiscal || 0))
        ),
        0
      )
  );

  const abaixo = montarComposicaoFiscalInteiraAbaixo(base, meta);
  const acima = montarComposicaoFiscalParaCima(base, meta, valorFiscalMaximo);

  const abaixoOk = !composicaoTemQuantidadeInvalida(abaixo.itens)
    && abaixo.totalFiscal + 0.009 >= valorFiscalMinimo
    && abaixo.totalFiscal - 0.009 <= valorFiscalMaximo + 0.009;

  const acimaOk = !composicaoTemQuantidadeInvalida(acima.itens)
    && acima.totalFiscal + 0.009 >= valorFiscalMinimo
    && acima.totalFiscal - 0.009 <= valorFiscalMaximo + 0.009;

  const distAbaixo = abaixoOk ? round2(Math.max(0, meta - abaixo.totalFiscal)) : Number.POSITIVE_INFINITY;
  const distAcima = acimaOk ? round2(Math.max(0, acima.totalFiscal - meta)) : Number.POSITIVE_INFINITY;

  // PASSO 1: reduzir — aceita se válido e não for pior que completar
  // (ex.: meta 5,50 → abaixo 4 dist 1,50 > acima 6 dist 0,50 → vai ao PASSO 2)
  if (abaixoOk && distAbaixo <= distAcima + 1e-9) {
    return {
      itens: abaixo.itens,
      ajusteIntegridadeAplicado: true,
      passoIntegridade: 'REDUZIR',
      valorFiscalEfetivoOriginal: meta,
      valorFiscalEfetivoAjustado: abaixo.totalFiscal
    };
  }

  // PASSO 2: completar
  if (acimaOk) {
    return {
      itens: acima.itens,
      ajusteIntegridadeAplicado: true,
      passoIntegridade: 'COMPLETAR',
      valorFiscalEfetivoOriginal: meta,
      valorFiscalEfetivoAjustado: acima.totalFiscal
    };
  }

  if (abaixoOk) {
    return {
      itens: abaixo.itens,
      ajusteIntegridadeAplicado: true,
      passoIntegridade: 'REDUZIR',
      valorFiscalEfetivoOriginal: meta,
      valorFiscalEfetivoAjustado: abaixo.totalFiscal
    };
  }

  const fallback = base.map((i) => ({ ...i }));
  for (const item of fallback) {
    if (itemTemQuantidadeFiscalInvalida(item)) {
      aplicarQuantidadeFiscalNoItem(item, Math.floor(Number(item.quantidade_fiscal || 0) + 1e-9));
    }
  }
  return {
    itens: fallback,
    ajusteIntegridadeAplicado: true,
    passoIntegridade: 'REDUZIR_FALLBACK',
    valorFiscalEfetivoOriginal: meta,
    valorFiscalEfetivoAjustado: round2(
      fallback.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0)
    )
  };
}

/**
 * Faixa válida de quantidade fiscal (estoque).
 * min = o que não cabe no saldo não fiscal; max = o que cabe no saldo fiscal.
 */
function obterFaixaQuantidadeFiscal(quantidadeVendida, saldoFiscal, saldoNaoFiscal) {
  const quantidadeVendidaNum = Number(quantidadeVendida || 0);
  const saldoFiscalNum = Number(saldoFiscal || 0);
  const saldoNaoFiscalNum = Number(saldoNaoFiscal || 0);
  const estoqueTotal = saldoFiscalNum + saldoNaoFiscalNum;

  if (quantidadeVendidaNum > estoqueTotal + 1e-9) {
    return {
      sucesso: false,
      estoqueTotal,
      mensagem: `Saldo insuficiente. Disponível: ${estoqueTotal}`
    };
  }

  return {
    sucesso: true,
    estoqueTotal,
    quantidadeFiscalMin: Math.max(0, quantidadeVendidaNum - saldoNaoFiscalNum),
    quantidadeFiscalMax: Math.min(quantidadeVendidaNum, saldoFiscalNum)
  };
}

/**
 * Distribui quantidade vendida entre saldo fiscal e não fiscal.
 * @param {boolean} vendaFiscal - true: consome fiscal primeiro; false: consome não fiscal primeiro
 */
function distribuirQuantidadeVenda(
  quantidadeVendida,
  saldoFiscal,
  saldoNaoFiscal,
  vendaFiscal = true
) {
  quantidadeVendida = Number(quantidadeVendida || 0);
  saldoFiscal = Number(saldoFiscal || 0);
  saldoNaoFiscal = Number(saldoNaoFiscal || 0);
  const priorizarFiscal = parseVendaFiscalFlag(vendaFiscal);

  const faixa = obterFaixaQuantidadeFiscal(quantidadeVendida, saldoFiscal, saldoNaoFiscal);
  if (!faixa.sucesso) {
    return {
      sucesso: false,
      estoqueTotal: faixa.estoqueTotal,
      mensagem: faixa.mensagem
    };
  }

  let quantidadeFiscal;
  let quantidadeNaoFiscal;

  if (priorizarFiscal) {
    quantidadeFiscal = faixa.quantidadeFiscalMax;
    quantidadeNaoFiscal = quantidadeVendida - quantidadeFiscal;
  } else {
    quantidadeFiscal = faixa.quantidadeFiscalMin;
    quantidadeNaoFiscal = quantidadeVendida - quantidadeFiscal;
  }

  return {
    sucesso: true,
    quantidadeFiscal,
    quantidadeNaoFiscal,
    estoqueTotal: faixa.estoqueTotal,
    quantidadeFiscalMin: faixa.quantidadeFiscalMin,
    quantidadeFiscalMax: faixa.quantidadeFiscalMax
  };
}

function calcularValoresFiscaisItem(item, quantidadeFiscal, quantidadeNaoFiscal) {
  const qtdVenda = Number(item.quantidade || 0);
  const qtdEstoque = item.quantidade_estoque != null && item.quantidade_estoque !== ''
    ? Number(item.quantidade_estoque)
    : qtdVenda;
  const precoUnitario = Number(item.preco_unitario || 0);
  const subtotalVenda = Number((qtdVenda * precoUnitario).toFixed(2));

  let valorFiscal;
  let valorNaoFiscal;

  if (qtdEstoque > 0 && qtdEstoque !== qtdVenda) {
    const ratioFiscal = quantidadeFiscal / qtdEstoque;
    valorFiscal = Number((subtotalVenda * ratioFiscal).toFixed(2));
    valorNaoFiscal = Number((subtotalVenda - valorFiscal).toFixed(2));
  } else {
    valorFiscal = Number((quantidadeFiscal * precoUnitario).toFixed(2));
    valorNaoFiscal = Number((quantidadeNaoFiscal * precoUnitario).toFixed(2));
  }

  return { valorFiscal, valorNaoFiscal, subtotalVenda, qtdEstoque };
}

function distribuirItemVenda(item, saldoFiscal, saldoNaoFiscal, vendaFiscal = true) {
  const qtdVenda = Number(item.quantidade || 0);
  const qtdEstoque = item.quantidade_estoque != null && item.quantidade_estoque !== ''
    ? Number(item.quantidade_estoque)
    : qtdVenda;

  const resultado = distribuirQuantidadeVenda(qtdEstoque, saldoFiscal, saldoNaoFiscal, vendaFiscal);
  if (!resultado.sucesso) {
    return resultado;
  }

  const valores = calcularValoresFiscaisItem(
    item,
    resultado.quantidadeFiscal,
    resultado.quantidadeNaoFiscal
  );

  return {
    sucesso: true,
    quantidadeFiscal: resultado.quantidadeFiscal,
    quantidadeNaoFiscal: resultado.quantidadeNaoFiscal,
    valorFiscal: valores.valorFiscal,
    valorNaoFiscal: valores.valorNaoFiscal,
    estoqueTotal: resultado.estoqueTotal,
    quantidadeFiscalMin: resultado.quantidadeFiscalMin,
    quantidadeFiscalMax: resultado.quantidadeFiscalMax,
    valorFiscalMaximo: valores.valorFiscal,
    valorFiscalMinimo: null
  };
}

/**
 * Distribuição no extremo oposto (mínimo fiscal / máximo não fiscal possível).
 */
function distribuirItemVendaMinimoFiscal(item, saldoFiscal, saldoNaoFiscal) {
  return distribuirItemVenda(item, saldoFiscal, saldoNaoFiscal, false);
}

function somarPagamentosNaoDinheiro(pagamentos = [], totalVenda = 0) {
  const lista = Array.isArray(pagamentos) ? pagamentos : [];
  let dinheiro = 0;
  let informado = 0;
  for (const p of lista) {
    const v = Number(p.valor || 0);
    informado += v;
    if (isFormaDinheiroFisico(p.forma_pagamento || p.forma)) {
      dinheiro += v;
    }
  }
  dinheiro = round2(dinheiro);
  informado = round2(informado);
  // HOTFIX FISCAL-4.0.2: quando há pagamentos informados, a capacidade comercial
  // é a soma paga (líquida), não o subtotal bruto — evita tratar desconto como
  // "pagamento eletrônico fantasma" (totalBruto - dinheiro).
  const totalReferencia = informado > 0.009 ? informado : round2(totalVenda);
  // Se não há detalhe de pagamentos, não há preservação a aplicar.
  if (lista.length === 0 || informado <= 0) {
    return { valorDinheiro: 0, valorNaoDinheiro: round2(totalVenda) };
  }
  return {
    valorDinheiro: dinheiro,
    valorNaoDinheiro: round2(Math.max(0, totalReferencia - dinheiro))
  };
}

/**
 * Escolhe Valor Fiscal Efetivo dentro da faixa válida [min, max].
 * FIXA + preservarDinheiro (midpAtivo) → PRESERVAR DINHEIRO (legado 3.8B/C).
 * FIXA sem preservar → efetivo = máximo.
 * FLEXIVEL → eletrônicos + % do dinheiro no fiscal (RC8.2).
 *
 * @param {object} [opcoes.politicaFiscalComercial] — PoliticaFiscalComercialV1 (RC8.2)
 */
function calcularValorFiscalEfetivo({
  valorFiscalMaximo,
  valorFiscalMinimo,
  totalVenda,
  pagamentos = [],
  midpAtivo = false,
  politicaFiscalComercial = null
} = {}) {
  const max = round2(valorFiscalMaximo);
  const min = round2(valorFiscalMinimo);
  const total = round2(totalVenda);
  const politica = politicaFiscalComercial || null;
  const modo = politica && politica.modo === 'FLEXIVEL' ? 'FLEXIVEL' : 'FIXA';

  // RC8.2 — FLEXÍVEL: max dinheiro no fiscal = percentual% do valor em dinheiro pago.
  if (modo === 'FLEXIVEL') {
    const percentual = Math.min(100, Math.max(0, Number(politica.percentualDinheiroFiscal || 0)));
    const { valorDinheiro, valorNaoDinheiro } = somarPagamentosNaoDinheiro(pagamentos, total);
    const dinheiroPermitidoFiscal = round2(valorDinheiro * (percentual / 100));
    let efetivo = round2(valorNaoDinheiro + dinheiroPermitidoFiscal);
    efetivo = Math.min(max, efetivo);
    efetivo = Math.max(min, efetivo);
    efetivo = round2(efetivo);
    const preservacaoAplicada = efetivo + 0.009 < max;
    return {
      valorFiscalMaximo: max,
      valorFiscalMinimo: min,
      valorFiscalEfetivo: efetivo,
      valorNaoFiscal: round2(total - efetivo),
      preservacaoAplicada,
      valorDinheiro,
      valorNaoDinheiro,
      dinheiroPermitidoFiscal,
      modoPolitica: 'FLEXIVEL',
      percentualDinheiroFiscal: percentual
    };
  }

  // FIXA — midpAtivo: política.preservarDinheiro OU flag legado
  const preservar = politica && politica.preservarDinheiro != null
    ? Boolean(politica.preservarDinheiro)
    : Boolean(midpAtivo);

  if (!preservar) {
    return {
      valorFiscalMaximo: max,
      valorFiscalMinimo: min,
      valorFiscalEfetivo: max,
      valorNaoFiscal: round2(total - max),
      preservacaoAplicada: false,
      modoPolitica: 'FIXA'
    };
  }

  const { valorDinheiro, valorNaoDinheiro } = somarPagamentosNaoDinheiro(pagamentos, total);

  // Sem dinheiro físico → nada a preservar.
  if (valorDinheiro <= 0.009) {
    return {
      valorFiscalMaximo: max,
      valorFiscalMinimo: min,
      valorFiscalEfetivo: max,
      valorNaoFiscal: round2(total - max),
      preservacaoAplicada: false,
      valorDinheiro,
      valorNaoDinheiro,
      modoPolitica: 'FIXA'
    };
  }

  // Alvo: fiscal coberto preferencialmente por meios eletrônicos.
  let efetivo = Math.min(max, valorNaoDinheiro);
  efetivo = Math.max(min, efetivo);
  efetivo = round2(efetivo);

  const preservacaoAplicada = efetivo + 0.009 < max;

  return {
    valorFiscalMaximo: max,
    valorFiscalMinimo: min,
    valorFiscalEfetivo: efetivo,
    valorNaoFiscal: round2(total - efetivo),
    preservacaoAplicada,
    valorDinheiro,
    valorNaoDinheiro,
    modoPolitica: 'FIXA'
  };
}

/**
 * Reduz parcela fiscal dos itens (dentro da faixa) até atingir valorFiscalEfetivo.
 * Não altera total por item (fiscal + não fiscal constante).
 */
function ajustarItensParaValorFiscalEfetivo(itens = [], metaValorFiscalEfetivo) {
  const meta = round2(metaValorFiscalEfetivo);
  const saida = itens.map((item) => ({ ...item }));

  let fiscalAtual = round2(saida.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0));
  let liberar = round2(fiscalAtual - meta);
  if (liberar <= 0.009) {
    return saida;
  }

  // Prioriza itens com maior folga fiscal liberável.
  const ordem = saida
    .map((item, idx) => {
      const vMax = Number(item.valor_fiscal || 0);
      const vMin = Number(
        item.valor_fiscal_minimo != null ? item.valor_fiscal_minimo : vMax
      );
      return { idx, liberavel: round2(Math.max(0, vMax - vMin)) };
    })
    .filter((x) => x.liberavel > 0.009)
    .sort((a, b) => b.liberavel - a.liberavel);

  for (const { idx, liberavel } of ordem) {
    if (liberar <= 0.009) break;
    const item = saida[idx];
    const vMax = Number(item.valor_fiscal || 0);
    const vMin = Number(item.valor_fiscal_minimo != null ? item.valor_fiscal_minimo : vMax);
    const qMax = Number(
      item.quantidade_fiscal_max != null ? item.quantidade_fiscal_max : item.quantidade_fiscal
    );
    const qMin = Number(
      item.quantidade_fiscal_min != null ? item.quantidade_fiscal_min : item.quantidade_fiscal
    );
    const qEstoque = Number(item.quantidade_fiscal || 0) + Number(item.quantidade_nao_fiscal || 0);

    const delta = Math.min(liberavel, liberar);
    const vNovo = round2(vMax - delta);
    const spanV = vMax - vMin;
    const t = spanV > 0.0001 ? (vMax - vNovo) / spanV : 0;
    const qF = Number((qMax - t * (qMax - qMin)).toFixed(6));
    const qNf = Number((qEstoque - qF).toFixed(6));

    item.quantidade_fiscal = qF;
    item.quantidade_nao_fiscal = qNf;
    item.valor_fiscal = vNovo;
    item.valor_nao_fiscal = round2(Number(item.valor_nao_fiscal || 0) + delta);
    liberar = round2(liberar - delta);
  }

  return saida;
}

/**
 * Pipeline oficial: distribuição máxima (legado) → Valor Fiscal Efetivo (3.8B) →
 * Valor Fiscal Líquido comercial (RC7.10.1) → itens ajustados.
 *
 * @param {Array<{item, saldoFiscal, saldoNaoFiscal}>} entradas
 * @param {boolean} vendaFiscal
 * @param {object} opcoes
 * @param {Array} opcoes.pagamentos
 * @param {boolean} opcoes.midpAtivo
 * @param {number} [opcoes.desconto=0]
 * @param {number} [opcoes.acrescimo=0]
 * @param {object} [opcoes.politicaFiscalComercial] — RC8.1 MPFC (recebido; não utilizado nos cálculos)
 */
function distribuirItensVendaComValorFiscalEfetivo(entradas = [], vendaFiscal = true, opcoes = {}) {
  const pagamentos = Array.isArray(opcoes.pagamentos) ? opcoes.pagamentos : [];
  const desconto = Number(opcoes.desconto || 0);
  const acrescimo = Number(opcoes.acrescimo || 0);
  // RC8.2 — política oficial do MPFC (obrigatória para novos fluxos; opcional em testes legados)
  const politicaFiscalComercial = opcoes.politicaFiscalComercial || null;
  const midpAtivo = politicaFiscalComercial
    ? Boolean(politicaFiscalComercial.preservarDinheiro)
    : Boolean(opcoes.midpAtivo);

  const itensMax = [];
  let valorFiscalMinimo = 0;

  for (const entrada of entradas) {
    const item = entrada.item || entrada;
    const saldoFiscal = Number(entrada.saldoFiscal != null ? entrada.saldoFiscal : 0);
    const saldoNaoFiscal = Number(entrada.saldoNaoFiscal != null ? entrada.saldoNaoFiscal : 0);

    const maxRes = distribuirItemVenda(item, saldoFiscal, saldoNaoFiscal, vendaFiscal);
    if (!maxRes.sucesso) {
      return { sucesso: false, erro: maxRes, item };
    }

    const minRes = distribuirItemVendaMinimoFiscal(item, saldoFiscal, saldoNaoFiscal);
    if (!minRes.sucesso) {
      return { sucesso: false, erro: minRes, item };
    }

    valorFiscalMinimo = round2(valorFiscalMinimo + minRes.valorFiscal);

    itensMax.push({
      ...item,
      quantidade_fiscal: maxRes.quantidadeFiscal,
      quantidade_nao_fiscal: maxRes.quantidadeNaoFiscal,
      valor_fiscal: maxRes.valorFiscal,
      valor_nao_fiscal: maxRes.valorNaoFiscal,
      valor_fiscal_minimo: minRes.valorFiscal,
      valor_nao_fiscal_maximo: minRes.valorNaoFiscal,
      quantidade_fiscal_min: minRes.quantidadeFiscal,
      quantidade_fiscal_max: maxRes.quantidadeFiscalMax != null
        ? maxRes.quantidadeFiscalMax
        : maxRes.quantidadeFiscal,
      valor_fiscal_maximo: maxRes.valorFiscal
    });
  }

  const valorFiscalMaximoBruto = round2(
    itensMax.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0)
  );
  const valorNaoFiscalMaximoBruto = round2(
    itensMax.reduce((s, i) => s + Number(i.valor_nao_fiscal || 0), 0)
  );
  const totalVendaBruto = round2(valorFiscalMaximoBruto + valorNaoFiscalMaximoBruto);
  const valorFiscalMinimoBruto = valorFiscalMinimo;

  // HOTFIX FISCAL-4.0.2 — rateio comercial (líquido) ANTES do efetivo/MIDP.
  // Antes: efetivo rodava no bruto com pagamentos já líquidos → desconto virava
  // "falso eletrônico" em somarPagamentosNaoDinheiro e a validação podia
  // exigir valor fiscal bruto enquanto o operador pagava o líquido.
  const liquidoMax = calcularValorFiscalLiquido({
    valorFiscalBruto: valorFiscalMaximoBruto,
    valorNaoFiscalBruto: valorNaoFiscalMaximoBruto,
    desconto,
    acrescimo
  });

  const fatorComercial = liquidoMax.ajustado ? Number(liquidoMax.fator) : 1;
  let itensLiquidosMax = aplicarValorFiscalLiquidoNosItens(itensMax, liquidoMax).map((item, idx) => {
    const src = itensMax[idx] || item;
    return {
      ...item,
      valor_fiscal_minimo: round2(Number(src.valor_fiscal_minimo || 0) * fatorComercial),
      valor_nao_fiscal_maximo: round2(Number(src.valor_nao_fiscal_maximo || 0) * fatorComercial),
      valor_fiscal_maximo: round2(Number(src.valor_fiscal_maximo || 0) * fatorComercial)
    };
  });

  const valorFiscalMaximoLiquido = round2(
    itensLiquidosMax.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0)
  );
  const valorFiscalMinimoLiquido = calcularValorFiscalMaximoLiquido(
    valorFiscalMinimoBruto,
    liquidoMax
  );
  const totalVendaLiquido = round2(
    Number(liquidoMax.totalLiquido != null ? liquidoMax.totalLiquido : (
      valorFiscalMaximoLiquido
      + itensLiquidosMax.reduce((s, i) => s + Number(i.valor_nao_fiscal || 0), 0)
    ))
  );

  const efetivo = calcularValorFiscalEfetivo({
    valorFiscalMaximo: valorFiscalMaximoLiquido,
    valorFiscalMinimo: valorFiscalMinimoLiquido,
    totalVenda: totalVendaLiquido,
    pagamentos,
    midpAtivo,
    politicaFiscalComercial
  });

  let itens = efetivo.preservacaoAplicada
    ? ajustarItensParaValorFiscalEfetivo(itensLiquidosMax, efetivo.valorFiscalEfetivo)
    : itensLiquidosMax.map((i) => ({ ...i }));

  // Sprint 3.12 — Regra nº 3: integridade (só age se houver qtd inválida em UN etc.)
  const integridade = corrigirIntegridadeQuantidadesFiscais(itens, {
    valorFiscalEfetivoMeta: efetivo.valorFiscalEfetivo,
    valorFiscalMinimo: valorFiscalMinimoLiquido,
    valorFiscalMaximo: valorFiscalMaximoLiquido
  });
  itens = integridade.itens;

  const totalFiscal = round2(itens.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0));
  const totalNaoFiscal = round2(itens.reduce((s, i) => s + Number(i.valor_nao_fiscal || 0), 0));
  const totalVenda = round2(totalFiscal + totalNaoFiscal);
  const valorFiscalMaximo = valorFiscalMaximoLiquido;
  const liquido = {
    ...liquidoMax,
    valorFiscalLiquido: totalFiscal,
    valorNaoFiscalLiquido: totalNaoFiscal,
    totalLiquido: totalVenda
  };
  // Espelho bruto da partilha final (antes do desconto comercial), p/ auditoria RC7.10.1
  const totalFiscalBruto = liquidoMax.ajustado
    ? (fatorComercial > 0.0000001
      ? round2(totalFiscal / fatorComercial)
      : valorFiscalMaximoBruto)
    : totalFiscal;
  const totalNaoFiscalBruto = liquidoMax.ajustado
    ? (fatorComercial > 0.0000001
      ? round2(totalNaoFiscal / fatorComercial)
      : valorNaoFiscalMaximoBruto)
    : totalNaoFiscal;

  // Limpa campos auxiliares internos antes de retornar (mantém espelho útil mínimo).
  const itensLimpos = itens.map((i) => {
    const {
      valor_fiscal_minimo,
      valor_nao_fiscal_maximo,
      quantidade_fiscal_min,
      quantidade_fiscal_max,
      valor_fiscal_maximo,
      ...rest
    } = i;
    return {
      ...rest,
      valor_fiscal: Number(i.valor_fiscal || 0),
      valor_nao_fiscal: Number(i.valor_nao_fiscal || 0),
      quantidade_fiscal: Number(i.quantidade_fiscal || 0),
      quantidade_nao_fiscal: Number(i.quantidade_nao_fiscal || 0)
    };
  });

  return {
    sucesso: true,
    itens: itensLimpos,
    valorFiscalMaximo,
    valorFiscalMinimo: valorFiscalMinimoLiquido,
    valorFiscalEfetivo: totalFiscal,
    valorFiscalLiquido: totalFiscal,
    valorNaoFiscal: totalNaoFiscal,
    valorNaoFiscalLiquido: totalNaoFiscal,
    valorFiscalBruto: totalFiscalBruto,
    valorNaoFiscalBruto: totalNaoFiscalBruto,
    totalVenda,
    totalVendaBruto,
    preservacaoAplicada: efetivo.preservacaoAplicada,
    liquidoComercial: liquido,
    integridadeQuantidades: {
      aplicada: Boolean(integridade.ajusteIntegridadeAplicado),
      passo: integridade.passoIntegridade || null,
      valorFiscalEfetivoOriginal: integridade.valorFiscalEfetivoOriginal,
      valorFiscalEfetivoAjustado: integridade.valorFiscalEfetivoAjustado != null
        ? integridade.valorFiscalEfetivoAjustado
        : totalFiscal
    },
    meta: efetivo,
    // RC8.2 — eco da política aplicada no cálculo de efetivo
    politicaFiscalComercialRecebida: politicaFiscalComercial
      ? {
          versao: politicaFiscalComercial.versao,
          codigoPolitica: politicaFiscalComercial.codigoPolitica,
          modo: politicaFiscalComercial.modo,
          percentualDinheiroFiscal: politicaFiscalComercial.percentualDinheiroFiscal,
          utilizada: true,
          modoPoliticaEfetivo: efetivo.modoPolitica || politicaFiscalComercial.modo
        }
      : null
  };
}

module.exports = {
  parseVendaFiscalFlag,
  round2,
  isFormaDinheiroFisico,
  obterFaixaQuantidadeFiscal,
  distribuirQuantidadeVenda,
  distribuirItemVenda,
  distribuirItemVendaMinimoFiscal,
  calcularValoresFiscaisItem,
  somarPagamentosNaoDinheiro,
  calcularValorFiscalEfetivo,
  ajustarItensParaValorFiscalEfetivo,
  itemPermiteQuantidadeFracionada,
  itemTemQuantidadeFiscalInvalida,
  corrigirIntegridadeQuantidadesFiscais,
  distribuirItensVendaComValorFiscalEfetivo
};
