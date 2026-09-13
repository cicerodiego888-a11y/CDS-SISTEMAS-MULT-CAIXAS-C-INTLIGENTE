/**
 * RC8.0.0 — Ocultação completa do Módulo Fiscal (ERP Comercial).
 * Garante verificação centralizada + gates de API/UI sem remover código.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC8.0.0 — fiscalHabilitado centralizado', () => {
  it('backend expõe fiscalHabilitado baseado em recursos.fiscal', () => {
    const svc = require('../../backend/services/configuracaoService');
    assert.equal(typeof svc.fiscalHabilitado, 'function');
    assert.equal(typeof svc.recursoHabilitado, 'function');

    const sem = svc.getRecursos({
      tipoImplantacao: 'ERP_SEM_FISCAL',
      modoOperacao: 'LOCAL',
      porta: 3001
    });
    assert.equal(sem.recursos.fiscal, false);
    assert.equal(svc.fiscalHabilitado({
      tipoImplantacao: 'ERP_SEM_FISCAL',
      modoOperacao: 'LOCAL',
      porta: 3001
    }), false);

    const com = svc.getRecursos({
      tipoImplantacao: 'ERP_FISCAL',
      modoOperacao: 'LOCAL',
      porta: 3001
    });
    assert.equal(com.recursos.fiscal, true);
    assert.equal(svc.fiscalHabilitado({
      tipoImplantacao: 'ERP_FISCAL',
      modoOperacao: 'LOCAL',
      porta: 3001
    }), true);
  });

  it('mensagem fiscal da API é "Módulo Fiscal não contratado."', () => {
    const { mensagemModulo, responderModuloNaoLicenciado } = require('../../backend/middleware/errosLicenciamento');
    assert.equal(mensagemModulo('fiscal'), 'Módulo Fiscal não contratado.');

    const res = {
      statusCode: 0,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };
    responderModuloNaoLicenciado(res, 'fiscal');
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.erro, 'MODULO_NAO_LICENCIADO');
    assert.equal(res.body.mensagem, 'Módulo Fiscal não contratado.');
    assert.equal(res.body.modulo, 'fiscal');
  });

  it('APIs fiscais montadas com exigirRecurso', () => {
    const server = read('backend/server.js');
    assert.match(server, /app\.use\('\/api\/fiscal'[\s\S]*exigirRecurso\('fiscal'\)/);
    assert.match(server, /app\.use\('\/api\/nfe'[\s\S]*exigirRecurso\('nfe'\)/);
    assert.match(server, /app\.use\('\/api\/dfe'[\s\S]*exigirRecurso\('fiscal'\)/);
    assert.match(server, /app\.use\('\/api\/central-entradas'[\s\S]*exigirRecurso\('fiscal'\)/);
  });
});

describe('RC8.0.0 — UI ERP Comercial (gates)', () => {
  it('core.js centraliza fiscalHabilitado e remove do DOM (não só CSS)', () => {
    const core = read('frontend/shared/js/core.js');
    assert.match(core, /function fiscalHabilitado\s*\(/);
    assert.match(core, /function aplicarVisibilidadeRecursoDom\s*\(/);
    assert.match(core, /removeChild\(node\)/);
    assert.match(core, /PAGINAS_MODULO_FISCAL/);
    assert.match(core, /function pesquisarPaginasSistema\s*\(/);
    assert.match(core, /function limparFavoritosFiscais\s*\(/);
    assert.match(core, /function adicionarFavoritoPagina\s*\(/);
    assert.match(core, /monitoring/);
    assert.match(core, /mensagemModuloNaoContratado/);
    assert.match(core, /window\.fiscalHabilitado\s*=\s*fiscalHabilitado/);
  });

  it('menu: Central de Monitoramento exige data-recurso=fiscal', () => {
    const html = read('frontend/erp/index.html');
    assert.match(html, /data-recurso="fiscal"[\s\S]*data-page="monitoring"/);
    assert.match(html, /data-nav-group="fiscal"[\s\S]*data-recurso="fiscal"/);
  });

  it('rotas SPA bloqueiam páginas fiscais com mensagem de módulo não contratado', () => {
    const erp = read('frontend/erp/js/app.js');
    assert.match(erp, /mensagemModuloNaoContratado/);
    assert.match(erp, /paginaPermitidaPorImplantacao/);
  });

  it('pesquisa global não retorna NF-e sem fiscal', () => {
    const core = read('frontend/shared/js/core.js');
    assert.match(core, /CATALOGO_PESQUISA_PAGINAS/);
    assert.match(core, /if \(item\.fiscal && !fiscalOn\) return false/);
  });

  it('centro de configurações oculta panes fiscais sem licença', () => {
    const cfg = read('frontend/erp/js/cds-centro-configuracoes.js');
    assert.match(cfg, /function categoriasVisiveis\s*\(/);
    assert.match(cfg, /fiscal:\s*true/);
    assert.match(cfg, /configPermiteFiscalUi/);
    assert.match(cfg, /fiscalUi \? `/);
  });

  it('dashboard não mantém cards fiscais "N/A" — só renderiza se contratado', () => {
    const dash = read('frontend/erp/js/dashboard-command.js');
    assert.match(dash, /fiscalHabilitado|implantacaoPermiteFiscal/);
    assert.match(dash, /if \(fiscalOk\) \{/);
    assert.match(dash, /fiscalOk && \{[\s\S]*label: 'Fiscal'/);
  });

  it('histórico de vendas não oferece botões fiscais sem módulo', () => {
    const hist = read('frontend/shared/js/vendasHistoricoUi.js');
    assert.match(hist, /function moduloFiscalDisponivelHistorico\s*\(/);
    assert.match(hist, /if \(!moduloFiscalDisponivelHistorico\(\)\) return false/);
  });
});
