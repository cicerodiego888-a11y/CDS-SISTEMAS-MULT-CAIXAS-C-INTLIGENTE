/**
 * Sprint 3.7 — Menu "Mais opções" da Central sem "Importação de XML Legado".
 * Somente apresentação: view, rotas e serviços da importação legada permanecem.
 *
 * Executar: node --test tests/central-entradas/sprint37-menu-sem-xml-legado.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const mainSrc = fs.readFileSync(path.join(root, 'frontend/erp/js/central-entradas.js'), 'utf8');

function blocoMenu() {
  const inicio = mainSrc.indexOf('<div class="dropdown central-rc40-mais">');
  assert.ok(inicio >= 0, 'menu "Mais opções" não encontrado');
  const ul = mainSrc.indexOf('<ul class="dropdown-menu', inicio);
  const fim = mainSrc.indexOf('</ul>', ul);
  return mainSrc.slice(ul, fim);
}

function itensMenu() {
  return blocoMenu()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.includes('<li>'));
}

describe('Sprint 3.7 — menu da Central de Entradas', () => {
  it('não exibe Importação de XML Legado nem o cabeçalho Ferramentas Administrativas', () => {
    const menu = blocoMenu();
    assert.doesNotMatch(menu, /XML Legado/i);
    assert.doesNotMatch(menu, /importacao-xml-legado/);
    assert.doesNotMatch(menu, /Ferramentas Administrativas/);
    assert.doesNotMatch(menu, /dropdown-header/);
  });

  it('sem separadores no início, no fim ou consecutivos', () => {
    const itens = itensMenu();
    const ehDivisor = (l) => /dropdown-divider/.test(l);
    assert.ok(itens.length > 0);
    assert.equal(ehDivisor(itens[0]), false);
    assert.equal(ehDivisor(itens[itens.length - 1]), false);
    for (let i = 1; i < itens.length; i += 1) {
      assert.ok(!(ehDivisor(itens[i]) && ehDivisor(itens[i - 1])), 'separadores consecutivos');
    }
    assert.equal(itens.filter(ehDivisor).length, 1);
  });

  it('demais opções continuam no menu, na mesma ordem', () => {
    const menu = blocoMenu();
    const esperado = [
      'id="centralBtnAdicionarDocumento"',
      'id="centralBtnNotificacoes"',
      'id="centralBtnDiagnostico"',
      'data-view="config"',
      'data-view="log"',
      'data-view="ciclo-dfe"'
    ];
    let pos = -1;
    esperado.forEach((marca) => {
      const idx = menu.indexOf(marca);
      assert.ok(idx > pos, `opção ausente ou fora de ordem: ${marca}`);
      pos = idx;
    });
  });

  it('view da importação legada continua existindo internamente', () => {
    assert.match(mainSrc, /id="centralEntradasViewImportacaoLegado"/);
    assert.match(mainSrc, /view === 'importacao-xml-legado'\) renderImportacaoXmlLegadoCentral\(\)/);
  });
});
