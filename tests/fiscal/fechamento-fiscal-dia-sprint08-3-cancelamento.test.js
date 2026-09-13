/**
 * Sprint 08.3 — Cancelamento fiscal NFC-e do Fechamento
 * Executar: node --test tests/fiscal/fechamento-fiscal-dia-sprint08-3-cancelamento.test.js
 * NÃO transmite cancelamento real.
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '../..');
const FRONT = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fiscal.js'), 'utf8');
const ROTA = fs.readFileSync(path.join(ROOT, 'backend/rotas/fiscal.js'), 'utf8');
const SVC = fs.readFileSync(
  path.join(ROOT, 'backend/services/fechamento-fiscal/NfceCancelamentoFechamentoService.js'),
  'utf8'
);
const CANCEL_SRC = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/cancelarNfce.js'), 'utf8');
const CONST_SRC = fs.readFileSync(
  path.join(ROOT, 'backend/services/fechamento-fiscal/constants.js'),
  'utf8'
);

const {
  cancelarDocumentoFiscalFechamento,
  formatarRotuloFechamento,
  LOCKS
} = require('../../backend/services/fechamento-fiscal/NfceCancelamentoFechamentoService');
const { STATUS, DOC_STATUS } = require('../../backend/services/fechamento-fiscal/constants');
const { ORIGEM_FECHAMENTO } = require('../../backend/services/fechamento-fiscal/NfceHistoricoOficialService');

const CHAVE = '23260968645756000121650010000000511873269476';
const PROTOCOLO = '223260816956854';
const XML_ORIG = '<NFe><infNFe Id="NFe' + CHAVE + '"><total><vNF>44.00</vNF></total></infNFe></NFe>';

function openMem() {
  return new sqlite3.Database(':memory:');
}
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function close(db) {
  return new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
}

async function schema(db) {
  await run(db, 'CREATE TABLE vendas (id INTEGER PRIMARY KEY, codigo TEXT, total REAL, status TEXT)');
  await run(db, 'CREATE TABLE vendas_itens (id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER)');
  await run(db, 'CREATE TABLE financeiro (id INTEGER PRIMARY KEY, valor REAL)');
  await run(db, 'CREATE TABLE produtos (id INTEGER PRIMARY KEY, estoque REAL DEFAULT 0)');
  await run(db, `CREATE TABLE nfce_notas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER,
    numero INTEGER NOT NULL,
    serie INTEGER NOT NULL,
    chave_acesso TEXT,
    ambiente INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pendente',
    xml_enviado TEXT,
    xml_retorno TEXT,
    protocolo TEXT,
    recibo TEXT,
    qr_code_url TEXT,
    danfe_html TEXT,
    fechamento_fiscal_id INTEGER,
    fechamento_documento_id INTEGER,
    origem TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(db, `CREATE TABLE fechamentos_fiscais (
    id INTEGER PRIMARY KEY, status TEXT, valor_informado REAL, valor_distribuido REAL,
    atualizado_em TEXT
  )`);
  await run(db, `CREATE TABLE fechamentos_fiscais_documentos (
    id INTEGER PRIMARY KEY,
    fechamento_fiscal_id INTEGER,
    status TEXT,
    numero INTEGER,
    serie TEXT,
    ambiente INTEGER,
    chave_acesso TEXT,
    protocolo TEXT,
    cstat TEXT,
    xmotivo TEXT,
    valor_total REAL,
    xml_enviado TEXT,
    xml_retorno TEXT,
    atualizado_em TEXT
  )`);
}

function mockCancelOk(id) {
  return {
    sefaz: '<retEnvEvento><cStat>128</cStat><retEvento><infEvento><cStat>135</cStat><xMotivo>Evento registrado</xMotivo><nProt>PROT-CANC-TEST</nProt><dhRegEvento>2026-09-13T19:00:00-03:00</dhRegEvento></infEvento></retEvento></retEnvEvento>',
    notaId: id,
    chaveAcesso: CHAVE,
    protocolo: PROTOCOLO,
    source: 'mock',
    fallbackUtilizado: false
  };
}

describe('Sprint 08.3 — cancelamento fiscal Fechamento', () => {
  let db;
  let nfceId;

  before(async () => {
    db = openMem();
    await schema(db);
    await run(db, "INSERT INTO vendas (id, codigo, total, status) VALUES (1, 'VND-001', 10, 'finalizada')");
    await run(db, 'INSERT INTO produtos (id, estoque) VALUES (1, 100)');
    await run(db, "INSERT INTO nfce_notas (venda_id, numero, serie, chave_acesso, ambiente, status, protocolo) VALUES (1, 40, 1, 'CHAVE-VENDA', 1, 'autorizada', 'PROT-V')");
    await run(db, "INSERT INTO fechamentos_fiscais (id, status, valor_informado, valor_distribuido) VALUES (4, 'AUTORIZADO', 44, 44)");
    await run(db, `INSERT INTO fechamentos_fiscais_documentos (
      id, fechamento_fiscal_id, status, numero, serie, ambiente, chave_acesso, protocolo, cstat, valor_total, xml_enviado
    ) VALUES (2, 4, 'AUTORIZADO', 51, '1', 1, ?, ?, '100', 44, ?)`, [CHAVE, PROTOCOLO, XML_ORIG]);
    await run(db, `INSERT INTO nfce_notas (
      venda_id, numero, serie, chave_acesso, ambiente, status, xml_enviado, xml_retorno, protocolo,
      fechamento_fiscal_id, fechamento_documento_id, origem
    ) VALUES (NULL, 51, 1, ?, 1, 'autorizada', ?, '<ret><cStat>100</cStat></ret>', ?, 4, 2, ?)`,
    [CHAVE, XML_ORIG, PROTOCOLO, ORIGEM_FECHAMENTO]);
    nfceId = (await get(db, 'SELECT id FROM nfce_notas WHERE chave_acesso=?', [CHAVE])).id;
  });

  after(async () => {
    LOCKS.clear();
    await close(db);
  });

  it('A — NFC-e normal continua exibindo Cancelar venda', () => {
    assert.match(FRONT, /Cancelar venda/);
    assert.match(FRONT, /acaoNfceEmitidaCancelarVenda/);
  });

  it('B — NFC-e normal continua utilizando fluxo comercial existente', () => {
    assert.match(FRONT, /cancelarVendaNaoFiscal\(/);
    assert.doesNotMatch(FRONT, /acaoNfceEmitidaCancelarVenda[\s\S]{0,80}cancelarDocumentoFiscalNfce/);
  });

  it('C — FF-000004 não exibe Cancelar venda no ramo fechamento', () => {
    assert.match(FRONT, /ehNfceFechamentoFiscal/);
    assert.match(FRONT, /Cancelar documento fiscal/);
    // no ramo fechamento não chama cancelarVendaNaoFiscal
    const blocoFf = FRONT.slice(
      FRONT.indexOf('if (isFechamento)'),
      FRONT.indexOf('} else if (vendaId)')
    );
    assert.doesNotMatch(blocoFf, /Cancelar venda/);
    assert.match(blocoFf, /Cancelar documento fiscal/);
  });

  it('D — FF exibe Cancelar documento fiscal', () => {
    assert.match(FRONT, /cancelarDocumentoFiscalNfce\(/);
    assert.match(FRONT, /Cancelar documento fiscal/);
  });

  it('E — clicar no cancelamento abre confirmação', () => {
    assert.match(FRONT, /Deseja cancelar esta NFC-e\?/);
    assert.match(FRONT, /modalCancelarDocFiscalNfce/);
  });

  it('F — cancelamento exige justificativa conforme regra fiscal', () => {
    assert.match(FRONT, /validarMotivoTexto|mínimo 15 caracteres/);
    assert.match(SVC, /validarMotivoTexto/);
  });

  it('G — documento não autorizado não pode ser cancelado', async () => {
    const pend = await run(db, `INSERT INTO nfce_notas
      (venda_id, numero, serie, chave_acesso, ambiente, status, protocolo, fechamento_fiscal_id, origem)
      VALUES (NULL, 99, 1, 'CHAVE-PENDENTE-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', 1, 'pendente', 'P', 4, ?)`,
      [ORIGEM_FECHAMENTO]);
    await assert.rejects(
      () => cancelarDocumentoFiscalFechamento(db, pend.id, 'Justificativa valida com mais de quinze', {
        deps: {
          cancelarNfcePorId: async () => mockCancelOk(pend.id),
          skipSnapshot: true, ignorarPrazoLocal: true,
          ignorarPrazoLocal: true
        }
      }),
      /autorizada/i
    );
  });

  it('H — documento já cancelado não transmite de novo (idempotente)', async () => {
    let calls = 0;
    const r1 = await cancelarDocumentoFiscalFechamento(db, nfceId, 'Justificativa valida com mais de quinze', {
      deps: {
        cancelarNfcePorId: async (id) => { calls += 1; return mockCancelOk(id); },
        skipSnapshot: false, ignorarPrazoLocal: true
      }
    });
    assert.equal(r1.success, true);
    assert.equal(r1.status, 'cancelada');
    assert.equal(calls, 1);

    const r2 = await cancelarDocumentoFiscalFechamento(db, nfceId, 'Justificativa valida com mais de quinze', {
      deps: {
        cancelarNfcePorId: async (id) => { calls += 1; return mockCancelOk(id); },
        skipSnapshot: true, ignorarPrazoLocal: true
      }
    });
    assert.equal(r2.idempotente, true);
    assert.equal(calls, 1);
  });

  it('I/J — venda_id do FF continua NULL; nenhum artificial', async () => {
    const nota = await get(db, 'SELECT venda_id FROM nfce_notas WHERE id=?', [nfceId]);
    assert.equal(nota.venda_id, null);
  });

  it('K/L/M — sem venda/estoque/financeiro novos', async () => {
    // re-seed authorized for commercial check
    await run(db, "UPDATE nfce_notas SET status='autorizada' WHERE id=?", [nfceId]);
    await run(db, "UPDATE fechamentos_fiscais SET status='AUTORIZADO' WHERE id=4");
    const antes = {
      v: (await get(db, 'SELECT COUNT(*) AS c FROM vendas')).c,
      i: (await get(db, 'SELECT COUNT(*) AS c FROM vendas_itens')).c,
      f: (await get(db, 'SELECT COUNT(*) AS c FROM financeiro')).c,
      e: (await get(db, 'SELECT estoque FROM produtos WHERE id=1')).estoque
    };
    await cancelarDocumentoFiscalFechamento(db, nfceId, 'Justificativa valida com mais de quinze', {
      deps: { cancelarNfcePorId: async (id) => mockCancelOk(id), skipSnapshot: false, ignorarPrazoLocal: true }
    });
    assert.equal((await get(db, 'SELECT COUNT(*) AS c FROM vendas')).c, antes.v);
    assert.equal((await get(db, 'SELECT COUNT(*) AS c FROM vendas_itens')).c, antes.i);
    assert.equal((await get(db, 'SELECT COUNT(*) AS c FROM financeiro')).c, antes.f);
    assert.equal((await get(db, 'SELECT estoque FROM produtos WHERE id=1')).estoque, antes.e);
  });

  it('N — cancelamento utiliza Motor Fiscal existente', () => {
    assert.match(CANCEL_SRC, /cancelarNfcePorId/);
    assert.match(CANCEL_SRC, /enviarCancelamento/);
    assert.match(CANCEL_SRC, /tpEvento>110111/);
    assert.match(SVC, /cancelarNfcePorId/);
    assert.match(ROTA, /cancelarDocumentoFiscalFechamento/);
  });

  it('O/P/Q — retorno autorizado atualiza nfce + protocolo/cStat', async () => {
    await run(db, "UPDATE nfce_notas SET status='autorizada', xml_retorno='<ret><cStat>100</cStat></ret>' WHERE id=?", [nfceId]);
    await run(db, "UPDATE fechamentos_fiscais SET status='AUTORIZADO' WHERE id=4");
    const out = await cancelarDocumentoFiscalFechamento(db, nfceId, 'Justificativa valida com mais de quinze', {
      deps: { cancelarNfcePorId: async (id) => mockCancelOk(id), skipSnapshot: true, ignorarPrazoLocal: true }
    });
    const nota = await get(db, 'SELECT * FROM nfce_notas WHERE id=?', [nfceId]);
    assert.equal(nota.status, 'cancelada');
    assert.match(nota.xml_retorno, /PROT-CANC-TEST|protocoloCancelamento/);
    assert.match(nota.xml_retorno, /cStatEvento: 135|135/);
    assert.equal(out.protocoloCancelamento, 'PROT-CANC-TEST');
    assert.equal(out.dadosCancelamento.cStatEvento, '135');
  });

  it('R — auditoria registrada na rota', () => {
    assert.match(ROTA, /cancelar_nfce_fechamento/);
    assert.match(ROTA, /gravarAuditoria/);
  });

  it('S — fechamento atualizado somente após confirmação', async () => {
    assert.equal(STATUS.CANCELADO, 'CANCELADO');
    assert.equal(DOC_STATUS.CANCELADO, 'CANCELADO');
    assert.match(CONST_SRC, /CANCELADO: 'CANCELADO'/);
    const ff = await get(db, 'SELECT status FROM fechamentos_fiscais WHERE id=4');
    assert.equal(ff.status, 'CANCELADO');
    const doc = await get(db, 'SELECT status FROM fechamentos_fiscais_documentos WHERE id=2');
    assert.equal(doc.status, 'CANCELADO');
  });

  it('T — histórico da NFC-e permanece disponível', async () => {
    const nota = await get(db, 'SELECT id, xml_enviado FROM nfce_notas WHERE id=?', [nfceId]);
    assert.ok(nota);
    assert.ok(nota.xml_enviado);
  });

  it('U — segunda tentativa não gera segundo evento', async () => {
    let calls = 0;
    await cancelarDocumentoFiscalFechamento(db, nfceId, 'Justificativa valida com mais de quinze', {
      deps: { cancelarNfcePorId: async (id) => { calls += 1; return mockCancelOk(id); }, skipSnapshot: true, ignorarPrazoLocal: true }
    });
    assert.equal(calls, 0);
  });

  it('V — requisições concorrentes não geram dois cancelamentos', async () => {
    await run(db, "UPDATE nfce_notas SET status='autorizada' WHERE id=?", [nfceId]);
    await run(db, "UPDATE fechamentos_fiscais SET status='AUTORIZADO' WHERE id=4");
    let calls = 0;
    const slow = async (id) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 80));
      return mockCancelOk(id);
    };
    const p1 = cancelarDocumentoFiscalFechamento(db, nfceId, 'Justificativa valida com mais de quinze', {
      deps: { cancelarNfcePorId: slow, skipSnapshot: true, ignorarPrazoLocal: true }
    });
    await new Promise((r) => setTimeout(r, 10));
    const p2 = cancelarDocumentoFiscalFechamento(db, nfceId, 'Justificativa valida com mais de quinze', {
      deps: { cancelarNfcePorId: slow, skipSnapshot: true, ignorarPrazoLocal: true }
    });
    const results = await Promise.allSettled([p1, p2]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rej = results.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.equal(rej.length, 1);
    assert.match(String(rej[0].reason && rej[0].reason.message), /em andamento|já cancelada|autorizada/i);
    assert.equal(calls, 1);
  });

  it('W — NFC-e identificada como FF-000004', () => {
    assert.equal(formatarRotuloFechamento(4), 'FF-000004');
    assert.match(FRONT, /FF-\$\{String\(ff\)\.padStart\(6, '0'\)\}/);
  });

  it('X/Y/Z — número, chave e XML original inalterados', async () => {
    const nota = await get(db, 'SELECT numero, chave_acesso, xml_enviado FROM nfce_notas WHERE id=?', [nfceId]);
    assert.equal(Number(nota.numero), 51);
    assert.equal(nota.chave_acesso, CHAVE);
    assert.equal(nota.xml_enviado, XML_ORIG);
  });

  it('contrato — sem Cancelar venda requer venda no ramo fiscal FF', () => {
    assert.doesNotMatch(FRONT, /Cancelar venda requer venda comercial vinculada/);
    // mensagem genérica de exigir venda permanece para Resumo/Devolução, não para cancel doc fiscal
    assert.match(FRONT, /cancelarDocumentoFiscalNfce/);
  });
});
