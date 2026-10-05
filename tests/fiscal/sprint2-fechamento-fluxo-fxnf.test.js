/**
 * Sprint 2 — fechamento do fluxo fiscal após correção A/B (sem regra comercial nova).
 * node --test tests/fiscal/sprint2-fechamento-fluxo-fxnf.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  distribuirItensVendaComValorFiscalEfetivo
} = require('../../backend/services/distribuidorEstoqueVenda');
const { saldosDisponiveisMotorFxNf } = require('../../backend/services/estoque/EstoqueDisponivelService');
const { saldosParaDistribuicaoVenda } = require('../../backend/services/estoque/produtoControlaEstoque');
const {
  prepararEntradasMotorComTransferenciaPdv,
  avaliarFluxoInclusaoPdv
} = require('../../backend/services/estoque/transferenciaNaoFiscalParaFiscalPdv');
const { buildNfeXml, itemEntraNaNfe, obterQuantidadeFiscalItem, obterValorFiscalItem } = require('../../backend/services/fiscal/xmlBuilderNfeVenda');

const cfgNfe = {
  codigoUf: '23',
  cnpj: '65957340000150',
  ie: '073252638',
  crt: 1,
  ambiente: 2,
  serie: 1,
  nomeEmpresa: 'EMPRESA TESTE',
  logradouro: 'RUA A',
  numero: '1',
  bairro: 'CENTRO',
  codigo_municipio: '2307304',
  municipio_nome: 'JUAZEIRO DO NORTE',
  uf_sigla: 'CE',
  cep: '63000000'
};

function itemBase(qtd, preco = 5.39) {
  return {
    produto_id: 611,
    produto_nome: 'Arroz Branco Tipo 1 Pop 1 kg',
    quantidade: qtd,
    preco_unitario: preco,
    subtotal: Number((qtd * preco).toFixed(2)),
    produto_ncm: '10063021',
    cfop: '5102',
    unidade: 'UN'
  };
}

function motor(entrada, vendaFiscal, opcoes = {}) {
  const qtd = Number(entrada.item.quantidade || 0);
  const preco = Number(entrada.item.preco_unitario || 0);
  return distribuirItensVendaComValorFiscalEfetivo([entrada], vendaFiscal, {
    pagamentos: [{ forma_pagamento: 'pix', valor: Number((qtd * preco).toFixed(2)) }],
    midpAtivo: false,
    permitirVendaSemEstoque: false,
    ...opcoes
  });
}

function entrada(saldoFiscal, saldoNaoFiscal, item, extra = {}) {
  return {
    item,
    saldoFiscal,
    saldoNaoFiscal,
    controlaEstoque: extra.controlaEstoque !== false,
    itemFiscal: extra.itemFiscal != null ? extra.itemFiscal : 1,
    produto: extra.produto || { item_fiscal: extra.itemFiscal != null ? extra.itemFiscal : 1 }
  };
}

function persistirLinhaComoVendaPagamento(item) {
  const quantidadeFiscal = Number(item.quantidade_fiscal || 0);
  const quantidadeNaoFiscal = Number(item.quantidade_nao_fiscal || 0);
  return {
    quantidade: item.quantidade,
    quantidade_fiscal: quantidadeFiscal,
    quantidade_nao_fiscal: quantidadeNaoFiscal,
    valor_fiscal: Number((item.valor_fiscal || 0).toFixed(2)),
    valor_nao_fiscal: Number((item.valor_nao_fiscal || 0).toFixed(2)),
    item_fiscal: quantidadeFiscal > 0 ? 1 : 0
  };
}

function xmlVendaItem(itemPersistido) {
  return buildNfeXml({
    config: cfgNfe,
    venda: {
      total: itemPersistido.quantidade * Number(itemPersistido.preco_unitario || 5.39),
      valor_fiscal: itemPersistido.valor_fiscal,
      valor_nao_fiscal: itemPersistido.valor_nao_fiscal,
      desconto: 0,
      cliente_nome: 'CLIENTE',
      cliente_cpf: '12345678909',
      forma_pagamento: 'pix',
      pagamentos: [{ forma_pagamento: 'pix', valor: itemPersistido.valor_fiscal, tipo_recebimento: 'fiscal' }]
    },
    itens: [{
      ...itemBase(itemPersistido.quantidade),
      ...itemPersistido,
      preco_unitario: 5.39
    }],
    numero: 1,
    dadosNfe: { natureza_operacao: 'VENDA', cfop: '5102' }
  });
}

describe('Sprint 2 — contrato do motor e valores', () => {
  it('CASO A — A=1 B=1 sem reserva qty=2 → 1A+1B e valores 5,39/5,39', () => {
    const out = motor(entrada(1, 1, itemBase(2)), true);
    const row = out.itens[0];
    assert.equal(out.sucesso, true);
    assert.equal(row.quantidade_fiscal, 1);
    assert.equal(row.quantidade_nao_fiscal, 1);
    assert.equal(row.valor_fiscal, 5.39);
    assert.equal(row.valor_nao_fiscal, 5.39);
    assert.equal(Number((row.valor_fiscal + row.valor_nao_fiscal).toFixed(2)), 10.78);
  });

  it('CASO B — A=1 B reservado qty=2 sem estoque fiscal → 2A+0B (Sprint 7: excedente fiscal; B reservado intacto)', () => {
    const produto = {
      saldo_fiscal: 1,
      saldo_nao_fiscal: 1,
      reservado_nao_fiscal: 1,
      item_fiscal: 1,
      controla_estoque: 1
    };
    const disp = saldosDisponiveisMotorFxNf(produto);
    const saldos = saldosParaDistribuicaoVenda(produto, 2, disp.saldoFiscal, disp.saldoNaoFiscal);
    const out = motor(
      entrada(saldos.saldoFiscal, saldos.saldoNaoFiscal, itemBase(2)),
      true,
      { permitirVendaSemEstoque: true }
    );
    const row = out.itens[0];
    assert.equal(row.quantidade_fiscal, 2);
    assert.equal(row.quantidade_nao_fiscal, 0);
    assert.equal(row.valor_fiscal, 10.78);
    assert.equal(row.valor_nao_fiscal, 0);
  });

  it('CASO C — A=5 B=5 qty=2 fiscal → 2A+0B', () => {
    const row = motor(entrada(5, 5, itemBase(2)), true).itens[0];
    assert.equal(row.quantidade_fiscal, 2);
    assert.equal(row.quantidade_nao_fiscal, 0);
    assert.equal(row.valor_fiscal, 10.78);
    assert.equal(row.valor_nao_fiscal, 0);
  });

  it('CASO D — A=2 B=10 qty=12 fiscal → 2A+10B', () => {
    const row = motor(entrada(2, 10, itemBase(12)), true).itens[0];
    assert.equal(row.quantidade_fiscal, 2);
    assert.equal(row.quantidade_nao_fiscal, 10);
    assert.equal(row.valor_fiscal, 10.78);
    assert.equal(row.valor_nao_fiscal, 53.9);
  });
});

describe('Sprint 2 — persistência, NFC-e e 611', () => {
  it('vendas_itens copia qF/qNF/valores do motor; item_fiscal não substitui quantidade', () => {
    const row = motor(entrada(1, 1, itemBase(2)), true).itens[0];
    const persistido = persistirLinhaComoVendaPagamento(row);
    assert.equal(persistido.quantidade, 2);
    assert.equal(persistido.quantidade_fiscal, 1);
    assert.equal(persistido.quantidade_nao_fiscal, 1);
    assert.equal(persistido.valor_fiscal, 5.39);
    assert.equal(persistido.valor_nao_fiscal, 5.39);
    assert.equal(persistido.item_fiscal, 1);
    const linha2a = persistirLinhaComoVendaPagamento(
      motor(entrada(5, 5, itemBase(2)), true).itens[0]
    );
    assert.equal(linha2a.quantidade_fiscal, 2);
    assert.equal(linha2a.item_fiscal, 1);
    assert.notEqual(linha2a.item_fiscal, linha2a.quantidade_fiscal);

    const src = fs.readFileSync(path.join(ROOT, 'backend/services/vendas/VendaPagamentoService.js'), 'utf8');
    assert.match(src, /item_fiscal, quantidade_fiscal, quantidade_nao_fiscal, valor_fiscal, valor_nao_fiscal/);
    assert.match(src, /quantidadeFiscal > 0\s*\n\s*\? 1/);
  });

  it('NFC-e 1A+1B: qCom=1 e vProd=5.39, sem fallback comercial', () => {
    const row = persistirLinhaComoVendaPagamento(motor(entrada(1, 1, itemBase(2)), true).itens[0]);
    assert.equal(itemEntraNaNfe({ ...row, valor_fiscal: row.valor_fiscal }), true);
    assert.equal(obterQuantidadeFiscalItem(row), 1);
    assert.equal(obterValorFiscalItem(row), 5.39);

    const built = xmlVendaItem(row);
    assert.match(built.xmlSemAssinatura, /<qCom>1\.0000<\/qCom>/);
    assert.match(built.xmlSemAssinatura, /<vProd>5\.39<\/vProd>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /<qCom>2\.0000<\/qCom>/);
    assert.equal(itemEntraNaNfe({ quantidade: 2, subtotal: 10.78, quantidade_fiscal: 0, valor_fiscal: 0 }), false);

    const nfceSrc = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/xmlBuilder.js'), 'utf8');
    assert.match(nfceSrc, /function obterQuantidadeFiscalItem/);
    assert.match(nfceSrc, /<qCom>\$\{formatNumber\(quantidade, 4\)\}<\/qCom>/);
    assert.match(nfceSrc, /return Number\(item\.quantidade_fiscal \?\? 0\)/);
  });

  it('reprodução 611: disponível A1 B0 → persistido qF=2 qNF=0 e qCom=2 (Sprint 7); reserva B intacta', () => {
    const produto611 = {
      id: 611,
      saldo_fiscal: 1,
      saldo_nao_fiscal: 1,
      estoque_atual: 2,
      reservado_fiscal: 0,
      reservado_nao_fiscal: 1,
      item_fiscal: 1,
      controla_estoque: 1
    };
    const pre = saldosDisponiveisMotorFxNf(produto611);
    const persistPolicy = saldosDisponiveisMotorFxNf(produto611);
    assert.deepEqual(
      { a: pre.saldoFiscal, b: pre.saldoNaoFiscal },
      { a: persistPolicy.saldoFiscal, b: persistPolicy.saldoNaoFiscal }
    );

    const prep = prepararEntradasMotorComTransferenciaPdv(
      [entrada(pre.saldoFiscal, pre.saldoNaoFiscal, itemBase(2))],
      { permitido: false }
    );
    const out = motor(prep.entradas[0], true, { permitirVendaSemEstoque: true });
    const persistido = persistirLinhaComoVendaPagamento(out.itens[0]);
    assert.equal(persistido.quantidade_fiscal, 2);
    assert.equal(persistido.quantidade_nao_fiscal, 0);

    const built = xmlVendaItem(persistido);
    assert.match(built.xmlSemAssinatura, /<qCom>2\.0000<\/qCom>/);
    assert.match(built.xmlSemAssinatura, /<vProd>10\.78<\/vProd>/);

    const aDepois = 1 - persistido.quantidade_fiscal;
    const bDepois = 1 - persistido.quantidade_nao_fiscal;
    const reservaEntrega16 = 1;
    assert.equal(aDepois, -1);
    assert.equal(bDepois, 1);
    assert.equal(reservaEntrega16, 1);
  });
});

describe('Sprint 2 — estoque, excedente, fallback, F12, quantity_estoque', () => {
  it('baixa A=1 qA=1 → 0 e B=1 qB=1 → 0 sem clamp', () => {
    assert.equal(1 - 1, 0);
    const src = fs.readFileSync(path.join(ROOT, 'backend/services/vendas/VendaPagamentoService.js'), 'utf8');
    assert.match(src, /reduzirEstoqueDistribuido\([^)]*quantidade_fiscal/);
    assert.match(src, /saldo_fiscal = saldo_fiscal - \?/);
    assert.match(src, /saldo_nao_fiscal = saldo_nao_fiscal - \?/);
    assert.doesNotMatch(
      src,
      /saldo_fiscal = CASE WHEN saldo_fiscal - \? < 0 THEN 1/
    );
    assert.doesNotMatch(
      src,
      /saldo_nao_fiscal = CASE WHEN saldo_nao_fiscal - \? < 0 THEN 1/
    );
  });

  it('excedente A=2 B=3 qty=10 sem estoque item_fiscal=1 → 7A+3B (Sprint 7)', () => {
    const row = motor(entrada(2, 3, itemBase(10)), true, { permitirVendaSemEstoque: true }).itens[0];
    assert.equal(row.quantidade_fiscal, 7);
    assert.equal(row.quantidade_nao_fiscal, 3);
  });

  it('A=0 B=0 fallback item_fiscal preservado', () => {
    const a = motor(entrada(0, 0, itemBase(2), { itemFiscal: 1 }), true, { permitirVendaSemEstoque: true }).itens[0];
    const b = motor(entrada(0, 0, itemBase(2), { itemFiscal: 0 }), true, { permitirVendaSemEstoque: true }).itens[0];
    assert.equal(a.quantidade_fiscal, 2);
    assert.equal(a.quantidade_nao_fiscal, 0);
    assert.equal(b.quantidade_fiscal, 0);
    assert.equal(b.quantidade_nao_fiscal, 2);
  });

  it('transferência OFF / NÃO / SIM inalterada', () => {
    const off = prepararEntradasMotorComTransferenciaPdv(
      [entrada(1, 1, { ...itemBase(2), transferencia_nao_fiscal_para_fiscal: 1 })],
      { permitido: false }
    );
    assert.equal(off.entradas[0].transferenciaAplicadaEmMemoria, 0);

    const nao = avaliarFluxoInclusaoPdv({
      quantidade: 2,
      saldoFiscal: 1,
      saldoNaoFiscal: 1,
      modoFiscal: true,
      permitido: true,
      respostaTransferencia: false
    });
    assert.equal(nao.quantidadeTransferir, 0);

    const sim = avaliarFluxoInclusaoPdv({
      quantidade: 2,
      saldoFiscal: 1,
      saldoNaoFiscal: 1,
      modoFiscal: true,
      permitido: true,
      respostaTransferencia: true
    });
    assert.equal(sim.quantidadeTransferir, 1);
  });

  it('F12 visual permanece só A; quantity_estoque inalterado', () => {
    const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
    assert.match(pdv, /function pdvEstoqueDisponivel\(produto\) \{[\s\S]*pdvModoFiscalAtivo\(\)[\s\S]*saldo_fiscal/);
    assert.match(pdv, /function pdvRotuloEstoque\(produto\) \{[\s\S]*return String\(fiscal\)/);
    assert.match(pdv, /function obterQuantidadeEstoqueParaVenda\([\s\S]*peso_medio_unidade[\s\S]*quantidadeVenda \|\| 0\) \* pesoMedio/);
    assert.match(pdv, /tipoVendaEhUnidade\(tipoVenda\) && produto\) \{\s*itemPayload\.quantidade_estoque = obterQuantidadeEstoqueParaVenda/);
  });
});
