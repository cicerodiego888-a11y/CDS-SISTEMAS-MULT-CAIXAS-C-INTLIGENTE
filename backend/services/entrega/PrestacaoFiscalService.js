/**
 * Emissão de NFC-e na prestação de contas da Venda para Entrega.
 * Não monta XML, não assina e não transmite: isso permanece no Motor Fiscal oficial.
 */

'use strict';

const { emitirPorVendaId } = require('../fiscal/emissor');
const { vincularNfceTransacoesVenda } = require('../vendas/VendaFiscalService');

function round2(valor) {
  return Math.round((Number(valor || 0) + Number.EPSILON) * 100) / 100;
}

function flagVerdadeira(valor) {
  return valor === true || valor === 1 || valor === '1' || valor === 'true';
}

function flagFalsaExplicita(valor) {
  return valor === false || valor === 0 || valor === '0' || valor === 'false';
}

function normalizarDocumento(valor) {
  const texto = String(valor || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (texto === 'NFCE' || texto === 'NFC_E') return 'NFCE';
  if (texto === 'NAO_FISCAL' || texto === 'NÃO_FISCAL' || texto === 'NAOFISCAL') return 'NAO_FISCAL';
  return '';
}

function vendaJaFinalizada(venda) {
  if (!venda) return false;
  return venda.status_venda === 'FINALIZADA'
    || Number(venda.prestacao_realizada || 0) === 1
    || venda.status === 'concluida';
}

/**
 * Pedido configurado como venda não fiscal nunca emite.
 * NFC-e explícita no corpo, ou já gravada no pedido, marca a emissão.
 */
function pedidoMarcadoParaNfce({ body = {}, venda = {} } = {}) {
  if (normalizarDocumento(venda.documento_solicitado) === 'NAO_FISCAL') return false;
  const docBody = normalizarDocumento(body.documento);
  if (docBody === 'NAO_FISCAL') return false;
  if (docBody === 'NFCE') return true;
  if (flagFalsaExplicita(body.emitir_fiscal)) return false;
  if (flagVerdadeira(body.emitir_fiscal)) return true;
  return normalizarDocumento(venda.documento_solicitado) === 'NFCE';
}

function avaliarRepeticaoPrestacao(venda, body = {}) {
  if (!vendaJaFinalizada(venda)) {
    return { repetida: false, recuperar: false, bloquear: false };
  }
  const recuperar = flagVerdadeira(body.recuperar_fiscal) || flagVerdadeira(body.somente_fiscal);
  if (!recuperar) {
    return { repetida: true, recuperar: false, bloquear: true, codigo: 'PRESTACAO_DUPLICADA' };
  }
  if (normalizarDocumento(venda.documento_solicitado) !== 'NFCE') {
    return { repetida: true, recuperar: false, bloquear: true, codigo: 'VENDA_NAO_FISCAL' };
  }
  return { repetida: true, recuperar: true, bloquear: false };
}

function itemElegivelNfce(item) {
  return Number(item?.quantidade_fiscal || 0) > 0
    && Number(item?.valor_fiscal || 0) > 0;
}

function separarItensFiscais(itens = []) {
  const lista = Array.isArray(itens) ? itens : [];
  const fiscais = [];
  const gerenciais = [];
  for (const item of lista) {
    if (itemElegivelNfce(item)) fiscais.push(item);
    else gerenciais.push(item);
  }
  return {
    fiscais,
    gerenciais,
    valorFiscal: round2(fiscais.reduce((soma, item) => soma + Number(item.valor_fiscal || 0), 0))
  };
}

function pagamentoDeOutraVenda(pagamento, vendaId) {
  const id = Number(vendaId);
  if (!Number.isFinite(id) || id <= 0) return false;
  if (pagamento?.venda_id != null && pagamento.venda_id !== '' && Number(pagamento.venda_id) !== id) {
    return true;
  }
  const tefVenda = pagamento?.tef_venda_id != null
    ? pagamento.tef_venda_id
    : pagamento?.tef?.venda_id;
  if (tefVenda != null && tefVenda !== '' && Number(tefVenda) !== id) return true;
  return false;
}

function filtrarPagamentosDaVenda(pagamentos, vendaId) {
  const lista = Array.isArray(pagamentos) ? pagamentos : [];
  const proprios = [];
  const alheios = [];
  for (const pagamento of lista) {
    if (pagamentoDeOutraVenda(pagamento, vendaId)) alheios.push(pagamento);
    else proprios.push(pagamento);
  }
  return { proprios, alheios };
}

function resumirPagamentosDaVenda(pagamentos, vendaId) {
  const { proprios, alheios } = filtrarPagamentosDaVenda(pagamentos, vendaId);
  if (alheios.length) {
    const err = new Error(
      'Há recebimento de outro pedido nesta prestação. Use apenas os pagamentos deste pedido.'
    );
    err.status = 400;
    err.codigo = 'PAGAMENTO_OUTRA_VENDA';
    throw err;
  }
  return proprios.map((pagamento) => ({
    venda_id: Number(vendaId),
    forma_pagamento: String(pagamento.forma_pagamento || '').toLowerCase(),
    valor: round2(pagamento.valor),
    tipo_recebimento: pagamento.tipo_recebimento || null,
    tef_transacao_id: pagamento.tef_transacao_id || pagamento.tef?.transacao_id || null
  }));
}

async function validarPagamentosDoPedido(pagamentos, vendaId, consultaTef) {
  resumirPagamentosDaVenda(pagamentos, vendaId);
  if (typeof consultaTef !== 'function') return;
  for (const pagamento of pagamentos || []) {
    const tefId = pagamento.tef_transacao_id || pagamento.tef?.transacao_id;
    if (!tefId) continue;
    const row = await consultaTef(tefId);
    if (!row) continue;
    if (row.venda_id != null && row.venda_id !== '' && Number(row.venda_id) !== Number(vendaId)) {
      const err = new Error('A transação de pagamento informada pertence a outro pedido.');
      err.status = 400;
      err.codigo = 'PAGAMENTO_OUTRA_VENDA';
      throw err;
    }
  }
}

function falhaComunicacaoSefaz(status, message) {
  const texto = `${status || ''} ${message || ''}`;
  return status === 'timeout'
    || status === 'erro_transmissao'
    || /timeout|econn|enotfound|eai_again|socket|comunica|sefaz indispon|network/i.test(texto);
}

function classificarResultadoMotorFiscal(fiscal) {
  if (!fiscal) {
    return {
      situacao: 'erro_emissao',
      emissao_concluida: false,
      message: 'Motor Fiscal não retornou resultado.'
    };
  }

  const status = String(fiscal.status || '').toLowerCase();
  const message = fiscal.message || null;

  if (status === 'sem_itens_fiscais') {
    return {
      situacao: 'sem_itens_fiscais',
      emissao_concluida: false,
      message: message || 'Venda sem itens fiscais. NFC-e não necessária.'
    };
  }

  const autorizada = fiscal.success !== false && (
    status === 'autorizada'
    || (fiscal.reused === true && (status === 'autorizada' || status === ''))
  );
  if (autorizada) {
    return {
      situacao: 'autorizada',
      emissao_concluida: true,
      message: message || (fiscal.reused ? 'NFC-e já autorizada. Nenhuma nova emissão foi feita.' : 'NFC-e autorizada.')
    };
  }

  if (falhaComunicacaoSefaz(status, message)) {
    return {
      situacao: 'erro_comunicacao',
      emissao_concluida: false,
      message: message || 'Falha de comunicação com a SEFAZ. A NFC-e não foi autorizada.'
    };
  }

  if (status === 'rejeitada' || status === 'rejeitada_duplicidade' || status === 'erro_validacao') {
    return {
      situacao: 'rejeitada',
      emissao_concluida: false,
      message: message || 'NFC-e rejeitada.'
    };
  }

  if (
    status === 'pendente'
    || status === 'consulta_situacao_pendente'
    || status === 'soap_enviado'
    || status === 'configuracao_pendente'
    || status === 'aguardando_pagamento'
    || status === 'pendente_dados_pagamento'
    || status === 'equipamento_indisponivel'
  ) {
    return {
      situacao: 'pendente',
      emissao_concluida: false,
      message: message || 'Emissão fiscal pendente. A NFC-e não foi autorizada.'
    };
  }

  if (fiscal.success === false) {
    return {
      situacao: 'erro_emissao',
      emissao_concluida: false,
      message: message || 'Falha na emissão da NFC-e.'
    };
  }

  return {
    situacao: 'pendente',
    emissao_concluida: false,
    message: message || `Situação fiscal não conclusiva (${status || 'sem status'}).`
  };
}

async function emitirPeloMotorOficial(vendaId, deps = {}) {
  const emitir = deps.emitirPorVendaId || emitirPorVendaId;
  const vincular = deps.vincularNfceTransacoesVenda || vincularNfceTransacoesVenda;
  let fiscal;
  try {
    fiscal = await emitir(vendaId);
  } catch (error) {
    fiscal = {
      success: false,
      status: falhaComunicacaoSefaz('', error?.message) ? 'erro_transmissao' : 'erro_emissao',
      message: error?.message || 'Falha ao acionar o Motor Fiscal.'
    };
  }

  if (fiscal?.success && fiscal?.numero && (fiscal?.chave || fiscal?.chaveAcesso)) {
    try {
      await vincular(vendaId, {
        ...fiscal,
        chave: fiscal.chave || fiscal.chaveAcesso
      });
    } catch (err) {
      console.error('[PrestacaoFiscal] vínculo TEF', err?.message || err);
    }
  }

  const classe = classificarResultadoMotorFiscal(fiscal);
  return { ...classe, fiscal };
}

async function executarEmissaoSeMarcada({
  vendaId,
  body = {},
  venda = {},
  itens = [],
  pagamentos = [],
  deps = {}
} = {}) {
  const marcado = pedidoMarcadoParaNfce({ body, venda });
  const separacao = separarItensFiscais(itens);

  if (!marcado) {
    return {
      marcado: false,
      documento: 'NAO_FISCAL',
      situacao: 'nao_aplicavel',
      emissao_concluida: false,
      fiscal: null,
      motor_acionado: false,
      valor_fiscal_elegivel: separacao.valorFiscal,
      itens_fiscais: separacao.fiscais.length,
      itens_gerenciais: separacao.gerenciais.length
    };
  }

  let pagamentosDoPedido;
  try {
    pagamentosDoPedido = resumirPagamentosDaVenda(pagamentos, vendaId);
  } catch (error) {
    return {
      marcado: true,
      documento: 'NFCE',
      situacao: 'pendente',
      emissao_concluida: false,
      motor_acionado: false,
      fiscal: {
        success: false,
        status: 'pendente_dados_pagamento',
        message: error.message
      },
      valor_fiscal_elegivel: separacao.valorFiscal,
      itens_fiscais: separacao.fiscais.length,
      itens_gerenciais: separacao.gerenciais.length
    };
  }

  const resultado = await emitirPeloMotorOficial(vendaId, deps);
  return {
    marcado: true,
    documento: 'NFCE',
    situacao: resultado.situacao,
    emissao_concluida: resultado.emissao_concluida,
    fiscal: resultado.fiscal,
    motor_acionado: true,
    valor_fiscal_elegivel: separacao.valorFiscal,
    itens_fiscais: separacao.fiscais.length,
    itens_gerenciais: separacao.gerenciais.length,
    pagamentos: pagamentosDoPedido
  };
}

module.exports = {
  round2,
  normalizarDocumento,
  pedidoMarcadoParaNfce,
  avaliarRepeticaoPrestacao,
  itemElegivelNfce,
  separarItensFiscais,
  pagamentoDeOutraVenda,
  filtrarPagamentosDaVenda,
  resumirPagamentosDaVenda,
  validarPagamentosDoPedido,
  classificarResultadoMotorFiscal,
  emitirPeloMotorOficial,
  executarEmissaoSeMarcada
};
