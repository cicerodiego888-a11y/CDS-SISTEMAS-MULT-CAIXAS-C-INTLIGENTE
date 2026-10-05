'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const {
  produtoElegivelVendaSemEstoque,
  vendaSemEstoquePermitida,
  deveBloquearExcedentePorCategoria
} = require('../../backend/services/estoque/vendaSemEstoqueElegibilidade');

describe('Venda sem estoque — elegibilidade por categoria', () => {
  it('reconhece Açougue e Hortifruti normalizando acentos e variações cadastradas', () => {
    for (const categoria of ['Açougue', 'ACOUGUE', 'Açougue Principal', 'Hortifruti', 'Horti fruti']) {
      assert.equal(produtoElegivelVendaSemEstoque({ categoria_nome: categoria }), true, categoria);
    }
    assert.equal(produtoElegivelVendaSemEstoque({ categoria_nome: '', categoria: 'Hortifruti' }), true);
  });

  it('flag ON não autoriza Mercearia, Bebidas, Limpeza ou categoria ausente', () => {
    for (const categoria of ['Mercearia', 'Bebidas', 'Limpeza', '']) {
      const produto = { categoria_nome: categoria, controla_estoque: 1 };
      assert.equal(vendaSemEstoquePermitida(produto, true), false, categoria || 'sem categoria');
      assert.equal(deveBloquearExcedentePorCategoria(produto, 1, 0, true), true, categoria || 'sem categoria');
    }
  });

  it('flag ON autoriza somente o excedente de Açougue/Hortifruti e flag OFF nunca autoriza', () => {
    for (const categoria of ['Açougue', 'Hortifruti']) {
      const produto = { categoria_nome: categoria, controla_estoque: 1 };
      assert.equal(vendaSemEstoquePermitida(produto, true), true, categoria);
      assert.equal(deveBloquearExcedentePorCategoria(produto, 2, 1, true), false, categoria);
      assert.equal(vendaSemEstoquePermitida(produto, false), false, categoria);
    }
  });

  it('não aplica a exceção a produto sem controle de estoque ou a saldo suficiente', () => {
    assert.equal(deveBloquearExcedentePorCategoria({ categoria_nome: 'Mercearia', controla_estoque: 0 }, 1, 0, true), false);
    assert.equal(deveBloquearExcedentePorCategoria({ categoria_nome: 'Mercearia', controla_estoque: 1 }, 1, 1, true), false);
  });

  it('os pontos de venda carregam categoria e aplicam o bloqueio antes do distribuidor', () => {
    const pagamento = fs.readFileSync(path.join(ROOT, 'backend/services/vendas/VendaPagamentoService.js'), 'utf8');
    const entrega = fs.readFileSync(path.join(ROOT, 'backend/services/entrega/CriarVendaEntregaService.js'), 'utf8');
    const comercial = fs.readFileSync(path.join(ROOT, 'backend/motores/comercial/MotorComercialService.js'), 'utf8');
    assert.match(pagamento, /categoria_nome[\s\S]*?deveBloquearExcedentePorCategoria/);
    assert.match(entrega, /categoria_nome[\s\S]*?deveBloquearExcedentePorCategoria/);
    assert.match(comercial, /deveBloquearExcedentePorCategoria/);
  });

  it('a confirmação de ativação explica as categorias elegíveis e o bloqueio das demais', () => {
    const centro = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/cds-centro-configuracoes.js'), 'utf8');
    assert.match(centro, /Saldo insuficiente será permitido somente para produtos que controlam estoque das categorias Açougue e Hortifruti/);
    assert.match(centro, /Nas demais categorias, a venda continuará bloqueada/);
    assert.doesNotMatch(centro, /A empresa permitirá venda com saldo insuficiente/);
  });
});