/**
 * Testes — MotorSynonyms + SynonymDictionary (Sprint 9)
 * Executar: npm run test:miip-synonyms
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const IMotorIdentificacao = require('../../backend/motores/miip/core/IMotorIdentificacao');
const SemanticProduct = require('../../backend/motores/miip/core/SemanticProduct');
const SynonymMatch = require('../../backend/motores/miip/core/SynonymMatch');
const SynonymReport = require('../../backend/motores/miip/core/SynonymReport');
const MotorSynonyms = require('../../backend/motores/miip/engines/MotorSynonyms');
const SynonymDictionary = require('../../backend/motores/miip/utils/SynonymDictionary');
const { MiipMetricsCollector } = require('../../backend/motores/miip/metrics/MiipMetricsCollector');
const { MiipMotorLogService } = require('../../backend/motores/miip/logs/MiipMotorLogService');

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

function criarMotor(opcoes = {}) {
  return new MotorSynonyms({
    metricsCollector: opcoes.metrics ?? new MiipMetricsCollector(),
    logService: opcoes.logs ?? new MiipMotorLogService(),
    synonymDir: opcoes.synonymDir
  });
}

function produto(canonico, extras = {}) {
  return SemanticProduct.create({
    original: extras.original ?? canonico,
    canonico,
    tokens: canonico.split(/\s+/).filter(Boolean),
    tipo: extras.tipo ?? null,
    marca: extras.marca ?? null,
    tecnologia: extras.tecnologia ?? null,
    embalagem: extras.embalagem ?? null,
    material: extras.material ?? null,
    cor: extras.cor ?? null,
    atributosExtras: extras.atributosExtras ?? null
  });
}

function enriquecer(canonico, extras) {
  return criarMotor().enriquecer(produto(canonico, extras));
}

function contemSinonimo(resultado, sinonimo) {
  return resultado.produto.synonyms.some((match) => match.sinonimo === sinonimo);
}

async function main() {
  console.log('\n=== Testes MotorSynonyms — MIIP (Sprint 9) ===\n');

  await test('MotorSynonyms estende IMotorIdentificacao', () => {
    const validacao = IMotorIdentificacao.validarHeranca(MotorSynonyms);
    assert.strictEqual(validacao.valido, true, validacao.erros.join('; '));
  });

  await test('MotorSynonyms não acessa SQL, XML, GTIN ou similaridade', () => {
    const arquivo = path.join(__dirname, '../../backend/motores/miip/engines/synonyms/MotorSynonyms.js');
    const codigo = fs.readFileSync(arquivo, 'utf8');
    const proibidos = [
      /SELECT\s+/i,
      /ProdutoRepository/i,
      /xml2js/i,
      /codigoBarras/i,
      /gtin/i,
      /similaridade/i,
      /openai/i
    ];
    proibidos.forEach((padrao) => {
      assert.strictEqual(padrao.test(codigo), false, `Padrão proibido: ${padrao}`);
    });
  });

  await test('identificar retorna array vazio — não identifica produtos', async () => {
    const motor = criarMotor();
    const candidatos = await motor.identificar(produto('LAMPADA LED PHILIPS'));
    assert.deepStrictEqual(candidatos, []);
    assert.ok(motor.obterUltimoSemantic());
  });

  await test('getPeso retorna 0', () => {
    const motor = criarMotor();
    assert.strictEqual(motor.getPeso(), 0);
    assert.strictEqual(motor.getCodigo(), 'motor_synonyms');
  });

  await test('SynonymMatch serializa campos oficiais', () => {
    const match = SynonymMatch.create({
      original: 'CX',
      sinonimo: 'CAIXA',
      categoria: 'general',
      confianca: 100,
      origem: 'general.json'
    });
    assert.deepStrictEqual(match.toJSON(), {
      original: 'CX',
      sinonimo: 'CAIXA',
      categoria: 'general',
      confianca: 100,
      origem: 'general.json'
    });
  });

  await test('SynonymReport serializa métricas oficiais', () => {
    const report = SynonymReport.create({
      quantidadeSinonimosEncontrados: 2,
      tempo: 1,
      categoriasUtilizadas: ['general']
    });
    assert.strictEqual(report.toJSON().quantidadeSinonimosEncontrados, 2);
    assert.deepStrictEqual(report.toJSON().categoriasUtilizadas, ['general']);
  });

  await test('enriquecimento preserva original e canonico', () => {
    const entrada = produto('LAMPADA LED CAIXA', { original: 'Lamp. LED Cx' });
    const { produto: enriquecido } = criarMotor().enriquecer(entrada);
    assert.strictEqual(enriquecido.original, 'Lamp. LED Cx');
    assert.strictEqual(enriquecido.canonico, 'LAMPADA LED CAIXA');
  });

  await test('SemanticProduct possui campos de sinônimos', () => {
    const semantic = SemanticProduct.create();
    assert.ok(Object.prototype.hasOwnProperty.call(semantic, 'synonyms'));
    assert.ok(Object.prototype.hasOwnProperty.call(semantic, 'relatedTokens'));
    assert.ok(Object.prototype.hasOwnProperty.call(semantic, 'semanticAliases'));
  });

  await test('SynonymDictionary carrega todas as categorias', () => {
    const dicionario = SynonymDictionary.carregar();
    assert.ok(dicionario.categorias.includes('general'));
    assert.ok(dicionario.categorias.includes('electrical'));
    assert.ok(dicionario.categorias.includes('construction'));
    assert.ok(dicionario.categorias.includes('hydraulic'));
    assert.ok(dicionario.categorias.includes('grocery'));
    assert.ok(dicionario.categorias.includes('stationery'));
    assert.ok(dicionario.categorias.includes('hardware'));
  });

  const casosGerais = [
    ['LAMP', 'LAMPADA'],
    ['LAMPADA', 'LAMP'],
    ['CX', 'CAIXA'],
    ['CAIXA', 'CX'],
    ['UN', 'UNIDADE'],
    ['UNIDADE', 'UN'],
    ['PCT', 'PACOTE'],
    ['PACOTE', 'PCT'],
    ['CJ', 'CONJUNTO'],
    ['CONJUNTO', 'CJ'],
    ['KIT', 'CONJUNTO'],
    ['EMBALAGEM', 'EMB']
  ];

  for (const [entrada, esperado] of casosGerais) {
    await test(`geral: ${entrada} -> ${esperado}`, () => {
      const resultado = enriquecer(entrada);
      assert.ok(contemSinonimo(resultado, esperado));
      assert.ok(resultado.relatorio.categoriasUtilizadas.includes('general'));
    });
  }

  const casosEletricos = [
    ['FLOR', 'FLUORESCENTE'],
    ['FLUORESCENTE', 'FLOR'],
    ['LED', 'LED'],
    ['HALOG', 'HALOGENA'],
    ['HALOGENA', 'HALOG'],
    ['INCAND', 'INCANDESCENTE'],
    ['CABO FLEXIVEL', 'FIO'],
    ['FIO ELETRICO', 'CABO'],
    ['TOMADA 10A', 'PONTO ELETRICO']
  ];

  for (const [entrada, esperado] of casosEletricos) {
    await test(`elétrica: ${entrada} -> ${esperado}`, () => {
      const resultado = enriquecer(entrada);
      assert.ok(contemSinonimo(resultado, esperado));
      assert.ok(resultado.relatorio.categoriasUtilizadas.includes('electrical'));
    });
  }

  const casosConstrucao = [
    ['VERGALHAO 10MM', 'BARRA DE ACO'],
    ['CIMENTO CPII 50KG', 'CIMENTO CP II'],
    ['CIMENTO CP II 50KG', 'CIMENTO CPII'],
    ['ARGAMASSA AC II', 'MASSA'],
    ['MASSA CORRIDA', 'ARGAMASSA'],
    ['BLOCO CONCRETO', 'TIJOLO'],
    ['SILICONE TRANSPARENTE', 'VEDANTE'],
    ['COLA BRANCA', 'ADESIVO']
  ];

  for (const [entrada, esperado] of casosConstrucao) {
    await test(`construção: ${entrada} -> ${esperado}`, () => {
      const resultado = enriquecer(entrada);
      assert.ok(contemSinonimo(resultado, esperado));
      assert.ok(resultado.relatorio.categoriasUtilizadas.includes('construction'));
    });
  }

  const casosHidraulicos = [
    ['CANO PVC', 'TUBO'],
    ['TUBO PVC', 'CANO'],
    ['JOELHO 90', 'CURVA'],
    ['CURVA 90', 'JOELHO'],
    ['TEE PVC', 'TE'],
    ['REGISTRO ESFERA', 'VALVULA'],
    ['VALVULA GAVETA', 'REGISTRO'],
    ['PVC ESGOTO', 'POLICLORETO DE VINILA']
  ];

  for (const [entrada, esperado] of casosHidraulicos) {
    await test(`hidráulica: ${entrada} -> ${esperado}`, () => {
      const resultado = enriquecer(entrada);
      assert.ok(contemSinonimo(resultado, esperado));
      assert.ok(resultado.relatorio.categoriasUtilizadas.includes('hydraulic'));
    });
  }

  const casosMercantil = [
    ['ARROZ INTEGRAL', 'CEREAL'],
    ['FEIJAO PRETO', 'GRAO'],
    ['OLEO SOJA', 'OLEO DE SOJA'],
    ['ACUCAR REFINADO', 'SACAROSE'],
    ['LEITE INTEGRAL', 'LACTEO'],
    ['CAFE TORRADO', 'GRAO TORRADO'],
    ['BISCOITO RECHEADO', 'BOLACHA'],
    ['BOLACHA AGUA SAL', 'BISCOITO']
  ];

  for (const [entrada, esperado] of casosMercantil) {
    await test(`mercantil: ${entrada} -> ${esperado}`, () => {
      const resultado = enriquecer(entrada);
      assert.ok(contemSinonimo(resultado, esperado));
      assert.ok(resultado.relatorio.categoriasUtilizadas.includes('grocery'));
    });
  }

  const casosPapelaria = [
    ['PAPEL A4', 'FOLHA'],
    ['FOLHA SULFITE', 'PAPEL'],
    ['CANETA AZUL', 'ESFEROGRAFICA'],
    ['ESFEROGRAFICA PRETA', 'CANETA'],
    ['LAPIS PRETO', 'GRAFITE'],
    ['GRAFITE 0.7MM', 'LAPIS'],
    ['BORRACHA BRANCA', 'APAGADOR'],
    ['SULFITE A4', 'PAPEL A4']
  ];

  for (const [entrada, esperado] of casosPapelaria) {
    await test(`papelaria: ${entrada} -> ${esperado}`, () => {
      const resultado = enriquecer(entrada);
      assert.ok(contemSinonimo(resultado, esperado));
      assert.ok(resultado.relatorio.categoriasUtilizadas.includes('stationery'));
    });
  }

  const casosFerragens = [
    ['PARAFUSO SEXTAVADO', 'FIXADOR'],
    ['FIXADOR ACO', 'PARAFUSO'],
    ['PORCA SEXTAVADA', 'NUT'],
    ['ARRUELA LISA', 'ANEL'],
    ['REBITE POP', 'FIXADOR'],
    ['PREGO ACO', 'PINO'],
    ['BUCHA S10', 'ANCORA'],
    ['GALVANIZADO', 'ZINCADO'],
    ['ZINCADO', 'GALVANIZADO']
  ];

  for (const [entrada, esperado] of casosFerragens) {
    await test(`ferragens: ${entrada} -> ${esperado}`, () => {
      const resultado = enriquecer(entrada);
      assert.ok(contemSinonimo(resultado, esperado));
      assert.ok(resultado.relatorio.categoriasUtilizadas.includes('hardware'));
    });
  }

  await test('relatedTokens contém sinônimos únicos', () => {
    const { produto: enriquecido } = enriquecer('CX CAIXA');
    const ocorrencias = enriquecido.relatedTokens.filter((token) => token === 'CAIXA').length;
    assert.strictEqual(ocorrencias, 1);
  });

  await test('semanticAliases registra pares original=sinonimo', () => {
    const { produto: enriquecido } = enriquecer('PCT');
    assert.ok(enriquecido.semanticAliases.includes('PCT=PACOTE'));
  });

  await test('toJSON inclui synonyms, relatedTokens e semanticAliases', () => {
    const { produto: enriquecido } = enriquecer('LAMP');
    const json = enriquecido.toJSON();
    assert.ok(Array.isArray(json.synonyms));
    assert.ok(Array.isArray(json.relatedTokens));
    assert.ok(Array.isArray(json.semanticAliases));
  });

  await test('entrada sem sinônimos retorna arrays vazios', () => {
    const { produto: enriquecido, relatorio } = enriquecer('TERMO DESCONHECIDO');
    assert.deepStrictEqual(enriquecido.synonyms, []);
    assert.deepStrictEqual(enriquecido.relatedTokens, []);
    assert.deepStrictEqual(enriquecido.semanticAliases, []);
    assert.strictEqual(relatorio.quantidadeSinonimosEncontrados, 0);
  });

  await test('enriquecimento usa campos semânticos além dos tokens', () => {
    const semantic = SemanticProduct.create({
      original: 'Produto',
      canonico: 'PRODUTO',
      tokens: ['PRODUTO'],
      embalagem: 'CAIXA'
    });
    const resultado = criarMotor().enriquecer(semantic);
    assert.ok(contemSinonimo(resultado, 'CX'));
  });

  await test('identificar inválido não gera produto', async () => {
    const motor = criarMotor();
    const candidatos = await motor.identificar({ texto: 'sem semantic' });
    assert.deepStrictEqual(candidatos, []);
    assert.strictEqual(motor.obterUltimoSemantic(), null);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
