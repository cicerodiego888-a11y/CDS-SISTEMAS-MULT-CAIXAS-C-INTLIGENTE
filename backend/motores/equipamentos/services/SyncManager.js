/**
 * SyncManager — Coração do Motor de Sincronização de Equipamentos.
 *
 * Orquestra TODA a sincronização entre o ERP e qualquer equipamento.
 * É o único ponto autorizado a transformar entidades do ERP em DTOs e
 * despachá-las para a fila. Nenhum Driver conversa com ele diretamente;
 * quando o consumo da fila for implementado (Sprint 5), o driver será
 * resolvido exclusivamente via DriverManager/EquipamentosManager.
 *
 * Fluxo:
 *   Evento/Solicitação
 *     → SyncManager (converte via Mapper → DTO, valida, deduplica, prioriza)
 *     → QueueManager (persiste na fila)
 *     → [Sprint 5] DriverManager → Driver → Equipamento
 *
 * Responsabilidades:
 * - Receber eventos/solicitações de sincronização.
 * - Converter entidades em DTOs (via Mappers).
 * - Enviar comandos para a fila (QueueManager).
 * - Controlar prioridade.
 * - Evitar sincronizações duplicadas.
 * - Cancelar sincronizações inválidas.
 * - Controlar concorrência e retries (política definida aqui, execução na Sprint 5).
 * - Emitir eventos (EquipamentosEvents).
 * - Registrar logs (LoggerService).
 *
 * RESTRIÇÕES ARQUITETURAIS:
 * - NÃO acessa Produtos/Banco/Controllers/Rotas diretamente.
 * - NÃO conversa diretamente com Drivers (sempre via DriverManager).
 * - NÃO implementa comunicação real com hardware (Sprint 5+).
 *
 * @class SyncManager
 */

const queueManager = require('../queue/QueueManager');
const equipamentosEvents = require('../events/EquipamentosEvents');
const loggerService = require('./LoggerService');

const ProdutoMapper = require('./ProdutoMapper');
const PromocaoMapper = require('./PromocaoMapper');
const DepartamentoMapper = require('./DepartamentoMapper');
const EtiquetaMapper = require('./EtiquetaMapper');

const { sucesso, erro } = require('../contracts/ResponseFactory');
const { COMANDOS, PRIORIDADE_PADRAO } = queueManager;

/** Concorrência máxima de despachos simultâneos (controle lógico). */
const CONCORRENCIA_PADRAO = Number(process.env.EQUIPAMENTOS_SYNC_CONCORRENCIA || 3);

/** Número máximo de tentativas por item. */
const MAX_RETRIES = Number(process.env.EQUIPAMENTOS_SYNC_MAX_RETRIES || 3);

class SyncManager {
  constructor() {
    /** @type {number} Despachos em andamento (controle de concorrência). */
    this._emAndamento = 0;
    /** @type {number} */
    this._concorrenciaMax = CONCORRENCIA_PADRAO;
    /** @type {number} */
    this._maxRetries = MAX_RETRIES;
  }

  /**
   * Ponto de entrada genérico de sincronização.
   * @param {Object} params
   * @param {number|string} params.equipamentoId
   * @param {string} params.tipo - Um dos COMANDOS do QueueManager
   * @param {Object} params.entidade - Entidade bruta do ERP (será mapeada)
   * @param {Object} [params.opcoes] - { solicitante, prioridade, forcar }
   * @returns {Promise<Object>} Resultado do enfileiramento
   */
  async sincronizar({ equipamentoId, tipo, entidade, opcoes = {} } = {}) {
    const solicitante = opcoes.solicitante || 'sistema';

    await equipamentosEvents.emitirSyncIniciado({
      equipamento_id: equipamentoId,
      tipo,
      solicitante,
      timestamp: new Date().toISOString()
    });

    await loggerService.logSincronizacao({
      equipamentoId,
      tipo,
      solicitante,
      status: 'iniciado',
      prioridade: opcoes.prioridade ?? PRIORIDADE_PADRAO[tipo] ?? 5
    });

    try {
      const { dto, evento } = this._mapear(tipo, entidade);

      const validacao = dto && typeof dto.validar === 'function' ? dto.validar() : { valido: true, erros: [] };
      if (!validacao.valido) {
        return this._cancelar(equipamentoId, tipo, solicitante, `DTO inválido: ${validacao.erros.join('; ')}`);
      }

      const plu = dto?.plu ?? dto?.codigo ?? null;
      if (!opcoes.forcar && await queueManager.existeDuplicado(equipamentoId, tipo, plu)) {
        return this._cancelar(equipamentoId, tipo, solicitante, 'sincronização duplicada ignorada');
      }

      const prioridade = opcoes.prioridade ?? PRIORIDADE_PADRAO[tipo] ?? 5;

      const item = await queueManager.enfileirar({
        equipamentoId,
        comando: tipo,
        prioridade,
        payload: { dto: dto.toJSON ? dto.toJSON() : dto, solicitante, plu }
      });

      if (evento) {
        await equipamentosEvents[evento]({
          equipamento_id: equipamentoId,
          plu,
          item_id: item.id,
          solicitante
        });
      }

      await loggerService.logSincronizacao({
        equipamentoId,
        tipo,
        solicitante,
        prioridade,
        status: 'enfileirado',
        detalhe: { item_id: item.id, plu }
      });

      await equipamentosEvents.emitirSyncFinalizado({
        equipamento_id: equipamentoId,
        tipo,
        item_id: item.id,
        status: 'enfileirado'
      });

      return sucesso({
        mensagem: 'Sincronização enfileirada',
        dados: { item_id: item.id },
        status: 'enfileirado',
        tipo,
        extras: { enfileirado: true, item_id: item.id }
      });
    } catch (err) {
      await equipamentosEvents.emitirSyncErro({
        equipamento_id: equipamentoId,
        tipo,
        erro: err.message
      });
      await loggerService.logSincronizacao({
        equipamentoId,
        tipo,
        solicitante,
        status: 'erro',
        detalhe: err.message
      });
      return erro({
        mensagem: err.message,
        tipo,
        extras: { erro: err.message }
      });
    }
  }

  /**
   * Seleciona o Mapper/DTO e o evento correspondente ao tipo de comando.
   * @param {string} tipo
   * @param {Object} entidade
   * @returns {{ dto: Object, evento: string|null }}
   * @private
   */
  _mapear(tipo, entidade) {
    switch (tipo) {
      case COMANDOS.SYNC_PRODUTO:
        return { dto: ProdutoMapper.toDTO(entidade), evento: 'emitirSyncProduto' };
      case COMANDOS.REMOVER_PRODUTO:
        return { dto: ProdutoMapper.toDTO(entidade), evento: 'emitirSyncProduto' };
      case COMANDOS.SYNC_PROMOCAO:
        return { dto: PromocaoMapper.toDTO(entidade), evento: 'emitirSyncPromocao' };
      case COMANDOS.SYNC_DEPARTAMENTO:
        return { dto: DepartamentoMapper.toDTO(entidade), evento: 'emitirSyncDepartamento' };
      case COMANDOS.SYNC_ETIQUETA:
        return { dto: EtiquetaMapper.toDTO(entidade), evento: 'emitirSyncEtiqueta' };
      default:
        throw new Error(`Tipo de sincronização não suportado: ${tipo}`);
    }
  }

  /**
   * Cancela uma sincronização inválida/duplicada emitindo evento e log.
   * @private
   */
  async _cancelar(equipamentoId, tipo, solicitante, motivo) {
    await equipamentosEvents.emitirSyncCancelado({
      equipamento_id: equipamentoId,
      tipo,
      motivo
    });
    await loggerService.logSincronizacao({
      equipamentoId,
      tipo,
      solicitante,
      status: 'cancelado',
      detalhe: motivo
    });
    return erro({
      mensagem: motivo,
      status: 'cancelado',
      tipo,
      extras: { cancelado: true, motivo }
    });
  }

  // ─── Atalhos por tipo de entidade ───────────────────────────────

  sincronizarProduto(equipamentoId, produto, opcoes = {}) {
    return this.sincronizar({ equipamentoId, tipo: COMANDOS.SYNC_PRODUTO, entidade: produto, opcoes });
  }

  removerProduto(equipamentoId, produto, opcoes = {}) {
    return this.sincronizar({ equipamentoId, tipo: COMANDOS.REMOVER_PRODUTO, entidade: produto, opcoes });
  }

  sincronizarPromocao(equipamentoId, promocao, opcoes = {}) {
    return this.sincronizar({ equipamentoId, tipo: COMANDOS.SYNC_PROMOCAO, entidade: promocao, opcoes });
  }

  sincronizarDepartamento(equipamentoId, departamento, opcoes = {}) {
    return this.sincronizar({ equipamentoId, tipo: COMANDOS.SYNC_DEPARTAMENTO, entidade: departamento, opcoes });
  }

  sincronizarEtiqueta(equipamentoId, etiqueta, opcoes = {}) {
    return this.sincronizar({ equipamentoId, tipo: COMANDOS.SYNC_ETIQUETA, entidade: etiqueta, opcoes });
  }

  /**
   * Sincroniza uma lista de produtos (cada item vira um comando na fila).
   * @param {number|string} equipamentoId
   * @param {Object[]} produtos
   * @param {Object} [opcoes]
   * @returns {Promise<Object[]>}
   */
  async sincronizarProdutos(equipamentoId, produtos = [], opcoes = {}) {
    const resultados = [];
    for (const produto of produtos) {
      resultados.push(await this.sincronizarProduto(equipamentoId, produto, opcoes));
    }
    return resultados;
  }
}

const syncManager = new SyncManager();

module.exports = syncManager;
module.exports.SyncManager = SyncManager;
