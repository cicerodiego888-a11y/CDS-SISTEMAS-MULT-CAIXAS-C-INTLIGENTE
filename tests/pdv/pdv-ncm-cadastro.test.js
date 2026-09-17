/**
 * PDV — pedir NCM e gravar no cadastro (configurável, igual ao preço unitário).
 * node --test tests/pdv/pdv-ncm-cadastro.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

describe('PDV exigir NCM no cadastro', () => {
  it('chave, rotas e Centro de Configurações existem', () => {
    const cfg = fs.readFileSync(
      path.join(ROOT, 'backend/services/estoque/pdvExigirNcmCadastroConfig.js'),
      'utf8'
    );
    assert.match(cfg, /pdv_exigir_ncm_cadastro/);
    assert.match(cfg, /DESATIVADO/);

    const dbSrc = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
    assert.match(dbSrc, /pdv_exigir_ncm_cadastro',\s*'DESATIVADO'/);

    const rotas = fs.readFileSync(path.join(ROOT, 'backend/rotas/configuracoes.js'), 'utf8');
    assert.match(rotas, /\/pdv_exigir_ncm_cadastro/);
    assert.match(rotas, /cfgExigirNcmPdv/);

    const centro = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/cds-centro-configuracoes.js'), 'utf8');
    assert.match(centro, /cfgPdvExigirNcmCadastro/);
    assert.match(centro, /btnSalvarPdvExigirNcmCadastro/);
  });

  it('PDV pede NCM só com flag e grava PUT como o preço', () => {
    const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
    assert.match(pdv, /pdvExigirNcmCadastroAtivo/);
    assert.match(pdv, /carregarFlagExigirNcmCadastroPdv/);
    assert.match(pdv, /pdvDeveInformarNcm/);
    assert.match(pdv, /abrirModalNcmProdutoPdv/);
    assert.match(pdv, /sincronizarNcmCadastroProdutoPdv/);
    assert.match(pdv, /modalNcmProdutoPdv/);
    assert.match(pdv, /JSON\.stringify\(\{ ncm: ncmDigitos \}\)/);
    assert.match(pdv, /upsertProdutoNoCatalogoPdv/);
    const preco = pdv.indexOf('function sincronizarPrecoCadastroProdutoPdv');
    const ncm = pdv.indexOf('function sincronizarNcmCadastroProdutoPdv');
    assert.ok(preco > 0 && ncm > 0);
    assert.match(pdv, /method: 'PUT'/);
    assert.match(pdv, /produtos\/\$\{produtoId\}/);
    assert.match(pdv, /hintNcmProdutoPdv/);
    assert.match(pdv, /slice\(0, 8\)/);
    assert.doesNotMatch(pdv, /inputNcmProdutoPdv[^\n]*maxlength="6"/);
    assert.match(pdv, /getElementById\('modalNcmProdutoPdv'\)/);
    assert.match(pdv, /btnCopiarNomeNcmPdv/);
    assert.match(pdv, /copiarTextoSimplesPdv/);
  });
});
