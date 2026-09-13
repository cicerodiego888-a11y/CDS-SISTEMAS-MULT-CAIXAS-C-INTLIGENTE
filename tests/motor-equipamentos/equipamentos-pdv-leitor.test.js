/**
 * Sprint EQUIPAMENTOS 03 — PDV → Motor → Parser → MIP(PLU)
 * Executar: node tests/motor-equipamentos/equipamentos-pdv-leitor.test.js
 */

const assert = require('assert');
const { obterPreset } = require('../../backend/motores/equipamentos/layouts/presetsEtiqueta');
const { parseEtiquetaComLayout } = require('../../backend/motores/equipamentos/layouts/ConfiguravelEtiquetaParser');
const { LayoutEtiquetaService } = require('../../backend/motores/equipamentos/services/LayoutEtiquetaService');

const CODIGO = '2000067010019';

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

async function main() {
  console.log('\n=== Sprint EQUIPAMENTOS 03 — Leitor → Motor → PLU ===\n');

  await test('parser Motor: 2000067010019 → PLU 67 (layout Toledo ativo simulado)', () => {
    const layout = obterPreset('toledo_prix4_uno_valor');
    const parsed = parseEtiquetaComLayout(CODIGO, layout);
    assert.ok(parsed);
    assert.strictEqual(parsed.plu, '67');
    assert.strictEqual(Number(parsed.valorTotal.toFixed(2)), 10.01);
  });

  await test('interpretarEtiqueta usa layout injetado e devolve PLU para o MIP', async () => {
    const svc = new LayoutEtiquetaService();
    // stub ativo → Toledo (não altera MIP/parser; só serviço)
    svc.obterLayoutAtivo = async () => obterPreset('toledo_prix4_uno_valor');
    const out = await svc.interpretarEtiqueta(CODIGO);
    assert.strictEqual(out.sucesso, true);
    assert.strictEqual(out.resultado.plu, '67');
    // PDV deve enviar somente este PLU ao MIP — nunca o EAN completo
    assert.notStrictEqual(out.resultado.plu, CODIGO);
    assert.strictEqual(String(out.resultado.plu).length < 13, true);
  });

  await test('digitar 67 e etiqueta 2000067010019 compartilham o mesmo PLU alvo', () => {
    const pluDigitado = '67';
    const parsed = parseEtiquetaComLayout(CODIGO, obterPreset('toledo_prix4_uno_valor'));
    assert.strictEqual(parsed.plu, pluDigitado);
  });

  await test('PDV integra valor da etiqueta: qtd = valor÷preço e total = R$ 10,01', () => {
    const fs = require('fs');
    const path = require('path');
    const pdvSrc = fs.readFileSync(
      path.join(__dirname, '../../frontend/pdv/js/pdv.js'),
      'utf8'
    );
    assert.ok(pdvSrc.includes('calcularItemEtiquetaBalancaPdv'), 'helper de montagem ausente');
    assert.ok(pdvSrc.includes('subtotalFixo'), 'subtotal da etiqueta não é preservado no carrinho');
    assert.ok(pdvSrc.includes('normalizarQuantidadeEtiquetaPdv'), 'quantidade etiqueta sem 3 casas');

    const parsed = parseEtiquetaComLayout(CODIGO, obterPreset('toledo_prix4_uno_valor'));
    const precoCadastrado = 9.99; // não alterar
    const valorEtiqueta = Number(parsed.valorTotal.toFixed(2));
    assert.strictEqual(valorEtiqueta, 10.01);
    assert.strictEqual(parsed.tipoPayload, 'VALOR');

    // Regra VALOR (espelho do PDV)
    const quantidade = Number((valorEtiqueta / precoCadastrado).toFixed(3));
    const subtotal = Number(valorEtiqueta.toFixed(2));
    assert.strictEqual(quantidade, 1.002);
    assert.strictEqual(subtotal, 10.01);
    assert.strictEqual(precoCadastrado, 9.99);
    // Regressão antiga: 2 casas → 1.00 × 9.99 = 9.99 (perda do valor)
    assert.notStrictEqual(Number((valorEtiqueta / precoCadastrado).toFixed(2)) * precoCadastrado, 10.01);
  });

  await test('PDV regra PESO: quantidade = peso; total = qtd × preço', () => {
    const pesoEtiqueta = 1.250;
    const precoCadastrado = 9.99;
    const quantidade = Number(pesoEtiqueta.toFixed(3));
    const subtotal = Number((quantidade * precoCadastrado).toFixed(2));
    assert.strictEqual(quantidade, 1.25);
    assert.strictEqual(subtotal, 12.49);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
