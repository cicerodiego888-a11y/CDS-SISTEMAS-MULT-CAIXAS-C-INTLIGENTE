/**
 * Resolução do grupo ICMS da NF-e de devolução pelo CRT do EMITENTE.
 * Espelha valores da NF original, mas não copia CST/CSOSN nem o grupo quando
 * incompatíveis com o regime de quem emite a devolução.
 */

'use strict';

const { formatNumber } = require('./utils');

function crtNumero(crt) {
  const n = Number(String(crt == null ? '' : crt).trim());
  return Number.isFinite(n) ? n : 0;
}

function emitenteSimplesNacional(crt) {
  const n = crtNumero(crt);
  return n === 1 || n === 4;
}

function soDigitos(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

function cst2(v) {
  const d = soDigitos(v);
  return d ? d.padStart(2, '0').slice(-2) : '';
}

function csosn3(v) {
  const d = soDigitos(v);
  return d ? d.padStart(3, '0').slice(-3) : '';
}

function temCampo(icms, keys) {
  return keys.some((k) => icms && icms[k] != null && icms[k] !== '');
}

const CAMPOS_ICMS_ORDEM = [
  ['modBC', 0], ['pRedBC', 4], ['vBC', 2], ['pICMS', 4], ['vICMS', 2],
  ['modBCST', 0], ['pMVAST', 4], ['pRedBCST', 4], ['vBCST', 2], ['pICMSST', 4], ['vICMSST', 2],
  ['vBCSTRet', 2], ['pST', 4], ['vICMSSubstituto', 2], ['vICMSSTRet', 2],
  ['pCredSN', 4], ['vCredICMSSN', 2],
  ['motDesICMS', 0], ['vICMSDeson', 2],
  ['vBCFCP', 2], ['pFCP', 4], ['vFCP', 2],
  ['vBCFCPST', 2], ['pFCPST', 4], ['vFCPST', 2],
  ['vBCFCPSTRet', 2], ['pFCPSTRet', 4], ['vFCPSTRet', 2]
];

const CAMPOS_POR_GRUPO_SN = {
  ICMSSN101: ['orig', 'CSOSN', 'pCredSN', 'vCredICMSSN'],
  ICMSSN102: ['orig', 'CSOSN'],
  ICMSSN201: [
    'orig', 'CSOSN', 'modBCST', 'pMVAST', 'pRedBCST', 'vBCST', 'pICMSST', 'vICMSST',
    'vBCFCPST', 'pFCPST', 'vFCPST', 'pCredSN', 'vCredICMSSN'
  ],
  ICMSSN202: [
    'orig', 'CSOSN', 'modBCST', 'pMVAST', 'pRedBCST', 'vBCST', 'pICMSST', 'vICMSST',
    'vBCFCPST', 'pFCPST', 'vFCPST'
  ],
  ICMSSN203: [
    'orig', 'CSOSN', 'modBCST', 'pMVAST', 'pRedBCST', 'vBCST', 'pICMSST', 'vICMSST',
    'vBCFCPST', 'pFCPST', 'vFCPST'
  ],
  ICMSSN300: ['orig', 'CSOSN'],
  ICMSSN400: ['orig', 'CSOSN'],
  ICMSSN500: [
    'orig', 'CSOSN', 'vBCSTRet', 'pST', 'vICMSSubstituto', 'vICMSSTRet',
    'vBCFCPSTRet', 'pFCPSTRet', 'vFCPSTRet'
  ],
  ICMSSN900: null
};

function grupoIcmsSimples(csosn) {
  const s = csosn3(csosn);
  if (s === '101') return 'ICMSSN101';
  if (s === '102' || s === '103') return 'ICMSSN102';
  if (s === '201') return 'ICMSSN201';
  if (s === '202') return 'ICMSSN202';
  if (s === '203') return 'ICMSSN203';
  if (s === '300') return 'ICMSSN300';
  if (s === '400') return 'ICMSSN400';
  if (s === '500') return 'ICMSSN500';
  return 'ICMSSN900';
}

function grupoIcmsNormal(cst) {
  const c = cst2(cst);
  if (['40', '41', '50'].includes(c)) return 'ICMS40';
  if (['00', '10', '20', '30', '51', '60', '70', '90'].includes(c)) return `ICMS${c}`;
  return 'ICMS90';
}

function camposIcmsInformados(icms) {
  if (!icms) return [];
  return CAMPOS_ICMS_ORDEM
    .map(([campo]) => campo)
    .filter((campo) => icms[campo] != null && icms[campo] !== '');
}

function grupoSnCompativel(grupo, icms) {
  const permitidos = CAMPOS_POR_GRUPO_SN[grupo];
  if (!permitidos) return true;
  const set = new Set(permitidos);
  return camposIcmsInformados(icms).every((c) => set.has(c));
}

function mapearCstParaCsosn(cst, icms) {
  const c = cst2(cst);
  const hasCred = temCampo(icms, ['pCredSN', 'vCredICMSSN']);
  const hasST = temCampo(icms, ['vBCST', 'vICMSST', 'pICMSST', 'pMVAST']);
  const hasSTRet = temCampo(icms, ['vBCSTRet', 'vICMSSTRet', 'vICMSSubstituto']);
  const hasTrib = temCampo(icms, ['vBC', 'pICMS', 'vICMS', 'pRedBC', 'vFCP']);

  switch (c) {
    case '00':
      return hasCred ? '101' : '102';
    case '10':
      return hasCred ? '201' : (hasST ? '202' : '900');
    case '20':
      return '102';
    case '30':
      return '203';
    case '40':
      return '400';
    case '41':
      return '300';
    case '50':
      return '400';
    case '51':
      return '900';
    case '60':
      return hasSTRet || hasST ? '500' : '500';
    case '70':
      return hasST ? '202' : '900';
    case '90':
      return '900';
    default:
      if (hasSTRet) return '500';
      if (hasST) return '202';
      if (hasCred) return '101';
      if (hasTrib) return '102';
      return '102';
  }
}

function mapearCsosnParaCst(csosn) {
  const s = csosn3(csosn);
  switch (s) {
    case '101':
      return '00';
    case '102':
    case '103':
      return '40';
    case '201':
    case '202':
      return '10';
    case '203':
      return '30';
    case '300':
      return '41';
    case '400':
      return '40';
    case '500':
      return '60';
    case '900':
      return '90';
    default:
      return '90';
  }
}

function tag(nome, valor, casas = 2) {
  if (valor == null || valor === '') return '';
  if (typeof valor === 'number') {
    return `<${nome}>${formatNumber(valor, casas)}</${nome}>`;
  }
  return `<${nome}>${valor}</${nome}>`;
}

function montarIcmsXmlResolvido(resolucao) {
  const grupo = resolucao.grupoIcms;
  const icms = resolucao.icms || {};
  const orig = String(
    resolucao.origem != null && resolucao.origem !== ''
      ? resolucao.origem
      : (icms.orig != null ? icms.orig : '0')
  );
  const tags = [tag('orig', orig, 0)];
  if (resolucao.regime === 'simples') {
    tags.push(tag('CSOSN', resolucao.csosn, 0));
  } else {
    tags.push(tag('CST', resolucao.cst, 0));
  }

  const permitidos = resolucao.regime === 'simples'
    ? CAMPOS_POR_GRUPO_SN[grupo]
    : null;
  const setPermitidos = permitidos ? new Set(permitidos) : null;

  for (const [campo, casas] of CAMPOS_ICMS_ORDEM) {
    if (icms[campo] == null || icms[campo] === '') continue;
    if (setPermitidos && !setPermitidos.has(campo)) continue;
    tags.push(tag(campo, icms[campo], casas));
  }

  return `<ICMS><${grupo}>${tags.join('')}</${grupo}></ICMS>`;
}

function substituirIcmsNoImpostoXml(impostoXml, icmsXmlNovo) {
  const origem = String(impostoXml || '');
  if (/<ICMS>[\s\S]*?<\/ICMS>/.test(origem)) {
    return origem.replace(/<ICMS>[\s\S]*?<\/ICMS>/, icmsXmlNovo);
  }
  return `${icmsXmlNovo}${origem}`;
}

/**
 * Decide CST/CSOSN e grupo ICMS a partir do CRT do emitente.
 */
function resolverIcmsPorCrtEmitente({
  crt,
  cst,
  csosn,
  grupoIcms,
  icms,
  origem
} = {}) {
  const crtN = crtNumero(crt);
  const icmsObj = icms && typeof icms === 'object' ? { ...icms } : {};
  const cstOriginal = cst2(cst || icmsObj.CST);
  const csosnOriginal = csosn3(csosn || icmsObj.CSOSN);
  const orig = origem != null && origem !== ''
    ? origem
    : (icmsObj.orig != null ? icmsObj.orig : '0');

  if (emitenteSimplesNacional(crtN)) {
    let csosnEfetivo = csosnOriginal || mapearCstParaCsosn(cstOriginal, icmsObj) || '102';
    let grupo = grupoIcmsSimples(csosnEfetivo);
    if (!grupoSnCompativel(grupo, icmsObj)) {
      csosnEfetivo = '900';
      grupo = 'ICMSSN900';
    }
    return {
      crt: crtN,
      regime: 'simples',
      regraAplicada: 'crt_simples_csosn',
      cstOriginal: cstOriginal || null,
      csosnOriginal: csosnOriginal || null,
      cst: null,
      csosn: csosnEfetivo,
      grupoIcms: grupo,
      grupoIcmsOriginal: grupoIcms || null,
      origem: orig,
      icms: { ...icmsObj, CST: undefined, CSOSN: csosnEfetivo, orig }
    };
  }

  let cstEfetivo = cstOriginal;
  if (!cstEfetivo && csosnOriginal) {
    cstEfetivo = mapearCsosnParaCst(csosnOriginal);
  }
  if (!cstEfetivo) cstEfetivo = '90';
  const grupo = grupoIcmsNormal(cstEfetivo);

  return {
    crt: crtN,
    regime: 'normal',
    regraAplicada: 'crt_normal_cst',
    cstOriginal: cstOriginal || null,
    csosnOriginal: csosnOriginal || null,
    cst: cstEfetivo,
    csosn: null,
    grupoIcms: grupo,
    grupoIcmsOriginal: grupoIcms || null,
    origem: orig,
    icms: { ...icmsObj, CSOSN: undefined, CST: cstEfetivo, orig }
  };
}

function mensagemCrtIncompativel({ crt, grupo, cst, csosn, item, produto } = {}) {
  if (emitenteSimplesNacional(crt)) {
    return (
      'XML fiscal inválido: emitente enquadrado no Simples Nacional não pode utilizar CST de regime normal no grupo ICMS.\n' +
      `CRT: ${crt == null || crt === '' ? '—' : crt}\n` +
      `Item: ${item != null && item !== '' ? item : '—'}\n` +
      `Produto: ${produto || '—'}\n` +
      `Grupo ICMS encontrado: ${grupo || '—'}\n` +
      `CST encontrado: ${cst || '—'}`
    );
  }
  return (
    'Tributação ICMS incompatível com o regime do emitente.\n' +
    `CRT do emitente: ${crt == null || crt === '' ? '—' : crt}\n` +
    `Grupo ICMS no XML: ${grupo || '—'}\n` +
    `CST: ${cst || '—'}\n` +
    `CSOSN: ${csosn || '—'}\n` +
    'Emitente do regime normal (CRT=3) não pode informar CSOSN de Simples Nacional.'
  );
}

function extrairBlocosIcms(xml) {
  const blocos = [];
  const re = /<ICMS>([\s\S]*?)<\/ICMS>/g;
  let m;
  while ((m = re.exec(String(xml || ''))) !== null) {
    blocos.push(m[1]);
  }
  return blocos;
}

function nomeGrupoIcms(bloco) {
  const sn = String(bloco || '').match(/<(ICMSSN\d{3})>/);
  if (sn) return sn[1];
  const nor = String(bloco || '').match(/<(ICMS\d{2})>/);
  return nor ? nor[1] : null;
}

function tagLocal(xml, name) {
  const m = String(xml || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  return m ? m[1] : null;
}

function validarIcmsXmlContraCrt(xml, crtInformado) {
  const crtXml = tagLocal(String(xml || '').match(/<emit>[\s\S]*?<\/emit>/)?.[0] || '', 'CRT');
  const crt = crtInformado != null && String(crtInformado).trim() !== ''
    ? crtNumero(crtInformado)
    : crtNumero(crtXml);

  const simples = emitenteSimplesNacional(crt);
  const dets = [];
  const reDet = /<det\s+nItem="(\d+)">([\s\S]*?)<\/det>/g;
  let mDet;
  while ((mDet = reDet.exec(String(xml || ''))) !== null) {
    dets.push({ nItem: mDet[1], body: mDet[2] });
  }

  const alvos = dets.length
    ? dets.map((d) => ({
      item: d.nItem,
      produto: tagLocal(d.body, 'xProd') || '—',
      bloco: (d.body.match(/<ICMS>([\s\S]*?)<\/ICMS>/) || [])[1] || ''
    }))
    : extrairBlocosIcms(xml).map((bloco) => ({ item: '—', produto: '—', bloco }));

  if (!alvos.length || alvos.every((a) => !a.bloco)) {
    const erro = new Error('Grupo ICMS ausente no XML da NF-e.');
    erro.code = 'ICMS_AUSENTE';
    erro.statusCode = 400;
    throw erro;
  }

  for (const alvo of alvos) {
    const grupo = nomeGrupoIcms(alvo.bloco);
    const cst = tagLocal(alvo.bloco, 'CST');
    const csosn = tagLocal(alvo.bloco, 'CSOSN');
    const grupoNormal = grupo && /^ICMS\d{2}$/.test(grupo);
    const grupoSn = grupo && /^ICMSSN\d{3}$/.test(grupo);

    const incompativel = simples
      ? (!!cst || grupoNormal || !grupoSn)
      : (!!csosn || grupoSn || !grupoNormal);

    if (incompativel) {
      const erro = new Error(mensagemCrtIncompativel({
        crt,
        grupo,
        cst,
        csosn,
        item: alvo.item,
        produto: alvo.produto
      }));
      erro.code = 'ICMS_CRT_INCOMPATIVEL';
      erro.statusCode = 400;
      erro.detalhes = {
        crt,
        item: alvo.item,
        produto: alvo.produto,
        grupoIcms: grupo,
        cst,
        csosn
      };
      throw erro;
    }
  }
  return true;
}

function adaptarImpostoEspelhadoAoCrt(item, crt) {
  const t = item && item.tributosEspelhados ? item.tributosEspelhados : {};
  const resolucao = resolverIcmsPorCrtEmitente({
    crt,
    cst: t.cst || item.cst,
    csosn: t.csosn || item.csosn,
    grupoIcms: t.grupoIcms || item.grupoIcms,
    icms: t.icms,
    origem: t.origem != null ? t.origem : item.origem
  });
  const icmsXml = montarIcmsXmlResolvido(resolucao);
  const xmlBruto = item && item.impostoEspelhadoXml;
  return {
    ...item,
    impostoEspelhadoXml: xmlBruto
      ? substituirIcmsNoImpostoXml(xmlBruto, icmsXml)
      : icmsXml,
    resolucaoIcms: resolucao
  };
}

function resumoResolucaoIcms(resolucao, extra = {}) {
  return {
    item: extra.item != null ? extra.item : null,
    produto: extra.produto || null,
    crtEmitente: String(resolucao.crt),
    grupoOriginal: resolucao.grupoIcmsOriginal,
    cstOriginal: resolucao.cstOriginal,
    csosnOriginal: resolucao.csosnOriginal,
    regraAplicada: resolucao.regraAplicada,
    csosnFinal: resolucao.csosn,
    cstFinal: resolucao.cst,
    grupoFinal: resolucao.grupoIcms,
    grupoIcms: resolucao.grupoIcms,
    csosnEfetivo: resolucao.csosn,
    cstEfetivo: resolucao.cst,
    regime: resolucao.regime
  };
}

module.exports = {
  emitenteSimplesNacional,
  resolverIcmsPorCrtEmitente,
  montarIcmsXmlResolvido,
  substituirIcmsNoImpostoXml,
  validarIcmsXmlContraCrt,
  adaptarImpostoEspelhadoAoCrt,
  resumoResolucaoIcms,
  mapearCstParaCsosn,
  mapearCsosnParaCst,
  grupoIcmsSimples,
  grupoIcmsNormal,
  mensagemCrtIncompativel
};
