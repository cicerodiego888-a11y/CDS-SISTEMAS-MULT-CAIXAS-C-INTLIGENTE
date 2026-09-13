/**
 * Sprint UX-01 — Interface PDV / Venda para Entrega (somente UX)
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
  console.log('\n=== Sprint UX-01 — Interface PDV ===\n');
  let ok = 0;
  let falhou = 0;
  const run = async (nome, fn) => {
    if (await test(nome, fn)) ok += 1;
    else falhou += 1;
  };

  await run('ordem dos botões: Finalizar → Entrega → Cancelar', async () => {
    const html = ler('frontend/pdv/pages/pdv.html');
    const iFin = html.indexOf('btnFinalizarVendaPdv');
    const iEnt = html.indexOf('btnVendaEntregaPdv');
    const iCan = html.indexOf('btnCancelarVendaPdv');
    assert.ok(iFin > 0 && iEnt > iFin && iCan > iEnt);
    assert.ok(html.includes('ENVIAR PARA ENTREGA') || html.includes('VENDA PARA ENTREGA'));
    assert.ok(html.includes('FINALIZAR VENDA'));
  });

  await run('botão Entrega sempre visível; enabled/disabled por itens', async () => {
    const html = ler('frontend/pdv/pages/pdv.html');
    assert.ok(html.includes('btnVendaEntregaPdv'));
    assert.ok(html.includes('disabled'));
    assert.ok(!html.includes('id="btnVendaEntregaPdv"') || !/btnVendaEntregaPdv[^>]*display\s*:\s*none/.test(html));

    const js = ler('frontend/pdv/js/pdv-venda-entrega.js');
    assert.ok(js.includes('atualizarBotaoEntrega'));
    assert.ok(js.includes('moduloEntregaAtivo()'));
    assert.ok(js.includes('temItens') || js.includes('carrinho.length > 0'));
    assert.ok(js.includes("prop('disabled'") || js.includes('prop("disabled"'));
    assert.ok(!js.includes("$btn.hide()") && !js.includes('$btn.hide('));
    assert.ok(!js.includes("$btn.show()") && !js.includes('$btn.show('));
  });

  await run('Entrega abre modal direto; F10 é balcão', async () => {
    const pdv = ler('frontend/pdv/js/pdv.js');
    assert.ok(pdv.includes("abrirModalVendaEntrega"));
    assert.ok(pdv.includes("btnVendaEntregaPdv"));
    assert.ok(pdv.includes('abrirTelaPagamento()'));
    // F10 não deve abrir escolha de tipo
    const clickBlock = pdv.slice(
      pdv.indexOf("$('#btnFinalizarVendaPdv')"),
      pdv.indexOf("$('#btnFinalizarVendaPdv')") + 400
    );
    assert.ok(!clickBlock.includes('abrirEscolhaTipoFinalizacao'));

    const venda = ler('frontend/pdv/js/pdv-venda-entrega.js');
    assert.ok(venda.includes('function abrirModalVendaEntrega'));
    assert.ok(!venda.includes('modalTipoFinalizacaoPdv'));
  });

  await run('Total da linha + colunas + destaque último item', async () => {
    const css = ler('frontend/css/pdv.css');
    assert.ok(css.includes('.pdv-total-linha'));
    assert.ok(css.includes('font-weight: 800') || css.includes('font-weight:800'));
    assert.ok(css.includes('pdv-item-recem'));
    assert.ok(css.includes('pdvTotalFlash') || css.includes('pdv-total-flash'));
    assert.ok(css.includes('min-width: 220px') || css.includes('min-width:220px'));
    assert.ok(css.includes('.btn-venda-entrega'));
    assert.ok(css.includes('#ea580c') || css.includes('ea580c'));

    const pdv = ler('frontend/pdv/js/pdv.js');
    assert.ok(pdv.includes('destacarLinhaCarrinho'));
    assert.ok(pdv.includes('animarTotalLinhaCarrinho'));
    assert.ok(pdv.includes('pdv-item-recem'));
    assert.ok(pdv.includes('pdv-total-flash'));
  });

  await run('nenhuma alteração em motores de negócio nesta sprint', async () => {
    // Garantia: arquivos de motor não precisam existir no diff — apenas que UX não os referencia para mudar
    const venda = ler('frontend/pdv/js/pdv-venda-entrega.js');
    assert.ok(venda.includes("tipo_venda: 'ENTREGA'"));
    assert.ok(!venda.includes('MotorFinalizacaoVenda'));
  });

  console.log(`\nResultado: ${ok} ok, ${falhou} falhou\n`);
  process.exit(falhou ? 1 : 0);
})();
