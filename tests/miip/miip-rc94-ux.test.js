/**
 * RC9.4 — UX helpers da Central de Revisão (comparação visual)
 * Executar: npm run test:miip-rc94-ux
 */

'use strict';

const assert = require('assert');
const path = require('path');
const Intel = require(path.join(
  __dirname,
  '../../frontend/erp/js/miip-central-revisao-inteligente.js'
));

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

function main() {
  console.log('\n=== RC9.4 — UX Comparação Visual (helpers) ===\n');

  test('classificarCampoComparacao: igual', () => {
    const r = Intel.classificarCampoComparacao('Descrição', 'ARROZ TIPO 1', 'ARROZ TIPO 1', { tipo: 'texto' });
    assert.strictEqual(r.status, Intel.COMP_STATUS.IGUAL);
  });

  test('classificarCampoComparacao: semelhante', () => {
    const r = Intel.classificarCampoComparacao(
      'Descrição',
      'ARROZ BRANCO TIPO 1 5KG',
      'ARROZ BRANCO TIPO 1',
      { tipo: 'texto' }
    );
    assert.strictEqual(r.status, Intel.COMP_STATUS.SEMELHANTE);
    assert.ok(r.similaridade >= 60);
  });

  test('classificarCampoComparacao: diferente', () => {
    const r = Intel.classificarCampoComparacao('NCM', '10063021', '22021000', { tipo: 'codigo' });
    assert.strictEqual(r.status, Intel.COMP_STATUS.DIFERENTE);
  });

  test('classificarCampoComparacao: ausente', () => {
    const r = Intel.classificarCampoComparacao('CEST', '', '1703000', { tipo: 'codigo' });
    assert.strictEqual(r.status, Intel.COMP_STATUS.AUSENTE);
    assert.ok(String(r.rotulo).toLowerCase().includes('ausente'));
  });

  test('motivosSemCandidatoPadrao: fallback padrão', () => {
    const motivos = Intel.motivosSemCandidatoPadrao(null);
    assert.ok(Array.isArray(motivos));
    assert.ok(motivos.length >= 4);
    assert.ok(motivos.some((m) => /GTIN/i.test(m)));
  });

  test('motivosSemCandidatoPadrao: usa diagnostico', () => {
    const motivos = Intel.motivosSemCandidatoPadrao({
      motivos: ['GTIN inválido.', 'Sem associação.']
    });
    assert.deepStrictEqual(motivos, ['GTIN inválido.', 'Sem associação.']);
  });

  test('barraConfianca: faixas e barra', () => {
    const alta = Intel.barraConfianca(96);
    assert.strictEqual(alta.score, 96);
    assert.strictEqual(alta.tom, 'alta');
    assert.strictEqual(alta.barra.length, 10);

    const media = Intel.barraConfianca(85);
    assert.strictEqual(media.tom, 'media');

    const moderada = Intel.barraConfianca(60);
    assert.strictEqual(moderada.tom, 'moderada');

    const baixa = Intel.barraConfianca(20);
    assert.strictEqual(baixa.tom, 'baixa');
  });

  test('filtrarProdutosBuscaManual: nome, GTIN, PLU, código fornecedor', () => {
    const produtos = [
      { id: 1, nome: 'Arroz Tipo 1', codigo: 'A001', codigo_barras: '7891000100103', plu: '1001' },
      { id: 2, nome: 'Feijão Preto', codigo: 'F002', codigo_barras: '7892000200204', plu: '2002', codigo_fornecedor: 'FORN-88' },
      { id: 3, nome: 'Óleo Soja', codigo: 'O003', codigo_barras: '7893000300305', plu: '3003' }
    ];

    assert.strictEqual(Intel.filtrarProdutosBuscaManual(produtos, 'arroz').length, 1);
    assert.strictEqual(Intel.filtrarProdutosBuscaManual(produtos, '7892000200204')[0].id, 2);
    assert.strictEqual(Intel.filtrarProdutosBuscaManual(produtos, '1001')[0].id, 1);
    assert.strictEqual(Intel.filtrarProdutosBuscaManual(produtos, 'FORN-88')[0].id, 2);
    assert.strictEqual(Intel.filtrarProdutosBuscaManual(produtos, 'xyz-inexistente').length, 0);
  });

  test('montarComparacaoVisual: mistura de status', () => {
    const cmp = Intel.montarComparacaoVisual(
      {
        produto_nome: 'ARROZ BRANCO TIPO 1 5KG',
        codigo_barras: '7891000100103',
        marca: 'CAMIL',
        ncm: '10063021',
        cest: '',
        unidade: 'UN'
      },
      {
        nome: 'ARROZ BRANCO TIPO 1',
        codigo_barras: '7891000100103',
        marca: 'CAMIL',
        ncm: '22021000',
        cest: '1703000',
        unidade: 'UN',
        fornecedor: 'Distribuidora X'
      },
      { fornecedorXml: 'Distribuidora X', fornecedor: 'Distribuidora X' }
    );

    assert.ok(cmp.total >= 6);
    const porCampo = Object.fromEntries(cmp.linhas.map((l) => [l.campo, l]));
    assert.strictEqual(porCampo.GTIN.status, Intel.COMP_STATUS.IGUAL);
    assert.strictEqual(porCampo.NCM.status, Intel.COMP_STATUS.DIFERENTE);
    assert.ok(
      porCampo.Descrição.status === Intel.COMP_STATUS.SEMELHANTE
      || porCampo.Descrição.status === Intel.COMP_STATUS.IGUAL
    );
    assert.ok(cmp.divergencias.some((d) => d.campo === 'NCM'));
  });

  test('motoresUtilizados e enriquecerProdutoCds', () => {
    const motores = Intel.motoresUtilizados({
      motor: 'motor_gtin',
      candidatoSelecionado: { motoresQueVotaram: ['motor_similarity', 'motor_mubc'] }
    });
    assert.ok(motores.includes('motor_gtin'));
    assert.ok(motores.includes('motor_mubc'));

    const enrich = Intel.enriquecerProdutoCds(
      { id: 9, nome: 'Parcial' },
      [{ id: 9, nome: 'Completo', codigo_barras: '123', preco_venda: 10, estoque: 5 }]
    );
    assert.strictEqual(enrich.nome, 'Parcial');
    assert.strictEqual(enrich.codigoBarras, '123');
    assert.strictEqual(enrich.estoque, 5);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
}

main();
