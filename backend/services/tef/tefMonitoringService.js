const db = require('../../database');
const tefEvents = require('./tefEvents');

/**
 * Serviço de monitoramento em tempo real de transações TEF
 * Monitora métricas, performance e anomalias em tempo real
 */
class TefMonitoringService {
  
  constructor() {
    this.monitoramentoAtivo = process.env.TEF_MONITORING_ACTIVE !== 'false';
    this.metricas = {
      transacoes_total: 0,
      transacoes_aprovadas: 0,
      transacoes_negadas: 0,
      transacoes_erro: 0,
      valor_total: 0,
      tempo_medio_resposta: 0,
      ultima_atualizacao: null
    };
    
    this.alertas = [];
    this.limiteAlertas = 100; // Limite de alertas na memória
  }
  
  /**
   * Inicia monitoramento em tempo real
   */
  iniciarMonitoramento() {
    if (!this.monitoramentoAtivo) {
      console.log('Monitoramento TEF desativado');
      return;
    }
    
    console.log('Monitoramento TEF iniciado');
    
    // Registrar eventos
    tefEvents.on('estado', (estado) => this._registrarEstado(estado));
    tefEvents.on('transacao', (dados) => this._registrarTransacao(dados));
    tefEvents.on('erro', (erro) => this._registrarErro(erro));
    
    // Atualizar métricas periodicamente
    setInterval(() => this._atualizarMetricas(), 60000); // A cada minuto
    
    // Verificar anomalias periodicamente
    setInterval(() => this._verificarAnomalias(), 300000); // A cada 5 minutos
  }
  
  /**
   * Registra mudança de estado
   */
  _registrarEstado(estado) {
    console.log(`[TEF MONITORING] Estado: ${estado}`);
  }
  
  /**
   * Registra transação
   */
  _registrarTransacao(dados) {
    this.metricas.transacoes_total++;
    this.metricas.valor_total += Number(dados.valor) || 0;
    
    if (dados.status === 'aprovado') {
      this.metricas.transacoes_aprovadas++;
    } else if (dados.status === 'negado') {
      this.metricas.transacoes_negadas++;
    } else {
      this.metricas.transacoes_erro++;
    }
    
    this.metricas.ultima_atualizacao = new Date().toISOString();
  }
  
  /**
   * Registra erro
   */
  _registrarErro(erro) {
    console.error(`[TEF MONITORING] Erro: ${erro.message}`);
    
    this._adicionarAlerta({
      tipo: 'erro',
      mensagem: erro.message,
      severidade: 'alta',
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * Atualiza métricas do banco de dados
   */
  async _atualizarMetricas() {
    try {
      const metricasBanco = await this._obterMetricasBanco();
      
      this.metricas = {
        ...this.metricas,
        ...metricasBanco,
        ultima_atualizacao: new Date().toISOString()
      };
      
      // Persistir métricas
      await this._persistirMetricas();
    } catch (error) {
      console.error('Erro ao atualizar métricas:', error);
    }
  }
  
  /**
   * Obtém métricas do banco de dados
   */
  async _obterMetricasBanco() {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT 
          COUNT(*) as transacoes_total,
          SUM(CASE WHEN status = 'aprovado' THEN 1 ELSE 0 END) as transacoes_aprovadas,
          SUM(CASE WHEN status = 'negado' THEN 1 ELSE 0 END) as transacoes_negadas,
          SUM(CASE WHEN status = 'erro' THEN 1 ELSE 0 END) as transacoes_erro,
          SUM(valor) as valor_total
        FROM tef_transacoes
        WHERE date(criado_em) = date('now')
      `, (err, row) => {
        if (err) return reject(err);
        resolve(row || {
          transacoes_total: 0,
          transacoes_aprovadas: 0,
          transacoes_negadas: 0,
          transacoes_erro: 0,
          valor_total: 0
        });
      });
    });
  }
  
  /**
   * Persiste métricas no banco
   */
  async _persistirMetricas() {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO tef_metricas (
          transacoes_total,
          transacoes_aprovadas,
          transacoes_negadas,
          transacoes_erro,
          valor_total,
          tempo_medio_resposta,
          criado_em
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `, [
        this.metricas.transacoes_total,
        this.metricas.transacoes_aprovadas,
        this.metricas.transacoes_negadas,
        this.metricas.transacoes_erro,
        this.metricas.valor_total,
        this.metricas.tempo_medio_resposta
      ], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  
  /**
   * Verifica anomalias nas métricas
   */
  async _verificarAnomalias() {
    try {
      // Taxa de aprovação baixa
      const taxaAprovacao = this.metricas.transacoes_total > 0 
        ? (this.metricas.transacoes_aprovadas / this.metricas.transacoes_total) * 100 
        : 100;
      
      if (taxaAprovacao < 80 && this.metricas.transacoes_total > 10) {
        this._adicionarAlerta({
          tipo: 'taxa_aprovacao_baixa',
          mensagem: `Taxa de aprovação baixa: ${taxaAprovacao.toFixed(2)}%`,
          severidade: 'alta',
          timestamp: new Date().toISOString()
        });
      }
      
      // Taxa de erro alta
      const taxaErro = this.metricas.transacoes_total > 0 
        ? (this.metricas.transacoes_erro / this.metricas.transacoes_total) * 100 
        : 0;
      
      if (taxaErro > 10 && this.metricas.transacoes_total > 10) {
        this._adicionarAlerta({
          tipo: 'taxa_erro_alta',
          mensagem: `Taxa de erro alta: ${taxaErro.toFixed(2)}%`,
          severidade: 'critica',
          timestamp: new Date().toISOString()
        });
      }
      
      // Valor médio suspeito
      const valorMedio = this.metricas.transacoes_total > 0 
        ? this.metricas.valor_total / this.metricas.transacoes_total 
        : 0;
      
      if (valorMedio > 1000) {
        this._adicionarAlerta({
          tipo: 'valor_medio_alto',
          mensagem: `Valor médio de transação alto: R$ ${valorMedio.toFixed(2)}`,
          severidade: 'media',
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Erro ao verificar anomalias:', error);
    }
  }
  
  /**
   * Adiciona alerta
   */
  _adicionarAlerta(alerta) {
    this.alertas.push(alerta);
    
    // Manter apenas últimos N alertas
    if (this.alertas.length > this.limiteAlertas) {
      this.alertas.shift();
    }
    
    // Persistir alerta no banco
    this._persistirAlerta(alerta);
    
    console.log(`[TEF MONITORING] Alerta: ${alerta.tipo} - ${alerta.mensagem}`);
  }
  
  /**
   * Persiste alerta no banco
   */
  async _persistirAlerta(alerta) {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO tef_alertas_monitoramento (
          tipo,
          mensagem,
          severidade,
          dados,
          criado_em
        ) VALUES (?, ?, ?, ?, datetime('now'))
      `, [
        alerta.tipo,
        alerta.mensagem,
        alerta.severidade,
        JSON.stringify(alerta)
      ], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  
  /**
   * Obtém métricas atuais
   */
  obterMetricas() {
    return {
      ...this.metricas,
      taxa_aprovacao: this.metricas.transacoes_total > 0 
        ? ((this.metricas.transacoes_aprovadas / this.metricas.transacoes_total) * 100).toFixed(2) + '%'
        : '0%',
      taxa_erro: this.metricas.transacoes_total > 0 
        ? ((this.metricas.transacoes_erro / this.metricas.transacoes_total) * 100).toFixed(2) + '%'
        : '0%',
      valor_medio: this.metricas.transacoes_total > 0 
        ? (this.metricas.valor_total / this.metricas.transacoes_total).toFixed(2)
        : '0.00'
    };
  }
  
  /**
   * Obtém alertas recentes
   */
  obterAlertas(quantidade = 10) {
    return this.alertas.slice(-quantidade);
  }
  
  /**
   * Obtém histórico de métricas
   */
  async obterHistoricoMetricas(horas = 24) {
    const dataLimite = new Date();
    dataLimite.setHours(dataLimite.getHours() - horas);
    
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT id,
               transacoes_total,
               transacoes_aprovadas,
               transacoes_negadas,
               transacoes_erro,
               valor_total,
               tempo_medio_resposta,
               criado_em
        FROM tef_metricas
        WHERE criado_em >= ?
        ORDER BY criado_em DESC
      `, [dataLimite.toISOString()], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }
  
  /**
   * Obtém histórico de alertas
   */
  async obterHistoricoAlertas(horas = 24) {
    const dataLimite = new Date();
    dataLimite.setHours(dataLimite.getHours() - horas);
    
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT id,
               tipo,
               mensagem,
               severidade,
               dados,
               criado_em
        FROM tef_alertas_monitoramento
        WHERE criado_em >= ?
        ORDER BY criado_em DESC
      `, [dataLimite.toISOString()], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }
}

module.exports = new TefMonitoringService();
