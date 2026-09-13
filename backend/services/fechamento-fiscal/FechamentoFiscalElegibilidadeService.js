/**
 * Fechamento Fiscal do Dia — elegibilidade e monitoramento (READ-ONLY comercial).
 *
 * Regra oficial (Sprint 06):
 *   produto.item_fiscal = 1
 *   + operação NÃO FISCAL (sem NFC-e ativa no fluxo comercial normal)
 *   + consumo de saldo FISCAL (quantidade_fiscal > 0)
 *   → quantidade_elegivel = quantidade_fiscal (líquida de devoluções / já utilizada)
 *
 * quantidade_nao_fiscal NÃO é quantidade elegível — só auditoria/explicação.
 */

'use strict';

const { FILTRO_VENDA_VALIDA } = require('../reportFiscalHelpers');
const { arredondarMoeda, toCentavos } = require('../fiscal/modeloTotais');
const { STATUS } = require('./constants');
const {
  SITUACAO_NFCE,
  classificarSituacoesFiscaisPorVenda
} = require('./NfceSituacaoFiscalService');

const ORIGEM_LEGADA_AMBIGUA = 'ORIGEM_LEGADA_AMBIGUA';

function promisifyAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function promisifyGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function max0(n) {
  const x = Number(n || 0);
  return x > 0 ? x : 0;
}

/**
 * Valor comercial correspondente à quantidade fiscal elegível.
 * Preferência: valor_fiscal histórico proporcional; senão preço/subtotal da venda.
 * Nunca usa produtos.preco_venda atual.
 */
function calcularValorFiscalElegivel(row, quantidadeElegivel) {
  const qEleg = Number(quantidadeElegivel || 0);
  if (!(qEleg > 0)) return 0;

  const qFiscal = Number(row.quantidade_fiscal || 0);
  const vFiscal = Number(row.valor_fiscal || 0);
  if (qFiscal > 0 && vFiscal > 0) {
    return arredondarMoeda(vFiscal * (qEleg / qFiscal));
  }

  const preco = Number(row.preco_unitario || 0);
  if (preco > 0) {
    return arredondarMoeda(qEleg * preco);
  }

  const qOrig = Number(row.quantidade_original || row.quantidade || 0);
  const vOrig = Number(row.valor_original || row.subtotal || 0);
  if (qOrig > 0 && vOrig > 0) {
    return arredondarMoeda(vOrig * (qEleg / qOrig));
  }

  return 0;
}

function classificarOrigemDistribuicao(row) {
  const qF = Number(row.quantidade_fiscal || 0);
  const qNf = Number(row.quantidade_nao_fiscal || 0);
  const q = Number(row.quantidade_original || row.quantidade || 0);
  if (qF === 0 && qNf === 0 && q > 0) return ORIGEM_LEGADA_AMBIGUA;
  return null;
}

async function tabelaNfceExiste(db) {
  try {
    const row = await promisifyGet(
      db,
      `SELECT name FROM sqlite_master WHERE type='table' AND name='nfce_notas'`
    );
    return Boolean(row && row.name);
  } catch (_) {
    return false;
  }
}

async function carregarDevolucoesDoDia(db, dataNorm) {
  let devolucoes = [];
  try {
    devolucoes = await promisifyAll(
      db,
      `SELECT vd.venda_item_id AS venda_item_id,
              vd.produto_id AS produto_id,
              COALESCE(SUM(vd.quantidade), 0) AS qtd_dev,
              COALESCE(SUM(vd.valor_total), 0) AS valor_dev
       FROM vendas_devolucoes vd
       INNER JOIN vendas v ON v.id = vd.venda_id
       WHERE date(v.data_venda) = date(?)
       GROUP BY vd.venda_item_id, vd.produto_id`,
      [dataNorm]
    );
  } catch (_) {
    devolucoes = [];
  }

  const byItem = new Map();
  const byProduto = new Map();
  for (const d of devolucoes) {
    const itemId = Number(d.venda_item_id || 0);
    const pid = Number(d.produto_id || 0);
    if (itemId > 0) {
      byItem.set(itemId, {
        qtd: Number(d.qtd_dev || 0),
        valor: Number(d.valor_dev || 0)
      });
    }
    const prev = byProduto.get(pid) || { qtd: 0, valor: 0 };
    prev.qtd += Number(d.qtd_dev || 0);
    prev.valor += Number(d.valor_dev || 0);
    byProduto.set(pid, prev);
  }
  return { byItem, byProduto };
}

/**
 * Quantidades já consumidas em fechamentos ativos (não cancelados).
 * @param {number|null} excluirFechamentoId — ao regenerar prévia do próprio fechamento
 */
async function mapQuantidadesJaUtilizadas(db, dataNorm, excluirFechamentoId = null) {
  const map = new Map();
  try {
    const params = [dataNorm, STATUS.CANCELADO];
    let extra = '';
    if (excluirFechamentoId != null && Number(excluirFechamentoId) > 0) {
      extra = ' AND f.id != ?';
      params.push(Number(excluirFechamentoId));
    }
    const rows = await promisifyAll(
      db,
      `SELECT pi.venda_item_origem_id AS venda_item_id,
              COALESCE(SUM(pi.quantidade), 0) AS qtd_usada
       FROM fechamentos_fiscais_previa_itens pi
       INNER JOIN fechamentos_fiscais f ON f.id = pi.fechamento_fiscal_id
       WHERE date(f.data_fechamento) = date(?)
         AND f.status != ?
         AND pi.venda_item_origem_id IS NOT NULL
         ${extra}
       GROUP BY pi.venda_item_origem_id`,
      params
    );
    for (const r of rows) {
      const id = Number(r.venda_item_id || 0);
      if (id > 0) map.set(id, Number(r.qtd_usada || 0));
    }
  } catch (_) {
    /* schema ainda sem tabelas — ok em testes isolados */
  }
  return map;
}

async function carregarItensDia(db, dataNorm) {
  const temNfce = await tabelaNfceExiste(db);
  const rows = await promisifyAll(
    db,
    `SELECT
       vi.id AS venda_item_id,
       v.id AS venda_id,
       v.data_venda AS data_venda,
       p.id AS produto_id,
       p.nome AS nome,
       p.codigo AS codigo,
       COALESCE(p.item_fiscal, 0) AS item_fiscal,
       COALESCE(vi.quantidade, 0) AS quantidade_original,
       COALESCE(vi.quantidade_fiscal, 0) AS quantidade_fiscal,
       COALESCE(vi.quantidade_nao_fiscal, 0) AS quantidade_nao_fiscal,
       COALESCE(vi.subtotal, 0) AS valor_original,
       COALESCE(vi.valor_fiscal, 0) AS valor_fiscal,
       COALESCE(vi.valor_nao_fiscal, 0) AS valor_nao_fiscal,
       COALESCE(vi.preco_unitario, 0) AS preco_unitario,
       COALESCE(v.total, 0) AS venda_total,
       COALESCE(v.valor_fiscal, 0) AS venda_valor_fiscal,
       COALESCE(v.valor_nao_fiscal, 0) AS venda_valor_nao_fiscal
     FROM vendas_itens vi
     INNER JOIN vendas v ON v.id = vi.venda_id
     INNER JOIN produtos p ON p.id = vi.produto_id
     WHERE date(v.data_venda) = date(?)
       AND ${FILTRO_VENDA_VALIDA}
       AND COALESCE(v.cancelada, 0) = 0
     ORDER BY p.id ASC, v.id ASC, vi.id ASC`,
    [dataNorm]
  );

  const situacoes = temNfce
    ? await classificarSituacoesFiscaisPorVenda(db, rows.map((r) => r.venda_id))
    : new Map();

  return rows.map((row) => {
    const situacao = situacoes.get(Number(row.venda_id)) || {
      situacao: SITUACAO_NFCE.SEM_DOCUMENTO,
      documentada: false,
      exige_recuperacao: false,
      permite_decisao_automatica: true
    };
    return {
      ...row,
      situacao_fiscal_nfce: situacao.situacao,
      classificacao_fiscal_nfce: situacao,
      tem_documento_fiscal: situacao.documentada ? 1 : 0,
      decisao_fiscal_automatica_bloqueada: situacao.exige_recuperacao ? 1 : 0
    };
  });
}

/**
 * Operação não fiscal: sem documento fiscal ativo no fluxo comercial normal.
 * (Reutiliza nfce_notas — sem nova coluna de natureza.)
 */
function isOperacaoNaoFiscal(row) {
  if (
    row?.situacao_fiscal_nfce === SITUACAO_NFCE.DUPLICIDADE_PENDENTE
    || Number(row?.decisao_fiscal_automatica_bloqueada || 0) === 1
  ) {
    return false;
  }
  return Number(row?.tem_documento_fiscal || 0) === 0;
}

/**
 * Quantidade fiscal consumida em operação não fiscal (antes de devolução/uso).
 */
function quantidadeFiscalConsumidaEmOperacaoNaoFiscal(row) {
  if (Number(row.item_fiscal || 0) !== 1) return 0;
  if (!isOperacaoNaoFiscal(row)) return 0;
  if (classificarOrigemDistribuicao(row) === ORIGEM_LEGADA_AMBIGUA) return 0;
  return max0(row.quantidade_fiscal);
}

/**
 * Linhas/lotes elegíveis do dia (fonte da distribuição).
 */
async function listarLotesElegiveisDoDia(db, data, opts = {}) {
  const dataNorm = String(data || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataNorm)) {
    const err = new Error('Data inválida. Use YYYY-MM-DD.');
    err.statusCode = 400;
    throw err;
  }

  const excluirFechamentoId = opts.excluirFechamentoId != null
    ? Number(opts.excluirFechamentoId)
    : null;

  const rows = await carregarItensDia(db, dataNorm);
  const { byItem } = await carregarDevolucoesDoDia(db, dataNorm);
  const jaUsado = await mapQuantidadesJaUtilizadas(db, dataNorm, excluirFechamentoId);

  const lotes = [];
  for (const r of rows) {
    const qFiscalBruta = quantidadeFiscalConsumidaEmOperacaoNaoFiscal(r);
    if (!(qFiscalBruta > 0)) continue;

    const itemDev = byItem.get(Number(r.venda_item_id)) || { qtd: 0, valor: 0 };
    let qtd = arredondarMoeda(qFiscalBruta - Number(itemDev.qtd || 0));
    qtd = max0(qtd);

    const usado = Number(jaUsado.get(Number(r.venda_item_id)) || 0);
    qtd = arredondarMoeda(qtd - usado);
    qtd = max0(qtd);
    if (!(qtd > 0)) continue;

    let valor = calcularValorFiscalElegivel(r, qtd);
    if (itemDev.qtd > 0 && Number(r.quantidade_fiscal || 0) > 0 && Number(r.valor_fiscal || 0) > 0) {
      // valor já proporcional via calcularValorFiscalElegivel
    }
    if (!(valor > 0)) continue;

    const precoComercial = Number(r.preco_unitario || 0);
    let unit = arredondarMoeda(valor / qtd);
    if (!(unit > 0)) unit = precoComercial;
    const unitCents = toCentavos(unit);
    if (!(unitCents > 0)) continue;

    const fracionado = !Number.isInteger(Number(qtd));

    lotes.push({
      venda_item_id: Number(r.venda_item_id),
      venda_id: Number(r.venda_id),
      produto_id: Number(r.produto_id),
      nome: r.nome,
      codigo: r.codigo,
      unidade: 'UN',
      fracionado: Boolean(fracionado),
      data_venda: r.data_venda,
      quantidade_original: Number(r.quantidade_original || 0),
      quantidade_fiscal: Number(r.quantidade_fiscal || 0),
      quantidade_nao_fiscal: Number(r.quantidade_nao_fiscal || 0),
      valor_original: Number(r.valor_original || 0),
      valor_fiscal: Number(r.valor_fiscal || 0),
      valor_nao_fiscal: Number(r.valor_nao_fiscal || 0),
      preco_unitario: unit,
      preco_unitario_comercial: precoComercial,
      valor_unitario_fiscal: unit,
      quantidade_fiscal_consumida_em_operacao_nao_fiscal: qtd,
      quantidade_disponivel: qtd,
      valor_disponivel: valor,
      unit_cents: unitCents,
      operacao: 'NAO_FISCAL',
      situacao_fiscal_nfce: r.situacao_fiscal_nfce,
      origem_distribuicao: classificarOrigemDistribuicao(r)
    });
  }

  return lotes;
}

function agregarProdutosDosLotes(lotes) {
  const map = new Map();
  for (const l of Array.isArray(lotes) ? lotes : []) {
    const key = Number(l.produto_id);
    const prev = map.get(key) || {
      produto_id: key,
      nome: l.nome,
      codigo: l.codigo,
      item_fiscal: 1,
      preco_unitario: l.preco_unitario,
      quantidade_disponivel: 0,
      valor_vendido_no_dia: 0,
      lotes: []
    };
    prev.quantidade_disponivel = arredondarMoeda(
      prev.quantidade_disponivel + Number(l.quantidade_disponivel || 0)
    );
    prev.valor_vendido_no_dia = arredondarMoeda(
      prev.valor_vendido_no_dia + Number(l.valor_disponivel || 0)
    );
    prev.lotes.push(l);
    map.set(key, prev);
  }
  return [...map.values()].sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
}

async function listarProdutosElegiveisDoDia(db, data, opts = {}) {
  const lotes = await listarLotesElegiveisDoDia(db, data, opts);
  return agregarProdutosDosLotes(lotes);
}

/**
 * Monitoramento por produto: agrega itens de operações não fiscais (fiscais no cadastro).
 */
async function listarMonitoramentoProdutosDoDia(db, data, opts = {}) {
  const dataNorm = String(data || '').trim().slice(0, 10);
  const rows = await carregarItensDia(db, dataNorm);
  const { byItem } = await carregarDevolucoesDoDia(db, dataNorm);
  const jaUsado = await mapQuantidadesJaUtilizadas(
    db,
    dataNorm,
    opts.excluirFechamentoId != null ? Number(opts.excluirFechamentoId) : null
  );

  const map = new Map();
  for (const r of rows) {
    if (Number(r.item_fiscal || 0) !== 1) continue;
    if (!isOperacaoNaoFiscal(r)) continue;

    const pid = Number(r.produto_id);
    const prev = map.get(pid) || {
      produto_id: pid,
      nome: r.nome,
      codigo: r.codigo,
      item_fiscal: 1,
      quantidade_vendida: 0,
      quantidade_fiscal: 0,
      quantidade_nao_fiscal: 0,
      quantidade_elegivel: 0,
      valor_elegivel: 0,
      status: 'Não elegível',
      vendas: []
    };

    const qOrig = Number(r.quantidade_original || 0);
    const qF = Number(r.quantidade_fiscal || 0);
    const qNf = Number(r.quantidade_nao_fiscal || 0);
    const origem = classificarOrigemDistribuicao(r);

    const itemDev = byItem.get(Number(r.venda_item_id)) || { qtd: 0 };
    let qEleg = 0;
    if (origem !== ORIGEM_LEGADA_AMBIGUA && qF > 0) {
      qEleg = max0(arredondarMoeda(qF - Number(itemDev.qtd || 0)));
      qEleg = max0(arredondarMoeda(qEleg - Number(jaUsado.get(Number(r.venda_item_id)) || 0)));
    }
    const vEleg = calcularValorFiscalElegivel(r, qEleg);

    prev.quantidade_vendida = arredondarMoeda(prev.quantidade_vendida + qOrig);
    prev.quantidade_fiscal = arredondarMoeda(prev.quantidade_fiscal + qF);
    prev.quantidade_nao_fiscal = arredondarMoeda(prev.quantidade_nao_fiscal + qNf);
    prev.quantidade_elegivel = arredondarMoeda(prev.quantidade_elegivel + qEleg);
    prev.valor_elegivel = arredondarMoeda(prev.valor_elegivel + vEleg);

    prev.vendas.push({
      venda_id: Number(r.venda_id),
      venda_item_id: Number(r.venda_item_id),
      produto_id: pid,
      data_venda: r.data_venda,
      quantidade_original: qOrig,
      quantidade_fiscal: qF,
      quantidade_nao_fiscal: qNf,
      valor_original: Number(r.valor_original || 0),
      valor_fiscal: Number(r.valor_fiscal || 0),
      valor_nao_fiscal: Number(r.valor_nao_fiscal || 0),
      preco_unitario: Number(r.preco_unitario || 0),
      quantidade_elegivel: qEleg,
      valor_elegivel: vEleg,
      operacao: 'NAO_FISCAL',
      situacao_fiscal_nfce: r.situacao_fiscal_nfce,
      origem_distribuicao: origem,
      status: qEleg > 0 ? 'Elegível' : (origem === ORIGEM_LEGADA_AMBIGUA ? ORIGEM_LEGADA_AMBIGUA : 'Não elegível')
    });

    map.set(pid, prev);
  }

  return [...map.values()]
    .map((p) => {
      p.status = p.quantidade_elegivel > 0 ? 'Elegível' : 'Não elegível';
      return p;
    })
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
}

async function obterResumoDia(db, data, opts = {}) {
  const dataNorm = String(data || '').trim().slice(0, 10);

  const rows = await carregarItensDia(db, dataNorm);
  const lotes = await listarLotesElegiveisDoDia(db, dataNorm, opts);
  const produtos = agregarProdutosDosLotes(lotes);
  const monitoramento = await listarMonitoramentoProdutosDoDia(db, dataNorm, opts);

  const vendasIds = new Set();
  const vendasNaoFiscaisIds = new Set();
  let valorNaoFiscalVendido = 0;
  const produtosFiscaisVendidos = new Set();
  const produtosFiscaisComConsumoNf = new Set();
  let unidadesFiscaisElegiveis = 0;
  let valorFiscalElegivel = 0;
  let ambigua = 0;
  const pendenciasFiscais = new Map();

  const vendaValorContado = new Set();

  for (const r of rows) {
    const vid = Number(r.venda_id);
    vendasIds.add(vid);

    if (
      Number(r.decisao_fiscal_automatica_bloqueada || 0) === 1
      && !pendenciasFiscais.has(vid)
    ) {
      pendenciasFiscais.set(vid, {
        venda_id: vid,
        situacao: r.situacao_fiscal_nfce,
        motivo: r.classificacao_fiscal_nfce?.motivo || null,
        nfce_id: r.classificacao_fiscal_nfce?.nfce_id || null,
        cstats: r.classificacao_fiscal_nfce?.cstats || [],
        origem_classificacao: r.classificacao_fiscal_nfce?.origem_classificacao || null,
        pode_recuperar_duplicidade:
          r.situacao_fiscal_nfce === SITUACAO_NFCE.DUPLICIDADE_PENDENTE
          || r.classificacao_fiscal_nfce?.origem_classificacao === 'RECUPERACAO_DUPLICIDADE'
      });
    }

    if (Number(r.item_fiscal || 0) === 1) {
      produtosFiscaisVendidos.add(Number(r.produto_id));
    }

    if (isOperacaoNaoFiscal(r)) {
      vendasNaoFiscaisIds.add(vid);
      if (!vendaValorContado.has(vid)) {
        vendaValorContado.add(vid);
        const vNf = Number(r.venda_valor_nao_fiscal || 0);
        const total = Number(r.venda_total || 0);
        // Sem NFC-e: valor comercial da operação conta como não fiscal
        // (mesmo quando o motor gravou fatia em valor_fiscal por consumo de saldo).
        valorNaoFiscalVendido = arredondarMoeda(
          valorNaoFiscalVendido + (vNf > 0 ? vNf : total)
        );
      }
    }

    if (classificarOrigemDistribuicao(r) === ORIGEM_LEGADA_AMBIGUA) {
      ambigua += 1;
    }
  }

  for (const l of lotes) {
    produtosFiscaisComConsumoNf.add(Number(l.produto_id));
    unidadesFiscaisElegiveis = arredondarMoeda(
      unidadesFiscaisElegiveis + Number(l.quantidade_disponivel || 0)
    );
    valorFiscalElegivel = arredondarMoeda(
      valorFiscalElegivel + Number(l.valor_disponivel || 0)
    );
  }

  const capacidade = valorFiscalElegivel;

  return {
    data: dataNorm,
    periodo: '00:00 às 23:59',
    // KPIs Sprint 06
    vendas_do_dia: vendasIds.size,
    vendas_nao_fiscais: vendasNaoFiscaisIds.size,
    valor_nao_fiscal_vendido: valorNaoFiscalVendido,
    produtos_fiscais_vendidos: produtosFiscaisVendidos.size,
    produtos_fiscais_com_consumo_nao_fiscal: produtosFiscaisComConsumoNf.size,
    unidades_fiscais_elegiveis: unidadesFiscaisElegiveis,
    valor_fiscal_elegivel: valorFiscalElegivel,
    // Compatibilidade Sprint 01–05
    quantidade_vendas: vendasIds.size,
    produtos_vendidos: produtosFiscaisVendidos.size,
    itens_fiscais_elegiveis: produtos.length,
    linhas_elegiveis: lotes.length,
    capacidade_elegivel: capacidade,
    valor_elegivel: capacidade,
    registros_origem_legada_ambigua: ambigua,
    pendencias_fiscais: [...pendenciasFiscais.values()],
    produtos,
    lotes,
    monitoramento
  };
}

async function snapshotComercial(db) {
  const vendas = await promisifyGet(db, `SELECT COUNT(*) AS n FROM vendas`);
  const financeiro = await promisifyGet(db, `SELECT COUNT(*) AS n FROM financeiro`).catch(() => ({ n: 0 }));
  const caixa = await promisifyGet(
    db,
    `SELECT COUNT(*) AS n FROM financeiro WHERE LOWER(COALESCE(tipo,'')) LIKE '%caixa%' OR LOWER(COALESCE(origem,'')) LIKE '%caixa%'`
  ).catch(() => ({ n: 0 }));
  const estoque = await promisifyGet(
    db,
    `SELECT
       COALESCE(SUM(COALESCE(saldo_fiscal,0)),0) AS fiscal,
       COALESCE(SUM(COALESCE(saldo_nao_fiscal,0)),0) AS nao_fiscal
     FROM produtos`
  ).catch(() => ({ fiscal: 0, nao_fiscal: 0 }));

  const margem = await promisifyGet(
    db,
    `SELECT COALESCE(SUM(
        COALESCE(vi.subtotal,0) - (COALESCE(vi.quantidade,0) * COALESCE(p.preco_compra,0))
      ),0) AS lucro
     FROM vendas_itens vi
     LEFT JOIN produtos p ON p.id = vi.produto_id`
  ).catch(() => ({ lucro: 0 }));

  const pagamentos = await promisifyGet(
    db,
    `SELECT COUNT(*) AS n FROM vendas_pagamentos`
  ).catch(() => ({ n: 0 }));

  return {
    vendas: Number(vendas?.n || 0),
    financeiro: Number(financeiro?.n || 0),
    caixa: Number(caixa?.n || 0),
    estoque_fiscal: Number(estoque?.fiscal || 0),
    estoque_nao_fiscal: Number(estoque?.nao_fiscal || 0),
    margem_proxy: Number(margem?.lucro || 0),
    pagamentos: Number(pagamentos?.n || 0)
  };
}

module.exports = {
  ORIGEM_LEGADA_AMBIGUA,
  listarLotesElegiveisDoDia,
  listarProdutosElegiveisDoDia,
  listarMonitoramentoProdutosDoDia,
  agregarProdutosDosLotes,
  obterResumoDia,
  snapshotComercial,
  calcularValorFiscalElegivel,
  quantidadeFiscalConsumidaEmOperacaoNaoFiscal,
  isOperacaoNaoFiscal
};
