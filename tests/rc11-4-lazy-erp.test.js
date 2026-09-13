'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'frontend', 'erp', 'index.html');
const appPath = path.join(root, 'frontend', 'erp', 'js', 'app.js');
const indexHtml = fs.readFileSync(indexPath, 'utf8');
const appSource = fs.readFileSync(appPath, 'utf8');

function arquivoDaUrl(url) {
  return path.join(root, 'frontend', ...url.replace(/^\//, '').split('/'));
}

function mediana(valores) {
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.floor(ordenados.length / 2)];
}

function medirCompilacao(urls, repeticoes = 7) {
  const fontes = urls.map((url) => ({
    url,
    source: fs.readFileSync(arquivoDaUrl(url), 'utf8')
  }));
  const medicoes = [];
  for (let i = 0; i < repeticoes; i += 1) {
    const inicio = performance.now();
    fontes.forEach(({ url, source }) => new vm.Script(source, { filename: url }));
    medicoes.push(performance.now() - inicio);
  }
  return {
    coldMs: Number(medicoes[0].toFixed(2)),
    medianMs: Number(mediana(medicoes).toFixed(2))
  };
}

function criarContextoLoader() {
  const appended = [];
  const document = {
    body: { classList: { remove() {} } },
    createElement() {
      return {
        dataset: {},
        remove() {}
      };
    },
    head: {
      appendChild(script) {
        appended.push(script.src);
        setImmediate(() => script.onload());
      }
    }
  };

  function jqueryMock() {
    return {
      ready() {},
      html() { return this; },
      modal() { return this; },
      find() { return { first() { return { text() { return ''; } }; } }; },
      length: 0,
      on() { return this; },
      append() { return this; },
      removeClass() { return this; },
      addClass() { return this; }
    };
  }

  const context = {
    console: { info() {}, error() {} },
    document,
    performance,
    setImmediate,
    $: jqueryMock,
    currentPage: 'dashboard',
    paginaPermitidaPorImplantacao: () => true,
    usuarioTemPermissao: () => true,
    showNotification() {},
    inicializarShellModulo() {}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(appSource, context, { filename: appPath });
  return { context, appended };
}

async function main() {
  console.log('\n=== RC11.4 — ERP Lazy Loader ===\n');

  const lazyRefs = [...indexHtml.matchAll(
    /<script\s+type="application\/cds-lazy"\s+src="([^"]+)"/g
  )].map((match) => match[1]);

  assert.strictEqual(lazyRefs.length, 46);
  assert.strictEqual(new Set(lazyRefs).size, 46);
  lazyRefs.forEach((url) => {
    assert.ok(fs.existsSync(arquivoDaUrl(url)), `arquivo lazy ausente: ${url}`);
  });
  console.log('  OK  46 scripts opcionais marcados sem execução no boot');

  const { context, appended } = criarContextoLoader();
  const loader = context.CdsErpLazyLoader;
  assert.ok(loader);

  const manifestRefs = new Set(Object.values(loader.manifest).flat());
  lazyRefs.forEach((url) => assert.ok(manifestRefs.has(url), `fora do manifesto: ${url}`));
  manifestRefs.forEach((url) => assert.ok(lazyRefs.includes(url), `sem marcador build: ${url}`));
  console.log('  OK  manifesto lazy e referências do build têm cobertura integral');

  assert.deepStrictEqual(Array.from(loader.getLoadedScripts()), []);
  assert.strictEqual(appended.length, 0);
  console.log('  OK  cache e scripts carregados estão vazios no boot');

  await loader.loadPageScripts('dashboard');
  assert.deepStrictEqual(appended, [
    '/vendor/chart.js/chart.min.js',
    '/erp/js/dashboard-command.js',
    '/erp/js/dashboard.js'
  ]);
  assert.strictEqual(loader.getLoadedScripts().length, 3);
  console.log('  OK  primeira abertura carrega somente o pacote Dashboard');

  await loader.loadPageScripts('dashboard');
  assert.strictEqual(appended.length, 3);
  assert.strictEqual(loader.getPageStats('dashboard').reuses, 1);
  console.log('  OK  segunda abertura reutiliza scripts sem nova tag');

  assert.ok(!appended.includes('/erp/js/central-homologacao.js'));
  assert.ok(!appended.includes('/erp/js/configuracao_tef.js'));
  await loader.loadFeature('central-homologacao');
  await loader.loadFeature('configuracao-tef');
  await loader.loadFeature('configuracao-tef');
  assert.strictEqual(
    appended.filter((url) => url === '/erp/js/configuracao_tef.js').length,
    1
  );
  const centralSource = fs.readFileSync(
    path.join(root, 'frontend', 'erp', 'js', 'central-entradas.js'),
    'utf8'
  );
  const configuracoesSource = fs.readFileSync(
    path.join(root, 'frontend', 'erp', 'js', 'cds-centro-configuracoes.js'),
    'utf8'
  );
  assert.ok(centralSource.includes("loadFeature('central-homologacao')"));
  assert.ok(configuracoesSource.includes("loadFeature('configuracao-tef')"));
  console.log('  OK  Grupo C carrega somente no uso e também reutiliza cache');

  await Promise.all([
    loader.loadPageScripts('fiscal'),
    loader.loadPageScripts('nfe-central')
  ]);
  assert.strictEqual(
    appended.filter((url) => url === '/shared/js/fiscalImpressao.js').length,
    1
  );
  console.log('  OK  carregamento concorrente compartilha a mesma Promise por URL');

  const totalBytes = lazyRefs.reduce(
    (total, url) => total + fs.statSync(arquivoDaUrl(url)).size,
    0
  );
  const dashboardUrls = Array.from(loader.manifest.dashboard);
  const dashboardBytes = dashboardUrls.reduce(
    (total, url) => total + fs.statSync(arquivoDaUrl(url)).size,
    0
  );
  const compileAllMs = medirCompilacao(lazyRefs);
  const compileDashboardMs = medirCompilacao(dashboardUrls);

  const inicioReuse = performance.now();
  for (let i = 0; i < 1000; i += 1) {
    await loader.loadPageScripts('dashboard');
  }
  const reuseMedioMs = (performance.now() - inicioReuse) / 1000;

  console.log('\nMétricas sintéticas locais:');
  console.log(`  Scripts adiados: ${lazyRefs.length}`);
  console.log(`  Payload adiado: ${(totalBytes / 1024).toFixed(1)} KB`);
  console.log(`  Primeiro Dashboard: ${(dashboardBytes / 1024).toFixed(1)} KB`);
  console.log(`  Compilação eager cold evitada: ${compileAllMs.coldMs.toFixed(2)} ms`);
  console.log(`  Compilação eager mediana warm: ${compileAllMs.medianMs.toFixed(2)} ms`);
  console.log(`  Compilação Dashboard cold: ${compileDashboardMs.coldMs.toFixed(2)} ms`);
  console.log(`  Compilação Dashboard mediana warm: ${compileDashboardMs.medianMs.toFixed(2)} ms`);
  console.log(`  Reutilização média do pacote: ${reuseMedioMs.toFixed(4)} ms`);
  console.log('\nRC11.4 OK\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
