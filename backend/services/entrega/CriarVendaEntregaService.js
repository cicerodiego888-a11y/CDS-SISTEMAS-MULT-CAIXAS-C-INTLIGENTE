/**
 * Criação de Venda para Entrega (Sprint 2)
 * - tipo_venda = ENTREGA
 * - status_entrega = AGUARDANDO_ENTREGA
 * - Reserva estoque (sem baixa definitiva)
 * - Sem financeiro, sem caixa, sem NFC-e
 */

'use strict';

const db = require('../../database');
const configService = require('../configuracaoService');
const { parseVendaFiscalFlag, distribuirItensVendaComValorFiscalEfetivo } = require('../distribuidorEstoqueVenda');
const {
  prepararEntradasMotorComTransferenciaPdv,
  aplicarTransferenciasPdv
} = require('../estoque/transferenciaNaoFiscalParaFiscalPdv');
const cfgTransferenciaPdv = require('../estoque/pdvTransferenciaNaoFiscalFiscalConfig');
const mpfc = require('../mpfc');
const { calcularEstoqueProduto } = require('../estoque/EstoqueDisponivelService');
const { saldosParaDistribuicaoVenda } = require('../estoque/produtoControlaEstoque');
const { reservarItem } = require('../estoque/EstoqueReservaService');
const { TipoVenda, StatusEntrega, StatusVenda, PagamentoPrevisto } = require('./enums');
const {
  EntregaAuditoriaEventos,
  montarPayloadAuditoriaEntrega
} = require('./EntregaAuditoria');
const { gravarAuditoria, contextoAuditoriaRequisicao } = require('../auditoria');
const { normalizarTipoVendaItem } = require('../vendaUnidadeHelpers');
const VendaFinanceiroService = require('../vendas/VendaFinanceiroService');
const { obterCaixaTurnoId } = require('../../utils/caixaSessaoHelpers');

const { agoraLocalBrasil } = VendaFinanceiroService;

function montarHtmlComprovanteEntrega(venda, itens, empresa = {}) {
  const fmt = (n) => Number(n || 0).toFixed(2).replace('.', ',');
  const agora = agoraLocalBrasil();
  const [data, hora] = agora.includes('T')
    ? [agora.slice(0, 10), agora.slice(11, 19)]
    : [agora.slice(0, 10), agora.slice(11, 19) || ''];

  const linhasItens = (itens || []).map((item) => `
    <tr>
      <td>${String(item.nome || item.produto_nome || item.produto_id || '')}</td>
      <td style="text-align:right">${fmt(item.quantidade)}</td>
      <td style="text-align:right">${fmt(item.preco_unitario)}</td>
      <td style="text-align:right">${fmt(item.subtotal)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Comprovante de Entrega</title>
<style>
  body{font-family:monospace;font-size:12px;width:280px;margin:0 auto;padding:8px;}
  h1{font-size:14px;text-align:center;margin:0 0 8px;}
  .muted{color:#444;font-size:11px;text-align:center;}
  table{width:100%;border-collapse:collapse;margin:8px 0;}
  td{padding:2px 0;vertical-align:top;}
  .total{font-weight:bold;border-top:1px dashed #000;padding-top:6px;margin-top:6px;}
  .aviso{margin-top:10px;text-align:center;font-size:10px;border-top:1px dashed #000;padding-top:8px;}
</style></head><body>
  <h1>COMPROVANTE DE ENTREGA</h1>
  <div class="muted">${empresa.nome || empresa.nome_empresa || 'CDS Sistemas'}</div>
  <div class="muted">${empresa.cnpj ? `CNPJ ${empresa.cnpj}` : ''}</div>
  <hr>
  <div><strong>Pedido:</strong> ${venda.id || '—'}</div>
  <div><strong>Cliente:</strong> ${venda.cliente_nome || 'Consumidor'}</div>
  <div><strong>Telefone:</strong> ${venda.telefone_entrega || '—'}</div>
  <div><strong>Data:</strong> ${data}</div>
  <div><strong>Hora:</strong> ${hora}</div>
  <table>
    <thead><tr><td>Item</td><td style="text-align:right">Qtd</td><td style="text-align:right">Vlr</td><td style="text-align:right">Sub</td></tr></thead>
    <tbody>${linhasItens}</tbody>
  </table>
  <div class="total">Total: R$ ${fmt(venda.total)}</div>
  ${Number(venda.taxa_entrega || 0) > 0 ? `<div>Taxa entrega: R$ ${fmt(venda.taxa_entrega)}</div>` : ''}
  <div><strong>Pagamento previsto:</strong> ${venda.pagamento_previsto || 'NAO_INFORMADO'}</div>
  <div><strong>Entregador:</strong> ${venda.entregador || '—'}</div>
  <div><strong>Endereço:</strong> ${venda.endereco_entrega || '—'}</div>
  <div><strong>Referência:</strong> ${venda.referencia_entrega || '—'}</div>
  <div><strong>Observações:</strong> ${venda.observacao_entrega || '—'}</div>
  <div class="aviso">
    <div>ESTE DOCUMENTO NÃO POSSUI VALOR FISCAL</div>
    <div>Venda sujeita à confirmação na prestação de contas.</div>
  </div>
</body></html>`;
}

function criarVendaEntrega(req, res) {
  if (!configService.recursoHabilitado('vendasEntrega')) {
    return res.status(404).json({
      error: 'Módulo Vendas para Entrega desabilitado.',
      codigo: 'MODULO_VENDAS_ENTREGA_DESABILITADO'
    });
  }

  const body = req.body || {};
  const itens = Array.isArray(body.itens) ? body.itens : [];
  const totalNum = Number(body.total);

  if (!itens.length) {
    return res.status(400).json({ error: 'Informe ao menos um item na venda.' });
  }
  if (!Number.isFinite(totalNum) || totalNum <= 0) {
    return res.status(400).json({ error: 'Total inválido.' });
  }

  const vendaFiscal = parseVendaFiscalFlag(body.emitir_fiscal);
  const pagamentoPrevisto = String(body.pagamento_previsto || PagamentoPrevisto.NAO_INFORMADO).toUpperCase();
  const taxaEntrega = Number(body.taxa_entrega || 0) || 0;
  const levaMaquineta = body.leva_maquineta === true || body.leva_maquineta === 1 || body.leva_maquineta === '1' ? 1 : 0;
  const levaTroco = body.leva_troco === true || body.leva_troco === 1 || body.leva_troco === '1' ? 1 : 0;
  const trocoPara = Number(body.troco_para || 0) || 0;

  const enderecoParts = [
    body.endereco_entrega,
    body.numero_entrega,
    body.complemento_entrega,
    body.bairro_entrega,
    body.cidade_entrega,
    body.uf_entrega
  ].filter((p) => String(p || '').trim());

  const enderecoEntrega = String(body.endereco_entrega_completo || enderecoParts.join(', ') || '').trim();

  const produtoIds = Array.from(new Set(itens.map((i) => i.produto_id).filter((id) => id != null)));
  if (itens.some((i) => i.produto_id == null)) {
    return res.status(400).json({ error: 'Um ou mais itens não possuem produto vinculado.' });
  }

  const caixaSessaoId = req.caixaSessao?.id || null;
  // vendas.caixa_id → caixa(id) [turno], NÃO caixas(id) [cadastro admin]
  const caixaId =
    req.caixaId ||
    obterCaixaTurnoId(req.caixaSessao) ||
    req.caixaAtual?.id ||
    null;
  const terminalId = req.terminalId || req.terminal?.id || null;
  const operadorId = req.user?.id || req.operadorId || null;

  db.all(
    `
      SELECT
        id, nome, estoque_atual,
        COALESCE(saldo_fiscal, 0) AS saldo_fiscal,
        COALESCE(saldo_nao_fiscal, 0) AS saldo_nao_fiscal,
        COALESCE(reservado_fiscal, 0) AS reservado_fiscal,
        COALESCE(reservado_nao_fiscal, 0) AS reservado_nao_fiscal,
        COALESCE(controla_estoque, 1) AS controla_estoque
      FROM produtos
      WHERE id IN (${produtoIds.map(() => '?').join(',')})
    `,
    produtoIds,
    (errProd, produtos) => {
      if (errProd) {
        return res.status(500).json({ error: errProd.message });
      }

      const produtoMap = (produtos || []).reduce((map, p) => {
        map[p.id] = p;
        return map;
      }, {});

      const entradasMotor = [];

      for (const item of itens) {
        const produto = produtoMap[item.produto_id];
        if (!produto) {
          return res.status(400).json({ error: `Produto ID ${item.produto_id} não encontrado` });
        }

        const calc = calcularEstoqueProduto(produto);
        const qtdEstoque = item.quantidade_estoque != null && item.quantidade_estoque !== ''
          ? Number(item.quantidade_estoque)
          : Number(item.quantidade || 0);
        const saldos = saldosParaDistribuicaoVenda(
          produto,
          qtdEstoque,
          calc.disponivel_fiscal,
          calc.disponivel_nao_fiscal
        );
        entradasMotor.push({
          item,
          saldoFiscal: saldos.saldoFiscal,
          saldoNaoFiscal: saldos.saldoNaoFiscal,
          controlaEstoque: Number(produto.controla_estoque) !== 0,
          produto
        });
      }

      const preparadoTransferenciaPdv = prepararEntradasMotorComTransferenciaPdv(entradasMotor, {
        permitido: cfgTransferenciaPdv.estaAtivadaSync()
      });
      if (preparadoTransferenciaPdv.sucesso === false) {
        return res.status(400).json({
          error: preparadoTransferenciaPdv.erro || 'Falha ao validar transferência de estoque.'
        });
      }
      const aplicacoesTransferenciaPdv = preparadoTransferenciaPdv.aplicacoes || [];

      const politicaMpfc = mpfc.obterPolitica();
      const midpAtivo = Boolean(politicaMpfc.preservarDinheiro);
      mpfc.receberPoliticaMotorComercial(politicaMpfc);
      mpfc.receberPoliticaMotorFiscalNaoFiscal(politicaMpfc);
      const pagamentosEntrega = Array.isArray(body.pagamentos) ? body.pagamentos : [];
      const resultadoMotor = distribuirItensVendaComValorFiscalEfetivo(
        preparadoTransferenciaPdv.entradas,
        vendaFiscal,
        {
          pagamentos: pagamentosEntrega,
          midpAtivo,
          desconto: Number(body.desconto || 0),
          acrescimo: Number(body.acrescimo || 0),
          politicaFiscalComercial: politicaMpfc
        }
      );

      if (!resultadoMotor.sucesso) {
        const produtoErro = resultadoMotor.item
          ? produtoMap[resultadoMotor.item.produto_id]
          : null;
        return res.status(400).json({
          error:
            `Estoque disponível insuficiente para ${produtoErro?.nome || 'produto'}. ` +
            `Disponível: ${resultadoMotor.erro?.estoqueTotal}`
        });
      }

      const distribuicaoItens = resultadoMotor.itens.map((row) => ({
        ...row,
        nome: produtoMap[row.produto_id]?.nome || row.nome,
        quantidade_fiscal: row.quantidade_fiscal,
        quantidade_nao_fiscal: row.quantidade_nao_fiscal,
        valor_fiscal: row.valor_fiscal,
        valor_nao_fiscal: row.valor_nao_fiscal
      }));

      const dataVenda = agoraLocalBrasil().slice(0, 10);
      const valorFiscal = resultadoMotor.valorFiscalEfetivo;
      const valorNaoFiscal = resultadoMotor.valorNaoFiscal;
      const desconto = Number(body.desconto || 0) || 0;
      const codigo = `ENT-${Date.now()}`;

      const buscarCliente = (cb) => {
        if (!body.cliente_id) return cb(null, null);
        db.get('SELECT id, nome, telefone FROM clientes WHERE id = ?', [body.cliente_id], cb);
      };

      buscarCliente((errCli, cliente) => {
        if (errCli) {
          return res.status(500).json({ error: errCli.message });
        }

        db.serialize(() => {
          db.run('BEGIN IMMEDIATE', (beginErr) => {
          if (beginErr) {
            return res.status(500).json({ error: beginErr.message });
          }
          const seguirInsert = () => {
          db.run(
            `
              INSERT INTO vendas (
                codigo, data_venda, cliente_id, total, desconto,
                forma_pagamento, status, valor_recebido,
                caixa_id, terminal_id, operador_id, caixa_sessao_id,
                status_pagamento, valor_fiscal, valor_nao_fiscal,
                tipo_venda, status_venda, status_entrega, pagamento_previsto,
                entregador, endereco_entrega, referencia_entrega, observacao_entrega,
                taxa_entrega, leva_maquineta, troco_para,
                prestacao_realizada, telefone_entrega
              ) VALUES (
                ?, ?, ?, ?, ?,
                ?, 'reserva_entrega', 0,
                ?, ?, ?, ?,
                'pendente', ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                0, ?
              )
            `,
            [
              codigo,
              dataVenda,
              body.cliente_id || null,
              totalNum,
              desconto,
              String(pagamentoPrevisto).toLowerCase(),
              caixaId,
              terminalId,
              operadorId,
              caixaSessaoId,
              valorFiscal,
              valorNaoFiscal,
              TipoVenda.ENTREGA,
              StatusVenda.ABERTA,
              StatusEntrega.AGUARDANDO_ENTREGA,
              pagamentoPrevisto,
              String(body.entregador || '').trim() || null,
              enderecoEntrega || null,
              String(body.referencia_entrega || '').trim() || null,
              String(body.observacao_entrega || '').trim() || null,
              taxaEntrega,
              levaMaquineta,
              levaTroco ? trocoPara : 0,
              String(body.telefone_entrega || cliente?.telefone || '').trim() || null
            ],
            function onInsertVenda(errIns) {
              if (errIns) {
                db.run('ROLLBACK');
                const fk = /FOREIGN KEY/i.test(String(errIns.message || ''));
                return res.status(500).json({
                  error: fk
                    ? `Integridade do banco ao criar venda de entrega (FOREIGN KEY). Refs: caixa_id=${caixaId}, caixa_sessao_id=${caixaSessaoId}, terminal_id=${terminalId}, operador_id=${operadorId}. Use o turno (caixa), não o cadastro (caixas).`
                    : errIns.message,
                  codigo: fk ? 'FK_CONSTRAINT' : undefined,
                  etapa: 'insert_vendas_entrega'
                });
              }

              const vendaId = this.lastID;
              let idx = 0;

              const inserirProximoItem = () => {
                if (idx >= distribuicaoItens.length) {
                  return finalizarOk(vendaId, cliente);
                }

                const item = distribuicaoItens[idx++];
                const tipoItem = normalizarTipoVendaItem(item.tipo_venda || item.tipoVenda || 'UNIDADE');
                const qtd = Number(item.quantidade || 0);
                const preco = Number(item.preco_unitario || 0);
                const subtotal = Number(item.subtotal != null ? item.subtotal : qtd * preco);

                db.run(
                  `
                    INSERT INTO vendas_itens (
                      venda_id, produto_id, quantidade, preco_unitario,
                      desconto_percentual, subtotal,
                      item_fiscal, quantidade_fiscal, quantidade_nao_fiscal,
                      valor_fiscal, valor_nao_fiscal, tipo_venda
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `,
                  [
                    vendaId,
                    item.produto_id,
                    qtd,
                    preco,
                    Number(item.desconto_percentual || 0) || 0,
                    subtotal,
                    Number(item.quantidade_fiscal || 0) > 0 ? 1 : 0,
                    Number(item.quantidade_fiscal || 0),
                    Number(item.quantidade_nao_fiscal || 0),
                    Number(item.valor_fiscal || 0),
                    Number(item.valor_nao_fiscal || 0),
                    tipoItem
                  ],
                  function onItem(errItem) {
                    if (errItem) {
                      db.run('ROLLBACK');
                      return res.status(500).json({ error: errItem.message });
                    }

                    reservarItem(
                      {
                        vendaId,
                        vendaItemId: this.lastID,
                        produtoId: item.produto_id,
                        quantidadeFiscal: item.quantidade_fiscal,
                        quantidadeNaoFiscal: item.quantidade_nao_fiscal
                      },
                      (errRes) => {
                        if (errRes) {
                          db.run('ROLLBACK');
                          return res.status(500).json({ error: errRes.message });
                        }
                        inserirProximoItem();
                      }
                    );
                  }
                );
              };

              const finalizarOk = (vendaIdFinal, clienteRow) => {
                db.run('COMMIT', (errCommit) => {
                  if (errCommit) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: errCommit.message });
                  }

                  const ctx = contextoAuditoriaRequisicao(req);
                  const payloadAudit = montarPayloadAuditoriaEntrega({
                    acao: EntregaAuditoriaEventos.VENDA_MARCADA_PARA_ENTREGA,
                    vendaId: vendaIdFinal,
                    detalhes: {
                      status_entrega: StatusEntrega.AGUARDANDO_ENTREGA,
                      total: totalNum,
                      pagamento_previsto: pagamentoPrevisto
                    },
                    ...ctx
                  });
                  gravarAuditoria(payloadAudit).catch((e) => console.error(e));

                  gravarAuditoria(
                    montarPayloadAuditoriaEntrega({
                      acao: EntregaAuditoriaEventos.RESERVA_CRIADA,
                      vendaId: vendaIdFinal,
                      detalhes: { itens: distribuicaoItens.length },
                      ...ctx
                    })
                  ).catch((e) => console.error(e));

                  const vendaResp = {
                    id: vendaIdFinal,
                    codigo,
                    total: totalNum,
                    taxa_entrega: taxaEntrega,
                    pagamento_previsto: pagamentoPrevisto,
                    entregador: String(body.entregador || '').trim() || null,
                    endereco_entrega: enderecoEntrega,
                    referencia_entrega: String(body.referencia_entrega || '').trim() || null,
                    observacao_entrega: String(body.observacao_entrega || '').trim() || null,
                    telefone_entrega: String(body.telefone_entrega || clienteRow?.telefone || '').trim() || null,
                    cliente_nome: clienteRow?.nome || body.cliente_nome || 'Consumidor',
                    tipo_venda: TipoVenda.ENTREGA,
                    status_venda: StatusVenda.ABERTA,
                    status_entrega: StatusEntrega.AGUARDANDO_ENTREGA,
                    status: 'reserva_entrega',
                    prestacao_realizada: 0
                  };

                  const html = montarHtmlComprovanteEntrega(
                    vendaResp,
                    distribuicaoItens,
                    {
                      nome: body.empresa_nome,
                      cnpj: body.empresa_cnpj
                    }
                  );

                  gravarAuditoria(
                    montarPayloadAuditoriaEntrega({
                      acao: EntregaAuditoriaEventos.COMPROVANTE_IMPRESSO,
                      vendaId: vendaIdFinal,
                      detalhes: { tipo: 'comprovante_entrega' },
                      ...ctx
                    })
                  ).catch((e) => console.error(e));

                  return res.status(201).json({
                    success: true,
                    message: 'Venda para entrega criada com reserva de estoque.',
                    venda: vendaResp,
                    itens: distribuicaoItens,
                    comprovante_html: html,
                    fiscal: null,
                    financeiro_gerado: false,
                    estoque_baixado: false,
                    estoque_reservado: true
                  });
                });
              };

              inserirProximoItem();
            }
          );
          };
          if (!aplicacoesTransferenciaPdv.length) {
            return seguirInsert();
          }
          aplicarTransferenciasPdv(aplicacoesTransferenciaPdv, {
            db,
            usuarioId: operadorId,
            jaEmTransacao: true
          }).then(() => seguirInsert()).catch((trErr) => {
            db.run('ROLLBACK', () => {
              res.status(400).json({
                error: trErr.message || 'Falha ao transferir estoque.'
              });
            });
          });
          });
        });
      });
    }
  );
}

module.exports = {
  criarVendaEntrega,
  montarHtmlComprovanteEntrega
};
