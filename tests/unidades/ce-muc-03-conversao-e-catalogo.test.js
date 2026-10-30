'use strict';

/**
 * CE-MUC-03 — testes isolados (sem banco oficial / ProgramData).
 */

const assert = require('node:assert/strict');
const { test, describe, before } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const sqlite3 = require('sqlite3');

const Confirmacao = require('../../backend/services/unidades/ConfirmacaoConversaoEntradaNfe');
const MotorUM = require('../../backend/services/unidades/MotorUnidadesMedida');
const Catalogo = require('../../backend/services/unidades/UnidadesMedidaCatalogoService');

function openTempDb() {
  const file = path.join(
    os.tmpdir(),
    `ce-muc-03-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
  );
  const db = new sqlite3.Database(file);
  db.__cdsPath = file;
  return db;
}

function closeAndUnlink(db) {
  return new Promise((resolve) => {
    const file = db.__cdsPath;
    db.close(() => {
      try { fs.unlinkSync(file); } catch { /* ignore */ }
      resolve();
    });
  });
}

describe('CE-MUC-03 — SIM confirma fator sugerido PR→UN', () => {
  test('aplicarSim em FATOR_CONVERSAO_AUSENTE aceita fator sugerido da NF-e', () => {
    const produto = { id: 7, nome: 'Chinelo', unidade: 'UN' };
    const item = {
      nItem: 1,
      produto_id: 7,
      quantidade_comercial: 2,
      unidade_comercial: 'PR',
      quantidade_tributavel: 2,
      unidade_tributavel: 'PR',
      qCom: 2,
      uCom: 'PR',
      qTrib: 2,
      uTrib: 'PR'
    };
    const avaliacao = Confirmacao.avaliarLinha(item, produto, 0, { documentoId: 99 });
    assert.equal(avaliacao.requer, true);
    assert.equal(avaliacao.resultado.codigo, 'FATOR_CONVERSAO_AUSENTE');
    assert.ok(Number(avaliacao.resultado.fatorSugerido) > 0);
    assert.ok(avaliacao.pendencia.conversao_sugerida);
    assert.ok(Number(avaliacao.pendencia.quantidade_resultante_proposta) > 0);

    const aplicado = Confirmacao.aplicarSim(item, produto, avaliacao.resultado, 0, {
      documentoId: 99,
      aceitarFatorSugerido: true
    });
    assert.equal(aplicado.ok, true);
    assert.equal(aplicado.origem, 'FATOR_SUGERIDO_NFE_CONFIRMADO');
    assert.equal(aplicado.quantidadeEstoque, 2);
    assert.equal(aplicado.fatorConversao, 1);

    const selo = avaliacao.pendencia.selo_conversao;
    const pendencias = Confirmacao.validarPendenciasConversaoEntrada([item], {
      produtoMap: new Map([[7, produto]]),
      confirmacoes: [{ nItem: 1, confirmacao: true, documento_id: 99, selo_conversao: selo }],
      documentoId: 99,
      origemCompra: 'CENTRAL_NFE'
    });
    assert.equal(pendencias.length, 0);
  });

  test('NÃO sem unidades iguais continua bloqueando efetivação', () => {
    const produto = { id: 7, nome: 'Chinelo', unidade: 'UN' };
    const item = {
      nItem: 1,
      produto_id: 7,
      qCom: 2,
      uCom: 'PR',
      qTrib: 2,
      uTrib: 'PR',
      quantidade_comercial: 2,
      unidade_comercial: 'PR',
      quantidade_tributavel: 2,
      unidade_tributavel: 'PR'
    };
    const pendencias = Confirmacao.validarPendenciasConversaoEntrada([item], {
      produtoMap: new Map([[7, produto]]),
      confirmacoes: [{ nItem: 1, confirmacao: false }],
      origemCompra: 'CENTRAL_NFE'
    });
    assert.equal(pendencias.length, 1);
    assert.equal(pendencias[0].codigo, 'CONVERSAO_RECUSADA_SEM_QUANTIDADE_SEGURA');
  });

  test('MAPA reconhece PR/PAR/COPO sem colapsar para UN', () => {
    assert.equal(MotorUM.normalizarUnidadeEntradaNfe('PR'), 'PR');
    assert.equal(MotorUM.normalizarUnidadeEntradaNfe('PAR'), 'PAR');
    assert.equal(MotorUM.normalizarUnidadeComercial('COPO'), 'COPO');
    assert.equal(MotorUM.normalizarUnidadeComercial('XYZ99'), 'XYZ99');
  });
});

describe('CE-MUC-03 — PACOTE → 12 UN custo/margem', () => {
  test('calcularCompraEmbalagem: R$40 / 12 = 3.3333; margem 50% → 5.00 e pacote 60', () => {
    const r = MotorUM.calcularCompraEmbalagem({
      quantidadeEmbalagens: 1,
      quantidadePorEmbalagem: 12,
      valorTotalEmbalagem: 40,
      margemPercentual: 50,
      unidadeComercial: 'PACOTE'
    });
    assert.equal(r.quantidadeEstoque, 12);
    assert.equal(r.custoUnitario, 3.3333);
    assert.equal(r.precoVendaUnitario, 5);
    assert.equal(r.valorEmbalagemVenda, 60);
  });

  test('calcularFormacaoPrecoCadastro com compra por embalagem', () => {
    const r = MotorUM.calcularFormacaoPrecoCadastro({
      compraPorEmbalagem: true,
      unidadeComercial: 'PACOTE',
      quantidadePorEmbalagem: 12,
      valorEmbalagemCompra: 40,
      margemPercentual: 50,
      origem: 'margem'
    });
    assert.equal(r.custoUnitario, 3.3333);
    assert.equal(r.precoVendaUnitario, 5);
    assert.equal(r.valorEmbalagemVenda, 60);
  });
});

describe('CE-MUC-03 — catálogo unidades (SQLite isolado)', () => {
  let db;

  before(async () => {
    db = openTempDb();
    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run(`CREATE TABLE produtos (
          id INTEGER PRIMARY KEY, unidade TEXT, unidade_comercial TEXT
        )`);
        db.run(`CREATE TABLE produto_embalagens (
          id INTEGER PRIMARY KEY, tipo TEXT, unidade TEXT, unidade_comercial TEXT
        )`, (err) => (err ? reject(err) : resolve()));
      });
    });
    await Catalogo.ensureSchema(db);
  });

  test('seed inclui UN/PACOTE/PR e permite cadastrar COPO custom', async () => {
    const lista = await Catalogo.listar(db);
    assert.ok(lista.some((u) => u.codigo === 'UN'));
    assert.ok(lista.some((u) => u.codigo === 'PACOTE'));
    const criada = await Catalogo.criar(db, { codigo: 'COPOX', descricao: 'Copo especial', tipo: 'ambos' });
    assert.equal(criada.codigo, 'COPOX');
    await assert.rejects(
      () => Catalogo.criar(db, { codigo: 'copox', descricao: 'dup' }),
      /Já existe/
    );
  });

  test('bloqueia exclusão quando referenciada em produto', async () => {
    await Catalogo.criar(db, { codigo: 'CXZ', descricao: 'Caixa Z' });
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO produtos (unidade, unidade_comercial) VALUES (?, ?)', ['CXZ', 'UN'], (err) => (
        err ? reject(err) : resolve()
      ));
    });
    const row = await Catalogo.obterPorCodigo(db, 'CXZ');
    await assert.rejects(() => Catalogo.excluir(db, row.id), /em uso/i);
  });

  test('exclui unidade custom sem referências', async () => {
    const u = await Catalogo.criar(db, { codigo: 'TMPU', descricao: 'Temp' });
    const r = await Catalogo.excluir(db, u.id);
    assert.equal(r.sucesso, true);
  });

  test('teardown remove temp db', async () => {
    await closeAndUnlink(db);
    assert.equal(fs.existsSync(db.__cdsPath), false);
  });
});
