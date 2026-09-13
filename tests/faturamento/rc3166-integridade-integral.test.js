'use strict';

/**
 * RC3.16.6 — Validação integral Frontend + Backend + Electron.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const asar = require('@electron/asar');

const root = path.join(__dirname, '..', '..');
const integrity = require(path.join(root, 'electron-integrity'));

function limparDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (_) {
    /* ignore */
  }
}

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

function montarFixtureIntegral(destRoot) {
  const base = new Set(integrity.ARQUIVOS_OBRIGATORIOS);
  fs.mkdirSync(path.join(destRoot, 'frontend', 'erp'), { recursive: true });
  fs.copyFileSync(
    path.join(root, 'frontend', 'erp', 'index.html'),
    path.join(destRoot, 'frontend', 'erp', 'index.html')
  );
  integrity.extrairReferenciasIndex(
    fs.readFileSync(path.join(destRoot, 'frontend', 'erp', 'index.html'), 'utf8')
  ).forEach((r) => base.add(r));

  // amostra backend crítica
  [
    'backend/server.js',
    'backend/database.js',
    'backend/services/configuracaoService.js',
    'backend/rotas/auth.js',
    'backend/middleware/auth.js'
  ].forEach((r) => base.add(r));

  integrity.ARQUIVOS_ELECTRON.forEach((r) => base.add(r));
  copiarParaFixture(destRoot, [...base]);
}

async function main() {
  await test('manifesto v2 inclui hashes FE/BE/Electron', () => {
    const m = integrity.gerarManifesto(root, {
      modulo: 'erp',
      build: '2026-07-24T00:00:00.000Z',
      commit: 'test',
      branch: 'test-branch'
    });
    assert.strictEqual(m.schema, integrity.SCHEMA);
    assert.ok(m.hashFrontend);
    assert.ok(m.hashBackend);
    assert.ok(m.hashElectron);
    assert.ok(m.hash);
    assert.ok(m.quantidadeBackend > 10);
    assert.ok(m.quantidadeFrontend > 50);
    assert.ok(m.quantidadeElectron >= 5);
    assert.strictEqual(m.branch, 'test-branch');
    assert.ok(m.arquivos['backend/server.js']);
    assert.ok(m.arquivos['backend/database.js']);
    assert.strictEqual(integrity.validarEstruturaManifesto(m).length, 0);

    const camadas = integrity.calcularHashesPorCamada(m.arquivos);
    assert.strictEqual(m.hashFrontend, camadas.frontend.hash);
    assert.strictEqual(m.hashBackend, camadas.backend.hash);
    assert.strictEqual(m.hashElectron, camadas.electron.hash);
    assert.strictEqual(m.hash, camadas.hashGlobal);
  });

  await test('backend alterado muda hashBackend e hash global', () => {
    const a = integrity.gerarManifesto(root, { modulo: 'erp', commit: 'a', branch: 'b' });
    const fake = { ...a.arquivos };
    const chave = Object.keys(fake).find((k) => k.startsWith('backend/'));
    assert.ok(chave);
    fake[chave] = '0'.repeat(64);
    const camadas = integrity.calcularHashesPorCamada(fake);
    assert.notStrictEqual(camadas.backend.hash, a.hashBackend);
    assert.notStrictEqual(camadas.hashGlobal, a.hash);
    assert.strictEqual(camadas.frontend.hash, a.hashFrontend);
  });

  await test('frontend alterado muda hashFrontend', () => {
    const a = integrity.gerarManifesto(root, { modulo: 'erp', commit: 'a', branch: 'b' });
    const fake = { ...a.arquivos };
    const chave = Object.keys(fake).find((k) => k.startsWith('frontend/'));
    fake[chave] = '1'.repeat(64);
    const camadas = integrity.calcularHashesPorCamada(fake);
    assert.notStrictEqual(camadas.frontend.hash, a.hashFrontend);
    assert.strictEqual(camadas.backend.hash, a.hashBackend);
  });

  await test('arquivo removido aborta geração', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc3166-miss-'));
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

  await test('manifesto inválido / hash inválido detectados', () => {
    const base = integrity.gerarManifesto(root, { modulo: 'erp', commit: 'x', branch: 'y' });
    const quebrado = { ...base, hash: '0'.repeat(64) };
    const errosHash = integrity.validarEstruturaManifesto(quebrado);
    assert.ok(errosHash.some((e) => /hash global divergente/i.test(e)));

    const semCamada = { ...base, hashFrontend: undefined };
    // ainda tem schema v2 e hashBackend/Electron — força ausência
    delete semCamada.hashFrontend;
    const errosFe = integrity.validarEstruturaManifesto(semCamada);
    assert.ok(errosFe.some((e) => /hashFrontend/i.test(e)));
  });

  await test('package.json efetivo (extraMetadata ERP) difere do repositório', () => {
    const repoHash = integrity.sha256File(path.join(root, 'package.json'));
    const efetivoHash = integrity.hashPackageJsonEfetivo(root, 'erp');
    assert.notStrictEqual(repoHash, efetivoHash);

    const m = integrity.gerarManifesto(root, { modulo: 'erp', commit: 'pkg', branch: 'main' });
    assert.strictEqual(m.arquivos['package.json'], efetivoHash);
  });

  await test('asar idêntico (fixture): comparação OK com backend', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc3166-ok-'));
    const pack = path.join(tmp, 'pack');
    try {
      montarFixtureIntegral(pack);
      if (integrity.moduloUsaPackageJsonEfetivo('erp')) {
        write(
          path.join(pack, 'package.json'),
          integrity.serializarPackageJsonEfetivo(pack, 'erp')
        );
      }
      const manifesto = integrity.gerarManifesto(pack, { modulo: 'erp', commit: 'ok', branch: 'main' });
      integrity.escreverManifesto(pack, manifesto);
      assert.ok(manifesto.hashBackend);
      assert.ok(manifesto.quantidadeBackend >= 2);

      const asarPath = path.join(tmp, 'app.asar');
      await asar.createPackage(pack, asarPath);
      const cmp = integrity.compararRepoComAsar(pack, asarPath, { manifesto, modulo: 'erp' });
      assert.strictEqual(cmp.ok, true, cmp.erros.join('\n'));
      assert.ok(cmp.porCamada.backend.ok >= 2);
      assert.ok(cmp.porCamada.frontend.ok >= 5);
      assert.ok(cmp.porCamada.electron.ok >= 3);
    } finally {
      limparDir(tmp);
    }
  });

  await test('backend divergente no asar: comparação falha', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc3166-be-'));
    const pack = path.join(tmp, 'pack');
    try {
      montarFixtureIntegral(pack);
      const manifestoVelho = integrity.gerarManifesto(pack, { modulo: 'erp', commit: 't', branch: 'b' });
      integrity.escreverManifesto(pack, manifestoVelho);
      const asarPath = path.join(tmp, 'app.asar');
      await asar.createPackage(pack, asarPath);

      fs.appendFileSync(path.join(pack, 'backend/server.js'), '\n/* backend stale */\n');
      const manifestoNovo = integrity.gerarManifesto(pack, { modulo: 'erp', commit: 't2', branch: 'b' });
      integrity.escreverManifesto(pack, manifestoNovo);

      const cmp = integrity.compararRepoComAsar(pack, asarPath, { manifesto: manifestoNovo, modulo: 'erp' });
      assert.strictEqual(cmp.ok, false);
      assert.ok(cmp.divergencias.some((d) => d.camada === 'backend'));
    } finally {
      limparDir(tmp);
    }
  });

  await test('diagnóstico e preload expõem cópia RC3.16.6', () => {
    const diagSrc = fs.readFileSync(path.join(root, 'electron-diagnostico.js'), 'utf8');
    assert.match(diagSrc, /Copiar Diagnóstico/);
    assert.match(diagSrc, /hashBackend/);
    assert.match(diagSrc, /formatarDiagnosticoTexto/);
    const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
    assert.match(preload, /copiarDiagnosticoElectron/);
  });

  console.log('\nRC3.16.6 — testes OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
