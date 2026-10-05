'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const cfg = require('../../backend/services/estoque/pdvImprimirCupomConfig');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

describe('Cupom PDV — permissão de alternância', () => {
  it('permite alterar cupom para SUPER_ADMIN, ADMIN e OPERADOR', () => {
    const nextCalls = [];
    const next = () => nextCalls.push(true);

    for (const perfil of ['SUPER_ADMIN', 'ADMIN', 'OPERADOR']) {
      const res = mockRes();
      cfg.exigirSuperAdminAlteracao({ user: { perfil } }, res, next);
      assert.equal(res.statusCode, 200, `perfil ${perfil} deve poder alternar o cupom`);
    }

    assert.equal(nextCalls.length, 3);
  });

  it('bloqueia usuário sem perfil permitido', () => {
    const res = mockRes();
    cfg.exigirSuperAdminAlteracao({ user: { perfil: 'USUARIO' } }, res, () => {});
    assert.equal(res.statusCode, 403);
    assert.match(String(res.body.error || res.body.erro), /SUPER ADMIN, ADMIN ou OPERADOR/);
  });
});
