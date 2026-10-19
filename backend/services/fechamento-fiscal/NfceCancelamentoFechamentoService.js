/**
 * Sprint 08.3 — Cancelamento fiscal de NFC-e originada pelo Fechamento Fiscal do Dia.
 * Reutiliza Motor Fiscal (cancelarNfcePorId → cancelamentoRuntime).
 * NÃO cria venda, NÃO altera estoque/financeiro.
 */
'use strict';

const { validarMotivoTexto } = require('../validacao/validarMotivoTexto');
const { ORIGEM_FECHAMENTO } = require('./NfceHistoricoOficialService');
const { STATUS, DOC_STATUS } = require('./constants');
const { appendXmlRetornoNfce } = require('../fiscal/xmlRetornoNfce');
const {
  montarDiagnosticoCancelamento,
  logPrazoCancelamento
} = require('../fiscal/fiscalDateTime');

const LOCKS = new Map();
const CSTAT_CANCEL_OK = new Set(['135', '155']);
const CSTAT_REJEICAO = new Set(['501', '631']);

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function extrairTagXml(xml, tag) {
  const regex = new RegExp('<' + tag + '>(.*?)</' + tag + '>', 'i');
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
    cStatLote: extrairTagXml(retornoAtual, 'cStat'),
    xMotivoLote: extrairTagXml(retornoAtual, 'xMotivo'),
    cStatEvento: extrairTagXml(blocoEvento, 'cStat'),
    xMotivoEvento: extrairTagXml(blocoEvento, 'xMotivo'),
    protocoloCancelamento: extrairTagXml(blocoEvento, 'nProt'),
    dataCancelamento: extrairTagXml(blocoEvento, 'dhRegEvento')
  };
}

function isFechamentoOrigin(nota) {
  return String(nota.origem || '') === ORIGEM_FECHAMENTO
    || (nota.fechamento_fiscal_id != null && !nota.venda_id);
}

function logCancelamento(payload) {
  const seguro = Object.assign({}, payload);
  delete seguro.certificado;
  delete seguro.senha;
  delete seguro.csc;
  console.log('[CANCELAMENTO_FISCAL]', JSON.stringify(seguro));
}

async function snapshotComercial(db) {
  const vendas = await get(db, 'SELECT COUNT(*) AS c FROM vendas').catch(() => ({ c: null }));
  const itens = await get(db, 'SELECT COUNT(*) AS c FROM vendas_itens').catch(() => ({ c: null }));
  const fin = await get(db, 'SELECT COUNT(*) AS c FROM financeiro').catch(() => ({ c: null }));
  const prod = await get(db, 'SELECT COALESCE(SUM(estoque),0) AS e FROM produtos').catch(() => ({ e: null }));
  return {
    vendas: vendas && vendas.c,
    vendas_itens: itens && itens.c,
    financeiro: fin && fin.c,
    estoque_sum: prod && prod.e
  };
}

function formatarRotuloFechamento(fechamentoId) {
  const n = Number(fechamentoId || 0);
  return 'FF-' + String(n).padStart(6, '0');
}

/**
 * Cancela NFC-e do Fechamento por nfce_notas.id.
 * deps.cancelarNfcePorId injetável para testes (sem SEFAZ).
 */
async function cancelarDocumentoFiscalFechamento(db, nfceId, justificativa, opts) {
  opts = opts || {};
  const inicio = Date.now();
  const id = Number(nfceId);
  const usuario = opts.usuario || {};
  const deps = opts.deps || {};

  const validacao = validarMotivoTexto(justificativa);
  if (!validacao.valido) {
    const err = new Error(validacao.erro);
    err.statusCode = 400;
    throw err;
  }

  if (!id) {
    const err = new Error('nfce_id inválido.');
    err.statusCode = 400;
    throw err;
  }

  if (LOCKS.has(id)) {
    const err = new Error('Cancelamento já em andamento para este documento.');
    err.statusCode = 409;
    err.code = 'CONCORRENCIA';
    throw err;
  }

  LOCKS.set(id, Date.now());

  try {
    const nota = await get(db, 'SELECT * FROM nfce_notas WHERE id = ?', [id]);
    if (!nota) {
      const err = new Error('NFC-e não encontrada.');
      err.statusCode = 404;
      throw err;
    }

    if (!isFechamentoOrigin(nota)) {
      const err = new Error('Documento não é NFC-e de Fechamento Fiscal do Dia.');
      err.statusCode = 400;
      throw err;
    }

    if (nota.venda_id != null && Number(nota.venda_id) > 0) {
      const err = new Error('NFC-e de fechamento não deve possuir venda_id.');
      err.statusCode = 400;
      throw err;
    }

    const st = String(nota.status || '').toLowerCase();
    if (st === 'cancelada') {
      logCancelamento({
        nfce_id: id,
        fechamento_id: nota.fechamento_fiscal_id,
        numero: nota.numero,
        serie: nota.serie,
        chave: nota.chave_acesso,
        ambiente: nota.ambiente,
        resultado: 'IDEMPOTENTE_JA_CANCELADA',
        usuario: usuario.id || null,
        duracao: Date.now() - inicio
      });
      return {
        ok: true,
        idempotente: true,
        success: true,
        message: 'NFC-e já cancelada.',
        status: 'cancelada',
        notaId: id,
        chaveAcesso: nota.chave_acesso,
        numero: nota.numero,
        serie: nota.serie,
        venda_id: null,
        fechamento_fiscal_id: nota.fechamento_fiscal_id,
        protocoloCancelamento: null,
        dadosCancelamento: null
      };
    }

    if (['autorizada', 'cancelamento_rejeitado'].indexOf(st) < 0) {
      const err = new Error('Somente NFC-e autorizada pode ser cancelada por este fluxo.');
      err.statusCode = 400;
      throw err;
    }

    if (!nota.chave_acesso || String(nota.chave_acesso).length < 44) {
      const err = new Error('Chave de acesso inválida.');
      err.statusCode = 400;
      throw err;
    }

    if (!nota.protocolo) {
      const err = new Error('Protocolo de autorização ausente.');
      err.statusCode = 400;
      throw err;
    }

    // O prazo é diagnóstico; a aceitação da tentativa cabe à SEFAZ.
    const diagBase = montarDiagnosticoCancelamento(nota, deps.agora || new Date());
    logPrazoCancelamento(diagBase);

    const snapAntes = deps.skipSnapshot ? null : await snapshotComercial(db);

    const claim = await run(
      db,
      `UPDATE nfce_notas
       SET status = 'cancelamento_em_andamento',
           updated_at = datetime('now', 'localtime')
       WHERE id = ? AND status IN ('autorizada', 'cancelamento_rejeitado')`,
      [id]
    );
    if (claim.changes !== 1) {
      const err = new Error('NFC-e já possui cancelamento em andamento ou estado fiscal alterado.');
      err.statusCode = 409;
      err.code = 'CONCORRENCIA';
      throw err;
    }

    const cancelarPorId = deps.cancelarNfcePorId
      || require('../fiscal/cancelarNfce').cancelarNfcePorId;

    let cancelamento;
    try {
      cancelamento = await cancelarPorId(
        id,
        String(justificativa).trim(),
        Object.assign({}, deps, { db: db, cancelamentoClaimed: true })
      );
    } catch (error) {
      await run(
        db,
        `UPDATE nfce_notas
         SET status = 'cancelamento_desconhecido',
             updated_at = datetime('now', 'localtime')
         WHERE id = ? AND status = 'cancelamento_em_andamento'`,
        [id]
      );
      error.statusCode = error.statusCode || 409;
      error.code = error.code || 'RESULTADO_DESCONHECIDO';
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
    const cStat = String(dadosCancelamento.cStatEvento || '');
    const loteProcessado = confirmadoPorConsulta
      || String(dadosCancelamento.cStatLote || '') === '128';
    const canceladoComSucesso = confirmadoPorConsulta
      || (loteProcessado && CSTAT_CANCEL_OK.has(cStat));
    const rejeicaoConhecida = !confirmadoPorConsulta && loteProcessado && CSTAT_REJEICAO.has(cStat);

    logPrazoCancelamento(diagBase, {
      cStat: cStat || null,
      xMotivo: dadosCancelamento.xMotivoEvento || null
    });

    if (!canceladoComSucesso && rejeicaoConhecida) {
      const motivo = dadosCancelamento.xMotivoEvento || 'Cancelamento rejeitado pela SEFAZ.';
      const retornoRejeitado = await run(
        db,
        `UPDATE nfce_notas
         SET status = 'autorizada',
             xml_retorno = ?,
             updated_at = datetime('now', 'localtime')
         WHERE id = ? AND status = 'cancelamento_em_andamento'`,
        [appendXmlRetornoNfce(nota.xml_retorno, retornoPersistido), id]
      );
      if (retornoRejeitado.changes !== 1) {
        const erroPersistencia = new Error('Falha ao persistir a rejeição; NFC-e permanece bloqueada para reconciliação.');
        erroPersistencia.statusCode = 500;
        erroPersistencia.code = 'PERSISTENCIA_CANCELAMENTO_INDETERMINADA';
        throw erroPersistencia;
      }

      logCancelamento({
        nfce_id: id,
        fechamento_id: nota.fechamento_fiscal_id,
        numero: nota.numero,
        serie: nota.serie,
        chave: nota.chave_acesso,
        ambiente: nota.ambiente,
        resultado: 'REJEITADO',
        cStat: cStat,
        protocolo: dadosCancelamento.protocoloCancelamento,
        usuario: usuario.id || null,
        duracao: Date.now() - inicio
      });

      const err = new Error(
        cStat === '501'
          ? `Cancelamento rejeitado pela SEFAZ (cStat 501): ${motivo}`
          : motivo
      );
      err.statusCode = 400;
      err.code = cStat === '501' ? 'SEFAZ_PRAZO_501' : 'SEFAZ_REJEICAO';
      err.dadosCancelamento = dadosCancelamento;
      err.diagnostico = Object.assign({}, diagBase, {
        cStat: cStat,
        xMotivo: dadosCancelamento.xMotivoEvento,
        status: 'autorizada'
      });
      err.success = false;
      err.status = 'autorizada';
      throw err;
    }

    if (!canceladoComSucesso) {
      await run(
        db,
        `UPDATE nfce_notas
         SET status = 'cancelamento_desconhecido',
             xml_retorno = ?,
             updated_at = datetime('now', 'localtime')
         WHERE id = ? AND status = 'cancelamento_em_andamento'`,
        [appendXmlRetornoNfce(nota.xml_retorno, retornoPersistido), id]
      );
      const err = new Error(
        cStat === '136'
          ? 'cStat 136 informa evento registrado, mas não vinculado; sem confirmação documental da situação desta NFC-e.'
          : cStat === '573'
            ? `cStat 573: a duplicidade não comprova o cancelamento; ${confirmacao?.motivo || 'o evento 110111 não foi validado oficialmente'}. A NFC-e permanece bloqueada para reconciliação.`
          : 'Retorno fiscal desconhecido; a NFC-e foi bloqueada para nova tentativa.'
      );
      err.statusCode = 409;
      err.code = cStat === '136'
        ? 'PENDENCIA_DOCUMENTAL_CSTAT_136'
        : (cStat === '573' ? 'PENDENCIA_RECONCILIACAO_CSTAT_573' : 'RESULTADO_DESCONHECIDO');
      err.status = 'cancelamento_desconhecido';
      err.dadosCancelamento = dadosCancelamento;
      throw err;
    }

    const retornoFinal = await run(
      db,
      `UPDATE nfce_notas
       SET status = 'cancelada',
           xml_retorno = ?,
           updated_at = datetime('now', 'localtime')
       WHERE id = ? AND status = 'cancelamento_em_andamento'`,
      [appendXmlRetornoNfce(nota.xml_retorno, retornoTexto), id]
    );
    if (retornoFinal.changes !== 1) {
      const err = new Error('Falha ao persistir o resultado fiscal; NFC-e permanece bloqueada para reconciliação.');
      err.statusCode = 500;
      err.code = 'PERSISTENCIA_CANCELAMENTO_INDETERMINADA';
      throw err;
    }

    if (nota.fechamento_documento_id) {
      await run(
        db,
        'UPDATE fechamentos_fiscais_documentos SET status = ?, cstat = COALESCE(?, cstat), xmotivo = COALESCE(?, xmotivo), atualizado_em = datetime(\'now\', \'localtime\') WHERE id = ?',
        [
          DOC_STATUS.CANCELADO,
          dadosCancelamento.cStatEvento || '135',
          dadosCancelamento.xMotivoEvento || 'Cancelamento homologado',
          nota.fechamento_documento_id
        ]
      ).catch(function () {});
    }

    if (nota.fechamento_fiscal_id) {
      await run(
        db,
        'UPDATE fechamentos_fiscais SET status = ?, atualizado_em = datetime(\'now\', \'localtime\') WHERE id = ? AND status = ?',
        [STATUS.CANCELADO, nota.fechamento_fiscal_id, STATUS.AUTORIZADO]
      ).catch(function () {});
    }

    const snapDepois = deps.skipSnapshot ? null : await snapshotComercial(db);
    const notaFinal = await get(db, 'SELECT * FROM nfce_notas WHERE id = ?', [id]);

    logCancelamento({
      documento_id: nota.fechamento_documento_id,
      nfce_id: id,
      fechamento_id: nota.fechamento_fiscal_id,
      numero: nota.numero,
      serie: nota.serie,
      chave: nota.chave_acesso,
      ambiente: nota.ambiente,
      resultado: 'AUTORIZADO',
      cStat: dadosCancelamento.cStatEvento || '135',
      protocolo: dadosCancelamento.protocoloCancelamento,
      usuario: usuario.id || null,
      duracao: Date.now() - inicio
    });

    return {
      ok: true,
      idempotente: false,
      success: true,
      message: 'NFC-e cancelada com sucesso.',
      status: 'cancelada',
      notaId: id,
      chaveAcesso: (notaFinal && notaFinal.chave_acesso) || nota.chave_acesso,
      numero: notaFinal && notaFinal.numero,
      serie: notaFinal && notaFinal.serie,
      venda_id: null,
      fechamento_fiscal_id: nota.fechamento_fiscal_id,
      protocoloCancelamento: dadosCancelamento.protocoloCancelamento || null,
      dataCancelamento: dadosCancelamento.dataCancelamento || null,
      dadosCancelamento: dadosCancelamento,
      xml_enviado_preservado: Boolean(notaFinal && notaFinal.xml_enviado),
      protecao: {
        snapshot_antes: snapAntes,
        snapshot_depois: snapDepois,
        comercial_inalterado: snapAntes && snapDepois
          ? JSON.stringify(snapAntes) === JSON.stringify(snapDepois)
          : true
      }
    };
  } finally {
    LOCKS.delete(id);
  }
}

module.exports = {
  cancelarDocumentoFiscalFechamento: cancelarDocumentoFiscalFechamento,
  extrairCancelamentoSefaz: extrairCancelamentoSefaz,
  isFechamentoOrigin: isFechamentoOrigin,
  formatarRotuloFechamento: formatarRotuloFechamento,
  diagnosticarCancelamentoNfce: async function diagnosticarCancelamentoNfce(db, nfceId, opts) {
    const id = Number(nfceId);
    const nota = await get(db, 'SELECT * FROM nfce_notas WHERE id = ?', [id]);
    if (!nota) {
      const err = new Error('NFC-e não encontrada.');
      err.statusCode = 404;
      throw err;
    }
    return montarDiagnosticoCancelamento(nota, (opts && opts.agora) || new Date(), opts || {});
  },
  CSTAT_CANCEL_OK: CSTAT_CANCEL_OK,
  LOCKS: LOCKS
};
