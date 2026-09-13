/**
 * RC8.3.3 — Filtros e KPIs da Central de Inteligência (data_emissao)
 * Executar: node tests/central-entradas/rc833-filtros-indicadores.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

const {
  resolverPeriodosIndicadores,
  intersectarPeriodos,
  obterIndicadoresCentral,
  STATUS_EXCLUIDOS_CONTAGEM,
  STATUS_NFE_EXCLUIDOS
} = require('../../backend/services/IndicadoresFiscaisService');
const { obterPreset, PRESETS } = require('../../backend/motores/central-entradas/utils/filtrosRapidosCentral');

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

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('\n=== RC8.3.3 — Filtros e KPIs Central ===\n');

test('IndicadoresFiscaisService exporta obterIndicadoresCentral', () => {
  assert.strictEqual(typeof obterIndicadoresCentral, 'function');
  assert.strictEqual(typeof resolverPeriodosIndicadores, 'function');
});

test('intersectarPeriodos respeita interseção', () => {
  const r = intersectarPeriodos(
    { inicio: '2026-07-01', fim: '2026-07-31' },
    { inicio: '2026-07-10', fim: '2026-07-15' }
  );
  assert.strictEqual(r.inicio, '2026-07-10');
  assert.strictEqual(r.fim, '2026-07-15');
  assert.strictEqual(r.vazio, false);
});

test('intersectarPeriodos marca vazio quando sem overlap', () => {
  const r = intersectarPeriodos(
    { inicio: '2026-07-01', fim: '2026-07-31' },
    { inicio: '2026-08-01', fim: '2026-08-15' }
  );
  assert.strictEqual(r.vazio, true);
});

test('filtro de período deriva competência e intersecta mês/ano', () => {
  const r = resolverPeriodosIndicadores({
    dataEmissaoInicio: '2026-07-01',
    dataEmissaoFim: '2026-07-15'
  });
  assert.strictEqual(r.competencia.competencia, '2026-07');
  assert.strictEqual(r.periodoMensal.inicio, '2026-07-01');
  assert.strictEqual(r.periodoMensal.fim, '2026-07-15');
  assert.strictEqual(r.periodoAnual.inicio, '2026-07-01');
  assert.strictEqual(r.periodoAnual.fim, '2026-07-15');
});

test('presets rápidos usam data_emissao (não created_at)', () => {
  ['hoje', 'ontem', 'ultimos_7_dias', 'ultimos_30_dias', 'este_mes'].forEach((codigo) => {
    const p = obterPreset(codigo);
    assert.ok(p?.sql, codigo);
    assert.match(p.sql, /data_emissao/);
    assert.doesNotMatch(p.sql, /created_at/);
  });
  assert.ok(PRESETS.pendentes.statusIn.length > 0);
});

test('repository filtra listagem por date(data_emissao)', () => {
  const src = ler('backend/motores/central-entradas/repositories/CentralDocumentosRepository.js');
  assert.match(src, /date\(data_emissao\) >= date\(\?\)/);
  assert.match(src, /date\(data_emissao\) <= date\(\?\)/);
  assert.match(src, /obterIndicadoresCentral/);
});

test('estatísticas do dia usam data_emissao', () => {
  const src = ler('backend/motores/central-entradas/repositories/CentralDocumentosRepository.js');
  assert.match(src, /date\(data_emissao\) = date\('now'/);
  assert.doesNotMatch(src, /date\(created_at\) = date\('now', 'localtime'\) THEN valor_total/);
});

test('rota indicadores-fiscais e camelCase no filtro de datas', () => {
  const src = ler('backend/rotas/central-entradas.js');
  assert.match(src, /\/indicadores-fiscais/);
  assert.match(src, /obterIndicadoresCentral/);
  assert.match(src, /query\.dataEmissaoInicio/);
  assert.match(src, /query\.data_emissao_inicio/);
});

test('serviço SQL entradas usa data_emissao e exclui status inválidos', () => {
  const src = ler('backend/services/IndicadoresFiscaisService.js');
  assert.match(src, /date\(data_emissao\) BETWEEN date\(\?\) AND date\(\?\)/);
  assert.match(src, /valorMensal/);
  assert.match(src, /quantidadeAnual/);
  assert.ok(STATUS_EXCLUIDOS_CONTAGEM.includes('DESCARTADA'));
  assert.ok(STATUS_EXCLUIDOS_CONTAGEM.includes('DUPLICADA'));
  assert.ok(STATUS_NFE_EXCLUIDOS.includes('cancelada'));
  assert.ok(STATUS_NFE_EXCLUIDOS.includes('denegada'));
  assert.ok(STATUS_NFE_EXCLUIDOS.includes('inutilizada'));
  assert.doesNotMatch(src, /FROM central_entradas_documentos[\s\S]*created_at/);
});

test('UI possui cards fiscais e reload por período', () => {
  const src = ler('frontend/erp/js/central-entradas.js');
  assert.match(src, /centralIndicadoresFiscais/);
  assert.match(src, /Valor do Mês/);
  assert.match(src, /Valor do Ano/);
  assert.match(src, /NF-e do Mês/);
  assert.match(src, /NF-e do Ano/);
  assert.match(src, /data_emissao_inicio/);
  assert.match(src, /carregarIndicadoresFiscaisCentral/);
  assert.match(src, /ordenarPor: 'data_emissao'/);
});

(async () => {
  await testAsync('obterIndicadoresCentral retorna contrato oficial', async () => {
    const ind = await obterIndicadoresCentral({
      dataEmissaoInicio: '2099-01-01',
      dataEmissaoFim: '2099-01-31'
    });
    assert.strictEqual(typeof ind.valorMensal, 'number');
    assert.strictEqual(typeof ind.valorAnual, 'number');
    assert.strictEqual(typeof ind.quantidadeMensal, 'number');
    assert.strictEqual(typeof ind.quantidadeAnual, 'number');
    assert.strictEqual(ind.baseCalculo, 'data_emissao');
    assert.ok([1, 2].includes(ind.ambiente));
    assert.ok(ind.ambienteLabel === 'Produção' || ind.ambienteLabel === 'Homologação');
    assert.strictEqual(ind.valorMensal, 0);
    assert.strictEqual(ind.quantidadeMensal, 0);
  });

  await testAsync('competência mensal sem filtro retorna períodos completos', async () => {
    const ind = await obterIndicadoresCentral({ ano: 2026, mes: 7 });
    assert.strictEqual(ind.competencia, '2026-07');
    assert.strictEqual(ind.periodoMensal.inicio, '2026-07-01');
    assert.strictEqual(ind.periodoMensal.fim, '2026-07-31');
    assert.strictEqual(ind.periodoAnual.inicio, '2026-01-01');
    assert.strictEqual(ind.periodoAnual.fim, '2026-12-31');
  });

  console.log(`\nResultado: ${ok} ok, ${falhas} falhas\n`);
  process.exit(falhas > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

