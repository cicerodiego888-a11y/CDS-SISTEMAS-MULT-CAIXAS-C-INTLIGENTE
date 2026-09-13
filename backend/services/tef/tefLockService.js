const db = require('../../database');

/**
 * Serviço de locks para tratamento de concorrência em transações TEF
 * Evita conflitos quando múltiplas operações tentam acessar o mesmo recurso
 */
class TefLockService {
  
  constructor() {
    this.locks = new Map(); // Locks em memória para operações rápidas
    this.lockTimeout = 60000; // 60 segundos timeout padrão
  }
  
  /**
   * Adquire um lock para uma chave específica
   * @param {string} chave - Chave do lock (ex: venda_id, idempotency_key)
   * @param {number} timeoutMs - Timeout em milissegundos
   * @returns {Promise<boolean>} True se lock foi adquirido, false caso contrário
   */
  async adquirirLock(chave, timeoutMs = this.lockTimeout) {
    if (!chave) return false;
    
    // Verificar lock em memória primeiro
    if (this.locks.has(chave)) {
      const lockInfo = this.locks.get(chave);
      if (Date.now() < lockInfo.expiracao) {
        // Lock ainda válido
        return false;
      } else {
        // Lock expirado, remover
        this.locks.delete(chave);
      }
    }
    
    // Tentar adquirir lock no banco de dados
    try {
      const lockAdquirido = await this._adquirirLockBanco(chave, timeoutMs);
      
      if (lockAdquirido) {
        // Adicionar lock em memória para acesso rápido
        this.locks.set(chave, {
          expiracao: Date.now() + timeoutMs
        });
        
        // Configurar timeout para remover lock da memória
        setTimeout(() => {
          this.locks.delete(chave);
        }, timeoutMs);
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Erro ao adquirir lock:', error);
      return false;
    }
  }
  
  /**
   * Libera um lock
   * @param {string} chave - Chave do lock
   */
  async liberarLock(chave) {
    if (!chave) return;
    
    // Remover lock da memória
    this.locks.delete(chave);
    
    // Remover lock do banco de dados
    try {
      await this._liberarLockBanco(chave);
    } catch (error) {
      console.error('Erro ao liberar lock:', error);
    }
  }
  
  /**
   * Verifica se um lock está ativo
   * @param {string} chave - Chave do lock
   * @returns {Promise<boolean>} True se lock está ativo
   */
  async verificarLock(chave) {
    if (!chave) return false;
    
    // Verificar lock em memória primeiro
    if (this.locks.has(chave)) {
      const lockInfo = this.locks.get(chave);
      if (Date.now() < lockInfo.expiracao) {
        return true;
      } else {
        this.locks.delete(chave);
      }
    }
    
    // Verificar lock no banco de dados
    try {
      return await this._verificarLockBanco(chave);
    } catch (error) {
      console.error('Erro ao verificar lock:', error);
      return false;
    }
  }
  
  /**
   * Adquire lock no banco de dados
   */
  _adquirirLockBanco(chave, timeoutMs) {
    return new Promise((resolve, reject) => {
      const expiracao = new Date(Date.now() + timeoutMs).toISOString();
      
      db.run(`
        INSERT INTO tef_locks (chave, expiracao, criado_em)
        VALUES (?, ?, datetime('now'))
      `, [chave, expiracao], (err) => {
        if (err) {
          if (err.message.includes('UNIQUE constraint')) {
            // Lock já existe
            return resolve(false);
          }
          return reject(err);
        }
        resolve(true);
      });
    });
  }
  
  /**
   * Libera lock no banco de dados
   */
  _liberarLockBanco(chave) {
    return new Promise((resolve, reject) => {
      db.run(`
        DELETE FROM tef_locks
        WHERE chave = ?
      `, [chave], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  
  /**
   * Verifica lock no banco de dados
   */
  _verificarLockBanco(chave) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT expiracao
        FROM tef_locks
        WHERE chave = ?
      `, [chave], (err, row) => {
        if (err) return reject(err);
        
        if (!row) {
          return resolve(false);
        }
        
        // Verificar se lock expirou
        const expiracao = new Date(row.expiracao);
        if (expiracao < new Date()) {
          // Lock expirado, remover
          this._liberarLockBanco(chave).catch(() => {});
          return resolve(false);
        }
        
        resolve(true);
      });
    });
  }
  
  /**
   * Limpa locks expirados
   * Deve ser executado periodicamente
   */
  async limparLocksExpirados() {
    try {
      db.run(`
        DELETE FROM tef_locks
        WHERE expiracao < datetime('now')
      `, (err) => {
        if (err) {
          console.error('Erro ao limpar locks expirados:', err);
        }
      });
    } catch (error) {
      console.error('Erro ao limpar locks expirados:', error);
    }
  }
  
  /**
   * Executa uma função com lock
   * @param {string} chave - Chave do lock
   * @param {Function} fn - Função a executar
   * @param {number} timeoutMs - Timeout do lock
   * @returns {Promise} Resultado da função
   */
  async comLock(chave, fn, timeoutMs = this.lockTimeout) {
    const lockAdquirido = await this.adquirirLock(chave, timeoutMs);
    
    if (!lockAdquirido) {
      throw new Error(`Não foi possível adquirir lock para chave: ${chave}`);
    }
    
    try {
      return await fn();
    } finally {
      await this.liberarLock(chave);
    }
  }
}

module.exports = new TefLockService();
