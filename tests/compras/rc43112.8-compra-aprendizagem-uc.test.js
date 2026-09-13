/**
 * RC4.31.12.8 — Aprendizagem automática da Unidade Comercial na compra
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { obterMuc } = require('../../backend/motores/muc');

const ROOT = path.join(__dirname, '../..');

function carregarResolver() {
    global.formatQuantidadeExibicao = function formatQuantidadeExibicao(value, maxDecimals = 3) {
        const num = Number(value || 0);
        if (!Number.isFinite(num)) return '0';
        const fixed = num.toFixed(maxDecimals);
        if (!fixed.includes('.')) return fixed;
        return fixed.replace(/0+$/, '').replace(/\.$/, '');
    };
    const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produto-apresentacao-resolver.js'), 'utf8');
    const fn = new Function(`${src}; return ProdutoApresentacaoResolver;`);
    return fn();
}

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

console.log('\n=== RC4.31.12.8 — Aprendizagem UC na compra ===\n');

test('resolver expõe montarOpcoesComprarEm e helpers RC4.31.12.8', () => {
    const R = carregarResolver();
    assert.strictEqual(typeof R.montarOpcoesComprarEm, 'function');
    assert.strictEqual(typeof R.montarEmbalagemAprendidaCompra, 'function');
    assert.strictEqual(typeof R.montarUnidadeComercialTemporariaCompra, 'function');
    assert.strictEqual(R.OPCAO_NOVA_UC_ID, '__nova_uc__');
});

test('montarOpcoesComprarEm — sempre inclui Unidade e Nova UC', () => {
    const R = carregarResolver();
    const produto = { id: 99, unidade: 'mt', compra_por_embalagem: 1, embalagens: [] };
    const opcoes = R.montarOpcoesComprarEm(produto, R.listarEmbalagensCompra(produto));
    assert.ok(opcoes.length >= 2);
    assert.strictEqual(R.formatarRotuloOpcaoCompra(opcoes[0]), 'Unidade');
    assert.strictEqual(R.ehOpcaoNovaUnidadeComercial(opcoes[opcoes.length - 1]), true);
    assert.match(R.formatarRotuloOpcaoCompra(opcoes[opcoes.length - 1]), /Nova Unidade Comercial/);
});

test('montarEmbalagemAprendidaCompra — payload para cadastro permanente', () => {
    const R = carregarResolver();
    const produto = { id: 1, unidade: 'mt', embalagens: [] };
    const payload = R.montarEmbalagemAprendidaCompra({
        descricao: 'Vara',
        quantidade: 6,
        unidade: 'mt'
    }, produto);
    assert.strictEqual(payload.descricao, 'Vara');
    assert.strictEqual(payload.quantidade, 6);
    assert.strictEqual(payload.compra, 1);
    assert.strictEqual(payload.principal, 1);
    assert.strictEqual(payload.origem, 'COMPRA_APRENDIZAGEM');
});

test('montarUnidadeComercialTemporariaCompra — somente compra', () => {
    const R = carregarResolver();
    const produto = { id: 2, unidade: 'mt', embalagens: [{ id: 1, principal: 1 }] };
    const temp = R.montarUnidadeComercialTemporariaCompra({
        descricao: 'Barra',
        quantidade: 12,
        unidade: 'mt'
    }, produto);
    assert.match(String(temp.id), /^temp-uc-/);
    assert.strictEqual(temp.somente_compra, true);
    assert.strictEqual(temp.origem, 'COMPRA_TEMPORARIA');
    assert.strictEqual(R.formatarRotuloOpcaoCompra(temp), 'Barra (12 MT)');
});

test('MUC continua responsável pela conversão após aprendizagem', () => {
    const muc = obterMuc(null);
    const sim = muc.simular({ quantidadeCompra: 2, quantidadePorApresentacao: 6, valorTotal: 24 });
    assert.strictEqual(sim.quantidadeEstoque, 12);
});

test('compras.js — modal e fluxo RC4.31.12.8', () => {
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
    assert.match(ui, /abrirModalNovaUnidadeComercialCompra/);
    assert.match(ui, /confirmarNovaUnidadeComercialCompra/);
    assert.match(ui, /persistirUnidadeComercialNoCadastroProduto/);
    assert.match(ui, /Salvar no cadastro do produto/);
    assert.match(ui, /Apenas nesta compra|Apenas para esta compra/);
    assert.match(ui, /montarOpcoesComprarEm/);
    assert.match(ui, /unidadesComerciaisTemporariasCompra/);
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
