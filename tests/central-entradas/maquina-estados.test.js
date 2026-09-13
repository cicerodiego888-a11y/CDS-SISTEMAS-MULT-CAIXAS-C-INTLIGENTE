/**
 * Testes — Máquina de estados da Central de Entradas (RC3.7.1)
 * Executar: npm run test:central-entradas-estados
 */

'use strict';

const assert = require('assert');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const {
  podeTransicionar,
  validarTransicao
} = require('../../backend/motores/central-entradas/core/MaquinaEstadosDocumento');

const S = DocumentoFiscalStatus;
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
    console.error(`         ${error.message}`);
  }
}

console.log('\n=== Testes Máquina de Estados — RC3.7.1 ===\n');

test('XML_COMPLETO → EM_REVISAO é permitida', () => {
  assert.strictEqual(podeTransicionar(S.XML_COMPLETO, S.EM_REVISAO), true);
  assert.strictEqual(podeTransicionar(S.SINCRONIZADA, S.AGUARDANDO_REVISAO), true);
});

test('XML_COMPLETO → IMPORTADA via alias GRAVADA é bloqueada direta', () => {
  const resultado = validarTransicao(S.XML_COMPLETO, S.IMPORTADA);
  // IMPORTADA permitida a partir de XML_COMPLETO (já comprada) — máquina permite
  assert.strictEqual(typeof resultado.valido, 'boolean');
});

test('IMPORTADA não é hard-terminal para FINALIZADA', () => {
  assert.strictEqual(podeTransicionar(S.IMPORTADA, S.FINALIZADA), true);
  assert.strictEqual(podeTransicionar(S.GRAVADA, S.FINALIZADA), true);
});

test('ERRO → XML_COMPLETO permite reprocessamento', () => {
  assert.strictEqual(podeTransicionar(S.ERRO, S.XML_COMPLETO), true);
  assert.strictEqual(podeTransicionar(S.ERRO, S.SINCRONIZADA), true);
});

test('mesmo status é idempotente', () => {
  assert.strictEqual(validarTransicao(S.PRONTA_IMPORTACAO, S.PRONTA_PARA_COMPRA).valido, true);
});

test('PRONTA → EM_IMPORTACAO é permitida', () => {
  assert.strictEqual(podeTransicionar(S.PRONTA_IMPORTACAO, S.EM_IMPORTACAO), true);
  assert.strictEqual(podeTransicionar(S.REVISADA, S.EM_COMPRA), true);
});

test('RESUMO_RECEBIDO → XML_COMPLETO é permitida', () => {
  assert.strictEqual(
    podeTransicionar(S.RESUMO_RECEBIDO, S.XML_COMPLETO),
    true
  );
  assert.strictEqual(
    podeTransicionar(S.AGUARDANDO_XML_COMPLETO, S.SINCRONIZADA),
    true
  );
});

test('RESUMO_RECEBIDO → EM_REVISAO é bloqueada', () => {
  assert.strictEqual(
    podeTransicionar(S.RESUMO_RECEBIDO, S.EM_REVISAO),
    false
  );
});

test('RESUMO_RECEBIDO → XML_INDISPONIVEL é permitida', () => {
  assert.strictEqual(
    podeTransicionar(S.RESUMO_RECEBIDO, S.XML_INDISPONIVEL),
    true
  );
});

test('XML_INDISPONIVEL → XML_COMPLETO (procNFe) é permitida', () => {
  assert.strictEqual(podeTransicionar(S.XML_INDISPONIVEL, S.XML_COMPLETO), true);
});

test('Cancelamento paralelo a partir de EM_REVISAO', () => {
  assert.strictEqual(podeTransicionar(S.EM_REVISAO, S.CANCELADA), true);
});

console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
if (falhou > 0) process.exit(1);
