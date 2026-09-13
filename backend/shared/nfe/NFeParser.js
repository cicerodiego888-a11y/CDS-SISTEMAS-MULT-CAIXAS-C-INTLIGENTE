/**
 * NFeParser — Parser puro de estrutura NF-e (xml2js → DTO).
 *
 * Pipeline oficial CDS: XML → NFeParser → NfeParseadaDTO
 *
 * Sem persistência, MIIP, Compras ou lógica de negócio externa.
 *
 * @module shared/nfe/NFeParser
 */

const NFeParserError = require('./errors/NFeParserError');
const { mapearInfNFe } = require('./mappers/nfeXmlMapper');

class NFeParser {
  /**
   * Extrai infNFe de nfeProc ou NFe direta.
   *
   * @param {Object} result - Resultado do xml2js.parseString
   * @returns {Object|null}
   */
  static extrairInfNFe(result) {
    return result?.nfeProc?.NFe?.infNFe || result?.NFe?.infNFe || null;
  }

  /**
   * Parse síncrono a partir do objeto xml2js.
   *
   * @param {Object} result
   * @returns {import('./contracts/NfeParseadaDTO')}
   */
  static parse(result) {
    const infNFe = NFeParser.extrairInfNFe(result);

    if (!infNFe) {
      throw new NFeParserError('XML não contém uma NF-e válida.', 'NFE_INVALIDA');
    }

    try {
      return mapearInfNFe(infNFe);
    } catch (error) {
      throw new NFeParserError(
        'Erro ao extrair dados do XML: ' + error.message,
        'NFE_EXTRACAO'
      );
    }
  }
}

module.exports = NFeParser;
