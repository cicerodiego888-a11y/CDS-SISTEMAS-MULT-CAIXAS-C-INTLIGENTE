/**
 * Sprint 7.1 — otimização controlada da listagem ERP de Produtos.
 * node --test tests/produtos/sprint71-otimizacao-lista.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const PRODUTOS = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produtos.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/app.js'), 'utf8');
const CORE = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/core.js'), 'utf8');
const MODO = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/modoFiscalHelpers.js'), 'utf8');
const IMPORTACAO = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/importacao-inicial-produtos.js'), 'utf8');
const BACKEND = fs.readFileSync(path.join(ROOT, 'backend/rotas/produtos.js'), 'utf8');
const CTX = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/core/UIRequestContext.js'), 'utf8');

function trechoLoadProdutos() {
  const m = PRODUTOS.match(/function loadProdutos\([^)]*\)[\s\S]*?window\.loadProdutos = loadProdutos;/);
  assert.ok(m, 'loadProdutos não encontrado');
  return m[0];
}

describe('Sprint 7.1 — classificação e reuso do catálogo', () => {
  it('reclique/retorno reutiliza sessão sem GET quando o catálogo é válido', () => {
    const fn = trechoLoadProdutos();
    assert.match(fn, /catalogoProdutosSessaoValido/);
    assert.match(fn, /catalog-reuse/);
    assert.match(fn, /return\s+\$\.ajax\s*\(/);
    assert.match(fn, /\/produtos\?modo_fiscal=/);
    assert.match(fn, /atualizarListagemProdutosSemRemontarShell/);
    assert.match(fn, /renderProdutos\s*\(\s*(window\.)?produtosList/);
  });

  it('app.js continua chamando loadProdutos() na abertura (reuso é interno)', () => {
    assert.match(APP, /case 'produtos':/);
    assert.match(APP, /loadProdutos\(\)/);
  });

  it('F12 e modo fiscal forçam GET porque o conjunto fiscal muda', () => {
    assert.match(CORE, /motivo:\s*'f12-sync'/);
    assert.match(CORE, /forcar:\s*true/);
    assert.match(MODO, /motivo:\s*'modo-fiscal'/);
    assert.match(MODO, /forcar:\s*true/);
  });

  it('importação inicial continua recarregando o catálogo completo', () => {
    assert.match(IMPORTACAO, /loadProdutos\(\s*\{\s*forcar:\s*true/);
  });

  it('save/delete/ajuste preferem atualização local', () => {
    assert.match(PRODUTOS, /aplicarAtualizacaoLocalCatalogoProdutos\(window\.produtosList, \{[\s\S]*?motivo:\s*'save'/);
    assert.match(PRODUTOS, /removerProdutoDoCatalogoLocal\(id\)/);
    assert.match(PRODUTOS, /motivo: 'delete'/);
    assert.match(PRODUTOS, /motivo: 'ajuste'/);
    assert.match(PRODUTOS, /\/produtos\/\$\{produtoId\}\?modo_fiscal=/);
    const deleteBloco = PRODUTOS.slice(PRODUTOS.indexOf('function deleteProduto'));
    assert.equal(/loadProdutos\(\s*\)/.test(deleteBloco.slice(0, 800)), false);
  });
});

describe('Sprint 7.1 — árvore, DOM e debounce', () => {
  it('montarArvoreProdutos reutiliza cache da mesma lista', () => {
    assert.match(PRODUTOS, /__cdsProdutosArvoreCache/);
    assert.match(PRODUTOS, /tree-cache-hit/);
    assert.match(PRODUTOS, /produtos:tree-build/);
  });

  it('substituição de HTML usa UISoftRefresh quando disponível', () => {
    assert.match(PRODUTOS, /function substituirHtmlListagemProdutos/);
    assert.match(PRODUTOS, /UISoftRefresh\.replaceHtml/);
    assert.match(PRODUTOS, /substituirHtmlListagemProdutos\(\$container\[0\]/);
  });

  it('não altera debounce MIB 180 ms', () => {
    assert.match(PRODUTOS, /debounceOperacionalMs:\s*180/);
    assert.match(PRODUTOS, /CDS_PRODUTOS_BUSCA_MIB\.debounceOperacionalMs \|\| 180/);
  });

  it('cancela busca ao sair da página sem mudar o debounce', () => {
    assert.match(PRODUTOS, /onPageLeave\('produtos'/);
    assert.match(PRODUTOS, /cancelarBuscaProdutosMib\(\)/);
  });

  it('não evicta UIRequestContext', () => {
    assert.equal(CTX.includes('_requests.delete'), false);
    assert.match(CTX, /retained:\s*_requests\.size/);
  });
});

describe('Sprint 7.1 — payload do endpoint permanece completo', () => {
  it('GET / não ganhou LIMIT nem projeção nova', () => {
    const getLista = BACKEND.slice(BACKEND.indexOf("router.get('/', (req, res) => {"));
    const bloco = getLista.slice(0, 1800);
    assert.match(bloco, /SELECT\s+[\s\S]*p\.\*/);
    assert.equal(/\bLIMIT\s+\d+\s+OFFSET\b/i.test(bloco), false);
    assert.equal(/\breq\.query\.(page|limit|offset)\b/.test(bloco), false);
  });

  it('documenta campos da listagem versus edição (sem remover)', () => {
    const listagem = ['id', 'nome', 'codigo', 'categoria', 'unidade', 'preco_compra', 'preco_venda', 'saldo_fiscal', 'saldo_nao_fiscal', 'estoque_atual', 'plu'];
    listagem.forEach((campo) => {
      assert.match(PRODUTOS, new RegExp(campo));
    });
    assert.match(BACKEND, /ncm|cfop|csosn|imagem_principal|observacoes/);
  });
});
