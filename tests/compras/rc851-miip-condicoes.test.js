/**
 * RC8.5.1 — Cadastro inteligente MIIP + condições de pagamento
 * Executar: node tests/compras/rc851-miip-condicoes.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const Motor = require('../../backend/services/compras/MotorParcelamentoCompra');
const { extrairTributosItemNfe } = require('../../backend/shared/nfe/mappers/extrairTributosItemNfe');
const NfeItemParseadoDTO = require('../../backend/shared/nfe/contracts/NfeItemParseadoDTO');
const { SEED_CONDICOES, parsearDias, serializarDias } = require('../../backend/services/compras/CondicoesPagamentoService');

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

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('\n=== RC8.5.1 — MIIP + Condições ===\n');

test('DTO item exporta cest/cfop/csosn/uTrib', () => {
  const json = NfeItemParseadoDTO.create({
    produto_nome: 'X',
    cest: '123',
    cfop: '5102',
    csosn: '102',
    unidade_tributavel: 'UN',
    cst_pis: '01'
  }).toJSON();
  assert.strictEqual(json.cest, '123');
  assert.strictEqual(json.cfop, '5102');
  assert.strictEqual(json.csosn, '102');
  assert.strictEqual(json.uTrib, 'UN');
  assert.strictEqual(json.cst_pis, '01');
});

test('extrai CSOSN do nó ICMS', () => {
  const t = extrairTributosItemNfe({
    ICMS: { ICMSSN102: { CSOSN: '102', orig: '0' } },
    PIS: { PISNT: { CST: '07' } },
    COFINS: { COFINSNT: { CST: '07' } }
  });
  assert.strictEqual(t.csosn, '102');
  assert.strictEqual(t.origem, 0);
  assert.strictEqual(t.cst_pis, '07');
  assert.strictEqual(t.cst_cofins, '07');
});

test('grade modelo 30/60/90 a partir de 2026-07-28', () => {
  const g = Motor.gerarGradePorModelo({
    valorTotal: 900,
    dataBase: '2026-07-28',
    diasParcelas: [30, 60, 90]
  });
  assert.strictEqual(g.parcelas.length, 3);
  assert.strictEqual(g.parcelas[0].vencimento, '2026-08-27');
  assert.strictEqual(g.parcelas[1].vencimento, '2026-09-26');
  assert.strictEqual(g.parcelas[2].vencimento, '2026-10-26');
  assert.strictEqual(g.soma, 900);
});

test('parsear nome Entrada + 30/60', () => {
  const p = Motor.parsearDiasDoNomeCondicao('Entrada + 30/60');
  assert.strictEqual(p.temEntrada, true);
  assert.deepStrictEqual(p.dias, [30, 60]);
});

test('seed condições contém 30/60/90', () => {
  assert.ok(SEED_CONDICOES.some((c) => c.nome === '30/60/90'));
  assert.ok(SEED_CONDICOES.some((c) => c.nome === 'À Vista'));
});

test('serializar/parsear dias', () => {
  const s = serializarDias([30, 60, 90]);
  assert.deepStrictEqual(parsearDias(s), [30, 60, 90]);
});

test('MIIP prefill tem pergunta embalagem e campos fiscais', () => {
  const src = ler('frontend/erp/js/miip-central-revisao.js');
  assert.match(src, /perguntarCompraPorEmbalagemMiip/);
  assert.match(src, /aplicarModoEmbalagemCadastroProduto/);
  assert.match(src, /csosn/);
  assert.match(src, /descricao_complementar/);
  assert.match(src, /Produto adquirido por embalagem/);
  assert.match(src, /aplicarCfopPadraoEmpresaNoCadastro/);
  assert.match(src, /Padrão fiscal da empresa/);
  assert.doesNotMatch(src, /setCampoTexto\('#cfop', xml\.cfop\)/);
});

test('UI financeiro condições + compras (cadastro permanece no Financeiro)', () => {
  assert.match(ler('frontend/erp/js/financeiro-condicoes.js'), /renderCondicoesPagamento/);
  assert.match(ler('frontend/erp/pages/financeiro.html'), /data-aba="condicoes"/);
  // RC8.5.2 — condição digitada removida da tela de compras
  assert.doesNotMatch(ler('frontend/erp/js/compras.js'), /condicao_pagamento_texto/);
  assert.doesNotMatch(ler('frontend/erp/js/compras.js'), /aplicarCondicaoDigitadaCompra/);
});

test('API e schema condições', () => {
  assert.match(ler('backend/rotas/condicoes-pagamento.js'), /condicoes_pagamento|listarCondicoes/);
  assert.match(ler('backend/server.js'), /condicoes-pagamento/);
  assert.match(ler('backend/database.js'), /CondicoesPagamentoService/);
  assert.match(ler('backend/shared/nfe/mappers/nfeXmlMapper.js'), /extrairTributosItemNfe/);
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
