/**
 * Identificação do caixa para F12 — terminal → caixa_id.
 *
 * node --test tests/f12-caixa-identificacao.test.js
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ObterCaixaAtual = require('../frontend/shared/js/obterCaixaAtual');

global.window = global;
global.localStorage = {
  store: {},
  getItem(key) { return this.store[key] || ''; },
  setItem(key, value) { this.store[key] = String(value); }
};
global.API_URL = 'http://test/api';

delete require.cache[require.resolve('../frontend/shared/js/F12PolicyResolver')];
const F12PolicyResolver = require('../frontend/shared/js/F12PolicyResolver');

const CORE_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/core.js'), 'utf8');
const RESOLVER_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/F12PolicyResolver.js'), 'utf8');
const POLICY_JS = fs.readFileSync(path.join(ROOT, 'backend/services/F12PolicyService.js'), 'utf8');
const PDV_JS = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
const PDV_HTML = fs.readFileSync(path.join(ROOT, 'frontend/pdv/index.html'), 'utf8');
const ERP_HTML = fs.readFileSync(path.join(ROOT, 'frontend/erp/index.html'), 'utf8');

const MSG = ObterCaixaAtual.MSG_CAIXA_NAO_IDENTIFICADO;

function contexto(terminal, extras) {
  return { terminal, caixas: extras && extras.caixas, ...extras };
}

async function simularF12(ctx, fetchMock) {
  const estadoAnterior = { fiscal: true };
  const chamadas = [];
  const fetchFn = fetchMock || (async (url, options) => {
    chamadas.push({ url: String(url), method: (options && options.method) || 'GET' });
    return {
      ok: true,
      json: async () => ({ novoEstado: false, ativo: false, success: true })
    };
  });

  const resolucao = await ObterCaixaAtual.obterCaixaAtual(ctx);
  if (!resolucao.ok || !resolucao.caixaId) {
    return {
      estadoAlterado: false,
      estado: estadoAnterior,
      endpoint: null,
      chamadas,
      caixaId: null,
      erro: resolucao.erro
    };
  }

  global.fetch = fetchFn;
  const result = await F12PolicyResolver.alternarF12(resolucao.caixaId);
  return {
    estadoAlterado: Boolean(result.success),
    estado: result.success ? { fiscal: result.novoEstado } : estadoAnterior,
    endpoint: `/f12/caixas/${resolucao.caixaId}/alternar`,
    chamadas,
    caixaId: resolucao.caixaId,
    erro: result.error || null
  };
}

describe('obterCaixaAtual — relação oficial terminal → caixa', () => {
  beforeEach(() => {
    global.__cdsTerminalAtual = null;
    global.terminalId = null;
    global.terminalCaixaId = null;
    F12PolicyResolver.limparCache();
  });

  it('Terminal 10 vinculado ao Caixa 2 resolve Caixa 2, nunca 10', () => {
    const resolucao = ObterCaixaAtual.resolverCaixaAtual(contexto(
      { id: 10, caixa_id: 2 },
      { caixas: [{ id: 2, nome: 'Caixa Frente' }] }
    ));

    assert.equal(resolucao.ok, true);
    assert.equal(resolucao.caixaId, 2);
    assert.equal(resolucao.terminalId, 10);
    assert.notEqual(resolucao.caixaId, resolucao.terminalId);
  });

  it('Terminal 2 vinculado ao Caixa 10 resolve Caixa 10, nunca 2', () => {
    const resolucao = ObterCaixaAtual.resolverCaixaAtual(contexto(
      { id: 2, caixa_id: 10 },
      { caixas: [{ id: 10, nome: 'Caixa Açougue' }] }
    ));

    assert.equal(resolucao.ok, true);
    assert.equal(resolucao.caixaId, 10);
    assert.equal(resolucao.terminalId, 2);
    assert.notEqual(resolucao.caixaId, resolucao.terminalId);
  });

  it('não usa terminal.id quando caixa_id está ausente', () => {
    const resolucao = ObterCaixaAtual.resolverCaixaAtual(contexto({ id: 1, caixa_id: null }));
    assert.equal(resolucao.ok, false);
    assert.equal(resolucao.caixaId, null);
    assert.equal(resolucao.erro, MSG);
  });

  it('não assume Caixa 1 quando o caixa não está identificado', () => {
    const resolucao = ObterCaixaAtual.resolverCaixaAtual({});
    assert.equal(resolucao.ok, false);
    assert.equal(resolucao.caixaId, null);
    assert.notEqual(resolucao.caixaId, 1);
    assert.equal(resolucao.erro, MSG);
  });

  it('rejeita caixa_id que não existe no cadastro informado', () => {
    const resolucao = ObterCaixaAtual.resolverCaixaAtual(contexto(
      { id: 10, caixa_id: 99 },
      { caixas: [{ id: 2 }, { id: 10 }] }
    ));
    assert.equal(resolucao.ok, false);
    assert.equal(resolucao.caixaId, null);
    assert.equal(resolucao.erro, MSG);
  });

  it('nunca trata window.terminalId como caixaId', () => {
    const resolucao = ObterCaixaAtual.resolverCaixaAtual({
      globals: { terminalId: 7 }
    });
    assert.equal(resolucao.ok, false);
    assert.equal(resolucao.caixaId, null);
    assert.equal(resolucao.terminalId, 7);
  });
});

describe('F12 — usa o caixa real, não o terminal', () => {
  it('F12 no Terminal 10 consulta o Caixa 2', async () => {
    const fluxo = await simularF12(contexto(
      { id: 10, caixa_id: 2 },
      { caixas: [{ id: 2 }] }
    ));

    assert.equal(fluxo.caixaId, 2);
    assert.equal(fluxo.endpoint, '/f12/caixas/2/alternar');
    assert.equal(fluxo.chamadas.some((c) => c.url.includes('/f12/caixas/2/alternar')), true);
    assert.equal(fluxo.chamadas.some((c) => c.url.includes('/f12/caixas/10/')), false);
    assert.equal(fluxo.chamadas.some((c) => c.url.includes('/f12/caixas/1/')), false);
  });

  it('F12 no Terminal 2 consulta o Caixa 10', async () => {
    const fluxo = await simularF12(contexto(
      { id: 2, caixa_id: 10 },
      { caixas: [{ id: 10 }] }
    ));

    assert.equal(fluxo.caixaId, 10);
    assert.equal(fluxo.endpoint, '/f12/caixas/10/alternar');
    assert.equal(fluxo.chamadas.some((c) => c.url.includes('/f12/caixas/10/alternar')), true);
    assert.equal(fluxo.chamadas.some((c) => c.url.includes('/f12/caixas/2/')), false);
  });

  it('caixa não identificado: F12 não altera estado e não chama endpoint', async () => {
    const fluxo = await simularF12(contexto({
      id: 4,
      caixa_id: null
    }, {
      fetch: async () => ({ ok: false, json: async () => null })
    }));

    assert.equal(fluxo.estadoAlterado, false);
    assert.equal(fluxo.estado.fiscal, true);
    assert.equal(fluxo.endpoint, null);
    assert.equal(fluxo.chamadas.length, 0);
    assert.equal(fluxo.caixaId, null);
    assert.match(String(fluxo.erro || ''), /Terminal sem caixa vinculado|identificar o caixa/);
  });

  it('fallback: sessão aberta resolve caixa_config quando terminal.caixa_id está vazio', async () => {
    const fluxo = await simularF12(contexto({
      id: 4,
      caixa_id: null
    }, {
      fetch: async (url) => {
        const u = String(url);
        if (u.includes('/terminais')) {
          return { ok: true, json: async () => ([{ id: 4, caixa_id: null }]) };
        }
        if (u.includes('/caixa/aberto')) {
          return {
            ok: true,
            json: async () => ({
              sessao: { id: 9, caixa_id: 2 }
            })
          };
        }
        if (u.includes('/f12/caixas/2/alternar')) {
          return { ok: true, json: async () => ({ novoEstado: false, ativo: false, success: true }) };
        }
        return { ok: false, json: async () => null };
      }
    }));

    assert.equal(fluxo.caixaId, 2);
    assert.equal(fluxo.estadoAlterado, true);
    assert.equal(fluxo.endpoint, '/f12/caixas/2/alternar');
  });

  it('F12PolicyResolver.obterCaixaAtual delega para a fonte única', async () => {
    const resolucao = await F12PolicyResolver.obterCaixaAtual(contexto(
      { id: 10, caixa_id: 2 },
      { caixas: [{ id: 2 }] }
    ));
    assert.equal(resolucao.ok, true);
    assert.equal(resolucao.caixaId, 2);
  });

  it('resolveF12Estado sem caixaId não assume estado e não chama endpoint', async () => {
    const chamadas = [];
    global.fetch = async (url) => {
      chamadas.push(String(url));
      return { ok: true, json: async () => ({ ativo: true }) };
    };
    const ativo = await F12PolicyResolver.resolveF12Estado(null);
    assert.equal(ativo, null);
    assert.equal(chamadas.length, 0);
  });
});

describe('F12 — regressão de identificação no código', () => {
  it('core.js não usa mais terminalId nem fallback para Caixa 1', () => {
    assert.doesNotMatch(CORE_JS, /caixaIdAtual\s*\|\|\s*window\.terminalId\s*\|\|\s*1/);
    assert.doesNotMatch(CORE_JS, /window\.terminalId\s*\|\|\s*1/);
    assert.match(CORE_JS, /obterCaixaAtualParaF12/);
    assert.match(CORE_JS, /Terminal sem caixa vinculado|Não foi possível identificar o caixa atual/);
  });

  it('core.js não cria segundo handler de F12', () => {
    const handlers = CORE_JS.match(/async function alternarModoFiscalComPolitica/g) || [];
    assert.equal(handlers.length, 1);
    assert.match(CORE_JS, /keydown\.modoFiscalF12[\s\S]*alternarModoFiscalGlobal/);
  });

  it('PDV persiste o caixa_id do terminal no contexto oficial', () => {
    assert.match(PDV_JS, /atualizarContextoTerminalAtual\(terminal\)/);
    assert.match(PDV_JS, /caixaId:\s*terminal\.caixa_id/);
  });

  it('obterCaixaAtual.js é carregado antes do F12PolicyResolver', () => {
    assert.match(PDV_HTML, /obterCaixaAtual\.js[\s\S]*F12PolicyResolver\.js/);
    assert.match(ERP_HTML, /obterCaixaAtual\.js[\s\S]*F12PolicyResolver\.js/);
  });

  it('compatibilidade das políticas legadas permanece no serviço', () => {
    assert.match(POLICY_JS, /POR_CAIXA/);
    assert.match(POLICY_JS, /GLOBAL/);
    assert.match(POLICY_JS, /MODO_ADMIN/);
    assert.match(POLICY_JS, /\['POR_CAIXA', 'GLOBAL', 'MODO_ADMIN'\]/);
    assert.match(RESOLVER_JS, /obterContexto/);
    assert.match(RESOLVER_JS, /podeAlterar/);
  });
});
