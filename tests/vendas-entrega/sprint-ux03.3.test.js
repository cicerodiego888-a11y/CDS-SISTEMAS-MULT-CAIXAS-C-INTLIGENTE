/**
 * Sprint UX-03.3 — Botão Entrega fixo (enabled/disabled) + foco na pesquisa
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function ler(rel) {
  return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
}

async function test(nome, fn) {
  try {
    await fn();
    console.log(`  OK  ${nome}`);
    return true;
  } catch (e) {
    console.error(`  FALHOU  ${nome}`);
    console.error(`    ${e.message}`);
    return false;
  }
}

(async () => {
  console.log('\n=== Sprint UX-03.3 — Correções Finais PDV ===\n');
  let ok = 0;
  let falhou = 0;
  const run = async (nome, fn) => {
    if (await test(nome, fn)) ok += 1;
    else falhou += 1;
  };

  await run('botão Entrega sem display:none; disabled no HTML', async () => {
    const html = ler('frontend/pdv/pages/pdv.html');
    const iFin = html.indexOf('btnFinalizarVendaPdv');
    const iEnt = html.indexOf('btnVendaEntregaPdv');
    const iCan = html.indexOf('btnCancelarVendaPdv');
    assert.ok(iFin > 0 && iEnt > iFin && iCan > iEnt);
    assert.ok(html.includes('disabled'));
    assert.ok(!/btnVendaEntregaPdv[^>]*display\s*:\s*none/.test(html));
  });

  await run('atualizarBotaoEntrega usa disabled (sem show/hide)', async () => {
    const js = ler('frontend/pdv/js/pdv-venda-entrega.js');
    assert.ok(js.includes("prop('disabled'") || js.includes('prop("disabled"'));
    assert.ok(js.includes('habilitado') || js.includes('temItens'));
    assert.ok(!js.includes('$btn.hide(') && !js.includes("$btn.hide("));
    assert.ok(!js.includes('$btn.show(') && !js.includes("$btn.show("));
    assert.ok(js.includes('removeProperty(\'display\')') || js.includes('removeProperty("display")'));
  });

  await run('CSS de botão desabilitado', async () => {
    const css = ler('frontend/css/pdv.css');
    assert.ok(css.includes('.btn-venda-entrega:disabled') || css.includes('.btn-venda-entrega[disabled]'));
    assert.ok(css.includes('cursor: not-allowed') || css.includes('not-allowed'));
  });

  await run('F9 só dispara se botão habilitado', async () => {
    const pdv = ler('frontend/pdv/js/pdv.js');
    assert.ok(pdv.includes('btnEntrega.disabled') || pdv.includes('!btnEntrega.disabled'));
    assert.ok(!pdv.includes("btnEntrega.style.display !== 'none'"));
  });

  await run('focarCampoCodigo limpa e foca após operações', async () => {
    const pdv = ler('frontend/pdv/js/pdv.js');
    assert.ok(pdv.includes('function focarCampoCodigo'));
    assert.ok(pdv.includes('limpar') && pdv.includes("input.val('')"));
    assert.ok(pdv.includes("focarCampoCodigo({ limpar: true })"));
    assert.ok(pdv.includes('atualizarQuantidade') && pdv.includes('focarCampoCodigo'));
    assert.ok(pdv.includes('atualizarPercentual'));
    assert.ok(pdv.includes('atualizarPrecoUnitario'));
    assert.ok(pdv.includes('removerItemCarrinho'));
  });

  await run('entrega: foco após confirmar/fechar modal', async () => {
    const js = ler('frontend/pdv/js/pdv-venda-entrega.js');
    assert.ok(js.includes("focarCampoCodigo({ limpar: true })"));
    assert.ok(js.includes('hidden.bs.modal'));
  });

  await run('carrinho lido via obterCarrinhoPdv (não só window.carrinho)', async () => {
    const js = ler('frontend/pdv/js/pdv-venda-entrega.js');
    assert.ok(js.includes('obterCarrinhoAtual') || js.includes('obterCarrinhoPdv'));
    const pdv = ler('frontend/pdv/js/pdv.js');
    assert.ok(pdv.includes('sincronizarCarrinhoGlobalPdv') || pdv.includes('obterCarrinhoPdv'));
  });

  await run('entrega envia terminal_id no multi-caixa', async () => {
    const js = ler('frontend/pdv/js/pdv-venda-entrega.js');
    assert.ok(js.includes('montarPayloadComTerminal') || js.includes('getTerminalRequestData'));
    assert.ok(js.includes('validarTerminalMultiCaixa'));
  });

  await run('modal entrega possui busca por CEP', async () => {
    const js = ler('frontend/pdv/js/pdv-venda-entrega.js');
    assert.ok(js.includes('entregaCep'));
    assert.ok(js.includes('btnBuscarCepEntrega'));
    assert.ok(js.includes('buscarCepEntregaPdv'));
    assert.ok(js.includes('viacep.com.br'));
  });

  console.log(`\nResultado: ${ok} ok, ${falhou} falhou\n`);
  process.exit(falhou ? 1 : 0);
})();
