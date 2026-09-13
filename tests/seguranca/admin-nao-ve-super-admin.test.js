/**
 * ADMIN não lista SUPER_ADMIN e não altera senha de SUPER_ADMIN.
 * node --test tests/seguranca/admin-nao-ve-super-admin.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const AUTH_JS = fs.readFileSync(path.join(ROOT, 'backend/rotas/auth.js'), 'utf8');
const USUARIOS_JS = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/usuarios.js'), 'utf8');

describe('Listagem de usuários — ocultar SUPER_ADMIN do ADMIN', () => {
  it('GET /usuarios filtra SUPER_ADMIN quando logado não é SUPER_ADMIN', () => {
    assert.match(AUTH_JS, /ocultarSuperAdmin/);
    assert.match(AUTH_JS, /!= 'SUPER_ADMIN'/);
    assert.match(AUTH_JS, /SELECT COALESCE\(perfil/);
  });
});

describe('Alteração de senha — ADMIN não altera SUPER_ADMIN', () => {
  it('bloqueia explicitamente perfilAlvo SUPER_ADMIN para não SUPER_ADMIN', () => {
    assert.match(
      AUTH_JS,
      /Apenas SUPER_ADMIN pode alterar a senha de um Super Administrador/
    );
    assert.match(AUTH_JS, /perfilAlvo === 'SUPER_ADMIN'/);
  });

  it('PUT de usuário também bloqueia ADMIN sobre SUPER_ADMIN', () => {
    assert.match(
      AUTH_JS,
      /Apenas SUPER_ADMIN pode alterar a senha ou os dados de um Super Administrador/
    );
  });
});

describe('UI Usuários', () => {
  it('não oferecee opção SUPER_ADMIN para quem não é SUPER_ADMIN', () => {
    assert.match(USUARIOS_JS, /logadoEhSuperAdminUsuarios/);
    assert.match(USUARIOS_JS, /logadoEhSuperAdminUsuarios\(\) \?/);
  });

  it('defesa na renderização oculta linha SUPER_ADMIN para ADMIN', () => {
    assert.match(USUARIOS_JS, /perfil === 'SUPER_ADMIN' && !logadoEhSuperAdminUsuarios\(\)/);
  });
});
