/**
 * Hotfix RC1.1 — Geração automática do QR Code PIX (assinatura)
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const QRCodePixGenerator = require('../../backend/services/pix/QRCodePixGenerator');

describe('Hotfix RC1.1 — QRCodePixGenerator', () => {
  it('PIX vazio: sem QR e mensagem oficial', async () => {
    const out = await QRCodePixGenerator.gerar({ chavePix: '' });
    assert.equal(out.configurado, false);
    assert.equal(out.imagem, null);
    assert.equal(out.mensagem, 'PIX ainda não configurado.');
    assert.equal(out.dinamico_preparado, true);
    assert.equal(out.dinamico_ativo, false);
  });

  it('PIX preenchido: gera data URL Base64 sem arquivo', async () => {
    const chave = 'cds.renovacao@exemplo.com';
    const out = await QRCodePixGenerator.gerar({ chavePix: chave, formato: 'dataurl' });
    assert.equal(out.configurado, true);
    assert.equal(out.payload, chave);
    assert.ok(out.imagem.startsWith('data:image/png;base64,'));
    assert.equal(out.modo, 'estatico');
    assert.equal(out.dinamico_preparado, true);
  });

  it('PIX Copia e Cola: gera SVG em memória', async () => {
    const brCode = '00020126580014BR.GOV.BCB.PIX0136chave-aleatoria-teste-rc11';
    const svg = await QRCodePixGenerator.gerarSvg(brCode);
    assert.ok(svg && svg.includes('<svg'));
    assert.doesNotMatch(svg, /\.png|\.jpg|static\/|uploads\//i);
  });

  it('modo dinamico preparado sem ativar geração dinâmica', async () => {
    const out = await QRCodePixGenerator.gerar({
      chavePix: '11999999999',
      modo: QRCodePixGenerator.MODO_PIX.DINAMICO
    });
    assert.equal(out.configurado, true);
    assert.equal(out.dinamico_preparado, true);
    assert.equal(out.dinamico_ativo, false);
  });
});

describe('Hotfix RC1.1 — integração aviso / UI', () => {
  it('licenciamentoCdsService usa QRCodePixGenerator', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/services/licenciamentoCdsService.js'), 'utf8');
    assert.match(src, /QRCodePixGenerator/);
    assert.match(src, /pix_configurado/);
    assert.match(src, /pix_mensagem/);
    assert.doesNotMatch(src, /require\('qrcode'\)/);
  });

  it('Centro de Configurações expõe PIX Renovação', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/cds-centro-configuracoes.js'), 'utf8');
    assert.match(src, /PIX Renovação/);
    assert.match(src, /cfgLicencaChavePix/);
    assert.match(src, /Copia e Cola/);
  });

  it('aviso de assinatura: QR + Copiar PIX ou PIX vazio', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/licenca-aviso-login.js'), 'utf8');
    assert.match(src, /Copiar PIX/);
    assert.match(src, /PIX ainda não configurado/);
    assert.match(src, /pix_configurado/);
    assert.match(src, /data-lic-acao="copiar_pix"/);
  });

  it('configuracaoService persiste licenca_chave_pix / pix_renovacao', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/services/configuracaoService.js'), 'utf8');
    assert.match(src, /licenca_chave_pix/);
    assert.match(src, /pix_renovacao/);
  });
});
