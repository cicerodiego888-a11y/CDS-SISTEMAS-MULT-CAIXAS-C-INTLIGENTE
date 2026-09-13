/**
 * Sprint UX-03.1 — Layout oficial PDV (atalhos + cards separados)
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
  console.log('\n=== Sprint UX-03.1 — Layout oficial ===\n');
  let ok = 0;
  let falhou = 0;
  const run = async (nome, fn) => {
    if (await test(nome, fn)) ok += 1;
    else falhou += 1;
  };

  await run('atalhos: chips originais + F9 Entrega', async () => {
    const html = ler('frontend/pdv/pages/pdv.html');
    assert.ok(html.includes('pdv-atalho-chip'));
    assert.ok(html.includes('F1 Buscar'));
    assert.ok(html.includes('F9 Entrega'));
    assert.ok(html.includes('F10 Finalizar'));
    assert.ok(html.includes('ESC Cancelar'));

    const css = ler('frontend/css/pdv.css');
    assert.ok(css.includes('.pdv-atalho-chip'));
    assert.ok(css.includes('padding: 6px 12px') || css.includes('padding:6px 12px'));
    assert.ok(css.includes('font-size: 12px') || css.includes('font-size:12px'));
    assert.ok(css.includes('border-radius: 999px') || css.includes('border-radius:999px'));
  });

  await run('cards operacionais na mesma barra dos atalhos', async () => {
    const html = ler('frontend/pdv/pages/pdv.html');
    assert.ok(html.includes('pdv-footer-widgets'));
    assert.ok(!html.includes('pdv-footer-operacional'));
    const footerBlock = html.slice(html.indexOf('<footer class="pdv-atalhos">'), html.indexOf('</footer>') + 9);
    assert.ok(footerBlock.includes('data-pdv-footer-widgets'));

    const widgets = ler('frontend/pdv/js/pdv-footer-widgets.js');
    assert.ok(widgets.includes('footer.appendChild(slot)') || widgets.includes('footer.querySelector'));
  });

  await run('botão lateral ENVIAR PARA ENTREGA', async () => {
    const html = ler('frontend/pdv/pages/pdv.html');
    const iFin = html.indexOf('btnFinalizarVendaPdv');
    const iEnt = html.indexOf('btnVendaEntregaPdv');
    const iCan = html.indexOf('btnCancelarVendaPdv');
    assert.ok(iFin > 0 && iEnt > iFin && iCan > iEnt);
    assert.ok(html.includes('ENVIAR PARA ENTREGA'));

    const js = ler('frontend/pdv/js/pdv-venda-entrega.js');
    assert.ok(js.includes('ENVIAR PARA ENTREGA'));
    assert.ok(js.includes('abrirModalVendaEntrega'));
    assert.ok(!js.includes('modalTipoFinalizacaoPdv'));
  });

  await run('total linha e tipo venda preservados', async () => {
    const css = ler('frontend/css/pdv.css');
    assert.ok(css.includes('font-size: 21px') || css.includes('.pdv-total-valor'));
    assert.ok(css.includes('background: #0f172a') || css.includes('background:#0f172a'));
    const html = ler('frontend/pdv/pages/pdv.html');
    assert.ok(html.includes('pdvTipoVendaResumoBox'));
    assert.ok(html.includes('Tipo da Venda'));
  });

  await run('cards mantêm fundo escuro e meta/hint', async () => {
    const css = ler('frontend/css/pdv.css');
    assert.ok(css.includes('.pdv-footer-widget--card'));
    assert.ok(css.includes('background: #0f172a') || css.includes('background:#0f172a'));
    const prest = ler('frontend/pdv/js/pdv-prestacao-entrega.js');
    assert.ok(prest.includes('Clique para visualizar'));
    assert.ok(prest.includes('Clique para finalizar'));
  });

  console.log(`\nResultado: ${ok} ok, ${falhou} falhou\n`);
  process.exit(falhou ? 1 : 0);
})();
