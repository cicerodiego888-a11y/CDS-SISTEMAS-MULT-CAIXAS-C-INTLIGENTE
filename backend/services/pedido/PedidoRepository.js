/**
 * PedidoRepository — persistência do agregado Pedido (Sprint 3.1).
 */

'use strict';

const db = require('../../database');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function listarAguardandoFaturamento() {
  return all(`
    SELECT
      p.id,
      p.codigo,
      p.data_pedido,
      p.cliente_id,
      c.nome AS cliente_nome,
      p.total,
      p.desconto,
      p.status,
      p.representante_id,
      p.representante_nome,
      p.venda_id,
      p.observacao,
      p.created_at,
      p.operador_id,
      u.username AS usuario_nome
    FROM pedidos p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    LEFT JOIN usuarios u ON u.id = p.operador_id
    WHERE p.status IN ('AGUARDANDO_FATURAMENTO')
    ORDER BY p.data_pedido DESC, p.id DESC
  `);
}

async function listarPedidos(filtros = {}) {
  const where = ['1=1'];
  const params = [];

  const statusLista = [];
  if (Array.isArray(filtros.statusIn) && filtros.statusIn.length) {
    statusLista.push(...filtros.statusIn.map((s) => String(s).toUpperCase()));
  } else if (filtros.status) {
    String(filtros.status)
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .forEach((s) => statusLista.push(s));
  }
  if (statusLista.length === 1) {
    where.push('p.status = ?');
    params.push(statusLista[0]);
  } else if (statusLista.length > 1) {
    where.push(`p.status IN (${statusLista.map(() => '?').join(',')})`);
    params.push(...statusLista);
  }
  if (filtros.cliente) {
    where.push('(IFNULL(c.nome, "") LIKE ? OR CAST(IFNULL(p.cliente_id, 0) AS TEXT) = ?)');
    const q = `%${String(filtros.cliente).trim()}%`;
    params.push(q, String(filtros.cliente).trim());
  }
  if (filtros.representante) {
    where.push('IFNULL(p.representante_nome, "") LIKE ?');
    params.push(`%${String(filtros.representante).trim()}%`);
  }
  if (filtros.dataInicio) {
    where.push('date(p.data_pedido) >= date(?)');
    params.push(filtros.dataInicio);
  }
  if (filtros.dataFim) {
    where.push('date(p.data_pedido) <= date(?)');
    params.push(filtros.dataFim);
  }
  if (filtros.busca) {
    const q = `%${String(filtros.busca).trim()}%`;
    where.push('(IFNULL(p.codigo, "") LIKE ? OR IFNULL(c.nome, "") LIKE ? OR CAST(p.id AS TEXT) LIKE ?)');
    params.push(q, q, q);
  }

  const limite = Math.min(Math.max(Number(filtros.limite) || 200, 1), 500);

  return all(`
    SELECT
      p.id,
      p.codigo,
      p.data_pedido,
      p.cliente_id,
      c.nome AS cliente_nome,
      p.total,
      p.desconto,
      p.frete,
      p.status,
      p.representante_id,
      p.representante_nome,
      p.venda_id,
      p.observacao,
      p.created_at,
      p.updated_at,
      p.operador_id,
      COALESCE(u.username, u.nome) AS usuario_nome
    FROM pedidos p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    LEFT JOIN usuarios u ON u.id = p.operador_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.id DESC
    LIMIT ?
  `, [...params, limite]);
}

async function obterPorId(pedidoId) {
  const pedido = await get(`
    SELECT
      p.*,
      c.nome AS cliente_nome,
      COALESCE(u.username, u.nome) AS usuario_nome
    FROM pedidos p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    LEFT JOIN usuarios u ON u.id = p.operador_id
    WHERE p.id = ?
  `, [pedidoId]);
  if (!pedido) return null;
  const itens = await all(`
    SELECT
      i.*,
      pr.nome AS produto_nome,
      pr.codigo AS produto_codigo,
      pr.unidade AS produto_unidade
    FROM pedidos_itens i
    LEFT JOIN produtos pr ON pr.id = i.produto_id
    WHERE i.pedido_id = ?
    ORDER BY i.id ASC
  `, [pedidoId]);
  return { ...pedido, itens };
}

async function criarPedido({
  codigo,
  dataPedido,
  clienteId,
  total,
  desconto,
  frete,
  status,
  representanteId,
  representanteNome,
  observacao,
  operadorId,
  itens
}) {
  await run('BEGIN IMMEDIATE');
  try {
    const ins = await run(`
      INSERT INTO pedidos (
        codigo, data_pedido, cliente_id, total, desconto, frete, status,
        representante_id, representante_nome, observacao, operador_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      codigo,
      dataPedido,
      clienteId || null,
      Number(total || 0),
      Number(desconto || 0),
      Number(frete || 0),
      status,
      representanteId || null,
      representanteNome || null,
      observacao || null,
      operadorId || null
    ]);
    const pedidoId = ins.lastID;
    for (const item of itens) {
      await run(`
        INSERT INTO pedidos_itens (
          pedido_id, produto_id, quantidade, preco_unitario,
          desconto_percentual, subtotal, tipo_venda
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        pedidoId,
        item.produto_id,
        item.quantidade,
        item.preco_unitario,
        item.desconto_percentual || 0,
        item.subtotal,
        item.tipo_venda || 'PESO'
      ]);
    }
    await run('COMMIT');
    return pedidoId;
  } catch (err) {
    try { await run('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }
}

async function substituirPedido({
  pedidoId,
  clienteId,
  total,
  desconto,
  frete,
  representanteId,
  representanteNome,
  observacao,
  itens
}) {
  await run('BEGIN IMMEDIATE');
  try {
    const upd = await run(`
      UPDATE pedidos SET
        cliente_id = ?,
        total = ?,
        desconto = ?,
        frete = ?,
        representante_id = ?,
        representante_nome = ?,
        observacao = ?,
        updated_at = DATETIME('now', 'localtime')
      WHERE id = ?
        AND status IN ('ORCAMENTO', 'PEDIDO', 'ABERTO', 'EM_SEPARACAO', 'AGUARDANDO_FATURAMENTO')
    `, [
      clienteId || null,
      Number(total || 0),
      Number(desconto || 0),
      Number(frete || 0),
      representanteId || null,
      representanteNome || null,
      observacao || null,
      pedidoId
    ]);
    if (!upd.changes) {
      const err = new Error('Pedido não pode ser editado neste status.');
      err.statusCode = 400;
      throw err;
    }
    await run('DELETE FROM pedidos_itens WHERE pedido_id = ?', [pedidoId]);
    for (const item of itens) {
      await run(`
        INSERT INTO pedidos_itens (
          pedido_id, produto_id, quantidade, preco_unitario,
          desconto_percentual, subtotal, tipo_venda
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        pedidoId,
        item.produto_id,
        item.quantidade,
        item.preco_unitario,
        item.desconto_percentual || 0,
        item.subtotal,
        item.tipo_venda || 'PESO'
      ]);
    }
    await run('COMMIT');
    return true;
  } catch (err) {
    try { await run('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }
}

async function atualizarStatus(pedidoId, status, statusPermitidos = null) {
  const params = [status, pedidoId];
  let sql = `
    UPDATE pedidos
    SET status = ?,
        updated_at = DATETIME('now', 'localtime')
    WHERE id = ?
  `;
  if (Array.isArray(statusPermitidos) && statusPermitidos.length) {
    sql += ` AND status IN (${statusPermitidos.map(() => '?').join(',')})`;
    params.push(...statusPermitidos);
  }
  const result = await run(sql, params);
  return result.changes > 0;
}

/** Exclusão física — somente Orçamento (Sprint 3.14). */
async function excluirOrcamento(pedidoId) {
  await run('BEGIN IMMEDIATE');
  try {
    const row = await get('SELECT id, status FROM pedidos WHERE id = ?', [pedidoId]);
    if (!row) {
      const err = new Error('Pedido não encontrado.');
      err.statusCode = 404;
      throw err;
    }
    if (row.status !== 'ORCAMENTO') {
      const err = new Error('Somente orçamentos podem ser excluídos. Use cancelar para pedidos.');
      err.statusCode = 400;
      throw err;
    }
    await run('DELETE FROM pedidos_itens WHERE pedido_id = ?', [pedidoId]);
    const del = await run(
      `DELETE FROM pedidos WHERE id = ? AND status = 'ORCAMENTO'`,
      [pedidoId]
    );
    if (!del.changes) {
      const err = new Error('Não foi possível excluir o orçamento.');
      err.statusCode = 400;
      throw err;
    }
    await run('COMMIT');
    return true;
  } catch (err) {
    try { await run('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }
}

async function marcarFaturado(pedidoId, vendaId, operadorId) {
  const result = await run(`
    UPDATE pedidos
    SET status = 'FATURADO',
        venda_id = ?,
        faturado_em = DATETIME('now', 'localtime'),
        faturado_por = ?,
        updated_at = DATETIME('now', 'localtime')
    WHERE id = ?
      AND status IN ('ABERTO', 'AGUARDANDO_FATURAMENTO')
  `, [vendaId, operadorId || null, pedidoId]);
  return result.changes > 0;
}

async function atualizarDadosFiscais(pedidoId, dados = {}) {
  return run(`
    UPDATE pedidos SET
      natureza_operacao = ?,
      cfop = ?,
      frete = ?,
      acrescimo = ?,
      transportadora = ?,
      volumes = ?,
      peso = ?,
      dados_adicionais = ?,
      observacao = COALESCE(?, observacao),
      updated_at = DATETIME('now', 'localtime')
    WHERE id = ?
  `, [
    dados.natureza_operacao || 'VENDA DE MERCADORIA',
    dados.cfop || '5102',
    Number(dados.frete || 0),
    Number(dados.acrescimo || 0),
    dados.transportadora || null,
    Number(dados.volumes || 0),
    Number(dados.peso || 0),
    dados.dados_adicionais || null,
    dados.observacoes || null,
    pedidoId
  ]);
}

module.exports = {
  listarAguardandoFaturamento,
  listarPedidos,
  obterPorId,
  criarPedido,
  substituirPedido,
  atualizarStatus,
  excluirOrcamento,
  marcarFaturado,
  atualizarDadosFiscais
};
