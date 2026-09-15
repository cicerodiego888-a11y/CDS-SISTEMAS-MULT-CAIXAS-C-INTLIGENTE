/**
 * Complementação fiscal por recebimento de maquineta.
 * Documenta o déficit (recebido − cobertura NFC-e) com produtos já elegíveis.
 * NÃO movimenta estoque, NÃO altera vendas originais, NÃO consome saldo_fiscal.
 */

'use strict';

const { arredondarMoeda, toCentavos } = require('../fiscal/modeloTotais');
const { STATUS } = require('./constants');
const {
  calcularCoberturaFiscalDoDia,
  produtoTemSaldoFiscalDisponivel
} = require('./FechamentoFiscalElegibilidadeService');

function getDb(dbOverride) {
  if (dbOverride) return dbOverride;
  return require('../../database');
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function agoraLocal() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Produtos fiscais do cadastro para complementação documental.
 * NÃO usa monitoramento, NÃO usa estoque_atual, NÃO consome saldo.
 * valor_disponivel = saldo_fiscal * preco_venda (teto documental).
 */
async function obterProdutosFiscaisDisponiveisParaComplementacao(db) {
  const rows = await all(
    db,
    `SELECT
       p.id AS produto_id,
       p.nome AS nome,
       p.codigo AS codigo,
       COALESCE(p.item_fiscal, 0) AS item_fiscal,
       COALESCE(p.saldo_fiscal, 0) AS saldo_fiscal,
       COALESCE(p.preco_venda, 0) AS preco_venda
     FROM produtos p
     WHERE COALESCE(p.item_fiscal, 0) = 1
       AND COALESCE(p.saldo_fiscal, 0) > 0
     ORDER BY p.id ASC`
  );

  const out = [];
  for (const r of rows || []) {
    if (!produtoTemSaldoFiscalDisponivel(r)) continue;
    const qtd = Number(r.saldo_fiscal || 0);
    const preco = Number(r.preco_venda || 0);
    const valor = arredondarMoeda(qtd * preco);
    if (!(valor > 0)) continue;
    out.push({
      produto_id: Number(r.produto_id),
      nome: r.nome,
      codigo: r.codigo,
      item_fiscal: 1,
      saldo_fiscal: qtd,
      preco_venda: preco,
      quantidade_disponivel: qtd,
      valor_disponivel: valor
    });
  }
  return out;
}

function loteElegivelComplementacao(lote) {
  if (!lote) return false;
  if (lote.item_fiscal != null || lote.saldo_fiscal != null) {
    return produtoTemSaldoFiscalDisponivel(lote);
  }
  return Number(lote.produto_id) > 0 && Number(lote.valor_disponivel || 0) > 0;
}

/**
 * Composição determinística por produto_id (não duplica produto).
 * Nunca ultrapassa o déficit. Trabalha em centavos.
 */
function calcularComplementacaoFiscal({
  valorRecebido = 0,
  coberturaFiscal = 0,
  lotes = [],
  recebimentos = [],
  contexto = {}
} = {}) {
  const valor_recebido = arredondarMoeda(valorRecebido);
  const cobertura_fiscal = arredondarMoeda(coberturaFiscal);
  const deficitCents = Math.max(0, toCentavos(valor_recebido) - toCentavos(cobertura_fiscal));
  const deficit = arredondarMoeda(deficitCents / 100);

  const vazio = {
    valor_recebido,
    cobertura_fiscal,
    deficit,
    valor_complementado: 0,
    deficit_restante: deficit,
    itens_complementacao: [],
    estoque_movimentado: false,
    origem_recebimento: 'FECHAMENTOS_FISCAIS_RECEBIMENTOS',
    cnpj: contexto.cnpj || '',
    empresa_id: contexto.empresa_id != null ? contexto.empresa_id : null,
    data_fechamento: contexto.data_fechamento || null,
    fechamento_fiscal_id: contexto.fechamento_fiscal_id != null ? Number(contexto.fechamento_fiscal_id) : null,
    recebimentos: Array.isArray(recebimentos) ? recebimentos : []
  };

  if (!(deficitCents > 0)) {
    return vazio;
  }

  const porProduto = new Map();
  for (const l of Array.isArray(lotes) ? lotes : []) {
    if (!loteElegivelComplementacao(l)) continue;
    const pid = Number(l.produto_id);
    if (!(pid > 0)) continue;
    const prev = porProduto.get(pid) || {
      produto_id: pid,
      nome: l.nome || null,
      valor_cents: 0,
      quantidade: 0,
      venda_origem_id: Number(l.venda_id || l.venda_origem_id || 0) || null,
      venda_item_origem_id: Number(l.venda_item_id || l.venda_item_origem_id || 0) || null
    };
    prev.valor_cents += toCentavos(l.valor_disponivel);
    prev.quantidade = arredondarMoeda(prev.quantidade + Number(l.quantidade_disponivel || 0));
    porProduto.set(pid, prev);
  }

  const ordered = [...porProduto.values()].sort((a, b) => a.produto_id - b.produto_id);
  let rest = deficitCents;
  const itens = [];
  for (const p of ordered) {
    if (rest <= 0) break;
    const take = Math.min(rest, p.valor_cents);
    if (!(take > 0)) continue;
    const valor = arredondarMoeda(take / 100);
    const quantidade = p.valor_cents > 0
      ? arredondarMoeda(Number(p.quantidade || 0) * (take / p.valor_cents))
      : 0;
    itens.push({
      produto_id: p.produto_id,
      nome: p.nome,
      valor,
      quantidade,
      venda_origem_id: p.venda_origem_id,
      venda_item_origem_id: p.venda_item_origem_id
    });
    rest -= take;
  }

  const valor_complementado = arredondarMoeda((deficitCents - rest) / 100);
  return {
    ...vazio,
    valor_complementado,
    deficit_restante: arredondarMoeda(rest / 100),
    itens_complementacao: itens
  };
}

function montarDto(row, itens, recebimentos) {
  if (!row) return null;
  return {
    id: row.id,
    fechamento_fiscal_id: Number(row.fechamento_fiscal_id),
    cnpj: row.cnpj || '',
    empresa_id: row.empresa_id != null ? Number(row.empresa_id) : null,
    data_fechamento: row.data_fechamento,
    valor_recebido: arredondarMoeda(row.valor_recebido),
    cobertura_fiscal: arredondarMoeda(row.cobertura_fiscal),
    deficit: arredondarMoeda(row.deficit),
    valor_complementado: arredondarMoeda(row.valor_complementado),
    deficit_restante: arredondarMoeda(row.deficit_restante),
    origem_recebimento: row.origem_recebimento || 'FECHAMENTOS_FISCAIS_RECEBIMENTOS',
    estoque_movimentado: false,
    atualizado_em: row.atualizado_em,
    recebimentos: Array.isArray(recebimentos) ? recebimentos : [],
    itens_complementacao: (itens || []).map((it) => ({
      produto_id: Number(it.produto_id),
      valor: arredondarMoeda(it.valor),
      quantidade: Number(it.quantidade || 0),
      venda_origem_id: it.venda_origem_id != null ? Number(it.venda_origem_id) : null,
      venda_item_origem_id: it.venda_item_origem_id != null ? Number(it.venda_item_origem_id) : null
    }))
  };
}

async function lerComplementacao(db, fechamentoId) {
  try {
    const row = await get(
      db,
      `SELECT * FROM fechamentos_fiscais_complementacao WHERE fechamento_fiscal_id = ?`,
      [Number(fechamentoId)]
    );
    if (!row) return null;
    const itens = await all(
      db,
      `SELECT * FROM fechamentos_fiscais_complementacao_itens
       WHERE fechamento_fiscal_id = ? ORDER BY ordem, id`,
      [Number(fechamentoId)]
    );
    let recebimentos = [];
    try {
      recebimentos = row.recebimentos_json ? JSON.parse(row.recebimentos_json) : [];
    } catch (_) {
      recebimentos = [];
    }
    return montarDto(row, itens, recebimentos);
  } catch (_) {
    return null;
  }
}

async function persistirComplementacao(db, fechamento, calc) {
  const id = Number(fechamento.id);
  const now = agoraLocal();
  await run(db, `DELETE FROM fechamentos_fiscais_complementacao_itens WHERE fechamento_fiscal_id = ?`, [id]);
  await run(db, `DELETE FROM fechamentos_fiscais_complementacao WHERE fechamento_fiscal_id = ?`, [id]);

  const ins = await run(
    db,
    `INSERT INTO fechamentos_fiscais_complementacao
      (fechamento_fiscal_id, cnpj, empresa_id, data_fechamento,
       valor_recebido, cobertura_fiscal, deficit, valor_complementado, deficit_restante,
       origem_recebimento, recebimentos_json, estoque_movimentado, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      fechamento.cnpj || '',
      fechamento.empresa_id != null ? Number(fechamento.empresa_id) : null,
      fechamento.data_fechamento,
      calc.valor_recebido,
      calc.cobertura_fiscal,
      calc.deficit,
      calc.valor_complementado,
      calc.deficit_restante,
      'FECHAMENTOS_FISCAIS_RECEBIMENTOS',
      JSON.stringify(calc.recebimentos || []),
      now,
      now
    ]
  );

  let ordem = 0;
  for (const it of calc.itens_complementacao || []) {
    await run(
      db,
      `INSERT INTO fechamentos_fiscais_complementacao_itens
        (complementacao_id, fechamento_fiscal_id, produto_id, venda_origem_id, venda_item_origem_id,
         valor, quantidade, ordem, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ins.lastID,
        id,
        it.produto_id,
        it.venda_origem_id,
        it.venda_item_origem_id,
        it.valor,
        it.quantidade,
        ordem++,
        now
      ]
    );
  }

  return lerComplementacao(db, id);
}

function fechamentoCongelado(status) {
  const st = String(status || '').toUpperCase();
  return [
    STATUS.PRONTO_EMISSAO,
    STATUS.EMITINDO,
    STATUS.AUTORIZADO,
    STATUS.VALIDANDO,
    STATUS.CONCLUIDO,
    STATUS.CONFIRMADO
  ].includes(st);
}

/**
 * Recalcula (e persiste, se permitido) a complementação do fechamento.
 * Idempotente: um registro por fechamento_fiscal_id; substitui a composição anterior.
 */
async function gerarComplementacaoFiscal(fechamentoOuId, deps = {}) {
  const db = getDb(deps.db);
  const ff = typeof fechamentoOuId === 'object' && fechamentoOuId && fechamentoOuId.id
    ? fechamentoOuId
    : await get(db, `SELECT * FROM fechamentos_fiscais WHERE id = ?`, [Number(fechamentoOuId)]);

  if (!ff) {
    const err = new Error('Fechamento fiscal não encontrado.');
    err.statusCode = 404;
    throw err;
  }

  if (fechamentoCongelado(ff.status) && deps.forcar !== true) {
    const stored = await lerComplementacao(db, ff.id);
    if (stored) return stored;
  }

  const recebimentos = await all(
    db,
    `SELECT id, operadora, descricao, cnpj, valor, observacao
     FROM fechamentos_fiscais_recebimentos
     WHERE fechamento_fiscal_id = ?
     ORDER BY id`,
    [Number(ff.id)]
  );
  const valorRecebido = arredondarMoeda(
    (recebimentos || []).reduce((s, r) => s + Number(r.valor || 0), 0)
  );
  const coberturaFiscal = await calcularCoberturaFiscalDoDia(db, ff.data_fechamento);
  const lotes = await obterProdutosFiscaisDisponiveisParaComplementacao(db);

  const calc = calcularComplementacaoFiscal({
    valorRecebido,
    coberturaFiscal,
    lotes,
    recebimentos: (recebimentos || []).map((r) => ({
      id: r.id,
      operadora: r.operadora,
      cnpj: r.cnpj,
      valor: arredondarMoeda(r.valor)
    })),
    contexto: {
      fechamento_fiscal_id: Number(ff.id),
      cnpj: ff.cnpj || '',
      empresa_id: ff.empresa_id,
      data_fechamento: ff.data_fechamento
    }
  });

  const persistir = deps.persistir !== false && !fechamentoCongelado(ff.status);
  if (persistir) {
    try {
      return await persistirComplementacao(db, ff, calc);
    } catch (_) {
      return calc;
    }
  }
  return calc;
}

/**
 * Junta lotes do monitoramento com produtos fiscais do cadastro,
 * sem duplicar o valor já coberto pelo monitoramento do mesmo produto.
 */
function mesclarLotesMonitoramentoComComplementacao(lotesDia, produtosComp, opts = {}) {
  const lotes = Array.isArray(lotesDia) ? lotesDia.map((l) => ({ ...l })) : [];
  const jaCents = new Map();
  let capMonitorCents = 0;
  for (const l of lotes) {
    const pid = Number(l.produto_id);
    const cents = toCentavos(l.valor_disponivel);
    capMonitorCents += cents;
    jaCents.set(pid, (jaCents.get(pid) || 0) + cents);
  }
  const alvoCents = opts.valorAlvoCents != null ? Number(opts.valorAlvoCents) : null;
  let faltaCents = alvoCents != null && alvoCents > 0
    ? Math.max(0, alvoCents - capMonitorCents)
    : Number.POSITIVE_INFINITY;
  for (const p of Array.isArray(produtosComp) ? produtosComp : []) {
    if (!(faltaCents > 0)) break;
    const pid = Number(p.produto_id);
    if (!(pid > 0)) continue;
    if (!produtoTemSaldoFiscalDisponivel({
      item_fiscal: p.item_fiscal != null ? p.item_fiscal : 1,
      saldo_fiscal: p.saldo_fiscal != null ? p.saldo_fiscal : 1
    })) continue;
    const extraCatalogo = toCentavos(p.valor_disponivel) - (jaCents.get(pid) || 0);
    const extra = Math.min(extraCatalogo, faltaCents);
    if (!(extra > 0)) continue;
    faltaCents -= extra;
    const valor = arredondarMoeda(extra / 100);
    // Fatias de 1 centavo: o motor greedy da prévia consegue fechar o déficit
    // (ex.: 16 do monitoramento + 9 do cadastro = 25), sem exigir unidade = preço de venda.
    lotes.push({
      venda_item_id: -pid,
      venda_id: 0,
      produto_id: pid,
      nome: p.nome,
      unidade: 'UN',
      fracionado: true,
      quantidade_disponivel: valor,
      valor_disponivel: valor,
      preco_unitario: 0.01,
      unit_cents: 1,
      origem_distribuicao: 'COMPLEMENTACAO_CADASTRO',
      item_fiscal: 1,
      saldo_fiscal: p.saldo_fiscal
    });
  }
  return lotes;
}

module.exports = {
  calcularComplementacaoFiscal,
  gerarComplementacaoFiscal,
  obterProdutosFiscaisDisponiveisParaComplementacao,
  mesclarLotesMonitoramentoComComplementacao,
  lerComplementacao,
  loteElegivelComplementacao
};
