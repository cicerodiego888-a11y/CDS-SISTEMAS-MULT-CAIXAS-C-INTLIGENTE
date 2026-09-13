'use strict';

const db = require('../../database');
const lotesService = require('../lotesService');
const { resolverQuantidadesVendaItem, calcularDevolucaoVendaFiscalPrimeiro } = require('../estoqueFiscalService');
const { gravarAuditoria } = require('../auditoria');
const { validarMotivoTexto } = require('../validacao/validarMotivoTexto');
const { recalcularFinanceiroDevolucaoVenda } = require('./VendaFinanceiroService');
const mpfc = require('../mpfc');

function devolverSaldosDistribuidos(produtoId, quantidadeFiscal, quantidadeNaoFiscal, callback) {
  const qtdFiscal = Number(quantidadeFiscal || 0);
  const qtdNaoFiscal = Number(quantidadeNaoFiscal || 0);

  if (qtdFiscal <= 0 && qtdNaoFiscal <= 0) {
    return callback(null);
  }

  db.run(`
    UPDATE produtos
    SET
      saldo_fiscal = saldo_fiscal + ?,
      saldo_nao_fiscal = saldo_nao_fiscal + ?,
      estoque_atual = (saldo_fiscal + ?) + (saldo_nao_fiscal + ?),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [qtdFiscal, qtdNaoFiscal, qtdFiscal, qtdNaoFiscal, produtoId], callback);
}

function devolverEstoqueItemVenda(item, callback) {
  const qtds = resolverQuantidadesVendaItem(item);

  db.get(`
    SELECT
      COALESCE(SUM(quantidade_fiscal), 0) AS devolvido_fiscal,
      COALESCE(SUM(quantidade_nao_fiscal), 0) AS devolvido_nao_fiscal
    FROM vendas_devolucoes
    WHERE venda_item_id = ?
  `, [item.id], (devErr, devRow) => {
    const qtdFiscal = devErr
      ? Number(qtds.quantidade_fiscal || 0)
      : Math.max(0, Number(qtds.quantidade_fiscal || 0) - Number(devRow?.devolvido_fiscal || 0));
    const qtdNaoFiscal = devErr
      ? Number(qtds.quantidade_nao_fiscal || 0)
      : Math.max(0, Number(qtds.quantidade_nao_fiscal || 0) - Number(devRow?.devolvido_nao_fiscal || 0));

    if (qtdFiscal <= 0 && qtdNaoFiscal <= 0) {
      return callback(null);
    }

    lotesService.produtoControlaValidade(item.produto_id, (controlErr, controlaValidade) => {
      if (controlErr) return callback(controlErr);

      const aplicarSaldos = (saldoErr) => {
        if (saldoErr) return callback(saldoErr);
        devolverSaldosDistribuidos(
          item.produto_id,
          qtdFiscal,
          qtdNaoFiscal,
          callback
        );
      };

      if (controlaValidade) {
        lotesService.restaurarLotesVenda(item.id, aplicarSaldos);
        return;
      }

      aplicarSaldos(null);
    });
  });
}

function devolverLotesParcialItem(vendaItemId, quantidade, callback) {
  db.all(
    `
    SELECT id, produto_lote_id, quantidade
    FROM venda_lotes
    WHERE venda_item_id = ?
    ORDER BY id DESC
    `,
    [vendaItemId],
    (err, lotes) => {
      if (err) return callback(err);
      if (!lotes || lotes.length === 0) return callback(null);

      let restante = Number(quantidade || 0);
      let indice = 0;

      function processarProximo() {
        if (restante <= 0.0009 || indice >= lotes.length) {
          return callback(null);
        }

        const lote = lotes[indice++];
        const consumido = Number(lote.quantidade || 0);
        const restaurar = Math.min(restante, consumido);

        db.run(
          `
          UPDATE produtos_lotes
          SET quantidade_atual = quantidade_atual + ?,
              atualizado_em = CURRENT_TIMESTAMP
          WHERE id = ?
          `,
          [restaurar, lote.produto_lote_id],
          (loteErr) => {
            if (loteErr) return callback(loteErr);

            const saldoConsumo = consumido - restaurar;
            const finalizarLote = (updateErr) => {
              if (updateErr) return callback(updateErr);
              restante -= restaurar;
              processarProximo();
            };

            if (saldoConsumo <= 0.0009) {
              db.run('DELETE FROM venda_lotes WHERE id = ?', [lote.id], finalizarLote);
            } else {
              db.run(
                'UPDATE venda_lotes SET quantidade = ? WHERE id = ?',
                [saldoConsumo, lote.id],
                finalizarLote
              );
            }
          }
        );
      }

      processarProximo();
    }
  );
}

function devolverEstoqueParcialItem(item, splitDevolucao, callback) {
  lotesService.produtoControlaValidade(item.produto_id, (controlErr, controlaValidade) => {
    if (controlErr) return callback(controlErr);

    const aplicarSaldos = (saldoErr) => {
      if (saldoErr) return callback(saldoErr);
      devolverSaldosDistribuidos(
        item.produto_id,
        splitDevolucao.qtdFiscal,
        splitDevolucao.qtdNaoFiscal,
        callback
      );
    };

    if (controlaValidade && Number(splitDevolucao.qtdTotal || 0) > 0) {
      devolverLotesParcialItem(item.id, splitDevolucao.qtdTotal, aplicarSaldos);
      return;
    }

    aplicarSaldos(null);
  });
}

function devolverEstoqueItensVenda(itens, callback) {
  if (!itens || itens.length === 0) {
    return callback(null);
  }

  let indice = 0;

  function processarProximo() {
    if (indice >= itens.length) {
      return callback(null);
    }

    const item = itens[indice];
    indice += 1;

    devolverEstoqueItemVenda(item, (err) => {
      if (err) return callback(err);
      processarProximo();
    });
  }

  processarProximo();
}

function garantirTabelaDevolucoesVenda(callback) {
  db.run(`
    CREATE TABLE IF NOT EXISTS vendas_devolucoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER NOT NULL,
      venda_item_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade DECIMAL(10,3) NOT NULL,
      quantidade_fiscal DECIMAL(10,3) NOT NULL DEFAULT 0,
      quantidade_nao_fiscal DECIMAL(10,3) NOT NULL DEFAULT 0,
      valor_unitario DECIMAL(10,2) NOT NULL,
      valor_total DECIMAL(10,2) NOT NULL,
      motivo TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, callback);
}

function devolverParcial(vendaId, motivo, itens, req, res) {
const validacaoMotivo = validarMotivoTexto(motivo);
if (!validacaoMotivo.valido) {
  return res.status(400).json({ error: validacaoMotivo.erro });
}

const itensValidos = itens
  .map((i) => ({
    venda_item_id: Number(i.venda_item_id),
    quantidade: Number(i.quantidade)
  }))
  .filter((i) => i.venda_item_id > 0 && i.quantidade > 0);

if (!itensValidos.length) {
  return res.status(400).json({ error: 'Informe ao menos um item para devolução.' });
}

garantirTabelaDevolucoesVenda((tableErr) => {
  if (tableErr) {
    return res.status(500).json({ error: tableErr.message });
  }

  db.get('SELECT * FROM vendas WHERE id = ?', [vendaId], (vendaErr, venda) => {
    if (vendaErr) {
      return res.status(500).json({ error: vendaErr.message });
    }
    if (!venda) {
      return res.status(404).json({ error: 'Venda não encontrada.' });
    }
    if (String(venda.status || '').toLowerCase() === 'cancelada') {
      return res.status(400).json({ error: 'Venda cancelada não pode receber devolução.' });
    }

    db.serialize(() => {
      db.run('BEGIN IMMEDIATE');

      let index = 0;
      let valorTotalDevolvido = 0;
      const itensProcessados = [];

      function processarProximo() {
        if (index >= itensValidos.length) {
          return finalizar();
        }

        const itemReq = itensValidos[index++];
        db.get(`
          SELECT
            vi.*,
            COALESCE(p.nome, 'Produto') AS produto_nome,
            COALESCE((
              SELECT SUM(vd.quantidade_fiscal)
              FROM vendas_devolucoes vd
              WHERE vd.venda_item_id = vi.id
            ), 0) AS qtd_fiscal_ja_devolvida,
            COALESCE((
              SELECT SUM(vd.quantidade_nao_fiscal)
              FROM vendas_devolucoes vd
              WHERE vd.venda_item_id = vi.id
            ), 0) AS qtd_nao_fiscal_ja_devolvida,
            COALESCE((
              SELECT SUM(vd.quantidade)
              FROM vendas_devolucoes vd
              WHERE vd.venda_item_id = vi.id
            ), 0) AS quantidade_ja_devolvida
          FROM vendas_itens vi
          LEFT JOIN produtos p ON p.id = vi.produto_id
          WHERE vi.id = ? AND vi.venda_id = ?
        `, [itemReq.venda_item_id, vendaId], (itemErr, item) => {
          if (itemErr) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: itemErr.message });
          }
          if (!item) {
            db.run('ROLLBACK');
            return res.status(404).json({ error: 'Item da venda não encontrado.' });
          }

          const qtdsItem = resolverQuantidadesVendaItem(item);
          const qtdVendida = Number(qtdsItem.quantidade || 0);
          const qtdJaDevolvida = Number(item.quantidade_ja_devolvida || 0);
          const qtdDisponivel = qtdVendida - qtdJaDevolvida;
          const qtdDevolver = Number(itemReq.quantidade || 0);

          if (qtdDevolver > qtdDisponivel + 0.0009) {
            db.run('ROLLBACK');
            return res.status(400).json({
              error: `Produto "${item.produto_nome}" permite devolver no máximo ${qtdDisponivel}.`
            });
          }

          const splitDevolucao = calcularDevolucaoVendaFiscalPrimeiro(item, qtdDevolver, {
            fiscal: item.qtd_fiscal_ja_devolvida,
            nao_fiscal: item.qtd_nao_fiscal_ja_devolvida
          });

          const valorUnitario = Number(item.preco_unitario || 0);
          const valorTotal = Number((splitDevolucao.qtdTotal * valorUnitario).toFixed(2));
          valorTotalDevolvido += valorTotal;

          db.run(`
            INSERT INTO vendas_devolucoes (
              venda_id, venda_item_id, produto_id, quantidade,
              quantidade_fiscal, quantidade_nao_fiscal,
              valor_unitario, valor_total, motivo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            vendaId,
            item.id,
            item.produto_id,
            splitDevolucao.qtdTotal,
            splitDevolucao.qtdFiscal,
            splitDevolucao.qtdNaoFiscal,
            valorUnitario,
            valorTotal,
            motivo
          ], (insertErr) => {
            if (insertErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: insertErr.message });
            }

            devolverEstoqueParcialItem(item, splitDevolucao, (estoqueErr) => {
                if (estoqueErr) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: estoqueErr.message });
                }

                itensProcessados.push({
                  venda_item_id: item.id,
                  produto_id: item.produto_id,
                  quantidade: splitDevolucao.qtdTotal,
                  quantidade_fiscal: splitDevolucao.qtdFiscal,
                  quantidade_nao_fiscal: splitDevolucao.qtdNaoFiscal,
                  valor_total: valorTotal
                });

                processarProximo();
              }
            );
          });
        });
      }

      function finalizar() {
        const valorFinal = Number(valorTotalDevolvido.toFixed(2));

        recalcularFinanceiroDevolucaoVenda(vendaId, valorFinal, venda, {
          observacao: `Devolução parcial: ${motivo}`
        })
          .then((financeiroResumo) => {
            db.run('COMMIT');
            gravarAuditoria({
              usuario_id: req.operadorId || req.user?.id || null,
              usuario_nome: req.user?.username || req.user?.nome || null,
              modulo: 'vendas',
              acao: 'devolver_venda',
              referencia_tipo: 'venda',
              referencia_id: vendaId,
              detalhes: {
                motivo,
                valor_total_devolvido: valorFinal,
                itens: itensProcessados,
                financeiro: financeiroResumo,
                sessao_id: req.caixaSessaoId || null,
                autorizado_admin: true,
                ip: req.ip || null,
                // RC8.2.2 — estorno/devolução usa snapshot da venda (nunca config atual)
                ...(() => {
                  const r = mpfc.resolverPoliticaOperacionalDaVenda(venda, 'estorno');
                  return {
                    mpfc_snapshot_presente: r.snapshotPresente,
                    mpfc_fonte: r.fonte,
                    mpfc_politica: r.payload
                  };
                })()
              },
              ip_requisicao: req.ip || null
            }).catch((auditErr) => console.error('Erro ao gravar auditoria de devolução:', auditErr));
            res.json({
              success: true,
              message: 'Devolução registrada com sucesso.',
              venda_id: vendaId,
              valor_total_devolvido: valorFinal,
              financeiro: financeiroResumo,
              itens: itensProcessados
            });
          })
          .catch((finErr) => {
            db.run('ROLLBACK');
            res.status(500).json({ error: finErr.message });
          });
      }

      processarProximo();
    });
  });
});
}

module.exports = {
  devolverSaldosDistribuidos,
  devolverEstoqueItemVenda,
  devolverEstoqueItensVenda,
  devolverLotesParcialItem,
  garantirTabelaDevolucoesVenda,
  devolverParcial
};
