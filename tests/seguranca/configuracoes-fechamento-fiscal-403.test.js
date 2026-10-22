/**
 * Hotfix P0 — 403 em GET /api/configuracoes/fechamento_fiscal_do_dia
 * HTTP real (express + gate + router reais), banco temporário isolado, licença simulada.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '..', '..');
process.env.NODE_ENV = 'test';
process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-cfg403-'));
process.env.JWT_SECRET = 'teste-cfg403';

const jwt = require('jsonwebtoken');
const licencaPath = require.resolve('../../backend/services/verificarLicenca');
let licencaValida = true;
require.cache[licencaPath] = {
  id: licencaPath,
  filename: licencaPath,
  loaded: true,
  exports: async () => (licencaValida
    ? { valido: true }
    : { valido: false, motivo: 'AUSENTE', codigo_instalacao: 'TESTE' })
};

const express = require('express');
const { apiAuthLicencaGate } = require('../../backend/middleware/apiAuthLicencaGate');
const { verificarToken } = require('../../backend/middleware/auth');
const configuracoesRoutes = require('../../backend/rotas/configuracoes');

let server;
let port;

function get(rota, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: rota, headers }, (res) => {
      let corpo = '';
      res.on('data', (c) => { corpo += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(corpo || '{}') }));
    }).on('error', reject);
  });
}

const ROTA = '/api/configuracoes/fechamento_fiscal_do_dia';
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

describe('GET /api/configuracoes/fechamento_fiscal_do_dia — contrato de autorização', () => {
  before(async () => {
    const db = require('../../backend/database');
    for (let t = 0; t < 100; t += 1) {
      const pronto = await new Promise((resolve) => {
        db.all('PRAGMA table_info(configuracoes)', (e, cols) => resolve(!e && (cols || []).some((c) => c.name === 'tipo')));
      });
      if (pronto) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const app = express();
    app.use('/api', apiAuthLicencaGate);
    app.use('/api/configuracoes', verificarToken, configuracoesRoutes);
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });

  after(() => new Promise((r) => server.close(r)));

  it('usuário autenticado com licença válida consulta a configuração (200)', async () => {
    licencaValida = true;
    const token = jwt.sign({ id: 1, role: 'operador', permissoes: [] }, 'teste-cfg403', { expiresIn: '1h' });
    const r = await get(ROTA, bearer(token));
    assert.equal(r.status, 200);
    assert.ok(['ATIVADO', 'DESATIVADO'].includes(r.body.valor));
  });

  it('sem token continua 401', async () => {
    const r = await get(ROTA);
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'Acesso negado');
  });

  it('token expirado: 403 com código TOKEN_EXPIRADO e mensagem coerente', async () => {
    const token = jwt.sign({ id: 1 }, 'teste-cfg403', { expiresIn: -10 });
    const r = await get(ROTA, bearer(token));
    assert.equal(r.status, 403);
    assert.equal(r.body.erro, 'TOKEN_EXPIRADO');
    assert.match(r.body.error, /Token inválido ou expirado/);
  });

  it('token assinado com outro segredo: 403 TOKEN_INVALIDO', async () => {
    const token = jwt.sign({ id: 1 }, 'outro-segredo', { expiresIn: '1h' });
    const r = await get(ROTA, bearer(token));
    assert.equal(r.status, 403);
    assert.equal(r.body.erro, 'TOKEN_INVALIDO');
  });

  it('licença ausente continua bloqueando com código próprio (não confundido com sessão)', async () => {
    licencaValida = false;
    const token = jwt.sign({ id: 1 }, 'teste-cfg403', { expiresIn: '1h' });
    const r = await get(ROTA, bearer(token));
    assert.equal(r.status, 403);
    assert.equal(r.body.erro, 'LICENCA_AUSENTE');
    licencaValida = true;
  });

  it('a rota GET não exige permissão por perfil (leitura) e o PUT segue restrito a super admin', async () => {
    const src = fs.readFileSync(path.join(root, 'backend/rotas/configuracoes.js'), 'utf8');
    assert.match(src, /router\.put\(\s*'\/fechamento_fiscal_do_dia',\s*cfgFechamentoFiscalDia\.exigirSuperAdminAlteracao/);
    licencaValida = true;
    const token = jwt.sign({ id: 2, role: 'operador', permissoes: [] }, 'teste-cfg403', { expiresIn: '1h' });
    const put = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, path: ROTA, method: 'PUT',
        headers: { ...bearer(token), 'Content-Type': 'application/json' }
      }, (res) => {
        let c = ''; res.on('data', (d) => { c += d; }); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.end(JSON.stringify({ valor: 'ATIVADO' }));
    });
    assert.ok(put === 401 || put === 403, `PUT por não-admin deve ser bloqueado, veio ${put}`);
  });
  it('reprodução: header corrompido do core.js original ("******\'token\') || \'\'}") resultava em 403', async () => {
    licencaValida = true;
    const r = await get(ROTA, { Authorization: "******'token') || ''}" });
    assert.equal(r.status, 403);
    assert.equal(r.body.erro, 'TOKEN_INVALIDO');
  });

  it('HTTP real: o header exato montado pelo renderer autentica na rota (200)', async () => {
    const core = fs.readFileSync(path.join(root, 'frontend/shared/js/core.js'), 'utf8');
    const i = core.indexOf('configuracoes/fechamento_fiscal_do_dia');
    const linha = core.slice(i).match(/Authorization: (`[^`]*`)/)[1];
    const localStorage = { getItem: () => jwt.sign({ id: 1 }, 'teste-cfg403', { expiresIn: '1h' }) };
    const valor = new Function('localStorage', `return ${linha};`)(localStorage);
    licencaValida = true;
    const r = await get(ROTA, { Authorization: valor });
    assert.equal(r.status, 200);
  });
});

describe('Renderer — contexto de autenticação', () => {
  it('core.js envia Bearer válido do localStorage (sem literal corrompido) e trata sessão expirada', () => {
    const core = fs.readFileSync(path.join(root, 'frontend/shared/js/core.js'), 'utf8');
    assert.doesNotMatch(core, /\*{6}/, 'core.js não pode conter máscara literal no lugar do código');
    const i = core.indexOf('configuracoes/fechamento_fiscal_do_dia');
    const trecho = core.slice(i, i + 1200);
    assert.match(trecho, /Authorization: `Bearer \$\{localStorage\.getItem\('token'\) \|\| ''\}`/);
    assert.match(trecho, /isErroSessaoExpirada/);
  });

  it('cds-centro-configuracoes e fechamento-fiscal-dia usam o mesmo token localStorage', () => {
    const cfg = fs.readFileSync(path.join(root, 'frontend/erp/js/cds-centro-configuracoes.js'), 'utf8');
    const ffd = fs.readFileSync(path.join(root, 'frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
    assert.match(cfg, /localStorage\.getItem\('token'\)/);
    assert.match(ffd, /localStorage\.getItem\('token'\)/);
  });
});
