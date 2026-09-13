const assert = require('assert');
const { montarRetornoCentralDepoisDaRevisao, podeMostrarBotaoImportarCompraCentral } = require('../../frontend/erp/js/central-entradas-review-ux');

function main() {
  const retorno = montarRetornoCentralDepoisDaRevisao(42, {
    status: 'PRONTA_IMPORTACAO',
    parseDisponivel: true
  });

  assert.strictEqual(retorno.documentoId, 42);
  assert.strictEqual(retorno.focarImportarCompra, false);
  assert.strictEqual(retorno.navegarParaCompras, true);
  assert.strictEqual(retorno.labelCta, 'Finalizar Entrada');
  assert.strictEqual(retorno.aba, 'resumo');
  assert.strictEqual(retorno.seletorImportarCompra, '#centralBtnAbrirCompra');

  assert.strictEqual(podeMostrarBotaoImportarCompraCentral('PRONTA_IMPORTACAO', true), true);
  assert.strictEqual(podeMostrarBotaoImportarCompraCentral('EM_REVISAO', true), false);
  assert.strictEqual(podeMostrarBotaoImportarCompraCentral('PRONTA_IMPORTACAO', false), false);

  console.log('ce-ux31-review-flow: OK');
}

main();
