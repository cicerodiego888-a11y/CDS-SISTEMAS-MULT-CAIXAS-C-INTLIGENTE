/**
 * Testes — Distribuição DF-e runtime (Sprint F6)
 * Sem acesso HTTP real (httpClient injetado).
 *
 * Executar: npm run test:fiscal-dfe-runtime
 *           node tests/fiscal/fiscal-dfe-runtime.test.js
 */

const assert = require('assert');
const {
  FiscalWebServices,
  SoapTransport,
  OperationType,
  ModelType,
  EnvironmentType,
  ResolutionSource,
  UF_AN,
  ENABLED_OPERATIONS
} = require('../../backend/services/fiscal/core');
const {
  createDistribuicaoDfeRuntime,
  DistribuicaoDfeMetrics,
  getDfeUrl
} = require('../../backend/services/fiscal/distribuicaoDfeRuntime');
const {
  enviarDistribuicaoDfeLegado,
  NS_DFE
} = require('../../backend/services/fiscal/distribuicaoDfeLegado');
const { montarXmlDistNsu } = require('../../backend/services/fiscal/distribuicaoDFe');

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
    <retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe">
      <cStat>138</cStat>
      <xMotivo>Documento localizado</xMotivo>
      <ultNSU>000000000000001</ultNSU>
      <maxNSU>000000000000001</maxNSU>
    </retDistDFeInt>
  </soap:Body>
</soap:Envelope>`;

const SOAP_INVALID = `<soap:Envelope><soap:Body><retDistDFeInt><cStat>999</cStat></retDistDFeInt></soap:Body></soap:Envelope>`;

const XML_CONSULTA = montarXmlDistNsu({
  ambiente: 2,
  codigoUf: '23',
  cnpj: '65957340000150',
  ultNsu: '0'
});

async function main() {
  console.log('\n=== Testes Distribuição DF-e Runtime — Sprint F6 ===\n');

  await test('TransportEnablement inclui DISTRIBUICAO_DFE', async () => {
    assert.ok(ENABLED_OPERATIONS.includes(OperationType.DISTRIBUICAO_DFE));
    assert.ok(ENABLED_OPERATIONS.includes(OperationType.STATUS_SERVICO));
    const transport = new SoapTransport();
    assert.strictEqual(transport.isEnabled(OperationType.DISTRIBUICAO_DFE), true);
    assert.strictEqual(transport.isEnabled(OperationType.AUTORIZACAO), true);
  });

  await test('Registry resolve DISTRIBUICAO_DFE AN', async () => {
    const platform = new FiscalWebServices();
    const result = platform.resolve({
      modelo: ModelType.NFE,
      operacao: OperationType.DISTRIBUICAO_DFE,
      ambiente: EnvironmentType.HOMOLOGACAO,
      uf: UF_AN,
      versao: '1.01'
    });
    assert.strictEqual(result.success, true);
    assert.ok(result.definition.endpoint.includes('hom1.nfe.fazenda.gov.br'));
    assert.strictEqual(result.definition.namespace, NS_DFE);
  });

  await test('sucesso Plataforma via httpClient (sem HTTP real)', async () => {
    const httpClient = async () => ({ statusCode: 200, body: SOAP_OK, headers: {} });
    const metrics = new DistribuicaoDfeMetrics();
    const runtime = createDistribuicaoDfeRuntime({
      platform: new FiscalWebServices({ transportOptions: { httpClient } }),
      metrics
    });

    const result = await runtime.enviarDistribuicaoDfe({
      xmlConsulta: XML_CONSULTA,
      ambiente: 2,
      certificadoPath: 'fake.pfx',
      certificadoSenha: 'x'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, 'PLATFORM');
    assert.strictEqual(result.fallbackUtilizado, false);
    assert.ok(result.endpoint.includes('NFeDistribuicaoDFe'));
    assert.ok(result.namespace.includes('NFeDistribuicaoDFe'));
    assert.ok(result.tempoResolverMs >= 0);
    assert.ok(result.tempoTransporteMs >= 0);
    assert.ok(result.tempoXmlMs >= 0);
    assert.ok(result.body.includes('cStat'));

    const snap = metrics.snapshot();
    assert.strictEqual(snap.sucessosPlataforma, 1);
    assert.strictEqual(snap.fallbacks, 0);
    console.log(`         tempo médio plataforma: ${snap.tempoMedioPlataformaMs.toFixed(4)} ms`);
  });

  await test('resposta válida contém cStat 138', async () => {
    const runtime = createDistribuicaoDfeRuntime({
      platform: new FiscalWebServices({
        transportOptions: {
          httpClient: async () => ({ statusCode: 200, body: SOAP_OK })
        }
      }),
      metrics: new DistribuicaoDfeMetrics()
    });
    const result = await runtime.enviarDistribuicaoDfe({
      xmlConsulta: XML_CONSULTA,
      ambiente: 2
    });
    assert.ok(result.body.includes('>138<'));
  });

  await test('SOAP inválido ainda retorna body (cStat 999)', async () => {
    const runtime = createDistribuicaoDfeRuntime({
      platform: new FiscalWebServices({
        transportOptions: {
          httpClient: async () => ({ statusCode: 200, body: SOAP_INVALID })
        }
      }),
      metrics: new DistribuicaoDfeMetrics()
    });
    const result = await runtime.enviarDistribuicaoDfe({
      xmlConsulta: XML_CONSULTA,
      ambiente: 2
    });
    assert.strictEqual(result.success, true);
    assert.ok(result.body.includes('999'));
  });

  await test('timeout no transport dispara fallback legado', async () => {
    const httpClient = async () => {
      throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    };
    const legadoSender = async () => ({
      success: true,
      body: SOAP_OK,
      statusCode: 200,
      endpoint: getDfeUrl(2),
      namespace: NS_DFE,
      tempoXmlMs: 0.1,
      tempoSoapMs: 0.2,
      tempo: 0.3
    });
    const metrics = new DistribuicaoDfeMetrics();
    const runtime = createDistribuicaoDfeRuntime({
      platform: new FiscalWebServices({
        transportOptions: { httpClient, maxRetries: 0 }
      }),
      metrics,
      legadoSender
    });

    const result = await runtime.enviarDistribuicaoDfe({
      xmlConsulta: XML_CONSULTA,
      ambiente: 2
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, ResolutionSource.FALLBACK);
    assert.strictEqual(result.fallbackUtilizado, true);
    assert.ok(result.warnings.some((w) => w.code === 'FALLBACK'));

    const snap = metrics.snapshot();
    assert.strictEqual(snap.fallbacks, 1);
    assert.strictEqual(snap.sucessosLegado, 1);
    console.log(`         fallbacks: ${snap.fallbacks}`);
  });

  await test('resolve fail usa fallback', async () => {
    const platform = new FiscalWebServices({ loadOfficialCatalog: false });
    const legadoSender = async ({ url }) => {
      assert.ok(url.includes('NFeDistribuicaoDFe'));
      return {
        success: true,
        body: SOAP_OK,
        statusCode: 200,
        endpoint: url,
        namespace: NS_DFE,
        tempoXmlMs: 0.1,
        tempoSoapMs: 0.1,
        tempo: 0.2
      };
    };
    const metrics = new DistribuicaoDfeMetrics();
    const runtime = createDistribuicaoDfeRuntime({ platform, metrics, legadoSender });
    const result = await runtime.enviarDistribuicaoDfe({
      xmlConsulta: XML_CONSULTA,
      ambiente: 1
    });
    assert.strictEqual(result.fallbackUtilizado, true);
    assert.ok(result.warnings.some((w) => w.code === 'PLATFORM_RESOLVE_FAILED'));
  });

  await test('transport fail + legado fail', async () => {
    const runtime = createDistribuicaoDfeRuntime({
      platform: new FiscalWebServices({
        transportOptions: {
          httpClient: async () => {
            throw Object.assign(new Error('fail'), { code: 'NETWORK_ERROR' });
          },
          maxRetries: 0
        }
      }),
      metrics: new DistribuicaoDfeMetrics(),
      legadoSender: async () => ({
        success: false,
        body: null,
        message: 'legado down',
        tempoXmlMs: 0,
        tempoSoapMs: 0,
        tempo: 0.1
      })
    });
    const result = await runtime.enviarDistribuicaoDfe({
      xmlConsulta: XML_CONSULTA,
      ambiente: 2
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.fallbackUtilizado, true);
  });

  await test('sucesso Legado direto (httpClient legado)', async () => {
    const result = await enviarDistribuicaoDfeLegado({
      xmlConsulta: XML_CONSULTA,
      ambiente: 2,
      httpClient: async () => ({ statusCode: 200, body: SOAP_OK })
    });
    assert.strictEqual(result.success, true);
    assert.ok(result.endpoint.includes('hom1.nfe.fazenda.gov.br'));
  });

  await test('inutilização continua fora da plataforma', async () => {
    const transport = new SoapTransport({
      httpClient: async () => ({ statusCode: 200, body: 'ok' })
    });
    const response = await transport.send({
      url: 'https://exemplo.local/auth',
      envelope: '<soap/>',
      operacao: OperationType.INUTILIZACAO
    });
    assert.strictEqual(response.status, 'not_implemented');
  });

  await test('FiscalWebServices F10 ativa Status + DF-e + Manifestação + Autorização', async () => {
    const platform = new FiscalWebServices();
    assert.strictEqual(platform.getVersion(), 'F10-autorizacao');
    assert.strictEqual(platform.isActiveFor(OperationType.DISTRIBUICAO_DFE), true);
    assert.strictEqual(platform.isActiveFor(OperationType.STATUS_SERVICO), true);
    assert.strictEqual(platform.isActiveFor(OperationType.CANCELAMENTO), true);
    assert.strictEqual(platform.isActiveFor(OperationType.AUTORIZACAO), true);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
