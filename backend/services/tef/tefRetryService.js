/**
 * Serviço de retry automático com backoff exponencial
 * Para operações TEF que podem falhar temporariamente
 */
class TefRetryService {
  
  constructor() {
    // Configurações padrão de retry
    this.maxRetries = 3;
    this.initialDelay = 1000; // 1 segundo
    this.maxDelay = 30000; // 30 segundos
    this.backoffMultiplier = 2;
  }
  
  /**
   * Executa uma função com retry automático e backoff exponencial
   * @param {Function} fn - Função a executar
   * @param {Object} options - Opções de retry
   * @returns {Promise} Resultado da função
   */
  async executarComRetry(fn, options = {}) {
    const maxRetries = options.maxRetries || this.maxRetries;
    const initialDelay = options.initialDelay || this.initialDelay;
    const maxDelay = options.maxDelay || this.maxDelay;
    const backoffMultiplier = options.backoffMultiplier || this.backoffMultiplier;
    const retryableErrors = options.retryableErrors || ['timeout', 'network', 'ECONNREFUSED', 'ETIMEDOUT'];
    
    let retryCount = 0;
    let lastError = null;
    
    while (retryCount <= maxRetries) {
      try {
        const resultado = await fn();
        return resultado;
      } catch (error) {
        lastError = error;
        retryCount++;
        
        // Verificar se erro é recuperável
        const ehRecuperavel = this._ehErroRecuperavel(error, retryableErrors);
        
        if (!ehRecuperavel || retryCount > maxRetries) {
          throw error;
        }
        
        // Calcular delay com backoff exponencial
        const delay = Math.min(
          initialDelay * Math.pow(backoffMultiplier, retryCount - 1),
          maxDelay
        );
        
        console.log(`Retry ${retryCount}/${maxRetries} após ${delay}ms. Erro: ${error.message}`);
        
        // Aguardar antes de tentar novamente
        await this._sleep(delay);
      }
    }
    
    throw lastError;
  }
  
  /**
   * Verifica se um erro é recuperável (pode ser retentado)
   */
  _ehErroRecuperavel(error, retryableErrors) {
    const errorMessage = String(error.message).toLowerCase();
    const errorName = String(error.name).toLowerCase();
    
    return retryableErrors.some(erro => 
      errorMessage.includes(erro.toLowerCase()) || 
      errorName.includes(erro.toLowerCase())
    );
  }
  
  /**
   * Função de sleep para aguardar
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Executa retry específico para autorização TEF
   * @param {Function} fn - Função de autorização
   * @param {Object} dados - Dados da transação
   * @returns {Promise} Resultado da autorização
   */
  async autorizarComRetry(fn, dados) {
    return await this.executarComRetry(fn, {
      maxRetries: dados.max_retries || this.maxRetries,
      initialDelay: dados.initial_delay || this.initialDelay,
      maxDelay: dados.max_delay || this.maxDelay,
      retryableErrors: ['timeout', 'network', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET']
    });
  }
  
  /**
   * Executa retry específico para cancelamento TEF
   * @param {Function} fn - Função de cancelamento
   * @param {Object} dados - Dados do cancelamento
   * @returns {Promise} Resultado do cancelamento
   */
  async cancelarComRetry(fn, dados) {
    return await this.executarComRetry(fn, {
      maxRetries: dados.max_retries || 5, // Mais retries para cancelamento
      initialDelay: dados.initial_delay || 500, // Delay menor para cancelamento
      maxDelay: dados.max_delay || 10000,
      retryableErrors: ['timeout', 'network', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET']
    });
  }
}

module.exports = new TefRetryService();
