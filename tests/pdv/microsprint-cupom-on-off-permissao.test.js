'use strict';

/**
 * Microsprint — permissão do botão Cupom OFF/ON do PDV.
 * Router real de /api/configuracoes + verificarToken real (JWT), com banco SQLite em memória
 * injetado no lugar de backend/database.js: nenhum banco real é aberto.
 * node --test tests/pdv/microsprint-cupom-on-off-permissao.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '../..');
const memDb = new sqlite3.Database(':memory:');
require.cache[require.resolve(path.join(ROOT, 'backend/database.js'))] = {
  id: 'database-mock', filename: 'database-mock', loaded: true, exports: memDb
};
require.cache[require.resolve(path.join(ROOT, 'backend/services/auditoria'))] = {
  id: 'auditoria-mock', filename: 'auditoria-mock', loaded: true,
  exports: { gravarAuditoria: () => Promise.resolve() }
};

const { verificarToken, JWT_SECRET } = require(path.join(ROOT, 'backend/middleware/auth.js'));
const cfgCupom = require(path.join(ROOT, 'backend/services/estoque/pdvImprimirCupomConfig.js'));
const configuracoesRoutes = require(path.join(ROOT, 'backend/rotas/configuracoes.js'));

const POLITICA_INICIAL = '{"modo":"PERGUNTAR"}';

const USUARIOS = {
  superAdmin: { id: 1, username: 'sa', role: 'admin', perfil: 'SUPER_ADMIN', permissoes: [] },
  comum: { id: 2, username: 'operador1', role: 'operador', perfil: 'USUARIO', permissoes: ['pdv', 'caixa'] },
  caixaLegado: { id: 3, username: 'caixa1', role: 'caixa', perfil: 'USUARIO', permissoes: ['pdv'] },
  perfilCaixa: { id: 4, username: 'caixa2', role: 'caixa', perfil: 'CAIXA', permissoes: [] },
  semPdv: { id: 5, username: 'relatorio1', role: 'consulta', perfil: 'USUARIO', permissoes: ['relatorios'] }
};

const token = (u) => jwt.sign(u, JWT_SECRET, { expiresIn: '5m' });

let server;
let base;

function chamar(metodo, rota, usuario, body) {
  return new Promise((resolve, reject) => {
    const dados = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (usuario) headers.Authorization = `Bearer ${token(usuario)}`;
    if (dados) headers['Content-Length'] = Buffer.byteLength(dados);
    const req = http.request(`${base}/api/configuracoes${rota}`, { method: metodo, headers }, (res) => {
      let texto = '';
      res.on('data', (c) => { texto += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(texto); } catch (_) { /* corpo vazio */ }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (dados) req.write(dados);
    req.end();
  });
}

const valorBanco = (chave) => new Promise((resolve, reject) => {
  memDb.get('SELECT valor FROM configuracoes WHERE chave = ?', [chave], (err, row) => (
    err ? reject(err) : resolve(row ? row.valor : null)
  ));
});

const alternar = (usuario, valor) => chamar('PUT', '/pdv_imprimir_cupom', usuario, { valor });

before(async () => {
  await new Promise((resolve, reject) => memDb.serialize(() => {
    memDb.run(`CREATE TABLE configuracoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT UNIQUE, valor TEXT, tipo TEXT, descricao TEXT, updated_at DATETIME
    )`);
    memDb.run(`INSERT INTO configuracoes (chave, valor, tipo) VALUES ('pdv_imprimir_cupom', 'ATIVADO', 'string')`);
    memDb.run(`INSERT INTO configuracoes (chave, valor, tipo) VALUES ('cupom_impressao_politica', ?, 'json')`, [POLITICA_INICIAL]);
    memDb.run(`INSERT INTO configuracoes (chave, valor, tipo) VALUES ('pdv_permitir_editar_preco_unitario', 'DESATIVADO', 'string')`,
      (err) => (err ? reject(err) : resolve()));
  }));
  cfgCupom._resetCacheForTests();
  const app = express();
  app.use(express.json());
  app.use('/api/configuracoes', verificarToken, configuracoesRoutes);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => memDb.close(r));
});

describe('Cupom OFF/ON — causa raiz', () => {
  it('o middleware anterior bloqueava operadores de caixa com acesso ao PDV', () => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() { return this; } };
    cfgCupom.exigirSuperAdminAlteracao({ user: USUARIOS.caixaLegado }, res, () => {});
    assert.equal(res.statusCode, 403);
  });
});

describe('Cupom OFF/ON — alternância por usuários do PDV', () => {
  it('usuário comum desliga e liga o cupom; estado persiste e é devolvido pela leitura', async () => {
    const off = await alternar(USUARIOS.comum, 'DESATIVADO');
    assert.equal(off.status, 200);
    assert.equal(off.body.valor, 'DESATIVADO');
    assert.equal(off.body.permitido, false, 'o botão usa "permitido" para mostrar Cupom OFF');
    assert.equal(await valorBanco('pdv_imprimir_cupom'), 'DESATIVADO');
    assert.equal(await valorBanco('imprimir_cupom'), 'false', 'chave legada segue sincronizada');
    const leitura = await chamar('GET', '/pdv_imprimir_cupom', USUARIOS.comum);
    assert.equal(leitura.body.permitido, false);

    const on = await alternar(USUARIOS.comum, 'ATIVADO');
    assert.equal(on.status, 200);
    assert.equal(on.body.permitido, true);
    assert.equal(await valorBanco('pdv_imprimir_cupom'), 'ATIVADO');
  });

  it('operador de caixa (role legado, permissão pdv) e perfil CAIXA conseguem alternar', async () => {
    for (const u of [USUARIOS.caixaLegado, USUARIOS.perfilCaixa]) {
      const off = await alternar(u, 'DESATIVADO');
      assert.equal(off.status, 200, u.username);
      const on = await alternar(u, 'ATIVADO');
      assert.equal(on.status, 200, u.username);
      assert.equal(await valorBanco('pdv_imprimir_cupom'), 'ATIVADO');
    }
  });

  it('SUPER ADMIN continua ligando e desligando', async () => {
    assert.equal((await alternar(USUARIOS.superAdmin, 'DESATIVADO')).status, 200);
    assert.equal(await valorBanco('pdv_imprimir_cupom'), 'DESATIVADO');
    assert.equal((await alternar(USUARIOS.superAdmin, 'ATIVADO')).status, 200);
    assert.equal(await valorBanco('pdv_imprimir_cupom'), 'ATIVADO');
  });

  it('estado continua global: alteração de um usuário vale para os demais', async () => {
    await alternar(USUARIOS.caixaLegado, 'DESATIVADO');
    const visto = await chamar('GET', '/pdv_imprimir_cupom', USUARIOS.superAdmin);
    assert.equal(visto.body.valor, 'DESATIVADO');
    await alternar(USUARIOS.superAdmin, 'ATIVADO');
    const vistoComum = await chamar('GET', '/pdv_imprimir_cupom', USUARIOS.comum);
    assert.equal(vistoComum.body.valor, 'ATIVADO');
  });
});

describe('Cupom OFF/ON — proteções preservadas', () => {
  it('usuário sem acesso ao PDV continua bloqueado e o estado não muda', async () => {
    const r = await alternar(USUARIOS.semPdv, 'DESATIVADO');
    assert.equal(r.status, 403);
    assert.equal(await valorBanco('pdv_imprimir_cupom'), 'ATIVADO');
  });

  it('sem autenticação: acesso negado', async () => {
    const r = await alternar(null, 'DESATIVADO');
    assert.equal(r.status, 401);
    assert.equal(await valorBanco('pdv_imprimir_cupom'), 'ATIVADO');
  });

  it('valor inválido continua rejeitado', async () => {
    const r = await alternar(USUARIOS.comum, 'TALVEZ');
    assert.equal(r.status, 400);
    assert.equal(await valorBanco('pdv_imprimir_cupom'), 'ATIVADO');
  });

  it('política global de impressão segue restrita ao middleware anterior', async () => {
    const r = await chamar('PUT', '/cupom_impressao_politica', USUARIOS.caixaLegado, { modo: 'AUTOMATICO' });
    assert.equal(r.status, 403);
    assert.equal(await valorBanco('cupom_impressao_politica'), POLITICA_INICIAL);
  });

  it('demais configurações do PDV seguem exclusivas do SUPER ADMIN', async () => {
    for (const rota of ['/pdv_permitir_editar_preco_unitario', '/pdv_permitir_transferencia_nao_fiscal_fiscal', '/empresa_permite_venda_sem_estoque']) {
      const r = await chamar('PUT', rota, USUARIOS.comum, { valor: 'ATIVADO' });
      assert.equal(r.status, 403, rota);
    }
    assert.equal(await valorBanco('pdv_permitir_editar_preco_unitario'), 'DESATIVADO');
  });
});
