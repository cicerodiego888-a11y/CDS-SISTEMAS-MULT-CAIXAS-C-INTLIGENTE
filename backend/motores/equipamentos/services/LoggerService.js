/**
 * LoggerService — Logging estruturado do Motor de Equipamentos
 *
 * Responsabilidade:
 * - Padronizar formato de log
 * - Persistir em equipamentos_logs
 * - Encaminhar para console em desenvolvimento
 */

const equipamentosRepository = require('../repositories/EquipamentosRepository');

const NIVEIS = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error'
};

const NIVEL_MINIMO = String(process.env.EQUIPAMENTOS_LOG_LEVEL || 'info').toLowerCase();

const ORDEM_NIVEL = { debug: 0, info: 1, warn: 2, error: 3 };

class LoggerService {
  _deveRegistrar(nivel) {
    const atual = ORDEM_NIVEL[nivel] ?? 1;
    const minimo = ORDEM_NIVEL[NIVEL_MINIMO] ?? 1;
    return atual >= minimo;
  }

  async _registrar(nivel, mensagem, contexto = {}) {
    if (!this._deveRegistrar(nivel)) return;

    const payload = {
      timestamp: new Date().toISOString(),
      nivel,
      mensagem,
      ...contexto
    };

    const metodoConsole = nivel === 'error' ? 'error' : nivel === 'warn' ? 'warn' : 'log';
    console[metodoConsole](`[Equipamentos][${nivel.toUpperCase()}] ${mensagem}`, contexto.operacao ? `(${contexto.operacao})` : '');

    try {
      await equipamentosRepository.gravarLog({
        equipamento_id: contexto.equipamento_id || contexto.equipamentoId || null,
        nivel,
        operacao: contexto.operacao || null,
        mensagem,
        contexto: payload
      });
    } catch (err) {
      console.error('[Equipamentos] Falha ao persistir log:', err.message);
    }
  }

  debug(mensagem, contexto = {}) {
    return this._registrar(NIVEIS.DEBUG, mensagem, contexto);
  }

  info(mensagem, contexto = {}) {
    return this._registrar(NIVEIS.INFO, mensagem, contexto);
  }

  warn(mensagem, contexto = {}) {
    return this._registrar(NIVEIS.WARN, mensagem, contexto);
  }

  error(mensagem, contexto = {}) {
    return this._registrar(NIVEIS.ERROR, mensagem, contexto);
  }

  logOperacao(equipamentoId, operacao, dados = {}) {
    return this.info(`Operação: ${operacao}`, {
      equipamento_id: equipamentoId,
      operacao,
      ...dados
    });
  }

  /**
   * Registra uma solicitação de sincronização de forma estruturada.
   * Captura quem solicitou, equipamento, tipo, horário, prioridade e status.
   * @param {Object} dados
   * @returns {Promise<void>}
   */
  logSincronizacao(dados = {}) {
    const nivel = dados.status === 'erro' ? NIVEIS.ERROR
      : dados.status === 'cancelado' ? NIVEIS.WARN
      : NIVEIS.INFO;

    return this._registrar(nivel, `Sync ${dados.tipo || ''} — ${dados.status || 'iniciado'}`, {
      operacao: 'sincronizacao',
      equipamento_id: dados.equipamentoId ?? dados.equipamento_id ?? null,
      solicitante: dados.solicitante ?? 'sistema',
      tipo: dados.tipo ?? null,
      prioridade: dados.prioridade ?? null,
      status: dados.status ?? null,
      horario: new Date().toISOString(),
      detalhe: dados.detalhe ?? null
    });
  }

  /**
   * Registra operações da camada de transporte (conexão, envio, recebimento, etc.).
   * @param {Object} dados
   * @returns {Promise<void>}
   */
  logTransporte(dados = {}) {
    const nivel = dados.status === 'erro' || dados.status === 'limite_excedido'
      ? NIVEIS.ERROR
      : dados.status === 'desconectado' || dados.status === 'desconectando'
      ? NIVEIS.WARN
      : NIVEIS.INFO;

    return this._registrar(nivel, `Transporte ${dados.transporte || ''} — ${dados.operacao || ''}`, {
      operacao: `transporte.${dados.operacao || 'operacao'}`,
      equipamento_id: dados.equipamento_id ?? dados.equipamentoId ?? null,
      transporte: dados.transporte ?? null,
      status: dados.status ?? null,
      horario: new Date().toISOString(),
      detalhe: dados.detalhe ?? dados
    });
  }
}

const loggerService = new LoggerService();

module.exports = loggerService;
module.exports.NIVEIS = NIVEIS;
