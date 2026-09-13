/**
 * Serviço de Circuit Breaker para proteção contra cascata de falhas
 * Implementa o padrão Circuit Breaker para evitar sobrecarga em caso de falhas
 */
class TefCircuitBreakerService {
  
  constructor() {
    // Estado dos circuit breakers por serviço
    this.circuitBreakers = new Map();
    
    // Configurações padrão
    this.configuracoesPadrao = {
      limiteFalhas: 5, // Número de falhas antes de abrir o circuito
      timeoutAberto: 60000, // Tempo que o circuito permanece aberto (60s)
      timeoutMeioAberto: 30000, // Tempo para tentar novamente em estado meio-aberto (30s)
      porcentagemSucessoParaFechar: 50 // % de sucesso necessário para fechar o circuito
    };
  }
  
  /**
   * Executa uma função com proteção de circuit breaker
   * @param {string} nomeServico - Nome do serviço/operador
   * @param {Function} fn - Função a executar
   * @param {Object} configuracoes - Configurações específicas (opcional)
   * @returns {Promise} Resultado da função
   */
  async executarComCircuitBreaker(nomeServico, fn, configuracoes = {}) {
    const circuitBreaker = this._obterOuCriarCircuitBreaker(nomeServico, configuracoes);
    
    // Verificar estado do circuito
    if (circuitBreaker.estado === 'aberto') {
      // Verificar se já passou o timeout para tentar novamente
      if (Date.now() - circuitBreaker.ultimaFalha > circuitBreaker.timeoutAberto) {
        circuitBreaker.estado = 'meio_aberto';
        circuitBreaker.tentativasMeioAberto = 0;
      } else {
        throw new Error(`Circuit breaker aberto para ${nomeServico}. Tente novamente mais tarde.`);
      }
    }
    
    try {
      const resultado = await fn();
      
      // Sucesso - atualizar estatísticas
      this._registrarSucesso(circuitBreaker);
      
      // Se estiver em meio-aberto e atingir % de sucesso, fechar o circuito
      if (circuitBreaker.estado === 'meio_aberto') {
        circuitBreaker.tentativasMeioAberto++;
        const taxaSucesso = (circuitBreaker.sucessosRecentes / circuitBreaker.tentativasMeioAberto) * 100;
        
        if (taxaSucesso >= circuitBreaker.porcentagemSucessoParaFechar) {
          circuitBreaker.estado = 'fechado';
          circuitBreaker.falhasConsecutivas = 0;
          console.log(`Circuit breaker fechado para ${nomeServico}`);
        }
      }
      
      return resultado;
    } catch (error) {
      // Falha - atualizar estatísticas
      this._registrarFalha(circuitBreaker, error);
      
      // Verificar se deve abrir o circuito
      if (circuitBreaker.falhasConsecutivas >= circuitBreaker.limiteFalhas) {
        circuitBreaker.estado = 'aberto';
        circuitBreaker.ultimaFalha = Date.now();
        console.error(`Circuit breaker aberto para ${nomeServico} após ${circuitBreaker.falhasConsecutivas} falhas`);
        
        // Notificar falha
        this._notificarFalhaCircuitBreaker(nomeServico, circuitBreaker, error);
      }
      
      throw error;
    }
  }
  
  /**
   * Obtém ou cria um circuit breaker para um serviço
   */
  _obterOuCriarCircuitBreaker(nomeServico, configuracoes) {
    if (!this.circuitBreakers.has(nomeServico)) {
      this.circuitBreakers.set(nomeServico, {
        nome: nomeServico,
        estado: 'fechado', // fechado, aberto, meio_aberto
        falhasConsecutivas: 0,
        ultimaFalha: null,
        sucessosRecentes: 0,
        tentativasMeioAberto: 0,
        ...this.configuracoesPadrao,
        ...configuracoes
      });
    }
    
    return this.circuitBreakers.get(nomeServico);
  }
  
  /**
   * Registra um sucesso no circuit breaker
   */
  _registrarSucesso(circuitBreaker) {
    circuitBreaker.falhasConsecutivas = 0;
    circuitBreaker.sucessosRecentes++;
  }
  
  /**
   * Registra uma falha no circuit breaker
   */
  _registrarFalha(circuitBreaker, error) {
    circuitBreaker.falhasConsecutivas++;
    circuitBreaker.ultimaFalha = Date.now();
    circuitBreaker.sucessosRecentes = 0;
  }
  
  /**
   * Notifica falha do circuit breaker
   */
  _notificarFalhaCircuitBreaker(nomeServico, circuitBreaker, error) {
    // Em produção, isso poderia enviar email, Slack, etc.
    console.error(`ALERTA: Circuit breaker aberto para ${nomeServico}`, {
      falhasConsecutivas: circuitBreaker.falhasConsecutivas,
      erro: error.message
    });
  }
  
  /**
   * Força a abertura do circuit breaker
   */
  forcarAbertura(nomeServico) {
    const circuitBreaker = this._obterOuCriarCircuitBreaker(nomeServico);
    circuitBreaker.estado = 'aberto';
    circuitBreaker.ultimaFalha = Date.now();
    console.log(`Circuit breaker forçado para aberto: ${nomeServico}`);
  }
  
  /**
   * Força o fechamento do circuit breaker
   */
  forcarFechamento(nomeServico) {
    const circuitBreaker = this._obterOuCriarCircuitBreaker(nomeServico);
    circuitBreaker.estado = 'fechado';
    circuitBreaker.falhasConsecutivas = 0;
    circuitBreaker.sucessosRecentes = 0;
    console.log(`Circuit breaker forçado para fechado: ${nomeServico}`);
  }
  
  /**
   * Obtém o estado atual de um circuit breaker
   */
  obterEstado(nomeServico) {
    const circuitBreaker = this.circuitBreakers.get(nomeServico);
    
    if (!circuitBreaker) {
      return {
        nome: nomeServico,
        estado: 'nao_iniciado'
      };
    }
    
    return {
      nome: circuitBreaker.nome,
      estado: circuitBreaker.estado,
      falhasConsecutivas: circuitBreaker.falhasConsecutivas,
      ultimaFalha: circuitBreaker.ultimaFalha,
      tempoParaReabrir: circuitBreaker.estado === 'aberto' 
        ? Math.max(0, circuitBreaker.timeoutAberto - (Date.now() - circuitBreaker.ultimaFalha))
        : 0
    };
  }
  
  /**
   * Obtém estado de todos os circuit breakers
   */
  obterTodosEstados() {
    const estados = [];
    
    for (const [nome, circuitBreaker] of this.circuitBreakers) {
      estados.push({
        nome: circuitBreaker.nome,
        estado: circuitBreaker.estado,
        falhasConsecutivas: circuitBreaker.falhasConsecutivas,
        ultimaFalha: circuitBreaker.ultimaFalha,
        tempoParaReabrir: circuitBreaker.estado === 'aberto' 
          ? Math.max(0, circuitBreaker.timeoutAberto - (Date.now() - circuitBreaker.ultimaFalha))
          : 0
      });
    }
    
    return estados;
  }
  
  /**
   * Reseta todos os circuit breakers
   */
  resetarTodos() {
    this.circuitBreakers.clear();
    console.log('Todos os circuit breakers foram resetados');
  }
  
  /**
   * Configura parâmetros do circuit breaker
   */
  configurar(nomeServico, configuracoes) {
    const circuitBreaker = this._obterOuCriarCircuitBreaker(nomeServico);
    Object.assign(circuitBreaker, configuracoes);
  }
}

module.exports = new TefCircuitBreakerService();
