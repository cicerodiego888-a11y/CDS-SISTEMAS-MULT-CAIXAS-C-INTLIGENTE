/**
 * Interface Pública de Saldos — Motor Fiscal × Não Fiscal.
 *
 * Única porta autorizada para consultar / debitar / creditar
 * saldo_fiscal e saldo_nao_fiscal de produtos.
 *
 * Outros Motores (ex.: MTS) DEVEM usar apenas estas funções.
 * Não exporta SQL nem acesso cru a tabelas.
 *
 * @module services/fiscalNaoFiscal/estoqueSaldosPublico
 */
'use strict';

const { TipoSaldo, normalizarTipoSaldo } = require('./constants');
const { recalcularEstoqueConsolidado } = require('../estoqueFiscalService');

function round3(n) {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

function getDb(dbInjected) {
  if (dbInjected) return dbInjected;
  return require('../../database');
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

/**
 * Consulta saldos públicos de um produto.
 * @param {number} produtoId
 * @param {{ db?: object }} [opts]
 */
async function consultarSaldo(produtoId, opts = {}) {
  const id = Number(produtoId);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('Produto inválido.');
    err.code = 'PRODUTO_INVALIDO';
    throw err;
  }

  const db = getDb(opts.db);
  const row = await dbGet(
    db,
    `SELECT id, saldo_fiscal, saldo_nao_fiscal, estoque_atual
     FROM produtos WHERE id = ?`,
    [id]
  );

  if (!row) {
    const err = new Error('Produto não encontrado.');
    err.code = 'PRODUTO_NAO_ENCONTRADO';
    throw err;
  }

  const saldoFiscal = round3(row.saldo_fiscal);
  const saldoNaoFiscal = round3(row.saldo_nao_fiscal);

  return Object.freeze({
    produto_id: id,
    existe: true,
    saldo_fiscal: saldoFiscal,
    saldo_nao_fiscal: saldoNaoFiscal,
    estoque_total: round3(
      row.estoque_atual != null
        ? row.estoque_atual
        : recalcularEstoqueConsolidado({ saldo_fiscal: saldoFiscal, saldo_nao_fiscal: saldoNaoFiscal })
    )
  });
}

async function _ajustarSaldo(produtoId, tipo, delta, opts = {}) {
  const tipoN = normalizarTipoSaldo(tipo);
  const q = round3(delta);
  if (!Number.isFinite(q) || q === 0) {
    const err = new Error('Quantidade de ajuste inválida.');
    err.code = 'QUANTIDADE_INVALIDA';
    throw err;
  }

  const db = getDb(opts.db);
  const saldos = await consultarSaldo(produtoId, { db });

  let saldoFiscal = saldos.saldo_fiscal;
  let saldoNaoFiscal = saldos.saldo_nao_fiscal;

  if (tipoN === TipoSaldo.FISCAL) {
    saldoFiscal = round3(saldoFiscal + q);
  } else {
    saldoNaoFiscal = round3(saldoNaoFiscal + q);
  }

  if (saldoFiscal < -1e-9 || saldoNaoFiscal < -1e-9) {
    const err = new Error(
      tipoN === TipoSaldo.FISCAL
        ? 'Saldo fiscal insuficiente.'
        : 'Saldo não fiscal insuficiente.'
    );
    err.code = 'SALDO_INSUFICIENTE';
    err.saldo_disponivel = tipoN === TipoSaldo.FISCAL
      ? saldos.saldo_fiscal
      : saldos.saldo_nao_fiscal;
    throw err;
  }

  const estoqueTotal = round3(saldoFiscal + saldoNaoFiscal);

  await dbRun(
    db,
    `UPDATE produtos
     SET saldo_fiscal = ?,
         saldo_nao_fiscal = ?,
         estoque_atual = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [saldoFiscal, saldoNaoFiscal, estoqueTotal, saldos.produto_id]
  );

  return Object.freeze({
    produto_id: saldos.produto_id,
    tipo: tipoN,
    delta: q,
    saldo_fiscal_antes: saldos.saldo_fiscal,
    saldo_nao_fiscal_antes: saldos.saldo_nao_fiscal,
    saldo_fiscal_depois: saldoFiscal,
    saldo_nao_fiscal_depois: saldoNaoFiscal,
    estoque_total_depois: estoqueTotal
  });
}

/**
 * Debita quantidade do tipo informado (saldo não pode ficar negativo).
 */
async function debitarSaldo(produtoId, tipo, quantidade, opts = {}) {
  const q = round3(quantidade);
  if (!(q > 0)) {
    const err = new Error('Quantidade para débito deve ser maior que zero.');
    err.code = 'QUANTIDADE_INVALIDA';
    throw err;
  }
  return _ajustarSaldo(produtoId, tipo, -q, opts);
}

/**
 * Credita quantidade no tipo informado.
 */
async function creditarSaldo(produtoId, tipo, quantidade, opts = {}) {
  const q = round3(quantidade);
  if (!(q > 0)) {
    const err = new Error('Quantidade para crédito deve ser maior que zero.');
    err.code = 'QUANTIDADE_INVALIDA';
    throw err;
  }
  return _ajustarSaldo(produtoId, tipo, q, opts);
}

/**
 * Executa transferência F↔NF de forma atômica no Motor (débito + crédito).
 * Preferível quando o chamador não gerencia a transação.
 */
async function transferirSaldoEntreTipos(params = {}, opts = {}) {
  const produtoId = Number(params.produtoId || params.produto_id);
  const origem = normalizarTipoSaldo(params.origem);
  const destino = normalizarTipoSaldo(params.destino);
  const quantidade = round3(params.quantidade);

  if (origem === destino) {
    const err = new Error('Origem e destino devem ser diferentes.');
    err.code = 'ORIGEM_DESTINO_IGUAIS';
    throw err;
  }
  if (!(quantidade > 0)) {
    const err = new Error('Quantidade deve ser maior que zero.');
    err.code = 'QUANTIDADE_INVALIDA';
    throw err;
  }

  const db = getDb(opts.db);
  const antes = await consultarSaldo(produtoId, { db });
  const disponivel = origem === TipoSaldo.FISCAL
    ? antes.saldo_fiscal
    : antes.saldo_nao_fiscal;

  if (disponivel + 1e-9 < quantidade) {
    const err = new Error(
      origem === TipoSaldo.FISCAL
        ? 'Saldo fiscal insuficiente.'
        : 'Saldo não fiscal insuficiente.'
    );
    err.code = 'SALDO_INSUFICIENTE';
    err.saldo_disponivel = disponivel;
    throw err;
  }

  const debito = await debitarSaldo(produtoId, origem, quantidade, { db });
  const credito = await creditarSaldo(produtoId, destino, quantidade, { db });
  const depois = await consultarSaldo(produtoId, { db });

  return Object.freeze({
    produto_id: produtoId,
    origem,
    destino,
    quantidade,
    saldo_origem_antes: origem === TipoSaldo.FISCAL
      ? antes.saldo_fiscal
      : antes.saldo_nao_fiscal,
    saldo_origem_depois: origem === TipoSaldo.FISCAL
      ? depois.saldo_fiscal
      : depois.saldo_nao_fiscal,
    saldo_destino_antes: destino === TipoSaldo.FISCAL
      ? antes.saldo_fiscal
      : antes.saldo_nao_fiscal,
    saldo_destino_depois: destino === TipoSaldo.FISCAL
      ? depois.saldo_fiscal
      : depois.saldo_nao_fiscal,
    debito,
    credito,
    saldos: depois
  });
}

/**
 * Executa callback dentro de BEGIN IMMEDIATE / COMMIT (rollback em falha).
 * @param {Function} work async (db) => result
 * @param {{ db?: object }} [opts]
 */
async function executarEmTransacao(work, opts = {}) {
  const db = getDb(opts.db);
  await dbRun(db, 'BEGIN IMMEDIATE');
  try {
    const result = await work(db);
    await dbRun(db, 'COMMIT');
    return result;
  } catch (err) {
    try {
      await dbRun(db, 'ROLLBACK');
    } catch (_) { /* ignore */ }
    throw err;
  }
}

module.exports = {
  TipoSaldo,
  normalizarTipoSaldo,
  consultarSaldo,
  debitarSaldo,
  creditarSaldo,
  transferirSaldoEntreTipos,
  executarEmTransacao
};
