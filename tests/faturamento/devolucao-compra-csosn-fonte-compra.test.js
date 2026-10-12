'use strict';

/**
 * NF-e de devolução de compra: compras.csosn_cst_xml pode conter CST do regime normal (2 dígitos).
 * Esse valor não pode ser usado como CSOSN do emitente do Simples (evita <CSOSN>000</CSOSN>).
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { montarImpostoItem } = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');

function itemEspelhado({ grupo, campos, cst = '', csosn = '' }) {
  const corpo = Object.entries(campos).map(([k, v]) => `<${k}>${v}</${k}>`).join('');
  return {
    tributosEspelhados: { cst, csosn, grupoIcms: grupo, origem: 0, icms: { ...campos }, pis: {}, cofins: {}, ipi: {} },
    impostoEspelhadoXml: `<imposto><ICMS><${grupo}>${corpo}</${grupo}></ICMS></imposto>`
  };
}

function icmsGerado(compra, item, crt) {
  const r = montarImpostoItem({ compra, item, config: { crt }, valorItem: 100 });
  return (String(r.xml || r).match(/<ICMS>[\s\S]*?<\/ICMS>/) || [''])[0];
}

const ITEM_FORNECEDOR_NORMAL = itemEspelhado({
  grupo: 'ICMS00',
  cst: '00',
  campos: { orig: '0', CST: '00', modBC: '3', vBC: '100.00', pICMS: '18.00', vICMS: '18.00' }
});

test('Emitente do Simples: CST 00 da compra não vira CSOSN 000', () => {
  for (const campo of ['csosn_cst_xml', 'csosn_cst']) {
    const icms = icmsGerado({ [campo]: '00' }, ITEM_FORNECEDOR_NORMAL, 1);
    assert.doesNotMatch(icms, /<CSOSN>000<\/CSOSN>/, campo);
    assert.equal(icms, icmsGerado({}, ITEM_FORNECEDOR_NORMAL, 1), `${campo}: mesmo resultado de compra sem código`);
  }
});

test('Emitente do Simples: CSOSN de 3 dígitos da compra continua sendo usado', () => {
  const item = itemEspelhado({ grupo: 'ICMSSN102', campos: { orig: '0', CSOSN: '102' } });
  item.tributosEspelhados.csosn = '';
  assert.match(icmsGerado({ csosn_cst_xml: '102' }, item, 1), /<CSOSN>102<\/CSOSN>/);
});

test('Emitente do regime normal: resultado inalterado com CST na compra', () => {
  assert.equal(
    icmsGerado({ csosn_cst_xml: '00' }, ITEM_FORNECEDOR_NORMAL, 3),
    icmsGerado({}, ITEM_FORNECEDOR_NORMAL, 3)
  );
});
