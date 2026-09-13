/**
 * ORQUESTRADOR DE PAGAMENTOS - ARQUITETURA OFICIAL CDS SISTEMAS
 * 
 * Este é o ÚNICO local onde todas as decisões de pagamento devem existir.
 * O frontend (PDV) NÃO deve tomar nenhuma decisão de fluxo de pagamento.
 * 
 * FLUXO OBRIGATÓRIO:
 * Venda → Motor Fiscal → totais F/NF → MIDP (distribuição de meios) →
 * Orquestrador (TEF/confirmação) → status → NFC-e / Financeiro
 */

const tefManager = require('./tef/TefManager');
const tefContrato = require('./tef/tefContrato');
const tefConfigService = require('./tef/tefConfigService');
const tefFluxoPagamento = require('./tef/tefFluxoPagamento');
const midp = require('./midp');

/**
 * ORQUESTRADOR DE PAGAMENTOS - ARQUITETURA OFICIAL CDS SISTEMAS
 *
 * FLUXO OBRIGATÓRIO (RC8.2+):
 * Venda → Motor F×NF → MPFC (política) → MIDP (distribuição de meios) →
 * Orquestrador (TEF/confirmação) → status → NFC-e / Financeiro
 *
 * Sprint 3.8C — MIDP V1: política PRESERVAR DINHEIRO (via midpAtivo da política MPFC).
 * RC8.2.2 — Orquestrador NÃO lê isMidpAtivado(); recebe midpAtivo do núcleo/MPFC.
 */

/**
 * Processa o fluxo completo de pagamento de uma venda
 * Esta é a entrada principal do orquestrador
 */
async function processarFluxoPagamentoVenda({
  totalFiscal,
  totalNaoFiscal,
  formaPagamento,
  pagamentos,
  tefHabilitado,
  modoConfirmacaoFiscal,
  valorFiscalMaximo,
  preservacaoAplicada,
  midpAtivo: midpAtivoEntrada,
  desconto,
  acrescimo,
  subtotalBruto,
  debugDescontoFiscal
}) {
  // Validações básicas — totalFiscal/totalNaoFiscal DEVEM ser líquidos (RC7.10.1 / FISCAL-4.0.2)
  totalFiscal = Number(totalFiscal || 0);
  totalNaoFiscal = Number(totalNaoFiscal || 0);
  const fiscalMaximo = Number(
    valorFiscalMaximo != null ? valorFiscalMaximo : totalFiscal
  );
  const totalLiquidoEsperado = Math.round((totalFiscal + totalNaoFiscal) * 100) / 100;
  
  // Normalizar pagamentos de entrada (fallback cobre o líquido F+NF)
  const pagamentosEntrada = normalizarPagamentosEntrada(
    pagamentos,
    formaPagamento,
    totalLiquidoEsperado
  );
  
  // RC8.2.2 — midpAtivo vem exclusivamente da política MPFC (núcleo).
  // Migração: omitido → false (não consulta configuracaoService).
  const midpAtivo = midpAtivoEntrada != null ? Boolean(midpAtivoEntrada) : false;
  const resultadoMidp = midp.executar({
    pagamentosComerciais: pagamentosEntrada,
    valorFiscalLiquido: totalFiscal,
    valorFiscalEfetivo: totalFiscal,
    valorNaoFiscal: totalNaoFiscal,
    valorFiscalMaximo: fiscalMaximo,
    preservacaoAplicada: Boolean(preservacaoAplicada),
    midpAtivo
  });
  const distribuicao = {
    recebimentosFiscal: resultadoMidp.recebimentosFiscal,
    recebimentosNaoFiscal: resultadoMidp.recebimentosNaoFiscal,
    saldoFiscal: resultadoMidp.saldoFiscal,
    saldoNaoFiscal: resultadoMidp.saldoNaoFiscal,
    midp: {
      versao: resultadoMidp.versao,
      politica: resultadoMidp.politica,
      auditoria: resultadoMidp.auditoria
    }
  };

  const totalPagamentos = pagamentosEntrada.reduce(
    (s, p) => s + Number(p.valor || 0),
    0
  );
  const pagamentoFiscalRecebido = (distribuicao.recebimentosFiscal || []).reduce(
    (s, p) => s + Number(p.valor || 0),
    0
  );

  logDebugDescontoFiscal({
    ativo: debugDescontoFiscal,
    subtotal: subtotalBruto,
    desconto,
    acrescimo,
    total: totalLiquidoEsperado,
    valorFiscal: totalFiscal,
    valorNaoFiscal: totalNaoFiscal,
    pagamentoFiscal: pagamentoFiscalRecebido,
    pagamentoNaoFiscal: (distribuicao.recebimentosNaoFiscal || []).reduce(
      (s, p) => s + Number(p.valor || 0),
      0
    ),
    valorEsperado: totalFiscal,
    valorRecebido: totalPagamentos,
    saldoFiscal: distribuicao.saldoFiscal,
    saldoNaoFiscal: distribuicao.saldoNaoFiscal
  });
  
  // Validar se o pagamento fiscal é suficiente (tolerância de centavos)
  if (Number(distribuicao.saldoFiscal || 0) > 0.009) {
    logDebugDescontoFiscal({
      ativo: debugDescontoFiscal,
      motivoRejeicao: 'Pagamento fiscal insuficiente.',
      subtotal: subtotalBruto,
      desconto,
      total: totalLiquidoEsperado,
      valorFiscal: totalFiscal,
      valorNaoFiscal: totalNaoFiscal,
      valorEsperado: totalFiscal,
      valorRecebido: totalPagamentos,
      saldoFiscal: distribuicao.saldoFiscal
    });
    return {
      sucesso: false,
      erro: 'Pagamento fiscal insuficiente.',
      distribuicao
    };
  }
  
  // Processar recebimento fiscal (TEF ou Confirmação Manual)
  const resultadoFiscal = await processarRecebimentoFiscal({
    recebimentosFiscal: distribuicao.recebimentosFiscal,
    totalFiscal,
    tefHabilitado,
    modoConfirmacaoFiscal,
    formaPagamento
  });
  
  if (!resultadoFiscal.sucesso) {
    return {
      sucesso: false,
      erro: resultadoFiscal.erro,
      tef: resultadoFiscal.tef,
      distribuicao
    };
  }

  /**
   * Pagamento integral: totais comerciais cobrem F+NF e MIDP zerou saldos.
   * Nesse caso a parcela não fiscal já está confirmada nesta operação
   * (ex.: prestação de entrega / PDV com pagamento completo).
   * Caso contrário, venda mista permanece em 2 etapas (aguardando_nao_fiscal).
   */
  const pagamentoIntegralConfirmado = isPagamentoIntegralConfirmado({
    totalPagamentos,
    totalLiquidoEsperado,
    saldoFiscal: distribuicao.saldoFiscal,
    saldoNaoFiscal: distribuicao.saldoNaoFiscal
  });

  const vendaMista = totalFiscal > 0 && totalNaoFiscal > 0;

  // Somente recebimentos efetivamente confirmados — nunca o plano MIDP “pendente”
  const recebimentosNaoFiscalConfirmados = vendaMista
    ? (pagamentoIntegralConfirmado ? (distribuicao.recebimentosNaoFiscal || []) : [])
    : (distribuicao.recebimentosNaoFiscal || []);

  const statusPagamento = determinarStatusPagamento({
    totalFiscal,
    totalNaoFiscal,
    fiscalProcessado: resultadoFiscal.sucesso,
    recebimentosNaoFiscalConfirmados
  });

  // Montar recebimentos para gravar
  const recebimentosParaGravar = montarRecebimentosParaGravar({
    distribuicao,
    statusPagamento,
    totalFiscal,
    totalNaoFiscal,
    resultadoFiscal
  });
  
  return {
    sucesso: true,
    statusPagamento,
    recebimentos: recebimentosParaGravar,
    distribuicao,
    resultadoFiscal,
    pagamentoIntegralConfirmado,
    proximaAcao: determinarProximaAcao(statusPagamento, totalNaoFiscal)
  };
}

/**
 * Processa o recebimento fiscal (TEF ou Confirmação Manual)
 */
async function processarRecebimentoFiscal({
  recebimentosFiscal,
  totalFiscal,
  tefHabilitado,
  modoConfirmacaoFiscal,
  formaPagamento
}) {
  // Se não há fiscal, não processa nada
  if (totalFiscal <= 0 || !recebimentosFiscal || recebimentosFiscal.length === 0) {
    return { sucesso: true, tipo: 'sem_fiscal' };
  }
  
  // Determinar se deve usar TEF ou confirmação manual
  const deveUsarTef = await deveUsarTEFParaFiscal({
    tefHabilitado,
    modoConfirmacaoFiscal,
    formaPagamento,
    totalFiscal
  });
  
  if (deveUsarTef) {
    return await processarTEFFiscal(recebimentosFiscal);
  } else {
    return await processarConfirmacaoManualFiscal(recebimentosFiscal);
  }
}

/**
 * Processa TEF para recebimentos fiscais
 */
async function processarTEFFiscal(recebimentosFiscal) {
  const tefConfig = await tefConfigService.obterConfiguracao();
  const tefOn = tefFluxoPagamento.parseTefHabilitado(tefConfig.tefHabilitado);
  
  if (!tefOn) {
    return { sucesso: false, erro: 'TEF desabilitado no sistema.' };
  }
  
  // Filtrar apenas recebimentos que exigem TEF
  const recebimentosTEF = recebimentosFiscal.filter(r => 
    tefFluxoPagamento.formaPagamentoUsaTEF(r.forma_pagamento)
  );
  
  if (recebimentosTEF.length === 0) {
    // Não há TEF, considerar como confirmado manualmente
    return { sucesso: true, tipo: 'manual', recebimentos: recebimentosFiscal };
  }
  
  const transacoesAutorizadas = [];
  
  for (const recebimento of recebimentosTEF) {
    // Se já tem transação TEF, apenas valida
    if (recebimento.tef_transacao_id) {
      transacoesAutorizadas.push(recebimento.tef_transacao_id);
      continue;
    }
    
    try {
      const tipoTef = tefFluxoPagamento.normalizarTipoTef(recebimento.forma_pagamento);
      const retornoTEF = await tefManager.autorizar({
        venda_id: null,
        tipo: tipoTef,
        valor: recebimento.valor,
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
        return { 
          sucesso: false, 
          erro: retornoTEF.mensagem || 'Pagamento TEF não aprovado',
          tef: retornoTEF 
        };
      }
      
      if (retornoTEF.transacao_id) {
        transacoesAutorizadas.push(retornoTEF.transacao_id);
        recebimento.tef_transacao_id = retornoTEF.transacao_id;
        recebimento.nsu = retornoTEF.nsu;
        recebimento.autorizacao = retornoTEF.autorizacao;
      }
    } catch (error) {
      console.error('Erro ao autorizar pagamento TEF fiscal:', error);
      // Cancelar transações anteriores
      for (const transacaoId of transacoesAutorizadas) {
        try {
          await tefManager.cancelar(transacaoId, 'Erro no Recebimento A');
        } catch (cancelError) {
          console.error(`Erro ao cancelar transação TEF ${transacaoId}:`, cancelError);
        }
      }
      return { sucesso: false, erro: error.message };
    }
  }
  
  return { 
    sucesso: true, 
    tipo: 'tef', 
    transacoes: transacoesAutorizadas,
    recebimentos: recebimentosFiscal 
  };
}

/**
 * Processa confirmação manual do recebimento fiscal
 */
async function processarConfirmacaoManualFiscal(recebimentosFiscal) {
  // Confirmação manual apenas marca como aprovado
  const recebimentosConfirmados = recebimentosFiscal.map(r => ({
    ...r,
    status: 'aprovado'
  }));
  
  return { 
    sucesso: true, 
    tipo: 'manual', 
    recebimentos: recebimentosConfirmados 
  };
}

/**
 * Determina se deve usar TEF para pagamento fiscal
 */
async function deveUsarTEFParaFiscal({
  tefHabilitado,
  modoConfirmacaoFiscal,
  formaPagamento,
  totalFiscal
}) {
  if (totalFiscal <= 0) return false;
  
  const tefOn = tefFluxoPagamento.parseTefHabilitado(tefHabilitado);
  if (!tefOn) return false;
  
  const modoManual = String(modoConfirmacaoFiscal || 'TEF').toUpperCase() === 'MANUAL';
  if (modoManual) return false;
  
  // Verificar se a forma de pagamento exige TEF
  const formaNormalizada = tefFluxoPagamento.normalizarFormaPagamentoTEF(formaPagamento);
  return tefFluxoPagamento.formaPagamentoUsaTEF(formaNormalizada);
}

/**
 * Determina o status do pagamento.
 * A distribuição matemática NÃO confirma recebimento — apenas recebimentos efetivos.
 */
function determinarStatusPagamento({
  totalFiscal,
  totalNaoFiscal,
  fiscalProcessado,
  recebimentosNaoFiscalConfirmados
}) {
  const temFiscal = totalFiscal > 0;
  const temNaoFiscal = totalNaoFiscal > 0;
  const confirmados = Array.isArray(recebimentosNaoFiscalConfirmados)
    ? recebimentosNaoFiscalConfirmados
    : [];

  const totalConfirmadoNaoFiscal = confirmados.reduce(
    (acc, recebimento) => acc + Number(recebimento.valor || 0),
    0
  );
  const naoFiscalConfirmado =
    confirmados.length > 0
    && Math.abs(totalConfirmadoNaoFiscal - totalNaoFiscal) <= 0.01;

  if (!temFiscal && !temNaoFiscal) {
    return 'quitada';
  }

  // Venda mista: fiscal + não fiscal — 2ª etapa obrigatória
  if (temFiscal && temNaoFiscal) {
    if (!fiscalProcessado) {
      return 'pendente';
    }

    if (naoFiscalConfirmado) {
      return 'quitada';
    }

    return 'aguardando_nao_fiscal';
  }

  // Venda somente não fiscal — pagamento único na criação
  if (!temFiscal && temNaoFiscal) {
    return naoFiscalConfirmado ? 'quitada' : 'pendente';
  }

  // Venda somente fiscal
  if (temFiscal && !temNaoFiscal) {
    return fiscalProcessado ? 'quitada' : 'pendente';
  }

  return 'pendente';
}

/**
 * Pagamento cobre F+NF e MIDP não deixou saldo pendente.
 */
function isPagamentoIntegralConfirmado({
  totalPagamentos,
  totalLiquidoEsperado,
  saldoFiscal,
  saldoNaoFiscal
}) {
  const pagos = Math.round((Number(totalPagamentos || 0) + Number.EPSILON) * 100) / 100;
  const esperado = Math.round((Number(totalLiquidoEsperado || 0) + Number.EPSILON) * 100) / 100;
  return (
    Math.abs(pagos - esperado) <= 0.01
    && Number(saldoFiscal || 0) <= 0.009
    && Number(saldoNaoFiscal || 0) <= 0.009
  );
}

/**
 * Monta os recebimentos para gravar no banco.
 *
 * - aguardando_nao_fiscal (2ª etapa legítima): grava somente fiscais.
 * - quitada / demais: grava fiscais + não fiscais da distribuição MIDP.
 */
function montarRecebimentosParaGravar({
  distribuicao,
  statusPagamento,
  totalFiscal,
  totalNaoFiscal,
  resultadoFiscal
}) {
  const { recebimentosFiscal, recebimentosNaoFiscal } = distribuicao;
  const fiscais = (Array.isArray(recebimentosFiscal) ? recebimentosFiscal : []).map((recebimento) => ({
    ...recebimento,
    tipo_recebimento: 'fiscal',
    status: 'aprovado'
  }));

  if (statusPagamento === 'aguardando_nao_fiscal') {
    return fiscais;
  }

  const naoFiscais = (Array.isArray(recebimentosNaoFiscal) ? recebimentosNaoFiscal : []).map((recebimento) => ({
    ...recebimento,
    tipo_recebimento: 'nao_fiscal',
    status: 'aprovado'
  }));

  return [...fiscais, ...naoFiscais];
}

/**
 * Determina a próxima ação a ser executada
 */
function determinarProximaAcao(statusPagamento, totalNaoFiscal) {
  if (statusPagamento === 'aguardando_nao_fiscal') {
    return 'registrar_pagamento_nao_fiscal';
  }
  
  if (statusPagamento === 'quitada' && totalNaoFiscal > 0) {
    return 'emitir_nfce';
  }
  
  if (statusPagamento === 'quitada') {
    return 'concluida';
  }
  
  return 'aguardando';
}

/**
 * Normaliza os pagamentos de entrada.
 * HOTFIX FISCAL-4.0.2: fallback usa o total líquido F+NF (nunca 0).
 */
function normalizarPagamentosEntrada(pagamentos, formaPagamentoPadrao, totalLiquidoEsperado = 0) {
  if (!Array.isArray(pagamentos) || pagamentos.length === 0) {
    return [{
      forma_pagamento: formaPagamentoPadrao || 'dinheiro',
      valor: Number(totalLiquidoEsperado || 0)
    }];
  }
  
  return pagamentos.map((p) => ({
    ...p,
    forma_pagamento: p.forma_pagamento || formaPagamentoPadrao || 'dinheiro',
    valor: Number(p.valor || 0),
    tef_transacao_id: p.tef_transacao_id || p.tef?.transacao_id || null,
    nsu: p.nsu || p.tef?.nsu || null,
    autorizacao: p.autorizacao || p.tef?.autorizacao || null,
    bandeira: p.bandeira || p.tef?.bandeira || null,
    adquirente: p.adquirente || p.tef?.adquirente || null,
    tef: p.tef || null
  }));
}

/**
 * Log temporário de auditoria desconto × pagamento (só com CDS_DEBUG_DESCONTO_FISCAL=1).
 */
function logDebugDescontoFiscal(payload = {}) {
  const ativoEnv = process.env.CDS_DEBUG_DESCONTO_FISCAL === '1';
  if (!ativoEnv && !payload.ativo) return;
  const {
    ativo,
    ...resto
  } = payload;
  console.log('[DEBUG_DESCONTO_FISCAL]', JSON.stringify({
    subtotal: resto.subtotal != null ? Number(resto.subtotal) : null,
    desconto: resto.desconto != null ? Number(resto.desconto) : null,
    acrescimo: resto.acrescimo != null ? Number(resto.acrescimo) : null,
    total: resto.total != null ? Number(resto.total) : null,
    valorFiscal: resto.valorFiscal != null ? Number(resto.valorFiscal) : null,
    valorNaoFiscal: resto.valorNaoFiscal != null ? Number(resto.valorNaoFiscal) : null,
    pagamentoFiscal: resto.pagamentoFiscal != null ? Number(resto.pagamentoFiscal) : null,
    pagamentoNaoFiscal: resto.pagamentoNaoFiscal != null ? Number(resto.pagamentoNaoFiscal) : null,
    valorEsperado: resto.valorEsperado != null ? Number(resto.valorEsperado) : null,
    valorRecebido: resto.valorRecebido != null ? Number(resto.valorRecebido) : null,
    saldoFiscal: resto.saldoFiscal != null ? Number(resto.saldoFiscal) : null,
    saldoNaoFiscal: resto.saldoNaoFiscal != null ? Number(resto.saldoNaoFiscal) : null,
    motivoRejeicao: resto.motivoRejeicao || null
  }));
}

/**
 * Processa o pagamento não fiscal (segunda etapa do fluxo)
 */
async function processarPagamentoNaoFiscal({
  vendaId,
  valorNaoFiscal,
  pagamentosInformados
}) {
  const totalInformado = pagamentosInformados.reduce(
    (acc, p) => acc + Number(p.valor || 0),
    0
  );
  
  if (Math.abs(totalInformado - valorNaoFiscal) > 0.01) {
    return {
      sucesso: false,
      erro: 'Valor informado não confere com o Recebimento B pendente.',
      saldo_pendente: valorNaoFiscal
    };
  }
  
  const recebimentos = pagamentosInformados.map(pagamento => ({
    tipo_recebimento: 'nao_fiscal',
    forma_pagamento: String(pagamento.forma_pagamento).toLowerCase().trim(),
    valor: Number(pagamento.valor || 0),
    tef_transacao_id: null,
    nsu: pagamento.nsu || null,
    autorizacao: pagamento.autorizacao || null,
    status: 'aprovado'
  }));
  
  return {
    sucesso: true,
    recebimentos,
    statusPagamento: 'quitada'
  };
}

module.exports = {
  processarFluxoPagamentoVenda,
  processarPagamentoNaoFiscal,
  determinarStatusPagamento,
  montarRecebimentosParaGravar,
  isPagamentoIntegralConfirmado,
  normalizarPagamentosEntrada,
  logDebugDescontoFiscal
};
