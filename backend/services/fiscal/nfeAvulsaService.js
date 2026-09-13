/**
 * RC3.16 — NF-e Avulsa (porta fiscal → Venda origem NF_AVULSA → Motor Fiscal).
 *
 * Não cria emissor/XML/estoque/financeiro novos.
 * Reutiliza: VendaApplicationService → VendaPagamentoService → emitirNfePorVendaId.
 */

'use strict';

const configService = require('../configuracaoService');
const { VendaOrigin } = require('../vendas/VendaOrigin');
const { criarVendaContract } = require('../vendas/VendaContract');
const { criarVendaContext } = require('../vendas/VendaContext');
const VendaApplicationService = require('../vendas/VendaApplicationService');
const { emitirNfePorVendaId } = require('./nfeEmissorVenda');
const {
  extrairDadosNfe,
  parseModoOperacionalFiscalFlag,
  modoOperacionalFiscalAtivo
} = require('../faturamento/FaturamentoService');

const MSG_F12_OFF =
  'O modo operacional atual não permite emissão de documentos fiscais.';

function assertModuloNfe() {
  if (!configService.recursoHabilitado('nfe')) {
    const err = new Error('Módulo NF-e desabilitado.');
    err.statusCode = 404;
    err.codigo = 'MODULO_NFE_DESABILITADO';
    throw err;
  }
}

function normalizarItens(itensBody) {
  if (!Array.isArray(itensBody) || !itensBody.length) {
    const err = new Error('Informe ao menos um produto.');
    err.statusCode = 400;
    throw err;
  }
  return itensBody.map((item) => {
    const produtoId = Number(item.produto_id);
    const quantidade = Number(item.quantidade);
    const preco = Number(item.preco_unitario != null ? item.preco_unitario : item.preco);
    const descPct = Number(item.desconto_percentual || 0);
    if (!Number.isInteger(produtoId) || produtoId <= 0) {
      const err = new Error('Produto inválido na lista.');
      err.statusCode = 400;
      throw err;
    }
    if (!(quantidade > 0) || !(preco >= 0)) {
      const err = new Error('Quantidade e preço devem ser válidos.');
      err.statusCode = 400;
      throw err;
    }
    const subtotal = item.subtotal != null
      ? Number(item.subtotal)
      : Number((quantidade * preco * (1 - descPct / 100)).toFixed(2));
    return {
      produto_id: produtoId,
      quantidade,
      preco_unitario: preco,
      desconto_percentual: descPct,
      subtotal,
      tipo_venda: item.tipo_venda || 'PESO',
      promocao_id: null,
      desconto_atacado: 0,
      tipo_preco: 'varejo'
    };
  });
}

function montarPayloadVendaAvulsa(body = {}) {
  const itens = normalizarItens(body.itens);
  const subtotalItens = itens.reduce((s, i) => s + Number(i.subtotal || 0), 0);
  const dadosNfe = extrairDadosNfe(body, {});
  const descontoCabeca = Number(body.desconto != null ? body.desconto : dadosNfe.desconto || 0);
  const totalAjustado = Number(
    (subtotalItens + dadosNfe.frete + dadosNfe.acrescimo - descontoCabeca).toFixed(2)
  );

  const forma = String(
    body.forma_pagamento
    || (Array.isArray(body.pagamentos) && (body.pagamentos[0]?.forma_pagamento || body.pagamentos[0]?.forma))
    || 'dinheiro'
  ).toLowerCase().trim();

  let pagamentos;
  if (Array.isArray(body.pagamentos) && body.pagamentos.length > 0) {
    pagamentos = body.pagamentos.map((p) => ({
      ...p,
      forma_pagamento: String(p.forma_pagamento || p.forma || forma || 'dinheiro').toLowerCase().trim(),
      valor: Number(p.valor != null ? p.valor : 0)
    }));
  } else {
    pagamentos = [{ forma_pagamento: forma, valor: totalAjustado > 0 ? totalAjustado : subtotalItens }];
  }

    const parcelas = Math.max(1, parseInt(body.parcelas || body.numero_parcelas || 1, 10) || 1);

  return {
    origem: VendaOrigin.NF_AVULSA,
    tipo_venda: 'BALCAO',
    pedido_id: null,
    cliente_id: body.cliente_id != null ? Number(body.cliente_id) : null,
    itens,
    total: totalAjustado > 0 ? totalAjustado : subtotalItens,
    desconto: descontoCabeca,
    acrescimo: dadosNfe.acrescimo,
    forma_pagamento: forma,
    pagamentos,
    parcelas,
    primeiro_vencimento: body.primeiro_vencimento || null,
    intervalo_parcelas: body.intervalo_parcelas || body.intervalo || 'mensal',
    valor_recebido: body.valor_recebido != null
      ? Number(body.valor_recebido)
      : (totalAjustado > 0 ? totalAjustado : subtotalItens),
    emitir_fiscal: false,
    // RC3.15.11 — Avulsa sempre precisa de parcela fiscal para NF-e; NFC-e permanece off.
    venda_fiscal: true,
    observacao: dadosNfe.observacoes || body.observacoes || body.observacao || body.observacao_pagamento || null,
    dadosNfe
  };
}

function invocarNucleo(contract, context, reqBase) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = {
      ...reqBase,
      body: contract.payload,
      vendaContract: contract,
      vendaContext: context
    };

    const finish = (statusCode, body) => {
      if (settled) return;
      settled = true;
      if (statusCode >= 400) {
        const err = new Error(body?.error || body?.mensagem || body?.message || 'Falha ao criar venda.');
        err.statusCode = statusCode;
        err.body = body;
        reject(err);
        return;
      }
      resolve(body);
    };

    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        finish(this.statusCode || 200, body);
        return this;
      }
    };

    try {
      const ret = VendaApplicationService.criarVendaComContexto(contract, context, req, res);
      if (ret && typeof ret.then === 'function') {
        ret.then(() => {
          if (!settled) finish(res.statusCode || 200, { success: true });
        }).catch(reject);
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Nova NF-e Avulsa: digita → Venda(NF_AVULSA) → financeiro/estoque → emitirNfePorVendaId.
 * @param {object} body
 * @param {object} reqHttp
 */
async function emitirNfeAvulsa(body = {}, reqHttp = {}) {
  // RC3.16.11 — TRACE
  const { traceNfe } = require('./nfeTrace');
  traceNfe('emitirNfeAvulsa', {
    cliente_id: body.cliente_id || null,
    itens: Array.isArray(body.itens) ? body.itens.length : null
  });

  assertModuloNfe();

  const modoOperacionalFiscal = await modoOperacionalFiscalAtivo();
  if (!modoOperacionalFiscal) {
    const err = new Error(MSG_F12_OFF);
    err.statusCode = 403;
    err.codigo = 'MODO_OPERACIONAL_NAO_FISCAL';
    throw err;
  }

  const montado = montarPayloadVendaAvulsa(body);
  const { dadosNfe, ...payload } = montado;

  const contract = criarVendaContract({ body: payload });
  const context = criarVendaContext(reqHttp, { origem: VendaOrigin.NF_AVULSA });

  const vendaResposta = await invocarNucleo(contract, context, {
    user: reqHttp.user,
    operadorId: reqHttp.operadorId || reqHttp.user?.id || null,
    terminalId: reqHttp.terminalId || null,
    caixaId: reqHttp.caixaId || null,
    caixaSessaoId: reqHttp.caixaSessaoId || null
  });

  const vendaId = Number(vendaResposta?.id || vendaResposta?.venda_id || 0);
  if (!Number.isInteger(vendaId) || vendaId <= 0) {
    const err = new Error('Núcleo não retornou venda válida.');
    err.statusCode = 500;
    err.body = vendaResposta;
    throw err;
  }

  const db = require('../../database');
  try {
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE vendas SET origem = ?, pedido_id = NULL WHERE id = ?`,
        [VendaOrigin.NF_AVULSA, vendaId],
        (err) => (err ? reject(err) : resolve())
      );
    });
  } catch (linkErr) {
    console.warn('[NF-e Avulsa] origem:', linkErr.message);
  }

  const nfe = await emitirNfePorVendaId(vendaId, { dadosNfe, pedidoId: null });
  traceNfe('emitirNfeAvulsa→emitirNfePorVendaId_retorno', {
    vendaId,
    status: nfe?.status,
    cStat: nfe?.cStat
  });

  return {
    success: true,
    origem: VendaOrigin.NF_AVULSA,
    venda_concluida: true,
    modo_operacional_fiscal: true,
    emitir_nfe: true,
    venda: vendaResposta,
    venda_id: vendaId,
    nfe,
    message: nfe?.success
      ? 'Venda gerada e NF-e autorizada.'
      : `Venda gerada. NF-e: ${nfe?.message || nfe?.status || 'pendente'}`
  };
}

module.exports = {
  emitirNfeAvulsa,
  montarPayloadVendaAvulsa,
  MSG_F12_OFF,
  parseModoOperacionalFiscalFlag,
  modoOperacionalFiscalAtivo
};
