'use strict';

/**
 * CentralEquipamentosService — RC3.0
 * Consome EquipamentosService, IdentidadeService e DiscoverySessions.
 * Não altera Discovery / MIE / Registry / EquipamentosService.
 */

const equipamentosService = require('../services/EquipamentosService');
const identidadeService = require('../identidade/IdentidadeService');
const discoverySessions = require('../repositories/DiscoverySessionsRepository');
const {
  STATUS,
  STATUS_ROTULO,
  resolverStatusCentral,
  calcularHealthScore
} = require('./CentralStatus');

function normalizarTexto(v) {
  return String(v || '').trim().toLowerCase();
}

class CentralEquipamentosService {
  /**
   * Dashboard agregado (endpoint próprio — não usa /equipamentos/resumo).
   */
  async obterDashboard() {
    const itens = await this.listarItens({});
    const contagem = {
      total: itens.length,
      online: 0,
      offline: 0,
      novos: 0,
      conhecidos: 0,
      problemas: 0,
      sincronizando: 0,
      nunca_visto: 0,
      alterou_ip: 0,
      alterou_firmware: 0,
      erro: 0
    };

    for (const item of itens) {
      const s = item.status_central;
      if (s === STATUS.ONLINE) contagem.online += 1;
      if (s === STATUS.OFFLINE) contagem.offline += 1;
      if (s === STATUS.SINCRONIZANDO) contagem.sincronizando += 1;
      if (s === STATUS.NUNCA_VISTO) contagem.nunca_visto += 1;
      if (s === STATUS.ALTEROU_IP) contagem.alterou_ip += 1;
      if (s === STATUS.ALTEROU_FIRMWARE) contagem.alterou_firmware += 1;
      if (s === STATUS.ERRO) contagem.erro += 1;
      if (item.identidade_status === 'novo' || s === STATUS.NUNCA_VISTO) contagem.novos += 1;
      if (item.identidade_status === 'conhecido' || s === STATUS.ONLINE) contagem.conhecidos += 1;
      if ([STATUS.ERRO, STATUS.OFFLINE, STATUS.ALTEROU_IP, STATUS.ALTEROU_FIRMWARE].includes(s)) {
        contagem.problemas += 1;
      }
    }

    // conhecidos: identidades conhecidas + cadastrados estáveis
    contagem.conhecidos = itens.filter((i) =>
      i.identidade_status === 'conhecido'
      || (i.equipamento_id && ![STATUS.NUNCA_VISTO, STATUS.ERRO].includes(i.status_central))
    ).length;

    contagem.novos = itens.filter((i) =>
      i.identidade_status === 'novo' || i.status_central === STATUS.NUNCA_VISTO
    ).length;

    const healthMedio = itens.length
      ? Math.round(itens.reduce((acc, i) => acc + Number(i.health_score || 0), 0) / itens.length)
      : 0;

    return {
      ...contagem,
      health_medio: healthMedio,
      gerado_em: new Date().toISOString()
    };
  }

  /**
   * @param {Object} filtros
   */
  async listarItens(filtros = {}) {
    const [equipamentos, identidades] = await Promise.all([
      equipamentosService.listar({ todos: '1' }).catch(() => []),
      identidadeService.listar(200).catch(() => [])
    ]);

    const porIp = new Map();
    const porPorta = new Map();
    const usadosIdentidade = new Set();

    for (const idn of identidades || []) {
      if (idn.ip_atual) porIp.set(String(idn.ip_atual), idn);
      if (idn.porta_com_atual) porPorta.set(String(idn.porta_com_atual), idn);
    }

    const itens = [];

    for (const eq of equipamentos || []) {
      let idn = null;
      if (eq.ip && porIp.has(String(eq.ip))) idn = porIp.get(String(eq.ip));
      else if (eq.porta_com && porPorta.has(String(eq.porta_com))) idn = porPorta.get(String(eq.porta_com));

      if (idn) usadosIdentidade.add(idn.id);

      const item = this._montarItem({
        tipo_origem: idn ? 'ambos' : 'cadastrado',
        equipamento: eq,
        identidade: idn
      });
      itens.push(item);
    }

    for (const idn of identidades || []) {
      if (usadosIdentidade.has(idn.id)) continue;
      itens.push(this._montarItem({
        tipo_origem: 'descoberto',
        equipamento: null,
        identidade: idn
      }));
    }

    return this._filtrar(itens, filtros);
  }

  _montarItem({ tipo_origem, equipamento, identidade }) {
    const eq = equipamento || {};
    const idn = identidade || {};

    const bruto = {
      tipo_origem,
      equipamento_id: eq.id || null,
      identidade_id: idn.id || null,
      nome: eq.nome || [idn.modelo, idn.driver_codigo, idn.ip_atual || idn.porta_com_atual].filter(Boolean).join(' ') || `Identidade #${idn.id || '?'}`,
      fabricante: eq.fabricante || null,
      modelo: eq.modelo || idn.modelo || null,
      driver_codigo: eq.driver_codigo || idn.driver_codigo || null,
      transporte: eq.transporte || idn.transporte || null,
      status: eq.status || null,
      identidade_status: idn.status || null,
      identidade: idn.id
        ? {
          id: idn.id,
          status: idn.status || null,
          chave: idn.chave || null,
          vezes_visto: idn.vezes_visto,
          ip_anterior: idn.ip_anterior,
          ip_atual: idn.ip_atual
        }
        : null,
      ultima_descoberta: idn.ultimo_visto_em || null,
      ultimo_ip: idn.ip_atual || eq.ip || null,
      ip_anterior: idn.ip_anterior || null,
      ultimo_firmware: idn.firmware || null,
      ultima_comunicacao: eq.ultima_comunicacao || eq.ultimo_teste || idn.ultimo_visto_em || null,
      confianca: null,
      ultimo_erro: eq.ultimo_erro || null,
      ativo: eq.ativo != null ? Boolean(eq.ativo) : null,
      porta_tcp: eq.porta_tcp || idn.porta_atual || null,
      porta_com: eq.porta_com || idn.porta_com_atual || null
    };

    // Se identidade veio só do repositório sem status UI, inferir
    if (!bruto.identidade_status && idn.id) {
      if (idn.ip_anterior && idn.ip_atual && idn.ip_anterior !== idn.ip_atual) {
        bruto.identidade_status = 'ip_alterado';
      } else if (idn.vezes_visto <= 1) {
        bruto.identidade_status = 'novo';
      } else {
        bruto.identidade_status = 'conhecido';
      }
      if (bruto.identidade) bruto.identidade.status = bruto.identidade_status;
    }

    const status_central = resolverStatusCentral(bruto);
    const health = calcularHealthScore({ ...bruto, status_central });

    return {
      ...bruto,
      status_central,
      status_rotulo: STATUS_ROTULO[status_central] || status_central,
      health_score: health.score,
      health_rotulo: health.rotulo,
      health_fatores: health.fatores
    };
  }

  _filtrar(itens, filtros = {}) {
    let lista = [...itens];

    if (filtros.transporte) {
      const t = normalizarTexto(filtros.transporte);
      if (t && t !== 'todos') {
        lista = lista.filter((i) => normalizarTexto(i.transporte) === t);
      }
    }
    if (filtros.fabricante) {
      const f = normalizarTexto(filtros.fabricante);
      lista = lista.filter((i) => normalizarTexto(i.fabricante).includes(f));
    }
    if (filtros.driver || filtros.driver_codigo) {
      const d = normalizarTexto(filtros.driver || filtros.driver_codigo);
      lista = lista.filter((i) => normalizarTexto(i.driver_codigo).includes(d));
    }
    if (filtros.status) {
      const s = String(filtros.status).toUpperCase();
      lista = lista.filter((i) => i.status_central === s);
    }
    if (filtros.online === '1' || filtros.online === true) {
      lista = lista.filter((i) => i.status_central === STATUS.ONLINE);
    }
    if (filtros.offline === '1' || filtros.offline === true) {
      lista = lista.filter((i) => i.status_central === STATUS.OFFLINE);
    }
    if (filtros.conhecidos === '1' || filtros.conhecidos === true) {
      lista = lista.filter((i) => i.identidade_status === 'conhecido' || i.status_central === STATUS.ONLINE);
    }
    if (filtros.novos === '1' || filtros.novos === true) {
      lista = lista.filter((i) => i.identidade_status === 'novo' || i.status_central === STATUS.NUNCA_VISTO);
    }
    if (filtros.busca) {
      const q = normalizarTexto(filtros.busca);
      lista = lista.filter((i) =>
        normalizarTexto(i.nome).includes(q)
        || normalizarTexto(i.modelo).includes(q)
        || normalizarTexto(i.ultimo_ip).includes(q)
        || normalizarTexto(i.driver_codigo).includes(q)
      );
    }

    lista.sort((a, b) => Number(b.health_score || 0) - Number(a.health_score || 0));
    return lista;
  }

  /**
   * Histórico unificado (identidade + logs do equipamento).
   */
  async obterHistorico({ equipamento_id, identidade_id, limite = 50 } = {}) {
    const eventos = [];

    if (identidade_id) {
      const det = await identidadeService.buscarPorId(identidade_id);
      if (det?.historico) {
        for (const h of det.historico) {
          eventos.push({
            tipo: 'identidade',
            evento: h.evento,
            de_valor: h.de_valor,
            para_valor: h.para_valor,
            score: h.score,
            sessao_id: h.sessao_id,
            em: h.created_at,
            rotulo: this._rotuloEventoIdentidade(h)
          });
        }
      }
      if (det?.sessoes) {
        for (const s of det.sessoes) {
          eventos.push({
            tipo: 'descoberta',
            evento: 'SESSAO_DISCOVERY',
            de_valor: null,
            para_valor: String(s.sessao_id || ''),
            score: s.score,
            sessao_id: s.sessao_id,
            em: s.created_at,
            rotulo: `Descoberta vinculada (sessão #${s.sessao_id})`
          });
        }
      }
    }

    if (equipamento_id) {
      try {
        const logs = await equipamentosService.listarLogs(equipamento_id, limite);
        for (const log of logs || []) {
          eventos.push({
            tipo: 'equipamento',
            evento: log.operacao || log.nivel || 'LOG',
            de_valor: null,
            para_valor: log.mensagem || null,
            score: null,
            sessao_id: null,
            em: log.created_at,
            rotulo: log.mensagem || log.operacao || 'Evento do equipamento'
          });
        }
      } catch (_) { /* ignore */ }
    }

    eventos.sort((a, b) => new Date(b.em || 0) - new Date(a.em || 0));
    return eventos.slice(0, Math.max(1, Math.min(200, Number(limite) || 50)));
  }

  _rotuloEventoIdentidade(h) {
    switch (h.evento) {
      case 'IP_ALTERADO':
        return `Mudança de IP: ${h.de_valor || '?'} → ${h.para_valor || '?'}`;
      case 'FIRMWARE_ALTERADO':
        return `Mudança de firmware: ${h.de_valor || '?'} → ${h.para_valor || '?'}`;
      case 'CRIADO':
        return 'Identidade criada';
      case 'VISTO':
        return 'Nova descoberta / visto novamente';
      default:
        return h.evento || 'Evento';
    }
  }

  async obterSaude({ equipamento_id, identidade_id } = {}) {
    const itens = await this.listarItens({});
    const item = itens.find((i) =>
      (equipamento_id && Number(i.equipamento_id) === Number(equipamento_id))
      || (identidade_id && Number(i.identidade_id) === Number(identidade_id))
    );
    if (!item) {
      return {
        score: 0,
        rotulo: 'Equipamento indisponível.',
        status_central: STATUS.NUNCA_VISTO,
        fatores: ['nao_encontrado']
      };
    }
    return {
      score: item.health_score,
      rotulo: item.health_rotulo,
      status_central: item.status_central,
      status_rotulo: item.status_rotulo,
      fatores: item.health_fatores,
      item
    };
  }

  async listarSessoesDiscovery(limite = 20) {
    return discoverySessions.listarSessoes(limite);
  }

  /** Ações — delegação sem alterar serviços oficiais */
  async testarConexao(equipamentoId) {
    return equipamentosService.testarConexao(equipamentoId);
  }

  async diagnosticar(equipamentoId) {
    console.log('[DIAG RC14.14.5] Diagnóstico iniciado', { equipamentoId });

    const equipamentosRepository = require('../repositories/EquipamentosRepository');
    const { diagnostics, resolverAlvoDiagnostico } = require('../drivers/toledo/certificacao/ToledoDiagnostics');

    const equipamento = await equipamentosRepository.buscarPorId(equipamentoId);
    if (!equipamento) {
      const err = new Error('Equipamento não encontrado');
      err.statusCode = 404;
      throw err;
    }

    // Enriquecer com identidade (ip_atual) quando cadastro.ip estiver vazio/desatualizado
    let identidade = null;
    try {
      const identidadeService = require('../identidade/IdentidadeService');
      const lista = await identidadeService.listar(200);
      identidade = (lista || []).find((idn) =>
        (equipamento.ip && idn.ip_atual && String(idn.ip_atual) === String(equipamento.ip))
        || (idn.driver_codigo && equipamento.driver_codigo
          && String(idn.driver_codigo) === String(equipamento.driver_codigo)
          && idn.ip_atual)
      ) || null;
    } catch (_) { /* identidade opcional */ }

    const eqCtx = {
      ...equipamento,
      ultimo_ip: identidade?.ip_atual || equipamento.ip || null,
      identidade: identidade
        ? { ip_atual: identidade.ip_atual, porta_atual: identidade.porta_atual }
        : null
    };

    const alvo = resolverAlvoDiagnostico({
      equipamento: eqCtx,
      identidade,
      host: equipamento.ip || identidade?.ip_atual || null,
      porta: equipamento.porta_tcp != null
        ? Number(equipamento.porta_tcp)
        : (identidade?.porta_atual != null ? Number(identidade.porta_atual) : 9000)
    });

    const driverCodigo = equipamento.driver_codigo || equipamento.fabricante || null;
    console.log('[DIAG RC14.14.5] Alvo resolvido', {
      driverCodigo,
      host: alvo.host,
      porta: alvo.porta,
      ipCadastro: equipamento.ip,
      ipIdentidade: identidade?.ip_atual || null
    });

    // Pipeline oficial: probe ativo (connect → handshake → health → read)
    const resultado = await diagnostics({
      host: alvo.host || undefined,
      porta: alvo.host ? alvo.porta : undefined,
      equipamento: eqCtx,
      identidade,
      probe: true
    });
    console.log('[DIAG RC14.14.5] Diagnóstico executado', {
      status: resultado?.health?.status,
      online: resultado?.health?.online,
      etapaFalha: resultado?.etapas_conexao?.etapaFalha,
      tcp: resultado?.probe?.tcp?.codigo || resultado?.probe?.tcp,
      handshake: resultado?.probe?.handshake?.codigo || resultado?.probe?.handshake,
      ip: resultado?.equipamento?.ip,
      hasTrace: Boolean(resultado?.connection_trace)
    });

    try {
      await equipamentosRepository.atualizarUltimoDiagnostico(equipamentoId);
    } catch (_) { /* não bloqueia painel */ }

    console.log('[DIAG RC14.14.5] Diagnóstico finalizado');
    return {
      ...resultado,
      equipamento_id: Number(equipamentoId),
      pipeline: 'toledo-diagnostics-v2'
    };
  }

  async cadastrar(dados) {
    return equipamentosService.criar(dados);
  }
}

const centralEquipamentosService = new CentralEquipamentosService();

module.exports = centralEquipamentosService;
module.exports.CentralEquipamentosService = CentralEquipamentosService;
module.exports.STATUS = STATUS;
module.exports.STATUS_ROTULO = STATUS_ROTULO;
