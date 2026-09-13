/**
 * V1.0.15 — GTIN/EAN → codigo_barras (alias gtin_ean).
 * Executar: node --test tests/produtos/importacao-inicial-gtin-ean-v1015.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  mapearLinhaProduto,
  chaveHeader,
  texto
} = require('../../backend/services/importacao-inicial-produtos/helpers');
const { extrairDadosImportacao } = require('../../backend/services/importacao-inicial-produtos/xlsxReader');

describe('V1.0.15 — GTIN/EAN → codigo_barras', () => {
  it('header GTIN/EAN normaliza para gtin_ean', () => {
    assert.equal(chaveHeader('GTIN/EAN'), 'gtin_ean');
  });

  it('GTIN/EAN 7891799529031 preenche codigo_barras', () => {
    const p = mapearLinhaProduto({
      'Código origem': '5986113300',
      'GTIN/EAN': '7891799529031',
      'Nome CDS': 'DESENGRIPANTE SPRAY W-MAX 300ML',
      'Custo unitário': 11.59,
      'Preço venda unitário': 23.18,
      'Markup %': 100
    });
    assert.equal(p.codigo_origem, '5986113300');
    assert.equal(p.codigo_barras, '7891799529031');
    assert.equal(typeof p.codigo_barras, 'string');
  });

  it('aliases existentes continuam funcionando', () => {
    const casos = [
      ['codigo_barras', '111'],
      ['ean', '222'],
      ['gtin', '333'],
      ['barras', '444'],
      ['gtin_ean', '555']
    ];
    for (const [header, valor] of casos) {
      const row = {
        'Código origem': '9',
        'Nome CDS': 'TESTE',
        'Custo unitário': 1,
        'Preço venda unitário': 2
      };
      row[header] = valor;
      const p = mapearLinhaProduto(row);
      assert.equal(p.codigo_barras, valor, `falhou alias ${header}`);
    }
  });

  it('preserva zero à esquerda no GTIN/EAN', () => {
    const p = mapearLinhaProduto({
      'Código origem': '1',
      'GTIN/EAN': '0637701012',
      'Nome CDS': 'BROCA',
      'Custo unitário': 1,
      'Preço venda unitário': 2
    });
    assert.equal(p.codigo_barras, '0637701012');
    assert.notEqual(p.codigo_barras, '637701012');
  });

  it('GTIN/EAN vazio não inventa codigo_barras', () => {
    const p = mapearLinhaProduto({
      'Código origem': '1',
      'GTIN/EAN': '',
      'Nome CDS': 'SEM BARRAS',
      'Custo unitário': 1,
      'Preço venda unitário': 2
    });
    assert.equal(texto(p.codigo_barras), '');
  });

  it('arquivo real 5986113300 — DESENGRIPANTE com 7891799529031', () => {
    const xlsxPath = path.join(
      process.env.USERPROFILE || '',
      'Downloads',
      'CDS_CADASTRAR_2_IMPORTACAO_COM_CODIGOS_BARRAS.xlsx'
    );
    if (!fs.existsSync(xlsxPath)) return;

    const dados = extrairDadosImportacao(fs.readFileSync(xlsxPath));
    const prod = dados.produtos.find((p) => String(p.codigo_origem) === '5986113300');
    assert.ok(prod, 'produto 5986113300 não encontrado no XLSX');
    assert.match(prod.nome, /DESENGRIPANTE/i);
    assert.equal(prod.codigo_barras, '7891799529031');
  });
});
