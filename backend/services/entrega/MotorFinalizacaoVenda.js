/**
 * MotorFinalizacaoVenda — Sprint 3
 *
 * ÚNICO responsável por concluir Venda para Entrega na Prestação de Contas.
 * Não altera o fluxo de balcão (criarVenda).
 *
 * Fluxo:
 * 1 Atualizar pagamento
 * 2 Confirmar / converter reserva
 * 3 Baixar estoque definitivamente
 * 4 Remover reserva
 * 5 Atualizar financeiro
 * 6 Atualizar caixa (via venda concluída + sessão)
 * 7 Emitir NFC-e (quando escolhida)
 * 8 Comprovante prestação
 * 9 Auditoria
 * 10 Status venda FINALIZADA / entrega CONCLUIDA
 */

'use strict';

const db = require('../../database');
const configService = require('../configuracaoService');
const OrquestradorPagamento = require('../OrquestradorPagamento');
const tefConfigService = require('../tef/tefConfigService');
const tefFluxoPagamento = require('../tef/tefFluxoPagamento');
const VendaFinanceiroService = require('../vendas/VendaFinanceiroService');
const VendaPagamentoService = require('../vendas/VendaPagamentoService');
const {
  avaliarRepeticaoPrestacao,
  executarEmissaoSeMarcada,
  normalizarDocumento,
  pedidoMarcadoParaNfce,
  validarPagamentosDoPedido
} = require('./PrestacaoFiscalService');
const { consumirReservasDaVenda } = require('../estoque/EstoqueConsumoReserva');
const { liberarReservasDaVenda } = require('../estoque/EstoqueReservaService');
const { StatusVenda, StatusEntrega, TipoVenda } = require('./enums');
const {
  EntregaAuditoriaEventos,
  montarPayloadAuditoriaEntrega
} = require('./EntregaAuditoria');
const { gravarAuditoria } = require('../auditoria');
const { montarHtmlComprovantePrestacao } = require('./ComprovantePrestacao');

const { agoraLocalBrasil, validarSomaPagamentosVenda } = VendaFinanceiroService;
const {
  gravarRecebimentos,
  aplicarRegraStatusPagamentoVenda,
  linhasPagamentoPersistencia
} = VendaPagamentoService;

/** Lock em memória — impede duas prestações simultâneas da mesma venda neste processo */
const prestacoesEmAndamento = new Set();

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

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function begin() {
  return run('BEGIN IMMEDIATE');
}

function commit() {
  return run('COMMIT');
}

async function rollback() {
  try {
    await run('ROLLBACK');
  } catch (_) { /* ignore */ }
}

function gravarRecebimentosAsync(vendaId, recebimentos) {
  return new Promise((resolve, reject) => {
    gravarRecebimentos(vendaId, recebimentos, (err) => (err ? reject(err) : resolve()));
  });
}

function audit(acao, vendaId, detalhes, ctx = {}) {
  return gravarAuditoria(
    montarPayloadAuditoriaEntrega({ acao, vendaId, detalhes, ...ctx })
  ).catch((e) => console.error('[MotorFinalizacaoVenda] auditoria', e));
}

async function gravarSituacaoFiscalEntrega(vendaId, documento, situacao) {
  try {
    await run(
      `UPDATE vendas SET documento_solicitado = ?, status_fiscal_entrega = ? WHERE id = ?`,
      [documento, situacao, vendaId]
    );
  } catch (err) {
    if (!/no such column/i.test(String(err && err.message))) throw err;
    console.error('[MotorFinalizacaoVenda] situação fiscal não persistida', err.message);
  }
}

async function consultarTefDaVenda(tefId) {
  try {
    return await get(
      `SELECT id, venda_id, valor, status FROM tef_transacoes WHERE id = ?`,
      [tefId]
    );
  } catch (err) {
    if (/no such table/i.test(String(err && err.message))) return null;
    throw err;
  }
}

async function carregarItensEPagamentosDaVenda(vendaId) {
  const itens = await all(
    `SELECT id, produto_id, quantidade, quantidade_fiscal, quantidade_nao_fiscal,
            valor_fiscal, valor_nao_fiscal, subtotal
     FROM vendas_itens WHERE venda_id = ?`,
    [vendaId]
  );
  const pagamentos = await all(
    `SELECT vp.venda_id, vp.forma_pagamento, vp.valor, vp.tipo_recebimento,
            vp.tef_transacao_id, tt.venda_id AS tef_venda_id
     FROM venda_pagamentos vp
     LEFT JOIN tef_transacoes tt ON tt.id = vp.tef_transacao_id
     WHERE vp.venda_id = ?
     ORDER BY vp.id`,
    [vendaId]
  );
  return { itens, pagamentos };
}

function mensagemPrestacao(emissao) {
  if (!emissao || emissao.documento !== 'NFCE') {
    return 'Prestação de contas finalizada. Venda concluída.';
  }
  if (emissao.emissao_concluida) {
    return emissao.fiscal?.reused
      ? 'Prestação finalizada. NFC-e já autorizada; nenhuma segunda nota foi emitida.'
      : 'Prestação finalizada. NFC-e autorizada pelo Motor Fiscal.';
  }
  return emissao.fiscal?.message
    || 'Prestação operacional finalizada. A NFC-e ainda não foi autorizada.';
}

async function executarEmissaoDaPrestacao({
  vendaId,
  body,
  venda,
  contextoAuditoria,
  deps = {}
}) {
  const carregado = await carregarItensEPagamentosDaVenda(vendaId);
  const emissao = await executarEmissaoSeMarcada({
    vendaId,
    body,
    venda,
    itens: carregado.itens,
    pagamentos: carregado.pagamentos,
    deps
  });
  await gravarSituacaoFiscalEntrega(vendaId, emissao.documento, emissao.situacao);

  if (emissao.emissao_concluida) {
    await audit(EntregaAuditoriaEventos.NFCE_EMITIDA, vendaId, {
      success: true,
      status: emissao.fiscal?.status || 'autorizada',
      situacao: emissao.situacao,
      numero: emissao.fiscal?.numero || null,
      chave: emissao.fiscal?.chaveAcesso || emissao.fiscal?.chave || null,
      protocolo: emissao.fiscal?.protocolo || emissao.fiscal?.soap?.protocolo || null,
      reused: emissao.fiscal?.reused === true
    }, contextoAuditoria);
  } else if (emissao.marcado) {
    await audit(EntregaAuditoriaEventos.NFCE_RESULTADO, vendaId, {
      success: false,
      status: emissao.fiscal?.status || null,
      situacao: emissao.situacao,
      message: emissao.fiscal?.message || null,
      motor_acionado: emissao.motor_acionado === true
    }, contextoAuditoria);
  }

  return emissao;
}

async function recuperarEmissaoFiscalPrestacao({
  venda,
  vendaId,
  body,
  contextoAuditoria,
  deps
}) {
  const emissao = await executarEmissaoDaPrestacao({
    vendaId,
    body: { ...body, documento: 'NFCE', emitir_fiscal: true },
    venda,
    contextoAuditoria,
    deps
  });
  return {
    success: true,
    recuperacao_fiscal: true,
    message: mensagemPrestacao(emissao),
    id: Number(vendaId),
    venda_id: Number(vendaId),
    codigo: venda.codigo,
    status_venda: venda.status_venda,
    status_entrega: venda.status_entrega,
    documento: emissao.documento,
    situacao_fiscal: emissao.situacao,
    emissao_concluida: emissao.emissao_concluida,
    fiscal: emissao.fiscal,
    valor_fiscal_elegivel: emissao.valor_fiscal_elegivel,
    motor_acionado: emissao.motor_acionado
  };
}

/**
 * Finaliza venda ENTREGA via prestação de contas.
 * @param {object} params
 * @param {number} params.vendaId
 * @param {object} params.body — pagamentos, forma_pagamento, emitir_fiscal, etc.
 * @param {object} params.req — contexto HTTP (caixa, user)
 * @param {object} params.contextoAuditoria
 */
async function finalizarPrestacao({ vendaId, body = {}, req = {}, contextoAuditoria = {}, deps = {} }) {
  if (!configService.recursoHabilitado('vendasEntrega')) {
    const err = new Error('Módulo Vendas para Entrega desabilitado.');
    err.status = 404;
    err.codigo = 'MODULO_VENDAS_ENTREGA_DESABILITADO';
    throw err;
  }

  const vendaIdNum = Number(vendaId);
  if (prestacoesEmAndamento.has(vendaIdNum)) {
    const err = new Error('Prestação já em andamento para esta venda.');
    err.status = 409;
    err.codigo = 'PRESTACAO_EM_ANDAMENTO';
    throw err;
  }
  prestacoesEmAndamento.add(vendaIdNum);

  try {
    return await _finalizarPrestacaoInterno({ vendaId, body, req, contextoAuditoria, deps });
  } finally {
    prestacoesEmAndamento.delete(vendaIdNum);
  }
}

async function _finalizarPrestacaoInterno({ vendaId, body = {}, req = {}, contextoAuditoria = {}, deps = {} }) {
  if (!configService.recursoHabilitado('vendasEntrega')) {
    const err = new Error('Módulo Vendas para Entrega desabilitado.');
    err.status = 404;
    err.codigo = 'MODULO_VENDAS_ENTREGA_DESABILITADO';
    throw err;
  }

  const venda = await get(
    `
      SELECT v.*,
             COALESCE(v.nome_cliente_entrega, c.nome) AS cliente_nome,
             COALESCE(v.cpf_cnpj_cliente_entrega, c.cpf_cnpj) AS cliente_cpf
      FROM vendas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE v.id = ? AND v.tipo_venda = ?
    `,
    [vendaId, TipoVenda.ENTREGA]
  );

  if (!venda) {
    const err = new Error('Venda para entrega não encontrada.');
    err.status = 404;
    throw err;
  }

  if (Number(venda.cancelada || 0) === 1 || venda.status_venda === StatusVenda.CANCELADA) {
    const err = new Error('Venda cancelada não pode ser prestada.');
    err.status = 400;
    throw err;
  }

  const repeticao = avaliarRepeticaoPrestacao(venda, body);
  if (repeticao.bloquear) {
    const err = new Error(
      repeticao.codigo === 'VENDA_NAO_FISCAL'
        ? 'Esta venda foi configurada como não fiscal e não emite NFC-e.'
        : 'Esta venda já foi finalizada na prestação de contas.'
    );
    err.status = repeticao.codigo === 'PRESTACAO_DUPLICADA' ? 409 : 400;
    err.codigo = repeticao.codigo;
    throw err;
  }
  if (repeticao.recuperar) {
    return recuperarEmissaoFiscalPrestacao({
      venda,
      vendaId,
      body,
      contextoAuditoria,
      deps
    });
  }

  const statusEntregaOk = [
    StatusEntrega.AGUARDANDO_ENTREGA,
    StatusEntrega.EM_ENTREGA,
    StatusEntrega.AGUARDANDO_PRESTACAO
  ].includes(String(venda.status_entrega || '').toUpperCase());

  if (!statusEntregaOk) {
    const err = new Error(
      `Status de entrega inválido para prestação: ${venda.status_entrega}`
    );
    err.status = 400;
    throw err;
  }

  await audit(EntregaAuditoriaEventos.PRESTACAO_INICIADA, vendaId, {
    pagamento_previsto: venda.pagamento_previsto
  }, contextoAuditoria);

  const itens = await all(
    `SELECT * FROM vendas_itens WHERE venda_id = ?`,
    [vendaId]
  );
  if (!itens.length) {
    const err = new Error('Venda sem itens.');
    err.status = 400;
    throw err;
  }

  const totalNum = Number(venda.total || 0);
  const totalFiscal = Number(venda.valor_fiscal || 0);
  const totalNaoFiscal = Number(venda.valor_nao_fiscal || 0);

  const pagamentosVenda = Array.isArray(body.pagamentos) ? body.pagamentos : [];
  let formaPagamentoFinal = String(body.forma_pagamento || '').toLowerCase().trim();
  if (pagamentosVenda.length > 1) {
    formaPagamentoFinal = 'misto';
  }
  if (!formaPagamentoFinal && pagamentosVenda.length === 1) {
    formaPagamentoFinal = String(pagamentosVenda[0].forma_pagamento || '').toLowerCase();
  }
  if (!formaPagamentoFinal) {
    formaPagamentoFinal = String(venda.pagamento_previsto || 'dinheiro').toLowerCase();
  }

  // Normalizar aliases de pagamento previsto → formas PDV
  const aliasForma = {
    pix: 'pix',
    dinheiro: 'dinheiro',
    debito: 'cartao_debito',
    cartao_debito: 'cartao_debito',
    credito: 'cartao_credito',
    cartao_credito: 'cartao_credito',
    misto: 'misto',
    fiado: 'prazo',
    prazo: 'prazo',
    voucher: 'voucher',
    nao_informado: 'dinheiro'
  };
  formaPagamentoFinal = aliasForma[formaPagamentoFinal] || formaPagamentoFinal;

  if (normalizarDocumento(venda.documento_solicitado) === 'NAO_FISCAL') {
    body = { ...body, documento: 'NAO_FISCAL', emitir_fiscal: false };
  }

  const pagamentosNormalizados = (pagamentosVenda.length
    ? pagamentosVenda
    : [{ forma_pagamento: formaPagamentoFinal, valor: totalNum }]
  ).map((p) => {
    const forma = String(p.forma_pagamento || '').toLowerCase();
    return {
      ...p,
      forma_pagamento: aliasForma[forma] || forma,
      valor: Number(p.valor || 0)
    };
  });

  await validarPagamentosDoPedido(pagamentosNormalizados, vendaId, consultarTefDaVenda);

  const erroSoma = validarSomaPagamentosVenda(pagamentosNormalizados, totalNum, {
    valor_fiscal: totalFiscal,
    valor_nao_fiscal: totalNaoFiscal
  });
  if (erroSoma) {
    const err = new Error(erroSoma);
    err.status = 400;
    throw err;
  }

  const pagamentoPrevisto = String(venda.pagamento_previsto || '').toUpperCase();
  const pagamentoRecebidoLabel = pagamentosNormalizados.length > 1
    ? 'MISTO'
    : String(pagamentosNormalizados[0].forma_pagamento || '').toUpperCase();

  if (pagamentoPrevisto && pagamentoPrevisto !== 'NAO_INFORMADO'
    && pagamentoRecebidoLabel
    && !pagamentoRecebidoLabel.includes(pagamentoPrevisto)
    && pagamentoPrevisto !== pagamentoRecebidoLabel) {
    await audit(EntregaAuditoriaEventos.PAGAMENTO_ALTERADO, vendaId, {
      previsto: pagamentoPrevisto,
      recebido: pagamentoRecebidoLabel,
      pagamentos: pagamentosNormalizados
    }, contextoAuditoria);
  }

  let tefHabilitado = false;
  try {
    const tefConfig = await tefConfigService.obterConfiguracao();
    tefHabilitado = tefFluxoPagamento.parseTefHabilitado(tefConfig.tefHabilitado);
  } catch (_) {
    tefHabilitado = false;
  }

  const modoConfirmacaoFiscal = configService.getModoConfirmacaoFiscal() || 'TEF';

  const resultadoPagamento = await OrquestradorPagamento.processarFluxoPagamentoVenda({
    totalFiscal,
    totalNaoFiscal,
    formaPagamento: formaPagamentoFinal,
    pagamentos: pagamentosNormalizados,
    tefHabilitado,
    modoConfirmacaoFiscal
  });

  if (!resultadoPagamento.sucesso) {
    const err = new Error(resultadoPagamento.erro || 'Falha no processamento do pagamento.');
    err.status = 400;
    err.tef = resultadoPagamento.tef;
    throw err;
  }

  const resultadoStatus = aplicarRegraStatusPagamentoVenda({
    valorFiscal: totalFiscal,
    valorNaoFiscal: totalNaoFiscal,
    statusPagamento: resultadoPagamento.statusPagamento,
    recebimentos: resultadoPagamento.recebimentos
  });
  const { statusPagamento, recebimentos } = resultadoStatus;

  const valorRecebidoPrevisto = pagamentosNormalizados.reduce(
    (s, p) => s + Number(p.valor || 0),
    0
  );
  // Defesa: pagamento integral confirmado NÃO pode permanecer aguardando_nao_fiscal
  if (
    totalFiscal > 0
    && totalNaoFiscal > 0
    && Math.abs(valorRecebidoPrevisto - totalNum) <= 0.01
    && statusPagamento === 'aguardando_nao_fiscal'
  ) {
    const err = new Error(
      'Inconsistência de pagamento: valor integral confirmado, mas status aguardando_nao_fiscal.'
    );
    err.status = 500;
    err.codigo = 'PAGAMENTO_INTEGRAL_INCONSISTENTE';
    throw err;
  }

  await audit(EntregaAuditoriaEventos.PAGAMENTO_CONFIRMADO, vendaId, {
    forma_pagamento: formaPagamentoFinal,
    status_pagamento: statusPagamento,
    pagamentos: pagamentosNormalizados
  }, contextoAuditoria);

  const emitirFiscal = pedidoMarcadoParaNfce({ body, venda });
  const documento = emitirFiscal ? 'NFCE' : 'NAO_FISCAL';
  const valorRecebido = pagamentosNormalizados.reduce((s, p) => s + Number(p.valor || 0), 0);
  const dataMov = agoraLocalBrasil().slice(0, 10);
  const operadorId = req.user?.id || req.operadorId || null;
  const formaPendente = formaPagamentoFinal === 'prazo';
  const statusFinanceiro = formaPendente ? 'pendente' : 'recebido';
  const baixadoEm = statusFinanceiro === 'recebido' ? dataMov : null;

  const trocoDevolvido = Number(body.troco_devolvido != null ? body.troco_devolvido : 0) || 0;
  const maquinetaConfirmada = body.maquineta_confirmada === true
    || body.maquineta_confirmada === 1
    || body.maquineta_confirmada === '1';
  const trocoConfirmado = body.troco_confirmado === true
    || body.troco_confirmado === 1
    || body.troco_confirmado === '1';

  try {
    await begin();

    // Lock otimista — bloqueia prestação duplicada / concorrência
    const locked = await get(
      `
        SELECT id, status, status_venda, prestacao_realizada, cancelada
        FROM vendas
        WHERE id = ? AND tipo_venda = ?
      `,
      [vendaId, TipoVenda.ENTREGA]
    );

    if (!locked
      || Number(locked.cancelada || 0) === 1
      || locked.status_venda === StatusVenda.CANCELADA) {
      await rollback();
      const err = new Error('Venda cancelada ou indisponível para prestação.');
      err.status = 400;
      err.codigo = 'PRESTACAO_INDISPONIVEL';
      throw err;
    }

    if (
      locked.status_venda === StatusVenda.FINALIZADA
      || Number(locked.prestacao_realizada || 0) === 1
      || locked.status === 'concluida'
    ) {
      await rollback();
      const err = new Error('Esta venda já foi finalizada (prestação duplicada bloqueada).');
      err.status = 409;
      err.codigo = 'PRESTACAO_DUPLICADA';
      throw err;
    }

    const claim = await run(
      `
        UPDATE vendas
        SET prestacao_realizada = 1
        WHERE id = ?
          AND COALESCE(prestacao_realizada, 0) = 0
          AND COALESCE(cancelada, 0) = 0
          AND COALESCE(status_venda, 'ABERTA') = 'ABERTA'
      `,
      [vendaId]
    );

    if (!claim.changes) {
      await rollback();
      const err = new Error('Prestação já em andamento ou concluída por outro operador.');
      err.status = 409;
      err.codigo = 'PRESTACAO_CONCORRENTE';
      throw err;
    }

    // 1–4: converter reserva → baixa
    const consumo = await consumirReservasDaVenda(vendaId);
    await audit(EntregaAuditoriaEventos.RESERVA_CONVERTIDA, vendaId, consumo, contextoAuditoria);
    await audit(EntregaAuditoriaEventos.ESTOQUE_BAIXADO, vendaId, consumo, contextoAuditoria);

    // Pagamentos — persiste o split F/NF do MIDP (não o payload comercial único)
    await run(`DELETE FROM venda_pagamentos WHERE venda_id = ?`, [vendaId]);
    await run(`DELETE FROM venda_recebimentos WHERE venda_id = ?`, [vendaId]);
    const linhasPag = linhasPagamentoPersistencia(
      pagamentosNormalizados,
      recebimentos,
      formaPagamentoFinal,
      totalNum,
      null
    );
    for (const p of linhasPag) {
      await run(
        `
          INSERT INTO venda_pagamentos (
            venda_id, forma_pagamento, valor, tipo_recebimento,
            tef_transacao_id, tef_nsu, tef_autorizacao,
            tef_bandeira, tef_adquirente,
            tef_comprovante_cliente, tef_comprovante_estabelecimento
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
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
        ]
      );
    }

    await gravarRecebimentosAsync(vendaId, recebimentos);

    // Financeiro
    await run(`DELETE FROM financeiro WHERE venda_id = ? AND origem = 'venda'`, [vendaId]);
    await run(
      `
        INSERT INTO financeiro (
          tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
          referencia_id, referencia_tipo, status, origem, documento, vencimento,
          numero_parcela, total_parcelas, venda_id, pessoa_nome, baixado_em
        ) VALUES ('receita', ?, ?, ?, 'vendas', ?, ?, 'venda', ?, 'venda', ?, ?, 1, 1, ?, ?, ?)
      `,
      [
        `Venda entrega ${venda.codigo || vendaId}`,
        totalNum,
        dataMov,
        formaPagamentoFinal,
        vendaId,
        statusFinanceiro,
        venda.cliente_cpf || null,
        dataMov,
        vendaId,
        venda.cliente_nome || null,
        baixadoEm
      ]
    );

    if (formaPagamentoFinal === 'prazo' && venda.cliente_id) {
      await run(
        `
          INSERT INTO contas_receber (
            venda_id, cliente_id, numero_parcela, total_parcelas, valor_parcela,
            valor_restante, data_vencimento, status
          ) VALUES (?, ?, 1, 1, ?, ?, date('now', '+30 day'), 'aberto')
        `,
        [vendaId, venda.cliente_id, totalNum, totalNum]
      );
      await run(
        `UPDATE clientes SET credito_atual = COALESCE(credito_atual, 0) + ? WHERE id = ?`,
        [totalNum, venda.cliente_id]
      );
    }

    await audit(EntregaAuditoriaEventos.FINANCEIRO_GERADO, vendaId, {
      status: statusFinanceiro,
      valor: totalNum
    }, contextoAuditoria);

    await audit(EntregaAuditoriaEventos.CAIXA_ATUALIZADO, vendaId, {
      caixa_sessao_id: venda.caixa_sessao_id,
      caixa_id: venda.caixa_id
    }, contextoAuditoria);

    // Status finais
    await run(
      `
        UPDATE vendas SET
          status = 'concluida',
          status_venda = ?,
          status_entrega = ?,
          forma_pagamento = ?,
          status_pagamento = ?,
          valor_recebido = ?,
          prestacao_realizada = 1,
          prestado_por = ?,
          prestado_em = CURRENT_TIMESTAMP,
          documento_solicitado = ?,
          status_fiscal_entrega = ?,
          cancelada = 0
        WHERE id = ?
      `,
      [
        StatusVenda.FINALIZADA,
        StatusEntrega.CONCLUIDA,
        formaPagamentoFinal,
        statusPagamento,
        valorRecebido,
        operadorId,
        documento,
        emitirFiscal ? 'processando' : 'nao_aplicavel',
        vendaId
      ]
    );

    await commit();
  } catch (txErr) {
    await rollback();
    throw txErr;
  }

  await audit(EntregaAuditoriaEventos.VENDA_FINALIZADA, vendaId, {
    status_venda: StatusVenda.FINALIZADA
  }, contextoAuditoria);
  await audit(EntregaAuditoriaEventos.ENTREGA_CONCLUIDA, vendaId, {
    status_entrega: StatusEntrega.CONCLUIDA
  }, contextoAuditoria);
  await audit(EntregaAuditoriaEventos.PRESTACAO_REALIZADA, vendaId, {
    documento,
    forma_pagamento: formaPagamentoFinal
  }, contextoAuditoria);

  // NFC-e fora da transação: o Motor Fiscal oficial confirma autorização, rejeição ou pendência.
  let emissao;
  try {
    const vendaFiscal = await get(`SELECT * FROM vendas WHERE id = ?`, [vendaId]);
    emissao = await executarEmissaoDaPrestacao({
      vendaId,
      body: { ...body, documento, emitir_fiscal: emitirFiscal },
      venda: { ...(vendaFiscal || venda), documento_solicitado: documento },
      contextoAuditoria,
      deps
    });
  } catch (errorFiscal) {
    console.error('[MotorFinalizacaoVenda] emissão NFC-e', errorFiscal);
    emissao = {
      documento,
      situacao: 'erro_emissao',
      emissao_concluida: false,
      motor_acionado: emitirFiscal,
      valor_fiscal_elegivel: totalFiscal,
      fiscal: {
        success: false,
        status: 'erro_emissao',
        message: errorFiscal.message || 'Falha ao acionar o Motor Fiscal.'
      }
    };
    if (emitirFiscal) {
      await gravarSituacaoFiscalEntrega(vendaId, 'NFCE', 'erro_emissao');
    }
  }
  const fiscal = emissao.fiscal;

  let papelMm = 80;
  try {
    const papelRow = await get(
      `SELECT valor FROM configuracoes WHERE chave = ?`,
      ['fiscal_danfe_largura_mm']
    );
    if (Number(papelRow && papelRow.valor) === 58) papelMm = 58;
  } catch (_) { /* bobina padrão 80mm */ }

  const { obterEmpresaCupom } = require('./EntregaService');
  const empresaCadastrada = await obterEmpresaCupom();
  const comprovanteHtml = montarHtmlComprovantePrestacao({
    empresa: body.empresa_nome || body.empresa?.nome || empresaCadastrada.nome,
    cnpj: body.empresa_cnpj || body.empresa?.cnpj || empresaCadastrada.cnpj,
    papel_mm: papelMm,
    pedido: vendaId,
    codigo: venda.codigo,
    cliente: venda.nome_cliente_entrega || venda.cliente_nome || 'Consumidor',
    nome_cliente_entrega: venda.nome_cliente_entrega || venda.cliente_nome,
    cpf_cnpj_cliente_entrega: venda.cpf_cnpj_cliente_entrega || venda.cliente_cpf,
    telefone_entrega: venda.telefone_entrega,
    email_cliente_entrega: venda.email_cliente_entrega,
    cep_entrega: venda.cep_entrega,
    endereco_entrega: venda.endereco_entrega,
    numero_entrega: venda.numero_entrega,
    complemento_entrega: venda.complemento_entrega,
    bairro_entrega: venda.bairro_entrega,
    cidade_entrega: venda.cidade_entrega,
    uf_entrega: venda.uf_entrega,
    referencia_entrega: venda.referencia_entrega,
    observacao_entrega: venda.observacao_entrega,
    valor: totalNum,
    pagamento_previsto: venda.pagamento_previsto,
    pagamento_recebido: pagamentoRecebidoLabel,
    formas_pagamento: pagamentosNormalizados,
    documento,
    troco_levado: Number(venda.troco_para || 0),
    troco_devolvido: trocoDevolvido,
    maquineta: Number(venda.leva_maquineta || 0) === 1 ? 'SIM' : 'NÃO',
    maquineta_confirmada: maquinetaConfirmada,
    troco_confirmado: trocoConfirmado,
    entregador: venda.entregador,
    operador: req.user?.nome || req.user?.username || operadorId
  });

  await audit(EntregaAuditoriaEventos.COMPROVANTE_PRESTACAO_IMPRESSO, vendaId, {
    tipo: 'comprovante_prestacao'
  }, contextoAuditoria);

  return {
    success: true,
    message: mensagemPrestacao(emissao),
    id: Number(vendaId),
    venda_id: Number(vendaId),
    codigo: venda.codigo,
    status_venda: StatusVenda.FINALIZADA,
    status_entrega: StatusEntrega.CONCLUIDA,
    status_pagamento: statusPagamento,
    documento: emissao.documento || documento,
    situacao_fiscal: emissao.situacao,
    emissao_concluida: emissao.emissao_concluida === true,
    motor_acionado: emissao.motor_acionado === true,
    valor_fiscal_elegivel: emissao.valor_fiscal_elegivel,
    forma_pagamento: formaPagamentoFinal,
    valor_fiscal: totalFiscal,
    valor_nao_fiscal: totalNaoFiscal,
    fiscal,
    comprovante_html: comprovanteHtml,
    estoque_baixado: true,
    reserva_consumida: true,
    financeiro_gerado: true
  };
}

/**
 * Cancela entrega: libera reserva, sem financeiro/NFC-e/caixa.
 */
async function cancelarEntregaMotor({ vendaId, motivo = null, contextoAuditoria = {} }) {
  if (!configService.recursoHabilitado('vendasEntrega')) {
    const err = new Error('Módulo Vendas para Entrega desabilitado.');
    err.status = 404;
    throw err;
  }

  const venda = await get(
    `SELECT * FROM vendas WHERE id = ? AND tipo_venda = ?`,
    [vendaId, TipoVenda.ENTREGA]
  );
  if (!venda) {
    const err = new Error('Venda para entrega não encontrada.');
    err.status = 404;
    throw err;
  }

  if (venda.status_venda === StatusVenda.FINALIZADA || Number(venda.prestacao_realizada || 0) === 1) {
    const err = new Error('Não é possível cancelar uma venda já finalizada.');
    err.status = 400;
    throw err;
  }

  if (venda.status_venda === StatusVenda.CANCELADA || Number(venda.cancelada || 0) === 1) {
    const err = new Error('Entrega já está cancelada.');
    err.status = 400;
    throw err;
  }

  try {
    await begin();

    const locked = await get(
      `SELECT id, status, status_venda, prestacao_realizada, cancelada FROM vendas WHERE id = ? AND tipo_venda = ?`,
      [vendaId, TipoVenda.ENTREGA]
    );

    if (!locked || Number(locked.cancelada || 0) === 1 || locked.status_venda === StatusVenda.CANCELADA) {
      await rollback();
      const err = new Error('Venda cancelada ou indisponível.');
      err.status = 400;
      throw err;
    }

    if (
      locked.status_venda === StatusVenda.FINALIZADA
      || Number(locked.prestacao_realizada || 0) === 1
      || locked.status === 'concluida'
    ) {
      await rollback();
      const err = new Error('Não é possível cancelar uma venda já finalizada.');
      err.status = 400;
      err.codigo = 'VENDA_JA_FINALIZADA';
      throw err;
    }

    await liberarReservasDaVenda(vendaId);
    const cancelResult = await run(
      `
        UPDATE vendas SET
          status = 'cancelada',
          status_venda = ?,
          status_entrega = ?,
          cancelada = 1,
          data_cancelamento = CURRENT_TIMESTAMP
        WHERE id = ?
          AND COALESCE(prestacao_realizada, 0) = 0
          AND COALESCE(cancelada, 0) = 0
          AND COALESCE(status_venda, 'ABERTA') = 'ABERTA'
      `,
      [StatusVenda.CANCELADA, StatusEntrega.CANCELADA, vendaId]
    );

    if (!cancelResult.changes) {
      await rollback();
      const err = new Error('Cancelamento concorrente bloqueado — venda já alterada.');
      err.status = 409;
      throw err;
    }

    await commit();
  } catch (e) {
    await rollback();
    throw e;
  }

  await audit(EntregaAuditoriaEventos.ENTREGA_CANCELADA, vendaId, {
    motivo: motivo || null,
    reserva_liberada: true
  }, contextoAuditoria);

  await audit(EntregaAuditoriaEventos.MUDANCA_STATUS, vendaId, {
    status_venda: StatusVenda.CANCELADA,
    status_entrega: StatusEntrega.CANCELADA
  }, contextoAuditoria);

  return {
    success: true,
    message: 'Entrega cancelada. Reserva liberada.',
    venda_id: Number(vendaId),
    status_venda: StatusVenda.CANCELADA,
    status_entrega: StatusEntrega.CANCELADA,
    estoque_liberado: true,
    financeiro_gerado: false,
    fiscal: null
  };
}

module.exports = {
  finalizarPrestacao,
  cancelarEntregaMotor,
  MotorFinalizacaoVenda: {
    finalizar: finalizarPrestacao,
    cancelar: cancelarEntregaMotor
  }
};
