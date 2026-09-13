/**
 * Testes — Cancelamento runtime (Sprint F9)
 * Sem HTTP real.
 *
 * Executar: npm run test:fiscal-cancelamento-runtime
 *           node tests/fiscal/fiscal-cancelamento-runtime.test.js
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
  createCancelamentoRuntime,
  CancelamentoMetrics,
  montarEnvelopeCancelamento,
  classificarResultado,
  TP_EVENTO_CANCELAMENTO
} = require('../../backend/services/fiscal/cancelamentoRuntime');
const {
  enviarCancelamentoLegado,
  getCancelamentoUrl,
  NS_EVENTO,
  ACTION_EVENTO
} = require('../../backend/services/fiscal/cancelamentoLegado');

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

const CHAVE = '23260112345678000199650010000000011000000001';

const SOAP_AUTORIZADO = `
<soap:Envelope>
  <soap:Body>
    <retEnvEvento>
      <cStat>128</cStat>
      <retEvento>
        <infEvento>
          <tpEvento>110111</tpEvento>
          <cStat>135</cStat>
          <xMotivo>Evento registrado e vinculado a NF-e</xMotivo>
        </infEvento>
      </retEvento>
    </retEnvEvento>
  </soap:Body>
</soap:Envelope>`;

const SOAP_REJEITADO = `
<soap:Envelope>
  <soap:Body>
    <retEnvEvento>
      <cStat>128</cStat>
      <retEvento>
        <infEvento>
          <tpEvento>110111</tpEvento>
          <cStat>501</cStat>
          <xMotivo>Prazo de cancelamento superior ao previsto na legislacao</xMotivo>
        </infEvento>
      </retEvento>
    </retEnvEvento>
  </soap:Body>
</soap:Envelope>`;

const SOAP_DUPLICADO = `
<soap:Envelope>
  <soap:Body>
    <retEnvEvento>
      <cStat>128</cStat>
      <retEvento>
        <infEvento>
          <tpEvento>110111</tpEvento>
          <cStat>573</cStat>
          <xMotivo>Duplicidade de Evento</xMotivo>
        </infEvento>
      </retEvento>
    </retEnvEvento>
  </soap:Body>
</soap:Envelope>`;

async function main() {
  console.log('\n=== Testes Cancelamento Runtime — Sprint F9 ===\n');

  await test('TransportEnablement inclui CANCELAMENTO', async () => {
    assert.ok(ENABLED_OPERATIONS.includes(OperationType.CANCELAMENTO));
    const transport = new SoapTransport();
    assert.strictEqual(transport.isEnabled(OperationType.CANCELAMENTO), true);
    assert.strictEqual(transport.isEnabled(OperationType.AUTORIZACAO), true);
  });

  await test('Registry resolve Cancelamento NFC-e', async () => {
    const platform = new FiscalWebServices();
    const result = platform.resolve({
      modelo: ModelType.NFCE,
      operacao: OperationType.CANCELAMENTO,
      ambiente: EnvironmentType.HOMOLOGACAO,
      uf: UF_SVRS,
      versao: '1.00'
    });
    assert.strictEqual(result.success, true);
    assert.ok(result.definition.endpoint.includes('recepcaoevento'));
    assert.strictEqual(result.definition.namespace, NS_EVENTO);
    assert.strictEqual(result.definition.soapAction, ACTION_EVENTO);
  });

  await test('montarEnvelopeCancelamento contém tpEvento 110111', async () => {
    const xml = montarEnvelopeCancelamento({
      chave: CHAVE,
      protocolo: '123456789012345',
      xJust: 'Erro de digitacao no valor'
    });
    assert.ok(xml.includes(TP_EVENTO_CANCELAMENTO));
    assert.ok(xml.includes('Cancelamento'));
    assert.ok(xml.includes(CHAVE));
    assert.ok(xml.includes(NS_EVENTO));
  });

  await test('cancelamento autorizado (cStat 135)', async () => {
    const metrics = new CancelamentoMetrics();
    const runtime = createCancelamentoRuntime({
      platform: new FiscalWebServices({
        transportOptions: {
          httpClient: async () => ({ statusCode: 200, body: SOAP_AUTORIZADO })
        }
      }),
      metrics
    });

    const result = await runtime.enviarCancelamento({
      chave: CHAVE,
      protocolo: '123',
      ambiente: 2,
      certificadoPath: 'fake.pfx',
      certificadoSenha: 'x'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, 'PLATFORM');
    assert.strictEqual(result.cStat, '135');
    assert.strictEqual(result.resultado, 'AUTORIZADO');
    assert.strictEqual(classificarResultado('135'), 'AUTORIZADO');
    assert.ok(result.tempoResolverMs >= 0);
    assert.ok(result.tempoTransporteMs >= 0);
    assert.ok(result.tempoXmlMs >= 0);
    assert.ok(result.tempoTotalMs >= 0);

    const snap = metrics.snapshot();
    assert.strictEqual(snap.quantidadeCancelamentos, 1);
    assert.strictEqual(snap.sucessos, 1);
    assert.strictEqual(snap.falhas, 0);
    console.log(`         tempo médio plataforma: ${snap.tempoMedioPlataformaMs.toFixed(4)} ms`);
  });

  await test('evento rejeitado (cStat 501)', async () => {
    const runtime = createCancelamentoRuntime({
      platform: new FiscalWebServices({
        transportOptions: {
          httpClient: async () => ({ statusCode: 200, body: SOAP_REJEITADO })
        }
      }),
      metrics: new CancelamentoMetrics()
    });
    const result = await runtime.enviarCancelamento({ chave: CHAVE, ambiente: 2 });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.cStat, '501');
    assert.strictEqual(result.resultado, 'REJEITADO');
  });

  await test('evento duplicado (cStat 573)', async () => {
    const runtime = createCancelamentoRuntime({
      platform: new FiscalWebServices({
        transportOptions: {
          httpClient: async () => ({ statusCode: 200, body: SOAP_DUPLICADO })
        }
      }),
      metrics: new CancelamentoMetrics()
    });
    const result = await runtime.enviarCancelamento({ chave: CHAVE, ambiente: 2 });
    assert.strictEqual(result.cStat, '573');
    assert.strictEqual(result.resultado, 'DUPLICADO');
  });

  await test('resolver fail usa fallback', async () => {
    const platform = new FiscalWebServices({ loadOfficialCatalog: false });
    const runtime = createCancelamentoRuntime({
      platform,
      metrics: new CancelamentoMetrics(),
      legadoSender: async ({ url }) => ({
        success: true,
        body: SOAP_AUTORIZADO,
        statusCode: 200,
        endpoint: url,
        namespace: NS_EVENTO,
        tempoXmlMs: 0.1,
        tempoSoapMs: 0.1,
        tempo: 0.2
      })
    });
    const result = await runtime.enviarCancelamento({ chave: CHAVE, ambiente: 1 });
    assert.strictEqual(result.fallbackUtilizado, true);
    assert.strictEqual(result.source, ResolutionSource.FALLBACK);
    assert.ok(result.warnings.some((w) => w.code === 'PLATFORM_RESOLVE_FAILED'));
  });

  await test('transport fail dispara fallback', async () => {
    const metrics = new CancelamentoMetrics();
    const runtime = createCancelamentoRuntime({
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
        body: SOAP_AUTORIZADO,
        statusCode: 200,
        endpoint: getCancelamentoUrl(2),
        namespace: NS_EVENTO,
        tempoXmlMs: 0.1,
        tempoSoapMs: 0.2,
        tempo: 0.3
      })
    });
    const result = await runtime.enviarCancelamento({ chave: CHAVE, ambiente: 2 });
    assert.strictEqual(result.source, ResolutionSource.FALLBACK);
    assert.ok(result.warnings.some((w) => w.code === 'PLATFORM_TRANSPORT_FAILED'));
    assert.strictEqual(metrics.snapshot().fallbacks, 1);
  });

  await test('timeout dispara fallback legado', async () => {
    const metrics = new CancelamentoMetrics();
    const runtime = createCancelamentoRuntime({
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
        body: SOAP_AUTORIZADO,
        statusCode: 200,
        endpoint: getCancelamentoUrl(2),
        namespace: NS_EVENTO,
        tempoXmlMs: 0.1,
        tempoSoapMs: 0.2,
        tempo: 0.3
      })
    });
    const result = await runtime.enviarCancelamento({ chave: CHAVE, ambiente: 2 });
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
      return { statusCode: 200, body: SOAP_AUTORIZADO, headers: {} };
    };
    const metrics = new CancelamentoMetrics();
    const runtime = createCancelamentoRuntime({
      platform: new FiscalWebServices({
        transportOptions: { httpClient, maxRetries: 2 }
      }),
      metrics
    });
    const result = await runtime.enviarCancelamento({ chave: CHAVE, ambiente: 2 });
    assert.strictEqual(result.success, true);
    assert.ok(result.retries >= 1);
    assert.ok(calls >= 2);
    assert.ok(metrics.snapshot().retries >= 1);
  });

  await test('legado direto com httpClient', async () => {
    const result = await enviarCancelamentoLegado({
      ambiente: 2,
      chave: CHAVE,
      httpClient: async () => ({ statusCode: 200, body: SOAP_AUTORIZADO })
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.namespace, NS_EVENTO);
  });

  await test('FiscalWebServices F10 inclui Cancelamento + Autorização', async () => {
    const platform = new FiscalWebServices();
    assert.strictEqual(platform.getVersion(), 'F10-autorizacao');
    assert.strictEqual(platform.isActiveFor(OperationType.CANCELAMENTO), true);
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
