/**
 * ICMSTot da NF-e de devolução de compra: vNF = fórmula SEFAZ (sem PIS/COFINS).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildXmlNFeDevolucaoCompra
} = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');
const {
  validarIdentidadeICMSTot,
  calcularVNFSefaz
} = require('../../backend/services/fiscal/modeloTotais');
const { validarXmlFiscal, extrairTotais } = require('../../backend/services/fiscal/validarXmlFiscal');

const CHAVE44 = '23240165957340000150550010000001231000001234';

const configBase = {
  codigoUf: '23',
  cnpj: '65957340000150',
  ie: '073252638',
  crt: 3,
  ambiente: 2,
  serie: 1,
  nomeEmpresa: 'EMPRESA TESTE CDS',
  logradouro: 'RUA A',
  numero: '100',
  bairro: 'CENTRO',
  municipioCodigo: '2307304',
  municipioNome: 'JUAZEIRO DO NORTE',
  uf: 'CE',
  cep: '63000000',
  telefone: '88999999999'
};

function impostoEspelhado({ vPis, vCofins, vIpi, vST = 0, vFCPST = 0 }) {
  return `
    <ICMS><ICMS00>
      <orig>0</orig><CST>00</CST><modBC>3</modBC>
      <vBC>0.00</vBC><pICMS>0.0000</pICMS><vICMS>0.00</vICMS>
      ${vST > 0 ? `<vBCST>0.00</vBCST><vICMSST>${vST.toFixed(2)}</vICMSST>` : ''}
      ${vFCPST > 0 ? `<vFCPST>${vFCPST.toFixed(2)}</vFCPST>` : ''}
    </ICMS00></ICMS>
    <IPI><cEnq>999</cEnq><IPITrib>
      <CST>50</CST><vBC>0.00</vBC><pIPI>0.0000</pIPI><vIPI>${vIpi.toFixed(2)}</vIPI>
    </IPITrib></IPI>
    <PIS><PISAliq>
      <CST>01</CST><vBC>0.00</vBC><pPIS>0.0000</pPIS><vPIS>${vPis.toFixed(2)}</vPIS>
    </PISAliq></PIS>
    <COFINS><COFINSAliq>
      <CST>01</CST><vBC>0.00</vBC><pCOFINS>0.0000</pCOFINS><vCOFINS>${vCofins.toFixed(2)}</vCOFINS>
    </COFINSAliq></COFINS>`;
}

describe('ICMSTot devolução — vNF sem PIS/COFINS (caso 40,74)', () => {
  it('PIS+COFINS=40,74 não entram no vNF; fórmula SEFAZ fecha', () => {
    const vProd = 1128.63;
    const vIpi = 48.73;
    const vPis = 7.34;
    const vCofins = 33.40;
    assert.equal(Number((vPis + vCofins).toFixed(2)), 40.74);

    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: {
        id: 77,
        chave_acesso: CHAVE44,
        fornecedor: 'FORNECEDOR TESTE LTDA',
        fornecedor_cnpj: '12345678000199',
        cidade: 'Juazeiro do Norte',
        uf: 'CE'
      },
      itens: [{
        produto_id: 1,
        produto_nome: 'PRODUTO DEV',
        produto_codigo: 'P1',
        ncm: '22021000',
        unidade: 'UN',
        quantidade: 1,
        valor_unitario: vProd,
        csosn: '102',
        cst: '00',
        v_ipi: vIpi,
        v_ipi_devol: vIpi,
        tributosEspelhados: {
          origem: 0,
          cst: '00',
          grupoIcms: 'ICMS00',
          icms: { orig: '0', CST: '00', vBC: 0, pICMS: 0, vICMS: 0 },
          ipi: { CST: '50', vBC: 0, pIPI: 0, vIPI: vIpi },
          pis: { CST: '01', vBC: 0, pPIS: 0, vPIS: vPis, grupo: 'PISAliq' },
          cofins: { CST: '01', vBC: 0, pCOFINS: 0, vCOFINS: vCofins, grupo: 'COFINSAliq' }
        },
        impostoEspelhadoXml: impostoEspelhado({ vPis, vCofins, vIpi })
      }],
      numero: 501
    });

    const tot = extrairTotais(built.xmlSemAssinatura);
    assert.equal(tot.vProd, 1128.63);
    assert.equal(tot.vDesc, 0);
    assert.equal(tot.vFrete, 0);
    assert.equal(tot.vSeg, 0);
    assert.equal(tot.vOutro, 0);
    assert.equal(tot.vIPI, 0);
    assert.equal(tot.vIPIDevol, 48.73);
    assert.equal(tot.vPIS, 7.34);
    assert.equal(tot.vCOFINS, 33.40);
    assert.equal(tot.vNF, 1177.36);

    const sefaz = calcularVNFSefaz(tot);
    assert.equal(sefaz, 1177.36);
    assert.doesNotThrow(() => validarIdentidadeICMSTot(tot));

    const formulaAntigaErrada = Number((
      tot.vProd - tot.vDesc + tot.vFrete + tot.vSeg + tot.vOutro
      + tot.vII + tot.vIPI + tot.vIPIDevol + tot.vPIS + tot.vCOFINS + tot.vST
    ).toFixed(2));
    assert.equal(formulaAntigaErrada, 1218.10);

    assert.doesNotThrow(() => validarXmlFiscal({
      xml: built.xmlSemAssinatura,
      fase: 'pre_assinatura',
      modeloDoc: '55',
      validarXsd: false
    }));
  });

  it('frete/seguro/outro/ST/FCPST proporcionais entram no vNF', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: {
        id: 78,
        chave_acesso: CHAVE44,
        fornecedor: 'FORNECEDOR TESTE LTDA',
        fornecedor_cnpj: '12345678000199',
        cidade: 'Juazeiro do Norte',
        uf: 'CE',
        csosn_cst: '102',
        cst_pis: '07',
        cst_cofins: '07'
      },
      itens: [{
        produto_id: 1,
        produto_nome: 'PRODUTO DEV',
        produto_codigo: 'P1',
        ncm: '22021000',
        unidade: 'UN',
        quantidade: 2,
        valor_unitario: 10,
        csosn: '102',
        vFrete: 4.5,
        vSeg: 1.2,
        vOutro: 0.8,
        vDesc: 0.5,
        impostoEspelhadoXml: `
          <ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>
          <PIS><PISNT><CST>07</CST></PISNT></PIS>
          <COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>`,
        tributosEspelhados: {
          csosn: '102',
          grupoIcms: 'ICMSSN102',
          icms: { orig: '0', CSOSN: '102', vICMSST: 3.1, vFCPST: 0.4 },
          pis: { CST: '07' },
          cofins: { CST: '07' },
          ipi: null
        }
      }],
      numero: 502
    });

    const tot = extrairTotais(built.xmlSemAssinatura);
    assert.equal(tot.vProd, 20);
    assert.equal(tot.vDesc, 0.5);
    assert.equal(tot.vFrete, 4.5);
    assert.equal(tot.vSeg, 1.2);
    assert.equal(tot.vOutro, 0.8);
    assert.equal(tot.vST, 3.1);
    assert.equal(tot.vFCPST, 0.4);
    assert.equal(tot.vNF, calcularVNFSefaz(tot));
    assert.equal(tot.vNF, 29.5);
    assert.doesNotThrow(() => validarXmlFiscal({
      xml: built.xmlSemAssinatura,
      fase: 'pre_assinatura',
      modeloDoc: '55'
    }));
  });
});
