/**
 * GET de DANFE/XML em nova janela precisa autenticar sem header Authorization.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { extrairToken } = require('../../backend/middleware/auth');

describe('DANFE — autenticação GET', () => {
  it('aceita token na query em GET (impressão/download em nova janela)', () => {
    assert.equal(extrairToken({
      method: 'GET',
      headers: {},
      query: { token: 'abc.jwt.token' }
    }), 'abc.jwt.token');
    assert.equal(extrairToken({
      method: 'POST',
      headers: {},
      query: { token: 'abc.jwt.token' }
    }), null);
    assert.equal(extrairToken({
      method: 'GET',
      headers: { authorization: 'Bearer header-token' },
      query: { token: 'query-token' }
    }), 'header-token');
  });

  it('tela de conclusão não abre DANFE sem autenticação', () => {
    const ui = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/nfe-devolucao-compra.js'),
      'utf8'
    );
    assert.doesNotMatch(ui, /href="\$\{API_URL\}\/compras\/nfe-devolucao\/\$\{notaId\}\/danfe"/);
    assert.match(ui, /id="btnNdcDanfe"/);
    assert.match(ui, /abrirDanfe/);
  });
});
