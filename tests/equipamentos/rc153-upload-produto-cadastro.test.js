/**
 * RC15.3 — Envio individual de produto para balança (cadastro)
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

describe('RC15.3 — API upload-produto', () => {
  it('registra POST /:id/upload-produto e GET /plu/ultima-sync', () => {
    const rotas = read('backend/rotas/equipamentos.js');
    assert.match(rotas, /upload-produto/);
    assert.match(rotas, /PluController\.uploadProduto/);
    assert.match(rotas, /plu\/ultima-sync/);
    assert.match(rotas, /PluController\.ultimaSync/);
  });

  it('uploadProduto valida e chama ToledoPluEngine.uploadOne', () => {
    const src = read('backend/motores/equipamentos/drivers/toledo/plu/PluController.js');
    assert.match(src, /async function uploadProduto/);
    assert.match(src, /carregarProdutoPorId/);
    assert.match(src, /toledoPluEngine\.uploadOne/);
    assert.match(src, /PRODUTO_INATIVO|Produto inativo/);
    assert.match(src, /PRODUTO_NAO_PESAVEL|não pesável/);
    assert.match(src, /PLU_INVALIDO|sem PLU/);
    assert.match(src, /EQUIPAMENTO_DESCONECTADO|desconectado/);
    assert.doesNotMatch(src, /new ToledoPrixIVDriver|require\(.*ToledoPrixIVDriver/);
  });

  it('ToledoPluEngine expõe uploadOne como alias de upload', () => {
    const src = read('backend/motores/equipamentos/drivers/toledo/plu/ToledoPluEngine.js');
    assert.match(src, /async uploadOne\(/);
    assert.match(src, /return this\.upload\(/);
  });
});

describe('RC15.3 — UI cadastro de produto', () => {
  it('painel Balança Toledo e botão Enviar para Balança', () => {
    const src = read('frontend/erp/js/produtos.js');
    assert.match(src, /painelEnvioBalancaProduto/);
    assert.match(src, /btnEnviarProdutoBalanca/);
    assert.match(src, /Enviar para Balança/);
    assert.match(src, /Balança Toledo/);
    assert.match(src, /upload-produto/);
    assert.match(src, /produtoCadastroElegivelEnvioBalanca/);
    assert.match(src, /Produto apto para balança/);
    assert.match(src, /Enviando produto/);
    assert.match(src, /Produto enviado com sucesso/);
    assert.match(src, /Falha ao enviar produto/);
    assert.match(src, /balancaProdutoUltimaSync/);
  });

  it('botão só para ativo + pesável + PLU', () => {
    const src = read('frontend/erp/js/produtos.js');
    assert.match(src, /produto_fracionado/);
    assert.match(src, /#plu/);
    assert.match(src, /data-produto-ativo/);
  });
});

describe('RC15.3.1 — UX pós-salvar (não mantém modal aberto)', () => {
  it('fecha modal e pergunta envio opcional para pesáveis', () => {
    const src = read('frontend/erp/js/produtos.js');
    assert.match(src, /perguntarEnvioBalancaAposSalvar/);
    assert.match(src, /produtoSalvoElegivelPerguntaBalanca/);
    assert.match(src, /Deseja enviar este produto para a balança agora/);
    assert.match(src, /Enviar Agora/);
    assert.match(src, /Depois/);
    assert.match(src, /Produto enviado para a balança/);
    assert.match(src, /sempre fecha o modal/);
    assert.doesNotMatch(src, /manterAbertoParaBalanca/);
  });
});

describe('Cadastro sequencial — Salvar abre novo produto', () => {
  it('após salvar produto novo reabre o modal em branco', () => {
    const src = read('frontend/erp/js/produtos.js');
    assert.match(src, /function abrirProximoCadastroProdutoAposSalvar/);
    assert.match(src, /continuarCadastrando/);
    assert.match(src, /origemCadastro !== 'COMPRA'/);
    assert.match(src, /Salvar e Add Novo/);
    assert.match(src, /showProdutoModal\(null\)/);
  });
});

