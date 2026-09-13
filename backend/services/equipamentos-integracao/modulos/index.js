'use strict';

/**
 * Adaptadores de módulo — RC5.0
 * Cada módulo consome apenas EquipamentosIntegrationService.
 */

const integration = require('../EquipamentosIntegrationService');
const eventBus = require('../EquipmentEventBus');
const { MODULOS, EVENTOS } = require('../EquipamentosIntegrationService');

const pdv = {
  async naAberturaCaixa(usuario, opcoes = {}) {
    return integration.pdvVerificarObrigatorios({ modulo: MODULOS.PDV, usuario }, opcoes);
  },
  async statusDuranteVenda(usuario, equipamentoId) {
    return integration.pdvStatusVenda({ modulo: MODULOS.PDV, usuario }, equipamentoId);
  },
  async reconectar(usuario, equipamentoId) {
    return integration.pdvReconectar({ modulo: MODULOS.PDV, usuario }, equipamentoId);
  }
};

const compras = {
  async sincronizarProdutos(usuario, payload) {
    return integration.comprasSincronizar({ usuario }, {
      ...payload,
      tipo: payload.tipo || 'produtos'
    });
  },
  async sincronizarDepartamento(usuario, payload) {
    return integration.comprasSincronizar({ usuario }, {
      ...payload,
      tipo: 'departamento'
    });
  },
  async sincronizarConfiguracao(usuario, payload) {
    return integration.comprasSincronizar({ usuario }, {
      ...payload,
      tipo: 'configuracao'
    });
  }
};

const fiscal = {
  async antesDaEmissao(usuario, opcoes = {}) {
    return integration.fiscalValidarEquipamentos({ usuario }, opcoes);
  }
};

const tef = {
  async descobrirPinpads(usuario, opcoes = {}) {
    return integration.tefDescobrirPinpads({ usuario }, opcoes);
  }
};

/** Central Inteligente — consome eventos (não consulta Heartbeat direto). */
const centralInteligente = {
  _handlers: [],
  iniciar() {
    const eventos = [
      EVENTOS.EquipmentOnline,
      EVENTOS.EquipmentOffline,
      EVENTOS.HeartbeatFalhou,
      EVENTOS.EquipmentIdentityChanged,
      EVENTOS.EquipmentFirmwareChanged,
      EVENTOS.EquipmentDiagnosticGenerated,
      EVENTOS.EquipmentSyncFinished
    ];
    const unsub = eventBus.assinar(eventos, (reg) => {
      // Buffer leve para dashboards / Action Center
      centralInteligente._ultimo = reg;
      for (const h of centralInteligente._handlers) {
        try { h(reg); } catch (_) { /* ignore */ }
      }
    });
    centralInteligente._unsub = unsub;
    return { ativo: true, eventos };
  },
  onEvento(handler) {
    if (typeof handler === 'function') centralInteligente._handlers.push(handler);
  },
  obterUltimoEvento() {
    return centralInteligente._ultimo || null;
  },
  parar() {
    if (typeof centralInteligente._unsub === 'function') centralInteligente._unsub();
  }
};

module.exports = {
  pdv,
  compras,
  fiscal,
  tef,
  centralInteligente
};
