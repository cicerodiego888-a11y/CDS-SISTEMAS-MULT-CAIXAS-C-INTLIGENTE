'use strict';

const db = require('../../database');
const { emitirPorVendaId } = require('../fiscal/emissor');
const cancelarNfce = require('../fiscal/cancelarNfce');
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
  const blocoEventoMatch = texto.match(/<retEvento[\s\S]*?<\/retEvento>/i);
  const blocoEvento = blocoEventoMatch ? blocoEventoMatch[0] : texto;

  return {
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

async function cancelarNfceAutorizadaVenda(vendaId, justificativa) {
  const cancelamento = await cancelarNfce(vendaId, justificativa.trim());
  const retornoTexto = typeof cancelamento.sefaz === 'string'
    ? cancelamento.sefaz
    : JSON.stringify(cancelamento.sefaz);
  const dadosCancelamento = extrairCancelamentoSefaz(retornoTexto);
  const canceladoComSucesso =
    String(dadosCancelamento.cStatEvento) === '135' ||
    String(dadosCancelamento.cStatEvento) === '136' ||
    String(dadosCancelamento.cStatEvento) === '155';

  if (!canceladoComSucesso) {
    throw new Error(dadosCancelamento.xMotivoEvento || 'Cancelamento de NFC-e rejeitado pela SEFAZ.');
  }

  await new Promise((resolve, reject) => {
    const resumoCancelamento = `
STATUS CANCELAMENTO: cancelada
cStatEvento: ${dadosCancelamento.cStatEvento || ''}
xMotivoEvento: ${dadosCancelamento.xMotivoEvento || ''}
protocoloCancelamento: ${dadosCancelamento.protocoloCancelamento || ''}
dataCancelamento: ${dadosCancelamento.dataCancelamento || ''}
justificativa: ${justificativa.trim()}
`;

    db.run(`
      UPDATE nfce_notas
      SET status = 'cancelada',
          xml_retorno = COALESCE(xml_retorno, '') || char(10) || ? || char(10) || ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `, [resumoCancelamento, retornoTexto, cancelamento.notaId], (updErr) => {
      if (updErr) return reject(updErr);
      resolve();
    });
  });
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
