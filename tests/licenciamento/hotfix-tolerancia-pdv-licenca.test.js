/**
 * Hotfix — Tolerância de 5 dias no PDV + Assinatura sempre acessível
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const licencaService = require('../../backend/services/licencaService');
const licencaMw = require('../../backend/middleware/licencaMiddleware');
const { isPublicApiPath } = require('../../backend/middleware/apiPublicPaths');

const ROOT = path.join(__dirname, '../..');

describe('Tolerância PDV — cálculo de datas', () => {
  it('DIAS_TOLERANCIA_PDV é 5', () => {
    assert.equal(licencaService.DIAS_TOLERANCIA_PDV, 5);
    assert.equal(licencaMw.DIAS_TOLERANCIA_PDV, 5);
  });

  it('estaEmToleranciaPdv libera até data_expiracao + 5 dias', () => {
    const agora = new Date();
    const expiradaHa2Dias = new Date(agora.getTime());
    expiradaHa2Dias.setDate(expiradaHa2Dias.getDate() - 2);
    assert.equal(licencaService.estaEmToleranciaPdv(expiradaHa2Dias.toISOString()), true);

    const expiradaHa6Dias = new Date(agora.getTime());
    expiradaHa6Dias.setDate(expiradaHa6Dias.getDate() - 6);
    assert.equal(licencaService.estaEmToleranciaPdv(expiradaHa6Dias.toISOString()), false);
  });

  it('calcularDiasAposVencimento retorna 0 se ainda não venceu', () => {
    const futuro = new Date();
    futuro.setDate(futuro.getDate() + 3);
    assert.equal(licencaService.calcularDiasAposVencimento(futuro.toISOString()), 0);
  });
});

describe('Tolerância PDV — allowlist operacional', () => {
  it('libera rotas do PDV durante a tolerância', () => {
    assert.equal(licencaMw.isAllowedDuringPdvGrace({ originalUrl: '/api/vendas', method: 'POST' }), true);
    assert.equal(licencaMw.isAllowedDuringPdvGrace({ originalUrl: '/api/caixa/aberto', method: 'GET' }), true);
    assert.equal(licencaMw.isAllowedDuringPdvGrace({ originalUrl: '/api/fiscal/emitir/venda/1', method: 'POST' }), true);
    assert.equal(licencaMw.isAllowedDuringPdvGrace({ originalUrl: '/api/pix/criar-cobranca', method: 'POST' }), true);
    assert.equal(licencaMw.isAllowedDuringPdvGrace({ originalUrl: '/api/tef/pagar', method: 'POST' }), true);
    assert.equal(licencaMw.isAllowedDuringPdvGrace({ originalUrl: '/api/produtos', method: 'GET' }), true);
  });

  it('não libera ERP/backoffice na tolerância do PDV', () => {
    assert.equal(licencaMw.isAllowedDuringPdvGrace({ originalUrl: '/api/financeiro/contas', method: 'GET' }), false);
    assert.equal(licencaMw.isAllowedDuringPdvGrace({ originalUrl: '/api/compras', method: 'GET' }), false);
    assert.equal(licencaMw.isAllowedDuringPdvGrace({ originalUrl: '/api/nfe/notas', method: 'GET' }), false);
    assert.equal(licencaMw.isAllowedDuringPdvGrace({ originalUrl: '/api/faturamento/pedidos', method: 'GET' }), false);
  });
});

describe('Assinatura sempre liberada', () => {
  it('/api/licenca permanece pública no gate de licença', () => {
    assert.equal(isPublicApiPath('/api/licenca'), true);
    assert.equal(isPublicApiPath('/api/licenca/ativar'), true);
  });

  it('rotas GET/POST ativar usam verificarToken (não exigem configuracoes)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/rotas/licenca.js'), 'utf8');
    assert.match(src, /router\.get\('\/',\s*verificarToken/);
    assert.match(src, /router\.post\('\/ativar',\s*verificarToken/);
    assert.doesNotMatch(src, /router\.get\('\/',\s*verificarPermissaoEspecifica\('configuracoes'\)/);
    assert.doesNotMatch(src, /router\.post\('\/ativar',\s*verificarPermissaoEspecifica\('configuracoes'\)/);
  });

  it('frontend libera página licenca e mantém item Assinatura no menu', () => {
    const acl = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/access-control.js'), 'utf8');
    const core = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/core.js'), 'utf8');
    const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/index.html'), 'utf8');

    assert.match(acl, /page === 'licenca'/);
    assert.match(core, /page === 'licenca'/);
    assert.match(pdv, /erp\?page=licenca/);
    assert.match(pdv, /Assinatura/);
  });
});
