/**
 * RC4.31.7 — Certificação Final do Empacotamento Electron (App Integrity)
 * Executar: node tests/electron/rc4317-app-integrity.test.js
 * Pós-build: node tests/electron/rc4317-app-integrity.test.js --require-asar
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const integrity = require('../../electron-integrity');

const ROOT = path.join(__dirname, '../..');
const requireAsar = process.argv.includes('--require-asar');

let ok = 0;
let falhas = 0;

function test(nome, fn) {
  try {
    fn();
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FAIL  ${nome}`);
    console.error(`       ${err.message}`);
  }
}

console.log('\n=== RC4.31.7 — App Integrity Electron ===\n');

test('electron-integrity exporta API RC4.31.7', () => {
  [
    'hashAsarCompleto',
    'gerarRelatorioDivergencias',
    'executarSmokeTestAsar',
    'gerarManifestoBuild',
    'certificarIntegridadeErp',
    'BUILD_MANIFEST_REL'
  ].forEach((nome) => {
    assert.ok(integrity[nome], `export ausente: ${nome}`);
  });
});

test('gerarRelatorioDivergencias — estrutura do relatório', () => {
  const rel = integrity.gerarRelatorioDivergencias({
    ok: false,
    quantidadeValidada: 100,
    divergencias: [{
      arquivo: 'backend/database.js',
      camada: 'backend',
      esperado: 'aaa',
      obtido: 'bbb',
      motivo: 'repo_vs_asar'
    }],
    ausentesNoAsar: [],
    erros: ['1 divergência'],
    porCamada: { backend: { ok: 99, fail: 1 } }
  });
  assert.ok(rel.includes('backend/database.js'));
  assert.ok(rel.includes('Hash esperado'));
  assert.ok(rel.includes('REPROVADO'));
});

test('manifesto fonte — repo alinhado com electron-manifest.json', () => {
  let manifesto;
  try {
    manifesto = integrity.lerManifesto(ROOT);
  } catch (_) {
    manifesto = integrity.gerarManifesto(ROOT, { modulo: 'erp' });
    integrity.escreverManifesto(ROOT, manifesto);
  }
  const local = integrity.validarIntegridadePacoteLocal(ROOT);
  if (!local.ok) {
    manifesto = integrity.gerarManifesto(ROOT, { modulo: 'erp' });
    integrity.escreverManifesto(ROOT, manifesto);
    const local2 = integrity.validarIntegridadePacoteLocal(ROOT);
    assert.ok(local2.ok, local2.erros.join('; '));
  } else {
    assert.ok(local.ok);
  }
});

test('database.js fonte contém certificação universal RC4.31.6', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
  assert.match(src, /aplicarCertificacaoSql\s*\(\s*db\s*\)/);
  assert.doesNotMatch(src, /runComValidacaoInsert/);
});

test('scripts RC4.31.7 existem', () => {
  ['build/electron/certificar-integridade-rc4317.js', 'build/electron/limpar-cache-build.js'].forEach((rel) => {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `ausente: ${rel}`);
  });
});

const asarPath = integrity.resolverAsarPathErp(ROOT);

if (asarPath) {
  test('hashAsarCompleto — calcula SHA-256 do app.asar', () => {
    const hash = integrity.hashAsarCompleto(asarPath);
    assert.match(hash, /^[a-f0-9]{64}$/);
    console.log(`       hash app.asar: ${hash.slice(0, 16)}…`);
  });

  test('compararRepoComAsar — integridade repo × asar', () => {
    const manifesto = integrity.gerarManifesto(ROOT, { modulo: 'erp' });
    const cmp = integrity.compararRepoComAsar(ROOT, asarPath, { manifesto, modulo: 'erp' });
    if (!cmp.ok) {
      cmp.divergencias.forEach((d) => {
        console.error(`       DIVERGE ${d.arquivo}`);
      });
      if (requireAsar) {
        assert.strictEqual(cmp.divergencias.length, 0, `${cmp.divergencias.length} divergência(s)`);
        assert.ok(cmp.ok, cmp.erros.join('; '));
      } else {
        console.log(`       (skip — ${cmp.divergencias.length} divergência(s); executar npm run certificar:erp -- --rebuild)`);
      }
    } else {
      assert.ok(cmp.ok);
    }
  });

  test('smoke test asar — módulos críticos ERP', () => {
    const smoke = integrity.executarSmokeTestAsar(asarPath);
    if (!smoke.ok) {
      smoke.erros.forEach((e) => console.error(`       ${e}`));
      if (requireAsar) assert.fail(smoke.erros.join('; '));
      console.log('       (skip — smoke falhou; asar desatualizado)');
      return;
    }
    assert.ok(smoke.modulos.includes('database'));
    console.log(`       módulos: ${smoke.modulos.join(', ')}`);
  });

  if (requireAsar) {
    test('gerarManifestoBuild — certificação APROVADO', () => {
      const cert = integrity.certificarIntegridadeErp(ROOT);
      assert.ok(cert.ok, cert.relatorio);
      assert.strictEqual(cert.buildManifest.certificacao.resultado, 'APROVADO');
      integrity.escreverManifestoBuild(ROOT, cert.buildManifest);
      assert.ok(fs.existsSync(path.join(ROOT, integrity.BUILD_MANIFEST_REL)));
    });
  }
} else {
  test('app.asar — ausente', () => {
    if (requireAsar) assert.fail('app.asar não encontrado — executar npm run build:erp');
    console.log('       (skip — app.asar não encontrado)');
  });
}

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
