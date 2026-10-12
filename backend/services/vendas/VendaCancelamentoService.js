'use strict';

const db = require('../../database');
const { gravarAuditoria } = require('../auditoria');
const { validarMotivoTexto } = require('../validacao/validarMotivoTexto');
const { cancelarFiscal } = require('../tef/ReversaoFiscal');
const VendaDevolucaoService = require('./VendaDevolucaoService');
const VendaFiscalService = require('./VendaFiscalService');
const { cancelarFinanceiroVenda } = require('./VendaFinanceiroService');
const { avaliarCancelamentoVenda } = require('./VendaCancelamentoAvaliacaoService');
const mpfc = require('../mpfc');

const { devolverEstoqueItensVenda } = VendaDevolucaoService;
const { cancelarNfceAutorizadaVenda } = VendaFiscalService;

/**
 * Executa `prosseguir(avaliacao)` só quando a situação fiscal permite cancelar a venda.
 * Bloqueios respondem antes de qualquer estorno TEF, estoque ou financeiro.
 */
function comAvaliacaoCancelamento(vendaId, res, formato, prosseguir) {
  avaliarCancelamentoVenda(vendaId)
    .then((avaliacao) => {
      if (avaliacao.bloqueio) {
        const corpo = formato === 'put'
          ? { error: avaliacao.mensagem, codigo: avaliacao.bloqueio.codigo, avaliacao }
          : { sucesso: false, mensagem: avaliacao.mensagem, codigo: avaliacao.bloqueio.codigo, avaliacao };
        return res.status(409).json(corpo);
      }
      return prosseguir(avaliacao);
    })
    .catch((err) => {
      const status = err.statusCode || 500;
      const msg = err.message || 'Erro ao avaliar o cancelamento.';
      res.status(status).json(formato === 'put' ? { error: msg } : { sucesso: false, mensagem: msg });
    });
}

/**
 * RC8.2.2 — política operacional da venda via snapshot (nunca configuração atual).
 */
function anexarPoliticaSnapshotAuditoria(venda, contexto) {
  const resolvido = mpfc.resolverPoliticaOperacionalDaVenda(venda, contexto);
  return {
    mpfc_snapshot_presente: resolvido.snapshotPresente,
    mpfc_fonte: resolvido.fonte,
    mpfc_politica: resolvido.payload
  };
}

function cancelarRecebimentosVenda(vendaId, callback) {
  db.run(`
    UPDATE venda_recebimentos
    SET status = 'cancelado'
    WHERE venda_id = ?
      AND LOWER(COALESCE(tipo_recebimento, '')) IN ('fiscal', 'a')
      AND COALESCE(status, 'aprovado') != 'cancelado'
  `, [vendaId], (errA) => {
    if (errA) return callback(errA);

    db.run(`
      UPDATE venda_recebimentos
      SET status = 'cancelado'
      WHERE venda_id = ?
        AND LOWER(COALESCE(tipo_recebimento, '')) IN ('nao_fiscal', 'b')
        AND COALESCE(status, 'aprovado') != 'cancelado'
    `, [vendaId], callback);
  });
}

function cancelarVendaPut(id, motivo, req, res) {
db.get('SELECT * FROM vendas WHERE id = ?', [id], (err, venda) => {
  if (err) {
    res.status(500).json({ error: err.message });
    return;
  }
  if (!venda) {
    res.status(404).json({ error: 'Venda não encontrada.' });
    return;
  }
  if (venda.status !== 'concluida') {
    res.status(400).json({ error: 'Apenas vendas concluídas podem ser canceladas.' });
    return;
  }

      gravarAuditoria({
        usuario_id: req.operadorId || req.user?.id || null,
        usuario_nome: req.user?.username || req.user?.nome || null,
        modulo: 'vendas',
        acao: 'cancelar_venda',
        referencia_tipo: 'venda',
        referencia_id: id,
        detalhes: {
          motivo_cancelamento: req.body.motivo || null,
          ip: req.ip,
          sessao_id: req.caixaSessaoId || null,
          ...anexarPoliticaSnapshotAuditoria(venda, 'cancelamento')
        },
        ip_requisicao: req.ip || null
      }).catch((auditErr) => console.error('Erro ao gravar auditoria de cancelamento de venda:', auditErr));

  const executarCancelamentoVenda = () => {
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE');

    db.all('SELECT * FROM vendas_itens WHERE venda_id = ?', [id], (itErr, itens) => {
      if (itErr) {
        db.run('ROLLBACK');
        res.status(500).json({ error: itErr.message });
        return;
      }

      const finalizarCancelamento = () => {
        cancelarRecebimentosVenda(id, (recErr) => {
          if (recErr) {
            db.run('ROLLBACK');
            res.status(500).json({ error: recErr.message });
            return;
          }

        db.run(`
          UPDATE vendas
          SET status = 'cancelada',
              cancelada = 1,
              data_cancelamento = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [id], (upErr) => {
          if (upErr) {
            db.run('ROLLBACK');
            res.status(500).json({ error: upErr.message });
            return;
          }

          cancelarFinanceiroVenda(id, { gerenciarTransacao: false })
            .then(() => {
              db.run(`
                INSERT INTO financeiro (
                  tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
                  referencia_id, referencia_tipo, status, origem, documento, vencimento,
                  venda_id, baixado_em
                ) VALUES ('despesa', ?, ?, ?, 'estorno_venda', 'estorno', ?, 'estorno_venda', 'pago', 'cancelamento_venda', ?, ?, ?, ?)
              `, [
                `Estorno cancelamento ${venda.codigo}`,
                venda.total,
                venda.data_venda,
                id,
                venda.codigo,
                venda.data_venda,
                id,
                venda.data_venda
              ], (finErr) => {
                if (finErr) {
                  db.run('ROLLBACK');
                  res.status(500).json({ error: finErr.message });
                  return;
                }

                if (venda.forma_pagamento === 'credito' && venda.cliente_id) {
                  db.run(`
                    UPDATE clientes
                    SET credito_atual = CASE
                      WHEN (credito_atual - ?) < 0 THEN 0
                      ELSE credito_atual - ?
                    END
                    WHERE id = ?
                  `, [venda.total, venda.total, venda.cliente_id], (credErr) => {
                    if (credErr) {
                      db.run('ROLLBACK');
                      res.status(500).json({ error: credErr.message });
                      return;
                    }
                    db.run('COMMIT');
                    res.json({ message: 'Venda cancelada com sucesso' });
                  });
                } else {
                  db.run('COMMIT');
                  res.json({ message: 'Venda cancelada com sucesso' });
                }
              });
            })
            .catch((finCancelErr) => {
              db.run('ROLLBACK');
              res.status(500).json({ error: finCancelErr.message });
            });
        });
        });
      };

      devolverEstoqueItensVenda(itens, (estErr) => {
        if (estErr) {
          db.run('ROLLBACK');
          res.status(500).json({ error: estErr.message });
          return;
        }
        finalizarCancelamento();
      });
    });
  });
  };

  comAvaliacaoCancelamento(id, res, 'put', (avaliacao) => {
    if (!avaliacao.cancelar_nfce) {
      return executarCancelamentoVenda();
    }

    const validacaoNfce = validarMotivoTexto(motivo);
    if (!validacaoNfce.valido) {
      return res.status(400).json({
        error: `${validacaoNfce.erro} (obrigatório para cancelar NFC-e autorizada)`
      });
    }

    cancelarNfceAutorizadaVenda(id, motivo)
      .then(() => executarCancelamentoVenda())
      .catch((cancelErr) => res.status(400).json({ error: cancelErr.message, sefaz: cancelErr.sefaz || null }));
  });
});
}

function cancelarVendaPost(vendaId, motivo, req, res) {
db.get(
  'SELECT * FROM vendas WHERE id = ?',
  [vendaId],
  (err, venda) => {
    if (err || !venda) {
      return res.status(404).json({
        sucesso: false,
        mensagem: 'Venda não encontrada.'
      });
    }

    if (venda.cancelada === 1) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Venda já cancelada.'
      });
    }

    const prosseguirCancelamento = (avaliacao) => {
        const executarCancelamentoLocal = () => {
          db.serialize(() => {
            db.run('BEGIN IMMEDIATE');

            db.all(
              'SELECT * FROM vendas_itens WHERE venda_id = ?',
              [vendaId],
              (errItens, itens) => {
                if (errItens) {
                  db.run('ROLLBACK');
                  return res.status(500).json({
                    sucesso: false,
                    mensagem: 'Erro ao buscar itens.'
                  });
                }

                devolverEstoqueItensVenda(itens, (estErr) => {
                  if (estErr) {
                    db.run('ROLLBACK');
                    return res.status(500).json({
                      sucesso: false,
                      mensagem: estErr.message
                    });
                  }

                  cancelarRecebimentosVenda(vendaId, (recErr) => {
                    if (recErr) {
                      db.run('ROLLBACK');
                      return res.status(500).json({
                        sucesso: false,
                        mensagem: recErr.message
                      });
                    }

                    db.run(
                      `
                      UPDATE vendas
                      SET
                        cancelada = 1,
                        status = 'cancelada',
                        data_cancelamento = CURRENT_TIMESTAMP
                      WHERE id = ?
                      `,
                      [vendaId],
                      function (errUpdate) {
                        if (errUpdate) {
                          db.run('ROLLBACK');
                          return res.status(500).json({
                            sucesso: false,
                            mensagem: errUpdate.message
                          });
                        }

                        db.run(
                          `
                          INSERT INTO vendas_canceladas (
                            venda_id,
                            motivo,
                            usuario_id
                          ) VALUES (?, ?, ?)
                          `,
                          [
                            vendaId,
                            motivo || 'Não informado',
                            req.operadorId || req.user?.id || null
                          ]
                        );

                        cancelarFinanceiroVenda(vendaId, { gerenciarTransacao: false })
                          .then(() => {
                            db.run('COMMIT');
                            gravarAuditoria({
                              usuario_id: req.operadorId || req.user?.id || null,
                              usuario_nome: req.user?.username || req.user?.nome || null,
                              modulo: 'vendas',
                              acao: 'cancelar_venda',
                              referencia_tipo: 'venda',
                              referencia_id: vendaId,
                              detalhes: {
                                motivo: motivo || null,
                                ip: req.ip || null,
                                sessao_id: req.caixaSessaoId || null,
                                ...anexarPoliticaSnapshotAuditoria(venda, 'cancelamento')
                              },
                              ip_requisicao: req.ip || null
                            }).catch((auditErr) => console.error('Erro ao gravar auditoria de cancelamento de venda:', auditErr));
                            res.json({
                              sucesso: true,
                              mensagem: avaliacao.cancelar_nfce
                                ? 'NFC-e cancelada na SEFAZ e venda cancelada com sucesso.'
                                : 'Venda cancelada com sucesso.',
                              nfce_cancelada: avaliacao.cancelar_nfce === true,
                              sefaz: avaliacao.retornoCancelamento || null
                            });
                          })
                          .catch((finCancelErr) => {
                            db.run('ROLLBACK');
                            return res.status(500).json({
                              sucesso: false,
                              mensagem: finCancelErr.message
                            });
                          });
                      }
                    );
                  });
                });
              }
            );
          });
        };

        if (!avaliacao.cancelar_nfce) {
          return executarCancelamentoLocal();
        }

        const justificativa = motivo || '';
        cancelarNfceAutorizadaVenda(vendaId, justificativa)
          .then((retorno) => {
            avaliacao.retornoCancelamento = retorno || null;
            executarCancelamentoLocal();
          })
          .catch((cancelErr) => res.status(400).json({
            sucesso: false,
            mensagem: cancelErr.message,
            sefaz: cancelErr.sefaz || null
          }));
    };

    const iniciarCancelamento = (avaliacao) => {
    if (avaliacao.cancelar_nfce) {
      const validacaoNfceLocal = validarMotivoTexto(motivo || '');
      if (!validacaoNfceLocal.valido) {
        return res.status(400).json({
          sucesso: false,
          mensagem: `${validacaoNfceLocal.erro} (obrigatório para cancelar NFC-e autorizada)`
        });
      }
    }

    if (
      venda.status_pagamento === 'fiscal_pago' ||
      venda.status_pagamento === 'aguardando_nao_fiscal'
    ) {
      const estornarFiscal = venda.tef_transacao_id
        ? cancelarFiscal(venda.tef_transacao_id, motivo || 'Cancelamento de venda')
        : Promise.resolve();

      estornarFiscal
        .then(() => prosseguirCancelamento(avaliacao))
        .catch((tefErr) => {
          console.error('Erro ao estornar TEF do Recebimento A:', tefErr);
          return res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao estornar o Recebimento A.'
          });
        });
      return;
    }

    prosseguirCancelamento(avaliacao);
    };

    comAvaliacaoCancelamento(vendaId, res, 'post', iniciarCancelamento);
  }
);
}

module.exports = {
  cancelarRecebimentosVenda,
  cancelarVendaPut,
  cancelarVendaPost,
  anexarPoliticaSnapshotAuditoria
};
