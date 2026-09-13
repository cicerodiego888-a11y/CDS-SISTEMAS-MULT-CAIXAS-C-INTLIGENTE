/**
 * NFeParserService — Fachada oficial do pipeline de parse NF-e do CDS Sistemas.
 *
 * Ponto único de entrada para qualquer origem de XML:
 * upload manual, DF-e, chave, portal, API, marketplace, e-mail (futuro).
 *
 * Fluxo:
 *   XML string → xml2js → NFeParser → NfeParseadaDTO → JSON compatível
 *
 * @module shared/nfe/NFeParserService
 */

const { promisify } = require('util');
const xml2js = require('xml2js');
const NFeParser = require('./NFeParser');
const NFeParserError = require('./errors/NFeParserError');

const parseString = promisify(xml2js.parseString);

const OPCOES_XML2JS = Object.freeze({
  explicitArray: false,
  ignoreAttrs: false
});

class NFeParserService {
  /**
   * Parse oficial de XML NF-e.
   *
   * @param {string|Buffer} xmlContent
   * @returns {Promise<Object>} JSON snake_case compatível com parse-xml de Compras
   */
  static async parse(xmlContent) {
    const conteudo = Buffer.isBuffer(xmlContent)
      ? xmlContent.toString('utf8')
      : String(xmlContent || '');

    if (!conteudo.trim()) {
      throw new NFeParserError('Conteúdo XML vazio.', 'NFE_VAZIO');
    }

    let result;
    try {
      result = await parseString(conteudo, OPCOES_XML2JS);
    } catch (error) {
      throw new NFeParserError('Erro ao parsear XML: ' + error.message, 'NFE_XML_PARSE');
    }

    const dto = NFeParser.parse(result);
    return dto.toJSON();
  }

  /**
   * Parse a partir de objeto xml2js já convertido (útil para testes).
   *
   * @param {Object} result
   * @returns {Object}
   */
  static parseFromXml2Js(result) {
    const dto = NFeParser.parse(result);
    return dto.toJSON();
  }
}

module.exports = NFeParserService;
