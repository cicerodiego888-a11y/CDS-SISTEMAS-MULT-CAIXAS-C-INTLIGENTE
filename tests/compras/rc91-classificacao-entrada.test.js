/**
 * RC9.1 — Classificação Inteligente da Entrada
 * Executar: node tests/compras/rc91-classificacao-entrada.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  classificarPorCfop,
  classificarPorNatureza,
  classificarEntrada
} = require('../../backend/services/compras/ClassificadorEntradaCompra');
const { classificarEntrada: classificarViaMotor } = require('../../backend/services/compras/MotorPoliticaEntradaCompra');
const { extrairSinaisFiscaisDoXml } = require('../../backend/services/compras/extrairSinaisFiscaisXml');
const { TIPO_ENTRADA } = require('../../backend/services/compras/PoliticaEntradaCompra');

const ROOT = path.join(__dirname, '../..');
let ok = 0;
let falhas = 0;

function test(nome, fn) {
  try {
    fn();
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FAIL  ${nome}`);
    console.error(`       ${err.message}`);
  }
}

async function testAsync(nome, fn) {
  try {
    await fn();
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FAIL  ${nome}`);
    console.error(`       ${err.message}`);
  }
}

console.log('\n=== RC9.1 — Classificação Inteligente ===\n');

test('arquivos RC9.1 existem', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/compras/ClassificadorEntradaCompra.js')));
  assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/compras/extrairSinaisFiscaisXml.js')));
});

test('CFOP revenda 1102', () => {
  const r = classificarPorCfop('1102');
  assert.strictEqual(r.tipo, TIPO_ENTRADA.REVENDA);
  assert.ok(r.confianca >= 80);
});

test('CFOP industrialização 1101', () => {
  const r = classificarPorCfop('1101');
  assert.strictEqual(r.tipo, TIPO_ENTRADA.INDUSTRIALIZACAO);
});

test('CFOP uso e consumo 1556', () => {
  const r = classificarPorCfop('1556');
  assert.strictEqual(r.tipo, TIPO_ENTRADA.USO_CONSUMO);
  assert.ok(r.confianca >= 90);
});

test('natureza uso interno', () => {
  const r = classificarPorNatureza('COMPRA PARA USO E CONSUMO');
  assert.strictEqual(r.tipo, TIPO_ENTRADA.USO_CONSUMO);
});

test('extrai CFOP e natOp do XML', () => {
  const xml = `<infNFe><ide><natOp>Compra para comercializacao</natOp><finNFe>1</finNFe></ide><det><prod><CFOP>1102</CFOP></prod></det></infNFe>`;
  const s = extrairSinaisFiscaisDoXml(xml);
  assert.strictEqual(s.cfopPredominante, '1102');
  assert.match(s.natureza, /comercializacao/i);
  assert.strictEqual(s.finalidade, '1');
});

test('MotorPoliticaEntradaCompra exporta classificarEntrada', () => {
  assert.strictEqual(typeof classificarViaMotor, 'function');
});

test('database migra colunas de auditoria RC9.1', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
  assert.match(src, /tipo_entrada_sugerido/);
  assert.match(src, /tipo_entrada_confianca/);
  assert.match(src, /tipo_entrada_motivo/);
  assert.match(src, /tipo_entrada_alterado/);
});

test('API classificar-entrada na rota', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');
  assert.match(src, /classificar-entrada/);
  assert.match(src, /tipo_entrada_sugerido/);
});

test('UI exibe confiança e motivo', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
  assert.match(src, /classificarEntradaCompraApi/);
  assert.match(src, /Confiança/);
  assert.match(src, /tipo_entrada_sugerido/);
});

test('Central exibe classificação', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/central-entradas.js'), 'utf8');
  assert.match(src, /renderClassificacaoEntradaCentral/);
  assert.match(src, /Tipo sugerido/);
  assert.match(src, /Tipo escolhido/);
});

test('RC9.0 compatível — MotorPoliticaEntradaCompra mantém classificarFluxoCompra', () => {
  const motor = require('../../backend/services/compras/MotorPoliticaEntradaCompra');
  assert.strictEqual(typeof motor.classificarFluxoCompra, 'function');
  assert.strictEqual(typeof motor.validarCriacaoCompra, 'function');
  const f = motor.classificarFluxoCompra({ tipo_entrada: 'USO_CONSUMO' });
  assert.strictEqual(f.entradaSimplificada, true);
});

(async () => {
  await testAsync('classificarEntrada por XML uso consumo', async () => {
    const xml = `<nfeProc><infNFe><ide><natOp>Material de uso e consumo</natOp><finNFe>1</finNFe></ide><det><prod><CFOP>1556</CFOP></prod></det></infNFe></nfeProc>`;
    const r = await classificarEntrada({ xml });
    assert.strictEqual(r.tipoEntrada, TIPO_ENTRADA.USO_CONSUMO);
    assert.ok(r.confianca >= 85);
    assert.ok(r.motivo);
  });

  await testAsync('classificarEntrada por XML revenda', async () => {
    const xml = `<infNFe><ide><natOp>Compra para revenda</natOp><finNFe>1</finNFe></ide><det><prod><CFOP>1102</CFOP></prod></det></infNFe>`;
    const r = await classificarEntrada(xml);
    assert.strictEqual(r.tipoEntrada, TIPO_ENTRADA.REVENDA);
  });

  await testAsync('classificarEntrada fornecedor novo sem histórico', async () => {
    const r = await classificarEntrada({
      dadosCompra: { fornecedor_cnpj: '00000000000191', natureza_operacao: 'VENDA MERCADORIA' },
      cfop: '2102'
    });
    assert.strictEqual(r.tipoEntrada, TIPO_ENTRADA.REVENDA);
    assert.ok(r.confianca >= 70);
  });

  await testAsync('classificarViaMotor equivale', async () => {
    const r = await classificarViaMotor({ cfop: '1556', natureza: 'USO CONSUMO' });
    assert.strictEqual(r.tipoEntrada, TIPO_ENTRADA.USO_CONSUMO);
  });

  console.log(`\n--- Resultado: ${ok} OK, ${falhas} falha(s) ---\n`);
  if (falhas > 0) process.exit(1);
})();
