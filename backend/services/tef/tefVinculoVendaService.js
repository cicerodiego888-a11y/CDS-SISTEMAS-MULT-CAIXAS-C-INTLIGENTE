'use strict';

/**
 * TEF-15 — Vínculo inequívoco venda ↔ recebimento ↔ tef_transacoes.
 * Nunca associa por valor, horário ou ordem. Nunca cria venda fictícia.
 */

const ESTADOS_VINCULO = Object.freeze({
  VINCULADA: 'VINCULADA',
  PENDENTE_FINALIZACAO: 'PENDENTE_FINALIZACAO',
  VENDA_INFORMADA: 'VENDA_INFORMADA',
  CONFLITO: 'CONFLITO',
  TRANSACAO_AUSENTE: 'TRANSACAO_AUSENTE',
  VENDA_INEXISTENTE: 'VENDA_INEXISTENTE'
});

function criarErro(codigo, mensagem, extras = {}) {
  const error = new Error(mensagem);
  error.code = codigo;
  Object.assign(error, extras);
  return error;
}

function normalizarVendaId(vendaId) {
  if (vendaId == null || vendaId === '') return null;
  const n = Number(vendaId);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw criarErro('TEF_VENDA_ID_INVALIDO', `venda_id inválido: ${vendaId}`);
  }
  return n;
}

function normalizarTransacaoId(transacaoId) {
  if (transacaoId == null || transacaoId === '') return null;
  const n = Number(transacaoId);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function extrairIdsTefDePagamentos(pagamentos = [], tef = null) {
  const ids = [];
  if (tef && (tef.transacao_id || tef.transacaoId)) {
    ids.push(tef.transacao_id || tef.transacaoId);
  }
  for (const p of Array.isArray(pagamentos) ? pagamentos : []) {
    const id = p?.tef_transacao_id || p?.tef?.transacao_id || p?.tef?.transacaoId;
    if (id) ids.push(id);
  }
  return [...new Set(ids.map(normalizarTransacaoId).filter(Boolean))];
}

function getDb(opcoes = {}) {
  return opcoes.db || require('../../database');
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

/**
 * Valida venda_id informado no pagamento.
 * null → permitido (fluxo PDV TEF-antes-da-venda), com vínculo pendente de finalização.
 * valor informado → deve existir em vendas.
 */
async function validarVendaIdParaPagamento(vendaIdBruto, opcoes = {}) {
  let vendaId = null;
  try {
    vendaId = normalizarVendaId(vendaIdBruto);
  } catch (error) {
    return {
      ok: false,
      codigo: error.code || 'TEF_VENDA_ID_INVALIDO',
      mensagem: error.message,
      venda_id: null,
      estadoVinculo: ESTADOS_VINCULO.VENDA_INEXISTENTE
    };
  }

  if (vendaId == null) {
    return {
      ok: true,
      venda_id: null,
      estadoVinculo: ESTADOS_VINCULO.PENDENTE_FINALIZACAO,
      mensagem: 'Pagamento sem venda_id — vínculo deve ser feito na finalização via tef_transacao_id.'
    };
  }

  const db = getDb(opcoes);
  const row = await get(db, 'SELECT id FROM vendas WHERE id = ?', [vendaId]);
  if (!row) {
    return {
      ok: false,
      codigo: 'TEF_VENDA_INEXISTENTE',
      mensagem: `venda_id ${vendaId} não existe — recusado (sem inventar venda).`,
      venda_id: vendaId,
      estadoVinculo: ESTADOS_VINCULO.VENDA_INEXISTENTE
    };
  }

  return {
    ok: true,
    venda_id: vendaId,
    estadoVinculo: ESTADOS_VINCULO.VENDA_INFORMADA,
    mensagem: 'venda_id validado no backend.'
  };
}

/**
 * Vincula tef_transacoes.id → vendas.id somente pela identidade da transação.
 * Não altera status financeiro. Não sobrescreve vínculo com outra venda.
 */
async function vincularTransacaoAVenda(transacaoIdBruto, vendaIdBruto, opcoes = {}) {
  const transacaoId = normalizarTransacaoId(transacaoIdBruto);
  const vendaId = normalizarVendaId(vendaIdBruto);
  if (!transacaoId) {
    return {
      sucesso: false,
      codigo: 'TEF_TRANSACAO_ID_INVALIDO',
      estadoVinculo: ESTADOS_VINCULO.TRANSACAO_AUSENTE,
      mensagem: 'tef_transacao_id inválido'
    };
  }
  if (!vendaId) {
    return {
      sucesso: false,
      codigo: 'TEF_VENDA_ID_INVALIDO',
      estadoVinculo: ESTADOS_VINCULO.VENDA_INEXISTENTE,
      mensagem: 'venda_id inválido para vínculo'
    };
  }

  const db = getDb(opcoes);
  const venda = await get(db, 'SELECT id FROM vendas WHERE id = ?', [vendaId]);
  if (!venda) {
    return {
      sucesso: false,
      codigo: 'TEF_VENDA_INEXISTENTE',
      estadoVinculo: ESTADOS_VINCULO.VENDA_INEXISTENTE,
      mensagem: `Venda ${vendaId} inexistente`
    };
  }

  const tx = await get(
    db,
    'SELECT id, venda_id, status, idempotency_key FROM tef_transacoes WHERE id = ?',
    [transacaoId]
  );
  if (!tx) {
    return {
      sucesso: false,
      codigo: 'TEF_TRANSACAO_AUSENTE',
      estadoVinculo: ESTADOS_VINCULO.TRANSACAO_AUSENTE,
      mensagem: `Transação TEF ${transacaoId} não encontrada`
    };
  }

  if (tx.venda_id != null && Number(tx.venda_id) !== Number(vendaId)) {
    return {
      sucesso: false,
      codigo: 'TEF_VINCULO_CONFLITO',
      estadoVinculo: ESTADOS_VINCULO.CONFLITO,
      mensagem: `Transação ${transacaoId} já vinculada à venda ${tx.venda_id}`,
      venda_id_existente: tx.venda_id
    };
  }

  if (tx.venda_id != null && Number(tx.venda_id) === Number(vendaId)) {
    return {
      sucesso: true,
      codigo: 'TEF_VINCULO_JA_EXISTENTE',
      estadoVinculo: ESTADOS_VINCULO.VINCULADA,
      transacao_id: transacaoId,
      venda_id: vendaId,
      alterado: false,
      status_tef: tx.status,
      idempotency_key: tx.idempotency_key || null
    };
  }

  const upd = await run(
    db,
    `UPDATE tef_transacoes
     SET venda_id = ?, atualizado_em = datetime('now')
     WHERE id = ?
       AND (venda_id IS NULL OR venda_id = ?)`,
    [vendaId, transacaoId, vendaId]
  );

  if (!upd.changes) {
    return {
      sucesso: false,
      codigo: 'TEF_VINCULO_NAO_APLICADO',
      estadoVinculo: ESTADOS_VINCULO.CONFLITO,
      mensagem: 'Vínculo não aplicado (possível corrida ou conflito)'
    };
  }

  return {
    sucesso: true,
    codigo: 'TEF_VINCULO_OK',
    estadoVinculo: ESTADOS_VINCULO.VINCULADA,
    transacao_id: transacaoId,
    venda_id: vendaId,
    alterado: true,
    status_tef: tx.status,
    idempotency_key: tx.idempotency_key || null
  };
}

async function vincularTransacoesAVenda(vendaId, transacaoIds, opcoes = {}) {
  const ids = [...new Set((transacaoIds || []).map(normalizarTransacaoId).filter(Boolean))];
  const resultados = [];
  for (const id of ids) {
    // Sequencial: evita associação ambígua e facilita auditoria por id.
    // eslint-disable-next-line no-await-in-loop
    resultados.push(await vincularTransacaoAVenda(id, vendaId, opcoes));
  }
  const falhas = resultados.filter((r) => !r.sucesso);
  return {
    sucesso: falhas.length === 0,
    venda_id: normalizarVendaId(vendaId),
    total: resultados.length,
    vinculados: resultados.filter((r) => r.sucesso).length,
    falhas,
    resultados,
    regra: 'somente_por_tef_transacao_id'
  };
}

function montarMetaRespostaPagamento({
  vendaId = null,
  estadoVinculo = ESTADOS_VINCULO.PENDENTE_FINALIZACAO,
  idempotencyKey = null,
  operationId = null,
  transacaoId = null
} = {}) {
  return {
    venda_id: vendaId,
    estado_vinculo: estadoVinculo,
    idempotency_key: idempotencyKey || null,
    operation_id: operationId || (idempotencyKey && String(idempotencyKey).replace(/^pdv-op-/, '')) || null,
    tef_transacao_id: transacaoId || null,
    associacao_por_valor_proibida: true,
    associacao_por_ordem_proibida: true
  };
}

/**
 * Compatível com fluxos sqlite callback (finalização de venda).
 * Só vincula por id de transação; não sobrescreve outra venda.
 */
function enfileirarVinculosSqlite(db, vendaIdBruto, transacaoIds, onErro = null) {
  const vendaId = normalizarVendaId(vendaIdBruto);
  const ids = [...new Set((transacaoIds || []).map(normalizarTransacaoId).filter(Boolean))];
  if (!vendaId || !ids.length) {
    return { agendados: 0, ids: [] };
  }
  ids.forEach((transacaoId) => {
    db.run(
      `UPDATE tef_transacoes
       SET venda_id = ?, atualizado_em = datetime('now')
       WHERE id = ?
         AND (venda_id IS NULL OR venda_id = ?)`,
      [vendaId, transacaoId, vendaId],
      (tefErr) => {
        if (tefErr && typeof onErro === 'function') {
          onErro(tefErr, transacaoId);
        } else if (tefErr) {
          console.error('Erro ao vincular TEF à venda:', tefErr);
        }
      }
    );
  });
  return { agendados: ids.length, ids };
}

module.exports = {
  ESTADOS_VINCULO,
  normalizarVendaId,
  normalizarTransacaoId,
  extrairIdsTefDePagamentos,
  validarVendaIdParaPagamento,
  vincularTransacaoAVenda,
  vincularTransacoesAVenda,
  montarMetaRespostaPagamento,
  enfileirarVinculosSqlite
};
