/**
 * Identificação de PLU 0 / 00 / 0000 (zeros significativos).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizarPlu,
  variantesPlu,
  pluInformado
} = require('../../backend/motores/produto-identidade/utils/normalizarPlu');
const { parseEtiquetaComLayout } = require('../../backend/motores/equipamentos/layouts/ConfiguravelEtiquetaParser');
const { obterPreset } = require('../../backend/motores/equipamentos/layouts/presetsEtiqueta');
const EtiquetaBalancaStrategy = require('../../backend/motores/produto-identidade/strategies/EtiquetaBalancaStrategy');
const PluStrategy = require('../../backend/motores/produto-identidade/strategies/PluStrategy');

describe('PLU zeros — normalizar / variantes', () => {
  it('normalizarPlu mantém 0 para all-zero', () => {
    assert.equal(normalizarPlu('0'), '0');
    assert.equal(normalizarPlu('00'), '0');
    assert.equal(normalizarPlu('0000'), '0');
    assert.equal(normalizarPlu('000000'), '0');
    assert.equal(normalizarPlu('00067'), '67');
  });

  it('variantesPlu inclui 00 e 0000', () => {
    const v0 = variantesPlu('0');
    assert.ok(v0.includes('0'));
    assert.ok(v0.includes('00'));
    assert.ok(v0.includes('0000'));
    assert.ok(v0.includes('000000'));

    const v00 = variantesPlu('00');
    assert.ok(v00.includes('00'));
    assert.ok(v00.includes('0'));
    assert.ok(v00.includes('0000'));

    assert.ok(pluInformado('0'));
    assert.ok(pluInformado('00'));
    assert.ok(pluInformado('0000'));
    assert.ok(pluInformado(0));
    assert.equal(pluInformado(''), false);
    assert.equal(pluInformado(null), false);
  });
});

describe('PLU zeros — etiqueta parser', () => {
  it('extrai pluRaw 000000 e plu canônico 0', () => {
    // 2 + 000000 + 01050 + DV placeholder digit (layout 13)
    // Toledo 6+5: positions 1=2, 2-7=PLU, 8-12=valor, 13=DV
    const codigo = '2000000010509';
    const parsed = parseEtiquetaComLayout(codigo, obterPreset('toledo_prix4_uno_valor'));
    assert.ok(parsed);
    assert.equal(parsed.pluRaw, '000000');
    assert.equal(parsed.plu, '0');
    assert.equal(parsed.valorTotal, 10.5);
  });
});

describe('PLU zeros — strategies', () => {
  it('PluStrategy encontra produto cadastrado como 00 ao digitar 0 ou 0000', async () => {
    const produto = { id: 77, nome: 'Produto PLU 00', preco_venda: 10 };
    const calls = [];
    const catalogo = {
      async resolverPorIdentificador(tipo, codigo) {
        calls.push({ tipo, codigo });
        // simula catálogo real com variantes (ProdutoIdentidadeCatalogo)
        const { variantesPlu: v } = require('../../backend/motores/produto-identidade/utils/normalizarPlu');
        for (const c of v(codigo)) {
          if (c === '00') return { produto, identificador: { codigo: '00', tipo: 'PLU' } };
        }
        return null;
      }
    };
    const strategy = new PluStrategy({ catalogo });
    // Com catálogo que já expande variantes (como ProdutoIdentidadeCatalogo)
    const r1 = await strategy.resolve('0', {}, { digitos: '0' });
    assert.equal(r1?.produtoId, 77);

    const r2 = await strategy.resolve('0000', {}, { digitos: '0000' });
    assert.equal(r2?.produtoId, 77);
  });

  it('EtiquetaBalancaStrategy encontra PLU 0000 via pluRaw', async () => {
    const produto = { id: 88, nome: 'Etiqueta zero', preco_venda: 10.5 };
    const catalogo = {
      async resolverPorIdentificador(tipo, codigo) {
        if (tipo === 'PLU') {
          const { variantesPlu: v } = require('../../backend/motores/produto-identidade/utils/normalizarPlu');
          for (const c of v(codigo)) {
            if (c === '0000' || c === '00') {
              return { produto, identificador: { codigo: c, tipo: 'PLU' } };
            }
          }
        }
        return null;
      },
      async buscarProdutoPorCodigoInterno() { return null; }
    };

    const strategy = new EtiquetaBalancaStrategy({
      catalogo,
      resolverLayoutConfig: async () => obterPreset('toledo_prix4_uno_valor')
    });

    const codigo = '2000000010509';
    const r = await strategy.resolve(codigo, {}, { digitos: codigo });
    assert.equal(r?.produtoId, 88);
    assert.equal(r?.meta?.pluRaw, '000000');
  });
});
