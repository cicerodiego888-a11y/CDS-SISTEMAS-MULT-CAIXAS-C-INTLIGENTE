/**
 * Testes — Central de Entradas Sprint 2 (backend funcional)
 * Executar: npm run test:central-entradas
 */

const assert = require('assert');
const CentralEntradasService = require('../../backend/motores/central-entradas/CentralEntradasService');
const CentralDocumentosRepository = require('../../backend/motores/central-entradas/repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../../backend/motores/central-entradas/repositories/CentralHistoricoRepository');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');

let passou = 0;
let falhou = 0;
const CHAVE_TESTE = '23250699999999000199550010000009991000000099';
const OPCOES_ADMIN = {
  perfilUsuario: 'ADMIN',
  roleUsuario: 'admin',
  usuarioId: 1,
  usuarioNome: 'admin-teste'
};

const service = new CentralEntradasService();
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

async function limparTeste() {
  const existente = await documentosRepository.buscarPorChave(CHAVE_TESTE);
  if (!existente) return;

  await historicoRepository._obterSql().run(
    'DELETE FROM central_entradas_historico WHERE documento_id = ?',
    [existente.id]
  );
  await documentosRepository.remover(existente.id);
}

async function criarDocumentoTeste() {
  await limparTeste();

  const documento = await documentosRepository.inserir({
    chave: CHAVE_TESTE,
    numero: '9999',
    serie: '1',
    fornecedor: 'Fornecedor Teste Sprint 2',
    cnpjFornecedor: '99999999000199',
    dataEmissao: '2026-07-01',
    valorTotal: 500,
    xml: '<nfeProc><NFe/></nfeProc>',
    origem: 'upload_manual',
    status: DocumentoFiscalStatus.SINCRONIZADA
  });

  await historicoRepository.inserir({
    documentoId: documento.id,
    statusAnterior: null,
    statusNovo: DocumentoFiscalStatus.SINCRONIZADA,
    detalhe: 'Registro inicial de teste'
  });

  return documento;
}

async function main() {
  console.log('\n=== Testes Central de Entradas — Sprint 2 ===\n');

  await documentosRepository._obterSql().whenReady();

  await test('health retorna sprint RC2', async () => {
    const health = await service.obterHealth();
    assert.ok(/^RC[2-9]$/.test(health.sprint), `health.sprint: ${health.sprint}`);
    assert.strictEqual(health.status, 'ok');
  });

  await test('dashboard retorna contadores', async () => {
    const dashboard = await service.obterDashboard();
    assert.ok(dashboard.contadores);
    assert.ok(typeof dashboard.contadores.total === 'number');
    assert.ok(dashboard.contadores.porStatus);
  });

  let documentoTeste;

  await test('cria documento de teste', async () => {
    documentoTeste = await criarDocumentoTeste();
    assert.ok(documentoTeste.id);
  });

  await test('listagem com paginação e busca', async () => {
    const resultado = await service.listarDocumentos({
      busca: 'Fornecedor Teste Sprint 2',
      limite: 5,
      pagina: 1,
      ordenarPor: 'valor_total',
      ordenarDirecao: 'desc'
    });

    assert.ok(Array.isArray(resultado.documentos));
    assert.ok(resultado.paginacao);
    assert.strictEqual(resultado.paginacao.limite, 5);
    assert.ok(resultado.documentos.some((doc) => doc.chave === CHAVE_TESTE));
  });

  await test('detalhe retorna documento e histórico', async () => {
    const detalhe = await service.obterDocumentoDetalhe(documentoTeste.id);
    assert.ok(detalhe.documento);
    assert.strictEqual(detalhe.documento.chave, CHAVE_TESTE);
    assert.ok(Array.isArray(detalhe.historico));
    assert.ok(detalhe.historico.length >= 1);
    assert.strictEqual(detalhe.documento.xmlDisponivel, true);
  });

  await test('PATCH status válido registra histórico', async () => {
    const atualizado = await service.alterarStatus(
      documentoTeste.id,
      DocumentoFiscalStatus.EM_PROCESSAMENTO,
      { detalhe: 'Teste de transição', ...OPCOES_ADMIN }
    );

    assert.strictEqual(atualizado.status, DocumentoFiscalStatus.EM_PROCESSAMENTO);

    const historico = await service.obterHistorico(documentoTeste.id);
    const transicao = historico.find((h) => h.statusNovo === DocumentoFiscalStatus.EM_PROCESSAMENTO);
    assert.ok(transicao);
    assert.strictEqual(transicao.statusAnterior, DocumentoFiscalStatus.SINCRONIZADA);
  });

  await test('PATCH status inválido é rejeitado', async () => {
    let erroCapturado = null;
    try {
      await service.alterarStatus(documentoTeste.id, DocumentoFiscalStatus.GRAVADA, OPCOES_ADMIN);
    } catch (error) {
      erroCapturado = error;
    }

    assert.ok(erroCapturado);
    assert.strictEqual(erroCapturado.statusCode, 400);
  });

  await test('filtro por status funciona', async () => {
    const resultado = await service.listarDocumentos({
      status: DocumentoFiscalStatus.EM_PROCESSAMENTO,
      busca: 'Fornecedor Teste Sprint 2'
    });

    assert.strictEqual(resultado.documentos.length, 1);
    assert.strictEqual(resultado.documentos[0].status, DocumentoFiscalStatus.EM_PROCESSAMENTO);
  });

  await limparTeste();

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Erro fatal nos testes:', error);
  process.exit(1);
});
