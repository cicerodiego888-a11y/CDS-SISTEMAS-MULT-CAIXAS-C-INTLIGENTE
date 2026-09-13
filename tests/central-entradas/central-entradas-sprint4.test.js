/**
 * Testes — Central de Entradas Sprint 4 (NSU, persistência DF-e, XML)
 * Executar: npm run test:central-entradas-sprint4
 */

const assert = require('assert');
const CentralEntradasService = require('../../backend/motores/central-entradas/CentralEntradasService');
const CentralNsuRepository = require('../../backend/motores/central-entradas/repositories/CentralNsuRepository');
const CentralDocumentosRepository = require('../../backend/motores/central-entradas/repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../../backend/motores/central-entradas/repositories/CentralHistoricoRepository');
const CentralDfePersistenciaService = require('../../backend/motores/central-entradas/services/CentralDfePersistenciaService');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');

let passou = 0;
let falhou = 0;

const CNPJ_TESTE = '88888888000188';
const CHAVE_SPRINT4 = '23250788888888000188550010000008881000000088';
const AMBIENTE_TESTE = 2;

const service = new CentralEntradasService();
const nsuRepository = new CentralNsuRepository();
const documentosRepository = new CentralDocumentosRepository();
const historicoRepository = new CentralHistoricoRepository();
const persistenciaService = new CentralDfePersistenciaService();

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

function criarXmlTeste(chave) {
  return `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${chave}"><ide><nNF>8888</nNF><serie>1</serie><dhEmi>2026-07-05T10:00:00-03:00</dhEmi></ide><emit><CNPJ>${CNPJ_TESTE}</CNPJ><xNome>Fornecedor Sprint 4</xNome></emit><total><ICMSTot><vNF>1500.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
}

async function limparDocumentoTeste() {
  const existente = await documentosRepository.buscarPorChave(CHAVE_SPRINT4);
  if (!existente) return;

  await historicoRepository._obterSql().run(
    'DELETE FROM central_entradas_historico WHERE documento_id = ?',
    [existente.id]
  );
  await documentosRepository.remover(existente.id);
}

async function limparNsuTeste() {
  const existente = await nsuRepository.buscarPorCnpjAmbiente(CNPJ_TESTE, AMBIENTE_TESTE);
  if (existente) {
    await nsuRepository.remover(existente.id);
  }
}

async function main() {
  console.log('\n=== Testes Central de Entradas — Sprint 4 ===\n');

  await nsuRepository._obterSql().whenReady();

  await test('NSU obterOuCriar não reinicia do zero', async () => {
    await limparNsuTeste();

    const criado = await nsuRepository.obterOuCriar(CNPJ_TESTE, AMBIENTE_TESTE);
    assert.strictEqual(criado.ultNsu, '000000000000000');

    await nsuRepository.atualizarSincronizacao(criado.id, {
      ultNsu: '000000000000123',
      maxNsu: '000000000000456'
    });

    const reaberto = await nsuRepository.obterOuCriar(CNPJ_TESTE, AMBIENTE_TESTE);
    assert.strictEqual(reaberto.ultNsu, '000000000000123');
    assert.strictEqual(reaberto.maxNsu, '000000000000456');
    assert.ok(reaberto.dataSincronizacao);
  });

  await test('persistência DF-e grava documento sem criar compra', async () => {
    await limparDocumentoTeste();

    const xml = criarXmlTeste(CHAVE_SPRINT4);
    const resultado = await persistenciaService.persistirDocumentoDfe({
      xml,
      nsu: '000000000000999',
      origem: 'dfe'
    });

    assert.strictEqual(resultado.novo, true);
    assert.strictEqual(resultado.documento.status, DocumentoFiscalStatus.SINCRONIZADA);
    assert.strictEqual(resultado.documento.chave, CHAVE_SPRINT4);

    const sql = documentosRepository._obterSql();
    const compra = await sql.get('SELECT id FROM compras WHERE chave_acesso = ?', [CHAVE_SPRINT4]);
    assert.ok(!compra, 'Nenhuma compra deve ser criada pela persistência DF-e');
  });

  await test('persistência DF-e detecta duplicata na Central', async () => {
    const xml = criarXmlTeste(CHAVE_SPRINT4);
    const resultado = await persistenciaService.persistirDocumentoDfe({
      xml,
      origem: 'dfe'
    });

    assert.strictEqual(resultado.duplicado, true);
    assert.strictEqual(resultado.novo, false);
  });

  let documentoId;

  await test('obterXmlDocumento retorna XML bruto', async () => {
    const doc = await documentosRepository.buscarPorChave(CHAVE_SPRINT4);
    assert.ok(doc);
    documentoId = doc.id;

    const xmlDoc = await service.obterXmlDocumento(documentoId);
    assert.ok(xmlDoc);
    assert.ok(xmlDoc.xml.includes('infNFe'));
    assert.strictEqual(xmlDoc.chave, CHAVE_SPRINT4);
  });

  await test('dashboard inclui sincronização', async () => {
    const dashboard = await service.obterDashboard();
    assert.ok('sincronizacao' in dashboard);
    assert.ok('ultimaSincronizacao' in dashboard);
    assert.ok(dashboard.indicadores);
    assert.ok(typeof dashboard.indicadores.totalDocumentos === 'number');
    assert.ok(typeof dashboard.indicadores.valorTotalDia === 'number');
  });

  await limparDocumentoTeste();
  await limparNsuTeste();

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Erro fatal nos testes:', error);
  process.exit(1);
});
