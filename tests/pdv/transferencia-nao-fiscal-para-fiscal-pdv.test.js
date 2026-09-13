/**
 * PDV — transferência NÃO FISCAL → FISCAL na inclusão do item.
 * npm run test:pdv-transferencia-estoque
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '../..');
const {
  MOTIVO_TRANSFERENCIA_PDV,
  calcularTransferenciaNaoFiscalParaFiscal,
  aplicarTransferenciaEmMemoria,
  avaliarFluxoInclusaoPdv,
  podeIniciarInclusaoPdv,
  prepararEntradasMotorComTransferenciaPdv,
  aplicarTransferenciasPdv
} = require('../../backend/services/estoque/transferenciaNaoFiscalParaFiscalPdv');
const { distribuirItensVendaComValorFiscalEfetivo } = require('../../backend/services/distribuidorEstoqueVenda');
const estoqueSaldosPublico = require('../../backend/services/fiscalNaoFiscal/estoqueSaldosPublico');

function openDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
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

function closeDb(db) {
  return new Promise((resolve) => {
    try {
      db.close(() => resolve());
    } catch (_) {
      resolve();
    }
  });
}

async function setupDb() {
  const db = await openDb();
  await run(db, `
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT,
      saldo_fiscal REAL DEFAULT 0,
      saldo_nao_fiscal REAL DEFAULT 0,
      estoque_atual REAL DEFAULT 0,
      item_fiscal INTEGER DEFAULT 1,
      updated_at DATETIME
    )
  `);
  await run(db, `
    CREATE TABLE movimentos_transferencia_saldos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      origem TEXT NOT NULL,
      destino TEXT NOT NULL,
      quantidade REAL NOT NULL,
      saldo_origem_antes REAL NOT NULL,
      saldo_origem_depois REAL NOT NULL,
      saldo_destino_antes REAL NOT NULL,
      saldo_destino_depois REAL NOT NULL,
      motivo TEXT,
      usuario_id INTEGER,
      data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
      resultado TEXT NOT NULL
    )
  `);
  return db;
}

describe('Cálculo — Transferir estoque (déficit fiscal)', () => {
  it('TESTE 1 — fiscal suficiente: não pergunta, não transfere', () => {
    const r = calcularTransferenciaNaoFiscalParaFiscal({
      quantidade: 20,
      saldoFiscal: 30,
      saldoNaoFiscal: 10
    });
    assert.equal(r.devePerguntar, false);
    assert.equal(r.podeTransferir, false);
    assert.equal(r.quantidadeTransferir, 0);
    assert.equal(r.deficitFiscal, 0);
  });

  it('TESTE 5 / cenário 5 — quantidade igual ao saldo fiscal: não pergunta', () => {
    const r = calcularTransferenciaNaoFiscalParaFiscal({
      quantidade: 18,
      saldoFiscal: 18,
      saldoNaoFiscal: 10
    });
    assert.equal(r.devePerguntar, false);
    assert.equal(r.quantidadeTransferir, 0);
  });

  it('TESTE 2 — fiscal 0 e NF suficiente: pergunta e transfere exatamente a quantidade', () => {
    const r = calcularTransferenciaNaoFiscalParaFiscal({
      quantidade: 5,
      saldoFiscal: 0,
      saldoNaoFiscal: 20
    });
    assert.equal(r.devePerguntar, true);
    assert.equal(r.quantidadeTransferir, 5);
    const mem = aplicarTransferenciaEmMemoria(
      { saldoFiscal: 0, saldoNaoFiscal: 20 },
      r.quantidadeTransferir
    );
    assert.equal(mem.saldoFiscal, 5);
    assert.equal(mem.saldoNaoFiscal, 15);
    assert.equal(mem.estoqueAtual, 20);
  });

  it('TESTE 3 — fiscal parcial: transfere somente o déficit (2)', () => {
    const r = calcularTransferenciaNaoFiscalParaFiscal({
      quantidade: 20,
      saldoFiscal: 18,
      saldoNaoFiscal: 10
    });
    assert.equal(r.devePerguntar, true);
    assert.equal(r.deficitFiscal, 2);
    assert.equal(r.quantidadeTransferir, 2);
    const mem = aplicarTransferenciaEmMemoria(
      { saldoFiscal: 18, saldoNaoFiscal: 10 },
      r.quantidadeTransferir
    );
    assert.equal(mem.saldoFiscal, 20);
    assert.equal(mem.saldoNaoFiscal, 8);
    assert.equal(mem.estoqueAtual, 28);
  });

  it('TESTE 4 — operador NÃO: zero transferência (intent ignorado)', () => {
    const item = {
      produto_id: 1,
      quantidade: 20,
      preco_unitario: 10,
      transferencia_nao_fiscal_para_fiscal: 0
    };
    const prep = prepararEntradasMotorComTransferenciaPdv([
      { item, saldoFiscal: 18, saldoNaoFiscal: 10 }
    ]);
    assert.equal(prep.aplicacoes.length, 0);
    assert.equal(prep.entradas[0].saldoFiscal, 18);
    assert.equal(prep.entradas[0].saldoNaoFiscal, 10);
  });

  it('TESTE 5 — NF insuficiente para o déficit: não permite transferência', () => {
    const r = calcularTransferenciaNaoFiscalParaFiscal({
      quantidade: 20,
      saldoFiscal: 18,
      saldoNaoFiscal: 1
    });
    assert.equal(r.estoqueInsuficiente, true);
    assert.equal(r.devePerguntar, false);
    assert.equal(r.podeTransferir, false);
    assert.equal(r.quantidadeTransferir, 0);
  });

  it('TESTE 6 — nunca saldo fiscal negativo', () => {
    assert.throws(
      () => aplicarTransferenciaEmMemoria({ saldoFiscal: 0, saldoNaoFiscal: 1 }, -1),
      (err) => err && err.code === 'QUANTIDADE_INVALIDA'
    );
    const mem = aplicarTransferenciaEmMemoria({ saldoFiscal: 0, saldoNaoFiscal: 5 }, 5);
    assert.ok(mem.saldoFiscal >= 0);
    assert.equal(mem.saldoFiscal, 5);
  });

  it('TESTE 7 — nunca saldo não fiscal negativo', () => {
    assert.throws(
      () => aplicarTransferenciaEmMemoria({ saldoFiscal: 18, saldoNaoFiscal: 1 }, 2),
      (err) => err && err.code === 'SALDO_NAO_FISCAL_NEGATIVO'
    );
  });

  it('TESTE 8 — invariante saldo_fiscal + saldo_nao_fiscal = estoque_atual', () => {
    const mem = aplicarTransferenciaEmMemoria(
      { saldoFiscal: 18, saldoNaoFiscal: 10 },
      2
    );
    assert.equal(mem.saldoFiscal + mem.saldoNaoFiscal, mem.estoqueAtual);
  });

  it('TESTE 12 — múltiplas unidades: transfere só o déficit da quantidade informada', () => {
    const r = calcularTransferenciaNaoFiscalParaFiscal({
      quantidade: 20,
      saldoFiscal: 18,
      saldoNaoFiscal: 10
    });
    assert.equal(r.quantidadeTransferir, 2);
    assert.notEqual(r.quantidadeTransferir, 20);
  });
});

describe('Preparação antes do Motor (sem alterar o Motor)', () => {
  it('SIM: Motor recebe saldo fiscal já preparado e vende 20 como fiscal', () => {
    const item = {
      produto_id: 1,
      quantidade: 20,
      preco_unitario: 5,
      subtotal: 100,
      transferencia_nao_fiscal_para_fiscal: 2
    };
    const prep = prepararEntradasMotorComTransferenciaPdv([
      { item, saldoFiscal: 18, saldoNaoFiscal: 10 }
    ]);
    assert.equal(prep.aplicacoes.length, 1);
    assert.equal(prep.aplicacoes[0].quantidade, 2);
    assert.equal(prep.entradas[0].saldoFiscal, 20);
    assert.equal(prep.entradas[0].saldoNaoFiscal, 8);

    const motor = distribuirItensVendaComValorFiscalEfetivo(prep.entradas, true, {
      pagamentos: [{ forma_pagamento: 'pix', valor: 100 }]
    });
    assert.equal(motor.sucesso, true);
    assert.equal(Number(motor.itens[0].quantidade_fiscal), 20);
    assert.equal(Number(motor.itens[0].quantidade_nao_fiscal), 0);
  });

  it('sem transferência: Motor original (18 fiscal + 2 não fiscal)', () => {
    const item = { produto_id: 1, quantidade: 20, preco_unitario: 5, subtotal: 100 };
    const motor = distribuirItensVendaComValorFiscalEfetivo(
      [{ item, saldoFiscal: 18, saldoNaoFiscal: 10 }],
      true,
      { pagamentos: [{ forma_pagamento: 'pix', valor: 100 }] }
    );
    assert.equal(motor.sucesso, true);
    assert.equal(Number(motor.itens[0].quantidade_fiscal), 18);
    assert.equal(Number(motor.itens[0].quantidade_nao_fiscal), 2);
  });

  it('TESTE 11 — transferência de um item não altera outro produto', () => {
    const arroz = {
      produto_id: 1,
      quantidade: 20,
      preco_unitario: 5,
      transferencia_nao_fiscal_para_fiscal: 2
    };
    const feijao = {
      produto_id: 2,
      quantidade: 3,
      preco_unitario: 8,
      transferencia_nao_fiscal_para_fiscal: 0
    };
    const prep = prepararEntradasMotorComTransferenciaPdv([
      { item: arroz, saldoFiscal: 18, saldoNaoFiscal: 10 },
      { item: feijao, saldoFiscal: 40, saldoNaoFiscal: 5 }
    ]);
    assert.equal(prep.aplicacoes.length, 1);
    assert.equal(prep.aplicacoes[0].produto_id, 1);
    assert.equal(prep.entradas[1].saldoFiscal, 40);
    assert.equal(prep.entradas[1].saldoNaoFiscal, 5);
  });

  it('não transfere mais que o déficit mesmo se intent for maior', () => {
    const item = {
      produto_id: 1,
      quantidade: 20,
      preco_unitario: 5,
      transferencia_nao_fiscal_para_fiscal: 99
    };
    const prep = prepararEntradasMotorComTransferenciaPdv([
      { item, saldoFiscal: 18, saldoNaoFiscal: 10 }
    ]);
    assert.equal(prep.aplicacoes[0].quantidade, 2);
  });
});

describe('Persistência MTS + transação', () => {
  it('aplica transferência auditável via MTS', async () => {
    const db = await setupDb();
    try {
      await run(
        db,
        `INSERT INTO produtos (nome, saldo_fiscal, saldo_nao_fiscal, estoque_atual, item_fiscal)
         VALUES ('Arroz', 18, 10, 28, 1)`
      );
      const itemFiscalAntes = await get(db, 'SELECT item_fiscal FROM produtos WHERE id = 1');

      const resultados = await aplicarTransferenciasPdv(
        [{
          produto_id: 1,
          quantidade: 2,
          quantidade_venda: 20,
          motivo: MOTIVO_TRANSFERENCIA_PDV
        }],
        { db, usuarioId: 7, jaEmTransacao: false }
      );

      const prod = await get(db, 'SELECT * FROM produtos WHERE id = 1');
      assert.equal(Number(prod.saldo_fiscal), 20);
      assert.equal(Number(prod.saldo_nao_fiscal), 8);
      assert.equal(Number(prod.estoque_atual), 28);
      assert.equal(Number(prod.item_fiscal), Number(itemFiscalAntes.item_fiscal));

      const movs = await all(db, 'SELECT * FROM movimentos_transferencia_saldos');
      assert.equal(movs.length, 1);
      assert.equal(movs[0].origem, 'NAO_FISCAL');
      assert.equal(movs[0].destino, 'FISCAL');
      assert.equal(Number(movs[0].quantidade), 2);
      assert.equal(movs[0].motivo, MOTIVO_TRANSFERENCIA_PDV);
      assert.equal(Number(movs[0].usuario_id), 7);
      assert.equal(Number(movs[0].saldo_origem_antes), 10);
      assert.equal(Number(movs[0].saldo_origem_depois), 8);
      assert.equal(Number(movs[0].saldo_destino_antes), 18);
      assert.equal(Number(movs[0].saldo_destino_depois), 20);
      assert.ok(resultados[0].transferencia_id);
    } finally {
      await closeDb(db);
    }
  });

  it('TESTE 9 — falha após transferência: rollback restaura saldos', async () => {
    const db = await setupDb();
    try {
      await run(
        db,
        `INSERT INTO produtos (nome, saldo_fiscal, saldo_nao_fiscal, estoque_atual)
         VALUES ('Arroz', 18, 10, 28)`
      );

      let falhou = false;
      try {
        await estoqueSaldosPublico.executarEmTransacao(async (txDb) => {
          await aplicarTransferenciasPdv(
            [{ produto_id: 1, quantidade: 2, quantidade_venda: 20 }],
            { db: txDb, usuarioId: 1, jaEmTransacao: true }
          );
          const meio = await get(txDb, 'SELECT saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id = 1');
          assert.equal(Number(meio.saldo_fiscal), 20);
          throw new Error('falha durante a venda');
        }, { db });
      } catch (err) {
        falhou = true;
        assert.match(String(err.message), /falha durante a venda/);
      }
      assert.equal(falhou, true);

      const depois = await get(db, 'SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual FROM produtos WHERE id = 1');
      assert.equal(Number(depois.saldo_fiscal), 18);
      assert.equal(Number(depois.saldo_nao_fiscal), 10);
      assert.equal(Number(depois.estoque_atual), 28);
    } finally {
      await closeDb(db);
    }
  });

  it('TESTE 10 — cancelamento devolve a baixa da venda; invariante permanece', async () => {
    const db = await setupDb();
    try {
      await run(
        db,
        `INSERT INTO produtos (nome, saldo_fiscal, saldo_nao_fiscal, estoque_atual)
         VALUES ('Arroz', 18, 10, 28)`
      );
      await aplicarTransferenciasPdv(
        [{ produto_id: 1, quantidade: 2, quantidade_venda: 20 }],
        { db, jaEmTransacao: false }
      );
      await run(
        db,
        `UPDATE produtos
         SET saldo_fiscal = saldo_fiscal - 20,
             estoque_atual = (saldo_fiscal - 20) + saldo_nao_fiscal
         WHERE id = 1`
      );
      let prod = await get(db, 'SELECT * FROM produtos WHERE id = 1');
      assert.equal(Number(prod.saldo_fiscal), 0);
      assert.equal(Number(prod.saldo_nao_fiscal), 8);

      await run(
        db,
        `UPDATE produtos
         SET saldo_fiscal = saldo_fiscal + 20,
             saldo_nao_fiscal = saldo_nao_fiscal + 0,
             estoque_atual = (saldo_fiscal + 20) + (saldo_nao_fiscal + 0)
         WHERE id = 1`
      );
      prod = await get(db, 'SELECT * FROM produtos WHERE id = 1');
      assert.equal(Number(prod.saldo_fiscal), 20);
      assert.equal(Number(prod.saldo_nao_fiscal), 8);
      assert.equal(Number(prod.estoque_atual), 28);
      assert.equal(Number(prod.saldo_fiscal) + Number(prod.saldo_nao_fiscal), Number(prod.estoque_atual));
    } finally {
      await closeDb(db);
    }
  });
});

describe('PDV UX — pergunta só depois da quantidade', () => {
  const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
  const busca = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/pdvBuscaProduto.js'), 'utf8');
  const pag = fs.readFileSync(path.join(ROOT, 'backend/services/vendas/VendaPagamentoService.js'), 'utf8');
  const motor = fs.readFileSync(path.join(ROOT, 'backend/services/distribuidorEstoqueVenda.js'), 'utf8');

  it('modal de quantidade não contém a pergunta', () => {
    const inicio = pdv.indexOf('function abrirModalQuantidadeProduto');
    const fim = pdv.indexOf('function confirmarQuantidadeProduto');
    const bloco = pdv.slice(inicio, fim);
    assert.match(bloco, /id="inputQuantidadeProduto"/);
    assert.doesNotMatch(bloco, /Transferir estoque\?/);
  });

  it('pergunta exata Transferir estoque? com SIM e NÃO', () => {
    assert.match(pdv, /function abrirModalTransferirEstoquePdv/);
    assert.match(pdv, />Transferir estoque\?</);
    assert.match(
      pdv,
      /id="btnTransferirEstoqueNao">NÃO<\/button>\s*<button type="button" class="btn btn-primary" id="btnTransferirEstoqueSim">SIM</
    );
    const bloco = pdv.slice(
      pdv.indexOf('function abrirModalTransferirEstoquePdv'),
      pdv.indexOf('function produtoControlaEstoquePdv')
    );
    assert.match(bloco, /e\.key === 'Escape'/);
    assert.match(bloco, /finalizar\(false\)/);
    assert.match(bloco, /btnNao\.focus/);
    assert.doesNotMatch(bloco, /finalizar\(true\);\s*\n\s*\} else if \(e\.key === 'Escape'/);
    assert.ok(
      !/if \(e\.key === 'Enter'\)[\s\S]{0,80}finalizar\(true\)/.test(bloco),
      'Enter não pode confirmar SIM'
    );
    assert.doesNotMatch(pdv, /Transferir saldo não fiscal/);
    assert.doesNotMatch(pdv, /Usar estoque não fiscal/);
    assert.doesNotMatch(pdv, /Forçar venda fiscal/);
    assert.doesNotMatch(pdv, /forcarFiscal/);
  });

  it('NÃO não envia intent de transferência', () => {
    const add = pdv.slice(pdv.indexOf('function adicionarItemNoCarrinho'));
    assert.match(add, /recusouTransferencia/);
    assert.match(add, /transferenciaResposta === false/);
    assert.match(add, /transferenciaResposta === true/);
  });

  it('confirma quantidade antes de perguntar transferência', () => {
    assert.match(pdv, /function confirmarQuantidadeProduto/);
    const add = pdv.slice(pdv.indexOf('function adicionarItemNoCarrinho'));
    assert.match(add, /abrirModalTransferirEstoquePdv/);
    assert.match(add, /analiseTransferencia\.devePerguntar/);
  });

  it('venda envia intent e prepara estoque ANTES do Motor', () => {
    assert.match(pdv, /transferencia_nao_fiscal_para_fiscal/);
    assert.match(pag, /prepararEntradasMotorComTransferenciaPdv/);
    assert.match(pag, /iniciarTransacaoVendaComTransferenciaPdv/);
    assert.match(pag, /distribuirItensVendaComValorFiscalEfetivo\(\s*preparadoTransferenciaPdv\.entradas/);
  });

  it('TESTE 13 — Motor F×NF não foi reescrito', () => {
    assert.match(motor, /function distribuirItemVenda/);
    assert.match(motor, /function distribuirQuantidadeVenda/);
    assert.doesNotMatch(motor, /forcarFiscal/);
    assert.doesNotMatch(motor, /TRANSFERENCIA_NAO_FISCAL_PARA_FISCAL/);
    assert.doesNotMatch(motor, /transferencia_nao_fiscal_para_fiscal/);
  });

  it('validarEstoqueVenda não recusa só porque o saldo fiscal é 0', () => {
    const fn = pdv.slice(
      pdv.indexOf('function validarEstoqueVenda'),
      pdv.indexOf('function pdvValidarEstoqueVenda')
    );
    assert.doesNotMatch(fn, /if \(saldoFiscal <= 0\)/);
    assert.match(fn, /quantidade > saldoTotal/);
  });

  it('inclusão MIP/legado/F1 não usa mais o gate fiscal=0 antes da quantidade', () => {
    assert.match(pdv, /function pdvPodeIniciarInclusaoProduto/);
    const legado = pdv.slice(
      pdv.indexOf('function adicionarProdutoPorCodigoLegado'),
      pdv.indexOf('async function adicionarProdutoPorCodigoViaMip')
    );
    assert.match(legado, /pdvPodeIniciarInclusaoProduto\(produto\)/);
    assert.doesNotMatch(legado, /pdvValidarEstoqueVenda\(produto, 1\)/);
    assert.match(pdv, /pdvPodeIniciarInclusaoProduto\(produtoCarrinho\)/);
    const f1 = pdv.slice(pdv.indexOf('function adicionarProdutoConsultaPDV'));
    assert.match(f1, /pdvPodeIniciarInclusaoProduto\(produto\)/);
    assert.doesNotMatch(f1.slice(0, 900), /pdvValidarEstoqueVenda\(produto,/);
    assert.match(busca, /saldo_nao_fiscal/);
    assert.match(busca, /if \(total > 1e-9\)/);
  });
});

describe('Bug real — Fiscal 0 + NF suficiente NÃO pode ser Disponível: 0', () => {
  it('TESTE A — modo fiscal, F=0 NF=20 qtd=5: PERGUNTAR, sem Disponível: 0', () => {
    const r = avaliarFluxoInclusaoPdv({
      quantidade: 5,
      saldoFiscal: 0,
      saldoNaoFiscal: 20,
      modoFiscal: true
    });
    assert.equal(r.acao, 'PERGUNTAR');
    assert.equal(r.quantidadeTransferir, 5);
    assert.equal(r.mensagemBloqueio, null);
    assert.ok(!String(r.mensagemBloqueio || '').includes('Disponível: 0'));
    assert.equal(podeIniciarInclusaoPdv({
      saldoFiscal: 0,
      saldoNaoFiscal: 20,
      controlaEstoque: true
    }), true);
  });

  it('TESTE B2 — quantidade maior que F+NF: recusa com o total, não com Disponível: 0', () => {
    const r = avaliarFluxoInclusaoPdv({
      quantidade: 25,
      saldoFiscal: 0,
      saldoNaoFiscal: 20,
      modoFiscal: true
    });
    assert.equal(r.acao, 'RECUSAR');
    assert.match(String(r.mensagemBloqueio || ''), /Disponível: 20/);
    assert.ok(!String(r.mensagemBloqueio || '').includes('Disponível: 0'));
  });

  it('TESTE B — NÃO: inclui no carrinho sem transferência (estoque NF cobre a qtd)', () => {
    const r = avaliarFluxoInclusaoPdv({
      quantidade: 5,
      saldoFiscal: 0,
      saldoNaoFiscal: 20,
      modoFiscal: true,
      respostaTransferencia: false
    });
    assert.equal(r.acao, 'INCLUIR');
    assert.equal(r.quantidadeTransferir, 0);
    assert.equal(r.mensagemBloqueio, null);
  });

  it('TESTE C — SIM: intenção 5 e saldo NÃO muda no clique', () => {
    const r = avaliarFluxoInclusaoPdv({
      quantidade: 5,
      saldoFiscal: 0,
      saldoNaoFiscal: 20,
      modoFiscal: true,
      respostaTransferencia: true
    });
    assert.equal(r.acao, 'INCLUIR');
    assert.equal(r.quantidadeTransferir, 5);
    assert.equal(r.saldoNaoAlteraNoSim, true);
    const prep = prepararEntradasMotorComTransferenciaPdv([{
      item: {
        produto_id: 1,
        quantidade: 5,
        preco_unitario: 2,
        transferencia_nao_fiscal_para_fiscal: r.quantidadeTransferir
      },
      saldoFiscal: 0,
      saldoNaoFiscal: 20
    }]);
    assert.equal(prep.sucesso, true);
    assert.equal(prep.aplicacoes[0].quantidade, 5);
  });

  it('TESTE F — fiscal suficiente: nenhuma pergunta', () => {
    const r = avaliarFluxoInclusaoPdv({
      quantidade: 20,
      saldoFiscal: 30,
      saldoNaoFiscal: 10,
      modoFiscal: true
    });
    assert.equal(r.acao, 'INCLUIR');
    assert.equal(r.devePerguntar, false);
    assert.equal(r.quantidadeTransferir, 0);
  });

  it('TESTE G — NF insuficiente: nenhuma transferência inválida', () => {
    const r = avaliarFluxoInclusaoPdv({
      quantidade: 20,
      saldoFiscal: 18,
      saldoNaoFiscal: 1,
      modoFiscal: true
    });
    assert.equal(r.acao, 'RECUSAR');
    assert.equal(r.quantidadeTransferir, 0);
    const prep = prepararEntradasMotorComTransferenciaPdv([{
      item: {
        produto_id: 1,
        quantidade: 20,
        transferencia_nao_fiscal_para_fiscal: 2
      },
      saldoFiscal: 18,
      saldoNaoFiscal: 1
    }]);
    assert.equal(prep.sucesso, false);
  });

  it('TESTE I — dois produtos: só o com déficit tem intenção', () => {
    const prep = prepararEntradasMotorComTransferenciaPdv([
      {
        item: { produto_id: 1, quantidade: 5, preco_unitario: 1, transferencia_nao_fiscal_para_fiscal: 0 },
        saldoFiscal: 40,
        saldoNaoFiscal: 0
      },
      {
        item: { produto_id: 2, quantidade: 5, preco_unitario: 1, transferencia_nao_fiscal_para_fiscal: 5 },
        saldoFiscal: 0,
        saldoNaoFiscal: 20
      }
    ]);
    assert.equal(prep.sucesso, true);
    assert.equal(prep.aplicacoes.length, 1);
    assert.equal(prep.aplicacoes[0].produto_id, 2);
    assert.equal(prep.aplicacoes[0].quantidade, 5);
    assert.equal(prep.entradas[0].saldoFiscal, 40);
  });

  it('TESTE J — nova inclusão não reutiliza decisão anterior', () => {
    const primeira = avaliarFluxoInclusaoPdv({
      quantidade: 5,
      saldoFiscal: 0,
      saldoNaoFiscal: 20,
      modoFiscal: true,
      respostaTransferencia: true
    });
    const segunda = avaliarFluxoInclusaoPdv({
      quantidade: 3,
      saldoFiscal: 0,
      saldoNaoFiscal: 20,
      modoFiscal: true
    });
    assert.equal(primeira.quantidadeTransferir, 5);
    assert.equal(segunda.acao, 'PERGUNTAR');
    assert.equal(segunda.quantidadeTransferir, 3);
  });
});

describe('Integração real — intenção → MTS → Motor → baixa → commit', () => {
  it('TESTE D — F=0 NF=20 qtd=5 SIM: transfere 5 só na finalização; Motor depois', async () => {
    const db = await setupDb();
    try {
      await run(
        db,
        `INSERT INTO produtos (nome, saldo_fiscal, saldo_nao_fiscal, estoque_atual, item_fiscal)
         VALUES ('Arroz', 0, 20, 20, 1)`
      );
      const item = {
        produto_id: 1,
        quantidade: 5,
        preco_unitario: 10,
        subtotal: 50,
        transferencia_nao_fiscal_para_fiscal: 5
      };

      const antes = await get(db, 'SELECT * FROM produtos WHERE id = 1');
      assert.equal(Number(antes.saldo_fiscal), 0);
      assert.equal(Number(antes.saldo_nao_fiscal), 20);

      const prep = prepararEntradasMotorComTransferenciaPdv([
        { item, saldoFiscal: 0, saldoNaoFiscal: 20 }
      ]);
      assert.equal(prep.sucesso, true);
      assert.equal(prep.aplicacoes[0].quantidade, 5);

      const aindaAntes = await get(db, 'SELECT * FROM produtos WHERE id = 1');
      assert.equal(Number(aindaAntes.saldo_fiscal), 0, 'SIM não altera saldo antes da finalização');
      assert.equal(Number(aindaAntes.saldo_nao_fiscal), 20);

      await estoqueSaldosPublico.executarEmTransacao(async (txDb) => {
        await aplicarTransferenciasPdv(prep.aplicacoes, {
          db: txDb,
          usuarioId: 9,
          jaEmTransacao: true
        });
        const aposMts = await get(txDb, 'SELECT * FROM produtos WHERE id = 1');
        assert.equal(Number(aposMts.saldo_fiscal), 5);
        assert.equal(Number(aposMts.saldo_nao_fiscal), 15);
        assert.equal(Number(aposMts.estoque_atual), 20);
        assert.equal(Number(aposMts.item_fiscal), 1);

        const motor = distribuirItensVendaComValorFiscalEfetivo(prep.entradas, true, {
          pagamentos: [{ forma_pagamento: 'pix', valor: 50 }]
        });
        assert.equal(motor.sucesso, true);
        assert.equal(Number(motor.itens[0].quantidade_fiscal), 5);
        assert.equal(Number(motor.itens[0].quantidade_nao_fiscal), 0);

        await run(
          txDb,
          `UPDATE produtos
           SET saldo_fiscal = saldo_fiscal - ?,
               estoque_atual = (saldo_fiscal - ?) + saldo_nao_fiscal
           WHERE id = 1`,
          [5, 5]
        );
      }, { db });

      const depois = await get(db, 'SELECT * FROM produtos WHERE id = 1');
      assert.equal(Number(depois.saldo_fiscal), 0);
      assert.equal(Number(depois.saldo_nao_fiscal), 15);
      assert.equal(Number(depois.estoque_atual), 15);

      const movs = await all(db, 'SELECT * FROM movimentos_transferencia_saldos');
      assert.equal(movs.length, 1);
      assert.equal(movs[0].origem, 'NAO_FISCAL');
      assert.equal(movs[0].destino, 'FISCAL');
      assert.equal(Number(movs[0].quantidade), 5);
      assert.equal(movs[0].motivo, MOTIVO_TRANSFERENCIA_PDV);
    } finally {
      await closeDb(db);
    }
  });

  it('TESTE E — parcial 18+10 venda 20: transfere exatamente 2 na finalização', async () => {
    const db = await setupDb();
    try {
      await run(
        db,
        `INSERT INTO produtos (nome, saldo_fiscal, saldo_nao_fiscal, estoque_atual)
         VALUES ('Arroz', 18, 10, 28)`
      );
      const item = {
        produto_id: 1,
        quantidade: 20,
        preco_unitario: 1,
        subtotal: 20,
        transferencia_nao_fiscal_para_fiscal: 2
      };
      const prep = prepararEntradasMotorComTransferenciaPdv([
        { item, saldoFiscal: 18, saldoNaoFiscal: 10 }
      ]);
      assert.equal(prep.aplicacoes[0].quantidade, 2);
      await aplicarTransferenciasPdv(prep.aplicacoes, { db, jaEmTransacao: false });
      const prod = await get(db, 'SELECT * FROM produtos WHERE id = 1');
      assert.equal(Number(prod.saldo_fiscal), 20);
      assert.equal(Number(prod.saldo_nao_fiscal), 8);
      const motor = distribuirItensVendaComValorFiscalEfetivo(prep.entradas, true, {
        pagamentos: [{ forma_pagamento: 'pix', valor: 20 }]
      });
      assert.equal(Number(motor.itens[0].quantidade_fiscal), 20);
    } finally {
      await closeDb(db);
    }
  });

  it('TESTE H — falha na finalização: nenhuma transferência persistida', async () => {
    const db = await setupDb();
    try {
      await run(
        db,
        `INSERT INTO produtos (nome, saldo_fiscal, saldo_nao_fiscal, estoque_atual)
         VALUES ('Arroz', 0, 20, 20)`
      );
      const prep = prepararEntradasMotorComTransferenciaPdv([{
        item: {
          produto_id: 1,
          quantidade: 5,
          transferencia_nao_fiscal_para_fiscal: 5
        },
        saldoFiscal: 0,
        saldoNaoFiscal: 20
      }]);
      let falhou = false;
      try {
        await estoqueSaldosPublico.executarEmTransacao(async (txDb) => {
          await aplicarTransferenciasPdv(prep.aplicacoes, {
            db: txDb,
            jaEmTransacao: true
          });
          throw new Error('falha finalizacao');
        }, { db });
      } catch (err) {
        falhou = /falha finalizacao/.test(String(err.message));
      }
      assert.equal(falhou, true);
      const prod = await get(db, 'SELECT * FROM produtos WHERE id = 1');
      assert.equal(Number(prod.saldo_fiscal), 0);
      assert.equal(Number(prod.saldo_nao_fiscal), 20);
      const movs = await all(db, 'SELECT COUNT(*) AS c FROM movimentos_transferencia_saldos');
      assert.equal(Number(movs[0].c), 0);
    } finally {
      await closeDb(db);
    }
  });
});
