/**
 * Sprint 3.3 — exibição "NOME — MARCA" no Cadastro de Produtos e no PDV.
 * Regra comum: CdsBuscaProdutoTexto.formatarNomeProdutoComMarca (só apresentação).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const srcBuscaTexto = ler('frontend/shared/js/buscaProdutoTexto.js');
const srcPdvBusca = ler('frontend/shared/js/pdvBuscaProduto.js');
const srcPdv = ler('frontend/pdv/js/pdv.js');
const srcProdutos = ler('frontend/erp/js/produtos.js');

function extrair(src, inicio, fim) {
  const a = src.indexOf(inicio);
  const b = src.indexOf(fim, a);
  if (a < 0 || b < 0) throw new Error(`Trecho não encontrado: ${inicio}`);
  return src.slice(a, b);
}

const escapeHtml = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function carregarAmbiente(catalogo = []) {
  const sandbox = {
    console,
    escapeHtml,
    formatCurrency: (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`,
    produtosDisponiveis: catalogo,
    produtosCache: catalogo
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(srcBuscaTexto, sandbox);
  vm.runInContext(srcPdvBusca, sandbox);
  vm.runInContext(
    extrair(srcPdv, 'function nomeExibicaoProdutoConsultaPdv', 'function montarLinhaProdutoConsultaPDV'),
    sandbox
  );
  vm.runInContext(
    extrair(srcProdutos, 'function nomeExibicaoProdutoErp', 'function expandirNosArvoreParaLista'),
    sandbox
  );
  return sandbox;
}

const amb = carregarAmbiente();
const fmt = amb.CdsBuscaProdutoTexto.formatarNomeProdutoComMarca;

describe('Sprint 3.3 — regra NOME — MARCA', () => {
  it('1. produto com marca: NOME — MARCA', () => {
    assert.equal(fmt({ nome: 'TRENA 5 METROS', marca: 'STARRETT' }), 'TRENA 5 METROS — STARRETT');
    assert.equal(fmt({ nome: 'TRENA 5 METROS', marca_nome: 'STARRETT' }), 'TRENA 5 METROS — STARRETT');
    assert.equal(fmt('TRENA 5 METROS', 'STARRETT'), 'TRENA 5 METROS — STARRETT');
  });

  it('2. produto sem marca: só o nome, sem "SEM MARCA" automático', () => {
    assert.equal(fmt({ nome: 'TRENA 5 METROS' }), 'TRENA 5 METROS');
    assert.equal(fmt({ nome: 'TRENA 5 METROS', marca: '' }), 'TRENA 5 METROS');
    assert.equal(fmt({ nome: 'TRENA 5 METROS', marca: null }), 'TRENA 5 METROS');
    for (const marcador of ['-', 'NA', 'n/a', 'SEM MARCA', 's/m']) {
      assert.equal(fmt({ nome: 'TRENA 5 METROS', marca: marcador }), 'TRENA 5 METROS', marcador);
    }
    assert.doesNotMatch(srcBuscaTexto, /return\s+[^;]*['"`]SEM MARCA/i);
  });

  it('3. marca já no final do nome não é repetida', () => {
    assert.equal(fmt({ nome: 'TRENA 5 METROS STARRETT', marca: 'STARRETT' }), 'TRENA 5 METROS STARRETT');
    assert.equal(fmt({ nome: 'Pedra Sanitária Lavanda 25g Q-odor', marca: 'Q-odor' }), 'Pedra Sanitária Lavanda 25g Q-odor');
  });

  it('4. marca em outra posição do nome (início ou meio) não é repetida; trecho parcial não conta', () => {
    assert.equal(fmt({ nome: 'STARRETT TRENA 5 METROS', marca: 'STARRETT' }), 'STARRETT TRENA 5 METROS');
    assert.equal(
      fmt({ nome: 'Desinfetante Unic Limp fragrância Citros 2 L', marca: 'Unic Limp' }),
      'Desinfetante Unic Limp fragrância Citros 2 L'
    );
    assert.equal(
      fmt({ nome: 'Ração Úmida Pedigree para Cães Filhotes — Carne ao Molho', marca: 'Pedigree' }),
      'Ração Úmida Pedigree para Cães Filhotes — Carne ao Molho'
    );
    assert.equal(fmt({ nome: 'ARROZ TIOZINHO 5KG', marca: 'TIO' }), 'ARROZ TIOZINHO 5KG — TIO');
  });

  it('5. diferença de caixa, acentos e espaços extras não gera duplicação', () => {
    assert.equal(fmt({ nome: 'trena 5 metros starrett', marca: '  STARRETT ' }), 'trena 5 metros starrett');
    assert.equal(fmt({ nome: 'SHAMPOO TRESEMME 400ML', marca: 'TRESemmé' }), 'SHAMPOO TRESEMME 400ML');
    assert.equal(fmt({ nome: 'DESINF UNIC   LIMP 2L', marca: 'Unic  Limp' }), 'DESINF UNIC   LIMP 2L');
    assert.equal(fmt({ nome: '  TRENA 5 METROS  ', marca: ' Starrett  Tools ' }), 'TRENA 5 METROS — Starrett Tools');
  });

  it('6 e 7. busca pelo nome original e pela marca continua encontrando o produto', () => {
    const p = { id: 7, nome: 'TRENA 5 METROS', marca: 'STARRETT', plu: '123', codigo: 'INT-9', codigo_barras: '7891234567895' };
    const busca = amb.CdsBuscaProdutoTexto.produtoCorrespondeBuscaNome;
    assert.equal(busca(p, 'trena 5 metros'), true);
    assert.equal(busca(p, 'TRENA'), true);
    assert.equal(busca(p, 'starrett'), true);
    assert.equal(busca(p, 'trena starrett'), true);
    assert.equal(busca(p, '123'), true);
    assert.equal(busca(p, '7891234567895'), true);
    assert.equal(busca({ ...p, marca: undefined, marca_nome: 'STARRETT' }, 'starrett'), true);
    const pdvTermo = amb.PdvBuscaProduto._test.produtoCorrespondeAoTermo;
    assert.equal(pdvTermo(p, 'trena'), true);
    assert.equal(pdvTermo(p, 'starrett'), true);
  });

  it('8. PDV: autocomplete mostra NOME — MARCA sem mudar id, preço ou estoque; carrinho guarda o nome original', () => {
    const catalogo = [
      { id: 7, nome: 'TRENA 5 METROS', marca: 'STARRETT', preco_venda: 59.9, estoque_atual: 4, plu: '123' },
      { id: 8, nome: 'TRENA 3M', marca: '', preco_venda: 19.9, estoque_atual: 0, plu: '124' }
    ];
    const a = carregarAmbiente(catalogo);
    const render = a.PdvBuscaProduto._test.renderizarItemAutocomplete;

    const html = render(catalogo[0], 0);
    assert.match(html, /data-produto-id="7"/);
    assert.match(html, /<span class="pdv-autocomplete-nome">TRENA 5 METROS — STARRETT</);
    assert.match(html, /R\$ 59,90/);
    assert.doesNotMatch(html, /Verificar estoque/);
    assert.doesNotMatch(html, /pdv-autocomplete-marca/);

    const htmlSemEstoque = render(catalogo[1], 1);
    assert.match(htmlSemEstoque, /data-produto-id="8"/);
    assert.match(htmlSemEstoque, /<span class="pdv-autocomplete-nome">TRENA 3M <small[^>]*>Verificar estoque/);

    const item = { linha_id: 'L1', id: 7, nome: 'TRENA 5 METROS', quantidade: 2, preco_unitario: 59.9 };
    const antes = JSON.stringify(item);
    assert.equal(a.nomeExibicaoProdutoConsultaPdv(item), 'TRENA 5 METROS — STARRETT');
    assert.equal(JSON.stringify(item), antes, 'item do carrinho não pode ser alterado');

    const criacaoItem = extrair(srcPdv, 'id: produto.id,', 'desconto_percentual: 0,');
    assert.match(criacaoItem, /nome: produto\.nome,/);
    assert.doesNotMatch(srcPdv, /nome:\s*nomeExibicao/);
    const linhaCarrinho = extrair(srcPdv, 'const nomeExibicaoItem', '<td class="col-unit">');
    assert.match(linhaCarrinho, /<span class="pdv-produto-nome">\$\{escapeHtml\(nomeExibicaoItem\)\}<\/span>/);
    assert.match(linhaCarrinho, /data-item-index="\$\{index\}"/);
  });

  it('9. nenhum produto recebe marca duplicada (aplicar a regra de novo não muda o texto)', () => {
    const casos = [
      { nome: 'TRENA 5 METROS', marca: 'STARRETT' },
      { nome: 'TRENA 5 METROS — STARRETT', marca: 'STARRETT' },
      { nome: 'Pedra Sanitária Lavanda 25g Q-odor', marca: 'Q-odor' },
      { nome: 'Desinfetante Unic Limp fragrância Citros 2 L', marca: 'Unic Limp' },
      { nome: 'SHAMPOO 400ML', marca: 'TRESemmé' },
      { nome: 'FITA ISOLANTE 3M 20M', marca: '3M' }
    ];
    for (const p of casos) {
      const uma = fmt(p);
      assert.equal(fmt({ nome: uma, marca: p.marca }), uma, p.nome);
      assert.equal(amb.PdvBuscaProduto.nomeExibicaoProdutoPdv({ nome: uma, marca: p.marca }), uma, p.nome);
      const ocorrencias = uma.toUpperCase().split(' — ' + p.marca.toUpperCase()).length - 1;
      assert.ok(ocorrencias <= 1, p.nome);
    }
  });

  it('10. Produtos (ERP) e PDV usam a mesma regra; ERP não altera o nome do formulário', () => {
    const catalogo = [
      { id: 1, nome: 'TRENA 5 METROS', marca: 'STARRETT', plu: '55' },
      { id: 2, nome: 'Pedra Sanitária Lavanda 25g Q-odor', marca: 'Q-odor' },
      { id: 3, nome: 'TRENA 3M', marca: '' },
      { id: 4, nome: 'A & B <teste>', marca: 'X&Y' }
    ];
    const a = carregarAmbiente(catalogo);
    for (const p of catalogo) {
      const erp = a.nomeExibicaoProdutoErp(p);
      assert.equal(erp, a.PdvBuscaProduto.nomeExibicaoProdutoPdv(p), p.nome);
      assert.equal(erp, a.nomeExibicaoProdutoConsultaPdv(p), p.nome);
    }
    assert.equal(a.nomeExibicaoProdutoErp({ id: 1, nome: 'TRENA 5 METROS' }), 'TRENA 5 METROS — STARRETT');
    assert.equal(
      a.formatarNomeProdutoComPlu(catalogo[0]),
      '<span class="text-muted small me-1">[55]</span>TRENA 5 METROS — STARRETT'
    );
    assert.equal(a.formatarNomeProdutoComPlu(catalogo[3]), 'A &amp; B &lt;teste&gt; — X&amp;Y');

    assert.match(srcProdutos, /value="\$\{isEdit \? escapeHtml\(produto\.nome \|\| ''\) : ''\}"/);
    assert.match(srcProdutos, /<h1 class="nome">\$\{escapeHtml\(String\(produto\.nome \|\| ''\)\.trim\(\)\)\}<\/h1>/);
  });
});
