/**
 * Isolamento: o ERP não usa Terminal → Caixa na tecla F12.
 * O atalho no ERP é o modo visual legado, não F12Policy.
 *
 * node --test tests/f12-isolamento-erp.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CORE_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/core.js'), 'utf8');
const ADMIN_JS = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/f12-admin.js'), 'utf8');
const CAIXA_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/obterCaixaAtual.js'), 'utf8');
const ObterCaixaAtual = require('../frontend/shared/js/obterCaixaAtual');

const MSG = 'Não foi possível identificar o caixa atual.';

function corpoFuncao(src, nome) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${nome}\\s*\\([^)]*\\)\\s*\\{`);
  const match = src.match(re);
  assert.ok(match, `função ${nome} não encontrada`);
  const start = match.index + match[0].length - 1;
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`corpo de ${nome} incompleto`);
}

function indiceAntesDe(haystack, needle) {
  const idx = haystack.indexOf(needle);
  assert.ok(idx >= 0, `não encontrou: ${needle}`);
  return idx;
}

describe('CENÁRIO 1 — PDV usa F12Policy', () => {
  it('atalho F12 é registrado no PDV e no ERP quando o fiscal é permitido', () => {
    assert.match(CORE_JS, /function moduloAtualUsaAtalhoF12\(\)/);
    assert.match(
      CORE_JS,
      /implantacaoPermiteFiscal\(\)\s*&&\s*moduloAtualUsaAtalhoF12\(\)/
    );
    assert.match(CORE_JS, /keydown\.modoFiscalF12[\s\S]*alternarModoFiscalGlobal/);
  });

  it('no PDV o toggle ainda resolve o caixa e usa F12Policy', () => {
    const corpo = corpoFuncao(CORE_JS, 'alternarModoFiscalComPolitica');
    assert.match(corpo, /moduloAtualEhPdvExpress\(\)/);
    assert.match(corpo, /obterCaixaAtualParaF12/);
    assert.match(corpo, /F12PolicyResolver\.obterContexto/);
    assert.match(corpo, /F12PolicyResolver\.alternarF12/);
    assert.match(corpo, /podeAlterar/);
  });
});

describe('CENÁRIO 2 — ERP não inicia o fluxo Terminal → Caixa', () => {
  it('alternarModoFiscalComPolitica continua exclusiva do PDV', () => {
    const politicaFn = corpoFuncao(CORE_JS, 'alternarModoFiscalComPolitica');
    const caixaPolitica = indiceAntesDe(politicaFn, 'obterCaixaAtualParaF12');
    const gatePolitica = indiceAntesDe(politicaFn, 'moduloAtualEhPdvExpress()');
    assert.ok(gatePolitica < caixaPolitica);
    assert.ok(gatePolitica < politicaFn.indexOf(MSG));
  });

  it('caminho ERP da tecla F12 não chama obterCaixaAtual', () => {
    const globalFn = corpoFuncao(CORE_JS, 'alternarModoFiscalGlobal');
    const legadoFn = corpoFuncao(CORE_JS, 'alternarModoFiscalLegadoSessao');
    assert.doesNotMatch(globalFn, /obterCaixaAtualParaF12/);
    assert.doesNotMatch(legadoFn, /obterCaixaAtual/);
    assert.doesNotMatch(legadoFn, new RegExp(MSG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(globalFn, /alternarModoFiscalLegadoSessao/);
  });
});

describe('CENÁRIO 3 — administração F12 do ERP não usa caixa atual', () => {
  it('tela Controle F12 não chama obterCaixaAtual', () => {
    assert.doesNotMatch(ADMIN_JS, /obterCaixaAtual/);
    assert.doesNotMatch(ADMIN_JS, /resolverCaixaAtual/);
    assert.doesNotMatch(ADMIN_JS, /alternarModoFiscalGlobal/);
    assert.doesNotMatch(ADMIN_JS, /alternarModoFiscalComPolitica/);
  });

  it('operações administrativas usam os endpoints oficiais', () => {
    assert.match(ADMIN_JS, /definirModelo/);
    assert.match(ADMIN_JS, /definirEstadoGlobal/);
    assert.match(ADMIN_JS, /definirEstadoCaixa/);
    assert.match(ADMIN_JS, /listarCaixas/);
    assert.match(ADMIN_JS, /obterInfo/);
  });
});

describe('CENÁRIO 4 — PDV sem caixa continua bloqueando, sem Caixa 1', () => {
  it('mensagem de caixa não identificado permanece só no fluxo do PDV', () => {
    const politicaFn = corpoFuncao(CORE_JS, 'alternarModoFiscalComPolitica');
    assert.match(politicaFn, new RegExp(MSG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(indiceAntesDe(politicaFn, 'moduloAtualEhPdvExpress()') < politicaFn.indexOf(MSG));
  });

  it('não assume Caixa 1 e Terminal → Caixa permanece', () => {
    assert.doesNotMatch(CORE_JS, /caixaIdAtual\s*\|\|\s*window\.terminalId\s*\|\|\s*1/);
    assert.doesNotMatch(CORE_JS, /window\.terminalId\s*\|\|\s*1/);
    assert.match(CAIXA_JS, /caixa_id/);
    assert.equal(ObterCaixaAtual.resolverCaixaAtual({}).ok, false);
    assert.equal(ObterCaixaAtual.resolverCaixaAtual({ terminal: { id: 10 } }).ok, false);
    assert.equal(
      ObterCaixaAtual.resolverCaixaAtual({ terminal: { id: 10, caixa_id: 2 } }).caixaId,
      2
    );
  });
});

describe('Boot do ERP não resolve Terminal → Caixa', () => {
  it('carregarModoFiscalInicial só chama obterCaixaAtual no PDV', () => {
    const corpo = corpoFuncao(CORE_JS, 'carregarModoFiscalInicial');
    assert.match(corpo, /moduloAtualEhPdvExpress\(\)\s*&&\s*typeof F12PolicyResolver/);
    assert.match(corpo, /modo_dashboard_fiscal|MODO_FISCAL_PADRAO|Fallback legado/);
    assert.ok(
      indiceAntesDe(corpo, 'moduloAtualEhPdvExpress()')
      < indiceAntesDe(corpo, 'obterCaixaAtualParaF12')
    );
  });
});
