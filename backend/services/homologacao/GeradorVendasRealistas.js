/**
 * Gerador de vendas realistas para homologação NFC-e / testes.
 *
 * Totais SEMPRE derivados da composição de itens (nunca total = random(faixa)).
 * Não altera Motor Fiscal × Não Fiscal, TEF, Payment Core, numeração ou emissão.
 */

'use strict';

const { arredondarMoeda, toCentavos, somarMoeda } = require('../fiscal/modeloTotais');

const ORIGEM_GERADOR = 'GERADOR_VENDAS_REALISTAS';

/** Faixas em reais — maior peso em vendas pequenas/médias. */
const FAIXAS_VALOR = Object.freeze([
  { min: 8, max: 49, peso: 32 },
  { min: 50, max: 119, peso: 28 },
  { min: 120, max: 199, peso: 20 },
  { min: 200, max: 299, peso: 13 },
  { min: 300, max: 500, peso: 7 }
]);

/** Catálogo padrão (preços com centavos irregulares) — usado quando não há produtos do DB. */
const CATALOGO_PADRAO = Object.freeze([
  { id: 9001, nome: 'Pão francês', preco_venda: 0.85, item_fiscal: 1, unidade: 'UN' },
  { id: 9002, nome: 'Café 50ml', preco_venda: 2.5, item_fiscal: 1, unidade: 'UN' },
  { id: 9003, nome: 'Refrigerante lata', preco_venda: 5.49, item_fiscal: 1, unidade: 'UN' },
  { id: 9004, nome: 'Água 500ml', preco_venda: 2.99, item_fiscal: 1, unidade: 'UN' },
  { id: 9005, nome: 'Salgado assado', preco_venda: 8.45, item_fiscal: 1, unidade: 'UN' },
  { id: 9006, nome: 'Pastel carne', preco_venda: 9.9, item_fiscal: 1, unidade: 'UN' },
  { id: 9007, nome: 'Pastel frango', preco_venda: 10.5, item_fiscal: 1, unidade: 'UN' },
  { id: 9008, nome: 'Suco natural', preco_venda: 12.75, item_fiscal: 1, unidade: 'UN' },
  { id: 9009, nome: 'Sanduíche natural', preco_venda: 13.8, item_fiscal: 1, unidade: 'UN' },
  { id: 9010, nome: 'Marmita P', preco_venda: 18.9, item_fiscal: 1, unidade: 'UN' },
  { id: 9011, nome: 'Marmita M', preco_venda: 22.4, item_fiscal: 1, unidade: 'UN' },
  { id: 9012, nome: 'Açaí 300ml', preco_venda: 16.35, item_fiscal: 1, unidade: 'UN' },
  { id: 9013, nome: 'Pizza brotinho', preco_venda: 27.5, item_fiscal: 1, unidade: 'UN' },
  { id: 9014, nome: 'Combo almoço', preco_venda: 32.45, item_fiscal: 1, unidade: 'UN' },
  { id: 9015, nome: 'Kit família', preco_venda: 67.35, item_fiscal: 1, unidade: 'UN' },
  { id: 9016, nome: 'Cesta básica P', preco_venda: 83.72, item_fiscal: 0, unidade: 'UN' },
  { id: 9017, nome: 'Cesta básica M', preco_venda: 106.53, item_fiscal: 0, unidade: 'UN' },
  { id: 9018, nome: 'Fardo refrigerante', preco_venda: 48.9, item_fiscal: 1, unidade: 'UN' },
  { id: 9019, nome: 'Queijo kg (fatia)', preco_venda: 41.9, item_fiscal: 1, unidade: 'UN' },
  { id: 9020, nome: 'Carne bovina kg', preco_venda: 58.37, item_fiscal: 1, unidade: 'UN' }
]);

function criarRng(seed) {
  let s = (Number(seed) >>> 0) || 1;
  return function next() {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function escolherFaixa(rng, faixas = FAIXAS_VALOR) {
  const totalPeso = faixas.reduce((s, f) => s + f.peso, 0);
  let r = rng() * totalPeso;
  for (const f of faixas) {
    r -= f.peso;
    if (r <= 0) return f;
  }
  return faixas[faixas.length - 1];
}

/**
 * Alvo sugerido (centavos) para empacotamento — determinístico por sequência.
 * NÃO é o total final; o total continua sendo soma dos itens empacotados.
 */
function sugerirAlvoCentavos({
  sequencia = 1,
  seed = 0,
  valorMin = 8,
  valorMax = 500,
  valorAlvo = 250
} = {}) {
  const minC = Math.max(1, toCentavos(valorMin));
  const maxC = Math.max(minC, toCentavos(valorMax));
  const faixas = FAIXAS_VALOR
    .map((f) => ({
      min: Math.max(toCentavos(f.min), minC),
      max: Math.min(toCentavos(f.max), maxC),
      peso: f.peso
    }))
    .filter((f) => f.min <= f.max);

  const lista = faixas.length
    ? faixas
    : [{ min: minC, max: maxC, peso: 1 }];

  const rng = criarRng((Number(seed) || 0) * 10007 + Number(sequencia) * 7919 + 17);
  const faixa = escolherFaixa(rng, lista);
  const span = Math.max(1, faixa.max - faixa.min);
  // Evita pousar sempre no valorAlvo: mistura ponto da faixa com leve atração ao alvo se estiver na faixa.
  let alvo = faixa.min + Math.floor(rng() * (span + 1));
  const alvoSug = toCentavos(valorAlvo);
  if (alvoSug >= faixa.min && alvoSug <= faixa.max && rng() < 0.18) {
    alvo = alvoSug;
  }
  // ~12% redondos (múltiplos de R$ 5,00) quando couber na faixa
  if (rng() < 0.12) {
    const step = 500;
    const redondo = Math.round(alvo / step) * step;
    if (redondo >= faixa.min && redondo <= faixa.max) alvo = redondo;
  }
  return Math.min(maxC, Math.max(minC, alvo));
}

function normalizarProduto(p, idx = 0) {
  const preco = arredondarMoeda(p.preco_venda != null ? p.preco_venda : p.preco);
  return {
    id: Number(p.id || p.produto_id || 9000 + idx),
    nome: String(p.nome || `Produto ${idx + 1}`),
    preco_venda: preco,
    item_fiscal: Number(p.item_fiscal) === 1 || p.item_fiscal === true ? 1 : 0,
    unidade: String(p.unidade || 'UN'),
    produto_fracionado: Number(p.produto_fracionado || 0) ? 1 : 0,
    ativo: p.ativo == null ? 1 : Number(p.ativo)
  };
}

function montarCatalogo(produtos) {
  const lista = (Array.isArray(produtos) && produtos.length)
    ? produtos.map(normalizarProduto).filter((p) => p.ativo && p.preco_venda > 0 && !p.produto_fracionado)
    : CATALOGO_PADRAO.map((p, i) => normalizarProduto(p, i));
  return lista.filter((p) => p.preco_venda > 0);
}

function subtotalItem(preco, qtd) {
  return arredondarMoeda(Number(preco) * Number(qtd));
}

/**
 * Monta uma venda realista: escolhe faixa, depois compõe itens até cair na faixa.
 * Total = soma dos itens (nunca sorteado isoladamente).
 */
function gerarVendaRealista({
  produtos,
  seed = 1,
  indice = 1,
  minItens = 1,
  maxItens = 6,
  maxQtyPorItem = 5
} = {}) {
  const catalogo = montarCatalogo(produtos);
  if (!catalogo.length) {
    const err = new Error('Catálogo de produtos vazio para o gerador de vendas realistas.');
    err.code = 'CATALOGO_VAZIO';
    throw err;
  }

  const rng = criarRng(Number(seed) * 9973 + Number(indice) * 104729 + 3);
  const faixa = escolherFaixa(rng);
  const minC = toCentavos(faixa.min);
  const maxC = toCentavos(faixa.max);

  const itens = [];
  let totalCents = 0;
  const nItensAlvo = minItens + Math.floor(rng() * (Math.max(minItens, maxItens) - minItens + 1));

  const tentarAdicionar = (produto, qtd) => {
    const sub = subtotalItem(produto.preco_venda, qtd);
    const addC = toCentavos(sub);
    if (addC <= 0) return false;
    if (totalCents + addC > maxC && totalCents > 0) return false;
    // primeira peça pode exceder max se produto unitário for grande — aceita se <= max*1.15 ou única opção
    if (totalCents === 0 && addC > maxC && addC > toCentavos(faixa.max) * 1.15) return false;

    const itemFiscal = Number(produto.item_fiscal) === 1 ? 1 : 0;
    itens.push({
      produto_id: produto.id,
      nome: produto.nome,
      unidade: produto.unidade,
      quantidade: qtd,
      preco_unitario: arredondarMoeda(produto.preco_venda),
      subtotal: sub,
      item_fiscal: itemFiscal,
      quantidade_fiscal: itemFiscal ? qtd : 0,
      quantidade_nao_fiscal: itemFiscal ? 0 : qtd,
      valor_fiscal: itemFiscal ? sub : 0,
      valor_nao_fiscal: itemFiscal ? 0 : sub
    });
    totalCents += addC;
    return true;
  };

  let tentativas = 0;
  while (itens.length < nItensAlvo && tentativas < 80) {
    tentativas += 1;
    const produto = catalogo[Math.floor(rng() * catalogo.length)];
    const qtd = 1 + Math.floor(rng() * maxQtyPorItem);
    // Se já estamos na faixa, 40% de chance de parar antes de adicionar mais
    if (totalCents >= minC && rng() < 0.4) break;
    tentarAdicionar(produto, qtd);
    if (totalCents >= minC && totalCents <= maxC && itens.length >= minItens && rng() < 0.55) break;
  }

  // Garante mínimo da faixa com itens baratos, se possível
  if (totalCents < minC) {
    const baratos = [...catalogo].sort((a, b) => a.preco_venda - b.preco_venda);
    for (const p of baratos) {
      if (totalCents >= minC) break;
      if (itens.length >= maxItens) break;
      const falta = minC - totalCents;
      const qtd = Math.min(
        maxQtyPorItem,
        Math.max(1, Math.ceil(falta / Math.max(1, toCentavos(p.preco_venda))))
      );
      tentarAdicionar(p, qtd);
    }
  }

  // Se estourou o máximo e tem mais de 1 item, remove o último até caber (ou ficar com 1)
  while (totalCents > maxC && itens.length > 1) {
    const rem = itens.pop();
    totalCents -= toCentavos(rem.subtotal);
  }

  if (!itens.length) {
    const p = catalogo[0];
    tentarAdicionar(p, 1);
  }

  const total = arredondarMoeda(totalCents / 100);
  const valorFiscal = arredondarMoeda(somarMoeda(itens.map((i) => i.valor_fiscal)));
  const valorNaoFiscal = arredondarMoeda(somarMoeda(itens.map((i) => i.valor_nao_fiscal)));
  const qtdFiscal = itens.reduce((s, i) => s + Number(i.quantidade_fiscal || 0), 0);
  const qtdNaoFiscal = itens.reduce((s, i) => s + Number(i.quantidade_nao_fiscal || 0), 0);
  const somaItens = arredondarMoeda(somarMoeda(itens.map((i) => i.subtotal)));

  return {
    origem: ORIGEM_GERADOR,
    indice: Number(indice),
    faixa: { min: faixa.min, max: faixa.max },
    quantidade_itens: itens.length,
    itens,
    total,
    valor_fiscal: valorFiscal,
    valor_nao_fiscal: valorNaoFiscal,
    quantidade_fiscal: arredondarMoeda(qtdFiscal),
    quantidade_nao_fiscal: arredondarMoeda(qtdNaoFiscal),
    soma_itens: somaItens,
    integridade_ok: toCentavos(somaItens) === toCentavos(total) && total > 0
  };
}

function gerarLoteVendasRealistas({
  quantidade = 20,
  produtos,
  seed = 42
} = {}) {
  const vendas = [];
  for (let i = 1; i <= quantidade; i += 1) {
    vendas.push(gerarVendaRealista({ produtos, seed, indice: i }));
  }
  return {
    origem: ORIGEM_GERADOR,
    quantidade: vendas.length,
    seed: Number(seed),
    vendas,
    totais: vendas.map((v) => v.total),
    resumo: analisarDistribuicao(vendas)
  };
}

function analisarDistribuicao(vendas) {
  const totais = (vendas || []).map((v) => arredondarMoeda(v.total));
  const cents = totais.map((t) => toCentavos(t));
  const porValor = new Map();
  for (const c of cents) porValor.set(c, (porValor.get(c) || 0) + 1);
  let maxFreq = 0;
  let valorMaisFrequente = null;
  for (const [c, n] of porValor) {
    if (n > maxFreq) {
      maxFreq = n;
      valorMaisFrequente = c / 100;
    }
  }
  const comCentavos = cents.filter((c) => c % 100 !== 0).length;
  const redondos = cents.filter((c) => c % 100 === 0).length;
  const concentracao250 = cents.filter((c) => c >= 24900 && c <= 25100).length;
  const faixasHit = FAIXAS_VALOR.map((f) => ({
    ...f,
    count: totais.filter((t) => t >= f.min && t <= f.max).length
  }));

  return {
    n: totais.length,
    min: totais.length ? Math.min(...totais) : 0,
    max: totais.length ? Math.max(...totais) : 0,
    distintos: porValor.size,
    max_freq: maxFreq,
    valor_mais_frequente: valorMaisFrequente,
    com_centavos: comCentavos,
    redondos,
    concentracao_250_aprox: concentracao250,
    faixas: faixasHit
  };
}

function formatarRelatorioHomologacao(lote) {
  const linhas = [];
  linhas.push('=== Relatório Gerador de Vendas Realistas (Homologação NFC-e) ===');
  linhas.push(`Origem: ${ORIGEM_GERADOR}`);
  linhas.push(`Seed: ${lote.seed} · Quantidade: ${lote.quantidade}`);
  linhas.push('');
  for (const v of lote.vendas) {
    linhas.push(
      `Venda ${String(v.indice).padStart(2, '0')}  R$ ${v.total.toFixed(2).padStart(7)}  ` +
      `itens=${v.quantidade_itens}  fiscal=${v.valor_fiscal.toFixed(2)}  não-fiscal=${v.valor_nao_fiscal.toFixed(2)}`
    );
  }
  linhas.push('');
  const r = lote.resumo;
  linhas.push(`Distintos: ${r.distintos}/${r.n} · máx freq=${r.max_freq} em R$ ${Number(r.valor_mais_frequente).toFixed(2)}`);
  linhas.push(`Com centavos: ${r.com_centavos} · Redondos: ${r.redondos} · ≈250: ${r.concentracao_250_aprox}`);
  return linhas.join('\n');
}

/**
 * Valida lote gerado (aceite de qualidade).
 */
function validarLoteVendasRealistas(lote, { maxConcentracaoPct = 0.12, minDistintosPct = 0.35 } = {}) {
  const erros = [];
  const vendas = lote.vendas || [];
  if (vendas.length < 1) erros.push('Lote vazio');

  for (const v of vendas) {
    if (!(v.total > 0)) erros.push(`Venda ${v.indice}: total zero/negativo`);
    if (!v.itens || !v.itens.length) erros.push(`Venda ${v.indice}: sem itens`);
    if (toCentavos(v.soma_itens) !== toCentavos(v.total)) {
      erros.push(`Venda ${v.indice}: soma itens (${v.soma_itens}) ≠ total (${v.total})`);
    }
    const somaF = arredondarMoeda(somarMoeda(v.itens.map((i) => i.valor_fiscal)));
    const somaNf = arredondarMoeda(somarMoeda(v.itens.map((i) => i.valor_nao_fiscal)));
    if (toCentavos(somaF) !== toCentavos(v.valor_fiscal)) {
      erros.push(`Venda ${v.indice}: valor_fiscal inconsistente`);
    }
    if (toCentavos(somaNf) !== toCentavos(v.valor_nao_fiscal)) {
      erros.push(`Venda ${v.indice}: valor_nao_fiscal inconsistente`);
    }
  }

  const r = lote.resumo || analisarDistribuicao(vendas);
  if (r.n >= 20 && r.max_freq / r.n > maxConcentracaoPct) {
    erros.push(`Concentração excessiva: ${r.max_freq}/${r.n} em R$ ${r.valor_mais_frequente}`);
  }
  if (r.n >= 20 && r.distintos / r.n < minDistintosPct) {
    erros.push(`Poucos valores distintos: ${r.distintos}/${r.n}`);
  }
  if (r.n >= 20 && r.concentracao_250_aprox / r.n > 0.2) {
    erros.push(`Concentração artificial em ~R$ 250: ${r.concentracao_250_aprox}/${r.n}`);
  }
  if (r.n >= 20 && r.com_centavos < 3) {
    erros.push('Poucos valores com centavos variados');
  }
  if (r.n >= 20 && r.redondos < 1) {
    erros.push('Nenhum valor redondo (esperado alguns)');
  }

  return { ok: erros.length === 0, erros, resumo: r };
}

module.exports = {
  ORIGEM_GERADOR,
  FAIXAS_VALOR,
  CATALOGO_PADRAO,
  criarRng,
  sugerirAlvoCentavos,
  montarCatalogo,
  gerarVendaRealista,
  gerarLoteVendasRealistas,
  analisarDistribuicao,
  formatarRelatorioHomologacao,
  validarLoteVendasRealistas
};
