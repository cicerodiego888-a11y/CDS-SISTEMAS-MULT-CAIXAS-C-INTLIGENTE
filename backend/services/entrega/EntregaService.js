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
const { montarSnapshotEntrega } = require('./EntregaClienteSnapshot');
const { gravarAuditoria } = require('../auditoria');
const db = require('../../database');

const MSG_ENTREGA_JA_INICIADA = 'Esta entrega já foi iniciada e não pode mais ser editada.';

const CAMPOS_EDITAVEIS_ANTES_INICIO = Object.freeze([
  'cliente_id',
  'nome_cliente_entrega',
  'cpf_cnpj_cliente_entrega',
  'email_cliente_entrega',
  'telefone_entrega',
  'cep_entrega',
  'endereco_entrega',
  'numero_entrega',
  'complemento_entrega',
  'bairro_entrega',
  'cidade_entrega',
  'uf_entrega',
  'referencia_entrega',
  'entregador',
  'taxa_entrega',
  'pagamento_previsto',
  'leva_maquineta',
  'troco_para',
  'observacao_entrega'
]);

function buscarClientePorId(clienteId) {
  return new Promise((resolve, reject) => {
    if (!clienteId) return resolve(null);
    db.get(
      `SELECT id, nome, cpf_cnpj, telefone, email, cep, rua, numero, bairro, cidade, uf, endereco
       FROM clientes WHERE id = ?`,
      [clienteId],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });
}

function valorComparavel(campo, valor) {
  if (campo === 'leva_maquineta') {
    return valor === true || valor === 1 || valor === '1' ? 1 : 0;
  }
  if (campo === 'taxa_entrega' || campo === 'troco_para') {
    return Number(valor || 0);
  }
  if (campo === 'cliente_id') {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (valor == null) return null;
  const s = String(valor).trim();
  return s === '' ? null : s;
}

function diffCamposEntrega(anterior, proximo) {
  const alterados = [];
  for (const campo of CAMPOS_EDITAVEIS_ANTES_INICIO) {
    const de = valorComparavel(campo, anterior[campo]);
    const para = valorComparavel(campo, proximo[campo]);
    if (de !== para && String(de) !== String(para)) {
      alterados.push({ campo, de, para });
    }
  }
  return alterados;
}

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
    this._buscarCliente = deps.buscarCliente || buscarClientePorId;
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

  /**
   * Edição operacional antes do início (Sprint 3).
   * Somente AGUARDANDO_ENTREGA. Atualiza snapshot sem alterar cadastro mestre.
   */
  async editarEntrega(vendaId, payload = {}) {
    const atual = await this.repository.buscarPorVendaId(vendaId);
    if (!atual) {
      const err = new Error('Venda para entrega não encontrada.');
      err.status = 404;
      throw err;
    }

    if (atual.status_venda === StatusVenda.CANCELADA || Number(atual.cancelada || 0) === 1
      || atual.status_entrega === StatusEntrega.CANCELADA) {
      const err = new Error('Não é permitido editar uma entrega cancelada.');
      err.status = 400;
      err.codigo = 'ENTREGA_CANCELADA';
      throw err;
    }

    if (atual.status_entrega !== StatusEntrega.AGUARDANDO_ENTREGA) {
      const err = new Error(MSG_ENTREGA_JA_INICIADA);
      err.status = 409;
      err.codigo = 'ENTREGA_JA_INICIADA';
      throw err;
    }

    const ctx = payload._auditoria || {};
    const body = { ...payload };
    delete body._auditoria;
    delete body.status_entrega;
    delete body.status_venda;

    if (Object.prototype.hasOwnProperty.call(body, 'pagamento_previsto')
      && body.pagamento_previsto
      && !this.validator.validarPagamentoPrevisto(body.pagamento_previsto)) {
      const err = new Error('Pagamento previsto inválido.');
      err.status = 400;
      throw err;
    }

    let clienteId = Object.prototype.hasOwnProperty.call(body, 'cliente_id')
      ? body.cliente_id
      : atual.cliente_id;
    const clienteIdNum = clienteId != null && String(clienteId).trim() !== ''
      ? Number(clienteId)
      : null;
    const cliente = (Number.isFinite(clienteIdNum) && clienteIdNum > 0)
      ? await this._buscarCliente(clienteIdNum)
      : null;

    if (Number.isFinite(clienteIdNum) && clienteIdNum > 0 && !cliente) {
      const err = new Error('Cliente informado não encontrado.');
      err.status = 400;
      throw err;
    }

    const snapshotInput = {
      cliente_id: Number.isFinite(clienteIdNum) && clienteIdNum > 0 ? clienteIdNum : null,
      nome_cliente_entrega: Object.prototype.hasOwnProperty.call(body, 'nome_cliente_entrega')
        ? body.nome_cliente_entrega
        : (Object.prototype.hasOwnProperty.call(body, 'cliente_nome')
          ? body.cliente_nome
          : atual.nome_cliente_entrega),
      cpf_cnpj_cliente_entrega: Object.prototype.hasOwnProperty.call(body, 'cpf_cnpj_cliente_entrega')
        ? body.cpf_cnpj_cliente_entrega
        : (Object.prototype.hasOwnProperty.call(body, 'cpf_cnpj')
          ? body.cpf_cnpj
          : atual.cpf_cnpj_cliente_entrega),
      email_cliente_entrega: Object.prototype.hasOwnProperty.call(body, 'email_cliente_entrega')
        ? body.email_cliente_entrega
        : (Object.prototype.hasOwnProperty.call(body, 'email')
          ? body.email
          : atual.email_cliente_entrega),
      telefone_entrega: Object.prototype.hasOwnProperty.call(body, 'telefone_entrega')
        ? body.telefone_entrega
        : (Object.prototype.hasOwnProperty.call(body, 'telefone')
          ? body.telefone
          : atual.telefone_entrega),
      cep_entrega: Object.prototype.hasOwnProperty.call(body, 'cep_entrega')
        ? body.cep_entrega
        : atual.cep_entrega,
      endereco_entrega: Object.prototype.hasOwnProperty.call(body, 'endereco_entrega')
        ? body.endereco_entrega
        : atual.endereco_entrega,
      numero_entrega: Object.prototype.hasOwnProperty.call(body, 'numero_entrega')
        ? body.numero_entrega
        : atual.numero_entrega,
      complemento_entrega: Object.prototype.hasOwnProperty.call(body, 'complemento_entrega')
        ? body.complemento_entrega
        : atual.complemento_entrega,
      bairro_entrega: Object.prototype.hasOwnProperty.call(body, 'bairro_entrega')
        ? body.bairro_entrega
        : atual.bairro_entrega,
      cidade_entrega: Object.prototype.hasOwnProperty.call(body, 'cidade_entrega')
        ? body.cidade_entrega
        : atual.cidade_entrega,
      uf_entrega: Object.prototype.hasOwnProperty.call(body, 'uf_entrega')
        ? body.uf_entrega
        : atual.uf_entrega,
      referencia_entrega: Object.prototype.hasOwnProperty.call(body, 'referencia_entrega')
        ? body.referencia_entrega
        : atual.referencia_entrega
    };

    const snapshot = montarSnapshotEntrega(snapshotInput, cliente);

    const levaMaquineta = Object.prototype.hasOwnProperty.call(body, 'leva_maquineta')
      ? (body.leva_maquineta === true || body.leva_maquineta === 1 || body.leva_maquineta === '1' ? 1 : 0)
      : Number(atual.leva_maquineta || 0);

    let trocoPara = Object.prototype.hasOwnProperty.call(body, 'troco_para')
      ? Number(body.troco_para || 0)
      : Number(atual.troco_para || 0);
    if (Object.prototype.hasOwnProperty.call(body, 'levar_troco') && !body.levar_troco) {
      trocoPara = 0;
    }

    const patch = {
      cliente_id: snapshot.cliente_id,
      nome_cliente_entrega: snapshot.nome_cliente_entrega,
      cpf_cnpj_cliente_entrega: snapshot.cpf_cnpj_cliente_entrega,
      email_cliente_entrega: snapshot.email_cliente_entrega,
      telefone_entrega: snapshot.telefone_entrega,
      cep_entrega: snapshot.cep_entrega,
      endereco_entrega: snapshot.endereco_entrega || snapshot.endereco_entrega_formatado,
      numero_entrega: snapshot.numero_entrega,
      complemento_entrega: snapshot.complemento_entrega,
      bairro_entrega: snapshot.bairro_entrega,
      cidade_entrega: snapshot.cidade_entrega,
      uf_entrega: snapshot.uf_entrega,
      referencia_entrega: snapshot.referencia_entrega,
      entregador: Object.prototype.hasOwnProperty.call(body, 'entregador')
        ? (String(body.entregador || '').trim() || null)
        : atual.entregador,
      taxa_entrega: Object.prototype.hasOwnProperty.call(body, 'taxa_entrega')
        ? Number(body.taxa_entrega || 0)
        : Number(atual.taxa_entrega || 0),
      pagamento_previsto: Object.prototype.hasOwnProperty.call(body, 'pagamento_previsto')
        ? String(body.pagamento_previsto || '').toUpperCase()
        : atual.pagamento_previsto,
      leva_maquineta: levaMaquineta,
      troco_para: trocoPara,
      observacao_entrega: Object.prototype.hasOwnProperty.call(body, 'observacao_entrega')
        ? (String(body.observacao_entrega || '').trim() || null)
        : atual.observacao_entrega,
      _somenteAguardandoEntrega: true
    };

    const alterados = diffCamposEntrega(atual, patch);

    // Revalidação de concorrência no UPDATE (status ainda AGUARDANDO_ENTREGA)
    const resultado = await this.repository.atualizarEntrega(vendaId, patch);
    if (!resultado.changes) {
      const recheck = await this.repository.buscarPorVendaId(vendaId);
      if (!recheck) {
        const err = new Error('Venda para entrega não encontrada.');
        err.status = 404;
        throw err;
      }
      if (recheck.status_entrega !== StatusEntrega.AGUARDANDO_ENTREGA) {
        const err = new Error(MSG_ENTREGA_JA_INICIADA);
        err.status = 409;
        err.codigo = 'ENTREGA_JA_INICIADA';
        throw err;
      }
      // Sem mudanças efetivas — ok idempotente
    }

    if (alterados.length) {
      await gravarAuditoria(
        montarPayloadAuditoriaEntrega({
          acao: EntregaAuditoriaEventos.ENTREGA_EDITADA,
          vendaId,
          detalhes: {
            campos_alterados: alterados,
            status_entrega: StatusEntrega.AGUARDANDO_ENTREGA
          },
          ...ctx
        })
      ).catch((e) => console.error(e));
    }

    const item = await this.repository.buscarPorVendaId(vendaId);
    return {
      success: true,
      mensagem: 'Alterações salvas.',
      item,
      campos_alterados: alterados
    };
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

    // Edição de dados operacionais/snapshot: só antes do início
    const temCampoEditavel = CAMPOS_EDITAVEIS_ANTES_INICIO.some(
      (c) => Object.prototype.hasOwnProperty.call(payload, c)
        || Object.prototype.hasOwnProperty.call(payload, 'cliente_nome')
        || Object.prototype.hasOwnProperty.call(payload, 'cpf_cnpj')
        || Object.prototype.hasOwnProperty.call(payload, 'email')
        || Object.prototype.hasOwnProperty.call(payload, 'telefone')
        || Object.prototype.hasOwnProperty.call(payload, 'levar_troco')
    );
    if (temCampoEditavel) {
      return this.editarEntrega(vendaId, payload);
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
