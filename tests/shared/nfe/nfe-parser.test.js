/**
 * Testes — Pipeline Oficial de Parse NF-e (Sprint 3)
 * Executar: npm run test:nfe-parser
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const NFeParserService = require('../../../backend/shared/nfe/NFeParserService');
const NFeParser = require('../../../backend/shared/nfe/NFeParser');
const NFeParserError = require('../../../backend/shared/nfe/errors/NFeParserError');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

let passou = 0;
let falhou = 0;

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

function lerFixture(nome) {
  return fs.readFileSync(path.join(FIXTURES_DIR, nome), 'utf8');
}

/** Estrutura esperada compatível com parse-xml legado */
const CAMPOS_CABECALHO = [
  'chave_acesso',
  'numero_nf',
  'serie_nf',
  'modelo_nf',
  'data_emissao',
  'data_entrada',
  'fornecedor',
  'fornecedor_cnpj',
  'fornecedor_rua',
  'fornecedor_numero',
  'fornecedor_bairro',
  'fornecedor_cidade',
  'fornecedor_uf',
  'fornecedor_cep',
  'fornecedor_endereco',
  'valor_produtos',
  'valor_desconto',
  'valor_frete',
  'valor_outras_despesas',
  'valor_total_nota',
  'observacao',
  'itens'
];

const CAMPOS_ITEM = [
  'produto_nome',
  'codigo_fornecedor',
  'codigo_barras',
  'ncm',
  'unidade',
  'quantidade',
  'preco_unitario',
  'subtotal',
  'margem_lucro',
  'preco_venda_sugerido'
];

function assertEstruturaCompativel(parsed) {
  CAMPOS_CABECALHO.forEach((campo) => {
    assert.ok(Object.prototype.hasOwnProperty.call(parsed, campo), `Campo ausente: ${campo}`);
  });

  assert.ok(Array.isArray(parsed.itens), 'itens deve ser array');
  assert.ok(parsed.itens.length > 0, 'itens não pode ser vazio');

  parsed.itens.forEach((item, indice) => {
    CAMPOS_ITEM.forEach((campo) => {
      assert.ok(
        Object.prototype.hasOwnProperty.call(item, campo),
        `Item ${indice}: campo ausente ${campo}`
      );
    });
  });
}

async function main() {
  console.log('\n=== Testes Pipeline Oficial NF-e — Sprint 3 ===\n');

  await test('parse nfeProc (formato clássico upload Compras)', async () => {
    const xml = lerFixture('nfe-proc-sample.xml');
    const parsed = await NFeParserService.parse(xml);

    assertEstruturaCompativel(parsed);

    assert.strictEqual(parsed.chave_acesso, '35260112345678000199550010000000011000000001');
    assert.strictEqual(parsed.numero_nf, '1001');
    assert.strictEqual(parsed.serie_nf, '1');
    assert.strictEqual(parsed.modelo_nf, '55');
    assert.strictEqual(parsed.data_emissao, '2026-06-01');
    assert.strictEqual(parsed.data_entrada, '2026-06-02');
    assert.strictEqual(parsed.fornecedor, 'Distribuidora Teste Ltda');
    assert.strictEqual(parsed.fornecedor_cnpj, '12345678000199');
    assert.strictEqual(parsed.fornecedor_endereco, 'Rua das Flores, 100, Centro, Fortaleza, CE, 60000000');
    assert.strictEqual(parsed.valor_produtos, 115);
    assert.strictEqual(parsed.valor_desconto, 5);
    assert.strictEqual(parsed.valor_frete, 10);
    assert.strictEqual(parsed.valor_outras_despesas, 2.5);
    assert.strictEqual(parsed.valor_total_nota, 122.5);
    assert.strictEqual(parsed.observacao, 'Pedido interno 12345');
    assert.strictEqual(parsed.itens.length, 2);

    const item1 = parsed.itens[0];
    assert.strictEqual(item1.produto_nome, 'Refrigerante Cola 2L');
    assert.strictEqual(item1.codigo_fornecedor, 'ABC001');
    assert.strictEqual(item1.codigo_barras, '7891234567890');
    assert.strictEqual(item1.quantidade, 10);
    assert.strictEqual(item1.preco_unitario, 5.5);
    assert.strictEqual(item1.subtotal, 55);
    assert.strictEqual(item1.margem_lucro, null);
    assert.strictEqual(item1.preco_venda_sugerido, null);

    const item2 = parsed.itens[1];
    assert.strictEqual(item2.codigo_barras, '7891234567891');
    assert.strictEqual(item2.unidade, 'CX');
  });

  await test('parse NFe direta (sem nfeProc)', async () => {
    const xml = lerFixture('nfe-direta-sample.xml');
    const parsed = await NFeParserService.parse(xml);

    assertEstruturaCompativel(parsed);

    assert.strictEqual(parsed.chave_acesso, '35260198765432000188550010000000022000000002');
    assert.strictEqual(parsed.numero_nf, '2002');
    assert.strictEqual(parsed.serie_nf, '2');
    assert.strictEqual(parsed.data_emissao, '2026-07-01');
    assert.strictEqual(parsed.data_entrada, '');
    assert.strictEqual(parsed.fornecedor, 'Atacado Beta ME');
    assert.strictEqual(parsed.valor_total_nota, 450);
    assert.strictEqual(parsed.itens.length, 1);
    assert.strictEqual(parsed.itens[0].produto_nome, 'Arroz Tipo 1 5kg');
    // CORREÇÃO-NF-MARGEM-01 — parser não fabrica margem/venda comercial
    assert.strictEqual(parsed.itens[0].margem_lucro, null);
    assert.strictEqual(parsed.itens[0].preco_venda_sugerido, null);
  });

  await test('XML inválido retorna erro de parse', async () => {
    let erro;
    try {
      await NFeParserService.parse('<nfeProc><NFe></nfeProc>');
    } catch (error) {
      erro = error;
    }

    assert.ok(erro instanceof NFeParserError);
    assert.match(erro.message, /Erro ao parsear XML/);
  });

  await test('XML sem NF-e retorna mensagem legada', async () => {
    let erro;
    try {
      await NFeParserService.parse('<root><foo>bar</foo></root>');
    } catch (error) {
      erro = error;
    }

    assert.ok(erro instanceof NFeParserError);
    assert.strictEqual(erro.message, 'XML não contém uma NF-e válida.');
    assert.strictEqual(erro.code, 'NFE_INVALIDA');
  });

  await test('NFeParser.extrairInfNFe suporta ambos formatos', async () => {
    const xmlProc = await NFeParserService.parse(lerFixture('nfe-proc-sample.xml'));
    const xmlDireta = await NFeParserService.parse(lerFixture('nfe-direta-sample.xml'));

    assert.ok(xmlProc.chave_acesso);
    assert.ok(xmlDireta.chave_acesso);
    assert.notStrictEqual(xmlProc.chave_acesso, xmlDireta.chave_acesso);
  });

  await test('saída não inclui miip_importacao (responsabilidade do chamador)', async () => {
    const parsed = await NFeParserService.parse(lerFixture('nfe-proc-sample.xml'));
    assert.strictEqual(parsed.miip_importacao, undefined);
    parsed.itens.forEach((item) => {
      assert.strictEqual(item.miip_resultado, undefined);
      assert.strictEqual(item.miip_sugestao, undefined);
      assert.strictEqual(item.produto_id, undefined);
    });
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Erro fatal nos testes:', error);
  process.exit(1);
});
