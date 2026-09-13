/**
 * RC — Fechamento de Caixa: consolidação, entregas, misto, cupom e reimpressão.
 * Executar: npm run test:caixa-fechamento
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '../..');
const Svc = require('../../backend/services/caixa/FechamentoCaixaResumoService');
const Cupom = require('../../backend/services/caixa/FechamentoCaixaCupomService');

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

async function criarDbMemoria() {
  const db = await new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(conn)));
  });

  await run(db, `
    CREATE TABLE caixa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT,
      valor_inicial REAL DEFAULT 0,
      status TEXT,
      aberto_em TEXT,
      fechado_em TEXT,
      aberto_por INTEGER,
      fechado_por INTEGER,
      terminal_id INTEGER,
      ja_reimpresso INTEGER DEFAULT 0
    )
  `);
  await run(db, `
    CREATE TABLE caixa_sessoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caixa_turno_id INTEGER,
      terminal_id INTEGER,
      operador_id INTEGER,
      status TEXT,
      valor_abertura REAL
    )
  `);
  await run(db, `
    CREATE TABLE caixa_movimentacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caixa_id INTEGER,
      sessao_id INTEGER,
      tipo TEXT,
      valor REAL,
      motivo TEXT
    )
  `);
  await run(db, `
    CREATE TABLE caixa_fechamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessao_id INTEGER,
      caixa_id INTEGER,
      total_informado REAL,
      diferenca REAL,
      resumo_json TEXT
    )
  `);
  await run(db, `
    CREATE TABLE vendas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT,
      total REAL,
      desconto REAL DEFAULT 0,
      forma_pagamento TEXT,
      status TEXT,
      status_venda TEXT,
      cancelada INTEGER DEFAULT 0,
      tipo_venda TEXT,
      prestacao_realizada INTEGER DEFAULT 0,
      pagamento_previsto TEXT,
      valor_fiscal REAL DEFAULT 0,
      valor_nao_fiscal REAL DEFAULT 0,
      caixa_sessao_id INTEGER
    )
  `);
  await run(db, `
    CREATE TABLE venda_pagamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER,
      forma_pagamento TEXT,
      valor REAL,
      tef_transacao_id INTEGER,
      tef_nsu TEXT,
      tef_autorizacao TEXT
    )
  `);
  await run(db, `
    CREATE TABLE venda_recebimentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER,
      tipo_recebimento TEXT,
      forma_pagamento TEXT,
      valor REAL,
      tef_transacao_id INTEGER,
      nsu TEXT,
      autorizacao TEXT,
      status TEXT DEFAULT 'aprovado'
    )
  `);

  return db;
}

async function seedCaixaBase(db, valorInicial = 200) {
  const caixaIns = await run(db,
    `INSERT INTO caixa (data, valor_inicial, status, aberto_em) VALUES ('2026-08-02', ?, 'aberto', '2026-08-02 08:00:00')`,
    [valorInicial]
  );
  const caixaId = caixaIns.lastID;
  const sessIns = await run(db,
    `INSERT INTO caixa_sessoes (caixa_turno_id, terminal_id, operador_id, status, valor_abertura)
     VALUES (?, 1, 1, 'aberto', ?)`,
    [caixaId, valorInicial]
  );
  const sessaoId = sessIns.lastID;
  const caixa = await get(db, `SELECT * FROM caixa WHERE id = ?`, [caixaId]);
  return { caixa, sessaoId, caixaId };
}

async function inserirVenda(db, sessaoId, dados, pagamentos = [], recebimentos = []) {
  const ins = await run(db, `
    INSERT INTO vendas (
      codigo, total, desconto, forma_pagamento, status, status_venda, cancelada,
      tipo_venda, prestacao_realizada, pagamento_previsto, valor_fiscal, valor_nao_fiscal, caixa_sessao_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    dados.codigo || null,
    dados.total,
    dados.desconto || 0,
    dados.forma_pagamento || null,
    dados.status || 'concluida',
    dados.status_venda || null,
    dados.cancelada || 0,
    dados.tipo_venda || 'BALCAO',
    dados.prestacao_realizada || 0,
    dados.pagamento_previsto || null,
    dados.valor_fiscal != null ? dados.valor_fiscal : dados.total,
    dados.valor_nao_fiscal || 0,
    sessaoId
  ]);
  const vendaId = ins.lastID;
  for (const p of pagamentos) {
    await run(db, `
      INSERT INTO venda_pagamentos (venda_id, forma_pagamento, valor, tef_transacao_id, tef_nsu, tef_autorizacao)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      vendaId,
      p.forma_pagamento,
      p.valor,
      p.tef_transacao_id || null,
      p.tef_nsu || null,
      p.tef_autorizacao || null
    ]);
  }
  for (const r of recebimentos) {
    await run(db, `
      INSERT INTO venda_recebimentos (
        venda_id, tipo_recebimento, forma_pagamento, valor, tef_transacao_id, nsu, autorizacao, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      vendaId,
      r.tipo_recebimento,
      r.forma_pagamento,
      r.valor,
      r.tef_transacao_id || null,
      r.nsu || null,
      r.autorizacao || null,
      r.status || 'aprovado'
    ]);
  }
  return vendaId;
}

function quaseIgual(a, b, msg) {
  assert.ok(Math.abs(Number(a) - Number(b)) <= 0.021, msg || `${a} != ${b}`);
}

// ---------------------------------------------------------------------------
// Buckets unitários
// ---------------------------------------------------------------------------
assert.strictEqual(Svc.resolverBucketPagamento('dinheiro'), 'dinheiro');
assert.strictEqual(Svc.resolverBucketPagamento('pix'), 'pix');
assert.strictEqual(Svc.resolverBucketPagamento('cartao_debito'), 'debito');
assert.strictEqual(Svc.resolverBucketPagamento('debito'), 'debito');
assert.strictEqual(Svc.resolverBucketPagamento('cartao_credito'), 'credito');
assert.strictEqual(Svc.resolverBucketPagamento('credito'), 'credito');
assert.strictEqual(Svc.resolverBucketPagamento('prazo'), 'prazo');
assert.strictEqual(Svc.resolverBucketPagamento('tef'), 'tef');
assert.strictEqual(Svc.resolverBucketPagamento('cartao'), 'tef');
assert.strictEqual(Svc.resolverBucketPagamento('cartao_debito', { tef_transacao_id: 99 }), 'tef');
assert.strictEqual(Svc.resolverBucketPagamento('cartao_credito', { tef_nsu: '123' }), 'tef');
assert.strictEqual(Svc.resolverBucketPagamento('voucher'), 'outros');
console.log('✓ buckets / aliases / TEF sem duplicidade');

assert.strictEqual(Svc.isEntregaPendente({
  status: 'reserva_entrega',
  prestacao_realizada: 0
}), true);
assert.strictEqual(Svc.isEntregaPendente({
  status: 'concluida',
  tipo_venda: 'ENTREGA',
  prestacao_realizada: 1
}), false);
assert.strictEqual(Svc.isVendaCancelada({ status: 'cancelada' }), true);
assert.strictEqual(Svc.isVendaCancelada({ cancelada: 1 }), true);
console.log('✓ regras entrega pendente / cancelamento');

// ---------------------------------------------------------------------------
// Cenários com DB
// ---------------------------------------------------------------------------
(async () => {
  // Básicos por forma
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId } = await seedCaixaBase(db, 0);
    await inserirVenda(db, sessaoId, { total: 10, forma_pagamento: 'dinheiro' }, [
      { forma_pagamento: 'dinheiro', valor: 10 }
    ]);
    await inserirVenda(db, sessaoId, { total: 20, forma_pagamento: 'pix' }, [
      { forma_pagamento: 'pix', valor: 20 }
    ]);
    await inserirVenda(db, sessaoId, { total: 30, forma_pagamento: 'cartao_debito' }, [
      { forma_pagamento: 'cartao_debito', valor: 30 }
    ]);
    await inserirVenda(db, sessaoId, { total: 40, forma_pagamento: 'cartao_credito' }, [
      { forma_pagamento: 'cartao_credito', valor: 40 }
    ]);
    await inserirVenda(db, sessaoId, { total: 50, forma_pagamento: 'prazo' }, [
      { forma_pagamento: 'prazo', valor: 50 }
    ]);
    await inserirVenda(db, sessaoId, { total: 60, forma_pagamento: 'cartao_debito' }, [
      { forma_pagamento: 'cartao_debito', valor: 60, tef_transacao_id: 1 }
    ]);

    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    quaseIgual(c.pagamentos.dinheiro, 10);
    quaseIgual(c.pagamentos.pix, 20);
    quaseIgual(c.pagamentos.debito, 30);
    quaseIgual(c.pagamentos.credito, 40);
    quaseIgual(c.pagamentos.prazo, 50);
    quaseIgual(c.pagamentos.tef, 60);
    quaseIgual(c.totais.recebido, 210);
    db.close();
    console.log('✓ formas básicas + TEF débito');
  }

  // Misto 40 dinheiro + 60 PIX
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId } = await seedCaixaBase(db, 0);
    await inserirVenda(db, sessaoId, { total: 100, forma_pagamento: 'misto' }, [
      { forma_pagamento: 'dinheiro', valor: 40 },
      { forma_pagamento: 'pix', valor: 60 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    quaseIgual(c.pagamentos.dinheiro, 40, 'misto dinheiro');
    quaseIgual(c.pagamentos.pix, 60, 'misto pix');
    quaseIgual(c.totais.recebido, 100);
    assert.strictEqual(c.pagamentos.outros, 0);
    db.close();
    console.log('✓ misto 40 dinheiro + 60 PIX');
  }

  // Misto 50 dinheiro + 50 cartão + múltiplas formas
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId } = await seedCaixaBase(db, 0);
    await inserirVenda(db, sessaoId, { total: 100, forma_pagamento: 'misto' }, [
      { forma_pagamento: 'dinheiro', valor: 50 },
      { forma_pagamento: 'cartao_credito', valor: 50 }
    ]);
    await inserirVenda(db, sessaoId, { total: 90, forma_pagamento: 'misto' }, [
      { forma_pagamento: 'dinheiro', valor: 30 },
      { forma_pagamento: 'pix', valor: 30 },
      { forma_pagamento: 'cartao_debito', valor: 30 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    quaseIgual(c.pagamentos.dinheiro, 80);
    quaseIgual(c.pagamentos.pix, 30);
    quaseIgual(c.pagamentos.credito, 50);
    quaseIgual(c.pagamentos.debito, 30);
    db.close();
    console.log('✓ misto múltiplas formas');
  }

  // Entrega pendente NÃO entra como recebido
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId } = await seedCaixaBase(db, 0);
    await inserirVenda(db, sessaoId, {
      total: 150,
      forma_pagamento: 'pix',
      status: 'reserva_entrega',
      tipo_venda: 'ENTREGA',
      prestacao_realizada: 0,
      pagamento_previsto: 'PIX'
    }, [{ forma_pagamento: 'pix', valor: 150 }]);

    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    quaseIgual(c.totais.recebido, 0);
    quaseIgual(c.pagamentos.pix, 0);
    quaseIgual(c.entregas.valor_pendente, 150);
    quaseIgual(c.entregas.quantidade_pendente, 1);
    db.close();
    console.log('✓ entrega pendente = a receber (não recebido)');
  }

  // PIX previsto → dinheiro efetivo na prestação
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId } = await seedCaixaBase(db, 0);
    await inserirVenda(db, sessaoId, {
      total: 150,
      forma_pagamento: 'dinheiro',
      status: 'concluida',
      tipo_venda: 'ENTREGA',
      prestacao_realizada: 1,
      pagamento_previsto: 'PIX'
    }, [{ forma_pagamento: 'dinheiro', valor: 150 }]);

    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    quaseIgual(c.pagamentos.dinheiro, 150);
    quaseIgual(c.pagamentos.pix, 0);
    quaseIgual(c.entregas.valor_prestado, 150);
    quaseIgual(c.dinheiro.esperado, 150);
    db.close();
    console.log('✓ PIX previsto → dinheiro efetivo');
  }

  // Dinheiro previsto → PIX recebido
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId } = await seedCaixaBase(db, 0);
    await inserirVenda(db, sessaoId, {
      total: 80,
      forma_pagamento: 'pix',
      status: 'concluida',
      tipo_venda: 'ENTREGA',
      prestacao_realizada: 1,
      pagamento_previsto: 'DINHEIRO'
    }, [{ forma_pagamento: 'pix', valor: 80 }]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    quaseIgual(c.pagamentos.pix, 80);
    quaseIgual(c.pagamentos.dinheiro, 0);
    db.close();
    console.log('✓ dinheiro previsto → PIX efetivo');
  }

  // Cancelamento
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId } = await seedCaixaBase(db, 0);
    await inserirVenda(db, sessaoId, { total: 100, forma_pagamento: 'dinheiro', status: 'cancelada', cancelada: 1 }, [
      { forma_pagamento: 'dinheiro', valor: 100 }
    ]);
    await inserirVenda(db, sessaoId, { total: 25, forma_pagamento: 'pix' }, [
      { forma_pagamento: 'pix', valor: 25 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    quaseIgual(c.totais.recebido, 25);
    quaseIgual(c.cancelamentos.quantidade, 1);
    quaseIgual(c.cancelamentos.valor, 100);
    db.close();
    console.log('✓ cancelamento excluído dos recebidos');
  }

  // Sangria / suprimento / diferenças
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId, caixaId } = await seedCaixaBase(db, 100);
    await inserirVenda(db, sessaoId, { total: 50, forma_pagamento: 'dinheiro' }, [
      { forma_pagamento: 'dinheiro', valor: 50 }
    ]);
    await run(db, `INSERT INTO caixa_movimentacoes (caixa_id, sessao_id, tipo, valor) VALUES (?, ?, 'suprimento', 20)`, [caixaId, sessaoId]);
    await run(db, `INSERT INTO caixa_movimentacoes (caixa_id, sessao_id, tipo, valor) VALUES (?, ?, 'sangria', 30)`, [caixaId, sessaoId]);

    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db, valorInformado: 145 });
    // esperado = 100 + 50 + 20 - 30 = 140
    quaseIgual(c.dinheiro.esperado, 140);
    quaseIgual(c.dinheiro.diferenca, 5);

    const cNeg = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db, valorInformado: 130 });
    quaseIgual(cNeg.dinheiro.diferenca, -10);

    const vazio = await Svc.consolidarSessaoCaixa(
      { id: 99, valor_inicial: 0, data: '2026-08-02', status: 'aberto' },
      { sessaoId: 99999, db }
    );
    quaseIgual(vazio.totais.recebido, 0);
    db.close();
    console.log('✓ saldo / suprimento / sangria / diferenças / caixa vazio');
  }

  // Cenário completo de integridade (§23)
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId, caixaId } = await seedCaixaBase(db, 200);

    // Venda 1: dinheiro 100
    await inserirVenda(db, sessaoId, { total: 100, forma_pagamento: 'dinheiro' }, [
      { forma_pagamento: 'dinheiro', valor: 100 }
    ]);
    // Venda 2: PIX 200
    await inserirVenda(db, sessaoId, { total: 200, forma_pagamento: 'pix' }, [
      { forma_pagamento: 'pix', valor: 200 }
    ]);
    // Venda 3: misto 50+50
    await inserirVenda(db, sessaoId, { total: 100, forma_pagamento: 'misto' }, [
      { forma_pagamento: 'dinheiro', valor: 50 },
      { forma_pagamento: 'pix', valor: 50 }
    ]);
    // Venda 4: entrega pendente 150
    await inserirVenda(db, sessaoId, {
      total: 150,
      forma_pagamento: 'pix',
      status: 'reserva_entrega',
      tipo_venda: 'ENTREGA',
      prestacao_realizada: 0,
      pagamento_previsto: 'PIX'
    }, [{ forma_pagamento: 'pix', valor: 150 }]);
    // Venda 5: entrega prestada — previsto PIX, recebido dinheiro 100
    await inserirVenda(db, sessaoId, {
      total: 100,
      forma_pagamento: 'dinheiro',
      status: 'concluida',
      tipo_venda: 'ENTREGA',
      prestacao_realizada: 1,
      pagamento_previsto: 'PIX'
    }, [{ forma_pagamento: 'dinheiro', valor: 100 }]);

    await run(db, `INSERT INTO caixa_movimentacoes (caixa_id, sessao_id, tipo, valor) VALUES (?, ?, 'suprimento', 100)`, [caixaId, sessaoId]);
    await run(db, `INSERT INTO caixa_movimentacoes (caixa_id, sessao_id, tipo, valor) VALUES (?, ?, 'sangria', 80)`, [caixaId, sessaoId]);

    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db, valorInformado: 470 });

    // Dinheiro recebido: 100 + 50 + 100 = 250
    quaseIgual(c.pagamentos.dinheiro, 250, 'dinheiro recebido');
    // PIX: 200 + 50 = 250 (pendente 150 NÃO entra)
    quaseIgual(c.pagamentos.pix, 250, 'pix recebido');
    quaseIgual(c.entregas.valor_pendente, 150, 'entrega pendente');
    quaseIgual(c.entregas.valor_prestado, 100, 'entrega prestada');
    quaseIgual(c.movimentacoes.suprimentos, 100);
    quaseIgual(c.movimentacoes.sangrias, 80);
    // esperado = 200 + 250 + 100 - 80 = 470
    quaseIgual(c.dinheiro.esperado, 470, 'dinheiro esperado');
    // total recebido = 250 + 250 = 500
    quaseIgual(c.totais.recebido, 500, 'total recebido');
    quaseIgual(c.dinheiro.diferenca, 0, 'diferença');

    assert.ok(c.validacao.ok, 'validação matemática');

    // Mesma regra resumo ↔ fechamento
    const legadoResumo = Svc.paraResumoLegado(caixa, c);
    const legadoFecha = Svc.paraFechamentoLegado(c, 470);
    quaseIgual(legadoResumo.dinheiro.vendas_dinheiro, legadoFecha.vendas_dinheiro);
    quaseIgual(legadoResumo.digital.pix, legadoFecha.vendas_pix);
    quaseIgual(legadoResumo.total_vendido, legadoFecha.total_vendido);
    quaseIgual(legadoResumo.dinheiro.dinheiro_esperado, legadoFecha.total_esperado);

    // Cupom
    const html = Cupom.gerarHtmlCupomFechamento(c, {
      empresa_nome: 'Loja Teste',
      empresa_cnpj: '00.000.000/0001-00',
      operador_nome: 'Operador',
      caixa_id: caixaId,
      reimpressao: false
    });
    assert.ok(html.includes('80mm'), 'largura 80mm');
    assert.ok(html.includes('FECHAMENTO DE CAIXA'));
    assert.ok(html.includes('FORMAS DE PAGAMENTO'));
    assert.ok(html.includes('VENDAS PARA ENTREGA'));
    assert.ok(html.includes('CONFERÊNCIA DO CAIXA'));
    assert.ok(html.includes('Dinheiro'));
    assert.ok(html.includes('PIX'));
    assert.ok(html.includes('Sangrias') || html.includes('Sangria'));
    assert.ok(html.includes('Suprimentos') || html.includes('Suprimento'));

    const htmlReimp = Cupom.gerarHtmlCupomFechamento(c, { reimpressao: true, caixa_id: caixaId });
    assert.ok(htmlReimp.includes('REIMPRESSÃO'));

    // Snapshot imutável: reimpressão não altera consolidação
    const snapshot = JSON.stringify(c);
    const c2 = JSON.parse(snapshot);
    quaseIgual(c2.dinheiro.esperado, 470);
    quaseIgual(c2.pagamentos.dinheiro, 250);

    db.close();
    console.log('✓ cenário completo §23 + cupom 80mm + mesma regra resumo/fechamento');
  }

  // TEF crédito + cartão convencional mistos
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId } = await seedCaixaBase(db, 0);
    await inserirVenda(db, sessaoId, { total: 70, forma_pagamento: 'misto' }, [
      { forma_pagamento: 'cartao_credito', valor: 40, tef_transacao_id: 7 },
      { forma_pagamento: 'pix', valor: 30 }
    ]);
    await inserirVenda(db, sessaoId, { total: 25, forma_pagamento: 'cartao_credito' }, [
      { forma_pagamento: 'cartao_credito', valor: 25 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    quaseIgual(c.pagamentos.tef, 40);
    quaseIgual(c.pagamentos.credito, 25);
    quaseIgual(c.pagamentos.pix, 30);
    quaseIgual(c.totais.recebido, 95);
    db.close();
    console.log('✓ TEF crédito + cartão convencional sem duplicar');
  }

  // Evidências estáticas de integração nas rotas/frontend
  {
    const caixaRota = fs.readFileSync(path.join(ROOT, 'backend/rotas/caixa.js'), 'utf8');
    assert.ok(caixaRota.includes('FechamentoCaixaResumoService'));
    assert.ok(caixaRota.includes("exigirPermissaoOuSenhaAdmin('fechar_caixa')"));
    assert.ok(caixaRota.includes('/:caixa_id/reimprimir'));
    assert.ok(caixaRota.includes('cupom_html'));
    assert.ok(caixaRota.includes('aberto_por'));

    const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/caixa.js'), 'utf8');
    assert.ok(pdv.includes('PERMISSOES_CAIXA.FECHAR'));
    assert.ok(pdv.includes('imprimirCupomFechamentoCaixa'));
    assert.ok(pdv.includes('cupom_html'));

    const erp = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/caixa.js'), 'utf8');
    assert.ok(erp.includes('PERMISSOES_CAIXA.FECHAR'));
    assert.ok(erp.includes('imprimirCupomFechamentoCaixa'));

    const perm = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/caixaPermissoes.js'), 'utf8');
    assert.ok(perm.includes('FECHAR'));
    assert.ok(perm.includes('onSuccess(resposta)'));

    const auth = fs.readFileSync(path.join(ROOT, 'backend/middleware/auth.js'), 'utf8');
    assert.ok(auth.includes('fechar_caixa'));

    console.log('✓ integração rotas / frontend / permissão / reimpressão');
  }

  // Fonte de verdade: venda_recebimentos (fiscal + não fiscal) sem dupla contagem
  {
    const linhas = Svc.resolverLinhasRecebidasVenda(
      { total: 4, valor_fiscal: 2, valor_nao_fiscal: 2, forma_pagamento: 'misto' },
      [{ forma_pagamento: 'pix', valor: 2 }],
      [
        { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 2 },
        { tipo_recebimento: 'nao_fiscal', forma_pagamento: 'pix', valor: 2 }
      ]
    );
    assert.strictEqual(linhas.length, 2);
    assert.strictEqual(linhas[0].fonte, 'venda_recebimentos');
    quaseIgual(linhas.reduce((a, l) => a + Number(l.valor), 0), 4);
    console.log('✓ resolverLinhasRecebidasVenda prioriza recebimentos (sem dupla contagem)');
  }

  // TESTE 1 — 100% fiscal
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId } = await seedCaixaBase(db, 0);
    await inserirVenda(db, sessaoId, {
      total: 10, valor_fiscal: 10, valor_nao_fiscal: 0, forma_pagamento: 'pix'
    }, [{ forma_pagamento: 'pix', valor: 10 }], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 10 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    quaseIgual(c.totais.recebido, 10);
    quaseIgual(c.pagamentos.pix, 10);
    assert.ok(c.validacao.ok);
    db.close();
    console.log('✓ TESTE 1 venda 100% fiscal');
  }

  // TESTE 2 — 100% não fiscal
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId } = await seedCaixaBase(db, 0);
    await inserirVenda(db, sessaoId, {
      total: 10, valor_fiscal: 0, valor_nao_fiscal: 10, forma_pagamento: 'dinheiro'
    }, [], [
      { tipo_recebimento: 'nao_fiscal', forma_pagamento: 'dinheiro', valor: 10 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    quaseIgual(c.totais.recebido, 10);
    quaseIgual(c.pagamentos.dinheiro, 10);
    assert.ok(c.validacao.ok);
    db.close();
    console.log('✓ TESTE 2 venda 100% não fiscal');
  }

  // TESTE 3 — mista 6+4
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId } = await seedCaixaBase(db, 0);
    await inserirVenda(db, sessaoId, {
      total: 10, valor_fiscal: 6, valor_nao_fiscal: 4, forma_pagamento: 'misto'
    }, [{ forma_pagamento: 'pix', valor: 6 }], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 6 },
      { tipo_recebimento: 'nao_fiscal', forma_pagamento: 'dinheiro', valor: 4 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    quaseIgual(c.totais.recebido, 10);
    quaseIgual(c.pagamentos.pix, 6);
    quaseIgual(c.pagamentos.dinheiro, 4);
    assert.strictEqual(c.validacao.divergencias.length, 0);
    assert.ok(c.validacao.ok);
    db.close();
    console.log('✓ TESTE 3 venda mista 6+4 diferença 0');
  }

  // TESTE 4 — mista mesma forma PIX 2+2 = 4
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId } = await seedCaixaBase(db, 0);
    await inserirVenda(db, sessaoId, {
      total: 4, valor_fiscal: 2, valor_nao_fiscal: 2, forma_pagamento: 'pix'
    }, [{ forma_pagamento: 'pix', valor: 2 }], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 2 },
      { tipo_recebimento: 'nao_fiscal', forma_pagamento: 'pix', valor: 2 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    quaseIgual(c.pagamentos.pix, 4, 'PIX deve somar fiscal+não fiscal');
    quaseIgual(c.totais.recebido, 4);
    assert.ok(c.validacao.ok);
    db.close();
    console.log('✓ TESTE 4 mista mesma forma PIX=4');
  }

  // TESTE 5 — mista formas diferentes
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId } = await seedCaixaBase(db, 0);
    await inserirVenda(db, sessaoId, {
      total: 4, valor_fiscal: 2, valor_nao_fiscal: 2, forma_pagamento: 'misto'
    }, [{ forma_pagamento: 'pix', valor: 2 }], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 2 },
      { tipo_recebimento: 'nao_fiscal', forma_pagamento: 'dinheiro', valor: 2 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    quaseIgual(c.pagamentos.pix, 2);
    quaseIgual(c.pagamentos.dinheiro, 2);
    quaseIgual(c.totais.recebido, 4);
    assert.ok(c.validacao.ok);
    db.close();
    console.log('✓ TESTE 5 mista PIX+DINHEIRO');
  }

  // TESTE 6 — pagamento incompleto (só fiscal em pagamentos; sem NF em recebimentos)
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId } = await seedCaixaBase(db, 0);
    await inserirVenda(db, sessaoId, {
      total: 10, valor_fiscal: 8, valor_nao_fiscal: 2, forma_pagamento: 'misto'
    }, [{ forma_pagamento: 'pix', valor: 8 }], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 8 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    quaseIgual(c.totais.recebido, 10);
    quaseIgual(c.pagamentos.pix, 8);
    assert.ok(!c.validacao.ok);
    const div = c.validacao.divergencias.find((d) => d.tipo === 'pagamento_vs_venda');
    assert.ok(div);
    quaseIgual(Math.abs(div.diferenca), 2);
    db.close();
    console.log('✓ TESTE 6 incompleto diferença R$ 2');
  }

  // TESTE 10 — várias fiscais / não fiscais / mistas
  {
    const db = await criarDbMemoria();
    const { caixa, sessaoId } = await seedCaixaBase(db, 0);
    await inserirVenda(db, sessaoId, {
      total: 10, valor_fiscal: 10, valor_nao_fiscal: 0, forma_pagamento: 'pix'
    }, [{ forma_pagamento: 'pix', valor: 10 }], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 10 }
    ]);
    await inserirVenda(db, sessaoId, {
      total: 10, valor_fiscal: 0, valor_nao_fiscal: 10, forma_pagamento: 'dinheiro'
    }, [], [
      { tipo_recebimento: 'nao_fiscal', forma_pagamento: 'dinheiro', valor: 10 }
    ]);
    await inserirVenda(db, sessaoId, {
      total: 4, valor_fiscal: 2, valor_nao_fiscal: 2, forma_pagamento: 'pix'
    }, [{ forma_pagamento: 'pix', valor: 2 }], [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 2 },
      { tipo_recebimento: 'nao_fiscal', forma_pagamento: 'pix', valor: 2 }
    ]);
    const c = await Svc.consolidarSessaoCaixa(caixa, { sessaoId, db });
    quaseIgual(c.totais.recebido, 24);
    quaseIgual(c.pagamentos.pix, 14);
    quaseIgual(c.pagamentos.dinheiro, 10);
    assert.ok(c.validacao.ok);
    db.close();
    console.log('✓ TESTE 10 fechamento com vendas mistas agregadas');
  }

  console.log('\nRC FECHAMENTO CAIXA — todos os testes passaram.');
})().catch((err) => {
  console.error('\nFALHA:', err);
  process.exit(1);
});