/**
 * Sprint 3.3 — Central operacional NF-e (pós-emissão)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { extrairXmlAutorizado, validarPrazoCancelamento } = (() => {
  const central = require('../../backend/services/fiscal/nfeCentralService');
  const cancel = require('../../backend/services/fiscal/cancelarNfe');
  return {
    extrairXmlAutorizado: central.extrairXmlAutorizado,
    validarPrazoCancelamento: cancel.validarPrazoCancelamento
  };
})();

const { ModelType } = require('../../backend/services/fiscal/core/ModelType');
const { OperationType } = require('../../backend/services/fiscal/core/OperationType');
const { EnvironmentType } = require('../../backend/services/fiscal/core/EnvironmentType');
const { FiscalWebServices } = require('../../backend/services/fiscal/core/FiscalWebServices');

describe('Sprint 3.3 — extrairXmlAutorizado', () => {
  it('prefers nfeProc from xml_retorno', () => {
    const xml = extrairXmlAutorizado({
      xml_retorno: '<ret><nfeProc versao="4.00"><NFe/></nfeProc></ret>',
      xml_enviado: '<NFe>x</NFe>'
    });
    assert.match(xml, /<nfeProc/);
  });

  it('monta nfeProc a partir de NFe + protNFe', () => {
    const xml = extrairXmlAutorizado({
      xml_enviado: '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe1"/></NFe>',
      xml_retorno: '<retEnvEvento><protNFe><infProt><nProt>1</nProt></infProt></protNFe></retEnvEvento>'
    });
    assert.match(xml, /<nfeProc/);
    assert.match(xml, /<NFe/);
    assert.match(xml, /<protNFe/);
  });
});

describe('Sprint 3.3 — prazo cancelamento', () => {
  it('aceita nota recente', () => {
    const r = validarPrazoCancelamento({ created_at: new Date().toISOString() });
    assert.equal(r.ok, true);
  });

  it('rejeita nota com mais de 24h', () => {
    const antiga = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    const r = validarPrazoCancelamento({ created_at: antiga });
    assert.equal(r.ok, false);
    assert.match(r.erro, /Prazo legal/);
  });
});

describe('Sprint 3.3 — Registry cancela NF-e modelo 55', () => {
  it('resolve CANCELAMENTO NFE no registry', () => {
    const platform = new FiscalWebServices();
    const resolution = platform.resolve({
      modelo: ModelType.NFE,
      operacao: OperationType.CANCELAMENTO,
      ambiente: EnvironmentType.HOMOLOGACAO,
      uf: 'SVRS',
      versao: '1.00'
    });
    assert.equal(resolution.success, true);
    assert.ok(resolution.definition?.endpoint);
    assert.match(resolution.definition.endpoint, /nfe/i);
  });
});

describe('Sprint 3.3 — Núcleo Transacional intacto', () => {
  it('não altera VendaApplicationService / VendaPagamentoService nesta sprint', () => {
    const root = path.join(__dirname, '../..');
    const appSvc = fs.readFileSync(path.join(root, 'backend/services/vendas/VendaApplicationService.js'), 'utf8');
    const pagSvc = fs.readFileSync(path.join(root, 'backend/services/vendas/VendaPagamentoService.js'), 'utf8');
    assert.doesNotMatch(appSvc, /nfeCentralService|cancelarNfe|\/api\/nfe/);
    assert.doesNotMatch(pagSvc, /nfeCentralService|cancelarNfe|\/api\/nfe/);
  });

  it('rotas /api/nfe existem e exigem recurso', () => {
    const rotas = fs.readFileSync(path.join(__dirname, '../../backend/rotas/nfe.js'), 'utf8');
    assert.match(rotas, /exigirRecurso\('nfe'\)/);
    assert.match(rotas, /\/notas\/:id\/consultar/);
    assert.match(rotas, /\/notas\/:id\/cancelar/);
    assert.match(rotas, /\/notas\/:id\/historico/);
    assert.match(rotas, /\/notas\/:id\/xml/);
    assert.match(rotas, /\/notas\/:id\/danfe/);
  });

  it('UI Central NF-e e menu com data-recurso=nfe', () => {
    const ui = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/nfe-central.js'), 'utf8');
    const index = fs.readFileSync(path.join(__dirname, '../../frontend/erp/index.html'), 'utf8');
    const core = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/core.js'), 'utf8');
    assert.match(ui, /Central NF-e|NF-e Emitidas/);
    assert.match(ui, /consultarSituacaoNfe/);
    assert.match(ui, /cancelarNfeNota/);
    assert.match(ui, /Histórico/);
    assert.match(index, /data-recurso="nfe"/);
    assert.match(index, /data-page="nfe-central"/);
    assert.match(core, /nfe-central/);
    assert.match(core, /possuiRecurso\('nfe'\)/);
  });
});
