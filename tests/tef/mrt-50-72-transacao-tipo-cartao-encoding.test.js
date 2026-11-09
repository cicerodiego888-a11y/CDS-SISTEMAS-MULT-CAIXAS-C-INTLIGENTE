/**
 * MRT-50.72 — Comparações isoladas de representação de transacao_tipo_cartao.
 * Atualizado na MRT-50.73: produção CDS = Debito (ASCII).
 * Sem DLL, NativeHost, V$Pague, TX ou gate financeiro.
 * Executar: node tests/tef/mrt-50-72-transacao-tipo-cartao-encoding.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildCrtInput,
  TIPOS_CARTAO_CRT_DOCUMENTADOS,
  mapearTipoCartaoCrt
} = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const {
  ENCODING_DESTAXA,
  CAMPOS_ENTRADA_CRT_DOCUMENTADOS
} = require('../../backend/services/tef/destaxa/destaxaConstantes');

const OUT_DIR = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'homologacao',
  'tef',
  'MRT-50.72-2026-11-07'
);

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

function analisarRepresentacao(rotulo, texto) {
  const original = String(texto);
  const codePoints = [...original].map((ch) => ({
    char: ch,
    unicode: 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
  }));
  const utf8 = Buffer.from(original, 'utf8');
  let latin1 = null;
  let latin1Ok = true;
  try {
    latin1 = Buffer.from(original, 'latin1');
    for (const ch of original) {
      if (ch.codePointAt(0) > 255) latin1Ok = false;
    }
  } catch (_) {
    latin1Ok = false;
  }
  return {
    rotulo,
    textoOriginal: original,
    codePoints,
    utf8Hex: utf8.toString('hex'),
    utf8Len: utf8.length,
    latin1Hex: latin1 ? latin1.toString('hex') : null,
    latin1Len: latin1 ? latin1.length : null,
    latin1Representavel: latin1Ok,
    utf8DiffereLatin1: latin1 ? utf8.toString('hex') !== latin1.toString('hex') : null
  };
}

function serializarCrtComTipo(tipoCartaoLiteral) {
  const texto =
    `transacao_valor=1.00;transacao_tipo_cartao=${tipoCartaoLiteral};transacao_pagamento=A vista`;
  const latin1 = Buffer.from(texto, 'latin1');
  const utf8 = Buffer.from(texto, 'utf8');
  const bufferComNul = Buffer.alloc(latin1.length + 1);
  latin1.copy(bufferComNul);
  return {
    texto,
    encodingContratoCds: ENCODING_DESTAXA,
    tamanhoDeclaradoLatin1: latin1.length,
    tamanhoUtf8: utf8.length,
    bytesLatin1Hex: latin1.toString('hex'),
    bytesUtf8Hex: utf8.toString('hex'),
    bufferComNulLen: bufferComNul.length,
    nulTerminal: bufferComNul[bufferComNul.length - 1] === 0
  };
}

const candidatas = [
  { rotulo: 'docs06_accent_historico', valor: 'Débito', origem: 'docs/06 (histórico; rejeitado allowlist CDS pós-50.73)' },
  { rotulo: 'canonico_ascii', valor: 'Debito', origem: 'examples java/dotnet + docs/07 + CDS MRT-50.73' },
  { rotulo: 'upper_ascii', valor: 'DEBITO', origem: 'variante não documentada como aceita' },
  { rotulo: 'docs06_credito', valor: 'Credito', origem: 'docs/06 + examples (controle sem acento)' }
];

const matriz = candidatas.map((c) => ({
  ...c,
  representacao: analisarRepresentacao(c.rotulo, c.valor),
  serializacaoCrt: serializarCrtComTipo(c.valor)
}));

test('ENCODING_DESTAXA permanece latin1 (contrato CDS)', () => {
  assert.strictEqual(ENCODING_DESTAXA, 'latin1');
});

test('Constante CDS documenta Debito ASCII (MRT-50.73)', () => {
  assert.strictEqual(TIPOS_CARTAO_CRT_DOCUMENTADOS.DEBITO, 'Debito');
  assert.ok(String(CAMPOS_ENTRADA_CRT_DOCUMENTADOS.transacao_tipo_cartao).includes('Debito'));
});

test('mapearTipoCartaoCrt(cartao_debito) produz Debito', () => {
  assert.strictEqual(mapearTipoCartaoCrt('cartao_debito'), 'Debito');
});

test('buildCrtInput PDV débito serializa Debito (produção)', () => {
  const crt = buildCrtInput({ valorCentavos: 100, tipoPdv: 'cartao_debito' });
  assert.strictEqual(
    crt.texto,
    'transacao_valor=1.00;transacao_tipo_cartao=Debito;transacao_pagamento=A vista'
  );
  const bytes = Buffer.from(crt.texto, 'latin1');
  assert.strictEqual(bytes.length, 77);
  const posE = Buffer.from(crt.texto.slice(0, crt.texto.indexOf('Debito') + 1), 'latin1').length;
  assert.strictEqual(bytes[posE], 0x65); // 'e' ASCII
});

test('buildCrtInput rejeita literal Débito acentuado (fora da allowlist canônica)', () => {
  const crt = buildCrtInput({
    valorCentavos: 100,
    tipoCartao: 'Débito',
    formaPagamento: 'A vista'
  });
  assert.ok(!crt.texto.includes('transacao_tipo_cartao'));
  assert.ok(crt.texto.includes('transacao_valor=1.00'));
});

test('Débito histórico: UTF-8 ≠ latin1; Debito canônico: UTF-8 == latin1', () => {
  const accent = matriz.find((m) => m.rotulo === 'docs06_accent_historico').representacao;
  const ascii = matriz.find((m) => m.rotulo === 'canonico_ascii').representacao;
  assert.strictEqual(accent.utf8DiffereLatin1, true);
  assert.strictEqual(accent.utf8Hex, '44c3a96269746f');
  assert.strictEqual(accent.latin1Hex, '44e96269746f');
  assert.strictEqual(ascii.utf8DiffereLatin1, false);
  assert.strictEqual(ascii.utf8Hex, '44656269746f');
  assert.strictEqual(ascii.latin1Hex, '44656269746f');
});

test('Serialização CRT Debito e Débito: mesmo tamanho latin1 (77); diferem no byte do é/e', () => {
  const accent = matriz.find((m) => m.rotulo === 'docs06_accent_historico').serializacaoCrt;
  const ascii = matriz.find((m) => m.rotulo === 'canonico_ascii').serializacaoCrt;
  assert.strictEqual(accent.tamanhoDeclaradoLatin1, 77);
  assert.strictEqual(ascii.tamanhoDeclaradoLatin1, 77);
  assert.notStrictEqual(accent.bytesLatin1Hex, ascii.bytesLatin1Hex);
  assert.ok(accent.bytesLatin1Hex.includes('e9'));
  assert.ok(ascii.bytesLatin1Hex.includes('65'));
  assert.ok(!ascii.bytesLatin1Hex.includes('e9'));
  assert.strictEqual(accent.nulTerminal, true);
  assert.strictEqual(ascii.nulTerminal, true);
  assert.strictEqual(accent.tamanhoUtf8, 78);
  assert.strictEqual(ascii.tamanhoUtf8, 77);
});

test('Doc exemplo Credito tamanho_entrada=81 bate com latin1', () => {
  const exemplo =
    'transacao_pagamento=Parcelado;transacao_tipo_cartao=Credito;transacao_valor=99.99';
  assert.strictEqual(Buffer.from(exemplo, 'latin1').length, 81);
  assert.strictEqual(Buffer.from(exemplo, 'utf8').length, 81);
});

const resultado = {
  mrt: 'MRT-50.72',
  atualizadoPor: 'MRT-50.73',
  gate: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null,
  nativo: false,
  dll: false,
  tx: false,
  encodingContratoCds: ENCODING_DESTAXA,
  producaoAtual: {
    tipoDebito: TIPOS_CARTAO_CRT_DOCUMENTADOS.DEBITO,
    crtDebito: buildCrtInput({ valorCentavos: 100, tipoPdv: 'cartao_debito' }).texto
  },
  divergenciasDocumentais: [
    { fonte: 'docs/06', valor: 'Débito' },
    { fonte: 'examples + docs/07 + CDS MRT-50.73', valor: 'Debito' }
  ],
  matriz,
  testes: { passou, falhou },
  geradoEm: new Date().toISOString()
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const outJson = path.join(OUT_DIR, 'matriz-encoding-resultado.json');
fs.writeFileSync(outJson, JSON.stringify(resultado, null, 2) + '\n', 'utf8');

console.log(`\nResumo: ${passou} ok / ${falhou} falhas`);
console.log(`Artefato: ${outJson}`);
process.exit(falhou ? 1 : 0);
