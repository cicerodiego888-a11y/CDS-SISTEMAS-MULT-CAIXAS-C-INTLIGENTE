/**
 * Sprint 5 — Venda sem estoque no motor F×NF.
 * Sprint 7: o excedente segue item_fiscal (este produto: item_fiscal=1 → excedente fiscal).
 *
 * Executar: node --test tests/estoque/sprint5-venda-sem-estoque-excedente.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const pagSrc = fs.readFileSync(path.join(ROOT, 'backend/services/vendas/VendaPagamentoService.js'), 'utf8');

const { distribuirItensVendaComValorFiscalEfetivo } = require('../../backend/services/distribuidorEstoqueVenda');
const { saldosDisponiveisMotorFxNf } = require('../../backend/services/estoque/EstoqueDisponivelService');
const { saldosParaDistribuicaoVenda } = require('../../backend/services/estoque/produtoControlaEstoque');
const { creditarDisponibilidadeComReservaPedido } = require('../../backend/services/estoque/pedidoReservaPonteNucleo');
const { validarIdentidadeFinanceiraVenda } = require('../../backend/services/caixa/ValidacaoIdentidadeVenda');
const { buildNfeXml } = require('../../backend/services/fiscal/xmlBuilderNfeVenda');

const PRECO = 5;

function extract(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Marcador não encontrado: ${startMarker}`);
  return src.slice(start, end);
}

function produto(saldoA, saldoB, resA = 0, resB = 0) {
  return {
    id: 711,
    nome: 'Produto S5',
    saldo_fiscal: saldoA,
    saldo_nao_fiscal: saldoB,
    estoque_atual: saldoA + saldoB,
    reservado_fiscal: resA,
    reservado_nao_fiscal: resB,
    item_fiscal: 1,
    controla_estoque: 1
  };
}

function itemBase(qtd) {
  return {
    produto_id: 711,
    produto_nome: 'Produto S5',
    quantidade: qtd,
    preco_unitario: PRECO,
    subtotal: Number((qtd * PRECO).toFixed(2)),
    produto_ncm: '10063021',
    cfop: '5102',
    unidade: 'UN'
  };
}

/** Mesmo caminho de saldos da persistência (VendaPagamentoService). */
function saldosPersistencia(p, qtd) {
  const calcBase = saldosDisponiveisMotorFxNf(p).estoque;
  const calc = creditarDisponibilidadeComReservaPedido(calcBase, 0);
  return saldosParaDistribuicaoVenda(p, qtd, calc.disponivel_fiscal, calc.disponivel_nao_fiscal);
}

function motor(p, qtd, { f12, semEstoque }) {
  const s = saldosPersistencia(p, qtd);
  const item = itemBase(qtd);
  return distribuirItensVendaComValorFiscalEfetivo([{
    item,
    saldoFiscal: s.saldoFiscal,
    saldoNaoFiscal: s.saldoNaoFiscal,
    controlaEstoque: true,
    itemFiscal: 1,
    produto: p
  }], f12, {
    pagamentos: [{ forma_pagamento: 'pix', valor: item.subtotal }],
    midpAtivo: false,
    permitirVendaSemEstoque: semEstoque
  });
}

function identidade(r, qtd) {
  const item = itemBase(qtd);
  return validarIdentidadeFinanceiraVenda({
    total: item.subtotal,
    valorFiscal: r.valorFiscalEfetivo,
    valorNaoFiscal: r.valorNaoFiscal,
    itens: [item],
    pagamentos: [{ forma_pagamento: 'pix', valor: item.subtotal }],
    formaPagamento: 'pix'
  });
}

function carregarBaixa() {
  const chamadas = [];
  const factory = new Function('db', 'require', 'reduzirEstoqueComFEFO', `
    ${extract(pagSrc, 'function reduzirEstoqueDistribuido(', 'function atualizarStatusPagamentoVenda')}
    return reduzirEstoqueDistribuido;
  `);
  const fn = factory(
    { get: (_sql, _params, cb) => cb(null, { controla_estoque: 1 }) },
    () => ({ produtoControlaEstoque: (row) => Number(row.controla_estoque) !== 0 }),
    (_vid, _pid, qtd, itemFiscal, cb) => { chamadas.push({ qtd, itemFiscal }); cb(null); }
  );
  return { fn, chamadas };
}

const cfgNfe = {
  codigoUf: '23', cnpj: '65957340000150', ie: '073252638', crt: 1, ambiente: 2, serie: 1,
  nomeEmpresa: 'EMPRESA TESTE', logradouro: 'RUA A', numero: '1', bairro: 'CENTRO',
  codigo_municipio: '2307304', municipio_nome: 'JUAZEIRO DO NORTE', uf_sigla: 'CE', cep: '63000000'
};

function xmlDe(row, qtd) {
  return buildNfeXml({
    config: cfgNfe,
    venda: {
      total: qtd * PRECO,
      valor_fiscal: row.valor_fiscal,
      valor_nao_fiscal: row.valor_nao_fiscal,
      desconto: 0,
      cliente_nome: 'CLIENTE',
      cliente_cpf: '12345678909',
      forma_pagamento: 'pix',
      pagamentos: [{ forma_pagamento: 'pix', valor: row.valor_fiscal, tipo_recebimento: 'fiscal' }]
    },
    itens: [{ ...itemBase(qtd), ...row, quantidade: qtd, preco_unitario: PRECO }],
    numero: 1,
    dadosNfe: { natureza_operacao: 'VENDA', cfop: '5102' }
  }).xmlSemAssinatura;
}

function qtds(r) {
  const i = r.itens[0];
  return [i.quantidade_fiscal, i.quantidade_nao_fiscal];
}

describe('Sprint 5 — motor: disponível mantém natureza; excedente segue item_fiscal (Sprint 7)', () => {
  it('1 — A2+B3 qty10 sem estoque ON (F12 ON) → qA=7 qB=3; quantidade comercial 10 preservada', () => {
    const r = motor(produto(2, 3), 10, { f12: true, semEstoque: true });
    assert.equal(r.sucesso, true);
    assert.deepEqual(qtds(r), [7, 3]);
    assert.equal(r.itens[0].quantidade, 10);
    assert.equal(r.valorFiscalEfetivo, 35, 'valor fiscal = qF × preço');
    assert.equal(r.valorNaoFiscal, 15, 'valor não fiscal = qNF × preço');
  });

  it('2 — A2+B3 qty10 sem estoque OFF → bloqueio', () => {
    const r = motor(produto(2, 3), 10, { f12: true, semEstoque: false });
    assert.equal(r.sucesso, false);
    assert.match(r.erro.mensagem, /Saldo insuficiente\. Disponível: 5/);
  });

  it('3 — A2+B3 qty5 sem estoque OFF → qA=2 qB=3; venda fecha com o total comercial', () => {
    const r = motor(produto(2, 3), 5, { f12: true, semEstoque: false });
    assert.deepEqual(qtds(r), [2, 3]);
    assert.equal(r.totalVenda, 25);
    assert.equal(identidade(r, 5).ok, true);
  });

  it('4 — A2+B8 qty5 F12 ON sem estoque OFF → qA=2 qB=3', () => {
    const r = motor(produto(2, 8), 5, { f12: true, semEstoque: false });
    assert.deepEqual(qtds(r), [2, 3]);
  });

  it('4b — A10+B3 qty5 F12 ON → qA=5 qB=0', () => {
    const r = motor(produto(10, 3), 5, { f12: true, semEstoque: false });
    assert.deepEqual(qtds(r), [5, 0]);
  });

  it('5 — A2+B3 reservaB=2 (disp A2 B1): OFF bloqueia qty5; ON → qA=4 qB=1 (reserva B não consumida)', () => {
    const p = produto(2, 3, 0, 2);
    const s = saldosPersistencia(p, 5);
    assert.deepEqual([s.saldoFiscal, s.saldoNaoFiscal], [2, 1]);

    const off = motor(p, 5, { f12: true, semEstoque: false });
    assert.equal(off.sucesso, false);
    assert.match(off.erro.mensagem, /Disponível: 3/);

    const on = motor(p, 5, { f12: true, semEstoque: true });
    assert.equal(on.sucesso, true);
    assert.deepEqual(qtds(on), [4, 1]);
  });

  it('6 — A2+B3 qty10 sem estoque ON F12 OFF → qA=7 qB=3 (excedente não vira B)', () => {
    const r = motor(produto(2, 3), 10, { f12: false, semEstoque: true });
    assert.deepEqual(qtds(r), [7, 3]);
  });

  it('7 — A2+B3 qty10 sem estoque ON F12 ON → qA=7 qB=3 (F12 não altera o destino do excedente)', () => {
    const r = motor(produto(2, 3), 10, { f12: true, semEstoque: true });
    assert.deepEqual(qtds(r), [7, 3]);
  });
});

describe('Sprint 5 — fiscal e estoque do caso A2+B3 qty10', () => {
  it('NFC-e usa somente qF: qCom=7 (nem 10, nem 5)', () => {
    const row = motor(produto(2, 3), 10, { f12: true, semEstoque: true }).itens[0];
    const xml = xmlDe(row, 10);
    assert.match(xml, /<qCom>7\.0000<\/qCom>/);
    assert.doesNotMatch(xml, /<qCom>(10|5)\.0000<\/qCom>/);
  });

  it('baixa: A=7 (excedente fiscal) e B=3 (disponível não fiscal)', async () => {
    const row = motor(produto(2, 3), 10, { f12: true, semEstoque: true }).itens[0];
    const { fn, chamadas } = carregarBaixa();
    await new Promise((resolve, reject) => fn(1, 711, row.quantidade_fiscal, row.quantidade_nao_fiscal, (e) => (e ? reject(e) : resolve())));
    assert.deepEqual(chamadas, [{ qtd: 7, itemFiscal: 1 }, { qtd: 3, itemFiscal: 0 }]);
  });
});

describe('Sprint 5 — identidade financeira com excedente distribuído (Sprint 7)', () => {
  it('total F+NF=50 = comercial 50 → identidade financeira aceita a venda', () => {
    const r = motor(produto(2, 3), 10, { f12: true, semEstoque: true });
    assert.equal(r.totalVenda, 50);
    const v = identidade(r, 10);
    assert.equal(v.ok, true);
  });
});

describe('Sprint 5B-2C — contexto fiscal do fechamento fiscal', () => {
  function motorFiscalContexto(produtoEstoque, qtd, semEstoque) {
    const s = saldosPersistencia(produtoEstoque, qtd);
    const item = itemBase(qtd);
    return distribuirItensVendaComValorFiscalEfetivo([{
      item,
      saldoFiscal: s.saldoFiscal,
      saldoNaoFiscal: s.saldoNaoFiscal,
      controlaEstoque: true,
      itemFiscal: 1,
      produto: produtoEstoque
    }], true, {
      pagamentos: [{ forma_pagamento: 'pix', valor: item.subtotal }],
      midpAtivo: false,
      permitirVendaSemEstoque: semEstoque,
      contextoFiscalFechamento: true
    });
  }

  it('01 — F=0/NF=5/V=1 sem estoque OFF -> bloqueia', () => {
    const r = motorFiscalContexto(produto(0, 5), 1, false);
    assert.equal(r.sucesso, false);
    assert.match(r.erro.mensagem, /Saldo fiscal insuficiente/);
  });

  it('02 — F=1/NF=5/V=1 -> F=0/NF=5', () => {
    const r = motorFiscalContexto(produto(1, 5), 1, false);
    assert.equal(r.sucesso, true);
    assert.deepEqual(qtds(r), [1, 0]);
    assert.equal(r.valorNaoFiscal, 0);
  });

  it('03 — F=2/NF=5/V=3 sem estoque OFF -> bloqueia', () => {
    const r = motorFiscalContexto(produto(2, 5), 3, false);
    assert.equal(r.sucesso, false);
    assert.match(r.erro.mensagem, /Saldo fiscal insuficiente/);
  });

  it('04 — F=2/NF=5/V=3 sem estoque ON -> venda permitida, NF não baixa', () => {
    const r = motorFiscalContexto(produto(2, 5), 3, true);
    assert.equal(r.sucesso, true);
    assert.deepEqual(qtds(r), [3, 0]);
    assert.equal(r.valorNaoFiscal, 0);
  });

  it('05 — F=10/NF=7/V=3 -> F=7/NF=7', () => {
    const r = motorFiscalContexto(produto(10, 7), 3, false);
    assert.equal(r.sucesso, true);
    assert.deepEqual(qtds(r), [3, 0]);
  });

  it('06 — F=3/NF=8/V=3 -> F=0/NF=8', () => {
    const r = motorFiscalContexto(produto(3, 8), 3, false);
    assert.equal(r.sucesso, true);
    assert.deepEqual(qtds(r), [3, 0]);
  });

  it('07 — nunca consome NF em venda fiscal', () => {
    const r = motorFiscalContexto(produto(0, 5), 1, true);
    assert.equal(r.sucesso, true);
    assert.deepEqual(qtds(r), [1, 0]);
  });
});
