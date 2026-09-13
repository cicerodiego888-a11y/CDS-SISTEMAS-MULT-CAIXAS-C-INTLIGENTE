/**
 * Novo modelo de controle F12: OPERADOR | ADMINISTRADOR + TODOS | INDIVIDUAL
 *
 * node --test tests/f12-modelo-controle.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '..');
const modelo = require('../backend/lib/f12ModeloControle');
const { migrarModeloControleF12 } = require('../backend/lib/migracaoF12Policy');

const CORE_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/core.js'), 'utf8');
const ADMIN_JS = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/f12-admin.js'), 'utf8');
const RESOLVER_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/F12PolicyResolver.js'), 'utf8');
const FONTE_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/f12FonteEstadoPdv.js'), 'utf8');
const CAIXA_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/obterCaixaAtual.js'), 'utf8');

function criarDbMemoria(seedPolitica) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:');
    db.run(
      `CREATE TABLE configuracoes (
        chave TEXT PRIMARY KEY,
        valor TEXT,
        tipo TEXT,
        descricao TEXT,
        updated_at TEXT
      )`,
      (err) => {
        if (err) return reject(err);
        if (!seedPolitica) return resolve(db);
        db.run(
          `INSERT INTO configuracoes (chave, valor, tipo, descricao) VALUES ('f12_politica', ?, 'string', 'legado')`,
          [seedPolitica],
          (insErr) => (insErr ? reject(insErr) : resolve(db))
        );
      }
    );
  });
}

function migrar(db) {
  return new Promise((resolve, reject) => {
    migrarModeloControleF12(db, (err, result) => (err ? reject(err) : resolve(result)));
  });
}

function lerConfig(db, chave) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT valor FROM configuracoes WHERE chave = ?`, [chave], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.valor : null);
    });
  });
}

describe('Mapeamento legado → modelo oficial', () => {
  it('cenário 4: POR_CAIXA → OPERADOR', () => {
    const r = modelo.mapearPoliticaLegadaParaModelo('POR_CAIXA');
    assert.equal(r.controle, 'OPERADOR');
    assert.equal(r.escopo, null);
  });

  it('cenário 5: GLOBAL → ADMINISTRADOR + TODOS', () => {
    const r = modelo.mapearPoliticaLegadaParaModelo('GLOBAL');
    assert.equal(r.controle, 'ADMINISTRADOR');
    assert.equal(r.escopo, 'TODOS');
  });

  it('cenário 6: MODO_ADMIN → ADMINISTRADOR + INDIVIDUAL', () => {
    const r = modelo.mapearPoliticaLegadaParaModelo('MODO_ADMIN');
    assert.equal(r.controle, 'ADMINISTRADOR');
    assert.equal(r.escopo, 'INDIVIDUAL');
  });
});

describe('Resolução de estado e permissão', () => {
  it('cenário 1: OPERADOR usa caixas.f12_ativo e só o operador do caixa altera', () => {
    assert.equal(modelo.resolverEstadoEfetivoF12({
      controle: 'OPERADOR',
      escopo: null,
      globalAtivo: false,
      caixaAtivo: true
    }), true);
    assert.equal(modelo.resolverEstadoEfetivoF12({
      controle: 'OPERADOR',
      escopo: null,
      globalAtivo: true,
      caixaAtivo: false
    }), false);

    const operador = { perfil: 'OPERADOR' };
    assert.equal(modelo.podeAlterarViaTeclaF12('OPERADOR', operador), true);
    assert.equal(modelo.podeAlterarViaTeclaF12('OPERADOR', { perfil: 'ADMIN' }), true);
    assert.equal(modelo.podeAlterarViaTeclaF12('OPERADOR', { perfil: 'SUPER_ADMIN' }), true);
    assert.equal(modelo.operadorPodeAlterarEsteCaixa({ perfil: 'OPERADOR', caixa_id: 1 }, 1), true);
    assert.equal(modelo.operadorPodeAlterarEsteCaixa({ perfil: 'OPERADOR', caixa_id: 1 }, 2), false);
    // Sem caixa_id no usuário (modelo real CDS): libera o caixa do terminal.
    assert.equal(modelo.operadorPodeAlterarEsteCaixa({ perfil: 'OPERADOR' }, 1), true);
    assert.equal(modelo.operadorPodeAlterarEsteCaixa({ perfil: 'USUARIO' }, 3), true);
    assert.equal(modelo.podeAlterarViaTeclaF12('OPERADOR', { perfil: 'USUARIO' }, 2), true);
  });

  it('cenário 2: ADMINISTRADOR + TODOS usa f12_global_ativo e operador não altera', () => {
    assert.equal(modelo.resolverEstadoEfetivoF12({
      controle: 'ADMINISTRADOR',
      escopo: 'TODOS',
      globalAtivo: true,
      caixaAtivo: false
    }), true);
    assert.equal(modelo.resolverEstadoEfetivoF12({
      controle: 'ADMINISTRADOR',
      escopo: 'TODOS',
      globalAtivo: false,
      caixaAtivo: true
    }), false);
    assert.equal(modelo.podeAlterarViaTeclaF12('ADMINISTRADOR', { perfil: 'OPERADOR' }), false);
    assert.equal(modelo.podeAlterarViaTeclaF12('ADMINISTRADOR', { perfil: 'ADMIN' }), false);
    assert.equal(modelo.podeAlterarViaTeclaF12('ADMINISTRADOR', { perfil: 'SUPER_ADMIN' }), true);
  });

  it('cenário 3: ADMINISTRADOR + INDIVIDUAL usa caixas.f12_ativo e operador não altera', () => {
    assert.equal(modelo.resolverEstadoEfetivoF12({
      controle: 'ADMINISTRADOR',
      escopo: 'INDIVIDUAL',
      globalAtivo: true,
      caixaAtivo: false
    }), false);
    assert.equal(modelo.resolverEstadoEfetivoF12({
      controle: 'ADMINISTRADOR',
      escopo: 'INDIVIDUAL',
      globalAtivo: false,
      caixaAtivo: true
    }), true);
    assert.equal(modelo.podeAlterarViaTeclaF12('ADMINISTRADOR', { perfil: 'OPERADOR' }), false);
    assert.equal(modelo.podeAlterarViaTeclaF12('ADMINISTRADOR', { perfil: 'ADMIN' }), false);
    assert.equal(modelo.podeAlterarViaTeclaF12('ADMINISTRADOR', { perfil: 'SUPER_ADMIN' }), true);
  });

  it('compatibilidade: podeOperadorAlterarF12 legado continua igual', () => {
    const op = { perfil: 'OPERADOR' };
    assert.equal(modelo.podeOperadorAlterarF12Compat('POR_CAIXA', op), true);
    assert.equal(modelo.podeOperadorAlterarF12Compat('GLOBAL', op), false);
    assert.equal(modelo.podeOperadorAlterarF12Compat('MODO_ADMIN', op), false);
    const admin = { perfil: 'ADMIN' };
    assert.equal(modelo.podeOperadorAlterarF12Compat('POR_CAIXA', admin), true);
    assert.equal(modelo.podeOperadorAlterarF12Compat('GLOBAL', admin), true);
    const superA = { perfil: 'SUPER_ADMIN' };
    assert.equal(modelo.podeOperadorAlterarF12Compat('MODO_ADMIN', superA), true);
  });
});

describe('Migração idempotente', () => {
  it('migra POR_CAIXA para OPERADOR e não altera na segunda execução', async () => {
    const db = await criarDbMemoria('POR_CAIXA');
    const primeira = await migrar(db);
    assert.equal(primeira.jaMigrado, false);
    assert.equal(primeira.controle, 'OPERADOR');
    assert.equal(await lerConfig(db, 'f12_controle'), 'OPERADOR');

    const segunda = await migrar(db);
    assert.equal(segunda.jaMigrado, true);
    assert.equal(await lerConfig(db, 'f12_controle'), 'OPERADOR');
    db.close();
  });

  it('migra GLOBAL para ADMINISTRADOR + TODOS', async () => {
    const db = await criarDbMemoria('GLOBAL');
    const r = await migrar(db);
    assert.equal(r.controle, 'ADMINISTRADOR');
    assert.equal(r.escopo, 'TODOS');
    assert.equal(await lerConfig(db, 'f12_controle'), 'ADMINISTRADOR');
    assert.equal(await lerConfig(db, 'f12_escopo_admin'), 'TODOS');
    db.close();
  });

  it('migra MODO_ADMIN para ADMINISTRADOR + INDIVIDUAL', async () => {
    const db = await criarDbMemoria('MODO_ADMIN');
    const r = await migrar(db);
    assert.equal(r.controle, 'ADMINISTRADOR');
    assert.equal(r.escopo, 'INDIVIDUAL');
    assert.equal(await lerConfig(db, 'f12_escopo_admin'), 'INDIVIDUAL');
    db.close();
  });

  it('cenário 7: instalação sem f12_politica inicia sem erro com OPERADOR', async () => {
    const db = await criarDbMemoria(null);
    const r = await migrar(db);
    assert.equal(r.jaMigrado, false);
    assert.equal(r.controle, 'OPERADOR');
    assert.equal(await lerConfig(db, 'f12_controle'), 'OPERADOR');
    db.close();
  });
});

describe('Frontend e regressão das sprints anteriores', () => {
  it('tela admin não expõe POR_CAIXA / GLOBAL / MODO_ADMIN', () => {
    assert.doesNotMatch(ADMIN_JS, /POR_CAIXA/);
    assert.doesNotMatch(ADMIN_JS, /value="GLOBAL"/);
    assert.doesNotMatch(ADMIN_JS, /MODO_ADMIN/);
    assert.match(ADMIN_JS, /Operador do Caixa/);
    assert.match(ADMIN_JS, /Somente Administrador/);
    assert.match(ADMIN_JS, /Mesmo estado para todos os caixas/);
    assert.match(ADMIN_JS, /Configurar cada caixa individualmente/);
  });

  it('core.js usa contexto.podeAlterar e não reinterpreta políticas', () => {
    assert.match(CORE_JS, /obterContexto/);
    assert.match(CORE_JS, /podeAlterar/);
    assert.match(CORE_JS, /controlado pelo administrador/);
    assert.doesNotMatch(CORE_JS, /info\.politica/);
    assert.doesNotMatch(CORE_JS, /caixaIdAtual\s*\|\|\s*window\.terminalId\s*\|\|\s*1/);
    assert.match(CORE_JS, /decidido exclusivamente pelo backend/);
  });

  it('Resolver consome contexto e não ramifica POR_CAIXA/GLOBAL/MODO_ADMIN', () => {
    assert.match(RESOLVER_JS, /obterContexto/);
    assert.match(RESOLVER_JS, /\/f12\/contexto\//);
    assert.doesNotMatch(RESOLVER_JS, /if \(politica === 'POR_CAIXA'\)/);
    assert.doesNotMatch(RESOLVER_JS, /if \(politica === 'GLOBAL'\)/);
    assert.doesNotMatch(RESOLVER_JS, /if \(politica === 'MODO_ADMIN'\)/);
  });

  it('Terminal → Caixa e fonte única do PDV permanecem', () => {
    assert.match(CAIXA_JS, /caixa_id/);
    assert.match(FONTE_JS, /pdvUsaF12PolicyComoFonteOficial/);
    assert.match(CORE_JS, /origemF12/);
    assert.match(CORE_JS, /sincronizarEstadoF12Pdv/);
    assert.doesNotMatch(CORE_JS, /window\.terminalId\s*\|\|\s*1/);
  });
});
