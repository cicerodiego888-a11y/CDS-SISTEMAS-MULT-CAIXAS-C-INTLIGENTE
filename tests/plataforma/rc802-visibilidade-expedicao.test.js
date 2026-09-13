/**
 * RC8.0.2 — Visibilidade do menu Expedição só por licença comercial (recursos.expedicao).
 * RC8.0.3 — Independente de fiscal; habilitar_faturamento = legado da mesma flag comercial.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('RC8.0.2 — Expedição via licença (não habilitar_faturamento na UI)', () => {
  it('backend expõe recursos.expedicao e expedicaoHabilitada()', () => {
    const svc = require('../../backend/services/configuracaoService');
    assert.equal(typeof svc.expedicaoHabilitada, 'function');

    const off = svc.getRecursos({
      tipoImplantacao: 'ERP_SEM_FISCAL',
      modoOperacao: 'LOCAL',
      porta: 3001,
      habilitar_faturamento: false
    });
    assert.equal(off.recursos.faturamento, false);
    assert.equal(off.recursos.expedicao, false);
    assert.equal(svc.expedicaoHabilitada({
      tipoImplantacao: 'ERP_SEM_FISCAL',
      modoOperacao: 'LOCAL',
      porta: 3001,
      habilitar_faturamento: false
    }), false);

    const on = svc.getRecursos({
      tipoImplantacao: 'ERP_SEM_FISCAL',
      modoOperacao: 'LOCAL',
      porta: 3001,
      habilitar_faturamento: true
    });
    assert.equal(on.recursos.expedicao, true);
    assert.equal(on.recursos.faturamento, true);
    assert.equal(svc.expedicaoHabilitada({
      tipoImplantacao: 'ERP_SEM_FISCAL',
      modoOperacao: 'LOCAL',
      porta: 3001,
      habilitar_faturamento: true
    }), true);
    // Alias no recursoHabilitado (usa config global — apenas smoke de função)
    assert.equal(typeof svc.recursoHabilitado, 'function');
  });

  it('menu usa data-recurso=expedicao (não faturamento)', () => {
    const html = read('frontend/erp/index.html');
    assert.match(html, /data-recurso="expedicao"[\s\S]{0,120}data-page="faturamento"/);
    assert.doesNotMatch(html, /data-recurso="faturamento"[\s\S]{0,80}Expedição/);
  });

  it('core.js: possuiRecurso / expedicaoHabilitada / fail-closed / sem habilitar_faturamento na UI', () => {
    const core = read('frontend/shared/js/core.js');
    assert.match(core, /function possuiRecurso\s*\(/);
    assert.match(core, /function expedicaoHabilitada\s*\(/);
    assert.match(core, /fail-closed|recursos:\s*\{\}/);
    assert.match(core, /aplicarVisibilidadeRecursoDom\('expedicao'/);
    assert.match(core, /if \(p === 'faturamento'\) return expedicaoHabilitada\(\)/);
    assert.match(core, /recurso:\s*'expedicao'/);
    assert.match(core, /limparFavoritosExpedicao/);
    // Critério visual não deve ler a flag de config interna (comentários OK)
    assert.doesNotMatch(core, /CONFIG_IMPLANTACAO\.habilitar_faturamento|habilitar_faturamento\s*===|\.habilitar_faturamento\b/);
    assert.match(core, /window\.possuiRecurso\s*=/);
    assert.match(core, /window\.expedicaoHabilitada\s*=/);
  });

  it('Pedidos: Enviar para Expedição respeita expedicaoHabilitada', () => {
    const ped = read('frontend/erp/js/pedidos.js');
    assert.match(ped, /expedicaoHabilitada/);
    assert.match(ped, /Módulo Expedição não contratado/);
  });

  it('filtrarMenuPorPermissoes usa possuiRecurso', () => {
    const core = read('frontend/shared/js/core.js');
    assert.match(core, /function filtrarMenuPorPermissoes[\s\S]*possuiRecurso\(recursoItem\)/);
  });
});
