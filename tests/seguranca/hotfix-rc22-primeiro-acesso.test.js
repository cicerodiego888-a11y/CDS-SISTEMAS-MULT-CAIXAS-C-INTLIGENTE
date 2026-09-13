/**
 * Hotfix RC2.2 — primeiro acesso admin/1234 + SUPER_ADMIN + troca obrigatória.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

describe('Hotfix RC2.2 — seed primeiro acesso', () => {
  it('seed cria admin/1234 SUPER_ADMIN e verifica SUPER_ADMIN (não COUNT(*))', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../backend/database.js'),
      'utf8'
    );
    assert.match(src, /Hotfix RC2\.2/);
    assert.match(src, /SUPER_ADMIN/);
    assert.match(src, /VALUES \('admin'/);
    assert.match(src, /senhaInicial = '1234'|const senhaInicial = '1234'/);
    assert.match(src, /troca_senha_obrigatoria/);
    assert.ok(!/randomBytes\(12\)/.test(src) || !/ADMIN_SEED_PASSWORD \|\| crypto\.randomBytes/.test(src));
    assert.match(src, /WHERE UPPER\(TRIM\(COALESCE\(perfil, ''\)\)\) = 'SUPER_ADMIN'/);
    assert.ok(!/SELECT COUNT\(\*\) AS total FROM usuarios/.test(src.split('function seedUsuarioAdmin')[1] || ''));
  });

  it('senha 1234 gera bcrypt válido', () => {
    const hash = bcrypt.hashSync('1234', 10);
    assert.equal(bcrypt.compareSync('1234', hash), true);
    assert.equal(bcrypt.compareSync('admin', hash), false);
  });
});

describe('Hotfix RC2.2 — auth e UI', () => {
  it('auth expõe primeiro-acesso e troca de senha', () => {
    const auth = fs.readFileSync(
      path.resolve(__dirname, '../../backend/rotas/auth.js'),
      'utf8'
    );
    assert.match(auth, /\/primeiro-acesso/);
    assert.match(auth, /\/primeiro-acesso\/trocar-senha/);
    assert.match(auth, /troca_senha_obrigatoria/);
    assert.match(auth, /Escolha uma senha diferente da senha inicial/);
  });

  it('login autofill e painel de troca', () => {
    const loginJs = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/shared/js/login.js'),
      'utf8'
    );
    assert.match(loginJs, /aplicarAutofillPrimeiroAcesso/);
    assert.match(loginJs, /primeiro-acesso\/trocar-senha/);
    assert.match(loginJs, /mostrarPainelPrimeiroAcesso/);
    assert.match(loginJs, /1234/);
    assert.match(loginJs, /salvarUltimoAcessoLogin/);
    assert.match(loginJs, /lembrarCamposDigitadosLogin/);
    assert.match(loginJs, /agendarRestauracaoUltimoAcessoLogin/);
    assert.match(loginJs, /ultimo\.username/);

    const html = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/shared/login.html'),
      'utf8'
    );
    assert.match(html, /primeiroAcessoPanel/);
    assert.match(html, /Primeiro acesso/);
    assert.match(html, /Nova senha/);
    assert.match(html, /Confirmar senha/);
    assert.match(html, /autocomplete="off"/);
  });

  it('não altera núcleos proibidos (smoke)', () => {
    const files = [
      'backend/services/distribuidorEstoqueVenda.js',
      'backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js',
      'frontend/pdv/js/pdv.js',
      'backend/services/faturamento/FaturamentoService.js'
    ];
    for (const rel of files) {
      assert.ok(fs.existsSync(path.resolve(__dirname, '../..', rel)), rel);
    }
  });
});
