const assert = require('assert');
const {
  buildCrtInput,
  mapearTipoCartaoCrt,
  mapearFormaPagamentoCrt,
  TIPOS_CARTAO_CRT_DOCUMENTADOS,
  FORMAS_PAGAMENTO_CRT_DOCUMENTADAS
} = require('../../../../backend/services/tef/destaxa/destaxaProtocolo');

const debito = buildCrtInput({ valorCentavos: 100, tipoPdv: 'cartao_debito', parcelas: 1 });
assert.strictEqual(debito.texto, 'transacao_valor=1.00;transacao_tipo_cartao=Debito;transacao_pagamento=A vista');
assert.strictEqual(mapearTipoCartaoCrt('debito'), TIPOS_CARTAO_CRT_DOCUMENTADOS.DEBITO);
assert.strictEqual(mapearFormaPagamentoCrt('cartao_debito', 1), FORMAS_PAGAMENTO_CRT_DOCUMENTADAS.A_VISTA);

const credito = buildCrtInput({ valorCentavos: 100, tipoPdv: 'cartao_credito', parcelas: 3 });
assert.strictEqual(credito.campos.transacao_tipo_cartao, 'Credito');
assert.strictEqual(credito.campos.transacao_pagamento, 'Parcelado');

const generico = buildCrtInput({ valorCentavos: 100, tipoPdv: 'cartao' });
assert.strictEqual(generico.texto, 'transacao_valor=1.00');
assert.strictEqual(generico.campos.transacao_tipo_cartao, undefined);

const soValor = buildCrtInput({ valorCentavos: 100 });
assert.strictEqual(soValor.texto, 'transacao_valor=1.00');

console.log(JSON.stringify({
  ok: true,
  debito: debito.texto,
  credito: credito.texto,
  generico: generico.texto,
  soValor: soValor.texto
}, null, 2));
