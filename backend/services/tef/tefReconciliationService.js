const db = require('../../database');
const cryptoService = require('../crypto/cryptoService');

/**
 * Serviço de conciliação automática diária de transações TEF
 * Compara transações TEF com vendas e NFC-e para identificar divergências
 */
class TefReconciliationService {
  
  constructor() {
    this.conciliacaoAtiva = process.env.TEF_RECONCILIATION_ACTIVE !== 'false';
    this.horarioConciliacao = process.env.TEF_RECONCILIATION_TIME || '02:00';
  }
  
  /**
   * Executa conciliação diária de transações TEF
   * @returns {Promise<Object>} Resultado da conciliação
   */
  async executarConciliacaoDiaria() {
    if (!this.conciliacaoAtiva) {
      return { conciliacao_desativada: true };
    }
    
    const resultado = {
      data_inicio: new Date().toISOString(),
      data_conciliacao: new Date().toISOString().split('T')[0],
      transacoes_tef: 0,
      vendas_vinculadas: 0,
      vendas_nao_vinculadas: 0,
      transacoes_nao_vinculadas: 0,
      divergencias: [],
      total_valor_tef: 0,
      total_valor_vendas: 0,
      divergencia_valor: 0
    };
    
    try {
      // Obter transações TEF do dia
      const transacoesTEF = await this._obterTransacoesTEFDia(resultado.data_conciliacao);
      resultado.transacoes_tef = transacoesTEF.length;
      
      // Obter vendas do dia com pagamento TEF
      const vendasTEF = await this._obterVendasTEFDia(resultado.data_conciliacao);
      resultado.vendas_vinculadas = vendasTEF.length;
      
      // Calcular totais
      resultado.total_valor_tef = transacoesTEF.reduce((sum, t) => sum + Number(t.valor), 0);
      resultado.total_valor_vendas = vendasTEF.reduce((sum, v) => sum + Number(v.valor), 0);
      resultado.divergencia_valor = resultado.total_valor_tef - resultado.total_valor_vendas;
      
      // Identificar transações não vinculadas
      resultado.transacoes_nao_vinculadas = transacoesTEF.filter(t => !t.venda_id).length;
      resultado.vendas_nao_vinculadas = vendasTEF.filter(v => !v.tef_transacao_id).length;
      
      // Identificar divergências
      resultado.divergencias = await this._identificarDivergencias(transacoesTEF, vendasTEF);
      
      // Registrar resultado da conciliação
      await this._registrarConciliacao(resultado);
      
      // Gerar alertas se houver divergências
      if (resultado.divergencias.length > 0) {
        await this._gerarAlertasDivergencias(resultado);
      }
      
      resultado.data_fim = new Date().toISOString();
      resultado.sucesso = true;
      
      return resultado;
    } catch (error) {
      console.error('Erro na conciliação diária TEF:', error);
      resultado.erro = error.message;
      resultado.sucesso = false;
      resultado.data_fim = new Date().toISOString();
      return resultado;
    }
  }
  
  /**
   * Obtém transações TEF do dia
   */
  async _obterTransacoesTEFDia(data) {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT id,
               venda_id,
               tipo,
               valor,
               parcelas,
               status,
               provedor,
               bandeira,
               nsu,
               autorizacao,
               criado_em
        FROM tef_transacoes
        WHERE date(criado_em) = ?
        AND status = 'aprovado'
        ORDER BY criado_em
      `, [data], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }
  
  /**
   * Obtém vendas do dia com pagamento TEF
   */
  async _obterVendasTEFDia(data) {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT id,
               valor_total,
               forma_pagamento,
               tef_transacao_id,
               criado_em
        FROM vendas
        WHERE date(criado_em) = ?
        AND forma_pagamento LIKE '%cartao%'
        ORDER BY criado_em
      `, [data], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }
  
  /**
   * Identifica divergências entre transações TEF e vendas
   */
  async _identificarDivergencias(transacoesTEF, vendasTEF) {
    const divergencias = [];
    
    // Transações TEF sem venda vinculada
    for (const transacao of transacoesTEF) {
      if (!transacao.venda_id) {
        divergencias.push({
          tipo: 'transacao_sem_venda',
          transacao_id: transacao.id,
          valor: transacao.valor,
          nsu: transacao.nsu,
          mensagem: 'Transação TEF aprovada sem venda vinculada'
        });
      }
    }
    
    // Vendas com pagamento TEF sem transação vinculada
    for (const venda of vendasTEF) {
      if (!venda.tef_transacao_id) {
        divergencias.push({
          tipo: 'venda_sem_transacao',
          venda_id: venda.id,
          valor: venda.valor_total,
          mensagem: 'Venda com pagamento cartão sem transação TEF vinculada'
        });
      }
    }
    
    // Divergência de valores
    const valorTEF = transacoesTEF.reduce((sum, t) => sum + Number(t.valor), 0);
    const valorVendas = vendasTEF.reduce((sum, v) => sum + Number(v.valor_total), 0);
    
    if (Math.abs(valorTEF - valorVendas) > 0.01) {
      divergencias.push({
        tipo: 'divergencia_valor',
        valor_tef: valorTEF,
        valor_vendas: valorVendas,
        diferenca: valorTEF - valorVendas,
        mensagem: `Divergência de valor: TEF R$ ${valorTEF.toFixed(2)} vs Vendas R$ ${valorVendas.toFixed(2)}`
      });
    }
    
    return divergencias;
  }
  
  /**
   * Registra resultado da conciliação no banco
   */
  async _registrarConciliacao(resultado) {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO tef_conciliacao (
          data_conciliacao,
          transacoes_tef,
          vendas_vinculadas,
          vendas_nao_vinculadas,
          transacoes_nao_vinculadas,
          total_valor_tef,
          total_valor_vendas,
          divergencia_valor,
          divergencias,
          sucesso,
          criado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `, [
        resultado.data_conciliacao,
        resultado.transacoes_tef,
        resultado.vendas_vinculadas,
        resultado.vendas_nao_vinculadas,
        resultado.transacoes_nao_vinculadas,
        resultado.total_valor_tef,
        resultado.total_valor_vendas,
        resultado.divergencia_valor,
        JSON.stringify(resultado.divergencias),
        resultado.sucesso ? 1 : 0
      ], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  
  /**
   * Gera alertas para divergências encontradas
   */
  async _gerarAlertasDivergencias(resultado) {
    const tefFailureNotificationService = require('./tefFailureNotificationService');
    
    for (const divergencia of resultado.divergencias) {
      await tefFailureNotificationService.notificarFalha({
        tipo_erro: 'conciliacao',
        codigo_erro: 'DIVERGENCIA_CONCILIACAO',
        mensagem: divergencia.mensagem,
        severidade: 'alta',
        dados: divergencia
      });
    }
  }
  
  /**
   * Obtém histórico de conciliações
   */
  async obterHistoricoConciliacao(dias = 30) {
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - dias);
    
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT id,
               data_conciliacao,
               transacoes_tef,
               vendas_vinculadas,
               vendas_nao_vinculadas,
               transacoes_nao_vinculadas,
               total_valor_tef,
               total_valor_vendas,
               divergencia_valor,
               divergencias,
               sucesso,
               criado_em
        FROM tef_conciliacao
        WHERE criado_em >= ?
        ORDER BY data_conciliacao DESC
      `, [dataLimite.toISOString()], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }
  
  /**
   * Inicia conciliação automática periódica
   */
  iniciarConciliacaoAutomatica() {
    if (!this.conciliacaoAtiva) {
      console.log('Conciliação automática TEF desativada');
      return;
    }
    
    console.log(`Conciliação automática TEF iniciada (horário: ${this.horarioConciliacao})`);
    
    // Calcular tempo até o próximo horário de conciliação
    const [hora, minuto] = this.horarioConciliacao.split(':').map(Number);
    const agora = new Date();
    const proximaExecucao = new Date();
    proximaExecucao.setHours(hora, minuto, 0, 0);
    
    if (proximaExecucao <= agora) {
      proximaExecucao.setDate(proximaExecucao.getDate() + 1);
    }
    
    const tempoEspera = proximaExecucao - agora;
    
    setTimeout(() => {
      this.executarConciliacaoDiaria();
      
      // Executar diariamente no mesmo horário
      setInterval(async () => {
        try {
          await this.executarConciliacaoDiaria();
        } catch (error) {
          console.error('Erro na conciliação automática:', error);
        }
      }, 24 * 60 * 60 * 1000); // 24 horas
    }, tempoEspera);
    
    console.log(`Próxima conciliação agendada para: ${proximaExecucao.toISOString()}`);
  }
}

module.exports = new TefReconciliationService();
