/**
 * DANFE NF-e 55 — layout clássico A4 retrato.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const FIXTURE = path.join(__dirname, 'fixtures', 'nfe-100-autorizada.xml');
const {
  gerarDanfeNfeHtml,
  gerarDanfeNfePdf,
  montarModeloDanfe
} = require('../../backend/services/fiscal/danfeNfe');
const { paginarItensDanfe } = require('../../backend/services/fiscal/danfePaginacao');
const { svgCodigoBarras, modulosCode128C } = require('../../backend/services/fiscal/danfeBarcode');
const {
  validarDocumentoAutorizado,
  gerarPdfDanfeBuffer
} = require('../../backend/services/fiscal/danfeService');

const CHAVE_100 = '23260857824986000131550010000001001956868253';
const REF_100 = '42260707670414000258550010000158601949669171';
const PROT_100 = '223260092164139';

function xml100() {
  return fs.readFileSync(FIXTURE, 'utf8');
}

function xmlMini({ nItens = 1, tpNF = '1', natOp = 'VENDA' } = {}) {
  const dets = Array.from({ length: nItens }, (_, i) => `
    <det nItem="${i + 1}"><prod>
      <cProd>${1000 + i}</cProd><xProd>PRODUTO ${i + 1} DESCRICAO LONGA PARA QUEBRA</xProd>
      <NCM>22021000</NCM><CFOP>5102</CFOP><uCom>UN</uCom>
      <qCom>1.0000</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd>
    </prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>
    <IPI><IPITrib><vIPI>0.00</vIPI></IPITrib></IPI></imposto></det>`).join('');
  return `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe23260865957340000150550010000000011234567890">
    <ide><natOp>${natOp}</natOp><serie>1</serie><nNF>1</nNF>
    <dhEmi>2026-08-27T10:00:00-03:00</dhEmi><dhSaiEnt>2026-08-27T10:00:00-03:00</dhSaiEnt>
    <tpNF>${tpNF}</tpNF><NFref><refNFe>42260707670414000258550010000158601949669171</refNFe></NFref></ide>
    <emit><CNPJ>65957340000150</CNPJ><xNome>EMPRESA EMITENTE LTDA</xNome>
      <enderEmit><xLgr>RUA A</xLgr><nro>100</nro><xBairro>CENTRO</xBairro>
      <xMun>Juazeiro do Norte</xMun><UF>CE</UF><CEP>63000000</CEP><fone>88999999999</fone></enderEmit>
      <IE>073252638</IE></emit>
    <dest><CNPJ>12345678000199</CNPJ><xNome>DESTINATARIO TESTE LTDA</xNome>
      <enderDest><xLgr>RUA B</xLgr><nro>50</nro><xBairro>INDUSTRIAL</xBairro>
      <xMun>Fortaleza</xMun><UF>CE</UF><CEP>60000000</CEP><fone>8533330000</fone></enderDest>
      <IE>123</IE></dest>
    ${dets}
    <total><ICMSTot><vBC>10.00</vBC><vICMS>1.80</vICMS><vBCST>0.00</vBCST><vST>0.00</vST>
      <vProd>${(10 * nItens).toFixed(2)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg>
      <vDesc>0.00</vDesc><vOutro>0.00</vOutro><vIPI>0.00</vIPI>
      <vNF>${(10 * nItens).toFixed(2)}</vNF></ICMSTot></total>
    <transp><modFrete>9</modFrete></transp>
    <infAdic><infCpl>Informacao complementar do XML</infCpl></infAdic>
  </infNFe></NFe>
  <protNFe><infProt><chNFe>23260865957340000150550010000000011234567890</chNFe>
    <nProt>141250000099999</nProt><dhRecbto>2026-08-27T10:01:00-03:00</dhRecbto></infProt></protNFe>
  </nfeProc>`;
}

describe('DANFE layout — venda / devoluções', () => {
  it('DANFE venda autorizado contém blocos clássicos', async () => {
    const html = await gerarDanfeNfeHtml({ xml: xmlMini({ nItens: 1 }), status: 'autorizada' });
    assert.match(html, /DANFE/);
    assert.match(html, /DESTINATÁRIO \/ REMETENTE/);
    assert.match(html, /CÁLCULO DO IMPOSTO/);
    assert.match(html, /TRANSPORTADOR \/ VOLUMES TRANSPORTADOS/);
    assert.match(html, /DADOS DOS PRODUTOS \/ SERVIÇOS/);
    assert.match(html, /DADOS ADICIONAIS/);
    assert.match(html, /1 - SAÍDA/);
    assert.match(html, /EMPRESA EMITENTE LTDA/);
    assert.match(html, /DESTINATARIO TESTE LTDA/);
    assert.match(html, /BASE DE CÁLCULO DO ICMS/);
    assert.match(html, /VALOR TOTAL DA NOTA/);
    assert.match(html, /FRETE POR CONTA/);
    assert.match(html, /NF-e referenciada/);
    assert.match(html, /bloco-chave/);
    assert.match(html, /border-top:\s*1px dashed #555/);
    assert.match(html, /Emitida no sistema CDS Sistemas/);
    assert.doesNotMatch(html, /DATA E HORA DA IMPRESSÃO/);
    assert.doesNotMatch(html, /<img/i);
    assert.match(html, /svg/);
    assert.match(html, /@media print/);
    assert.match(html, /danfe-toolbar/);
  });

  it('DANFE devolução compra autorizado usa XML (entrada/saída do documento)', async () => {
    const html = await gerarDanfeNfeHtml({
      xml: xmlMini({ nItens: 2, natOp: 'Devolução de compra p/ comercialização' }),
      status: 'autorizada',
      natureza: 'Devolução de compra p/ comercialização'
    });
    assert.match(html, /Devolução de compra p\/ comercialização/);
    assert.match(html, /PRODUTO 1/);
    assert.match(html, /PRODUTO 2/);
  });

  it('DANFE devolução venda autorizado usa o mesmo template', async () => {
    const html = await gerarDanfeNfeHtml({
      xml: xmlMini({ nItens: 1, tpNF: '0', natOp: 'Devolucao de venda' }),
      status: 'autorizada'
    });
    assert.match(html, /0 - ENTRADA/);
    assert.match(html, /class="mk on"/);
  });
});

describe('DANFE layout — NF-e 100 real', () => {
  it('abre NF-e 100 / série 1 com chave, protocolo, emitente, dest e 46 produtos', async () => {
    const xml = xml100();
    const modelo = montarModeloDanfe({
      xml,
      extras: { status: 'autorizada', protocolo: PROT_100, numero: 100, serie: 1 }
    });
    assert.equal(onlyDigits(modelo.chave), CHAVE_100);
    assert.equal(String(modelo.numero), '100');
    assert.equal(String(modelo.serie), '1');
    assert.equal(modelo.itens.length, 46);
    assert.ok(modelo.refs.includes(REF_100));
    const html = await gerarDanfeNfeHtml({
      xml, status: 'autorizada', protocolo: PROT_100, numero: 100, serie: 1
    });
    assert.match(html, /NF-e Nº 000\.000\.100|Nº 000\.000\.100/);
    assert.match(html, /Série 001/);
    assert.match(html, new RegExp(CHAVE_100));
    assert.match(html, new RegExp(PROT_100));
    assert.match(html, /SARMENTO/);
    assert.match(html, /2326 0857 8249 8600 0131 5500/);
    assert.match(html, /1000 0001 0019 5686 8253/);
    const pdf = gerarDanfeNfePdf({ xml, status: 'autorizada', protocolo: PROT_100, numero: 100, serie: 1 }).toString('latin1');
    assert.match(pdf, /%PDF-1.4/);
    assert.match(pdf, /CALCULO DO IMPOSTO/);
    assert.match(pdf, /DADOS DOS PRODUTOS/);
    assert.match(pdf, /TRANSPORTADOR/);
    assert.match(pdf, /DESTINATARIO/);
    assert.match(pdf, new RegExp(CHAVE_100));
    assert.match(pdf, new RegExp(PROT_100));
    assert.match(pdf, /NFe referenciada/);
    assert.match(pdf, /Emitida no sistema CDS Sistemas/);
    assert.doesNotMatch(pdf, /DATA E HORA DA IMPRESSAO/);
    assert.doesNotMatch(pdf, /Representacao visual da NF-e autorizada/);
  });
});

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

describe('DANFE layout — tabela, paginação e extras', () => {
  it('1 produto aparece na tabela', async () => {
    const html = await gerarDanfeNfeHtml({ xml: xmlMini({ nItens: 1 }) });
    assert.match(html, /PRODUTO 1/);
    assert.equal((html.match(/<tbody>/g) || []).length >= 1, true);
  });

  it('múltiplos produtos aparecem', async () => {
    const html = await gerarDanfeNfeHtml({ xml: xmlMini({ nItens: 8 }) });
    assert.match(html, /PRODUTO 1/);
    assert.match(html, /PRODUTO 8/);
  });

  it('46 produtos paginam e repetem cabeçalho da tabela', async () => {
    const xml = xmlMini({ nItens: 46 });
    const modelo = montarModeloDanfe({ xml, extras: { status: 'autorizada' } });
    const pags = paginarItensDanfe(modelo);
    assert.ok(pags.length >= 2);
    const totalItens = pags.reduce((s, p) => s + p.itens.length, 0);
    assert.equal(totalItens, 46);
    const html = await gerarDanfeNfeHtml({ xml, status: 'autorizada' });
    assert.match(html, /data-total="/);
    assert.equal((html.match(/DADOS DOS PRODUTOS \/ SERVIÇOS/g) || []).length, pags.length);
    assert.match(html, /DADOS ADICIONAIS/);
    const idxProd = html.lastIndexOf('PRODUTO 46');
    const idxAdic = html.indexOf('DADOS ADICIONAIS');
    assert.ok(idxProd >= 0 && idxAdic > idxProd);
    assert.equal((html.match(/class="canhoto"/g) || []).length, 1);
    assert.match(html, /data-folha="2"/);
    const aposP2 = html.split('data-folha="2"')[1] || '';
    assert.doesNotMatch(aposP2, /class="canhoto"/);
  });

  it('impressão oculta toolbar', async () => {
    const html = await gerarDanfeNfeHtml({ xml: xmlMini({ nItens: 1 }) });
    assert.match(html, /@media print/);
    assert.match(html, /\.danfe-toolbar[\s\S]*display:\s*none/);
  });
});

describe('DANFE layout — status e reimpressão', () => {
  it('rejeitada e rascunho não geram DANFE autorizado', () => {
    assert.throws(() => validarDocumentoAutorizado({
      id: 1, numero: 1, serie: 1, chave: CHAVE_100, status: 'rejeitada'
    }), (e) => e.code === 'DOCUMENTO_NAO_AUTORIZADO');
    assert.throws(() => validarDocumentoAutorizado({
      id: 1, numero: 1, serie: 1, chave: CHAVE_100, status: 'rascunho'
    }), (e) => e.code === 'DOCUMENTO_NAO_AUTORIZADO');
  });

  it('prévia tem marca d água e não se mistura com autorizado', async () => {
    const html = await gerarDanfeNfeHtml({ xml: xmlMini({ nItens: 1 }), status: 'PREVIA' });
    assert.match(html, /PRÉVIA — SEM VALOR FISCAL|PREVIA/);
    assert.match(html, /SEM VALOR FISCAL/);
  });

  it('reimpressão não transmite nem reserva numeração', () => {
    const svc = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/danfeService.js'), 'utf8');
    const layout = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/danfeLayout.js'), 'utf8');
    assert.doesNotMatch(svc, /enviarLote|assinarNFe|reservarProximoNumeroNfe|proximoNumeroNFeVenda/);
    assert.doesNotMatch(layout, /enviarLote|assinarNFe/);
  });

  it('código de barras usa os 44 dígitos e fica junto da chave', async () => {
    const bits = modulosCode128C(CHAVE_100);
    assert.ok(bits.length > 40);
    const svg = svgCodigoBarras(CHAVE_100);
    assert.match(svg, /<svg/);
    assert.match(svg, /<rect/);
    const html = await gerarDanfeNfeHtml({ xml: xml100(), status: 'autorizada' });
    assert.match(html, /class="bloco-chave" data-chave="/);
    assert.match(html, /class="bloco-chave"[\s\S]{0,400}<svg/);
    assert.match(html, /CHAVE DE ACESSO/);
    assert.match(html, new RegExp(CHAVE_100));
    assert.match(html, /2326 0857 8249 8600 0131 5500/);
  });

  it('cStat 100/150 são autorizados', () => {
    const { statusEhAutorizado } = require('../../backend/services/fiscal/danfeService');
    assert.equal(statusEhAutorizado('100'), true);
    assert.equal(statusEhAutorizado('150'), true);
  });

  it('PDF completo não é resumo textual', () => {
    const buf = gerarPdfDanfeBuffer({
      numero: 1, serie: 1, chave: '23260865957340000150550010000000011234567890', protocolo: 'P1', status: 'autorizada'
    }, { xml: xmlMini({ nItens: 3 }) });
    const txt = buf.toString('latin1');
    assert.match(txt, /CALCULO DO IMPOSTO/);
    assert.match(txt, /VALOR TOTAL DA NOTA/);
    assert.match(txt, /PRODUTO 1/);
    assert.match(txt, /PRODUTO 3/);
    assert.match(txt, /Emitida no sistema CDS Sistemas/);
    assert.doesNotMatch(txt, /Nao altera a identidade fiscal/);
  });

  it('HTML e PDF usam o mesmo modelo persistido', async () => {
    const opts = { xml: xml100(), status: 'autorizada', protocolo: PROT_100, numero: 100, serie: 1 };
    const html = await gerarDanfeNfeHtml(opts);
    const pdf = gerarDanfeNfePdf(opts).toString('latin1');
    assert.match(html, new RegExp(CHAVE_100));
    assert.match(pdf, new RegExp(CHAVE_100));
    assert.match(html, /000\.000\.100/);
    assert.match(pdf, /000\.000\.100/);
    assert.match(html, new RegExp(PROT_100));
    assert.match(pdf, new RegExp(PROT_100));
    assert.match(html, /Emitida no sistema CDS Sistemas/);
    assert.match(pdf, /Emitida no sistema CDS Sistemas/);
  });
});
