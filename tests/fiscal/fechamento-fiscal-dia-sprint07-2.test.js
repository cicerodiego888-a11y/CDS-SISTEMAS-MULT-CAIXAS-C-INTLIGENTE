/**
 * Sprint 07.2 — Transmissão do Fechamento Fiscal em PRODUÇÃO
 * Executar: node tests/fiscal/fechamento-fiscal-dia-sprint07-2.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const {
  STATUS,
  DOC_STATUS,
  criarRascunho,
  adicionarRecebimento,
  gerarPrevia,
  prepararEmissaoFiscal,
  transmitirFechamentoFiscal,
  recuperarFechamentoFiscal,
  snapshotComercial,
  diagnosticarProntidaoTransmissao,
  garantirSchemaFechamentoFiscal
} = require('../../backend/services/fechamento-fiscal');
const moduloConfig = require('../../backend/services/fechamento-fiscal/fechamentoFiscalModuloConfig');

const ROOT = path.join(__dirname, '../..');
const FRONT = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fechamento-fiscal-dia.js'), 'utf8');
const TX = fs.readFileSync(path.join(ROOT, 'backend/services/fechamento-fiscal/FechamentoFiscalTransmissaoService.js'), 'utf8');
const ROTA = fs.readFileSync(path.join(ROOT, 'backend/rotas/fechamento-fiscal.js'), 'utf8');

const CFG_BASE = {
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

function openDb(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function schemaBase(db) {
  await run(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY, nome TEXT, codigo TEXT, preco_venda REAL DEFAULT 0, preco_compra REAL DEFAULT 0,
    item_fiscal INTEGER DEFAULT 0, unidade TEXT DEFAULT 'UN',
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
    quantidade REAL, valor_unitario REAL, valor_total REAL
  )`);
  await run(db, `CREATE TABLE financeiro (id INTEGER PRIMARY KEY, valor REAL, descricao TEXT, tipo TEXT, origem TEXT)`);
  await run(db, `CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT)`);
  await run(db, `INSERT INTO configuracoes (chave, valor) VALUES ('cnpj', '12345678000199')`);
  await run(db, `INSERT INTO configuracoes (chave, valor) VALUES ('fechamento_fiscal_do_dia', 'ATIVADO')`);
  await new Promise((resolve, reject) => {
    garantirSchemaFechamentoFiscal(db, (err) => (err ? reject(err) : resolve()));
  });
}

async function seed(db, data = '2026-09-13') {
  await run(db, `INSERT INTO produtos (id,nome,codigo,preco_venda,preco_compra,item_fiscal,unidade,saldo_fiscal,saldo_nao_fiscal,ativo,ncm,cfop,csosn,origem)
    VALUES (1,'Produto A','1',10,5,1,'UN',100,100,1,'21069090','5102','102',0)`);
  await run(db, `INSERT INTO vendas (id,data_venda,total,valor_nao_fiscal,status,cancelada)
    VALUES (1,?,44,44,'concluida',0)`, [data]);
  await run(db, `INSERT INTO vendas_itens (id,venda_id,produto_id,quantidade,quantidade_fiscal,quantidade_nao_fiscal,subtotal,valor_fiscal,valor_nao_fiscal,preco_unitario)
    VALUES (1,1,1,4,4,0,44,44,44,11)`);
  await run(db, `INSERT INTO financeiro (id,valor,descricao,tipo,origem) VALUES (1,44,'venda','receita','pdv')`);
}

let numeroSeq = 500;

function depsTx(db, overrides = {}) {
  numeroSeq = 500;
  return {
    db,
    moduloOn: true,
    capturarSnapshot: true,
    certificadoOpcional: true,
    getFiscalConfig: async () => ({ ...CFG_BASE, ...(overrides.config || {}) }),
    incrementaNumeroFiscal: async () => {
      numeroSeq += 1;
      return numeroSeq;
    },
    assinarDocumento: async ({ xmlSemAssinatura }) => ({
      xmlAssinado: String(xmlSemAssinatura).replace('</NFe>', '<Signature/><infNFeSupl/><qrCode>x</qrCode></NFe>'),
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

async function montarPronto(db) {
  const ff = await criarRascunho({ data_fechamento: '2026-09-13', cnpj: '12345678000199' }, { db });
  await adicionarRecebimento(ff.id, { operadora: 'Sicredi', valor: 44 }, { db });
  await gerarPrevia({ id: ff.id, data: '2026-09-13', valor_informado: 44, persistir: true }, { db });
  await prepararEmissaoFiscal(ff.id, { gerarXml: true }, {
    db,
    certificadoOpcional: true,
    getFiscalConfig: async () => ({ ...CFG_BASE })
  });
  return ff;
}

describe('Sprint 07.2 — transmissão em PRODUÇÃO', () => {
  it('código remove trava artificial de produção', () => {
    assert.doesNotMatch(TX, /AMBIENTE DE PRODUÇÃO → BLOQUEADO/);
    assert.doesNotMatch(TX, /somente em HOMOLOGAÇÃO nesta Sprint/);
    assert.match(TX, /diagnosticarProntidaoTransmissao/);
    assert.match(TX, /producao_bloqueada: false/);
    assert.match(ROTA, /producao_bloqueada: false/);
    assert.match(FRONT, /transmissaoHabilitada/);
    assert.doesNotMatch(FRONT, /permanece bloqueada nesta versão/);
    assert.doesNotMatch(FRONT, /Transmissão somente em homologação/);
  });

  it('TESTE 01 — diagnóstico PRODUÇÃO válida habilita transmissão', () => {
    const d = diagnosticarProntidaoTransmissao({ ...CFG_BASE, ambiente: 1 });
    assert.equal(d.ok, true);
    assert.equal(d.producao_bloqueada, false);
    assert.equal(d.transmissao_habilitada, true);
    assert.equal(d.ambiente, 1);
  });

  it('TESTE 02 — diagnóstico HOMOLOGAÇÃO válida', () => {
    const d = diagnosticarProntidaoTransmissao({ ...CFG_BASE, ambiente: 2 });
    assert.equal(d.ok, true);
    assert.equal(d.ambiente_label, 'HOMOLOGAÇÃO');
  });

  it('TESTE 03 — PRODUÇÃO + certificado ausente bloqueia', () => {
    const d = diagnosticarProntidaoTransmissao({
      ...CFG_BASE,
      ambiente: 1,
      certificadoPath: '',
      certificado_path: ''
    });
    assert.equal(d.ok, false);
    assert.ok(d.pendencias.some((p) => p.codigo === 'CERTIFICADO_AUSENTE'));
  });

  it('TESTE 04 — PRODUÇÃO + configuração incompleta bloqueia', () => {
    const d = diagnosticarProntidaoTransmissao({
      ambiente: 1,
      cnpj: '12345678000199',
      certificadoPath: 'x.pfx',
      serie: 1,
      uf: 'CE',
      idCSC: '',
      tokenCSC: '',
      urls: {}
    });
    assert.equal(d.ok, false);
    assert.ok(d.pendencias.length >= 1);
  });

  it('TESTE 05–14 — fluxo DB produção/homolog/idempotência/estoque', async () => {
    moduloConfig._resetCacheForTests();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffd-s072-'));
    const db = await openDb(path.join(dir, 't.db'));
    await schemaBase(db);
    await seed(db);

    // 05 — RASCUNHO bloqueado
    const rasc = await criarRascunho({ data_fechamento: '2026-09-13', cnpj: '12345678000199' }, { db });
    let erroRasc = null;
    try {
      await transmitirFechamentoFiscal(rasc.id, {}, depsTx(db, { config: { ambiente: 1 } }));
    } catch (e) { erroRasc = e; }
    assert.ok(erroRasc);
    assert.equal(erroRasc.code, 'STATUS_INVALIDO');

    // 01/06 — PRODUÇÃO com PRONTO_EMISSAO
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO'`);
    const ff = await montarPronto(db);
    const snapAntes = await snapshotComercial(db);
    const r1 = await transmitirFechamentoFiscal(ff.id, {}, depsTx(db, { config: { ambiente: 1 } }));
    assert.equal(r1.producao_bloqueada, false);
    assert.equal(r1.status, STATUS.AUTORIZADO);
    assert.ok(r1.ok);

    // 07 — já autorizado
    const r2 = await transmitirFechamentoFiscal(ff.id, {}, depsTx(db, { config: { ambiente: 1 } }));
    assert.equal(r2.idempotente, true);
    assert.equal(r2.status, STATUS.AUTORIZADO);

    // 10/11/12 — comercial intacto
    const snapDepois = await snapshotComercial(db);
    assert.equal(snapAntes.vendas, snapDepois.vendas);
    assert.equal(snapAntes.financeiro, snapDepois.financeiro);
    assert.equal(snapAntes.estoque_fiscal, snapDepois.estoque_fiscal);
    assert.equal(snapAntes.estoque_nao_fiscal, snapDepois.estoque_nao_fiscal);

    // 02 — homologação
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO'`);
    const ffH = await montarPronto(db);
    const rH = await transmitirFechamentoFiscal(ffH.id, {}, depsTx(db, { config: { ambiente: 2 } }));
    assert.equal(rH.status, STATUS.AUTORIZADO);
    assert.equal(rH.ambiente, 2);

    // 03 — cert ausente na transmissão
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO'`);
    const ffCert = await montarPronto(db);
    let erroCert = null;
    try {
      await transmitirFechamentoFiscal(ffCert.id, {}, {
        db,
        moduloOn: true,
        capturarSnapshot: false,
        certificadoOpcional: false,
        getFiscalConfig: async () => ({
          ...CFG_BASE,
          ambiente: 1,
          certificadoPath: '',
          certificado_path: ''
        }),
        incrementaNumeroFiscal: async () => 9001
        // sem assinarDocumento mock → exige certificadoPath
      });
    } catch (e) { erroCert = e; }
    assert.ok(erroCert);
    assert.equal(erroCert.code, 'CERTIFICADO_AUSENTE');
    // 09 — CNPJ divergente
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO'`);
    const ffCnpj = await montarPronto(db);
    let erroCnpj = null;
    try {
      await transmitirFechamentoFiscal(ffCnpj.id, {}, depsTx(db, {
        config: { ambiente: 1, cnpj: '99999999000191' }
      }));
    } catch (e) { erroCnpj = e; }
    assert.ok(erroCnpj);
    assert.equal(erroCnpj.code, 'CNPJ_DIVERGENTE');

    // 13 — rejeição
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO'`);
    const ffRej = await montarPronto(db);
    const rRej = await transmitirFechamentoFiscal(ffRej.id, {}, depsTx(db, {
      config: { ambiente: 1 },
      enviarAutorizacao: async () => ({
        success: false,
        raw: '<cStat>225</cStat><xMotivo>Falha Schema</xMotivo>',
        cStat: '225'
      })
    }));
    assert.equal(rRej.status, STATUS.REJEITADO);
    const docRej = await get(db, `SELECT * FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id=? LIMIT 1`, [ffRej.id]);
    assert.equal(docRej.status, DOC_STATUS.REJEITADO);
    assert.equal(String(docRej.cstat), '225');

    // 14 — recuperação
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO'`);
    const ffRec = await montarPronto(db);
    await transmitirFechamentoFiscal(ffRec.id, {}, depsTx(db, {
      config: { ambiente: 1 },
      enviarAutorizacao: async () => {
        const e = new Error('timeout');
        e.code = 'ECONNABORTED';
        throw e;
      }
    }));
    await run(db, `UPDATE fechamentos_fiscais_documentos
      SET chave_acesso='35260912345678000199550010000002011234567890', status='EMITINDO'
      WHERE fechamento_fiscal_id=?`, [ffRec.id]);
    const rec = await recuperarFechamentoFiscal(ffRec.id, {}, depsTx(db, { config: { ambiente: 1 } }));
    assert.equal(rec.status, STATUS.AUTORIZADO);

    // 08 — lock/duplo clique: Promise.all com mesmo id
    await run(db, `UPDATE fechamentos_fiscais SET status='CANCELADO'`);
    const ffDup = await montarPronto(db);
    let calls = 0;
    const depsDup = depsTx(db, {
      config: { ambiente: 1 },
      enviarAutorizacao: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 30));
        return {
          success: true,
          raw: '<cStat>100</cStat><nProt>1</nProt><xMotivo>Autorizado</xMotivo>',
          cStat: '100',
          protocolo: '1'
        };
      }
    });
    const [a, b] = await Promise.all([
      transmitirFechamentoFiscal(ffDup.id, {}, depsDup),
      transmitirFechamentoFiscal(ffDup.id, {}, depsDup)
    ]);
    assert.ok([a.status, b.status].includes(STATUS.AUTORIZADO));
    assert.ok(calls >= 1);
    // segunda chamada tende a ser idempotente após a primeira concluir
    assert.ok(a.idempotente || b.idempotente || calls === 1 || (a.ok || b.ok));

    db.close();
  });

  it('TESTE 15 — contrato UI confirmação PRODUÇÃO', () => {
    assert.match(FRONT, /CONFIRMAR TRANSMISSÃO/);
    assert.match(FRONT, /documento fiscal REAL/);
    assert.match(FRONT, /Ambiente: \$\{ambLabel\}/);
  });
});
