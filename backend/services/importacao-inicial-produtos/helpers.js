/**
 * Importação Inicial de Produtos V1 — helpers de normalização e pricing.
 */
'use strict';

const MotorUnidadesMedida = require('../unidades/MotorUnidadesMedida');
const {
  chaveNomeCadastroSimples,
  normalizarNomeCadastroSimples
} = require('../cadastroSimplesNome');

const MARKUP_PADRAO = 100;
const MODOS = Object.freeze({
  CADASTRO_INICIAL: 'CADASTRO_INICIAL',
  ATUALIZAR_QUANTIDADES: 'ATUALIZAR_QUANTIDADES'
});

/** Legado V1.0.18 — opcional; não controla mais distribuição de estoque (V2). */
const MODOS_FISCAIS_IMPORTACAO = Object.freeze({
  FISCAL: 'FISCAL',
  NAO_FISCAL: 'NAO_FISCAL'
});

/** CSOSN aceitos no cadastro / NFC-e Simples Nacional. */
const CSOSN_ACEITOS_IMPORTACAO = Object.freeze([
  '101', '102', '103', '300', '400', '500', '900'
]);

/**
 * Valida modo_fiscal_importacao (legado, opcional na V2).
 * Ausente → null. Inválido → erro.
 * @returns {'FISCAL'|'NAO_FISCAL'|null}
 */
function validarModoFiscalImportacao(valor) {
  if (valor == null || valor === '') {
    return null;
  }
  if (typeof valor === 'boolean' || valor === 0 || valor === 1 || valor === '0' || valor === '1'
    || valor === true || valor === false) {
    const err = new Error('modo_fiscal_importacao inválido.');
    err.status = 400;
    err.codigo = 'MODO_FISCAL_INVALIDO';
    throw err;
  }
  const normalizado = String(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (normalizado === MODOS_FISCAIS_IMPORTACAO.FISCAL) {
    return MODOS_FISCAIS_IMPORTACAO.FISCAL;
  }
  if (normalizado === MODOS_FISCAIS_IMPORTACAO.NAO_FISCAL) {
    return MODOS_FISCAIS_IMPORTACAO.NAO_FISCAL;
  }
  const err = new Error('modo_fiscal_importacao inválido.');
  err.status = 400;
  err.codigo = 'MODO_FISCAL_INVALIDO';
  throw err;
}

function itemFiscalDeModoImportacao(modoFiscal) {
  return modoFiscal === MODOS_FISCAIS_IMPORTACAO.NAO_FISCAL ? 0 : 1;
}

function rotuloModoFiscalImportacao(modoFiscal) {
  if (!modoFiscal) return 'POR LINHA (Estoque Fiscal / Não Fiscal)';
  return modoFiscal === MODOS_FISCAIS_IMPORTACAO.NAO_FISCAL
    ? 'NÃO FISCAL — SEM NF'
    : 'FISCAL — COM NF';
}

/**
 * Controla Estoque: SIM=true, NÃO=false. Vazio → true (compatível com cadastro).
 */
function normalizarControlaEstoque(valor) {
  if (valor == null || String(valor).trim() === '') return true;
  const t = String(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  if (['NAO', 'N', '0', 'FALSE', 'NAO CONTROLA', 'SEM CONTROLE'].includes(t)) return false;
  if (['SIM', 'S', '1', 'TRUE', 'YES', 'CONTROLA'].includes(t)) return true;
  const err = new Error('Controla Estoque inválido. Use SIM ou NÃO.');
  err.status = 400;
  err.codigo = 'CONTROLA_ESTOQUE_INVALIDO';
  throw err;
}

function apenasDigitos(valor) {
  return String(valor == null ? '' : valor).replace(/\D/g, '');
}

function validarNcmImportacao(valor) {
  if (valor == null || String(valor).trim() === '') return { ok: true, valor: null };
  const dig = apenasDigitos(valor);
  if (dig.length !== 8) {
    return { ok: false, erro: 'NCM deve possuir exatamente 8 dígitos.', valor: dig || null };
  }
  return { ok: true, valor: dig };
}

function validarCfopImportacao(valor) {
  if (valor == null || String(valor).trim() === '') return { ok: true, valor: null };
  const dig = apenasDigitos(valor);
  if (dig.length !== 4) {
    return { ok: false, erro: 'CFOP deve possuir 4 dígitos.', valor: dig || null };
  }
  return { ok: true, valor: dig };
}

function validarCsosnImportacao(valor) {
  if (valor == null || String(valor).trim() === '') return { ok: true, valor: null };
  const dig = apenasDigitos(valor).padStart(3, '0').slice(-3);
  if (!CSOSN_ACEITOS_IMPORTACAO.includes(dig)) {
    return {
      ok: false,
      erro: `CSOSN inválido. Use: ${CSOSN_ACEITOS_IMPORTACAO.join(', ')}.`,
      valor: dig
    };
  }
  return { ok: true, valor: dig };
}

function campoTextoFiscalPreenchido(valor) {
  return valor != null && String(valor).trim() !== '';
}

/**
 * item_fiscal para produto NOVO (V2): baseado nos saldos da planilha.
 */
function resolverItemFiscalProdutoNovo({
  estoqueFiscal,
  estoqueNaoFiscal,
  controlaEstoque,
  modoFiscalLegado
} = {}) {
  if (controlaEstoque === false) return 1;
  const f = Number(estoqueFiscal) || 0;
  const nf = Number(estoqueNaoFiscal) || 0;
  if (f > 0 && nf <= 0) return 1;
  if (nf > 0 && f <= 0) return 0;
  if (f > 0 && nf > 0) return 1;
  if (modoFiscalLegado === MODOS_FISCAIS_IMPORTACAO.NAO_FISCAL) return 0;
  return 1;
}
const STATUS = Object.freeze({
  PRONTO: 'PRONTO',
  ATENCAO: 'ATENCAO',
  ERRO: 'ERRO',
  /** Mesmo codigo_origem aparece mais de uma vez no XLSX — bloqueia importação */
  CODIGO_DUPLICADO_ARQUIVO: 'CODIGO_DUPLICADO_ARQUIVO',
  EXISTENTE: 'EXISTENTE',
  /** Produto existe; há apresentação nova ou complemento (estoque/unidade) a aplicar */
  EXISTENTE_APRESENTACAO_NOVA: 'EXISTENTE_APRESENTACAO_NOVA',
  /** Produto existe; somar estoque e/ou atualizar custo/preço informados */
  EXISTENTE_ATUALIZAR: 'EXISTENTE_ATUALIZAR',
  OK: 'OK',
  NAO_ENCONTRADO: 'NAO_ENCONTRADO',
  APRESENTACAO_NAO_ENCONTRADA: 'APRESENTACAO_NAO_ENCONTRADA',
  JA_PROCESSADO: 'JA_PROCESSADO',
  PENDENTE_CLASSIFICACAO: 'PENDENTE_CLASSIFICACAO',
  CATEGORIA_NAO_ENCONTRADA: 'CATEGORIA_NAO_ENCONTRADA',
  SUBCATEGORIA_INCOMPATIVEL: 'SUBCATEGORIA_INCOMPATIVEL'
});

function linhaBloqueiaPorClassificacao(linha) {
  if (!linha) return false;
  if (linha.status === STATUS.PENDENTE_CLASSIFICACAO) return true;
  const cl = linha.classificacao || {};
  return linha.status === STATUS.ATENCAO && cl.status === 'PENDENTE_CLASSIFICACAO';
}

function linhaAtencaoPermiteImportar(linha) {
  if (!linha || linha.status !== STATUS.ATENCAO) return false;
  const cl = linha.classificacao || {};
  const conf = String(cl.confianca || '');
  const classificada = cl.status === 'CLASSIFICADO' || cl.status === 'PRESERVADO';
  return classificada && (conf === 'ALTA' || conf === 'MÉDIA');
}

const POLITICA_PENDENTES = Object.freeze({
  IGNORAR: 'IGNORAR',
  IMPORTAR_SEM_CLASSIFICACAO: 'IMPORTAR_SEM_CLASSIFICACAO'
});

function validarPoliticaPendentes(valor, { obrigatorio = false } = {}) {
  if (valor == null || String(valor).trim() === '') {
    if (obrigatorio) {
      const err = new Error(
        'Selecione o destino dos produtos sem classificação (politica_pendentes).'
      );
      err.status = 400;
      throw err;
    }
    return null;
  }
  const v = String(valor).trim().toUpperCase();
  if (v !== POLITICA_PENDENTES.IGNORAR && v !== POLITICA_PENDENTES.IMPORTAR_SEM_CLASSIFICACAO) {
    const err = new Error(
      'politica_pendentes inválida. Use IGNORAR ou IMPORTAR_SEM_CLASSIFICACAO.'
    );
    err.status = 400;
    throw err;
  }
  return v;
}

/**
 * Identifica apresentação existente.
 * Prioridade: id → gtin → cód. fornecedor → tipo + qtd + unidade base.
 */
function encontrarApresentacaoCorrespondente(arquivo, existentes) {
  const lista = Array.isArray(existentes) ? existentes : [];
  if (arquivo && arquivo.id != null && arquivo.id !== '') {
    const porId = lista.find((e) => Number(e.id) === Number(arquivo.id));
    if (porId) return porId;
  }
  const gtin = String(arquivo.gtin || arquivo.codigo_barras || '').trim();
  if (gtin) {
    const porGtin = lista.find((e) => String(e.gtin || '').trim() === gtin);
    if (porGtin) return porGtin;
  }
  const codForn = String(arquivo.codigo_fornecedor || '').trim();
  if (codForn) {
    const porCod = lista.find((e) => String(e.codigo_fornecedor || '').trim() === codForn);
    if (porCod) return porCod;
  }
  const tipo = String(arquivo.tipo || '').toUpperCase();
  const qtd = Number(arquivo.quantidade || 0);
  const unArq = normalizarUnidadeBaseCadastro(arquivo.unidade || '');
  return lista.find((e) => {
    if (String(e.tipo || '').toUpperCase() !== tipo) return false;
    if (Number(e.quantidade || 0) !== qtd) return false;
    if (!arquivo.unidade) return true;
    const unDb = normalizarUnidadeBaseCadastro(e.unidade || '');
    return unDb === unArq || unDb === 'un' /* legado */;
  }) || null;
}

function classificarApresentacoesArquivo(apresentacoesArquivo, apresentacoesDb) {
  const novas = [];
  const existentes = [];
  const usados = new Set();
  (apresentacoesArquivo || []).forEach((a) => {
    const candidatos = (apresentacoesDb || []).filter((e) => !usados.has(e.id));
    const hit = encontrarApresentacaoCorrespondente(a, candidatos);
    if (hit) {
      usados.add(hit.id);
      existentes.push({ arquivo: a, db: hit });
    } else {
      novas.push(a);
    }
  });
  return { novas, existentes };
}

/** Converte linha de produto_embalagens para o formato do arquivo/importação. */
function embDbParaLinhaArquivo(row) {
  return {
    id: row.id,
    tipo: row.tipo,
    descricao: row.descricao || null,
    quantidade: Number(row.quantidade) || 1,
    unidade: String(row.unidade || 'UN').toUpperCase(),
    custo: Number(row.valor_compra) || null,
    valor_compra: Number(row.valor_compra) || null,
    preco: Number(row.preco_venda) || null,
    preco_venda: Number(row.preco_venda) || null,
    gtin: row.gtin || null,
    codigo_barras: row.gtin || null,
    codigo_fornecedor: row.codigo_fornecedor || null,
    fornecedor_nome: row.fornecedor_nome || null,
    principal: Number(row.principal),
    compra: Number(row.compra),
    venda: Number(row.venda),
    estoque: Number(row.estoque),
    ativa: Number(row.ativa)
  };
}

/**
 * Mescla apresentações do arquivo com as do banco (serviço faz DELETE+INSERT).
 * Não remove apresentações do banco que não estão no arquivo.
 */
function mesclarApresentacoesParaSync(apresentacoesArquivo, apresentacoesDb) {
  const classif = classificarApresentacoesArquivo(apresentacoesArquivo, apresentacoesDb);
  const usadosDb = new Set(classif.existentes.map((e) => e.db.id));
  const merged = [];

  (apresentacoesDb || []).forEach((dbRow) => {
    if (!usadosDb.has(dbRow.id)) {
      merged.push(embDbParaLinhaArquivo(dbRow));
    }
  });

  classif.existentes.forEach(({ arquivo: a, db }) => {
    const base = embDbParaLinhaArquivo(db);
    const valorCompra = Number(a.valor_compra ?? a.custo);
    const precoVenda = Number(a.preco_venda ?? a.preco);
    merged.push({
      ...base,
      descricao: a.descricao || base.descricao,
      unidade: a.unidade || base.unidade,
      valor_compra: Number.isFinite(valorCompra) && valorCompra > 0 ? valorCompra : base.valor_compra,
      custo: Number.isFinite(valorCompra) && valorCompra > 0 ? valorCompra : base.custo,
      preco_venda: Number.isFinite(precoVenda) && precoVenda > 0 ? precoVenda : base.preco_venda,
      preco: Number.isFinite(precoVenda) && precoVenda > 0 ? precoVenda : base.preco,
      gtin: a.gtin || a.codigo_barras || base.gtin,
      codigo_barras: a.gtin || a.codigo_barras || base.codigo_barras,
      codigo_fornecedor: a.codigo_fornecedor || base.codigo_fornecedor,
      fornecedor_nome: a.fornecedor_nome || base.fornecedor_nome,
      principal: flagOpcional(a.principal) ?? base.principal,
      compra: flagOpcional(a.compra) ?? base.compra,
      venda: flagOpcional(a.venda) ?? base.venda,
      estoque: flagOpcional(a.estoque) ?? base.estoque,
      ativa: flagOpcional(a.ativa) ?? base.ativa
    });
  });

  classif.novas.forEach((a) => merged.push(a));
  return { merged, classif };
}

function chaveHeader(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/%/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Resolve valor da linha por aliases normalizados (não depende da posição).
 */
function valorPorAliases(row, aliases) {
  const mapa = new Map();
  Object.keys(row || {}).forEach((h) => {
    const chave = chaveHeader(h);
    if (chave && !mapa.has(chave)) mapa.set(chave, h);
  });
  for (const alias of aliases) {
    const chave = chaveHeader(alias);
    if (!chave) continue;
    if (mapa.has(chave)) {
      const original = mapa.get(chave);
      const valor = row[original];
      if (valor !== undefined && valor !== null && String(valor).trim() !== '') {
        return valor;
      }
    }
  }
  return null;
}

function texto(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

/**
 * Unidade base do produto — mesmos códigos do select do cadastro manual.
 * Metro = "mt" (não "m"). Espelho de miip-central-revisao / produtos.js.
 */
function normalizarUnidadeBaseCadastro(valor) {
  const raw = String(valor || '').trim().toLowerCase();
  if (!raw) return 'un';
  const chave = chaveHeader(valor);
  const mapa = {
    un: 'un',
    und: 'un',
    unidade: 'un',
    kg: 'kg',
    quilograma: 'kg',
    kilo: 'kg',
    g: 'g',
    grama: 'g',
    l: 'l',
    lt: 'l',
    litro: 'l',
    ml: 'ml',
    mililitro: 'ml',
    m: 'mt',
    mt: 'mt',
    metro: 'mt',
    metros: 'mt',
    m2: 'm2',
    m_2: 'm2',
    metro_quadrado: 'm2',
    m3: 'm3',
    m_3: 'm3',
    metro_cubico: 'm3'
  };
  return mapa[raw] || mapa[chave] || raw;
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  const raw = String(valor).trim().replace(/\s/g, '');
  if (!raw) return null;
  const normalizado = raw.includes(',') && raw.includes('.')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(',', '.');
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** True se a planilha trouxe número (vazio = não alterar em produto existente). */
function campoNumericoInformado(valor) {
  return valor !== null && valor !== undefined && valor !== '' && Number.isFinite(Number(valor));
}

function valoresNumericosDivergem(informado, atual, eps = 0.0001) {
  if (!campoNumericoInformado(informado)) return false;
  if (!Number.isFinite(Number(atual))) return true;
  return Math.abs(Number(informado) - Number(atual)) > eps;
}

const LABEL_NAO_ALTERAR = '— não alterar —';
const LABEL_SEM_ALTERACAO = 'sem alteração';

function formatarMoedaBr(valor) {
  if (!Number.isFinite(Number(valor))) return '—';
  return `R$ ${Number(valor).toFixed(2).replace('.', ',')}`;
}

/** Prévia: "R$ 10,00 → R$ 12,00" ou só o atual quando não altera. */
function rotuloCampoMoedaExistente({ atual, novo, altera }) {
  const atualFmt = formatarMoedaBr(atual);
  if (altera === true) return `${atualFmt} → ${formatarMoedaBr(novo)}`;
  return atualFmt;
}

function arredondarCasas(valor, casas = 2) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

function arredondarMoeda(valor) {
  return arredondarCasas(valor, 2);
}

function calcularPrecoPorMarkup(custo, markup = MARKUP_PADRAO, casas = 2) {
  const c = Number(custo);
  const k = Number(markup);
  if (!Number.isFinite(c) || c < 0) return null;
  if (!Number.isFinite(k)) return null;
  return arredondarCasas(c * (1 + k / 100), casas);
}

/**
 * V1.1.8 — markup derivado do preço oficial persistido.
 * markup = ((precoVenda − custo) / custo) × 100
 */
function derivarMarkupPercentual(custo, precoVenda, casas = 2) {
  const c = Number(custo);
  const p = Number(precoVenda);
  if (!(c > 0) || !Number.isFinite(p)) return null;
  return arredondarCasas(((p - c) / c) * 100, casas);
}

/**
 * Markup a gravar em produtos.lucro_percentual.
 * 1) markup informado no XLSX → usa o informado
 * 2) senão, custo > 0 e venda > 0 → deriva do preço oficial
 * 3) senão, só custo (produto novo) → MARKUP_PADRAO para formação
 * 4) senão → null (não inventar 100 nem sobrescrever existente)
 */
function resolverLucroPercentualPersistido({
  markupInformado,
  custo,
  precoVenda,
  usarPadraoQuandoSoCusto = false
} = {}) {
  if (campoNumericoInformado(markupInformado)) {
    return arredondarCasas(Number(markupInformado), 2);
  }
  const derivado = derivarMarkupPercentual(custo, precoVenda);
  if (derivado !== null && Number(precoVenda) > 0) {
    return derivado;
  }
  if (usarPadraoQuandoSoCusto && Number(custo) > 0) {
    return MARKUP_PADRAO;
  }
  return null;
}

/**
 * Custo unitário via MotorUnidadesMedida (mesmo do cadastro manual).
 */
function calcularCustoUnitarioDeEmbalagem(custoEmbalagem, quantidadePorEmbalagem, tipo = 'PCT') {
  const formacao = MotorUnidadesMedida.calcularFormacaoPrecoCadastro({
    compraPorEmbalagem: true,
    unidadeComercial: tipo,
    quantidadePorEmbalagem,
    valorEmbalagemCompra: custoEmbalagem,
    margemPercentual: 0,
    origem: 'custo'
  });
  return formacao.custoUnitario;
}

/**
 * Preço informado parece preço da embalagem (não da unidade base)?
 * Ex.: 501,47 com valor compra rolo 250,74 — não pode ir em produtos.preco_venda.
 */
function precoInformadoPareceEmbalagem(precoInformado, valorEmbalagemCompra, markup) {
  const p = Number(precoInformado);
  const emb = Number(valorEmbalagemCompra);
  if (!(p > 0) || !(emb > 0)) return false;
  const precoEmbEsperado = emb * (1 + (Number(markup) || 0) / 100);
  if (p >= emb * 0.9) return true;
  if (Math.abs(p - precoEmbEsperado) / Math.max(precoEmbEsperado, 0.01) < 0.05) return true;
  return false;
}

/**
 * Formação de preço oficial (cadastro manual / MotorUnidadesMedida).
 *
 * Com apresentação válida (valor_compra + conversão > 1):
 *   custo unitário = valor_compra ÷ quantidade  (nunca sobrescrito pelo custo do rolo)
 *   preço unitário → produtos.preco_venda
 *   preço apresentação → produto_embalagens.preco_venda
 */
function calcularFormacaoPrecoOficial({
  valorEmbalagemCompra,
  quantidadePorEmbalagem,
  tipo,
  markup = MARKUP_PADRAO,
  custoUnitarioInformado = null,
  precoVendaInformado = null
}) {
  const qtd = Number(quantidadePorEmbalagem) || 1;
  const temEmbalagem = Number(valorEmbalagemCompra) > 0 && qtd > 1;

  if (temEmbalagem) {
    // Precedência: apresentação define o custo da unidade base.
    // custoUnitarioInformado NÃO sobrescreve (evita 250,74 × 2 → 501,47 em preco_venda).
    const formacao = MotorUnidadesMedida.calcularFormacaoPrecoCadastro({
      compraPorEmbalagem: true,
      unidadeComercial: tipo || 'PCT',
      quantidadePorEmbalagem: qtd,
      valorEmbalagemCompra: Number(valorEmbalagemCompra),
      margemPercentual: markup,
      origem: 'custo'
    });
    const custoUnitario = formacao.custoUnitario;

    // Precisão: markup sobre custo (4 casas) — não arredondar a 2 casas antes do markup
    let precoVenda = MotorUnidadesMedida.num(
      Number(custoUnitario) * (1 + Number(markup) / 100),
      4
    );
    const precoInf = Number(precoVendaInformado);
    if (
      precoInf > 0
      && !precoInformadoPareceEmbalagem(precoInf, valorEmbalagemCompra, markup)
    ) {
      precoVenda = MotorUnidadesMedida.num(precoInf, 4);
    }

    // Preço da apresentação = unitário × conversão (moeda 2 casas)
    const precoApresentacao = MotorUnidadesMedida.moeda(Number(precoVenda) * qtd);

    return {
      custo_unitario: custoUnitario,
      preco_venda: precoVenda,
      valor_compra_apresentacao: Number(valorEmbalagemCompra),
      preco_apresentacao: precoApresentacao,
      markup
    };
  }

  // Sem apresentação/conversão válida: custo informado da unidade base permanece válido
  const custo = Number.isFinite(Number(custoUnitarioInformado))
    ? MotorUnidadesMedida.num(custoUnitarioInformado, 4)
    : 0;
  const formacao = MotorUnidadesMedida.calcularFormacaoPrecoCadastro({
    compraPorEmbalagem: false,
    custoUnitario: custo,
    margemPercentual: markup,
    precoVendaUnitario: precoVendaInformado,
    origem: Number(precoVendaInformado) > 0 ? 'venda' : 'custo'
  });
  return {
    custo_unitario: formacao.custoUnitario,
    preco_venda: formacao.precoVendaUnitario,
    valor_compra_apresentacao: null,
    preco_apresentacao: null,
    markup
  };
}

/**
 * Flag 0/1 da planilha; null se ausente (serviço aplica default).
 */
function flagOpcional(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  return n === 1 ? 1 : 0;
}

/**
 * Payload de apresentação no formato do ProdutoEmbalagemService / cadastro manual.
 */
function montarEmbalagensParaServico(apresentacoes, unidadeBase, { origem = 'IMPORTACAO_INICIAL' } = {}) {
  return (Array.isArray(apresentacoes) ? apresentacoes : []).map((a) => {
    const payload = {
      tipo: a.tipo || 'PCT',
      descricao: a.descricao || null,
      quantidade: Number(a.quantidade) || 1,
      unidade: String(unidadeBase || a.unidade || 'un').toLowerCase(),
      gtin: a.gtin || a.codigo_barras || null,
      codigo_fornecedor: a.codigo_fornecedor || null,
      fornecedor_nome: a.fornecedor_nome || a.fornecedor || null,
      valor_compra: Number(a.valor_compra ?? a.custo) || 0,
      preco_venda: Number(a.preco_venda ?? a.preco) || 0,
      origem
    };
    const principal = flagOpcional(a.principal);
    const compra = flagOpcional(a.compra);
    const venda = flagOpcional(a.venda);
    const estoque = flagOpcional(a.estoque);
    const ativa = flagOpcional(a.ativa);
    if (principal !== null) payload.principal = principal;
    if (compra !== null) payload.compra = compra;
    if (venda !== null) payload.venda = venda;
    if (estoque !== null) payload.estoque = estoque;
    if (ativa !== null) payload.ativa = ativa;
    return payload;
  });
}

/**
 * Fator de conversão da apresentação (Quantidade conversão); sem apresentação = 1.
 */
function resolverFatorConversao(apresentacoes) {
  const lista = Array.isArray(apresentacoes) ? apresentacoes : [];
  const principal = lista.find((a) => a.tipo !== 'UN' && Number(a.quantidade) > 1)
    || lista.find((a) => Number(a.quantidade) > 1)
    || null;
  if (principal && Number(principal.quantidade) > 0) {
    const fator = Number(principal.quantidade);
    const unidade = String(principal.unidade || 'UN').toUpperCase();
    return {
      fator,
      tipo: principal.tipo || null,
      unidade,
      label: `${fator} ${unidade}`,
      apresentacao: principal
    };
  }
  return { fator: 1, tipo: null, unidade: 'UN', label: '1 UN', apresentacao: null };
}

/**
 * ESTOQUE INICIAL legado = Qtd documento × fator de conversão (unidade base).
 * V2: Estoque Fiscal / Não Fiscal já vêm em unidade base (não recalcular).
 */
function calcularEstoqueInicial({ quantidadeDocumento, fatorConversao }) {
  const origemRaw = Number(quantidadeDocumento);
  const fatorRaw = Number(fatorConversao);
  const quantidade_origem = Number.isFinite(origemRaw) && origemRaw >= 0 ? origemRaw : 0;
  const fator_conversao = Number.isFinite(fatorRaw) && fatorRaw > 0 ? fatorRaw : 1;
  return {
    quantidade_origem,
    fator_conversao,
    estoque_inicial: arredondarCasas(quantidade_origem * fator_conversao, 3)
  };
}

/**
 * Monta saldos V2 a partir das colunas oficiais (UN base) ou legado Estoque Inicial.
 * @returns {{
 *   modo: 'V2'|'LEGADO'|'ZERO',
 *   estoque_fiscal: number,
 *   estoque_nao_fiscal: number,
 *   estoque_total: number,
 *   estoque_inicial: number,
 *   erro?: string
 * }}
 */
function resolverEstoquesImportacaoLinha(produto, { itemFiscalBucket = 1 } = {}) {
  const fiscalInf = campoNumericoInformado(produto.estoque_fiscal);
  const naoFiscalInf = campoNumericoInformado(produto.estoque_nao_fiscal);
  const temV2 = fiscalInf || naoFiscalInf;

  const apresentacoes = Array.isArray(produto._apresentacoes_pricing)
    ? produto._apresentacoes_pricing
    : [];
  const fatorInfo = resolverFatorConversao(apresentacoes);
  const fatorUsar = campoNumericoInformado(produto.fator_conversao)
    && Number(produto.fator_conversao) > 0
    ? Number(produto.fator_conversao)
    : fatorInfo.fator;
  const calcLegado = calcularEstoqueInicial({
    quantidadeDocumento: produto.quantidade_documento,
    fatorConversao: fatorUsar
  });
  const legadoPositivo = Number(calcLegado.estoque_inicial) > 0;

  if (temV2 && legadoPositivo) {
    return {
      modo: 'CONFLITO',
      estoque_fiscal: 0,
      estoque_nao_fiscal: 0,
      estoque_total: 0,
      estoque_inicial: 0,
      erro: 'Não utilize Estoque Inicial (Qtd. Origem/Conversão) junto com Estoque Fiscal / Estoque Não Fiscal.'
    };
  }

  if (temV2) {
    const f = fiscalInf ? Math.max(0, Number(produto.estoque_fiscal) || 0) : 0;
    const nf = naoFiscalInf ? Math.max(0, Number(produto.estoque_nao_fiscal) || 0) : 0;
    const total = arredondarCasas(f + nf, 3);
    return {
      modo: 'V2',
      estoque_fiscal: arredondarCasas(f, 3),
      estoque_nao_fiscal: arredondarCasas(nf, 3),
      estoque_total: total,
      estoque_inicial: total,
      quantidade_origem: calcLegado.quantidade_origem,
      fator_conversao: calcLegado.fator_conversao
    };
  }

  if (legadoPositivo) {
    const q = Number(calcLegado.estoque_inicial) || 0;
    const fiscal = itemFiscalBucket === 0 ? 0 : q;
    const naoFiscal = itemFiscalBucket === 0 ? q : 0;
    return {
      modo: 'LEGADO',
      estoque_fiscal: arredondarCasas(fiscal, 3),
      estoque_nao_fiscal: arredondarCasas(naoFiscal, 3),
      estoque_total: arredondarCasas(q, 3),
      estoque_inicial: arredondarCasas(q, 3),
      quantidade_origem: calcLegado.quantidade_origem,
      fator_conversao: calcLegado.fator_conversao
    };
  }

  return {
    modo: 'ZERO',
    estoque_fiscal: 0,
    estoque_nao_fiscal: 0,
    estoque_total: 0,
    estoque_inicial: 0,
    quantidade_origem: calcLegado.quantidade_origem,
    fator_conversao: calcLegado.fator_conversao
  };
}

/**
 * Custo total da movimentação de estoque inicial.
 * Com apresentação convertida: qtd origem × custo da apresentação.
 * Na unidade base: qtd origem × custo unitário.
 */
function calcularCustoTotalEstoqueInicial({
  quantidadeOrigem,
  custoUnitario,
  apresentacao
}) {
  const q = Number(quantidadeOrigem);
  if (!Number.isFinite(q) || q < 0) return 0;
  const apr = apresentacao || null;
  if (apr && Number(apr.quantidade) > 1 && Number.isFinite(Number(apr.custo)) && Number(apr.custo) > 0) {
    return arredondarCasas(q * Number(apr.custo), 6);
  }
  const cu = Number(custoUnitario);
  if (!Number.isFinite(cu)) return 0;
  return arredondarCasas(q * cu, 6);
}

function montarMotivoEstoqueInicial({ importId, codigoOrigem, custoUnitario, custoTotal }) {
  const partes = [
    'ESTOQUE INICIAL — IMPORTAÇÃO DE PRODUTOS',
    `import=${importId || 'n/a'}`,
    codigoOrigem ? `codigo=${codigoOrigem}` : null,
    Number.isFinite(Number(custoUnitario)) ? `custo_un=${Number(custoUnitario)}` : null,
    Number.isFinite(Number(custoTotal)) ? `custo_total=${Number(custoTotal)}` : null
  ].filter(Boolean);
  return partes.join(' | ');
}

function montarMotivoAtualizacaoQuantidades({ importId, codigoOrigem, origemArquivo }) {
  const partes = [
    'ATUALIZAÇÃO DE QUANTIDADES — IMPORTAÇÃO',
    `import=${importId || 'n/a'}`,
    codigoOrigem ? `codigo=${codigoOrigem}` : null,
    origemArquivo ? `origem=${origemArquivo}` : null
  ].filter(Boolean);
  return partes.join(' | ');
}

/**
 * Linha da aba QUANTIDADES (modo Atualizar Quantidades).
 */
function mapearLinhaQuantidade(row) {
  const get = (...aliases) => valorPorAliases(row, aliases);
  const fator = numero(get(
    'fator_conversao',
    'fator',
    'quantidade_conversao',
    'conversao'
  ));
  return {
    codigo_origem: texto(get(
      'codigo_origem',
      'codigo_origem_externo',
      'id_origem',
      'codigo',
      'sku'
    )),
    nome: texto(get(
      'nome_cds',
      'nome',
      'produto',
      'descricao',
      'nome_produto'
    )),
    unidade_base: texto(get('unidade_base', 'unidade')) || 'UN',
    unidade_origem: texto(get('unidade_origem')) || '',
    quantidade_documento: numero(get('quantidade_documento', 'qtd_documento', 'qtd', 'quantidade')),
    fator_conversao: fator,
    quantidade_estoque_inicial: numero(get(
      'quantidade_estoque_inicial',
      'estoque_inicial',
      'qtd_estoque_inicial'
    )),
    custo_informado: numero(get(
      'custo_unitario',
      'custo',
      'preco_compra',
      'preco_de_compra',
      'custo_un'
    )),
    preco_informado: numero(get(
      'preco_venda_unitario',
      'preco_de_venda',
      'preco_venda',
      'preco_unitario',
      'preco',
      'venda',
      'preco_un'
    )),
    referencia_fabricante: texto(get('referencia_fabricante', 'referencia', 'ref')),
    origem: texto(get('origem')),
    codigo_barras: texto(get('codigo_barras', 'ean', 'gtin', 'barras', 'gtin_ean')),
    marca: texto(get('marca'))
  };
}

function mapearTipoApresentacao(valor) {
  const t = chaveHeader(valor);
  const mapa = {
    un: 'UN',
    unidade: 'UN',
    kg: 'KG',
    cx: 'CX',
    caixa: 'CX',
    fd: 'FD',
    fardo: 'FD',
    pct: 'PCT',
    pacote: 'PCT',
    pkt: 'PCT',
    saco: 'SACO',
    rolo: 'ROLO',
    balde: 'BALDE',
    galao: 'GALAO',
    kit: 'KIT',
    display: 'DISPLAY',
    bobina: 'BOBINA'
  };
  return mapa[t] || (t ? t.toUpperCase().slice(0, 10) : 'PCT');
}

function mapearLinhaProduto(row) {
  const get = (...aliases) => valorPorAliases(row, aliases);

  // Planilha oficial CDS: "Nome CDS" (não "Nome")
  const nome = texto(get(
    'nome_cds',
    'nome',
    'produto',
    'descricao',
    'nome_produto',
    'descricao_produto'
  ));
  const custoInformado = numero(get(
    'custo_unitario',
    'custo',
    'preco_compra',
    'preco_de_compra',
    'custo_un'
  ));
  const markupInformado = numero(get(
    'markup',
    'markup_percentual',
    'markup_',
    'lucro_percentual',
    'markup_pct'
  ));
  const precoInformado = numero(get(
    'preco_venda_unitario',
    'preco_de_venda',
    'preco_venda',
    'preco_unitario',
    'preco',
    'venda',
    'preco_un'
  ));
  const markup = markupInformado === null ? MARKUP_PADRAO : markupInformado;
  const custoApresentacao = numero(get(
    'custo_apresentacao',
    'custo_apresentacao_origem',
    'custo_origem'
  ));

  return {
    codigo_origem: texto(get(
      'codigo_origem',
      'codigo_origem_externo',
      'id_origem',
      'codigo',
      'sku'
    )),
    nome,
    marca: texto(get('marca')),
    categoria: texto(get('categoria')),
    subcategoria: texto(get('subcategoria')),
    unidade_base: normalizarUnidadeBaseCadastro(
      texto(get('unidade_base', 'unidade', 'un')) || 'UN'
    ),
    unidade_origem: texto(get('unidade_origem')),
    quantidade_documento: numero(get('quantidade_documento', 'qtd_documento', 'qtd', 'quantidade', 'qtd_origem')),
    fator_conversao: numero(get('fator_conversao', 'fator', 'conversao', 'quantidade_conversao')),
    estoque_fiscal: numero(get(
      'estoque_fiscal',
      'qtd_fiscal',
      'quantidade_fiscal',
      'saldo_fiscal'
    )),
    estoque_nao_fiscal: numero(get(
      'estoque_nao_fiscal',
      'qtd_nao_fiscal',
      'quantidade_nao_fiscal',
      'saldo_nao_fiscal'
    )),
    controla_estoque_bruto: get('controla_estoque', 'controla_est', 'controla'),
    fornecedor: texto(get('fornecedor', 'fornecedor_nome', 'nome_fornecedor')),
    custo_informado: custoInformado,
    custo_apresentacao: custoApresentacao,
    markup,
    markup_informado: markupInformado,
    preco_informado: precoInformado,
    total_documento: numero(get('total_documento')),
    referencia_fabricante: texto(get('referencia_fabricante', 'referencia', 'ref')),
    codigo_barras: texto(get('codigo_barras', 'ean', 'gtin', 'barras', 'gtin_ean', 'codbarra')),
    ncm: texto(get('ncm')),
    cfop: texto(get('cfop')),
    csosn: texto(get('csosn')),
    cest: texto(get('cest')),
    observacoes: texto(get('observacoes', 'observacao', 'obs')),
    // Legado: informativo apenas — NÃO decide estoque nem item_fiscal efetivo (V2)
    fiscal_rotulo: texto(get('fiscal', 'classificacao')),
    fiscal: true,
    item_fiscal: 1
  };
}

function mapearLinhaApresentacao(row) {
  const get = (...aliases) => valorPorAliases(row, aliases);

  const tipoBruto = get('tipo', 'apresentacao', 'tipo_apresentacao', 'embalagem');
  const quantidade = numero(get(
    'quantidade_conversao',
    'quantidade',
    'qtd',
    'fator',
    'quantidade_por_embalagem',
    'qtd_un'
  )) || 0;
  const gtin = texto(get('gtin', 'codigo_barras', 'ean', 'barras'));
  const valorCompra = numero(get(
    'valor_compra_apresentacao',
    'valor_compra',
    'vlr_compra',
    'custo',
    'custo_embalagem',
    'preco_compra'
  ));
  // NÃO usar alias 'venda' — colide com a flag MUC "Venda" (0/1) da planilha
  const precoVenda = numero(get(
    'preco_venda_apresentacao',
    'preco_venda',
    'preco',
    'valor_venda',
    'valor_venda_apresentacao'
  ));

  return {
    codigo_origem: texto(get('codigo_origem', 'codigo_produto', 'codigo', 'sku', 'id_origem')),
    nome_produto: texto(get('nome_produto', 'produto', 'nome', 'nome_cds')),
    tipo: mapearTipoApresentacao(tipoBruto),
    descricao: texto(get('descricao', 'descricao_apresentacao')),
    quantidade,
    unidade: normalizarUnidadeBaseCadastro(
      texto(get('unidade_base', 'unidade')) || 'UN'
    ),
    custo: valorCompra,
    valor_compra: valorCompra,
    preco: precoVenda,
    preco_venda: precoVenda,
    principal: flagOpcional(get('principal', 'princ')),
    compra: flagOpcional(get('compra', 'na_compra')),
    venda: flagOpcional(get('venda', 'na_venda')),
    estoque: flagOpcional(get('estoque', 'est')),
    ativa: flagOpcional(get('ativa')),
    origem: texto(get('origem')),
    observacao: texto(get('observacao', 'observacoes')),
    fiscal_rotulo: texto(get('classificacao', 'fiscal')),
    codigo_barras: gtin,
    gtin,
    codigo_fornecedor: texto(get(
      'codigo_fornecedor',
      'cod_forn',
      'cod_fornecedor',
      'codigo_forn'
    )),
    fornecedor_nome: texto(get('fornecedor', 'fornecedor_nome', 'nome_fornecedor'))
  };
}

module.exports = {
  MARKUP_PADRAO,
  MODOS,
  MODOS_FISCAIS_IMPORTACAO,
  CSOSN_ACEITOS_IMPORTACAO,
  validarModoFiscalImportacao,
  itemFiscalDeModoImportacao,
  rotuloModoFiscalImportacao,
  normalizarControlaEstoque,
  validarNcmImportacao,
  validarCfopImportacao,
  validarCsosnImportacao,
  campoTextoFiscalPreenchido,
  resolverItemFiscalProdutoNovo,
  resolverEstoquesImportacaoLinha,
  STATUS,
  linhaBloqueiaPorClassificacao,
  linhaAtencaoPermiteImportar,
  POLITICA_PENDENTES,
  validarPoliticaPendentes,
  chaveHeader,
  valorPorAliases,
  texto,
  numero,
  campoNumericoInformado,
  valoresNumericosDivergem,
  LABEL_NAO_ALTERAR,
  LABEL_SEM_ALTERACAO,
  formatarMoedaBr,
  rotuloCampoMoedaExistente,
  arredondarMoeda,
  arredondarCasas,
  calcularPrecoPorMarkup,
  derivarMarkupPercentual,
  resolverLucroPercentualPersistido,
  calcularCustoUnitarioDeEmbalagem,
  calcularFormacaoPrecoOficial,
  precoInformadoPareceEmbalagem,
  flagOpcional,
  montarEmbalagensParaServico,
  resolverFatorConversao,
  calcularEstoqueInicial,
  calcularCustoTotalEstoqueInicial,
  montarMotivoEstoqueInicial,
  montarMotivoAtualizacaoQuantidades,
  mapearTipoApresentacao,
  mapearLinhaProduto,
  mapearLinhaApresentacao,
  mapearLinhaQuantidade,
  encontrarApresentacaoCorrespondente,
  classificarApresentacoesArquivo,
  embDbParaLinhaArquivo,
  mesclarApresentacoesParaSync,
  normalizarUnidadeBaseCadastro,
  chaveNomeCadastroSimples,
  normalizarNomeCadastroSimples,
  MotorUnidadesMedida
};
