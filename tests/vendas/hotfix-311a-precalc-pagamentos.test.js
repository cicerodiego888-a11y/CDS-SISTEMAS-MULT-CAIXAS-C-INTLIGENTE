/**
 * Hotfix 3.11A — pré-cálculo fiscal do PDV envia pagamentos da venda.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PDV = path.resolve(__dirname, '../../frontend/pdv/js/pdv.js');
const VPS = path.resolve(__dirname, '../../backend/services/vendas/VendaPagamentoService.js');

describe('Hotfix 3.11A — pré-cálculo com pagamentos', () => {
  it('precalcularDistribuicaoFiscalVenda aceita e envia pagamentos', () => {
    const src = fs.readFileSync(PDV, 'utf8');
    assert.match(
      src,
      /async function precalcularDistribuicaoFiscalVenda\(\s*itens,\s*vendaFiscal\s*=\s*false,\s*pagamentos\s*=\s*\[\]\s*,\s*desconto\s*=\s*0,\s*acrescimo\s*=\s*0\s*\)/
    );
    assert.match(src, /pagamentos:\s*pagamentosPayload/);
    assert.match(src, /desconto:\s*Number\(desconto/);
    assert.match(
      src,
      /precalcularDistribuicaoFiscalVenda\(\s*dados\.itens,\s*emitirFiscal,\s*dados\.pagamentos\s*,\s*desconto\s*,\s*acrescimo\s*\)/
    );
  });

  it('não altera assinatura do ramo TEF (3.11B fora de escopo)', () => {
    const src = fs.readFileSync(PDV, 'utf8');
    assert.match(src, /processarVendaFiscalNaoFiscal\(dados,\s*totalFiscal\)/);
    assert.match(src, /deveUsarTefAutomatico && totalFiscal > 0/);
  });

  it('backend do pré-cálculo já consome req.body.pagamentos', () => {
    const src = fs.readFileSync(VPS, 'utf8');
    assert.match(src, /function preCalcularDistribuicao/);
    assert.match(src, /req\.body\?\.pagamentos/);
    assert.match(src, /pagamentos:\s*pagamentosPre/);
  });

  it('Motor / MIDP / VAS intactos (smoke)', () => {
    const files = [
      'backend/services/distribuidorEstoqueVenda.js',
      'backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js',
      'backend/services/vendas/VendaApplicationService.js'
    ];
    for (const rel of files) {
      assert.ok(fs.existsSync(path.resolve(__dirname, '../..', rel)), rel);
    }
  });
});
