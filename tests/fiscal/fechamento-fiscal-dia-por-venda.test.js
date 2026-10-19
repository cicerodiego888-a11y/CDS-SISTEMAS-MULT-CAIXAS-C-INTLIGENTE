'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const sqlite3 = require('sqlite3').verbose();
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PerformanceMonitor = require('../../backend/observabilidade/performance/PerformanceMonitor');
const { gerarPreviaDistribuicaoNoWorker } = require('../../backend/services/fechamento-fiscal/FechamentoFiscalDistribuicaoWorker');
const {
  listarVendasElegiveisRecebimento,
  salvarRecebimentosVendas,
  gerarPrevia,
  obterPorId,
  listarComprovantesRecebimento,
  salvarComprovantesRecebimento,
  gerarPreviaPorComprovante
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalService');
const { gerarPreviaDistribuicao } = require('../../backend/services/fechamento-fiscal/FechamentoFiscalDistribuicaoService');
const { listarLotesElegiveisDoDia } = require('../../backend/services/fechamento-fiscal/FechamentoFiscalElegibilidadeService');
const { mapearPagamentosPorComprovante } = require('../../backend/services/fechamento-fiscal/FechamentoFiscalPreparacaoService');
const { garantirSchemaFechamentoFiscal } = require('../../backend/services/fechamento-fiscal/schema/fechamentoFiscalSchema');

function abrirDb() {
  return new sqlite3.Database(':memory:');
}

function executar(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

function criarLotesComValores(valorCentavos) {
  return valorCentavos.map((valor, index) => ({
    produto_id: index + 1,
    nome: `Produto teste ${index + 1}`,
    unidade: 'UN',
    venda_id: 200 + index,
    venda_item_id: 300 + index,
    quantidade_disponivel: 1,
    valor_disponivel: valor / 100,
    preco_unitario: valor / 100,
    unit_cents: valor,
    fracionado: false,
    saldo_fiscal: 1
  }));
}

async function prepararCenario(db) {
  await executar(db, `CREATE TABLE fechamentos_fiscais (
    id INTEGER PRIMARY KEY, data_fechamento TEXT NOT NULL, cnpj TEXT DEFAULT '',
    valor_informado REAL DEFAULT 0, valor_distribuido REAL DEFAULT 0, diferenca REAL DEFAULT 0,
    valor_alvo REAL DEFAULT 250, valor_min REAL DEFAULT 8, valor_max REAL DEFAULT 500,
    status TEXT DEFAULT 'RASCUNHO', quantidade_maquinas INTEGER NOT NULL DEFAULT 0,
    atualizado_em TEXT
  )`);
  await executar(db, `CREATE TABLE fechamentos_fiscais_previa_itens (
    id INTEGER PRIMARY KEY, previa_venda_id INTEGER, fechamento_fiscal_id INTEGER,
    produto_id INTEGER, venda_origem_id INTEGER, venda_item_origem_id INTEGER,
    quantidade REAL, valor_unitario REAL, valor_total REAL, unidade TEXT, ordem INTEGER,
    criado_em TEXT
  )`);
  await executar(db, `CREATE TABLE fechamentos_fiscais_recebimentos_vendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, fechamento_fiscal_id INTEGER,
    venda_id INTEGER, valor_venda REAL, valor_comprovante REAL, diferenca REAL,
    observacao TEXT, criado_em TEXT, atualizado_em TEXT,
    UNIQUE(fechamento_fiscal_id, venda_id)
  )`);
  await executar(db, `CREATE TABLE vendas (
    id INTEGER PRIMARY KEY, codigo TEXT, data_venda TEXT, total REAL,
    valor_fiscal REAL DEFAULT 0, valor_nao_fiscal REAL DEFAULT 0,
    status TEXT, cancelada INTEGER DEFAULT 0
  )`);
  await executar(db, `CREATE TABLE vendas_itens (
    id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER, quantidade REAL,
    quantidade_fiscal REAL, quantidade_nao_fiscal REAL, subtotal REAL,
    valor_fiscal REAL, valor_nao_fiscal REAL, preco_unitario REAL
  )`);
  await executar(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY, nome TEXT, codigo TEXT, item_fiscal INTEGER,
    saldo_fiscal REAL, saldo_nao_fiscal REAL, preco_venda REAL DEFAULT 0
  )`);
  await executar(db, `CREATE TABLE financeiro (id INTEGER PRIMARY KEY, valor REAL)`);
  await executar(db, `INSERT INTO fechamentos_fiscais (id, data_fechamento, cnpj) VALUES (1, '2026-10-01', '123')`);
  await executar(db, `INSERT INTO produtos VALUES (1, 'Produto elegível', 'P1', 1, 10, 0, 50)`);
  await executar(db, `INSERT INTO financeiro VALUES (1, 50)`);
  await executar(db, `INSERT INTO vendas
    (id, codigo, data_venda, total, valor_fiscal, valor_nao_fiscal, status, cancelada) VALUES
    (1250, 'V-1250', '2026-10-01 10:15:00', 50.00, 50, 0, 'concluida', 0),
    (1251, 'V-1251', '2026-10-01 10:32:00', 75.00, 75, 0, 'concluida', 0),
    (1252, 'V-1252', '2026-10-01 11:02:00', 100.00, 100, 0, 'cancelada', 1),
    (1253, 'V-1253', '2026-10-02 09:00:00', 999.00, 999, 0, 'concluida', 0)`);
  await executar(db, `INSERT INTO vendas_itens VALUES
    (1, 1250, 1, 1, 1, 0, 50, 50, 0, 50),
    (2, 1250, 1, 1, 1, 0, 50, 50, 0, 50),
    (3, 1251, 1, 1, 1, 0, 75, 75, 0, 75),
    (4, 1252, 1, 1, 1, 0, 100, 100, 0, 100),
    (5, 1253, 1, 1, 1, 0, 999, 999, 0, 999)`);
  await executar(db, `INSERT INTO fechamentos_fiscais_previa_itens
    (fechamento_fiscal_id, venda_item_origem_id, quantidade) VALUES (1, 1, 1), (1, 2, 1)`);
}

describe('Worker de distribuição da prévia fiscal', () => {
  it('timeout encerra o worker antes de iniciar a próxima tarefa da fila', async () => {
    let workerCount = 0;
    let firstWorkerTerminated = false;
    let secondStartedAfterTermination = false;
    const criarWorker = () => {
      const workerId = ++workerCount;
      const worker = new EventEmitter();
      worker.postMessage = () => {
        if (workerId === 2) {
          setImmediate(() => worker.emit('message', { ok: true, resultado: { fila: workerId } }));
        }
      };
      worker.terminate = () => new Promise((resolve) => {
        setTimeout(() => {
          if (workerId === 1) firstWorkerTerminated = true;
          worker.emit('exit', 1);
          resolve(1);
        }, workerId === 1 ? 20 : 0);
      });
      if (workerId === 2) secondStartedAfterTermination = firstWorkerTerminated;
      return worker;
    };
    const deps = { criarWorker, timeoutMs: 10 };

    const primeira = gerarPreviaDistribuicaoNoWorker({}, { correlationId: 'worker-timeout-1' }, deps);
    const segunda = gerarPreviaDistribuicaoNoWorker({}, { correlationId: 'worker-timeout-2' }, deps);

    await assert.rejects(
      primeira,
      (erro) => erro.code === 'PREVIA_WORKER_TIMEOUT'
    );
    assert.deepEqual(await segunda, { fila: 2 });
    assert.equal(firstWorkerTerminated, true);
    assert.equal(secondStartedAfterTermination, true);
  });

  it('saída normal sem message rejeita a tarefa e não prende a fila', async () => {
    let workerCount = 0;
    const criarWorker = () => {
      const workerId = ++workerCount;
      const worker = new EventEmitter();
      worker.postMessage = () => {
        if (workerId === 1) setImmediate(() => worker.emit('exit', 0));
        else setImmediate(() => worker.emit('message', { ok: true, resultado: { fila: workerId } }));
      };
      worker.terminate = async () => {
        worker.emit('exit', 1);
        return 1;
      };
      return worker;
    };
    const deps = { criarWorker, timeoutMs: 100 };
    const primeira = gerarPreviaDistribuicaoNoWorker({}, { correlationId: 'worker-exit-1' }, deps);
    const segunda = gerarPreviaDistribuicaoNoWorker({}, { correlationId: 'worker-exit-2' }, deps);

    await assert.rejects(
      primeira,
      (erro) => erro.code === 'PREVIA_WORKER_NO_RESULT'
    );
    assert.deepEqual(await segunda, { fila: 2 });
  });
});

describe('Sprint por comprovante — informar comprovantes', () => {
  it('usa a elegibilidade oficial, retorna vendas reais uma vez e não persiste ao consultar', async () => {
    const db = abrirDb();
    await prepararCenario(db);

    const lotes = await listarLotesElegiveisDoDia(db, '2026-10-01', { excluirFechamentoId: 1 });
    const idsOficiais = [...new Set(lotes.map((lote) => lote.venda_id))];
    const lista = await listarVendasElegiveisRecebimento(db, 1, '2026-10-01');
    const quantidadePersistida = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) AS total FROM fechamentos_fiscais_recebimentos_vendas', (err, row) => err ? reject(err) : resolve(row.total));
    });

    assert.deepEqual(lista.vendas.map((venda) => venda.venda_id), idsOficiais);
    assert.deepEqual(lista.vendas.map((venda) => venda.venda_id), [1250, 1251]);
    assert.equal(lista.vendas[0].codigo, 'V-1250');
    assert.equal(lista.vendas[0].data_hora, '2026-10-01 10:15:00');
    assert.equal(lista.vendas[0].valor_venda, 50);
    assert.equal(new Set(lista.vendas.map((venda) => venda.venda_id)).size, lista.vendas.length);
    assert.equal(quantidadePersistida, 0);

    db.close();
  });

  it('lista pelo dia selecionado mesmo antes de existir fechamento persistido', async () => {
    const db = abrirDb();
    await prepararCenario(db);
    await executar(db, 'DELETE FROM fechamentos_fiscais');

    const lista = await listarVendasElegiveisRecebimento(db, 0, '2026-10-01');
    assert.deepEqual(lista.vendas.map((venda) => venda.venda_id), [1250, 1251]);

    db.close();
  });

  it('calcula diferenças em centavos, totaliza somente comprovantes informados e preserva a venda', async () => {
    const db = abrirDb();
    await prepararCenario(db);
    await executar(db, 'UPDATE vendas SET total = 100 WHERE id = 1250');

    for (const [comprovante, diferenca] of [[100, 0], [98, -2], [105, 5], [98.99, -1.01]]) {
      const resultado = await salvarRecebimentosVendas(db, 1, [{ venda_id: 1250, valor_comprovante: comprovante }]);
      const venda = resultado.vendas.find((item) => item.venda_id === 1250);
      assert.equal(venda.valor_venda, 100);
      assert.equal(venda.valor_comprovante, comprovante);
      assert.equal(venda.diferenca, diferenca);
    }

    const resultado = await listarVendasElegiveisRecebimento(db, 1, '2026-10-01');
    assert.equal(resultado.vendas.length, 2);
    assert.equal(resultado.vendas.find((item) => item.venda_id === 1251).valor_comprovante, null);
    assert.equal(resultado.resumo.total_vendas, 175);
    assert.equal(resultado.resumo.total_comprovantes, 98.99);
    assert.equal(resultado.resumo.diferenca, -1.01);

    const vendaOriginal = await new Promise((resolve, reject) => {
      db.get('SELECT total FROM vendas WHERE id = 1250', (err, row) => err ? reject(err) : resolve(row.total));
    });
    const saldoProduto = await new Promise((resolve, reject) => {
      db.get('SELECT saldo_fiscal FROM produtos WHERE id = 1', (err, row) => err ? reject(err) : resolve(row.saldo_fiscal));
    });
    const valorFinanceiro = await new Promise((resolve, reject) => {
      db.get('SELECT valor FROM financeiro WHERE id = 1', (err, row) => err ? reject(err) : resolve(row.valor));
    });
    assert.equal(vendaOriginal, 100);
    assert.equal(saldoProduto, 10);
    assert.equal(valorFinanceiro, 50);
    db.close();
  });

  it('rejeita comprovante negativo, vazio, inválido e para venda não elegível', async () => {
    const db = abrirDb();
    await prepararCenario(db);

    for (const valor of [-1, '', 'texto', '1e2', 1.001]) {
      await assert.rejects(
        salvarRecebimentosVendas(db, 1, [{ venda_id: 1250, valor_comprovante: valor }]),
        (err) => err.code === 'VALOR_COMPROVANTE_INVALIDO'
      );
    }
    await assert.rejects(
      salvarRecebimentosVendas(db, 1, [{ venda_id: 1253, valor_comprovante: 999 }]),
      (err) => err.code === 'VENDA_NAO_ELEGIVEL'
    );

    const quantidade = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) AS total FROM fechamentos_fiscais_recebimentos_vendas', (err, row) => err ? reject(err) : resolve(row.total));
    });
    assert.equal(quantidade, 0);
    db.close();
  });

  it('associa e recarrega comprovantes pelo identificador da venda', async () => {
    const db = abrirDb();
    await prepararCenario(db);
    await salvarRecebimentosVendas(db, 1, [
      { venda_id: 1251, valor_comprovante: 70 },
      { venda_id: 1250, valor_comprovante: 45 }
    ]);

    const recarregadas = await listarVendasElegiveisRecebimento(db, 1, '2026-10-01');
    assert.equal(recarregadas.vendas.find((item) => item.venda_id === 1250).valor_comprovante, 45);
    assert.equal(recarregadas.vendas.find((item) => item.venda_id === 1251).valor_comprovante, 70);

    const quantidade = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) AS total FROM fechamentos_fiscais_recebimentos_vendas', (err, row) => err ? reject(err) : resolve(row.total));
    });
    assert.equal(quantidade, 2);
    db.close();
  });

  it('limpa um comprovante persistido sem apagar a venda elegível', async () => {
    const db = abrirDb();
    await prepararCenario(db);
    await salvarRecebimentosVendas(db, 1, [{ venda_id: 1250, valor_comprovante: 49 }]);
    const resultado = await salvarRecebimentosVendas(db, 1, [{ venda_id: 1250, valor_comprovante: null }]);

    assert.equal(resultado.vendas.find((venda) => venda.venda_id === 1250).valor_comprovante, null);
    assert.ok(resultado.vendas.some((venda) => venda.venda_id === 1250));
    db.close();
  });

  it('rejeita venda repetida no mesmo payload sem persistência parcial', async () => {
    const db = abrirDb();
    await prepararCenario(db);
    await assert.rejects(
      salvarRecebimentosVendas(db, 1, [
        { venda_id: 1250, valor_comprovante: 45 },
        { venda_id: 1250, valor_comprovante: 46 }
      ]),
      (err) => err.code === 'VENDA_DUPLICADA'
    );
    const quantidade = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) AS total FROM fechamentos_fiscais_recebimentos_vendas', (err, row) => err ? reject(err) : resolve(row.total));
    });
    assert.equal(quantidade, 0);
    db.close();
  });

  it('não altera comprovantes em fechamento já finalizado', async () => {
    const db = abrirDb();
    await prepararCenario(db);
    await executar(db, "UPDATE fechamentos_fiscais SET status = 'AUTORIZADO' WHERE id = 1");

    await assert.rejects(
      salvarRecebimentosVendas(db, 1, [{ venda_id: 1250, valor_comprovante: 50 }]),
      (err) => err.code === 'FECHAMENTO_BLOQUEADO'
    );
    const quantidade = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) AS total FROM fechamentos_fiscais_recebimentos_vendas', (err, row) => err ? reject(err) : resolve(row.total));
    });
    assert.equal(quantidade, 0);
    db.close();
  });

  it('alimenta o motor existente com a soma dos comprovantes, sem usar vendas sem comprovante', async () => {
    const db = abrirDb();
    await prepararCenario(db);
    await salvarRecebimentosVendas(db, 1, [
      { venda_id: 1250, valor_comprovante: 98 },
      { venda_id: 1251, valor_comprovante: 50 }
    ]);

    const vendas = (await listarVendasElegiveisRecebimento(db, 1, '2026-10-01')).vendas;
    const totalInformado = vendas.reduce((soma, venda) => soma + (venda.valor_comprovante == null ? 0 : Math.round(venda.valor_comprovante * 100)), 0) / 100;
    const resultado = await gerarPrevia({ data: '2026-10-01', valor_informado: totalInformado }, {
      db,
      moduloOn: true,
      capturarSnapshot: false
    });

    assert.equal(totalInformado, 148);
    assert.equal(resultado.previa.valor_informado, 148);
    db.close();
  });

  it('persiste o total no fechamento e recupera comprovantes pelo fechamento e venda', async () => {
    const db = abrirDb();
    await prepararCenario(db);
    await new Promise((resolve, reject) => {
      garantirSchemaFechamentoFiscal(db, (err) => err ? reject(err) : resolve());
    });
    await salvarRecebimentosVendas(db, 1, [
      { venda_id: 1250, valor_comprovante: 98 },
      { venda_id: 1251, valor_comprovante: 50 }
    ]);

    const previa = await gerarPrevia({
      id: 1,
      data: '2026-10-01',
      valor_informado: 148,
      persistir: true
    }, { db, moduloOn: true, capturarSnapshot: false });
    const fechamento = await obterPorId(1, { db });
    const vendasRecarregadas = await listarVendasElegiveisRecebimento(db, 1, '2026-10-01');

    assert.equal(previa.previa.valor_informado, 148);
    assert.equal(fechamento.valor_informado, 148);
    assert.equal(vendasRecarregadas.vendas.find((venda) => venda.venda_id === 1250).valor_comprovante, 98);
    assert.equal(vendasRecarregadas.vendas.find((venda) => venda.venda_id === 1251).valor_comprovante, 50);
    db.close();
  });

  it('envia zero ao mesmo motor quando nenhum comprovante foi informado', async () => {
    const db = abrirDb();
    await prepararCenario(db);
    const resultado = await gerarPrevia({ data: '2026-10-01', valor_informado: 0 }, {
      db,
      moduloOn: true,
      capturarSnapshot: false
    });

    assert.equal(resultado.previa.valor_informado, 0);
    assert.equal(resultado.previa.quantidade_vendas, 0);
    db.close();
  });

  it('gera uma venda composta por comprovante, preservando ordem e sem agrupar valores', async () => {
    const db = abrirDb();
    await prepararCenario(db);
    await new Promise((resolve, reject) => {
      garantirSchemaFechamentoFiscal(db, (err) => err ? reject(err) : resolve());
    });
    await executar(db, 'DELETE FROM fechamentos_fiscais_previa_itens WHERE fechamento_fiscal_id = 1');

    const resultado = await gerarPrevia({
      id: 1,
      data: '2026-10-01',
      valor_informado: 125,
      comprovantes: [50, 75],
      persistir: true
    }, {
      db,
      moduloOn: true,
      capturarSnapshot: false
    });

    assert.equal(resultado.previa.quantidade_vendas, 2);
    assert.deepEqual(resultado.previa.vendas.map((venda) => Number(venda.valor.toFixed(2))), [50, 75]);
    assert.deepEqual(resultado.previa.vendas.map((venda) => venda.itens.reduce((soma, item) => soma + Math.round(item.valor_total * 100), 0)), [5000, 7500]);
    assert.ok(resultado.previa.vendas.every((venda) => venda.itens.length > 0));
    const idsItensOrigem = resultado.previa.vendas.flatMap((venda) => venda.itens.map((item) => item.venda_item_origem_id));
    assert.equal(new Set(idsItensOrigem).size, idsItensOrigem.length);
    assert.deepEqual(resultado.fechamento.previa_vendas.map((venda) => venda.itens[0].nome), ['Produto elegível', 'Produto elegível']);
    assert.equal(resultado.previa.valor_distribuido, 125);
    assert.equal(resultado.previa.diferenca, 0);
    db.close();
  });

  it('mantém um comprovante como uma venda composta e não inventa composição sem estoque compatível', async () => {
    const db = abrirDb();
    await prepararCenario(db);
    await executar(db, 'DELETE FROM fechamentos_fiscais_previa_itens WHERE fechamento_fiscal_id = 1');

    const resultado = await gerarPrevia({
      data: '2026-10-01',
      valor_informado: 125,
      comprovantes: [125],
      persistir: false
    }, {
      db,
      moduloOn: true,
      capturarSnapshot: false
    });

    assert.equal(resultado.previa.quantidade_vendas, 1);
    assert.equal(resultado.previa.vendas[0].valor, 125);
    assert.ok(resultado.previa.vendas[0].itens.length > 1);
    assert.equal(resultado.previa.perfeita, true);
    db.close();
  });

  it('não atribui itens acima do valor de nenhum comprovante sem composição exata', async () => {
    const db = abrirDb();
    await prepararCenario(db);

    const resultado = await gerarPrevia({
      data: '2026-10-01',
      valor_informado: 60,
      comprovantes: [10, 20, 30],
      persistir: false
    }, {
      db,
      moduloOn: true,
      capturarSnapshot: false
    });

    assert.equal(resultado.previa.quantidade_vendas, 0);
    assert.equal(resultado.previa.perfeita, false);
    assert.equal(resultado.previa.incompleta, true);
    assert.deepEqual(resultado.previa.vendas, []);
    assert.equal(resultado.previa.valor_distribuido, 0);
    assert.equal(resultado.previa.desconto, 0);
    assert.equal(resultado.previa.valor_final, 0);
    assert.equal(resultado.previa.diferenca, 60);
    assert.equal(resultado.previa.codigo, 'DIFERENCA_NAO_CONCILIADA');
    assert.match(resultado.previa.mensagem, /Não há regra autorizada de desconto/);
    assert.match(resultado.previa.mensagem, /Comprovantes sem composição/);
    db.close();
  });

  it('compõe cada comprovante individual, inclusive abaixo do mínimo, com soma exata de R$ 55,30', () => {
    const lotes = criarLotesComValores([4150, 285, 1095]);
    const resultado = gerarPreviaPorComprovante(
      [{ valor: 41.50 }, { valor: 2.85 }, { valor: 10.95 }],
      lotes
    );

    assert.equal(resultado.quantidade_vendas, 3);
    assert.deepEqual(resultado.vendas.map((venda) => venda.valor), [41.5, 2.85, 10.95]);
    assert.deepEqual(resultado.vendas.map((venda) => venda.ordem), [1, 2, 3]);
    assert.deepEqual(resultado.vendas.map((venda) =>
      venda.itens.reduce((soma, item) => soma + Math.round(item.valor_total * 100), 0)
    ), [4150, 285, 1095]);
    assert.ok(resultado.vendas.every((venda) => venda.desconto === 0 && venda.itens.length > 0));
    assert.equal(resultado.valor_informado, 55.3);
    assert.equal(resultado.valor_distribuido, 55.3);
    assert.equal(resultado.valor_final, 55.3);
    assert.equal(resultado.diferenca, 0);
    assert.deepEqual(resultado.comprovantes_nao_compostos, []);
    assert.equal(resultado.perfeita, true);
  });

  it('não usa valor mínimo configurado, padrão, vazio ou inválido para descartar comprovantes', () => {
    const comprovante = [{ valor: 2.85 }];
    const lotes = criarLotesComValores([285]);
    const configuracoes = [
      ['mínimo configurado acima do recebimento', { valorMin: 10 }],
      ['mínimo padrão do sistema', { valorMin: 8 }],
      ['mínimo ausente', {}],
      ['mínimo nulo', { valorMin: null }],
      ['mínimo vazio', { valorMin: '' }],
      ['mínimo zero', { valorMin: 0 }],
      ['mínimo inválido', { valorMin: 'inválido' }]
    ];

    for (const [descricao, opcoes] of configuracoes) {
      const resultado = gerarPreviaPorComprovante(comprovante, lotes, opcoes);
      assert.equal(
        resultado.quantidade_vendas,
        1,
        `${descricao}: o recebimento válido de R$ 2,85 deve ser processado`
      );
      assert.equal(resultado.vendas[0].valor, 2.85, descricao);
      assert.equal(resultado.vendas[0].valor_final, 2.85, descricao);
      assert.equal(resultado.diferenca, 0, descricao);
      assert.deepEqual(resultado.comprovantes_nao_compostos, [], descricao);
    }
  });

  it('mínimo inválido ou acima do máximo não expande o limite máximo por comprovante', () => {
    const resultado = gerarPreviaPorComprovante(
      [{ valor: 501 }],
      criarLotesComValores([50100]),
      { valorMin: 1000, valorMax: 500 }
    );

    assert.equal(resultado.quantidade_vendas, 0);
    assert.equal(resultado.diferenca, 501);
    assert.equal(resultado.comprovantes_nao_compostos[0].codigo, 'COMPROVANTE_ACIMA_DO_MAXIMO');
    assert.match(resultado.comprovantes_nao_compostos[0].motivo, /máximo de R\$ 500\.00/);
  });

  it('mantém diferença e explica quando os itens elegíveis não compõem exatamente R$ 2,85', () => {
    const resultado = gerarPreviaPorComprovante(
      [{ valor: 2.85 }],
      criarLotesComValores([150, 150])
    );

    assert.equal(resultado.quantidade_vendas, 0);
    assert.equal(resultado.valor_distribuido, 0);
    assert.equal(resultado.diferenca, 2.85);
    assert.equal(resultado.comprovantes_nao_compostos.length, 1);
    assert.equal(resultado.comprovantes_nao_compostos[0].codigo, 'SEM_COMPOSICAO_EXATA');
    assert.match(resultado.comprovantes_nao_compostos[0].motivo, /não existe uma combinação exata/);
    assert.match(resultado.mensagem, /Comprovantes sem composição: #1 de R\$ 2\.85/);
  });

  it('preserva ordem, associação e formas de pagamento iguais e diferentes por comprovante', async () => {
    const db = abrirDb();
    await prepararCenario(db);
    await new Promise((resolve, reject) => {
      garantirSchemaFechamentoFiscal(db, (err) => err ? reject(err) : resolve());
    });

    await salvarComprovantesRecebimento(db, 1, [
      { operadora: 'PIX 1', valor: 41.50, forma_pagamento: 'pix' },
      { operadora: 'PIX 2', valor: 2.85, forma_pagamento: 'pix' },
      { operadora: 'Débito', valor: 10.95, forma_pagamento: 'cartao_debito' }
    ]);
    const resultado = await listarComprovantesRecebimento(db, 1);
    const previa = gerarPreviaPorComprovante(
      resultado.comprovantes.map((item) => ({ valor: item.valor, ordem: item.ordem + 1 })),
      criarLotesComValores([4150, 285, 1095])
    );
    const pagamentos = mapearPagamentosPorComprovante(
      previa.vendas.map((venda, index) => ({ id: index + 1, sequencia: venda.sequencia, valor: venda.valor })),
      resultado.comprovantes
    );

    assert.deepEqual(resultado.comprovantes.map((item) => item.forma_pagamento), ['pix', 'pix', 'cartao_debito']);
    assert.deepEqual(previa.vendas.map((venda) => venda.ordem), [1, 2, 3]);
    assert.deepEqual(previa.vendas.map((venda) => venda.valor), [41.5, 2.85, 10.95]);
    assert.deepEqual(pagamentos.map((item) => ({
      recebimento_id: item.pagamentos[0].recebimento_id,
      forma_pagamento: item.pagamentos[0].forma_pagamento,
      valor: item.pagamentos[0].valor
    })), resultado.comprovantes.map((item, index) => ({
      recebimento_id: item.id,
      forma_pagamento: resultado.comprovantes[index].forma_pagamento,
      valor: item.valor
    })));
    db.close();
  });

  it('não altera a distribuição POR_MAQUINA ao corrigir a composição por comprovante', () => {
    const resultado = gerarPreviaDistribuicao(
      criarLotesComValores([4150, 285, 1095]),
      55.3,
      { valorAlvo: 55.3, valorMin: 8, valorMax: 400 }
    );

    assert.equal(resultado.valor_informado, 55.3);
    assert.equal(resultado.valor_distribuido, 55.3);
    assert.equal(resultado.valor_final, 55.3);
    assert.equal(resultado.diferenca, 0);
    assert.equal(resultado.desconto, 0);
  });

  it('mantém o seletor, a composição fiscal e os controles de Por Máquina', () => {
    const htmlPath = path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js');
    const source = fs.readFileSync(htmlPath, 'utf8');

    assert.match(source, /Modo de recebimento do Recebimento Fiscal do Dia/);
    assert.match(source, /Por comprovante — Informar comprovantes/);
    assert.match(source, /Pendente de conciliação/);
    assert.doesNotMatch(source, /Por venda — Comprovante por venda/);
    assert.ok(/Composição fiscal sugerida/.test(source));
    assert.ok(/ffdBtnAddMaquina/.test(source));
    assert.ok(/ffdRenderMaquinas/.test(source));
    assert.ok(/modoRecebimento === 'por_maquina'/.test(source));
    assert.ok(/id="ffdConciliacao"/.test(source));
    assert.ok(/ffdPainelRecebimentosMaquina/.test(source));
    assert.ok(/ffdBtnAddMaquina/.test(source));
    assert.ok(/ffdRenderMaquinas/.test(source));
    assert.ok(/ffdSincronizarRecebimentos/.test(source));
    const modoUi = source.match(/function ffdAtualizarModoRecebimentoUi\(\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(modoUi);
    assert.ok(!/ffdSecaoRecebimentos/.test(modoUi));
    const saver = source.match(/async function ffdSalvarComprovantes\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(saver);
    assert.ok(!/ffdEmitirFechamento|ffdTransmitirSefaz|sefaz/i.test(saver));
    const preview = source.match(/async function ffdAtualizarPrevia\(\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(preview);
    assert.ok(!/ffdEmitirFechamento|ffdTransmitirSefaz|sefaz/i.test(preview));
    assert.ok(!/Venda 001|Venda 002|R\$ 120,00|R\$ 90,00/.test(source));
    assert.ok(!/ffdIntervaloEmissao|INICIAR EMISSÃO/.test(source));
    assert.ok(!/composicao\.classList\.toggle/.test(source));
  });

  it('interpreta entrada monetária em centavos e expõe controles do novo contrato por comprovante', () => {
    const htmlPath = path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js');
    const source = fs.readFileSync(htmlPath, 'utf8');
    const parserSource = source.match(/function ffdParseValorCentavos\(valor\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(parserSource);
    const parser = vm.runInNewContext(`(${parserSource})`);

    assert.equal(parser('100,00'), 10000);
    assert.equal(parser('98,00'), 9800);
    assert.equal(parser('1.234,56'), 123456);
    assert.equal(parser('0,01'), 1);
    assert.equal(parser(''), null);
    assert.equal(parser('-1,00'), undefined);
    assert.equal(parser('inválido'), undefined);
    assert.equal(parser('90071992547410,00'), undefined);
    assert.ok(/ffdBtnAddMaquina/.test(source));
    assert.ok(/ffdRenderMaquinas/.test(source));
    assert.ok(/ffdTotalInformado/.test(source));
    assert.ok(/ffdBtnSalvarComprovantes/.test(source));
  });

  it('usa o mesmo total adapter para a conciliação nos dois modos', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
    const totalSource = source.match(/function ffdTotalRecebimentos\(\) \{[\s\S]*?\n\}/)?.[0];
    const parserSource = source.match(/function ffdParseValorCentavos\(valor\) \{[\s\S]*?\n\}/)?.[0];
    const referenciaSource = source.match(/function ffdValorReferenciaConciliacao\(\) \{[\s\S]*?\n\}/)?.[0];
    const diferencaSource = source.match(/function ffdDiferencaConciliacao\(\) \{[\s\S]*?\n\}/)?.[0];
    const conciliadoSource = source.match(/function ffdRecebimentosConciliados\(\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(totalSource);
    assert.ok(parserSource);
    assert.ok(referenciaSource);
    assert.ok(diferencaSource);
    assert.ok(conciliadoSource);
    const context = {
      __ffdEstado: {
        modoRecebimento: 'por_venda',
        vendasElegiveis: [
          { venda_id: 1, valor_comprovante: 98 },
          { venda_id: 2, valor_comprovante: 50 },
          { venda_id: 3, valor_comprovante: null }
        ],
        recebimentos: [{ valor: 900 }],
        previa: { valor_distribuido: 150, valor_informado: 148, vendas: [{}] },
        resumo: { valor_fiscal_elegivel: 230 }
      }
    };
    vm.createContext(context);
    vm.runInContext([
      parserSource,
      totalSource,
      referenciaSource,
      diferencaSource,
      conciliadoSource
    ].join('\n'), context);
    assert.equal(context.ffdTotalRecebimentos(), 148);
    assert.equal(context.ffdDiferencaConciliacao(), 2);
    assert.equal(context.ffdRecebimentosConciliados(), false);
    context.__ffdEstado.previa.valor_distribuido = 148;
    assert.equal(context.ffdDiferencaConciliacao(), 0);
    assert.equal(context.ffdRecebimentosConciliados(), true);

    context.__ffdEstado.modoRecebimento = 'por_maquina';
    assert.equal(context.ffdTotalRecebimentos(), 900);
    assert.ok(/valor_informado:\s*total/.test(source));
    assert.ok(/if \(__ffdEstado\.modoRecebimento !== 'por_venda'\)/.test(source));
  });

  it('processa a fila em ordem, aguarda o resultado antes do intervalo e não espera após a última venda', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
    const escolher = source.match(/function ffdEscolherIntervaloEmissaoMs\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
    const fila = source.match(/async function ffdExecutarFilaSequencial\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(escolher);
    assert.ok(fila);
    const context = { console, Math, Date };
    vm.createContext(context);
    vm.runInContext(`${escolher}\n${fila}`, context);

    const eventos = [];
    let emissaoAtiva = 0;
    let emissaoMaxima = 0;
    const intervalos = [60000, 300000];
    let indiceIntervalo = 0;
    const resultado = await context.ffdExecutarFilaSequencial([
      { venda_id: 1, codigo: 'A' },
      { venda_id: 2, codigo: 'B' },
      { venda_id: 3, codigo: 'C' }
    ], {
      consultarSituacao: async (id) => {
        eventos.push(`status:${id}`);
        return { nfce_situacao_fiscal: 'SEM_DOCUMENTO' };
      },
      emitirVenda: async (id) => {
        emissaoAtiva += 1;
        emissaoMaxima = Math.max(emissaoMaxima, emissaoAtiva);
        eventos.push(`emitir:${id}:inicio`);
        await Promise.resolve();
        eventos.push(`emitir:${id}:resultado`);
        emissaoAtiva -= 1;
        return id === 2
          ? { success: false, status: 'rejeitada', message: 'Rejeição fiscal' }
          : { success: true, status: 'autorizada', notaId: id, chaveAcesso: `chave-${id}` };
      },
      escolherIntervaloMs: () => intervalos[indiceIntervalo++],
      esperarIntervalo: async (ms, tick) => {
        eventos.push(`intervalo:${ms}`);
        tick(ms);
        tick(0);
      },
      atualizarEstado: () => {},
      registrarLog: () => {},
      agora: () => '2026-10-01T12:00:00.000Z'
    });

    assert.deepEqual(eventos.filter((evento) => evento.startsWith('emitir:') && evento.endsWith(':inicio')), [
      'emitir:1:inicio', 'emitir:2:inicio', 'emitir:3:inicio'
    ]);
    assert.ok(eventos.indexOf('emitir:1:resultado') < eventos.indexOf('intervalo:60000'));
    assert.ok(eventos.indexOf('emitir:2:resultado') < eventos.indexOf('intervalo:300000'));
    assert.equal(eventos.filter((evento) => evento.startsWith('intervalo:')).length, 2);
    assert.equal(emissaoMaxima, 1);
    assert.equal(JSON.stringify(resultado.resultados.map((item) => item.status)), JSON.stringify(['AUTORIZADA', 'ERRO', 'AUTORIZADA']));
    assert.equal(resultado.resumo.autorizadas, 2);
    assert.equal(resultado.resumo.erros, 1);
  });

  it('pula autorizadas/canceladas e interrompe a fila diante de situação fiscal pendente', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
    const escolher = source.match(/function ffdEscolherIntervaloEmissaoMs\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
    const fila = source.match(/async function ffdExecutarFilaSequencial\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
    const context = { console, Math, Date };
    vm.createContext(context);
    vm.runInContext(`${escolher}\n${fila}`, context);
    const emitidas = [];
    const resultado = await context.ffdExecutarFilaSequencial([
      { venda_id: 1 },
      { venda_id: 2 },
      { venda_id: 3 },
      { venda_id: 4 }
    ], {
      consultarSituacao: async (id) => ({
        cancelada: id === 2 ? 1 : 0,
        nfce_situacao_fiscal: ({ 1: 'AUTORIZADA', 2: 'SEM_DOCUMENTO', 3: 'PENDENTE', 4: 'SEM_DOCUMENTO' })[id]
      }),
      emitirVenda: async (id) => {
        emitidas.push(id);
        return { success: true, status: 'autorizada' };
      },
      escolherIntervaloMs: () => 60000,
      esperarIntervalo: async () => {},
      atualizarEstado: () => {},
      registrarLog: () => {},
      agora: () => '2026-10-01T12:00:00.000Z'
    });

    assert.deepEqual(emitidas, []);
    assert.equal(JSON.stringify(resultado.resultados.map((item) => item.status)), JSON.stringify([
      'JA_AUTORIZADA', 'CANCELADA', 'BLOQUEADA'
    ]));
    assert.equal(resultado.resumo.ja_autorizadas, 1);
    assert.equal(resultado.resumo.bloqueadas, 2);
    assert.equal(resultado.status, 'BLOCKED');
  });

  it('não inicia a venda seguinte se a resposta da emissão anterior for indeterminada', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
    const fila = source.match(/async function ffdExecutarFilaSequencial\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
    const escolher = source.match(/function ffdEscolherIntervaloEmissaoMs\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(fila && escolher);
    const context = { console, Number, FFD_INTERVALO_PADRAO_MS: 120000, ffdEscolherIntervaloEmissaoMs: () => 0 };
    vm.createContext(context);
    vm.runInContext(`${escolher}\n${fila}`, context);

    const emitidas = [];
    const resultado = await context.ffdExecutarFilaSequencial([
      { venda_id: 1 },
      { venda_id: 2 }
    ], {
      consultarSituacao: async () => ({ nfce_situacao_fiscal: 'SEM_DOCUMENTO' }),
      emitirVenda: async (id) => {
        emitidas.push(id);
        throw new Error('Tempo esgotado; resultado fiscal desconhecido.');
      },
      esperarIntervalo: async () => assert.fail('A fila não deve aguardar e continuar após resultado indeterminado.'),
      atualizarEstado: () => {},
      registrarLog: () => {},
      agora: () => '2026-10-16T12:00:00.000Z'
    });

    assert.deepEqual(emitidas, [1]);
    assert.equal(resultado.status, 'BLOCKED');
    assert.equal(resultado.resultados[0].status, 'INDETERMINADA');
    assert.equal(resultado.resumo.indeterminadas, 1);
  });

  it('usa intervalo padrão ou configurado sem teto arbitrário, persiste a preferência e testa o relógio sem espera real', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
    const constantes = source.match(/const FFD_INTERVALO_STORAGE_KEY = [\s\S]*?const FFD_INTERVALO_MAX_MINUTOS = [^\n]+;/)?.[0] || '';
    const funcoes = [
      'ffdValidarIntervaloConfiguracao',
      'ffdCarregarConfiguracaoIntervalo',
      'ffdSalvarConfiguracaoIntervalo',
      'ffdEscolherIntervaloEmissaoMs',
      'ffdAguardarCountdown',
      'ffdReservarFilaEmissao'
    ].map((nome) => source.match(new RegExp(`(?:async )?function ${nome}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0] || '');
    const countdown = source.match(/function ffdAguardarCountdown\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
    const reservar = source.match(/function ffdReservarFilaEmissao\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(constantes && funcoes.every(Boolean) && countdown && reservar);
    const store = {
      data: {},
      getItem(key) { return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null; },
      setItem(key, value) { this.data[key] = String(value); },
      removeItem(key) { delete this.data[key]; }
    };
    const context = { console, Math, Date, Number, JSON, localStorage: store };
    vm.createContext(context);
    vm.runInContext(`${constantes}\n${funcoes.join('\n')}`, context);
    assert.equal(context.ffdEscolherIntervaloEmissaoMs(), 120000);
    for (const [segundos, ms] of [[45, 45000], [60, 60000], [180, 180000], [600, 600000]]) {
      const minutos = Math.floor(segundos / 60);
      const resto = segundos % 60;
      const salvo = context.ffdSalvarConfiguracaoIntervalo(String(minutos), String(resto));
      assert.equal(salvo.ok, true);
      assert.equal(salvo.ms, ms);
      assert.equal(context.ffdEscolherIntervaloEmissaoMs(), ms);
      const recarregado = {
        console, Math, Date, Number, JSON, localStorage: store
      };
      vm.createContext(recarregado);
      vm.runInContext(`${constantes}\n${funcoes.slice(0, 4).join('\n')}`, recarregado);
      assert.equal(recarregado.ffdCarregarConfiguracaoIntervalo().ms, ms);
    }

    assert.equal(context.ffdSalvarConfiguracaoIntervalo('', '').ms, 120000);
    assert.equal(context.ffdEscolherIntervaloEmissaoMs(), 120000);
    assert.equal(store.getItem('ffd_intervalo_emissao'), null);
    for (const [minutos, segundos] of [['-1', '0'], ['abc', '0'], ['1.5', '0'], ['0', '-1'], [String(Number.MAX_SAFE_INTEGER), '0']]) {
      assert.equal(context.ffdValidarIntervaloConfiguracao(minutos, segundos).ok, false);
    }
    assert.equal(context.ffdValidarIntervaloConfiguracao('0', '600').ms, 600000);

    let agora = 0;
    let tick;
    let cleared = false;
    const countdowns = [];
    const aguardando = context.ffdAguardarCountdown(2000, (restante) => countdowns.push(restante), {
      now: () => agora,
      setInterval: (callback) => { tick = callback; return 7; },
      clearInterval: (id) => { cleared = id === 7; }
    });
    agora = 1000;
    tick();
    agora = 2000;
    tick();
    await aguardando;
    assert.deepEqual(countdowns, [2000, 1000, 0]);
    assert.equal(cleared, true);

    let avancar = false;
    const esperaAntecipada = context.ffdAguardarCountdown(600000, () => {}, {
      now: () => agora,
      setInterval: (callback) => { tick = callback; return 8; },
      clearInterval: (id) => { cleared = id === 8; },
      podeAvancarAgora: () => avancar
    });
    avancar = true;
    tick();
    assert.equal(await esperaAntecipada, 'early');
    assert.equal(cleared, true);

    const state = { status: 'IDLE' };
    assert.equal(context.ffdReservarFilaEmissao(state), true);
    assert.equal(context.ffdReservarFilaEmissao(state), false);
    state.status = 'WAITING';
    assert.equal(context.ffdReservarFilaEmissao(state), false);
    state.status = 'COMPLETED';
    assert.equal(context.ffdReservarFilaEmissao(state), true);
    const composicao = source.match(/id="ffdSecaoComposicao"[\s\S]*?(?=<div class="card border-0 shadow-sm mb-3" id="ffdSecaoEmissao")/)?.[0] || '';
    assert.match(composicao, /id="ffdConfiguracaoIntervalo"/);
    assert.match(composicao, /Intervalo entre NFC-e/);
    assert.match(composicao, /for="ffdIntervaloMinutos">Minutos/);
    assert.match(composicao, /for="ffdIntervaloSegundos">Segundos/);
    assert.match(composicao, /Tempo máximo de espera entre o término de uma emissão e o início da próxima\. A próxima venda pode avançar antes, quando estiver pronta\./);
    assert.ok(composicao.indexOf('id="ffdConfiguracaoIntervalo"') < composicao.indexOf('id="ffdVistaVenda"'));
    assert.match(source, /ffdInicializarConfiguracaoIntervalo\(\)/);
    assert.match(source, /Padrão do sistema: 2 minutos\./);
    assert.match(source, /Intervalo personalizado aplicado:/);
    assert.doesNotMatch(source, /Math\.max\(60000,\s*Math\.min\(300000/);
  });

  it('exibe Avançar agora somente durante a espera ativa da fila', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
    const render = source.match(/function ffdRenderFilaEmissao\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(render);
    assert.match(source, /id="ffdPainelFilaEmissao"[\s\S]*?id="ffdBtnAvancarEmissaoAgora"/);
    assert.match(render, /fila\.status !== 'WAITING' \|\| typeof fila\.avancarAgora !== 'function'/);

    const classes = { dNone: false, toggle(name, hidden) { this.dNone = name === 'd-none' ? hidden : this.dNone; } };
    const elementos = {
      ffdPainelFilaEmissao: { classList: { toggle() {} } },
      ffdBtnIniciarEmissaoSequencial: { disabled: false },
      ffdBtnAvancarEmissaoAgora: { classList: classes }
    };
    const context = {
      __ffdEstado: { filaEmissao: { status: 'WAITING', avancarAgora() {} } },
      document: { getElementById: (id) => elementos[id] || null },
      ffdFilaEmissaoPodeIniciar: () => true,
      ffdEsc: (value) => String(value)
    };
    vm.createContext(context);
    vm.runInContext(render, context);
    vm.runInContext('ffdRenderFilaEmissao()', context);
    assert.equal(classes.dNone, false);
    context.__ffdEstado.filaEmissao = { status: 'RUNNING' };
    vm.runInContext('ffdRenderFilaEmissao()', context);
    assert.equal(classes.dNone, true);
  });

  it('bloqueia um segundo início enquanto a primeira fila está ativa', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
    const reservar = source.match(/function ffdReservarFilaEmissao\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
    const iniciar = source.match(/function ffdIniciarFilaEmissao\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.ok(reservar && iniciar);
    let liberarFila;
    let execucoes = 0;
    const context = {
      console,
      __ffdEstado: {
        modoRecebimento: 'por_venda',
        fechamentoId: 1,
        vendasElegiveis: [{ venda_id: 1 }],
        filaEmissao: { status: 'IDLE', resultados: [] }
      },
      ffdFilaEmissaoPodeIniciar: () => true,
      ffdReservarFilaEmissao: null,
      ffdRenderFilaEmissao: () => {},
      ffdNotify: () => {},
      ffdLogDesenvolvimento: () => {},
      ffdSalvarComprovantes: async () => true,
      ffdConsultarSituacaoVendaParaFila: async () => ({ nfce_situacao_fiscal: 'SEM_DOCUMENTO' }),
      ffdEmitirVendaPeloMotorExistente: async () => ({ success: true, status: 'autorizada' }),
      ffdExecutarFilaSequencial: async () => {
        execucoes += 1;
        await new Promise((resolve) => { liberarFila = resolve; });
        return { status: 'COMPLETED' };
      }
    };
    vm.createContext(context);
    vm.runInContext(`${reservar}\n${iniciar}`, context);

    const primeira = context.ffdIniciarFilaEmissao({ locks: null, silencioso: true });
    const segunda = await context.ffdIniciarFilaEmissao({ locks: null, silencioso: true });
    assert.equal(segunda, false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(execucoes, 1, JSON.stringify(context.__ffdEstado.filaEmissao));
    liberarFila();
    await primeira;
  });

  it('consulta a situação fiscal oficial e transmite somente pela rota NFC-e existente', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
    const consultar = source.match(/async function ffdConsultarSituacaoVendaParaFila\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
    const emitir = source.match(/async function ffdEmitirVendaPeloMotorExistente\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
    assert.match(consultar, /\/vendas\/\$\{Number\(vendaId\)\}/);
    assert.match(emitir, /\/fiscal\/emitir\/venda\/\$\{Number\(vendaId\)\}/);
    assert.match(source, /nfce_situacao_fiscal/);
    assert.match(source, /situacao !== 'SEM_DOCUMENTO'/);
    assert.ok(!/Promise\.all\(/.test(source.match(/async function ffdExecutarFilaSequencial\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || ''));
  });

  it('permite cancelar a fila de emissão sem abortar a transmissão em andamento e protege contra recarga', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
    const reservar = source.match(/function ffdReservarFilaEmissao\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
    const cancelar = source.match(/function ffdCancelarFilaEmissao\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
    const protegida = source.match(/function ffdProtegerFilaEmissaoRecarga\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';

    assert.ok(reservar);
    assert.ok(cancelar);
    assert.ok(protegida);

    const context = {
      console,
      Math,
      Date,
      sessionStorage: {
        data: {},
        getItem(key) { return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null; },
        setItem(key, value) { this.data[key] = String(value); },
        removeItem(key) { delete this.data[key]; }
      },
      __ffdEstado: {
        fechamentoId: 99,
        filaEmissao: { status: 'RUNNING', resultados: [{ venda_id: 1 }], mensagem: 'Processando' }
      }
    };
    vm.createContext(context);
    vm.runInContext(`${reservar}\n${cancelar}\n${protegida}`, context);

    assert.equal(context.ffdReservarFilaEmissao(context.__ffdEstado.filaEmissao), false);
    context.ffdCancelarFilaEmissao({ mensagem: 'Emissão interrompida pelo usuário.' });
    assert.equal(context.__ffdEstado.filaEmissao.status, 'CANCELLED');
    assert.equal(context.ffdReservarFilaEmissao(context.__ffdEstado.filaEmissao), false);
    assert.equal(context.ffdProtegerFilaEmissaoRecarga(), false);

    context.__ffdEstado.filaEmissao = { status: 'WAITING', resultados: [{ venda_id: 2 }] };
    context.sessionStorage.setItem('ffd_fila_emissao_guard', JSON.stringify({ fechamentoId: 99, status: 'WAITING', ts: Date.now() }));
    assert.equal(context.ffdProtegerFilaEmissaoRecarga(), true);
  });

  it('salva comprovantes por fechamento sem associação a venda e usa valor informado do fechamento', async () => {
    const db = abrirDb();
    await prepararCenario(db);
    await new Promise((resolve, reject) => {
      garantirSchemaFechamentoFiscal(db, (err) => err ? reject(err) : resolve());
    });

    const resultado = await salvarComprovantesRecebimento(db, 1, [42.38, 10.78, 35]);
    const linhas = await new Promise((resolve, reject) => {
      db.all('SELECT valor, ordem FROM fechamentos_fiscais_recebimentos_comprovantes WHERE fechamento_fiscal_id = ? ORDER BY ordem ASC', [1], (err, rows) => err ? reject(err) : resolve(rows || []));
    });
    const fechamento = await obterPorId(1, { db });

    assert.deepEqual(linhas.map((linha) => Number(linha.valor)), [42.38, 10.78, 35]);
    assert.equal(resultado.total, 88.16);
    assert.equal(fechamento.valor_informado, 88.16);
    assert.equal(linhas.every((linha) => !Object.prototype.hasOwnProperty.call(linha, 'venda_id')), true);
    db.close();
  });

  it('persiste e devolve forma de pagamento própria para cada comprovante', async () => {
    const db = abrirDb();
    await prepararCenario(db);
    await new Promise((resolve, reject) => {
      garantirSchemaFechamentoFiscal(db, (err) => err ? reject(err) : resolve());
    });

    await salvarComprovantesRecebimento(db, 1, [
      { operadora: 'PIX', cnpj: '12345678000199', valor: 25, forma_pagamento: 'pix' },
      { operadora: 'Débito', valor: 40, forma_pagamento: 'cartao_debito' }
    ]);
    const resultado = await listarComprovantesRecebimento(db, 1);

    assert.deepEqual(resultado.comprovantes.map((item) => ({
      valor: item.valor,
      operadora: item.operadora,
      cnpj: item.cnpj,
      forma_pagamento: item.forma_pagamento
    })), [
      { valor: 25, operadora: 'PIX', cnpj: '12345678000199', forma_pagamento: 'pix' },
      { valor: 40, operadora: 'Débito', cnpj: '', forma_pagamento: 'cartao_debito' }
    ]);
    db.close();
  });

  it('permite entrar vários valores em uma mesma máquina antes do clique de adicionar', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
    assert.match(source, /ffdMaqValoresList|data-ffd-maq-valor/);
    assert.match(source, /dados\.valores|Array\.isArray\(.*valores/);
    assert.match(source, /__ffdEstado\.recebimentos\.push\(\s*\{\s*operadora/);
  });

  it('expõe o modo por comprovante na interface e reutiliza o fluxo existente de recebimentos', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
    assert.match(source, /Por comprovante — Informar comprovantes/);
    assert.doesNotMatch(source, /Por venda — Comprovante por venda/);
    assert.doesNotMatch(source, /Comprovantes recebidos/);
    assert.doesNotMatch(source, /ffdSecaoModoComprovante/);
    assert.match(source, /ffdBtnAddMaquina/);
    assert.match(source, /ffdMaquinaModal/);
    assert.match(source, /ffdRenderMaquinas/);
    assert.match(source, /ffdSincronizarRecebimentos/);
    assert.match(source, /fechamentos\/\$\{fechamentoId\}\/recebimentos-comprovantes/);
    assert.match(source, /forma_pagamento: item\.forma_pagamento \|\| null/);
  });

  it('registra etapas e persiste uma única prévia para requests concorrentes idênticos', async (t) => {
    const db = abrirDb();
    const logOriginal = console.log;
    const rastros = [];
    console.log = (...args) => {
      if (String(args[0] || '').startsWith('[FechamentoFiscal] previa_')) {
        try {
          rastros.push({
            evento: String(args[0]).replace('[FechamentoFiscal] ', ''),
            dados: JSON.parse(args[1] || '{}')
          });
        } catch (_) {
          rastros.push({ evento: String(args[0]).replace('[FechamentoFiscal] ', ''), dados: {} });
        }
      }
      logOriginal.apply(console, args);
    };
    t.after(() => {
      console.log = logOriginal;
      PerformanceMonitor.disable();
      db.close();
    });
    await prepararCenario(db);
    await new Promise((resolve, reject) => {
      garantirSchemaFechamentoFiscal(db, (err) => err ? reject(err) : resolve());
    });
    PerformanceMonitor._resetForTests();
    PerformanceMonitor.enable();

    const params = {
      id: 1,
      data: '2026-10-01',
      valor_informado: 125,
      persistir: true
    };
    const deps = { db, moduloOn: true, capturarSnapshot: false };
    const primeira = gerarPrevia(params, deps);
    const segunda = gerarPrevia(params, deps);
    assert.equal(primeira, segunda);
    await assert.rejects(
      gerarPrevia({ ...params, valor_informado: 124 }, deps),
      (err) => err.code === 'PREVIA_EM_ANDAMENTO'
    );
    const [resultadoA, resultadoB] = await Promise.all([primeira, segunda]);
    const eventos = PerformanceMonitor.getReport({ type: 'fiscal:preview:' }).events;
    const resumo = eventos.find((evento) => evento.type === 'fiscal:preview:T2-summary:end');
    const elegibilidade = eventos.find((evento) => evento.type === 'fiscal:preview:T3-eligibility:end');
    const distribuicao = eventos.find((evento) => evento.type === 'fiscal:preview:T7-distribution:end');
    const persistencia = eventos.find((evento) => evento.type === 'fiscal:preview:T9-persistence:end');
    const contagens = eventos.find((evento) => evento.type === 'fiscal:preview:T11-generation-metrics');
    const vendasPersistidas = await new Promise((resolve, reject) => {
      db.get(
        'SELECT COUNT(*) AS n FROM fechamentos_fiscais_previa_vendas WHERE fechamento_fiscal_id = 1',
        (err, row) => err ? reject(err) : resolve(Number(row.n))
      );
    });

    assert.deepEqual(resultadoA.previa.vendas, resultadoB.previa.vendas);
    assert.equal(resultadoA.previa.valor_distribuido, 125);
    assert.equal(vendasPersistidas, 1);
    assert.ok(resumo && resumo.duration >= 0);
    assert.ok(elegibilidade && elegibilidade.duration >= 0);
    assert.ok(distribuicao && distribuicao.duration >= 0);
    assert.ok(persistencia && persistencia.duration >= 0);
    assert.equal(contagens.deletes, 3);
    assert.ok(contagens.inserts > 0);
    assert.equal(contagens.lotes, resultadoA.previa.metricas.linhas_elegiveis);
    assert.ok(contagens.transicoes_avaliadas > 0);
    assert.ok(rastros.some((item) => item.evento === 'previa_geracao_inicio' && item.dados.assinatura));
    assert.ok(rastros.some((item) => item.evento === 'previa_geracao_rejeitada'
      && item.dados.codigo_erro === 'PREVIA_EM_ANDAMENTO'));
    assert.ok(rastros.some((item) => item.evento === 'previa_etapa_inicio'
      && item.dados.etapa === 'T7-distribution'));
    assert.ok(rastros.some((item) => item.evento === 'previa_etapa_fim'
      && item.dados.etapa === 'T9-persistence'));
    assert.ok(rastros.some((item) => item.evento === 'previa_geracao_fim'
      && item.dados.resultado === 'sucesso'));
  });
});
