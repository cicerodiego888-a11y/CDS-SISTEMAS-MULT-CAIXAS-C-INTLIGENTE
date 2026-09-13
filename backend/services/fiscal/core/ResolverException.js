/**
 * Exceções oficiais do engine de resolução.
 *
 * @module services/fiscal/core/ResolverException
 */

const ResolverErrorCode = Object.freeze({
  INVALID_CONTEXT: 'INVALID_CONTEXT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  REGISTRY_UNAVAILABLE: 'REGISTRY_UNAVAILABLE',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION'
});

class ResolverException extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ResolverException';
    this.code = code;
    this.details = Object.freeze({ ...details });
    Error.captureStackTrace?.(this, ResolverException);
  }

  /**
   * @param {string} message
   * @param {object} [details]
   * @returns {ResolverException}
   */
  static invalidContext(message, details) {
    return new ResolverException(ResolverErrorCode.INVALID_CONTEXT, message, details);
  }

  /**
   * @param {string} message
   * @param {object} [details]
   * @returns {ResolverException}
   */
  static validationError(message, details) {
    return new ResolverException(ResolverErrorCode.VALIDATION_ERROR, message, details);
  }

  /**
   * @param {string} message
   * @param {object} [details]
   * @returns {ResolverException}
   */
  static registryUnavailable(message, details) {
    return new ResolverException(ResolverErrorCode.REGISTRY_UNAVAILABLE, message, details);
  }

  /**
   * @param {string} message
   * @param {object} [details]
   * @returns {ResolverException}
   */
  static unsupportedVersion(message, details) {
    return new ResolverException(ResolverErrorCode.UNSUPPORTED_VERSION, message, details);
  }

  /**
   * @returns {boolean}
   */
  static isResolverException(error) {
    return error instanceof ResolverException;
  }
}

module.exports = {
  ResolverException,
  ResolverErrorCode
};
