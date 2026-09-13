/**
 * DocumentoDfeClassifier — Classificador oficial de documentos DF-e (RC6.1).
 *
 * Responsabilidade única: receber XML e retornar DocumentoDfeTipo pela raiz.
 * Não interpreta conteúdo fiscal, não usa MIIP, banco, Parser ou SOAP.
 *
 * @module motores/central-entradas/services/DocumentoDfeClassifier
 */

const {
  DocumentoDfeTipo,
  RAIZ_PARA_TIPO
} = require('../core/DocumentoDfeTipo');

class DocumentoDfeClassifier {
  /**
   * Classifica o XML pelo elemento raiz (localName).
   *
   * @param {string|null|undefined} xml
   * @returns {string} DocumentoDfeTipo
   */
  static classificar(xml) {
    const raiz = DocumentoDfeClassifier.extrairNomeRaiz(xml);
    if (!raiz) return DocumentoDfeTipo.DESCONHECIDO;
    return RAIZ_PARA_TIPO[raiz] || DocumentoDfeTipo.DESCONHECIDO;
  }

  /**
   * Extrai o localName do primeiro elemento do documento.
   * Ignora declaração XML e comentários iniciais. Sem regex complexas.
   *
   * @param {string|null|undefined} xml
   * @returns {string|null}
   */
  static extrairNomeRaiz(xml) {
    if (xml == null) return null;
    const texto = String(xml);
    if (!texto) return null;

    let i = 0;
    const len = texto.length;

    // Declaração <?xml ...?>
    while (i < len && /\s/.test(texto[i])) i += 1;
    if (texto.startsWith('<?', i)) {
      const fim = texto.indexOf('?>', i);
      if (fim < 0) return null;
      i = fim + 2;
    }

    // Comentários e espaços até a primeira tag
    while (i < len) {
      while (i < len && /\s/.test(texto[i])) i += 1;
      if (texto.startsWith('<!--', i)) {
        const fim = texto.indexOf('-->', i + 4);
        if (fim < 0) return null;
        i = fim + 3;
        continue;
      }
      break;
    }

    if (i >= len || texto[i] !== '<') return null;
    i += 1;
    if (texto[i] === '?' || texto[i] === '!') return null;
    if (texto[i] === '/') i += 1;

    let nome = '';
    while (i < len) {
      const c = texto[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '>' || c === '/') {
        break;
      }
      nome += c;
      i += 1;
    }

    if (!nome) return null;

    // Remove prefixo de namespace (ex.: nfe:resNFe)
    const colon = nome.lastIndexOf(':');
    if (colon >= 0) nome = nome.slice(colon + 1);

    return nome || null;
  }
}

module.exports = DocumentoDfeClassifier;
