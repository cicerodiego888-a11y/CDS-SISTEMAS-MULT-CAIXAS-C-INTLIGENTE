/**
 * DANFE V2 — layout visual (apresentação apenas).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  gerarDanfeNfeHtml,
  gerarDanfeNfePdf,
  montarModeloDanfe
} = require('../../backend/services/fiscal/danfeNfe');
const { paginarItensDanfe } = require('../../backend/services/fiscal/danfePaginacao');

function xmlV2({ nItens = 1, comDup = false, comIeDest = true } = {}) {
  const dets = Array.from({ length: nItens }, (_, i) => `
    <det nItem="${i + 1}"><prod>
      <cProd>${1000 + i}</cProd><xProd>PRODUTO ${i + 1}</xProd>
      <NCM>22021000</NCM><CFOP>5102</CFOP><uCom>UN</uCom>
      <qCom>1.0000</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd>
    </prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det>`).join('');
  const cobr = comDup
    ? `<cobr><dup><nDup>001</nDup><dVenc>2026-10-10</dVenc><vDup>10.00</vDup></dup></cobr>`
    : '';
  const ieDest = comIeDest ? '<IE>063640520</IE>' : '';
  return `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe23260957824986000131550010000001081634555909">
    <ide><natOp>VENDA DE MERCADORIA</natOp><serie>1</serie><nNF>108</nNF>
    <dhEmi>2026-09-24T16:00:00-03:00</dhEmi><dhSaiEnt>2026-09-24T16:00:00-03:00</dhSaiEnt>
    <tpNF>1</tpNF></ide>
    <emit><CNPJ>57824986000131</CNPJ><xNome>SARMENTO CONSTRUCOES</xNome>
      <enderEmit><xLgr>RUA A</xLgr><nro>100</nro><xBairro>CENTRO</xBairro>
      <xMun>Juazeiro do Norte</xMun><UF>CE</UF><CEP>63000000</CEP><fone>88999999999</fone></enderEmit>
      <IE>073252638</IE></emit>
    <dest><CNPJ>09591661000103</CNPJ><xNome>MV ENGENHARIA</xNome>
      <enderDest><xLgr>Rua Jose Candido</xLgr><nro>71</nro><xBairro>Centro</xBairro>
      <xMun>TARRAFAS</xMun><UF>CE</UF><CEP>63145000</CEP><fone>8835212151</fone></enderDest>
      ${ieDest}</dest>
    ${dets}
    <total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vBCST>0.00</vBCST><vST>0.00</vST>
      <vProd>${(10 * nItens).toFixed(2)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg>
      <vDesc>0.00</vDesc><vOutro>0.00</vOutro><vIPI>0.00</vIPI>
      <vNF>${(10 * nItens).toFixed(2)}</vNF></ICMSTot></total>
    <transp><modFrete>9</modFrete></transp>
    ${cobr}
    <infAdic><infCpl>Documento emitido por ME/EPP</infCpl></infAdic>
  </infNFe></NFe>
  <protNFe><infProt><chNFe>23260957824986000131550010000001081634555909</chNFe>
    <nProt>223260102599279</nProt><dhRecbto>2026-09-24T16:01:00-03:00</dhRecbto></infProt></protNFe>
  </nfeProc>`;
}

describe('DANFE V2 — layout visual', () => {
  it('gera HTML V2 com blocos do mockup e dados do documento', async () => {
    const html = await gerarDanfeNfeHtml({
      xml: xmlV2({ nItens: 2, comDup: true }),
      status: 'autorizada',
      protocolo: '223260102599279',
      numero: 108,
      serie: 1
    });
    assert.match(html, /DANFE/);
    assert.match(html, /Recebimento \/ Assinatura|RECEBIMENTO \/ ASSINATURA/i);
    assert.match(html, /DESTINATÁRIO \/ REMETENTE/);
    assert.match(html, /FATURA \/ DUPLICATA/);
    assert.match(html, /Nº DUPLICATA|001/);
    assert.match(html, /CÁLCULO DO IMPOSTO/);
    assert.match(html, /destaque-total/);
    assert.match(html, /VALOR TOTAL DA NOTA/);
    assert.match(html, /TRANSPORTADOR \/ VOLUMES TRANSPORTADOS/);
    assert.match(html, /DADOS DOS PRODUTOS \/ SERVIÇOS/);
    assert.match(html, /DADOS ADICIONAIS/);
    assert.match(html, /RESERVADO AO FISCO/);
    assert.match(html, /MV ENGENHARIA/);
    assert.match(html, /063640520/);
    assert.match(html, /TARRAFAS/);
    assert.match(html, /PROTOCOLO DE AUTORIZAÇÃO DE USO/);
    assert.match(html, /223260102599279/);
    assert.match(html, /NÚMERO/);
    assert.doesNotMatch(html, /<img/i);
  });

  it('logo só aparece quando configurada', async () => {
    const sem = await gerarDanfeNfeHtml({ xml: xmlV2(), status: 'autorizada' });
    assert.doesNotMatch(sem, /<img/i);
    const com = await gerarDanfeNfeHtml({
      xml: xmlV2(),
      status: 'autorizada',
      logoUrl: '/storage/logos/empresa.png'
    });
    assert.match(com, /<img src="\/storage\/logos\/empresa\.png"/);
  });

  it('sem IE no destinatário não inventa IE', async () => {
    const html = await gerarDanfeNfeHtml({
      xml: xmlV2({ comIeDest: false }),
      status: 'autorizada'
    });
    assert.match(html, /INSCRIÇÃO ESTADUAL/);
    assert.doesNotMatch(html, /063640520/);
  });

  it('muitos produtos paginam com FOLHA e cabeçalho de tabela', async () => {
    const xml = xmlV2({ nItens: 40 });
    const modelo = montarModeloDanfe({ xml, extras: { status: 'autorizada' } });
    const pags = paginarItensDanfe(modelo);
    assert.ok(pags.length >= 2);
    const html = await gerarDanfeNfeHtml({ xml, status: 'autorizada' });
    assert.match(html, /data-folha="2"/);
    assert.match(html, /Folha 2\//);
    assert.equal((html.match(/DADOS DOS PRODUTOS \/ SERVIÇOS/g) || []).length, pags.length);
    const pdf = gerarDanfeNfePdf({ xml, status: 'autorizada' }).toString('latin1');
    assert.match(pdf, /%PDF-1.4/);
    assert.match(pdf, /FATURA \/ DUPLICATA/);
    assert.match(pdf, /CALCULO DO IMPOSTO/);
  });

  it('fatura vazia permanece compacta', async () => {
    const html = await gerarDanfeNfeHtml({ xml: xmlV2({ comDup: false }), status: 'autorizada' });
    assert.match(html, /fatura-wrap empty/);
  });
});
