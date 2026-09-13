/**
 * Mapa semântico RC3.3.3 — etapas do ciclo DF-e × status de documento × eventos.
 *
 * CIENCIA_PENDENTE / CIENCIA_ENVIADA / PROCESSADA NÃO são status de documento.
 * São etapas observáveis (eventos/timeline) sobre o status físico existente.
 *
 * @module motores/central-entradas/core/CicloDfeEstadosMap
 */

const { DocumentoFiscalStatus } = require('./DocumentoFiscalStatus');
const { TIPOS_EVENTO } = require('../config/centralEventosTipos');

const ETAPAS_CICLO_DFE = Object.freeze({
  RES_NFE: {
    statusDocumento: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    evento: TIPOS_EVENTO.DOCUMENTO_RECEBIDO,
    descricao: 'Resumo DF-e recebido'
  },
  CIENCIA_PENDENTE: {
    statusDocumento: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    evento: null,
    descricao: 'Aguardando política/confirmação para Ciência'
  },
  CIENCIA_ENVIADA: {
    statusDocumento: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    evento: TIPOS_EVENTO.CIENCIA_ENVIADA,
    descricao: 'Ciência da Emissão enviada'
  },
  AGUARDANDO_XML_COMPLETO: {
    statusDocumento: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    evento: TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO,
    descricao: 'Aguardando PROC_NFE via DistDFe'
  },
  SINCRONIZADA: {
    statusDocumento: DocumentoFiscalStatus.SINCRONIZADA,
    evento: TIPOS_EVENTO.DOCUMENTO_ATUALIZADO,
    descricao: 'XML completo aplicado (RC6.3)'
  },
  PROCESSADA: {
    statusDocumento: [
      DocumentoFiscalStatus.AGUARDANDO_REVISAO,
      DocumentoFiscalStatus.PRONTA_PARA_COMPRA
    ],
    evento: TIPOS_EVENTO.DOCUMENTO_PROCESSADO,
    descricao: 'Parser + MIIP concluídos'
  },
  AGUARDANDO_REVISAO: {
    statusDocumento: DocumentoFiscalStatus.AGUARDANDO_REVISAO,
    evento: TIPOS_EVENTO.MIIP_CONCLUIDO,
    descricao: 'Pendências MIIP'
  },
  PRONTA_PARA_COMPRA: {
    statusDocumento: DocumentoFiscalStatus.PRONTA_PARA_COMPRA,
    evento: TIPOS_EVENTO.DOCUMENTO_PROCESSADO,
    descricao: 'Pronta para Compras'
  },
  GRAVADA: {
    statusDocumento: DocumentoFiscalStatus.GRAVADA,
    evento: TIPOS_EVENTO.COMPRA_GRAVADA,
    descricao: 'Compra vinculada'
  }
});

/** Eventos que devem ocorrer no máximo uma vez por documento. */
const EVENTOS_UNICOS_POR_DOCUMENTO = Object.freeze([
  TIPOS_EVENTO.MANIFESTACAO_ACEITA,
  TIPOS_EVENTO.PARSER_CONCLUIDO,
  TIPOS_EVENTO.MIIP_CONCLUIDO,
  TIPOS_EVENTO.COMPRA_GRAVADA
]);

module.exports = {
  ETAPAS_CICLO_DFE,
  EVENTOS_UNICOS_POR_DOCUMENTO
};
