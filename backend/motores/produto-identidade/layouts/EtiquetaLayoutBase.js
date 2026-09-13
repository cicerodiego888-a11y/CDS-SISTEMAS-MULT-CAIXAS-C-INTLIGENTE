/**
 * Contrato base de layout de etiqueta EAN-13 prefixo 2.
 * @module motores/produto-identidade/layouts/EtiquetaLayoutBase
 */

class EtiquetaLayoutBase {
  /** @returns {string} */
  get id() {
    throw new Error('Layout deve implementar id');
  }

  /** @returns {string} */
  get nome() {
    return this.id;
  }

  /**
   * @param {string} codigo13 - apenas dígitos, length 13, começa com 2
   * @returns {{
   *   plu: string,
   *   pluRaw: string,
   *   valorTotal?: number|null,
   *   peso?: number|null,
   *   tipoPayload: 'VALOR'|'PESO',
   *   codigoOriginal: string,
   *   layoutId: string
   * }|null}
   */
  parse(codigo13) {
    void codigo13;
    return null;
  }
}

module.exports = EtiquetaLayoutBase;
