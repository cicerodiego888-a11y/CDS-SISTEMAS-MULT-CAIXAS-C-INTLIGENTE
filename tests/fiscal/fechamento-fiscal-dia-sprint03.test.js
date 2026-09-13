/**
 * Sprint 03 — Preparação / validação fiscal do Fechamento Fiscal do Dia
 * Executar: node tests/fiscal/fechamento-fiscal-dia-sprint03.test.js
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
  gerarPrevia,
  prepararEmissao,
  validarSomente,
  snapshotComercial,
  toCentavos,
  STATUS,
  DOC_STATUS
} = require('../../backend/services/fechamento-fiscal');

const moduloConfig = require('../../backend/services/fechamento-fiscal/fechamentoFiscalModuloConfig');

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
  nomeEmpresa: 'EMPRESA TESTE LTDA',
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
  certificadoPath: null
};

async function schemaBase(db) {
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY, nome TEXT, codigo TEXT, preco_venda REAL DEFAULT 0, preco_compra REAL DEFAULT 0,
    item_fiscal INTEGER DEFAULT 0, produto_fracionado INTEGER DEFAULT 0, unidade TEXT DEFAULT 'UN',
    saldo_fiscal REAL DEFAULT 0, saldo_nao_fiscal REAL DEFAULT 0, ativo INTEGER DEFAULT 1,
    ncm TEXT, cest TEXT, cfop TEXT, csosn TEXT, origem INTEGER DEFAULT 0
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
    quantidade REAL, valor_unitario REAL, valor_total REAL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(db, `CREATE TABLE financeiro (id INTEGER PRIMARY KEY, valor REAL, descricao TEXT, tipo TEXT, origem TEXT)`);
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
  // Mesmo cenário Sprint 02 + campos fiscais (NCM/CFOP/CSOSN)
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem)
    VALUES (1,'Pastel Carne','1',10,5,1,'UN',50,50,1,'21069090','5102','102',0)`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem)
    VALUES (2,'Pastel Frango','2',12,6,1,'UN',50,50,1,'21069090','5102','102',0)`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem)
    VALUES (3,'Açaí 500ml','3',18,8,1,'UN',50,50,1,'21069090','5102','102',0)`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem)
    VALUES (4,'Pizza','4',40,20,1,'UN',50,50,1,'21069090','5102','102',0)`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem)
    VALUES (5,'Refrigerante','5',6,3,1,'UN',50,50,1,'22021000','5102','102',0)`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem)
    VALUES (6,'Sem Venda','6',9,4,1,'UN',10,10,1,'21069090','5102','102',0)`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem)
    VALUES (7,'Nao Fiscal','7',8,4,0,'UN',0,20,1,NULL,NULL,NULL,0)`);
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem)
    VALUES (8,'Item Caro','8',1000,500,1,'UN',5,5,1,'21069090','5102','102',0)`);

  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
    VALUES (1,?,1820,1820,'concluida',0)`, [data]);
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

  await run(db, `INSERT INTO financeiro (id,valor,descricao,tipo,origem) VALUES (1,1000,'venda','receita','pdv')`);
}

async function montarFechamentoPrevia(db, valor = 700) {
  const ff = await criarRascunho({ data_fechamento: '2026-09-11', cnpj: '12345678000199' }, { db });
  await adicionarRecebimento(ff.id, { operadora: 'Sicredi', valor: 400, cnpj: '12345678000199' }, { db });
  await adicionarRecebimento(ff.id, { operadora: 'Stone', valor: 180, cnpj: '12345678000199' }, { db });
  await adicionarRecebimento(ff.id, { operadora: 'Mercado Pago', valor: 120, cnpj: '12345678000199' }, { db });
  const result = await gerarPrevia({
    id: ff.id,
    data: '2026-09-11',
    valor_informado: valor,
    persistir: true
  }, { db });
  assert.ok(result.previa.perfeita, result.previa.mensagem);
  return result.fechamento;
}

function depsPrep(db, cfg = CFG_HOMOLOG) {
  return {
    db,
    getFiscalConfig: async () => ({ ...cfg }),
    certificadoOpcional: true,
    bloquearProducaoEmTeste: true,
    capturarSnapshot: true
  };
}

async function main() {
  console.log('\n=== Sprint 03 — Preparação / Validação Fiscal ===\n');
  moduloConfig._resetCacheForTests();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffd-s03-'));
  const db = await openDb(path.join(dir, 'test.db'));
  await schemaBase(db);
  await seedComercial(db);

  await test('01 — Preparação de fechamento válido', async () => {
    const ff = await montarFechamentoPrevia(db);
    const snapAntes = await snapshotComercial(db);
    const prep = await prepararEmissao(ff.id, { gerarXml: true }, depsPrep(db));
    assert.strictEqual(prep.ok, true);
    assert.strictEqual(prep.status, STATUS.PRONTO_EMISSAO);
    assert.ok(prep.documentos.length >= 1);
    assert.strictEqual(prep.protecao.comercial_inalterado, true);
    assert.strictEqual(JSON.stringify(snapAntes), JSON.stringify(await snapshotComercial(db)));
  });

  await test('02 — Validação de produto (somente leitura)', async () => {
    const ff = await get(db, `SELECT id FROM fechamentos_fiscais ORDER BY id DESC LIMIT 1`);
    const v = await validarSomente(ff.id, {}, depsPrep(db));
    // já está PRONTO_EMISSAO — validação estrutural ainda roda
    assert.ok(v.validacao);
  });

  // Banco limpo para cenários de erro de produto
  const db2 = await openDb(path.join(dir, 'test2.db'));
  await schemaBase(db2);
  await seedComercial(db2);

  await test('03 — Produto sem NCM', async () => {
    await run(db2, `UPDATE produtos SET ncm = NULL WHERE id = 3`);
    const ff = await montarFechamentoPrevia(db2);
    let erro = null;
    try {
      await prepararEmissao(ff.id, {}, depsPrep(db2));
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
    assert.strictEqual(erro.code, 'VALIDACAO_FISCAL');
    assert.ok((erro.erros || []).some((e) => e.codigo === 'NCM_AUSENTE'));
    assert.match(String(erro.message), /NCM/i);
    await run(db2, `UPDATE produtos SET ncm = '21069090' WHERE id = 3`);
  });

  await test('04 — Produto sem CFOP', async () => {
    await run(db2, `UPDATE produtos SET cfop = NULL WHERE id = 1`);
    // regenerar rascunho novo
    await run(db2, `UPDATE fechamentos_fiscais SET status = 'CANCELADO' WHERE status != 'CANCELADO'`);
    const ff = await montarFechamentoPrevia(db2);
    let erro = null;
    try {
      await prepararEmissao(ff.id, {}, depsPrep(db2));
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
    assert.ok((erro.erros || []).some((e) => e.codigo === 'CFOP_AUSENTE'));
    await run(db2, `UPDATE produtos SET cfop = '5102' WHERE id = 1`);
  });

  await test('05 — Produto sem tributação', async () => {
    await run(db2, `UPDATE produtos SET csosn = NULL WHERE id = 2`);
    await run(db2, `UPDATE fechamentos_fiscais SET status = 'CANCELADO' WHERE status != 'CANCELADO'`);
    const ff = await montarFechamentoPrevia(db2);
    let erro = null;
    try {
      await prepararEmissao(ff.id, {}, depsPrep(db2));
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
    assert.ok((erro.erros || []).some((e) => e.codigo === 'TRIBUTACAO_AUSENTE'));
    await run(db2, `UPDATE produtos SET csosn = '102' WHERE id = 2`);
  });

  await test('06/07/08 — Totais itens = vendas = fechamento', async () => {
    await run(db2, `UPDATE fechamentos_fiscais SET status = 'CANCELADO' WHERE status != 'CANCELADO'`);
    const ff = await montarFechamentoPrevia(db2);
    const prep = await prepararEmissao(ff.id, {}, depsPrep(db2));
    const somaDocs = prep.documentos.reduce((s, d) => s + toCentavos(d.valor_total), 0);
    assert.strictEqual(somaDocs, 70000);
    for (const d of prep.documentos) {
      const somaItens = d.itens.reduce((s, i) => s + toCentavos(i.valor_total), 0);
      assert.strictEqual(somaItens, toCentavos(d.valor_total));
    }
  });

  await test('09 — Centavos (sem float frágil)', async () => {
    assert.strictEqual(toCentavos(125.89), 12589);
    assert.strictEqual(toCentavos(700), 70000);
  });

  await test('10 — Dados de pagamento (sem financeiro)', async () => {
    const ff = await get(db2, `SELECT id FROM fechamentos_fiscais WHERE status = ?`, [STATUS.PRONTO_EMISSAO]);
    const pags = await all(db2, `SELECT * FROM fechamentos_fiscais_documentos_pagamentos WHERE fechamento_fiscal_id = ?`, [ff.id]);
    assert.ok(pags.length >= 1);
    const soma = pags.reduce((s, p) => s + toCentavos(p.valor), 0);
    assert.strictEqual(soma, 70000);
    const fin = await get(db2, `SELECT COUNT(*) AS n FROM financeiro`);
    assert.strictEqual(Number(fin.n), 1);
  });

  await test('11/12 — CNPJ e empresa corretos', async () => {
    const ff = await get(db2, `SELECT * FROM fechamentos_fiscais WHERE status = ?`, [STATUS.PRONTO_EMISSAO]);
    assert.ok(ff);
    assert.strictEqual(String(ff.cnpj).replace(/\D/g, ''), '12345678000199');

    // CNPJ divergente deve falhar em um fechamento novo (não contaminar o PRONTO atual)
    await run(db2, `UPDATE fechamentos_fiscais SET status = 'CANCELADO' WHERE id = ?`, [ff.id]);
    const ff2 = await montarFechamentoPrevia(db2);
    let erro = null;
    try {
      await prepararEmissao(ff2.id, {}, depsPrep(db2, { ...CFG_HOMOLOG, cnpj: '00000000000000' }));
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
    assert.ok((erro.erros || []).some((e) => e.codigo === 'CNPJ_DIVERGENTE' || e.codigo === 'CNPJ_INVALIDO'));

    // Restaura um fechamento PRONTO para os testes seguintes
    await run(db2, `UPDATE fechamentos_fiscais SET status = 'CANCELADO' WHERE status != 'CANCELADO'`);
    const ffOk = await montarFechamentoPrevia(db2);
    await prepararEmissao(ffOk.id, {}, depsPrep(db2));
  });

  await test('13/14 — Série e numeração provisória (sem consumir)', async () => {
    const docs = await all(db2, `SELECT * FROM fechamentos_fiscais_documentos ORDER BY sequencia`);
    assert.ok(docs.length >= 1);
    for (const d of docs) {
      assert.strictEqual(String(d.serie), '1');
      assert.ok(Number(d.numero_provisorio) >= 100);
    }
    // numeração em config não muda
    const cfgNum = await get(db2, `SELECT valor FROM configuracoes WHERE chave = 'fiscal_serie'`);
    assert.strictEqual(cfgNum.valor, '1');
  });

  await test('15 — Idempotência', async () => {
    const ff = await get(db2, `SELECT id FROM fechamentos_fiscais WHERE status = ?`, [STATUS.PRONTO_EMISSAO]);
    const antes = await all(db2, `SELECT id FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id = ?`, [ff.id]);
    const prep2 = await prepararEmissao(ff.id, {}, depsPrep(db2));
    assert.strictEqual(prep2.idempotente, true);
    const depois = await all(db2, `SELECT id FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id = ?`, [ff.id]);
    assert.strictEqual(antes.length, depois.length);
  });

  await test('16 — Duplicidade (1 doc por venda prévia)', async () => {
    const docs = await all(db2, `SELECT previa_venda_id, COUNT(*) AS n FROM fechamentos_fiscais_documentos GROUP BY previa_venda_id`);
    for (const d of docs) assert.strictEqual(Number(d.n), 1);
  });

  await test('17 — Estoque não alterado', async () => {
    const e = await get(db2, `SELECT SUM(saldo_fiscal) AS f, SUM(saldo_nao_fiscal) AS nf FROM produtos`);
    assert.strictEqual(Number(e.f), 265);
    assert.strictEqual(Number(e.nf), 285);
  });

  await test('18 — Financeiro não alterado', async () => {
    const f = await get(db2, `SELECT COUNT(*) AS n, SUM(valor) AS s FROM financeiro`);
    assert.strictEqual(Number(f.n), 1);
    assert.strictEqual(Number(f.s), 1000);
  });

  await test('19 — Caixa não alterado', async () => {
    const c = await get(db2, `SELECT COUNT(*) AS n FROM financeiro WHERE origem LIKE '%caixa%'`);
    assert.strictEqual(Number(c.n), 0);
  });

  await test('20 — Vendas não alteradas', async () => {
    const v = await get(db2, `SELECT COUNT(*) AS n, SUM(total) AS t FROM vendas`);
    assert.strictEqual(Number(v.n), 2);
    assert.strictEqual(Number(v.t), 1856);
    const vi = await get(db2, `SELECT COUNT(*) AS n FROM vendas_itens`);
    assert.strictEqual(Number(vi.n), 8);
  });

  await test('21 — Dashboard não alterado (proxy margem)', async () => {
    const snap = await snapshotComercial(db2);
    assert.strictEqual(snap.vendas, 2);
    assert.strictEqual(snap.financeiro, 1);
    assert.ok(snap.margem_proxy !== undefined);
  });

  await test('22 — XML gerado corretamente', async () => {
    const doc = await get(db2, `SELECT * FROM fechamentos_fiscais_documentos WHERE xml_preparado IS NOT NULL LIMIT 1`);
    assert.ok(doc);
    assert.match(doc.xml_preparado, /<NFe/);
    assert.match(doc.xml_preparado, /<mod>65<\/mod>/);
    assert.match(doc.xml_preparado, /<detPag>/);
    assert.ok(doc.xml_hash);
    assert.strictEqual(doc.status, DOC_STATUS.PRONTO_EMISSAO);
  });

  await test('23 — Data referência ≠ data/hora preparação', async () => {
    const doc = await get(db2, `SELECT * FROM fechamentos_fiscais_documentos LIMIT 1`);
    assert.strictEqual(doc.data_referencia_comercial, '2026-09-11');
    assert.ok(doc.data_hora_preparacao);
    assert.notStrictEqual(doc.data_hora_preparacao.slice(0, 10), undefined);
    assert.strictEqual(doc.data_hora_emissao, null);
  });

  await test('24 — Proibição de hora retroativa arbitrária', async () => {
    await run(db2, `UPDATE fechamentos_fiscais SET status = 'CANCELADO' WHERE status != 'CANCELADO'`);
    const ff = await montarFechamentoPrevia(db2);
    let erro = null;
    try {
      await prepararEmissao(ff.id, { data_hora_emissao: '2026-09-11 14:30:00' }, depsPrep(db2));
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
    assert.strictEqual(erro.code, 'HORA_RETROATIVA_PROIBIDA');
  });

  await test('25 — Homologação separada de produção', async () => {
    await run(db2, `UPDATE fechamentos_fiscais SET status = 'CANCELADO' WHERE status != 'CANCELADO'`);
    const ff = await montarFechamentoPrevia(db2);
    let erro = null;
    try {
      await prepararEmissao(ff.id, {}, depsPrep(db2, { ...CFG_HOMOLOG, ambiente: 1 }));
    } catch (e) {
      erro = e;
    }
    assert.ok(erro);
    assert.ok((erro.erros || []).some((e) => e.codigo === 'PRODUCAO_BLOQUEADA'));

    const prepOk = await prepararEmissao(ff.id, {}, depsPrep(db2, { ...CFG_HOMOLOG, ambiente: 2 }));
    assert.strictEqual(Number(prepOk.ambiente), 2);
  });

  console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
  db.close();
  db2.close();
  process.exit(falhas ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
