/**
 * Matriz oficial de permissões do F12.
 *
 * SUPER_ADMIN possui permissão total.
 * Com controle OPERADOR ("Operador do Caixa"), quem opera o PDV (inclui ADMIN) pode usar F12.
 * Com controle ADMINISTRADOR, ADMIN altera pela tela administrativa (não pela tecla).
 *
 * node --test tests/f12-permissoes.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const m = require('../backend/lib/f12ModeloControle');

const CORE_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/core.js'), 'utf8');
const RESOLVER_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/F12PolicyResolver.js'), 'utf8');
const ROTAS_JS = fs.readFileSync(path.join(ROOT, 'backend/rotas/f12.js'), 'utf8');
const SERVICE_JS = fs.readFileSync(path.join(ROOT, 'backend/services/F12PolicyService.js'), 'utf8');

const OPERADOR = { perfil: 'OPERADOR', caixa_id: 1 };
const ADMIN = { perfil: 'ADMIN', caixa_id: 1 };
const SUPER = { perfil: 'SUPER_ADMIN', caixa_id: 99 };

function pode(controle, user, caixaId) {
  return m.resolverPodeAlterarF12({ controle, user, caixaId });
}

describe('Centralização SUPER_ADMIN', () => {
  it('temPermissaoTotalF12 / isSuperAdminF12 só aceitam SUPER_ADMIN', () => {
    assert.equal(m.temPermissaoTotalF12(SUPER), true);
    assert.equal(m.isSuperAdminF12(SUPER), true);
    assert.equal(m.temPermissaoTotalF12(ADMIN), false);
    assert.equal(m.temPermissaoTotalF12(OPERADOR), false);
    assert.equal(m.isPerfilAdmin(ADMIN), true);
    assert.equal(m.isPerfilAdmin(SUPER), false);
    assert.equal(m.isAdmin(ADMIN), true);
    assert.equal(m.isAdmin(SUPER), true);
    assert.equal(m.isAdmin(OPERADOR), false);
  });

  it('ADMIN != SUPER_ADMIN: isAdmin não libera F12 em modo ADMINISTRADOR', () => {
    assert.equal(m.isAdmin(ADMIN), true);
    assert.equal(pode('OPERADOR', ADMIN, 1), true);
    assert.equal(pode('ADMINISTRADOR', ADMIN, 1), false);
  });
});

describe('CENÁRIO A — CONTROLE = OPERADOR', () => {
  const controle = 'OPERADOR';

  it('OPERADOR: caixa atual podeAlterar = true', () => {
    assert.equal(pode(controle, OPERADOR, 1), true);
  });

  it('OPERADOR tentando outro caixa é bloqueado', () => {
    assert.equal(pode(controle, OPERADOR, 2), false);
    assert.equal(m.operadorPodeAlterarEsteCaixa(OPERADOR, 2), false);
    const auth = m.autorizarDefinirEstadoCaixa(OPERADOR, { controle, escopo: null }, 2);
    assert.equal(auth.ok, false);
    assert.equal(auth.erro.status, 403);
  });

  it('ADMIN no PDV: podeAlterar via F12 = true (Operador do Caixa)', () => {
    assert.equal(pode(controle, ADMIN, 1), true);
    const toggle = m.autorizarToggleF12(ADMIN, { podeAlterar: true, controle, escopo: null });
    assert.equal(toggle.ok, true);
  });

  it('ADMIN no PDV pode definir estado do próprio caixa quando controle = OPERADOR', () => {
    const auth = m.autorizarDefinirEstadoCaixa(ADMIN, { controle, escopo: null }, 1);
    assert.equal(auth.ok, true);
  });

  it('ADMIN continua podendo administrar o modelo', () => {
    assert.equal(m.autorizarDefinirModeloControle(ADMIN).ok, true);
    assert.equal(m.podeAdministrarConfiguracaoF12(ADMIN), true);
  });

  it('SUPER_ADMIN: podeAlterar = true em qualquer caixa', () => {
    assert.equal(pode(controle, SUPER, 1), true);
    assert.equal(pode(controle, SUPER, 2), true);
    assert.equal(m.autorizarToggleF12(SUPER, {
      podeAlterar: true,
      controle,
      escopo: null
    }).ok, true);
    assert.equal(m.autorizarDefinirEstadoCaixa(SUPER, { controle, escopo: null }, 9).ok, true);
  });
});

describe('CENÁRIO B — ADMINISTRADOR + TODOS', () => {
  const modelo = { controle: 'ADMINISTRADOR', escopo: 'TODOS' };

  it('OPERADOR: podeAlterar = false', () => {
    assert.equal(pode('ADMINISTRADOR', OPERADOR, 1), false);
    assert.equal(m.autorizarDefinirEstadoCaixa(OPERADOR, modelo, 1).ok, false);
    assert.equal(m.autorizarDefinirEstadoGlobal(OPERADOR, modelo).ok, false);
  });

  it('ADMIN: podeAlterar via F12 = false; configuração administrativa permitida', () => {
    assert.equal(pode('ADMINISTRADOR', ADMIN, 1), false);
    const toggle = m.autorizarToggleF12(ADMIN, {
      podeAlterar: false,
      controle: 'ADMINISTRADOR',
      escopo: 'TODOS'
    });
    assert.equal(toggle.ok, false);
    assert.equal(m.autorizarDefinirEstadoGlobal(ADMIN, modelo).ok, true);
    assert.equal(m.autorizarDefinirModeloControle(ADMIN).ok, true);
    assert.equal(m.autorizarDefinirEstadoCaixa(ADMIN, modelo, 1).erro.status, 400);
  });

  it('SUPER_ADMIN: podeAlterar = true e alteração global permitida', () => {
    assert.equal(pode('ADMINISTRADOR', SUPER, 1), true);
    const toggle = m.autorizarToggleF12(SUPER, {
      podeAlterar: true,
      controle: 'ADMINISTRADOR',
      escopo: 'TODOS'
    });
    assert.equal(toggle.ok, true);
    assert.equal(toggle.acao, 'GLOBAL');
    assert.equal(m.autorizarDefinirEstadoGlobal(SUPER, modelo).ok, true);
    assert.equal(m.autorizarDefinirEstadoCaixa(SUPER, modelo, 3).ok, true);
    assert.equal(m.autorizarDefinirModeloControle(SUPER).ok, true);
  });
});

describe('CENÁRIO C — ADMINISTRADOR + INDIVIDUAL', () => {
  const modelo = { controle: 'ADMINISTRADOR', escopo: 'INDIVIDUAL' };

  it('OPERADOR: podeAlterar = false', () => {
    assert.equal(pode('ADMINISTRADOR', OPERADOR, 1), false);
    assert.equal(m.autorizarDefinirEstadoCaixa(OPERADOR, modelo, 1).ok, false);
  });

  it('ADMIN: podeAlterar via F12 = false; configuração por caixa permitida', () => {
    assert.equal(pode('ADMINISTRADOR', ADMIN, 1), false);
    const toggle = m.autorizarToggleF12(ADMIN, {
      podeAlterar: false,
      controle: 'ADMINISTRADOR',
      escopo: 'INDIVIDUAL'
    });
    assert.equal(toggle.ok, false);
    assert.equal(m.autorizarDefinirEstadoCaixa(ADMIN, modelo, 8).ok, true);
    assert.equal(m.autorizarDefinirModeloControle(ADMIN).ok, true);
  });

  it('SUPER_ADMIN: podeAlterar = true e configura qualquer caixa', () => {
    assert.equal(pode('ADMINISTRADOR', SUPER, 1), true);
    assert.equal(pode('ADMINISTRADOR', SUPER, 99), true);
    const toggle = m.autorizarToggleF12(SUPER, {
      podeAlterar: true,
      controle: 'ADMINISTRADOR',
      escopo: 'INDIVIDUAL'
    });
    assert.equal(toggle.ok, true);
    assert.equal(toggle.acao, 'CAIXA');
    assert.equal(m.autorizarDefinirEstadoCaixa(SUPER, modelo, 4).ok, true);
    assert.equal(m.autorizarDefinirModeloControle(SUPER).ok, true);
    assert.equal(m.autorizarDefinirEstadoGlobal(SUPER, modelo).ok, true);
  });
});

describe('Testes de segurança', () => {
  it('OPERADOR sem caixa_id no cadastro pode alterar o caixa do terminal (modelo CDS)', () => {
    assert.equal(pode('OPERADOR', OPERADOR, 1), true);
    assert.equal(pode('OPERADOR', { perfil: 'OPERADOR', caixa_id: 1 }, 999), false);
    // Cadastro CDS não vincula usuário→caixa; o caixa vem do terminal.
    assert.equal(pode('OPERADOR', { perfil: 'OPERADOR' }, 1), true);
    assert.equal(pode('OPERADOR', { perfil: 'USUARIO' }, 1), true);
  });

  it('perfil ADMIN só libera tecla F12 com controle OPERADOR (não por ser admin)', () => {
    assert.equal(pode('OPERADOR', { perfil: 'ADMIN' }, 1), true);
    assert.equal(pode('OPERADOR', { perfil: 'admin' }, 1), true);
    assert.equal(pode('ADMINISTRADOR', { perfil: 'ADMIN' }, 1), false);
    assert.equal(pode('ADMINISTRADOR', { perfil: 'admin' }, 1), false);
  });

  it('SUPER_ADMIN recebe podeAlterar = true em todos os modos', () => {
    assert.equal(pode('OPERADOR', SUPER, 1), true);
    assert.equal(pode('ADMINISTRADOR', SUPER, 1), true);
    assert.equal(pode('ADMINISTRADOR', SUPER, null), true);
  });

  it('toggle oficial exige podeAlterar do backend — sem atalho isAdmin', () => {
    const adminCtx = { podeAlterar: false, controle: 'OPERADOR', escopo: null };
    assert.equal(m.autorizarToggleF12(ADMIN, adminCtx).ok, false);
    const superCtx = { podeAlterar: true, controle: 'ADMINISTRADOR', escopo: 'TODOS' };
    assert.equal(m.autorizarToggleF12(SUPER, superCtx).ok, true);
  });

  it('backend bloqueia tentativas não autorizadas de estado/global/controle', () => {
    assert.equal(m.autorizarDefinirModeloControle(OPERADOR).ok, false);
    assert.equal(m.autorizarDefinirEstadoGlobal(OPERADOR, {
      controle: 'ADMINISTRADOR',
      escopo: 'TODOS'
    }).ok, false);
    assert.equal(m.autorizarDefinirEstadoCaixa(OPERADOR, {
      controle: 'ADMINISTRADOR',
      escopo: 'INDIVIDUAL'
    }, 1).ok, false);
  });
});

describe('Frontend apenas respeita o backend', () => {
  it('core.js não concede SUPER_ADMIN localmente', () => {
    assert.match(CORE_JS, /decidido exclusivamente pelo backend/);
    assert.doesNotMatch(CORE_JS, /perfil\s*===\s*['"]SUPER_ADMIN['"]/);
    assert.doesNotMatch(CORE_JS, /if\s*\(.*isAdmin/);
  });

  it('resolver não libera podeAlterar quando a API falha', () => {
    assert.match(RESOLVER_JS, /podeAlterar:\s*false/);
    assert.doesNotMatch(RESOLVER_JS, /perfil\s*===\s*['"]SUPER_ADMIN['"]/);
  });

  it('rotas F12 usam a autorização central e o toggle oficial', () => {
    assert.match(ROTAS_JS, /executarToggleF12/);
    assert.match(ROTAS_JS, /autorizarDefinirEstadoCaixa/);
    assert.match(ROTAS_JS, /autorizarDefinirEstadoGlobal/);
    assert.match(ROTAS_JS, /resolverPodeAlterarF12/);
    assert.doesNotMatch(ROTAS_JS, /!contexto\.podeAlterar\s*&&\s*!isAdmin/);
    assert.match(SERVICE_JS, /temPermissaoTotalF12/);
    assert.match(SERVICE_JS, /resolverPodeAlterarF12/);
  });
});
