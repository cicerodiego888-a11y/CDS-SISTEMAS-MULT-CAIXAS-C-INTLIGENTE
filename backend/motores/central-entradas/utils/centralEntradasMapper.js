/**
 * centralEntradasMapper — Mapeamento entre entidades e DTOs da Central de Entradas.
 *
 * @module motores/central-entradas/utils/centralEntradasMapper
 */

const DocumentoFiscalInboxDTO = require('../contracts/DocumentoFiscalInboxDTO');
const DocumentoFiscalDetalheDTO = require('../contracts/DocumentoFiscalDetalheDTO');
const CentralHistoricoEntryDTO = require('../contracts/CentralHistoricoEntryDTO');
const { obterLabel } = require('../core/DocumentoFiscalStatus');
const CentralScoreDocumentoService = require('../services/CentralScoreDocumentoService');
const { resolverStatusReal } = require('./centralDocumentalInteligente');

/** @type {CentralScoreDocumentoService} */
const scoreService = new CentralScoreDocumentoService();

function obterLabelDocumento(documento, wait = null) {
  const tipo = documento?.tipoDocumento ?? documento?.tipo_documento;
  const status = documento?.status;
  if (
    (status === 'XML_COMPLETO' || status === 'SINCRONIZADA')
    && ['PROC_NFE', 'NFE'].includes(tipo)
  ) {
    return 'XML Completo Recebido';
  }
  if ((status === 'RESUMO_RECEBIDO' || status === 'AGUARDANDO_XML_COMPLETO') && wait) {
    return resolverStatusReal(documento, wait);
  }
  return obterLabel(documento?.status);
}

/**
 * @param {Object|null} documento
 * @returns {DocumentoFiscalInboxDTO}
 */
function paraInboxDTO(documento) {
  return DocumentoFiscalInboxDTO.create(documento || {});
}

/**
 * RC3.7.1 — XML completo ⇒ parseDisponivel true (mesmo sem parse_json carregado).
 * @param {Object} doc
 * @returns {boolean}
 */
function resolverParseDisponivel(doc) {
  if (doc?.parseDisponivel === true || doc?._parseDisponivelListagem === true) return true;
  if (doc?.parseJson) return true;
  const tipo = String(doc?.tipoDocumento || doc?.tipo_documento || '').toUpperCase();
  if (tipo === 'PROC_NFE' || tipo === 'NFE') return true;
  const st = String(doc?.status || '');
  return ['XML_COMPLETO', 'EM_REVISAO', 'PRONTA_IMPORTACAO', 'EM_IMPORTACAO', 'IMPORTADA',
    'SINCRONIZADA', 'AGUARDANDO_REVISAO', 'REVISADA', 'PRONTA_PARA_COMPRA', 'EM_COMPRA', 'GRAVADA']
    .includes(st);
}

function resolverXmlDisponivel(doc) {
  if (doc?.xmlDisponivel === true) return true;
  if (doc?.xml) return true;
  const tipo = String(doc?.tipoDocumento || doc?.tipo_documento || '').toUpperCase();
  return tipo === 'PROC_NFE' || tipo === 'NFE';
}

/**
 * @param {Object[]} documentos
 * @returns {Object[]}
 */
function paraListaInboxDTO(documentos) {
  let mirx = null;
  try {
    mirx = require('../services/CentralXmlWaitScheduler');
  } catch { /* ignore */ }

  return (documentos || []).map((doc) => {
    const wait = mirx && typeof mirx.obterEstadoDocumento === 'function'
      ? mirx.obterEstadoDocumento(doc.id)
      : null;
    const dto = paraInboxDTO(doc).toJSON();
    dto.statusLabel = obterLabelDocumento(doc, wait);
    dto.estado = doc.status;
    dto.statusDocumento = doc.status;
    dto.statusImportacao = ['IMPORTADA', 'GRAVADA', 'EM_IMPORTACAO', 'EM_COMPRA'].includes(doc.status)
      ? doc.status
      : null;
    dto.xmlWait = wait;
    dto.parseDisponivel = resolverParseDisponivel(doc);
    dto.xmlDisponivel = resolverXmlDisponivel(doc);
    dto.miipDisponivel = Boolean(doc.miipResumoJson || doc.miipSessaoId);
    const score = scoreService.calcular(doc);
    dto.scoreGeral = score.scoreGeral;
    dto.scoreCor = score.cor;
    return dto;
  });
}

/**
 * @param {Object|null} documento
 * @returns {Object}
 */
function paraDocumentoDetalheDTO(documento) {
  if (!documento) return null;

  const {
    xml,
    parseJson,
    miipResumoJson,
    ...restante
  } = documento;

  let wait = null;
  try {
    const mirx = require('../services/CentralXmlWaitScheduler');
    wait = mirx.obterEstadoDocumento?.(documento.id) || null;
  } catch { /* ignore */ }

  return {
    ...restante,
    statusLabel: obterLabelDocumento(documento, wait),
    estado: documento.status,
    statusDocumento: documento.status,
    statusImportacao: ['IMPORTADA', 'GRAVADA', 'EM_IMPORTACAO', 'EM_COMPRA'].includes(documento.status)
      ? documento.status
      : null,
    xmlWait: wait,
    xmlDisponivel: resolverXmlDisponivel(documento),
    parseDisponivel: resolverParseDisponivel(documento),
    miipDisponivel: Boolean(miipResumoJson || documento.miipSessaoId),
    compraVinculada: Boolean(documento.compraId),
    compraTipoEntrada: documento.compraTipoEntrada || null,
    compraTipoEntradaSugerido: documento.compraTipoEntradaSugerido || null,
    compraTipoEntradaConfianca: documento.compraTipoEntradaConfianca != null
      ? Number(documento.compraTipoEntradaConfianca)
      : null,
    compraTipoEntradaMotivo: documento.compraTipoEntradaMotivo || null,
    compraTipoEntradaAlterado: Boolean(documento.compraTipoEntradaAlterado),
    badgeUsoConsumo: documento.compraTipoEntrada === 'USO_CONSUMO'
  };
}

/**
 * @param {Object|null} documento
 * @param {Object[]} [historico]
 * @returns {Object}
 */
function paraDetalheCompletoDTO(documento, historico = []) {
  return DocumentoFiscalDetalheDTO.create({
    documento: paraDocumentoDetalheDTO(documento),
    historico: (historico || []).map((entrada) => {
      const dto = paraHistoricoDTO(entrada).toJSON();
      dto.statusAnteriorLabel = dto.statusAnterior ? obterLabel(dto.statusAnterior) : null;
      dto.statusNovoLabel = obterLabel(dto.statusNovo);
      return dto;
    })
  }).toJSON();
}

/**
 * @param {Object|null} entrada
 * @returns {CentralHistoricoEntryDTO}
 */
function paraHistoricoDTO(entrada) {
  return CentralHistoricoEntryDTO.create(entrada || {});
}

module.exports = {
  paraInboxDTO,
  paraListaInboxDTO,
  paraDocumentoDetalheDTO,
  paraDetalheCompletoDTO,
  paraHistoricoDTO
};
