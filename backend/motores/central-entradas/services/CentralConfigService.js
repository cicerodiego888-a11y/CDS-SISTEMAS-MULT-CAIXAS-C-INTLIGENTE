/**
 * CentralConfigService — Adapter interno de sincronização (RC5).
 *
 * NÃO é o provider oficial de configuração da Central.
 * Provider oficial: CentralConfiguracaoService.
 *
 * Este módulo existe apenas como implementação interna de chaves de sync
 * (intervalo, janelas, sync ao abrir), consumida exclusivamente via
 * CentralConfiguracaoService (obterResumoSync / atualizarSync / …).
 *
 * @deprecated RC5 — Não instanciar fora de CentralConfiguracaoService.
 *   Use CentralConfiguracaoService.obterResumoSync(), hidratarFlags(),
 *   verificarHorarioPermitido(), obterIntervaloMs(), atualizarSync().
 * @class CentralConfigService
 */

const CentralConfigRepository = require('../repositories/CentralConfigRepository');
const centralEntradasFlags = require('../config/centralEntradasFlags');

const CHAVES = Object.freeze({
  SYNC_AUTOMATICA: 'sync_automatica_habilitada',
  INTERVALO_MIN: 'sync_intervalo_minutos',
  SYNC_AO_ABRIR: 'sync_ao_abrir',
  MAX_DOCUMENTOS: 'sync_max_documentos',
  HORARIO_PERMITIDO_INICIO: 'sync_horario_permitido_inicio',
  HORARIO_PERMITIDO_FIM: 'sync_horario_permitido_fim',
  HORARIO_BLOQUEADO_INICIO: 'sync_horario_bloqueado_inicio',
  HORARIO_BLOQUEADO_FIM: 'sync_horario_bloqueado_fim',
  NOTIFICAR_NOVAS: 'sync_notificar_novas_notas'
});

class CentralConfigService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    /** @private */
    this._repository = deps.configRepository ?? new CentralConfigRepository();
    /** @private */
    this._flags = deps.flags ?? centralEntradasFlags;
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterTodas() {
    const registros = await this._repository.listarTodas();
    const config = {};

    registros.forEach((reg) => {
      config[reg.chave] = {
        valor: this._repository.parseValor(reg),
        tipo: reg.tipo,
        descricao: reg.descricao,
        updatedAt: reg.updatedAt
      };
    });

    return config;
  }

  /**
   * @returns {Promise<Object>}
   */
  async obterResumo() {
    const config = await this.obterTodas();
    return {
      syncAutomaticaHabilitada: config[CHAVES.SYNC_AUTOMATICA]?.valor === true,
      syncIntervaloMinutos: Number(config[CHAVES.INTERVALO_MIN]?.valor) || 15,
      syncAoAbrir: config[CHAVES.SYNC_AO_ABRIR]?.valor !== false,
      syncMaxDocumentos: Number(config[CHAVES.MAX_DOCUMENTOS]?.valor) || 50,
      horarioPermitidoInicio: config[CHAVES.HORARIO_PERMITIDO_INICIO]?.valor || '06:00',
      horarioPermitidoFim: config[CHAVES.HORARIO_PERMITIDO_FIM]?.valor || '23:59',
      horarioBloqueadoInicio: config[CHAVES.HORARIO_BLOQUEADO_INICIO]?.valor || '',
      horarioBloqueadoFim: config[CHAVES.HORARIO_BLOQUEADO_FIM]?.valor || '',
      notificarNovasNotas: config[CHAVES.NOTIFICAR_NOVAS]?.valor !== false
    };
  }

  /**
   * @param {Object} alteracoes
   * @returns {Promise<Object>}
   */
  async atualizar(alteracoes = {}) {
    const mapa = {
      syncAutomaticaHabilitada: [CHAVES.SYNC_AUTOMATICA, 'boolean'],
      syncIntervaloMinutos: [CHAVES.INTERVALO_MIN, 'number'],
      syncAoAbrir: [CHAVES.SYNC_AO_ABRIR, 'boolean'],
      syncMaxDocumentos: [CHAVES.MAX_DOCUMENTOS, 'number'],
      horarioPermitidoInicio: [CHAVES.HORARIO_PERMITIDO_INICIO, 'string'],
      horarioPermitidoFim: [CHAVES.HORARIO_PERMITIDO_FIM, 'string'],
      horarioBloqueadoInicio: [CHAVES.HORARIO_BLOQUEADO_INICIO, 'string'],
      horarioBloqueadoFim: [CHAVES.HORARIO_BLOQUEADO_FIM, 'string'],
      notificarNovasNotas: [CHAVES.NOTIFICAR_NOVAS, 'boolean']
    };

    for (const [campo, valor] of Object.entries(alteracoes)) {
      if (valor === undefined || !mapa[campo]) continue;
      const [chave, tipo] = mapa[campo];
      await this._repository.salvar(chave, valor, tipo);
    }

    await this.hidratarFlags();
    return this.obterResumo();
  }

  /**
   * @returns {Promise<void>}
   */
  async hidratarFlags() {
    const resumo = await this.obterResumo();
    this._flags.definirSyncAutomatica(resumo.syncAutomaticaHabilitada);
  }

  /**
   * @returns {Promise<number>}
   */
  async obterIntervaloMs() {
    const resumo = await this.obterResumo();
    const minutos = Math.max(1, Math.min(1440, resumo.syncIntervaloMinutos || 15));
    return minutos * 60 * 1000;
  }

  /**
   * Verifica se o horário atual permite sincronização.
   *
   * @param {Date} [agora]
   * @returns {Promise<{ permitido: boolean, motivo?: string }>}
   */
  async verificarHorarioPermitido(agora = new Date()) {
    const cfg = await this.obterResumo();
    const minutosAtual = agora.getHours() * 60 + agora.getMinutes();

    const paraMinutos = (hhmm) => {
      if (!hhmm || !/^\d{1,2}:\d{2}$/.test(String(hhmm))) return null;
      const [h, m] = String(hhmm).split(':').map(Number);
      return h * 60 + m;
    };

    const inicioPerm = paraMinutos(cfg.horarioPermitidoInicio);
    const fimPerm = paraMinutos(cfg.horarioPermitidoFim);
    if (inicioPerm != null && fimPerm != null) {
      if (minutosAtual < inicioPerm || minutosAtual > fimPerm) {
        return { permitido: false, motivo: 'Fora do horário permitido para sincronização' };
      }
    }

    const inicioBloq = paraMinutos(cfg.horarioBloqueadoInicio);
    const fimBloq = paraMinutos(cfg.horarioBloqueadoFim);
    if (inicioBloq != null && fimBloq != null) {
      if (inicioBloq <= fimBloq) {
        if (minutosAtual >= inicioBloq && minutosAtual <= fimBloq) {
          return { permitido: false, motivo: 'Horário bloqueado para sincronização' };
        }
      } else if (minutosAtual >= inicioBloq || minutosAtual <= fimBloq) {
        return { permitido: false, motivo: 'Horário bloqueado para sincronização' };
      }
    }

    return { permitido: true };
  }
}

CentralConfigService.CHAVES = CHAVES;

module.exports = CentralConfigService;
