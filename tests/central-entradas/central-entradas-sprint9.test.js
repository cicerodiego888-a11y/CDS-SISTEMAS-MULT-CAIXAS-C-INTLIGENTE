/**
 * Testes — Central de Entradas Sprint 9 (UX Enterprise helpers)
 * Executar: npm run test:central-entradas-sprint9
 */

const assert = require('assert');
const UX = require('../../frontend/erp/js/central-entradas-ux');

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

async function main() {
    console.log('\n=== Testes Central de Entradas — Sprint 9 (UX) ===\n');

    await test('calcularTendenciaKpiCentral identifica alta, baixa e estável', async () => {
        assert.strictEqual(UX.calcularTendenciaKpiCentral(5, 3).direcao, 'alta');
        assert.strictEqual(UX.calcularTendenciaKpiCentral(2, 5).direcao, 'baixa');
        assert.strictEqual(UX.calcularTendenciaKpiCentral(4, 4).direcao, 'estavel');
        assert.strictEqual(UX.calcularTendenciaKpiCentral('x', 1).direcao, 'neutro');
    });

    await test('corScoreCentral e descricaoScoreCentral por faixa', async () => {
        assert.strictEqual(UX.corScoreCentral(85), '#198754');
        assert.strictEqual(UX.corScoreCentral(30), '#dc3545');
        assert.ok(UX.descricaoScoreCentral(85).includes('Excelente'));
    });

    await test('renderGaugeScoreCentral inclui percentual e aria-label', async () => {
        const html = UX.renderGaugeScoreCentral(72, '#0d6efd');
        assert.ok(html.includes('72%'));
        assert.ok(html.includes('aria-label'));
    });

    await test('renderEmptyStateCentral gera estrutura acessível', async () => {
        const html = UX.renderEmptyStateCentral('alertas');
        assert.ok(html.includes('role="status"'));
        assert.ok(html.includes('Sem alertas ativos'));
    });

    await test('resolverEstadoServicoCentral prioriza offline e sincronizando', async () => {
        const original = global.navigator;
        global.navigator = { onLine: false };
        assert.strictEqual(UX.resolverEstadoServicoCentral({}).codigo, 'offline');
        global.navigator = { onLine: true };

        const sync = UX.resolverEstadoServicoCentral({ sincronizando: true });
        assert.strictEqual(sync.codigo, 'sincronizando');

        global.navigator = original;
    });

    await test('extrairDadosExecutivoCentral agrega itens e precisão MIIP', async () => {
        const doc = { fornecedor: 'ACME', valorTotal: 100 };
        const parse = {
            parse: {
                itens: [{ quantidade: 2 }, { quantidade: 3 }],
                valor_frete: 15
            },
            miipResumo: { resumo: { totalItens: 2, identificadosAutomaticamente: 1 } }
        };
        const dados = UX.extrairDadosExecutivoCentral(doc, parse, parse, []);
        assert.strictEqual(dados.qtdItens, 2);
        assert.strictEqual(dados.precisaoMiip, '50%');
        assert.ok(dados.transportadora.includes('Frete'));
    });

    await test('formatarDataHoraSeparadoCentral separa data e hora', async () => {
        const r = UX.formatarDataHoraSeparadoCentral('2026-06-01T10:30:00-03:00');
        assert.ok(r.data);
        assert.ok(r.hora);
    });

    console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
    if (falhou > 0) process.exit(1);
}

main();
