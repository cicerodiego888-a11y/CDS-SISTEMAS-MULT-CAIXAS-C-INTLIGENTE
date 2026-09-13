/**
 * NFeParserError — Erros tipados do pipeline oficial de parse NF-e.
 *
 * @module shared/nfe/errors/NFeParserError
 */

class NFeParserError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   */
  constructor(message, code = 'NFE_PARSER') {
    super(message);
    this.name = 'NFeParserError';
    this.code = code;
  }
}

module.exports = NFeParserError;
