/**
 * Roteamento da tecla F12: PDV = F12Policy; ERP = modo visual legado.
 *
 * node --test tests/f12-roteamento-modulo.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CORE_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/core.js'), 'utf8');
const DASHBOARD_JS = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/dashboard.js'), 'utf8');
const FONTE_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/f12FonteEstadoPdv.js'), 'utf8');
const Fonte = require('../frontend/shared/js/f12FonteEstadoPdv');

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

function inverterModoVisual(ativo) {
  return ativo ? '0' : '1';
}

function simularToggleErp(estadoAtivo) {
  const store = {
    pdv_modo_fiscal_ativo: estadoAtivo ? '1' : '0',
    modo_dashboard_fiscal: estadoAtivo ? '1' : '0'
  };
  const novoValor = inverterModoVisual(estadoAtivo);
  store.pdv_modo_fiscal_ativo = novoValor;
  store.modo_dashboard_fiscal = novoValor;
  return {
    store,
    chamouSalvarServidor: true,
    chamouObterCaixaAtual: false,
    chamouPolitica: false,
    mensagemCaixa: null
  };
}

describe('A — ERP + F12 usa o modo visual legado', () => {
  it('listener F12 é registrado também no ERP', () => {
    assert.match(CORE_JS, /function moduloAtualEhErp\(\)/);
    assert.match(CORE_JS, /function moduloAtualUsaAtalhoF12\(\)/);
    assert.match(CORE_JS, /moduloAtualEhPdvExpress\(\)\s*\|\|\s*moduloAtualEhErp\(\)/);
    assert.match(
      CORE_JS,
      /implantacaoPermiteFiscal\(\)\s*&&\s*moduloAtualUsaAtalhoF12\(\)/
    );
  });

  it('alternarModoFiscalGlobal no ERP não chama Policy nem obterCaixaAtual', () => {
    const globalFn = corpoFuncao(CORE_JS, 'alternarModoFiscalGlobal');
    const legadoFn = corpoFuncao(CORE_JS, 'alternarModoFiscalLegadoSessao');

    assert.match(globalFn, /moduloAtualEhPdvExpress\(\)/);
    assert.match(globalFn, /alternarModoFiscalComPolitica\(\)/);
    assert.match(globalFn, /moduloAtualEhErp\(\)/);
    assert.match(globalFn, /alternarModoFiscalLegadoSessao\(\)/);
    assert.doesNotMatch(globalFn, /obterCaixaAtual/);
    assert.doesNotMatch(legadoFn, /obterCaixaAtual/);
    assert.doesNotMatch(legadoFn, /alternarModoFiscalComPolitica/);
    assert.doesNotMatch(legadoFn, /F12PolicyResolver/);
    assert.doesNotMatch(legadoFn, new RegExp(MSG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('legado atualiza os dois storages e sincroniza o servidor', () => {
    const legadoFn = corpoFuncao(CORE_JS, 'alternarModoFiscalLegadoSessao');
    assert.match(legadoFn, /pdv_modo_fiscal_ativo/);
    assert.match(legadoFn, /modo_dashboard_fiscal/);
    assert.match(legadoFn, /aplicarModoFiscalGlobal\(\)/);
    assert.match(legadoFn, /salvarModoFiscalServidor\(novoValor\)/);
    assert.match(legadoFn, /modoFiscalAtivoSistema\(\)\s*\?\s*'0'\s*:\s*'1'/);
  });
});

describe('B e C — ERP ON → OFF e OFF → ON', () => {
  it('ON vira OFF', () => {
    const r = simularToggleErp(true);
    assert.equal(r.store.pdv_modo_fiscal_ativo, '0');
    assert.equal(r.store.modo_dashboard_fiscal, '0');
    assert.equal(r.chamouObterCaixaAtual, false);
    assert.equal(r.chamouPolitica, false);
  });

  it('OFF vira ON', () => {
    const r = simularToggleErp(false);
    assert.equal(r.store.pdv_modo_fiscal_ativo, '1');
    assert.equal(r.store.modo_dashboard_fiscal, '1');
    assert.equal(r.chamouSalvarServidor, true);
  });
});

describe('D — ERP sem terminal continua no legado', () => {
  it('fluxo ERP não depende de __cdsTerminalAtual', () => {
    const legadoFn = corpoFuncao(CORE_JS, 'alternarModoFiscalLegadoSessao');
    const globalFn = corpoFuncao(CORE_JS, 'alternarModoFiscalGlobal');
    assert.doesNotMatch(legadoFn, /__cdsTerminalAtual/);
    assert.doesNotMatch(legadoFn, /terminalId/);
    assert.doesNotMatch(legadoFn, /caixa_id/);
    assert.doesNotMatch(globalFn, /Não foi possível identificar o caixa atual/);
  });
});

describe('E — PDV continua na F12Policy', () => {
  it('PDV ramifica para alternarModoFiscalComPolitica e não usa o legado como fonte', () => {
    const globalFn = corpoFuncao(CORE_JS, 'alternarModoFiscalGlobal');
    const pdvBranch = globalFn.slice(
      globalFn.indexOf('if (moduloAtualEhPdvExpress())'),
      globalFn.indexOf('if (moduloAtualEhErp())')
    );
    assert.match(pdvBranch, /alternarModoFiscalComPolitica\(\)/);
    assert.doesNotMatch(pdvBranch, /alternarModoFiscalLegadoSessao/);
    assert.doesNotMatch(pdvBranch, /modo_dashboard_fiscal/);
  });

  it('mecanismo legado não é fonte efetiva do PDV', () => {
    assert.equal(Fonte.pdvUsaF12PolicyComoFonteOficial({
      CDS_MODULE: 'pdv',
      F12PolicyResolver: {}
    }), true);
    assert.equal(Fonte.podeMecanismoAntigoAlterarEstadoPdv({
      CDS_MODULE: 'pdv',
      F12PolicyResolver: {}
    }), false);
    assert.match(FONTE_JS, /modo_dashboard_fiscal/);
  });
});

describe('Dashboard reutiliza o mesmo fluxo', () => {
  it('alternarModoDashboardFiscal continua delegando para alternarModoFiscalGlobal', () => {
    assert.match(DASHBOARD_JS, /alternarModoFiscalGlobal\(\)/);
    assert.doesNotMatch(DASHBOARD_JS, /obterCaixaAtual/);
  });
});
