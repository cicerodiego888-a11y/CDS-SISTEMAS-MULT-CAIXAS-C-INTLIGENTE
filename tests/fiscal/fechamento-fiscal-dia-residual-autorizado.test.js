/**
 * Regressão: após FF AUTORIZADO, residual do dia deve consumir a própria prévia
 * (não excluir o fechamento finalizado do cálculo).
 * node --test tests/fiscal/fechamento-fiscal-dia-residual-autorizado.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const FRONT = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
const ROTA = fs.readFileSync(path.join(ROOT, 'backend/rotas/fechamento-fiscal.js'), 'utf8');

describe('FFD — residual após AUTORIZADO não ressuscita elegíveis', () => {
  it('frontend só envia fechamento_id ao resumo quando editável', () => {
    assert.match(FRONT, /function ffdFechamentoFinalizado/);
    assert.match(FRONT, /function ffdDeveExcluirFechamentoDoResumo/);
    assert.match(FRONT, /ffdDeveExcluirFechamentoDoResumo\(__ffdEstado\.statusFiscal\)/);
    assert.match(FRONT, /Fechamento autorizado \/ concluído/);
    assert.match(FRONT, /Fechamento Fiscal do Dia autorizado/);
    assert.match(FRONT, /await ffdCarregarDia\(\{ silencioso: true \}\)/);
    assert.match(FRONT, /function ffdLimparUiAposAutorizado/);
    assert.match(FRONT, /ffdSecaoRecebimentos, #ffdSecaoComposicao/);
    assert.match(FRONT, /limpos automaticamente/);
  });

  it('backend ignora excluirFechamentoId quando status finalizado', () => {
    assert.match(ROTA, /STATUS\.AUTORIZADO/);
    assert.match(ROTA, /finalizado/);
    assert.match(ROTA, /excluirFechamentoId/);
  });
});
