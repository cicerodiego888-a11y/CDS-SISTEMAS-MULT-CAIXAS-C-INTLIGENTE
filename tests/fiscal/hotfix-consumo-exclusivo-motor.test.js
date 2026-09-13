/**
 * Hotfix arquitetural — consumidores exclusivos do Motor Fiscal × Não Fiscal.
 * NÃO altera o Motor (distribuidorEstoqueVenda).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildNfeXml, itemEntraNaNfe } = require('../../backend/services/fiscal/xmlBuilderNfeVenda');
const { gerarDanfeNfeHtml } = require('../../backend/services/fiscal/danfeNfe');
const { obterQuantidadeComercialFiscal, obterValorComercialFiscal } = require('../../backend/services/fiscal/unidadeFiscal');
const { distribuirPagamentos } = require('../../backend/services/DistribuidorPagamento');
const { separarItensDistribuidos } = require('../../backend/services/fiscalNaoFiscalService');

const cfgNfe = {
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
};

/** Cenário oficial: 10 unidades → Motor Fiscal=5 / Não Fiscal=5 */
function itemMistoMotor() {
  return {
    produto_id: 1,
    produto_nome: 'Produto Misto',
    quantidade: 10,
    preco_unitario: 10,
    subtotal: 100,
    quantidade_fiscal: 5,
    quantidade_nao_fiscal: 5,
    valor_fiscal: 50,
    valor_nao_fiscal: 50,
    produto_ncm: '10063021',
    cfop: '5102',
    unidade: 'UN'
  };
}

describe('Hotfix Motor — NF-e consome só parcela fiscal', () => {
  it('itemEntraNaNfe exige qtd/valor fiscais do Motor', () => {
    assert.equal(itemEntraNaNfe(itemMistoMotor()), true);
    assert.equal(itemEntraNaNfe({ quantidade: 10, subtotal: 100, quantidade_fiscal: 0, valor_fiscal: 0 }), false);
  });

  it('venda mista 10→5F+5NF: XML usa qCom=5 e vProd=50 (não 10/100)', () => {
    const built = buildNfeXml({
      config: cfgNfe,
      venda: {
        total: 100,
        valor_fiscal: 50,
        valor_nao_fiscal: 50,
        desconto: 0,
        cliente_nome: 'CLIENTE',
        cliente_cpf: '12345678909',
        forma_pagamento: 'dinheiro',
        pagamentos: [
          { forma_pagamento: 'dinheiro', valor: 50, tipo_recebimento: 'fiscal' },
          { forma_pagamento: 'dinheiro', valor: 50, tipo_recebimento: 'nao_fiscal' }
        ]
      },
      itens: [itemMistoMotor()],
      numero: 1,
      dadosNfe: { natureza_operacao: 'VENDA', cfop: '5102' }
    });

    assert.match(built.xmlSemAssinatura, /<qCom>5\.0000<\/qCom>/);
    assert.match(built.xmlSemAssinatura, /<vProd>50\.00<\/vProd>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /<qCom>10\.0000<\/qCom>/);
    assert.doesNotMatch(built.xmlSemAssinatura, /<vProd>100\.00<\/vProd>/);
    assert.equal(built.vNF, 50);
  });

  it('DANFE NF-e exibe quantidade/valor fiscais do Motor', async () => {
    const html = await gerarDanfeNfeHtml({
      venda: { valor_fiscal: 50, total: 100, cliente_nome: 'C', cliente_cpf: '12345678909' },
      itens: [itemMistoMotor()],
      empresa: { nome: 'E', cnpj: '65957340000150', ie: '1' },
      chave: '23'.padEnd(44, '0'),
      numero: 1,
      serie: 1,
      status: 'autorizada'
    });
    assert.match(html, />5</);
    assert.match(html, /50/);
  });
});

describe('Hotfix Motor — Pagamentos e agregação', () => {
  it('Distribuidor usa totais produzidos pelo Motor (5F+5NF em valor)', () => {
    const itens = [itemMistoMotor()];
    const { totalFiscal, totalNaoFiscal } = separarItensDistribuidos(itens);
    assert.equal(totalFiscal, 50);
    assert.equal(totalNaoFiscal, 50);

    const dist = distribuirPagamentos(
      [{ forma_pagamento: 'dinheiro', valor: 100 }],
      totalFiscal,
      totalNaoFiscal
    );
    const somaF = dist.recebimentosFiscal.reduce((s, r) => s + r.valor, 0);
    const somaNf = dist.recebimentosNaoFiscal.reduce((s, r) => s + r.valor, 0);
    assert.equal(somaF, 50);
    assert.equal(somaNf, 50);
    assert.equal(dist.saldoFiscal, 0);
    assert.equal(dist.saldoNaoFiscal, 0);
  });
});

describe('Hotfix Motor — helpers sem fallback comercial', () => {
  it('unidadeFiscal não usa quantidade/subtotal comerciais', () => {
    assert.equal(obterQuantidadeComercialFiscal({ quantidade: 10, quantidade_fiscal: 5 }), 5);
    assert.equal(obterValorComercialFiscal({ subtotal: 100, valor_fiscal: 50 }), 50);
    assert.equal(obterQuantidadeComercialFiscal({ quantidade: 10 }), 0);
    assert.equal(obterValorComercialFiscal({ subtotal: 100 }), 0);
  });
});

describe('Hotfix Motor — consumidores sem recálculo', () => {
  it('financeiro e NF-e não rateiam; Motor intocado', () => {
    const root = path.join(__dirname, '../..');
    const fin = fs.readFileSync(path.join(root, 'backend/rotas/financeiro.js'), 'utf8');
    const mon = fs.readFileSync(path.join(root, 'backend/monitoring/providers/FinanceiroProvider.js'), 'utf8');
    const nfe = fs.readFileSync(path.join(root, 'backend/services/fiscal/xmlBuilderNfeVenda.js'), 'utf8');
    const pag = fs.readFileSync(path.join(root, 'backend/services/vendas/VendaPagamentoService.js'), 'utf8');
    const motor = fs.readFileSync(path.join(root, 'backend/services/distribuidorEstoqueVenda.js'), 'utf8');

    assert.match(fin, /valoresMotorDaVenda/);
    assert.doesNotMatch(fin, /valor \* \(.*valorFiscal|valorFiscal\) \/ totalVenda/);
    assert.match(mon, /v\.valor_fiscal/);
    assert.doesNotMatch(mon, /valor_restante.*\*.*valor_fiscal.*\/ v\.total/);
    assert.match(nfe, /quantidade_fiscal/);
    assert.match(nfe, /itemEntraNaNfe/);
    assert.match(pag, /separarItensDistribuidos\(distribuicaoItens\)/);
    assert.match(pag, /valor_fiscal: totalFiscal/);
    // Motor permanece com assinatura oficial
    assert.match(motor, /function distribuirItemVenda/);
    assert.match(motor, /quantidadeFiscal/);
  });

  it('Estoque / NFC-e já consomem campos do Motor', () => {
    const root = path.join(__dirname, '../..');
    const pag = fs.readFileSync(path.join(root, 'backend/services/vendas/VendaPagamentoService.js'), 'utf8');
    const xml = fs.readFileSync(path.join(root, 'backend/services/fiscal/xmlBuilder.js'), 'utf8');
    assert.match(pag, /reduzirEstoqueDistribuido\([^)]*quantidade_fiscal/);
    assert.match(xml, /obterValorFiscalItem|quantidade_fiscal/);
  });
});
