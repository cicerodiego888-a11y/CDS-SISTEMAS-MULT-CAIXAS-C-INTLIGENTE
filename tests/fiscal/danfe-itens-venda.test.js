/**
 * Testes — DANFE NFC-e com todos os produtos da venda
 * Executar: node tests/fiscal/danfe-itens-venda.test.js
 */

const assert = require('assert');
const {
  gerarDanfeHtml,
  obterQuantidadeImpressao,
  obterValorImpressao,
  obterQuantidadeFiscalDanfe,
  obterValorFiscalItemDanfe,
  obterPagamentosComerciaisDanfe
} = require('../../backend/services/fiscal/danfe');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
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

const itemArroz = {
  produto_nome: 'Arroz',
  quantidade_fiscal: 1,
  quantidade_nao_fiscal: 0,
  valor_fiscal: 10,
  valor_nao_fiscal: 0,
  preco_unitario: 10
};

const itemRefrigerante = {
  produto_nome: 'Refrigerante',
  quantidade_fiscal: 0,
  quantidade_nao_fiscal: 1,
  valor_fiscal: 0,
  valor_nao_fiscal: 5,
  preco_unitario: 5
};

async function main() {
  console.log('\n=== Testes DANFE — todos os produtos da venda ===\n');

  await test('obterQuantidadeImpressao soma fiscal + não fiscal', async () => {
    assert.strictEqual(obterQuantidadeImpressao(itemArroz), 1);
    assert.strictEqual(obterQuantidadeImpressao(itemRefrigerante), 1);
    assert.strictEqual(obterQuantidadeImpressao({
      quantidade_fiscal: 2,
      quantidade_nao_fiscal: 3
    }), 5);
  });

  await test('obterValorImpressao soma fiscal + não fiscal', async () => {
    assert.strictEqual(obterValorImpressao(itemArroz), 10);
    assert.strictEqual(obterValorImpressao(itemRefrigerante), 5);
  });

  await test('helpers fiscais permanecem inalterados', async () => {
    assert.strictEqual(obterQuantidadeFiscalDanfe(itemRefrigerante), 0);
    assert.strictEqual(obterValorFiscalItemDanfe(itemRefrigerante), 0);
    assert.strictEqual(obterValorFiscalItemDanfe(itemArroz), 10);
  });

  await test('DANFE lista Arroz e Refrigerante', async () => {
    const html = await gerarDanfeHtml({
      venda: { total: 15, desconto: 0, valor_fiscal: 10 },
      itens: [itemArroz, itemRefrigerante],
      itensFiscal: [itemArroz],
      empresa: { nome: 'Loja Teste', cnpj: '65957340000150', endereco: 'Rua A' },
      chave: '35260112345678000199550010000000011000000001',
      numero: 1,
      serie: 1,
      qrCodeUrl: '',
      tributos: { vICMS: 1, vPIS: 0.5, vCOFINS: 0.5 },
      nota: { tpAmb: 1 }
    });

    assert.ok(html.includes('Arroz'), 'deve conter Arroz');
    assert.ok(html.includes('Refrigerante'), 'deve conter Refrigerante');
    assert.ok(!html.includes('Não Fiscal'), 'sem rótulo não fiscal');
    assert.ok(!html.includes('tipo_recebimento'), 'sem vazamento de alocação F/NF');
    assert.ok(html.includes('Total: R$ 15.00'), 'total da venda completa');
    assert.ok(html.includes('ICMS'), 'tributos fiscais preservados');
    assert.ok(html.includes('R$ 1.00'), 'valor ICMS preservado');
    assert.ok(html.includes('35260112345678000199550010000000011000000001'), 'chave preservada');
  });

  await test('DANFE não inclui Refrigerante quando só itens fiscais passados (legado)', async () => {
    const html = await gerarDanfeHtml({
      venda: { total: 10, valor_fiscal: 10 },
      itens: [itemArroz],
      itensFiscal: [itemArroz],
      empresa: { nome: 'Loja', cnpj: '65957340000150', endereco: '' },
      chave: 'CHAVE123',
      numero: 2,
      serie: 1,
      qrCodeUrl: '',
      tributos: null,
      nota: { tpAmb: 1 }
    });

    assert.ok(html.includes('Arroz'));
    assert.ok(!html.includes('Refrigerante'));
  });

  await test('DANFE pagamentos: valor pago pelo cliente (fiscal + não fiscal)', async () => {
    const html = await gerarDanfeHtml({
      venda: {
        total: 10,
        desconto: 0,
        valor_fiscal: 2,
        valor_nao_fiscal: 8,
        pagamentos: [
          { forma_pagamento: 'dinheiro', valor: 2, tipo_recebimento: 'fiscal' },
          { forma_pagamento: 'dinheiro', valor: 8, tipo_recebimento: 'nao_fiscal' }
        ]
      },
      itens: [itemArroz],
      itensFiscal: [itemArroz],
      empresa: { nome: 'Loja', cnpj: '65957340000150', endereco: '' },
      chave: 'CHAVE123',
      numero: 3,
      serie: 1,
      qrCodeUrl: '',
      tributos: null,
      nota: { tpAmb: 1 }
    });

    assert.ok(html.includes('Dinheiro: R$ 10,00'), 'deve somar o valor comercial pago');
    assert.ok(!html.includes('Dinheiro: R$ 2,00'), 'não deve mostrar só a fatia fiscal');
  });

  await test('DANFE prioriza recebimentos F+NF mesmo com venda_pagamentos incompleto', async () => {
    const html = await gerarDanfeHtml({
      venda: {
        total: 4,
        desconto: 0,
        valor_fiscal: 2,
        valor_nao_fiscal: 2,
        forma_pagamento: 'cartao_credito',
        pagamentos: [
          { forma_pagamento: 'cartao_credito', valor: 2, tipo_recebimento: 'fiscal' },
          { forma_pagamento: 'pix', valor: 2, tipo_recebimento: 'nao_fiscal' }
        ],
        pagamentos_comerciais: [
          { forma_pagamento: 'cartao_credito', valor: 2 }
        ]
      },
      itens: [itemArroz],
      itensFiscal: [itemArroz],
      empresa: { nome: 'Loja', cnpj: '65957340000150', endereco: '' },
      chave: 'CHAVE123',
      numero: 4,
      serie: 1,
      qrCodeUrl: '',
      tributos: null,
      nota: { tpAmb: 1 }
    });

    assert.ok(html.includes('Cartão Crédito: R$ 2,00'), 'mostra cartão fiscal');
    assert.ok(html.includes('PIX: R$ 2,00'), 'mostra pix não fiscal');
    assert.ok(html.includes('Total: R$ 4.00'), 'total comercial');
  });

  await test('DANFE prioriza pagamentos_comerciais quando recebimentos ainda incompletos', async () => {
    const html = await gerarDanfeHtml({
      venda: {
        total: 10,
        desconto: 0,
        valor_fiscal: 2,
        valor_nao_fiscal: 8,
        pagamentos: [
          { forma_pagamento: 'dinheiro', valor: 2, tipo_recebimento: 'fiscal' }
        ],
        pagamentos_comerciais: [
          { forma_pagamento: 'dinheiro', valor: 10 }
        ]
      },
      itens: [itemArroz],
      itensFiscal: [itemArroz],
      empresa: { nome: 'Loja', cnpj: '65957340000150', endereco: '' },
      chave: 'CHAVE123',
      numero: 5,
      serie: 1,
      qrCodeUrl: '',
      tributos: null,
      nota: { tpAmb: 1 }
    });

    assert.ok(html.includes('Dinheiro: R$ 10,00'), 'usa valor comercial pago pelo cliente');
    assert.ok(!html.includes('Dinheiro: R$ 2,00'), 'ignora fatia fiscal isolada');
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
