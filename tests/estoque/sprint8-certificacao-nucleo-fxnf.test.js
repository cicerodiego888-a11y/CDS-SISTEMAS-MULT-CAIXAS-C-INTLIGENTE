/**
 * Sprint 8 — Certificação do núcleo Fiscal × Não Fiscal (testes de mesa).
 * Motor central: backend/services/distribuidorEstoqueVenda.js.
 * O fallback local do PDV não pode decidir distribuição diferente da oficial.
 *
 * Executar: node --test tests/estoque/sprint8-certificacao-nucleo-fxnf.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const pdvSrc = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
const pagSrc = fs.readFileSync(path.join(ROOT, 'backend/services/vendas/VendaPagamentoService.js'), 'utf8');

const { distribuirItensVendaComValorFiscalEfetivo } = require('../../backend/services/distribuidorEstoqueVenda');
const { saldosDisponiveisMotorFxNf } = require('../../backend/services/estoque/EstoqueDisponivelService');
const { saldosParaDistribuicaoVenda } = require('../../backend/services/estoque/produtoControlaEstoque');
const { prepararEntradasMotorComTransferenciaPdv } = require('../../backend/services/estoque/transferenciaNaoFiscalParaFiscalPdv');
const { validarIdentidadeFinanceiraVenda } = require('../../backend/services/caixa/ValidacaoIdentidadeVenda');

const PRECO = 5.39;
const COMBINACOES = [
  { f12: false, semEstoque: false },
  { f12: true, semEstoque: false },
  { f12: false, semEstoque: true },
  { f12: true, semEstoque: true }
];

function extract(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Marcador não encontrado: ${startMarker}`);
  return src.slice(start, end);
}

let proximoId = 8000;
function produto(fiscal, naoFiscal, { itemFiscal = 1, controla = 1, resF = 0, resNF = 0 } = {}) {
  return {
    id: proximoId++,
    nome: 'Produto S8',
    categoria: 'Açougue',
    saldo_fiscal: fiscal,
    saldo_nao_fiscal: naoFiscal,
    estoque_atual: fiscal + naoFiscal,
    reservado_fiscal: resF,
    reservado_nao_fiscal: resNF,
    item_fiscal: itemFiscal,
    controla_estoque: controla
  };
}

function itemDe(p, qtd) {
  return {
    produto_id: p.id,
    quantidade: qtd,
    preco_unitario: PRECO,
    subtotal: Number((qtd * PRECO).toFixed(2)),
    unidade: 'UN'
  };
}

/** Mesmo caminho do pré-cálculo/finalização (VendaPagamentoService). */
function motor(linhas, { f12, semEstoque }) {
  const entradas = linhas.map(([p, qtd]) => {
    const disp = saldosDisponiveisMotorFxNf(p);
    const s = saldosParaDistribuicaoVenda(p, qtd, disp.saldoFiscal, disp.saldoNaoFiscal);
    return {
      item: itemDe(p, qtd),
      saldoFiscal: s.saldoFiscal,
      saldoNaoFiscal: s.saldoNaoFiscal,
      controlaEstoque: Number(p.controla_estoque) !== 0,
      itemFiscal: Number(p.item_fiscal || 0),
      produto: p
    };
  });
  const total = Number(entradas.reduce((a, e) => a + e.item.subtotal, 0).toFixed(2));
  const prep = prepararEntradasMotorComTransferenciaPdv(entradas, { permitido: false });
  const r = distribuirItensVendaComValorFiscalEfetivo(prep.entradas, f12, {
    pagamentos: [{ forma_pagamento: 'pix', valor: total }],
    midpAtivo: false,
    permitirVendaSemEstoque: semEstoque
  });
  r.identidade = r.sucesso
    ? validarIdentidadeFinanceiraVenda({
      total,
      valorFiscal: r.valorFiscalEfetivo,
      valorNaoFiscal: r.valorNaoFiscal,
      itens: entradas.map((e) => e.item),
      pagamentos: [{ forma_pagamento: 'pix', valor: total }],
      formaPagamento: 'pix'
    })
    : null;
  return r;
}

function carregarPdvLocal(semEstoque) {
  return new Function(`
    let produtosDisponiveis = [];
    function pdvPermitirVendaSemEstoque() { return ${semEstoque === true}; }
    function pdvResolverSaldosProduto(produto) {
      const a = Number(produto.saldo_fiscal ?? 0);
      const b = Number(produto.saldo_nao_fiscal ?? 0);
      return { saldo_fiscal: a, saldo_nao_fiscal: b, estoque_atual: a + b };
    }
    ${extract(pdvSrc, 'function pdvCategoriaElegivelVendaSemEstoque', 'function validarEstoqueVenda')}
    ${extract(pdvSrc, 'function distribuirQuantidadeVendaLocal', 'async function precalcularDistribuicaoFiscalVenda')}
    ${extract(pdvSrc, 'function round3TransferenciaPdv', 'function pdvSaldosComTransferenciasPendentes')}
    ${extract(pdvSrc, 'function produtoControlaEstoquePdv', 'function formatarSaldoPdvMensagem')}
    return { setCatalogo(l) { produtosDisponiveis = l; }, calcularDistribuicaoFiscalLocal };
  `)();
}

function local(linhas, { f12, semEstoque }) {
  const pdv = carregarPdvLocal(semEstoque);
  pdv.setCatalogo(linhas.map(([p]) => p));
  return pdv.calcularDistribuicaoFiscalLocal(
    linhas.map(([p, qtd]) => ({ produto_id: p.id, quantidade: qtd, preco_unitario: PRECO })),
    f12
  );
}

/** Executa a baixa real (reduzirEstoqueDistribuido) e aplica os UPDATEs de saldo por natureza. */
async function baixar(p, qF, qNF) {
  const chamadas = [];
  const fn = new Function('db', 'require', 'reduzirEstoqueComFEFO', `
    ${extract(pagSrc, 'function reduzirEstoqueDistribuido(', 'function atualizarStatusPagamentoVenda')}
    return reduzirEstoqueDistribuido;
  `)(
    { get: (_sql, _params, cb) => cb(null, { controla_estoque: p.controla_estoque }) },
    () => ({ produtoControlaEstoque: (row) => Number(row.controla_estoque) !== 0 }),
    (_vid, _pid, qtd, itemFiscal, cb) => { chamadas.push({ qtd, itemFiscal }); cb(null); }
  );
  await new Promise((resolve, reject) => fn(1, p.id, qF, qNF, (e) => (e ? reject(e) : resolve())));
  let fiscal = p.saldo_fiscal;
  let naoFiscal = p.saldo_nao_fiscal;
  for (const c of chamadas) {
    if (c.itemFiscal === 1) fiscal -= c.qtd;
    else naoFiscal -= c.qtd;
  }
  return { fiscal, naoFiscal, chamadas };
}

function qtds(r, idx = 0) {
  return [r.itens[idx].quantidade_fiscal, r.itens[idx].quantidade_nao_fiscal];
}

function valores(r, idx = 0) {
  return [r.itens[idx].valor_fiscal, r.itens[idx].valor_nao_fiscal];
}

const rotulo = ({ f12, semEstoque }) => `F12 ${f12 ? 'ON' : 'OFF'} / sem estoque ${semEstoque ? 'ON' : 'OFF'}`;

describe('Sprint 8 — CASO OURO: F=1 NF=1 comprometido=0 Q=2', () => {
  for (const ctx of COMBINACOES) {
    it(`${rotulo(ctx)} → 1F + 1NF, 5,39 / 5,39, total 10,78; baixa F 1→0 e NF 1→0`, async () => {
      const p = produto(1, 1);
      const r = motor([[p, 2]], ctx);
      assert.equal(r.sucesso, true);
      assert.deepEqual(qtds(r), [1, 1]);
      assert.deepEqual(valores(r), [5.39, 5.39]);
      assert.equal(r.totalVenda, 10.78);
      assert.equal(r.identidade.ok, true);

      const b = await baixar(p, ...qtds(r));
      assert.deepEqual([b.fiscal, b.naoFiscal], [0, 0]);

      const l = local([[p, 2]], ctx);
      assert.equal(l.sucesso, true);
      assert.deepEqual([l.itens[0].quantidade_fiscal, l.itens[0].quantidade_nao_fiscal], [1, 1]);
    });
  }
});

describe('Sprint 8 — testes de mesa do contrato F×NF', () => {
  it('#2 somente Fiscal F1 NF0 Q1 → 1F + 0NF; baixa F 1→0', async () => {
    for (const ctx of COMBINACOES) {
      const p = produto(1, 0);
      const r = motor([[p, 1]], ctx);
      assert.deepEqual(qtds(r), [1, 0], rotulo(ctx));
      const b = await baixar(p, ...qtds(r));
      assert.deepEqual([b.fiscal, b.naoFiscal], [0, 0]);
    }
  });

  it('#3 somente Não Fiscal F0 NF1 Q1 → 0F + 1NF; baixa NF 1→0', async () => {
    for (const ctx of COMBINACOES) {
      const p = produto(0, 1);
      const r = motor([[p, 1]], ctx);
      assert.deepEqual(qtds(r), [0, 1], rotulo(ctx));
      const b = await baixar(p, ...qtds(r));
      assert.deepEqual([b.fiscal, b.naoFiscal], [0, 0]);
    }
  });

  it('#4/#13 produto Não Fiscal (item_fiscal=0) F0 NF1 Q1 → 0F + 1NF (nunca promovido)', () => {
    for (const ctx of COMBINACOES) {
      const r = motor([[produto(0, 1, { itemFiscal: 0 }), 1]], ctx);
      assert.deepEqual(qtds(r), [0, 1], rotulo(ctx));
    }
  });

  it('#5/#10 venda mista: fiscal (F1) + não fiscal (item_fiscal=0, NF1) não misturam naturezas', () => {
    for (const ctx of COMBINACOES) {
      const r = motor([[produto(1, 0), 1], [produto(0, 1, { itemFiscal: 0 }), 1]], ctx);
      assert.equal(r.sucesso, true);
      assert.deepEqual(qtds(r, 0), [1, 0], rotulo(ctx));
      assert.deepEqual(qtds(r, 1), [0, 1], rotulo(ctx));
      assert.equal(r.valorFiscalEfetivo, 5.39);
      assert.equal(r.valorNaoFiscal, 5.39);
      assert.equal(r.identidade.ok, true);
    }
  });

  it('#6 F2 NF3 Q5 → 2F + 3NF', () => {
    for (const ctx of COMBINACOES) {
      assert.deepEqual(qtds(motor([[produto(2, 3), 5]], ctx)), [2, 3], rotulo(ctx));
    }
  });

  it('#7 F2 NF3 com F12 ON (prioriza fiscal): Q4 → 2/2, Q2 → 2/0, Q1 → 1/0', () => {
    const ctx = { f12: true, semEstoque: false };
    assert.deepEqual(qtds(motor([[produto(2, 3), 4]], ctx)), [2, 2]);
    assert.deepEqual(qtds(motor([[produto(2, 3), 2]], ctx)), [2, 0]);
    assert.deepEqual(qtds(motor([[produto(2, 3), 1]], ctx)), [1, 0]);
  });

  it('#7 F2 NF3 com F12 OFF (política existente: prioriza não fiscal): Q4 → 1/3, Q2 → 0/2, Q1 → 0/1', () => {
    const ctx = { f12: false, semEstoque: false };
    assert.deepEqual(qtds(motor([[produto(2, 3), 4]], ctx)), [1, 3]);
    assert.deepEqual(qtds(motor([[produto(2, 3), 2]], ctx)), [0, 2]);
    assert.deepEqual(qtds(motor([[produto(2, 3), 1]], ctx)), [0, 1]);
  });

  it('#8 estoque chega a zero, sem piso artificial de 1', async () => {
    const p1 = produto(1, 0);
    const b1 = await baixar(p1, ...qtds(motor([[p1, 1]], { f12: true, semEstoque: false })));
    assert.equal(b1.fiscal, 0);
    const p2 = produto(1, 1);
    const b2 = await baixar(p2, ...qtds(motor([[p2, 2]], { f12: false, semEstoque: false })));
    assert.deepEqual([b2.fiscal, b2.naoFiscal], [0, 0]);
    assert.doesNotMatch(
      extract(pagSrc, 'function atualizarSaldoProdutoAposBaixa(', 'function reduzirEstoqueComFEFO('),
      /Math\.max|CASE WHEN|\|\|\s*1/
    );
  });

  it('#12/#23 controla_estoque=0 item_fiscal=0 saldo 0: 0F + 1NF, sem baixa e sem saldo negativo (vendas repetidas)', async () => {
    const p = produto(0, 0, { itemFiscal: 0, controla: 0 });
    for (let venda = 0; venda < 2; venda += 1) {
      const r = motor([[p, 1]], { f12: true, semEstoque: false });
      assert.deepEqual(qtds(r), [0, 1]);
      const b = await baixar(p, ...qtds(r));
      assert.deepEqual(b.chamadas, []);
      assert.deepEqual([b.fiscal, b.naoFiscal], [0, 0]);
    }
  });

  it('#15 E-Comprometido: F1 NF1 comprometido NF1 → disponível F1 NF0; Q1 → 1F + 0NF; comprometido intacto', async () => {
    for (const ctx of COMBINACOES) {
      const p = produto(1, 1, { resNF: 1 });
      const r = motor([[p, 1]], ctx);
      assert.deepEqual(qtds(r), [1, 0], rotulo(ctx));
      const b = await baixar(p, ...qtds(r));
      assert.equal(b.naoFiscal, 1);
    }
  });

  it('#18 excedente F2 NF3 Q10 sem estoque ON: as 5 unidades disponíveis mantêm natureza (2F + 3NF) antes do excedente', () => {
    for (const f12 of [false, true]) {
      const r = motor([[produto(2, 3), 10]], { f12, semEstoque: true });
      assert.equal(r.itens[0].quantidade_nao_fiscal, 3);
      assert.equal(r.itens[0].quantidade_fiscal, 7, '2 disponíveis + 5 de excedente (item_fiscal=1)');
      assert.equal(r.identidade.ok, true);
    }
  });
});

describe('Sprint 8 — fallback local do PDV não decide distribuição diferente da oficial', () => {
  const casos = [
    ['F1 NF1 Q2', () => [[produto(1, 1), 2]]],
    ['F1 NF0 Q1', () => [[produto(1, 0), 1]]],
    ['F0 NF1 Q1', () => [[produto(0, 1), 1]]],
    ['F2 NF3 Q4', () => [[produto(2, 3), 4]]],
    ['misto', () => [[produto(1, 0), 1], [produto(0, 1, { itemFiscal: 0 }), 1]]],
    ['controla_estoque=0', () => [[produto(0, 0, { itemFiscal: 0, controla: 0 }), 1]]]
  ];
  for (const [nome, mk] of casos) {
    it(`paridade backend × local: ${nome}`, () => {
      for (const ctx of COMBINACOES) {
        const linhas = mk();
        const b = motor(linhas, ctx);
        const l = local(linhas, ctx);
        assert.equal(l.sucesso, b.sucesso, rotulo(ctx));
        l.itens.forEach((it, i) => {
          assert.deepEqual(
            [it.quantidade_fiscal, it.quantidade_nao_fiscal, it.valor_fiscal, it.valor_nao_fiscal],
            [b.itens[i].quantidade_fiscal, b.itens[i].quantidade_nao_fiscal, b.itens[i].valor_fiscal, b.itens[i].valor_nao_fiscal],
            `${nome} ${rotulo(ctx)}`
          );
        });
      }
    });
  }

  it('excedente da venda sem estoque: local não inventa distribuição (exige o motor oficial)', () => {
    for (const linhas of [[[produto(2, 3), 10]], [[produto(1, 1, { resNF: 1 }), 2]], [[produto(0, 0), 3]]]) {
      const l = local(linhas, { f12: true, semEstoque: true });
      assert.equal(l.sucesso, false);
      assert.match(l.error, /distribuição fiscal oficial/);
    }
  });

  it('flag OFF: local mantém o bloqueio "Saldo insuficiente"', () => {
    const l = local([[produto(2, 3), 10]], { f12: true, semEstoque: false });
    assert.equal(l.sucesso, false);
    assert.match(l.error, /Saldo insuficiente para .*Disponível: 5/);
  });
});
