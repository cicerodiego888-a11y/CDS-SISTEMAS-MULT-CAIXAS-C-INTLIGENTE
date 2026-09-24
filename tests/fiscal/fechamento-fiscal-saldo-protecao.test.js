/**
 * Sprint — Proteção de saldo do Fechamento Fiscal
 * Executar: node --test tests/fiscal/fechamento-fiscal-saldo-protecao.test.js
 */
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const {
  calcularPendente,
  assertValorTentativaPermitido,
  montarMensagensSaldo,
  recalcularSaldoFechamento,
  garantirValorPrincipal,
  obterBaseNovaEmissao,
  continuarEmissaoFechamento
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalSaldoService');
const { DOC_STATUS, STATUS } = require('../../backend/services/fechamento-fiscal/constants');
const { garantirSchemaFechamentoFiscal } = require('../../backend/services/fechamento-fiscal/schema/fechamentoFiscalSchema');
const { toCentavos, arredondarMoeda } = require('../../backend/services/fiscal/modeloTotais');

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

describe('Fechamento Fiscal — proteção de saldo', () => {
  let db;
  let ffId;

  before(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-saldo-'));
    db = await openDb(path.join(dir, 't.db'));
    await run(db, `CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT)`);
    await run(db, `INSERT INTO configuracoes VALUES ('fechamento_fiscal_do_dia','ATIVADO')`);
    await run(db, `INSERT INTO configuracoes VALUES ('cnpj','12345678000199')`);
    await new Promise((resolve, reject) => {
      garantirSchemaFechamentoFiscal(db, (err) => (err ? reject(err) : resolve()));
    });
    // Aplicar ALTERS manualmente (garantirSchema só roda DDL+INDICES no loop principal)
    for (const sql of [
      `ALTER TABLE fechamentos_fiscais ADD COLUMN valor_principal REAL`,
      `ALTER TABLE fechamentos_fiscais ADD COLUMN valor_emitido_autorizado REAL NOT NULL DEFAULT 0`,
      `ALTER TABLE fechamentos_fiscais ADD COLUMN valor_pendente_emissao REAL NOT NULL DEFAULT 0`
    ]) {
      try { await run(db, sql); } catch (_) { /* already */ }
    }
    const ins = await run(
      db,
      `INSERT INTO fechamentos_fiscais (data_fechamento, cnpj, valor_informado, valor_distribuido, status)
       VALUES ('2026-09-23','12345678000199',687.76,687.76,'PRONTO_EMISSAO')`
    );
    ffId = ins.lastID;
  });

  async function limparDocs() {
    await run(db, `DELETE FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id=?`, [ffId]);
    await run(db, `UPDATE fechamentos_fiscais SET valor_principal=NULL, valor_emitido_autorizado=0, valor_pendente_emissao=0, status='PRONTO_EMISSAO' WHERE id=?`, [ffId]);
  }

  async function addDoc(valor, status, extra = {}) {
    return run(
      db,
      `INSERT INTO fechamentos_fiscais_documentos
        (fechamento_fiscal_id, sequencia, status, valor_total, cstat, protocolo, chave_acesso)
       VALUES (?,?,?,?,?,?,?)`,
      [
        ffId,
        extra.seq || 1,
        status,
        valor,
        extra.cstat || (status === DOC_STATUS.AUTORIZADO ? '100' : '539'),
        extra.protocolo || (status === DOC_STATUS.AUTORIZADO ? 'PROT1' : null),
        extra.chave || (status === DOC_STATUS.AUTORIZADO ? '23260912345678000199650010000000011123456789' : null)
      ]
    );
  }

  it('A) 100% autorizado → pendente 0', async () => {
    await limparDocs();
    await addDoc(687.76, DOC_STATUS.AUTORIZADO);
    const s = await recalcularSaldoFechamento(db, ffId);
    assert.equal(toCentavos(s.valor_principal), 68776);
    assert.equal(toCentavos(s.valor_emitido_autorizado), 68776);
    assert.equal(toCentavos(s.valor_pendente_emissao), 0);
    assert.equal(s.concluido, true);
  });

  it('B) 1ª autorizada + 2ª rejeitada → emitido só da autorizada', async () => {
    await limparDocs();
    await addDoc(259.99, DOC_STATUS.AUTORIZADO, { seq: 1 });
    await addDoc(249.97, DOC_STATUS.REJEITADO, { seq: 2, cstat: '539' });
    const s = await recalcularSaldoFechamento(db, ffId);
    assert.equal(toCentavos(s.valor_emitido_autorizado), 25999);
    assert.equal(toCentavos(s.valor_pendente_emissao), 42777);
    assert.equal(s.concluido, false);
  });

  it('C) 1ª autorizada + 2ª pendente recuperação', async () => {
    await limparDocs();
    await addDoc(200, DOC_STATUS.AUTORIZADO, { seq: 1 });
    await addDoc(100, DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO, { seq: 2, cstat: null });
    const s = await recalcularSaldoFechamento(db, ffId);
    assert.equal(toCentavos(s.valor_emitido_autorizado), 20000);
    assert.equal(toCentavos(s.valor_pendente_emissao), 48776);
  });

  it('D) várias autorizações parciais acumulam', async () => {
    await limparDocs();
    await addDoc(259.99, DOC_STATUS.AUTORIZADO, { seq: 1 });
    await addDoc(200.00, DOC_STATUS.AUTORIZADO, { seq: 2, protocolo: 'P2', chave: '23260912345678000199650010000000021123456789' });
    const s = await recalcularSaldoFechamento(db, ffId);
    assert.equal(toCentavos(s.valor_emitido_autorizado), 45999);
    assert.equal(toCentavos(s.valor_pendente_emissao), 22777);
  });

  it('E) rejeição 539 não muda emitido', async () => {
    await limparDocs();
    await addDoc(249.97, DOC_STATUS.REJEITADO, { cstat: '539' });
    const s = await recalcularSaldoFechamento(db, ffId);
    assert.equal(toCentavos(s.valor_emitido_autorizado), 0);
    assert.equal(toCentavos(s.valor_pendente_emissao), 68776);
  });

  it('F) timeout / possível processamento não conta como autorizado', async () => {
    await limparDocs();
    await addDoc(150, DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO);
    const s = await recalcularSaldoFechamento(db, ffId);
    assert.equal(toCentavos(s.valor_emitido_autorizado), 0);
    assert.equal(toCentavos(s.valor_pendente_emissao), 68776);
  });

  it('G) recuperação: após marcar autorizado, saldo atualiza', async () => {
    await limparDocs();
    const d = await addDoc(100, DOC_STATUS.EMITINDO, { cstat: null });
    await run(db, `UPDATE fechamentos_fiscais_documentos SET status=?, cstat='100', protocolo='R1', chave_acesso='23260912345678000199650010000000031123456789' WHERE id=?`,
      [DOC_STATUS.AUTORIZADO, d.lastID]);
    const s = await recalcularSaldoFechamento(db, ffId);
    assert.equal(toCentavos(s.valor_emitido_autorizado), 10000);
    assert.equal(toCentavos(s.valor_pendente_emissao), 58776);
  });

  it('H) retomada: base = pendente, nunca principal', async () => {
    await limparDocs();
    await addDoc(259.99, DOC_STATUS.AUTORIZADO);
    const base = await obterBaseNovaEmissao(db, ffId);
    assert.equal(toCentavos(base.valor_nova_tentativa), 42777);
    assert.notEqual(toCentavos(base.valor_nova_tentativa), 68776);
    assert.throws(
      () => assertValorTentativaPermitido(base, 687.76),
      /pendente|principal/i
    );
  });

  it('I) fechamento concluído bloqueia nova emissão', async () => {
    await limparDocs();
    await addDoc(687.76, DOC_STATUS.AUTORIZADO);
    await assert.rejects(() => obterBaseNovaEmissao(db, ffId), /autorizado|pendente|conclu/i);
  });

  it('J) soma autorizada exatamente = principal', async () => {
    await limparDocs();
    await addDoc(300.00, DOC_STATUS.AUTORIZADO, { seq: 1 });
    await addDoc(387.76, DOC_STATUS.AUTORIZADO, { seq: 2, protocolo: 'P2', chave: '23260912345678000199650010000000041123456789' });
    const s = await recalcularSaldoFechamento(db, ffId);
    assert.equal(toCentavos(s.valor_pendente_emissao), 0);
    assert.equal(s.concluido, true);
  });

  it('K) arredondamento de centavos (nunca negativo)', () => {
    assert.equal(calcularPendente(68776, 25999), 42777);
    assert.equal(calcularPendente(100, 100), 0);
    assert.equal(calcularPendente(100, 101), 0);
    assert.equal(arredondarMoeda(259.99 + 427.77), 687.76);
  });

  it('L) mensagens obrigatórias + valor_principal imutável', async () => {
    await limparDocs();
    const p1 = await garantirValorPrincipal(db, ffId, 687.76);
    const p2 = await garantirValorPrincipal(db, ffId, 999.99);
    assert.equal(toCentavos(p1), 68776);
    assert.equal(toCentavos(p2), 68776);
    await addDoc(259.99, DOC_STATUS.AUTORIZADO);
    const s = await recalcularSaldoFechamento(db, ffId, { ultimoAutorizado: 259.99 });
    const msgs = montarMensagensSaldo(s, { ultimoAutorizado: 259.99 });
    assert.ok(msgs.some((m) => /Venda emitida: R\$ 259\.99/.test(m)));
    assert.ok(msgs.some((m) => /Valor original do fechamento: R\$ 687\.76/.test(m)));
    assert.ok(msgs.some((m) => /Valor restante para emissão: R\$ 427\.77/.test(m)));
  });

  it('L2) continuar bloqueia se houver possível processamento', async () => {
    await limparDocs();
    await addDoc(100, DOC_STATUS.AUTORIZADO, { seq: 1 });
    await addDoc(50, DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO, { seq: 2 });
    await assert.rejects(
      () => continuarEmissaoFechamento(ffId, { db }),
      /recuperação|PENDENTE_RECUPERACAO/i
    );
  });

  it('código: preparar não apaga AUTORIZADO; UI tem Continuar emissão', () => {
    const prep = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fechamento-fiscal/FechamentoFiscalPreparacaoService.js'),
      'utf8'
    );
    assert.match(prep, /AUTORIZADO/);
    assert.match(prep, /nunca apaga NFC-e AUTORIZADA/i);
    const ui = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'),
      'utf8'
    );
    assert.match(ui, /ffdBtnContinuarEmissao/);
    assert.match(ui, /continuar-emissao/);
    assert.match(ui, /Valor restante para emissão/);
  });
});
