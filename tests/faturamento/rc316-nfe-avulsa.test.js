/**
 * RC3.16 — NF-e Avulsa (porta fiscal → Venda NF_AVULSA → mesmo motor).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const { VendaOrigin, origemPodeConcluirVenda, resolverVendaOrigin } = require('../../backend/services/vendas/VendaOrigin');
const { montarPayloadVendaAvulsa, MSG_F12_OFF } = require('../../backend/services/fiscal/nfeAvulsaService');

describe('RC3.16 — origem NF_AVULSA', () => {
  it('reconhece e conclui venda pela origem NF_AVULSA', () => {
    assert.equal(VendaOrigin.NF_AVULSA, 'NF_AVULSA');
    assert.equal(resolverVendaOrigin('NF_AVULSA'), 'NF_AVULSA');
    assert.equal(origemPodeConcluirVenda(VendaOrigin.NF_AVULSA), true);
    assert.equal(origemPodeConcluirVenda(VendaOrigin.FATURAMENTO), true);
  });

  it('payload avulsa não exige pedido e não dispara NFC-e no núcleo', () => {
    const payload = montarPayloadVendaAvulsa({
      cliente_id: 10,
      itens: [{ produto_id: 1, quantidade: 2, preco_unitario: 5 }],
      forma_pagamento: 'pix',
      natureza_operacao: 'VENDA DE MERCADORIA',
      cfop: '5102'
    });
    assert.equal(payload.origem, 'NF_AVULSA');
    assert.equal(payload.pedido_id, null);
    assert.equal(payload.emitir_fiscal, false);
    assert.equal(payload.itens.length, 1);
    assert.equal(payload.total, 10);
    assert.ok(payload.dadosNfe);
  });

  it('mensagem F12 OFF é a oficial', () => {
    assert.match(MSG_F12_OFF, /não permite emissão de documentos fiscais/i);
  });
});

describe('RC3.16 — superfície UI / API', () => {
  it('rota POST /avulsa e serviço reutilizam emissor existente', () => {
    const rota = read('backend/rotas/nfe.js');
    const svc = read('backend/services/fiscal/nfeAvulsaService.js');
    assert.match(rota, /\/avulsa/);
    assert.match(rota, /emitirNfeAvulsa/);
    assert.match(svc, /emitirNfePorVendaId/);
    assert.match(svc, /criarVendaComContexto/);
    assert.match(svc, /modoOperacionalFiscalAtivo/);
    assert.doesNotMatch(svc, /buildNfeXml|assinarNFe|enviarLote/);
  });

  it('menu Nova NF-e + tela + navegação', () => {
    const index = read('frontend/erp/index.html');
    const app = read('frontend/erp/js/app.js');
    const ui = read('frontend/erp/js/nfe-avulsa.js');
    const core = read('frontend/shared/js/core.js');
    assert.match(index, /data-page="nfe-avulsa"/);
    assert.match(index, /Nova NF-e/);
    assert.match(index, /nfe-avulsa\.js/);
    assert.match(app, /nfe-avulsa/);
    assert.match(app, /loadNfeAvulsa/);
    assert.match(ui, /\/nfe\/avulsa/);
    assert.match(ui, /NF_AVULSA/);
    assert.match(ui, /não permite emissão de documentos fiscais/);
    assert.match(core, /nfe-avulsa/);
  });

  it('Central de Vendas lista NF_AVULSA', () => {
    const fat = read('backend/services/faturamento/FaturamentoService.js');
    const ui = read('frontend/erp/js/faturamento.js');
    assert.match(fat, /NF_AVULSA/);
    assert.match(fat, /NF-e Avulsa/);
    assert.match(ui, /NF_AVULSA/);
  });

  it('não cria novo emissor / XML builder / MIDP paralelo', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/fiscal/nfeEmissorVenda.js')));
    assert.ok(!fs.existsSync(path.join(ROOT, 'backend/services/fiscal/nfeEmissorAvulsa.js')));
    const svc = read('backend/services/fiscal/nfeAvulsaService.js');
    assert.doesNotMatch(svc, /MotorInteligenteDistribuicaoPagamentos/);
  });
});
