/**
 * Sprint 7.1.X — reconciliação no Fechamento V2.
 * node --test tests/caixa/sprint71x-reconciliacao-fechamento.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const Rec = require('../../backend/services/caixa/ReconciliacaoVendaCaixa');
const { calcularConferenciaFisica, validarConferenciaERetirada } = require('../../backend/services/caixa/FechamentoCaixaPolitica');
const Svc = require('../../backend/services/caixa/FechamentoCaixaResumoService');

const UI_PATH = path.join(__dirname, '../../frontend/shared/js/fechamentoCaixaV2Ui.js');
const ROTA_PATH = path.join(__dirname, '../../backend/rotas/caixa.js');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function cb(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

async function criarDb() {
  const db = await new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(conn)));
  });
  await run(db, `CREATE TABLE caixa (id INTEGER PRIMARY KEY, data TEXT, valor_inicial REAL, status TEXT, aberto_em TEXT)`);
  await run(db, `CREATE TABLE caixa_sessoes (id INTEGER PRIMARY KEY, caixa_turno_id INTEGER, status TEXT, valor_abertura REAL)`);
  await run(db, `CREATE TABLE caixa_movimentacoes (id INTEGER PRIMARY KEY, caixa_id INTEGER, sessao_id INTEGER, tipo TEXT, valor REAL)`);
  await run(db, `CREATE TABLE caixa_fechamentos (id INTEGER PRIMARY KEY, sessao_id INTEGER, caixa_id INTEGER, total_informado REAL)`);
  await run(db, `CREATE TABLE vendas (
    id INTEGER PRIMARY KEY, codigo TEXT, total REAL, desconto REAL DEFAULT 0, forma_pagamento TEXT,
    status TEXT, status_venda TEXT, cancelada INTEGER DEFAULT 0, tipo_venda TEXT,
    prestacao_realizada INTEGER DEFAULT 0, pagamento_previsto TEXT,
    valor_fiscal REAL DEFAULT 0, valor_nao_fiscal REAL DEFAULT 0, status_pagamento TEXT, caixa_sessao_id INTEGER
  )`);
  await run(db, `CREATE TABLE venda_pagamentos (id INTEGER PRIMARY KEY, venda_id INTEGER, forma_pagamento TEXT, valor REAL, tef_transacao_id INTEGER, tef_nsu TEXT, tef_autorizacao TEXT)`);
  await run(db, `CREATE TABLE venda_recebimentos (id INTEGER PRIMARY KEY, venda_id INTEGER, tipo_recebimento TEXT, forma_pagamento TEXT, valor REAL, tef_transacao_id INTEGER, nsu TEXT, autorizacao TEXT, status TEXT DEFAULT 'aprovado')`);
  return db;
}

async function seed(db, inicial = 0) {
  const c = await run(db, `INSERT INTO caixa (data, valor_inicial, status, aberto_em) VALUES ('2026-09-23', ?, 'aberto', '2026-09-23 00:24:00')`, [inicial]);
  const s = await run(db, `INSERT INTO caixa_sessoes (caixa_turno_id, status, valor_abertura) VALUES (?, 'aberto', ?)`, [c.lastID, inicial]);
  const caixa = await get(db, `SELECT * FROM caixa WHERE id = ?`, [c.lastID]);
  return { caixa, sessaoId: s.lastID };
}

async function venda(db, sessaoId, dados, recs = []) {
  const ins = await run(db, `
    INSERT INTO vendas (codigo, total, desconto, forma_pagamento, status, cancelada, tipo_venda,
      prestacao_realizada, valor_fiscal, valor_nao_fiscal, status_pagamento, caixa_sessao_id)
    VALUES (?, ?, 0, ?, 'concluida', 0, 'BALCAO', 0, ?, ?, ?, ?)
  `, [
    dados.codigo || null,
    dados.total,
    dados.forma_pagamento || 'dinheiro',
    dados.valor_fiscal != null ? dados.valor_fiscal : dados.total,
    dados.valor_nao_fiscal || 0,
    dados.status_pagamento || 'quitada',
    sessaoId
  ]);
  for (const r of recs) {
    await run(db, `INSERT INTO venda_recebimentos (venda_id, tipo_recebimento, forma_pagamento, valor, status) VALUES (?, ?, ?, ?, ?)`,
      [ins.lastID, r.tipo_recebimento || 'fiscal', r.forma_pagamento || 'dinheiro', r.valor, r.status || 'aprovado']);
  }
  return ins.lastID;
}

const FOTO = [
  { id: 8, total: 239.52, fiscalNf: 239.54, div: 0.02 },
  { id: 9, total: 23.95, fiscalNf: 23.99, div: 0.04 },
  { id: 10, total: 49.84, fiscalNf: 49.75, div: -0.09 },
  { id: 11, total: 198.16, fiscalNf: 198.12, div: -0.04 }
];

function recFoto(item) {
  return Rec.reconciliarVenda(
    {
      id: item.id,
      total: item.total,
      valor_fiscal: item.fiscalNf,
      valor_nao_fiscal: 0,
      status_pagamento: 'quitada'
    },
    [],
    [{ tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: item.total, status: 'aprovado' }]
  );
}

function loadUi() {
  const sandbox = { module: { exports: {} } };
  sandbox.global = sandbox;
  sandbox.window = sandbox;
  const code = fs.readFileSync(UI_PATH, 'utf8');
  const fn = new Function('window', 'global', 'module', 'exports', code + '\nreturn module.exports || window.FechamentoCaixaV2Ui;');
  return fn(sandbox, sandbox, sandbox.module, sandbox.module.exports);
}

describe('Sprint 7.1.X — bloqueio e divergência', () => {
  it('TESTE 1 — dinheiro bate e zero inconsistências: pode fechar', async () => {
    const db = await criarDb();
    const { caixa, sessaoId } = await seed(db, 50);
    await venda(db, sessaoId, { total: 10, valor_fiscal: 10, forma_pagamento: 'dinheiro' }, [
      { forma_pagamento: 'dinheiro', valor: 10 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db, valorInformado: 60 });
    assert.equal(c.caixa_fisico.conferencia_ok, true);
    assert.equal(c.reconciliacao.quantidade_inconsistencias, 0);
    assert.equal(Svc.validarConsolidacaoOuErro(c), null);
    const fisico = validarConferenciaERetirada(c.caixa_fisico, { user: { perfil: 'OPERADOR' } });
    assert.equal(fisico.ok, true);
    db.close();
  });

  it('TESTE 2 — dinheiro não bate e zero inconsistências: operador bloqueado', async () => {
    const db = await criarDb();
    const { caixa, sessaoId } = await seed(db, 50);
    await venda(db, sessaoId, { total: 10, valor_fiscal: 10, forma_pagamento: 'dinheiro' }, [
      { forma_pagamento: 'dinheiro', valor: 10 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db, valorInformado: 40 });
    assert.equal(Svc.validarConsolidacaoOuErro(c), null);
    const fisico = validarConferenciaERetirada(c.caixa_fisico, { user: { perfil: 'OPERADOR' } });
    assert.equal(fisico.ok, false);
    assert.equal(fisico.bloqueio, 'CONFERENCIA_FISICA');
    db.close();
  });

  it('TESTE 3 — dinheiro bate e existem inconsistências: operador bloqueado', async () => {
    const db = await criarDb();
    const { caixa, sessaoId } = await seed(db, 750);
    await venda(db, sessaoId, { total: 239.52, valor_fiscal: 239.54, forma_pagamento: 'pix' }, [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 239.52 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db, valorInformado: 750 });
    assert.equal(c.caixa_fisico.conferencia_ok, true);
    const err = Svc.validarConsolidacaoOuErro(c);
    assert.ok(err);
    assert.equal(err.codigo, 'FECHAMENTO_BLOQUEADO_RECONCILIACAO');
    assert.ok(err.quantidade_inconsistencias >= 1);
    db.close();
  });

  it('TESTE 4 — dinheiro não bate e existem inconsistências: operador bloqueado', async () => {
    const db = await criarDb();
    const { caixa, sessaoId } = await seed(db, 750);
    await venda(db, sessaoId, { total: 239.52, valor_fiscal: 239.54, forma_pagamento: 'pix' }, [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 239.52 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db, valorInformado: 700 });
    const err = Svc.validarConsolidacaoOuErro(c);
    assert.ok(err);
    assert.equal(err.codigo, 'FECHAMENTO_BLOQUEADO_RECONCILIACAO');
    const fisico = validarConferenciaERetirada(c.caixa_fisico, { user: { perfil: 'OPERADOR' } });
    assert.equal(fisico.ok, false);
    db.close();
  });

  it('TESTE 5 — venda parcial não bloqueia', () => {
    const r = Rec.reconciliarVenda(
      { id: 2, total: 100, valor_fiscal: 70, valor_nao_fiscal: 30, status_pagamento: 'aguardando_nao_fiscal' },
      [{ forma_pagamento: 'pix', valor: 70 }],
      [{ tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 70, status: 'aprovado' }]
    );
    assert.equal(r.status_reconciliacao, 'PARCIALMENTE_RECEBIDA');
    assert.equal(Rec.bloqueiaFechamento(r), false);
    assert.equal(Rec.montarErroBloqueioReconciliacao([r]), null);
  });

  it('TESTE 6 — venda pendente não bloqueia', () => {
    const r = Rec.reconciliarVenda(
      { id: 3, total: 80, valor_fiscal: 80, valor_nao_fiscal: 0, forma_pagamento: 'prazo' },
      [],
      []
    );
    assert.equal(r.status_reconciliacao, 'PENDENTE');
    assert.equal(Rec.bloqueiaFechamento(r), false);
    assert.equal(Rec.montarErroBloqueioReconciliacao([r]), null);
  });

  it('TESTE 7 — admin autorizado com divergência física segue política atual', () => {
    const f = calcularConferenciaFisica({
      saldoInicial: 100,
      recebimentosDinheiro: 400,
      suprimentos: 0,
      sangriasOperacionais: 0,
      dinheiroConferido: 520,
      modoRetirada: 'nenhuma'
    });
    const operador = validarConferenciaERetirada(f, { user: { perfil: 'OPERADOR' } });
    assert.equal(operador.ok, false);
    const admin = validarConferenciaERetirada(f, {
      fecharComDivergencia: true,
      justificativa: 'sobra conferida',
      user: { perfil: 'ADMIN' }
    });
    assert.equal(admin.ok, true);
    const comInconsistencia = Rec.montarErroBloqueioReconciliacao([recFoto(FOTO[0])]);
    assert.ok(comInconsistencia);
    assert.equal(comInconsistencia.codigo, 'FECHAMENTO_BLOQUEADO_RECONCILIACAO');
  });

  it('TESTE 8 — mostra divergência individual', () => {
    const linhas = FOTO.map(recFoto);
    linhas.forEach((r, i) => {
      assert.equal(r.status_reconciliacao, 'INCONSISTENTE');
      assert.equal(r.divergencia, FOTO[i].div);
      assert.equal(r.fiscal_mais_nao_fiscal, FOTO[i].fiscalNf);
      assert.equal(r.total_oficial, FOTO[i].total);
    });
  });

  it('TESTE 9 — mostra total da divergência e saldo líquido', () => {
    const linhas = FOTO.map(recFoto);
    const resumo = Rec.resumirInconsistencias(linhas);
    assert.equal(resumo.quantidade_inconsistencias, 4);
    assert.equal(resumo.valor_divergencia, 0.07);
    assert.equal(resumo.saldo_liquido, -0.07);
    assert.deepEqual(resumo.detalhes.map((d) => d.divergencia), [0.02, 0.04, -0.09, -0.04]);
  });

  it('TESTE 10 — backend bloqueia mesmo se o frontend for contornado', async () => {
    const db = await criarDb();
    const { caixa, sessaoId } = await seed(db, 0);
    for (const item of FOTO) {
      await venda(db, sessaoId, {
        codigo: String(item.id),
        total: item.total,
        valor_fiscal: item.fiscalNf,
        valor_nao_fiscal: 0,
        forma_pagamento: 'pix'
      }, [{ tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: item.total }]);
    }
    await new Promise((resolve, reject) => {
      Svc.calcularFechamentoDetalhado(caixa, {
        sessaoId,
        db,
        valorInformado: 0,
        dinheiroConferido: 0,
        modoRetirada: 'nenhuma',
        validar: true
      }, (err) => {
        try {
          assert.ok(err);
          assert.equal(err.codigo, 'FECHAMENTO_BLOQUEADO_RECONCILIACAO');
          assert.equal(err.quantidade_inconsistencias, 4);
          assert.equal(err.valor_divergencia, 0.07);
          assert.equal(err.saldo_liquido, -0.07);
          assert.equal(err.detalhes.length, 4);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
    const rota = fs.readFileSync(ROTA_PATH, 'utf8');
    assert.match(rota, /FECHAMENTO_BLOQUEADO_RECONCILIACAO/);
    assert.match(rota, /validarConsolidacaoOuErro/);
    db.close();
  });

  it('caso da foto — 4 inconsistências, totais e UI', () => {
    const linhas = FOTO.map(recFoto);
    const resumo = Rec.resumirInconsistencias(linhas);
    assert.equal(resumo.quantidade_inconsistencias, 4);
    assert.equal(resumo.valor_divergencia, 0.07);
    assert.equal(resumo.saldo_liquido, -0.07);

    const Ui = loadUi();
    const html = Ui.montarHtmlTelaAberta({
      caixa: { id: 1, data: '2026-09-23', aberto_em: '2026-09-23 00:24:00' },
      dinheiro: { dinheiro_esperado: 750, valor_inicial: 750, vendas_dinheiro: 0, suprimentos: 0, sangrias: 0 },
      digital: { pix: 511.47, cartao_credito: 0, cartao_debito: 0, total_digital: 511.47 },
      total_vendido: 511.47,
      total_recebido: 511.47,
      consolidacao: {
        caixa_fisico: { dinheiro_esperado: 750 },
        reconciliacao: {
          vendas_ok: 0,
          vendas_parciais: 0,
          vendas_pendentes: 0,
          vendas_inconsistentes: 4,
          vendas: linhas
        }
      }
    });
    assert.match(html, /4 venda\(s\) inconsistente/);
    assert.match(html, /Fiscal \+ NF/);
    assert.match(html, /Divergência/);
    assert.match(html, /#8/);
    assert.match(html, /#11/);
    assert.match(html, /\+R\$\s*0,02|\+R\$&nbsp;0,02|\+R\$ 0,02/);
    assert.match(html, /O fechamento com esta divergência exige autorização/);
    const tot = Ui.resumirInconsistenciasUi(linhas);
    assert.equal(tot.quantidade, 4);
    assert.equal(tot.valorDivergencia, 0.07);
    assert.equal(tot.saldoLiquido, -0.07);
    assert.equal(Ui.formatarDivergencia(0.02).includes('0,02'), true);
  });

  it('EXCEDENTE continua bloqueando; parcial e pendente não', () => {
    const exc = Rec.reconciliarVenda(
      { id: 5, total: 100, valor_fiscal: 100, valor_nao_fiscal: 0 },
      [],
      [{ tipo_recebimento: 'fiscal', forma_pagamento: 'dinheiro', valor: 101, status: 'aprovado' }]
    );
    assert.equal(exc.status_reconciliacao, 'EXCEDENTE');
    assert.equal(Rec.bloqueiaFechamento(exc), true);
  });
});
