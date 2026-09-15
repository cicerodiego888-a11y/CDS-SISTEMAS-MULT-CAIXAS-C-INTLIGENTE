/**
 * Menu Fechamento Fiscal do Dia só aparece com o módulo ATIVADO.
 * Executar: node --test tests/fiscal/fechamento-fiscal-dia-menu-desativado.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Fechamento Fiscal do Dia — menu oculto se desativado', () => {
  it('item do menu inicia hidden e tem id estável', () => {
    const html = read('frontend/erp/index.html');
    assert.match(
      html,
      /id="nav-fechamento-fiscal-dia"[\s\S]*hidden[\s\S]*data-page="fechamento-fiscal-dia"/
    );
  });

  it('core hidrata a flag e oculta o item no filtro de menu', () => {
    const core = read('frontend/shared/js/core.js');
    assert.match(core, /function fechamentoFiscalDiaMenuPermitido\s*\(/);
    assert.match(core, /function hidratarMenuFechamentoFiscalDia\s*\(/);
    assert.match(core, /await hidratarMenuFechamentoFiscalDia\(\)/);
    assert.match(core, /page === 'fechamento-fiscal-dia' && !fechamentoFiscalDiaMenuPermitido\(\)/);
    assert.match(core, /item\.moduloFechamentoFiscalDia && !fechamentoFiscalDiaMenuPermitido\(\)/);
  });

  it('SPA não abre a página com módulo desativado', () => {
    const erp = read('frontend/erp/js/app.js');
    assert.match(erp, /fechamentoFiscalDiaMenuPermitido/);
    assert.match(erp, /Fechamento Fiscal do Dia está desativado/);
  });

  it('salvar ON/OFF no centro de configurações atualiza o menu', () => {
    const cfg = read('frontend/erp/js/cds-centro-configuracoes.js');
    assert.match(cfg, /aplicarVisibilidadeMenuFechamentoFiscalDia/);
  });
});
