/**
 * Testes — Central de Entradas Sprint 10 (Upload XML Enterprise)
 * Executar: npm run test:central-entradas-sprint10
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CentralUploadService = require('../../backend/motores/central-entradas/services/CentralUploadService');
const CentralEntradasService = require('../../backend/motores/central-entradas/CentralEntradasService');
const CentralDocumentosRepository = require('../../backend/motores/central-entradas/repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../../backend/motores/central-entradas/repositories/CentralHistoricoRepository');
const { detectarNfCancelada } = require('../../backend/services/fiscal/dfeXmlMetadados');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');

let passou = 0;
let falhou = 0;

const CHAVE_SPRINT10 = '35260112345678000199550010000000011000000001';
const FIXTURE_XML = path.join(__dirname, '../shared/nfe/fixtures/nfe-proc-sample.xml');

const uploadService = new CentralUploadService();
const centralService = new CentralEntradasService();
const documentosRepository = new CentralDocumentosRepository();
const historicoRepository = new CentralHistoricoRepository();

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

function criarArquivoMulter(nome, conteudo) {
  return {
    originalname: nome,
    buffer: Buffer.from(conteudo, 'utf8')
  };
}

async function limparDocumentoTeste() {
  const existente = await documentosRepository.buscarPorChave(CHAVE_SPRINT10);
  if (!existente) return;

  await historicoRepository._obterSql().run(
    'DELETE FROM central_entradas_historico WHERE documento_id = ?',
    [existente.id]
  );
  await documentosRepository.remover(existente.id);
}

async function main() {
  console.log('\n=== Testes Central de Entradas — Sprint 10 (Upload XML) ===\n');

  await documentosRepository._obterSql().whenReady();
  await limparDocumentoTeste();

  await test('detectarNfCancelada identifica evento de cancelamento', async () => {
    const xmlCancelado = '<procEventoNFe><tpEvento>110111</tpEvento></procEventoNFe>';
    assert.strictEqual(detectarNfCancelada(xmlCancelado), true);
    assert.strictEqual(detectarNfCancelada('<nfeProc><cStat>100</cStat></nfeProc>'), false);
  });

  await test('rejeita extensão inválida', async () => {
    const item = await uploadService.processarArquivo(
      criarArquivoMulter('nota.txt', '<NFe></NFe>')
    );
    assert.strictEqual(item.codigo, 'EXTENSAO_INVALIDA');
  });

  await test('rejeita XML inválido', async () => {
    const item = await uploadService.processarArquivo(
      criarArquivoMulter('nota.xml', 'nao-e-xml')
    );
    assert.strictEqual(item.codigo, 'XML_INVALIDO');
  });

  await test('rejeita NF cancelada', async () => {
    const item = await uploadService.processarArquivo(
      criarArquivoMulter('cancelada.xml', '<procEventoNFe><tpEvento>110111</tpEvento></procEventoNFe>')
    );
    assert.strictEqual(item.codigo, 'NF_CANCELADA');
  });

  let documentoImportadoId = null;

  await test('upload importa XML pelo pipeline oficial', async () => {
    const xml = fs.readFileSync(FIXTURE_XML, 'utf8');
    const resultado = await uploadService.processarUpload([
      criarArquivoMulter('nfe-proc-sample.xml', xml)
    ]);

    assert.strictEqual(resultado.totalEnviados, 1);
    assert.strictEqual(resultado.importados, 1);
    assert.ok(resultado.sucesso);

    const item = resultado.itens[0];
    assert.strictEqual(item.codigo, 'IMPORTADO');
    assert.strictEqual(item.chave, CHAVE_SPRINT10);
    documentoImportadoId = item.documentoId;

    const doc = await documentosRepository.buscarPorId(documentoImportadoId);
    assert.strictEqual(doc.origem, 'upload_manual');
    assert.ok(doc.parseJson, 'parse_json deve existir após pipeline');
    assert.ok(
      [DocumentoFiscalStatus.AGUARDANDO_REVISAO, DocumentoFiscalStatus.PRONTA_PARA_COMPRA].includes(doc.status),
      `status inesperado: ${doc.status}`
    );
  });

  await test('upload duplicado retorna DOCUMENTO_JA_EXISTENTE', async () => {
    const xml = fs.readFileSync(FIXTURE_XML, 'utf8');
    const resultado = await uploadService.processarUpload([
      criarArquivoMulter('nfe-proc-sample.xml', xml)
    ]);

    assert.strictEqual(resultado.importados, 0);
    assert.strictEqual(resultado.duplicados, 1);
    assert.strictEqual(resultado.itens[0].codigo, 'DOCUMENTO_JA_EXISTENTE');
  });

  await test('CentralEntradasService.uploadDocumentos delega ao serviço de upload', async () => {
    const xml = fs.readFileSync(FIXTURE_XML, 'utf8');
    const resultado = await centralService.uploadDocumentos([
      criarArquivoMulter('nfe-proc-sample.xml', xml)
    ]);

    assert.strictEqual(resultado.duplicados, 1);
    assert.strictEqual(resultado.itens[0].codigo, 'DOCUMENTO_JA_EXISTENTE');
  });

  await limparDocumentoTeste();

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
