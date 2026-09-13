/**
 * Testes — MotorSimilarity + SimilarityComparator (Sprint 10)
 * Executar: npm run test:miip-similarity
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const IMotorIdentificacao = require('../../backend/motores/miip/core/IMotorIdentificacao');
const SemanticProduct = require('../../backend/motores/miip/core/SemanticProduct');
const SimilarityVote = require('../../backend/motores/miip/core/SimilarityVote');
const SimilarityExplanation = require('../../backend/motores/miip/core/SimilarityExplanation');
const SimilarityStatistics = require('../../backend/motores/miip/core/SimilarityStatistics');
const SimilarityResult = require('../../backend/motores/miip/core/SimilarityResult');
const MotorSimilarity = require('../../backend/motores/miip/engines/MotorSimilarity');
const SimilarityComparator = require('../../backend/motores/miip/utils/SimilarityComparator');
const SimilarityWeights = require('../../backend/motores/miip/utils/SimilarityWeights');
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
  return new MotorSimilarity({
    metricsCollector: opcoes.metrics ?? new MiipMetricsCollector(),
    logService: opcoes.logs ?? new MiipMotorLogService(),
    pesos: opcoes.pesos,
    confianca: opcoes.confianca
  });
}

function produto(atributos = {}) {
  return SemanticProduct.create({
    original: atributos.original ?? 'PRODUTO TESTE',
    canonico: atributos.canonico ?? 'PRODUTO TESTE',
    tokens: atributos.tokens ?? ['PRODUTO', 'TESTE'],
    marca: atributos.marca ?? null,
    tipo: atributos.tipo ?? null,
    tecnologia: atributos.tecnologia ?? null,
    potencia: atributos.potencia ?? null,
    modelo: atributos.modelo ?? null,
    unidadeMedida: atributos.unidadeMedida ?? null,
    embalagem: atributos.embalagem ?? null,
    quantidadeEmbalagem: atributos.quantidadeEmbalagem ?? null,
    material: atributos.material ?? null,
    cor: atributos.cor ?? null,
    synonyms: atributos.synonyms ?? [],
    relatedTokens: atributos.relatedTokens ?? [],
    semanticAliases: atributos.semanticAliases ?? []
  });
}

function comparar(a, b, opcoes) {
  return SimilarityComparator.comparar(produto(a), produto(b), opcoes);
}

function scorePonderado(votos) {
  const total = votos.reduce((acc, v) => acc + v.peso, 0);
  const pontos = votos.reduce((acc, v) => acc + (v.peso * v.score) / 100, 0);
  return total > 0 ? Math.round((pontos / total) * 100) : 0;
}

async function main() {
  console.log('\n=== Testes MotorSimilarity — MIIP (Sprint 10) ===\n');

  await test('MotorSimilarity estende IMotorIdentificacao', () => {
    const validacao = IMotorIdentificacao.validarHeranca(MotorSimilarity);
    assert.strictEqual(validacao.valido, true, validacao.erros.join('; '));
  });

  await test('MotorSimilarity não acessa SQL, XML, GTIN ou ERP', () => {
    const arquivo = path.join(__dirname, '../../backend/motores/miip/engines/similarity/MotorSimilarity.js');
    const codigo = fs.readFileSync(arquivo, 'utf8');
    const proibidos = [
      /SELECT\s+/i,
      /ProdutoRepository/i,
      /xml2js/i,
      /codigoBarras/i,
      /gtin/i,
      /openai/i,
      /require\(['"]\.\.\/\.\.\/\.\.\/database/i
    ];
    proibidos.forEach((padrao) => {
      assert.strictEqual(padrao.test(codigo), false, `Padrão proibido: ${padrao}`);
    });
  });

  await test('getPeso retorna 0 e código motor_similarity', () => {
    const motor = criarMotor();
    assert.strictEqual(motor.getPeso(), 0);
    assert.strictEqual(motor.getCodigo(), 'motor_similarity');
  });

  await test('identificar retorna array vazio — não identifica produtos', async () => {
    const motor = criarMotor();
    const a = produto({ marca: 'PHILIPS', tipo: 'LAMPADA' });
    const b = produto({ marca: 'PHILIPS', tipo: 'LAMPADA' });
    const candidatos = await motor.identificar({ produtoA: a, produtoB: b });
    assert.deepStrictEqual(candidatos, []);
    assert.ok(motor.obterUltimoResultado());
    assert.strictEqual(motor.obterUltimoResultado().score, 100);
  });

  await test('SimilarityVote serializa campos oficiais', () => {
    const vote = SimilarityVote.create({
      atributo: 'marca',
      peso: 25,
      score: 100,
      motivo: 'Marca: PHILIPS = PHILIPS (100%)'
    });
    assert.deepStrictEqual(vote.toJSON(), {
      atributo: 'marca',
      peso: 25,
      score: 100,
      motivo: 'Marca: PHILIPS = PHILIPS (100%)'
    });
  });

  await test('SimilarityExplanation monta texto a partir de linhas', () => {
    const exp = SimilarityExplanation.fromLinhas(['Marca compatível.', 'Tipo compatível.']);
    assert.strictEqual(exp.texto, 'Marca compatível.\nTipo compatível.');
    assert.deepStrictEqual(exp.linhas, ['Marca compatível.', 'Tipo compatível.']);
  });

  await test('SimilarityStatistics serializa métricas', () => {
    const stats = SimilarityStatistics.create({
      quantidadeAtributosComparados: 5,
      quantidadeIguais: 3,
      quantidadeDiferentes: 2,
      tempo: 12
    });
    assert.deepStrictEqual(stats.toJSON(), {
      quantidadeAtributosComparados: 5,
      quantidadeIguais: 3,
      quantidadeDiferentes: 2,
      tempo: 12
    });
  });

  await test('SimilarityResult inclui votes e explicacao', () => {
    const resultado = SimilarityResult.create({
      score: 85,
      confidence: 'ALTA',
      votes: [{ atributo: 'marca', peso: 25, score: 100, motivo: 'Marca: A = A (100%)' }],
      explicacao: { linhas: ['Marca compatível.'] }
    });
    const json = resultado.toJSON();
    assert.strictEqual(json.score, 85);
    assert.strictEqual(json.confidence, 'ALTA');
    assert.strictEqual(json.votes.length, 1);
    assert.ok(json.explicacao.texto.includes('Marca compatível'));
  });

  await test('SimilarityWeights carrega pesos do JSON', () => {
    const config = SimilarityWeights.carregar();
    assert.strictEqual(config.pesos.marca, 25);
    assert.strictEqual(config.pesos.tipo, 20);
    assert.strictEqual(config.pesos.tecnologia, 20);
    assert.strictEqual(config.pesos.potencia, 20);
    assert.strictEqual(config.pesos.modelo, 15);
    assert.strictEqual(config.pesos.unidadeMedida, 5);
    assert.strictEqual(config.confianca.alta, 85);
  });

  await test('SimilarityWeights lista 10 atributos votáveis', () => {
    const atributos = SimilarityWeights.listarAtributos();
    assert.strictEqual(atributos.length, 10);
    assert.ok(atributos.includes('marca'));
    assert.ok(atributos.includes('cor'));
  });

  await test('produtos idênticos — score 100 e confiança ALTA', () => {
    const attrs = {
      marca: 'PHILIPS',
      tipo: 'LAMPADA',
      tecnologia: 'LED',
      potencia: '20W',
      modelo: 'A60'
    };
    const resultado = comparar(attrs, attrs);
    assert.strictEqual(resultado.score, 100);
    assert.strictEqual(resultado.confidence, 'ALTA');
    assert.strictEqual(resultado.matchedAttributes.length, 5);
    assert.strictEqual(resultado.differentAttributes.length, 0);
    resultado.votes.forEach((vote) => {
      assert.strictEqual(vote.score, 100);
      assert.ok(vote.motivo.includes('(100%)'));
    });
  });

  await test('cada voto explica motivo com valores', () => {
    const resultado = comparar(
      { marca: 'PHILIPS', tipo: 'LAMPADA', potencia: '20W' },
      { marca: 'PHILIPS', tipo: 'LAMPADA', potencia: '20W' }
    );
    const marca = resultado.votes.find((v) => v.atributo === 'marca');
    const tipo = resultado.votes.find((v) => v.atributo === 'tipo');
    const potencia = resultado.votes.find((v) => v.atributo === 'potencia');
    assert.ok(marca.motivo.includes('PHILIPS = PHILIPS'));
    assert.ok(tipo.motivo.includes('LAMPADA = LAMPADA'));
    assert.ok(potencia.motivo.includes('20W = 20W'));
  });

  await test('explicacao amigável lista atributos compatíveis', () => {
    const resultado = comparar(
      { marca: 'PHILIPS', potencia: '20W' },
      { marca: 'PHILIPS', potencia: '20W' }
    );
    assert.ok(resultado.explicacao.texto.includes('Marca compatível.'));
    assert.ok(resultado.explicacao.texto.includes('Potência compatível.'));
  });

  await test('nunca retorna apenas porcentagem — inclui votes e explicacao', () => {
    const resultado = criarMotor().comparar(
      produto({ marca: 'OSRAM' }),
      produto({ marca: 'PHILIPS' })
    );
    assert.ok(Array.isArray(resultado.votes) && resultado.votes.length > 0);
    assert.ok(resultado.explicacao.texto.length > 0);
    assert.ok(resultado.matchedAttributes !== undefined);
    assert.ok(resultado.estatisticas.quantidadeAtributosComparados >= 1);
  });

  await test('produtos sem atributos — score 0 e mensagem informativa', () => {
    const resultado = comparar({}, {});
    assert.strictEqual(resultado.score, 0);
    assert.strictEqual(resultado.votes.length, 0);
    assert.ok(resultado.explicacao.texto.includes('Nenhum atributo'));
  });

  await test('marca diferente reduz score', () => {
    const resultado = comparar(
      { marca: 'PHILIPS', tipo: 'LAMPADA', potencia: '20W' },
      { marca: 'OSRAM', tipo: 'LAMPADA', potencia: '20W' }
    );
    assert.ok(resultado.score < 100);
    assert.ok(resultado.differentAttributes.includes('marca'));
    assert.ok(resultado.explicacao.texto.includes('Marca diferente.'));
  });

  await test('potência diferente reduz score', () => {
    const resultado = comparar(
      { marca: 'PHILIPS', potencia: '20W' },
      { marca: 'PHILIPS', potencia: '40W' }
    );
    assert.ok(resultado.differentAttributes.includes('potencia'));
    const vote = resultado.votes.find((v) => v.atributo === 'potencia');
    assert.strictEqual(vote.score, 0);
    assert.ok(vote.motivo.includes('20W diferente de 40W'));
  });

  await test('unidade diferente reduz score', () => {
    const resultado = comparar(
      { marca: 'TIGRE', tipo: 'TUBO', unidadeMedida: '3M' },
      { marca: 'TIGRE', tipo: 'TUBO', unidadeMedida: '6M' }
    );
    assert.ok(resultado.differentAttributes.includes('unidadeMedida'));
  });

  await test('material diferente reduz score', () => {
    const resultado = comparar(
      { tipo: 'PARAFUSO', material: 'ACO' },
      { tipo: 'PARAFUSO', material: 'INOX' }
    );
    assert.ok(resultado.differentAttributes.includes('material'));
  });

  await test('cor diferente reduz score', () => {
    const resultado = comparar(
      { tipo: 'TINTA', cor: 'BRANCO' },
      { tipo: 'TINTA', cor: 'AZUL' }
    );
    assert.ok(resultado.differentAttributes.includes('cor'));
  });

  await test('tipo diferente reduz score significativamente', () => {
    const resultado = comparar(
      { marca: 'PHILIPS', tipo: 'LAMPADA', potencia: '20W' },
      { marca: 'PHILIPS', tipo: 'LUMINARIA', potencia: '20W' }
    );
    assert.ok(resultado.score < 80);
    assert.ok(resultado.differentAttributes.includes('tipo'));
  });

  await test('tecnologia diferente reduz score', () => {
    const resultado = comparar(
      { tipo: 'LAMPADA', tecnologia: 'LED', potencia: '9W' },
      { tipo: 'LAMPADA', tecnologia: 'FLUORESCENTE', potencia: '9W' }
    );
    assert.ok(resultado.differentAttributes.includes('tecnologia'));
  });

  await test('modelo diferente reduz score', () => {
    const resultado = comparar(
      { marca: 'BOSCH', modelo: 'GSR120', tipo: 'FURADEIRA' },
      { marca: 'BOSCH', modelo: 'GSR180', tipo: 'FURADEIRA' }
    );
    assert.ok(resultado.differentAttributes.includes('modelo'));
  });

  await test('embalagem diferente reduz score', () => {
    const resultado = comparar(
      { tipo: 'CIMENTO', embalagem: 'SACO' },
      { tipo: 'CIMENTO', embalagem: 'BIG BAG' }
    );
    assert.ok(resultado.differentAttributes.includes('embalagem'));
  });

  await test('quantidade embalagem diferente reduz score', () => {
    const resultado = comparar(
      { tipo: 'CERVEJA', quantidadeEmbalagem: '12' },
      { tipo: 'CERVEJA', quantidadeEmbalagem: '24' }
    );
    assert.ok(resultado.differentAttributes.includes('quantidadeEmbalagem'));
  });

  await test('marcas iguais com demais atributos diferentes — score parcial', () => {
    const resultado = comparar(
      { marca: 'PHILIPS', tipo: 'LAMPADA', potencia: '20W' },
      { marca: 'PHILIPS', tipo: 'LUMINARIA', potencia: '40W' }
    );
    assert.ok(resultado.matchedAttributes.includes('marca'));
    assert.ok(resultado.score > 0 && resultado.score < 100);
  });

  await test('sinônimo via semanticAliases — match 100%', () => {
    const resultado = comparar(
      {
        tipo: 'LAMP',
        semanticAliases: ['LAMP=LAMPADA']
      },
      { tipo: 'LAMPADA' }
    );
    const vote = resultado.votes.find((v) => v.atributo === 'tipo');
    assert.strictEqual(vote.score, 100);
    assert.ok(vote.motivo.includes('equivalente'));
  });

  await test('sinônimo via relatedTokens — match 100%', () => {
    const resultado = comparar(
      { tecnologia: 'FLUOR', relatedTokens: ['FLUORESCENTE'] },
      { tecnologia: 'FLUORESCENTE' }
    );
    const vote = resultado.votes.find((v) => v.atributo === 'tecnologia');
    assert.strictEqual(vote.score, 100);
  });

  await test('sinônimo via synonyms array — match 100%', () => {
    const resultado = comparar(
      {
        embalagem: 'CX',
        synonyms: [{ original: 'CX', sinonimo: 'CAIXA' }]
      },
      { embalagem: 'CAIXA' }
    );
    const vote = resultado.votes.find((v) => v.atributo === 'embalagem');
    assert.strictEqual(vote.score, 100);
  });

  await test('normalização ignora acentos e caixa', () => {
    const resultado = comparar(
      { marca: 'philips' },
      { marca: 'PHILIPS' }
    );
    assert.strictEqual(resultado.score, 100);
  });

  await test('atributo presente só em A — score 0 no voto', () => {
    const resultado = comparar(
      { marca: 'PHILIPS' },
      {}
    );
    const vote = resultado.votes.find((v) => v.atributo === 'marca');
    assert.strictEqual(vote.score, 0);
    assert.ok(vote.motivo.includes('ausente em B'));
  });

  await test('atributo presente só em B — score 0 no voto', () => {
    const resultado = comparar(
      {},
      { potencia: '20W' }
    );
    const vote = resultado.votes.find((v) => v.atributo === 'potencia');
    assert.strictEqual(vote.score, 0);
    assert.ok(vote.motivo.includes('ausente em A'));
  });

  await test('confiança ALTA quando score >= 85', () => {
    const resultado = comparar(
      { marca: 'PHILIPS', tipo: 'LAMPADA', tecnologia: 'LED', potencia: '20W', modelo: 'A60' },
      { marca: 'PHILIPS', tipo: 'LAMPADA', tecnologia: 'LED', potencia: '20W', modelo: 'A60' }
    );
    assert.strictEqual(resultado.confidence, 'ALTA');
  });

  await test('confiança MEDIA quando score entre 60 e 84', () => {
    const resultado = comparar(
      { marca: 'PHILIPS', tipo: 'LAMPADA', potencia: '20W' },
      { marca: 'PHILIPS', tipo: 'LUMINARIA', potencia: '40W' }
    );
    assert.ok(['MEDIA', 'BAIXA', 'ALTA'].includes(resultado.confidence));
    assert.ok(resultado.score >= 0);
  });

  await test('confiança NENHUMA quando score muito baixo', () => {
    const resultado = comparar(
      { marca: 'A', tipo: 'X', tecnologia: 'Y', potencia: '1W' },
      { marca: 'B', tipo: 'Z', tecnologia: 'W', potencia: '99W' }
    );
    assert.ok(['NENHUMA', 'BAIXA'].includes(resultado.confidence));
  });

  await test('estatísticas registram tempo e contagens', () => {
    const resultado = comparar(
      { marca: 'PHILIPS', tipo: 'LAMPADA' },
      { marca: 'PHILIPS', tipo: 'LAMPADA' }
    );
    assert.strictEqual(resultado.estatisticas.quantidadeAtributosComparados, 2);
    assert.strictEqual(resultado.estatisticas.quantidadeIguais, 2);
    assert.strictEqual(resultado.estatisticas.quantidadeDiferentes, 0);
    assert.ok(resultado.estatisticas.tempo >= 0);
  });

  await test('pesos customizados alteram score global', () => {
    const base = { marca: 'PHILIPS', cor: 'BRANCO' };
    const outro = { marca: 'OSRAM', cor: 'BRANCO' };
    const padrao = comparar(base, outro);
    const custom = comparar(base, outro, {
      pesos: { marca: 1, cor: 99 }
    });
    assert.notStrictEqual(padrao.score, custom.score);
    assert.ok(custom.score > padrao.score);
  });

  await test('comparar aceita objetos planos sem SemanticProduct', () => {
    const resultado = criarMotor().comparar(
      { marca: 'TIGRE', tipo: 'REGISTRO' },
      { marca: 'TIGRE', tipo: 'REGISTRO' }
    );
    assert.strictEqual(resultado.score, 100);
  });

  await test('comparar com entrada inválida retorna score 0', () => {
    const resultado = criarMotor().comparar(null, produto({ marca: 'X' }));
    assert.strictEqual(resultado.score, 0);
    assert.strictEqual(resultado.confidence, 'NENHUMA');
  });

  // --- Casos de produtos iguais (elétricos) ---
  const lampadasIguais = [
    { marca: 'PHILIPS', tipo: 'LAMPADA', tecnologia: 'LED', potencia: '9W' },
    { marca: 'OSRAM', tipo: 'LAMPADA', tecnologia: 'LED', potencia: '12W' },
    { marca: 'ELGIN', tipo: 'LAMPADA', tecnologia: 'HALOGENA', potencia: '50W' },
    { marca: 'PHILIPS', tipo: 'LAMPADA', tecnologia: 'FLUORESCENTE', potencia: '20W', modelo: 'T8' },
    { marca: 'STELLA', tipo: 'LUMINARIA', tecnologia: 'LED', potencia: '18W', modelo: 'SPOT' }
  ];

  for (let i = 0; i < lampadasIguais.length; i += 1) {
    const attrs = lampadasIguais[i];
    await test(`produto elétrico idêntico #${i + 1} — score 100`, () => {
      const resultado = comparar(attrs, { ...attrs });
      assert.strictEqual(resultado.score, 100);
    });
  }

  // --- Casos construção ---
  const construcaoIguais = [
    { tipo: 'CIMENTO', embalagem: 'SACO', quantidadeEmbalagem: '50', material: 'PORTLAND' },
    { tipo: 'VERGALHAO', material: 'ACO', unidadeMedida: '12M' },
    { tipo: 'TIJOLO', material: 'CERAMICA', cor: 'VERMELHO' },
    { tipo: 'ARGAMASSA', embalagem: 'SACO', quantidadeEmbalagem: '20' },
    { tipo: 'TELHA', material: 'CERAMICA', cor: 'TERRACOTA' }
  ];

  for (let i = 0; i < construcaoIguais.length; i += 1) {
    const attrs = construcaoIguais[i];
    await test(`produto construção idêntico #${i + 1} — score 100`, () => {
      const resultado = comparar(attrs, { ...attrs });
      assert.strictEqual(resultado.score, 100);
    });
  }

  // --- Casos hidráulicos ---
  const hidraulicosIguais = [
    { marca: 'TIGRE', tipo: 'TUBO', material: 'PVC', unidadeMedida: '3M' },
    { marca: 'AMANCO', tipo: 'CONEXAO', material: 'PVC', modelo: 'JOELHO 90' },
    { marca: 'FORTLEV', tipo: 'REGISTRO', material: 'PVC' },
    { marca: 'TIGRE', tipo: 'ADESIVO', embalagem: 'LATA', quantidadeEmbalagem: '75' },
    { marca: 'KRONA', tipo: 'TORNEIRA', material: 'METAL', cor: 'CROMADO' }
  ];

  for (let i = 0; i < hidraulicosIguais.length; i += 1) {
    const attrs = hidraulicosIguais[i];
    await test(`produto hidráulico idêntico #${i + 1} — score 100`, () => {
      const resultado = comparar(attrs, { ...attrs });
      assert.strictEqual(resultado.score, 100);
    });
  }

  // --- Casos parecidos (marca igual, algo diferente) ---
  const parecidos = [
    [
      { marca: 'PHILIPS', tipo: 'LAMPADA', potencia: '9W' },
      { marca: 'PHILIPS', tipo: 'LAMPADA', potencia: '12W' }
    ],
    [
      { marca: 'BOSCH', tipo: 'FURADEIRA', modelo: 'GSR120' },
      { marca: 'BOSCH', tipo: 'FURADEIRA', modelo: 'GSR180' }
    ],
    [
      { marca: 'TIGRE', tipo: 'TUBO', unidadeMedida: '3M' },
      { marca: 'TIGRE', tipo: 'TUBO', unidadeMedida: '6M' }
    ],
    [
      { tipo: 'PARAFUSO', material: 'ACO', cor: 'ZINCADO' },
      { tipo: 'PARAFUSO', material: 'INOX', cor: 'ZINCADO' }
    ],
    [
      { tipo: 'TINTA', cor: 'BRANCO', embalagem: 'LATA' },
      { tipo: 'TINTA', cor: 'BRANCO', embalagem: 'GALAO' }
    ]
  ];

  for (let i = 0; i < parecidos.length; i += 1) {
    const [a, b] = parecidos[i];
    await test(`produtos parecidos #${i + 1} — score parcial`, () => {
      const resultado = comparar(a, b);
      assert.ok(resultado.score > 0 && resultado.score < 100);
      assert.ok(resultado.votes.every((v) => v.motivo.length > 0));
    });
  }

  // --- Casos diferentes ---
  const diferentes = [
    [
      { marca: 'PHILIPS', tipo: 'LAMPADA', potencia: '9W' },
      { marca: 'TIGRE', tipo: 'TUBO', unidadeMedida: '3M' }
    ],
    [
      { tipo: 'CIMENTO', material: 'PORTLAND' },
      { tipo: 'TINTA', cor: 'AZUL' }
    ],
    [
      { marca: 'BOSCH', tipo: 'FURADEIRA' },
      { marca: 'MAKITA', tipo: 'SERRA' }
    ],
    [
      { tipo: 'ARROZ', embalagem: 'PACOTE' },
      { tipo: 'FEIJAO', embalagem: 'PACOTE' }
    ],
    [
      { marca: 'ELGIN', tecnologia: 'LED', potencia: '9W' },
      { marca: 'OSRAM', tecnologia: 'HALOGENA', potencia: '50W' }
    ]
  ];

  for (let i = 0; i < diferentes.length; i += 1) {
    const [a, b] = diferentes[i];
    await test(`produtos diferentes #${i + 1} — score baixo`, () => {
      const resultado = comparar(a, b);
      assert.ok(resultado.score < 70);
      assert.ok(resultado.differentAttributes.length >= 1);
    });
  }

  // --- Casos mercantil ---
  const mercantil = [
    { tipo: 'ARROZ', embalagem: 'PACOTE', quantidadeEmbalagem: '1' },
    { tipo: 'FEIJAO', embalagem: 'PACOTE', quantidadeEmbalagem: '1' },
    { tipo: 'ACUCAR', embalagem: 'PACOTE', quantidadeEmbalagem: '1' },
    { tipo: 'CAFE', embalagem: 'POTE', quantidadeEmbalagem: '500' },
    { tipo: 'OLEO', embalagem: 'GARRAFA', quantidadeEmbalagem: '900' }
  ];

  for (let i = 0; i < mercantil.length; i += 1) {
    await test(`mercantil idêntico #${i + 1}`, () => {
      const attrs = mercantil[i];
      assert.strictEqual(comparar(attrs, { ...attrs }).score, 100);
    });
  }

  // --- Casos ferragens ---
  const ferragens = [
    { tipo: 'PARAFUSO', material: 'ACO', cor: 'ZINCADO' },
    { tipo: 'PORCA', material: 'ACO', cor: 'ZINCADO' },
    { tipo: 'ARRUELA', material: 'ACO' },
    { tipo: 'DOBRADICA', material: 'ACO', cor: 'NIQUELADO' },
    { tipo: 'FECHADURA', material: 'ACO', cor: 'DOURADO' }
  ];

  for (let i = 0; i < ferragens.length; i += 1) {
    await test(`ferragem idêntica #${i + 1}`, () => {
      const attrs = ferragens[i];
      assert.strictEqual(comparar(attrs, { ...attrs }).score, 100);
    });
  }

  // --- Score ponderado manual ---
  await test('score global é média ponderada dos votos', () => {
    const resultado = comparar(
      { marca: 'PHILIPS', tipo: 'LAMPADA', potencia: '20W' },
      { marca: 'PHILIPS', tipo: 'LUMINARIA', potencia: '20W' }
    );
    assert.strictEqual(resultado.score, scorePonderado(resultado.votes));
  });

  await test('toJSON do resultado é serializável', () => {
    const resultado = comparar(
      { marca: 'PHILIPS', tipo: 'LAMPADA' },
      { marca: 'PHILIPS', tipo: 'LAMPADA' }
    );
    const json = JSON.parse(JSON.stringify(resultado.toJSON()));
    assert.strictEqual(json.score, 100);
    assert.ok(json.votes.length >= 2);
    assert.ok(json.explicacao.texto);
  });

  await test('SimilarityComparator normalizarValor remove espaços extras', () => {
    assert.strictEqual(SimilarityComparator.normalizarValor('  philips  '), 'PHILIPS');
  });

  await test('coletarEquivalentes inclui valor base', () => {
    const p = produto({ marca: 'PHILIPS' });
    const equiv = SimilarityComparator.coletarEquivalentes(p, 'PHILIPS');
    assert.ok(equiv.has('PHILIPS'));
  });

  await test('valoresCompativeis detecta equivalência cruzada entre produtos', () => {
    const a = produto({ tipo: 'CANO', semanticAliases: ['CANO=TUBO'] });
    const b = produto({ tipo: 'TUBO' });
    const resultado = SimilarityComparator.valoresCompativeis('CANO', a, 'TUBO', b);
    assert.strictEqual(resultado.compativel, true);
    assert.strictEqual(resultado.viaSinonimo, true);
  });

  await test('produtos tinta — mesma cor e tipo, marcas diferentes', () => {
    const resultado = comparar(
      { marca: 'CORAL', tipo: 'TINTA', cor: 'BRANCO' },
      { marca: 'SUVINIL', tipo: 'TINTA', cor: 'BRANCO' }
    );
    assert.ok(resultado.matchedAttributes.includes('tipo'));
    assert.ok(resultado.matchedAttributes.includes('cor'));
    assert.ok(resultado.differentAttributes.includes('marca'));
    assert.ok(resultado.score >= 30 && resultado.score <= 70);
  });

  console.log(`\n--- Resultado: ${passou} passou, ${falhou} falhou ---\n`);

  if (falhou > 0) {
    process.exit(1);
  }
}

main();
