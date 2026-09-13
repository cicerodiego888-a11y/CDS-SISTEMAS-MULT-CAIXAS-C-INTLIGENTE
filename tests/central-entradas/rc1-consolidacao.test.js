/**
 * Testes RC1 — Consolidação arquitetural da Central de Entradas
 * Executar: npm run test:central-entradas-rc1
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { CentralEntradasOrchestrator } = require('../../backend/motores/central-entradas/CentralEntradasOrchestrator');
const DocumentoTransitionService = require('../../backend/motores/central-entradas/services/DocumentoTransitionService');
const CentralProcessamentoService = require('../../backend/motores/central-entradas/services/CentralProcessamentoService');
const CentralComprasBridgeService = require('../../backend/motores/central-entradas/services/CentralComprasBridgeService');
const CentralNotificacoesService = require('../../backend/motores/central-entradas/services/CentralNotificacoesService');
const CentralDocumentosRepository = require('../../backend/motores/central-entradas/repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../../backend/motores/central-entradas/repositories/CentralHistoricoRepository');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const { validarTransicao } = require('../../backend/motores/central-entradas/core/MaquinaEstadosDocumento');

const CHAVE_RC1 = '35260112345678000199550010000000021000000002';
const FIXTURE_XML = path.join(__dirname, '../shared/nfe/fixtures/nfe-proc-sample.xml');

let passou = 0;
let falhou = 0;

const documentosRepository = new CentralDocumentosRepository();
const historicoRepository = new CentralHistoricoRepository();
const transitionService = new DocumentoTransitionService({ documentosRepository, historicoRepository });
const processamentoService = new CentralProcessamentoService({
  documentosRepository,
  historicoRepository,
  transitionService
});
const bridgeService = new CentralComprasBridgeService({
  documentosRepository,
  historicoRepository,
  transitionService
});

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
  const existente = await documentosRepository.buscarPorChave(CHAVE_RC1);
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
    chave: CHAVE_RC1,
    numero: '8888',
    serie: '1',
    fornecedor: 'Fornecedor RC1',
    cnpjFornecedor: '88888888000188',
    dataEmissao: '2026-07-09',
    valorTotal: 150,
    xml,
    origem: 'dfe',
    status: DocumentoFiscalStatus.SINCRONIZADA
  });
}

async function main() {
  console.log('\n=== Testes RC1 — Consolidação Central de Entradas ===\n');

  await documentosRepository._obterSql().whenReady();

  await test('DocumentoTransitionService valida transição inválida', async () => {
    await assert.rejects(
      () => transitionService.transicionar(1, DocumentoFiscalStatus.SINCRONIZADA, DocumentoFiscalStatus.GRAVADA),
      (err) => err.statusCode === 400
    );
  });

  await test('DocumentoTransitionService aplica transição válida', async () => {
    const doc = await criarDocumentoSincronizado();
    await transitionService.transicionar(
      doc.id,
      DocumentoFiscalStatus.SINCRONIZADA,
      DocumentoFiscalStatus.EM_PROCESSAMENTO,
      { detalhe: 'Teste RC1' }
    );
    const atualizado = await documentosRepository.buscarPorId(doc.id);
    assert.strictEqual(atualizado.status, DocumentoFiscalStatus.EM_PROCESSAMENTO);
    await documentosRepository.atualizar(doc.id, { status: DocumentoFiscalStatus.SINCRONIZADA });
  });

  await test('CentralProcessamentoService reutiliza parse existente (sem duplicar MIIP)', async () => {
    const doc = await criarDocumentoSincronizado();
    const primeiro = await processamentoService.processar(doc.id);
    assert.strictEqual(primeiro.sucesso, true);

    const segundo = await processamentoService.processar(doc.id);
    assert.strictEqual(segundo.sucesso, true);
    assert.strictEqual(segundo.reutilizado, true);
    assert.ok(segundo.mensagem.includes('reutilizado'));
  });

  await test('CentralComprasBridgeService não reexecuta Parser/MIIP', async () => {
    const doc = await criarDocumentoSincronizado();
    await processamentoService.processar(doc.id);

    const payload = await bridgeService.montarPayloadAbrirCompra(doc.id);
    assert.ok(payload.dadosCompra);

    const docSemProcessar = await criarDocumentoSincronizado();
    await assert.rejects(
      () => bridgeService.montarPayloadAbrirCompra(docSemProcessar.id),
      (err) => err.statusCode === 400 && err.message.includes('não processado')
    );
  });

  await test('alterarStatusManual bloqueia não-admin', async () => {
    const orchestrator = new CentralEntradasOrchestrator({
      documentosRepository,
      historicoRepository,
      transitionService,
      processamentoService,
      comprasBridgeService: bridgeService
    });

    const doc = await criarDocumentoSincronizado();

    await assert.rejects(
      () => orchestrator.alterarStatusManual(doc.id, DocumentoFiscalStatus.DESCARTADA, {
        perfilUsuario: 'USUARIO',
        roleUsuario: 'operador'
      }),
      (err) => err.statusCode === 403
    );
  });

  await test('alterarStatusManual permite admin e usa transição', async () => {
    const orchestrator = new CentralEntradasOrchestrator({
      documentosRepository,
      historicoRepository,
      transitionService,
      processamentoService,
      comprasBridgeService: bridgeService
    });

    const doc = await criarDocumentoSincronizado();

    const atualizado = await orchestrator.alterarStatusManual(
      doc.id,
      DocumentoFiscalStatus.DESCARTADA,
      {
        perfilUsuario: 'ADMIN',
        usuarioId: 1,
        usuarioNome: 'admin-teste'
      }
    );

    assert.strictEqual(atualizado.status, DocumentoFiscalStatus.DESCARTADA);
  });

  await test('notificação de sync consolidada — uma por sincronização', async () => {
    const notifService = new CentralNotificacoesService();
    const antes = await notifService.listar({ limite: 500 });

    await notifService.notificarSyncConcluida({
      notasNovas: 4,
      sucesso: true,
      origem: 'teste-rc1'
    });

    const depois = await notifService.listar({ limite: 500 });
    assert.strictEqual(depois.length, antes.length + 1);

    const ultima = depois[0];
    assert.strictEqual(ultima.tipo, 'NOVAS_NOTAS');
    assert.ok(ultima.mensagem.includes('4 novas notas fiscais'));
  });

  await test('listarPendentesProcessamento retorna apenas SINCRONIZADA sem parse', async () => {
    const doc = await criarDocumentoSincronizado();
    const pendentes = await documentosRepository.listarPendentesProcessamento(10);
    assert.ok(pendentes.some((p) => p.id === doc.id));

    await processamentoService.processar(doc.id);
    const apos = await documentosRepository.listarPendentesProcessamento(10);
    assert.ok(!apos.some((p) => p.id === doc.id));
  });

  await test('health RC1 expõe versão consolidada', async () => {
    const orchestrator = new CentralEntradasOrchestrator();
    const health = await orchestrator.obterHealth();
    assert.ok(/^RC[2-9]$/.test(health.sprint), `health.sprint: ${health.sprint}`);
    assert.ok(/rc[2-9]/.test(health.versao), `versao inesperada: ${health.versao}`);
  });

  await limparDocumentoTeste();

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
