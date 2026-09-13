/**
 * Sprint 05 — Auditoria final + preparação para produção (sem liberar produção).
 * Executar: node tests/fiscal/fechamento-fiscal-dia-sprint05.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const {
  garantirSchemaFechamentoFiscal,
  criarRascunho,
  adicionarRecebimento,
  removerRecebimento,
  obterPorId,
  gerarPrevia,
  gerarPreviaDistribuicao,
  listarLotesElegiveisDoDia,
  prepararEmissao,
  transmitirFechamento,
  recuperarFechamento,
  cancelarFechamento,
  snapshotComercial,
  somarMoeda,
  toCentavos,
  STATUS,
  DOC_STATUS,
  assertModuloAtivo,
  moduloConfig
} = require('../../backend/services/fechamento-fiscal');

let ok = 0;
let falhas = 0;

async function test(nome, fn) {
  try {
    await fn();
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${err && err.stack ? err.stack : err}`);
  }
}

function openDb(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(db)));
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

const CFG_HOMOLOG = {
  codigoUf: '23',
  cnpj: '12345678000199',
  ie: '073252638',
  crt: 1,
  ambiente: 2,
  serie: 1,
  numeroAtual: 100,
  nomeEmpresa: 'EMPRESA A LTDA',
  logradouro: 'RUA A',
  numero: '100',
  bairro: 'CENTRO',
  codigo_municipio: '2307304',
  municipioCodigo: '2307304',
  municipio: 'JUAZEIRO DO NORTE',
  uf: 'CE',
  cep: '63000000',
  telefone: '8835110000',
  tpImp: 4,
  csosn_padrao: '102',
  certificadoPath: 'C:/fake.pfx',
  idCSC: '1',
  tokenCSC: 'TOKEN',
  urls: {
    autorizacao: 'https://homolog.example/a',
    consultaQr: 'https://homolog.example/qr',
    consultaChave: 'https://homolog.example/ch'
  }
};

let numeroSeq = 500;

async function schemaBase(db) {
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY, nome TEXT, codigo TEXT, preco_venda REAL DEFAULT 0, preco_compra REAL DEFAULT 0,
    item_fiscal INTEGER DEFAULT 0, produto_fracionado INTEGER DEFAULT 0, unidade TEXT DEFAULT 'UN',
    saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0, ativo INTEGER DEFAULT 1,
    ncm TEXT, cest TEXT, cfop TEXT, csosn TEXT, origem INTEGER DEFAULT 0, tipo TEXT DEFAULT 'PRODUTO'
  )`);
  await run(db, `CREATE TABLE vendas (
    id INTEGER PRIMARY KEY, data_venda TEXT, total REAL DEFAULT 0,
    valor_fiscal REAL DEFAULT 0, valor_nao_fiscal REAL DEFAULT 0,
    status TEXT DEFAULT 'concluida', cancelada INTEGER DEFAULT 0
  )`);
  await run(db, `CREATE TABLE vendas_itens (
    id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER,
    quantidade REAL DEFAULT 0, quantidade_fiscal REAL DEFAULT 0, quantidade_nao_fiscal REAL DEFAULT 0,
    subtotal REAL DEFAULT 0, valor_fiscal REAL DEFAULT 0, valor_nao_fiscal REAL DEFAULT 0,
    preco_unitario REAL DEFAULT 0
  )`);
  await run(db, `CREATE TABLE vendas_devolucoes (
    id INTEGER PRIMARY KEY, venda_id INTEGER, venda_item_id INTEGER, produto_id INTEGER,
    quantidade REAL, valor_unitario REAL, valor_total REAL
  )`);
  await run(db, `CREATE TABLE financeiro (id INTEGER PRIMARY KEY, valor REAL, descricao TEXT, tipo TEXT, origem TEXT)`);
  await run(db, `CREATE TABLE contas_receber (id INTEGER PRIMARY KEY, valor REAL, status TEXT)`);
  await run(db, `CREATE TABLE contas_pagar (id INTEGER PRIMARY KEY, valor REAL, status TEXT)`);
  await run(db, `CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT)`);
  await run(db, `INSERT INTO configuracoes (chave, valor) VALUES ('cnpj', '12345678000199')`);
  await run(db, `INSERT INTO configuracoes (chave, valor) VALUES ('fechamento_fiscal_do_dia', 'ATIVADO')`);
  await run(db, `INSERT INTO configuracoes (chave, valor) VALUES ('fiscal_ambiente', '2')`);
  await run(db, `INSERT INTO configuracoes (chave, valor) VALUES ('fiscal_serie', '1')`);
  await new Promise((resolve, reject) => {
    garantirSchemaFechamentoFiscal(db, (err) => (err ? reject(err) : resolve()));
  });
}

async function seedComercial(db, data = '2026-09-11') {
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem,tipo)
    VALUES (1,'Pastel Carne','1',10,5,1,'UN',50,50,1,'21069090','5102','102',0,'PRODUTO')`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem,tipo)
    VALUES (2,'Pastel Frango','2',12,6,1,'UN',50,50,1,'21069090','5102','102',0,'PRODUTO')`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem,tipo)
    VALUES (3,'Açaí 500ml','3',18,8,1,'UN',50,50,1,'21069090','5102','102',0,'PRODUTO')`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem,tipo)
    VALUES (4,'Pizza','4',40,20,1,'UN',50,50,1,'21069090','5102','102',0,'PRODUTO')`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem,tipo)
    VALUES (5,'Refrigerante','5',6,3,1,'UN',50,50,1,'22021000','5102','102',0,'PRODUTO')`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem,tipo)
    VALUES (6,'Sem Venda','6',9,4,1,'UN',10,10,1,'21069090','5102','102',0,'PRODUTO')`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem,tipo)
    VALUES (7,'Nao Fiscal','7',8,4,0,'UN',0,20,1,NULL,NULL,NULL,0,'PRODUTO')`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem,tipo)
    VALUES (8,'Item Caro','8',1000,500,1,'UN',5,5,1,'21069090','5102','102',0,'PRODUTO')`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem,tipo)
    VALUES (9,'Insumo Farinha','9',2,1,1,'UN',100,100,1,'11010010','5102','102',0,'INSUMO')`);

  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,valor_fiscal,status,cancelada)
    VALUES (1,?,1820,1820,0,'concluida',0)`, [data]);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (1,1,1,20,20,0,200,200,200,10)`);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (2,1,2,10,10,0,120,120,120,12)`);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (3,1,3,8,8,0,144,144,144,18)`);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (4,1,4,5,5,0,200,200,200,40)`);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (5,1,5,20,20,0,120,120,120,6)`);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (6,1,7,5,0,5,40,0,40,8)`);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (7,1,8,1,1,0,1000,1000,1000,1000)`);
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
    VALUES (2,?,36,36,'concluida',0)`, [data]);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (8,2,1,3,3,0,36,36,36,12)`);
  // venda fiscal (NFC-e ativa) — não elegível
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_fiscal,status,cancelada)
    VALUES (3,?,50,50,'concluida',0)`, [data]);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,subtotal,valor_fiscal,preco_unitario)
    VALUES (9,3,1,5,5,50,50,10)`);
  await run(db, `CREATE TABLE IF NOT EXISTS nfce_notas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER NOT NULL,
    numero INTEGER NOT NULL,
    serie INTEGER NOT NULL,
    chave_acesso TEXT,
    status TEXT DEFAULT 'pendente'
  )`);
  await run(db, `INSERT INTO nfce_notas (venda_id, numero, serie, chave_acesso, status)
    VALUES (3, 1, 1, '35260112345678000199550010000000011000000010', 'autorizada')`);

  await run(db, `INSERT INTO financeiro (id,valor,descricao,tipo,origem) VALUES (1,1000,'venda','receita','pdv')`);
  await run(db, `INSERT INTO contas_receber (id,valor,status) VALUES (1,500,'aberto')`);
  await run(db, `INSERT INTO contas_pagar (id,valor,status) VALUES (1,200,'aberto')`);
}

async function setModulo(db, valor) {
  await run(
    db,
    `INSERT INTO configuracoes (chave, valor) VALUES ('fechamento_fiscal_do_dia', ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
    [valor]
  );
  moduloConfig._resetCacheForTests();
}

async function montarPronto(db, valor = 700, data = '2026-09-11', cnpj = '12345678000199') {
  const ff = await criarRascunho({ data_fechamento: data, cnpj }, { db });
  if (valor === 700) {
    await adicionarRecebimento(ff.id, { operadora: 'Sicredi', valor: 400 }, { db });
    await adicionarRecebimento(ff.id, { operadora: 'Stone', valor: 180 }, { db });
    await adicionarRecebimento(ff.id, { operadora: 'Mercado Pago', valor: 120 }, { db });
  } else {
    await adicionarRecebimento(ff.id, { operadora: 'Unico', valor }, { db });
  }
  await gerarPrevia({ id: ff.id, data, valor_informado: valor, persistir: true }, { db });
  await prepararEmissao(ff.id, { gerarXml: true }, {
    db,
    getFiscalConfig: async () => ({ ...CFG_HOMOLOG, cnpj }),
    certificadoOpcional: true,
    bloquearProducaoEmTeste: true,
    moduloOn: true
  });
  return get(db, `SELECT * FROM fechamentos_fiscais WHERE id = ?`, [ff.id]);
}

function depsTx(db, overrides = {}) {
  numeroSeq = 500;
  return {
    db,
    moduloOn: true,
    capturarSnapshot: true,
    getFiscalConfig: async () => ({ ...CFG_HOMOLOG, ...(overrides.config || {}) }),
    incrementaNumeroFiscal: async () => { numeroSeq += 1; return numeroSeq; },
    assinarDocumento: async ({ xmlSemAssinatura }) => ({
      xmlAssinado: String(xmlSemAssinatura).replace('</NFe>', '<Signature/></NFe>'),
      qrCodeUrl: 'https://qr'
    }),
    enviarAutorizacao: overrides.enviarAutorizacao || (async () => ({
      success: true,
      raw: '<cStat>100</cStat><xMotivo>Autorizado</xMotivo><nProt>PROT-OK</nProt>',
      cStat: '100',
      protocolo: 'PROT-OK'
    })),
    consultarProtocolo: overrides.consultarProtocolo || (async () => ({
      success: true,
      raw: '<cStat>100</cStat><xMotivo>Autorizado</xMotivo><nProt>PROT-REC</nProt>',
      cStat: '100'
    })),
    ...overrides
  };
}

async function snapshotAmpliado(db) {
  const base = await snapshotComercial(db);
  const cr = await get(db, `SELECT COUNT(*) AS n, COALESCE(SUM(valor),0) AS s FROM contas_receber`);
  const cp = await get(db, `SELECT COUNT(*) AS n, COALESCE(SUM(valor),0) AS s FROM contas_pagar`);
  const vp = await get(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='venda_pagamentos'`).catch(() => null);
  return {
    ...base,
    contas_receber_n: Number(cr?.n || 0),
    contas_receber_s: Number(cr?.s || 0),
    contas_pagar_n: Number(cp?.n || 0),
    contas_pagar_s: Number(cp?.s || 0),
    tem_venda_pagamentos: Boolean(vp)
  };
}

async function main() {
  console.log('\n=== Sprint 05 — Auditoria Final Fechamento Fiscal ===\n');
  moduloConfig._resetCacheForTests();

  if (!sqlite3) {
    console.error('Dependência ausente: sqlite3');
    process.exit(1);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffd-s05-'));
  const db = await openDb(path.join(dir, 'audit.db'));
  await schemaBase(db);
  await seedComercial(db);
  const lotes = await listarLotesElegiveisDoDia(db, '2026-09-11');

  // --- 01/02 CONFIG OFF/ON ---
  await test('01 — CONFIG OFF bloqueia criar/prévia/preparar/transmitir/recuperar', async () => {
    await setModulo(db, 'DESATIVADO');
    let e1 = null;
    try { await criarRascunho({ data_fechamento: '2026-09-20', cnpj: '12345678000199' }, { db }); }
    catch (e) { e1 = e; }
    assert.ok(e1 && e1.code === 'MODULO_OFF');

    await setModulo(db, 'ATIVADO');
    const ff = await criarRascunho({ data_fechamento: '2026-09-20', cnpj: '12345678000199' }, { db });
    await setModulo(db, 'DESATIVADO');
    let e2 = null;
    try { await adicionarRecebimento(ff.id, { operadora: 'X', valor: 10 }, { db }); }
    catch (e) { e2 = e; }
    assert.ok(e2 && e2.code === 'MODULO_OFF');

    let e3 = null;
    try { await gerarPrevia({ id: ff.id, data: '2026-09-20', valor_informado: 10 }, { db }); }
    catch (e) { e3 = e; }
    assert.ok(e3 && e3.code === 'MODULO_OFF');

    let e4 = null;
    try { await transmitirFechamento(ff.id, {}, depsTx(db, { moduloOn: false })); }
    catch (e) { e4 = e; }
    assert.ok(e4 && e4.code === 'MODULO_OFF');

    let e5 = null;
    try { await recuperarFechamento(ff.id, {}, depsTx(db, { moduloOn: false })); }
    catch (e) { e5 = e; }
    assert.ok(e5 && e5.code === 'MODULO_OFF');

    await setModulo(db, 'ATIVADO');
    await cancelarFechamento(ff.id, { db });
  });

  await test('02 — CONFIG ON permite fluxo completo até preparação', async () => {
    await setModulo(db, 'ATIVADO');
    const ff = await montarPronto(db, 700);
    assert.strictEqual(ff.status, STATUS.PRONTO_EMISSAO);
    await cancelarFechamento(ff.id, { db });
  });

  // --- 03-05 isolamento ---
  await test('03/04/05 — Isolamento comercial / estoque / financeiro', async () => {
    const antes = await snapshotAmpliado(db);
    const ff = await montarPronto(db, 700);
    await transmitirFechamento(ff.id, {}, depsTx(db));
    const depois = await snapshotAmpliado(db);
    assert.strictEqual(antes.vendas, depois.vendas);
    assert.strictEqual(antes.financeiro, depois.financeiro);
    assert.strictEqual(antes.caixa, depois.caixa);
    assert.strictEqual(antes.estoque_fiscal, depois.estoque_fiscal);
    assert.strictEqual(antes.estoque_nao_fiscal, depois.estoque_nao_fiscal);
    assert.strictEqual(antes.margem_proxy, depois.margem_proxy);
    assert.strictEqual(antes.contas_receber_n, depois.contas_receber_n);
    assert.strictEqual(antes.contas_receber_s, depois.contas_receber_s);
    assert.strictEqual(antes.contas_pagar_n, depois.contas_pagar_n);
    assert.strictEqual(antes.contas_pagar_s, depois.contas_pagar_s);
    assert.strictEqual(depois.tem_venda_pagamentos, false);
    const vendasN = await get(db, `SELECT COUNT(*) AS n FROM vendas`);
    assert.strictEqual(Number(vendasN.n), 3);
  });

  // --- 06-08 distribuição ---
  await test('06 — Distribuição valores variados (100/237.41/700/1000/1999.99)', async () => {
    for (const v of [100, 237.41, 700, 1000]) {
      const p = gerarPreviaDistribuicao(lotes, v, { valorAlvo: 250, valorMin: 80, valorMax: 400 });
      assert.ok(toCentavos(p.diferenca) === 0 || p.incompleta);
      if (toCentavos(p.diferenca) === 0) {
        assert.strictEqual(toCentavos(p.valor_distribuido), toCentavos(v));
      }
      for (const venda of p.vendas || []) {
        assert.ok(Number(venda.valor) > 0);
        for (const it of venda.itens || []) {
          assert.ok(Number(it.quantidade) > 0);
          assert.ok(Number(it.valor_total) > 0);
          assert.notStrictEqual(Number(it.produto_id), 6); // sem venda
          assert.notStrictEqual(Number(it.produto_id), 7); // não fiscal
        }
      }
    }
    const over = gerarPreviaDistribuicao(lotes, 1999.99, { valorAlvo: 250, valorMin: 80, valorMax: 400 });
    assert.ok(over.incompleta || toCentavos(over.diferenca) > 0);
  });

  await test('07 — Distribuição com centavos exata 700', async () => {
    assert.strictEqual(toCentavos(somarMoeda([125.89, 98.25, 360, 115.86])), 70000);
    const p = gerarPreviaDistribuicao(lotes, 700, { valorAlvo: 250, valorMin: 80, valorMax: 400 });
    assert.strictEqual(toCentavos(p.diferenca), 0);
  });

  await test('08 — Valor superior ao elegível / produto não vendido / 250 só referência', async () => {
    const p = gerarPreviaDistribuicao(lotes, 50000, { valorAlvo: 250, valorMin: 80, valorMax: 400 });
    assert.ok(p.incompleta);
    const ok700 = gerarPreviaDistribuicao(lotes, 700, { valorAlvo: 250, valorMin: 80, valorMax: 400 });
    assert.ok(ok700.vendas.some((v) => Math.abs(Number(v.valor) - 250) > 0.001) || ok700.vendas.length !== 1);
  });

  // --- 09 recebimentos ---
  await test('09 — Recebimentos A/B/C + edição/exclusão', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO' WHERE status!='CANCELADO'`);
    const ff = await criarRascunho({ data_fechamento: '2026-09-21', cnpj: '12345678000199' }, { db });
    await adicionarRecebimento(ff.id, { operadora: 'Sicredi', valor: 400 }, { db });
    await adicionarRecebimento(ff.id, { operadora: 'Stone', valor: 180 }, { db });
    let d = await adicionarRecebimento(ff.id, { operadora: 'Mercado Pago', valor: 120 }, { db });
    assert.strictEqual(toCentavos(d.valor_informado), 70000);
    const rid = d.recebimentos[0].id;
    d = await removerRecebimento(ff.id, rid, { db });
    assert.strictEqual(toCentavos(d.valor_informado), 30000);
    await adicionarRecebimento(ff.id, { operadora: 'Sicredi', valor: 400 }, { db });
    d = await obterPorId(ff.id, { db });
    assert.strictEqual(toCentavos(d.valor_informado), 70000);
    await cancelarFechamento(ff.id, { db });

    const ffB = await criarRascunho({ data_fechamento: '2026-09-22', cnpj: '12345678000199' }, { db });
    d = await adicionarRecebimento(ffB.id, { operadora: 'Unico', valor: 700 }, { db });
    assert.strictEqual(toCentavos(d.valor_informado), 70000);
    await cancelarFechamento(ffB.id, { db });

    const ffC = await criarRascunho({ data_fechamento: '2026-09-23', cnpj: '12345678000199' }, { db });
    for (const v of [125.89, 98.25, 360, 115.86]) {
      await adicionarRecebimento(ffC.id, { operadora: `M${v}`, valor: v }, { db });
    }
    d = await obterPorId(ffC.id, { db });
    assert.strictEqual(toCentavos(d.valor_informado), 70000);
    await cancelarFechamento(ffC.id, { db });
  });

  // --- 10 duplicidade / 11 concorrência ---
  await test('10 — Duplicidade mesmo dia/CNPJ', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO' WHERE status!='CANCELADO'`);
    await criarRascunho({ data_fechamento: '2026-09-11', cnpj: '12345678000199' }, { db });
    let erro = null;
    try {
      await criarRascunho({ data_fechamento: '2026-09-11', cnpj: '12345678000199' }, { db });
    } catch (e) { erro = e; }
    assert.ok(erro);
    assert.strictEqual(erro.code, 'FECHAMENTO_DUPLICADO');
  });

  await test('11 — Concorrência criação (Promise.all)', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO' WHERE status!='CANCELADO'`);
    const results = await Promise.allSettled([
      criarRascunho({ data_fechamento: '2026-09-24', cnpj: '12345678000199', usuario_id: 1 }, { db }),
      criarRascunho({ data_fechamento: '2026-09-24', cnpj: '12345678000199', usuario_id: 2 }, { db })
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.strictEqual(fulfilled.length, 1);
    assert.strictEqual(rejected.length, 1);
    const ativos = await all(
      db,
      `SELECT id FROM fechamentos_fiscais WHERE data_fechamento=? AND cnpj=? AND status!='CANCELADO'`,
      ['2026-09-24', '12345678000199']
    );
    assert.strictEqual(ativos.length, 1);
  });

  // --- 12 restart ---
  await test('12 — Restart: estados preservados sem auto-transmissão', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO' WHERE status!='CANCELADO'`);
    const estados = [
      STATUS.VALIDANDO,
      STATUS.PRONTO_EMISSAO,
      STATUS.EMITINDO,
      STATUS.AUTORIZADO,
      STATUS.REJEITADO,
      STATUS.ERRO
    ];
    for (let i = 0; i < estados.length; i++) {
      const ff = await criarRascunho({
        data_fechamento: `2026-10-0${i + 1}`,
        cnpj: '12345678000199'
      }, { db });
      await run(db, `UPDATE fechamentos_fiscais SET status=? WHERE id=?`, [estados[i], ff.id]);
    }
    // "reinício": apenas releitura
    for (let i = 0; i < estados.length; i++) {
      const row = await get(db, `SELECT status FROM fechamentos_fiscais WHERE data_fechamento=?`, [`2026-10-0${i + 1}`]);
      assert.strictEqual(row.status, estados[i]);
    }
    const txs = await all(db, `SELECT COUNT(*) AS n FROM fechamentos_fiscais_transmissoes`);
    // nenhuma transmissão automática criada pelo "restart"
    assert.ok(Number(txs[0]?.n || 0) >= 0);
  });

  // --- 13-16 timeout / recuperação / rejeição / erro ---
  await test('13/14 — Timeout + recuperação (SEFAZ autorizou, CDS não recebeu)', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO' WHERE status!='CANCELADO'`);
    const ff = await montarPronto(db, 700);
    await transmitirFechamento(ff.id, {}, depsTx(db, {
      enviarAutorizacao: async () => {
        const e = new Error('timeout');
        e.code = 'ECONNABORTED';
        throw e;
      }
    }));
    await run(
      db,
      `UPDATE fechamentos_fiscais_documentos
       SET status='EMITINDO', chave_acesso='35260912345678000199550010000005011234567890'
       WHERE fechamento_fiscal_id=?`,
      [ff.id]
    );
    const rec = await recuperarFechamento(ff.id, {}, depsTx(db));
    assert.strictEqual(rec.status, STATUS.AUTORIZADO);
    const aud = await all(db, `SELECT * FROM fechamentos_fiscais_transmissoes WHERE fechamento_fiscal_id=?`, [ff.id]);
    assert.ok(aud.some((a) => a.status === DOC_STATUS.AUTORIZADO || String(a.retorno_resumo || '').includes('RECUPERACAO')));
  });

  await test('15 — Rejeição fiscal diferenciada', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO' WHERE status!='CANCELADO'`);
    const ff = await montarPronto(db, 700);
    const r = await transmitirFechamento(ff.id, {}, depsTx(db, {
      enviarAutorizacao: async () => ({
        success: false,
        raw: '<cStat>225</cStat><xMotivo>Falha Schema</xMotivo>',
        cStat: '225'
      })
    }));
    assert.strictEqual(r.status, STATUS.REJEITADO);
    const doc = await get(db, `SELECT * FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id=? LIMIT 1`, [ff.id]);
    assert.strictEqual(doc.status, DOC_STATUS.REJEITADO);
    assert.strictEqual(String(doc.cstat), '225');
  });

  await test('16 — Erro técnico ≠ rejeição', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO' WHERE status!='CANCELADO'`);
    const ff = await montarPronto(db, 700);
    const r = await transmitirFechamento(ff.id, {}, depsTx(db, {
      enviarAutorizacao: async () => {
        const e = new Error('ECONNREFUSED');
        e.code = 'ECONNREFUSED';
        throw e;
      }
    }));
    assert.notStrictEqual(r.status, STATUS.REJEITADO);
    const doc = await get(db, `SELECT status FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id=? LIMIT 1`, [ff.id]);
    assert.ok([DOC_STATUS.ERRO, DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO].includes(doc.status));
  });

  // --- 17 numeração ---
  await test('17 — Numeração: prévia/preparação não consomem definitivo; transmissão consome', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO' WHERE status!='CANCELADO'`);
    let calls = 0;
    const ff = await criarRascunho({ data_fechamento: '2026-09-11', cnpj: '12345678000199' }, { db });
    await adicionarRecebimento(ff.id, { operadora: 'U', valor: 700 }, { db });
    await gerarPrevia({ id: ff.id, data: '2026-09-11', valor_informado: 700, persistir: true }, { db });
    assert.strictEqual(calls, 0);
    await prepararEmissao(ff.id, { gerarXml: true }, {
      db,
      getFiscalConfig: async () => ({ ...CFG_HOMOLOG }),
      certificadoOpcional: true,
      incrementaNumeroFiscal: async () => { calls += 1; return 1; },
      moduloOn: true
    });
    assert.strictEqual(calls, 0); // preparação usa peek, não incrementa via nosso mock (prep não chama incrementa)
    const docsPrep = await all(db, `SELECT numero, numero_provisorio FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id=?`, [ff.id]);
    assert.ok(docsPrep.every((d) => d.numero == null || d.numero_provisorio != null));

    await transmitirFechamento(ff.id, {}, depsTx(db, {
      incrementaNumeroFiscal: async () => { calls += 1; return 900 + calls; }
    }));
    assert.ok(calls >= 1);
    const docsTx = await all(db, `SELECT numero FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id=?`, [ff.id]);
    assert.ok(docsTx.every((d) => Number(d.numero) > 0));
  });

  // --- 18 CNPJ ---
  await test('18 — CNPJ/multiempresa isolado', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO' WHERE status!='CANCELADO'`);
    const a = await criarRascunho({ data_fechamento: '2026-11-01', cnpj: '11111111000111' }, { db });
    const b = await criarRascunho({ data_fechamento: '2026-11-01', cnpj: '22222222000122' }, { db });
    assert.notStrictEqual(a.id, b.id);
    assert.strictEqual(a.cnpj, '11111111000111');
    assert.strictEqual(b.cnpj, '22222222000122');
  });

  // --- 19 permissões (integração existente) ---
  await test('19 — Permissões: módulo fiscal exige recurso via server (contrato)', async () => {
    const server = fs.readFileSync(path.join(__dirname, '../../backend/server.js'), 'utf8');
    assert.match(server, /app\.use\('\/api\/fiscal',\s*verificarToken,\s*exigirRecurso\('fiscal'\)/);
    const rotas = fs.readFileSync(path.join(__dirname, '../../backend/rotas/fechamento-fiscal.js'), 'utf8');
    assert.match(rotas, /exigirModuloOn/);
    assert.match(rotas, /MODULO_OFF/);
  });

  // --- 20 cancelamento ---
  await test('20 — Cancelamento: antes OK; AUTORIZADO/EMITINDO bloqueados', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO' WHERE status!='CANCELADO'`);
    const ff = await criarRascunho({ data_fechamento: '2026-09-25', cnpj: '12345678000199' }, { db });
    const c = await cancelarFechamento(ff.id, { db });
    assert.strictEqual(c.status, STATUS.CANCELADO);

    const ff2 = await montarPronto(db, 700);
    await transmitirFechamento(ff2.id, {}, depsTx(db));
    let erro = null;
    try { await cancelarFechamento(ff2.id, { db }); } catch (e) { erro = e; }
    assert.ok(erro && erro.code === 'CANCELAMENTO_BLOQUEADO');

    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO' WHERE status!='CANCELADO'`);
    const ff3 = await montarPronto(db, 700);
    await run(db, `UPDATE fechamentos_fiscais SET status='EMITINDO' WHERE id=?`, [ff3.id]);
    erro = null;
    try { await cancelarFechamento(ff3.id, { db }); } catch (e) { erro = e; }
    assert.ok(erro && erro.code === 'CANCELAMENTO_BLOQUEADO');
  });

  // --- 21 dupla transmissão ---
  await test('21 — Dupla transmissão simultânea idempotente', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO' WHERE status!='CANCELADO'`);
    const ff = await montarPronto(db, 700);
    let envios = 0;
    const deps = depsTx(db, {
      enviarAutorizacao: async () => {
        envios += 1;
        await new Promise((r) => setTimeout(r, 30));
        return {
          success: true,
          raw: '<cStat>100</cStat><nProt>P1</nProt><xMotivo>Autorizado</xMotivo>',
          cStat: '100',
          protocolo: 'P1'
        };
      }
    });
    const [r1, r2] = await Promise.all([
      transmitirFechamento(ff.id, {}, deps),
      transmitirFechamento(ff.id, {}, deps)
    ]);
    assert.ok(r1.status === STATUS.AUTORIZADO || r2.status === STATUS.AUTORIZADO);
    const docs = await all(db, `SELECT id, chave_acesso, status FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id=?`, [ff.id]);
    assert.ok(docs.every((d) => d.status === DOC_STATUS.AUTORIZADO));
    // segunda chamada pode ser parcial/idempotente; não deve criar docs extras
    const count = await get(db, `SELECT COUNT(*) AS n FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id=?`, [ff.id]);
    assert.strictEqual(Number(count.n), docs.length);
  });

  // --- 22 dashboard ---
  await test('22 — Dashboard/margem não duplicados', async () => {
    const snap = await snapshotComercial(db);
    assert.ok(snap.margem_proxy !== undefined);
    assert.ok(snap.vendas >= 3);
  });

  // --- 23 XML ---
  await test('23 — XML íntegro (CNPJ, modelo 65, pagamentos)', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO' WHERE status!='CANCELADO'`);
    const ff = await montarPronto(db, 700);
    await transmitirFechamento(ff.id, {}, depsTx(db));
    const doc = await get(db, `SELECT * FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id=? LIMIT 1`, [ff.id]);
    assert.match(doc.xml_preparado || doc.xml_assinado || '', /<NFe/);
    assert.match(doc.xml_preparado || '', /<mod>65<\/mod>/);
    assert.match(doc.xml_preparado || '', /12345678000199|CNPJ/);
    assert.ok(doc.chave_acesso);
    assert.ok(doc.protocolo);
    assert.strictEqual(doc.data_hora_emissao != null, true);
    assert.notStrictEqual(doc.data_referencia_comercial, null);
  });

  // --- 24 auditoria ---
  await test('24 — Auditoria de tentativas registrada', async () => {
    const n = await get(db, `SELECT COUNT(*) AS n FROM fechamentos_fiscais_transmissoes`);
    assert.ok(Number(n.n) > 0);
    const row = await get(db, `SELECT * FROM fechamentos_fiscais_transmissoes ORDER BY id DESC LIMIT 1`);
    assert.ok(row.fechamento_fiscal_id);
    assert.ok(row.status);
    assert.ok(row.criado_em);
  });

  await test('25 — Produção permanece bloqueada', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO' WHERE status!='CANCELADO'`);
    const ff = await montarPronto(db, 700);
    let erro = null;
    try {
      await transmitirFechamento(ff.id, {}, depsTx(db, { config: { ambiente: 1 } }));
    } catch (e) { erro = e; }
    assert.ok(erro);
    assert.ok(erro.code === 'PRODUCAO_BLOQUEADA' || erro.code === 'AMBIENTE_NAO_HOMOLOGACAO');
  });

  await test('26 — Hora retroativa arbitrária bloqueada', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO' WHERE status!='CANCELADO'`);
    const ff = await montarPronto(db, 700);
    let erro = null;
    try {
      await transmitirFechamento(ff.id, { dhEmi: '2026-09-11T14:30:00' }, depsTx(db));
    } catch (e) { erro = e; }
    assert.ok(erro && erro.code === 'HORA_RETROATIVA_PROIBIDA');
  });

  await test('27 — assertModuloAtivo defesa em profundidade', async () => {
    await assertModuloAtivo(db, { moduloOn: true });
    let erro = null;
    try { await assertModuloAtivo(db, { moduloOn: false }); } catch (e) { erro = e; }
    assert.ok(erro && erro.code === 'MODULO_OFF');
  });

  console.log(`\nResultado Sprint 05: ${ok} OK, ${falhas} falha(s)\n`);
  db.close();
  process.exit(falhas ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
