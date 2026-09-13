/**
 * RC8.2 — Ativação do MPFC (Comercial + F×NF FIXA/FLEXÍVEL + snapshot).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const mpfc = require('../../backend/services/mpfc');
const {
  calcularValorFiscalEfetivo,
  distribuirItensVendaComValorFiscalEfetivo
} = require('../../backend/services/distribuidorEstoqueVenda');
const midp = require('../../backend/services/midp');

const root = path.join(__dirname, '../..');

describe('RC8.2 — MPFC ativação', () => {
  it('MPFC mapeia config → política (FIXA + preservarDinheiro=ativar_midp)', () => {
    const off = mpfc.obterPolitica({
      emitirLog: false,
      config: { ativar_midp: false, mpfc_modo: 'FIXA' }
    });
    assert.equal(off.modo, 'FIXA');
    assert.equal(off.preservarDinheiro, false);
    assert.equal(off.codigoPolitica, 'FIXA_PADRAO');

    const on = mpfc.obterPolitica({
      emitirLog: false,
      config: { ativar_midp: true, mpfc_modo: 'FIXA' }
    });
    assert.equal(on.preservarDinheiro, true);
    assert.equal(on.codigoPolitica, 'FIXA_PRESERVAR_DINHEIRO');
  });

  it('MPFC modo FLEXIVEL com percentual', () => {
    const p = mpfc.obterPolitica({
      emitirLog: false,
      config: {
        mpfc_modo: 'FLEXIVEL',
        mpfc_percentual_dinheiro_fiscal: 10,
        ativar_midp: true
      }
    });
    assert.equal(p.modo, 'FLEXIVEL');
    assert.equal(p.percentualDinheiroFiscal, 10);
    assert.equal(p.preservarDinheiro, false);
    assert.equal(p.codigoPolitica, 'FLEXIVEL');
  });

  it('FIXA reproduz comportamento midp off/on (paridade 3.8B)', () => {
    const pagamentos = [
      { forma_pagamento: 'pix', valor: 500 },
      { forma_pagamento: 'dinheiro', valor: 550 }
    ];
    const base = {
      valorFiscalMaximo: 550,
      valorFiscalMinimo: 500,
      totalVenda: 1050,
      pagamentos
    };

    const legadoOff = calcularValorFiscalEfetivo({ ...base, midpAtivo: false });
    const fixaOff = calcularValorFiscalEfetivo({
      ...base,
      midpAtivo: false,
      politicaFiscalComercial: mpfc.criarPoliticaFiscalComercialV1({
        modo: 'FIXA',
        preservarDinheiro: false
      })
    });
    assert.equal(fixaOff.valorFiscalEfetivo, legadoOff.valorFiscalEfetivo);
    assert.equal(fixaOff.preservacaoAplicada, legadoOff.preservacaoAplicada);

    const legadoOn = calcularValorFiscalEfetivo({ ...base, midpAtivo: true });
    const fixaOn = calcularValorFiscalEfetivo({
      ...base,
      midpAtivo: true,
      politicaFiscalComercial: mpfc.criarPoliticaFiscalComercialV1({
        modo: 'FIXA',
        preservarDinheiro: true
      })
    });
    assert.equal(fixaOn.valorFiscalEfetivo, 500);
    assert.equal(fixaOn.valorFiscalEfetivo, legadoOn.valorFiscalEfetivo);
    assert.equal(fixaOn.preservacaoAplicada, true);
  });

  it('FLEXÍVEL: PIX 300 + Dinheiro 200 + 10% → fiscal 320 / NF 180', () => {
    const politica = mpfc.criarPoliticaFiscalComercialV1({
      modo: 'FLEXIVEL',
      percentualDinheiroFiscal: 10
    });
    const r = calcularValorFiscalEfetivo({
      valorFiscalMaximo: 500,
      valorFiscalMinimo: 0,
      totalVenda: 500,
      pagamentos: [
        { forma_pagamento: 'pix', valor: 300 },
        { forma_pagamento: 'dinheiro', valor: 200 }
      ],
      politicaFiscalComercial: politica
    });
    assert.equal(r.modoPolitica, 'FLEXIVEL');
    assert.equal(r.valorFiscalEfetivo, 320);
    assert.equal(r.valorNaoFiscal, 180);
    assert.equal(r.dinheiroPermitidoFiscal, 20);

    const aloc = midp.alocarPagamentos(
      [
        { forma_pagamento: 'pix', valor: 300 },
        { forma_pagamento: 'dinheiro', valor: 200 }
      ],
      320,
      180
    );
    const pixFiscal = aloc.recebimentosFiscal
      .filter((p) => p.forma_pagamento === 'pix')
      .reduce((s, p) => s + p.valor, 0);
    const dinFiscal = aloc.recebimentosFiscal
      .filter((p) => p.forma_pagamento === 'dinheiro')
      .reduce((s, p) => s + p.valor, 0);
    const dinNf = aloc.recebimentosNaoFiscal
      .filter((p) => p.forma_pagamento === 'dinheiro')
      .reduce((s, p) => s + p.valor, 0);
    assert.equal(pixFiscal, 300);
    assert.equal(dinFiscal, 20);
    assert.equal(dinNf, 180);
  });

  it('cenários: só PIX / só dinheiro / PIX+cartão+dinheiro', () => {
    const flex10 = mpfc.criarPoliticaFiscalComercialV1({
      modo: 'FLEXIVEL',
      percentualDinheiroFiscal: 10
    });

    const soPix = calcularValorFiscalEfetivo({
      valorFiscalMaximo: 200,
      valorFiscalMinimo: 0,
      totalVenda: 200,
      pagamentos: [{ forma_pagamento: 'pix', valor: 200 }],
      politicaFiscalComercial: flex10
    });
    assert.equal(soPix.valorFiscalEfetivo, 200);

    const soDin = calcularValorFiscalEfetivo({
      valorFiscalMaximo: 200,
      valorFiscalMinimo: 0,
      totalVenda: 200,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 200 }],
      politicaFiscalComercial: flex10
    });
    assert.equal(soDin.valorFiscalEfetivo, 20);

    const triplo = calcularValorFiscalEfetivo({
      valorFiscalMaximo: 500,
      valorFiscalMinimo: 0,
      totalVenda: 500,
      pagamentos: [
        { forma_pagamento: 'pix', valor: 100 },
        { forma_pagamento: 'cartao_credito', valor: 200 },
        { forma_pagamento: 'dinheiro', valor: 200 }
      ],
      politicaFiscalComercial: flex10
    });
    // eletrônicos 300 + 10% de 200 = 320
    assert.equal(triplo.valorFiscalEfetivo, 320);
  });

  it('Motor Comercial bloqueia margem quando nuncaVenderAbaixoDaMargem=true', () => {
    const politica = mpfc.criarPoliticaFiscalComercialV1({
      margemMinimaSobreOCusto: 20,
      nuncaVenderAbaixoDaMargem: true
    });
    const ok = mpfc.validarMargemMinimaComercial(
      [{ produto_id: 1, preco_unitario: 120 }],
      { 1: { nome: 'A', preco_compra: 100 } },
      politica
    );
    assert.equal(ok.sucesso, true);

    const bloqueio = mpfc.validarMargemMinimaComercial(
      [{ produto_id: 1, preco_unitario: 110 }],
      { 1: { nome: 'A', preco_compra: 100 } },
      politica
    );
    assert.equal(bloqueio.sucesso, false);
    assert.match(bloqueio.error, /margem mínima/i);
  });

  it('Motor Comercial no-op quando nuncaVenderAbaixoDaMargem=false (compatibilidade)', () => {
    const politica = mpfc.criarPoliticaFiscalComercialV1({
      nuncaVenderAbaixoDaMargem: false,
      margemMinimaSobreOCusto: 50
    });
    const r = mpfc.validarMargemMinimaComercial(
      [{ produto_id: 1, preco_unitario: 1 }],
      { 1: { preco_compra: 100 } },
      politica
    );
    assert.equal(r.sucesso, true);
    assert.equal(r.aplicada, false);
  });

  it('snapshot serializado para persistência', () => {
    const politica = mpfc.obterPolitica({
      emitirLog: false,
      config: { ativar_midp: false, mpfc_modo: 'FIXA' }
    });
    const json = mpfc.snapshotParaJson(politica);
    const obj = JSON.parse(json);
    assert.equal(obj.versao, '1.0');
    assert.equal(obj.codigoPolitica, 'FIXA_PADRAO');
    assert.equal(obj.modo, 'FIXA');
    assert.equal(typeof obj.percentualDinheiroFiscal, 'number');
  });

  it('pipeline F×NF ecoa política utilizada=true', () => {
    const politica = mpfc.criarPoliticaFiscalComercialV1({
      modo: 'FLEXIVEL',
      percentualDinheiroFiscal: 10
    });
    // Preço 10 × qtd 50 = 500 → fiscal 320 = 32 unidades (inteiro válido)
    const item = { produto_id: 1, quantidade: 50, preco_unitario: 10, subtotal: 500 };
    const out = distribuirItensVendaComValorFiscalEfetivo(
      [{ item, saldoFiscal: 50, saldoNaoFiscal: 50 }],
      true,
      {
        pagamentos: [
          { forma_pagamento: 'pix', valor: 300 },
          { forma_pagamento: 'dinheiro', valor: 200 }
        ],
        politicaFiscalComercial: politica
      }
    );
    assert.equal(out.sucesso, true);
    assert.equal(out.meta.valorFiscalEfetivo, 320);
    assert.equal(out.valorFiscalEfetivo, 320);
    assert.equal(out.valorNaoFiscal, 180);
    assert.equal(out.politicaFiscalComercialRecebida.utilizada, true);
    assert.equal(out.politicaFiscalComercialRecebida.modo, 'FLEXIVEL');
  });

  it('MIDP e XML não decidem política / não importam MPFC', () => {
    const midpSrc = fs.readFileSync(
      path.join(root, 'backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js'),
      'utf8'
    );
    const xmlSrc = fs.readFileSync(
      path.join(root, 'backend/services/fiscal/xmlBuilder.js'),
      'utf8'
    );
    assert.doesNotMatch(midpSrc, /require\(['\"].*mpfc|PoliticaFiscalComercial|mpfc_modo/);
    assert.doesNotMatch(xmlSrc, /mpfc|PoliticaFiscalComercial/);
  });

  it('coluna snapshot prevista no database.js', () => {
    const dbSrc = fs.readFileSync(path.join(root, 'backend/database.js'), 'utf8');
    assert.match(dbSrc, /mpfc_politica_snapshot/);
  });

  it('VendaPagamentoService persiste snapshot e valida margem', () => {
    const src = fs.readFileSync(
      path.join(root, 'backend/services/vendas/VendaPagamentoService.js'),
      'utf8'
    );
    assert.match(src, /mpfc_politica_snapshot/);
    assert.match(src, /validarMargemPoliticaComercial/);
    assert.match(src, /snapshotParaJson/);
    assert.match(src, /preservarDinheiro/);
  });
});
