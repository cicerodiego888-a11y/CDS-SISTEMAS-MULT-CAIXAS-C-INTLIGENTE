/**
 * Revisão MIIP persistente / resumível — Central de Entradas
 * Executar: node tests/central-entradas/revisao-persistente.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const CentralDocumentosRepository = require('../../backend/motores/central-entradas/repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../../backend/motores/central-entradas/repositories/CentralHistoricoRepository');
const CentralRevisaoSessoesRepository = require('../../backend/motores/central-entradas/repositories/CentralRevisaoSessoesRepository');
const CentralRevisaoItensRepository = require('../../backend/motores/central-entradas/repositories/CentralRevisaoItensRepository');
const CentralRevisaoPersistenteService = require('../../backend/motores/central-entradas/services/CentralRevisaoPersistenteService');
const CentralComprasBridgeService = require('../../backend/motores/central-entradas/services/CentralComprasBridgeService');
const DocumentoTransitionService = require('../../backend/motores/central-entradas/services/DocumentoTransitionService');

let passou = 0;
let falhou = 0;
let tmpDir = null;

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
      if (error.stack) console.error(error.stack.split('\n').slice(0, 4).join('\n'));
    });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function cb(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

async function criarSchema(db) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS compras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo_entrada TEXT,
      tipo_entrada_sugerido TEXT,
      tipo_entrada_confianca REAL,
      tipo_entrada_motivo TEXT,
      tipo_entrada_alterado INTEGER
    )
  `);

  await run(db, `
    CREATE TABLE IF NOT EXISTS central_entradas_documentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chave TEXT NOT NULL UNIQUE,
      numero TEXT,
      serie TEXT,
      modelo TEXT DEFAULT '55',
      fornecedor TEXT,
      cnpj_fornecedor TEXT,
      data_emissao TEXT,
      data_entrada TEXT,
      valor_total REAL,
      xml TEXT,
      nsu TEXT,
      origem TEXT DEFAULT 'dfe',
      status TEXT NOT NULL,
      status_detalhe TEXT,
      tipo_documento TEXT,
      parse_json TEXT,
      miip_sessao_id TEXT,
      miip_resumo_json TEXT,
      compra_id INTEGER,
      usuario_id INTEGER,
      processado_em DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(db, `
    CREATE TABLE IF NOT EXISTS central_entradas_historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      documento_id INTEGER NOT NULL,
      status_anterior TEXT,
      status_novo TEXT NOT NULL,
      usuario_id INTEGER,
      detalhe TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(db, `
    CREATE TABLE IF NOT EXISTS central_entradas_revisao_sessoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      documento_id INTEGER NOT NULL,
      usuario_id INTEGER,
      status TEXT NOT NULL DEFAULT 'EM_ANDAMENTO',
      total_itens INTEGER NOT NULL DEFAULT 0,
      itens_concluidos INTEGER NOT NULL DEFAULT 0,
      item_atual INTEGER NOT NULL DEFAULT 0,
      correlation_id TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      concluido_em DATETIME
    )
  `);

  await run(db, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_central_revisao_sessao_doc_ativa
      ON central_entradas_revisao_sessoes(documento_id)
      WHERE status = 'EM_ANDAMENTO'
  `);

  await run(db, `
    CREATE TABLE IF NOT EXISTS central_entradas_revisao_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessao_id INTEGER NOT NULL,
      documento_id INTEGER NOT NULL,
      item_index INTEGER NOT NULL,
      produto_origem TEXT,
      produto_destino_id INTEGER,
      decisao TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CONCLUIDO',
      dados_json TEXT,
      usuario_id INTEGER,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(sessao_id, item_index)
    )
  `);
}

function abrirDbTemp() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-revisao-'));
  process.env.DB_DIR = tmpDir;
  const dbPath = path.join(tmpDir, 'mercadao.db');
  const db = new sqlite3.Database(dbPath);
  db.whenReady = (cb) => {
    if (typeof cb === 'function') cb(null);
  };
  db.isReady = () => true;
  return db;
}

function fecharDb(db) {
  return new Promise((resolve) => {
    db.close(() => resolve());
  });
}

async function main() {
  console.log('\n=== Revisão MIIP persistente — Central de Entradas ===\n');

  const db = abrirDbTemp();
  await criarSchema(db);

  const repoDeps = { db };
  const documentosRepository = new CentralDocumentosRepository(repoDeps);
  const historicoRepository = new CentralHistoricoRepository(repoDeps);
  const sessoesRepository = new CentralRevisaoSessoesRepository(repoDeps);
  const itensRepository = new CentralRevisaoItensRepository(repoDeps);
  const revisaoService = new CentralRevisaoPersistenteService({
    documentosRepository,
    sessoesRepository,
    itensRepository,
    db
  });
  const transitionService = new DocumentoTransitionService({
    documentosRepository,
    historicoRepository
  });
  const bridge = new CentralComprasBridgeService({
    documentosRepository,
    historicoRepository,
    transitionService,
    revisaoPersistenteService: revisaoService
  });

  const CHAVE = '35260112345678000199550010000009991000000099';

  const parseJson = {
    chave_acesso: CHAVE,
    itens: [
      { produto_nome: 'Item A', preco_unitario: 10 },
      { produto_nome: 'Item B', preco_unitario: 20 },
      { produto_nome: 'Item C', preco_unitario: 30 }
    ]
  };

  let documento;
  let sessaoId;

  await test('cria documento EM_REVISAO com 3 itens', async () => {
    documento = await documentosRepository.inserir({
      chave: CHAVE,
      numero: '9999',
      serie: '1',
      fornecedor: 'Fornecedor Revisao',
      cnpjFornecedor: '12345678000199',
      dataEmissao: '2026-08-13',
      valorTotal: 60,
      xml: '<nfe/>',
      origem: 'teste',
      status: DocumentoFiscalStatus.EM_REVISAO,
      parseJson
    });
    assert.ok(documento.id);
    assert.strictEqual(documento.status, DocumentoFiscalStatus.EM_REVISAO);
    assert.strictEqual(documento.parseJson.itens.length, 3);
  });

  await test('criar sessão de revisão', async () => {
    const resultado = await revisaoService.obterOuCriarSessao(documento.id, {
      usuarioId: 1,
      correlationId: 'corr-rev-1'
    });
    assert.strictEqual(resultado.sucesso, true);
    assert.ok(resultado.sessao?.id);
    assert.strictEqual(resultado.sessao.status, 'EM_ANDAMENTO');
    assert.strictEqual(resultado.progresso.total, 3);
    assert.strictEqual(resultado.progresso.concluidos, 0);
    assert.strictEqual(resultado.progresso.primeiroPendente, 0);
    sessaoId = resultado.sessao.id;
  });

  await test('salvar decisões itens 0 e 1 (idempotente no 0)', async () => {
    const d0a = await revisaoService.salvarDecisao(documento.id, 0, {
      decisao: 'confirmado',
      produtoId: 101,
      usuarioId: 1
    });
    assert.strictEqual(d0a.salvo, true);
    assert.strictEqual(d0a.item.decisao, 'CONFIRMAR');
    assert.strictEqual(d0a.progresso.concluidos, 1);

    const d0b = await revisaoService.salvarDecisao(documento.id, 0, {
      decisao: 'CONFIRMAR',
      produtoId: 101,
      usuarioId: 1
    });
    assert.strictEqual(d0b.progresso.concluidos, 1);
    assert.strictEqual(d0b.item.id, d0a.item.id);

    const d1 = await revisaoService.salvarDecisao(documento.id, 1, {
      decisao: 'ASSOCIAR',
      produtoId: 202,
      usuarioId: 1
    });
    assert.strictEqual(d1.progresso.concluidos, 2);
    assert.strictEqual(d1.progresso.primeiroPendente, 2);
    assert.strictEqual(d1.progresso.itemAtual, 2);
  });

  await test('sair e recuperar sessão mantém progresso', async () => {
    const recuperada = await revisaoService.obterOuCriarSessao(documento.id, {
      usuarioId: 1
    });
    assert.strictEqual(recuperada.recuperada, true);
    assert.strictEqual(recuperada.sessao.id, sessaoId);
    assert.strictEqual(recuperada.progresso.concluidos, 2);
    assert.strictEqual(recuperada.progresso.pendentes, 1);
    assert.strictEqual(recuperada.itens.length, 2);

    const obter = await revisaoService.obterSessao(documento.id);
    assert.strictEqual(obter.sessao.id, sessaoId);
    assert.strictEqual(obter.progresso.concluidos, 2);
  });

  await test('simula interrupção: item0 salvo, sessão permanece EM_ANDAMENTO', async () => {
    const parcial = await sessoesRepository.buscarAtivaPorDocumento(documento.id);
    assert.ok(parcial);
    assert.strictEqual(parcial.status, 'EM_ANDAMENTO');
    const item0 = await itensRepository.buscarPorSessaoEIndice(parcial.id, 0);
    assert.ok(item0);
    assert.strictEqual(item0.decisao, 'CONFIRMAR');
    const doc = await documentosRepository.buscarPorId(documento.id);
    assert.strictEqual(doc.status, DocumentoFiscalStatus.EM_REVISAO);
    assert.strictEqual(doc.parseJson.itens[0].miip_revisao_status, 'CONFIRMAR');
  });

  await test('concluir revisão → PRONTA_IMPORTACAO', async () => {
    await revisaoService.salvarDecisao(documento.id, 2, {
      decisao: 'IGNORAR',
      usuarioId: 1
    });

    const resultado = await bridge.concluirRevisao(documento.id, {
      usuarioId: 1,
      correlationId: 'corr-rev-1'
    });

    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(
      resultado.documento.status,
      DocumentoFiscalStatus.PRONTA_IMPORTACAO
    );

    const sessao = await sessoesRepository.buscarPorId(sessaoId);
    assert.strictEqual(sessao.status, 'CONCLUIDA');
    assert.strictEqual(await sessoesRepository.buscarAtivaPorDocumento(documento.id), null);
  });

  await test('concluir novamente é idempotente', async () => {
    const resultado = await bridge.concluirRevisao(documento.id, {
      usuarioId: 1,
      correlationId: 'corr-rev-2'
    });
    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.idempotente, true);
    assert.strictEqual(
      resultado.documento.status,
      DocumentoFiscalStatus.PRONTA_IMPORTACAO
    );

    const hist = await historicoRepository.listarPorDocumento(documento.id);
    const paraPronta = hist.filter(
      (h) => h.statusNovo === DocumentoFiscalStatus.PRONTA_IMPORTACAO
    );
    assert.strictEqual(paraPronta.length, 1);
  });

  await test('enriquecerDocumentosComProgresso em EM_REVISAO', async () => {
    const doc2 = await documentosRepository.inserir({
      chave: '35260112345678000199550010000008881000000088',
      numero: '8888',
      serie: '1',
      fornecedor: 'Outro',
      valorTotal: 10,
      xml: '<nfe/>',
      origem: 'teste',
      status: DocumentoFiscalStatus.EM_REVISAO,
      parseJson: {
        itens: [
          { produto_nome: 'X' },
          { produto_nome: 'Y' }
        ]
      }
    });

    const sessao = await revisaoService.obterOuCriarSessao(doc2.id, { usuarioId: 2 });
    await revisaoService.salvarDecisao(doc2.id, 0, { decisao: 'CADASTRAR', usuarioId: 2 });

    const lista = await revisaoService.enriquecerDocumentosComProgresso([
      { id: doc2.id, status: DocumentoFiscalStatus.EM_REVISAO },
      { id: documento.id, status: DocumentoFiscalStatus.PRONTA_IMPORTACAO }
    ]);

    assert.ok(lista[0].revisaoProgresso);
    assert.strictEqual(lista[0].revisaoProgresso.sessaoId, sessao.sessao.id);
    assert.strictEqual(lista[0].revisaoProgresso.concluidos, 1);
    assert.strictEqual(lista[0].revisaoProgresso.total, 2);
    assert.strictEqual(lista[0].revisaoProgresso.percentual, 50);
    assert.strictEqual(lista[1].revisaoProgresso, undefined);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  await fecharDb(db).catch(() => {});
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  delete process.env.DB_DIR;
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Erro fatal nos testes:', error);
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  process.exit(1);
});
