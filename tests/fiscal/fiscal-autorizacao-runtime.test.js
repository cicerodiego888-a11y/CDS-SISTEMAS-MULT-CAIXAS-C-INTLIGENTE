/**
 * Testes — Autorização NFC-e runtime (Sprint F10 / RC1)
 * Sem HTTP real.
 *
 * Executar: npm run test:fiscal-autorizacao-runtime
 *           node tests/fiscal/fiscal-autorizacao-runtime.test.js
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
  ENABLED_OPERATIONS
} = require('../../backend/services/fiscal/core');
const {
  createAutorizacaoRuntime,
  AutorizacaoMetrics,
  montarEnvelopeAutorizacao,
  classificarResultado,
  extrairCStatAutorizacao
} = require('../../backend/services/fiscal/autorizacaoRuntime');
const {
  enviarAutorizacaoLegado,
  getAutorizacaoUrl,
  NS_AUTORIZACAO,
  ACTION_AUTORIZACAO
} = require('../../backend/services/fiscal/autorizacaoLegado');

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

const LOTE_MIN =
  `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<idLote>1</idLote><indSinc>1</indSinc>` +
  `</enviNFe>`;

const SOAP_OK = `
<soap:Envelope>
  <soap:Body>
    <retEnviNFe>
      <cStat>104</cStat>
      <xMotivo>Lote processado</xMotivo>
      <protNFe>
        <infProt>
          <cStat>100</cStat>
          <xMotivo>Autorizado o uso da NF-e</xMotivo>
          <nProt>123456789012345</nProt>
          <chNFe>23260112345678000199650010000000011000000001</chNFe>
        </infProt>
      </protNFe>
    </retEnviNFe>
  </soap:Body>
</soap:Envelope>`;

const SOAP_LOTE_REJEITADO = `
<soap:Envelope>
  <soap:Body>
    <retEnviNFe>
      <cStat>215</cStat>
      <xMotivo>Falha no schema XML</xMotivo>
    </retEnviNFe>
  </soap:Body>
</soap:Envelope>`;

const SOAP_DUPLICADO = `
<soap:Envelope>
  <soap:Body>
    <retEnviNFe>
      <cStat>104</cStat>
      <xMotivo>Lote processado</xMotivo>
      <protNFe>
        <infProt>
          <cStat>539</cStat>
          <xMotivo>Duplicidade de NF-e [chNFe:23260112345678000199650010000000011000000001]</xMotivo>
        </infProt>
      </protNFe>
    </retEnviNFe>
  </soap:Body>
</soap:Envelope>`;

async function main() {
  console.log('\n=== Testes Autorização Runtime — Sprint F10 / RC1 ===\n');

  await test('TransportEnablement inclui AUTORIZACAO e RETORNO_AUTORIZACAO', async () => {
    assert.ok(ENABLED_OPERATIONS.includes(OperationType.AUTORIZACAO));
    assert.ok(ENABLED_OPERATIONS.includes(OperationType.RETORNO_AUTORIZACAO));
    const transport = new SoapTransport();
    assert.strictEqual(transport.isEnabled(OperationType.AUTORIZACAO), true);
    assert.strictEqual(transport.isEnabled(OperationType.RETORNO_AUTORIZACAO), true);
    assert.strictEqual(transport.isEnabled(OperationType.INUTILIZACAO), false);
  });

  await test('Registry resolve Autorização NFC-e', async () => {
    const platform = new FiscalWebServices();
    const result = platform.resolve({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.HOMOLOGACAO,
      uf: UF_SVRS,
      versao: '4.00'
    });
    assert.strictEqual(result.success, true);
    assert.ok(result.definition.endpoint.includes('NfeAutorizacao'));
    assert.strictEqual(result.definition.namespace, NS_AUTORIZACAO);
    assert.strictEqual(result.definition.soapAction, ACTION_AUTORIZACAO);
  });

  await test('montarEnvelopeAutorizacao contém NFeAutorizacao4', async () => {
    const xml = montarEnvelopeAutorizacao({ loteXml: LOTE_MIN, cUF: '23' });
    assert.ok(xml.includes(NS_AUTORIZACAO));
    assert.ok(xml.includes('enviNFe'));
    assert.ok(xml.includes('nfeDadosMsg'));
  });

  await test('autorização OK (cStat 100)', async () => {
    const metrics = new AutorizacaoMetrics();
    const runtime = createAutorizacaoRuntime({
      platform: new FiscalWebServices({
        transportOptions: {
          httpClient: async () => ({ statusCode: 200, body: SOAP_OK })
        }
      }),
      metrics
    });

    const result = await runtime.enviarAutorizacao({
      loteXml: LOTE_MIN,
      ambiente: 2,
      certificadoPath: 'fake.pfx',
      certificadoSenha: 'x'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, 'PLATFORM');
    assert.strictEqual(result.cStat, '100');
    assert.strictEqual(result.resultado, 'AUTORIZADO');
    assert.strictEqual(classificarResultado('100'), 'AUTORIZADO');
    assert.ok(result.endpoint);
    assert.ok(result.namespace);
    assert.ok(result.versao);
    assert.ok(result.tempoResolverMs >= 0);
    assert.ok(result.tempoTransporteMs >= 0);
    assert.ok(result.tempoXmlMs >= 0);
    assert.ok(result.tempoTotalMs >= 0);
    assert.strictEqual(result.fallbackUtilizado, false);

    const snap = metrics.snapshot();
    assert.strictEqual(snap.quantidadeAutorizacoes, 1);
    assert.strictEqual(snap.sucessos, 1);
    assert.strictEqual(snap.falhas, 0);
    console.log(`         tempo médio plataforma: ${snap.tempoMedioPlataformaMs.toFixed(4)} ms`);
  });

  await test('lote rejeitado (cStat 215)', async () => {
    const runtime = createAutorizacaoRuntime({
      platform: new FiscalWebServices({
        transportOptions: {
          httpClient: async () => ({ statusCode: 200, body: SOAP_LOTE_REJEITADO })
        }
      }),
      metrics: new AutorizacaoMetrics()
    });
    const result = await runtime.enviarAutorizacao({ loteXml: LOTE_MIN, ambiente: 2 });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.cStat, '215');
    assert.strictEqual(result.resultado, 'LOTE_REJEITADO');
    assert.strictEqual(extrairCStatAutorizacao(SOAP_LOTE_REJEITADO), '215');
  });

  await test('lote duplicado (cStat 539)', async () => {
    const runtime = createAutorizacaoRuntime({
      platform: new FiscalWebServices({
        transportOptions: {
          httpClient: async () => ({ statusCode: 200, body: SOAP_DUPLICADO })
        }
      }),
      metrics: new AutorizacaoMetrics()
    });
    const result = await runtime.enviarAutorizacao({ loteXml: LOTE_MIN, ambiente: 2 });
    assert.strictEqual(result.cStat, '539');
    assert.strictEqual(result.resultado, 'DUPLICADO');
  });

  await test('resolver fail usa fallback', async () => {
    const platform = new FiscalWebServices({ loadOfficialCatalog: false });
    const runtime = createAutorizacaoRuntime({
      platform,
      metrics: new AutorizacaoMetrics(),
      legadoSender: async ({ url }) => ({
        success: true,
        body: SOAP_OK,
        raw: SOAP_OK,
        status: 'soap_enviado',
        statusCode: 200,
        endpoint: url,
        namespace: NS_AUTORIZACAO,
        tempoXmlMs: 0.1,
        tempoSoapMs: 0.1,
        tempo: 0.2
      })
    });
    const result = await runtime.enviarAutorizacao({ loteXml: LOTE_MIN, ambiente: 1 });
    assert.strictEqual(result.fallbackUtilizado, true);
    assert.strictEqual(result.source, ResolutionSource.FALLBACK);
    assert.ok(result.warnings.some((w) => w.code === 'PLATFORM_RESOLVE_FAILED'));
  });

  await test('transport fail dispara fallback', async () => {
    const metrics = new AutorizacaoMetrics();
    const runtime = createAutorizacaoRuntime({
      platform: new FiscalWebServices({
        transportOptions: {
          httpClient: async () => {
            throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
          },
          maxRetries: 0
        }
      }),
      metrics,
      legadoSender: async () => ({
        success: true,
        body: SOAP_OK,
        raw: SOAP_OK,
        status: 'soap_enviado',
        statusCode: 200,
        endpoint: getAutorizacaoUrl(2),
        namespace: NS_AUTORIZACAO,
        tempoXmlMs: 0.1,
        tempoSoapMs: 0.2,
        tempo: 0.3
      })
    });
    const result = await runtime.enviarAutorizacao({ loteXml: LOTE_MIN, ambiente: 2 });
    assert.strictEqual(result.source, ResolutionSource.FALLBACK);
    assert.ok(result.warnings.some((w) => w.code === 'PLATFORM_TRANSPORT_FAILED'));
    assert.strictEqual(metrics.snapshot().fallbacks, 1);
  });

  await test('timeout dispara fallback legado', async () => {
    const metrics = new AutorizacaoMetrics();
    const runtime = createAutorizacaoRuntime({
      platform: new FiscalWebServices({
        transportOptions: {
          httpClient: async () => {
            throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
          },
          maxRetries: 0
        }
      }),
      metrics,
      legadoSender: async () => ({
        success: true,
        body: SOAP_OK,
        raw: SOAP_OK,
        statusCode: 200,
        endpoint: getAutorizacaoUrl(2),
        namespace: NS_AUTORIZACAO,
        tempoXmlMs: 0.1,
        tempoSoapMs: 0.2,
        tempo: 0.3
      })
    });
    const result = await runtime.enviarAutorizacao({ loteXml: LOTE_MIN, ambiente: 2 });
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
    const metrics = new AutorizacaoMetrics();
    const runtime = createAutorizacaoRuntime({
      platform: new FiscalWebServices({
        transportOptions: { httpClient, maxRetries: 2 }
      }),
      metrics
    });
    const result = await runtime.enviarAutorizacao({ loteXml: LOTE_MIN, ambiente: 2 });
    assert.strictEqual(result.success, true);
    assert.ok(result.retries >= 1);
    assert.ok(calls >= 2);
    assert.ok(metrics.snapshot().retries >= 1);
  });

  await test('legado direto com httpClient', async () => {
    const result = await enviarAutorizacaoLegado({
      ambiente: 2,
      loteXml: LOTE_MIN,
      httpClient: async () => ({ statusCode: 200, body: SOAP_OK })
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.namespace, NS_AUTORIZACAO);
    assert.ok(result.endpoint.includes('NfeAutorizacao'));
  });

  await test('FiscalWebServices F10 inclui Autorização', async () => {
    const platform = new FiscalWebServices();
    assert.strictEqual(platform.getVersion(), 'F10-autorizacao');
    assert.strictEqual(platform.isActiveFor(OperationType.AUTORIZACAO), true);
    assert.strictEqual(platform.isActiveFor(OperationType.RETORNO_AUTORIZACAO), true);
    assert.strictEqual(platform.isActiveFor(OperationType.INUTILIZACAO), false);
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
