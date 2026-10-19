'use strict';

const MAX_FILTER_LENGTH = 200;
const ITEM_QUERY_BATCH_SIZE = 500;

function criarErroValidacao(message) {
  const erro = new Error(message);
  erro.statusCode = 400;
  return erro;
}

function validarDataIso(valor, campo) {
  if (valor == null || valor === '') return null;
  const data = String(valor).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw criarErroValidacao(`Filtro ${campo} inválido.`);
  }
  const instante = new Date(`${data}T00:00:00.000Z`);
  if (!Number.isFinite(instante.getTime()) || instante.toISOString().slice(0, 10) !== data) {
    throw criarErroValidacao(`Filtro ${campo} inválido.`);
  }
  return data;
}

function validarFiltros(query = {}) {
  const dataInicio = validarDataIso(query.data_inicio, 'data inicial');
  const dataFim = validarDataIso(query.data_fim, 'data final');
  if (dataInicio && dataFim && dataInicio > dataFim) {
    throw criarErroValidacao('A data inicial não pode ser posterior à data final.');
  }

  const fornecedor = String(query.fornecedor || '').trim();
  const numeroNf = String(query.numero_nf || '').trim();
  if (fornecedor.length > MAX_FILTER_LENGTH || numeroNf.length > MAX_FILTER_LENGTH) {
    throw criarErroValidacao('O valor de um filtro excede o limite permitido.');
  }

  let compraId = null;
  if (query.compra_id != null && String(query.compra_id).trim() !== '') {
    const raw = String(query.compra_id).trim();
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
      throw criarErroValidacao('ID da compra inválido.');
    }
    compraId = Number(raw);
  }

  return { dataInicio, dataFim, fornecedor, numeroNf, compraId };
}

function executarAll(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (erro, rows) => (erro ? reject(erro) : resolve(rows || [])));
  });
}

function montarConsultaCompras(filtros) {
  const where = [];
  const params = [];
  if (filtros.dataInicio) {
    where.push('date(c.data_compra) >= date(?)');
    params.push(filtros.dataInicio);
  }
  if (filtros.dataFim) {
    where.push('date(c.data_compra) <= date(?)');
    params.push(filtros.dataFim);
  }
  if (filtros.fornecedor) {
    where.push("COALESCE(c.fornecedor, '') LIKE ? COLLATE NOCASE");
    params.push(`%${filtros.fornecedor}%`);
  }
  if (filtros.numeroNf) {
    where.push("COALESCE(c.numero_nf, '') LIKE ? COLLATE NOCASE");
    params.push(`%${filtros.numeroNf}%`);
  }
  if (filtros.compraId != null) {
    where.push('c.id = ?');
    params.push(filtros.compraId);
  }

  return {
    sql: `SELECT
            c.id, c.data_compra, c.data_emissao, c.data_entrada,
            c.fornecedor, c.numero_nf, c.serie_nf, c.status,
            c.condicao_pagamento, c.forma_pagamento,
            c.valor_produtos, c.valor_desconto, c.valor_frete,
            c.valor_seguro, c.valor_outras_despesas, c.valor_ipi,
            c.total AS total_oficial
          FROM compras c
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY date(c.data_compra) DESC, c.id DESC`,
    params
  };
}

async function listarComprasRelatorio(db, query = {}) {
  const filtros = validarFiltros(query);
  const consulta = montarConsultaCompras(filtros);
  const compras = await executarAll(db, consulta.sql, consulta.params);
  if (!compras.length) return { compras: [], filtros };

  const itens = [];
  for (let inicio = 0; inicio < compras.length; inicio += ITEM_QUERY_BATCH_SIZE) {
    const lote = compras.slice(inicio, inicio + ITEM_QUERY_BATCH_SIZE);
    const ids = lote.map((compra) => Number(compra.id));
    const placeholders = ids.map(() => '?').join(',');
    const linhas = await executarAll(
      db,
      `SELECT id, compra_id, produto_id, quantidade, preco_unitario, subtotal,
              descricao_produto, codigo_barras, unidade
       FROM compras_itens
       WHERE compra_id IN (${placeholders})
       ORDER BY compra_id, id`,
      ids
    );
    itens.push(...linhas);
  }

  const itensPorCompra = new Map(compras.map((compra) => [Number(compra.id), []]));
  for (const item of itens) {
    const grupo = itensPorCompra.get(Number(item.compra_id));
    if (grupo) grupo.push(item);
  }

  return {
    filtros,
    compras: compras.map((compra) => ({
      ...compra,
      itens: itensPorCompra.get(Number(compra.id)) || []
    }))
  };
}

module.exports = {
  listarComprasRelatorio,
  validarFiltros,
  montarConsultaCompras
};
