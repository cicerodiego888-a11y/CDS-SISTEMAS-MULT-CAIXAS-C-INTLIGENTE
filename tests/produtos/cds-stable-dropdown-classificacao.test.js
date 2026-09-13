/**
 * Sprint UX — dropdown estável de Categoria / Subcategoria.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const ddSrc = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/cds-stable-dropdown.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(ROOT, 'frontend/css/cds-stable-dropdown.css'), 'utf8');
const produtosSrc = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produtos.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/app.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(ROOT, 'frontend/erp/index.html'), 'utf8');

const CdsStableDropdown = require('../../frontend/shared/js/cds-stable-dropdown.js');

describe('CDS Stable Dropdown — contrato', () => {
  it('não fecha por mouseleave, mouseout, blur ou setTimeout', () => {
    assert.doesNotMatch(ddSrc, /addEventListener\(\s*['"]mouseleave/);
    assert.doesNotMatch(ddSrc, /addEventListener\(\s*['"]mouseout/);
    assert.doesNotMatch(ddSrc, /addEventListener\(\s*['"]blur/);
    assert.doesNotMatch(ddSrc, /setTimeout\s*\(/);
  });

  it('fecha só por seleção, ESC, clique fora e outro dropdown', () => {
    assert.equal(CdsStableDropdown.CLOSE.SELECT, 'select');
    assert.equal(CdsStableDropdown.CLOSE.ESCAPE, 'escape');
    assert.equal(CdsStableDropdown.CLOSE.OUTSIDE, 'outside');
    assert.equal(CdsStableDropdown.CLOSE.OTHER, 'other-open');
  });

  it('lê opções e rótulo a partir do select interno', () => {
    const select = {
      options: [
        { value: '', textContent: 'Selecione' },
        { value: '10', textContent: 'Açougue' },
        { value: '20', textContent: 'Bebidas' }
      ]
    };
    const opts = CdsStableDropdown.readOptions(select);
    assert.equal(opts.length, 3);
    assert.equal(CdsStableDropdown.labelForValue(opts, '20'), 'Bebidas');
    assert.equal(CdsStableDropdown.labelForValue(opts, ''), 'Selecione');
  });
});

describe('Cadastro de produtos — integração classificação', () => {
  it('preserva funções e IDs de persistência', () => {
    assert.match(produtosSrc, /function selectClassificacaoEmUso/);
    assert.match(produtosSrc, /renderClassificacaoPendente/);
    assert.match(produtosSrc, /function inicializarCategoriasESubcategorias/);
    assert.match(produtosSrc, /categoria_id:\s*\$\('#categoria_id'\)\.val\(\)/);
    assert.match(produtosSrc, /subcategoria_id:\s*\$\('#subcategoria_id'\)\.val\(\)/);
    assert.match(produtosSrc, /btnCriarCategoriaRapida/);
    assert.match(produtosSrc, /btnCriarSubcategoriaRapida/);
  });

  it('não usa mais blur para reconstruir o select nativo', () => {
    assert.doesNotMatch(produtosSrc, /blur\.cadastroCatSync/);
    assert.match(produtosSrc, /CdsStableDropdown\.mount/);
    assert.match(produtosSrc, /ensureClassificacaoDropdowns/);
  });

  it('carrega o componente no ERP sem dependência externa', () => {
    assert.match(indexSrc, /cds-stable-dropdown\.css/);
    assert.match(indexSrc, /cds-stable-dropdown\.js/);
    assert.match(appSrc, /cds-stable-dropdown\.js/);
    assert.match(cssSrc, /cds-stable-dd__list/);
  });

  it('ao mudar categoria ainda recarrega subcategorias via change.cadastroCat', () => {
    assert.match(produtosSrc, /change\.cadastroCat/);
    assert.match(produtosSrc, /function carregarSubs/);
  });
});
