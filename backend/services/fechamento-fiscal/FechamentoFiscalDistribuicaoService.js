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

function normalizarSaldoFiscal(saldo) {
  if (saldo == null) return null;
  const valor = Number(saldo);
  return Number.isFinite(valor) ? Math.max(0, valor) : 0;
}

function compararPrioridadeSaldo(a, b) {
  const saldoA = normalizarSaldoFiscal(a.saldo_fiscal);
  const saldoB = normalizarSaldoFiscal(b.saldo_fiscal);
  if (saldoA != null && saldoB == null) return -1;
  if (saldoA == null && saldoB != null) return 1;
  if (saldoA != null && saldoB != null && saldoA !== saldoB) return saldoB - saldoA;
  if (saldoA != null && saldoB != null && a.produto_id !== b.produto_id) {
    return Number(a.produto_id) - Number(b.produto_id);
  }
  return compararUnidade(a, b);
}

function compararPrioridadeProdutos(a, b, ordemProdutos) {
  // Compare the selected-product sequence by current saldo descending, then ID.
  let indiceA = 0;
  let indiceB = 0;
  while (indiceA < ordemProdutos.length && indiceB < ordemProdutos.length) {
    while (indiceA < ordemProdutos.length && !a.produtos.has(ordemProdutos[indiceA])) indiceA += 1;
    while (indiceB < ordemProdutos.length && !b.produtos.has(ordemProdutos[indiceB])) indiceB += 1;
    if (indiceA === ordemProdutos.length || indiceB === ordemProdutos.length) return 0;
    if (indiceA !== indiceB) return indiceA - indiceB;
    indiceA += 1;
    indiceB += 1;
  }
  return 0;
}

function limitarGruposAoSaldoFiscal(grupos) {
  const saldoRestante = new Map();
  const saldoConhecido = new Set();
  for (const grupo of grupos) {
    const saldo = normalizarSaldoFiscal(grupo.saldo_fiscal);
    if (saldo == null) continue;
    const produtoId = Number(grupo.produto_id);
    if (!saldoConhecido.has(produtoId)) {
      saldoRestante.set(produtoId, saldo);
      saldoConhecido.add(produtoId);
    } else {
      saldoRestante.set(produtoId, Math.min(saldoRestante.get(produtoId), saldo));
    }
  }

  return [...grupos].sort(compararPrioridadeSaldo).map((grupo) => {
    const produtoId = Number(grupo.produto_id);
    if (!saldoConhecido.has(produtoId)) return grupo;
    const quantidadePorUnidade = Number(grupo.quantidade_por_unidade || 0);
    const saldo = saldoRestante.get(produtoId);
    const unidadesPermitidas = quantidadePorUnidade > 0
      ? Math.min(
        Number(grupo.quantidade_unidades || 0),
        Math.floor((saldo + 1e-9) / quantidadePorUnidade)
      )
      : 0;
    saldoRestante.set(
      produtoId,
      Math.max(0, saldo - unidadesPermitidas * quantidadePorUnidade)
    );
    return { ...grupo, quantidade_unidades: unidadesPermitidas };
  }).filter((grupo) => grupo.quantidade_unidades > 0);
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
    saldo_fiscal: normalizarSaldoFiscal(lote.saldo_fiscal)
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

const ORCAMENTO_BITS_PODA_BYTES = 128 * 1024 * 1024;

/**
 * Programação dinâmica exata por soma em centavos (0/1 sobre blocos binários dos grupos).
 * Mantém por soma o melhor estado segundo os mesmos critérios da implementação original
 * (prioridade de produtos por saldo, mais produtos, menos unidades, menor concentração e
 * desempate lexicográfico), mas com estados em vetores tipados e sem alocação por transição.
 * - Atualização in-place percorrendo as somas em ordem decrescente (cada estado lido ainda
 *   é o do bloco anterior), com resultado idêntico ao da atualização em duas fases.
 * - Poda exata por alcançabilidade: soma que os blocos restantes não conseguem levar até a
 *   faixa final aceita nunca vira resultado (propriedade monotônica, preserva a ordem
 *   de criação das somas que sobrevivem).
 * Retorna { somaCents, quantidades } ou null quando não há solução na faixa.
 */
function executarProgramacaoDinamica(ctx) {
  const {
    grupos, blocos, alvo, limiteBusca, minSomaCents, maxSomaCents, minVendaCents, maxVendaCents,
    produtoDoGrupo, totalProdutos, usoDoProduto, ordemIndices, metricasExecucao
  } = ctx;
  const G = grupos.length;
  const P = totalProdutos;
  const L = limiteBusca + 1;
  const nOrdem = ordemIndices.length;

  const quantidadePorUnidade = Float64Array.from(grupos, (grupo) => Number(grupo.quantidade_por_unidade || 0));
  // A quantidade acumulada por produto (qp) pode ser recalculada a partir das quantidades por
  // grupo com o mesmo resultado bit a bit quando as somas independem da ordem: todas as
  // quantidades por unidade do produto são inteiras, ou todos os seus grupos têm uma única
  // unidade (soma na ordem dos grupos, igual à ordem de aplicação dos blocos). Fora disso,
  // mantém-se qp por linha como antes.
  const inicioProduto = new Int32Array(P + 1);
  const listaGruposProduto = new Int32Array(G);
  let qpDerivavel = true;
  {
    const contagem = new Int32Array(P);
    for (let g = 0; g < G; g += 1) contagem[ctx.produtoDoGrupo[g]] += 1;
    for (let p = 0; p < P; p += 1) inicioProduto[p + 1] = inicioProduto[p] + contagem[p];
    const cursor = inicioProduto.slice(0, P);
    for (let g = 0; g < G; g += 1) listaGruposProduto[cursor[ctx.produtoDoGrupo[g]]++] = g;
    for (let p = 0; p < P && qpDerivavel; p += 1) {
      let todosInteiros = true;
      let todosUnicos = true;
      for (let k = inicioProduto[p]; k < inicioProduto[p + 1]; k += 1) {
        const g = listaGruposProduto[k];
        if (!Number.isInteger(quantidadePorUnidade[g])) todosInteiros = false;
        if (Number(grupos[g].quantidade_unidades) !== 1 || !Number.isFinite(quantidadePorUnidade[g])) todosUnicos = false;
      }
      if (!todosInteiros && !todosUnicos) qpDerivavel = false;
    }
  }
  let maiorQuantidade = 0;
  for (const grupo of grupos) maiorQuantidade = Math.max(maiorQuantidade, Number(grupo.quantidade_unidades));
  const TipoQ = maiorQuantidade <= 255 ? Uint8Array : (maiorQuantidade <= 65535 ? Uint16Array : Int32Array);

  let existe;
  let nProd;
  let unid;
  let conc;
  let qFlat;
  let qpFlat = null;
  let presFlat;
  let posicao;
  let novoPorPosicao;
  try {
    existe = new Uint8Array(L);
    nProd = new Int32Array(L);
    unid = new Float64Array(L);
    conc = new Float64Array(L);
    qFlat = new TipoQ(L * G);
    if (!qpDerivavel) qpFlat = new Float64Array(L * P);
    presFlat = new Uint8Array(L * P);
    posicao = new Int32Array(L);
    novoPorPosicao = new Int32Array(L).fill(-1);
  } catch (erroAlocacao) {
    const erro = new Error('Memória insuficiente para compor a prévia fiscal com o volume informado.');
    erro.code = 'PREVIA_MEMORIA_INSUFICIENTE';
    erro.cause = erroAlocacao;
    throw erro;
  }

  const quantidadeDoProdutoNaLinha = (linha, produto) => {
    if (!qpDerivavel) return qpFlat[linha * P + produto];
    const base = linha * G;
    let soma = 0;
    for (let k = inicioProduto[produto]; k < inicioProduto[produto + 1]; k += 1) {
      const g = listaGruposProduto[k];
      const quantidade = qFlat[base + g];
      if (quantidade !== 0) soma += quantidadePorUnidade[g] * quantidade;
    }
    return soma;
  };
  const chaves = grupos.map((grupo) => `${grupo.produto_id}:${grupo.venda_item_id}:${grupo.key}`);
  // Posto de cada chave na ordem de localeCompare (iguais compartilham o posto), para
  // que o desempate compare inteiros com o mesmo resultado de chaveA.localeCompare(chaveB).
  const postos = new Int32Array(G);
  {
    const ordenados = Array.from({ length: G }, (_, i) => i)
      .sort((a, b) => chaves[a].localeCompare(chaves[b]));
    let posto = 0;
    for (let i = 0; i < G; i += 1) {
      if (i > 0 && chaves[ordenados[i - 1]].localeCompare(chaves[ordenados[i]]) !== 0) posto += 1;
      postos[ordenados[i]] = posto;
    }
  }

  // Mesma regra de compararPrioridadeProdutos. Cada linha guarda a presença dos produtos com
  // saldo fiscal como máscara de bits na ordem de prioridade. A regra original compara,
  // em ordem, as posições dos produtos presentes: no primeiro bit em que as máscaras divergem
  // vence quem o possui, desde que o outro ainda tenha algum produto presente depois dele
  // (caso contrário a lista menor se esgotou e o resultado é empate).
  const palavrasMascara = nOrdem ? ((nOrdem + 31) >>> 5) : 0;
  const posicaoNaOrdem = new Int32Array(P).fill(-1);
  for (let k = 0; k < nOrdem; k += 1) posicaoNaOrdem[ordemIndices[k]] = k;
  const mascaraFlat = nOrdem ? new Uint32Array(L * palavrasMascara) : null;
  const mascaraCandidata = new Uint32Array(palavrasMascara);
  const prioridadePresenca = (linhaA, produtoA, linhaB) => {
    const baseA = linhaA * palavrasMascara;
    const baseB = linhaB * palavrasMascara;
    for (let w = 0; w < palavrasMascara; w += 1) mascaraCandidata[w] = mascaraFlat[baseA + w];
    if (produtoA >= 0) {
      const posicaoProduto = posicaoNaOrdem[produtoA];
      if (posicaoProduto >= 0) mascaraCandidata[posicaoProduto >>> 5] |= (1 << (posicaoProduto & 31));
    }
    for (let w = 0; w < palavrasMascara; w += 1) {
      const a = mascaraCandidata[w];
      const b = mascaraFlat[baseB + w];
      const diferenca = (a ^ b) >>> 0;
      if (diferenca === 0) continue;
      const bit = 31 - Math.clz32((diferenca & -diferenca) >>> 0);
      const aTem = ((a >>> bit) & 1) === 1;
      const outro = aTem ? b : a;
      let outroTemDepois = bit < 31 && (outro >>> (bit + 1)) !== 0;
      for (let x = w + 1; !outroTemDepois && x < palavrasMascara; x += 1) {
        if ((aTem ? mascaraFlat[baseB + x] : mascaraCandidata[x]) !== 0) outroTemDepois = true;
      }
      if (!outroTemDepois) return 0;
      return aTem ? -1 : 1;
    }
    return 0;
  };

  // Desempate lexicográfico por quantidades por grupo; o lado A pode ter um acréscimo virtual.
  const desempateQuantidades = (linhaA, grupoExtra, quantidadeExtra, linhaB) => {
    const baseA = linhaA * G;
    const baseB = linhaB * G;
    let indiceA = 0;
    let indiceB = 0;
    let restanteA = 0;
    let restanteB = 0;
    while (true) {
      while (restanteA === 0 && indiceA < G) {
        restanteA = qFlat[baseA + indiceA] + (indiceA === grupoExtra ? quantidadeExtra : 0);
        indiceA += 1;
      }
      while (restanteB === 0 && indiceB < G) {
        restanteB = qFlat[baseB + indiceB];
        indiceB += 1;
      }
      if (restanteA === 0 || restanteB === 0) return 0;
      const comparacao = postos[indiceA - 1] - postos[indiceB - 1];
      if (comparacao !== 0) return comparacao < 0 ? -1 : 1;
      const consumidas = Math.min(restanteA, restanteB);
      restanteA -= consumidas;
      restanteB -= consumidas;
    }
  };

  const comparar = (aN, aU, aC, linhaA, produtoA, grupoExtra, quantidadeExtra, linhaB) => {
    if (nOrdem) {
      const prioridade = prioridadePresenca(linhaA, produtoA, linhaB);
      if (prioridade !== 0) return prioridade;
    }
    if (aN !== nProd[linhaB]) return nProd[linhaB] - aN;
    if (aU !== unid[linhaB]) return aU - unid[linhaB];
    if (aC !== conc[linhaB]) return aC - conc[linhaB];
    return desempateQuantidades(linhaA, grupoExtra, quantidadeExtra, linhaB);
  };

  const somaFinalMin = Math.max(alvo, minSomaCents == null ? 0 : minSomaCents);
  const somaFinalMax = maxSomaCents == null ? limiteBusca : Math.min(limiteBusca, maxSomaCents);
  const palavras = (L >> 5) + 2;
  let bom = null;
  if (blocos.length && somaFinalMin <= somaFinalMax
    && (blocos.length + 1) * palavras * 4 <= ORCAMENTO_BITS_PODA_BYTES) {
    bom = new Array(blocos.length + 1);
    const base = new Uint32Array(palavras);
    for (let s = somaFinalMin; s <= somaFinalMax; s += 1) base[s >> 5] |= (1 << (s & 31));
    bom[blocos.length] = base;
    for (let i = blocos.length - 1; i >= 0; i -= 1) {
      const origem = bom[i + 1];
      const destino = new Uint32Array(palavras);
      const deslocPalavras = blocos[i].valor >> 5;
      const deslocBits = blocos[i].valor & 31;
      for (let w = 0; w < palavras; w += 1) {
        const a = w + deslocPalavras;
        let v = origem[w];
        if (a < palavras) {
          v |= origem[a] >>> deslocBits;
          if (deslocBits && a + 1 < palavras) v |= origem[a + 1] << (32 - deslocBits);
        }
        destino[w] = v;
      }
      bom[i] = destino;
    }
  }

  existe[0] = 1;
  const ordemSomas = [0];
  posicao[0] = 0;
  let topo = 0;

  for (let indiceBloco = 0; indiceBloco < blocos.length; indiceBloco += 1) {
    const bloco = blocos[indiceBloco];
    const valorBloco = bloco.valor;
    const quantidadeBloco = bloco.quantidade;
    const indiceGrupo = bloco.indice;
    const indiceProduto = produtoDoGrupo[indiceGrupo];
    const acrescimo = quantidadePorUnidade[indiceGrupo] * quantidadeBloco;
    const bomAtual = bom ? bom[indiceBloco] : null;
    const bomProximo = bom ? bom[indiceBloco + 1] : null;

    if (bomAtual) {
      let escrita = 0;
      topo = 0;
      for (let leitura = 0; leitura < ordemSomas.length; leitura += 1) {
        const soma = ordemSomas[leitura];
        if (bomAtual[soma >> 5] & (1 << (soma & 31))) {
          ordemSomas[escrita] = soma;
          posicao[soma] = escrita;
          if (soma > topo) topo = soma;
          escrita += 1;
        } else {
          existe[soma] = 0;
        }
      }
      ordemSomas.length = escrita;
    }

    const totalEstados = ordemSomas.length;
    if (metricasExecucao) {
      metricasExecucao.estadosAvaliados = (metricasExecucao.estadosAvaliados || 0) + totalEstados;
      metricasExecucao.transicoesAvaliadas = (metricasExecucao.transicoesAvaliadas || 0) + totalEstados;
    }

    let novoTopo = topo;
    for (let origem = topo; origem >= 0; origem -= 1) {
      if (existe[origem] === 0) continue;
      const destino = origem + valorBloco;
      if (destino > limiteBusca) continue;
      if (maxSomaCents != null && destino > maxSomaCents) continue;
      if (bomProximo && !(bomProximo[destino >> 5] & (1 << (destino & 31)))) continue;

      const baseProdutoOrigem = origem * P;
      const primeiraDoProduto = presFlat[baseProdutoOrigem + indiceProduto] === 0;
      const quantidadeAnterior = quantidadeDoProdutoNaLinha(origem, indiceProduto);
      const acumuladaAnterior = usoDoProduto[indiceProduto] + quantidadeAnterior;
      const acumuladaNova = acumuladaAnterior + acrescimo;
      const candidatoN = nProd[origem] + (primeiraDoProduto ? 1 : 0);
      const candidatoU = unid[origem] + quantidadeBloco;
      const candidatoC = conc[origem]
        + (acumuladaNova * acumuladaNova)
        - (primeiraDoProduto ? 0 : acumuladaAnterior * acumuladaAnterior);

      const jaExistia = existe[destino] === 1;
      if (jaExistia && comparar(
        candidatoN, candidatoU, candidatoC, origem, indiceProduto, indiceGrupo, quantidadeBloco, destino
      ) >= 0) continue;

      const baseGrupoOrigem = origem * G;
      const baseGrupoDestino = destino * G;
      const baseProdutoDestino = destino * P;
      qFlat.copyWithin(baseGrupoDestino, baseGrupoOrigem, baseGrupoOrigem + G);
      qFlat[baseGrupoDestino + indiceGrupo] += quantidadeBloco;
      if (!qpDerivavel) {
        qpFlat.copyWithin(baseProdutoDestino, baseProdutoOrigem, baseProdutoOrigem + P);
        qpFlat[baseProdutoDestino + indiceProduto] = quantidadeAnterior + acrescimo;
      }
      presFlat.copyWithin(baseProdutoDestino, baseProdutoOrigem, baseProdutoOrigem + P);
      presFlat[baseProdutoDestino + indiceProduto] = 1;
      if (nOrdem) {
        const baseMascaraDestino = destino * palavrasMascara;
        const baseMascaraOrigem = origem * palavrasMascara;
        mascaraFlat.copyWithin(baseMascaraDestino, baseMascaraOrigem, baseMascaraOrigem + palavrasMascara);
        const posicaoProduto = posicaoNaOrdem[indiceProduto];
        if (posicaoProduto >= 0) mascaraFlat[baseMascaraDestino + (posicaoProduto >>> 5)] |= (1 << (posicaoProduto & 31));
      }
      nProd[destino] = candidatoN;
      unid[destino] = candidatoU;
      conc[destino] = candidatoC;
      if (!jaExistia) {
        existe[destino] = 1;
        novoPorPosicao[posicao[origem]] = destino;
        if (destino > novoTopo) novoTopo = destino;
      }
    }

    // Somas novas entram na ordem de criação original: pela posição da origem.
    for (let p = 0; p < totalEstados; p += 1) {
      const destino = novoPorPosicao[p];
      if (destino < 0) continue;
      novoPorPosicao[p] = -1;
      posicao[destino] = ordemSomas.length;
      ordemSomas.push(destino);
    }
    topo = novoTopo;
    if (metricasExecucao) {
      metricasExecucao.maxEstados = Math.max(metricasExecucao.maxEstados || 0, ordemSomas.length);
    }
  }

  let melhor = -1;
  for (const soma of ordemSomas) {
    if (soma < alvo) continue;
    if (minSomaCents != null && soma < minSomaCents) continue;
    if (maxSomaCents != null && soma > maxSomaCents) continue;
    if (minVendaCents != null && maxVendaCents != null
      && !totalCabeEmVendas(soma, minVendaCents, maxVendaCents)) continue;
    if (melhor < 0) {
      melhor = soma;
      continue;
    }
    const exata = soma === alvo;
    const melhorExata = melhor === alvo;
    if (exata !== melhorExata) {
      if (exata) melhor = soma;
      continue;
    }
    const excesso = soma - alvo;
    const melhorExcesso = melhor - alvo;
    const distancia = Math.abs(soma - alvo);
    const melhorDistancia = Math.abs(melhor - alvo);
    const prioridade = nOrdem ? prioridadePresenca(soma, -1, melhor) : 0;
    if (prioridade < 0 || (prioridade === 0 && (
      (minSomaCents != null ? distancia < melhorDistancia : excesso < melhorExcesso) || (
        (minSomaCents != null ? distancia === melhorDistancia : excesso === melhorExcesso)
        && comparar(nProd[soma], unid[soma], conc[soma], soma, -1, -1, 0, melhor) < 0
      )
    ))) {
      melhor = soma;
    }
  }

  if (melhor < 0) return null;
  return {
    somaCents: melhor,
    quantidades: qFlat.slice(melhor * G, melhor * G + G)
  };
}

function totalCabeEmVendas(totalCents, valorMinCents, valorMaxCents) {
  if (!(totalCents > 0) || !(valorMinCents > 0) || valorMaxCents < valorMinCents) {
    return false;
  }
  return Math.ceil(totalCents / valorMaxCents) <= Math.floor(totalCents / valorMinCents);
}

function selecionarUnidadesCompactas(gruposEntrada, targetCents, opts = {}) {
  const gruposComSaldoLimitado = limitarGruposAoSaldoFiscal(
    Array.isArray(gruposEntrada) ? gruposEntrada : []
  );
  const maxValorUnidadeCents = Number.isFinite(Number(opts.maxValorUnidadeCents))
    ? Math.max(0, Number(opts.maxValorUnidadeCents))
    : null;
  const maxSomaCents = Number.isFinite(Number(opts.maxSomaCents))
    ? Math.max(0, Number(opts.maxSomaCents))
    : null;
  const minSomaCents = Number.isFinite(Number(opts.minSomaCents))
    ? Math.max(0, Number(opts.minSomaCents))
    : null;
  const minVendaCents = Number.isFinite(Number(opts.minVendaCents))
    ? Math.max(0, Number(opts.minVendaCents))
    : null;
  const maxVendaCents = Number.isFinite(Number(opts.maxVendaCents))
    ? Math.max(0, Number(opts.maxVendaCents))
    : null;
  const grupos = gruposComSaldoLimitado
    .filter((grupo) => Number(grupo.quantidade_unidades || 0) > 0 && Number(grupo.valor_cents || 0) > 0)
    .filter((grupo) => maxValorUnidadeCents == null || Number(grupo.valor_cents) <= maxValorUnidadeCents)
    .sort(compararPrioridadeSaldo);
  const ordemProdutos = [];
  const produtosVistos = new Set();
  for (const grupo of grupos) {
    const produtoId = Number(grupo.produto_id);
    if (produtosVistos.has(produtoId) || normalizarSaldoFiscal(grupo.saldo_fiscal) == null) continue;
    produtosVistos.add(produtoId);
    ordemProdutos.push(produtoId);
  }
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
  const limiteBusca = Math.min(
    capacidadeCents,
    Math.max(alvo, minSomaCents == null ? alvo : minSomaCents)
      + Math.max(0, maiorUnidade - 1)
  );
  const indicePorProduto = new Map();
  for (const grupo of grupos) {
    const produtoId = Number(grupo.produto_id);
    if (!indicePorProduto.has(produtoId)) indicePorProduto.set(produtoId, indicePorProduto.size);
  }
  const totalProdutos = indicePorProduto.size;
  const produtoDoGrupo = grupos.map((grupo) => indicePorProduto.get(Number(grupo.produto_id)));
  const usoDoProduto = new Float64Array(totalProdutos);
  for (const [produtoId, indiceProduto] of indicePorProduto) {
    usoDoProduto[indiceProduto] = Number(usoPorProduto.get(produtoId) || 0);
  }
  const ordemIndices = ordemProdutos.map((produtoId) => indicePorProduto.get(produtoId));
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

  const resultadoDp = executarProgramacaoDinamica({
    grupos,
    blocos,
    alvo,
    limiteBusca,
    minSomaCents,
    maxSomaCents,
    minVendaCents,
    maxVendaCents,
    produtoDoGrupo,
    totalProdutos,
    usoDoProduto,
    ordemIndices,
    metricasExecucao
  });
  if (!resultadoDp) return { selecionadasAgrupadas: [], somaCents: 0, capacidadeCents };
  const selecionadasAgrupadas = grupos
    .map((grupo, indice) => ({ ...grupo, quantidade_selecionada: resultadoDp.quantidades[indice] }))
    .filter((grupo) => grupo.quantidade_selecionada > 0);
  return { selecionadasAgrupadas, somaCents: resultadoDp.somaCents, capacidadeCents };
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
        fracionado: Boolean(grupo.fracionado),
        saldo_fiscal: grupo.saldo_fiscal
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

function obterLimitesVendaCents(opts = {}) {
  const valorMinCents = Math.max(
    1,
    toCentavos(opts.valorMin != null ? opts.valorMin : DEFAULTS_DISTRIBUICAO.valorMin)
  );
  const valorMaxCents = Math.max(
    valorMinCents,
    toCentavos(opts.valorMax != null ? opts.valorMax : DEFAULTS_DISTRIBUICAO.valorMax)
  );
  return { valorMinCents, valorMaxCents };
}

/**
 * Empacota unidades selecionadas em vendas próximas ao valor-alvo (sugestão).
 */
function empacotarVendas(selecionadas, opts = {}) {
  const valorAlvo = Math.max(1, toCentavos(opts.valorAlvo != null ? opts.valorAlvo : DEFAULTS_DISTRIBUICAO.valorAlvo));
  const { valorMinCents: valorMin, valorMaxCents: valorMax } = obterLimitesVendaCents(opts);
  const modoRealista = opts.distribuicaoRealista !== false;

  let sugerirAlvoCentavos = null;
  if (modoRealista) {
    try {
      sugerirAlvoCentavos = require('../homologacao/GeradorVendasRealistas').sugerirAlvoCentavos;
    } catch (_) {
      sugerirAlvoCentavos = null;
    }
  }

  const fila = [...selecionadas]
    .filter((unidade) => Number(unidade.valor_cents) <= valorMax)
    .sort(compararPrioridadeSaldo);
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
      valor_final: arredondarMoeda(montado / 100),
      desconto: 0,
      quantidade_itens: itens.length,
      itens
    });
  }

  if (!vendas.every((venda) => {
    const valorCents = toCentavos(venda.valor);
    return valorCents >= valorMin && valorCents <= valorMax;
  })) {
    const grupos = agruparUnidadesExpandidas(
      (Array.isArray(selecionadas) ? selecionadas : [])
        .filter((unidade) => Number(unidade.valor_cents) <= valorMax)
    ).map((grupo) => ({
      ...grupo,
      quantidade_selecionada: Number(grupo.quantidade_unidades || 0)
    }));
    return empacotarVendasAgrupadas(grupos, opts);
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
  return {
    sequencia: Number(opts.sequencia || 1),
    rotulo: `Venda Fiscal ${String(Number(opts.sequencia || 1)).padStart(3, '0')}`,
    valor: arredondarMoeda(brutoCents / 100),
    valor_final: arredondarMoeda(brutoCents / 100),
    desconto: 0,
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
  const { valorMinCents: valorMin, valorMaxCents: valorMax } = obterLimitesVendaCents(opts);
  const modoRealista = opts.distribuicaoRealista !== false;
  const metricasExecucao = opts.metricasExecucao || {};
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
    .filter((grupo) => grupo.restante > 0 && Number(grupo.valor_cents) <= valorMax)
    .sort(compararPrioridadeSaldo);
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

    if (quantidadesPorIndice.size === 0 && fila.length
      && Number(fila[0].valor_cents) <= valorMax) {
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

  if (vendas.every((venda) => {
    const valorCents = toCentavos(venda.valor);
    return valorCents >= valorMin && valorCents <= valorMax;
  })) {
    return vendas;
  }

  const gruposDisponiveis = [...(selecionadasAgrupadas || [])]
    .map((grupo) => ({
      ...grupo,
      quantidade_unidades: Number(grupo.quantidade_selecionada || 0)
    }))
    .filter((grupo) => grupo.quantidade_unidades > 0
      && Number(grupo.valor_cents) <= valorMax);
  const valorTotalCents = gruposDisponiveis.reduce(
    (soma, grupo) => soma + grupo.quantidade_unidades * Number(grupo.valor_cents),
    0
  );
  if (valorTotalCents < valorMin) return [];

  const menorNumeroVendas = Math.ceil(valorTotalCents / valorMax);
  const maiorNumeroVendas = Math.floor(valorTotalCents / valorMin);
  if (menorNumeroVendas > maiorNumeroVendas) return [];

  const alvoPorVenda = Math.min(valorMax, Math.max(valorMin, valorAlvo));
  const quantidadeVendas = Math.max(
    menorNumeroVendas,
    Math.min(maiorNumeroVendas, Math.round(valorTotalCents / alvoPorVenda))
  );
  const vendasBalanceadas = [];
  const usoPorProduto = new Map();
  let restantes = gruposDisponiveis;

  for (let indiceVenda = 0; indiceVenda < quantidadeVendas; indiceVenda += 1) {
    const numeroRestante = quantidadeVendas - indiceVenda;
    const restanteCents = restantes.reduce(
      (soma, grupo) => soma + grupo.quantidade_unidades * Number(grupo.valor_cents),
      0
    );
    const minimoPacote = Math.max(
      valorMin,
      restanteCents - (numeroRestante - 1) * valorMax
    );
    const maximoPacote = Math.min(
      valorMax,
      restanteCents - (numeroRestante - 1) * valorMin
    );
    const alvoPacote = Math.max(
      minimoPacote,
      Math.min(maximoPacote, Math.round(restanteCents / numeroRestante))
    );
    const { selecionadasAgrupadas: gruposVenda, somaCents } = selecionarUnidadesCompactas(
      restantes,
      alvoPacote,
      {
        usoPorProduto,
        metricasExecucao,
        minSomaCents: minimoPacote,
        maxSomaCents: maximoPacote,
        maxValorUnidadeCents: valorMax
      }
    );
    if (!gruposVenda.length || somaCents < minimoPacote || somaCents > maximoPacote) {
      return [];
    }

    vendasBalanceadas.push(criarVendaDeGrupos(gruposVenda, {
      sequencia: indiceVenda + 1,
      valorAlvo: alvoPorVenda / 100
    }));
    for (const grupo of gruposVenda) {
      const produtoId = Number(grupo.produto_id);
      usoPorProduto.set(
        produtoId,
        (usoPorProduto.get(produtoId) || 0)
          + Number(grupo.quantidade_por_unidade || 0)
            * Number(grupo.quantidade_selecionada || 0)
      );
    }

    const selecionadasPorChave = new Map(gruposVenda.map((grupo) => [
      `${grupo.produto_id}|${grupo.venda_item_id}|${grupo.key}|${grupo.valor_cents}|${grupo.unit_cents}`,
      Number(grupo.quantidade_selecionada || 0)
    ]));
    restantes = restantes.map((grupo) => {
      const chave = `${grupo.produto_id}|${grupo.venda_item_id}|${grupo.key}|${grupo.valor_cents}|${grupo.unit_cents}`;
      return {
        ...grupo,
        quantidade_unidades: Math.max(
          0,
          grupo.quantidade_unidades - Number(selecionadasPorChave.get(chave) || 0)
        )
      };
    }).filter((grupo) => grupo.quantidade_unidades > 0);
  }

  if (restantes.length || vendasBalanceadas.some((venda) => {
    const valorCents = toCentavos(venda.valor);
    return valorCents < valorMin || valorCents > valorMax;
  })) {
    return [];
  }
  return vendasBalanceadas;
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
          unit_cents: toCentavos(unit),
          saldo_fiscal: p.saldo_fiscal
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

  const limitesVenda = obterLimitesVendaCents({ valorMin, valorMax });
  const { selecionadasAgrupadas, somaCents } = selecionarUnidadesCompactas(grupos, alvoCents, {
    metricasExecucao,
    maxValorUnidadeCents: limitesVenda.valorMaxCents,
    minVendaCents: limitesVenda.valorMinCents,
    maxVendaCents: limitesVenda.valorMaxCents
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
    distribuicaoRealista: opts.distribuicaoRealista,
    metricasExecucao
  });
  if (!vendas.length || vendas.some((venda) => {
    const valorVendaCents = toCentavos(venda.valor);
    return valorVendaCents < limitesVenda.valorMinCents
      || valorVendaCents > limitesVenda.valorMaxCents;
  })) {
    return empty({
      valor_informado: arredondarMoeda(alvoCents / 100),
      valor_elegivel: valorElegivel,
      diferenca: arredondarMoeda(alvoCents / 100),
      incompleta: true,
      mensagem:
        'Não foi possível compor todas as NFC-e dentro dos limites mínimo e máximo configurados.',
      codigo: 'SEM_COMPOSICAO_VALIDA'
    });
  }

  let somaVendas = vendas.reduce((s, v) => s + toCentavos(v.valor), 0);
  if (somaVendas !== somaCents && vendas.length) {
    return empty({
      valor_informado: arredondarMoeda(alvoCents / 100),
      valor_elegivel: valorElegivel,
      diferenca: arredondarMoeda(alvoCents / 100),
      incompleta: true,
      mensagem: 'A soma dos valores dos itens não corresponde ao total bruto da composição; conciliação pendente.',
      codigo: 'TOTAIS_COMPOSICAO_DIVERGENTES'
    });
  }

  for (const venda of vendas) {
    const brutoVendaCents = toCentavos(venda.valor);
    venda.desconto = 0;
    venda.valor_final = arredondarMoeda(brutoVendaCents / 100);
  }

  const porProduto = consolidarPorProduto(vendas, lotes);
  const valorFinalCents = vendas.reduce((soma, venda) => soma + toCentavos(venda.valor_final), 0);
  const perfeita = valorFinalCents === alvoCents;
  const diferencaCents = alvoCents - valorFinalCents;
  const diferencaAbsoluta = arredondarMoeda(Math.abs(diferencaCents) / 100);

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
    desconto: 0,
    diferenca: arredondarMoeda(diferencaCents / 100),
    valor_elegivel: valorElegivel,
    quantidade_vendas: vendas.length,
    perfeita,
    incompleta: !perfeita,
    mensagem: perfeita
      ? 'Composição bruta e recebimentos conciliados; não foi aplicado desconto.'
      : `Pendente de conciliação: composição bruta de R$ ${(valorFinalCents / 100).toFixed(2)} ` +
        `e recebimentos de R$ ${(alvoCents / 100).toFixed(2)} diferem em ` +
        `R$ ${diferencaAbsoluta.toFixed(2)}. Não há regra autorizada de desconto para ajustar essa diferença.`,
    codigo: perfeita ? 'OK' : 'DIFERENCA_NAO_CONCILIADA',
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
