/**
 * Hotfix RC1 — Licenciamento, segurança e governança das APIs
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { isPublicApiPath } = require('../../backend/middleware/apiPublicPaths');
const { responderModuloNaoLicenciado, responderLicencaInvalida } = require('../../backend/middleware/errosLicenciamento');
const licencaMw = require('../../backend/middleware/licencaMiddleware');

function mockRes() {
  const out = { statusCode: 200, body: null };
  return {
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(payload) {
      out.body = payload;
      return this;
    },
    _out: out
  };
}

describe('Hotfix RC1 — rotas públicas', () => {
  it('libera auth, licenca, ping e login_background', () => {
    assert.equal(isPublicApiPath('/api/auth/login'), true);
    assert.equal(isPublicApiPath('/api/licenca/status'), true);
    assert.equal(isPublicApiPath('/api/ping'), true);
    assert.equal(isPublicApiPath('/api/configuracoes/login_background'), true);
    assert.equal(isPublicApiPath('/api/terminais/auto'), true);
  });

  it('protege nfe, faturamento, vendas, fiscal, entregas', () => {
    assert.equal(isPublicApiPath('/api/nfe/monitor'), false);
    assert.equal(isPublicApiPath('/api/faturamento/pedidos'), false);
    assert.equal(isPublicApiPath('/api/vendas'), false);
    assert.equal(isPublicApiPath('/api/fiscal/notas'), false);
    assert.equal(isPublicApiPath('/api/vendas/entregas'), false);
  });
});

describe('Hotfix RC1 — isProtectedRoute cobre APIs novas', () => {
  it('protege /api/nfe e /api/faturamento', () => {
    assert.equal(licencaMw.isProtectedRoute({ originalUrl: '/api/nfe/notas' }), true);
    assert.equal(licencaMw.isProtectedRoute({ originalUrl: '/api/faturamento/pedidos' }), true);
    assert.equal(licencaMw.isProtectedRoute({ originalUrl: '/api/dfe/sync' }), true);
    assert.equal(licencaMw.isProtectedRoute({ originalUrl: '/api/central-entradas' }), true);
    assert.equal(licencaMw.isProtectedRoute({ originalUrl: '/api/auth/login' }), false);
  });
});

describe('Hotfix RC1 — erros padronizados', () => {
  it('MODULO_NAO_LICENCIADO com mensagem amigável', () => {
    const res = mockRes();
    responderModuloNaoLicenciado(res, 'nfe');
    assert.equal(res._out.statusCode, 403);
    assert.equal(res._out.body.erro, 'MODULO_NAO_LICENCIADO');
    assert.match(res._out.body.mensagem, /NF-e/);
    assert.equal(res._out.body.modulo, 'nfe');
  });

  it('LICENCA_VENCIDA padronizada', () => {
    const res = mockRes();
    responderLicencaInvalida(res, 'LICENCA_VENCIDA', 'Sistema com licença expirada.');
    assert.equal(res._out.statusCode, 403);
    assert.equal(res._out.body.erro, 'LICENCA_VENCIDA');
    assert.ok(res._out.body.mensagem);
  });
});

describe('Hotfix RC1 — ordem Express e gates', () => {
  it('apiAuthLicencaGate registrado antes das rotas protegidas', () => {
    const server = fs.readFileSync(path.join(__dirname, '../../backend/server.js'), 'utf8');
    const gateIdx = server.indexOf("app.use('/api', apiAuthLicencaGate)");
    const nfeIdx = server.indexOf("app.use('/api/nfe'");
    const fatIdx = server.indexOf("app.use('/api/faturamento'");
    const lateLicense = server.indexOf("app.use('/api', licencaMiddleware)");
    assert.ok(gateIdx > 0, 'gate deve existir');
    assert.ok(gateIdx < nfeIdx, 'gate antes de /api/nfe');
    assert.ok(gateIdx < fatIdx, 'gate antes de /api/faturamento');
    assert.equal(lateLicense, -1, 'não pode haver licencaMiddleware após as rotas');
  });

  it('exige recurso nfe/faturamento/fiscal no mount', () => {
    const server = fs.readFileSync(path.join(__dirname, '../../backend/server.js'), 'utf8');
    assert.match(server, /\/api\/nfe'.*exigirRecurso\('nfe'\)/s);
    assert.match(server, /\/api\/faturamento'.*exigirRecurso\('faturamento'\)/s);
    assert.match(server, /\/api\/fiscal'.*exigirRecurso\('fiscal'\)/s);
  });

  it('Núcleo e motores proibidos intactos nesta hotfix', () => {
    const root = path.join(__dirname, '../..');
    const files = [
      'backend/services/vendas/VendaApplicationService.js',
      'backend/services/vendas/VendaPagamentoService.js',
      'backend/services/fiscal/emissor.js'
    ];
    // Smoke: arquivos existem e hotfix não os referencia como alvo de edição estrutural
    files.forEach((f) => {
      assert.ok(fs.existsSync(path.join(root, f)));
    });
    const gate = fs.readFileSync(path.join(root, 'backend/middleware/apiAuthLicencaGate.js'), 'utf8');
    assert.doesNotMatch(gate, /VendaPagamentoService|DistribuidorPagamento/);
  });

  it('frontend bloqueia páginas nfe/faturamento e trata 403 de licença', () => {
    const core = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/core.js'), 'utf8');
    assert.match(core, /nfe-central/);
    assert.match(core, /MODULO_NAO_LICENCIADO/);
    assert.match(core, /notificarErroLicenciamento/);
    assert.match(core, /paginaPermitidaPorImplantacao/);
  });

  it('auth login não expõe stack', () => {
    const auth = fs.readFileSync(path.join(__dirname, '../../backend/rotas/auth.js'), 'utf8');
    assert.doesNotMatch(auth, /stack:\s*err\.stack/);
  });
});
