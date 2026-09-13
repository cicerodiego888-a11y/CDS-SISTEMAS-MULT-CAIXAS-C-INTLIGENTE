/**
 * Extrai CST/CSOSN e origem do nó imposto da NF-e (xml2js).
 * @param {Object} imposto
 * @returns {{ csosn: string, cst: string, origem: number|null, cst_pis: string, cst_cofins: string, cst_ipi: string }}
 */
function extrairTributosItemNfe(imposto = {}) {
  const result = {
    csosn: '',
    cst: '',
    origem: null,
    cst_pis: '',
    cst_cofins: '',
    cst_ipi: ''
  };

  const icmsRoot = imposto?.ICMS;
  if (icmsRoot && typeof icmsRoot === 'object') {
    const grupo = Object.values(icmsRoot).find((v) => v && typeof v === 'object') || {};
    result.csosn = String(grupo.CSOSN || grupo.csosn || '').trim();
    result.cst = String(grupo.CST || grupo.cst || '').trim();
    if (grupo.orig != null && grupo.orig !== '') {
      const o = parseInt(grupo.orig, 10);
      if (Number.isFinite(o)) result.origem = o;
    }
  }

  const pisRoot = imposto?.PIS;
  if (pisRoot && typeof pisRoot === 'object') {
    const grupo = Object.values(pisRoot).find((v) => v && typeof v === 'object') || {};
    result.cst_pis = String(grupo.CST || grupo.cst || '').trim();
  }

  const cofinsRoot = imposto?.COFINS;
  if (cofinsRoot && typeof cofinsRoot === 'object') {
    const grupo = Object.values(cofinsRoot).find((v) => v && typeof v === 'object') || {};
    result.cst_cofins = String(grupo.CST || grupo.cst || '').trim();
  }

  const ipiRoot = imposto?.IPI;
  if (ipiRoot && typeof ipiRoot === 'object') {
    const trib = ipiRoot.IPITrib || ipiRoot.IPINT || Object.values(ipiRoot).find((v) => v && typeof v === 'object') || {};
    result.cst_ipi = String(trib.CST || trib.cst || '').trim();
  }

  return result;
}

module.exports = { extrairTributosItemNfe };
