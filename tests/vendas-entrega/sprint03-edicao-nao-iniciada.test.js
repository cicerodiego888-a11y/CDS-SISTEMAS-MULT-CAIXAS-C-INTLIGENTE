/**
 * Sprint 3 — Edição da entrega + status NÃO INICIADA
 * node --test tests/vendas-entrega/sprint03-edicao-nao-iniciada.test.js
 */
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '../..');
const { StatusEntrega, StatusVenda, TipoVenda } = require('../../backend/services/entrega/enums');
const { EntregaService } = require('../../backend/services/entrega/EntregaService');
const { montarSnapshotEntrega } = require('../../backend/services/entrega/EntregaClienteSnapshot');
const { montarHtmlComprovanteEntrega } = require('../../backend/services/entrega');

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function openMemoryDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(db)));
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
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function closeDb(db) {
  return new Promise((resolve) => {
    try { db.close(() => resolve()); } catch (_) { resolve(); }
  });
}

async function criarSchema(db) {
  await run(db, `
    CREATE TABLE vendas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT,
      data_venda TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      cliente_id INTEGER,
      total REAL DEFAULT 0,
      desconto REAL DEFAULT 0,
      status TEXT,
      cancelada INTEGER DEFAULT 0,
      tipo_venda TEXT,
      status_venda TEXT,
      status_entrega TEXT,
      pagamento_previsto TEXT,
      entregador TEXT,
      endereco_entrega TEXT,
      referencia_entrega TEXT,
      observacao_entrega TEXT,
      telefone_entrega TEXT,
      taxa_entrega REAL DEFAULT 0,
      leva_maquineta INTEGER DEFAULT 0,
      troco_para REAL DEFAULT 0,
      prestacao_realizada INTEGER DEFAULT 0,
      nome_cliente_entrega TEXT,
      cpf_cnpj_cliente_entrega TEXT,
      email_cliente_entrega TEXT,
      cep_entrega TEXT,
      numero_entrega TEXT,
      complemento_entrega TEXT,
      bairro_entrega TEXT,
      cidade_entrega TEXT,
      uf_entrega TEXT
    )
  `);
  await run(db, `
    CREATE TABLE clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT,
      cpf_cnpj TEXT,
      telefone TEXT,
      email TEXT,
      cep TEXT,
      rua TEXT,
      numero TEXT,
      bairro TEXT,
      cidade TEXT,
      uf TEXT,
      endereco TEXT
    )
  `);
}

function criarRepoComDb(db) {
  return {
    async buscarPorVendaId(id) {
      const row = await get(db, `
        SELECT v.*, COALESCE(v.nome_cliente_entrega, c.nome) AS cliente_nome
        FROM vendas v
        LEFT JOIN clientes c ON c.id = v.cliente_id
        WHERE v.id = ? AND v.tipo_venda = ?
      `, [id, TipoVenda.ENTREGA]);
      if (!row) return null;
      const { normalizarStatusEntrega } = require('../../backend/services/entrega/enums');
      return {
        ...row,
        status_entrega: normalizarStatusEntrega(row.status_entrega) || row.status_entrega,
        status_venda: row.status_venda || StatusVenda.ABERTA,
        leva_maquineta: Number(row.leva_maquineta || 0) === 1,
        troco_para: Number(row.troco_para || 0),
        reservado_fiscal: 0,
        reservado_nao_fiscal: 0,
        total_reservado: 0
      };
    },
    async atualizarStatusEntrega(vendaId, status) {
      return run(db, `UPDATE vendas SET status_entrega = ? WHERE id = ?`, [status, vendaId]);
    },
    async atualizarEntrega(vendaId, dados = {}) {
      const map = {
        cliente_id: 'cliente_id',
        entregador: 'entregador',
        endereco_entrega: 'endereco_entrega',
        referencia_entrega: 'referencia_entrega',
        observacao_entrega: 'observacao_entrega',
        telefone_entrega: 'telefone_entrega',
        pagamento_previsto: 'pagamento_previsto',
        taxa_entrega: 'taxa_entrega',
        leva_maquineta: 'leva_maquineta',
        troco_para: 'troco_para',
        nome_cliente_entrega: 'nome_cliente_entrega',
        cpf_cnpj_cliente_entrega: 'cpf_cnpj_cliente_entrega',
        email_cliente_entrega: 'email_cliente_entrega',
        cep_entrega: 'cep_entrega',
        numero_entrega: 'numero_entrega',
        complemento_entrega: 'complemento_entrega',
        bairro_entrega: 'bairro_entrega',
        cidade_entrega: 'cidade_entrega',
        uf_entrega: 'uf_entrega'
      };
      const campos = [];
      const params = [];
      Object.keys(map).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(dados, key)) {
          let val = dados[key];
          if (key === 'leva_maquineta') val = val === true || val === 1 || val === '1' ? 1 : 0;
          if (key === 'cliente_id') {
            const n = Number(val);
            val = Number.isFinite(n) && n > 0 ? n : null;
          }
          campos.push(`${map[key]} = ?`);
          params.push(val);
        }
      });
      if (!campos.length) return { changes: 0 };
      params.push(vendaId, TipoVenda.ENTREGA);
      let sql = `UPDATE vendas SET ${campos.join(', ')} WHERE id = ? AND tipo_venda = ?`;
      if (dados._somenteAguardandoEntrega === true) {
        sql += ` AND UPPER(COALESCE(status_entrega, '')) = ?`;
        params.push(StatusEntrega.AGUARDANDO_ENTREGA);
      }
      return run(db, sql, params);
    }
  };
}

function criarService(db) {
  const auditoria = require('../../backend/services/auditoria');
  auditoria.gravarAuditoria = async () => ({});
  return new EntregaService({
    repository: criarRepoComDb(db),
    buscarCliente: async (id) => get(db, 'SELECT * FROM clientes WHERE id = ?', [id])
  });
}

describe('Sprint 3 — contratos UI/API', () => {
  it('UI mostra NÃO INICIADA, Editar e Iniciar Entrega', () => {
    const ui = ler('frontend/pdv/js/entregas.js');
    assert.match(ui, /NÃO INICIADA/);
    assert.match(ui, /Aguardando saída do entregador/);
    assert.match(ui, /btn-editar-entrega/);
    assert.match(ui, /Iniciar Entrega/);
    assert.match(ui, /Editar Entrega #/);
    assert.match(ui, /Salvar Alterações/);
    assert.match(ui, /method:\s*'PATCH'/);
    assert.match(ui, /já foi iniciada e não pode mais ser editada/);
  });

  it('rotas PATCH de edição existem', () => {
    const rotas = ler('backend/rotas/entregas.js');
    assert.match(rotas, /patch\('\/entregas\/:id'/i);
    assert.match(rotas, /patch\('\/:id\/entrega'/i);
    assert.match(rotas, /editarEntrega/);
  });

  it('frontend oculta Editar fora de AGUARDANDO_ENTREGA', () => {
    const ui = ler('frontend/pdv/js/entregas.js');
    assert.match(ui, /podeEditar\s*=\s*v\.status_entrega\s*===\s*'AGUARDANDO_ENTREGA'/);
  });
});

describe('Sprint 3 — edição AGUARDANDO_ENTREGA', () => {
  let db;
  let service;
  let vendaId;
  let clienteId;

  beforeEach(async () => {
    db = await openMemoryDb();
    await criarSchema(db);
    const cli = await run(db, `
      INSERT INTO clientes (nome, cpf_cnpj, telefone, email, cep, rua, numero, bairro, cidade, uf)
      VALUES ('Cliente A', '111', '85999990000', 'a@test.com', '60000000', 'Rua A', '100', 'Centro', 'Fortaleza', 'CE')
    `);
    clienteId = cli.lastID;
    const v = await run(db, `
      INSERT INTO vendas (
        codigo, data_venda, cliente_id, total, tipo_venda, status_venda, status_entrega,
        pagamento_previsto, entregador, endereco_entrega, referencia_entrega, observacao_entrega,
        telefone_entrega, taxa_entrega, leva_maquineta, troco_para,
        nome_cliente_entrega, cpf_cnpj_cliente_entrega, email_cliente_entrega,
        cep_entrega, numero_entrega, complemento_entrega, bairro_entrega, cidade_entrega, uf_entrega
      ) VALUES (
        'ENT-1', datetime('now'), ?, 50, ?, ?, ?,
        'PIX', 'João', 'Rua A', 'Portão', 'Obs1',
        '85999990000', 5, 0, 0,
        'Cliente A', '111', 'a@test.com',
        '60000000', '100', 'Apto 1', 'Centro', 'Fortaleza', 'CE'
      )
    `, [clienteId, TipoVenda.ENTREGA, StatusVenda.ABERTA, StatusEntrega.AGUARDANDO_ENTREGA]);
    vendaId = v.lastID;
    service = criarService(db);
  });

  afterEach(async () => {
    await closeDb(db);
  });

  it('1-15. edita campos e atualiza snapshot', async () => {
    const cliB = await run(db, `
      INSERT INTO clientes (nome, cpf_cnpj, telefone, email, cep, rua, numero, bairro, cidade, uf)
      VALUES ('Cliente B', '222', '85988880000', 'b@test.com', '60100000', 'Rua B', '200', 'Aldeota', 'Fortaleza', 'CE')
    `);

    const r = await service.editarEntrega(vendaId, {
      cliente_id: cliB.lastID,
      nome_cliente_entrega: 'Cliente B',
      telefone_entrega: '85988880000',
      endereco_entrega: 'Rua B',
      numero_entrega: '200',
      complemento_entrega: 'Sala 2',
      referencia_entrega: 'Próximo ao mercado',
      entregador: 'Maria',
      taxa_entrega: 8.5,
      pagamento_previsto: 'DINHEIRO',
      leva_maquineta: 1,
      troco_para: 100,
      observacao_entrega: 'Obs nova',
      bairro_entrega: 'Aldeota',
      cidade_entrega: 'Fortaleza',
      uf_entrega: 'CE',
      cep_entrega: '60100000',
      email_cliente_entrega: 'b@test.com',
      cpf_cnpj_cliente_entrega: '222'
    });

    assert.equal(r.success, true);
    assert.equal(r.item.telefone_entrega, '85988880000');
    assert.equal(r.item.endereco_entrega, 'Rua B');
    assert.equal(r.item.numero_entrega, '200');
    assert.equal(r.item.complemento_entrega, 'Sala 2');
    assert.equal(r.item.referencia_entrega, 'Próximo ao mercado');
    assert.equal(r.item.entregador, 'Maria');
    assert.equal(Number(r.item.taxa_entrega), 8.5);
    assert.equal(r.item.pagamento_previsto, 'DINHEIRO');
    assert.equal(r.item.leva_maquineta, true);
    assert.equal(Number(r.item.troco_para), 100);
    assert.equal(r.item.observacao_entrega, 'Obs nova');
    assert.equal(Number(r.item.cliente_id), cliB.lastID);
    assert.ok(r.campos_alterados.length >= 5);

    const row = await get(db, 'SELECT * FROM vendas WHERE id = ?', [vendaId]);
    assert.equal(row.nome_cliente_entrega, 'Cliente B');
    assert.equal(row.status_entrega, StatusEntrega.AGUARDANDO_ENTREGA);

    const mestre = await get(db, 'SELECT * FROM clientes WHERE id = ?', [clienteId]);
    assert.equal(mestre.nome, 'Cliente A');
    assert.equal(mestre.telefone, '85999990000');
  });

  it('altera consumidor avulso', async () => {
    const r = await service.editarEntrega(vendaId, {
      cliente_id: null,
      nome_cliente_entrega: 'Avulso Novo',
      telefone_entrega: '85977770000',
      endereco_entrega: 'Rua Avulsa',
      referencia_entrega: 'Sem número'
    });
    assert.equal(r.item.nome_cliente_entrega, 'Avulso Novo');
    assert.ok(r.item.cliente_id == null || Number(r.item.cliente_id) === 0);
  });
});

describe('Sprint 3 — bloqueio por status', () => {
  let db;
  let service;

  async function seed(status) {
    db = await openMemoryDb();
    await criarSchema(db);
    const v = await run(db, `
      INSERT INTO vendas (
        codigo, total, tipo_venda, status_venda, status_entrega,
        nome_cliente_entrega, endereco_entrega, telefone_entrega
      ) VALUES ('ENT-X', 10, ?, ?, ?, 'X', 'Rua X', '00')
    `, [TipoVenda.ENTREGA, StatusVenda.ABERTA, status]);
    service = criarService(db);
    return v.lastID;
  }

  afterEach(async () => {
    await closeDb(db);
  });

  for (const st of [
    StatusEntrega.EM_ENTREGA,
    StatusEntrega.AGUARDANDO_PRESTACAO,
    StatusEntrega.CONCLUIDA,
    StatusEntrega.CANCELADA
  ]) {
    it(`bloqueia edição em ${st}`, async () => {
      const id = await seed(st);
      await assert.rejects(
        () => service.editarEntrega(id, { telefone_entrega: '1' }),
        (err) => {
          assert.ok(err.status === 409 || err.status === 400);
          assert.match(String(err.message), /iniciada|cancelada/i);
          return true;
        }
      );
    });
  }
});

describe('Sprint 3 — concorrência', () => {
  it('recusa salvar se outro operador iniciou', async () => {
    const db = await openMemoryDb();
    await criarSchema(db);
    const v = await run(db, `
      INSERT INTO vendas (
        codigo, total, tipo_venda, status_venda, status_entrega,
        nome_cliente_entrega, endereco_entrega
      ) VALUES ('ENT-C', 10, ?, ?, ?, 'C', 'Rua C')
    `, [TipoVenda.ENTREGA, StatusVenda.ABERTA, StatusEntrega.AGUARDANDO_ENTREGA]);
    const service = criarService(db);

    await run(db, `UPDATE vendas SET status_entrega = ? WHERE id = ?`, [
      StatusEntrega.EM_ENTREGA,
      v.lastID
    ]);

    await assert.rejects(
      () => service.editarEntrega(v.lastID, { endereco_entrega: 'Rua Nova' }),
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.message, 'Esta entrega já foi iniciada e não pode mais ser editada.');
        return true;
      }
    );

    const row = await get(db, 'SELECT endereco_entrega, status_entrega FROM vendas WHERE id = ?', [v.lastID]);
    assert.equal(row.endereco_entrega, 'Rua C');
    assert.equal(row.status_entrega, StatusEntrega.EM_ENTREGA);
    await closeDb(db);
  });
});

describe('Sprint 3 — snapshot / comprovante', () => {
  it('comprovante usa snapshot atualizado', () => {
    const snap = montarSnapshotEntrega({
      nome_cliente_entrega: 'Atualizado',
      telefone_entrega: '85900001111',
      endereco_entrega: 'Rua Nova',
      numero_entrega: '99',
      cidade_entrega: 'Fortaleza',
      uf_entrega: 'CE'
    });
    const html = montarHtmlComprovanteEntrega({
      id: 7,
      total: 20,
      ...snap,
      nome_cliente_entrega: snap.nome_cliente_entrega,
      telefone_entrega: snap.telefone_entrega,
      endereco_entrega: snap.endereco_entrega,
      numero_entrega: snap.numero_entrega,
      cidade_entrega: snap.cidade_entrega,
      uf_entrega: snap.uf_entrega
    });
    assert.match(html, /Atualizado/);
    assert.match(html, /Rua Nova/);
    assert.match(html, /85900001111/);
  });
});
