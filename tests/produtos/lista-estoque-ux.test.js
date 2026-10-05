'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const PRODUTOS_JS = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produtos.js'), 'utf8');

function corpoFuncao(src, nome) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${nome}\\s*\\([^)]*\\)\\s*\\{`);
  const match = src.match(re);
  assert.ok(match, `função ${nome} não encontrada`);
  const start = match.index;
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`corpo de ${nome} incompleto`);
}

function renderColuna(modoFiscal) {
  const fnSrc = corpoFuncao(PRODUTOS_JS, 'formatarColunaEstoqueLista');
  const ctx = {
    estoqueCadastroSomenteFiscal: () => modoFiscal === true,
    produtoUsaConversaoUnidades: () => false,
    formatarEstoqueProduto: (valor, unidade = '') => `${Math.round(Number(valor || 0))} ${String(unidade || 'UN').toUpperCase()}`
  };
  vm.createContext(ctx);
  vm.runInContext(`${fnSrc}; this._fn = formatarColunaEstoqueLista;`, ctx);
  return ctx._fn({
    saldo_fiscal: 20,
    saldo_nao_fiscal: 5,
    estoque_atual: 25,
    unidade: 'KG',
    reservado_fiscal: 3,
    reservado_nao_fiscal: 1
  });
}

function compactar(html) {
  return String(html || '').replace(/\s+/g, ' ').trim();
}

describe('Lista de produtos — nova exibição de estoque', () => {
  it('F12 OFF renderiza total + A/B e não usa a apresentação técnica', () => {
    const html = compactar(renderColuna(false));
    assert.match(html, /25 KG/);
    assert.match(html, /A:\s*20 KG/);
    assert.match(html, /B:\s*5 KG/);
    assert.doesNotMatch(html, /Fiscal:/);
    assert.doesNotMatch(html, /Não Fiscal:/);
    assert.doesNotMatch(html, /Res\. F:/);
    assert.doesNotMatch(html, /Res\. NF:/);
    assert.doesNotMatch(html, /Disp\. F:/);
    assert.doesNotMatch(html, /Disp\. NF:/);
    assert.doesNotMatch(html, /Res\. Σ:/);
    assert.doesNotMatch(html, /Disp\. Σ:/);
    assert.doesNotMatch(html, /formatarEstoqueCompletoProduto/);
  });

  it('F12 ON renderiza somente saldo_fiscal, sem B nem reservas', () => {
    const html = compactar(renderColuna(true));
    assert.match(html, /20 KG/);
    assert.doesNotMatch(html, /25 KG/);
    assert.doesNotMatch(html, /5 KG/);
    assert.doesNotMatch(html, /\bA:/);
    assert.doesNotMatch(html, /\bB:/);
    assert.doesNotMatch(html, /Fiscal:/);
    assert.doesNotMatch(html, /Não Fiscal:/);
    assert.doesNotMatch(html, /Res\. F:/);
    assert.doesNotMatch(html, /Res\. NF:/);
    assert.doesNotMatch(html, /Disp\. F:/);
    assert.doesNotMatch(html, /Disp\. NF:/);
    assert.doesNotMatch(html, /Res\. Σ:/);
    assert.doesNotMatch(html, /Disp\. Σ:/);
  });

  it('cabeçalho da lista permanece Estoque', () => {
    const titulo = corpoFuncao(PRODUTOS_JS, 'tituloColunaEstoqueLista');
    assert.match(titulo, /return 'Estoque'/);
    assert.doesNotMatch(titulo, /Estoque Fiscal/);
  });

  it('reservas e relatório permanecem nos respectivos contextos', () => {
    assert.match(PRODUTOS_JS, /function formatarEstoqueCompletoProduto/);
    assert.match(PRODUTOS_JS, /link-reservas-produto/);
    assert.match(PRODUTOS_JS, /function abrirModalReservasProduto/);
    const relatorio = corpoFuncao(PRODUTOS_JS, 'formatarColunaEstoqueRelatorio');
    assert.match(relatorio, /F \$\{formatarEstoqueProduto\(fiscal/);
    assert.match(relatorio, /NF \$\{formatarEstoqueProduto\(naoFiscal/);
  });

  it('lista não chama mais a apresentação completa de reservas', () => {
    const lista = corpoFuncao(PRODUTOS_JS, 'formatarColunaEstoqueLista');
    assert.doesNotMatch(lista, /formatarEstoqueCompletoProduto/);
    assert.match(lista, /estoqueCadastroSomenteFiscal\(\)/);
    assert.match(lista, /A:/);
    assert.match(lista, /B:/);
  });

  it('F12 altera a lista via recarga suave, sem location.reload', () => {
    const helpers = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/modoFiscalHelpers.js'), 'utf8');
    const core = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/core.js'), 'utf8');
    assert.match(PRODUTOS_JS, /function atualizarListagemProdutosAposModoFiscal/);
    assert.match(PRODUTOS_JS, /cds:modo-fiscal-alterado/);
    assert.doesNotMatch(PRODUTOS_JS, /location\.reload/);
    assert.match(helpers, /atualizarListagemProdutosAposModoFiscal/);
    assert.doesNotMatch(helpers, /somenteCache:\s*true/);
    assert.match(core, /function emitirEventoModoFiscalAlterado/);
    const legado = corpoFuncao(core, 'alternarModoFiscalLegadoSessao');
    assert.match(legado, /recarregarModulosModoFiscal/);
    assert.doesNotMatch(legado, /location\.reload/);
  });
});
