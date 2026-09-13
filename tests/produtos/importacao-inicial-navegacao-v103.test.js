/**
 * V1.0.3 — localização da Importação Inicial (navegação).
 * Executar: node --test tests/produtos/importacao-inicial-navegacao-v103.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

describe('V1.0.3 — localização Importação Inicial', () => {
  it('Configurações comuns NÃO contém atalho Ferramentas → Importação', () => {
    const src = fs.readFileSync(path.join(root, 'frontend/erp/js/configuracoes.js'), 'utf8');
    assert.equal(/Importação Inicial de Produtos/.test(src), false);
    assert.equal(/btnAbrirImportacaoInicialProdutos|loadPage\('importacao-inicial-produtos'\)/.test(src), false);
  });

  it('Centro de Configurações Avançadas contém categoria Implantação e atalho', () => {
    const src = fs.readFileSync(path.join(root, 'frontend/erp/js/cds-centro-configuracoes.js'), 'utf8');
    assert.match(src, /id:\s*'implantacao'/);
    assert.match(src, /label:\s*'Implantação'/);
    assert.match(src, /data-cfg-pane="implantacao"/);
    assert.match(src, /Importação Inicial de Produtos/);
    assert.match(src, /loadPage\('importacao-inicial-produtos'\)/);
  });

  it('breadcrumb da tela aponta para Avançadas', () => {
    const src = fs.readFileSync(path.join(root, 'frontend/erp/js/importacao-inicial-produtos.js'), 'utf8');
    assert.match(src, /configuracoes-avancadas/);
    assert.match(src, /Avançadas/);
    assert.match(src, /Implantação/);
    assert.equal(/breadcrumb-item">Ferramentas</.test(src), false);
    assert.match(src, /registra o estoque inicial informado no arquivo/);
    assert.match(src, /Qtd\. Origem/);
    assert.match(src, /Estoque Inicial/);
  });

  it('mesma tela possui seletor Cadastro Inicial / Atualizar Quantidades', () => {
    const src = fs.readFileSync(path.join(root, 'frontend/erp/js/importacao-inicial-produtos.js'), 'utf8');
    assert.match(src, /btnModoCadastroInicial/);
    assert.match(src, /btnModoAtualizarQuantidades/);
    assert.match(src, /ATUALIZAÇÃO DE QUANTIDADES/);
    assert.match(src, /Registrar Quantidades/);
    assert.match(src, /Trocar o modo de importação/);
    assert.equal(/loadPage\('atualizar-quantidades'\)/.test(src), false);
  });

  it('acesso à página exige super admin (mesmo gate de Avançadas)', () => {
    const src = fs.readFileSync(path.join(root, 'frontend/shared/js/access-control.js'), 'utf8');
    assert.match(src, /importacao-inicial-produtos/);
    const bloco = src.match(/if \(page === 'configuracoes-avancadas'[\s\S]*?return isSuperAdminUser\(\);/);
    assert.ok(bloco, 'bloco super admin não encontrado');
    assert.match(bloco[0], /importacao-inicial-produtos/);
  });
});
