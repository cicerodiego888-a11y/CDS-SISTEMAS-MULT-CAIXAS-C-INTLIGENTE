/**
 * Sprint 7 — Excedente da VENDA SEM ESTOQUE segue item_fiscal
 * (Est. Padrão = fiscal, Est. Reserva = não fiscal; E-Comprometido nunca consumido).
 *
 * Executar: node --test tests/estoque/sprint7-excedente-venda-sem-estoque.test.js
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
const { prepararEntradasMotorComTransferenciaPdv } = require('../../backend/services/estoque/transferenciaNaoFiscalParaFiscalPdv');
const { validarIdentidadeFinanceiraVenda } = require('../../backend/services/caixa/ValidacaoIdentidadeVenda');
const { buildNfeXml } = require('../../backend/services/fiscal/xmlBuilderNfeVenda');

function extract(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Marcador não encontrado: ${startMarker}`);
  return src.slice(start, end);
}

function produto(padrao, reserva, compPadrao = 0, compReserva = 0, itemFiscal = 1, id = 777) {
  return {
    id,
    nome: 'Produto S7',
    saldo_fiscal: padrao,
    saldo_nao_fiscal: reserva,
    estoque_atual: padrao + reserva,
    reservado_fiscal: compPadrao,
    reservado_nao_fiscal: compReserva,
    item_fiscal: itemFiscal,
    controla_estoque: 1
  };
}

function itemBase(qtd, preco, id = 777) {
  return {
    produto_id: id,
    produto_nome: 'Produto S7',
    quantidade: qtd,
    preco_unitario: preco,
    subtotal: Number((qtd * preco).toFixed(2)),
    produto_ncm: '10063021',
    cfop: '5102',
    unidade: 'UN'
  };
}

/** Mesmo caminho de saldos da persistência (VendaPagamentoService). */
function saldosPersistencia(p, qtd, creditoPedido = 0) {
  const calcBase = saldosDisponiveisMotorFxNf(p).estoque;
  const calc = creditarDisponibilidadeComReservaPedido(calcBase, creditoPedido);
  return saldosParaDistribuicaoVenda(p, qtd, calc.disponivel_fiscal, calc.disponivel_nao_fiscal);
}

function motor(p, qtd, {
  f12 = true, semEstoque = true, preco = 5, creditoPedido = 0, controlaEstoque = true
} = {}) {
  const s = saldosPersistencia(p, qtd, creditoPedido);
  const item = itemBase(qtd, preco, p.id);
  return distribuirItensVendaComValorFiscalEfetivo([{
    item,
    saldoFiscal: s.saldoFiscal,
    saldoNaoFiscal: s.saldoNaoFiscal,
    controlaEstoque,
    itemFiscal: p.item_fiscal,
    produto: p
  }], f12, {
    pagamentos: [{ forma_pagamento: 'pix', valor: item.subtotal }],
    midpAtivo: false,
    permitirVendaSemEstoque: semEstoque
  });
}

function identidade(r, qtd, preco = 5) {
  const item = itemBase(qtd, preco);
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

async function baixar(row, produtoId = 777) {
  const { fn, chamadas } = carregarBaixa();
  await new Promise((resolve, reject) => fn(1, produtoId, row.quantidade_fiscal, row.quantidade_nao_fiscal,
    (e) => (e ? reject(e) : resolve())));
  return chamadas;
}

/** Saldos físicos após a baixa; comprometido intacto ⇔ físico ≥ comprometido em cada natureza. */
function aposBaixa(p, row) {
  return {
    padrao: p.saldo_fiscal - row.quantidade_fiscal,
    reserva: p.saldo_nao_fiscal - row.quantidade_nao_fiscal
  };
}

const cfgNfe = {
  codigoUf: '23', cnpj: '65957340000150', ie: '073252638', crt: 1, ambiente: 2, serie: 1,
  nomeEmpresa: 'EMPRESA TESTE', logradouro: 'RUA A', numero: '1', bairro: 'CENTRO',
  codigo_municipio: '2307304', municipio_nome: 'JUAZEIRO DO NORTE', uf_sigla: 'CE', cep: '63000000'
};

function xmlDe(row, qtd, preco = 5) {
  return buildNfeXml({
    config: cfgNfe,
    venda: {
      total: qtd * preco,
      valor_fiscal: row.valor_fiscal,
      valor_nao_fiscal: row.valor_nao_fiscal,
      desconto: 0,
      cliente_nome: 'CLIENTE',
      cliente_cpf: '12345678909',
      forma_pagamento: 'pix',
      pagamentos: [{ forma_pagamento: 'pix', valor: row.valor_fiscal, tipo_recebimento: 'fiscal' }]
    },
    itens: [{ ...itemBase(qtd, preco), ...row, quantidade: qtd, preco_unitario: preco }],
    numero: 1,
    dadosNfe: { natureza_operacao: 'VENDA', cfop: '5102' }
  }).xmlSemAssinatura;
}

function qtds(r) {
  const i = r.itens[0];
  return [i.quantidade_fiscal, i.quantidade_nao_fiscal];
}

describe('Sprint 7 — excedente da venda sem estoque segue item_fiscal', () => {
  it('1 — P2 R3 qty10 item_fiscal=1 → qF=7 qNF=3, vF=35 vNF=15, identidade OK', () => {
    for (const f12 of [true, false]) {
      const r = motor(produto(2, 3, 0, 0, 1), 10, { f12 });
      assert.equal(r.sucesso, true);
      assert.deepEqual(qtds(r), [7, 3], `F12=${f12}`);
      assert.equal(r.itens[0].quantidade, 10);
      assert.equal(r.valorFiscalEfetivo, 35);
      assert.equal(r.valorNaoFiscal, 15);
      assert.equal(r.totalVenda, 50);
      assert.equal(identidade(r, 10).ok, true);
    }
  });

  it('2 — P2 R3 qty10 item_fiscal=0 → qF=2 qNF=8, vF=10 vNF=40, identidade OK', () => {
    for (const f12 of [true, false]) {
      const r = motor(produto(2, 3, 0, 0, 0), 10, { f12 });
      assert.equal(r.sucesso, true);
      assert.deepEqual(qtds(r), [2, 8], `F12=${f12}`);
      assert.equal(r.valorFiscalEfetivo, 10);
      assert.equal(r.valorNaoFiscal, 40);
      assert.equal(r.totalVenda, 50);
      assert.equal(identidade(r, 10).ok, true);
    }
  });

  it('3 — VENDA SEM ESTOQUE OFF → bloqueio com mensagem atual', () => {
    for (const itemFiscal of [1, 0]) {
      const r = motor(produto(2, 3, 0, 0, itemFiscal), 10, { semEstoque: false });
      assert.equal(r.sucesso, false);
      assert.match(r.erro.mensagem, /^Saldo insuficiente\. Disponível: 5$/);
    }
  });

  it('4 — P0 R0 qty10 item_fiscal=1 → qF=10 (saldo Padrão negativo permitido)', () => {
    const p = produto(0, 0, 0, 0, 1);
    const r = motor(p, 10);
    assert.equal(r.sucesso, true);
    assert.deepEqual(qtds(r), [10, 0]);
    assert.equal(r.valorFiscalEfetivo, 50);
    assert.equal(identidade(r, 10).ok, true);
    assert.deepEqual(aposBaixa(p, r.itens[0]), { padrao: -10, reserva: 0 });
  });

  it('5 — P0 R0 qty10 item_fiscal=0 → qNF=10', () => {
    const r = motor(produto(0, 0, 0, 0, 0), 10);
    assert.equal(r.sucesso, true);
    assert.deepEqual(qtds(r), [0, 10]);
    assert.equal(r.valorNaoFiscal, 50);
    assert.equal(identidade(r, 10).ok, true);
  });

  it('6a — P2, Reserva físico 3 comprometido 2, qty5 item_fiscal=1 → 4 fiscal + 1 não fiscal; comprometido intacto', async () => {
    const p = produto(2, 3, 0, 2, 1);
    assert.deepEqual(Object.values(saldosPersistencia(p, 5)).slice(0, 2), [2, 1], 'disponível P2 + R1');
    const r = motor(p, 5);
    assert.equal(r.sucesso, true);
    assert.deepEqual(qtds(r), [4, 1]);
    assert.equal(identidade(r, 5).ok, true);
    assert.deepEqual(await baixar(r.itens[0]), [{ qtd: 4, itemFiscal: 1 }, { qtd: 1, itemFiscal: 0 }]);
    assert.ok(aposBaixa(p, r.itens[0]).reserva >= p.reservado_nao_fiscal, 'Reserva físico 2 ≥ comprometido 2');
  });

  it('6b — mesmo cenário item_fiscal=0: excedente consumiria comprometido da Reserva → bloqueado (decisão de negócio)', () => {
    const p = produto(2, 3, 0, 2, 0);
    const r = motor(p, 5);
    assert.equal(r.sucesso, false);
    assert.equal(r.erro.codigo, 'EXCEDENTE_CONSUMIRIA_COMPROMETIDO');
  });

  it('6c — comprometido no Padrão com excedente fiscal → bloqueado; sem consumo do comprometido', () => {
    const r = motor(produto(3, 0, 1, 0, 1), 5);
    assert.equal(r.sucesso, false);
    assert.equal(r.erro.codigo, 'EXCEDENTE_CONSUMIRIA_COMPROMETIDO');
  });

  it('6d — reserva do próprio pedido não conta como comprometido de terceiros', () => {
    const p = produto(3, 0, 3, 0, 1);
    const r = motor(p, 5, { creditoPedido: 3 });
    assert.equal(r.sucesso, true);
    assert.deepEqual(qtds(r), [5, 0]);
  });

  it('7 — produto 611: P1, Reserva físico 1 comprometido 1, qty2 preço 5.39 → qF=2 qNF=0 vF=10.78', async () => {
    const p = produto(1, 1, 0, 1, 1, 611);
    const r = motor(p, 2, { preco: 5.39 });
    assert.equal(r.sucesso, true);
    assert.deepEqual(qtds(r), [2, 0]);
    assert.equal(r.valorFiscalEfetivo, 10.78);
    assert.equal(r.valorNaoFiscal, 0);
    assert.equal(identidade(r, 2, 5.39).ok, true);
    assert.deepEqual(await baixar(r.itens[0], 611), [{ qtd: 2, itemFiscal: 1 }]);
    assert.equal(aposBaixa(p, r.itens[0]).reserva, 1, 'comprometido da Reserva intacto');
  });

  it('8 — estoque suficiente: comportamento normal inalterado', () => {
    assert.deepEqual(qtds(motor(produto(10, 3), 5, { f12: true })), [5, 0]);
    assert.deepEqual(qtds(motor(produto(2, 3), 5, { f12: true })), [2, 3]);
    assert.deepEqual(qtds(motor(produto(2, 8), 5, { f12: false })), [0, 5]);
    assert.deepEqual(qtds(motor(produto(2, 3), 5, { f12: true, semEstoque: false })), [2, 3]);
  });

  it('9 — controla_estoque=0 inalterado (sem validação de saldo nem comprometido)', () => {
    const f = motor(produto(0, 0, 0, 5, 1), 10, { controlaEstoque: false, semEstoque: false });
    assert.equal(f.sucesso, true);
    assert.deepEqual(qtds(f), [10, 0]);
    const nf = motor(produto(0, 0, 5, 5, 0), 10, { controlaEstoque: false, semEstoque: false });
    assert.equal(nf.sucesso, true);
    assert.deepEqual(qtds(nf), [0, 10]);
  });

  it('10 — sem transferência automática Reserva → Padrão para cobrir o excedente', () => {
    const p = produto(2, 3, 0, 0, 1);
    const s = saldosPersistencia(p, 10);
    const prep = prepararEntradasMotorComTransferenciaPdv([{
      item: itemBase(10, 5),
      saldoFiscal: s.saldoFiscal,
      saldoNaoFiscal: s.saldoNaoFiscal,
      controlaEstoque: true
    }], { permitido: true });
    assert.equal(prep.sucesso, true);
    assert.equal((prep.aplicacoes || []).length, 0);
    assert.equal(prep.entradas[0].saldoFiscal, 2);
    assert.equal(prep.entradas[0].saldoNaoFiscal, 3);

    const r = motor(p, 10);
    assert.equal(r.itens[0].transferencia_nao_fiscal_para_fiscal, undefined);
    assert.equal(r.itens[0].quantidade_nao_fiscal, 3, 'Reserva mantém natureza não fiscal');
  });
});

describe('Sprint 7 — NFC-e e baixa do caso P2 R3 qty10 item_fiscal=1', () => {
  it('NFC-e recebe somente qF=7 / vF=35', () => {
    const row = motor(produto(2, 3, 0, 0, 1), 10).itens[0];
    const xml = xmlDe(row, 10);
    assert.match(xml, /<qCom>7\.0000<\/qCom>/);
    assert.doesNotMatch(xml, /<qCom>(10|5|3)\.0000<\/qCom>/);
    assert.match(xml, /<vProd>35\.00<\/vProd>/);
  });

  it('baixa: 7 no Padrão (saldo -5) e 3 na Reserva (saldo 0)', async () => {
    const p = produto(2, 3, 0, 0, 1);
    const row = motor(p, 10).itens[0];
    assert.deepEqual(await baixar(row), [{ qtd: 7, itemFiscal: 1 }, { qtd: 3, itemFiscal: 0 }]);
    assert.deepEqual(aposBaixa(p, row), { padrao: -5, reserva: 0 });
  });
});
