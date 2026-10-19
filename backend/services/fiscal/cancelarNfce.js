/**
 * Cancelamento NFC-e (modelo 65) — Motor Fiscal oficial.
 * Sprint 08.3: suporte a cancelamento por nfce_notas.id (Fechamento sem venda_id),
 * preservando o fluxo legado por venda_id.
 */
'use strict';

const { assinarEvento } = require('./signer');
const { carregarCertificadoPfx } = require('./certificateService');
const { compactarXml, extrairChaveEProtocoloAutorizados } = require('./utils');
const { obterDataHoraFiscalEstabelecimento } = require('./fiscalDateTime');
const { validarMotivoTexto } = require('../validacao/validarMotivoTexto');
const { enviarCancelamento } = require('./cancelamentoRuntime');
const {
  confirmarEventoCancelamentoNfce: confirmarEventoCancelamentoNfcePadrao
} = require('./NfceCancelamentoReconciliacaoService');

const CANCELAMENTOS_EM_ANDAMENTO = new Set();

function getDb(maybeDb) {
  return maybeDb || require('../../database');
}

function dbGet(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function dbRun(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function extrairCstatRetornoEvento(xml) {
  const retorno = String(xml || '');
  const eventos = [...retorno.matchAll(
    /<((?:[\w.-]+:)?retEvento)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi
  )];
  if (!eventos.length) return null;
  const infEvento = eventos[eventos.length - 1][2];
  const match = infEvento.match(
    /<(?:(?:[\w.-]+):)?cStat\b[^>]*>\s*([^<]*)\s*<\/(?:(?:[\w.-]+):)?cStat\s*>/i
  );
  return match ? match[1].trim() : null;
}

/**
 * Núcleo compartilhado: monta evento 110111 + envia via cancelamentoRuntime.
 * deps opcional para testes (sem SEFAZ real).
 */
async function executarCancelamentoNota(notaAutorizada, justificativa, deps = {}) {
  const getConfig = deps.getFiscalConfig
    || (() => require('./configService').getFiscalConfig());
  const enviar = deps.enviarCancelamento || enviarCancelamento;
  const assinar = deps.assinarEvento || assinarEvento;
  const carregarCert = deps.carregarCertificadoPfx || carregarCertificadoPfx;
  const database = getDb(deps.db);

  const config = await getConfig();
  const validacaoJustificativa = validarMotivoTexto(justificativa);
  if (!validacaoJustificativa.valido) {
    throw new Error(validacaoJustificativa.erro);
  }

  const authSefaz = extrairChaveEProtocoloAutorizados(notaAutorizada.xml_retorno);
  const chaveAcesso = authSefaz?.chaveAcesso || notaAutorizada.chave_acesso;
  const protocolo = authSefaz?.protocolo || notaAutorizada.protocolo;

  if (!/^\d{44}$/.test(String(chaveAcesso || '')) || !protocolo) {
    throw new Error('NFC-e autorizada sem chave ou protocolo.');
  }

  if (String(chaveAcesso).slice(20, 22) !== '65') {
    throw new Error('A chave selecionada não pertence a uma NFC-e modelo 65.');
  }

  const cnpjCertificado = String(config.cnpj || '').replace(/\D/g, '');
  if (cnpjCertificado && String(chaveAcesso).slice(6, 20) !== cnpjCertificado) {
    throw new Error('CNPJ da NFC-e não corresponde à empresa do certificado fiscal configurado.');
  }

  if (config.ambiente != null && Number(notaAutorizada.ambiente) !== Number(config.ambiente)) {
    throw new Error('Ambiente da NFC-e não corresponde ao ambiente fiscal configurado.');
  }

  if (authSefaz?.chaveAcesso && authSefaz.chaveAcesso !== notaAutorizada.chave_acesso) {
    console.warn(
      `[CANCELAMENTO] Corrigindo chave no banco: ${notaAutorizada.chave_acesso} -> ${authSefaz.chaveAcesso}`
    );
    await dbRun(
      database,
      `UPDATE nfce_notas
       SET chave_acesso = ?,
           protocolo = COALESCE(?, protocolo),
           updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [authSefaz.chaveAcesso, authSefaz.protocolo, notaAutorizada.id]
    );
  }

  const dataEvento = obterDataHoraFiscalEstabelecimento();
  const idLote = String(Date.now()).slice(-15);
  const nSeqEvento = '1';

  const eventoXml = `
    <evento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">
      <infEvento Id="ID110111${chaveAcesso}${nSeqEvento.padStart(2, '0')}">
        <cOrgao>${config.codigoUf}</cOrgao>
        <tpAmb>${config.ambiente}</tpAmb>
        <CNPJ>${String(config.cnpj || '').replace(/\D/g, '')}</CNPJ>
        <chNFe>${chaveAcesso}</chNFe>
        <dhEvento>${dataEvento}</dhEvento>
        <tpEvento>110111</tpEvento>
        <nSeqEvento>${nSeqEvento}</nSeqEvento>
        <verEvento>1.00</verEvento>
        <detEvento versao="1.00">
          <descEvento>Cancelamento</descEvento>
          <nProt>${protocolo}</nProt>
          <xJust>${justificativa.trim()}</xJust>
        </detEvento>
      </infEvento>
    </evento>
  `;

  const certificado = carregarCert(config.certificadoPath, config.certificadoSenha);
  const assinatura = assinar(
    compactarXml(eventoXml),
    certificado.privateKeyPem,
    certificado.certPem
  );
  const eventoAssinado = assinatura.xmlAssinado;

  const envEvento = `
    <envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
      <idLote>${idLote}</idLote>
      ${eventoAssinado}
    </envEvento>
  `;

  const soap = `<?xml version="1.0" encoding="utf-8"?>
    <soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                     xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                     xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
      <soap12:Header>
        <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">
          <cUF>${config.codigoUf}</cUF>
          <versaoDados>1.00</versaoDados>
        </nfeCabecMsg>
      </soap12:Header>
      <soap12:Body>
        <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">
          ${compactarXml(envEvento)}
        </nfeDadosMsg>
      </soap12:Body>
    </soap12:Envelope>`;

  const envio = await enviar({
    envelope: soap,
    ambiente: config.ambiente,
    cUF: config.codigoUf,
    chave: chaveAcesso,
    protocolo,
    xJust: justificativa.trim(),
    certificadoPath: config.certificadoPath,
    certificadoSenha: config.certificadoSenha
  });

  if (!envio.success) {
    throw new Error(envio.error || 'Falha no cancelamento SEFAZ.');
  }

  let confirmacaoCancelamento = null;
  if (extrairCstatRetornoEvento(envio.body) === '573') {
    const confirmarEvento = deps.confirmarEventoCancelamentoNfce
      || confirmarEventoCancelamentoNfcePadrao;
    confirmacaoCancelamento = await confirmarEvento({
      chave: chaveAcesso,
      cnpj: cnpjCertificado,
      codigoUf: String(config.codigoUf || '').replace(/\D/g, '').padStart(2, '0'),
      ambiente: Number(config.ambiente),
      protocoloAutorizacao: protocolo,
      certificadoPath: config.certificadoPath,
      certificadoSenha: config.certificadoSenha,
      consultarProtocolo: deps.consultarProtocolo
    });
  }

  return {
    sefaz: envio.body,
    notaId: notaAutorizada.id,
    chaveAcesso,
    protocolo,
    confirmacaoCancelamento,
    source: envio.source,
    fallbackUtilizado: envio.fallbackUtilizado
  };
}

/** Fluxo legado: localiza NFC-e autorizada pela venda e cancela. */
async function cancelarNfce(vendaId, justificativa, deps = {}) {
  if (!vendaId) {
    throw new Error('venda_id é obrigatório para cancelar NFC-e.');
  }

  const validacaoJustificativa = validarMotivoTexto(justificativa);
  if (!validacaoJustificativa.valido) {
    throw new Error(validacaoJustificativa.erro);
  }

  const database = getDb(deps.db);
  const notaAutorizada = await dbGet(
    database,
    `SELECT *
     FROM nfce_notas
     WHERE venda_id = ?
       AND status IN ('autorizada', 'cancelamento_rejeitado')
       AND (
         (chave_acesso IS NOT NULL AND chave_acesso <> '')
         OR (xml_retorno IS NOT NULL AND xml_retorno LIKE '%<cStat>100</cStat>%')
       )
     ORDER BY id DESC
     LIMIT 1`,
    [vendaId]
  );

  if (!notaAutorizada) {
    throw new Error('Nenhuma NFC-e autorizada encontrada para cancelar.');
  }

  return executarCancelamentoNota(notaAutorizada, justificativa, deps);
}

/**
 * Cancelamento por id da NFC-e (Fechamento Fiscal / documento sem venda).
 * Reutiliza o mesmo motor (evento 110111 + cancelamentoRuntime).
 */
async function cancelarNfcePorId(nfceId, justificativa, deps = {}) {
  const id = Number(nfceId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('nfce_id é obrigatório para cancelar NFC-e.');
  }

  const validacaoJustificativa = validarMotivoTexto(justificativa);
  if (!validacaoJustificativa.valido) {
    throw new Error(validacaoJustificativa.erro);
  }

  const database = getDb(deps.db);
  if (CANCELAMENTOS_EM_ANDAMENTO.has(id)) {
    const err = new Error('Cancelamento já em andamento para esta NFC-e.');
    err.statusCode = 409;
    err.code = 'CONCORRENCIA';
    throw err;
  }

  CANCELAMENTOS_EM_ANDAMENTO.add(id);
  try {
    const nota = await dbGet(database, `SELECT * FROM nfce_notas WHERE id = ?`, [id]);
    if (!nota) {
      const err = new Error('NFC-e não encontrada.');
      err.statusCode = 404;
      throw err;
    }

    const st = String(nota.status || '').toLowerCase();
    const claimAdquirido = deps.cancelamentoClaimed === true
      && st === 'cancelamento_em_andamento';
    if (st === 'cancelada') {
      const err = new Error('NFC-e já cancelada.');
      err.statusCode = 409;
      err.code = 'JA_CANCELADA';
      err.nota = nota;
      throw err;
    }

    if (!['autorizada', 'cancelamento_rejeitado'].includes(st) && !claimAdquirido) {
      const err = new Error('Somente NFC-e autorizada pode ser cancelada.');
      err.statusCode = ['cancelamento_em_andamento', 'cancelamento_desconhecido'].includes(st)
        ? 409
        : 400;
      err.code = st === 'cancelamento_desconhecido' ? 'RESULTADO_DESCONHECIDO' : null;
      throw err;
    }

    if (!nota.chave_acesso && !(nota.xml_retorno && String(nota.xml_retorno).includes('<cStat>100</cStat>'))) {
      const err = new Error('NFC-e sem chave de acesso válida.');
      err.statusCode = 400;
      throw err;
    }

    return await executarCancelamentoNota(nota, justificativa, deps);
  } finally {
    CANCELAMENTOS_EM_ANDAMENTO.delete(id);
  }
}

cancelarNfce.cancelarNfce = cancelarNfce;
cancelarNfce.cancelarNfcePorId = cancelarNfcePorId;
cancelarNfce.executarCancelamentoNota = executarCancelamentoNota;

module.exports = cancelarNfce;
