/**
 * RC3.20 — Ajuste de Estoque: isolamento entre Saldo Fiscal e Saldo Gerencial.
 *
 * Causa raiz: o modal Ajustar Estoque não oferecia seletor de tipo de saldo;
 * o usuário não conseguia ajustar o saldo gerencial (B) sem tocar no fiscal (A).
 *
 * Executar: node --test tests/produtos/rc320-ajuste-estoque-fiscal-gerencial.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const path = require('path');

const {
  aplicarAjusteEstoqueProduto
} = require('../../backend/services/ajusteEstoqueService');

const { TipoSaldo, normalizarTipoSaldo } = require('../../backend/services/fiscalNaoFiscal/constants');

// ---------- helpers ----------
function openMem() {
  return new sqlite3.Database(':memory:');
}
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}
function close(db) {
  return new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
}

function aplicarAjuste(db, opcoes) {
  return new Promise((resolve, reject) => {
    aplicarAjusteEstoqueProduto(db, opcoes, (err, resultado) => {
      if (err) reject(err);
      else resolve(resultado);
    });
  });
}

async function schemaBase(db) {
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT,
    saldo_fiscal REAL DEFAULT 0,
    saldo_nao_fiscal REAL DEFAULT 0,
    estoque_atual REAL DEFAULT 0,
    controlar_validade INTEGER DEFAULT 0,
    unidade TEXT DEFAULT 'UN',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(db, `CREATE TABLE produtos_ajustes_estoque (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id INTEGER NOT NULL,
    usuario_id INTEGER,
    usuario_nome TEXT,
    motivo TEXT NOT NULL,
    ajuste_fiscal REAL DEFAULT 0,
    ajuste_nao_fiscal REAL DEFAULT 0,
    saldo_fiscal_antes REAL DEFAULT 0,
    saldo_fiscal_depois REAL DEFAULT 0,
    saldo_nao_fiscal_antes REAL DEFAULT 0,
    saldo_nao_fiscal_depois REAL DEFAULT 0,
    estoque_total_antes REAL DEFAULT 0,
    estoque_total_depois REAL DEFAULT 0,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

async function inserirProduto(db, { saldoFiscal = 0, saldoNaoFiscal = 0, controlarValidade = 0 } = {}) {
  const estoqueAtual = Number(saldoFiscal) + Number(saldoNaoFiscal);
  const r = await run(db, `INSERT INTO produtos (nome, saldo_fiscal, saldo_nao_fiscal, estoque_atual, controlar_validade)
    VALUES (?, ?, ?, ?, ?)`, ['Produto Teste', saldoFiscal, saldoNaoFiscal, estoqueAtual, controlarValidade]);
  return r.id;
}

async function obterSaldos(db, produtoId) {
  const p = await get(db, `SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual FROM produtos WHERE id = ?`, [produtoId]);
  return {
    saldo_fiscal: Number(p.saldo_fiscal),
    saldo_nao_fiscal: Number(p.saldo_nao_fiscal),
    estoque_atual: Number(p.estoque_atual)
  };
}

describe('RC3.20 — Cenário 1: Ajuste gerencial positivo', () => {
  let db;
  before(async () => {
    db = openMem();
    await schemaBase(db);
  });
  after(async () => { await close(db); });

  it('ajuste gerencial +10 não altera o saldo fiscal', async () => {
    const pid = await inserirProduto(db, { saldoFiscal: 0, saldoNaoFiscal: 249 });

    await aplicarAjuste(db, {
      produtoId: pid,
      ajusteFiscal: 0,
      ajusteNaoFiscal: 10,
      motivo: 'Ajuste gerencial positivo',
      usuarioId: 1,
      usuarioNome: 'admin'
    });

    const saldos = await obterSaldos(db, pid);
    assert.equal(saldos.saldo_nao_fiscal, 259);
    assert.equal(saldos.saldo_fiscal, 0);
    assert.equal(saldos.estoque_atual, 259);
  });
});

describe('RC3.20 — Cenário 2: Ajuste gerencial negativo', () => {
  let db;
  before(async () => {
    db = openMem();
    await schemaBase(db);
  });
  after(async () => { await close(db); });

  it('ajuste gerencial -10 não altera o saldo fiscal', async () => {
    const pid = await inserirProduto(db, { saldoFiscal: 0, saldoNaoFiscal: 249 });

    await aplicarAjuste(db, {
      produtoId: pid,
      ajusteFiscal: 0,
      ajusteNaoFiscal: -10,
      motivo: 'Ajuste gerencial negativo'
    });

    const saldos = await obterSaldos(db, pid);
    assert.equal(saldos.saldo_nao_fiscal, 239);
    assert.equal(saldos.saldo_fiscal, 0);
    assert.equal(saldos.estoque_atual, 239);
  });
});

describe('RC3.20 — Cenário 3: Ajuste fiscal não altera gerencial', () => {
  let db;
  before(async () => {
    db = openMem();
    await schemaBase(db);
  });
  after(async () => { await close(db); });

  it('ajuste fiscal +5 não altera o saldo gerencial', async () => {
    const pid = await inserirProduto(db, { saldoFiscal: 0, saldoNaoFiscal: 249 });

    await aplicarAjuste(db, {
      produtoId: pid,
      ajusteFiscal: 5,
      ajusteNaoFiscal: 0,
      motivo: 'Ajuste fiscal'
    });

    const saldos = await obterSaldos(db, pid);
    assert.equal(saldos.saldo_fiscal, 5);
    assert.equal(saldos.saldo_nao_fiscal, 249);
    assert.equal(saldos.estoque_atual, 254);
  });

  it('ajuste fiscal -5 não altera o saldo gerencial', async () => {
    const pid = await inserirProduto(db, { saldoFiscal: 10, saldoNaoFiscal: 249 });

    await aplicarAjuste(db, {
      produtoId: pid,
      ajusteFiscal: -5,
      ajusteNaoFiscal: 0,
      motivo: 'Ajuste fiscal negativo'
    });

    const saldos = await obterSaldos(db, pid);
    assert.equal(saldos.saldo_fiscal, 5);
    assert.equal(saldos.saldo_nao_fiscal, 249);
  });
});

describe('RC3.20 — Cenário 4: Saldo gerencial zero permite ajuste positivo', () => {
  let db;
  before(async () => {
    db = openMem();
    await schemaBase(db);
  });
  after(async () => { await close(db); });

  it('produto com saldo gerencial zero aceita ajuste positivo', async () => {
    const pid = await inserirProduto(db, { saldoFiscal: 0, saldoNaoFiscal: 0 });

    await aplicarAjuste(db, {
      produtoId: pid,
      ajusteFiscal: 0,
      ajusteNaoFiscal: 100,
      motivo: 'Entrada gerencial inicial'
    });

    const saldos = await obterSaldos(db, pid);
    assert.equal(saldos.saldo_nao_fiscal, 100);
    assert.equal(saldos.saldo_fiscal, 0);
  });
});

describe('RC3.20 — Cenário 5: Saldo negativo (política oficial)', () => {
  let db;
  before(async () => {
    db = openMem();
    await schemaBase(db);
  });
  after(async () => { await close(db); });

  it('ajuste gerencial que resultaria em negativo é rejeitado', async () => {
    const pid = await inserirProduto(db, { saldoFiscal: 0, saldoNaoFiscal: 5 });

    await assert.rejects(
      () => aplicarAjuste(db, {
        produtoId: pid,
        ajusteFiscal: 0,
        ajusteNaoFiscal: -10,
        motivo: 'Tentativa de saldo negativo'
      }),
      /não fiscal resultaria em saldo não fiscal negativo/
    );

    const saldos = await obterSaldos(db, pid);
    assert.equal(saldos.saldo_nao_fiscal, 5);
    assert.equal(saldos.saldo_fiscal, 0);
  });

  it('ajuste fiscal que resultaria em negativo é rejeitado', async () => {
    const pid = await inserirProduto(db, { saldoFiscal: 3, saldoNaoFiscal: 249 });

    await assert.rejects(
      () => aplicarAjuste(db, {
        produtoId: pid,
        ajusteFiscal: -10,
        ajusteNaoFiscal: 0,
        motivo: 'Tentativa de saldo fiscal negativo'
      }),
      /fiscal resultaria em saldo fiscal negativo/
    );
  });
});

describe('RC3.20 — Cenário 6: Motivo obrigatório', () => {
  let db;
  before(async () => {
    db = openMem();
    await schemaBase(db);
  });
  after(async () => { await close(db); });

  it('ajuste sem motivo é rejeitado', async () => {
    const pid = await inserirProduto(db, { saldoFiscal: 0, saldoNaoFiscal: 249 });

    await assert.rejects(
      () => aplicarAjuste(db, {
        produtoId: pid,
        ajusteFiscal: 0,
        ajusteNaoFiscal: 10,
        motivo: ''
      }),
      /Motivo do ajuste é obrigatório/
    );
  });

  it('ajuste com motivo em branco é rejeitado', async () => {
    const pid = await inserirProduto(db, { saldoFiscal: 0, saldoNaoFiscal: 249 });

    await assert.rejects(
      () => aplicarAjuste(db, {
        produtoId: pid,
        ajusteFiscal: 0,
        ajusteNaoFiscal: 10,
        motivo: '   '
      }),
      /Motivo do ajuste é obrigatório/
    );
  });
});

describe('RC3.20 — Cenário 7: Tipo de saldo inválido', () => {
  it('normalizarTipoSaldo rejeita tipo desconhecido', () => {
    assert.throws(
      () => normalizarTipoSaldo('QUALQUER_COISA'),
      /Tipo de saldo inválido/
    );
  });

  it('GERENCIAL mapeia para NAO_FISCAL', () => {
    assert.equal(normalizarTipoSaldo('GERENCIAL'), TipoSaldo.NAO_FISCAL);
    assert.equal(normalizarTipoSaldo('gerencial'), TipoSaldo.NAO_FISCAL);
    assert.equal(normalizarTipoSaldo('Saldo Gerencial'), TipoSaldo.NAO_FISCAL);
  });

  it('FISCAL permanece FISCAL', () => {
    assert.equal(normalizarTipoSaldo('FISCAL'), TipoSaldo.FISCAL);
    assert.equal(normalizarTipoSaldo('fiscal'), TipoSaldo.FISCAL);
  });

  it('aliases legados continuam funcionando', () => {
    assert.equal(normalizarTipoSaldo('NAO_FISCAL'), TipoSaldo.NAO_FISCAL);
    assert.equal(normalizarTipoSaldo('NF'), TipoSaldo.NAO_FISCAL);
  });
});

describe('RC3.20 — Cenário 8: Isolamento por produto', () => {
  let db;
  before(async () => {
    db = openMem();
    await schemaBase(db);
  });
  after(async () => { await close(db); });

  it('ajuste em um produto não altera o saldo de outro', async () => {
    const p1 = await inserirProduto(db, { saldoFiscal: 0, saldoNaoFiscal: 249 });
    const p2 = await inserirProduto(db, { saldoFiscal: 10, saldoNaoFiscal: 50 });

    await aplicarAjuste(db, {
      produtoId: p1,
      ajusteFiscal: 0,
      ajusteNaoFiscal: 10,
      motivo: 'Ajuste no produto 1'
    });

    const s1 = await obterSaldos(db, p1);
    const s2 = await obterSaldos(db, p2);

    assert.equal(s1.saldo_nao_fiscal, 259);
    assert.equal(s2.saldo_nao_fiscal, 50);
    assert.equal(s2.saldo_fiscal, 10);
  });
});

describe('RC3.20 — Cenário 9: Auditoria identifica o saldo ajustado', () => {
  let db;
  before(async () => {
    db = openMem();
    await schemaBase(db);
  });
  after(async () => { await close(db); });

  it('histórico registra ajuste_fiscal e ajuste_nao_fiscal separadamente', async () => {
    const pid = await inserirProduto(db, { saldoFiscal: 0, saldoNaoFiscal: 249 });

    await aplicarAjuste(db, {
      produtoId: pid,
      ajusteFiscal: 0,
      ajusteNaoFiscal: 10,
      motivo: 'Ajuste gerencial',
      usuarioId: 1,
      usuarioNome: 'admin'
    });

    const hist = await get(db, `SELECT * FROM produtos_ajustes_estoque WHERE produto_id = ? ORDER BY id DESC LIMIT 1`, [pid]);
    assert.equal(Number(hist.ajuste_nao_fiscal), 10);
    assert.equal(Number(hist.ajuste_fiscal), 0);
    assert.equal(Number(hist.saldo_nao_fiscal_antes), 249);
    assert.equal(Number(hist.saldo_nao_fiscal_depois), 259);
    assert.equal(Number(hist.saldo_fiscal_antes), 0);
    assert.equal(Number(hist.saldo_fiscal_depois), 0);
    assert.equal(hist.motivo, 'Ajuste gerencial');
    assert.equal(hist.usuario_nome, 'admin');
  });

  it('histórico de ajuste fiscal registra apenas o fiscal', async () => {
    const pid = await inserirProduto(db, { saldoFiscal: 0, saldoNaoFiscal: 249 });

    await aplicarAjuste(db, {
      produtoId: pid,
      ajusteFiscal: 7,
      ajusteNaoFiscal: 0,
      motivo: 'Ajuste fiscal',
      usuarioId: 1,
      usuarioNome: 'admin'
    });

    const hist = await get(db, `SELECT * FROM produtos_ajustes_estoque WHERE produto_id = ? ORDER BY id DESC LIMIT 1`, [pid]);
    assert.equal(Number(hist.ajuste_fiscal), 7);
    assert.equal(Number(hist.ajuste_nao_fiscal), 0);
    assert.equal(Number(hist.saldo_fiscal_depois), 7);
    assert.equal(Number(hist.saldo_nao_fiscal_depois), 249);
  });
});

describe('RC3.20 — Cenário 10: Regressão e compatibilidade', () => {
  it('ajuste simultâneo fiscal + gerencial continua suportado (contrato legado)', async () => {
    const db = openMem();
    await schemaBase(db);
    const pid = await inserirProduto(db, { saldoFiscal: 0, saldoNaoFiscal: 249 });

    await aplicarAjuste(db, {
      produtoId: pid,
      ajusteFiscal: 5,
      ajusteNaoFiscal: 10,
      motivo: 'Ajuste duplo legado'
    });

    const saldos = await obterSaldos(db, pid);
    assert.equal(saldos.saldo_fiscal, 5);
    assert.equal(saldos.saldo_nao_fiscal, 259);
    assert.equal(saldos.estoque_atual, 264);

    await close(db);
  });

  it('retorno da função inclui saldos atualizados', async () => {
    const db = openMem();
    await schemaBase(db);
    const pid = await inserirProduto(db, { saldoFiscal: 0, saldoNaoFiscal: 249 });

    const resultado = await aplicarAjuste(db, {
      produtoId: pid,
      ajusteFiscal: 0,
      ajusteNaoFiscal: 10,
      motivo: 'Verificar retorno'
    });

    assert.equal(Number(resultado.saldo_nao_fiscal), 259);
    assert.equal(Number(resultado.saldo_fiscal), 0);
    assert.equal(Number(resultado.estoque_atual), 259);

    await close(db);
  });

  it('estoque_atual é sempre a soma dos dois saldos', async () => {
    const db = openMem();
    await schemaBase(db);
    const pid = await inserirProduto(db, { saldoFiscal: 3, saldoNaoFiscal: 7 });

    await aplicarAjuste(db, {
      produtoId: pid,
      ajusteFiscal: 2,
      ajusteNaoFiscal: 0,
      motivo: 'Atualizar fiscal'
    });

    const saldos = await obterSaldos(db, pid);
    assert.equal(saldos.estoque_atual, saldos.saldo_fiscal + saldos.saldo_nao_fiscal);
    assert.equal(saldos.estoque_atual, 12);

    await close(db);
  });
});
