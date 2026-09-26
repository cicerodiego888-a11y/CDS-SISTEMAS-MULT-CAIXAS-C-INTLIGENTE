/**
 * Código interno de produto — no máximo 5 dígitos.
 * node --test tests/produtos/codigo-interno-cinco-digitos.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const { _proximoCodigoInternoCincoDigitos: proximo } = require('../../backend/rotas/produtos');

describe('código interno até 5 dígitos', () => {
  it('segue o maior código curto e ignora EAN', () => {
    assert.equal(proximo(['1', '39', '7891234567890']), '40');
    assert.equal(proximo([]), '1');
    assert.equal(proximo(['00012', '7']), '13');
  });

  it('não passa de 5 dígitos e reaproveita lacuna no limite', () => {
    assert.equal(proximo(['99998']), '99999');
    assert.equal(proximo(['99999', '1']), '2');
    assert.equal(String(proximo(['10'])).length <= 5, true);
  });

  it('cadastro tem o botão Gerar e o campo limita a 5 dígitos', () => {
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produtos.js'), 'utf8');
    assert.match(ui, /id="btnGerarCodigoInterno"/);
    assert.match(ui, /maxlength="5"/);
    assert.match(ui, /proximo-codigo/);
    assert.match(ui, /codigoInternoAvulso/);
  });
});
