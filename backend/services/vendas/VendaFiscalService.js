'use strict';

const db = require('../../database');
const { emitirPorVendaId } = require('../fiscal/emissor');
const cancelarNfce = require('../fiscal/cancelarNfce');
const { appendXmlRetornoNfce } = require('../fiscal/xmlRetornoNfce');
const tefManager = require('../tef/TefManager');
const mpfc = require('../mpfc');

/**
 * RC8.2.2 — reprocessamento / reemissão: amarra auditoria ao snapshot da venda.
 * Não altera cálculo nem XML; apenas garante que a política usada é a gravada.
 */
function registrarPoliticaSnapshotReprocessamento(vendaId, callback) {
  db.get(
    'SELECT id, mpfc_politica_snapshot FROM vendas WHERE id = ?',
    [vendaId],
    (err, venda) => {
      if (err) return callback(err);
      if (!venda) return callback(null, null);
      const resolvido = mpfc.resolverPoliticaOperacionalDaVenda(venda, 'reprocessamento');
      callback(null, resolvido);
    }
  );
}

function extrairTagXmlCancelamento(xml, tag) {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
  const match = String(xml || '').match(regex);
  return match ? match[1] : null;
}

function extrairCancelamentoSefaz(xml) {
  const texto = String(xml || '');
  const lotes = [...texto.matchAll(/<retEnvEvento[\s\S]*?<\/retEnvEvento>/gi)];
  const retornoAtual = lotes.length ? lotes[lotes.length - 1][0] : texto;
  const eventos = [...retornoAtual.matchAll(/<retEvento[\s\S]*?<\/retEvento>/gi)];
  const blocoEvento = eventos.length ? eventos[eventos.length - 1][0] : retornoAtual;
  return {
    cStatLote: extrairTagXmlCancelamento(retornoAtual, 'cStat'),
    cStatEvento: extrairTagXmlCancelamento(blocoEvento, 'cStat'),
    xMotivoEvento: extrairTagXmlCancelamento(blocoEvento, 'xMotivo'),
    protocoloCancelamento: extrairTagXmlCancelamento(blocoEvento, 'nProt'),
    dataCancelamento: extrairTagXmlCancelamento(blocoEvento, 'dhRegEvento')
  };
}

function buscarNfceAutorizadaVenda(vendaId, callback) {
  db.get(`
    SELECT id, status
    FROM nfce_notas
    WHERE venda_id = ?
      AND status IN ('autorizada', 'cancelamento_rejeitado')
      AND (
        (chave_acesso IS NOT NULL AND chave_acesso <> '')
        OR (xml_retorno IS NOT NULL AND xml_retorno LIKE '%<cStat>100</cStat>%')
      )
    ORDER BY id DESC
    LIMIT 1
  `, [vendaId], callback);
}

function dbRunAsync(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function dbGetAsync(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function cancelarNfceAutorizadaVenda(vendaId, justificativa, nfceId, deps = {}) {
  const database = deps.db || db;
  const id = Number(nfceId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('ID exato da NFC-e obrigatório para cancelar a venda.');
  }

  const nota = await dbGetAsync(
    database,
    'SELECT id, venda_id, status, xml_retorno FROM nfce_notas WHERE id = ? AND venda_id = ?',
    [id, vendaId]
  );
  if (!nota) {
    const err = new Error('A NFC-e selecionada não pertence à venda solicitada.');
    err.statusCode = 404;
    throw err;
  }

  const claim = await dbRunAsync(database, `
    UPDATE nfce_notas
    SET status = 'cancelamento_em_andamento',
        updated_at = datetime('now', 'localtime')
    WHERE id = ? AND venda_id = ?
      AND status IN ('autorizada', 'cancelamento_rejeitado')
  `, [id, vendaId]);
  if (claim.changes !== 1) {
    const err = new Error('NFC-e não está disponível para cancelamento ou já possui operação em andamento.');
    err.statusCode = 409;
    err.code = 'CONCORRENCIA';
    throw err;
  }

  let cancelamento;
  try {
    const cancelarPorId = deps.cancelarNfcePorId || cancelarNfce.cancelarNfcePorId;
    cancelamento = await cancelarPorId(
      id,
      justificativa.trim(),
      { db: database, cancelamentoClaimed: true }
    );
  } catch (error) {
    await dbRunAsync(database, `
      UPDATE nfce_notas
      SET status = 'cancelamento_desconhecido',
          updated_at = datetime('now', 'localtime')
      WHERE id = ? AND status = 'cancelamento_em_andamento'
    `, [id]).catch((persistErr) => {
      console.error('Falha ao bloquear NFC-e após erro de cancelamento:', persistErr);
    });
    throw error;
  }

  const retornoTexto = typeof cancelamento.sefaz === 'string'
    ? cancelamento.sefaz
    : JSON.stringify(cancelamento.sefaz);
  const confirmacao = cancelamento.confirmacaoCancelamento;
  const confirmadoPorConsulta = confirmacao?.confirmado === true;
  const retornoConsulta = String(confirmacao?.retornoXml || '');
  const retornoPersistido = [retornoTexto, retornoConsulta].filter(Boolean).join('\n');
  const dadosCancelamento = Object.assign(
    {},
    extrairCancelamentoSefaz(retornoTexto),
    confirmadoPorConsulta
      ? {
        cStatEvento: confirmacao.cStat,
        xMotivoEvento: confirmacao.xMotivo,
        protocoloCancelamento: confirmacao.protocolo,
        dataCancelamento: confirmacao.dataCancelamento
      }
      : {}
  );
  const loteProcessado = confirmadoPorConsulta
    || String(dadosCancelamento.cStatLote || '') === '128';
  const cStatEvento = String(dadosCancelamento.cStatEvento || '');
  const canceladoComSucesso = confirmadoPorConsulta
    || (loteProcessado && ['135', '155'].includes(cStatEvento));
  const rejeicaoConhecida = !confirmadoPorConsulta
    && loteProcessado
    && ['501', '631'].includes(cStatEvento);

  if (canceladoComSucesso || rejeicaoConhecida) {
    const status = canceladoComSucesso ? 'cancelada' : 'autorizada';
    const persistencia = await dbRunAsync(database, `
      UPDATE nfce_notas
      SET status = ?,
          xml_retorno = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ? AND status = 'cancelamento_em_andamento'
    `, [status, appendXmlRetornoNfce(nota.xml_retorno, retornoPersistido), id]);

    if (persistencia.changes !== 1) {
      const err = new Error('Falha ao persistir o resultado fiscal; NFC-e permanece bloqueada para reconciliação.');
      err.statusCode = 500;
      err.code = 'PERSISTENCIA_CANCELAMENTO_INDETERMINADA';
      throw err;
    }
  } else {
    const persistencia = await dbRunAsync(database, `
      UPDATE nfce_notas
      SET status = 'cancelamento_desconhecido',
          xml_retorno = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ? AND status = 'cancelamento_em_andamento'
    `, [appendXmlRetornoNfce(nota.xml_retorno, retornoPersistido), id]);
    if (persistencia.changes !== 1) {
      const err = new Error('Falha ao persistir resultado fiscal desconhecido; NFC-e permanece bloqueada.');
      err.statusCode = 500;
      err.code = 'PERSISTENCIA_CANCELAMENTO_INDETERMINADA';
      throw err;
    }
  }

  if (!canceladoComSucesso) {
    const err = new Error(
      rejeicaoConhecida
        ? `Cancelamento da NFC-e rejeitado pela SEFAZ (cStat ${cStatEvento}): ${dadosCancelamento.xMotivoEvento || 'sem motivo informado'}. A venda permanece como estava.`
        : cStatEvento === '573'
          ? `cStat 573: a duplicidade não comprova o cancelamento; ${confirmacao?.motivo || 'o evento 110111 não foi validado oficialmente'}. A NFC-e permanece bloqueada para reconciliação.`
        : 'Retorno fiscal desconhecido; a NFC-e e a venda permanecem bloqueadas para nova decisão.'
    );
    err.statusCode = rejeicaoConhecida ? 400 : 409;
    err.code = cStatEvento === '136'
      ? 'PENDENCIA_DOCUMENTAL_CSTAT_136'
      : (cStatEvento === '573'
        ? 'PENDENCIA_RECONCILIACAO_CSTAT_573'
        : (rejeicaoConhecida ? 'SEFAZ_REJEICAO' : 'RESULTADO_DESCONHECIDO'));
    err.sefaz = dadosCancelamento;
    throw err;
  }

  return dadosCancelamento;
}

async function vincularNfceTransacoesVenda(vendaId, fiscal) {
  if (!fiscal?.success || !fiscal?.numero || !fiscal?.chave) {
    return;
  }

  const rows = await new Promise((resolve, reject) => {
    db.all(`
      SELECT tef_transacao_id
      FROM venda_recebimentos
      WHERE venda_id = ? AND tef_transacao_id IS NOT NULL
    `, [vendaId], (err, result) => {
      if (err) return reject(err);
      resolve(result || []);
    });
  });

  for (const row of rows) {
    try {
      await tefManager.vincularNfce(row.tef_transacao_id, fiscal.numero, fiscal.chave);
    } catch (vincError) {
      console.error(`Erro ao vincular NFC-e à transação TEF ${row.tef_transacao_id}:`, vincError);
    }
  }
}

async function emitirFiscalSeSolicitado(vendaId, emitirFiscal, venda) {
  const emitirExplicito = emitirFiscal === true
    || emitirFiscal === 'true'
    || emitirFiscal === 1
    || emitirFiscal === '1';

  if (!emitirExplicito) {
    return null;
  }

  if (Number(venda?.valor_fiscal || 0) <= 0) {
    return {
      status: 'sem_itens_fiscais',
      message: 'Venda sem itens fiscais. NFC-e não necessária.'
    };
  }

  try {
    const fiscal = await emitirPorVendaId(vendaId);

    if (fiscal?.status === 'sem_itens_fiscais') {
      return fiscal;
    }

    await vincularNfceTransacoesVenda(vendaId, fiscal);
    return fiscal;
  } catch (error) {
    console.error('Erro ao emitir NFC-e após pagamento não fiscal:', error);
    return {
      success: false,
      status: 'erro_emissao',
      message: error.message
    };
  }
}

/**
 * Status da resposta HTTP = status já persistido.
 * Não recalcula com recebimentos NF vazios (`[]`), o que forçava
 * `aguardando_nao_fiscal` em venda mista já quitada.
 */
function resolverStatusPagamentoResposta(payload = {}) {
  const persistido = String(payload.statusPagamento || 'quitada').trim() || 'quitada';
  if (persistido === 'quitada') {
    return 'quitada';
  }

  const { resolverStatusPagamentoVenda } = require('./VendaPagamentoService');
  const recebimentosNaoFiscal = Array.isArray(payload.recebimentosNaoFiscal)
    ? payload.recebimentosNaoFiscal
    : [];

  return resolverStatusPagamentoVenda(
    Number(payload.valorNaoFiscal || 0),
    recebimentosNaoFiscal,
    persistido,
    { valorFiscal: Number(payload.valorFiscal || 0) }
  );
}

function coletarIdsTefAutorizados(payload = {}) {
  const ids = [];
  const pags = Array.isArray(payload.pagamentosTef) ? payload.pagamentosTef : [];
  for (const p of pags) {
    const id = p && (p.tef_transacao_id || p.tef?.transacao_id);
    if (id) ids.push(id);
  }
  if (payload.tef && payload.tef.transacao_id) {
    ids.push(payload.tef.transacao_id);
  }
  return [...new Set(ids)];
}

async function responderVendaComFiscal(res, payload) {
  const valorFiscal = Number(payload.valorFiscal || 0);
  const valorNaoFiscal = Number(payload.valorNaoFiscal || 0);
  const statusPagamento = resolverStatusPagamentoResposta(payload);

  const respostaBase = {
    id: payload.vendaId,
    venda_id: payload.vendaId,
    codigo: payload.codigo,
    message: payload.message,
    status: payload.statusVenda || 'concluida',
    status_pagamento: statusPagamento,
    valor_fiscal: valorFiscal,
    valor_nao_fiscal: valorNaoFiscal
  };

  if (!payload.emitirFiscal) {
    return res.json({
      ...respostaBase,
      fiscal: null
    });
  }

  if (Number(payload.valorFiscal || 0) <= 0) {
    return res.json({
      ...respostaBase,
      fiscal: null
    });
  }

  if (statusPagamento !== 'quitada') {
    return res.json({
      ...respostaBase,
      fiscal: {
        success: false,
        status: 'aguardando_pagamento',
        message: 'Aguardando pagamento não fiscal para emitir NFC-e.'
      }
    });
  }

  // RC8.2.2 — reprocessamento/reemissão amarra auditoria ao snapshot (não altera XML/cálculo)
  await new Promise((resolve) => {
    registrarPoliticaSnapshotReprocessamento(payload.vendaId, () => resolve());
  });

  try {
    const fiscal = await emitirPorVendaId(payload.vendaId);

    if (fiscal?.status === 'sem_itens_fiscais') {
      return res.json({
        ...respostaBase,
        fiscal
      });
    }

    // Vincular NFC-e às transações TEF autorizadas (se houver)
    // As transações TEF já foram processadas antes de gravar a venda
    // Aqui apenas vinculamos à NFC-e se necessário
    if (fiscal.success && fiscal.numero && fiscal.chave) {
      // Buscar transações TEF da venda para vincular
      db.all(`
        SELECT tef_transacao_id FROM venda_recebimentos
        WHERE venda_id = ? AND tef_transacao_id IS NOT NULL
      `, [payload.vendaId], async (err, rows) => {
        if (err) {
          console.error('Erro ao buscar transações TEF:', err);
          return;
        }

        for (const row of rows) {
          try {
            await tefManager.vincularNfce(row.tef_transacao_id, fiscal.numero, fiscal.chave);
            console.log(`NFC-e ${fiscal.numero} vinculada à transação TEF ${row.tef_transacao_id}`);
          } catch (vincError) {
            console.error(`Erro ao vincular NFC-e à transação TEF ${row.tef_transacao_id}:`, vincError);
          }
        }
      });
    }
    
    res.json({
      ...respostaBase,
      fiscal
    });
  } catch (error) {
    console.error('Erro ao emitir NFC-e:', error);

    const transacoesTef = coletarIdsTefAutorizados(payload);
    for (const transacaoId of transacoesTef) {
      try {
        await tefManager.cancelar(transacaoId, 'Falha na emissão NFC-e');
        console.log(`Transação TEF ${transacaoId} cancelada devido a falha na NFC-e`);
      } catch (cancelError) {
        console.error(`Erro ao cancelar transação TEF ${transacaoId}:`, cancelError);
      }
    }

    if (res.headersSent) {
      return;
    }

    return res.json({
      ...respostaBase,
      fiscal: {
        success: false,
        status: 'erro_emissao',
        message: error.message
      }
    });
  }
}

module.exports = {
  extrairTagXmlCancelamento,
  extrairCancelamentoSefaz,
  buscarNfceAutorizadaVenda,
  cancelarNfceAutorizadaVenda,
  vincularNfceTransacoesVenda,
  emitirFiscalSeSolicitado,
  responderVendaComFiscal,
  coletarIdsTefAutorizados,
  resolverStatusPagamentoResposta,
  registrarPoliticaSnapshotReprocessamento
};
