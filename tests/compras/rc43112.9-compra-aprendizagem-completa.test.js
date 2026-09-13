/**
 * RC4.31.12.9 — Aprendizagem completa UC + flags Compra/Venda
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { obterMuc } = require('../../backend/motores/muc');

const ROOT = path.join(__dirname, '../..');

function carregarResolver() {
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

console.log('\n=== RC4.31.12.9 — Aprendizagem completa UC ===\n');

test('montarEmbalagemAprendidaCompra — apenas compra', () => {
    const R = carregarResolver();
    const payload = R.montarEmbalagemAprendidaCompra({
        descricao: 'Vara',
        quantidade: 6,
        unidade: 'mt',
        compra: 1,
        venda: 0
    }, { id: 1, unidade: 'mt', embalagens: [] });
    assert.strictEqual(payload.compra, 1);
    assert.strictEqual(payload.venda, 0);
    assert.strictEqual(payload.origem, 'COMPRA_APRENDIZAGEM');
});

test('montarEmbalagemAprendidaCompra — compra e venda', () => {
    const R = carregarResolver();
    const payload = R.montarEmbalagemAprendidaCompra({
        descricao: 'Caixa',
        quantidade: 12,
        compra: 1,
        venda: 1
    }, { id: 2, unidade: 'un', embalagens: [{ id: 1, principal: 1 }] });
    assert.strictEqual(payload.compra, 1);
    assert.strictEqual(payload.venda, 1);
    assert.strictEqual(payload.principal, 0);
});

test('validarUtilizacaoAprendizagemCompra — exige ao menos um módulo', () => {
    const R = carregarResolver();
    const invalido = R.validarUtilizacaoAprendizagemCompra({ compra: 0, venda: 0 });
    assert.strictEqual(invalido.ok, false);
    const valido = R.validarUtilizacaoAprendizagemCompra({ compra: 0, venda: 1 });
    assert.strictEqual(valido.ok, true);
    assert.strictEqual(valido.venda, 1);
});

test('listarEmbalagensVenda — UC habilitada para venda', () => {
    const R = carregarResolver();
    const produto = {
        id: 3,
        compra_por_embalagem: 1,
        unidade: 'mt',
        embalagens: [
            { id: 10, tipo: 'ROLO', descricao: 'Vara', quantidade: 6, compra: 1, venda: 1, ativa: 1, principal: 1 },
            { id: 11, tipo: 'ROLO', descricao: 'Só Compra', quantidade: 3, compra: 1, venda: 0, ativa: 1 }
        ]
    };
    const vendas = R.listarEmbalagensVenda(produto);
    assert.strictEqual(vendas.length, 1);
    assert.strictEqual(vendas[0].descricao, 'Vara');
});

test('MUC — conversão após aprendizagem com flags', () => {
    const muc = obterMuc(null);
    const sim = muc.simular({ quantidadeCompra: 3, quantidadePorApresentacao: 6, valorTotal: 36 });
    assert.strictEqual(sim.quantidadeEstoque, 18);
});

test('backend — endpoint e auditoria RC4.31.12.9', () => {
    const rotas = fs.readFileSync(path.join(ROOT, 'backend/rotas/produtos.js'), 'utf8');
    const svc = fs.readFileSync(path.join(ROOT, 'backend/services/produto-embalagem/ProdutoEmbalagemService.js'), 'utf8');
    assert.match(rotas, /embalagens\/aprendizagem-compra/);
    assert.match(rotas, /aprendizagem_unidade_comercial/);
    assert.match(svc, /adicionarApresentacaoAprendizagemCompra/);
    assert.match(svc, /APRENDIZAGEM_COMPRA/);
});

test('listarOpcoesCompraProduto — fracionado sem compra_por_embalagem', () => {
    const R = carregarResolver();
    const produto = {
        id: 5,
        compra_por_embalagem: 0,
        produto_fracionado: 1,
        unidade: 'mt',
        embalagens: [
            { id: 20, tipo: 'ROLO', descricao: 'Vara', quantidade: 6, compra: 1, venda: 1, ativa: 1, principal: 1 }
        ]
    };
    const opcoes = R.listarOpcoesCompraProduto(produto);
    assert.ok(opcoes.length >= 1);
    const montadas = R.montarOpcoesComprarEm(produto, opcoes);
    assert.match(R.formatarRotuloOpcaoCompra(montadas[0]), /Unidade/);
    assert.match(R.formatarRotuloOpcaoCompra(montadas[montadas.length - 1]), /Nova Unidade Comercial/);
});

test('compras.js — painel unificado Comprar em para fracionado', () => {
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
    assert.match(ui, /nova_uc_utilizar_compra/);
    assert.match(ui, /nova_uc_utilizar_venda/);
    assert.match(ui, /Utilizar em/);
    assert.match(ui, /Apenas nesta compra/);
    assert.match(ui, /sincronizarCacheProdutoAposAprendizagem/);
    assert.match(ui, /aprendizagem-compra/);
    assert.match(ui, /aprenderUnidadeComercialAutomaticaNoProduto/);
    assert.match(ui, /listarOpcoesCompraProduto/);
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
