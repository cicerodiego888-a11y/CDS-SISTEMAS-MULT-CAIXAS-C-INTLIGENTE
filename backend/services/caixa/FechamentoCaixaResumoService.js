/**
 * RC — Fechamento de Caixa: fonte única de consolidação financeira.
 * Dinheiro recebido por venda (sem dupla contagem):
 *   1) venda_recebimentos (fiscal + não fiscal) quando existir
 *   2) senão venda_pagamentos (legado / parcela fiscal isolada)
 *   3) senão fallback pela forma_pagamento da venda
 * Entrega não prestada (reserva_entrega) = a receber, não recebido.
 */

'use strict';

const {
  getExprValorVenda,
  getExprValorVendaFiscal,
  getExprValorVendaNaoFiscal
} = require('../reportFiscalHelpers');

function obterDbPadrao() {
  return require('../../database');
}

const TOLERANCIA = 0.02;

function n(valor) {
  const v = Number(valor);
  return Number.isFinite(v) ? v : 0;
}

function arred2(valor) {
  return Math.round((n(valor) + Number.EPSILON) * 100) / 100;
}

function normalizarForma(forma) {
  return String(forma || '').toLowerCase().trim();
}

/**
 * Mapeia forma (+ flags TEF) para bucket do fechamento.
 * TEF identificado não duplica em débito/crédito.
 */
function resolverBucketPagamento(formaPagamento, pagamento = {}) {
  const forma = normalizarForma(formaPagamento);
  const temTef = Boolean(
    pagamento.tef_transacao_id
    || pagamento.tef_nsu
    || pagamento.tef_autorizacao
    || forma === 'tef'
    || forma === 'pix_tef'
    || forma === 'cartao'
  );

  if (forma === 'dinheiro') return 'dinheiro';
  if (forma === 'pix' && !temTef) return 'pix';
  if (forma === 'prazo' || forma === 'fiado' || forma === 'crediario') return 'prazo';

  if (temTef) return 'tef';

  if (forma === 'cartao_debito' || forma === 'debito') return 'debito';
  if (forma === 'cartao_credito' || forma === 'credito') return 'credito';
  if (forma === 'pix') return 'pix';

  return 'outros';
}

function bucketsVazios() {
  return {
    dinheiro: 0,
    pix: 0,
    debito: 0,
    credito: 0,
    prazo: 0,
    tef: 0,
    outros: 0
  };
}

function contadoresVazios() {
  return {
    dinheiro: 0,
    pix: 0,
    debito: 0,
    credito: 0,
    prazo: 0,
    tef: 0,
    outros: 0
  };
}

function somaBuckets(pagamentos) {
  return arred2(
    n(pagamentos.dinheiro)
    + n(pagamentos.pix)
    + n(pagamentos.debito)
    + n(pagamentos.credito)
    + n(pagamentos.prazo)
    + n(pagamentos.tef)
    + n(pagamentos.outros)
  );
}

function isVendaCancelada(venda) {
  const status = normalizarForma(venda.status);
  const statusVenda = String(venda.status_venda || '').toUpperCase();
  return (
    status === 'cancelada'
    || Number(venda.cancelada || 0) === 1
    || statusVenda === 'CANCELADA'
  );
}

function isEntregaPendente(venda) {
  if (isVendaCancelada(venda)) return false;
  const status = normalizarForma(venda.status);
  const tipo = String(venda.tipo_venda || '').toUpperCase();
  const prestada = Number(venda.prestacao_realizada || 0) === 1;
  if (prestada) return false;
  if (status === 'reserva_entrega') return true;
  if (tipo === 'ENTREGA' && !prestada) return true;
  return false;
}

function valorVendaLiquido(venda) {
  const fiscal = n(venda.valor_fiscal);
  const naoFiscal = n(venda.valor_nao_fiscal);
  const soma = fiscal + naoFiscal;
  if (soma > 0) return arred2(soma);
  return arred2(venda.total);
}

/**
 * Fonte lógica do dinheiro recebido na venda.
 * Nunca soma venda_pagamentos + venda_recebimentos (evita dupla contagem fiscal).
 */
function resolverLinhasRecebidasVenda(venda, pagamentosLinhas = [], recebimentosLinhas = []) {
  const recebimentos = Array.isArray(recebimentosLinhas) ? recebimentosLinhas : [];
  const pagamentos = Array.isArray(pagamentosLinhas) ? pagamentosLinhas : [];

  if (recebimentos.length > 0) {
    return recebimentos.map((r) => ({
      forma_pagamento: r.forma_pagamento,
      valor: n(r.valor),
      tef_transacao_id: r.tef_transacao_id || null,
      tef_nsu: r.tef_nsu || r.nsu || null,
      tef_autorizacao: r.tef_autorizacao || r.autorizacao || null,
      tipo_recebimento: r.tipo_recebimento || null,
      fonte: 'venda_recebimentos'
    }));
  }

  if (pagamentos.length > 0) {
    return pagamentos.map((p) => ({
      forma_pagamento: p.forma_pagamento,
      valor: n(p.valor),
      tef_transacao_id: p.tef_transacao_id || null,
      tef_nsu: p.tef_nsu || null,
      tef_autorizacao: p.tef_autorizacao || null,
      tipo_recebimento: p.tipo_recebimento || null,
      fonte: 'venda_pagamentos'
    }));
  }

  return [{
    forma_pagamento: venda.forma_pagamento || 'outros',
    valor: valorVendaLiquido(venda),
    tef_transacao_id: null,
    tef_nsu: null,
    tef_autorizacao: null,
    tipo_recebimento: null,
    fonte: 'fallback_venda'
  }];
}

function filtrarVendasSessaoSql() {
  return `
    (
      (v.status IS NULL OR LOWER(TRIM(v.status)) != 'cancelada')
      AND COALESCE(v.cancelada, 0) = 0
      AND (v.status_venda IS NULL OR UPPER(TRIM(v.status_venda)) != 'CANCELADA')
    )
  `;
}

function promisifyAll(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function promisifyGet(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

/**
 * Consolida sessão de caixa. Aceita db injetável (testes).
 * @param {object} caixa — turno (tabela caixa)
 * @param {object} options
 * @param {number} options.sessaoId
 * @param {number|null} [options.valorInformado]
 * @param {object} [options.meta] — nomes de terminal/operador/empresa
 * @param {object} [options.db]
 */
async function consolidarSessaoCaixa(caixa, options = {}) {
  const database = options.db || obterDbPadrao();
  const sessaoId = options.sessaoId;
  const valorInformado = options.valorInformado != null ? n(options.valorInformado) : null;
  const meta = options.meta || {};

  if (!caixa) {
    throw new Error('Caixa (turno) é obrigatório para consolidação.');
  }
  if (!sessaoId) {
    return montarResumoVazio(caixa, meta);
  }

  const vendas = await promisifyAll(
    database,
    `
      SELECT
        v.id,
        v.codigo,
        v.total,
        COALESCE(v.desconto, 0) AS desconto,
        v.forma_pagamento,
        v.status,
        v.status_venda,
        v.cancelada,
        v.tipo_venda,
        v.prestacao_realizada,
        v.pagamento_previsto,
        v.valor_fiscal,
        v.valor_nao_fiscal,
        v.caixa_sessao_id
      FROM vendas v
      WHERE v.caixa_sessao_id = ?
        AND ${filtrarVendasSessaoSql()}
      ORDER BY v.id ASC
    `,
    [sessaoId]
  );

  const canceladas = await promisifyAll(
    database,
    `
      SELECT
        v.id,
        v.total,
        v.valor_fiscal,
        v.valor_nao_fiscal,
        v.status,
        v.status_venda,
        v.cancelada
      FROM vendas v
      WHERE v.caixa_sessao_id = ?
        AND (
          LOWER(TRIM(COALESCE(v.status, ''))) = 'cancelada'
          OR COALESCE(v.cancelada, 0) = 1
          OR UPPER(TRIM(COALESCE(v.status_venda, ''))) = 'CANCELADA'
        )
      ORDER BY v.id ASC
    `,
    [sessaoId]
  );

  const vendaIds = vendas.map((v) => v.id);
  let pagamentosRows = [];
  let recebimentosRows = [];
  if (vendaIds.length) {
    const placeholders = vendaIds.map(() => '?').join(',');
    pagamentosRows = await promisifyAll(
      database,
      `
        SELECT
          vp.id,
          vp.venda_id,
          vp.forma_pagamento,
          vp.valor,
          vp.tef_transacao_id,
          vp.tef_nsu,
          vp.tef_autorizacao
        FROM venda_pagamentos vp
        WHERE vp.venda_id IN (${placeholders})
        ORDER BY vp.id ASC
      `,
      vendaIds
    );

    try {
      recebimentosRows = await promisifyAll(
        database,
        `
          SELECT
            vr.id,
            vr.venda_id,
            vr.tipo_recebimento,
            vr.forma_pagamento,
            vr.valor,
            vr.tef_transacao_id,
            vr.nsu,
            vr.autorizacao,
            vr.status
          FROM venda_recebimentos vr
          WHERE vr.venda_id IN (${placeholders})
            AND (
              vr.status IS NULL
              OR LOWER(TRIM(vr.status)) IN ('aprovado', 'confirmado', 'quitado', 'pago')
            )
          ORDER BY vr.id ASC
        `,
        vendaIds
      );
    } catch (errReceb) {
      // Bancos/testes legados sem a tabela: fecha apenas com venda_pagamentos.
      if (!/no such table/i.test(String(errReceb && errReceb.message))) {
        throw errReceb;
      }
      recebimentosRows = [];
    }
  }

  const pagamentosPorVenda = new Map();
  for (const p of pagamentosRows) {
    const list = pagamentosPorVenda.get(p.venda_id) || [];
    list.push(p);
    pagamentosPorVenda.set(p.venda_id, list);
  }

  const recebimentosPorVenda = new Map();
  for (const r of recebimentosRows) {
    const list = recebimentosPorVenda.get(r.venda_id) || [];
    list.push(r);
    recebimentosPorVenda.set(r.venda_id, list);
  }

  const movSangria = await promisifyGet(
    database,
    `SELECT COALESCE(SUM(valor), 0) AS total FROM caixa_movimentacoes WHERE sessao_id = ? AND tipo = 'sangria'`,
    [sessaoId]
  );
  const movSuprimento = await promisifyGet(
    database,
    `SELECT COALESCE(SUM(valor), 0) AS total FROM caixa_movimentacoes WHERE sessao_id = ? AND tipo = 'suprimento'`,
    [sessaoId]
  );

  const pagamentos = bucketsVazios();
  const contagens = contadoresVazios();
  const divergencias = [];

  let qtdRecebidas = 0;
  let bruto = 0;
  let descontos = 0;
  let acrescimos = 0;
  let liquidoRecebido = 0;
  let fiscalRecebido = 0;
  let naoFiscalRecebido = 0;

  let qtdEntregasTotal = 0;
  let valorEntregasTotal = 0;
  let qtdPrestadas = 0;
  let valorPrestado = 0;
  let qtdPendentes = 0;
  let valorPendente = 0;

  for (const venda of vendas) {
    const valor = valorVendaLiquido(venda);
    const tipoEntrega = String(venda.tipo_venda || '').toUpperCase() === 'ENTREGA'
      || normalizarForma(venda.status) === 'reserva_entrega';

    if (tipoEntrega) {
      qtdEntregasTotal += 1;
      valorEntregasTotal = arred2(valorEntregasTotal + valor);
    }

    if (isEntregaPendente(venda)) {
      qtdPendentes += 1;
      valorPendente = arred2(valorPendente + valor);
      continue;
    }

    if (tipoEntrega) {
      qtdPrestadas += 1;
      valorPrestado = arred2(valorPrestado + valor);
    }

    qtdRecebidas += 1;
    descontos = arred2(descontos + n(venda.desconto));
    // total gravado já é líquido; bruto aproximado = líquido + descontos
    bruto = arred2(bruto + valor + n(venda.desconto));
    liquidoRecebido = arred2(liquidoRecebido + valor);
    fiscalRecebido = arred2(fiscalRecebido + n(venda.valor_fiscal));
    naoFiscalRecebido = arred2(naoFiscalRecebido + n(venda.valor_nao_fiscal));

    const linhasUsadas = resolverLinhasRecebidasVenda(
      venda,
      pagamentosPorVenda.get(venda.id) || [],
      recebimentosPorVenda.get(venda.id) || []
    );

    const somaLinhas = arred2(linhasUsadas.reduce((acc, p) => acc + n(p.valor), 0));
    if (Math.abs(somaLinhas - valor) > TOLERANCIA) {
      divergencias.push({
        tipo: 'pagamento_vs_venda',
        venda_id: venda.id,
        valor_venda: valor,
        soma_pagamentos: somaLinhas,
        diferenca: arred2(somaLinhas - valor),
        fonte_recebido: linhasUsadas[0]?.fonte || null
      });
    }

    for (const linha of linhasUsadas) {
      const bucket = resolverBucketPagamento(linha.forma_pagamento, linha);
      const valorLinha = arred2(linha.valor);
      pagamentos[bucket] = arred2(pagamentos[bucket] + valorLinha);
      if (valorLinha > 0) contagens[bucket] += 1;
    }
  }

  const totalRecebidoBuckets = somaBuckets(pagamentos);
  if (Math.abs(totalRecebidoBuckets - liquidoRecebido) > TOLERANCIA) {
    divergencias.push({
      tipo: 'total_recebido_vs_buckets',
      liquido_recebido: liquidoRecebido,
      soma_buckets: totalRecebidoBuckets,
      diferenca: arred2(totalRecebidoBuckets - liquidoRecebido)
    });
  }

  const valorInicial = arred2(caixa.valor_inicial);
  const totalSangrias = arred2(movSangria?.total);
  const totalSuprimentos = arred2(movSuprimento?.total);
  const vendasDinheiro = arred2(pagamentos.dinheiro);
  const dinheiroEsperado = arred2(valorInicial + vendasDinheiro + totalSuprimentos - totalSangrias);
  const informado = valorInformado != null ? arred2(valorInformado) : null;
  const diferenca = informado != null ? arred2(informado - dinheiroEsperado) : null;

  const valorCancelado = arred2(
    canceladas.reduce((acc, v) => acc + valorVendaLiquido(v), 0)
  );

  const consolidacao = {
    periodo: {
      data: caixa.data || null,
      aberto_em: caixa.aberto_em || null,
      fechado_em: caixa.fechado_em || null
    },
    caixa: {
      id: caixa.id,
      status: caixa.status,
      terminal_id: caixa.terminal_id || meta.terminal_id || null
    },
    terminal: {
      id: meta.terminal_id || caixa.terminal_id || null,
      nome: meta.terminal_nome || null
    },
    operador: {
      id: meta.operador_id || caixa.fechado_por || caixa.aberto_por || null,
      nome: meta.operador_nome || null,
      abertura_id: caixa.aberto_por || meta.abertura_id || null,
      abertura_nome: meta.abertura_nome || null
    },
    abertura: {
      em: caixa.aberto_em || null,
      valor_inicial: valorInicial
    },
    fechamento: {
      em: caixa.fechado_em || null,
      valor_informado: informado
    },
    empresa: {
      nome: meta.empresa_nome || null,
      cnpj: meta.empresa_cnpj || null
    },
    vendas: {
      quantidade: qtdRecebidas,
      bruto: arred2(bruto),
      descontos,
      acrescimos,
      liquido: liquidoRecebido,
      fiscal: fiscalRecebido,
      nao_fiscal: naoFiscalRecebido
    },
    pagamentos: { ...pagamentos },
    pagamentos_contagem: { ...contagens },
    entregas: {
      quantidade_total: qtdEntregasTotal,
      valor_total: valorEntregasTotal,
      quantidade_prestada: qtdPrestadas,
      valor_prestado: valorPrestado,
      quantidade_pendente: qtdPendentes,
      valor_pendente: valorPendente
    },
    movimentacoes: {
      suprimentos: totalSuprimentos,
      sangrias: totalSangrias
    },
    cancelamentos: {
      quantidade: canceladas.length,
      valor: valorCancelado
    },
    dinheiro: {
      saldo_inicial: valorInicial,
      vendas_dinheiro: vendasDinheiro,
      suprimentos: totalSuprimentos,
      sangrias: totalSangrias,
      esperado: dinheiroEsperado,
      informado,
      diferenca
    },
    totais: {
      recebido: liquidoRecebido,
      recebido_por_pagamentos: totalRecebidoBuckets,
      pendente_entregas: valorPendente,
      vendido_sessao_bruto: arred2(liquidoRecebido + valorPendente)
    },
    validacao: {
      ok: divergencias.length === 0,
      tolerancia: TOLERANCIA,
      divergencias
    },
    sessao_id: sessaoId
  };

  return consolidacao;
}

function montarResumoVazio(caixa, meta = {}) {
  const valorInicial = arred2(caixa?.valor_inicial);
  return {
    periodo: { data: caixa?.data || null, aberto_em: caixa?.aberto_em || null, fechado_em: caixa?.fechado_em || null },
    caixa: { id: caixa?.id || null, status: caixa?.status || null, terminal_id: caixa?.terminal_id || null },
    terminal: { id: meta.terminal_id || null, nome: meta.terminal_nome || null },
    operador: { id: null, nome: null },
    abertura: { em: caixa?.aberto_em || null, valor_inicial: valorInicial },
    fechamento: { em: null, valor_informado: null },
    empresa: { nome: meta.empresa_nome || null, cnpj: meta.empresa_cnpj || null },
    vendas: { quantidade: 0, bruto: 0, descontos: 0, acrescimos: 0, liquido: 0, fiscal: 0, nao_fiscal: 0 },
    pagamentos: bucketsVazios(),
    pagamentos_contagem: contadoresVazios(),
    entregas: {
      quantidade_total: 0,
      valor_total: 0,
      quantidade_prestada: 0,
      valor_prestado: 0,
      quantidade_pendente: 0,
      valor_pendente: 0
    },
    movimentacoes: { suprimentos: 0, sangrias: 0 },
    cancelamentos: { quantidade: 0, valor: 0 },
    dinheiro: {
      saldo_inicial: valorInicial,
      vendas_dinheiro: 0,
      suprimentos: 0,
      sangrias: 0,
      esperado: valorInicial,
      informado: null,
      diferenca: null
    },
    totais: { recebido: 0, recebido_por_pagamentos: 0, pendente_entregas: 0, vendido_sessao_bruto: 0 },
    validacao: { ok: true, tolerancia: TOLERANCIA, divergencias: [] },
    sessao_id: null
  };
}

/**
 * Formato legado do resumo aberto (compatível com UI atual).
 */
function paraResumoLegado(caixa, consolidacao) {
  const p = consolidacao.pagamentos;
  const totalDigital = arred2(p.pix + p.credito + p.debito);
  const outras = arred2(p.tef + p.outros);
  return {
    caixa,
    total_vendido: consolidacao.totais.recebido,
    total_recebido: consolidacao.totais.recebido,
    entregas_pendentes: consolidacao.entregas.valor_pendente,
    entregas: consolidacao.entregas,
    dinheiro: {
      valor_inicial: consolidacao.dinheiro.saldo_inicial,
      vendas_dinheiro: consolidacao.dinheiro.vendas_dinheiro,
      suprimentos: consolidacao.dinheiro.suprimentos,
      sangrias: consolidacao.dinheiro.sangrias,
      dinheiro_esperado: consolidacao.dinheiro.esperado
    },
    digital: {
      pix: p.pix,
      cartao_credito: p.credito,
      cartao_debito: p.debito,
      total_digital: totalDigital
    },
    prazo: p.prazo,
    tef: p.tef,
    outras_formas: outras,
    saldo_geral: arred2(
      consolidacao.dinheiro.saldo_inicial
      + consolidacao.totais.recebido
      + consolidacao.dinheiro.suprimentos
      - consolidacao.dinheiro.sangrias
    ),
    fiscal: consolidacao.vendas.fiscal,
    nao_fiscal: consolidacao.vendas.nao_fiscal,
    consolidacao
  };
}

/**
 * Formato legado do fechamento persistido (colunas caixa_fechamentos).
 */
function paraFechamentoLegado(consolidacao, valorInformado) {
  const informado = valorInformado != null ? arred2(valorInformado) : consolidacao.dinheiro.informado;
  const esperado = consolidacao.dinheiro.esperado;
  const diferenca = informado != null ? arred2(n(informado) - esperado) : null;
  const p = consolidacao.pagamentos;

  return {
    valor_inicial: consolidacao.dinheiro.saldo_inicial,
    vendas_dinheiro: p.dinheiro,
    vendas_pix: p.pix,
    vendas_debito: p.debito,
    vendas_credito: p.credito,
    vendas_prazo: p.prazo,
    vendas_tef: p.tef,
    vendas_outros: p.outros,
    total_sangrias: consolidacao.movimentacoes.sangrias,
    total_suprimentos: consolidacao.movimentacoes.suprimentos,
    total_vendido: consolidacao.totais.recebido,
    total_esperado: esperado,
    total_informado: informado,
    diferenca,
    entregas_pendentes: consolidacao.entregas.valor_pendente,
    consolidacao: {
      ...consolidacao,
      dinheiro: {
        ...consolidacao.dinheiro,
        informado,
        diferenca
      },
      fechamento: {
        ...consolidacao.fechamento,
        valor_informado: informado
      }
    }
  };
}

function validarConsolidacaoOuErro(consolidacao) {
  if (!consolidacao?.validacao || consolidacao.validacao.ok) {
    return null;
  }
  const msgs = (consolidacao.validacao.divergencias || []).map((d) => {
    if (d.tipo === 'pagamento_vs_venda') {
      return `Venda #${d.venda_id}: pagamentos (${d.soma_pagamentos}) ≠ valor (${d.valor_venda})`;
    }
    if (d.tipo === 'total_recebido_vs_buckets') {
      return `Total recebido (${d.liquido_recebido}) ≠ soma pagamentos (${d.soma_buckets})`;
    }
    return JSON.stringify(d);
  });
  return new Error(
    `Divergência financeira no fechamento. Corrija antes de fechar: ${msgs.join('; ')}`
  );
}

/**
 * Callback wrappers para integração com rotas existentes.
 */
function calcularResumoCaixa(caixa, options = {}, callback) {
  consolidarSessaoCaixa(caixa, options)
    .then((consolidacao) => callback(null, paraResumoLegado(caixa, consolidacao)))
    .catch((err) => callback(err));
}

function calcularFechamentoDetalhado(caixa, options = {}, callback) {
  consolidarSessaoCaixa(caixa, {
    ...options,
    valorInformado: options.valorInformado
  })
    .then((consolidacao) => {
      const errVal = validarConsolidacaoOuErro(consolidacao);
      if (errVal && options.validar !== false) {
        return callback(errVal);
      }
      callback(null, paraFechamentoLegado(consolidacao, options.valorInformado));
    })
    .catch((err) => callback(err));
}

module.exports = {
  TOLERANCIA,
  n,
  arred2,
  normalizarForma,
  resolverBucketPagamento,
  somaBuckets,
  isVendaCancelada,
  isEntregaPendente,
  valorVendaLiquido,
  resolverLinhasRecebidasVenda,
  consolidarSessaoCaixa,
  paraResumoLegado,
  paraFechamentoLegado,
  validarConsolidacaoOuErro,
  calcularResumoCaixa,
  calcularFechamentoDetalhado,
  // aliases usados em testes/relatórios
  getExprValorVenda,
  getExprValorVendaFiscal,
  getExprValorVendaNaoFiscal
};
