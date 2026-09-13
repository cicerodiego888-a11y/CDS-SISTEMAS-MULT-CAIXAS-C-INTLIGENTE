/**
 * Testes — SoapTransport Enterprise (Sprint F4)
 * Sem HTTP real. Sem axios.
 *
 * Executar: npm run test:soap-transport
 *           node tests/fiscal/soap-transport.test.js
 */

const assert = require('assert');
const {
  SoapTransport,
  TransportContext,
  TransportRequest,
  TransportResponse,
  TransportException,
  TransportErrorCode,
  TransportMetrics,
  TransportFactory,
  RetryPolicy,
  TimeoutPolicy,
  TlsPolicy,
  RegistryBuilder,
  ModelType,
  OperationType,
  EnvironmentType,
  FiscalWebServices,
  DEFAULT_TIMEOUT_MS,
  UF_SVRS
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
  console.log('\n=== Testes SoapTransport Enterprise — Sprint F4 ===\n');

  await test('TransportContext imutável e validação', async () => {
    assert.throws(
      () => TransportContext.create({}),
      (err) => err instanceof TransportException
        && err.code === TransportErrorCode.INVALID_CONTEXT
    );
    const ctx = TransportContext.create({
      endpoint: 'https://exemplo.local/ws',
      soapAction: 'action',
      namespace: 'ns',
      timeout: 30000,
      certificado: 'cert.pfx',
      senha: 'x',
      metadata: { op: 't' }
    });
    assert.strictEqual(ctx.endpoint, 'https://exemplo.local/ws');
    assert.ok(Object.isFrozen(ctx));
    assert.throws(() => {
      'use strict';
      ctx.endpoint = 'y';
    }, TypeError);
  });

  await test('TransportRequest exige envelope e context', async () => {
    assert.throws(
      () => TransportRequest.create({ envelope: '' }),
      (err) => err instanceof TransportException
    );
    const req = TransportRequest.create({
      context: {
        endpoint: 'https://exemplo.local/ws',
        soapAction: 'a'
      },
      envelope: '<soap/>',
      operacao: OperationType.AUTORIZACAO
    });
    assert.strictEqual(req.getEndpoint(), 'https://exemplo.local/ws');
    assert.ok(Object.isFrozen(req));
  });

  await test('TransportResponse success/failure', async () => {
    const ok = TransportResponse.success({
      body: '<ret/>',
      tempo: 12.5,
      headers: { 'content-type': 'application/soap+xml' }
    });
    assert.strictEqual(ok.success, true);
    assert.strictEqual(ok.statusCode, 200);
    assert.ok(Object.isFrozen(ok));

    const fail = TransportResponse.failure({
      tempo: 1,
      error: 'falhou',
      status: 'not_implemented'
    });
    assert.strictEqual(fail.success, false);
    assert.strictEqual(fail.error, 'falhou');
  });

  await test('TransportException factories', async () => {
    const err = TransportException.disabled();
    assert.ok(TransportException.isTransportException(err));
    assert.strictEqual(err.code, TransportErrorCode.DISABLED);
  });

  await test('RetryPolicy tentativas e backoff', async () => {
    const policy = new RetryPolicy({
      maxAttempts: 2,
      initialDelayMs: 1000,
      multiplier: 2,
      maxDelayMs: 5000
    });
    assert.strictEqual(policy.getMaxTries(), 3);
    assert.strictEqual(policy.shouldRetry(1), true);
    assert.strictEqual(policy.shouldRetry(3), false);
    assert.strictEqual(policy.getDelayMs(1), 1000);
    assert.strictEqual(policy.getDelayMs(2), 2000);
    assert.strictEqual(policy.getDelayMs(3), 4000);
    assert.strictEqual(policy.getDelayMs(4), 5000);
  });

  await test('RetryPolicy default é backoff exponencial (multiplier=2)', async () => {
    const policy = new RetryPolicy();
    assert.strictEqual(policy.multiplier, 2);
    assert.strictEqual(policy.getDelayMs(1), 3000);
    assert.strictEqual(policy.getDelayMs(2), 6000);
    assert.strictEqual(policy.getDelayMs(3), 12000);
  });

  await test('TimeoutPolicy por operação', async () => {
    const policy = new TimeoutPolicy();
    assert.strictEqual(policy.resolve(OperationType.STATUS_SERVICO), 30000);
    assert.strictEqual(policy.resolve(OperationType.AUTORIZACAO), 90000);
    assert.strictEqual(policy.resolve(OperationType.CANCELAMENTO), 30000);
    assert.strictEqual(policy.resolve('DESCONHECIDA'), DEFAULT_TIMEOUT_MS);
    assert.strictEqual(policy.resolve(OperationType.AUTORIZACAO, 15000), 15000);
  });

  await test('TlsPolicy TLSv1.2 e agent options', async () => {
    const policy = new TlsPolicy();
    assert.strictEqual(policy.minVersion, 'TLSv1.2');
    assert.strictEqual(policy.rejectUnauthorized, false);
    const validation = policy.validate();
    assert.strictEqual(validation.valid, true);
    const agent = policy.buildAgentOptions({
      key: 'k',
      cert: 'c',
      servername: 'nfce.svrs.rs.gov.br'
    });
    assert.strictEqual(agent.minVersion, 'TLSv1.2');
    assert.strictEqual(agent.servername, 'nfce.svrs.rs.gov.br');
  });

  await test('TransportFactory cria context a partir do registry', async () => {
    const registry = RegistryBuilder.buildOfficial();
    const definition = registry.get({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: UF_SVRS
    });
    const factory = new TransportFactory();
    const ctx = factory.createContext({
      definition,
      certificado: 'a1.pfx',
      senha: 'segredo'
    });
    assert.ok(ctx.endpoint.includes('NFeAutorizacao4'));
    assert.strictEqual(ctx.certificado, 'a1.pfx');
    assert.strictEqual(ctx.timeout, 90000);
    assert.ok(ctx.soapAction.includes('nfeAutorizacaoLote'));

    const req = factory.createRequest({
      definition,
      envelope: '<enviNFe/>',
      certificado: 'a1.pfx',
      senha: 'segredo'
    });
    assert.strictEqual(req.operacao, OperationType.AUTORIZACAO);
    assert.ok(req.envelope.includes('enviNFe'));
  });

  await test('SoapTransport permanece desabilitado sem operação / outras ops', async () => {
    const transport = new SoapTransport();
    assert.strictEqual(transport.isEnabled(), false);
    assert.strictEqual(transport.isEnabled('AUTORIZACAO'), true);
    assert.strictEqual(transport.isEnabled('INUTILIZACAO'), false);
    assert.strictEqual(transport.isEnabled('STATUS_SERVICO'), true);
    const response = await transport.send({
      url: 'https://exemplo.local/ws',
      envelope: '<soap/>',
      soapAction: 'action'
    });
    assert.strictEqual(response.success, false);
    assert.strictEqual(response.status, 'not_implemented');
    assert.ok(response.warnings.some((w) => w.code === 'TRANSPORT_DISABLED'));
    assert.ok(response.tempo >= 0);
  });

  await test('SoapTransport planRetry e resolveTimeout', async () => {
    const transport = new SoapTransport({ maxRetries: 2 });
    const plan = transport.planRetry(1);
    assert.strictEqual(plan.shouldRetry, true);
    assert.strictEqual(plan.delayMs, 3000);
    assert.strictEqual(transport.resolveTimeout(OperationType.CANCELAMENTO), 30000);
    const plan2 = transport.planRetry(2);
    assert.strictEqual(plan2.delayMs, 6000);
  });

  await test('SoapTransport User-Agent RC1 e skipBackoff com httpClient', async () => {
    const { PLATFORM_USER_AGENT } = require('../../backend/services/fiscal/core/SoapTransport');
    assert.strictEqual(PLATFORM_USER_AGENT, 'CDGESTAO-FISCAL-PLATFORM/RC1');
    let calls = 0;
    const transport = new SoapTransport({
      httpClient: async () => {
        calls += 1;
        if (calls < 2) {
          throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
        }
        return { statusCode: 200, body: 'ok', headers: {} };
      },
      maxRetries: 2
    });
    assert.strictEqual(transport._skipBackoff, true);
    const started = Date.now();
    const response = await transport.send({
      url: 'https://exemplo.local/ws',
      envelope: '<soap/>',
      operacao: OperationType.STATUS_SERVICO
    });
    const elapsed = Date.now() - started;
    assert.strictEqual(response.success, true);
    assert.ok(calls >= 2);
    assert.ok(elapsed < 2000, 'backoff deve ser ignorado com httpClient');
  });

  await test('TransportMetrics acumula chamadas e tempo médio', async () => {
    const metrics = new TransportMetrics();
    const transport = new SoapTransport({ metrics });

    for (let i = 0; i < 4; i += 1) {
      await transport.send({
        url: 'https://exemplo.local/ws',
        envelope: `<soap>${i}</soap>`
      });
    }

    const snap = metrics.snapshot();
    assert.strictEqual(snap.total, 4);
    assert.strictEqual(snap.failures, 4);
    assert.strictEqual(snap.success, 0);
    assert.ok(snap.averageTempoMs >= 0);
    console.log(`         tempo médio transporte (disabled): ${snap.averageTempoMs.toFixed(4)} ms`);
  });

  await test('send com request inválido registra failure', async () => {
    const transport = new SoapTransport();
    const response = await transport.send(null);
    assert.strictEqual(response.success, false);
    assert.strictEqual(response.status, 'invalid_request');
  });

  await test('FiscalWebServices F5 com transportMetrics', async () => {
    const platform = new FiscalWebServices();
    assert.strictEqual(platform.getVersion(), 'F10-autorizacao');
    assert.strictEqual(platform.isActive(), true);
    assert.strictEqual(platform.getSoapTransport().isEnabled('STATUS_SERVICO'), true);
    const status = platform.getStatus();
    assert.strictEqual(status.transportEnabled, true);
    assert.ok(status.transportMetrics);
  });

  await test('erro HTTP 404 inclui URL completa (não só path IIS)', async () => {
    const { formatSoapHttpError } = require('../../backend/services/fiscal/core/SoapTransport');
    const msg = formatSoapHttpError({
      url: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
      statusCode: 404,
      rawBody: '<html><body>Requested URL<br>/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx</body></html>'
    });
    assert.ok(msg.includes('HTTP 404'));
    assert.ok(msg.includes('https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'));
    assert.ok(!msg.startsWith('/NFeDistribuicaoDFe'));
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
