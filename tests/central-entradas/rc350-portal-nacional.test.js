/**
 * RC3.5.0 — Recuperação pelo Portal Nacional (oficial).
 *
 * Executar: npm run test:central-entradas-rc3.5.0
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const PortalNfeRecoveryService = require('../../backend/motores/central-entradas/services/PortalNfeRecoveryService');
const { TIPOS_EVENTO, ORIGENS } = require('../../backend/motores/central-entradas/config/centralEventosTipos');

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

const CHAVE = '35260112345678000199550010000000771000000077';
const CNPJ_EMPRESA = '12345678000199';

function montarNfeProc(opcoes = {}) {
  const chave = opcoes.chave || CHAVE;
  const cnpjDest = opcoes.cnpjDest || CNPJ_EMPRESA;
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe${chave}" versao="4.00">
      <ide><cUF>35</cUF><nNF>77</nNF><serie>1</serie><mod>55</mod><dhEmi>2026-01-15T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>98765432000111</CNPJ><xNome>Fornecedor</xNome></emit>
      <dest><CNPJ>${cnpjDest}</CNPJ><xNome>Empresa</xNome></dest>
      <total><ICMSTot><vNF>100.00</vNF></ICMSTot></total>
    </infNFe>
    <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
      <SignedInfo>
        <CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
        <SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>
        <Reference URI="#NFe${chave}">
          <Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></Transforms>
          <DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>
          <DigestValue>abcdefghijklmnopqrstuvwxyz0123456789ABCD=</DigestValue>
        </Reference>
      </SignedInfo>
      <SignatureValue>abcdefghijklmnopqrstuvwxyz0123456789ABCDEFghijklmnopq=</SignatureValue>
    </Signature>
  </NFe>
  <protNFe><infProt>
    <chNFe>${chave}</chNFe><nProt>135260000000001</nProt><cStat>100</cStat>
  </infProt></protNFe>
</nfeProc>`;
}

function criarHarness(opcoes = {}) {
  const docs = new Map();
  const historico = [];
  const eventos = [];
  const processados = [];

  function seed(doc) {
    const row = { ...doc, id: Number(doc.id) };
    docs.set(row.id, row);
    return row;
  }

  const documentosRepository = {
    async buscarPorId(id) { return docs.get(Number(id)) || null; },
    async buscarPorChave(chave) {
      return [...docs.values()].find((d) => d.chave === chave) || null;
    },
    async atualizar(id, dados) {
      const d = docs.get(Number(id));
      if (!d) return null;
      Object.assign(d, dados);
      return d;
    }
  };

  const historicoRepository = {
    async inserir(ev) { historico.push(ev); return { id: historico.length }; }
  };

  const DocumentoTransitionService = require('../../backend/motores/central-entradas/services/DocumentoTransitionService');
  const CentralDocumentoAtualizacaoService = require('../../backend/motores/central-entradas/services/CentralDocumentoAtualizacaoService');
  const CentralImportacaoXmlLegadoService = require('../../backend/motores/central-entradas/services/CentralImportacaoXmlLegadoService');

  const historicoService = { async registrar(ev) { historico.push(ev); } };
  const transitionService = new DocumentoTransitionService({
    documentosRepository,
    historicoService
  });
  const atualizacaoService = new CentralDocumentoAtualizacaoService({
    documentosRepository,
    historicoRepository,
    transitionService
  });
  const processamentoService = {
    async processar(documentoId) {
      processados.push(Number(documentoId));
      const d = docs.get(Number(documentoId));
      d.status = DocumentoFiscalStatus.PRONTA_PARA_COMPRA;
      d.parseJson = { ok: true };
      d.miipSessaoId = 'miip-portal';
      return { sucesso: true, documento: { ...d }, possuiPendencias: false };
    }
  };
  const importacao = new CentralImportacaoXmlLegadoService({
    documentosRepository,
    historicoRepository,
    transitionService,
    atualizacaoService,
    processamentoService,
    xmlWait: { cancelar() {}, cancelarPorChave() {} },
    obterCnpjEmpresa: async () => CNPJ_EMPRESA,
    emitirEvento: async (ev) => { eventos.push(ev); return ev; }
  });
  importacao._atualizarSaude = async () => {};

  const service = new PortalNfeRecoveryService({
    documentosRepository,
    historicoRepository,
    importacaoService: importacao,
    incluirAguardandoXml: opcoes.incluirAguardandoXml === true,
    emitirEvento: async (ev) => { eventos.push(ev); return ev; }
  });

  return { service, seed, docs, historico, eventos, processados };
}

async function run() {
  console.log('\n=== RC3.5.0 — Portal Nacional ===\n');

  await test('catálogo de eventos RC3.5.0', () => {
    assert.ok(TIPOS_EVENTO.PORTAL_ABERTO);
    assert.ok(TIPOS_EVENTO.DOWNLOAD_INICIADO);
    assert.ok(TIPOS_EVENTO.DOWNLOAD_CONCLUIDO);
    assert.ok(TIPOS_EVENTO.DOCUMENTO_RECUPERADO_PORTAL);
    assert.ok(TIPOS_EVENTO.PIPELINE_INICIADO);
    assert.strictEqual(ORIGENS.PORTAL_NACIONAL, 'portal_nacional');
  });

  await test('elegível: XML_INDISPONIVEL com chave', async () => {
    const h = criarHarness();
    h.seed({
      id: 1,
      chave: CHAVE,
      status: DocumentoFiscalStatus.XML_INDISPONIVEL,
      tipoDocumento: 'RES_NFE'
    });
    const a = await h.service.avaliarDocumento(1);
    assert.strictEqual(a.elegivel, true);
  });

  await test('não elegível: documento saudável GRAVADA', async () => {
    const h = criarHarness();
    h.seed({
      id: 2,
      chave: CHAVE,
      status: DocumentoFiscalStatus.GRAVADA,
      tipoDocumento: 'PROC_NFE'
    });
    const a = await h.service.avaliarDocumento(2);
    assert.strictEqual(a.elegivel, false);
  });

  await test('AGUARDANDO_XML só com config', async () => {
    const hOff = criarHarness({ incluirAguardandoXml: false });
    hOff.seed({
      id: 3,
      chave: CHAVE,
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      tipoDocumento: 'RES_NFE'
    });
    assert.strictEqual((await hOff.service.avaliarDocumento(3)).elegivel, false);

    const hOn = criarHarness({ incluirAguardandoXml: true });
    hOn.seed({
      id: 3,
      chave: CHAVE,
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      tipoDocumento: 'RES_NFE'
    });
    assert.strictEqual((await hOn.service.avaliarDocumento(3)).elegivel, true);
  });

  await test('importar XML válido → pipeline oficial', async () => {
    const h = criarHarness();
    h.seed({
      id: 10,
      chave: CHAVE,
      status: DocumentoFiscalStatus.XML_INDISPONIVEL,
      tipoDocumento: 'RES_NFE',
      xml: '<resNFe/>'
    });
    const xml = montarNfeProc();
    const r = await h.service.importarXmlBaixado(10, {
      nomeArquivo: 'portal.xml',
      xml
    }, { usuarioId: 1 });
    assert.strictEqual(r.sucesso, true);
    assert.strictEqual(r.codigo, 'DOCUMENTO_RECUPERADO_PORTAL');
    assert.strictEqual(h.processados.length, 1);
    assert.ok(h.eventos.some((e) => e.tipo === TIPOS_EVENTO.DOCUMENTO_RECUPERADO_PORTAL));
    assert.ok(h.eventos.some((e) => e.tipo === TIPOS_EVENTO.PIPELINE_INICIADO));
  });

  await test('XML CNPJ divergente — rejeita', async () => {
    const h = criarHarness();
    h.seed({
      id: 11,
      chave: CHAVE,
      status: DocumentoFiscalStatus.XML_INDISPONIVEL,
      tipoDocumento: 'RES_NFE',
      xml: '<resNFe/>'
    });
    const r = await h.service.importarXmlBaixado(11, {
      xml: montarNfeProc({ cnpjDest: '11111111000111' })
    });
    assert.strictEqual(r.sucesso, false);
    assert.strictEqual(h.processados.length, 0);
  });

  await test('Electron module: pasta e handlers exportados', () => {
    const mod = require('../../electron-portal-nfe');
    assert.ok(typeof mod.abrirPortal === 'function');
    assert.ok(typeof mod.garantirPastaDownloads === 'function');
    assert.ok(typeof mod.registrarHandlersIpc === 'function');
    assert.ok(typeof mod.validarCompatibilidade === 'function');
    const compat = mod.validarCompatibilidade();
    assert.strictEqual(compat.ok, true);
    assert.strictEqual(compat.modo, 'BrowserWindow');
    assert.ok(fs.existsSync(compat.downloadDir));
    assert.match(compat.downloadDir, /PortalNFe[\\/]Downloads/);
  });

  await test('frontend/preload expõem Portal Nacional', () => {
    const mainSrc = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/central-entradas.js'),
      'utf8'
    );
    const preload = fs.readFileSync(path.join(__dirname, '../../preload.js'), 'utf8');
    const common = fs.readFileSync(path.join(__dirname, '../../electron-common.js'), 'utf8');
    assert.match(mainSrc, /Recuperar pelo Portal Nacional/);
    assert.match(mainSrc, /recuperarPortalNfeCentral/);
    assert.match(preload, /portalNfe/);
    assert.match(preload, /portal-nfe-abrir/);
    assert.match(common, /electron-registrar-portal-nfe|electron-portal-nfe/);
  });

  await test('rota portal registrada', () => {
    const rotas = fs.readFileSync(
      path.join(__dirname, '../../backend/rotas/central-entradas.js'),
      'utf8'
    );
    assert.match(rotas, /recuperar-portal-nacional\/importar/);
    assert.match(rotas, /recuperar-portal-nacional\/abrir/);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
