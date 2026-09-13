/**
 * RC2 — Espelhamento fiscal da NF-e original na devolução de compra.
 * Não altera pipeline de emissão (sign/SOAP/DANFE).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const xml2js = require('xml2js');
const db = require('../../database');
const { getFiscalSubDir, getFiscalDir } = require('./paths');
const { formatNumber } = require('./utils');
const {
  extrairDetCompleto,
  numOrNull
} = require('../../shared/nfe/mappers/extrairTributosCompletosItemNfe');
const NFeParser = require('../../shared/nfe/NFeParser');

const parseString = promisify(xml2js.parseString);

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function round2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function round4(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

function tag(nome, valor, casas = 2) {
  if (valor == null || valor === '') return '';
  if (typeof valor === 'number') {
    return `<${nome}>${formatNumber(valor, casas)}</${nome}>`;
  }
  return `<${nome}>${valor}</${nome}>`;
}

function escalaMonetarios(obj, fator, camposMonetarios, camposPerc = []) {
  if (!obj) return null;
  const out = { ...obj };
  for (const c of camposMonetarios) {
    if (out[c] != null && typeof out[c] === 'number') {
      out[c] = round2(out[c] * fator);
    }
  }
  for (const c of camposPerc) {
    if (out[c] != null && typeof out[c] === 'number') {
      out[c] = round4(out[c]);
    }
  }
  return out;
}

const ICMS_MONEY = [
  'vBC', 'vICMS', 'vICMSDeson', 'vBCST', 'vICMSST', 'vBCSTRet', 'vICMSSTRet',
  'vICMSSubstituto', 'vCredICMSSN', 'vBCFCP', 'vFCP', 'vBCFCPST', 'vFCPST',
  'vBCFCPSTRet', 'vFCPSTRet', 'vFCPDif', 'vFCPEfet', 'vBCEfet', 'vICMSEfet'
];
const ICMS_PERC = [
  'pICMS', 'pRedBC', 'pMVAST', 'pRedBCST', 'pICMSST', 'pST', 'pCredSN',
  'pFCP', 'pFCPST', 'pFCPSTRet', 'pFCPDif', 'pFCPEfet', 'pICMSEfet'
];
const IPI_MONEY = ['vBC', 'vIPI'];
const IPI_PERC = ['pIPI'];
const PIS_MONEY = ['vBC', 'vPIS'];
const PIS_PERC = ['pPIS', 'vAliqProd'];
const COFINS_MONEY = ['vBC', 'vCOFINS'];
const COFINS_PERC = ['pCOFINS', 'vAliqProd'];
const DIFAL_MONEY = ['vBCUFDest', 'vBCFCPUFDest', 'vFCPUFDest', 'vICMSUFDest', 'vICMSUFRemet'];
const DIFAL_PERC = ['pFCPUFDest', 'pICMSUFDest', 'pICMSInter', 'pICMSInterPart'];

/**
 * Carrega XML da NF-e original da compra (Central → legado → disco).
 */
async function carregarXmlNfeCompraOrigem({ compraId, chave }) {
  const chaveLimpa = String(chave || '').replace(/\D/g, '');
  const id = Number(compraId) || 0;

  if (id) {
    const porCompra = await dbGet(
      `SELECT xml, chave FROM central_entradas_documentos
       WHERE compra_id = ? AND xml IS NOT NULL AND length(trim(xml)) > 100
       ORDER BY id DESC LIMIT 1`,
      [id]
    );
    if (porCompra?.xml) {
      return { xml: String(porCompra.xml), fonte: 'central_compra_id', chave: porCompra.chave || chaveLimpa };
    }
  }

  if (chaveLimpa.length === 44) {
    const porChave = await dbGet(
      `SELECT xml, chave FROM central_entradas_documentos
       WHERE REPLACE(chave, ' ', '') = ? AND xml IS NOT NULL AND length(trim(xml)) > 100
       LIMIT 1`,
      [chaveLimpa]
    );
    if (porChave?.xml) {
      return { xml: String(porChave.xml), fonte: 'central_chave', chave: chaveLimpa };
    }

    const dfe = await dbGet('SELECT xml FROM notas_recebidas_dfe WHERE chave = ? LIMIT 1', [chaveLimpa]);
    if (dfe?.xml) return { xml: String(dfe.xml), fonte: 'notas_recebidas_dfe', chave: chaveLimpa };

    const recebida = await dbGet('SELECT xml FROM notas_recebidas WHERE chave = ? LIMIT 1', [chaveLimpa]);
    if (recebida?.xml) return { xml: String(recebida.xml), fonte: 'notas_recebidas', chave: chaveLimpa };
  }

  const pastas = [
    getFiscalSubDir('xml/entradas'),
    getFiscalSubDir('xml'),
    getFiscalSubDir('entradas'),
    path.join(getFiscalDir(), 'entradas')
  ];
  const nomes = [];
  if (chaveLimpa.length === 44) nomes.push(`${chaveLimpa}.xml`, `NFe${chaveLimpa}.xml`);
  if (id) nomes.push(`compra_${id}.xml`);

  for (const pasta of pastas) {
    if (!fs.existsSync(pasta)) continue;
    for (const nome of nomes) {
      const full = path.join(pasta, nome);
      if (fs.existsSync(full)) {
        return { xml: fs.readFileSync(full, 'utf8'), fonte: `disco:${nome}`, chave: chaveLimpa };
      }
    }
  }

  return { xml: null, fonte: null, chave: chaveLimpa };
}

/**
 * RC5 — XML da NF-e de venda autorizada (nfe_notas).
 */
async function carregarXmlNfeVendaOrigem({ vendaId, chave }) {
  const chaveLimpa = String(chave || '').replace(/\D/g, '');
  const id = Number(vendaId) || 0;

  if (id) {
    const porVenda = await dbGet(
      `SELECT xml_enviado, xml_retorno, chave_acesso, status
       FROM nfe_notas
       WHERE venda_id = ?
         AND LOWER(TRIM(COALESCE(status,''))) = 'autorizada'
       ORDER BY id DESC LIMIT 1`,
      [id]
    );
    if (porVenda) {
      const xml = porVenda.xml_enviado || porVenda.xml_retorno;
      if (xml && String(xml).trim().length > 100) {
        return {
          xml: String(xml),
          fonte: 'nfe_notas_venda',
          chave: String(porVenda.chave_acesso || chaveLimpa).replace(/\D/g, '')
        };
      }
    }
  }

  if (chaveLimpa.length === 44) {
    const porChave = await dbGet(
      `SELECT xml_enviado, xml_retorno, chave_acesso
       FROM nfe_notas
       WHERE REPLACE(chave_acesso, ' ', '') = ?
       ORDER BY id DESC LIMIT 1`,
      [chaveLimpa]
    );
    if (porChave) {
      const xml = porChave.xml_enviado || porChave.xml_retorno;
      if (xml && String(xml).trim().length > 100) {
        return { xml: String(xml), fonte: 'nfe_notas_chave', chave: chaveLimpa };
      }
    }
  }

  return { xml: null, fonte: null, chave: chaveLimpa };
}

async function parsearDetsDoXml(xml) {
  const result = await parseString(String(xml || ''), {
    explicitArray: false,
    ignoreAttrs: false
  });
  const infNFe = NFeParser.extrairInfNFe(result);
  if (!infNFe) {
    throw Object.assign(new Error('XML da NF-e original inválido (sem infNFe).'), {
      code: 'XML_ORIGEM_INVALIDO',
      statusCode: 400
    });
  }
  const dets = Array.isArray(infNFe.det) ? infNFe.det : [infNFe.det].filter(Boolean);
  return dets.map((d, i) => extrairDetCompleto(d, i));
}

function normalizarCodigo(c) {
  return String(c || '').trim().toUpperCase().replace(/\s+/g, '');
}

function codigoSoDigitos(c) {
  return String(c || '').replace(/\D/g, '').replace(/^0+/, '');
}

function codigoENumerico(c) {
  return /^\d+$/.test(String(c || '').trim());
}

function normalizarTextoProduto(s) {
  return String(s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['"″]/g, '')
    .replace(/[^A-Z0-9/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairMedidas(s) {
  const compacto = normalizarTextoProduto(s).replace(/ /g, '');
  return [...new Set(compacto.match(/\d+\/\d+X\d+|\d+X\d+/g) || [])];
}

function expandirMedidas(medidas) {
  const out = new Set(medidas || []);
  for (const m of medidas || []) {
    const frac = String(m).match(/^(\d+)\/(\d+)X(\d+)$/);
    if (frac) out.add(`${frac[1]}${frac[2]}X${frac[3]}`);
    const compact = String(m).match(/^(\d)(\d+)X(\d+)$/);
    if (compact) out.add(`${compact[1]}/${compact[2]}X${compact[3]}`);
  }
  return out;
}

function medidasCompativeis(a, b) {
  const A = expandirMedidas(a);
  const B = expandirMedidas(b);
  for (const x of A) {
    if (B.has(x)) return true;
  }
  return false;
}

function scoreNomeProduto(nomeDev, xProd) {
  const A = normalizarTextoProduto(nomeDev);
  const B = normalizarTextoProduto(xProd);
  if (!A || !B) return 0;
  if (A === B) return 100;
  if (A.includes(B) || B.includes(A)) return 70;
  const tA = A.split(' ').filter((t) => t.length > 1);
  const tB = new Set(B.split(' ').filter((t) => t.length > 1));
  if (!tA.length || !tB.size) return 0;
  let inter = 0;
  for (const t of tA) {
    if (tB.has(t)) inter += 1;
  }
  return (inter / Math.max(tA.length, tB.size)) * 50;
}

function marcarUsado(usados, idx) {
  usados.add(idx);
}

/**
 * Casa o item da devolução com a linha da NF-e original.
 * Não usa prefixo de 20 caracteres: chaves semelhantes (ex.: ponta magnetizada
 * 1/4x8 vs 3/16x4) precisam de código, medida e quantidade para não trocar de linha.
 */
function casarItemOrigem(itemDev, detsOrigem, usados) {
  const candidatos = detsOrigem
    .map((d, idx) => ({ d, idx }))
    .filter((x) => !usados.has(x.idx));
  if (!candidatos.length) return null;

  const nItem = Number(itemDev.nItemOrigem || itemDev.n_item || itemDev.nItem || 0);
  if (nItem > 0) {
    const porNitem = candidatos.find((x) => Number(x.d.nItem) === nItem);
    if (porNitem) {
      marcarUsado(usados, porNitem.idx);
      return porNitem.d;
    }
  }

  const cProdDev = itemDev.produto_codigo || itemDev.codigo_fornecedor || itemDev.cProd;
  const codDev = normalizarCodigo(cProdDev);
  if (codDev) {
    const porCodigo = candidatos.find((x) => normalizarCodigo(x.d.cProd) === codDev);
    if (porCodigo) {
      marcarUsado(usados, porCodigo.idx);
      return porCodigo.d;
    }
  }

  if (codDev && codigoENumerico(cProdDev)) {
    const digits = codigoSoDigitos(codDev);
    const porDig = candidatos.filter((x) =>
      codigoENumerico(x.d.cProd) && codigoSoDigitos(x.d.cProd) === digits
    );
    if (porDig.length === 1) {
      marcarUsado(usados, porDig[0].idx);
      return porDig[0].d;
    }
  }

  const gtinDev = String(itemDev.codigo_barras || itemDev.produto_codigo_barras || itemDev.cEAN || '').replace(/\D/g, '');
  if (gtinDev.length >= 8) {
    const porGtin = candidatos.filter((x) => String(x.d.cEAN || '').replace(/\D/g, '') === gtinDev);
    if (porGtin.length === 1) {
      marcarUsado(usados, porGtin[0].idx);
      return porGtin[0].d;
    }
  }

  const nomeDev = String(itemDev.produto_nome || itemDev.descricao_produto || '').trim();
  const ncmDev = String(itemDev.ncm || itemDev.produto_ncm || '').replace(/\D/g, '').slice(0, 8);
  const qtdRef = Number(
    itemDev.quantidade_comprada != null ? itemDev.quantidade_comprada
      : (itemDev.quantidade_original != null ? itemDev.quantidade_original : 0)
  );
  const vUn = Number(itemDev.valor_unitario || 0);
  const medidasDev = extrairMedidas(`${nomeDev} ${codDev}`);

  const scored = candidatos.map((x) => {
    let score = 0;
    const xProd = String(x.d.xProd || '');
    const ncm = String(x.d.NCM || '').replace(/\D/g, '').slice(0, 8);
    score += scoreNomeProduto(nomeDev, xProd);
    if (ncm && ncmDev && ncm === ncmDev) score += 15;
    const medidasOrig = extrairMedidas(`${xProd} ${x.d.cProd || ''}`);
    if (medidasDev.length && medidasOrig.length) {
      if (medidasCompativeis(medidasDev, medidasOrig)) score += 45;
      else score -= 50;
    }
    const qOrig = Number(x.d.qCom) || 0;
    if (qtdRef > 0 && qOrig > 0 && Math.abs(qOrig - qtdRef) < 1e-6) score += 35;
    if (vUn > 0 && Number(x.d.vUnCom) > 0 && Math.abs(Number(x.d.vUnCom) - vUn) < 0.009) score += 20;
    return { ...x, score };
  });

  scored.sort((a, b) => b.score - a.score || Number(a.d.nItem || 0) - Number(b.d.nItem || 0));
  const melhor = scored[0];
  const segundo = scored[1];

  if (candidatos.length === 1) {
    marcarUsado(usados, candidatos[0].idx);
    return candidatos[0].d;
  }

  if (melhor && melhor.score >= 40 && (!segundo || melhor.score > segundo.score)) {
    marcarUsado(usados, melhor.idx);
    return melhor.d;
  }

  return null;
}

function montarIcmsXml(grupoIcms, icms, origem) {
  if (!grupoIcms || !icms) return '';
  const orig = origem != null ? String(origem) : String(icms.orig != null ? icms.orig : '0');
  const tags = [];
  tags.push(tag('orig', orig, 0));
  if (icms.CST != null && icms.CST !== '') tags.push(tag('CST', String(icms.CST).padStart(2, '0'), 0));
  if (icms.CSOSN != null && icms.CSOSN !== '') tags.push(tag('CSOSN', String(icms.CSOSN).padStart(3, '0'), 0));

  const ordem = [
    ['modBC', 0], ['pRedBC', 4], ['vBC', 2], ['pICMS', 4], ['vICMS', 2],
    ['modBCST', 0], ['pMVAST', 4], ['pRedBCST', 4], ['vBCST', 2], ['pICMSST', 4], ['vICMSST', 2],
    ['vBCSTRet', 2], ['pST', 4], ['vICMSSubstituto', 2], ['vICMSSTRet', 2],
    ['pCredSN', 4], ['vCredICMSSN', 2],
    ['motDesICMS', 0], ['vICMSDeson', 2],
    ['vBCFCP', 2], ['pFCP', 4], ['vFCP', 2],
    ['vBCFCPST', 2], ['pFCPST', 4], ['vFCPST', 2],
    ['vBCFCPSTRet', 2], ['pFCPSTRet', 4], ['vFCPSTRet', 2]
  ];
  for (const [campo, casas] of ordem) {
    if (icms[campo] == null || icms[campo] === '') continue;
    tags.push(tag(campo, icms[campo], casas));
  }

  return `<ICMS><${grupoIcms}>${tags.join('')}</${grupoIcms}></ICMS>`;
}

function montarIpiXml(ipi) {
  if (!ipi) return '';
  const cst = String(ipi.CST || '').padStart(2, '0');
  const cEnq = ipi.cEnq || '999';
  const nt = ['01', '02', '03', '04', '05', '51', '52', '53', '54', '55'].includes(cst);
  if (nt || ipi.grupo === 'IPINT') {
    return `<IPI><cEnq>${cEnq}</cEnq><IPINT><CST>${cst}</CST></IPINT></IPI>`;
  }
  return `<IPI><cEnq>${cEnq}</cEnq><IPITrib>${tag('CST', cst, 0)}${tag('vBC', ipi.vBC, 2)}${tag('pIPI', ipi.pIPI, 4)}${tag('vIPI', ipi.vIPI, 2)}</IPITrib></IPI>`;
}

function montarPisXml(pis) {
  if (!pis) return '';
  const cst = String(pis.CST || '').padStart(2, '0');
  const nt = ['04', '05', '06', '07', '08', '09'].includes(cst);
  const grupo = pis.grupo || (nt ? 'PISNT' : 'PISAliq');
  if (nt || grupo === 'PISNT') {
    return `<PIS><PISNT><CST>${cst}</CST></PISNT></PIS>`;
  }
  if (grupo === 'PISOutr' || (pis.vBC != null && pis.pPIS != null)) {
    const g = grupo === 'PISAliq' && pis.vAliqProd != null ? 'PISOutr' : (grupo || 'PISAliq');
    if (g === 'PISAliq' || g === 'PISOutr') {
      return `<PIS><${g}>${tag('CST', cst, 0)}${tag('vBC', pis.vBC, 2)}${tag('pPIS', pis.pPIS, 4)}${tag('vPIS', pis.vPIS, 2)}</${g}></PIS>`;
    }
  }
  return `<PIS><PISOutr>${tag('CST', cst, 0)}${tag('vBC', pis.vBC || 0, 2)}${tag('pPIS', pis.pPIS || 0, 4)}${tag('vPIS', pis.vPIS || 0, 2)}</PISOutr></PIS>`;
}

function montarCofinsXml(cofins) {
  if (!cofins) return '';
  const cst = String(cofins.CST || '').padStart(2, '0');
  const nt = ['04', '05', '06', '07', '08', '09'].includes(cst);
  const grupo = cofins.grupo || (nt ? 'COFINSNT' : 'COFINSAliq');
  if (nt || grupo === 'COFINSNT') {
    return `<COFINS><COFINSNT><CST>${cst}</CST></COFINSNT></COFINS>`;
  }
  const g = grupo || 'COFINSAliq';
  return `<COFINS><${g}>${tag('CST', cst, 0)}${tag('vBC', cofins.vBC, 2)}${tag('pCOFINS', cofins.pCOFINS, 4)}${tag('vCOFINS', cofins.vCOFINS, 2)}</${g}></COFINS>`;
}

function montarDifalXml(difal) {
  if (!difal) return '';
  const tags = DIFAL_MONEY.concat(DIFAL_PERC)
    .filter((c) => difal[c] != null)
    .map((c) => tag(c, difal[c], DIFAL_PERC.includes(c) ? 4 : 2));
  if (!tags.length) return '';
  return `<ICMSUFDest>${tags.join('')}</ICMSUFDest>`;
}

function montarImpostoXmlEspelhado(espelhado) {
  const t = espelhado.tributos || {};
  const partes = [
    montarIcmsXml(t.grupoIcms, t.icms, t.origem),
    montarIpiXml(t.ipi),
    montarPisXml(t.pis),
    montarCofinsXml(t.cofins),
    montarDifalXml(t.difal)
  ].filter(Boolean);
  return partes.join('');
}

function espelharDet(origemDet, qtdDevolvida) {
  const qOrig = Number(origemDet.qCom) || 0;
  const qDev = Number(qtdDevolvida) || 0;
  const fator = qOrig > 0 ? qDev / qOrig : 1;
  const trib = origemDet.tributos || {};

  const icms = escalaMonetarios(trib.icms, fator, ICMS_MONEY, ICMS_PERC);
  const ipi = escalaMonetarios(trib.ipi, fator, IPI_MONEY, IPI_PERC);
  if (ipi && trib.ipi) {
    ipi.CST = trib.ipi.CST;
    ipi.cEnq = trib.ipi.cEnq;
    ipi.grupo = trib.ipi.grupo;
  }
  const pis = escalaMonetarios(trib.pis, fator, PIS_MONEY, PIS_PERC);
  if (pis && trib.pis) {
    pis.CST = trib.pis.CST;
    pis.grupo = trib.pis.grupo;
  }
  const cofins = escalaMonetarios(trib.cofins, fator, COFINS_MONEY, COFINS_PERC);
  if (cofins && trib.cofins) {
    cofins.CST = trib.cofins.CST;
    cofins.grupo = trib.cofins.grupo;
  }
  const difal = escalaMonetarios(trib.difal, fator, DIFAL_MONEY, DIFAL_PERC);

  const tributosEspelhados = {
    origem: trib.origem,
    cst: trib.cst,
    csosn: trib.csosn,
    grupoIcms: trib.grupoIcms,
    icms,
    ipi,
    pis,
    cofins,
    difal,
    existe: { ...trib.existe }
  };

  const valorUnit = Number(origemDet.vUnCom) || 0;
  const vProd = round2(qDev * valorUnit);
  const vFrete = round2((Number(origemDet.vFrete) || 0) * fator);
  const vSeg = round2((Number(origemDet.vSeg) || 0) * fator);
  const vDesc = round2((Number(origemDet.vDesc) || 0) * fator);
  const vOutro = round2((Number(origemDet.vOutro) || 0) * fator);

  return {
    nItemOrigem: origemDet.nItem,
    fator: round4(fator),
    ncm: origemDet.NCM,
    cest: origemDet.CEST,
    cfop_original: origemDet.CFOP,
    unidade: origemDet.uCom,
    valor_unitario: valorUnit,
    quantidade_original: qOrig,
    quantidade: qDev,
    vProd,
    vFrete,
    vSeg,
    vDesc,
    vOutro,
    tributos: tributosEspelhados,
    original: {
      nItem: origemDet.nItem,
      cProd: origemDet.cProd,
      xProd: origemDet.xProd,
      NCM: origemDet.NCM,
      CEST: origemDet.CEST,
      CFOP: origemDet.CFOP,
      qCom: qOrig,
      vUnCom: valorUnit,
      vProd: origemDet.vProd,
      tributos: trib
    }
  };
}

function flattenParaItem(espelhado) {
  const t = espelhado.tributos || {};
  const icms = t.icms || {};
  const pis = t.pis || {};
  const cofins = t.cofins || {};
  const ipi = t.ipi || {};
  return {
    csosn: t.csosn || '',
    cst: t.cst || '',
    origem: t.origem != null ? t.origem : 0,
    cst_pis: pis.CST || '',
    cst_cofins: cofins.CST || '',
    cst_ipi: ipi.CST || '',
    ncm: espelhado.ncm,
    cest: espelhado.cest,
    produto_ncm: espelhado.ncm,
    unidade: espelhado.unidade,
    valor_unitario: espelhado.valor_unitario,
    v_bc_icms: icms.vBC,
    p_icms: icms.pICMS != null ? icms.pICMS : icms.pCredSN,
    v_icms: icms.vICMS != null ? icms.vICMS : icms.vCredICMSSN,
    v_bc_pis: pis.vBC,
    p_pis: pis.pPIS,
    v_pis: pis.vPIS,
    v_bc_cofins: cofins.vBC,
    p_cofins: cofins.pCOFINS,
    v_cofins: cofins.vCOFINS,
    v_bc_ipi: ipi.vBC,
    p_ipi: ipi.pIPI,
    v_ipi: ipi.vIPI,
    v_ipi_devol: ipi.vIPI,
    v_ipi_original: Number(espelhado.original?.tributos?.ipi?.vIPI) || 0,
    quantidade_original: espelhado.quantidade_original,
    vFrete: espelhado.vFrete || 0,
    vSeg: espelhado.vSeg || 0,
    vDesc: espelhado.vDesc || 0,
    vOutro: espelhado.vOutro || 0,
    tributosEspelhados: t,
    impostoEspelhadoXml: montarImpostoXmlEspelhado(espelhado),
    espelhamento: espelhado
  };
}

function statusComparacao(origVal, devVal, tipo = 'valor') {
  if (origVal == null && (devVal == null || devVal === '')) return { status: 'igual', label: 'Igual', cor: 'verde' };
  if (tipo === 'cfop') {
    // CFOP de devolução é adaptado legalmente (1xxx/2xxx → 5xxx/6xxx)
    return { status: 'adaptado', label: 'Adaptado', cor: 'amarelo' };
  }
  if (tipo === 'codigo') {
    const a = String(origVal || '');
    const b = String(devVal || '');
    if (a === b) return { status: 'igual', label: 'Igual', cor: 'verde' };
    return { status: 'divergente', label: 'Divergente', cor: 'vermelho' };
  }
  const a = Number(origVal);
  const b = Number(devVal);
  if (!Number.isFinite(a) && !Number.isFinite(b)) return { status: 'igual', label: 'Igual', cor: 'verde' };
  if (Math.abs((a || 0) - (b || 0)) < 0.02) return { status: 'igual', label: 'Igual', cor: 'verde' };
  // valores monetários proporcionais à quantidade são esperados
  return { status: 'adaptado', label: 'Adaptado', cor: 'amarelo' };
}

function montarComparacaoItem(espelhado, cfopDev) {
  const o = espelhado.original?.tributos || {};
  const e = espelhado.tributos || {};
  const linhas = [
    { campo: 'CST', original: o.cst, devolucao: e.cst, ...statusComparacao(o.cst, e.cst, 'codigo') },
    { campo: 'CSOSN', original: o.csosn, devolucao: e.csosn, ...statusComparacao(o.csosn, e.csosn, 'codigo') },
    { campo: 'CFOP', original: espelhado.cfop_original, devolucao: cfopDev, ...statusComparacao(espelhado.cfop_original, cfopDev, 'cfop') },
    { campo: 'ICMS vBC', original: o.icms?.vBC, devolucao: e.icms?.vBC, ...statusComparacao(o.icms?.vBC, e.icms?.vBC) },
    { campo: 'ICMS pICMS', original: o.icms?.pICMS, devolucao: e.icms?.pICMS, ...statusComparacao(o.icms?.pICMS, e.icms?.pICMS, 'codigo') },
    { campo: 'ICMS vICMS', original: o.icms?.vICMS, devolucao: e.icms?.vICMS, ...statusComparacao(o.icms?.vICMS, e.icms?.vICMS) },
    { campo: 'IPI', original: o.ipi?.vIPI, devolucao: e.ipi?.vIPI, ...statusComparacao(o.ipi?.vIPI, e.ipi?.vIPI) },
    { campo: 'PIS', original: o.pis?.vPIS, devolucao: e.pis?.vPIS, ...statusComparacao(o.pis?.vPIS, e.pis?.vPIS) },
    { campo: 'COFINS', original: o.cofins?.vCOFINS, devolucao: e.cofins?.vCOFINS, ...statusComparacao(o.cofins?.vCOFINS, e.cofins?.vCOFINS) },
    { campo: 'ICMS ST', original: o.icms?.vICMSST, devolucao: e.icms?.vICMSST, ...statusComparacao(o.icms?.vICMSST, e.icms?.vICMSST) },
    { campo: 'FCP', original: o.icms?.vFCP, devolucao: e.icms?.vFCP, ...statusComparacao(o.icms?.vFCP, e.icms?.vFCP) },
    { campo: 'DIFAL', original: o.difal?.vICMSUFDest, devolucao: e.difal?.vICMSUFDest, ...statusComparacao(o.difal?.vICMSUFDest, e.difal?.vICMSUFDest) }
  ];
  return {
    nItemOrigem: espelhado.nItemOrigem,
    produto: espelhado.original?.xProd,
    fator: espelhado.fator,
    linhas
  };
}

function montarPainelTributacaoOriginal(dets) {
  const agg = { icms: false, ipi: false, pis: false, cofins: false, st: false, fcp: false, difal: false };
  for (const d of dets) {
    const e = d.tributos?.existe || {};
    if (e.icms) agg.icms = true;
    if (e.ipi) agg.ipi = true;
    if (e.pis) agg.pis = true;
    if (e.cofins) agg.cofins = true;
    if (e.st) agg.st = true;
    if (e.fcp) agg.fcp = true;
    if (e.difal) agg.difal = true;
  }
  const label = (ok) => (ok ? { presente: true, texto: 'Presente na NF-e original' } : { presente: false, texto: 'Não existente na NF-e original.' });
  return {
    ICMS: label(agg.icms),
    IPI: label(agg.ipi),
    PIS: label(agg.pis),
    COFINS: label(agg.cofins),
    'ICMS ST': label(agg.st),
    FCP: label(agg.fcp),
    DIFAL: label(agg.difal)
  };
}

function logEspelhamento(evento, dados) {
  try {
    const pasta = getFiscalSubDir('debug/nfe-devolucao');
    const linha = JSON.stringify({ em: new Date().toISOString(), evento, ...dados }) + '\n';
    fs.appendFileSync(path.join(pasta, 'rc2-espelhamento.log'), linha, 'utf8');
  } catch (_) { /* ignore */ }
  console.log('[RC2-ESP]', evento, dados && dados.resumo ? dados.resumo : '');
}

/**
 * Espelha tributos da NF-e original nos itens de devolução.
 * @returns {Promise<object>}
 */
async function espelharTributosNfeDevolucaoCompra({
  compraId,
  chave,
  itens,
  cfopPadrao = '5202',
  exigirXml = true
}) {
  const carregado = await carregarXmlNfeCompraOrigem({ compraId, chave });
  if (!carregado.xml) {
    const erro = Object.assign(
      new Error('XML da NF-e original não encontrado para espelhamento fiscal. Importe o XML na Central de Entradas.'),
      { code: 'XML_ORIGEM_AUSENTE', statusCode: 400 }
    );
    logEspelhamento('xml_ausente', { compraId, chave, resumo: 'XML não encontrado' });
    if (exigirXml) throw erro;
    return {
      ok: false,
      erro,
      tributacaoOriginal: null,
      comparacaoFiscal: [],
      itens: itens || [],
      ajustes: [],
      fonteXml: null
    };
  }

  const dets = await parsearDetsDoXml(carregado.xml);
  logEspelhamento('tributacao_carregada', {
    compraId,
    fonte: carregado.fonte,
    itensOrigem: dets.length,
    resumo: `fonte=${carregado.fonte} itens=${dets.length}`
  });

  const usados = new Set();
  const ajustes = [];
  const comparacaoFiscal = [];
  const itensOut = [];

  for (const item of itens || []) {
    const origem = casarItemOrigem(item, dets, usados);
    if (!origem) {
      throw Object.assign(
        new Error(`Não foi possível casar o item "${item.produto_nome || item.produto_id}" com a NF-e original.`),
        { code: 'ITEM_SEM_ORIGEM', statusCode: 400 }
      );
    }
    if (!origem.tributos?.existe?.icms && !origem.tributos?.cst && !origem.tributos?.csosn) {
      throw Object.assign(
        new Error(`Item ${origem.nItem} da NF-e original sem tributação ICMS/CST/CSOSN.`),
        { code: 'TRIBUTACAO_AUSENTE', statusCode: 400 }
      );
    }

    const qtd = Number(item.quantidade || 0);
    const esp = espelharDet(origem, qtd);
    const flat = flattenParaItem(esp);
    const cfopDev = String(item.cfop || cfopPadrao || '').replace(/\D/g, '').slice(0, 4) || cfopPadrao;

    if (esp.fator !== 1) {
      ajustes.push({
        nItemOrigem: origem.nItem,
        tipo: 'proporcional_quantidade',
        fator: esp.fator,
        detalhe: `Valores monetários proporcionais à qtd devolvida (${qtd}/${esp.quantidade_original}).`
      });
    }
    if (cfopDev !== esp.cfop_original) {
      ajustes.push({
        nItemOrigem: origem.nItem,
        tipo: 'cfop_devolucao',
        de: esp.cfop_original,
        para: cfopDev,
        detalhe: 'CFOP adaptado para devolução de compra (regra legal).'
      });
    }

    comparacaoFiscal.push(montarComparacaoItem(esp, cfopDev));

    itensOut.push({
      ...item,
      ...flat,
      cfop: cfopDev,
      ncm: flat.ncm || item.ncm,
      produto_ncm: flat.ncm || item.produto_ncm,
      unidade: flat.unidade || item.unidade,
      valor_unitario: flat.valor_unitario != null ? flat.valor_unitario : item.valor_unitario,
      bloqueado_tributos: true,
      espelhamento_ok: true
    });
  }

  const painel = montarPainelTributacaoOriginal(dets);
  logEspelhamento('tributacao_espelhada', {
    compraId,
    itens: itensOut.length,
    ajustes: ajustes.length,
    resumo: `espelhados=${itensOut.length} ajustes=${ajustes.length}`
  });

  return {
    ok: true,
    fonteXml: carregado.fonte,
    chave: carregado.chave,
    tributacaoOriginal: painel,
    comparacaoFiscal,
    itens: itensOut,
    ajustes,
    itensOrigem: dets.map((d) => ({
      nItem: d.nItem,
      cProd: d.cProd,
      xProd: d.xProd,
      NCM: d.NCM,
      CFOP: d.CFOP,
      existe: d.tributos?.existe
    }))
  };
}

/**
 * RC5 — Espelhamento a partir da NF-e de venda (reutiliza motor RC2).
 */
async function espelharTributosNfeDevolucaoVenda({
  vendaId,
  chave,
  itens,
  cfopPadrao = '1202',
  exigirXml = true
}) {
  const carregado = await carregarXmlNfeVendaOrigem({ vendaId, chave });
  if (!carregado.xml) {
    const erro = Object.assign(
      new Error('XML da NF-e de venda não encontrado para espelhamento fiscal.'),
      { code: 'XML_ORIGEM_AUSENTE', statusCode: 400 }
    );
    logEspelhamento('xml_ausente_venda', { vendaId, chave, resumo: 'XML venda não encontrado' });
    if (exigirXml) throw erro;
    return {
      ok: false,
      erro,
      tributacaoOriginal: null,
      comparacaoFiscal: [],
      itens: itens || [],
      ajustes: [],
      fonteXml: null
    };
  }

  const dets = await parsearDetsDoXml(carregado.xml);
  const usados = new Set();
  const ajustes = [];
  const comparacaoFiscal = [];
  const itensOut = [];

  for (const item of itens || []) {
    const origem = casarItemOrigem(item, dets, usados);
    if (!origem) {
      throw Object.assign(
        new Error(`Não foi possível casar o item "${item.produto_nome || item.produto_id}" com a NF-e de venda.`),
        { code: 'ITEM_SEM_ORIGEM', statusCode: 400 }
      );
    }
    const qtd = Number(item.quantidade || 0);
    const esp = espelharDet(origem, qtd);
    const flat = flattenParaItem(esp);
    const cfopDev = String(item.cfop || cfopPadrao || '').replace(/\D/g, '').slice(0, 4) || cfopPadrao;

    if (esp.fator !== 1) {
      ajustes.push({ nItemOrigem: origem.nItem, tipo: 'proporcional_quantidade', fator: esp.fator });
    }
    if (cfopDev !== esp.cfop_original) {
      ajustes.push({
        nItemOrigem: origem.nItem,
        tipo: 'cfop_devolucao',
        de: esp.cfop_original,
        para: cfopDev,
        detalhe: 'CFOP adaptado para devolução de venda (regra legal).'
      });
    }

    comparacaoFiscal.push(montarComparacaoItem(esp, cfopDev));
    itensOut.push({
      ...item,
      ...flat,
      cfop: cfopDev,
      ncm: flat.ncm || item.ncm,
      produto_ncm: flat.ncm || item.produto_ncm,
      unidade: flat.unidade || item.unidade,
      valor_unitario: flat.valor_unitario != null ? flat.valor_unitario : item.valor_unitario,
      bloqueado_tributos: true,
      espelhamento_ok: true
    });
  }

  return {
    ok: true,
    fonteXml: carregado.fonte,
    chave: carregado.chave,
    tributacaoOriginal: montarPainelTributacaoOriginal(dets),
    comparacaoFiscal,
    itens: itensOut,
    ajustes
  };
}

/**
 * Valida espelhamento antes da transmissão.
 */
function validarEspelhamentoAntesTransmissao(espelhamento, itens) {
  const erros = [];
  if (!espelhamento?.ok) {
    erros.push(espelhamento?.erro?.message || 'Espelhamento fiscal não concluído.');
    return { ok: false, erros };
  }
  if (!Array.isArray(itens) || !itens.length) {
    erros.push('Sem itens para validar tributação.');
  }
  for (const item of itens) {
    const nome = item.produto_nome || item.produto_id || '?';
    if (!item.impostoEspelhadoXml && !item.tributosEspelhados) {
      erros.push(`Item ${nome}: tributação não espelhada da NF-e original.`);
    }
    if (!item.csosn && !item.cst) {
      erros.push(`Item ${nome}: CST/CSOSN ausente.`);
    }
    const ncm = String(item.ncm || item.produto_ncm || '').replace(/\D/g, '');
    if (ncm.length !== 8) {
      erros.push(`Item ${nome}: NCM inválido ou ausente.`);
    }
    const cfop = String(item.cfop || '').replace(/\D/g, '');
    if (!['5202', '6202', '5411', '6411', '5201', '6201', '1202', '2202', '1411', '2411'].includes(cfop)
      && !/^[1256]/.test(cfop)) {
      erros.push(`Item ${nome}: CFOP ${cfop || '-'} incompatível com devolução.`);
    }
    if (!(Number(item.quantidade) > 0)) {
      erros.push(`Item ${nome}: quantidade inválida.`);
    }
  }

  const divergentes = (espelhamento.comparacaoFiscal || [])
    .flatMap((c) => c.linhas || [])
    .filter((l) => l.status === 'divergente' && l.campo !== 'CFOP');
  if (divergentes.length) {
    erros.push(`Divergências fiscais detectadas: ${divergentes.map((d) => d.campo).join(', ')}.`);
    logEspelhamento('diferencas_encontradas', {
      qtd: divergentes.length,
      resumo: divergentes.map((d) => d.campo).join(',')
    });
  }

  if (espelhamento.ajustes?.length) {
    logEspelhamento('ajustes_automaticos', {
      qtd: espelhamento.ajustes.length,
      resumo: espelhamento.ajustes.map((a) => a.tipo).join(',')
    });
  }

  return { ok: erros.length === 0, erros };
}

module.exports = {
  carregarXmlNfeCompraOrigem,
  carregarXmlNfeVendaOrigem,
  espelharTributosNfeDevolucaoCompra,
  espelharTributosNfeDevolucaoVenda,
  validarEspelhamentoAntesTransmissao,
  montarImpostoXmlEspelhado,
  espelharDet,
  flattenParaItem,
  montarPainelTributacaoOriginal,
  parsearDetsDoXml,
  casarItemOrigem
};
