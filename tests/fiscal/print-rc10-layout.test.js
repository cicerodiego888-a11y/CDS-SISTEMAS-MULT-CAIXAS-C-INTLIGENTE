/**
 * PRINT-RC1.0 — Layout profissional do Cupom Fiscal (DANFE NFC-e)
 * Executar: npm run test:print-layout
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  gerarDanfeHtml,
  resolverLarguraPapelMm,
  resolverNomeFantasia,
  resolverRazaoSocial,
  montarLinhasEndereco,
  formatarTelefone,
  obterQuantidadeImpressao,
  obterValorImpressao
} = require('../../backend/services/fiscal/danfe');

const empresaBase = {
  nomeFantasia: 'Mercadão do Cícero',
  razaoSocial: 'CDS SISTEMAS LTDA',
  nome: 'CDS SISTEMAS LTDA',
  cnpj: '65957340000150',
  telefone: '88999998888',
  logradouro: 'Rua Padre Cícero',
  numero: '120',
  bairro: 'Centro',
  municipio: 'Juazeiro do Norte',
  uf: 'CE',
  cep: '63010000',
  endereco: 'Rua Padre Cícero, 120, Centro, Juazeiro do Norte - CE'
};

const item = {
  produto_id: 10,
  produto_nome: 'Arroz Tipo 1',
  quantidade_fiscal: 2,
  quantidade_nao_fiscal: 0,
  valor_fiscal: 20,
  valor_nao_fiscal: 0,
  preco_unitario: 10
};

async function gerar(opcoes = {}) {
  return gerarDanfeHtml({
    venda: { total: 20, desconto: 0, pagamentos: [{ forma_pagamento: 'pix', valor: 20 }] },
    itens: [item],
    itensFiscal: [item],
    empresa: empresaBase,
    chave: '35260112345678000199550010000000011000000001',
    numero: 123,
    serie: 1,
    qrCodeUrl: '',
    tributos: { vICMS: 1, vPIS: 0.1, vCOFINS: 0.2 },
    nota: { tpAmb: 1, protocolo: '135260000000001' },
    ...opcoes
  });
}

describe('PRINT-RC1.0 — motor HTML (não ESC/POS)', () => {
  it('DANFE NFC-e é gerado em HTML', async () => {
    const html = await gerar();
    assert.match(html, /<!DOCTYPE html>/i);
    assert.match(html, /class="danfe/);
    assert.doesNotMatch(html, /\x1B@/); // sem ESC/POS
  });

  it('não altera helpers fiscais de quantidade/valor', () => {
    assert.equal(obterQuantidadeImpressao(item), 2);
    assert.equal(obterValorImpressao(item), 20);
  });
});

describe('PRINT-RC1.0 — cabeçalho profissional', () => {
  it('Nome Fantasia em destaque e Razão Social abaixo', async () => {
    const html = await gerar();
    assert.match(html, /class="fantasia"/);
    assert.match(html, /Mercadão do Cícero/i);
    assert.match(html, /class="razao"/);
    assert.match(html, /CDS SISTEMAS LTDA/);
    const iFantasia = html.indexOf('fantasia');
    const iRazao = html.indexOf('class="razao"');
    assert.ok(iFantasia < iRazao);
  });

  it('CNPJ centralizado formatado', async () => {
    const html = await gerar();
    assert.match(html, /CNPJ:\s*65\.957\.340\/0001-50/);
  });

  it('endereço quebrado em linhas', async () => {
    const linhas = montarLinhasEndereco(empresaBase);
    assert.ok(linhas.some((l) => /Padre Cícero/.test(l)));
    assert.ok(linhas.some((l) => /Centro/.test(l)));
    assert.ok(linhas.some((l) => /Juazeiro do Norte - CE/.test(l)));
    assert.ok(linhas.some((l) => /CEP 63010-000/.test(l)));
    const html = await gerar();
    assert.match(html, /Padre Cícero/);
    assert.match(html, /Centro/);
  });

  it('telefone somente quando informado', async () => {
    assert.equal(formatarTelefone('88999998888'), '(88) 99999-8888');
    const comTel = await gerar();
    assert.match(comTel, /\(88\) 99999-8888/);
    const semTel = await gerar({
      empresa: { ...empresaBase, telefone: '' }
    });
    assert.doesNotMatch(semTel, /\(88\)/);
  });

  it('ícones SVG monocromáticos no HTML', async () => {
    const html = await gerar();
    assert.match(html, /<svg class="ico/);
  });
});

describe('PRINT-RC1.0 — largura 58/80 mm', () => {
  it('padrão 80mm', () => {
    assert.equal(resolverLarguraPapelMm({}), 80);
  });

  it('aceita 58mm', async () => {
    assert.equal(resolverLarguraPapelMm({ larguraMm: 58 }), 58);
    const html = await gerar({ empresa: { ...empresaBase, larguraMm: 58 } });
    assert.match(html, /danfe-58/);
    assert.match(html, /--danfe-width:\s*58mm/);
  });

  it('80mm no HTML', async () => {
    const html = await gerar({ empresa: { ...empresaBase, larguraMm: 80 } });
    assert.match(html, /danfe-80/);
  });
});

describe('PRINT-RC1.0 — produtos, totais, QR, rodapé', () => {
  it('colunas de produtos alinhadas', async () => {
    const html = await gerar();
    assert.match(html, /<th class="col-cod">Cód<\/th>/);
    assert.match(html, /Descrição/);
    assert.match(html, /Vl\.Unit/);
    assert.match(html, /Arroz Tipo 1/);
  });

  it('TOTAL em destaque', async () => {
    const html = await gerar();
    assert.match(html, /class="total-box"/);
    assert.match(html, />TOTAL</);
    assert.match(html, /R\$ 20,00/);
  });

  it('formas de pagamento organizadas', async () => {
    const html = await gerar({
      venda: {
        total: 20,
        desconto: 0,
        pagamentos: [
          { forma_pagamento: 'pix', valor: 10 },
          { forma_pagamento: 'dinheiro', valor: 10 }
        ]
      }
    });
    assert.match(html, /PIX/);
    assert.match(html, /Dinheiro/);
  });

  it('QR centralizado quando URL presente', async () => {
    const html = await gerar({
      qrCodeUrl: 'https://www.sefaz.ce.gov.br/nfce/consulta?p=1'
    });
    assert.match(html, /class="qr"/);
    assert.match(html, /Consulte via QR Code/);
  });

  it('rodapé com chave, protocolo e agradecimento', async () => {
    const html = await gerar();
    assert.match(html, /35260112345678000199550010000000011000000001/);
    assert.match(html, /Protocolo:\s*135260000000001/);
    assert.match(html, /Obrigado pela preferência/);
  });

  it('separadores discretos (sem ======)', async () => {
    const html = await gerar();
    assert.doesNotMatch(html, /={5,}/);
    assert.match(html, /class="sep"/);
  });
});

describe('PRINT-RC1.0 — sem alteração fiscal', () => {
  it('emissor não muda montagem de XML nesta sprint', () => {
    const emissor = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fiscal/emissor.js'),
      'utf8'
    );
    assert.match(emissor, /montarXml|xmlBase|assin/);
    assert.match(emissor, /nomeFantasia/);
  });

  it('resolvers de fantasia/razão', () => {
    assert.equal(resolverNomeFantasia({ nomeFantasia: 'A', nome: 'B' }), 'A');
    assert.equal(resolverRazaoSocial({ razaoSocial: 'R', nome: 'B' }), 'R');
    assert.equal(resolverNomeFantasia({ nome: 'Só Nome' }), 'Só Nome');
  });
});
