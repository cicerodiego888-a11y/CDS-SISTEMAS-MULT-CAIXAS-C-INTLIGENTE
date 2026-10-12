'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const compras = require('../../backend/rotas/compras');

const SRC = fs.readFileSync(path.join(__dirname, '../../backend/rotas/compras.js'), 'utf8');

describe('CENTRAL_NFE sem associação', () => {
  test('18. item sem produto_id é rejeitado e não cria produto', () => {
    const err = compras.validarItensCentralNfeSemAssociacao(
      [{ produto_nome: 'ARROZ', codigo_barras: '789', cProd: 'X1' }],
      'CENTRAL_NFE'
    );
    assert.ok(err);
    assert.equal(err.status, 422);
    assert.equal(err.code, 'ITENS_SEM_ASSOCIACAO');
    assert.equal(err.linhas.length, 1);
  });

  test('19. item com produto_id válido passa na validação', () => {
    const err = compras.validarItensCentralNfeSemAssociacao(
      [{ produto_id: 44, produto_nome: 'ARROZ' }],
      'CENTRAL_NFE'
    );
    assert.equal(err, null);
  });

  test('compra manual não usa a trava da Central', () => {
    const err = compras.validarItensCentralNfeSemAssociacao(
      [{ produto_nome: 'MANUAL' }],
      'MANUAL'
    );
    assert.equal(err, null);
  });

  test('ensureProductForItem recusa CENTRAL_NFE sem id', async () => {
    await new Promise((resolve, reject) => {
      compras.ensureProductForItem({ origem_compra: 'CENTRAL_NFE', produto_nome: 'X' }, (err, id) => {
        try {
          assert.ok(err);
          assert.equal(err.code, 'ITEM_SEM_ASSOCIACAO');
          assert.equal(id, undefined);
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  test('código: validação ocorre antes do BEGIN da compra', () => {
    const idxValidar = SRC.indexOf('validarItensCentralNfeSemAssociacao(itens, origem_compra)');
    const idxBegin = SRC.indexOf("db.run('BEGIN IMMEDIATE')", SRC.indexOf('const continuarGravacao'));
    assert.ok(idxValidar > 0 && idxBegin > idxValidar);
  });

  test('20. falha de item desfaz a transação (ROLLBACK presente)', () => {
    assert.match(SRC, /db\.run\('ROLLBACK'\)/);
    assert.match(SRC, /ITENS_SEM_ASSOCIACAO/);
  });
});
