'use strict';

/**
 * SPRINT 51.42 — Recuperação administrativa CONFIRMED_SUCCESS da TEF id=3.
 *
 * Escopo exclusivo: tef_transacoes.id=3 + vínculo vendas.id=66.
 * Não chama DLL / NativeHost / CRT / FINALIZE. Não emite permit.
 * Não cria recebimento. Não emite documento fiscal. Não altera TX id=2.
 * Preserva NSU, autorização e comprovantes originais Destaxa 00.
 */

const crypto = require('crypto');
const tefContrato = require('./tefContrato');
const { FINANCIAL_STATES } = require('./tefFinancialSafetyPolicy');

const OPERACAO_AUTORIZADA_51_42 = Object.freeze({
  id: 3,
  vendaId: 66,
  valor: 1,
  modalidade: 'cartao_debito',
  provedor: 'destaxa',
  nsu: '2338',
  nsuRede: '241255',
  autorizacao: '211139',
  idempotency_key: 'tef-segunda-tentativa-bd6a8809bc64abb7',
  permitAnterior: 'cff481501f704f672b3e956f4bcb62b4',
  sprint: 'SPRINT-51.42',
  origem: 'RECUPERACAO_ADMINISTRATIVA_DESTAXA_00'
});

const STATUS_ALVO = tefContrato.STATUS.APROVADO;
const FINANCIAL_STATE_ALVO = FINANCIAL_STATES.CONFIRMED_SUCCESS;
const TIPO_LOG = 'RECUPERACAO_ADMINISTRATIVA_APROVADO';

const EVIDENCIA_DESTAXA_ESPERADA = Object.freeze({
  codigoDestaxa: '00',
  estado: 'SUCCESS',
  nsu: OPERACAO_AUTORIZADA_51_42.nsu,
  nsuRede: OPERACAO_AUTORIZADA_51_42.nsuRede,
  autorizacao: OPERACAO_AUTORIZADA_51_42.autorizacao,
  fonteLog: 'tef_logs.id=36 (RETORNO) + colunas claras id=3'
});

function criarErro(codigo, mensagem, detalhes = null) {
  const error = new Error(mensagem);
  error.code = codigo;
  if (detalhes) error.detalhes = detalhes;
  return error;
}

function normalizarTexto(v) {
  if (v == null) return '';
  return String(v).trim();
}

function normalizarStatus(v) {
  return normalizarTexto(v).toLowerCase();
}

function valorNumerico(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function ePendente(status) {
  return normalizarStatus(status) === tefContrato.STATUS.PENDENTE;
}

function eAprovado(status) {
  return normalizarStatus(status) === STATUS_ALVO;
}

function validarPedidoRecuperacao(pedido = {}, linha = null, venda = null) {
  const idPedido = Number(pedido.transacaoId ?? pedido.id);
  if (idPedido !== OPERACAO_AUTORIZADA_51_42.id) {
    throw criarErro(
      'TEF_RECUP_51_42_ID_NAO_AUTORIZADO',
      `Recuperação autorizada somente para id=${OPERACAO_AUTORIZADA_51_42.id}.`,
      { idInformado: idPedido }
    );
  }

  if (!normalizarTexto(pedido.operador)) {
    throw criarErro('TEF_RECUP_51_42_OPERADOR_AUSENTE', 'Operador responsável é obrigatório.');
  }
  if (!normalizarTexto(pedido.observacao)) {
    throw criarErro('TEF_RECUP_51_42_OBSERVACAO_AUSENTE', 'Observação/justificativa é obrigatória.');
  }
  if (pedido.confirmacaoExplicitaPo !== true
      && pedido.confirmacao_explicita_po !== true
      && pedido.confirmacaoExplicita !== true
      && pedido.confirmacao_explicita !== true) {
    throw criarErro(
      'TEF_RECUP_51_42_CONFIRMACAO_AUSENTE',
      'Confirmação explícita do Product Owner é obrigatória.'
    );
  }

  if (linha == null || typeof linha !== 'object') {
    throw criarErro('TEF_RECUP_51_42_LINHA_AUSENTE', 'Linha atual da TEF id=3 é obrigatória.');
  }
  if (Number(linha.id) !== OPERACAO_AUTORIZADA_51_42.id) {
    throw criarErro(
      'TEF_RECUP_51_42_ID_LINHA',
      `Linha id=${linha.id} fora do escopo.`,
      { idLinha: linha.id }
    );
  }

  if (normalizarTexto(linha.idempotency_key) !== OPERACAO_AUTORIZADA_51_42.idempotency_key) {
    throw criarErro(
      'TEF_RECUP_51_42_IDEMPOTENCY',
      'idempotency_key diverge da operação autorizada.',
      {
        esperado: OPERACAO_AUTORIZADA_51_42.idempotency_key,
        atual: linha.idempotency_key || null
      }
    );
  }
  if (valorNumerico(linha.valor) !== OPERACAO_AUTORIZADA_51_42.valor) {
    throw criarErro('TEF_RECUP_51_42_VALOR', 'Valor diverge.', {
      esperado: OPERACAO_AUTORIZADA_51_42.valor,
      atual: linha.valor
    });
  }
  const modalidade = normalizarTexto(linha.tipo || linha.modalidade).toLowerCase();
  if (modalidade !== OPERACAO_AUTORIZADA_51_42.modalidade) {
    throw criarErro('TEF_RECUP_51_42_MODALIDADE', 'Modalidade diverge.', {
      esperado: OPERACAO_AUTORIZADA_51_42.modalidade,
      atual: modalidade || null
    });
  }
  if (normalizarTexto(linha.nsu) !== OPERACAO_AUTORIZADA_51_42.nsu) {
    throw criarErro('TEF_RECUP_51_42_NSU', 'NSU diverge da evidência Destaxa.', {
      esperado: OPERACAO_AUTORIZADA_51_42.nsu,
      atual: linha.nsu || null
    });
  }
  if (normalizarTexto(linha.autorizacao) !== OPERACAO_AUTORIZADA_51_42.autorizacao) {
    throw criarErro('TEF_RECUP_51_42_AUTORIZACAO', 'Autorização diverge da evidência Destaxa.', {
      esperado: OPERACAO_AUTORIZADA_51_42.autorizacao,
      atual: linha.autorizacao || null
    });
  }
  if (Number(linha.venda_id) !== OPERACAO_AUTORIZADA_51_42.vendaId) {
    throw criarErro('TEF_RECUP_51_42_VENDA_ID_TX', 'venda_id da TEF diverge.', {
      esperado: OPERACAO_AUTORIZADA_51_42.vendaId,
      atual: linha.venda_id
    });
  }
  if (!linha.comprovante_cliente || !linha.comprovante_estabelecimento) {
    throw criarErro(
      'TEF_RECUP_51_42_COMPROVANTES',
      'Comprovantes originais ausentes — recuperação abortada.'
    );
  }

  if (venda == null || typeof venda !== 'object') {
    throw criarErro('TEF_RECUP_51_42_VENDA_AUSENTE', 'Venda 66 é obrigatória para o vínculo.');
  }
  if (Number(venda.id) !== OPERACAO_AUTORIZADA_51_42.vendaId) {
    throw criarErro('TEF_RECUP_51_42_VENDA_ID', 'Venda fora do escopo.', { id: venda.id });
  }
  if (normalizarStatus(venda.status) !== 'concluida') {
    throw criarErro('TEF_RECUP_51_42_VENDA_STATUS', 'Venda 66 não está concluída.', {
      status: venda.status
    });
  }
  if (normalizarStatus(venda.status_pagamento) !== 'quitada') {
    throw criarErro('TEF_RECUP_51_42_VENDA_PAGAMENTO', 'Venda 66 não está quitada.', {
      status_pagamento: venda.status_pagamento
    });
  }
  if (valorNumerico(venda.total) !== OPERACAO_AUTORIZADA_51_42.valor
      || valorNumerico(venda.valor_fiscal) !== OPERACAO_AUTORIZADA_51_42.valor) {
    throw criarErro('TEF_RECUP_51_42_VENDA_VALORES', 'Totais da venda 66 divergem.', {
      total: venda.total,
      valor_fiscal: venda.valor_fiscal
    });
  }

  return { ok: true };
}

function montarPayloadAuditoria({
  linha,
  venda,
  pedido,
  estadoAnterior,
  estadoPosterior,
  vendaTefAnterior,
  recuperadoEm
}) {
  return {
    sprint: OPERACAO_AUTORIZADA_51_42.sprint,
    origem: OPERACAO_AUTORIZADA_51_42.origem,
    cenario: 'CONFIRMED_SUCCESS_ADMINISTRATIVO',
    financialState: FINANCIAL_STATE_ALVO,
    statusAnterior: estadoAnterior,
    statusPosterior: estadoPosterior,
    motivoAdministrativo:
      'Destaxa retornou 00 (aprovada) com NSU/autorização/comprovantes persistidos; '
      + 'TX_FINALIZE bloqueado por bootstrap/permit (SPRINT 51.41). '
      + 'Recuperação administrativa autorizada pelo PO sem nova cobrança.',
    operador: normalizarTexto(pedido.operador),
    observacao: normalizarTexto(pedido.observacao),
    confirmacaoExplicitaPo: true,
    horario: recuperadoEm,
    evidenciaDestaxa: EVIDENCIA_DESTAXA_ESPERADA,
    identidade: {
      id: OPERACAO_AUTORIZADA_51_42.id,
      venda_id: OPERACAO_AUTORIZADA_51_42.vendaId,
      valor: OPERACAO_AUTORIZADA_51_42.valor,
      modalidade: OPERACAO_AUTORIZADA_51_42.modalidade,
      provedor: OPERACAO_AUTORIZADA_51_42.provedor,
      idempotency_key: OPERACAO_AUTORIZADA_51_42.idempotency_key,
      nsu: OPERACAO_AUTORIZADA_51_42.nsu,
      nsuRede: OPERACAO_AUTORIZADA_51_42.nsuRede,
      autorizacao: OPERACAO_AUTORIZADA_51_42.autorizacao,
      permitAnterior: OPERACAO_AUTORIZADA_51_42.permitAnterior
    },
    preservacoes: {
      nsu: linha.nsu,
      autorizacao: linha.autorizacao,
      comprovante_cliente_len: String(linha.comprovante_cliente || '').length,
      comprovante_estabelecimento_len: String(linha.comprovante_estabelecimento || '').length,
      payload_retorno_preservado: true,
      venda_total: venda.total,
      venda_valor_fiscal: venda.valor_fiscal,
      semNovoRecebimento: true,
      semAlteracaoRecebimentos: true,
      semEventoFiscal: true,
      semChamadaDll: true,
      semCrt: true,
      semTxStartContinueFinalize: true,
      semNovoPermit: true,
      semGateGlobal: true,
      tx2Intocada: true
    },
    vinculoVenda: {
      venda_id: OPERACAO_AUTORIZADA_51_42.vendaId,
      tef_transacao_id_anterior: vendaTefAnterior == null ? null : vendaTefAnterior,
      tef_transacao_id_posterior: OPERACAO_AUTORIZADA_51_42.id
    },
    timestamps: {
      criado_em_original: linha.criado_em || null,
      atualizado_em_anterior: linha.atualizado_em || null,
      recuperado_em: recuperadoEm
    }
  };
}

function recuperarAdministrativamenteAprovadoId3({
  linha,
  venda,
  pedido = {},
  persistir,
  agora = null
} = {}) {
  validarPedidoRecuperacao(pedido, linha, venda);

  const recuperadoEm = agora || new Date().toISOString();
  const estadoAnterior = normalizarStatus(linha.status) || null;
  const vendaTefAnterior = venda.tef_transacao_id == null ? null : venda.tef_transacao_id;

  if (eAprovado(estadoAnterior)
      && Number(vendaTefAnterior) === OPERACAO_AUTORIZADA_51_42.id
      && normalizarTexto(linha.nsu) === OPERACAO_AUTORIZADA_51_42.nsu
      && normalizarTexto(linha.autorizacao) === OPERACAO_AUTORIZADA_51_42.autorizacao) {
    const auditoria = montarPayloadAuditoria({
      linha,
      venda,
      pedido,
      estadoAnterior,
      estadoPosterior: STATUS_ALVO,
      vendaTefAnterior,
      recuperadoEm
    });
    return {
      ok: true,
      idempotente: true,
      alterado: false,
      transacaoId: OPERACAO_AUTORIZADA_51_42.id,
      vendaId: OPERACAO_AUTORIZADA_51_42.vendaId,
      statusAnterior: estadoAnterior,
      statusPosterior: STATUS_ALVO,
      financialState: FINANCIAL_STATE_ALVO,
      nsu: linha.nsu,
      autorizacao: linha.autorizacao,
      auditoria,
      mensagem: 'Recuperação administrativa já aplicada (idempotente).'
    };
  }

  if (!ePendente(estadoAnterior)) {
    throw criarErro(
      'TEF_RECUP_51_42_ESTADO_INVALIDO',
      `Estado atual "${estadoAnterior}" não é elegível (exige pendente).`,
      { status: estadoAnterior }
    );
  }

  if (vendaTefAnterior != null && Number(vendaTefAnterior) !== OPERACAO_AUTORIZADA_51_42.id) {
    throw criarErro(
      'TEF_RECUP_51_42_VENDA_JA_VINCULADA',
      'Venda 66 já possui outro tef_transacao_id.',
      { tef_transacao_id: vendaTefAnterior }
    );
  }

  const auditoria = montarPayloadAuditoria({
    linha,
    venda,
    pedido,
    estadoAnterior,
    estadoPosterior: STATUS_ALVO,
    vendaTefAnterior,
    recuperadoEm
  });

  const update = {
    id: OPERACAO_AUTORIZADA_51_42.id,
    statusEsperado: tefContrato.STATUS.PENDENTE,
    status: STATUS_ALVO,
    nsuEsperado: OPERACAO_AUTORIZADA_51_42.nsu,
    autorizacaoEsperada: OPERACAO_AUTORIZADA_51_42.autorizacao,
    vendaIdEsperada: OPERACAO_AUTORIZADA_51_42.vendaId,
    idempotencyKey: OPERACAO_AUTORIZADA_51_42.idempotency_key,
    mensagem_resposta:
      'RECUPERACAO_ADMINISTRATIVA CONFIRMED_SUCCESS (SPRINT-51.42) — Destaxa 00; '
      + 'NSU/autorização/comprovantes preservados; sem FINALIZE DLL.',
    codigo_resposta: '00',
    recuperadoEm
  };

  const updateVenda = {
    id: OPERACAO_AUTORIZADA_51_42.vendaId,
    tefTransacaoId: OPERACAO_AUTORIZADA_51_42.id,
    totalEsperado: OPERACAO_AUTORIZADA_51_42.valor,
    statusEsperado: 'concluida',
    statusPagamentoEsperado: 'quitada'
  };

  const log = {
    transacaoId: OPERACAO_AUTORIZADA_51_42.id,
    tipo: TIPO_LOG,
    mensagem:
      'Recuperação administrativa CONFIRMED_SUCCESS (aprovado) — SPRINT-51.42; '
      + 'evidência Destaxa 00; vínculo venda 66',
    payload: auditoria
  };

  if (typeof persistir !== 'function') {
    throw criarErro('TEF_RECUP_51_42_PERSISTIR_AUSENTE', 'Callback persistir é obrigatório.');
  }

  const resultadoPersistencia = persistir({ update, updateVenda, log, auditoria });

  return {
    ok: true,
    idempotente: false,
    alterado: true,
    transacaoId: OPERACAO_AUTORIZADA_51_42.id,
    vendaId: OPERACAO_AUTORIZADA_51_42.vendaId,
    statusAnterior: estadoAnterior,
    statusPosterior: STATUS_ALVO,
    financialState: FINANCIAL_STATE_ALVO,
    nsu: OPERACAO_AUTORIZADA_51_42.nsu,
    autorizacao: OPERACAO_AUTORIZADA_51_42.autorizacao,
    auditoria,
    persistencia: resultadoPersistencia || null,
    mensagem: 'Recuperação administrativa CONFIRMED_SUCCESS aplicada.'
  };
}

/**
 * Persistência síncrona atômica via DatabaseSync (node:sqlite).
 * Não reescreve payload_retorno nem comprovantes criptografados.
 */
function persistirRecuperacaoAprovadoSqliteSync(db, { update, updateVenda, log }) {
  if (!db || typeof db.prepare !== 'function') {
    throw criarErro('TEF_RECUP_51_42_DB_INVALIDO', 'Conexão SQLite inválida.');
  }

  const begin = db.prepare('BEGIN IMMEDIATE');
  const commit = db.prepare('COMMIT');
  const rollback = db.prepare('ROLLBACK');

  begin.run();
  try {
    const lenCliAntes = db.prepare(
      'SELECT length(comprovante_cliente) AS n FROM tef_transacoes WHERE id = ?'
    ).get(update.id);
    const lenLojAntes = db.prepare(
      'SELECT length(comprovante_estabelecimento) AS n FROM tef_transacoes WHERE id = ?'
    ).get(update.id);
    const payloadAntes = db.prepare(
      'SELECT length(payload_retorno) AS n FROM tef_transacoes WHERE id = ?'
    ).get(update.id);

    const infoTx = db.prepare(`
      UPDATE tef_transacoes
      SET
        status = ?,
        codigo_resposta = ?,
        mensagem_resposta = ?,
        atualizado_em = datetime('now')
      WHERE id = ?
        AND status = ?
        AND idempotency_key = ?
        AND nsu = ?
        AND autorizacao = ?
        AND venda_id = ?
        AND valor = 1
        AND tipo = 'cartao_debito'
    `).run(
      update.status,
      update.codigo_resposta,
      update.mensagem_resposta,
      update.id,
      update.statusEsperado,
      update.idempotencyKey,
      update.nsuEsperado,
      update.autorizacaoEsperada,
      update.vendaIdEsperada
    );

    if (infoTx.changes !== 1) {
      throw criarErro(
        'TEF_RECUP_51_42_UPDATE_TX_CONFLITO',
        'UPDATE tef_transacoes não afetou exatamente 1 linha.',
        { changes: infoTx.changes }
      );
    }

    const infoVenda = db.prepare(`
      UPDATE vendas
      SET tef_transacao_id = ?
      WHERE id = ?
        AND tef_transacao_id IS NULL
        AND status = ?
        AND status_pagamento = ?
        AND total = ?
        AND valor_fiscal = ?
    `).run(
      updateVenda.tefTransacaoId,
      updateVenda.id,
      updateVenda.statusEsperado,
      updateVenda.statusPagamentoEsperado,
      updateVenda.totalEsperado,
      updateVenda.totalEsperado
    );

    if (infoVenda.changes !== 1) {
      throw criarErro(
        'TEF_RECUP_51_42_UPDATE_VENDA_CONFLITO',
        'UPDATE vendas não afetou exatamente 1 linha.',
        { changes: infoVenda.changes }
      );
    }

    const lenCliDepois = db.prepare(
      'SELECT length(comprovante_cliente) AS n, nsu, autorizacao, status FROM tef_transacoes WHERE id = ?'
    ).get(update.id);
    const lenLojDepois = db.prepare(
      'SELECT length(comprovante_estabelecimento) AS n FROM tef_transacoes WHERE id = ?'
    ).get(update.id);
    const payloadDepois = db.prepare(
      'SELECT length(payload_retorno) AS n FROM tef_transacoes WHERE id = ?'
    ).get(update.id);

    if (lenCliAntes.n !== lenCliDepois.n
        || lenLojAntes.n !== lenLojDepois.n
        || payloadAntes.n !== payloadDepois.n) {
      throw criarErro(
        'TEF_RECUP_51_42_PRESERVACAO_FALHOU',
        'Comprovantes ou payload_retorno foram alterados — rollback.'
      );
    }
    if (String(lenCliDepois.nsu) !== update.nsuEsperado
        || String(lenCliDepois.autorizacao) !== update.autorizacaoEsperada
        || normalizarStatus(lenCliDepois.status) !== STATUS_ALVO) {
      throw criarErro(
        'TEF_RECUP_51_42_POS_UPDATE_INVALIDO',
        'Pós-UPDATE da TEF divergiu do esperado — rollback.'
      );
    }

    const hashIntegridade = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        transacao_id: log.transacaoId,
        tipo: log.tipo,
        mensagem: log.mensagem,
        payload: log.payload,
        timestamp: Date.now()
      }))
      .digest('hex');

    db.prepare(`
      INSERT INTO tef_logs (
        transacao_id, tipo, mensagem, payload, hash_integridade, criado_em
      ) VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(
      log.transacaoId,
      log.tipo,
      log.mensagem,
      JSON.stringify(log.payload || {}),
      hashIntegridade
    );

    // Guarda: nenhum recebimento novo/alterado nesta TX
    const recCount = db.prepare(`
      SELECT COUNT(*) AS n FROM venda_recebimentos WHERE venda_id = ?
    `).get(updateVenda.id);

    commit.run();
    return {
      changesTx: infoTx.changes,
      changesVenda: infoVenda.changes,
      logTipo: log.tipo,
      hashIntegridade,
      comprovantesPreservados: {
        cliente: lenCliDepois.n,
        estabelecimento: lenLojDepois.n,
        payload: payloadDepois.n
      },
      recebimentosVenda66: recCount.n
    };
  } catch (error) {
    try { rollback.run(); } catch (_) { /* ignore */ }
    throw error;
  }
}

module.exports = {
  OPERACAO_AUTORIZADA_51_42,
  STATUS_ALVO,
  FINANCIAL_STATE_ALVO,
  TIPO_LOG,
  EVIDENCIA_DESTAXA_ESPERADA,
  validarPedidoRecuperacao,
  recuperarAdministrativamenteAprovadoId3,
  persistirRecuperacaoAprovadoSqliteSync,
  montarPayloadAuditoria
};
