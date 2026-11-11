'use strict';

/**
 * SPRINT 51.54 — montagem demonstrativa do grupo <card> com CNPJ Userede.
 * NÃO transmite à SEFAZ. NÃO altera venda 67 / TEF 4 / NFC-e 52.
 */

const fs = require('fs');
const path = require('path');
const { montarPagamentos } = require(
  path.resolve(__dirname, '../../../../backend/services/fiscal/xmlBuilder')
);
const { validarPagamentosETroco } = require(
  path.resolve(__dirname, '../../../../backend/services/fiscal/validarXmlFiscal')
);
const {
  extrairEvidenciasRetorno00
} = require(
  path.resolve(__dirname, '../../../../backend/services/tef/destaxa/destaxaProtocolo')
);

const SAIDA_OFICIAL_EXEMPLO = [
  'transacao_valor=1',
  'transacao_tipo_cartao=Debito',
  'transacao_rede_cnpj=01.425.787/0001-04',
  'transacao_rede=Userede',
  'transacao_nsu=2348',
  'transacao_autorizacao=211139',
  'transacao_administradora=Visa',
  'transacao_comprovante_1via=/\\/\\/ Destaxa 18.760.540/0001-39\\/\\/\\/'
].join(';');

const evidencias = extrairEvidenciasRetorno00(SAIDA_OFICIAL_EXEMPLO);

const pagDebito = [{
  forma_pagamento: 'cartao_debito',
  valor: 1,
  tef: {
    transacao_id: 'demo-debito',
    status: 'aprovado',
    cnpj_credenciadora: evidencias.cnpj_credenciadora,
    bandeira: evidencias.bandeira,
    adquirente: evidencias.adquirente,
    autorizacao: evidencias.autorizacao,
    nsu: evidencias.nsu
  }
}];

const pagCredito = [{
  forma_pagamento: 'cartao_credito',
  valor: 1,
  tef: {
    transacao_id: 'demo-credito',
    status: 'aprovado',
    cnpj_credenciadora: evidencias.cnpj_credenciadora,
    bandeira: 'Mastercard',
    adquirente: evidencias.adquirente,
    autorizacao: 'ABC123',
    nsu: '9999'
  }
}];

const xmlDebito = montarPagamentos(pagDebito);
const xmlCredito = montarPagamentos(pagCredito);

const envelope = (pagXml) => `<NFe>${pagXml}<ICMSTot><vNF>1.00</vNF></ICMSTot></NFe>`;

let validacaoDebito = null;
let validacaoCredito = null;
try {
  validarPagamentosETroco(envelope(xmlDebito), { vNF: 1, vTroco: 0 });
  validacaoDebito = { ok: true };
} catch (error) {
  validacaoDebito = { ok: false, code: error.code, message: error.message };
}
try {
  validarPagamentosETroco(envelope(xmlCredito), { vNF: 1, vTroco: 0 });
  validacaoCredito = { ok: true };
} catch (error) {
  validacaoCredito = { ok: false, code: error.code, message: error.message };
}

const cardAntes392 = '<card><tpIntegra>1</tpIntegra><tBand>99</tBand><cAut>211139</cAut></card>';

const out = {
  sprint: 'SPRINT-51.54',
  transmissaoSefaz: false,
  origemCnpj: {
    campoOficial: 'transacao_rede_cnpj',
    valorBruto: '01.425.787/0001-04',
    valorNormalizado: evidencias.cnpj_credenciadora,
    naoUsado: '18.760.540/0001-39 (CNPJ Destaxa no comprovante/conf)'
  },
  cardAntesBug392: cardAntes392,
  xmlDebito,
  xmlCredito,
  validacaoLocal: {
    debito: validacaoDebito,
    credito: validacaoCredito
  }
};

fs.writeFileSync(
  path.join(__dirname, 'demo-xml-card.json'),
  `${JSON.stringify(out, null, 2)}\n`,
  'utf8'
);
fs.writeFileSync(path.join(__dirname, 'demo-pag-debito.xml'), `${xmlDebito}\n`, 'utf8');
fs.writeFileSync(path.join(__dirname, 'demo-pag-credito.xml'), `${xmlCredito}\n`, 'utf8');
console.log(JSON.stringify({
  ok: validacaoDebito.ok && validacaoCredito.ok,
  cnpj: evidencias.cnpj_credenciadora,
  validacaoLocal: out.validacaoLocal,
  arquivos: ['demo-xml-card.json', 'demo-pag-debito.xml', 'demo-pag-credito.xml']
}, null, 2));
