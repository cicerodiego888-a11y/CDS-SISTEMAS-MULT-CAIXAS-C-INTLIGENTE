'use strict';

/**
 * MIIP — cProd do fornecedor nunca vira código interno; sugestão só com evidência real
 * (auditoria na seção 20 do relatório, correção na Sprint 3.1).
 *
 * Caso real: "POLPA MARACUJA 400G", fornecedor de polpas, cProd 1, UN, SEM GTIN,
 * recebeu "Frango do Dia" (código interno 1, KG) com 70%.
 *
 * Serviço MIIP real (pipeline, política V2, motores de barras, fornecedor e MUBC) sobre
 * SQLite em memória com os repositórios reais. Nenhum banco do CDS é aberto.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');

const MiipAction = require('../../backend/motores/miip/core/MiipAction');
const { CRITERIOS, aplicarPoliticaIdentificacaoV2 } = require('../../backend/motores/miip/core/MiipIdentificacaoV2Policy');
const { MiipService } = require('../../backend/motores/miip/MiipService');
const { MiipOrchestrator } = require('../../backend/motores/miip/MiipOrchestrator');
const { criarPipelinePadrao } = require('../../backend/motores/miip/core/MiipPipelineFactory');
const { MotorRegistry } = require('../../backend/motores/miip/core/MotorRegistry');
const MotorGTIN = require('../../backend/motores/miip/engines/gtin/MotorGTIN');
const MotorAssociacaoFornecedor = require('../../backend/motores/miip/engines/fornecedor/MotorAssociacaoFornecedor');
const MotorUniversalBuscaCandidatos = require('../../backend/motores/miip/engines/mubc/MotorUniversalBuscaCandidatos');
const ProductCompatibilityGuard = require('../../backend/motores/miip/utils/ProductCompatibilityGuard');
const ProdutoSnapshot = require('../../backend/motores/miip/core/ProdutoSnapshot');
const { ProdutoRepository } = require('../../backend/motores/miip/repositories/ProdutoRepository');
const { MiipAssociacoesRepository } = require('../../backend/motores/miip/repositories/MiipAssociacoesRepository');
const produtoCache = require('../../backend/motores/miip/cache/ProdutoCache');
const { mapearDecisaoPipelineParaImportacao } = require('../../backend/motores/miip/utils/MiipResultadoImportacaoMapper');
const { MiipFeatureFlags } = require('../../backend/motores/miip/config/miipFeatureFlags');
const { MiipIntegracaoLogService } = require('../../backend/motores/miip/logs/MiipIntegracaoLogService');

const CNPJ_POLPAS = '11111111000191';
const CNPJ_OUTRO = '22222222000191';

const FRANGO = { id: 763, codigo: '1', nome: 'Frango do Dia', unidade: 'KG', ncm: null, ativo: 1 };
const REFRI = { id: 901, codigo: '901', nome: 'Refrigerante Cola 2L', unidade: 'UN', ncm: '22021000', ativo: 1 };
const GOIABA = { id: 902, codigo: '902', nome: 'Polpa de Goiaba 400g', unidade: 'UN', ncm: '20089900', ativo: 1 };
const GELEIA = { id: 903, codigo: '903', nome: 'Geleia Morango 400G', unidade: 'UN', ncm: '20089900', ativo: 1 };
const MARACUJA = { id: 904, codigo: '904', nome: 'Polpa de Maracuja 400g', unidade: 'UN', ncm: '20089900', ativo: 1 };

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
  fornecedor_cnpj: CNPJ_POLPAS,
  fornecedor_nome: 'Fornecedor de polpas (teste)',
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

/** Nenhuma identificação automática nem sugestão vinda só da coincidência de cProd. */
function semDecisaoPorCoincidencia(resultado, produtoId) {
  const { r, importacao, ids } = resultado;
  assert.notEqual(Number(r.produtoId), produtoId, 'não vincula automaticamente');
  assert.equal(ids.includes(produtoId), false, 'não aparece como candidato');
  assert.notEqual(Number(importacao.produtoEncontrado?.id), produtoId, 'não aparece como produto encontrado');
  assert.equal(importacao.associadoAutomaticamente, false);
}

/** Linha pendente: sem candidato, sem produto encontrado, precisa de cadastro ou escolha manual. */
function linhaPendente(resultado) {
  const { r, importacao, ids } = resultado;
  assert.equal(r.produtoId, null);
  assert.deepEqual(ids, []);
  assert.equal(r.resultado.decisao.acao, MiipAction.CRIAR_NOVO);
  assert.equal(importacao.produtoEncontrado, null);
  assert.equal(importacao.precisaCadastro, true);
}

function motorComHits(hits) {
  const chamadas = [];
  const motor = new MotorUniversalBuscaCandidatos({
    produtoRepository: {
      async buscarCandidatosUniversais(filtros) {
        chamadas.push(filtros);
        return hits.map((h) => ({ snapshot: ProdutoSnapshot.fromRow(h.produto), motivos: h.motivos }));
      }
    },
    metricsCollector: stubMetricas,
    logService: stubLog
  });
  return { motor, chamadas };
}

beforeEach(() => produtoCache.limpar());

describe('Busca e pontuação: cProd não é código interno', () => {
  test('MUBC não envia cProd como código interno ao repositório, nem quando o item traz "codigo" igual ao cProd', async () => {
    const { motor, chamadas } = motorComHits([]);
    await motor.identificar({ produtoNome: 'POLPA MARACUJA 400G', codigo_fornecedor: '1', codigo: '1', unidade: 'UN' });
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].codigoInterno, null);
    assert.equal('codigoFornecedor' in chamadas[0], false);
  });

  test('código interno explícito continua sendo buscado', async () => {
    const { motor, chamadas } = motorComHits([]);
    await motor.identificar({ produtoNome: 'X', codigo_interno: '904', codigo_fornecedor: '1' });
    assert.equal(chamadas[0].codigoInterno, '904');
  });

  test('hit legado rotulado codigo_fornecedor (busca antiga, 82 − 12 = 70) não pontua nem vira candidato', async () => {
    const { motor } = motorComHits([{ produto: FRANGO, motivos: ['codigo_fornecedor'] }]);
    const cands = await motor.identificar({ produtoNome: 'POLPA MARACUJA 400G', codigoFornecedor: '1', codigoBarras: 'SEM GTIN', unidade: 'UN', ncm: '20089900' });
    assert.deepEqual(cands, []);
  });

  test('barreira de compatibilidade avalia candidato com motivo codigo_fornecedor (não é mais identificador forte)', () => {
    assert.equal(ProductCompatibilityGuard.IDENTIFICADORES_FORTES.includes('codigo_fornecedor'), false);
    const r = ProductCompatibilityGuard.avaliar({
      itemXml: { produto_nome: 'POLPA MARACUJA 400G', ncm: '20089900', unidade: 'UN' },
      produtoCds: { nome: 'Frango do Dia', unidade: 'KG' },
      motivosMatch: ['codigo_fornecedor']
    });
    assert.equal(r.regrasAplicadas.includes('identificador_forte'), false);
  });

  test('coincidência só de medida (400G) não conta como descrição semelhante', async () => {
    const { motor } = motorComHits([{ produto: GELEIA, motivos: ['ncm'] }]);
    const [c] = await motor.identificar({ produtoNome: 'POLPA MARACUJA 400G', unidade: 'UN', ncm: '20089900' });
    const tipos = c.evidencias.map((e) => e.tipo);
    assert.ok(tipos.includes('descricao_medida'));
    assert.equal(tipos.includes('descricao'), false);
  });
});

describe('Política V2: sugestão por nome exige evidência real', () => {
  const item = { produtoNome: 'POLPA MARACUJA 400G', codigoFornecedor: '1', codigoBarras: 'SEM GTIN', fornecedorCnpj: CNPJ_POLPAS };
  const candidato = (tipos) => ({
    produtoId: 763,
    scoreTotal: 70,
    snapshot: { id: 763, codigo: '1', nome: 'Frango do Dia', unidade: 'KG', ativo: 1 },
    motoresQueVotaram: ['motor_mubc', 'motor_similarity'],
    evidencias: tipos.map((tipo) => ({ motor: 'motor_mubc', tipo, valor: tipo }))
  });

  test('candidato gravado no doc 264 (codigo_fornecedor + unidade_diff) fica pendente, sem candidato', () => {
    const v2 = aplicarPoliticaIdentificacaoV2(item, { candidatos: [candidato(['codigo_fornecedor', 'unidade_diff'])] });
    assert.equal(v2.acao, MiipAction.CRIAR_NOVO);
    assert.deepEqual(v2.candidatos, []);
  });

  for (const tipos of [['ncm', 'unidade'], ['marca', 'cest'], ['descricao_medida', 'unidade'], ['similarity']]) {
    test(`só ${tipos.join(' + ')} não sugere`, () => {
      const v2 = aplicarPoliticaIdentificacaoV2(item, { candidatos: [candidato(tipos)] });
      assert.equal(v2.acao, MiipAction.CRIAR_NOVO);
    });
  }

  test('descrição semelhante sugere, sem vincular', () => {
    const v2 = aplicarPoliticaIdentificacaoV2(item, { candidatos: [candidato(['descricao', 'ncm'])] });
    assert.equal(v2.acao, MiipAction.SUGERIR);
    assert.equal(v2.criterio, CRITERIOS.NOME);
    assert.equal(v2.produtoId, null);
  });
});

describe('Pipeline completo — cProd só no contexto do fornecedor', () => {
  test('POLPA MARACUJA cProd 1, sem GTIN, sem mapeamento: nunca sugere Frango (código interno e PLU 1)', async () => {
    const res = await identificar([FRANGO, REFRI], [], polpa());
    semDecisaoPorCoincidencia(res, 763);
    linhaPendente(res);
  });

  test('outro fornecedor também com cProd 1, sem mapeamento: também não recebe o Frango', async () => {
    const res = await identificar([FRANGO, REFRI], [], polpa({ fornecedor_cnpj: CNPJ_OUTRO, produto_nome: 'SABAO EM BARRA 5UN' }));
    semDecisaoPorCoincidencia(res, 763);
  });

  test('mapeamento válido CNPJ + cProd do próprio fornecedor vincula', async () => {
    const assoc = [{ cnpj: CNPJ_POLPAS, cProd: '1', produtoId: 904, origem: 'Confirmacao Manual' }];
    const res = await identificar([FRANGO, MARACUJA], assoc, polpa());
    assert.equal(Number(res.r.produtoId), 904);
    assert.equal(res.r.resultado.decisao.criterio, CRITERIOS.MAPEAMENTO_FORNECEDOR);
    assert.equal(res.importacao.associadoAutomaticamente, true);
    assert.equal(res.ids.includes(763), false);
  });

  test('mapeamento de outro fornecedor com cProd 1 vale só para ele e não vaza para a polpa', async () => {
    const assoc = [{ cnpj: CNPJ_OUTRO, cProd: '1', produtoId: 901, origem: 'Confirmacao Manual' }];
    const doOutro = await identificar([FRANGO, REFRI], assoc, polpa({ fornecedor_cnpj: CNPJ_OUTRO, produto_nome: 'REFRIGERANTE COLA 2L' }));
    assert.equal(Number(doOutro.r.produtoId), 901);

    const daPolpa = await identificar([FRANGO, REFRI], assoc, polpa());
    semDecisaoPorCoincidencia(daPolpa, 901);
    semDecisaoPorCoincidencia(daPolpa, 763);
  });

  test('mapeamento persistido do fornecedor errado apontando para o Frango não contamina a polpa', async () => {
    const assoc = [{ cnpj: CNPJ_OUTRO, cProd: '1', produtoId: 763, origem: 'Confirmacao Manual' }];
    const res = await identificar([FRANGO, REFRI], assoc, polpa());
    semDecisaoPorCoincidencia(res, 763);
  });

  test('nome realmente semelhante é sugerido, sem associação automática', async () => {
    const res = await identificar([FRANGO, MARACUJA], [], polpa());
    assert.equal(res.r.produtoId, null);
    assert.deepEqual(res.ids, [904]);
    assert.equal(res.r.resultado.decisao.acao, MiipAction.SUGERIR);
    assert.equal(res.importacao.associadoAutomaticamente, false);
    assert.equal(res.importacao.precisaConfirmacao, true);
    assert.equal(Number(res.importacao.produtoEncontrado?.id), 904);
  });

  test('nome e unidade incompatíveis, mesmo NCM: linha pendente', async () => {
    const res = await identificar([{ ...FRANGO, ncm: '20089900' }], [], polpa());
    linhaPendente(res);
  });

  test('só medida e NCM em comum (Geleia 400G): linha pendente', async () => {
    const res = await identificar([GELEIA], [], polpa());
    linhaPendente(res);
  });

  test('controle: Polpa de Goiaba aparece só como sugestão por nome', async () => {
    const res = await identificar([FRANGO, GOIABA], [], polpa({ produto_nome: 'POLPA GOIABA 400G', codigo_fornecedor: '73' }));
    assert.equal(res.r.produtoId, null, 'nome nunca vincula sozinho');
    assert.ok(res.ids.includes(902));
    assert.equal(res.ids.includes(763), false);
  });

  test('sequência de consultas: candidato de um item não aparece no seguinte', async () => {
    const db = await criarBanco([FRANGO, REFRI], [{ cnpj: CNPJ_OUTRO, cProd: '1', produtoId: 901, origem: 'Confirmacao Manual' }]);
    try {
      const miip = criarMiip(db);
      const primeiro = await miip.identificar(polpa({ fornecedor_cnpj: CNPJ_OUTRO, produto_nome: 'REFRIGERANTE COLA 2L' }));
      assert.equal(Number(primeiro.produtoId), 901);
      const segundo = await miip.identificar(polpa());
      assert.equal(segundo.produtoId, null);
      assert.deepEqual((segundo.resultado.candidatos || []).map((c) => Number(c.produtoId)), []);
    } finally {
      db.close();
    }
  });
});
