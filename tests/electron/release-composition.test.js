'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const minimatchModule = require('minimatch');
const minimatch = minimatchModule.minimatch || minimatchModule;

const ROOT = path.join(__dirname, '../..');
const integrity = require('../../electron-integrity');
const { resolverModulo } = require('../../build/electron/gerar-manifest');
const composicoesCache = new Map();
const manifestosCache = new Map();

function lerJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function listarArquivosFonte() {
  const arquivos = [];
  const ignorarDiretorios = new Set(['node_modules', '.git', '.github']);

  function visitar(dir) {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const absoluto = path.join(dir, entrada.name);
      const relativo = path.relative(ROOT, absoluto).split(path.sep).join('/');
      if (entrada.isDirectory()) {
        if (ignorarDiretorios.has(entrada.name)) continue;
        if (/^(?:dist|dist-.+|release|out)$/.test(relativo)) continue;
        visitar(absoluto);
      } else if (entrada.isFile()) {
        arquivos.push(relativo);
      }
    }
  }

  visitar(ROOT);
  return arquivos.sort();
}

function listarComposicao(modulo) {
  if (composicoesCache.has(modulo)) return composicoesCache.get(modulo);
  const pkg = lerJson('package.json');
  const config = modulo === 'root'
    ? pkg.build
    : modulo === 'erp'
      ? lerJson('electron-builder-erp.json')
      : lerJson('electron-builder-pdv.json');
  const patterns = config.files;
  const arquivos = listarArquivosFonte();

  const composicao = arquivos.filter((arquivo) => {
    let incluido = false;
    for (const pattern of patterns) {
      const negado = pattern.startsWith('!');
      const glob = negado ? pattern.slice(1) : pattern;
      if (minimatch(arquivo, glob, { dot: true })) incluido = !negado;
    }
    return incluido;
  });
  composicoesCache.set(modulo, composicao);
  return composicao;
}

function manifestoMemoria(modulo) {
  if (!manifestosCache.has(modulo)) {
    manifestosCache.set(modulo, integrity.gerarManifesto(ROOT, {
      modulo,
      build: 'composition-audit',
      commit: 'composition-audit',
      branch: 'composition-audit'
    }));
  }
  return manifestosCache.get(modulo);
}

describe('Composição estática do release ERP/PDV', () => {
  it('main e configuração Builder identificam cada módulo sem fallback cruzado', () => {
    const pkg = lerJson('package.json');
    const erp = lerJson('electron-builder-erp.json');
    const pdv = lerJson('electron-builder-pdv.json');

    assert.equal(pkg.main, 'electron.js');
    assert.match(pkg.scripts.build, /manifest:electron:erp && electron-builder/);
    assert.equal(pkg.build.appId, 'com.cdssistemas.erp');
    assert.equal(pkg.build.productName, 'CDS ERP');
    assert.equal(pkg.build.directories.output, 'dist/erp');
    assert.equal(pkg.build.extraMetadata.main, 'electron-erp.js');
    assert.ok(pkg.build.afterPack);
    assert.equal(erp.extraMetadata.main, 'electron-erp.js');
    assert.equal(pdv.extraMetadata.main, 'electron-pdv.js');
    assert.match(pkg.scripts['build:erp:raw'], /manifest:electron:erp && electron-builder --config electron-builder-erp\.json/);
    assert.match(pkg.scripts['build:pdv'], /manifest:electron:pdv && electron-builder --config electron-builder-pdv\.json/);
    assert.match(pkg.scripts['build:all'], /npm run build:erp && npm run build:pdv/);
    assert.ok(erp.asarUnpack.includes('**/resources/tef/destaxa/**'));
    assert.ok(pdv.asarUnpack.includes('**/resources/tef/destaxa/**'));
    assert.ok(erp.asarUnpack.includes('**/node_modules/sqlite3/**'));
    assert.ok(pdv.asarUnpack.includes('**/node_modules/usb/**'));
    assert.throws(() => resolverModulo([]), /Informe --modulo=erp ou --modulo=pdv/);
    assert.equal(resolverModulo(['--modulo=PDV']), 'pdv');
    assert.throws(() => resolverModulo(['--modulo=outro']), /Módulo inválido/);
  });

  it('runtime e afterPack exigem o módulo correspondente sem desativar integridade', () => {
    const diagnostico = fs.readFileSync(path.join(ROOT, 'electron-diagnostico.js'), 'utf8');
    const common = fs.readFileSync(path.join(ROOT, 'electron-common.js'), 'utf8');
    const afterPack = fs.readFileSync(path.join(ROOT, 'build/electron/afterPack.js'), 'utf8');

    assert.match(diagnostico, /modulo: extra\.modulo/);
    assert.match(common, /garantirIntegridadeOuAbortar\(\{ modulo: appModuloAtual \}\)/);
    assert.match(afterPack, /manifesto\.modulo !== modulo/);
    assert.match(afterPack, /compararRepoComAsar\(root, asarPath, \{ manifesto, modulo \}\)/);
  });

  it('primeiro lançamento cria o banco de dados e o administrador sob DB_DIR', () => {
    const electron = fs.readFileSync(path.join(ROOT, 'electron-common.js'), 'utf8');
    const database = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');

    assert.match(electron, /process\.env\.DB_DIR = process\.env\.DB_DIR \|\| path\.join/);
    assert.ok(database.includes("process.env.PROGRAMDATA || 'C:\\\\ProgramData'"));
    assert.match(database, /if \(!fs\.existsSync\(DB_DIR\)\)\s*\{\s*fs\.mkdirSync\(DB_DIR, \{ recursive: true \}\)/);
    assert.match(database, /new sqlite3\.Database\(DB_PATH/);
    assert.match(database, /function inicializarBanco\(\)[\s\S]*criarTabelas\(\)[\s\S]*inserirConfiguracoesPadrao\(\)[\s\S]*criarUsuarioAdminPadrao\(\)/);
    assert.match(database, /const senhaInicial = '1234'/);
  });

  it('manifestos em memória e seleção Builder correspondem por módulo', () => {
    for (const alvo of ['erp', 'pdv', 'root']) {
      const modulo = alvo === 'root' ? 'erp' : alvo;
      const manifesto = manifestoMemoria(modulo);
      const pacote = listarComposicao(alvo).filter((arquivo) => arquivo !== 'electron-manifest.json');
      const manifestado = Object.keys(manifesto.arquivos).sort();

      assert.equal(manifesto.modulo, modulo);
      assert.deepEqual(integrity.validarEstruturaManifesto(manifesto), []);
      assert.deepEqual(manifestado, pacote.sort(), `${alvo} não corresponde ao manifesto ${modulo}`);
    }
  });

  it('manifesto sem módulo explícito não é aceito como ERP por default', () => {
    const manifesto = { ...manifestoMemoria('pdv') };
    delete manifesto.modulo;
    assert.ok(integrity.validarEstruturaManifesto(manifesto).some((erro) => /modulo/i.test(erro)));
  });

  it('dados, logs históricos, temporários, diagnósticos, testes e relatórios não entram', () => {
    const proibidos = [
      'backend/banco/mercadao.db',
      'backend/banco/mercadao.db-shm',
      'backend/banco/mercadao.db-wal',
      'backend/banco/mercadao.db-journal',
      'backend/storage/config-servidor.json',
      'storage/config-servidor.json',
      'logs/nfe/xml-enviado/diagnostico.log',
      'backend/services/fiscal/debug/01-xml-nfe-original.xml',
      'backend/schemas/nfe_v4.00/temp-nfe/.gitignore',
      'backups/backup-antigo.db',
      'tmp/danfe-v2/artefato.tmp',
      'tests/tef/fixtures/tef-06c-persistencia-worker.js',
      'backend/teste_usuarios.js',
      'config/configuracoes.json',
      'docs/build/release-certification-report.json',
      'diagnostico-venda.js',
      'tmp-sprint10-delete-auditoria.js',
      'CDS ATUALIZADO.zip',
      'Logo.jpeg',
      'assets/.gitkeep',
      'electron-build-manifest.json',
      'electron.js'
    ];

    for (const modulo of ['erp', 'pdv']) {
      const arquivos = new Set(listarComposicao(modulo));
      proibidos.forEach((arquivo) => assert.equal(arquivos.has(arquivo), false, `${modulo}: ${arquivo}`));
    }
  });

  it('mantém serviços críticos, ERP acessível do PDV e recursos nativos', () => {
    const criticos = [
      'backend/services/distribuidorEstoqueVenda.js',
      'backend/services/estoque/EstoqueDisponivelService.js',
      'backend/services/vendas/VendaPagamentoService.js',
      'frontend/shared/js/core.js',
      'frontend/shared/js/pdvBuscaProduto.js',
      'frontend/shared/js/modoFiscalHelpers.js',
      'frontend/pdv/index.html',
      'frontend/erp/index.html',
      'backend/services/F12PolicyService.js',
      'backend/motores/produto-identidade/services/PdvProdutoIdentificacaoService.js',
      'backend/services/estoque/empresaPermiteVendaSemEstoqueConfig.js',
      'backend/services/estoque/vendaSemEstoqueElegibilidade.js',
      'backend/services/categorias/categoriaPadroes.js',
      'backend/services/categorias/normalizacaoProdutosCategoriaEspecial.js',
      'backend/rotas/caixa.js',
      'backend/services/caixa/FechamentoCaixaCupomService.js',
      'electron-janelas-modulo.js',
      'backend/services/tef/TefManager.js',
      'backend/services/tef/destaxa/DestaxaHostBridge.js',
      'backend/services/tef/destaxa/DestaxaNativeHost.js',
      'backend/services/fiscal/nfeXmlAuditoria.js',
      'resources/tef/destaxa/win-x64/libdll-integracao-tef.dll',
      'resources/tef/destaxa/win-ia32/libdll-integracao-tef.dll',
      'backend/certificados/ICP-Brasilv5-correto.pem',
      'backend/certificados/ICP-Brasilv5.crt'
    ];

    for (const modulo of ['erp', 'pdv']) {
      const arquivos = new Set(listarComposicao(modulo));
      criticos.forEach((arquivo) => assert.equal(arquivos.has(arquivo), true, `${modulo}: ${arquivo}`));
    }

    const erp = new Set(listarComposicao('erp'));
    const pdv = new Set(listarComposicao('pdv'));
    assert.equal(erp.has('electron-erp.js'), true);
    assert.equal(erp.has('electron-pdv.js'), false);
    assert.equal(pdv.has('electron-pdv.js'), true);
    assert.equal(pdv.has('electron-erp.js'), false);
    assert.equal(pdv.has('frontend/erp/index.html'), true);
  });

  it('direciona logs XML/trace runtime ao diretório fiscal persistente', () => {
    const anterior = process.env.FISCAL_DIR;
    const fiscalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-release-composition-'));
    try {
      process.env.FISCAL_DIR = fiscalDir;
      const trace = require('../../backend/services/fiscal/nfeTrace').caminhosTrace();
      assert.equal(trace.projetoLog, null);
      assert.ok(trace.fiscalLog.startsWith(fiscalDir));

      const auditoria = fs.readFileSync(
        path.join(ROOT, 'backend/services/fiscal/nfeXmlAuditoria.js'),
        'utf8'
      );
      assert.match(auditoria, /getFiscalSubDir\('xml-enviado'\)/);
      assert.doesNotMatch(auditoria, /logs[\\/]nfe[\\/]xml-enviado/);
    } finally {
      if (anterior === undefined) delete process.env.FISCAL_DIR;
      else process.env.FISCAL_DIR = anterior;
      fs.rmSync(fiscalDir, { recursive: true, force: true });
    }
  });
});