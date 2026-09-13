'use strict';

const db = require('../../database');

const SUBQUERY_VENDAS_CANCELADAS = `
  SELECT id FROM vendas
  WHERE COALESCE(cancelada, 0) = 1 OR LOWER(COALESCE(status, '')) = 'cancelada'
`;

function sqlExcluirContaVendaCancelada(alias = 'cr') {
  return `(
    ${alias}.venda_id IS NULL
    OR ${alias}.venda_id NOT IN (${SUBQUERY_VENDAS_CANCELADAS})
  )`;
}

function sqlExcluirFinanceiroVendaCancelada(alias = 'f') {
  return `(
    ${alias}.venda_id IS NULL
    OR ${alias}.venda_id NOT IN (${SUBQUERY_VENDAS_CANCELADAS})
  )
  AND (
    ${alias}.referencia_tipo IS NULL
    OR ${alias}.referencia_tipo != 'venda'
    OR ${alias}.referencia_id IS NULL
    OR ${alias}.referencia_id NOT IN (${SUBQUERY_VENDAS_CANCELADAS})
  )`;
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this.changes || 0);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function arredondarCentavos(valor) {
  return Math.round(Number(valor || 0) * 100) / 100;
}

function agoraLocalBrasil() {
  const agora = new Date();

  const dataBrasil = new Date(
    agora.toLocaleString('en-US', { timeZone: 'America/Fortaleza' })
  );

  const ano = dataBrasil.getFullYear();
  const mes = String(dataBrasil.getMonth() + 1).padStart(2, '0');
  const dia = String(dataBrasil.getDate()).padStart(2, '0');
  const hora = String(dataBrasil.getHours()).padStart(2, '0');
  const min = String(dataBrasil.getMinutes()).padStart(2, '0');
  const seg = String(dataBrasil.getSeconds()).padStart(2, '0');

  return `${ano}-${mes}-${dia} ${hora}:${min}:${seg}`;
}

function validarSomaPagamentosVenda(pagamentosVenda, total, opcoes = {}) {
  if (!Array.isArray(pagamentosVenda) || pagamentosVenda.length === 0) {
    return null;
  }

  const totalPagamentos = pagamentosVenda.reduce(
    (soma, p) => soma + Number(p.valor || 0),
    0
  );
  const totalVenda = Number(total || 0);

  if (Math.abs(totalPagamentos - totalVenda) <= 0.01) {
    return null;
  }

  const valorFiscal = Number(opcoes.valor_fiscal || 0);
  const valorNaoFiscal = Number(opcoes.valor_nao_fiscal || 0);
  const vendaMista = valorFiscal > 0 && valorNaoFiscal > 0;

  if (!vendaMista) {
    return 'A soma dos pagamentos precisa ser igual ao total da venda.';
  }

  const tipoRecebimento = (p) => String(p.tipo_recebimento || '').toLowerCase().trim();
  const todosFiscais = pagamentosVenda.every((p) => tipoRecebimento(p) === 'fiscal');
  const todosNaoFiscais = pagamentosVenda.every((p) => tipoRecebimento(p) === 'nao_fiscal');

  if (todosFiscais && Math.abs(totalPagamentos - valorFiscal) <= 0.01) {
    return null;
  }

  if (todosNaoFiscais && Math.abs(totalPagamentos - valorNaoFiscal) <= 0.01) {
    return null;
  }

  return 'A soma dos pagamentos precisa ser igual ao total da venda.';
}

async function executarCancelamentoFinanceiro(vendaId, observacao) {
  const financeiroPorVenda = await dbRun(
    `
    UPDATE financeiro
    SET
      status = 'cancelado',
      observacao = COALESCE(observacao, '') || ' | ' || ?
    WHERE venda_id = ?
      AND COALESCE(status, '') != 'cancelado'
    `,
    [observacao, vendaId]
  );

  const financeiroPorReferencia = await dbRun(
    `
    UPDATE financeiro
    SET
      status = 'cancelado',
      observacao = COALESCE(observacao, '') || ' | ' || ?
    WHERE referencia_id = ?
      AND referencia_tipo = 'venda'
      AND COALESCE(status, '') != 'cancelado'
    `,
    [observacao, vendaId]
  );

  const contasReceber = await dbRun(
    `
    UPDATE contas_receber
    SET
      status = 'cancelado',
      valor_restante = 0,
      observacao = COALESCE(observacao, '') || ' | ' || ?
    WHERE venda_id = ?
      AND COALESCE(status, '') != 'cancelado'
    `,
    [observacao, vendaId]
  );

  return {
    financeiro: financeiroPorVenda + financeiroPorReferencia,
    contas_receber: contasReceber
  };
}

/**
 * Cancela lançamentos financeiros e contas a receber vinculados a uma venda.
 * @param {number|string} vendaId
 * @param {{ observacao?: string, gerenciarTransacao?: boolean }} opcoes
 */
async function cancelarFinanceiroVenda(vendaId, opcoes = {}) {
  const observacao = opcoes.observacao || `Cancelado automaticamente pela venda #${vendaId}`;

  if (opcoes.gerenciarTransacao === false) {
    return executarCancelamentoFinanceiro(vendaId, observacao);
  }

  await dbRun('BEGIN IMMEDIATE');

  try {
    const resultado = await executarCancelamentoFinanceiro(vendaId, observacao);
    await dbRun('COMMIT');
    return resultado;
  } catch (err) {
    try {
      await dbRun('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Erro ao reverter cancelamento financeiro da venda:', rollbackErr.message);
    }
    throw err;
  }
}

/**
 * Corrige registros antigos em que vendas canceladas ainda possuem pendências financeiras.
 */
async function sincronizarFinanceiroVendasCanceladas() {
  const vendasCanceladas = await dbAll(
    `
    SELECT id
    FROM vendas
    WHERE COALESCE(cancelada, 0) = 1 OR LOWER(COALESCE(status, '')) = 'cancelada'
    `
  );

  let registrosCorrigidos = 0;

  for (const venda of vendasCanceladas) {
    const resultado = await cancelarFinanceiroVenda(venda.id, {
      observacao: 'Correção automática na inicialização',
      gerenciarTransacao: true
    });
    registrosCorrigidos += resultado.financeiro + resultado.contas_receber;
  }

  return {
    vendas: vendasCanceladas.length,
    registros_corrigidos: registrosCorrigidos
  };
}

async function reduzirValorPendenteFinanceiro(vendaId, valorReduzir, observacao) {
  let restante = arredondarCentavos(valorReduzir);
  let atualizados = 0;

  if (restante <= 0) {
    return { restante: 0, atualizados: 0 };
  }

  const registros = await dbAll(
    `
    SELECT id, valor
    FROM financeiro
    WHERE tipo = 'receita'
      AND status = 'pendente'
      AND valor > 0
      AND (
        venda_id = ?
        OR (referencia_id = ? AND referencia_tipo = 'venda')
      )
    ORDER BY COALESCE(numero_parcela, 0) DESC, id DESC
    `,
    [vendaId, vendaId]
  );

  for (const registro of registros) {
    if (restante <= 0.009) break;

    const saldo = arredondarCentavos(registro.valor);
    const reduzir = arredondarCentavos(Math.min(restante, saldo));
    const novoValor = arredondarCentavos(saldo - reduzir);

    if (novoValor <= 0.009) {
      await dbRun(
        `
        UPDATE financeiro
        SET
          valor = 0,
          status = 'cancelado',
          observacao = COALESCE(observacao, '') || ' | ' || ?
        WHERE id = ?
        `,
        [observacao, registro.id]
      );
    } else {
      await dbRun(
        `
        UPDATE financeiro
        SET
          valor = ?,
          observacao = COALESCE(observacao, '') || ' | ' || ?
        WHERE id = ?
        `,
        [novoValor, observacao, registro.id]
      );
    }

    atualizados += 1;
    restante = arredondarCentavos(restante - reduzir);
  }

  return { restante, atualizados };
}

/**
 * Ajusta financeiro e contas a receber após devolução parcial de venda.
 */
async function recalcularFinanceiroDevolucaoVenda(vendaId, valorDevolvido, venda, opcoes = {}) {
  const valor = arredondarCentavos(valorDevolvido);
  if (valor <= 0) {
    return { contas_receber: 0, financeiro: 0, estorno: 0 };
  }

  const observacao = opcoes.observacao || `Devolução parcial venda #${vendaId}`;
  let restante = valor;
  let contasAtualizadas = 0;

  const contas = await dbAll(
    `
    SELECT id, valor_restante
    FROM contas_receber
    WHERE venda_id = ?
      AND status IN ('aberto', 'parcial')
      AND valor_restante > 0
    ORDER BY numero_parcela DESC, id DESC
    `,
    [vendaId]
  );

  for (const conta of contas) {
    if (restante <= 0.009) break;

    const saldo = arredondarCentavos(conta.valor_restante);
    const reduzir = arredondarCentavos(Math.min(restante, saldo));
    const novoRestante = arredondarCentavos(saldo - reduzir);

    await dbRun(
      `
      UPDATE contas_receber
      SET
        valor_restante = ?,
        status = CASE WHEN ? <= 0.009 THEN 'pago' ELSE status END,
        observacao = COALESCE(observacao, '') || ' | ' || ?
      WHERE id = ?
      `,
      [novoRestante, novoRestante, observacao, conta.id]
    );

    contasAtualizadas += 1;
    restante = arredondarCentavos(restante - reduzir);
  }

  const financeiroPendente = await reduzirValorPendenteFinanceiro(vendaId, restante, observacao);
  restante = financeiroPendente.restante;

  let estorno = 0;
  if (restante > 0.009) {
    const dataMov = venda?.data_venda || agoraLocalBrasil().slice(0, 10);
    await dbRun(
      `
      INSERT INTO financeiro (
        tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
        referencia_id, referencia_tipo, status, origem, documento, vencimento,
        venda_id, baixado_em, observacao
      ) VALUES ('despesa', ?, ?, ?, 'estorno_devolucao', ?, ?, 'venda', 'pago', 'devolucao_venda', ?, ?, ?, ?, ?)
      `,
      [
        `Estorno devolução parcial ${venda?.codigo || vendaId}`,
        restante,
        dataMov,
        venda?.forma_pagamento || null,
        vendaId,
        venda?.codigo || String(vendaId),
        dataMov,
        vendaId,
        dataMov,
        observacao
      ]
    );
    estorno = restante;
  }

  await dbRun(
    `
    UPDATE vendas
    SET total = CASE WHEN (total - ?) < 0 THEN 0 ELSE (total - ?) END
    WHERE id = ?
    `,
    [valor, valor, vendaId]
  );

  if (venda?.cliente_id && ['prazo', 'credito'].includes(String(venda.forma_pagamento || '').toLowerCase())) {
    await dbRun(
      `
      UPDATE clientes
      SET credito_atual = CASE
        WHEN (credito_atual - ?) < 0 THEN 0
        ELSE credito_atual - ?
      END
      WHERE id = ?
      `,
      [valor, valor, venda.cliente_id]
    );
  }

  return {
    contas_receber: contasAtualizadas,
    financeiro: financeiroPendente.atualizados + (estorno > 0 ? 1 : 0),
    estorno
  };
}

module.exports = {
  agoraLocalBrasil,
  validarSomaPagamentosVenda,
  cancelarFinanceiroVenda,
  sincronizarFinanceiroVendasCanceladas,
  recalcularFinanceiroDevolucaoVenda,
  sqlExcluirContaVendaCancelada,
  sqlExcluirFinanceiroVendaCancelada
};
