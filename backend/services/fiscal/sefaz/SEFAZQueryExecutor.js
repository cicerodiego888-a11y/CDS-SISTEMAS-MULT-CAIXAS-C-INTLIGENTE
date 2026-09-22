/**
 * Executor — executa a consulta autorizada (callback SOAP).
 * Não decide autorização; isso é responsabilidade do Gate.
 */
'use strict';

class SEFAZQueryExecutor {
  /**
   * @param {Function} executeFn async () => resultado
   * @returns {Promise<{ sucesso: boolean, resultado?: any, erro?: Error, tempo_ms: number }>}
   */
  async executar(executeFn) {
    const inicio = Date.now();
    try {
      const resultado = await executeFn();
      return {
        sucesso: true,
        resultado,
        tempo_ms: Date.now() - inicio
      };
    } catch (erro) {
      return {
        sucesso: false,
        erro,
        tempo_ms: Date.now() - inicio
      };
    }
  }
}

module.exports = {
  SEFAZQueryExecutor,
  queryExecutorPadrao: new SEFAZQueryExecutor()
};
