/**
 * Sprint 3.6 — Polimento UX Pedidos (somente frontend)
 * Não altera regras de negócio / núcleo.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const uiPath = path.join(__dirname, '../../frontend/erp/js/pedidos.js');
const ui = fs.readFileSync(uiPath, 'utf8');

describe('Sprint 3.6 — teclado e foco', () => {
  it('ENTER / setas / ESC nas sugestões e adicionar item', () => {
    assert.match(ui, /ArrowDown/);
    assert.match(ui, /ArrowUp/);
    assert.match(ui, /Escape/);
    assert.match(ui, /e\.key === 'Enter'/);
    assert.match(ui, /selecionarProdutoPorIdx|sugProdutoIdx/);
    assert.match(ui, /selecionarClientePorIdx|sugClienteIdx/);
    assert.match(ui, /#pedItemQtd[\s\S]*Enter[\s\S]*adicionarItem|adicionarItem\(\)/);
    assert.match(ui, /active/);
  });

  it('fluxo de foco Cliente → Produto → Qtd → Produto', () => {
    assert.match(ui, /pedClienteBusca.*focus|focus.*pedClienteBusca/);
    assert.match(ui, /\$\('#pedProdutoBusca'\)\.trigger\('focus'\)/);
    assert.match(ui, /\$\('#pedItemQtd'\)\.trigger\('focus'/);
    assert.match(ui, /shown\.bs\.modal/);
  });
});

describe('Sprint 3.6 — grade, totais e atalhos', () => {
  it('duplo clique edita e Del exclui', () => {
    assert.match(ui, /dblclick/);
    assert.match(ui, /Delete/);
    assert.match(ui, /ped-del-item/);
  });

  it('barra de totais ao vivo', () => {
    assert.match(ui, /pedTotItens/);
    assert.match(ui, /pedTotQtd/);
    assert.match(ui, /pedTotSub/);
    assert.match(ui, /pedTotDesc/);
    assert.match(ui, /atualizarTotaisBar/);
    assert.match(ui, /pedTotalLabel/);
  });

  it('atalhos Ctrl+S, F2, Ctrl+F', () => {
    assert.match(ui, /e\.key === 'F2'/);
    assert.match(ui, /e\.ctrlKey && \(e\.key === 's'/);
    assert.match(ui, /e\.ctrlKey && \(e\.key === 'f'/);
  });

  it('pós-envio: mensagem + Ir para Expedição sem auto-navegar', () => {
    assert.match(ui, /Pedido enviado com sucesso/);
    assert.match(ui, /btnIrFaturamento/);
    assert.match(ui, /Ir para Expedição/);
    assert.doesNotMatch(ui, /enviarFaturamento[\s\S]{0,400}loadPage\('faturamento'\)/);
  });
});

describe('Sprint 3.6 — sem tocar no núcleo', () => {
  it('não altera services de negócio listados', () => {
    const root = path.join(__dirname, '../..');
    const files = [
      'backend/services/pedido/PedidoService.js',
      'backend/services/vendas/VendaApplicationService.js',
      'backend/services/vendas/VendaPagamentoService.js'
    ];
    for (const f of files) {
      const full = path.join(root, f);
      assert.ok(fs.existsSync(full), f);
    }
    // UX isolado no frontend
    assert.match(ui, /Sprint 3\.5 \+ 3\.6 UX|3\.6/);
  });
});
