/**
 * Testes — Configuração Enterprise RC4 da Central Inteligente
 * Sem HTTP real / sem SEFAZ.
 *
 * Executar: npm run test:central-entradas-rc4
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const CentralConfiguracaoService = require('../../backend/motores/central-entradas/services/CentralConfiguracaoService');
const CentralConfiguracaoRepository = require('../../backend/motores/central-entradas/repositories/CentralConfiguracaoRepository');
const CentralSincronizacaoService = require('../../backend/motores/central-entradas/services/CentralSincronizacaoService');
const { VERSAO_MODULO } = require('../../backend/motores/central-entradas/CentralEntradasOrchestrator');

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
      store.set(chave, {
        chave,
        valor: String(valor),
        tipo: 'string',
        updatedAt: '2026-01-01T00:00:00.000Z'
      });
    }
  }
  // sync keys mínimas
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

function criarSyncConfigFake(repo) {
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

async function main() {
  console.log('\n=== Testes RC4 — Configuração Enterprise ===\n');

  await test('versão do módulo é RC4', async () => {
    assert.strictEqual(VERSAO_MODULO, '1.0.0-rc4');
  });

  await test('existe CentralConfiguracaoService como ponto único', async () => {
    assert.strictEqual(typeof CentralConfiguracaoService, 'function');
    assert.ok(CentralConfiguracaoService.CHAVES.URL_DFE_PROD);
  });

  await test('repository defaults NÃO embutem URL SOAP DF-e nem central_ambiente (RC3.1)', async () => {
    const defaults = CentralConfiguracaoRepository.DEFAULTS;
    const chaves = defaults.map((d) => d[0]);
    assert.ok(chaves.includes('sefaz_url_dfe_producao'));
    assert.ok(chaves.includes('sefaz_url_dfe_homologacao'));
    assert.ok(!chaves.includes('central_ambiente'));
    assert.ok(!chaves.includes('central_uf'));
    assert.ok(!chaves.includes('central_codigo_uf'));
    assert.ok(CentralConfiguracaoRepository.CHAVES_FISCAIS_LEGADAS.includes('central_ambiente'));
    const prod = defaults.find((d) => d[0] === 'sefaz_url_dfe_producao')[1];
    const hom = defaults.find((d) => d[0] === 'sefaz_url_dfe_homologacao')[1];
    assert.strictEqual(prod, '');
    assert.strictEqual(hom, '');
  });

  await test('painel completo expõe 6 módulos enterprise', async () => {
    const repo = criarRepoMemoria();
    const svc = new CentralConfiguracaoService({
      configuracaoRepository: repo,
      syncConfigService: criarSyncConfigFake(repo),
      getFiscalConfig: async () => ({
        certificadoPath: null,
        certificadoSenha: null,
        cnpj: null,
        ambiente: 2,
        uf: 'CE',
        codigoUf: '23'
      })
    });
    const painel = await svc.obterPainelCompleto();
    assert.ok(painel.ambiente);
    assert.ok(painel.sefaz);
    assert.ok(painel.certificado);
    assert.ok(painel.sincronizacao);
    assert.ok(painel.diagnostico);
    assert.ok(painel.avancado);
    assert.strictEqual(painel.versaoConfiguracao, 'RC4');
    assert.strictEqual(painel.unificacaoFiscal, 'RC3.1');
    assert.strictEqual(painel.ambiente.codigo, 2);
    assert.strictEqual(painel.ambiente.somenteLeitura, true);
    assert.strictEqual(painel.ambiente.origem, 'getFiscalConfig');
    assert.ok(painel.sefaz.urlDistribuicaoDfeHomologacao.includes('hom1.nfe.fazenda.gov.br'));
    assert.strictEqual(painel.sefaz.origemEndpointDfe, 'UrlResolver');
    assert.strictEqual(painel.sefaz.endpointsEditaveis, false);
    assert.strictEqual(painel.sefaz.manifestacaoAtiva, false);
    assert.ok(painel.sefaz.urlManifestacaoProducao.includes('www.nfe.fazenda.gov.br'));
    assert.ok(painel.sefaz.urlManifestacaoProducao.includes('NFeRecepcaoEvento4'));
    assert.ok(painel.sefaz.urlManifestacaoHomologacao.includes('hom1.nfe.fazenda.gov.br'));
    assert.ok(painel.sefaz.urlManifestacaoHomologacao.includes('NFeRecepcaoEvento4'));
    assert.ok(!painel.sefaz.urlManifestacaoProducao.includes('svrs'));
    assert.strictEqual(painel.sefaz.origemEndpointManifestacao, 'UrlResolver');
    assert.strictEqual(painel.sefaz.endpointManifestacaoResolvido, true);
    assert.strictEqual(painel.sefaz.politicaManifestacao, 'MANUAL');
    assert.strictEqual(painel.sefaz.politicaManifestacaoLabel, 'Manual');
    assert.ok(painel.plataformaFiscal);
    assert.strictEqual(painel.plataformaFiscal.registry, true);
    assert.strictEqual(painel.plataformaFiscal.modo, 'Manual');
    assert.strictEqual(painel.avancado.proxyFuncional, false);
  });

  await test('contexto operacional falha amigável sem certificado', async () => {
    const repo = criarRepoMemoria();
    const svc = new CentralConfiguracaoService({
      configuracaoRepository: repo,
      syncConfigService: criarSyncConfigFake(repo),
      getFiscalConfig: async () => ({ cnpj: '12345678000199', ambiente: 2 })
    });
    const ctx = await svc.obterContextoOperacional();
    assert.strictEqual(ctx.ok, false);
    assert.strictEqual(ctx.codigoErro, 'CERTIFICADO');
    assert.ok(/Certificado/i.test(ctx.mensagem));
  });

  await test('contexto operacional usa getFiscalConfig e ignora KV legado central_ambiente', async () => {
    const tmp = path.join(__dirname, '_tmp_rc4_cert.pfx');
    fs.writeFileSync(tmp, 'fake');
    const repo = criarRepoMemoria({
      central_ambiente: '1',
      sefaz_url_dfe_producao: 'https://central.example/dfe-prod'
    });
    const svc = new CentralConfiguracaoService({
      configuracaoRepository: repo,
      syncConfigService: criarSyncConfigFake(repo),
      getFiscalConfig: async () => ({
        certificadoPath: tmp,
        certificadoSenha: 'x',
        cnpj: '12345678000199',
        ambiente: 2,
        codigoUf: '23',
        uf: 'CE'
      })
    });
    const ctx = await svc.obterContextoOperacional();
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    assert.strictEqual(ctx.ok, true);
    assert.ok(ctx.contexto.urls.distribuicaoDfe.includes('hom1.nfe.fazenda.gov.br'));
    assert.ok(ctx.contexto.urls.distribuicaoDfe.includes('NFeDistribuicaoDFe'));
    assert.strictEqual(ctx.contexto.urls.origemDistribuicaoDfe, 'UrlResolver');
    assert.notStrictEqual(ctx.contexto.urls.distribuicaoDfe, 'https://central.example/dfe-prod');
    assert.strictEqual(ctx.contexto.ambiente, 2);
    assert.strictEqual(ctx.contexto.origemAmbiente, 'getFiscalConfig');
    assert.strictEqual(ctx.contexto.uf, 'CE');
    assert.strictEqual(ctx.contexto.codigoUf, '23');
  });

  await test('atualizar persiste timeout e ignora ambiente/UF + URL SOAP DF-e', async () => {
    const repo = criarRepoMemoria();
    const svc = new CentralConfiguracaoService({
      configuracaoRepository: repo,
      syncConfigService: criarSyncConfigFake(repo),
      getFiscalConfig: async () => ({
        ambiente: 2,
        uf: 'CE',
        codigoUf: '23'
      })
    });
    await svc.atualizar({
      ambiente: { codigo: 1, uf: 'AN', codigoUf: '91' },
      sefaz: { timeoutMs: 120000, urlDistribuicaoDfeProducao: 'https://x.example/dfe' }
    });
    const painel = await svc.obterPainelCompleto();
    assert.strictEqual(painel.ambiente.codigo, 2);
    assert.strictEqual(painel.ambiente.uf, 'CE');
    assert.strictEqual(painel.ambiente.somenteLeitura, true);
    assert.strictEqual(painel.sefaz.timeoutMs, 120000);
    assert.ok(painel.sefaz.urlDistribuicaoDfeProducao.includes('www1.nfe.fazenda.gov.br'));
    assert.notStrictEqual(painel.sefaz.urlDistribuicaoDfeProducao, 'https://x.example/dfe');
    assert.strictEqual(repo._store.get('sefaz_url_dfe_producao')?.valor, '');
    assert.ok(!repo._store.has('central_ambiente') || repo._store.get('central_ambiente')?.valor === '2');
  });

  await test('sync retorna codigoErro amigável sem 502 semântico', async () => {
    const repo = criarRepoMemoria();
    const cfg = new CentralConfiguracaoService({
      configuracaoRepository: repo,
      syncConfigService: criarSyncConfigFake(repo),
      getFiscalConfig: async () => ({ cnpj: '12345678000199' })
    });
    const sync = new CentralSincronizacaoService({ configuracaoService: cfg });
    const resultado = await sync.sincronizar();
    assert.strictEqual(resultado.sucesso, false);
    assert.strictEqual(resultado.codigoErro, 'CERTIFICADO');
    assert.ok(resultado.mensagemAmigavel);
  });

  await test('statusHttpSync nunca mapeia para 502', async () => {
    // Espelha a função das rotas (contrato RC4)
    function statusHttpSync(resultado) {
      if (!resultado) return 200;
      if (resultado.sucesso || resultado.ignorado) return 200;
      if (resultado.codigoErro === 'CERTIFICADO' || resultado.codigoErro === 'CNPJ'
        || resultado.codigoErro === 'CONFIG_FISCAL' || resultado.codigoErro === 'URL_SEFAZ') {
        return 422;
      }
      if (resultado.codigoErro === 'SEFAZ') return 503;
      return 200;
    }
    const casos = [
      { sucesso: false, codigoErro: 'CERTIFICADO' },
      { sucesso: false, codigoErro: 'CNPJ' },
      { sucesso: false, codigoErro: 'URL_SEFAZ' },
      { sucesso: false, codigoErro: 'SEFAZ' },
      { sucesso: false, codigoErro: 'ERRO' },
      { sucesso: true },
      null
    ];
    for (const c of casos) {
      assert.notStrictEqual(statusHttpSync(c), 502);
    }
    assert.strictEqual(statusHttpSync({ codigoErro: 'CERTIFICADO', sucesso: false }), 422);
    assert.strictEqual(statusHttpSync({ codigoErro: 'SEFAZ', sucesso: false }), 503);
  });

  await test('Diagnóstico não importa getFiscalConfig diretamente', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/motores/central-entradas/services/CentralDiagnosticoService.js'),
      'utf8'
    );
    assert.ok(!/require\(['"].*configService['"]\)/.test(src));
    assert.ok(!/hom1\.nfe\.fazenda\.gov\.br/.test(src));
    assert.ok(!/require\(['"].*soapClient['"]\)/.test(src));
    assert.ok(!/from ['"].*soapClient['"]/.test(src));
    assert.ok(src.includes('distribuicaoDfeRuntime') || src.includes('enviarDistribuicaoDfe'));
    assert.ok(src.includes('CentralConfiguracaoService'));
  });

  await test('Sync background/execução usam CentralConfiguracaoService', async () => {
    const bg = fs.readFileSync(
      path.join(__dirname, '../../backend/motores/central-entradas/services/CentralSyncBackgroundService.js'),
      'utf8'
    );
    const ex = fs.readFileSync(
      path.join(__dirname, '../../backend/motores/central-entradas/services/CentralSyncExecucaoService.js'),
      'utf8'
    );
    assert.ok(bg.includes('CentralConfiguracaoService'));
    assert.ok(ex.includes('CentralConfiguracaoService'));
    assert.ok(!/new CentralConfigService\(/.test(bg));
    assert.ok(!/new CentralConfigService\(/.test(ex));
  });

  await test('SincronizacaoService não importa getFiscalConfig', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/motores/central-entradas/services/CentralSincronizacaoService.js'),
      'utf8'
    );
    assert.ok(!/\bgetFiscalConfig\b/.test(src));
    assert.ok(src.includes('CentralConfiguracaoService'));
  });

  await test('rotas enterprise /configuracao existem', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/rotas/central-entradas.js'),
      'utf8'
    );
    assert.ok(src.includes("router.get('/configuracao'"));
    assert.ok(src.includes("router.put('/configuracao'"));
    assert.ok(src.includes("router.post('/configuracao/testar-sefaz'"));
    assert.ok(src.includes("router.post('/configuracao/testar-certificado'"));
    assert.ok(src.includes("router.post('/configuracao/health'"));
    assert.ok(src.includes("router.post('/configuracao/limpar-cache'"));
    assert.ok(src.includes('statusHttpSync'));
    assert.ok(!/status\(502\)/.test(src));
  });

  await test('UI enterprise e CSS presentes', async () => {
    assert.ok(fs.existsSync(path.join(__dirname, '../../frontend/css/central-configuracao.css')));
    const js = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/central-entradas.js'),
      'utf8'
    );
    assert.ok(js.includes("centralEntradasFetch('/configuracao')") || js.includes('/configuracao'));
    assert.ok(js.includes('central-cfg'));
    assert.ok(/Ambiente|SEFAZ|Certificado|Sincroniza|Diagnóstico|Avançado/i.test(js));
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  if (falhou > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
