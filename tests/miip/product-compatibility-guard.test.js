/**
 * ProductCompatibilityGuard — testes de compatibilidade comercial MIIP
 * Executar: node tests/miip/product-compatibility-guard.test.js
 */

'use strict';

const assert = require('assert');
const Guard = require('../../backend/motores/miip/utils/ProductCompatibilityGuard');
const AttributeParser = require('../../backend/motores/miip/utils/AttributeParser');
const CanonicalNormalizer = require('../../backend/motores/miip/utils/CanonicalNormalizer');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

function semantic(tipo, extras = {}) {
  return { tipo, material: extras.material || null, comprimento: extras.comprimento || null, ...extras };
}

async function main() {
  console.log('\n=== ProductCompatibilityGuard ===\n');
  Guard.reiniciarMetricas();
  AttributeParser.reiniciarCacheConfig();

  await test('1. FACA × PASSA FIO → incompatível', () => {
    const r = Guard.avaliar({
      itemXml: { ncm: '82014000', produto_nome: 'FACA DE ACO' },
      produtoCds: { ncm: '39173900', nome: 'PASSA FIO ACO' },
      semanticXml: semantic('FACA', { material: 'ACO' }),
      semanticCds: semantic('PASSA FIO', { material: 'ACO' })
    });
    assert.strictEqual(r.compativel, false);
    assert.strictEqual(r.bloqueado, true);
    assert.ok(r.divergencias.some((d) => d.tipo === 'incompatibilidade_tipo'));
  });

  await test('2. TORNEIRA × MANGUEIRA → incompatível', () => {
    const r = Guard.avaliar({
      semanticXml: semantic('TORNEIRA'),
      semanticCds: semantic('MANGUEIRA')
    });
    assert.strictEqual(r.bloqueado, true);
  });

  await test('3. CIMENTO × ARGAMASSA → incompatível', () => {
    const r = Guard.avaliar({
      semanticXml: semantic('CIMENTO'),
      semanticCds: semantic('ARGAMASSA')
    });
    assert.strictEqual(r.bloqueado, true);
  });

  await test('4. ARROZ × FEIJAO → incompatível', () => {
    const r = Guard.avaliar({
      semanticXml: semantic('ARROZ'),
      semanticCds: semantic('FEIJAO')
    });
    assert.strictEqual(r.bloqueado, true);
  });

  await test('5. FURADEIRA × SERRA → incompatível', () => {
    const r = Guard.avaliar({
      semanticXml: semantic('FURADEIRA'),
      semanticCds: semantic('SERRA')
    });
    assert.strictEqual(r.bloqueado, true);
  });

  await test('6. LAMPADA × LAMPADA → compatível', () => {
    const r = Guard.avaliar({
      semanticXml: semantic('LAMPADA'),
      semanticCds: semantic('LAMPADA')
    });
    assert.strictEqual(r.compativel, true);
    assert.strictEqual(r.bloqueado, false);
  });

  await test('7. PARAFUSO × PARAFUSO → compatível', () => {
    const r = Guard.avaliar({
      semanticXml: semantic('PARAFUSO'),
      semanticCds: semantic('PARAFUSO')
    });
    assert.strictEqual(r.compativel, true);
  });

  await test('8. material igual não basta (FACA ACO × PASSA FIO ACO)', () => {
    const r = Guard.avaliar({
      semanticXml: semantic('FACA', { material: 'ACO' }),
      semanticCds: semantic('PASSA FIO', { material: 'ACO' })
    });
    assert.strictEqual(r.bloqueado, true);
    assert.ok(r.regrasAplicadas.includes('material_generico_insuficiente')
      || r.regrasAplicadas.includes('tipo_incompativel'));
  });

  await test('9. NCM diferente + tipo incompatível → incompatível', () => {
    const r = Guard.avaliar({
      itemXml: { ncm: '82014000' },
      produtoCds: { ncm: '39173900' },
      semanticXml: semantic('FACA'),
      semanticCds: semantic('PASSA FIO')
    });
    assert.strictEqual(r.bloqueado, true);
    assert.ok(r.divergencias.some((d) => d.tipo === 'ncm_incompativel'));
  });

  await test('10. NCM diferente + tipo compatível → não bloqueia', () => {
    const r = Guard.avaliar({
      itemXml: { ncm: '85392200' },
      produtoCds: { ncm: '85392900' },
      semanticXml: semantic('LAMPADA'),
      semanticCds: semantic('LAMPADA')
    });
    assert.strictEqual(r.bloqueado, false);
    assert.strictEqual(r.compativel, true);
  });

  await test('11. GTIN exato → não bloqueia por divergência semântica', () => {
    const r = Guard.avaliar({
      semanticXml: semantic('FACA'),
      semanticCds: semantic('PASSA FIO'),
      motivosMatch: ['gtin_exato']
    });
    assert.strictEqual(r.compativel, true);
    assert.strictEqual(r.bloqueado, false);
  });

  await test('12. código fornecedor exato → não bloqueia', () => {
    const r = Guard.avaliar({
      semanticXml: semantic('FACA'),
      semanticCds: semantic('PASSA FIO'),
      motivosMatch: ['codigo_fornecedor']
    });
    assert.strictEqual(r.compativel, true);
  });

  await test('13. GTIN parcial → continua sujeito à compatibilidade', () => {
    const r = Guard.avaliar({
      semanticXml: semantic('FACA'),
      semanticCds: semantic('PASSA FIO'),
      motivosMatch: ['gtin_parcial']
    });
    assert.strictEqual(r.bloqueado, true);
    assert.ok(r.regrasAplicadas.includes('gtin_parcial_nao_isenta'));
  });

  await test('Parser: FACA DE ACO → tipo FACA', () => {
    AttributeParser.reiniciarCacheConfig();
    const attrs = AttributeParser.extrairAtributos(CanonicalNormalizer.normalizar(
      'FACA DE ACO INOXIDAVEL COM CABO DE PLASTICO 16'
    ));
    assert.strictEqual(String(attrs.tipo?.valor || '').toUpperCase(), 'FACA');
    assert.notStrictEqual(String(attrs.tipo?.valor || '').toUpperCase(), 'CABO');
  });

  await test('Parser: PASSA FIO → tipo PASSA FIO', () => {
    AttributeParser.reiniciarCacheConfig();
    const attrs = AttributeParser.extrairAtributos(CanonicalNormalizer.normalizar(
      'PASSA FIO COM ALMA DE ACO 20M CORTAG'
    ));
    assert.strictEqual(String(attrs.tipo?.valor || '').toUpperCase(), 'PASSA FIO');
  });

  await test('Parser: CABO FLEXIVEL → tipo CABO', () => {
    AttributeParser.reiniciarCacheConfig();
    const attrs = AttributeParser.extrairAtributos(CanonicalNormalizer.normalizar(
      'CABO FLEXIVEL 2,5MM'
    ));
    assert.strictEqual(String(attrs.tipo?.valor || '').toUpperCase(), 'CABO');
  });

  await test('Caso real: FACA 82014000 × PASSA FIO 39173900 bloqueado', () => {
    const r = Guard.avaliar({
      itemXml: {
        produto_nome: 'FACA DE ACO INOXIDAVEL COM CABO DE PLASTICO 16" (36 PCS P/ CX)',
        ncm: '82014000'
      },
      produtoCds: {
        nome: 'Passa Fio com Alma de Aço 20m Cortag',
        ncm: '39173900'
      },
      semanticXml: semantic('FACA', { material: 'ACO' }),
      semanticCds: semantic('PASSA FIO', { material: 'ACO', comprimento: '20M' })
    });
    assert.strictEqual(r.bloqueado, true);
    assert.ok(r.divergencias.some((d) => d.tipo === 'incompatibilidade_tipo'));
    assert.ok(r.divergencias.some((d) => d.tipo === 'ncm_incompativel'));
  });

  console.log(`\nResultado: ${passou} OK, ${falhou} FALHOU\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
