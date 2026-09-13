'use strict';

const db = require('../../database');
const moment = require('moment');
const configService = require('../configuracaoService');
const tefManager = require('../tef/TefManager');
const tefContrato = require('../tef/tefContrato');
const tefFluxoPagamento = require('../tef/tefFluxoPagamento');
const tefConfigService = require('../tef/tefConfigService');
const lotesService = require('../lotesService');
const { normalizarTipoVendaItem } = require('../vendaUnidadeHelpers');
const { separarItensDistribuidos } = require('../fiscalNaoFiscalService');
const OrquestradorPagamento = require('../OrquestradorPagamento');
const { parseVendaFiscalFlag, distribuirItensVendaComValorFiscalEfetivo } = require('../distribuidorEstoqueVenda');
const {
  prepararEntradasMotorComTransferenciaPdv,
  aplicarTransferenciasPdv
} = require('../estoque/transferenciaNaoFiscalParaFiscalPdv');
const cfgTransferenciaPdv = require('../estoque/pdvTransferenciaNaoFiscalFiscalConfig');
const {
  ordenarRecebimentosAB,
  persistirGrupoRecebimento,
  aplicarPoliticaRecebimentosFluxoVenda
} = require('./recebimentoPagamento');
const mpfc = require('../mpfc');
const {
  obterCreditoReservaPedidoCb,
  creditarDisponibilidadeComReservaPedido,
  consumirReservasPedidoNaVendaCb
} = require('../estoque/pedidoReservaPonteNucleo');

function iniciarTransacaoVendaComTransferenciaPdv(dbConn, aplicacoes, usuarioId, next) {
  dbConn.run('BEGIN IMMEDIATE', (beginErr) => {
    if (beginErr) return next(beginErr);
    if (!Array.isArray(aplicacoes) || aplicacoes.length === 0) {
      return next(null);
    }
    aplicarTransferenciasPdv(aplicacoes, {
      db: dbConn,
      usuarioId,
      jaEmTransacao: true
    }).then(() => next(null)).catch((err) => {
      dbConn.run('ROLLBACK', () => next(err));
    });
  });
}

/**
 * RC8.2 — carrega MPFC e entrega política aos consumidores.
 * midpAtivo / preservarDinheiro vêm exclusivamente da política (não de leitura direta no F×NF).
 */
function carregarPoliticaFiscalComercialPassiva(opcoes = {}) {
  const politica = mpfc.obterPolitica(opcoes);
  const comercial = mpfc.receberPoliticaMotorComercial(politica);
  const fiscalNaoFiscal = mpfc.receberPoliticaMotorFiscalNaoFiscal(politica);
  const snapshot = mpfc.prepararSnapshot(politica);
  return { politica, comercial, fiscalNaoFiscal, snapshot };
}

/**
 * RC8.2 — validação comercial de margem (domínio comercial exclusivo).
 */
function validarMargemPoliticaComercial(itens, produtoMap, politica) {
  return mpfc.validarMargemMinimaComercial(itens, produtoMap, politica);
}

/**
 * RC3.15.11 — prioridade fiscal do estoque ≠ emissão de NFC-e.
 * - venda_fiscal: informa o Motor F×NF (priorizar saldo fiscal)
 * - emitir_fiscal: informa se o núcleo deve emitir NFC-e
 * Retrocompatível: se venda_fiscal ausente, usa emitir_fiscal (PDV).
 */
function resolverVendaFiscalParaMotor(body = {}) {
  if (body.venda_fiscal !== undefined && body.venda_fiscal !== null && body.venda_fiscal !== '') {
    return parseVendaFiscalFlag(body.venda_fiscal);
  }
  return parseVendaFiscalFlag(body.emitir_fiscal);
}

/**
 * HOTFIX FISCAL-4.0.2 — totais oficiais para validação de pagamento.
 * Prefere valorFiscalLiquido / valorNaoFiscalLiquido do Motor; espelha itens se ausente.
 */
function resolverTotaisFiscaisLiquidosMotor(resultadoMotor, distribuicaoItens) {
  const espelho = separarItensDistribuidos(distribuicaoItens || []);
  const totalFiscal = Number(
    resultadoMotor && resultadoMotor.valorFiscalLiquido != null
      ? resultadoMotor.valorFiscalLiquido
      : (resultadoMotor && resultadoMotor.valorFiscalEfetivo != null
        ? resultadoMotor.valorFiscalEfetivo
        : espelho.totalFiscal)
  );
  const totalNaoFiscal = Number(
    resultadoMotor && resultadoMotor.valorNaoFiscalLiquido != null
      ? resultadoMotor.valorNaoFiscalLiquido
      : (resultadoMotor && resultadoMotor.valorNaoFiscal != null
        ? resultadoMotor.valorNaoFiscal
        : espelho.totalNaoFiscal)
  );
  return {
    totalFiscal: Math.round((totalFiscal || 0) * 100) / 100,
    totalNaoFiscal: Math.round((totalNaoFiscal || 0) * 100) / 100
  };
}

const VendaFinanceiroService = require('./VendaFinanceiroService');
const VendaFiscalService = require('./VendaFiscalService');

const { agoraLocalBrasil, validarSomaPagamentosVenda } = VendaFinanceiroService;
const { emitirFiscalSeSolicitado, responderVendaComFiscal } = VendaFiscalService;

/**
 * Enriquece SQLITE FOREIGN KEY com a etapa e IDs relevantes (diagnóstico PDV).
 */
function erroPersistenciaVenda(err, etapa, ctx = {}) {
  const msg = String((err && err.message) || err || 'Erro ao gravar venda');
  if (/FOREIGN KEY/i.test(msg)) {
    const detalhe = Object.entries(ctx || {})
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    return {
      error:
        `Integridade do banco na etapa "${etapa}" (FOREIGN KEY).` +
        (detalhe ? ` Refs: ${detalhe}.` : '') +
        ' Confira caixa/turno, terminal, operador, cliente e produto.',
      codigo: 'FK_CONSTRAINT',
      etapa
    };
  }
  return { error: msg, etapa };
}

function atualizarSaldoProdutoAposBaixa(produtoId, quantidade, itemFiscal, callback) {
  if (Number(itemFiscal) === 1) {
    db.run(`
      UPDATE produtos
      SET
        saldo_fiscal = saldo_fiscal - ?,
        estoque_atual = (saldo_fiscal - ?) + saldo_nao_fiscal
      WHERE id = ?
    `, [quantidade, quantidade, produtoId], callback);
  } else {
    db.run(`
      UPDATE produtos
      SET
        saldo_nao_fiscal = saldo_nao_fiscal - ?,
        estoque_atual = saldo_fiscal + (saldo_nao_fiscal - ?)
      WHERE id = ?
    `, [quantidade, quantidade, produtoId], callback);
  }
}

function reduzirEstoqueComFEFO(vendaItemId, produtoId, quantidade, itemFiscal, callback) {
  lotesService.produtoControlaValidade(produtoId, (err, controlaValidade) => {
    if (err) return callback(err);

    if (!controlaValidade) {
      return atualizarSaldoProdutoAposBaixa(produtoId, quantidade, itemFiscal, callback);
    }

    // Produto controla validade - usar FEFO
    lotesService.consumirLotesFEFO(produtoId, quantidade, (consumoErr, consumoLotes) => {
      if (consumoErr) return callback(consumoErr);

      const aposRegistro = (registroErr) => {
        if (registroErr) return callback(registroErr);
        atualizarSaldoProdutoAposBaixa(produtoId, quantidade, itemFiscal, callback);
      };

      // Sem item válido não grava venda_lotes (evita FK órfã); baixa de lote já ocorreu
      if (vendaItemId == null || Number(vendaItemId) <= 0) {
        return aposRegistro(null);
      }

      db.get('SELECT id FROM vendas_itens WHERE id = ?', [vendaItemId], (itemLookupErr, itemRow) => {
        if (itemLookupErr) return callback(itemLookupErr);
        if (!itemRow) return aposRegistro(null);
        lotesService.registrarConsumoVenda(vendaItemId, consumoLotes, aposRegistro);
      });
    });
  });
}

function reduzirEstoqueDistribuido(
  vendaItemId,
  produtoId,
  quantidadeFiscal,
  quantidadeNaoFiscal,
  callback
) {
  const { produtoControlaEstoque } = require('../estoque/produtoControlaEstoque');

  db.get(
    `SELECT COALESCE(controla_estoque, 1) AS controla_estoque FROM produtos WHERE id = ?`,
    [produtoId],
    (errFlag, rowFlag) => {
      if (errFlag) return callback(errFlag);
      if (!produtoControlaEstoque(rowFlag || {})) {
        return callback(null);
      }

      const executarNaoFiscal = () => {

        if (Number(quantidadeNaoFiscal || 0) <= 0) {
          return callback(null);
        }

        reduzirEstoqueComFEFO(
          vendaItemId,
          produtoId,
          quantidadeNaoFiscal,
          0,
          callback
        );

      };

      if (Number(quantidadeFiscal || 0) <= 0) {
        return executarNaoFiscal();
      }

      reduzirEstoqueComFEFO(
        vendaItemId,
        produtoId,
        quantidadeFiscal,
        1,
        (err) => {

          if (err) {
            return callback(err);
          }

          executarNaoFiscal();

        }
      );
    }
  );
}

function atualizarStatusPagamentoVenda(vendaId, status, tefTransacaoId) {
  if (tefTransacaoId) {
    db.run(
      `UPDATE vendas SET status_pagamento = ?, tef_transacao_id = ? WHERE id = ?`,
      [status, tefTransacaoId, vendaId]
    );
  } else {
    db.run(
      `UPDATE vendas SET status_pagamento = ? WHERE id = ?`,
      [status, vendaId]
    );
  }
}

// Função para gravar recebimentos
function flattenRecebimentos(recebimentos) {
  if (!Array.isArray(recebimentos)) {
    return [];
  }

  return recebimentos.flatMap((item) => (Array.isArray(item) ? item : [item]));
}

function gravarRecebimentos(vendaId, recebimentos, callback) {
  const lista = flattenRecebimentos(recebimentos);
  let index = 0;

  function next() {
    if (index >= lista.length) {
      callback(null);
      return;
    }

    const r = lista[index++];

    db.run(`
      INSERT INTO venda_recebimentos
      (
        venda_id,
        tipo_recebimento,
        forma_pagamento,
        valor,
        tef_transacao_id,
        nsu,
        autorizacao,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      vendaId,
      r.tipo_recebimento,
      r.forma_pagamento,
      Number(r.valor || 0),
      r.tef_transacao_id || null,
      r.nsu || null,
      r.autorizacao || null,
      'aprovado'
    ], next);
  }

  next();
}

function linhasPagamentoPersistencia(pagamentosVenda, recebimentos, formaPagamentoFinal, total, tef) {
  const rec = flattenRecebimentos(recebimentos).filter((r) => Number(r.valor || 0) > 0);
  const origem = rec.length > 0
    ? rec
    : (Array.isArray(pagamentosVenda) && pagamentosVenda.length > 0
      ? pagamentosVenda
      : [{
          forma_pagamento: formaPagamentoFinal,
          valor: Number(total || 0),
          tef_transacao_id: tef?.transacao_id || null,
          nsu: tef?.nsu || null,
          autorizacao: tef?.autorizacao || null,
          bandeira: tef?.bandeira || null,
          adquirente: tef?.adquirente || null,
          tef
        }]);

  return ordenarRecebimentosAB(origem).map((p) => ({
    ...p,
    tipo_recebimento: persistirGrupoRecebimento(p)
  }));
}

function gravarVendaPagamentos(vendaId, linhas, callback) {
  const lista = Array.isArray(linhas) ? linhas : [];
  if (lista.length === 0) {
    if (typeof callback === 'function') callback(null);
    return;
  }

  const stmt = db.prepare(`
    INSERT INTO venda_pagamentos (
      venda_id, forma_pagamento, valor, tipo_recebimento,
      tef_transacao_id, tef_nsu, tef_autorizacao,
      tef_bandeira, tef_adquirente,
      tef_comprovante_cliente, tef_comprovante_estabelecimento
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  lista.forEach((p) => {
    stmt.run(
      vendaId,
      p.forma_pagamento,
      Number(p.valor || 0),
      p.tipo_recebimento || null,
      p.tef_transacao_id || p.tef?.transacao_id || null,
      p.nsu || p.tef?.nsu || null,
      p.autorizacao || p.tef?.autorizacao || null,
      p.bandeira || p.tef?.bandeira || null,
      p.adquirente || p.tef?.adquirente || null,
      p.tef?.comprovante_cliente || null,
      p.tef?.comprovante_estabelecimento || null
    );
  });

  stmt.finalize((err) => {
    if (typeof callback === 'function') callback(err || null);
  });
}

// TEF exclusivo para recebimentos fiscais (conta empresa)
async function processarPagamentosTef(recebimentos) {
  let tefHabilitado = false;

  try {
    const tefConfig = await tefConfigService.obterConfiguracao();
    tefHabilitado = tefFluxoPagamento.parseTefHabilitado(tefConfig.tefHabilitado);
  } catch (error) {
    console.error('Erro ao verificar configuração TEF:', error);
    tefHabilitado = false;
  }

  if (!tefHabilitado) {
    console.log('TEF desabilitado, pulando autorização de pagamentos TEF');
    return { sucesso: true, transacoes: [] };
  }

  const pagamentosTef = recebimentos.filter((p) => {
    const forma = String(p.forma_pagamento || '').toLowerCase();
    return forma === 'cartao_debito'
      || forma === 'cartao_credito'
      || forma === 'cartao'
      || forma === 'pix'
      || forma === 'pix_tef';
  });

  if (pagamentosTef.length === 0) {
    return { sucesso: true, transacoes: [] };
  }

  const transacoesAutorizadas = [];

  for (const pagamento of pagamentosTef) {
    if (pagamento.tef_transacao_id) {
      transacoesAutorizadas.push(pagamento.tef_transacao_id);
      continue;
    }

    try {
      const tipoTef = tefFluxoPagamento.normalizarTipoTef(pagamento.forma_pagamento);
      const retornoTEF = await tefManager.autorizar({
        venda_id: null,
        tipo: tipoTef,
        valor: pagamento.valor,
        parcelas: 1
      });

      if (!tefContrato.estaAprovado(retornoTEF)) {
        // Cancelar transações anteriores
        for (const transacaoId of transacoesAutorizadas) {
          try {
            await tefManager.cancelar(transacaoId, 'Pagamento fiscal não aprovado');
          } catch (cancelError) {
            console.error(`Erro ao cancelar transação TEF ${transacaoId}:`, cancelError);
          }
        }
        return { sucesso: false, erro: retornoTEF };
      }

      if (retornoTEF.transacao_id) {
        transacoesAutorizadas.push(retornoTEF.transacao_id);
        pagamento.tef_transacao_id = retornoTEF.transacao_id;
        pagamento.nsu = retornoTEF.nsu;
        pagamento.autorizacao = retornoTEF.autorizacao;
      }
    } catch (error) {
      console.error('Erro ao autorizar pagamento TEF fiscal:', error);
      // Cancelar transações anteriores
      for (const transacaoId of transacoesAutorizadas) {
        try {
          await tefManager.cancelar(transacaoId, 'Erro no pagamento fiscal');
        } catch (cancelError) {
          console.error(`Erro ao cancelar transação TEF ${transacaoId}:`, cancelError);
        }
      }
      return { sucesso: false, erro: error.message };
    }
  }

  return { sucesso: true, transacoes: transacoesAutorizadas };
}


const FORMAS_NAO_FISCAL_PERMITIDAS = new Set([
  'pix',
  'dinheiro',
  'cartao',
  'cartao_pf',
  'outro'
]);

const FORMAS_TEF_FISCAL = new Set([
  'cartao_debito',
  'cartao_credito'
]);

function calcularSaldoNaoFiscal(venda, recebimentosNaoFiscal) {
  const valorNaoFiscal = Number(venda.valor_nao_fiscal || 0);
  const recebimentos = Array.isArray(recebimentosNaoFiscal) ? recebimentosNaoFiscal : [];
  const valorRecebido = recebimentos.reduce(
    (acc, r) => acc + Number(r.valor || 0),
    0
  );
  const saldoPendente = Math.round((valorNaoFiscal - valorRecebido) * 100) / 100;

  return {
    valorNaoFiscal,
    valorRecebido,
    saldoPendente: Math.max(0, saldoPendente)
  };
}

function filtrarRecebimentosNaoFiscal(recebimentos) {
  return (Array.isArray(recebimentos) ? recebimentos : []).filter(
    (recebimento) => String(recebimento.tipo_recebimento || '').toLowerCase() === 'nao_fiscal'
  );
}

function resolverStatusPagamentoVenda(
  valorNaoFiscal,
  recebimentosNaoFiscal,
  statusAtual = 'quitada',
  opcoes = {}
) {
  const valor = Number(valorNaoFiscal || 0);
  const valorFiscal = Number(opcoes.valorFiscal || 0);
  const recebimentos = Array.isArray(recebimentosNaoFiscal) ? recebimentosNaoFiscal : [];

  if (valor <= 0 && valorFiscal <= 0) {
    return statusAtual;
  }

  const totalConfirmado = recebimentos.reduce(
    (acc, recebimento) => acc + Number(recebimento.valor || 0),
    0
  );
  const naoFiscalConfirmado =
    recebimentos.length > 0
    && Math.abs(totalConfirmado - valor) <= 0.01;

  // Venda mista (fiscal + não fiscal): 2ª etapa obrigatória
  if (valorFiscal > 0 && valor > 0) {
    return naoFiscalConfirmado ? statusAtual : 'aguardando_nao_fiscal';
  }

  // Venda somente não fiscal: pagamento único na criação — nunca aguarda 2ª etapa
  if (valorFiscal <= 0 && valor > 0) {
    if (naoFiscalConfirmado || statusAtual === 'quitada' || statusAtual === 'pendente') {
      return 'quitada';
    }
    return statusAtual;
  }

  // Venda somente fiscal
  return statusAtual;
}

function aplicarRegraStatusPagamentoVenda({
  valorFiscal,
  valorNaoFiscal,
  statusPagamento,
  recebimentos
}) {
  const recebimentosNaoFiscal = filtrarRecebimentosNaoFiscal(recebimentos);
  const statusFinal = resolverStatusPagamentoVenda(
    valorNaoFiscal,
    recebimentosNaoFiscal,
    statusPagamento,
    { valorFiscal }
  );

  let recebimentosFinal = Array.isArray(recebimentos) ? [...recebimentos] : [];

  if (statusFinal === 'aguardando_nao_fiscal') {
    recebimentosFinal = recebimentosFinal.filter(
      (recebimento) => String(recebimento.tipo_recebimento || '').toLowerCase() !== 'nao_fiscal'
    );
  }

  return {
    statusPagamento: statusFinal,
    recebimentos: recebimentosFinal
  };
}

function normalizarPagamentosNaoFiscal(body) {
  if (Array.isArray(body.pagamentos) && body.pagamentos.length > 0) {
    return body.pagamentos;
  }

  if (body.forma_pagamento && body.valor != null) {
    return [{
      forma_pagamento: body.forma_pagamento,
      valor: body.valor
    }];
  }

  return [];
}

function validarPagamentosNaoFiscal(pagamentos) {
  for (const pagamento of pagamentos) {
    const forma = String(pagamento.forma_pagamento || '').toLowerCase().trim();

    if (!forma) {
      return 'Informe a forma de pagamento não fiscal.';
    }

    if (FORMAS_TEF_FISCAL.has(forma) || pagamento.tef_transacao_id) {
      return 'Pagamento não fiscal não utiliza TEF.';
    }

    if (!FORMAS_NAO_FISCAL_PERMITIDAS.has(forma)) {
      return `Forma de pagamento não fiscal inválida: ${forma}.`;
    }

    if (Number(pagamento.valor || 0) <= 0) {
      return 'Valor do pagamento não fiscal deve ser maior que zero.';
    }
  }

  return null;
}

function obterTerminalId(req) {
  const rawId = req.body?.terminal_id || req.query?.terminal_id || req.headers['x-terminal-id'];
  const id = Number(rawId || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function preCalcularDistribuicao(req, res) {
const { itens, emitir_fiscal, desconto, acrescimo } = req.body;
const vendaFiscal = resolverVendaFiscalParaMotor(req.body);

if (!itens || !Array.isArray(itens) || itens.length === 0) {
  return res.status(400).json({
    sucesso: false,
    error: 'Itens da venda são obrigatórios.'
  });
}

if (itens.some((item) => item.produto_id === undefined || item.produto_id === null)) {
  return res.status(400).json({
    sucesso: false,
    error: 'Um ou mais itens da venda não possuem produto vinculado.'
  });
}

const produtoIds = Array.from(
  new Set(itens.map((item) => item.produto_id).filter((id) => id !== undefined && id !== null))
);

db.all(`
  SELECT
    id,
    nome,
    saldo_fiscal,
    saldo_nao_fiscal,
    COALESCE(controla_estoque, 1) AS controla_estoque
  FROM produtos
  WHERE id IN (${produtoIds.map(() => '?').join(',')})
`, produtoIds, (err, produtos) => {
  if (err) {
    return res.status(500).json({ sucesso: false, error: err.message });
  }

  const { saldosParaDistribuicaoVenda } = require('../estoque/produtoControlaEstoque');

  const produtoMap = produtos.reduce((map, produto) => {
    map[produto.id] = produto;
    return map;
  }, {});

  const itensDistribuidos = [];
  const entradasMotor = [];

  for (const item of itens) {
    const produto = produtoMap[item.produto_id];

    if (!produto) {
      return res.status(400).json({
        sucesso: false,
        error: `Produto ID ${item.produto_id} não encontrado`
      });
    }

    const qtdEstoque = item.quantidade_estoque != null && item.quantidade_estoque !== ''
      ? Number(item.quantidade_estoque)
      : Number(item.quantidade || 0);
    const saldos = saldosParaDistribuicaoVenda(
      produto,
      qtdEstoque,
      produto.saldo_fiscal,
      produto.saldo_nao_fiscal
    );

    entradasMotor.push({
      item,
      saldoFiscal: saldos.saldoFiscal,
      saldoNaoFiscal: saldos.saldoNaoFiscal,
      controlaEstoque: Number(produto.controla_estoque) !== 0,
      produto
    });
  }

  const preparadoPdv = prepararEntradasMotorComTransferenciaPdv(entradasMotor, {
    permitido: cfgTransferenciaPdv.estaAtivadaSync()
  });
  if (preparadoPdv.sucesso === false) {
    return res.status(400).json({
      sucesso: false,
      error: preparadoPdv.erro || 'Falha ao validar transferência de estoque.'
    });
  }

  const { politica: politicaMpfc } = carregarPoliticaFiscalComercialPassiva();
  const midpAtivo = Boolean(politicaMpfc.preservarDinheiro);
  const pagamentosPre = Array.isArray(req.body?.pagamentos) ? req.body.pagamentos : [];
  const resultadoMotor = distribuirItensVendaComValorFiscalEfetivo(
    preparadoPdv.entradas,
    vendaFiscal,
    {
      pagamentos: pagamentosPre,
      midpAtivo,
      desconto: Number(desconto || 0),
      acrescimo: Number(acrescimo || 0),
      politicaFiscalComercial: politicaMpfc
    }
  );

  if (!resultadoMotor.sucesso) {
    const nome = resultadoMotor.item?.produto_id
      ? (produtoMap[resultadoMotor.item.produto_id]?.nome || resultadoMotor.item.produto_id)
      : 'produto';
    return res.status(400).json({
      sucesso: false,
      error:
        `Saldo insuficiente para ${nome}. ` +
        `Disponível: ${resultadoMotor.erro?.estoqueTotal}`
    });
  }

  for (const row of resultadoMotor.itens) {
    itensDistribuidos.push({
      produto_id: row.produto_id,
      quantidade_fiscal: row.quantidade_fiscal,
      quantidade_nao_fiscal: row.quantidade_nao_fiscal,
      valor_fiscal: row.valor_fiscal,
      valor_nao_fiscal: row.valor_nao_fiscal
    });
  }

  res.json({
    sucesso: true,
    liquido_aplicado_backend: true,
    valor_fiscal: resultadoMotor.valorFiscalEfetivo,
    valor_nao_fiscal: resultadoMotor.valorNaoFiscal,
    valor_fiscal_maximo: resultadoMotor.valorFiscalMaximo,
    valor_fiscal_efetivo: resultadoMotor.valorFiscalEfetivo,
    valor_fiscal_liquido: resultadoMotor.valorFiscalLiquido,
    valor_nao_fiscal_liquido: resultadoMotor.valorNaoFiscalLiquido,
    valor_fiscal_bruto: resultadoMotor.valorFiscalBruto,
    midp_preservacao: resultadoMotor.preservacaoAplicada,
    liquido_comercial: resultadoMotor.liquidoComercial || null,
    itens: itensDistribuidos
  });
});
}

function vendaExigeAutorizacaoDescontoManual(body = {}) {
  if (Number(body.desconto || 0) > 0) return true;
  const itens = Array.isArray(body.itens) ? body.itens : [];
  return itens.some((item) => (
    Number(item.desconto_manual || 0) === 1
    && (Number(item.desconto_valor || 0) > 0 || Number(item.desconto_percentual || 0) > 0)
  ));
}

function criarVenda(req, res) {
const tipoVendaCanal = String(req.body?.tipo_venda || 'BALCAO').toUpperCase();
if (tipoVendaCanal === 'ENTREGA') {
  const { criarVendaEntrega } = require('../entrega/CriarVendaEntregaService');
  return criarVendaEntrega(req, res);
}

if (!req.__descontoAuthOk && vendaExigeAutorizacaoDescontoManual(req.body)) {
  const { verificarSupervisorToken, isSupervisorPerfil } = require('../../rotas/auth');
  if (!isSupervisorPerfil(req.user || {})) {
    return verificarSupervisorToken(req.body.supervisor_token || null)
      .then((supervisorUser) => {
        req.__descontoAuthOk = true;
        req.supervisorAutorizacao = supervisorUser;
        return criarVenda(req, res);
      })
      .catch((err) => res.status(403).json({
        error: err.message || 'Desconto exige autorização de administrador ou supervisor.',
        codigo: err.code || 'DESCONTO_NAO_AUTORIZADO'
      }));
  }
  req.__descontoAuthOk = true;
}

const {
  cliente_id,
  total,
  desconto,
  acrescimo,
  forma_pagamento,
  itens,
  parcelas,
  primeiro_vencimento,
  forcar,
  emitir_fiscal,
  valor_recebido,
  cpf_cnpj_nota,
  pagamentos,
  tef,
  pedido_id: pedidoIdBody,
  valor_fiscal: _valorFiscalBody,
  valor_nao_fiscal: _valorNaoFiscalBody
} = req.body;

/** RC4.1.2 — ponte reserva do pedido (Expedição → Núcleo). Já vem em FaturamentoService. */
const pedidoIdVenda = Number(pedidoIdBody || req.body?.pedidoId || 0) || null;

const vendaFiscal = resolverVendaFiscalParaMotor(req.body);

const cpfCnpjNotaLimpo = String(cpf_cnpj_nota || '').replace(/\D/g, '');

if (cpfCnpjNotaLimpo && ![11, 14].includes(cpfCnpjNotaLimpo.length)) {
  return res.status(400).json({
    error: 'CPF/CNPJ informado na nota é inválido.'
  });
}

const pagamentosVenda = Array.isArray(pagamentos) ? pagamentos : [];

let formaPagamentoFinal = forma_pagamento;

if (pagamentosVenda.length > 1) {
  formaPagamentoFinal = "misto";
}

// Hotfix: body.valor_fiscal / valor_nao_fiscal são ignorados — fonte de verdade = Motor.
void _valorFiscalBody;
void _valorNaoFiscalBody;

const totalNum = Number(total);
const formasPendentes = ['prazo', 'parcelado', 'crediario', 'boleto', 'boleto_bancario'];
const formaPagamentoNormalizada = String(forma_pagamento || '').toLowerCase().trim();
const vendaFicaPendente = formasPendentes.includes(formaPagamentoNormalizada);

/** RC3.17 — mesmas formas que geram Contas a Receber pelo caminho a prazo existente */
function formaGeraParcelasFinanceiras(forma) {
  return formasPendentes.includes(String(forma || '').toLowerCase().trim());
}

function avancarVencimentoParcela(baseMoment, intervalo) {
  const m = baseMoment.clone ? baseMoment.clone() : moment(baseMoment);
  const i = String(intervalo || 'mensal').toLowerCase().trim();
  if (i === 'semanal') return m.add(1, 'weeks');
  if (i === 'quinzenal') return m.add(15, 'days');
  return m.add(1, 'months');
}

const intervaloParcelasBody = req.body?.intervalo_parcelas || req.body?.intervalo || 'mensal';


const buscarNomeCliente = (callback) => {
  if (!cliente_id) {
    callback(null, null, null);
    return;
  }

  db.get(
    'SELECT nome, cpf_cnpj FROM clientes WHERE id = ?',
    [cliente_id],
    (err, cliente) => {
      if (err) {
        callback(err);
        return;
      }

      callback(null, cliente ? cliente.nome : null, cliente ? cliente.cpf_cnpj : null);
    }
  );
};

if (!itens || !Array.isArray(itens) || itens.length === 0) {
  res.status(400).json({ error: 'Informe ao menos um item na venda.' });
  return;
}
if (Number.isNaN(totalNum) || totalNum <= 0) {
  res.status(400).json({ error: 'Total inválido.' });
  return;
}

if (formaGeraParcelasFinanceiras(forma_pagamento) && !cliente_id) {
  return res.status(400).json({
    error: 'Cliente é obrigatório para venda a prazo / parcelada / boleto.'
  });
}

const produtoIds = Array.from(new Set(itens.map(item => item.produto_id).filter(id => id !== undefined && id !== null)));

if (itens.some(item => item.produto_id === undefined || item.produto_id === null)) {
  res.status(400).json({ error: 'Um ou mais itens da venda não possuem produto vinculado.' });
  return;
}

db.all(`
  SELECT
    id,
    nome,
    preco_compra,
    saldo_fiscal,
    saldo_nao_fiscal,
    estoque_atual,
    COALESCE(reservado_fiscal, 0) AS reservado_fiscal,
    COALESCE(reservado_nao_fiscal, 0) AS reservado_nao_fiscal,
    COALESCE(controla_estoque, 1) AS controla_estoque
  FROM produtos
  WHERE id IN (${produtoIds.map(() => '?').join(',')})
`, produtoIds, (err, produtos) => {
  if (err) {
    res.status(500).json({ error: err.message });
    return;
  }

  const { calcularEstoqueProduto } = require('../estoque/EstoqueDisponivelService');
  const { saldosParaDistribuicaoVenda } = require('../estoque/produtoControlaEstoque');

  const produtoMap = produtos.reduce((map, produto) => {
    map[produto.id] = produto;
    return map;
  }, {});

  const faltantes = itens.reduce((acumulador, item) => {
    const produto = produtoMap[item.produto_id];
    if (!produto) {
      acumulador.push(`Produto ID ${item.produto_id} não encontrado`);
    }
    return acumulador;
  }, []);

  if (faltantes.length > 0) {
    res.status(400).json({ error: 'Erro na venda: ' + faltantes.join('; ') });
    return;
  }

  // RC4.1.2 — carrega crédito da reserva do pedido antes da distribuição
  obterCreditoReservaPedidoCb(pedidoIdVenda, db, (_credErr, creditoReserva) => {
    const creditoPorProduto = (creditoReserva && creditoReserva.por_produto) || {};

  const distribuicaoItens = [];
  const entradasMotor = [];

  for (const item of itens) {
    const produto = produtoMap[item.produto_id];
    const calcBase = calcularEstoqueProduto(produto);
    const creditoAplicado = creditoPorProduto[item.produto_id] || 0;
    const calc = creditarDisponibilidadeComReservaPedido(
      calcBase,
      creditoAplicado
    );

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

  const { politica: politicaMpfc, snapshot: snapshotMpfc } = carregarPoliticaFiscalComercialPassiva();
  const midpAtivo = Boolean(politicaMpfc.preservarDinheiro);
  const snapshotJson = mpfc.snapshotParaJson(politicaMpfc);
  mpfc.registrarSnapshotGravado(politicaMpfc, { fonte: 'criar_venda' });

  const validacaoMargem = validarMargemPoliticaComercial(itens, produtoMap, politicaMpfc);
  if (!validacaoMargem.sucesso) {
    return res.status(400).json({
      error: validacaoMargem.error,
      codigo: 'MARGEM_MINIMA_COMERCIAL',
      itens: validacaoMargem.itensViolados
    });
  }

  const pagamentosParaMotor = Array.isArray(pagamentosVenda) && pagamentosVenda.length
    ? pagamentosVenda
    : (forma_pagamento
      ? [{ forma_pagamento, valor: Number(total || 0) }]
      : []);

  const resultadoMotor = distribuirItensVendaComValorFiscalEfetivo(
    preparadoTransferenciaPdv.entradas,
    vendaFiscal,
    {
      pagamentos: pagamentosParaMotor,
      midpAtivo,
      desconto: Number(desconto || 0),
      acrescimo: Number(acrescimo || 0),
      politicaFiscalComercial: politicaMpfc
    }
  );

  if (!resultadoMotor.sucesso) {
    const produtoErro = resultadoMotor.item
      ? produtoMap[resultadoMotor.item.produto_id]
      : null;
    return res.status(400).json({
      error:
        `Saldo insuficiente para ${produtoErro?.nome || 'produto'}. ` +
        `Disponível: ${resultadoMotor.erro?.estoqueTotal}`
    });
  }

  for (const row of resultadoMotor.itens) {
    distribuicaoItens.push({
      ...row,
      quantidade_fiscal: row.quantidade_fiscal,
      quantidade_nao_fiscal: row.quantidade_nao_fiscal,
      valor_fiscal: row.valor_fiscal,
      valor_nao_fiscal: row.valor_nao_fiscal
    });
  }

  /** RC4.1.2 — após baixa de estoque, consome reserva do pedido (idempotente). */
  function consumirReservaPedidoAposBaixa(vendaId, next) {
    if (!pedidoIdVenda) return next();
    consumirReservasPedidoNaVendaCb(pedidoIdVenda, vendaId, db, () => {
      next();
    });
  }

  // Venda a prazo / parcelado / boleto / crediário exige cliente
  if (formaGeraParcelasFinanceiras(forma_pagamento)) {
  if (!cliente_id) {
    res.status(400).json({ error: 'Cliente obrigatório para venda a prazo / parcelada / boleto.' });
    return;
  }
  // Validar débitos e parcelas vencidas, a menos que forçar esteja ativo
  if (!forcar) {
    const hoje = agoraLocalBrasil().slice(0, 10);
    db.get(`
      SELECT 
        SUM(CASE WHEN status = 'aberto' THEN valor_restante ELSE 0 END) as total_em_aberto,
        COUNT(CASE WHEN status = 'aberto' AND data_vencimento < ? THEN 1 END) as parcelas_vencidas
      FROM contas_receber
      WHERE cliente_id = ?
    `, [hoje, cliente_id], (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      const totalEmAberto = Number(row?.total_em_aberto || 0);
      const parcelasVencidas = Number(row?.parcelas_vencidas || 0);
      if (totalEmAberto > 0 || parcelasVencidas > 0) {
        // Avisar operador e pedir confirmação
        res.status(409).json({
          aviso: 'Cliente possui débitos em aberto.',
          total_em_aberto: totalEmAberto,
          parcelas_vencidas: parcelasVencidas,
          pode_continuar: true
        });
        return;
      }
      executarVendaPrazo();
    });
    return;
  }
  // Função para executar venda a prazo
  executarVendaPrazo();
  async function executarVendaPrazo() {
    const codigo = `VND-${agoraLocalBrasil().replace(/[- :]/g, '').slice(0, 14)}`;
    const data_venda = agoraLocalBrasil().slice(0, 10);

    // HOTFIX FISCAL-4.0.2 — validação sempre sobre Valor Fiscal Líquido do Motor
    const totaisLiquidosPrazo = resolverTotaisFiscaisLiquidosMotor(
      resultadoMotor,
      distribuicaoItens
    );
    const totalFiscal = totaisLiquidosPrazo.totalFiscal;
    const totalNaoFiscal = totaisLiquidosPrazo.totalNaoFiscal;

    const erroSomaPagamentosMotor = validarSomaPagamentosVenda(pagamentosVenda, total, {
      valor_fiscal: totalFiscal,
      valor_nao_fiscal: totalNaoFiscal
    });
    if (erroSomaPagamentosMotor) {
      return res.status(400).json({ error: erroSomaPagamentosMotor });
    }

    // Obter configurações TEF e confirmação fiscal
    let tefHabilitado = false;
    let modoConfirmacaoFiscal = 'TEF';
    
    try {
      const tefConfig = await tefConfigService.obterConfiguracao();
      tefHabilitado = tefFluxoPagamento.parseTefHabilitado(tefConfig.tefHabilitado);
    } catch (error) {
      console.error('Erro ao verificar configuração TEF:', error);
    }
    
    modoConfirmacaoFiscal = configService.getModoConfirmacaoFiscal() || 'TEF';

    const politicaRecebimentosPrazo = aplicarPoliticaRecebimentosFluxoVenda({
      body: req.body,
      totalFiscal,
      totalNaoFiscal,
      totalComercial: totalNum,
      pagamentosVenda,
      formaPagamento: formaPagamentoFinal,
      tef,
      recebimentosOrquestrador: []
    });

    // Processar fluxo de pagamento usando o Orquestrador → MIDP (única via)
    const resultadoPagamento = await OrquestradorPagamento.processarFluxoPagamentoVenda({
      totalFiscal: politicaRecebimentosPrazo.valorFiscalStatus,
      totalNaoFiscal: politicaRecebimentosPrazo.valorNaoFiscalStatus,
      totalNaoFiscal,
      formaPagamento: formaPagamentoFinal,
      pagamentos: req.body.pagamentos || [],
      tefHabilitado,
      modoConfirmacaoFiscal,
      valorFiscalMaximo: resultadoMotor.valorFiscalMaximo,
      preservacaoAplicada: resultadoMotor.preservacaoAplicada,
      midpAtivo,
      desconto: Number(desconto || 0),
      acrescimo: Number(acrescimo || 0),
      subtotalBruto: Number(resultadoMotor.totalVendaBruto || 0),
      debugDescontoFiscal: process.env.CDS_DEBUG_DESCONTO_FISCAL === '1'
    });

    if (!resultadoPagamento.sucesso) {
      return res.status(400).json({
        error: resultadoPagamento.erro,
        tef: resultadoPagamento.tef
      });
    }

    const { resultadoFiscal } = resultadoPagamento;
    const politicaRecebimentos = aplicarPoliticaRecebimentosFluxoVenda({
      body: req.body,
      totalFiscal,
      totalNaoFiscal,
      totalComercial: totalNum,
      pagamentosVenda,
      formaPagamento: formaPagamentoFinal,
      tef,
      recebimentosOrquestrador: resultadoPagamento.recebimentos
    });
    const resultadoStatus = aplicarRegraStatusPagamentoVenda({
      valorFiscal: politicaRecebimentos.valorFiscalStatus,
      valorNaoFiscal: politicaRecebimentos.valorNaoFiscalStatus,
      statusPagamento: resultadoPagamento.statusPagamento,
      recebimentos: politicaRecebimentos.recebimentos
    });
    const { statusPagamento, recebimentos } = resultadoStatus;

    db.serialize(() => {
      iniciarTransacaoVendaComTransferenciaPdv(db, aplicacoesTransferenciaPdv, req.operadorId, (trErr) => {
      if (trErr) {
        return res.status(400).json({
          error: trErr.message || 'Falha ao transferir estoque.'
        });
      }
      db.run(`
        INSERT INTO vendas (codigo, data_venda, cliente_id, total, desconto, forma_pagamento, status, caixa_sessao_id, caixa_id, terminal_id, operador_id, valor_fiscal, valor_nao_fiscal, status_pagamento, tef_transacao_id, mpfc_politica_snapshot)
          VALUES (?, ?, ?, ?, ?, ?, 'concluida', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [codigo, data_venda, cliente_id || null, totalNum, desconto || 0, formaPagamentoFinal, req.caixaSessaoId || null, req.caixaId || null, req.terminalId || null, req.operadorId || null, totalFiscal, totalNaoFiscal, statusPagamento, resultadoFiscal?.transacoes?.[0] || null, snapshotJson], function(err) {
        if (err) {
          db.run('ROLLBACK');
          res.status(500).json(erroPersistenciaVenda(err, 'insert_vendas_prazo', {
            caixa_sessao_id: req.caixaSessaoId,
            caixa_id: req.caixaId,
            terminal_id: req.terminalId,
            operador_id: req.operadorId,
            cliente_id
          }));
          return;
        }
        const vendaId = this.lastID;

        gravarRecebimentos(
          vendaId,
          recebimentos,
          (err) => {
            if (err) {
              db.run('ROLLBACK');
              res.status(500).json({ error: err.message });
              return;
            }
          }
        );

        const transacoesTefParaVincular = resultadoFiscal?.transacoes || [];

        if (tef && tef.transacao_id) {
          transacoesTefParaVincular.push(tef.transacao_id);
        }

        pagamentosVenda.forEach((p) => {
          const idTef = p.tef_transacao_id || p.tef?.transacao_id;
          if (idTef) {
            transacoesTefParaVincular.push(idTef);
          }
        });

        [...new Set(transacoesTefParaVincular)].forEach((transacaoId) => {
          db.run(`
            UPDATE tef_transacoes
            SET venda_id = ?
            WHERE id = ?
          `, [
            vendaId,
            transacaoId
          ], (tefErr) => {
            if (tefErr) {
              console.error('Erro ao vincular TEF à venda:', tefErr);
            }
          });
        });

        let itensProcessados = 0;
        distribuicaoItens.forEach(item => {
          const quantidadeFiscal =
            Number(
              item.quantidade_fiscal || 0
            );

          const quantidadeNaoFiscal =
            Number(
              item.quantidade_nao_fiscal || 0
            );

          const itemFiscal =
            quantidadeFiscal > 0
              ? 1
              : 0;

          const precoUnitario =
            Number(
              item.preco_unitario || 0
            );

          const valorFiscal =
            Number(
              (item.valor_fiscal || 0).toFixed(2)
            );

          const valorNaoFiscal =
            Number(
              (item.valor_nao_fiscal || 0).toFixed(2)
            );

          const tipoVenda = normalizarTipoVendaItem(item);

          db.run(`
            INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, preco_unitario_interno, desconto_percentual, desconto_valor, desconto_manual, promocao_id, desconto_atacado, tipo_preco, subtotal, item_fiscal, quantidade_fiscal, quantidade_nao_fiscal, valor_fiscal, valor_nao_fiscal, tipo_venda)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [vendaId, item.produto_id, item.quantidade, item.preco_unitario, item.preco_unitario_interno ?? item.preco_unitario, item.desconto_percentual || 0, item.desconto_valor || 0, Number(item.desconto_manual || 0) === 1 ? 1 : 0, item.promocao_id || null, item.desconto_atacado || 0, item.tipo_preco || 'varejo', item.subtotal, itemFiscal, quantidadeFiscal, quantidadeNaoFiscal, valorFiscal, valorNaoFiscal, tipoVenda], (itemErr) => {
            if (itemErr) {
              db.run('ROLLBACK');
              res.status(500).json(erroPersistenciaVenda(itemErr, 'insert_vendas_itens_prazo', {
                venda_id: vendaId,
                produto_id: item.produto_id
              }));
              return;
            }

            const vendaItemIdPrazo = this.lastID;
            // Usar FEFO para reduzir estoque
            reduzirEstoqueDistribuido(vendaItemIdPrazo, item.produto_id, item.quantidade_fiscal, item.quantidade_nao_fiscal, (estErr) => {
              if (estErr) {
                db.run('ROLLBACK');
                res.status(500).json(erroPersistenciaVenda(estErr, 'baixa_estoque_fefo_prazo', {
                  venda_id: vendaId,
                  venda_item_id: vendaItemIdPrazo,
                  produto_id: item.produto_id
                }));
                return;
              }
              itensProcessados++;
              if (itensProcessados === itens.length) {
                consumirReservaPedidoAposBaixa(vendaId, () => {
                gravarVendaPagamentos(
                  vendaId,
                  linhasPagamentoPersistencia(
                    pagamentosVenda,
                    recebimentos,
                    formaPagamentoFinal,
                    total,
                    tef
                  )
                );

                // Gerar parcelas (caminho financeiro existente)
                const qtdParcelas = Number(parcelas) || 1;
                const valorParcela = Math.round((totalNum / qtdParcelas) * 100) / 100;
                let vencimento = moment(primeiro_vencimento || undefined, 'YYYY-MM-DD');
                if (!vencimento.isValid()) {
                  vencimento = moment().add(30, 'days');
                }
                for (let i = 1; i <= qtdParcelas; i++) {
                  db.run(`
                    INSERT INTO contas_receber (venda_id, cliente_id, numero_parcela, total_parcelas, valor_parcela, valor_restante, data_vencimento, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto')
                  `, [vendaId, cliente_id, i, qtdParcelas, valorParcela, valorParcela, vencimento.format('YYYY-MM-DD')]);
                  vencimento = avancarVencimentoParcela(vencimento, intervaloParcelasBody);
                }
                buscarNomeCliente((clienteErr, clienteNome, clienteCpf) => {
                  if (clienteErr) {
                    db.run('ROLLBACK');
                    res.status(500).json({ error: clienteErr.message });
                    return;
                  }

                  let vencFinBase = moment(primeiro_vencimento || undefined, 'YYYY-MM-DD');
                  if (!vencFinBase.isValid()) vencFinBase = moment().add(30, 'days');
                  const inserirFinanceiroPrazo = (indice = 1, venc = vencFinBase.clone()) => {
                    if (indice > qtdParcelas) {
                      db.run('COMMIT');

                      responderVendaComFiscal(res, {
                        vendaId,
                        codigo,
                        message: 'Venda a prazo registrada com sucesso',
                        emitirFiscal: !!emitir_fiscal,
                        valorFiscal: totalFiscal,
                        valorNaoFiscal: totalNaoFiscal,
                        statusPagamento: statusPagamento,
                        pagamentosTef: pagamentosVenda
                      });
                      return;
                    }

                    db.run(`
                      INSERT INTO financeiro (
                        tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
                        referencia_id, referencia_tipo, status, origem, documento, vencimento,
                        numero_parcela, total_parcelas, venda_id, pessoa_nome, baixado_em
                      ) VALUES ('receita', ?, ?, ?, 'vendas', ?, ?, 'venda', 'pendente', 'venda', ?, ?, ?, ?, ?, ?, NULL)
                    `, [
                      `Venda ${codigo} - Parcela ${indice}/${qtdParcelas}`,
                      valorParcela,
                      data_venda,
                      forma_pagamento,
                      vendaId,
                      clienteCpf,
                      venc.format('YYYY-MM-DD'),
                      indice,
                      qtdParcelas,
                      vendaId,
                      clienteNome
                    ], (finErr) => {
                      if (finErr) {
                        db.run('ROLLBACK');
                        res.status(500).json({ error: finErr.message });
                        return;
                      }

                      inserirFinanceiroPrazo(indice + 1, avancarVencimentoParcela(venc, intervaloParcelasBody));
                    });
                  };

                  inserirFinanceiroPrazo();
                });
              });
              }
            });
          });
        });
      });
    });
    });
  }
  return;
}

// Venda à vista ou crédito antigo
const executarVenda = async () => {
  const codigo = `VND-${agoraLocalBrasil().replace(/[- :]/g, '').slice(0, 14)}`;
  const data_venda = agoraLocalBrasil().slice(0, 10);

  // HOTFIX FISCAL-4.0.2 — validação sempre sobre Valor Fiscal Líquido do Motor
  const totaisLiquidos = resolverTotaisFiscaisLiquidosMotor(
    resultadoMotor,
    distribuicaoItens
  );
  const totalFiscal = totaisLiquidos.totalFiscal;
  const totalNaoFiscal = totaisLiquidos.totalNaoFiscal;

  const erroSomaPagamentosMotor = validarSomaPagamentosVenda(pagamentosVenda, total, {
    valor_fiscal: totalFiscal,
    valor_nao_fiscal: totalNaoFiscal
  });
  if (erroSomaPagamentosMotor) {
    return res.status(400).json({ error: erroSomaPagamentosMotor });
  }

  // Obter configurações TEF e confirmação fiscal
  let tefHabilitado = false;
  let modoConfirmacaoFiscal = 'TEF';
  
  try {
    const tefConfig = await tefConfigService.obterConfiguracao();
    tefHabilitado = tefFluxoPagamento.parseTefHabilitado(tefConfig.tefHabilitado);
  } catch (error) {
    console.error('Erro ao verificar configuração TEF:', error);
  }
  
  modoConfirmacaoFiscal = configService.getModoConfirmacaoFiscal() || 'TEF';

  const politicaRecebimentosVistaPre = aplicarPoliticaRecebimentosFluxoVenda({
    body: req.body,
    totalFiscal,
    totalNaoFiscal,
    totalComercial: totalNum,
    pagamentosVenda,
    formaPagamento: formaPagamentoFinal,
    tef,
    recebimentosOrquestrador: []
  });

  // Processar fluxo de pagamento usando o Orquestrador → MIDP (única via)
  const resultadoPagamento = await OrquestradorPagamento.processarFluxoPagamentoVenda({
    totalFiscal: politicaRecebimentosVistaPre.valorFiscalStatus,
    totalNaoFiscal: politicaRecebimentosVistaPre.valorNaoFiscalStatus,
    totalNaoFiscal,
    formaPagamento: formaPagamentoFinal,
    pagamentos: req.body.pagamentos || [],
    tefHabilitado,
    modoConfirmacaoFiscal,
    valorFiscalMaximo: resultadoMotor.valorFiscalMaximo,
    preservacaoAplicada: resultadoMotor.preservacaoAplicada,
    midpAtivo,
    desconto: Number(desconto || 0),
    acrescimo: Number(acrescimo || 0),
    subtotalBruto: Number(resultadoMotor.totalVendaBruto || 0),
    debugDescontoFiscal: process.env.CDS_DEBUG_DESCONTO_FISCAL === '1'
  });

  if (!resultadoPagamento.sucesso) {
    return res.status(400).json({
      error: resultadoPagamento.erro,
      tef: resultadoPagamento.tef
    });
  }

  const { distribuicao, resultadoFiscal } = resultadoPagamento;
  const politicaRecebimentos = aplicarPoliticaRecebimentosFluxoVenda({
    body: req.body,
    totalFiscal,
    totalNaoFiscal,
    totalComercial: totalNum,
    pagamentosVenda,
    formaPagamento: formaPagamentoFinal,
    tef,
    recebimentosOrquestrador: resultadoPagamento.recebimentos
  });
  const resultadoStatus = aplicarRegraStatusPagamentoVenda({
    valorFiscal: politicaRecebimentos.valorFiscalStatus,
    valorNaoFiscal: politicaRecebimentos.valorNaoFiscalStatus,
    statusPagamento: resultadoPagamento.statusPagamento,
    recebimentos: politicaRecebimentos.recebimentos
  });
  const { statusPagamento, recebimentos } = resultadoStatus;

  db.serialize(() => {
    iniciarTransacaoVendaComTransferenciaPdv(db, aplicacoesTransferenciaPdv, req.operadorId, (trErr) => {
    if (trErr) {
      return res.status(400).json({
        error: trErr.message || 'Falha ao transferir estoque.'
      });
    }
    db.run(`
      INSERT INTO vendas (
        codigo,
        data_venda,
        cliente_id,
        total,
        desconto,
        forma_pagamento,
        status,
      valor_recebido,
      caixa_sessao_id,
      caixa_id,
      terminal_id,
      cpf_cnpj_nota,
      operador_id,
      valor_fiscal,
      valor_nao_fiscal,
      status_pagamento,
      tef_transacao_id,
      mpfc_politica_snapshot
      )
      VALUES (?, ?, ?, ?, ?, ?, 'concluida', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      codigo,
      data_venda,
      cliente_id || null,
      totalNum,
      desconto || 0,
      formaPagamentoFinal,
      (Number.isFinite(Number(valor_recebido)) && Number(valor_recebido) > 0)
        ? Number(valor_recebido)
        : null,
      req.caixaSessaoId || null,
      req.caixaId,
      req.terminalId || null,
      emitir_fiscal ? cpfCnpjNotaLimpo || null : null,
      req.operadorId,
      totalFiscal,
      totalNaoFiscal,
      statusPagamento,
      resultadoFiscal?.transacoes?.[0] || null,
      snapshotJson
    ], function(err) {
      if (err) {
        db.run('ROLLBACK');
        res.status(500).json(erroPersistenciaVenda(err, 'insert_vendas', {
          caixa_sessao_id: req.caixaSessaoId,
          caixa_id: req.caixaId,
          terminal_id: req.terminalId,
          operador_id: req.operadorId,
          cliente_id
        }));
        return;
      }
      const vendaId = this.lastID;

      gravarRecebimentos(
        vendaId,
        recebimentos,
        (err) => {
          if (err) {
            db.run('ROLLBACK');
            res.status(500).json(erroPersistenciaVenda(err, 'insert_venda_recebimentos', { venda_id: vendaId }));
            return;
          }
        }
      );

      const transacoesTefParaVincular = resultadoFiscal?.transacoes || [];

      if (tef && tef.transacao_id) {
        transacoesTefParaVincular.push(tef.transacao_id);
      }

      pagamentosVenda.forEach((p) => {
        const idTef = p.tef_transacao_id || p.tef?.transacao_id;
        if (idTef) {
          transacoesTefParaVincular.push(idTef);
        }
      });

      [...new Set(transacoesTefParaVincular)].forEach((transacaoId) => {
        db.run(`
          UPDATE tef_transacoes
          SET venda_id = ?
          WHERE id = ?
        `, [
          vendaId,
          transacaoId
        ], (tefErr) => {
          if (tefErr) {
            console.error('Erro ao vincular TEF à venda:', tefErr);
          }
        });
      });

      let itensProcessados = 0;
      distribuicaoItens.forEach(item => {
        const quantidadeFiscal =
          Number(
            item.quantidade_fiscal || 0
          );

        const quantidadeNaoFiscal =
          Number(
            item.quantidade_nao_fiscal || 0
          );

        const itemFiscal =
          quantidadeFiscal > 0
            ? 1
            : 0;

        const precoUnitario =
          Number(
            item.preco_unitario || 0
          );

        const valorFiscal =
          Number(
            (item.valor_fiscal || 0).toFixed(2)
          );

        const valorNaoFiscal =
          Number(
            (item.valor_nao_fiscal || 0).toFixed(2)
          );

        const tipoVenda = normalizarTipoVendaItem(item);

        db.run(`
          INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, preco_unitario_interno, desconto_percentual, desconto_valor, desconto_manual, promocao_id, desconto_atacado, tipo_preco, subtotal, item_fiscal, quantidade_fiscal, quantidade_nao_fiscal, valor_fiscal, valor_nao_fiscal, tipo_venda)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [vendaId, item.produto_id, item.quantidade, item.preco_unitario, item.preco_unitario_interno ?? item.preco_unitario, item.desconto_percentual || 0, item.desconto_valor || 0, Number(item.desconto_manual || 0) === 1 ? 1 : 0, item.promocao_id || null, item.desconto_atacado || 0, item.tipo_preco || 'varejo', item.subtotal, itemFiscal, quantidadeFiscal, quantidadeNaoFiscal, valorFiscal, valorNaoFiscal, tipoVenda], (itemErr) => {
          if (itemErr) {
            db.run('ROLLBACK');
            res.status(500).json(erroPersistenciaVenda(itemErr, 'insert_vendas_itens', {
              venda_id: vendaId,
              produto_id: item.produto_id
            }));
            return;
          }

          const vendaItemId = this.lastID;
          // Usar FEFO para reduzir estoque
          reduzirEstoqueDistribuido(vendaItemId, item.produto_id, item.quantidade_fiscal, item.quantidade_nao_fiscal, (estErr) => {
            if (estErr) {
              db.run('ROLLBACK');
              res.status(500).json(erroPersistenciaVenda(estErr, 'baixa_estoque_fefo', {
                venda_id: vendaId,
                venda_item_id: vendaItemId,
                produto_id: item.produto_id
              }));
              return;
            }
            itensProcessados++;
            if (itensProcessados === itens.length) {
              consumirReservaPedidoAposBaixa(vendaId, () => {
              gravarVendaPagamentos(
                vendaId,
                linhasPagamentoPersistencia(
                  pagamentosVenda,
                  recebimentos,
                  formaPagamentoFinal,
                  total,
                  tef
                )
              );

              const statusFinanceiro = vendaFicaPendente ? 'pendente' : 'recebido';
              const baixadoEm = statusFinanceiro === 'recebido' ? data_venda : null;
              const finalizarResposta = () => {
                db.run('COMMIT');

                responderVendaComFiscal(res, {
                  vendaId,
                  codigo,
                  message: 'Venda registrada com sucesso',
                  emitirFiscal: !!emitir_fiscal,
                  valorFiscal: totalFiscal,
                  valorNaoFiscal: totalNaoFiscal,
                  statusPagamento: statusPagamento,
                  pagamentosTef: pagamentosVenda
                });
              };

              const inserirContasReceberSeNecessario = (callback) => {
                if (formaGeraParcelasFinanceiras(forma_pagamento) && cliente_id) {
                  const valorParcela = totalNum;
                  db.run(`
                    INSERT INTO contas_receber (
                      venda_id, cliente_id, numero_parcela, total_parcelas, valor_parcela,
                      valor_restante, data_vencimento, status
                    ) VALUES (?, ?, ?, ?, ?, ?, date('now', '+30 day'), 'aberto')
                  `, [vendaId, cliente_id, 1, 1, valorParcela, valorParcela], (crErr) => {
                    if (crErr) {
                      db.run('ROLLBACK');
                      res.status(500).json({ error: crErr.message });
                      return;
                    }
                    callback();
                  });
                } else {
                  callback();
                }
              };

              buscarNomeCliente((clienteErr, clienteNome, clienteCpf) => {
                if (clienteErr) {
                  db.run('ROLLBACK');
                  res.status(500).json({ error: clienteErr.message });
                  return;
                }

                db.run(`
                  INSERT INTO financeiro (
                    tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
                    referencia_id, referencia_tipo, status, origem, documento, vencimento,
                    numero_parcela, total_parcelas, venda_id, pessoa_nome, baixado_em
                  ) VALUES ('receita', ?, ?, ?, 'vendas', ?, ?, 'venda', ?, 'venda', ?, ?, 1, 1, ?, ?, ?)
                `, [
                  `Venda ${codigo}`,
                  totalNum,
                  data_venda,
                  forma_pagamento,
                  vendaId,
                  statusFinanceiro,
                  clienteCpf,
                  data_venda,
                  vendaId,
                  clienteNome,
                  baixadoEm
                ], (finErr) => {
                  if (finErr) {
                    db.run('ROLLBACK');
                    res.status(500).json({ error: finErr.message });
                    return;
                  }

                  const aposFinanceiro = () => {
                    if (formaGeraParcelasFinanceiras(forma_pagamento) && cliente_id) {
                      db.run(`
                        UPDATE clientes
                        SET credito_atual = COALESCE(credito_atual, 0) + ?
                        WHERE id = ?
                      `, [totalNum, cliente_id], (credErr) => {
                        if (credErr) {
                          db.run('ROLLBACK');
                          res.status(500).json({ error: credErr.message });
                          return;
                        }

                        finalizarResposta();
                      });
                    } else {
                      finalizarResposta();
                    }
                  };

                  inserirContasReceberSeNecessario(aposFinanceiro);
                });
              });
              });
            }
          });
        });
      });
    });
    });
  });
};

// Venda à vista pode ser sem cliente
if (forma_pagamento === 'credito') {
  if (!cliente_id) {
    res.status(400).json({ error: 'Cliente obrigatório para venda a crédito.' });
    return;
  }
  db.get(
    'SELECT credito_atual, limite_credito FROM clientes WHERE id = ?',
    [cliente_id],
    (err, cliente) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (!cliente) {
        res.status(400).json({ error: 'Cliente não encontrado.' });
        return;
      }
      if (Number(cliente.limite_credito) <= 0) {
        res.status(400).json({ error: 'Configure um limite de crédito maior que zero para este cliente.' });
        return;
      }
      if (Number(cliente.credito_atual) + totalNum > Number(cliente.limite_credito)) {
        res.status(400).json({ error: 'Limite de crédito excedido.' });
        return;
      }
      executarVenda();
    }
  );
} else {
  executarVenda();
}
  });
  });
}

function consultarPagamentoNaoFiscal(req, res) {
const { id } = req.params;

db.get('SELECT * FROM vendas WHERE id = ?', [id], (err, venda) => {
  if (err) {
    res.status(500).json({ error: err.message });
    return;
  }

  if (!venda) {
    res.status(404).json({ error: 'Venda não encontrada.' });
    return;
  }

  db.all(`
    SELECT *
    FROM venda_recebimentos
    WHERE venda_id = ? AND tipo_recebimento = 'nao_fiscal'
    ORDER BY id ASC
  `, [id], (recErr, recebimentos) => {
    if (recErr) {
      res.status(500).json({ error: recErr.message });
      return;
    }

    const saldo = calcularSaldoNaoFiscal(venda, recebimentos);

    res.json({
      venda_id: Number(id),
      codigo: venda.codigo,
      status_pagamento: venda.status_pagamento,
      valor_fiscal: Number(venda.valor_fiscal || 0),
      valor_nao_fiscal: saldo.valorNaoFiscal,
      valor_recebido_nao_fiscal: saldo.valorRecebido,
      saldo_pendente: saldo.saldoPendente,
      recebimentos_nao_fiscal: recebimentos || [],
      aguardando_pagamento: venda.status_pagamento === 'aguardando_nao_fiscal'
    });
  });
});
}

function registrarPagamentoNaoFiscal(req, res) {
const { id } = req.params;
const pagamentosInformados = normalizarPagamentosNaoFiscal(req.body || {});

if (pagamentosInformados.length === 0) {
  res.status(400).json({ error: 'Informe ao menos um pagamento não fiscal.' });
  return;
}

const erroValidacao = validarPagamentosNaoFiscal(pagamentosInformados);
if (erroValidacao) {
  res.status(400).json({ error: erroValidacao });
  return;
}

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
    res.status(400).json({ error: 'Venda não está ativa para recebimento.' });
    return;
  }

  const valorFiscalVenda = Number(venda.valor_fiscal || 0);
  const valorNaoFiscalVenda = Number(venda.valor_nao_fiscal || 0);
  const vendaSomenteNaoFiscal = valorFiscalVenda <= 0 && valorNaoFiscalVenda > 0;

  if (vendaSomenteNaoFiscal) {
    if (venda.status_pagamento === 'quitada') {
      res.json({
        id: Number(id),
        codigo: venda.codigo,
        status_pagamento: 'quitada',
        message: 'Venda não fiscal já finalizada.',
        saldo_pendente: 0,
        fiscal: null,
        idempotente: true
      });
      return;
    }

    db.all(`
      SELECT *
      FROM venda_recebimentos
      WHERE venda_id = ? AND tipo_recebimento = 'nao_fiscal'
    `, [id], (recExistErr, recebimentosExistentes) => {
      if (recExistErr) {
        res.status(500).json({ error: recExistErr.message });
        return;
      }

      const saldoExistente = calcularSaldoNaoFiscal(venda, recebimentosExistentes);
      if (saldoExistente.saldoPendente <= 0 && saldoExistente.valorRecebido > 0) {
        db.run(
          `UPDATE vendas SET status_pagamento = 'quitada' WHERE id = ?`,
          [id],
          (updErr) => {
            if (updErr) {
              res.status(500).json({ error: updErr.message });
              return;
            }
            res.json({
              id: Number(id),
              codigo: venda.codigo,
              status_pagamento: 'quitada',
              message: 'Venda não fiscal já finalizada.',
              saldo_pendente: 0,
              fiscal: null,
              idempotente: true
            });
          }
        );
        return;
      }

      const totalInformado = pagamentosInformados.reduce(
        (acc, p) => acc + Number(p.valor || 0),
        0
      );
      const totalEsperado = Number(venda.total || valorNaoFiscalVenda || 0);

      if (Math.abs(totalInformado - totalEsperado) > 0.01) {
        res.status(400).json({
          error: 'Valor informado não confere com o total da venda não fiscal.',
          saldo_pendente: totalEsperado
        });
        return;
      }

      if (totalInformado - totalEsperado > 0.01) {
        res.status(400).json({
          error: 'Valor recebido maior que o total da venda não fiscal.',
          saldo_pendente: totalEsperado
        });
        return;
      }

      const recebimentos = pagamentosInformados.map((pagamento) => ({
        tipo_recebimento: 'nao_fiscal',
        forma_pagamento: String(pagamento.forma_pagamento).toLowerCase().trim(),
        valor: Number(pagamento.valor || 0),
        tef_transacao_id: pagamento.tef_transacao_id || null,
        nsu: pagamento.nsu || null,
        autorizacao: pagamento.autorizacao || null
      }));

      db.serialize(() => {
        db.run('BEGIN IMMEDIATE');

        gravarRecebimentos(id, recebimentos, (gravarErr) => {
          if (gravarErr) {
            db.run('ROLLBACK');
            res.status(500).json({ error: gravarErr.message });
            return;
          }

          db.run(
            `UPDATE vendas SET status_pagamento = 'quitada' WHERE id = ?`,
            [id],
            (updateErr) => {
              if (updateErr) {
                db.run('ROLLBACK');
                res.status(500).json({ error: updateErr.message });
                return;
              }

              db.run('COMMIT', async (commitErr) => {
                if (commitErr) {
                  res.status(500).json({ error: commitErr.message });
                  return;
                }

                res.json({
                  id: Number(id),
                  codigo: venda.codigo,
                  status_pagamento: 'quitada',
                  message: 'Venda não fiscal finalizada com sucesso.',
                  saldo_pendente: 0,
                  fiscal: null
                });
              });
            }
          );
        });
      });
    });
    return;
  }

  if (valorFiscalVenda <= 0) {
    if (venda.status_pagamento === 'quitada') {
      res.json({
        id: Number(id),
        codigo: venda.codigo,
        status_pagamento: 'quitada',
        message: 'Venda sem itens fiscais já finalizada. NFC-e não necessária.',
        saldo_pendente: 0,
        fiscal: {
          success: true,
          status: 'sem_itens_fiscais',
          message: 'Venda sem itens fiscais. NFC-e não necessária.'
        }
      });
      return;
    }

    res.status(400).json({
      error: 'Venda sem itens fiscais deve ser finalizada em POST /vendas.',
      status_pagamento: venda.status_pagamento
    });
    return;
  }

  if (venda.status_pagamento === 'quitada') {
    res.json({
      id: Number(id),
      codigo: venda.codigo,
      status_pagamento: 'quitada',
      message: 'Pagamento não fiscal já registrado.',
      saldo_pendente: 0,
      fiscal: null,
      idempotente: true
    });
    return;
  }

  if (venda.status_pagamento !== 'aguardando_nao_fiscal') {
    res.status(400).json({
      error: 'Venda não está aguardando pagamento não fiscal.',
      status_pagamento: venda.status_pagamento
    });
    return;
  }

  db.all(`
    SELECT *
    FROM venda_recebimentos
    WHERE venda_id = ? AND tipo_recebimento = 'nao_fiscal'
  `, [id], (recErr, recebimentosAtuais) => {
    if (recErr) {
      res.status(500).json({ error: recErr.message });
      return;
    }

    const saldo = calcularSaldoNaoFiscal(venda, recebimentosAtuais);

    if (saldo.saldoPendente <= 0) {
      db.run(
        `UPDATE vendas SET status_pagamento = 'quitada' WHERE id = ? AND status_pagamento = 'aguardando_nao_fiscal'`,
        [id],
        (updErr) => {
          if (updErr) {
            res.status(500).json({ error: updErr.message });
            return;
          }
          res.json({
            id: Number(id),
            codigo: venda.codigo,
            status_pagamento: 'quitada',
            message: 'Pagamento não fiscal já registrado.',
            saldo_pendente: 0,
            fiscal: null,
            idempotente: true
          });
        }
      );
      return;
    }

    const totalInformado = pagamentosInformados.reduce(
      (acc, p) => acc + Number(p.valor || 0),
      0
    );

    if (totalInformado - saldo.saldoPendente > 0.01) {
      res.status(400).json({
        error: 'Valor recebido maior que o saldo não fiscal pendente.',
        saldo_pendente: saldo.saldoPendente
      });
      return;
    }

    if (Math.abs(totalInformado - saldo.saldoPendente) > 0.01) {
      res.status(400).json({
        error: 'Valor informado não confere com o saldo não fiscal pendente.',
        saldo_pendente: saldo.saldoPendente
      });
      return;
    }

    const recebimentos = pagamentosInformados.map((pagamento) => ({
      tipo_recebimento: 'nao_fiscal',
      forma_pagamento: String(pagamento.forma_pagamento).toLowerCase().trim(),
      valor: Number(pagamento.valor || 0),
      tef_transacao_id: null,
      nsu: pagamento.nsu || null,
      autorizacao: pagamento.autorizacao || null
    }));

    db.serialize(() => {
      db.run('BEGIN IMMEDIATE');

      gravarRecebimentos(id, recebimentos, (gravarErr) => {
        if (gravarErr) {
          db.run('ROLLBACK');
          res.status(500).json({ error: gravarErr.message });
          return;
        }

        const recebimentosNaoFiscalRegistrados = [
          ...(Array.isArray(recebimentosAtuais) ? recebimentosAtuais : []),
          ...recebimentos
        ];
        const statusFinal = resolverStatusPagamentoVenda(
          venda.valor_nao_fiscal,
          recebimentosNaoFiscalRegistrados,
          'quitada',
          { valorFiscal: valorFiscalVenda }
        );

        if (statusFinal !== 'quitada') {
          db.run('ROLLBACK');
          res.status(400).json({
            error: 'Recebimento insuficiente para quitar a venda.',
            status_pagamento: statusFinal,
            saldo_pendente: calcularSaldoNaoFiscal(venda, recebimentosNaoFiscalRegistrados).saldoPendente
          });
          return;
        }

        db.run(
          `UPDATE vendas SET status_pagamento = ? WHERE id = ?`,
          [statusFinal, id],
          (updateErr) => {
            if (updateErr) {
              db.run('ROLLBACK');
              res.status(500).json({ error: updateErr.message });
              return;
            }

            db.run('COMMIT', async (commitErr) => {
              if (commitErr) {
                res.status(500).json({ error: commitErr.message });
                return;
              }

              const fiscal = await emitirFiscalSeSolicitado(id, req.body.emitir_fiscal, venda);

              res.json({
                id: Number(id),
                codigo: venda.codigo,
                status_pagamento: statusFinal,
                message: 'Pagamento não fiscal registrado com sucesso.',
                saldo_pendente: 0,
                fiscal
              });
            });
          }
        );
      });
    });
  });
});
}

module.exports = {
  reduzirEstoqueComFEFO,
  reduzirEstoqueDistribuido,
  atualizarStatusPagamentoVenda,
  flattenRecebimentos,
  gravarRecebimentos,
  linhasPagamentoPersistencia,
  gravarVendaPagamentos,
  processarPagamentosTef,
  calcularSaldoNaoFiscal,
  filtrarRecebimentosNaoFiscal,
  resolverStatusPagamentoVenda,
  aplicarRegraStatusPagamentoVenda,
  normalizarPagamentosNaoFiscal,
  carregarPoliticaFiscalComercialPassiva,
  validarPagamentosNaoFiscal,
  obterTerminalId,
  preCalcularDistribuicao,
  criarVenda,
  consultarPagamentoNaoFiscal,
  registrarPagamentoNaoFiscal,
  // RC3.15.11
  resolverVendaFiscalParaMotor
};
