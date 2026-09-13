/**
 * Sprint UX-02 — Polimento final PDV (RC1) — somente UX
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
  console.log('\n=== Sprint UX-02 — Polimento PDV ===\n');
  let ok = 0;
  let falhou = 0;
  const run = async (nome, fn) => {
    if (await test(nome, fn)) ok += 1;
    else falhou += 1;
  };

  await run('coluna Total 20–22px, contraste e espaçamento', async () => {
    const css = ler('frontend/css/pdv.css');
    assert.ok(css.includes('font-size: 21px') || css.includes('font-size:21px'));
    assert.ok(css.includes('.pdv-total-valor'));
    assert.ok(css.includes('background: #0f172a') || css.includes('background:#0f172a'));
    assert.ok(css.includes('padding-right: 20px') || css.includes('padding-right:20px'));
  });

  await run('hover de linha e botões', async () => {
    const css = ler('frontend/css/pdv.css');
    assert.ok(css.includes('tbody tr:hover'));
    assert.ok(css.includes('translateY(-1px)'));
    assert.ok(css.includes('.btn-venda-entrega:hover'));
    assert.ok(css.includes('.btn-cancelar:hover'));
  });

  await run('feedback visual add/remove/total', async () => {
    const css = ler('frontend/css/pdv.css');
    assert.ok(css.includes('pdv-item-recem'));
    assert.ok(css.includes('pdv-item-removido'));
    assert.ok(css.includes('pdvTotalFlash') || css.includes('pdv-total-flash'));
    const pdv = ler('frontend/pdv/js/pdv.js');
    assert.ok(pdv.includes('pdv-item-removido'));
    assert.ok(pdv.includes('animarTotalLinhaCarrinho'));
  });

  await run('resumo com Tipo da Venda e destaques', async () => {
    const html = ler('frontend/pdv/pages/pdv.html');
    assert.ok(html.includes('pdvTipoVendaResumoBox'));
    assert.ok(html.includes('Tipo da Venda'));
    assert.ok(html.includes('linha-resumo--destaque'));
    const css = ler('frontend/css/pdv.css');
    assert.ok(css.includes('linha-resumo--destaque'));
    assert.ok(css.includes('linha-resumo--tipo'));
  });

  await run('rodapé cards com meta, hint e tooltip', async () => {
    const footer = ler('frontend/pdv/js/pdv-footer-widgets.js');
    assert.ok(footer.includes('pdv-footer-widget__title'));
    assert.ok(footer.includes('pdv-footer-widget__meta'));
    assert.ok(footer.includes('pdv-footer-widget__hint'));
    assert.ok(footer.includes('title='));
    const prest = ler('frontend/pdv/js/pdv-prestacao-entrega.js');
    assert.ok(prest.includes('Clique para visualizar'));
    assert.ok(prest.includes('Clique para finalizar'));
  });

  await run('atalhos F10 / F9 / ESC nos botões', async () => {
    const html = ler('frontend/pdv/pages/pdv.html');
    assert.ok(html.includes('(F10)'));
    assert.ok(html.includes('(F9)'));
    assert.ok(html.includes('(ESC)'));
    assert.ok(html.includes('data-atalho="entrega"'));
    const pdv = ler('frontend/pdv/js/pdv.js');
    assert.ok(pdv.includes("e.key === 'F9'"));
    assert.ok(pdv.includes('btnVendaEntregaPdv'));
  });

  await run('performance: prefers-reduced-motion', async () => {
    const css = ler('frontend/css/pdv.css');
    assert.ok(css.includes('prefers-reduced-motion'));
  });

  console.log(`\nResultado: ${ok} ok, ${falhou} falhou\n`);
  process.exit(falhou ? 1 : 0);
})();
