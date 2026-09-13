/**
 * centralEventosEmitter — Emissão padronizada de eventos (RC3).
 *
 * Contrato único:
 *   tipo, origem, descricao, resultado, sucesso,
 *   documentoId, usuarioId, duracaoMs (tempo), detalhe, timestamp (DB created_at)
 *
 * @module motores/central-entradas/utils/centralEventosEmitter
 */

const { TIPOS_EVENTO, ORIGENS } = require('../config/centralEventosTipos');
const { logCentralErro } = require('./centralLog');

/** @type {import('../services/CentralEventosService')|null} */
let eventosService = null;
/** @type {import('../services/CentralNotificacoesService')|null} */
let notificacoesService = null;

function obterEventosService() {
  if (!eventosService) {
    const CentralEventosService = require('../services/CentralEventosService');
    eventosService = new CentralEventosService();
  }
  return eventosService;
}

function obterNotificacoesService() {
  if (!notificacoesService) {
    const CentralNotificacoesService = require('../services/CentralNotificacoesService');
    notificacoesService = new CentralNotificacoesService();
  }
  return notificacoesService;
}

/**
 * Normaliza payload para o contrato RC3.
 * @param {Object} dados
 * @returns {Object}
 */
function normalizarEvento(dados = {}) {
  const usuarioId = dados.usuarioId ?? dados.usuario_id ?? null;
  const detalheBase = dados.detalhe && typeof dados.detalhe === 'object'
    ? { ...dados.detalhe }
    : (dados.detalhe != null ? { valor: dados.detalhe } : {});

  if (usuarioId != null && detalheBase.usuarioId == null) {
    detalheBase.usuarioId = usuarioId;
  }

  return {
    tipo: dados.tipo,
    origem: dados.origem || ORIGENS.SISTEMA,
    descricao: dados.descricao ?? null,
    resultado: dados.resultado ?? null,
    sucesso: dados.sucesso,
    documentoId: dados.documentoId ?? dados.documento_id ?? null,
    notasNovas: dados.notasNovas ?? dados.notas_novas ?? 0,
    notasDuplicadas: dados.notasDuplicadas ?? dados.notas_duplicadas ?? 0,
    duracaoMs: dados.duracaoMs ?? dados.tempo ?? dados.tempoMs ?? null,
    detalhe: Object.keys(detalheBase).length ? detalheBase : null
  };
}

/**
 * @param {Object} dados
 * @returns {Promise<Object|null>}
 */
async function emitirEvento(dados) {
  try {
    return await obterEventosService().registrar(normalizarEvento(dados));
  } catch (error) {
    logCentralErro('EVENTOS', error, { tipo: dados?.tipo || null });
    return null;
  }
}

/**
 * @param {Object} documento
 * @param {string} [origem]
 * @returns {Promise<void>}
 */
async function emitirDocumentoRecebido(documento, origem = ORIGENS.SISTEMA) {
  if (!documento?.id) return;
  await emitirEvento({
    tipo: TIPOS_EVENTO.DOCUMENTO_RECEBIDO,
    origem,
    descricao: `Documento recebido: NF ${documento.numero || documento.chave?.slice(-8) || documento.id}`,
    resultado: documento.status,
    sucesso: true,
    documentoId: documento.id,
    usuarioId: documento.usuarioId || null,
    detalhe: {
      chave: documento.chave,
      fornecedor: documento.fornecedor,
      valorTotal: documento.valorTotal
    }
  });
}

/**
 * @param {Object} documento
 * @param {Object} [opcoes]
 * @returns {Promise<void>}
 */
async function emitirDocumentoProcessado(documento, opcoes = {}) {
  if (!documento?.id) return;
  await emitirEvento({
    tipo: TIPOS_EVENTO.DOCUMENTO_PROCESSADO,
    origem: opcoes.origem || ORIGENS.API,
    descricao: opcoes.mensagem || `Documento processado #${documento.id}`,
    resultado: documento.status,
    sucesso: opcoes.sucesso !== false,
    documentoId: documento.id,
    usuarioId: opcoes.usuarioId || null,
    duracaoMs: opcoes.duracaoMs || opcoes.tempo || null,
    detalhe: opcoes.detalhe || null
  });

  if (documento.status === 'PRONTA_PARA_COMPRA') {
    try {
      await obterNotificacoesService().criarPadrao({
        tipo: 'PRONTA_COMPRA',
        titulo: 'Documento pronto para lançamento',
        mensagem: `NF ${documento.numero || documento.id} está pronta para Compras.`,
        documentoId: documento.id
      });
    } catch { /* ignore */ }
  }
}

/**
 * RC6.3 — XML completo aplicado a documento AGUARDANDO_XML_COMPLETO.
 * @param {Object} documento
 * @param {Object} [opcoes]
 * @returns {Promise<void>}
 */
async function emitirDocumentoAtualizado(documento, opcoes = {}) {
  if (!documento?.id) return;
  await emitirEvento({
    tipo: TIPOS_EVENTO.DOCUMENTO_ATUALIZADO,
    origem: opcoes.origem || ORIGENS.SISTEMA,
    descricao: `XML completo recebido — documento #${documento.id} atualizado`,
    resultado: documento.status,
    sucesso: true,
    documentoId: documento.id,
    usuarioId: documento.usuarioId || opcoes.usuarioId || null,
    detalhe: {
      chave: documento.chave,
      tipoDfe: opcoes.tipoDfe || documento.tipoDocumento || null,
      status: documento.status
    }
  });
}

/**
 * @param {Object} documento
 * @param {number|string} compraId
 * @param {Object} [opcoes]
 * @returns {Promise<void>}
 */
async function emitirCompraGravada(documento, compraId, opcoes = {}) {
  if (!documento?.id) return;
  await emitirEvento({
    tipo: TIPOS_EVENTO.COMPRA_GRAVADA,
    origem: ORIGENS.COMPRAS,
    descricao: `Compra #${compraId} gravada para documento #${documento.id}`,
    resultado: 'GRAVADA',
    sucesso: true,
    documentoId: documento.id,
    usuarioId: opcoes.usuarioId || null,
    detalhe: { compraId }
  });

  try {
    await obterNotificacoesService().criarPadrao({
      tipo: 'COMPRA_GRAVADA',
      titulo: 'Compra gravada na Central',
      mensagem: `Compra #${compraId} vinculada ao documento #${documento.id}.`,
      documentoId: documento.id
    });
  } catch { /* ignore */ }
}

/**
 * @param {string} mensagem
 * @param {Object} [opcoes]
 * @returns {Promise<void>}
 */
async function emitirErro(mensagem, opcoes = {}) {
  await emitirEvento({
    tipo: TIPOS_EVENTO.ERRO,
    origem: opcoes.origem || ORIGENS.SISTEMA,
    descricao: mensagem,
    resultado: 'erro',
    sucesso: false,
    documentoId: opcoes.documentoId || null,
    usuarioId: opcoes.usuarioId || null,
    duracaoMs: opcoes.duracaoMs || null,
    detalhe: opcoes.detalhe || null
  });
}

/**
 * RC6.5 — Documento legado migrado para AGUARDANDO_XML_COMPLETO.
 * @param {Object} documento
 * @param {Object} [opcoes]
 * @returns {Promise<void>}
 */
async function emitirDocumentoMigrado(documento, opcoes = {}) {
  if (!documento?.id) return;
  await emitirEvento({
    tipo: TIPOS_EVENTO.DOCUMENTO_MIGRADO,
    origem: opcoes.origem || ORIGENS.MIGRACAO_RC65,
    descricao: `Documento legado #${documento.id} migrado (RC6.5)`,
    resultado: documento.status,
    sucesso: true,
    documentoId: documento.id,
    usuarioId: opcoes.usuarioId || null,
    detalhe: {
      chave: documento.chave,
      statusAnterior: opcoes.statusAnterior || null,
      statusNovo: documento.status,
      tipoDocumento: documento.tipoDocumento || 'RES_NFE'
    }
  });
}

module.exports = {
  emitirEvento,
  emitirDocumentoRecebido,
  emitirDocumentoProcessado,
  emitirDocumentoAtualizado,
  emitirDocumentoMigrado,
  emitirCompraGravada,
  emitirErro,
  normalizarEvento,
  TIPOS_EVENTO,
  ORIGENS
};
