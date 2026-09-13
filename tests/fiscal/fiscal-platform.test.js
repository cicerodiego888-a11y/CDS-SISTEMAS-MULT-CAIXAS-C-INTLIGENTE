/**
 * Testes — Plataforma Fiscal (Sprint F1)
 * Fundação: classes, contratos, enums. Sem integração SEFAZ.
 *
 * Executar: npm run test:fiscal-platform
 *           node tests/fiscal/fiscal-platform.test.js
 */

const assert = require('assert');
const path = require('path');

const core = require('../../backend/services/fiscal/core');
const {
  FiscalWebServices,
  WebServiceRegistry,
  UrlResolver,
  SoapTransport,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  OperationType,
  isOperationType,
  listOperationTypes,
  ModelType,
  ModelCode,
  isModelType,
  listModelTypes,
  getModelCode,
  EnvironmentType,
  EnvironmentCode,
  isEnvironmentType,
  listEnvironmentTypes,
  fromAmbienteCode,
  toAmbienteCode
} = core;

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
  console.log('\n=== Testes Plataforma Fiscal — Sprint F1 ===\n');

  await test('barrel core exporta todos os símbolos oficiais', async () => {
    const esperados = [
      'FiscalWebServices',
      'WebServiceRegistry',
      'UrlResolver',
      'SoapTransport',
      'OperationType',
      'ModelType',
      'EnvironmentType',
      'ENABLED_OPERATIONS',
      'RESERVED_OPERATIONS',
      'FiscalRuntimeMetrics',
      'logFiscalRuntime',
      'PLATFORM_USER_AGENT'
    ];
    for (const nome of esperados) {
      assert.ok(core[nome], `faltou export: ${nome}`);
    }
    assert.ok(core.RESERVED_OPERATIONS.includes(OperationType.RETORNO_AUTORIZACAO));
    assert.ok(core.RESERVED_OPERATIONS.includes(OperationType.MANIFESTACAO));
  });

  await test('OperationType contém todas as operações oficiais', async () => {
    const esperadas = [
      'AUTORIZACAO',
      'RETORNO',
      'RETORNO_AUTORIZACAO',
      'STATUS',
      'STATUS_SERVICO',
      'CANCELAMENTO',
      'DISTRIBUICAO_DFE',
      'MANIFESTACAO',
      'MANIFESTACAO_CIENCIA',
      'MANIFESTACAO_CONFIRMACAO',
      'MANIFESTACAO_DESCONHECIMENTO',
      'MANIFESTACAO_NAO_REALIZADA',
      'CONSULTA_PROTOCOLO',
      'INUTILIZACAO'
    ];
    assert.deepStrictEqual(listOperationTypes().sort(), [...esperadas].sort());
    for (const op of esperadas) {
      assert.strictEqual(OperationType[op], op);
      assert.strictEqual(isOperationType(op), true);
    }
    assert.strictEqual(isOperationType('INVALIDA'), false);
    assert.ok(Object.isFrozen(OperationType));
  });

  await test('ModelType e códigos fiscais oficiais', async () => {
    assert.deepStrictEqual(listModelTypes().sort(), ['CTE', 'MDFE', 'NFCE', 'NFE'].sort());
    assert.strictEqual(getModelCode(ModelType.NFE), '55');
    assert.strictEqual(getModelCode(ModelType.NFCE), '65');
    assert.strictEqual(getModelCode(ModelType.CTE), '57');
    assert.strictEqual(getModelCode(ModelType.MDFE), '58');
    assert.strictEqual(ModelCode[ModelType.NFCE], '65');
    assert.strictEqual(isModelType('NFCE'), true);
    assert.strictEqual(isModelType('XYZ'), false);
    assert.ok(Object.isFrozen(ModelType));
  });

  await test('EnvironmentType alinha códigos 1 e 2', async () => {
    assert.deepStrictEqual(listEnvironmentTypes().sort(), ['HOMOLOGACAO', 'PRODUCAO'].sort());
    assert.strictEqual(EnvironmentCode[EnvironmentType.PRODUCAO], 1);
    assert.strictEqual(EnvironmentCode[EnvironmentType.HOMOLOGACAO], 2);
    assert.strictEqual(fromAmbienteCode(1), EnvironmentType.PRODUCAO);
    assert.strictEqual(fromAmbienteCode(2), EnvironmentType.HOMOLOGACAO);
    assert.strictEqual(fromAmbienteCode('2'), EnvironmentType.HOMOLOGACAO);
    assert.strictEqual(fromAmbienteCode(9), null);
    assert.strictEqual(toAmbienteCode(EnvironmentType.PRODUCAO), 1);
    assert.strictEqual(toAmbienteCode(EnvironmentType.HOMOLOGACAO), 2);
    assert.strictEqual(isEnvironmentType('PRODUCAO'), true);
    assert.strictEqual(isEnvironmentType('DEV'), false);
    assert.ok(Object.isFrozen(EnvironmentType));
  });

  await test('WebServiceRegistry inicia vazio', async () => {
    const registry = new WebServiceRegistry();
    assert.strictEqual(registry.size(), 0);
    assert.strictEqual(registry.isEmpty(), true);
    assert.deepStrictEqual(registry.list(), []);
    assert.strictEqual(
      registry.get({
        modelo: ModelType.NFCE,
        operacao: OperationType.AUTORIZACAO,
        ambiente: EnvironmentType.HOMOLOGACAO,
        uf: 'SVRS'
      }),
      null
    );
  });

  await test('WebServiceRegistry buildKey e register (contrato)', async () => {
    const registry = new WebServiceRegistry();
    const key = WebServiceRegistry.buildKey({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: 'svrs'
    });
    assert.strictEqual(key, 'NFCE|AUTORIZACAO|PRODUCAO|SVRS');

    registry.register({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: 'SVRS',
      versao: '4.00',
      endpoint: 'https://exemplo.local/ws',
      soapAction: 'action-teste',
      namespace: 'ns-teste',
      timeout: 90000
    });

    assert.strictEqual(registry.size(), 1);
    assert.strictEqual(registry.isEmpty(), false);
    const def = registry.get({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: 'SVRS'
    });
    assert.ok(def);
    assert.strictEqual(def.endpoint, 'https://exemplo.local/ws');
    assert.strictEqual(def.versao, '4.00');
    registry.clear();
    assert.strictEqual(registry.isEmpty(), true);
  });

  await test('WebServiceRegistry rejeita definition inválida', async () => {
    const registry = new WebServiceRegistry();
    assert.throws(() => registry.register(null), /inválido/);
    assert.throws(
      () => registry.register({ modelo: ModelType.NFCE }),
      /operacao inválida|ambiente inválido|uf é obrigatória|endpoint/
    );
  });

  await test('UrlResolver sem registry retorna ResolutionResult failure', async () => {
    const resolver = new UrlResolver();
    assert.strictEqual(resolver.getRegistry(), null);
    assert.strictEqual(resolver.isReady(), false);
    const result = resolver.resolve({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.HOMOLOGACAO,
      uf: 'SVRS'
    });
    assert.strictEqual(typeof result, 'object');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.definition, null);
    assert.ok(result.executionTime >= 0);
    assert.strictEqual(
      resolver.resolveEndpoint({
        modelo: ModelType.NFCE,
        operacao: OperationType.AUTORIZACAO,
        ambiente: EnvironmentType.HOMOLOGACAO,
        uf: 'SVRS'
      }),
      null
    );
  });

  await test('UrlResolver com registry vazio permanece not ready e falha', async () => {
    const registry = new WebServiceRegistry();
    const resolver = new UrlResolver(registry);
    assert.strictEqual(resolver.isReady(), false);
    const result = resolver.resolve({
      modelo: ModelType.NFE,
      operacao: OperationType.DISTRIBUICAO_DFE,
      ambiente: EnvironmentType.PRODUCAO,
      uf: 'AN'
    });
    assert.strictEqual(result.success, false);
    assert.ok(result.warnings.some((w) => w.code === 'REGISTRY_VAZIO'));
  });

  await test('UrlResolver resolve contrato oficial via REGISTRY (F3)', async () => {
    const { RegistryBuilder, ResolutionSource } = require('../../backend/services/fiscal/core');
    const resolver = new UrlResolver(RegistryBuilder.buildOfficial());
    assert.strictEqual(resolver.isReady(), true);
    const result = resolver.resolve({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: 'SVRS'
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, ResolutionSource.REGISTRY);
    assert.ok(result.definition.endpoint.includes('nfce.svrs.rs.gov.br'));
  });

  await test('SoapTransport estrutura — Status habilitado, demais off', async () => {
    const transport = new SoapTransport();
    assert.strictEqual(transport.isEnabled(), false);
    assert.strictEqual(transport.timeoutMs, DEFAULT_TIMEOUT_MS);

    const cfg = transport.getConfig();
    assert.strictEqual(cfg.minTlsVersion, 'TLSv1.2');
    assert.strictEqual(cfg.rejectUnauthorized, false);
    assert.strictEqual(cfg.enabled, true);
    assert.ok(cfg.enabledOperations.includes('STATUS_SERVICO'));
    assert.ok(cfg.enabledOperations.includes('DISTRIBUICAO_DFE'));
    assert.ok(cfg.enabledOperations.includes('MANIFESTACAO_CIENCIA'));
    assert.ok(cfg.enabledOperations.includes('CANCELAMENTO'));
    assert.ok(cfg.enabledOperations.includes('AUTORIZACAO'));
    assert.ok(cfg.enabledOperations.includes('RETORNO_AUTORIZACAO'));

    const result = await transport.send({
      url: 'https://exemplo.local',
      envelope: '<xml/>'
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 'not_implemented');
    assert.ok(String(result.error || result.message || '').includes('SoapTransport'));
  });

  await test('SoapTransport aceita options de configuração', async () => {
    const transport = new SoapTransport({
      timeoutMs: 30000,
      maxRetries: 0,
      rejectUnauthorized: true
    });
    const cfg = transport.getConfig();
    assert.strictEqual(cfg.timeoutMs, 30000);
    assert.strictEqual(cfg.maxRetries, 0);
    assert.strictEqual(cfg.rejectUnauthorized, true);
  });

  await test('FiscalWebServices porta oficial — F6 Status + DF-e ativos', async () => {
    const platform = new FiscalWebServices();
    assert.strictEqual(platform.getVersion(), 'F10-autorizacao');
    assert.strictEqual(platform.isActive(), true);
    assert.strictEqual(platform.isActiveFor(OperationType.STATUS_SERVICO), true);
    assert.strictEqual(platform.isActiveFor(OperationType.AUTORIZACAO), true);
    assert.strictEqual(platform.isActiveFor(OperationType.INUTILIZACAO), false);

    const types = platform.getTypes();
    assert.strictEqual(types.OperationType, OperationType);
    assert.strictEqual(types.ModelType, ModelType);
    assert.strictEqual(types.EnvironmentType, EnvironmentType);

    assert.ok(platform.getRegistry() instanceof WebServiceRegistry);
    assert.ok(platform.getUrlResolver() instanceof UrlResolver);
    assert.ok(platform.getSoapTransport() instanceof SoapTransport);

    const status = platform.getStatus();
    assert.strictEqual(status.active, true);
    assert.strictEqual(status.registryEmpty, false);
    assert.strictEqual(status.registrySize, 24);
    assert.strictEqual(status.officialCount, 24);
    assert.strictEqual(status.resolverReady, true);
    assert.strictEqual(status.transportEnabled, true);
    assert.ok(status.resolverMetrics);
    assert.ok(status.transportMetrics);
  });

  await test('FiscalWebServices aceita injeção de dependências', async () => {
    const registry = new WebServiceRegistry();
    const urlResolver = new UrlResolver();
    const soapTransport = new SoapTransport({ timeoutMs: 1000 });
    const platform = new FiscalWebServices({ registry, urlResolver, soapTransport });

    assert.strictEqual(platform.getRegistry(), registry);
    assert.strictEqual(platform.getUrlResolver(), urlResolver);
    assert.strictEqual(platform.getSoapTransport(), soapTransport);
    assert.strictEqual(urlResolver.getRegistry(), registry);
  });

  await test('módulos core existem no filesystem', async () => {
    const base = path.join(__dirname, '../../backend/services/fiscal/core');
    const arquivos = [
      'FiscalWebServices.js',
      'WebServiceRegistry.js',
      'WebServiceDefinition.js',
      'RegistryBuilder.js',
      'UrlResolver.js',
      'ResolutionResult.js',
      'ResolutionSource.js',
      'ResolverContext.js',
      'ResolverValidator.js',
      'ResolverException.js',
      'ResolverWarnings.js',
      'ResolverMetrics.js',
      'TransportEnablement.js',
      'SoapTransport.js',
      'TransportContext.js',
      'TransportRequest.js',
      'TransportResponse.js',
      'TransportException.js',
      'TransportMetrics.js',
      'TransportFactory.js',
      'RetryPolicy.js',
      'TimeoutPolicy.js',
      'TlsPolicy.js',
      'OperationType.js',
      'ModelType.js',
      'EnvironmentType.js',
      'index.js',
      'README.md'
    ];
    const fs = require('fs');
    for (const arquivo of arquivos) {
      assert.ok(fs.existsSync(path.join(base, arquivo)), `faltou ${arquivo}`);
    }
    assert.ok(
      fs.existsSync(path.join(__dirname, '../../docs/fiscal/FISCAL_PLATFORM.md')),
      'faltou docs/fiscal/FISCAL_PLATFORM.md'
    );
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
