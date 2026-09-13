/**
 * RC6.6 — Telemetria Enterprise da comunicação SOAP SEFAZ.
 * Observe-only: não altera regras fiscais.
 *
 * Executar: npm run test:fiscal-telemetria
 */

const assert = require('assert');
const {
  FiscalSoapTelemetry,
  fiscalSoapTelemetry,
  sanitizarSoapXml,
  contarDocZipPorTipo,
  extrairMetadadosLeve,
  FiscalSoapTelemetryEvents
} = require('../../backend/services/fiscal/core/FiscalSoapTelemetry');
const { setFiscalTelemetryFlagsForTests } = require('../../backend/services/fiscal/core/FiscalSoapTelemetryConfig');
const { SoapTransport } = require('../../backend/services/fiscal/core/SoapTransport');
const { OperationType } = require('../../backend/services/fiscal/core/OperationType');
const { ModelType } = require('../../backend/services/fiscal/core/ModelType');
const { EnvironmentType } = require('../../backend/services/fiscal/core/EnvironmentType');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
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

function xmlRetorno138(opts = {}) {
  const ult = opts.ultNSU || '000000000000027';
  const max = opts.maxNSU || '000000000000027';
  const docs = Object.prototype.hasOwnProperty.call(opts, 'docs')
    ? opts.docs
    : `
    <docZip NSU="27" schema="resNfe_v1.01.xsd">AAA</docZip>
    <docZip NSU="28" schema="procNFe_v4.00.xsd">BBB</docZip>
    <docZip NSU="29" schema="resEvento_v1.01.xsd">CCC</docZip>
  `;
  return `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <nfeDistDFeInteresseResponse>
      <nfeDistDFeInteresseResult>
        <retDistDFeInt>
          <cStat>${opts.cStat || '138'}</cStat>
          <xMotivo>${opts.xMotivo || 'Documento(s) localizado(s)'}</xMotivo>
          <ultNSU>${ult}</ultNSU>
          <maxNSU>${max}</maxNSU>
          <loteDistDFeInt>${docs}</loteDistDFeInt>
        </retDistDFeInt>
      </nfeDistDFeInteresseResult>
    </nfeDistDFeInteresseResponse>
  </soap:Body>
</soap:Envelope>`;
}

function criarDefinition() {
  return {
    endpoint: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    soapAction: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse',
    namespace: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe',
    versao: '1.01',
    modelo: ModelType.NFE,
    operacao: OperationType.DISTRIBUICAO_DFE,
    ambiente: EnvironmentType.HOMOLOGACAO,
    uf: 'AN'
  };
}

async function main() {
  console.log('\n=== RC6.6 — Telemetria Fiscal SOAP ===\n');

  await test('Eventos SOAP_* estão definidos', () => {
    assert.strictEqual(FiscalSoapTelemetryEvents.SOAP_INICIADO, 'SOAP_INICIADO');
    assert.strictEqual(FiscalSoapTelemetryEvents.SOAP_FINALIZADO, 'SOAP_FINALIZADO');
    assert.strictEqual(FiscalSoapTelemetryEvents.SOAP_FALHA, 'SOAP_FALHA');
    assert.strictEqual(FiscalSoapTelemetryEvents.SOAP_TIMEOUT, 'SOAP_TIMEOUT');
    assert.strictEqual(FiscalSoapTelemetryEvents.SOAP_HTTP_ERROR, 'SOAP_HTTP_ERROR');
    assert.strictEqual(FiscalSoapTelemetryEvents.SOAP_CSTAT, 'SOAP_CSTAT');
  });

  await test('contarDocZipPorTipo e metadados leves (138)', () => {
    const xml = xmlRetorno138();
    const tipos = contarDocZipPorTipo(xml);
    assert.strictEqual(tipos.docZip, 3);
    assert.strictEqual(tipos.RES_NFE, 1);
    assert.strictEqual(tipos.PROC_NFE, 1);
    assert.strictEqual(tipos.RES_EVENTO, 1);
    const meta = extrairMetadadosLeve(xml);
    assert.strictEqual(meta.cStat, '138');
    assert.ok(meta.ultNSU.endsWith('27'));
  });

  await test('sanitizarSoapXml remove certificado e senha', () => {
    const bruto = 'senha=segredo123 -----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE----- <password>x</password>';
    const limpo = sanitizarSoapXml(bruto);
    assert.ok(!limpo.includes('segredo123'));
    assert.ok(limpo.includes('[CERTIFICADO_REMOVIDO]') || limpo.includes('[REDACTED]'));
  });

  await test('Ciclo completo: HTTP 200 + cStat 138 + painel', async () => {
    const tel = new FiscalSoapTelemetry();
    const eventos = [];
    tel.on(FiscalSoapTelemetryEvents.SOAP_INICIADO, () => eventos.push('SOAP_INICIADO'));
    tel.on(FiscalSoapTelemetryEvents.SOAP_FINALIZADO, () => eventos.push('SOAP_FINALIZADO'));
    tel.on(FiscalSoapTelemetryEvents.SOAP_CSTAT, () => eventos.push('SOAP_CSTAT'));

    const { requestId, correlationId } = tel.iniciar({
      operacao: 'DISTRIBUICAO_DFE',
      modelo: 'NFE',
      ambiente: 'HOMOLOGACAO',
      uf: 'AN',
      origem: 'Registry',
      endpoint: criarDefinition().endpoint,
      soapAction: criarDefinition().soapAction
    });

    tel.registrarTransporte(requestId, {
      httpStatus: 200,
      tempoTransporteMs: 716,
      transportSuccess: true,
      retry: 0
    });

    const reg = tel.finalizar(requestId, {
      sucesso: true,
      xmlRetorno: xmlRetorno138(),
      persistidos: 3,
      duplicados: 0,
      descartados: 0,
      tempoResolverMs: 2,
      tempoXmlMs: 1,
      tempoTotalMs: 784
    });

    assert.strictEqual(reg.correlationId, correlationId);
    assert.strictEqual(reg.httpStatus, 200);
    assert.strictEqual(reg.cStat, '138');
    assert.strictEqual(reg.docZip, 3);
    assert.strictEqual(reg.persistidos, 3);
    assert.strictEqual(reg.resultado, 'OK');
    assert.ok(eventos.includes('SOAP_INICIADO'));
    assert.ok(eventos.includes('SOAP_FINALIZADO'));
    assert.ok(eventos.includes('SOAP_CSTAT'));

    const painel = tel.obterPainelComunicacao();
    assert.strictEqual(painel.ultimoCStat, '138');
    assert.strictEqual(painel.ultimoHttpStatus, 200);
    assert.ok(painel.tempoMedioMs > 0);
    assert.ok(painel.historicoRecente.length >= 1);
  });

  await test('cStat 137 (nenhum documento)', () => {
    const tel = new FiscalSoapTelemetry();
    const { requestId } = tel.iniciar({ operacao: 'DISTRIBUICAO_DFE' });
    tel.registrarTransporte(requestId, { httpStatus: 200, transportSuccess: true, tempoTransporteMs: 100 });
    const reg = tel.finalizar(requestId, {
      sucesso: true,
      xmlRetorno: xmlRetorno138({
        cStat: '137',
        xMotivo: 'Nenhum documento localizado',
        docs: ''
      }),
      persistidos: 0
    });
    assert.strictEqual(reg.cStat, '137');
    assert.strictEqual(reg.docZip, 0);
    assert.strictEqual(reg.resultado, 'OK');
  });

  await test('HTTP erro emite SOAP_HTTP_ERROR', () => {
    const tel = new FiscalSoapTelemetry();
    const eventos = [];
    tel.on(FiscalSoapTelemetryEvents.SOAP_HTTP_ERROR, () => eventos.push('SOAP_HTTP_ERROR'));
    const { requestId } = tel.iniciar({ operacao: 'DISTRIBUICAO_DFE' });
    tel.registrarTransporte(requestId, {
      httpStatus: 404,
      transportSuccess: false,
      tempoTransporteMs: 50,
      erro: 'HTTP 404'
    });
    const reg = tel.finalizar(requestId, { sucesso: false, resultado: 'ERRO' });
    assert.strictEqual(reg.httpStatus, 404);
    assert.ok(eventos.includes('SOAP_HTTP_ERROR'));
  });

  await test('SOAP timeout emite SOAP_TIMEOUT', () => {
    const tel = new FiscalSoapTelemetry();
    const eventos = [];
    tel.on(FiscalSoapTelemetryEvents.SOAP_TIMEOUT, () => eventos.push('SOAP_TIMEOUT'));
    const { requestId } = tel.iniciar({ operacao: 'DISTRIBUICAO_DFE' });
    tel.registrarTransporte(requestId, {
      httpStatus: null,
      transportSuccess: false,
      timeout: true,
      erro: 'timeout of 90000ms exceeded'
    });
    const reg = tel.finalizar(requestId, { sucesso: false, timeout: true, resultado: 'ERRO' });
    assert.strictEqual(reg.resultado, 'ERRO');
    assert.ok(eventos.includes('SOAP_TIMEOUT'));
  });

  await test('SoapTransport HTTP 200 observa telemetria (auto-finalize)', async () => {
    fiscalSoapTelemetry.reiniciar();
    const transport = new SoapTransport({
      maxRetries: 0,
      skipBackoff: true,
      httpClient: async () => ({
        statusCode: 200,
        body: xmlRetorno138(),
        headers: {}
      })
    });

    const request = transport.getFactory().createRequest({
      definition: criarDefinition(),
      envelope: '<soap:Envelope><soap:Body>x</soap:Body></soap:Envelope>',
      certificado: 'fake.pfx',
      senha: 'x',
      operacao: OperationType.DISTRIBUICAO_DFE,
      modelo: ModelType.NFE
    });

    const response = await transport.send(request);
    assert.strictEqual(response.success, true);
    assert.strictEqual(response.statusCode, 200);

    const ultima = fiscalSoapTelemetry.obterUltima();
    assert.ok(ultima, 'deve registrar comunicação');
    assert.strictEqual(ultima.httpStatus, 200);
    assert.strictEqual(ultima.transportSuccess, true);
    assert.strictEqual(ultima.resultado, 'OK');
  });

  await test('SoapTransport HTTP erro observa telemetria', async () => {
    fiscalSoapTelemetry.reiniciar();
    const transport = new SoapTransport({
      maxRetries: 0,
      skipBackoff: true,
      httpClient: async () => {
        const err = new Error('HTTP 500 em https://exemplo');
        err.statusCode = 500;
        err.code = 'NETWORK_ERROR';
        throw err;
      }
    });

    const request = transport.getFactory().createRequest({
      definition: criarDefinition(),
      envelope: '<soap:Envelope><soap:Body>x</soap:Body></soap:Envelope>',
      certificado: 'fake.pfx',
      senha: 'x',
      operacao: OperationType.DISTRIBUICAO_DFE
    });

    const response = await transport.send(request);
    assert.strictEqual(response.success, false);
    const ultima = fiscalSoapTelemetry.obterUltima();
    assert.ok(ultima);
    assert.strictEqual(ultima.resultado, 'ERRO');
    assert.ok(ultima.httpStatus === 500 || ultima.erro);
  });

  await test('SoapTransport timeout observa telemetria', async () => {
    fiscalSoapTelemetry.reiniciar();
    const transport = new SoapTransport({
      maxRetries: 0,
      skipBackoff: true,
      httpClient: async () => {
        const err = new Error('timeout of 1000ms exceeded');
        err.code = 'ECONNABORTED';
        throw err;
      }
    });

    const request = transport.getFactory().createRequest({
      definition: criarDefinition(),
      envelope: '<soap:Envelope><soap:Body>x</soap:Body></soap:Envelope>',
      certificado: 'fake.pfx',
      senha: 'x',
      operacao: OperationType.DISTRIBUICAO_DFE
    });

    const response = await transport.send(request);
    assert.strictEqual(response.status, 'timeout');
    const ultima = fiscalSoapTelemetry.obterUltima();
    assert.ok(ultima);
    assert.strictEqual(ultima.resultado, 'ERRO');
  });

  await test('Erro certificado (CERT_MISSING) observa falha sem alterar resposta', async () => {
    fiscalSoapTelemetry.reiniciar();
    const transport = new SoapTransport({
      maxRetries: 0,
      skipBackoff: true
      // sem httpClient → axios real path → CERT_MISSING sem certificado
    });

    const request = transport.getFactory().createRequest({
      definition: criarDefinition(),
      envelope: '<soap:Envelope><soap:Body>x</soap:Body></soap:Envelope>',
      certificado: null,
      senha: null,
      operacao: OperationType.DISTRIBUICAO_DFE
    });

    const response = await transport.send(request);
    assert.strictEqual(response.success, false);
    assert.ok(/Certificado/i.test(response.error || ''));
    const ultima = fiscalSoapTelemetry.obterUltima();
    assert.ok(ultima);
    assert.strictEqual(ultima.resultado, 'ERRO');
  });

  await test('Erro TLS (reject) observa falha', async () => {
    fiscalSoapTelemetry.reiniciar();
    const transport = new SoapTransport({
      maxRetries: 0,
      skipBackoff: true,
      httpClient: async () => {
        const err = new Error('unable to verify the first certificate');
        err.code = 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
        throw err;
      }
    });

    const request = transport.getFactory().createRequest({
      definition: criarDefinition(),
      envelope: '<soap:Envelope><soap:Body>x</soap:Body></soap:Envelope>',
      certificado: 'fake.pfx',
      senha: 'x',
      operacao: OperationType.DISTRIBUICAO_DFE
    });

    const response = await transport.send(request);
    assert.strictEqual(response.success, false);
    const ultima = fiscalSoapTelemetry.obterUltima();
    assert.ok(ultima);
    assert.ok(/certificate|TLS|verify/i.test(String(ultima.erro || response.error || '')));
  });

  await test('Modo auditoria compacta SOAP; modo normal não grava', () => {
    const tel = new FiscalSoapTelemetry();
    setFiscalTelemetryFlagsForTests({ logDetalhado: false });
    const a = tel.iniciar({ operacao: 'DISTRIBUICAO_DFE' });
    tel.registrarTransporte(a.requestId, {
      httpStatus: 200,
      transportSuccess: true,
      soapEnviado: '<Envelope>senha=abc</Envelope>',
      soapRecebido: xmlRetorno138()
    });
    const semAudit = tel.finalizar(a.requestId, { sucesso: true });
    assert.strictEqual(semAudit.soapEnviadoCompactado, null);

    setFiscalTelemetryFlagsForTests({ logDetalhado: true });
    const b = tel.iniciar({ operacao: 'DISTRIBUICAO_DFE' });
    tel.registrarTransporte(b.requestId, {
      httpStatus: 200,
      transportSuccess: true,
      soapEnviado: '<Envelope>senha=abc</Envelope>',
      soapRecebido: xmlRetorno138()
    });
    const comAudit = tel.finalizar(b.requestId, { sucesso: true });
    assert.ok(comAudit.soapEnviadoCompactado);
    assert.ok(comAudit.soapRecebidoCompactado);
    setFiscalTelemetryFlagsForTests({ logDetalhado: false });
  });

  await test('deferFinalize não fecha até finalizar() explícito', async () => {
    fiscalSoapTelemetry.reiniciar();
    const { requestId } = fiscalSoapTelemetry.iniciar({
      operacao: OperationType.DISTRIBUICAO_DFE,
      origem: 'Registry'
    });

    const transport = new SoapTransport({
      maxRetries: 0,
      skipBackoff: true,
      httpClient: async () => ({
        statusCode: 200,
        body: xmlRetorno138({ cStat: '138' }),
        headers: {}
      })
    });

    const request = transport.getFactory().createRequest({
      definition: criarDefinition(),
      envelope: '<soap:Envelope><soap:Body>x</soap:Body></soap:Envelope>',
      certificado: 'fake.pfx',
      senha: 'x',
      operacao: OperationType.DISTRIBUICAO_DFE,
      metadata: { requestId, deferFinalize: true, origem: 'Registry' }
    });

    await transport.send(request);
    assert.strictEqual(fiscalSoapTelemetry.obterUltima(), null, 'ainda não deve estar no histórico');

    const reg = fiscalSoapTelemetry.finalizar(requestId, {
      sucesso: true,
      xmlRetorno: xmlRetorno138(),
      persistidos: 2,
      duplicados: 1
    });
    assert.strictEqual(reg.cStat, '138');
    assert.strictEqual(reg.persistidos, 2);
    assert.strictEqual(reg.duplicados, 1);
    assert.strictEqual(reg.httpStatus, 200);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) {
    console.log('RC6.6 — testes de telemetria com falhas\n');
    process.exit(1);
  }
  console.log('RC6.6 CONCLUÍDA — testes de telemetria OK\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
