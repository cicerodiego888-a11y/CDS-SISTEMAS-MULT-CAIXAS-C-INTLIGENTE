/**
 * Sprint 3.2 — UX (atualizado por UX-01)
 * F10 = balcão; botão dedicado abre entrega.
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
  console.log('\n=== Sprint 3.2 — UX (compat UX-01) ===\n');
  let ok = 0;
  let falhou = 0;
  const run = async (nome, fn) => {
    if (await test(nome, fn)) ok += 1;
    else falhou += 1;
  };

  await run('F10 Finalizar permanece balcão', async () => {
    const pdv = ler('frontend/pdv/js/pdv.js');
    assert.ok(pdv.includes("$('#btnFinalizarVendaPdv')"));
    assert.ok(pdv.includes('abrirTelaPagamento()'));
  });

  await run('botão dedicado abre modal de entrega', async () => {
    const html = ler('frontend/pdv/pages/pdv.html');
    assert.ok(html.includes('btnVendaEntregaPdv'));
    const src = ler('frontend/pdv/js/pdv-venda-entrega.js');
    assert.ok(src.includes('abrirModalVendaEntrega'));
    assert.ok(src.includes('atualizarBotaoEntrega'));
  });

  await run('rodapé cards Entregas e Prestação com clique', async () => {
    const footer = ler('frontend/pdv/js/pdv-footer-widgets.js');
    assert.ok(footer.includes('pdv-footer-widget--card'));
    assert.ok(footer.includes('ENTREGAS_PRESTACAO'));
    const prest = ler('frontend/pdv/js/pdv-prestacao-entrega.js');
    assert.ok(prest.includes('abrirListagemEntregas'));
    assert.ok(prest.includes('onClick: () => abrir()'));
  });

  await run('pdv.js init UI entrega', async () => {
    const pdv = ler('frontend/pdv/js/pdv.js');
    assert.ok(pdv.includes('PdvVendaEntrega.initUi'));
    assert.ok(pdv.includes("btnFinalizarVendaPdv')?.click()"));
  });

  console.log(`\nResultado: ${ok} ok, ${falhou} falhou\n`);
  process.exit(falhou ? 1 : 0);
})();
