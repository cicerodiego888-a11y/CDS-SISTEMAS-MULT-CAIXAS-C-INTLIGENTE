/**
 * Testes — Manifestação do Destinatário runtime (Sprint F7)
 * Infraestrutura apenas. Sem HTTP real.
 *
 * Executar: npm run test:fiscal-manifestacao-runtime
 *           node tests/fiscal/fiscal-manifestacao-runtime.test.js
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
  UF_AN,
  ENABLED_OPERATIONS,
  getManifestacaoEventoCode
} = require('../../backend/services/fiscal/core');
const {
  createManifestacaoRuntime,
  ManifestacaoMetrics,
  OPERACOES_MANIFESTACAO,
  montarEnvelopeManifestacao
} = require('../../backend/services/fiscal/manifestacaoRuntime');
const {
  enviarManifestacaoLegado,
  getManifestacaoUrl,
  NS_EVENTO
} = require('../../backend/services/fiscal/manifestacaoLegado');

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
    <retEnvEvento>
      <cStat>128</cStat>
      <retEvento>
        <infEvento>
          <cStat>135</cStat>
          <xMotivo>Evento registrado e vinculado a NF-e</xMotivo>
        </infEvento>
      </retEvento>
    </retEnvEvento>
  </soap:Body>
</soap:Envelope>`;

const SOAP_INVALID = `<soap:Envelope><soap:Body><retEnvEvento><cStat>999</cStat></retEnvEvento></soap:Body></soap:Envelope>`;

async function main() {
  console.log('\n=== Testes Manifestação Runtime — Sprint F7 ===\n');

  await test('TransportEnablement inclui manifestações', async () => {
    for (const op of OPERACOES_MANIFESTACAO) {
      assert.ok(ENABLED_OPERATIONS.includes(op), op);
    }
    assert.ok(ENABLED_OPERATIONS.includes(OperationType.MANIFESTACAO));
    const transport = new SoapTransport();
    assert.strictEqual(transport.isEnabled(OperationType.MANIFESTACAO_CIENCIA), true);
    assert.strictEqual(transport.isEnabled(OperationType.AUTORIZACAO), true);
  });

  await test('Registry resolve as 4 manifestações (AN)', async () => {
    const platform = new FiscalWebServices();
    for (const operacao of OPERACOES_MANIFESTACAO) {
      const result = platform.resolve({
        modelo: ModelType.NFE,
        operacao,
        ambiente: EnvironmentType.HOMOLOGACAO,
        uf: UF_AN,
        versao: '1.00'
      });
      assert.strictEqual(result.success, true, operacao);
      assert.ok(result.definition.endpoint.includes('NFeRecepcaoEvento4'));
      assert.ok(result.definition.endpoint.includes('nfe.fazenda.gov.br'));
      assert.strictEqual(result.definition.uf, UF_AN);
      assert.strictEqual(result.definition.namespace, NS_EVENTO);
    }
  });

  await test('UrlResolver força AN mesmo se uf=SVRS for passado', async () => {
    const platform = new FiscalWebServices();
    const result = platform.resolve({
      modelo: ModelType.NFE,
      operacao: OperationType.MANIFESTACAO_CIENCIA,
      ambiente: EnvironmentType.PRODUCAO,
      uf: UF_SVRS,
      versao: '1.00'
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.definition.uf, UF_AN);
    assert.ok(result.definition.endpoint.includes('www.nfe.fazenda.gov.br'));
  });

  await test('montarEnvelopeManifestacao contém tpEvento e cOrgao 91 sem nfeCabecMsg', async () => {
    const xml = montarEnvelopeManifestacao({
      operacao: OperationType.MANIFESTACAO_CONFIRMACAO,
      chave: '35260112345678000199550010000000011000000001',
      cnpj: '12345678000199'
    });
    assert.ok(xml.includes('210200'));
    assert.ok(xml.includes('Confirmacao da Operacao'));
    assert.ok(xml.includes('<cOrgao>91</cOrgao>'));
    assert.ok(!xml.includes('nfeCabecMsg'));
    assert.ok(!xml.includes('soap12:Header'));
    assert.strictEqual(getManifestacaoEventoCode(OperationType.MANIFESTACAO_CIENCIA), '210210');
  });

  await test('getManifestacaoUrl vem do Registry AN', async () => {
    const urlHom = getManifestacaoUrl(2);
    const urlProd = getManifestacaoUrl(1);
    assert.ok(urlHom.includes('hom1.nfe.fazenda.gov.br'));
    assert.ok(urlHom.includes('NFeRecepcaoEvento4'));
    assert.ok(urlProd.includes('www.nfe.fazenda.gov.br'));
    assert.ok(!urlHom.includes('svrs'));
  });

  await test('sucesso Plataforma via httpClient', async () => {
    const httpClient = async () => ({ statusCode: 200, body: SOAP_OK, headers: {} });
    const metrics = new ManifestacaoMetrics();
    const runtime = createManifestacaoRuntime({
      platform: new FiscalWebServices({ transportOptions: { httpClient } }),
      metrics
    });

    const result = await runtime.enviarManifestacao({
      operacao: OperationType.MANIFESTACAO_CIENCIA,
      ambiente: 2,
      chave: '35260112345678000199550010000000011000000001',
      cnpj: '12345678000199',
      certificadoPath: 'fake.pfx',
      certificadoSenha: 'x'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, 'PLATFORM');
    assert.strictEqual(result.fallbackUtilizado, false);
    assert.strictEqual(result.tpEvento, '210210');
    assert.ok(result.tempoResolverMs >= 0);
    assert.ok(result.tempoTransporteMs >= 0);
    assert.ok(result.tempoXmlMs >= 0);

    const snap = metrics.snapshot();
    assert.strictEqual(snap.sucessosPlataforma, 1);
    assert.strictEqual(snap.fallbacks, 0);
    console.log(`         tempo médio plataforma: ${snap.tempoMedioPlataformaMs.toFixed(4)} ms`);
  });

  await test('resposta válida e inválida', async () => {
    const runtimeOk = createManifestacaoRuntime({
      platform: new FiscalWebServices({
        transportOptions: { httpClient: async () => ({ statusCode: 200, body: SOAP_OK }) }
      }),
      metrics: new ManifestacaoMetrics()
    });
    const ok = await runtimeOk.enviarManifestacao({
      operacao: OperationType.MANIFESTACAO_CONFIRMACAO,
      ambiente: 2
    });
    assert.ok(ok.body.includes('135'));

    const runtimeBad = createManifestacaoRuntime({
      platform: new FiscalWebServices({
        transportOptions: { httpClient: async () => ({ statusCode: 200, body: SOAP_INVALID }) }
      }),
      metrics: new ManifestacaoMetrics()
    });
    const bad = await runtimeBad.enviarManifestacao({
      operacao: OperationType.MANIFESTACAO_DESCONHECIMENTO,
      ambiente: 2
    });
    assert.strictEqual(bad.success, true);
    assert.ok(bad.body.includes('999'));
  });

  await test('timeout dispara fallback legado', async () => {
    const httpClient = async () => {
      throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    };
    const legadoSender = async () => ({
      success: true,
      body: SOAP_OK,
      statusCode: 200,
      endpoint: getManifestacaoUrl(2),
      namespace: NS_EVENTO,
      tempoXmlMs: 0.1,
      tempoSoapMs: 0.2,
      tempo: 0.3
    });
    const metrics = new ManifestacaoMetrics();
    const runtime = createManifestacaoRuntime({
      platform: new FiscalWebServices({
        transportOptions: { httpClient, maxRetries: 0 }
      }),
      metrics,
      legadoSender
    });

    const result = await runtime.enviarManifestacao({
      operacao: OperationType.MANIFESTACAO_NAO_REALIZADA,
      ambiente: 2,
      xJust: 'Mercadoria nao recebida'
    });
    assert.strictEqual(result.source, ResolutionSource.FALLBACK);
    assert.strictEqual(result.fallbackUtilizado, true);
    assert.ok(result.warnings.some((w) => w.code === 'FALLBACK'));
    assert.strictEqual(metrics.snapshot().fallbacks, 1);
    console.log(`         fallbacks: ${metrics.snapshot().fallbacks}`);
  });

  await test('resolve fail usa fallback', async () => {
    const platform = new FiscalWebServices({ loadOfficialCatalog: false });
    const runtime = createManifestacaoRuntime({
      platform,
      metrics: new ManifestacaoMetrics(),
      legadoSender: async ({ url }) => ({
        success: true,
        body: SOAP_OK,
        statusCode: 200,
        endpoint: url,
        namespace: NS_EVENTO,
        tempoXmlMs: 0.1,
        tempoSoapMs: 0.1,
        tempo: 0.2
      })
    });
    const result = await runtime.enviarManifestacao({
      operacao: OperationType.MANIFESTACAO_CIENCIA,
      ambiente: 1
    });
    assert.strictEqual(result.fallbackUtilizado, true);
    assert.ok(result.warnings.some((w) => w.code === 'PLATFORM_RESOLVE_FAILED'));
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
    const metrics = new ManifestacaoMetrics();
    const runtime = createManifestacaoRuntime({
      platform: new FiscalWebServices({
        transportOptions: { httpClient, maxRetries: 2 }
      }),
      metrics
    });
    const result = await runtime.enviarManifestacao({
      operacao: OperationType.MANIFESTACAO_CIENCIA,
      ambiente: 2
    });
    assert.strictEqual(result.success, true);
    assert.ok(result.retries >= 1);
    assert.ok(calls >= 2);
  });

  await test('legado direto com httpClient', async () => {
    const result = await enviarManifestacaoLegado({
      operacao: OperationType.MANIFESTACAO_CIENCIA,
      ambiente: 2,
      httpClient: async () => ({ statusCode: 200, body: SOAP_OK })
    });
    assert.strictEqual(result.success, true);
  });

  await test('operacao generica MANIFESTACAO sem subtipo falha', async () => {
    const runtime = createManifestacaoRuntime({
      metrics: new ManifestacaoMetrics()
    });
    const result = await runtime.enviarManifestacao({
      operacao: OperationType.MANIFESTACAO,
      ambiente: 2
    });
    assert.strictEqual(result.success, false);
    assert.ok(/inválida/i.test(result.error));
  });

  await test('FiscalWebServices F10 inclui Manifestação + Autorização', async () => {
    const platform = new FiscalWebServices();
    assert.strictEqual(platform.getVersion(), 'F10-autorizacao');
    assert.strictEqual(platform.isActiveFor(OperationType.MANIFESTACAO_CIENCIA), true);
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
