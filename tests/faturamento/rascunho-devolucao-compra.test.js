/**
 * Rascunho NF-e Devolução Compra — persistência sem afetar saldo
 * Executar: node tests/faturamento/rascunho-devolucao-compra.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

console.log('\n=== Rascunho Devolução Compra ===\n');

test('serviço rascunho existe', () => {
  const svc = require('../../backend/services/fiscal/rascunhoDevolucaoCompra');
  assert.strictEqual(typeof svc.salvarRascunhoDevolucaoCompra, 'function');
  assert.strictEqual(typeof svc.obterRascunhoDevolucaoCompra, 'function');
  assert.strictEqual(typeof svc.excluirRascunhoDevolucaoCompra, 'function');
  assert.strictEqual(svc.STATUS_RASCUNHO, 'RASCUNHO');
});

test('rotas de rascunho registradas', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');
  assert.match(src, /nfe-devolucao\/rascunho/);
  assert.match(src, /salvarRascunhoDevolucaoCompra/);
});

test('frontend: botão Salvar e Continuar Depois', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
  assert.match(src, /Salvar e Continuar Depois/);
  assert.match(src, /salvarRascunhoDevolucaoCompra/);
  assert.match(src, /oferecerRetomarRascunhoDevolucaoCompra/);
});

test('preparar inclui rascunho no retorno', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/nfeDevolucaoCompra.js'), 'utf8');
  assert.match(src, /obterRascunhoDevolucaoCompra/);
  assert.match(src, /rascunho/);
});

test('emissão autorizada remove rascunho', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/nfeDevolucaoCompra.js'), 'utf8');
  assert.match(src, /excluirRascunhoDevolucaoCompra/);
});

test('controle saldo não referencia rascunho', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/controleSaldoDevolucaoCompra.js'), 'utf8');
  assert.doesNotMatch(src, /rascunho/i);
});

(async () => {
  await testAsync('salvar/obter/excluir rascunho (integração DB)', async () => {
    const {
      salvarRascunhoDevolucaoCompra,
      obterRascunhoDevolucaoCompra,
      excluirRascunhoDevolucaoCompra
    } = require('../../backend/services/fiscal/rascunhoDevolucaoCompra');

    const compraId = 999999001;
    await excluirRascunhoDevolucaoCompra(compraId).catch(() => {});

    const salvo = await salvarRascunhoDevolucaoCompra(compraId, {
      fornecedor: 'Fornecedor Teste',
      chave_nfe_original: '1'.repeat(44),
      cfop: '5202',
      observacoes: 'Teste rascunho',
      itens: [
        { compra_item_id: 10, produto_id: 1, produto_nome: 'Produto A', quantidade: 3, cfop: '5202' },
        { compra_item_id: 11, produto_id: 2, produto_nome: 'Produto B', quantidade: 0 }
      ]
    }, { usuarioId: 1, usuarioNome: 'Teste' });

    assert.strictEqual(salvo.status, 'RASCUNHO');
    assert.strictEqual(salvo.compra_id, compraId);
    assert.strictEqual(salvo.itens.length, 1);
    assert.strictEqual(salvo.itens[0].quantidade, 3);

    const lido = await obterRascunhoDevolucaoCompra(compraId);
    assert.ok(lido);
    assert.strictEqual(lido.itens[0].compra_item_id, 10);

    const rem = await excluirRascunhoDevolucaoCompra(compraId);
    assert.strictEqual(rem.removido, true);
    assert.strictEqual(await obterRascunhoDevolucaoCompra(compraId), null);
  });

  console.log(`\n--- Resultado: ${ok} OK, ${falhas} falha(s) ---\n`);
  if (falhas > 0) process.exit(1);
})();
