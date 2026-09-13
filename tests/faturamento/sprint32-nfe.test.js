/**
 * Sprint 3.2 — NF-e modelo 55 (sidecar pós-Núcleo)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildNfeXml } = require('../../backend/services/fiscal/xmlBuilderNfeVenda');
const { gerarDanfeNfeHtml } = require('../../backend/services/fiscal/danfeNfe');
const { extrairDadosNfe, montarPayloadVendaDoPedido } = require('../../backend/services/faturamento/FaturamentoService');

describe('Sprint 3.2 — buildNfeXml modelo 55', () => {
  it('gera XML com mod 55 e sem infNFeSupl', () => {
    const built = buildNfeXml({
      config: {
        codigoUf: '23',
        cnpj: '65957340000150',
        ie: '073252638',
        crt: 1,
        ambiente: 2,
        serie: 1,
        nomeEmpresa: 'EMPRESA TESTE',
        logradouro: 'RUA A',
        numero: '1',
        bairro: 'CENTRO',
        codigo_municipio: '2307304',
        municipio_nome: 'JUAZEIRO DO NORTE',
        uf_sigla: 'CE',
        cep: '63000000'
      },
      venda: {
        total: 100,
        desconto: 0,
        cliente_nome: 'CLIENTE TESTE',
        cliente_cpf: '12345678909',
        forma_pagamento: 'dinheiro',
        pagamentos: [{ forma_pagamento: 'dinheiro', valor: 100 }]
      },
      itens: [{
        produto_id: 1,
        produto_nome: 'Produto A',
        quantidade: 2,
        preco_unitario: 50,
        subtotal: 100,
        quantidade_fiscal: 2,
        quantidade_nao_fiscal: 0,
        valor_fiscal: 100,
        valor_nao_fiscal: 0,
        produto_ncm: '10063021',
        cfop: '5102',
        csosn: '102',
        unidade: 'KG'
      }],
      numero: 1,
      dadosNfe: { natureza_operacao: 'VENDA DE MERCADORIA', cfop: '5102', frete: 0 }
    });

    assert.ok(built.chave && built.chave.length === 44);
    assert.match(built.xmlSemAssinatura, /<mod>55<\/mod>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /infNFeSupl/);
    assert.match(built.xmlSemAssinatura, /<natOp>VENDA DE MERCADORIA<\/natOp>/);
    assert.match(built.xmlSemAssinatura, /<finNFe>1<\/finNFe>/);
  });
});

describe('Sprint 3.2 — DANFE NF-e', () => {
  it('gera HTML imprimível', async () => {
    const html = await gerarDanfeNfeHtml({
      venda: { total: 100, cliente_nome: 'CLIENTE', cliente_cpf: '12345678909' },
      itens: [{
        produto_nome: 'Item',
        quantidade: 1,
        quantidade_fiscal: 1,
        preco_unitario: 100,
        subtotal: 100,
        valor_fiscal: 100
      }],
      empresa: { nome: 'EMPRESA', cnpj: '65957340000150', ie: '1' },
      chave: '23'.padEnd(44, '0'),
      numero: 10,
      serie: 1,
      protocolo: '123',
      status: 'autorizada',
      natureza: 'VENDA'
    });
    assert.match(html, /DANFE/);
    assert.match(html, /Documento Auxiliar da/);
    assert.match(html, /window\.print/);
  });
});

describe('Sprint 3.2 — Faturamento → Núcleo sem NFC-e', () => {
  it('payload mantém emitir_fiscal=false e origem FATURAMENTO', () => {
    const pedido = {
      id: 1,
      total: 50,
      desconto: 0,
      cliente_id: 2,
      itens: [{ produto_id: 1, quantidade: 1, preco_unitario: 50, subtotal: 50 }]
    };
    const payload = montarPayloadVendaDoPedido(pedido, {
      forma_pagamento: 'pix',
      pagamentos: [{ forma: 'pix', valor: 50 }],
      natureza_operacao: 'VENDA',
      cfop: '5102'
    });
    assert.equal(payload.origem, 'FATURAMENTO');
    assert.equal(payload.emitir_fiscal, false);
    assert.equal(payload.pagamentos[0].forma_pagamento, 'pix');
    assert.equal(payload.pagamentos[0].valor, 50);
  });

  it('extrai dados fiscais da tela', () => {
    const d = extrairDadosNfe({
      natureza_operacao: 'VENDA',
      cfop: '5101',
      frete: 10,
      transportadora: 'TRANS',
      volumes: 2,
      peso: 1.5,
      dados_adicionais: 'OBS'
    }, {});
    assert.equal(d.cfop, '5101');
    assert.equal(d.frete, 10);
    assert.equal(d.transportadora, 'TRANS');
  });
});

describe('Sprint 3.2 — artefatos e isolamento NFC-e', () => {
  it('emissor NFe é arquivo separado do emissor NFC-e', () => {
    const nfe = fs.readFileSync(path.resolve(__dirname, '../../backend/services/fiscal/nfeEmissorVenda.js'), 'utf8');
    const nfce = fs.readFileSync(path.resolve(__dirname, '../../backend/services/fiscal/emissor.js'), 'utf8');
    assert.match(nfe, /emitirNfePorVendaId/);
    assert.match(nfe, /buildNfeXml/);
    assert.match(nfe, /assinarNFe\([^,]+,\s*(?:cert\.privateKeyPem|privateKeyPem),\s*(?:cert\.certPem|certPem)\s*\)/);
    assert.match(nfe, /loteXml:\s*lote/);
    assert.doesNotMatch(nfe, /xmlLote:\s*lote/);
    assert.match(nfce, /buildNfceXml/);
    assert.doesNotMatch(nfce, /buildNfeXml/);
  });

  it('motores proibidos não foram o alvo (smoke)', () => {
    const files = [
      'backend/services/vendas/VendaPagamentoService.js',
      'backend/services/vendas/VendaApplicationService.js',
      'backend/services/OrquestradorPagamento.js',
      'backend/services/DistribuidorPagamento.js',
      'backend/services/distribuidorEstoqueVenda.js',
      'backend/services/fiscalNaoFiscalService.js'
    ];
    for (const rel of files) {
      assert.ok(fs.existsSync(path.resolve(__dirname, '../..', rel)), rel);
    }
  });

  it('rotas DANFE / nfe no faturamento', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../backend/rotas/faturamento.js'), 'utf8');
    assert.match(src, /\/vendas\/:vendaId\/danfe/);
    assert.match(src, /\/vendas\/:vendaId\/nfe/);
    assert.match(src, /emitirNfePorVendaId/);
  });
});
