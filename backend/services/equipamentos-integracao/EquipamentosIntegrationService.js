'use strict';

/**
 * EquipamentosIntegrationService — Fachada corporativa RC5.0
 *
 * Consome APIs públicas do Motor V1 (congelado).
 * Nenhum módulo ERP deve acessar Drivers/Discovery/Heartbeat diretamente.
 */

const motor = require('../../motores/equipamentos');
const equipamentosService = require('../../motores/equipamentos/services/EquipamentosService');
const syncManager = require('../../motores/equipamentos/services/SyncManager');
const equipamentosEvents = require('../../motores/equipamentos/events/EquipamentosEvents');
const alertChannel = require('../../motores/equipamentos/monitor/AlertChannel');
const eventBus = require('./EquipmentEventBus');
const { EVENTOS } = require('./EquipmentEventBus');
const auditoria = require('./EquipamentosAuditoria');
const { exigirPermissao, MODULOS, ACOES } = require('./EquipamentosPermissoes');

class EquipamentosIntegrationService {
  constructor() {
    this._iniciado = false;
    this._unsubs = [];
  }

  /**
   * Liga pontes Motor → EventBus corporativo (sem alterar o Motor).
   */
  iniciar() {
    if (this._iniciado) return { ativo: true };
    this._iniciado = true;

    auditoria.garantirSchema().catch(() => {});

    const onSyncIniciado = (reg) => {
      eventBus.publicar(EVENTOS.EquipmentSyncStarted, reg);
    };
    const onSyncFim = (reg) => {
      eventBus.publicar(EVENTOS.EquipmentSyncFinished, reg);
      eventBus.publicar(EVENTOS.SincronizacaoConcluida, reg);
    };
    const onSyncErro = (reg) => {
      eventBus.publicar(EVENTOS.EquipmentSyncFinished, { ...reg, erro: true });
    };

    if (typeof equipamentosEvents.on === 'function') {
      equipamentosEvents.on(equipamentosEvents.CANAIS.SYNC_INICIADO, onSyncIniciado);
      equipamentosEvents.on(equipamentosEvents.CANAIS.SYNC_FINALIZADO, onSyncFim);
      equipamentosEvents.on(equipamentosEvents.CANAIS.SYNC_ERRO, onSyncErro);
      this._unsubs.push(() => {
        equipamentosEvents.off(equipamentosEvents.CANAIS.SYNC_INICIADO, onSyncIniciado);
        equipamentosEvents.off(equipamentosEvents.CANAIS.SYNC_FINALIZADO, onSyncFim);
        equipamentosEvents.off(equipamentosEvents.CANAIS.SYNC_ERRO, onSyncErro);
      });
    }

    alertChannel.onAlerta(async (alerta) => {
      const tipo = String(alerta.tipo || '');
      if (tipo.includes('CAIU') || tipo.includes('OFFLINE') || tipo.includes('PERDA')) {
        eventBus.publicar(EVENTOS.EquipmentOffline, alerta);
        eventBus.publicar(EVENTOS.HeartbeatFalhou, alerta);
      } else if (tipo.includes('VOLTOU') || tipo.includes('ONLINE')) {
        eventBus.publicar(EVENTOS.EquipmentOnline, alerta);
      } else if (tipo.includes('IP')) {
        eventBus.publicar(EVENTOS.EquipmentIdentityChanged, alerta);
      } else if (tipo.includes('FIRMWARE')) {
        eventBus.publicar(EVENTOS.EquipmentFirmwareChanged, alerta);
      } else {
        eventBus.publicar(EVENTOS.EquipmentHealthChanged, alerta);
      }
    });

    return { ativo: true };
  }

  parar() {
    for (const u of this._unsubs) {
      try { u(); } catch (_) { /* ignore */ }
    }
    this._unsubs = [];
    this._iniciado = false;
  }

  async _auditar(ctx, acao, fn) {
    const inicio = Date.now();
    try {
      const resultado = await fn();
      await auditoria.registrar({
        modulo: ctx.modulo,
        acao,
        usuario_id: ctx.usuario?.id || ctx.usuario?.usuario_id || null,
        usuario_nome: ctx.usuario?.nome || ctx.usuario?.usuario || null,
        equipamento_id: ctx.equipamento_id || resultado?.equipamento_id || null,
        resultado: 'ok',
        sucesso: true,
        tempo_ms: Date.now() - inicio,
        detalhe: { resumo: resultado?.resumo || resultado?.mensagem || null }
      });
      return resultado;
    } catch (err) {
      await auditoria.registrar({
        modulo: ctx.modulo,
        acao,
        usuario_id: ctx.usuario?.id || null,
        usuario_nome: ctx.usuario?.nome || null,
        equipamento_id: ctx.equipamento_id || null,
        resultado: err.message,
        sucesso: false,
        tempo_ms: Date.now() - inicio,
        detalhe: { codigo: err.codigo || null }
      });
      throw err;
    }
  }

  /**
   * Status geral — Central + Heartbeat via fachadas públicas.
   */
  async obterStatus(ctx = {}) {
    exigirPermissao(ctx.modulo || MODULOS.ADMIN, ACOES.CONSULTAR, ctx.usuario);
    return this._auditar(ctx, 'status', async () => {
      const [dashCentral, dashHb, sync] = await Promise.all([
        motor.centralEquipamentosService.obterDashboard().catch(() => null),
        motor.heartbeatEngine.obterDashboard().catch(() => null),
        motor.monitorService.obterMetricasSincronizacao().catch(() => null)
      ]);
      return {
        motor: 'V1.0.0',
        integracao: 'RC5.0',
        central: dashCentral,
        heartbeat: dashHb,
        sincronizacao: sync,
        event_bus_ativo: this._iniciado
      };
    });
  }

  async listarEquipamentos(ctx = {}, filtros = {}) {
    exigirPermissao(ctx.modulo || MODULOS.ADMIN, ACOES.CONSULTAR, ctx.usuario);
    return this._auditar(ctx, 'listar', async () => {
      const itens = await motor.centralEquipamentosService.listarItens(filtros);
      return { itens };
    });
  }

  async diagnosticar(ctx = {}, equipamentoId) {
    exigirPermissao(ctx.modulo || MODULOS.ADMIN, ACOES.DIAGNOSTICAR, ctx.usuario);
    ctx.equipamento_id = equipamentoId;
    return this._auditar(ctx, 'diagnostico', async () => {
      const resultado = await motor.centralEquipamentosService.diagnosticar(equipamentoId);
      eventBus.publicar(EVENTOS.EquipmentDiagnosticGenerated, {
        equipamento_id: equipamentoId,
        modulo: ctx.modulo,
        resultado
      });
      return { equipamento_id: equipamentoId, diagnostico: resultado };
    });
  }

  async sincronizar(ctx = {}, payload = {}) {
    exigirPermissao(ctx.modulo || MODULOS.COMPRAS, ACOES.SINCRONIZAR, ctx.usuario);
    const equipamentoId = payload.equipamento_id || payload.equipamentoId;
    ctx.equipamento_id = equipamentoId;
    return this._auditar(ctx, 'sincronizar', async () => {
      if (!equipamentoId) {
        throw Object.assign(new Error('equipamento_id obrigatório'), { statusCode: 400 });
      }

      // Capacidades via driver oficial — sem o módulo chamar Driver diretamente.
      const eq = await equipamentosService.buscarPorId(equipamentoId);
      if (!eq) {
        throw Object.assign(new Error('Equipamento não encontrado'), { statusCode: 404 });
      }

      let capacidades = { oficial: false };
      try {
        const driverInfo = await equipamentosService.listarDrivers();
        const match = (driverInfo || []).find((d) =>
          d.codigo === eq.driver_codigo
          || (d.fabricante === eq.fabricante && d.modelo === eq.modelo)
        );
        capacidades = match?.capacidades || match || { driver_codigo: eq.driver_codigo };
      } catch (_) {
        capacidades = { driver_codigo: eq.driver_codigo };
      }

      eventBus.publicar(EVENTOS.EquipmentSyncStarted, {
        equipamento_id: equipamentoId,
        modulo: ctx.modulo,
        capacidades
      });

      const tipo = String(payload.tipo || 'produtos').toLowerCase();
      let resultado;

      if (tipo === 'produto' && payload.produto) {
        resultado = await syncManager.sincronizarProduto(equipamentoId, payload.produto, payload.opcoes || {});
      } else if (tipo === 'produtos' || tipo === 'plu') {
        resultado = await syncManager.sincronizarProdutos(
          equipamentoId,
          payload.produtos || payload.plus || [],
          payload.opcoes || {}
        );
      } else if (tipo === 'departamento' && payload.departamento) {
        resultado = await syncManager.sincronizarDepartamento(
          equipamentoId,
          payload.departamento,
          payload.opcoes || {}
        );
      } else if (tipo === 'configuracao' || tipo === 'configuracoes') {
        resultado = { aplicado: payload.configuracao || {}, tipo: 'configuracao' };
        eventBus.publicar(EVENTOS.EquipmentConfigurationChanged, {
          equipamento_id: equipamentoId,
          configuracao: payload.configuracao
        });
      } else {
        resultado = await syncManager.sincronizarProdutos(
          equipamentoId,
          payload.produtos || [],
          payload.opcoes || {}
        );
      }

      eventBus.publicar(EVENTOS.EquipmentSyncFinished, {
        equipamento_id: equipamentoId,
        modulo: ctx.modulo,
        resultado
      });

      return {
        equipamento_id: equipamentoId,
        capacidades,
        resultado,
        mensagem: 'Sincronização via IntegrationService'
      };
    });
  }

  async listarEventos(ctx = {}, limite = 50) {
    exigirPermissao(ctx.modulo || MODULOS.ADMIN, ACOES.EVENTOS, ctx.usuario);
    return {
      eventos: eventBus.listarHistorico(limite),
      catalogo: EVENTOS
    };
  }

  async listarAuditoria(ctx = {}, filtros = {}) {
    exigirPermissao(ctx.modulo || MODULOS.ADMIN, ACOES.CONSULTAR, ctx.usuario);
    return { itens: await auditoria.listar(filtros) };
  }

  /** PDV — verificação na abertura do caixa */
  async pdvVerificarObrigatorios(ctx = {}, opcoes = {}) {
    exigirPermissao(MODULOS.PDV, ACOES.CONSULTAR, ctx.usuario);
    return this._auditar({ ...ctx, modulo: MODULOS.PDV }, 'pdv_verificar_obrigatorios', async () => {
      const tipos = opcoes.tipos || ['balanca'];
      const lista = await equipamentosService.listar({ todos: '1' });
      const relevantes = lista.filter((e) => e.ativo !== false && tipos.includes(String(e.tipo || 'balanca').toLowerCase()));
      const faltando = [];
      const status = [];

      for (const eq of relevantes) {
        const st = String(eq.status || '').toLowerCase();
        const ok = st === 'online' || st === 'desconhecido';
        status.push({
          id: eq.id,
          nome: eq.nome,
          tipo: eq.tipo,
          status: eq.status,
          ok
        });
        if (!ok && opcoes.obrigatorios !== false) {
          // Apenas marca se explicitamente obrigatório via env/lista
        }
      }

      const obrigatoriosIds = (opcoes.equipamento_ids || []).map(Number).filter(Boolean);
      for (const id of obrigatoriosIds) {
        const eq = relevantes.find((e) => Number(e.id) === id) || lista.find((e) => Number(e.id) === id);
        if (!eq || String(eq.status).toLowerCase() === 'offline' || String(eq.status).toLowerCase() === 'erro') {
          faltando.push({ id, motivo: eq ? `status=${eq.status}` : 'não cadastrado' });
          eventBus.publicar(EVENTOS.EquipmentOffline, { equipamento_id: id, origem: 'PDV' });
        }
      }

      return {
        ok: faltando.length === 0,
        status,
        faltando,
        mensagem: faltando.length
          ? 'Equipamentos obrigatórios indisponíveis'
          : 'Equipamentos OK para abertura de caixa'
      };
    });
  }

  async pdvStatusVenda(ctx = {}, equipamentoId) {
    exigirPermissao(MODULOS.PDV, ACOES.CONSULTAR, ctx.usuario);
    ctx.equipamento_id = equipamentoId;
    return this._auditar({ ...ctx, modulo: MODULOS.PDV }, 'pdv_status_venda', async () => {
      const conexao = await equipamentosService.obterStatusConexao(equipamentoId);
      const saude = await motor.heartbeatEngine.obterSaude(equipamentoId).catch(() => null);
      return { equipamento_id: equipamentoId, conexao, saude };
    });
  }

  async pdvReconectar(ctx = {}, equipamentoId) {
    exigirPermissao(MODULOS.PDV, ACOES.RECONECTAR, ctx.usuario);
    ctx.equipamento_id = equipamentoId;
    return this._auditar({ ...ctx, modulo: MODULOS.PDV }, 'pdv_reconectar', async () => {
      const teste = await equipamentosService.testarConexao(equipamentoId);
      if (teste.sucesso) {
        eventBus.publicar(EVENTOS.EquipmentOnline, { equipamento_id: equipamentoId, origem: 'PDV' });
      } else {
        eventBus.publicar(EVENTOS.EquipmentOffline, { equipamento_id: equipamentoId, origem: 'PDV' });
        eventBus.publicar(EVENTOS.HeartbeatFalhou, { equipamento_id: equipamentoId, origem: 'PDV' });
      }
      return { equipamento_id: equipamentoId, resultado: teste };
    });
  }

  /** Fiscal — pré-emissão */
  async fiscalValidarEquipamentos(ctx = {}, opcoes = {}) {
    exigirPermissao(MODULOS.FISCAL, ACOES.CONSULTAR, ctx.usuario);
    return this._auditar({ ...ctx, modulo: MODULOS.FISCAL }, 'fiscal_validar', async () => {
      const ids = (opcoes.equipamento_ids || []).map(Number).filter(Boolean);
      const indisponiveis = [];
      for (const id of ids) {
        const saude = await motor.heartbeatEngine.obterSaude(id).catch(() => null);
        const eq = await equipamentosService.buscarPorId(id).catch(() => null);
        const status = String(eq?.status || '').toLowerCase();
        const score = Number(saude?.score ?? 100);
        if (!eq || status === 'offline' || status === 'erro' || score <= 40) {
          indisponiveis.push({
            equipamento_id: id,
            status: eq?.status || 'ausente',
            health: saude
          });
        }
      }
      return {
        ok: indisponiveis.length === 0,
        indisponiveis,
        mensagem: indisponiveis.length
          ? 'Equipamentos indisponíveis registrados para emissão'
          : 'Equipamentos validados para emissão'
      };
    });
  }

  /** TEF — discovery via Motor (sem duplicar sdk) */
  async tefDescobrirPinpads(ctx = {}, opcoes = {}) {
    exigirPermissao(MODULOS.TEF, ACOES.DESCOBRIR, ctx.usuario);
    return this._auditar({ ...ctx, modulo: MODULOS.TEF }, 'tef_descobrir', async () => {
      const transportes = opcoes.transportes || ['usb', 'serial'];
      const resultado = await motor.discoveryService.descobrirTodos({
        transportes,
        timeoutMs: opcoes.timeoutMs || 800,
        persistir_sessao: opcoes.persistir_sessao !== false
      });

      // MIE (leitura) via fachada
      let identidades = [];
      try {
        identidades = await motor.identidadeService.listar(50);
      } catch (_) { identidades = []; }

      eventBus.publicar(EVENTOS.EquipmentDiscovered, {
        origem: 'TEF',
        candidatos: resultado?.candidatos?.length || 0
      });

      return {
        candidatos: resultado?.candidatos || [],
        meta: resultado?.meta || {},
        identidades_conhecidas: identidades.length,
        mensagem: 'Discovery TEF via Motor de Equipamentos'
      };
    });
  }

  /** Compras — sync com consulta de capacidades */
  async comprasSincronizar(ctx = {}, payload = {}) {
    return this.sincronizar({ ...ctx, modulo: MODULOS.COMPRAS }, payload);
  }
}

const equipamentosIntegrationService = new EquipamentosIntegrationService();

module.exports = equipamentosIntegrationService;
module.exports.EquipamentosIntegrationService = EquipamentosIntegrationService;
module.exports.MODULOS = MODULOS;
module.exports.ACOES = ACOES;
module.exports.eventBus = eventBus;
module.exports.EVENTOS = EVENTOS;
