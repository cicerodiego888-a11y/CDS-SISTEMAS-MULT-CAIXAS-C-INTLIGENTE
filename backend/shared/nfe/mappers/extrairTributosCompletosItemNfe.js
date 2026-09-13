/**
 * Extrai tributação completa do nó <imposto> (xml2js) — item a item.
 * Não inventa valores: só lê o que existir na NF-e original.
 */

'use strict';

function asObj(v) {
  if (!v || typeof v !== 'object') return null;
  return Array.isArray(v) ? (v[0] || null) : v;
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function strOrEmpty(v) {
  return v == null ? '' : String(v).trim();
}

function primeiroGrupo(root) {
  const obj = asObj(root);
  if (!obj) return { nome: null, grupo: null };
  const keys = Object.keys(obj).filter((k) => k !== '$');
  if (!keys.length) return { nome: null, grupo: null };
  const nome = keys[0];
  return { nome, grupo: asObj(obj[nome]) };
}

const CAMPOS_TEXTO = new Set([
  'orig', 'CST', 'CSOSN', 'modBC', 'modBCST', 'motDesICMS', 'cEnq'
]);

function lerCampos(grupo, campos) {
  const out = {};
  if (!grupo) return out;
  for (const c of campos) {
    if (grupo[c] == null || grupo[c] === '') continue;
    if (CAMPOS_TEXTO.has(c)) {
      out[c] = strOrEmpty(grupo[c]);
      continue;
    }
    const n = numOrNull(grupo[c]);
    if (n != null) out[c] = n;
    else out[c] = strOrEmpty(grupo[c]);
  }
  return out;
}

const CAMPOS_ICMS = [
  'orig', 'CST', 'CSOSN', 'modBC', 'vBC', 'pICMS', 'vICMS', 'pRedBC',
  'modBCST', 'pMVAST', 'pRedBCST', 'vBCST', 'pICMSST', 'vICMSST',
  'vBCSTRet', 'pST', 'vICMSSubstituto', 'vICMSSTRet',
  'pCredSN', 'vCredICMSSN', 'motDesICMS', 'vICMSDeson',
  'vBCFCP', 'pFCP', 'vFCP', 'vBCFCPST', 'pFCPST', 'vFCPST',
  'vBCFCPSTRet', 'pFCPSTRet', 'vFCPSTRet',
  'pFCPDif', 'vFCPDif', 'vFCPEfet', 'pFCPEfet', 'vBCEfet', 'pICMSEfet', 'vICMSEfet'
];

const CAMPOS_IPI = ['CST', 'vBC', 'pIPI', 'vIPI', 'qUnid', 'vUnid'];
const CAMPOS_PIS = ['CST', 'vBC', 'pPIS', 'vPIS', 'qBCProd', 'vAliqProd'];
const CAMPOS_COFINS = ['CST', 'vBC', 'pCOFINS', 'vCOFINS', 'qBCProd', 'vAliqProd'];
const CAMPOS_DIFAL = [
  'vBCUFDest', 'vBCFCPUFDest', 'pFCPUFDest', 'pICMSUFDest',
  'pICMSInter', 'pICMSInterPart', 'vFCPUFDest', 'vICMSUFDest', 'vICMSUFRemet'
];

/**
 * @param {Object} imposto — nó imposto (xml2js)
 * @returns {object}
 */
function extrairTributosCompletosItemNfe(imposto = {}) {
  const result = {
    origem: null,
    cst: '',
    csosn: '',
    grupoIcms: null,
    icms: null,
    ipi: null,
    pis: null,
    cofins: null,
    difal: null,
    existe: {
      icms: false,
      ipi: false,
      pis: false,
      cofins: false,
      st: false,
      fcp: false,
      difal: false
    }
  };

  const { nome: grupoIcms, grupo: icmsGrupo } = primeiroGrupo(imposto.ICMS);
  if (icmsGrupo) {
    result.grupoIcms = grupoIcms;
    const campos = lerCampos(icmsGrupo, CAMPOS_ICMS);
    result.origem = campos.orig != null ? String(campos.orig) : null;
    result.cst = strOrEmpty(campos.CST);
    if (result.cst !== '' && /^\d+$/.test(result.cst)) {
      result.cst = result.cst.padStart(2, '0').slice(-2);
    }
    result.csosn = strOrEmpty(campos.CSOSN);
    if (result.csosn !== '' && /^\d+$/.test(result.csosn)) {
      result.csosn = result.csosn.padStart(3, '0').slice(-3);
    }
    if (campos.CST != null) campos.CST = result.cst;
    if (campos.CSOSN != null) campos.CSOSN = result.csosn;
    result.icms = campos;
    result.existe.icms = true;
    result.existe.st = ['vBCST', 'vICMSST', 'vBCSTRet', 'vICMSSTRet'].some((k) => campos[k] != null);
    result.existe.fcp = ['vFCP', 'vFCPST', 'vFCPSTRet', 'pFCP'].some((k) => campos[k] != null);
  }

  const ipiRoot = asObj(imposto.IPI);
  if (ipiRoot) {
    const trib = asObj(ipiRoot.IPITrib) || asObj(ipiRoot.IPINT) || null;
    const { nome, grupo } = trib
      ? { nome: ipiRoot.IPITrib ? 'IPITrib' : 'IPINT', grupo: trib }
      : primeiroGrupo({ IPITrib: ipiRoot.IPITrib, IPINT: ipiRoot.IPINT });
    const g = grupo || lerCampos(ipiRoot, CAMPOS_IPI);
    const campos = { ...lerCampos(g, CAMPOS_IPI), cEnq: strOrEmpty(ipiRoot.cEnq) || '999' };
    if (campos.CST || campos.vIPI != null || campos.vBC != null) {
      result.ipi = { ...campos, grupo: nome || (ipiRoot.IPINT ? 'IPINT' : 'IPITrib') };
      result.existe.ipi = true;
    }
  }

  const { nome: pisNome, grupo: pisGrupo } = primeiroGrupo(imposto.PIS);
  if (pisGrupo) {
    result.pis = { ...lerCampos(pisGrupo, CAMPOS_PIS), grupo: pisNome };
    result.existe.pis = true;
  }

  const { nome: cofNome, grupo: cofGrupo } = primeiroGrupo(imposto.COFINS);
  if (cofGrupo) {
    result.cofins = { ...lerCampos(cofGrupo, CAMPOS_COFINS), grupo: cofNome };
    result.existe.cofins = true;
  }

  const difal = asObj(imposto.ICMSUFDest);
  if (difal) {
    result.difal = lerCampos(difal, CAMPOS_DIFAL);
    result.existe.difal = Object.keys(result.difal).length > 0;
  }

  return result;
}

/**
 * Extrai produto + tributos de um <det> (xml2js).
 */
function extrairDetCompleto(det, indice = 0) {
  const prod = asObj(det?.prod) || {};
  const imposto = asObj(det?.imposto) || {};
  const trib = extrairTributosCompletosItemNfe(imposto);
  const nItem = Number(det?.$?.nItem || indice + 1);

  return {
    nItem,
    cProd: strOrEmpty(prod.cProd),
    cEAN: strOrEmpty(prod.cEAN || prod.cEANTrib),
    xProd: strOrEmpty(prod.xProd),
    NCM: strOrEmpty(prod.NCM),
    CEST: strOrEmpty(prod.CEST),
    CFOP: strOrEmpty(prod.CFOP),
    uCom: strOrEmpty(prod.uCom) || 'UN',
    qCom: numOrNull(prod.qCom) || 0,
    vUnCom: numOrNull(prod.vUnCom) || 0,
    vProd: numOrNull(prod.vProd) || 0,
    uTrib: strOrEmpty(prod.uTrib) || strOrEmpty(prod.uCom) || 'UN',
    qTrib: numOrNull(prod.qTrib) != null ? numOrNull(prod.qTrib) : (numOrNull(prod.qCom) || 0),
    vUnTrib: numOrNull(prod.vUnTrib) != null ? numOrNull(prod.vUnTrib) : (numOrNull(prod.vUnCom) || 0),
    vFrete: numOrNull(prod.vFrete) || 0,
    vSeg: numOrNull(prod.vSeg) || 0,
    vDesc: numOrNull(prod.vDesc) || 0,
    vOutro: numOrNull(prod.vOutro) || 0,
    tributos: trib
  };
}

module.exports = {
  extrairTributosCompletosItemNfe,
  extrairDetCompleto,
  numOrNull,
  strOrEmpty
};
