/**
 * RC8.3.2 — Indicadores Fiscais por Competência
 * Executar: node tests/monitoring/rc832-indicadores-fiscais.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  resolverCompetencia,
  periodoAnoCompetencia
} = require('../../backend/monitoring/monitoringDateHelpers');
const { criarMonitoringContext } = require('../../backend/monitoring/MonitoringContext');
const { buildFiscalWidgets } = require('../../backend/monitoring/widgets/FiscalWidget');
const indicadoresFiscaisService = require('../../backend/services/IndicadoresFiscaisService');
const FiscalProvider = require('../../backend/monitoring/providers/FiscalProvider');

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

console.log('\n=== RC8.3.2 — Indicadores Fiscais ===\n');

test('IndicadoresFiscaisService existe', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/IndicadoresFiscaisService.js')));
  assert.strictEqual(typeof indicadoresFiscaisService.obterResumo, 'function');
});

test('resolverCompetencia aceita ano+mes', () => {
  const p = resolverCompetencia({ ano: 2026, mes: 7 });
  assert.strictEqual(p.competencia, '2026-07');
  assert.strictEqual(p.inicio, '2026-07-01');
  assert.strictEqual(p.fim, '2026-07-31');
  assert.strictEqual(p.label, '07/2026');
});

test('resolverCompetencia aceita competencia=YYYY-MM', () => {
  const p = resolverCompetencia({ competencia: '2025-02' });
  assert.strictEqual(p.competencia, '2025-02');
  assert.strictEqual(p.fim, '2025-02-28');
});

test('periodoAnoCompetencia retorna ano civil completo', () => {
  const ano = periodoAnoCompetencia(2026);
  assert.strictEqual(ano.inicio, '2026-01-01');
  assert.strictEqual(ano.fim, '2026-12-31');
});

test('MonitoringContext propaga competência da query', () => {
  const ctx = criarMonitoringContext({
    query: { ano: '2024', mes: '11' }
  });
  assert.strictEqual(ctx.competencia.competencia, '2024-11');
  assert.strictEqual(ctx.ano, 2024);
  assert.strictEqual(ctx.mes, 11);
});

test('FiscalWidget destaca valor da competência (mês), não hoje', () => {
  const widgets = buildFiscalWidgets({
    fiscal: {
      vendas: {
        valor: 999,
        quantidade: 9,
        hoje: { valor: 999, quantidade: 9 },
        mes: { valor: 5000, quantidade: 42 },
        ano: { valor: 12000, quantidade: 100 }
      },
      entradas: {},
      indicadoresFiscais: { competenciaLabel: '07/2026', quantidadeNfeEmitidas: 3, ambienteLabel: 'Homologação' }
    },
    naoFiscal: { vendas: {}, entradas: {} },
    indicadoresFiscais: { competenciaLabel: '07/2026', quantidadeNfeEmitidas: 3, ambienteLabel: 'Homologação' }
  });
  const vendas = widgets.find((w) => w.id === 'fiscal.vendas');
  assert.strictEqual(vendas.value, 5000);
  assert.match(vendas.subtitle, /07\/2026/);
  assert.ok(!/hoje/i.test(vendas.subtitle));

  const nfe = widgets.find((w) => w.id === 'fiscal.nfe_emitidas');
  assert.ok(nfe);
  assert.strictEqual(nfe.value, 3);
});

test('IndicadoresFiscaisService SQL usa data_emissao (não created_at)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/services/IndicadoresFiscaisService.js'), 'utf8');
  assert.match(src, /date\(data_emissao\)/);
  assert.doesNotMatch(src, /created_at.*valor_total_mes/);
});

test('IndicadoresFiscaisService SQL NF-e filtra autorizada e ambiente', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/services/IndicadoresFiscaisService.js'), 'utf8');
  assert.match(src, /autorizada/);
  assert.match(src, /COALESCE\(n\.ambiente/);
  assert.match(src, /date\(v\.data_venda\)/);
});

test('índice idx_vendas_data_venda declarado em database.js', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
  assert.match(src, /idx_vendas_data_venda/);
});

test('CentralDocumentosRepository delega valorTotalMes ao serviço fiscal', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'backend/motores/central-entradas/repositories/CentralDocumentosRepository.js'),
    'utf8'
  );
  assert.match(src, /IndicadoresFiscaisService/);
  assert.match(src, /obterIndicadoresCentral|obterValorTotalComprado/);
  assert.doesNotMatch(src, /strftime\('%Y-%m', created_at\).*valor_total_mes/s);
});

test('API monitoring/summary documentada com query competência', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/monitoring/MonitoringRouter.js'), 'utf8');
  assert.match(src, /summary/);
  const ctxSrc = fs.readFileSync(path.join(ROOT, 'backend/monitoring/MonitoringContext.js'), 'utf8');
  assert.match(ctxSrc, /query\.competencia/);
});

test('UI monitoring envia ano e mes na requisição', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/cds-monitoring-engine.js'), 'utf8');
  assert.match(src, /monitoring\/summary\?\$\{montarQueryCompetencia/);
  assert.match(src, /renderIndicadoresFiscaisCards/);
  assert.match(src, /Valor Vendido/);
  assert.match(src, /Valor Comprado/);
  assert.match(src, /NF-e Emitidas/);
});

(async () => {
  await testAsync('FiscalProvider.collect retorna indicadoresFiscais por competência', async () => {
    const ctx = criarMonitoringContext({ query: { ano: '2026', mes: '1' } });
    const result = await FiscalProvider.collect(ctx);
    assert.strictEqual(result.success, true);
    assert.ok(result.data.indicadoresFiscais);
    assert.strictEqual(result.data.indicadoresFiscais.competencia, '2026-01');
    assert.strictEqual(typeof result.data.indicadoresFiscais.valorTotalVendido, 'number');
    assert.strictEqual(typeof result.data.indicadoresFiscais.valorTotalComprado, 'number');
    assert.strictEqual(typeof result.data.indicadoresFiscais.quantidadeNfeEmitidas, 'number');
    assert.strictEqual(result.data.vendas.valor, result.data.vendas.mes.valor);
  });

  await testAsync('obterResumo retorna estrutura consolidada', async () => {
    const resumo = await indicadoresFiscaisService.obterResumo({ ano: 2020, mes: 6 });
    assert.strictEqual(resumo.competencia, '2020-06');
    assert.ok(resumo.periodo.inicio);
    assert.ok(resumo.periodo.fim);
    assert.ok([1, 2].includes(resumo.ambiente));
    assert.strictEqual(typeof resumo.valorTotalVendido, 'number');
    assert.strictEqual(typeof resumo.valorTotalComprado, 'number');
    assert.strictEqual(typeof resumo.quantidadeNfeEmitidas, 'number');
  });

  await testAsync('troca de competência altera período consultado', async () => {
    const jan = await indicadoresFiscaisService.obterResumo({ competencia: '2020-01' });
    const dez = await indicadoresFiscaisService.obterResumo({ competencia: '2020-12' });
    assert.strictEqual(jan.periodo.inicio, '2020-01-01');
    assert.strictEqual(dez.periodo.fim, '2020-12-31');
    assert.notStrictEqual(jan.competencia, dez.competencia);
  });

  console.log(`\n--- Resultado: ${ok} OK, ${falhas} falha(s) ---\n`);
  if (falhas > 0) process.exit(1);
})();
