/**
 * RC7.10.2.1 — ICMSTot NFC-e: MODELO_BRUTO × MODELO_LIQUIDO (pós RC7.10.1)
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNfceXml,
  determinarModeloDeTotais,
  validarIdentidadeICMSTot,
  MODELO_BRUTO,
  MODELO_LIQUIDO
} = require('../../backend/services/fiscal/xmlBuilder');

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
  municipio: 'JUAZEIRO DO NORTE',
  uf: 'CE',
  cep: '63000000',
  csosn_padrao: '102'
};

function itemFiscal({ valor_fiscal, quantidade_fiscal = 1, preco_unitario }) {
  return {
    produto_id: 1,
    produto_nome: 'PRODUTO TESTE',
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

function extrairIcmsTot(xml) {
  const bloco = xml.match(/<ICMSTot>([\s\S]*?)<\/ICMSTot>/);
  const fonte = bloco ? bloco[1] : xml;
  const pegar = (tag) => {
    const m = fonte.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
    return m ? Number(m[1]) : null;
  };
  return {
    vProd: pegar('vProd'),
    vDesc: pegar('vDesc'),
    vNF: pegar('vNF'),
    vFrete: pegar('vFrete'),
    vSeg: pegar('vSeg'),
    vOutro: pegar('vOutro'),
    vIPI: pegar('vIPI'),
    vST: pegar('vST')
  };
}

describe('RC7.10.2.1 — determinarModeloDeTotais', () => {
  it('Caso 1: itens líquidos 78 + desconto 5,40 → MODELO_LIQUIDO', () => {
    const m = determinarModeloDeTotais({
      itens: [itemFiscal({ valor_fiscal: 78 })],
      venda: { total: 78, desconto: 5.4, valor_fiscal: 78 }
    });
    assert.equal(m.modelo, MODELO_LIQUIDO);
    assert.equal(m.vProd, 78);
    assert.equal(m.vDesc, 0);
    assert.equal(m.vNF, 78);
  });

  it('Caso 2: itens brutos 83,40 + desconto 5,40 → MODELO_BRUTO', () => {
    const m = determinarModeloDeTotais({
      itens: [itemFiscal({ valor_fiscal: 83.4 })],
      venda: { total: 78, desconto: 5.4, valor_fiscal: 78 }
    });
    assert.equal(m.modelo, MODELO_BRUTO);
    assert.equal(m.vProd, 83.4);
    assert.equal(m.vDesc, 5.4);
    assert.equal(m.vNF, 78);
  });

  it('Caso 3: sem desconto permanece estável', () => {
    const m = determinarModeloDeTotais({
      itens: [itemFiscal({ valor_fiscal: 50 })],
      venda: { total: 50, desconto: 0 }
    });
    assert.equal(m.vDesc, 0);
    assert.equal(m.vNF, 50);
    assert.equal(m.vProd, 50);
  });

  it('Caso 4: mista fiscal rateada já líquida', () => {
    const m = determinarModeloDeTotais({
      itens: [itemFiscal({ valor_fiscal: 54 })],
      venda: { total: 90, desconto: 10, valor_fiscal: 54, valor_nao_fiscal: 36 }
    });
    assert.equal(m.modelo, MODELO_LIQUIDO);
    assert.equal(m.vDesc, 0);
    assert.equal(m.vNF, 54);
  });
});

describe('RC7.10.2.1 — buildNfceXml ICMSTot', () => {
  it('Caso 1 líquido: vProd=78 vDesc=0 vNF=78 (sem cStat 610)', () => {
    const built = buildNfceXml({
      config: cfg,
      venda: {
        total: 78,
        desconto: 5.4,
        valor_fiscal: 78,
        forma_pagamento: 'dinheiro',
        pagamentos: [{ forma_pagamento: 'dinheiro', valor: 78, tipo_recebimento: 'fiscal' }]
      },
      itens: [itemFiscal({ valor_fiscal: 78, preco_unitario: 78 })],
      numero: 1
    });

    assert.equal(built.valores.modelo, MODELO_LIQUIDO);
    assert.equal(built.valores.vProd, 78);
    assert.equal(built.valores.vDesc, 0);
    assert.equal(built.valores.vNF, 78);

    const tot = extrairIcmsTot(built.xmlSemAssinatura);
    assert.equal(tot.vProd, 78);
    assert.equal(tot.vDesc, 0);
    assert.equal(tot.vNF, 78);
    // Sem vDesc no item (somente ICMSTot.vDesc=0.00)
    assert.doesNotMatch(built.xmlSemAssinatura, /<\/vUnTrib>\s*<vDesc>/);
  });

  it('Caso 2 bruto: vProd=83,40 vDesc=5,40 vNF=78', () => {
    const built = buildNfceXml({
      config: cfg,
      venda: {
        total: 78,
        desconto: 5.4,
        valor_fiscal: 78,
        forma_pagamento: 'dinheiro',
        pagamentos: [{ forma_pagamento: 'dinheiro', valor: 78, tipo_recebimento: 'fiscal' }]
      },
      itens: [itemFiscal({ valor_fiscal: 83.4, preco_unitario: 83.4 })],
      numero: 2
    });

    assert.equal(built.valores.modelo, MODELO_BRUTO);
    assert.equal(built.valores.vProd, 83.4);
    assert.equal(built.valores.vDesc, 5.4);
    assert.equal(built.valores.vNF, 78);

    const tot = extrairIcmsTot(built.xmlSemAssinatura);
    assert.equal(tot.vProd, 83.4);
    assert.equal(tot.vDesc, 5.4);
    assert.equal(tot.vNF, 78);
  });

  it('Caso 3 sem desconto: identidade preservada', () => {
    const built = buildNfceXml({
      config: cfg,
      venda: {
        total: 40,
        desconto: 0,
        forma_pagamento: 'pix',
        pagamentos: [{ forma_pagamento: 'pix', valor: 40, tipo_recebimento: 'fiscal' }]
      },
      itens: [itemFiscal({ valor_fiscal: 40, preco_unitario: 40 })],
      numero: 3
    });
    assert.equal(built.valores.vProd, 40);
    assert.equal(built.valores.vDesc, 0);
    assert.equal(built.valores.vNF, 40);
  });

  it('validarIdentidadeICMSTot aborta divergência', () => {
    assert.throws(
      () => validarIdentidadeICMSTot({ vProd: 78, vDesc: 5.4, vNF: 78 }),
      /ICMSTot inconsistente/
    );
    assert.doesNotThrow(() => validarIdentidadeICMSTot({ vProd: 78, vDesc: 0, vNF: 78 }));
    assert.doesNotThrow(() => validarIdentidadeICMSTot({ vProd: 83.4, vDesc: 5.4, vNF: 78 }));
  });
});
