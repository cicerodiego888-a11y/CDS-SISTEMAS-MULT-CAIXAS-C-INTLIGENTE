'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const IdentidadeResultadoDTO = require('../../backend/motores/produto-identidade/contracts/IdentidadeResultadoDTO');
const PdvProdutoIdentificacaoService = require('../../backend/motores/produto-identidade/services/PdvProdutoIdentificacaoService');

describe('F12 ON — MIP mantém produtos B pesquisáveis para venda', () => {
  it('produto item_fiscal=0 continua encontrado quando modoFiscal', async () => {
    const service = new PdvProdutoIdentificacaoService({
      identidadeService: {
        resolve: async () => IdentidadeResultadoDTO.encontrado({
          produtoId: 9,
          produto: { id: 9, nome: 'Hortifruti B', item_fiscal: 0 },
          metodo: 'codigo_barras',
          strategy: 'EAN'
        })
      }
    });

    const payload = await service.identificar('789', { origem: 'pdv', modoFiscal: true });
    assert.equal(payload.encontrado, true);
    assert.equal(payload.produto.item_fiscal, 0);
  });

  it('F12 OFF continua devolvendo produto B', async () => {
    const service = new PdvProdutoIdentificacaoService({
      identidadeService: {
        resolve: async () => IdentidadeResultadoDTO.encontrado({
          produtoId: 9,
          produto: { id: 9, nome: 'Hortifruti B', item_fiscal: 0 },
          metodo: 'codigo_barras',
          strategy: 'EAN'
        })
      }
    });

    const payload = await service.identificar('789', { origem: 'pdv', modoFiscal: false });
    assert.equal(payload.encontrado, true);
    assert.equal(payload.produto.item_fiscal, 0);
  });

  it('o serviço de identificação não contém bloqueio por natureza no modo fiscal', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(
      path.join(__dirname, '../../backend/motores/produto-identidade/services/PdvProdutoIdentificacaoService.js'),
      'utf8'
    );
    assert.doesNotMatch(source, /f12_somente_item_fiscal|_contextoModoFiscal/);
  });
});
