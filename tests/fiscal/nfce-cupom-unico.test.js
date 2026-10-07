/**
 * Cupom NFC-e único — DanfeTermicoRenderer é a única fonte visual.
 * node --test tests/fiscal/nfce-cupom-unico.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '../..');
const { montarDadosDanfe } = require('../../backend/services/fiscal/danfe');
const DanfeTermicoRenderer = require('../../backend/services/fiscal/DanfeTermicoRenderer');
const { enriquecerHtmlImpressaoTermica } = require('../../electron-janelas-modulo');
const {
  obterDanfeHtmlPorNfceId
} = require('../../backend/services/fechamento-fiscal/NfceHistoricoOficialService');

const CHAVE = '23260865957340000150650010000100161433162957';
const NOME_LONGO = 'BEBIDA LACTEA SABOR MORANGO COM POLPA E ACUCAR — EMBALAGEM ECONOMICA 1L';

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function listarJs(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'tests' || ent.name === 'dist' || ent.name === 'release') continue;
    const alvo = path.join(dir, ent.name);
    if (ent.isDirectory()) listarJs(alvo, acc);
    else if (ent.name.endsWith('.js')) acc.push(alvo);
  }
  return acc;
}

function loadFrontPolicy() {
  const sandbox = { module: { exports: {} } };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  const code = ler('frontend/shared/js/cupomPrintPolicy.js');
  const fn = new Function('window', 'global', 'module', 'exports', `${code}\nreturn module.exports || window.CupomPrintPolicy;`);
  return fn(sandbox, sandbox, sandbox.module, sandbox.module.exports);
}

function item(extra = {}) {
  return {
    produto_id: 10,
    produto_codigo: '12345',
    produto_nome: 'PICOLE COCO',
    quantidade_fiscal: 1,
    quantidade_nao_fiscal: 0,
    valor_fiscal: 5,
    valor_nao_fiscal: 0,
    preco_unitario: 5,
    ...extra
  };
}

async function cupom(opcoes = {}) {
  const itens = opcoes.itens || [item()];
  const dados = await montarDadosDanfe({
    venda: {
      total: 5,
      desconto: 0,
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 5 }],
      ...(opcoes.venda || {})
    },
    itens,
    itensFiscal: itens,
    empresa: {
      nomeFantasia: 'MERCADAO',
      razaoSocial: 'CDS SISTEMAS LTDA',
      cnpj: '65957340000150',
      telefone: '88988695712',
      logradouro: 'Rua Professora Ivany Feitosa de Oliveira',
      numero: '393',
      bairro: 'Tiradentes',
      municipio: 'Juazeiro do Norte',
      uf: 'CE',
      cep: '63031140',
      larguraMm: opcoes.larguraMm || 80
    },
    chave: CHAVE,
    numero: 10016,
    serie: 1,
    qrCodeUrl: 'https://nfce.sefaz.ce.gov.br/qrcode?p=CHAVE-OFICIAL',
    tributos: null,
    nota: {
      tpAmb: 1,
      protocolo: '135260000000001',
      data_autorizacao: '06/10/2026 17:00:00'
    }
  });
  return DanfeTermicoRenderer.gerar(dados);
}

function oficial(html) {
  assert.match(html, /class="header"/);
  assert.match(html, /class="documento"/);
  assert.match(html, /class="itens"/);
  assert.match(html, /class="item"/);
  assert.match(html, /class="totais"/);
  assert.match(html, /class="pagamentos"/);
  assert.match(html, /class="chave"/);
  assert.match(html, /class="qr"/);
  assert.match(html, /class="rodape"/);
  assert.match(html, /danfe-termico/);
  assert.doesNotMatch(html, /<pre[\s>]/i);
  assert.doesNotMatch(html, /<table/i);
  assert.match(html, /size:\s*(?:80|58)mm auto/i);
  assert.doesNotMatch(html, /class="fa-|font-awesome|icoLocal|icoTelefone|icoEmpresa|<svg|background-image/i);
  assert.doesNotMatch(html, /\s(?:width|height)\s*=/i);
  const digitos = html.replace(/\D/g, '');
  assert.ok(digitos.includes(CHAVE));
}

describe('Cupom NFC-e único — renderer oficial', () => {
  it('A — 1 item simples no HTML oficial', async () => {
    const out = await cupom();
    oficial(out.html);
    assert.match(out.html, /PICOLE COCO/);
    assert.match(out.html, /total-row/);
  });

  it('B — vários itens', async () => {
    const out = await cupom({
      itens: [
        item({ produto_nome: 'ITEM 1', produto_codigo: '1' }),
        item({ produto_nome: 'ITEM 2', produto_codigo: '2' }),
        item({ produto_nome: 'ITEM 3', produto_codigo: '3' })
      ],
      venda: { total: 15, pagamentos: [{ forma_pagamento: 'dinheiro', valor: 15 }] }
    });
    oficial(out.html);
    assert.match(out.html, /ITEM 1/);
    assert.match(out.html, /ITEM 2/);
    assert.match(out.html, /ITEM 3/);
  });

  it('C — descrição longa permanece completa', async () => {
    const out = await cupom({ itens: [item({ produto_nome: NOME_LONGO })] });
    assert.ok(out.html.includes(NOME_LONGO));
  });

  it('D — pagamento misto completo', async () => {
    const out = await cupom({
      venda: {
        total: 680,
        pagamentos: [
          { forma_pagamento: 'cartao_debito', valor: 260.5 },
          { forma_pagamento: 'cartao_credito', valor: 419.5 }
        ]
      }
    });
    oficial(out.html);
    assert.match(out.html, /CARTÃO DÉBITO|CARTAO DEBITO|DÉBITO|DEBITO/);
    assert.match(out.html, /CARTÃO CRÉDITO|CARTAO CREDITO|CRÉDITO|CREDITO/);
    assert.match(out.html, /260,50/);
    assert.match(out.html, /419,50/);
    assert.match(out.html, /680,00/);
    assert.match(out.html, /TOTAL PAGO/);
  });

  it('E — PIX', async () => {
    const out = await cupom({
      venda: { total: 12, pagamentos: [{ forma_pagamento: 'pix', valor: 12 }] }
    });
    assert.match(out.html, /PIX/);
    assert.match(out.html, /12,00/);
  });

  it('F — cartão', async () => {
    const out = await cupom({
      venda: { total: 30, pagamentos: [{ forma_pagamento: 'cartao_credito', valor: 30 }] }
    });
    assert.match(out.html, /30,00/);
    assert.match(out.html, /CRÉDITO|CREDITO/);
  });

  it('G — troco', async () => {
    const out = await cupom({
      venda: {
        total: 5,
        valor_recebido: 10,
        troco: 5,
        pagamentos: [{ forma_pagamento: 'dinheiro', valor: 5 }]
      }
    });
    assert.match(out.html, /TROCO/);
    assert.match(out.html, /10,00/);
    assert.match(out.html, /5,00/);
  });

  it('H — QR 80 mm em 42 mm, só no CSS', async () => {
    const out = await cupom({ larguraMm: 80 });
    assert.match(out.html, /danfe-termico-80/);
    assert.match(out.html, /--qr:\s*42mm/);
    assert.match(out.html, /width:\s*80mm/);
    assert.match(out.html, /width:\s*var\(--qr\)/);
    assert.match(out.html, /height:\s*var\(--qr\)/);
    assert.match(out.html, /data:image\/png;base64,/);
    assert.match(out.html, /alt="QR Code NFC-e"/);
  });

  it('I — 58 mm com papel 58 mm e QR 26 mm', async () => {
    const out = await cupom({ larguraMm: 58 });
    oficial(out.html);
    assert.match(out.html, /danfe-termico-58/);
    assert.match(out.html, /width:\s*58mm/);
    assert.match(out.html, /--qr:\s*26mm/);
    assert.match(out.html, /font-size:\s*12px/);
  });

  it('J — 80 mm destaca empresa, DANFE e TOTAL', async () => {
    const out = await cupom({ larguraMm: 80 });
    assert.match(out.html, /font-size:\s*18px/);
    assert.match(out.html, /font-size:\s*16px/);
    assert.match(out.html, /DANFE NFC-e/);
    assert.match(out.html, />TOTAL</);
  });

  it('chave em grupos uniformes de 4', async () => {
    const out = await cupom();
    assert.match(out.html, /2326 0865 9573 4000/);
    assert.match(out.html, /0150 6500 1000 0100/);
    assert.match(out.html, /1614 3316 2957/);
    assert.doesNotMatch(out.html, /2326 0865 9573 4000 0150/);
  });

  it('endereço e telefone são texto, sem ícone', async () => {
    const out = await cupom();
    assert.match(out.html, /Professora Ivany Feitosa de Oliveira/);
    assert.match(out.html, /98869-5712|88988695712/);
    assert.doesNotMatch(out.html, /<img(?![^>]*QR Code)/i);
  });
});

describe('Cupom NFC-e único — fluxos', () => {
  const emissor = ler('backend/services/fiscal/emissor.js');
  const historico = ler('backend/services/fechamento-fiscal/NfceHistoricoOficialService.js');
  const rota = ler('backend/rotas/fiscal.js');
  const impressao = ler('frontend/shared/js/fiscalImpressao.js');
  const fiscal = ler('frontend/erp/js/fiscal.js');
  const fechamento = ler('frontend/erp/js/fechamento-fiscal-dia.js');
  const prestacao = ler('frontend/pdv/js/pdv-prestacao-entrega.js');
  const pdv = ler('frontend/pdv/js/pdv.js');
  const renderer = ler('backend/services/fiscal/DanfeTermicoRenderer.js');
  const janelas = ler('electron-janelas-modulo.js');
  const electron = ler('electron.js');
  const electronCommon = ler('electron-common.js');

  it('1-2. PDV e reimpressão passam pelo renderer via imprimirDANFEFiscal', () => {
    assert.match(pdv, /imprimirDANFEFiscal\(/);
    assert.doesNotMatch(pdv, /gerarDanfeHtml\s*\(/);
    assert.match(impressao, /\/fiscal\/danfe\/venda\//);
    assert.match(impressao, /const htmlCupom = htmlTermico;/);
    assert.match(impressao, /danfe-termico/);
    assert.doesNotMatch(impressao, /htmlCupom = htmlTermico \|\| htmlDanfe/);
  });

  it('3. histórico não promove danfe_html antigo a htmlTermico', () => {
    assert.doesNotMatch(historico, /htmlTermico:\s*nota\.danfe_html/);
    assert.doesNotMatch(historico, /gerarDanfeHtml\s*\(/);
    assert.match(historico, /DanfeTermicoRenderer\.gerar/);
    assert.match(historico, /htmlTermico:\s*danfeHtml/);
  });

  it('4. ERP NFC-e pede o cupom oficial', () => {
    assert.match(emissor, /renderCupomNfceOficial/);
    assert.match(emissor, /DanfeTermicoRenderer\.gerar/);
    assert.doesNotMatch(emissor, /gerarDanfeHtml\s*\(/);
    assert.match(fiscal, /imprimirDANFEFiscal\(vendaId\)/);
    const fiscalSemFallbackTermico = fiscal.replace(
      /else if \(resp\?\.danfeHtml && \/danfe-termico\/\.test\(resp\.danfeHtml\)\) \{\s*imprimirHtmlFiscal\(resp\.danfeHtml\);\s*\}/g,
      ''
    );
    assert.doesNotMatch(fiscalSemFallbackTermico, /imprimirHtmlFiscal\(resp\.danfeHtml\)/);
    assert.match(rota, /danfe-termico/);
  });

  it('5. fechamento fiscal só imprime HTML térmico', () => {
    assert.match(fechamento, /danfe-termico/);
    assert.match(fechamento, /ffdImprimirCupomFiscal/);
    assert.doesNotMatch(fechamento, /cupom\.htmlTermico \|\| cupom\.html/);
    assert.doesNotMatch(fechamento, /gerarDanfeHtml\s*\(/);
  });

  it('6. prestação imprime DANFE pelo renderer e mantém o comprovante', () => {
    assert.match(prestacao, /imprimirDANFEFiscal\(vendaId/);
    assert.match(prestacao, /comprovante_html/);
    assert.doesNotMatch(prestacao, /imprimirHtml\(fiscal\.danfeHtml/);
    assert.doesNotMatch(prestacao, /gerarDanfeHtml\s*\(/);
  });

  it('7. produção NFC-e não chama gerarDanfeHtml', () => {
    const hits = [];
    for (const arquivo of listarJs(ROOT)) {
      if (arquivo.endsWith(`${path.sep}danfe.js`)) continue;
      const src = fs.readFileSync(arquivo, 'utf8');
      if (/gerarDanfeHtml\s*\(/.test(src)) hits.push(path.relative(ROOT, arquivo));
    }
    assert.deepEqual(hits, []);
  });

  it('8-14. renderer oficial sem ícone, sem pre e com QR oficial', () => {
    assert.match(renderer, /class="header"/);
    assert.match(renderer, /size: \$\{papelMm\}mm auto/);
    assert.match(renderer, /margin: 0;/);
    assert.match(renderer, /42mm/);
    assert.match(renderer, /26mm/);
    assert.doesNotMatch(renderer, /<pre[\s>]/);
    assert.doesNotMatch(renderer, /class="fa-|icoLocal|icoTelefone|<svg|background-image/);
  });

  it('19. enricher não duplica o estilo e não aplica sombra nem filtro no QR', () => {
    const base = '<html><head></head><body class="danfe-termico"><p>CUPOM</p></body></html>';
    const uma = enriquecerHtmlImpressaoTermica(base);
    const duas = enriquecerHtmlImpressaoTermica(uma);
    assert.equal((duas.match(/id="cds-print-density"/g) || []).length, 1);
    assert.doesNotMatch(duas, /text-shadow/);
    assert.doesNotMatch(duas, /contrast\(1\.45\)/);
    assert.doesNotMatch(duas, /brightness\(0\.78\)/);
    assert.match(duas, /@page \{ margin: 0; \}/);
  });

  it('20. via não duplica e fica fora do miolo fiscal', () => {
    const policy = loadFrontPolicy();
    const base = '<html><body class="danfe-termico"><section class="documento">DANFE NFC-e</section></body></html>';
    const uma = policy.enveloparVia(base, 'CLIENTE');
    const duas = policy.enveloparVia(uma, 'CLIENTE');
    assert.equal((duas.match(/cds-ui-cupom-via/g) || []).length, 1);
    assert.match(duas, /VIA DO CLIENTE/);
    assert.match(duas, /class="documento"/);
  });

  it('impressão silenciosa não reconstrói a geometria do DANFE', () => {
    assert.match(janelas, /silent:\s*true/);
    assert.match(janelas, /marginType:\s*'none'/);
    assert.doesNotMatch(janelas, /pageSize/);
    assert.doesNotMatch(janelas, /setZoomFactor/);
    assert.doesNotMatch(janelas, /usePrinterDefaultPageSize/);
    for (const src of [electron, electronCommon]) {
      assert.match(src, /silent:\s*true/);
      assert.match(src, /printBackground:\s*true/);
      assert.match(src, /marginType:\s*'none'/);
      assert.doesNotMatch(src, /pageSize/);
      assert.doesNotMatch(src, /scaleFactor/);
      assert.doesNotMatch(src, /zoomFactor/);
      assert.doesNotMatch(src, /usePrinterDefaultPageSize/);
    }
  });

  it('L — NFC-e do histórico regenera o oficial e descarta o HTML antigo', async () => {
    const db = new sqlite3.Database(':memory:');
    const run = (sql, params = []) => new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
    const get = (sql, params = []) => new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
    await run(`CREATE TABLE nfce_notas (
      id INTEGER PRIMARY KEY,
      venda_id INTEGER,
      numero INTEGER,
      serie INTEGER,
      chave_acesso TEXT,
      ambiente INTEGER,
      status TEXT,
      xml_enviado TEXT,
      xml_retorno TEXT,
      protocolo TEXT,
      recibo TEXT,
      qr_code_url TEXT,
      danfe_html TEXT,
      fechamento_fiscal_id INTEGER,
      fechamento_documento_id INTEGER,
      origem TEXT,
      created_at TEXT,
      updated_at TEXT
    )`);
    const antigo = '<html><body class="danfe"><i class="fa-map-marker"></i>ICONE-GIGANTE<table class="items"></table></body></html>';
    await run(
      `INSERT INTO nfce_notas (
        id, numero, serie, chave_acesso, ambiente, status, protocolo, qr_code_url, danfe_html
      ) VALUES (7, 51, 1, ?, 1, 'autorizada', '223260816956854', 'https://nfce.sefaz.ce.gov.br/qr?ch=AUTH', ?)`,
      [CHAVE, antigo]
    );
    const pacote = await obterDanfeHtmlPorNfceId(db, 7, {
      getFiscalConfig: async () => ({
        nomeEmpresa: 'Mercadao',
        nomeFantasia: 'Mercadao',
        razaoSocial: 'Mercadao LTDA',
        cnpj: '68645756000121',
        serie: 1,
        ambiente: 1,
        danfeLarguraMm: 80
      }),
      danfe: {
        montarDadosDanfe: async (payload) => ({ ...payload, montado: true })
      },
      DanfeTermicoRenderer: {
        gerar: () => ({
          html: '<html><body class="danfe-termico danfe-termico-80"><header class="header"></header><section class="documento"></section><section class="itens"><div class="item"></div></section><section class="totais"></section><section class="pagamentos"></section><section class="chave"></section><div class="qr"></div><footer class="rodape"></footer></body></html>',
          texto: 'OFICIAL'
        })
      }
    });
    assert.equal(pacote.cache, false);
    assert.match(pacote.html, /danfe-termico/);
    assert.match(pacote.htmlTermico, /danfe-termico/);
    assert.equal(pacote.html, pacote.htmlTermico);
    assert.doesNotMatch(pacote.htmlTermico, /ICONE-GIGANTE/);
    assert.doesNotMatch(pacote.htmlTermico, /fa-map-marker/);
    const gravado = await get('SELECT danfe_html FROM nfce_notas WHERE id=7');
    assert.match(gravado.danfe_html, /danfe-termico/);
    assert.doesNotMatch(gravado.danfe_html, /ICONE-GIGANTE/);
    await new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
  });
});
