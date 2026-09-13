/**
 * Sprint 08.3 — Cancelamento fiscal de NFC-e originada pelo Fechamento Fiscal do Dia.
 * Reutiliza Motor Fiscal (cancelarNfcePorId → cancelamentoRuntime).
 * NÃO cria venda, NÃO altera estoque/financeiro.
 */
'use strict';

const { validarMotivoTexto } = require('../validacao/validarMotivoTexto');
const { ORIGEM_FECHAMENTO } = require('./NfceHistoricoOficialService');
const { STATUS, DOC_STATUS } = require('./constants');
const {
  calcularPrazoCancelamentoNfce,
  montarDiagnosticoCancelamento,
  logPrazoCancelamento,
  obterDataHoraFiscalEstabelecimento
} = require('../fiscal/fiscalDateTime');

const LOCKS = new Map();
const CSTAT_CANCEL_OK = new Set(['135', '136', '155']);
const CSTAT_FORA_PRAZO = new Set(['501']);

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
  const blocoEventoMatch = texto.match(/<retEvento[\s\S]*?<\/retEvento>/i);
  const blocoEvento = blocoEventoMatch ? blocoEventoMatch[0] : texto;
  return {
    cStatLote: extrairTagXml(texto, 'cStat'),
    xMotivoLote: extrairTagXml(texto, 'xMotivo'),
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

    // Sprint 08.4 — pré-validação de prazo (30 min CE). SEFAZ continua autoridade final.
    const prazo = deps.prazoOverride || calcularPrazoCancelamentoNfce(nota, deps.agora || new Date());
    const diagBase = montarDiagnosticoCancelamento(nota, deps.agora || new Date());
    logPrazoCancelamento(diagBase);

    if (!prazo.dentro_prazo && !deps.ignorarPrazoLocal) {
      const err = new Error(prazo.mensagem || 'A NFC-e está fora do prazo normal de cancelamento para este estabelecimento.');
      err.statusCode = 400;
      err.code = 'CANCELAMENTO_FORA_DO_PRAZO';
      err.diagnostico = diagBase;
      err.prazo = prazo;
      throw err;
    }

    const snapAntes = deps.skipSnapshot ? null : await snapshotComercial(db);

    const cancelarPorId = deps.cancelarNfcePorId
      || require('../fiscal/cancelarNfce').cancelarNfcePorId;

    const cancelamento = await cancelarPorId(id, String(justificativa).trim(), Object.assign({ db: db }, deps));

    const retornoTexto = typeof cancelamento.sefaz === 'string'
      ? cancelamento.sefaz
      : JSON.stringify(cancelamento.sefaz);

    const dadosCancelamento = extrairCancelamentoSefaz(retornoTexto);
    const cStat = String(dadosCancelamento.cStatEvento || '');
    const canceladoComSucesso = CSTAT_CANCEL_OK.has(cStat) || Boolean(deps.forcarSucesso);
    const rejeicaoPrazo = CSTAT_FORA_PRAZO.has(cStat);

    logPrazoCancelamento(diagBase, {
      cStat: cStat || null,
      xMotivo: dadosCancelamento.xMotivoEvento || null
    });

    if (!canceladoComSucesso) {
      // cStat 501 e demais rejeições: NFC-e permanece AUTORIZADA
      const motivo = dadosCancelamento.xMotivoEvento || 'Cancelamento rejeitado pela SEFAZ.';
      const resumoRej = [
        'STATUS CANCELAMENTO: rejeitado',
        'nfce_status_mantido: autorizada',
        'cStatEvento: ' + (dadosCancelamento.cStatEvento || ''),
        'xMotivoEvento: ' + (dadosCancelamento.xMotivoEvento || ''),
        'protocoloCancelamento: ' + (dadosCancelamento.protocoloCancelamento || ''),
        'dhRegEvento: ' + (dadosCancelamento.dataCancelamento || ''),
        'dh_autorizacao: ' + (prazo.dh_autorizacao || ''),
        'dh_tentativa: ' + obterDataHoraFiscalEstabelecimento(),
        'justificativa: ' + String(justificativa).trim()
      ].join('\n');
      await run(
        db,
        "UPDATE nfce_notas SET xml_retorno = COALESCE(xml_retorno, '') || char(10) || ? || char(10) || ?, updated_at = datetime('now', 'localtime') WHERE id = ? AND status != 'cancelada'",
        [resumoRej, retornoTexto, id]
      );

      // Garante que status não virou cancelada
      await run(
        db,
        "UPDATE nfce_notas SET status = 'autorizada' WHERE id = ? AND status NOT IN ('cancelada')",
        [id]
      ).catch(function () {});

      logCancelamento({
        nfce_id: id,
        fechamento_id: nota.fechamento_fiscal_id,
        numero: nota.numero,
        serie: nota.serie,
        chave: nota.chave_acesso,
        ambiente: nota.ambiente,
        resultado: rejeicaoPrazo ? 'REJEITADO_PRAZO_501' : 'REJEITADO',
        cStat: cStat,
        protocolo: dadosCancelamento.protocoloCancelamento,
        usuario: usuario.id || null,
        duracao: Date.now() - inicio
      });

      const err = new Error(
        rejeicaoPrazo
          ? 'Cancelamento rejeitado pela SEFAZ (cStat 501): prazo de cancelamento superior ao previsto na legislação.'
          : motivo
      );
      err.statusCode = 400;
      err.code = rejeicaoPrazo ? 'SEFAZ_PRAZO_501' : 'SEFAZ_REJEICAO';
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

    const resumoOk = [
      'STATUS CANCELAMENTO: cancelada',
      'cStatEvento: ' + (dadosCancelamento.cStatEvento || (deps.forcarSucesso ? '135' : '')),
      'xMotivoEvento: ' + (dadosCancelamento.xMotivoEvento || 'Evento registrado'),
      'protocoloCancelamento: ' + (dadosCancelamento.protocoloCancelamento || ''),
      'dataCancelamento: ' + (dadosCancelamento.dataCancelamento || ''),
      'justificativa: ' + String(justificativa).trim(),
      'origem: fechamento_fiscal_dia',
      'fechamento_id: ' + (nota.fechamento_fiscal_id || '')
    ].join('\n');

    await run(
      db,
      "UPDATE nfce_notas SET status = 'cancelada', xml_retorno = COALESCE(xml_retorno, '') || char(10) || ? || char(10) || ?, updated_at = datetime('now', 'localtime') WHERE id = ? AND status IN ('autorizada', 'cancelamento_rejeitado')",
      [resumoOk, retornoTexto, id]
    );

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
