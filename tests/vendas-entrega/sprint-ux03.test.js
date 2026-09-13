/**
 * Sprint UX-03 — Botão dedicado Venda para Entrega
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
  console.log('\n=== Sprint UX-03 — Botão Entrega ===\n');
  let ok = 0;
  let falhou = 0;
  const run = async (nome, fn) => {
    if (await test(nome, fn)) ok += 1;
    else falhou += 1;
  };

  await run('botão entre Finalizar e Cancelar', async () => {
    const html = ler('frontend/pdv/pages/pdv.html');
    const iFin = html.indexOf('btnFinalizarVendaPdv');
    const iEnt = html.indexOf('btnVendaEntregaPdv');
    const iCan = html.indexOf('btnCancelarVendaPdv');
    assert.ok(iFin > 0 && iEnt > iFin && iCan > iEnt);
    assert.ok(html.includes('ENVIAR PARA ENTREGA'));
    assert.ok(html.includes('btn-venda-entrega'));
  });

  await run('identidade laranja e ícone', async () => {
    const css = ler('frontend/css/pdv.css');
    assert.ok(css.includes('#ea580c') || css.includes('ea580c'));
    assert.ok(css.includes('.btn-venda-entrega'));
    const html = ler('frontend/pdv/pages/pdv.html');
    assert.ok(html.includes('🚚'));
  });

  await run('sempre visível; habilita só com módulo + itens', async () => {
    const js = ler('frontend/pdv/js/pdv-venda-entrega.js');
    assert.ok(js.includes('atualizarBotaoEntrega'));
    assert.ok(js.includes('moduloEntregaAtivo()'));
    assert.ok(js.includes('carrinho.length > 0') || js.includes('temItens'));
    assert.ok(js.includes("prop('disabled'") || js.includes('prop("disabled"'));
    assert.ok(!js.includes('$btn.hide()') && !js.includes("$btn.hide("));
    assert.ok(!js.includes('$btn.show()') && !js.includes("$btn.show("));
    assert.ok(js.includes('pdvEntregaConfigurada'));
    const html = ler('frontend/pdv/pages/pdv.html');
    assert.ok(html.includes('disabled'));
    assert.ok(!/btnVendaEntregaPdv[^>]*style="[^"]*display\s*:\s*none/.test(html));
  });

  await run('clique abre modal direto sem menu', async () => {
    const js = ler('frontend/pdv/js/pdv-venda-entrega.js');
    assert.ok(js.includes('abrirModalVendaEntrega'));
    assert.ok(js.includes('aoClicarBotaoEntrega'));
    assert.ok(!js.includes('modalTipoFinalizacaoPdv'));
    const pdv = ler('frontend/pdv/js/pdv.js');
    assert.ok(pdv.includes('aoClicarBotaoEntrega') || pdv.includes('abrirModalVendaEntrega'));
  });

  await run('após confirmar: ✅ ENTREGA CONFIGURADA', async () => {
    const js = ler('frontend/pdv/js/pdv-venda-entrega.js');
    assert.ok(js.includes('ENTREGA CONFIGURADA'));
    assert.ok(js.includes("'✅'") || js.includes('"✅"') || js.includes('ICONE_OK'));
    assert.ok(js.includes('marcarEntregaConfigurada'));
    assert.ok(js.includes('limparEstadoEntregaUi'));
    assert.ok(js.includes('btn-venda-entrega--ok'));
    const css = ler('frontend/css/pdv.css');
    assert.ok(css.includes('btn-venda-entrega--ok'));
  });

  console.log(`\nResultado: ${ok} ok, ${falhou} falhou\n`);
  process.exit(falhou ? 1 : 0);
})();
