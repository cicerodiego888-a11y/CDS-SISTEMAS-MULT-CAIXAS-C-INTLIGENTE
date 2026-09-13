/**
 * EquipamentosEvents — Barramento de eventos do Motor de Equipamentos
 *
 * Responsabilidade:
 * - Emitir eventos de domínio (equipamento.criado, etc.)
 * - Persistir eventos em equipamentos_eventos
 * - Servir de ponte para SSE futura
 */

const EventEmitter = require('events');
const equipamentosRepository = require('../repositories/EquipamentosRepository');

class EquipamentosEvents extends EventEmitter {
  constructor() {
    super();
    this.CANAIS = {
      CRIADO: 'equipamento.criado',
      EDITADO: 'equipamento.editado',
      REMOVIDO: 'equipamento.removido',
      SYNC_INICIADO: 'sync.iniciado',
      SYNC_PRODUTO: 'sync.produto',
      SYNC_PROMOCAO: 'sync.promocao',
      SYNC_DEPARTAMENTO: 'sync.departamento',
      SYNC_ETIQUETA: 'sync.etiqueta',
      SYNC_CANCELADO: 'sync.cancelado',
      SYNC_ERRO: 'sync.erro',
      SYNC_FINALIZADO: 'sync.finalizado'
    };
  }

  async _emitirPersistido(evento, payload = {}) {
    const registro = {
      evento,
      equipamento_id: payload.id || payload.equipamento_id || null,
      payload,
      timestamp: new Date().toISOString()
    };

    this.emit(evento, registro);

    try {
      await equipamentosRepository.gravarEvento({
        equipamento_id: registro.equipamento_id,
        evento,
        payload: registro
      });
    } catch (err) {
      console.error('[EquipamentosEvents] Falha ao persistir evento:', err.message);
    }

    return registro;
  }

  emitirEquipamentoCriado(equipamento) {
    return this._emitirPersistido(this.CANAIS.CRIADO, equipamento);
  }

  emitirEquipamentoEditado(equipamento) {
    return this._emitirPersistido(this.CANAIS.EDITADO, equipamento);
  }

  emitirEquipamentoRemovido(dados) {
    return this._emitirPersistido(this.CANAIS.REMOVIDO, dados);
  }

  onEquipamentoCriado(callback) {
    this.on(this.CANAIS.CRIADO, callback);
  }

  onEquipamentoEditado(callback) {
    this.on(this.CANAIS.EDITADO, callback);
  }

  onEquipamentoRemovido(callback) {
    this.on(this.CANAIS.REMOVIDO, callback);
  }

  // ─── Eventos de sincronização (Sprint 4) ────────────────────────

  emitirSyncIniciado(dados) {
    return this._emitirPersistido(this.CANAIS.SYNC_INICIADO, dados);
  }

  emitirSyncProduto(dados) {
    return this._emitirPersistido(this.CANAIS.SYNC_PRODUTO, dados);
  }

  emitirSyncPromocao(dados) {
    return this._emitirPersistido(this.CANAIS.SYNC_PROMOCAO, dados);
  }

  emitirSyncDepartamento(dados) {
    return this._emitirPersistido(this.CANAIS.SYNC_DEPARTAMENTO, dados);
  }

  emitirSyncEtiqueta(dados) {
    return this._emitirPersistido(this.CANAIS.SYNC_ETIQUETA, dados);
  }

  emitirSyncCancelado(dados) {
    return this._emitirPersistido(this.CANAIS.SYNC_CANCELADO, dados);
  }

  emitirSyncErro(dados) {
    return this._emitirPersistido(this.CANAIS.SYNC_ERRO, dados);
  }

  emitirSyncFinalizado(dados) {
    return this._emitirPersistido(this.CANAIS.SYNC_FINALIZADO, dados);
  }

  onSync(evento, callback) {
    this.on(evento, callback);
  }

  removerTodosListeners() {
    this.removeAllListeners();
  }
}

const equipamentosEvents = new EquipamentosEvents();

module.exports = equipamentosEvents;
