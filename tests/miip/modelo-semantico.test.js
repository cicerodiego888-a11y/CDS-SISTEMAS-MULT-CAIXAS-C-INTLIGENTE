/**
 * Testes — Modelo Semântico MIIP (Sprint 7.2)
 * Executar: npm run test:miip-semantico
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SemanticProduct = require('../../backend/motores/miip/core/SemanticProduct');
const SemanticAttribute = require('../../backend/motores/miip/core/SemanticAttribute');
const SemanticAttributeType = require('../../backend/motores/miip/core/SemanticAttributeType');
const SemanticMetadata = require('../../backend/motores/miip/core/SemanticMetadata');
const CanonicalToken = require('../../backend/motores/miip/core/CanonicalToken');
const TokenType = require('../../backend/motores/miip/core/TokenType');

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

const ARQUIVOS_DOMINIO = [
  'SemanticProduct.js',
  'SemanticAttribute.js',
  'SemanticAttributeType.js',
  'SemanticMetadata.js'
];

async function main() {
  console.log('\n=== Testes Modelo Semântico — MIIP (Sprint 7.2) ===\n');

  await test('SemanticProduct instancia com todos os campos nulos', () => {
    const produto = SemanticProduct.create();
    SemanticProduct.CAMPOS.forEach((campo) => {
      assert.strictEqual(produto[campo], null, `Campo ${campo} deveria ser null`);
    });
  });

  await test('SemanticProduct.create retorna instância válida', () => {
    const produto = SemanticProduct.create();
    assert.ok(produto instanceof SemanticProduct);
  });

  await test('SemanticProduct validarEstrutura aprova instância completa', () => {
    const produto = SemanticProduct.create();
    const validacao = SemanticProduct.validarEstrutura(produto);
    assert.strictEqual(validacao.valido, true);
    assert.strictEqual(validacao.ausentes.length, 0);
    assert.strictEqual(validacao.campos.length, SemanticProduct.CAMPOS.length);
  });

  await test('SemanticProduct possui 38 campos no contrato', () => {
    assert.strictEqual(SemanticProduct.CAMPOS.length, 38);
  });

  await test('SemanticProduct aceita dados parciais sem extração', () => {
    const produto = SemanticProduct.create({
      original: 'Lamp. Flor. Philips 20W Cx C/10',
      canonico: 'LAMPADA FLUORESCENTE PHILIPS 20W CAIXA 10',
      tipo: 'LAMPADA',
      marca: 'PHILIPS',
      tecnologia: 'FLUORESCENTE',
      potencia: '20W',
      embalagem: 'CAIXA',
      quantidadeEmbalagem: 10
    });

    assert.strictEqual(produto.tipo, 'LAMPADA');
    assert.strictEqual(produto.marca, 'PHILIPS');
    assert.strictEqual(produto.tecnologia, 'FLUORESCENTE');
    assert.strictEqual(produto.potencia, '20W');
    assert.strictEqual(produto.embalagem, 'CAIXA');
    assert.strictEqual(produto.quantidadeEmbalagem, 10);
    assert.strictEqual(produto.categoria, null);
    assert.strictEqual(produto.ncm, null);
  });

  await test('SemanticProduct toJSON serializa todos os campos', () => {
    const produto = SemanticProduct.create({
      original: 'teste',
      canonico: 'TESTE',
      tokens: ['TESTE'],
      metadata: { engine: 'contrato' }
    });
    const json = produto.toJSON();

    SemanticProduct.CAMPOS.forEach((campo) => {
      assert.ok(Object.prototype.hasOwnProperty.call(json, campo), `JSON sem campo ${campo}`);
    });
    assert.strictEqual(json.original, 'teste');
    assert.strictEqual(json.canonico, 'TESTE');
    assert.deepStrictEqual(json.tokens, ['TESTE']);
    assert.strictEqual(json.metadata.engine, 'contrato');
  });

  await test('SemanticProduct preserva normalizedTokens como CanonicalToken', () => {
    const produto = SemanticProduct.create({
      normalizedTokens: [
        { textoOriginal: 'LAMP', textoCanonico: 'LAMPADA', tipo: TokenType.PALAVRA, posicao: 0, normalizado: 'LAMPADA' }
      ]
    });
    assert.ok(produto.normalizedTokens[0] instanceof CanonicalToken);
    assert.strictEqual(produto.toJSON().normalizedTokens[0].textoCanonico, 'LAMPADA');
  });

  await test('SemanticProduct preserva atributosExtras como SemanticAttribute', () => {
    const produto = SemanticProduct.create({
      atributosExtras: [
        { tipo: SemanticAttributeType.COR, valor: 'BRANCO', confianca: 0.9 }
      ]
    });
    assert.ok(produto.atributosExtras[0] instanceof SemanticAttribute);
    assert.strictEqual(produto.toJSON().atributosExtras[0].tipo, 'COR');
  });

  await test('SemanticAttribute instancia com campos nulos', () => {
    const attr = SemanticAttribute.create();
    assert.strictEqual(attr.tipo, null);
    assert.strictEqual(attr.valor, null);
    assert.strictEqual(attr.confianca, null);
    assert.strictEqual(attr.origem, null);
    assert.strictEqual(attr.normalizado, null);
    assert.strictEqual(attr.metadata, null);
  });

  await test('SemanticAttribute toJSON serializa corretamente', () => {
    const attr = SemanticAttribute.create({
      tipo: SemanticAttributeType.POTENCIA,
      valor: '20W',
      confianca: 1,
      origem: 'manual',
      normalizado: '20W',
      metadata: { observacoes: 'exemplo' }
    });
    const json = attr.toJSON();
    assert.strictEqual(json.tipo, 'POTENCIA');
    assert.strictEqual(json.valor, '20W');
    assert.strictEqual(json.confianca, 1);
    assert.strictEqual(json.origem, 'manual');
    assert.strictEqual(json.normalizado, '20W');
    assert.strictEqual(json.metadata.observacoes, 'exemplo');
  });

  await test('SemanticAttributeType contém tipos oficiais', () => {
    const esperados = [
      'TIPO', 'MARCA', 'MODELO', 'TECNOLOGIA', 'POTENCIA', 'TENSAO',
      'COR', 'MATERIAL', 'BITOLA', 'DIAMETRO', 'PESO', 'VOLUME',
      'CAPACIDADE', 'EMBALAGEM', 'UNIDADE', 'QUANTIDADE',
      'NCM', 'CEST', 'GTIN', 'OUTRO'
    ];
    esperados.forEach((tipo) => {
      assert.ok(SemanticAttributeType.TODOS.includes(tipo), `Tipo ausente: ${tipo}`);
    });
    assert.strictEqual(SemanticAttributeType.TODOS.length, 20);
  });

  await test('SemanticMetadata instancia com versão padrão', () => {
    const meta = SemanticMetadata.create();
    assert.strictEqual(meta.versao, '1.0.0');
    assert.strictEqual(meta.origem, null);
    assert.strictEqual(meta.timestamp, null);
    assert.strictEqual(meta.engine, null);
    assert.strictEqual(meta.observacoes, null);
  });

  await test('SemanticMetadata toJSON serializa corretamente', () => {
    const meta = SemanticMetadata.create({
      origem: 'canonical',
      timestamp: '2026-07-05T00:00:00Z',
      engine: 'motor_canonical',
      observacoes: 'contrato sprint 7.2'
    });
    const json = meta.toJSON();
    assert.strictEqual(json.versao, '1.0.0');
    assert.strictEqual(json.origem, 'canonical');
    assert.strictEqual(json.engine, 'motor_canonical');
  });

  await test('exemplo documentado Lamp. Flor. Philips 20W Cx C/10', () => {
    const produto = SemanticProduct.create({
      original: 'Lamp. Flor. Philips 20W Cx C/10',
      canonico: 'LAMPADA FLUORESCENTE PHILIPS 20W CAIXA 10',
      tipo: 'LAMPADA',
      marca: 'PHILIPS',
      tecnologia: 'FLUORESCENTE',
      potencia: '20W',
      embalagem: 'CAIXA',
      quantidadeEmbalagem: 10
    });

    const json = produto.toJSON();
    assert.strictEqual(json.tipo, 'LAMPADA');
    assert.strictEqual(json.marca, 'PHILIPS');
    assert.strictEqual(json.tecnologia, 'FLUORESCENTE');
    assert.strictEqual(json.potencia, '20W');
    assert.strictEqual(json.embalagem, 'CAIXA');
    assert.strictEqual(json.quantidadeEmbalagem, 10);
    assert.strictEqual(json.categoria, null);
  });

  await test('VERSAO_PADRAO definida em todas as entidades', () => {
    assert.strictEqual(SemanticProduct.VERSAO_PADRAO, '1.0.0');
    assert.strictEqual(SemanticMetadata.VERSAO_PADRAO, '1.0.0');
  });

  await test('arquivos de domínio não contêm lógica proibida', () => {
    const base = path.join(__dirname, '../../backend/motores/miip/core');
    const proibidos = [
      /SELECT\s+/i,
      /require\(['"].*Repository/i,
      /xml2js/i,
      /similaridade/i,
      /identificar\s*\(/i,
      /openai/i,
      /fetch\s*\(/i
    ];

    ARQUIVOS_DOMINIO.forEach((arquivo) => {
      const codigo = fs.readFileSync(path.join(base, arquivo), 'utf8');
      proibidos.forEach((padrao) => {
        assert.strictEqual(padrao.test(codigo), false, `${arquivo}: padrão proibido ${padrao}`);
      });
    });
  });

  await test('compatibilidade futura — tokens independentes do canônico', () => {
    const produto = SemanticProduct.create({
      canonico: 'ARROZ 5KG',
      tokens: ['ARROZ', '5KG'],
      normalizedTokens: null,
      peso: null
    });
    assert.deepStrictEqual(produto.tokens, ['ARROZ', '5KG']);
    assert.strictEqual(produto.peso, null);
  });

  await test('compatibilidade futura — atributosExtras extensível', () => {
    const produto = SemanticProduct.create({
      atributosExtras: [
        SemanticAttribute.create({ tipo: SemanticAttributeType.OUTRO, valor: 'NOVO_CAMPO' })
      ]
    });
    assert.strictEqual(produto.atributosExtras.length, 1);
    assert.strictEqual(produto.toJSON().atributosExtras[0].tipo, 'OUTRO');
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
