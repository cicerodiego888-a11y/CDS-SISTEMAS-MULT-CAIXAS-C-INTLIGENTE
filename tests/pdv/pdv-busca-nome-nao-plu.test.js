'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DetectorTipoCodigo = require('../../backend/motores/produto-identidade/core/DetectorTipoCodigo');
const PluStrategy = require('../../backend/motores/produto-identidade/strategies/PluStrategy');
const InternoStrategy = require('../../backend/motores/produto-identidade/strategies/InternoStrategy');
const ProdutoIdentidadeService = require('../../backend/motores/produto-identidade/services/ProdutoIdentidadeService');

const NOME_ARROZ = 'Arroz Branco Tipo 1 Pop 1 kg';

describe('MIP — nome de produto não vira PLU/código concatenando dígitos', () => {
  it('Detector junta "1"+"1" em digitos, mas não classifica como PLU', () => {
    const det = new DetectorTipoCodigo().detectar(NOME_ARROZ);
    assert.equal(det.digitos, '11');
    assert.equal(det.candidatos.includes('PLU'), false);
    assert.equal(det.candidatos.includes('ID'), false);
    assert.equal(det.candidatos.includes('INTERNO'), false);
  });

  it('PluStrategy recusa nome com dígitos misturados no texto', () => {
    const det = new DetectorTipoCodigo().detectar(NOME_ARROZ);
    const plu = new PluStrategy({
      catalogo: {
        resolverPorIdentificador: async () => ({
          produto: { id: 11, nome: 'Patinho Bovino', codigo: '11' }
        })
      }
    });
    assert.equal(plu.canHandle(NOME_ARROZ, {}, det), false);
  });

  it('InternoStrategy recusa termo com espaços', () => {
    const interno = new InternoStrategy({ catalogo: {} });
    const det = new DetectorTipoCodigo().detectar(NOME_ARROZ);
    assert.equal(interno.canHandle(NOME_ARROZ, {}, det), false);
  });

  it('PLU numérico curto continua válido', () => {
    const det = new DetectorTipoCodigo().detectar('11');
    assert.ok(det.candidatos.includes('PLU'));
    const plu = new PluStrategy({ catalogo: {} });
    assert.equal(plu.canHandle('11', {}, det), true);
  });

  it('resolve(nome) não devolve produto 11 mesmo se PLU 11 existir no catálogo', async () => {
    const catalogo = {
      resolverPorIdentificador: async (tipo, codigo) => {
        if (String(tipo).toUpperCase() === 'PLU' && String(codigo) === '11') {
          return { produto: { id: 11, nome: 'Patinho Bovino', codigo: '11' } };
        }
        return null;
      },
      buscarProdutoPorId: async (id) => (Number(id) === 11
        ? { id: 11, nome: 'Patinho Bovino', codigo: '11' }
        : null),
      buscarProdutoPorCodigoInterno: async () => null,
      buscarProdutoPorCodigoBarras: async () => null
    };
    const mip = new ProdutoIdentidadeService({
      catalogo,
      isEnabled: () => true
    });
    const r = await mip.resolve(NOME_ARROZ, { origem: 'pdv' });
    assert.equal(r.encontrado, false);
    assert.notEqual(r.produtoId, 11);
  });
});

describe('PDV — busca por nome não dispara MIP como identificador', () => {
  it('termo com espaços não parece identificador; PLU numérico sim', () => {
    const busca = fs.readFileSync(
      path.join(__dirname, '../../frontend/shared/js/pdvBuscaProduto.js'),
      'utf8'
    );
    assert.match(busca, /function termoPareceIdentificadorPdv/);
    assert.match(busca, /if \(!termoPareceIdentificadorPdv\(termoDaBusca\)\)/);
    assert.match(busca, /if \(!ehTermoSomenteDigitos\(termo\) && !produtoCorrespondeAoTermo/);
    assert.doesNotMatch(
      busca,
      /then\(\(\) => \{\s*const mgv6 = parseMGV6DoTermo\(termoDaBusca\);/
    );
  });
});
