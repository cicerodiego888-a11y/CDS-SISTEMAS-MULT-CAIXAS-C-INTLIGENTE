'use strict';

/**
 * Microsprint 1 — quantidade fracionada preservada na inclusão no carrinho do PDV.
 * Executa adicionarItemNoCarrinho real (frontend/pdv/js/pdv.js) em vm, sem DOM e sem backend.
 */

const assert = require('node:assert/strict');
const { describe, it, beforeEach } = require('node:test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PDV_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend/pdv/js/pdv.js'), 'utf8');

function extrairFuncao(nome) {
  const m = new RegExp(`\\nfunction\\s+${nome}\\s*\\(`).exec(PDV_SRC);
  assert.ok(m, `função ${nome} não encontrada no pdv.js`);
  let i = m.index + m[0].length - 1;
  let parenteses = 0;
  for (; i < PDV_SRC.length; i += 1) {
    if (PDV_SRC[i] === '(') parenteses += 1;
    else if (PDV_SRC[i] === ')') { parenteses -= 1; if (parenteses === 0) break; }
  }
  const abre = PDV_SRC.indexOf('{', i);
  let profundidade = 0;
  let modo = null;
  for (let j = abre; j < PDV_SRC.length; j += 1) {
    const c = PDV_SRC[j];
    if (modo) {
      if (modo === '//') { if (c === '\n') modo = null; continue; }
      if (modo === '/*') { if (c === '/' && PDV_SRC[j - 1] === '*') modo = null; continue; }
      if (c === '\\') { j += 1; continue; }
      if (c === modo) modo = null;
      continue;
    }
    if (c === '/' && PDV_SRC[j + 1] === '/') { modo = '//'; j += 1; continue; }
    if (c === '/' && PDV_SRC[j + 1] === '*') { modo = '/*'; j += 1; continue; }
    if (c === "'" || c === '"' || c === '`') { modo = c; continue; }
    if (c === '{') profundidade += 1;
    else if (c === '}') {
      profundidade -= 1;
      if (profundidade === 0) return PDV_SRC.slice(m.index + 1, j + 1);
    }
  }
  throw new Error(`fim da função ${nome} não encontrado`);
}

const FUNCOES_REAIS = [
  'adicionarItemNoCarrinho',
  'normalizarTipoVendaItem', 'tipoVendaEhUnidade', 'itemVendaPorUnidade', 'obterQuantidadeEstoqueParaVenda',
  'unidadeEhKg', 'produtoUsaConversaoUnidadesPdv', 'quantidadeUsaDecimaisPdv',
  'parseQuantidadePdv', 'normalizarQuantidadePdv', 'normalizarQuantidadeEtiquetaPdv',
  'formatarQuantidadePdv', 'round3TransferenciaPdv'
];

function criarPdv() {
  const estado = { quantidadesValidadasEstoque: [], notificacoes: [] };
  const ctx = {
    console, Math, Number, String, Object, Array, Date, isFinite, parseFloat,
    carrinho: [],
    showNotification: (msg, tipo) => estado.notificacoes.push({ msg, tipo }),
    pdvObterModoComposicaoItens: () => 'UNIFICAR',
    pdvAnalisarTransferenciaEstoque: () => ({ devePerguntar: false, podeTransferir: false, quantidadeTransferir: 0 }),
    pdvModoFiscalAtivo: () => false,
    pdvDeveInformarNcm: () => false,
    pdvSaldosComTransferenciasPendentes: () => ({}),
    pdvValidarEstoqueVenda: (_produto, qtd) => {
      estado.quantidadesValidadasEstoque.push(qtd);
      return { semSaldoTotal: false, confirmarSemEstoque: false };
    },
    pdvNotificarEstoqueInsuficiente: () => true,
    motorPrecoAtacadoDisponivel: () => false,
    obterPrecoAtacado: () => { throw new Error('atacado fora do escopo do teste'); },
    destacarLinhaCarrinho() {}, atualizarCarrinho() {}, focarCampoCodigo() {},
    nomeExibicaoProdutoConsultaPdv: (p) => p.nome
  };
  ctx.window = ctx;
  vm.createContext(ctx);

  const constantes = [];
  const reConst = /\nconst (TIPO_VENDA_\w+) = ([^;\n]+);/g;
  let m;
  while ((m = reConst.exec(PDV_SRC)) !== null) constantes.push(`var ${m[1]} = ${m[2]};`);
  assert.ok(constantes.length >= 2, 'constantes TIPO_VENDA_* não encontradas');

  vm.runInContext([...constantes, ...FUNCOES_REAIS.map(extrairFuncao)].join('\n\n'), ctx, {
    filename: 'pdv-adicionar-item.js'
  });
  return { ctx, estado };
}

/** Mesma entrada do modal de quantidade: texto digitado → parse → adicionarItemNoCarrinho. */
function adicionar(pdv, produto, quantidadeDigitada, opcoes = {}) {
  const qtd = pdv.ctx.parseQuantidadePdv(quantidadeDigitada);
  pdv.ctx.adicionarItemNoCarrinho(produto, qtd, Number(produto.preco_venda), '', null, opcoes);
}

const KG = { id: 1, nome: 'PRODUTO KG', unidade: 'KG', preco_venda: 12.99 };
const FRACIONADO_UN = { id: 2, nome: 'FRACIONADO CADASTRO', unidade: 'UN', produto_fracionado: 1, preco_venda: 5 };
const UN = { id: 3, nome: 'PRODUTO UN', unidade: 'UN', preco_venda: 7.99 };
const POR_UNIDADE = {
  id: 4, nome: 'KG VENDIDO POR UNIDADE', unidade: 'KG', preco_venda: 10.48,
  preco_unidade: 3.49, peso_medio_unidade: 0.333
};

describe('Microsprint 1 — quantidade fracionada preservada no carrinho do PDV', () => {
  let pdv;
  beforeEach(() => { pdv = criarPdv(); });

  it('10,567 kg digitado continua 10,567 no carrinho (não vira 10,57)', () => {
    adicionar(pdv, KG, '10,567');
    assert.equal(pdv.ctx.carrinho.length, 1);
    assert.equal(pdv.ctx.carrinho[0].quantidade, 10.567);
    assert.notEqual(pdv.ctx.carrinho[0].quantidade, 10.57);
    assert.equal(pdv.ctx.formatarQuantidadePdv(pdv.ctx.carrinho[0].quantidade, KG), '10,567');
  });

  it('validação de estoque recebe 10,567 (quantidade prevista com 3 casas)', () => {
    adicionar(pdv, KG, '10,567');
    assert.deepEqual(pdv.estado.quantidadesValidadasEstoque, [10.567]);
  });

  it('inclusão repetida do mesmo produto soma com 3 casas (10,567 + 0,001 = 10,568)', () => {
    adicionar(pdv, KG, '10,567');
    adicionar(pdv, KG, '0,001');
    assert.equal(pdv.ctx.carrinho.length, 1);
    assert.equal(pdv.ctx.carrinho[0].quantidade, 10.568);
    // 2ª inclusão valida antes de unificar e de novo ao somar na linha existente
    assert.deepEqual(pdv.estado.quantidadesValidadasEstoque, [10.567, 10.568, 10.568]);
  });

  it('produto com flag de fracionado (unidade UN) preserva 0,375', () => {
    adicionar(pdv, FRACIONADO_UN, '0,375');
    assert.equal(pdv.ctx.carrinho[0].quantidade, 0.375);
    assert.equal(pdv.ctx.formatarQuantidadePdv(pdv.ctx.carrinho[0].quantidade, FRACIONADO_UN), '0,375');
  });

  it('produto UN continua inteiro (3 → 3; 2,6 → 3) e exibido sem decimais', () => {
    adicionar(pdv, UN, '3');
    assert.equal(pdv.ctx.carrinho[0].quantidade, 3);
    pdv.ctx.carrinho.length = 0;
    adicionar(pdv, UN, '2,6');
    assert.equal(pdv.ctx.carrinho[0].quantidade, 3);
    assert.equal(pdv.ctx.formatarQuantidadePdv(pdv.ctx.carrinho[0].quantidade, UN), '3');
  });

  it('venda por unidade de produto KG continua inteira', () => {
    adicionar(pdv, POR_UNIDADE, '3', { tipo_venda: pdv.ctx.TIPO_VENDA_UNIDADE });
    assert.equal(pdv.ctx.carrinho[0].quantidade, 3);
    assert.equal(pdv.ctx.carrinho[0].tipo_venda, pdv.ctx.TIPO_VENDA_UNIDADE);
  });

  it('etiqueta de balança mantém 3 casas (comportamento já existente)', () => {
    pdv.ctx.adicionarItemNoCarrinho(KG, 0.598, 12.99, '', null, { etiquetaBalanca: { subtotalFixo: 7.77 } });
    assert.equal(pdv.ctx.carrinho[0].quantidade, 0.598);
  });

  it('fluxo de inclusão não reduz quantidade a 2 casas', () => {
    const fonte = extrairFuncao('adicionarItemNoCarrinho');
    assert.doesNotMatch(fonte, /[Qq]uantidade\w*\.toFixed\(2\)/);
  });
});
