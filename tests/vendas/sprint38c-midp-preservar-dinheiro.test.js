/**
 * Sprint 3.8C — MIDP V1 consolidado: política única PRESERVAR DINHEIRO + log auditoria
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  calcularValorFiscalEfetivo,
  distribuirItensVendaComValorFiscalEfetivo
} = require('../../backend/services/distribuidorEstoqueVenda');
const midp = require('../../backend/services/midp');
const OrquestradorPagamento = require('../../backend/services/OrquestradorPagamento');

const root = path.join(__dirname, '../..');

describe('Sprint 3.8C — política oficial PRESERVAR DINHEIRO', () => {
  it('exporta política única (sem Factory / sem políticas paralelas)', () => {
    assert.equal(midp.POLITICA_PRESERVAR_DINHEIRO, 'PRESERVAR_DINHEIRO');
    assert.equal(midp.VERSAO_MIDP, '3.8C');
    assert.equal(midp.MODO_PRESERVACAO_DINHEIRO, 'PRESERVAR_DINHEIRO');
    const src = fs.readFileSync(
      path.join(root, 'backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js'),
      'utf8'
    );
    assert.doesNotMatch(src, /\bcreatePolicy\b|\bPolicyFactory\b|\bopenai\b|\bnovaPolitica\b/);
    assert.match(src, /PRESERVAR_DINHEIRO/);
  });

  it('cenários obrigatórios: só fiscal / só NF / misto / meios', () => {
    const soFiscal = midp.executar({
      pagamentosComerciais: [{ forma_pagamento: 'pix', valor: 100 }],
      valorFiscalEfetivo: 100,
      valorNaoFiscal: 0,
      valorFiscalMaximo: 100,
      emitirLog: false
    });
    assert.equal(soFiscal.saldoFiscal, 0);
    assert.equal(soFiscal.pagamentoFiscal[0].forma_pagamento, 'pix');

    const soNf = midp.executar({
      pagamentosComerciais: [{ forma_pagamento: 'dinheiro', valor: 80 }],
      valorFiscalEfetivo: 0,
      valorNaoFiscal: 80,
      valorFiscalMaximo: 0,
      emitirLog: false
    });
    assert.equal(soNf.pagamentoNaoFiscal[0].valor, 80);
    assert.equal(soNf.auditoria.dinheiroPreservado, 80);

    const pixDin = midp.executar({
      pagamentosComerciais: [
        { forma_pagamento: 'pix', valor: 500 },
        { forma_pagamento: 'dinheiro', valor: 550 }
      ],
      valorFiscalEfetivo: 500,
      valorNaoFiscal: 550,
      valorFiscalMaximo: 550,
      midpAtivo: true,
      emitirLog: false
    });
    assert.equal(pixDin.pagamentoFiscal.find((p) => p.forma_pagamento === 'pix').valor, 500);
    assert.equal(pixDin.pagamentoNaoFiscal.find((p) => p.forma_pagamento === 'dinheiro').valor, 550);
    assert.equal(pixDin.auditoria.dinheiroPreservado, 550);
    assert.equal(pixDin.auditoria.motivo, 'Distribuição válida');
    assert.equal(pixDin.politica, midp.POLITICA_PRESERVAR_DINHEIRO);

    const cartaoDin = midp.executar({
      pagamentosComerciais: [
        { forma_pagamento: 'cartao_credito', valor: 40 },
        { forma_pagamento: 'dinheiro', valor: 60 }
      ],
      valorFiscalEfetivo: 40,
      valorNaoFiscal: 60,
      valorFiscalMaximo: 40,
      emitirLog: false
    });
    assert.equal(cartaoDin.saldoFiscal, 0);
    assert.equal(cartaoDin.auditoria.dinheiroPreservado, 60);

    const triplo = midp.executar({
      pagamentosComerciais: [
        { forma_pagamento: 'pix', valor: 30 },
        { forma_pagamento: 'cartao_debito', valor: 20 },
        { forma_pagamento: 'dinheiro', valor: 50 }
      ],
      valorFiscalEfetivo: 50,
      valorNaoFiscal: 50,
      valorFiscalMaximo: 70,
      emitirLog: false
    });
    assert.equal(triplo.saldoFiscal, 0);
    assert.equal(triplo.saldoNaoFiscal, 0);
    assert.equal(triplo.auditoria.dinheiroPreservado, 50);
    assert.ok(triplo.pagamentoFiscal.every((p) => p.forma_pagamento !== 'dinheiro'));
  });

  it('Motor: sem alternativa válida → efetivo = máximo (não força)', () => {
    const r = calcularValorFiscalEfetivo({
      valorFiscalMaximo: 550,
      valorFiscalMinimo: 550,
      totalVenda: 1050,
      pagamentos: [
        { forma_pagamento: 'pix', valor: 500 },
        { forma_pagamento: 'dinheiro', valor: 550 }
      ],
      midpAtivo: true
    });
    assert.equal(r.valorFiscalEfetivo, 550);
    assert.equal(r.preservacaoAplicada, false);
  });

  it('pipeline oficial: total inalterado; produtos/preços intactos', () => {
    const item = { produto_id: 1, quantidade: 105, preco_unitario: 10, subtotal: 1050 };
    const out = distribuirItensVendaComValorFiscalEfetivo(
      [{ item, saldoFiscal: 55, saldoNaoFiscal: 55 }],
      true,
      {
        midpAtivo: true,
        pagamentos: [
          { forma_pagamento: 'pix', valor: 500 },
          { forma_pagamento: 'dinheiro', valor: 550 }
        ]
      }
    );
    assert.equal(out.totalVenda, 1050);
    assert.equal(out.valorFiscalEfetivo + out.valorNaoFiscal, 1050);
    assert.equal(out.itens[0].quantidade, 105);
    assert.equal(out.itens[0].preco_unitario, 10);
  });
});

describe('Sprint 3.8C — log técnico de auditoria', () => {
  it('formatarLogAuditoriaMidp segue o contrato [MIDP]', () => {
    const texto = midp.formatarLogAuditoriaMidp({
      valorFiscalMaximo: 550,
      valorFiscalEfetivo: 500,
      valorNaoFiscal: 550,
      politicaAtiva: true,
      dinheiroPreservado: 550,
      motivo: 'Distribuição válida'
    });
    assert.match(texto, /^\[MIDP\]/);
    assert.match(texto, /Fiscal Máximo\.+R\$ 550,00/);
    assert.match(texto, /Fiscal Efetivo\.+R\$ 500,00/);
    assert.match(texto, /Não Fiscal\.+R\$ 550,00/);
    assert.match(texto, /Política\.+Preservar Dinheiro/);
    assert.match(texto, /Dinheiro preservado\.+R\$ 550,00/);
    assert.match(texto, /Motivo\.+Distribuição válida/);
  });

  it('executar inclui auditoria sem expor ao operador (campo interno)', () => {
    const r = midp.executar({
      pagamentosComerciais: [{ forma_pagamento: 'dinheiro', valor: 10 }],
      valorFiscalEfetivo: 0,
      valorNaoFiscal: 10,
      valorFiscalMaximo: 0,
      emitirLog: false
    });
    assert.ok(r.auditoria);
    assert.ok(r.logAuditoria.includes('[MIDP]'));
    assert.equal(r.versao, '3.8C');
  });
});

describe('Sprint 3.8C — PDV / Pedido / Faturamento via MIDP único', () => {
  it('Orquestrador chama midp.executar (única distribuição)', () => {
    const src = fs.readFileSync(
      path.join(root, 'backend/services/OrquestradorPagamento.js'),
      'utf8'
    );
    assert.match(src, /midp\.executar/);
    assert.match(src, /valorFiscalEfetivo/);
    assert.match(src, /PRESERVAR DINHEIRO|PRESERVAR_DINHEIRO|3\.8C/);
  });

  it('VendaPagamentoService e Entrega usam Orquestrador (sem distribuição paralela)', () => {
    const venda = fs.readFileSync(
      path.join(root, 'backend/services/vendas/VendaPagamentoService.js'),
      'utf8'
    );
    const entrega = fs.readFileSync(
      path.join(root, 'backend/services/entrega/MotorFinalizacaoVenda.js'),
      'utf8'
    );
    const fat = fs.readFileSync(
      path.join(root, 'backend/services/faturamento/FaturamentoService.js'),
      'utf8'
    );
    assert.match(venda, /OrquestradorPagamento\.processarFluxoPagamentoVenda/);
    assert.match(entrega, /OrquestradorPagamento\.processarFluxoPagamentoVenda/);
    assert.match(fat, /VendaApplicationService|criarVenda/);
    assert.doesNotMatch(venda, /recebimentosFiscal\s*=\s*\[/);
    assert.doesNotMatch(entrega, /PRIORIDADE_FORMAS/);
  });

  it('PDV não implementa distribuição F×NF de pagamentos', () => {
    const pdvDir = path.join(root, 'frontend/pdv/js');
    if (!fs.existsSync(pdvDir)) return;
    const files = fs.readdirSync(pdvDir).filter((f) => f.endsWith('.js'));
    for (const f of files) {
      const src = fs.readFileSync(path.join(pdvDir, f), 'utf8');
      assert.doesNotMatch(src, /recebimentosFiscal|alocarPagamentosLegado|PRIORIDADE_FORMAS/);
    }
  });

  it('Orquestrador propaga valorFiscalMaximo para auditoria MIDP', async () => {
    const r = await OrquestradorPagamento.processarFluxoPagamentoVenda({
      totalFiscal: 500,
      totalNaoFiscal: 550,
      formaPagamento: 'misto',
      pagamentos: [
        { forma_pagamento: 'pix', valor: 500 },
        { forma_pagamento: 'dinheiro', valor: 550 }
      ],
      tefHabilitado: false,
      modoConfirmacaoFiscal: 'MANUAL',
      valorFiscalMaximo: 550,
      preservacaoAplicada: true
    });
    assert.equal(r.sucesso, true);
    assert.ok(r.distribuicao.midp);
    assert.equal(r.distribuicao.midp.auditoria.valorFiscalMaximo, 550);
    assert.equal(r.distribuicao.midp.auditoria.valorFiscalEfetivo, 500);
    assert.equal(r.distribuicao.midp.auditoria.dinheiroPreservado, 550);
  });
});

describe('Sprint 3.8C — soberania fiscal / sem regressão estrutural', () => {
  it('emissores NF-e/NFC-e intactos (sem alteração nesta sprint)', () => {
    const nfe = fs.readFileSync(path.join(root, 'backend/services/fiscal/xmlBuilderNfeVenda.js'), 'utf8');
    const nfce = fs.readFileSync(path.join(root, 'backend/services/fiscal/xmlBuilder.js'), 'utf8');
    assert.match(nfe, /quantidade_fiscal|itemEntraNaNfe/);
    assert.match(nfce, /obterValorFiscalItem|quantidade_fiscal/);
  });

  it('DistribuidorPagamento permanece adaptador fino do MIDP', () => {
    const src = fs.readFileSync(
      path.join(root, 'backend/services/DistribuidorPagamento.js'),
      'utf8'
    );
    assert.match(src, /midp\.distribuirPagamentos/);
    assert.doesNotMatch(src, /PRIORIDADE_FORMAS/);
  });
});
