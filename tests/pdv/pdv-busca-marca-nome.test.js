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

function carregar() {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.runInNewContext(src, sandbox);
  return sandbox.PdvBuscaProduto.nomeExibicaoProdutoPdv;
}

describe('PDV — marca na frente do nome na busca', () => {
  const nomeExibicao = carregar();

  it('prefixa a marca quando o nome ainda não começa com ela', () => {
    assert.equal(
      nomeExibicao({ nome: "BOIA P/ CAIXA D'AGUA 1/2 E 3/4", marca: 'KRONA' }),
      "KRONA BOIA P/ CAIXA D'AGUA 1/2 E 3/4"
    );
    assert.equal(
      nomeExibicao({ nome: "BOIA P/ CAIXA D'AGUA 1/2 E 3/4", marca_nome: 'VIQUA' }),
      "VIQUA BOIA P/ CAIXA D'AGUA 1/2 E 3/4"
    );
  });

  it('não duplica se o nome já começa com a marca e omite marca vazia', () => {
    assert.equal(
      nomeExibicao({ nome: 'KRONA BOIA 1/2', marca: 'KRONA' }),
      'KRONA BOIA 1/2'
    );
    assert.equal(nomeExibicao({ nome: 'BOIA 1/2', marca: '' }), 'BOIA 1/2');
    assert.equal(nomeExibicao({ nome: 'BOIA 1/2' }), 'BOIA 1/2');
  });

  it('lista do PDV pinta a marca à parte e o MIP traz o nome da marca', () => {
    assert.match(src, /pdv-autocomplete-marca/);
    const catalogo = fs.readFileSync(
      path.join(__dirname, '../../backend/motores/produto-identidade/services/ProdutoIdentidadeCatalogo.js'),
      'utf8'
    );
    assert.match(catalogo, /LEFT JOIN marcas m/);
    assert.match(catalogo, /COALESCE\(m\.nome, ''\) AS marca/);
  });
});
