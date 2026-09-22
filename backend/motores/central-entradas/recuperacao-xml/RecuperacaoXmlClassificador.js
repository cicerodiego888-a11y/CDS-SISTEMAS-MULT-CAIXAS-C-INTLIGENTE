/**
 * Classifica retorno consChNFe / DistDFe para o ciclo de recuperação (Sprint 2).
 *
 * @module motores/central-entradas/recuperacao-xml/RecuperacaoXmlClassificador
 */
'use strict';

const { StatusRecuperacaoXml } = require('./StatusRecuperacaoXml');
const { DocumentoDfeTipo } = require('../core/DocumentoDfeTipo');
const { DocumentoFiscalStatus, normalizarStatus } = require('../core/DocumentoFiscalStatus');

/**
 * @param {Object} params
 * @param {Object|null} params.resultadoConsulta
 * @param {Object|null} params.documentoAtualizado
 * @param {Error|null} [params.erro]
 * @returns {{
 *   caso: string,
 *   statusRecuperacao: string,
 *   xmlCompleto: boolean,
 *   aguardando: boolean,
 *   esgotar: boolean,
 *   gateBloqueado: boolean,
 *   cStat: string|null,
 *   xMotivo: string|null,
 *   codigoErro: string|null,
 *   recuperavel: boolean,
 *   mensagem: string
 * }}
 */
function classificarResultadoRecuperacao({
  resultadoConsulta = null,
  documentoAtualizado = null,
  erro = null
} = {}) {
  if (erro) {
    const codigo = String(erro.codigo || erro.erro || '').toUpperCase()
      || classificarMensagemErro(erro.message || '');
    const gateBloqueado = [
      'ERRO_COOLDOWN',
      'ERRO_RATE_LIMIT',
      'ERRO_CIRCUIT_BREAKER',
      'ERRO_CONCORRENCIA'
    ].includes(codigo)
      || Boolean(erro.sefazGate && (erro.cstat === '656' || erro.cstat === '137'));

    const cStat = erro.cstat != null ? String(erro.cstat) : null;
    if (cStat === '656' || cStat === '137') {
      return {
        caso: cStat === '656' ? 'CSTAT_656' : 'CSTAT_137',
        statusRecuperacao: StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO,
        xmlCompleto: false,
        aguardando: true,
        esgotar: false,
        gateBloqueado: true,
        cStat,
        xMotivo: erro.xmotivo || erro.message || null,
        codigoErro: codigo || (cStat === '656' ? 'ERRO_COOLDOWN' : 'ERRO_COOLDOWN'),
        recuperavel: true,
        mensagem: cStat === '656'
          ? 'Consumo indevido (656) — aguardar cooldown do Gate.'
          : 'cStat 137 — aguardar cooldown do Gate.'
      };
    }

    return {
      caso: 'ERRO_TECNICO',
      statusRecuperacao: StatusRecuperacaoXml.ERRO_RECUPERACAO,
      xmlCompleto: false,
      aguardando: false,
      esgotar: false,
      gateBloqueado,
      cStat,
      xMotivo: erro.message || null,
      codigoErro: codigo || 'ERRO_SEFAZ',
      recuperavel: isRecuperavelCodigo(codigo),
      mensagem: erro.message || 'Erro técnico na recuperação'
    };
  }

  const cStat = resultadoConsulta?.cStat != null
    ? String(resultadoConsulta.cStat)
    : null;
  const xMotivo = resultadoConsulta?.mensagem || resultadoConsulta?.xMotivo || null;

  if (cStat === '656') {
    return {
      caso: 'CSTAT_656',
      statusRecuperacao: StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO,
      xmlCompleto: false,
      aguardando: true,
      esgotar: false,
      gateBloqueado: true,
      cStat,
      xMotivo,
      codigoErro: 'ERRO_COOLDOWN',
      recuperavel: true,
      mensagem: 'Consumo indevido (656) — sem retry imediato.'
    };
  }

  if (cStat === '137') {
    return {
      caso: 'CSTAT_137',
      statusRecuperacao: StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO,
      xmlCompleto: false,
      aguardando: true,
      esgotar: false,
      gateBloqueado: true,
      cStat,
      xMotivo,
      codigoErro: 'ERRO_COOLDOWN',
      recuperavel: true,
      mensagem: 'cStat 137 — respeitar cooldown da distribuição.'
    };
  }

  const statusNovo = normalizarStatus(documentoAtualizado?.status);
  const tipo = documentoAtualizado?.tipoDocumento || documentoAtualizado?.tipo_documento;
  const xmlCompleto = statusNovo === DocumentoFiscalStatus.XML_COMPLETO
    || tipo === DocumentoDfeTipo.PROC_NFE
    || tipo === DocumentoDfeTipo.NFE
    || Boolean(documentoAtualizado?.xmlCompleto);

  if (xmlCompleto) {
    return {
      caso: 'XML_COMPLETO',
      statusRecuperacao: StatusRecuperacaoXml.XML_COMPLETO,
      xmlCompleto: true,
      aguardando: false,
      esgotar: false,
      gateBloqueado: false,
      cStat,
      xMotivo,
      codigoErro: null,
      recuperavel: false,
      mensagem: 'XML completo recuperado.'
    };
  }

  // resNFe / resumo — NÃO é erro
  if (
    tipo === DocumentoDfeTipo.RES_NFE
    || statusNovo === DocumentoFiscalStatus.RESUMO_RECEBIDO
    || /resnfe|resumo/i.test(String(xMotivo || ''))
  ) {
    return {
      caso: 'RESUMO',
      statusRecuperacao: StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO,
      xmlCompleto: false,
      aguardando: true,
      esgotar: false,
      gateBloqueado: false,
      cStat,
      xMotivo,
      codigoErro: null,
      recuperavel: true,
      mensagem: 'NF-e localizada (resumo). XML completo ainda não disponível.'
    };
  }

  return {
    caso: 'INDISPONIVEL',
    statusRecuperacao: StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO,
    xmlCompleto: false,
    aguardando: true,
    esgotar: false,
    gateBloqueado: false,
    cStat,
    xMotivo,
    codigoErro: null,
    recuperavel: true,
    mensagem: 'Documento ainda não disponível para download do XML completo.'
  };
}

function classificarMensagemErro(msg) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('timeout') || m.includes('etimedout')) return 'ERRO_TIMEOUT';
  if (m.includes('certificado') || m.includes('pfx')) return 'ERRO_CERTIFICADO';
  if (m.includes('xml') || m.includes('parse') || m.includes('chave')) return 'ERRO_XML';
  if (m.includes('econn') || m.includes('network') || m.includes('socket')) return 'ERRO_REDE';
  if (m.includes('soap')) return 'ERRO_SOAP';
  if (m.includes('cooldown') || m.includes('656')) return 'ERRO_COOLDOWN';
  if (m.includes('rate')) return 'ERRO_RATE_LIMIT';
  if (m.includes('circuit')) return 'ERRO_CIRCUIT_BREAKER';
  return 'ERRO_SEFAZ';
}

function isRecuperavelCodigo(codigo) {
  return [
    'ERRO_REDE',
    'ERRO_TIMEOUT',
    'ERRO_SEFAZ',
    'ERRO_SOAP',
    'ERRO_RATE_LIMIT',
    'ERRO_COOLDOWN',
    'ERRO_CIRCUIT_BREAKER'
  ].includes(String(codigo || '').toUpperCase());
}

/**
 * Extrai chave do XML (infNFe Id / chNFe).
 * @param {string} xml
 * @returns {string|null}
 */
function extrairChaveDoXml(xml) {
  const raw = String(xml || '');
  const mId = raw.match(/Id\s*=\s*["']NFe(\d{44})["']/i);
  if (mId) return mId[1];
  const mCh = raw.match(/<chNFe>\s*(\d{44})\s*<\/chNFe>/i);
  return mCh ? mCh[1] : null;
}

/**
 * Extrai CNPJ do destinatário do XML.
 * @param {string} xml
 * @returns {string|null}
 */
function extrairCnpjDestinatarioXml(xml) {
  const raw = String(xml || '');
  const bloco = raw.match(/<dest[\s>][\s\S]*?<\/dest>/i);
  if (!bloco) return null;
  const m = bloco[0].match(/<CNPJ>\s*([^<]+)\s*<\/CNPJ>/i);
  return m ? String(m[1]).replace(/\D/g, '') : null;
}

module.exports = {
  classificarResultadoRecuperacao,
  classificarMensagemErro,
  isRecuperavelCodigo,
  extrairChaveDoXml,
  extrairCnpjDestinatarioXml
};
