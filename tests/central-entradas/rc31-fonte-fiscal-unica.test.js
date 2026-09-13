/**
 * RC3.1 — Unificação da configuração fiscal (fonte única).
 *
 * Garante: fiscal_ambiente (getFiscalConfig) → Central → DF-e → mesma origem.
 * Sem HTTP real / sem SEFAZ / sem alterar Plataforma Fiscal ou emissão.
 *
 * Executar: npm run test:central-entradas-rc31
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const CentralConfiguracaoService = require('../../backend/motores/central-entradas/services/CentralConfiguracaoService');
const CentralConfiguracaoRepository = require('../../backend/motores/central-entradas/repositories/CentralConfiguracaoRepository');
const { fromAmbienteCode, EnvironmentType } = require('../../backend/services/fiscal/core/EnvironmentType');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

function criarRepoMemoria(seed = {}) {
  const store = new Map();
  for (const [chave, valor, tipo] of CentralConfiguracaoRepository.DEFAULTS) {
    store.set(chave, {
      chave,
      valor: seed[chave] != null ? String(seed[chave]) : valor,
      tipo,
      updatedAt: '2026-01-01T00:00:00.000Z'
    });
  }
  for (const [chave, valor] of Object.entries(seed)) {
    if (!store.has(chave)) {
      store.set(chave, { chave, valor: String(valor), tipo: 'string', updatedAt: '2026-01-01T00:00:00.000Z' });
    }
  }
  const syncDefaults = {
    sync_automatica_habilitada: 'true',
    sync_intervalo_minutos: '30',
    sync_ao_abrir: 'true',
    sync_max_documentos: '50',
    horario_permitido_inicio: '00:00',
    horario_permitido_fim: '23:59',
    horario_bloqueado_inicio: '',
    horario_bloqueado_fim: '',
    notificar_novas_notas: 'true'
  };
  for (const [chave, valor] of Object.entries(syncDefaults)) {
    if (!store.has(chave)) {
      store.set(chave, { chave, valor, tipo: 'string', updatedAt: '2026-01-01T00:00:00.000Z' });
    }
  }
  return {
    ensureDefaults: async () => {},
    listarTodas: async () => [...store.values()],
    salvar: async (chave, valor, tipo) => {
      let v = valor;
      if (tipo === 'boolean') v = valor ? 'true' : 'false';
      else if (tipo === 'number') v = String(valor);
      else v = String(valor ?? '');
      store.set(chave, { chave, valor: v, tipo, updatedAt: new Date().toISOString() });
    },
    parseValor: (reg) => {
      if (!reg) return null;
      if (reg.tipo === 'boolean') return reg.valor === 'true' || reg.valor === true;
      if (reg.tipo === 'number') return Number(reg.valor);
      return reg.valor;
    },
    _store: store
  };
}

function criarSyncConfigFake() {
  return {
    obterResumo: async () => ({
      syncAutomaticaHabilitada: true,
      syncIntervaloMinutos: 30,
      syncAoAbrir: true,
      syncMaxDocumentos: 50,
      horarioPermitidoInicio: '00:00',
      horarioPermitidoFim: '23:59',
      horarioBloqueadoInicio: null,
      horarioBloqueadoFim: null,
      notificarNovasNotas: true
    }),
    atualizar: async () => ({}),
    hidratarFlags: async () => {},
    obterIntervaloMs: () => 30 * 60 * 1000,
    verificarHorarioPermitido: () => ({ permitido: true })
  };
}

function criarFiscalState(inicial = {}) {
  const state = {
    ambiente: 2,
    uf: 'CE',
    codigoUf: '23',
    cnpj: '12345678000199',
    certificadoPath: null,
    certificadoSenha: null,
    ...inicial
  };
  return {
    get: async () => ({ ...state }),
    setAmbiente(code) {
      state.ambiente = Number(code) === 1 ? 1 : 2;
    },
    setUf(uf, codigoUf) {
      state.uf = uf;
      state.codigoUf = codigoUf;
    },
    state
  };
}

async function main() {
  console.log('\n=== Testes RC3.1 — Fonte fiscal única ===\n');

  await test('defaults não semeiam central_ambiente / central_uf', async () => {
    const chaves = CentralConfiguracaoRepository.DEFAULTS.map((d) => d[0]);
    assert.ok(!chaves.includes('central_ambiente'));
    assert.ok(!chaves.includes('central_uf'));
    assert.ok(!chaves.includes('central_codigo_uf'));
  });

  await test('painel reflete alteração de getFiscalConfig (Produção)', async () => {
    const fiscal = criarFiscalState({ ambiente: 2 });
    const repo = criarRepoMemoria({ central_ambiente: '2' });
    const svc = new CentralConfiguracaoService({
      configuracaoRepository: repo,
      syncConfigService: criarSyncConfigFake(),
      getFiscalConfig: () => fiscal.get()
    });

    let painel = await svc.obterPainelCompleto();
    assert.strictEqual(painel.ambiente.codigo, 2);

    fiscal.setAmbiente(1);
    painel = await svc.obterPainelCompleto();
    assert.strictEqual(painel.ambiente.codigo, 1);
    assert.strictEqual(painel.ambiente.label, 'Produção');
    assert.strictEqual(painel.ambiente.somenteLeitura, true);
    assert.strictEqual(painel.unificacaoFiscal, 'RC3.1');
  });

  await test('contexto operacional acompanha getFiscalConfig e ignora legado Central', async () => {
    const tmp = path.join(__dirname, '_tmp_rc31_cert.pfx');
    fs.writeFileSync(tmp, 'fake');
    const fiscal = criarFiscalState({
      ambiente: 1,
      certificadoPath: tmp,
      certificadoSenha: 'x',
      uf: 'SP',
      codigoUf: '35'
    });
    const repo = criarRepoMemoria({
      central_ambiente: '2',
      central_uf: 'SVRS',
      central_codigo_uf: '23'
    });
    const svc = new CentralConfiguracaoService({
      configuracaoRepository: repo,
      syncConfigService: criarSyncConfigFake(),
      getFiscalConfig: () => fiscal.get()
    });

    const ctx = await svc.obterContextoOperacional();
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }

    assert.strictEqual(ctx.ok, true);
    assert.strictEqual(ctx.contexto.ambiente, 1);
    assert.strictEqual(ctx.contexto.uf, 'SP');
    assert.strictEqual(ctx.contexto.codigoUf, '35');
    assert.strictEqual(ctx.contexto.origemAmbiente, 'getFiscalConfig');
    assert.ok(ctx.contexto.urls.distribuicaoDfe.includes('www1.nfe.fazenda.gov.br'));
  });

  await test('cadeia mesma origem: fiscal → Central → EnvironmentType (plataforma)', async () => {
    const tmp = path.join(__dirname, '_tmp_rc31_cadeia.pfx');
    fs.writeFileSync(tmp, 'fake');
    const fiscal = criarFiscalState({
      ambiente: 1,
      certificadoPath: tmp,
      certificadoSenha: 'x'
    });
    const svc = new CentralConfiguracaoService({
      configuracaoRepository: criarRepoMemoria(),
      syncConfigService: criarSyncConfigFake(),
      getFiscalConfig: () => fiscal.get()
    });

    const fiscalCfg = await fiscal.get();
    const painel = await svc.obterPainelCompleto();
    const ctx = await svc.obterContextoOperacional();
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }

    assert.strictEqual(fiscalCfg.ambiente, painel.ambiente.codigo);
    assert.strictEqual(fiscalCfg.ambiente, ctx.contexto.ambiente);
    assert.strictEqual(fromAmbienteCode(ctx.contexto.ambiente), EnvironmentType.PRODUCAO);

    fiscal.setAmbiente(2);
    const painel2 = await svc.obterPainelCompleto();
    assert.strictEqual(painel2.ambiente.codigo, 2);
    assert.strictEqual(fromAmbienteCode(painel2.ambiente.codigo), EnvironmentType.HOMOLOGACAO);
  });

  await test('PUT Central não grava ambiente/UF mesmo se payload trazer', async () => {
    const fiscal = criarFiscalState({ ambiente: 2, uf: 'CE', codigoUf: '23' });
    const repo = criarRepoMemoria();
    const svc = new CentralConfiguracaoService({
      configuracaoRepository: repo,
      syncConfigService: criarSyncConfigFake(),
      getFiscalConfig: () => fiscal.get()
    });

    await svc.atualizar({
      ambiente: { codigo: 1, uf: 'RJ', codigoUf: '33' },
      sefaz: { timeoutMs: 45000 }
    });

    assert.ok(!repo._store.has('central_ambiente'));
    assert.ok(!repo._store.has('central_uf'));
    const painel = await svc.obterPainelCompleto();
    assert.strictEqual(painel.ambiente.codigo, 2);
    assert.strictEqual(painel.ambiente.uf, 'CE');
    assert.strictEqual(painel.sefaz.timeoutMs, 45000);
  });

  await test('restaurarPadrao não cria chaves fiscais legadas', async () => {
    const repo = criarRepoMemoria();
    const svc = new CentralConfiguracaoService({
      configuracaoRepository: repo,
      syncConfigService: criarSyncConfigFake(),
      getFiscalConfig: async () => ({ ambiente: 1, uf: 'CE', codigoUf: '23' })
    });
    await svc.restaurarPadrao({ incluirSync: true });
    assert.ok(!repo._store.has('central_ambiente'));
    assert.ok(!repo._store.has('central_uf'));
    const painel = await svc.obterPainelCompleto();
    assert.strictEqual(painel.ambiente.codigo, 1);
  });

  await test('UI Central não coleta radios de ambiente (RC3.1)', async () => {
    const js = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/central-entradas.js'),
      'utf8'
    );
    assert.ok(js.includes('somente leitura') || js.includes('Somente leitura'));
    assert.ok(js.includes('Configurações Avançadas'));
    assert.ok(js.includes('cfgAmbienteReadonly'));
    assert.ok(js.includes('btnCentralAbrirConfigFiscal') || js.includes('Abrir Configuração Fiscal'));
    assert.ok(!/name="cfgAmbiente"/.test(js));
    assert.ok(js.includes('ambiente/UF não são enviados') || js.includes('RC3.1'));
    const coletar = js.slice(js.indexOf('function coletarPayloadConfigCentral'), js.indexOf('function exibirResultadoCfg'));
    assert.ok(!coletar.includes('cfgAmbiente'));
    assert.ok(!/\bcodigo:\s*Number\(ambienteRadio/.test(coletar));
  });

  await test('distribuicaoDFe prioriza contextoCentral.ambiente (oficial via Central)', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fiscal/distribuicaoDFe.js'),
      'utf8'
    );
    assert.ok(src.includes('deps.contextoCentral'));
    assert.ok(src.includes('ctx.ambiente'));
    assert.ok(src.includes('getFiscalConfig'));
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
