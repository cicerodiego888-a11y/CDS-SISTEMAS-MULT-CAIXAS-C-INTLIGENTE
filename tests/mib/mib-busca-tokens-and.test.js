'use strict';

/**
 * Busca por nome completo não pode trazer a lista inteira
 * só porque o termo tem "1", "TC" ou "SP".
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SearchAI = require('../../backend/motores/mib/ai/SearchAI');
const { tokenizar } = require('../../backend/motores/mib/core/tokenizer');
const { normalizarNomeBusca } = require('../../backend/motores/mib/core/normalizarNomeBusca');

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log('OK', nome))
    .catch((err) => {
      console.error('FAIL', nome);
      throw err;
    });
}

function item(id, nome, extra = {}) {
  return {
    id,
    nome,
    nome_busca: extra.nome_busca || normalizarNomeBusca(nome),
    codigo: extra.codigo != null ? String(extra.codigo) : String(id),
    codigo_barras: extra.codigo_barras != null ? String(extra.codigo_barras) : '',
    plu: extra.plu != null ? String(extra.plu) : '',
    item_fiscal: 1,
    preco: 10
  };
}

function criarAi(lista, sinonimos) {
  return new SearchAI({
    sinonimos: sinonimos || { expandir: (tokens) => [...(tokens || [])] },
    learning: { topSearches: () => [] },
    catalog: { ativo: () => ({ lista }) },
    config: { get: () => true }
  });
}

async function main() {
  const catalogo = [
    item(1, 'INTERRUPTOR 1 TC SP + 1 TOM DUNAS'),
    item(2, 'ANTIRRESPINGO DE SOLDA C/ SILICONE 400ML'),
    item(3, 'ARAME RECOZIDO TRANCADO BWG 18 PT'),
    item(4, 'INTER 1 TC PR CANOA'),
    item(5, 'INTER 1 TC SP + 1 TOM CANOA'),
    item(6, 'INTER 1 TC SP CANOA'),
    item(7, 'INTER 2 TC SP CANOA'),
    item(8, 'TORN 1194 LAV BAN ABS PACIFIC BC'),
    item(9, 'COCA COLA 2L'),
    item(10, 'PAPEL HIGIENICO FOLHA DUPLA')
  ];

  await test('tokens significativos ignoram 1/tc/sp', () => {
    const tok = tokenizar('INTERRUPTOR 1 TC SP + 1 TOM DUNAS');
    const { fortes, exigidos } = SearchAI.tokensSignificativos(tok.tokensNorm);
    assert.ok(fortes.includes('interruptor'));
    assert.ok(fortes.includes('dunas'));
    assert.ok(!exigidos.includes('1'));
    assert.ok(!exigidos.includes('tc'));
    assert.ok(!exigidos.includes('sp'));
  });

  await test('busca do nome completo não traz antirrespingo/arame/torn', () => {
    const ai = criarAi(catalogo);
    const tok = tokenizar('INTERRUPTOR 1 TC SP + 1 TOM DUNAS');
    const hits = ai.buscarPorTokens(tok.tokensNorm, { tokensOriginais: tok.tokensNorm, limite: 50 });
    const nomes = hits.map((p) => p.nome);
    assert.ok(nomes.some((n) => /DUNAS/i.test(n)), `esperado DUNAS, veio: ${nomes.join(' | ')}`);
    assert.ok(!nomes.some((n) => /ANTIRRESPINGO/i.test(n)));
    assert.ok(!nomes.some((n) => /ARAME/i.test(n)));
    assert.ok(!nomes.some((n) => /TORN/i.test(n)));
    assert.ok(!nomes.some((n) => /CANOA/i.test(n)));
    assert.strictEqual(hits.length, 1);
  });

  await test('INTER casa INTERRUPTOR via prefixo da palavra', () => {
    const ai = criarAi(catalogo);
    const tok = tokenizar('INTER TOM DUNAS');
    const hits = ai.buscarPorTokens(tok.tokensNorm, { tokensOriginais: tok.tokensNorm, limite: 50 });
    assert.ok(hits.some((p) => /DUNAS/i.test(p.nome)));
    assert.ok(!hits.some((p) => /CANOA/i.test(p.nome)));
  });

  await test('coca 2l continua restrito ao refrigerante', () => {
    const ai = criarAi(catalogo);
    const tok = tokenizar('coca 2l');
    const hits = ai.buscarPorTokens(tok.tokensNorm, { tokensOriginais: tok.tokensNorm, limite: 20 });
    assert.ok(hits.some((p) => /COCA/i.test(p.nome)));
    assert.ok(!hits.some((p) => /INTERRUPTOR|INTER |ARAME|TORN/i.test(p.nome)));
  });

  await test('sinônimo curto ph ainda encontra papel higienico', () => {
    const ai = criarAi(catalogo, {
      expandir: (tokens) => {
        const out = new Set(tokens || []);
        for (const t of tokens || []) {
          if (t === 'ph') out.add('papelhigienico');
        }
        return [...out];
      }
    });
    const hits = ai.buscarPorTokens(['ph', 'papelhigienico'], {
      tokensOriginais: ['ph'],
      limite: 20
    });
    assert.ok(hits.some((p) => /PAPEL HIGIENICO/i.test(p.nome)));
  });

  await test('EAN não casa prefixo 789 no nome — só código de barras', () => {
    const ean = '7891234567890';
    const lista = [
      item(1, '789 MARCA GENERICA', { codigo: '10' }),
      item(2, 'INTERRUPTOR DUNAS', { codigo: '20', codigo_barras: ean })
    ];
    const ai = criarAi(lista);
    const hits = ai.buscarPorTokens([ean], { tokensOriginais: [ean], limite: 20 });
    assert.strictEqual(hits.length, 1, `veio: ${hits.map((p) => p.nome).join(' | ')}`);
    assert.strictEqual(hits[0].codigo_barras, ean);
  });

  await test('código interno curto continua encontrando pelo codigo', () => {
    const lista = [
      item(1, 'ARROZ TIO JOAO', { codigo: '10', codigo_barras: '7891000100101' }),
      item(2, 'FEIJAO', { codigo: '20', codigo_barras: '7891000100202' })
    ];
    const ai = criarAi(lista);
    const hits = ai.buscarPorTokens(['10'], { tokensOriginais: ['10'], limite: 20 });
    assert.ok(hits.some((p) => String(p.codigo) === '10'));
    assert.ok(!hits.some((p) => String(p.codigo) === '20'));
  });

  await test('nome completo FITA 02M encontra cadastro gravado como 2M', () => {
    const lista = [
      item(1, 'FITA ISOLANTE 19MM X 2M PT AUTO FUSAO SCOTCH'),
      item(2, 'ANTIRRESPINGO DE SOLDA C/ SILICONE 400ML'),
      item(3, 'FITA CREPE 18MM X 50M')
    ];
    const ai = criarAi(lista);
    const consulta = 'FITA ISOLANTE 19MM X 02M PT AUTO FUSÃO SCOTCH';
    const tok = tokenizar(consulta);
    const hits = ai.buscarPorTokens(tok.tokensNorm, { tokensOriginais: tok.tokensNorm, limite: 20 });
    assert.ok(hits.some((p) => /SCOTCH/i.test(p.nome)), `veio: ${hits.map((p) => p.nome).join(' | ')}`);
    assert.ok(!hits.some((p) => /ANTIRRESPINGO|CREPE/i.test(p.nome)));

    const CatalogSnapshot = require('../../backend/motores/mib/catalog/CatalogSnapshot');
    const snap = new CatalogSnapshot(lista.map((p) => ({
      ...p,
      nome_busca: p.nome_busca || normalizarNomeBusca(p.nome)
    })));
    const frase = normalizarNomeBusca(consulta);
    const cat = snap.filtrar(frase, { limite: 20 });
    assert.ok(cat.some((p) => /SCOTCH/i.test(p.nome)), 'catálogo deve achar a fita pelo nome compacto');
  });

  await test('cadastro não extrai dígitos de busca textual', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');
    assert.ok(src.includes('tokensBuscaSignificativos'));
    assert.ok(src.includes('consultaBuscaSoDigitos'));
    assert.ok(src.includes('idsNumericosBuscaIguais'));
    assert.ok(src.includes('consultaBuscaSoDigitos(termo)'));
    assert.ok(src.includes('fallbackLocal: true'));
    assert.ok(!/termoDigits = termoBruto\.replace\(\/\\D\/g, ''\)/.test(src));
  });

  await test('SearchEngine prioriza identificador quando o termo é só dígitos', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../backend/motores/mib/SearchEngine.js'), 'utf8');
    assert.ok(src.includes('soDigitos'));
    assert.ok(/!soDigitos && interpretado\.tokensExpandidos/.test(src));
  });

  await test('incremental vazio não encerra a busca do nome completo', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../backend/motores/mib/SearchEngine.js'), 'utf8');
    assert.ok(!src.includes('filtrados.length > 0 || prev.itens.length < limite'));
    assert.ok(src.includes('if (filtrados.length > 0)'));
    assert.ok(src.includes('ranqueados.length > 0'));
  });

  await test('nome_busca desatualizado ainda casa pelo nome atual', () => {
    const lista = [
      item(1, 'FITA ISOLANTE 19MM X 2M PT AUTO FUSAO SCOTCH', {
        nome_busca: 'fitavelha19mm'
      })
    ];
    const ai = criarAi(lista);
    const consulta = 'FITA ISOLANTE 19MM X 02M PT AUTO FUSÃO SCOTCH';
    const tok = tokenizar(consulta);
    const hits = ai.buscarPorTokens(tok.tokensNorm, { tokensOriginais: tok.tokensNorm, limite: 20 });
    assert.ok(hits.some((p) => /SCOTCH/i.test(p.nome)), `veio: ${hits.map((p) => p.nome).join(' | ')}`);
  });

  await test('frontend encontra 02M/FUSÃO no cadastro gravado como 2M/FUSAO', () => {
    require('../../frontend/shared/js/buscaProdutoTexto.js');
    const Texto = globalThis.CdsBuscaProdutoTexto;
    assert.ok(Texto);
    const produto = item(1, 'FITA ISOLANTE 19MM X 2M PT AUTO FUSAO SCOTCH');
    assert.ok(Texto.produtoCorrespondeBuscaNome(
      produto,
      'FITA ISOLANTE 19MM X 02M PT AUTO FUSÃO SCOTCH'
    ));
    assert.ok(!Texto.produtoCorrespondeBuscaNome(produto, 'ANTIRRESPINGO DE SOLDA'));
  });

  console.log('\nMIB busca tokens AND OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
