/**
 * Reconciliação financeira por venda — Fechamento de Caixa V2.
 * Separa vendido, recebido e pendente. Parcial legítimo não é inconsistência.
 */
'use strict';

const {
  arred2,
  quaseIgual,
  somar,
  subtrair,
  TOLERANCIA
} = require('../financeiro/politicaMonetaria');

const STATUS = Object.freeze({
  OK: 'OK',
  PARCIALMENTE_RECEBIDA: 'PARCIALMENTE_RECEBIDA',
  PENDENTE: 'PENDENTE',
  INCONSISTENTE: 'INCONSISTENTE',
  EXCEDENTE: 'EXCEDENTE'
});

function n(valor) {
  const v = Number(valor);
  return Number.isFinite(v) ? v : 0;
}

function normalizarForma(forma) {
  return String(forma || '').toLowerCase().trim();
}

function ehFormaPrazo(forma) {
  const f = normalizarForma(forma);
  return (
    f === 'prazo'
    || f === 'fiado'
    || f === 'crediario'
    || f === 'parcelado'
    || f === 'boleto'
    || f === 'boleto_bancario'
  );
}

function ehRecebimentoConfirmado(status) {
  if (status == null || status === '') return true;
  const s = String(status).toLowerCase().trim();
  return ['aprovado', 'confirmado', 'quitado', 'pago', 'recebido'].includes(s);
}

function ehStatusPendenteRecebimento(status) {
  const s = String(status || '').toLowerCase().trim();
  if (!s) return false;
  return (
    s.includes('aguardando')
    || s === 'parcial'
    || s === 'parcialmente_recebida'
    || s === 'pendente'
    || s === 'em_aberto'
  );
}

function totalOficialVenda(venda) {
  return arred2(venda && venda.total);
}

function identidadeFiscalVenda(venda) {
  const total = totalOficialVenda(venda);
  const fiscal = arred2(venda && venda.valor_fiscal);
  const naoFiscal = arred2(venda && venda.valor_nao_fiscal);
  const soma = somar(fiscal, naoFiscal);
  const temDistribuicao = fiscal > 0 || naoFiscal > 0 || soma > 0;
  if (!temDistribuicao) {
    return {
      ok: true,
      legado: true,
      total,
      valor_fiscal: fiscal,
      valor_nao_fiscal: naoFiscal,
      soma
    };
  }
  return {
    ok: quaseIgual(soma, total, 0),
    legado: false,
    total,
    valor_fiscal: fiscal,
    valor_nao_fiscal: naoFiscal,
    soma
  };
}

function resolverLinhasRecebidasVenda(venda, pagamentosLinhas = [], recebimentosLinhas = []) {
  const recebimentos = (Array.isArray(recebimentosLinhas) ? recebimentosLinhas : [])
    .filter((r) => ehRecebimentoConfirmado(r.status));
  const pagamentos = Array.isArray(pagamentosLinhas) ? pagamentosLinhas : [];
  const prazo = ehFormaPrazo(venda && venda.forma_pagamento)
    || ehFormaPrazo(venda && venda.pagamento_previsto);

  if (recebimentos.length > 0) {
    return recebimentos.map((r) => ({
      forma_pagamento: r.forma_pagamento,
      valor: arred2(r.valor),
      tef_transacao_id: r.tef_transacao_id || null,
      tef_nsu: r.tef_nsu || r.nsu || null,
      tef_autorizacao: r.tef_autorizacao || r.autorizacao || null,
      tipo_recebimento: r.tipo_recebimento || null,
      fonte: 'venda_recebimentos'
    }));
  }

  if (prazo) {
    return [];
  }

  if (pagamentos.length > 0) {
    return pagamentos.map((p) => ({
      forma_pagamento: p.forma_pagamento,
      valor: arred2(p.valor),
      tef_transacao_id: p.tef_transacao_id || null,
      tef_nsu: p.tef_nsu || null,
      tef_autorizacao: p.tef_autorizacao || null,
      tipo_recebimento: p.tipo_recebimento || null,
      fonte: 'venda_pagamentos'
    }));
  }

  if (ehStatusPendenteRecebimento(venda && venda.status_pagamento)) {
    return [];
  }

  return [{
    forma_pagamento: (venda && venda.forma_pagamento) || 'outros',
    valor: totalOficialVenda(venda),
    tef_transacao_id: null,
    tef_nsu: null,
    tef_autorizacao: null,
    tipo_recebimento: null,
    fonte: 'fallback_venda'
  }];
}

function classificarTipoRecebimento(tipo) {
  const t = String(tipo || '').toLowerCase().trim();
  if (t === 'fiscal') return 'fiscal';
  if (t === 'nao_fiscal' || t === 'nao-fiscal' || t === 'nao fiscal') return 'nao_fiscal';
  return 'indefinido';
}

function reconciliarVenda(venda, pagamentosLinhas = [], recebimentosLinhas = []) {
  const identidade = identidadeFiscalVenda(venda);
  const totalOficial = identidade.total;
  const linhas = resolverLinhasRecebidasVenda(venda, pagamentosLinhas, recebimentosLinhas);
  const recebidoTotal = arred2(linhas.reduce((acc, linha) => acc + n(linha.valor), 0));

  let recebidoFiscal = 0;
  let recebidoNaoFiscal = 0;
  for (const linha of linhas) {
    const tipo = classificarTipoRecebimento(linha.tipo_recebimento);
    if (tipo === 'fiscal') recebidoFiscal = somar(recebidoFiscal, linha.valor);
    else if (tipo === 'nao_fiscal') recebidoNaoFiscal = somar(recebidoNaoFiscal, linha.valor);
  }
  if (recebidoFiscal === 0 && recebidoNaoFiscal === 0 && recebidoTotal > 0) {
    recebidoFiscal = identidade.valor_fiscal > 0 && quaseIgual(recebidoTotal, identidade.valor_fiscal)
      ? recebidoTotal
      : 0;
    recebidoNaoFiscal = identidade.valor_nao_fiscal > 0 && quaseIgual(recebidoTotal, identidade.valor_nao_fiscal)
      ? recebidoTotal
      : 0;
  }

  const pendenteTotal = Math.max(0, arred2(subtrair(totalOficial, recebidoTotal)));
  const pendenteFiscal = Math.max(0, arred2(subtrair(identidade.valor_fiscal, recebidoFiscal)));
  const pendenteNaoFiscal = Math.max(0, arred2(subtrair(identidade.valor_nao_fiscal, recebidoNaoFiscal)));
  const statusPagamento = String(venda && venda.status_pagamento || '').toLowerCase().trim();

  let status = STATUS.OK;
  let tipoInconsistencia = null;
  let mensagem = null;

  const fiscalMaisNf = identidade.soma;
  let divergencia = arred2(subtrair(fiscalMaisNf, totalOficial));

  if (!identidade.ok) {
    status = STATUS.INCONSISTENTE;
    tipoInconsistencia = 'inconsistencia_venda';
    mensagem = `Total da venda não confere com a distribuição fiscal/não fiscal. Oficial: ${totalOficial.toFixed(2)} | Fiscal+NF: ${identidade.soma.toFixed(2)}`;
  } else if (recebidoTotal > totalOficial + TOLERANCIA) {
    status = STATUS.EXCEDENTE;
    tipoInconsistencia = 'recebimento_excedente';
    mensagem = `Recebido (${recebidoTotal.toFixed(2)}) maior que a venda (${totalOficial.toFixed(2)}).`;
  } else if (statusPagamento === 'quitada' && !quaseIgual(recebidoTotal, totalOficial)) {
    status = STATUS.INCONSISTENTE;
    tipoInconsistencia = 'inconsistencia_recebimento';
    mensagem = `Venda quitada, mas o recebimento não fecha. Oficial: ${totalOficial.toFixed(2)} | Recebido: ${recebidoTotal.toFixed(2)}`;
  } else if (quaseIgual(recebidoTotal, 0) && totalOficial > TOLERANCIA) {
    status = STATUS.PENDENTE;
  } else if (recebidoTotal + TOLERANCIA < totalOficial) {
    status = STATUS.PARCIALMENTE_RECEBIDA;
  }

  if (identidade.ok || identidade.legado) {
    divergencia = arred2(subtrair(recebidoTotal, totalOficial));
  }

  return {
    venda_id: venda && venda.id,
    codigo: venda && venda.codigo || null,
    total_oficial: totalOficial,
    valor_fiscal: identidade.valor_fiscal,
    valor_nao_fiscal: identidade.valor_nao_fiscal,
    fiscal_mais_nao_fiscal: fiscalMaisNf,
    divergencia,
    recebido_fiscal: arred2(recebidoFiscal),
    recebido_nao_fiscal: arred2(recebidoNaoFiscal),
    recebido_total: recebidoTotal,
    pendente_fiscal: pendenteFiscal,
    pendente_nao_fiscal: pendenteNaoFiscal,
    pendente_total: pendenteTotal,
    status_pagamento: statusPagamento || null,
    status_reconciliacao: status,
    tipo_inconsistencia: tipoInconsistencia,
    mensagem,
    linhas,
    identidade_ok: identidade.ok,
    identidade_legado: identidade.legado === true
  };
}

function bloqueiaFechamento(rec) {
  const status = rec && rec.status_reconciliacao;
  return status === STATUS.INCONSISTENTE || status === STATUS.EXCEDENTE;
}

function detalheInconsistencia(rec) {
  return {
    venda_id: rec.venda_id,
    codigo: rec.codigo || null,
    oficial: rec.total_oficial,
    fiscal_mais_nao_fiscal: rec.fiscal_mais_nao_fiscal != null
      ? rec.fiscal_mais_nao_fiscal
      : arred2(n(rec.valor_fiscal) + n(rec.valor_nao_fiscal)),
    recebido_total: rec.recebido_total,
    divergencia: rec.divergencia != null
      ? arred2(rec.divergencia)
      : arred2(n(rec.fiscal_mais_nao_fiscal != null
        ? rec.fiscal_mais_nao_fiscal
        : (n(rec.valor_fiscal) + n(rec.valor_nao_fiscal))) - n(rec.total_oficial)),
    status: rec.status_reconciliacao,
    tipo_inconsistencia: rec.tipo_inconsistencia || null,
    mensagem: rec.mensagem || null
  };
}

function resumirInconsistencias(vendas) {
  const lista = (Array.isArray(vendas) ? vendas : []).filter(bloqueiaFechamento);
  const detalhes = lista.map(detalheInconsistencia);
  const saldoLiquido = arred2(detalhes.reduce((acc, item) => acc + n(item.divergencia), 0));
  return {
    quantidade_inconsistencias: detalhes.length,
    valor_divergencia: arred2(Math.abs(saldoLiquido)),
    saldo_liquido: saldoLiquido,
    detalhes
  };
}

function montarErroBloqueioReconciliacao(vendas, extras = {}) {
  const resumo = resumirInconsistencias(vendas);
  if (!resumo.quantidade_inconsistencias) return null;
  const err = new Error(
    `Não é possível finalizar o caixa enquanto existirem vendas inconsistentes. `
    + `${resumo.quantidade_inconsistencias} venda(s) inconsistente(s). `
    + `Diferença total: ${resumo.valor_divergencia.toFixed(2)}. `
    + `Saldo líquido: ${resumo.saldo_liquido.toFixed(2)}.`
  );
  err.codigo = 'FECHAMENTO_BLOQUEADO_RECONCILIACAO';
  err.quantidade_inconsistencias = resumo.quantidade_inconsistencias;
  err.valor_divergencia = resumo.valor_divergencia;
  err.saldo_liquido = resumo.saldo_liquido;
  err.detalhes = resumo.detalhes;
  err.inconsistencias = listaOuVendas(vendas);
  err.divergencias = extras.divergencias || [];
  return err;
}

function listaOuVendas(vendas) {
  return (Array.isArray(vendas) ? vendas : []).filter(bloqueiaFechamento);
}

module.exports = {
  STATUS,
  n,
  normalizarForma,
  ehFormaPrazo,
  ehRecebimentoConfirmado,
  ehStatusPendenteRecebimento,
  totalOficialVenda,
  identidadeFiscalVenda,
  resolverLinhasRecebidasVenda,
  reconciliarVenda,
  bloqueiaFechamento,
  detalheInconsistencia,
  resumirInconsistencias,
  montarErroBloqueioReconciliacao
};
