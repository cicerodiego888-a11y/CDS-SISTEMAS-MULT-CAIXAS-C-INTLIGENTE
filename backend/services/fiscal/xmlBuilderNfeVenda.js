/**
 * Builder XML NF-e modelo 55 para venda (Sprint 3.2 + RC7.10.4).
 * Alinhado a MODELO_BRUTO / MODELO_LIQUIDO (fonte única modeloTotais).
 * NÃO altera Motor / MIDP / SOAP.
 */

'use strict';

const {
  onlyDigits,
  padLeft,
  formatNumber,
  nowDhEmi,
  gerarCodigoNumerico,
  gerarChaveAcesso,
  xmlEscape,
  compactarXml
} = require('./utils');
const { extrairNomeEmpresaDoCertificado } = require('./certificateService');
const {
  MODELO_BRUTO,
  MODELO_LIQUIDO,
  determinarModeloDeTotais,
  validarIdentidadeICMSTot,
  round2
} = require('./modeloTotais');
const { resolverNomeDestinatarioNfe } = require('./nfeRetornoAutorizacao');

/** Hotfix: NF-e consome exclusivamente a parcela fiscal do Motor. */
function itemEntraNaNfe(item) {
  return Number(item.quantidade_fiscal || 0) > 0
    && Number(item.valor_fiscal || 0) > 0;
}

/**
 * RC3.16.7 / RC3.16.12 — Identificação do destinatário (<dest>).
 * Schema NF-e 4.00: obrigatório CPF | CNPJ | idEstrangeiro.
 * Nunca gera 00000000000000 / tags vazias / placeholder.
 *
 * @returns {{
 *   tipoPessoa: string,
 *   cpf: string|null,
 *   cnpj: string|null,
 *   idEstrangeiro: string|null,
 *   documentoUtilizado: string|null,
 *   tagXml: string,
 *   grupoDestDoc: 'CPF'|'CNPJ'|'idEstrangeiro'|'AUSENTE'
 * }}
 */
const MSG_DEST_SEM_DOCUMENTO =
  'NÃO É POSSÍVEL EMITIR NF-e SEM CPF, CNPJ OU ID ESTRANGEIRO DO DESTINATÁRIO.';

function montarDocumentoDestinatarioNfe(venda = {}, dadosNfe = {}) {
  const bruto = onlyDigits(
    dadosNfe.dest_cnpj
    || dadosNfe.dest_cpf
    || dadosNfe.dest_documento
    || venda.cliente_cpf
    || venda.cpf_cnpj_nota
    || venda.cliente_cnpj
    || venda.cliente_documento
    || ''
  );

  const idEstrangeiroRaw = String(
    dadosNfe.dest_id_estrangeiro
    || dadosNfe.id_estrangeiro
    || venda.cliente_id_estrangeiro
    || venda.id_estrangeiro
    || ''
  ).trim();

  // XSD idEstrangeiro: 5..20 chars [!-ÿ] (vazio não conta como identificação)
  const idEstrangeiroValido = /^[!-\u00FF]{5,20}$/.test(idEstrangeiroRaw)
    ? idEstrangeiroRaw
    : null;

  const tipoRaw = String(
    dadosNfe.dest_tipo_pessoa
    || venda.cliente_tipo_pessoa
    || venda.tipo_pessoa
    || venda.cliente_tipo
    || ''
  ).toUpperCase().trim();

  let tipoPessoa = 'DESCONHECIDO';
  if (tipoRaw === 'F' || tipoRaw === 'PF' || tipoRaw.includes('FISIC')) tipoPessoa = 'PF';
  else if (tipoRaw === 'J' || tipoRaw === 'PJ' || tipoRaw.includes('JURID')) tipoPessoa = 'PJ';
  else if (tipoRaw === 'E' || tipoRaw.includes('ESTRANG')) tipoPessoa = 'ESTRANGEIRO';
  else if (bruto.length === 11) tipoPessoa = 'PF';
  else if (bruto.length === 14) tipoPessoa = 'PJ';

  const docInvalidoZerado = !bruto
    || /^0+$/.test(bruto)
    || bruto === '00000000000000'
    || bruto === '00000000000';

  let cpf = null;
  let cnpj = null;
  let idEstrangeiro = null;
  let documentoUtilizado = null;
  let grupoDestDoc = 'AUSENTE';
  let tagXml = '';

  if (!docInvalidoZerado) {
    if (tipoPessoa === 'PF' && bruto.length === 11) {
      cpf = bruto;
      documentoUtilizado = bruto;
      grupoDestDoc = 'CPF';
      tagXml = `<CPF>${bruto}</CPF>`;
    } else if (tipoPessoa === 'PJ' && bruto.length === 14) {
      cnpj = bruto;
      documentoUtilizado = bruto;
      grupoDestDoc = 'CNPJ';
      tagXml = `<CNPJ>${bruto}</CNPJ>`;
    } else if (bruto.length === 11) {
      tipoPessoa = 'PF';
      cpf = bruto;
      documentoUtilizado = bruto;
      grupoDestDoc = 'CPF';
      tagXml = `<CPF>${bruto}</CPF>`;
    } else if (bruto.length === 14) {
      tipoPessoa = 'PJ';
      cnpj = bruto;
      documentoUtilizado = bruto;
      grupoDestDoc = 'CNPJ';
      tagXml = `<CNPJ>${bruto}</CNPJ>`;
    }
    // Comprimento inválido (≠11 e ≠14): não inventa CPF/CNPJ
  }

  // Fallback: estrangeiro somente se não houver CPF/CNPJ válido
  if (grupoDestDoc === 'AUSENTE' && idEstrangeiroValido) {
    idEstrangeiro = idEstrangeiroValido;
    documentoUtilizado = idEstrangeiroValido;
    grupoDestDoc = 'idEstrangeiro';
    tagXml = `<idEstrangeiro>${xmlEscape(idEstrangeiroValido)}</idEstrangeiro>`;
    if (tipoPessoa === 'DESCONHECIDO') tipoPessoa = 'ESTRANGEIRO';
  }

  console.log('[NFE][DEST]', JSON.stringify({
    tipoPessoa,
    cpf,
    cnpj,
    idEstrangeiro,
    documentoUtilizado,
    grupoDest: grupoDestDoc,
    'Documento utilizado': grupoDestDoc === 'AUSENTE' ? '(ausente)' : grupoDestDoc,
    tagXml: tagXml || '(sem CPF/CNPJ/idEstrangeiro)'
  }));

  return {
    tipoPessoa,
    cpf,
    cnpj,
    idEstrangeiro,
    documentoUtilizado,
    tagXml,
    grupoDestDoc
  };
}

/**
 * RC3.16.12 — Bloqueia emissão sem identificador obrigatório do schema.
 */
function assertDestinatarioIdentificadoNfe(destDocInfo) {
  const ok = destDocInfo
    && destDocInfo.grupoDestDoc
    && destDocInfo.grupoDestDoc !== 'AUSENTE'
    && destDocInfo.tagXml
    && String(destDocInfo.tagXml).trim();
  if (ok) return destDocInfo;

  const err = new Error(MSG_DEST_SEM_DOCUMENTO);
  err.code = 'DEST_SEM_DOCUMENTO';
  err.status = 'erro_validacao';
  throw err;
}

function obterQuantidadeFiscalItem(item = {}) {
  return Number(item.quantidade_fiscal || 0);
}

function obterValorFiscalItem(item = {}) {
  return Number(item.valor_fiscal || 0);
}

function obterPrecoUnitarioFiscalItem(item = {}) {
  const q = obterQuantidadeFiscalItem(item);
  const v = obterValorFiscalItem(item);
  if (q > 0 && v > 0) return v / q;
  return Number(item.preco_unitario || 0);
}

function mapearFormaPagamento(forma) {
  const f = String(forma || '').toLowerCase();
  if (f.includes('dinheiro') || f === '01') return '01';
  if (f.includes('cheque')) return '02';
  if (f.includes('credito') || f.includes('crédito')) return '03';
  if (f.includes('debito') || f.includes('débito')) return '04';
  if (f.includes('pix')) return '17';
  if (f.includes('prazo') || f.includes('crediario')) return '05';
  return '99';
}

function ratearDescontoNosItens(itens, descontoTotal) {
  const desconto = Number(descontoTotal || 0);
  if (!desconto || desconto <= 0 || !Array.isArray(itens) || itens.length === 0) {
    return itens.map((item) => ({ ...item, desconto_rateado: 0 }));
  }
  const totalProdutos = itens.reduce((soma, item) => soma + obterValorFiscalItem(item), 0);
  if (totalProdutos <= 0) {
    return itens.map((item) => ({ ...item, desconto_rateado: 0 }));
  }
  let somaDescontos = 0;
  return itens.map((item, index) => {
    const totalItem = obterValorFiscalItem(item);
    let descontoItem;
    if (index === itens.length - 1) {
      descontoItem = round2(desconto - somaDescontos);
    } else {
      descontoItem = round2((totalItem / totalProdutos) * desconto);
      somaDescontos += descontoItem;
    }
    if (descontoItem < 0) descontoItem = 0;
    if (descontoItem > totalItem) descontoItem = totalItem;
    return { ...item, desconto_rateado: descontoItem };
  });
}

/**
 * @param {object} args
 * @param {object} args.config — getFiscalConfig()
 * @param {object} args.venda
 * @param {Array} args.itens
 * @param {number} args.numero
 * @param {object} [args.dadosNfe]
 */
function buildNfeXml({ config, venda, itens, numero, dadosNfe = {} }) {
  // RC3.16.11 — TRACE
  try {
    const { traceNfe } = require('./nfeTrace');
    traceNfe('buildNfeXml', {
      vendaId: venda?.id || null,
      numero,
      serie: config?.serieNfe || config?.serie || null,
      ambiente: config?.ambiente
    });
  } catch (_) { /* trace não bloqueia */ }

  const dhEmi = nowDhEmi();
  const aamm = dhEmi.slice(2, 4) + dhEmi.slice(5, 7);
  const cNF = gerarCodigoNumerico();
  const serie = Number(config.serieNfe || config.serie || 1);

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

  let nomeEmpresa = config.nomeEmpresa || 'EMPRESA NAO INFORMADA';
  if (config.certificadoPath && config.certificadoSenha) {
    try {
      nomeEmpresa = extrairNomeEmpresaDoCertificado(config.certificadoPath, config.certificadoSenha) || nomeEmpresa;
    } catch (_) { /* ignore */ }
  }

  const natOp = String(dadosNfe.natureza_operacao || 'VENDA DE MERCADORIA').substring(0, 60);
  const cfopPadrao = onlyDigits(dadosNfe.cfop || '5102').substring(0, 4) || '5102';

  const destDocInfo = assertDestinatarioIdentificadoNfe(
    montarDocumentoDestinatarioNfe(venda, dadosNfe)
  );
  // RC3.16.3 — homologação (tpAmb=2): somente xNome muda; CPF/CNPJ/endereço intactos
  const destNome = xmlEscape(
    resolverNomeDestinatarioNfe(config.ambiente, venda.cliente_nome)
  ).substring(0, 60);
  const destTag = destDocInfo.tagXml;

  // Ordem XSD 4.00: CPF|CNPJ|idEstrangeiro → xNome → enderDest → indIEDest → (IE/email opcionais)
  const enderDest = `
    <enderDest>
      <xLgr>${xmlEscape(String(dadosNfe.dest_logradouro || venda.cliente_rua || 'NAO INFORMADO').substring(0, 60))}</xLgr>
      <nro>${xmlEscape(String(dadosNfe.dest_numero || venda.cliente_numero || 'S/N').substring(0, 60))}</nro>
      <xBairro>${xmlEscape(String(dadosNfe.dest_bairro || venda.cliente_bairro || 'CENTRO').substring(0, 60))}</xBairro>
      <cMun>${onlyDigits(dadosNfe.dest_codigo_municipio || config.codigo_municipio || '2307304')}</cMun>
      <xMun>${xmlEscape(String(dadosNfe.dest_municipio || venda.cliente_cidade || config.municipio_nome || 'JUAZEIRO DO NORTE').substring(0, 60))}</xMun>
      <UF>${xmlEscape(String(dadosNfe.dest_uf || venda.cliente_uf || config.uf_sigla || 'CE').substring(0, 2))}</UF>
      <CEP>${padLeft(onlyDigits(dadosNfe.dest_cep || venda.cliente_cep || '00000000'), 8)}</CEP>
      <cPais>1058</cPais>
      <xPais>BRASIL</xPais>
    </enderDest>`;

  const itensFiscais = (itens || []).filter(itemEntraNaNfe);

  const vendaTotais = {
    ...venda,
    desconto: Number(venda.desconto != null ? venda.desconto : (dadosNfe.desconto || 0)),
    frete: Number(dadosNfe.frete || venda.frete || 0),
    outro: Number(dadosNfe.acrescimo || venda.outro || 0),
    valor_fiscal: venda.valor_fiscal != null
      ? venda.valor_fiscal
      : itensFiscais.reduce((s, i) => s + obterValorFiscalItem(i), 0)
  };

  const modeloTotais = determinarModeloDeTotais({ itens: itensFiscais, venda: vendaTotais });
  const usarModeloBruto = modeloTotais.modelo === MODELO_BRUTO;
  const itensVenda = usarModeloBruto
    ? ratearDescontoNosItens(itensFiscais, modeloTotais.vDesc)
    : itensFiscais.map((item) => ({ ...item, desconto_rateado: 0 }));

  let vProd = 0;
  let vDesc = 0;
  const dets = itensVenda.map((item, idx) => {
    const qCom = obterQuantidadeFiscalItem(item);
    const vItem = round2(obterValorFiscalItem(item));
    const vUn = obterPrecoUnitarioFiscalItem(item);
    // Só rateio do desconto da venda; desconto de item já está no valor líquido.
    let descontoItem = usarModeloBruto ? round2(item.desconto_rateado || 0) : 0;
    if (descontoItem > vItem) descontoItem = vItem;
    if (descontoItem < 0) descontoItem = 0;
    vProd += vItem;
    vDesc += descontoItem;
    const ncm = onlyDigits(item.produto_ncm || item.ncm || '00000000').padStart(8, '0').substring(0, 8);
    const cfop = onlyDigits(item.cfop || cfopPadrao).substring(0, 4) || cfopPadrao;
    const uCom = String(item.unidade || 'UN').substring(0, 6).toUpperCase();
    const cProd = String(item.produto_id || item.produto_codigo || idx + 1);
    const xProd = xmlEscape(String(item.produto_nome || 'PRODUTO').substring(0, 120));
    const csosn = String(item.csosn || '102');
    const orig = String(item.origem != null ? item.origem : '0');

    return `
    <det nItem="${idx + 1}">
      <prod>
        <cProd>${xmlEscape(cProd)}</cProd>
        <cEAN>SEM GTIN</cEAN>
        <xProd>${xProd}</xProd>
        <NCM>${ncm}</NCM>
        <CFOP>${cfop}</CFOP>
        <uCom>${xmlEscape(uCom)}</uCom>
        <qCom>${formatNumber(qCom, 4)}</qCom>
        <vUnCom>${formatNumber(vUn, 10)}</vUnCom>
        <vProd>${formatNumber(vItem, 2)}</vProd>
        <cEANTrib>SEM GTIN</cEANTrib>
        <uTrib>${xmlEscape(uCom)}</uTrib>
        <qTrib>${formatNumber(qCom, 4)}</qTrib>
        <vUnTrib>${formatNumber(vUn, 10)}</vUnTrib>
        ${descontoItem > 0 ? `<vDesc>${formatNumber(descontoItem, 2)}</vDesc>` : ''}
        <indTot>1</indTot>
      </prod>
      <imposto>
        <ICMS>
          <ICMSSN102>
            <orig>${orig}</orig>
            <CSOSN>${csosn}</CSOSN>
          </ICMSSN102>
        </ICMS>
        <PIS><PISOutr><CST>49</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>
        <COFINS><COFINSOutr><CST>49</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>
      </imposto>
    </det>`;
  }).join('');

  vProd = round2(vProd);
  vDesc = round2(usarModeloBruto ? vDesc : 0);
  const vFrete = round2(modeloTotais.vFrete || 0);
  const vOutro = round2(modeloTotais.vOutro || 0);
  const vNF = round2(vProd - vDesc + vFrete + vOutro);

  validarIdentidadeICMSTot({
    modelo: modeloTotais.modelo,
    vProd,
    vDesc,
    vFrete,
    vSeg: 0,
    vOutro,
    vIPI: 0,
    vST: 0,
    vII: 0,
    vPIS: 0,
    vCOFINS: 0,
    vIPIDevol: 0,
    vNF
  });

  const { ehGrupoA } = require('../vendas/recebimentoPagamento');
  const pagamentosOrigem = Array.isArray(venda.pagamentos) ? venda.pagamentos : [];
  const temTipoRecebimento = pagamentosOrigem.some((p) =>
    String(p.tipo_recebimento || p.grupo_recebimento || '').trim() !== ''
  );
  let pagamentosFiscais = pagamentosOrigem.filter((p) => {
    const tipo = p.tipo_recebimento || p.grupo_recebimento;
    if (temTipoRecebimento) {
      return ehGrupoA(tipo);
    }
    return !String(tipo || '').trim() || ehGrupoA(tipo);
  });
  if (!pagamentosFiscais.length) {
    pagamentosFiscais = [{ forma_pagamento: venda.forma_pagamento || 'dinheiro', valor: vNF }];
  }
  pagamentosFiscais = pagamentosFiscais.map((p) => ({
    ...p,
    valor: round2(Number(p.valor || 0))
  }));
  let somaPag = round2(pagamentosFiscais.reduce((s, p) => s + Number(p.valor || 0), 0));
  let vTroco = 0;
  if (somaPag > vNF + 0.009) {
    vTroco = round2(somaPag - vNF);
  } else if (Math.abs(somaPag - vNF) > 0.01 && pagamentosFiscais.length === 1) {
    pagamentosFiscais = [{ ...pagamentosFiscais[0], valor: vNF }];
    somaPag = vNF;
  }

  const detPag = pagamentosFiscais.map((p) => `
      <detPag>
        <tPag>${mapearFormaPagamento(p.forma_pagamento || p.forma)}</tPag>
        <vPag>${formatNumber(Number(p.valor || 0), 2)}</vPag>
      </detPag>`).join('');
  const tagTroco = vTroco > 0.009 ? `<vTroco>${formatNumber(vTroco, 2)}</vTroco>` : '';

  let transp = '<transp><modFrete>9</modFrete></transp>';
  if (dadosNfe.transportadora || Number(dadosNfe.volumes || 0) > 0 || Number(dadosNfe.peso || 0) > 0) {
    const volQ = Number(dadosNfe.volumes || 0);
    const peso = Number(dadosNfe.peso || 0);
    transp = `
    <transp>
      <modFrete>${dadosNfe.mod_frete != null ? dadosNfe.mod_frete : '0'}</modFrete>
      ${dadosNfe.transportadora ? `<transporta><xNome>${xmlEscape(String(dadosNfe.transportadora).substring(0, 60))}</xNome></transporta>` : ''}
      ${volQ > 0 || peso > 0 ? `<vol>
        <qVol>${Math.max(1, Math.round(volQ) || 1)}</qVol>
        <pesoL>${formatNumber(peso || 0, 3)}</pesoL>
        <pesoB>${formatNumber(peso || 0, 3)}</pesoB>
      </vol>` : ''}
    </transp>`;
  }

  const infCpl = xmlEscape(String(dadosNfe.dados_adicionais || dadosNfe.observacoes || venda.observacao || '').substring(0, 5000));
  const cMunFG = onlyDigits(config.municipioCodigo || config.codigo_municipio || '2307304');

  const ide = `
    <ide>
      <cUF>${padLeft(onlyDigits(config.codigoUf || '23'), 2)}</cUF>
      <cNF>${cNF}</cNF>
      <natOp>${xmlEscape(natOp)}</natOp>
      <mod>55</mod>
      <serie>${serie}</serie>
      <nNF>${numero}</nNF>
      <dhEmi>${dhEmi}</dhEmi>
      <tpNF>1</tpNF>
      <idDest>1</idDest>
      <cMunFG>${cMunFG}</cMunFG>
      <tpImp>1</tpImp>
      <tpEmis>1</tpEmis>
      <cDV>${chave.slice(-1)}</cDV>
      <tpAmb>${Number(config.ambiente) === 1 ? 1 : 2}</tpAmb>
      <finNFe>1</finNFe>
      <indFinal>1</indFinal>
      <indPres>1</indPres>
      <procEmi>0</procEmi>
      <verProc>CDGESTAO-NFE-1.0.0</verProc>
    </ide>`;

  const emit = `
    <emit>
      <CNPJ>${onlyDigits(config.cnpj)}</CNPJ>
      <xNome>${xmlEscape(nomeEmpresa.substring(0, 60))}</xNome>
      <enderEmit>
        <xLgr>${xmlEscape(String(config.logradouro || config.endereco || 'RUA NAO INFORMADA').substring(0, 60))}</xLgr>
        <nro>${xmlEscape(String(config.numero || 'S/N'))}</nro>
        <xBairro>${xmlEscape(String(config.bairro || 'CENTRO'))}</xBairro>
        <cMun>${onlyDigits(config.codigo_municipio || '2307304')}</cMun>
        <xMun>${xmlEscape(String(config.municipio_nome || 'JUAZEIRO DO NORTE'))}</xMun>
        <UF>${xmlEscape(String(config.uf_sigla || 'CE'))}</UF>
        <CEP>${padLeft(onlyDigits(config.cep || '00000000'), 8)}</CEP>
        <cPais>1058</cPais>
        <xPais>BRASIL</xPais>
      </enderEmit>
      <IE>${onlyDigits(config.ie)}</IE>
      <CRT>${config.crt || 1}</CRT>
    </emit>`;

  // RC3.16.12 — ordem obrigatória: identificador → xNome → enderDest → indIEDest
  const dest = `
    <dest>
      ${destTag}
      <xNome>${destNome}</xNome>
      ${enderDest}
      <indIEDest>9</indIEDest>
    </dest>`;

  if (String(dest).includes('00000000000000') || String(dest).includes('00000000000')) {
    throw new Error('RC3.16.7 — XML <dest> não pode conter CPF/CNPJ zerado.');
  }
  if (!/<(CPF|CNPJ|idEstrangeiro)>/.test(dest)) {
    throw Object.assign(new Error(MSG_DEST_SEM_DOCUMENTO), { code: 'DEST_SEM_DOCUMENTO' });
  }

  const total = `
    <total>
      <ICMSTot>
        <vBC>0.00</vBC>
        <vICMS>0.00</vICMS>
        <vICMSDeson>0.00</vICMSDeson>
        <vFCP>0.00</vFCP>
        <vBCST>0.00</vBCST>
        <vST>0.00</vST>
        <vFCPST>0.00</vFCPST>
        <vFCPSTRet>0.00</vFCPSTRet>
        <vProd>${formatNumber(vProd, 2)}</vProd>
        <vFrete>${formatNumber(vFrete, 2)}</vFrete>
        <vSeg>0.00</vSeg>
        <vDesc>${formatNumber(vDesc, 2)}</vDesc>
        <vII>0.00</vII>
        <vIPI>0.00</vIPI>
        <vIPIDevol>0.00</vIPIDevol>
        <vPIS>0.00</vPIS>
        <vCOFINS>0.00</vCOFINS>
        <vOutro>${formatNumber(vOutro, 2)}</vOutro>
        <vNF>${formatNumber(vNF, 2)}</vNF>
      </ICMSTot>
    </total>`;

  const xmlSemAssinatura = compactarXml(`<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe${chave}" versao="4.00">
    ${ide}
    ${emit}
    ${dest}
    ${dets}
    ${total}
    ${transp}
    <pag>${detPag}${tagTroco}</pag>
    ${infCpl ? `<infAdic><infCpl>${infCpl}</infCpl></infAdic>` : ''}
  </infNFe>
</NFe>`);

  return {
    chave,
    cNF,
    serie,
    numero,
    vNF,
    vTroco,
    modelo: modeloTotais.modelo,
    valores: { vProd, vDesc, vNF, vTroco, modelo: modeloTotais.modelo },
    destinatario: destDocInfo,
    xmlSemAssinatura
  };
}

module.exports = {
  buildNfeXml,
  itemEntraNaNfe,
  obterQuantidadeFiscalItem,
  obterValorFiscalItem,
  montarDocumentoDestinatarioNfe,
  assertDestinatarioIdentificadoNfe,
  MSG_DEST_SEM_DOCUMENTO,
  MODELO_BRUTO,
  MODELO_LIQUIDO
};
