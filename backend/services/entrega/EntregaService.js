/**
 * EntregaService — Sprint 2.1
 * Consultas operacionais + status separados (venda × entrega).
 * Sem prestação / financeiro / NFC-e.
 */

const configService = require('../configuracaoService');
const { TipoVenda, StatusEntrega, StatusVenda, PagamentoPrevisto, normalizarStatusEntrega } = require('./enums');
const { entregaRepository } = require('./EntregaRepository');
const { entregaValidator } = require('./EntregaValidator');
const {
  EntregaAuditoriaEventos,
  montarPayloadAuditoriaEntrega,
  labelTimeline,
  TIMELINE_ORDEM
} = require('./EntregaAuditoria');
const { montarHtmlComprovantePrestacao } = require('./ComprovantePrestacao');
const { gravarAuditoria } = require('../auditoria');

function moduloHabilitado() {
  try {
    return configService.recursoHabilitado('vendasEntrega') === true;
  } catch {
    return false;
  }
}

class EntregaService {
  constructor(deps = {}) {
    this.repository = deps.repository || entregaRepository;
    this.validator = deps.validator || entregaValidator;
  }

  estaHabilitado() {
    return moduloHabilitado();
  }

  async listar(filtros = {}) {
    const items = await this.repository.listar(filtros);
    return {
      sprint: '2.1',
      modulo_habilitado: this.estaHabilitado(),
      total: items.length,
      valor_total: Number(items.reduce((s, i) => s + Number(i.total || 0), 0).toFixed(2)),
      total_reservado: Number(items.reduce((s, i) => s + Number(i.total_reservado || 0), 0).toFixed(3)),
      items
    };
  }

  async listarPendentes() {
    const items = await this.repository.listarPendentes();
    return {
      sprint: '2.1',
      modulo_habilitado: this.estaHabilitado(),
      total: items.length,
      items
    };
  }

  async buscarPorId(vendaId) {
    const item = await this.repository.buscarPorVendaId(vendaId);
    let timeline = [];
    if (item) {
      timeline = await this.obterTimeline(vendaId);
    }
    return {
      sprint: '2.1',
      modulo_habilitado: this.estaHabilitado(),
      venda_id: Number(vendaId) || null,
      item,
      timeline
    };
  }

  /**
   * AGUARDANDO_ENTREGA → EM_ENTREGA
   * Não altera status_venda (permanece ABERTA).
   */
  async iniciarEntrega(vendaId, contexto = {}) {
    const atual = await this.repository.buscarPorVendaId(vendaId);
    if (!atual) {
      const err = new Error('Venda para entrega não encontrada.');
      err.status = 404;
      throw err;
    }

    if (atual.status_entrega !== StatusEntrega.AGUARDANDO_ENTREGA) {
      const err = new Error(
        `Só é possível iniciar entrega a partir de AGUARDANDO_ENTREGA. Status atual: ${atual.status_entrega}`
      );
      err.status = 400;
      throw err;
    }

    await this.repository.atualizarStatusEntrega(vendaId, StatusEntrega.EM_ENTREGA);

    await gravarAuditoria(
      montarPayloadAuditoriaEntrega({
        acao: EntregaAuditoriaEventos.ENTREGA_INICIADA,
        vendaId,
        detalhes: {
          de: StatusEntrega.AGUARDANDO_ENTREGA,
          para: StatusEntrega.EM_ENTREGA
        },
        ...contexto
      })
    ).catch((e) => console.error(e));

    await gravarAuditoria(
      montarPayloadAuditoriaEntrega({
        acao: EntregaAuditoriaEventos.MUDANCA_STATUS,
        vendaId,
        detalhes: {
          campo: 'status_entrega',
          de: StatusEntrega.AGUARDANDO_ENTREGA,
          para: StatusEntrega.EM_ENTREGA
        },
        ...contexto
      })
    ).catch((e) => console.error(e));

    const item = await this.repository.buscarPorVendaId(vendaId);
    return { success: true, item };
  }

  async atualizarEntrega(vendaId, payload = {}) {
    const atual = await this.repository.buscarPorVendaId(vendaId);
    if (!atual) {
      const err = new Error('Venda para entrega não encontrada.');
      err.status = 404;
      throw err;
    }

    if (
      atual.status_venda === StatusVenda.FINALIZADA
      || Number(atual.prestacao_realizada || 0) === 1
      || atual.status === 'concluida'
    ) {
      const err = new Error('Não é permitido alterar pagamento/dados após a conclusão da venda.');
      err.status = 400;
      err.codigo = 'VENDA_JA_FINALIZADA';
      throw err;
    }

    if (atual.status_venda === StatusVenda.CANCELADA || Number(atual.cancelada || 0) === 1) {
      const err = new Error('Não é permitido alterar uma entrega cancelada.');
      err.status = 400;
      throw err;
    }

    if (payload.status_entrega === StatusEntrega.EM_ENTREGA
      || normalizarStatusEntrega(payload.status_entrega) === StatusEntrega.EM_ENTREGA) {
      if (atual.status_entrega === StatusEntrega.AGUARDANDO_ENTREGA) {
        return this.iniciarEntrega(vendaId, payload._auditoria || {});
      }
    }

    const ctx = payload._auditoria || {};
    const patch = { ...payload };
    delete patch._auditoria;

    if (Object.prototype.hasOwnProperty.call(patch, 'troco_para')) {
      await gravarAuditoria(
        montarPayloadAuditoriaEntrega({
          acao: EntregaAuditoriaEventos.TROCO_INFORMADO,
          vendaId,
          detalhes: { troco_para: patch.troco_para, anterior: atual.troco_para },
          ...ctx
        })
      ).catch((e) => console.error(e));
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'leva_maquineta')) {
      await gravarAuditoria(
        montarPayloadAuditoriaEntrega({
          acao: EntregaAuditoriaEventos.MAQUINETA_INFORMADA,
          vendaId,
          detalhes: { leva_maquineta: patch.leva_maquineta, anterior: atual.leva_maquineta },
          ...ctx
        })
      ).catch((e) => console.error(e));
    }

    if (patch.status_entrega && patch.status_entrega !== atual.status_entrega) {
      await gravarAuditoria(
        montarPayloadAuditoriaEntrega({
          acao: EntregaAuditoriaEventos.MUDANCA_STATUS,
          vendaId,
          detalhes: {
            campo: 'status_entrega',
            de: atual.status_entrega,
            para: patch.status_entrega
          },
          ...ctx
        })
      ).catch((e) => console.error(e));
    }

    await this.repository.atualizarEntrega(vendaId, patch);
    const item = await this.repository.buscarPorVendaId(vendaId);
    return { success: true, item };
  }

  async registrarPrestacao(vendaId, payload = {}, req = {}, contexto = {}) {
    const { finalizarPrestacao } = require('./MotorFinalizacaoVenda');
    return finalizarPrestacao({
      vendaId,
      body: payload,
      req,
      contextoAuditoria: contexto
    });
  }

  async cancelarEntrega(vendaId, payload = {}, contexto = {}) {
    const { cancelarEntregaMotor } = require('./MotorFinalizacaoVenda');
    return cancelarEntregaMotor({
      vendaId,
      motivo: payload.motivo || null,
      contextoAuditoria: contexto
    });
  }

  // —— Consultas Sprint 2.1 ——

  async dashboard() {
    const [resumo, reservas, porStatus, alertas] = await Promise.all([
      this.repository.resumoDashboard(),
      this.repository.totaisReservados(),
      this.repository.resumoPorStatus(),
      require('./EntregaAlertasService').listarAlertas().catch(() => ({ total: 0, items: [] }))
    ]);
    return {
      sprint: '3.1',
      modulo_habilitado: this.estaHabilitado(),
      dashboard: resumo,
      reservas,
      por_status: porStatus,
      alertas
    };
  }

  async listarAlertas() {
    return require('./EntregaAlertasService').listarAlertas();
  }

  async listarReservasProduto(produtoId) {
    const items = await this.repository.listarReservasPorProduto(produtoId);
    return { sprint: '3.1', produto_id: Number(produtoId), items };
  }

  async agruparPorEntregador(filtros = {}) {
    const grupos = await this.repository.agruparPorEntregador(filtros);

    return {
      sprint: '2.1',
      total_grupos: grupos.length,
      total_pedidos: grupos.reduce((s, g) => s + g.quantidade, 0),
      grupos
    };
  }

  async pedidosPorEntregador(filtros = {}) {
    return this.agruparPorEntregador(filtros);
  }

  async aguardandoPrestacao() {
    const items = await this.repository.listarAguardandoPrestacao();
    return {
      sprint: '2.1',
      total: items.length,
      items
    };
  }

  async resumoEntregas() {
    const [dashboard, reservas, listagem] = await Promise.all([
      this.dashboard(),
      this.repository.totaisReservados(),
      this.listar()
    ]);
    return {
      sprint: '2.1',
      dashboard: dashboard.dashboard,
      reservas,
      quantidade_pedidos: listagem.total,
      valor_total: listagem.valor_total
    };
  }

  async resumoPorStatus() {
    const rows = await this.repository.resumoPorStatus();
    return { sprint: '2.1', items: rows };
  }

  async totaisReservados() {
    const reservas = await this.repository.totaisReservados();
    return { sprint: '2.1', ...reservas };
  }

  async obterTimeline(vendaId) {
    const rows = await this.repository.listarTimeline(vendaId);
    const eventos = (rows || []).map((r) => {
      let detalhes = r.detalhes;
      if (typeof detalhes === 'string') {
        try { detalhes = JSON.parse(detalhes); } catch (_) { /* keep */ }
      }
      return {
        id: r.id,
        acao: r.acao,
        label: labelTimeline(r.acao),
        detalhes,
        usuario_nome: r.usuario_nome || null,
        em: r.criado_em || r.created_at || null
      };
    });

    return {
      venda_id: Number(vendaId) || null,
      ordem_canonica: TIMELINE_ORDEM,
      eventos
    };
  }

  previewComprovante(dados = {}) {
    return montarHtmlComprovantePrestacao(dados);
  }

  enums() {
    return { TipoVenda, StatusEntrega, StatusVenda, PagamentoPrevisto };
  }
}

module.exports = {
  EntregaService,
  entregaService: new EntregaService(),
  moduloHabilitado
};
