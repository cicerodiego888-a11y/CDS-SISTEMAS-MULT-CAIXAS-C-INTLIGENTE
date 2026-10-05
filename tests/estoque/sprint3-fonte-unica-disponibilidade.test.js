/**
 * Sprint 3 — fonte única de disponibilidade operacional A/B.
 * node --test tests/estoque/sprint3-fonte-unica-disponibilidade.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const pdvSrc = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
const pagSrc = fs.readFileSync(path.join(ROOT, 'backend/services/vendas/VendaPagamentoService.js'), 'utf8');
const entregaSrc = fs.readFileSync(path.join(ROOT, 'backend/services/entrega/CriarVendaEntregaService.js'), 'utf8');
const distSrc = fs.readFileSync(path.join(ROOT, 'backend/services/distribuidorEstoqueVenda.js'), 'utf8');

const {
  distribuirQuantidadeVenda,
  distribuirItensVendaComValorFiscalEfetivo
} = require('../../backend/services/distribuidorEstoqueVenda');
const { saldosDisponiveisMotorFxNf } = require('../../backend/services/estoque/EstoqueDisponivelService');
const { saldosParaDistribuicaoVenda } = require('../../backend/services/estoque/produtoControlaEstoque');
const { creditarDisponibilidadeComReservaPedido } = require('../../backend/services/estoque/pedidoReservaPonteNucleo');
const {
  prepararEntradasMotorComTransferenciaPdv
} = require('../../backend/services/estoque/transferenciaNaoFiscalParaFiscalPdv');
const { buildNfeXml } = require('../../backend/services/fiscal/xmlBuilderNfeVenda');

function extract(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Marcador não encontrado: ${startMarker}`);
  return src.slice(start, end);
}

function produto(saldoA, saldoB, resA = 0, resB = 0, extra = {}) {
  return {
    id: 611,
    nome: 'Produto teste',
    categoria: 'Açougue',
    saldo_fiscal: saldoA,
    saldo_nao_fiscal: saldoB,
    estoque_atual: saldoA + saldoB,
    reservado_fiscal: resA,
    reservado_nao_fiscal: resB,
    item_fiscal: 1,
    controla_estoque: 1,
    ...extra
  };
}

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

/** Caminho do pré-cálculo (VendaPagamentoService.preCalcularDistribuicao). */
function saldosPreCalculo(p, qtd) {
  const motor = saldosDisponiveisMotorFxNf(p);
  return saldosParaDistribuicaoVenda(p, qtd, motor.saldoFiscal, motor.saldoNaoFiscal);
}

/** Caminho da persistência (VendaPagamentoService ~918–962). */
function saldosPersistencia(p, qtd, credito = 0) {
  const calcBase = saldosDisponiveisMotorFxNf(p).estoque;
  const calc = creditarDisponibilidadeComReservaPedido(calcBase, credito);
  return saldosParaDistribuicaoVenda(p, qtd, calc.disponivel_fiscal, calc.disponivel_nao_fiscal);
}

function motor(p, qtd, vendaFiscal, opcoes = {}, saldos = null) {
  const s = saldos || saldosPreCalculo(p, qtd);
  const item = itemBase(qtd);
  return distribuirItensVendaComValorFiscalEfetivo([{
    item,
    saldoFiscal: s.saldoFiscal,
    saldoNaoFiscal: s.saldoNaoFiscal,
    controlaEstoque: Number(p.controla_estoque) !== 0,
    itemFiscal: Number(p.item_fiscal || 0),
    produto: p
  }], vendaFiscal, {
    pagamentos: [{ forma_pagamento: 'pix', valor: item.subtotal }],
    midpAtivo: false,
    permitirVendaSemEstoque: false,
    ...opcoes
  });
}

function carregarPdv({ vendaSemEstoque = false, transferencia = false, f12 = false } = {}) {
  const factory = new Function(`
    let produtosDisponiveis = [];
    let flagVendaSemEstoque = ${vendaSemEstoque === true};
    function pdvPermitirVendaSemEstoque() { return flagVendaSemEstoque === true; }
    function pdvPermitirTransferenciaNaoFiscalFiscal() { return ${transferencia === true}; }
    function pdvModoFiscalAtivo() { return ${f12 === true}; }
    function pdvResolverSaldosProduto(produto) {
      const saldoFiscal = Number(produto.saldo_fiscal ?? 0);
      const saldoNaoFiscal = Number(produto.saldo_nao_fiscal ?? 0);
      return { saldo_fiscal: saldoFiscal, saldo_nao_fiscal: saldoNaoFiscal, estoque_atual: saldoFiscal + saldoNaoFiscal };
    }
    ${extract(pdvSrc, 'function pdvCategoriaElegivelVendaSemEstoque', 'function validarEstoqueVenda')}
    ${extract(pdvSrc, 'function distribuirQuantidadeVendaLocal', 'async function precalcularDistribuicaoFiscalVenda')}
    ${extract(pdvSrc, 'function round3TransferenciaPdv', 'function abrirModalTransferirEstoquePdv')}
    ${extract(pdvSrc, 'function produtoControlaEstoquePdv', 'function formatarSaldoPdvMensagem')}
    ${extract(pdvSrc, 'function validarEstoqueVenda', 'function pdvNotificarBloqueioInclusaoProduto')}
    return {
      setCatalogo(lista) { produtosDisponiveis = lista; },
      pdvSaldosDisponiveisMotorProduto,
      pdvResolverSaldosProduto,
      calcularDistribuicaoFiscalLocal,
      pdvAnalisarTransferenciaEstoque,
      validarEstoqueVenda
    };
  `);
  return factory();
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

describe('Sprint 3 — contrato da fonte única (T1–T6)', () => {
  it('T1 — A=1 B=1 sem reserva → disp A1 B1', () => {
    const d = saldosDisponiveisMotorFxNf(produto(1, 1));
    assert.deepEqual([d.saldoFiscal, d.saldoNaoFiscal], [1, 1]);
  });

  it('T2 — A=1 B=1 reservaB=1 → disp A1 B0', () => {
    const d = saldosDisponiveisMotorFxNf(produto(1, 1, 0, 1));
    assert.deepEqual([d.saldoFiscal, d.saldoNaoFiscal], [1, 0]);
  });

  it('T3 — A=2 reservaA=1 B=3 → disp A1 B3', () => {
    const d = saldosDisponiveisMotorFxNf(produto(2, 3, 1, 0));
    assert.deepEqual([d.saldoFiscal, d.saldoNaoFiscal], [1, 3]);
  });

  it('T4 — A=0 B=0 → disp A0 B0', () => {
    const d = saldosDisponiveisMotorFxNf(produto(0, 0));
    assert.deepEqual([d.saldoFiscal, d.saldoNaoFiscal], [0, 0]);
  });

  it('T5 — físico preservado no retorno (físico ≠ disponível)', () => {
    const d = saldosDisponiveisMotorFxNf(produto(1, 1, 0, 1));
    assert.equal(d.estoque.saldo_nao_fiscal, 1);
    assert.equal(d.estoque.reservado_nao_fiscal, 1);
    assert.equal(d.estoque.disponivel_nao_fiscal, 0);
    assert.equal(d.estoque.estoque_fisico, 2);
  });

  it('T6 — reserva > saldo: comportamento atual documentado (clamp em 0, nunca negativo)', () => {
    const d = saldosDisponiveisMotorFxNf(produto(1, 1, 3, 5));
    assert.equal(d.saldoFiscal, 0);
    assert.equal(d.saldoNaoFiscal, 0);
    assert.equal(d.estoque.disponivel_total, 0);
  });
});

describe('Sprint 3 — distribuição (T7–T10)', () => {
  it('T7 — A1 B1 reservaB1 qty2 fiscal semEstoque → 2A+0B (Sprint 7: excedente fiscal; reserva B intacta)', () => {
    const row = motor(produto(1, 1, 0, 1), 2, true, { permitirVendaSemEstoque: true }).itens[0];
    assert.equal(row.quantidade_fiscal, 2);
    assert.equal(row.quantidade_nao_fiscal, 0);
  });

  it('T8 — A1 B1 sem reserva qty2 → 1A+1B', () => {
    const row = motor(produto(1, 1), 2, true).itens[0];
    assert.equal(row.quantidade_fiscal, 1);
    assert.equal(row.quantidade_nao_fiscal, 1);
  });

  it('T9 — A2 B3 qty10 semEstoque item_fiscal=1 → 7A+3B (Sprint 7: excedente segue item_fiscal)', () => {
    const row = motor(produto(2, 3), 10, true, { permitirVendaSemEstoque: true }).itens[0];
    assert.equal(row.quantidade_fiscal, 7);
    assert.equal(row.quantidade_nao_fiscal, 3);
  });

  it('T10 — A0 B0 fallback item_fiscal preservado; controla_estoque=0 sem validação', () => {
    const a = distribuirQuantidadeVenda(2, 0, 0, true, { permitirVendaSemEstoque: true, itemFiscal: 1 });
    const b = distribuirQuantidadeVenda(2, 0, 0, true, { permitirVendaSemEstoque: true, itemFiscal: 0 });
    assert.deepEqual([a.quantidadeFiscal, a.quantidadeNaoFiscal], [2, 0]);
    assert.deepEqual([b.quantidadeFiscal, b.quantidadeNaoFiscal], [0, 2]);

    const semControle = motor(produto(0, 0, 0, 0, { controla_estoque: 0 }), 3, true);
    assert.equal(semControle.sucesso, true);
    assert.equal(semControle.itens[0].quantidade_fiscal, 3);
  });

  it('distribuidor não calcula saldo − reserva internamente', () => {
    assert.doesNotMatch(distSrc, /reservado_(fiscal|nao_fiscal)/);
  });
});

describe('Sprint 3 — pré-cálculo × persistência', () => {
  it('A1 B1 reservaB1 qty2: pré-cálculo e persistência → 2A+0B (Sprint 7)', () => {
    const p = produto(1, 1, 0, 1);
    const pre = saldosPreCalculo(p, 2);
    const per = saldosPersistencia(p, 2);
    assert.deepEqual(pre, per);
    const rowPre = motor(p, 2, true, { permitirVendaSemEstoque: true }, pre).itens[0];
    const rowPer = motor(p, 2, true, { permitirVendaSemEstoque: true }, per).itens[0];
    assert.deepEqual(
      [rowPre.quantidade_fiscal, rowPre.quantidade_nao_fiscal],
      [rowPer.quantidade_fiscal, rowPer.quantidade_nao_fiscal]
    );
    assert.deepEqual([rowPer.quantidade_fiscal, rowPer.quantidade_nao_fiscal], [2, 0]);
  });

  it('backend: pagamento (pré-cálculo + persistência) e entrega usam saldosDisponiveisMotorFxNf', () => {
    assert.ok(pagSrc.split('saldosDisponiveisMotorFxNf(').length - 1 >= 2);
    assert.match(entregaSrc, /saldosDisponiveisMotorFxNf\(produto\)\.estoque/);
  });

  it('PDV: cálculo local usa a mesma disponibilidade (sem reserva inline)', () => {
    const calc = extract(pdvSrc, 'function calcularDistribuicaoFiscalLocal', 'async function precalcularDistribuicaoFiscalVenda');
    assert.match(calc, /pdvSaldosDisponiveisMotorProduto\(/);
    assert.doesNotMatch(calc, /reservado_(fiscal|nao_fiscal)/);

    const pdv = carregarPdv({ vendaSemEstoque: true });
    const p = produto(1, 1, 0, 1);
    pdv.setCatalogo([p]);
    const d = pdv.pdvSaldosDisponiveisMotorProduto(p);
    const back = saldosDisponiveisMotorFxNf(p);
    assert.deepEqual([d.saldo_fiscal, d.saldo_nao_fiscal], [back.saldoFiscal, back.saldoNaoFiscal]);

    const local = pdv.calcularDistribuicaoFiscalLocal([{ produto_id: 611, quantidade: 2, preco_unitario: 5.39 }], true);
    assert.equal(local.sucesso, false, 'Sprint 8: excedente só é decidido pelo motor do backend');
    assert.match(local.error, /distribuição fiscal oficial/);

    const mercearia = produto(0, 0, 0, 0, { categoria: 'Mercearia' });
    pdv.setCatalogo([mercearia]);
    const bloqueio = pdv.calcularDistribuicaoFiscalLocal([
      { produto_id: mercearia.id, quantidade: 1, preco_unitario: 5.39 }
    ], true);
    assert.equal(bloqueio.sucesso, false);
    assert.match(bloqueio.error, /Saldo insuficiente/);
    assert.doesNotMatch(bloqueio.error, /distribuição fiscal oficial/);
  });

  it('PDV: item do carrinho sem reservado_* herda reserva do catálogo', () => {
    const pdv = carregarPdv();
    pdv.setCatalogo([produto(1, 1, 0, 1)]);
    const d = pdv.pdvSaldosDisponiveisMotorProduto({ id: 611, saldo_fiscal: 1, saldo_nao_fiscal: 1 });
    assert.deepEqual([d.saldo_fiscal, d.saldo_nao_fiscal], [1, 0]);
    assert.equal(d.fisico.saldo_nao_fiscal, 1);
  });

  it('PDV: validação de quantidade usa disponível; bloqueio "zerados" segue físico', () => {
    const pdv = carregarPdv({ vendaSemEstoque: false });
    const r = pdv.validarEstoqueVenda(produto(0, 1, 0, 1), 1);
    assert.equal(r.sucesso, false);
    assert.equal(r.disponivel, 0);
    assert.equal(r.semSaldoTotal, undefined);

    const ok = pdv.validarEstoqueVenda(produto(1, 1, 0, 1), 1);
    assert.equal(ok.sucesso, true);

    const pdvSem = carregarPdv({ vendaSemEstoque: true });
    const conf = pdvSem.validarEstoqueVenda(produto(1, 1, 0, 1), 2);
    assert.equal(conf.sucesso, false);
    assert.equal(conf.confirmarSemEstoque, true);
    assert.equal(conf.disponivel, 1);
  });
});

describe('Sprint 3 — transferência consulta a mesma disponibilidade', () => {
  it('A1 B1 reservaB1 qty2 F12+transf ON: PDV não propõe transferência', () => {
    const pdv = carregarPdv({ transferencia: true, f12: true });
    const analise = pdv.pdvAnalisarTransferenciaEstoque(produto(1, 1, 0, 1), 2, { modoFiscal: true });
    assert.equal(analise.podeTransferir, false);
    assert.equal(analise.devePerguntar, false);
    assert.equal(analise.quantidadeTransferir, 0);
    assert.equal(analise.saldoNaoFiscal, 0);
  });

  it('A1 B1 sem reserva qty2 F12+transf ON: proposta inalterada (1 unidade)', () => {
    const pdv = carregarPdv({ transferencia: true, f12: true });
    const analise = pdv.pdvAnalisarTransferenciaEstoque(produto(1, 1), 2, { modoFiscal: true });
    assert.equal(analise.podeTransferir, true);
    assert.equal(analise.quantidadeTransferir, 1);
  });

  it('backend com disponível A1 B0 + intent não move B reservado para A', () => {
    const p = produto(1, 1, 0, 1);
    const s = saldosPreCalculo(p, 2);
    const prep = prepararEntradasMotorComTransferenciaPdv(
      [{
        item: { ...itemBase(2), transferencia_nao_fiscal_para_fiscal: 1 },
        saldoFiscal: s.saldoFiscal,
        saldoNaoFiscal: s.saldoNaoFiscal,
        controlaEstoque: true,
        itemFiscal: 1
      }],
      { permitido: true }
    );
    const aplicada = prep.sucesso
      ? Number(prep.entradas[0].transferenciaAplicadaEmMemoria || 0)
      : 0;
    assert.equal(aplicada, 0);
  });

  it('transferência desativada não pergunta mesmo com B físico', () => {
    const pdv = carregarPdv({ transferencia: false, f12: true });
    const analise = pdv.pdvAnalisarTransferenciaEstoque(produto(0, 5), 2, { modoFiscal: true });
    assert.equal(analise.devePerguntar, false);
  });
});

const cfgNfe = {
  codigoUf: '23', cnpj: '65957340000150', ie: '073252638', crt: 1, ambiente: 2, serie: 1,
  nomeEmpresa: 'EMPRESA TESTE', logradouro: 'RUA A', numero: '1', bairro: 'CENTRO',
  codigo_municipio: '2307304', municipio_nome: 'JUAZEIRO DO NORTE', uf_sigla: 'CE', cep: '63000000'
};

function xmlDe(row, qtd) {
  return buildNfeXml({
    config: cfgNfe,
    venda: {
      total: qtd * 5.39,
      valor_fiscal: row.valor_fiscal,
      valor_nao_fiscal: row.valor_nao_fiscal,
      desconto: 0,
      cliente_nome: 'CLIENTE',
      cliente_cpf: '12345678909',
      forma_pagamento: 'pix',
      pagamentos: [{ forma_pagamento: 'pix', valor: row.valor_fiscal, tipo_recebimento: 'fiscal' }]
    },
    itens: [{ ...itemBase(qtd), ...row, quantidade: qtd, preco_unitario: 5.39 }],
    numero: 1,
    dadosNfe: { natureza_operacao: 'VENDA', cfop: '5102' }
  }).xmlSemAssinatura;
}

describe('Sprint 3 — fiscal e baixa', () => {
  it('A1 B1 qty2 → qF=1 e qCom=1', () => {
    const row = motor(produto(1, 1), 2, true).itens[0];
    assert.equal(row.quantidade_fiscal, 1);
    assert.match(xmlDe(row, 2), /<qCom>1\.0000<\/qCom>/);
  });

  it('A2 B0 qty2 → qF=2 e qCom=2', () => {
    const row = motor(produto(2, 0), 2, true).itens[0];
    assert.equal(row.quantidade_fiscal, 2);
    assert.match(xmlDe(row, 2), /<qCom>2\.0000<\/qCom>/);
  });

  it('baixa qF=1 qNF=1 → baixa A1 e B1', async () => {
    const { fn, chamadas } = carregarBaixa();
    await new Promise((resolve, reject) => fn(1, 611, 1, 1, (e) => (e ? reject(e) : resolve())));
    assert.deepEqual(chamadas, [{ qtd: 1, itemFiscal: 1 }, { qtd: 1, itemFiscal: 0 }]);
  });

  it('baixa qF=1 qNF=0 → baixa somente A', async () => {
    const { fn, chamadas } = carregarBaixa();
    await new Promise((resolve, reject) => fn(1, 611, 1, 0, (e) => (e ? reject(e) : resolve())));
    assert.deepEqual(chamadas, [{ qtd: 1, itemFiscal: 1 }]);
  });
});

describe('Sprint 3 — preservações', () => {
  it('F12 visual continua só A com saldo físico', () => {
    assert.match(pdvSrc, /function pdvEstoqueDisponivel\(produto\) \{\s*const saldos = pdvResolverSaldosProduto\(produto\);/);
    assert.match(pdvSrc, /function pdvRotuloEstoque\(produto\) \{\s*const saldos = pdvResolverSaldosProduto\(produto\);/);
  });

  it('quantidade_estoque e baixa sem clamp inalterados', () => {
    assert.match(pdvSrc, /itemPayload\.quantidade_estoque = obterQuantidadeEstoqueParaVenda/);
    assert.match(pagSrc, /saldo_fiscal = saldo_fiscal - \?/);
    assert.match(pagSrc, /saldo_nao_fiscal = saldo_nao_fiscal - \?/);
  });
});
