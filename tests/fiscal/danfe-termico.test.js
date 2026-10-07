/**
 * Renderer térmico DANFE NFC-e (GT710 / 80mm)
 * Executar: node --test tests/fiscal/danfe-termico.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const { montarDadosDanfe } = require('../../backend/services/fiscal/danfe');
const DanfeTermicoRenderer = require('../../backend/services/fiscal/DanfeTermicoRenderer');
const { enriquecerHtmlImpressaoTermica } = require('../../electron-janelas-modulo');
const { gerarHtmlCupomFechamento } = require('../../backend/services/caixa/FechamentoCaixaCupomService');
const EtiquetaProduto = require('../../frontend/erp/js/etiquetaProduto');

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
    empresa: opcoes.empresa || empresaBase,
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
    assert.match(out.texto, /2326 0865 9573 4000/);
    assert.match(out.texto, /0150 6500 1000 0100/);
    assert.match(out.texto, /1614 3316 2957/);
    assert.doesNotMatch(out.texto, /2326 0865 9573 4000 0150/);
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

  it('cupom oficial é só o térmico, sem tabela do visual antigo', async () => {
    const dados = await dto({ qrCodeUrl: '' });
    const termico = render(dados);
    assert.match(termico.html, /danfe-termico/);
    assert.doesNotMatch(termico.html, /<table/i);
    assert.doesNotMatch(termico.html, /col-cod/);
    assert.doesNotMatch(termico.html, /class="fa-/);
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
    assert.match(front, /const htmlCupom = htmlTermico;/);
    assert.match(front, /apresentarCupomNaTela\(htmlCupom, htmlCupom/);
  });
});

describe('Impressão térmica compartilhada — largura segura', () => {
  const PAGE_SO_MARGEM = /@page\s*\{\s*margin:\s*0;\s*\}/;
  const PAGE_COM_SIZE = /@page\b[^{}]*\{[^}]*\bsize\s*:/i;

  function cupomNaoFiscal(venda) {
    const codigoFiscal = fs.readFileSync(
      path.join(__dirname, '../../frontend/shared/js/fiscalImpressao.js'),
      'utf8'
    );
    const contexto = { console, Date, window: null, globalThis: null };
    contexto.window = contexto;
    contexto.globalThis = contexto;
    vm.runInNewContext(`${codigoFiscal}\nwindow.__gerarCupom = montarHtmlCupomNaoFiscal;`, contexto);
    return contexto.__gerarCupom(42, { nome_empresa: 'CDS', itens: [], ...venda }, 10, 0);
  }

  it('fallback declara só @page margin 0, sem size e sem forçar a largura do documento', () => {
    const html = enriquecerHtmlImpressaoTermica(
      '<html><head></head><body><pre style="width:300px">Cupom</pre></body></html>'
    );
    assert.match(html, PAGE_SO_MARGEM);
    assert.doesNotMatch(html, PAGE_COM_SIZE);
    assert.match(html, /width:300px/);
    assert.doesNotMatch(html, /\b(?:height|max-height|pageSize)\s*:/i);
  });

  it('marcador 58mm não gera size inválido nem reduz o body', () => {
    const html = enriquecerHtmlImpressaoTermica(
      '<html><head></head><body class="danfe-termico-58">DANFE</body></html>'
    );
    assert.match(html, PAGE_SO_MARGEM);
    assert.doesNotMatch(html, PAGE_COM_SIZE);
    assert.ok(html.includes('<body class="danfe-termico-58">DANFE</body>'));
  });

  it('largura inline do documento é preservada sem virar @page size', () => {
    const final = enriquecerHtmlImpressaoTermica('<html><head></head><body style="width:58mm">Cupom</body></html>');
    assert.match(final, PAGE_SO_MARGEM);
    assert.doesNotMatch(final, PAGE_COM_SIZE);
    assert.match(final, /body style="width:58mm"/);
  });

  it('@page existente é preservado como está e não recebe segunda regra', () => {
    const original = '<html><head><style>@page { size: auto; margin: 0; } body { width: 58mm; }</style></head><body>Cupom</body></html>';
    const final = enriquecerHtmlImpressaoTermica(original);
    assert.equal((final.match(/@page\b/g) || []).length, 1);
    assert.match(final, /@page \{ size: auto; margin: 0; \}/);
    assert.doesNotMatch(final, /\d+mm auto/);
  });

  it('DANFE 58mm: papel 58mm, QR 26mm e hierarquia menor', async () => {
    const original = render(await dto({ empresa: { ...empresaBase, larguraMm: 58 } })).html;
    const final = enriquecerHtmlImpressaoTermica(original);

    assert.match(original, /@page \{ size: 58mm auto; margin: 0; \}/);
    assert.match(final, /width:\s*58mm/);
    assert.match(final, /--qr:\s*26mm/);
    assert.match(final, /font-size:\s*12px/);
    assert.doesNotMatch(final, /width:\s*48mm/);
    assert.doesNotMatch(final, /<img\b[^>]*\swidth\s*=/i);
    assert.match(final, /danfe-termico-58/);
  });

  it('DANFE 80mm: papel 80mm, QR 42mm e hierarquia do cupom', async () => {
    const original = render(await dto({ empresa: { ...empresaBase, larguraMm: 80 } })).html;
    const final = enriquecerHtmlImpressaoTermica(original);

    assert.match(original, /@page \{ size: 80mm auto; margin: 0; \}/);
    assert.match(final, /width:\s*80mm/);
    assert.match(final, /max-width:\s*80mm/);
    assert.match(final, /--qr:\s*42mm/);
    assert.match(final, /font-size:\s*18px/);
    assert.match(final, /font-size:\s*16px/);
    assert.doesNotMatch(final, /width:\s*72mm/);
    assert.doesNotMatch(final, /width:\s*76mm/);
    assert.doesNotMatch(final, /<img\b[^>]*\swidth\s*=/i);
    assert.match(final, /danfe-termico-80/);
  });

  it('preserva o conteúdo final de cupom curto, incluindo QR e rodapé', () => {
    const html = enriquecerHtmlImpressaoTermica(`
      <html><head></head><body>
        <pre>1 produto\nTotal: R$ 32,00\nPagamento: PIX</pre>
        <img class="qr" src="data:image/png;base64,AA==" />
        <footer>RODAPE DO CUPOM</footer>
      </body></html>
    `);

    for (const trecho of ['1 produto', 'R$ 32,00', 'PIX', 'class="qr"', 'RODAPE DO CUPOM']) {
      assert.ok(html.includes(trecho), `conteúdo ausente: ${trecho}`);
    }
    assert.match(html, PAGE_SO_MARGEM);
  });

  it('preserva itens e rodapé após conteúdo longo variável', () => {
    const itens = Array.from({ length: 120 }, (_, indice) => `PRODUTO ${indice + 1}`);
    const html = enriquecerHtmlImpressaoTermica(`
      <html><head></head><body>
        <pre>${itens.join('\n')}\nSUBTOTAL: R$ 3.840,00\nTOTAL: R$ 3.840,00\nPAGAMENTO: PIX</pre>
        <img class="qr" src="data:image/png;base64,AA==" />
        <div>CHAVE DE ACESSO: 1234567890</div>
        <footer>RODAPE DO CUPOM LONGO</footer>
      </body></html>
    `);

    for (const trecho of ['PRODUTO 120', 'SUBTOTAL:', 'TOTAL:', 'PAGAMENTO: PIX', 'class="qr"', 'CHAVE DE ACESSO', 'RODAPE DO CUPOM LONGO']) {
      assert.ok(html.includes(trecho), `conteúdo ausente: ${trecho}`);
    }
    assert.match(html, PAGE_SO_MARGEM);
    assert.doesNotMatch(html, /\b(?:height|max-height|pageSize)\s*:/i);
  });

  it('cupom não fiscal: papel 80/58mm, sem coluna em ch e sem dado fiscal', () => {
    const cupom80 = enriquecerHtmlImpressaoTermica(cupomNaoFiscal({}));
    const cupom58 = enriquecerHtmlImpressaoTermica(cupomNaoFiscal({ papel_mm: 58 }));

    for (const html of [cupom80, cupom58]) {
      assert.match(html, /<!DOCTYPE html>[\s\S]*<html[\s\S]*<head>[\s\S]*<body/);
      assert.match(html, /@page \{ size: (80|58)mm auto; margin: 0; \}/);
      assert.match(html, /html, body \{ margin: 0; padding: 0;/);
      assert.doesNotMatch(html, /width:\s*(?:300|280|380)px|48ch|32ch|76mm|overflow-x\s*:\s*hidden/);
      assert.ok(html.includes('ESTE COMPROVANTE NÃO POSSUI VALOR FISCAL'));
      assert.doesNotMatch(html, /DANFE|chave de acesso|<img/i);
    }
    assert.match(cupom80, /width:\s*80mm/);
    assert.match(cupom58, /width:\s*58mm/);
  });

  it('fechamento em 80/58mm e etiqueta com barcode preservado', () => {
    const fechamento80 = enriquecerHtmlImpressaoTermica(gerarHtmlCupomFechamento({}));
    const fechamento58 = enriquecerHtmlImpressaoTermica(gerarHtmlCupomFechamento({}, { papel_mm: 58 }));
    const produto = {
      id: 1,
      nome: 'Produto de teste',
      codigo: '123',
      unidade: 'UN',
      codigo_barras: '1234567890123',
      preco_venda: 10
    };
    const etiqueta80 = enriquecerHtmlImpressaoTermica(EtiquetaProduto.montarHtml(produto, '<svg viewBox="0 0 100 30"></svg>'));
    const etiqueta58 = enriquecerHtmlImpressaoTermica(EtiquetaProduto.montarHtml(produto, '<svg viewBox="0 0 100 30"></svg>', { papelMm: 58 }));

    assert.match(fechamento80, /@page \{ size: 80mm auto; margin: 0; \}/);
    assert.match(fechamento80, /width:\s*80mm/);
    assert.match(fechamento80, /fechamento-caixa-80/);
    assert.match(fechamento58, /@page \{ size: 58mm auto; margin: 0; \}/);
    assert.match(fechamento58, /width:\s*58mm/);
    assert.match(fechamento58, /fechamento-caixa-58/);
    assert.doesNotMatch(fechamento80, /48ch|76mm|overflow-x\s*:\s*hidden/);
    for (const html of [etiqueta80, etiqueta58]) {
      assert.match(html, PAGE_SO_MARGEM);
      assert.doesNotMatch(html, PAGE_COM_SIZE);
      assert.doesNotMatch(html, /width:\s*80mm/);
    }
    assert.match(etiqueta80, /\.etiqueta \{ width: 72mm/);
    assert.match(etiqueta58, /\.etiqueta \{ width: 48mm/);
    for (const etiqueta of [etiqueta80, etiqueta58]) {
      assert.match(etiqueta, /min-height:\s*31mm/);
      assert.match(etiqueta, /max-height:\s*25mm/);
      assert.match(etiqueta, /<svg viewBox="0 0 100 30"><\/svg>/);
    }
  });
});

function carregarCupomPrintPolicy() {
  const codigo = fs.readFileSync(
    path.join(__dirname, '../../frontend/shared/js/cupomPrintPolicy.js'),
    'utf8'
  );
  const ctx = { console, Date, document: { querySelectorAll: () => [] } };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(codigo, ctx);
  return ctx.CupomPrintPolicy;
}

function digitosHtml(html) {
  return String(html).replace(/<[^>]+>/g, '').replace(/\D/g, '');
}

describe('DanfeTermicoRenderer — redesign da bobina', () => {
  const nomeLongo = 'Feijao carioca tipo 1 pacote especial selecionado da safra corrente com descricao muito longa';

  it('1. 80mm com 1 item tem hierarquia e blocos', async () => {
    const out = render(await dto());
    assert.match(out.html, /class="header"/);
    assert.match(out.html, /class="documento"/);
    assert.match(out.html, /class="doc-title">DANFE NFC-e</);
    assert.match(out.html, /class="itens"/);
    assert.match(out.html, /class="item"/);
    assert.match(out.html, /class="totais"/);
    assert.match(out.html, /class="pagamentos"/);
    assert.match(out.html, /class="chave"/);
    assert.match(out.html, /class="rodape"/);
    assert.match(out.html, /PICOLE COCO/);
    assert.match(out.html, /font-size:\s*18px/);
    assert.match(out.html, /font-size:\s*13px/);
    assert.doesNotMatch(out.html, /<pre\b/i);
    assert.doesNotMatch(out.html, /<table/i);
  });

  it('2. 80mm com vários itens preserva todos os nomes', async () => {
    const out = render(await dto({
      venda: { total: 15, pagamentos: [{ forma_pagamento: 'pix', valor: 15 }] },
      itens: [
        itemBase(),
        itemBase({ produto_codigo: '99', produto_nome: 'AGUA MINERAL', valor_fiscal: 10, quantidade_fiscal: 1, preco_unitario: 10 })
      ]
    }));
    assert.match(out.html, /PICOLE COCO/);
    assert.match(out.html, /AGUA MINERAL/);
    assert.equal((out.html.match(/class="item"/g) || []).length, 2);
  });

  it('3. descrição longa permanece inteira no HTML', async () => {
    const out = render(await dto({ itens: [itemBase({ produto_nome: nomeLongo })] }));
    assert.ok(out.html.includes(nomeLongo));
    assert.doesNotMatch(out.html, /overflow:\s*hidden/i);
    assert.match(out.html, /class="item-qtd"/);
    assert.match(out.html, /class="item-tot"/);
  });

  it('4. pagamento misto continua com os dois meios e o total', async () => {
    const out = render(await dto());
    assert.match(out.html, /PIX/);
    assert.match(out.html, /DINHEIRO/);
    assert.match(out.html, /class="row total-row"/);
    assert.match(out.html, />TOTAL</);
    assert.match(out.html, /R\$ 2,50/);
    assert.match(out.html, /R\$ 5,00/);
    assert.doesNotMatch(out.html, /MISTO/);
  });

  it('5-6. QR e chave completa no 80mm, com um único tamanho visual', async () => {
    const out = render(await dto());
    const img = out.html.match(/<img\b[^>]*>/i)[0];
    assert.match(img, /QR Code NFC-e/);
    assert.match(img, /data:image\/png;base64,/);
    assert.doesNotMatch(img, /\s(?:width|height)\s*=/i);
    assert.equal((out.html.match(/\.qr img\s*\{/g) || []).length, 1);
    assert.match(out.html, /width:\s*var\(--qr\)/);
    assert.match(out.html, /height:\s*var\(--qr\)/);
    assert.match(out.html, /--qr:\s*42mm/);
    assert.ok(digitosHtml(out.html).includes(chave44));
    assert.match(out.html, /2326 0865 9573 4000/);
    assert.match(out.html, /0150 6500 1000 0100/);
    assert.match(out.html, /1614 3316 2957/);
    assert.doesNotMatch(out.html, /2326 0865 9573 4000 0150/);
  });

  it('7-9. 58mm com descrição longa e QR menor', async () => {
    const out = render(await dto({
      empresa: { ...empresaBase, larguraMm: 58 },
      itens: [itemBase({ produto_nome: nomeLongo })]
    }));
    assert.match(out.html, /danfe-termico-58/);
    assert.match(out.html, /width:\s*58mm/);
    assert.match(out.html, /--qr:\s*26mm/);
    assert.match(out.html, /font-size:\s*12px/);
    assert.ok(out.html.includes(nomeLongo));
    assert.match(out.html, /<img\b[^>]*QR Code NFC-e/);
    assert.doesNotMatch(out.html, /<img\b[^>]*\swidth\s*=/i);
    assert.doesNotMatch(out.html, /width:\s*48mm/);
    assert.ok(digitosHtml(out.html).includes(chave44));
  });

  it('10-16. sem truncar, sem size automático e sem linhas vazias artificiais', async () => {
    const out = render(await dto({ itens: [itemBase({ produto_nome: nomeLongo })] }));
    assert.ok(out.html.includes(nomeLongo));
    assert.ok(digitosHtml(out.html).includes(chave44));
    assert.match(out.html, /R\$ 5,00/);
    assert.match(out.html, /<img /);
    assert.equal((out.html.match(/@page/g) || []).length, 1);
    assert.match(out.html, /@page \{ size: 80mm auto; margin: 0; \}/);
    assert.doesNotMatch(out.html, /76mm|48ch|overflow-x\s*:\s*hidden/i);
    assert.ok(out.linhas.at(-1).trim().length > 0);
    assert.doesNotMatch(out.texto, /\n\n\n/);
    assert.equal(out.colunas, 48);
  });

  it('17. CupomPrintPolicy e o enhancer preservam a estrutura', async () => {
    const original = render(await dto()).html;
    const via = carregarCupomPrintPolicy().enveloparVia(original, 'CLIENTE');
    const final = enriquecerHtmlImpressaoTermica(via);

    assert.match(via, /<body class="danfe-termico danfe-termico-80"><div class="cds-ui-cupom-via"/);
    assert.match(via, /VIA DO CLIENTE/);
    assert.match(final, /id="cds-print-density"/);
    assert.match(final, /class="doc-title">DANFE NFC-e</);
    assert.match(final, /PICOLE COCO/);
    assert.match(final, /class="row total-row"/);
    assert.match(final, /R\$ 5,00/);
    assert.match(final, /QR Code NFC-e/);
    assert.ok(digitosHtml(final).includes(chave44));
    assert.match(final, /Protocolo:/);
    assert.match(final, /@page \{ size: 80mm auto; margin: 0; \}/);
    assert.doesNotMatch(final, /76mm|48ch/);
    assert.doesNotMatch(final, /<img\b[^>]*\swidth\s*=/i);
  });
});

describe('DANFE 80mm — geometria única', () => {
  function estilo(html) {
    const bloco = html.match(/<style>([\s\S]*?)<\/style>/);
    return bloco ? bloco[1] : '';
  }

  function semConflitoDeLargura(html, papelMm) {
    const css = estilo(html);
    assert.match(css, new RegExp(`@page \\{ size: ${papelMm}mm auto; margin: 0; \\}`));
    assert.match(css, new RegExp(`width:\\s*${papelMm}mm`));
    assert.match(css, new RegExp(`max-width:\\s*${papelMm}mm`));
    assert.match(css, /box-sizing:\s*border-box/);
    assert.match(css, /padding:[^;]*2\.5mm|padding:[^;]*2mm/);
    assert.doesNotMatch(css, /76mm/);
    assert.doesNotMatch(css, /48ch/);
    assert.doesNotMatch(css, /72mm/);
    assert.doesNotMatch(css, /width:\s*\d+px/i);
    assert.doesNotMatch(css, /overflow-x\s*:\s*hidden/i);
    assert.doesNotMatch(css, /max-height\s*:/i);
    assert.doesNotMatch(css, /width:\s*\d+mm\s*!important/i);
    assert.doesNotMatch(html, /transform:\s*scale|zoom\s*:/i);
  }

  it('80mm usa o papel físico, margem interna e QR de 42mm', async () => {
    const html = render(await dto()).html;
    semConflitoDeLargura(html, 80);
    assert.match(html, /--qr:\s*42mm/);
    assert.match(html, /max-width:\s*100%/);
    assert.match(html, /font-size:\s*11px/);
    assert.match(html, /font-size:\s*18px/);
    assert.match(html, /font-size:\s*16px/);
    assert.match(html, /font-weight:\s*700/);
  });

  it('58mm continua com papel próprio e QR de 26mm', async () => {
    const html = render(await dto({ empresa: { ...empresaBase, larguraMm: 58 } })).html;
    semConflitoDeLargura(html, 58);
    assert.match(html, /--qr:\s*26mm/);
    assert.match(html, /danfe-termico-58/);
  });

  it('conteúdo real cabe na área útil sem corte de descrição, chave ou rodapé', async () => {
    const nome = 'PICOLE DE CHOCOLATE COM COBERTURA ESPECIAL E RECHEIO CREMOSO 500ML';
    const codigo = '7893477794199123456789';
    const itens = Array.from({ length: 10 }, (_, i) => itemBase({
      produto_id: i + 1,
      produto_codigo: i === 0 ? codigo : String(1000 + i),
      produto_nome: i % 2 === 0 ? nome : `ITEM CURTO ${i + 1}`,
      quantidade_fiscal: 1,
      valor_fiscal: 2,
      preco_unitario: 2
    }));
    const html = render(await dto({
      empresa: {
        nomeFantasia: 'CREMOLÍCIA',
        razaoSocial: 'A TITO DOS SANTOS CREMOLICIA',
        cnpj: '36811652000153',
        telefone: '88999504417',
        logradouro: 'Rua Antônio Nunes de Alencar',
        numero: '310',
        bairro: 'José Geraldo da Cruz',
        municipio: 'Juazeiro do Norte',
        uf: 'CE',
        cep: '63033220'
      },
      venda: {
        total: 20,
        desconto: 1,
        pagamentos: [
          { forma_pagamento: 'pix', valor: 8 },
          { forma_pagamento: 'dinheiro', valor: 7 },
          { forma_pagamento: 'cartao_credito', valor: 5 }
        ]
      },
      itens,
      nota: { numero: 10157, serie: 1 }
    })).html;
    semConflitoDeLargura(html, 80);
    for (const trecho of [
      'CREMOLÍCIA',
      'A TITO DOS SANTOS CREMOLICIA',
      '36.811.652/0001-53',
      'Rua Antônio Nunes de Alencar',
      'DANFE NFC-e',
      'Documento Auxiliar da NFC-e',
      nome,
      codigo,
      'SUBTOTAL',
      'Desconto',
      '>TOTAL<',
      'PAGAMENTOS',
      'PIX',
      'DINHEIRO',
      'CRÉDITO',
      'TOTAL PAGO',
      'CHAVE DE ACESSO',
      'QR Code NFC-e',
      'Protocolo:',
      'Autorizado pela SEFAZ',
      'Obrigado pela preferencia!'
    ]) {
      assert.ok(html.includes(trecho), trecho);
    }
    assert.equal((html.match(/class="item"/g) || []).length, 10);
  });

  it('50 itens crescem o cupom e preservam o final', async () => {
    const itens = Array.from({ length: 50 }, (_, i) => itemBase({
      produto_id: i + 1,
      produto_codigo: String(2000 + i),
      produto_nome: `PRODUTO LONGO NUMERO ${i + 1} COM DESCRICAO QUE PRECISA QUEBRAR`,
      quantidade_fiscal: 1,
      valor_fiscal: 1,
      preco_unitario: 1
    }));
    const html = render(await dto({
      venda: { total: 50, desconto: 0, pagamentos: [{ forma_pagamento: 'pix', valor: 50 }] },
      itens
    })).html;
    semConflitoDeLargura(html, 80);
    assert.equal((html.match(/class="item"/g) || []).length, 50);
    assert.ok(html.includes('PRODUTO LONGO NUMERO 1 '));
    assert.ok(html.includes('PRODUTO LONGO NUMERO 50 '));
    const rodape = html.indexOf('class="rodape"');
    assert.ok(html.indexOf('>TOTAL<') < rodape);
    assert.ok(html.indexOf('PAGAMENTOS') < rodape);
    assert.ok(html.indexOf('CHAVE DE ACESSO') < rodape);
    assert.ok(html.indexOf('QR Code NFC-e') < rodape);
    assert.ok(html.indexOf('Protocolo:') > rodape);
    assert.match(html, /Obrigado pela preferencia!/);
  });
});
