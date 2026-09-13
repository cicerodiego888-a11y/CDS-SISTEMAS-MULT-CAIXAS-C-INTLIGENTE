'use strict';

/**
 * CIA-RC1.0 — CDS Intelligence Agent
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  CIA_VERSION,
  CIA_CODIGO,
  CiaService,
  IntentEngine,
  Planner,
  autorizar,
  obterCia,
  AgentSDK
} = require('../../backend/motores/cia');

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log('OK', nome))
    .catch((err) => {
      console.error('FAIL', nome);
      throw err;
    });
}

function criarDb() {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cia10-'));
    const db = new sqlite3.Database(path.join(dir, 'test.db'), (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run(`CREATE TABLE produtos (
          id INTEGER PRIMARY KEY, codigo TEXT, nome TEXT, nome_busca TEXT,
          codigo_barras TEXT, estoque_atual REAL DEFAULT 0, estoque_minimo REAL DEFAULT 0,
          ativo INTEGER DEFAULT 1, item_fiscal INTEGER DEFAULT 1, ncm TEXT,
          controla_estoque INTEGER DEFAULT 1, preco_venda REAL DEFAULT 0,
          categoria_id INTEGER, marca_id INTEGER
        )`);
        db.run(`CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`CREATE TABLE produto_identificadores (
          id INTEGER PRIMARY KEY, produto_id INTEGER, tipo TEXT, codigo TEXT,
          ativo INTEGER DEFAULT 1, principal INTEGER DEFAULT 0
        )`);
        db.run(`CREATE TABLE promocoes (id INTEGER PRIMARY KEY, produto_id INTEGER, status TEXT)`);
        db.run(`CREATE TABLE produto_atacado (id INTEGER PRIMARY KEY, produto_id INTEGER)`);
        db.run(`CREATE TABLE contas_receber (
          id INTEGER PRIMARY KEY, valor_restante REAL, status TEXT, data_vencimento TEXT
        )`);
        db.run(`CREATE TABLE vendas (
          id INTEGER PRIMARY KEY, data_venda TEXT, cancelada INTEGER DEFAULT 0
        )`);
        db.run(`CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT, cpf_cnpj TEXT, telefone TEXT)`);
        db.run(`CREATE TABLE fornecedores (id INTEGER PRIMARY KEY, nome TEXT)`);
        db.run(`INSERT INTO produtos (id, codigo, nome, nome_busca, estoque_atual, estoque_minimo)
                VALUES (1, '10', 'Arroz 5kg', 'arroz5kg', 1, 10)`);
        db.run(`INSERT INTO contas_receber (valor_restante, status, data_vencimento)
                VALUES (200, 'aberto', date('now', '-1 day'))`);
        db.run(
          `INSERT INTO vendas (data_venda, cancelada) VALUES (date('now'), 0)`,
          (e) => (e ? reject(e) : resolve(db))
        );
      });
    });
  });
}

async function main() {
  await test('versão CIA-RC1.0', () => {
    assert.strictEqual(CIA_VERSION, '1.0.0');
    assert.strictEqual(CIA_CODIGO, 'CIA-RC1.0');
  });

  await test('IntentEngine reconhece intenções', () => {
    const ie = new IntentEngine();
    assert.strictEqual(ie.classificar('Produtos sem estoque').intent, IntentEngine.INTENTS.STOCK_OUT);
    assert.strictEqual(ie.classificar('Quem está inadimplente?').intent, IntentEngine.INTENTS.INADIMPLENTES);
    assert.strictEqual(ie.classificar('Fechar meu caixa').intent, IntentEngine.INTENTS.CLOSE_CAIXA);
    assert.ok(ie.classificar('Fechar meu caixa').critica);
    assert.strictEqual(ie.classificar('Emitir NF-e').intent, IntentEngine.INTENTS.EMIT_NFE);
  });

  await test('Planner gera passos com tools de motores', () => {
    const p = new Planner();
    const plano = p.planejar({
      intent: IntentEngine.INTENTS.REGISTER_PRODUCT,
      critica: true,
      permissao: 'produtos',
      entidades: { gtin: '7891000100010' }
    });
    const tools = plano.steps.map((s) => s.tool);
    assert.ok(tools.includes('miip.identify'));
    assert.ok(tools.includes('miip.enrich'));
    assert.ok(tools.includes('action.prepare_critical'));
    assert.ok(plano.requerConfirmacao);
  });

  await test('Permissões bloqueiam financeiro', () => {
    const auth = autorizar({ role: 'operador', permissoes: ['produtos'] }, 'financeiro');
    assert.strictEqual(auth.ok, false);
    const ok = autorizar({ role: 'admin' }, 'financeiro');
    assert.strictEqual(ok.ok, true);
  });

  const db = await criarDb();
  CiaService.resetInstance();
  const cia = obterCia(db);
  const admin = { id: 1, role: 'admin', perfil: 'ADMIN', permissoes: ['*'], sessao_id: 't1' };

  await test('status e tools', () => {
    const st = cia.status();
    assert.ok(st.principios.includes('nao_consulta_banco_de_negocio'));
    const tools = cia.tools();
    assert.ok(tools.some((t) => t.name === 'mib.search'));
    assert.ok(tools.some((t) => t.name === 'cip.forecast'));
    assert.ok(tools.some((t) => t.name === 'miip.identify'));
  });

  await test('chat insights estoque via CIP', async () => {
    const r = await cia.chat({ mensagem: 'Produtos sem estoque', origem: 'erp' }, admin);
    assert.ok(r.ok);
    assert.strictEqual(r.intent, IntentEngine.INTENTS.STOCK_OUT);
    assert.ok((r.motores || []).includes('CIP') || /estoque|Insights/i.test(r.resposta));
  });

  await test('ação crítica exige confirmação', async () => {
    const r = await cia.chat({ mensagem: 'Fechar meu caixa', origem: 'pdv' }, admin);
    assert.ok(r.requerConfirmacao);
    assert.ok(r.confirmacao_id);
    const conf = await cia.chat({
      mensagem: 'confirmar',
      confirmar: true,
      confirmacao_id: r.confirmacao_id,
      origem: 'pdv'
    }, admin);
    assert.ok(conf.confirmado);
  });

  await test('bloqueio por permissão', async () => {
    const user = { id: 2, role: 'operador', permissoes: ['pdv'], sessao_id: 't2' };
    const r = await cia.chat({ mensagem: 'Quem está inadimplente?', origem: 'erp' }, user);
    assert.ok(r.bloqueado || r.ok === false);
  });

  await test('memória operacional — lista anterior', async () => {
    const orch = cia.orchestrator;
    orch.memory.rememberTurn(
      { operador_id: 9, sessao_id: 'mem' },
      { intent: 'search_client', lista: [{ id: 1, nome: 'A' }, { id: 2, nome: 'B' }, { id: 3, nome: 'C' }] }
    );
    const plano = orch.planner.planejar(
      {
        intent: IntentEngine.INTENTS.INADIMPLENTES,
        entidades: { limite: 2 },
        permissao: 'financeiro',
        critica: false
      },
      orch.memory.get({ operador_id: 9, sessao_id: 'mem' })
    );
    // plano usa memória; steps CIP existem
    assert.ok(plano.steps.length >= 1);
  });

  await test('AgentSDK facade', async () => {
    const sdk = AgentSDK.fromDb(db);
    assert.ok(sdk.status().codigo === 'CIA-RC1.0');
    assert.ok(sdk.tools().length >= 5);
  });

  await test('auditoria registra', async () => {
    const hist = await cia.auditHistory(10);
    assert.ok(Array.isArray(hist));
    assert.ok(hist.length >= 1);
  });

  CiaService.resetInstance();
  await new Promise((resolve) => {
    try { db.close(() => resolve()); } catch (_) { resolve(); }
    setTimeout(resolve, 200);
  });
  console.log('\nCIA-RC1.0 testes OK');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
