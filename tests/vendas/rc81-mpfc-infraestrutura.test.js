/**
 * RC8.1 — MPFC (Motor de Política Fiscal Comercial) — infraestrutura passiva.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const mpfc = require('../../backend/services/mpfc');
const {
  distribuirItensVendaComValorFiscalEfetivo,
  calcularValorFiscalEfetivo
} = require('../../backend/services/distribuidorEstoqueVenda');

const root = path.join(__dirname, '../..');

describe('RC8.1 — MPFC infraestrutura', () => {
  it('MPFC criado e exporta obterPolitica', () => {
    assert.equal(typeof mpfc.obterPolitica, 'function');
    assert.equal(mpfc.MOTOR, 'MPFC');
    assert.equal(mpfc.VERSAO_MOTOR, '8.2.2');
    assert.ok(fs.existsSync(path.join(root, 'backend/services/mpfc/MotorPoliticaFiscalComercial.js')));
    assert.ok(fs.existsSync(path.join(root, 'backend/services/mpfc/PoliticaFiscalComercialV1.js')));
    assert.ok(fs.existsSync(path.join(root, 'backend/services/mpfc/PoliticaFiscalComercialSnapshot.js')));
  });

  it('contrato V1 com defaults oficiais e objeto imutável', () => {
    const p = mpfc.obterPolitica({ emitirLog: false, config: {} });
    assert.equal(p.versao, '1.0');
    assert.equal(p.modo, 'FIXA');
    assert.equal(p.percentualDinheiroFiscal, 0);
    assert.equal(p.margemMinimaSobreOCusto, 20);
    assert.equal(p.nuncaVenderAbaixoDaMargem, false);
    assert.ok(Object.isFrozen(p));
    assert.throws(() => {
      p.modo = 'FLEXIVEL';
    });
  });

  it('stateless: duas chamadas com mesma config são equivalentes e independentes', () => {
    const cfg = { ativar_midp: false, mpfc_modo: 'FIXA' };
    const a = mpfc.obterPolitica({ emitirLog: false, config: cfg });
    const b = mpfc.obterPolitica({ emitirLog: false, config: cfg });
    assert.deepEqual({ ...a }, { ...b });
    assert.notEqual(a, b);
  });

  it('snapshot preparado sem persistência', () => {
    const politica = mpfc.obterPolitica({ emitirLog: false });
    const snap = mpfc.prepararSnapshot(politica);
    assert.equal(snap.persistido, false);
    assert.ok(snap.capturadoEm);
    assert.equal(snap.politica.modo, 'FIXA');
    assert.ok(Object.isFrozen(snap));
  });

  it('emite log MPFC_POLITICA_CARREGADA', () => {
    const logs = [];
    const original = console.log;
    console.log = (...args) => {
      logs.push(args.map(String).join(' '));
    };
    try {
      mpfc.obterPolitica({ emitirLog: true, config: {} });
    } finally {
      console.log = original;
    }
    assert.ok(logs.some((l) => l.includes('MPFC_POLITICA_CARREGADA')));
    assert.ok(logs.some((l) => l.includes('"modo":"FIXA"')));
  });

  it('Motor Comercial e F×NF recebem política sem utilizar', () => {
    const politica = mpfc.obterPolitica({ emitirLog: false });
    const comercial = mpfc.receberPoliticaMotorComercial(politica);
    const fxnf = mpfc.receberPoliticaMotorFiscalNaoFiscal(politica);
    assert.equal(comercial.politicaRecebida, true);
    assert.equal(comercial.politicaUtilizada, false);
    assert.equal(fxnf.politicaRecebida, true);
    assert.equal(fxnf.politicaUtilizada, false);
    assert.equal(comercial.politica, politica);
    assert.equal(fxnf.politica, politica);
  });

  it('VendaPagamentoService integra MPFC de forma passiva', () => {
    const src = fs.readFileSync(
      path.join(root, 'backend/services/vendas/VendaPagamentoService.js'),
      'utf8'
    );
    assert.match(src, /require\('\.\.\/mpfc'\)/);
    assert.match(src, /carregarPoliticaFiscalComercialPassiva/);
    assert.match(src, /politicaFiscalComercial/);
    assert.match(src, /receberPoliticaMotorComercial/);
    assert.match(src, /receberPoliticaMotorFiscalNaoFiscal/);
  });

  it('F×NF recebe política FIXA sem preservar e não altera cálculo (paridade midp off)', () => {
    const politica = mpfc.criarPoliticaFiscalComercialV1({
      modo: 'FIXA',
      preservarDinheiro: false
    });
    const item = { produto_id: 1, quantidade: 10, preco_unitario: 10, subtotal: 100 };
    const entradas = [{ item, saldoFiscal: 10, saldoNaoFiscal: 10 }];

    const semPolitica = distribuirItensVendaComValorFiscalEfetivo(entradas, true, {
      midpAtivo: false,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 100 }]
    });
    const comPolitica = distribuirItensVendaComValorFiscalEfetivo(entradas, true, {
      midpAtivo: false,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 100 }],
      politicaFiscalComercial: politica
    });

    assert.equal(semPolitica.sucesso, true);
    assert.equal(comPolitica.sucesso, true);
    assert.equal(semPolitica.valorFiscalEfetivo, comPolitica.valorFiscalEfetivo);
    assert.equal(semPolitica.valorNaoFiscal, comPolitica.valorNaoFiscal);
    assert.equal(comPolitica.politicaFiscalComercialRecebida.utilizada, true);
    assert.equal(comPolitica.politicaFiscalComercialRecebida.modo, 'FIXA');
  });

  it('calcularValorFiscalEfetivo inalterado (política não entra na função)', () => {
    const r = calcularValorFiscalEfetivo({
      valorFiscalMaximo: 550,
      valorFiscalMinimo: 500,
      totalVenda: 1050,
      pagamentos: [
        { forma_pagamento: 'pix', valor: 500 },
        { forma_pagamento: 'dinheiro', valor: 550 }
      ],
      midpAtivo: true
    });
    assert.equal(r.valorFiscalEfetivo, 500);
    assert.equal(r.preservacaoAplicada, true);
  });

  it('MIDP e XML não importam MPFC', () => {
    const midpSrc = fs.readFileSync(
      path.join(root, 'backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js'),
      'utf8'
    );
    const xmlSrc = fs.readFileSync(
      path.join(root, 'backend/services/fiscal/xmlBuilder.js'),
      'utf8'
    );
    assert.doesNotMatch(midpSrc, /mpfc|MPFC|PoliticaFiscalComercial/);
    assert.doesNotMatch(xmlSrc, /mpfc|MPFC|PoliticaFiscalComercial/);
  });
});
