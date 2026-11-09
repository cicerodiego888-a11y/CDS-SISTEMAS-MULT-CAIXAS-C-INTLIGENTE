/**
 * MRT-50.73 — Correção controlada: literal CRT Debito (ASCII).
 * Sem DLL, NativeHost, V$Pague ou TX.
 * Executar: node tests/tef/mrt-50-73-crt-literal-debito.test.js
 */
'use strict';

const assert = require('assert');
const {
  buildCrtInput,
  mapearTipoCartaoCrt,
  TIPOS_CARTAO_CRT_DOCUMENTADOS,
  FORMAS_PAGAMENTO_CRT_DOCUMENTADAS
} = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const {
  ENCODING_DESTAXA,
  CAMPOS_ENTRADA_CRT_DOCUMENTADOS
} = require('../../backend/services/tef/destaxa/destaxaConstantes');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`    ${error && error.stack ? error.stack : error}`);
  }
}

console.log('\nMRT-50.73 — literal CRT Debito\n');

test('constante DEBITO = Debito (ASCII)', () => {
  assert.strictEqual(TIPOS_CARTAO_CRT_DOCUMENTADOS.DEBITO, 'Debito');
  assert.strictEqual(TIPOS_CARTAO_CRT_DOCUMENTADOS.CREDITO, 'Credito');
  assert.ok(String(CAMPOS_ENTRADA_CRT_DOCUMENTADOS.transacao_tipo_cartao).includes('Debito'));
  assert.ok(!String(CAMPOS_ENTRADA_CRT_DOCUMENTADOS.transacao_tipo_cartao).includes('Débito'));
});

test('cartao_debito mapeia para Debito', () => {
  assert.strictEqual(mapearTipoCartaoCrt('cartao_debito'), 'Debito');
  assert.strictEqual(mapearTipoCartaoCrt('debito'), 'Debito');
});

test('buildCrtInput produz transacao_tipo_cartao=Debito', () => {
  const crt = buildCrtInput({ valorCentavos: 100, tipoPdv: 'cartao_debito', parcelas: 1 });
  assert.strictEqual(
    crt.texto,
    'transacao_valor=1.00;transacao_tipo_cartao=Debito;transacao_pagamento=A vista'
  );
  assert.strictEqual(crt.campos.transacao_tipo_cartao, 'Debito');
  assert.strictEqual(crt.campos.transacao_pagamento, FORMAS_PAGAMENTO_CRT_DOCUMENTADAS.A_VISTA);
  assert.ok(crt.chaves.includes('transacao_valor'));
  assert.ok(crt.chaves.includes('transacao_tipo_cartao'));
  assert.ok(crt.chaves.includes('transacao_pagamento'));
});

test('valor Debito transmite em bytes ASCII (latin1 == utf8 no trecho do tipo)', () => {
  assert.strictEqual(ENCODING_DESTAXA, 'latin1');
  const crt = buildCrtInput({ valorCentavos: 100, tipoPdv: 'cartao_debito' });
  const latin1 = Buffer.from(crt.texto, 'latin1');
  const utf8 = Buffer.from(crt.texto, 'utf8');
  assert.strictEqual(latin1.length, utf8.length);
  assert.strictEqual(latin1.toString('hex'), utf8.toString('hex'));
  assert.ok(latin1.toString('hex').includes('44656269746f')); // Debito
  assert.ok(!latin1.toString('hex').includes('e9'));
  assert.ok(!utf8.toString('hex').includes('c3a9'));
});

test('tamanho_entrada CRT débito permanece 77 bytes latin1 + NUL no buffer CDS', () => {
  const crt = buildCrtInput({ valorCentavos: 100, tipoPdv: 'cartao_debito' });
  const bytes = Buffer.from(crt.texto, ENCODING_DESTAXA);
  assert.strictEqual(bytes.length, 77);
  const comNul = Buffer.alloc(bytes.length + 1);
  bytes.copy(comNul);
  assert.strictEqual(comNul.length, 78);
  assert.strictEqual(comNul[77], 0);
});

test('Credito continua funcionando', () => {
  const crt = buildCrtInput({ valorCentavos: 100, tipoPdv: 'cartao_credito', parcelas: 3 });
  assert.strictEqual(crt.campos.transacao_tipo_cartao, 'Credito');
  assert.strictEqual(crt.campos.transacao_pagamento, 'Parcelado');
  assert.ok(crt.texto.includes('transacao_tipo_cartao=Credito'));
  assert.ok(crt.texto.includes('transacao_pagamento=Parcelado'));
});

test('valores não documentados continuam rejeitados', () => {
  const accent = buildCrtInput({
    valorCentavos: 100,
    tipoCartao: 'Débito',
    formaPagamento: 'A vista'
  });
  assert.ok(!accent.texto.includes('transacao_tipo_cartao'));

  const upper = buildCrtInput({
    valorCentavos: 100,
    tipoCartao: 'DEBITO',
    formaPagamento: 'A vista'
  });
  assert.ok(!upper.texto.includes('transacao_tipo_cartao'));

  const voucher = buildCrtInput({
    valorCentavos: 100,
    tipoCartao: 'Voucher',
    formaPagamento: 'A vista'
  });
  assert.ok(!voucher.texto.includes('transacao_tipo_cartao'));
});

test('allowlist aceita literal canônico Debito via tipoCartao', () => {
  const crt = buildCrtInput({
    valorCentavos: 100,
    tipoCartao: 'Debito',
    formaPagamento: 'A vista'
  });
  assert.strictEqual(crt.campos.transacao_tipo_cartao, 'Debito');
  assert.ok(crt.texto.includes('transacao_tipo_cartao=Debito'));
});

test('campos obrigatórios de valor não omitidos; genérico omite só tipo/forma', () => {
  const soValor = buildCrtInput({ valorCentavos: 100 });
  assert.strictEqual(soValor.texto, 'transacao_valor=1.00');
  assert.ok(soValor.chaves.includes('transacao_valor'));

  const generico = buildCrtInput({ valorCentavos: 100, tipoPdv: 'cartao' });
  assert.strictEqual(generico.texto, 'transacao_valor=1.00');
});

console.log(`\nResumo: ${passou} ok / ${falhou} falhas`);
process.exit(falhou ? 1 : 0);
