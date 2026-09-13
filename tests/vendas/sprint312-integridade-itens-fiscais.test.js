/**
 * Sprint 3.12 — Integridade dos itens fiscais (quantidades válidas no Motor).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  distribuirItensVendaComValorFiscalEfetivo,
  itemPermiteQuantidadeFracionada,
  itemTemQuantidadeFiscalInvalida,
  corrigirIntegridadeQuantidadesFiscais
} = require('../../backend/services/distribuidorEstoqueVenda');

function picole(id, preco = 2) {
  return {
    produto_id: id,
    quantidade: 1,
    preco_unitario: preco,
    subtotal: preco,
    unidade: 'UN'
  };
}

describe('Sprint 3.12 — classificação de unidades', () => {
  it('KG/L fracionáveis; UN inteira', () => {
    assert.equal(itemPermiteQuantidadeFracionada({ unidade: 'KG' }), true);
    assert.equal(itemPermiteQuantidadeFracionada({ unidade: 'L' }), true);
    assert.equal(itemPermiteQuantidadeFracionada({ produto_fracionado: 1, unidade: 'UN' }), true);
    assert.equal(itemPermiteQuantidadeFracionada({ unidade: 'UN' }), false);
    assert.equal(itemPermiteQuantidadeFracionada({ unidade: 'CX' }), false);
  });
});

describe('Sprint 3.12 — exemplos oficiais', () => {
  it('Exemplo 1: 2 picolés UN · PIX 2,50 + dinheiro 1,50 → fiscal 2,00 (REDUZIR)', () => {
    const out = distribuirItensVendaComValorFiscalEfetivo(
      [
        { item: picole(1), saldoFiscal: 10, saldoNaoFiscal: 10 },
        { item: picole(2), saldoFiscal: 10, saldoNaoFiscal: 10 }
      ],
      true,
      {
        midpAtivo: true,
        pagamentos: [
          { forma_pagamento: 'pix', valor: 2.5 },
          { forma_pagamento: 'dinheiro', valor: 1.5 }
        ]
      }
    );

    assert.equal(out.sucesso, true);
    assert.equal(out.totalVenda, 4);
    assert.equal(out.valorFiscalEfetivo, 2);
    assert.equal(out.valorNaoFiscal, 2);
    assert.equal(out.integridadeQuantidades.aplicada, true);
    assert.equal(out.integridadeQuantidades.passo, 'REDUZIR');
    assert.ok(out.itens.every((i) => !itemTemQuantidadeFiscalInvalida(i)));
    const qFTotal = out.itens.reduce((s, i) => s + Number(i.quantidade_fiscal || 0), 0);
    assert.equal(qFTotal, 1);
  });

  it('Exemplo 2: 3 picolés · PIX 5,50 + dinheiro 0,50 → fiscal 6,00 (COMPLETAR)', () => {
    const out = distribuirItensVendaComValorFiscalEfetivo(
      [
        { item: picole(1), saldoFiscal: 10, saldoNaoFiscal: 10 },
        { item: picole(2), saldoFiscal: 10, saldoNaoFiscal: 10 },
        { item: picole(3), saldoFiscal: 10, saldoNaoFiscal: 10 }
      ],
      true,
      {
        midpAtivo: true,
        pagamentos: [
          { forma_pagamento: 'pix', valor: 5.5 },
          { forma_pagamento: 'dinheiro', valor: 0.5 }
        ]
      }
    );

    assert.equal(out.sucesso, true);
    assert.equal(out.totalVenda, 6);
    assert.equal(out.valorFiscalEfetivo, 6);
    assert.equal(out.valorNaoFiscal, 0);
    assert.equal(out.integridadeQuantidades.aplicada, true);
    assert.equal(out.integridadeQuantidades.passo, 'COMPLETAR');
    assert.ok(out.itens.every((i) => !itemTemQuantidadeFiscalInvalida(i)));
    const qFTotal = out.itens.reduce((s, i) => s + Number(i.quantidade_fiscal || 0), 0);
    assert.equal(qFTotal, 3);
  });

  it('Exemplo 3: açúcar KG mantém efetivo 2,50 sem ajuste', () => {
    const item = {
      produto_id: 9,
      quantidade: 1.25,
      preco_unitario: 3.2,
      subtotal: 4,
      unidade: 'KG',
      produto_fracionado: 1
    };
    const out = distribuirItensVendaComValorFiscalEfetivo(
      [{ item, saldoFiscal: 10, saldoNaoFiscal: 10 }],
      true,
      {
        midpAtivo: true,
        pagamentos: [
          { forma_pagamento: 'pix', valor: 2.5 },
          { forma_pagamento: 'dinheiro', valor: 1.5 }
        ]
      }
    );

    assert.equal(out.sucesso, true);
    assert.equal(out.totalVenda, 4);
    assert.equal(out.valorFiscalEfetivo, 2.5);
    assert.equal(out.integridadeQuantidades.aplicada, false);
    assert.ok(itemPermiteQuantidadeFracionada(out.itens[0]));
    assert.ok(!itemTemQuantidadeFiscalInvalida(out.itens[0]));
  });
});

describe('Sprint 3.12 — isolamento', () => {
  it('não altera MIDP / emissores / VPS (smoke)', () => {
    const root = path.join(__dirname, '../..');
    for (const rel of [
      'backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js',
      'backend/services/fiscal/emissor.js',
      'backend/services/fiscal/nfeEmissorVenda.js',
      'backend/services/vendas/VendaPagamentoService.js'
    ]) {
      assert.ok(fs.existsSync(path.join(root, rel)), rel);
    }
    const motor = fs.readFileSync(
      path.join(root, 'backend/services/distribuidorEstoqueVenda.js'),
      'utf8'
    );
    assert.match(motor, /corrigirIntegridadeQuantidadesFiscais/);
    assert.match(motor, /Sprint 3\.12/);
  });

  it('corrigirIntegridade é no-op quando já válido', () => {
    const r = corrigirIntegridadeQuantidadesFiscais(
      [{
        unidade: 'UN',
        quantidade: 1,
        preco_unitario: 2,
        subtotal: 2,
        quantidade_fiscal: 1,
        quantidade_nao_fiscal: 0,
        valor_fiscal: 2,
        valor_nao_fiscal: 0,
        quantidade_fiscal_min: 0,
        quantidade_fiscal_max: 1
      }],
      { valorFiscalEfetivoMeta: 2 }
    );
    assert.equal(r.ajusteIntegridadeAplicado, false);
  });
});

describe('schema vendas_itens — valor_nao_fiscal', () => {
  it('database.js cria e migra valor_nao_fiscal em vendas_itens', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../backend/database.js'), 'utf8');
    assert.match(src, /ALTER TABLE vendas_itens ADD COLUMN valor_nao_fiscal REAL DEFAULT 0/);
    assert.match(src, /CREATE TABLE IF NOT EXISTS vendas_itens \([\s\S]*valor_nao_fiscal REAL DEFAULT 0/);
  });
});
