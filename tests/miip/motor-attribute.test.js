/**
 * Testes — MotorAttributeExtractor + AttributeParser (Sprint 8)
 * Executar: npm run test:miip-attribute
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const IMotorIdentificacao = require('../../backend/motores/miip/core/IMotorIdentificacao');
const CanonicalProduct = require('../../backend/motores/miip/core/CanonicalProduct');
const SemanticProduct = require('../../backend/motores/miip/core/SemanticProduct');
const SemanticExtractionReport = require('../../backend/motores/miip/core/SemanticExtractionReport');
const MotorAttributeExtractor = require('../../backend/motores/miip/engines/MotorAttributeExtractor');
const CanonicalNormalizer = require('../../backend/motores/miip/utils/CanonicalNormalizer');
const AttributeParser = require('../../backend/motores/miip/utils/AttributeParser');
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
  return new MotorAttributeExtractor({
    metricsCollector: opcoes.metrics ?? new MiipMetricsCollector(),
    logService: opcoes.logs ?? new MiipMotorLogService(),
    attributeConfig: opcoes.attributeConfig
  });
}

function canonico(texto) {
  return CanonicalNormalizer.normalizar(texto);
}

function extrair(texto, opcoes = {}) {
  const motor = criarMotor(opcoes);
  const canonical = typeof texto === 'string' ? canonico(texto) : texto;
  return motor.extrair(canonical);
}

function attr(relatorio, campo) {
  const produto = relatorio.produto ?? relatorio;
  const extras = produto.atributosExtras ?? [];
  return extras.find((a) => a.metadata?.campo === campo || a.tipo === campo);
}

async function main() {
  console.log('\n=== Testes MotorAttributeExtractor — MIIP (Sprint 8) ===\n');

  await test('MotorAttributeExtractor estende IMotorIdentificacao', () => {
    const validacao = IMotorIdentificacao.validarHeranca(MotorAttributeExtractor);
    assert.strictEqual(validacao.valido, true, validacao.erros.join('; '));
  });

  await test('MotorAttributeExtractor não acessa SQL nem repositórios', () => {
    const arquivo = path.join(__dirname, '../../backend/motores/miip/engines/attributes/MotorAttributeExtractor.js');
    const codigo = fs.readFileSync(arquivo, 'utf8');
    const proibidos = [
      /SELECT\s+/i,
      /ProdutoRepository/i,
      /xml2js/i,
      /similaridade/i,
      /openai/i,
      /fornecedorCnpj/i,
      /codigoBarras/i
    ];
    proibidos.forEach((padrao) => {
      assert.strictEqual(padrao.test(codigo), false, `Padrão proibido: ${padrao}`);
    });
  });

  await test('identificar retorna array vazio — não identifica produtos', async () => {
    const motor = criarMotor();
    const canonical = canonico('LAMPADA LED 9W PHILIPS');
    const candidatos = await motor.identificar(canonical);
    assert.deepStrictEqual(candidatos, []);
    assert.ok(motor.obterUltimoSemantic());
  });

  await test('getPeso retorna 0', () => {
    assert.strictEqual(criarMotor().getPeso(), 0);
    assert.strictEqual(criarMotor().getCodigo(), 'motor_attribute_extractor');
  });

  await test('exemplo oficial — LAMPADA FLUORESCENTE PHILIPS 20W CAIXA 10', () => {
    const canonical = CanonicalProduct.create({
      original: 'Lamp. Flor. Philips 20W Cx C/10',
      canonico: 'LAMPADA FLUORESCENTE PHILIPS 20W CAIXA 10',
      tokens: ['LAMPADA', 'FLUORESCENTE', 'PHILIPS', '20W', 'CAIXA', '10']
    });
    const { produto, relatorio } = extrair(canonical);

    assert.strictEqual(produto.tipo, 'LAMPADA');
    assert.strictEqual(produto.marca, 'PHILIPS');
    assert.strictEqual(produto.tecnologia, 'FLUORESCENTE');
    assert.strictEqual(produto.potencia, '20W');
    assert.strictEqual(produto.embalagem, 'CAIXA');
    assert.strictEqual(produto.quantidadeEmbalagem, 10);
    assert.ok(relatorio.atributosEncontrados.includes('marca'));
    assert.ok(relatorio.confiancaMedia >= 90);
  });

  await test('atributos possuem valor, confianca, origem e normalizado', () => {
    const { produto } = extrair('LAMPADA LED 9W PHILIPS');
    const marca = produto.atributosExtras.find((a) => a.metadata?.campo === 'marca');
    assert.ok(marca);
    assert.strictEqual(marca.valor, 'PHILIPS');
    assert.ok(marca.confianca >= 90);
    assert.ok(marca.origem);
    assert.strictEqual(marca.normalizado, 'PHILIPS');
  });

  await test('SemanticExtractionReport preenchido', () => {
    const { relatorio } = extrair('TINTA LATEX BRANCO SUVINIL 18L');
    assert.ok(relatorio instanceof SemanticExtractionReport);
    assert.ok(Array.isArray(relatorio.atributosEncontrados));
    assert.ok(Array.isArray(relatorio.atributosNaoEncontrados));
    assert.ok(relatorio.tempoProcessamento >= 0);
  });

  await test('entrada vazia retorna SemanticProduct vazio', () => {
    const { produto, relatorio } = extrair(CanonicalProduct.create({}));
    assert.ok(produto instanceof SemanticProduct);
    assert.strictEqual(produto.marca, null);
    assert.strictEqual(relatorio.atributosEncontrados.length, 0);
  });

  const casosEletricos = [
    ['LAMPADA LED 9W PHILIPS', { potencia: '9W', marca: 'PHILIPS' }],
    ['LAMPADA INCANDESCENTE 60W OSRAM', { potencia: '60W', marca: 'OSRAM' }],
    ['LAMPADA HALOGENA 50W GE', { potencia: '50W' }],
    ['TOMADA 10A 250V BRANCA TRAMONTINA', { tensao: '250V', marca: 'TRAMONTINA', cor: 'BRANCA' }],
    ['INTERRUPTOR SIMPLES 10A 127V', { tensao: '127V' }],
    ['DISJUNTOR 32A 127V TIGRE', { marca: 'TIGRE' }],
    ['CABO FLEXIVEL 2,5MM 750V', { tensao: '750V' }],
    ['RELE FOTOCELULA 220V', { tensao: '220V' }],
    ['LAMPADA FLUORESCENTE 20W PHILIPS', { potencia: '20W', marca: 'PHILIPS' }]
  ];

  for (const [entrada, esperado] of casosEletricos) {
    await test(`elétrico: ${entrada}`, () => {
      const { produto } = extrair(entrada);
      Object.entries(esperado).forEach(([campo, valor]) => {
        assert.strictEqual(produto[campo], valor, `Campo ${campo}`);
      });
    });
  }

  const casosHidraulicos = [
    ['CANO PVC 25MM 6M TIGRE', { marca: 'TIGRE', material: 'PVC' }],
    ['REGISTRO ESFERA 3/8 PVC TIGRE', { marca: 'TIGRE', material: 'PVC' }],
    ['TUBO PEAD 32MM 100M', { material: 'PEAD' }],
    ['VALVULA GAVETA 1/2 BRONZE', { bitola: '1/2' }],
    ['CONEXAO JOELHO 90 50MM PVC', { material: 'PVC' }],
    ['REGISTRO PRESSAO 20MM', { diametro: '20MM' }],
    ['CANO PVC 40MM 3M AMANCO', { marca: 'AMANCO' }],
    ['TUBO PVC ESGOTO 100MM', { material: 'PVC' }]
  ];

  for (const [entrada, esperado] of casosHidraulicos) {
    await test(`hidráulico: ${entrada}`, () => {
      const { produto } = extrair(entrada);
      Object.entries(esperado).forEach(([campo, valor]) => {
        assert.strictEqual(produto[campo], valor, `Campo ${campo}`);
      });
    });
  }

  const casosFerragens = [
    ['PARAFUSO SEXTAVADO M6X50 ACO GALVANIZADO', { material: 'ACO' }],
    ['PORCA SEXTAVADA M8 ACO INOX', { material: 'ACO' }],
    ['ARRUELA LISA M10 ACO', { material: 'ACO' }],
    ['PARAFUSO 3/8 50MM', { bitola: '3/8' }],
    ['REBITE POP 4,8X12 ALUMINIO', { material: 'ALUMINIO' }],
    ['PREGO ACO 2POL', { material: 'ACO' }],
    ['BUCHA S10 NYLON', { material: 'NYLON' }],
    ['PARAFUSO AUTO BROCANTE 4,2X16', { tipo: 'PARAFUSO' }]
  ];

  for (const [entrada, esperado] of casosFerragens) {
    await test(`ferragem: ${entrada}`, () => {
      const { produto } = extrair(entrada);
      Object.entries(esperado).forEach(([campo, valor]) => {
        assert.strictEqual(produto[campo], valor, `Campo ${campo}`);
      });
    });
  }

  const casosTintas = [
    ['TINTA LATEX BRANCO SUVINIL 18L', { marca: 'SUVINIL', cor: 'BRANCO', volume: '18L' }],
    ['TINTA ESMALTE AZUL CORAL 900ML', { marca: 'CORAL', cor: 'AZUL', volume: '900ML' }],
    ['VERNIZ MARITIMO TRANSPARENTE 3,6L', { cor: 'TRANSPARENTE' }],
    ['MASSA CORRIDA 25KG', { peso: '25KG' }],
    ['SELADOR ACRILICO 900ML', { volume: '900ML' }],
    ['TINTA ACRILICA FOSCA BRANCO 3,6L', { cor: 'BRANCO', acabamento: 'FOSCA' }],
    ['TINTA SPRAY PRETO 400ML', { cor: 'PRETO', volume: '400ML' }],
    ['TINTA PVA BRANCO 18L', { cor: 'BRANCO', volume: '18L' }]
  ];

  for (const [entrada, esperado] of casosTintas) {
    await test(`tinta: ${entrada}`, () => {
      const { produto } = extrair(entrada);
      Object.entries(esperado).forEach(([campo, valor]) => {
        assert.strictEqual(produto[campo], valor, `Campo ${campo}`);
      });
    });
  }

  const casosPapelaria = [
    ['PAPEL A4 500F BRW PACOTE', { embalagem: 'PACOTE' }],
    ['CANETA ESFEROGRAFICA AZUL BIC', { marca: 'BIC', cor: 'AZUL' }],
    ['LAPIS PRETO FABER CASTELL', { cor: 'PRETO' }],
    ['CADERNO 96F UNIDADE', { embalagem: 'UNIDADE' }],
    ['PAPEL SULFITE 75G A4', { tipo: 'PAPEL' }],
    ['CANETA HIDROGRAFICA 12 CORES', { tipo: 'CANETA' }],
    ['GRAFITE 0,7MM HB', { diametro: '0.7MM' }],
    ['BORRACHA BRANCA FABER', { cor: 'BRANCA' }]
  ];

  for (const [entrada, esperado] of casosPapelaria) {
    await test(`papelaria: ${entrada}`, () => {
      const { produto } = extrair(entrada);
      Object.entries(esperado).forEach(([campo, valor]) => {
        assert.strictEqual(produto[campo], valor, `Campo ${campo}`);
      });
    });
  }

  const casosMercantil = [
    ['ARROZ INTEGRAL 5KG TIO JOAO', { peso: '5KG', tecnologia: 'INTEGRAL' }],
    ['FEIJAO PRETO 1KG CAMIL', { peso: '1KG', cor: 'PRETO' }],
    ['OLEO SOJA 900ML LIZA', { volume: '900ML' }],
    ['ACUCAR REFINADO 1KG UNIAO', { peso: '1KG', tecnologia: 'REFINADO' }],
    ['SAL REFINADO 1KG', { peso: '1KG' }],
    ['LEITE INTEGRAL 1L ITALAC', { volume: '1L', tecnologia: 'INTEGRAL' }],
    ['CAFE TORRADO 500G MELITTA', { peso: '500G' }],
    ['DETERGENTE LIQUIDO 500ML YPE', { volume: '500ML', marca: 'YPE' }]
  ];

  for (const [entrada, esperado] of casosMercantil) {
    await test(`mercantil: ${entrada}`, () => {
      const { produto } = extrair(entrada);
      Object.entries(esperado).forEach(([campo, valor]) => {
        assert.strictEqual(produto[campo], valor, `Campo ${campo}`);
      });
    });
  }

  const casosConstrucao = [
    ['CIMENTO CP-II 50KG VOTORANTIM', { peso: '50KG', tipo: 'CIMENTO' }],
    ['TUBO PVC ESGOTO 100MM 6M AMANCO', { marca: 'AMANCO', material: 'PVC' }],
    ['TELHA CERAMICA PORTUGUESA', { material: 'CERAMICA' }],
    ['ARGAMASSA AC-II 20KG', { peso: '20KG' }],
    ['SILICONE TRANSPARENTE 280G', { material: 'SILICONE', cor: 'TRANSPARENTE' }],
    ['COLA BRANCA 1KG', { peso: '1KG', cor: 'BRANCA' }],
    ['BLOCO CONCRETO 14X19X39', { tipo: 'BLOCO' }],
    ['TIJOLO CERAMICO 6F', { material: 'CERAMICO', tipo: 'TIJOLO' }]
  ];

  for (const [entrada, esperado] of casosConstrucao) {
    await test(`construção: ${entrada}`, () => {
      const { produto } = extrair(entrada);
      Object.entries(esperado).forEach(([campo, valor]) => {
        assert.strictEqual(produto[campo], valor, `Campo ${campo}`);
      });
    });
  }

  const casosFerramentas = [
    ['FURADEIRA 650W BOSCH', { potencia: '650W', marca: 'BOSCH' }],
    ['DISCO CORTE 4,5POL 115MM', { diametro: '4.5POL' }],
    ['CHAVE PHILLIPS 5/16', { tipo: 'CHAVE' }],
    ['LIXA 5X80 GRANULACAO 80', { comprimento: '5', largura: '80' }],
    ['MARTELO UNHA 27MM VONDER', { marca: 'VONDER' }],
    ['ALICATE UNIVERSAL 8POL TRAMONTINA', { marca: 'TRAMONTINA' }],
    ['ESMERILHADEIRA 750W MAKITA', { potencia: '750W', marca: 'MAKITA' }],
    ['SERRA TICO-TICO 500W BOSCH', { potencia: '500W', marca: 'BOSCH' }]
  ];

  for (const [entrada, esperado] of casosFerramentas) {
    await test(`ferramenta: ${entrada}`, () => {
      const { produto } = extrair(entrada);
      Object.entries(esperado).forEach(([campo, valor]) => {
        assert.strictEqual(produto[campo], valor, `Campo ${campo}`);
      });
    });
  }

  await test('carregarConfig lê attribute-dictionaries', () => {
    const config = AttributeParser.carregarConfig();
    assert.ok(config.marcas.has('PHILIPS'));
    assert.ok(config.tecnologias.has('LED'));
    assert.ok(config.embalagens.has('CAIXA'));
    assert.ok(config.cores.has('BRANCO'));
    assert.ok(config.materiais.has('PVC'));
  });

  await test('relatorio.toJSON serializável', () => {
    const { relatorio } = extrair('PARAFUSO 5MM ACO');
    const json = relatorio.toJSON();
    assert.ok(json.atributosEncontrados);
    assert.ok('confiancaMedia' in json);
  });

  await test('produto.toJSON inclui campos semânticos extraídos', () => {
    const { produto } = extrair('LAMPADA LED 12W PHILIPS');
    const json = produto.toJSON();
    assert.strictEqual(json.potencia, '12W');
    assert.strictEqual(json.marca, 'PHILIPS');
    assert.ok(Array.isArray(json.atributosExtras));
  });

  await test('AttributeParser isolado — sem banco', () => {
    const codigo = fs.readFileSync(
      path.join(__dirname, '../../backend/motores/miip/utils/AttributeParser.js'),
      'utf8'
    );
    assert.strictEqual(/SELECT\s+/i.test(codigo), false);
    assert.strictEqual(/db\.get/i.test(codigo), false);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
