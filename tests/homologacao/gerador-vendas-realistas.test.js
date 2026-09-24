/**
 * Sprint — Gerador de vendas realistas (homologação NFC-e)
 * Executar: node --test tests/homologacao/gerador-vendas-realistas.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  ORIGEM_GERADOR,
  gerarVendaRealista,
  gerarLoteVendasRealistas,
  validarLoteVendasRealistas,
  formatarRelatorioHomologacao,
  sugerirAlvoCentavos
} = require('../../backend/services/homologacao/GeradorVendasRealistas');

const { toCentavos } = require('../../backend/services/fiscal/modeloTotais');
const { gerarPreviaDistribuicao } = require('../../backend/services/fechamento-fiscal/FechamentoFiscalDistribuicaoService');

const ROOT = path.join(__dirname, '../..');

describe('Gerador de vendas realistas — homologação NFC-e', () => {
  it('01 — 100 vendas: distribuição variada sem concentração artificial em ~250', () => {
    const lote = gerarLoteVendasRealistas({ quantidade: 100, seed: 20260923 });
    const check = validarLoteVendasRealistas(lote);
    assert.equal(check.ok, true, check.erros.join('; '));
    assert.ok(check.resumo.distintos >= 35);
    assert.ok(check.resumo.concentracao_250_aprox / 100 <= 0.2);
    assert.ok(check.resumo.com_centavos >= 10);
    assert.ok(check.resumo.redondos >= 1);
  });

  it('02 — totais derivados dos itens (soma = total)', () => {
    const lote = gerarLoteVendasRealistas({ quantidade: 50, seed: 7 });
    for (const v of lote.vendas) {
      assert.equal(toCentavos(v.soma_itens), toCentavos(v.total));
      assert.ok(v.total > 0);
      assert.ok(v.itens.length >= 1 && v.itens.length <= 6);
      assert.equal(v.origem, ORIGEM_GERADOR);
    }
  });

  it('03 — fiscal/não fiscal preservados a partir do produto', () => {
    const produtos = [
      { id: 1, nome: 'Fiscal A', preco_venda: 10.5, item_fiscal: 1 },
      { id: 2, nome: 'Não Fiscal B', preco_venda: 8.45, item_fiscal: 0 }
    ];
    const v = gerarVendaRealista({ produtos, seed: 99, indice: 1, minItens: 2, maxItens: 4 });
    for (const it of v.itens) {
      if (it.item_fiscal === 1) {
        assert.equal(it.quantidade_fiscal, it.quantidade);
        assert.equal(it.quantidade_nao_fiscal, 0);
        assert.equal(toCentavos(it.valor_fiscal), toCentavos(it.subtotal));
      } else {
        assert.equal(it.quantidade_nao_fiscal, it.quantidade);
        assert.equal(it.quantidade_fiscal, 0);
        assert.equal(toCentavos(it.valor_nao_fiscal), toCentavos(it.subtotal));
      }
    }
  });

  it('04 — não usa total = random isolado (código do gerador monta itens primeiro)', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/services/homologacao/GeradorVendasRealistas.js'),
      'utf8'
    );
    assert.match(src, /itens\.push/);
    assert.match(src, /totalCents/);
    assert.doesNotMatch(src, /total\s*=\s*random\s*\(\s*120/);
    assert.doesNotMatch(src, /Math\.random\(\)\s*\*\s*\(?\s*180/);
  });

  it('05 — relatório de homologação com ≥20 vendas', () => {
    const lote = gerarLoteVendasRealistas({ quantidade: 20, seed: 11 });
    const rel = formatarRelatorioHomologacao(lote);
    assert.match(rel, /Venda 01/);
    assert.match(rel, /Venda 20/);
    assert.match(rel, /GERADOR_VENDAS_REALISTAS/);
    // eslint-disable-next-line no-console
    console.log('\n' + rel + '\n');
    const check = validarLoteVendasRealistas(lote, { maxConcentracaoPct: 0.25, minDistintosPct: 0.25 });
    assert.equal(check.ok, true, check.erros.join('; '));
  });

  it('06 — alvos sugeridos para empacotamento são determinísticos e variados', () => {
    const a = [];
    const b = [];
    for (let i = 1; i <= 30; i += 1) {
      a.push(sugerirAlvoCentavos({ sequencia: i, seed: 0, valorMin: 8, valorMax: 500, valorAlvo: 250 }));
      b.push(sugerirAlvoCentavos({ sequencia: i, seed: 0, valorMin: 8, valorMax: 500, valorAlvo: 250 }));
    }
    assert.deepEqual(a, b);
    const distintos = new Set(a).size;
    assert.ok(distintos >= 10, `esperava variedade de alvos, got ${distintos}`);
    const perto250 = a.filter((c) => c >= 24900 && c <= 25100).length;
    assert.ok(perto250 / a.length <= 0.35);
  });

  it('07 — empacotamento do fechamento com distribuição realista (totais dos itens)', () => {
    const lotes = [];
    let id = 1;
    const precos = [8.45, 9.9, 10.5, 12.75, 13.8, 18.9, 22.4, 27.5, 5.49, 2.99];
    for (const preco of precos) {
      for (let q = 0; q < 40; q += 1) {
        lotes.push({
          produto_id: id,
          nome: `P${id}`,
          unidade: 'UN',
          venda_id: 1,
          venda_item_id: id * 100 + q,
          quantidade_disponivel: 1,
          unit_cents: toCentavos(preco),
          valor_disponivel: preco,
          fracionado: false
        });
      }
      id += 1;
    }
    const previa = gerarPreviaDistribuicao(lotes, 2500, {
      valorAlvo: 250,
      valorMin: 8,
      valorMax: 500,
      seedRealista: 42
    });
    assert.ok(previa.vendas.length >= 5);
    const vals = previa.vendas.map((v) => toCentavos(v.valor));
    const distintos = new Set(vals).size;
    assert.ok(distintos >= 3);
    const todos250 = vals.every((c) => c === 25000);
    assert.equal(todos250, false);
    for (const v of previa.vendas) {
      const soma = v.itens.reduce((s, it) => s + toCentavos(it.valor_total != null ? it.valor_total : it.valor), 0);
      assert.equal(soma, toCentavos(v.valor));
    }
    // determinístico
    const previa2 = gerarPreviaDistribuicao(lotes, 2500, {
      valorAlvo: 250, valorMin: 8, valorMax: 500, seedRealista: 42
    });
    assert.deepEqual(
      previa.vendas.map((v) => v.valor),
      previa2.vendas.map((v) => v.valor)
    );
  });

  it('08 — Motor Fiscal / TEF / numeração / Payment Core não alterados pelo gerador', () => {
    const gerador = fs.readFileSync(
      path.join(ROOT, 'backend/services/homologacao/GeradorVendasRealistas.js'),
      'utf8'
    );
    assert.doesNotMatch(gerador, /tefManager|Destaxa|PaymentCore|reservarProximaNumeracao|emissor\.js/i);
    assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/fiscal/emissor.js')));
  });
});
