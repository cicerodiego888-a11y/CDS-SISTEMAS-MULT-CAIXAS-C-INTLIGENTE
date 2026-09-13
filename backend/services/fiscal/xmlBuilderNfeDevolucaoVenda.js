/**
 * Builder XML NF-e de Devolução de Venda (finNFe=4, tpNF=0 — entrada).
 * Reutiliza montarImpostoItem do builder de compra e dest do motor de venda.
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
const { montarDocumentoDestinatarioNfe } = require('./xmlBuilderNfeVenda');
const { resolverNomeDestinatarioNfe } = require('./nfeRetornoAutorizacao');
const { montarImpostoItem } = require('./xmlBuilderNfeDevolucaoCompra');
const { calcularVNFSefaz } = require('./modeloTotais');
const {
  resolverMunicipioDestinatario,
  validarMunicipioDestinatario
} = require('./municipioIbge');

function num(v, casas = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

/**
 * @param {object} params
 * @param {object} params.config
 * @param {object} params.venda
 * @param {Array} params.itens
 * @param {number} params.numero
 * @param {string} [params.observacoes]
 * @param {string} [params.cfopOverride]
 */
function buildXmlNFeDevolucaoVenda({ config, venda, itens, numero, observacoes, cfopOverride }) {
  const refNFe = onlyDigits(venda.chave_acesso || venda.refNFe || venda.chave_nfe || '');
  if (refNFe.length !== 44) {
    throw Object.assign(
      new Error('A venda precisa ter a chave de acesso da NF-e original com 44 dígitos.'),
      { code: 'REF_NFE_INVALIDA', statusCode: 400 }
    );
  }
  if (!Array.isArray(itens) || !itens.length) {
    throw Object.assign(new Error('Informe ao menos um produto para devolução.'), {
      code: 'ITENS_VAZIOS',
      statusCode: 400
    });
  }

  const docDest = montarDocumentoDestinatarioNfe(venda, {});
  if (!docDest.tagXml || docDest.grupoDestDoc === 'AUSENTE') {
    throw Object.assign(
      new Error('Cliente sem CPF/CNPJ válido para destinatário da NF-e de devolução.'),
      { code: 'CLIENTE_SEM_DOCUMENTO', statusCode: 400 }
    );
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

  const ufCliente = String(venda.cliente_uf || venda.uf || config.uf || '').toUpperCase();
  const idDest = ufCliente === String(config.uf || '').toUpperCase() ? '1' : '2';
  const cfopPadrao = onlyDigits(cfopOverride || (idDest === '1' ? '1202' : '2202')).slice(0, 4)
    || (idDest === '1' ? '1202' : '2202');

  let nomeEmpresaCertificado = null;
  if (config.certificadoPath && config.certificadoSenha) {
    try {
      nomeEmpresaCertificado = extrairNomeEmpresaDoCertificado(
        config.certificadoPath,
        config.certificadoSenha
      );
    } catch (_) { /* fallback */ }
  }

  const nomeEmpresa = nomeEmpresaCertificado || config.nomeEmpresa || 'EMPRESA NAO INFORMADA';
  const xFant =
    nomeEmpresa
      .replace(/\s+(LTDA|EIRELI|ME|EPP|SS|S\/A|S\.A\.|LIMITADA|SOCIEDADE)\.?$/gi, '')
      .trim() || nomeEmpresa;

  const nomeDest = resolverNomeDestinatarioNfe(
    config.ambiente,
    venda.cliente_nome || venda.cliente || 'CLIENTE'
  );

  const destXMun = String(venda.cliente_cidade || venda.cidade || '').trim();
  const destCMun = resolverMunicipioDestinatario({
    cidade: destXMun,
    uf: ufCliente,
    codigoMunicipio: venda.cliente_codigo_municipio || venda.codigo_municipio
  });
  validarMunicipioDestinatario({
    uf: ufCliente,
    xMun: destXMun,
    cMun: destCMun
  });

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
  let totVIPIDevol = 0;

  const cabecalhoFiscal = {
    ...venda,
    csosn_cst: venda.csosn || '',
    cst_pis: venda.cst_pis || '',
    cst_cofins: venda.cst_cofins || '',
    cst_ipi: venda.cst_ipi || ''
  };

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
    const valorUnit = Number(item.valor_unitario != null ? item.valor_unitario : (item.preco_unitario || 0));
    const valorTotal = num(qtd * valorUnit);
    totalProdutos += valorTotal;

    const cfopItem = onlyDigits(item.cfop || cfopPadrao).slice(0, 4) || cfopPadrao;
    const imposto = montarImpostoItem({
      compra: cabecalhoFiscal,
      item,
      config,
      valorItem: valorTotal
    });
    totVBC += imposto.totais.vBC || 0;
    totVICMS += imposto.totais.vICMS || 0;
    totVBCST += imposto.totais.vBCST || 0;
    totVST += imposto.totais.vST || 0;
    totVFCP += imposto.totais.vFCP || 0;
    totVFCPST += imposto.totais.vFCPST || 0;
    totVPIS += imposto.totais.vPis || 0;
    totVCOFINS += imposto.totais.vCofins || 0;
    totVIPI += imposto.totais.vIpi || 0;
    totVIPIDevol += imposto.totais.vIpiDevol || 0;

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
  totVIPIDevol = num(totVIPIDevol);
  totVST = num(totVST);
  totVFCPST = num(totVFCPST);
  const vIPIXml = totVIPIDevol > 0 ? 0 : totVIPI;
  const vIPIDevolXml = totVIPIDevol > 0 ? totVIPIDevol : 0;
  const vNF = calcularVNFSefaz({
    vProd: totalProdutos,
    vDesc: 0,
    vST: totVST,
    vFCPST: totVFCPST,
    vIPI: vIPIXml,
    vIPIDevol: vIPIDevolXml
  });

  const cplBase =
    observacoes ||
    `Devolução referente à NF-e ${refNFe}. Venda interna #${venda.id}.`;

  const xml = `
    <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
      <infNFe versao="4.00" Id="NFe${chave}">
        <ide>
          <cUF>${config.codigoUf}</cUF>
          <cNF>${cNF}</cNF>
          <natOp>DEVOLUCAO DE VENDA</natOp>
          <mod>55</mod>
          <serie>${serie}</serie>
          <nNF>${numero}</nNF>
          <dhEmi>${dhEmi}</dhEmi>
          <dhSaiEnt>${dhEmi}</dhSaiEnt>
          <tpNF>0</tpNF>
          <idDest>${idDest}</idDest>
          <cMunFG>${config.municipioCodigo}</cMunFG>
          <tpImp>1</tpImp>
          <tpEmis>1</tpEmis>
          <cDV>${chave.slice(-1)}</cDV>
          <tpAmb>${config.ambiente}</tpAmb>
          <finNFe>4</finNFe>
          <indFinal>1</indFinal>
          <indPres>1</indPres>
          <procEmi>0</procEmi>
          <verProc>CDS-ERP-NFe-DevVenda-1.0</verProc>
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
          ${docDest.tagXml}
          <xNome>${xmlEscape(nomeDest)}</xNome>
          <enderDest>
            <xLgr>${xmlEscape(venda.cliente_rua || venda.rua || 'NAO INFORMADO')}</xLgr>
            <nro>${xmlEscape(venda.cliente_numero || venda.numero || 'S/N')}</nro>
            <xBairro>${xmlEscape(venda.cliente_bairro || venda.bairro || 'CENTRO')}</xBairro>
            <cMun>${destCMun}</cMun>
            <xMun>${xmlEscape(destXMun)}</xMun>
            <UF>${xmlEscape(ufCliente || config.uf)}</UF>
            <CEP>${onlyDigits(venda.cliente_cep || venda.cep || '00000000')}</CEP>
            <cPais>1058</cPais>
            <xPais>BRASIL</xPais>
          </enderDest>
          <indIEDest>9</indIEDest>
        </dest>
        ${detXml}
        <total>
          <ICMSTot>
            <vBC>${formatNumber(num(totVBC), 2)}</vBC>
            <vICMS>${formatNumber(num(totVICMS), 2)}</vICMS>
            <vICMSDeson>0.00</vICMSDeson>
            <vFCP>${formatNumber(num(totVFCP), 2)}</vFCP>
            <vBCST>${formatNumber(num(totVBCST), 2)}</vBCST>
            <vST>${formatNumber(num(totVST), 2)}</vST>
            <vFCPST>${formatNumber(num(totVFCPST), 2)}</vFCPST>
            <vFCPSTRet>0.00</vFCPSTRet>
            <vProd>${formatNumber(totalProdutos, 2)}</vProd>
            <vFrete>0.00</vFrete>
            <vSeg>0.00</vSeg>
            <vDesc>0.00</vDesc>
            <vII>0.00</vII>
            <vIPI>${formatNumber(vIPIXml, 2)}</vIPI>
            <vIPIDevol>${formatNumber(vIPIDevolXml, 2)}</vIPIDevol>
            <vPIS>${formatNumber(num(totVPIS), 2)}</vPIS>
            <vCOFINS>${formatNumber(num(totVCOFINS), 2)}</vCOFINS>
            <vOutro>0.00</vOutro>
            <vNF>${formatNumber(vNF, 2)}</vNF>
          </ICMSTot>
        </total>
        <transp><modFrete>9</modFrete></transp>
        <pag><detPag><tPag>90</tPag><vPag>0.00</vPag></detPag></pag>
        <infAdic>
          <infCpl>${xmlEscape(String(cplBase).substring(0, 5000))}</infCpl>
        </infAdic>
      </infNFe>
    </NFe>
  `;

  return {
    chave,
    serie,
    refNFe,
    finNFe: 4,
    tpNF: 0,
    natOp: 'DEVOLUCAO DE VENDA',
    origem: 'VENDA',
    totalProdutos: vNF,
    cfop: cfopPadrao,
    xmlSemAssinatura: compactarXml(xml)
  };
}

module.exports = {
  buildXmlNFeDevolucaoVenda
};
