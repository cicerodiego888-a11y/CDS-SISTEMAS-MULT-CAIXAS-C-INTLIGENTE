/**
 * RC8.0.3 — Expedição (comercial) independente do módulo Fiscal.
 *
 * Fluxo: Comercial → Expedição → (opcional) Documento Fiscal
 * Expedição NÃO pode ficar FALSE só porque fiscal/nfe/nfce estão OFF.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function baseCfg(extra) {
  return Object.assign({
    modoOperacao: 'LOCAL',
    porta: 3001
  }, extra || {});
}

describe('RC8.0.3 — cadeia Expedição vs Fiscal', () => {
  const svc = require('../../backend/services/configuracaoService');

  it('ponto em que expedicao vira FALSE: só quando flag comercial está desligada', () => {
    const off = svc.getRecursos(baseCfg({
      tipoImplantacao: 'ERP_FISCAL',
      habilitar_faturamento: false,
      modulo_nfe: true,
      modulo_nfce: true
    }));
    assert.equal(off.recursos.fiscal, true);
    assert.equal(off.recursos.nfe, true);
    assert.equal(off.recursos.expedicao, false);
    assert.equal(off.recursos.faturamento, false);
  });

  it('ERP_SEM_FISCAL + Expedição ON → menu permitido; fiscal OFF', () => {
    const out = svc.getRecursos(baseCfg({
      tipoImplantacao: 'ERP_SEM_FISCAL',
      habilitar_faturamento: true
    }));
    assert.equal(out.recursos.fiscal, false);
    assert.equal(out.recursos.nfe, false);
    assert.equal(out.recursos.nfce, false);
    assert.equal(out.recursos.expedicao, true);
    assert.equal(out.recursos.faturamento, true);
    assert.equal(svc.expedicaoHabilitada(baseCfg({
      tipoImplantacao: 'ERP_SEM_FISCAL',
      habilitar_faturamento: true
    })), true);
    assert.equal(svc.fiscalHabilitado(baseCfg({
      tipoImplantacao: 'ERP_SEM_FISCAL',
      habilitar_faturamento: true
    })), false);
  });

  it('ERP com NFC-e: desligar fiscal não desliga Expedição', () => {
    const com = svc.getRecursos(baseCfg({
      tipoImplantacao: 'ERP_FISCAL',
      habilitar_expedicao: true,
      modulo_nfe: false,
      modulo_nfce: true
    }));
    assert.equal(com.recursos.fiscal, true);
    assert.equal(com.recursos.nfce, true);
    assert.equal(com.recursos.nfe, false);
    assert.equal(com.recursos.expedicao, true);

    const semFiscal = svc.getRecursos(baseCfg({
      tipoImplantacao: 'ERP_SEM_FISCAL',
      habilitar_expedicao: true,
      modulo_nfe: true,
      modulo_nfce: true
    }));
    assert.equal(semFiscal.recursos.fiscal, false);
    assert.equal(semFiscal.recursos.expedicao, true);
  });

  it('ERP com NF-e + Expedição OFF: fiscal permanece; Expedição oculta', () => {
    const out = svc.getRecursos(baseCfg({
      tipoImplantacao: 'ERP_MULTICAIXA',
      habilitar_expedicao: false,
      modulo_nfe: true,
      modulo_nfce: true
    }));
    assert.equal(out.recursos.fiscal, true);
    assert.equal(out.recursos.nfe, true);
    assert.equal(out.recursos.expedicao, false);
  });

  it('legado habilitar_faturamento ainda habilita Expedição', () => {
    const out = svc.getRecursos(baseCfg({
      tipoImplantacao: 'ERP_SEM_FISCAL',
      habilitar_faturamento: true
    }));
    assert.equal(out.habilitar_expedicao, true);
    assert.equal(out.habilitar_faturamento, true);
    assert.equal(out.recursos.expedicao, true);
  });

  it('canônico habilitar_expedicao tem precedência sobre legado', () => {
    const out = svc.getRecursos(baseCfg({
      tipoImplantacao: 'ERP_FISCAL',
      habilitar_expedicao: true,
      habilitar_faturamento: false
    }));
    assert.equal(out.recursos.expedicao, true);
  });

  it('resolverExpedicaoComercial nunca olha tipo/fiscal', () => {
    assert.equal(typeof svc.resolverExpedicaoComercial, 'function');
    assert.equal(svc.resolverExpedicaoComercial({
      tipoImplantacao: 'ERP_SEM_FISCAL',
      habilitar_faturamento: true
    }), true);
    assert.equal(svc.resolverExpedicaoComercial({
      tipoImplantacao: 'ERP_FISCAL',
      modulo_nfe: true,
      habilitar_faturamento: false
    }), false);
  });
});

describe('RC8.0.3 — UI/API sem acoplamento fiscal→expedicao', () => {
  it('menu usa data-recurso=expedicao; core não consulta fiscal para Expedição', () => {
    const html = read('frontend/erp/index.html');
    assert.match(html, /data-recurso="expedicao"[\s\S]{0,120}data-page="faturamento"/);

    const core = read('frontend/shared/js/core.js');
    assert.match(core, /function expedicaoHabilitada\s*\(/);
    assert.match(core, /aplicarVisibilidadeRecursoDom\('expedicao'/);
    assert.match(core, /if \(p === 'faturamento'\) return expedicaoHabilitada\(\)/);
    // Não amarrar Expedição a fiscalHabilitado
    assert.doesNotMatch(
      core,
      /function expedicaoHabilitada[\s\S]{0,200}fiscalHabilitado/
    );
    assert.doesNotMatch(
      core,
      /aplicarVisibilidadeRecursoDom\('expedicao',\s*[^)]*fiscal/
    );
  });

  it('centro de config declara Expedição independente de Fiscal', () => {
    const cfg = read('frontend/erp/js/cds-centro-configuracoes.js');
    assert.match(cfg, /Expedição[\s\S]{0,120}módulo comercial|Não depende de Fiscal/i);
    assert.match(cfg, /habilitar_expedicao/);
  });

  it('save envia habilitar_expedicao + legado habilitar_faturamento', () => {
    const js = read('frontend/erp/js/configuracoes.js');
    assert.match(js, /habilitar_expedicao:/);
    assert.match(js, /habilitar_faturamento:/);
  });

  it('API /api/faturamento continua com exigirRecurso faturamento (alias comercial)', () => {
    const server = read('backend/server.js');
    assert.match(server, /\/api\/faturamento'.*exigirRecurso\('faturamento'\)/s);
    const fat = read('backend/services/faturamento/FaturamentoService.js');
    assert.match(fat, /recursoHabilitado\('expedicao'\)/);
  });

  it('getRecursos não deriva expedicao de fiscalBase', () => {
    const src = read('backend/services/configuracaoService.js');
    assert.match(src, /resolverExpedicaoComercial/);
    assert.match(src, /expedicao NÃO herda de fiscal/);
    // Garantir que não existe padrão "expedicao = fiscalBase &&"
    assert.doesNotMatch(src, /expedicao\s*=\s*fiscalBase/);
    assert.doesNotMatch(src, /expedicao:\s*fiscal/);
  });
});
