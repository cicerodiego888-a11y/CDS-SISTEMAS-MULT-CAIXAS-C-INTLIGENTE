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
  listarUnidadesComerciais,
  num,
  moeda
};
