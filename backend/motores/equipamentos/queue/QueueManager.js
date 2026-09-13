/**
 * QueueManager — Gerenciador de fila de comandos do Motor de Equipamentos
 *
 * Sprint 11A: processamento automático com retry, timeout e backoff.
 *
 * Fluxo:
 *   Fila → Buscar pendente → Obter Driver → Executar → Resposta → Atualizar Status → Retry
 *
 * @class QueueManager
 */

const equipamentosRepository = require('../repositories/EquipamentosRepository');
const loggerService = require('../services/LoggerService');
const equipamentosEvents = require('../events/EquipamentosEvents');

/** Tipos de comando suportados pela fila */
const COMANDOS = {
  SYNC_PRODUTO: 'SYNC_PRODUTO',
  SYNC_PROMOCAO: 'SYNC_PROMOCAO',
  SYNC_DEPARTAMENTO: 'SYNC_DEPARTAMENTO',
  SYNC_ETIQUETA: 'SYNC_ETIQUETA',
  REMOVER_PRODUTO: 'REMOVER_PRODUTO'
};

/** Prioridade padrão por comando (menor = mais prioritário) */
const PRIORIDADE_PADRAO = {
  REMOVER_PRODUTO: 1,
  SYNC_PROMOCAO: 2,
  SYNC_PRODUTO: 3,
  SYNC_ETIQUETA: 4,
  SYNC_DEPARTAMENTO: 5
};

const MAX_RETRIES = Number(process.env.EQUIPAMENTOS_SYNC_MAX_RETRIES || 3);
const INTERVALO_MS = Number(process.env.EQUIPAMENTOS_QUEUE_INTERVAL_MS || 1500);
const BACKOFF_BASE_MS = Number(process.env.EQUIPAMENTOS_QUEUE_BACKOFF_MS || 1000);
const TIMEOUT_EXEC_MS = Number(process.env.EQUIPAMENTOS_QUEUE_TIMEOUT_MS || 15000);

class QueueManager {
  constructor() {
    /** @type {boolean} */
    this._processando = false;

    /** @type {NodeJS.Timeout|null} */
    this._intervalId = null;

    /** @type {Object|null} */
    this._equipamentosManager = null;
  }

  /**
   * Resolve EquipamentosManager com require tardio (evita dependência circular).
   * @returns {Object}
   * @private
   */
  _manager() {
    if (!this._equipamentosManager) {
      // eslint-disable-next-line global-require
      this._equipamentosManager = require('../core/EquipamentosManager');
    }
    return this._equipamentosManager;
  }

  /**
   * Inicia o worker de processamento.
   * @param {Object} [opcoes]
   * @returns {void}
   */
  iniciar(opcoes = {}) {
    if (this._intervalId) return;

    this._recuperarOrfaos().catch((err) => {
      loggerService.error('Falha ao recuperar fila órfã', {
        operacao: 'fila.recuperar_orfaos',
        detalhe: err.message
      }).catch(() => {});
    });

    const intervalo = opcoes.intervaloMs ?? INTERVALO_MS;
    this._intervalId = setInterval(() => {
      this._processarProximo().catch((err) => {
        loggerService.error('Erro no ciclo da fila', {
          operacao: 'fila.ciclo',
          detalhe: err.message
        }).catch(() => {});
      });
    }, intervalo);

    this._processarProximo().catch(() => {});
  }

  /**
   * Para o worker de processamento.
   * @returns {void}
   */
  parar() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._processando = false;
  }

  /**
   * @returns {Promise<void>}
   * @private
   */
  async _recuperarOrfaos() {
    const orfaos = await equipamentosRepository.listarFila({ status: 'processando' });
    for (const item of orfaos) {
      await equipamentosRepository.atualizarStatusFila(item.id, 'pendente', {
        erro_mensagem: 'recuperado após reinício do worker'
      });
    }
  }

  /**
   * @param {number} tentativa
   * @returns {Promise<void>}
   * @private
   */
  async _aguardarBackoff(tentativa) {
    const ms = BACKOFF_BASE_MS * Math.pow(2, Math.max(0, tentativa - 1));
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * @param {Promise<*>} promessa
   * @param {number} ms
   * @returns {Promise<*>}
   * @private
   */
  _comTimeout(promessa, ms) {
    return Promise.race([
      promessa,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Timeout de execução da fila (${ms}ms)`)), ms);
      })
    ]);
  }

  /**
   * @param {Object} item
   * @param {Object} payload
   * @returns {Promise<Object>}
   * @private
   */
  async _executarComando(item, payload) {
    const manager = this._manager();
    const dto = payload.dto || payload;

    switch (item.comando) {
      case COMANDOS.SYNC_PRODUTO:
        return manager.sincronizarProduto(item.equipamento_id, dto);
      case COMANDOS.SYNC_PROMOCAO:
        return manager.sincronizarPromocao(item.equipamento_id, dto);
      case COMANDOS.SYNC_DEPARTAMENTO:
        return manager.sincronizarDepartamento(item.equipamento_id, dto);
      case COMANDOS.SYNC_ETIQUETA:
        return manager.sincronizarEtiqueta(item.equipamento_id, dto);
      case COMANDOS.REMOVER_PRODUTO: {
        const driver = await manager.obterDriver(item.equipamento_id);
        if (!driver.protocol?.conectado) {
          await manager.conectar(item.equipamento_id);
        }
        return driver.removerProduto(dto.plu ?? dto.codigo ?? dto);
      }
      default:
        throw new Error(`Comando de fila não suportado: ${item.comando}`);
    }
  }

  /**
   * Valida a estrutura do comando.
   * @param {Object} comando
   * @returns {{ valido: boolean, erros: string[] }}
   */
  validarComando(comando = {}) {
    const erros = [];
    if (!comando.equipamentoId && comando.equipamentoId !== 0) {
      erros.push('equipamentoId é obrigatório');
    }
    if (!comando.comando || !COMANDOS[comando.comando]) {
      erros.push(`comando inválido: ${comando.comando}`);
    }
    return { valido: erros.length === 0, erros };
  }

  /**
   * Enfileira um comando de sincronização.
   * @param {Object} comando
   * @returns {Promise<{ id: number|null }>}
   */
  async enfileirar(comando = {}) {
    const validacao = this.validarComando(comando);
    if (!validacao.valido) {
      throw new Error(`Comando de fila inválido: ${validacao.erros.join('; ')}`);
    }

    const prioridade = comando.prioridade ?? PRIORIDADE_PADRAO[comando.comando] ?? 5;

    const resultado = await equipamentosRepository.inserirItemFila({
      equipamento_id: comando.equipamentoId,
      comando: comando.comando,
      payload: comando.payload || {},
      status: 'pendente',
      prioridade,
      tentativas: 0
    });

    await loggerService.info('Comando enfileirado', {
      operacao: 'fila.enfileirar',
      equipamento_id: comando.equipamentoId,
      comando: comando.comando,
      prioridade,
      item_id: resultado.id
    });

    return resultado;
  }

  /**
   * @param {number} equipamentoId
   * @param {string} comandoTipo
   * @param {string|number} [plu]
   * @returns {Promise<boolean>}
   */
  async existeDuplicado(equipamentoId, comandoTipo, plu) {
    return equipamentosRepository.existeFilaDuplicada(equipamentoId, comandoTipo, plu);
  }

  /**
   * @param {Object} [filtros]
   * @returns {Promise<Object[]>}
   */
  async listar(filtros = {}) {
    return equipamentosRepository.listarFila(filtros);
  }

  /**
   * @returns {Promise<number>}
   */
  async contarPendentes() {
    return equipamentosRepository.contarFilaPendente();
  }

  /**
   * @param {number} id
   * @param {string} [motivo]
   * @returns {Promise<void>}
   */
  async cancelar(id, motivo = 'cancelado') {
    await equipamentosRepository.atualizarStatusFila(id, 'cancelado', { erro_mensagem: motivo });
  }

  /**
   * Worker interno — processa próximo item da fila.
   * @returns {Promise<void>}
   * @private
   */
  async _processarProximo() {
    if (this._processando) return;

    this._processando = true;
    let item = null;

    try {
      item = await equipamentosRepository.obterProximoItemFila();
      if (!item) return;

      await equipamentosRepository.atualizarStatusFila(item.id, 'processando');

      let payload = {};
      try {
        payload = item.payload ? JSON.parse(item.payload) : {};
      } catch (err) {
        throw new Error(`Payload inválido na fila: ${err.message}`);
      }

      const tentativasAtuais = Number(item.tentativas || 0);

      await equipamentosEvents.emitirSyncIniciado({
        equipamento_id: item.equipamento_id,
        tipo: item.comando,
        item_id: item.id,
        tentativa: tentativasAtuais + 1
      });

      const resultado = await this._comTimeout(
        this._executarComando(item, payload),
        TIMEOUT_EXEC_MS
      );

      if (resultado?.sucesso === false) {
        throw new Error(resultado.protocolo?.nakDetalhe?.mensagem || 'Comando retornou falha');
      }

      await equipamentosRepository.atualizarStatusFila(item.id, 'concluido', {
        tentativas: tentativasAtuais + 1,
        erro_mensagem: null
      });

      await loggerService.logSincronizacao({
        equipamentoId: item.equipamento_id,
        tipo: item.comando,
        status: 'concluido',
        detalhe: { item_id: item.id, tempo_ms: resultado?.protocolo?.tempo_ms }
      });

      await equipamentosEvents.emitirSyncFinalizado({
        equipamento_id: item.equipamento_id,
        tipo: item.comando,
        item_id: item.id,
        status: 'concluido'
      });
    } catch (err) {
      if (!item) return;

      const tentativas = Number(item.tentativas || 0) + 1;

      if (tentativas < MAX_RETRIES) {
        await equipamentosRepository.atualizarStatusFila(item.id, 'pendente', {
          tentativas,
          erro_mensagem: `Retry ${tentativas}/${MAX_RETRIES}: ${err.message}`
        });

        await loggerService.warn('Retry na fila de sincronização', {
          operacao: 'fila.retry',
          equipamento_id: item.equipamento_id,
          contexto: {
            item_id: item.id,
            comando: item.comando,
            tentativa: tentativas,
            max: MAX_RETRIES,
            erro: err.message
          }
        });

        await this._aguardarBackoff(tentativas);
      } else {
        await equipamentosRepository.atualizarStatusFila(item.id, 'erro', {
          tentativas,
          erro_mensagem: err.message
        });

        await equipamentosEvents.emitirSyncErro({
          equipamento_id: item.equipamento_id,
          tipo: item.comando,
          item_id: item.id,
          erro: err.message
        });

        await loggerService.logSincronizacao({
          equipamentoId: item.equipamento_id,
          tipo: item.comando,
          status: 'erro',
          detalhe: { item_id: item.id, erro: err.message, tentativas }
        });
      }
    } finally {
      this._processando = false;
    }
  }
}

const queueManager = new QueueManager();

module.exports = queueManager;
module.exports.COMANDOS = COMANDOS;
module.exports.PRIORIDADE_PADRAO = PRIORIDADE_PADRAO;
