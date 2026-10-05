/**
 * RC8.4.0 — Motor de Unidades de Medida Inteligente.
 * Conversão embalagem comercial → unidade de estoque + formação de preço.
 * Não altera XML, MIIP matching nem regras fiscais.
 *
 * @module services/unidades/MotorUnidadesMedida
 */

'use strict';

const UNIDADES_COMERCIAIS = Object.freeze([
  'UN',
  'PACOTE',
  'CAIXA',
  'FARDO',
  'SACO',
  'LATA',
  'BALDE',
  'ROLO',
  'BARRA',
  'KIT',
  'DISPLAY',
  'BOBINA',
  'GALAO',
  'KG',
  'G',
  'L',
  'ML',
  'M',
  'CM',
  'M2',
  'M3'
]);

const LABELS_UNIDADE_COMERCIAL = Object.freeze({
  UN: 'Unidade',
  PACOTE: 'Pacote',
  CAIXA: 'Caixa',
  FARDO: 'Fardo',
  SACO: 'Saco',
  LATA: 'Lata',
  BALDE: 'Balde',
  ROLO: 'Rolo',
  BARRA: 'Barra',
  KG: 'Quilograma',
  G: 'Grama',
  L: 'Litro',
  ML: 'Mililitro',
  M: 'Metro',
  CM: 'Centímetro',
  M2: 'Metro Quadrado',
  M3: 'Metro Cúbico'
});

/** Mapa uCom XML → unidade comercial CDS */
const MAPA_UCOM_XML = Object.freeze({
  UN: 'UN',
  UND: 'UN',
  UNI: 'UN',
  UNID: 'UN',
  UNIDADE: 'UN',
  PC: 'PACOTE',
  PCT: 'PACOTE',
  PACOTE: 'PACOTE',
  CX: 'CAIXA',
  CXA: 'CAIXA',
  CAIXA: 'CAIXA',
  FD: 'FARDO',
  FARDO: 'FARDO',
  SC: 'SACO',
  SACO: 'SACO',
  LT: 'LATA',
  LATA: 'LATA',
  BD: 'BALDE',
  BALDE: 'BALDE',
  RL: 'ROLO',
  ROLO: 'ROLO',
  BR: 'BARRA',
  BARRA: 'BARRA',
  KIT: 'PACOTE',
  DISPLAY: 'PACOTE',
  BOBINA: 'ROLO',
  GALAO: 'BALDE',
  GALÃO: 'BALDE',
  KG: 'KG',
  G: 'G',
  L: 'L',
  LTRO: 'L',
  ML: 'ML',
  M: 'M',
  MT: 'M',
  CM: 'CM',
  M2: 'M2',
  'M²': 'M2',
  M3: 'M3',
  'M³': 'M3'
});

function num(v, casas = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

function moeda(v) {
  return num(v, 2);
}

function normalizarUnidadeComercial(valor) {
  const raw = String(valor || 'UN').trim().toUpperCase()
    .replace('²', '2')
    .replace('³', '3')
    .replace(/\s+/g, '');
  if (MAPA_UCOM_XML[raw]) return MAPA_UCOM_XML[raw];
  if (UNIDADES_COMERCIAIS.includes(raw)) return raw;
  return 'UN';
}

function exigeQuantidadePorEmbalagem(unidadeComercial) {
  const uc = normalizarUnidadeComercial(unidadeComercial);
  return uc !== 'UN';
}

/**
 * Compra em embalagem → estoque em unidades + custos/preços.
 * @param {Object} input
 */
function calcularCompraEmbalagem(input = {}) {
  const quantidadeEmbalagens = num(input.quantidadeEmbalagens ?? input.quantidade_embalagens, 4);
  const quantidadePorEmbalagem = num(
    input.quantidadePorEmbalagem ?? input.quantidade_por_embalagem,
    4
  );
  const valorTotalEmbalagem = moeda(
    input.valorTotalEmbalagem ?? input.valor_total_embalagem ?? 0
  );
  const margemPercentual = num(input.margemPercentual ?? input.margem_lucro ?? 0, 2);

  const quantidadeEstoque = num(quantidadeEmbalagens * quantidadePorEmbalagem, 4);
  const custoUnitario = quantidadeEstoque > 0
    ? num(valorTotalEmbalagem / quantidadeEstoque, 4)
    : 0;

  let precoVendaUnitario = num(input.precoVendaUnitario ?? input.preco_venda_sugerido, 2);
  if (!(precoVendaUnitario > 0) && custoUnitario > 0) {
    precoVendaUnitario = moeda(custoUnitario * (1 + margemPercentual / 100));
  }

  const valorEmbalagemVenda = moeda(precoVendaUnitario * quantidadePorEmbalagem);

  let margemCalculada = margemPercentual;
  if (custoUnitario > 0 && precoVendaUnitario > 0) {
    margemCalculada = num(((precoVendaUnitario - custoUnitario) / custoUnitario) * 100, 2);
  }

  return {
    unidadeComercial: normalizarUnidadeComercial(input.unidadeComercial || input.unidade_comercial),
    quantidadeEmbalagens,
    quantidadePorEmbalagem,
    quantidadeEstoque,
    valorTotalEmbalagem,
    custoUnitario,
    precoVendaUnitario,
    valorEmbalagemVenda,
    margemPercentual: margemCalculada
  };
}

/**
 * RC8.4.2 — Produto com modo "comprado por embalagem" ativo.
 */
function produtoUsaCompraPorEmbalagem(produto = {}) {
  return Number(produto.compra_por_embalagem ?? produto.compraPorEmbalagem ?? 0) === 1;
}

/**
 * Formação de preço no cadastro (custo unitário + margem + embalagem).
 * RC8.4.2: quando compraPorEmbalagem=true, custo = valorEmbalagem ÷ qtd.
 */
function calcularFormacaoPrecoCadastro(input = {}) {
  const compraPorEmbalagem = input.compraPorEmbalagem === true
    || Number(input.compra_por_embalagem) === 1;
  const unidadeComercial = normalizarUnidadeComercial(input.unidadeComercial || input.unidade_comercial);
  const quantidadePorEmbalagem = (compraPorEmbalagem || exigeQuantidadePorEmbalagem(unidadeComercial))
    ? Math.max(0, num(input.quantidadePorEmbalagem ?? input.quantidade_por_embalagem, 4))
    : 1;

  let custoUnitario = num(input.custoUnitario ?? input.preco_compra, 4);
  const valorEmbalagemCompra = moeda(
    input.valorEmbalagemCompra
      ?? input.valor_compra_embalagem
      ?? input.valor_total_embalagem
      ?? 0
  );

  if (compraPorEmbalagem && valorEmbalagemCompra > 0 && quantidadePorEmbalagem > 0) {
    custoUnitario = num(valorEmbalagemCompra / quantidadePorEmbalagem, 4);
  } else if (!compraPorEmbalagem && exigeQuantidadePorEmbalagem(unidadeComercial)
    && valorEmbalagemCompra > 0 && quantidadePorEmbalagem > 0) {
    custoUnitario = num(valorEmbalagemCompra / quantidadePorEmbalagem, 4);
  }

  const margemPercentual = num(input.margemPercentual ?? input.lucro_percentual ?? 0, 2);
  let precoVendaUnitario = num(input.precoVendaUnitario ?? input.preco_venda, 2);

  const origem = String(input.origem || 'custo');
  if (origem === 'venda' && custoUnitario > 0 && precoVendaUnitario > 0) {
    return {
      compraPorEmbalagem,
      unidadeComercial,
      quantidadePorEmbalagem,
      custoUnitario,
      precoVendaUnitario,
      margemPercentual: num(((precoVendaUnitario - custoUnitario) / custoUnitario) * 100, 2),
      valorEmbalagemCompra: compraPorEmbalagem
        ? valorEmbalagemCompra
        : moeda(custoUnitario * quantidadePorEmbalagem),
      valorEmbalagemVenda: moeda(precoVendaUnitario * quantidadePorEmbalagem)
    };
  }

  if (!(precoVendaUnitario > 0) || origem === 'custo' || origem === 'margem' || origem === 'embalagem') {
    precoVendaUnitario = moeda(custoUnitario * (1 + margemPercentual / 100));
  }

  return {
    compraPorEmbalagem,
    unidadeComercial,
    quantidadePorEmbalagem,
    custoUnitario,
    precoVendaUnitario,
    margemPercentual,
    valorEmbalagemCompra: compraPorEmbalagem && valorEmbalagemCompra > 0
      ? valorEmbalagemCompra
      : moeda(custoUnitario * quantidadePorEmbalagem),
    valorEmbalagemVenda: moeda(precoVendaUnitario * quantidadePorEmbalagem)
  };
}

/**
 * Identifica unidade comercial a partir do uCom do XML (sem alterar o XML).
 */
function identificarUnidadeDoXml(uCom) {
  return normalizarUnidadeComercial(uCom);
}

function normalizarUnidadeEntradaNfe(valor) {
  const raw = String(valor || '').trim().toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
  return MAPA_UCOM_XML[raw] || raw;
}

function primeiroNumeroPositivo(...valores) {
  for (const valor of valores) {
    const numero = num(valor, 4);
    if (numero > 0) return numero;
  }
  return 0;
}

function precoComercialDaNota(item = {}, quantidadeComercial = 0) {
  const explicito = primeiroNumeroPositivo(
    item.preco_unitario_comercial,
    item.vUnCom,
    item.preco_apresentacao
  );
  if (explicito > 0) return explicito;
  const total = primeiroNumeroPositivo(
    item.valor_total_embalagem,
    item.subtotal,
    item.valor_total
  );
  if (total > 0 && quantidadeComercial > 0) return num(total / quantidadeComercial, 4);
  return num(item.preco_unitario, 4);
}

/**
 * NF-e lançada na unidade de estoque, mas no preço do pacote cadastrado.
 * Ex.: 1 UN a R$ 615, com pacote ×100 e custo unitário R$ 6,15 → 100 UN a R$ 6,15.
 * Não vale para CX/FD/KG nem quando qTrib já informa outra quantidade de estoque.
 */
function fatorPacotePeloPrecoDaEmbalagem(item, produto, unidadeComercial, unidadeEstoque, quantidadeComercial, quantidadeTributavel) {
  if (Number(produto?.compra_por_embalagem || 0) !== 1) return 0;
  const fator = num(produto?.quantidade_por_embalagem, 4);
  const precoPacote = num(produto?.valor_compra_embalagem, 4);
  const precoUnitario = num(produto?.preco_compra, 4);
  if (!(fator > 1) || !(precoPacote > 0) || !Number.isFinite(Number(produto?.preco_compra))) return 0;

  const unidadePacote = normalizarUnidadeEntradaNfe(produto?.unidade_comercial || 'PACOTE');
  const unidadeCompativel = unidadeComercial === unidadeEstoque
    || unidadeComercial === unidadePacote
    || unidadeComercial === 'PACOTE';
  if (!unidadeCompativel) return 0;
  if (quantidadeTributavel > 0 && quantidadeComercial > 0
      && Math.abs(quantidadeTributavel - quantidadeComercial) > 0.001) {
    return 0;
  }

  const precoXml = precoComercialDaNota(item, quantidadeComercial);
  if (!(precoXml > 0)) return 0;
  if (!(Math.abs(precoXml - precoPacote) < Math.abs(precoXml - precoUnitario))) return 0;
  return fator;
}

function resolverQuantidadeEntradaNfe(item = {}, produto = {}, apresentacao = null) {
  const quantidadeComercial = num(
    item.quantidade_comercial ?? item.quantidade_embalagens ?? item.quantidade ?? item.qCom,
    4
  );
  const unidadeComercialRaw = item.unidade_comercial || item.uCom || item.unidade || 'UN';
  const unidadeTributavelRaw = item.unidade_tributavel || item.uTrib || '';
  const unidadeComercial = normalizarUnidadeEntradaNfe(unidadeComercialRaw);
  const apresentacoes = Array.isArray(produto?.embalagens) ? produto.embalagens : [];
  const apresentacaoCorrespondente = apresentacao || apresentacoes.find((opcao) =>
    Number(opcao?.ativa ?? 1) === 1
      && Number(opcao?.compra ?? 1) === 1
      && normalizarUnidadeEntradaNfe(opcao.tipo || opcao.unidade_comercial) === unidadeComercial
  ) || null;
  const unidadeEstoqueRaw = apresentacaoCorrespondente?.unidade
    || produto?.unidade
    || item.unidade_estoque
    || item.unidade
    || unidadeComercialRaw;
  const unidadeTributavel = normalizarUnidadeEntradaNfe(unidadeTributavelRaw);
  const unidadeEstoque = normalizarUnidadeEntradaNfe(unidadeEstoqueRaw);
  const quantidadeTributavel = num(
    item.quantidade_tributavel ?? item.qTrib,
    4
  );

  let fator = num(
    apresentacaoCorrespondente?.quantidade
      ?? apresentacaoCorrespondente?.quantidade_por_embalagem
      ?? item.quantidade_por_embalagem
      ?? item.fator_conversao
      ?? 0,
    4
  );

  if (!(fator > 0) && produto && normalizarUnidadeEntradaNfe(produto.unidade_comercial) === unidadeComercial) {
    fator = num(produto.quantidade_por_embalagem, 4);
  }

  const fatorPacote = fatorPacotePeloPrecoDaEmbalagem(
    item,
    produto,
    unidadeComercial,
    unidadeEstoque,
    quantidadeComercial,
    quantidadeTributavel
  );
  if (!(fator > 1) && fatorPacote > 1) {
    fator = fatorPacote;
  }
  const pacotePeloPreco = fatorPacote > 1 && Math.abs(fator - fatorPacote) < 0.001;
  const qTribRepeteQuantidadeComercial = quantidadeComercial > 0
    && quantidadeTributavel > 0
    && Math.abs(quantidadeTributavel - quantidadeComercial) <= 0.001;

  if (unidadeComercial === unidadeEstoque && !pacotePeloPreco) {
    return {
      ok: true,
      origem: 'QCOM_UNIDADE_ESTOQUE',
      quantidadeComercial,
      quantidadeEstoque: quantidadeComercial,
      unidadeComercial,
      unidadeEstoque,
      fatorConversao: 1,
      apresentacaoId: apresentacaoCorrespondente?.id || null
    };
  }

  if (fator > 0) {
    const divisor = String(apresentacaoCorrespondente?.tipoConversao || item.tipo_conversao || '').toUpperCase() === 'DIVISOR';
    const quantidadeConvertida = num(
      divisor ? quantidadeComercial / fator : quantidadeComercial * fator,
      4
    );

    if (quantidadeTributavel > 0 && unidadeTributavel === unidadeEstoque
        && !(pacotePeloPreco && qTribRepeteQuantidadeComercial)
        && Math.abs(quantidadeConvertida - quantidadeTributavel) > 0.001) {
      return {
        ok: false,
        codigo: 'DIVERGENCIA_QTRIB_FATOR',
        erro: `qTrib (${quantidadeTributavel} ${unidadeTributavel}) diverge da conversão cadastrada (${quantidadeConvertida} ${unidadeEstoque}).`,
        quantidadeComercial,
        quantidadeTributavel,
        quantidadeConvertida,
        unidadeComercial,
        unidadeEstoque,
        fatorConversao: fator,
        apresentacaoId: apresentacaoCorrespondente?.id || null
      };
    }

    return {
      ok: true,
      origem: 'FATOR_APRESENTACAO',
      quantidadeComercial,
      quantidadeEstoque: quantidadeConvertida,
      unidadeComercial,
      unidadeEstoque,
      fatorConversao: fator,
      apresentacaoId: apresentacaoCorrespondente?.id || null
    };
  }

  if (quantidadeTributavel > 0 && unidadeTributavel === unidadeEstoque) {
    return {
      ok: true,
      origem: 'QTRIB_UNIDADE_ESTOQUE',
      quantidadeComercial,
      quantidadeEstoque: quantidadeTributavel,
      unidadeComercial,
      unidadeEstoque,
      fatorConversao: quantidadeComercial > 0
        ? num(quantidadeTributavel / quantidadeComercial, 4)
        : 0,
      apresentacaoId: null
    };
  }

  return {
    ok: false,
    codigo: 'FATOR_CONVERSAO_AUSENTE',
    erro: `Não há conversão confirmada de ${unidadeComercial} para ${unidadeEstoque}; informe uma apresentação/fator ou um qTrib compatível.`,
    quantidadeComercial,
    quantidadeTributavel,
    unidadeComercial,
    unidadeEstoque,
    fatorConversao: 0,
    apresentacaoId: null
  };
}

function listarUnidadesComerciais() {
  return UNIDADES_COMERCIAIS.map((codigo) => ({
    codigo,
    label: LABELS_UNIDADE_COMERCIAL[codigo] || codigo
  }));
}

module.exports = {
  UNIDADES_COMERCIAIS,
  LABELS_UNIDADE_COMERCIAL,
  MAPA_UCOM_XML,
  normalizarUnidadeComercial,
  exigeQuantidadePorEmbalagem,
  produtoUsaCompraPorEmbalagem,
  calcularCompraEmbalagem,
  calcularFormacaoPrecoCadastro,
  identificarUnidadeDoXml,
  normalizarUnidadeEntradaNfe,
  resolverQuantidadeEntradaNfe,
  listarUnidadesComerciais,
  num,
  moeda
};
