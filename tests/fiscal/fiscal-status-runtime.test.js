/**
 * Testes — Status Serviço runtime (Sprint F5)
 * Sem acesso HTTP real (httpClient injetado).
 *
 * Executar: npm run test:fiscal-status-runtime
 *           node tests/fiscal/fiscal-status-runtime.test.js
 */

const assert = require('assert');
const {
  FiscalWebServices,
  SoapTransport,
  OperationType,
  ModelType,
  EnvironmentType,
  ResolutionSource,
  UF_SVRS
} = require('../../backend/services/fiscal/core');
const {
  createStatusServicoRuntime,
  montarEnvelopeStatusServico,
  extrairCStat,
  StatusServicoMetrics
} = require('../../backend/services/fiscal/statusServico');
const {
  enviarStatusServicoLegado
} = require('../../backend/services/fiscal/statusServicoLegado');

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

const SOAP_OK = `
<soap:Envelope>
  <soap:Body>
    <retConsStatServ>
      <cStat>107</cStat>
      <xMotivo>Servico em Operacao</xMotivo>
    </retConsStatServ>
  </soap:Body>
</soap:Envelope>`;

const SOAP_INVALID = `
<soap:Envelope>
  <soap:Body>
    <retConsStatServ>
      <cStat>999</cStat>
      <xMotivo>Erro</xMotivo>
    </retConsStatServ>
  </soap:Body>
</soap:Envelope>`;

async function main() {
  console.log('\n=== Testes Status Serviço Runtime — Sprint F5 ===\n');

  await test('montarEnvelopeStatusServico contém consStatServ', async () => {
    const xml = montarEnvelopeStatusServico({ tpAmb: 2, cUF: '23' });
    assert.ok(xml.includes('consStatServ'));
    assert.ok(xml.includes('NFeStatusServico4'));
    assert.ok(xml.includes('<xServ>STATUS</xServ>'));
  });

  await test('extrairCStat lê retorno', async () => {
    assert.strictEqual(extrairCStat(SOAP_OK), '107');
    assert.strictEqual(extrairCStat(null), null);
  });

  await test('Registry resolve STATUS_SERVICO', async () => {
    const platform = new FiscalWebServices();
    const result = platform.resolve({
      modelo: ModelType.NFCE,
      operacao: OperationType.STATUS_SERVICO,
      ambiente: EnvironmentType.HOMOLOGACAO,
      uf: UF_SVRS,
      versao: '4.00'
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, ResolutionSource.REGISTRY);
    assert.ok(result.definition.endpoint.includes('NfeStatusServico'));
  });

  await test('SoapTransport habilitado para STATUS_SERVICO e AUTORIZACAO', async () => {
    const transport = new SoapTransport();
    assert.strictEqual(transport.isEnabled(), false);
    assert.strictEqual(transport.isEnabled(OperationType.STATUS_SERVICO), true);
    assert.strictEqual(transport.isEnabled(OperationType.AUTORIZACAO), true);
  });

  await test('Transport sucesso via httpClient injetado (sem HTTP real)', async () => {
    const httpClient = async () => ({
      statusCode: 200,
      body: SOAP_OK,
      headers: {}
    });
    const platform = new FiscalWebServices({
      transportOptions: { httpClient }
    });
    const metrics = new StatusServicoMetrics();
    const runtime = createStatusServicoRuntime({ platform, metrics });

    const result = await runtime.consultarStatusServico({
      ambiente: 2,
      certificadoPath: 'fake.pfx',
      certificadoSenha: 'x'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, 'PLATFORM');
    assert.strictEqual(result.fallbackUtilizado, false);
    assert.strictEqual(result.cStat, '107');
    assert.ok(result.tempoResolverMs >= 0);
    assert.ok(result.tempoTransporteMs >= 0);
    assert.ok(result.endpoint.includes('StatusServico'));

    const snap = metrics.snapshot();
    assert.strictEqual(snap.sucessosPlataforma, 1);
    assert.strictEqual(snap.fallbacks, 0);
  });

  await test('resposta inválida ainda retorna body (cStat 999)', async () => {
    const httpClient = async () => ({
      statusCode: 200,
      body: SOAP_INVALID,
      headers: {}
    });
    const runtime = createStatusServicoRuntime({
      platform: new FiscalWebServices({ transportOptions: { httpClient } }),
      metrics: new StatusServicoMetrics()
    });
    const result = await runtime.consultarStatusServico({ ambiente: 2 });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.cStat, '999');
  });

  await test('timeout no transport dispara fallback legado', async () => {
    const httpClient = async () => {
      const err = new Error('timeout');
      err.code = 'ECONNABORTED';
      throw err;
    };
    const legadoSender = async () => ({
      success: true,
      body: SOAP_OK,
      statusCode: 200,
      tempo: 1.2
    });
    const metrics = new StatusServicoMetrics();
    const runtime = createStatusServicoRuntime({
      platform: new FiscalWebServices({
        transportOptions: { httpClient, maxRetries: 0 }
      }),
      metrics,
      legadoSender
    });

    const result = await runtime.consultarStatusServico({ ambiente: 2 });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, ResolutionSource.FALLBACK);
    assert.strictEqual(result.fallbackUtilizado, true);
    assert.ok(result.warnings.some((w) => w.code === 'FALLBACK'));
    assert.ok(result.tempoLegadoMs >= 0);

    const snap = metrics.snapshot();
    assert.strictEqual(snap.fallbacks, 1);
    assert.strictEqual(snap.sucessosLegado, 1);
  });

  await test('resolve falho também usa fallback', async () => {
    const platform = new FiscalWebServices({ loadOfficialCatalog: false });
    const legadoSender = async ({ url }) => {
      assert.ok(url.includes('StatusServico'));
      return { success: true, body: SOAP_OK, statusCode: 200, tempo: 0.5 };
    };
    const metrics = new StatusServicoMetrics();
    const runtime = createStatusServicoRuntime({ platform, metrics, legadoSender });
    const result = await runtime.consultarStatusServico({ ambiente: 1 });
    assert.strictEqual(result.fallbackUtilizado, true);
    assert.strictEqual(result.success, true);
    assert.ok(result.warnings.some((w) => w.code === 'PLATFORM_RESOLVE_FAILED'));
  });

  await test('fallback legado falha propaga success=false', async () => {
    const httpClient = async () => {
      throw Object.assign(new Error('fail'), { code: 'NETWORK_ERROR' });
    };
    const legadoSender = async () => ({
      success: false,
      body: null,
      statusCode: null,
      message: 'legado down',
      tempo: 0.1
    });
    const runtime = createStatusServicoRuntime({
      platform: new FiscalWebServices({
        transportOptions: { httpClient, maxRetries: 0 }
      }),
      metrics: new StatusServicoMetrics(),
      legadoSender
    });
    const result = await runtime.consultarStatusServico({ ambiente: 2 });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.fallbackUtilizado, true);
  });

  await test('enviarStatusServicoLegado com httpClient injetado', async () => {
    const result = await enviarStatusServicoLegado({
      url: 'https://exemplo.local/status',
      envelope: '<soap/>',
      httpClient: async () => ({ statusCode: 200, body: SOAP_OK })
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(extrairCStat(result.body), '107');
  });

  await test('FiscalWebServices F5 ativa só Status', async () => {
    const platform = new FiscalWebServices();
    assert.strictEqual(platform.getVersion(), 'F10-autorizacao');
    assert.strictEqual(platform.isActive(), true);
    assert.strictEqual(platform.isActiveFor(OperationType.STATUS_SERVICO), true);
    assert.strictEqual(platform.isActiveFor(OperationType.DISTRIBUICAO_DFE), true);
    assert.strictEqual(platform.isActiveFor(OperationType.AUTORIZACAO), true);
    assert.ok(platform.getActiveOperations().includes(OperationType.STATUS_SERVICO));
    assert.ok(platform.getActiveOperations().includes(OperationType.DISTRIBUICAO_DFE));
  });

  await test('inutilização continua desabilitada no transport', async () => {
    const transport = new SoapTransport({
      httpClient: async () => ({ statusCode: 200, body: 'ok' })
    });
    const response = await transport.send({
      url: 'https://exemplo.local/auth',
      envelope: '<soap/>',
      operacao: OperationType.INUTILIZACAO
    });
    assert.strictEqual(response.success, false);
    assert.strictEqual(response.status, 'not_implemented');
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) {
    const m = new StatusServicoMetrics();
    console.log('fallbacks (amostra):', m.snapshot().fallbacks);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
