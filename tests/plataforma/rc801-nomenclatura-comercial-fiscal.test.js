/**
 * RC8.0.1 — Separação conceitual Comercial (Expedição) × Fiscal (Faturamento).
 * Apenas nomenclatura de UI — APIs/enums inalterados.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('RC8.0.1 — nomenclatura Comercial × Fiscal', () => {
  it('helper CdsNomenclatura existe com Expedição e Faturamento fiscal', () => {
    const src = read('frontend/shared/js/cds-nomenclatura.js');
    assert.match(src, /Expedição/);
    assert.match(src, /faturamento:\s*'Faturamento'/);
    assert.match(src, /emitirNfeAposExpedir/);
    assert.match(src, /tituloModuloExpedicao/);
  });

  it('menu ERP exibe Expedição (não Faturamento) no fluxo comercial', () => {
    const html = read('frontend/erp/index.html');
    assert.match(html, /data-page="faturamento"/);
    assert.match(html, /data-recurso="expedicao"/);
    assert.match(html, /title="Expedição"/);
    assert.match(html, /<span>Expedição<\/span>/);
    assert.doesNotMatch(html, /data-page="faturamento"[^>]*>[\s\S]{0,120}<span>Faturamento<\/span>/);
    assert.match(html, /cds-nomenclatura\.js/);
  });

  it('PAGE_META e catálogo usam Expedição', () => {
    assert.match(read('frontend/shared/js/cds-page-shell.js'), /titulo:\s*'Expedição'/);
    assert.match(read('frontend/shared/js/core.js'), /titulo:\s*'Expedição'/);
  });

  it('Pedidos: status e ações usam Expedição (enums de API intactos)', () => {
    const ui = read('frontend/erp/js/pedidos.js');
    assert.match(ui, /AGUARDANDO_FATURAMENTO:\s*'Aguardando Expedição'/);
    assert.match(ui, /FATURADO:\s*'Expedido'/);
    assert.match(ui, /Enviar para Expedição/);
    assert.match(ui, /enviar-faturamento/);
    assert.match(ui, /loadPage\('faturamento'\)/);
  });

  it('tela Expedição: título comercial; NF-e na Central de Faturamento', () => {
    const fat = read('frontend/erp/js/faturamento.js');
    assert.match(fat, /Expedição \(comercial\)|tituloModuloExpedicao|Expedir pedido/);
    assert.match(fat, /Central de Faturamento/);
    assert.match(fat, /\/faturamento\/pedidos/);
    assert.match(fat, /emitir_nfe:\s*false/);
    assert.doesNotMatch(fat, /id="fatEmitirNfe"/);
  });

  it('módulo licenciado exibe Expedição; mensagem 403 alinhada', () => {
    const cfg = read('frontend/erp/js/cds-centro-configuracoes.js');
    assert.match(cfg, /cfgHabilitarFaturamento[\s\S]{0,80}Expedição/);
    const err = read('backend/middleware/errosLicenciamento.js');
    assert.match(err, /módulo Expedição não está habilitado/i);
  });

  it('KPI dashboard de receita não se chama Faturamento', () => {
    const dash = read('frontend/erp/pages/dashboard.html');
    assert.match(dash, /cc-label">Receita</);
    assert.doesNotMatch(dash, /cc-label">Faturamento</);
  });

  it('não altera contrato de API / recurso faturamento', () => {
    const server = read('backend/server.js');
    assert.match(server, /\/api\/faturamento/);
    assert.match(server, /exigirRecurso\('faturamento'\)/);
    const svc = read('backend/services/configuracaoService.js');
    assert.match(svc, /habilitar_faturamento/);
    assert.match(svc, /faturamento:/);
  });
});
