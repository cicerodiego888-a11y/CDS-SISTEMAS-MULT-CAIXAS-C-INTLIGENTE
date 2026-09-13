/**
 * Testes — Central de Entradas Sprint 7 (inteligência operacional)
 * Executar: npm run test:central-entradas-sprint7
 */

const assert = require('assert');
const CentralEntradasService = require('../../backend/motores/central-entradas/CentralEntradasService');
const CentralScoreDocumentoService = require('../../backend/motores/central-entradas/services/CentralScoreDocumentoService');
const CentralDocumentosRepository = require('../../backend/motores/central-entradas/repositories/CentralDocumentosRepository');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const { obterPreset, listarPresets } = require('../../backend/motores/central-entradas/utils/filtrosRapidosCentral');

let passou = 0;
let falhou = 0;

const service = new CentralEntradasService();
const scoreService = new CentralScoreDocumentoService();
const documentosRepository = new CentralDocumentosRepository();

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

async function main() {
  console.log('\n=== Testes Central de Entradas — Sprint 7 ===\n');

  await documentosRepository._obterSql().whenReady();

  await test('health retorna sprint RC2', async () => {
    const health = await service.obterHealth();
    assert.ok(/^RC[2-9]$/.test(health.sprint), `health.sprint: ${health.sprint}`);
    assert.ok(/rc[2-9]/.test(health.versao), `versao inesperada: ${health.versao}`);
  });

  await test('metadados expõe filtros rápidos', async () => {
    const meta = service.obterMetadados();
    assert.ok(Array.isArray(meta.filtrosRapidos));
    assert.ok(meta.filtrosRapidos.length >= 7);
    assert.ok(listarPresets().some((p) => p.codigo === 'pendentes'));
  });

  await test('score documento GRAVADA com MIIP alto', async () => {
    const score = scoreService.calcular({
      status: DocumentoFiscalStatus.GRAVADA,
      miipResumoJson: {
        resumo: {
          totalItens: 10,
          identificadosAutomaticamente: 10,
          precisamConfirmacao: 0,
          precisamCadastro: 0
        }
      },
      createdAt: new Date().toISOString(),
      processadoEm: new Date().toISOString()
    });

    assert.ok(score.scoreGeral >= 90);
    assert.strictEqual(typeof score.cor, 'string');
    assert.ok(score.fatores.length >= 3);
  });

  await test('score documento ERRO é baixo', async () => {
    const score = scoreService.calcular({
      status: DocumentoFiscalStatus.ERRO,
      statusDetalhe: 'Falha no parse',
      createdAt: new Date(Date.now() - 86400000).toISOString()
    });

    assert.ok(score.scoreGeral < 50);
  });

  await test('score documento com pendências MIIP reduz valor', async () => {
    const bom = scoreService.calcular({
      status: DocumentoFiscalStatus.AGUARDANDO_REVISAO,
      miipResumoJson: {
        resumo: {
          totalItens: 4,
          identificadosAutomaticamente: 4,
          precisamConfirmacao: 0,
          precisamCadastro: 0
        }
      },
      createdAt: new Date().toISOString()
    });

    const ruim = scoreService.calcular({
      status: DocumentoFiscalStatus.AGUARDANDO_REVISAO,
      miipResumoJson: {
        resumo: {
          totalItens: 4,
          identificadosAutomaticamente: 1,
          precisamConfirmacao: 2,
          precisamCadastro: 1
        }
      },
      createdAt: new Date().toISOString()
    });

    assert.ok(ruim.scoreGeral < bom.scoreGeral);
  });

  await test('GET operacional retorna indicadores esperados', async () => {
    const op = await service.obterOperacional();
    assert.ok('valorTotalMes' in op);
    assert.ok('tempoMedioProcessamentoMinutos' in op);
    assert.ok('taxaIdentificacaoAutomatica' in op);
    assert.ok('taxaRevisaoManual' in op);
    assert.ok('comprasConcluidasHoje' in op);
    assert.ok('pendenciasCriticas' in op);
    assert.ok(op.filas);
  });

  await test('GET alertas retorna estrutura de alerta', async () => {
    const resultado = await service.listarAlertas();
    assert.ok(Array.isArray(resultado.alertas));
    assert.ok(typeof resultado.total === 'number');

    resultado.alertas.forEach((alerta) => {
      assert.ok(alerta.tipo);
      assert.ok(alerta.gravidade);
      assert.ok(alerta.icone);
      assert.ok(alerta.cor);
      assert.ok(alerta.descricao);
      assert.ok(alerta.acaoSugerida);
    });
  });

  await test('GET pendencias retorna seções', async () => {
    const pendencias = await service.obterPendencias({ limite: 5 });
    assert.ok(pendencias.resumo);
    assert.ok(pendencias.secoes);
    assert.ok(Array.isArray(pendencias.secoes.aguardandoRevisao));
    assert.ok(Array.isArray(pendencias.secoes.alertas));
  });

  await test('GET atencao retorna itens acionáveis', async () => {
    const atencao = await service.obterItensAtencao();
    assert.ok(Array.isArray(atencao.itens));
    atencao.itens.forEach((item) => {
      assert.ok(item.mensagem);
      assert.ok(item.acao);
      assert.ok(item.acao.tipo);
    });
  });

  await test('filtro rápido pendentes define statusIn', async () => {
    const preset = obterPreset('pendentes');
    assert.ok(preset.statusIn?.length >= 3);
  });

  await test('listagem com filtro_rapido não lança erro', async () => {
    const resultado = await service.listarDocumentos({ filtroRapido: 'ultimos_30_dias', limite: 5 });
    assert.ok(Array.isArray(resultado.documentos));
    assert.ok(resultado.paginacao);
  });

  console.log(`\n--- Resultado: ${passou} passou, ${falhou} falhou ---\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
