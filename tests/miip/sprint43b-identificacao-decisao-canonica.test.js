'use strict';

/**
 * Sprint 4.3B — identificação de produtos: decisão canônica e resultado gravado por regra anterior.
 *
 * Caso real: "POLPA MARACUJA 400G" (fornecedor de polpas, cProd 1, SEM GTIN) aparecia com
 * "Frango do Dia" (código interno 1, PLU 1) e 70/100, embora a decisão gravada fosse cadastrar novo.
 *
 * Identificação: serviço MIIP real (pipeline, política V2, motores de barras, fornecedor e MUBC)
 * sobre SQLite em memória. Central: serviços reais com repositório em memória. Tela: revisão real
 * (miip-central-revisao*.js) em vm. Nenhum banco do CDS é aberto, nada é gravado.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sqlite3 = require('sqlite3');

const MiipAction = require('../../backend/motores/miip/core/MiipAction');
const {
  CRITERIOS,
  VERSAO_REGRA_IDENTIFICACAO,
  aplicarPoliticaNoResultado
} = require('../../backend/motores/miip/core/MiipIdentificacaoV2Policy');
const { MiipService } = require('../../backend/motores/miip/MiipService');
const { MiipOrchestrator } = require('../../backend/motores/miip/MiipOrchestrator');
const { criarPipelinePadrao } = require('../../backend/motores/miip/core/MiipPipelineFactory');
const { MotorRegistry } = require('../../backend/motores/miip/core/MotorRegistry');
const MotorGTIN = require('../../backend/motores/miip/engines/gtin/MotorGTIN');
const MotorAssociacaoFornecedor = require('../../backend/motores/miip/engines/fornecedor/MotorAssociacaoFornecedor');
const MotorUniversalBuscaCandidatos = require('../../backend/motores/miip/engines/mubc/MotorUniversalBuscaCandidatos');
const { ProdutoRepository } = require('../../backend/motores/miip/repositories/ProdutoRepository');
const { MiipAssociacoesRepository } = require('../../backend/motores/miip/repositories/MiipAssociacoesRepository');
const produtoCache = require('../../backend/motores/miip/cache/ProdutoCache');
const { mapearDecisaoPipelineParaImportacao } = require('../../backend/motores/miip/utils/MiipResultadoImportacaoMapper');
const MiipImportacaoXmlService = require('../../backend/motores/miip/services/MiipImportacaoXmlService');
const {
  revalidarResultadoPersistido,
  revalidarParseMiipPersistido
} = require('../../backend/motores/miip/utils/MiipRevalidacaoResultadoPersistido');
const { MiipFeatureFlags } = require('../../backend/motores/miip/config/miipFeatureFlags');
const { MiipIntegracaoLogService } = require('../../backend/motores/miip/logs/MiipIntegracaoLogService');
const CentralComprasBridgeService = require('../../backend/motores/central-entradas/services/CentralComprasBridgeService');
const CentralProcessamentoService = require('../../backend/motores/central-entradas/services/CentralProcessamentoService');
const CentralRevisaoPersistenteService = require('../../backend/motores/central-entradas/services/CentralRevisaoPersistenteService');

const CNPJ_POLPAS = '11111111000191';
const CNPJ_OUTRO = '22222222000191';
const GTIN_REFRI = '7898043912755';

const FRANGO = { id: 763, codigo: '1', nome: 'Frango do Dia', unidade: 'KG', ncm: null, ativo: 1 };
const REFRI = { id: 901, codigo: '901', nome: 'Refrigerante Cola 2L', unidade: 'UN', ncm: '22021000', codigo_barras: GTIN_REFRI, ativo: 1 };
const MARACUJA = { id: 904, codigo: '904', nome: 'Polpa de Maracuja 400g', unidade: 'UN', ncm: '20089900', ativo: 1 };
const CAD_SEM_GTIN = { id: 905, codigo: '905', nome: 'Cadastro Com Texto Sem Gtin', unidade: 'UN', ncm: null, codigo_barras: 'SEM GTIN', ativo: 1 };
const CAD_ZERADO = { id: 906, codigo: '906', nome: 'Cadastro Com Codigo Zerado', unidade: 'UN', ncm: null, codigo_barras: '00000000', ativo: 1 };

const stubLog = { registrar() {} };
const stubMetricas = { registrarExecucao() {} };

function executar(db, sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, (e) => (e ? reject(e) : resolve())));
}

async function criarBanco(produtos, associacoes = []) {
  const db = new sqlite3.Database(':memory:');
  await executar(db, 'CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT)');
  await executar(db, `CREATE TABLE produtos (id INTEGER PRIMARY KEY, codigo TEXT, codigo_barras TEXT, nome TEXT,
    unidade TEXT, ncm TEXT, cest TEXT, categoria_id INTEGER, subcategoria_id INTEGER, fornecedor TEXT,
    ativo INTEGER DEFAULT 1, marca_id INTEGER)`);
  await executar(db, `CREATE TABLE produto_identificadores (id INTEGER PRIMARY KEY, produto_id INTEGER, tipo TEXT,
    codigo TEXT, ativo INTEGER DEFAULT 1)`);
  await executar(db, `CREATE TABLE miip_associacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, produto_id INTEGER NOT NULL,
    origem TEXT NOT NULL DEFAULT 'manual', fornecedor_cnpj TEXT, fornecedor_nome TEXT, codigo_fornecedor TEXT,
    codigo_barras TEXT, nome_item TEXT NOT NULL, nome_normalizado TEXT, ncm TEXT, unidade TEXT, score REAL DEFAULT 0,
    confianca TEXT DEFAULT 'NENHUMA', status TEXT NOT NULL DEFAULT 'ativa', fonte TEXT NOT NULL DEFAULT 'local',
    decisao_operacao_id TEXT, confirmado_por_usuario_id INTEGER, metadados TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_used_at DATETIME)`);
  for (const p of produtos) {
    await executar(db, 'INSERT INTO produtos (id, codigo, codigo_barras, nome, unidade, ncm, ativo) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [p.id, p.codigo, p.codigo_barras ?? null, p.nome, p.unidade, p.ncm, p.ativo]);
  }
  await executar(db, "INSERT INTO produto_identificadores (produto_id, tipo, codigo) VALUES (763, 'PLU', '1'), (763, 'INTERNO', '1')");
  for (const a of associacoes) {
    await executar(db, `INSERT INTO miip_associacoes (produto_id, origem, fornecedor_cnpj, codigo_fornecedor, nome_item, status)
      VALUES (?, ?, ?, ?, ?, 'ativa')`, [a.produtoId, a.origem, a.cnpj, a.cProd, a.nome || 'ITEM']);
  }
  return db;
}

function criarMiip(db) {
  const produtoRepository = new ProdutoRepository({ db, isMipEnabled: () => false });
  const associacoesRepository = new MiipAssociacoesRepository({ db });
  const comum = { produtoRepository, metricsCollector: stubMetricas, logService: stubLog };
  const registry = new MotorRegistry();
  registry.registrar({ codigo: 'motor_gtin', Classe: MotorGTIN, ativo: true, prioridade: 40, meta: { config: comum } });
  registry.registrar({
    codigo: 'motor_associacao_fornecedor', Classe: MotorAssociacaoFornecedor, ativo: true, prioridade: 50,
    meta: { config: { ...comum, associacoesRepository } }
  });
  registry.registrar({ codigo: 'motor_mubc', Classe: MotorUniversalBuscaCandidatos, ativo: true, prioridade: 55, meta: { config: comum } });
  const pipeline = criarPipelinePadrao({ motorRegistry: registry, configuracoesRepository: { async buscarPorChave() { return null; } } });
  return new MiipService({
    orchestrator: new MiipOrchestrator({ pipeline }),
    inicializar: () => {},
    featureFlags: new MiipFeatureFlags(),
    integracaoLog: new MiipIntegracaoLogService(),
    configuracoesRepository: { async buscarPorChave() { return null; }, parseValor() { return true; } }
  });
}

const polpa = (extras = {}) => ({
  produto_nome: 'POLPA MARACUJA 400G',
  codigo_fornecedor: '1',
  codigo_barras: 'SEM GTIN',
  ncm: '20089900',
  unidade: 'UN',
  quantidade: 10,
  preco_unitario: 5,
  fornecedor_cnpj: CNPJ_POLPAS,
  ...extras
});

async function identificar(produtos, associacoes, item) {
  const db = await criarBanco(produtos, associacoes);
  try {
    const r = await criarMiip(db).identificar(item);
    const importacao = mapearDecisaoPipelineParaImportacao(null, r.resultado);
    return { r, importacao, ids: (r.resultado.candidatos || []).map((c) => Number(c.produtoId)) };
  } finally {
    db.close();
  }
}

/** Decisão canônica "cadastrar produto novo": nada de candidato, pontuação ou pergunta "É este?". */
function cadastroNovoCanonico(importacao) {
  assert.equal(importacao.acao, MiipAction.CRIAR_NOVO);
  assert.equal(importacao.produtoEncontrado, null);
  assert.equal(importacao.candidatoSelecionado, null);
  assert.deepEqual(importacao.candidatos, []);
  assert.equal(importacao.score, 0);
  assert.equal(importacao.motor, null);
  assert.equal(importacao.precisaConfirmacao, false);
  assert.equal(importacao.precisaCadastro, true);
  assert.equal(importacao.associadoAutomaticamente, false);
  assert.equal(MiipImportacaoXmlService.paraSugestaoUi(importacao), null, 'sem sugestão para a tela de Compras');
}

/** Contadores sempre recontados a partir das decisões dos itens. */
function contadoresCoerentes(bloco) {
  const r = bloco.resultados;
  assert.equal(bloco.resumo.totalItens, r.length);
  assert.equal(bloco.resumo.identificadosAutomaticamente, r.filter((x) => x.associadoAutomaticamente).length);
  assert.equal(bloco.resumo.precisamConfirmacao, r.filter((x) => x.precisaConfirmacao).length);
  assert.equal(bloco.resumo.precisamCadastro, r.filter((x) => x.precisaCadastro).length);
  r.forEach((x) => {
    assert.equal(x.precisaConfirmacao && x.precisaCadastro, false, `item ${x.indice}: confirmação e cadastro ao mesmo tempo`);
  });
}

// ─── Resultado gravado pela regra anterior (formato do doc 264) ────────────────────────────

const PRODUTO_FRANGO_GRAVADO = { id: 763, nome: 'Frango do Dia', codigo: '1', unidade: 'KG', ativo: 1 };

function candidatoGravado({ produto, score, motores, evidencias, motivosRelevancia }) {
  return {
    produtoId: produto.id,
    scoreTotal: score,
    confianca: 'MEDIA',
    ranking: 1,
    snapshot: { ...produto },
    produto: { ...produto },
    motoresQueVotaram: motores,
    motorOrigem: motores[0],
    evidencias,
    atributosExtraidos: motivosRelevancia ? { origemDados: 'MUBC', motivosRelevancia } : undefined
  };
}

function resultadoGravado({ indice = 0, item, candidato, acao, precisaConfirmacao, precisaCadastro, associado = false }) {
  return {
    indice,
    produtoXML: item,
    produtoEncontrado: { ...candidato.produto },
    nivelCerteza: 'BAIXA',
    acao,
    motivos: ['score_baixo'],
    candidatoSelecionado: candidato,
    precisaConfirmacao,
    precisaCadastro,
    associadoAutomaticamente: associado,
    score: candidato.scoreTotal,
    motor: candidato.motorOrigem,
    operacaoId: `op-legado-${indice}`,
    mie: null,
    candidatos: [{
      ranking: 1,
      produtoId: candidato.produtoId,
      score: candidato.scoreTotal,
      confianca: candidato.confianca,
      produto: candidato.produto,
      evidencias: candidato.evidencias,
      motores: candidato.motoresQueVotaram,
      motivos: (candidato.atributosExtraidos?.motivosRelevancia || []).map((m) => m.rotulo)
    }],
    diagnosticoBusca: null
  };
}

/** Frango por coincidência de cProd = código interno (82 − 12 de unidade diferente = 70). */
function frangoGravadoParaPolpa(extras = {}) {
  const candidato = candidatoGravado({
    produto: PRODUTO_FRANGO_GRAVADO,
    score: 70,
    motores: ['motor_mubc'],
    evidencias: [
      { motor: 'motor_mubc', tipo: 'codigo_fornecedor', descricao: 'Código fornecedor', valor: 'codigo_fornecedor' },
      { motor: 'motor_mubc', tipo: 'unidade_diff', descricao: 'Unidade diferente', valor: 'unidade_diff' }
    ],
    motivosRelevancia: [
      { tipo: 'codigo_fornecedor', rotulo: 'Código fornecedor' },
      { tipo: 'unidade_diff', rotulo: 'Unidade diferente' }
    ]
  });
  const item = polpa();
  delete item.fornecedor_cnpj;
  return resultadoGravado({ item, candidato, acao: 'criar_novo', precisaConfirmacao: false, precisaCadastro: true, ...extras });
}

function parseGravado(resultados, itens) {
  return {
    chave_acesso: '35260100000000000000550010000002641000002640',
    fornecedor: 'Fornecedor de polpas (teste)',
    fornecedor_cnpj: CNPJ_POLPAS,
    itens,
    miip_importacao: {
      usarMiipImportacaoXML: true,
      operacaoId: 'op-legado',
      resultados,
      resumo: {
        totalItens: resultados.length,
        identificadosAutomaticamente: resultados.filter((r) => r.associadoAutomaticamente).length,
        precisamConfirmacao: resultados.filter((r) => r.precisaConfirmacao).length,
        precisamCadastro: resultados.filter((r) => r.precisaCadastro).length,
        tempoProcessamento: 12
      }
    }
  };
}

function docLegado264() {
  const resultado = frangoGravadoParaPolpa();
  const item = { ...polpa(), miip_resultado: resultado };
  delete item.fornecedor_cnpj;
  const parse = parseGravado([resultado], [item]);
  return {
    id: 264,
    chave: parse.chave_acesso,
    status: 'AGUARDANDO_REVISAO',
    tipoDocumento: 'PROC_NFE',
    xml: null,
    parseJson: parse,
    miipResumoJson: { operacaoId: 'op-legado', resumo: parse.miip_importacao.resumo, resultados: [resultado] }
  };
}

function repositorioSomenteLeitura(documento) {
  const escritas = [];
  return {
    escritas,
    async buscarPorId(id) { return Number(id) === Number(documento.id) ? documento : null; },
    async atualizar(...args) { escritas.push(args); },
    async inserir(...args) { escritas.push(args); }
  };
}

// ─── Tela de revisão real em vm ─────────────────────────────────────────────────────────────

const raiz = path.resolve(__dirname, '../..');
const JS_INTELIGENTE = fs.readFileSync(path.join(raiz, 'frontend/erp/js/miip-central-revisao-inteligente.js'), 'utf8');
const JS_REVISAO = fs.readFileSync(path.join(raiz, 'frontend/erp/js/miip-central-revisao.js'), 'utf8');

function criarJquery(registro) {
  function no(chave) {
    const alvo = {
      length: 1,
      html(v) {
        if (v === undefined) return registro[chave] || '';
        registro[chave] = String(v);
        return proxy;
      },
      text(v) {
        if (v === undefined) return registro[`${chave}:text`] || '';
        registro[`${chave}:text`] = String(v);
        return proxy;
      },
      append(v) {
        registro[chave] = (registro[chave] || '') + String(v);
        return proxy;
      },
      is() { return false; },
      hasClass() { return false; },
      data() { return undefined; },
      val() { return ''; }
    };
    const proxy = new Proxy(alvo, {
      get(t, k) {
        if (typeof k === 'symbol' || k === 'then') return undefined;
        return k in t ? t[k] : () => proxy;
      }
    });
    return proxy;
  }
  const $ = (sel) => no(typeof sel === 'string' ? sel : '[objeto]');
  $.ajax = () => Promise.resolve({ sucesso: true });
  return $;
}

async function abrirTela(dadosImportacao, produtos) {
  const registro = {};
  const context = {
    console: { info() {}, warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
    setImmediate,
    structuredClone,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    showNotification() {},
    bootstrap: {
      Modal: class {
        show() {}
        hide() {}
        static getOrCreateInstance() { return new this(); }
        static getInstance() { return null; }
      }
    },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ linhas: [], compras: [] }) })
  };
  context.document = { getElementById: () => null, querySelector: () => null, addEventListener() {} };
  context.window = context;
  context.$ = criarJquery(registro);
  context.jQuery = context.$;
  vm.createContext(context);
  vm.runInContext(JS_INTELIGENTE, context, { filename: 'miip-central-revisao-inteligente.js' });
  vm.runInContext(JS_REVISAO, context, { filename: 'miip-central-revisao.js' });
  context.MiipCentralRevisao.iniciar({ apiUrl: '/api', dadosImportacao, produtos, documento: { id: 264 } });
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
  return {
    lista: registro['#miipCentralLista'] || '',
    detalhes: registro['#miipCentralDetalhes'] || '',
    topo: registro['#miipCentralResumo'] || '',
    tudo: Object.values(registro).join('\n')
  };
}

function contagemNoTopo(topo, rotulo) {
  const m = topo.match(new RegExp(`${rotulo}\\s*<strong>(\\d+)<`));
  return m ? Number(m[1]) : null;
}

function itemDaLista(lista, nome) {
  const blocos = lista.split('<button').filter((b) => b.includes(nome));
  assert.equal(blocos.length, 1, `"${nome}" aparece uma vez na lista`);
  return blocos[0];
}

beforeEach(() => produtoCache.limpar());

// ─── 1. Coincidência numérica ───────────────────────────────────────────────────────────────

describe('1. Polpa não é associada ao Frango só porque os códigos numéricos coincidem', () => {
  test('cProd 1 x código interno 1 x PLU 1: Frango não é candidato e a decisão é cadastrar produto novo', async () => {
    const res = await identificar([FRANGO, REFRI], [], polpa());
    assert.equal(res.r.produtoId, null);
    assert.equal(res.ids.includes(763), false);
    assert.equal(res.r.resultado.decisao.criterio, CRITERIOS.SEM_CORRESPONDENCIA);
    cadastroNovoCanonico(res.importacao);
  });

  test('vários fornecedores com cProd 1: nenhum recebe o Frango sem mapeamento próprio', async () => {
    for (const [cnpj, nome] of [[CNPJ_POLPAS, 'POLPA MARACUJA 400G'], [CNPJ_OUTRO, 'SABAO EM BARRA 5UN']]) {
      const res = await identificar([FRANGO], [], polpa({ fornecedor_cnpj: cnpj, produto_nome: nome }));
      assert.equal(res.ids.includes(763), false, nome);
      cadastroNovoCanonico(res.importacao);
    }
  });
});

// ─── 2. Código do fornecedor ≠ código interno ≠ PLU ─────────────────────────────────────────

describe('2. Código do fornecedor não é tratado como código interno CDS nem como PLU', () => {
  function capturarFiltros() {
    const chamadas = [];
    const motor = new MotorUniversalBuscaCandidatos({
      produtoRepository: {
        async buscarCandidatosUniversais(filtros) { chamadas.push(filtros); return []; }
      },
      metricsCollector: stubMetricas,
      logService: stubLog
    });
    return { motor, chamadas };
  }

  test('a busca recebe o cProd fora dos campos de código interno e PLU, mesmo com "codigo" igual ao cProd', async () => {
    const { motor, chamadas } = capturarFiltros();
    await motor.identificar({ produtoNome: 'POLPA MARACUJA 400G', codigo_fornecedor: '1', codigo: '1', unidade: 'UN' });
    assert.equal(chamadas[0].codigoInterno, null);
    assert.equal(chamadas[0].plu, null);
  });

  test('código interno e PLU só valem quando vêm explicitamente nesses campos', async () => {
    const { motor, chamadas } = capturarFiltros();
    await motor.identificar({ produtoNome: 'X', codigo_fornecedor: '1', codigo_interno: '904', plu: '77' });
    assert.equal(chamadas[0].codigoInterno, '904');
    assert.equal(chamadas[0].plu, '77');
  });

  test('candidato gravado com evidência "codigo_fornecedor" vinda da busca não sustenta sugestão', () => {
    const r = revalidarResultadoPersistido(frangoGravadoParaPolpa({ acao: 'sugerir', precisaConfirmacao: true, precisaCadastro: false }), {
      fornecedorCnpj: CNPJ_POLPAS
    });
    cadastroNovoCanonico(r);
  });
});

// ─── 3. GTIN ausente ────────────────────────────────────────────────────────────────────────

describe('3. GTIN ausente é ausência de evidência', () => {
  for (const semGtin of ['SEM GTIN', '', '00000000', null]) {
    test(`código de barras ${JSON.stringify(semGtin)} não identifica nem sugere cadastro com o mesmo texto`, async () => {
      const res = await identificar([CAD_SEM_GTIN, CAD_ZERADO], [], polpa({ produto_nome: 'ITEM QUALQUER XYZ', codigo_barras: semGtin }));
      assert.equal(res.r.produtoId, null);
      assert.equal(res.ids.includes(905), false);
      assert.equal(res.ids.includes(906), false);
      cadastroNovoCanonico(res.importacao);
    });
  }
});

// ─── 4. Correspondências legítimas ──────────────────────────────────────────────────────────

describe('4. Produtos equivalentes continuam reconhecidos pelas regras válidas', () => {
  test('código de barras exato vincula automaticamente', async () => {
    const res = await identificar([FRANGO, REFRI], [], polpa({ produto_nome: 'REFRIGERANTE COLA 2L', codigo_barras: GTIN_REFRI, codigo_fornecedor: '55' }));
    assert.equal(Number(res.r.produtoId), 901);
    assert.equal(res.r.resultado.decisao.criterio, CRITERIOS.CODIGO_BARRAS);
    assert.equal(res.importacao.associadoAutomaticamente, true);
    assert.equal(Number(res.importacao.produtoEncontrado.id), 901);
    assert.ok(res.importacao.score > 0);
  });

  test('mapeamento CNPJ + cProd confirmado do próprio fornecedor vincula, inclusive cProd 1', async () => {
    const assoc = [{ cnpj: CNPJ_POLPAS, cProd: '1', produtoId: 904, origem: 'Confirmacao Manual' }];
    const res = await identificar([FRANGO, MARACUJA], assoc, polpa());
    assert.equal(Number(res.r.produtoId), 904);
    assert.equal(res.r.resultado.decisao.criterio, CRITERIOS.MAPEAMENTO_FORNECEDOR);
    assert.equal(res.importacao.associadoAutomaticamente, true);
  });

  test('código interno explícito do CDS continua identificando', async () => {
    const res = await identificar([FRANGO, MARACUJA], [], polpa({ codigo_interno: '904' }));
    assert.equal(Number(res.r.produtoId), 904);
    assert.equal(res.r.resultado.decisao.criterio, CRITERIOS.CODIGO_INTERNO);
  });

  test('nome realmente semelhante é sugerido com a pontuação do próprio candidato', async () => {
    const res = await identificar([FRANGO, MARACUJA], [], polpa());
    assert.equal(res.r.resultado.decisao.acao, MiipAction.SUGERIR);
    assert.equal(Number(res.importacao.produtoEncontrado.id), 904);
    assert.equal(res.importacao.precisaConfirmacao, true);
    assert.equal(res.importacao.precisaCadastro, false);
    assert.equal(res.importacao.score, Number(res.r.resultado.decisao.melhorCandidato.scoreTotal));
  });
});

// ─── 5. Decisão canônica: API, persistência, detalhes, lista e contadores ───────────────────

describe('5. Decisão, detalhes, lista e contadores no mesmo estado', () => {
  test('pipeline com candidato rejeitado pela política: mapper não traz o candidato de volta', () => {
    const frango = candidatoGravado({
      produto: PRODUTO_FRANGO_GRAVADO, score: 70, motores: ['motor_mubc'],
      evidencias: [{ motor: 'motor_mubc', tipo: 'unidade_diff', valor: 'unidade_diff' }]
    });
    const importacao = mapearDecisaoPipelineParaImportacao(null, {
      candidatos: [frango],
      decisao: { acao: MiipAction.CRIAR_NOVO, melhorCandidato: frango, score: 70, confianca: 'BAIXA', precisaCadastro: true }
    });
    cadastroNovoCanonico(importacao);
  });

  test('pontuação da decisão anterior do pipeline não vai para outro candidato escolhido pela política', () => {
    const frango = candidatoGravado({
      produto: PRODUTO_FRANGO_GRAVADO, score: 70, motores: ['motor_mubc'],
      evidencias: [{ motor: 'motor_mubc', tipo: 'unidade_diff', valor: 'unidade_diff' }]
    });
    const maracuja = candidatoGravado({
      produto: { ...MARACUJA }, score: 62, motores: ['motor_mubc'],
      evidencias: [{ motor: 'motor_mubc', tipo: 'descricao', valor: 2 }]
    });
    const pipeline = aplicarPoliticaNoResultado(polpa(), {
      candidatos: [frango, maracuja],
      decisao: { score: 70, melhorCandidato: frango }
    });
    const importacao = mapearDecisaoPipelineParaImportacao(null, pipeline);
    assert.equal(Number(importacao.produtoEncontrado.id), 904);
    assert.equal(importacao.score, 62);
    assert.equal(importacao.candidatos.some((c) => Number(c.produtoId) === 763), false);
  });

  test('código de barras só em produto desativado: cadastro novo; o desativado fica só para o aviso', async () => {
    const res = await identificar([{ ...REFRI, ativo: 0 }], [], polpa({ produto_nome: 'REFRIGERANTE COLA 2L', codigo_barras: GTIN_REFRI }));
    const imp = res.importacao;
    assert.equal(imp.acao, MiipAction.CRIAR_NOVO);
    assert.equal(Number(imp.produtoEncontrado.ativo), 0);
    assert.equal(imp.candidatoSelecionado, null);
    assert.deepEqual(imp.candidatos, []);
    assert.equal(imp.score, 0);
    assert.equal(imp.precisaConfirmacao, false, 'não conta como confirmação');
    assert.equal(imp.precisaCadastro, true);
  });

  test('importação XML real: resultados gravados, contadores e tela concordam item a item', async () => {
    const db = await criarBanco([FRANGO, REFRI, MARACUJA]);
    let payload;
    try {
      const servico = new MiipImportacaoXmlService({ miipService: criarMiip(db) });
      const itens = [
        polpa(),
        polpa({ produto_nome: 'REFRIGERANTE COLA 2L', codigo_barras: GTIN_REFRI, codigo_fornecedor: '55' }),
        polpa({ produto_nome: 'SABAO EM BARRA 5UN', codigo_fornecedor: '1', ncm: '34011190' })
      ].map((i) => { const c = { ...i }; delete c.fornecedor_cnpj; return c; });
      payload = await servico.processar({ fornecedor_cnpj: CNPJ_POLPAS, itens });
      payload.itens = itens;
    } finally {
      db.close();
    }

    const [rPolpa, rRefri, rSabao] = payload.resultados;
    payload.resultados.forEach((r) => assert.equal(r.regraIdentificacao, VERSAO_REGRA_IDENTIFICACAO));
    assert.equal(rPolpa.acao, MiipAction.SUGERIR, 'polpa: sugestão por nome (Polpa de Maracuja)');
    assert.equal(Number(rPolpa.produtoEncontrado.id), 904);
    assert.equal(rRefri.associadoAutomaticamente, true);
    cadastroNovoCanonico(rSabao);
    contadoresCoerentes(payload);

    const tela = await abrirTela({ fornecedor_cnpj: CNPJ_POLPAS, itens: payload.itens, miip_importacao: payload }, [FRANGO, REFRI, MARACUJA]);
    assert.equal(contagemNoTopo(tela.topo, 'Precisam confirmação'), payload.resumo.precisamConfirmacao);
    assert.equal(contagemNoTopo(tela.topo, 'Precisam cadastro'), payload.resumo.precisamCadastro);
    assert.equal(contagemNoTopo(tela.topo, 'Associados automaticamente'), payload.resumo.identificadosAutomaticamente);
    assert.match(itemDaLista(tela.lista, 'POLPA MARACUJA 400G'), /miip-central-tag--confirmacao/);
    const sabao = itemDaLista(tela.lista, 'SABAO EM BARRA 5UN');
    assert.match(sabao, /miip-central-tag--cadastro/);
    assert.match(sabao, /Sem candidato/);
    assert.doesNotMatch(tela.tudo, /Frango do Dia/);
  });
});

// ─── 6. Resultado gravado por regra anterior ────────────────────────────────────────────────

describe('6. Resultado legado não é apresentado como candidato validado sem revalidação', () => {
  test('doc 264: Frango 70/100 gravado com "cadastrar novo" vira decisão canônica, com rastro do anterior', () => {
    const r = revalidarResultadoPersistido(frangoGravadoParaPolpa(), { fornecedorCnpj: CNPJ_POLPAS });
    cadastroNovoCanonico(r);
    assert.equal(r.regraIdentificacao, VERSAO_REGRA_IDENTIFICACAO);
    assert.equal(r.revalidacao.alterado, true);
    assert.deepEqual(r.revalidacao.anterior, { acao: 'criar_novo', produtoId: 763, score: 70, associadoAutomaticamente: false });
    assert.equal(r.produtoXML.produto_nome, 'POLPA MARACUJA 400G');
    assert.equal(r.indice, 0);
  });

  test('resultado já decidido pela regra atual é devolvido sem alteração', () => {
    const atual = { ...frangoGravadoParaPolpa(), regraIdentificacao: VERSAO_REGRA_IDENTIFICACAO };
    assert.equal(revalidarResultadoPersistido(atual), atual);
    const revalidado = revalidarResultadoPersistido(frangoGravadoParaPolpa());
    assert.equal(revalidarResultadoPersistido(revalidado), revalidado, 'revalidar de novo não muda nada');
  });

  test('sugestão legítima por nome é mantida, sem os pontos que vinham da coincidência de cProd', () => {
    const abacaxi = { id: 721, nome: 'Abacaxi Perola', codigo: '721', unidade: 'UN', ativo: 1 };
    const candidato = candidatoGravado({
      produto: abacaxi, score: 87, motores: ['motor_mubc'],
      evidencias: [
        { motor: 'motor_mubc', tipo: 'codigo_fornecedor', valor: 'codigo_fornecedor' },
        { motor: 'motor_mubc', tipo: 'descricao', valor: 2 },
        { motor: 'motor_mubc', tipo: 'unidade', valor: 'unidade' }
      ],
      motivosRelevancia: [
        { tipo: 'codigo_fornecedor', rotulo: 'Código fornecedor' },
        { tipo: 'descricao', rotulo: 'Descrição semelhante', tokens: 2 },
        { tipo: 'unidade', rotulo: 'Mesma unidade' }
      ]
    });
    const item = { produto_nome: 'ABACAXI PEROLA UN', codigo_fornecedor: '721', codigo_barras: 'SEM GTIN', unidade: 'UN' };
    const r = revalidarResultadoPersistido(
      resultadoGravado({ item, candidato, acao: 'sugerir', precisaConfirmacao: true, precisaCadastro: false }),
      { fornecedorCnpj: CNPJ_OUTRO }
    );
    assert.equal(r.acao, MiipAction.SUGERIR);
    assert.equal(Number(r.produtoEncontrado.id), 721);
    assert.equal(r.precisaConfirmacao, true);
    assert.equal(r.score, MotorUniversalBuscaCandidatos.pontuarMotivos([
      { tipo: 'descricao', tokens: 2 }, { tipo: 'unidade' }
    ]));
    assert.ok(r.score < 87);
    assert.equal(r.candidatoSelecionado.evidencias.some((e) => e.tipo === 'codigo_fornecedor'), false);
    assert.equal(r.candidatos[0].motivos.includes('Código fornecedor'), false);
  });

  test('"descrição" gravada só por medida em comum (400G) não sustenta sugestão', () => {
    const geleia = { id: 903, nome: 'Geleia Morango 400G', codigo: '903', unidade: 'UN', ativo: 1 };
    const candidato = candidatoGravado({
      produto: geleia, score: 51, motores: ['motor_mubc'],
      evidencias: [{ motor: 'motor_mubc', tipo: 'descricao', valor: 1 }, { motor: 'motor_mubc', tipo: 'ncm', valor: 'ncm' }]
    });
    const r = revalidarResultadoPersistido(
      resultadoGravado({ item: polpa(), candidato, acao: 'sugerir', precisaConfirmacao: true, precisaCadastro: false })
    );
    cadastroNovoCanonico(r);
  });

  test('vínculo automático legítimo por código de barras é preservado', () => {
    const candidato = candidatoGravado({
      produto: { id: 901, nome: 'Refrigerante Cola 2L', codigo: '901', unidade: 'UN', codigo_barras: GTIN_REFRI, ativo: 1 },
      score: 100, motores: ['motor_gtin'],
      evidencias: [{ motor: 'motor_gtin', tipo: 'gtin_exato', valor: GTIN_REFRI }]
    });
    const item = { produto_nome: 'REFRIGERANTE COLA 2L', codigo_fornecedor: '55', codigo_barras: GTIN_REFRI, unidade: 'UN' };
    const r = revalidarResultadoPersistido(
      resultadoGravado({ item, candidato, acao: 'auto_vincular', precisaConfirmacao: false, precisaCadastro: false, associado: true })
    );
    assert.equal(r.associadoAutomaticamente, true);
    assert.equal(Number(r.produtoEncontrado.id), 901);
    assert.equal(r.revalidacao.alterado, false);
  });

  test('vínculo automático antigo sem evidência válida volta a ser pendência; escolha do operador é mantida', () => {
    const candidato = candidatoGravado({
      produto: PRODUTO_FRANGO_GRAVADO, score: 94, motores: ['motor_mubc'],
      evidencias: [{ motor: 'motor_mubc', tipo: 'codigo_fornecedor', valor: 'codigo_fornecedor' }]
    });
    const gravado = resultadoGravado({ item: polpa(), candidato, acao: 'auto_vincular', precisaConfirmacao: false, precisaCadastro: false, associado: true });
    const itemAuto = { ...polpa(), produto_id: 763, miip_resultado: gravado };
    const itemOperador = { ...polpa(), produto_id: 763, miip_resultado: gravado, miip_revisao_status: 'CONFIRMAR' };

    const semDecisao = revalidarParseMiipPersistido(parseGravado([gravado], [itemAuto]));
    cadastroNovoCanonico(semDecisao.miip_importacao.resultados[0]);
    assert.equal(semDecisao.itens[0].produto_id, null, 'vínculo automático antigo não segue para Compras');
    assert.equal(semDecisao.miip_importacao.resumo.identificadosAutomaticamente, 0);

    const comDecisao = revalidarParseMiipPersistido(parseGravado([gravado], [itemOperador]));
    assert.equal(comDecisao.itens[0].produto_id, 763, 'escolha feita na revisão não é desfeita');
  });

  test('payload de Compras (abrir Central/Compras): revalidado, sem Frango, sem gravar nada', async () => {
    const documento = docLegado264();
    const original = JSON.parse(JSON.stringify(documento.parseJson));
    const repo = repositorioSomenteLeitura(documento);
    const bridge = new CentralComprasBridgeService({ documentosRepository: repo, transitionService: {}, revisaoPersistenteService: {} });

    const { dadosCompra } = await bridge.montarPayloadAbrirCompra(264);
    const bloco = dadosCompra.miip_importacao;
    cadastroNovoCanonico(bloco.resultados[0]);
    contadoresCoerentes(bloco);
    assert.equal(bloco.revalidacao.revalidados, 1);
    assert.equal(dadosCompra.itens[0].miip_resultado.produtoEncontrado, null);
    assert.equal('miip_sugestao' in dadosCompra.itens[0], false);
    assert.equal(repo.escritas.length, 0, 'nenhuma escrita no documento');
    assert.deepEqual(documento.parseJson, original, 'parse gravado intacto');
  });

  test('reabrir pelo processamento e pela sessão de revisão também entrega o resultado revalidado', async () => {
    const documento = docLegado264();
    const repo = repositorioSomenteLeitura(documento);
    const processamento = new CentralProcessamentoService({
      documentosRepository: repo, historicoService: { registrar() {} }, transitionService: {}
    });
    const reaberto = await processamento.processar(264);
    assert.equal(reaberto.reutilizado, true);
    cadastroNovoCanonico(reaberto.parse.miip_importacao.resultados[0]);
    cadastroNovoCanonico(reaberto.miipImportacao.resultados[0]);
    contadoresCoerentes(reaberto.miipImportacao);

    const hints = CentralRevisaoPersistenteService.prototype._hintsDadosImportacao.call({}, documento, []);
    assert.equal(hints.itensParse[0].miip_resultado.produtoEncontrado, null);
    assert.equal(repo.escritas.length, 0);
  });

  test('tela: o legado cru mostraria o Frango; o revalidado mostra cadastro, sem candidato e contadores iguais', async () => {
    const documento = docLegado264();
    const cru = await abrirTela(documento.parseJson, [FRANGO, MARACUJA]);
    assert.match(cru.tudo, /Frango do Dia/, 'controle: o defeito estava no resultado servido sem revalidação');

    const bridge = new CentralComprasBridgeService({
      documentosRepository: repositorioSomenteLeitura(documento), transitionService: {}, revisaoPersistenteService: {}
    });
    const { dadosCompra } = await bridge.montarPayloadAbrirCompra(264);
    const tela = await abrirTela(dadosCompra, [FRANGO, MARACUJA]);
    const linha = itemDaLista(tela.lista, 'POLPA MARACUJA 400G');
    assert.match(linha, /miip-central-tag--cadastro/);
    assert.match(linha, /Sem candidato/);
    assert.doesNotMatch(tela.tudo, /Frango do Dia/);
    assert.doesNotMatch(tela.tudo, /data-miip-e-este=/);
    assert.match(tela.detalhes, /Cadastrar produto/);
    assert.equal(contagemNoTopo(tela.topo, 'Precisam cadastro'), 1);
    assert.equal(contagemNoTopo(tela.topo, 'Precisam confirmação'), 0);
  });
});
