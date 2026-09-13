/**
 * Sprint UX-03.5 — Aproveitamento máximo da área da tela
 * Rollback parcial: layout restaurado; só margem externa do container raiz.
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
  console.log('\n=== Sprint UX-03.5 — Área útil (rollback parcial) ===\n');
  let ok = 0;
  let falhou = 0;
  const run = async (nome, fn) => {
    if (await test(nome, fn)) ok += 1;
    else falhou += 1;
  };

  await run('layout restaurado: altura calc(100vh - 28px)', async () => {
    const css = ler('frontend/css/pdv.css');
    assert.ok(/\.pdv-profissional\s*\{[^}]*height:\s*calc\(100vh - 28px\)/s.test(css));
    assert.ok(/body\.pdv-mode #page-content\s*\{[^}]*height:\s*calc\(100vh - 28px\)/s.test(css));
    assert.ok(!/body\.pdv-mode #page-content\s*\{[^}]*height:\s*100vh/s.test(css));
  });

  await run('sem alterações estruturais em container/main', async () => {
    const css = ler('frontend/css/pdv.css');
    assert.ok(!css.includes('body.pdv-mode .container-fluid {'));
    assert.ok(!/body\.pdv-mode main\s*\{[^}]*padding-left:\s*0/s.test(css));
    assert.ok(!/body\.pdv-mode main\s*\{[^}]*flex:\s*0 0 100%/s.test(css));
  });

  await run('somente margem externa no container raiz (~8px)', async () => {
    const css = ler('frontend/css/pdv.css');
    assert.ok(/\.pdv-profissional\s*\{[^}]*padding:\s*8px/s.test(css));
    assert.ok(/\.pdv-fullscreen\s*\{[^}]*padding:\s*0/s.test(css));
  });

  await run('grid/flex interno preservados', async () => {
    const css = ler('frontend/css/pdv.css');
    assert.ok(css.includes('.pdv-grid') || css.includes('.pdv-corpo'));
    assert.ok(css.includes('.pdv-atalhos'));
    assert.ok(css.includes('.btn-finalizar'));
    assert.ok(css.includes('grid-template-columns'));
  });

  console.log(`\nResultado: ${ok} ok, ${falhou} falhou\n`);
  process.exit(falhou ? 1 : 0);
})();
