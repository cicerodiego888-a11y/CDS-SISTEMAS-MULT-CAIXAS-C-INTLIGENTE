/**
 * Testes — MiipImportacaoXmlService (Sprint 6A)
 * Executar: npm run test:miip-importacao-xml
 */

const assert = require('assert');
const { MiipService } = require('../../backend/motores/miip/MiipService');
const MiipImportacaoXmlService = require('../../backend/motores/miip/services/MiipImportacaoXmlService');
const MiipResult = require('../../backend/motores/miip/core/MiipResult');
const MiipScore = require('../../backend/motores/miip/core/MiipScore');
const MiipAction = require('../../backend/motores/miip/core/MiipAction');
const ProdutoCandidatoDTO = require('../../backend/motores/miip/contracts/ProdutoCandidatoDTO');
const { MiipFeatureFlags } = require('../../backend/motores/miip/config/miipFeatureFlags');
const { MiipIntegracaoLogService } = require('../../backend/motores/miip/logs/MiipIntegracaoLogService');

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

function criarCandidato(opcoes = {}) {
  return ProdutoCandidatoDTO.create({
    produtoId: opcoes.produtoId ?? 10,
    nome: opcoes.nome ?? 'Produto Teste',
    codigo: opcoes.codigo ?? 'P10',
    codigoBarras: opcoes.codigoBarras ?? '7891111111111',
    scoreParcial: opcoes.score ?? 100,
    scorePonderado: opcoes.score ?? 100,
    scoreTotal: opcoes.score ?? 100,
    motorOrigem: opcoes.motor ?? 'motor_gtin',
    motoresQueVotaram: [opcoes.motor ?? 'motor_gtin'],
    confianca: opcoes.confianca ?? 'ALTA',
    evidencias: [{ tipo: 'teste', valor: 'ok' }]
  });
}

function criarMiipResp(opcoes = {}) {
  const candidatos = Array.isArray(opcoes.candidatos) ? opcoes.candidatos : [];
  const melhor = candidatos[0] ?? null;
  const produtoId = melhor ? Number(melhor.produtoId) : null;
  const acao = opcoes.acao ?? (produtoId ? MiipAction.AUTO_VINCULAR : MiipAction.CRIAR_NOVO);

  return {
    encontrado: produtoId != null,
    produtoId,
    resultado: MiipResult.create({
      decisao: {
        acao,
        confianca: opcoes.confianca ?? (melhor?.confianca ?? 'NENHUMA'),
        melhorCandidato: melhor,
        conflito: Boolean(opcoes.conflito),
        motivos: opcoes.motivos ?? [],
        precisaConfirmacao: opcoes.precisaConfirmacao ?? (
          acao === MiipAction.SUGERIR || acao === MiipAction.REVISAR_MANUAL
        ),
        precisaCadastro: opcoes.precisaCadastro ?? (acao === MiipAction.CRIAR_NOVO),
        score: opcoes.score ?? (melhor?.scoreTotal ?? 0)
      },
      score: MiipScore.create({
        valor: opcoes.score ?? (melhor?.scoreTotal ?? 0),
        gap: opcoes.gap ?? null
      }),
      candidatos,
      enginesExecutados: opcoes.engines ?? (melhor ? [melhor.motorOrigem] : []),
      requestId: opcoes.requestId ?? 'req-test',
      duracaoTotalMs: 1
    })
  };
}

function criarIdentificarMock(mapaPorIndice = {}) {
  return async (item, contexto) => {
    const indice = Number(item?._indiceTeste ?? 0);
    if (typeof mapaPorIndice[indice] === 'function') {
      return mapaPorIndice[indice](item, contexto);
    }
    return mapaPorIndice[indice] ?? criarMiipResp();
  };
}

function criarXmlBase(itens = []) {
  return {
    chave_acesso: '35260100000000000000550010000000011000000001',
    fornecedor: 'Fornecedor ABC',
    fornecedor_cnpj: '12345678000199',
    itens
  };
}

function criarItemXml(sufixo = '1') {
  return {
    produto_nome: `Produto XML ${sufixo}`,
    codigo_fornecedor: `C${sufixo}`,
    codigo_barras: `789111111111${sufixo}`,
    ncm: '10063021',
    unidade: 'UN',
    quantidade: 1,
    preco_unitario: 10,
    subtotal: 10
  };
}

function criarService(opcoes = {}) {
  const featureFlags = new MiipFeatureFlags();
  if (opcoes.usarMiip === false) featureFlags.definirUsarMiip(false);
  if (opcoes.usarMiipImportacaoXML === false) featureFlags.definirUsarMiipImportacaoXML(false);

  const integracaoLog = opcoes.integracaoLog ?? new MiipIntegracaoLogService();
  const importacaoXmlService = new MiipImportacaoXmlService({ integracaoLog });

  const miipServiceMock = {
    identificar: opcoes.identificar ?? (async () => criarMiipResp()),
    estaHabilitado: () => featureFlags.estaHabilitado(),
    estaImportacaoXmlHabilitada: () => featureFlags.estaImportacaoXmlHabilitada(),
    registrarIntegracao: (dados) => integracaoLog.registrar(dados)
  };

  importacaoXmlService.definirMiipService(miipServiceMock);

  const service = new MiipService({
    inicializar: () => {},
    featureFlags,
    integracaoLog,
    configuracoesRepository: {
      async buscarPorChave() {
        return null;
      },
      parseValor() {
        return true;
      }
    }
  });

  importacaoXmlService.definirMiipService(miipServiceMock);
  service._importacaoXmlService = importacaoXmlService;

  return { service, importacaoXmlService, integracaoLog, featureFlags, miipServiceMock };
}

async function main() {
  console.log('\n=== Testes MiipImportacaoXml — MIIP (Sprint 6A) ===\n');

  await test('feature flag desligada retorna null (fluxo legado)', async () => {
    const { service, integracaoLog } = criarService({ usarMiipImportacaoXML: false });
    integracaoLog.reiniciar();

    const resultado = await service.processarImportacaoXml(criarXmlBase([criarItemXml()]));

    assert.strictEqual(resultado, null);
    const logs = integracaoLog.listar({ evento: 'importacao_xml_legado' });
    assert.ok(logs.length >= 1);
  });

  await test('feature flag ligada processa todos os itens pelo MIIP', async () => {
    const { service } = criarService({
      identificar: async () => criarMiipResp({
        candidatos: [criarCandidato({ produtoId: 50, score: 100, motor: 'motor_gtin' })],
        score: 100
      })
    });

    const resultado = await service.processarImportacaoXml(criarXmlBase([
      criarItemXml('1'),
      criarItemXml('2')
    ]));

    assert.ok(resultado);
    assert.strictEqual(resultado.usarMiipImportacaoXML, true);
    assert.strictEqual(resultado.resumo.totalItens, 2);
    assert.strictEqual(resultado.resultados.length, 2);
  });

  await test('XML com todos os produtos encontrados — associação automática', async () => {
    const { service } = criarService({
      identificar: async () => criarMiipResp({
        candidatos: [criarCandidato({ produtoId: 11, score: 100, motor: 'motor_gtin' })],
        score: 100,
        acao: MiipAction.AUTO_VINCULAR
      })
    });

    const resultado = await service.processarImportacaoXml(criarXmlBase([
      criarItemXml('1'),
      criarItemXml('2')
    ]));

    assert.strictEqual(resultado.resumo.identificadosAutomaticamente, 2);
    assert.strictEqual(resultado.resumo.precisamConfirmacao, 0);
    assert.strictEqual(resultado.resumo.precisamCadastro, 0);
    assert.strictEqual(resultado.resultados.every((r) => r.associadoAutomaticamente), true);
  });

  await test('XML parcialmente encontrado — mix automático, confirmação e cadastro', async () => {
    const respostas = [
      criarMiipResp({
        candidatos: [criarCandidato({ produtoId: 20, score: 100, motor: 'motor_gtin' })],
        score: 100
      }),
      criarMiipResp({
        candidatos: [
          criarCandidato({ produtoId: 21, score: 88, motor: 'motor_gtin' }),
          criarCandidato({ produtoId: 22, score: 70, motor: 'motor_gtin' })
        ],
        score: 88,
        acao: MiipAction.SUGERIR,
        confianca: 'MEDIA'
      }),
      criarMiipResp({ candidatos: [], score: 0, acao: MiipAction.CRIAR_NOVO })
    ];
    let chamadas = 0;

    const { service } = criarService({
      identificar: async () => {
        const resp = respostas[chamadas] ?? respostas[respostas.length - 1];
        chamadas += 1;
        return resp;
      }
    });

    const resultado = await service.processarImportacaoXml(criarXmlBase([
      criarItemXml('1'),
      criarItemXml('2'),
      criarItemXml('3')
    ]));

    assert.strictEqual(resultado.resumo.identificadosAutomaticamente, 1);
    assert.strictEqual(resultado.resumo.precisamConfirmacao, 1);
    assert.strictEqual(resultado.resumo.precisamCadastro, 1);
  });

  await test('XML sem nenhum produto encontrado — todos precisam cadastro', async () => {
    const { service } = criarService({
      identificar: async () => criarMiipResp({ candidatos: [], score: 0 })
    });

    const resultado = await service.processarImportacaoXml(criarXmlBase([
      criarItemXml('1'),
      criarItemXml('2')
    ]));

    assert.strictEqual(resultado.resumo.identificadosAutomaticamente, 0);
    assert.strictEqual(resultado.resumo.precisamConfirmacao, 0);
    assert.strictEqual(resultado.resumo.precisamCadastro, 2);
  });

  await test('XML com fornecedor conhecido — associação por MotorAssociacaoFornecedor', async () => {
    const { service } = criarService({
      identificar: async () => criarMiipResp({
        candidatos: [criarCandidato({
          produtoId: 30,
          score: 100,
          motor: 'motor_associacao_fornecedor',
          nome: 'Arroz Integral'
        })],
        score: 100,
        engines: ['motor_associacao_fornecedor'],
        motivos: ['fornecedor_aprendido_100']
      })
    });

    const resultado = await service.processarImportacaoXml(criarXmlBase([criarItemXml('A')]));

    assert.strictEqual(resultado.resultados[0].associadoAutomaticamente, true);
    assert.strictEqual(resultado.resultados[0].motor, 'motor_associacao_fornecedor');
    assert.strictEqual(resultado.resultados[0].produtoEncontrado.id, 30);
    assert.ok(resultado.resultados[0].motivos.includes('fornecedor_aprendido_100'));
  });

  await test('XML com fornecedor desconhecido — sem GTIN cai em cadastro', async () => {
    const { service } = criarService({
      identificar: async () => criarMiipResp({ candidatos: [], score: 0 })
    });

    const xml = criarXmlBase([{
      produto_nome: 'Item sem referência',
      codigo_fornecedor: 'DESCONHECIDO',
      codigo_barras: '',
      ncm: '22021000',
      unidade: 'UN',
      quantidade: 2,
      preco_unitario: 5,
      subtotal: 10
    }]);
    xml.fornecedor_cnpj = '';

    const resultado = await service.processarImportacaoXml(xml);

    assert.strictEqual(resultado.resumo.precisamCadastro, 1);
    assert.strictEqual(resultado.resultados[0].precisaConfirmacao, false);
    assert.strictEqual(resultado.resultados[0].associadoAutomaticamente, false);
  });

  await test('score 95+ com gap suficiente marca precisaConfirmacao', async () => {
    const { service } = criarService({
      identificar: async () => criarMiipResp({
        candidatos: [
          criarCandidato({ produtoId: 40, score: 96, motor: 'motor_gtin' }),
          criarCandidato({ produtoId: 41, score: 88, motor: 'motor_gtin' })
        ],
        score: 96,
        acao: MiipAction.SUGERIR,
        confianca: 'ALTA',
        motivos: ['score_alto_gap_suficiente'],
        precisaConfirmacao: true
      })
    });

    const resultado = await service.processarImportacaoXml(criarXmlBase([criarItemXml()]));

    assert.strictEqual(resultado.resultados[0].precisaConfirmacao, true);
    assert.strictEqual(resultado.resultados[0].associadoAutomaticamente, false);
    assert.ok(resultado.resultados[0].motivos.includes('score_alto_gap_suficiente'));
  });

  await test('registra log de importação com resumo', async () => {
    const integracaoLog = new MiipIntegracaoLogService();
    const { service } = criarService({
      integracaoLog,
      identificar: async () => criarMiipResp({
        candidatos: [criarCandidato({ produtoId: 55, score: 100 })],
        score: 100
      })
    });

    integracaoLog.reiniciar();
    await service.processarImportacaoXml(criarXmlBase([criarItemXml()]));

    const logs = integracaoLog.listar({ evento: 'importacao_xml_concluida' });
    assert.ok(logs.length >= 1);
    assert.strictEqual(logs[0].ponto, 'importacao_xml');
    assert.ok(logs[0].duracaoMs >= 0);
  });

  await test('sessão em memória disponível após processamento', async () => {
    const { service } = criarService({
      identificar: async () => criarMiipResp({
        candidatos: [criarCandidato({ produtoId: 60, score: 100 })],
        score: 100
      })
    });

    await service.processarImportacaoXml(criarXmlBase([criarItemXml()]));
    const sessao = service.obterUltimaImportacaoXml();

    assert.ok(sessao);
    assert.strictEqual(sessao.resumo.totalItens, 1);
    assert.ok(sessao.processadoEm);
  });

  await test('paraSugestaoUi gera formato compatível com UI existente', () => {
    const sugestao = MiipImportacaoXmlService.paraSugestaoUi({
      indice: 0,
      precisaConfirmacao: true,
      produtoEncontrado: { id: 77, nome: 'Leite', codigo: 'L77', codigoBarras: '789' },
      nivelCerteza: 'MEDIA',
      motor: 'motor_gtin',
      score: 85,
      acao: 'sugerir',
      operacaoId: 'op-1'
    });

    assert.ok(sugestao);
    assert.strictEqual(sugestao.produtoId, 77);
    assert.strictEqual(sugestao.status, 'pendente');
    assert.strictEqual(sugestao.encontrado, true);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
