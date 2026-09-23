/**
 * Fechamento de Caixa V2 — reconciliação, parcial, preço manual, retirada.
 * node --test tests/caixa/fechamento-caixa-v2.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '../..');
const { parseMoedaBr, arred2, quaseIgual } = require('../../backend/services/financeiro/politicaMonetaria');
const Rec = require('../../backend/services/caixa/ReconciliacaoVendaCaixa');
const { validarIdentidadeFinanceiraVenda } = require('../../backend/services/caixa/ValidacaoIdentidadeVenda');
const { calcularConferenciaFisica, validarConferenciaERetirada } = require('../../backend/services/caixa/FechamentoCaixaPolitica');
const Svc = require('../../backend/services/caixa/FechamentoCaixaResumoService');
const { diagnosticarFechamentos, aplicarIndiceUnicoSeSeguro } = require('../../backend/services/caixa/FechamentoCaixaMigracao');
const { gerarHtmlCupomFechamento } = require('../../backend/services/caixa/FechamentoCaixaCupomService');

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
  await run(db, `CREATE TABLE caixa_fechamentos (id INTEGER PRIMARY KEY, sessao_id INTEGER, caixa_id INTEGER, total_informado REAL, resumo_json TEXT)`);
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

async function seed(db, inicial = 100) {
  const c = await run(db, `INSERT INTO caixa (data, valor_inicial, status, aberto_em) VALUES ('2026-09-22', ?, 'aberto', '2026-09-22 08:00:00')`, [inicial]);
  const s = await run(db, `INSERT INTO caixa_sessoes (caixa_turno_id, status, valor_abertura) VALUES (?, 'aberto', ?)`, [c.lastID, inicial]);
  const caixa = await get(db, `SELECT * FROM caixa WHERE id = ?`, [c.lastID]);
  return { caixa, sessaoId: s.lastID, caixaId: c.lastID };
}

async function venda(db, sessaoId, dados, pags = [], recs = []) {
  const ins = await run(db, `
    INSERT INTO vendas (codigo, total, desconto, forma_pagamento, status, status_venda, cancelada, tipo_venda,
      prestacao_realizada, pagamento_previsto, valor_fiscal, valor_nao_fiscal, status_pagamento, caixa_sessao_id)
    VALUES (?, ?, ?, ?, 'concluida', NULL, 0, ?, 0, ?, ?, ?, ?, ?)
  `, [
    dados.codigo || null,
    dados.total,
    dados.desconto || 0,
    dados.forma_pagamento || 'dinheiro',
    dados.tipo_venda || 'BALCAO',
    dados.pagamento_previsto || null,
    dados.valor_fiscal != null ? dados.valor_fiscal : dados.total,
    dados.valor_nao_fiscal || 0,
    dados.status_pagamento || null,
    sessaoId
  ]);
  for (const p of pags) {
    await run(db, `INSERT INTO venda_pagamentos (venda_id, forma_pagamento, valor) VALUES (?, ?, ?)`, [ins.lastID, p.forma_pagamento, p.valor]);
  }
  for (const r of recs) {
    await run(db, `INSERT INTO venda_recebimentos (venda_id, tipo_recebimento, forma_pagamento, valor, status) VALUES (?, ?, ?, ?, ?)`,
      [ins.lastID, r.tipo_recebimento, r.forma_pagamento, r.valor, r.status || 'aprovado']);
  }
  return ins.lastID;
}

describe('política monetária', () => {
  it('parseia padrões brasileiros sem corromper 5,00', () => {
    assert.equal(parseMoedaBr('5'), 5);
    assert.equal(parseMoedaBr('5.5'), 5.5);
    assert.equal(parseMoedaBr('5.50'), 5.5);
    assert.equal(parseMoedaBr('5,5'), 5.5);
    assert.equal(parseMoedaBr('5,50'), 5.5);
    assert.equal(parseMoedaBr('5,00'), 5);
    assert.equal(parseMoedaBr('5.00'), 5);
    assert.equal(parseMoedaBr('1.234,56'), 1234.56);
    assert.equal(parseMoedaBr('1234,56'), 1234.56);
    assert.ok(quaseIgual(parseMoedaBr('7,50'), 7.5));
  });

  it('centavos oficiais 0,01 a 1000,01', () => {
    [0.01, 0.02, 0.03, 0.05, 0.1, 0.99, 1.01, 9.99, 10.01, 100, 1000.01].forEach((v) => {
      assert.ok(quaseIgual(arred2(v), v) || Math.abs(arred2(v) - v) < 0.001);
    });
  });
});

describe('reconciliação por venda', () => {
  it('A venda normal quitada é OK', () => {
    const r = Rec.reconciliarVenda(
      { id: 1, total: 100, valor_fiscal: 100, valor_nao_fiscal: 0, status_pagamento: 'quitada' },
      [{ forma_pagamento: 'dinheiro', valor: 100 }],
      [{ tipo_recebimento: 'fiscal', forma_pagamento: 'dinheiro', valor: 100, status: 'aprovado' }]
    );
    assert.equal(r.status_reconciliacao, 'OK');
    assert.equal(r.recebido_total, 100);
    assert.equal(r.pendente_total, 0);
  });

  it('H parcial fiscal 70 + NF 30 recebido 70 não é inconsistência', () => {
    const r = Rec.reconciliarVenda(
      { id: 2, total: 100, valor_fiscal: 70, valor_nao_fiscal: 30, status_pagamento: 'aguardando_nao_fiscal' },
      [{ forma_pagamento: 'pix', valor: 70 }],
      [{ tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 70, status: 'aprovado' }]
    );
    assert.equal(r.status_reconciliacao, 'PARCIALMENTE_RECEBIDA');
    assert.equal(r.recebido_total, 70);
    assert.equal(r.pendente_total, 30);
    assert.equal(Rec.bloqueiaFechamento(r), false);
  });

  it('I prazo sem recebimento fica PENDENTE recebido 0', () => {
    const r = Rec.reconciliarVenda(
      { id: 3, total: 80, valor_fiscal: 80, valor_nao_fiscal: 0, forma_pagamento: 'prazo' },
      [{ forma_pagamento: 'prazo', valor: 80 }],
      []
    );
    assert.equal(r.recebido_total, 0);
    assert.equal(r.pendente_total, 80);
    assert.equal(r.status_reconciliacao, 'PENDENTE');
    assert.equal(Rec.bloqueiaFechamento(r), false);
  });

  it('J quitada com recebimento incompleto é INCONSISTENTE', () => {
    const r = Rec.reconciliarVenda(
      { id: 4, total: 100, valor_fiscal: 100, valor_nao_fiscal: 0, status_pagamento: 'quitada' },
      [],
      [{ tipo_recebimento: 'fiscal', forma_pagamento: 'dinheiro', valor: 98, status: 'aprovado' }]
    );
    assert.equal(r.status_reconciliacao, 'INCONSISTENTE');
    assert.equal(Rec.bloqueiaFechamento(r), true);
  });

  it('K excedente bloqueia', () => {
    const r = Rec.reconciliarVenda(
      { id: 5, total: 100, valor_fiscal: 100, valor_nao_fiscal: 0 },
      [],
      [{ tipo_recebimento: 'fiscal', forma_pagamento: 'dinheiro', valor: 101, status: 'aprovado' }]
    );
    assert.equal(r.status_reconciliacao, 'EXCEDENTE');
    assert.equal(Rec.bloqueiaFechamento(r), true);
  });

  it('L identidade fiscal inválida', () => {
    const r = Rec.reconciliarVenda(
      { id: 6, total: 100, valor_fiscal: 69.99, valor_nao_fiscal: 30 },
      [],
      [{ tipo_recebimento: 'fiscal', forma_pagamento: 'dinheiro', valor: 100, status: 'aprovado' }]
    );
    assert.equal(r.status_reconciliacao, 'INCONSISTENTE');
    assert.match(r.mensagem, /fiscal\/não fiscal/i);
  });
});

describe('identidade da venda / preço manual', () => {
  it('B/C preço manual 7,50 x 2 = 15', () => {
    const v = validarIdentidadeFinanceiraVenda({
      total: 15,
      valorFiscal: 15,
      valorNaoFiscal: 0,
      itens: [{ quantidade: 2, preco_unitario: '7,50' }],
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 15 }],
      statusPagamento: 'quitada'
    });
    assert.equal(v.ok, true);
  });

  it('preço manual + fiscal/não fiscal 9+6', () => {
    const v = validarIdentidadeFinanceiraVenda({
      total: 15,
      valorFiscal: 9,
      valorNaoFiscal: 6,
      itens: [{ quantidade: 2, preco_unitario: 7.5 }],
      pagamentos: [
        { forma_pagamento: 'pix', valor: 9 },
        { forma_pagamento: 'dinheiro', valor: 6 }
      ],
      statusPagamento: 'quitada'
    });
    assert.equal(v.ok, true);
  });

  it('rejeita total != fiscal+nf', () => {
    const v = validarIdentidadeFinanceiraVenda({
      total: 15,
      valorFiscal: 9,
      valorNaoFiscal: 5,
      itens: [{ quantidade: 2, preco_unitario: 7.5 }]
    });
    assert.equal(v.ok, false);
    assert.match(v.erro, /fiscal\/não fiscal/);
  });
});

describe('conferência e retirada', () => {
  it('U retirada total deixa saldo 0', () => {
    const f = calcularConferenciaFisica({
      saldoInicial: 100,
      recebimentosDinheiro: 400,
      suprimentos: 0,
      sangriasOperacionais: 0,
      dinheiroConferido: 500,
      modoRetirada: 'total'
    });
    assert.equal(f.dinheiro_esperado, 500);
    assert.equal(f.diferenca, 0);
    assert.equal(f.retirada_fechamento, 500);
    assert.equal(f.saldo_final, 0);
  });

  it('V retirada parcial 300 deixa 200', () => {
    const f = calcularConferenciaFisica({
      saldoInicial: 100,
      recebimentosDinheiro: 400,
      suprimentos: 0,
      sangriasOperacionais: 0,
      dinheiroConferido: 500,
      retiradaFechamento: 300,
      modoRetirada: 'valor'
    });
    assert.equal(f.saldo_final, 200);
  });

  it('W sem retirada deixa 500', () => {
    const f = calcularConferenciaFisica({
      saldoInicial: 100,
      recebimentosDinheiro: 400,
      suprimentos: 0,
      sangriasOperacionais: 0,
      dinheiroConferido: 500,
      modoRetirada: 'nenhuma'
    });
    assert.equal(f.retirada_fechamento, 0);
    assert.equal(f.saldo_final, 500);
  });

  it('X diferença negativa bloqueia operador', () => {
    const f = calcularConferenciaFisica({
      saldoInicial: 100, recebimentosDinheiro: 400, suprimentos: 0, sangriasOperacionais: 0,
      dinheiroConferido: 450, modoRetirada: 'nenhuma'
    });
    const v = validarConferenciaERetirada(f, { user: { perfil: 'OPERADOR' } });
    assert.equal(v.ok, false);
    assert.equal(v.bloqueio, 'CONFERENCIA_FISICA');
  });

  it('Y sobra + admin com justificativa permite', () => {
    const f = calcularConferenciaFisica({
      saldoInicial: 100, recebimentosDinheiro: 400, suprimentos: 0, sangriasOperacionais: 0,
      dinheiroConferido: 520, modoRetirada: 'nenhuma'
    });
    const v = validarConferenciaERetirada(f, {
      fecharComDivergencia: true,
      justificativa: 'sobra conferida',
      user: { perfil: 'ADMIN' }
    });
    assert.equal(v.ok, true);
    assert.equal(f.diferenca, 20);
  });

  it('retirada > conferido é inválida', () => {
    const f = calcularConferenciaFisica({
      saldoInicial: 0, recebimentosDinheiro: 100, suprimentos: 0, sangriasOperacionais: 0,
      dinheiroConferido: 100, retiradaFechamento: 150, modoRetirada: 'valor'
    });
    const v = validarConferenciaERetirada(f, { user: { perfil: 'ADMIN' } });
    assert.equal(v.ok, false);
  });
});

describe('consolidação da sessão — bug original e V2', () => {
  it('problema original: parcial 70/30 não gera pagamento_vs_venda', async () => {
    const db = await criarDb();
    const { caixa, sessaoId } = await seed(db, 0);
    await venda(db, sessaoId, {
      total: 100, valor_fiscal: 70, valor_nao_fiscal: 30, forma_pagamento: 'misto',
      status_pagamento: 'aguardando_nao_fiscal'
    }, [{ forma_pagamento: 'pix', valor: 70 }], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 70 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    assert.equal(c.totais.vendido, 100);
    assert.equal(c.totais.recebido, 70);
    assert.equal(c.totais.pendente, 30);
    assert.equal(c.pagamentos.pix, 70);
    assert.equal(c.validacao.ok, true);
    assert.equal(Svc.validarConsolidacaoOuErro(c), null);
    db.close();
  });

  it('preço manual 7,50 x 2 fecha sem divergência', async () => {
    const db = await criarDb();
    const { caixa, sessaoId } = await seed(db, 0);
    await venda(db, sessaoId, {
      total: 15, valor_fiscal: 15, valor_nao_fiscal: 0, forma_pagamento: 'dinheiro', status_pagamento: 'quitada'
    }, [], [{ tipo_recebimento: 'fiscal', forma_pagamento: 'dinheiro', valor: 15 }]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    assert.equal(c.totais.vendido, 15);
    assert.equal(c.totais.recebido, 15);
    assert.equal(c.validacao.ok, true);
    db.close();
  });

  it('preço manual fiscal/não fiscal 9+6', async () => {
    const db = await criarDb();
    const { caixa, sessaoId } = await seed(db, 0);
    await venda(db, sessaoId, {
      total: 15, valor_fiscal: 9, valor_nao_fiscal: 6, forma_pagamento: 'misto', status_pagamento: 'quitada'
    }, [], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 9 },
      { tipo_recebimento: 'nao_fiscal', forma_pagamento: 'dinheiro', valor: 6 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    assert.equal(c.totais.vendido, 15);
    assert.equal(c.totais.recebido, 15);
    assert.equal(c.pagamentos.pix, 9);
    assert.equal(c.pagamentos.dinheiro, 6);
    assert.equal(c.validacao.ok, true);
    db.close();
  });

  it('dinheiro físico ignora PIX', async () => {
    const db = await criarDb();
    const { caixa, sessaoId } = await seed(db, 100);
    await venda(db, sessaoId, { total: 50, valor_fiscal: 50, forma_pagamento: 'pix' }, [], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 50 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db, valorInformado: 100 });
    assert.equal(c.caixa_fisico.recebimentos_dinheiro, 0);
    assert.equal(c.caixa_fisico.dinheiro_esperado, 100);
    assert.equal(c.totais.recebido, 50);
    db.close();
  });

  it('retirada total no consolidado', async () => {
    const db = await criarDb();
    const { caixa, sessaoId } = await seed(db, 100);
    await venda(db, sessaoId, { total: 400, valor_fiscal: 400, forma_pagamento: 'dinheiro' }, [], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'dinheiro', valor: 400 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, {
      sessaoId, db, valorInformado: 500, modoRetirada: 'total'
    });
    assert.equal(c.caixa_fisico.dinheiro_esperado, 500);
    assert.equal(c.caixa_fisico.retirada_fechamento, 500);
    assert.equal(c.caixa_fisico.saldo_final, 0);
    db.close();
  });
});

describe('migração / duplicidade', () => {
  it('Z diagnostica fechamento duplicado e não cria índice', async () => {
    const db = await criarDb();
    await run(db, `INSERT INTO caixa_fechamentos (sessao_id, caixa_id, total_informado) VALUES (9, 1, 10)`);
    await run(db, `INSERT INTO caixa_fechamentos (sessao_id, caixa_id, total_informado) VALUES (9, 1, 11)`);
    const diag = await diagnosticarFechamentos(db);
    assert.equal(diag.pode_criar_indice_unico, false);
    assert.ok(diag.duplicados.length >= 1);
    db.close();
  });
});

describe('fonte / UI / snapshot', () => {
  it('serviço e UI V2 existem no código', () => {
    const resumo = fs.readFileSync(path.join(ROOT, 'backend/services/caixa/FechamentoCaixaResumoService.js'), 'utf8');
    assert.match(resumo, /total_vendido/);
    assert.match(resumo, /caixa_fisico/);
    assert.match(resumo, /PARCIALMENTE_RECEBIDA/);
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/fechamentoCaixaV2Ui.js'), 'utf8');
    assert.match(ui, /Retirar tudo/);
    assert.match(ui, /fechar_com_divergencia/);
    const rota = fs.readFileSync(path.join(ROOT, 'backend/rotas/caixa.js'), 'utf8');
    assert.match(rota, /retirada_fechamento/);
    assert.match(rota, /saldoFinal/);
    assert.match(rota, /idx_caixa_fechamentos_sessao/);
    assert.match(rota, /fechamento_bloqueado/);
    const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
    assert.match(pdv, /CdsPoliticaMonetaria/);
  });
});

describe('formas, sangria, suprimento e preço manual', () => {
  it('D venda fiscal integral é OK', async () => {
    const db = await criarDb();
    const { caixa, sessaoId } = await seed(db, 0);
    await venda(db, sessaoId, { total: 40, valor_fiscal: 40, valor_nao_fiscal: 0, forma_pagamento: 'dinheiro', status_pagamento: 'quitada' }, [], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'dinheiro', valor: 40 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    assert.equal(c.totais.vendido, 40);
    assert.equal(c.totais.recebido, 40);
    assert.equal(c.totais.pendente, 0);
    assert.equal(c.validacao.ok, true);
    db.close();
  });

  it('E venda não fiscal integral é OK', async () => {
    const db = await criarDb();
    const { caixa, sessaoId } = await seed(db, 0);
    await venda(db, sessaoId, { total: 25, valor_fiscal: 0, valor_nao_fiscal: 25, forma_pagamento: 'pix', status_pagamento: 'quitada' }, [], [
      { tipo_recebimento: 'nao_fiscal', forma_pagamento: 'pix', valor: 25 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    assert.equal(c.totais.recebido, 25);
    assert.equal(c.pagamentos.pix, 25);
    assert.equal(c.validacao.ok, true);
    db.close();
  });

  it('F/G fiscal + não fiscal quitada', async () => {
    const db = await criarDb();
    const { caixa, sessaoId } = await seed(db, 0);
    await venda(db, sessaoId, { total: 100, valor_fiscal: 70, valor_nao_fiscal: 30, status_pagamento: 'quitada' }, [], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 70 },
      { tipo_recebimento: 'nao_fiscal', forma_pagamento: 'dinheiro', valor: 30 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    assert.equal(c.totais.vendido, 100);
    assert.equal(c.totais.recebido, 100);
    assert.equal(c.reconciliacao.vendas_ok, 1);
    db.close();
  });

  it('M-R dinheiro, PIX, débito, crédito, TEF e misto', async () => {
    const db = await criarDb();
    const { caixa, sessaoId } = await seed(db, 0);
    await venda(db, sessaoId, { codigo: 'M', total: 10, valor_fiscal: 10, forma_pagamento: 'dinheiro' }, [], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'dinheiro', valor: 10 }
    ]);
    await venda(db, sessaoId, { codigo: 'PIX', total: 20, valor_fiscal: 20, forma_pagamento: 'pix' }, [], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 20 }
    ]);
    await venda(db, sessaoId, { codigo: 'DEB', total: 30, valor_fiscal: 30, forma_pagamento: 'debito' }, [], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'debito', valor: 30 }
    ]);
    await venda(db, sessaoId, { codigo: 'CRE', total: 40, valor_fiscal: 40, forma_pagamento: 'credito' }, [], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'credito', valor: 40 }
    ]);
    await venda(db, sessaoId, { codigo: 'TEF', total: 50, valor_fiscal: 50, forma_pagamento: 'tef' }, [], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'tef', valor: 50 }
    ]);
    await venda(db, sessaoId, { codigo: 'MIX', total: 15, valor_fiscal: 15, forma_pagamento: 'misto' }, [], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'dinheiro', valor: 5 },
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 10 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    assert.equal(c.pagamentos.dinheiro, 15);
    assert.equal(c.pagamentos.pix, 30);
    assert.equal(c.pagamentos.debito, 30);
    assert.equal(c.pagamentos.credito, 40);
    assert.equal(c.pagamentos.tef, 50);
    assert.equal(c.totais.recebido, 165);
    assert.equal(c.caixa_fisico.recebimentos_dinheiro, 15);
    db.close();
  });

  it('S/T suprimento e sangria entram só no físico', async () => {
    const db = await criarDb();
    const { caixa, sessaoId, caixaId } = await seed(db, 100);
    await venda(db, sessaoId, { total: 50, valor_fiscal: 50, forma_pagamento: 'dinheiro' }, [], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'dinheiro', valor: 50 }
    ]);
    await run(db, `INSERT INTO caixa_movimentacoes (caixa_id, sessao_id, tipo, valor) VALUES (?, ?, 'suprimento', 80)`, [caixaId, sessaoId]);
    await run(db, `INSERT INTO caixa_movimentacoes (caixa_id, sessao_id, tipo, valor) VALUES (?, ?, 'sangria', 30)`, [caixaId, sessaoId]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db, valorInformado: 200 });
    assert.equal(c.caixa_fisico.suprimentos, 80);
    assert.equal(c.caixa_fisico.sangrias_operacionais, 30);
    assert.equal(c.caixa_fisico.dinheiro_esperado, 200);
    assert.equal(c.totais.recebido, 50);
    db.close();
  });

  it('preço manual + desconto e acréscimo', () => {
    const okDesc = validarIdentidadeFinanceiraVenda({
      total: 13,
      valorFiscal: 13,
      valorNaoFiscal: 0,
      itens: [{ quantidade: 2, preco_unitario: '7,50' }],
      desconto: 2,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 13 }],
      statusPagamento: 'quitada'
    });
    assert.equal(okDesc.ok, true);
    const okAcres = validarIdentidadeFinanceiraVenda({
      total: 16,
      valorFiscal: 16,
      valorNaoFiscal: 0,
      itens: [{ quantidade: 2, preco_unitario: 7.5 }],
      acrescimo: 1,
      pagamentos: [{ forma_pagamento: 'pix', valor: 16 }],
      statusPagamento: 'quitada'
    });
    assert.equal(okAcres.ok, true);
  });

  it('aguardando sem recebimento não usa fallback da venda', () => {
    const r = Rec.reconciliarVenda(
      { id: 9, total: 100, valor_fiscal: 70, valor_nao_fiscal: 30, status_pagamento: 'aguardando_nao_fiscal' },
      [],
      []
    );
    assert.equal(r.recebido_total, 0);
    assert.equal(r.pendente_total, 100);
    assert.equal(r.status_reconciliacao, 'PENDENTE');
    assert.equal(Rec.bloqueiaFechamento(r), false);
  });
});

describe('snapshot, reimpressão e índice único', () => {
  it('AC snapshot imutável e AB reimpressão usam os mesmos números', async () => {
    const db = await criarDb();
    const { caixa, sessaoId } = await seed(db, 100);
    await venda(db, sessaoId, { total: 400, valor_fiscal: 400, forma_pagamento: 'dinheiro' }, [], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'dinheiro', valor: 400 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, {
      sessaoId, db, valorInformado: 500, modoRetirada: 'total'
    });
    const snapshot = JSON.parse(JSON.stringify(c));
    await venda(db, sessaoId, { total: 999, valor_fiscal: 999, forma_pagamento: 'pix' }, [], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 999 }
    ]);
    const html1 = gerarHtmlCupomFechamento(snapshot, { reimpressao: false });
    const html2 = gerarHtmlCupomFechamento(JSON.parse(JSON.stringify(snapshot)), { reimpressao: true });
    assert.match(html1, /500/);
    assert.match(html2, /500/);
    assert.match(html2, /REIMPRESSÃO/);
    assert.equal(snapshot.totais.vendido, 400);
    assert.equal(snapshot.caixa_fisico.saldo_final, 0);
    db.close();
  });

  it('AA índice único é criado sem duplicados e bloqueia segundo insert', async () => {
    const db = await criarDb();
    const diag = await aplicarIndiceUnicoSeSeguro(db);
    assert.equal(diag.pode_criar_indice_unico, true);
    await run(db, `INSERT INTO caixa_fechamentos (sessao_id, caixa_id, total_informado) VALUES (1, 1, 10)`);
    await assert.rejects(
      () => run(db, `INSERT INTO caixa_fechamentos (sessao_id, caixa_id, total_informado) VALUES (1, 1, 11)`),
      /UNIQUE/i
    );
    db.close();
  });

  it('próxima abertura usa saldo final, não o valor conferido', () => {
    const f = calcularConferenciaFisica({
      saldoInicial: 100,
      recebimentosDinheiro: 400,
      suprimentos: 0,
      sangriasOperacionais: 0,
      dinheiroConferido: 500,
      retiradaFechamento: 300,
      modoRetirada: 'valor'
    });
    assert.equal(f.dinheiro_conferido, 500);
    assert.equal(f.saldo_final, 200);
  });
});
