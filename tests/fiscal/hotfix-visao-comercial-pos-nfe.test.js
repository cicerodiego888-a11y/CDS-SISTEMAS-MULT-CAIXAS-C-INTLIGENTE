/**
 * Hotfix — visão comercial da Venda após autorização da NF-e.
 * Não altera Motor nem geração da NF-e.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');

describe('Hotfix visão comercial pós NF-e', () => {
  it('histórico sempre comercial: todos itens + total original', () => {
    const src = fs.readFileSync(path.join(root, 'frontend/shared/js/vendasHistoricoUi.js'), 'utf8');
    const sandbox = { window: {}, console };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);

    const vendaMista = {
      id: 1,
      total: 100,
      valor_fiscal: 50,
      valor_nao_fiscal: 50,
      nfe_numero: 99,
      nfe_chave: '23'.padEnd(44, '0'),
      nfe_status: 'autorizada',
      itens: [
        {
          produto_nome: 'A',
          quantidade: 10,
          subtotal: 100,
          quantidade_fiscal: 5,
          valor_fiscal: 50,
          quantidade_nao_fiscal: 5,
          valor_nao_fiscal: 50
        }
      ]
    };

    const itens = sandbox.window.filtrarItensHistoricoVenda(vendaMista);
    assert.equal(itens.length, 1);
    assert.equal(itens[0].quantidade, 10);
    assert.equal(sandbox.window.obterTotalExibicaoHistoricoVenda(vendaMista), 100);
    assert.equal(sandbox.window.historicoVendaModoFiscalAtivo(), false);
    assert.equal(sandbox.window.vendaHistoricoTemNfe(vendaMista), true);
    assert.match(sandbox.window.montarHtmlNfeVinculadaHistorico(vendaMista), /NF-e vinculada/);
    assert.match(sandbox.window.montarHtmlNfeVinculadaHistorico(vendaMista), /operação comercial completa/);
  });

  it('API anexa NF-e sem filtrar itens; ERP/PDV usam total comercial', () => {
    const rotas = fs.readFileSync(path.join(root, 'backend/rotas/vendas.js'), 'utf8');
    const erp = fs.readFileSync(path.join(root, 'frontend/erp/js/vendas.js'), 'utf8');
    const pdv = fs.readFileSync(path.join(root, 'frontend/pdv/js/vendas.js'), 'utf8');
    const motor = fs.readFileSync(path.join(root, 'backend/services/distribuidorEstoqueVenda.js'), 'utf8');
    const nfeXml = fs.readFileSync(path.join(root, 'backend/services/fiscal/xmlBuilderNfeVenda.js'), 'utf8');

    assert.match(rotas, /nfe_notas nfe/);
    assert.match(rotas, /nfe_chave/);
    assert.match(rotas, /todos os itens originais/);
    assert.doesNotMatch(erp, /modo=fiscal/);
    assert.doesNotMatch(pdv, /modo=fiscal/);
    assert.match(erp, /formatCurrency\(v\.total\)/);
    assert.match(pdv, /formatCurrency\(v\.total\)/);
    assert.match(erp, /montarHtmlNfeVinculadaHistorico|DANFE NF-e/);
    assert.match(pdv, /montarHtmlNfeVinculadaHistorico|DANFE NF-e/);
    // Proibido alterar Motor / builder NF-e nesta sprint
    assert.match(motor, /function distribuirItemVenda/);
    assert.match(nfeXml, /itemEntraNaNfe/);
  });

  it('NF-e continua fiscal-only; Venda não é substituída', () => {
    const ui = fs.readFileSync(path.join(root, 'frontend/shared/js/vendasHistoricoUi.js'), 'utf8');
    assert.match(ui, /nunca substituem a Venda|não altera itens\/totais/i);
    assert.doesNotMatch(ui, /return itens\.filter\(itemPossuiParteFiscalHistorico\)/);
  });
});
