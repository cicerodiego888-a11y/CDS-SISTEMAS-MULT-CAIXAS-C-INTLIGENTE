const crypto = require('crypto');
const db = require('../../database');

/**
 * Serviço de tokenização de dados sensíveis
 * Conforme PCI-DSS 3.2.1 - Tokenização de dados de cartão
 */
class TokenizationService {
  
  constructor() {
    this.algorithm = 'aes-256-cbc';
    this.secretKey = this._getSecretKey();
    this.ivLength = 16;
  }
  
  /**
   * Obtém a chave de criptografia
   * Em produção, deve vir de variável de ambiente ou HSM
   */
  _getSecretKey() {
    const envKey = process.env.TEF_TOKENIZATION_KEY;
    if (envKey) {
      return Buffer.from(envKey, 'hex');
    }
    
    // Chave padrão para desenvolvimento (NÃO usar em produção)
    const defaultKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    return Buffer.from(defaultKey, 'hex');
  }
  
  /**
   * Gera um token único para dados sensíveis
   * @param {string} dados - Dados a serem tokenizados
   * @returns {string} Token único
   */
  gerarToken(dados) {
    if (!dados) return null;
    
    // Usar hash SHA-256 como base para o token
    const hash = crypto.createHash('sha256').update(dados + Date.now()).digest('hex');
    
    // Retornar apenas os primeiros 32 caracteres como token
    return hash.substring(0, 32);
  }
  
  /**
   * Tokeniza dados de cartão
   * @param {string} numeroCartao - Número do cartão
   * @returns {Object} { token, last4, bin }
   */
  async tokenizarCartao(numeroCartao) {
    if (!numeroCartao) return null;
    
    // Remover caracteres não numéricos
    const apenasNumeros = String(numeroCartao).replace(/\D/g, '');
    
    if (apenasNumeros.length < 13) {
      throw new Error('Número de cartão inválido');
    }
    
    // Extrair BIN (primeiros 6 dígitos)
    const bin = apenasNumeros.substring(0, 6);
    
    // Extrair últimos 4 dígitos
    const last4 = apenasNumeros.substring(apenasNumeros.length - 4);
    
    // Gerar token
    const token = this.gerarToken(apenasNumeros);
    
    // Salvar mapeamento no banco de dados
    await this._salvarMapeamento(token, apenasNumeros, bin, last4);
    
    return {
      token,
      bin,
      last4
    };
  }
  
  /**
   * Destokeniza dados de cartão
   * @param {string} token - Token do cartão
   * @returns {string} Número do cartão original
   */
  async destokenizarCartao(token) {
    if (!token) return null;
    
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT numero_cartao
        FROM tef_tokens
        WHERE token = ?
        AND ativo = 1
      `, [token], (err, row) => {
        if (err) return reject(err);
        
        if (!row) {
          return reject(new Error('Token não encontrado'));
        }
        
        resolve(row.numero_cartao);
      });
    });
  }
  
  /**
   * Salva mapeamento de token para número de cartão
   */
  _salvarMapeamento(token, numeroCartao, bin, last4) {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO tef_tokens (
          token,
          numero_cartao,
          bin,
          last4,
          ativo,
          criado_em
        ) VALUES (?, ?, ?, ?, 1, datetime('now'))
      `, [token, numeroCartao, bin, last4], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  
  /**
   * Invalida um token
   * @param {string} token - Token a ser invalidado
   */
  async invalidarToken(token) {
    return new Promise((resolve, reject) => {
      db.run(`
        UPDATE tef_tokens
        SET ativo = 0,
        invalidado_em = datetime('now')
        WHERE token = ?
      `, [token], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  
  /**
   * Verifica se um token é válido
   * @param {string} token - Token a ser verificado
   * @returns {boolean} Token válido
   */
  async verificarToken(token) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT ativo
        FROM tef_tokens
        WHERE token = ?
      `, [token], (err, row) => {
        if (err) return reject(err);
        
        if (!row) {
          return resolve(false);
        }
        
        resolve(row.ativo === 1);
      });
    });
  }
  
  /**
   * Retorna informações do token (sem o número do cartão)
   * @param {string} token - Token a ser consultado
   * @returns {Object} { bin, last4, ativo }
   */
  async obterInfoToken(token) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT bin, last4, ativo, criado_em
        FROM tef_tokens
        WHERE token = ?
      `, [token], (err, row) => {
        if (err) return reject(err);
        
        if (!row) {
          return resolve(null);
        }
        
        resolve({
          bin: row.bin,
          last4: row.last4,
          ativo: row.ativo === 1,
          criado_em: row.criado_em
        });
      });
    });
  }
}

module.exports = new TokenizationService();
