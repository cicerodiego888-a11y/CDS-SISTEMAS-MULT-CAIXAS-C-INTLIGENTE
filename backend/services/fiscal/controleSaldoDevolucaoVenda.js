/**
 * RC5 — Controle de saldo de devoluções de venda (NF-e).
 * Reutiliza as mesmas regras do RC3 (compra), com venda_id / venda_item_id.
 */

'use strict';

const db = require('../../database');

const STATUS = Object.freeze({
  NAO_DEVOLVIDO: 'nao_devolvido',
  PARCIAL: 'parcialmente_devolvido',
  TOTAL: 'totalmente_devolvido',
  SALDO_INSUFICIENTE: 'saldo_insuficiente'
});

const STATUS_UI = Object.freeze({
  [STATUS.NAO_DEVOLVIDO]: { label: 'Não devolvido', cor: 'verde', emoji: '🟢' },
  [STATUS.PARCIAL]: { label: 'Parcialmente devolvido', cor: 'amarelo', emoji: '🟡' },
  [STATUS.TOTAL]: { label: 'Totalmente devolvido', cor: 'azul', emoji: '🔵' },
  [STATUS.SALDO_INSUFICIENTE]: { label: 'Saldo insuficiente', cor: 'vermelho', emoji: '🔴' }
});

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function round3(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function statusDoSaldo({ quantidadeVendida, quantidadeDevolvida, saldo, solicitada }) {
  const vendida = round3(quantidadeVendida);
  const devolvida = round3(quantidadeDevolvida);
  const disp = round3(saldo != null ? saldo : Math.max(0, vendida - devolvida));
  if (solicitada != null && round3(solicitada) > disp + 1e-9) {
    return STATUS.SALDO_INSUFICIENTE;
  }
  if (devolvida <= 0) return STATUS.NAO_DEVOLVIDO;
  if (disp <= 1e-9) return STATUS.TOTAL;
  return STATUS.PARCIAL;
}

async function garantirTabelasSaldoDevolucaoVenda() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS nfe_devolucoes_venda (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER NOT NULL,
      numero INTEGER,
      serie INTEGER,
      chave_acesso TEXT,
      chave_referenciada TEXT,
      protocolo TEXT,
      ambiente INTEGER,
      status TEXT,
      natureza_operacao TEXT,
      cfop TEXT,
      xml_enviado TEXT,
      xml_retorno TEXT,
      danfe_html TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS nfe_devolucao_venda_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nfe_devolucao_id INTEGER NOT NULL,
      venda_id INTEGER NOT NULL,
      venda_item_id INTEGER NOT NULL,
      produto_id INTEGER,
      n_item INTEGER,
      quantidade DECIMAL(12,4) NOT NULL,
      quantidade_vendida DECIMAL(12,4),
      quantidade_devolvida_acumulada DECIMAL(12,4),
      saldo_apos DECIMAL(12,4),
      valor_unitario DECIMAL(14,6),
      valor_total DECIMAL(14,2),
      cfop TEXT,
      estoque_retornado INTEGER DEFAULT 0,
      usuario_id INTEGER,
      usuario_nome TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_nfe_dev_venda_itens_venda ON nfe_devolucao_venda_itens(venda_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_nfe_dev_venda_itens_item ON nfe_devolucao_venda_itens(venda_item_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_nfe_dev_venda_itens_nota ON nfe_devolucao_venda_itens(nfe_devolucao_id)`);

  const altersHeader = [
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN cancelado_em DATETIME`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN cancelado_por_id INTEGER`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN cancelado_por_nome TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN motivo_cancelamento TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN usuario_id INTEGER`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN usuario_nome TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN estoque_retornado INTEGER DEFAULT 0`
  ];
  for (const sql of altersHeader) {
    try { await dbRun(sql); } catch (_) { /* já existe */ }
  }
}

async function somarDevolvidoFiscalPorItem(vendaItemId) {
  const row = await dbGet(`
    SELECT COALESCE(SUM(i.quantidade), 0) AS qtd
    FROM nfe_devolucao_venda_itens i
    INNER JOIN nfe_devolucoes_venda n ON n.id = i.nfe_devolucao_id
    WHERE i.venda_item_id = ?
      AND LOWER(TRIM(COALESCE(n.status, ''))) = 'autorizada'
  `, [Number(vendaItemId)]);
  return round3(row?.qtd);
}

async function carregarSaldosDevolucaoVenda(vendaId) {
  await garantirTabelasSaldoDevolucaoVenda();
  const id = Number(vendaId);

  const venda = await dbGet(`SELECT id, status_venda, cliente_id FROM vendas WHERE id = ?`, [id]);
  if (!venda) {
    throw Object.assign(new Error('Venda não encontrada.'), {
      code: 'VENDA_NAO_ENCONTRADA',
      statusCode: 404
    });
  }

  const itens = await dbAll(`
    SELECT
      vi.id AS venda_item_id,
      vi.venda_id,
      vi.produto_id,
      COALESCE(vi.quantidade_fiscal, vi.quantidade, 0) AS quantidade_vendida,
      vi.preco_unitario,
      vi.ncm,
      p.nome AS produto_nome,
      p.codigo AS produto_codigo,
      p.ncm AS produto_ncm,
      p.unidade AS produto_unidade,
      p.unidade,
      COALESCE((
        SELECT SUM(i.quantidade)
        FROM nfe_devolucao_venda_itens i
        INNER JOIN nfe_devolucoes_venda n ON n.id = i.nfe_devolucao_id
        WHERE i.venda_item_id = vi.id
          AND LOWER(TRIM(COALESCE(n.status, ''))) = 'autorizada'
      ), 0) AS quantidade_devolvida
    FROM vendas_itens vi
    LEFT JOIN produtos p ON p.id = vi.produto_id
    WHERE vi.venda_id = ?
    ORDER BY vi.id
  `, [id]);

  const mapeados = itens.map((row) => {
    const vendida = round3(row.quantidade_vendida);
    const devolvida = round3(row.quantidade_devolvida);
    const saldo = round3(Math.max(0, vendida - devolvida));
    const st = statusDoSaldo({
      quantidadeVendida: vendida,
      quantidadeDevolvida: devolvida,
      saldo
    });
    return {
      venda_item_id: row.venda_item_id,
      venda_id: row.venda_id,
      produto_id: row.produto_id,
      produto_nome: row.produto_nome,
      produto_codigo: row.produto_codigo,
      ncm: row.ncm || row.produto_ncm,
      unidade: row.unidade || row.produto_unidade || 'UN',
      quantidade_vendida: vendida,
      quantidade_devolvida: devolvida,
      saldo,
      status: st,
      status_ui: STATUS_UI[st],
      valor_unitario: Number(row.preco_unitario || 0)
    };
  });

  const totais = mapeados.reduce((acc, i) => {
    acc.vendido = round3(acc.vendido + i.quantidade_vendida);
    acc.devolvido = round3(acc.devolvido + i.quantidade_devolvida);
    acc.saldo = round3(acc.saldo + i.saldo);
    return acc;
  }, { vendido: 0, devolvido: 0, saldo: 0 });

  let statusVenda = STATUS.NAO_DEVOLVIDO;
  if (totais.devolvido <= 0) statusVenda = STATUS.NAO_DEVOLVIDO;
  else if (totais.saldo <= 1e-9) statusVenda = STATUS.TOTAL;
  else statusVenda = STATUS.PARCIAL;

  const cancelada = String(venda.status_venda || '').toLowerCase() === 'cancelada';

  return {
    vendaId: id,
    vendaCancelada: cancelada,
    statusCompra: statusVenda, // alias para UI compartilhada
    statusVenda,
    statusCompraUi: STATUS_UI[statusVenda],
    statusVendaUi: STATUS_UI[statusVenda],
    totais: {
      comprado: totais.vendido,
      vendido: totais.vendido,
      devolvido: totais.devolvido,
      saldo: totais.saldo
    },
    itens: mapeados
  };
}

function validarQuantidadesContraSaldo({ saldos, itensSolicitados, vendaCancelada }) {
  const erros = [];
  if (vendaCancelada || saldos?.vendaCancelada) {
    erros.push('Venda cancelada — não é possível emitir NF-e de devolução.');
    return { ok: false, erros };
  }
  const porId = new Map((saldos.itens || []).map((i) => [Number(i.venda_item_id), i]));
  for (const req of itensSolicitados || []) {
    const itemId = Number(req.venda_item_id || req.id);
    const qtd = round3(req.quantidade);
    const base = porId.get(itemId);
    if (!base) {
      erros.push(`Item ${itemId} não encontrado na venda.`);
      continue;
    }
    if (!(qtd > 0)) {
      erros.push(`Quantidade inválida para ${base.produto_nome || itemId}.`);
      continue;
    }
    if (qtd > base.saldo + 1e-9) {
      erros.push(
        `Saldo insuficiente em ${base.produto_nome || itemId}: solicitado ${qtd}, saldo ${base.saldo}.`
      );
    }
  }
  return { ok: erros.length === 0, erros };
}

async function persistirItensNfeDevolucaoVenda({
  nfeDevolucaoId,
  vendaId,
  itens,
  usuarioId = null,
  usuarioNome = null
}) {
  await garantirTabelasSaldoDevolucaoVenda();
  const saldos = await carregarSaldosDevolucaoVenda(vendaId);
  const porId = new Map(saldos.itens.map((i) => [Number(i.venda_item_id), i]));
  let nItem = 0;

  for (const item of itens || []) {
    const qtd = round3(item.quantidade);
    if (!(qtd > 0)) continue;
    nItem += 1;
    const itemId = Number(item.venda_item_id || item.id);
    const base = porId.get(itemId);
    const vendida = base ? base.quantidade_vendida : round3(item.quantidade_vendida);
    const jaDev = base ? base.quantidade_devolvida : 0;
    const acumulada = round3(jaDev + qtd);
    const saldoApos = round3(Math.max(0, vendida - acumulada));
    const vu = Number(item.valor_unitario || base?.valor_unitario || 0);

    await dbRun(`
      INSERT INTO nfe_devolucao_venda_itens (
        nfe_devolucao_id, venda_id, venda_item_id, produto_id, n_item,
        quantidade, quantidade_vendida, quantidade_devolvida_acumulada, saldo_apos,
        valor_unitario, valor_total, cfop, usuario_id, usuario_nome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      Number(nfeDevolucaoId),
      Number(vendaId),
      itemId,
      item.produto_id || base?.produto_id || null,
      nItem,
      qtd,
      vendida,
      acumulada,
      saldoApos,
      vu,
      Math.round(qtd * vu * 100) / 100,
      item.cfop || null,
      usuarioId,
      usuarioNome
    ]);
  }

  return carregarSaldosDevolucaoVenda(vendaId);
}

async function cancelarNfeDevolucaoVenda(notaId, { motivo, usuarioId, usuarioNome } = {}) {
  await garantirTabelasSaldoDevolucaoVenda();
  const nota = await dbGet(`SELECT * FROM nfe_devolucoes_venda WHERE id = ?`, [Number(notaId)]);
  if (!nota) {
    throw Object.assign(new Error('NF-e de devolução não encontrada.'), {
      code: 'NOTA_NAO_ENCONTRADA',
      statusCode: 404
    });
  }
  if (String(nota.status).toLowerCase() === 'cancelada') {
    return { success: true, reused: true, nota, message: 'NF-e de devolução já estava cancelada.' };
  }
  if (String(nota.status).toLowerCase() !== 'autorizada') {
    throw Object.assign(
      new Error('Somente NF-e autorizada pode ser cancelada para reabrir saldo.'),
      { code: 'STATUS_INVALIDO', statusCode: 400 }
    );
  }
  const motivoLimpo = String(motivo || '').trim();
  if (motivoLimpo.length < 15) {
    throw Object.assign(
      new Error('Informe o motivo do cancelamento (mínimo 15 caracteres).'),
      { code: 'MOTIVO_CURTO', statusCode: 400 }
    );
  }

  // Reverter estoque se havia sido retornado na autorização
  if (Number(nota.estoque_retornado) === 1) {
    try {
      const { reverterEstoqueNfeDevolucaoVenda } = require('./estoqueNfeDevolucaoVenda');
      await reverterEstoqueNfeDevolucaoVenda(Number(notaId));
    } catch (err) {
      console.warn('[rc5] falha ao reverter estoque no cancelamento:', err.message);
    }
  }

  await dbRun(`
    UPDATE nfe_devolucoes_venda
    SET status = 'cancelada',
        motivo_cancelamento = ?,
        cancelado_em = CURRENT_TIMESTAMP,
        cancelado_por_id = ?,
        cancelado_por_nome = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [motivoLimpo, usuarioId || null, usuarioNome || null, Number(notaId)]);

  const saldos = await carregarSaldosDevolucaoVenda(nota.venda_id);
  return {
    success: true,
    notaId: Number(notaId),
    vendaId: nota.venda_id,
    message: 'NF-e de devolução cancelada. Saldo reaberto automaticamente.',
    saldos
  };
}

async function listarNotasDevolucaoVenda(vendaId) {
  await garantirTabelasSaldoDevolucaoVenda();
  try {
    const { garantirSchemaLifecycle } = require('./nfeDevolucaoLifecycleVenda');
    await garantirSchemaLifecycle();
  } catch (_) { /* opcional */ }

  const notas = await dbAll(`
    SELECT
      n.id, n.venda_id, n.numero, n.serie, n.chave_acesso, n.chave_referenciada,
      n.protocolo, n.status, n.natureza_operacao, n.cfop, n.created_at, n.updated_at,
      n.usuario_nome, n.cancelado_em, n.cancelado_por_nome, n.motivo_cancelamento,
      n.recibo, n.cstat_retorno, n.xmotivo_retorno, n.consultado_em, n.sincronizado_em,
      n.protocolo_cancelamento, n.rejeicao_codigo, n.rejeicao_motivo,
      CASE WHEN n.danfe_html IS NOT NULL AND n.danfe_html <> '' THEN 1 ELSE 0 END AS tem_danfe,
      CASE WHEN n.danfe_html_cancelado IS NOT NULL AND n.danfe_html_cancelado <> '' THEN 1 ELSE 0 END AS tem_danfe_cancelado,
      CASE WHEN COALESCE(n.xml_assinado, n.xml_enviado) IS NOT NULL AND COALESCE(n.xml_assinado, n.xml_enviado) <> '' THEN 1 ELSE 0 END AS tem_xml,
      (SELECT COALESCE(SUM(i.quantidade),0) FROM nfe_devolucao_venda_itens i WHERE i.nfe_devolucao_id = n.id) AS quantidade_total
    FROM nfe_devolucoes_venda n
    WHERE n.venda_id = ?
    ORDER BY n.id ASC
  `, [Number(vendaId)]);

  const comItens = [];
  for (const n of notas) {
    const itens = await dbAll(`
      SELECT i.*, p.nome AS produto_nome
      FROM nfe_devolucao_venda_itens i
      LEFT JOIN produtos p ON p.id = i.produto_id
      WHERE i.nfe_devolucao_id = ?
      ORDER BY i.n_item, i.id
    `, [n.id]);
    comItens.push({ ...n, itens });
  }
  return comItens;
}

module.exports = {
  STATUS,
  STATUS_UI,
  garantirTabelasSaldoDevolucaoVenda,
  carregarSaldosDevolucaoVenda,
  somarDevolvidoFiscalPorItem,
  validarQuantidadesContraSaldo,
  persistirItensNfeDevolucaoVenda,
  cancelarNfeDevolucaoVenda,
  listarNotasDevolucaoVenda,
  statusDoSaldo,
  round3
};
