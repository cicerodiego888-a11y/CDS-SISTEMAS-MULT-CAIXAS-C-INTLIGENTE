/**
 * RC3.19 — Central Contábil: NFC-e do Fechamento Fiscal do Dia.
 *
 * Causa raiz: buscarNfceAutorizadas usava INNER JOIN vendas, eliminando
 * NFC-e consolidadas (venda_id = NULL) do Fechamento Fiscal do Dia.
 *
 * Executar: node --test tests/faturamento/rc319-central-contabil-fechamento-fiscal.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '../..');

const {
  buscarNfceAutorizadas,
  sincronizarHistoricoNfcePeriodo,
  extrairXmlNfceAutorizado,
  nomeArquivoNfce,
  gerarCsvVendasMisto,
  normalizarOpcoesExportacao
} = require('../../backend/services/fiscal/exportarContabilidadeService');

const {
  persistirNfceAutorizadaDoFechamento,
  sincronizarHistoricoNfceDoFechamento,
  ORIGEM_FECHAMENTO
} = require('../../backend/services/fechamento-fiscal/NfceHistoricoOficialService');

// ---------- helpers ----------
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
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}
function close(db) {
  return new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
}

const CHAVE_CONSOLIDADA = '23260968645756000121650010000000511873269476';
const CHAVE_CONVENCIONAL = '23260968645756000121650010000000521873269477';
const CHAVE_CANCELADA = '23260968645756000121650010000000531873269478';
const CHAVE_REJEITADA = '23260968645756000121650010000000541873269479';

const XML_AUTORIZADO_NFPROC = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
<NFe><infNFe Id="NFe23260968645756000121650010000000511873269476"><ide><cUF>23</cUF></ide></infNFe></NFe>
<protNFe><infProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo><nProt>123260816956854</nProt></infProt></protNFe>
</nfeProc>`;

const XML_ENVIADO = `<?xml version="1.0" encoding="UTF-8"?>
<NFe><infNFe Id="NFe23260968645756000121650010000000511873269476"><ide><cUF>23</cUF></ide></infNFe></NFe>`;

async function schemaBase(db) {
  await run(db, `CREATE TABLE vendas (
    id INTEGER PRIMARY KEY, codigo TEXT, data_venda TEXT, total REAL,
    forma_pagamento TEXT, status TEXT, cliente_id INTEGER
  )`);
  await run(db, `CREATE TABLE clientes (
    id INTEGER PRIMARY KEY, nome TEXT, cpf_cnpj TEXT
  )`);
  await run(db, `CREATE TABLE nfce_notas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER,
    numero INTEGER NOT NULL,
    serie INTEGER NOT NULL,
    chave_acesso TEXT,
    ambiente INTEGER DEFAULT 2,
    status TEXT DEFAULT 'pendente',
    xml_enviado TEXT,
    xml_retorno TEXT,
    protocolo TEXT,
    recibo TEXT,
    qr_code_url TEXT,
    danfe_html TEXT,
    fechamento_fiscal_id INTEGER,
    fechamento_documento_id INTEGER,
    origem TEXT DEFAULT 'venda',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(db, `CREATE TABLE fechamentos_fiscais (
    id INTEGER PRIMARY KEY, data_fechamento TEXT, status TEXT,
    valor_informado REAL, valor_distribuido REAL
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
    recibo TEXT,
    xml_enviado TEXT,
    xml_assinado TEXT,
    xml_retorno TEXT,
    xml_autorizado TEXT,
    valor_total REAL,
    data_hora_emissao TEXT,
    data_hora_autorizacao TEXT,
    criado_em TEXT
  )`);
  await run(db, `CREATE TABLE fechamentos_fiscais_documentos_itens (
    id INTEGER PRIMARY KEY, documento_id INTEGER, produto_id INTEGER,
    descricao TEXT, quantidade REAL, valor_unitario REAL, valor_total REAL, unidade TEXT
  )`);
  await run(db, `CREATE TABLE fechamentos_fiscais_documentos_pagamentos (
    id INTEGER PRIMARY KEY, documento_id INTEGER, forma_pagamento TEXT, valor REAL, operadora TEXT
  )`);
}

describe('RC3.19 — Cenário 1: NFC-e consolidada (venda_id NULL)', () => {
  let db;

  before(async () => {
    db = openMem();
    await schemaBase(db);
    await run(db, `INSERT INTO fechamentos_fiscais (id, data_fechamento, status, valor_informado, valor_distribuido)
      VALUES (1, '2026-10-01', 'AUTORIZADO', 150.00, 150.00)`);
    await run(db, `INSERT INTO fechamentos_fiscais_documentos (
      id, fechamento_fiscal_id, status, numero, serie, ambiente, chave_acesso, protocolo,
      cstat, xmotivo, xml_enviado, xml_retorno, valor_total,
      data_hora_emissao, data_hora_autorizacao, criado_em
    ) VALUES (
      10, 1, 'AUTORIZADO', 51, '1', 1, ?, '123260816956854',
      '100', 'Autorizado o uso da NF-e', ?, ?, 150.00,
      '2026-10-01 14:30:00', '2026-10-01 14:30:05', '2026-10-01 14:00:00'
    )`, [CHAVE_CONSOLIDADA, XML_ENVIADO, XML_AUTORIZADO_NFPROC]);

    // Persiste no histórico oficial (como a transmissão faria)
    await persistirNfceAutorizadaDoFechamento(db, {
      id: 10,
      fechamento_fiscal_id: 1,
      status: 'AUTORIZADO',
      numero: 51,
      serie: '1',
      ambiente: 1,
      chave_acesso: CHAVE_CONSOLIDADA,
      protocolo: '123260816956854',
      xml_enviado: XML_ENVIADO,
      xml_retorno: XML_AUTORIZADO_NFPROC
    }, { fechamentoId: 1 });
  });

  after(async () => { await close(db); });

  it('NFC-e consolidada com venda_id NULL é retornada pela consulta', async () => {
    const notas = await buscarNfceAutorizadas('2026-10-01', '2026-10-01', db);
    assert.equal(notas.length, 1);
    assert.equal(notas[0].venda_id, null);
    assert.equal(notas[0].chave_acesso, CHAVE_CONSOLIDADA);
    assert.equal(notas[0].origem, ORIGEM_FECHAMENTO);
    assert.equal(Number(notas[0].numero), 51);
  });

  it('valor da NFC-e consolidada vem de fechamentos_fiscais_documentos.valor_total', async () => {
    const notas = await buscarNfceAutorizadas('2026-10-01', '2026-10-01', db);
    assert.equal(Number(notas[0].venda_total), 150.00);
    assert.equal(Number(notas[0].fechamento_valor_total), 150.00);
  });

  it('data fiscal da NFC-e consolidada vem de data_hora_autorizacao', async () => {
    const notas = await buscarNfceAutorizadas('2026-10-01', '2026-10-01', db);
    assert.ok(String(notas[0].data_fiscal).startsWith('2026-10-01'));
    assert.equal(notas[0].fechamento_data_autorizacao, '2026-10-01 14:30:05');
  });

  it('XML autorizado é extraído corretamente (nfeProc do retorno)', () => {
    const xml = extrairXmlNfceAutorizado({
      xml_enviado: XML_ENVIADO,
      xml_retorno: XML_AUTORIZADO_NFPROC
    });
    assert.ok(xml);
    assert.ok(xml.includes('<nfeProc'));
    assert.ok(xml.includes('<cStat>100</cStat>'));
  });

  it('nome do arquivo usa a chave de acesso de 44 dígitos', () => {
    const nome = nomeArquivoNfce({ chave_acesso: CHAVE_CONSOLIDADA, numero: 51, serie: 1 });
    assert.equal(nome, `${CHAVE_CONSOLIDADA}.xml`);
  });
});

describe('RC3.19 — Cenário 2: NFC-e convencional (venda vinculada)', () => {
  let db;

  before(async () => {
    db = openMem();
    await schemaBase(db);
    await run(db, `INSERT INTO clientes (id, nome, cpf_cnpj) VALUES (1, 'Cliente Teste', '12345678901')`);
    await run(db, `INSERT INTO vendas (id, codigo, data_venda, total, forma_pagamento, status, cliente_id)
      VALUES (1, 'V001', '2026-10-02 10:00:00', 89.90, 'dinheiro', 'finalizada', 1)`);
    await run(db, `INSERT INTO nfce_notas (
      venda_id, numero, serie, chave_acesso, ambiente, status, xml_enviado, xml_retorno,
      protocolo, created_at
    ) VALUES (
      1, 100, 1, ?, 1, 'autorizada', ?, ?, '123260816956999', '2026-10-02 10:00:00'
    )`, [CHAVE_CONVENCIONAL, XML_ENVIADO, XML_AUTORIZADO_NFPROC]);
  });

  after(async () => { await close(db); });

  it('NFC-e convencional com venda vinculada continua sendo retornada', async () => {
    const notas = await buscarNfceAutorizadas('2026-10-02', '2026-10-02', db);
    assert.equal(notas.length, 1);
    assert.equal(Number(notas[0].venda_id), 1);
    assert.equal(notas[0].chave_acesso, CHAVE_CONVENCIONAL);
    assert.equal(notas[0].cliente_nome, 'Cliente Teste');
    assert.equal(Number(notas[0].venda_total), 89.90);
  });

  it('data fiscal da NFC-e convencional usa v.data_venda', async () => {
    const notas = await buscarNfceAutorizadas('2026-10-02', '2026-10-02', db);
    assert.ok(String(notas[0].data_fiscal).startsWith('2026-10-02'));
  });
});

describe('RC3.19 — Cenário 3: NFC-e cancelada', () => {
  let db;

  before(async () => {
    db = openMem();
    await schemaBase(db);
    await run(db, `INSERT INTO vendas (id, codigo, data_venda, total, status)
      VALUES (1, 'V001', '2026-10-03 10:00:00', 50.00, 'cancelada')`);
    await run(db, `INSERT INTO nfce_notas (
      venda_id, numero, serie, chave_acesso, ambiente, status, xml_retorno, created_at
    ) VALUES (1, 200, 1, ?, 1, 'cancelada', ?, '2026-10-03 10:00:00')`,
      [CHAVE_CANCELADA, XML_AUTORIZADO_NFPROC]);
  });

  after(async () => { await close(db); });

  it('NFC-e cancelada NÃO é incluída como autorizada', async () => {
    const notas = await buscarNfceAutorizadas('2026-10-03', '2026-10-03', db);
    assert.equal(notas.length, 0);
  });
});

describe('RC3.19 — Cenário 4: NFC-e rejeitada', () => {
  let db;

  before(async () => {
    db = openMem();
    await schemaBase(db);
    await run(db, `INSERT INTO vendas (id, codigo, data_venda, total, status)
      VALUES (1, 'V001', '2026-10-04 10:00:00', 30.00, 'finalizada')`);
    await run(db, `INSERT INTO nfce_notas (
      venda_id, numero, serie, chave_acesso, ambiente, status, xml_retorno, created_at
    ) VALUES (1, 300, 1, ?, 1, 'rejeitada', '<ret><cStat>442</cStat></ret>', '2026-10-04 10:00:00')`,
      [CHAVE_REJEITADA]);
  });

  after(async () => { await close(db); });

  it('NFC-e rejeitada NÃO é incluída como autorizada', async () => {
    const notas = await buscarNfceAutorizadas('2026-10-04', '2026-10-04', db);
    assert.equal(notas.length, 0);
  });
});

describe('RC3.19 — Cenário 5: XML ausente gera pendência', () => {
  let db;

  before(async () => {
    db = openMem();
    await schemaBase(db);
    await run(db, `INSERT INTO vendas (id, codigo, data_venda, total, status)
      VALUES (1, 'V001', '2026-10-05 10:00:00', 25.00, 'finalizada')`);
    await run(db, `INSERT INTO nfce_notas (
      venda_id, numero, serie, chave_acesso, ambiente, status, xml_enviado, xml_retorno, created_at
    ) VALUES (1, 400, 1, ?, 1, 'autorizada', NULL, NULL, '2026-10-05 10:00:00')`,
      ['23260968645756000121650010000000551873269480']);
  });

  after(async () => { await close(db); });

  it('extrairXmlNfceAutorizado retorna null quando não há XML', () => {
    const xml = extrairXmlNfceAutorizado({ xml_enviado: null, xml_retorno: null });
    assert.equal(xml, null);
  });

  it('nota sem XML é retornada pela consulta (mas sem XML para exportar)', async () => {
    const notas = await buscarNfceAutorizadas('2026-10-05', '2026-10-05', db);
    assert.equal(notas.length, 1);
    // O XML ausente é tratado na etapa de exportação (xmlAusentes)
  });
});

describe('RC3.19 — Cenário 6: Período (limites inclusivos e exclusão fora do intervalo)', () => {
  let db;

  before(async () => {
    db = openMem();
    await schemaBase(db);
    await run(db, `INSERT INTO vendas (id, codigo, data_venda, total, status)
      VALUES (1, 'V001', '2026-10-10 10:00:00', 10.00, 'finalizada')`);
    await run(db, `INSERT INTO vendas (id, codigo, data_venda, total, status)
      VALUES (2, 'V002', '2026-10-15 10:00:00', 20.00, 'finalizada')`);
    await run(db, `INSERT INTO vendas (id, codigo, data_venda, total, status)
      VALUES (3, 'V003', '2026-10-20 10:00:00', 30.00, 'finalizada')`);
    await run(db, `INSERT INTO nfce_notas (venda_id, numero, serie, ambiente, status, xml_retorno, created_at)
      VALUES (1, 1, 1, 1, 'autorizada', ?, '2026-10-10 10:00:00')`, [XML_AUTORIZADO_NFPROC]);
    await run(db, `INSERT INTO nfce_notas (venda_id, numero, serie, ambiente, status, xml_retorno, created_at)
      VALUES (2, 2, 1, 1, 'autorizada', ?, '2026-10-15 10:00:00')`, [XML_AUTORIZADO_NFPROC]);
    await run(db, `INSERT INTO nfce_notas (venda_id, numero, serie, ambiente, status, xml_retorno, created_at)
      VALUES (3, 3, 1, 1, 'autorizada', ?, '2026-10-20 10:00:00')`, [XML_AUTORIZADO_NFPROC]);
  });

  after(async () => { await close(db); });

  it('inclui documento exatamente na data inicial', async () => {
    const notas = await buscarNfceAutorizadas('2026-10-10', '2026-10-10', db);
    assert.equal(notas.length, 1);
    assert.equal(Number(notas[0].venda_id), 1);
  });

  it('inclui documento exatamente na data final', async () => {
    const notas = await buscarNfceAutorizadas('2026-10-20', '2026-10-20', db);
    assert.equal(notas.length, 1);
    assert.equal(Number(notas[0].venda_id), 3);
  });

  it('exclui documentos fora do intervalo', async () => {
    const notas = await buscarNfceAutorizadas('2026-10-12', '2026-10-18', db);
    assert.equal(notas.length, 1);
    assert.equal(Number(notas[0].venda_id), 2);
  });

  it('inclui todos os documentos dentro do intervalo', async () => {
    const notas = await buscarNfceAutorizadas('2026-10-01', '2026-10-31', db);
    assert.equal(notas.length, 3);
  });
});

describe('RC3.19 — Cenário 7: Idempotência da sincronização', () => {
  let db;

  before(async () => {
    db = openMem();
    await schemaBase(db);
    await run(db, `INSERT INTO fechamentos_fiscais (id, data_fechamento, status, valor_informado, valor_distribuido)
      VALUES (1, '2026-10-01', 'AUTORIZADO', 200.00, 200.00)`);
    await run(db, `INSERT INTO fechamentos_fiscais_documentos (
      id, fechamento_fiscal_id, status, numero, serie, ambiente, chave_acesso, protocolo,
      cstat, xmotivo, xml_enviado, xml_retorno, valor_total,
      data_hora_emissao, data_hora_autorizacao, criado_em
    ) VALUES (
      10, 1, 'AUTORIZADO', 77, '1', 1, ?, '123260816956854',
      '100', 'Autorizado', ?, ?, 200.00,
      '2026-10-01 14:30:00', '2026-10-01 14:30:05', '2026-10-01 14:00:00'
    )`, [CHAVE_CONSOLIDADA, XML_ENVIADO, XML_AUTORIZADO_NFPROC]);
  });

  after(async () => { await close(db); });

  it('sincronizar duas vezes não duplica registros em nfce_notas', async () => {
    await sincronizarHistoricoNfceDoFechamento(db, 1);
    const antes = await get(db, `SELECT COUNT(*) AS c FROM nfce_notas WHERE chave_acesso = ?`, [CHAVE_CONSOLIDADA]);
    assert.equal(antes.c, 1);

    await sincronizarHistoricoNfceDoFechamento(db, 1);
    const depois = await get(db, `SELECT COUNT(*) AS c FROM nfce_notas WHERE chave_acesso = ?`, [CHAVE_CONSOLIDADA]);
    assert.equal(depois.c, 1);
  });

  it('sincronizarHistoricoNfcePeriodo é idempotente', async () => {
    const r1 = await sincronizarHistoricoNfcePeriodo('2026-10-01', '2026-10-01', db);
    assert.equal(r1.sincronizados, 1);
    const c1 = await get(db, `SELECT COUNT(*) AS c FROM nfce_notas WHERE chave_acesso = ?`, [CHAVE_CONSOLIDADA]);

    const r2 = await sincronizarHistoricoNfcePeriodo('2026-10-01', '2026-10-01', db);
    assert.equal(r2.sincronizados, 1);
    const c2 = await get(db, `SELECT COUNT(*) AS c FROM nfce_notas WHERE chave_acesso = ?`, [CHAVE_CONSOLIDADA]);

    assert.equal(c1.c, c2.c);
    assert.equal(c2.c, 1);
  });
});

describe('RC3.19 — Cenário 8: Compatibilidade (NF-e, entradas, CSV, manifesto, rota)', () => {
  it('buscarNfceAutorizadas não altera a consulta de NF-e (LEFT JOIN vendas)', () => {
    const svc = fs.readFileSync(
      path.join(ROOT, 'backend/services/fiscal/exportarContabilidadeService.js'),
      'utf8'
    );
    // NF-e continua com LEFT JOIN
    assert.match(svc, /FROM nfe_notas n\s+LEFT JOIN vendas/);
    // NFC-e agora usa LEFT JOIN
    assert.match(svc, /FROM nfce_notas n\s+LEFT JOIN vendas/);
    assert.doesNotMatch(svc, /FROM nfce_notas n\s+INNER JOIN vendas/);
  });

  it('rota POST /exportar-contabilidade preservada', () => {
    const rota = fs.readFileSync(path.join(ROOT, 'backend/rotas/fiscal.js'), 'utf8');
    assert.match(rota, /router\.post\('\/exportar-contabilidade'/);
  });

  it('opções de exportação retrocompatíveis', () => {
    const o = normalizarOpcoesExportacao({});
    assert.equal(o.incluirNfce, true);
    assert.equal(o.incluirNfe, true);
    assert.equal(o.incluirEntradas, true);
    assert.equal(o.incluirRelatorios, true);
    assert.equal(o.incluirManifesto, true);
  });

  it('CSV de vendas misto (NFC-e + NF-e) preservado', () => {
    const csv = gerarCsvVendasMisto(
      [{ data_fiscal: '2026-10-01', numero: 51, cliente_nome: 'Consumidor', venda_total: 150, status: 'autorizada' }],
      [{ data_venda: '2026-10-01', numero: 1, cliente_nome: 'Empresa', venda_total: 1000, status: 'autorizada' }]
    );
    assert.match(csv, /NFC-e/);
    assert.match(csv, /NF-e/);
    assert.match(csv, /150,00/);
    assert.match(csv, /1000,00/);
  });

  it('frontend central-contabil consome quantidadeNfce/Nfe (retrocompatível)', () => {
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/central-contabil.js'), 'utf8');
    assert.match(ui, /quantidadeNfce/);
    assert.match(ui, /quantidadeNfe/);
  });
});

describe('RC3.19 — Cenário 9: Recuperação histórica', () => {
  let db;

  before(async () => {
    db = openMem();
    await schemaBase(db);
    // Documento autorizado no fechamento, mas AUSENTE em nfce_notas
    await run(db, `INSERT INTO fechamentos_fiscais (id, data_fechamento, status, valor_informado, valor_distribuido)
      VALUES (1, '2026-10-01', 'AUTORIZADO', 300.00, 300.00)`);
    await run(db, `INSERT INTO fechamentos_fiscais_documentos (
      id, fechamento_fiscal_id, status, numero, serie, ambiente, chave_acesso, protocolo,
      cstat, xmotivo, xml_enviado, xml_retorno, valor_total,
      data_hora_emissao, data_hora_autorizacao, criado_em
    ) VALUES (
      10, 1, 'AUTORIZADO', 88, '1', 1, ?, '123260816956854',
      '100', 'Autorizado', ?, ?, 300.00,
      '2026-10-01 14:30:00', '2026-10-01 14:30:05', '2026-10-01 14:00:00'
    )`, [CHAVE_CONSOLIDADA, XML_ENVIADO, XML_AUTORIZADO_NFPROC]);
  });

  after(async () => { await close(db); });

  it('documento autorizado ausente em nfce_notas é recuperado sem transmissão', async () => {
    const antes = await get(db, `SELECT COUNT(*) AS c FROM nfce_notas WHERE chave_acesso = ?`, [CHAVE_CONSOLIDADA]);
    assert.equal(antes.c, 0);

    const r = await sincronizarHistoricoNfcePeriodo('2026-10-01', '2026-10-01', db);
    assert.equal(r.sincronizados, 1);

    const nota = await get(db, `SELECT * FROM nfce_notas WHERE chave_acesso = ?`, [CHAVE_CONSOLIDADA]);
    assert.ok(nota);
    assert.equal(nota.status, 'autorizada');
    assert.equal(nota.venda_id, null);
    assert.equal(nota.origem, ORIGEM_FECHAMENTO);
    assert.equal(Number(nota.fechamento_fiscal_id), 1);
    assert.equal(Number(nota.fechamento_documento_id), 10);
  });

  it('após recuperação, a NFC-e consolidada aparece na consulta contábil', async () => {
    await sincronizarHistoricoNfcePeriodo('2026-10-01', '2026-10-01', db);
    const notas = await buscarNfceAutorizadas('2026-10-01', '2026-10-01', db);
    assert.equal(notas.length, 1);
    assert.equal(notas[0].chave_acesso, CHAVE_CONSOLIDADA);
    assert.equal(notas[0].venda_id, null);
    assert.equal(Number(notas[0].venda_total), 300.00);
  });
});

describe('RC3.19 — Cenário 10: Regressão (rc318)', () => {
  it('serviço não cria novo exportador (centralContabilService não existe)', () => {
    assert.ok(
      !fs.existsSync(path.join(ROOT, 'backend/services/fiscal/centralContabilService.js'))
    );
  });

  it('não altera emissores / motores fiscais', () => {
    const nfce = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/emissor.js'), 'utf8');
    assert.doesNotMatch(nfce, /central-contabil|exportarContabilidade/);
  });

  it('INNER JOIN foi removido da consulta de NFC-e', () => {
    const svc = fs.readFileSync(
      path.join(ROOT, 'backend/services/fiscal/exportarContabilidadeService.js'),
      'utf8'
    );
    // Garante que não há INNER JOIN na consulta de NFC-e
    const nfceSection = svc.slice(
      svc.indexOf('async function buscarNfceAutorizadas'),
      svc.indexOf('async function sincronizarHistoricoNfcePeriodo')
    );
    assert.doesNotMatch(nfceSection, /INNER JOIN vendas/);
    assert.match(nfceSection, /LEFT JOIN vendas/);
    assert.match(nfceSection, /LEFT JOIN fechamentos_fiscais_documentos/);
  });
});
