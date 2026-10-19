'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const express = require('express');
const request = require('supertest');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-compras-relatorio-route-'));
process.env.DB_DIR = tempDir;
delete require.cache[require.resolve('../../backend/database')];
const db = require('../../backend/database');
const comprasRouter = require('../../backend/rotas/compras');
const app = express();
app.use('/api/compras', comprasRouter);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) return reject(error);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

before(async () => {
  await new Promise((resolve, reject) => {
    db.whenReady((error) => (error ? reject(error) : resolve()));
  });
  await run(
    `INSERT INTO compras (
       id, data_compra, fornecedor, numero_nf, serie_nf, status,
       valor_produtos, valor_frete, valor_desconto, valor_total_nota, total
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [99101, '2026-10-14', 'Fornecedor Fixture', 'FIX-99101', '1', 'concluida', 24, 2, 1, 25, 25]
  );
  await run(
    `INSERT INTO compras_itens (
       compra_id, produto_id, quantidade, preco_unitario, subtotal,
       descricao_produto, codigo_barras, unidade
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [99101, null, 2, 12, 24, 'Item histórico fixture', 'FIXTURE-CODE', 'CX']
  );
});

after(async () => {
  await new Promise((resolve) => db.close(() => resolve()));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('GET /api/compras/relatorio/detalhado retorna dados filtrados sem joins multiplicadores', async () => {
  const response = await request(app)
    .get('/api/compras/relatorio/detalhado')
    .query({ data_inicio: '2026-10-14', fornecedor: 'Fixture', numero_nf: 'FIX-99101', compra_id: '99101' });

  assert.equal(response.status, 200);
  assert.equal(response.body.compras.length, 1);
  assert.equal(response.body.compras[0].id, 99101);
  assert.equal(response.body.compras[0].total_oficial, 25);
  assert.equal(response.body.compras[0].itens.length, 1);
  assert.equal(response.body.compras[0].itens[0].descricao_produto, 'Item histórico fixture');
});

test('GET /api/compras/relatorio/detalhado rejeita filtros inválidos sem gravar dados', async () => {
  const invalid = await request(app)
    .get('/api/compras/relatorio/detalhado')
    .query({ data_inicio: '2026-02-30' });
  assert.equal(invalid.status, 400);

  const result = await request(app)
    .get('/api/compras/relatorio/detalhado')
    .query({ compra_id: '99101' });
  assert.equal(result.status, 200);
  assert.equal(result.body.compras[0].total_oficial, 25);
});
