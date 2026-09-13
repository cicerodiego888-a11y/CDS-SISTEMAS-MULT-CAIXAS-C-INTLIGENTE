/**
 * RC4.1.0 — Congelamento Arquitetura Comercial/Fiscal V4.
 * Não adiciona feature: valida invariantes e documentação.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('RC4.1.0 — Congelamento V4', () => {
  it('documentação oficial e marco CONGELADA existem', () => {
    const doc = path.join(ROOT, 'docs/arquitetura/ARQUITETURA_COMERCIAL_FISCAL_V4.md');
    const marco = path.join(ROOT, 'docs/arquitetura/ARQUITETURA_COMERCIAL_FISCAL_V4_CONGELAMENTO.md');
    assert.ok(fs.existsSync(doc));
    assert.ok(fs.existsSync(marco));
    assert.match(read('docs/arquitetura/ARQUITETURA_COMERCIAL_FISCAL_V4_CONGELAMENTO.md'), /CONGELADA/);
    assert.match(read('docs/arquitetura/ARQUITETURA_COMERCIAL_FISCAL_V4.md'), /RC4\.1\.0/);
    assert.match(read('docs/arquitetura/ARQUITETURA_COMERCIAL_FISCAL_V4.md'), /central-faturamento/);
  });

  it('Expedição não emite NF-e (invariante)', () => {
    const src = read('backend/services/faturamento/FaturamentoService.js');
    assert.doesNotMatch(src, /emitirNfePorVendaId\s*\(/);
    assert.match(src, /proxima_etapa:\s*'central_faturamento'/);
    assert.match(src, /emitir_nfe:\s*false/);
  });

  it('emissão canônica na Central; legado marcado Deprecation', () => {
    const central = read('backend/rotas/centralFaturamento.js');
    const fat = read('backend/rotas/faturamento.js');
    assert.match(central, /\/vendas\/:vendaId\/emitir/);
    assert.match(fat, /Deprecation/);
    assert.match(fat, /central-faturamento/);
    assert.match(fat, /Arquitetura Comercial\/Fiscal V4 CONGELADA/);
  });

  it('catálogo de permissões V4 preparado', () => {
    const {
      ACOES_COMERCIAL_FISCAL_V4,
      PERMISSOES_COMERCIAL_FISCAL_V4,
      avaliarPermissaoV4
    } = require('../../backend/services/faturamento/permissoesComercialFiscalV4');
    assert.equal(ACOES_COMERCIAL_FISCAL_V4.EMITIR_NFE, 'nfe_emitir');
    assert.ok(PERMISSOES_COMERCIAL_FISCAL_V4.length >= 8);
    const compat = avaliarPermissaoV4([], 'nfe_emitir');
    assert.equal(compat.permitido, true);
    assert.equal(compat.modo, 'compat');
    const rbacOk = avaliarPermissaoV4(['nfe_emitir'], 'nfe_emitir');
    assert.equal(rbacOk.permitido, true);
    const rbacNo = avaliarPermissaoV4(['nfe_emitir'], 'nfe_cancelar');
    assert.equal(rbacNo.permitido, false);

    const auth = read('backend/middleware/auth.js');
    assert.match(auth, /nfe_emitir/);
    assert.match(auth, /expedicao_expedir/);
  });

  it('nomenclatura expõe ARQUITETURA_V4 CONGELADA', () => {
    const src = read('frontend/shared/js/cds-nomenclatura.js');
    assert.match(src, /ARQUITETURA_V4/);
    assert.match(src, /CONGELADA/);
    assert.match(src, /centralFaturamento/);
  });

  it('CHANGELOG registra congelamento V4', () => {
    const src = read('docs/roadmap/CHANGELOG_ARQUITETURAL.md');
    assert.match(src, /Comercial\/Fiscal V4|RC4\.1\.0/);
  });
});
