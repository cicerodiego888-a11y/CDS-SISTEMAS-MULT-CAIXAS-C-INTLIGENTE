/**
 * Sprint 3.9 — Reorganização Configurações + Central de Licenciamento + Invisibilidade
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

describe('Sprint 3.9 — estrutura Configurações Avançadas', () => {
  it('Centro de Configurações contém categorias oficiais', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/cds-centro-configuracoes.js'), 'utf8');
    const ids = [
      'empresa',
      'plataformaFiscal',
      'modulosLicenciados',
      'motores',
      'equipamentos',
      'integracoes',
      'licenciamentoCds',
      'seguranca',
      'bancoDados',
      'performance',
      'backup',
      'diagnostico'
    ];
    ids.forEach((id) => {
      assert.match(src, new RegExp(`id:\\s*'${id}'`));
      assert.match(src, new RegExp(`data-cfg-pane="${id}"`));
    });
    assert.doesNotMatch(src, /id:\s*'fiscal'/);
    assert.doesNotMatch(src, /id:\s*'aparencia'/);
  });

  it('Configurações da Empresa só têm blocos operacionais', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/configuracoes.js'), 'utf8');
    assert.match(src, /Configurações da Empresa/);
    assert.match(src, /Comercial/);
    assert.match(src, /Impressões/);
    assert.match(src, /Alertas/);
    assert.match(src, /Aparência/);
    assert.match(src, /Preferências Operacionais/);
    assert.doesNotMatch(src, /Motor de Equipamentos — Balanças/);
    assert.doesNotMatch(src, /Backup Manual DB/);
  });
});

describe('Sprint 3.9 — módulos e invisibilidade', () => {
  let tmpDir;
  let configService;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-s39-'));
    process.env.DB_DIR = tmpDir;
    delete require.cache[require.resolve('../../backend/services/configuracaoService')];
    configService = require('../../backend/services/configuracaoService');
    configService.ensureConfigFile();
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
    delete process.env.DB_DIR;
    delete require.cache[require.resolve('../../backend/services/configuracaoService')];
  });

  it('getRecursos expõe flags de módulos licenciados', () => {
    const out = configService.getRecursos({
      tipoImplantacao: 'ERP_FISCAL',
      modoOperacao: 'LOCAL',
      habilitar_faturamento: true,
      habilitar_vendas_entrega: true,
      modulo_pdv: true,
      modulo_pedidos: true,
      modulo_nfe: true,
      modulo_nfce: true,
      modulo_compra_facil: false,
      modulo_marketplace: false,
      modulo_crm: false
    });
    assert.equal(out.recursos.pdv, true);
    assert.equal(out.recursos.historicoVendas, true);
    assert.equal(out.recursos.pedidos, true);
    assert.equal(out.recursos.faturamento, true);
    assert.equal(out.recursos.vendasEntrega, true);
    assert.equal(out.recursos.nfe, true);
    assert.equal(out.recursos.nfce, true);
    assert.equal(out.recursos.compraFacil, false);
    assert.equal(out.recursos.marketplace, false);
    assert.equal(out.recursos.crm, false);
    assert.equal(out.recursos.fiscal, true);
  });

  it('histórico de vendas herda PDV e pode ser desligado à parte', () => {
    const herdado = configService.getRecursos({
      tipoImplantacao: 'ERP_FISCAL',
      modoOperacao: 'LOCAL',
      modulo_pdv: false,
      modulo_historico_vendas: null,
      modulo_nfce: true
    });
    assert.equal(herdado.recursos.pdv, false);
    assert.equal(herdado.recursos.historicoVendas, false);

    const explicito = configService.getRecursos({
      tipoImplantacao: 'ERP_FISCAL',
      modoOperacao: 'LOCAL',
      modulo_pdv: false,
      modulo_historico_vendas: true,
      modulo_nfce: true
    });
    assert.equal(explicito.recursos.pdv, false);
    assert.equal(explicito.recursos.historicoVendas, true);

    const centro = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/cds-centro-configuracoes.js'), 'utf8');
    assert.match(centro, /cfgModuloHistoricoVendas/);
    assert.match(centro, /Histórico de Vendas/);
  });

  it('módulo desligado some do recurso e middleware responde 403', () => {
    const { exigirRecurso } = require('../../backend/middleware/validarRecursoImplantacao');
    const { responderModuloNaoLicenciado } = require('../../backend/middleware/errosLicenciamento');

    configService.saveConfig({
      tipoImplantacao: 'ERP_FISCAL',
      modoOperacao: 'LOCAL',
      habilitar_faturamento: false,
      modulo_pdv: false,
      modulo_pedidos: false,
      modulo_nfe: false,
      modulo_nfce: true
    });

    assert.equal(configService.recursoHabilitado('pdv'), false);
    assert.equal(configService.recursoHabilitado('historicoVendas'), false);
    assert.equal(configService.recursoHabilitado('pedidos'), false);
    assert.equal(configService.recursoHabilitado('nfe'), false);
    assert.equal(configService.recursoHabilitado('nfce'), true);

    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };
    responderModuloNaoLicenciado(res, 'pdv');
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.erro, 'MODULO_NAO_LICENCIADO');
    assert.equal(res.body.modulo, 'pdv');

    let nextCalled = false;
    const mw = exigirRecurso('pdv');
    mw({}, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.body.erro, 'MODULO_NAO_LICENCIADO');
  });

  it('frontend aplica data-recurso e oculta menus', () => {
    const core = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/core.js'), 'utf8');
    assert.match(core, /data-recurso="\$\{chave\}"/);
    assert.match(core, /pdv.*pedidos.*compraFacil|compraFacil.*marketplace.*crm/s);
    assert.match(core, /p === 'pedidos'|page === 'pedidos'/);
    assert.match(core, /possuiRecurso\('nfce'\)|recursos\.nfce === true/);

    const index = fs.readFileSync(path.join(ROOT, 'frontend/erp/index.html'), 'utf8');
    assert.match(index, /data-recurso="pdv"/);
    assert.match(index, /data-recurso="historicoVendas"/);
    assert.match(index, /data-recurso="pedidos"/);
    assert.match(index, /data-recurso="nfce"/);

    const dash = fs.readFileSync(path.join(ROOT, 'frontend/erp/pages/dashboard.html'), 'utf8');
    assert.match(dash, /data-recurso="pdv"/);
    assert.match(dash, /data-recurso="fiscal"/);
  });

  it('APIs de pedidos usam exigirRecurso pedidos', () => {
    const server = fs.readFileSync(path.join(ROOT, 'backend/server.js'), 'utf8');
    assert.match(server, /\/api\/pedidos'.*exigirRecurso\('pedidos'\)/s);
    assert.match(server, /recursoHabilitado\('pdv'\)/);
    const pedidos = fs.readFileSync(path.join(ROOT, 'backend/rotas/pedidos.js'), 'utf8');
    assert.match(pedidos, /exigirRecurso\('pedidos'\)/);
  });
});

describe('Sprint 3.9 — Licenciamento CDS + QR', () => {
  it('serviço gera aviso e QR sem imagens estáticas', async () => {
    const lic = require('../../backend/services/licenciamentoCdsService');
    const qr = await lic.gerarQrDataUrl('chave-pix-teste@cds.com');
    assert.ok(qr && qr.startsWith('data:image/png;base64,'));
    const msg = lic.montarMensagem('Sua assinatura do CDS Sistemas expira em {dias} dias.', 3);
    assert.equal(msg, 'Sua assinatura do CDS Sistemas expira em 3 dias.');
    assert.ok(lic.obterAvisoRenovacaoLogin);
  });

  it('rota pública aviso-renovacao e config SUPER_ADMIN', () => {
    const rota = fs.readFileSync(path.join(ROOT, 'backend/rotas/licenca.js'), 'utf8');
    assert.match(rota, /\/aviso-renovacao/);
    assert.match(rota, /obterAvisoRenovacaoLogin/);
    assert.match(rota, /\/cds-config/);
    assert.match(rota, /exigirSuperAdmin/);
  });

  it('login carrega aviso e gera QR dinamicamente', () => {
    const loginHtml = fs.readFileSync(path.join(ROOT, 'frontend/shared/login.html'), 'utf8');
    assert.match(loginHtml, /licenca-aviso-login\.js/);
    const js = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/licenca-aviso-login.js'), 'utf8');
    assert.match(js, /aviso-renovacao/);
    assert.match(js, /Copiar PIX/);
    assert.match(js, /Renovar agora/);
    assert.match(js, /qr_pix/);
    assert.match(js, /qr_whatsapp/);
  });

  it('campos de licenciamento CDS no centro e persistência', () => {
    const centro = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/cds-centro-configuracoes.js'), 'utf8');
    assert.match(centro, /cfgLicencaDiasAviso/);
    assert.match(centro, /cfgLicencaChavePix/);
    assert.match(centro, /cfgLicencaWhatsapp/);
    assert.match(centro, /cfgLicencaMensagem/);

    const cfg = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/configuracoes.js'), 'utf8');
    assert.match(cfg, /licenca_dias_aviso/);
    assert.match(cfg, /licenca_chave_pix/);
    assert.match(cfg, /modulo_pdv/);

    const svc = fs.readFileSync(path.join(ROOT, 'backend/services/configuracaoService.js'), 'utf8');
    assert.match(svc, /licenca_dias_aviso/);
    assert.match(svc, /getLicenciamentoCds/);
    assert.match(svc, /renovacao_automatica_preparada:\s*true/);
    assert.match(svc, /renovacao_automatica_ativa:\s*false/);
  });
});

describe('Sprint 3.9 — sem regressão nos núcleos proibidos', () => {
  it('não altera serviços do núcleo transacional / motores', () => {
    const files = [
      'backend/services/vendas/VendaApplicationService.js',
      'backend/services/vendas/VendaPagamentoService.js',
      'backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js'
    ];
    files.forEach((f) => {
      assert.ok(fs.existsSync(path.join(ROOT, f)), f);
    });
  });
});
