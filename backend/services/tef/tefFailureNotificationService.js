const db = require('../../database');

/**
 * Serviço de notificação de falhas TEF
 * Envia alertas automáticos para falhas críticas
 */
class TefFailureNotificationService {
  
  constructor() {
    this.notificacoesAtivas = process.env.TEF_FAILURE_NOTIFICATIONS !== 'false';
    this.canaisNotificacao = {
      email: process.env.TEF_NOTIFY_EMAIL === 'true',
      log: true,
      dashboard: true
    };
    
    // Limites de notificação para evitar spam
    this.limites = {
      maxNotificacoesPorHora: 10,
      maxNotificacoesPorDia: 50
    };
  }
  
  /**
   * Notifica uma falha TEF
   * @param {Object} dados - Dados da falha
   * @returns {Promise} Resultado da notificação
   */
  async notificarFalha(dados) {
    if (!this.notificacoesAtivas) {
      return { notificacao_desativada: true };
    }
    
    // Verificar limites de notificação
    const dentroDosLimites = await this._verificarLimitesNotificacao();
    if (!dentroDosLimites) {
      return { limite_excedido: true };
    }
    
    const resultado = {
      canais_enviados: [],
      erros: []
    };
    
    try {
      // Registrar notificação no banco
      await this._registrarNotificacao(dados);
      
      // Enviar para cada canal configurado
      if (this.canaisNotificacao.log) {
        await this._notificarLog(dados);
        resultado.canais_enviados.push('log');
      }
      
      if (this.canaisNotificacao.dashboard) {
        await this._notificarDashboard(dados);
        resultado.canais_enviados.push('dashboard');
      }
      
      if (this.canaisNotificacao.email) {
        await this._notificarEmail(dados);
        resultado.canais_enviados.push('email');
      }
      
      return resultado;
    } catch (error) {
      console.error('Erro ao notificar falha TEF:', error);
      resultado.erros.push(error.message);
      return resultado;
    }
  }
  
  /**
   * Verifica se está dentro dos limites de notificação
   */
  async _verificarLimitesNotificacao() {
    const agora = new Date();
    const umaHoraAtras = new Date(agora.getTime() - 3600000);
    const umDiaAtras = new Date(agora.getTime() - 86400000);
    
    const [notificacoesHora, notificacoesDia] = await Promise.all([
      this._contarNotificacoesPeriodo(umaHoraAtras),
      this._contarNotificacoesPeriodo(umDiaAtras)
    ]);
    
    return notificacoesHora < this.limites.maxNotificacoesPorHora && 
           notificacoesDia < this.limites.maxNotificacoesPorDia;
  }
  
  /**
   * Conta notificações no período
   */
  async _contarNotificacoesPeriodo(dataInicio) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT COUNT(*) as count
        FROM tef_notificacoes_falha
        WHERE criado_em >= ?
      `, [dataInicio.toISOString()], (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.count : 0);
      });
    });
  }
  
  /**
   * Registra uma notificação no banco
   */
  async _registrarNotificacao(dados) {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO tef_notificacoes_falha (
          tipo_erro,
          codigo_erro,
          mensagem,
          severidade,
          dados_falha,
          criado_em
        ) VALUES (?, ?, ?, ?, ?, datetime('now'))
      `, [
        dados.tipo_erro || 'desconhecido',
        dados.codigo_erro || null,
        dados.mensagem || '',
        dados.severidade || 'media',
        JSON.stringify(dados)
      ], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  
  /**
   * Notifica via log
   */
  async _notificarLog(dados) {
    const nivel = dados.severidade === 'critica' ? 'error' : 'warn';
    console[nivel](`[TEF FALHA] ${dados.tipo_erro}: ${dados.mensagem}`, dados);
  }
  
  /**
   * Notifica via dashboard (sistema de alertas)
   */
  async _notificarDashboard(dados) {
    // Em produção, isso enviaria para um sistema de alertas (Sentry, Grafana, etc.)
    // Por enquanto, apenas log
    console.log(`[DASHBOARD ALERT] TEF Falha: ${dados.tipo_erro}`, dados);
  }
  
  /**
   * Notifica via email
   */
  async _notificarEmail(dados) {
    // Em produção, isso enviaria email real
    // Por enquanto, apenas log
    console.log(`[EMAIL ALERT] TEF Falha: ${dados.tipo_erro}`, dados);
  }
  
  /**
   * Notifica falha de circuit breaker
   */
  async notificarFalhaCircuitBreaker(nomeServico, circuitBreaker, erro) {
    return await this.notificarFalha({
      tipo_erro: 'circuit_breaker',
      codigo_erro: 'CIRCUIT_BREAKER_ABERTO',
      mensagem: `Circuit breaker aberto para ${nomeServico}`,
      severidade: 'critica',
      dados: {
        nome_servico: nomeServico,
        falhas_consecutivas: circuitBreaker.falhasConsecutivas,
        erro: erro.message
      }
    });
  }
  
  /**
   * Notifica falha de timeout
   */
  async notificarFalhaTimeout(dados) {
    return await this.notificarFalha({
      tipo_erro: 'timeout',
      codigo_erro: 'TIMEOUT',
      mensagem: dados.mensagem || 'Timeout na operação TEF',
      severidade: 'alta',
      dados
    });
  }
  
  /**
   * Notifica falha de fraude
   */
  async notificarFalhaFraude(dados) {
    return await this.notificarFalha({
      tipo_erro: 'fraude',
      codigo_erro: 'TRANSACAO_SUSPEITA',
      mensagem: 'Transação suspeita detectada',
      severidade: dados.nivel_risco === 'alto' ? 'critica' : 'alta',
      dados
    });
  }
  
  /**
   * Notifica falha genérica
   */
  async notificarFalhaGenerica(erro, contexto = {}) {
    return await this.notificarFalha({
      tipo_erro: 'generico',
      codigo_erro: erro.code || 'ERRO_GENERICO',
      mensagem: erro.message,
      severidade: 'media',
      dados: {
        erro: erro.message,
        stack: erro.stack,
        contexto
      }
    });
  }
  
  /**
   * Configura os canais de notificação
   */
  configurarCanais(canais) {
    this.canaisNotificacao = {
      ...this.canaisNotificacao,
      ...canais
    };
  }
  
  /**
   * Configura os limites de notificação
   */
  configurarLimites(limites) {
    this.limites = {
      ...this.limites,
      ...limites
    };
  }
  
  /**
   * Obtém estatísticas de notificações
   */
  async obterEstatisticas() {
    const agora = new Date();
    const umaHoraAtras = new Date(agora.getTime() - 3600000);
    const umDiaAtras = new Date(agora.getTime() - 86400000);
    
    const [total, ultimaHora, ultimoDia] = await Promise.all([
      this._contarNotificacoesPeriodo(new Date(0)),
      this._contarNotificacoesPeriodo(umaHoraAtras),
      this._contarNotificacoesPeriodo(umDiaAtras)
    ]);
    
    return {
      total,
      ultima_hora: ultimaHora,
      ultimo_dia: ultimoDia,
      canais_ativos: this.canaisNotificacao,
      limites: this.limites
    };
  }
}

module.exports = new TefFailureNotificationService();
