/**
 * Notifier / logs de saúde (RC3.4.6).
 * @module motores/central-entradas/health/HealthNotifier
 */

const { logCentral } = require('../utils/centralLog');
const { HealthNiveis } = require('./HealthNiveis');

const TIPOS_HEALTH = Object.freeze({
  HEALTH_OK: 'HEALTH_OK',
  HEALTH_WARNING: 'HEALTH_WARNING',
  HEALTH_CRITICAL: 'HEALTH_CRITICAL',
  HEALTH_RESOLVED: 'HEALTH_RESOLVED',
  HEALTH_SCAN: 'HEALTH_SCAN'
});

class HealthNotifier {
  /**
   * @param {Object} avaliacao
   * @param {Object} [doc]
   */
  notificarDocumento(avaliacao, doc = {}) {
    const nivel = avaliacao?.nivel || HealthNiveis.SAUDAVEL;
    let evento = TIPOS_HEALTH.HEALTH_OK;
    if (nivel === HealthNiveis.ATENCAO) evento = TIPOS_HEALTH.HEALTH_WARNING;
    if (nivel === HealthNiveis.CRITICO || nivel === HealthNiveis.BLOQUEADO) {
      evento = TIPOS_HEALTH.HEALTH_CRITICAL;
    }
    if (nivel === HealthNiveis.RESOLVIDO) evento = TIPOS_HEALTH.HEALTH_RESOLVED;

    const principal = avaliacao?.alertaPrincipal || avaliacao;
    logCentral('HEALTH', {
      Evento: evento,
      DocumentoId: doc.id || avaliacao.documentoId || null,
      Chave: doc.chave || avaliacao.chave || null,
      Nivel: nivel,
      Regra: principal?.regra || avaliacao.regra || null,
      'Tempo parado': (principal?.tempoParadoMs ?? avaliacao.tempoParadoMs) != null
        ? `${Math.round((principal?.tempoParadoMs ?? avaliacao.tempoParadoMs) / 60000)} min`
        : null,
      Diagnostico: principal?.diagnostico || avaliacao.diagnostico || null,
      Recomendacao: principal?.recomendacao || avaliacao.recomendacao || null
    });

    return evento;
  }

  notificarScan(resumo) {
    logCentral('HEALTH', {
      Evento: TIPOS_HEALTH.HEALTH_SCAN,
      Saudaveis: resumo?.contadores?.saudaveis ?? null,
      Atencao: resumo?.contadores?.atencao ?? null,
      Criticos: resumo?.contadores?.criticos ?? null,
      Bloqueados: resumo?.contadores?.bloqueados ?? null,
      Resolvidos: resumo?.contadores?.resolvidos ?? null,
      'Docs analisados': resumo?.analisados ?? null,
      'Tempo scan ms': resumo?.tempoScanMs ?? null
    });
  }
}

module.exports = HealthNotifier;
module.exports.TIPOS_HEALTH = TIPOS_HEALTH;
