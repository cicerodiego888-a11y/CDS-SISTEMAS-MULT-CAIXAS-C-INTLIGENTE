'use strict';

/**
 * RC3.16.5 — Pipeline de build/validação Electron.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const asar = require('@electron/asar');

const root = path.join(__dirname, '..', '..');
const integrity = require(path.join(root, 'electron-integrity'));

async function test(name, fn) {
  try {
    await fn();
    console.log('OK', name);
  } catch (err) {
    console.error('FAIL', name);
    throw err;
  }
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function write(file, content) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, content);
}

function copiarParaFixture(destRoot, rels) {
  for (const rel of rels) {
    const src = path.join(root, ...rel.split('/'));
    const dest = path.join(destRoot, ...rel.split('/'));
    if (!fs.existsSync(src)) continue;
    mkdirp(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
}

function montarFixtureMinima(destRoot) {
  write(path.join(destRoot, 'package.json'), JSON.stringify({ version: '1.0.3' }));
  const base = new Set(integrity.ARQUIVOS_OBRIGATORIOS);
  fs.mkdirSync(path.join(destRoot, 'frontend', 'erp'), { recursive: true });
  fs.copyFileSync(
    path.join(root, 'frontend', 'erp', 'index.html'),
    path.join(destRoot, 'frontend', 'erp', 'index.html')
  );
  const refs = integrity.extrairReferenciasIndex(
    fs.readFileSync(path.join(destRoot, 'frontend', 'erp', 'index.html'), 'utf8')
  );
  refs.forEach((r) => base.add(r));
  [
    'electron-diagnostico.js',
    'electron-auditoria-rc3164.js',
    'electron-rede-cliente.js',
    'electron-rede-recuperacao.js',
    'electron-sessao-rede.js'
  ].forEach((r) => base.add(r));
  copiarParaFixture(destRoot, [...base]);
}

function limparDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (_) {
    /* ignore windows locks */
  }
}

async function main() {
  await test('artefatos do pipeline existem', () => {
    const required = [
      'electron-integrity.js',
      'electron-diagnostico.js',
      'build/electron/gerar-manifest.js',
      'build/electron/verificar-build.js',
      'build/electron/build-erp-oficial.js',
      'build/electron/afterPack.js',
      'electron-builder-erp.json',
      'preload.js',
      'electron-common.js'
    ];
    for (const rel of required) {
      assert.ok(fs.existsSync(path.join(root, ...rel.split('/'))), rel);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.scripts['verify-build'], 'node build/electron/verificar-build.js');
    assert.strictEqual(pkg.scripts['build:erp'], 'node build/electron/build-erp-oficial.js');
    assert.strictEqual(pkg.scripts['manifest:electron'], 'node build/electron/gerar-manifest.js');
    const builder = JSON.parse(fs.readFileSync(path.join(root, 'electron-builder-erp.json'), 'utf8'));
    assert.strictEqual(builder.afterPack, './build/electron/afterPack.js');
    const builderPdv = JSON.parse(fs.readFileSync(path.join(root, 'electron-builder-pdv.json'), 'utf8'));
    assert.strictEqual(builderPdv.afterPack, './build/electron/afterPack.js');
  });

  await test('arquivos obrigatórios + refs do index estão no disco', () => {
    for (const rel of integrity.ARQUIVOS_OBRIGATORIOS) {
      assert.ok(fs.existsSync(path.join(root, ...rel.split('/'))), rel);
    }
    const html = fs.readFileSync(path.join(root, 'frontend/erp/index.html'), 'utf8');
    const refs = integrity.extrairReferenciasIndex(html);
    assert.ok(refs.includes('frontend/erp/js/pedidos.js'));
    assert.ok(refs.includes('frontend/erp/js/nfe-central.js'));
    assert.ok(refs.includes('frontend/shared/js/core.js'));
    for (const rel of refs) {
      assert.ok(fs.existsSync(path.join(root, ...rel.split('/'))), `ref index: ${rel}`);
    }
  });

  await test('gerar manifesto válido com hash coerente', () => {
    const manifesto = integrity.gerarManifesto(root, {
      modulo: 'erp',
      build: '2026-07-24T00:00:00.000Z',
      commit: 'test'
    });
    assert.strictEqual(manifesto.versao, '1.0.3');
    assert.ok(manifesto.hash);
    assert.ok(manifesto.quantidadeArquivos > 50);
    assert.strictEqual(integrity.validarEstruturaManifesto(manifesto).length, 0);
    const camadas = integrity.calcularHashesPorCamada(manifesto.arquivos);
    assert.strictEqual(manifesto.hash, camadas.hashGlobal);
    assert.strictEqual(
      manifesto.hashArquivos,
      integrity.hashManifestoArquivos(manifesto.arquivos)
    );
    for (const rel of integrity.ARQUIVOS_OBRIGATORIOS) {
      assert.ok(manifesto.arquivos[rel], rel);
    }
  });

  await test('build com arquivo ausente: manifesto/fonte aborta', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc3165-miss-'));
    try {
      write(path.join(tmp, 'package.json'), JSON.stringify({ version: '1.0.3' }));
      write(path.join(tmp, 'frontend/erp/index.html'), '<script src="/erp/js/app.js"></script>');
      assert.throws(
        () => integrity.gerarManifesto(tmp, { modulo: 'erp' }),
        (err) => err && err.code === 'MANIFEST_SOURCE_MISSING'
      );
    } finally {
      limparDir(tmp);
    }
  });

  await test('build com JS desatualizado / hash divergente: comparação falha', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc3165-hash-'));
    const asarDir = path.join(tmp, 'pack');
    try {
      montarFixtureMinima(asarDir);
      const manifestoVelho = integrity.gerarManifesto(asarDir, { modulo: 'erp', commit: 't' });
      integrity.escreverManifesto(asarDir, manifestoVelho);
      const asarPath = path.join(tmp, 'app.asar');
      await asar.createPackage(asarDir, asarPath);
      assert.ok(fs.existsSync(asarPath), 'asar deve existir');

      fs.appendFileSync(path.join(asarDir, 'frontend/erp/js/pedidos.js'), '\n/* stale */\n');
      const manifestoNovo = integrity.gerarManifesto(asarDir, { modulo: 'erp', commit: 't2' });
      integrity.escreverManifesto(asarDir, manifestoNovo);

      const cmp = integrity.compararRepoComAsar(asarDir, asarPath, { manifesto: manifestoNovo });
      assert.strictEqual(cmp.ok, false);
      assert.ok(cmp.divergencias.length >= 1, JSON.stringify(cmp.erros));
    } finally {
      limparDir(tmp);
    }
  });

  await test('manifest inválido é detectado', () => {
    const erros = integrity.validarEstruturaManifesto({
      versao: '1.0.3',
      build: 'x',
      hash: '0'.repeat(64),
      arquivos: {
        'frontend/erp/index.html': 'abc'
      }
    });
    assert.ok(erros.length >= 1);
    assert.ok(erros.some((e) => /hash|obrigatório|ausente/i.test(e)));
  });

  await test('asar idêntico ao repo: comparação OK (fixture mínima)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc3165-ok-'));
    const pack = path.join(tmp, 'pack');
    try {
      montarFixtureMinima(pack);
      const manifesto = integrity.gerarManifesto(pack, { modulo: 'erp', commit: 'ok' });
      integrity.escreverManifesto(pack, manifesto);
      const asarPath = path.join(tmp, 'app.asar');
      await asar.createPackage(pack, asarPath);
      assert.ok(fs.existsSync(asarPath));
      const cmp = integrity.compararRepoComAsar(pack, asarPath, { manifesto });
      assert.strictEqual(cmp.ok, true, cmp.erros.join('\n'));
      assert.ok(cmp.quantidadeValidada > 10);
    } finally {
      limparDir(tmp);
    }
  });

  await test('electron-common e preload referenciam RC3.16.5', () => {
    const common = fs.readFileSync(path.join(root, 'electron-common.js'), 'utf8');
    assert.match(common, /garantirIntegridadeOuAbortar/);
    assert.match(common, /electron-diagnostico/);
    const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
    assert.match(preload, /obterDiagnosticoElectron/);
    assert.match(preload, /abrirDiagnosticoElectron/);
  });

  console.log('\nRC3.16.5 — testes OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
