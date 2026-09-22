/**
 * Orquestrador operacional — aplica Policy sem alterar motores (Sprint 5).
 *
 * Fluxo: detectar → Policy → enfileirar (ASSISTIDO) ou executar via motores existentes (AUTOMÁTICO).
 * Toda consulta SEFAZ continua passando pelo Gate dos motores existentes.
 *
 * @module services/fiscal/central/CentralOperationOrchestrator
 */
'use strict';

const CentralOperationPolicy = require('./CentralOperationPolicy');
const CentralOperationConfigStore = require('./CentralOperationConfigStore');
const CentralActionQueue = require('./CentralActionQueue');
const CentralActionAuditoria = require('./CentralActionAuditoria');
const { criarActionId } = require('./CentralActionId');
const { TipoAcao } = require('./CentralActionTypes');
const {
  ModoOperacao,
  OrigemAcao,
  StatusDecisao
} = require('./CentralOperationModes');
const { AchadoCodigo } = require('../descoberta-nsu/ReconcilicaoDfeAchados');

class CentralOperationOrchestrator {
  constructor(deps = {}) {
    this._configStore = deps.configStore || new CentralOperationConfigStore({
      configRepository: deps.configRepository || null
    });
    this._queue = deps.actionQueue || CentralActionQueue.obterActionQueue();
    this._auditoria = deps.auditoria || new CentralActionAuditoria({
      emitirEvento: deps.emitirEvento
    });
    this._recuperarXml = deps.recuperarXml
      || (async (documentoId, opcoes) => {
        const { obterMotorRecuperacaoXml } = require('../../../motores/central-entradas/recuperacao-xml');
        return obterMotorRecuperacaoXml().solicitarRecuperacaoManual(documentoId, opcoes);
      });
    this._sincronizar = deps.sincronizar
      || (async (opcoes) => {
        const sync = require('../../../motores/central-entradas/services/CentralSyncExecucaoService');
        return sync.executar(opcoes);
      });
    this._reconciliar = deps.reconciliar
      || (async (cnpj, ambiente, opcoes) => {
        const { MotorReconcilicaoDfe } = require('../descoberta-nsu');
        const motor = new MotorReconcilicaoDfe({});
        return motor.obterResumo(cnpj, ambiente, opcoes);
      });
    this._avaliarProtecoes = deps.avaliarProtecoes
      || require('./CentralOperationProtecoes').avaliarProtecoesOperacionais;
  }

  async obterPolitica(cnpj = null, ambiente = null) {
    const cfg = await this._configStore.obter(cnpj, ambiente);
    return new CentralOperationPolicy({ config: cfg });
  }

  async obterConfig(cnpj = null, ambiente = null) {
    return this._configStore.obter(cnpj, ambiente);
  }

  async salvarConfig(patch, cnpj = null, ambiente = null) {
    return this._configStore.salvar(patch, cnpj, ambiente);
  }

  listarAcoesPendentes(cnpj = null, ambiente = null) {
    return this._queue.listarPendentes(cnpj, ambiente);
  }

  listarAuditoria(filtros = {}) {
    return this._auditoria.listar(filtros);
  }

  /**
   * Mapeia achados da reconciliação para propostas de ação.
   */
  proporAcoesDeReconcilicao(reconcilicao = {}) {
    const r = reconcilicao || {};
    const propostas = [];
    const cnpj = r.cnpj;
    const ambiente = r.ambiente;

    for (const a of r.achados || []) {
      if (a.codigo === AchadoCodigo.XML_PENDENTE) {
        propostas.push({
          tipo: TipoAcao.RECUPERAR_XML,
          cnpj,
          ambiente,
          documentoId: a.documentoId || null,
          chave: a.chave || null,
          motivo: 'XML completo ainda não disponível',
          titulo: 'XML pendente',
          labelAcao: 'RECUPERAR XML'
        });
      }
      if (a.codigo === AchadoCodigo.DOCUMENTOS_POSTERIORES_DISPONIVEIS) {
        propostas.push({
          tipo: TipoAcao.SINCRONIZAR_DISTNSU,
          cnpj,
          ambiente,
          motivo: a.mensagem || 'Existem posições de NSU posteriores disponíveis.',
          titulo: 'Documentos posteriores',
          labelAcao: 'SINCRONIZAR',
          detalhe: { posicoesEntre: a.posicoesEntre }
        });
      }
      if (a.codigo === AchadoCodigo.POSSIVEL_LACUNA_NSU) {
        propostas.push({
          tipo: TipoAcao.ANALISAR_LACUNA,
          cnpj,
          ambiente,
          motivo: 'Possível lacuna de NSU — requer confirmação (nunca corrige cursor automaticamente)',
          titulo: 'Possível lacuna',
          labelAcao: 'ANALISAR',
          detalhe: a
        });
      }
      if (a.codigo === AchadoCodigo.INCONSISTENCIA_CHAVE_XML) {
        propostas.push({
          tipo: TipoAcao.TRATAR_INCONSISTENCIA_CHAVE,
          cnpj,
          ambiente,
          documentoId: a.documentoId,
          motivo: 'Inconsistência de chave — requer confirmação',
          titulo: 'Inconsistência de chave',
          labelAcao: 'REVISAR'
        });
      }
      if (a.codigo === AchadoCodigo.INCONSISTENCIA_CNPJ_XML) {
        propostas.push({
          tipo: TipoAcao.TRATAR_DIVERGENCIA_CNPJ,
          cnpj,
          ambiente,
          documentoId: a.documentoId,
          motivo: 'Divergência de CNPJ — requer confirmação',
          titulo: 'Divergência de CNPJ',
          labelAcao: 'REVISAR'
        });
      }
    }
    return propostas;
  }

  /**
   * Avalia propostas conforme Policy; enfileira ou executa.
   */
  async processarPropostas(propostas = [], opcoes = {}) {
    const resultados = [];
    for (const p of propostas) {
      resultados.push(await this.solicitarAcao({
        ...p,
        origem: opcoes.origem || OrigemAcao.AUTOMATIC,
        usuarioId: opcoes.usuarioId || null,
        confirmado: opcoes.confirmado === true
      }));
    }
    return resultados;
  }

  /**
   * Solicita uma ação (manual ou automática).
   */
  async solicitarAcao(params = {}) {
    const tipo = String(params.tipo || params.acao || '').toUpperCase();
    const cnpj = params.cnpj ? String(params.cnpj).replace(/\D/g, '') : null;
    const ambiente = params.ambiente != null ? (Number(params.ambiente) === 1 ? 1 : 2) : null;
    const actionId = params.action_id || criarActionId();
    const origem = params.origem || OrigemAcao.MANUAL;

    const policy = await this.obterPolitica(cnpj, ambiente);
    const protecoes = await this._avaliarProtecoes({ cnpj, ambiente, tipo });
    const decisao = policy.decidir({
      acao: tipo,
      confirmado: params.confirmado === true,
      protecoes
    });

    const baseAudit = {
      action_id: actionId,
      cnpj,
      ambiente,
      tipo,
      modo: decisao.modo,
      origem,
      usuarioId: params.usuarioId || null,
      chave: params.chave || null,
      documentoId: params.documentoId || null,
      request_id: params.request_id || params.requestId || null,
      motivo: decisao.motivo,
      status: decisao.status
    };

    if (decisao.status === StatusDecisao.BLOQUEADO
      || decisao.status === StatusDecisao.AGUARDANDO_PROXIMA_JANELA) {
      await this._auditoria.registrar({
        ...baseAudit,
        resultado: decisao.status
      });
      return {
        action_id: actionId,
        ...decisao,
        executado: false,
        enfileirado: false
      };
    }

    if (decisao.exigeConfirmacao || decisao.status === StatusDecisao.AGUARDAR_CONFIRMACAO
      || decisao.status === StatusDecisao.ACAO_REQUER_CONFIRMACAO) {
      const item = this._queue.enfileirar({
        action_id: actionId,
        tipo,
        cnpj,
        ambiente,
        documentoId: params.documentoId || null,
        chave: params.chave || null,
        titulo: params.titulo || tipo,
        labelAcao: params.labelAcao || 'EXECUTAR',
        motivo: params.motivo || decisao.motivo,
        modo: decisao.modo,
        origem,
        classificacao: decisao.classificacao,
        detalhe: params.detalhe || null,
        status: 'PENDENTE'
      });
      await this._auditoria.registrar({
        ...baseAudit,
        resultado: 'ACAO_PENDENTE'
      });
      return {
        action_id: actionId,
        ...decisao,
        executado: false,
        enfileirado: true,
        pendente: item
      };
    }

    // EXECUTAR
    const exec = await this._executarAcao(tipo, params, actionId);
    await this._auditoria.registrar({
      ...baseAudit,
      request_id: exec.request_id || baseAudit.request_id,
      resultado: exec.resultado || (exec.sucesso ? 'OK' : 'ERRO'),
      detalhe: exec
    });
    return {
      action_id: actionId,
      ...decisao,
      executado: true,
      enfileirado: false,
      resultadoExecucao: exec
    };
  }

  /**
   * Confirma ação pendente (ASSISTIDO).
   */
  async confirmarAcao(actionId, opcoes = {}) {
    const item = this._queue.obter(actionId);
    if (!item) {
      const err = new Error('Ação pendente não encontrada.');
      err.status = 404;
      throw err;
    }
    this._queue.atualizar(actionId, { status: 'CONFIRMADA' });
    const r = await this.solicitarAcao({
      ...item,
      tipo: item.tipo,
      confirmado: true,
      origem: OrigemAcao.MANUAL,
      usuarioId: opcoes.usuarioId || null,
      action_id: actionId
    });
    if (r.executado) {
      this._queue.atualizar(actionId, { status: 'CONCLUIDA', resultado: r.resultadoExecucao });
    }
    return r;
  }

  /**
   * Ciclo leve: reconcilia + processa propostas conforme modo.
   */
  async executarCicloOperacional(cnpj, ambiente, opcoes = {}) {
    const recon = await this._reconciliar(cnpj, ambiente, {
      periodo: opcoes.periodo || 'ultima_sincronizacao',
      salvarSnapshot: true
    });
    const propostas = this.proporAcoesDeReconcilicao(recon);
    const processados = await this.processarPropostas(propostas, {
      origem: OrigemAcao.AUTOMATIC,
      usuarioId: null
    });
    const cfg = await this.obterConfig(cnpj, ambiente);
    return {
      modo: cfg.modo,
      reconciliationId: recon.reconciliationId,
      statusReconcilicao: recon.status,
      propostas: propostas.length,
      processados,
      pendentes: this.listarAcoesPendentes(cnpj, ambiente),
      somenteDiagnosticoReconcilicao: true
    };
  }

  /** Painel dashboard */
  async obterPainelDashboard(cnpj, ambiente) {
    const cfg = await this.obterConfig(cnpj, ambiente);
    const pendentes = this.listarAcoesPendentes(cnpj, ambiente);
    return {
      titulo: 'CENTRAL DE ENTRADAS',
      modo: cfg.modo,
      modoLabel: cfg.labels?.modo || cfg.modo,
      modoVisual: cfg.modo === ModoOperacao.AUTOMATICO ? 'verde' : 'amarelo',
      flags: cfg.flags,
      protecoesSempreAtivas: cfg.protecoesSempreAtivas,
      acoesAguardandoConfirmacao: pendentes.length,
      pendentes: pendentes.slice(0, 20)
    };
  }

  /** @private */
  async _executarAcao(tipo, params, actionId) {
    try {
      if (tipo === TipoAcao.RECUPERAR_XML || tipo === TipoAcao.RETRY_RECUPERAVEL) {
        if (!params.documentoId && !params.chave) {
          return { sucesso: false, resultado: 'ERRO', motivo: 'documentoId/chave obrigatório' };
        }
        const r = await this._recuperarXml(params.documentoId || params.chave, {
          origem: 'CONSULTA_MANUAL',
          correlationId: actionId,
          executarImediato: true
        });
        return {
          sucesso: r?.sucesso !== false,
          resultado: r?.resultado?.recuperado || r?.idempotente
            ? 'XML_COMPLETO'
            : (r?.resultado?.mensagem || r?.mensagem || 'RECUPERACAO_ENFILEIRADA'),
          request_id: r?.resultado?.request_id || r?.request_id || null,
          detalhe: r
        };
      }
      if (tipo === TipoAcao.SINCRONIZAR_DISTNSU) {
        const r = await this._sincronizar({
          origem: 'OPERACAO_POLICY',
          correlationId: actionId,
          cnpj: params.cnpj,
          ambiente: params.ambiente,
          ignorarHorario: true
        });
        return {
          sucesso: r?.sucesso !== false && !r?.ignorado,
          resultado: r?.codigo || (r?.sucesso ? 'SYNC_OK' : 'SYNC_FALHA'),
          request_id: r?.requestId || r?.correlationId || null,
          detalhe: r
        };
      }
      if (tipo === TipoAcao.EXECUTAR_RECONCILIACAO || tipo === TipoAcao.ATUALIZAR_DIAGNOSTICO) {
        const r = await this._reconciliar(params.cnpj, params.ambiente, {});
        return {
          sucesso: true,
          resultado: r?.status || 'RECONCILIACAO_OK',
          request_id: r?.reconciliationId || null,
          detalhe: { status: r?.status, resumo: r?.resumo }
        };
      }
      // CONFIRMATION types should not reach here without handlers
      return {
        sucesso: false,
        resultado: 'NAO_IMPLEMENTADO',
        motivo: `Execução direta não disponível para ${tipo} (requer fluxo assistido/especial)`
      };
    } catch (err) {
      return { sucesso: false, resultado: 'ERRO', motivo: err.message };
    }
  }
}

module.exports = CentralOperationOrchestrator;
