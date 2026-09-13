/**
 * Testes — UrlResolver inteligente (Sprint F3)
 * Sem acesso HTTP / SEFAZ.
 *
 * Executar: npm run test:url-resolver
 *           node tests/fiscal/url-resolver.test.js
 */

const assert = require('assert');
const {
  UrlResolver,
  RegistryBuilder,
  WebServiceRegistry,
  ResolutionResult,
  ResolutionSource,
  ResolverContext,
  ResolverException,
  ResolverErrorCode,
  ResolverWarnings,
  createWarning,
  validateResolverContext,
  assertValidResolverContext,
  ResolverMetrics,
  ModelType,
  OperationType,
  EnvironmentType,
  FiscalWebServices,
  UF_SVRS,
  UF_AN,
  listResolutionSources
} = require('../../backend/services/fiscal/core');

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

async function main() {
  console.log('\n=== Testes UrlResolver — Sprint F3 ===\n');

  await test('ResolutionSource enum oficial', async () => {
    assert.deepStrictEqual(
      listResolutionSources().sort(),
      ['CACHE', 'FALLBACK', 'OVERRIDE', 'REGISTRY'].sort()
    );
  });

  await test('ResolverContext é imutável', async () => {
    const ctx = ResolverContext.create({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: 'svrs',
      versao: '4.00',
      metadata: { origem: 'teste' }
    });
    assert.strictEqual(ctx.uf, 'SVRS');
    assert.ok(Object.isFrozen(ctx));
    assert.ok(Object.isFrozen(ctx.metadata));
    assert.throws(() => {
      'use strict';
      ctx.uf = 'CE';
    }, TypeError);
  });

  await test('ResolverValidator exige campos obrigatórios', async () => {
    const invalid = validateResolverContext({});
    assert.strictEqual(invalid.valid, false);
    assert.ok(invalid.errors.some((e) => /modelo/.test(e)));
    assert.ok(invalid.errors.some((e) => /operacao/.test(e)));
    assert.ok(invalid.errors.some((e) => /ambiente/.test(e)));

    assert.throws(
      () => assertValidResolverContext({
        modelo: ModelType.NFCE,
        operacao: OperationType.AUTORIZACAO,
        ambiente: EnvironmentType.PRODUCAO
      }),
      (err) => err instanceof ResolverException
        && err.code === ResolverErrorCode.VALIDATION_ERROR
    );
  });

  await test('ResolverValidator aceita contexto válido com warning de versão', async () => {
    const result = validateResolverContext({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.HOMOLOGACAO,
      uf: UF_SVRS
    });
    assert.strictEqual(result.valid, true);
    assert.ok(result.warnings.some((w) => w.code === ResolverWarnings.VERSAO_PADRAO_UTILIZADA));
  });

  await test('ResolverException factories', async () => {
    const err = ResolverException.validationError('falhou', { errors: ['x'] });
    assert.ok(ResolverException.isResolverException(err));
    assert.strictEqual(err.code, ResolverErrorCode.VALIDATION_ERROR);
    assert.deepStrictEqual(err.details.errors, ['x']);
  });

  await test('ResolutionResult success/failure imutáveis', async () => {
    const ok = ResolutionResult.success({
      source: ResolutionSource.REGISTRY,
      definition: { endpoint: 'https://exemplo.local', id: 'X' },
      warnings: [createWarning(ResolverWarnings.VERSAO_PADRAO_UTILIZADA)],
      executionTime: 1.5
    });
    assert.strictEqual(ok.success, true);
    assert.strictEqual(ok.getEndpoint(), 'https://exemplo.local');
    assert.ok(Object.isFrozen(ok));
    assert.throws(() => {
      'use strict';
      ok.success = false;
    }, TypeError);

    const fail = ResolutionResult.failure({
      executionTime: 0.2,
      error: 'não achou'
    });
    assert.strictEqual(fail.success, false);
    assert.strictEqual(fail.definition, null);
    assert.strictEqual(fail.getEndpoint(), null);
  });

  await test('resolução válida via REGISTRY', async () => {
    const resolver = new UrlResolver(RegistryBuilder.buildOfficial());
    const result = resolver.resolve({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: UF_SVRS,
      versao: '4.00'
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, ResolutionSource.REGISTRY);
    assert.ok(result.definition.endpoint.includes('NFeAutorizacao4'));
    assert.ok(result.resolvedAt instanceof Date);
    assert.ok(result.executionTime >= 0);
    assert.ok(Array.isArray(result.warnings));
  });

  await test('resolução DF-e Ambiente Nacional', async () => {
    const resolver = new UrlResolver(RegistryBuilder.buildOfficial());
    const result = resolver.resolve({
      modelo: ModelType.NFE,
      operacao: OperationType.DISTRIBUICAO_DFE,
      ambiente: EnvironmentType.HOMOLOGACAO,
      uf: UF_AN
    });
    assert.strictEqual(result.success, true);
    assert.ok(result.definition.endpoint.includes('hom1.nfe.fazenda.gov.br'));
    assert.ok(result.warnings.some((w) => w.code === ResolverWarnings.VERSAO_PADRAO_UTILIZADA));
  });

  await test('Manifestação sempre resolve AN (mesmo com uf SVRS)', async () => {
    const resolver = new UrlResolver(RegistryBuilder.buildOfficial());
    const result = resolver.resolve({
      modelo: ModelType.NFE,
      operacao: OperationType.MANIFESTACAO_CIENCIA,
      ambiente: EnvironmentType.PRODUCAO,
      uf: UF_SVRS,
      versao: '1.00'
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.context.uf, UF_AN);
    assert.strictEqual(result.definition.uf, UF_AN);
    assert.ok(result.definition.endpoint.includes('www.nfe.fazenda.gov.br/NFeRecepcaoEvento4'));
  });

  await test('resolução inexistente retorna success=false', async () => {
    const resolver = new UrlResolver(RegistryBuilder.buildOfficial());
    const result = resolver.resolve({
      modelo: ModelType.CTE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: UF_SVRS,
      versao: '4.00'
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.definition, null);
    assert.ok(result.error);
  });

  await test('validação inválida não lança — retorna failure', async () => {
    const resolver = new UrlResolver(RegistryBuilder.buildOfficial());
    const result = resolver.resolve({ modelo: 'XYZ' });
    assert.strictEqual(result.success, false);
    assert.ok(/modelo|operacao|ambiente/i.test(result.error));
  });

  await test('warning VERSAO_DIVERGENTE', async () => {
    const resolver = new UrlResolver(RegistryBuilder.buildOfficial());
    const result = resolver.resolve({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: UF_SVRS,
      versao: '1.00'
    });
    assert.strictEqual(result.success, true);
    assert.ok(result.warnings.some((w) => w.code === ResolverWarnings.VERSAO_DIVERGENTE));
  });

  await test('override explícito usa source OVERRIDE', async () => {
    const resolver = new UrlResolver(RegistryBuilder.buildOfficial());
    const result = resolver.resolve({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: UF_SVRS,
      versao: '4.00',
      override: {
        endpoint: 'https://override.local/ws',
        soapAction: 'action-override',
        namespace: 'ns-override'
      }
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, ResolutionSource.OVERRIDE);
    assert.strictEqual(result.definition.endpoint, 'https://override.local/ws');
  });

  await test('override inválido gera warning e cai no registry', async () => {
    const resolver = new UrlResolver(RegistryBuilder.buildOfficial());
    const result = resolver.resolve({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: UF_SVRS,
      versao: '4.00',
      override: { endpoint: '' }
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, ResolutionSource.REGISTRY);
    assert.ok(result.warnings.some((w) => w.code === ResolverWarnings.OVERRIDE_NAO_ENCONTRADO));
  });

  await test('SERVICO_DESATIVADO warning', async () => {
    const registry = new WebServiceRegistry();
    registry.register({
      modelo: ModelType.NFCE,
      operacao: OperationType.STATUS_SERVICO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: UF_SVRS,
      endpoint: 'https://exemplo.local/status',
      soapAction: 'a',
      namespace: 'n',
      versao: '4.00',
      ativo: false,
      descricao: 'inativo'
    });
    const resolver = new UrlResolver(registry);
    const result = resolver.resolve({
      modelo: ModelType.NFCE,
      operacao: OperationType.STATUS_SERVICO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: UF_SVRS,
      versao: '4.00'
    });
    assert.strictEqual(result.success, true);
    assert.ok(result.warnings.some((w) => w.code === ResolverWarnings.SERVICO_DESATIVADO));
  });

  await test('ResolverMetrics acumula resoluções e tempo médio', async () => {
    const metrics = new ResolverMetrics();
    const resolver = new UrlResolver(RegistryBuilder.buildOfficial(), { metrics });

    for (let i = 0; i < 5; i += 1) {
      resolver.resolve({
        modelo: ModelType.NFCE,
        operacao: OperationType.AUTORIZACAO,
        ambiente: EnvironmentType.PRODUCAO,
        uf: UF_SVRS,
        versao: '4.00'
      });
    }
    resolver.resolve({
      modelo: ModelType.CTE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: UF_SVRS,
      versao: '4.00'
    });

    const snap = metrics.snapshot();
    assert.strictEqual(snap.total, 6);
    assert.strictEqual(snap.success, 5);
    assert.strictEqual(snap.failures, 1);
    assert.ok(snap.averageExecutionTimeMs >= 0);
    assert.ok(snap.bySource.REGISTRY >= 5);
    assert.ok(Object.isFrozen(snap));

    console.log(`         tempo médio resolução: ${snap.averageExecutionTimeMs.toFixed(4)} ms`);
  });

  await test('resolve nunca retorna string', async () => {
    const resolver = new UrlResolver(RegistryBuilder.buildOfficial());
    const result = resolver.resolve({
      modelo: ModelType.NFE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.HOMOLOGACAO,
      uf: UF_SVRS
    });
    assert.notStrictEqual(typeof result, 'string');
    assert.ok(result instanceof ResolutionResult || (result && typeof result.success === 'boolean'));
  });

  await test('FiscalWebServices.resolve atalho e isActive parcial F5', async () => {
    const platform = new FiscalWebServices();
    assert.strictEqual(platform.isActive(), true);
    assert.strictEqual(platform.getVersion(), 'F10-autorizacao');
    const result = platform.resolve({
      modelo: ModelType.NFCE,
      operacao: OperationType.CANCELAMENTO,
      ambiente: EnvironmentType.HOMOLOGACAO,
      uf: UF_SVRS,
      versao: '1.00'
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, ResolutionSource.REGISTRY);
  });

  await test('CACHE e FALLBACK reservados (flags desligadas)', async () => {
    const resolver = new UrlResolver(RegistryBuilder.buildOfficial());
    assert.strictEqual(resolver._cacheEnabled, false);
    assert.strictEqual(resolver._fallbackEnabled, false);
    assert.strictEqual(resolver._tryResolveCache({}), null);
    assert.strictEqual(resolver._tryResolveFallback({}), null);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
