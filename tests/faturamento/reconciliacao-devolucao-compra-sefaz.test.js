/**
 * Sprint — Reconciliação SEFAZ × NF-e Devolução de Compra × Saldo
 * Caso real: NF 100 cancelada na SEFAZ ainda constava como autorizada no CDS.
 *
 * Executar: node --test tests/faturamento/reconciliacao-devolucao-compra-sefaz.test.js
 */
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const CHAVE_ORIGEM = '42260707670414000258550010000158601949669171';
const CHAVE_DEV_100 = '23260857824986000131550010000001001956868253';

const {
  setDbForTests: setDbSaldo,
  garantirTabelasSaldoDevolucao,
  carregarSaldosDevolucaoCompra,
  round3
} = require('../../backend/services/fiscal/controleSaldoDevolucaoCompra');

const {
  setDbForTests: setDbLife,
  garantirSchemaLifecycle,
  reconciliarDevolucoesCompraComSefaz,
  sincronizarCancelamentoExternoDevolucao,
  sincronizarStatusDaConsulta,
  aplicarEventoDfeEmDevolucaoCompra,
  obterNota,
  ESTADOS,
  EVENTOS
} = require('../../backend/services/fiscal/nfeDevolucaoLifecycleService');

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

function xmlConsSit(cStat, xMotivo, nProt = 'PROT-AUTH-ORIG') {
  return `<?xml version="1.0"?>
    <retConsSitNFe versao="4.00">
      <tpAmb>2</tpAmb>
      <cStat>${cStat}</cStat>
      <xMotivo>${xMotivo}</xMotivo>
      <chNFe>${CHAVE_DEV_100}</chNFe>
      <protNFe><infProt>
        <cStat>${cStat}</cStat>
        <xMotivo>${xMotivo}</xMotivo>
        <nProt>${nProt}</nProt>
      </infProt></protNFe>
    </retConsSitNFe>`;
}

describe('Reconciliação SEFAZ × devolução compra × saldo', () => {
  let db;
  let compraId;
  let itemId;
  let nota100Id;

  before(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-rec-'));
    db = await openDb(path.join(dir, 't.db'));
    setDbSaldo(db);
    setDbLife(db);

    await run(db, `CREATE TABLE compras (
      id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, chave_acesso TEXT, fornecedor TEXT
    )`);
    await run(db, `CREATE TABLE compras_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT, compra_id INTEGER, produto_id INTEGER,
      quantidade REAL, preco_unitario REAL, custo_unitario_final REAL,
      ncm TEXT, unidade TEXT, descricao_produto TEXT, codigo_barras TEXT
    )`);
    await run(db, `CREATE TABLE produtos (
      id INTEGER PRIMARY KEY, nome TEXT, codigo TEXT, ncm TEXT, unidade TEXT
    )`);
    await run(db, `INSERT INTO produtos VALUES (1,'Produto X','PX','22021000','UN')`);

    const c = await run(
      db,
      `INSERT INTO compras (status, chave_acesso, fornecedor) VALUES ('finalizada',?,?)`,
      [CHAVE_ORIGEM, 'Fornecedor Teste']
    );
    compraId = c.lastID;

    const it = await run(
      db,
      `INSERT INTO compras_itens (compra_id, produto_id, quantidade, preco_unitario, ncm, unidade, descricao_produto)
       VALUES (?,?,?,?,?,?,?)`,
      [compraId, 1, 10, 5, '22021000', 'UN', 'Produto X']
    );
    itemId = it.lastID;

    await garantirSchemaLifecycle();
    await garantirTabelasSaldoDevolucao();
  });

  after(() => {
    setDbSaldo(null);
    setDbLife(null);
  });

  beforeEach(async () => {
    await run(db, `DELETE FROM nfe_devolucao_compra_itens`);
    await run(db, `DELETE FROM nfe_devolucao_compra_eventos`);
    await run(db, `DELETE FROM nfe_devolucao_compra_auditoria`);
    await run(db, `DELETE FROM nfe_devolucoes_compra`);
    // reset item qty for saldo tests that change purchase qty
    await run(db, `UPDATE compras_itens SET quantidade = 10 WHERE id = ?`, [itemId]);
  });

  async function criarNotaAutorizada({ chave = CHAVE_DEV_100, numero = 100, qtd = 6, protocolo = 'PROT-100' } = {}) {
    const n = await run(
      db,
      `INSERT INTO nfe_devolucoes_compra (
        compra_id, numero, serie, chave_acesso, chave_referenciada, protocolo, ambiente, status,
        xml_autorizado, xml_assinado
      ) VALUES (?,?,?,?,?,?,?,'autorizada',?,?)`,
      [compraId, numero, 1, chave, CHAVE_ORIGEM, protocolo, 2, '<nfeProc>AUTH</nfeProc>', '<NFe>ASSIN</NFe>']
    );
    await run(
      db,
      `INSERT INTO nfe_devolucao_compra_itens (
        nfe_devolucao_id, compra_id, compra_item_id, produto_id, quantidade, valor_unitario, valor_total
      ) VALUES (?,?,?,?,?,?,?)`,
      [n.lastID, compraId, itemId, 1, qtd, 5, qtd * 5]
    );
    return n.lastID;
  }

  it('1) NF autorizada consome saldo', async () => {
    await criarNotaAutorizada({ qtd: 6 });
    const s = await carregarSaldosDevolucaoCompra(compraId);
    assert.equal(round3(s.totais.devolvido), 6);
    assert.equal(round3(s.totais.saldo), 4);
  });

  it('2) NF cancelada não consome saldo', async () => {
    const id = await criarNotaAutorizada({ qtd: 6 });
    await run(db, `UPDATE nfe_devolucoes_compra SET status='cancelada' WHERE id=?`, [id]);
    const s = await carregarSaldosDevolucaoCompra(compraId);
    assert.equal(round3(s.totais.devolvido), 0);
    assert.equal(round3(s.totais.saldo), 10);
  });

  it('3/18) cStat 101 — caso real NF 100: autorizada → cancelada e libera saldo', async () => {
    nota100Id = await criarNotaAutorizada({ chave: CHAVE_DEV_100, numero: 100, qtd: 10 });
    let s = await carregarSaldosDevolucaoCompra(compraId);
    assert.equal(round3(s.totais.saldo), 0);

    const resumo = await reconciliarDevolucoesCompraComSefaz(compraId, {
      origem: 'emissao',
      forcar: true,
      consultarProtocolo: async () => ({
        success: true,
        body: xmlConsSit('101', 'Cancelamento de NF-e homologado')
      }),
      getFiscalConfig: async () => ({ ambiente: 2, codigoUf: '23' })
    });

    assert.equal(resumo.canceladas, 1);
    assert.equal(resumo.alteradas, 1);

    const nota = await obterNota(nota100Id);
    assert.equal(String(nota.status).toLowerCase(), 'cancelada');
    assert.ok(nota.cancelado_em);
    assert.match(String(nota.cancelado_por_nome || ''), /SEFAZ/i);
    assert.equal(nota.protocolo, 'PROT-100'); // protocolo autorização preservado
    assert.equal(nota.protocolo_cancelamento, null); // NÃO preencheu com prot de auth
    assert.equal(nota.xml_autorizado, '<nfeProc>AUTH</nfeProc>');
    assert.ok(nota.xml_retorno);

    s = await carregarSaldosDevolucaoCompra(compraId);
    assert.equal(round3(s.totais.devolvido), 0);
    assert.equal(round3(s.totais.saldo), 10);
  });

  it('4) cStat 135 → cancelada', async () => {
    const id = await criarNotaAutorizada({ qtd: 3 });
    await sincronizarStatusDaConsulta(id, xmlConsSit('135', 'Evento registrado'), {
      origemReconciliacao: true
    });
    const nota = await obterNota(id);
    assert.equal(nota.status, ESTADOS.CANCELADA);
  });

  it('5) cStat 155 → cancelada', async () => {
    const id = await criarNotaAutorizada({ qtd: 2 });
    await sincronizarStatusDaConsulta(id, xmlConsSit('155', 'Cancelamento homologado fora prazo'), {
      origemReconciliacao: true
    });
    assert.equal((await obterNota(id)).status, ESTADOS.CANCELADA);
  });

  it('6) NF rejeitada não consome saldo', async () => {
    const id = await criarNotaAutorizada({ qtd: 5 });
    await run(db, `UPDATE nfe_devolucoes_compra SET status='rejeitada' WHERE id=?`, [id]);
    const s = await carregarSaldosDevolucaoCompra(compraId);
    assert.equal(round3(s.totais.saldo), 10);
  });

  it('7) NF denegada não consome saldo', async () => {
    const id = await criarNotaAutorizada({ qtd: 5 });
    await run(db, `UPDATE nfe_devolucoes_compra SET status='denegada' WHERE id=?`, [id]);
    const s = await carregarSaldosDevolucaoCompra(compraId);
    assert.equal(round3(s.totais.saldo), 10);
  });

  it('8) reconciliação idempotente', async () => {
    const id = await criarNotaAutorizada({ qtd: 4 });
    const mock = async () => ({
      success: true,
      body: xmlConsSit('101', 'Cancelamento de NF-e homologado')
    });
    await reconciliarDevolucoesCompraComSefaz(compraId, {
      forcar: true, origem: 'emissao', consultarProtocolo: mock,
      getFiscalConfig: async () => ({ ambiente: 2 })
    });
    const r2 = await sincronizarCancelamentoExternoDevolucao(id, {
      cStat: '101', xMotivo: 'já cancelada'
    });
    assert.equal(r2.reused, true);
    assert.equal((await obterNota(id)).status, 'cancelada');
    // XML autorizado intacto
    assert.equal((await obterNota(id)).xml_autorizado, '<nfeProc>AUTH</nfeProc>');
  });

  it('9/10/11/12) XML autorizado preservado; retorno gravado; protocolo auth; sem protocolo_cancelamento indevido', async () => {
    const id = await criarNotaAutorizada({ qtd: 1, protocolo: 'AUTH-ONLY' });
    await sincronizarStatusDaConsulta(id, xmlConsSit('101', 'Cancelado', 'AUTH-ONLY'), {
      origemReconciliacao: true
    });
    const n = await obterNota(id);
    assert.equal(n.xml_autorizado, '<nfeProc>AUTH</nfeProc>');
    assert.ok(n.xml_retorno && n.xml_retorno.includes('101'));
    assert.equal(n.protocolo, 'AUTH-ONLY');
    assert.ok(n.protocolo_cancelamento == null || n.protocolo_cancelamento === '');
  });

  it('13/20) saldo após cancelamento externo: 10→4→10→7', async () => {
    await run(db, `UPDATE compras_itens SET quantidade = 10 WHERE id = ?`, [itemId]);
    const idA = await criarNotaAutorizada({ numero: 1, qtd: 6 });
    let s = await carregarSaldosDevolucaoCompra(compraId);
    assert.equal(round3(s.totais.saldo), 4);

    await sincronizarCancelamentoExternoDevolucao(idA, {
      cStat: '101',
      xMotivo: 'Cancelamento confirmado pela SEFAZ',
      body: xmlConsSit('101', 'Cancelamento')
    });
    s = await carregarSaldosDevolucaoCompra(compraId);
    assert.equal(round3(s.totais.saldo), 10);

    await criarNotaAutorizada({
      numero: 2,
      chave: '23260857824986000131550010000001021956868299',
      qtd: 3
    });
    s = await carregarSaldosDevolucaoCompra(compraId);
    assert.equal(round3(s.totais.saldo), 7);
  });

  it('15) evento 110111 pela chave atualiza nfe_devolucoes_compra', async () => {
    const id = await criarNotaAutorizada({ qtd: 8 });
    const xmlEv = `<procEventoNFe><evento><infEvento>
      <tpEvento>110111</tpEvento><chNFe>${CHAVE_DEV_100}</chNFe>
      <cStat>135</cStat><xMotivo>Evento registrado e vinculado</xMotivo>
    </infEvento></evento></procEventoNFe>`;
    const out = await aplicarEventoDfeEmDevolucaoCompra({
      chave: CHAVE_DEV_100,
      xml: xmlEv,
      tpEvento: '110111'
    });
    assert.equal(out.aplicado, true);
    assert.equal((await obterNota(id)).status, 'cancelada');
    const s = await carregarSaldosDevolucaoCompra(compraId);
    assert.equal(round3(s.totais.saldo), 10);
  });

  it('17) múltiplas devoluções — só autorizadas somam', async () => {
    await criarNotaAutorizada({ numero: 1, qtd: 2, chave: '23260857824986000131550010000000011956868201' });
    const id2 = await criarNotaAutorizada({ numero: 2, qtd: 3, chave: '23260857824986000131550010000000021956868202' });
    await run(db, `UPDATE nfe_devolucoes_compra SET status='cancelada' WHERE id=?`, [id2]);
    await criarNotaAutorizada({ numero: 3, qtd: 1, chave: '23260857824986000131550010000000031956868203' });
    const s = await carregarSaldosDevolucaoCompra(compraId);
    assert.equal(round3(s.totais.devolvido), 3); // 2+1
    assert.equal(round3(s.totais.saldo), 7);
  });

  it('código: montarDocumentoXml reconcilia antes do saldo; Central lista metadados reais', () => {
    const compra = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fiscal/nfeDevolucaoCompra.js'),
      'utf8'
    );
    assert.match(compra, /reconciliarDevolucoesCompraComSefaz/);
    assert.match(compra, /origem:\s*['"]emissao['"]/);
    const trechoMontar = compra.slice(compra.indexOf('async function montarDocumentoXmlDevolucaoCompra'));
    const idxRec = trechoMontar.indexOf('reconciliarDevolucoesCompraComSefaz');
    const idxSaldo = trechoMontar.indexOf('carregarSaldosComExcecao210240');
    assert.ok(idxRec > 0 && idxSaldo > idxRec, 'reconciliação deve ocorrer antes do saldo');

    const central = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fiscal/nfeCentralService.js'),
      'utf8'
    );
    assert.match(central, /d\.protocolo_cancelamento/);
    assert.match(central, /d\.consultado_em/);
    assert.match(central, /d\.cstat_retorno AS cstat_consulta/);

    const dfe = fs.readFileSync(
      path.join(__dirname, '../../backend/motores/central-entradas/services/CentralDfePersistenciaService.js'),
      'utf8'
    );
    assert.match(dfe, /aplicarEventoDfeEmDevolucaoCompra/);

    assert.equal(EVENTOS.CANCELAMENTO_CONFIRMADO_SEFAZ, 'CANCELAMENTO_CONFIRMADO_SEFAZ');
  });

  it('evento auditoria CANCELAMENTO_CONFIRMADO_SEFAZ registrado', async () => {
    const id = await criarNotaAutorizada({ qtd: 1 });
    await sincronizarCancelamentoExternoDevolucao(id, {
      cStat: '101',
      xMotivo: 'Cancelamento confirmado pela SEFAZ',
      origem: 'consulta_sefaz'
    });
    const ev = await get(
      db,
      `SELECT * FROM nfe_devolucao_compra_eventos WHERE nfe_devolucao_id=? AND evento=?`,
      [id, EVENTOS.CANCELAMENTO_CONFIRMADO_SEFAZ]
    );
    assert.ok(ev);
    const aud = await get(
      db,
      `SELECT * FROM nfe_devolucao_compra_auditoria WHERE nfe_devolucao_id=? AND acao=?`,
      [id, 'CANCELAMENTO_CONFIRMADO_SEFAZ']
    );
    assert.ok(aud);
  });
});
