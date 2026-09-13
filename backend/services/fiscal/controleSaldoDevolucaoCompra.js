/**
 * RC3 — Controle inteligente de saldo de devoluções de compra (NF-e).
 * Fonte de verdade fiscal: nfe_devolucao_compra_itens + notas autorizadas (não canceladas).
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

function statusDoSaldo({ quantidadeComprada, quantidadeDevolvida, saldo, solicitada }) {
  const comprada = round3(quantidadeComprada);
  const devolvida = round3(quantidadeDevolvida);
  const disp = round3(saldo != null ? saldo : Math.max(0, comprada - devolvida));
  if (solicitada != null && round3(solicitada) > disp + 1e-9) {
    return STATUS.SALDO_INSUFICIENTE;
  }
  if (devolvida <= 0) return STATUS.NAO_DEVOLVIDO;
  if (disp <= 1e-9) return STATUS.TOTAL;
  return STATUS.PARCIAL;
}

async function garantirTabelasSaldoDevolucao() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS nfe_devolucao_compra_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nfe_devolucao_id INTEGER NOT NULL,
      compra_id INTEGER NOT NULL,
      compra_item_id INTEGER NOT NULL,
      produto_id INTEGER,
      n_item INTEGER,
      quantidade DECIMAL(12,4) NOT NULL,
      quantidade_comprada DECIMAL(12,4),
      quantidade_devolvida_acumulada DECIMAL(12,4),
      saldo_apos DECIMAL(12,4),
      valor_unitario DECIMAL(14,6),
      valor_total DECIMAL(14,2),
      cfop TEXT,
      usuario_id INTEGER,
      usuario_nome TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_nfe_dev_itens_compra ON nfe_devolucao_compra_itens(compra_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_nfe_dev_itens_item ON nfe_devolucao_compra_itens(compra_item_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_nfe_dev_itens_nota ON nfe_devolucao_compra_itens(nfe_devolucao_id)`);

  const altersHeader = [
    `ALTER TABLE nfe_devolucoes_compra ADD COLUMN cancelado_em DATETIME`,
    `ALTER TABLE nfe_devolucoes_compra ADD COLUMN cancelado_por_id INTEGER`,
    `ALTER TABLE nfe_devolucoes_compra ADD COLUMN cancelado_por_nome TEXT`,
    `ALTER TABLE nfe_devolucoes_compra ADD COLUMN motivo_cancelamento TEXT`,
    `ALTER TABLE nfe_devolucoes_compra ADD COLUMN usuario_id INTEGER`,
    `ALTER TABLE nfe_devolucoes_compra ADD COLUMN usuario_nome TEXT`
  ];
  for (const sql of altersHeader) {
    try { await dbRun(sql); } catch (_) { /* já existe */ }
  }
}

/**
 * Quantidade já devolvida via NF-e autorizada (exclui canceladas).
 */
async function somarDevolvidoFiscalPorItem(compraItemId) {
  const row = await dbGet(`
    SELECT COALESCE(SUM(i.quantidade), 0) AS qtd
    FROM nfe_devolucao_compra_itens i
    INNER JOIN nfe_devolucoes_compra n ON n.id = i.nfe_devolucao_id
    WHERE i.compra_item_id = ?
      AND LOWER(TRIM(COALESCE(n.status, ''))) = 'autorizada'
  `, [Number(compraItemId)]);
  return round3(row?.qtd);
}

/**
 * Saldo fiscal por item da compra.
 */
async function carregarSaldosDevolucaoCompra(compraId) {
  await garantirTabelasSaldoDevolucao();
  const id = Number(compraId);

  const compra = await dbGet(`SELECT id, status FROM compras WHERE id = ?`, [id]);
  if (!compra) {
    throw Object.assign(new Error('Compra não encontrada.'), {
      code: 'COMPRA_NAO_ENCONTRADA',
      statusCode: 404
    });
  }

  const itens = await dbAll(`
    SELECT
      ci.id AS compra_item_id,
      ci.compra_id,
      ci.produto_id,
      ci.quantidade AS quantidade_comprada,
      ci.preco_unitario,
      ci.custo_unitario_final,
      ci.ncm,
      ci.unidade,
      ci.descricao_produto,
      ci.codigo_barras,
      p.nome AS produto_nome,
      p.codigo AS produto_codigo,
      p.ncm AS produto_ncm,
      p.unidade AS produto_unidade,
      COALESCE((
        SELECT SUM(i.quantidade)
        FROM nfe_devolucao_compra_itens i
        INNER JOIN nfe_devolucoes_compra n ON n.id = i.nfe_devolucao_id
        WHERE i.compra_item_id = ci.id
          AND LOWER(TRIM(COALESCE(n.status, ''))) = 'autorizada'
      ), 0) AS quantidade_devolvida
    FROM compras_itens ci
    LEFT JOIN produtos p ON p.id = ci.produto_id
    WHERE ci.compra_id = ?
    ORDER BY ci.id
  `, [id]);

  const mapeados = itens.map((row) => {
    const comprada = round3(row.quantidade_comprada);
    const devolvida = round3(row.quantidade_devolvida);
    const saldo = round3(Math.max(0, comprada - devolvida));
    const status = statusDoSaldo({
      quantidadeComprada: comprada,
      quantidadeDevolvida: devolvida,
      saldo
    });
    return {
      compra_item_id: row.compra_item_id,
      produto_id: row.produto_id,
      produto_nome: row.produto_nome || row.descricao_produto,
      produto_codigo: row.produto_codigo,
      ncm: row.ncm || row.produto_ncm,
      unidade: row.unidade || row.produto_unidade || 'UN',
      valor_unitario: Number(row.custo_unitario_final || row.preco_unitario || 0),
      quantidade_comprada: comprada,
      quantidade_devolvida: devolvida,
      saldo,
      quantidade_maxima: saldo,
      status,
      status_ui: STATUS_UI[status],
      codigo_barras: row.codigo_barras
    };
  });

  const totalComprado = mapeados.reduce((s, i) => s + i.quantidade_comprada, 0);
  const totalDevolvido = mapeados.reduce((s, i) => s + i.quantidade_devolvida, 0);
  const totalSaldo = mapeados.reduce((s, i) => s + i.saldo, 0);
  let statusCompra = STATUS.NAO_DEVOLVIDO;
  if (totalDevolvido > 0 && totalSaldo <= 1e-9) statusCompra = STATUS.TOTAL;
  else if (totalDevolvido > 0) statusCompra = STATUS.PARCIAL;

  return {
    compraId: id,
    compraStatus: compra.status,
    compraCancelada: String(compra.status || '').toLowerCase() === 'cancelada',
    statusCompra,
    statusCompraUi: STATUS_UI[statusCompra],
    totais: {
      comprado: round3(totalComprado),
      devolvido: round3(totalDevolvido),
      saldo: round3(totalSaldo)
    },
    itens: mapeados
  };
}

/**
 * Valida itens solicitados contra saldo fiscal.
 */
function validarQuantidadesContraSaldo({ saldos, itensSolicitados, compraCancelada }) {
  const erros = [];
  if (compraCancelada) {
    erros.push('Compra cancelada — não é possível emitir NF-e de devolução.');
  }
  if (!Array.isArray(itensSolicitados) || !itensSolicitados.length) {
    erros.push('Informe ao menos um item com quantidade para devolução.');
    return { ok: false, erros };
  }

  const porId = new Map((saldos.itens || []).map((i) => [Number(i.compra_item_id), i]));

  for (const req of itensSolicitados) {
    const itemId = Number(req.compra_item_id || req.id);
    const qtd = round3(req.quantidade);
    const base = porId.get(itemId);
    const nome = base?.produto_nome || req.produto_nome || itemId;

    if (!base) {
      erros.push(`Item inexistente na compra: ${nome}.`);
      continue;
    }
    if (!(qtd > 0)) {
      erros.push(`Quantidade zero inválida para "${nome}".`);
      continue;
    }
    if (qtd > base.saldo + 1e-9) {
      erros.push(
        `Saldo insuficiente para "${nome}": solicitado ${qtd}, saldo ${base.saldo} (comprado ${base.quantidade_comprada}, já devolvido ${base.quantidade_devolvida}).`
      );
      continue;
    }
    if (qtd > base.quantidade_comprada + 1e-9) {
      erros.push(`Quantidade devolvida (${qtd}) maior que comprada (${base.quantidade_comprada}) em "${nome}".`);
    }
  }

  return { ok: erros.length === 0, erros };
}

/**
 * Persiste itens da NF-e após autorização (atualiza saldo).
 */
async function persistirItensNfeDevolucao({
  nfeDevolucaoId,
  compraId,
  itens,
  usuarioId = null,
  usuarioNome = null
}) {
  await garantirTabelasSaldoDevolucao();
  const saldos = await carregarSaldosDevolucaoCompra(compraId);
  const porId = new Map(saldos.itens.map((i) => [Number(i.compra_item_id), i]));
  let nItem = 0;

  for (const item of itens || []) {
    const qtd = round3(item.quantidade);
    if (!(qtd > 0)) continue;
    nItem += 1;
    const itemId = Number(item.compra_item_id || item.id);
    const base = porId.get(itemId);
    const comprada = base ? base.quantidade_comprada : round3(item.quantidade_comprada);
    const jaDev = base ? base.quantidade_devolvida : 0;
    const acumulada = round3(jaDev + qtd);
    const saldoApos = round3(Math.max(0, comprada - acumulada));
    const vu = Number(item.valor_unitario || base?.valor_unitario || 0);

    await dbRun(`
      INSERT INTO nfe_devolucao_compra_itens (
        nfe_devolucao_id, compra_id, compra_item_id, produto_id, n_item,
        quantidade, quantidade_comprada, quantidade_devolvida_acumulada, saldo_apos,
        valor_unitario, valor_total, cfop, usuario_id, usuario_nome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      Number(nfeDevolucaoId),
      Number(compraId),
      itemId,
      item.produto_id || base?.produto_id || null,
      nItem,
      qtd,
      comprada,
      acumulada,
      saldoApos,
      vu,
      Math.round(qtd * vu * 100) / 100,
      item.cfop || null,
      usuarioId,
      usuarioNome
    ]);
  }

  return carregarSaldosDevolucaoCompra(compraId);
}

/**
 * Cancela NF-e de devolução (reabre saldo). MVP: cancelamento operacional local.
 */
async function cancelarNfeDevolucaoCompra(notaId, { motivo, usuarioId, usuarioNome } = {}) {
  await garantirTabelasSaldoDevolucao();
  const nota = await dbGet(`SELECT * FROM nfe_devolucoes_compra WHERE id = ?`, [Number(notaId)]);
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

  await dbRun(`
    UPDATE nfe_devolucoes_compra
    SET status = 'cancelada',
        motivo_cancelamento = ?,
        cancelado_em = CURRENT_TIMESTAMP,
        cancelado_por_id = ?,
        cancelado_por_nome = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [motivoLimpo, usuarioId || null, usuarioNome || null, Number(notaId)]);

  const saldos = await carregarSaldosDevolucaoCompra(nota.compra_id);
  return {
    success: true,
    notaId: Number(notaId),
    compraId: nota.compra_id,
    message: 'NF-e de devolução cancelada. Saldo reaberto automaticamente.',
    saldos
  };
}

async function listarNotasDevolucaoCompra(compraId) {
  await garantirTabelasSaldoDevolucao();
  try {
    const { garantirSchemaLifecycle } = require('./nfeDevolucaoLifecycleService');
    await garantirSchemaLifecycle();
  } catch (_) { /* schema lifecycle opcional em ambientes sem o módulo */ }
  const notas = await dbAll(`
    SELECT
      n.id, n.compra_id, n.numero, n.serie, n.chave_acesso, n.chave_referenciada,
      n.protocolo, n.status, n.natureza_operacao, n.cfop, n.created_at, n.updated_at,
      n.usuario_nome, n.cancelado_em, n.cancelado_por_nome, n.motivo_cancelamento,
      n.recibo, n.cstat_retorno, n.xmotivo_retorno, n.consultado_em, n.sincronizado_em,
      n.protocolo_cancelamento, n.rejeicao_codigo, n.rejeicao_motivo,
      CASE WHEN n.danfe_html IS NOT NULL AND n.danfe_html <> '' THEN 1 ELSE 0 END AS tem_danfe,
      CASE WHEN n.danfe_html_cancelado IS NOT NULL AND n.danfe_html_cancelado <> '' THEN 1 ELSE 0 END AS tem_danfe_cancelado,
      CASE WHEN COALESCE(n.xml_assinado, n.xml_enviado) IS NOT NULL AND COALESCE(n.xml_assinado, n.xml_enviado) <> '' THEN 1 ELSE 0 END AS tem_xml,
      (SELECT COALESCE(SUM(i.quantidade),0) FROM nfe_devolucao_compra_itens i WHERE i.nfe_devolucao_id = n.id) AS quantidade_total
    FROM nfe_devolucoes_compra n
    WHERE n.compra_id = ?
    ORDER BY n.id ASC
  `, [Number(compraId)]);

  const comItens = [];
  for (const n of notas) {
    const itens = await dbAll(`
      SELECT i.*, p.nome AS produto_nome
      FROM nfe_devolucao_compra_itens i
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
  garantirTabelasSaldoDevolucao,
  carregarSaldosDevolucaoCompra,
  somarDevolvidoFiscalPorItem,
  validarQuantidadesContraSaldo,
  persistirItensNfeDevolucao,
  cancelarNfeDevolucaoCompra,
  listarNotasDevolucaoCompra,
  statusDoSaldo,
  round3
};
