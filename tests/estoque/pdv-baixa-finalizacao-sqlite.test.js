'use strict';

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-pdv-stock-finalization-'));
const dbDir = path.join(tmpBase, 'db');
const dbPath = path.join(dbDir, 'mercadao.db');
process.env.CDS_TEST_ISOLAR_BANCO = '1';
process.env.DB_DIR = dbDir;
process.env.FISCAL_DIR = path.join(tmpBase, 'fiscal');
fs.mkdirSync(dbDir, { recursive: true });

const ROOT = path.join(__dirname, '../..');
const recalculoPath = require.resolve(path.join(ROOT, 'backend/services/estoqueFiscalService.js'));
const recalculoCacheAnterior = require.cache[recalculoPath];
let chamadasRecalculoHistorico = 0;
require.cache[recalculoPath] = {
  id: recalculoPath,
  filename: recalculoPath,
  loaded: true,
  exports: {
    recalcularSaldosTodosProdutos(_db, callback) {
      chamadasRecalculoHistorico += 1;
      callback(new Error('Recálculo histórico bloqueado no teste.'));
    }
  }
};

let db;
let vendaApplicationService;
let vendaCancelamentoService;
let caixa;
let restaurarDbRun;
const chamadasUpdateSaldo = [];
let ultimaVendaEm = 0;
let sequenciaChaveVendaTeste = 0;

function runOn(conexao, sql, params = []) {
  return new Promise((resolve, reject) => {
    conexao.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function getOn(conexao, sql, params = []) {
  return new Promise((resolve, reject) => {
    conexao.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function prepararBancoTemporario() {
  const bootstrap = new sqlite3.Database(dbPath);
  await runOn(bootstrap, `
    CREATE TABLE configuracoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chave VARCHAR(100) UNIQUE NOT NULL,
      valor TEXT,
      tipo VARCHAR(50),
      descricao TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await runOn(bootstrap, `
    INSERT INTO configuracoes (chave, valor, tipo, descricao)
    VALUES ('migracao_recalc_saldos_estoque_v1', '1', 'teste', 'Migração desabilitada no banco vazio do teste')
  `);
  await new Promise((resolve, reject) => bootstrap.close((err) => (err ? reject(err) : resolve())));
}

function instrumentarBaixas(conexao) {
  const runOriginal = conexao.run;
  conexao.run = function runInstrumentado(...args) {
    const sql = String(args[0] || '');
    const campo = sql.match(/UPDATE\s+produtos\s+SET[\s\S]*?\b(saldo_fiscal|saldo_nao_fiscal)\s*=/i);
    if (!campo) return runOriginal.apply(this, args);

    const parametros = Array.isArray(args[1]) ? args[1] : [];
    const indiceCallback = args.findIndex((arg, index) => index > 0 && typeof arg === 'function');
    const callbackOriginal = indiceCallback >= 0 ? args[indiceCallback] : null;
    if (!callbackOriginal) return runOriginal.apply(this, args);

    const argsInstrumentados = args.slice();
    argsInstrumentados[indiceCallback] = function callbackBaixa(err) {
      chamadasUpdateSaldo.push({
        produto_id: Number(parametros[parametros.length - 1]),
        caminho: campo[1],
        quantidade: Number(parametros[0]),
        erro: err ? err.message : null,
        registros_alterados: Number(this.changes || 0)
      });
      return callbackOriginal.apply(this, arguments);
    };
    return runOriginal.apply(this, argsInstrumentados);
  };
  restaurarDbRun = () => {
    conexao.run = runOriginal;
    restaurarDbRun = null;
  };
}

async function criarCaixaTeste() {
  const caixaRow = await runOn(db, `
    INSERT INTO caixa (data, valor_inicial, status, aberto_por, observacao)
    VALUES (date('now'), 100, 'aberto', 1, 'teste temporário baixa estoque')
  `);
  const sessaoRow = await runOn(db, `
    INSERT INTO caixa_sessoes (caixa_turno_id, operador_id, valor_abertura, aberto_em, status)
    VALUES (?, 1, 100, datetime('now'), 'aberto')
  `, [caixaRow.lastID]);
  return { caixaId: caixaRow.lastID, sessaoId: sessaoRow.lastID };
}

async function criarProduto({
  id,
  saldoFiscal = 10,
  saldoNaoFiscal = 5,
  reservadoFiscal = 0,
  reservadoNaoFiscal = 0,
  itemFiscal = 1,
  controlaEstoque = 1,
  controlaValidade = 0
}) {
  await runOn(db, `
    INSERT INTO produtos (
      id, codigo, nome, nome_busca, unidade, preco_venda, preco_compra,
      estoque_atual, saldo_fiscal, saldo_nao_fiscal, reservado_fiscal,
      reservado_nao_fiscal, item_fiscal, controla_estoque, controlar_validade
    ) VALUES (?, ?, ?, ?, 'UN', 10, 1, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    `PDV-STOCK-${id}`,
    `Produto teste ${id}`,
    `produto teste ${id}`,
    (saldoFiscal || 0) + (saldoNaoFiscal || 0),
    saldoFiscal,
    saldoNaoFiscal,
    reservadoFiscal,
    reservadoNaoFiscal,
    itemFiscal,
    controlaEstoque,
    controlaValidade
  ]);
}

async function criarLoteTeste({ produtoId, lote, quantidade, validade }) {
  const result = await runOn(db, `
    INSERT INTO produtos_lotes (
      produto_id, lote, quantidade_inicial, quantidade_atual,
      data_validade, data_entrada, origem, ativo
    ) VALUES (?, ?, ?, ?, ?, date('now'), 'TESTE_PDV', 1)
  `, [produtoId, lote, quantidade, quantidade, validade]);
  return result.lastID;
}

function fazerRequisicaoVenda({
  produtoId,
  quantidade,
  vendaFiscal,
  formaPagamento = 'dinheiro',
  clienteId = null,
  pagamentos,
  desconto = 0,
  forcar = false,
  parcelas = 1
}) {
  const total = Number((quantidade * 10 - desconto).toFixed(2));
  const body = {
    origem: 'PDV',
    idempotency_key: `pdv-stock-test-${++sequenciaChaveVendaTeste}`,
    cliente_id: clienteId,
    forma_pagamento: formaPagamento,
    forcar,
    total,
    desconto,
    acrescimo: 0,
    emitir_fiscal: false,
    venda_fiscal: vendaFiscal,
    confirmacao_fiscal_manual: vendaFiscal === true,
    parcelas: formaPagamento === 'prazo' ? parcelas : undefined,
    primeiro_vencimento: formaPagamento === 'prazo' ? '2030-01-15' : undefined,
    pagamentos: pagamentos || (formaPagamento === 'prazo'
      ? []
      : [{ forma_pagamento: formaPagamento, valor: total }]),
    itens: [{
      produto_id: produtoId,
      quantidade,
      preco_unitario: 10,
      preco_unitario_interno: 10,
      subtotal: Number((quantidade * 10).toFixed(2)),
      desconto_percentual: desconto > 0 ? Number((desconto / (quantidade * 10) * 100).toFixed(2)) : 0,
      desconto_valor: desconto,
      desconto_manual: 0,
      item_fiscal: vendaFiscal ? 1 : 0,
      tipo_venda: 'UN'
    }]
  };
  return {
    body,
    caixaSessaoId: caixa.sessaoId,
    caixaId: caixa.caixaId,
    terminalId: null,
    operadorId: 1,
    user: { id: 1, perfil: 'ADMIN', username: 'teste-pdv-estoque' },
    __descontoAuthOk: true,
    ip: '127.0.0.1',
    headers: {}
  };
}

async function aguardarCodigoVendaUnico() {
  const desdeUltimaVenda = Date.now() - ultimaVendaEm;
  if (desdeUltimaVenda < 1100) {
    await new Promise((resolve) => setTimeout(resolve, 1100 - desdeUltimaVenda));
  }
  ultimaVendaEm = Date.now();
}

function finalizarVenda(req) {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const timer = setTimeout(() => reject(new Error('Timeout na finalização isolada do PDV.')), 30000);
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      set() {
        return this;
      },
      json(body) {
        clearTimeout(timer);
        resolve({ status: statusCode, body });
        return body;
      }
    };
    try {
      vendaApplicationService.criarVenda(req, res);
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

function cancelarVenda(vendaId) {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const timer = setTimeout(() => reject(new Error('Timeout no cancelamento isolado do PDV.')), 30000);
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        clearTimeout(timer);
        resolve({ status: statusCode, body });
        return body;
      }
    };
    try {
      vendaCancelamentoService.cancelarVendaPost(
        vendaId,
        'Cancelamento controlado em teste SQLite',
        { user: { id: 1, perfil: 'ADMIN' }, operadorId: 1, ip: '127.0.0.1', body: {} },
        res
      );
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

async function venderERegistrarEvidencia(options) {
  await aguardarCodigoVendaUnico();
  const antes = await getOn(db, `
    SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual, controla_estoque
    FROM produtos WHERE id = ?
  `, [options.produtoId]);
  const inicioUpdates = chamadasUpdateSaldo.length;
  const resposta = await finalizarVenda(fazerRequisicaoVenda(options));
  const vendaId = Number(resposta.body?.venda_id || resposta.body?.id || 0);
  const itens = vendaId
    ? await all('SELECT id, venda_id, produto_id, quantidade, quantidade_fiscal, quantidade_nao_fiscal FROM vendas_itens WHERE venda_id = ?', [vendaId])
    : [];
  const depois = await getOn(db, `
    SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual, controla_estoque
    FROM produtos WHERE id = ?
  `, [options.produtoId]);
  const evidenciaUpdate = chamadasUpdateSaldo.slice(inicioUpdates);
  const evidencia = {
    venda_id: vendaId || null,
    produto_id: options.produtoId,
    item_venda_id: itens[0]?.id || null,
    quantidade_comercial: itens[0]?.quantidade ?? options.quantidade,
    quantidade_fiscal: itens[0]?.quantidade_fiscal ?? null,
    quantidade_nao_fiscal: itens[0]?.quantidade_nao_fiscal ?? null,
    controla_estoque: antes?.controla_estoque ?? null,
    saldo_anterior: antes,
    caminho_baixa: evidenciaUpdate,
    saldo_posterior: depois,
    status_http: resposta.status,
    erro: resposta.body?.error || null
  };
  console.info('[PDV-STOCK-TRACE]', JSON.stringify(evidencia));
  return { ...evidencia, itens, resposta };
}

describe('PDV — baixa de estoque pelo fluxo completo em SQLite temporário', () => {
  before(async () => {
    await prepararBancoTemporario();
    db = require('../../backend/database');
    assert.equal(path.resolve(db.dbPath), path.resolve(dbPath), 'o serviço deve usar o banco temporário exclusivo');
    await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
    assert.equal(chamadasRecalculoHistorico, 0, 'o teste não deve recalcular saldos históricos');
    const marcador = await getOn(db, `
      SELECT valor FROM configuracoes WHERE chave = 'migracao_recalc_saldos_estoque_v1'
    `);
    assert.equal(marcador?.valor, '1');
    const recalculoStub = require.cache[recalculoPath];
    delete require.cache[recalculoPath];
    const estoqueFiscalReal = require(recalculoPath);
    Object.assign(recalculoStub.exports, estoqueFiscalReal, {
      recalcularSaldosTodosProdutos(_db, callback) {
        chamadasRecalculoHistorico += 1;
        callback(new Error('Recálculo histórico bloqueado no teste.'));
      }
    });
    require.cache[recalculoPath] = recalculoStub;
    vendaApplicationService = require('../../backend/services/vendas/VendaApplicationService');
    vendaCancelamentoService = require('../../backend/services/vendas/VendaCancelamentoService');
    instrumentarBaixas(db);
    caixa = await criarCaixaTeste();
  });

  after(async () => {
    if (restaurarDbRun) restaurarDbRun();
    if (db) await new Promise((resolve) => db.close(() => resolve()));
    if (recalculoCacheAnterior) require.cache[recalculoPath] = recalculoCacheAnterior;
    else delete require.cache[recalculoPath];
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it('cenário A: baixa fiscal 10→8 pelo fluxo oficial de finalização', async () => {
    await criarProduto({ id: 9901 });
    const resultado = await venderERegistrarEvidencia({
      produtoId: 9901,
      quantidade: 2,
      vendaFiscal: true
    });
    assert.equal(resultado.status_http, 200, resultado.erro);
    assert.deepEqual(
      [resultado.quantidade_fiscal, resultado.quantidade_nao_fiscal],
      [2, 0]
    );
    assert.deepEqual(
      [resultado.saldo_posterior.saldo_fiscal, resultado.saldo_posterior.saldo_nao_fiscal, resultado.saldo_posterior.estoque_atual],
      [8, 5, 13]
    );
    assert.deepEqual(resultado.caminho_baixa.map((update) => update.registros_alterados), [1]);
  });

  it('cenário B: baixa não fiscal 5→2 pelo fluxo oficial de finalização', async () => {
    await criarProduto({ id: 9902, itemFiscal: 0 });
    const resultado = await venderERegistrarEvidencia({
      produtoId: 9902,
      quantidade: 3,
      vendaFiscal: false
    });
    assert.equal(resultado.status_http, 200, resultado.erro);
    assert.deepEqual(
      [resultado.quantidade_fiscal, resultado.quantidade_nao_fiscal],
      [0, 3]
    );
    assert.deepEqual(
      [resultado.saldo_posterior.saldo_fiscal, resultado.saldo_posterior.saldo_nao_fiscal, resultado.saldo_posterior.estoque_atual],
      [10, 2, 12]
    );
    assert.deepEqual(resultado.caminho_baixa.map((update) => update.registros_alterados), [1]);
  });

  it('cenário C: baixa mista 10/5→8/2 pelo fluxo oficial de finalização', async () => {
    await criarProduto({ id: 9903, reservadoFiscal: 8 });
    const resultado = await venderERegistrarEvidencia({
      produtoId: 9903,
      quantidade: 5,
      vendaFiscal: true
    });
    assert.equal(resultado.status_http, 200, resultado.erro);
    assert.deepEqual(
      [resultado.quantidade_fiscal, resultado.quantidade_nao_fiscal],
      [2, 3]
    );
    assert.deepEqual(
      [resultado.saldo_posterior.saldo_fiscal, resultado.saldo_posterior.saldo_nao_fiscal, resultado.saldo_posterior.estoque_atual],
      [8, 2, 10]
    );
    assert.deepEqual(
      resultado.caminho_baixa.map((update) => [update.caminho, update.quantidade, update.registros_alterados]),
      [['saldo_fiscal', 2, 1], ['saldo_nao_fiscal', 3, 1]]
    );
  });

  it('preserva a soma consolidada quando o saldo da natureza não consumida é NULL', async () => {
    await criarProduto({ id: 9904, saldoNaoFiscal: null });
    const resultado = await venderERegistrarEvidencia({
      produtoId: 9904,
      quantidade: 2,
      vendaFiscal: true
    });
    assert.equal(resultado.status_http, 200, resultado.erro);
    assert.equal(resultado.saldo_posterior.saldo_fiscal, 8);
    assert.equal(resultado.saldo_posterior.saldo_nao_fiscal, null);
    assert.equal(resultado.saldo_posterior.estoque_atual, 8);
  });

  it('não baixa estoque quando o produto desativa o controle', async () => {
    await criarProduto({ id: 9907, controlaEstoque: 0 });
    const resultado = await venderERegistrarEvidencia({
      produtoId: 9907,
      quantidade: 2,
      vendaFiscal: true
    });
    assert.equal(resultado.status_http, 200, resultado.erro);
    assert.deepEqual(
      [resultado.saldo_posterior.saldo_fiscal, resultado.saldo_posterior.saldo_nao_fiscal, resultado.saldo_posterior.estoque_atual],
      [10, 5, 15]
    );
    assert.equal(resultado.caminho_baixa.length, 0);
    const cancelamento = await cancelarVenda(resultado.venda_id);
    assert.equal(cancelamento.status, 200, cancelamento.body?.mensagem);
    const aposCancelamento = await getOn(db, `
      SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual
      FROM produtos WHERE id = 9907
    `);
    assert.deepEqual(
      [aposCancelamento.saldo_fiscal, aposCancelamento.saldo_nao_fiscal, aposCancelamento.estoque_atual],
      [10, 5, 15],
      'cancelar venda de produto sem controle não pode criar estoque'
    );
  });

  it('baixa todos os produtos de uma venda no mesmo fluxo transacional', async () => {
    await criarProduto({ id: 9908 });
    await criarProduto({ id: 9909 });
    await aguardarCodigoVendaUnico();
    const req = fazerRequisicaoVenda({
      produtoId: 9908,
      quantidade: 2,
      vendaFiscal: true
    });
    req.body.itens.push({
      produto_id: 9909,
      quantidade: 1,
      preco_unitario: 10,
      preco_unitario_interno: 10,
      subtotal: 10,
      desconto_percentual: 0,
      desconto_valor: 0,
      desconto_manual: 0,
      item_fiscal: 1,
      tipo_venda: 'UN'
    });
    req.body.total = 30;
    req.body.pagamentos[0].valor = 30;
    const resposta = await finalizarVenda(req);
    assert.equal(resposta.status, 200, resposta.body?.error);
    const vendaId = Number(resposta.body?.venda_id || resposta.body?.id);
    const itens = await all(`
      SELECT produto_id, quantidade_fiscal, quantidade_nao_fiscal
      FROM vendas_itens WHERE venda_id = ? ORDER BY produto_id
    `, [vendaId]);
    assert.deepEqual(
      itens.map((item) => [item.produto_id, item.quantidade_fiscal, item.quantidade_nao_fiscal]),
      [[9908, 2, 0], [9909, 1, 0]]
    );
    const saldos = await all(`
      SELECT id, saldo_fiscal, saldo_nao_fiscal, estoque_atual
      FROM produtos WHERE id IN (9908, 9909) ORDER BY id
    `);
    assert.deepEqual(
      saldos.map((produto) => [produto.saldo_fiscal, produto.saldo_nao_fiscal, produto.estoque_atual]),
      [[8, 5, 13], [9, 5, 14]]
    );
  });

  it('repetir a mesma finalização retorna o resultado original sem duplicar venda ou baixa', async () => {
    await criarProduto({ id: 9910 });
    await aguardarCodigoVendaUnico();
    const reqOriginal = fazerRequisicaoVenda({
      produtoId: 9910,
      quantidade: 2,
      vendaFiscal: true
    });
    const inicioUpdates = chamadasUpdateSaldo.length;
    const primeira = await finalizarVenda({
      ...reqOriginal,
      body: JSON.parse(JSON.stringify(reqOriginal.body))
    });
    assert.equal(primeira.status, 200, primeira.body?.error);
    const repetida = await finalizarVenda({
      ...reqOriginal,
      body: JSON.parse(JSON.stringify(reqOriginal.body))
    });
    assert.equal(repetida.status, 200, repetida.body?.error);
    assert.deepEqual(repetida.body, primeira.body);

    const vendas = await getOn(db, `
      SELECT COUNT(*) AS total FROM vendas WHERE idempotency_key = ?
    `, [reqOriginal.body.idempotency_key]);
    const itens = await all(`
      SELECT id FROM vendas_itens WHERE venda_id = ?
    `, [primeira.body.venda_id]);
    const saldo = await getOn(db, `
      SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual
      FROM produtos WHERE id = 9910
    `);
    const vendaPersistida = await getOn(db, `
      SELECT idempotency_response_json FROM vendas WHERE id = ?
    `, [primeira.body.venda_id]);
    assert.equal(vendas.total, 1);
    assert.equal(itens.length, 1);
    assert.deepEqual([saldo.saldo_fiscal, saldo.saldo_nao_fiscal, saldo.estoque_atual], [8, 5, 13]);
    assert.deepEqual(JSON.parse(vendaPersistida.idempotency_response_json), primeira.body);
    assert.equal(chamadasUpdateSaldo.length - inicioUpdates, 1);

    const chaveReutilizada = {
      ...reqOriginal,
      body: { ...reqOriginal.body, total: reqOriginal.body.total + 1 }
    };
    const conflito = await finalizarVenda(chaveReutilizada);
    assert.equal(conflito.status, 409);
    assert.equal(conflito.body.codigo, 'CHAVE_IDEMPOTENCIA_VENDA_REUTILIZADA');
    assert.equal((await getOn(db, 'SELECT COUNT(*) AS total FROM vendas WHERE idempotency_key = ?', [
      reqOriginal.body.idempotency_key
    ])).total, 1);
  });

  it('venda a prazo persiste itens, estoque e parcelas no mesmo commit', async () => {
    await runOn(db, 'INSERT INTO clientes (id, nome) VALUES (91001, ?)', ['Cliente teste a prazo']);
    await criarProduto({ id: 9911, reservadoFiscal: 8 });
    await aguardarCodigoVendaUnico();
    const resposta = await finalizarVenda(fazerRequisicaoVenda({
      produtoId: 9911,
      quantidade: 5,
      vendaFiscal: true,
      formaPagamento: 'prazo',
      clienteId: 91001,
      forcar: true,
      parcelas: 2
    }));
    assert.equal(resposta.status, 200, resposta.body?.error);
    const vendaId = Number(resposta.body.venda_id);
    const item = await getOn(db, `
      SELECT quantidade_fiscal, quantidade_nao_fiscal
      FROM vendas_itens WHERE venda_id = ?
    `, [vendaId]);
    const saldo = await getOn(db, `
      SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual
      FROM produtos WHERE id = 9911
    `);
    const parcelas = await all('SELECT numero_parcela FROM contas_receber WHERE venda_id = ? ORDER BY numero_parcela', [vendaId]);
    const financeiro = await all('SELECT id FROM financeiro WHERE venda_id = ?', [vendaId]);
    assert.deepEqual([item.quantidade_fiscal, item.quantidade_nao_fiscal], [2, 3]);
    assert.deepEqual([saldo.saldo_fiscal, saldo.saldo_nao_fiscal, saldo.estoque_atual], [8, 2, 10]);
    assert.deepEqual(parcelas.map((parcela) => parcela.numero_parcela), [1, 2]);
    assert.equal(financeiro.length, 2);
  });

  it('falha de baixa a prazo reverte venda, itens, lotes financeiros e saldos', async () => {
    await criarProduto({ id: 9912, reservadoFiscal: 8 });
    const vendasAntes = (await getOn(db, 'SELECT COUNT(*) AS total FROM vendas')).total;
    const itensAntes = (await getOn(db, 'SELECT COUNT(*) AS total FROM vendas_itens')).total;
    const parcelasAntes = (await getOn(db, 'SELECT COUNT(*) AS total FROM contas_receber')).total;
    const financeiroAntes = (await getOn(db, 'SELECT COUNT(*) AS total FROM financeiro')).total;
    await runOn(db, `
      CREATE TRIGGER bloquear_baixa_prazo_pdv_teste
      BEFORE UPDATE ON produtos
      WHEN OLD.id = 9912 AND NEW.saldo_nao_fiscal IS NOT OLD.saldo_nao_fiscal
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `);
    await aguardarCodigoVendaUnico();
    const resposta = await finalizarVenda(fazerRequisicaoVenda({
      produtoId: 9912,
      quantidade: 5,
      vendaFiscal: true,
      formaPagamento: 'prazo',
      clienteId: 91001,
      forcar: true,
      parcelas: 2
    }));
    assert.notEqual(resposta.status, 200);
    const saldo = await getOn(db, `
      SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual
      FROM produtos WHERE id = 9912
    `);
    assert.deepEqual([saldo.saldo_fiscal, saldo.saldo_nao_fiscal, saldo.estoque_atual], [10, 5, 15]);
    assert.equal((await getOn(db, 'SELECT COUNT(*) AS total FROM vendas')).total, vendasAntes);
    assert.equal((await getOn(db, 'SELECT COUNT(*) AS total FROM vendas_itens')).total, itensAntes);
    assert.equal((await getOn(db, 'SELECT COUNT(*) AS total FROM contas_receber')).total, parcelasAntes);
    assert.equal((await getOn(db, 'SELECT COUNT(*) AS total FROM financeiro')).total, financeiroAntes);
  });

  it('FEFO consome validade mais próxima, replay não repete lote e cancelamento restaura uma vez', async () => {
    await criarProduto({ id: 9913, controlaValidade: 1 });
    await criarLoteTeste({
      produtoId: 9913,
      lote: 'FEFO-PDV-ANTERIOR',
      quantidade: 2,
      validade: '2026-12-01'
    });
    await criarLoteTeste({
      produtoId: 9913,
      lote: 'FEFO-PDV-POSTERIOR',
      quantidade: 4,
      validade: '2027-01-01'
    });
    await aguardarCodigoVendaUnico();
    const reqOriginal = fazerRequisicaoVenda({
      produtoId: 9913,
      quantidade: 3,
      vendaFiscal: true
    });
    const requisicao = () => ({
      ...reqOriginal,
      body: JSON.parse(JSON.stringify(reqOriginal.body))
    });
    const primeira = await finalizarVenda(requisicao());
    assert.equal(primeira.status, 200, primeira.body?.error);
    const lotesAposVenda = await all(`
      SELECT lote, quantidade_atual FROM produtos_lotes
      WHERE produto_id = 9913 ORDER BY data_validade
    `);
    assert.deepEqual(
      lotesAposVenda.map((lote) => [lote.lote, lote.quantidade_atual]),
      [['FEFO-PDV-ANTERIOR', 0], ['FEFO-PDV-POSTERIOR', 3]]
    );
    const consumo = await all(`
      SELECT pl.lote, vl.quantidade
      FROM venda_lotes vl
      JOIN vendas_itens vi ON vi.id = vl.venda_item_id
      JOIN produtos_lotes pl ON pl.id = vl.produto_lote_id
      WHERE vi.venda_id = ? ORDER BY pl.data_validade
    `, [primeira.body.venda_id]);
    assert.deepEqual(
      consumo.map((lote) => [lote.lote, lote.quantidade]),
      [['FEFO-PDV-ANTERIOR', 2], ['FEFO-PDV-POSTERIOR', 1]]
    );

    const replay = await finalizarVenda(requisicao());
    assert.deepEqual(replay.body, primeira.body);
    assert.deepEqual(
      (await all('SELECT quantidade_atual FROM produtos_lotes WHERE produto_id = 9913 ORDER BY data_validade'))
        .map((lote) => lote.quantidade_atual),
      [0, 3]
    );

    const cancelamento = await cancelarVenda(primeira.body.venda_id);
    assert.equal(cancelamento.status, 200, cancelamento.body?.mensagem);
    const saldosRestaurados = await getOn(db, `
      SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual
      FROM produtos WHERE id = 9913
    `);
    assert.deepEqual(
      [saldosRestaurados.saldo_fiscal, saldosRestaurados.saldo_nao_fiscal, saldosRestaurados.estoque_atual],
      [10, 5, 15]
    );
    assert.deepEqual(
      (await all('SELECT quantidade_atual FROM produtos_lotes WHERE produto_id = 9913 ORDER BY data_validade'))
        .map((lote) => lote.quantidade_atual),
      [2, 4]
    );
    assert.equal((await getOn(db, `
      SELECT COUNT(*) AS total FROM venda_lotes vl
      JOIN vendas_itens vi ON vi.id = vl.venda_item_id
      WHERE vi.venda_id = ?
    `, [primeira.body.venda_id])).total, 0);

    const segundoCancelamento = await cancelarVenda(primeira.body.venda_id);
    assert.equal(segundoCancelamento.status, 400);
    assert.deepEqual(
      (await all('SELECT quantidade_atual FROM produtos_lotes WHERE produto_id = 9913 ORDER BY data_validade'))
        .map((lote) => lote.quantidade_atual),
      [2, 4]
    );
  });

  it('rollback da baixa FEFO restaura lotes e remove os registros de consumo', async () => {
    await criarProduto({ id: 9914, controlaValidade: 1 });
    await criarLoteTeste({
      produtoId: 9914,
      lote: 'FEFO-PDV-ROLLBACK-A',
      quantidade: 2,
      validade: '2026-12-15'
    });
    await criarLoteTeste({
      produtoId: 9914,
      lote: 'FEFO-PDV-ROLLBACK-B',
      quantidade: 4,
      validade: '2027-01-15'
    });
    const vendasAntes = (await getOn(db, 'SELECT COUNT(*) AS total FROM vendas')).total;
    await runOn(db, `
      CREATE TRIGGER bloquear_baixa_fefo_pdv_teste
      BEFORE UPDATE ON produtos
      WHEN OLD.id = 9914 AND NEW.saldo_fiscal IS NOT OLD.saldo_fiscal
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `);
    await aguardarCodigoVendaUnico();
    const resposta = await finalizarVenda(fazerRequisicaoVenda({
      produtoId: 9914,
      quantidade: 3,
      vendaFiscal: true
    }));
    assert.notEqual(resposta.status, 200);
    assert.deepEqual(
      (await all('SELECT quantidade_atual FROM produtos_lotes WHERE produto_id = 9914 ORDER BY data_validade'))
        .map((lote) => lote.quantidade_atual),
      [2, 4]
    );
    assert.equal((await getOn(db, `
      SELECT COUNT(*) AS total FROM venda_lotes vl
      JOIN vendas_itens vi ON vi.id = vl.venda_item_id
      WHERE vi.produto_id = 9914
    `)).total, 0);
    assert.equal((await getOn(db, 'SELECT COUNT(*) AS total FROM vendas')).total, vendasAntes);
    const saldo = await getOn(db, `
      SELECT saldo_fiscal, saldo_nao_fiscal, estoque_atual FROM produtos WHERE id = 9914
    `);
    assert.deepEqual([saldo.saldo_fiscal, saldo.saldo_nao_fiscal, saldo.estoque_atual], [10, 5, 15]);
  });

  it('falha ao restaurar saldo impede cancelamento comercial parcial', async () => {
    await criarProduto({ id: 9915 });
    await aguardarCodigoVendaUnico();
    const venda = await finalizarVenda(fazerRequisicaoVenda({
      produtoId: 9915,
      quantidade: 2,
      vendaFiscal: true
    }));
    assert.equal(venda.status, 200, venda.body?.error);
    await runOn(db, `
      CREATE TRIGGER bloquear_estorno_cancelamento_pdv_teste
      BEFORE UPDATE ON produtos
      WHEN OLD.id = 9915 AND NEW.saldo_fiscal > OLD.saldo_fiscal
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `);
    const cancelamento = await cancelarVenda(venda.body.venda_id);
    assert.equal(cancelamento.status, 500);
    const estado = await getOn(db, `
      SELECT v.cancelada, v.status, p.saldo_fiscal, p.saldo_nao_fiscal, p.estoque_atual
      FROM vendas v JOIN vendas_itens vi ON vi.venda_id = v.id
      JOIN produtos p ON p.id = vi.produto_id
      WHERE v.id = ?
    `, [venda.body.venda_id]);
    assert.deepEqual(
      [estado.cancelada, estado.status, estado.saldo_fiscal, estado.saldo_nao_fiscal, estado.estoque_atual],
      [0, 'concluida', 8, 5, 13]
    );
  });

  it('não finaliza a venda quando o UPDATE da baixa não altera nenhuma linha', async () => {
    await criarProduto({ id: 9905 });
    const vendasAntes = await getOn(db, 'SELECT COUNT(*) AS total FROM vendas');
    await runOn(db, `
      CREATE TRIGGER bloquear_baixa_pdv_teste
      BEFORE UPDATE ON produtos
      WHEN OLD.id = 9905
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `);
    const resultado = await venderERegistrarEvidencia({
      produtoId: 9905,
      quantidade: 2,
      vendaFiscal: true
    });
    assert.notEqual(resultado.status_http, 200, 'baixa sem registros alterados não pode retornar sucesso');
    assert.match(resultado.erro || '', /baixa|estoque|produto|saldo/i);
    assert.equal(resultado.saldo_posterior.saldo_fiscal, 10);
    assert.equal(resultado.saldo_posterior.saldo_nao_fiscal, 5);
    assert.equal(resultado.itens.length, 0, 'o item da venda deve ser revertido junto com o estoque');
    const vendasDepois = await getOn(db, 'SELECT COUNT(*) AS total FROM vendas');
    assert.equal(vendasDepois.total, vendasAntes.total, 'a venda deve ser revertida');
  });

  it('reverte toda a venda se a segunda baixa de uma venda mista não atualizar estoque', async () => {
    await criarProduto({ id: 9906, reservadoFiscal: 8 });
    const vendasAntes = await getOn(db, 'SELECT COUNT(*) AS total FROM vendas');
    await runOn(db, `
      CREATE TRIGGER bloquear_baixa_nao_fiscal_pdv_teste
      BEFORE UPDATE ON produtos
      WHEN OLD.id = 9906 AND NEW.saldo_nao_fiscal IS NOT OLD.saldo_nao_fiscal
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `);
    const resultado = await venderERegistrarEvidencia({
      produtoId: 9906,
      quantidade: 5,
      vendaFiscal: true
    });
    assert.notEqual(resultado.status_http, 200, 'a venda mista deve falhar se uma natureza não baixar');
    assert.deepEqual(
      resultado.caminho_baixa.map((update) => [update.quantidade, update.registros_alterados]),
      [[2, 1], [3, 0]]
    );
    assert.deepEqual(
      [resultado.saldo_posterior.saldo_fiscal, resultado.saldo_posterior.saldo_nao_fiscal, resultado.saldo_posterior.estoque_atual],
      [10, 5, 15],
      'a baixa fiscal inicial deve sofrer rollback quando a baixa não fiscal falhar'
    );
    assert.equal(resultado.itens.length, 0, 'o item também deve sofrer rollback');
    const vendasDepois = await getOn(db, 'SELECT COUNT(*) AS total FROM vendas');
    assert.equal(vendasDepois.total, vendasAntes.total, 'a venda deve ser revertida');
  });
});
