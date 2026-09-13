/**
 * RC3.16.3 — Parser oficial do retorno de autorização NF-e (modelo 55).
 *
 * Regra MOC:
 * - cStat do lote (retEnviNFe) NÃO é o resultado final da nota.
 * - Resultado oficial vem de protNFe/infProt (cStat, xMotivo, nProt, dhRecbto, chNFe).
 * - Só permanece "aguardando_retorno" quando o lote foi aceito (103/104/105) SEM infProt.
 */

'use strict';

const NOME_DEST_HOMOLOGACAO =
  'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

function tag(xml, name) {
  const m = String(xml || '').match(new RegExp(`<${name}[^>]*>\\s*([^<]*)\\s*</${name}>`, 'i'));
  return m ? String(m[1]).trim() : null;
}

/**
 * Extrai bloco infProt (primeiro protNFe/infProt encontrado).
 * @param {string} xml
 * @returns {string|null}
 */
function extrairBlocoInfProt(xml) {
  const texto = String(xml || '');
  const prot = texto.match(/<protNFe[\s\S]*?<infProt[\s\S]*?<\/infProt>[\s\S]*?<\/protNFe>/i);
  if (prot) {
    const inf = prot[0].match(/<infProt[\s\S]*?<\/infProt>/i);
    return inf ? inf[0] : prot[0];
  }
  const inf = texto.match(/<infProt[\s\S]*?<\/infProt>/i);
  return inf ? inf[0] : null;
}

/**
 * cStat do lote (retEnviNFe / retConsReciNFe), se houver.
 * @param {string} xml
 * @returns {string|null}
 */
function extrairCStatLote(xml) {
  const texto = String(xml || '');
  const retEnvi = texto.match(/<retEnviNFe[\s\S]*?<\/retEnviNFe>/i);
  if (retEnvi) {
    const c = retEnvi[0].match(/<cStat>\s*(\d+)\s*<\/cStat>/i);
    if (c) return c[1];
  }
  const retReci = texto.match(/<retConsReciNFe[\s\S]*?<\/retConsReciNFe>/i);
  if (retReci) {
    // Preferir cStat do cabeçalho do recibo (antes do primeiro protNFe)
    const head = retReci[0].split(/<protNFe/i)[0] || retReci[0];
    const c = head.match(/<cStat>\s*(\d+)\s*<\/cStat>/i);
    if (c) return c[1];
  }
  return null;
}

/**
 * Parse completo do retorno SEFAZ de autorização.
 * @param {string} xmlRetorno
 * @returns {{
 *   cStatLote: string|null,
 *   xMotivoLote: string|null,
 *   temInfProt: boolean,
 *   cStat: string|null,
 *   xMotivo: string|null,
 *   nProt: string|null,
 *   dhRecbto: string|null,
 *   chNFe: string|null,
 *   recibo: string|null,
 *   status: 'autorizada'|'rejeitada'|'denegada'|'aguardando_retorno'|'erro_transmissao',
 *   sucesso: boolean
 * }}
 */
function parseRetornoAutorizacaoNfe(xmlRetorno) {
  // RC3.16.11 — TRACE
  try {
    const { traceNfe } = require('./nfeTrace');
    traceNfe('parseRetornoAutorizacaoNfe', {
      bytes: Buffer.byteLength(String(xmlRetorno || ''), 'utf8')
    });
  } catch (_) { /* ignore */ }

  const raw = String(xmlRetorno || '');
  if (!raw.trim()) {
    return {
      cStatLote: null,
      xMotivoLote: null,
      temInfProt: false,
      cStat: null,
      xMotivo: null,
      nProt: null,
      dhRecbto: null,
      chNFe: null,
      recibo: null,
      status: 'erro_transmissao',
      sucesso: false
    };
  }

  const cStatLote = extrairCStatLote(raw);
  let xMotivoLote = null;
  const retEnvi = raw.match(/<retEnviNFe[\s\S]*?<\/retEnviNFe>/i);
  if (retEnvi) {
    xMotivoLote = tag(retEnvi[0].split(/<protNFe/i)[0] || retEnvi[0], 'xMotivo');
  }

  const recibo = tag(raw, 'nRec');
  const infProt = extrairBlocoInfProt(raw);
  const temInfProt = Boolean(infProt);

  let cStat = null;
  let xMotivo = null;
  let nProt = null;
  let dhRecbto = null;
  let chNFe = null;

  if (temInfProt) {
    cStat = tag(infProt, 'cStat');
    xMotivo = tag(infProt, 'xMotivo');
    nProt = tag(infProt, 'nProt');
    dhRecbto = tag(infProt, 'dhRecbto');
    chNFe = tag(infProt, 'chNFe');
  }

  let status = 'rejeitada';
  if (temInfProt) {
    if (cStat === '100' || cStat === '150') status = 'autorizada';
    else if (cStat === '110' || cStat === '301' || cStat === '302') status = 'denegada';
    else status = 'rejeitada';
  } else if (cStatLote === '103' || cStatLote === '104' || cStatLote === '105') {
    // 103 = lote recebido; 104/105 = processado / em processamento — ainda sem protocolo da nota
    status = 'aguardando_retorno';
    cStat = cStatLote;
    xMotivo = xMotivoLote
      || (cStatLote === '103'
        ? 'Lote recebido com sucesso'
        : (cStatLote === '105' ? 'Lote em processamento' : 'Lote processado'));
  } else if (cStatLote) {
    // Rejeição no próprio lote (sem infProt)
    status = 'rejeitada';
    cStat = cStatLote;
    xMotivo = xMotivoLote;
  } else if (/<cStat>\s*100\s*<\/cStat>/i.test(raw)) {
    // Fallback: cStat 100 em qualquer lugar (consulta protocolo)
    cStat = '100';
    xMotivo = tag(raw, 'xMotivo');
    nProt = nProt || tag(raw, 'nProt');
    chNFe = chNFe || tag(raw, 'chNFe');
    dhRecbto = dhRecbto || tag(raw, 'dhRecbto');
    status = 'autorizada';
  } else {
    const any = raw.match(/<cStat>\s*(\d+)\s*<\/cStat>/i);
    cStat = any ? any[1] : null;
    xMotivo = tag(raw, 'xMotivo');
    status = cStat ? 'rejeitada' : 'erro_transmissao';
  }

  return {
    cStatLote,
    xMotivoLote,
    temInfProt,
    cStat,
    xMotivo,
    nProt,
    dhRecbto,
    chNFe,
    recibo,
    status,
    sucesso: status === 'autorizada'
  };
}

/**
 * Nome do destinatário exigido pela SEFAZ em homologação (tpAmb=2).
 * Em produção (tpAmb=1) retorna o nome informado.
 */
function resolverNomeDestinatarioNfe(ambiente, nomeInformado) {
  const tpAmb = Number(ambiente) === 1 ? 1 : 2;
  if (tpAmb === 2) return NOME_DEST_HOMOLOGACAO;
  const nome = String(nomeInformado || '').trim();
  return nome || 'DESTINATARIO NAO INFORMADO';
}

module.exports = {
  NOME_DEST_HOMOLOGACAO,
  parseRetornoAutorizacaoNfe,
  extrairBlocoInfProt,
  extrairCStatLote,
  resolverNomeDestinatarioNfe
};
