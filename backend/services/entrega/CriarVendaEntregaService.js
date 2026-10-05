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
const cfgVendaSemEstoque = require('../estoque/empresaPermiteVendaSemEstoqueConfig');
const { deveBloquearExcedentePorCategoria } = require('../estoque/vendaSemEstoqueElegibilidade');
const mpfc = require('../mpfc');
const { saldosDisponiveisMotorFxNf } = require('../estoque/EstoqueDisponivelService');
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
const {
  montarSnapshotEntrega,
  resolverDadosClienteEntrega
} = require('./EntregaClienteSnapshot');
const {
  colunas,
  centro,
  blocoCentro,
  comporLinha,
  linhaSe,
  quebrar,
  documento
} = require('./comprovanteTermicoLayout');

const { agoraLocalBrasil } = VendaFinanceiroService;

function dataHoraComprovanteEntrega(venda) {
  const bruto = String(venda?.data_venda || venda?.created_at || '').trim().replace('T', ' ');
  if (bruto.length >= 16) {
    return [bruto.slice(0, 10), bruto.slice(11, 19)];
  }
  const agora = agoraLocalBrasil();
  return [agora.slice(0, 10), agora.slice(11, 19) || ''];
}

function montarHtmlComprovanteEntrega(venda, itens, empresa = {}) {
  const fmt = (n) => Number(n || 0).toFixed(2).replace('.', ',');
  const [data, hora] = dataHoraComprovanteEntrega(venda);
  const snap = resolverDadosClienteEntrega(venda);
  const cepFmt = snap.cep && String(snap.cep).length === 8
    ? `${String(snap.cep).slice(0, 5)}-${String(snap.cep).slice(5)}`
    : (snap.cep || '');
  const temEnderecoEstruturado = !!(snap.numero || snap.complemento || snap.bairro || snap.cidade || snap.uf || snap.cep);

  const subtotalItens = (itens || []).reduce((acc, item) => acc + Number(item.subtotal || 0), 0);
  const taxa = Number(venda.taxa_entrega || 0);
  const papelMm = Number(empresa.papel_mm) === 58 ? 58 : 80;
  const cols = colunas(papelMm);
  const sep = '-'.repeat(cols);
  const L = (label, valor) => comporLinha(label, valor, cols);

  const endereco = temEnderecoEstruturado
    ? [
      ...linhaSe('CEP', cepFmt, cols),
      ...linhaSe('Endereço', snap.endereco, cols),
      ...linhaSe('Número', snap.numero, cols),
      ...linhaSe('Complemento', snap.complemento, cols),
      ...linhaSe('Bairro', snap.bairro, cols),
      ...linhaSe('Cidade', snap.cidade, cols),
      ...linhaSe('UF', snap.uf, cols),
      ...linhaSe('Referência', snap.referencia, cols)
    ]
    : [
      ...L('Endereço:', snap.endereco_linha || '—'),
      ...linhaSe('Referência', snap.referencia, cols)
    ];

  const itensLinhas = (itens || []).flatMap((item) => {
    const nome = String(item.nome || item.produto_nome || item.produto_id || '');
    const valores = `${fmt(item.quantidade)} x ${fmt(item.preco_unitario)} = ${fmt(item.subtotal)}`;
    return [...(nome ? quebrar(nome, cols) : []), ...L('', valores)];
  });

  const linhas = [
    ...blocoCentro('COMPROVANTE DE ENTREGA', cols),
    ...(venda && venda.reimpressao ? blocoCentro('*** REIMPRESSÃO ***', cols) : []),
    ...blocoCentro(empresa.nome || empresa.nome_empresa || 'CDS Sistemas', cols),
    ...(empresa.cnpj ? blocoCentro(`CNPJ ${empresa.cnpj}`, cols) : []),
    sep,
    centro('DADOS DO CLIENTE/CONSUMIDOR', cols),
    ...L('Nome:', snap.nome || '—'),
    ...linhaSe('CPF/CNPJ', snap.cpf_cnpj, cols),
    ...linhaSe('Telefone', snap.telefone, cols),
    ...linhaSe('E-mail', snap.email, cols),
    '',
    centro('ENDEREÇO DA ENTREGA', cols),
    ...endereco,
    '',
    centro('DADOS DA ENTREGA', cols),
    ...L('Pedido:', String(venda.id || '—')),
    ...L('Data:', data),
    ...L('Hora:', hora),
    ...L('Entregador:', venda.entregador || '—'),
    ...L('Taxa de entrega:', `R$ ${fmt(taxa)}`),
    ...L('Pagamento previsto:', venda.pagamento_previsto || 'NAO_INFORMADO'),
    ...L('Levar maquineta:', Number(venda.leva_maquineta || 0) === 1 ? 'SIM' : 'NÃO'),
    ...(Number(venda.troco_para || 0) > 0 ? L('Troco para:', `R$ ${fmt(venda.troco_para)}`) : []),
    ...L('Observações:', venda.observacao_entrega || '—'),
    '',
    centro('ITENS', cols),
    ...itensLinhas,
    sep,
    ...L('Subtotal:', `R$ ${fmt(subtotalItens)}`),
    ...(taxa > 0 ? L('Taxa:', `R$ ${fmt(taxa)}`) : []),
    ...L('Total:', `R$ ${fmt(venda.total)}`),
    sep,
    ...blocoCentro('ESTE DOCUMENTO NÃO POSSUI VALOR FISCAL', cols),
    ...blocoCentro('Venda sujeita à confirmação', cols),
    ...blocoCentro('na prestação de contas.', cols)
  ];

  return documento({
    titulo: 'Comprovante de Entrega',
    classe: `comprovante-entrega-${papelMm}`,
    linhas,
    papelMm
  });
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

  const enderecoEntregaLegado = String(body.endereco_entrega_completo || enderecoParts.join(', ') || '').trim();

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
        produtos.id, produtos.nome, produtos.estoque_atual,
        COALESCE(produtos.saldo_fiscal, 0) AS saldo_fiscal,
        COALESCE(produtos.saldo_nao_fiscal, 0) AS saldo_nao_fiscal,
        COALESCE(produtos.reservado_fiscal, 0) AS reservado_fiscal,
        COALESCE(produtos.reservado_nao_fiscal, 0) AS reservado_nao_fiscal,
        COALESCE(produtos.controla_estoque, 1) AS controla_estoque,
        COALESCE(produtos.item_fiscal, 0) AS item_fiscal,
        categorias.nome AS categoria_nome
      FROM produtos
      LEFT JOIN categorias ON categorias.id = produtos.categoria_id
      WHERE produtos.id IN (${produtoIds.map(() => '?').join(',')})
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

        const calc = saldosDisponiveisMotorFxNf(produto).estoque;
        const qtdEstoque = item.quantidade_estoque != null && item.quantidade_estoque !== ''
          ? Number(item.quantidade_estoque)
          : Number(item.quantidade || 0);
        const saldos = saldosParaDistribuicaoVenda(
          produto,
          qtdEstoque,
          calc.disponivel_fiscal,
          calc.disponivel_nao_fiscal
        );
        if (deveBloquearExcedentePorCategoria(
          produto,
          qtdEstoque,
          saldos.saldoFiscal + saldos.saldoNaoFiscal,
          cfgVendaSemEstoque.estaAtivadaSync()
        )) {
          return res.status(400).json({
            error: `Estoque disponível insuficiente para ${produto.nome}. Disponível: ${saldos.saldoFiscal + saldos.saldoNaoFiscal}`
          });
        }
        entradasMotor.push({
          item,
          saldoFiscal: saldos.saldoFiscal,
          saldoNaoFiscal: saldos.saldoNaoFiscal,
          controlaEstoque: Number(produto.controla_estoque) !== 0,
          itemFiscal: Number(produto.item_fiscal || 0),
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
          politicaFiscalComercial: politicaMpfc,
          permitirVendaSemEstoque: cfgVendaSemEstoque.estaAtivadaSync()
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
        db.get(
          `SELECT id, nome, cpf_cnpj, telefone, email, cep, rua, numero, bairro, cidade, uf, endereco
           FROM clientes WHERE id = ?`,
          [body.cliente_id],
          cb
        );
      };

      buscarCliente((errCli, cliente) => {
        if (errCli) {
          return res.status(500).json({ error: errCli.message });
        }

        const snapshot = montarSnapshotEntrega(body, cliente);
        // Compat: se veio só string concatenada antiga, preserva em endereco_entrega
        const enderecoPersistido = snapshot.endereco_entrega
          || enderecoEntregaLegado
          || null;

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
                prestacao_realizada, telefone_entrega,
                nome_cliente_entrega, cpf_cnpj_cliente_entrega, email_cliente_entrega,
                cep_entrega, numero_entrega, complemento_entrega,
                bairro_entrega, cidade_entrega, uf_entrega
              ) VALUES (
                ?, ?, ?, ?, ?,
                ?, 'reserva_entrega', 0,
                ?, ?, ?, ?,
                'pendente', ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                0, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?
              )
            `,
            [
              codigo,
              dataVenda,
              snapshot.cliente_id,
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
              enderecoPersistido,
              snapshot.referencia_entrega,
              String(body.observacao_entrega || '').trim() || null,
              taxaEntrega,
              levaMaquineta,
              levaTroco ? trocoPara : 0,
              snapshot.telefone_entrega,
              snapshot.nome_cliente_entrega,
              snapshot.cpf_cnpj_cliente_entrega,
              snapshot.email_cliente_entrega,
              snapshot.cep_entrega,
              snapshot.numero_entrega,
              snapshot.complemento_entrega,
              snapshot.bairro_entrega,
              snapshot.cidade_entrega,
              snapshot.uf_entrega
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
                    cliente_id: snapshot.cliente_id,
                    nome_cliente_entrega: snapshot.nome_cliente_entrega,
                    cpf_cnpj_cliente_entrega: snapshot.cpf_cnpj_cliente_entrega,
                    email_cliente_entrega: snapshot.email_cliente_entrega,
                    telefone_entrega: snapshot.telefone_entrega,
                    cep_entrega: snapshot.cep_entrega,
                    endereco_entrega: enderecoPersistido,
                    numero_entrega: snapshot.numero_entrega,
                    complemento_entrega: snapshot.complemento_entrega,
                    bairro_entrega: snapshot.bairro_entrega,
                    cidade_entrega: snapshot.cidade_entrega,
                    uf_entrega: snapshot.uf_entrega,
                    referencia_entrega: snapshot.referencia_entrega,
                    observacao_entrega: String(body.observacao_entrega || '').trim() || null,
                    leva_maquineta: levaMaquineta,
                    troco_para: levaTroco ? trocoPara : 0,
                    cliente_nome: snapshot.nome_cliente_entrega || 'Consumidor',
                    tipo_venda: TipoVenda.ENTREGA,
                    status_venda: StatusVenda.ABERTA,
                    status_entrega: StatusEntrega.AGUARDANDO_ENTREGA,
                    status: 'reserva_entrega',
                    prestacao_realizada: 0
                  };

                  db.get(
                    `SELECT valor FROM configuracoes WHERE chave = 'fiscal_danfe_largura_mm'`,
                    [],
                    (cfgErr, cfgRow) => {
                      const papelMm = !cfgErr && Number(cfgRow && cfgRow.valor) === 58 ? 58 : 80;
                      const html = montarHtmlComprovanteEntrega(
                        vendaResp,
                        distribuicaoItens,
                        {
                          nome: body.empresa_nome,
                          cnpj: body.empresa_cnpj,
                          papel_mm: papelMm
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
                    }
                  );
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
