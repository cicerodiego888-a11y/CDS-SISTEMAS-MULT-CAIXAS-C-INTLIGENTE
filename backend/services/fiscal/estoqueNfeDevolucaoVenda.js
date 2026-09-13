/**
 * RC5 — Retorno/reversão de estoque na autorização/cancelamento da NF-e de Devolução de Venda.
 */

'use strict';

const db = require('../../database');
const { resolverQuantidadesVendaItem } = require('../estoqueFiscalService');
const { devolverSaldosDistribuidos } = require('../vendas/VendaDevolucaoService');
const lotesService = require('../lotesService');

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes });
    });
  });
}

function promisify(fn) {
  return (...args) => new Promise((resolve, reject) => {
    fn(...args, (err, result) => (err ? reject(err) : resolve(result)));
  });
}

const devolverSaldosAsync = promisify(devolverSaldosDistribuidos);

/**
 * Ao autorizar: devolve quantidade ao estoque físico/fiscal.
 */
async function retornarEstoqueNfeDevolucaoVenda(nfeDevolucaoId) {
  const nota = await dbGet(`SELECT * FROM nfe_devolucoes_venda WHERE id = ?`, [Number(nfeDevolucaoId)]);
  if (!nota || Number(nota.estoque_retornado) === 1) return { ok: true, reused: true };

  const itens = await dbAll(`
    SELECT i.*, vi.quantidade, vi.quantidade_fiscal, vi.quantidade_nao_fiscal, vi.produto_id AS vi_produto_id
    FROM nfe_devolucao_venda_itens i
    LEFT JOIN vendas_itens vi ON vi.id = i.venda_item_id
    WHERE i.nfe_devolucao_id = ?
  `, [Number(nfeDevolucaoId)]);

  for (const item of itens) {
    if (Number(item.estoque_retornado) === 1) continue;
    const produtoId = item.produto_id || item.vi_produto_id;
    const qtd = Number(item.quantidade || 0);
    if (!produtoId || !(qtd > 0)) continue;

    const baseItem = {
      id: item.venda_item_id,
      produto_id: produtoId,
      quantidade: item.quantidade_vendida || item.quantidade,
      quantidade_fiscal: item.quantidade_fiscal,
      quantidade_nao_fiscal: item.quantidade_nao_fiscal
    };
    const qtdsOrig = resolverQuantidadesVendaItem(baseItem);
    const totalOrig = Number(qtdsOrig.quantidade_fiscal || 0) + Number(qtdsOrig.quantidade_nao_fiscal || 0)
      || Number(baseItem.quantidade || 0) || 1;
    const fator = Math.min(1, qtd / totalOrig);
    const qtdFiscal = Math.round(Number(qtdsOrig.quantidade_fiscal || 0) * fator * 1000) / 1000;
    const qtdNaoFiscal = Math.round(Math.max(0, qtd - qtdFiscal) * 1000) / 1000;

    await new Promise((resolve, reject) => {
      lotesService.produtoControlaValidade(produtoId, (err, controla) => {
        if (err) return reject(err);
        const aplicar = () => {
          devolverSaldosDistribuidos(produtoId, qtdFiscal, qtdNaoFiscal, (saldoErr) => {
            if (saldoErr) return reject(saldoErr);
            resolve();
          });
        };
        if (controla) {
          // restauração parcial de lotes quando possível
          const { devolverLotesParcialItem } = require('../vendas/VendaDevolucaoService');
          if (typeof devolverLotesParcialItem === 'function') {
            devolverLotesParcialItem(item.venda_item_id, qtd, (loteErr) => {
              if (loteErr) return reject(loteErr);
              aplicar();
            });
            return;
          }
        }
        aplicar();
      });
    });

    await dbRun(
      `UPDATE nfe_devolucao_venda_itens SET estoque_retornado = 1 WHERE id = ?`,
      [item.id]
    );
  }

  await dbRun(
    `UPDATE nfe_devolucoes_venda SET estoque_retornado = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [Number(nfeDevolucaoId)]
  );
  return { ok: true, itens: itens.length };
}

/**
 * Ao cancelar NF-e autorizada: remove do estoque o que havia sido devolvido.
 */
async function reverterEstoqueNfeDevolucaoVenda(nfeDevolucaoId) {
  const itens = await dbAll(`
    SELECT * FROM nfe_devolucao_venda_itens
    WHERE nfe_devolucao_id = ? AND COALESCE(estoque_retornado, 0) = 1
  `, [Number(nfeDevolucaoId)]);

  for (const item of itens) {
    const produtoId = item.produto_id;
    const qtd = Number(item.quantidade || 0);
    if (!produtoId || !(qtd > 0)) continue;

    await dbRun(`
      UPDATE produtos
      SET
        saldo_fiscal = CASE WHEN saldo_fiscal - ? < 0 THEN 0 ELSE saldo_fiscal - ? END,
        estoque_atual = CASE WHEN estoque_atual - ? < 0 THEN 0 ELSE estoque_atual - ? END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [qtd, qtd, qtd, qtd, produtoId]);

    await dbRun(
      `UPDATE nfe_devolucao_venda_itens SET estoque_retornado = 0 WHERE id = ?`,
      [item.id]
    );
  }

  await dbRun(
    `UPDATE nfe_devolucoes_venda SET estoque_retornado = 0 WHERE id = ?`,
    [Number(nfeDevolucaoId)]
  );
  return { ok: true };
}

module.exports = {
  retornarEstoqueNfeDevolucaoVenda,
  reverterEstoqueNfeDevolucaoVenda
};
