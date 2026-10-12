'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(
  path.join(__dirname, '../../frontend/shared/js/pdvBuscaProduto.js'),
  'utf8'
);
const srcBuscaTexto = fs.readFileSync(
  path.join(__dirname, '../../frontend/shared/js/buscaProdutoTexto.js'),
  'utf8'
);

function carregar() {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.runInNewContext(srcBuscaTexto, sandbox);
  vm.runInNewContext(src, sandbox);
  return sandbox.PdvBuscaProduto.nomeExibicaoProdutoPdv;
}

describe('PDV — nome da busca no formato NOME — MARCA', () => {
  const nomeExibicao = carregar();

  it('acrescenta a marca depois do nome quando o nome não a contém', () => {
    assert.equal(
      nomeExibicao({ nome: "BOIA P/ CAIXA D'AGUA 1/2 E 3/4", marca: 'KRONA' }),
      "BOIA P/ CAIXA D'AGUA 1/2 E 3/4 — KRONA"
    );
    assert.equal(
      nomeExibicao({ nome: "BOIA P/ CAIXA D'AGUA 1/2 E 3/4", marca_nome: 'VIQUA' }),
      "BOIA P/ CAIXA D'AGUA 1/2 E 3/4 — VIQUA"
    );
  });

  it('não duplica se o nome já contém a marca e omite marca vazia', () => {
    assert.equal(
      nomeExibicao({ nome: 'KRONA BOIA 1/2', marca: 'KRONA' }),
      'KRONA BOIA 1/2'
    );
    assert.equal(nomeExibicao({ nome: 'BOIA 1/2', marca: '' }), 'BOIA 1/2');
    assert.equal(nomeExibicao({ nome: 'BOIA 1/2' }), 'BOIA 1/2');
  });

  it('lista do PDV não pinta mais a marca à parte e o MIP traz o nome da marca', () => {
    assert.doesNotMatch(src, /pdv-autocomplete-marca/);
    const catalogo = fs.readFileSync(
      path.join(__dirname, '../../backend/motores/produto-identidade/services/ProdutoIdentidadeCatalogo.js'),
      'utf8'
    );
    assert.match(catalogo, /LEFT JOIN marcas m/);
    assert.match(catalogo, /COALESCE\(m\.nome, ''\) AS marca/);
  });
});
