/**
 * Testes — Consulta Protocolo runtime (Sprint F8)
 * Sem HTTP real.
 *
 * Executar: npm run test:fiscal-consulta-runtime
 *           node tests/fiscal/fiscal-consulta-runtime.test.js
 */

const assert = require('assert');
const {
  FiscalWebServices,
  SoapTransport,
  OperationType,
  ModelType,
  EnvironmentType,
  ResolutionSource,
  UF_SVRS,
  ENABLED_OPERATIONS,
  OFFICIAL_SERVICE_COUNT
} = require('../../backend/services/fiscal/core');
const {
  createConsultaProtocoloRuntime,
  ConsultaProtocoloMetrics,
  montarEnvelopeConsultaProtocolo,
  extrairCStat
} = require('../../backend/services/fiscal/consultaProtocoloRuntime');
const {
  enviarConsultaProtocoloLegado,
  getConsultaProtocoloUrl,
  NS_CONSULTA,
  ACTION_CONSULTA
} = require('../../backend/services/fiscal/consultaProtocoloLegado');

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

const CHAVE_OK = '23260112345678000199650010000000011000000001';

const SOAP_OK = `
<soap:Envelope>
  <soap:Body>
    <retConsSitNFe>
      <tpAmb>2</tpAmb>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da NF-e</xMotivo>
      <chNFe>${CHAVE_OK}</chNFe>
    </retConsSitNFe>
  </soap:Body>
</soap:Envelope>`;

const SOAP_INEXISTENTE = `
<soap:Envelope>
  <soap:Body>
    <retConsSitNFe>
      <tpAmb>2</tpAmb>
      <cStat>217</cStat>
      <xMotivo>NF-e inexistente na base de dados da SEFAZ</xMotivo>
    </retConsSitNFe>
  </soap:Body>
</soap:Envelope>`;

async function main() {
  console.log('\n=== Testes Consulta Protocolo Runtime — Sprint F8 ===\n');

  await test('TransportEnablement inclui CONSULTA_PROTOCOLO', async () => {
    assert.ok(ENABLED_OPERATIONS.includes(OperationType.CONSULTA_PROTOCOLO));
    const transport = new SoapTransport();
    assert.strictEqual(transport.isEnabled(OperationType.CONSULTA_PROTOCOLO), true);
    assert.strictEqual(transport.isEnabled(OperationType.AUTORIZACAO), true);
  });

  await test('Registry resolve Consulta Protocolo NFC-e e NF-e', async () => {
    const platform = new FiscalWebServices();
    assert.strictEqual(platform.getRegistry().size(), OFFICIAL_SERVICE_COUNT);

    for (const modelo of [ModelType.NFCE, ModelType.NFE]) {
      const result = platform.resolve({
        modelo,
        operacao: OperationType.CONSULTA_PROTOCOLO,
        ambiente: EnvironmentType.HOMOLOGACAO,
        uf: UF_SVRS,
        versao: '4.00'
      });
      assert.strictEqual(result.success, true, modelo);
      assert.ok(result.definition.endpoint.includes('NfeConsulta'));
      assert.strictEqual(result.definition.namespace, NS_CONSULTA);
      assert.strictEqual(result.definition.soapAction, ACTION_CONSULTA);
    }
  });

  await test('montarEnvelopeConsultaProtocolo contém consSitNFe', async () => {
    const xml = montarEnvelopeConsultaProtocolo({
      tpAmb: 2,
      chave: CHAVE_OK,
      cUF: '23'
    });
    assert.ok(xml.includes('consSitNFe'));
    assert.ok(xml.includes(CHAVE_OK));
    assert.ok(xml.includes('CONSULTAR'));
    assert.ok(xml.includes(NS_CONSULTA));
  });

  await test('consulta válida via plataforma', async () => {
    const httpClient = async () => ({ statusCode: 200, body: SOAP_OK, headers: {} });
    const metrics = new ConsultaProtocoloMetrics();
    const runtime = createConsultaProtocoloRuntime({
      platform: new FiscalWebServices({ transportOptions: { httpClient } }),
      metrics
    });

    const result = await runtime.consultarProtocolo({
      chave: CHAVE_OK,
      ambiente: 2,
      certificadoPath: 'fake.pfx',
      certificadoSenha: 'x'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, 'PLATFORM');
    assert.strictEqual(result.fallbackUtilizado, false);
    assert.strictEqual(result.cStat, '100');
    assert.ok(result.tempoResolverMs >= 0);
    assert.ok(result.tempoTransporteMs >= 0);
    assert.ok(result.tempoXmlMs >= 0);
    assert.ok(result.tempoSoapMs >= 0);
    assert.ok(result.tempoTotalMs >= 0);
    assert.strictEqual(result.namespace, NS_CONSULTA);

    const snap = metrics.snapshot();
    assert.strictEqual(snap.sucessosPlataforma, 1);
    assert.strictEqual(snap.fallbacks, 0);
    console.log(`         tempo médio plataforma: ${snap.tempoMedioPlataformaMs.toFixed(4)} ms`);
  });

  await test('consulta inexistente (cStat 217) ainda é sucesso de transporte', async () => {
    const runtime = createConsultaProtocoloRuntime({
      platform: new FiscalWebServices({
        transportOptions: {
          httpClient: async () => ({ statusCode: 200, body: SOAP_INEXISTENTE })
        }
      }),
      metrics: new ConsultaProtocoloMetrics()
    });
    const result = await runtime.consultarProtocolo({
      chave: '0'.repeat(44),
      ambiente: 2
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, 'PLATFORM');
    assert.strictEqual(result.cStat, '217');
    assert.ok(/inexistente/i.test(result.xMotivo || ''));
    assert.strictEqual(extrairCStat(SOAP_INEXISTENTE), '217');
  });

  await test('resolver fail usa fallback', async () => {
    const platform = new FiscalWebServices({ loadOfficialCatalog: false });
    const runtime = createConsultaProtocoloRuntime({
      platform,
      metrics: new ConsultaProtocoloMetrics(),
      legadoSender: async ({ url }) => ({
        success: true,
        body: SOAP_OK,
        statusCode: 200,
        endpoint: url,
        namespace: NS_CONSULTA,
        tempoXmlMs: 0.1,
        tempoSoapMs: 0.1,
        tempo: 0.2
      })
    });
    const result = await runtime.consultarProtocolo({
      chave: CHAVE_OK,
      ambiente: 1
    });
    assert.strictEqual(result.fallbackUtilizado, true);
    assert.strictEqual(result.source, ResolutionSource.FALLBACK);
    assert.ok(result.warnings.some((w) => w.code === 'PLATFORM_RESOLVE_FAILED'));
  });

  await test('transport fail dispara fallback', async () => {
    const httpClient = async () => {
      throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    };
    const metrics = new ConsultaProtocoloMetrics();
    const runtime = createConsultaProtocoloRuntime({
      platform: new FiscalWebServices({
        transportOptions: { httpClient, maxRetries: 0 }
      }),
      metrics,
      legadoSender: async () => ({
        success: true,
        body: SOAP_OK,
        statusCode: 200,
        endpoint: getConsultaProtocoloUrl(2),
        namespace: NS_CONSULTA,
        tempoXmlMs: 0.1,
        tempoSoapMs: 0.2,
        tempo: 0.3
      })
    });

    const result = await runtime.consultarProtocolo({ chave: CHAVE_OK, ambiente: 2 });
    assert.strictEqual(result.source, ResolutionSource.FALLBACK);
    assert.ok(result.warnings.some((w) => w.code === 'PLATFORM_TRANSPORT_FAILED'));
    assert.strictEqual(metrics.snapshot().fallbacks, 1);
  });

  await test('timeout dispara fallback legado', async () => {
    const httpClient = async () => {
      throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    };
    const metrics = new ConsultaProtocoloMetrics();
    const runtime = createConsultaProtocoloRuntime({
      platform: new FiscalWebServices({
        transportOptions: { httpClient, maxRetries: 0 }
      }),
      metrics,
      legadoSender: async () => ({
        success: true,
        body: SOAP_OK,
        statusCode: 200,
        endpoint: getConsultaProtocoloUrl(2),
        namespace: NS_CONSULTA,
        tempoXmlMs: 0.1,
        tempoSoapMs: 0.2,
        tempo: 0.3
      })
    });

    const result = await runtime.consultarProtocolo({ chave: CHAVE_OK, ambiente: 2 });
    assert.strictEqual(result.fallbackUtilizado, true);
    assert.ok(result.warnings.some((w) => w.code === 'FALLBACK'));
    console.log(`         fallbacks: ${metrics.snapshot().fallbacks}`);
  });

  await test('retry contabilizado em transport com maxRetries', async () => {
    let calls = 0;
    const httpClient = async () => {
      calls += 1;
      if (calls < 2) {
        throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
      }
      return { statusCode: 200, body: SOAP_OK, headers: {} };
    };
    const metrics = new ConsultaProtocoloMetrics();
    const runtime = createConsultaProtocoloRuntime({
      platform: new FiscalWebServices({
        transportOptions: { httpClient, maxRetries: 2 }
      }),
      metrics
    });
    const result = await runtime.consultarProtocolo({ chave: CHAVE_OK, ambiente: 2 });
    assert.strictEqual(result.success, true);
    assert.ok(result.retries >= 1);
    assert.ok(calls >= 2);
    assert.ok(metrics.snapshot().retries >= 1);
  });

  await test('legado direto com httpClient', async () => {
    const result = await enviarConsultaProtocoloLegado({
      ambiente: 2,
      chave: CHAVE_OK,
      httpClient: async () => ({ statusCode: 200, body: SOAP_OK })
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.namespace, NS_CONSULTA);
  });

  await test('FiscalWebServices F10 inclui Consulta Protocolo + Autorização', async () => {
    const platform = new FiscalWebServices();
    assert.strictEqual(platform.getVersion(), 'F10-autorizacao');
    assert.strictEqual(platform.isActiveFor(OperationType.CONSULTA_PROTOCOLO), true);
    assert.strictEqual(platform.isActiveFor(OperationType.AUTORIZACAO), true);
  });

  await test('inutilização continua fora', async () => {
    const transport = new SoapTransport({
      httpClient: async () => ({ statusCode: 200, body: 'ok' })
    });
    const response = await transport.send({
      url: 'https://exemplo.local',
      envelope: '<soap/>',
      operacao: OperationType.INUTILIZACAO
    });
    assert.strictEqual(response.status, 'not_implemented');
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
