/**
 * Fonte única do estado F12 no PDV — o mecanismo antigo não pode sobrescrever.
 *
 * node --test tests/f12-fonte-estado-pdv.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Fonte = require('../frontend/shared/js/f12FonteEstadoPdv');

const CORE_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/core.js'), 'utf8');
const POLICY_JS = fs.readFileSync(path.join(ROOT, 'backend/services/F12PolicyService.js'), 'utf8');
const RESOLVER_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/F12PolicyResolver.js'), 'utf8');
const CAIXA_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/obterCaixaAtual.js'), 'utf8');
const PDV_HTML = fs.readFileSync(path.join(ROOT, 'frontend/pdv/index.html'), 'utf8');
const ERP_HTML = fs.readFileSync(path.join(ROOT, 'frontend/erp/index.html'), 'utf8');

const contextoPdv = {
  CDS_MODULE: 'pdv',
  F12PolicyResolver: { resolveF12Estado() { return true; } }
};

const contextoErp = {
  CDS_MODULE: 'erp',
  F12PolicyResolver: { resolveF12Estado() { return true; } }
};

describe('Fonte oficial do PDV', () => {
  it('PDV com F12Policy usa F12Policy como fonte oficial', () => {
    assert.equal(Fonte.pdvUsaF12PolicyComoFonteOficial(contextoPdv), true);
    assert.equal(Fonte.podeMecanismoAntigoAlterarEstadoPdv(contextoPdv), false);
  });

  it('ERP continua podendo usar o mecanismo legado', () => {
    assert.equal(Fonte.pdvUsaF12PolicyComoFonteOficial(contextoErp), false);
    assert.equal(Fonte.podeMecanismoAntigoAlterarEstadoPdv(contextoErp), true);
  });

  it('PDV sem F12PolicyResolver não força a fonte nova', () => {
    assert.equal(Fonte.pdvUsaF12PolicyComoFonteOficial({
      CDS_MODULE: 'pdv',
      F12PolicyResolver: null
    }), false);
  });
});

describe('Conflito F12Policy × sincronização antiga', () => {
  it('cenário 1: F12 ON e legado tenta OFF — PDV permanece ON', () => {
    const resultado = Fonte.resolverEstadoEfetivoPdv({
      estadoF12: true,
      estadoLegado: false,
      contexto: contextoPdv
    });
    assert.equal(resultado.estadoEfetivo, true);
    assert.equal(resultado.origem, 'f12-policy');
    assert.equal(resultado.legadoIgnorado, true);
    assert.equal(resultado.aplicadoLegado, false);
  });

  it('cenário 2: F12 OFF e legado tenta ON — PDV permanece OFF', () => {
    const resultado = Fonte.resolverEstadoEfetivoPdv({
      estadoF12: false,
      estadoLegado: true,
      contexto: contextoPdv
    });
    assert.equal(resultado.estadoEfetivo, false);
    assert.equal(resultado.origem, 'f12-policy');
    assert.equal(resultado.legadoIgnorado, true);
  });

  it('cenário 3: após vários ciclos do polling antigo o estado F12 permanece', () => {
    let efetivo = true;
    for (let i = 0; i < 8; i += 1) {
      efetivo = Fonte.aplicarTentativaSincronizacaoLegada(efetivo, false, contextoPdv);
    }
    assert.equal(efetivo, true);

    efetivo = false;
    for (let i = 0; i < 8; i += 1) {
      efetivo = Fonte.aplicarTentativaSincronizacaoLegada(efetivo, true, contextoPdv);
    }
    assert.equal(efetivo, false);
  });

  it('cenário 4: alteração oficial F12 não é desfeita pelo mecanismo antigo', () => {
    const depoisDoF12 = Fonte.resolverEstadoEfetivoPdv({
      estadoF12: false,
      estadoLegado: true,
      contexto: contextoPdv
    });
    assert.equal(depoisDoF12.estadoEfetivo, false);

    const aposPolling = Fonte.aplicarTentativaSincronizacaoLegada(
      depoisDoF12.estadoEfetivo,
      true,
      contextoPdv
    );
    assert.equal(aposPolling, false);
  });

  it('ERP ainda aplica o estado legado quando F12 não é a fonte do PDV', () => {
    const resultado = Fonte.resolverEstadoEfetivoPdv({
      estadoF12: false,
      estadoLegado: true,
      contexto: contextoErp
    });
    assert.equal(resultado.estadoEfetivo, true);
    assert.equal(resultado.origem, 'legado');
    assert.equal(resultado.aplicadoLegado, true);
  });
});

describe('Regressão — core.js e políticas', () => {
  it('sincronização antiga no PDV é redirecionada para o F12Policy', () => {
    assert.match(CORE_JS, /pdvUsaF12PolicyComoFonteOficial/);
    assert.match(CORE_JS, /sincronizarEstadoF12Pdv/);
    assert.match(CORE_JS, /origemF12/);
    assert.match(CORE_JS, /sincronização antiga ignorada/);
    assert.match(
      CORE_JS,
      /async function sincronizarModoFiscalServidor[\s\S]*pdvUsaF12PolicyComoFonteOficial[\s\S]*sincronizarEstadoF12Pdv/
    );
  });

  it('não cria um segundo polling — o intervalo antigo é o único', () => {
    const intervalos = CORE_JS.match(/setInterval\(\(\) => \{\s*sincronizarModoFiscalServidor/g) || [];
    assert.equal(intervalos.length, 1);
    assert.doesNotMatch(CORE_JS, /setInterval\(\(\) => \{\s*sincronizarEstadoF12Pdv/);
  });

  it('F12 oficial aplica estado com origemF12', () => {
    assert.match(CORE_JS, /origemF12: true/);
    assert.match(CORE_JS, /recarregar: false, origemF12: true/);
  });

  it('polling F12 não notifica nem recarrega o PDV se o estado efetivo não mudou', () => {
    assert.match(CORE_JS, /estadoF12Mudou/);
    assert.match(CORE_JS, /recarregar: estadoF12Mudou/);
    assert.match(CORE_JS, /estadoF12Mudou && opcoes\.notificar/);
  });

  it('PDV não grava modo_dashboard_fiscal quando o F12 não resolve o caixa', () => {
    assert.match(CORE_JS, /mecanismo antigo não será usado como fonte do PDV/);
    const blocoPdv = CORE_JS.match(
      /pdvUsaF12PolicyComoFonteOficial\(\)\) \{\s*console\.warn\('\[F12\] mecanismo antigo[\s\S]*?return;/
    );
    assert.ok(blocoPdv, 'PDV deve retornar sem salvar o mecanismo antigo');
  });

  it('cenário 5: mapeamento legado permanece e o PDV usa contexto oficial', () => {
    assert.match(POLICY_JS, /\['POR_CAIXA', 'GLOBAL', 'MODO_ADMIN'\]/);
    assert.match(RESOLVER_JS, /obterContexto/);
    assert.match(RESOLVER_JS, /controle/);
    assert.match(RESOLVER_JS, /escopo/);
  });

  it('correção Terminal → Caixa da sprint anterior permanece', () => {
    assert.match(CAIXA_JS, /caixa_id/);
    assert.doesNotMatch(CORE_JS, /caixaIdAtual\s*\|\|\s*window\.terminalId\s*\|\|\s*1/);
    assert.doesNotMatch(CORE_JS, /window\.terminalId\s*\|\|\s*1/);
    assert.match(CORE_JS, /obterCaixaAtualParaF12/);
  });

  it('f12FonteEstadoPdv.js é carregado no PDV e no ERP antes do core', () => {
    assert.match(PDV_HTML, /f12FonteEstadoPdv\.js[\s\S]*F12PolicyResolver\.js[\s\S]*core\.js/);
    assert.match(ERP_HTML, /f12FonteEstadoPdv\.js[\s\S]*F12PolicyResolver\.js[\s\S]*core\.js/);
  });
});
