/**
 * Sprint 3.11UX — confirmação inteligente do pagamento não fiscal (PDV).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PDV = path.resolve(__dirname, '../../frontend/pdv/js/pdv.js');

describe('Sprint 3.11UX — confirmação pagamento não fiscal', () => {
  it('modal usa forma pré-definida sem perguntar de novo', () => {
    const src = fs.readFileSync(PDV, 'utf8');
    assert.match(src, /function abrirModalPagamentoNaoFiscal\(valor, onConfirm, onCancel, formaPredefinida\)/);
    assert.match(src, /function resolverFormaPagamentoNaoFiscalConhecida/);
    assert.match(src, /Forma de recebimento/);
    assert.match(src, /modoConfirmacao/);
    assert.match(src, /Confirme o recebimento da parcela não fiscal/);
  });

  it('chamadas passam a forma já conhecida', () => {
    const src = fs.readFileSync(PDV, 'utf8');
    assert.match(src, /abrirModalPagamentoNaoFiscal\(\s*totalNaoFiscal[\s\S]*?formaNaoFiscal\s*\)/);
    assert.match(src, /resolverFormaPagamentoNaoFiscalConhecida\(\s*\{\s*pagamentosMistos/);
  });

  it('Cancelar e Confirmar permanecem', () => {
    const src = fs.readFileSync(PDV, 'utf8');
    assert.match(src, />Cancelar</);
    assert.match(src, /id="confirmar-pagamento-nao-fiscal"/);
    assert.match(src, /data-bs-dismiss="modal"/);
  });

  it('não altera Motor / MIDP / TEF / núcleos (smoke)', () => {
    const files = [
      'backend/services/distribuidorEstoqueVenda.js',
      'backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js',
      'backend/services/vendas/VendaPagamentoService.js',
      'backend/services/vendas/VendaApplicationService.js'
    ];
    for (const rel of files) {
      assert.ok(fs.existsSync(path.resolve(__dirname, '../..', rel)), rel);
    }
  });
});
