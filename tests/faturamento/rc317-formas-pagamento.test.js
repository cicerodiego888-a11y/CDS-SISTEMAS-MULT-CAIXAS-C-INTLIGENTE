/**
 * RC3.17 — Formas de pagamento do Faturamento / componente compartilhado.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('RC3.17 — componente CdsFormasPagamento', () => {
  it('expõe formas oficiais e painéis condicionais', () => {
    const api = require('../../frontend/shared/js/cds-formas-pagamento.js');
    const values = api.FORMAS.map((f) => f.value);
    assert.ok(values.includes('dinheiro'));
    assert.ok(values.includes('pix'));
    assert.ok(values.includes('cartao_debito'));
    assert.ok(values.includes('cartao_credito'));
    assert.ok(values.includes('boleto'));
    assert.ok(values.includes('transferencia'));
    assert.ok(values.includes('deposito'));
    assert.ok(values.includes('crediario'));
    assert.ok(values.includes('parcelado'));
    assert.equal(api.ehParcelavel('parcelado'), true);
    assert.equal(api.ehBoleto('boleto'), true);
    assert.match(api.htmlPaineisExtras('fat'), /PainelParcelado/);
    assert.match(api.htmlPaineisExtras('fat'), /PainelBoleto/);
  });
});

describe('RC3.17 — UI Expedição e Avulsa', () => {
  it('Expedição usa CdsFormasPagamento', () => {
    const fat = read('frontend/erp/js/faturamento.js');
    const index = read('frontend/erp/index.html');
    assert.match(index, /cds-formas-pagamento\.js/);
    assert.match(fat, /CdsFormasPagamento/);
    assert.match(fat, /montarPayloadPagamento/);
    assert.match(fat, /boleto|parcelado/);
  });

  it('NF-e Avulsa reutiliza o mesmo componente', () => {
    const av = read('frontend/erp/js/nfe-avulsa.js');
    assert.match(av, /CdsFormasPagamento/);
    assert.match(av, /montarPayloadPagamento/);
  });
});

describe('RC3.17 — núcleo financeiro existente', () => {
  it('VendaPagamentoService aceita parcelado/boleto/crediario no caminho a prazo', () => {
    const src = read('backend/services/vendas/VendaPagamentoService.js');
    assert.match(src, /formaGeraParcelasFinanceiras/);
    assert.match(src, /parcelado/);
    assert.match(src, /crediario/);
    assert.match(src, /boleto/);
    assert.match(src, /avancarVencimentoParcela/);
    assert.match(src, /intervalo_parcelas/);
  });

  it('FaturamentoService encaminha parcelas sem novo motor', () => {
    const src = read('backend/services/faturamento/FaturamentoService.js');
    assert.match(src, /primeiro_vencimento/);
    assert.match(src, /intervalo_parcelas/);
    assert.doesNotMatch(src, /novoMotorFinanceiro|MotorFinanceiroParalelo/);
  });
});
