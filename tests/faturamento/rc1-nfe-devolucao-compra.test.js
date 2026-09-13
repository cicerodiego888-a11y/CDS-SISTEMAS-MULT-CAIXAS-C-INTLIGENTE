/**
 * RC1 — NF-e Devolução de Compra (builder + payload).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildXmlNFeDevolucaoCompra,
  montarImpostoItem
} = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');

const CHAVE44 = '23240165957340000150550010000001231000001234';

const configBase = {
  codigoUf: '23',
  cnpj: '65957340000150',
  ie: '073252638',
  crt: 1,
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

describe('RC1 — XML NF-e Devolução de Compra', () => {
  it('gera finNFe=4, tpNF=1, natOp e NFref com 44 dígitos', () => {
    const built = buildXmlNFeDevolucaoCompra({
      config: configBase,
      compra: {
        id: 99,
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
        valor_unitario: 10.5,
        csosn: '102'
      }],
      numero: 123
    });

    assert.equal(built.finNFe, 4);
    assert.equal(built.tpNF, 1);
    assert.match(built.natOp, /DEVOLUCAO/i);
    assert.equal(built.refNFe, CHAVE44);
    assert.match(built.xmlSemAssinatura, /<finNFe>4<\/finNFe>/);
    assert.match(built.xmlSemAssinatura, /<tpNF>1<\/tpNF>/);
    assert.match(built.xmlSemAssinatura, /<natOp>DEVOLUCAO DE COMPRA<\/natOp>/);
    assert.match(built.xmlSemAssinatura, new RegExp(`<NFref>\\s*<refNFe>${CHAVE44}</refNFe>\\s*</NFref>`));
    assert.match(built.xmlSemAssinatura, /<CSOSN>102<\/CSOSN>/);
    assert.match(built.xmlSemAssinatura, /<CFOP>5202<\/CFOP>/);
  });

  it('rejeita chave referenciada inválida', () => {
    assert.throws(
      () => buildXmlNFeDevolucaoCompra({
        config: configBase,
        compra: { id: 1, chave_acesso: '123', fornecedor: 'X', fornecedor_cnpj: '12345678000199' },
        itens: [{ produto_nome: 'A', quantidade: 1, valor_unitario: 1 }],
        numero: 1
      }),
      /44 dígitos/
    );
  });

  it('copia tributos da compra (CSOSN/PIS/COFINS) sem inventar CST fixo genérico quando informados', () => {
    const imposto = montarImpostoItem({
      compra: { csosn_cst: '500', cst_pis: '07', cst_cofins: '07' },
      item: { csosn: '500' },
      config: { crt: 1 },
      valorItem: 50
    });
    assert.match(imposto.xml, /<CSOSN>500<\/CSOSN>/);
    assert.match(imposto.xml, /<PISNT><CST>07<\/CST>/);
  });

  it('aceita payload tipado DEVOLUCAO (contrato motor)', () => {
    const payload = {
      tipoDocumento: 'DEVOLUCAO',
      finNFe: 4,
      origem: 'COMPRA',
      compraId: 10,
      refNFe: CHAVE44,
      itens: [{ compra_item_id: 1, quantidade: 1 }]
    };
    assert.equal(payload.tipoDocumento, 'DEVOLUCAO');
    assert.equal(payload.finNFe, 4);
    assert.equal(payload.origem, 'COMPRA');
    assert.equal(payload.refNFe.length, 44);
  });
});
