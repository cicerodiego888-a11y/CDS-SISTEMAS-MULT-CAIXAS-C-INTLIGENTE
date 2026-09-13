/**
 * Sprint 15.7 — Device Profile SDK
 * Executar: npm run test:device-sdk
 */

'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '../..');
const sdk = require(path.join(root, 'backend/motores/equipamentos/sdk'));
const {
  DeviceProfile,
  DriverCapabilities,
  DriverManifest,
  DriverCompatibility,
  DriverValidator,
  DriverTemplateGenerator,
  DriverRegistry
} = sdk;

describe('Sprint 15.7 — Manifest', () => {
  it('parseManifest normaliza capabilities e discovery', () => {
    const m = DriverManifest.parseManifest({
      id: 'toledo-prix4',
      fabricante: 'Toledo',
      modelo: 'Prix IV Uno',
      categoria: 'balanca',
      protocolo: '90AX',
      transportes: ['ethernet', 'serial'],
      discovery: { ports: [9000, 9100], timeout: 500 },
      capabilities: { identify: true, sync: true, rollback: true }
    });
    assert.equal(m.id, 'toledo-prix4');
    assert.equal(m.capabilities.identification, true);
    assert.equal(m.capabilities.synchronization, true);
    assert.equal(m.capabilities.rollback, true);
    assert.deepEqual(m.discovery.ports, [9000, 9100]);
    assert.ok(m.capabilitiesLista.includes('identification'));
  });
});

describe('Sprint 15.7 — Validator', () => {
  it('valida manifesto Toledo', () => {
    const r = DriverValidator.validarManifest({
      id: 'toledo-prix4',
      fabricante: 'Toledo',
      modelo: 'Prix IV Uno',
      categoria: 'balanca',
      protocolo: '90AX',
      transportes: ['ethernet'],
      capabilities: { identify: true, sync: true }
    });
    assert.equal(r.valido, true);
    assert.equal(r.compatibilidade.compativel, true);
  });

  it('rejeita manifesto sem id', () => {
    const r = DriverValidator.validarManifest({
      fabricante: 'X',
      modelo: 'Y',
      categoria: 'balanca'
    });
    assert.equal(r.valido, false);
    assert.ok(r.erros.some((e) => /id/i.test(e)));
  });
});

describe('Sprint 15.7 — Compatibility', () => {
  it('compara semver e motor mínimo', () => {
    assert.ok(DriverCompatibility.compararSemver('15.7.0', '15.6.0') > 0);
    const ok = DriverCompatibility.avaliarCompatibilidade({
      motorMinimo: '15.7.0',
      transportes: ['ethernet'],
      capabilities: { discovery: true },
      capabilitiesLista: ['discovery'],
      protocolo: '90AX'
    }, { motorVersao: '15.7.0' });
    assert.equal(ok.compativel, true);

    const bad = DriverCompatibility.avaliarCompatibilidade({
      motorMinimo: '99.0.0',
      transportes: ['ethernet'],
      capabilitiesLista: ['discovery'],
      protocolo: 'x'
    }, { motorVersao: '15.7.0' });
    assert.equal(bad.compativel, false);
  });
});

describe('Sprint 15.7 — Registry + Loader', () => {
  before(() => {
    sdk.reload();
  });

  it('carrega drivers automaticamente', () => {
    const rel = sdk.loader.obterRelatorio();
    assert.ok(rel);
    assert.ok(rel.totalRegistrados >= 2, `esperava >=2, veio ${rel.totalRegistrados}`);
    assert.ok(Array.isArray(rel.carregados));
  });

  it('registry lista Toledo e categorias', () => {
    const toledo = sdk.registry.buscar('toledo-prix4');
    assert.ok(toledo);
    assert.equal(toledo.fabricante, 'Toledo');
    assert.ok(toledo.temCapability('sync'));
    const cats = sdk.registry.listarCategorias();
    assert.ok(cats.some((c) => c.categoria === 'balanca'));
  });

  it('DeviceProfile.toJSON expõe capabilities e estado', () => {
    const p = sdk.registry.buscar('toledo-prix4');
    const json = p.toJSON();
    assert.equal(json.id, 'toledo-prix4');
    assert.ok(json.capabilities.synchronization || json.capabilitiesLista.includes('synchronization'));
    assert.ok(json.versao);
  });
});

describe('Sprint 15.7 — Generator', () => {
  it('gera scaffold em pasta temporária (API)', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-sdk-'));
    // gera no tree real com id único e limpa depois
    const id = `acme-test-${Date.now().toString(36)}`;
    const result = DriverTemplateGenerator.gerarDriver({
      id,
      fabricante: 'AcmeTest',
      modelo: `M${Date.now().toString(36)}`,
      categoria: 'balanca',
      protocolo: 'acme-proto',
      registrarEmSdk: true,
      forcar: true
    });
    assert.equal(result.ok, true);
    assert.ok(fs.existsSync(path.join(result.pasta, 'device.profile.js')));
    assert.ok(fs.existsSync(path.join(result.pasta, `${result.className}.js`)));
    assert.ok(fs.existsSync(path.join(result.pasta, 'README.md')));

    // limpeza
    for (const f of result.arquivos) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    try { fs.rmSync(result.pasta, { recursive: true, force: true }); } catch { /* ignore */ }
    try {
      const sdkProf = path.join(root, 'backend/motores/equipamentos/sdk/profiles', `${id}.js`);
      if (fs.existsSync(sdkProf)) fs.unlinkSync(sdkProf);
    } catch { /* ignore */ }
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});

describe('Sprint 15.7 — API routes wiring', () => {
  it('rotas SDK montadas em equipamentos.js', () => {
    const rotas = fs.readFileSync(path.join(root, 'backend/rotas/equipamentos.js'), 'utf8');
    assert.match(rotas, /DriverSdkRoutes|DriverSdkController/);
    assert.match(rotas, /\/drivers/);
  });

  it('package.json possui driver:create e test:device-sdk', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.ok(pkg.scripts['driver:create']);
    assert.ok(pkg.scripts['test:device-sdk']);
  });
});

describe('Sprint 15.7 — Capabilities padronizadas', () => {
  it('lista canônica completa', () => {
    assert.ok(DriverCapabilities.ALL_CANONICAL.includes('discovery'));
    assert.ok(DriverCapabilities.ALL_CANONICAL.includes('synchronization'));
    assert.ok(DriverCapabilities.ALL_CANONICAL.includes('rollback'));
    assert.ok(DriverCapabilities.temCapability({ identify: true }, 'identification'));
  });
});
