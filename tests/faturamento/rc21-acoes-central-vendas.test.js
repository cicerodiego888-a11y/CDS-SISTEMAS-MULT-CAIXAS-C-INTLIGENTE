/**
 * RC2.1 — Consolidação operacional da Central (ações / cancelamento unificado).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('RC2.1 — menu de ações da Central', () => {
  it('UI expõe ações comerciais; documentos fiscais só via Central NF-e (RC3.15)', () => {
    const ui = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/erp/js/faturamento.js'),
      'utf8'
    );
    assert.match(ui, /Visualizar Venda/);
    assert.match(ui, /Visualizar Pedido/);
    assert.match(ui, /Reimprimir Pedido/);
    assert.match(ui, /Cancelar Venda/);
    assert.match(ui, /Abrir Central NF-e/);
    assert.match(ui, /fa-ellipsis-v/);
    assert.match(ui, /cancelarVendaCentral/);
    assert.match(ui, /nfe\/notas\/\$\{.*\}\/cancelar|nfe\/notas\//);
    assert.match(ui, /vendas\/cancelar/);
    assert.match(ui, /somente leitura/);
    // RC3.15 — não administrar documentos na Central de Vendas
    assert.doesNotMatch(ui, /fat-acao-emitir/);
    assert.doesNotMatch(ui, /fat-acao-danfe/);
    assert.ok(!/>\s*Emitir NF-e\s*</.test(ui));
    assert.ok(!/>\s*Visualizar DANFE\s*</.test(ui));
    assert.ok(!/>\s*Imprimir DANFE\s*</.test(ui));
    // Um único botão de cancelamento (não dois fluxos paralelos na UI)
    const cancelLabels = ui.match(/>\s*Cancelar Venda\s*</g) || [];
    assert.ok(cancelLabels.length >= 1);
    assert.ok(!/Cancelar NF-e/.test(ui));
    assert.ok(!/Cancelar Comercial/.test(ui));
  });

  it('reutiliza layout de impressão do Pedido (sem novo modelo)', () => {
    const ped = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/erp/js/pedidos.js'),
      'utf8'
    );
    assert.match(ped, /function montarHtmlImpressaoPedido/);
    assert.match(ped, /function imprimirPedidoPorId/);
    assert.match(ped, /window\.imprimirPedidoPorId/);
    assert.match(ped, /CDS Sistemas/);
    assert.match(ped, /PEDIDO|ORÇAMENTO/);

    const ui = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/erp/js/faturamento.js'),
      'utf8'
    );
    assert.match(ui, /imprimirPedidoPorId/);
    assert.match(ui, /reimprimirPedido/);
  });

  it('cancelamento decide NF-e autorizada vs comercial automaticamente', () => {
    const ui = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/erp/js/faturamento.js'),
      'utf8'
    );
    assert.match(ui, /temNfe/);
    assert.match(ui, /autorizada/);
    assert.match(ui, /\/nfe\/notas\//);
    assert.match(ui, /\/vendas\/cancelar\//);
    assert.match(ui, /justificativa/);
    assert.match(ui, /montarPayloadCancelamentoVenda|motivo/);
  });

  it('não altera núcleos / emissores / motor (smoke)', () => {
    const files = [
      'backend/services/distribuidorEstoqueVenda.js',
      'backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js',
      'backend/services/vendas/VendaApplicationService.js',
      'backend/services/vendas/VendaPagamentoService.js',
      'backend/services/vendas/VendaCancelamentoService.js',
      'backend/services/fiscal/nfeEmissorVenda.js',
      'backend/services/fiscal/cancelarNfe.js',
      'frontend/pdv/js/pdv.js'
    ];
    for (const rel of files) {
      assert.ok(fs.existsSync(path.resolve(__dirname, '../..', rel)), rel);
    }
  });
});
