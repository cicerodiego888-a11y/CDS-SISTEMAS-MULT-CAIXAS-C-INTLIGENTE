/**
 * Visibilidade do menu Fechamento Fiscal do Dia conforme F12 e configuração administrativa.
 * Executar: node --test tests/fiscal/fechamento-fiscal-dia-menu-desativado.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const core = read('frontend/shared/js/core.js');

function instalarFiltroMenu(contexto, item) {
  contexto.filtrarMenuPorPermissoes = () => {
    const permitido = contexto.fechamentoFiscalDiaMenuPermitido();
    item.hidden = !permitido;
    item.style.display = permitido ? '' : 'none';
  };
}

async function atualizarMenuComResposta(resposta, paginaAtual = 'dashboard', f12Ativo = true) {
  const item = { hidden: true, style: { display: 'none' } };
  const logs = [];
  const navegacoes = [];
  const contexto = vm.createContext({
    API_URL: '/api',
    document: {
      getElementById: (id) => (id === 'nav-fechamento-fiscal-dia' ? item : null),
      addEventListener() {}
    },
    implantacaoPermiteFiscal: () => true,
    currentPage: paginaAtual,
    loadPage: (pagina) => navegacoes.push(pagina),
    window: {
      __cdsFechamentoFiscalDiaOn: false,
      __cdsModoFiscalEstadoConfirmado: f12Ativo,
      addEventListener() {}
    },
    localStorage: { getItem: () => 'test-token' },
    fetch: async () => resposta,
    fechamentoFiscalDiaMenuAtualizacao: 0,
    console: {
      error: (...args) => logs.push(args),
      warn: (...args) => logs.push(args)
    }
  });
  instalarFiltroMenu(contexto, item);
  const inicio = core.indexOf('function fechamentoFiscalDiaMenuPermitido()');
  const fim = core.indexOf('\nfunction paginaEhModuloFiscal', inicio);
  assert.notEqual(inicio, -1);
  assert.notEqual(fim, -1);
  vm.runInContext(core.slice(inicio, fim), contexto);
  await contexto.atualizarVisibilidadeMenuFechamentoFiscalDia();
  return { item, logs, contexto, navegacoes };
}

describe('Fechamento Fiscal do Dia — visibilidade com F12 e configuração administrativa', () => {
  it('mantém o item inicialmente oculto no HTML até confirmar a configuração', () => {
    const html = read('frontend/erp/index.html');
    assert.match(
      html,
      /id="nav-fechamento-fiscal-dia"[\s\S]*hidden[\s\S]*data-page="fechamento-fiscal-dia"/
    );
  });

  it('mostra o menu quando a resposta oficial está ativada', async () => {
    const { item } = await atualizarMenuComResposta({
      ok: true,
      json: async () => ({ chave: 'fechamento_fiscal_do_dia', valor: 'ATIVADO', permitido: true })
    });
    assert.equal(item.hidden, false);
    assert.equal(item.style.display, '');
  });

  it('F12 OFF mostra o menu mesmo com a configuração administrativa desativada', async () => {
    const { item } = await atualizarMenuComResposta({
      ok: true,
      json: async () => ({ chave: 'fechamento_fiscal_do_dia', valor: 'DESATIVADO', permitido: false })
    }, 'dashboard', false);
    assert.equal(item.hidden, false);
    assert.equal(item.style.display, '');
  });

  it('F12 OFF sem contexto de caixa mostra o menu', async () => {
    const { item } = await atualizarMenuComResposta({
      ok: true,
      json: async () => ({ chave: 'fechamento_fiscal_do_dia', valor: 'DESATIVADO', permitido: false })
    }, 'dashboard', false);
    const inicio = core.indexOf('async function atualizarVisibilidadeMenuFechamentoFiscalDia()');
    const fim = core.indexOf('\nwindow.addEventListener', inicio);
    assert.doesNotMatch(core.slice(inicio, fim), /F12PolicyResolver|obterCaixaAtual/);
    assert.equal(item.hidden, false);
    assert.equal(item.style.display, '');
  });

  it('F12 ON mantém a configuração administrativa como condição do menu', async () => {
    const { item } = await atualizarMenuComResposta({
      ok: true,
      json: async () => ({ valor: 'DESATIVADO', permitido: false })
    }, 'dashboard', true);
    assert.equal(item.hidden, true);
    assert.equal(item.style.display, 'none');
  });

  it('retorna ao dashboard se o módulo atual for desativado', async () => {
    const { navegacoes } = await atualizarMenuComResposta({
      ok: true,
      json: async () => ({ valor: 'DESATIVADO', permitido: false })
    }, 'fechamento-fiscal-dia');
    assert.deepEqual(navegacoes, ['dashboard']);
  });

  it('não aceita resposta vazia ou malformada como estado confirmado', async () => {
    const respostas = [
      { json: async () => null },
      { json: async () => ({}) },
      { json: async () => ({ valor: 'ON' }) },
      { json: async () => ({ permitido: 'true' }) },
      { json: async () => { throw new SyntaxError('Invalid JSON'); } }
    ];
    for (const resposta of respostas) {
      const { item, logs } = await atualizarMenuComResposta({
        ok: true,
        json: resposta.json
      }, 'dashboard', false);
      assert.equal(item.hidden, false);
      assert.equal(item.style.display, '');
      assert.match(logs[0][0], /Não foi possível confirmar a configuração administrativa/);
    }
  });

  it('falha HTTP com F12 OFF mantém o menu visível e registra o status', async () => {
    const { item, logs } = await atualizarMenuComResposta({ ok: false, status: 503 }, 'dashboard', false);
    assert.equal(item.hidden, false);
    assert.equal(item.style.display, '');
    assert.match(logs[0][1].message, /HTTP 503/);
  });

  it('falha de rede com F12 OFF mantém o menu visível e registra diagnóstico', async () => {
    const item = { hidden: true, style: { display: 'none' } };
    const logs = [];
    const contexto = vm.createContext({
      API_URL: '/api',
      document: { getElementById: () => item, addEventListener() {} },
      implantacaoPermiteFiscal: () => true,
      currentPage: 'dashboard',
      window: {
        __cdsFechamentoFiscalDiaOn: false,
        __cdsModoFiscalEstadoConfirmado: false,
        addEventListener() {}
      },
      localStorage: { getItem: () => 'test-token' },
      fetch: async () => { throw new Error('request timed out'); },
      fechamentoFiscalDiaMenuAtualizacao: 0,
      console: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) }
    });
    instalarFiltroMenu(contexto, item);
    const inicio = core.indexOf('function fechamentoFiscalDiaMenuPermitido()');
    const fim = core.indexOf('\nfunction paginaEhModuloFiscal', inicio);
    vm.runInContext(core.slice(inicio, fim), contexto);
    await contexto.atualizarVisibilidadeMenuFechamentoFiscalDia();
    assert.equal(item.hidden, false);
    assert.equal(item.style.display, '');
    assert.match(logs[0][1].message, /request timed out/);
  });

  it('falha de rede com F12 ON mantém o menu oculto', async () => {
    const { item } = await atualizarMenuComResposta({
      ok: false,
      status: 503
    }, 'dashboard', true);
    assert.equal(item.hidden, true);
    assert.equal(item.style.display, 'none');
  });

  it('ignora respostas antigas que chegam depois de uma configuração mais recente', async () => {
    const respostas = [];
    const item = { hidden: true, style: { display: 'none' } };
    const contexto = vm.createContext({
      API_URL: '/api',
      document: { getElementById: () => item, addEventListener() {} },
      implantacaoPermiteFiscal: () => true,
      currentPage: 'dashboard',
      window: {
        __cdsFechamentoFiscalDiaOn: false,
        __cdsModoFiscalEstadoConfirmado: true,
        addEventListener() {}
      },
      localStorage: { getItem: () => 'test-token' },
      fetch: () => new Promise((resolve) => respostas.push(resolve)),
      fechamentoFiscalDiaMenuAtualizacao: 0,
      console
    });
    instalarFiltroMenu(contexto, item);
    const inicio = core.indexOf('function fechamentoFiscalDiaMenuPermitido()');
    const fim = core.indexOf('\nfunction paginaEhModuloFiscal', inicio);
    vm.runInContext(core.slice(inicio, fim), contexto);

    const antiga = contexto.atualizarVisibilidadeMenuFechamentoFiscalDia();
    const recente = contexto.atualizarVisibilidadeMenuFechamentoFiscalDia();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(respostas.length, 2);
    respostas[1]({ ok: true, json: async () => ({ valor: 'DESATIVADO', permitido: false }) });
    await recente;
    respostas[0]({ ok: true, json: async () => ({ valor: 'ATIVADO', permitido: true }) });
    await antiga;
    assert.equal(item.hidden, true);
    assert.equal(item.style.display, 'none');
  });

  it('atualiza após salvar a configuração do módulo, sem depender da política F12', () => {
    const config = read('frontend/erp/js/cds-centro-configuracoes.js');
    assert.match(core, /addEventListener\('cds:fechamento-fiscal-dia-config-alterada', atualizarVisibilidadeMenuFechamentoFiscalDia\)/);
    assert.match(config, /dispatchEvent\(new Event\('cds:fechamento-fiscal-dia-config-alterada'\)\)/);
    const inicio = core.indexOf('async function atualizarVisibilidadeMenuFechamentoFiscalDia()');
    const fim = core.indexOf('\nwindow.addEventListener', inicio);
    assert.doesNotMatch(core.slice(inicio, fim), /F12PolicyResolver|cds:f12-policy-alterada/);
  });

  it('atualiza os filtros do menu quando o modo F12 muda', () => {
    assert.match(core, /document\.addEventListener\('cds:modo-fiscal-alterado'/);
    assert.match(core, /window\.__cdsModoFiscalEstadoConfirmado = normalizado === '1'/);
    assert.match(core, /window\.__cdsModoFiscalEstadoConfirmado = novoValor === '1'/);
  });

  it('configuração administrativa OFF ainda bloqueia os endpoints do módulo', () => {
    const rota = read('backend/rotas/fechamento-fiscal.js');
    const service = read('backend/services/fechamento-fiscal/FechamentoFiscalService.js');
    assert.match(rota, /async function exigirModuloOn[\s\S]*?estaAtivadaAsync\(db\)[\s\S]*?res\.status\(403\)[\s\S]*?router\.use\(exigirModuloOn\)/);
    assert.match(service, /async function assertModuloAtivo[\s\S]*?estaAtivadaAsync\(db\)[\s\S]*?err\.statusCode = 403/);
  });

  it('shell carrega a configuração depois da implantação e a consulta usa o endpoint oficial', () => {
    const shellInicio = core.indexOf('function inicializarShellModulo(options = {})');
    const shellFim = core.indexOf('\nwindow.produtoUsaConversaoUnidades', shellInicio);
    const shell = core.slice(shellInicio, shellFim);
    assert.ok(shell.indexOf('await carregarConfiguracaoImplantacao()') < shell.indexOf('await atualizarVisibilidadeMenuFechamentoFiscalDia()'));
    assert.match(core, /\/configuracoes\/fechamento_fiscal_do_dia/);
    assert.match(core, /Authorization:/);
  });

  it('a regra da configuração também filtra a pesquisa e respeita permissões/implantação', () => {
    assert.match(core, /moduloFechamentoFiscalDia: true/);
    assert.match(core, /item\.moduloFechamentoFiscalDia && !fechamentoFiscalDiaMenuPermitido\(\)/);
    assert.match(core, /page === 'fechamento-fiscal-dia' && !fechamentoFiscalDiaMenuPermitido\(\)/);
    assert.match(core, /if \(page === 'fechamento-fiscal-dia'\) \{\s*\$item\.show\(\);\s*\$item\.removeAttr\('hidden'\);\s*return;/);
    assert.match(core, /if \(!paginaPermitidaPorImplantacao\(page\)\)/);
    assert.match(core, /if \(!usuarioTemPermissao\(page\)\)/);
  });

  it('não bloqueia a rota SPA por visibilidade e mantém o carregamento da tela', () => {
    const app = read('frontend/erp/js/app.js');
    assert.match(app, /case 'fechamento-fiscal-dia':[\s\S]*loadFechamentoFiscalDoDia/);
  });
});
