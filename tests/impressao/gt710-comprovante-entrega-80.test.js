/**
 * GT710 80 mm — comprovante de entrega (HTML/Electron, não ESC/POS).
 * node --test tests/impressao/gt710-comprovante-entrega-80.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  GT710_80,
  larguraUtilMm,
  cssCupomTermico
} = require('../../backend/services/termico/geometriaCupom80');
const { montarHtmlComprovanteEntrega } = require('../../backend/services/entrega/CriarVendaEntregaService');
const { enriquecerHtmlImpressaoTermica } = require('../../electron-janelas-modulo');

const ROOT = path.join(__dirname, '../..');
const FIXTURE = path.join(__dirname, 'fixtures', 'gt710-comprovante-entrega-80.html');

const PRODUTO_LONGO = 'PICOLÉ LINHA CREMOSA ESPECIAL DE MORANGO COM LEITE CONDENSADO E GRANULADO';
const ENDERECO_LONGO = 'Rua Antônio Nunes de Alencar bem comprida para testar a lateral direita do papel térmico';

function htmlEntrega(papelMm = 80) {
  return montarHtmlComprovanteEntrega({
    id: 901,
    total: 45.9,
    data_venda: '2026-10-19 08:30:00',
    nome_cliente_entrega: 'Maria da Silva Oliveira',
    cpf_cnpj_cliente_entrega: '111.222.333-44',
    telefone_entrega: '88999504417',
    endereco_entrega: ENDERECO_LONGO,
    numero_entrega: '310',
    bairro_entrega: 'José Geraldo da Cruz',
    cidade_entrega: 'Juazeiro do Norte',
    uf_entrega: 'CE',
    referencia_entrega: 'Portaria do prédio azul ao lado da padaria',
    entregador: 'João Entregador',
    taxa_entrega: 5,
    pagamento_previsto: 'DINHEIRO',
    leva_maquineta: 1,
    troco_para: 50,
    observacao_entrega: 'Deixar com o porteiro se ninguém atender'
  }, [
    { nome: PRODUTO_LONGO, quantidade: 2, preco_unitario: 10.45, subtotal: 20.9 },
    { nome: 'ÁGUA MINERAL 500ML', quantidade: 4, preco_unitario: 5, subtotal: 20 }
  ], {
    nome: 'CREMOLÍCIA',
    cnpj: '36.811.652/0001-53',
    papel_mm: papelMm
  });
}

describe('GT710 — mecanismo do comprovante de entrega', () => {
  it('constante de hardware: papel 80 mm, útil 72 mm (576 dots @ 203 dpi)', () => {
    assert.equal(GT710_80.modelo, 'GT710');
    assert.equal(GT710_80.papelMm, 80);
    assert.equal(GT710_80.utilMm, 72);
    assert.equal(GT710_80.dots, 576);
    assert.equal(GT710_80.dpi, 203);
    assert.equal(GT710_80.mecanismo, 'html-electron-driver');
    assert.equal(larguraUtilMm(80), 72);
    assert.equal(larguraUtilMm(58), 48);
  });

  it('rota real é HTML/Electron/driver — não ESC/POS', () => {
    const criar = fs.readFileSync(path.join(ROOT, 'backend/services/entrega/CriarVendaEntregaService.js'), 'utf8');
    const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv-venda-entrega.js'), 'utf8');
    const impressao = fs.readFileSync(path.join(ROOT, 'backend/rotas/impressao.js'), 'utf8');
    const electron = fs.readFileSync(path.join(ROOT, 'electron.js'), 'utf8');

    assert.match(criar, /montarHtmlComprovanteEntrega/);
    assert.match(criar, /geometriaCupom80|require\('\.\/.*geometria|documento\(/);
    assert.match(pdv, /imprimirComprovanteEntrega|apresentarCupomNaTela|abrirComprovante|imprimirDANFESilencioso/);
    assert.match(electron, /imprimir-danfe-silencioso/);
    assert.match(electron, /marginType:\s*'none'/);
    assert.doesNotMatch(electron, /pageSize|scaleFactor|zoomFactor/);

    // ESC/POS existe só para TEF nesta rota — não para entrega
    assert.match(impressao, /router\.post\('\/tef'/);
    assert.match(impressao, /escpos/);
    assert.doesNotMatch(criar, /escpos|ESC\/POS|\x1B@/);
    assert.doesNotMatch(pdv, /escpos|ESC\/POS/);
  });
});

describe('GT710 — geometria do comprovante de entrega 80 mm', () => {
  it('miolo na faixa útil; @page no rolo; sem encolher a tipografia como correção', () => {
    const html = htmlEntrega(80);
    const css = cssCupomTermico(80);

    assert.match(html, /@page \{ size: 80mm auto; margin: 0; \}/);
    assert.match(html, /width:\s*72mm/);
    assert.match(html, /max-width:\s*72mm/);
    assert.doesNotMatch(html, /width:\s*80mm/);
    assert.match(html, /box-sizing:\s*border-box/);
    assert.match(html, /padding:\s*1\.2mm 3\.5mm 2mm 2mm/);
    assert.match(html, /padding-right:\s*1\.5mm/);
    assert.match(html, /data-cds-papel-mm="80"/);
    assert.match(html, /data-cds-util-mm="72"/);
    assert.match(html, /cds-termico-ref" content="GT710"/);
    assert.match(html, /comprovante-entrega-80/);

    // Correção é largura útil, não redução de fonte
    assert.match(css, /font-size:\s*11px/);
    assert.match(css, /\.empresa \{[^}]*font-size:\s*18px/);
    assert.match(css, /\.titulo \{[^}]*font-size:\s*16px/);
    assert.doesNotMatch(css, /font-size:\s*(?:7|8|9)px/);
    assert.doesNotMatch(css, /transform:\s*scale|zoom\s*:|scaleFactor/);
    assert.doesNotMatch(html, /white-space:\s*nowrap|48ch|32ch|76mm|overflow-x\s*:\s*hidden/);
  });

  it('itens, preços, totais, endereço e aviso fiscal cabem no HTML útil', () => {
    const html = htmlEntrega(80);
    for (const trecho of [
      'COMPROVANTE DE ENTREGA',
      'CREMOLÍCIA',
      '36.811.652/0001-53',
      'Maria da Silva Oliveira',
      ENDERECO_LONGO,
      '310',
      PRODUTO_LONGO,
      '2,00 x R$ 10,45',
      'R$ 20,90',
      'ÁGUA MINERAL 500ML',
      'Subtotal:',
      'Taxa:',
      'Total:',
      'R$ 45,90',
      'Taxa de entrega:',
      'Pagamento previsto:',
      'DINHEIRO',
      'ESTE DOCUMENTO NÃO POSSUI VALOR FISCAL',
      'prestação de contas'
    ]) {
      assert.ok(html.includes(trecho), trecho);
    }
    assert.match(html, /class="valor"[^>]*>R\$ 45,90/);
    assert.match(html, /class="aviso"[^>]*>ESTE DOCUMENTO NÃO POSSUI VALOR FISCAL/);
  });

  it('enhancer Electron não altera a geometria útil do comprovante', () => {
    const original = htmlEntrega(80);
    const final = enriquecerHtmlImpressaoTermica(original);
    assert.match(final, /width:\s*72mm/);
    assert.doesNotMatch(final, /width:\s*80mm/);
    assert.match(final, /data-cds-util-mm="72"/);
    assert.doesNotMatch(final, /pageSize|scaleFactor|zoom\s*:/);
    assert.ok(final.includes('ESTE DOCUMENTO NÃO POSSUI VALOR FISCAL'));
  });

  it('grava fixture para impressão física na GT710', () => {
    const html = htmlEntrega(80);
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, html, 'utf8');
    assert.ok(fs.existsSync(FIXTURE));
    assert.ok(fs.statSync(FIXTURE).size > 500);
  });
});
