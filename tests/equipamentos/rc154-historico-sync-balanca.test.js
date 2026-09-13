/**
 * RC15.4 — Histórico de sincronização com a balança
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC15.4 — tabela e serviço de log', () => {
  it('cria tabela produto_balanca_sync_log no database.js', () => {
    const src = read('backend/database.js');
    assert.match(src, /produto_balanca_sync_log/);
    assert.match(src, /produto_id/);
    assert.match(src, /equipamento_id/);
    assert.match(src, /tempo_ms/);
    assert.match(src, /usuario_id/);
  });

  it('ProdutoBalancaSyncLogService registra e lista sem tocar no driver', () => {
    const src = read('backend/motores/equipamentos/drivers/toledo/plu/ProdutoBalancaSyncLogService.js');
    assert.match(src, /async function registrar/);
    assert.match(src, /async function listar/);
    assert.match(src, /ENVIAR_PRODUTO/);
    assert.match(src, /ENVIAR_LOTE/);
    assert.match(src, /ENVIAR_TODOS/);
    assert.doesNotMatch(src, /ToledoPrixIVDriver|UploadPluOperation|ToledoPluBuilder/);
  });
});

describe('RC15.4 — controller registra eventos', () => {
  it('uploadProduto / uploadPlus / uploadMany chamam o log', () => {
    const src = read('backend/motores/equipamentos/drivers/toledo/plu/PluController.js');
    assert.match(src, /produtoBalancaSyncLog/);
    assert.match(src, /registrarLogsLote/);
    assert.match(src, /syncLogHistorico/);
    assert.match(src, /ENVIAR_PRODUTO/);
  });

  it('rota GET /plu/sync-log existe', () => {
    const rotas = read('backend/rotas/equipamentos.js');
    assert.match(rotas, /plu\/sync-log/);
    assert.match(rotas, /PluController\.syncLogHistorico/);
  });
});

describe('RC15.4 — UI', () => {
  it('cadastro tem botão Histórico', () => {
    const src = read('frontend/erp/js/produtos.js');
    assert.match(src, /btnHistoricoBalancaProduto/);
    assert.match(src, /Histórico/);
    assert.match(src, /plu\/sync-log/);
    assert.match(src, /carregarHistoricoBalancaProduto/);
  });

  it('tela Enviar Produtos tem Ver Histórico', () => {
    const src = read('frontend/erp/js/enviar-produtos-balanca.js');
    assert.match(src, /epbBtnHistorico/);
    assert.match(src, /Ver Histórico/);
    assert.match(src, /epbCarregarHistorico/);
    assert.match(src, /ENVIAR_TODOS|ENVIAR_LOTE/);
  });
});
