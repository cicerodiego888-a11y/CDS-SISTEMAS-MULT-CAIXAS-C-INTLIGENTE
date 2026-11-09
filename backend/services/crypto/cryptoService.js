const crypto = require('crypto');
const { chaveDesenvolvimentoProibida } = require('../tef/tefReconciliationEvidence');

/**
 * Serviço de criptografia AES-256 para dados sensíveis
 * Conforme PCI-DSS 3.2.1 - Armazenamento seguro de dados sensíveis
 */
class CryptoService {

  constructor() {
    this.algorithm = 'aes-256-cbc';
    this.ivLength = 16;
  }

  /**
   * Obtém a chave explicitamente provisionada pelo processo Electron.
   */
  _getSecretKey() {
    const envKey = process.env.TEF_ENCRYPTION_KEY;
    if (envKey == null || envKey === '') {
      const error = new Error('Chave TEF indisponível.');
      error.code = 'TEF_CRYPTO_KEY_UNAVAILABLE';
      throw error;
    }

    if (!/^[0-9a-fA-F]{64}$/.test(envKey)) {
      const error = new Error('Chave TEF inválida.');
      error.code = 'TEF_CRYPTO_KEY_INVALID';
      throw error;
    }

    if (chaveDesenvolvimentoProibida(envKey)) {
      const error = new Error('Chave TEF inválida.');
      error.code = 'TEF_CRYPTO_KEY_INVALID';
      throw error;
    }

    return Buffer.from(envKey, 'hex');
  }

  _erroCriptografia(error, code, message) {
    if (error && /^TEF_CRYPTO_KEY_/.test(error.code || '')) return error;
    const wrapped = new Error(message);
    wrapped.code = code;
    return wrapped;
  }

  /**
   * Criptografa dados usando AES-256-CBC
   * @param {string} texto - Texto a ser criptografado
   * @returns {string} Texto criptografado em formato hex
   */
  criptografar(texto) {
    if (!texto) return null;

    try {
      const iv = crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipheriv(this.algorithm, this._getSecretKey(), iv);

      let criptografado = cipher.update(texto, 'utf8', 'hex');
      criptografado += cipher.final('hex');

      // Concatenar IV com o texto criptografado
      return iv.toString('hex') + ':' + criptografado;
    } catch (error) {
      throw this._erroCriptografia(
        error,
        'TEF_CRYPTO_ENCRYPTION_FAILED',
        'Falha na criptografia de dados.'
      );
    }
  }

  /**
   * Descriptografa dados usando AES-256-CBC
   * @param {string} textoCriptografado - Texto criptografado em formato hex
   * @returns {string} Texto descriptografado
   */
  descriptografar(textoCriptografado) {
    if (!textoCriptografado) return null;

    try {
      const secretKey = this._getSecretKey();
      const partes = textoCriptografado.split(':');
      if (partes.length !== 2) {
        throw new Error('Formato de criptografia inválido');
      }

      if (!/^[0-9a-fA-F]{32}$/.test(partes[0])
          || !/^(?:[0-9a-fA-F]{2})+$/.test(partes[1])) {
        throw new Error('Formato de criptografia inválido');
      }

      const iv = Buffer.from(partes[0], 'hex');
      const criptografado = partes[1];

      const decipher = crypto.createDecipheriv(this.algorithm, secretKey, iv);

      let descriptografado = decipher.update(criptografado, 'hex', 'utf8');
      descriptografado += decipher.final('utf8');

      return descriptografado;
    } catch (error) {
      throw this._erroCriptografia(
        error,
        'TEF_CRYPTO_DECRYPTION_FAILED',
        'Falha na descriptografia de dados.'
      );
    }
  }

  /**
   * Criptografa objeto JSON
   * @param {Object} objeto - Objeto a ser criptografado
   * @returns {string} Objeto criptografado em formato hex
   */
  criptografarObjeto(objeto) {
    if (!objeto) return null;

    try {
      const texto = JSON.stringify(objeto);
      return this.criptografar(texto);
    } catch (error) {
      throw this._erroCriptografia(
        error,
        'TEF_CRYPTO_ENCRYPTION_FAILED',
        'Falha na criptografia de objeto.'
      );
    }
  }

  /**
   * Descriptografa objeto JSON
   * @param {string} textoCriptografado - Objeto criptografado em formato hex
   * @returns {Object} Objeto descriptografado
   */
  descriptografarObjeto(textoCriptografado) {
    if (!textoCriptografado) return null;

    try {
      const texto = this.descriptografar(textoCriptografado);
      return JSON.parse(texto);
    } catch (error) {
      throw this._erroCriptografia(
        error,
        'TEF_CRYPTO_DECRYPTION_FAILED',
        'Falha na descriptografia de objeto.'
      );
    }
  }

  /**
   * Gera hash SHA-256 para integridade de dados
   * @param {string} texto - Texto para gerar hash
   * @returns {string} Hash em formato hex
   */
  gerarHash(texto) {
    if (!texto) return null;

    return crypto.createHash('sha256').update(texto).digest('hex');
  }

  /**
   * Gera token aleatório seguro
   * @param {number} tamanho - Tamanho do token em bytes
   * @returns {string} Token em formato hex
   */
  gerarToken(tamanho = 32) {
    return crypto.randomBytes(tamanho).toString('hex');
  }
}

module.exports = new CryptoService();
