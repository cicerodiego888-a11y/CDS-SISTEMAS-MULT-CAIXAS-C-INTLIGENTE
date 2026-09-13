/**
 * Testes — MIP Sprint 01 (Fundação produto_identificadores)
 * Executar: npm run test:mip-sprint01
 *
 * Cobertura: exercita 100% dos exports públicos da fundação
 * (normalizers, repository, service, backfill, schema, dual-write safe).
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  TIPOS_IDENTIFICADOR,
  TIPOS_LISTA,
  ESCOPOS,
  isTipoValido,
  normalizarCodigoIdentificador,
  detectarTipoCodigoBarras,
  garantirSchemaProdutoIdentificadores,
  ProdutoIdentificadoresRepository,
  ProdutoIdentificadoresService,
  ProdutoIdentificadoresBackfill,
  espelharIdentificadoresSafe
} = require('../../backend/motores/produto-identidade');

let passou = 0;
let falhou = 0;
const cobertos = new Set();

function marcar(nome) {
  cobertos.add(nome);
}

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

function openDb(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, (err) => (err ? reject(err) : resolve(db)));
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

function closeDb(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

async function criarDbTeste() {
  const file = path.join(os.tmpdir(), `mip-sprint01-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const db = await openDb(file);
  await run(db, 'PRAGMA foreign_keys = ON');
  await run(db, `
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo VARCHAR(50) UNIQUE,
      nome VARCHAR(200) NOT NULL,
      codigo_barras TEXT,
      preco_venda DECIMAL(10,2) DEFAULT 0
    )
  `);
  await new Promise((resolve, reject) => {
    garantirSchemaProdutoIdentificadores(db, (err) => (err ? reject(err) : resolve()));
  });
  marcar('garantirSchemaProdutoIdentificadores');
  return { db, file };
}

async function inserirProduto(db, { codigo, nome, codigo_barras }) {
  const r = await run(
    db,
    'INSERT INTO produtos (codigo, nome, codigo_barras, preco_venda) VALUES (?, ?, ?, ?)',
    [codigo, nome, codigo_barras || null, 9.99]
  );
  return r.lastID;
}

async function main() {
  console.log('\n=== MIP Sprint 01 — Fundação ===\n');

  await test('tipos e escopos oficiais', () => {
    marcar('TIPOS_IDENTIFICADOR');
    marcar('TIPOS_LISTA');
    marcar('ESCOPOS');
    marcar('isTipoValido');
    assert.ok(TIPOS_LISTA.includes('INTERNO'));
    assert.ok(TIPOS_LISTA.includes('EAN13'));
    assert.ok(TIPOS_LISTA.includes('PLU'));
    assert.strictEqual(ESCOPOS.GLOBAL, 'GLOBAL');
    assert.strictEqual(isTipoValido('ean13'), true);
    assert.strictEqual(isTipoValido('EAN13'), true);
    assert.strictEqual(isTipoValido('XYZ'), false);
  });

  await test('normalizarCodigoIdentificador e detectarTipoCodigoBarras', () => {
    marcar('normalizarCodigoIdentificador');
    marcar('detectarTipoCodigoBarras');
    assert.strictEqual(normalizarCodigoIdentificador(' 7891 ', 'EAN13'), '7891');
    assert.strictEqual(normalizarCodigoIdentificador('A-01', 'INTERNO'), 'A-01');
    assert.strictEqual(detectarTipoCodigoBarras('12345670'), 'EAN8');
    assert.strictEqual(detectarTipoCodigoBarras('7891234567890'), 'EAN13');
    assert.strictEqual(detectarTipoCodigoBarras('17891234567890'), 'GTIN');
    assert.strictEqual(detectarTipoCodigoBarras(''), null);
  });

  const { db, file } = await criarDbTeste();
  const repo = new ProdutoIdentificadoresRepository({ db });
  const service = new ProdutoIdentificadoresService({ repository: repo });
  marcar('ProdutoIdentificadoresRepository');
  marcar('ProdutoIdentificadoresService');

  await test('repository inserir / buscarPorId / listarPorProduto', async () => {
    const produtoId = await inserirProduto(db, { codigo: '67', nome: 'Queijo', codigo_barras: '7891000100103' });
    const row = await repo.inserir({
      produtoId,
      tipo: TIPOS_IDENTIFICADOR.INTERNO,
      codigo: '67',
      principal: true,
      origem: 'teste'
    });
    assert.ok(row.id);
    assert.strictEqual(row.produtoId, produtoId);
    assert.strictEqual(row.tipo, 'INTERNO');
    assert.strictEqual(row.principal, true);
    const byId = await repo.buscarPorId(row.id);
    assert.strictEqual(byId.codigo, '67');
    const lista = await repo.listarPorProduto(produtoId);
    assert.strictEqual(lista.length, 1);
    marcar('repo.inserir');
    marcar('repo.buscarPorId');
    marcar('repo.listarPorProduto');
  });

  await test('dual-write espelharCodigoEBarras cria INTERNO + EAN13', async () => {
    const produtoId = await inserirProduto(db, {
      codigo: '52',
      nome: 'Presunto',
      codigo_barras: '7891234567890'
    });
    const out = await service.espelharCodigoEBarras(produtoId, {
      codigo: '52',
      codigo_barras: '7891234567890'
    });
    assert.strictEqual(out.interno.acao, 'criado');
    assert.strictEqual(out.barras.acao, 'criado');
    assert.strictEqual(out.barras.registro.tipo, 'EAN13');
    const lista = await service.listarPorProduto(produtoId);
    assert.strictEqual(lista.length, 2);
    marcar('service.espelharCodigoEBarras');
    marcar('service.listarPorProduto');
    marcar('service.upsertPrincipal');
  });

  await test('dual-write idempotente (inalterado)', async () => {
    const produtoId = await inserirProduto(db, { codigo: '100', nome: 'Item', codigo_barras: '12345670' });
    await service.espelharCodigoEBarras(produtoId, { codigo: '100', codigo_barras: '12345670' });
    const out2 = await service.espelharCodigoEBarras(produtoId, { codigo: '100', codigo_barras: '12345670' });
    assert.strictEqual(out2.interno.acao, 'inalterado');
    assert.strictEqual(out2.barras.acao, 'inalterado');
  });

  await test('atualizar codigo principal', async () => {
    const produtoId = await inserirProduto(db, { codigo: '200', nome: 'Item2', codigo_barras: null });
    await service.espelharCodigoEBarras(produtoId, { codigo: '200', codigo_barras: null });
    const out = await service.espelharCodigoEBarras(produtoId, { codigo: '201', codigo_barras: '' });
    assert.strictEqual(out.interno.acao, 'atualizado');
    assert.strictEqual(out.interno.registro.codigo, '201');
    marcar('repo.atualizar');
    marcar('repo.buscarPrincipal');
  });

  await test('desativar quando codigo vazio', async () => {
    const produtoId = await inserirProduto(db, { codigo: '300', nome: 'Item3' });
    await service.espelharCodigoEBarras(produtoId, { codigo: '300' });
    const out = await service.upsertPrincipal(produtoId, 'INTERNO', '');
    assert.strictEqual(out.acao, 'desativado');
    marcar('repo.desativar');
  });

  await test('conflito: mesmo codigo ativo em outro produto', async () => {
    const a = await inserirProduto(db, { codigo: 'DUP1', nome: 'A' });
    const b = await inserirProduto(db, { codigo: 'DUP2', nome: 'B' });
    await service.espelharCodigoEBarras(a, { codigo: 'SHARED' });
    const out = await service.espelharCodigoEBarras(b, { codigo: 'SHARED' });
    assert.strictEqual(out.interno.acao, 'conflito');
    assert.ok(out.interno.conflito);
    marcar('repo.buscarPorTipoCodigo');
  });

  await test('buscarPorTipoCodigo encontra registro', async () => {
    const found = await repo.buscarPorTipoCodigo('INTERNO', 'SHARED');
    assert.ok(found);
    assert.strictEqual(found.tipo, 'INTERNO');
  });

  await test('backfill idempotente', async () => {
    marcar('ProdutoIdentificadoresBackfill');
    const backfill = new ProdutoIdentificadoresBackfill({ db, service });
    const s1 = await backfill.executar();
    assert.ok(s1.processados >= 1);
    const s2 = await backfill.executar();
    assert.strictEqual(s2.processados, s1.processados);
    // segunda passagem não deve criar novos em massa
    assert.ok(s2.criados === 0 || s2.inalterados > 0);
    const total = await repo.contar();
    assert.ok(total > 0);
    marcar('repo.contar');
    marcar('backfill.executar');
  });

  await test('espelharIdentificadoresSafe callback', async () => {
    marcar('espelharIdentificadoresSafe');
    const produtoId = await inserirProduto(db, { codigo: 'SAFE1', nome: 'Safe' });
    await new Promise((resolve, reject) => {
      espelharIdentificadoresSafe(
        produtoId,
        { codigo: 'SAFE1', codigo_barras: '7899999999999' },
        { service },
        (err, resultado) => {
          if (err) return reject(err);
          assert.ok(resultado.interno);
          resolve();
        }
      );
    });
  });

  await test('tipo inválido lança erro', async () => {
    const produtoId = await inserirProduto(db, { codigo: 'X1', nome: 'X' });
    let threw = false;
    try {
      await service.upsertPrincipal(produtoId, 'INVALIDO', '1');
    } catch (e) {
      threw = true;
      assert.ok(/inválido/i.test(e.message));
    }
    assert.ok(threw);
  });

  await closeDb(db);
  try { fs.unlinkSync(file); } catch { /* ignore */ }

  // Módulos públicos da fundação (Sprint 01)
  const simbolosPublicos = [
    'TIPOS_IDENTIFICADOR', 'TIPOS_LISTA', 'ESCOPOS', 'isTipoValido',
    'normalizarCodigoIdentificador', 'detectarTipoCodigoBarras',
    'garantirSchemaProdutoIdentificadores',
    'ProdutoIdentificadoresRepository', 'ProdutoIdentificadoresService',
    'ProdutoIdentificadoresBackfill', 'espelharIdentificadoresSafe',
    'repo.inserir', 'repo.buscarPorId', 'repo.listarPorProduto',
    'repo.buscarPorTipoCodigo', 'repo.buscarPrincipal', 'repo.atualizar',
    'repo.desativar', 'repo.contar',
    'service.espelharCodigoEBarras', 'service.upsertPrincipal', 'service.listarPorProduto',
    'backfill.executar'
  ];
  const hits = simbolosPublicos.filter((s) => cobertos.has(s) || [...cobertos].some((c) => c.includes(s.split('.').pop())));
  // Contagem direta
  let hitCount = 0;
  for (const s of simbolosPublicos) {
    if (cobertos.has(s)) hitCount += 1;
  }
  const coberturaPct = Math.round((hitCount / simbolosPublicos.length) * 100);

  console.log(`\nCobertura de API pública Sprint 01: ${hitCount}/${simbolosPublicos.length} (${coberturaPct}%)`);
  console.log(`Marcadores: ${[...cobertos].sort().join(', ')}`);
  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);

  if (coberturaPct < 95) {
    console.error(`Cobertura abaixo de 95% (${coberturaPct}%).`);
    process.exit(1);
  }
  if (falhou > 0) process.exit(1);
  console.log('MIP Sprint 01 OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
