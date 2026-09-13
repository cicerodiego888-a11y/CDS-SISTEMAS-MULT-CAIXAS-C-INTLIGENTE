/**
 * RC COMPRAS 5.4.1 — Importação financeira NF-e
 * Executar: node tests/compras/rc541-importacao-financeira-nfe.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const {
  mapearTPagParaForma,
  extrairDetPag,
  extrairCobranca,
  montarImportacaoFinanceiraNfe,
  calcularTotalComponentes
} = require(path.join(__dirname, '../../backend/services/compras/ImportacaoFinanceiraNfe'));
const { mapearInfNFe } = require(path.join(__dirname, '../../backend/shared/nfe/mappers/nfeXmlMapper'));

let ok = 0;
let falhas = 0;

function test(nome, fn) {
  try {
    fn();
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${err.message}`);
  }
}

console.log('\n=== RC COMPRAS 5.4.1 — Importação Financeira NF-e ===\n');

test('tPag mapeia formas CDS', () => {
  assert.strictEqual(mapearTPagParaForma('01'), 'dinheiro');
  assert.strictEqual(mapearTPagParaForma('03'), 'cartao_credito');
  assert.strictEqual(mapearTPagParaForma('15'), 'boleto');
  assert.strictEqual(mapearTPagParaForma('17'), 'pix');
  assert.strictEqual(mapearTPagParaForma('18'), 'transferencia');
  assert.strictEqual(mapearTPagParaForma('90'), 'sem_pagamento');
  assert.strictEqual(mapearTPagParaForma('99'), 'outro');
});

test('XML sem parcelas → à vista', () => {
  const fin = montarImportacaoFinanceiraNfe({
    pag: { detPag: { tPag: '17', vPag: '100.00', indPag: '0' } },
    cobr: null,
    icmsTot: { vProd: '100.00', vDesc: '0', vFrete: '0', vSeg: '0', vOutro: '0', vIPI: '0', vNF: '100.00' }
  });
  assert.strictEqual(fin.condicao_pagamento, 'avista');
  assert.strictEqual(fin.forma_pagamento, 'pix');
  assert.strictEqual(fin.parcelas_detalhe.length, 0);
  assert.strictEqual(fin.valor_total_nota, 100);
});

test('XML com 1 parcela (dup)', () => {
  const fin = montarImportacaoFinanceiraNfe({
    pag: { detPag: { tPag: '15', vPag: '500.00', indPag: '1' } },
    cobr: { dup: { nDup: '001', dVenc: '2026-08-15', vDup: '500.00' } },
    icmsTot: { vProd: '500', vNF: '500', vIPI: '0' }
  });
  assert.strictEqual(fin.condicao_pagamento, 'prazo');
  assert.strictEqual(fin.forma_pagamento, 'boleto');
  assert.strictEqual(fin.parcelas_detalhe.length, 1);
  assert.strictEqual(fin.parcelas_detalhe[0].valor, 500);
  assert.strictEqual(fin.parcelas_detalhe[0].vencimento, '2026-08-15');
});

test('XML com várias parcelas', () => {
  const fin = montarImportacaoFinanceiraNfe({
    pag: { detPag: { tPag: '15', vPag: '3750.00', indPag: '1' } },
    cobr: {
      fat: { nFat: '1', vOrig: '3750', vLiq: '3750' },
      dup: [
        { nDup: '001', dVenc: '2026-08-15', vDup: '1250.00' },
        { nDup: '002', dVenc: '2026-09-15', vDup: '1250.00' },
        { nDup: '003', dVenc: '2026-10-15', vDup: '1250.00' }
      ]
    },
    icmsTot: { vProd: '3750', vNF: '3750' }
  });
  assert.strictEqual(fin.parcelas_detalhe.length, 3);
  assert.strictEqual(fin.parcelas, 3);
  assert.strictEqual(fin.data_vencimento, '2026-08-15');
  const soma = fin.parcelas_detalhe.reduce((s, p) => s + p.valor, 0);
  assert.strictEqual(Number(soma.toFixed(2)), 3750);
});

test('XML sem IPI', () => {
  const fin = montarImportacaoFinanceiraNfe({
    icmsTot: { vProd: '200', vIPI: '0', vNF: '200' }
  });
  assert.strictEqual(fin.valor_ipi, 0);
});

test('XML com IPI participa do total componentes', () => {
  const fin = montarImportacaoFinanceiraNfe({
    icmsTot: {
      vProd: '1000',
      vDesc: '50',
      vFrete: '30',
      vSeg: '10',
      vOutro: '20',
      vIPI: '100',
      vNF: '1110'
    }
  });
  assert.strictEqual(fin.valor_ipi, 100);
  assert.strictEqual(fin.valor_seguro, 10);
  assert.strictEqual(fin.valor_total_nota, 1110);
  assert.strictEqual(calcularTotalComponentes(fin), 1110);
});

test('XML com múltiplas formas de pagamento (maior vPag vence)', () => {
  const fin = montarImportacaoFinanceiraNfe({
    pag: {
      detPag: [
        { tPag: '01', vPag: '100.00' },
        { tPag: '17', vPag: '900.00' }
      ]
    },
    icmsTot: { vProd: '1000', vNF: '1000' }
  });
  assert.strictEqual(fin.pagamentos.length, 2);
  assert.strictEqual(fin.forma_pagamento, 'pix');
});

test('extrairDetPag e extrairCobranca isolados', () => {
  assert.strictEqual(extrairDetPag(null).length, 0);
  assert.deepStrictEqual(extrairCobranca(null), { fatura: null, duplicatas: [] });
});

test('mapearInfNFe inclui financeiro no DTO', () => {
  const dto = mapearInfNFe({
    $: { Id: 'NFe23260705065496000103550010009837001522925593' },
    ide: { nNF: '983700', serie: '1', mod: '55', dhEmi: '2026-07-15T10:00:00-03:00' },
    emit: { xNome: 'FORN TESTE', CNPJ: '05065496000103', enderEmit: {} },
    det: [{
      prod: {
        xProd: 'Item', cProd: '1', uCom: 'UN', qCom: '1', vUnCom: '100', vProd: '100', NCM: '00000000', CFOP: '5102'
      },
      imposto: {}
    }],
    total: { ICMSTot: { vProd: '100', vDesc: '0', vFrete: '0', vSeg: '0', vOutro: '0', vIPI: '15', vNF: '115' } },
    pag: { detPag: { tPag: '15', vPag: '115.00', indPag: '1' } },
    cobr: {
      dup: [
        { nDup: '001', dVenc: '2026-08-01', vDup: '57.50' },
        { nDup: '002', dVenc: '2026-09-01', vDup: '57.50' }
      ]
    },
    infAdic: {}
  });
  const json = dto.toJSON();
  assert.strictEqual(json.valor_ipi, 15);
  assert.strictEqual(json.valor_total_nota, 115);
  assert.strictEqual(json.forma_pagamento, 'boleto');
  assert.strictEqual(json.condicao_pagamento, 'prazo');
  assert.strictEqual(json.parcelas_detalhe.length, 2);
});

console.log(`\nResultado: ${ok} ok, ${falhas} falhas\n`);
process.exit(falhas ? 1 : 0);
