/**
 * Renderer térmico DANFE NFC-e (GT710 / 80mm)
 * Executar: node --test tests/fiscal/danfe-termico.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { montarDadosDanfe, gerarDanfeHtml } = require('../../backend/services/fiscal/danfe');
const DanfeTermicoRenderer = require('../../backend/services/fiscal/DanfeTermicoRenderer');

const empresaBase = {
  nomeFantasia: 'Mercadão do Cícero',
  razaoSocial: 'CDS SISTEMAS LTDA',
  cnpj: '65957340000150',
  telefone: '88999998888',
  logradouro: 'Rua Padre Cícero',
  numero: '120',
  bairro: 'Centro',
  municipio: 'Juazeiro do Norte',
  uf: 'CE',
  cep: '63010000'
};

const chave44 = '23260865957340000150650010000100161433162957';

function itemBase(extra = {}) {
  return {
    produto_id: 10,
    produto_codigo: '12345',
    produto_nome: 'PICOLE COCO',
    quantidade_fiscal: 2,
    quantidade_nao_fiscal: 0,
    valor_fiscal: 5,
    valor_nao_fiscal: 0,
    preco_unitario: 2.5,
    ...extra
  };
}

async function dto(opcoes = {}) {
  return montarDadosDanfe({
    venda: {
      total: 5,
      desconto: 0,
      pagamentos: [
        { forma_pagamento: 'pix', valor: 2.5 },
        { forma_pagamento: 'dinheiro', valor: 2.5 }
      ],
      ...(opcoes.venda || {})
    },
    itens: opcoes.itens || [itemBase()],
    itensFiscal: opcoes.itens || [itemBase()],
    empresa: empresaBase,
    chave: chave44,
    numero: 100,
    serie: 1,
    qrCodeUrl: opcoes.qrCodeUrl || 'https://www.sefaz.ce.gov.br/nfce/qrcode?p=1',
    tributos: opcoes.tributos === undefined ? { vICMS: 0, vPIS: 0, vCOFINS: 0 } : opcoes.tributos,
    nota: {
      tpAmb: 1,
      protocolo: '135260000000001',
      data_autorizacao: '14/08/2026 10:00:00',
      ...(opcoes.nota || {})
    },
    ...opcoes.resto
  });
}

function render(dados) {
  return DanfeTermicoRenderer.gerar(dados);
}

describe('DanfeTermicoRenderer — layout 80mm', () => {
  it('01. 1 produto', async () => {
    const out = render(await dto());
    assert.match(out.texto, /PICOLE COCO/);
    assert.match(out.texto, /12345/);
    assert.equal(out.colunas, 48);
    assert.doesNotMatch(out.html, /<table/i);
  });

  it('02. vários produtos', async () => {
    const out = render(await dto({
      venda: { total: 15, pagamentos: [{ forma_pagamento: 'pix', valor: 15 }] },
      itens: [
        itemBase(),
        itemBase({ produto_codigo: '99', produto_nome: 'AGUA', valor_fiscal: 10, quantidade_fiscal: 1, preco_unitario: 10 })
      ]
    }));
    assert.match(out.texto, /PICOLE COCO/);
    assert.match(out.texto, /AGUA/);
  });

  it('03. descrição curta', async () => {
    const out = render(await dto());
    const linhaNome = out.linhas.find((l) => /PICOLE COCO/.test(l));
    assert.ok(linhaNome);
    assert.ok(!/2,00 x/.test(linhaNome), 'quantidade não cola na descrição');
  });

  it('04. descrição longa quebra sem destruir valores', async () => {
    const nome = 'PICOLE DE COCO COM COBERTURA DE CHOCOLATE 200ML';
    const out = render(await dto({
      itens: [itemBase({ produto_nome: nome })]
    }));
    assert.ok(out.texto.includes('PICOLE DE COCO COM'));
    assert.ok(out.texto.includes('CHOCOLATE') || out.texto.includes('COBERTURA'));
    assert.match(out.texto, /2,00 x 2,50 = 5,00/);
    const linhasNome = out.linhas.filter((l) => /PICOLE|COBERTURA|CHOCOLATE|200ML/.test(l));
    assert.ok(linhasNome.length >= 2);
    linhasNome.forEach((l) => {
      assert.ok(!/=\s*5,00/.test(l) || /x/.test(l));
    });
  });

  it('05. quantidade inteira', async () => {
    const out = render(await dto());
    assert.match(out.texto, /2,00 x/);
  });

  it('06. quantidade decimal', async () => {
    const out = render(await dto({
      venda: { total: 5, pagamentos: [{ forma_pagamento: 'pix', valor: 5 }] },
      itens: [itemBase({ quantidade_fiscal: 1.5, valor_fiscal: 3.75, preco_unitario: 2.5 })]
    }));
    assert.match(out.texto, /1,50 x/);
  });

  it('07. preço unitário', async () => {
    const out = render(await dto());
    assert.match(out.texto, /x 2,50 =/);
  });

  it('08. total', async () => {
    const out = render(await dto());
    assert.match(out.texto, /TOTAL\s+R\$ 5,00/);
  });

  it('09. desconto', async () => {
    const out = render(await dto({
      venda: {
        total: 4,
        desconto: 1,
        pagamentos: [{ forma_pagamento: 'pix', valor: 4 }]
      }
    }));
    assert.match(out.texto, /Desconto\s+R\$ 1,00/);
  });

  it('10. acréscimo', async () => {
    const out = render(await dto({
      venda: {
        total: 6,
        acrescimo: 1,
        pagamentos: [{ forma_pagamento: 'pix', valor: 6 }]
      }
    }));
    assert.match(out.texto, /Acrescimo\s+R\$ 1,00/);
  });

  it('11. pagamento PIX', async () => {
    const out = render(await dto({
      venda: { total: 5, pagamentos: [{ forma_pagamento: 'pix', valor: 5 }] }
    }));
    assert.match(out.texto, /PIX\s+R\$ 5,00/);
    assert.doesNotMatch(out.texto, /DINHEIRO/);
  });

  it('12. pagamento dinheiro', async () => {
    const out = render(await dto({
      venda: { total: 5, pagamentos: [{ forma_pagamento: 'dinheiro', valor: 5 }] }
    }));
    assert.match(out.texto, /DINHEIRO\s+R\$ 5,00/);
  });

  it('13. pagamento misto não agrupa meios', async () => {
    const out = render(await dto());
    assert.match(out.texto, /PIX\s+R\$ 2,50/);
    assert.match(out.texto, /DINHEIRO\s+R\$ 2,50/);
    assert.doesNotMatch(out.texto, /MISTO/);
  });

  it('14. troco', async () => {
    const out = render(await dto({
      venda: {
        total: 5,
        valor_recebido: 7,
        troco: 2,
        pagamentos: [{ forma_pagamento: 'dinheiro', valor: 5 }]
      }
    }));
    assert.match(out.texto, /VALOR ENTREGUE\s+R\$ 7,00/);
    assert.match(out.texto, /TROCO\s+R\$ 2,00/);
  });

  it('15. chave de acesso legível', async () => {
    const out = render(await dto());
    assert.match(out.texto, /CHAVE DE ACESSO/);
    assert.match(out.texto, /2326 0865 9573 4000 0150/);
    assert.match(out.texto, /6500 1000 0100 1614 3316 2957/);
  });

  it('16. QR Code', async () => {
    const out = render(await dto());
    assert.match(out.texto, /\[QR CODE NFC-e\]/);
    assert.match(out.html, /<img /);
    assert.match(out.html, /data:image\/png;base64,/);
  });

  it('17. informações adicionais', async () => {
    const out = render(await dto({
      venda: {
        total: 5,
        informacoes_adicionais: 'Informacao complementar da NFC-e',
        pagamentos: [{ forma_pagamento: 'pix', valor: 5 }]
      }
    }));
    assert.match(out.texto, /Informacao complementar/);
  });

  it('18. NFC-e em homologação', async () => {
    const out = render(await dto({ nota: { tpAmb: 2 } }));
    assert.match(out.texto, /HOMOLOGACAO/);
  });

  it('19. NFC-e autorizada com protocolo', async () => {
    const out = render(await dto());
    assert.match(out.texto, /Protocolo:\s*135260000000001/);
    assert.match(out.texto, /Numero:\s*100/);
    assert.match(out.texto, /Serie:\s*1/);
  });

  it('20. nenhuma linha ultrapassa a largura', async () => {
    const out = render(await dto({
      itens: [itemBase({
        produto_nome: 'PICOLE DE COCO COM COBERTURA DE CHOCOLATE 200ML EXTRA LONGO'
      })]
    }));
    out.linhas.forEach((linha) => {
      assert.ok(linha.length <= out.colunas, `"${linha}" tem ${linha.length} > ${out.colunas}`);
    });
  });
});

describe('DanfeTermicoRenderer — integridade do DTO', () => {
  it('não recalcula valores fiscais e não altera o DTO original', async () => {
    const dados = await dto();
    const snapshot = JSON.stringify(dados);
    const totalAntes = dados.total;
    const pixAntes = dados.pagamentos[0].valor;
    render(dados);
    assert.equal(dados.total, totalAntes);
    assert.equal(dados.pagamentos[0].valor, pixAntes);
    assert.equal(JSON.stringify(dados), snapshot);
  });

  it('preview HTML continua com tabela; térmico não usa tabela', async () => {
    const dados = await dto({ qrCodeUrl: '' });
    const htmlPreview = await gerarDanfeHtml(dados);
    const termico = render(dados);
    assert.match(htmlPreview, /table\.items/);
    assert.match(htmlPreview, /class="danfe/);
    assert.doesNotMatch(termico.html, /<table/i);
    assert.doesNotMatch(termico.html, /col-cod/);
    assert.doesNotMatch(termico.texto, /\x1B@/);
  });
});

describe('DanfeTermicoRenderer — arquivos da sprint', () => {
  it('não altera XML / emissor de autorização', () => {
    const emissor = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fiscal/emissor.js'),
      'utf8'
    );
    assert.match(emissor, /DanfeTermicoRenderer/);
    assert.match(emissor, /enviarAutorizacao/);
    assert.match(emissor, /buildNfceXml/);
  });

  it('impressão fiscal pede pacote preview+térmico', () => {
    const front = fs.readFileSync(
      path.join(__dirname, '../../frontend/shared/js/fiscalImpressao.js'),
      'utf8'
    );
    assert.match(front, /pacote=1/);
    assert.match(front, /htmlImpressao/);
    assert.match(front, /htmlTermico/);
  });
});
