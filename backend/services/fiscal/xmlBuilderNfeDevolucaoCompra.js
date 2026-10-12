/**
 * Builder XML NF-e de Devolução de Compra (finNFe=4).
 * Reutiliza utils/cert do motor oficial; não altera xmlBuilderNfeVenda.
 */

'use strict';

const {
  onlyDigits,
  formatNumber,
  nowDhEmi,
  gerarCodigoNumerico,
  gerarChaveAcesso,
  xmlEscape,
  compactarXml
} = require('./utils');
const { extrairNomeEmpresaDoCertificado } = require('./certificateService');
const {
  calcularVNFSefaz,
  calcularIpiDevolucaoItem,
  somarMoeda,
  arredondarMoeda
} = require('./modeloTotais');
const {
  resolverMunicipioDestinatario,
  validarMunicipioDestinatario
} = require('./municipioIbge');
const {
  resolverIcmsPorCrtEmitente,
  montarIcmsXmlResolvido,
  substituirIcmsNoImpostoXml,
  validarIcmsXmlContraCrt,
  resumoResolucaoIcms
} = require('./resolverIcmsCrtEmitente');
const { sanitizarInfCplNfe } = require('./sanitizarInfCplNfe');

function limparCNPJ(cnpj) {
  return String(cnpj || '').replace(/\D/g, '');
}

function extrairCnpjDaChave(chave) {
  const limpa = onlyDigits(chave);
  return limpa.length === 44 ? limpa.substring(6, 20) : null;
}

function textoNodoXml(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'object') {
    if (Array.isArray(v)) return textoNodoXml(v[0]);
    return String(v._ != null ? v._ : (v.value != null ? v.value : '')).trim();
  }
  return String(v).trim();
}

function pegarNoXml(obj, localName) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (obj[localName] != null) return obj[localName];
  const alvo = String(localName).toLowerCase();
  const key = Object.keys(obj).find((k) => {
    const local = String(k).split(':').pop();
    return local === localName || local.toLowerCase() === alvo;
  });
  return key ? obj[key] : undefined;
}

function ieContribuinte(raw) {
  const ie = onlyDigits(raw);
  if (!ie || /^0+$/.test(ie)) return null;
  return ie;
}

function tagXmlLocal(bloco, nome) {
  const re = new RegExp(
    `<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`,
    'i'
  );
  const m = String(bloco || '').match(re);
  if (!m) return '';
  return String(m[1]).replace(/<[^>]+>/g, '').trim();
}

/**
 * Lê <emit> direto do XML bruto (fonte da IE quando o xml2js perde namespace/attrs).
 */
function extrairEmitenteOriginalDoXmlBruto(xml) {
  const bruto = String(xml || '');
  const emitMatch = bruto.match(/<(?:\w+:)?emit\b[^>]*>([\s\S]*?)<\/(?:\w+:)?emit>/i);
  if (!emitMatch) return null;
  const emitXml = emitMatch[1];
  const enderMatch = emitXml.match(/<(?:\w+:)?enderEmit\b[^>]*>([\s\S]*?)<\/(?:\w+:)?enderEmit>/i);
  const enderXml = enderMatch ? enderMatch[1] : '';
  return normalizarEmitenteOriginalNfe({
    CNPJ: tagXmlLocal(emitXml, 'CNPJ'),
    xNome: tagXmlLocal(emitXml, 'xNome'),
    xFant: tagXmlLocal(emitXml, 'xFant'),
    IE: tagXmlLocal(emitXml, 'IE'),
    CRT: tagXmlLocal(emitXml, 'CRT'),
    enderEmit: {
      xLgr: tagXmlLocal(enderXml, 'xLgr'),
      nro: tagXmlLocal(enderXml, 'nro'),
      xBairro: tagXmlLocal(enderXml, 'xBairro'),
      cMun: tagXmlLocal(enderXml, 'cMun'),
      xMun: tagXmlLocal(enderXml, 'xMun'),
      UF: tagXmlLocal(enderXml, 'UF'),
      CEP: tagXmlLocal(enderXml, 'CEP'),
      cPais: tagXmlLocal(enderXml, 'cPais'),
      xPais: tagXmlLocal(enderXml, 'xPais'),
      fone: tagXmlLocal(enderXml, 'fone')
    }
  });
}

function mesclarEmitenteOriginal(primario, secundario) {
  const a = primario && typeof primario === 'object' ? primario : {};
  const b = secundario && typeof secundario === 'object' ? secundario : {};
  const out = { ...a };
  Object.keys(b).forEach((k) => {
    if (out[k] == null || out[k] === '') out[k] = b[k];
  });
  if (!out.CNPJ && !out.IE && !out.xNome) return null;
  return out;
}

/**
 * Destinatário da devolução de compra = emitente da NF-e original (fornecedor).
 * Não usa o <dest> da NF original (que é a própria empresa).
 */
function normalizarEmitenteOriginalNfe(emit) {
  if (!emit || typeof emit !== 'object') return null;
  const nodo = Array.isArray(emit) ? emit[0] : emit;
  const enderRaw = pegarNoXml(nodo, 'enderEmit') || {};
  const ender = Array.isArray(enderRaw) ? enderRaw[0] : enderRaw;
  const cnpj = limparCNPJ(textoNodoXml(pegarNoXml(nodo, 'CNPJ') || nodo.cnpj));
  return {
    CNPJ: cnpj,
    xNome: textoNodoXml(pegarNoXml(nodo, 'xNome')),
    xFant: textoNodoXml(pegarNoXml(nodo, 'xFant')),
    IE: ieContribuinte(textoNodoXml(pegarNoXml(nodo, 'IE') || nodo.ie)),
    CRT: textoNodoXml(pegarNoXml(nodo, 'CRT') || nodo.crt) || null,
    xLgr: textoNodoXml(pegarNoXml(ender, 'xLgr')),
    nro: textoNodoXml(pegarNoXml(ender, 'nro')),
    xBairro: textoNodoXml(pegarNoXml(ender, 'xBairro')),
    cMun: onlyDigits(textoNodoXml(pegarNoXml(ender, 'cMun'))),
    xMun: textoNodoXml(pegarNoXml(ender, 'xMun')),
    UF: textoNodoXml(pegarNoXml(ender, 'UF')).toUpperCase(),
    CEP: onlyDigits(textoNodoXml(pegarNoXml(ender, 'CEP'))),
    cPais: onlyDigits(textoNodoXml(pegarNoXml(ender, 'cPais'))) || '1058',
    xPais: textoNodoXml(pegarNoXml(ender, 'xPais')) || 'BRASIL',
    fone: onlyDigits(textoNodoXml(pegarNoXml(ender, 'fone')))
  };
}

function resolverDestinatarioDevolucaoCompra(compra = {}, config = {}) {
  const orig = compra.emitenteOriginal || compra.emitente_original || {};
  const doXml = extrairEmitenteOriginalDoXmlBruto(compra.xmlOrigem || compra.xml_origem || '');
  const emitente = mesclarEmitenteOriginal(orig, doXml) || orig;
  const cnpjEmpresa = limparCNPJ(config.cnpj);
  const candidatos = [
    { v: limparCNPJ(emitente.CNPJ || emitente.cnpj), origem: 'emitenteOriginal.CNPJ' },
    { v: extrairCnpjDaChave(compra.chave_acesso || compra.refNFe || ''), origem: 'chave_acesso' },
    { v: limparCNPJ(compra.fornecedor_cnpj), origem: 'compra.fornecedor_cnpj' },
    { v: limparCNPJ(compra.fornecedor_doc_cadastro), origem: 'fornecedor_doc_cadastro' },
    { v: limparCNPJ(compra.cnpj), origem: 'compra.cnpj' },
    { v: limparCNPJ(compra.cpf_cnpj), origem: 'compra.cpf_cnpj' },
    { v: limparCNPJ(compra.documento), origem: 'compra.documento' }
  ].filter((c) => c.v && c.v.length === 14);
  const escolhido = candidatos.find((c) => c.v !== cnpjEmpresa) || candidatos[0];
  const cnpj = escolhido ? escolhido.v : '';

  let origemIe = 'ausente';
  let ie = ieContribuinte(emitente.IE || emitente.ie);
  if (ie) origemIe = orig.IE || orig.ie ? 'emitenteOriginal.IE' : 'xml_bruto.emit.IE';
  if (!ie) {
    ie = ieContribuinte(compra.inscricao_estadual);
    if (ie) origemIe = 'compra.inscricao_estadual';
  }
  const uf = String(emitente.UF || emitente.uf || compra.uf || '').trim().toUpperCase();

  return {
    cnpj,
    xNome: emitente.xNome || emitente.nome || compra.fornecedor || 'FORNECEDOR',
    xLgr: emitente.xLgr || emitente.rua || compra.rua || 'NAO INFORMADO',
    nro: (emitente.nro || emitente.numero || compra.numero || 'S/N'),
    xBairro: emitente.xBairro || emitente.bairro || compra.bairro || 'CENTRO',
    xMun: emitente.xMun || emitente.cidade || compra.cidade || '',
    UF: uf,
    CEP: emitente.CEP || emitente.cep || compra.cep || '00000000',
    cMun: emitente.cMun || emitente.codigo_municipio || compra.codigo_municipio || '',
    cPais: emitente.cPais || '1058',
    xPais: emitente.xPais || 'BRASIL',
    fone: emitente.fone || '',
    IE: ie,
    indIEDest: ie ? '1' : '9',
    origem: {
      funcao: 'resolverDestinatarioDevolucaoCompra',
      cnpj: escolhido ? escolhido.origem : 'ausente',
      ie: origemIe,
      emitenteOriginalPresente: Boolean(orig && (orig.CNPJ || orig.IE || orig.xNome)),
      xmlBrutoEmitPresente: Boolean(doXml && (doXml.CNPJ || doXml.IE))
    }
  };
}

function num(v, casas = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

function calcularIpiDevolucaoDoItem(item, ipiFallback) {
  const qDev = Number(item.quantidade || 0);
  const qOrigRaw = Number(
    item.quantidade_original != null
      ? item.quantidade_original
      : (item.espelhamento && item.espelhamento.quantidade_original)
  );
  const qOrig = qOrigRaw > 0 ? qOrigRaw : qDev;
  const vOriginal = Number(
    item.v_ipi_original
    || (item.espelhamento
      && item.espelhamento.original
      && item.espelhamento.original.tributos
      && item.espelhamento.original.tributos.ipi
      && item.espelhamento.original.tributos.ipi.vIPI)
    || 0
  );
  if (vOriginal > 0) {
    return calcularIpiDevolucaoItem({
      quantidadeOriginal: qOrig,
      quantidadeDevolvida: qDev,
      vIPIOriginal: vOriginal
    });
  }
  const jaRateado = Number(item.v_ipi_devol != null ? item.v_ipi_devol : ipiFallback) || 0;
  const percentualDevolucao = qOrig > 0 ? qDev / qOrig : 1;
  return {
    percentualDevolucao,
    pDevol: arredondarMoeda(percentualDevolucao * 100),
    vIPIDevol: arredondarMoeda(jaRateado),
    vIPIOriginal: arredondarMoeda(jaRateado)
  };
}

function montarXmlImpostoDevol(calc) {
  if (!(calc && Number(calc.vIPIDevol) > 0)) return '';
  return `<impostoDevol><pDevol>${formatNumber(calc.pDevol, 2)}</pDevol><IPI><vIPIDevol>${formatNumber(calc.vIPIDevol, 2)}</vIPIDevol></IPI></impostoDevol>`;
}

function zerarVipiNoIpiTrib(xml) {
  return String(xml || '').replace(/(<IPITrib>[\s\S]*?)<vIPI>[^<]*<\/vIPI>/, '$1<vIPI>0.00</vIPI>');
}

function aplicarIpiDevolucaoNoImposto(imposto, item) {
  const ipiFallback = imposto.totais && imposto.totais.vIpi;
  const calc = calcularIpiDevolucaoDoItem(item, ipiFallback);
  let xml = imposto.xml;
  const totais = { ...(imposto.totais || {}) };
  if (calc.vIPIDevol > 0) {
    xml = zerarVipiNoIpiTrib(xml);
    totais.vIpi = 0;
    totais.vIpiDevol = calc.vIPIDevol;
  } else {
    totais.vIpiDevol = 0;
  }
  return {
    ...imposto,
    xml,
    xmlImpostoDevol: montarXmlImpostoDevol(calc),
    totais,
    ipiDevolucao: calc
  };
}

/**
 * Monta bloco <imposto>.
 * RC2: quando houver espelhamento da NF-e original, usa exclusivamente esses dados.
 * Sem espelhamento, não inventa alíquotas — exige CST/CSOSN informados no item.
 */
function montarImpostoItem({ compra, item, config, valorItem }) {
  const t = item.tributosEspelhados || {};
  const icmsEsp = t.icms || {};
  // compras.csosn_cst(_xml) guarda CST (2 dígitos) ou CSOSN (3 dígitos): só CSOSN serve aqui.
  const csosnCompra = [compra.csosn_cst_xml, compra.csosn_cst]
    .map((v) => String(v || '').replace(/\D/g, ''))
    .find((d) => d.length === 3) || '';
  const csosnFonte = t.csosn || item.csosn || item.CSOSN || csosnCompra;
  const cstFonte = t.cst || item.cst || item.CST || '';
  const resolucao = resolverIcmsPorCrtEmitente({
    crt: config && config.crt,
    cst: cstFonte,
    csosn: csosnFonte,
    grupoIcms: t.grupoIcms || item.grupoIcms,
    icms: Object.keys(icmsEsp).length ? icmsEsp : {
      orig: item.origem,
      vBC: item.v_bc_icms != null ? item.v_bc_icms : item.base_icms,
      pICMS: item.p_icms != null ? item.p_icms : item.aliquota_icms,
      vICMS: item.v_icms
    },
    origem: t.origem != null ? t.origem : item.origem
  });

  if (item.impostoEspelhadoXml && String(item.impostoEspelhadoXml).trim()) {
    const pis = t.pis || {};
    const cofins = t.cofins || {};
    const ipi = t.ipi || {};
    const icmsXml = montarIcmsXmlResolvido(resolucao);
    return aplicarIpiDevolucaoNoImposto({
      xml: substituirIcmsNoImpostoXml(item.impostoEspelhadoXml, icmsXml),
      totais: {
        vBC: num(icmsEsp.vBC),
        vICMS: num(icmsEsp.vICMS != null ? icmsEsp.vICMS : icmsEsp.vCredICMSSN),
        vBCST: num(icmsEsp.vBCST),
        vST: num(icmsEsp.vICMSST),
        vFCP: num(icmsEsp.vFCP),
        vFCPST: num(icmsEsp.vFCPST),
        vFCPSTRet: num(icmsEsp.vFCPSTRet),
        vICMSDeson: num(icmsEsp.vICMSDeson),
        vPis: num(pis.vPIS),
        vCofins: num(cofins.vCOFINS),
        vIpi: num(ipi.vIPI),
        vIpiDevol: num(item.v_ipi_devol != null ? item.v_ipi_devol : ipi.vIPI)
      },
      espelhado: true,
      resolucao
    }, item);
  }

  if (!String(csosnFonte).replace(/\D/g, '') && !String(cstFonte).replace(/\D/g, '')) {
    throw Object.assign(
      new Error('Tributação ICMS (CST/CSOSN) não carregada da NF-e original.'),
      { code: 'TRIBUTACAO_AUSENTE', statusCode: 400 }
    );
  }

  const cstPis = String(item.cst_pis || compra.cst_pis_xml || compra.cst_pis || '').replace(/\D/g, '');
  const cstCofins = String(item.cst_cofins || compra.cst_cofins_xml || compra.cst_cofins || '').replace(/\D/g, '');
  const cstIpi = String(item.cst_ipi || compra.cst_ipi_xml || compra.cst_ipi || '').replace(/\D/g, '');

  if (!cstPis || !cstCofins) {
    throw Object.assign(
      new Error('CST PIS/COFINS não carregados da NF-e original.'),
      { code: 'TRIBUTACAO_AUSENTE', statusCode: 400 }
    );
  }

  const vBC = num(item.v_bc_icms != null ? item.v_bc_icms : (item.base_icms != null ? item.base_icms : null));
  const pICMS = num(item.p_icms != null ? item.p_icms : (item.aliquota_icms != null ? item.aliquota_icms : null));
  const vICMS = num(item.v_icms != null ? item.v_icms : (vBC != null && pICMS != null ? (vBC * pICMS) / 100 : null));

  const vBCPis = num(item.v_bc_pis);
  const pPis = num(item.p_pis);
  const vPis = num(item.v_pis != null ? item.v_pis : (vBCPis != null && pPis != null ? (vBCPis * pPis) / 100 : null));

  const vBCCofins = num(item.v_bc_cofins);
  const pCofins = num(item.p_cofins);
  const vCofins = num(item.v_cofins != null ? item.v_cofins : (vBCCofins != null && pCofins != null ? (vBCCofins * pCofins) / 100 : null));

  const vBCIpi = num(item.v_bc_ipi);
  const pIpi = num(item.p_ipi);
  const vIpi = num(item.v_ipi != null ? item.v_ipi : (vBCIpi != null && pIpi != null ? (vBCIpi * pIpi) / 100 : null));

  if (resolucao.regime === 'normal' && ['00', '20'].includes(resolucao.cst) && vBC != null) {
    resolucao.icms = {
      ...resolucao.icms,
      modBC: resolucao.icms.modBC != null ? resolucao.icms.modBC : 3,
      vBC: resolucao.icms.vBC != null ? resolucao.icms.vBC : vBC,
      pICMS: resolucao.icms.pICMS != null ? resolucao.icms.pICMS : (pICMS || 0),
      vICMS: resolucao.icms.vICMS != null ? resolucao.icms.vICMS : (vICMS || 0)
    };
  }
  if (resolucao.regime === 'simples' && resolucao.csosn === '101') {
    resolucao.icms = {
      ...resolucao.icms,
      pCredSN: resolucao.icms.pCredSN != null ? resolucao.icms.pCredSN : (pICMS || 0),
      vCredICMSSN: resolucao.icms.vCredICMSSN != null ? resolucao.icms.vCredICMSSN : (vICMS || 0)
    };
  }
  if (resolucao.regime === 'simples' && resolucao.csosn === '900' && vBC != null) {
    resolucao.icms = {
      ...resolucao.icms,
      modBC: resolucao.icms.modBC != null ? resolucao.icms.modBC : 3,
      vBC: resolucao.icms.vBC != null ? resolucao.icms.vBC : vBC,
      pICMS: resolucao.icms.pICMS != null ? resolucao.icms.pICMS : (pICMS || 0),
      vICMS: resolucao.icms.vICMS != null ? resolucao.icms.vICMS : (vICMS || 0)
    };
  }

  const icmsXml = montarIcmsXmlResolvido(resolucao);

  const pisNt = ['04', '05', '06', '07', '08', '09'].includes(cstPis.padStart(2, '0'));
  const cofinsNt = ['04', '05', '06', '07', '08', '09'].includes(cstCofins.padStart(2, '0'));
  const cstPis2 = cstPis.padStart(2, '0').slice(0, 2);
  const cstCofins2 = cstCofins.padStart(2, '0').slice(0, 2);

  const pisXml = pisNt
    ? `<PIS><PISNT><CST>${cstPis2}</CST></PISNT></PIS>`
    : `<PIS><PISOutr><CST>${cstPis2}</CST><vBC>${formatNumber(vBCPis || 0, 2)}</vBC><pPIS>${formatNumber(pPis || 0, 4)}</pPIS><vPIS>${formatNumber(vPis || 0, 2)}</vPIS></PISOutr></PIS>`;

  const cofinsXml = cofinsNt
    ? `<COFINS><COFINSNT><CST>${cstCofins2}</CST></COFINSNT></COFINS>`
    : `<COFINS><COFINSOutr><CST>${cstCofins2}</CST><vBC>${formatNumber(vBCCofins || 0, 2)}</vBC><pCOFINS>${formatNumber(pCofins || 0, 4)}</pCOFINS><vCOFINS>${formatNumber(vCofins || 0, 2)}</vCOFINS></COFINSOutr></COFINS>`;

  let ipiXml = '';
  if (cstIpi) {
    const cstIpi2 = cstIpi.padStart(2, '0').slice(0, 2);
    const ipiNt = ['01', '02', '03', '04', '05', '51', '52', '53', '54', '55'].includes(cstIpi2);
    ipiXml = ipiNt
      ? `<IPI><cEnq>999</cEnq><IPINT><CST>${cstIpi2}</CST></IPINT></IPI>`
      : `<IPI><cEnq>999</cEnq><IPITrib><CST>${cstIpi2}</CST><vBC>${formatNumber(vBCIpi || 0, 2)}</vBC><pIPI>${formatNumber(pIpi || 0, 4)}</pIPI><vIPI>${formatNumber(vIpi || 0, 2)}</vIPI></IPITrib></IPI>`;
  }

  return aplicarIpiDevolucaoNoImposto({
    xml: `
          ${icmsXml}
          ${ipiXml}
          ${pisXml}
          ${cofinsXml}`,
    totais: {
      vBC: num(vBC),
      vICMS: num(vICMS),
      vBCST: 0,
      vST: 0,
      vFCP: 0,
      vFCPST: 0,
      vPis: num(vPis),
      vCofins: num(vCofins),
      vIpi: num(vIpi),
      vIpiDevol: num(item.v_ipi_devol != null ? item.v_ipi_devol : vIpi)
    },
    espelhado: false,
    resolucao
  }, item);
}

/**
 * @param {object} params
 * @param {object} params.config
 * @param {object} params.compra
 * @param {Array} params.itens
 * @param {number} params.numero
 * @param {string} [params.observacoes]
 * @param {string} [params.cfopOverride]
 */
function buildXmlNFeDevolucaoCompra({ config, compra, itens, numero, observacoes, cfopOverride }) {
  const refNFe = onlyDigits(compra.chave_acesso || compra.refNFe || '');
  if (refNFe.length !== 44) {
    throw Object.assign(
      new Error('A compra precisa ter a chave de acesso da NF-e original com 44 dígitos.'),
      { code: 'REF_NFE_INVALIDA', statusCode: 400 }
    );
  }
  if (!Array.isArray(itens) || !itens.length) {
    throw Object.assign(new Error('Informe ao menos um produto para devolução.'), {
      code: 'ITENS_VAZIOS',
      statusCode: 400
    });
  }

  const dest = resolverDestinatarioDevolucaoCompra(compra, config);
  const destDiagnostico = {
    geradoEm: new Date().toISOString(),
    builder: 'xmlBuilderNfeDevolucaoCompra.buildXmlNFeDevolucaoCompra',
    funcao: 'resolverDestinatarioDevolucaoCompra',
    cnpjDestinatario: dest.cnpj,
    ieDestinatario: dest.IE || null,
    indIEDest: dest.indIEDest,
    origem: dest.origem || null,
    emitenteOriginal: compra.emitenteOriginal || compra.emitente_original || null
  };
  console.log('[RC6.2 DEST]', JSON.stringify(destDiagnostico));
  const cnpjFornecedor = dest.cnpj;

  if (!cnpjFornecedor || cnpjFornecedor.length !== 14) {
    throw Object.assign(new Error('Fornecedor da compra sem CNPJ válido.'), {
      code: 'FORNECEDOR_INVALIDO',
      statusCode: 400
    });
  }

  const dhEmi = nowDhEmi();
  const aamm = dhEmi.slice(2, 4) + dhEmi.slice(5, 7);
  const cNF = gerarCodigoNumerico();
  const serie = Number(config.serie || 1);

  const chave = gerarChaveAcesso({
    uf: config.codigoUf,
    aamm,
    cnpj: config.cnpj,
    modelo: '55',
    serie,
    numero,
    tpEmis: '1',
    cNF
  });

  const idDest =
    String((dest.UF || '').toUpperCase()) === String(config.uf || '').toUpperCase()
      ? '1'
      : '2';
  const cfopPadrao = onlyDigits(cfopOverride || (idDest === '1' ? '5202' : '6202')).slice(0, 4)
    || (idDest === '1' ? '5202' : '6202');

  let nomeEmpresaCertificado = null;
  if (config.certificadoPath && config.certificadoSenha) {
    try {
      nomeEmpresaCertificado = extrairNomeEmpresaDoCertificado(
        config.certificadoPath,
        config.certificadoSenha
      );
    } catch (_) {
      /* fallback config */
    }
  }

  const nomeEmpresa = nomeEmpresaCertificado || config.nomeEmpresa || 'EMPRESA NAO INFORMADA';
  const xFant =
    nomeEmpresa
      .replace(/\s+(LTDA|EIRELI|ME|EPP|SS|S\/A|S\.A\.|LIMITADA|SOCIEDADE)\.?$/gi, '')
      .trim() || nomeEmpresa;

  let totalProdutos = 0;
  let totVBC = 0;
  let totVICMS = 0;
  let totVBCST = 0;
  let totVST = 0;
  let totVFCP = 0;
  let totVFCPST = 0;
  let totVPIS = 0;
  let totVCOFINS = 0;
  let totVIPI = 0;
  let totVFrete = 0;
  let totVSeg = 0;
  let totVDesc = 0;
  let totVOutro = 0;
  let totVICMSDeson = 0;
  let totVFCPSTRet = 0;
  const resolucaoIcms = [];
  const vipiDevolItens = [];
  const diagnosticoIpiItens = [];

  const detXml = itens.map((item, idx) => {
    const nome = item.produto_nome || item.descricao_produto || 'PRODUTO DEVOLVIDO';
    const codigo = item.produto_codigo || item.produto_id || item.id || idx + 1;
    const ncm = onlyDigits(item.produto_ncm || item.ncm || '').padEnd(8, '0').slice(0, 8);
    if (!ncm || ncm === '00000000') {
      throw Object.assign(new Error(`NCM ausente no item ${idx + 1} (deve vir da NF-e original).`), {
        code: 'NCM_AUSENTE',
        statusCode: 400
      });
    }
    const cest = onlyDigits(item.cest || item.CEST || '');
    const unidade = String(item.produto_unidade || item.unidade || 'UN').substring(0, 6).toUpperCase();
    const qtd = Number(item.quantidade || 0);
    if (!(qtd > 0)) {
      throw Object.assign(new Error(`Quantidade inválida no item ${idx + 1}.`), {
        code: 'QTD_INVALIDA',
        statusCode: 400
      });
    }
    const valorUnit = Number(item.valor_unitario != null ? item.valor_unitario : (item.custo_unitario_final || item.preco_unitario || 0));
    const valorTotal = num(qtd * valorUnit);
    totalProdutos += valorTotal;

    const cfopItem = onlyDigits(item.cfop || cfopPadrao).slice(0, 4) || cfopPadrao;
    const imposto = montarImpostoItem({ compra, item, config, valorItem: valorTotal });
    if (imposto.resolucao) {
      resolucaoIcms.push(resumoResolucaoIcms(imposto.resolucao, {
        item: idx + 1,
        produto: nome
      }));
    }
    totVBC += imposto.totais.vBC || 0;
    totVICMS += imposto.totais.vICMS || 0;
    totVBCST += imposto.totais.vBCST || 0;
    totVST += imposto.totais.vST || 0;
    totVFCP += imposto.totais.vFCP || 0;
    totVFCPST += imposto.totais.vFCPST || 0;
    totVPIS += imposto.totais.vPis || 0;
    totVCOFINS += imposto.totais.vCofins || 0;
    totVIPI += imposto.totais.vIpi || 0;
    const vIpiDevolItem = arredondarMoeda(imposto.totais.vIpiDevol || 0);
    vipiDevolItens.push(vIpiDevolItem);
    diagnosticoIpiItens.push({
      nItem: idx + 1,
      codigo: String(codigo),
      qtdOriginal: Number(
        item.quantidade_original != null
          ? item.quantidade_original
          : (item.espelhamento && item.espelhamento.quantidade_original) || qtd
      ),
      qtdDevolvida: qtd,
      percentualDevolucao: imposto.ipiDevolucao ? imposto.ipiDevolucao.percentualDevolucao : 0,
      vIPIOriginal: imposto.ipiDevolucao ? imposto.ipiDevolucao.vIPIOriginal : 0,
      vIPIDevolCalculado: vIpiDevolItem
    });
    totVICMSDeson += num(imposto.totais.vICMSDeson || item.v_icms_deson || 0);
    totVFCPSTRet += num(imposto.totais.vFCPSTRet || item.v_fcpst_ret || 0);

    const vFreteItem = num(item.vFrete != null ? item.vFrete : item.v_frete);
    const vSegItem = num(item.vSeg != null ? item.vSeg : item.v_seg);
    const vDescItem = num(item.vDesc != null ? item.vDesc : item.v_desc);
    const vOutroItem = num(item.vOutro != null ? item.vOutro : item.v_outro);
    totVFrete += vFreteItem;
    totVSeg += vSegItem;
    totVDesc += vDescItem;
    totVOutro += vOutroItem;

    const gtin = onlyDigits(item.codigo_barras || item.produto_codigo_barras || item.cEAN || '');
    const cEAN = gtin.length >= 8 ? gtin : 'SEM GTIN';

    return `
      <det nItem="${idx + 1}">
        <prod>
          <cProd>${xmlEscape(codigo)}</cProd>
          <cEAN>${cEAN}</cEAN>
          <xProd>${xmlEscape(String(nome).substring(0, 120))}</xProd>
          <NCM>${ncm}</NCM>
          ${cest.length >= 7 ? `<CEST>${cest.slice(0, 7)}</CEST>` : ''}
          <CFOP>${cfopItem}</CFOP>
          <uCom>${xmlEscape(unidade)}</uCom>
          <qCom>${formatNumber(qtd, 4)}</qCom>
          <vUnCom>${formatNumber(valorUnit, 10)}</vUnCom>
          <vProd>${formatNumber(valorTotal, 2)}</vProd>
          <cEANTrib>${cEAN}</cEANTrib>
          <uTrib>${xmlEscape(unidade)}</uTrib>
          <qTrib>${formatNumber(qtd, 4)}</qTrib>
          <vUnTrib>${formatNumber(valorUnit, 10)}</vUnTrib>
          ${vFreteItem > 0 ? `<vFrete>${formatNumber(vFreteItem, 2)}</vFrete>` : ''}
          ${vSegItem > 0 ? `<vSeg>${formatNumber(vSegItem, 2)}</vSeg>` : ''}
          ${vDescItem > 0 ? `<vDesc>${formatNumber(vDescItem, 2)}</vDesc>` : ''}
          ${vOutroItem > 0 ? `<vOutro>${formatNumber(vOutroItem, 2)}</vOutro>` : ''}
          <indTot>1</indTot>
        </prod>
        <imposto>
          ${imposto.xml}
        </imposto>
        ${imposto.xmlImpostoDevol || ''}
      </det>`;
  }).join('');

  totalProdutos = num(totalProdutos);
  totVIPI = num(totVIPI);
  const totVIPIDevol = somarMoeda(vipiDevolItens);
  totVFrete = num(totVFrete);
  totVSeg = num(totVSeg);
  totVDesc = num(totVDesc);
  totVOutro = num(totVOutro);
  totVST = num(totVST);
  totVFCPST = num(totVFCPST);
  totVFCPSTRet = num(totVFCPSTRet);
  totVICMSDeson = num(totVICMSDeson);
  // Em devolução, IPI espelhado entra tipicamente como vIPIDevol (não soma em vIPI + vNF duplicado)
  const vIPIXml = totVIPIDevol > 0 ? 0 : totVIPI;
  const vIPIDevolXml = totVIPIDevol > 0 ? totVIPIDevol : 0;
  const totaisIcms = {
    vProd: totalProdutos,
    vDesc: totVDesc,
    vICMSDeson: totVICMSDeson,
    vST: totVST,
    vFCPST: totVFCPST,
    vFCPSTRet: totVFCPSTRet,
    vFrete: totVFrete,
    vSeg: totVSeg,
    vOutro: totVOutro,
    vII: 0,
    vIPI: vIPIXml,
    vIPIDevol: vIPIDevolXml
  };
  const vNF = calcularVNFSefaz(totaisIcms);

  const destUf = dest.UF;
  const destXMun = dest.xMun;
  const destCMun = resolverMunicipioDestinatario({
    cidade: destXMun,
    uf: destUf,
    codigoMunicipio: dest.cMun
  });
  validarMunicipioDestinatario({
    uf: destUf,
    xMun: destXMun,
    cMun: destCMun
  });

  const cplBase = sanitizarInfCplNfe(
    observacoes ||
    `Devolucao referente a NF-e ${refNFe}. Compra interna #${compra.id}.`
  );

  const xml = `
    <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
      <infNFe versao="4.00" Id="NFe${chave}">
        <ide>
          <cUF>${config.codigoUf}</cUF>
          <cNF>${cNF}</cNF>
          <natOp>DEVOLUCAO DE COMPRA</natOp>
          <mod>55</mod>
          <serie>${serie}</serie>
          <nNF>${numero}</nNF>
          <dhEmi>${dhEmi}</dhEmi>
          <dhSaiEnt>${dhEmi}</dhSaiEnt>
          <tpNF>1</tpNF>
          <idDest>${idDest}</idDest>
          <cMunFG>${config.municipioCodigo}</cMunFG>
          <tpImp>1</tpImp>
          <tpEmis>1</tpEmis>
          <cDV>${chave.slice(-1)}</cDV>
          <tpAmb>${config.ambiente}</tpAmb>
          <finNFe>4</finNFe>
          <indFinal>0</indFinal>
          <indPres>9</indPres>
          <procEmi>0</procEmi>
          <verProc>CDS-ERP-NFe-Dev-1.0</verProc>
          <NFref>
            <refNFe>${refNFe}</refNFe>
          </NFref>
        </ide>
        <emit>
          <CNPJ>${onlyDigits(config.cnpj)}</CNPJ>
          <xNome>${xmlEscape(nomeEmpresa)}</xNome>
          <xFant>${xmlEscape(xFant)}</xFant>
          <enderEmit>
            <xLgr>${xmlEscape(config.logradouro || 'ENDERECO NAO INFORMADO')}</xLgr>
            <nro>${xmlEscape((config.numero && String(config.numero).trim() !== '') ? String(config.numero).trim() : 'S/N')}</nro>
            <xBairro>${xmlEscape(config.bairro || 'CENTRO')}</xBairro>
            <cMun>${config.municipioCodigo}</cMun>
            <xMun>${xmlEscape(config.municipioNome)}</xMun>
            <UF>${xmlEscape(config.uf)}</UF>
            <CEP>${onlyDigits(config.cep)}</CEP>
            <cPais>1058</cPais>
            <xPais>BRASIL</xPais>
            <fone>${onlyDigits(config.telefone)}</fone>
          </enderEmit>
          <IE>${onlyDigits(config.ie)}</IE>
          <CRT>${config.crt}</CRT>
        </emit>
        <dest>
          <CNPJ>${cnpjFornecedor}</CNPJ>
          <xNome>${xmlEscape(dest.xNome)}</xNome>
          <enderDest>
            <xLgr>${xmlEscape(dest.xLgr)}</xLgr>
            <nro>${xmlEscape(dest.nro)}</nro>
            <xBairro>${xmlEscape(dest.xBairro)}</xBairro>
            <cMun>${destCMun}</cMun>
            <xMun>${xmlEscape(destXMun)}</xMun>
            <UF>${xmlEscape(destUf)}</UF>
            <CEP>${onlyDigits(dest.CEP)}</CEP>
            <cPais>${dest.cPais || '1058'}</cPais>
            <xPais>${xmlEscape(dest.xPais || 'BRASIL')}</xPais>
            ${dest.fone ? `<fone>${onlyDigits(dest.fone)}</fone>` : ''}
          </enderDest>
          <indIEDest>${dest.indIEDest}</indIEDest>
          ${dest.indIEDest === '1' && dest.IE ? `<IE>${dest.IE}</IE>` : ''}
        </dest>
        ${detXml}
        <total>
          <ICMSTot>
            <vBC>${formatNumber(num(totVBC), 2)}</vBC>
            <vICMS>${formatNumber(num(totVICMS), 2)}</vICMS>
            <vICMSDeson>${formatNumber(totVICMSDeson, 2)}</vICMSDeson>
            <vFCP>${formatNumber(num(totVFCP), 2)}</vFCP>
            <vBCST>${formatNumber(num(totVBCST), 2)}</vBCST>
            <vST>${formatNumber(totVST, 2)}</vST>
            <vFCPST>${formatNumber(totVFCPST, 2)}</vFCPST>
            <vFCPSTRet>${formatNumber(totVFCPSTRet, 2)}</vFCPSTRet>
            <vProd>${formatNumber(totalProdutos, 2)}</vProd>
            <vFrete>${formatNumber(totVFrete, 2)}</vFrete>
            <vSeg>${formatNumber(totVSeg, 2)}</vSeg>
            <vDesc>${formatNumber(totVDesc, 2)}</vDesc>
            <vII>0.00</vII>
            <vIPI>${formatNumber(vIPIXml, 2)}</vIPI>
            <vIPIDevol>${formatNumber(vIPIDevolXml, 2)}</vIPIDevol>
            <vPIS>${formatNumber(num(totVPIS), 2)}</vPIS>
            <vCOFINS>${formatNumber(num(totVCOFINS), 2)}</vCOFINS>
            <vOutro>${formatNumber(totVOutro, 2)}</vOutro>
            <vNF>${formatNumber(vNF, 2)}</vNF>
          </ICMSTot>
        </total>
        <transp><modFrete>9</modFrete></transp>
        <pag><detPag><tPag>90</tPag><vPag>0.00</vPag></detPag></pag>
        <infAdic>
          <infCpl>${xmlEscape(cplBase)}</infCpl>
        </infAdic>
      </infNFe>
    </NFe>
  `;

  const xmlCompacto = compactarXml(xml);
  validarIcmsXmlContraCrt(xmlCompacto, config.crt);

  return {
    destDiagnostico,
    chave,
    serie,
    numero,
    refNFe,
    referenciaPorItem: false,
    finNFe: 4,
    tpNF: 1,
    natOp: 'DEVOLUCAO DE COMPRA',
    totalProdutos: vNF,
    cfop: cfopPadrao,
    xmlSemAssinatura: xmlCompacto,
    infCpl: cplBase,
    resolucaoIcms,
    diagnosticoIpiDevol: {
      compraId: compra.id,
      nfeNumero: numero,
      itens: diagnosticoIpiItens,
      somaVipiDevolItens: totVIPIDevol,
      vIPIDevolTotalXml: vIPIDevolXml,
      diferenca: arredondarMoeda(vIPIDevolXml - totVIPIDevol),
      validacao: arredondarMoeda(vIPIDevolXml - totVIPIDevol) === 0 ? 'OK' : 'DIVERGENTE'
    }
  };
}

function resolverNItemOrigemItem(item, idx) {
  const n = Number(
    item.nItemOrigem
    || item.n_item_origem
    || (item.espelhamento && item.espelhamento.nItemOrigem)
    || 0
  );
  if (!(n > 0)) {
    throw Object.assign(
      new Error(`Item ${idx + 1} sem nItem da NF-e original (DFeReferenciado). Emissão bloqueada.`),
      { code: 'NITEM_ORIGEM_INDETERMINADO', statusCode: 400 }
    );
  }
  return n;
}

function montarXmlDfeReferenciado(chaveAcesso, nItem) {
  const chave = onlyDigits(chaveAcesso);
  const n = Number(nItem);
  if (chave.length !== 44 || !(n > 0)) {
    throw Object.assign(
      new Error('DFeReferenciado inválido: informe chaveAcesso (44) e nItem da NF-e original.'),
      { code: 'DFE_REFERENCIADO_INVALIDO', statusCode: 400 }
    );
  }
  return `<DFeReferenciado><chaveAcesso>${chave}</chaveAcesso><nItem>${n}</nItem></DFeReferenciado>`;
}

function validarDestinatarioDevolucaoAntesAssinatura({ xml, emitenteOriginal, destDiagnostico } = {}) {
  const orig = emitenteOriginal && typeof emitenteOriginal === 'object' ? emitenteOriginal : {};
  const ieOrig = ieContribuinte(orig.IE || orig.ie);
  const xmlTxt = String(xml || '');
  const destBloco = xmlTxt.match(/<(?:\w+:)?dest\b[^>]*>([\s\S]*?)<\/(?:\w+:)?dest>/i);
  const destXml = destBloco ? destBloco[1] : '';
  const indXml = (destXml.match(/<(?:\w+:)?indIEDest(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?indIEDest>/i) || [])[1];
  const ieXml = (destXml.match(/<(?:\w+:)?IE(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?IE>/i) || [])[1];
  const ind = String((destDiagnostico && destDiagnostico.indIEDest) || indXml || '').trim();
  if (ieOrig && ind === '9') {
    throw Object.assign(
      new Error(
        'Destinatário da devolução foi identificado como não contribuinte, mas a NF-e original informa IE válida.'
      ),
      { code: 'DEST_IE_INCONSISTENTE', statusCode: 400 }
    );
  }
  return {
    ok: true,
    indIEDest: ind || null,
    ieXml: ieXml || (destDiagnostico && destDiagnostico.ieDestinatario) || null,
    ieOrigem: ieOrig || null
  };
}

module.exports = {
  buildXmlNFeDevolucaoCompra,
  sanitizarInfCplNfe,
  montarImpostoItem,
  montarXmlDfeReferenciado,
  resolverNItemOrigemItem,
  resolverDestinatarioDevolucaoCompra,
  normalizarEmitenteOriginalNfe,
  extrairEmitenteOriginalDoXmlBruto,
  mesclarEmitenteOriginal,
  validarDestinatarioDevolucaoAntesAssinatura
};
