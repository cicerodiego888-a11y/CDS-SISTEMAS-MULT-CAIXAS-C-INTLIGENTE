/**
 * Hotfix RC1.3 — QRCodeService + Barra de Status
 */
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const QRCodeService = require('../../backend/services/qrcode/QRCodeService');
const plataformaStatus = require('../../backend/services/plataformaStatusService');

describe('Hotfix RC1.3 — QRCodeService', () => {
  before(() => {
    QRCodeService.limparCache();
  });

  it('gera PIX, WhatsApp, Link, Base64 e SVG', async () => {
    const pix = await QRCodeService.gerarPix('pix@cds.com');
    assert.equal(pix.sucesso, true);
    assert.ok(pix.imagem.startsWith('data:image/png;base64,'));

    const wa = await QRCodeService.gerarWhatsApp('https://wa.me/5588999999999');
    assert.equal(wa.sucesso, true);

    const link = await QRCodeService.gerarLink('https://cds.exemplo/portal');
    assert.equal(link.sucesso, true);
    assert.equal(link.uso, 'link');

    const b64 = await QRCodeService.gerarBase64('conteudo-teste');
    assert.ok(b64 && b64.includes('base64'));

    const svg = await QRCodeService.gerarSvg('conteudo-svg');
    assert.ok(svg && svg.includes('<svg'));
  });

  it('cache reutiliza QR com mesmo conteúdo', async () => {
    QRCodeService.limparCache();
    const a = await QRCodeService.gerar('cache-rc13', { formato: 'dataurl', largura: 180 });
    const b = await QRCodeService.gerar('cache-rc13', { formato: 'dataurl', largura: 180 });
    assert.equal(a.cache, false);
    assert.equal(b.cache, true);
    assert.equal(a.imagem, b.imagem);
    assert.ok(QRCodeService.estatisticasCache().tamanho >= 1);
  });

  it('DANFE e PIX usam QRCodeService (sem require qrcode direto)', () => {
    const danfe = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/danfe.js'), 'utf8');
    assert.match(danfe, /QRCodeService/);
    assert.doesNotMatch(danfe, /require\(['\"]qrcode['\"]\)/);

    const pixGen = fs.readFileSync(path.join(ROOT, 'backend/services/pix/QRCodePixGenerator.js'), 'utf8');
    assert.match(pixGen, /QRCodeService/);
    assert.doesNotMatch(pixGen, /require\(['\"]qrcode['\"]\)/);

    const lic = fs.readFileSync(path.join(ROOT, 'backend/services/licenciamentoCdsService.js'), 'utf8');
    assert.match(lic, /gerarWhatsApp|QRCodeService/);
  });
});

describe('Hotfix RC1.3 — Barra de Status', () => {
  it('cores e mensagens por dias restantes', () => {
    assert.equal(plataformaStatus.resolverTomAssinatura({
      status: 'ativa', diasRestantes: 10, dataExpiracaoFmt: '20/08/2026'
    }).cor, 'verde');
    assert.match(plataformaStatus.resolverTomAssinatura({
      status: 'ativa', diasRestantes: 10, dataExpiracaoFmt: '20/08/2026'
    }).mensagem, /válida até/);

    assert.equal(plataformaStatus.resolverTomAssinatura({
      status: 'aviso', diasRestantes: 3, dataExpiracaoFmt: '20/08/2026'
    }).cor, 'amarelo');
    assert.equal(plataformaStatus.resolverTomAssinatura({
      status: 'aviso', diasRestantes: 2, dataExpiracaoFmt: '20/08/2026'
    }).mensagem, 'Assinatura expira em 2 dias');
    assert.equal(plataformaStatus.resolverTomAssinatura({
      status: 'aviso', diasRestantes: 1, dataExpiracaoFmt: '20/08/2026'
    }).cor, 'laranja');
    assert.equal(plataformaStatus.resolverTomAssinatura({
      status: 'aviso', diasRestantes: 1, dataExpiracaoFmt: '20/08/2026'
    }).mensagem, 'Assinatura expira amanhã');
    assert.equal(plataformaStatus.resolverTomAssinatura({
      status: 'vencida', diasRestantes: 0, dataExpiracaoFmt: '20/08/2026'
    }).cor, 'vermelho');
    assert.equal(plataformaStatus.resolverTomAssinatura({
      status: 'vencida', diasRestantes: 0, dataExpiracaoFmt: '20/08/2026'
    }).mensagem, 'Assinatura expira hoje');
  });

  it('plano e versão não são fixos hardcoded no serviço', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/services/plataformaStatusService.js'), 'utf8');
    assert.match(src, /package\.json/);
    assert.match(src, /resolverPlano/);
    assert.match(src, /slots_futuros/);

    const plano = plataformaStatus.resolverPlano({ tipoImplantacao: 'ERP_MULTICAIXA' }, null);
    assert.equal(plano, 'Enterprise');
    const planoCfg = plataformaStatus.resolverPlano({ licenca_plano: 'Premium' }, null);
    assert.equal(planoCfg, 'Premium');

    const versao = plataformaStatus.lerVersaoSistema();
    assert.ok(String(versao).length > 0);
    assert.notEqual(versao, '1.0'); // lê package.json (ex.: 1.0.3)
  });

  it('ERP monta rodapé e rota /api/plataforma/status', () => {
    const index = fs.readFileSync(path.join(ROOT, 'frontend/erp/index.html'), 'utf8');
    assert.match(index, /cds-plataforma-status/);
    assert.match(index, /cds-plataforma-status\.js/);

    const server = fs.readFileSync(path.join(ROOT, 'backend/server.js'), 'utf8');
    assert.match(server, /\/api\/plataforma/);
  });
});
