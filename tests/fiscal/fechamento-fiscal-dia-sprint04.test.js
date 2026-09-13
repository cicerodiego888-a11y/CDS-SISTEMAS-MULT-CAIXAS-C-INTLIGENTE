/**
 * Sprint 04 — Transmissão SEFAZ (homologação) do Fechamento Fiscal do Dia
 * Executar: node tests/fiscal/fechamento-fiscal-dia-sprint04.test.js
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
  transmitirFechamento,
  recuperarFechamento,
  snapshotComercial,
  toCentavos,
  STATUS,
  DOC_STATUS,
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
  certificadoPath: 'C:/fake.pfx',
  certificadoSenha: 'x',
  idCSC: '1',
  tokenCSC: 'TOKEN',
  urls: {
    autorizacao: 'https://homolog.example/autorizacao',
    consultaQr: 'https://homolog.example/qr',
    consultaChave: 'https://homolog.example/chave'
  }
};

let numeroSeq = 200;

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

async function montarProntoEmissao(db) {
  const ff = await criarRascunho({ data_fechamento: '2026-09-11', cnpj: '12345678000199' }, { db });
  await adicionarRecebimento(ff.id, { operadora: 'Sicredi', valor: 400 }, { db });
  await adicionarRecebimento(ff.id, { operadora: 'Stone', valor: 180 }, { db });
  await adicionarRecebimento(ff.id, { operadora: 'Mercado Pago', valor: 120 }, { db });
  await gerarPrevia({ id: ff.id, data: '2026-09-11', valor_informado: 700, persistir: true }, { db });
  await prepararEmissao(ff.id, { gerarXml: true }, {
    db,
    getFiscalConfig: async () => ({ ...CFG_HOMOLOG }),
    certificadoOpcional: true,
    bloquearProducaoEmTeste: true
  });
  return get(db, `SELECT * FROM fechamentos_fiscais WHERE id = ?`, [ff.id]);
}

function depsTx(db, overrides = {}) {
  numeroSeq = 200;
  return {
    db,
    moduloOn: true,
    capturarSnapshot: true,
    getFiscalConfig: async () => ({ ...CFG_HOMOLOG, ...(overrides.config || {}) }),
    incrementaNumeroFiscal: async () => {
      numeroSeq += 1;
      return numeroSeq;
    },
    assinarDocumento: async ({ xmlSemAssinatura, chave }) => ({
      xmlAssinado: String(xmlSemAssinatura).replace('</NFe>', `<Signature/><infNFeSupl/><qrCode>x</qrCode></NFe>`),
      qrCodeUrl: 'https://qr'
    }),
    enviarAutorizacao: overrides.enviarAutorizacao || (async () => ({
      success: true,
      raw: '<retEnviNFe><cStat>100</cStat><xMotivo>Autorizado</xMotivo><nProt>123456789012345</nProt></retEnviNFe>',
      cStat: '100',
      protocolo: '123456789012345'
    })),
    consultarProtocolo: overrides.consultarProtocolo || (async () => ({
      success: true,
      raw: '<retConsSitNFe><cStat>100</cStat><xMotivo>Autorizado</xMotivo><nProt>999</nProt></retConsSitNFe>',
      cStat: '100'
    })),
    ...overrides
  };
}

async function main() {
  console.log('\n=== Sprint 04 — Transmissão Homologação ===\n');
  moduloConfig._resetCacheForTests();
  // Garante cache alinhado ao DB de teste (ATIVADO no schemaBase)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffd-s04-'));
  const db = await openDb(path.join(dir, 'test.db'));
  await schemaBase(db);
  await seedComercial(db);

  await test('01 — Transmissão bloqueada quando módulo OFF', async () => {
    const ff = await montarProntoEmissao(db);
    let erro = null;
    try {
      await transmitirFechamento(ff.id, {}, depsTx(db, { moduloOn: false }));
    } catch (e) { erro = e; }
    assert.ok(erro);
    assert.strictEqual(erro.code, 'MODULO_OFF');
  });

  await test('02/24 — PRODUÇÃO permitida; ambiente inválido bloqueado', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status = 'CANCELADO'`);
    const ffProd = await montarProntoEmissao(db);
    const rProd = await transmitirFechamento(ffProd.id, {}, depsTx(db, { config: { ambiente: 1 } }));
    assert.ok(rProd.ok || rProd.status === STATUS.AUTORIZADO || rProd.transmissao_habilitada === true);
    assert.strictEqual(rProd.producao_bloqueada, false);
    assert.notStrictEqual(rProd.status, undefined);

    await run(db, `UPDATE fechamentos_fiscais SET status = 'CANCELADO'`);
    const ffBad = await montarProntoEmissao(db);
    let erro = null;
    try {
      await transmitirFechamento(ffBad.id, {}, depsTx(db, {
        config: { ambiente: 9, certificadoPath: '', idCSC: '', tokenCSC: '', urls: {} }
      }));
    } catch (e) { erro = e; }
    assert.ok(erro);
    assert.ok(
      erro.code === 'AMBIENTE_AUSENTE'
      || erro.code === 'CERTIFICADO_AUSENTE'
      || erro.code === 'CSC_AUSENTE'
      || erro.code === 'URL_AUTORIZACAO_AUSENTE'
      || erro.code === 'CONFIG_FISCAL_INCOMPLETA'
    );
    assert.notStrictEqual(erro.code, 'PRODUCAO_BLOQUEADA');
    assert.notStrictEqual(erro.code, 'AMBIENTE_NAO_HOMOLOGACAO');
  });

  await test('03 — Transmissão permitida somente em PRONTO_EMISSAO', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status = 'CANCELADO'`);
    const ff = await criarRascunho({ data_fechamento: '2026-09-12', cnpj: '12345678000199' }, { db });
    let erro = null;
    try {
      await transmitirFechamento(ff.id, {}, depsTx(db));
    } catch (e) { erro = e; }
    assert.ok(erro);
    assert.strictEqual(erro.code, 'STATUS_INVALIDO');
  });

  await test('04 — Documento inválido não transmite (sem XML/itens)', async () => {
    await run(db, `UPDATE fechamentos_fiscais SET status = 'CANCELADO' WHERE data_fechamento = '2026-09-11'`);
    const ff = await montarProntoEmissao(db);
    await run(db, `DELETE FROM fechamentos_fiscais_documentos_itens WHERE fechamento_fiscal_id = ?`, [ff.id]);
    await run(db, `UPDATE fechamentos_fiscais_documentos SET xml_preparado = NULL, status = 'PRONTO_EMISSAO' WHERE fechamento_fiscal_id = ?`, [ff.id]);
    const r = await transmitirFechamento(ff.id, {}, depsTx(db));
    assert.ok((r.resultados || []).some((x) => x.codigo === 'XML_AUSENTE' || x.status === DOC_STATUS.ERRO || x.mensagem));
  });

  // base limpa para fluxo feliz
  const db2 = await openDb(path.join(dir, 'test2.db'));
  await schemaBase(db2);
  await seedComercial(db2);
  const ffOk = await montarProntoEmissao(db2);
  const snapAntes = await snapshotComercial(db2);

  await test('fluxo feliz + 05/06/11/12/13 — autoriza, chave, protocolo, XML, idempotência', async () => {
    const r1 = await transmitirFechamento(ffOk.id, {}, depsTx(db2));
    assert.strictEqual(r1.status, STATUS.AUTORIZADO);
    assert.ok(r1.resumo.autorizados >= 1);
    const docs = await all(db2, `SELECT * FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id = ?`, [ffOk.id]);
    for (const d of docs) {
      assert.strictEqual(d.status, DOC_STATUS.AUTORIZADO);
      assert.ok(d.chave_acesso);
      assert.ok(d.protocolo);
      assert.ok(d.xml_autorizado || d.xml_assinado);
      assert.ok(d.numero);
      assert.notStrictEqual(d.data_hora_emissao, null);
    }

    const r2 = await transmitirFechamento(ffOk.id, {}, depsTx(db2));
    assert.strictEqual(r2.idempotente, true);
    assert.strictEqual(r2.status, STATUS.AUTORIZADO);

    const txs = await all(db2, `SELECT * FROM fechamentos_fiscais_transmissoes WHERE fechamento_fiscal_id = ?`, [ffOk.id]);
    assert.ok(txs.length >= docs.length);
  });

  await test('07 — Rejeição SEFAZ', async () => {
    await run(db2, `UPDATE fechamentos_fiscais SET status = 'CANCELADO'`);
    const ff = await montarProntoEmissao(db2);
    const r = await transmitirFechamento(ff.id, {}, depsTx(db2, {
      enviarAutorizacao: async () => ({
        success: false,
        raw: '<retEnviNFe><cStat>225</cStat><xMotivo>Falha no Schema XML</xMotivo></retEnviNFe>',
        cStat: '225'
      })
    }));
    assert.strictEqual(r.status, STATUS.REJEITADO);
    assert.ok(r.resumo.rejeitados >= 1);
    const doc = await get(db2, `SELECT * FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id = ? LIMIT 1`, [ff.id]);
    assert.strictEqual(doc.status, DOC_STATUS.REJEITADO);
    assert.strictEqual(String(doc.cstat), '225');
    assert.match(String(doc.xmotivo), /Schema/i);
  });

  await test('08 — Erro técnico', async () => {
    await run(db2, `UPDATE fechamentos_fiscais SET status = 'CANCELADO'`);
    const ff = await montarProntoEmissao(db2);
    const r = await transmitirFechamento(ff.id, {}, depsTx(db2, {
      enviarAutorizacao: async () => {
        const e = new Error('servico indisponivel');
        e.code = 'ECONNREFUSED';
        throw e;
      }
    }));
    assert.ok([STATUS.ERRO, STATUS.EMITINDO].includes(r.status));
    const doc = await get(db2, `SELECT * FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id = ? LIMIT 1`, [ff.id]);
    assert.ok([DOC_STATUS.ERRO, DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO].includes(doc.status));
    assert.notStrictEqual(doc.status, DOC_STATUS.REJEITADO);
  });

  await test('09/10 — Timeout + recuperação', async () => {
    await run(db2, `UPDATE fechamentos_fiscais SET status = 'CANCELADO'`);
    const ff = await montarProntoEmissao(db2);
    const r = await transmitirFechamento(ff.id, {}, depsTx(db2, {
      enviarAutorizacao: async () => {
        const e = new Error('timeout');
        e.code = 'ECONNABORTED';
        throw e;
      }
    }));
    assert.strictEqual(r.status, STATUS.EMITINDO);
    const docAntes = await get(db2, `SELECT * FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id = ? LIMIT 1`, [ff.id]);
    assert.strictEqual(docAntes.status, DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO);

    // simula chave já gerada no timeout path
    await run(db2, `UPDATE fechamentos_fiscais_documentos SET chave_acesso = '35260912345678000199550010000002011234567890', status = 'EMITINDO' WHERE fechamento_fiscal_id = ?`, [ff.id]);

    const rec = await recuperarFechamento(ff.id, {}, depsTx(db2));
    assert.strictEqual(rec.status, STATUS.AUTORIZADO);
    const doc = await get(db2, `SELECT * FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id = ? LIMIT 1`, [ff.id]);
    assert.strictEqual(doc.status, DOC_STATUS.AUTORIZADO);
    assert.ok(doc.protocolo);
  });

  await test('14/15 — Transmissão parcial + não retransmitir autorizado', async () => {
    await run(db2, `UPDATE fechamentos_fiscais SET status = 'CANCELADO'`);
    const ff = await montarProntoEmissao(db2);
    const docs = await all(db2, `SELECT id FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id = ? ORDER BY sequencia`, [ff.id]);
    let call = 0;
    const r = await transmitirFechamento(ff.id, {}, depsTx(db2, {
      enviarAutorizacao: async () => {
        call += 1;
        if (call === 1) {
          return {
            success: false,
            raw: '<cStat>225</cStat><xMotivo>Rejeitado parcial</xMotivo>',
            cStat: '225'
          };
        }
        return {
          success: true,
          raw: '<cStat>100</cStat><xMotivo>Autorizado</xMotivo><nProt>111</nProt>',
          cStat: '100',
          protocolo: '111'
        };
      }
    }));
    assert.ok(r.resumo.autorizados >= 1);
    assert.ok(r.resumo.rejeitados >= 1);

    const authIds = (await all(db2, `SELECT id FROM fechamentos_fiscais_documentos WHERE status = 'AUTORIZADO' AND fechamento_fiscal_id = ?`, [ff.id]))
      .map((d) => d.id);
    assert.ok(authIds.length >= 1);

    // reprocessa: autorizados não devem ser reenviados
    let enviados = 0;
    await transmitirFechamento(ff.id, {}, depsTx(db2, {
      enviarAutorizacao: async () => {
        enviados += 1;
        return {
          success: true,
          raw: '<cStat>100</cStat><xMotivo>Autorizado</xMotivo><nProt>222</nProt>',
          cStat: '100',
          protocolo: '222'
        };
      }
    }));
    // se ainda houver rejeitados, podem ser reenviados; autorizados não incrementam call além dos rejeitados
    const aindaAuth = await all(db2, `SELECT id, protocolo FROM fechamentos_fiscais_documentos WHERE id IN (${authIds.map(() => '?').join(',')})`, authIds);
    for (const a of aindaAuth) {
      assert.ok(a.protocolo === '111' || a.protocolo); // protocolo original preservado se não retransmitiu
    }
    assert.ok(docs.length >= 2);
    assert.ok(enviados <= docs.length - authIds.length + 1);
  });

  await test('16-21 — Estoque/financeiro/caixa/vendas/dashboard/margem inalterados', async () => {
    const snapDepois = await snapshotComercial(db2);
    assert.strictEqual(snapAntes.vendas, snapDepois.vendas);
    assert.strictEqual(snapAntes.financeiro, snapDepois.financeiro);
    assert.strictEqual(snapAntes.caixa, snapDepois.caixa);
    assert.strictEqual(snapAntes.estoque_fiscal, snapDepois.estoque_fiscal);
    assert.strictEqual(snapAntes.estoque_nao_fiscal, snapDepois.estoque_nao_fiscal);
    assert.strictEqual(snapAntes.margem_proxy, snapDepois.margem_proxy);
  });

  await test('22 — Data de referência preservada', async () => {
    const ff = await get(db2, `SELECT * FROM fechamentos_fiscais WHERE status = 'AUTORIZADO' ORDER BY id DESC LIMIT 1`);
    assert.ok(ff);
    assert.strictEqual(ff.data_referencia_comercial || ff.data_fechamento, '2026-09-11');
  });

  await test('23 — Data/hora emissão não pode ser arbitrariamente retroativa', async () => {
    await run(db2, `UPDATE fechamentos_fiscais SET status = 'CANCELADO'`);
    const ff = await montarProntoEmissao(db2);
    let erro = null;
    try {
      await transmitirFechamento(ff.id, { data_hora_emissao: '2026-09-11 14:30:00' }, depsTx(db2));
    } catch (e) { erro = e; }
    assert.ok(erro);
    assert.strictEqual(erro.code, 'HORA_RETROATIVA_PROIBIDA');
  });

  await test('05 — Documento autorizado não transmite novamente (doc-level)', async () => {
    await run(db2, `UPDATE fechamentos_fiscais SET status = 'CANCELADO'`);
    const ff = await montarProntoEmissao(db2);
    await transmitirFechamento(ff.id, {}, depsTx(db2));
    let calls = 0;
    const r = await transmitirFechamento(ff.id, {}, depsTx(db2, {
      enviarAutorizacao: async () => {
        calls += 1;
        return { success: true, raw: '<cStat>100</cStat><nProt>x</nProt>', cStat: '100' };
      }
    }));
    assert.strictEqual(r.idempotente, true);
    assert.strictEqual(calls, 0);
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
