'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ui = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/nfe-central.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../frontend/css/nfe-central.css'), 'utf8');

assert.match(ui, /function renderAcoesCompactasNfe/);
assert.match(ui, /nfe-acao-lbl">Visualizar/);
assert.match(ui, /nfe-acao-lbl">Imprimir/);
assert.match(ui, /nfe-acao-lbl">Mais/);
assert.match(ui, /DOCUMENTO/);
assert.match(ui, /SEFAZ/);
assert.match(ui, /CORREÇÃO/);
assert.match(ui, /EVENTOS/);
assert.match(ui, /CANCELAMENTO/);
assert.match(ui, /nfe-mais-item-danger/);

for (const fn of [
  'visualizarFichaNfe',
  'visualizarDanfeNfe',
  'reimprimirDanfeNfe',
  'downloadDanfeNfe',
  'downloadXmlNfe',
  'visualizarXmlNfe',
  'consultarSituacaoNfe',
  'reenviarNfeOperacional',
  'abrirModalCartaCorrecaoNfe',
  'abrirHistoricoCartaCorrecaoNfe',
  'cancelarNfeNota',
  'duplicarNfeComoNovaDevolucao',
  'registrarManifestacao210240Nfe',
  'selecionarNfeNota'
]) {
  assert.match(ui, new RegExp(fn));
}

// Coluna não deve mais espalhar 10+ botões coloridos inline
assert.doesNotMatch(ui, /btn-outline-warning[\s\S]{0,80}Carta de Correção/);
assert.match(css, /nfe-acoes-compactas/);
assert.match(css, /nfe-mais-item-danger/);

console.log('OK — ações compactas V1');
