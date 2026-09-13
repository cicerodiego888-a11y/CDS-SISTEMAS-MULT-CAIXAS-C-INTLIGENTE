/**
 * MIRX — Auditoria estruturada + Timeline (RC3.4.1).
 *
 * @module motores/central-entradas/mirx/MirxAuditoria
 */

const { TIPOS_EVENTO, ORIGENS } = require('../config/centralEventosTipos');
const { emitirEvento } = require('../utils/centralEventosEmitter');
const { logCentral, logCentralErro } = require('../utils/centralLog');
const { criarCorrelationId } = require('../utils/centralOperacaoLog');

const TIPOS_MIRX = Object.freeze({
  MIRX_ENFILEIRADO: 'MIRX_ENFILEIRADO',
  MIRX_CONSULTA_INICIO: 'MIRX_CONSULTA_INICIO',
  MIRX_CONSULTA_FIM: 'MIRX_CONSULTA_FIM',
  MIRX_REAGENDADO: 'MIRX_REAGENDADO',
  MIRX_XML_RECUPERADO: 'MIRX_XML_RECUPERADO',
  MIRX_BLOQUEIO_656: 'MIRX_BLOQUEIO_656',
  MIRX_SKIP_GATE: 'MIRX_SKIP_GATE',
  /** RC3.4.2 — entra em SLEEP (uma vez); sem spam por tick. */
  MIRX_SLEEP_START: 'MIRX_SLEEP_START',
  /** RC3.4.2 — acorda em proximaTentativa e volta à fila. */
  MIRX_WAKEUP: 'MIRX_WAKEUP',
  /** RC3.4.5 — agendamento preservado/atualizado (incl. em SLEEP). */
  MIRX_AGENDAMENTO_ATUALIZADO: 'MIRX_AGENDAMENTO_ATUALIZADO',
  /** RC3.4.5 — wakeup executou recuperação (método/resultado/tempo). */
  MIRX_WAKEUP_EXECUTADO: 'MIRX_WAKEUP_EXECUTADO',
  MIRX_ERRO: 'MIRX_ERRO'
});

class MirxAuditoria {
  /**
   * @param {Object} [deps]
   * @param {Function} [deps.emitirEvento]
   */
  constructor(deps = {}) {
    this._emitir = deps.emitirEvento || emitirEvento;
  }

  /**
   * @param {Object} campos
   */
  logOperacional(evento, campos = {}) {
    logCentral('MIRX', {
      Evento: evento,
      CorrelationId: campos.correlationId || null,
      DocumentoId: campos.documentoId != null ? campos.documentoId : null,
      Chave: campos.chave || null,
      NSU: campos.nsu || null,
      Tentativa: campos.tentativa != null ? campos.tentativa : null,
      Metodo: campos.metodo || null,
      cStat: campos.cStat || null,
      Tempo: campos.tempoMs != null ? campos.tempoMs : null,
      Estado: campos.estado || null,
      Backoff: campos.backoffLabel || null,
      'Próxima tentativa': campos.proximaTentativa || null,
      'ProximaEm anterior': campos.proximaEmAnterior || null,
      'ProximaEm nova': campos.proximaEmNova || null,
      Motivo: campos.motivo || null,
      Resultado: campos.resultado || null,
      Origem: campos.origem || null
    });
  }

  /**
   * Registra na Timeline da Central + log estruturado.
   * @param {Object} dados
   */
  async registrarTimeline(dados = {}) {
    const correlationId = dados.correlationId || criarCorrelationId();
    this.logOperacional(dados.tipoEvento || TIPOS_MIRX.MIRX_CONSULTA_FIM, {
      ...dados,
      correlationId
    });

    try {
      await this._emitir({
        tipo: TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO,
        origem: dados.origem || ORIGENS.SISTEMA,
        documentoId: dados.documentoId,
        descricao: dados.descricao || dados.motivo || 'MIRX — recuperação XML',
        resultado: dados.resultado || dados.cStat || dados.estado || null,
        sucesso: dados.sucesso,
        duracaoMs: dados.tempoMs,
        detalhe: {
          mirx: true,
          tipoMirx: dados.tipoEvento || null,
          correlationId,
          tentativa: dados.tentativa,
          metodo: dados.metodo,
          cStat: dados.cStat,
          xMotivo: dados.xMotivo || null,
          estado: dados.estado,
          backoffLabel: dados.backoffLabel,
          proximaTentativa: dados.proximaTentativa,
          proximaEmAnterior: dados.proximaEmAnterior || null,
          proximaEmNova: dados.proximaEmNova || null,
          motivo: dados.motivo,
          distDfe: dados.distDfe === true,
          consChNFe: dados.consChNFe === true,
          tempoMs: dados.tempoMs,
          resultado: dados.resultado || null
        }
      });
    } catch (error) {
      logCentralErro('MIRX', error, { Motivo: 'falha_timeline' });
    }

    return correlationId;
  }
}

module.exports = MirxAuditoria;
module.exports.TIPOS_MIRX = TIPOS_MIRX;
