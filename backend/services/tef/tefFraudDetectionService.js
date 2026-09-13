const db = require('../../database');

/**
 * Serviço de detecção de transações suspeitas
 * Identifica padrões fraudulentos e gera alertas automáticos
 */
class TefFraudDetectionService {
  
  constructor() {
    // Configurações de detecção de fraude
    this.configuracoes = {
      valorMaximoSemAutenticacao: 1000.00, // Valor máximo sem autenticação forte
      limiteTransacoesMesmoCartao: 5, // Limite de transações mesmo cartão em 1 hora
      limiteTransacoesMesmoIP: 10, // Limite de transações mesmo IP em 1 hora
      intervaloTempoMinimo: 30000, // Tempo mínimo entre transações (30 segundos)
      alertasAtivos: true
    };
  }
  
  /**
   * Analisa uma transação para detectar padrões suspeitos
   * @param {Object} dados - Dados da transação
   * @param {Object} contexto - Contexto da transação (IP, user agent, etc.)
   * @returns {Object} { suspeita: boolean, alertas: string[], nivel_risco: string }
   */
  async analisarTransacao(dados, contexto = {}) {
    const alertas = [];
    let nivelRisco = 'baixo';
    
    try {
      // Verificar valor suspeito
      const alertaValor = await this._verificarValorSuspeito(dados);
      if (alertaValor) {
        alertas.push(alertaValor);
        nivelRisco = this._atualizarNivelRisco(nivelRisco, 'medio');
      }
      
      // Verificar frequência de transações
      const alertaFrequencia = await this._verificarFrequenciaTransacoes(dados, contexto);
      if (alertaFrequencia) {
        alertas.push(alertaFrequencia);
        nivelRisco = this._atualizarNivelRisco(nivelRisco, 'alto');
      }
      
      // Verificar padrões de comportamento
      const alertaPadrao = await this._verificarPadraoComportamento(dados, contexto);
      if (alertaPadrao) {
        alertas.push(alertaPadrao);
        nivelRisco = this._atualizarNivelRisco(nivelRisco, 'medio');
      }
      
      // Verificar inconsistências de dados
      const alertaInconsistencia = await this._verificarInconsistencias(dados);
      if (alertaInconsistencia) {
        alertas.push(alertaInconsistencia);
        nivelRisco = this._atualizarNivelRisco(nivelRisco, 'alto');
      }
      
      const suspeita = alertas.length > 0;
      
      // Se houver alertas, registrar no sistema
      if (suspeita && this.configuracoes.alertasAtivos) {
        await this._registrarAlerta(dados, contexto, alertas, nivelRisco);
      }
      
      return {
        suspeita,
        alertas,
        nivel_risco: nivelRisco
      };
    } catch (error) {
      console.error('Erro ao analisar transação para fraude:', error);
      return {
        suspeita: false,
        alertas: [],
        nivel_risco: 'desconhecido'
      };
    }
  }
  
  /**
   * Verifica se o valor da transação é suspeito
   */
  async _verificarValorSuspeito(dados) {
    const valor = Number(dados.valor) || 0;
    
    // Valor muito alto
    if (valor > 10000.00) {
      return `Valor muito alto: R$ ${valor.toFixed(2)}`;
    }
    
    // Valor redondo (suspeito de fraude)
    if (valor > 100 && valor % 100 === 0) {
      return `Valor redondo suspeito: R$ ${valor.toFixed(2)}`;
    }
    
    return null;
  }
  
  /**
   * Verifica frequência de transações do mesmo cartão/IP
   */
  async _verificarFrequenciaTransacoes(dados, contexto) {
    const agora = new Date();
    const umaHoraAtras = new Date(agora.getTime() - 3600000);
    
    // Verificar transações do mesmo cartão (se disponível)
    if (dados.numero_cartao_mascarado) {
      const transacoesCartao = await this._contarTransacoesCartao(
        dados.numero_cartao_mascarado,
        umaHoraAtras
      );
      
      if (transacoesCartao >= this.configuracoes.limiteTransacoesMesmoCartao) {
        return `Muitas transações do mesmo cartão: ${transacoesCartao} em 1 hora`;
      }
    }
    
    // Verificar transações do mesmo IP
    if (contexto.ip_address) {
      const transacoesIP = await this._contarTransacoesIP(
        contexto.ip_address,
        umaHoraAtras
      );
      
      if (transacoesIP >= this.configuracoes.limiteTransacoesMesmoIP) {
        return `Muitas transações do mesmo IP: ${transacoesIP} em 1 hora`;
      }
    }
    
    return null;
  }
  
  /**
   * Verifica padrões de comportamento suspeitos
   */
  async _verificarPadraoComportamento(dados, contexto) {
    // Verificar se há múltiplas tentativas de pagamento
    if (dados.tentativas && dados.tentativas > 3) {
      return `Múltiplas tentativas de pagamento: ${dados.tentativas}`;
    }
    
    // Verificar mudança de IP frequente
    if (contexto.ip_mudou_recentemente) {
      return 'Mudança recente de endereço IP';
    }
    
    return null;
  }
  
  /**
   * Verifica inconsistências nos dados da transação
   */
  async _verificarInconsistencias(dados) {
    // Verificar inconsistência entre tipo e parcelas
    if (dados.tipo === 'debito' && dados.parcelas > 1) {
      return 'Inconsistência: débito com parcelamento';
    }
    
    // Verificar valor inválido
    if (dados.valor <= 0 || dados.valor > 50000) {
      return 'Valor inválido ou suspeito';
    }
    
    return null;
  }
  
  /**
   * Conta transações do mesmo cartão no período
   */
  async _contarTransacoesCartao(numeroCartaoMascarado, dataInicio) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT COUNT(*) as count
        FROM tef_transacoes
        WHERE payload_retorno LIKE ?
        AND criado_em >= ?
      `, [`%${numeroCartaoMascarado}%`, dataInicio.toISOString()], (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.count : 0);
      });
    });
  }
  
  /**
   * Conta transações do mesmo IP no período
   */
  async _contarTransacoesIP(ipAddress, dataInicio) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT COUNT(*) as count
        FROM tef_auditoria_acesso
        WHERE ip_address = ?
        AND criado_em >= ?
      `, [ipAddress, dataInicio.toISOString()], (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.count : 0);
      });
    });
  }
  
  /**
   * Atualiza o nível de risco com base no novo alerta
   */
  _atualizarNivelRisco(nivelAtual, novoNivel) {
    const niveis = { baixo: 1, medio: 2, alto: 3 };
    const atual = niveis[nivelAtual] || 1;
    const novo = niveis[novoNivel] || 1;
    
    return novo > atual ? novoNivel : nivelAtual;
  }
  
  /**
   * Registra um alerta de fraude no sistema
   */
  async _registrarAlerta(dados, contexto, alertas, nivelRisco) {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO tef_alertas_fraude (
          transacao_id,
          alertas,
          nivel_risco,
          dados_transacao,
          contexto,
          criado_em
        ) VALUES (?, ?, ?, ?, ?, datetime('now'))
      `, [
        dados.transacao_id || null,
        JSON.stringify(alertas),
        nivelRisco,
        JSON.stringify(dados),
        JSON.stringify(contexto)
      ], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  
  /**
   * Configura os parâmetros de detecção de fraude
   */
  configurarParametros(parametros) {
    this.configuracoes = {
      ...this.configuracoes,
      ...parametros
    };
  }
  
  /**
   * Obtém as configurações atuais
   */
  obterConfiguracoes() {
    return { ...this.configuracoes };
  }
}

module.exports = new TefFraudDetectionService();
