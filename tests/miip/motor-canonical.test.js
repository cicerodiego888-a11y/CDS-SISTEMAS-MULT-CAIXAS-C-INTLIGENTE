/**
 * Testes — MotorCanonical + CanonicalNormalizer (Sprint 7 / 7.1)
 * Executar: npm run test:miip-canonical
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const IMotorIdentificacao = require('../../backend/motores/miip/core/IMotorIdentificacao');
const CanonicalProduct = require('../../backend/motores/miip/core/CanonicalProduct');
const CanonicalToken = require('../../backend/motores/miip/core/CanonicalToken');
const CanonicalStatistics = require('../../backend/motores/miip/core/CanonicalStatistics');
const TokenType = require('../../backend/motores/miip/core/TokenType');
const MotorCanonical = require('../../backend/motores/miip/engines/MotorCanonical');
const CanonicalNormalizer = require('../../backend/motores/miip/utils/CanonicalNormalizer');
const DecimalNormalizer = require('../../backend/motores/miip/utils/DecimalNormalizer');
const MeasurementTokenizer = require('../../backend/motores/miip/utils/MeasurementTokenizer');
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
  return new MotorCanonical({
    metricsCollector: opcoes.metrics ?? new MiipMetricsCollector(),
    logService: opcoes.logs ?? new MiipMotorLogService(),
    dicionario: opcoes.dicionario
  });
}

function norm(texto, opcoes) {
  return CanonicalNormalizer.normalizar(texto, opcoes);
}

async function main() {
  console.log('\n=== Testes MotorCanonical — MIIP (Sprint 7.1) ===\n');

  await test('MotorCanonical estende IMotorIdentificacao', () => {
    const validacao = IMotorIdentificacao.validarHeranca(MotorCanonical);
    assert.strictEqual(validacao.valido, true, validacao.erros.join('; '));
  });

  await test('MotorCanonical não acessa SQL nem repositórios', () => {
    const arquivo = path.join(__dirname, '../../backend/motores/miip/engines/canonical/MotorCanonical.js');
    const codigo = fs.readFileSync(arquivo, 'utf8');
    const proibidos = [
      /SELECT\s+/i,
      /ProdutoRepository/i,
      /MiipAssociacoes/i,
      /db\.get\(/i,
      /fornecedorCnpj/i,
      /codigoBarras/i,
      /xml2js/i
    ];
    proibidos.forEach((padrao) => {
      assert.strictEqual(padrao.test(codigo), false, `Padrão proibido: ${padrao}`);
    });
  });

  await test('identificar retorna array vazio — não identifica produtos', async () => {
    const motor = criarMotor();
    const candidatos = await motor.identificar({ produto_nome: 'Arroz Integral 5KG' });
    assert.deepStrictEqual(candidatos, []);
    assert.ok(motor.obterUltimoCanonical());
  });

  await test('exemplo oficial Lamp. Flor. 20W Philips', () => {
    const resultado = norm('Lamp. Flor. 20W Philips');
    assert.strictEqual(resultado.original, 'Lamp. Flor. 20W Philips');
    assert.strictEqual(resultado.canonico, 'LAMPADA FLUORESCENTE 20W PHILIPS');
    assert.deepStrictEqual(resultado.tokens, ['LAMPADA', 'FLUORESCENTE', '20W', 'PHILIPS']);
  });

  await test('texto original nunca é alterado', () => {
    const original = '  café especial — 500 ml  ';
    const resultado = norm(original);
    assert.strictEqual(resultado.original, original);
  });

  const casos = [
    ['LAMP', 'LAMPADA'],
    ['FLOR', 'FLUORESCENTE'],
    ['CX', 'CAIXA'],
    ['UN', 'UNIDADE'],
    ['PCT', 'PACOTE'],
    ['CJ', 'CONJUNTO'],
    ['20 W', '20W'],
    ['1 KG', '1KG'],
    ['500 ML', '500ML'],
    ['2 LT', '2L'],
    ['café', 'CAFE'],
    ['Açúcar Refinado', 'ACUCAR REFINADO'],
    ['PÃO DE FORMA', 'PAO DE FORMA'],
    ['produto   com    espaços', 'PRODUTO COM ESPACOS'],
    ['item;com,pontuação.', 'ITEM COM PONTUACAO'],
    ['arroz/tipo-1', 'ARROZ TIPO 1'],
    ['feijão_preto', 'FEIJAO PRETO'],
    ['LAMP FLOR 20W', 'LAMPADA FLUORESCENTE 20W'],
    ['CX 12 UN PCT', 'CAIXA 12UN PACOTE'],
    ['água mineral 1,5 LT', 'AGUA MINERAL 1.5L'],
    ['óleo 900ml', 'OLEO 900ML'],
    ['detergente 500 ML', 'DETERGENTE 500ML'],
    ['lâmpada led 9w', 'LAMPADA LED 9W'],
    ['MANTEIGA 200 G', 'MANTEIGA 200G'],
    ['SAL 1KG FINO', 'SAL 1KG FINO'],
    ['LEITE 1 LT INTEGRAL', 'LEITE 1L INTEGRAL'],
    ['BISCOITO;PCT/CX', 'BISCOITO PACOTE CAIXA'],
    ['produto@#$%teste', 'PRODUTO TESTE'],
    ['  MIX  ', 'MIX'],
    ['FLOR LAMP', 'FLUORESCENTE LAMPADA'],
    ['1 UN ARROZ', '1UN ARROZ'],
    ['PCT ARROZ 5KG', 'PACOTE ARROZ 5KG'],
    ['CJ TALHERES', 'CONJUNTO TALHERES']
  ];

  for (const [entrada, esperadoCanonico] of casos) {
    await test(`normaliza: "${entrada}" → "${esperadoCanonico}"`, () => {
      const resultado = norm(entrada);
      assert.strictEqual(resultado.canonico, esperadoCanonico);
      assert.ok(resultado.tokens.length > 0);
    });
  }

  await test('CanonicalProduct preserva atributos de unidade', () => {
    const resultado = norm('Leite 1 LT');
    assert.deepStrictEqual(resultado.atributos.unidades, ['L']);
    assert.deepStrictEqual(resultado.atributos.quantidades, [1]);
  });

  await test('canonicalizar via motor produz CanonicalProduct', () => {
    const motor = criarMotor();
    const produto = motor.canonicalizar('Lamp. Flor. 20W');
    assert.ok(produto instanceof CanonicalProduct);
    assert.strictEqual(produto.canonico, 'LAMPADA FLUORESCENTE 20W');
  });

  await test('identificar com string pura', async () => {
    const motor = criarMotor();
    await motor.identificar('CX PCT UN');
    assert.strictEqual(motor.obterUltimoCanonical().canonico, 'CAIXA PACOTE UNIDADE');
  });

  await test('identificar vazio retorna [] sem canonical', async () => {
    const motor = criarMotor();
    const r = await motor.identificar({ produto_nome: '   ' });
    assert.deepStrictEqual(r, []);
    assert.strictEqual(motor.obterUltimoCanonical(), null);
  });

  await test('getPeso retorna 0 — não afeta score', () => {
    const motor = criarMotor();
    assert.strictEqual(motor.getPeso(), 0);
    assert.strictEqual(motor.getCodigo(), 'motor_canonical');
  });

  await test('dicionário customizado expande abreviações', () => {
    const resultado = CanonicalNormalizer.normalizar('REFR CX', {
      dicionario: {
        abreviacoes: { REFR: 'REFRIGERANTE', CX: 'CAIXA' },
        unidades: [],
        aliases: {},
        embalagens: ['CX', 'CAIXA'],
        marcas: [],
        stopwords: [],
        measurements: { sufixos: [], fracoes: true, dimensoes: true }
      }
    });
    assert.strictEqual(resultado.canonico, 'REFRIGERANTE CAIXA');
  });

  // --- Sprint 7.1: Decimais ---

  await test('DecimalNormalizer: 1,5 LT → 1.5L', () => {
    const resultado = DecimalNormalizer.normalizarDecimais('1,5 LT', {
      unidades: ['LT', 'L'],
      aliases: { LT: 'L' }
    });
    assert.strictEqual(resultado, '1.5L');
  });

  await test('DecimalNormalizer: 2,75 KG → 2.75KG', () => {
    const resultado = DecimalNormalizer.normalizarDecimais('2,75 KG', {
      unidades: ['KG'],
      aliases: {}
    });
    assert.strictEqual(resultado, '2.75KG');
  });

  await test('decimal 0,75 ML preservado', () => {
    const resultado = norm('sachê 0,75 ML');
    assert.ok(resultado.canonico.includes('0.75ML'));
  });

  await test('decimal 3,14 sem unidade', () => {
    const resultado = norm('medida 3,14 teste');
    assert.ok(resultado.normalizado.includes('3.14'));
  });

  // --- Sprint 7.1: Medidas ---

  await test('MeasurementTokenizer preserva 220V', () => {
    const tokens = MeasurementTokenizer.tokenizar('LAMPADA 220V LED');
    assert.strictEqual(tokens[1].texto, '220V');
  });

  await test('MeasurementTokenizer preserva 127V', () => {
    const tokens = MeasurementTokenizer.tokenizar('TOMADA 127V');
    assert.strictEqual(tokens[1].texto, '127V');
  });

  await test('MeasurementTokenizer preserva fração 3/8', () => {
    const tokens = MeasurementTokenizer.tokenizar('PARAFUSO 3/8 ACO');
    assert.strictEqual(tokens[1].texto, '3/8');
  });

  await test('MeasurementTokenizer preserva fração 1/2', () => {
    const tokens = MeasurementTokenizer.tokenizar('CANO 1/2 PVC');
    assert.strictEqual(tokens[1].texto, '1/2');
  });

  await test('MeasurementTokenizer preserva dimensão 5X80', () => {
    const tokens = MeasurementTokenizer.tokenizar('LIXA 5X80');
    assert.strictEqual(tokens[1].texto, '5X80');
  });

  await test('MeasurementTokenizer preserva 12MM', () => {
    const tokens = MeasurementTokenizer.tokenizar('CHAVE 12MM');
    assert.strictEqual(tokens[1].texto, '12MM');
  });

  await test('MeasurementTokenizer preserva 3POL', () => {
    const tokens = MeasurementTokenizer.tokenizar('DISCO 3POL');
    assert.strictEqual(tokens[1].texto, '3POL');
  });

  await test('canonico com voltagem 220V', () => {
    const resultado = norm('Lampada 220V Philips');
    assert.strictEqual(resultado.canonico, 'LAMPADA 220V PHILIPS');
  });

  await test('canonico com fração e dimensão', () => {
    const resultado = norm('LIXA 5X80 GRANULACAO 3/8');
    assert.strictEqual(resultado.canonico, 'LIXA 5X80 GRANULACAO 3/8');
  });

  // --- Sprint 7.1: TokenType e CanonicalToken ---

  await test('token 20W classificado como MEDIDA', () => {
    const resultado = norm('LAMPADA 20W');
    const token = resultado.normalizedTokens.find((t) => t.textoCanonico === '20W');
    assert.strictEqual(token.tipo, TokenType.MEDIDA);
  });

  await test('token PHILIPS classificado como MARCA', () => {
    const resultado = norm('LAMPADA PHILIPS');
    const token = resultado.normalizedTokens.find((t) => t.textoCanonico === 'PHILIPS');
    assert.strictEqual(token.tipo, TokenType.MARCA);
  });

  await test('token CX classificado como EMBALAGEM', () => {
    const resultado = norm('ARROZ CX');
    const token = resultado.normalizedTokens.find((t) => t.textoOriginal === 'CX');
    assert.strictEqual(token.tipo, TokenType.EMBALAGEM);
    assert.strictEqual(token.textoCanonico, 'CAIXA');
  });

  await test('token 12UN classificado como QUANTIDADE', () => {
    const resultado = norm('CAIXA 12 UN');
    const token = resultado.normalizedTokens.find((t) => t.textoCanonico === '12UN');
    assert.strictEqual(token.tipo, TokenType.QUANTIDADE);
  });

  await test('normalizedTokens possui campos obrigatórios', () => {
    const resultado = norm('LAMP FLOR');
    const token = resultado.normalizedTokens[0];
    assert.ok(token instanceof CanonicalToken);
    assert.ok(token.textoOriginal);
    assert.ok(token.textoCanonico);
    assert.ok(token.tipo);
    assert.strictEqual(typeof token.posicao, 'number');
    assert.ok(token.normalizado);
  });

  await test('plural LAMPADAS normalizado para LAMPADA', () => {
    const resultado = norm('LAMPADAS LED');
    const token = resultado.normalizedTokens.find((t) => t.textoCanonico === 'LAMPADAS');
    assert.strictEqual(token.normalizado, 'LAMPADA');
  });

  // --- Sprint 7.1: CanonicalStatistics ---

  await test('estatisticas preenchidas', () => {
    const resultado = norm('LAMPADA 20W PHILIPS LED');
    assert.ok(resultado.estatisticas instanceof CanonicalStatistics);
    assert.strictEqual(resultado.estatisticas.quantidadeTokens, 4);
    assert.ok(resultado.estatisticas.quantidadeMedidas >= 1);
    assert.ok(resultado.estatisticas.quantidadeMarcas >= 1);
    assert.ok(resultado.estatisticas.tempoProcessamento >= 0);
  });

  await test('toJSON inclui normalizedTokens e estatisticas', () => {
    const resultado = norm('ARROZ 5KG');
    const json = resultado.toJSON();
    assert.ok(Array.isArray(json.normalizedTokens));
    assert.ok(json.estatisticas);
    assert.strictEqual(json.metadata.versao, '1.1.0');
  });

  // --- Sprint 7.1: Config modular ---

  await test('carregarConfig lê arquivos em config/canonical/', () => {
    const config = CanonicalNormalizer.carregarConfig();
    assert.ok(config.abreviacoes.LAMP);
    assert.ok(config.unidades.includes('KG'));
    assert.ok(config.marcas.includes('PHILIPS'));
    assert.ok(config.stopwords.includes('DE'));
    assert.ok(config.measurements.sufixos.includes('V'));
  });

  await test('carregarDicionario mantém compatibilidade', () => {
    const dict = CanonicalNormalizer.carregarDicionario();
    assert.ok(dict.abreviacoes);
    assert.ok(dict.unidades);
  });

  // --- Casos mistos adicionais ---

  await test('mistura embalagem medida e marca', () => {
    const resultado = norm('CX PCT ARROZ 5KG TIO JOAO');
    assert.ok(resultado.canonico.includes('CAIXA'));
    assert.ok(resultado.canonico.includes('5KG'));
    assert.ok(resultado.canonico.includes('PACOTE'));
  });

  await test('acentos em mistura com medida decimal', () => {
    const resultado = norm('Açúcar Cristal 1,5 KG');
    assert.strictEqual(resultado.canonico, 'ACUCAR CRISTAL 1.5KG');
  });

  await test('potência KW preservada', () => {
    const resultado = norm('MOTOR 2,5 KW');
    assert.strictEqual(resultado.canonico, 'MOTOR 2.5KW');
  });

  await test('stopword mantida como PALAVRA', () => {
    const resultado = norm('ARROZ DE INTEGRAL');
    const token = resultado.normalizedTokens.find((t) => t.textoCanonico === 'DE');
    assert.strictEqual(token.tipo, TokenType.PALAVRA);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
