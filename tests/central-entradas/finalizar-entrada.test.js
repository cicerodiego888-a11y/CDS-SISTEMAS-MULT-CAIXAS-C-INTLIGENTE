/**
 * Sprint — Finalizar Entrada (fluxo único Central → Compras)
 * Executar: node tests/central-entradas/finalizar-entrada.test.js
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
      if (error.stack) console.error(error.stack.split('\n').slice(0, 5).join('\n'));
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-finalizar-entrada-'));
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

function montarParse(chave, extras = {}) {
  return {
    chave_acesso: chave,
    fornecedor: 'Fornecedor Finalizar',
    numero: '1001',
    serie: '1',
    valor_total_nota: 150,
    valor_frete: 10,
    valor_desconto: 5,
    condicao_pagamento: 'prazo',
    forma_pagamento: '15',
    parcelas: 2,
    parcelas_detalhe: [
      { numero: 1, vencimento: '2026-10-01', valor: 75 },
      { numero: 2, vencimento: '2026-11-01', valor: 75 }
    ],
    itens: [
      {
        produto_nome: 'Produto A',
        quantidade: 2,
        unidade: 'UN',
        preco_unitario: 50,
        cfop: '5102',
        cst: '00',
        valor_pis: 1,
        valor_cofins: 2,
        valor_ipi: 0,
        fator_conversao: 1
      },
      {
        produto_nome: 'Produto B',
        quantidade: 1,
        unidade: 'CX',
        preco_unitario: 50,
        cfop: '5102',
        csosn: '102',
        fator_conversao: 12,
        unidade_estoque: 'UN'
      }
    ],
    ...extras
  };
}

async function main() {
  console.log('\n=== Finalizar Entrada — Central → Compras ===\n');

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

  let docSemPendencia;
  let docComRevisao;
  let docImportado;

  await test('Caso 1 — sem pendência: PRONTA → finalizar → EM_IMPORTACAO + payload', async () => {
    const chave = '35260112345678000199550010000070011000000001';
    docSemPendencia = await documentosRepository.inserir({
      chave,
      numero: '7001',
      serie: '1',
      fornecedor: 'Fornecedor A',
      valorTotal: 150,
      xml: '<nfe/>',
      origem: 'teste',
      status: DocumentoFiscalStatus.PRONTA_IMPORTACAO,
      parseJson: montarParse(chave)
    });

    const resultado = await bridge.finalizarEntrada(docSemPendencia.id, { usuarioId: 1 });
    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.proximaAcao, 'ABRIR_COMPRA');
    assert.ok(resultado.dadosCompra);
    assert.ok(Array.isArray(resultado.dadosCompra.itens));
    assert.strictEqual(resultado.dadosCompra.itens.length, 2);
    assert.ok(resultado.dadosCompra.parcelas_detalhe.length >= 1);
    assert.strictEqual(resultado.dadosCompra.itens[0].cfop, '5102');

    const atual = await documentosRepository.buscarPorId(docSemPendencia.id);
    assert.strictEqual(atual.status, DocumentoFiscalStatus.EM_IMPORTACAO);
  });

  await test('Caso 2 — com revisão: EM_REVISAO → decisões → finalizar → EM_IMPORTACAO', async () => {
    const chave = '35260112345678000199550010000070021000000002';
    docComRevisao = await documentosRepository.inserir({
      chave,
      numero: '7002',
      serie: '1',
      fornecedor: 'Fornecedor B',
      valorTotal: 150,
      xml: '<nfe/>',
      origem: 'teste',
      status: DocumentoFiscalStatus.EM_REVISAO,
      parseJson: montarParse(chave)
    });

    await revisaoService.obterOuCriarSessao(docComRevisao.id, { usuarioId: 1 });
    await revisaoService.salvarDecisao(docComRevisao.id, 0, {
      decisao: 'CONFIRMAR',
      produtoId: 101,
      usuarioId: 1
    });
    await revisaoService.salvarDecisao(docComRevisao.id, 1, {
      decisao: 'ASSOCIAR',
      produtoId: 202,
      usuarioId: 1
    });

    const resultado = await bridge.finalizarEntrada(docComRevisao.id, { usuarioId: 1 });
    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.proximaAcao, 'ABRIR_COMPRA');
    assert.ok(resultado.dadosCompra);

    const atual = await documentosRepository.buscarPorId(docComRevisao.id);
    assert.strictEqual(atual.status, DocumentoFiscalStatus.EM_IMPORTACAO);
    assert.ok(Array.isArray(atual.parseJson.itens));
    assert.strictEqual(atual.parseJson.itens.length, 2);
  });

  await test('Caso 3 — bloqueia finalizar com pendência crítica incompleta', async () => {
    const chave = '35260112345678000199550010000070031000000003';
    const doc = await documentosRepository.inserir({
      chave,
      numero: '7003',
      serie: '1',
      fornecedor: 'Fornecedor C',
      valorTotal: 50,
      xml: '<nfe/>',
      origem: 'teste',
      status: DocumentoFiscalStatus.EM_REVISAO,
      parseJson: montarParse(chave, {
        itens: [
          { produto_nome: 'X', quantidade: 1, preco_unitario: 25 },
          { produto_nome: 'Y', quantidade: 1, preco_unitario: 25 }
        ]
      })
    });

    await revisaoService.obterOuCriarSessao(doc.id, { usuarioId: 1 });
    await revisaoService.salvarDecisao(doc.id, 0, {
      decisao: 'CONFIRMAR',
      produtoId: 1,
      usuarioId: 1
    });

    let bloqueou = false;
    try {
      await bridge.finalizarEntrada(doc.id, { usuarioId: 1 });
    } catch (err) {
      bloqueou = true;
      assert.ok(/incompleta|pendência|Revisão/i.test(err.message));
      assert.strictEqual(err.statusCode, 400);
    }
    assert.strictEqual(bloqueou, true);

    const atual = await documentosRepository.buscarPorId(doc.id);
    assert.strictEqual(atual.status, DocumentoFiscalStatus.EM_REVISAO);
  });

  await test('Caso 4 — duplo clique / concorrente: uma única operação', async () => {
    const chave = '35260112345678000199550010000070041000000004';
    const doc = await documentosRepository.inserir({
      chave,
      numero: '7004',
      serie: '1',
      fornecedor: 'Fornecedor D',
      valorTotal: 150,
      xml: '<nfe/>',
      origem: 'teste',
      status: DocumentoFiscalStatus.PRONTA_IMPORTACAO,
      parseJson: montarParse(chave)
    });

    const [r1, r2] = await Promise.all([
      bridge.finalizarEntrada(doc.id, { usuarioId: 1 }),
      bridge.finalizarEntrada(doc.id, { usuarioId: 1 })
    ]);

    assert.strictEqual(r1.sucesso, true);
    assert.strictEqual(r2.sucesso, true);
    assert.strictEqual(r1.documentoId, r2.documentoId);

    const hist = await historicoRepository.listarPorDocumento(doc.id);
    const paraImportacao = hist.filter(
      (h) => h.statusNovo === DocumentoFiscalStatus.EM_IMPORTACAO
        || h.statusNovo === DocumentoFiscalStatus.EM_COMPRA
    );
    assert.ok(paraImportacao.length <= 1, `esperava no máximo 1 transição para EM_IMPORTACAO, obteve ${paraImportacao.length}`);
  });

  await test('Caso 5 — já EM_IMPORTACAO: retoma sem nova operação duplicada', async () => {
    const resultado = await bridge.finalizarEntrada(docSemPendencia.id, { usuarioId: 1 });
    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.proximaAcao, 'ABRIR_COMPRA');
    assert.strictEqual(resultado.retomada, true);
    assert.ok(resultado.dadosCompra);

    const atual = await documentosRepository.buscarPorId(docSemPendencia.id);
    assert.strictEqual(atual.status, DocumentoFiscalStatus.EM_IMPORTACAO);
  });

  await test('Caso 6 — já IMPORTADA: não cria segunda compra', async () => {
    const chave = '35260112345678000199550010000070061000000006';
    docImportado = await documentosRepository.inserir({
      chave,
      numero: '7006',
      serie: '1',
      fornecedor: 'Fornecedor F',
      valorTotal: 10,
      xml: '<nfe/>',
      origem: 'teste',
      status: DocumentoFiscalStatus.IMPORTADA,
      compraId: 999,
      parseJson: montarParse(chave)
    });

    let bloqueou = false;
    try {
      await bridge.finalizarEntrada(docImportado.id, { usuarioId: 1 });
    } catch (err) {
      bloqueou = true;
      assert.strictEqual(err.statusCode, 409);
      assert.strictEqual(err.codigo, 'DOCUMENTO_JA_IMPORTADO');
    }
    assert.strictEqual(bloqueou, true);
  });

  await test('Caso 7 — vínculo Central ↔ Compra confirmado', async () => {
    const vinculo = await bridge.vincularCompra(docSemPendencia.id, 555, { usuarioId: 1 });
    assert.strictEqual(vinculo.sucesso, true);
    assert.strictEqual(vinculo.compraId, 555);

    const atual = await documentosRepository.buscarPorId(docSemPendencia.id);
    assert.strictEqual(Number(atual.compraId), 555);
    assert.strictEqual(atual.status, DocumentoFiscalStatus.IMPORTADA);
  });

  await test('Caso 8 — vínculo idempotente + bloqueio de segunda compra', async () => {
    const idem = await bridge.vincularCompra(docSemPendencia.id, 555, { usuarioId: 1 });
    assert.strictEqual(idem.sucesso, true);
    assert.strictEqual(idem.idempotente, true);

    let bloqueou = false;
    try {
      await bridge.vincularCompra(docSemPendencia.id, 777, { usuarioId: 1 });
    } catch (err) {
      bloqueou = true;
      assert.strictEqual(err.statusCode, 409);
      assert.strictEqual(err.codigo, 'COMPRA_JA_VINCULADA');
    }
    assert.strictEqual(bloqueou, true);
  });

  await test('Caso 9/10/11/12 — payload preserva itens, parcelas, fiscal e conversão', async () => {
    const payload = await bridge.montarPayloadAbrirCompra(docComRevisao.id);
    assert.strictEqual(payload.sucesso, true);
    assert.strictEqual(payload.dadosCompra.itens.length, 2);
    assert.ok(payload.dadosCompra.parcelas_detalhe.length >= 2);
    assert.strictEqual(payload.dadosCompra.itens[0].cfop, '5102');
    assert.ok(
      payload.dadosCompra.itens[0].cst === '00'
      || payload.dadosCompra.itens[1].csosn === '102'
    );
    assert.strictEqual(Number(payload.dadosCompra.itens[1].fator_conversao), 12);
    assert.ok(Number(payload.dadosCompra.valor_frete) >= 0);
  });

  await test('Contrato frontend: Finalizar Entrada + finalizar-entrada', async () => {
    const root = path.join(__dirname, '../..');
    const central = fs.readFileSync(path.join(root, 'frontend/erp/js/central-entradas.js'), 'utf8');
    const miip = fs.readFileSync(path.join(root, 'frontend/erp/js/miip-central-revisao.js'), 'utf8');
    const rota = fs.readFileSync(path.join(root, 'backend/rotas/central-entradas.js'), 'utf8');

    assert.ok(central.includes('finalizarEntradaDesdeCentral'));
    assert.ok(central.includes('/finalizar-entrada'));
    assert.ok(central.includes('Finalizar Entrada'));
    assert.ok(central.includes('Retomar Importação'));
    assert.ok(miip.includes('miipCentralBtnFinalizarEntrada'));
    assert.ok(miip.includes('Finalizar Entrada'));
    assert.ok(rota.includes("router.post('/:id/finalizar-entrada'"));
  });

  await fecharDb(db);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  console.log(`\nResultado: ${passou} OK, ${falhou} FALHOU\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
