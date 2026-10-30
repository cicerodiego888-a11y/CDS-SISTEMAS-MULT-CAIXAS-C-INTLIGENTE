/**
 * TEF-15 — Vínculo venda / recebimento / transação TEF (sem TX real / sem DB oficial).
 * Executar: node tests/tef/tef-15-vinculo-venda.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const vinculo = require('../../backend/services/tef/tefVinculoVendaService');
const Idem = require('../../frontend/shared/js/tefIdempotencia.js');

let passou = 0;
let falhou = 0;

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
      console.error(`         ${error && error.stack ? error.stack : error}`);
    });
}

function openDb(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
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

async function criarFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tef-15-'));
  const dbPath = path.join(dir, 't.db');
  const db = await openDb(dbPath);
  await run(db, `CREATE TABLE vendas (id INTEGER PRIMARY KEY, total REAL)`);
  await run(db, `
    CREATE TABLE tef_transacoes (
      id INTEGER PRIMARY KEY,
      venda_id INTEGER,
      status TEXT,
      valor REAL,
      idempotency_key TEXT,
      atualizado_em TEXT
    )
  `);
  await run(db, `INSERT INTO vendas (id, total) VALUES (10, 100), (20, 50)`);
  await run(db, `INSERT INTO tef_transacoes (id, venda_id, status, valor, idempotency_key)
    VALUES (101, NULL, 'aprovado', 100, 'pdv-op-aaa'),
           (102, NULL, 'aprovado', 50, 'pdv-op-bbb'),
           (103, 20, 'aprovado', 50, 'pdv-op-ccc')`);
  return { db, dir, dbPath };
}

async function main() {
  console.log('\n=== TEF-15 vínculo venda/recebimento ===\n');

  await test('pagamento com venda_id válido', async () => {
    const { db, dir } = await criarFixture();
    const v = await vinculo.validarVendaIdParaPagamento(10, { db });
    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.venda_id, 10);
    assert.strictEqual(v.estadoVinculo, 'VENDA_INFORMADA');
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('pagamento sem venda_id → pendente finalização (não inventa venda)', async () => {
    const v = await vinculo.validarVendaIdParaPagamento(null, { db: null });
    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.venda_id, null);
    assert.strictEqual(v.estadoVinculo, 'PENDENTE_FINALIZACAO');
  });

  await test('pagamento com venda_id inexistente é recusado', async () => {
    const { db, dir } = await criarFixture();
    const v = await vinculo.validarVendaIdParaPagamento(999, { db });
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.codigo, 'TEF_VENDA_INEXISTENTE');
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('duas vendas / duas transações — vínculo inequívoco por id', async () => {
    const { db, dir } = await criarFixture();
    const a = await vinculo.vincularTransacaoAVenda(101, 10, { db });
    const b = await vinculo.vincularTransacaoAVenda(102, 20, { db });
    assert.strictEqual(a.sucesso, true);
    assert.strictEqual(b.sucesso, true);
    const r1 = await get(db, 'SELECT venda_id FROM tef_transacoes WHERE id=101');
    const r2 = await get(db, 'SELECT venda_id FROM tef_transacoes WHERE id=102');
    assert.strictEqual(r1.venda_id, 10);
    assert.strictEqual(r2.venda_id, 20);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('conflito: não sobrescreve vínculo de outra venda', async () => {
    const { db, dir } = await criarFixture();
    const c = await vinculo.vincularTransacaoAVenda(103, 10, { db });
    assert.strictEqual(c.sucesso, false);
    assert.strictEqual(c.codigo, 'TEF_VINCULO_CONFLITO');
    const r = await get(db, 'SELECT venda_id FROM tef_transacoes WHERE id=103');
    assert.strictEqual(r.venda_id, 20);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('retorno tardio / retry mantém identidade da operação (TEF-13)', () => {
    const g = Idem.criarGerenciador({ gerarId: () => 'op-fix' });
    const a = g.obterOuCriarChave({ tipo: 'credito', valor: 10, venda_id: null });
    g.marcarEnviado(a.chave);
    g.registrarResultado(a.chave, { status: 'pendente', codigo: 'TIMEOUT', retryAllowed: false });
    const b = g.obterOuCriarChave({ tipo: 'credito', valor: 10, venda_id: null });
    assert.strictEqual(a.chave, b.chave);
  });

  await test('extrair IDs TEF dos pagamentos — sem usar valor', () => {
    const ids = vinculo.extrairIdsTefDePagamentos(
      [
        { valor: 10, tef_transacao_id: 101 },
        { valor: 10, tef: { transacao_id: 102 } },
        { valor: 10 }
      ],
      { transacao_id: 101 }
    );
    assert.deepStrictEqual(ids.sort((x, y) => x - y), [101, 102]);
  });

  await test('meta resposta pagamento documenta vínculo e proíbe associação por valor', () => {
    const meta = vinculo.montarMetaRespostaPagamento({
      vendaId: null,
      estadoVinculo: 'PENDENTE_FINALIZACAO',
      idempotencyKey: 'pdv-op-xyz',
      transacaoId: 55
    });
    assert.strictEqual(meta.estado_vinculo, 'PENDENTE_FINALIZACAO');
    assert.strictEqual(meta.tef_transacao_id, 55);
    assert.strictEqual(meta.associacao_por_valor_proibida, true);
    assert.strictEqual(meta.associacao_por_ordem_proibida, true);
    assert.strictEqual(meta.operation_id, 'xyz');
  });

  await test('consulta fiscal continua por tef_transacao_id (evidência estática)', () => {
    const hydra = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fiscal/tefPagamentoHydrator.js'),
      'utf8'
    );
    assert.ok(hydra.includes('tef_transacao_id'));
    assert.ok(!/ORDER BY.*valor|associar.*valor/i.test(hydra));
    const emissor = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fiscal/emissor.js'),
      'utf8'
    );
    assert.ok(emissor.includes('tt.id = vp.tef_transacao_id') || emissor.includes('tt.id = vr.tef_transacao_id'));
  });

  await test('rota /pagar valida venda e anexa meta de vínculo', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../backend/rotas/tef.js'), 'utf8');
    assert.ok(src.includes('validarVendaIdParaPagamento'));
    assert.ok(src.includes('montarMetaRespostaPagamento'));
    assert.ok(src.includes('TEF_VENDA_INEXISTENTE') || src.includes('estado_vinculo'));
  });

  await test('VendaPagamentoService usa enfileirarVinculosSqlite (WHERE seguro)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/vendas/VendaPagamentoService.js'),
      'utf8'
    );
    assert.ok(src.includes('enfileirarVinculosSqlite'));
    assert.ok(!/UPDATE tef_transacoes\s+SET venda_id = \?\s+WHERE id = \?/.test(src));
  });

  await test('enfileirarVinculosSqlite não duplica vínculo nem troca venda', async () => {
    const { db, dir } = await criarFixture();
    vinculo.enfileirarVinculosSqlite(db, 10, [101, 101]);
    await new Promise((r) => setTimeout(r, 50));
    const row = await get(db, 'SELECT venda_id FROM tef_transacoes WHERE id=101');
    assert.strictEqual(row.venda_id, 10);
    vinculo.enfileirarVinculosSqlite(db, 20, [101]);
    await new Promise((r) => setTimeout(r, 50));
    const row2 = await get(db, 'SELECT venda_id FROM tef_transacoes WHERE id=101');
    assert.strictEqual(row2.venda_id, 10);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.exit(falhou ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
