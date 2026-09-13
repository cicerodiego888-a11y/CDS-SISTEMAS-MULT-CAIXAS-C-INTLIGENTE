/**
 * RC7.10.5 — ICMSTot com vários itens: vProd/vNF não podem vir do det[0].
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildNfceXml } = require('../../backend/services/fiscal/xmlBuilder');
const { validarXmlFiscal, extrairTotais } = require('../../backend/services/fiscal/validarXmlFiscal');
const { determinarModeloDeTotais, MODELO_BRUTO } = require('../../backend/services/fiscal/modeloTotais');

const cfg = {
  codigoUf: '23',
  cnpj: '65957340000150',
  ie: '073252638',
  crt: 1,
  ambiente: 2,
  serie: 1,
  nomeEmpresa: 'EMPRESA TESTE',
  logradouro: 'RUA A',
  numero: '1',
  bairro: 'CENTRO',
  codigo_municipio: '2307304',
  municipioCodigo: '2307304',
  municipio: 'JUAZEIRO DO NORTE',
  uf: 'CE',
  cep: '63000000',
  csosn_padrao: '102'
};

function itemFiscal({ valor_fiscal, quantidade_fiscal = 1, preco_unitario, nome }) {
  return {
    produto_id: 1,
    produto_nome: nome || 'PRODUTO TESTE',
    quantidade: quantidade_fiscal,
    quantidade_fiscal,
    quantidade_nao_fiscal: 0,
    preco_unitario: preco_unitario != null ? preco_unitario : valor_fiscal / quantidade_fiscal,
    valor_fiscal,
    valor_nao_fiscal: 0,
    produto_ncm: '10063021',
    cfop: '5102',
    unidade: 'UN',
    origem: 0,
    csosn: '102'
  };
}

function emitir(itens, vendaExtra = {}) {
  const vProd = itens.reduce((s, i) => s + Number(i.valor_fiscal || 0), 0);
  const desconto = Number(vendaExtra.desconto || 0);
  const total = vendaExtra.total != null ? vendaExtra.total : Number((vProd - desconto).toFixed(2));
  return buildNfceXml({
    config: cfg,
    venda: {
      total,
      desconto,
      valor_fiscal: vendaExtra.valor_fiscal != null ? vendaExtra.valor_fiscal : total,
      forma_pagamento: 'dinheiro',
      pagamentos: [{
        forma_pagamento: 'dinheiro',
        valor: total,
        tipo_recebimento: 'fiscal'
      }],
      ...vendaExtra
    },
    itens,
    numero: 1
  });
}

function contarDets(xml) {
  return (String(xml).match(/<det nItem="/g) || []).length;
}

describe('RC7.10.5 — um item', () => {
  it('1 × R$ 10,70 → vProd=vNF=10,70', () => {
    const built = emitir([itemFiscal({ valor_fiscal: 10.7 })]);
    assert.equal(built.valores.vProd, 10.7);
    assert.equal(built.valores.vNF, 10.7);
    const tot = extrairTotais(built.xmlSemAssinatura);
    assert.equal(tot.vProd, 10.7);
    assert.equal(tot.vNF, 10.7);
    validarXmlFiscal({ xml: built.xmlSemAssinatura, fase: 'pre_assinatura', modeloDoc: '65' });
  });
});

describe('RC7.10.5 — dois itens', () => {
  it('10,70 + 4,65 → vProd=15,35', () => {
    const built = emitir([
      itemFiscal({ valor_fiscal: 10.7 }),
      itemFiscal({ valor_fiscal: 4.65 })
    ]);
    assert.equal(built.valores.vProd, 15.35);
    assert.equal(built.valores.vNF, 15.35);
    assert.equal(contarDets(built.xmlSemAssinatura), 2);
    const tot = extrairTotais(built.xmlSemAssinatura);
    assert.equal(tot.vProd, 15.35);
    assert.equal(tot.vNF, 15.35);
    assert.notEqual(tot.vProd, 10.7);
    validarXmlFiscal({ xml: built.xmlSemAssinatura, fase: 'pre_assinatura', modeloDoc: '65' });
  });
});

describe('RC7.10.5 — seis itens do caso real', () => {
  const valores = [10.7, 4.65, 5.12, 9.3, 55.8, 7.43];

  it('vProd=vNF=93,00 e seis <det>', () => {
    const built = emitir(valores.map((v, i) => itemFiscal({ valor_fiscal: v, nome: `ITEM ${i + 1}` })));
    assert.equal(built.valores.vProd, 93);
    assert.equal(built.valores.vNF, 93);
    assert.equal(built.valores.vDesc, 0);
    assert.equal(contarDets(built.xmlSemAssinatura), 6);

    for (let i = 1; i <= 6; i += 1) {
      assert.match(built.xmlSemAssinatura, new RegExp(`<det nItem="${i}">`));
    }

    const tot = extrairTotais(built.xmlSemAssinatura);
    assert.equal(tot.vProd, 93);
    assert.equal(tot.vDesc, 0);
    assert.equal(tot.vFrete, 0);
    assert.equal(tot.vSeg, 0);
    assert.equal(tot.vOutro, 0);
    assert.equal(tot.vNF, 93);
    assert.notEqual(tot.vProd, 10.7);

    assert.doesNotThrow(() => validarXmlFiscal({
      xml: built.xmlSemAssinatura,
      fase: 'pre_assinatura',
      modeloDoc: '65'
    }));
  });
});

describe('RC7.10.5 — desconto', () => {
  it('um item bruto: vNF = vProd - desconto', () => {
    const m = determinarModeloDeTotais({
      itens: [itemFiscal({ valor_fiscal: 20 })],
      venda: { total: 15, desconto: 5, valor_fiscal: 15 }
    });
    assert.equal(m.modelo, MODELO_BRUTO);
    assert.equal(m.vProd, 20);
    assert.equal(m.vDesc, 5);
    assert.equal(m.vNF, 15);

    const built = emitir(
      [itemFiscal({ valor_fiscal: 20 })],
      { total: 15, desconto: 5, valor_fiscal: 15 }
    );
    const tot = extrairTotais(built.xmlSemAssinatura);
    assert.equal(tot.vProd, 20);
    assert.equal(tot.vDesc, 5);
    assert.equal(tot.vNF, 15);
    validarXmlFiscal({ xml: built.xmlSemAssinatura, fase: 'pre_assinatura', modeloDoc: '65' });
  });

  it('vários itens + desconto não voltam ao primeiro item', () => {
    const itens = [
      itemFiscal({ valor_fiscal: 40 }),
      itemFiscal({ valor_fiscal: 30 }),
      itemFiscal({ valor_fiscal: 20 })
    ];
    const built = emitir(itens, { total: 80, desconto: 10, valor_fiscal: 80 });
    assert.equal(contarDets(built.xmlSemAssinatura), 3);
    const tot = extrairTotais(built.xmlSemAssinatura);
    assert.equal(tot.vProd, 90);
    assert.equal(tot.vDesc, 10);
    assert.equal(tot.vNF, 80);
    validarXmlFiscal({ xml: built.xmlSemAssinatura, fase: 'pre_assinatura', modeloDoc: '65' });
  });
});

describe('RC7.10.5 — muitos itens', () => {
  it('20 itens agregam o total e não o primeiro', () => {
    const itens = [];
    for (let i = 0; i < 20; i += 1) {
      itens.push(itemFiscal({ valor_fiscal: 1.11, nome: `SKU ${i + 1}` }));
    }
    const built = emitir(itens);
    assert.equal(contarDets(built.xmlSemAssinatura), 20);
    assert.equal(built.valores.vProd, 22.2);
    assert.equal(built.valores.vNF, 22.2);
    const tot = extrairTotais(built.xmlSemAssinatura);
    assert.equal(tot.vProd, 22.2);
    assert.equal(tot.vNF, 22.2);
    assert.notEqual(tot.vProd, 1.11);
    validarXmlFiscal({ xml: built.xmlSemAssinatura, fase: 'pre_assinatura', modeloDoc: '65' });
  });
});
