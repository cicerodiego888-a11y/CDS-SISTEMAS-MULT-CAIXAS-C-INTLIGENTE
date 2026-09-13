'use strict';

/**
 * Adapter Central Eventos — envolve emitirEvento sem alterar retorno/fluxo.
 * @module observabilidade/adapters/centralAdapter
 */

const { CATEGORIAS, EVENT_NAMES, RESULTADOS } = require('../eventTypes');

const TIPO_PARA_EVENTO = Object.freeze({
  SYNC_INICIADA: EVENT_NAMES.CENTRAL_SYNC_INICIADA,
  SYNC_CONCLUIDA: EVENT_NAMES.CENTRAL_SYNC_CONCLUIDA,
  SYNC_ERRO: EVENT_NAMES.CENTRAL_SYNC_ERRO,
  PARSER_CONCLUIDO: EVENT_NAMES.CENTRAL_PARSER_CONCLUIDO,
  MIIP_CONCLUIDO: EVENT_NAMES.CENTRAL_MIIP_CONCLUIDO,
  DOCUMENTO_RECEBIDO: EVENT_NAMES.CENTRAL_DOCUMENTO_RECEBIDO,
  ERRO: EVENT_NAMES.CENTRAL_ERRO
});

let patched = false;

function mapEventName(tipo) {
  return TIPO_PARA_EVENTO[tipo] || EVENT_NAMES.CENTRAL_EVENT;
}

/**
 * @param {object} dados
 * @param {object|null} registrado
 * @param {{ publish?: Function }} [bus]
 */
function publishFromCentral(dados = {}, registrado = null, bus) {
  try {
    const eventBus = bus || require('../eventBus');
    const tipo = dados.tipo || null;
    const sucesso = dados.sucesso !== false && !/ERRO/i.test(String(tipo || ''));
    eventBus.publish({
      event_name: mapEventName(tipo),
      categoria: CATEGORIAS.CENTRAL,
      origem: `central.${dados.origem || 'sistema'}`,
      usuario_id: dados.usuarioId ?? dados.usuario_id ?? null,
      duracao_ms: dados.duracaoMs ?? dados.tempo ?? dados.tempoMs ?? null,
      resultado: sucesso ? RESULTADOS.OK : RESULTADOS.ERRO,
      payload: {
        tipo,
        descricao: dados.descricao || null,
        documento_id: dados.documentoId ?? dados.documento_id ?? null,
        resultado_central: dados.resultado ?? null,
        registrado_id: registrado && registrado.id != null ? registrado.id : null
      }
    });
  } catch (_) {
    /* observe-only */
  }
}

/**
 * Monkey-patch seguro de emitirEvento — não altera valor de retorno.
 * @returns {{ ok: boolean, reason?: string }}
 */
function iniciar() {
  if (patched) return { ok: true, reason: 'already' };
  try {
    const emitter = require('../../motores/central-entradas/utils/centralEventosEmitter');
    const original = emitter.emitirEvento;
    if (typeof original !== 'function') {
      return { ok: false, reason: 'emitirEvento_ausente' };
    }
    emitter.emitirEvento = async function emitirEventoObs(dados) {
      const resultado = await original.apply(this, arguments);
      publishFromCentral(dados || {}, resultado);
      return resultado;
    };
    patched = true;
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  iniciar,
  publishFromCentral,
  mapEventName,
  TIPO_PARA_EVENTO
};
