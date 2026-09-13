/**
 * Cancelamento NF-e modelo 55 — reutiliza cancelamentoRuntime (mesmo evento 110111).
 * Sprint 3.3 — não altera cancelarNfce (NFC-e).
 */

'use strict';

const db = require('../../database');
const { getFiscalConfig } = require('./configService');
const { assinarEvento } = require('./signer');
const { carregarCertificadoPfx } = require('./certificateService');
const { compactarXml, extrairChaveEProtocoloAutorizados } = require('./utils');
const { validarMotivoTexto } = require('../validacao/validarMotivoTexto');
const { enviarCancelamento } = require('./cancelamentoRuntime');
const { ModelType } = require('./core/ModelType');

function getCancelamentoUrlNfe(ambiente) {
  return Number(ambiente) === 1
    ? 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx'
    : 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx';
}

/** Prazo legal padrão: 24h após emissão (SEFAZ é a autoridade final). */
function validarPrazoCancelamento(nota) {
  const ref = nota.created_at || nota.updated_at;
  if (!ref) return { ok: true };
  const emitidaEm = new Date(String(ref).replace(' ', 'T'));
  if (Number.isNaN(emitidaEm.getTime())) return { ok: true };
  const diffH = (Date.now() - emitidaEm.getTime()) / 3600000;
  if (diffH > 24) {
    return {
      ok: false,
      erro: `Prazo legal de cancelamento provavelmente expirado (${diffH.toFixed(1)}h desde a emissão). A SEFAZ pode rejeitar (cStat 501).`
    };
  }
  return { ok: true };
}

async function cancelarNfe(notaId, justificativa, { forcarPrazo = false } = {}) {
  const config = await getFiscalConfig();
  const id = Number(notaId);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error('nota_id inválido.'), { statusCode: 400 });
  }

  const validacaoJustificativa = validarMotivoTexto(justificativa);
  if (!validacaoJustificativa.valido) {
    throw Object.assign(new Error(validacaoJustificativa.erro), { statusCode: 400 });
  }

  const nota = await new Promise((resolve, reject) => {
    db.get(`
      SELECT * FROM nfe_notas
      WHERE id = ?
        AND status IN ('autorizada', 'cancelamento_rejeitado')
        AND chave_acesso IS NOT NULL AND chave_acesso <> ''
      ORDER BY id DESC LIMIT 1
    `, [id], (err, row) => (err ? reject(err) : resolve(row || null)));
  });

  if (!nota) {
    throw Object.assign(new Error('Nenhuma NF-e autorizada encontrada para cancelar.'), { statusCode: 404 });
  }

  if (!forcarPrazo) {
    const prazo = validarPrazoCancelamento(nota);
    if (!prazo.ok) {
      throw Object.assign(new Error(prazo.erro), { statusCode: 400, codigo: 'PRAZO_CANCELAMENTO' });
    }
  }

  const authSefaz = extrairChaveEProtocoloAutorizados(nota.xml_retorno || '');
  const chaveAcesso = authSefaz?.chaveAcesso || nota.chave_acesso;
  const protocolo = authSefaz?.protocolo || nota.protocolo;
  if (!chaveAcesso || !protocolo) {
    throw Object.assign(new Error('NF-e autorizada sem chave ou protocolo.'), { statusCode: 400 });
  }

  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const dataEvento = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}-03:00`;
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
    </evento>`;

  const certificado = carregarCertificadoPfx(config.certificadoPath, config.certificadoSenha);
  const assinatura = assinarEvento(
    compactarXml(eventoXml),
    certificado.privateKeyPem,
    certificado.certPem
  );

  const envEvento = `
    <envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
      <idLote>${idLote}</idLote>
      ${assinatura.xmlAssinado}
    </envEvento>`;

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

  const envio = await enviarCancelamento({
    envelope: soap,
    modelo: ModelType.NFE,
    ambiente: config.ambiente,
    cUF: config.codigoUf,
    chave: chaveAcesso,
    protocolo,
    xJust: justificativa.trim(),
    certificadoPath: config.certificadoPath,
    certificadoSenha: config.certificadoSenha,
    url: getCancelamentoUrlNfe(config.ambiente)
  });

  if (!envio.success) {
    throw Object.assign(new Error(envio.error || 'Falha no cancelamento SEFAZ.'), { statusCode: 502, body: envio });
  }

  const raw = String(envio.body || '');
  const cStatOk = /<cStat>135<\/cStat>|<cStat>136<\/cStat>|<cStat>155<\/cStat>/.test(raw);
  const statusNovo = cStatOk ? 'cancelada' : 'cancelamento_rejeitado';
  const protEvento = (raw.match(/<nProt>(\d+)<\/nProt>/) || [])[1] || null;

  await new Promise((resolve, reject) => {
    db.run(`
      UPDATE nfe_notas SET
        status = ?,
        protocolo_cancelamento = COALESCE(?, protocolo_cancelamento),
        xml_cancelamento = ?,
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `, [statusNovo, protEvento, raw, nota.id], (err) => (err ? reject(err) : resolve()));
  });

  return {
    success: cStatOk,
    status: statusNovo,
    notaId: nota.id,
    chaveAcesso,
    protocolo,
    protocoloCancelamento: protEvento,
    sefaz: raw,
    source: envio.source
  };
}

module.exports = {
  cancelarNfe,
  validarPrazoCancelamento,
  getCancelamentoUrlNfe
};
