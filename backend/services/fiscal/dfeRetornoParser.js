/**
 * dfeRetornoParser — Parse puro do retorno SOAP da Distribuição DF-e.
 * RC3.6.E — extrairDocumentosZip passa a reportar descartes (sem mudar o conjunto persistido).
 * RC3.7.5.2 — não fabricar NSU: tag ausente → null.
 *
 * @module services/fiscal/dfeRetornoParser
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const NSU_ZERADO = '000000000000000';

/**
 * Normaliza NSU existente para 15 dígitos.
 * RC3.7.5.2 — null/undefined/vazio → null (nunca fabrica zero).
 *
 * @param {string|number|null|undefined} nsu
 * @returns {string|null}
 */
function normalizarNsu(nsu) {
  if (nsu == null) return null;
  const raw = String(nsu).trim();
  if (raw === '') return null;
  const digitos = raw.replace(/\D/g, '');
  if (!digitos) return null;
  return digitos.padStart(15, '0');
}

/**
 * Normaliza com fallback explícito para zero (cursor local / request / docZip).
 * @param {*} nsu
 * @returns {string}
 */
function normalizarNsuOuZero(nsu) {
  return normalizarNsu(nsu) || NSU_ZERADO;
}

/**
 * Extrai tag NSU do XML com suporte a namespace (nfe:, ns1:, etc.).
 * @param {string} xml
 * @param {string} tag — 'ultNSU' | 'maxNSU'
 * @returns {string|null}
 */
function extrairNsuTagDoXml(xml, tag) {
  const regex = new RegExp(
    `<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>\\s*(\\d+)\\s*<\\/(?:[\\w.-]+:)?${tag}>`,
    'i'
  );
  const m = String(xml || '').match(regex);
  if (!m) return null;
  return normalizarNsu(m[1]);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function nsuMenorQue(a, b) {
  return normalizarNsuOuZero(a) < normalizarNsuOuZero(b);
}

/**
 * @param {string} xmlRetorno
 * @returns {{ cStat: string, xMotivo: string, ultNSU: string|null, maxNSU: string|null }}
 */
function extrairMetadadosRetorno(xmlRetorno) {
  const texto = String(xmlRetorno || '');
  const cStatMatch = texto.match(/<(?:[\w.-]+:)?cStat(?:\s[^>]*)?>\s*(\d+)\s*<\/(?:[\w.-]+:)?cStat>/i);
  const xMotivoMatch = texto.match(/<(?:[\w.-]+:)?xMotivo(?:\s[^>]*)?>\s*(.*?)\s*<\/(?:[\w.-]+:)?xMotivo>/i);

  return {
    cStat: cStatMatch?.[1] || '',
    xMotivo: xMotivoMatch?.[1] || '',
    // RC3.7.5.2 — tag inexistente → null (nunca 000…000 fabricado)
    ultNSU: extrairNsuTagDoXml(texto, 'ultNSU'),
    maxNSU: extrairNsuTagDoXml(texto, 'maxNSU')
  };
}

/**
 * Salva XML bruto de retorno 656 para diagnóstico.
 * @param {string} xmlRetorno
 * @param {Object} [opcoes]
 * @returns {string|null}
 */
function salvarXmlRetorno656(xmlRetorno, opcoes = {}) {
  try {
    const { getFiscalSubDir } = require('./paths');
    const pasta = getFiscalSubDir('debug');
    const cid = String(opcoes.correlationId || Date.now()).replace(/[^\w.-]/g, '_');
    const nome = `dfe-ret-656-${cid}.xml`;
    const destino = path.join(pasta, nome);
    fs.writeFileSync(destino, String(xmlRetorno || ''), 'utf8');
    return destino;
  } catch (err) {
    console.warn('[dfeRetornoParser] Falha ao salvar XML 656:', err.message);
    return null;
  }
}

/**
 * @param {string} schema
 * @param {string} xml
 * @returns {boolean}
 */
function isDocumentoNotaFiscal(schema, xml) {
  const schemaLower = String(schema || '').toLowerCase();
  if (schemaLower.includes('procnfe') || schemaLower.includes('resnfe')) {
    return true;
  }

  return /<infNFe[\s>]/i.test(xml) || /<nfeProc/i.test(xml);
}

/**
 * Classifica schema/XML para auditoria (não altera filtro de persistência).
 * @param {string} schema
 * @param {string} xml
 * @returns {string}
 */
function classificarSchemaAuditoria(schema, xml) {
  const s = String(schema || '').toLowerCase();
  if (s.includes('procevento') || /<procEventoNFe/i.test(xml || '')) return 'PROC_EVENTO_NFE';
  if (s.includes('resevento') || /<resEvento/i.test(xml || '')) return 'RES_EVENTO';
  if (s.includes('resnfe') || /<resNFe/i.test(xml || '')) return 'RES_NFE';
  if (s.includes('procnfe') || /<nfeProc/i.test(xml || '')) return 'PROC_NFE';
  if (/<NFe[\s>]/i.test(xml || '')) return 'NFE';
  return 'DESCONHECIDO';
}

/**
 * @param {string} xmlRetorno
 * @param {Object} [opcoes]
 * @param {Function} [opcoes.onDescarte] callback({ nsu, schema, tipo, resultado, motivo, tempoMs, tamanhoZip })
 * @returns {Array<{ nsu: string, schema: string, xml: string, compactado: string, tipoAuditoria: string, tempoZipMs: number, tamanhoZip: number }>}
 */
function extrairDocumentosZip(xmlRetorno, opcoes = {}) {
  const documentos = [];
  const onDescarte = typeof opcoes.onDescarte === 'function' ? opcoes.onDescarte : null;
  const regex = /<docZip([^>]*)>([\s\S]*?)<\/docZip>/gi;
  let match;

  while ((match = regex.exec(String(xmlRetorno || ''))) !== null) {
    const t0 = Date.now();
    const atributos = match[1] || '';
    const compactado = (match[2] || '').trim();
    const nsu = normalizarNsuOuZero(atributos.match(/NSU="(\d+)"/i)?.[1]);
    const schema = atributos.match(/schema="([^"]+)"/i)?.[1] || '';
    const tamanhoZip = compactado.length;

    if (!compactado) {
      if (onDescarte) {
        onDescarte({
          nsu,
          schema,
          tipo: 'ZIP',
          resultado: 'ERRO_ZIP',
          motivo: 'docZip vazio',
          tempoMs: Date.now() - t0,
          tamanhoZip: 0
        });
      }
      continue;
    }

    let xml = '';
    try {
      xml = zlib.gunzipSync(Buffer.from(compactado, 'base64')).toString('utf8');
    } catch (err) {
      if (onDescarte) {
        onDescarte({
          nsu,
          schema,
          tipo: 'ZIP',
          resultado: 'ERRO_ZIP',
          motivo: `Falha ao descompactar: ${err.message || 'gzip/base64'}`,
          tempoMs: Date.now() - t0,
          tamanhoZip
        });
      }
      continue;
    }

    const tipoAuditoria = classificarSchemaAuditoria(schema, xml);
    const tempoZipMs = Date.now() - t0;

    if (!isDocumentoNotaFiscal(schema, xml)) {
      if (onDescarte) {
        const ehEvento = tipoAuditoria === 'PROC_EVENTO_NFE' || tipoAuditoria === 'RES_EVENTO';
        onDescarte({
          nsu,
          schema,
          tipo: ehEvento ? 'EVENTO' : 'PARSER',
          resultado: ehEvento ? 'EVENTO' : 'ERRO_SCHEMA',
          motivo: ehEvento
            ? `Evento DF-e (${tipoAuditoria}) — processar efeito fiscal se aplicável`
            : `Schema/XML não reconhecido como NF-e (${schema || tipoAuditoria})`,
          tempoMs: tempoZipMs,
          tamanhoZip,
          chave: xml.match(/Id="NFe(\d{44})"/i)?.[1]
            || xml.match(/<chNFe>(\d{44})<\/chNFe>/i)?.[1]
            || null,
          xml: ehEvento ? xml : undefined
        });
      }
      continue;
    }

    documentos.push({
      nsu,
      schema,
      xml,
      compactado,
      tipoAuditoria,
      tempoZipMs,
      tamanhoZip
    });
  }

  return documentos;
}

/**
 * @param {string} cStat
 * @returns {boolean}
 */
function retornoDistSucesso(cStat) {
  return ['137', '138', '656'].includes(String(cStat));
}

module.exports = {
  NSU_ZERADO,
  normalizarNsu,
  normalizarNsuOuZero,
  nsuMenorQue,
  extrairNsuTagDoXml,
  extrairMetadadosRetorno,
  extrairDocumentosZip,
  isDocumentoNotaFiscal,
  classificarSchemaAuditoria,
  retornoDistSucesso,
  salvarXmlRetorno656
};
