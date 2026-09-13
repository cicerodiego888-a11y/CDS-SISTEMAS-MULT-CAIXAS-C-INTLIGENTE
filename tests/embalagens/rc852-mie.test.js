/**
 * RC8.5.2 — Motor Inteligente de Embalagens (MIE)
 * Executar: node tests/embalagens/rc852-mie.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Mie = require('../../backend/services/embalagens');

const ROOT = path.join(__dirname, '../..');
let ok = 0;
let falhas = 0;

function test(nome, fn) {
  try {
    fn();
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FAIL  ${nome}`);
    console.error(`       ${err.message}`);
  }
}

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('\n=== RC8.5.2 — Motor MIE ===\n');

test('ARGAMASSA AC3 PACOTE 20KG → PACOTE', () => {
  const r = Mie.analisar({ xProd: 'ARGAMASSA AC3 PACOTE 20KG' });
  assert.strictEqual(r.unidade_comercial, 'PACOTE');
  assert.ok(r.compra_por_embalagem);
  assert.ok(r.confianca >= 70);
});

test('REFRIGERANTE FARDO C/12 → FARDO × 12', () => {
  const r = Mie.analisar({ xProd: 'REFRIGERANTE FARDO C/12' });
  assert.strictEqual(r.unidade_comercial, 'FARDO');
  assert.strictEqual(r.quantidade_por_embalagem, 12);
  assert.ok(r.confianca >= 70);
  assert.ok(r.rotulo.includes('12'));
});

test('CERVEJA CX C/24 → CAIXA × 24', () => {
  const r = Mie.analisar({ xProd: 'CERVEJA CX C/24', uCom: 'CX' });
  assert.strictEqual(r.unidade_comercial, 'CAIXA');
  assert.strictEqual(r.quantidade_por_embalagem, 24);
  assert.ok(r.confianca >= 70);
});

test('ÁGUA MINERAL FD 6X1,5L → FARDO × 6', () => {
  const r = Mie.analisar({ xProd: 'ÁGUA MINERAL FD 6X1,5L' });
  assert.strictEqual(r.unidade_comercial, 'FARDO');
  assert.strictEqual(r.quantidade_por_embalagem, 6);
});

test('uCom + descrição + qty → auto_ativar (>95) com aprendizado', () => {
  const r = Mie.analisar({
    xProd: 'CERVEJA CX C/24',
    uCom: 'CX',
    aprendizado: { unidade: 'CAIXA', quantidade_por_embalagem: 24, ocorrencias: 5 }
  });
  assert.strictEqual(r.acao, 'auto_ativar');
  assert.ok(r.confianca > 95);
});

test('produto sem padrão → ignorar', () => {
  const r = Mie.analisar({ xProd: 'PARAFUSO SEXTAVADO M8', uCom: 'UN' });
  assert.ok(r.acao === 'ignorar' || !r.compra_por_embalagem);
});

test('motivos explicáveis presentes', () => {
  const r = Mie.analisar({ xProd: 'SUCO FARDO C/6', uCom: 'FD' });
  assert.ok(Array.isArray(r.motivos) && r.motivos.length >= 2);
});

test('pipeline MIIP chama MIE', () => {
  const src = ler('backend/motores/miip/services/MiipImportacaoXmlService.js');
  assert.match(src, /analisarItemXml|services\/embalagens/);
  assert.match(src, /mieSugestao/);
});

test('UI revisão tem coluna embalagem e destaques', () => {
  const src = ler('frontend/erp/js/miip-central-revisao.js');
  assert.match(src, /rotuloEmbalagemMie/);
  assert.match(src, /resolverEmbalagemComMie/);
  assert.match(src, /mie-campo-autofill|aplicarDestaquesAutofillMiip/);
  assert.match(src, /miip-central-tag--embalagem/);
});

test('RC8.5.3.1 — MIE fecha completamente antes do Cadastro', () => {
  const src = ler('frontend/erp/js/miip-central-revisao.js');
  assert.match(src, /encerrarModalTemporarioCompleto/);
  assert.match(src, /focarCampoCadastroAposMiip/);
  assert.match(src, /RC8\.5\.3\.1/);
  // Decisão MIE ocorre antes de showProdutoModal
  const idxMie = src.indexOf('const decisao = await resolverEmbalagemComMie(item)');
  const idxShow = src.indexOf("showProdutoModal(null, { origem: 'MIIP' })");
  assert.ok(idxMie > 0 && idxShow > idxMie, 'MIE deve ser resolvido antes de abrir o Cadastro');
});

test('RC8.5.3.2 — MIE visível sobre a Central e análise no F3', () => {
  const src = ler('frontend/erp/js/miip-central-revisao.js');
  const css = ler('frontend/css/miip-central-revisao.css');
  assert.match(src, /elevarModalTemporarioSobreMiip/);
  assert.match(src, /normalizarAcaoMie/);
  assert.match(src, /\/mie\/analisar/);
  assert.match(src, /jaExibido/);
  assert.match(src, /_abrindoCadastroProduto/);
  assert.match(css, /23050/);
  assert.match(css, /miip-temp-modal-sobre/);
});

test('API /api/mie registrada', () => {
  assert.match(ler('backend/server.js'), /\/api\/mie/);
  assert.match(ler('backend/rotas/mie.js'), /aprendizado/);
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
