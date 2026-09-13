const db = require('../../database');

/**
 * Serviço de retenção de logs TEF
 * Gerencia política de retenção e limpeza automática de logs antigos
 */
class TefLogRetentionService {
  
  constructor() {
    // Configurações de retenção (configurável via variável de ambiente)
    this.retencaoLogs = Number(process.env.TEF_LOG_RETENTION_DAYS) || 90; // 90 dias padrão
    this.retencaoAuditoria = Number(process.env.TEF_AUDIT_RETENTION_DAYS) || 365; // 1 ano padrão
    this.retencaoAlertas = Number(process.env.TEF_ALERT_RETENTION_DAYS) || 180; // 6 meses padrão
    this.limpezaAutomatica = process.env.TEF_AUTO_CLEANUP !== 'false'; // Ativado por padrão
  }
  
  /**
   * Limpa logs antigos com base na política de retenção
   * @returns {Object} Resultado da limpeza
   */
  async limparLogsAntigos() {
    if (!this.limpezaAutomatica) {
      return { limpeza_desativada: true };
    }
    
    const resultado = {
      logs_removidos: 0,
      auditoria_removida: 0,
      alertas_removidos: 0,
      erros: []
    };
    
    try {
      // Limpar logs de transações
      const logsRemovidos = await this._limparLogsTransacoes();
      resultado.logs_removidos = logsRemovidos;
      
      // Limpar logs de auditoria
      const auditoriaRemovida = await this._limparLogsAuditoria();
      resultado.auditoria_removida = auditoriaRemovida;
      
      // Limpar alertas de fraude
      const alertasRemovidos = await this._limparAlertasFraude();
      resultado.alertas_removidos = alertasRemovidos;
      
      console.log('Limpeza de logs TEF concluída:', resultado);
      return resultado;
    } catch (error) {
      console.error('Erro na limpeza de logs TEF:', error);
      resultado.erros.push(error.message);
      return resultado;
    }
  }
  
  /**
   * Limpa logs de transações antigos
   */
  async _limparLogsTransacoes() {
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - this.retencaoLogs);
    
    return new Promise((resolve, reject) => {
      db.run(`
        DELETE FROM tef_logs
        WHERE criado_em < ?
      `, [dataLimite.toISOString()], function(err) {
        if (err) return reject(err);
        resolve(this.changes || 0);
      });
    });
  }
  
  /**
   * Limpa logs de auditoria antigos
   */
  async _limparLogsAuditoria() {
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - this.retencaoAuditoria);
    
    return new Promise((resolve, reject) => {
      db.run(`
        DELETE FROM tef_auditoria_acesso
        WHERE criado_em < ?
      `, [dataLimite.toISOString()], function(err) {
        if (err) return reject(err);
        resolve(this.changes || 0);
      });
    });
  }
  
  /**
   * Limpa alertas de fraude antigos
   */
  async _limparAlertasFraude() {
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - this.retencaoAlertas);
    
    return new Promise((resolve, reject) => {
      db.run(`
        DELETE FROM tef_alertas_fraude
        WHERE criado_em < ?
      `, [dataLimite.toISOString()], function(err) {
        if (err) return reject(err);
        resolve(this.changes || 0);
      });
    });
  }
  
  /**
   * Obtém estatísticas de retenção de logs
   * @returns {Object} Estatísticas
   */
  async obterEstatisticas() {
    try {
      const [totalLogs, totalAuditoria, totalAlertas, espacoLogs] = await Promise.all([
        this._contarLogs(),
        this._contarAuditoria(),
        this._contarAlertas(),
        this._obterEspacoLogs()
      ]);
      
      return {
        logs: {
          total: totalLogs,
          retencao_dias: this.retencaoLogs
        },
        auditoria: {
          total: totalAuditoria,
          retencao_dias: this.retencaoAuditoria
        },
        alertas: {
          total: totalAlertas,
          retencao_dias: this.retencaoAlertas
        },
        espaco_logs: espacoLogs,
        limpeza_automatica: this.limpezaAutomatica
      };
    } catch (error) {
      console.error('Erro ao obter estatísticas de retenção:', error);
      throw error;
    }
  }
  
  /**
   * Conta total de logs
   */
  async _contarLogs() {
    return new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM tef_logs', (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.count : 0);
      });
    });
  }
  
  /**
   * Conta total de registros de auditoria
   */
  async _contarAuditoria() {
    return new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM tef_auditoria_acesso', (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.count : 0);
      });
    });
  }
  
  /**
   * Conta total de alertas
   */
  async _contarAlertas() {
    return new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM tef_alertas_fraude', (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.count : 0);
      });
    });
  }
  
  /**
   * Obtém espaço ocupado pelos logs (estimativa)
   */
  async _obterEspacoLogs() {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT 
          (SELECT LENGTH(payload) FROM tef_logs LIMIT 1) as tamanho_medio
      `, (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.tamanho_medio || 0 : 0);
      });
    });
  }
  
  /**
   * Configura os parâmetros de retenção
   */
  configurarRetencao(parametros) {
    if (parametros.retencaoLogs) {
      this.retencaoLogs = parametros.retencaoLogs;
    }
    if (parametros.retencaoAuditoria) {
      this.retencaoAuditoria = parametros.retencaoAuditoria;
    }
    if (parametros.retencaoAlertas) {
      this.retencaoAlertas = parametros.retencaoAlertas;
    }
    if (parametros.limpezaAutomatica !== undefined) {
      this.limpezaAutomatica = parametros.limpezaAutomatica;
    }
  }
  
  /**
   * Obtém as configurações atuais
   */
  obterConfiguracoes() {
    return {
      retencaoLogs: this.retencaoLogs,
      retencaoAuditoria: this.retencaoAuditoria,
      retencaoAlertas: this.retencaoAlertas,
      limpezaAutomatica: this.limpezaAutomatica
    };
  }
  
  /**
   * Inicia limpeza automática periódica
   * Deve ser chamado na inicialização do servidor
   */
  iniciarLimpezaAutomatica(intervaloHoras = 24) {
    if (!this.limpezaAutomatica) {
      console.log('Limpeza automática de logs TEF desativada');
      return;
    }
    
    const intervaloMs = intervaloHoras * 60 * 60 * 1000;
    
    console.log(`Limpeza automática de logs TEF iniciada (intervalo: ${intervaloHoras}h)`);
    
    setInterval(async () => {
      try {
        await this.limparLogsAntigos();
      } catch (error) {
        console.error('Erro na limpeza automática de logs:', error);
      }
    }, intervaloMs);
  }
}

module.exports = new TefLogRetentionService();
