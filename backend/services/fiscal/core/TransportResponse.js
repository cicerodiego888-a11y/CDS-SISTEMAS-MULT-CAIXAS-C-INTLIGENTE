/**
 * Resposta SOAP tipada / imutável.
 *
 * @module services/fiscal/core/TransportResponse
 */

/**
 * @param {object} input
 * @returns {Readonly<object>}
 */
function createTransportResponse(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('TransportResponse: payload inválido.');
  }

  const tempo = Number(input.tempo);
  if (!Number.isFinite(tempo) || tempo < 0) {
    throw new Error('TransportResponse: tempo inválido.');
  }

  return Object.freeze({
    success: Boolean(input.success),
    statusCode: input.statusCode == null ? null : Number(input.statusCode),
    status: input.status == null ? null : String(input.status),
    body: input.body == null ? null : input.body,
    headers: Object.freeze({
      ...(input.headers && typeof input.headers === 'object' ? input.headers : {})
    }),
    tempo,
    warnings: Object.freeze(
      Array.isArray(input.warnings)
        ? input.warnings.map((w) => Object.freeze({ ...w }))
        : []
    ),
    error: input.error == null ? null : String(input.error),
    attempts: Number(input.attempts) > 0 ? Number(input.attempts) : 1
  });
}

class TransportResponse {
  /**
   * @param {object} input
   */
  constructor(input) {
    const res = createTransportResponse(input);
    Object.assign(this, res);
    Object.freeze(this);
  }

  /**
   * @param {object} input
   * @returns {TransportResponse}
   */
  static create(input) {
    return new TransportResponse(input);
  }

  /**
   * @param {object} params
   * @returns {TransportResponse}
   */
  static success(params) {
    return TransportResponse.create({
      success: true,
      statusCode: params.statusCode == null ? 200 : params.statusCode,
      status: params.status || 'ok',
      body: params.body == null ? null : params.body,
      headers: params.headers || {},
      tempo: params.tempo,
      warnings: params.warnings || [],
      error: null,
      attempts: params.attempts
    });
  }

  /**
   * @param {object} params
   * @returns {TransportResponse}
   */
  static failure(params) {
    return TransportResponse.create({
      success: false,
      statusCode: params.statusCode == null ? null : params.statusCode,
      status: params.status || 'error',
      body: params.body == null ? null : params.body,
      headers: params.headers || {},
      tempo: params.tempo,
      warnings: params.warnings || [],
      error: params.error || 'Falha no transporte SOAP.',
      attempts: params.attempts
    });
  }
}

module.exports = {
  TransportResponse,
  createTransportResponse
};
