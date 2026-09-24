'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');

const ui = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/nfe-central.js'), 'utf8');

describe('Central NF-e — CC-e no menu Mais', () => {
  it('expõe Carta de Correção e Histórico CC-e no menu compacto', () => {
    assert.match(ui, /nfePodeCartaCorrecao/);
    assert.match(ui, /nfePodeHistoricoCce/);
    assert.match(ui, /Carta de Correção/);
    assert.match(ui, /Histórico CC-e/);
    assert.match(ui, /abrirModalCartaCorrecaoNfe/);
    assert.match(ui, /abrirHistoricoCartaCorrecaoNfe/);
  });

  it('CORREÇÃO é o primeiro grupo do menu', () => {
    const fnStart = ui.indexOf('function renderAcoesCompactasNfe');
    const slice = ui.slice(fnStart, fnStart + 4500);
    const idxCorr = slice.indexOf("header: 'CORREÇÃO'");
    const idxDoc = slice.indexOf("header: 'DOCUMENTO'");
    assert.ok(idxCorr > 0);
    assert.ok(idxDoc > idxCorr, 'CORREÇÃO deve aparecer antes de DOCUMENTO');
  });

  it('bloqueia CC-e fora de autorizada (regras no fonte)', () => {
    assert.match(ui, /nfePodeCartaCorrecao/);
    assert.match(ui, /cancelada/);
    assert.match(ui, /rejeit/);
    assert.match(ui, /pendente/);
  });
});
