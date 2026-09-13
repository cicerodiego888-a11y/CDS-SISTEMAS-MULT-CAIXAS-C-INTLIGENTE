/**
 * Testes — Central de Entradas Sprint 5 (pipeline de processamento)
 * Executar: npm run test:central-entradas-sprint5
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CentralEntradasService = require('../../backend/motores/central-entradas/CentralEntradasService');
const CentralDocumentosRepository = require('../../backend/motores/central-entradas/repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../../backend/motores/central-entradas/repositories/CentralHistoricoRepository');
const CentralComprasBridgeService = require('../../backend/motores/central-entradas/services/CentralComprasBridgeService');
const { enriquecerParseComMiip } = require('../../backend/shared/nfe/enriquecerParseComMiip');
const NFeParserService = require('../../backend/shared/nfe/NFeParserService');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');

let passou = 0;
let falhou = 0;

const CHAVE_SPRINT5 = '35260112345678000199550010000000011000000001';
const FIXTURE_XML = path.join(__dirname, '../shared/nfe/fixtures/nfe-proc-sample.xml');

const service = new CentralEntradasService();
const documentosRepository = new CentralDocumentosRepository();
const historicoRepository = new CentralHistoricoRepository();
const bridgeService = new CentralComprasBridgeService();

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

async function limparDocumentoTeste() {
  const existente = await documentosRepository.buscarPorChave(CHAVE_SPRINT5);
  if (!existente) return;

  await historicoRepository._obterSql().run(
    'DELETE FROM central_entradas_historico WHERE documento_id = ?',
    [existente.id]
  );
  await documentosRepository.remover(existente.id);
}

async function criarDocumentoSincronizado() {
  await limparDocumentoTeste();

  const xml = fs.readFileSync(FIXTURE_XML, 'utf8');

  return documentosRepository.inserir({
    chave: CHAVE_SPRINT5,
    numero: '7777',
    serie: '1',
    fornecedor: 'Fornecedor Sprint 5',
    cnpjFornecedor: '77777777000177',
    dataEmissao: '2026-07-05',
    valorTotal: 100,
    xml,
    origem: 'dfe',
    status: DocumentoFiscalStatus.SINCRONIZADA
  });
}

async function main() {
  console.log('\n=== Testes Central de Entradas — Sprint 5 ===\n');

  await documentosRepository._obterSql().whenReady();

  await test('health retorna sprint RC2', async () => {
    const health = await service.obterHealth();
    assert.ok(/^RC[2-9]$/.test(health.sprint), `health.sprint: ${health.sprint}`);
  });

  await test('enriquecerParseComMiip não altera contrato parse-xml', async () => {
    const xml = fs.readFileSync(FIXTURE_XML, 'utf8');
    const parsed = await NFeParserService.parse(xml);
    const { parsed: enriquecido } = await enriquecerParseComMiip(parsed);

    assert.ok(Array.isArray(enriquecido.itens));
    assert.ok(enriquecido.chave_acesso);
    assert.strictEqual(typeof enriquecido.valor_total_nota, 'number');
  });

  let documento;

  await test('cria documento sincronizado para processamento', async () => {
    documento = await criarDocumentoSincronizado();
    assert.strictEqual(documento.status, DocumentoFiscalStatus.SINCRONIZADA);
  });

  await test('processarDocumento executa pipeline e persiste parse_json', async () => {
    const resultado = await service.processarDocumento(documento.id);

    assert.strictEqual(resultado.sucesso, true);
    assert.ok(resultado.parse);
    assert.ok(resultado.documento);

    const atualizado = await documentosRepository.buscarPorId(documento.id);
    assert.ok(atualizado.parseJson);
    assert.ok(atualizado.processadoEm);

    const statusValidos = [
      DocumentoFiscalStatus.AGUARDANDO_REVISAO,
      DocumentoFiscalStatus.PRONTA_PARA_COMPRA
    ];
    assert.ok(statusValidos.includes(atualizado.status));
  });

  await test('obterPayloadCompra retorna formato parse-xml', async () => {
    const payload = await service.obterPayloadCompra(documento.id);
    assert.strictEqual(payload.sucesso, true);
    assert.ok(payload.dadosCompra);
    assert.ok(Array.isArray(payload.dadosCompra.itens));
    assert.strictEqual(payload.dadosCompra.chave_acesso, CHAVE_SPRINT5);
  });

  await test('concluirRevisao transiciona para PRONTA_PARA_COMPRA', async () => {
    const atual = await documentosRepository.buscarPorId(documento.id);

    if (atual.status === DocumentoFiscalStatus.AGUARDANDO_REVISAO) {
      const itens = atual.parseJson?.itens || [];
      const resultado = await service.concluirRevisao(documento.id, { itens });
      assert.strictEqual(resultado.sucesso, true);
      assert.strictEqual(resultado.documento.status, DocumentoFiscalStatus.PRONTA_PARA_COMPRA);
    } else {
      await service.alterarStatus(documento.id, DocumentoFiscalStatus.PRONTA_PARA_COMPRA, {
        detalhe: 'Teste sprint 5 — já pronto'
      });
    }
  });

  await test('vincularCompra marca documento como GRAVADA', async () => {
    await bridgeService.registrarAberturaCompra(documento.id);

    const sql = documentosRepository._obterSql();
    let compraId;
    const compraExistente = await sql.get('SELECT id FROM compras ORDER BY id DESC LIMIT 1');
    if (compraExistente?.id) {
      compraId = compraExistente.id;
    } else {
      const insert = await sql.run(
        `INSERT INTO compras (data_compra, fornecedor, total, status, valor_total_nota)
         VALUES ('2026-07-05', 'Teste Sprint 5', 100, 'concluida', 100)`
      );
      compraId = insert.lastID;
    }

    const resultado = await bridgeService.vincularCompra(documento.id, compraId);

    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.documento.status, DocumentoFiscalStatus.GRAVADA);
    assert.strictEqual(resultado.compraId, compraId);

    const atualizado = await documentosRepository.buscarPorId(documento.id);
    assert.strictEqual(atualizado.compraId, compraId);
  });

  await limparDocumentoTeste();

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Erro fatal nos testes:', error);
  process.exit(1);
});
